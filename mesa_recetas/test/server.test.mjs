import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server.mjs";
async function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "mesa-test-"));
  const app = createApp({ dataDir: dir, ...options });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  t.after(() => {
    app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const request = async (path, data) => {
    const res = await fetch(
      `${url}/api/${path}`,
      data === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          },
    );
    return { status: res.status, body: await res.json() };
  };
  return { app, url, request, dir };
}
test("API: CRUD, conflicto de edición e importación atómica", async (t) => {
  const { request } = await fixture(t);
  const initial = (await request("state")).body;
  assert.equal(initial.recipes.length, 12);
  const r = initial.recipes[0];
  const changed = await request("recipe", { ...r, title: "Nueva receta" });
  assert.equal(changed.status, 200);
  assert.equal(
    (await request("recipe", { ...r, title: "Edición antigua" })).status,
    409,
  );
  const bad = await request("import", { recipes: [r, { title: "Sin datos" }] });
  assert.equal(bad.status, 400);
  assert.equal((await request("state")).body.recipes.length, 12);
  const imported = await request("import", { recipes: [r] });
  assert.equal(imported.body.imported, 1);
  assert.equal((await request("state")).body.recipes.length, 13);
});
test("API: plan, compra, reservas, consumo único y copia de seguridad", async (t) => {
  const { request } = await fixture(t);
  const p = (
    await request("generate", {
      week: "2026-11-02",
      options: { kcal_max: 1800 },
    })
  ).body;
  assert.equal(p.targets.kcal_max, 1800);
  assert.equal((await request("plan", { ...p, _rev: 0 })).status, 200);
  const stock = (
    await request("stock", {
      recipe_id: "bowl",
      portions: 6,
      frozen_on: "2026-11-01",
    })
  ).body;
  let saved = (await request("state")).body.plans[0];
  saved.entries = saved.entries.filter((e) => e.day !== 0 || e.slot !== 1);
  saved.entries.push({
    day: 0,
    slot: 1,
    recipe_id: "bowl",
    servings: 3,
    source: "freezer",
    stock_id: stock.id,
    consumed: false,
  });
  assert.equal((await request("plan", saved)).status, 200);
  assert.equal((await request("stock", { ...stock, portions: 2 })).status, 400);
  const rev = (await request("state")).body.plans[0]._rev;
  assert.equal(
    (await request("consume", { week: saved.week, day: 0, slot: 1, _rev: rev }))
      .status,
    200,
  );
  assert.equal(
    (await request("consume", { week: saved.week, day: 0, slot: 1, _rev: rev }))
      .status,
    409,
  );
  const next = (await request("state")).body;
  assert.equal(next.stock[0].portions, 3);
  const edited = structuredClone(next.plans[0]);
  edited.entries.find((e) => e.consumed).servings = 1;
  assert.equal((await request("plan", edited)).status, 400);
  const s = await request("shop", {
    week: saved.week,
    checked: ["quinoa|g"],
    extra: [],
    _rev: 0,
  });
  assert.equal(s.status, 200);
  assert.equal(
    (
      await request("shop", {
        week: saved.week,
        checked: [],
        extra: [],
        _rev: 0,
      })
    ).status,
    409,
  );
  const backup = (await request("export")).body;
  assert.equal(backup.format, "mesa-backup-v1");
  assert.equal(
    (await request("restore", { ...backup, confirm: "RESTAURAR" })).status,
    200,
  );
  assert.equal((await request("state")).body.stock[0].portions, 3);
});
test("API: temporizador persistente y aviso Android desde el servidor", async (t) => {
  const prev = process.env.SUPERVISOR_TOKEN;
  process.env.SUPERVISOR_TOKEN = "test-token";
  t.after(() => {
    if (prev === undefined) delete process.env.SUPERVISOR_TOKEN;
    else process.env.SUPERVISOR_TOKEN = prev;
  });
  const sent = [];
  const { request, app } = await fixture(t, {
    haFetch: async (url, options) => {
      sent.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => [] };
    },
  });
  const s = (await request("state")).body.settings;
  await request("settings", { ...s, notify_services: ["mobile_app_android"] });
  const timer = (await request("timer", { label: "Quinoa", seconds: 60 })).body;
  app.db
    .prepare("UPDATE docs SET body=? WHERE kind=? AND id=?")
    .run(
      JSON.stringify({ ...timer, ends_at: Date.now() - 1000 }),
      "timer",
      timer.id,
    );
  await app.tick();
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /notify\/mobile_app_android/);
  assert.equal(sent[0].body.data.channel, "alarm_stream");
  assert.equal(sent[0].body.data.priority, "high");
  await app.tick();
  assert.equal(sent.length, 1);
  assert.equal((await request("state")).body.timers[0].notification, "sent");
});
test("API: fallo Android queda visible y no se marca como enviado", async (t) => {
  const { request, app } = await fixture(t);
  const timer = (await request("timer", { label: "Sin móvil", seconds: 1 }))
    .body;
  app.db
    .prepare("UPDATE docs SET body=? WHERE kind=? AND id=?")
    .run(JSON.stringify({ ...timer, ends_at: 0 }), "timer", timer.id);
  await app.tick();
  const actual = (await request("state")).body.timers[0];
  assert.equal(actual.notification, "pending");
  assert.match(actual.error, /móviles/);
});
test("API: temporizadores conservan su receta, paso y raciones; los extras son independientes", async (t) => {
  const { request } = await fixture(t);
  const normal = await request("timer", {
    recipe_id: "bowl",
    step_index: 0,
    servings: 5,
    seconds: 900,
  });
  assert.equal(normal.status, 201);
  assert.equal(normal.body.recipe_id, "bowl");
  assert.equal(normal.body.step_index, 0);
  assert.equal(normal.body.servings, 5);
  assert.equal(
    normal.body.step_text,
    (await request("state")).body.recipes.find((r) => r.id === "bowl").steps[0]
      .text,
  );
  const extra = await request("timer", {
    recipe_id: "bowl",
    step_index: 0,
    servings: 5,
    seconds: 150,
    custom: true,
  });
  assert.equal(extra.status, 201);
  assert.equal(extra.body.duration_seconds, 150);
  assert.match(extra.body.label, /Paso 1 · Extra$/);
  const timers = (await request("state")).body.timers;
  assert.equal(timers.length, 2);
  assert.equal(
    timers.find((t) => t.id === normal.body.id).ends_at,
    normal.body.ends_at,
  );
  for (const body of [
    { recipe_id: "inexistente", step_index: 0, servings: 3, seconds: 120 },
    { recipe_id: "bowl", step_index: 100, servings: 3, seconds: 120 },
    { recipe_id: "bowl", step_index: 0.5, servings: 3, seconds: 120 },
    { recipe_id: "bowl", step_index: 0, servings: 0, seconds: 120 },
    { recipe_id: "bowl", step_index: 0, servings: 3, seconds: 0 },
    { recipe_id: "bowl", step_index: 0, servings: 3, seconds: 86401 },
  ])
    assert.equal((await request("timer", body)).status, 400);
});
test("API: ingress cerrado a accesos directos; health disponible", async (t) => {
  const { url } = await fixture(t, { ingressOnly: true });
  assert.equal((await fetch(`${url}/api/state`)).status, 403);
  assert.equal((await fetch(`${url}/health`)).status, 200);
});
test("API: rutas, CSRF y archivos con rango", async (t) => {
  const { url } = await fixture(t);
  assert.equal(
    (await fetch(`${url}/api/settings`, { method: "POST", body: "{}" })).status,
    400,
  );
  assert.equal(
    (
      await fetch(`${url}/api/timer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Sec-Fetch-Site": "cross-site",
        },
        body: '{"seconds":1}',
      })
    ).status,
    403,
  );
  const photo = await fetch(`${url}/photos/pollo.jpg`, {
    headers: { Range: "bytes=0-99" },
  });
  assert.equal(photo.status, 206);
  assert.equal((await photo.arrayBuffer()).byteLength, 100);
  assert.equal(
    (
      await fetch(`${url}/photos/pollo.jpg`, {
        headers: { Range: "bytes=999999999-" },
      })
    ).status,
    416,
  );
});
test("Los datos sobreviven al cierre y reapertura de SQLite", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "mesa-persist-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const first = createApp({ dataDir: dir });
  first.db
    .prepare(
      "UPDATE docs SET body=json_set(body,'$.accent','#38d5cb') WHERE kind='settings'",
    )
    .run();
  first.close();
  const second = createApp({ dataDir: dir });
  assert.equal(second.snapshot().settings.accent, "#38d5cb");
  assert.equal(second.snapshot().recipes.length, 12);
  second.close();
});
