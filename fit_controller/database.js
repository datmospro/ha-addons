const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || (fs.existsSync('/data') ? '/data/fitcontroller.db' : path.join(__dirname, 'fitcontroller.db'));

const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

console.log(`Initializing FitController database at: ${dbPath}`);
const db = new DatabaseSync(dbPath);

function initDb() {
  // 1. User Profile table
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY DEFAULT 1,
      name TEXT DEFAULT 'Usuario Fit',
      age INTEGER DEFAULT 30,
      gender TEXT DEFAULT 'male',
      weight_kg REAL DEFAULT 80,
      height_cm REAL DEFAULT 175,
      activity_level TEXT DEFAULT 'moderate',
      target_weight_kg REAL DEFAULT 72,
      weekly_weight_loss_kg REAL DEFAULT 0.5,
      daily_kcal_target INTEGER DEFAULT 1850,
      daily_protein_target INTEGER DEFAULT 140,
      daily_carbs_target INTEGER DEFAULT 160,
      daily_fat_target INTEGER DEFAULT 55,
      default_people_count INTEGER DEFAULT 1
    )
  `);

  // Ensure 1 default profile exists
  const profileCount = db.prepare(`SELECT COUNT(*) as count FROM user_profile`).get().count;
  if (profileCount === 0) {
    db.prepare(`
      INSERT INTO user_profile (id, name, age, gender, weight_kg, height_cm, activity_level, target_weight_kg, daily_kcal_target, daily_protein_target, daily_carbs_target, daily_fat_target, default_people_count)
      VALUES (1, 'Mi Perfil Fit', 30, 'male', 80.0, 175.0, 'moderate', 72.0, 1850, 140, 160, 55, 1)
    `).run();
  }

  // 2. Recipes table
  db.exec(`
    CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT CHECK(category IN ('desayuno', 'almuerzo', 'merienda', 'cena', 'snack')),
      prep_time_min INTEGER DEFAULT 15,
      servings INTEGER DEFAULT 1,
      kcal INTEGER NOT NULL,
      protein INTEGER NOT NULL,
      carbs INTEGER NOT NULL,
      fat INTEGER NOT NULL,
      fiber INTEGER DEFAULT 0,
      ingredients_json TEXT NOT NULL,
      instructions_json TEXT NOT NULL,
      image_url TEXT,
      is_custom INTEGER DEFAULT 1
    )
  `);

  // 3. Meal Plans table
  db.exec(`
    CREATE TABLE IF NOT EXISTS meal_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_of_week TEXT NOT NULL CHECK(day_of_week IN ('lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo')),
      meal_type TEXT NOT NULL CHECK(meal_type IN ('desayuno', 'almuerzo', 'merienda', 'cena', 'snack')),
      recipe_id INTEGER,
      custom_title TEXT,
      people_count INTEGER DEFAULT 1,
      notes TEXT,
      FOREIGN KEY(recipe_id) REFERENCES recipes(id) ON DELETE SET NULL
    )
  `);

  // 4. Exercises table
  db.exec(`
    CREATE TABLE IF NOT EXISTS exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      muscle_group TEXT NOT NULL CHECK(muscle_group IN ('pecho', 'espalda', 'piernas', 'hombros', 'brazos', 'core', 'cardio')),
      equipment TEXT DEFAULT 'Mancuernas / Corporal',
      difficulty TEXT DEFAULT 'Intermedio',
      instructions TEXT,
      animation_type TEXT DEFAULT 'svg',
      animation_data TEXT,
      animation_url TEXT,
      default_sets INTEGER DEFAULT 3,
      default_reps INTEGER DEFAULT 12,
      default_rest_sec INTEGER DEFAULT 60
    )
  `);

  // 5. Routines table
  db.exec(`
    CREATE TABLE IF NOT EXISTS routines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      day_of_week TEXT CHECK(day_of_week IN ('lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo')),
      description TEXT
    )
  `);

  // 6. Routine Exercises
  db.exec(`
    CREATE TABLE IF NOT EXISTS routine_exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      routine_id INTEGER NOT NULL,
      exercise_id INTEGER NOT NULL,
      order_index INTEGER DEFAULT 0,
      sets INTEGER DEFAULT 3,
      reps INTEGER DEFAULT 12,
      weight_kg REAL DEFAULT 0,
      rest_sec INTEGER DEFAULT 60,
      FOREIGN KEY(routine_id) REFERENCES routines(id) ON DELETE CASCADE,
      FOREIGN KEY(exercise_id) REFERENCES exercises(id) ON DELETE CASCADE
    )
  `);

  // 7. Workout Logs
  db.exec(`
    CREATE TABLE IF NOT EXISTS workout_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      routine_id INTEGER,
      routine_name TEXT NOT NULL,
      duration_sec INTEGER NOT NULL,
      total_volume_kg REAL DEFAULT 0,
      sets_completed INTEGER DEFAULT 0,
      kcal_burned INTEGER DEFAULT 0,
      completed_at TEXT NOT NULL,
      notes TEXT
    )
  `);

  seedDefaultData();
}

function seedDefaultData() {
  // Seed Recipes if table is empty
  const recipeCount = db.prepare(`SELECT COUNT(*) as count FROM recipes`).get().count;
  if (recipeCount === 0) {
    const defaultRecipes = [
      {
        title: "Tortilla Fit de Claras y Espinacas",
        description: "Desayuno alto en proteína y muy bajo en calorías, ideal para quemar grasa.",
        category: "desayuno",
        prep_time_min: 10,
        servings: 1,
        kcal: 220,
        protein: 28,
        carbs: 6,
        fat: 8,
        fiber: 3,
        ingredients_json: JSON.stringify([
          { name: "Claras de huevo", amount: 200, unit: "ml" },
          { name: "Huevo entero", amount: 1, unit: "unidad" },
          { name: "Espinacas frescas", amount: 50, unit: "g" },
          { name: "Queso fresco batido 0%", amount: 30, unit: "g" },
          { name: "Aceite de oliva virgen extra", amount: 3, unit: "ml" }
        ]),
        instructions_json: JSON.stringify([
          "Picar las espinacas frescas.",
          "Batir el huevo entero con las claras en un bol y añadir una pizca de sal y pimienta.",
          "Calentar la sartén antiadherente con unas gotas de aceite de oliva.",
          "Saltear brevemente las espinacas y verter las claras batidas.",
          "Cuajar a fuego medio-bajo por ambos lados y servir caliente con el queso fresco."
        ]),
        image_url: "https://images.unsplash.com/photo-1525351484163-7529414344d8?w=500&auto=format&fit=crop&q=80",
        is_custom: 0
      },
      {
        title: "Bowl de Pollo a la Plancha con Quinoa y Aguacate",
        description: "Almuerzo completo con proteína magra, carbohidratos complejos de absorción lenta y grasas saludables.",
        category: "almuerzo",
        prep_time_min: 20,
        servings: 1,
        kcal: 480,
        protein: 42,
        carbs: 45,
        fat: 14,
        fiber: 7,
        ingredients_json: JSON.stringify([
          { name: "Pechuga de pollo magra", amount: 180, unit: "g" },
          { name: "Quinoa cocida", amount: 120, unit: "g" },
          { name: "Aguacate", amount: 40, unit: "g" },
          { name: "Tomates cherry", amount: 80, unit: "g" },
          { name: "Canónigos o rúcula", amount: 40, unit: "g" },
          { name: "Zumo de limón y orégano", amount: 1, unit: "al gusto" }
        ]),
        instructions_json: JSON.stringify([
          "Sazonar la pechuga de pollo con ajo en polvo, orégano, sal y pimienta.",
          "Cocinar la pechuga a la plancha a fuego medio-alto hasta que quede dorada y jugosa.",
          "En un bowl, disponer la base de canónigos y la quinoa cocida.",
          "Añadir los tomates cherry cortados por la mitad, las lonchas de pollo y el aguacate troceado.",
          "Aliñar con zumo de limón y una pizca de sal marina."
        ]),
        image_url: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=500&auto=format&fit=crop&q=80",
        is_custom: 0
      },
      {
        title: "Salmón al Horno con Espárragos y Limón",
        description: "Cena rica en Omega-3 y súper saciante para optimizar la quema de grasa nocturna.",
        category: "cena",
        prep_time_min: 25,
        servings: 1,
        kcal: 430,
        protein: 36,
        carbs: 8,
        fat: 26,
        fiber: 4,
        ingredients_json: JSON.stringify([
          { name: "Lomo de salmón fresco", amount: 180, unit: "g" },
          { name: "Espárragos verdes", amount: 150, unit: "g" },
          { name: "Rodajas de limón", amount: 3, unit: "rodajas" },
          { name: "Aceite de oliva virgen extra", amount: 5, unit: "ml" },
          { name: "Eneldo y pimienta negra", amount: 1, unit: "al gusto" }
        ]),
        instructions_json: JSON.stringify([
          "Precalentar el horno a 200°C.",
          "Colocar los espárragos verdes limpios en una bandeja de horno.",
          "Disponer el lomo de salmón sobre los espárragos, pincelar con el aceite de oliva y sazonar con eneldo, sal y pimienta.",
          "Colocar las rodajas de limón encima del salmón.",
          "Hornear durante 15 minutos hasta que el salmón esté tierno y los espárragos crujientes."
        ]),
        image_url: "https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=500&auto=format&fit=crop&q=80",
        is_custom: 0
      },
      {
        title: "Batido Saciante Proteico de Frutos Rojos",
        description: "Merienda exprés baja en calorías, perfecta para calmar la ansiedad entre comidas.",
        category: "merienda",
        prep_time_min: 5,
        servings: 1,
        kcal: 190,
        protein: 24,
        carbs: 18,
        fat: 2,
        fiber: 5,
        ingredients_json: JSON.stringify([
          { name: "Proteína de suero (Whey) sabor vainilla", amount: 25, unit: "g" },
          { name: "Frutos rojos congelados", amount: 100, unit: "g" },
          { name: "Bebida de almendras sin azúcar", amount: 250, unit: "ml" },
          { name: "Semillas de chía", amount: 10, unit: "g" }
        ]),
        instructions_json: JSON.stringify([
          "Añadir la bebida de almendras, los frutos rojos y la proteína en la batidora.",
          "Triturar durante 45 segundos hasta obtener una textura suave y cremosa.",
          "Servir en un vaso alto y espolvorear las semillas de chía por encima."
        ]),
        image_url: "https://images.unsplash.com/photo-1553530666-ba11a7da3888?w=500&auto=format&fit=crop&q=80",
        is_custom: 0
      },
      {
        title: "Pavo Salteado con Verduras y Champiñones",
        description: "Cena ligera, proteica y súper baja en carbohidratos.",
        category: "cena",
        prep_time_min: 15,
        servings: 1,
        kcal: 310,
        protein: 38,
        carbs: 12,
        fat: 10,
        fiber: 5,
        ingredients_json: JSON.stringify([
          { name: "Solomillo o pechuga de pavo", amount: 180, unit: "g" },
          { name: "Champiñones laminados", amount: 100, unit: "g" },
          { name: "Calabacín en dados", amount: 100, unit: "g" },
          { name: "Pimiento rojo y verde", amount: 80, unit: "g" },
          { name: "Salsa de soja baja en sodio", amount: 15, unit: "ml" }
        ]),
        instructions_json: JSON.stringify([
          "Cortar el pavo en tiras finas.",
          "En una sartén bien caliente o wok, saltear las tiras de pavo con 3ml de aceite durante 4-5 minutos.",
          "Añadir el pimiento, calabacín y champiñones.",
          "Verter la salsa de soja y cocinar 5 minutos más a fuego vivo removiendo constantemente.",
          "Servir caliente."
        ]),
        image_url: "https://images.unsplash.com/photo-1603133872878-684f208fb84b?w=500&auto=format&fit=crop&q=80",
        is_custom: 0
      }
    ];

    const stmt = db.prepare(`
      INSERT INTO recipes (title, description, category, prep_time_min, servings, kcal, protein, carbs, fat, fiber, ingredients_json, instructions_json, image_url, is_custom)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const r of defaultRecipes) {
      stmt.run(r.title, r.description, r.category, r.prep_time_min, r.servings, r.kcal, r.protein, r.carbs, r.fat, r.fiber, r.ingredients_json, r.instructions_json, r.image_url, r.is_custom);
    }
  }

  // Seed Meal Plans if empty
  const mealPlanCount = db.prepare(`SELECT COUNT(*) as count FROM meal_plans`).get().count;
  if (mealPlanCount === 0) {
    const stmtMeal = db.prepare(`
      INSERT INTO meal_plans (day_of_week, meal_type, recipe_id, people_count)
      VALUES (?, ?, ?, 1)
    `);
    // Seed Monday to Friday with initial plan
    stmtMeal.run('lunes', 'desayuno', 1);
    stmtMeal.run('lunes', 'almuerzo', 2);
    stmtMeal.run('lunes', 'merienda', 4);
    stmtMeal.run('lunes', 'cena', 3);

    stmtMeal.run('martes', 'desayuno', 1);
    stmtMeal.run('martes', 'almuerzo', 2);
    stmtMeal.run('martes', 'cena', 5);

    stmtMeal.run('miercoles', 'desayuno', 1);
    stmtMeal.run('miercoles', 'almuerzo', 2);
    stmtMeal.run('miercoles', 'cena', 3);
  }

  // Seed Exercises if empty
  const exerciseCount = db.prepare(`SELECT COUNT(*) as count FROM exercises`).get().count;
  if (exerciseCount === 0) {
    const defaultExercises = [
      {
        name: "Sentadillas profundas (Squat)",
        muscle_group: "piernas",
        equipment: "Peso corporal / Barra",
        difficulty: "Principiante",
        instructions: "Mantén la espalda recta, desciende flexionando rodillas y cadera hasta romper el paralelo de 90°. Empuja con los talones al subir.",
        animation_type: "svg",
        animation_data: "squat",
        animation_url: "https://gymvisual.com/img/p/2/0/8/8/2088.gif",
        default_sets: 4,
        default_reps: 12,
        default_rest_sec: 60
      },
      {
        name: "Flexiones de Pecho (Push-ups)",
        muscle_group: "pecho",
        equipment: "Peso corporal",
        difficulty: "Principiante",
        instructions: "Manos a la anchura de los hombros, cuerpo en línea recta desde la cabeza hasta los pies. Baja el pecho casi a tocar el suelo y empuja explosivo.",
        animation_type: "svg",
        animation_data: "pushup",
        animation_url: "https://gymvisual.com/img/p/2/7/2/6/2726.gif",
        default_sets: 3,
        default_reps: 15,
        default_rest_sec: 45
      },
      {
        name: "Press de Banca con Mancuernas",
        muscle_group: "pecho",
        equipment: "Mancuernas + Banco",
        difficulty: "Intermedio",
        instructions: "Tumbado en banco horizontal, baja las mancuernas hasta el nivel del pecho sintiendo el estiramiento y empuja arriba sin bloquear codos.",
        animation_type: "svg",
        animation_data: "benchpress",
        animation_url: "https://gymvisual.com/img/p/2/4/9/4/2494.gif",
        default_sets: 4,
        default_reps: 10,
        default_rest_sec: 75
      },
      {
        name: "Remo con Mancuerna a una mano",
        muscle_group: "espalda",
        equipment: "Mancuerna + Banco",
        difficulty: "Intermedio",
        instructions: "Apoya rodilla y mano en banco. Tracciona la mancuerna hacia la cadera llevando el codo bien pegado al cuerpo.",
        animation_type: "svg",
        animation_data: "row",
        animation_url: "https://gymvisual.com/img/p/1/7/8/9/1789.gif",
        default_sets: 4,
        default_reps: 12,
        default_rest_sec: 60
      },
      {
        name: "Press Militar de Hombros",
        muscle_group: "hombros",
        equipment: "Mancuernas",
        difficulty: "Intermedio",
        instructions: "Sentado o de pie, eleva las mancuernas desde la altura de las orejas hacia arriba sobre la cabeza con control.",
        animation_type: "svg",
        animation_data: "shoulderpress",
        animation_url: "https://gymvisual.com/img/p/2/1/1/2/2112.gif",
        default_sets: 3,
        default_reps: 12,
        default_rest_sec: 60
      },
      {
        name: "Curl de Bíceps con Mancuernas",
        muscle_group: "brazos",
        equipment: "Mancuernas",
        difficulty: "Principiante",
        instructions: "Mantén codos fijos a los lados del torso. Flexiona los antebrazos contrayendo el bíceps arriba y baja lentamente.",
        animation_type: "svg",
        animation_data: "bicepcurl",
        animation_url: "https://gymvisual.com/img/p/2/1/6/7/2167.gif",
        default_sets: 3,
        default_reps: 12,
        default_rest_sec: 45
      },
      {
        name: "Fondos de Tríceps en Banco",
        muscle_group: "brazos",
        equipment: "Banco / Silla",
        difficulty: "Principiante",
        instructions: "Manos apoyadas en borde del banco. Flexiona codos a 90° bajando la cadera y empuja para volver a la posición inicial.",
        animation_type: "svg",
        animation_data: "tricepdip",
        animation_url: "https://gymvisual.com/img/p/2/3/8/5/2385.gif",
        default_sets: 3,
        default_reps: 15,
        default_rest_sec: 45
      },
      {
        name: "Plancha Abdominal Isometrica",
        muscle_group: "core",
        equipment: "Esterilla",
        difficulty: "Principiante",
        instructions: "Apoyo en antebrazos y puntas de los pies. Mantén espalda y glúteos totalmente alineados sin dejar caer la cadera.",
        animation_type: "svg",
        animation_data: "plank",
        animation_url: "https://gymvisual.com/img/p/2/6/4/9/2649.gif",
        default_sets: 3,
        default_reps: 45, // seconds for plank
        default_rest_sec: 45
      },
      {
        name: "Zancadas / Lunges Alternadas",
        muscle_group: "piernas",
        equipment: "Peso corporal / Mancuernas",
        difficulty: "Principiante",
        instructions: "Da un paso amplio adelante flexionado ambas rodillas a 90°. La rodilla trasera no toca el suelo. Vuelve e intercambia pierna.",
        animation_type: "svg",
        animation_data: "lunge",
        animation_url: "https://gymvisual.com/img/p/2/2/3/1/2231.gif",
        default_sets: 3,
        default_reps: 12,
        default_rest_sec: 60
      },
      {
        name: "Jumping Jacks (Cardio Quemagrasa)",
        muscle_group: "cardio",
        equipment: "Ninguno",
        difficulty: "Principiante",
        instructions: "Salto abriendo piernas y dando palmada arriba con las manos, vuelve cerrando pies y brazos. Mantén un ritmo ágil.",
        animation_type: "svg",
        animation_data: "jumpingjacks",
        animation_url: "https://gymvisual.com/img/p/2/5/9/0/2590.gif",
        default_sets: 3,
        default_reps: 30,
        default_rest_sec: 30
      }
    ];

    const stmtEx = db.prepare(`
      INSERT INTO exercises (name, muscle_group, equipment, difficulty, instructions, animation_type, animation_data, animation_url, default_sets, default_reps, default_rest_sec)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const ex of defaultExercises) {
      stmtEx.run(ex.name, ex.muscle_group, ex.equipment, ex.difficulty, ex.instructions, ex.animation_type, ex.animation_data, ex.animation_url, ex.default_sets, ex.default_reps, ex.default_rest_sec);
    }
  }

  // Seed default routine if empty
  const routineCount = db.prepare(`SELECT COUNT(*) as count FROM routines`).get().count;
  if (routineCount === 0) {
    const routineStmt = db.prepare(`INSERT INTO routines (name, day_of_week, description) VALUES (?, ?, ?)`);
    const r1 = routineStmt.run('Rutina Fullbody Quemagrasa', 'lunes', 'Entrenamiento completo para activar el metabolismo y tonificar músculo.');
    const r2 = routineStmt.run('Torso & Core Quemacalorías', 'miercoles', 'Trabajo de pecho, espalda, hombros y abdominales.');
    const r3 = routineStmt.run('Pierna & Cardio HIIT', 'viernes', 'Rutina intesa de piernas y aceleración metabólica.');

    const reStmt = db.prepare(`
      INSERT INTO routine_exercises (routine_id, exercise_id, order_index, sets, reps, weight_kg, rest_sec)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    // Assign to r1 (Fullbody)
    reStmt.run(r1.lastInsertRowid, 1, 1, 4, 12, 0, 60); // Squat
    reStmt.run(r1.lastInsertRowid, 2, 2, 3, 12, 0, 45); // Pushups
    reStmt.run(r1.lastInsertRowid, 4, 3, 3, 12, 10, 60); // Row
    reStmt.run(r1.lastInsertRowid, 8, 4, 3, 40, 0, 45); // Plank

    // Assign to r2 (Torso)
    reStmt.run(r2.lastInsertRowid, 3, 1, 4, 10, 14, 75); // Bench press
    reStmt.run(r2.lastInsertRowid, 4, 2, 4, 12, 12, 60); // Row
    reStmt.run(r2.lastInsertRowid, 5, 3, 3, 12, 8, 60); // Shoulder press
    reStmt.run(r2.lastInsertRowid, 6, 4, 3, 12, 8, 45); // Bicep curl

    // Assign to r3 (Pierna & Cardio)
    reStmt.run(r3.lastInsertRowid, 1, 1, 4, 15, 0, 60); // Squat
    reStmt.run(r3.lastInsertRowid, 9, 2, 3, 12, 0, 60); // Lunges
    reStmt.run(r3.lastInsertRowid, 10, 3, 4, 40, 0, 30); // Jumping jacks
    reStmt.run(r3.lastInsertRowid, 8, 4, 3, 45, 0, 45); // Plank
  }
}

module.exports = {
  db,
  initDb
};
