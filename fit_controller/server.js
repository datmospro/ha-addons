const express = require('express');
const cors = require('cors');
const path = require('path');
const { db, initDb } = require('./database');
const { searchLocalRecipes, searchExternalRecipes } = require('./recipe_engine');

// Initialize SQLite DB
initDb();

const app = express();
const PORT = process.env.PORT || 8099;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to compute TDEE & macro targets for weight loss
function calculateMacros(profile) {
  const { weight_kg, height_cm, age, gender, activity_level, weekly_weight_loss_kg } = profile;

  // Mifflin-St Jeor Equation for BMR
  let bmr = (10 * weight_kg) + (6.25 * height_cm) - (5 * age);
  if (gender === 'female') {
    bmr -= 161;
  } else {
    bmr += 5;
  }

  // Activity Multiplier
  const multipliers = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    very_active: 1.9
  };

  const tdee = bmr * (multipliers[activity_level] || 1.55);

  // Deficit for weight loss: 0.5kg/week = ~500 kcal deficit/day
  const lossRate = parseFloat(weekly_weight_loss_kg || 0.5);
  const dailyDeficit = Math.round(lossRate * 1000); // 1kg loss ~ 7700kcal -> 0.5kg ~ 500kcal/day
  const daily_kcal_target = Math.max(1200, Math.round(tdee - dailyDeficit));

  // High protein for weight loss & muscle retention: ~1.8g per kg bodyweight
  const daily_protein_target = Math.round(weight_kg * 1.8);

  // Fat target: ~25% of total calories
  const daily_fat_target = Math.round((daily_kcal_target * 0.25) / 9);

  // Carbs target: remaining calories
  const proteinKcal = daily_protein_target * 4;
  const fatKcal = daily_fat_target * 9;
  const remainingKcal = Math.max(200, daily_kcal_target - (proteinKcal + fatKcal));
  const daily_carbs_target = Math.round(remainingKcal / 4);

  return {
    daily_kcal_target,
    daily_protein_target,
    daily_carbs_target,
    daily_fat_target
  };
}

// ----------------------------------------------------
// USER PROFILE ENDPOINTS
// ----------------------------------------------------

