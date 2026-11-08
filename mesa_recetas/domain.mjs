import { randomUUID } from "node:crypto";
import { plannedPortions } from "./public/yield.js";
export const MEALS = ["Desayuno", "Comida", "Merienda", "Cena"];
export const DEFAULTS = {
  servings: 3,
  menu_count: 3,
  kcal_max: 2000,
  protein_min: 0,
  carbs_max: 0,
  fat_max: 0,
  accent: "#f5b940",
  notify_services: [],
  native_timer_service: "",
  preferred: [],
  excluded: [],
};
export const norm = (s) =>
  String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
export const num = (v, min = 0, max = 1000000) => {
  const n = Number(v);
  if (v === "" || v == null || !Number.isFinite(n) || n < min || n > max)
    throw new Error(`Cantidad fuera de rango (${min}–${max})`);
  return n;
};
const str = (s, max = 10000) => {
  if (typeof s !== "string" || s.length > max)
    throw new Error("Texto no válido o demasiado largo");
  return s.trim();
};
export function mediaURL(value) {
  const s = str(value || "", 2000);
  if (
    !s ||
    /^media\/[a-f0-9-]+\.(jpg|png|webp|mp4|webm)$/.test(s) ||
    /^photos\/[a-z]+\.jpg$/.test(s)
  )
    return s;
  try {
    const u = new URL(s);
    if (u.protocol === "https:") return s;
  } catch {}
  throw new Error("La imagen o vídeo debe ser HTTPS o un archivo subido");
}
export function validateRecipe(data) {
  const r = {
    id: data.id || randomUUID(),
    title: str(data.title, 180),
    description: str(data.description || ""),
    category: str(data.category || "General", 80),
    tags: (data.tags || []).map((x) => str(x, 80)).slice(0, 30),
    meal_types: data.meal_types,
    servings: num(data.servings, 1, 100),
    minutes: num(data.minutes, 1, 1440),
    image: mediaURL(data.image),
    video: mediaURL(data.video),
    source: str(data.source || "", 2000),
    favorite: !!data.favorite,
    freezable: !!data.freezable,
    freezer_days: data.freezable ? num(data.freezer_days, 1, 730) : 0,
    thaw: str(data.thaw || ""),
    reheat: str(data.reheat || ""),
    nutrition_status:
      data.nutrition_status === "verified" ? "verified" : "estimated",
    nutrition_source: str(data.nutrition_source || "", 2000),
  };
  r.yield_mode = data.yield_mode ?? "servings";
  if (!["servings", "units"].includes(r.yield_mode))
    throw new Error("Elige raciones o unidades como sistema de cálculo");
  r.yield_quantity =
    r.yield_mode === "units" ? num(data.yield_quantity, 1, 10000) : r.servings;
  if (r.yield_mode === "units" && !Number.isInteger(r.yield_quantity))
    throw new Error("Las unidades de la receta base deben ser enteras");
  r.yield_unit =
    r.yield_mode === "units" ? str(data.yield_unit || "unidad", 50) : "ración";
  r.yield_unit_plural =
    r.yield_mode === "units"
      ? str(data.yield_unit_plural || "unidades", 50)
      : "raciones";
  if (!r.yield_unit || !r.yield_unit_plural)
    throw new Error("Indica el nombre de la unidad en singular y plural");
  if (
    !r.title ||
    !Array.isArray(r.meal_types) ||
    !r.meal_types.length ||
    r.meal_types.some((m) => !MEALS.includes(m))
  )
    throw new Error("Indica título y al menos un tipo de comida");
  r.nutrition = Object.fromEntries(
    ["kcal", "protein", "carbs", "fat"].map((k) => [
      k,
      num(data.nutrition?.[k], k === "kcal" ? 1 : 0, 10000),
    ]),
  );
  if (r.nutrition_status === "verified" && !r.nutrition_source)
    throw new Error("Indica la fuente para marcar los macros como verificados");
  if (
    !Array.isArray(data.ingredients) ||
    !data.ingredients.length ||
    data.ingredients.length > 100
  )
    throw new Error("Añade entre 1 y 100 ingredientes");
  const ids = new Set();
  r.ingredients = data.ingredients.map((i, n) => {
    const id = i.id || `i${n}`;
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id) || ids.has(id))
      throw new Error("Identificadores de ingredientes repetidos o no válidos");
    ids.add(id);
    const name = str(i.name, 150);
    if (!name) throw new Error("Falta el nombre de un ingrediente");
    return {
      id,
      name,
      quantity: num(i.quantity, 0.001),
      unit: str(i.unit, 30),
      group: str(i.group || "Otros", 60),
      components: (i.components || []).map((c) => str(c, 100)).slice(0, 50),
    };
  });
  if (
    !Array.isArray(data.steps) ||
    !data.steps.length ||
    data.steps.length > 100
  )
    throw new Error("Añade entre 1 y 100 pasos");
  const totals = {};
  r.steps = data.steps.map((s) => {
    const text = str(s.text);
    if (!text) throw new Error("Hay un paso vacío");
    const refs = [...text.matchAll(/\{\{([\w-]+)\}\}/g)].map((x) => x[1]);
    const uses = {};
    for (const id of new Set(refs)) {
      if (!ids.has(id))
        throw new Error(`Ingrediente desconocido en un paso: ${id}`);
      uses[id] = num(s.uses?.[id] ?? 1, 0.001, 1);
      totals[id] = (totals[id] || 0) + uses[id];
    }
    return {
      text,
      uses,
      timer_minutes: num(s.timer_minutes || 0, 0, 1440),
      parallel: str(s.parallel || "", 1000),
      video: mediaURL(s.video),
      image: mediaURL(s.image),
    };
  });
  for (const id of ids)
    if (Math.abs((totals[id] || 0) - 1) > 0.001)
      throw new Error(
        `Reparte el 100 % de ${r.ingredients.find((i) => i.id === id).name} entre los pasos usando {{${id}}}.`,
      );
  return r;
}
export function validateSettings(s) {
  if (!Number.isInteger(Number(s.menu_count)))
    throw new Error("El número de menús debe ser entero");
  if (
    s.native_timer_service &&
    (typeof s.native_timer_service !== "string" ||
      !/^mobile_app_[a-zA-Z0-9_]+$/.test(s.native_timer_service))
  )
    throw new Error("Móvil para el Reloj Android no válido");
  return {
    servings: num(s.servings, 1, 100),
    menu_count: num(s.menu_count, 1, 7),
    kcal_max: num(s.kcal_max, 100, 10000),
    protein_min: num(s.protein_min ?? 0, 0, 1000),
    carbs_max: num(s.carbs_max ?? 0, 0, 1000),
    fat_max: num(s.fat_max ?? 0, 0, 1000),
    accent: /^#[\da-fA-F]{6}$/.test(s.accent) ? s.accent : DEFAULTS.accent,
    native_timer_service: s.native_timer_service || "",
    notify_services: (s.notify_services || [])
      .map((x) => {
        if (!/^mobile_app_[a-zA-Z0-9_]+$/.test(x))
          throw new Error("Servicio Android no válido");
        return x;
      })
      .slice(0, 10),
    preferred: (s.preferred || [])
      .map((x) => str(x, 100))
      .filter(Boolean)
      .slice(0, 30),
    excluded: (s.excluded || [])
      .map((x) => str(x, 100))
      .filter(Boolean)
      .slice(0, 30),
  };
}
export const formatQty = (q) =>
  new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(q);
