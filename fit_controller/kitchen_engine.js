// Shared, deterministic recipe quantities. Nutrition is always per serving.
const crypto = require('node:crypto');
const DAYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const MEALS = ['desayuno', 'almuerzo', 'merienda', 'cena', 'snack'];
const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
function number(value, label, min = 0, max = 100000) {
  const n = Number(typeof value === 'string' ? value.replace(',', '.') : value);
  if (value === '' || value == null || !Number.isFinite(n) || n < min || n > max) throw new Error(`${label}: introduce un número entre ${min} y ${max}.`);
  return n;
}
function quantity(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? { amount: raw, unit: '' } : null;
  let s = String(raw ?? '').trim().replace(/,/g, '.').replace(/½/g, ' 1/2').replace(/¼/g, ' 1/4').replace(/¾/g, ' 3/4').trim();
  const match = s.match(/^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)(?:\s+([^\d].*))?$/);
  if (match && Number(match[3])) return { amount: Number(match[1] || 0) + Number(match[2]) / Number(match[3]), unit: (match[4] || '').trim() };
  const decimal = s.match(/^(\d+(?:\.\d+)?)(?:\s*([a-zA-Záéíóúñµ]+\.?))?$/);
  return decimal ? { amount: Number(decimal[1]), unit: decimal[2] || '' } : null;
}
const UNITS = {
  g: ['g', 1], gr: ['g', 1], gramo: ['g', 1], gramos: ['g', 1], gram: ['g', 1], grams: ['g', 1],
  kg: ['g', 1000], kilogramo: ['g', 1000], kilogramos: ['g', 1000],
  ml: ['ml', 1], mililitros: ['ml', 1], l: ['ml', 1000], litro: ['ml', 1000], litros: ['ml', 1000],
  ud: ['ud', 1], uds: ['ud', 1], unidad: ['ud', 1], unidades: ['ud', 1], unit: ['ud', 1],
  cucharada: ['cda', 1], cucharadas: ['cda', 1], tbsp: ['cda', 1], cda: ['cda', 1],
  cucharadita: ['cdta', 1], cucharaditas: ['cdta', 1], tsp: ['cdta', 1], cdta: ['cdta', 1],
  taza: ['taza', 1], tazas: ['taza', 1], cup: ['taza', 1], cups: ['taza', 1]
};
function ingredient(raw) {
  if (typeof raw === 'string') {
    const split = raw.indexOf(':');
    raw = split < 0 ? { name: raw, amount: 'al gusto' } : { name: raw.slice(0, split), amount: raw.slice(split + 1).trim() };
  }
  if (!raw || typeof raw !== 'object' || !String(raw.name || '').trim()) throw new Error('Cada ingrediente necesita un nombre.');
  if (typeof raw.amount === 'number' && (!Number.isFinite(raw.amount) || raw.amount < 0)) throw new Error('La cantidad de un ingrediente no puede ser negativa ni infinita.');
  const parsed = quantity(raw.amount);
  const statedUnit = String(raw.unit || '').trim();
  // Do not silently pick one of two conflicting units.
  const conflict = parsed?.unit && statedUnit && fold(parsed.unit) !== fold(statedUnit);
  return {
    name: String(raw.name).trim().slice(0, 200), amount: parsed && !conflict ? parsed.amount : String(raw.amount ?? 'al gusto').slice(0, 120),
    unit: parsed && !conflict ? (statedUnit || parsed.unit) : statedUnit,
    group: String(raw.group || '').slice(0, 60), optional: raw.optional === true,
    fresh: raw.fresh === true
  };
}
function scaledIngredients(recipe, portions) {
  const list = recipe.ingredients || JSON.parse(recipe.ingredients_json || '[]');
  const factor = portions / (recipe.ingredients_basis === 'recipe' ? Number(recipe.servings) || 1 : 1);
  return list.map(raw => {
    const ing = ingredient(raw);
    return { ...ing, amount: typeof ing.amount === 'number' ? round(ing.amount * factor) : ing.amount };
  });
}
function safeUrl(value, image = false) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (image && /^uploads\/(photos|recipes)\/[\w.-]+$/.test(s)) return s;
  try { const u = new URL(s); if (['https:', 'http:'].includes(u.protocol) && !u.username && !u.password) return u.href; } catch {}
  throw new Error('Usa una URL http o https válida.');
}
function normalizeRecipe(input, existing = {}) {
  const r = { ...existing, ...input };
  if (!String(r.title || '').trim()) throw new Error('La receta necesita un título.');
  const ingredients = r.ingredients ?? JSON.parse(r.ingredients_json || '[]');
  const rawInstructions = r.instructions ?? JSON.parse(r.instructions_json || '[]');
  const instructions = typeof rawInstructions === 'string' ? rawInstructions.split('\n') : rawInstructions;
  if (!Array.isArray(ingredients) || ingredients.length > 200) throw new Error('Ingredientes: se espera una lista de hasta 200 elementos.');
  if (!Array.isArray(instructions) || instructions.length > 100) throw new Error('Preparación: se espera una lista de pasos.');
  const category = r.category || 'almuerzo';
  if (!MEALS.includes(category)) throw new Error('Categoría no válida.');
  const basis = r.ingredients_basis || 'portion';
  if (!['portion', 'recipe'].includes(basis)) throw new Error('Indica si las cantidades son por ración o receta completa.');
  const freezer = r.freezer || 'unknown';
  if (!['yes', 'components', 'no', 'unknown'].includes(freezer)) throw new Error('Conservación no válida.');
  const nutrition = r.nutrition_source || (r.kcal == null ? 'unknown' : 'author');
  if (!['author', 'estimated', 'unknown'].includes(nutrition)) throw new Error('Origen de los macros no válido.');
  return {
    title: String(r.title).trim().slice(0, 200), description: String(r.description || '').slice(0, 2000), category,
    prep_time_min: number(r.prep_time_min ?? 30, 'Minutos', 1, 1440), servings: number(r.servings ?? 1, 'Raciones de la receta', 0.1, 1000),
    ...Object.fromEntries(['kcal', 'protein', 'carbs', 'fat', 'fiber'].map(key => [key, number(r[key] ?? 0, key, 0, 20000)])),
    ingredients_json: JSON.stringify(ingredients.map(ingredient)), instructions_json: JSON.stringify(instructions.map(s => String(s).trim()).filter(Boolean)),
    image_url: safeUrl(r.image_url, true), source_url: safeUrl(r.source_url), ingredients_basis: basis,
    freezer, freeze_notes: String(r.freeze_notes || '').slice(0, 3000), reheat_notes: String(r.reheat_notes || '').slice(0, 3000),
    nutrition_source: nutrition, nutrition_notes: String(r.nutrition_notes || '').slice(0, 3000),
    tags: String(r.tags || '').slice(0, 300), rating: ['repeat', 'ok', 'avoid'].includes(r.rating) ? r.rating : '', favorite: r.favorite ? 1 : 0
  };
}
function aisle(ing) {
  if (ing.group) return ing.group;
  const name = fold(ing.name);
  if (/leche de coco|tomate triturado|pimiento asado|zumo/.test(name)) return 'Despensa y otros';
  if (/pollo|pavo|ternera|atun|salmon|merluza|carne|gamba/.test(name)) return 'Carne y pescado';
  if (/yogur|queso|leche|huevo|skyr/.test(name)) return 'Lácteos y huevos';
  if (/tomate|cebolla|pimiento|zanahoria|brocoli|espinaca|lechuga|pepino|calabacin|limon|ajo|patata/.test(name)) return 'Fruta y verdura';
  return 'Despensa y otros';
}
function shoppingList(recipes) {
  const map = new Map();
  for (const { recipe, portions } of recipes) {
    for (const ing of scaledIngredients(recipe, portions)) {
      const unitKey = fold(ing.unit).replace(/\.$/, '');
      const conversion = UNITS[unitKey] || [unitKey, 1];
      const numeric = typeof ing.amount === 'number';
      // Different units and optional ingredients must never be merged together.
      const key = JSON.stringify([fold(ing.name), conversion[0], ing.optional, numeric ? '' : ing.amount]);
      if (!map.has(key)) map.set(key, { key, name: ing.name, amount: numeric ? 0 : ing.amount, unit: conversion[0], optional: ing.optional, group: aisle(ing), recipes: [], needs_review: !numeric || !unitKey || /al gusto|pizca|punado|poco/.test(unitKey) });
      const item = map.get(key);
      if (numeric) item.amount += ing.amount * conversion[1];
      if (!item.recipes.includes(recipe.title)) item.recipes.push(recipe.title);
    }
  }
  return [...map.values()].map(item => ({ ...item, amount: typeof item.amount === 'number' ? round(item.amount) : item.amount,
    displayAmount: `${typeof item.amount === 'number' ? round(item.amount) : item.amount} ${item.unit}`.trim()
  })).sort((a, b) => a.group.localeCompare(b.group, 'es') || a.name.localeCompare(b.name, 'es'));
}
function batchPlan(rows) {
  const grouped = new Map();
  const warnings = [];
  for (const row of rows) {
    if (!row.recipe_id || !row.title) { warnings.push(`${row.day_of_week} · ${row.meal_type}: falta una receta con ingredientes.`); continue; }
    if (!grouped.has(row.recipe_id)) grouped.set(row.recipe_id, { recipe: row, portions: 0, slots: [] });
    const item = grouped.get(row.recipe_id);
    const portions = number(row.people_count || 1, 'Raciones del plato', 1, 100);
    item.portions += portions;
    item.slots.push({ day: row.day_of_week, meal: row.meal_type, portions });
  }
  const groups = [...grouped.values()];
  for (const g of groups) {
    if (!JSON.parse(g.recipe.ingredients_json || '[]').length) warnings.push(`${g.recipe.title}: no tiene ingredientes; la compra está incompleta.`);
    if (!JSON.parse(g.recipe.instructions_json || '[]').length) warnings.push(`${g.recipe.title}: falta la preparación; completa los pasos antes de cocinar.`);
    if (g.recipe.ingredients_basis === 'portion' && g.recipe.servings > 1) warnings.push(`${g.recipe.title}: ingredientes configurados por ración aunque la receta declara ${g.recipe.servings} raciones. Revisa esta base si procede de una importación antigua.`);
    if (g.recipe.freezer === 'unknown' || !g.recipe.freezer) warnings.push(`${g.recipe.title}: revisa si admite congelación.`);
    if (g.recipe.freezer === 'no') warnings.push(`${g.recipe.title}: preparar en el día; no está marcado como congelable.`);
  }
  return {
    portions: groups.reduce((sum, g) => sum + g.portions, 0), warnings,
    shopping: shoppingList(groups),
    dishes: groups.map(g => ({ id: g.recipe.id, title: g.recipe.title, portions: g.portions, slots: g.slots,
      ingredients: scaledIngredients(g.recipe, g.portions), instructions: JSON.parse(g.recipe.instructions_json || '[]'),
      freezer: g.recipe.freezer || 'unknown', freeze_notes: g.recipe.freeze_notes || '', reheat_notes: g.recipe.reheat_notes || '',
      prep_time_min: g.recipe.prep_time_min, nutrition_source: g.recipe.nutrition_source || 'author',
      kcal: g.recipe.kcal, protein: g.recipe.protein, source_url: g.recipe.source_url || ''
    })).sort((a, b) => b.prep_time_min - a.prep_time_min)
  };
}
function fingerprint(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 20); }
module.exports = { DAYS, MEALS, fold, number, quantity, ingredient, scaledIngredients, safeUrl, normalizeRecipe, shoppingList, batchPlan, fingerprint };
