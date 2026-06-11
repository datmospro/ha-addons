const dbOps = require('./database');

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
 * Suma o resta días a una fecha
 */
function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Comprueba si una regla recurrente aplica para un día específico
 */
function doesRuleApply(rule, dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const start = new Date(rule.start_date + 'T00:00:00');
  
  // Si la fecha es anterior a la fecha de inicio o posterior a la fecha de fin (si existe)
  if (d < start) return false;
  if (rule.end_date && d > new Date(rule.end_date + 'T00:00:00')) return false;

  const targetDay = d.getDate();
  const targetMonth = d.getMonth() + 1;
  const targetYear = d.getFullYear();

  const startDay = start.getDate();
  const startMonth = start.getMonth() + 1;
  const startYear = start.getFullYear();

  // Diferencia en meses
  const monthDiff = (targetYear - startYear) * 12 + (targetMonth - startMonth);

  // Auxiliar para calcular si es el último día del mes
  const isLastDayOfMonth = (date) => {
    const nextDay = new Date(date.getTime());
    nextDay.setDate(nextDay.getDate() + 1);
    return nextDay.getMonth() !== date.getMonth();
  };

  // Ajuste de día de cobro/gasto (por ejemplo, si cae en 31 pero el mes tiene 30 días, se cobra el 30)
  const matchesDayOfMonth = (targetDayNum) => {
    if (targetDay === targetDayNum) return true;
    // Si el mes tiene menos días que targetDayNum, disparar el último día del mes
    if (targetDayNum > 28 && isLastDayOfMonth(d)) {
      const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
      if (targetDayNum >= daysInMonth) return true;
    }
    return false;
  };

  switch (rule.frequency) {
    case 'weekly':
      // Se repite cada 7 días a partir del día de inicio (mismo día de la semana)
      return d.getDay() === start.getDay();

    case 'monthly':
      return matchesDayOfMonth(rule.day_of_month || startDay);

    case 'bimonthly':
      return (monthDiff % 2 === 0) && matchesDayOfMonth(rule.day_of_month || startDay);

    case 'quarterly':
      return (monthDiff % 3 === 0) && matchesDayOfMonth(rule.day_of_month || startDay);

    case 'semiannually':
      return (monthDiff % 6 === 0) && matchesDayOfMonth(rule.day_of_month || startDay);

    case 'annually':
      if (rule.specific_date) {
        // Formato MM-DD
        const [specMonth, specDay] = rule.specific_date.split('-').map(Number);
        if (targetMonth === specMonth) {
          return matchesDayOfMonth(specDay);
        }
        return false;
      }
      return (monthDiff % 12 === 0) && matchesDayOfMonth(rule.day_of_month || startDay);

    default:
      return false;
  }
}

/**
 * Sincroniza y convierte ocurrencias de gastos fijos pasadas a transacciones reales.
 * Ajusta el saldo inicial para que el saldo actual de hoy no varíe.
 */
function syncPastRecurringOccurrences() {
  // Desactivado: Dejamos los gastos fijos únicamente para el pronóstico de saldo futuro
}

/**
 * Calcula la proyección de flujo de caja diaria para un año entero (365 días)
 * @param {Array} temporaryTransactions - Transacciones ficticias para simulaciones "What-If"
 */