export function stepText(r, step, servings) {
  return step.text.replace(/\{\{([\w-]+)\}\}/g, (_, id) => {
    const i = r.ingredients.find((i) => i.id === id);
    return `${formatQty(((i.quantity * servings) / r.servings) * (step.uses[id] ?? 1))} ${i.unit} de ${i.name}`;
  });
}
export function nutritionDay(entries, recipes) {
  const total = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const e of entries) {
    const r = recipes.find((r) => r.id === e.recipe_id);
    if (r) for (const k in total) total[k] += r.nutrition[k];
  }
  return total;
}
export function generatePlan(recipes, settings, week, random = Math.random) {
  const s = validateSettings(settings);
  const eligible = recipes.filter(
    (r) =>
      !s.excluded.some((x) =>
        r.ingredients.some((i) =>
          [i.name, ...(i.components || [])].some((name) =>
            norm(name).includes(norm(x)),
          ),
        ),
      ),
  );
  const pools = MEALS.map((m) =>
    eligible.filter((r) => r.meal_types.includes(m)),
  );
  const missing = MEALS.filter((_, i) => !pools[i].length);
  if (missing.length)
    throw new Error(
      `Faltan recetas compatibles para: ${missing.join(", ")}. Añade recetas o revisa las exclusiones.`,
    );
  const menus = [];
  const seen = new Set();
  for (let menu = 0; menu < s.menu_count; menu++) {
    const ordered = pools.map((pool) =>
      pool
        .map((r) => ({
          r,
          score:
            random() +
            s.preferred.filter((x) =>
              norm(
                [r.title, ...r.tags, ...r.ingredients.map((i) => i.name)].join(
                  " ",
                ),
              ).includes(norm(x)),
            ).length *
              2,
        }))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.r),
    );
    let best = null;
    let nodes = 0;
    function search(chosen, total) {
      if (++nodes > 150000) return false;
      if (chosen.length === 4) {
        if (
          total.protein < s.protein_min ||
          (s.carbs_max && total.carbs > s.carbs_max) ||
          (s.fat_max && total.fat > s.fat_max)
        )
          return false;
        const key = chosen.map((r) => r.id).join("|");
        if (!best) best = chosen;
        if (seen.has(key)) return false;
        best = chosen;
        return true;
      }
      for (const r of ordered[chosen.length]) {
        const t = Object.fromEntries(
          Object.keys(total).map((k) => [k, total[k] + r.nutrition[k]]),
        );
        if (
          t.kcal > s.kcal_max ||
          (s.carbs_max && t.carbs > s.carbs_max) ||
          (s.fat_max && t.fat > s.fat_max)
        )
          continue;
        if (search([...chosen, r], t)) return true;
      }
      return false;
    }
    search([], { kcal: 0, protein: 0, carbs: 0, fat: 0 });
    if (!best)
      throw new Error(
        "No hay combinación que respete las kcal y macros indicadas. Revisa los límites o añade más recetas.",
      );
    seen.add(best.map((r) => r.id).join("|"));
    menus.push(best);
  }
  return {
    week,
    menu_count: s.menu_count,
    targets: {
      kcal_max: s.kcal_max,
      protein_min: s.protein_min,
      carbs_max: s.carbs_max,
      fat_max: s.fat_max,
    },
    entries: Array.from({ length: 7 }, (_, day) =>
      menus[day % menus.length].map((r, slot) => ({
        day,
        slot,
        recipe_id: r.id,
        servings: plannedPortions(r, s.servings),
        source: "cook",
        stock_id: null,
        consumed: false,
      })),
    ).flat(),
    generated_at: new Date().toISOString(),
  };
}
export function allocateFreezer(plan, stock, plans) {
  const reserved = new Map();
  for (const p of plans.filter((p) => p.week !== plan.week))
    for (const e of p.entries)
      if (e.source === "freezer" && !e.consumed)
        reserved.set(e.stock_id, (reserved.get(e.stock_id) || 0) + e.servings);
  const available = stock
    .map((s) => ({ ...s, free: s.portions - (reserved.get(s.id) || 0) }))
    .sort((a, b) => a.expires_on.localeCompare(b.expires_on));
  for (const e of plan.entries) {
    const date = new Date(plan.week + "T12:00:00Z");
    date.setUTCDate(date.getUTCDate() + e.day);
    const iso = date.toISOString().slice(0, 10);
    const batch = available.find(
      (s) =>
        s.recipe_id === e.recipe_id &&
        s.free >= e.servings &&
        s.frozen_on <= iso &&
        s.expires_on >= iso,
    );
    if (batch) {
      e.source = "freezer";
      e.stock_id = batch.id;
      batch.free -= e.servings;
    }
  }
  return plan;
}
export function shopping(plan, recipes) {
  const items = new Map();
  for (const e of plan?.entries || []) {
    if (e.source === "freezer") continue;
    const r = recipes.find((r) => r.id === e.recipe_id);
    if (!r) continue;
    for (const i of r.ingredients) {
      let quantity = (i.quantity * e.servings) / r.servings;
      let unit = norm(i.unit);
      if (unit === "kg") {
        quantity *= 1000;
        unit = "g";
      }
      if (unit === "l") {
        quantity *= 1000;
        unit = "ml";
      }
      const key = `${norm(i.name)}|${unit}`;
      const old = items.get(key) || {
        key,
        name: i.name,
        unit,
        quantity: 0,
        group: i.group,
      };
      old.quantity += quantity;
      items.set(key, old);
    }
  }
  return [...items.values()].sort(
    (a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name),
  );
}
export function validatePlan(p, recipes, stock, plans = []) {
  if (!Number.isInteger(p.menu_count) || p.menu_count < 1 || p.menu_count > 7)
    throw new Error("Elige de 1 a 7 menús distintos");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(p.week) ||
    new Date(p.week + "T12:00:00Z").getUTCDay() !== 1
  )
    throw new Error("La semana debe empezar en lunes");
  if (!Array.isArray(p.entries) || p.entries.length > 28)
    throw new Error("Plan semanal no válido");
  const keys = new Set();
  const reserved = new Map();
  for (const plan of [...plans.filter((x) => x.week !== p.week), p])
    for (const e of plan.entries)
      if (e.source === "freezer" && !e.consumed)
        reserved.set(
          e.stock_id,
          (reserved.get(e.stock_id) || 0) + Number(e.servings),
        );
  for (const e of p.entries) {
    num(e.day, 0, 6);
    num(e.slot, 0, 3);
    if (!Number.isInteger(e.day) || !Number.isInteger(e.slot))
      throw new Error("Día o comida no válido");
    const key = `${e.day}-${e.slot}`;
    if (keys.has(key)) throw new Error("Comida duplicada");
    keys.add(key);
    num(e.servings, 0.001, 10000);
    if (e.recipe_id && !recipes.some((r) => r.id === e.recipe_id))
      throw new Error("La receta ya no existe");
    if (!["cook", "freezer", "outside"].includes(e.source))
      throw new Error("Origen no válido");
    if (e.source === "outside" && e.recipe_id)
      throw new Error("Comer fuera no debe contener receta");
    if (e.source !== "outside" && !e.recipe_id)
      throw new Error("Selecciona una receta");
    if (e.source === "freezer" && !e.consumed) {
      const batch = stock.find(
        (b) => b.id === e.stock_id && b.recipe_id === e.recipe_id,
      );
      if (!batch || batch.portions < reserved.get(e.stock_id))
        throw new Error(
          "No hay suficientes raciones libres en ese lote del congelador",
        );
    }
  }
  return p;
}
