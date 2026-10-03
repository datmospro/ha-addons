const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { quantity, ingredient, normalizeRecipe, scaledIngredients, shoppingList, batchPlan } = require('../kitchen_engine');
const { extractRecipe } = require('../recipe_import');
const recipe = overrides => ({ title: 'Pollo coreano', servings: 10, ingredients_basis: 'recipe', kcal: 450, protein: 45, carbs: 44, fat: 6,
  ingredients: [{ name: 'Pollo', amount: 1700, unit: 'g' }, { name: 'Arroz en seco', amount: 360, unit: 'g' }], instructions: ['Cocinar.'], ...overrides });

test('decimal commas, fractions, mixed and legacy quantities are parsed without losing units', () => {
  assert.deepEqual(quantity('1,5 kg'), { amount: 1.5, unit: 'kg' });
  assert.deepEqual(quantity('1 1/2 taza'), { amount: 1.5, unit: 'taza' });
  assert.deepEqual(quantity('½'), { amount: 0.5, unit: '' });
  assert.equal(quantity('1-2 cucharadas'), null);
  assert.equal(quantity('1/0'), null);
  assert.equal(quantity('-10'), null);
  assert.equal(ingredient({ name: 'Pollo', amount: '200 g', unit: '' }).unit, 'g');
  assert.equal(ingredient({ name: 'Aceite', amount: '5 ml', unit: 'g' }).amount, '5 ml');
});
test('ten-serving recipe scales to two people, while legacy per-serving recipes stay compatible', () => {
  assert.equal(scaledIngredients(recipe(), 2)[0].amount, 340);
  assert.equal(scaledIngredients(recipe(), 2)[1].amount, 72);
  assert.equal(scaledIngredients(recipe({ servings: 10, ingredients_basis: 'portion' }), 2)[0].amount, 3400);
  assert.equal(scaledIngredients({ ingredients_json: '[{"name":"Pollo","amount":"200 g"}]' }, 3)[0].amount, 600);
});
test('shopping combines compatible units, never mass with volume, and flags incomplete quantities', () => {
  const list = shoppingList([{ portions: 2, recipe: { title: 'A', ingredients: [
    { name: 'Arroz', amount: 0.25, unit: 'kg' }, { name: ' arroz ', amount: '100 g' },
    { name: 'Aceite', amount: 10, unit: 'g' }, { name: 'Aceite', amount: 10, unit: 'ml' },
    { name: 'Sal', amount: 'al gusto' }, { name: 'Huevo', amount: 1, unit: '' },
    { name: 'Arroz', amount: 20, unit: 'g', optional: true }
  ] } }]);
  assert.equal(list.find(i => i.name === 'Arroz' && !i.optional).amount, 700);
  assert.equal(list.filter(i => i.name === 'Aceite').length, 2);
  assert.equal(list.find(i => i.name === 'Sal').needs_review, true);
  assert.equal(list.find(i => i.name === 'Huevo').needs_review, true);
  assert.equal(list.find(i => i.optional).amount, 40);
});
test('validation rejects invalid quantities, categories and unsafe links; partial updates preserve metadata', () => {
  assert.throws(() => normalizeRecipe(recipe({ servings: 0 })), /Raciones/);
  assert.throws(() => normalizeRecipe(recipe({ category: 'invalid' })), /Categoría/);
  assert.throws(() => normalizeRecipe(recipe({ image_url: 'javascript:alert(1)' })), /URL/);
  assert.throws(() => normalizeRecipe(recipe({ kcal: 'NaN' })), /kcal/);
  const before = normalizeRecipe(recipe({ freezer: 'components', freeze_notes: 'Salsa aparte' }));
  const after = normalizeRecipe({ favorite: true }, before);
  assert.equal(after.servings, 10); assert.equal(after.freeze_notes, 'Salsa aparte'); assert.equal(after.favorite, 1);
});
test('batch groups the same recipe over several days and keeps per-slot portions', () => {
  const r = normalizeRecipe(recipe({ freezer: 'yes' }));
  const result = batchPlan([
    { ...r, id: 1, recipe_id: 1, day_of_week: 'lunes', meal_type: 'almuerzo', people_count: 2 },
    { ...r, id: 1, recipe_id: 1, day_of_week: 'martes', meal_type: 'cena', people_count: 3 },
    { recipe_id: null, day_of_week: 'viernes', meal_type: 'cena' }
  ]);
  assert.equal(result.portions, 5); assert.equal(result.dishes.length, 1);
  assert.equal(result.dishes[0].ingredients[0].amount, 850);
  assert.equal(result.dishes[0].slots[1].portions, 3); assert.equal(result.warnings.length, 1);
});
test('AI extraction uses structured image input, does not fetch source URLs, and returns an unsaved review draft', async () => {
  let request;
  const mock = async (url, options) => { request = { url, ...JSON.parse(options.body) }; return { ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({ ...recipe(), nutrition_source: 'author', warnings: ['Pasos incompletos'], freezer: 'unknown' }) }] }] }) }; };
  const result = await extractRecipe({ text: 'texto', source_url: 'https://www.instagram.com/p/example/', images: ['data:image/png;base64,YQ=='] }, { openai_api_key: 'test', openai_model: 'test-model' }, mock);
  assert.equal(request.url, 'https://api.openai.com/v1/responses'); assert.equal(request.store, false);
  assert.equal(request.text.format.strict, true); assert.equal(request.input[0].content[1].type, 'input_image');
  assert.equal(result.recipe.ingredients_basis, 'recipe'); assert.equal(result.recipe.servings, 10);
  assert.match(result.recipe.nutrition_notes, /Pasos incompletos/);
});
test('AI missing nutrients remain explicitly unknown; upstream secrets never leak in errors', async () => {
  const mock = async () => ({ ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: JSON.stringify(recipe({ kcal: null, protein: null, nutrition_source: 'unknown', warnings: [] })) }] }] }) });
  const result = await extractRecipe({ text: 'una receta' }, { openai_api_key: 'test' }, mock);
  assert.equal(result.recipe.nutrition_source, 'unknown'); assert.equal(result.recipe.kcal, 0);
  await assert.rejects(extractRecipe({ text: 'texto' }, { openai_api_key: 'secret' }, async () => ({ ok: false, status: 401, text: async () => 'secret' })), /clave de OpenAI no es válida/);
  await assert.rejects(extractRecipe({ source_url: 'https://instagram.com/test' }, {}, mock), /Pega el texto/);
});

