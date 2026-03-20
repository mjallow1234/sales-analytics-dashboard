// global chart defaults and color palette
Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
Chart.defaults.plugins.legend.position = "top";
Chart.defaults.plugins.legend.labels.boxWidth = 12;

Chart.defaults.elements.line.tension = 0.3;
Chart.defaults.elements.point.radius = 3;

const colors = [
  "#2563eb",
  "#16a34a",
  "#f59e0b",
  "#dc2626",
  "#8b5cf6",
  "#06b6d4"
];

const chartPalette = [
  "#3b82f6",
  "#10b981",
  "#8b5cf6",
  "#f59e0b",
  "#ef4444",
  "#14b8a6",
  "#6366f1"
];

const financeTooltip = {
  callbacks: {
    label: function(context) {
      const label = context.dataset.label || '';
      const val = formatFinance(context.raw);
      return label ? label + ': ' + val : val;
    }
  }
};

const financeYTicks = {
  ticks: {
    callback: function(value) {
      return formatFinance(value);
    }
  }
};

function formatFinance(value) {
  if (value === null || value === undefined) return '0';
  const num = Number(value);
  if (isNaN(num)) return '0';
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1) + 'B';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
  return num.toString();
}

function animateCounter(element, finalValue, duration) {
  duration = duration || 800;
  const end = Number(finalValue) || 0;
  const startTime = performance.now();
  element.title = end.toLocaleString();
  function update(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const current = Math.floor(end * progress);
    element.textContent = formatFinance(current);
    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      element.textContent = formatFinance(end);
    }
  }
  requestAnimationFrame(update);
}

// track which quick filter is active (null = none)
let activeQuickFilter = null;

// chart-driven filters for cross-filtering
let chartFilters = {
  agent: null,
  product: null,
  location: null
};

// edit mode state
let editMode = false;
let draggedTile = null;
let activeChart = null;
let activeTile = null;

// --- Preset storage system ---
let activePresetName = localStorage.getItem('activePreset') || 'default';

function loadPresets() {
  return JSON.parse(localStorage.getItem('dashboardPresets') || '{}');
}

function savePreset(name, layout, settings) {
  const presets = loadPresets();
  presets[name] = { layout: layout, settings: settings };
  localStorage.setItem('dashboardPresets', JSON.stringify(presets));
}

function loadPreset(name) {
  const presets = loadPresets();
  if (!presets[name]) return null;
  return presets[name];
}

function saveActivePreset() {
  const order = [...document.querySelectorAll('.dashboard-tile')]
    .map(tile => tile.dataset.tile);
  savePreset(activePresetName, order, chartSettingsStore);
}

function getCurrentLayout() {
  return [...document.querySelectorAll('.dashboard-tile')]
    .map(tile => tile.dataset.tile);
}

function getPresetNames() {
  return Object.keys(loadPresets());
}

function populatePresetDropdown() {
  const select = document.getElementById('presetSelect');
  if (!select) return;
  const presets = getPresetNames();
  select.innerHTML = '';
  presets.forEach(name => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  });
  select.value = activePresetName;
}

function deletePreset(name) {
  if (name === 'default') return;
  const presets = loadPresets();
  delete presets[name];
  localStorage.setItem('dashboardPresets', JSON.stringify(presets));
}

// migrate legacy single-layout keys into preset system on first run
(function migrateToPresets() {
  const presets = loadPresets();
  if (Object.keys(presets).length) return;
  const legacyLayout = JSON.parse(localStorage.getItem('dashboardLayout') || '[]');
  const legacySettings = JSON.parse(localStorage.getItem('chartSettings') || '{}');
  savePreset('default', legacyLayout, legacySettings);
  localStorage.removeItem('dashboardLayout');
  localStorage.removeItem('chartSettings');
})();

// persistent chart settings loaded from active preset
let chartSettingsStore = (function() {
  const preset = loadPreset(activePresetName);
  return (preset && typeof preset.settings === 'object' && !Array.isArray(preset.settings))
    ? preset.settings
    : {};
})();

// helper that updates the text summary bar based on filters
function updateFilterSummary(filters) {
  const summary = document.getElementById('filterSummary');
  if (!summary) return;
  const parts = [];
  if (filters.agent) {
    parts.push(`Agent: ${filters.agent}`);
  }
  if (filters.product) {
    parts.push(`Product: ${filters.product}`);
  }
  if (filters.location) {
    parts.push(`Location: ${filters.location}`);
  }
  if (filters.startDate && filters.endDate) {
    parts.push(`Period: ${filters.startDate} → ${filters.endDate}`);
  }
  if (parts.length === 0) {
    summary.innerHTML = 'Showing: All Data';
  } else {
    summary.innerHTML = 'Active Filters: ' + parts.join(' | ');
  }
}

function isValidColor(value) {
  return typeof value === 'string' && value.length > 0;
}

// apply previously saved settings to a chart if available
function applyStoredSettings(chart, tile) {
  if (!chart || !tile) return;
  const key = tile.dataset.tile;
  const settings = chartSettingsStore[key];
  if (!settings || typeof settings !== 'object') return;
  // apply title and tile height
  if (typeof settings.title === 'string' && settings.title) {
    const titleEl = tile.querySelector('h3');
    if (titleEl) titleEl.innerText = settings.title;
  }
  if (settings.span) {
    tile.style.gridRowEnd = 'span ' + settings.span;
  }
  if (chart.options) {
    if (chart.options.plugins && chart.options.plugins.legend)
      chart.options.plugins.legend.display = !!settings.legend;
    if (chart.options.scales) {
      if (chart.options.scales.x)
        chart.options.scales.x.display = !!settings.axisLabels;
      if (chart.options.scales.y) {
        chart.options.scales.y.grid = chart.options.scales.y.grid || {};
        chart.options.scales.y.grid.display = !!settings.grid;
      }
    }
  }
  if (isValidColor(settings.color) && chart.data && chart.data.datasets) {
    const ds = chart.data.datasets[0];
    if (ds) {
      if (!Array.isArray(ds.backgroundColor)) {
        ds.backgroundColor = settings.color;
      }
      if (!Array.isArray(ds.borderColor)) {
        ds.borderColor = settings.color;
      }
    }
  }
  if (typeof settings.type === 'string' && settings.type) {
    chart.config.type = settings.type;
  }
  chart.update();
}

