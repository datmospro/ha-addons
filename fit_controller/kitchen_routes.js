const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DAYS, MEALS, number, normalizeRecipe, batchPlan, fingerprint, fold } = require('./kitchen_engine');
const { extractRecipe } = require('./recipe_import');

function installKitchen(app, { db, backupDb, rollover = () => {}, uploadsDir, backupUploadsDir }) {
  const columns = { ingredients_basis: "TEXT DEFAULT 'portion'", source_url: "TEXT DEFAULT ''", tags: "TEXT DEFAULT ''",
    favorite: 'INTEGER DEFAULT 0', rating: "TEXT DEFAULT ''", freezer: "TEXT DEFAULT 'unknown'",
    freeze_notes: "TEXT DEFAULT ''", reheat_notes: "TEXT DEFAULT ''", nutrition_source: "TEXT DEFAULT 'author'", nutrition_notes: "TEXT DEFAULT ''" };
  const present = new Set(db.prepare('PRAGMA table_info(recipes)').all().map(c => c.name));
  for (const [key, type] of Object.entries(columns)) if (!present.has(key)) db.exec(`ALTER TABLE recipes ADD COLUMN ${key} ${type}`);
  db.exec('CREATE TABLE IF NOT EXISTS kitchen_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const router = express.Router();
  const route = fn => async (req, res) => { try { await fn(req, res); } catch (err) { res.status(err.status || 400).json({ error: err.message }); } };
  const transaction = fn => { db.exec('BEGIN'); try { const result = fn(); db.exec('COMMIT'); backupDb(); return result; } catch (err) { db.exec('ROLLBACK'); throw err; } };
  const getRecipe = id => {
    const row = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id);
    if (!row) { const err = new Error('Receta no encontrada.'); err.status = 404; throw err; }
    return row;
  };
  const saveRecipe = (input, id) => {
    const recipe = normalizeRecipe(input, id ? getRecipe(id) : {});
    const keys = Object.keys(recipe);
    if (id) db.prepare(`UPDATE recipes SET ${keys.map(k => `${k} = ?`).join(',')} WHERE id = ?`).run(...Object.values(recipe), id);
    else id = Number(db.prepare(`INSERT INTO recipes (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(recipe)).lastInsertRowid);
    return id;
  };
  const week = value => { if (!['current', 'next'].includes(value)) throw new Error('Semana no válida.'); return value; };
  const slots = target => db.prepare('SELECT * FROM meal_plans WHERE week_type = ? ORDER BY id').all(target);
  const revision = (target, includeRecipes = false) => fingerprint({ week: target, start: db.prepare('SELECT active_week_start FROM user_profile WHERE id=1').get()?.active_week_start, slots: slots(target), recipes: includeRecipes ? db.prepare('SELECT * FROM recipes ORDER BY id').all() : undefined });
  const assign = (item, target) => {
    const day = item.day_of_week || item.day;
    const meal = item.meal_type || item.meal || item.type;
    if (!DAYS.includes(day) || !MEALS.includes(meal)) throw new Error('Día o comida no válido.');
    getRecipe(item.recipe_id);
    const people = number(item.people_count ?? 1, 'Raciones', 1, 100);
    if (!Number.isInteger(people)) throw new Error('Las raciones del menú deben ser enteras.');
    db.prepare('DELETE FROM meal_plans WHERE day_of_week=? AND meal_type=? AND week_type=?').run(day, meal, target);
    db.prepare('INSERT INTO meal_plans (day_of_week,meal_type,recipe_id,people_count,week_type) VALUES (?,?,?,?,?)').run(day, meal, item.recipe_id, people, target);
  };
  const batch = target => {
    rollover();
    const rows = db.prepare(`SELECT r.*, mp.recipe_id, mp.day_of_week, mp.meal_type, mp.people_count FROM meal_plans mp
      LEFT JOIN recipes r ON r.id=mp.recipe_id WHERE mp.week_type=? ORDER BY mp.id`).all(target);
    const result = batchPlan(rows);
    const rev = revision(target);
    const key = fingerprint({ target, rev, result });
    const stored = db.prepare('SELECT value FROM kitchen_state WHERE key=?').get(key);
    return { ...result, key, revision: rev, week: target, checks: stored ? JSON.parse(stored.value) : {} };
  };
  router.get('/kitchen/batch', route((req, res) => res.json(batch(week(req.query.week || 'current')))));
  router.get('/kitchen/starter-recipes', route((req, res) => res.json(require('./starter_recipes.json'))));
  router.post('/kitchen/starter-recipes', route((req, res) => {
    let added = 0;
    transaction(() => {
      for (const recipe of require('./starter_recipes.json')) {
        if (!db.prepare('SELECT id FROM recipes WHERE lower(title)=lower(?)').get(recipe.title)) { saveRecipe(recipe); added++; }
      }
    });
    res.json({ success: true, added });
  }));
  router.post('/kitchen/checks', route((req, res) => {
    const { key, checks } = req.body;
    if (!/^[a-f0-9]{20}$/.test(key) || !checks || typeof checks !== 'object' || Array.isArray(checks) || JSON.stringify(checks).length > 40000 || Object.values(checks).some(v => typeof v !== 'boolean')) throw new Error('Lista de comprobación no válida.');
    db.prepare('INSERT INTO kitchen_state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(checks));
    db.exec('DELETE FROM kitchen_state WHERE rowid NOT IN (SELECT rowid FROM kitchen_state ORDER BY rowid DESC LIMIT 80)');
    backupDb(); res.json({ success: true });
  }));
  router.get('/diet/shopping-list', route((req, res) => res.json(batch(week(req.query.week || 'current')).shopping)));
  router.post('/diet/people-count', route((req, res) => {
    const count = number(req.body.people_count, 'Personas', 1, 100);
    if (!Number.isInteger(count)) throw new Error('El número de personas debe ser entero.');
    const target = week(req.body.week || 'current');
    transaction(() => {
      db.prepare('UPDATE meal_plans SET people_count=? WHERE week_type=?').run(count, target);
      db.prepare('UPDATE user_profile SET default_people_count=? WHERE id=1').run(count);
    });
    res.json({ success: true, count });
  }));
  router.post('/kitchen/photo', route((req, res) => {
    const image = req.body.image;
    if (typeof image !== 'string' || image.length > 8000000) throw new Error('La foto debe ocupar menos de 6 MB.');
    const match = image.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new Error('Formato de imagen no válido.');
    const buffer = Buffer.from(match[2], 'base64');
    const valid = match[1] === 'png' ? buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) : match[1] === 'jpeg' ? buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255 : buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
    if (!valid) throw new Error('El archivo no contiene una imagen válida.');
    const filename = `${randomUUID()}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`;
    const directory = path.join(uploadsDir, 'recipes');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, filename), buffer);
    let backupWarning = '';
    if (backupUploadsDir && (process.env.CONFIG_BACKUP_DIR || fs.existsSync('/config'))) {
      try { fs.mkdirSync(path.join(backupUploadsDir, 'recipes'), { recursive: true }); fs.copyFileSync(path.join(directory, filename), path.join(backupUploadsDir, 'recipes', filename)); }
      catch { backupWarning = 'Foto guardada; no se pudo copiar a /config. Revisa el espacio disponible.'; }
    }
    res.json({ url: `uploads/recipes/${filename}`, warning: backupWarning });
  }));

  router.post('/recipes', route((req, res) => res.json({ success: true, id: transaction(() => saveRecipe(req.body)) })));
  router.post('/recipes/import-external', route((req, res) => res.json({ success: true, id: transaction(() => saveRecipe(req.body)) })));
  router.put('/recipes/:id', route((req, res) => res.json({ success: true, id: transaction(() => saveRecipe(req.body, req.params.id)) })));
  router.delete('/recipes/:id', route((req, res) => {
    getRecipe(req.params.id);
    transaction(() => {
      db.prepare('UPDATE meal_plans SET custom_title=(SELECT title FROM recipes WHERE id=?),recipe_id=NULL WHERE recipe_id=?').run(req.params.id, req.params.id);
      db.prepare('DELETE FROM recipes WHERE id=?').run(req.params.id);
    });
    res.json({ success: true });
  }));
  router.post('/recipes/save-and-assign', route((req, res) => {
    const { recipe, assign: assignment } = req.body;
    if (!recipe) throw new Error('Falta la receta.');
    const result = transaction(() => {
      const existing = db.prepare('SELECT id FROM recipes WHERE lower(title)=lower(?)').get(recipe.title);
      const id = existing?.id || saveRecipe(recipe);
      if (assignment) assign({ ...assignment, recipe_id: id }, week(assignment.week_type || 'current'));
      return id;
    });
    res.json({ success: true, recipeId: result, assigned: !!assignment, message: 'Receta guardada.' });
  }));
  router.post('/diet/import-json', route((req, res) => {
    let data = req.body.body ?? req.body;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch { throw new Error('El texto no es un JSON válido.'); } }
    if (!data || typeof data !== 'object') throw new Error('Contenido no válido.');
    const recipes = Array.isArray(data) ? data : data.recipes || (data.title ? [data] : []);
    const plan = data.plan || data.weekly_plan || [];
    if (!Array.isArray(recipes) || !Array.isArray(plan) || recipes.length > 200 || plan.length > 35 || (!recipes.length && !plan.length)) throw new Error('Incluye recetas o un menú válido (máximo 200 recetas / 35 comidas).');
    const target = week(req.body.week_type || data.week_type || 'current');
    transaction(() => {
      const ids = new Map();
      for (const r of recipes) {
        const existing = db.prepare('SELECT id FROM recipes WHERE lower(title)=lower(?)').get(r.title || '');
        // Imports update intentionally named recipes, preserving fields omitted by the source.
        ids.set(fold(r.title), saveRecipe(r, existing?.id));
      }
      const people = db.prepare('SELECT default_people_count FROM user_profile WHERE id=1').get()?.default_people_count || 1;
      for (const p of plan) {
        const title = p.recipe_title || p.title || p.recipe || '';
        const id = p.recipe_id || ids.get(fold(title)) || db.prepare('SELECT id FROM recipes WHERE lower(title)=lower(?)').get(title)?.id;
        if (!id) throw new Error(`No se encuentra la receta del menú: ${title}`);
        assign({ ...p, recipe_id: id, people_count: p.people_count || people }, target);
      }
    });
    res.json({ success: true, importedRecipesCount: recipes.length, importedPlanCount: plan.length, targetWeek: target,
      message: `${recipes.length} recetas y ${plan.length} comidas guardadas.` });
  }));

  router.post('/kitchen/plan-preview', route((req, res) => {
    rollover();
    const b = req.body, target = week(b.week || 'next');
    const days = b.days || DAYS, meals = b.meals || ['almuerzo', 'cena'];
    if (!Array.isArray(days) || !days.length || days.some(d => !DAYS.includes(d)) || new Set(days).size !== days.length || !Array.isArray(meals) || !meals.length || meals.some(m => !MEALS.includes(m)) || new Set(meals).size !== meals.length) throw new Error('Selecciona días y comidas válidos.');
    const people = number(b.people ?? 2, 'Personas', 1, 20);
    const repeats = number(b.repeats ?? 3, 'Repeticiones', 1, 14);
    if (!Number.isInteger(people) || !Number.isInteger(repeats)) throw new Error('Personas y repeticiones deben ser enteras.');
    const minProtein = number(b.minProtein ?? 0, 'Proteína mínima', 0, 200);
    const maxKcal = number(b.maxKcal ?? 2000, 'Calorías máximas', 1, 5000);
    const defaultExcluded = db.prepare("SELECT value FROM api_settings WHERE key='default_excluded'").get()?.value || '';
    const { getExcludedKeywords, passesVetoFilter } = require('./recipe_engine');
    const combinedExcluded = [defaultExcluded, b.excluded || ''].filter(Boolean).join(',');
    const excluded = combinedExcluded.split(',').map(fold).filter(Boolean);
    const vetoKeywords = getExcludedKeywords(combinedExcluded);
    let candidates = db.prepare('SELECT * FROM recipes ORDER BY favorite DESC, id DESC').all().filter(r =>
      r.rating !== 'avoid' && r.nutrition_source !== 'unknown' && r.kcal > 0 && r.kcal <= maxKcal && r.protein >= minProtein &&
      (!b.freezerOnly || ['yes', 'components'].includes(r.freezer)) && (!b.favoritesOnly || r.favorite) &&
      (!Array.isArray(b.recipeIds) || b.recipeIds.includes(r.id)) &&
      !excluded.some(e => fold(r.title + ' ' + r.ingredients_json).includes(e)) &&
      passesVetoFilter({ ...r, ingredients: JSON.parse(r.ingredients_json || '[]') }, vetoKeywords));
    const current = slots(target), usage = new Map();
    const pendingSlots = days.flatMap(day => meals.map(meal => ({ day, meal }))).filter(s => b.replace || !current.some(p => p.day_of_week === s.day && p.meal_type === s.meal));
    const poolSize = Math.ceil(pendingSlots.length / repeats);
    const pool = candidates.slice(0, poolSize);
    const planned = [];
    for (const { day, meal } of pendingSlots) {
      const eligible = candidates.filter(r => (r.category === meal || (['almuerzo', 'cena'].includes(meal) && ['almuerzo', 'cena'].includes(r.category))) && (usage.get(r.id) || 0) < repeats);
      // Cook a small set of dishes, but distribute them across the week for variety.
      const inPool = eligible.filter(r => pool.some(p => p.id === r.id));
      const chosen = (inPool.length ? inPool : eligible).sort((a, b) => (usage.get(a.id) || 0) - (usage.get(b.id) || 0))[0];
      if (!chosen) throw new Error('No hay suficientes recetas para esos filtros y repeticiones. Añade recetas o amplía los filtros.');
      usage.set(chosen.id, (usage.get(chosen.id) || 0) + 1);
      planned.push({ day_of_week: day, meal_type: meal, recipe_id: chosen.id, people_count: people });
    }
    if (!planned.length) throw new Error('Los huecos seleccionados ya están completos. Activa reemplazar para proponer otro menú.');
    res.json({ week: target, revision: revision(target, true), plan: planned, candidates: candidates.map(r => ({ id: r.id, title: r.title, category: r.category, kcal: r.kcal, protein: r.protein })) });
  }));
  router.post('/kitchen/plan-apply', route((req, res) => {
    rollover();
    const target = week(req.body.week);
    if (req.body.revision !== revision(target, true)) { const e = new Error('La semana o las recetas han cambiado. Genera otra propuesta antes de guardarla.'); e.status = 409; throw e; }
    const plan = req.body.plan;
    if (!Array.isArray(plan) || !plan.length || plan.length > 35 || new Set(plan.map(p => p.day_of_week + ':' + p.meal_type)).size !== plan.length) throw new Error('Propuesta no válida.');
    transaction(() => {
      plan.forEach(p => assign(p, target));
      if (new Set(plan.map(p => Number(p.people_count))).size === 1) db.prepare('UPDATE user_profile SET default_people_count=? WHERE id=1').run(Number(plan[0].people_count));
    });
    res.json({ success: true });
  }));
  router.get('/kitchen/ai-settings', route((req, res) => {
    const key = db.prepare("SELECT value FROM api_settings WHERE key='openai_api_key'").get()?.value;
    const model = db.prepare("SELECT value FROM api_settings WHERE key='openai_model'").get()?.value || 'gpt-4.1-mini';
    res.json({ configured: !!key, model });
  }));
  router.post('/kitchen/ai-settings', route((req, res) => {
    const model = String(req.body.model || 'gpt-4.1-mini').trim();
    if (!/^[a-zA-Z0-9._-]{1,100}$/.test(model)) throw new Error('Nombre de modelo no válido.');
    const set = db.prepare('INSERT INTO api_settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    transaction(() => {
      set.run('openai_model', model);
      if (req.body.remove) set.run('openai_api_key', '');
      else if (req.body.api_key) {
        const key = String(req.body.api_key).trim();
        if (key.length < 15 || key.length > 500 || /\s/.test(key)) throw new Error('Clave no válida.');
        set.run('openai_api_key', key);
      }
    });
    res.json({ success: true });
  }));
  let importing = false;
  router.post('/kitchen/extract', route(async (req, res) => {
    if (importing) { const e = new Error('Ya hay una importación en curso. Espera a que termine.'); e.status = 429; throw e; }
    const settings = Object.fromEntries(db.prepare("SELECT key,value FROM api_settings WHERE key IN ('openai_api_key','openai_model')").all().map(r => [r.key, r.value]));
    if (!settings.openai_api_key) throw new Error('Configura una clave de OpenAI o utiliza la importación JSON sin IA.');
    importing = true;
    try { res.json(await extractRecipe(req.body, settings)); } finally { importing = false; }
  }));
  app.use('/api', router);
  return { saveRecipe, batch };
}
module.exports = { installKitchen };
