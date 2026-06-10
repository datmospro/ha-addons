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

// --- GOCARDLESS BANK SYNC ENDPOINTS ---

// Helper to get or refresh GoCardless Access Token
async function getGoCardlessToken(dbOps) {
  const settings = dbOps.getSettings();
  const secretId = settings.gocardless_secret_id;
  const secretKey = settings.gocardless_secret_key;
  
  if (!secretId || !secretKey) {
    throw new Error('Las credenciales de GoCardless no están configuradas.');
  }

  // Check cached token
  const token = settings.gocardless_token;
  const tokenExpires = settings.gocardless_token_expires;
  if (token && tokenExpires && new Date(tokenExpires) > new Date()) {
    return token;
  }

  console.log('Fetching new GoCardless access token...');
  const res = await fetch('https://bankaccountdata.gocardless.com/api/v2/token/new/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      secret_id: secretId,
      secret_key: secretKey
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('Error getting GoCardless token:', errText);
    throw new Error('Error de autenticación con GoCardless: ' + res.statusText);
  }

  const data = await res.json();
  const expiresAt = new Date(Date.now() + (data.access_expires || 86400) * 1000).toISOString();
  
  dbOps.updateSetting('gocardless_token', data.access);
  dbOps.updateSetting('gocardless_token_expires', expiresAt);
  if (data.refresh) {
    dbOps.updateSetting('gocardless_refresh_token', data.refresh);
  }
  
  return data.access;
}