// save current tile order into the active preset
function saveDashboardLayout() {
  saveActivePreset();
}

// helper responsible for making titles editable on double click
function enableTitleEditing() {
  document.querySelectorAll('.tile-content h3').forEach(title => {
    title.addEventListener('dblclick', () => {
      const text = title.textContent;
      const input = document.createElement('input');
      input.value = text;
      input.className = 'tile-title-editor';
      title.replaceWith(input);
      input.focus();
      input.addEventListener('blur', () => {
        const newTitle = input.value || text;
        const h3 = document.createElement('h3');
        h3.textContent = newTitle;
        input.replaceWith(h3);
      });
    });
  });
}

function showLoadingState() {
  document.querySelectorAll('.dashboard-tile')
    .forEach(tile => tile.classList.add('skeleton'));
}

function hideLoadingState() {
  document.querySelectorAll('.dashboard-tile')
    .forEach(tile => tile.classList.remove('skeleton'));
}

async function loadDashboard(filters = {}) {
  try {
    showLoadingState();

    // merge chart filters with passed filters, but strip null/empty values
    const mergedFilters = {
      ...filters,
      ...chartFilters
    };
    const finalFilters = {};
    Object.entries(mergedFilters).forEach(([key, value]) => {
      if (value !== null && value !== "" && value !== undefined) {
        finalFilters[key] = value;
      }
    });

    // update summary display
    updateFilterSummary(finalFilters);

    // build url with params (use backend port explicitly)
    let url = '/analytics';
    const params = new URLSearchParams(finalFilters);
    if (params.toString()) url += '?' + params.toString();

    console.log('Analytics query:', url);
    console.log('Start Date:', finalFilters.startDate || '(none)');
    console.log('End Date:', finalFilters.endDate || '(none)');
    console.log('Agent:', finalFilters.agent || '(none)');
    console.log('API URL:', url);

    const res = await fetch(url);
    if (!res.ok) throw new Error('Network response not ok');
    const data = await res.json();
    _lastAnalyticsData = data;

    updateCards(data);
    // table removed, no need to updateTopCustomers
    populateAgentDropdown(data);

    // prepare datasets for charts
    const productLabels = Object.keys(data.salesByProduct || {});
    const productValues = productLabels.map(p => (data.salesByProduct[p] || {}).revenue || 0);

    const locationEntries = Object.entries(data.revenueByLocation || {});
    locationEntries.sort((a, b) => b[1] - a[1]);
    const locationLabels = locationEntries.map(l => l[0]);
    const locationValues = locationEntries.map(l => l[1]);

    const customerLabels = (data.topCustomers || []).map(c => c.name);
    const customerValues = (data.topCustomers || []).map(c => c.totalSpent);

    const topAgents = (data.agentLeaderboard || []).slice(0, 10);
    const agentLabels = topAgents.map(a => a.agent);
    const agentValues = topAgents.map(a => a.revenue);

    const salesOverTimeRaw = data.salesOverTime || {};

    const datasets = {
      revenueByAgent: { labels: agentLabels, values: agentValues },
      topCustomers: { labels: customerLabels, values: customerValues },
      salesByProduct: { labels: productLabels, values: productValues },
      salesOverTime: salesOverTimeRaw,
      revenueOverTime: data.revenueOverTime || {},
      purchaseDistribution: data.purchaseDistribution || { onePurchase:0, twoPurchases:0, threePlusPurchases:0 },
      revenueByLocation: { labels: locationLabels, values: locationValues }
    };    try {
      renderCharts(datasets);
    } catch(err) {
      console.error("Chart rendering failed:", err);
    }

    renderInsights(data);
    renderBrief(data);
  } catch (err) {
    console.error('Failed to load analytics:', err);
  } finally {
    hideLoadingState();
  }
}

// AI Insights
function generateInsights(data) {
  const insights = [];
  const totalRevenue = data.totalRevenue;
  const totalSales = data.totalSales;

  if (totalSales > 0) {
    const avgOrderValue = (totalRevenue / totalSales).toFixed(2);
    insights.push(`Average order value is ${Number(avgOrderValue).toLocaleString()} GMD`);
  }

  const topAgent = Object.entries(data.revenueByAgent || {})
    .sort((a, b) => b[1] - a[1])[0];
  if (topAgent) {
    insights.push(`Top agent is ${topAgent[0]} with ${formatFinance(topAgent[1])}`);
  }

  const topLocation = Object.entries(data.revenueByLocation || {})
    .sort((a, b) => b[1] - a[1])[0];
  if (topLocation) {
    insights.push(`Top location is ${topLocation[0]} generating ${formatFinance(topLocation[1])}`);
  }

  return insights;
}

