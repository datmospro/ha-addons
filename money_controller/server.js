const express = require('express');
const cors = require('cors');
const path = require('path');
const dbOps = require('./database');
const { generateForecast } = require('./forecast');

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// --- API ENDPOINTS ---

// Settings
app.get('/api/settings', (req, res) => {
  try {
    const settings = dbOps.getSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings', (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'Key is required' });
    dbOps.updateSetting(key, value);
    res.json({ success: true, settings: dbOps.getSettings() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Categories
app.get('/api/categories', (req, res) => {
  try {
    const categories = dbOps.getCategories();
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/categories', (req, res) => {
  try {
    const { name, type, color, icon } = req.body;
    if (!name || !type) return res.status(400).json({ error: 'Name and type are required' });
    const result = dbOps.addCategory(name, type, color || '#6b7280', icon || 'help-circle');
    res.status(201).json({ id: result.lastInsertRowid, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/categories/:id', (req, res) => {
  try {
    dbOps.deleteCategory(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Transactions
app.get('/api/transactions', (req, res) => {
  try {
    const { type, category_id, start_date, end_date, search } = req.query;
    const transactions = dbOps.getTransactions({ type, category_id, start_date, end_date, search });
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/transactions', (req, res) => {
  try {
    const { description, amount, type, category_id, date, notes } = req.body;
    if (!description || amount === undefined || !type || !date) {
      return res.status(400).json({ error: 'Missing required fields: description, amount, type, date' });
    }
    const result = dbOps.addTransaction(description, amount, type, category_id, date, notes);
    res.status(201).json({ id: result.lastInsertRowid, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/transactions/:id', (req, res) => {
  try {
    const { description, amount, type, category_id, date, notes } = req.body;
    const result = dbOps.updateTransaction(req.params.id, description, amount, type, category_id, date, notes);
    if (result.changes === 0) return res.status(404).json({ error: 'Transaction not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/transactions/:id', (req, res) => {
  try {
    const result = dbOps.deleteTransaction(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Transaction not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Recurring Rules
app.get('/api/recurring', (req, res) => {
  try {
    const rules = dbOps.getRecurringRules();
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/recurring', (req, res) => {
  try {
    const { description, amount, type, category_id, frequency, day_of_month, specific_date, start_date, end_date, notes } = req.body;
    if (!description || amount === undefined || !type || !frequency || !start_date) {
      return res.status(400).json({ error: 'Missing required fields: description, amount, type, frequency, start_date' });
    }
    const result = dbOps.addRecurringRule(
      description, amount, type, category_id, frequency, day_of_month, specific_date, start_date, end_date, notes
    );
    res.status(201).json({ id: result.lastInsertRowid, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/recurring/:id', (req, res) => {
  try {
    const { description, amount, type, category_id, frequency, day_of_month, specific_date, start_date, end_date, notes } = req.body;
    const result = dbOps.updateRecurringRule(
      req.params.id, description, amount, type, category_id, frequency, day_of_month, specific_date, start_date, end_date, notes
    );
    if (result.changes === 0) return res.status(404).json({ error: 'Recurring rule not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/recurring/:id', (req, res) => {
  try {
    const result = dbOps.deleteRecurringRule(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Recurring rule not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Forecast (standard & What-If)
app.get('/api/forecast', (req, res) => {
  try {
    const result = generateForecast();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/forecast/simulate', (req, res) => {
  try {
    const { temporaryTransactions } = req.body;
    // temporaryTransactions must be an array of: { description, amount, type, date, isTemp: true }
    const result = generateForecast(temporaryTransactions || []);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Backup
app.get('/api/backup', (req, res) => {
  try {
    const data = dbOps.getRawData();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/backup/restore', (req, res) => {
  try {
    const data = req.body;
    dbOps.restoreRawData(data);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset
app.post('/api/reset', (req, res) => {
  try {
    const result = dbOps.resetDatabase();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Catch-all route to serve Frontend index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(port, '0.0.0.0', () => {
  console.log(`MoneyController server running at http://0.0.0.0:${port}`);
});