function generateForecast(temporaryTransactions = [], daysToProject = 365) {
  // Sincronizar ocurrencias pasadas antes de cargar datos
  syncPastRecurringOccurrences();

  // Obtener fecha actual local
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = formatDate(today);

  const settings = dbOps.getSettings();
  const initialBalance = parseFloat(settings.initial_balance || 0);
  const safetyThreshold = parseFloat(settings.safety_threshold || 100);
  const monthlyVariableBudget = parseFloat(settings.variable_monthly_budget || 300);

  // 1. Obtener todas las transacciones reales en la base de datos
  const allActualTransactions = dbOps.getTransactions();
  const futurePlannedTransactions = allActualTransactions.filter(t => t.date > todayStr);
  const historicalTransactions = allActualTransactions.filter(t => t.date <= todayStr);

  // Obtener transacciones variables reales del mes actual
  const startOfMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  const actualVariableSpent = historicalTransactions
    .filter(t => t.date >= startOfMonthStr && t.date <= todayStr && t.type === 'expense' && !t.recurring_rule_id)
    .reduce((sum, t) => sum + t.amount, 0);

  // Días restantes en el mes actual (incluyendo hoy)
  const daysInCurrentMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const daysRemaining = daysInCurrentMonth - today.getDate() + 1;

  const remainingVariableBudget = Math.max(0, monthlyVariableBudget - actualVariableSpent);
  const dailyVarCurrentMonth = daysRemaining > 0 ? remainingVariableBudget / daysRemaining : 0;

  // Calcular el saldo disponible "hoy" de forma estática para las tarjetas (sin prorrateo virtual)
  let todayBalance = initialBalance;
  historicalTransactions.forEach(t => {
    if (t.type === 'income') {
      todayBalance += t.amount;
    } else {
      todayBalance -= t.amount;
    }
  });

  // 2. Determinar saldo inicial al comienzo del historial (2026-06-01)
  const historyStartStr = todayStr < '2026-06-01' ? todayStr : '2026-06-01';
  let runningBalance = initialBalance;
  
  // Sumamos/restamos todas las transacciones previas al inicio del historial
  const preHistoryTransactions = historicalTransactions.filter(t => t.date < historyStartStr);
  preHistoryTransactions.forEach(t => {
    if (t.type === 'income') {
      runningBalance += t.amount;
    } else {
      runningBalance -= t.amount;
    }
  });

  // 3. Proyectar día a día
  const projection = [];
  const alerts = [];

  const categories = dbOps.getCategories();
  const categoriesMap = {};
  categories.forEach(c => { categoriesMap[c.id] = c; });

  // A) Bucle histórico: desde el 01/06/2026 hasta hoy inclusive
  let currentDate = new Date(historyStartStr + 'T12:00:00');
  const todayDate = new Date(todayStr + 'T12:00:00');

  while (currentDate <= todayDate) {
    const dateStr = formatDate(currentDate);
    const dayEvents = [];

    // Aplicar gasto variable virtual para hoy (los días anteriores están cerrados y reflejados en el saldo real)
    let dailyVar = 0;
    if (dateStr === todayStr && monthlyVariableBudget > 0) {
      dailyVar = dailyVarCurrentMonth;
      runningBalance -= dailyVar;
    }

    // Aplicar transacciones reales pasadas
    const dayTransactions = historicalTransactions.filter(t => t.date === dateStr);
    dayTransactions.forEach(t => {
      if (t.type === 'income') {
        runningBalance += t.amount;
        dayEvents.push({
          id: t.id,
          description: t.description,
          amount: t.amount,
          type: 'income',
          category: t.category_name || (t.category_id ? categoriesMap[t.category_id]?.name : 'Sin categoría'),
          category_id: t.category_id,
          isPast: true
        });
      } else {
        runningBalance -= t.amount;
        dayEvents.push({
          id: t.id,
          description: t.description,
          amount: t.amount,
          type: 'expense',
          category: t.category_name || (t.category_id ? categoriesMap[t.category_id]?.name : 'Sin categoría'),
          category_id: t.category_id,
          isPast: true
        });
      }
    });

    const finalDayBalance = parseFloat(runningBalance.toFixed(2));

    projection.push({
      date: dateStr,
      balance: finalDayBalance,
      variableExpense: parseFloat(dailyVar.toFixed(2)),
      events: dayEvents,
      isPast: true
    });

    // Registrar alertas si aplica
    if (finalDayBalance < 0) {
      alerts.push({
        date: dateStr,
        balance: finalDayBalance,
        severity: 'danger',
        message: `¡Alerta de descubierto! Saldo de ${finalDayBalance.toFixed(2)}€ (supera el límite de 0.00€).`,
        causes: dayEvents.map(e => `${e.description} (${e.type === 'income' ? '+' : '-'}${e.amount.toFixed(2)}€)`).join(', '),
        isPast: true
      });
    } else if (finalDayBalance < safetyThreshold) {
      alerts.push({
        date: dateStr,
        balance: finalDayBalance,
        severity: 'warning',
        message: `Saldo bajo: ${finalDayBalance.toFixed(2)}€ (por debajo de tu umbral de seguridad de ${safetyThreshold.toFixed(2)}€).`,
        causes: dayEvents.map(e => `${e.description} (${e.type === 'income' ? '+' : '-'}${e.amount.toFixed(2)}€)`).join(', '),
        isPast: true
      });
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  // B) Bucle futuro: desde hoy (para fijos) y mañana (para puntuales) hasta dentro de 365 días
  const simulatedFutureTransactions = [...futurePlannedTransactions, ...temporaryTransactions];
  const recurringRules = dbOps.getRecurringRules();

  let futureCurrentDate = new Date(todayStr + 'T12:00:00');

  for (let i = 0; i <= daysToProject; i++) {
    const dateStr = formatDate(futureCurrentDate);
    const dayEvents = [];

    // Aplicar gasto variable diario prorrateado dinámico
    let dailyVar = 0;
    if (monthlyVariableBudget > 0) {
      const dayDate = new Date(dateStr + 'T12:00:00');
      if (dayDate.getMonth() === today.getMonth() && dayDate.getFullYear() === today.getFullYear()) {
        dailyVar = dailyVarCurrentMonth;
      } else {
        const daysInThatMonth = new Date(dayDate.getFullYear(), dayDate.getMonth() + 1, 0).getDate();
        dailyVar = monthlyVariableBudget / daysInThatMonth;
      }
      
      // El gasto variable de "hoy" ya se restó en el bucle histórico si corresponde.
      // Por tanto, en el bucle futuro solo lo restamos a partir de mañana (dateStr > todayStr).
      if (dateStr > todayStr) {
        runningBalance -= dailyVar;
      }
    }

    // Comprobar transacciones puntuales futuras (solo a partir de mañana, hoy ya está en el historial)
    if (dateStr > todayStr) {
      const dayTransactions = simulatedFutureTransactions.filter(t => t.date === dateStr);
      dayTransactions.forEach(t => {
        if (t.type === 'income') {
          runningBalance += t.amount;
          dayEvents.push({
            id: t.id,
            description: t.description + (t.isTemp ? ' (Simulado)' : ''),
            amount: t.amount,
            type: 'income',
            category: t.category_name || (t.category_id ? categoriesMap[t.category_id]?.name : 'Sin categoría'),
            category_id: t.category_id
          });
        } else {
          runningBalance -= t.amount;
          dayEvents.push({
            id: t.id,
            description: t.description + (t.isTemp ? ' (Simulado)' : ''),
            amount: t.amount,
            type: 'expense',
            category: t.category_name || (t.category_id ? categoriesMap[t.category_id]?.name : 'Sin categoría'),
            category_id: t.category_id
          });
        }
      });
    }

    // Comprobar reglas recurrentes (gastos fijos) para hoy y el futuro
    recurringRules.forEach(rule => {
      if (doesRuleApply(rule, dateStr)) {
        // Comprobar si esta ocurrencia ya existe físicamente en la base de datos (cobrado/sincronizado)
        const isSatisfied = dbOps.hasTransactionForRecurrence(rule.id, dateStr);
        
        if (!isSatisfied) {
          if (rule.type === 'income') {
            runningBalance += rule.amount;
            dayEvents.push({
              ruleId: rule.id,
              description: rule.description + ' (Fijo)',
              amount: rule.amount,
              type: 'income',
              category: rule.category_name || 'Ingresos Fijos',
              category_id: rule.category_id
            });
          } else {
            runningBalance -= rule.amount;
            dayEvents.push({
              ruleId: rule.id,
              description: rule.description + ' (Fijo)',
              amount: rule.amount,
              type: 'expense',
              category: rule.category_name || 'Gastos Fijos',
              category_id: rule.category_id
            });
          }
        }
      }
    });

    const finalDayBalance = parseFloat(runningBalance.toFixed(2));

    // Si es hoy, actualizamos el saldo en la proyección (hoy ya se insertó en el bucle histórico)
    if (dateStr === todayStr) {
      const todayProj = projection.find(p => p.date === todayStr);
      if (todayProj) {
        todayProj.balance = finalDayBalance;
        // Combinamos los eventos reales de hoy con los eventos fijos proyectados virtualmente
        todayProj.events = [...todayProj.events, ...dayEvents];
      }
    } else {
      projection.push({
        date: dateStr,
        balance: finalDayBalance,
        variableExpense: parseFloat(dailyVar.toFixed(2)),
        events: dayEvents
      });
    }

    // Registrar alertas
    if (finalDayBalance < 0) {
      alerts.push({
        date: dateStr,
        balance: finalDayBalance,
        severity: 'danger',
        message: `¡Alerta de descubierto! Saldo de ${finalDayBalance.toFixed(2)}€ (supera el límite de 0.00€).`,
        causes: dayEvents.map(e => `${e.description} (${e.type === 'income' ? '+' : '-'}${e.amount.toFixed(2)}€)`).join(', ')
      });
    } else if (finalDayBalance < safetyThreshold) {
      alerts.push({
        date: dateStr,
        balance: finalDayBalance,
        severity: 'warning',
        message: `Saldo bajo: ${finalDayBalance.toFixed(2)}€ (por debajo de tu umbral de seguridad de ${safetyThreshold.toFixed(2)}€).`,
        causes: dayEvents.map(e => `${e.description} (${e.type === 'income' ? '+' : '-'}${e.amount.toFixed(2)}€)`).join(', ')
      });
    }

    futureCurrentDate.setDate(futureCurrentDate.getDate() + 1);
  }

  // Resumen del estado financiero proyectado (solo sobre proyección futura)
  const futureBalances = projection.filter(p => !p.isPast).map(p => p.balance);
  const minBalance = futureBalances.length > 0 ? Math.min(...futureBalances) : runningBalance;
  
  const minBalanceIndex = projection.findIndex(p => !p.isPast && p.balance === minBalance);
  const minBalanceDate = minBalanceIndex !== -1 ? projection[minBalanceIndex].date : todayStr;
  const daysInNegative = projection.filter(p => !p.isPast && p.balance < 0).length;

  return {
    todayBalance: parseFloat(todayBalance.toFixed(2)),
    minProjectedBalance: parseFloat(minBalance.toFixed(2)),
    minProjectedBalanceDate: minBalanceDate,
    daysInNegative,
    projection,
    alerts: alerts.filter(a => !a.isPast)
  };
}

module.exports = {
  generateForecast
};