function generateSmartInsights(data) {
  const insights = [];

  // Compute last 7 days and previous 7 days revenue
  const now = new Date();
  const last7Days = new Date();
  last7Days.setDate(now.getDate() - 7);
  const prev7Days = new Date();
  prev7Days.setDate(now.getDate() - 14);

  let last7DaysRevenue = 0;
  let previous7DaysRevenue = 0;

  Object.entries(data.revenueOverTime || {}).forEach(([date, value]) => {
    const d = new Date(date);
    if (d >= last7Days) {
      last7DaysRevenue += value;
    } else if (d >= prev7Days) {
      previous7DaysRevenue += value;
    }
  });

  if (previous7DaysRevenue > 0 && last7DaysRevenue < previous7DaysRevenue) {
    insights.push('\u26a0 Revenue dropped compared to last week');
  } else if (previous7DaysRevenue > 0 && last7DaysRevenue > previous7DaysRevenue) {
    insights.push('\ud83d\udcc8 Revenue is up compared to last week');
  }

  // Top agent share
  const agentEntries = Object.entries(data.revenueByAgent || {}).sort((a, b) => b[1] - a[1]);
  const totalAgentRevenue = agentEntries.reduce((sum, [, v]) => sum + v, 0);
  if (agentEntries.length > 0 && totalAgentRevenue > 0) {
    const topAgentShare = agentEntries[0][1] / totalAgentRevenue;
    if (topAgentShare > 0.5) {
      insights.push('\ud83d\udd25 One agent dominates over 50% of sales');
    }
  }

  // Repeat customer loyalty
  const repeatCustomers = data.repeatCustomers || 0;
  const totalCustomers = data.totalCustomers || 0;
  if (totalCustomers > 0 && repeatCustomers / totalCustomers > 0.3) {
    insights.push('\ud83d\udc8e Strong customer loyalty detected');
  }

  return insights;
}

async function explainAnomaly(anomalyText) {
  if (!_lastAnalyticsData) return;
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = '...';
  try {
    const res = await fetch('/ai-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: `Explain why ${anomalyText}`,
        context: {
          totalSales: _lastAnalyticsData.totalSales,
          totalRevenue: _lastAnalyticsData.totalRevenue,
          revenueByAgent: _lastAnalyticsData.revenueByAgent,
          revenueByLocation: _lastAnalyticsData.revenueByLocation,
          salesOverTime: _lastAnalyticsData.salesOverTime,
          revenueOverTime: _lastAnalyticsData.revenueOverTime,
          anomalies: _lastAnalyticsData.anomalies,
          trends: _lastAnalyticsData.trends
        }
      })
    });
    const data = await res.json();
    const msgEl = document.getElementById('aiMessages');
    if (msgEl) {
      msgEl.innerHTML += `<div class="ai-msg bot"><strong>Explanation:</strong> ${data.answer}</div>`;
      msgEl.scrollTop = msgEl.scrollHeight;
    }
  } catch (err) {
    console.error('Explain anomaly failed:', err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Why?';
  }
}

function renderBrief(data) {
  const el = document.getElementById('intelligenceBrief');
  if (!el) return;
  const brief = data.intelligenceBrief || [];
  if (brief.length > 0) {
    el.innerHTML = '<div class="brief-header">Daily Intelligence Brief</div>' +
      brief.map(i => `<div class="brief-item">${i}</div>`).join('');
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

function renderInsights(data) {
  // Backend-computed anomalies
  const anomalyEl = document.getElementById('anomalyAlerts');
  if (anomalyEl) {
    const anomalies = data.anomalies || [];
    if (anomalies.length > 0) {
      anomalyEl.innerHTML = '<div class="section-label">Anomalies</div>' + anomalies.map(a => `<div class="anomaly-item"><span>${a}</span><button class="explain-btn" onclick="explainAnomaly('${a.replace(/'/g, "\\'")}')">Why?</button></div>`).join('');
      anomalyEl.style.display = 'block';
    } else {
      anomalyEl.style.display = 'none';
    }
  }

  // Backend-computed trends
  const trendEl = document.getElementById('trendInsights');
  if (trendEl) {
    const trends = data.trends || [];
    if (trends.length > 0) {
      trendEl.innerHTML = '<div class="section-label">Trends</div>' + trends.map(t => `<div class="trend-item">${t}</div>`).join('');
      trendEl.style.display = 'block';
    } else {
      trendEl.style.display = 'none';
    }
  }

  // Backend-computed recommendations
  const recEl = document.getElementById('recommendationInsights');
  if (recEl) {
    const recs = data.recommendations || [];
    if (recs.length > 0) {
      recEl.innerHTML = '<div class="section-label">Recommendations</div>' + recs.map(r => `<div class="rec-item">${r}</div>`).join('');
      recEl.style.display = 'block';
    } else {
      recEl.style.display = 'none';
    }
  }

  // Smart insights (client-computed)
  const smartContainer = document.getElementById('smartInsights');
  if (smartContainer) {
    const smart = generateSmartInsights(data);
    if (smart.length > 0) {
      smartContainer.innerHTML = smart.map(i => `<div class="smart-insight-item">${i}</div>`).join('');
      smartContainer.style.display = 'block';
    } else {
      smartContainer.style.display = 'none';
    }
  }

  // General insights
  const container = document.getElementById('aiInsights');
  if (container) {
    const insights = generateInsights(data);
    container.innerHTML = insights.map(i => `<div>\u2022 ${i}</div>`).join('');
  }
}

// AI Chat
let _lastAnalyticsData = null;

async function askAI(question, data) {
  const context = JSON.stringify({
    totalSales: data.totalSales,
    totalRevenue: data.totalRevenue,
    totalCustomers: data.totalCustomers,
    repeatCustomers: data.repeatCustomers,
    revenueByAgent: data.revenueByAgent,
    revenueByLocation: data.revenueByLocation,
    salesByProduct: data.salesByProduct,
    salesOverTime: data.salesOverTime,
    revenueOverTime: data.revenueOverTime,
    revenueGrowth: data.revenueGrowth
  });

  const response = await fetch('/ai-query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, context })
  });

  return response.json();
}

document.addEventListener('DOMContentLoaded', () => {
  const sendBtn = document.getElementById('aiSend');
  const input = document.getElementById('aiInput');
  const messages = document.getElementById('aiMessages');

  if (sendBtn && input && messages) {
    async function handleSend() {
      const question = input.value.trim();
      if (!question || !_lastAnalyticsData) return;
      input.value = '';

      messages.innerHTML += `<div class="user-msg">${question}</div>`;
      messages.innerHTML += `<div class="ai-msg">Thinking...</div>`;
      messages.scrollTop = messages.scrollHeight;

      try {
        const result = await askAI(question, _lastAnalyticsData);
        const lastMsg = messages.querySelector('.ai-msg:last-child');
        if (lastMsg) lastMsg.textContent = result.answer || 'No response';
      } catch (e) {
        const lastMsg = messages.querySelector('.ai-msg:last-child');
        if (lastMsg) lastMsg.textContent = 'Failed to get response';
      }
      messages.scrollTop = messages.scrollHeight;
    }

    sendBtn.addEventListener('click', handleSend);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSend();
    });
  }

  const toggleBtn = document.getElementById('toggle-ai');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const sidebar = document.getElementById('aiSidebar');
      const main = document.querySelector('main');
      sidebar.classList.toggle('closed');
      sidebar.classList.toggle('open');
      main.classList.toggle('expanded');
    });
  }
});

