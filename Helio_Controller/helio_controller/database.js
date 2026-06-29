const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// Database path (production: /data/heliocontroller.db, development: local file)
const dbPath = process.env.DB_PATH || (fs.existsSync('/data') ? '/data/heliocontroller.db' : path.join(__dirname, 'heliocontroller.db'));

// Ensure the directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

console.log(`Initializing database at: ${dbPath}`);
const db = new DatabaseSync(dbPath);

function initDb() {
  // 1. Run migrations if necessary to convert watering/climate templates to per-crop
  let runMigration = false;
  try {
    const info = db.prepare("PRAGMA table_info(watering_templates)").all();
    const hasCropId = info.some(col => col.name === 'crop_id');
    if (!hasCropId) {
      runMigration = true;
    }
  } catch (err) {
    // Table doesn't exist, no migration needed
  }

  if (runMigration) {
    console.log("Migrating database tables to support per-crop templates...");
    try {
      db.exec("DROP TABLE IF EXISTS watering_templates");
      db.exec("DROP TABLE IF EXISTS climate_templates");
    } catch (e) {
      console.error("Migration drop tables error:", e);
    }
  }

  // 1. Crops table
  db.exec(`
    CREATE TABLE IF NOT EXISTS crops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      start_date TEXT NOT NULL, -- YYYY-MM-DD
      end_date TEXT, -- YYYY-MM-DD
      status TEXT NOT NULL CHECK(status IN ('active', 'archived')),
      num_plants INTEGER NOT NULL DEFAULT 84,
      pot_size_l REAL NOT NULL DEFAULT 11.0,
      notes TEXT
    )
  `);

  // 2. Watering templates (ratios and per-plant amounts, per crop)
  db.exec(`
    CREATE TABLE IF NOT EXISTS watering_templates (
      crop_id INTEGER,
      riego_num REAL,
      phase TEXT NOT NULL CHECK(phase IN ('Crecimiento', 'Floración')),
      week INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('Abono', 'Mant.', 'Lavado 1', 'Lavado 2', 'Secado')),
      water_per_plant REAL NOT NULL, -- Liters of water per plant
      silica_power REAL NOT NULL DEFAULT 0.0, -- ml per Liter
      calmag REAL NOT NULL DEFAULT 0.0, -- ml per Liter
      jj_micro REAL NOT NULL DEFAULT 0.0,
      jj_grow REAL NOT NULL DEFAULT 0.0,
      jj_bloom REAL NOT NULL DEFAULT 0.0,
      voodoo_juice REAL NOT NULL DEFAULT 0.0,
      bud_candy REAL NOT NULL DEFAULT 0.0,
      big_bud REAL NOT NULL DEFAULT 0.0,
      monster_bloom REAL NOT NULL DEFAULT 0.0, -- g or ml per Liter
      bac_f1 REAL NOT NULL DEFAULT 0.0, -- g or ml per Liter
      enzymes REAL NOT NULL DEFAULT 0.0,
      flawless_finish REAL NOT NULL DEFAULT 0.0,
      PRIMARY KEY (crop_id, riego_num),
      FOREIGN KEY (crop_id) REFERENCES crops(id) ON DELETE CASCADE
    )
  `);

  // 3. Climate templates (per crop)
  db.exec(`
    CREATE TABLE IF NOT EXISTS climate_templates (
      crop_id INTEGER,
      riego_num REAL,
      height_min REAL,
      height_max REAL,
      led_power REAL NOT NULL, -- 0.0 to 1.0 (e.g. 0.3 for 30%)
      light_distance INTEGER NOT NULL, -- cm
      temp_day REAL NOT NULL,
      temp_night REAL NOT NULL,
      humidity INTEGER NOT NULL, -- %
      vpd REAL NOT NULL, -- kPa
      extractor REAL NOT NULL, -- 0.0 to 1.0
      poda_info TEXT,
      PRIMARY KEY (crop_id, riego_num),
      FOREIGN KEY (crop_id) REFERENCES crops(id) ON DELETE CASCADE
    )
  `);

  // 4. Completed waterings
  db.exec(`
    CREATE TABLE IF NOT EXISTS completed_waterings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crop_id INTEGER NOT NULL,
      riego_num REAL NOT NULL,
      date TEXT NOT NULL, -- YYYY-MM-DD HH:MM
      water_liters REAL NOT NULL,
      plants_count INTEGER NOT NULL,
      silica_power REAL NOT NULL DEFAULT 0.0, -- actual ml
      calmag REAL NOT NULL DEFAULT 0.0,
      jj_micro REAL NOT NULL DEFAULT 0.0,
      jj_grow REAL NOT NULL DEFAULT 0.0,
      jj_bloom REAL NOT NULL DEFAULT 0.0,
      voodoo_juice REAL NOT NULL DEFAULT 0.0,
      bud_candy REAL NOT NULL DEFAULT 0.0,
      big_bud REAL NOT NULL DEFAULT 0.0,
      monster_bloom REAL NOT NULL DEFAULT 0.0,
      bac_f1 REAL NOT NULL DEFAULT 0.0,
      enzymes REAL NOT NULL DEFAULT 0.0,
      flawless_finish REAL NOT NULL DEFAULT 0.0,
      ph REAL,
      ec REAL,
      notes TEXT,
      FOREIGN KEY (crop_id) REFERENCES crops(id) ON DELETE CASCADE
    )
  `);

  // 5. Climate logs (real measurements)
  db.exec(`
    CREATE TABLE IF NOT EXISTS climate_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crop_id INTEGER NOT NULL,
      date TEXT NOT NULL, -- YYYY-MM-DD HH:MM
      riego_num REAL, -- optional, nearest riego reference
      plant_height REAL, -- cm
      led_power REAL, -- 0 to 100
      light_distance INTEGER, -- cm
      temp_day REAL,
      temp_night REAL,
      humidity INTEGER,
      vpd REAL,
      extractor REAL,
      poda_done INTEGER DEFAULT 0, -- 0 or 1
      notes TEXT,
      FOREIGN KEY (crop_id) REFERENCES crops(id) ON DELETE CASCADE
    )
  `);

  // 6. Inventory table
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      price REAL NOT NULL DEFAULT 0.0,
      format_volume_ml REAL NOT NULL DEFAULT 1000.0, -- format size in ml (or g)
      purchased_qty REAL NOT NULL DEFAULT 0.0,
      stock_ml REAL NOT NULL DEFAULT 0.0
    )
  `);

  // Seed default inventory and initial crops
  seedInventory();
  seedInitialCrop();

  // If we just migrated, we need to populate templates for existing crops
  if (runMigration) {
    try {
      const crops = db.prepare("SELECT id FROM crops").all();
      crops.forEach(c => {
        const count = db.prepare("SELECT COUNT(*) as count FROM watering_templates WHERE crop_id = ?").get(c.id);
        if (count.count === 0) {
          seedTemplatesForCrop(c.id);
        }
      });
    } catch (err) {
      console.error("Migration seeding error:", err);
    }
  }
}

function seedTemplatesForCrop(cropId) {
  console.log(`Seeding default watering and climate templates from Excel for crop ID ${cropId}...`);

  const insertWatering = db.prepare(`
    INSERT INTO watering_templates (
      crop_id, riego_num, phase, week, type, water_per_plant,
      silica_power, calmag, jj_micro, jj_grow, jj_bloom,
      voodoo_juice, bud_candy, big_bud, monster_bloom, bac_f1,
      enzymes, flawless_finish
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?
    )
  `);

  const insertClimate = db.prepare(`
    INSERT INTO climate_templates (
      crop_id, riego_num, height_min, height_max, led_power, light_distance,
      temp_day, temp_night, humidity, vpd, extractor, poda_info
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?
    )
  `);

  // Ratios per liter from Excel (pre-divided by 84 plants where applicable)
  // Water volumes are per plant:
  // - Riegos 1-3 (Crecimiento W1): 42L / 84 = 0.5 L/plant
  // - Riegos 4-6 (Crecimiento W2): 67L / 84 = 0.7976 L/plant
  // - Riegos 7-12 (Floración W1-W2): 84L / 84 = 1.0 L/plant
  // - Riegos 13-20 (Floración W3-W4): 126L / 84 = 1.5 L/plant
  // - Riegos 21-32 (Floración W5-W7): 168L / 84 = 2.0 L/plant
  // - Riegos 33-34 (Floración W8): 126L / 84 = 1.5 L/plant
  // - Riegos 35-36 (Secado): 0.0 L/plant

  const r1_7 = 1.0 / 7.0; // Silica Power exact ratio (0.142857 ml/L)

  const schedule = [
    // Crecimiento Sem 1 (0.5L water/plant)
    { r: 1.0, ph: 'Crecimiento', w: 1, type: 'Abono', water: 0.5, silica: r1_7, cal: 1.0, micro: 1.0, grow: 1.0, bloom: 1.0, voodoo: 2.0, candy: 0, big: 0, monster: 0, bac: 0, enz: 0, flawless: 0 },
    { r: 2.0, ph: 'Crecimiento', w: 1, type: 'Mant.', water: 0.5, silica: r1_7, cal: 1.0, micro: 0, grow: 0, bloom: 0, voodoo: 0, candy: 0, big: 0, monster: 0, bac: 0, enz: 2.0, flawless: 0 },
    { r: 3.0, ph: 'Crecimiento', w: 1, type: 'Abono', water: 0.5, silica: r1_7, cal: 1.0, micro: 1.0, grow: 1.0, bloom: 1.0, voodoo: 2.0, candy: 0, big: 0, monster: 0, bac: 0, enz: 0, flawless: 0 },
    
    // Crecimiento Sem 2 (67/84 = 0.7976 L water/plant)
    { r: 4.0, ph: 'Crecimiento', w: 2, type: 'Abono', water: 67/84, silica: r1_7, cal: 1.0, micro: 2.0, grow: 2.0, bloom: 1.0, voodoo: 2.0, candy: 0, big: 0, monster: 0, bac: 0, enz: 0, flawless: 0 },
    { r: 5.0, ph: 'Crecimiento', w: 2, type: 'Mant.', water: 67/84, silica: r1_7, cal: 1.0, micro: 0, grow: 0, bloom: 0, voodoo: 0, candy: 0, big: 0, monster: 0, bac: 0, enz: 2.0, flawless: 0 },
    { r: 6.0, ph: 'Crecimiento', w: 2, type: 'Abono', water: 67/84, silica: r1_7, cal: 1.0, micro: 2.0, grow: 2.0, bloom: 1.0, voodoo: 2.0, candy: 0, big: 0, monster: 0, bac: 0, enz: 0, flawless: 0 },
    
    // Floración Sem 1 (1.0L water/plant)
    { r: 7.0, ph: 'Floración', w: 1, type: 'Abono', water: 1.0, silica: r1_7, cal: 1.0, micro: 2.0, grow: 1.5, bloom: 2.0, voodoo: 2.0, candy: 2.0, big: 2.0, monster: 0, bac: 0, enz: 0, flawless: 0 },
    { r: 8.0, ph: 'Floración', w: 1, type: 'Mant.', water: 1.0, silica: r1_7, cal: 1.0, micro: 0, grow: 0, bloom: 0, voodoo: 0, candy: 0, big: 0, monster: 0, bac: 0, enz: 2.0, flawless: 0 },
    { r: 9.0, ph: 'Floración', w: 1, type: 'Abono', water: 1.0, silica: r1_7, cal: 1.0, micro: 2.0, grow: 1.5, bloom: 2.0, voodoo: 2.0, candy: 2.0, big: 2.0, monster: 0, bac: 0, enz: 0, flawless: 0 },
    
    // Floración Sem 2 (1.0L water/plant)
    { r: 10.0, ph: 'Floración', w: 2, type: 'Mant.', water: 1.0, silica: r1_7, cal: 1.0, micro: 0, grow: 0, bloom: 0, voodoo: 0, candy: 0, big: 0, monster: 0, bac: 0, enz: 2.0, flawless: 0 },
    { r: 11.0, ph: 'Floración', w: 2, type: 'Abono', water: 1.0, silica: r1_7, cal: 1.0, micro: 2.0, grow: 1.5, bloom: 2.0, voodoo: 2.0, candy: 2.0, big: 2.0, monster: 0, bac: 0, enz: 0, flawless: 0 },
    { r: 12.0, ph: 'Floración', w: 2, type: 'Mant.', water: 1.0, silica: r1_7, cal: 1.0, micro: 0, grow: 0, bloom: 0, voodoo: 0, candy: 0, big: 0, monster: 0, bac: 0, enz: 2.0, flawless: 0 },
    
    // Floración Sem 3 (1.5L water/plant)
    { r: 13.0, ph: 'Floración', w: 3, type: 'Abono', water: 1.5, silica: r1_7, cal: 1.0, micro: 2.0, grow: 0.5, bloom: 3.0, voodoo: 0, candy: 2.0, big: 2.0, monster: 2.0, bac: 0, enz: 0, flawless: 0 },
    { r: 14.0, ph: 'Floración', w: 3, type: 'Mant.', water: 1.5, silica: r1_7, cal: 1.0, micro: 0, grow: 0, bloom: 0, voodoo: 0, candy: 0, big: 0, monster: 0, bac: 0, enz: 2.0, flawless: 0 },
    { r: 15.0, ph: 'Floración', w: 3, type: 'Abono', water: 1.5, silica: r1_7, cal: 1.0, micro: 2.0, grow: 0.5, bloom: 3.0, voodoo: 0, candy: 2.0, big: 2.0, monster: 2.0, bac: 0, enz: 0, flawless: 0 },
    
    // Floración Sem 4 (1.5L water/plant)
    { r: 16.0, ph: 'Floración', w: 4, type: 'Mant.', water: 1.5, silica: r1_7, cal: 1.0, micro: 0, grow: 0, bloom: 0, voodoo: 0, candy: 0, big: 0, monster: 0, bac: 0, enz: 2.0, flawless: 0 },
    { r: 17.0, ph: 'Floración', w: 4, type: 'Abono', water: 1.5, silica: r1_7, cal: 1.0, micro: 2.0, grow: 0.5, bloom: 3.0, voodoo: 0, candy: 2.0, big: 2.0, monster: 2.0, bac: 0, enz: 0, flawless: 0 },
    { r: 18.0, ph: 'Floración', w: 4, type: 'Mant.', water: 1.5, silica: r1_7, cal: 1.0, micro: 0, grow: 0, bloom: 0, voodoo: 0, candy: 0, big: 0, monster: 0, bac: 0, enz: 2.0, flawless: 0 },
    { r: 19.0, ph: 'Floración', w: 4, type: 'Abono', water: 1.5, silica: r1_7, cal: 1.0, micro: 2.0, grow: 0.5, bloom: 3.0, voodoo: 0, candy: 2.0, big: 2.0, monster: 240/126, bac: 0, enz: 0, flawless: 0 }, // 240ml total
    { r: 20.0, ph: 'Floración', w: 4, type: 'Mant.', water: 1.5, silica: r1_7, cal: 1.0, micro: 0, grow: 0, bloom: 0, voodoo: 0, candy: 0, big: 0, monster: 0, bac: 0, enz: 2.0, flawless: 0 },
    
    // Floración Sem 5 (2.0L water/plant)
    { r: 21.0, ph: 'Floración', w: 5, type: 'Abono', water: 2.0, silica: r1_7, cal: 1.0, micro: 2.0, grow: 0, bloom: 3.0, voodoo: 0, candy: 0, big: 2.0, monster: 0, bac: 50.4/168, enz: 0, flawless: 0 }, // BAC F1: 50.4g total
    { r: 22.0, ph: 'Floración', w: 5, type: 'Mant.', water: 2.0, silica: r1_7, cal: 1.0, micro: 0, grow: 0, bloom: 0, voodoo: 0, candy: 0, big: 0, monster: 0, bac: 0, enz: 2.0, flawless: 0 },
    { r: 23.0, ph: 'Floración', w: 5, type: 'Abono', water: 2.0, silica: r1_7, cal: 1.0, micro: 2.0, grow: 0, bloom: 3.0, voodoo: 0, candy: 0, big: 2.0, monster: 0, bac: 50.4/168, enz: 0, flawless: 0 },
    
    // Floración Sem 6 (2.0L water/plant)
    { r: 24.0, ph: 'Floración', w: 6, type: 'Mant.', water: 2.0, silica: r1_7, cal: 1.0, micro: 0, grow: 0, bloom: 0, voodoo: 0, candy: 0, big: 0, monster: 0, bac: 0, enz: 2.0, flawless: 0 },
    { r: 25.0, ph: 'Floración', w: 6, type: 'Abono', water: 2.0, silica: r1_7, cal: 1.0, micro: 2.0, grow: 0, bloom: 3.0, voodoo: 0, candy: 0, big: 2.0, monster: 0, bac: 50.4/168, enz: 0, flawless: 0 },
    { r: 26.0, ph: 'Floración', w: 6, type: 'Mant.', water: 2.0, silica: r1_7, cal: 1.0, micro: 0, grow: 0, bloom: 0, voodoo: 0, candy: 0, big: 0, monster: 0, bac: 0, enz: 2.0, flawless: 0 },
    { r: 27.0, ph: 'Floración', w: 6, type: 'Abono', water: 2.0, silica: r1_7, cal: 1.0, micro: 2.0, grow: 0, bloom: 3.0, voodoo: 0, candy: 0, big: 2.0, monster: 0, bac: 50.4/168, enz: 0, flawless: 0 },
    { r: 28.0, ph: 'Floración', w: 6, type: 'Mant.', water: 2.0, silica: r1_7, cal: 1.0, micro: 0, grow: 0, bloom: 0, voodoo: 0, candy: 0, big: 0, monster: 0, bac: 0, enz: 2.0, flawless: 0 },
    
    // Floración Sem 7 (2.0L water/plant)
    { r: 29.0, ph: 'Floración', w: 7, type: 'Abono', water: 2.0, silica: r1_7, cal: 1.0, micro: 1.5, grow: 0, bloom: 3.0, voodoo: 0, candy: 0, big: 2.0, monster: 0, bac: 0, enz: 2.0, flawless: 0 },
    { r: 30.0, ph: 'Floración', w: 7, type: 'Mant.', water: 2.0, silica: r1_7, cal: 1.0, micro: 0, grow: 0, bloom: 0, voodoo: 0, candy: 0, big: 0, monster: 0, bac: 0, enz: 0, flawless: 0 },
    { r: 31.0, ph: 'Floración', w: 7, type: 'Abono', water: 2.0, silica: r1_7, cal: 1.0, micro: 1.5, grow: 0, bloom: 3.0, voodoo: 0, candy: 0, big: 2.0, monster: 0, bac: 0, enz: 2.0, flawless: 0 },
    { r: 32.0, ph: 'Floración', w: 7, type: 'Mant.', water: 2.0, silica: r1_7, cal: 1.0, micro: 0, grow: 0, bloom: 0, voodoo: 0, candy: 0, big: 0, monster: 0, bac: 0, enz: 0, flawless: 0 },
    
    // Floración Sem 8 (1.5L water/plant)
    { r: 33.0, ph: 'Floración', w: 8, type: 'Lavado 1', water: 1.5, silica: 0, cal: 0, micro: 0, grow: 0, bloom: 0, voodoo: 0, candy: 0, big: 0, monster: 0, bac: 0, enz: 0, flawless: 250/126 },
    { r: 34.0, ph: 'Floración', w: 8, type: 'Lavado 2', water: 1.5, silica: 0, cal: 0, micro: 0, grow: 0, bloom: 0, voodoo: 0, candy: 0, big: 0, monster: 0, bac: 0, enz: 0, flawless: 250/126 },
    { r: 35.0, ph: 'Floración', w: 8, type: 'Secado', water: 0, silica: 0, cal: 0, micro: 0, grow: 0, bloom: 0, voodoo: 0, candy: 0, big: 0, monster: 0, bac: 0, enz: 0, flawless: 0 },
    { r: 36.0, ph: 'Floración', w: 8, type: 'Secado', water: 0, silica: 0, cal: 0, micro: 0, grow: 0, bloom: 0, voodoo: 0, candy: 0, big: 0, monster: 0, bac: 0, enz: 0, flawless: 0 }
  ];

  for (const r of schedule) {
    insertWatering.run(
      cropId, r.r, r.ph, r.w, r.type, r.water,
      r.silica, r.cal, r.micro, r.grow, r.bloom,
      r.voodoo, r.candy, r.big, r.monster, r.bac,
      r.enz, r.flawless
    );
  }

  // Climate seeding
  const climate = [
    // Crecimiento Sem 1
    { r: 1.0, h_min: 15, h_max: 18, led: 0.3, dist: 70, temp_d: 25, temp_n: 22, hum: 70, vpd: 0.8, ext: 0.3, podas: "Ninguna. Dejar adaptar el esqueje." },
    { r: 2.0, h_min: 18, h_max: 20, led: 0.3, dist: 70, temp_d: 25, temp_n: 22, hum: 70, vpd: 0.8, ext: 0.3, podas: "Revisar que no haya encharcamientos." },
    { r: 3.0, h_min: 20, h_max: 22, led: 0.3, dist: 70, temp_d: 25, temp_n: 22, hum: 70, vpd: 0.8, ext: 0.3, podas: "Acomodar ventiladores oscilantes suaves." },
    // Crecimiento Sem 2
    { r: 4.0, h_min: 22, h_max: 25, led: 0.5, dist: 60, temp_d: 25, temp_n: 22, hum: 65, vpd: 0.9, ext: 0.4, podas: "Subir extractor para renovar más aire." },
    { r: 5.0, h_min: 25, h_max: 28, led: 0.5, dist: 60, temp_d: 25, temp_n: 22, hum: 65, vpd: 0.9, ext: 0.4, podas: "Ninguna." },
    { r: 6.0, h_min: 28, h_max: 30, led: 0.5, dist: 60, temp_d: 25, temp_n: 22, hum: 65, vpd: 0.9, ext: 0.4, podas: "Preparamos para el cambio de fotoperiodo a 12/12." },
    // Floración Sem 1
    { r: 7.0, h_min: 30, h_max: 35, led: 0.6, dist: 50, temp_d: 25, temp_n: 21, hum: 60, vpd: 1.0, ext: 0.5, podas: "✂️ Poda de Bajos (Lollipopping): Limpiar el 30% inferior." },
    { r: 8.0, h_min: 35, h_max: 40, led: 0.6, dist: 50, temp_d: 25, temp_n: 21, hum: 60, vpd: 1.0, ext: 0.5, podas: "Las plantas empiezan su 'estirón' (stretch)." },
    { r: 9.0, h_min: 40, h_max: 45, led: 0.6, dist: 50, temp_d: 25, temp_n: 21, hum: 60, vpd: 1.0, ext: 0.5, podas: "Evitar luces apagadas muy frías (<18°C)." },
    // Floración Sem 2
    { r: 10.0, h_min: 45, h_max: 50, led: 0.75, dist: 45, temp_d: 25, temp_n: 21, hum: 55, vpd: 1.1, ext: 0.6, podas: "Ninguna." },
    { r: 11.0, h_min: 50, h_max: 55, led: 0.75, dist: 45, temp_d: 25, temp_n: 21, hum: 55, vpd: 1.1, ext: 0.6, podas: "Formación de los primeros 'pelillos' (pistilos)." },
    { r: 12.0, h_min: 55, h_max: 60, led: 0.75, dist: 45, temp_d: 25, temp_n: 21, hum: 55, vpd: 1.1, ext: 0.6, podas: "Bajar la humedad ligeramente." },
    // Floración Sem 3
    { r: 13.0, h_min: 60, h_max: 65, led: 1.0, dist: 40, temp_d: 24, temp_n: 20, hum: 50, vpd: 1.2, ext: 0.7, podas: "✂️ Defoliación final (Día 21): Quitar hojas que tapen luz." },
    { r: 14.0, h_min: 65, h_max: 68, led: 1.0, dist: 40, temp_d: 24, temp_n: 20, hum: 50, vpd: 1.2, ext: 0.7, podas: "Los focos al máximo. Máxima absorción PK." },
    { r: 15.0, h_min: 68, h_max: 70, led: 1.0, dist: 40, temp_d: 24, temp_n: 20, hum: 50, vpd: 1.2, ext: 0.7, podas: "Vigilar signos de estrés lumínico (hojas en canoa)." },
    // Floración Sem 4
    { r: 16.0, h_min: 70, h_max: 70, led: 1.0, dist: 40, temp_d: 24, temp_n: 20, hum: 50, vpd: 1.2, ext: 0.7, podas: "Fin del crecimiento vertical. La planta solo engorda." },
    { r: 17.0, h_min: 70, h_max: 70, led: 1.0, dist: 40, temp_d: 24, temp_n: 20, hum: 50, vpd: 1.2, ext: 0.7, podas: "Controlar que los cogollos no se acerquen demasiado al foco." },
    { r: 18.0, h_min: 70, h_max: 70, led: 1.0, dist: 40, temp_d: 24, temp_n: 20, hum: 50, vpd: 1.2, ext: 0.7, podas: "Asegurar un buen flujo de aire." },
    { r: 19.0, h_min: 72, h_max: 72, led: 1.0, dist: 40, temp_d: 24, temp_n: 20, hum: 50, vpd: 1.2, ext: 0.7, podas: "(Solo puede variar si el cogollo pesa y dobla la rama)." },
    { r: 20.0, h_min: 72, h_max: 72, led: 1.0, dist: 40, temp_d: 24, temp_n: 20, hum: 50, vpd: 1.2, ext: 0.7, podas: "Revisar distancia foco/planta." },
    // Floración Sem 5
    { r: 21.0, h_min: 72, h_max: 72, led: 1.0, dist: 38, temp_d: 23, temp_n: 19, hum: 45, vpd: 1.3, ext: 0.8, podas: "Entra el Monster Bloom. Extremar vigilancia." },
    { r: 22.0, h_min: 72, h_max: 72, led: 1.0, dist: 38, temp_d: 23, temp_n: 19, hum: 45, vpd: 1.3, ext: 0.8, podas: "Extractor fuerte para evitar bolsas de humedad." },
    { r: 23.0, h_min: 72, h_max: 72, led: 1.0, dist: 38, temp_d: 23, temp_n: 19, hum: 45, vpd: 1.3, ext: 0.8, podas: "Vigilar posibles carencias." },
    // Floración Sem 6
    { r: 24.0, h_min: 75, h_max: 75, led: 1.0, dist: 38, temp_d: 23, temp_n: 19, hum: 45, vpd: 1.4, ext: 0.9, podas: "Ninguna. Extracción casi a tope." },
    { r: 25.0, h_min: 75, h_max: 75, led: 1.0, dist: 38, temp_d: 23, temp_n: 19, hum: 45, vpd: 1.4, ext: 0.9, podas: "Los cálices se hinchan brutalmente." },
    { r: 26.0, h_min: 75, h_max: 75, led: 1.0, dist: 38, temp_d: 23, temp_n: 19, hum: 45, vpd: 1.4, ext: 0.9, podas: "Controlar ventiladores directos." },
    { r: 27.0, h_min: 75, h_max: 75, led: 1.0, dist: 38, temp_d: 23, temp_n: 19, hum: 45, vpd: 1.4, ext: 0.9, podas: "Revisar que no haya moho." },
    { r: 28.0, h_min: 75, h_max: 75, led: 1.0, dist: 38, temp_d: 23, temp_n: 19, hum: 45, vpd: 1.4, ext: 0.9, podas: "Preparando el cierre del ciclo de engorde." },
    // Floración Sem 7
    { r: 29.0, h_min: 75, h_max: 75, led: 1.0, dist: 45, temp_d: 22, temp_n: 18, hum: 40, vpd: 1.5, ext: 1.0, podas: "Alejar el foco un poco para madurar resina sin evaporarla." },
    { r: 30.0, h_min: 75, h_max: 75, led: 1.0, dist: 45, temp_d: 22, temp_n: 18, hum: 40, vpd: 1.5, ext: 1.0, podas: "Entra el endurecedor BAC F1." },
    { r: 31.0, h_min: 75, h_max: 75, led: 1.0, dist: 45, temp_d: 22, temp_n: 18, hum: 40, vpd: 1.5, ext: 1.0, podas: "Bajar temperatura (simular final de otoño)." },
    { r: 32.0, h_min: 75, h_max: 75, led: 1.0, dist: 45, temp_d: 22, temp_n: 18, hum: 40, vpd: 1.5, ext: 1.0, podas: "Extracción máxima, prevención total anti-Botrytis." },
    // Floración Sem 8
    { r: 33.0, h_min: 75, h_max: 75, led: 0.75, dist: 50, temp_d: 20, temp_n: 18, hum: 40, vpd: 1.5, ext: 1.0, podas: "Lavado de Raíces. Bajar la luz para evitar estrés calórico." },
    { r: 34.0, h_min: 75, h_max: 75, led: 0.5, dist: 60, temp_d: 20, temp_n: 18, hum: 40, vpd: 1.5, ext: 1.0, podas: "Dejar secar bien el sustrato de las macetas." },
    { r: 35.0, h_min: 75, h_max: 75, led: 0.0, dist: 0, temp_d: 18, temp_n: 18, hum: 40, vpd: 1.5, ext: 1.0, podas: "✂️ 48 hrs de oscuridad total antes del corte. COSECHA." },
    { r: 36.0, h_min: 75, h_max: 75, led: 0.0, dist: 0, temp_d: 18, temp_n: 18, hum: 40, vpd: 1.5, ext: 1.0, podas: "Corte completo y colgado." }
  ];

  for (const c of climate) {
    insertClimate.run(
      cropId, c.r, c.h_min, c.h_max, c.led, c.dist,
      c.temp_d, c.temp_n, c.hum, c.vpd, c.ext,
      c.podas
    );
  }
}

function seedInventory() {
  const rowCount = db.prepare("SELECT COUNT(*) as count FROM inventory").get();
  if (rowCount.count > 0) return;

  console.log("Seeding default inventory products from Excel...");

  const insertProduct = db.prepare(`
    INSERT INTO inventory (name, price, format_volume_ml, purchased_qty, stock_ml)
    VALUES (?, ?, ?, ?, ?)
  `);

  // Default products from Excel
  const products = [
    { name: "Calmag (Atami)", price: 12.0, format: 1000, qty: 4, stock: 4000 },
    { name: "Jungle Juice Grow", price: 6.78, format: 1000, qty: 1, stock: 1000 },
    { name: "Jungle Juice Micro", price: 7.97, format: 1000, qty: 4, stock: 4000 },
    { name: "Jungle Juice Bloom", price: 6.78, format: 1000, qty: 5, stock: 5000 },
    { name: "Voodoo Juice", price: 54.0, format: 1000, qty: 1, stock: 1000 },
    { name: "Big Bud Liquid", price: 18.0, format: 500, qty: 3, stock: 1500 },
    { name: "Bud Candy", price: 26.6, format: 1000, qty: 4, stock: 4000 },
    { name: "Monster Bloom (Grotek)", price: 11.0, format: 130, qty: 2, stock: 260 }, // measured in grams (130g = 130 units)
    { name: "Sensizym (Advanced Nutrients)", price: 29.0, format: 1000, qty: 3, stock: 3000 },
    { name: "BAC F1 Extreme Booster", price: 26.0, format: 1000, qty: 1, stock: 1000 },
    { name: "Flawless Finish", price: 11.0, format: 500, qty: 1, stock: 500 },
    { name: "Silica Power (BAC)", price: 0.0, format: 1000, qty: 1, stock: 550 }, // 550 ml remaining
    { name: "Atazyme", price: 0.0, format: 1000, qty: 1, stock: 200 } // 200 ml remaining
  ];

  for (const p of products) {
    insertProduct.run(p.name, p.price, p.format, p.qty, p.stock);
  }
}

function seedInitialCrop() {
  const rowCount = db.prepare("SELECT COUNT(*) as count FROM crops").get();
  if (rowCount.count > 0) return;

  console.log("Seeding default active crop cycle...");
  const insertCrop = db.prepare(`
    INSERT INTO crops (name, start_date, status, num_plants, pot_size_l, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  // Format today as YYYY-MM-DD
  const today = new Date().toISOString().split('T')[0];
  
  const result = insertCrop.run(
    "Lote Inicial Helio V3 - Blue Zushi",
    today,
    "active",
    84,
    11.0,
    "Primer ciclo importado del Excel de cultivo indoor. Macetas de 11L con tierra Light-Mix y agua desmineralizada de aire acondicionado."
  );

  // Seed templates for this initial crop
  seedTemplatesForCrop(result.lastInsertRowid);
}

module.exports = {
  db,
  initDb,
  seedTemplatesForCrop
};