test('HTTP integration: migrations, import rollback, portion scaling, week isolation, preview concurrency and persistence', { timeout: 30000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fit-kitchen-test-'));
  let child;
  const stop = async () => { if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); } };
  t.after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const start = () => new Promise((resolve, reject) => {
    child = spawn(process.execPath, ['server.js'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: '0', DB_PATH: path.join(dir, 'fit.db'), CONFIG_BACKUP_DIR: path.join(dir, 'backup'), UPLOADS_DIR: path.join(dir, 'uploads') }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/running on port (\d+)/); if (match) resolve('http://127.0.0.1:' + match[1]); });
    child.stderr.on('data', chunk => { output += chunk; }); child.on('error', reject);
    child.on('exit', code => { if (!output.includes('running on port')) reject(new Error(output + ' exit=' + code)); });
  });
  let base = await start();
  const call = async (url, body, method = 'POST', status = 200) => {
    const response = await fetch(base + '/api/' + url, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await response.json(); assert.equal(response.status, status, JSON.stringify(json)); return json;
  };
  const created = await call('recipes', recipe({ freezer: 'yes' })); const id = created.id;
  await call('diet/clear-week', { week_type: 'current' });
  await call('diet/clear-week', { week_type: 'next' });
  await call('recipes/' + id, { favorite: true }, 'PUT');
  const rows = (await call('recipes')).local;
  assert.equal(rows.find(r => r.id === id).servings, 10);
  assert.equal(rows.find(r => r.id === id).favorite, 1);
  await call('diet/import-json', { week_type: 'current', body: { plan: [{ day: 'lunes', meal: 'almuerzo', recipe_title: 'Pollo coreano', people_count: 2 }] } });
  await call('diet/import-json', { week_type: 'next', body: { plan: [{ day: 'martes', meal: 'cena', recipe_title: 'Pollo coreano', people_count: 3 }] } });
  let batch = await call('kitchen/batch?week=current');
  assert.equal(batch.shopping.find(i => i.name === 'Pollo').amount, 340);
  const plan = await call('diet/plan?week=current&people=2');
  assert.equal(plan.lunes.meals[0].ingredients[0].scaledAmount, '340');
  await call('diet/people-count', { people_count: 4, week: 'current' });
  assert.equal((await call('kitchen/batch?week=next')).portions, 3);
  assert.equal((await call('kitchen/batch?week=current')).portions, 4);
  // An invalid assignment after an insert must roll back the entire JSON import.
  await call('diet/import-json', { body: { recipes: [recipe({ title: 'Rollback recipe' })], plan: [{ day: 'bad', meal: 'cena', recipe_title: 'Rollback recipe' }] } }, 'POST', 400);
  assert.equal((await call('recipes')).local.some(r => r.title === 'Rollback recipe'), false);
  // Existing data survives a restart and migration runs twice safely.
  batch = await call('kitchen/batch?week=current');
  await call('kitchen/checks', { key: batch.key, checks: { 'shop-0': true } });
  assert.ok(fs.existsSync(path.join(dir, 'backup', 'fitcontroller.db')));
  await stop(); base = await start();
  assert.equal((await call('kitchen/batch?week=current')).checks['shop-0'], true);
  // Preview never changes the stored week. Another edit invalidates its revision.
  const preview = await call('kitchen/plan-preview', { week: 'next', days: ['miercoles'], meals: ['almuerzo'], people: 2, recipeIds: [id], freezerOnly: true });
  assert.equal((await call('kitchen/batch?week=next')).portions, 3);
  await call('diet/people-count', { people_count: 5, week: 'next' });
  await call('kitchen/plan-apply', preview, 'POST', 409);
  const fresh = await call('kitchen/plan-preview', { week: 'next', days: ['miercoles'], meals: ['almuerzo'], people: 2, recipeIds: [id], freezerOnly: true });
  await call('kitchen/plan-apply', fresh);
  assert.equal((await call('kitchen/batch?week=next')).portions, 7);
  await call('kitchen/plan-preview', { recipeIds: [], days: ['jueves'], meals: ['almuerzo'] }, 'POST', 400);
  await call('kitchen/ai-settings', { api_key: 'test-secret-not-a-real-key', model: 'gpt-4.1-mini' });
  const settings = await call('kitchen/ai-settings'); assert.equal(settings.configured, true); assert.equal(JSON.stringify(settings).includes('test-secret'), false);
  const generalSettings = await call('settings/api-keys'); assert.equal(JSON.stringify(generalSettings).includes('test-secret'), false);
  await call('kitchen/ai-settings', { remove: true });
  await call('kitchen/extract', { text: 'test' }, 'POST', 400);
  assert.equal((await call('kitchen/starter-recipes', {})).added, 8);
  assert.equal((await call('kitchen/starter-recipes', {})).added, 0);
  const wholeWeek = await call('kitchen/plan-preview', { week: 'next', replace: true, people: 2, freezerOnly: true, repeats: 3, minProtein: 30, maxKcal: 650 });
  assert.equal(wholeWeek.plan.length, 14);
  assert.equal(wholeWeek.plan[0].people_count, 2);
  assert.notEqual(wholeWeek.plan[0].recipe_id, wholeWeek.plan[1].recipe_id);
  const frequency = new Map(); wholeWeek.plan.forEach(p => frequency.set(p.recipe_id, (frequency.get(p.recipe_id) || 0) + 1));
  assert.ok([...frequency.values()].every(n => n <= 3));
  await call('settings/api-keys', { default_excluded: 'pollo' });
  await call('kitchen/plan-preview', { week: 'next', recipeIds: [id], days: ['viernes'], meals: ['cena'] }, 'POST', 400);
  await call('settings/api-keys', { default_excluded: '' });
  await call('kitchen/photo', { image: 'data:image/png;base64,YQ==' }, 'POST', 400);
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  const uploaded = await call('kitchen/photo', { image: pixel });
  assert.match(uploaded.url, /^uploads\/recipes\/[\w-]+\.png$/);
  assert.equal((await fetch(base + '/' + uploaded.url)).status, 200);
  assert.ok(fs.existsSync(path.join(dir, 'backup', uploaded.url)));
  const legacy = await call('recipes', recipe({ title: 'Legacy amount', ingredients_basis: 'portion', servings: 1, ingredients: [{ name: 'Arroz', amount: '70 g' }] }));
  const legacyRow = (await call('recipes')).local.find(r => r.id === legacy.id);
  assert.equal(legacyRow.ingredients[0].amount, 70); assert.equal(legacyRow.ingredients[0].unit, 'g');
  await call('recipes/' + id, {}, 'DELETE');
  assert.ok((await call('kitchen/batch?week=next')).warnings.some(s => s.includes('falta una receta')));
  await call('not-a-route', undefined, 'GET', 404);
});