function updateCards(data) {
  const elSales = document.getElementById('total-sales');
  if (elSales) animateCounter(elSales, data.totalSales);
  const elRev = document.getElementById('total-revenue');
  if (elRev) animateCounter(elRev, data.totalRevenue);
  const elCust = document.getElementById('total-customers');
  if (elCust) animateCounter(elCust, data.totalCustomers);
  const elRep = document.getElementById('repeatCustomers');
  if (elRep) animateCounter(elRep, data.repeatCustomers || 0);

  const growthEl = document.getElementById('revenueGrowth');
  if (growthEl && data.revenueGrowth !== undefined) {
    const value = data.revenueGrowth.toFixed(1);
    if (value >= 0) {
      growthEl.innerHTML = `↑ ${value}% vs previous period`;
      growthEl.className = 'growth-indicator growth-up';
    } else {
      growthEl.innerHTML = `↓ ${Math.abs(value)}% vs previous period`;
      growthEl.className = 'growth-indicator growth-down';
    }
  }
}

function updateTopCustomers(data) {
  const topBody = document.querySelector('#topCustomersTable tbody');
  if (!topBody) return;
  topBody.innerHTML = '';
  (data.topCustomers || []).forEach(c => {
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.textContent = c.name || '';
    const tdPhone = document.createElement('td');
    tdPhone.textContent = c.phone;
    const tdPurch = document.createElement('td');
    tdPurch.textContent = c.purchases;
    const tdSpent = document.createElement('td');
    tdSpent.textContent = formatFinance(c.totalSpent);
    tr.appendChild(tdName);
    tr.appendChild(tdPhone);
    tr.appendChild(tdPurch);
    tr.appendChild(tdSpent);
    topBody.appendChild(tr);
  });
}

function populateAgentDropdown(data) {
  const agentLabels = Object.keys(data.revenueByAgent);
  const agentSelect = document.getElementById('agentFilter');
  if (!agentSelect) return;
  const selected = agentSelect.value;
  agentSelect.innerHTML = '<option value="">All Agents</option>';
  agentLabels.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a;
    opt.textContent = a;
    if (a === selected) opt.selected = true;
    agentSelect.appendChild(opt);
  });
}

// global chart references
let revenueChart;
let salesOverTimeChart;
let dailyRevenueChart;
let customerDistributionChart;
let topCustomersChart;
let productChart;

// load when page opens

