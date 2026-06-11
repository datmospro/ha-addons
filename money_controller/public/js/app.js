// MoneyController Frontend Application

// State
let categories = [];
let settings = {};
let currentTab = 'dashboard';
let transactions = [];
let txCurrentPage = 1;
const txLimit = 50;
let recurringRules = [];
let forecastData = null;
let currentCalendarDate = new Date();
let selectedCalendarDay = null;

// What-If scenarios (stored in memory)
let simulatedScenarios = [];

// Recurring Rules tab controls state
let recSearch = '';
let recFilterType = '';
let recFilterCategory = '';
let recSort = 'day';
let recViewMode = localStorage.getItem('recViewMode') || 'grid';
let useHeatmap = localStorage.getItem('use_heatmap') === 'true';
let showEndDates = localStorage.getItem('forecast_show_end_dates') === 'true';

// Chart instances
let forecastChart = null;
let categoryChart = null;
let historyChart = null;

// Currency Formatter Helper
function formatCurrency(amount, currency = settings.currency || 'EUR') {
  const symbol = {
    EUR: '€',
    USD: '$',
    GBP: '£',
    MXN: '$'
  }[currency] || '€';
  
  return `${amount.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${symbol}`;
}

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  await loadBaseData();
  setupEventListeners();
  
  // Check for bank callback params
  const urlParams = new URLSearchParams(window.location.search);
  const bankStatus = urlParams.get('bank_status');
  if (bankStatus) {
    // Clear query parameters from URL
    window.history.replaceState({}, document.title, window.location.pathname);
    
    if (bankStatus === 'success') {
      showToast('¡Banco vinculado con éxito! Ya puedes sincronizar tus movimientos.', 'success');
      switchTab('settings');
      // Wait a moment, then auto-trigger first sync
      setTimeout(() => {
        if (confirm('¿Deseas realizar la primera sincronización de movimientos bancarios ahora?')) {
          syncBank();
        }
      }, 1000);
    } else {
      const reason = urlParams.get('reason') || 'Desconocida';
      showToast(`Error al vincular el banco: ${reason}`, 'danger');
      switchTab('settings');
    }
  } else {
    switchTab('dashboard');
  }
  
  // Initialize Lucide Icons
  lucide.createIcons();
});

// Load Base Configuration & Data
async function loadBaseData() {
  try {
    // 1. Load Settings
    const settingsRes = await fetch('/api/settings');
    settings = await settingsRes.json();
    
    // Update currency display elements
    document.querySelectorAll('.currency-symbol').forEach(el => {
      el.textContent = { EUR: '€', USD: '$', GBP: '£', MXN: '$' }[settings.currency] || '€';
    });
    document.getElementById('txt-currency-status').textContent = `Divisa: ${settings.currency || 'EUR'}`;
    
    // Fill Settings Form
    document.getElementById('set-initial-balance').value = settings.initial_balance || 0;
    document.getElementById('set-safety-threshold').value = settings.safety_threshold || 100;
    document.getElementById('set-variable-budget').value = settings.variable_monthly_budget || 300;
    document.getElementById('set-currency').value = settings.currency || 'EUR';
    document.getElementById('set-shift-income-category').value = settings.shift_income_category || '';
    document.getElementById('set-shift-income-day').value = settings.shift_income_day || '25';

    // Fill AI & Telegram Settings Form
    document.getElementById('set-gemini-api-key').value = settings.gemini_api_key || '';
    document.getElementById('set-gemini-model').value = settings.gemini_model || 'gemini-2.5-flash';
    const telegramEnabled = settings.telegram_notifications_enabled === 'true';
    document.getElementById('set-telegram-enabled').checked = telegramEnabled;
    document.getElementById('set-telegram-bot-token').value = settings.telegram_bot_token || '';
    document.getElementById('set-telegram-chat-id').value = settings.telegram_chat_id || '';
    
    // Toggle fields visibility
    document.getElementById('telegram-config-fields').style.display = telegramEnabled ? 'flex' : 'none';
    document.getElementById('telegram-save-only-fields').style.display = telegramEnabled ? 'none' : 'block';

    // 2. Load Categories
    const categoriesRes = await fetch('/api/categories');
    categories = await categoriesRes.json();
    populateCategorySelects();
    renderCategoryManager();
    
    // Update Bank UI state
    updateBankUI();

    // 3. Trigger initial forecast calculation
    await runForecastCalculation();

  } catch (err) {
    console.error('Error loading initial data:', err);
    showToast('Error cargando la configuración base.', 'danger');
  }
}

// Populate Category dropdown lists
function populateCategorySelects() {
  const txCatSelect = document.getElementById('tx-category');
  const recCatSelect = document.getElementById('rec-category');
  const filterCatSelect = document.getElementById('tx-filter-category');
  const recFilterCatSelect = document.getElementById('rec-filter-category');
  
  txCatSelect.innerHTML = '<option value="" disabled selected>Selecciona categoría...</option>';
  recCatSelect.innerHTML = '<option value="" disabled selected>Selecciona categoría...</option>';
  filterCatSelect.innerHTML = '<option value="">Todas las Categorías</option>';
  if (recFilterCatSelect) recFilterCatSelect.innerHTML = '<option value="">Todas las Categorías</option>';
  
  categories.forEach(cat => {
    const optionHTML = `<option value="${cat.id}">${cat.type === 'income' ? '📥' : '📤'} ${cat.name}</option>`;
    txCatSelect.insertAdjacentHTML('beforeend', optionHTML);
    recCatSelect.insertAdjacentHTML('beforeend', optionHTML);
    
    // For filters
    const filterOptionHTML = `<option value="${cat.id}">${cat.name}</option>`;
    filterCatSelect.insertAdjacentHTML('beforeend', filterOptionHTML);
    if (recFilterCatSelect) recFilterCatSelect.insertAdjacentHTML('beforeend', filterOptionHTML);
  });

  // For shift category settings
  const shiftCatSelect = document.getElementById('set-shift-income-category');
  if (shiftCatSelect) {
    shiftCatSelect.innerHTML = '<option value="">Ninguno (Desactivado)</option>';
    categories.filter(c => c.type === 'income').forEach(cat => {
      shiftCatSelect.insertAdjacentHTML('beforeend', `<option value="${cat.id}">${cat.name}</option>`);
    });
    shiftCatSelect.value = settings.shift_income_category || '';
  }
}

