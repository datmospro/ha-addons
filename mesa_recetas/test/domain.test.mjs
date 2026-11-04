import test from 'node:test';
import assert from 'node:assert/strict';
import { seedRecipes } from '../seed.mjs';
import { DEFAULTS, validateRecipe, validateSettings, generatePlan, allocateFreezer, shopping, stepText, validatePlan } from '../domain.mjs';
const recipes = seedRecipes();
test('Las cantidades de los pasos escalan con las raciones', () => {
  const r = recipes.find(r => r.id === 'bowl');
  assert.match(stepText(r, r.steps[0], 3), /210 g de quinoa/);
  assert.match(stepText(r, r.steps[0], 3), /420 ml de agua/);
  assert.match(stepText(r, r.steps[1], 5), /750 g de pechuga de pollo/);
});
test('Un ingrediente repartido debe sumar el 100 % y se escala su fracción', () => {
  const r = structuredClone(recipes[0]); r.steps.push({ text: 'Reserva {{i0}}', uses: { i0: .25 } });
  assert.throws(() => validateRecipe(r), /100 %/);
  r.steps[0].uses.i0 = .75;
  const valid = validateRecipe(r);
  assert.match(stepText(valid, valid.steps.at(-1), 4), /50 g de copos/);
});
test('No admite macros incompletos, ingredientes sin pasos ni medios ejecutables', () => {
  const r = structuredClone(recipes[0]); delete r.nutrition.protein;
  assert.throws(() => validateRecipe(r));
  assert.throws(() => validateRecipe({ ...recipes[0], image: 'javascript:alert(1)' }));
  assert.throws(() => validateRecipe({ ...recipes[0], steps: [{ text: 'Cocina' }] }), /100 %/);
});
test('Generador respeta kcal, proteína, exclusiones y rotación A B C', () => {
  const p = generatePlan(recipes, { ...DEFAULTS, kcal_max: 1800, protein_min: 95, excluded: ['SALMÓN', 'nueces'] }, '2026-11-02');
  assert.equal(p.entries.length, 28);
  for (let day = 0; day < 7; day++) {
    const rows = p.entries.filter(e => e.day === day).map(e => recipes.find(r => r.id === e.recipe_id));
    assert.ok(rows.reduce((s, r) => s + r.nutrition.kcal, 0) <= 1800);
    assert.ok(rows.reduce((s, r) => s + r.nutrition.protein, 0) >= 95);
    assert.ok(rows.every(r => !['salmon', 'merienda-yogur'].includes(r.id)));
  }
  for (let slot = 0; slot < 4; slot++) assert.equal(p.entries.find(e => e.day === 0 && e.slot === slot).recipe_id, p.entries.find(e => e.day === 3 && e.slot === slot).recipe_id);
});
test('Límites imposibles y ausencia de recetas producen un error, sin saltarse restricciones', () => {
  assert.throws(() => generatePlan(recipes, { ...DEFAULTS, kcal_max: 100 }, '2026-11-02'), /No hay combinación/);
  assert.throws(() => generatePlan([], DEFAULTS, '2026-11-02'), /Faltan recetas/);
});
test('Aprovecha lotes con raciones suficientes, respeta reservas y evita lotes caducados', () => {
  const p = { week: '2026-11-02', entries: [0, 1, 2].map(day => ({ day, slot: 1, recipe_id: 'bowl', servings: 3, source: 'cook', stock_id: null })) };
  const stock = [{ id: 'caducado', recipe_id: 'bowl', portions: 20, frozen_on: '2026-01-01', expires_on: '2026-10-01' }, { id: 'disponible', recipe_id: 'bowl', portions: 9, frozen_on: '2026-11-01', expires_on: '2026-12-01' }];
  const previous = [{ week: '2026-11-09', entries: [{ source: 'freezer', stock_id: 'disponible', servings: 3, consumed: false }] }];
  const allocated = allocateFreezer(p, stock, previous);
  assert.deepEqual(allocated.entries.map(e => e.source), ['freezer', 'freezer', 'cook']);
  assert.equal(allocated.entries[0].stock_id, 'disponible');
});
test('Configuración impide menús fraccionarios y macros verificados sin fuente', () => {
  assert.throws(() => validateSettings({ ...DEFAULTS, menu_count: 2.5 }), /entero/);
  assert.throws(() => validateRecipe({ ...recipes[0], nutrition_status: 'verified', nutrition_source: '' }), /fuente/);
});
test('Compra suma unidades compatibles, escala raciones y excluye congelador', () => {
  const r = structuredClone(recipes[0]); r.id = 'kg'; r.ingredients = [{ id: 'i0', name: 'Copos de avena', quantity: .05, unit: 'kg', group: 'Cereales' }];
  const p = { entries: [{ recipe_id: recipes[0].id, servings: 3, source: 'cook' }, { recipe_id: 'kg', servings: 2, source: 'cook' }, { recipe_id: recipes[0].id, servings: 7, source: 'freezer' }] };
  assert.equal(shopping(p, [...recipes, r]).find(i => i.key === 'copos de avena|g').quantity, 250);
});
test('Reserva de congelador tiene en cuenta otras semanas', () => {
  const stock = [{ id: 'lot', recipe_id: 'bowl', portions: 5 }];
  const p = { week: '2026-11-02', menu_count: 3, entries: [{ day: 0, slot: 1, source: 'freezer', stock_id: 'lot', recipe_id: 'bowl', servings: 3 }] };
  const other = { week: '2026-11-09', entries: [{ ...p.entries[0], servings: 3 }] };
  assert.throws(() => validatePlan(p, recipes, stock, [other]), /suficientes/);
  assert.doesNotThrow(() => validatePlan(p, recipes, stock, []));
  assert.throws(() => validatePlan({ ...p, week: '2026-11-03' }, recipes, stock), /lunes/);
});
