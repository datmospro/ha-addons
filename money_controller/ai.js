const dbOps = require('./database');
const { generateForecast } = require('./forecast');

/**
 * Normaliza un objeto Date a YYYY-MM-DD local
 */
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Envía un mensaje a Telegram utilizando el token del bot y chat ID configurados
 */
async function sendTelegramMessage(message, settings) {
  const token = settings.telegram_bot_token;
  const chatId = settings.telegram_chat_id;
  if (!token || !chatId) {
    throw new Error('Telegram no está configurado (falta Token o Chat ID).');
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown'
      })
    });
    
    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.description || 'Error desconocido al enviar mensaje.');
    }
    return true;
  } catch (err) {
    console.error('Error al enviar mensaje de Telegram:', err.message);
    throw err;
  }
}

/**
 * Envía un mensaje de prueba para comprobar la configuración de Telegram
 */
async function sendTelegramTestMessage(token, chatId) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: '🔔 *Money Controller*: ¡Conexión con el bot de Telegram configurada con éxito! 🎉',
      parse_mode: 'Markdown'
    })
  });
  
  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.description || 'Error de autenticación con Telegram.');
  }
  return true;
}

/**
 * Compila todo el estado financiero del usuario para enviarlo como contexto a la IA
 */
function buildFinancialContext(todayStr) {
  const settings = dbOps.getSettings();
  const categories = dbOps.getCategories();
  const recurringRules = dbOps.getRecurringRules();
  
  const today = new Date();
  const sixtyDaysAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 60);
  const startRange = formatDate(sixtyDaysAgo);
  const recentTxs = dbOps.getTransactions({ start_date: startRange });
  
  // Proyección a 90 días para dar un contexto de corto-mediano plazo
  const forecast = generateForecast([], todayStr, formatDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 90)));
  
  const cleanCategories = categories.map(c => ({ id: c.id, name: c.name, type: c.type }));
  const cleanRecurring = recurringRules.map(r => ({
    description: r.description,
    amount: r.amount,
    type: r.type,
    frequency: r.frequency,
    day_of_month: r.day_of_month,
    specific_date: r.specific_date,
    start_date: r.start_date,
    end_date: r.end_date
  }));
  
  const cleanTxs = recentTxs.map(t => ({
    date: t.date,
    description: t.description,
    amount: t.amount,
    type: t.type,
    category: t.category_name
  }));

  const cleanAlerts = forecast.alerts.map(a => ({
    date: a.date,
    balance: a.balance,
    severity: a.severity,
    message: a.message,
    causes: a.causes
  }));

  return {
    todayDate: todayStr,
    settings: {
      safety_threshold: parseFloat(settings.safety_threshold || 100),
      variable_monthly_budget: parseFloat(settings.variable_monthly_budget || 300),
      currency: settings.currency || 'EUR'
    },
    todayBalance: forecast.todayBalance,
    minProjectedBalance: forecast.minProjectedBalance,
    minProjectedBalanceDate: forecast.minProjectedBalanceDate,
    daysInNegative: forecast.daysInNegative,
    alertsCount: cleanAlerts.length,
    activeAlerts: cleanAlerts.slice(0, 15),
    categories: cleanCategories,
    recurringRules: cleanRecurring,
    recentTransactions: cleanTxs.slice(-40) // Últimos 40 movimientos
  };
}

/**
 * Consulta a Google Gemini utilizando el modelo gratuito gemini-2.5-flash
 */