// Run Cash Flow Forecast Engine (Handles standard and simulated runs)
async function runForecastCalculation() {
  try {
    // Load fresh recurring rules to obtain current ending dates for chart/calendar indicators
    try {
      const rulesRes = await fetch('/api/recurring');
      recurringRules = await rulesRes.json();
    } catch (err) {
      console.error('Error fetching fresh recurring rules for forecast:', err);
    }
    
    let res;
    // Calculate calendar-aligned dates based on period input
    let startDateStr = '';
    let endDateStr = '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const periodValueEl = document.getElementById('forecast-period-value');
    const periodUnitEl = document.getElementById('forecast-period-unit');
    if (periodValueEl && periodUnitEl) {
      let val = parseInt(periodValueEl.value) || 1;
      if (val < 1) val = 1;
      const unit = periodUnitEl.value;
      if (unit === 'months') {
        // Start from January 1st of the current year (same as years mode)
        const startYear = today.getFullYear();
        const startDate = new Date(startYear, 0, 1);
        startDateStr = formatDate(startDate);

        // End: N months from Jan 1st → so 12 months = Dec 31 (same as 1 year)
        const endDate = new Date(startYear, val, 0);
        endDateStr = formatDate(endDate);
      } else if (unit === 'years') {
        const startYear = today.getFullYear();
        const startDate = new Date(startYear, 0, 1);
        startDateStr = formatDate(startDate);
        
        const endDate = new Date(startYear + val, 0, 0);
        endDateStr = formatDate(endDate);
      }
    } else {
      // Fallback to current calendar year
      const startYear = today.getFullYear();
      const startDate = new Date(startYear, 0, 1);
      startDateStr = formatDate(startDate);
      
      const endDate = new Date(startYear, today.getMonth() + 12, 0);
      endDateStr = formatDate(endDate);
    }

    if (simulatedScenarios.length > 0) {
      // Run simulation
      res = await fetch(`/api/forecast/simulate?start_date=${startDateStr}&end_date=${endDateStr}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ temporaryTransactions: simulatedScenarios })
      });
    } else {
      // Standard run
      res = await fetch(`/api/forecast?start_date=${startDateStr}&end_date=${endDateStr}`);
    }
    
    forecastData = await res.json();
    
    // Update top warning badge
    const badge = document.getElementById('forecast-status-badge');
    const badgeText = document.getElementById('forecast-status-text');
    
    badge.className = 'status-indicator';
    if (forecastData.daysInNegative > 0) {
      badge.classList.add('danger');
      badgeText.textContent = `Descubierto bancario previsto: ${forecastData.daysInNegative} días en números rojos.`;
    } else {
      // Check if minimum projected balance is below safety threshold
      if (forecastData.minProjectedBalance < parseFloat(settings.safety_threshold || 100)) {
        badge.classList.add('warning');
        badgeText.textContent = `Atención: Saldo por debajo del umbral de seguridad el ${formatDisplayDate(forecastData.minProjectedBalanceDate)}.`;
      } else {
        badge.classList.add('success');
        badgeText.textContent = 'Flujo de caja estable. Sin alertas detectadas en el año.';
      }
    }

    // Refresh active tab views
    if (currentTab === 'dashboard') {
      renderDashboard();
    } else if (currentTab === 'forecast') {
      renderForecastTab();
    }

  } catch (err) {
    console.error('Error running forecast:', err);
    showToast('Error al procesar la previsión diaria.', 'danger');
  }
}

async function renderDashboard() {
  if (!forecastData) return;
  
  // 1. Fetch transactions from the start of the previous month for summary cards (for shifted incomes)
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const startOfMonth = `${year}-${month}-01`;
  const endOfMonth = `${year}-${month}-${new Date(year, now.getMonth() + 1, 0).getDate()}`;
  
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const startOfPrevMonth = formatDate(prevMonthDate);
  
  try {
    const txRes = await fetch(`/api/transactions?start_date=${startOfPrevMonth}&end_date=${endOfMonth}`);
    const allTxs = await txRes.json();
    
    // Compute current month stats (applying shifted income rules)
    let incomesSum = 0;
    let expensesSum = 0;
    let variableExpensesSum = 0;
    
    const shiftCatId = settings.shift_income_category ? parseInt(settings.shift_income_category) : null;
    const shiftDay = settings.shift_income_day ? parseInt(settings.shift_income_day) : 25;
    
    const prevYear = prevMonthDate.getFullYear();
    const prevMonthStr = String(prevMonthDate.getMonth() + 1).padStart(2, '0');
    
    allTxs.forEach(t => {
      const tDate = new Date(t.date + 'T00:00:00');
      const tYear = tDate.getFullYear();
      const tMonth = String(tDate.getMonth() + 1).padStart(2, '0');
      const tDay = tDate.getDate();
      
      const isCurrentMonth = (tYear === now.getFullYear() && tMonth === month);
      const isPrevMonth = (tYear === prevYear && tMonth === prevMonthStr);
      
      if (isCurrentMonth) {
        if (t.type === 'expense') {
          expensesSum += t.amount;
          if (!t.recurring_rule_id) {
            variableExpensesSum += t.amount;
          }
        } else { // income
          // Check if shifted to next month
          const isShiftedToNext = (shiftCatId && t.category_id === shiftCatId && tDay >= shiftDay);
          if (!isShiftedToNext) {
            incomesSum += t.amount;
          }
        }
      } else if (isPrevMonth) {
        if (t.type === 'income') {
          // Check if shifted from last month to this month
          const isShiftedToCurrent = (shiftCatId && t.category_id === shiftCatId && tDay >= shiftDay);
          if (isShiftedToCurrent) {
            incomesSum += t.amount;
          }
        }
      }
    });
    
    // We also filter current month transactions (for categories doughnut chart, etc.)
    const currentMonthTxs = allTxs.filter(t => {
      const tDate = new Date(t.date + 'T00:00:00');
      const tYear = tDate.getFullYear();
      const tMonth = String(tDate.getMonth() + 1).padStart(2, '0');
      return (tYear === now.getFullYear() && tMonth === month);
    });

    // Forecast projection for current month
    // Display card values
    document.getElementById('card-balance').textContent = formatCurrency(forecastData.todayBalance);
    document.getElementById('card-incomes').textContent = formatCurrency(incomesSum);
    document.getElementById('card-expenses').textContent = formatCurrency(expensesSum);
    
    // Render monthly variable budget card
    const budget = parseFloat(settings.variable_monthly_budget || 0);
    const varStatusEl = document.getElementById('card-variable-status');
    const varSubEl = document.getElementById('card-variable-sub');
    if (varStatusEl && varSubEl) {
      if (budget > 0) {
        varStatusEl.textContent = `${formatCurrency(variableExpensesSum)} / ${formatCurrency(budget)}`;
        const diff = budget - variableExpensesSum;
        if (diff >= 0) {
          varStatusEl.className = 'amount';
          varSubEl.textContent = `Quedan ${formatCurrency(diff)}`;
          varSubEl.className = 'trend positive';
        } else {
          varStatusEl.className = 'amount red';
          varSubEl.textContent = `Superado en ${formatCurrency(Math.abs(diff))}`;
          varSubEl.className = 'trend negative';
        }
      } else {
        varStatusEl.textContent = formatCurrency(variableExpensesSum);
        varStatusEl.className = 'amount';
        varSubEl.textContent = 'Sin límite configurado';
        varSubEl.className = 'trend neutral';
      }
    }
    
    const netSavings = incomesSum - expensesSum;
    const netEl = document.getElementById('card-net');
    const netIconEl = document.getElementById('card-net-icon');
    const netSubEl = document.getElementById('card-net-sub');
    
    netEl.textContent = formatCurrency(netSavings);
    netEl.className = 'amount';
    
    // Calculate projected Month-End savings (Proposal 2 with shifting)
    let projIncomes = incomesSum;
    let projExpenses = expensesSum;
    const localTodayStr = formatDate(now);
    
    // Add today's virtual prorated variable expense if it was calculated
    const todayProjection = forecastData.projection.find(p => p.date === localTodayStr);
    if (todayProjection && todayProjection.variableExpense > 0) {
      projExpenses += todayProjection.variableExpense;
    }
    
    // Sum future events and variable expenses for the rest of the current month
    forecastData.projection.forEach(p => {
      if (p.date >= startOfMonth && p.date <= endOfMonth && !p.isPast) {
        p.events.forEach(e => {
          if (e.type === 'income') {
            const pDate = new Date(p.date + 'T00:00:00');
            const pDay = pDate.getDate();
            // Exclude future incomes that shift to next month
            const isShiftedToNext = (shiftCatId && e.category_id === shiftCatId && pDay >= shiftDay);
            if (!isShiftedToNext) {
              projIncomes += e.amount;
            }
          } else if (e.type === 'expense') {
            projExpenses += e.amount;
          }
        });
        if (p.variableExpense > 0) {
          projExpenses += p.variableExpense;
        }
      }
    });
    
    const projNet = projIncomes - projExpenses;
    const formattedProjNet = (projNet >= 0 ? '+' : '') + formatCurrency(projNet);
    
    if (netSavings > 0) {
      netEl.classList.add('green');
      netIconEl.className = 'card-icon income';
      netSubEl.textContent = 'Ahorro neto este mes';
    } else if (netSavings < 0) {
      netEl.classList.add('red');
      netIconEl.className = 'card-icon expense';
      netSubEl.textContent = 'Gasto supera ingresos este mes';
    } else {
      netIconEl.className = 'card-icon';
      netSubEl.textContent = 'Sin balance neto este mes';
    }

    // 2. Render Charts
    renderForecastLineChart();
    renderCategoriesDoughnutChart(currentMonthTxs);
    renderCompareMonthlyBarChart();

    // 3. Render Dashboard Alerts List
    renderDashboardAlertsList();

  } catch (err) {
    console.error('Error rendering dashboard:', err);
  }
}

// Render Forecast Line Chart
function renderForecastLineChart() {
  const ctx = document.getElementById('chart-forecast-line').getContext('2d');
  
  if (forecastChart) {
    forecastChart.destroy();
  }
  
  const projection = forecastData.projection;
  const labels = [];
  const balanceData = [];
  const safetyLine = [];
  const thinnedProjection = [];
  
  const safetyLimit = parseFloat(settings.safety_threshold || 100);
  
  // Dynamically calculate thinning step to keep about 120 points on the chart for best performance
  const step = Math.max(1, Math.floor(projection.length / 120));
  
  projection.forEach((p, idx) => {
    // Force inclusion of the point if a recurring rule ends on this day
    const hasEndingRule = showEndDates && recurringRules.some(r => r.end_date === p.date);
    // Select point if it aligns with the step, dips below safety, has an ending rule, or is the first/last point
    if (idx % step === 0 || p.balance < safetyLimit || hasEndingRule || idx === 0 || idx === projection.length - 1) {
      labels.push(formatDisplayDate(p.date));
      balanceData.push(p.balance);
      safetyLine.push(safetyLimit);
      thinnedProjection.push(p);
    }
  });

  const datasets = [
    {
      label: 'Saldo Bancario Simulado',
      data: balanceData,
      borderColor: '#a855f7', // Purple/indigo
      borderWidth: 2.5,
      pointRadius: 0,
      pointHoverRadius: 5,
      fill: true,
      backgroundColor: function(context) {
        const chart = context.chart;
        const {ctx, chartArea} = chart;
        if (!chartArea) return null;
        
        const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
        gradient.addColorStop(0, 'rgba(168, 85, 247, 0.2)');
        gradient.addColorStop(1, 'rgba(168, 85, 247, 0.0)');
        return gradient;
      },
      tension: 0.25
    },
    {
      label: 'Umbral de Seguridad',
      data: safetyLine,
      borderColor: '#ef4444',
      borderWidth: 1.5,
      borderDash: [5, 5],
      pointRadius: 0,
      pointHoverRadius: 0,
      fill: false
    }
  ];

  if (showEndDates) {
    const endDatesData = [];
    thinnedProjection.forEach(p => {
      const endingRules = recurringRules.filter(r => r.end_date === p.date);
      if (endingRules.length > 0) {
        endDatesData.push(p.balance);
      } else {
        endDatesData.push(null);
      }
    });

    datasets.push({
      label: 'Fin de Gastos Fijos',
      data: endDatesData,
      borderColor: '#f97316', // Orange warning color
      backgroundColor: '#f97316',
      pointRadius: 6,
      pointHoverRadius: 8,
      pointStyle: 'rectRot', // Rotated square / diamond marker
      showLine: false,
      fill: false
    });
  }

  forecastChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            title: function(context) {
              const index = context[0].dataIndex;
              const p = thinnedProjection[index];
              return p ? `${formatDisplayDate(p.date)} (${getDayName(p.date)})` : '';
            },
            label: function(context) {
              const index = context.dataIndex;
              const p = thinnedProjection[index];
              if (!p) return '';
              if (context.datasetIndex === 0) {
                return `Saldo: ${formatCurrency(p.balance)}`;
              } else if (context.datasetIndex === 1) {
                return `Umbral de Seguridad: ${formatCurrency(safetyLimit)}`;
              } else if (context.datasetIndex === 2) {
                const endingRules = recurringRules.filter(r => r.end_date === p.date);
                if (endingRules.length > 0) {
                  return `Fin de: ${endingRules.map(r => r.description).join(', ')}`;
                }
              }
              return '';
            },
            afterBody: function(context) {
              const index = context[0].dataIndex;
              const p = thinnedProjection[index];
              if (p && p.events && p.events.length > 0) {
                const eventStrings = p.events.map(e => {
                  const prefix = e.type === 'income' ? '+' : '-';
                  return `• ${e.description}: ${prefix}${formatCurrency(e.amount)}`;
                });
                return '\nDetalles del día:\n' + eventStrings.join('\n');
              }
              return '';
            }
          }
        }
      },
      scales: {
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: {
            color: '#9ca3af',
            callback: (val) => `${val}€`
          }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#9ca3af', maxTicksLimit: 8 }
        }
      }
    }
  });
}

// Render Categories Doughnut Chart
function renderCategoriesDoughnutChart(currentMonthTxs) {
  const ctx = document.getElementById('chart-categories-doughnut').getContext('2d');
  
  if (categoryChart) {
    categoryChart.destroy();
  }
  
  // Aggregate expenses only
  const expenses = currentMonthTxs.filter(t => t.type === 'expense');
  const catSums = {};
  
  expenses.forEach(e => {
    const catName = e.category_name || 'Otros Gastos';
    catSums[catName] = (catSums[catName] || 0) + e.amount;
  });
  
  const labels = Object.keys(catSums);
  const data = Object.values(catSums);
  
  // Match colors with categories
  const backgroundColors = labels.map(label => {
    const cat = categories.find(c => c.name === label);
    return cat ? cat.color : '#6b7280';
  });

  if (labels.length === 0) {
    // Render placeholder
    categoryChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Sin gastos este mes'],
        datasets: [{ data: [1], backgroundColor: ['#374151'], borderWidth: 0 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: true, position: 'bottom', labels: { color: '#9ca3af' } } }
      }
    });
    return;
  }

  categoryChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: backgroundColors,
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            color: '#9ca3af',
            boxWidth: 12,
            font: { size: 10 }
          }
        }
      }
    }
  });
}

// Render historical Income vs Expenses Chart (Last 6 Months)
async function renderCompareMonthlyBarChart() {
  const ctx = document.getElementById('chart-compare-bar').getContext('2d');
  
  if (historyChart) {
    historyChart.destroy();
  }

  // Calculate past 6 months limits
  const monthData = [];
  const now = new Date();
  
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const start = `${y}-${m}-01`;
    const end = `${y}-${m}-${new Date(y, d.getMonth() + 1, 0).getDate()}`;
    monthData.push({
      label: d.toLocaleString('es-ES', { month: 'short' }).toUpperCase(),
      start,
      end,
      year: y,
      month: d.getMonth() + 1, // 1-indexed
      income: 0,
      expense: 0
    });
  }

  try {
    // Fetch all transactions inside the range (plus one month prior for shifting)
    const firstMonthDate = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const prevFirstMonthDate = new Date(firstMonthDate.getFullYear(), firstMonthDate.getMonth() - 1, 1);
    const startRange = formatDate(prevFirstMonthDate);
    const endRange = monthData[5].end;
    const res = await fetch(`/api/transactions?start_date=${startRange}&end_date=${endRange}`);
    const txs = await res.json();
    
    const shiftCatId = settings.shift_income_category ? parseInt(settings.shift_income_category) : null;
    const shiftDay = settings.shift_income_day ? parseInt(settings.shift_income_day) : 25;

    // Group transactions by month applying shifted income rules
    txs.forEach(t => {
      const tDate = new Date(t.date + 'T00:00:00');
      const tYear = tDate.getFullYear();
      const tMonth = tDate.getMonth() + 1; // 1-indexed
      const tDay = tDate.getDate();

      if (t.type === 'expense') {
        // Expenses are simply grouped by calendar month
        monthData.forEach(m => {
          if (t.date >= m.start && t.date <= m.end) {
            m.expense += t.amount;
          }
        });
      } else { // income
        // Apply shifting logic
        const isShiftedToNext = (shiftCatId && t.category_id === shiftCatId && tDay >= shiftDay);
        
        let targetYear = tYear;
        let targetMonth = tMonth;
        
        if (isShiftedToNext) {
          targetMonth += 1;
          if (targetMonth > 12) {
            targetMonth = 1;
            targetYear += 1;
          }
        }
        
        // Find which month in monthData this belongs to
        monthData.forEach(m => {
          if (m.year === targetYear && m.month === targetMonth) {
            m.income += t.amount;
          }
        });
      }
    });

    const labels = monthData.map(m => m.label);
    const incomes = monthData.map(m => m.income);
    const expenses = monthData.map(m => m.expense);

    historyChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Ingresos',
            data: incomes,
            backgroundColor: '#10b981', // green
            borderRadius: 4
          },
          {
            label: 'Gastos',
            data: expenses,
            backgroundColor: '#f43f5e', // rose
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#9ca3af' }
          },
          x: {
            grid: { display: false },
            ticks: { color: '#9ca3af' }
          }
        }
      }
    });

  } catch (err) {
    console.error('Error fetching data for history chart:', err);
  }
}

// Render Dashboard Alerts
function renderDashboardAlertsList() {
  const container = document.getElementById('dashboard-alerts-list');
  container.innerHTML = '';
  
  // Calculate dynamic period label text
  let periodText = 'los próximos 12 meses';
  const periodValueEl = document.getElementById('forecast-period-value');
  const periodUnitEl = document.getElementById('forecast-period-unit');
  if (periodValueEl && periodUnitEl) {
    const val = parseInt(periodValueEl.value) || 1;
    const unitText = periodUnitEl.value === 'months' ? (val === 1 ? 'mes' : 'meses') : (val === 1 ? 'año' : 'años');
    periodText = `los próximos ${val} ${unitText}`;
  }
  
  if (!forecastData || forecastData.alerts.length === 0) {
    container.innerHTML = `
      <div class="table-empty-state" style="padding: 20px 0;">
        <i data-lucide="check-circle" style="color: var(--income); width: 32px; height: 32px;"></i>
        <p style="font-size: 0.85rem;">¡Todo correcto! No se prevén descubiertos bancarios ni saldo por debajo de tu límite en ${periodText}.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  // Filter and show unique critical alert days (prioritizing 'danger' then 'warning')
  const uniqueAlerts = [];
  const seenDates = new Set();
  
  // Show max 5 warnings on dashboard
  const displayAlerts = forecastData.alerts.slice(0, 15);
  
  displayAlerts.forEach(alert => {
    if (!seenDates.has(alert.date)) {
      seenDates.add(alert.date);
      uniqueAlerts.push(alert);
    }
  });

  // Limit to 5 elements for the dashboard dashboard
  const dashboardAlerts = uniqueAlerts.slice(0, 5);

  dashboardAlerts.forEach(alert => {
    const alertHTML = `
      <div class="forecast-alert-item ${alert.severity}">
        <div class="alert-date-row">
          <span class="alert-date">${formatDisplayDate(alert.date)}</span>
          <span class="alert-bal">${alert.balance.toFixed(2)} €</span>
        </div>
        <div class="alert-msg">${alert.severity === 'danger' ? 'Descubierto previsto' : 'Saldo mínimo de seguridad'}</div>
        <div class="alert-causes">Provocado por: ${alert.causes || 'Gastos Variables'}</div>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', alertHTML);
  });
  
  if (uniqueAlerts.length > 5) {
    container.insertAdjacentHTML('beforeend', `
      <button class="btn btn-link btn-block" onclick="switchTab('forecast')">Ver las ${uniqueAlerts.length} alertas restantes...</button>
    `);
  }
}

// Render Transactions Tab Panel
async function renderTransactionsTab() {
  const tableBody = document.getElementById('transactions-table-body');
  const emptyState = document.getElementById('tx-empty-state');
  const paginationContainer = document.getElementById('tx-pagination');
  tableBody.innerHTML = '';
  
  const search = document.getElementById('tx-search').value;
  const type = document.getElementById('tx-filter-type').value;
  const category_id = document.getElementById('tx-filter-category').value;
  const start_date = document.getElementById('tx-filter-start').value;
  const end_date = document.getElementById('tx-filter-end').value;

  try {
    const offset = (txCurrentPage - 1) * txLimit;
    let query = `?search=${encodeURIComponent(search)}&limit=${txLimit}&offset=${offset}`;
    if (type) query += `&type=${type}`;
    if (category_id) query += `&category_id=${category_id}`;
    if (start_date) query += `&start_date=${start_date}`;
    if (end_date) query += `&end_date=${end_date}`;

    const res = await fetch(`/api/transactions${query}`);
    const resultObj = await res.json();

    const transactionsList = resultObj.transactions || [];
    const totalCount = resultObj.totalCount || 0;

    transactions = transactionsList;

    if (totalCount === 0) {
      emptyState.classList.remove('hidden');
      paginationContainer.classList.add('hidden');
      return;
    }
    emptyState.classList.add('hidden');
    paginationContainer.classList.remove('hidden');

    transactionsList.forEach(t => {
      const row = document.createElement('tr');
      
      const descriptionHTML = `
        <strong>${escapeHtml(t.description)}</strong>
        ${t.recurring_rule_id ? `
          <span class="tag-fijo" style="font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3); margin-left: 6px; font-weight: 500;">
            Fijo
          </span>
        ` : ''}
      `;

      const linkButtonHTML = t.recurring_rule_id ? `
        <button class="btn-table-action unlink-rule" onclick="unlinkTransactionFromRule(${t.id})" style="color: #a855f7;" title="Desvincular de Gasto Fijo">
          <i data-lucide="link-2-off"></i>
        </button>
      ` : `
        <button class="btn-table-action link-rule" onclick="openLinkRecurringModal(${t.id})" title="Vincular a Gasto Fijo">
          <i data-lucide="link-2"></i>
        </button>
      `;

      row.innerHTML = `
        <td>${formatDisplayDate(t.date)}</td>
        <td>${descriptionHTML}</td>
        <td>
          <span class="category-tag">
            <span class="category-dot" style="background-color: ${t.category_color || '#6b7280'}"></span>
            ${escapeHtml(t.category_name || 'Sin Categoría')}
          </span>
        </td>
        <td><span class="text-muted" style="font-size: 0.8rem;">${escapeHtml(t.notes || '')}</span></td>
        <td class="text-right tx-amount ${t.type}">
          ${t.type === 'income' ? '+' : '-'}${formatCurrency(t.amount)}
        </td>
        <td class="text-center">
          <div class="action-buttons">
            ${linkButtonHTML}
            <button class="btn-table-action" onclick="openEditTransaction(${t.id})" title="Editar">
              <i data-lucide="edit-3"></i>
            </button>
            <button class="btn-table-action delete" onclick="deleteTransaction(${t.id})" title="Eliminar">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </td>
      `;
      tableBody.appendChild(row);
    });

    renderPaginationControls(totalCount);
    lucide.createIcons();

  } catch (err) {
    console.error('Error loading transactions:', err);
  }
}

function renderPaginationControls(totalCount) {
  const totalPages = Math.ceil(totalCount / txLimit);
  
  const start = totalCount === 0 ? 0 : (txCurrentPage - 1) * txLimit + 1;
  const end = Math.min(txCurrentPage * txLimit, totalCount);
  
  document.getElementById('pagination-start').textContent = start;
  document.getElementById('pagination-end').textContent = end;
  document.getElementById('pagination-total').textContent = totalCount;
  
  const prevBtn = document.getElementById('btn-prev-page');
  const nextBtn = document.getElementById('btn-next-page');
  
  prevBtn.disabled = txCurrentPage === 1;
  nextBtn.disabled = txCurrentPage === totalPages || totalPages === 0;
  
  const pagesContainer = document.getElementById('pagination-pages');
  pagesContainer.innerHTML = '';
  
  if (totalPages <= 1) {
    return;
  }
  
  const range = [];
  const delta = 1;
  
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= txCurrentPage - delta && i <= txCurrentPage + delta)) {
      range.push(i);
    }
  }
  
  let l;
  range.forEach(i => {
    if (l) {
      if (i - l === 2) {
        pagesContainer.appendChild(createPageButton(l + 1));
      } else if (i - l > 2) {
        const dots = document.createElement('span');
        dots.textContent = '...';
        dots.style.padding = '0 4px';
        dots.style.color = 'var(--text-muted)';
        pagesContainer.appendChild(dots);
      }
    }
    pagesContainer.appendChild(createPageButton(i, i === txCurrentPage));
    l = i;
  });
}

function createPageButton(pageNumber, isActive = false) {
  const btn = document.createElement('button');
  btn.className = `btn ${isActive ? 'btn-primary' : 'btn-secondary'} btn-sm`;
  btn.textContent = pageNumber;
  btn.style.padding = '4px 10px';
  btn.style.fontSize = '0.85rem';
  btn.style.minWidth = '32px';
  btn.disabled = isActive;
  btn.addEventListener('click', () => {
    txCurrentPage = pageNumber;
    renderTransactionsTab();
  });
  return btn;
}

// Helper to normalize a Date object to YYYY-MM-DD local string
function formatDate(date) {
  if (!date) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Calculate recurrence date for a transaction date based on rule parameters
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


// Check if a recurring rule applies on a specific date (local implementation matching backend)
function doesRuleApplyLocally(rule, dateObj) {
  const d = new Date(dateObj);
  d.setHours(0, 0, 0, 0);
  
  const start = new Date(rule.start_date + 'T00:00:00');
  
  if (d < start) return false;
  if (rule.end_date && d > new Date(rule.end_date + 'T00:00:00')) return false;

  const targetDay = d.getDate();
  const targetMonth = d.getMonth() + 1;
  const targetYear = d.getFullYear();

  const startDay = start.getDate();
  const startMonth = start.getMonth() + 1;
  const startYear = start.getFullYear();

  const monthDiff = (targetYear - startYear) * 12 + (targetMonth - startMonth);

  const isLastDayOfMonth = (date) => {
    const nextDay = new Date(date.getTime());
    nextDay.setDate(nextDay.getDate() + 1);
    return nextDay.getMonth() !== date.getMonth();
  };

  const matchesDayOfMonth = (targetDayNum) => {
    if (targetDay === targetDayNum) return true;
    if (targetDayNum > 28 && isLastDayOfMonth(d)) {
      const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
      if (targetDayNum >= daysInMonth) return true;
    }
    return false;
  };

  switch (rule.frequency) {
    case 'weekly':
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

// Calculate the last (before today) and next (>= today) occurrences for a recurring rule
function getRecurringDates(rule) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const start = new Date(rule.start_date + 'T00:00:00');
  
  // If rule has not started yet
  if (start > today) {
    return {
      last: null,
      next: start
    };
  }

  // If rule has an end date and the end date is before today
  if (rule.end_date) {
    const end = new Date(rule.end_date + 'T00:00:00');
    if (end < today) {
      let lastOccur = null;
      let d = new Date(start);
      while (d <= end) {
        if (doesRuleApplyLocally(rule, d)) {
          lastOccur = new Date(d);
        }
        d.setDate(d.getDate() + 1);
      }
      return {
        last: lastOccur,
        next: null
      };
    }
  }

  // Find next occurrence (>= today)
  let nextOccur = null;
  let d = new Date(today);
  const maxFuture = new Date(today);
  maxFuture.setFullYear(maxFuture.getFullYear() + 2); // Check up to 2 years in future
  while (d <= maxFuture) {
    if (doesRuleApplyLocally(rule, d)) {
      if (!rule.end_date || d <= new Date(rule.end_date + 'T00:00:00')) {
        nextOccur = new Date(d);
        break;
      } else {
        break;
      }
    }
    d.setDate(d.getDate() + 1);
  }

  // Find last occurrence (< today)
  let lastOccur = null;
  let d2 = new Date(today);
  d2.setDate(d2.getDate() - 1); // Start yesterday
  while (d2 >= start) {
    if (doesRuleApplyLocally(rule, d2)) {
      lastOccur = new Date(d2);
      break;
    }
    d2.setDate(d2.getDate() - 1);
  }

  return {
    last: lastOccur,
    next: nextOccur
  };
}

// Render Recurring Rules Tab
async function renderRecurringTab() {
  const container = document.getElementById('recurring-rules-container');
  const listContainer = document.getElementById('recurring-list-container');
  const listBody = document.getElementById('recurring-list-body');
  const emptyState = document.getElementById('rec-empty-state');
  
  container.innerHTML = '';
  if (listBody) listBody.innerHTML = '';

  const freqMap = {
    weekly: 'Semanal',
    monthly: 'Mensual',
    bimonthly: 'Bimestral',
    quarterly: 'Trimestral',
    semiannually: 'Semestral',
    annually: 'Anual'
  };

  try {
    const res = await fetch('/api/recurring');
    const rawRules = await res.json();

    // Map rules to include nextChargeDate and lastChargeDate
    recurringRules = rawRules.map(rule => {
      const dates = getRecurringDates(rule);
      return {
        ...rule,
        nextChargeDate: dates.next,
        lastChargeDate: dates.last
      };
    });

    if (recurringRules.length === 0) {
      container.classList.remove('hidden');
      listContainer.classList.add('hidden');
      emptyState.classList.add('hidden');
      container.innerHTML = `
        <div class="grid-item col-3 glass text-center" style="padding: 40px; display: flex; flex-direction: column; align-items: center; gap: 12px; grid-column: 1/-1;">
          <i data-lucide="calendar-range" style="width: 48px; height: 48px; color: var(--text-muted)"></i>
          <h3>No has registrado gastos ni ingresos fijos</h3>
          <p class="text-muted" style="max-width: 400px; margin: 0 auto 12px;">Introduce tus recibos de agua, luz, hipoteca, seguros anuales, préstamos y nóminas periódicas para proyectar tu flujo de caja.</p>
          <button class="btn btn-primary" onclick="openAddRecurringModal()">Añadir Primer Movimiento Fijo</button>
        </div>
      `;
      lucide.createIcons();
      return;
    }

    // Apply filters in memory
    let filteredRules = recurringRules.filter(rule => {
      const matchesSearch = rule.description.toLowerCase().includes(recSearch.toLowerCase()) || 
                            (rule.notes && rule.notes.toLowerCase().includes(recSearch.toLowerCase()));
      const matchesType = recFilterType === '' || rule.type === recFilterType;
      const matchesCategory = recFilterCategory === '' || String(rule.category_id) === recFilterCategory;
      return matchesSearch && matchesType && matchesCategory;
    });

    // Split into active and finished lists
    const activeRules = filteredRules.filter(r => r.nextChargeDate !== null);
    const finishedRules = filteredRules.filter(r => r.nextChargeDate === null);

    const sortFn = (a, b) => {
      if (recSort === 'amount-desc') {
        return b.amount - a.amount;
      } else if (recSort === 'amount-asc') {
        return a.amount - b.amount;
      } else if (recSort === 'name') {
        return a.description.localeCompare(b.description);
      } else {
        // default: 'day' sorting (Ordenar por Próximo cobro)
        if (!a.nextChargeDate) return 1;
        if (!b.nextChargeDate) return -1;
        return a.nextChargeDate - b.nextChargeDate;
      }
    };

    // Apply sorting in memory to both lists
    activeRules.sort(sortFn);
    // For finished rules, if sorting by próximo cobro, sort by end_date descending (latest ended first)
    finishedRules.sort((a, b) => {
      if (recSort === 'day') {
        const dateA = a.end_date ? new Date(a.end_date) : new Date(0);
        const dateB = b.end_date ? new Date(b.end_date) : new Date(0);
        return dateB - dateA;
      }
      return sortFn(a, b);
    });

    if (activeRules.length === 0 && finishedRules.length === 0) {
      container.classList.add('hidden');
      listContainer.classList.add('hidden');
      emptyState.classList.remove('hidden');
      lucide.createIcons();
      return;
    }
    emptyState.classList.add('hidden');

    if (recViewMode === 'grid') {
      container.classList.remove('hidden');
      listContainer.classList.add('hidden');
      
      // Render Active Grid
      if (activeRules.length > 0) {
        activeRules.forEach(rule => {
          renderGridCard(rule, container, false);
        });
      } else {
        const noActivePlaceholder = document.createElement('div');
        noActivePlaceholder.style.cssText = 'grid-column: 1 / -1; padding: 20px; text-align: center; color: var(--text-muted); font-style: italic;';
        noActivePlaceholder.textContent = 'No hay movimientos fijos activos.';
        container.appendChild(noActivePlaceholder);
      }

      // Render Finished Grid
      if (finishedRules.length > 0) {
        const sectionHeader = document.createElement('div');
        sectionHeader.style.cssText = 'grid-column: 1 / -1; margin-top: 30px; margin-bottom: 15px; border-bottom: 1px solid var(--border-color); padding-bottom: 8px;';
        sectionHeader.innerHTML = '<h3 style="color: var(--text-muted); font-size: 1.1rem; display: flex; align-items: center; gap: 8px;"><i data-lucide="archive" style="width: 18px;"></i> Historial de Movimientos Finalizados</h3>';
        container.appendChild(sectionHeader);

        finishedRules.forEach(rule => {
          renderGridCard(rule, container, true);
        });
      }
    } else {
      // List view
      container.classList.add('hidden');
      listContainer.classList.remove('hidden');

      // Render Active List Rows
      if (activeRules.length > 0) {
        activeRules.forEach(rule => {
          renderListRow(rule, listBody, false);
        });
      } else {
        const placeholderRow = document.createElement('tr');
        placeholderRow.innerHTML = `<td colspan="8" class="text-center text-muted" style="padding: 20px; font-style: italic;">No hay movimientos fijos activos.</td>`;
        listBody.appendChild(placeholderRow);
      }

      // Render Finished List Rows
      if (finishedRules.length > 0) {
        const headerRow = document.createElement('tr');
        headerRow.innerHTML = `
          <td colspan="8" style="padding-top: 25px; padding-bottom: 10px; font-weight: 600; font-size: 1rem; color: var(--text-muted); border-bottom: 1px solid var(--border-color); background: transparent;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <i data-lucide="archive" style="width: 16px;"></i> Historial de Movimientos Finalizados
            </div>
          </td>
        `;
        listBody.appendChild(headerRow);

        finishedRules.forEach(rule => {
          renderListRow(rule, listBody, true);
        });
      }
    }

    lucide.createIcons();

  } catch (err) {
    console.error('Error loading recurring rules:', err);
  }

  // Inner helpers to avoid duplicate code
  function renderGridCard(rule, parentEl, isFinished) {
    const dateDetail = rule.frequency === 'annually' && rule.specific_date
      ? `el día ${rule.specific_date.split('-')[1]} de ${new Date(2026, parseInt(rule.specific_date.split('-')[0]) - 1, 1).toLocaleString('es-ES', { month: 'long' })}`
      : `el día ${rule.day_of_month || rule.start_date.split('-')[2]}`;

    const card = document.createElement('div');
    card.className = 'recurring-rule-card glass';
    if (isFinished) {
      card.style.opacity = '0.6';
    }
    card.innerHTML = `
      <div>
        <div class="recurring-card-header">
          <div class="recurring-title-box">
            <h4>${escapeHtml(rule.description)}</h4>
            <span class="recurring-category" style="color: ${rule.category_color || '#9ca3af'}">
              ● ${escapeHtml(rule.category_name || 'Fijo')}
            </span>
          </div>
          <span class="badge ${rule.type === 'income' ? 'badge-income' : 'badge-expense'}">
            ${rule.type === 'income' ? 'Ingreso' : 'Gasto'}
          </span>
        </div>
        <div class="recurring-amount ${rule.type}">
          ${rule.type === 'income' ? '+' : '-'}${formatCurrency(rule.amount)}
        </div>
      </div>

      <div class="recurring-details">
        <span><i data-lucide="refresh-cw"></i> Frecuencia: ${freqMap[rule.frequency] || rule.frequency}</span>
        <span><i data-lucide="calendar"></i> Ajuste Cobro: ${dateDetail}</span>
        <span><i data-lucide="calendar-check"></i> Último cobro: ${rule.lastChargeDate ? formatDisplayDate(formatDate(rule.lastChargeDate)) : 'Ninguno'}</span>
        <span><i data-lucide="calendar-clock"></i> Próximo cobro: ${rule.nextChargeDate ? formatDisplayDate(formatDate(rule.nextChargeDate)) : 'Finalizado'}</span>
        <span><i data-lucide="calendar-days"></i> Inicio: ${formatDisplayDate(rule.start_date)}</span>
        ${rule.end_date ? `<span><i data-lucide="calendar-off"></i> Fin: ${formatDisplayDate(rule.end_date)}</span>` : ''}
        ${rule.notes ? `<span class="notes-txt" style="margin-top: 4px; font-style: italic;"><i data-lucide="file-text"></i> ${escapeHtml(rule.notes)}</span>` : ''}
      </div>

      <div class="recurring-card-actions">
        <button class="btn-table-action" onclick="openEditRecurring(${rule.id})" title="Editar">
          <i data-lucide="edit-3" style="width: 16px;"></i>
        </button>
        <button class="btn-table-action delete" onclick="deleteRecurringRule(${rule.id})" title="Eliminar">
          <i data-lucide="trash-2" style="width: 16px;"></i>
        </button>
      </div>
    `;
    parentEl.appendChild(card);
  }

  function renderListRow(rule, parentEl, isFinished) {
    const dateDetail = rule.frequency === 'annually' && rule.specific_date
      ? `${rule.specific_date.split('-')[1]} de ${new Date(2026, parseInt(rule.specific_date.split('-')[0]) - 1, 1).toLocaleString('es-ES', { month: 'short' })}`
      : `Día ${rule.day_of_month || rule.start_date.split('-')[2]}`;

    const row = document.createElement('tr');
    if (isFinished) {
      row.style.opacity = '0.55';
    }
    row.innerHTML = `
      <td><strong>${escapeHtml(rule.description)}</strong></td>
      <td>
        <span class="badge ${rule.type === 'income' ? 'badge-income' : 'badge-expense'}">
          ${rule.type === 'income' ? 'Ingreso' : 'Gasto'}
        </span>
      </td>
      <td>
        <span class="category-tag">
          <span class="category-dot" style="background-color: ${rule.category_color || '#6b7280'}"></span>
          ${escapeHtml(rule.category_name || 'Sin Categoría')}
        </span>
      </td>
      <td>${freqMap[rule.frequency] || rule.frequency}</td>
      <td>${rule.end_date ? formatDisplayDate(rule.end_date) : 'Indefinido'}</td>
      <td>${rule.nextChargeDate ? formatDisplayDate(formatDate(rule.nextChargeDate)) : 'Finalizado'}</td>
      <td class="text-right tx-amount ${rule.type}">
        ${rule.type === 'income' ? '+' : '-'}${formatCurrency(rule.amount)}
      </td>
      <td class="text-center">
        <div class="action-buttons">
          <button class="btn-table-action" onclick="openEditRecurring(${rule.id})" title="Editar">
            <i data-lucide="edit-3"></i>
          </button>
          <button class="btn-table-action delete" onclick="deleteRecurringRule(${rule.id})" title="Eliminar">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </td>
    `;
    parentEl.appendChild(row);
  }
}

// Render Forecast Tab (Includes Interactive Calendar & What-If panel)
function renderForecastTab() {
  renderCalendar();
  renderForecastAlertsFullList();
  renderWhatIfScenarios();
}

// Render Financial Interactive Calendar
function renderCalendar() {
  const container = document.getElementById('calendar-days-container');
  const monthYearLabel = document.getElementById('calendar-month-year');
  container.innerHTML = '';

  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();
  
  // Set month label
  monthYearLabel.textContent = currentCalendarDate.toLocaleString('es-ES', { month: 'long', year: 'numeric' }).replace(/^\w/, c => c.toUpperCase());

  // First day of month
  const firstDayIndex = (new Date(year, month, 1).getDay() + 6) % 7; // Convert to Monday-first (0=Mon, 6=Sun)
  
  // Days in month
  const totalDays = new Date(year, month + 1, 0).getDate();

  // Add empty squares for padding
  for (let i = 0; i < firstDayIndex; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.className = 'calendar-day empty';
    container.appendChild(emptyCell);
  }

  // Draw day cells
  const settingsSafety = parseFloat(settings.safety_threshold || 100);
  
  // Calculate min and max balances for heatmap of the current month
  let monthBalances = [];
  for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
    const dayDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const forecastDay = forecastData?.projection.find(p => p.date === dayDateStr);
    if (forecastDay) {
      monthBalances.push(forecastDay.balance);
    }
  }
  const minMonthBal = monthBalances.length > 0 ? Math.min(...monthBalances) : 0;
  const maxMonthBal = monthBalances.length > 0 ? Math.max(...monthBalances) : 0;
  const diffMonthBal = maxMonthBal - minMonthBal;
  
  for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
    const dayDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    
    // Find if we have simulated balance for this date
    const forecastDay = forecastData?.projection.find(p => p.date === dayDateStr);
    
    const dayCell = document.createElement('div');
    dayCell.className = 'calendar-day';
    
    // Mark if today
    const localTodayStr = new Date().toISOString().split('T')[0];
    if (dayDateStr === localTodayStr) {
      dayCell.classList.add('today');
    }

    // Mark if selected
    if (selectedCalendarDay === dayDateStr) {
      dayCell.classList.add('selected');
    }

    dayCell.innerHTML = `<span class="cal-day-num">${dayNum}</span>`;

    if (forecastDay) {
      const balance = forecastDay.balance;
      let statusClass = 'green';
      
      if (balance < 0) {
        statusClass = 'red';
      } else if (balance < settingsSafety) {
        statusClass = 'yellow';
      }
      
      // Style heatmap if enabled
      if (useHeatmap) {
        const pct = diffMonthBal > 0 ? (balance - minMonthBal) / diffMonthBal : 0.5;
        // Interpolate hue between 10 (amber/red) and 140 (emerald green)
        const hue = 10 + pct * 130;
        dayCell.classList.add('heatmap-day');
        dayCell.style.setProperty('--heatmap-bg', `hsla(${hue}, 70%, 15%, 0.25)`);
        dayCell.style.setProperty('--heatmap-border', `hsla(${hue}, 70%, 40%, 0.35)`);
        dayCell.style.setProperty('--heatmap-glow', `hsla(${hue}, 70%, 15%, 0.3)`);
      }
      
      // Dim past historical days slightly
      if (forecastDay.isPast && dayDateStr !== localTodayStr) {
        dayCell.style.opacity = '0.7';
      }
      
      // Gather income and expense totals (excluding prorated variable expenses)
      let totalIncome = 0;
      let totalExpense = 0;
      forecastDay.events.forEach(e => {
        if (e.type === 'income') {
          totalIncome += e.amount;
        } else if (e.type === 'expense') {
          totalExpense += e.amount;
        }
      });
      
      let indicatorsHTML = '<div class="cal-day-indicators">';
      if (totalIncome > 0) {
        indicatorsHTML += `<span class="cal-day-indicator income">+${totalIncome.toFixed(0)}</span>`;
      }
      if (totalExpense > 0) {
        indicatorsHTML += `<span class="cal-day-indicator expense">-${totalExpense.toFixed(0)}</span>`;
      }
      if (showEndDates) {
        const endingRules = recurringRules.filter(r => r.end_date === dayDateStr);
        if (endingRules.length > 0) {
          const titleText = endingRules.map(r => `Fin de: ${r.description}`).join('\n');
          indicatorsHTML += `<span class="cal-day-indicator end-rule" title="${titleText}">🛑 Fin</span>`;
        }
      }
      indicatorsHTML += '</div>';
      
      dayCell.innerHTML += indicatorsHTML;
      dayCell.innerHTML += `<span class="cal-day-bal ${statusClass}">${balance.toFixed(0)}€</span>`;
      
      // Set click event to show transactions
      dayCell.addEventListener('click', () => {
        selectCalendarDay(dayDateStr, forecastDay);
        // Remove active class from all other days
        document.querySelectorAll('.calendar-day').forEach(cell => cell.classList.remove('selected'));
        dayCell.classList.add('selected');
      });
    }

    container.appendChild(dayCell);
  }
}

// Select a calendar day and show projected movements in the sidebar panel
function selectCalendarDay(dateStr, forecastDay) {
  selectedCalendarDay = dateStr;
  
  const panel = document.getElementById('selected-day-details-panel');
  panel.classList.remove('hidden');

  document.getElementById('selected-day-title').textContent = `Detalle del ${formatDisplayDate(dateStr)}`;
  
  const balanceEl = document.getElementById('selected-day-balance');
  balanceEl.textContent = formatCurrency(forecastDay.balance);
  
  balanceEl.className = 'day-projected-balance';
  if (forecastDay.balance < 0) {
    balanceEl.classList.add('red');
  } else if (forecastDay.balance < parseFloat(settings.safety_threshold || 100)) {
    balanceEl.classList.add('yellow');
  } else {
    balanceEl.classList.add('green');
  }

  const eventsList = document.getElementById('selected-day-events-list');
  eventsList.innerHTML = '';

  // Pro-rated variable expense row (if any)
  if (forecastDay.variableExpense > 0) {
    eventsList.insertAdjacentHTML('beforeend', `
      <div class="day-event-item expense">
        <div>
          <span class="event-desc">Gasto Variable Prorrateado</span>
          <span class="event-cat">Alimentación, Gasolina, Ocio...</span>
        </div>
        <span class="event-val">-${forecastDay.variableExpense.toFixed(2)} €</span>
      </div>
    `);
  }

  // Transactions falling on this day
  if (forecastDay.events && forecastDay.events.length > 0) {
    forecastDay.events.forEach(e => {
      // Info events like starting balance don't need formatting as expenses/income
      if (e.type === 'info') return;

      const isIncome = e.type === 'income';
      eventsList.insertAdjacentHTML('beforeend', `
        <div class="day-event-item ${e.type}">
          <div>
            <span class="event-desc">${escapeHtml(e.description)}</span>
            <span class="event-cat">${escapeHtml(e.category || '')}</span>
          </div>
          <span class="event-val">${isIncome ? '+' : '-'}${e.amount.toFixed(2)} €</span>
        </div>
      `);
    });
  }

  const realEvents = forecastDay.events ? forecastDay.events.filter(e => e.type !== 'info') : [];
  if (forecastDay.variableExpense === 0 && realEvents.length === 0) {
    eventsList.innerHTML = `<p class="text-muted text-center" style="padding: 20px 0; font-size: 0.85rem;">No hay transacciones ni gastos fijos programados para este día.</p>`;
  }
}

// Render Full Alerts List on Previsión Tab
function renderForecastAlertsFullList() {
  const container = document.getElementById('forecast-alerts-full-list');
  container.innerHTML = '';
  
  // Calculate dynamic period label text
  let periodText = 'los próximos 12 meses';
  const periodValueEl = document.getElementById('forecast-period-value');
  const periodUnitEl = document.getElementById('forecast-period-unit');
  if (periodValueEl && periodUnitEl) {
    const val = parseInt(periodValueEl.value) || 1;
    const unitText = periodUnitEl.value === 'months' ? (val === 1 ? 'mes' : 'meses') : (val === 1 ? 'año' : 'años');
    periodText = `los próximos ${val} ${unitText}`;
  }

  if (!forecastData || forecastData.alerts.length === 0) {
    container.innerHTML = `
      <div class="table-empty-state">
        <i data-lucide="shield-check" style="color: var(--income); width: 40px; height: 40px;"></i>
        <h3>¡Tu caja está sana!</h3>
        <p>No se prevé ningún día de descubierto bancario o por debajo del umbral de seguridad en ${periodText}.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  // Group alerts by streak or show them chronologically
  forecastData.alerts.forEach(alert => {
    const alertHTML = `
      <div class="forecast-alert-item ${alert.severity}" style="padding: 14px 20px;">
        <div class="alert-date-row" style="margin-bottom: 4px;">
          <span class="alert-date">${formatDisplayDate(alert.date)} (${getDayName(alert.date)})</span>
          <span class="alert-bal">${alert.balance.toFixed(2)} €</span>
        </div>
        <div class="alert-msg" style="font-size: 0.9rem; margin-bottom: 2px;">
          ${alert.severity === 'danger' ? '🚨 Descubierto Bancario Previsto' : '⚠️ Saldo por debajo del umbral de seguridad'}
        </div>
        <div class="alert-causes">Eventos en la fecha: ${alert.causes || 'Solo Gasto Variable Prorrateado'}</div>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', alertHTML);
  });
}

// Render active What-If simulation scenarios
function renderWhatIfScenarios() {
  const container = document.getElementById('simulation-scenarios-container');
  const emptyMsg = document.getElementById('empty-sim-msg');
  const btnClearSim = document.getElementById('btn-clear-simulations');
  
  // Clear list preserving emptyMsg
  container.querySelectorAll('.sim-item').forEach(el => el.remove());

  if (simulatedScenarios.length === 0) {
    emptyMsg.classList.remove('hidden');
    btnClearSim.classList.add('hidden');
    return;
  }

  emptyMsg.classList.add('hidden');
  btnClearSim.classList.remove('hidden');

  simulatedScenarios.forEach((sim, idx) => {
    const simHTML = `
      <div class="sim-item ${sim.type}">
        <div class="sim-item-info">
          <span class="sim-item-title">${escapeHtml(sim.description)}</span>
          <span class="sim-item-meta">${formatDisplayDate(sim.date)}</span>
        </div>
        <div class="sim-item-right">
          <span class="sim-item-val">${sim.type === 'income' ? '+' : '-'}${sim.amount.toFixed(2)} €</span>
          <button class="btn-table-action delete" onclick="removeSimulationScenario(${idx})" title="Quitar Simulación" style="width:24px; height:24px;">
            <i data-lucide="x" style="width:14px; height:14px;"></i>
          </button>
        </div>
      </div>
    `;
    container.insertAdjacentHTML('afterbegin', simHTML);
  });
  
  lucide.createIcons();
}

// Add Scenario to What-If list
function addSimulationScenario(description, amount, type, date, skipRecalc = false) {
  simulatedScenarios.push({
    description,
    amount: parseFloat(amount),
    type,
    date,
    isTemp: true // Flag to identify it in calculations
  });
  
  if (!skipRecalc) {
    runForecastCalculation();
    showToast('Escenario simulado con éxito. Gráficos y alertas actualizados.', 'indigo');
  }
}

// Remove simulation scenario
window.removeSimulationScenario = function(index) {
  simulatedScenarios.splice(index, 1);
  runForecastCalculation();
  showToast('Simulación eliminada.', 'neutral');
};

// Clear all simulation scenarios
document.getElementById('btn-clear-simulations').addEventListener('click', () => {
  simulatedScenarios = [];
  runForecastCalculation();
  showToast('Simulaciones limpiadas.', 'neutral');
});

// Setup Event Listeners
function setupEventListeners() {
  // Dynamic forecast period change listeners
  const periodValEl = document.getElementById('forecast-period-value');
  const periodUnitEl = document.getElementById('forecast-period-unit');
  if (periodValEl && periodUnitEl) {
    const triggerRecalc = debounce(async () => {
      await runForecastCalculation();
    }, 450);

    periodValEl.addEventListener('input', triggerRecalc);
    periodUnitEl.addEventListener('change', async () => {
      await runForecastCalculation();
    });
  }

  // Show end dates checkbox listener
  const chkShowEndDates = document.getElementById('chk-show-end-dates');
  if (chkShowEndDates) {
    chkShowEndDates.checked = showEndDates;
    chkShowEndDates.addEventListener('change', (e) => {
      showEndDates = e.target.checked;
      localStorage.setItem('forecast_show_end_dates', showEndDates);
      // Redraw immediately
      renderForecastLineChart();
      renderCalendar();
    });
  }

  // What-If Financing options toggle
  const simPaymentMode = document.getElementById('sim-payment-mode');
  const simFinancingOptions = document.getElementById('sim-financing-options');
  if (simPaymentMode && simFinancingOptions) {
    simPaymentMode.addEventListener('change', () => {
      if (simPaymentMode.value === 'financed') {
        simFinancingOptions.classList.remove('hidden');
      } else {
        simFinancingOptions.classList.add('hidden');
      }
    });
  }

  // Set initial view mode button states from localStorage
  if (recViewMode === 'list') {
    document.getElementById('btn-rec-view-grid').classList.remove('active');
    document.getElementById('btn-rec-view-list').classList.add('active');
  } else {
    document.getElementById('btn-rec-view-grid').classList.add('active');
    document.getElementById('btn-rec-view-list').classList.remove('active');
  }

  // Set initial heatmap button state
  const btnHeatmap = document.getElementById('btn-toggle-heatmap');
  if (useHeatmap) {
    btnHeatmap.classList.add('active');
  } else {
    btnHeatmap.classList.remove('active');
  }

  // Navigation
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });

  // Quick Add Action
  document.getElementById('btn-quick-add-transaction').addEventListener('click', () => {
    openAddTransactionModal();
  });

  // Filter Transactions Event Listeners
  const txFilterInputs = ['tx-search', 'tx-filter-type', 'tx-filter-category', 'tx-filter-start', 'tx-filter-end'];
  txFilterInputs.forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      txCurrentPage = 1;
      renderTransactionsTab();
    });
  });
  document.getElementById('tx-search').addEventListener('keyup', debounce(() => {
    txCurrentPage = 1;
    renderTransactionsTab();
  }, 300));
  
  document.getElementById('btn-clear-filters').addEventListener('click', () => {
    document.getElementById('tx-search').value = '';
    document.getElementById('tx-filter-type').value = '';
    document.getElementById('tx-filter-category').value = '';
    document.getElementById('tx-filter-start').value = '';
    document.getElementById('tx-filter-end').value = '';
    txCurrentPage = 1;
    renderTransactionsTab();
  });

  // Pagination Event Listeners
  document.getElementById('btn-prev-page').addEventListener('click', () => {
    if (txCurrentPage > 1) {
      txCurrentPage--;
      renderTransactionsTab();
    }
  });

  document.getElementById('btn-next-page').addEventListener('click', () => {
    txCurrentPage++;
    renderTransactionsTab();
  });

  document.getElementById('btn-add-transaction').addEventListener('click', () => {
    openAddTransactionModal();
  });

  // Recurring Rules Filter & Sorting & View Toggle Event Listeners
  document.getElementById('rec-search').addEventListener('input', debounce((e) => {
    recSearch = e.target.value;
    renderRecurringTab();
  }, 300));
  
  document.getElementById('rec-filter-type').addEventListener('change', (e) => {
    recFilterType = e.target.value;
    renderRecurringTab();
  });
  
  document.getElementById('rec-filter-category').addEventListener('change', (e) => {
    recFilterCategory = e.target.value;
    renderRecurringTab();
  });
  
  document.getElementById('rec-sort').addEventListener('change', (e) => {
    recSort = e.target.value;
    renderRecurringTab();
  });

  document.getElementById('btn-rec-view-grid').addEventListener('click', () => {
    recViewMode = 'grid';
    localStorage.setItem('recViewMode', 'grid');
    document.getElementById('btn-rec-view-grid').classList.add('active');
    document.getElementById('btn-rec-view-list').classList.remove('active');
    renderRecurringTab();
  });

  document.getElementById('btn-rec-view-list').addEventListener('click', () => {
    recViewMode = 'list';
    localStorage.setItem('recViewMode', 'list');
    document.getElementById('btn-rec-view-grid').classList.remove('active');
    document.getElementById('btn-rec-view-list').classList.add('active');
    renderRecurringTab();
  });

  // Modals close button handlers
  document.getElementById('btn-close-tx-modal').addEventListener('click', closeTxModal);
  document.getElementById('btn-cancel-tx-modal').addEventListener('click', closeTxModal);
  
  document.getElementById('btn-close-rec-modal').addEventListener('click', closeRecModal);
  document.getElementById('btn-cancel-rec-modal').addEventListener('click', closeRecModal);

  // Forms submits
  document.getElementById('tx-form').addEventListener('submit', handleTxSubmit);
  document.getElementById('rec-form').addEventListener('submit', handleRecSubmit);
  document.getElementById('settings-form').addEventListener('submit', handleSettingsSubmit);
  document.getElementById('what-if-add-form').addEventListener('submit', handleWhatIfSubmit);

  // Link Modal Event Listeners
  document.getElementById('btn-close-link-modal').addEventListener('click', closeLinkModal);
  document.getElementById('btn-cancel-link-modal').addEventListener('click', closeLinkModal);
  document.getElementById('form-link-recurring').addEventListener('submit', handleLinkSubmit);

  // Auto-calculate expected recurrence date when selecting a recurring rule in manual link
  document.getElementById('link-rule-select').addEventListener('change', (e) => {
    const ruleId = parseInt(e.target.value);
    const txId = parseInt(document.getElementById('link-tx-id').value);
    const tx = transactions.find(t => t.id === txId);
    const rule = recurringRules.find(r => r.id === ruleId);
    if (rule && tx) {
      document.getElementById('link-date-select').value = calculateRecurrenceDateForTxDate(rule, tx.date);
    } else if (tx) {
      document.getElementById('link-date-select').value = tx.date;
    }
  });


  // Calendar navigation
  document.getElementById('btn-toggle-heatmap').addEventListener('click', () => {
    useHeatmap = !useHeatmap;
    localStorage.setItem('use_heatmap', useHeatmap);
    const btn = document.getElementById('btn-toggle-heatmap');
    if (useHeatmap) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
    renderCalendar();
  });

  document.getElementById('btn-cal-prev').addEventListener('click', () => {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
    renderCalendar();
  });
  document.getElementById('btn-cal-next').addEventListener('click', () => {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
    renderCalendar();
  });
  document.getElementById('btn-close-day-details').addEventListener('click', () => {
    document.getElementById('selected-day-details-panel').classList.add('hidden');
    selectedCalendarDay = null;
    document.querySelectorAll('.calendar-day').forEach(cell => cell.classList.remove('selected'));
  });

  // Manage Frequency display changes in recurring modal
  document.getElementById('rec-frequency').addEventListener('change', (e) => {
    const freq = e.target.value;
    const dayGroup = document.getElementById('group-day-of-month');
    const specificGroup = document.getElementById('group-specific-date');
    const dayInput = document.getElementById('rec-day-of-month');
    const specificInput = document.getElementById('rec-specific-date');

    if (freq === 'annually') {
      dayGroup.classList.add('hidden');
      dayInput.removeAttribute('required');
      specificGroup.classList.remove('hidden');
      specificInput.setAttribute('required', 'true');
    } else if (freq === 'weekly') {
      dayGroup.classList.add('hidden');
      dayInput.removeAttribute('required');
      specificGroup.classList.add('hidden');
      specificInput.removeAttribute('required');
    } else {
      dayGroup.classList.remove('hidden');
      dayInput.setAttribute('required', 'true');
      specificGroup.classList.add('hidden');
      specificInput.removeAttribute('required');
    }
  });

  // Backup file import triggers
  document.getElementById('file-restore-db').addEventListener('change', handleBackupImport);
  document.getElementById('btn-export-backup').addEventListener('click', handleBackupExport);

  // Danger zone reset db trigger
  document.getElementById('btn-reset-db').addEventListener('click', handleDbReset);

  // Direct buttons
  document.getElementById('btn-add-recurring-rule').addEventListener('click', () => {
    openAddRecurringModal();
  });

  // Category management events
  document.getElementById('btn-add-category').addEventListener('click', () => {
    openAddCategoryModal();
  });
  document.getElementById('btn-close-cat-modal').addEventListener('click', closeCatModal);
  document.getElementById('btn-cancel-cat-modal').addEventListener('click', closeCatModal);
  document.getElementById('cat-form-element').addEventListener('submit', handleCatSubmit);

  // Bank Connection events
  const btnSaveBankKeys = document.getElementById('btn-save-bank-keys');
  if (btnSaveBankKeys) {
    btnSaveBankKeys.addEventListener('click', saveBankKeys);
  }
  
  const btnLoadBanks = document.getElementById('btn-load-banks');
  if (btnLoadBanks) {
    btnLoadBanks.addEventListener('click', loadBanks);
  }
  
  const btnLinkBank = document.getElementById('btn-link-bank');
  if (btnLinkBank) {
    btnLinkBank.addEventListener('click', linkBank);
  }
  
  const btnUnlinkBank = document.getElementById('btn-unlink-bank');
  if (btnUnlinkBank) {
    btnUnlinkBank.addEventListener('click', unlinkBank);
  }

  const bankCountry = document.getElementById('bank-country');
  if (bankCountry) {
    bankCountry.addEventListener('change', () => {
      document.getElementById('bank-select-container').style.display = 'none';
      document.getElementById('btn-link-bank').setAttribute('disabled', 'true');
    });
  }

  // Sync actions
  ['btn-sync-bank', 'btn-sync-bank-tx', 'btn-sync-bank-now'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', syncBank);
  });

  // AI & Telegram settings and buttons
  const setTelegramEnabled = document.getElementById('set-telegram-enabled');
  if (setTelegramEnabled) {
    setTelegramEnabled.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      document.getElementById('telegram-config-fields').style.display = enabled ? 'flex' : 'none';
      document.getElementById('telegram-save-only-fields').style.display = enabled ? 'none' : 'block';
    });
  }

  const btnSaveAISettings = document.getElementById('btn-save-ai-settings');
  if (btnSaveAISettings) {
    btnSaveAISettings.addEventListener('click', saveAISettings);
  }

  const btnSaveGeminiOnly = document.getElementById('btn-save-gemini-only');
  if (btnSaveGeminiOnly) {
    btnSaveGeminiOnly.addEventListener('click', saveGeminiKeyOnly);
  }

  const btnTestTelegram = document.getElementById('btn-test-telegram');
  if (btnTestTelegram) {
    btnTestTelegram.addEventListener('click', testTelegramConnection);
  }

  // Chat input buttons and enter key
  const btnSendChat = document.getElementById('btn-send-chat');
  if (btnSendChat) {
    btnSendChat.addEventListener('click', handleSendChatMessage);
  }

  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleSendChatMessage();
      }
    });
  }

  // Suggested prompts
  document.querySelectorAll('.btn-prompt').forEach(btn => {
    btn.addEventListener('click', () => {
      const promptText = btn.dataset.prompt;
      if (promptText) {
        document.getElementById('chat-input').value = promptText;
        handleSendChatMessage();
      }
    });
  });
}

// Switch navigation Tabs
window.switchTab = function(tabName) {
  currentTab = tabName;
  
  // Set tab button active
  document.querySelectorAll('.nav-menu button').forEach(btn => {
    btn.classList.remove('active');
  });
  const activeBtn = document.querySelector(`.nav-menu button[data-tab="${tabName}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  // Set subtitle and title
  const titleMap = {
    dashboard: { t: 'Tablero Principal', s: 'Resumen financiero e informe de previsión de caja.' },
    transactions: { t: 'Historial de Movimientos', s: 'Listado completo, filtros y gestión de tus gastos e ingresos.' },
    recurring: { t: 'Gastos e Ingresos Fijos', s: 'Gestiona tus hipotecas, préstamos, nóminas y recibos recurrentes.' },
    forecast: { t: 'Previsión de Flujo de Caja', s: 'Calendario predictivo diario y alertas de números rojos para el año.' },
    'ai-assistant': { t: 'Asistente IA Financiero', s: 'Consulta a tu asesor personal sobre tus finanzas y proyecciones.' },
    settings: { t: 'Configuración del Sistema', s: 'Modifica saldos iniciales, umbral de alertas y gestiona copias de seguridad.' }
  };

  document.getElementById('current-tab-title').textContent = titleMap[tabName].t;
  document.getElementById('current-tab-subtitle').textContent = titleMap[tabName].s;

  // Show panel
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.remove('active');
  });
  document.getElementById(`panel-${tabName}`).classList.add('active');

  // Trigger loads for specific tabs
  if (tabName === 'dashboard') {
    renderDashboard();
  } else if (tabName === 'transactions') {
    renderTransactionsTab();
  } else if (tabName === 'recurring') {
    renderRecurringTab();
  } else if (tabName === 'forecast') {
    renderForecastTab();
  } else if (tabName === 'ai-assistant') {
    renderAIAssistantTab();
  }
};

// --- TRANSACTION MODAL & ACTIONS ---

function openAddTransactionModal() {
  document.getElementById('modal-tx-title').textContent = 'Nuevo Movimiento';
  document.getElementById('tx-id').value = '';
  document.getElementById('tx-type').value = 'expense';
  document.getElementById('tx-amount').value = '';
  document.getElementById('tx-description').value = '';
  document.getElementById('tx-category').value = '';
  document.getElementById('tx-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('tx-notes').value = '';
  
  document.getElementById('modal-transaction').classList.remove('hidden');
}

window.openEditTransaction = function(id) {
  const tx = transactions.find(t => t.id === id);
  if (!tx) return;

  document.getElementById('modal-tx-title').textContent = 'Editar Movimiento';
  document.getElementById('tx-id').value = tx.id;
  document.getElementById('tx-type').value = tx.type;
  document.getElementById('tx-amount').value = tx.amount;
  document.getElementById('tx-description').value = tx.description;
  document.getElementById('tx-category').value = tx.category_id || '';
  document.getElementById('tx-date').value = tx.date;
  document.getElementById('tx-notes').value = tx.notes || '';

  document.getElementById('modal-transaction').classList.remove('hidden');
};

function closeTxModal() {
  document.getElementById('modal-transaction').classList.add('hidden');
}

async function handleTxSubmit(e) {
  e.preventDefault();
  
  const id = document.getElementById('tx-id').value;
  const description = document.getElementById('tx-description').value;
  const amount = parseFloat(document.getElementById('tx-amount').value);
  const type = document.getElementById('tx-type').value;
  const category_id = document.getElementById('tx-category').value;
  const date = document.getElementById('tx-date').value;
  const notes = document.getElementById('tx-notes').value;

  const data = { description, amount, type, category_id, date, notes };
  const method = id ? 'PUT' : 'POST';
  const url = id ? `/api/transactions/${id}` : '/api/transactions';

  try {
    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    if (res.ok) {
      closeTxModal();
      showToast(id ? 'Movimiento actualizado correctamente.' : 'Nuevo movimiento añadido.', 'success');
      await runForecastCalculation();
      if (currentTab === 'transactions') renderTransactionsTab();
    } else {
      const err = await res.json();
      showToast(`Error: ${err.error}`, 'danger');
    }
  } catch (err) {
    console.error('Error saving transaction:', err);
    showToast('Error de red al guardar la transacción.', 'danger');
  }
}

window.deleteTransaction = async function(id) {
  if (!confirm('¿Seguro que deseas eliminar este movimiento?')) return;

  try {
    const res = await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Movimiento eliminado.', 'success');
      await runForecastCalculation();
      if (currentTab === 'transactions') renderTransactionsTab();
    } else {
      showToast('Error al eliminar.', 'danger');
    }
  } catch (err) {
    console.error('Error deleting transaction:', err);
  }
};

// --- RECURRING MODAL & ACTIONS ---

window.openAddRecurringModal = function() {
  document.getElementById('modal-rec-title').textContent = 'Nuevo Movimiento Fijo Recurrente';
  document.getElementById('rec-id').value = '';
  document.getElementById('rec-type').value = 'expense';
  document.getElementById('rec-amount').value = '';
  document.getElementById('rec-description').value = '';
  document.getElementById('rec-category').value = '';
  document.getElementById('rec-frequency').value = 'monthly';
  document.getElementById('rec-day-of-month').value = '1';
  document.getElementById('rec-specific-date').value = '';
  document.getElementById('rec-start-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('rec-end-date').value = '';
  document.getElementById('rec-notes').value = '';

  // Trigger frequency select change manually to reset inputs
  document.getElementById('rec-frequency').dispatchEvent(new Event('change'));

  document.getElementById('modal-recurring').classList.remove('hidden');
};

window.openEditRecurring = function(id) {
  const rule = recurringRules.find(r => r.id === id);
  if (!rule) return;

  document.getElementById('modal-rec-title').textContent = 'Editar Movimiento Fijo Recurrente';
  document.getElementById('rec-id').value = rule.id;
  document.getElementById('rec-type').value = rule.type;
  document.getElementById('rec-amount').value = rule.amount;
  document.getElementById('rec-description').value = rule.description;
  document.getElementById('rec-category').value = rule.category_id || '';
  document.getElementById('rec-frequency').value = rule.frequency;
  document.getElementById('rec-day-of-month').value = rule.day_of_month || '';
  document.getElementById('rec-specific-date').value = rule.specific_date || '';
  document.getElementById('rec-start-date').value = rule.start_date;
  document.getElementById('rec-end-date').value = rule.end_date || '';
  document.getElementById('rec-notes').value = rule.notes || '';

  // Trigger frequency select change manually to update input groups
  document.getElementById('rec-frequency').dispatchEvent(new Event('change'));

  document.getElementById('modal-recurring').classList.remove('hidden');
};

function closeRecModal() {
  document.getElementById('modal-recurring').classList.add('hidden');
}

async function handleRecSubmit(e) {
  e.preventDefault();

  const id = document.getElementById('rec-id').value;
  const description = document.getElementById('rec-description').value;
  const amount = parseFloat(document.getElementById('rec-amount').value);
  const type = document.getElementById('rec-type').value;
  const category_id = document.getElementById('rec-category').value;
  const frequency = document.getElementById('rec-frequency').value;
  const day_of_month = document.getElementById('rec-day-of-month').value;
  const specific_date = document.getElementById('rec-specific-date').value;
  const start_date = document.getElementById('rec-start-date').value;
  const end_date = document.getElementById('rec-end-date').value;
  const notes = document.getElementById('rec-notes').value;

  const data = {
    description, amount, type, category_id, frequency,
    day_of_month: day_of_month ? parseInt(day_of_month) : null,
    specific_date, start_date, end_date, notes
  };

  const method = id ? 'PUT' : 'POST';
  const url = id ? `/api/recurring/${id}` : '/api/recurring';

  try {
    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (res.ok) {
      closeRecModal();
      showToast(id ? 'Regla recurrente actualizada.' : 'Nueva regla recurrente añadida.', 'success');
      await runForecastCalculation();
      if (currentTab === 'recurring') renderRecurringTab();
    } else {
      const err = await res.json();
      showToast(`Error: ${err.error}`, 'danger');
    }
  } catch (err) {
    console.error('Error saving recurring rule:', err);
    showToast('Error de red al guardar la regla recurrente.', 'danger');
  }
}

window.deleteRecurringRule = async function(id) {
  if (!confirm('¿Seguro que deseas eliminar esta regla recurrente? Dejará de proyectarse en el flujo de caja del año.')) return;

  try {
    const res = await fetch(`/api/recurring/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Regla recurrente eliminada.', 'success');
      await runForecastCalculation();
      if (currentTab === 'recurring') renderRecurringTab();
    } else {
      showToast('Error al eliminar.', 'danger');
    }
  } catch (err) {
    console.error('Error deleting recurring rule:', err);
  }
};

// --- SETTINGS ACTIONS ---

async function handleSettingsSubmit(e) {
  e.preventDefault();

  const initial_balance = parseFloat(document.getElementById('set-initial-balance').value);
  const safety_threshold = parseFloat(document.getElementById('set-safety-threshold').value);
  const variable_monthly_budget = parseFloat(document.getElementById('set-variable-budget').value);
  const currency = document.getElementById('set-currency').value;

  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'initial_balance', value: initial_balance })
    });
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'safety_threshold', value: safety_threshold })
    });
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'variable_monthly_budget', value: variable_monthly_budget })
    });
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'currency', value: currency })
    });
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'shift_income_category', value: document.getElementById('set-shift-income-category').value })
    });
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'shift_income_day', value: parseInt(document.getElementById('set-shift-income-day').value) || 25 })
    });

    showToast('Configuración guardada correctamente.', 'success');
    await loadBaseData(); // reload setting variables in memory
  } catch (err) {
    console.error('Error saving settings:', err);
    showToast('Error al guardar la configuración.', 'danger');
  }
}

// --- CATEGORY ACTIONS ---

function renderCategoryManager() {
  const container = document.getElementById('category-manager-list');
  if (!container) return;
  container.innerHTML = '';

  if (categories.length === 0) {
    container.innerHTML = `<p class="text-muted text-center" style="padding: 20px 0;">No hay categorías registradas.</p>`;
    return;
  }

  categories.forEach(cat => {
    const typeLabel = cat.type === 'income' ? 'Ingreso' : 'Gasto';
    const item = document.createElement('div');
    item.className = 'category-manager-item';
    item.innerHTML = `
      <div class="category-manager-info">
        <div class="category-manager-icon-box" style="background-color: ${cat.color || '#6b7280'};">
          <i data-lucide="${cat.icon || 'help-circle'}"></i>
        </div>
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <span class="category-manager-name">${escapeHtml(cat.name)}</span>
          <span class="category-manager-type-badge ${cat.type}">${typeLabel}</span>
        </div>
      </div>
      <div class="category-manager-actions">
        <button class="btn-table-action" onclick="openEditCategory(${cat.id})" title="Editar">
          <i data-lucide="edit-3" style="width: 16px; height: 16px;"></i>
        </button>
        <button class="btn-table-action delete" onclick="deleteCategory(${cat.id})" title="Eliminar">
          <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
        </button>
      </div>
    `;
    container.appendChild(item);
  });

  lucide.createIcons();
}

window.openAddCategoryModal = function() {
  document.getElementById('modal-cat-title').textContent = 'Nueva Categoría';
  document.getElementById('cat-id').value = '';
  document.getElementById('cat-name').value = '';
  document.getElementById('cat-type').value = 'expense';
  document.getElementById('cat-color').value = '#6b7280';
  document.getElementById('cat-icon').value = 'help-circle';
  
  document.getElementById('modal-category').classList.remove('hidden');
};

window.openEditCategory = function(id) {
  const cat = categories.find(c => c.id === id);
  if (!cat) return;

  document.getElementById('modal-cat-title').textContent = 'Editar Categoría';
  document.getElementById('cat-id').value = cat.id;
  document.getElementById('cat-name').value = cat.name;
  document.getElementById('cat-type').value = cat.type;
  document.getElementById('cat-color').value = cat.color || '#6b7280';
  document.getElementById('cat-icon').value = cat.icon || 'help-circle';

  document.getElementById('modal-category').classList.remove('hidden');
};

function closeCatModal() {
  document.getElementById('modal-category').classList.add('hidden');
}

async function handleCatSubmit(e) {
  e.preventDefault();

  const id = document.getElementById('cat-id').value;
  const name = document.getElementById('cat-name').value.trim();
  const type = document.getElementById('cat-type').value;
  const color = document.getElementById('cat-color').value;
  const icon = document.getElementById('cat-icon').value;

  if (!name) {
    showToast('El nombre de la categoría es obligatorio.', 'danger');
    return;
  }

  const data = { name, type, color, icon };
  const method = id ? 'PUT' : 'POST';
  const url = id ? `/api/categories/${id}` : '/api/categories';

  try {
    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (res.ok) {
      closeCatModal();
      showToast(id ? 'Categoría actualizada correctamente.' : 'Nueva categoría añadida.', 'success');
      
      const categoriesRes = await fetch('/api/categories');
      categories = await categoriesRes.json();
      populateCategorySelects();
      renderCategoryManager();
      
      await runForecastCalculation();
      if (currentTab === 'transactions') renderTransactionsTab();
      if (currentTab === 'recurring') renderRecurringTab();
    } else {
      const err = await res.json();
      showToast(`Error: ${err.error}`, 'danger');
    }
  } catch (err) {
    console.error('Error saving category:', err);
    showToast('Error de red al guardar la categoría.', 'danger');
  }
}

window.deleteCategory = async function(id) {
  if (!confirm('¿Seguro que deseas eliminar esta categoría? Las transacciones e ingresos/gastos fijos asociados no se borrarán, pero se quedarán "Sin Categoría".')) return;

  try {
    const res = await fetch(`/api/categories/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Categoría eliminada.', 'success');
      
      const categoriesRes = await fetch('/api/categories');
      categories = await categoriesRes.json();
      populateCategorySelects();
      renderCategoryManager();
      
      await runForecastCalculation();
      if (currentTab === 'transactions') renderTransactionsTab();
      if (currentTab === 'recurring') renderRecurringTab();
    } else {
      showToast('Error al eliminar la categoría.', 'danger');
    }
  } catch (err) {
    console.error('Error deleting category:', err);
  }
};

// --- WHAT-IF SIMULATION SUBMITS ---

function handleWhatIfSubmit(e) {
  e.preventDefault();
  
  const desc = document.getElementById('sim-desc').value;
  const amount = parseFloat(document.getElementById('sim-amount').value);
  const type = document.getElementById('sim-type').value;
  const startDateStr = document.getElementById('sim-date').value;
  const paymentMode = document.getElementById('sim-payment-mode').value;

  if (paymentMode === 'single') {
    addSimulationScenario(desc, amount, type, startDateStr);
  } else {
    // Financed
    const installments = parseInt(document.getElementById('sim-installments').value) || 12;
    const amountType = document.getElementById('sim-amount-type').value;
    
    // Calculate monthly installment amount
    const monthlyAmount = amountType === 'total' ? (amount / installments) : amount;
    
    // Create multiple monthly simulated transactions
    const startYear = parseInt(startDateStr.substring(0, 4));
    const startMonth = parseInt(startDateStr.substring(5, 7)) - 1; // 0-indexed
    const startDay = parseInt(startDateStr.substring(8, 10));
    
    for (let i = 0; i < installments; i++) {
      // Calculate date for installment i (adding i months)
      const tempDate = new Date(startYear, startMonth + i, 1);
      const daysInMonth = new Date(startYear, startMonth + i + 1, 0).getDate();
      const targetDay = Math.min(startDay, daysInMonth);
      const dateStr = `${tempDate.getFullYear()}-${String(tempDate.getMonth() + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
      
      const installmentDesc = `${desc} (Cuota ${i + 1}/${installments})`;
      addSimulationScenario(installmentDesc, monthlyAmount, type, dateStr, true); // true to skip recalc inside loop
    }
    
    runForecastCalculation();
    showToast(`Simuladas ${installments} cuotas mensuales de ${formatCurrency(monthlyAmount)} con éxito.`, 'indigo');
  }

  // Clear inputs
  document.getElementById('sim-desc').value = '';
  document.getElementById('sim-amount').value = '';
  document.getElementById('sim-date').value = '';
  document.getElementById('sim-payment-mode').value = 'single';
  const simFinancingOptions = document.getElementById('sim-financing-options');
  if (simFinancingOptions) {
    simFinancingOptions.classList.add('hidden');
  }
}

// --- BACKUP & RESTORE ACTIONS ---

async function handleBackupExport() {
  try {
    const res = await fetch('/api/backup');
    const data = await res.json();

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href",     dataStr     );
    dlAnchorElem.setAttribute("download", `moneycontroller_backup_${new Date().toISOString().split('T')[0]}.json`);
    dlAnchorElem.click();
    showToast('Copia de seguridad exportada con éxito.', 'success');
  } catch (err) {
    console.error('Error exporting backup:', err);
    showToast('Error al exportar copia de seguridad.', 'danger');
  }
}

async function handleBackupImport(e) {
  const fileReader = new FileReader();
  fileReader.onload = async function (event) {
    try {
      const parsedData = JSON.parse(event.target.result);
      
      const res = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsedData)
      });

      if (res.ok) {
        showToast('Base de datos restaurada correctamente.', 'success');
        await loadBaseData();
        if (currentTab === 'dashboard') renderDashboard();
      } else {
        showToast('Error al importar la copia. Formato incorrecto.', 'danger');
      }
    } catch (err) {
      showToast('Error al procesar el archivo JSON.', 'danger');
    }
  };
  fileReader.readAsText(e.target.files[0]);
}

async function handleDbReset() {
  if (!confirm('🚨 ATENCIÓN: Esta opción borrará TODAS tus transacciones y reglas recurrentes registradas. Las configuraciones de categorías y ajustes permanecerán. ¿Deseas proceder?')) return;

  try {
    const res = await fetch('/api/reset', { method: 'POST' });
    if (res.ok) {
      showToast('Base de datos reiniciada.', 'success');
      simulatedScenarios = [];
      await loadBaseData();
    } else {
      showToast('Error al reiniciar.', 'danger');
    }
  } catch (err) {
    console.error('Error resetting database:', err);
  }
}

// --- GENERAL HELPERS ---

// Debounce helper for searching
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Format date for displays (YYYY-MM-DD -> DD/MM/YYYY)
function formatDisplayDate(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

// Get Spanish Name of Week Day
function getDayName(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleString('es-ES', { weekday: 'long' });
}

// Simple HTML escaping helper
function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, function(m) { return map[m]; });
}

// Show Toast messages
function showToast(message, type = 'success') {
  const existingToast = document.querySelector('.toast-container');
  if (existingToast) existingToast.remove();

  const container = document.createElement('div');
  container.className = `toast-container ${type}`;
  
  const iconMap = {
    success: 'check-circle',
    danger: 'alert-triangle',
    warning: 'alert-circle',
    indigo: 'sparkles',
    neutral: 'info'
  };
  const iconName = iconMap[type] || 'info';

  container.innerHTML = `
    <i data-lucide="${iconName}"></i>
    <span>${message}</span>
  `;

  document.body.appendChild(container);
  lucide.createIcons();

  setTimeout(() => {
    container.classList.add('show');
  }, 10);

  setTimeout(() => {
    container.classList.remove('show');
    setTimeout(() => container.remove(), 300);
  }, 4000);
}

// --- ENABLE BANKING SYNC OPERATIONS ---

// Update Bank UI display based on settings
function updateBankUI() {
  const isLinked = settings.enablebanking_linked === 'true';
  const appId = settings.enablebanking_app_id || '';
  const privateKey = settings.enablebanking_private_key || '';
  
  // Update inputs
  document.getElementById('bank-app-id').value = appId;
  document.getElementById('bank-private-key').value = privateKey;
  
  // Enable/disable Load Banks button if we have keys saved
  const btnLoadBanks = document.getElementById('btn-load-banks');
  if (appId && privateKey) {
    btnLoadBanks.removeAttribute('disabled');
  } else {
    btnLoadBanks.setAttribute('disabled', 'true');
  }

  // Update panels display
  const unlinkedSec = document.getElementById('bank-unlinked-section');
  const linkedSec = document.getElementById('bank-linked-section');
  const btnSyncBank = document.getElementById('btn-sync-bank');
  const btnSyncBankTx = document.getElementById('btn-sync-bank-tx');

  if (isLinked) {
    unlinkedSec.style.display = 'none';
    linkedSec.style.display = 'block';
    
    document.getElementById('lbl-linked-bank-name').textContent = settings.enablebanking_bank_name || 'Desconocido';
    
    let linkDate = 'N/D';
    if (settings.enablebanking_linked_date) {
      try {
        linkDate = new Date(settings.enablebanking_linked_date).toLocaleDateString('es-ES', {
          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });
      } catch (e) {
        linkDate = settings.enablebanking_linked_date;
      }
    }
    document.getElementById('lbl-linked-bank-date').textContent = linkDate;

    // Show sync buttons
    if (btnSyncBank) btnSyncBank.style.display = 'inline-flex';
    if (btnSyncBankTx) btnSyncBankTx.style.display = 'inline-flex';
  } else {
    unlinkedSec.style.display = 'block';
    linkedSec.style.display = 'none';
    
    // Hide sync buttons
    if (btnSyncBank) btnSyncBank.style.display = 'none';
    if (btnSyncBankTx) btnSyncBankTx.style.display = 'none';
  }
}

// Save Enable Banking API keys
async function saveBankKeys() {
  const appId = document.getElementById('bank-app-id').value.trim();
  const privateKey = document.getElementById('bank-private-key').value.trim();

  if (!appId || !privateKey) {
    showToast('El Application ID y la Clave Privada (PEM) son obligatorios.', 'warning');
    return;
  }

  try {
    if (appId !== (settings.enablebanking_app_id || '')) {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'enablebanking_app_id', value: appId })
      });
      settings.enablebanking_app_id = appId;
    }

    if (privateKey !== (settings.enablebanking_private_key || '')) {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'enablebanking_private_key', value: privateKey })
      });
      settings.enablebanking_private_key = privateKey;
    }

    showToast('Claves de Enable Banking guardadas correctamente.', 'success');
    updateBankUI();
  } catch (err) {
    console.error('Error saving bank keys:', err);
    showToast('Error al guardar las claves.', 'danger');
  }
}

// Load banks list for selected country
async function loadBanks() {
  const country = document.getElementById('bank-country').value;
  const btnLoad = document.getElementById('btn-load-banks');
  const originalText = btnLoad.innerHTML;
  
  btnLoad.innerHTML = '<span class="spinner-small"></span> Cargando...';
  btnLoad.setAttribute('disabled', 'true');

  try {
    const res = await fetch(`/api/bank/institutions?country=${country}`);
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Error al descargar la lista de bancos.');
    }

    const institutions = await res.json();
    const select = document.getElementById('bank-institution');
    select.innerHTML = '<option value="" disabled selected>Selecciona tu banco...</option>';
    
    institutions.sort((a, b) => a.name.localeCompare(b.name));

    institutions.forEach(inst => {
      select.insertAdjacentHTML('beforeend', `<option value="${inst.id}">${inst.name}</option>`);
    });

    document.getElementById('bank-select-container').style.display = 'block';
    
    select.onchange = () => {
      document.getElementById('btn-link-bank').removeAttribute('disabled');
    };
    
    showToast(`Se han cargado ${institutions.length} conectores de ${country}.`, 'success');
  } catch (err) {
    console.error('Error loading banks:', err);
    showToast(err.message || 'Error al obtener la lista de bancos.', 'danger');
  } finally {
    btnLoad.innerHTML = originalText;
    btnLoad.removeAttribute('disabled');
  }
}

// Initiate bank linking redirect
async function linkBank() {
  const institutionId = document.getElementById('bank-institution').value; // connector name
  const country = document.getElementById('bank-country').value;
  const btnLink = document.getElementById('btn-link-bank');
  
  if (!institutionId) {
    showToast('Por favor, selecciona un banco.', 'warning');
    return;
  }

  const originalText = btnLink.innerHTML;
  btnLink.innerHTML = '<span class="spinner-small"></span> Conectando...';
  btnLink.setAttribute('disabled', 'true');

  try {
    const res = await fetch('/api/bank/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ institutionId, country })
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Error al iniciar la vinculación.');
    }

    const data = await res.json();
    if (data.link) {
      showToast('Redirigiendo a la pasarela de autenticación de tu banco...', 'indigo');
      setTimeout(() => {
        window.location.href = data.link;
      }, 1200);
    } else {
      throw new Error('No se recibió el enlace de redirección.');
    }
  } catch (err) {
    console.error('Error linking bank:', err);
    showToast(err.message || 'Error al conectar con el banco.', 'danger');
    btnLink.innerHTML = originalText;
    btnLink.removeAttribute('disabled');
  }
}

// Disconnect/unlink bank
async function unlinkBank() {
  if (!confirm('¿Estás seguro de que deseas desvincular tu banco? Se borrarán las credenciales de sincronización y los IDs de cuenta locales. Las transacciones importadas hasta ahora se mantendrán.')) {
    return;
  }

  try {
    const res = await fetch('/api/bank/unlink', { method: 'POST' });
    if (!res.ok) throw new Error('Error al desvincular.');
    
    settings.enablebanking_linked = 'false';
    settings.enablebanking_accounts = '';
    settings.enablebanking_bank_name = '';
    settings.enablebanking_linked_date = '';
    
    showToast('Banco desvinculado correctamente.', 'success');
    updateBankUI();
    
    await runForecastCalculation();
  } catch (err) {
    console.error('Error unlinking bank:', err);
    showToast('Error al desvincular el banco.', 'danger');
  }
}

// Sync bank transactions now
async function syncBank() {
  const syncButtons = [
    document.getElementById('btn-sync-bank'),
    document.getElementById('btn-sync-bank-tx'),
    document.getElementById('btn-sync-bank-now')
  ];

  syncButtons.forEach(btn => {
    if (btn) {
      btn.setAttribute('disabled', 'true');
      const icon = btn.querySelector('i');
      if (icon) icon.classList.add('spin-animation');
    }
  });

  showToast('Conectando con tu banco y descargando movimientos...', 'indigo');

  try {
    const res = await fetch('/api/bank/sync', { method: 'POST' });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Error durante la sincronización bancaria.');
    }

    const data = await res.json();
    
    if (data.imported > 0) {
      showToast(`¡Sincronización exitosa! Se han importado ${data.imported} transacciones nuevas.`, 'success');
    } else {
      showToast('Sincronización completada. No hay transacciones nuevas para importar.', 'success');
    }

    await loadBaseData();
    if (currentTab === 'transactions') {
      await renderTransactionsTab();
    }
  } catch (err) {
    console.error('Sync error:', err);
    showToast(err.message || 'Error de sincronización con el banco.', 'danger');
  } finally {
    syncButtons.forEach(btn => {
      if (btn) {
        btn.removeAttribute('disabled');
        const icon = btn.querySelector('i');
        if (icon) icon.classList.remove('spin-animation');
      }
    });
  }
}

// Modal and Link controls
async function openLinkRecurringModal(id) {
  const tx = transactions.find(t => t.id === id);
  if (!tx) return;

  document.getElementById('link-tx-id').value = tx.id;
  document.getElementById('link-tx-desc').textContent = tx.description;
  document.getElementById('link-tx-date').textContent = formatDisplayDate(tx.date);
  document.getElementById('link-tx-amount').textContent = `${tx.type === 'income' ? '+' : '-'}${formatCurrency(tx.amount)}`;
  document.getElementById('link-tx-amount').style.color = tx.type === 'income' ? 'var(--income)' : 'var(--expense)';
  document.getElementById('link-date-select').value = tx.date;

  const ruleSelect = document.getElementById('link-rule-select');
  ruleSelect.innerHTML = '<option value="">Selecciona un gasto fijo...</option>';

  try {
    const res = await fetch('/api/recurring');
    const rules = await res.json();
    
    const matchingRules = rules.filter(r => r.type === tx.type);
    
    if (matchingRules.length === 0) {
      ruleSelect.innerHTML = `<option value="">No hay ${tx.type === 'income' ? 'ingresos fijos' : 'gastos fijos'} creados.</option>`;
    } else {
      matchingRules.forEach(rule => {
        const option = document.createElement('option');
        option.value = rule.id;
        option.textContent = `${rule.description} (${formatCurrency(rule.amount)})`;
        ruleSelect.appendChild(option);
      });
    }
  } catch (err) {
    console.error('Error fetching recurring rules for modal:', err);
    ruleSelect.innerHTML = '<option value="">Error al cargar los gastos fijos.</option>';
  }

  document.getElementById('modal-link-recurring').classList.remove('hidden');
  lucide.createIcons();
}

function closeLinkModal() {
  document.getElementById('modal-link-recurring').classList.add('hidden');
}

async function handleLinkSubmit(e) {
  e.preventDefault();
  const txId = document.getElementById('link-tx-id').value;
  const ruleId = document.getElementById('link-rule-select').value;
  const recurrenceDate = document.getElementById('link-date-select').value;
  const learnPattern = document.getElementById('link-learn-pattern').checked;

  const tx = transactions.find(t => t.id === parseInt(txId));
  const pattern = tx ? tx.description : '';

  try {
    const res = await fetch(`/api/transactions/${txId}/link-recurring`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        recurringRuleId: parseInt(ruleId),
        recurrenceDate,
        learnPattern,
        pattern
      })
    });

    if (!res.ok) throw new Error('Error al vincular el movimiento.');

    showToast('Movimiento vinculado correctamente.', 'success');
    closeLinkModal();
    
    await loadBaseData();
    if (currentTab === 'transactions') {
      renderTransactionsTab();
    }
  } catch (err) {
    console.error('Error linking transaction:', err);
    showToast('Error al vincular el movimiento.', 'danger');
  }
}

async function unlinkTransactionFromRule(txId) {
  if (!confirm('¿Estás seguro de que deseas desvincular este movimiento de su gasto fijo?')) {
    return;
  }

  try {
    const res = await fetch(`/api/transactions/${txId}/unlink-recurring`, {
      method: 'POST'
    });

    if (!res.ok) throw new Error('Error al desvincular el movimiento.');

    showToast('Movimiento desvinculado correctamente.', 'success');
    
    await loadBaseData();
    if (currentTab === 'transactions') {
      renderTransactionsTab();
    }
  } catch (err) {
    console.error('Error unlinking transaction:', err);
    showToast('Error al desvincular el movimiento.', 'danger');
  }
}

// --- AI ASSISTANT FUNCTIONS ---

function renderAIAssistantTab() {
  const hasApiKey = settings.gemini_api_key && settings.gemini_api_key.trim() !== '';
  const warningEl = document.getElementById('ai-key-warning');
  if (warningEl) {
    warningEl.style.display = hasApiKey ? 'none' : 'flex';
  }
}

async function saveAISettings() {
  const gemini_api_key = document.getElementById('set-gemini-api-key').value.trim();
  const gemini_model = document.getElementById('set-gemini-model').value;
  const telegram_notifications_enabled = document.getElementById('set-telegram-enabled').checked ? 'true' : 'false';
  const telegram_bot_token = document.getElementById('set-telegram-bot-token').value.trim();
  const telegram_chat_id = document.getElementById('set-telegram-chat-id').value.trim();

  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'gemini_api_key', value: gemini_api_key })
    });
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'gemini_model', value: gemini_model })
    });
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'telegram_notifications_enabled', value: telegram_notifications_enabled })
    });
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'telegram_bot_token', value: telegram_bot_token })
    });
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'telegram_chat_id', value: telegram_chat_id })
    });

    showToast('Ajustes de IA y Telegram guardados correctamente.', 'success');
    await loadBaseData(); // reload
    renderAIAssistantTab();
  } catch (err) {
    console.error('Error saving AI settings:', err);
    showToast('Error al guardar los ajustes de IA.', 'danger');
  }
}

async function saveGeminiKeyOnly() {
  const gemini_api_key = document.getElementById('set-gemini-api-key').value.trim();
  const gemini_model = document.getElementById('set-gemini-model').value;

  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'gemini_api_key', value: gemini_api_key })
    });
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'gemini_model', value: gemini_model })
    });
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'telegram_notifications_enabled', value: 'false' })
    });

    showToast('Clave de Gemini guardada correctamente.', 'success');
    await loadBaseData(); // reload
    renderAIAssistantTab();
  } catch (err) {
    console.error('Error saving Gemini key:', err);
    showToast('Error al guardar la clave de Gemini.', 'danger');
  }
}

async function testTelegramConnection() {
  const token = document.getElementById('set-telegram-bot-token').value.trim();
  const chatId = document.getElementById('set-telegram-chat-id').value.trim();

  if (!token || !chatId) {
    showToast('Por favor, rellena el Token del bot y el Chat ID para probar.', 'warning');
    return;
  }

  showToast('Enviando mensaje de prueba...', 'neutral');

  try {
    const res = await fetch('/api/telegram/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, chatId })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error desconocido.');

    showToast('¡Mensaje de prueba enviado con éxito! Revisa tu Telegram.', 'success');
  } catch (err) {
    console.error('Error testing Telegram:', err);
    showToast(`Error de conexión: ${err.message}`, 'danger');
  }
}

async function handleSendChatMessage() {
  const inputEl = document.getElementById('chat-input');
  const message = inputEl.value.trim();
  if (!message) return;

  // Clear input
  inputEl.value = '';

  const chatMessages = document.getElementById('chat-messages');

  // Append User message
  const userMsgEl = document.createElement('div');
  userMsgEl.className = 'chat-message user';
  userMsgEl.style.display = 'flex';
  userMsgEl.style.gap = '12px';
  userMsgEl.style.maxWidth = '80%';
  userMsgEl.style.alignSelf = 'flex-end';
  userMsgEl.innerHTML = `
    <div class="message-avatar" style="width: 32px; height: 32px; border-radius: 50%; background: rgba(168, 85, 247, 0.1); border: 1px solid rgba(168, 85, 247, 0.2); color: var(--primary); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
      <i data-lucide="user" style="width: 16px; height: 16px;"></i>
    </div>
    <div class="message-bubble" style="background: var(--primary); color: #fff; border-radius: 16px 0 16px 16px; padding: 14px 18px; font-size: 0.95rem; line-height: 1.5; border: none;">
      ${escapeHTML(message)}
    </div>
  `;
  chatMessages.appendChild(userMsgEl);
  lucide.createIcons();

  // Scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;

  // Append Thinking bubble
  const thinkingMsgEl = document.createElement('div');
  thinkingMsgEl.className = 'chat-message bot thinking';
  thinkingMsgEl.style.display = 'flex';
  thinkingMsgEl.style.gap = '12px';
  thinkingMsgEl.style.maxWidth = '80%';
  thinkingMsgEl.innerHTML = `
    <div class="message-avatar" style="width: 32px; height: 32px; border-radius: 50%; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); color: var(--primary); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
      <i data-lucide="bot" style="width: 16px; height: 16px;"></i>
    </div>
    <div class="message-bubble" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 0 16px 16px 16px; padding: 14px 18px; font-size: 0.95rem; line-height: 1.5; color: var(--text);">
      <div class="typing-indicator">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  `;
  chatMessages.appendChild(thinkingMsgEl);
  lucide.createIcons();
  chatMessages.scrollTop = chatMessages.scrollHeight;

  try {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });

    const data = await res.json();
    
    // Remove thinking indicator
    thinkingMsgEl.remove();

    if (!res.ok) throw new Error(data.error || 'Error al procesar la respuesta.');

    // Append Bot message
    const botMsgEl = document.createElement('div');
    botMsgEl.className = 'chat-message bot';
    botMsgEl.style.display = 'flex';
    botMsgEl.style.gap = '12px';
    botMsgEl.style.maxWidth = '80%';
    botMsgEl.innerHTML = `
      <div class="message-avatar" style="width: 32px; height: 32px; border-radius: 50%; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); color: var(--primary); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
        <i data-lucide="bot" style="width: 16px; height: 16px;"></i>
      </div>
      <div class="message-bubble" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 0 16px 16px 16px; padding: 14px 18px; font-size: 0.95rem; line-height: 1.5; color: var(--text);">
        ${formatMarkdownToHTML(data.response)}
      </div>
    `;
    chatMessages.appendChild(botMsgEl);
    lucide.createIcons();
    chatMessages.scrollTop = chatMessages.scrollHeight;
  } catch (err) {
    console.error('Error in chat:', err);
    thinkingMsgEl.remove();
    
    const isQuotaError = err.message && (err.message.includes('quota') || err.message.includes('RESOURCE_EXHAUSTED') || err.message.includes('free_tier'));
    const isModelError = err.message && (err.message.includes('model') && (err.message.includes('not found') || err.message.includes('does not exist')));
    
    let friendlyMessage;
    if (isQuotaError) {
      friendlyMessage = `⚠️ <strong>Límite de cuota alcanzado</strong> para el modelo seleccionado.<br><br>
        El modelo de IA actual ha excedido el límite gratuito de solicitudes. Para solucionarlo:<br>
        1. Ve a <a href="#" onclick="showTab('settings')" style="color: #fb923c; font-weight: 600;">⚙️ Ajustes</a><br>
        2. En "Modelo de Google Gemini", selecciona <strong>Gemini 2.0 Flash</strong> o <strong>Gemini 1.5 Flash</strong><br>
        3. Guarda y vuelve a intentarlo`;
    } else if (isModelError) {
      friendlyMessage = `❌ <strong>Modelo no disponible</strong>: "${err.message}".<br><br>
        Ve a <a href="#" onclick="showTab('settings')" style="color: #fb923c; font-weight: 600;">⚙️ Ajustes</a> y selecciona un modelo válido como <strong>Gemini 2.5 Flash</strong>.`;
    } else {
      friendlyMessage = `Perdona, he tenido un problema al procesar tu solicitud: ${escapeHTML(err.message)}`;
    }

    const errMsgEl = document.createElement('div');
    errMsgEl.className = 'chat-message bot';
    errMsgEl.style.display = 'flex';
    errMsgEl.style.gap = '12px';
    errMsgEl.style.maxWidth = '80%';
    errMsgEl.innerHTML = `
      <div class="message-avatar" style="width: 32px; height: 32px; border-radius: 50%; background: rgba(244, 63, 94, 0.1); border: 1px solid rgba(244, 63, 94, 0.2); color: #f43f5e; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
        <i data-lucide="alert-circle" style="width: 16px; height: 16px;"></i>
      </div>
      <div class="message-bubble" style="background: rgba(244, 63, 94, 0.05); border: 1px solid rgba(244, 63, 94, 0.15); border-radius: 0 16px 16px 16px; padding: 14px 18px; font-size: 0.95rem; line-height: 1.6; color: #fb7185;">
        ${friendlyMessage}
      </div>
    `;
    chatMessages.appendChild(errMsgEl);
    lucide.createIcons();
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

function escapeHTML(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatMarkdownToHTML(text) {
  if (!text) return '';
  let html = text;
  
  // Escape HTML to prevent XSS
  html = escapeHTML(html);

  // Bold text: **text**
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Bullet points: * or - at the start of a line
  html = html.replace(/^\s*[\*\-]\s+(.*?)$/gm, '<li>$1</li>');
  
  // Wrap list items in <ul>. Look for consecutive <li> and wrap them
  html = html.replace(/(<li>.*?<\/li>)/gs, '<ul>$1</ul>');
  html = html.replace(/<\/ul>\s*<ul>/g, '');

  // Newlines to <br>
  html = html.replace(/\n/g, '<br>');
  
  return html;
}
