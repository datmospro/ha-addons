import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  DEFAULTS,
  validateRecipe,
  validateSettings,
  validatePlan,
  generatePlan,
  allocateFreezer,
  num,
} from "./domain.mjs";
import { seedRecipes } from "./seed.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".json": "application/json",
};
export function createApp({
  dataDir = process.env.DATA_DIR || join(HERE, ".data"),
  ingressOnly = process.env.INGRESS_ONLY === "true",
  haFetch = fetch,
} = {}) {
  mkdirSync(join(dataDir, "media"), { recursive: true });
  const db = new DatabaseSync(join(dataDir, "mesa.db"));
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS docs (kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(kind,id));",
  );
  const list = (kind) =>
    db
      .prepare("SELECT body, rev FROM docs WHERE kind=? ORDER BY id")
      .all(kind)
      .map((row) => ({ ...JSON.parse(row.body), _rev: row.rev }));
  const get = (kind, id) => {
    const row = db
      .prepare("SELECT body,rev FROM docs WHERE kind=? AND id=?")
      .get(kind, id);
    return row ? { ...JSON.parse(row.body), _rev: row.rev } : null;
  };
  const save = (kind, id, data, expected) => {
    const old = get(kind, id);
    if (expected !== undefined && (old?._rev || 0) !== expected) {
      const e = new Error(
        "Otra pantalla ha modificado estos datos. Recarga y vuelve a intentarlo.",
      );
      e.status = 409;
      throw e;
    }
    const clean = { ...data };
    delete clean._rev;
    db.prepare(
      "INSERT INTO docs(kind,id,body,rev) VALUES(?,?,?,1) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body, rev=docs.rev+1",
    ).run(kind, id, JSON.stringify(clean));
    return get(kind, id);
  };
  const remove = (kind, id) =>
    db.prepare("DELETE FROM docs WHERE kind=? AND id=?").run(kind, id);
  const transaction = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      db.exec("COMMIT");
      return r;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  if (!get("meta", "initialized"))
    transaction(() => {
      for (const r of seedRecipes()) save("recipe", r.id, r);
      save("settings", "main", DEFAULTS);
      save("meta", "initialized", { version: 1 });
    });
  const settings = () => get("settings", "main");
  const snapshot = () => ({
    recipes: list("recipe"),
    plans: list("plan"),
    stock: list("stock"),
    timers: list("timer"),
    settings: settings(),
    shops: list("shop"),
    server_time: Date.now(),
  });
  const supervisor = async (path, options = {}) => {
    if (!process.env.SUPERVISOR_TOKEN)
      throw new Error(
        "Esta función necesita Home Assistant y su app Android Companion.",
      );
    const r = await haFetch(`http://supervisor/core/api/${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok)
      throw new Error(
        `Home Assistant respondió ${r.status}. Revisa el servicio de notificaciones.`,
      );
    return r.json();
  };
  async function notify(timer) {
    const targets = timer.targets || [];
    if (!targets.length)
      throw new Error("No hay móviles seleccionados en Ajustes.");
    const results = await Promise.allSettled(
      targets.map((service) =>
        supervisor(`services/notify/${service}`, {
          method: "POST",
          body: JSON.stringify({
            title: "Mesa · Temporizador terminado",
            message: timer.label,
            data: {
              ttl: 0,
              priority: "high",
              channel: "alarm_stream",
              tag: `mesa-${timer.id}`,
            },
          }),
        }),
      ),
    );
    if (results.some((x) => x.status === "rejected"))
      throw new Error(
        "No se pudo avisar a todos los móviles. Revisa la conexión y los servicios Android.",
      );
  }
  let ticking = false;
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      for (const current of list("timer")) {
        if (current.status !== "running" || current.ends_at > Date.now())
          continue;
        save("timer", current.id, {
          ...current,
          status: "finished",
          notification: "pending",
          attempts: 0,
          retry_at: 0,
        });
      }
      for (const t of list("timer").filter(
        (t) =>
          t.status === "finished" &&
          t.notification === "pending" &&
          t.retry_at <= Date.now(),
      )) {
        let result;
        try {
          await notify(t);
          result = { notification: "sent", error: "" };
        } catch (e) {
          const attempts = (t.attempts || 0) + 1;
          result = {
            notification: attempts >= 5 ? "failed" : "pending",
            attempts,
            error: e.message,
            retry_at: Date.now() + Math.min(60000, attempts * 10000),
          };
        }
        const latest = get("timer", t.id);
        if (latest?.status === "finished")
          save("timer", t.id, { ...latest, ...result });
      }
    } finally {
      ticking = false;
    }
  }
  const interval = setInterval(
    () => tick().catch((e) => console.error("Timer worker:", e.message)),
    1000,
  );
  interval.unref();
  const send = (res, status, data) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(data));
  };
  async function body(req, limit = 2 * 1024 * 1024, json = true) {
    if (
      json &&
      !(req.headers["content-type"] || "").startsWith("application/json")
    )
      throw new Error("Se requiere Content-Type application/json");
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > limit) {
        const e = new Error("Archivo demasiado grande");
        e.status = 413;
        throw e;
      }
      chunks.push(c);
    }
    const b = Buffer.concat(chunks);
    if (!json) return b;
    try {
      return JSON.parse(b.toString("utf8"));
    } catch {
      throw new Error("JSON no válido");
    }
  }
  const server = http.createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://mesa.local").pathname;
      if (path === "/health" && req.method === "GET")
        return send(res, 200, { ok: true, version: "1.1.0" });
      if (
        ingressOnly &&
        !["172.30.32.2", "::ffff:172.30.32.2"].includes(
          req.socket.remoteAddress,
        )
      )
        return send(res, 403, { error: "Abre Mesa desde Home Assistant." });
      if (
        req.headers["sec-fetch-site"] === "cross-site" &&
        req.method !== "GET"
      )
        return send(res, 403, {
          error: "Solicitud desde otro sitio bloqueada",
        });
      if (path.startsWith("/api/")) {
        if (req.method === "GET") {
          if (path === "/api/state") return send(res, 200, snapshot());
          if (path === "/api/android") {
            const services = await supervisor("services");
            return send(
              res,
              200,
              services
                .filter((s) => s.domain === "notify")
                .flatMap((s) =>
                  Object.keys(s.services).filter((x) =>
                    x.startsWith("mobile_app_"),
                  ),
                ),
            );
          }
          if (path === "/api/export") {
            res.setHeader(
              "Content-Disposition",
              'attachment; filename="mesa-backup.json"',
            );
            const media = Object.fromEntries(
              readdirSync(join(dataDir, "media")).map((f) => [
                f,
                readFileSync(join(dataDir, "media", f)).toString("base64"),
              ]),
            );
            return send(res, 200, {
              format: "mesa-backup-v1",
              ...snapshot(),
              media,
            });
          }
          return send(res, 404, { error: "Ruta no encontrada" });
        }
        if (req.method !== "POST")
          return send(res, 405, { error: "Método no permitido" });
        if (path === "/api/upload") {
          if (req.headers["x-mesa-upload"] !== "1")
            throw new Error("Cabecera de subida requerida");
          const mime = (req.headers["content-type"] || "").split(";")[0];
          const extension = {
            "image/jpeg": "jpg",
            "image/png": "png",
            "image/webp": "webp",
            "video/mp4": "mp4",
            "video/webm": "webm",
          }[mime];
          if (!extension) throw new Error("Sube JPG, PNG, WebP, MP4 o WebM");
          const b = await body(req, 30 * 1024 * 1024, false);
          const file = `${randomUUID()}.${extension}`;
          writeFileSync(join(dataDir, "media", file), b);
          return send(res, 201, { url: `media/${file}` });
        }
        const b = await body(
          req,
          path === "/api/restore" ? 120 * 1024 * 1024 : 2 * 1024 * 1024,
        );
        if (path === "/api/recipe") {
          const r = validateRecipe(b);
          return send(res, 200, save("recipe", r.id, r, b._rev ?? 0));
        }
        if (path === "/api/recipe/delete") {
          const r = get("recipe", b.id);
          if (!r || b._rev !== r._rev) {
            const e = new Error("La receta ha cambiado; recarga");
            e.status = 409;
            throw e;
          }
          if (
            list("plan").some((p) =>
              p.entries.some((e) => e.recipe_id === b.id),
            ) ||
            list("stock").some((s) => s.recipe_id === b.id)
          )
            throw new Error(
              "La receta está en un plan o en el congelador. Retírala de allí antes de borrarla.",
            );
          remove("recipe", b.id);
          return send(res, 200, { ok: true });
        }
        if (path === "/api/settings")
          return send(
            res,
            200,
            save("settings", "main", validateSettings(b), b._rev ?? 0),
          );
        if (path === "/api/generate") {
          const p = generatePlan(
            list("recipe"),
            { ...settings(), ...b.options },
            b.week,
          );
          if (b.use_freezer) allocateFreezer(p, list("stock"), list("plan"));
          validatePlan(p, list("recipe"), list("stock"), list("plan"));
          return send(res, 200, p);
        }
        if (path === "/api/plan") {
          const p = {
            week: b.week,
            entries: b.entries,
            menu_count: num(b.menu_count, 1, 7),
            targets: b.targets
              ? {
                  kcal_max: num(b.targets.kcal_max, 100, 10000),
                  protein_min: num(b.targets.protein_min ?? 0, 0, 1000),
                  carbs_max: num(b.targets.carbs_max ?? 0, 0, 1000),
                  fat_max: num(b.targets.fat_max ?? 0, 0, 1000),
                }
              : undefined,
          };
          validatePlan(p, list("recipe"), list("stock"), list("plan"));
          const previous = get("plan", p.week);
          const oldConsumed = (previous?.entries || []).filter(
            (e) => e.consumed,
          );
          if (
            p.entries.some(
              (e) =>
                e.consumed &&
                !oldConsumed.some(
                  (o) => JSON.stringify(o) === JSON.stringify(e),
                ),
            ) ||
            oldConsumed.some(
              (o) =>
                !p.entries.some((e) => JSON.stringify(o) === JSON.stringify(e)),
            )
          )
            throw new Error(
              "No se puede modificar una comida ya consumida del congelador.",
            );
          return send(res, 200, save("plan", p.week, p, b._rev ?? 0));
        }
        if (path === "/api/plan/copy") {
          const old = get("plan", b.from);
          if (!old) throw new Error("No existe esa semana");
          const p = {
            ...old,
            week: b.week,
            entries: old.entries.map((e) => ({
              ...e,
              source: e.source === "outside" ? "outside" : "cook",
              stock_id: null,
              consumed: false,
            })),
          };
          delete p._rev;
          validatePlan(p, list("recipe"), list("stock"), list("plan"));
          return send(res, 200, p);
        }
        if (path === "/api/shop") {
          const p = get("plan", b.week);
          if (!p) throw new Error("Guarda un plan antes de editar la compra");
          if (
            !Array.isArray(b.checked) ||
            b.checked.some((x) => typeof x !== "string") ||
            !Array.isArray(b.extra) ||
            b.extra.length > 200
          )
            throw new Error("Lista no válida");
          const extra = b.extra.map((i) => ({
            key: String(i.key).slice(0, 100),
            name: String(i.name).slice(0, 200),
            quantity: num(i.quantity, 0.001),
            unit: String(i.unit || "").slice(0, 30),
            group: "Añadidos",
          }));
          return send(
            res,
            200,
            save(
              "shop",
              b.week,
              { week: b.week, checked: b.checked, extra },
              b._rev ?? 0,
            ),
          );
        }
        if (path === "/api/stock") {
          const r = get("recipe", b.recipe_id);
          if (!r?.freezable)
            throw new Error("Selecciona una receta apta para congelar");
          const date = String(b.frozen_on);
          if (
            !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
            !Number.isFinite(Date.parse(date))
          )
            throw new Error("Fecha no válida");
          const expiry = new Date(`${date}T12:00:00Z`);
          expiry.setUTCDate(expiry.getUTCDate() + r.freezer_days);
          const s = {
            id: b.id || randomUUID(),
            recipe_id: r.id,
            portions: num(b.portions, 0, 10000),
            frozen_on: date,
            expires_on: expiry.toISOString().slice(0, 10),
            note: String(b.note || "").slice(0, 500),
          };
          if (b.id) {
            const reserved = list("plan")
              .flatMap((p) => p.entries)
              .filter((e) => e.stock_id === b.id && !e.consumed)
              .reduce((n, e) => n + e.servings, 0);
            if (s.portions < reserved)
              throw new Error(
                "Hay raciones reservadas en el calendario. Retira esas reservas antes de reducir el lote.",
              );
            const old = get("stock", b.id);
            if (old && old.recipe_id !== s.recipe_id)
              throw new Error("No se puede cambiar la receta de un lote");
          }
          return send(res, 200, save("stock", s.id, s, b._rev ?? 0));
        }
        if (path === "/api/consume")
          return send(
            res,
            200,
            transaction(() => {
              const p = get("plan", b.week);
              if (!p || p._rev !== b._rev) {
                const conflict = new Error(
                  "El plan ha cambiado. Recarga antes de marcar consumido.",
                );
                conflict.status = 409;
                throw conflict;
              }
              const e = p?.entries.find(
                (e) => e.day === b.day && e.slot === b.slot,
              );
              if (!e || e.source !== "freezer" || e.consumed)
                throw new Error("Esa comida no tiene una reserva pendiente");
              const s = get("stock", e.stock_id);
              if (!s || s.portions < e.servings)
                throw new Error("Faltan raciones");
              save("stock", s.id, { ...s, portions: s.portions - e.servings });
              e.consumed = true;
              return save("plan", p.week, p);
            }),
          );
        if (path === "/api/timer") {
          let context = {};
          if (
            b.recipe_id != null ||
            b.step_index != null ||
            b.servings != null
          ) {
            const r = get("recipe", b.recipe_id);
            if (!r) throw new Error("La receta del temporizador ya no existe");
            const index = num(b.step_index, 0, r.steps.length - 1);
            if (!Number.isInteger(index)) throw new Error("Paso no válido");
            context = {
              recipe_id: r.id,
              step_index: index,
              step_text: r.steps[index].text,
              servings: num(b.servings, 0.001, 10000),
            };
          }
          const seconds = num(b.seconds, 1, 86400);
          const t = {
            id: randomUUID(),
            ...context,
            label: context.recipe_id
              ? `${get("recipe", context.recipe_id).title} · Paso ${context.step_index + 1}${b.custom ? " · Extra" : ""}`
              : String(b.label || "Temporizador").slice(0, 180),
            duration_seconds: seconds,
            custom: !!b.custom,
            ends_at: Date.now() + seconds * 1000,
            status: "running",
            targets: settings().notify_services,
            notification: "waiting",
          };
          return send(res, 201, save("timer", t.id, t));
        }
        if (path === "/api/timer/dismiss") {
          const t = get("timer", b.id);
          if (!t) throw new Error("Temporizador no encontrado");
          return send(
            res,
            200,
            save("timer", t.id, { ...t, status: "dismissed" }),
          );
        }
        if (path === "/api/android/test") {
          await notify({
            id: "test",
            label: "Prueba de alarma de Mesa",
            targets: settings().notify_services,
          });
          return send(res, 200, { ok: true });
        }
        if (path === "/api/import") {
          const rows = Array.isArray(b) ? b : b.recipes;
          if (!Array.isArray(rows) || rows.length > 1000)
            throw new Error(
              "El JSON debe incluir una lista recipes (máximo 1000)",
            );
          const clean = rows.map((r) =>
            validateRecipe({ ...r, id: randomUUID() }),
          );
          transaction(() => clean.forEach((r) => save("recipe", r.id, r)));
          return send(res, 200, { imported: clean.length });
        }
        if (path === "/api/restore") {
          if (b.format !== "mesa-backup-v1" || b.confirm !== "RESTAURAR")
            throw new Error("Copia o confirmación no válida");
          const recipes = b.recipes.map(validateRecipe);
          const s = validateSettings(b.settings);
          const stock = b.stock.map((x) => {
            if (!recipes.some((r) => r.id === x.recipe_id))
              throw new Error("Copia con lote sin receta");
            num(x.portions, 0, 10000);
            if (
              !/^\d{4}-\d{2}-\d{2}$/.test(x.frozen_on) ||
              !/^\d{4}-\d{2}-\d{2}$/.test(x.expires_on)
            )
              throw new Error("Fechas de lote no válidas");
            return x;
          });
          b.plans.forEach((p) => validatePlan(p, recipes, stock, b.plans));
          const media = Object.entries(b.media || {});
          let total = 0;
          for (const [name, encoded] of media) {
            if (
              !/^[a-f0-9-]+\.(jpg|png|webp|mp4|webm)$/.test(name) ||
              typeof encoded !== "string"
            )
              throw new Error("Archivo de copia no válido");
            total += encoded.length;
          }
          if (total > 110 * 1024 * 1024)
            throw new Error("Copia demasiado grande");
          for (const [name, encoded] of media)
            writeFileSync(
              join(dataDir, "media", name),
              Buffer.from(encoded, "base64"),
            );
          transaction(() => {
            db.exec("DELETE FROM docs WHERE kind != 'meta'");
            recipes.forEach((r) => save("recipe", r.id, r));
            save("settings", "main", s);
            stock.forEach((x) => save("stock", x.id, x));
            b.plans.forEach((x) => save("plan", x.week, x));
            (b.shops || []).forEach((x) => save("shop", x.week, x));
          });
          return send(res, 200, { ok: true });
        }
        return send(res, 404, { error: "Ruta no encontrada" });
      }
      if (req.method !== "GET" && req.method !== "HEAD")
        return send(res, 405, { error: "Método no permitido" });
      const relative =
        path === "/" ? "index.html" : decodeURIComponent(path.slice(1));
      if (!/^[a-zA-Z0-9_./-]+$/.test(relative) || relative.includes(".."))
        return send(res, 404, { error: "Archivo no encontrado" });
      const file = relative.startsWith("media/")
        ? join(dataDir, relative)
        : join(HERE, "public", relative);
      if (!existsSync(file))
        return send(res, 404, { error: "Archivo no encontrado" });
      const bytes = readFileSync(file);
      const mime = MIME[extname(file)] || "application/octet-stream";
      const headers = {
        "Content-Type": mime,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cache-Control":
          relative === "index.html" ? "no-cache" : "private, max-age=300",
        "Content-Security-Policy":
          "default-src 'self'; img-src 'self' https: data:; media-src 'self' https: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
        "Accept-Ranges": "bytes",
      };
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if (range) {
        const start = Number(range[1]);
        const end = Math.min(
          range[2] ? Number(range[2]) : bytes.length - 1,
          bytes.length - 1,
        );
        if (start > end || start >= bytes.length) {
          res.writeHead(416, { "Content-Range": `bytes */${bytes.length}` });
          return res.end();
        }
        res.writeHead(206, {
          ...headers,
          "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
          "Content-Length": end - start + 1,
        });
        return res.end(
          req.method === "HEAD" ? undefined : bytes.subarray(start, end + 1),
        );
      }
      res.writeHead(200, { ...headers, "Content-Length": bytes.length });
      res.end(req.method === "HEAD" ? undefined : bytes);
    } catch (e) {
      if (!res.headersSent)
        send(res, e.status || 400, {
          error: e.message || "No se pudo completar la operación",
        });
      else res.end();
    }
  });
  return {
    server,
    db,
    snapshot,
    tick,
    close: () => {
      clearInterval(interval);
      server.close();
      db.close();
    },
  };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const app = createApp();
  const port = Number(process.env.PORT || 8099);
  app.server.listen(
    port,
    process.env.INGRESS_ONLY === "true" ? "0.0.0.0" : "127.0.0.1",
    () => console.log(`Mesa · Recetas 1.1.0 en puerto ${port}`),
  );
  const stop = () => {
    app.close();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