// Get institutions for country
app.get('/api/bank/institutions', async (req, res) => {
  try {
    const country = req.query.country || 'ES';
    const token = await getGoCardlessToken(dbOps);
    
    console.log(`Fetching institutions for country: ${country}`);
    const response = await fetch(`https://bankaccountdata.gocardless.com/api/v2/institutions/?country=${country}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`GoCardless API returned ${response.status}: ${response.statusText}`);
    }

    const institutions = await response.json();
    res.json(institutions);
  } catch (err) {
    console.error('Error in /api/bank/institutions:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Link Bank: create agreement and requisition, returns redirect link
app.post('/api/bank/link', async (req, res) => {
  try {
    const { institutionId, country } = req.body;
    if (!institutionId) {
      return res.status(400).json({ error: 'Falta institutionId' });
    }

    const token = await getGoCardlessToken(dbOps);
    
    // Save institution and country in settings
    dbOps.updateSetting('gocardless_institution_id', institutionId);
    dbOps.updateSetting('gocardless_country', country || 'ES');

    // Create End User Agreement (explicit for 90 days scope)
    console.log(`Creating end user agreement for institution: ${institutionId}`);
    const agreementRes = await fetch('https://bankaccountdata.gocardless.com/api/v2/agreements/enduser/', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        max_historical_days: 90,
        access_valid_for_days: 90,
        access_scope: ['balances', 'details', 'transactions'],
        institution_id: institutionId
      })
    });

    if (!agreementRes.ok) {
      const errText = await agreementRes.text();
      console.error('Error creating agreement:', errText);
      throw new Error('Error al crear el acuerdo bancario: ' + agreementRes.statusText);
    }
    
    const agreement = await agreementRes.json();
    
    // Create Requisition
    const reference = 'mc_' + Math.random().toString(36).substring(2, 15);
    dbOps.updateSetting('gocardless_reference', reference);

    // Build the redirect URL
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers.host;
    const redirectUrl = `${protocol}://${host}/api/bank/callback`;
    
    console.log(`Creating requisition with redirect callback: ${redirectUrl}`);

    const requisitionRes = await fetch('https://bankaccountdata.gocardless.com/api/v2/requisitions/', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        redirect: redirectUrl,
        institution_id: institutionId,
        agreement: agreement.id,
        reference: reference,
        user_language: 'ES'
      })
    });

    if (!requisitionRes.ok) {
      const errText = await requisitionRes.text();
      console.error('Error creating requisition:', errText);
      throw new Error('Error al crear la solicitud de conexión: ' + requisitionRes.statusText);
    }

    const requisition = await requisitionRes.json();
    dbOps.updateSetting('gocardless_requisition_id', requisition.id);

    res.json({ link: requisition.link });
  } catch (err) {
    console.error('Error in /api/bank/link:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Bank Consent Callback Handler
app.get('/api/bank/callback', async (req, res) => {
  try {
    const reference = req.query.ref;
    const settings = dbOps.getSettings();
    
    if (reference && settings.gocardless_reference !== reference) {
      console.warn('Warning: Requisition reference mismatch');
    }
    
    const requisitionId = settings.gocardless_requisition_id;
    if (!requisitionId) {
      throw new Error('No se encontró ninguna solicitud de conexión activa.');
    }

    const token = await getGoCardlessToken(dbOps);
    
    console.log(`Checking requisition status for ID: ${requisitionId}`);
    const response = await fetch(`https://bankaccountdata.gocardless.com/api/v2/requisitions/${requisitionId}/`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error('Error al consultar el estado de la conexión bancaria.');
    }

    const requisition = await response.json();
    
    if (requisition.accounts && requisition.accounts.length > 0) {
      dbOps.updateSetting('gocardless_accounts', JSON.stringify(requisition.accounts));
      dbOps.updateSetting('gocardless_linked', 'true');
      dbOps.updateSetting('gocardless_linked_date', new Date().toISOString());
      
      try {
        const instRes = await fetch(`https://bankaccountdata.gocardless.com/api/v2/institutions/${requisition.institution_id}/`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (instRes.ok) {
          const instData = await instRes.json();
          dbOps.updateSetting('gocardless_bank_name', instData.name || requisition.institution_id);
        } else {
          dbOps.updateSetting('gocardless_bank_name', requisition.institution_id);
        }
      } catch (err) {
        dbOps.updateSetting('gocardless_bank_name', requisition.institution_id);
      }
      
      console.log(`Successfully linked accounts: ${JSON.stringify(requisition.accounts)}`);
      res.redirect('/?bank_status=success');
    } else {
      console.warn(`No accounts found in requisition. Status: ${requisition.status}`);
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
    dbOps.updateSetting('gocardless_linked', 'false');
    dbOps.updateSetting('gocardless_accounts', '');
    dbOps.updateSetting('gocardless_requisition_id', '');
    dbOps.updateSetting('gocardless_reference', '');
    dbOps.updateSetting('gocardless_bank_name', '');
    dbOps.updateSetting('gocardless_linked_date', '');
    console.log('Bank unlinked successfully.');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sync bank transactions
app.post('/api/bank/sync', async (req, res) => {
  try {
    const settings = dbOps.getSettings();
    if (settings.gocardless_linked !== 'true') {
      return res.status(400).json({ error: 'No hay ninguna cuenta bancaria vinculada.' });
    }

    const accountsStr = settings.gocardless_accounts;
    if (!accountsStr) {
      return res.status(400).json({ error: 'No se encontraron IDs de cuenta bancaria vinculados.' });
    }

    const accounts = JSON.parse(accountsStr);
    const token = await getGoCardlessToken(dbOps);
    const categories = dbOps.getCategories();
    
    let totalImported = 0;
    
    console.log(`Syncing transactions for ${accounts.length} bank account(s)...`);
    
    for (const accountId of accounts) {
      console.log(`Fetching transactions for account: ${accountId}`);
      const response = await fetch(`https://bankaccountdata.gocardless.com/api/v2/accounts/${accountId}/transactions/`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        console.error(`Error fetching transactions for account ${accountId}:`, response.statusText);
        continue;
      }

      const data = await response.json();
      const booked = (data.transactions && data.transactions.booked) || [];
      console.log(`Found ${booked.length} booked transaction(s) for account ${accountId}`);
      
      for (const tx of booked) {
        const txId = tx.transactionId || tx.internalTransactionId;
        if (!txId) continue;

        const amountNum = parseFloat(tx.transactionAmount.amount);
        const type = amountNum >= 0 ? 'income' : 'expense';
        const absoluteAmount = Math.abs(amountNum);
        
        const date = tx.bookingDate || tx.valueDate || new Date().toISOString().split('T')[0];
        
        let description = tx.remittanceInformationUnstructured || 
                          (tx.remittanceInformationUnstructuredArray && tx.remittanceInformationUnstructuredArray[0]) || 
                          'Transacción Bancaria';
        
        description = description.replace(/\s+/g, ' ').trim();
        if (description.length > 80) {
          description = description.substring(0, 77) + '...';
        }
        
        // Auto-categorization
        let categoryId = null;
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
        
        const notes = `Sincronizado de ${settings.gocardless_bank_name || 'Banco'}`;
        const result = dbOps.addBankTransaction(description, absoluteAmount, type, categoryId, date, notes, txId);
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
});
