const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const n = (v) =>
  new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(v || 0);
const meals = ["Desayuno", "Comida", "Merienda", "Cena"];
const paths = {
  chef: '<path d="M7 14a5 5 0 0 1-1-10 6 6 0 0 1 11 0 5 5 0 0 1 0 10v6H7Z"/><path d="M7 16h10"/>',
  book: '<path d="M4 3h13a3 3 0 0 1 3 3v15H6a3 3 0 0 1-3-3V6a3 3 0 0 1 1-3Z"/><path d="M3 17h17M8 6v6"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/>',
  cart: '<path d="m2 3 3 1 3 12h11l3-9H6"/><circle cx="9" cy="21" r="1"/><circle cx="18" cy="21" r="1"/>',
  snow: '<path d="M12 2v20M3.4 7l17.2 10M3.4 17 20.6 7M9 4l3 3 3-3M9 20l3-3 3 3M4 11l4-1-1-4m10 12-1-4 4-1M7 18l1-4-4-1m16-2-4-1 1-4"/>',
  settings:
    '<path d="m9 3-.8 3-3 .8-2.2 4L5 13l-.8 3 3 3 3-.8L12 21l2-2.8 3 .8 3-3-.8-3 2-2.2-2.2-4-3-.8L15 3Z"/><circle cx="12" cy="12" r="3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  heart:
    '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  search: '<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  back: '<path d="M20 12H4m6-6-6 6 6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  play: '<path d="m8 4 12 8-12 8Z"/>',
  flame:
    '<path d="M13 2c1 6 6 7 6 13a7 7 0 0 1-14 0c0-4 3-7 4-8 0 4 2 5 2 5s3-3 2-10Z"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 15Z"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  spark:
    '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  batch:
    '<path d="M4 9h16v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3ZM2 12h2m16 0h2M9 2v3m6-3v3M3 9h18"/>',
};
const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.chef}</svg>`;
const btn = (text, action, cls = "", attrs = "") =>
  `<button class="${cls}" data-action="${action}" ${attrs}>${text}</button>`;
const dateISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monday = (date = new Date()) => {
  const d = new Date(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dateISO(d);
};
const shiftDate = (iso, days) => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + days);
  return dateISO(d);
};
const niceDate = (iso) =>
  new Date(iso + "T12:00:00").toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
  });
let state,
  route = "recipes",
  week = monday(),
  filter = "Todas",
  query = "",
  servings = 3,
  cookIndex = 0,
  currentRecipe,
  batchDone = new Set(),
  editDraft,
  pendingPlan,
  busy = false,
  clockOffset = 0,
  audio;
const app = $("#app"),
  modal = $("#modal");
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").classList.add("show");
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => $("#toast").classList.remove("show"), 5000);
}
async function api(path, data) {
  const r = await fetch(
    `api/${path}`,
    data === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
  );
  const b = await r.json();
  if (!r.ok) throw new Error(b.error || "No se pudo completar la operación");
  return b;
}
function accent(value) {
  document.documentElement.style.setProperty("--accent", value);
  const hex = value.slice(1);
  const c = [0, 2, 4]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  document.documentElement.style.setProperty(
    "--accent-ink",
    lum > 0.18 ? "#171819" : "#ffffff",
  );
}
async function refresh(renderPage = true) {
  const next = await api("state");
  clockOffset = next.server_time - Date.now();
  state = next;
  accent(state.settings.accent);
  if (renderPage) render();
  renderTimers();
}
const recipe = (id) => state.recipes.find((r) => r.id === id);
const plan = () => state.plans.find((p) => p.week === week);
const shop = () =>
  state.shops.find((p) => p.week === week) || {
    week,
    checked: [],
    extra: [],
    _rev: 0,
  };
const entry = (day, slot, p = plan()) =>
  p?.entries.find((e) => e.day === day && e.slot === slot);
function stepText(r, s, count) {
  return s.text.replace(/\{\{([\w-]+)\}\}/g, (_, id) => {
    const i = r.ingredients.find((i) => i.id === id);
    return i
      ? `${n(((i.quantity * count) / r.servings) * (s.uses?.[id] ?? 1))} ${i.unit} de ${i.name}`
      : "[ingrediente pendiente]";
  });
}
function daily(day, p = plan()) {
  const total = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const e of p?.entries.filter((e) => e.day === day) || []) {
    const r = recipe(e.recipe_id);
    if (r) for (const k in total) total[k] += r.nutrition[k];
  }
  return total;
}
function shopping(p = plan()) {
  const map = new Map();
  for (const e of p?.entries || []) {
    if (e.source === "freezer") continue;
    const r = recipe(e.recipe_id);
    if (!r) continue;
    for (const i of r.ingredients) {
      let qty = (i.quantity * e.servings) / r.servings,
        unit = i.unit.toLowerCase().trim();
      if (unit === "kg") {
        qty *= 1000;
        unit = "g";
      }
      if (unit === "l") {
        qty *= 1000;
        unit = "ml";
      }
      const key = `${i.name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase()
        .replace(
          /\s+/g,
          " ",
        )}|${unit.normalize("NFD").replace(/[\u0300-\u036f]/g, "")}`;
      const item = map.get(key) || {
        key,
        name: i.name,
        unit,
        quantity: 0,
        group: i.group,
      };
      item.quantity += qty;
      map.set(key, item);
    }
  }
  return [...map.values()].sort(
    (a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name),
  );
}
function nav(mobile = false) {
  const items = [
    ["recipes", "book", "Recetas"],
    ["week", "calendar", "Semana"],
    ["shopping", "cart", "Compra"],
    ["freezer", "snow", "Congelador"],
    ...(!mobile ? [["batch", "batch", "Por tandas"]] : []),
    ["settings", "settings", "Ajustes"],
  ];
  return `<nav class="${mobile ? "bottom-nav" : "nav"}" aria-label="Navegación ${mobile ? "móvil" : "principal"}">${items.map(([id, ico, title]) => `<a href="#${id}" class="${route === id || (id === "recipes" && ["detail", "cook"].includes(route)) ? "active" : ""}" ${route === id ? 'aria-current="page"' : ""}>${icon(ico)}<span>${title}</span></a>`).join("")}</nav>`;
}
function render() {
  const pages = {
    recipes: renderRecipes,
    detail: renderDetail,
    cook: renderCook,
    week: renderWeek,
    shopping: renderShopping,
    freezer: renderFreezer,
    batch: renderBatch,
    settings: renderSettings,
  };
  app.innerHTML = `<div class="shell"><aside class="sidebar"><a class="brand" href="#recipes"><img src="icon.svg" alt=""><div><strong>Mesa</strong><span>TU COCINA, TU SEMANA</span></div></a>${nav()}<div class="sidebar-footer"><div class="family"><div class="avatar">TÚ</div><div class="avatar">L</div><div class="avatar">K</div></div>Una mesa para los tres.<br><span class="small">${n(state.settings.servings)} raciones · Mesa 1.0</span></div></aside><main><div class="topbar"><a href="#recipes" class="mobile-brand"><img src="icon.svg" alt="">Mesa</a><span class="desktop-label muted small">Un poco de orden. Mucho sabor.</span><span class="date">${new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}</span></div>${(pages[route] || renderRecipes)()}</main>${nav(true)}</div>`;
}
function pageHead(title, subtitle, action = "") {
  return `<div class="page-head"><div><div class="eyebrow">Tu cocina, a tu manera</div><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`;
}
function nutritionCards(v) {
  return `<div class="nutrition-grid">${[
    ["kcal", "kcal"],
    ["protein", "g proteína"],
    ["carbs", "g hidratos"],
    ["fat", "g grasas"],
  ]
    .map(
      ([key, title]) =>
        `<div class="metric"><strong>${n(v[key])}</strong><span>${title}</span></div>`,
    )
    .join("")}</div>`;
}
function renderRecipes() {
  const categories = [
    "Todas",
    "Favoritas",
    ...new Set([
      "Fit",
      ...state.recipes.map((r) => r.category),
      ...state.recipes.flatMap((r) => r.tags),
    ]),
  ];
  const filtered = state.recipes.filter(
    (r) =>
      (filter === "Todas" ||
        (filter === "Favoritas"
          ? r.favorite
          : r.category === filter || r.tags.includes(filter))) &&
      [r.title, ...r.tags, ...r.ingredients.map((i) => i.name)]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const today = (new Date().getDay() + 6) % 7,
    todayPlan = state.plans.find((p) => p.week === monday()),
    nut = daily(today, todayPlan),
    hero =
      state.recipes.find(
        (r) =>
          r.id ===
          todayPlan?.entries.find((e) => e.day === today && e.slot === 1)
            ?.recipe_id,
      ) ||
      recipe("bowl") ||
      state.recipes[0];
  return `${pageHead("¿Qué cocinamos?", "Tus recetas favoritas, listas para compartir mesa.", btn(`${icon("plus")} Nueva receta`, "new-recipe", "primary"))}
    ${!query && filter === "Todas" ? `<section class="hero"><div class="hero-content"><div class="eyebrow">${todayPlan ? "Hoy en tu mesa" : "Cocina con calma"}</div><h2>${esc(todayPlan ? hero?.title || "Tu semana está preparada" : "Menos improvisar. Más disfrutar.")}</h2><p>${todayPlan ? `${n(nut.kcal)} / ${n(state.settings.kcal_max)} kcal por persona hoy · ${n(nut.protein)} g de proteína` : "Organiza tus platos, prepara la semana y disfruta de cocinar sin prisas."}</p>${btn(`${todayPlan ? "Ver mi semana" : "Planificar mi semana"} ${icon("arrow")}`, "go-week", "primary")}</div><div class="hero-image"><img src="${esc(hero?.image || "photos/pollo.jpg")}" alt="${esc(hero?.title || "Plato preparado")}" loading="eager"></div></section>` : ""}
    <div class="flex between wrap"><div class="search grow">${icon("search")}<input id="recipe-search" type="search" placeholder="Busca un plato o ingrediente…" aria-label="Buscar recetas" value="${esc(query)}"></div>${btn(`${icon("download")} Importar`, "import-dialog", "ghost")}</div><div class="filters">${categories.map((c) => btn(esc(c), "filter", c === filter ? "selected" : "", `data-value="${esc(c)}"`)).join("")}</div>
    <div class="section-label"><h2>${filter === "Todas" ? "Tu recetario" : esc(filter)}</h2><span class="muted small">${filtered.length} recetas</span></div><div class="recipe-grid">${filtered.map(recipeCard).join("")}</div>${!filtered.length ? empty("Todavía no hay recetas aquí.", "Añade una receta o cambia los filtros.") : ""}`;
}
function recipeCard(r) {
  return `<article class="recipe-card"><button class="photo" data-action="open-recipe" data-id="${esc(r.id)}" aria-label="Abrir ${esc(r.title)}"><img src="${esc(r.image || "photos/verduras.jpg")}" alt="${esc(r.title)}" loading="lazy"></button>${btn(icon("heart"), "favorite", `icon favorite ${r.favorite ? "on" : ""}`, `data-id="${esc(r.id)}" aria-label="${r.favorite ? "Quitar de" : "Añadir a"} favoritos" aria-pressed="${r.favorite}"`)}<div class="card-body"><span class="pill accent">${esc(r.category)}</span><button class="title" data-action="open-recipe" data-id="${esc(r.id)}">${esc(r.title)}</button><div class="card-meta"><span class="flex">${icon("clock")}${n(r.minutes)} min</span>${r.freezable ? `<span class="flex">${icon("snow")}Congelable</span>` : ""}</div><div class="card-nutrition"><span class="accent">${n(r.nutrition.kcal)} kcal</span><span class="muted">${n(r.nutrition.protein)} g proteína</span></div></div></article>`;
}
function empty(title, text = "") {
  return `<div class="empty">${icon("chef")}<h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
}
function renderDetail() {
  const r = recipe(currentRecipe);
  if (!r) return empty("No se encuentra la receta");
  return `<div class="flex between wrap detail-actions">${btn(`${icon("back")} Recetario`, "go-recipes", "ghost")}<div class="flex">${btn(`${icon("edit")} Editar`, "edit-recipe", "", `data-id="${esc(r.id)}"`)}${btn(icon("heart"), "favorite", `icon ${r.favorite ? "accent" : ""}`, `data-id="${esc(r.id)}" aria-label="Favorito"`)}</div></div><div class="detail-hero"><img src="${esc(r.image || "photos/verduras.jpg")}" alt="${esc(r.title)}"><div class="caption"><span class="pill">${esc(r.category)}</span><span class="pill">${n(r.minutes)} minutos</span></div></div><h1>${esc(r.title)}</h1><p class="muted">${esc(r.description)}</p><div class="flex between wrap gap"><div class="servings"><label for="servings">Raciones</label><input id="servings" type="number" min="1" max="100" step="1" value="${servings}"></div>${btn(`${icon("play")} Empezar a cocinar`, "start-cook", "primary")}</div><div class="gap">${nutritionCards(r.nutrition)}<p class="muted small">Por ración · ${r.nutrition_status === "verified" ? "Datos verificados" : "Valores estimados"}${r.nutrition_source ? ` · ${esc(r.nutrition_source)}` : ""}</p></div><div class="detail-columns gap"><div><section class="panel"><h2>Ingredientes</h2><p class="muted small">Para ${servings} raciones</p><ul class="ingredients">${r.ingredients.map((i) => `<li><span>${esc(i.name)}</span><b>${n((i.quantity * servings) / r.servings)} ${esc(i.unit)}</b></li>`).join("")}</ul></section>${r.freezable ? `<section class="panel gap"><div class="flex accent">${icon("snow")}<strong>Guarda para otro día</strong></div><p class="small gap">Congelable · ${r.freezer_days} días según la receta</p><p class="muted small">${esc(r.thaw)}</p><p class="muted small">${esc(r.reheat)}</p>${btn("Añadir lote al congelador", "new-stock", "", `data-id="${esc(r.id)}"`)}</section>` : ""}${r.source ? `<p class="gap small muted">Origen: ${esc(r.source)}</p>` : ""}</div><section><h2>Paso a paso</h2>${r.steps.map((s, i) => stepCard(r, s, i)).join("")}${r.video ? media(r.video, true) : ""}</section></div>`;
}
function media(url, video = false) {
  return video
    ? `<video src="${esc(url)}" controls preload="metadata" playsinline></video>`
    : `<img src="${esc(url)}" alt="Preparación del paso" loading="lazy">`;
}
function stepCard(r, s, i) {
  return `<article class="step"><span class="step-number">${i + 1}</span><p>${esc(stepText(r, s, servings))}</p>${s.image ? media(s.image) : ""}${s.video ? media(s.video, true) : ""}${s.parallel ? `<div class="parallel"><strong class="small accent">Mientras tanto</strong><p>${esc(s.parallel)}</p></div>` : ""}${stepTimers(r, s, i, servings)}</article>`;
}
function stepTimers(r, step, index, count) {
  const context = `data-recipe-id="${esc(r.id)}" data-step-index="${index}" data-servings="${count}"`;
  return `<div class="step-timers">${step.timer_minutes ? btn(`${icon("clock")} Iniciar · ${n(step.timer_minutes)} min`, "start-timer", "primary", `${context} data-minutes="${step.timer_minutes}"`) : ""}${btn(`${icon("plus")} Otro tiempo`, "custom-timer", "", `${context} aria-label="Temporizador personalizado del paso ${index + 1}"`)}</div>`;
}
function customTimerDialog(id, index, count) {
  const r = recipe(id);
  if (!r?.steps[index]) return toast("Este paso ya no está disponible");
  openModal(
    "Temporizador personalizado",
    `<form id="custom-timer-form" data-recipe-id="${esc(id)}" data-step-index="${index}" data-servings="${count}"><p class="muted small">${esc(r.title)} · Paso ${index + 1} · ${n(count)} raciones</p><p class="small">Inicia un contador adicional para este paso. Los demás temporizadores siguen en marcha.</p><div class="flex wrap gap">${[1, 2, 5, 10].map((minutes) => btn(`+${minutes} min`, "preset-timer", "", `data-minutes="${minutes}"`)).join("")}</div><div class="form-grid gap">${field("Minutos", "minutes", 2, 'min="0" max="1440" step="1" required', "number")}${field("Segundos", "seconds", 0, 'min="0" max="59" step="1" required', "number")}</div><div class="dialog-foot"><button class="primary" type="submit">${icon("play")} Iniciar temporizador</button></div></form>`,
  );
}
function timerDestination(t) {
  let r = recipe(t.recipe_id),
    index = t.step_index;
  // Compatibilidad con los contadores creados antes de guardar su origen.
  if (!r && !t.recipe_id) {
    const match = t.label.match(/^(.*) · Paso (\d+)$/);
    if (match) {
      r = state.recipes.find((r) => r.title === match[1]);
      index = Number(match[2]) - 1;
    }
  }
  if (!r) return null;
  if (t.step_text && r.steps[index]?.text !== t.step_text) {
    index = r.steps.findIndex((step) => step.text === t.step_text);
  }
  return { r, index: r.steps[index] ? index : -1 };
}
function renderCook() {
  const r = recipe(currentRecipe);
  if (!r) return empty("Elige una receta");
  cookIndex = Math.min(cookIndex, r.steps.length - 1);
  const s = r.steps[cookIndex];
  return `<section class="cook"><div class="flex between">${btn(`${icon("back")} Receta`, "back-detail", "ghost")}<span class="pill">${servings} raciones</span></div><div class="gap"><div class="eyebrow">Modo cocina</div><h2>${esc(r.title)}</h2><div class="flex between small muted"><span>Paso ${cookIndex + 1} de ${r.steps.length}</span><span>${n(r.minutes)} min en total</span></div><progress max="${r.steps.length}" value="${cookIndex + 1}"></progress></div>${stepCard(r, s, cookIndex)}<div class="cook-actions">${btn(`${icon("back")} Anterior`, "cook-prev", "", cookIndex === 0 ? "disabled" : "")}${btn(`${cookIndex === r.steps.length - 1 ? "Terminar" : "Siguiente paso"} ${icon("arrow")}`, "cook-next", "primary")}</div><p class="muted small gap">Los temporizadores siguen activos al cambiar de paso. ${state.settings.notify_services.length ? "Avisos Android configurados; comprueba el sonido en Ajustes." : "Configura los móviles en Ajustes para recibir avisos fuera de esta pantalla."}</p></section>`;
}
function weekTools() {
  return `<div class="week-toolbar"><div class="flex">${btn(icon("back"), "prev-week", "icon", 'aria-label="Semana anterior"')}<span class="week-title">${niceDate(week)} – ${niceDate(shiftDate(week, 6))}</span>${btn(icon("arrow"), "next-week", "icon", 'aria-label="Semana siguiente"')}</div><div class="flex wrap">${btn("Hoy", "current-week", "ghost")}${btn(`${icon("copy")} Repetir semana`, "copy-week")}${btn(`${icon("spark")} Generar menú`, "generate-dialog", "primary")}</div></div>`;
}
function renderWeek() {
  const p = plan();
  return `${pageHead("Tu semana, resuelta.", "Cuatro comidas al día. Y espacio para cambiar de idea.")}${weekTools()}${p ? weeklySummary(p) : ""}${!p ? `<div class="notice">Esta semana está vacía. Genera una propuesta o elige los platos manualmente.</div>` : ""}<div class="flex between wrap gap"><span class="muted small">${p?.menu_count || state.settings.menu_count} menús rotativos · Objetivo ≤ ${n(p?.targets?.kcal_max || state.settings.kcal_max)} kcal por persona/día</span>${btn(`${icon("batch")} Cocinar por tandas`, "go-batch", "ghost")}</div><div class="planner-scroll gap"><div class="planner"><div></div>${Array.from({ length: 7 }, (_, d) => `<div class="day-head">${new Date(shiftDate(week, d) + "T12:00:00").toLocaleDateString("es-ES", { weekday: "short" })}<strong>${Number(shiftDate(week, d).slice(-2))}</strong><span class="pill accent">Menú ${String.fromCharCode(65 + (d % (p?.menu_count || state.settings.menu_count)))}</span></div>`).join("")}${meals.map((m, slot) => `<div class="meal-label">${m}</div>${Array.from({ length: 7 }, (_, day) => cell(day, slot)).join("")}`).join("")}<div class="meal-label">Por persona</div>${Array.from(
    { length: 7 },
    (_, d) => {
      const v = daily(d);
      return `<div class="totals"><strong class="${v.kcal > (p?.targets?.kcal_max || state.settings.kcal_max) ? "warning" : ""}">${n(v.kcal)} kcal</strong>P ${n(v.protein)} · HC ${n(v.carbs)} · G ${n(v.fat)}</div>`;
    },
  ).join("")}</div></div><div class="day-mobile gap">${Array.from(
    { length: 7 },
    (_, day) =>
      `<section class="day-card"><div class="flex between"><strong>${new Date(shiftDate(week, day) + "T12:00:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric" })}</strong><span class="pill accent">Menú ${String.fromCharCode(65 + (day % (p?.menu_count || state.settings.menu_count)))}</span></div>${meals
        .map((m, slot) => {
          const e = entry(day, slot),
            r = recipe(e?.recipe_id);
          return `<div class="meal-row"><span class="meal-name">${m}</span><div class="grow"><div class="meal-title">${esc(r?.title || (e?.source === "outside" ? "Comer fuera" : "Sin planificar"))}</div><div class="small muted">${r ? `${n(r.nutrition.kcal)} kcal · ${e.servings} raciones${e.source === "freezer" ? " · ❄ Descongelar en nevera desde el día anterior" : ""}` : ""}</div>${e?.source === "freezer" && !e.consumed ? btn("Marcar consumido", "consume", "link-button", `data-day="${day}" data-slot="${slot}"`) : ""}</div>${btn(icon("edit"), "edit-meal", "icon", `data-day="${day}" data-slot="${slot}" aria-label="Editar ${m}" ${e?.consumed ? "disabled" : ""}`)}</div>`;
        })
        .join(
          "",
        )}<div class="day-total ${daily(day).kcal > (p?.targets?.kcal_max || state.settings.kcal_max) ? "warning" : ""}">${n(daily(day).kcal)} kcal · P ${n(daily(day).protein)} · HC ${n(daily(day).carbs)} · G ${n(daily(day).fat)} por persona</div></section>`,
  ).join(
    "",
  )}</div><p class="small muted gap">Los totales dependen de los datos nutricionales de cada receta. Las comidas fuera de casa no se incluyen.</p>`;
}
function weeklySummary(p) {
  const total = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  const issues = [];
  for (let day = 0; day < 7; day++) {
    const v = daily(day, p);
    for (const k in total) total[k] += v[k];
    const t = p.targets || state.settings;
    if (
      v.kcal > t.kcal_max ||
      (p.entries.filter((e) => e.day === day && e.recipe_id).length === 4 &&
        t.protein_min &&
        v.protein < t.protein_min) ||
      (t.carbs_max && v.carbs > t.carbs_max) ||
      (t.fat_max && v.fat > t.fat_max)
    )
      issues.push(niceDate(shiftDate(week, day)));
  }
  return (
    '<div class="section-label"><h2>Resumen semanal</h2><span class="muted small">Por persona</span></div>' +
    nutritionCards(total) +
    (issues.length
      ? '<div class="notice error">Revisa los objetivos nutricionales de estos días: ' +
        issues.join(", ") +
        ". Los cambios manuales o los cambios en una receta pueden modificar los totales.</div>"
      : "")
  );
}
function cell(day, slot) {
  const e = entry(day, slot),
    r = recipe(e?.recipe_id);
  return `<div class="meal-cell">${btn(esc(r?.title || (e?.source === "outside" ? "Comer fuera" : "+ Elegir plato")), "edit-meal", "", `data-day="${day}" data-slot="${slot}" ${e?.consumed ? "disabled" : ""}`)}${r ? `<span class="cell-meta">${n(r.nutrition.kcal)} kcal · ${e.servings} raciones${e.source === "freezer" ? "<br>❄ Congelador" : ""}</span>` : ""}${e?.source === "freezer" ? (e.consumed ? '<span class="small muted">Consumido ✓</span>' : btn("Consumido ✓", "consume", "consume", `data-day="${day}" data-slot="${slot}"`)) : ""}</div>`;
}
function renderShopping() {
  const s = shop(),
    items = [...shopping(), ...s.extra],
    groups = [...new Set(items.map((i) => i.group))],
    checked = items.filter((i) => s.checked.includes(i.key)).length;
  return `${pageHead("Compra sin vueltas.", "Todo lo que necesitas para la semana, en una sola lista.")}${weekSelector()}${
    !plan()
      ? empty(
          "Primero prepara tu semana",
          "La lista se calculará a partir de los platos del calendario.",
        )
      : `<div class="shopping-layout gap"><section class="panel"><div class="flex between"><h2>Tu lista</h2><span class="muted small">${checked} de ${items.length} marcados</span></div><progress max="${items.length || 1}" value="${checked}"></progress>${groups
          .map(
            (g) =>
              `<div class="shop-group"><h3>${esc(g)}</h3>${items
                .filter((i) => i.group === g)
                .map(
                  (i) =>
                    `<label class="shop-item ${s.checked.includes(i.key) ? "checked" : ""}"><input type="checkbox" data-shop-key="${esc(i.key)}" ${s.checked.includes(i.key) ? "checked" : ""}><span class="item-name">${esc(i.name)}</span><span class="qty">${n(i.quantity)} ${esc(i.unit)}</span></label>`,
                )
                .join("")}</div>`,
          )
          .join(
            "",
          )}${!items.length ? '<p class="muted">No hay ingredientes que comprar.</p>' : ""}</section><aside class="shop-controls stack"><section class="panel"><h3>Lista lista para salir</h3><p class="muted small">Marca lo que ya tienes o has comprado. Los cambios se comparten con Lorena.</p>${btn(`${icon("copy")} Copiar para Google Keep`, "copy-shopping", "primary")}<label class="check-label small gap"><input id="copy-unchecked" type="checkbox" checked>Solo lo pendiente</label></section><section class="panel"><h3>¿Falta algo?</h3><form id="extra-form"><label class="field"><span>Producto</span><input name="name" required placeholder="Papel de cocina"></label><div class="form-grid"><label class="field"><span>Cantidad</span><input name="quantity" type="number" min="0.01" step="any" value="1" required></label><label class="field"><span>Unidad</span><input name="unit" value="ud"></label></div><button class="primary" type="submit">${icon("plus")} Añadir</button></form>${s.extra.length ? btn("Eliminar productos añadidos", "clear-extra", "ghost small gap") : ""}</section></aside></div>`
  }`;
}
function weekSelector() {
  return `<div class="week-toolbar"><div class="flex">${btn(icon("back"), "prev-week", "icon", 'aria-label="Semana anterior"')}<span class="week-title">${niceDate(week)} – ${niceDate(shiftDate(week, 6))}</span>${btn(icon("arrow"), "next-week", "icon", 'aria-label="Semana siguiente"')}</div></div>`;
}
function reserved(id) {
  return state.plans
    .flatMap((p) => p.entries)
    .filter((e) => e.stock_id === id && !e.consumed)
    .reduce((sum, e) => sum + e.servings, 0);
}
function renderFreezer() {
  const rows = state.stock
    .filter((s) => s.portions > 0)
    .sort((a, b) => a.expires_on.localeCompare(b.expires_on));
  return `${pageHead("Tu yo del futuro, feliz.", "Raciones preparadas para los días en los que no apetece cocinar.", btn(`${icon("plus")} Añadir lote`, "new-stock", "primary"))}<div class="notice">Los plazos de conservación los define cada receta. Revisa las instrucciones y las fechas de tus lotes antes de consumirlos.</div><div class="stock-grid gap">${rows
    .map((s) => {
      const r = recipe(s.recipe_id),
        expiring = s.expires_on <= shiftDate(dateISO(new Date()), 7);
      return `<section class="panel stock-card ${expiring ? "expiring" : ""}"><span class="pill ${expiring ? "" : "accent"}">${expiring ? "Revisar fecha" : "En el congelador"}</span><h3 class="gap">${esc(r?.title)}</h3><div class="portions">${n(s.portions)}</div><span class="muted small">raciones · ${n(reserved(s.id))} reservadas</span><div class="dates"><div>Congelado: ${niceDate(s.frozen_on)}</div><div>Consumir antes de: ${niceDate(s.expires_on)}</div></div>${s.note ? `<p class="small muted">${esc(s.note)}</p>` : ""}${btn(`${icon("edit")} Ajustar lote`, "edit-stock", "ghost", `data-id="${esc(s.id)}"`)}<details class="small gap"><summary>Descongelar y recalentar</summary><p class="muted gap">${esc(r?.thaw)}<br>${esc(r?.reheat)}</p></details></section>`;
    })
    .join(
      "",
    )}</div>${!rows.length ? empty("Un congelador lleno de posibilidades", "Añade un lote cuando termines de cocinar una receta congelable.") : ""}`;
}
function renderBatch() {
  const totals = new Map();
  for (const e of plan()?.entries || [])
    if (e.source === "cook" && e.recipe_id)
      totals.set(e.recipe_id, (totals.get(e.recipe_id) || 0) + e.servings);
  const rows = [...totals]
    .map(([id, portions]) => ({ r: recipe(id), portions }))
    .filter((x) => x.r);
  const tasks = [];
  const positions = rows.map(() => 0);
  while (positions.some((p, i) => p < rows[i].r.steps.length)) {
    const candidates = rows
      .map((row, i) => ({
        ...row,
        i,
        index: positions[i],
        step: row.r.steps[positions[i]],
      }))
      .filter((x) => x.step)
      .sort((a, b) => b.step.timer_minutes - a.step.timer_minutes);
    const t = candidates[0];
    tasks.push(t);
    positions[t.i]++;
  }
  return `${pageHead("Una mañana bien aprovechada.", "Preparaciones agrupadas para tu semana. Empieza por las tareas largas.")}${weekSelector()}${
    !rows.length
      ? empty(
          "Aún no hay recetas para preparar",
          "Planifica platos con origen «Cocinar» en tu semana.",
        )
      : `<div class="batch-head gap"><section class="panel"><h2>Lo que vas a preparar</h2>${rows.map(({ r, portions }) => `<div class="flex between small" style="padding:8px 0"><span>${esc(r.title)}${r.freezable ? " ❄" : ""}</span><strong class="accent">${n(portions)} raciones</strong></div>`).join("")}<p class="muted small gap">Se suman las raciones de todas las apariciones de cada plato. Comprueba que tu equipo admite estas cantidades; divide la preparación si es necesario.</p></section><section class="panel"><h2>Antes de empezar</h2><ul class="summary-list"><li>Ten a mano los ingredientes de la lista de compra.</li><li>Organiza recipientes y etiquetas para las raciones.</li><li>Los tiempos son los de la receta base: verifica el punto de cocción al ampliar cantidades.</li><li>El orden conserva los pasos de cada receta. Avanza manualmente cuando una tarea haya terminado o pueda continuar sola.</li></ul>${btn(`${icon("cart")} Ver ingredientes`, "go-shopping")}${btn(`${icon("snow")} Registrar lo cocinado`, "new-stock", "ghost gap")}</section></div><section class="panel"><h2>Tu sesión de cocina</h2>${tasks
          .map((t) => {
            const key = `${week}-${t.r.id}-${t.index}`;
            return `<div class="batch-task ${batchDone.has(key) ? "done" : ""}"><input type="checkbox" data-batch-key="${esc(key)}" aria-label="Marcar tarea completada" ${batchDone.has(key) ? "checked" : ""}><div class="grow"><span class="task-recipe">${esc(t.r.title)} · ${n(t.portions)} raciones · Paso ${t.index + 1}</span><p>${esc(stepText(t.r, t.step, t.portions))}</p>${t.step.parallel ? `<p class="muted small">Mientras tanto: ${esc(t.step.parallel)}</p>` : ""}${stepTimers(t.r, t.step, t.index, t.portions)}</div></div>`;
          })
          .join("")}</section>`
  }`;
}
function field(label, name, value, attrs = "", type = "text") {
  return `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
}
function settingsFields(s) {
  return `<div class="form-grid">${field("Comensales por defecto", "servings", s.servings, 'min="1" max="100" required', "number")}${field("Menús distintos (A, B, C…)", "menu_count", s.menu_count, 'min="1" max="7" required', "number")}${field("Máximo de kcal / persona / día", "kcal_max", s.kcal_max, 'min="100" max="10000" required', "number")}${field("Mínimo de proteína (g/día)", "protein_min", s.protein_min, 'min="0" max="1000"', "number")}${field("Máximo de hidratos (g/día)", "carbs_max", s.carbs_max, 'min="0" max="1000"', "number")}${field("Máximo de grasas (g/día)", "fat_max", s.fat_max, 'min="0" max="1000"', "number")}</div><p class="muted small">Macros a 0 = sin límite. Referencia común por persona; la compra se multiplica por los comensales.</p>${field("Me apetece… (separado por comas)", "preferred", s.preferred.join(", "), 'placeholder="Pasta, arroz, pollo, a la plancha"')}${field("Excluir ingredientes (separados por comas)", "excluded", s.excluded.join(", "), 'placeholder="Champiñones, atún…"')}`;
}
function renderSettings() {
  const s = state.settings;
  return `${pageHead("A tu gusto.", "Tu mesa, tus colores y tus preferencias.")}<form id="settings-form"><div class="settings-grid"><section class="panel"><h2>Un toque de color</h2><p class="muted small">Grafito como base. El acento lo eliges tú.</p><div class="swatches">${["#f5b940", "#bba1ee", "#38d5cb", "#fa8d79", "#98cd66", "#70adf5"].map((c) => btn(c === s.accent ? icon("check") : "", "accent", `swatch ${c === s.accent ? "selected" : ""}`, `style="--swatch:${c}" data-color="${c}" aria-label="Acento ${c}"`)).join("")}</div><label class="flex small muted">Color personalizado <input name="accent" type="color" value="${esc(s.accent)}" aria-label="Color de acento personalizado"></label><div class="notice">Los cambios se guardan para toda la familia.</div></section><section class="panel"><h2>Alarmas en Android</h2><p class="muted small">Selecciona los móviles con la app Home Assistant Companion. Los temporizadores se guardan en el servidor y no dependen de mantener esta pantalla abierta.</p><div id="android-services">${s.notify_services.map((x) => `<label class="check-label small"><input type="checkbox" name="notify_services" value="${esc(x)}" checked>${esc(x.replace("mobile_app_", ""))}</label>`).join("")}</div>${btn("Buscar móviles", "load-android", "ghost")}${btn(`${icon("bell")} Probar alarma`, "test-android")}<p class="muted small gap">Guarda los cambios antes de probar. En Android permite las notificaciones y configura el canal alarm_stream y el modo No molestar. La entrega depende de la conexión, Home Assistant y los permisos: no sustituye una alarma nativa sin conexión.</p><a class="small" href="https://companion.home-assistant.io/docs/notifications/critical-notifications/" target="_blank" rel="noreferrer">Ayuda de notificaciones Android ↗</a></section><section class="panel wide"><h2>Tu semana por defecto</h2>${settingsFields(s)}<button class="primary" type="submit">${icon("check")} Guardar ajustes</button></section></div></form><section class="panel gap"><h2>Tus recetas, a salvo</h2><p class="muted small">Exporta datos y archivos subidos. La restauración reemplaza los datos actuales y descarta los temporizadores. Las fotos enlazadas a webs externas conservan su enlace.</p><div class="flex wrap"><a href="api/export" download="mesa-backup.json">${icon("download")} Descargar copia completa</a>${btn("Importar recetas", "import-dialog")}${btn("Restaurar copia", "restore-dialog", "danger")}</div></section>`;
}
function openModal(title, html) {
  modal.innerHTML = `<div class="dialog-head"><h2>${title}</h2>${btn(icon("close"), "close-modal", "icon ghost", 'aria-label="Cerrar"')}</div><div id="dialog-error" class="notice error hidden" role="alert"></div>${html}`;
  modal.showModal();
}
function dialogError(e) {
  const el = $("#dialog-error");
  if (el) {
    el.textContent = e.message;
    el.classList.remove("hidden");
    el.scrollIntoView({ block: "nearest" });
  } else toast(e.message);
}
function splitList(s) {
  return String(s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}
function readSettings(form) {
  const f = new FormData(form);
  return {
    ...state.settings,
    ...Object.fromEntries(
      [
        "servings",
        "menu_count",
        "kcal_max",
        "protein_min",
        "carbs_max",
        "fat_max",
      ].map((k) => [k, Number(f.get(k))]),
    ),
    preferred: splitList(f.get("preferred")),
    excluded: splitList(f.get("excluded")),
    accent: f.get("accent") || state.settings.accent,
    notify_services:
      form.id === "settings-form"
        ? f.getAll("notify_services")
        : state.settings.notify_services,
  };
}
function generatorDialog() {
  openModal(
    "Prepara tu semana",
    `<form id="generate-form">${settingsFields(state.settings)}<label class="check-label small"><input name="use_freezer" type="checkbox" checked>Aprovechar raciones disponibles del congelador</label><div class="notice">Las preferencias dan prioridad a recetas; las exclusiones y los límites son obligatorios. Los menús rotan desde A el lunes. Podrás revisar la propuesta antes de guardarla.</div><div class="dialog-foot"><button class="primary" type="submit">${icon("spark")} Crear propuesta</button></div></form>`,
  );
}
function proposalDialog(p) {
  pendingPlan = p;
  openModal(
    "Tu propuesta semanal",
    `<p class="muted small">${niceDate(week)} – ${niceDate(shiftDate(week, 6))} · ${p.menu_count} menús. Al guardar, se reemplaza el plan de esta semana.</p>${Array.from(
      { length: Math.min(7, p.menu_count) },
      (_, day) =>
        `<section class="panel gap"><h3>Menú ${String.fromCharCode(65 + day)}</h3>${p.entries
          .filter((e) => e.day === day)
          .map(
            (e) =>
              `<div class="flex between small" style="padding:6px 0"><span class="muted">${meals[e.slot]}</span><span>${esc(recipe(e.recipe_id)?.title || "Comer fuera")}</span></div>`,
          )
          .join(
            "",
          )}<p class="small accent gap">${n(daily(day, p).kcal)} kcal · ${n(daily(day, p).protein)} g proteína por persona</p></section>`,
    ).join(
      "",
    )}<div class="dialog-foot">${btn("Volver", "generate-dialog")}${btn(`${icon("check")} Guardar esta semana`, "save-proposal", "primary")}</div>`,
  );
}
function mealDialog(day, slot) {
  const e = entry(day, slot);
  if (e?.consumed) return toast("Esta ración ya se ha consumido.");
  const rows = state.recipes;
  openModal(
    `${meals[slot]} · ${niceDate(shiftDate(week, day))}`,
    `<form id="meal-form" data-day="${day}" data-slot="${slot}"><label class="field"><span>Plato</span><select name="recipe_id"><option value="">Sin planificar</option><option value="outside" ${e?.source === "outside" ? "selected" : ""}>Comer fuera</option>${rows.map((r) => `<option value="${esc(r.id)}" ${e?.recipe_id === r.id ? "selected" : ""}>${esc(r.title)} · ${r.nutrition.kcal} kcal</option>`).join("")}</select></label>${field("Raciones", "servings", e?.servings || state.settings.servings, 'min="1" max="100" required', "number")}<label class="field"><span>Preparación</span><select name="stock_id"><option value="">Cocinar</option>${state.stock
      .filter((s) => s.portions > 0)
      .map(
        (s) =>
          `<option value="${esc(s.id)}" ${e?.stock_id === s.id ? "selected" : ""}>Congelador: ${esc(recipe(s.recipe_id)?.title)} · ${n(s.portions - reserved(s.id) + (e?.stock_id === s.id ? e.servings : 0))} libres · ${niceDate(s.frozen_on)}</option>`,
      )
      .join(
        "",
      )}</select></label><p class="muted small">Si usas el congelador, el lote debe corresponder al plato elegido. Se reservarán las raciones y no se añadirán sus ingredientes a la compra.</p><div class="dialog-foot">${e?.recipe_id ? btn("Ver receta", "open-recipe", "", `data-id="${esc(e.recipe_id)}" data-servings="${e.servings}"`) : ""}<button class="primary" type="submit">Guardar comida</button></div></form>`,
  );
}
function stockDialog(id, recipeId) {
  const s = state.stock.find((s) => s.id === id);
  const rows = state.recipes.filter((r) => r.freezable);
  openModal(
    s ? "Ajustar lote" : "Guardar para otro día",
    !rows.length
      ? "<p>Marca primero una receta como congelable.</p>"
      : `<form id="stock-form" data-id="${esc(s?.id || "")}"><label class="field"><span>Receta</span><select name="recipe_id" ${s ? "disabled" : ""}>${rows.map((r) => `<option value="${esc(r.id)}" ${r.id === (s?.recipe_id || recipeId) ? "selected" : ""}>${esc(r.title)} · ${r.freezer_days} días</option>`).join("")}</select></label>${field("Raciones en el lote", "portions", s?.portions ?? state.settings.servings, 'min="0" max="10000" required', "number")}${field("Fecha de congelación", "frozen_on", s?.frozen_on || dateISO(new Date()), "required", "date")}${field("Etiqueta / ubicación / notas", "note", s?.note || "", 'placeholder="Cajón superior, recipientes azules…"')}<div class="dialog-foot"><button class="primary" type="submit">Guardar lote</button></div></form>`,
  );
}
function editorDialog(r) {
  editDraft = structuredClone(
    r || {
      title: "",
      description: "",
      category: "General",
      tags: [],
      meal_types: ["Comida"],
      servings: 3,
      minutes: 30,
      image: "",
      video: "",
      source: "",
      freezable: false,
      freezer_days: 60,
      thaw: "",
      reheat: "",
      nutrition: { kcal: "", protein: "", carbs: "", fat: "" },
      nutrition_status: "estimated",
      nutrition_source: "",
      ingredients: [
        { id: "i0", name: "", quantity: 1, unit: "g", group: "Otros" },
      ],
      steps: [{ text: "", timer_minutes: 0, parallel: "", uses: {} }],
    },
  );
  drawEditor();
}
function drawEditor() {
  const r = editDraft;
  if (modal.open) modal.close();
  openModal(
    r.id ? "Editar receta" : "Una nueva receta",
    `<form id="recipe-form"><div class="form-grid"><div class="full">${field("Nombre del plato", "title", r.title, 'required maxlength="180"')}</div><label class="field full"><span>Descripción</span><textarea name="description">${esc(r.description)}</textarea></label>${field("Categoría", "category", r.category)}${field("Etiquetas (separadas por comas)", "tags", r.tags.join(", "))}${field("Raciones de la receta base", "servings", r.servings, 'min="1" max="100" required', "number")}${field("Tiempo total (min)", "minutes", r.minutes, 'min="1" max="1440" required', "number")}</div><div class="flex wrap gap">${meals.map((m) => `<label class="check-label small"><input name="meal_types" type="checkbox" value="${m}" ${r.meal_types.includes(m) ? "checked" : ""}>${m}</label>`).join("")}</div><h3 class="gap">Foto y vídeo</h3>${field("Imagen (URL HTTPS o archivo subido)", "image", r.image)}<label class="field"><span>Subir imagen</span><input type="file" data-upload-target="image" accept="image/jpeg,image/png,image/webp"></label>${field("Vídeo (URL directa HTTPS, MP4 o WebM)", "video", r.video)}<label class="field"><span>Subir vídeo · máximo 30 MB</span><input type="file" data-upload-target="video" accept="video/mp4,video/webm"></label>${field("Fuente de la receta", "source", r.source)}<h3 class="gap">Nutrición por ración · obligatoria</h3><div class="form-grid">${[
      ["kcal", "Kcal"],
      ["protein", "Proteína (g)"],
      ["carbs", "Hidratos (g)"],
      ["fat", "Grasas (g)"],
    ]
      .map(([key, label]) =>
        field(
          label,
          `nutrition_${key}`,
          r.nutrition[key],
          `min="${key === "kcal" ? 1 : 0}" max="10000" step="any" required`,
          "number",
        ),
      )
      .join(
        "",
      )}</div><label class="field"><span>Calidad del dato nutricional</span><select name="nutrition_status"><option value="estimated" ${r.nutrition_status === "estimated" ? "selected" : ""}>Estimado</option><option value="verified" ${r.nutrition_status === "verified" ? "selected" : ""}>Verificado con fuente</option></select></label>${field("Fuente de los macros / marcas utilizadas", "nutrition_source", r.nutrition_source)}<h3 class="gap">Ingredientes de la receta base</h3><p class="editor-help">Nombre · cantidad · unidad · sección de compra. Usa siempre el mismo nombre para sumar correctamente la compra.</p>${r.ingredients.map((i, index) => `<div class="editor-row" data-ingredient="${esc(i.id)}"><input data-key="name" aria-label="Nombre ingrediente ${index + 1}" placeholder="Leche" value="${esc(i.name)}" required><input data-key="quantity" aria-label="Cantidad ingrediente ${index + 1}" type="number" min="0.001" step="any" value="${i.quantity}" required><input data-key="unit" aria-label="Unidad ingrediente ${index + 1}" placeholder="ml" value="${esc(i.unit)}"><input class="ingredient-group" data-key="group" aria-label="Sección de compra" placeholder="Lácteos" value="${esc(i.group)}"><input class="ingredient-components" data-key="components" aria-label="Componentes del ingrediente" placeholder="Componentes de salsas o mezclas (opcional, separados por comas)" value="${esc((i.components || []).join(", "))}">${btn(icon("close"), "remove-ingredient", "icon ghost remove-ingredient", `data-index="${index}" aria-label="Eliminar ingrediente"`)}</div>`).join("")}${btn(`${icon("plus")} Ingrediente`, "add-ingredient", "ghost")}<h3 class="gap">Pasos que te acompañan</h3><p class="editor-help">Pon primero las tareas largas. Inserta ingredientes con los botones: se sustituirán por su cantidad y nombre al cocinar. Si repartes uno entre pasos, indica el porcentaje usado en cada paso; deben sumar 100 %.</p>${r.steps.map((s, index) => `<section class="editor-step" data-step="${index}"><div class="flex between"><strong class="small">Paso ${index + 1}</strong><div class="flex">${btn("↑", "move-step", "icon ghost", `data-index="${index}" data-dir="-1" aria-label="Subir paso" ${index === 0 ? "disabled" : ""}`)}${btn("↓", "move-step", "icon ghost", `data-index="${index}" data-dir="1" aria-label="Bajar paso" ${index === r.steps.length - 1 ? "disabled" : ""}`)}${btn(icon("close"), "remove-step", "icon ghost", `data-index="${index}" aria-label="Eliminar paso"`)}</div></div><label class="field"><span>Instrucciones</span><textarea data-key="text" required placeholder="Añade {{i0}} y remueve…">${esc(s.text)}</textarea></label><div class="flex wrap">${r.ingredients.map((i) => btn(`+ ${esc(i.name || i.id)}`, "insert-token", "insert-token", `data-index="${index}" data-id="${esc(i.id)}"`)).join("")}</div>${[...new Set([...s.text.matchAll(/\{\{([\w-]+)\}\}/g)].map((x) => x[1]))].map((id) => `<label class="fraction-row">${esc(r.ingredients.find((i) => i.id === id)?.name || id)}<input type="number" min="0.1" max="100" step="any" data-fraction="${esc(id)}" value="${(s.uses?.[id] ?? 1) * 100}">% de la cantidad</label>`).join("")}<div class="step-extra gap"><label class="field"><span>Timer (min)</span><input data-key="timer_minutes" type="number" min="0" max="1440" step="any" value="${s.timer_minutes || 0}"></label><label class="field"><span>Mientras tanto…</span><input data-key="parallel" value="${esc(s.parallel || "")}" placeholder="Continúa con el siguiente paso"></label></div><label class="field"><span>Imagen del paso (URL HTTPS o archivo subido)</span><input data-key="image" value="${esc(s.image || "")}"></label><input type="file" data-step-upload="${index}" data-upload-target="image" accept="image/jpeg,image/png,image/webp" aria-label="Subir imagen del paso"><label class="field gap"><span>Vídeo del paso (URL directa)</span><input data-key="video" value="${esc(s.video || "")}"></label><input type="file" data-step-upload="${index}" data-upload-target="video" accept="video/mp4,video/webm" aria-label="Subir vídeo del paso"></section>`).join("")}${btn(`${icon("plus")} Añadir paso`, "add-step", "ghost")}<h3 class="gap">Conservación</h3><label class="check-label"><input name="freezable" type="checkbox" ${r.freezable ? "checked" : ""}>Se puede congelar</label>${field("Conservación en congelador (días)", "freezer_days", r.freezer_days || 60, 'min="1" max="730"', "number")}${field("Cómo descongelar", "thaw", r.thaw)}${field("Cómo recalentar", "reheat", r.reheat)}<div class="dialog-foot">${r.id ? btn("Eliminar", "delete-recipe", "danger", `data-id="${esc(r.id)}"`) : ""}<button class="primary" type="submit">${icon("check")} Guardar receta</button></div></form>`,
  );
}
function readEditor() {
  const f = $("#recipe-form");
  if (!f) return;
  const data = new FormData(f);
  const r = { ...editDraft };
  for (const k of [
    "title",
    "description",
    "category",
    "image",
    "video",
    "source",
    "thaw",
    "reheat",
    "nutrition_status",
    "nutrition_source",
  ])
    r[k] = data.get(k);
  for (const k of ["servings", "minutes", "freezer_days"])
    r[k] = Number(data.get(k));
  r.tags = splitList(data.get("tags"));
  r.meal_types = data.getAll("meal_types");
  r.freezable = data.has("freezable");
  r.nutrition = Object.fromEntries(
    ["kcal", "protein", "carbs", "fat"].map((k) => [
      k,
      data.get(`nutrition_${k}`) === ""
        ? ""
        : Number(data.get(`nutrition_${k}`)),
    ]),
  );
  r.ingredients = $$("[data-ingredient]", f).map((row) => ({
    id: row.dataset.ingredient,
    ...Object.fromEntries(
      $$("[data-key]", row).map((el) => [
        el.dataset.key,
        el.dataset.key === "quantity"
          ? Number(el.value)
          : el.dataset.key === "components"
            ? splitList(el.value)
            : el.value,
      ]),
    ),
  }));
  r.steps = $$("[data-step]", f).map((row) => ({
    ...Object.fromEntries(
      $$("[data-key]", row).map((el) => [
        el.dataset.key,
        el.dataset.key === "timer_minutes" ? Number(el.value) : el.value,
      ]),
    ),
    uses: Object.fromEntries(
      $$("[data-fraction]", row).map((el) => [
        el.dataset.fraction,
        Number(el.value) / 100,
      ]),
    ),
  }));
  editDraft = r;
}
function importDialog() {
  openModal(
    "Añade recetas a tu mesa",
    `<p class="muted small">Importa el JSON preparado a partir de tus textos, capturas o enlaces. Las recetas se añaden como nuevas, sin reemplazar las existentes.</p><form id="import-form"><label class="field"><span>Archivo JSON</span><input id="import-file" type="file" accept=".json,application/json"></label><label class="field"><span>O pega el JSON aquí</span><textarea id="import-json" rows="8" placeholder='{"recipes": [...]}'></textarea></label><a class="small" href="recipe-example.json" download>Descargar un ejemplo con el formato completo</a><div class="dialog-foot"><button class="primary" type="submit">Importar recetas</button></div></form>`,
  );
}
function enableAudio() {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume().catch(() => {});
  } catch {}
  if ("wakeLock" in navigator)
    navigator.wakeLock.request("screen").catch(() => {});
}
function beep() {
  if (!audio || audio.state !== "running") return;
  for (let i = 0; i < 3; i++) {
    const osc = audio.createOscillator(),
      gain = audio.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.12, audio.currentTime + i * 0.4);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      audio.currentTime + i * 0.4 + 0.25,
    );
    osc.connect(gain).connect(audio.destination);
    osc.start(audio.currentTime + i * 0.4);
    osc.stop(audio.currentTime + i * 0.4 + 0.3);
  }
  navigator.vibrate?.([200, 100, 200]);
}
const sounded = new Set();
let timerMarkupKey = "";
function renderTimers() {
  if (!state) return;
  const timers = state.timers.filter((t) => t.status !== "dismissed");
  const views = timers.map((t) => {
    const seconds = Math.max(
        0,
        Math.ceil((t.ends_at - Date.now() - clockOffset) / 1000),
      ),
      done = t.status === "finished" || seconds === 0;
    if (done && !sounded.has(t.id)) {
      sounded.add(t.id);
      beep();
    }
    return {
      t,
      done,
      destination: timerDestination(t),
      text: done
        ? "¡Listo!"
        : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`,
    };
  });
  const key = JSON.stringify(
    views.map(({ t, done, destination }) => [
      t.id,
      t.label,
      done,
      t.notification,
      t.error,
      destination?.r.id,
      destination?.index,
    ]),
  );
  if (key !== timerMarkupKey) {
    $("#timer-tray").innerHTML = views
      .map(
        ({ t, done, destination, text }) =>
          `<div class="timer-pill ${done ? "finished" : ""}"><button class="timer-open" data-action="open-timer" data-id="${esc(t.id)}" aria-label="${esc(destination ? (destination.index >= 0 ? `Abrir ${destination.r.title}, paso ${destination.index + 1}` : `Revisar ${destination.r.title}`) : `Abrir origen de ${t.label}`)}">${icon("clock")}<span class="grow"><span class="timer-name">${esc(destination?.r.title || t.label)}</span>${destination ? `<span class="timer-step">${destination.index >= 0 ? `Paso ${destination.index + 1}${t.custom ? " · Extra" : ""}` : "Revisar receta"}</span>` : ""}<strong data-countdown="${esc(t.id)}">${text}</strong></span></button>${t.notification === "failed" ? `<div class="timer-error">${esc(t.error)}</div>` : ""}${done && t.notification === "pending" ? '<span class="small muted">Enviando aviso…</span>' : ""}${btn(icon("close"), "dismiss-timer", "icon ghost", `data-id="${esc(t.id)}" aria-label="${done ? "Cerrar" : "Cancelar"} temporizador"`)}</div>`,
      )
      .join("");
    timerMarkupKey = key;
  } else {
    const countdowns = $$("[data-countdown]", $("#timer-tray"));
    for (const { t, text } of views) {
      const el = countdowns.find((el) => el.dataset.countdown === t.id);
      if (el) el.textContent = text;
    }
  }
}
function go(id) {
  location.hash = id;
}
async function savePlan(p) {
  const old = plan();
  await api("plan", { ...p, _rev: old?._rev || 0 });
  await refresh();
}
async function runAction(action, el) {
  const d = el.dataset;
  if (action.startsWith("go-")) return go(action.slice(3));
  switch (action) {
    case "close-modal":
      modal.close();
      return;
    case "filter":
      filter = d.value;
      render();
      return;
    case "open-recipe":
      if (modal.open) modal.close();
      currentRecipe = d.id;
      servings = Number(d.servings) || state.settings.servings;
      go(`detail/${encodeURIComponent(d.id)}`);
      return;
    case "new-recipe":
      editorDialog();
      return;
    case "edit-recipe":
      editorDialog(recipe(d.id));
      return;
    case "favorite": {
      const r = recipe(d.id);
      await api("recipe", { ...r, favorite: !r.favorite });
      await refresh();
      return;
    }
    case "start-cook":
      enableAudio();
      cookIndex = Number(
        sessionStorage.getItem(`mesa-step-${currentRecipe}`) || 0,
      );
      go(`cook/${encodeURIComponent(currentRecipe)}`);
      return;
    case "back-detail":
      go(`detail/${encodeURIComponent(currentRecipe)}`);
      return;
    case "cook-prev":
      cookIndex = Math.max(0, cookIndex - 1);
      sessionStorage.setItem(`mesa-step-${currentRecipe}`, cookIndex);
      render();
      return;
    case "cook-next":
      if (cookIndex < recipe(currentRecipe).steps.length - 1) {
        cookIndex++;
        sessionStorage.setItem(`mesa-step-${currentRecipe}`, cookIndex);
        render();
        window.scrollTo(0, 0);
      } else {
        sessionStorage.removeItem(`mesa-step-${currentRecipe}`);
        go(`detail/${encodeURIComponent(currentRecipe)}`);
        toast("¡A disfrutar de la mesa!");
      }
      return;
    case "start-timer":
      enableAudio();
      await api("timer", {
        recipe_id: d.recipeId,
        step_index: Number(d.stepIndex),
        servings: Number(d.servings),
        seconds: Number(d.minutes) * 60,
      });
      await refresh(false);
      toast("Temporizador en marcha");
      return;
    case "custom-timer":
      customTimerDialog(d.recipeId, Number(d.stepIndex), Number(d.servings));
      return;
    case "preset-timer":
      $('#custom-timer-form [name="minutes"]').value = d.minutes;
      $('#custom-timer-form [name="seconds"]').value = 0;
      return;
    case "open-timer": {
      const t = state.timers.find((t) => t.id === d.id),
        destination = t && timerDestination(t);
      if (!destination)
        return toast("La receta de este contador ya no está disponible.");
      if (modal.open) modal.close();
      currentRecipe = destination.r.id;
      servings = t.servings || state.settings.servings;
      if (destination.index < 0) {
        go(`detail/${encodeURIComponent(currentRecipe)}`);
        return toast("El paso ha cambiado. Revisa la receta para continuar.");
      }
      cookIndex = destination.index;
      sessionStorage.setItem(`mesa-step-${currentRecipe}`, cookIndex);
      const target = `cook/${encodeURIComponent(currentRecipe)}/${cookIndex}`;
      if (location.hash === `#${target}`) {
        route = "cook";
        render();
        window.scrollTo(0, 0);
      } else go(target);
      return;
    }
    case "dismiss-timer":
      await api("timer/dismiss", { id: d.id });
      await refresh(false);
      return;
    case "prev-week":
      week = shiftDate(week, -7);
      render();
      return;
    case "next-week":
      week = shiftDate(week, 7);
      render();
      return;
    case "current-week":
      week = monday();
      render();
      return;
    case "generate-dialog":
      if (modal.open) modal.close();
      generatorDialog();
      return;
    case "save-proposal":
      await savePlan(pendingPlan);
      modal.close();
      toast("Semana guardada. La compra ya está preparada.");
      return;
    case "edit-meal":
      mealDialog(Number(d.day), Number(d.slot));
      return;
    case "consume":
      await api("consume", {
        week,
        day: Number(d.day),
        slot: Number(d.slot),
        _rev: plan()?._rev,
      });
      await refresh();
      toast("Raciones descontadas del congelador");
      return;
    case "copy-week":
      openModal(
        "Repetir una buena semana",
        `<form id="copy-week-form"><label class="field"><span>Semana de origen</span><select name="from" required>${state.plans
          .filter((p) => p.week !== week)
          .sort((a, b) => b.week.localeCompare(a.week))
          .map(
            (p) =>
              `<option value="${p.week}">${niceDate(p.week)} – ${niceDate(shiftDate(p.week, 6))}</option>`,
          )
          .join(
            "",
          )}</select></label><p class="muted small">Se copian los platos y las raciones. Las comidas del congelador pasan a «Cocinar» para revisar las existencias.</p><div class="dialog-foot"><button class="primary" type="submit">Revisar copia</button></div></form>`,
      );
      return;
    case "copy-shopping": {
      const s = shop(),
        rows = [...shopping(), ...s.extra].filter(
          (i) => !$("#copy-unchecked").checked || !s.checked.includes(i.key),
        );
      const text = `Compra · ${niceDate(week)} – ${niceDate(shiftDate(week, 6))}\n\n${rows.map((i) => `${i.name} — ${n(i.quantity)} ${i.unit}`).join("\n")}`;
      try {
        await navigator.clipboard.writeText(text);
        toast("Lista copiada. Ya puedes pegarla en Google Keep.");
      } catch {
        openModal(
          "Copia tu lista",
          `<label class="field"><span>Selecciona y copia el texto</span><textarea rows="15" readonly>${esc(text)}</textarea></label>`,
        );
        $("textarea", modal).select();
      }
      return;
    }
    case "clear-extra":
      await api("shop", { ...shop(), extra: [] });
      await refresh();
      return;
    case "new-stock":
      stockDialog(null, d.id);
      return;
    case "edit-stock":
      stockDialog(d.id);
      return;
    case "accent":
      $("#settings-form").dataset.dirty = "true";
      $('[name="accent"]').value = d.color;
      accent(d.color);
      $$(".swatch").forEach((b) => {
        b.classList.toggle("selected", b.dataset.color === d.color);
        b.innerHTML = b.dataset.color === d.color ? icon("check") : "";
      });
      return;
    case "load-android": {
      const rows = await api("android");
      const selected = $$('[name="notify_services"]:checked').map(
        (el) => el.value,
      );
      $("#android-services").innerHTML =
        [...new Set([...rows, ...selected])]
          .map(
            (x) =>
              `<label class="check-label small"><input type="checkbox" name="notify_services" value="${esc(x)}" ${selected.includes(x) ? "checked" : ""}>${esc(x.replace("mobile_app_", ""))}</label>`,
          )
          .join("") ||
        '<p class="muted small">No hay móviles registrados. Abre primero la app Companion en Android.</p>';
      return;
    }
    case "test-android":
      await api("android/test", {});
      toast("Aviso enviado. Comprueba el sonido en los móviles.");
      return;
    case "import-dialog":
      importDialog();
      return;
    case "restore-dialog":
      openModal(
        "Restaurar una copia",
        `<form id="restore-form"><div class="notice error">Esto reemplaza recetas, planes, congelador, compra y ajustes. Descarga antes una copia de tus datos actuales.</div><label class="field"><span>Copia de Mesa (.json)</span><input name="file" type="file" accept=".json" required></label>${field("Escribe RESTAURAR para continuar", "confirm", "", 'required pattern="RESTAURAR"')}<div class="dialog-foot"><button class="danger" type="submit">Restaurar datos</button></div></form>`,
      );
      return;
    case "add-ingredient":
      readEditor();
      editDraft.ingredients.push({
        id: `i${Date.now()}`,
        name: "",
        quantity: 1,
        unit: "g",
        group: "Otros",
      });
      drawEditor();
      return;
    case "remove-ingredient":
      readEditor();
      editDraft.ingredients.splice(Number(d.index), 1);
      drawEditor();
      return;
    case "add-step":
      readEditor();
      editDraft.steps.push({
        text: "",
        timer_minutes: 0,
        parallel: "",
        uses: {},
      });
      drawEditor();
      return;
    case "remove-step":
      readEditor();
      editDraft.steps.splice(Number(d.index), 1);
      drawEditor();
      return;
    case "move-step":
      readEditor();
      {
        const i = Number(d.index),
          j = i + Number(d.dir);
        [editDraft.steps[i], editDraft.steps[j]] = [
          editDraft.steps[j],
          editDraft.steps[i],
        ];
        drawEditor();
      }
      return;
    case "insert-token":
      {
        const text = $(`[data-step="${d.index}"] textarea`),
          pos = text.selectionStart;
        text.value =
          text.value.slice(0, pos) +
          `{{${d.id}}}` +
          text.value.slice(text.selectionEnd);
        readEditor();
        drawEditor();
        $(`[data-step="${d.index}"] textarea`).focus();
      }
      return;
    case "delete-recipe":
      if (!confirm("¿Eliminar esta receta?")) return;
      await api("recipe/delete", { id: editDraft.id, _rev: editDraft._rev });
      modal.close();
      go("recipes");
      await refresh();
      return;
  }
}
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || busy) return;
  e.preventDefault();
  busy = true;
  try {
    await runAction(el.dataset.action, el);
  } catch (err) {
    if (modal.open) dialogError(err);
    else toast(err.message);
  } finally {
    busy = false;
  }
});
document.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;
  busy = true;
  const form = e.target;
  const submit = $('[type="submit"]', form);
  if (submit) submit.disabled = true;
  try {
    const f = new FormData(form);
    if (form.id === "custom-timer-form") {
      const minutes = Number(f.get("minutes")),
        seconds = Number(f.get("seconds"));
      if (
        !Number.isInteger(minutes) ||
        !Number.isInteger(seconds) ||
        minutes < 0 ||
        seconds < 0 ||
        seconds > 59 ||
        minutes * 60 + seconds < 1 ||
        minutes * 60 + seconds > 86400
      )
        throw new Error("Indica un tiempo entre 1 segundo y 24 horas.");
      enableAudio();
      await api("timer", {
        recipe_id: form.dataset.recipeId,
        step_index: Number(form.dataset.stepIndex),
        servings: Number(form.dataset.servings),
        seconds: minutes * 60 + seconds,
        custom: true,
      });
      modal.close();
      await refresh(false);
      toast("Temporizador adicional en marcha");
    }
    if (form.id === "settings-form") {
      await api("settings", readSettings(form));
      await refresh();
      toast("Ajustes guardados");
    }
    if (form.id === "generate-form") {
      const p = await api("generate", {
        week,
        options: readSettings(form),
        use_freezer: f.has("use_freezer"),
      });
      modal.close();
      proposalDialog(p);
    }
    if (form.id === "meal-form") {
      const p = structuredClone(
        plan() || {
          week,
          entries: [],
          menu_count: state.settings.menu_count,
          targets: { kcal_max: state.settings.kcal_max },
        },
      );
      const day = Number(form.dataset.day),
        slot = Number(form.dataset.slot),
        id = f.get("recipe_id"),
        stockId = f.get("stock_id");
      p.entries = p.entries.filter((e) => e.day !== day || e.slot !== slot);
      if (id)
        p.entries.push({
          day,
          slot,
          recipe_id: id === "outside" ? null : id,
          servings: Number(f.get("servings")),
          source: id === "outside" ? "outside" : stockId ? "freezer" : "cook",
          stock_id: id === "outside" ? null : stockId || null,
          consumed: false,
        });
      await savePlan(p);
      modal.close();
      toast("Comida actualizada");
    }
    if (form.id === "copy-week-form") {
      const p = await api("plan/copy", { from: f.get("from"), week });
      modal.close();
      proposalDialog(p);
    }
    if (form.id === "extra-form") {
      const s = shop();
      await api("shop", {
        ...s,
        extra: [
          ...s.extra,
          {
            key: `extra-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`,
            name: f.get("name"),
            quantity: Number(f.get("quantity")),
            unit: f.get("unit"),
          },
        ],
      });
      await refresh();
    }
    if (form.id === "stock-form") {
      const old = state.stock.find((s) => s.id === form.dataset.id);
      await api("stock", {
        ...old,
        recipe_id: old?.recipe_id || f.get("recipe_id"),
        portions: Number(f.get("portions")),
        frozen_on: f.get("frozen_on"),
        note: f.get("note"),
      });
      modal.close();
      await refresh();
      toast("Lote guardado");
    }
    if (form.id === "recipe-form") {
      readEditor();
      const r = await api("recipe", editDraft);
      modal.close();
      currentRecipe = r.id;
      await refresh(false);
      go(`detail/${encodeURIComponent(r.id)}`);
      render();
      toast("Receta guardada");
    }
    if (form.id === "import-form") {
      const file = $("#import-file").files[0];
      const value = JSON.parse(
        file ? await file.text() : $("#import-json").value,
      );
      const result = await api("import", value);
      modal.close();
      await refresh();
      toast(`${result.imported} recetas importadas`);
    }
    if (form.id === "restore-form") {
      const file = f.get("file");
      const value = JSON.parse(await file.text());
      await api("restore", { ...value, confirm: f.get("confirm") });
      modal.close();
      await refresh();
      toast("Copia restaurada");
    }
  } catch (err) {
    if (modal.open) dialogError(err);
    else toast(err.message);
  } finally {
    busy = false;
    if (submit?.isConnected) submit.disabled = false;
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "recipe-search") {
    const pos = e.target.selectionStart;
    query = e.target.value;
    render();
    const input = $("#recipe-search");
    input.focus();
    try {
      input.setSelectionRange(pos, pos);
    } catch {}
  }
  if (e.target.name === "accent") accent(e.target.value);
});
document.addEventListener("change", async (e) => {
  const el = e.target;
  try {
    if (el.id === "servings") {
      servings = Math.max(1, Math.min(100, Number(el.value) || 1));
      render();
    }
    if (el.dataset.shopKey) {
      const s = shop();
      await api("shop", {
        ...s,
        checked: el.checked
          ? [...new Set([...s.checked, el.dataset.shopKey])]
          : s.checked.filter((k) => k !== el.dataset.shopKey),
      });
      await refresh();
    }
    if (el.dataset.batchKey) {
      el.checked
        ? batchDone.add(el.dataset.batchKey)
        : batchDone.delete(el.dataset.batchKey);
      sessionStorage.setItem("mesa-batch", JSON.stringify([...batchDone]));
      el.closest(".batch-task").classList.toggle("done", el.checked);
    }
    if (el.dataset.uploadTarget && el.files[0]) {
      const file = el.files[0];
      if (file.size > 30 * 1024 * 1024)
        throw new Error("El archivo supera 30 MB");
      busy = true;
      toast("Subiendo archivo…");
      const r = await fetch("api/upload", {
        method: "POST",
        headers: { "Content-Type": file.type, "X-Mesa-Upload": "1" },
        body: file,
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      const target =
        el.dataset.stepUpload !== undefined
          ? $(
              `[data-step="${el.dataset.stepUpload}"] [data-key="${el.dataset.uploadTarget}"]`,
            )
          : $(`[name="${el.dataset.uploadTarget}"]`);
      target.value = b.url;
      toast("Archivo subido");
    }
  } catch (err) {
    if (modal.open) dialogError(err);
    else toast(err.message);
    await refresh(false);
  } finally {
    busy = false;
  }
});
function readRoute() {
  const [name, id, step] = location.hash.slice(1).split("/");
  route = name || "recipes";
  if (id) currentRecipe = decodeURIComponent(id);
  if (name === "cook" && /^\d+$/.test(step || "")) cookIndex = Number(step);
  render();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", readRoute);
modal.addEventListener("close", () => {
  if (state) accent(state.settings.accent);
});
try {
  batchDone = new Set(JSON.parse(sessionStorage.getItem("mesa-batch") || "[]"));
  await refresh(false);
  servings = state.settings.servings;
  readRoute();
} catch (e) {
  app.innerHTML = `<div class="loading"><h2>No se ha podido conectar</h2><p>${esc(e.message)}</p><a href="">Volver a intentar</a></div>`;
}
setInterval(renderTimers, 1000);
setInterval(async () => {
  if (
    !state ||
    busy ||
    modal.open ||
    (route === "settings" && $("#settings-form")?.dataset.dirty)
  )
    return;
  try {
    const before = JSON.stringify([
      state.recipes,
      state.plans,
      state.stock,
      state.shops,
      state.settings,
    ]);
    await refresh(false);
    const after = JSON.stringify([
      state.recipes,
      state.plans,
      state.stock,
      state.shops,
      state.settings,
    ]);
    if (
      before !== after &&
      !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)
    )
      render();
  } catch {}
}, 5000);
document.addEventListener("input", (e) => {
  if (e.target.closest("#settings-form"))
    $("#settings-form").dataset.dirty = "true";
});
document.addEventListener("change", (e) => {
  if (e.target.closest("#settings-form"))
    $("#settings-form").dataset.dirty = "true";
});
