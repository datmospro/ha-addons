const express = require('express');
const cors = require('cors');
const path = require('path');
const dbOps = require('./database');
const { generateForecast } = require('./forecast');

// Helpers for bank synchronization and description cleaning
function cleanBankDescription(desc) {
  if (!desc) return '';
  let clean = desc.trim();
  
  // Remove leading /TXT/ or /TXT (case-insensitive)
  clean = clean.replace(/^\/?TXT\/?/i, '').trim();
  
  // Remove WWW. prefix
  clean = clean.replace(/\bWWW\./i, '');
  
  // Replace asterisks with spaces
  clean = clean.replace(/\*/g, ' ');
  
  // Clean up multiple spaces
  clean = clean.replace(/\s+/g, ' ').trim();
  
  // Capitalize to Title Case, preserving dates and common acronyms
  clean = clean.toLowerCase().split(' ').map(word => {
    if (/^\d{2}[-\/]\d{2}[-\/]\d{2,4}$/.test(word)) {
      return word;
    }
    const norm = word.replace(/[.,]/g, '').trim();
    if (norm === 'sa') return 'S.A.';
    if (norm === 'sl') return 'S.L.';
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
  
  return clean || desc;
}

function getMerchantCore(desc) {
  if (!desc) return '';
  let core = desc.toUpperCase();
  // Remove dates (DD-MM-YYYY or DD/MM/YYYY or YYYY-MM-DD)
  core = core.replace(/\b\d{2}[-\/]\d{2}[-\/]\d{2,4}\b/g, '');
  core = core.replace(/\b\d{4}[-\/]\d{2}[-\/]\d{2}\b/g, '');
  // Remove alphanumeric codes that look like transaction IDs (letters + numbers, at least 4 chars)
  core = core.split(' ').filter(word => {
    const hasLetter = /[A-Z]/.test(word);
    const hasDigit = /[0-9]/.test(word);
    return !(hasLetter && hasDigit && word.length >= 4);
  }).join(' ');
  // Remove S.A., S.L.
  core = core.replace(/\b(S\.?A\.?|S\.?L\.?)\b/g, '');
  // Clean up punctuation and multiple spaces
  core = core.replace(/[^A-Z0-9\s]/g, ' ');
  core = core.replace(/\s+/g, ' ').trim();
  return core;
}

function calculateRecurrenceDateForTxDate(rule, txDateStr) {
  const txDate = new Date(txDateStr + 'T12:00:00');
  const y = txDate.getFullYear();
  const m = txDate.getMonth();
  
  if (rule.frequency === 'weekly') {
    const start = new Date(rule.start_date + 'T12:00:00');
    const targetDayOfWeek = start.getDay();
    const diff = targetDayOfWeek - txDate.getDay();
    const recurrenceDate = new Date(txDate.getTime() + diff * 24 * 60 * 60 * 1000);
    return recurrenceDate.toISOString().split('T')[0];
  }
  
  if (rule.frequency === 'annually') {
    if (rule.specific_date) {
      return `${y}-${rule.specific_date}`;
    } else {
      const start = new Date(rule.start_date + 'T12:00:00');
      const mStr = String(start.getMonth() + 1).padStart(2, '0');
      const dStr = String(start.getDate()).padStart(2, '0');
      return `${y}-${mStr}-${dStr}`;
    }
  }
  
  const dayNum = rule.day_of_month || new Date(rule.start_date + 'T12:00:00').getDate();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const actualDay = Math.min(dayNum, daysInMonth);
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(actualDay).padStart(2, '0')}`;
}

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

app.put('/api/categories/:id', (req, res) => {
  try {
    const { name, type, color, icon } = req.body;
    if (!name || !type) return res.status(400).json({ error: 'Name and type are required' });
    const result = dbOps.updateCategory(req.params.id, name, type, color, icon);
    if (result.changes === 0) return res.status(404).json({ error: 'Category not found' });
    res.json({ success: true });
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
    const { type, category_id, start_date, end_date, search, limit, offset } = req.query;
    const filters = { type, category_id, start_date, end_date, search };
    if (limit !== undefined && offset !== undefined) {
      filters.limit = Number(limit);
      filters.offset = Number(offset);
    }
    const transactions = dbOps.getTransactions(filters);
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

// Link transaction to a recurring rule
app.post('/api/transactions/:id/link-recurring', (req, res) => {
  try {
    const { recurringRuleId, recurrenceDate, learnPattern, pattern } = req.body;
    if (!recurringRuleId) return res.status(400).json({ error: 'recurringRuleId is required' });
    
    dbOps.linkTransactionToRule(req.params.id, recurringRuleId, recurrenceDate, learnPattern ? pattern : null);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Unlink transaction from recurring rule
app.post('/api/transactions/:id/unlink-recurring', (req, res) => {
  try {
    dbOps.unlinkTransactionFromRule(req.params.id);
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

// --- ENABLE BANKING SYNC ENDPOINTS ---

const crypto = require('crypto');

function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlEncodeBuffer(buffer) {
  return buffer
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function generateEnableBankingJWT(appId, privateKeyPem) {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid: appId
  };
  
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'enablebanking.com',
    aud: 'api.enablebanking.com',
    iat: now,
    exp: now + 3600 // 1 hour validity
  };
  
  const stringToSign = base64UrlEncode(JSON.stringify(header)) + '.' + base64UrlEncode(JSON.stringify(payload));
  
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(stringToSign);
  const signature = sign.sign(privateKeyPem);
  
  return stringToSign + '.' + base64UrlEncodeBuffer(signature);
}

function getEnableBankingToken(dbOps) {
  const settings = dbOps.getSettings();
  const appId = settings.enablebanking_app_id;
  const privateKey = settings.enablebanking_private_key;
  
  if (!appId || !privateKey) {
    throw new Error('Las credenciales de Enable Banking no están configuradas.');
  }
  
  return generateEnableBankingJWT(appId, privateKey);
}

// Get institutions for country
app.get('/api/bank/institutions', async (req, res) => {
  try {
    const country = req.query.country || 'ES';
    const token = getEnableBankingToken(dbOps);
    
    console.log(`Fetching Enable Banking institutions for country: ${country}`);
    const response = await fetch(`https://api.enablebanking.com/aspsps?country=${country}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      let details = '';
      try {
        const parsed = JSON.parse(errText);
        details = parsed.message || parsed.error || errText;
      } catch (e) {
        details = errText;
      }
      throw new Error(`Enable Banking API returned ${response.status}: ${details}`);
    }

    const institutions = await response.json();
    const list = institutions.aspsps || institutions;
    const mapped = list.map(inst => ({
      id: inst.name,
      name: inst.name
    }));
    res.json(mapped);
  } catch (err) {
    console.error('Error in /api/bank/institutions:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Link Bank: create session auth, returns redirect URL
app.post('/api/bank/link', async (req, res) => {
  try {
    const { institutionId, country } = req.body; // institutionId is the bank name (e.g., "Unicaja Banco")
    if (!institutionId) {
      return res.status(400).json({ error: 'Falta el nombre del banco.' });
    }

    const token = getEnableBankingToken(dbOps);
    const targetCountry = country || 'ES';
    
    // Save institution and country in settings
    dbOps.updateSetting('enablebanking_institution_id', institutionId);
    dbOps.updateSetting('enablebanking_country', targetCountry);

    // Create reference
    const reference = 'eb_' + Math.random().toString(36).substring(2, 15);
    dbOps.updateSetting('enablebanking_reference', reference);

    // Build the redirect URL
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers.host;
    let redirectUrl = `${protocol}://${host}/api/bank/callback`;
    
    // Fallback/override using Referer if it exists to preserve HTTPS protocol
    if (req.headers.referer) {
      try {
        const refUrl = new URL(req.headers.referer);
        redirectUrl = `${refUrl.protocol}//${refUrl.host}/api/bank/callback`;
      } catch (e) {
        // Ignore parsing errors
      }
    }
    
    console.log(`Creating Enable Banking auth session for "${institutionId}" in ${targetCountry} with redirect callback: ${redirectUrl}`);

    const validUntil = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

    const response = await fetch('https://api.enablebanking.com/auth', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        aspsp: {
          name: institutionId,
          country: targetCountry
        },
        redirect_url: redirectUrl,
        state: reference,
        psu_type: 'personal',
        access: {
          balances: true,
          transactions: true,
          valid_until: validUntil
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Error creating Enable Banking session:', errText);
      let details = '';
      try {
        const parsed = JSON.parse(errText);
        details = parsed.message || parsed.error || errText;
      } catch (e) {
        details = errText;
      }
      throw new Error('Error al crear la solicitud de conexión: ' + details);
    }

    const authData = await response.json();
    res.json({ link: authData.url });
  } catch (err) {
    console.error('Error in /api/bank/link:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Bank Consent Callback Handler
app.get('/api/bank/callback', async (req, res) => {
  try {
    const code = req.query.code;
    const state = req.query.state;
    const settings = dbOps.getSettings();
    
    if (state && settings.enablebanking_reference !== state) {
      console.warn('Warning: Auth state mismatch');
    }
    
    if (!code) {
      throw new Error('No se recibió el código de autorización del banco.');
    }

    const token = getEnableBankingToken(dbOps);
    
    console.log(`Exchanging code for Enable Banking session...`);
    const response = await fetch('https://api.enablebanking.com/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        code: code
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Error exchanging session code:', errText);
      let details = '';
      try {
        const parsed = JSON.parse(errText);
        details = parsed.message || parsed.error || errText;
      } catch (e) {
        details = errText;
      }
      throw new Error('Error al verificar la sesión con el banco: ' + details);
    }

    const sessionData = await response.json();
    
    if (sessionData.session_id && sessionData.accounts && sessionData.accounts.length > 0) {
      dbOps.updateSetting('enablebanking_session_id', sessionData.session_id);
      dbOps.updateSetting('enablebanking_accounts', JSON.stringify(sessionData.accounts));
      dbOps.updateSetting('enablebanking_linked', 'true');
      dbOps.updateSetting('enablebanking_linked_date', new Date().toISOString());
      
      const bankName = sessionData.connector || settings.enablebanking_institution_id || 'Banco';
      const cleanBankName = bankName.split('_')[0].toUpperCase();
      dbOps.updateSetting('enablebanking_bank_name', cleanBankName);
      
      console.log(`Successfully linked Enable Banking session: ${sessionData.session_id}`);
      res.redirect('/?bank_status=success');
    } else {
      console.warn(`No accounts found in session`);
      res.redirect('/?bank_status=failed&reason=no_accounts');
    }
  } catch (err) {
    console.error('Callback error:', err);
    res.redirect(`/?bank_status=failed&reason=${encodeURIComponent(err.message)}`);
  }
});

// Unlink Bank (clear settings)
app.post('/api/bank/unlink', (req, res) => {
  try {
    dbOps.updateSetting('enablebanking_linked', 'false');
    dbOps.updateSetting('enablebanking_accounts', '');
    dbOps.updateSetting('enablebanking_session_id', '');
    dbOps.updateSetting('enablebanking_reference', '');
    dbOps.updateSetting('enablebanking_bank_name', '');
    dbOps.updateSetting('enablebanking_linked_date', '');
    console.log('Enable Banking unlinked successfully.');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sync bank transactions
app.post('/api/bank/sync', async (req, res) => {
  try {
    const settings = dbOps.getSettings();
    if (settings.enablebanking_linked !== 'true') {
      return res.status(400).json({ error: 'No hay ninguna cuenta bancaria vinculada.' });
    }

    const accountsStr = settings.enablebanking_accounts;
    if (!accountsStr) {
      return res.status(400).json({ error: 'No se encontraron IDs de cuenta bancaria vinculados.' });
    }

    const accounts = JSON.parse(accountsStr);
    const token = getEnableBankingToken(dbOps);
    const categories = dbOps.getCategories();
    const recurringRules = dbOps.getRecurringRules();
    
    let totalImported = 0;
    
    const psuIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const psuUserAgent = req.headers['user-agent'] || 'MoneyController/1.0';
    
    console.log(`Syncing transactions via Enable Banking...`);
    
    const dateFrom = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    for (const account of accounts) {
      const accountId = account.uid;
      console.log(`Fetching transactions for account UID: ${accountId}`);
      
      const response = await fetch(`https://api.enablebanking.com/accounts/${accountId}/transactions?dateFrom=${dateFrom}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          'PSU-IP-Address': psuIp,
          'PSU-User-Agent': psuUserAgent
        }
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`Error fetching transactions for account ${accountId}:`, errText);
        continue;
      }

      const data = await response.json();
      const txList = data.transactions || [];
      console.log(`Found ${txList.length} transaction(s) for account ${accountId}`);
      if (txList.length > 0) {
        console.log('DEBUG - Sample transaction keys/values:', JSON.stringify(txList[0]));
      }
      
      for (const tx of txList) {
        const status = (tx.status || '').toLowerCase();
        if (status !== 'booked' && status !== 'book') continue;
        
        // 1. Resolve amount and sign (debit vs credit indicator)
        const amountStr = tx.transaction_amount?.amount || tx.amount || '0';
        let amountNum = parseFloat(amountStr);
        if (isNaN(amountNum)) amountNum = 0;
        
        let type = 'expense';
        const indicator = tx.credit_debit_indicator || '';
        if (indicator.toUpperCase() === 'CRDT' || indicator.toLowerCase() === 'credit') {
          type = 'income';
        } else if (indicator.toUpperCase() === 'DBIT' || indicator.toLowerCase() === 'debit') {
          type = 'expense';
        } else {
          type = amountNum >= 0 ? 'income' : 'expense';
        }
        
        const absoluteAmount = Math.abs(amountNum);
        
        // 2. Resolve date and description
        const date = tx.booking_date || tx.value_date || tx.bookingDate || tx.valueDate || new Date().toISOString().split('T')[0];
        const descText = (tx.remittance_information && tx.remittance_information[0]) || tx.description || '';
        
        // 3. Resolve transaction ID (generate synthetic hash since Unicaja returns null)
        let txId = tx.transaction_id || tx.entry_reference || tx.transactionId || tx.entryReference;
        if (!txId) {
          const bal = tx.balance_after_transaction?.amount || '';
          const rawString = `${date}_${amountStr}_${indicator}_${descText}_${bal}`;
          txId = crypto.createHash('sha256').update(rawString).digest('hex');
        }
        
        const description = cleanBankDescription(descText) || 'Transacción Bancaria';
        
        // Auto-categorization & Smart Auto-Match
        let categoryId = null;
        let matchedRuleId = null;
        let recurrenceDate = null;
        
        const cleanDescUpper = description.toUpperCase();
        
        const candidateRules = recurringRules.filter(rule => {
          if (rule.type !== type || !rule.match_patterns) return false;
          const patterns = rule.match_patterns.split(',').map(p => p.trim().toUpperCase());
          return patterns.some(pattern => pattern && cleanDescUpper.includes(pattern));
        });

        let matchedRule = null;
        if (candidateRules.length === 1) {
          matchedRule = candidateRules[0];
        } else if (candidateRules.length > 1) {
          let minDiff = Infinity;
          candidateRules.forEach(rule => {
            const diff = Math.abs(rule.amount - absoluteAmount);
            if (diff < minDiff) {
              minDiff = diff;
              matchedRule = rule;
            }
          });
        }
        
        let finalDescription = description;
        if (matchedRule) {
          matchedRuleId = matchedRule.id;
          categoryId = matchedRule.category_id;
          recurrenceDate = calculateRecurrenceDateForTxDate(matchedRule, date);
          finalDescription = matchedRule.description;
          console.log(`Auto-matched bank transaction "${description}" to recurring rule "${matchedRule.description}"`);
        } else {
          // Check if there is a similar transaction in the database to copy its category (smart learning)
          const similarCategoryId = dbOps.findSimilarTransactionCategory(description, getMerchantCore);
          if (similarCategoryId) {
            categoryId = similarCategoryId;
            console.log(`Smart-categorized bank transaction "${description}" to category ID ${categoryId} based on similar past transaction`);
          } else {
            // Fallback to standard auto-categorization
            const upperDesc = description.toUpperCase();
            if (type === 'income') {
              const nominaCat = categories.find(c => c.name.toUpperCase().includes('NÓMINA') || c.name.toUpperCase().includes('NOMINA'));
              const inversioCat = categories.find(c => c.name.toUpperCase().includes('INVERSIO'));
              const otrosIngresosCat = categories.find(c => c.name.toUpperCase().includes('OTROS INGRESOS') || c.type === 'income');

              if (upperDesc.includes('NOMINA') || upperDesc.includes('SALARIO') || upperDesc.includes('SUELDO') || upperDesc.includes('HABERES')) {
                categoryId = nominaCat ? nominaCat.id : (otrosIngresosCat ? otrosIngresosCat.id : null);
              } else if (upperDesc.includes('INVER') || upperDesc.includes('DIVIDENDO') || upperDesc.includes('INTERESES')) {
                categoryId = inversioCat ? inversioCat.id : (otrosIngresosCat ? otrosIngresosCat.id : null);
              } else {
                const firstIncome = categories.find(c => c.type === 'income');
                categoryId = firstIncome ? firstIncome.id : null;
              }
            } else {
              const hipotecaCat = categories.find(c => c.name.toUpperCase().includes('HIPOTECA') || c.name.toUpperCase().includes('ALQUILER'));
              const suministrosCat = categories.find(c => c.name.toUpperCase().includes('SUMINISTROS') || c.name.toUpperCase().includes('LUZ') || c.name.toUpperCase().includes('AGUA'));
              const alimentacionCat = categories.find(c => c.name.toUpperCase().includes('ALIMENTAC') || c.name.toUpperCase().includes('SUPERMERCADO') || c.name.toUpperCase().includes('COMPRA'));
              const transporteCat = categories.find(c => c.name.toUpperCase().includes('TRANSPORTE') || c.name.toUpperCase().includes('VEHICULO') || c.name.toUpperCase().includes('COCHE') || c.name.toUpperCase().includes('GASOLINA'));
              const segurosCat = categories.find(c => c.name.toUpperCase().includes('SEGURO'));
              const prestamosCat = categories.find(c => c.name.toUpperCase().includes('PRÉSTAMO') || c.name.toUpperCase().includes('PRESTAMO') || c.name.toUpperCase().includes('CREDITO'));
              const ocioCat = categories.find(c => c.name.toUpperCase().includes('OCIO') || c.name.toUpperCase().includes('RESTAURANTE') || c.name.toUpperCase().includes('COFFEE'));
              
              if (upperDesc.includes('HIPOTECA') || upperDesc.includes('ALQUILER') || upperDesc.includes('RENT') || upperDesc.includes('COMUNIDAD')) {
                categoryId = hipotecaCat ? hipotecaCat.id : null;
              } else if (upperDesc.includes('LUZ') || upperDesc.includes('AGUA') || upperDesc.includes('GAS') || upperDesc.includes('IBERDROLA') || upperDesc.includes('ENDESA') || upperDesc.includes('NATURGY') || upperDesc.includes('TELEFONO') || upperDesc.includes('MOVISTAR') || upperDesc.includes('VODAFONE') || upperDesc.includes('ORANGE') || upperDesc.includes('DIGI') || upperDesc.includes('INTERNET') || upperDesc.includes('FIBRA')) {
                categoryId = suministrosCat ? suministrosCat.id : null;
              } else if (upperDesc.includes('MERCADONA') || upperDesc.includes('CARREFOUR') || upperDesc.includes('DIA %') || upperDesc.includes('LIDL') || upperDesc.includes('ALCAMPO') || upperDesc.includes('SUPERMERCADO') || upperDesc.includes('ALIMENTACION') || upperDesc.includes('EROSKI') || upperDesc.includes('CONDIS') || upperDesc.includes('AUNAS') || upperDesc.includes('ALIMEN')) {
                categoryId = alimentacionCat ? alimentacionCat.id : null;
              } else if (upperDesc.includes('GASOLINA') || upperDesc.includes('REPSOL') || upperDesc.includes('CEPSA') || upperDesc.includes('BP') || upperDesc.includes('PEAJE') || upperDesc.includes('TALLER') || upperDesc.includes('COCHE') || upperDesc.includes('AUTO') || upperDesc.includes('PARKING') || upperDesc.includes('ESTACIONAMIENTO')) {
                categoryId = transporteCat ? transporteCat.id : null;
              } else if (upperDesc.includes('SEGURO') || upperDesc.includes('MUTUA') || upperDesc.includes('MAPFRE') || upperDesc.includes('AXA') || upperDesc.includes('ALLIANZ') || upperDesc.includes('ADESLAS') || upperDesc.includes('SANITAS')) {
                categoryId = segurosCat ? segurosCat.id : null;
              } else if (upperDesc.includes('PRESTAMO') || upperDesc.includes('CREDITO') || upperDesc.includes('FINANCIACION') || upperDesc.includes('AMORTIZACION')) {
                categoryId = prestamosCat ? prestamosCat.id : null;
              } else if (upperDesc.includes('RESTAURANTE') || upperDesc.includes('BAR ') || upperDesc.includes('COFFEE') || upperDesc.includes('CAFE') || upperDesc.includes('CINE') || upperDesc.includes('NETFLIX') || upperDesc.includes('SPOTIFY') || upperDesc.includes('HBO') || upperDesc.includes('PRIME VIDEO') || upperDesc.includes('PIZZERIA') || upperDesc.includes('BURGER') || upperDesc.includes('MCDONALD')) {
                categoryId = ocioCat ? ocioCat.id : null;
              }
              
              if (!categoryId) {
                const otrosGastosCat = categories.find(c => c.name.toUpperCase().includes('OTROS GASTOS') || c.type === 'expense');
                categoryId = otrosGastosCat ? otrosGastosCat.id : (categories.find(c => c.type === 'expense')?.id || null);
              }
            }
          }
        }
        
        const notes = `Sincronizado de ${settings.enablebanking_bank_name || 'Banco'}`;
        const result = dbOps.addBankTransaction(finalDescription, absoluteAmount, type, categoryId, date, notes, txId, matchedRuleId, recurrenceDate);
        if (result.changes > 0) {
          totalImported++;
        }
      }
    }
    
    console.log(`Sync completed. Imported ${totalImported} new transaction(s).`);
    res.json({ success: true, imported: totalImported });
  } catch (err) {
    console.error('Error syncing bank transactions:', err);
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
  
  // Clean up auto-generated transactions from past versions
  try {
    const cleanResult = dbOps.cleanExistingGeneratedTransactions();
    console.log(`Cleared ${cleanResult.changes} historical auto-generated transaction(s)`);
  } catch (err) {
    console.error('Error cleaning historical auto-generated transactions:', err.message);
  }

  // Clean and normalize descriptions of existing transactions in the database
  try {
    const cleanedCount = dbOps.cleanAllTransactionDescriptions(cleanBankDescription);
    console.log(`Cleaned and normalized ${cleanedCount} existing transaction description(s) in database`);
  } catch (err) {
    console.error('Error cleaning existing transaction descriptions:', err.message);
  }

  // Update existing linked bank transaction descriptions to match their pre-programmed rules
  try {
    const syncResult = dbOps.syncLinkedTransactionDescriptions();
    console.log(`Synchronized ${syncResult.changes} linked transaction description(s) to match recurring rules`);
  } catch (err) {
    console.error('Error synchronizing linked transaction descriptions:', err.message);
  }
});