app.get('/api/profile', (req, res) => {
  try {
    const profile = db.prepare(`SELECT * FROM user_profile WHERE id = 1`).get();
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/profile', (req, res) => {
  try {
    const {
      name, age, gender, weight_kg, height_cm, activity_level,
      target_weight_kg, weekly_weight_loss_kg, default_people_count
    } = req.body;

    const currentProfile = db.prepare(`SELECT * FROM user_profile WHERE id = 1`).get();
    const updated = {
      ...currentProfile,
      name: name !== undefined ? name : currentProfile.name,
      age: age ? parseInt(age, 10) : currentProfile.age,
      gender: gender || currentProfile.gender,
      weight_kg: weight_kg ? parseFloat(weight_kg) : currentProfile.weight_kg,
      height_cm: height_cm ? parseFloat(height_cm) : currentProfile.height_cm,
      activity_level: activity_level || currentProfile.activity_level,
      target_weight_kg: target_weight_kg ? parseFloat(target_weight_kg) : currentProfile.target_weight_kg,
      weekly_weight_loss_kg: weekly_weight_loss_kg ? parseFloat(weekly_weight_loss_kg) : currentProfile.weekly_weight_loss_kg,
      default_people_count: default_people_count ? parseInt(default_people_count, 10) : currentProfile.default_people_count
    };

    const calculated = calculateMacros(updated);

    db.prepare(`
      UPDATE user_profile SET
        name = ?, age = ?, gender = ?, weight_kg = ?, height_cm = ?, activity_level = ?,
        target_weight_kg = ?, weekly_weight_loss_kg = ?, daily_kcal_target = ?,
        daily_protein_target = ?, daily_carbs_target = ?, daily_fat_target = ?,
        default_people_count = ?
      WHERE id = 1
    `).run(
      updated.name, updated.age, updated.gender, updated.weight_kg, updated.height_cm, updated.activity_level,
      updated.target_weight_kg, updated.weekly_weight_loss_kg, calculated.daily_kcal_target,
      calculated.daily_protein_target, calculated.daily_carbs_target, calculated.daily_fat_target,
      updated.default_people_count
    );

    const result = db.prepare(`SELECT * FROM user_profile WHERE id = 1`).get();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// DIET & MEAL PLAN ENDPOINTS
// ----------------------------------------------------

app.get('/api/diet/plan', (req, res) => {
  try {
    const peopleCount = parseInt(req.query.people || 1, 10);
    const plans = db.prepare(`
      SELECT mp.*, r.title as recipe_title, r.description, r.category, r.prep_time_min,
             r.servings, r.kcal, r.protein, r.carbs, r.fat, r.fiber,
             r.ingredients_json, r.instructions_json, r.image_url
      FROM meal_plans mp
      LEFT JOIN recipes r ON mp.recipe_id = r.id
      ORDER BY mp.id ASC
    `).all();

    const days = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
    const structured = {};

    days.forEach(day => {
      structured[day] = {
        day,
        meals: [],
        totalsPerPerson: { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
        totalsAllPeople: { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
      };
    });

    plans.forEach(p => {
      const dayKey = p.day_of_week;
      if (!structured[dayKey]) return;

      const pCount = p.people_count || peopleCount;
      const ingredients = JSON.parse(p.ingredients_json || '[]');
      const instructions = JSON.parse(p.instructions_json || '[]');

      // Single portion values
      const perPerson = {
        kcal: p.kcal || 0,
        protein: p.protein || 0,
        carbs: p.carbs || 0,
        fat: p.fat || 0,
        fiber: p.fiber || 0
      };

      // Scaled values for all people
      const scaledTotal = {
        kcal: perPerson.kcal * pCount,
        protein: perPerson.protein * pCount,
        carbs: perPerson.carbs * pCount,
        fat: perPerson.fat * pCount,
        fiber: perPerson.fiber * pCount
      };

      // Scaled ingredients
      const scaledIngredients = ingredients.map(ing => {
        const amt = parseFloat(ing.amount);
        return {
          ...ing,
          scaledAmount: !isNaN(amt) ? (amt * pCount).toFixed(1).replace(/\.0$/, '') : ing.amount
        };
      });

      structured[dayKey].meals.push({
        id: p.id,
        meal_type: p.meal_type,
        recipe_id: p.recipe_id,
        recipe_title: p.recipe_title || p.custom_title || 'Comida Personalizada',
        image_url: p.image_url,
        people_count: pCount,
        perPerson,
        scaledTotal,
        ingredients: scaledIngredients,
        instructions
      });

      structured[dayKey].totalsPerPerson.kcal += perPerson.kcal;
      structured[dayKey].totalsPerPerson.protein += perPerson.protein;
      structured[dayKey].totalsPerPerson.carbs += perPerson.carbs;
      structured[dayKey].totalsPerPerson.fat += perPerson.fat;
      structured[dayKey].totalsPerPerson.fiber += perPerson.fiber;

      structured[dayKey].totalsAllPeople.kcal += scaledTotal.kcal;
      structured[dayKey].totalsAllPeople.protein += scaledTotal.protein;
      structured[dayKey].totalsAllPeople.carbs += scaledTotal.carbs;
      structured[dayKey].totalsAllPeople.fat += scaledTotal.fat;
      structured[dayKey].totalsAllPeople.fiber += scaledTotal.fiber;
    });

    res.json(structured);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/diet/plan', (req, res) => {
  try {
    const { day_of_week, meal_type, recipe_id, custom_title, people_count } = req.body;

    if (!day_of_week || !meal_type) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    // Check if slot exists, replace or insert
    const existing = db.prepare(`SELECT id FROM meal_plans WHERE day_of_week = ? AND meal_type = ?`).get(day_of_week, meal_type);

    if (existing) {
      db.prepare(`
        UPDATE meal_plans SET recipe_id = ?, custom_title = ?, people_count = ? WHERE id = ?
      `).run(recipe_id || null, custom_title || null, people_count || 1, existing.id);
    } else {
      db.prepare(`
        INSERT INTO meal_plans (day_of_week, meal_type, recipe_id, custom_title, people_count)
        VALUES (?, ?, ?, ?, ?)
      `).run(day_of_week, meal_type, recipe_id || null, custom_title || null, people_count || 1);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/diet/plan/:id', (req, res) => {
  try {
    db.prepare(`DELETE FROM meal_plans WHERE id = ?`).run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update global people count for all meal plan items
app.post('/api/diet/people-count', (req, res) => {
  try {
    const { people_count } = req.body;
    const count = parseInt(people_count, 10) || 1;
    db.prepare(`UPDATE meal_plans SET people_count = ?`).run(count);
    db.prepare(`UPDATE user_profile SET default_people_count = ? WHERE id = 1`).run(count);
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate Consolidated Shopping List for the week
app.get('/api/diet/shopping-list', (req, res) => {
  try {
    const defaultProfile = db.prepare(`SELECT default_people_count FROM user_profile WHERE id = 1`).get();
    const globalPeople = defaultProfile ? defaultProfile.default_people_count : 1;

    const plans = db.prepare(`
      SELECT mp.people_count, r.ingredients_json
      FROM meal_plans mp
      JOIN recipes r ON mp.recipe_id = r.id
    `).all();

    const map = {};

    plans.forEach(p => {
      const pCount = p.people_count || globalPeople;
      const ingredients = JSON.parse(p.ingredients_json || '[]');

      ingredients.forEach(ing => {
        const nameKey = ing.name.trim().toLowerCase();
        const amt = parseFloat(ing.amount);
        const unit = ing.unit || '';

        if (!map[nameKey]) {
          map[nameKey] = {
            name: ing.name.trim(),
            amount: !isNaN(amt) ? amt * pCount : 0,
            unit,
            rawText: !isNaN(amt) ? '' : ing.amount
          };
        } else {
          if (!isNaN(amt)) {
            map[nameKey].amount += (amt * pCount);
          }
        }
      });
    });

    const shoppingList = Object.values(map).map(item => {
      if (item.amount > 0) {
        return {
          name: item.name,
          displayAmount: `${item.amount % 1 === 0 ? item.amount : item.amount.toFixed(1)} ${item.unit}`.trim()
        };
      }
      return {
        name: item.name,
        displayAmount: item.rawText || 'al gusto'
      };
    });

    res.json(shoppingList);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// RECIPE SEARCH & MANAGEMENT
// ----------------------------------------------------

app.get('/api/recipes', async (req, res) => {
  try {
    const { query, category, maxKcal, minProtein, maxCarbs, source } = req.query;

    const localResults = searchLocalRecipes({ query, category, maxKcal, minProtein, maxCarbs });

    let externalResults = [];
    if (source === 'external' || source === 'all' || (query && localResults.length < 3)) {
      externalResults = await searchExternalRecipes(query || 'chicken');
    }

    res.json({
      local: localResults,
      external: externalResults
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/recipes', (req, res) => {
  try {
    const { title, description, category, prep_time_min, servings, kcal, protein, carbs, fat, fiber, ingredients, instructions, image_url } = req.body;

    if (!title || !kcal) {
      return res.status(400).json({ error: 'Título y Calorías son obligatorios' });
    }

    const stmt = db.prepare(`
      INSERT INTO recipes (title, description, category, prep_time_min, servings, kcal, protein, carbs, fat, fiber, ingredients_json, instructions_json, image_url, is_custom)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    const result = stmt.run(
      title, description || '', category || 'almuerzo', prep_time_min || 15, servings || 1,
      parseInt(kcal, 10), parseInt(protein || 0, 10), parseInt(carbs || 0, 10), parseInt(fat || 0, 10), parseInt(fiber || 0, 10),
      JSON.stringify(ingredients || []), JSON.stringify(instructions || []), image_url || ''
    );

    res.json({ id: result.lastInsertRowid, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/recipes/import-external', (req, res) => {
  try {
    const { title, description, category, prep_time_min, servings, kcal, protein, carbs, fat, fiber, ingredients, instructions, image_url } = req.body;

    const stmt = db.prepare(`
      INSERT INTO recipes (title, description, category, prep_time_min, servings, kcal, protein, carbs, fat, fiber, ingredients_json, instructions_json, image_url, is_custom)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `);

    const result = stmt.run(
      title, description || 'Importada de base abierta', category || 'almuerzo', prep_time_min || 20, servings || 1,
      parseInt(kcal, 10), parseInt(protein || 0, 10), parseInt(carbs || 0, 10), parseInt(fat || 0, 10), parseInt(fiber || 0, 10),
      JSON.stringify(ingredients || []), JSON.stringify(instructions || []), image_url || ''
    );

    res.json({ id: result.lastInsertRowid, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/recipes/:id', (req, res) => {
  try {
    db.prepare(`DELETE FROM recipes WHERE id = ?`).run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// WORKOUT & EXERCISE ENDPOINTS
// ----------------------------------------------------

app.get('/api/workout/exercises', (req, res) => {
  try {
    const { muscle, query } = req.query;
    let sql = `SELECT * FROM exercises WHERE 1=1`;
    const params = [];

    if (muscle && muscle !== 'all') {
      sql += ` AND muscle_group = ?`;
      params.push(muscle);
    }

    if (query) {
      sql += ` AND (name LIKE ? OR equipment LIKE ? OR instructions LIKE ?)`;
      const q = `%${query}%`;
      params.push(q, q, q);
    }

    sql += ` ORDER BY name ASC`;
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/workout/exercises', (req, res) => {
  try {
    const { name, muscle_group, equipment, difficulty, instructions, animation_url, default_sets, default_reps, default_rest_sec, cadence_sec, is_isometric, prep_sec } = req.body;

    if (!name || !muscle_group) {
      return res.status(400).json({ error: 'Nombre y Grupo Muscular son requeridos' });
    }

    const stmt = db.prepare(`
      INSERT INTO exercises (name, muscle_group, equipment, difficulty, instructions, animation_type, animation_url, default_sets, default_reps, default_rest_sec, cadence_sec, is_isometric, prep_sec)
      VALUES (?, ?, ?, ?, ?, 'url', ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      name, muscle_group, equipment || 'Corporal', difficulty || 'Intermedio', instructions || '',
      animation_url || '', parseInt(default_sets || 3, 10), parseInt(default_reps || 12, 10), parseInt(default_rest_sec || 60, 10),
      parseInt(cadence_sec || 3, 10), is_isometric ? 1 : 0, parseInt(prep_sec || 5, 10)
    );

    res.json({ id: result.lastInsertRowid, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/workout/exercises/:id', (req, res) => {
  try {
    const { name, muscle_group, equipment, difficulty, instructions, animation_url, cadence_sec, is_isometric, prep_sec } = req.body;
    db.prepare(`
      UPDATE exercises SET
        name = ?, muscle_group = ?, equipment = ?, difficulty = ?, instructions = ?, animation_url = ?,
        cadence_sec = ?, is_isometric = ?, prep_sec = ?
      WHERE id = ?
    `).run(
      name, muscle_group, equipment || 'Corporal', difficulty || 'Intermedio', instructions || '',
      animation_url || '', parseInt(cadence_sec || 3, 10), is_isometric ? 1 : 0, parseInt(prep_sec || 5, 10), req.params.id
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/workout/exercises/:id', (req, res) => {
  try {
    db.prepare(`DELETE FROM routine_exercises WHERE exercise_id = ?`).run(req.params.id);
    db.prepare(`DELETE FROM exercises WHERE id = ?`).run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/workout/routines', (req, res) => {
  try {
    const routines = db.prepare(`SELECT * FROM routines ORDER BY id ASC`).all();

    const result = routines.map(r => {
      const exercises = db.prepare(`
        SELECT re.id as routine_exercise_id, re.order_index, re.sets, re.reps, re.weight_kg, re.rest_sec,
               e.id as exercise_id, e.name, e.muscle_group, e.equipment, e.difficulty, e.instructions,
               e.animation_type, e.animation_data, e.animation_url, e.cadence_sec, e.is_isometric, e.prep_sec
        FROM routine_exercises re
        JOIN exercises e ON re.exercise_id = e.id
        WHERE re.routine_id = ?
        ORDER BY re.order_index ASC, re.id ASC
      `).all(r.id);

      return {
        ...r,
        exercises
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/workout/routines', (req, res) => {
  try {
    const { name, day_of_week, description } = req.body;
    if (!name) return res.status(400).json({ error: 'El nombre de la rutina es requerido' });

    const stmt = db.prepare(`INSERT INTO routines (name, day_of_week, description) VALUES (?, ?, ?)`);
    const result = stmt.run(name, day_of_week || 'lunes', description || '');

    res.json({ id: result.lastInsertRowid, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/workout/routines/:id', (req, res) => {
  try {
    db.prepare(`DELETE FROM routine_exercises WHERE routine_id = ?`).run(req.params.id);
    db.prepare(`DELETE FROM routines WHERE id = ?`).run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/workout/routine-exercise', (req, res) => {
  try {
    const { routine_id, exercise_id, sets, reps, weight_kg, rest_sec } = req.body;

    const maxOrder = db.prepare(`SELECT MAX(order_index) as max_order FROM routine_exercises WHERE routine_id = ?`).get(routine_id);
    const nextOrder = (maxOrder && maxOrder.max_order) ? maxOrder.max_order + 1 : 1;

    const stmt = db.prepare(`
      INSERT INTO routine_exercises (routine_id, exercise_id, order_index, sets, reps, weight_kg, rest_sec)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      routine_id, exercise_id, nextOrder,
      parseInt(sets || 3, 10), parseInt(reps || 12, 10), parseFloat(weight_kg || 0), parseInt(rest_sec || 60, 10)
    );

    res.json({ id: result.lastInsertRowid, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/workout/routine-exercise/:id', (req, res) => {
  try {
    db.prepare(`DELETE FROM routine_exercises WHERE id = ?`).run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/workout/log', (req, res) => {
  try {
    const { routine_id, routine_name, duration_sec, total_volume_kg, sets_completed, kcal_burned, notes } = req.body;

    const stmt = db.prepare(`
      INSERT INTO workout_logs (routine_id, routine_name, duration_sec, total_volume_kg, sets_completed, kcal_burned, completed_at, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();
    const result = stmt.run(
      routine_id || null, routine_name || 'Entrenamiento Completo',
      parseInt(duration_sec || 0, 10), parseFloat(total_volume_kg || 0),
      parseInt(sets_completed || 0, 10), parseInt(kcal_burned || 0, 10),
      now, notes || ''
    );

    res.json({ id: result.lastInsertRowid, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/workout/logs', (req, res) => {
  try {
    const logs = db.prepare(`SELECT * FROM workout_logs ORDER BY id DESC LIMIT 30`).all();
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback to SPA index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`FitController running on port ${PORT}`);
});
