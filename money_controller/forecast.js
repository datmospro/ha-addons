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
 * Calcula la proyección de flujo de caja diaria para un año entero (365 días)
 * @param {Array} temporaryTransactions - Transacciones ficticias para simulaciones "What-If"
 */
function generateForecast(temporaryTransactions = []) {
  const settings = dbOps.getSettings();
  const initialBalance = parseFloat(settings.initial_balance || 0);
  const safetyThreshold = parseFloat(settings.safety_threshold || 100);
  const monthlyVariableBudget = parseFloat(settings.variable_monthly_budget || 300);
  
  // Gasto variable diario prorrateado (Gasto Mensual / 30.4)
  const dailyVariableExpense = monthlyVariableBudget / 30.417;

  // Obtener fecha actual local
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = formatDate(today);

  // 1. Calcular saldo actual basado en todas las transacciones históricas reales hasta el día de HOY inclusive
  const allActualTransactions = dbOps.getTransactions();
  
  // Filtrar transacciones reales hasta hoy
  const historicalTransactions = allActualTransactions.filter(t => t.date <= todayStr);
  
  let currentBalance = initialBalance;
  historicalTransactions.forEach(t => {
    if (t.type === 'income') {
      currentBalance += t.amount;
    } else {
      currentBalance -= t.amount;
    }
  });

  // 2. Obtener transacciones futuras planificadas y reglas recurrentes
  const futurePlannedTransactions = allActualTransactions.filter(t => t.date > todayStr);
  const recurringRules = dbOps.getRecurringRules();

  // Combinar transacciones de simulación "What-If" con las transacciones planificadas futuras
  const simulatedFutureTransactions = [...futurePlannedTransactions, ...temporaryTransactions];

  // 3. Proyectar día a día
  const projection = [];
  const alerts = [];
  
  let runningBalance = currentBalance;
  let runningDate = new Date(today); // Empezamos hoy

  // Guardamos el día actual en la proyección
  projection.push({
    date: formatDate(runningDate),
    balance: parseFloat(runningBalance.toFixed(2)),
    variableExpense: 0,
    events: [{ description: 'Saldo Inicial Hoy', amount: runningBalance, type: 'info' }]
  });

  const categories = dbOps.getCategories();
  const categoriesMap = {};
  categories.forEach(c => { categoriesMap[c.id] = c; });

  for (let i = 1; i <= 365; i++) {
    runningDate = addDays(runningDate, 1);
    const dateStr = formatDate(runningDate);
    const dayEvents = [];

    // A) Aplicar gasto variable diario (excepto si el presupuesto es 0)
    let dailyVar = 0;
    if (dailyVariableExpense > 0) {
      dailyVar = dailyVariableExpense;
      runningBalance -= dailyVar;
    }

    // B) Comprobar transacciones puntuales futuras (planificadas o What-If)
    const dayTransactions = simulatedFutureTransactions.filter(t => t.date === dateStr);
    dayTransactions.forEach(t => {
      if (t.type === 'income') {
        runningBalance += t.amount;
        dayEvents.push({
          id: t.id,
          description: t.description + (t.isTemp ? ' (Simulado)' : ''),
          amount: t.amount,
          type: 'income',
          category: t.category_name || (t.category_id ? categoriesMap[t.category_id]?.name : 'Sin categoría')
        });
      } else {
        runningBalance -= t.amount;
        dayEvents.push({
          id: t.id,
          description: t.description + (t.isTemp ? ' (Simulado)' : ''),
          amount: t.amount,
          type: 'expense',
          category: t.category_name || (t.category_id ? categoriesMap[t.category_id]?.name : 'Sin categoría')
        });
      }
    });

    // C) Comprobar reglas recurrentes
    recurringRules.forEach(rule => {
      if (doesRuleApply(rule, dateStr)) {
        if (rule.type === 'income') {
          runningBalance += rule.amount;
          dayEvents.push({
            ruleId: rule.id,
            description: rule.description + ' (Fijo)',
            amount: rule.amount,
            type: 'income',
            category: rule.category_name || 'Ingresos Fijos'
          });
        } else {
          runningBalance -= rule.amount;
          dayEvents.push({
            ruleId: rule.id,
            description: rule.description + ' (Fijo)',
            amount: rule.amount,
            type: 'expense',
            category: rule.category_name || 'Gastos Fijos'
          });
        }
      }
    });

    const finalDayBalance = parseFloat(runningBalance.toFixed(2));

    // Registrar datos del día
    projection.push({
      date: dateStr,
      balance: finalDayBalance,
      variableExpense: parseFloat(dailyVar.toFixed(2)),
      events: dayEvents
    });

    // D) Evaluar si hay alertas de descubierto o saldo bajo
    if (finalDayBalance < 0) {
      // Descubierto
      alerts.push({
        date: dateStr,
        balance: finalDayBalance,
        severity: 'danger',
        message: `¡Alerta de descubierto! Saldo de ${finalDayBalance.toFixed(2)}€ (supera el límite de 0.00€).`,
        causes: dayEvents.map(e => `${e.description} (${e.type === 'income' ? '+' : '-'}${e.amount.toFixed(2)}€)`).join(', ')
      });
    } else if (finalDayBalance < safetyThreshold) {
      // Saldo bajo
      alerts.push({
        date: dateStr,
        balance: finalDayBalance,
        severity: 'warning',
        message: `Saldo bajo: ${finalDayBalance.toFixed(2)}€ (por debajo de tu umbral de seguridad de ${safetyThreshold.toFixed(2)}€).`,
        causes: dayEvents.map(e => `${e.description} (${e.type === 'income' ? '+' : '-'}${e.amount.toFixed(2)}€)`).join(', ')
      });
    }
  }

  // Resumen del estado financiero proyectado
  const balancesOnly = projection.map(p => p.balance);
  const minBalance = Math.min(...balancesOnly);
  const minBalanceDate = projection[balancesOnly.indexOf(minBalance)].date;
  const daysInNegative = projection.filter(p => p.balance < 0).length;

  return {
    todayBalance: parseFloat(currentBalance.toFixed(2)),
    minProjectedBalance: parseFloat(minBalance.toFixed(2)),
    minProjectedBalanceDate: minBalanceDate,
    daysInNegative,
    projection,
    alerts: alerts.filter((alert, index, self) => 
      // Filtrar alertas duplicadas consecutivas si no cambian mucho, o simplemente devolverlas agrupadas por rachas
      // Devolveremos todas las alertas pero la UI puede resumirlas
      true
    )
  };
}

module.exports = {
  generateForecast
};