async function callGeminiAPI(apiKey, systemInstruction, userPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  
  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }]
      }
    ],
    system_instruction: {
      parts: [{ text: systemInstruction }]
    },
    generationConfig: {
      temperature: 0.3
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    let message = errText;
    try {
      const parsed = JSON.parse(errText);
      message = parsed.error?.message || errText;
    } catch (e) {}
    throw new Error(`Error en API de Gemini: ${message}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('La API de Gemini devolvió una respuesta vacía.');
  }
  return text.trim();
}

/**
 * Responde de manera interactiva a una pregunta del usuario
 */
async function askAI(userMessage, settings) {
  const apiKey = settings.gemini_api_key;
  if (!apiKey) {
    throw new Error('La clave API de Gemini no está configurada.');
  }

  const todayStr = formatDate(new Date());
  const context = buildFinancialContext(todayStr);

  const systemInstruction = `Eres un asesor financiero personal experto integrado en la aplicación 'Money Controller'. 
Ayudas al usuario a entender sus finanzas, analizar sus gastos, prever problemas y tomar decisiones basándote estrictamente en sus datos bancarios reales y proyecciones suministradas en el contexto JSON. 

NORMAS DE COMPORTAMIENTO:
1. Sé conciso, directo y útil. Estás hablando en un chat rápido de panel financiero.
2. Utiliza siempre el formato Markdown para estructurar tus respuestas (listas, negritas, código, etc.).
3. Responde siempre en español.
4. Muestra importes formateados con su divisa (ej: 250,50 €).
5. No inventes transacciones. Si no dispones de datos para responder a algo concreto del pasado lejano, indícalo amablemente.
6. Si te preguntan si pueden permitirse financiar algo, analiza su saldo disponible actual y las alertas futuras proyectadas en el contexto para dar un veredicto claro.`;

  const userPrompt = `ESTADO FINANCIERO DEL USUARIO EN FORMATO JSON:
${JSON.stringify(context, null, 2)}

PREGUNTA DEL USUARIO:
"${userMessage}"`;

  return await callGeminiAPI(apiKey, systemInstruction, userPrompt);
}

/**
 * Realiza un análisis financiero proactivo diario para decidir si enviar notificación
 */
async function runProactiveAIAnalysis(settings, todayStr) {
  const apiKey = settings.gemini_api_key;
  if (!apiKey) return 'NO_ALERT';

  const context = buildFinancialContext(todayStr);

  const systemInstruction = `Eres un asistente de finanzas personal proactivo. Analizas los datos financieros del usuario para identificar situaciones que ameriten enviarle un mensaje diario informativo o de alerta a su Telegram.

TU TAREA:
Analiza el estado financiero JSON suministrado. Busca problemas inminentes o logros importantes:
1. ALERTA CRÍTICA: ¿El saldo proyectado bajará de cero (descubierto) o cruzará el umbral de seguridad en los próximos 30 días?
2. RECORDATORIO DE VENCIMIENTO: ¿Vence algún gasto fijo grande o importante en los próximos 3 días (ej: hipoteca, seguro)?
3. LOGRO DE AHORRO: ¿El usuario está gastando significativamente menos en variables que su presupuesto?

REGLAS DE SALIDA:
- Si no hay ninguna alerta crítica, vencimiento importante de gran impacto o insight valioso, responde ÚNICAMENTE con la palabra: NO_ALERT.
- Si detectas algo relevante, escribe un mensaje corto, directo, motivador y claro en español para el usuario.
- El mensaje debe ocupar menos de 120 palabras.
- Usa formato Markdown de Telegram (ej: *negrita*, _cursiva_).
- Usa emojis de forma inteligente (⚠️, 🛑, 🎉, 💡) para clasificar el mensaje.
- Sé específico con las fechas e importes (ej: "el día 15/06 tu saldo caerá a 45 €").
- No saludes formalmente. Ve directo al grano.`;

  const userPrompt = `ESTADO FINANCIERO DEL USUARIO EN FORMATO JSON:
${JSON.stringify(context, null, 2)}`;

  return await callGeminiAPI(apiKey, systemInstruction, userPrompt);
}

/**
 * Planificador en segundo plano para el análisis diario
 */
function startProactiveScheduler() {
  console.log("Iniciando planificador proactivo de IA (Telegram)...");
  
  // Ejecutar verificación inicial tras 15 segundos y luego cada 1 hora
  setTimeout(checkAndRunProactiveAnalysis, 15000);
  setInterval(checkAndRunProactiveAnalysis, 60 * 60 * 1000); 
}

async function checkAndRunProactiveAnalysis() {
  try {
    const settings = dbOps.getSettings();
    if (settings.telegram_notifications_enabled !== 'true') return;
    if (!settings.gemini_api_key || !settings.telegram_bot_token || !settings.telegram_chat_id) return;

    const today = new Date();
    const todayStr = formatDate(today);
    
    // Si ya enviamos una hoy, no hacer nada
    if (settings.telegram_last_notification_date === todayStr) return;

    // Solo enviar mensajes en un horario razonable (entre 9:00 AM y 9:00 PM)
    const currentHour = today.getHours();
    if (currentHour < 9 || currentHour > 21) return;

    console.log("Comenzando análisis proactivo financiero diario con IA...");
    const message = await runProactiveAIAnalysis(settings, todayStr);
    
    if (message && message !== 'NO_ALERT') {
      console.log(`Mensaje proactivo generado: "${message}". Enviando a Telegram...`);
      const success = await sendTelegramMessage(message, settings);
      if (success) {
        dbOps.updateSetting('telegram_last_notification_date', todayStr);
        console.log("Notificación proactiva de Telegram enviada con éxito.");
      }
    } else {
      console.log("Análisis completado: sin alertas relevantes que notificar hoy.");
      // Marcamos el día como verificado para no molestar a la IA de nuevo cada hora
      dbOps.updateSetting('telegram_last_notification_date', todayStr);
    }
  } catch (err) {
    console.error("Error en planificador proactivo de IA:", err.message);
  }
}

module.exports = {
  askAI,
  sendTelegramTestMessage,
  startProactiveScheduler,
  checkAndRunProactiveAnalysis // Para poder forzar tests
};
