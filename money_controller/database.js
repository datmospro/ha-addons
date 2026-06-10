const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// Determine database path. In HA addon, it must be in /data. Locally, use root folder.
const dbPath = process.env.DB_PATH || (fs.existsSync('/data') ? '/data/moneycontroller.db' : path.join(__dirname, 'moneycontroller.db'));

// Ensure directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

console.log(`Initializing database at: ${dbPath}`);
const db = new DatabaseSync(dbPath);

// Create tables
function initDb() {
  // Settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Categories table
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      type TEXT CHECK(type IN ('income', 'expense')),
      color TEXT,
      icon TEXT
    )
  `);

  // Transactions table (for actual/one-time transactions)
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      type TEXT CHECK(type IN ('income', 'expense')),
      category_id INTEGER,
      date TEXT NOT NULL, -- YYYY-MM-DD
      notes TEXT,
      bank_transaction_id TEXT,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    )
  `);

  // Upgrade migrations for older database schemas (add columns)
  try {
    const tableInfo = db.prepare("PRAGMA table_info(transactions)").all();
    const columns = tableInfo.map(c => c.name);
    
    if (!columns.includes('recurring_rule_id')) {
      console.log("Adding column recurring_rule_id to transactions table");
      db.exec("ALTER TABLE transactions ADD COLUMN recurring_rule_id INTEGER");
    }
    if (!columns.includes('recurrence_date')) {
      console.log("Adding column recurrence_date to transactions table");
      db.exec("ALTER TABLE transactions ADD COLUMN recurrence_date TEXT");
    }
    if (!columns.includes('bank_transaction_id')) {
      console.log("Adding column bank_transaction_id to transactions table");
      db.exec("ALTER TABLE transactions ADD COLUMN bank_transaction_id TEXT");
    }
  } catch (err) {
    console.error("Error checking or adding columns to transactions table:", err);
  }

  // Create unique index for bank transactions after migrations ensure the column exists
  try {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_bank_tx ON transactions(bank_transaction_id)");
  } catch (err) {
    console.error("Error creating unique index for bank transactions:", err);
  }

  // Recurring rules table (for fixed/scheduled expenses and incomes)
  db.exec(`
    CREATE TABLE IF NOT EXISTS recurring_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      type TEXT CHECK(type IN ('income', 'expense')),
      category_id INTEGER,
      frequency TEXT CHECK(frequency IN ('weekly', 'monthly', 'bimonthly', 'quarterly', 'semiannually', 'annually')),
      day_of_month INTEGER, -- 1-31
      specific_date TEXT, -- MM-DD for annual
      start_date TEXT NOT NULL, -- YYYY-MM-DD
      end_date TEXT, -- YYYY-MM-DD (optional)
      notes TEXT,
      match_patterns TEXT, -- Comma-separated merchant description patterns
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    )
  `);

  // Upgrade migrations for older database schemas (add columns to recurring_rules)
  try {
    const tableInfo = db.prepare("PRAGMA table_info(recurring_rules)").all();
    const columns = tableInfo.map(c => c.name);
    
    if (!columns.includes('match_patterns')) {
      console.log("Adding column match_patterns to recurring_rules table");
      db.exec("ALTER TABLE recurring_rules ADD COLUMN match_patterns TEXT");
    }
  } catch (err) {
    console.error("Error checking or adding columns to recurring_rules table:", err);
  }

  // Insert default settings if not exists
  const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  
  if (!getSetting.get('initial_balance')) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('initial_balance', '0');
  }
  if (!getSetting.get('safety_threshold')) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('safety_threshold', '100');
  }
  if (!getSetting.get('variable_monthly_budget')) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('variable_monthly_budget', '300');
  }
  if (!getSetting.get('currency')) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('currency', 'EUR');
  }

  // Insert default categories if table is empty
  const countCategories = db.prepare('SELECT COUNT(*) as count FROM categories').get().count;
  if (countCategories === 0) {
    const defaultCategories = [
      // Incomes
      { name: 'Nómina', type: 'income', color: '#10b981', icon: 'briefcase' },
      { name: 'Otros Ingresos', type: 'income', color: '#34d399', icon: 'plus-circle' },
      { name: 'Inversiones', type: 'income', color: '#059669', icon: 'trending-up' },
      // Expenses
      { name: 'Hipoteca / Alquiler', type: 'expense', color: '#f43f5e', icon: 'home' },
      { name: 'Suministros', type: 'expense', color: '#fb923c', icon: 'zap' },
      { name: 'Alimentación', type: 'expense', color: '#f59e0b', icon: 'shopping-cart' },
      { name: 'Transporte / Vehículo', type: 'expense', color: '#3b82f6', icon: 'car' },
      { name: 'Seguros', type: 'expense', color: '#a855f7', icon: 'shield' },
      { name: 'Préstamos', type: 'expense', color: '#ec4899', icon: 'credit-card' },
      { name: 'Ocio / Restaurantes', type: 'expense', color: '#14b8a6', icon: 'coffee' },
      { name: 'Otros Gastos', type: 'expense', color: '#6b7280', icon: 'help-circle' }
    ];

    const insertCategory = db.prepare('INSERT INTO categories (name, type, color, icon) VALUES (?, ?, ?, ?)');
    defaultCategories.forEach(cat => {
      insertCategory.run(cat.name, cat.type, cat.color, cat.icon);
    });
  }
}

