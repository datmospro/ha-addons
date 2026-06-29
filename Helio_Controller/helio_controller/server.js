const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { db, initDb } = require('./database');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Initialize database
initDb();

const PORT = process.env.PORT || 8098;

// Helper to format date
function getNowFormatted() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ==========================================
// API - CROP CYCLES (CULTIVOS)
// ==========================================

// Get all crops
app.get('/api/crops', (req, res) => {
  try {
    const stmt = db.prepare("SELECT * FROM crops ORDER BY status DESC, start_date DESC");
    const crops = stmt.all();
    res.json(crops);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new crop (archives current active ones)
app.post('/api/crops', (req, res) => {
  const { name, start_date, num_plants, pot_size_l, notes } = req.body;
  if (!name || !start_date) {
    return res.status(400).json({ error: "Name and start date are required" });
  }

  try {
    // 1. Archive active crops
    db.exec("UPDATE crops SET status = 'archived' WHERE status = 'active'");

    // 2. Create new active crop
    const stmt = db.prepare(`
      INSERT INTO crops (name, start_date, status, num_plants, pot_size_l, notes)
      VALUES (?, ?, 'active', ?, ?, ?)
    `);
    const result = stmt.run(name, start_date, num_plants || 84, pot_size_l || 11.0, notes || '');
    
    res.status(201).json({ id: result.lastInsertRowid, name, start_date, status: 'active' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update crop (e.g. current active plants count)
app.put('/api/crops/:id', (req, res) => {
  const { id } = req.params;
  const { name, start_date, end_date, status, num_plants, pot_size_l, notes } = req.body;

  try {
    const crop = db.prepare("SELECT * FROM crops WHERE id = ?").get(id);
    if (!crop) return res.status(404).json({ error: "Crop not found" });

    // If setting to active, archive other crops first
    if (status === 'active' && crop.status !== 'active') {
      db.exec("UPDATE crops SET status = 'archived' WHERE status = 'active'");
    }

    const stmt = db.prepare(`
      UPDATE crops
      SET name = ?, start_date = ?, end_date = ?, status = ?, num_plants = ?, pot_size_l = ?, notes = ?
      WHERE id = ?
    `);
    stmt.run(
      name !== undefined ? name : crop.name,
      start_date !== undefined ? start_date : crop.start_date,
      end_date !== undefined ? end_date : crop.end_date,
      status !== undefined ? status : crop.status,
      num_plants !== undefined ? num_plants : crop.num_plants,
      pot_size_l !== undefined ? pot_size_l : crop.pot_size_l,
      notes !== undefined ? notes : crop.notes,
      id
    );

    res.json({ message: "Crop updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete crop
app.delete('/api/crops/:id', (req, res) => {
  const { id } = req.params;
  try {
    const stmt = db.prepare("DELETE FROM crops WHERE id = ?");
    stmt.run(id);
    res.json({ message: "Crop deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// API - SCHEDULE & WATERINGS (RIEGOS)
// ==========================================

// Get dynamic watering schedule joined with completed logs
app.get('/api/crops/:id/schedule', (req, res) => {
  const { id } = req.params;

  try {
    const crop = db.prepare("SELECT * FROM crops WHERE id = ?").get(id);
    if (!crop) return res.status(404).json({ error: "Crop not found" });

    const templates = db.prepare("SELECT * FROM watering_templates ORDER BY riego_num ASC").all();
    const completed = db.prepare("SELECT * FROM completed_waterings WHERE crop_id = ?").all();
    const climates = db.prepare("SELECT * FROM climate_templates").all();

    const completedMap = {};
    completed.forEach(cw => {
      completedMap[cw.riego_num] = cw;
    });

    const climateMap = {};
    climates.forEach(cl => {
      climateMap[cl.riego_num] = cl;
    });

    // Generate schedule
    const schedule = templates.map(t => {
      const isCompleted = completedMap[t.riego_num] !== undefined;
      const compData = completedMap[t.riego_num] || null;
      const climTarget = climateMap[t.riego_num] || null;

      // Dynamic calculation targets based on current crop plants count
      const numPlants = isCompleted ? compData.plants_count : crop.num_plants;
      const targetWater = t.water_per_plant * numPlants;

      const roundQty = (val) => Number((val).toFixed(2));

      const targetProducts = {
        silica_power: roundQty(t.silica_power * targetWater),
        calmag: roundQty(t.calmag * targetWater),
        jj_micro: roundQty(t.jj_micro * targetWater),
        jj_grow: roundQty(t.jj_grow * targetWater),
        jj_bloom: roundQty(t.jj_bloom * targetWater),
        voodoo_juice: roundQty(t.voodoo_juice * targetWater),
        bud_candy: roundQty(t.bud_candy * targetWater),
        big_bud: roundQty(t.big_bud * targetWater),
        monster_bloom: roundQty(t.monster_bloom * targetWater),
        bac_f1: roundQty(t.bac_f1 * targetWater),
        enzymes: roundQty(t.enzymes * targetWater),
        flawless_finish: roundQty(t.flawless_finish * targetWater)
      };

      return {
        riego_num: t.riego_num,
        phase: t.phase,
        week: t.week,
        type: t.type,
        water_per_plant: t.water_per_plant,
        target_water_l: roundQty(targetWater),
        target_products: targetProducts,
        completed: isCompleted,
        completed_data: compData,
        climate_targets: climTarget
      };
    });

    res.json({
      crop,
      schedule
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Record completed watering & deduct inventory stock
app.post('/api/crops/:id/waterings', (req, res) => {
  const { id } = req.params;
  const {
    riego_num, date, water_liters, plants_count,
    silica_power, calmag, jj_micro, jj_grow, jj_bloom,
    voodoo_juice, bud_candy, big_bud, monster_bloom, bac_f1,
    enzymes, flawless_finish, ph, ec, notes
  } = req.body;

  if (riego_num === undefined || !water_liters || !date) {
    return res.status(400).json({ error: "Missing required watering data" });
  }

  try {
    // Check if crop exists
    const crop = db.prepare("SELECT * FROM crops WHERE id = ?").get(id);
    if (!crop) return res.status(404).json({ error: "Crop not found" });

    // Check if watering already logged for this riego_num
    const existing = db.prepare("SELECT id FROM completed_waterings WHERE crop_id = ? AND riego_num = ?").get(id, riego_num);
    if (existing) {
      return res.status(400).json({ error: "Watering already recorded. Use PUT to modify it." });
    }

    const stmt = db.prepare(`
      INSERT INTO completed_waterings (
        crop_id, riego_num, date, water_liters, plants_count,
        silica_power, calmag, jj_micro, jj_grow, jj_bloom,
        voodoo_juice, bud_candy, big_bud, monster_bloom, bac_f1,
        enzymes, flawless_finish, ph, ec, notes
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
    `);

    const result = stmt.run(
      id, riego_num, date, water_liters, plants_count || crop.num_plants,
      silica_power || 0.0, calmag || 0.0, jj_micro || 0.0, jj_grow || 0.0, jj_bloom || 0.0,
      voodoo_juice || 0.0, bud_candy || 0.0, big_bud || 0.0, monster_bloom || 0.0, bac_f1 || 0.0,
      enzymes || 0.0, flawless_finish || 0.0, ph || null, ec || null, notes || ''
    );

    // Deduct stock in inventory
    const productsToDeduct = {
      "Silica Power (BAC)": silica_power,
      "Calmag (Atami)": calmag,
      "Jungle Juice Micro": jj_micro,
      "Jungle Juice Grow": jj_grow,
      "Jungle Juice Bloom": jj_bloom,
      "Voodoo Juice": voodoo_juice,
      "Bud Candy": bud_candy,
      "Big Bud Liquid": big_bud,
      "Monster Bloom (Grotek)": monster_bloom,
      "BAC F1 Extreme Booster": bac_f1,
      "Flawless Finish": flawless_finish
    };

    // Special logic for Enzymes (Atazyme first, then Sensizym)
    let enzymeVol = enzymes || 0.0;
    if (enzymeVol > 0) {
      // Get Atazyme stock
      const atazyme = db.prepare("SELECT id, stock_ml FROM inventory WHERE name = 'Atazyme'").get();
      if (atazyme && atazyme.stock_ml > 0) {
        const deductAtazyme = Math.min(enzymeVol, atazyme.stock_ml);
        db.prepare("UPDATE inventory SET stock_ml = stock_ml - ? WHERE id = ?").run(deductAtazyme, atazyme.id);
        enzymeVol -= deductAtazyme;
      }
      if (enzymeVol > 0) {
        // Deduct remaining from Sensizym
        const sensizym = db.prepare("SELECT id FROM inventory WHERE name = 'Sensizym (Advanced Nutrients)'").get();
        if (sensizym) {
          db.prepare("UPDATE inventory SET stock_ml = MAX(0, stock_ml - ?) WHERE id = ?").run(enzymeVol, sensizym.id);
        }
      }
    }

    // Deduct other standard products
    for (const [prodName, volume] of Object.entries(productsToDeduct)) {
      if (volume && volume > 0) {
        db.prepare("UPDATE inventory SET stock_ml = MAX(0, stock_ml - ?) WHERE name = ?").run(volume, prodName);
      }
    }

    res.status(201).json({ id: result.lastInsertRowid, message: "Watering recorded and inventory updated." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update completed watering (restoring and re-deducting stock)
app.put('/api/crops/:id/waterings/:watering_id', (req, res) => {
  const { id, watering_id } = req.params;
  const {
    date, water_liters, plants_count,
    silica_power, calmag, jj_micro, jj_grow, jj_bloom,
    voodoo_juice, bud_candy, big_bud, monster_bloom, bac_f1,
    enzymes, flawless_finish, ph, ec, notes
  } = req.body;

  try {
    const existing = db.prepare("SELECT * FROM completed_waterings WHERE id = ? AND crop_id = ?").get(watering_id, id);
    if (!existing) return res.status(404).json({ error: "Watering record not found" });

    // 1. Revert previous inventory deductions
    const productsToRestore = {
      "Silica Power (BAC)": existing.silica_power,
      "Calmag (Atami)": existing.calmag,
      "Jungle Juice Micro": existing.jj_micro,
      "Jungle Juice Grow": existing.jj_grow,
      "Jungle Juice Bloom": existing.jj_bloom,
      "Voodoo Juice": existing.voodoo_juice,
      "Bud Candy": existing.bud_candy,
      "Big Bud Liquid": existing.big_bud,
      "Monster Bloom (Grotek)": existing.monster_bloom,
      "BAC F1 Extreme Booster": existing.bac_f1,
      "Flawless Finish": existing.flawless_finish
    };

    // Revert Enzymes (assume we put back to Atazyme up to its max volume, then Sensizym)
    let oldEnzymeVol = existing.enzymes || 0.0;
    if (oldEnzymeVol > 0) {
      // Revert Atazyme up to 200ml format limit (owned)
      const atazyme = db.prepare("SELECT id, stock_ml FROM inventory WHERE name = 'Atazyme'").get();
      if (atazyme) {
        const canRestoreAtazyme = Math.min(oldEnzymeVol, 200.0 - atazyme.stock_ml);
        if (canRestoreAtazyme > 0) {
          db.prepare("UPDATE inventory SET stock_ml = stock_ml + ? WHERE id = ?").run(canRestoreAtazyme, atazyme.id);
          oldEnzymeVol -= canRestoreAtazyme;
        }
      }
      if (oldEnzymeVol > 0) {
        const sensizym = db.prepare("SELECT id FROM inventory WHERE name = 'Sensizym (Advanced Nutrients)'").get();
        if (sensizym) {
          db.prepare("UPDATE inventory SET stock_ml = stock_ml + ? WHERE id = ?").run(oldEnzymeVol, sensizym.id);
        }
      }
    }

    for (const [prodName, volume] of Object.entries(productsToRestore)) {
      if (volume && volume > 0) {
        db.prepare("UPDATE inventory SET stock_ml = stock_ml + ? WHERE name = ?").run(volume, prodName);
      }
    }

    // 2. Update record
    const stmt = db.prepare(`
      UPDATE completed_waterings
      SET date = ?, water_liters = ?, plants_count = ?,
          silica_power = ?, calmag = ?, jj_micro = ?, jj_grow = ?, jj_bloom = ?,
          voodoo_juice = ?, bud_candy = ?, big_bud = ?, monster_bloom = ?, bac_f1 = ?,
          enzymes = ?, flawless_finish = ?, ph = ?, ec = ?, notes = ?
      WHERE id = ?
    `);

    stmt.run(
      date || existing.date,
      water_liters !== undefined ? water_liters : existing.water_liters,
      plants_count !== undefined ? plants_count : existing.plants_count,
      silica_power !== undefined ? silica_power : existing.silica_power,
      calmag !== undefined ? calmag : existing.calmag,
      jj_micro !== undefined ? jj_micro : existing.jj_micro,
      jj_grow !== undefined ? jj_grow : existing.jj_grow,
      jj_bloom !== undefined ? jj_bloom : existing.jj_bloom,
      voodoo_juice !== undefined ? voodoo_juice : existing.voodoo_juice,
      bud_candy !== undefined ? bud_candy : existing.bud_candy,
      big_bud !== undefined ? big_bud : existing.big_bud,
      monster_bloom !== undefined ? monster_bloom : existing.monster_bloom,
      bac_f1 !== undefined ? bac_f1 : existing.bac_f1,
      enzymes !== undefined ? enzymes : existing.enzymes,
      flawless_finish !== undefined ? flawless_finish : existing.flawless_finish,
      ph !== undefined ? ph : existing.ph,
      ec !== undefined ? ec : existing.ec,
      notes !== undefined ? notes : existing.notes,
      watering_id
    );

    // 3. Deduct new inventory quantities
    const newProductsDeduct = {
      "Silica Power (BAC)": silica_power !== undefined ? silica_power : existing.silica_power,
      "Calmag (Atami)": calmag !== undefined ? calmag : existing.calmag,
      "Jungle Juice Micro": jj_micro !== undefined ? jj_micro : existing.jj_micro,
      "Jungle Juice Grow": jj_grow !== undefined ? jj_grow : existing.jj_grow,
      "Jungle Juice Bloom": jj_bloom !== undefined ? jj_bloom : existing.jj_bloom,
      "Voodoo Juice": voodoo_juice !== undefined ? voodoo_juice : existing.voodoo_juice,
      "Bud Candy": bud_candy !== undefined ? bud_candy : existing.bud_candy,
      "Big Bud Liquid": big_bud !== undefined ? big_bud : existing.big_bud,
      "Monster Bloom (Grotek)": monster_bloom !== undefined ? monster_bloom : existing.monster_bloom,
      "BAC F1 Extreme Booster": bac_f1 !== undefined ? bac_f1 : existing.bac_f1,
      "Flawless Finish": flawless_finish !== undefined ? flawless_finish : existing.flawless_finish
    };

    let newEnzymeVol = enzymes !== undefined ? enzymes : existing.enzymes;
    if (newEnzymeVol > 0) {
      const atazyme = db.prepare("SELECT id, stock_ml FROM inventory WHERE name = 'Atazyme'").get();
      if (atazyme && atazyme.stock_ml > 0) {
        const deductAtazyme = Math.min(newEnzymeVol, atazyme.stock_ml);
        db.prepare("UPDATE inventory SET stock_ml = stock_ml - ? WHERE id = ?").run(deductAtazyme, atazyme.id);
        newEnzymeVol -= deductAtazyme;
      }
      if (newEnzymeVol > 0) {
        const sensizym = db.prepare("SELECT id FROM inventory WHERE name = 'Sensizym (Advanced Nutrients)'").get();
        if (sensizym) {
          db.prepare("UPDATE inventory SET stock_ml = MAX(0, stock_ml - ?) WHERE id = ?").run(newEnzymeVol, sensizym.id);
        }
      }
    }

    for (const [prodName, volume] of Object.entries(newProductsDeduct)) {
      if (volume && volume > 0) {
        db.prepare("UPDATE inventory SET stock_ml = MAX(0, stock_ml - ?) WHERE name = ?").run(volume, prodName);
      }
    }

    res.json({ message: "Watering record updated and stock adjusted." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete completed watering
app.delete('/api/crops/:id/waterings/:watering_id', (req, res) => {
  const { id, watering_id } = req.params;

  try {
    const existing = db.prepare("SELECT * FROM completed_waterings WHERE id = ? AND crop_id = ?").get(watering_id, id);
    if (!existing) return res.status(404).json({ error: "Watering record not found" });

    // Restore stock
    const productsToRestore = {
      "Silica Power (BAC)": existing.silica_power,
      "Calmag (Atami)": existing.calmag,
      "Jungle Juice Micro": existing.jj_micro,
      "Jungle Juice Grow": existing.jj_grow,
      "Jungle Juice Bloom": existing.jj_bloom,
      "Voodoo Juice": existing.voodoo_juice,
      "Bud Candy": existing.bud_candy,
      "Big Bud Liquid": existing.big_bud,
      "Monster Bloom (Grotek)": existing.monster_bloom,
      "BAC F1 Extreme Booster": existing.bac_f1,
      "Flawless Finish": existing.flawless_finish
    };

    let oldEnzymeVol = existing.enzymes || 0.0;
    if (oldEnzymeVol > 0) {
      const atazyme = db.prepare("SELECT id, stock_ml FROM inventory WHERE name = 'Atazyme'").get();
      if (atazyme) {
        const canRestoreAtazyme = Math.min(oldEnzymeVol, 200.0 - atazyme.stock_ml);
        if (canRestoreAtazyme > 0) {
          db.prepare("UPDATE inventory SET stock_ml = stock_ml + ? WHERE id = ?").run(canRestoreAtazyme, atazyme.id);
          oldEnzymeVol -= canRestoreAtazyme;
        }
      }
      if (oldEnzymeVol > 0) {
        const sensizym = db.prepare("SELECT id FROM inventory WHERE name = 'Sensizym (Advanced Nutrients)'").get();
        if (sensizym) {
          db.prepare("UPDATE inventory SET stock_ml = stock_ml + ? WHERE id = ?").run(oldEnzymeVol, sensizym.id);
        }
      }
    }

    for (const [prodName, volume] of Object.entries(productsToRestore)) {
      if (volume && volume > 0) {
        db.prepare("UPDATE inventory SET stock_ml = stock_ml + ? WHERE name = ?").run(volume, prodName);
      }
    }

    const stmt = db.prepare("DELETE FROM completed_waterings WHERE id = ?");
    stmt.run(watering_id);

    res.json({ message: "Watering record deleted and stock restored." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// API - CLIMATE LOGS
// ==========================================

// Get climate logs
app.get('/api/crops/:id/climate', (req, res) => {
  const { id } = req.params;
  try {
    const stmt = db.prepare("SELECT * FROM climate_logs WHERE crop_id = ? ORDER BY date DESC");
    const logs = stmt.all(id);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Record climate measurement
app.post('/api/crops/:id/climate', (req, res) => {
  const { id } = req.params;
  const {
    date, riego_num, plant_height, led_power,
    light_distance, temp_day, temp_night, humidity,
    vpd, extractor, poda_done, notes
  } = req.body;

  if (!date) {
    return res.status(400).json({ error: "Date is required" });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO climate_logs (
        crop_id, date, riego_num, plant_height, led_power,
        light_distance, temp_day, temp_night, humidity,
        vpd, extractor, poda_done, notes
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?
      )
    `);
    const result = stmt.run(
      id, date, riego_num || null, plant_height || null, led_power || null,
      light_distance || null, temp_day || null, temp_night || null, humidity || null,
      vpd || null, extractor || null, poda_done || 0, notes || ''
    );
    res.status(201).json({ id: result.lastInsertRowid, message: "Climate log saved." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete climate log
app.delete('/api/crops/:id/climate/:log_id', (req, res) => {
  const { id, log_id } = req.params;
  try {
    const stmt = db.prepare("DELETE FROM climate_logs WHERE id = ? AND crop_id = ?");
    stmt.run(log_id, id);
    res.json({ message: "Climate log deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// API - INVENTORY (INVENTARIO)
// ==========================================

// Get inventory
app.get('/api/inventory', (req, res) => {
  try {
    const stmt = db.prepare("SELECT * FROM inventory ORDER BY name ASC");
    const items = stmt.all();
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update inventory item (restocking, prices, etc)
app.put('/api/inventory/:id', (req, res) => {
  const { id } = req.params;
  const { price, format_volume_ml, purchased_qty, stock_ml } = req.body;

  try {
    const item = db.prepare("SELECT * FROM inventory WHERE id = ?").get(id);
    if (!item) return res.status(404).json({ error: "Inventory item not found" });

    const stmt = db.prepare(`
      UPDATE inventory
      SET price = ?, format_volume_ml = ?, purchased_qty = ?, stock_ml = ?
      WHERE id = ?
    `);

    stmt.run(
      price !== undefined ? price : item.price,
      format_volume_ml !== undefined ? format_volume_ml : item.format_volume_ml,
      purchased_qty !== undefined ? purchased_qty : item.purchased_qty,
      stock_ml !== undefined ? stock_ml : item.stock_ml,
      id
    );

    res.json({ message: "Inventory item updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add custom inventory item
app.post('/api/inventory', (req, res) => {
  const { name, price, format_volume_ml, purchased_qty, stock_ml } = req.body;
  if (!name) return res.status(400).json({ error: "Product name is required" });

  try {
    const stmt = db.prepare(`
      INSERT INTO inventory (name, price, format_volume_ml, purchased_qty, stock_ml)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      name,
      price || 0.0,
      format_volume_ml || 1000.0,
      purchased_qty || 0.0,
      stock_ml || 0.0
    );
    res.status(201).json({ id: result.lastInsertRowid, name, message: "Inventory product added." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` HelioController Server running on port ${PORT}`);
  console.log(`==================================================`);
});
