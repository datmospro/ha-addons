const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { db, initDb, backupDb } = require('./database');
const { searchLocalRecipes, searchExternalRecipes } = require('./recipe_engine');

// Initialize SQLite DB
initDb();

const app = express();
const PORT = process.env.PORT || 8099;

// Ensure persistent uploads directories exist
const dataUploadsDir = fs.existsSync('/data') ? '/data/uploads' : path.join(__dirname, 'public', 'uploads');
const configUploadsDir = '/config/fit_controller/uploads';

[
  dataUploadsDir,
  path.join(dataUploadsDir, 'videos'),
  path.join(dataUploadsDir, 'photos'),
  configUploadsDir,
  path.join(configUploadsDir, 'videos'),
  path.join(configUploadsDir, 'photos')
].forEach(dir => {
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  }
});

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Serve uploaded video and image files statically
app.use('/uploads', express.static(dataUploadsDir));
if (fs.existsSync(configUploadsDir)) {
  app.use('/uploads', express.static(configUploadsDir));
}

// Disable browser caching for HA Ingress webview
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));

// Endpoint: Upload custom exercise MP4 video or animation file
app.post('/api/upload-video', (req, res) => {
  try {
    const { filename, base64 } = req.body;
    if (!filename || !base64) {
      return res.status(400).json({ error: 'Filename y base64 son requeridos' });
    }

    const matches = base64.match(/^data:(video\/[a-zA-Z0-9]+|image\/[a-zA-Z0-9]+);base64,(.+)$/);
    let fileBuffer;
    if (matches) {
      fileBuffer = Buffer.from(matches[2], 'base64');
    } else {
      fileBuffer = Buffer.from(base64, 'base64');
    }

    const safeName = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const finalName = `${Date.now()}_${safeName}`;

    // Write to primary data directory
    const primaryVideoPath = path.join(dataUploadsDir, 'videos', finalName);
    fs.writeFileSync(primaryVideoPath, fileBuffer);

    // Mirror write to persistent /config/fit_controller backup directory
    if (fs.existsSync('/config')) {
      try {
        const backupVideoPath = path.join(configUploadsDir, 'videos', finalName);
        fs.writeFileSync(backupVideoPath, fileBuffer);
      } catch (e) {
        console.error('[PERSISTENCE] Error saving video backup to /config:', e);
      }
    }

    const publicUrl = `uploads/videos/${finalName}`;
    res.json({ success: true, url: publicUrl, filename: finalName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/upload-progress-photo', (req, res) => {
  try {
    const { base64, filename, pose, person_id } = req.body;
    if (!base64) {
      return res.status(400).json({ error: 'No se envió imagen' });
    }

    const matches = base64.match(/^data:(image\/[a-zA-Z0-9]+);base64,(.+)$/);
    let fileBuffer;
    if (matches) {
      fileBuffer = Buffer.from(matches[2], 'base64');
    } else {
      fileBuffer = Buffer.from(base64, 'base64');
    }

    const poseKey = pose || 'photo';
    const personKey = person_id ? `p${person_id}` : 'px';
    const safeName = (filename || 'progress.jpg').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const finalName = `${Date.now()}_${personKey}_${poseKey}_${safeName}`;

    // Write to primary data directory
    const primaryPath = path.join(dataUploadsDir, 'photos', finalName);
    fs.writeFileSync(primaryPath, fileBuffer);

    // Mirror to persistent /config directory
    if (fs.existsSync('/config')) {
      try {
        const backupPath = path.join(configUploadsDir, 'photos', finalName);
        fs.writeFileSync(backupPath, fileBuffer);
      } catch (e) {
        console.error('[PERSISTENCE] Error saving photo backup to /config:', e);
      }
    }

    const publicUrl = `uploads/photos/${finalName}`;
    res.json({ success: true, url: publicUrl, filename: finalName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
    backupDb();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// DIET & MEAL PLAN ENDPOINTS
// ----------------------------------------------------

function getMondayOfCurrentWeek(d = new Date()) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  return date.toISOString().split('T')[0];
}

function getNextMonday(d = new Date()) {
  const mon = new Date(getMondayOfCurrentWeek(d));
  mon.setDate(mon.getDate() + 7);
  return mon.toISOString().split('T')[0];
}

function checkAndPerformWeeklyRollover() {
  try {
    const user = db.prepare(`SELECT active_week_start FROM user_profile WHERE id = 1`).get();
    const currentCalMonday = getMondayOfCurrentWeek();

    if (!user || !user.active_week_start) {
      db.prepare(`UPDATE user_profile SET active_week_start = ? WHERE id = 1`).run(currentCalMonday);
      return false;
    }

    // Rollover is due if calendar monday is newer than stored active_week_start
    if (currentCalMonday > user.active_week_start) {
      console.log(`[ROLLOVER] Rollover due! Calendar Monday: ${currentCalMonday} > Stored: ${user.active_week_start}`);
      const nextMeals = db.prepare(`SELECT COUNT(*) as count FROM meal_plans WHERE week_type = 'next'`).get().count;

      db.exec('BEGIN');
      try {
        // 1. Discard old current week
        db.prepare(`DELETE FROM meal_plans WHERE week_type = 'current'`).run();

        // 2. If next week had meals, promote them to current
        if (nextMeals > 0) {
          db.prepare(`UPDATE meal_plans SET week_type = 'current' WHERE week_type = 'next'`).run();
          console.log(`[ROLLOVER] Promoted ${nextMeals} meals from 'next' to 'current'.`);
        }

        // 3. Update stored Monday to currentCalMonday
        db.prepare(`UPDATE user_profile SET active_week_start = ? WHERE id = 1`).run(currentCalMonday);
        db.exec('COMMIT');
        backupDb();
        return true;
      } catch (err) {
        db.exec('ROLLBACK');
        console.error('[ROLLOVER] Transaction failed:', err);
      }
    }
  } catch (err) {
    console.error('[ROLLOVER] Error checking rollover:', err);
  }
  return false;
}

// Check rollover on startup
checkAndPerformWeeklyRollover();

app.get('/api/diet/plan', (req, res) => {
  try {
    const peopleCount = parseInt(req.query.people || 1, 10);
    const requestedWeek = req.query.week === 'next' ? 'next' : 'current';

    // Perform check on access
    const rolloverOccurred = checkAndPerformWeeklyRollover();

    const plans = db.prepare(`
      SELECT mp.*, r.title as recipe_title, r.description, r.category, r.prep_time_min,
             r.servings, r.kcal, r.protein, r.carbs, r.fat, r.fiber,
             r.ingredients_json, r.instructions_json, r.image_url
      FROM meal_plans mp
      LEFT JOIN recipes r ON mp.recipe_id = r.id
      WHERE mp.week_type = ?
      ORDER BY mp.id ASC
    `).all(requestedWeek);

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
        week_type: p.week_type || 'current',
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

    const user = db.prepare(`SELECT active_week_start FROM user_profile WHERE id = 1`).get();
    const activeWeekStart = (user && user.active_week_start) || getMondayOfCurrentWeek();
    const nextWeekStart = getNextMonday(activeWeekStart);
    const currentWeekMealsCount = db.prepare(`SELECT COUNT(*) as count FROM meal_plans WHERE week_type = 'current'`).get().count;
    const nextWeekMealsCount = db.prepare(`SELECT COUNT(*) as count FROM meal_plans WHERE week_type = 'next'`).get().count;

    structured._meta = {
      week: requestedWeek,
      activeWeekStart,
      nextWeekStart,
      currentWeekMealsCount,
      nextWeekMealsCount,
      rolloverOccurred
    };

    res.json(structured);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/diet/plan', (req, res) => {
  try {
    const { day_of_week, meal_type, recipe_id, custom_title, people_count, week_type } = req.body;
    const targetWeek = week_type === 'next' ? 'next' : 'current';

    if (!day_of_week || !meal_type) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    // Check if slot exists in the targeted week, replace or insert
    const existing = db.prepare(`
      SELECT id FROM meal_plans 
      WHERE day_of_week = ? AND meal_type = ? AND week_type = ?
    `).get(day_of_week, meal_type, targetWeek);

    if (existing) {
      db.prepare(`
        UPDATE meal_plans SET recipe_id = ?, custom_title = ?, people_count = ? WHERE id = ?
      `).run(recipe_id || null, custom_title || null, people_count || 1, existing.id);
    } else {
      db.prepare(`
        INSERT INTO meal_plans (day_of_week, meal_type, recipe_id, custom_title, people_count, week_type)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(day_of_week, meal_type, recipe_id || null, custom_title || null, people_count || 1, targetWeek);
    }

    backupDb();
    res.json({ success: true, week_type: targetWeek });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/diet/plan/:id', (req, res) => {
  try {
    db.prepare(`DELETE FROM meal_plans WHERE id = ?`).run(req.params.id);
    backupDb();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manually trigger rollover: promote next week to current, discard old current week
app.post('/api/diet/rollover', (req, res) => {
  try {
    const nextMeals = db.prepare(`SELECT COUNT(*) as count FROM meal_plans WHERE week_type = 'next'`).get().count;

    db.exec('BEGIN');
    try {
      // 1. Delete current week meals
      db.prepare(`DELETE FROM meal_plans WHERE week_type = 'current'`).run();

      // 2. Promote next week meals to current week
      if (nextMeals > 0) {
        db.prepare(`UPDATE meal_plans SET week_type = 'current' WHERE week_type = 'next'`).run();
      }

      // 3. Update active_week_start in user_profile
      const currentCalMonday = getMondayOfCurrentWeek();
      db.prepare(`UPDATE user_profile SET active_week_start = ? WHERE id = 1`).run(currentCalMonday);

      db.exec('COMMIT');
      backupDb();
      res.json({
        success: true,
        promotedCount: nextMeals,
        message: nextMeals > 0
          ? `¡Próxima semana activada con éxito! Se han activado ${nextMeals} comidas y la semana queda lista.`
          : 'La semana actual ha sido reiniciada.'
      });
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Copy meal plan from one week to another (e.g. current -> next)
app.post('/api/diet/copy-week', (req, res) => {
  try {
    const fromWeek = req.body.from_week === 'next' ? 'next' : 'current';
    const toWeek = req.body.to_week === 'current' ? 'current' : 'next';

    const sourceMeals = db.prepare(`SELECT * FROM meal_plans WHERE week_type = ?`).all(fromWeek);
    if (sourceMeals.length === 0) {
      return res.status(400).json({ error: `No hay comidas en la ${fromWeek === 'next' ? 'próxima semana' : 'semana actual'} para copiar.` });
    }

    db.exec('BEGIN');
    try {
      // Clear destination week first
      db.prepare(`DELETE FROM meal_plans WHERE week_type = ?`).run(toWeek);

      const insertStmt = db.prepare(`
        INSERT INTO meal_plans (day_of_week, meal_type, recipe_id, custom_title, people_count, notes, week_type)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const m of sourceMeals) {
        insertStmt.run(m.day_of_week, m.meal_type, m.recipe_id, m.custom_title, m.people_count || 1, m.notes || '', toWeek);
      }

      db.exec('COMMIT');
      backupDb();
      res.json({
        success: true,
        count: sourceMeals.length,
        message: `Se han copiado ${sourceMeals.length} comidas a la ${toWeek === 'next' ? 'próxima semana' : 'semana actual'}.`
      });
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear an entire week's meal plan
app.post('/api/diet/clear-week', (req, res) => {
  try {
    const targetWeek = req.body.week_type === 'next' ? 'next' : 'current';
    const result = db.prepare(`DELETE FROM meal_plans WHERE week_type = ?`).run(targetWeek);
    backupDb();
    res.json({
      success: true,
      message: `Se ha vaciado el menú de la ${targetWeek === 'next' ? 'próxima semana' : 'semana actual'}.`
    });
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
    backupDb();
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate Consolidated Shopping List for the week (current or next)
app.get('/api/diet/shopping-list', (req, res) => {
  try {
    const targetWeek = req.query.week === 'next' ? 'next' : 'current';
    const defaultProfile = db.prepare(`SELECT default_people_count FROM user_profile WHERE id = 1`).get();
    const globalPeople = defaultProfile ? defaultProfile.default_people_count : 1;

    const plans = db.prepare(`
      SELECT mp.people_count, r.ingredients_json
      FROM meal_plans mp
      JOIN recipes r ON mp.recipe_id = r.id
      WHERE mp.week_type = ?
    `).all(targetWeek);

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

// Import custom recipes and weekly plan from AI JSON
app.post('/api/diet/import-json', (req, res) => {
  try {
    let bodyData = req.body.body !== undefined ? req.body.body : req.body;
    if (typeof bodyData === 'string') {
      try {
        bodyData = JSON.parse(bodyData);
      } catch (e) {
        return res.status(400).json({ error: 'El texto no es un JSON válido' });
      }
    }

    let recipesList = [];
    let planList = [];

    if (Array.isArray(bodyData)) {
      recipesList = bodyData;
    } else if (bodyData && typeof bodyData === 'object') {
      if (bodyData.recipes && Array.isArray(bodyData.recipes)) {
        recipesList = bodyData.recipes;
      }
      if (bodyData.plan && Array.isArray(bodyData.plan)) {
        planList = bodyData.plan;
      }
      if (bodyData.weekly_plan && Array.isArray(bodyData.weekly_plan)) {
        planList = bodyData.weekly_plan;
      }
      // Single recipe check
      if (!bodyData.recipes && !bodyData.plan && bodyData.title) {
        recipesList = [bodyData];
      }
    }

    let importedRecipesCount = 0;
    let importedPlanCount = 0;

    const titleToIdMap = {};

    // 1. Process Recipes
    recipesList.forEach(r => {
      if (!r.title) return;

      const existing = db.prepare(`SELECT id FROM recipes WHERE LOWER(title) = LOWER(?)`).get(r.title);
      let recipeId = null;

      const ingredientsJson = JSON.stringify(r.ingredients || []);
      const instructionsArray = Array.isArray(r.instructions)
        ? r.instructions
        : (typeof r.instructions === 'string' ? [r.instructions] : []);
      const instructionsJson = JSON.stringify(instructionsArray);

      if (existing) {
        recipeId = existing.id;
        db.prepare(`
          UPDATE recipes SET
            category = COALESCE(?, category),
            prep_time_min = COALESCE(?, prep_time_min),
            kcal = COALESCE(?, kcal),
            protein = COALESCE(?, protein),
            carbs = COALESCE(?, carbs),
            fat = COALESCE(?, fat),
            ingredients_json = ?,
            instructions_json = ?
          WHERE id = ?
        `).run(
          r.category || 'almuerzo',
          r.prep_time_min || 15,
          r.kcal || 300,
          r.protein || 0,
          r.carbs || 0,
          r.fat || 0,
          ingredientsJson,
          instructionsJson,
          recipeId
        );
      } else {
        const stmt = db.prepare(`
          INSERT INTO recipes (title, description, category, prep_time_min, servings, kcal, protein, carbs, fat, fiber, ingredients_json, instructions_json, image_url, is_custom)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `);
        const result = stmt.run(
          r.title,
          r.description || '',
          r.category || 'almuerzo',
          r.prep_time_min || 15,
          r.servings || 1,
          r.kcal || 300,
          r.protein || 0,
          r.carbs || 0,
          r.fat || 0,
          r.fiber || 0,
          ingredientsJson,
          instructionsJson,
          r.image_url || ''
        );
        recipeId = result.lastInsertRowid;
        importedRecipesCount++;
      }

      titleToIdMap[r.title.toLowerCase()] = recipeId;
    });

    // 2. Process Weekly Plan Items
    const targetWeek = (req.body.week_type || bodyData.week_type || 'current') === 'next' ? 'next' : 'current';

    planList.forEach(item => {
      const day = (item.day_of_week || item.day || '').toLowerCase();
      const mealType = (item.meal_type || item.meal || item.type || '').toLowerCase();
      const recipeTitle = item.recipe_title || item.title || item.recipe || '';

      if (!day || !mealType) return;

      let recipeId = null;
      if (recipeTitle && titleToIdMap[recipeTitle.toLowerCase()]) {
        recipeId = titleToIdMap[recipeTitle.toLowerCase()];
      } else if (recipeTitle) {
        const found = db.prepare(`SELECT id FROM recipes WHERE LOWER(title) = LOWER(?)`).get(recipeTitle);
        if (found) recipeId = found.id;
      }

      const existingPlan = db.prepare(`SELECT id FROM meal_plans WHERE day_of_week = ? AND meal_type = ? AND week_type = ?`).get(day, mealType, targetWeek);
      if (existingPlan) {
        db.prepare(`UPDATE meal_plans SET recipe_id = ?, custom_title = ? WHERE id = ?`)
          .run(recipeId, recipeTitle || null, existingPlan.id);
      } else {
        db.prepare(`INSERT INTO meal_plans (day_of_week, meal_type, recipe_id, custom_title, people_count, week_type) VALUES (?, ?, ?, ?, 1, ?)`)
          .run(day, mealType, recipeId, recipeTitle || null, targetWeek);
      }

      importedPlanCount++;
    });

    backupDb();

    res.json({
      success: true,
      importedRecipesCount,
      importedPlanCount,
      targetWeek,
      message: `Importación completada: ${importedRecipesCount} platos procesados y ${importedPlanCount} asignaciones añadidas a la ${targetWeek === 'next' ? 'próxima semana' : 'semana actual'}.`
    });
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

app.put('/api/recipes/:id', (req, res) => {
  try {
    const { title, description, category, prep_time_min, servings, kcal, protein, carbs, fat, fiber, ingredients, instructions, image_url } = req.body;

    db.prepare(`
      UPDATE recipes 
      SET title = ?, description = ?, category = ?, prep_time_min = ?, servings = ?, kcal = ?, protein = ?, carbs = ?, fat = ?, fiber = ?, ingredients_json = ?, instructions_json = ?, image_url = ?
      WHERE id = ?
    `).run(
      title, description || '', category || 'almuerzo', prep_time_min || 15, servings || 1,
      parseInt(kcal, 10), parseInt(protein || 0, 10), parseInt(carbs || 0, 10), parseInt(fat || 0, 10), parseInt(fiber || 0, 10),
      JSON.stringify(ingredients || []), JSON.stringify(instructions || []), image_url || '',
      req.params.id
    );

    res.json({ success: true });
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

app.put('/api/workout/routines/:id', (req, res) => {
  try {
    const { name, day_of_week, description } = req.body;
    db.prepare(`UPDATE routines SET name = ?, day_of_week = ?, description = ? WHERE id = ?`)
      .run(name, day_of_week || 'lunes', description || '', req.params.id);
    res.json({ success: true });
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

app.put('/api/workout/routine-exercises/reorder', (req, res) => {
  try {
    const { routine_id, ordered_ids } = req.body;
    if (!routine_id || !Array.isArray(ordered_ids)) {
      return res.status(400).json({ error: 'routine_id y ordered_ids son requeridos' });
    }

    const updateStmt = db.prepare(`UPDATE routine_exercises SET order_index = ? WHERE id = ? AND routine_id = ?`);
    db.exec('BEGIN');
    try {
      ordered_ids.forEach((id, index) => {
        updateStmt.run(index + 1, id, routine_id);
      });
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw e;
    }

    backupDb();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/workout/routine-exercise/:id', (req, res) => {
  try {
    const { sets, reps, weight_kg, rest_sec } = req.body;
    db.prepare(`
      UPDATE routine_exercises
      SET sets = ?, reps = ?, weight_kg = ?, rest_sec = ?
      WHERE id = ?
    `).run(
      parseInt(sets || 3, 10),
      parseInt(reps || 12, 10),
      parseFloat(weight_kg || 0),
      parseInt(rest_sec || 60, 10),
      req.params.id
    );
    res.json({ success: true });
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

// ----------------------------------------------------
// MUSIC PLAYLIST ENDPOINTS
// ----------------------------------------------------

app.get('/api/music/playlists', (req, res) => {
  try {
    const playlists = db.prepare(`SELECT * FROM music_playlists ORDER BY id ASC`).all();
    res.json(playlists);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/music/playlists', (req, res) => {
  try {
    const { title, url } = req.body;
    if (!title || !url) {
      return res.status(400).json({ error: 'Título y URL son requeridos' });
    }
    const stmt = db.prepare(`INSERT INTO music_playlists (title, url) VALUES (?, ?)`);
    const result = stmt.run(title, url);
    res.json({ id: result.lastInsertRowid, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/music/playlists/:id', (req, res) => {
  try {
    const { title, url } = req.body;
    db.prepare(`UPDATE music_playlists SET title = ?, url = ? WHERE id = ?`).run(title, url, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/music/playlists/:id', (req, res) => {
  try {
    db.prepare(`DELETE FROM music_playlists WHERE id = ?`).run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// PEOPLE & BODY PROGRESS ENDPOINTS
// ----------------------------------------------------

app.get('/api/people', (req, res) => {
  try {
    const rows = db.prepare(`SELECT * FROM people ORDER BY id ASC`).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/people', (req, res) => {
  try {
    const { name, gender, height_cm, target_weight_kg } = req.body;
    if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });

    const stmt = db.prepare(`
      INSERT INTO people (name, gender, height_cm, target_weight_kg)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(name, gender || 'female', parseFloat(height_cm || 170), parseFloat(target_weight_kg || 65));
    backupDb();
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/people/:id', (req, res) => {
  try {
    const { name, gender, height_cm, target_weight_kg } = req.body;
    db.prepare(`
      UPDATE people SET name = ?, gender = ?, height_cm = ?, target_weight_kg = ?
      WHERE id = ?
    `).run(name, gender || 'female', parseFloat(height_cm || 170), parseFloat(target_weight_kg || 65), req.params.id);
    backupDb();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/people/:id', (req, res) => {
  try {
    db.prepare(`DELETE FROM body_progress WHERE person_id = ?`).run(req.params.id);
    db.prepare(`DELETE FROM people WHERE id = ?`).run(req.params.id);
    backupDb();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/progress', (req, res) => {
  try {
    const { person_id } = req.query;
    let sql = `SELECT * FROM body_progress`;
    const params = [];
    if (person_id) {
      sql += ` WHERE person_id = ?`;
      params.push(person_id);
    }
    sql += ` ORDER BY date ASC, id ASC`;
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/progress', (req, res) => {
  try {
    const { person_id, date, weight_kg, chest_cm, waist_cm, hips_cm, arm_cm, thigh_cm, photo_front, photo_side, photo_back, notes } = req.body;
    if (!person_id || !weight_kg) {
      return res.status(400).json({ error: 'Persona y peso son requeridos' });
    }

    const regDate = date || new Date().toISOString().split('T')[0];

    const stmt = db.prepare(`
      INSERT INTO body_progress (person_id, date, weight_kg, chest_cm, waist_cm, hips_cm, arm_cm, thigh_cm, photo_front, photo_side, photo_back, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      person_id,
      regDate,
      parseFloat(weight_kg),
      chest_cm ? parseFloat(chest_cm) : null,
      waist_cm ? parseFloat(waist_cm) : null,
      hips_cm ? parseFloat(hips_cm) : null,
      arm_cm ? parseFloat(arm_cm) : null,
      thigh_cm ? parseFloat(thigh_cm) : null,
      photo_front || '',
      photo_side || '',
      photo_back || '',
      notes || ''
    );

    backupDb();
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/progress/:id', (req, res) => {
  try {
    const { date, weight_kg, chest_cm, waist_cm, hips_cm, arm_cm, thigh_cm, photo_front, photo_side, photo_back, notes } = req.body;
    db.prepare(`
      UPDATE body_progress SET
        date = ?, weight_kg = ?, chest_cm = ?, waist_cm = ?, hips_cm = ?, arm_cm = ?, thigh_cm = ?,
        photo_front = ?, photo_side = ?, photo_back = ?, notes = ?
      WHERE id = ?
    `).run(
      date,
      parseFloat(weight_kg),
      chest_cm ? parseFloat(chest_cm) : null,
      waist_cm ? parseFloat(waist_cm) : null,
      hips_cm ? parseFloat(hips_cm) : null,
      arm_cm ? parseFloat(arm_cm) : null,
      thigh_cm ? parseFloat(thigh_cm) : null,
      photo_front || '',
      photo_side || '',
      photo_back || '',
      notes || '',
      req.params.id
    );

    backupDb();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/progress/:id', (req, res) => {
  try {
    db.prepare(`DELETE FROM body_progress WHERE id = ?`).run(req.params.id);
    backupDb();
    res.json({ success: true });
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