// Initialize tables
initDb();

// DB functions
const dbOps = {
  // Settings
  getSettings: () => {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settingsObj = {};
    rows.forEach(row => {
      settingsObj[row.key] = row.value;
    });
    return settingsObj;
  },
  updateSetting: (key, value) => {
    return db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
  },

  // Categories
  getCategories: () => {
    return db.prepare('SELECT * FROM categories ORDER BY type DESC, name ASC').all();
  },
  addCategory: (name, type, color, icon) => {
    return db.prepare('INSERT INTO categories (name, type, color, icon) VALUES (?, ?, ?, ?)').run(name, type, color, icon);
  },
  updateCategory: (id, name, type, color, icon) => {
    return db.prepare('UPDATE categories SET name = ?, type = ?, color = ?, icon = ? WHERE id = ?').run(name, type, color, icon, Number(id));
  },
  deleteCategory: (id) => {
    return db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  },

  // Transactions
  getTransactions: (filters = {}) => {
    let sql = `
      SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon 
      FROM transactions t 
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (filters.type) {
      sql += ' AND t.type = ?';
      params.push(filters.type);
    }
    if (filters.category_id) {
      sql += ' AND t.category_id = ?';
      params.push(Number(filters.category_id));
    }
    if (filters.start_date) {
      sql += ' AND t.date >= ?';
      params.push(filters.start_date);
    }
    if (filters.end_date) {
      sql += ' AND t.date <= ?';
      params.push(filters.end_date);
    }
    if (filters.search) {
      sql += ' AND t.description LIKE ?';
      params.push(`%${filters.search}%`);
    }

    sql += ' ORDER BY t.date DESC, t.id DESC';
    return db.prepare(sql).all(...params);
  },
  addTransaction: (description, amount, type, category_id, date, notes = '', recurring_rule_id = null, recurrence_date = null) => {
    return db.prepare('INSERT INTO transactions (description, amount, type, category_id, date, notes, recurring_rule_id, recurrence_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(description, Number(amount), type, category_id ? Number(category_id) : null, date, notes, recurring_rule_id, recurrence_date);
  },
  addBankTransaction: (description, amount, type, category_id, date, notes, bank_transaction_id, recurring_rule_id = null, recurrence_date = null) => {
    return db.prepare('INSERT OR IGNORE INTO transactions (description, amount, type, category_id, date, notes, bank_transaction_id, recurring_rule_id, recurrence_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(description, Number(amount), type, category_id ? Number(category_id) : null, date, notes, bank_transaction_id, recurring_rule_id, recurrence_date);
  },
  updateTransaction: (id, description, amount, type, category_id, date, notes = '') => {
    return db.prepare('UPDATE transactions SET description = ?, amount = ?, type = ?, category_id = ?, date = ?, notes = ? WHERE id = ?')
      .run(description, Number(amount), type, category_id ? Number(category_id) : null, date, notes, Number(id));
  },
  deleteTransaction: (id) => {
    return db.prepare('DELETE FROM transactions WHERE id = ?').run(Number(id));
  },

  // Recurring Rules
  getRecurringRules: () => {
    return db.prepare(`
      SELECT r.*, c.name as category_name, c.color as category_color, c.icon as category_icon 
      FROM recurring_rules r 
      LEFT JOIN categories c ON r.category_id = c.id
      ORDER BY r.type DESC, r.description ASC
    `).all();
  },
  addRecurringRule: (description, amount, type, category_id, frequency, day_of_month, specific_date, start_date, end_date, notes = '') => {
    return db.prepare(`
      INSERT INTO recurring_rules (description, amount, type, category_id, frequency, day_of_month, specific_date, start_date, end_date, notes) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      description,
      Number(amount),
      type,
      category_id ? Number(category_id) : null,
      frequency,
      day_of_month ? Number(day_of_month) : null,
      specific_date || null,
      start_date,
      end_date || null,
      notes
    );
  },
  updateRecurringRule: (id, description, amount, type, category_id, frequency, day_of_month, specific_date, start_date, end_date, notes = '') => {
    return db.prepare(`
      UPDATE recurring_rules 
      SET description = ?, amount = ?, type = ?, category_id = ?, frequency = ?, day_of_month = ?, specific_date = ?, start_date = ?, end_date = ?, notes = ? 
      WHERE id = ?
    `).run(
      description,
      Number(amount),
      type,
      category_id ? Number(category_id) : null,
      frequency,
      day_of_month ? Number(day_of_month) : null,
      specific_date || null,
      start_date,
      end_date || null,
      notes,
      Number(id)
    );
  },
  deleteRecurringRule: (id) => {
    return db.prepare('DELETE FROM recurring_rules WHERE id = ?').run(Number(id));
  },
  hasTransactionForRecurrence: (ruleId, dateStr) => {
    const row = db.prepare('SELECT id FROM transactions WHERE recurring_rule_id = ? AND recurrence_date = ?').get(Number(ruleId), dateStr);
    return !!row;
  },
  linkTransactionToRule: (transactionId, ruleId, recurrenceDate, pattern = null) => {
    const rule = db.prepare('SELECT description, category_id, match_patterns FROM recurring_rules WHERE id = ?').get(Number(ruleId));
    if (rule) {
      db.prepare(`
        UPDATE transactions 
        SET recurring_rule_id = ?, recurrence_date = ?, description = ?, category_id = ? 
        WHERE id = ?
      `).run(Number(ruleId), recurrenceDate, rule.description, rule.category_id, Number(transactionId));

      if (pattern) {
        const cleanPattern = pattern.trim().toUpperCase();
        if (cleanPattern) {
          let currentPatterns = rule.match_patterns ? rule.match_patterns.split(',').map(p => p.trim()) : [];
          if (!currentPatterns.includes(cleanPattern)) {
            currentPatterns.push(cleanPattern);
            const newPatternsStr = currentPatterns.filter(Boolean).join(',');
            db.prepare('UPDATE recurring_rules SET match_patterns = ? WHERE id = ?').run(newPatternsStr, Number(ruleId));
            console.log(`Added match pattern "${cleanPattern}" to recurring rule ID ${ruleId}`);
          }
        }
      }
    }
    return { success: true };
  },
  unlinkTransactionFromRule: (transactionId) => {
    return db.prepare(`
      UPDATE transactions 
      SET recurring_rule_id = NULL, recurrence_date = NULL 
      WHERE id = ?
    `).run(Number(transactionId));
  },
  cleanExistingGeneratedTransactions: () => {
    return db.prepare("DELETE FROM transactions WHERE recurring_rule_id IS NOT NULL AND bank_transaction_id IS NULL").run();
  },
  cleanAllTransactionDescriptions: (cleanFn) => {
    const txs = db.prepare('SELECT id, description FROM transactions').all();
    const updateStmt = db.prepare('UPDATE transactions SET description = ? WHERE id = ?');
    db.exec('BEGIN TRANSACTION');
    try {
      let count = 0;
      txs.forEach(tx => {
        const cleaned = cleanFn(tx.description);
        if (cleaned !== tx.description) {
          updateStmt.run(cleaned, tx.id);
          count++;
        }
      });
      db.exec('COMMIT');
      return count;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  },

  syncLinkedTransactionDescriptions: () => {
    return db.prepare(`
      UPDATE transactions 
      SET description = (
        SELECT r.description 
        FROM recurring_rules r 
        WHERE r.id = transactions.recurring_rule_id
      )
      WHERE recurring_rule_id IS NOT NULL
    `).run();
  },

  findSimilarTransactionCategory: (description, getMerchantCoreFn) => {
    const targetCore = getMerchantCoreFn(description);
    if (!targetCore) return null;

    const txs = db.prepare('SELECT description, category_id FROM transactions WHERE category_id IS NOT NULL ORDER BY id DESC LIMIT 500').all();
    for (const tx of txs) {
      const existingCore = getMerchantCoreFn(tx.description);
      if (existingCore && existingCore === targetCore) {
        return tx.category_id;
      }
    }
    return null;
  },

  // Dangerous but useful: Clear all data (excluding settings/categories)
  resetDatabase: () => {
    db.exec('DELETE FROM transactions');
    db.exec('DELETE FROM recurring_rules');
    return { success: true };
  },

  // Backup support
  getRawData: () => {
    return {
      settings: db.prepare('SELECT * FROM settings').all(),
      categories: db.prepare('SELECT * FROM categories').all(),
      transactions: db.prepare('SELECT * FROM transactions').all(),
      recurring_rules: db.prepare('SELECT * FROM recurring_rules').all()
    };
  },
  restoreRawData: (data) => {
    db.exec('BEGIN TRANSACTION');
    try {
      if (data.settings) {
        db.exec('DELETE FROM settings');
        const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
        data.settings.forEach(row => stmt.run(row.key, row.value));
      }
      if (data.categories) {
        db.exec('DELETE FROM categories');
        const stmt = db.prepare('INSERT INTO categories (id, name, type, color, icon) VALUES (?, ?, ?, ?, ?)');
        data.categories.forEach(row => stmt.run(row.id, row.name, row.type, row.color, row.icon));
      }
      if (data.transactions) {
        db.exec('DELETE FROM transactions');
        const stmt = db.prepare('INSERT INTO transactions (id, description, amount, type, category_id, date, notes, bank_transaction_id, recurring_rule_id, recurrence_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        data.transactions.forEach(row => stmt.run(
          row.id, row.description, row.amount, row.type, row.category_id, row.date, row.notes, 
          row.bank_transaction_id || null, row.recurring_rule_id || null, row.recurrence_date || null
        ));
      }
      if (data.recurring_rules) {
        db.exec('DELETE FROM recurring_rules');
        const stmt = db.prepare('INSERT INTO recurring_rules (id, description, amount, type, category_id, frequency, day_of_month, specific_date, start_date, end_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        data.recurring_rules.forEach(row => stmt.run(
          row.id, row.description, row.amount, row.type, row.category_id, row.frequency, row.day_of_month, row.specific_date, row.start_date, row.end_date, row.notes
        ));
      }
      db.exec('COMMIT');
      return { success: true };
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
};

module.exports = dbOps;