function renderCharts(datasets) {
  // Ensure Chart.js does not enforce an internal aspect ratio (allows tile resizing)
  // by using `maintainAspectRatio: false` on each chart.
  // top customers - bar
  const customersCanvas = document.getElementById('chart-customers');
  if (!customersCanvas) return;
  const customersCtx = customersCanvas.getContext('2d');
  if (topCustomersChart) {
    topCustomersChart.data.labels = datasets.topCustomers.labels;
    topCustomersChart.data.datasets[0].data = datasets.topCustomers.values;
    topCustomersChart.update();
  } else {
    topCustomersChart = new Chart(customersCtx, {
      type: 'bar',
      data: {
        labels: datasets.topCustomers.labels,
        datasets: [{
          label: 'Total Spent',
          data: datasets.topCustomers.values,
          backgroundColor: chartPalette
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, animation: { duration: 800, easing: 'easeOutQuart' }, plugins: { tooltip: financeTooltip }, scales: { y: financeYTicks } }
    });
    if (!window.chartInstances) window.chartInstances = {};
    window.chartInstances["chart-customers"] = topCustomersChart;
  }

  // revenue by agent - bar
  const agentCanvas = document.getElementById('chart-agent');
  if (!agentCanvas) return;
  const ctxAgent = agentCanvas.getContext('2d');
  if (revenueChart) {
    revenueChart.data.labels = datasets.revenueByAgent.labels;
    revenueChart.data.datasets[0].data = datasets.revenueByAgent.values;
    revenueChart.update();
    const tile = document.querySelector('[data-tile="revenue-agent"]');
    if (tile) applyStoredSettings(revenueChart, tile);
  } else {
    revenueChart = new Chart(ctxAgent, {
      type: 'bar',
      data: {
        labels: datasets.revenueByAgent.labels,
        datasets: [{
          label: 'Revenue',
          data: datasets.revenueByAgent.values,
          backgroundColor: chartPalette,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 800, easing: 'easeOutQuart' },
        plugins: { tooltip: financeTooltip },
        scales: { y: financeYTicks },
        onClick: (evt, elements) => {
          if (!elements.length) return;
          const index = elements[0].index;
          const agent = datasets.revenueByAgent.labels[index];
          if (chartFilters.agent === agent) {
            chartFilters.agent = null;
          } else {
            chartFilters.agent = agent;
          }
          loadDashboard();
        }
      },
    });
    if (!window.chartInstances) window.chartInstances = {};
    window.chartInstances["chart-agent"] = revenueChart;
    const tile = document.querySelector('[data-tile="revenue-agent"]');
    if (tile) applyStoredSettings(revenueChart, tile);
  }

  // sales by product - pie
  const productCanvas = document.getElementById('chart-product');
  if (!productCanvas) return;
  const ctxProduct = productCanvas.getContext('2d');
  if (productChart) {
    productChart.data.labels = datasets.salesByProduct.labels;
    productChart.data.datasets[0].data = datasets.salesByProduct.values;
    productChart.update();
    const tile = document.querySelector('[data-tile="sales-product"]');
    if (tile) applyStoredSettings(productChart, tile);
  } else {
    productChart = new Chart(ctxProduct, {
      type: 'pie',
      data: {
        labels: datasets.salesByProduct.labels,
        datasets: [{
          data: datasets.salesByProduct.values,
          backgroundColor: datasets.salesByProduct.labels.map((_,i)=> chartPalette[i % chartPalette.length]),
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 800, easing: 'easeOutQuart' },
        plugins: { tooltip: financeTooltip },
        onClick: (evt, elements) => {
          if (!elements.length) return;
          const index = elements[0].index;
          const product = datasets.salesByProduct.labels[index];
          if (chartFilters.product === product) {
            chartFilters.product = null;
          } else {
            chartFilters.product = product;
          }
          loadDashboard();
        }
      },
    });
    if (!window.chartInstances) window.chartInstances = {};
    window.chartInstances["chart-product"] = productChart;
    const tile = document.querySelector('[data-tile="sales-product"]');
    if (tile) applyStoredSettings(productChart, tile);
  }

  // Revenue by Location Leaderboard
  const locationContainer = document.getElementById('locationLeaderboard');
  const locData = datasets.revenueByLocation;
  if (locationContainer && locData) {
    const totalRevenue = locData.values.reduce((sum, v) => sum + v, 0);
    locationContainer.innerHTML = '';
    let cumulative = 0;
    locData.labels.forEach((location, index) => {
      const revenue = locData.values[index];
      const share = (revenue / totalRevenue) * 100;
      cumulative += share;
      let medal = '';
      if (index === 0) medal = '\u{1F947}';
      else if (index === 1) medal = '\u{1F948}';
      else if (index === 2) medal = '\u{1F949}';
      const row = document.createElement('div');
      row.className = 'location-item';
      row.innerHTML = `
        <div class="location-rank">${medal || index + 1}</div>
        <div class="location-name">${location}</div>
        <div class="location-share">${share.toFixed(1)}%</div>
        <div class="location-revenue">${formatFinance(revenue)}</div>
      `;
      locationContainer.appendChild(row);
    });
  }

  // Contribution insight (Pareto analysis)
  const insightContainer = document.getElementById('locationInsight');
  if (insightContainer && locData) {
    const total = locData.values.reduce((s, v) => s + v, 0);
    let cumulative = 0;
    let topCount = 0;
    for (let i = 0; i < locData.values.length; i++) {
      cumulative += locData.values[i];
      topCount++;
      if (cumulative / total >= 0.8) break;
    }
    insightContainer.innerHTML = `
      Top <strong>${topCount}</strong> locations generate
      <strong>${((cumulative / total) * 100).toFixed(0)}%</strong>
      of total revenue.
    `;
  }

  // sales over time - line
  const timeCanvas = document.getElementById('chart-sales-time');
  if (!timeCanvas) return;
  const ctxTime = timeCanvas.getContext('2d');
  const salesDataObj = datasets.salesOverTime || {};
  const dates = Object.keys(salesDataObj);
  const salesCounts = Object.values(salesDataObj);
  if (salesOverTimeChart) {
    salesOverTimeChart.data.labels = dates;
    salesOverTimeChart.data.datasets[0].data = salesCounts;
    salesOverTimeChart.update();
  } else {
    salesOverTimeChart = new Chart(ctxTime, {
      type: 'line',
      data: {
        labels: dates,
        datasets: [{
          label: 'Sales',
          data: salesCounts,
          borderColor: chartPalette[0],
          borderWidth: 2,
          fill: false,
        }],
      },
      options: { responsive: true, maintainAspectRatio: false, animation: { duration: 800, easing: 'easeOutQuart' }, plugins: { tooltip: financeTooltip }, scales: { y: financeYTicks } },
    });
    if (!window.chartInstances) window.chartInstances = {};
    window.chartInstances["chart-sales-time"] = salesOverTimeChart;
    const tileTime = document.querySelector('[data-tile="sales-time"]');
    if (tileTime) applyStoredSettings(salesOverTimeChart, tileTime);
  }

  // daily revenue trend - line
  const dailyCanvas = document.getElementById('dailyRevenueChart');
  if (dailyCanvas) {
    const revOverTime = datasets.revenueOverTime || {};
    const dates = Object.keys(revOverTime);
    const revenue = Object.values(revOverTime);
    const dailyCtx = dailyCanvas.getContext('2d');

    if (dailyRevenueChart) {
      dailyRevenueChart.data.labels = dates;
      dailyRevenueChart.data.datasets[0].data = revenue;
      dailyRevenueChart.update();
      const tile = document.querySelector('[data-tile="daily-revenue-trend"]');
      if (tile) applyStoredSettings(dailyRevenueChart, tile);
    } else {
      dailyRevenueChart = new Chart(dailyCtx, {
        type: 'line',
        data: {
          labels: dates,
          datasets: [{
            label: 'Revenue',
            data: revenue,
            tension: 0.35,
            borderColor: '#22c55e',
            backgroundColor: 'rgba(34,197,94,0.2)',
            fill: true,
            pointRadius: 3
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 800, easing: 'easeOutQuart' },
          plugins: {
            legend: { display: false },
            tooltip: financeTooltip
          },
          scales: { y: financeYTicks }
        }
      });
      if (!window.chartInstances) window.chartInstances = {};
      window.chartInstances["dailyRevenueChart"] = dailyRevenueChart;
      const tile = document.querySelector('[data-tile="daily-revenue-trend"]');
      if (tile) applyStoredSettings(dailyRevenueChart, tile);
    }
  }

  // customer purchase distribution - pie
  const distCanvas = document.getElementById('chart-distribution');
  if (!distCanvas) return;
  const ctxDist = distCanvas.getContext('2d');  if (customerDistributionChart) {
    customerDistributionChart.data.datasets[0].data = [
      datasets.purchaseDistribution.onePurchase,
      datasets.purchaseDistribution.twoPurchases,
      datasets.purchaseDistribution.threePlusPurchases
    ];
    customerDistributionChart.update();
  } else {
    customerDistributionChart = new Chart(ctxDist, {
      type: 'pie',
      data: {
        labels: ['1 Purchase', '2 Purchases', '3+ Purchases'],
        datasets: [{
          data: [
            datasets.purchaseDistribution.onePurchase,
            datasets.purchaseDistribution.twoPurchases,
            datasets.purchaseDistribution.threePlusPurchases
          ],
          backgroundColor: [chartPalette[0], chartPalette[1], chartPalette[3]],
        }],
      },
      options: { responsive: true, maintainAspectRatio: false, animation: { duration: 800, easing: 'easeOutQuart' }, plugins: { tooltip: financeTooltip } },
    });
    if (!window.chartInstances) window.chartInstances = {};
    window.chartInstances["chart-distribution"] = customerDistributionChart;
    const tileDist = document.querySelector('[data-tile="distribution"]');
    if (tileDist) applyStoredSettings(customerDistributionChart, tileDist);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  // ensure dashboard container exists
  const dashboard = document.getElementById('dashboardGrid');
  if (!dashboard) {
    console.warn('Dashboard container missing');
    return;
  }
  // restore layout order from active preset
  const activePreset = loadPreset(activePresetName);
  if (activePreset && activePreset.layout && activePreset.layout.length) {
    activePreset.layout.forEach(name => {
      const tile = dashboard.querySelector(`[data-tile="${name}"]`);
      if (tile) dashboard.appendChild(tile);
    });
  }

  // preset selector UI
  populatePresetDropdown();

  const presetSelect = document.getElementById('presetSelect');
  if (presetSelect) {
    presetSelect.addEventListener('change', e => {
      activePresetName = e.target.value;
      localStorage.setItem('activePreset', activePresetName);
      location.reload();
    });
  }

  const savePresetBtn = document.getElementById('savePresetBtn');
  if (savePresetBtn) {
    savePresetBtn.addEventListener('click', () => {
      const name = prompt('Preset name:');
      if (!name) return;
      savePreset(name, getCurrentLayout(), chartSettingsStore);
      activePresetName = name;
      localStorage.setItem('activePreset', activePresetName);
      populatePresetDropdown();
    });
  }

  const deletePresetBtn = document.getElementById('deletePresetBtn');
  if (deletePresetBtn) {
    deletePresetBtn.addEventListener('click', () => {
      if (activePresetName === 'default') {
        alert('Default preset cannot be deleted.');
        return;
      }
      deletePreset(activePresetName);
      localStorage.setItem('activePreset', 'default');
      location.reload();
    });
  }

  // instant filter application
  function applyFilters() {
    const startEl = document.getElementById('startDate');
    const endEl = document.getElementById('endDate');
    const agentEl = document.getElementById('agentFilter');
    const startDate = startEl ? startEl.value : '';
    const endDate = endEl ? endEl.value : '';
    const agent = agentEl ? agentEl.value : '';
    const filters = {};
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    if (agent) filters.agent = agent;
    loadDashboard(filters);
  }

  const sd = document.getElementById('startDate');
  if (sd) sd.addEventListener('change', applyFilters);
  const ed = document.getElementById('endDate');
  if (ed) ed.addEventListener('change', applyFilters);
  const af = document.getElementById('agentFilter');
  if (af) af.addEventListener('change', applyFilters);

  // month dropdown menu inside monthly button
  const monthMenu = document.getElementById('monthMenu');
  if (monthMenu) {
    const months = [
      "January","February","March","April","May","June",
      "July","August","September","October","November","December"
    ];
    months.forEach((m,i)=>{
      const item = document.createElement('div');
      item.textContent = m;
      item.onclick = ()=>{
        const year = new Date().getFullYear();
        const start = new Date(year,i,1);
        const end = new Date(year,i+1,0);
        const sd = document.getElementById('startDate');
        const ed = document.getElementById('endDate');
        if (sd) sd.value = start.toISOString().split('T')[0];
        if (ed) ed.value = end.toISOString().split('T')[0];
        applyFilters();
        monthMenu.style.display="none";
      };
      monthMenu.appendChild(item);
    });
  }
  const monthlyBtn = document.getElementById('monthlyBtn');
  if (monthlyBtn) {
    monthlyBtn.onclick = () => {
      monthMenu.style.display =
        monthMenu.style.display==="block" ? "none" : "block";
    };
  }

  // yearly dropdown menu functionality
  const yearMenu = document.getElementById('yearMenu');
  if (yearMenu) {
    const currentYear = new Date().getFullYear();
    for(let y=currentYear; y>=currentYear-10; y--){
      const item = document.createElement('div');
      item.textContent = y;
      item.onclick = ()=>{
        const start = new Date(y,0,1);
        const end = new Date(y,11,31);
        const sd = document.getElementById('startDate');
        const ed = document.getElementById('endDate');
        if (sd) sd.value = start.toISOString().split('T')[0];
        if (ed) ed.value = end.toISOString().split('T')[0];
        applyFilters();
        yearMenu.style.display="none";
      };
      yearMenu.appendChild(item);
    }
  }

  const yearBtnEl = document.getElementById('yearBtn');
  if (yearBtnEl) {
    yearBtnEl.onclick = () => {
      yearMenu.style.display =
        yearMenu.style.display==="block" ? "none" : "block";
    };
  }

  // edit mode toggle
  document.getElementById('editDashboardBtn').addEventListener('click', () => {
    editMode = !editMode;
    document.body.classList.toggle('edit-mode', editMode);
    document.getElementById('editDashboardBtn').innerText =
      editMode ? 'Exit Edit Mode' : 'Edit Dashboard';

    // enable/disable dragging when in edit mode
    document.querySelectorAll('.dashboard-tile').forEach(tile => {
      if (editMode) {
        tile.setAttribute('draggable', 'true');
      } else {
        tile.removeAttribute('draggable');
      }
    });
  });

  // tile controls (up/down/remove)
  function setupTileControls() {
    document.querySelectorAll('.tile-up').forEach(btn => {
      btn.addEventListener('click', () => {
        const tile = btn.closest('.dashboard-tile');
        if (tile && tile.previousElementSibling) {
          tile.parentNode.insertBefore(tile, tile.previousElementSibling);
          saveDashboardLayout();
        }
      });
    });
    document.querySelectorAll('.tile-down').forEach(btn => {
      btn.addEventListener('click', () => {
        const tile = btn.closest('.dashboard-tile');
        if (tile && tile.nextElementSibling) {
          tile.parentNode.insertBefore(tile.nextElementSibling, tile);
          saveDashboardLayout();
        }
      });
    });
    document.querySelectorAll('.tile-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const tile = btn.closest('.dashboard-tile');
        if (tile) {
          tile.remove();
          saveDashboardLayout();
        }
      });
    });
    document.querySelectorAll('.tile-duplicate').forEach(btn => {
      btn.addEventListener('click', () => {
        const tile = btn.closest('.dashboard-tile');
        const clone = tile.cloneNode(true);

        const canvas = clone.querySelector('canvas');
        if (canvas) {
          const baseId = canvas.id || 'chart';
          canvas.id = `${baseId}-${Date.now()}`;
        }

        tile.parentNode.insertBefore(clone, tile.nextSibling);
        setupTileControls();
        enableTitleEditing();
        saveDashboardLayout();
      });
    });
  }
  // call once for initial tiles
  setupTileControls();
  enableTitleEditing();

  // add new visual button
  const addBtn = document.getElementById('addVisualBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const container = document.getElementById('dashboardGrid');
      if (!container) return;
      const tile = document.createElement('div');
      tile.className = 'dashboard-tile tile-medium';
      tile.dataset.tile = 'custom-' + Date.now();
      tile.innerHTML = `
<div class="tile-toolbar">
<button class="tile-settings">⚙</button>
<button class="tile-duplicate">⧉</button>
<button class="tile-up">⬆</button>
<button class="tile-down">⬇</button>
<button class="tile-remove">🗑</button>
</div>

<div class="tile-content">
<h3>New Visual</h3>
<canvas></canvas>
</div>
<div class="tile-resize-handle"></div>
`;
      container.appendChild(tile);
      setupTileControls();
      enableTitleEditing();
      saveDashboardLayout();
    });
  }

  // layout lock toggle
  let layoutLocked = false;
  const lockBtn = document.getElementById('lockLayoutBtn');
  if (lockBtn) {
    lockBtn.addEventListener('click', () => {
      layoutLocked = !layoutLocked;
      document.body.classList.toggle('layout-locked', layoutLocked);
    });
  }

  // drag and drop reordering (enabled only in edit mode)
  document.addEventListener('dragstart', e => {
    if (!editMode) return;
    if (e.target.closest('.tile-resize-handle')) return;
    const tile = e.target.closest('.dashboard-tile');
    if (tile) {
      draggedTile = tile;
      e.dataTransfer.effectAllowed = 'move';
    }
  });

  document.addEventListener('dragover', e => {
    if (!editMode) return;
    e.preventDefault();
  });

  document.addEventListener('drop', e => {
    if (!editMode) return;
    e.preventDefault();
    const target = e.target.closest('.dashboard-tile');
    if (!target || !draggedTile || target === draggedTile) return;

    const container = target.parentNode;
    container.insertBefore(draggedTile, target);
    saveDashboardLayout();
  });

  document.addEventListener('dragend', () => {
    draggedTile = null;
  });

  // resize tiles via grid-row span (edit mode only)
  const ROW_HEIGHT = 60;

  document.addEventListener('mousedown', function (e) {
    if (!editMode) return;

    const handle = e.target.closest('.tile-resize-handle');
    if (!handle) return;

    const tile = handle.closest('.dashboard-tile');
    if (!tile) return;

    e.preventDefault();

    const startY = e.clientY;
    const startHeight = tile.getBoundingClientRect().height;

    function onMouseMove(ev) {
      const delta = ev.clientY - startY;
      const newSpan = Math.round((startHeight + delta) / ROW_HEIGHT);

      const minSpan = 4;
      const maxSpan = 16;
      const span = Math.max(minSpan, Math.min(maxSpan, newSpan));

      tile.style.gridRowEnd = 'span ' + span;
    }

    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      const canvas = tile.querySelector('canvas');
      if (canvas) {
        const chart =
          canvas.chartInstance ||
          (window.chartInstances && window.chartInstances[canvas.id]);

        if (chart) chart.resize();
      }

      // persist span in chart settings store
      const key = tile.dataset.tile;
      const computed = getComputedStyle(tile);
      const spanMatch = computed.gridRowEnd.match(/span\s+(\d+)/);
      const spanVal = spanMatch ? parseInt(spanMatch[1], 10) : 6;
      if (!chartSettingsStore[key]) chartSettingsStore[key] = {};
      chartSettingsStore[key].span = spanVal;

      saveDashboardLayout();
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  // open settings panel when gear clicked (delegated)
  document.addEventListener('click', function(e) {
    const settingsBtn = e.target.closest('.tile-settings');
    if (!settingsBtn) return;
    const tile = settingsBtn.closest('.dashboard-tile');
    if (!tile) return;
    activeTile = tile;
    const canvas = tile.querySelector('canvas');
    if (!canvas) return;
    const chartId = canvas.id;
    if (!window.chartInstances) return;
    activeChart = window.chartInstances[chartId];

    // populate form with existing settings if present
    const key = activeTile.dataset.tile;
    const stored = chartSettingsStore[key] || {};
    const titleEl = activeTile.querySelector('h3');
    document.getElementById('chartTitleInput').value = stored.title || (titleEl ? titleEl.innerText : '');
    document.getElementById('chartTypeSelect').value = stored.type || activeChart.config.type || 'bar';
    document.getElementById('chartColorInput').value = stored.color || (activeChart.data.datasets[0]?.backgroundColor || '#000');
    document.getElementById('chartColorSecondary').value = stored.secondary || '';
    document.getElementById('showLegendToggle').checked = stored.legend !== undefined ? stored.legend : true;
    document.getElementById('showGridToggle').checked = stored.grid !== undefined ? stored.grid : true;
    document.getElementById('showAxisLabelsToggle').checked = stored.axisLabels !== undefined ? stored.axisLabels : true;
    document.getElementById('chartHeightInput').value = stored.height || activeTile.style.height || '';

    const panel = document.getElementById('chartSettingsPanel');
    if (panel) {
      panel.classList.add('open');
    }
  });


  // clear all filter button
  const clearBtn = document.getElementById('clearFiltersBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      chartFilters = {
        agent: null,
        product: null,
        location: null
      };
      activeQuickFilter = null;
      document.querySelectorAll('.quick-filters button')
        .forEach(b => b.classList.remove('active'));
      const start = document.getElementById('startDate');
      const end = document.getElementById('endDate');
      const agent = document.getElementById('agentFilter');
      if (start) start.value = '';
      if (end) end.value = '';
      if (agent) agent.value = 'All Agents';
      try { loadDashboard(); } catch (e) { console.error('Dashboard load failed on clear', e); }
    });
  }

  // apply chart settings
  const applyBtn = document.getElementById('applyChartSettings');
  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      if (!activeChart) return;
    const newTitle = document.getElementById('chartTitleInput').value;
    const newType = document.getElementById('chartTypeSelect').value;
    const newColor = document.getElementById('chartColorInput').value;
    const titleEl = activeTile.querySelector('h3');
    if (titleEl) titleEl.innerText = newTitle;
    activeChart.config.type = newType;
    activeChart.data.datasets.forEach(ds => {
      ds.backgroundColor = newColor;
      ds.borderColor = newColor;
    });
    activeChart.update();
    // apply height to tile as well
    const heightVal = document.getElementById('chartHeightInput').value;
    if (heightVal && activeTile) {
      activeTile.style.height = heightVal;
    }

    // save settings
    chartSettingsStore[activeTile.dataset.tile] = {
      title: chartTitleInput.value,
      type: chartTypeSelect.value,
      color: chartColorInput.value,
      secondary: document.getElementById('chartColorSecondary').value,
      legend: document.getElementById('showLegendToggle').checked,
      grid: document.getElementById('showGridToggle').checked,
      axisLabels: document.getElementById('showAxisLabelsToggle').checked,
      height: heightVal
    };
    saveActivePreset();
  });
  // quick filter buttons logic
  function clearActiveQuick() {
    document.querySelectorAll('.quick-filters button').forEach(b => b.classList.remove('active'));
  }

  function applyQuickFilter(range) {
    const today = new Date();
    let startDate = null;
    let endDate = today.toISOString().split('T')[0];

    if (range === 'today') {
      startDate = endDate;
    }

    if (range === '7') {
      const d = new Date();
      d.setDate(today.getDate() - 7);
      startDate = d.toISOString().split('T')[0];
    }

    if (range === '30') {
      const d = new Date();
      d.setDate(today.getDate() - 30);
      startDate = d.toISOString().split('T')[0];
    }

    if (range === 'month') {
      const d = new Date(today.getFullYear(), today.getMonth(), 1);
      startDate = d.toISOString().split('T')[0];
    }

    if (range === 'all') {
      startDate = '';
      endDate = '';
    }

    if (range === 'quarter') {
      const qMonth = Math.floor(today.getMonth() / 3) * 3;
      const qStart = new Date(today.getFullYear(), qMonth, 1);
      startDate = qStart.toISOString().split('T')[0];
    }

    document.getElementById('startDate').value = startDate || '';
    document.getElementById('endDate').value = endDate || '';

    applyFilters();
  }

  document.querySelectorAll('.quick-filters button').forEach(btn => {
    btn.addEventListener('click', () => {
      const range = btn.dataset.range;
      if (!range) {
        // dropdown toggles have no range
        return;
      }

      // toggle logic
      if (activeQuickFilter === range) {
        // clear filter
        activeQuickFilter = null;
        document.querySelectorAll('.quick-filters button').forEach(b => b.classList.remove('active'));
        document.getElementById('startDate').value = '';
        document.getElementById('endDate').value = '';
        loadDashboard();
        return;
      }

      // apply new filter
      activeQuickFilter = range;
      document.querySelectorAll('.quick-filters button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyQuickFilter(range);
    });
  });
  // initial dashboard load now that DOM is set up
  try {
    loadDashboard();
  } catch(err) {
    console.error('Dashboard load failed', err);
  }
  }
});

// delegated settings open listener
document.addEventListener("click", function(e) {
  const settingsBtn = e.target.closest(".tile-settings");
  if (!settingsBtn) return;
  const panel = document.getElementById("chartSettingsPanel");
  if (panel) {
    panel.classList.add("open");
  }
});

// close button handler
const closeBtn = document.getElementById("closeSettingsPanel");
if (closeBtn) {
  closeBtn.addEventListener("click", () => {
    document.getElementById("chartSettingsPanel").classList.remove("open");
  });
}
