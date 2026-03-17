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

function formatNumber(value) {
  const num = Number(value) || 0;
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
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

async function loadDashboard(filters = {}) {
  try {
    // show loading overlay
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = 'flex';

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

    const res = await fetch(url);
    if (!res.ok) throw new Error('Network response not ok');
    const data = await res.json();

    updateCards(data);
    // table removed, no need to updateTopCustomers
    populateAgentDropdown(data);

    // prepare datasets for charts
    const productLabels = Object.keys(data.salesByProduct || {});
    const productValues = productLabels.map(p => (data.salesByProduct[p] || {}).revenue || 0);

    const locationLabels = Object.keys(data.revenueByLocation || {});
    const locationValues = Object.values(data.revenueByLocation || {});

    const customerLabels = (data.topCustomers || []).map(c => c.name);
    const customerValues = (data.topCustomers || []).map(c => c.totalSpent);

    const topAgents = (data.agentLeaderboard || []).slice(0, 10);
    const agentLabels = topAgents.map(a => a.agent);
    const agentValues = topAgents.map(a => a.revenue);

    // Preserve existing salesOverTime shape for the current chart, and also provide an array for the new trend chart
    const salesOverTimeRaw = data.salesOverTime || {};
    const salesOverTimeArray = Array.isArray(salesOverTimeRaw)
      ? salesOverTimeRaw
      : Object.entries(salesOverTimeRaw).map(([date, revenue]) => ({ date, revenue }));

    const datasets = {
      revenueByAgent: { labels: agentLabels, values: agentValues },
      topCustomers: { labels: customerLabels, values: customerValues },
      salesByProduct: { labels: productLabels, values: productValues },
      salesOverTime: salesOverTimeRaw,
      salesOverTimeArray,
      purchaseDistribution: data.purchaseDistribution || { onePurchase:0, twoPurchases:0, threePlusPurchases:0 },
      revenueByLocation: { labels: locationLabels, values: locationValues }
    };    try {
      renderCharts(datasets);
    } catch(err) {
      console.error("Chart rendering failed:", err);
    }
  } catch (err) {
    console.error('Failed to load analytics:', err);
  } finally {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = 'none';
  }
}

function updateCards(data) {
  const elSales = document.getElementById('total-sales');
  if (elSales) {
    elSales.textContent = formatNumber(data.totalSales);
    elSales.title = Number(data.totalSales).toLocaleString();
  }
  const elRev = document.getElementById('total-revenue');
  if (elRev) {
    elRev.textContent = formatNumber(data.totalRevenue);
    elRev.title = Number(data.totalRevenue).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  const elCust = document.getElementById('total-customers');
  if (elCust) {
    elCust.textContent = formatNumber(data.totalCustomers);
    elCust.title = Number(data.totalCustomers).toLocaleString();
  }
  const elRep = document.getElementById('repeatCustomers');
  if (elRep) {
    const val = data.repeatCustomers || 0;
    elRep.textContent = formatNumber(val);
    elRep.title = Number(val).toLocaleString();
  }

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
    tdSpent.textContent = Number(c.totalSpent).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
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
let locationChart;
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
          data: datasets.topCustomers.values
        }]
      },
      options: { responsive: true, maintainAspectRatio: false }
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
          backgroundColor: colors[0] + '80',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
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
          backgroundColor: datasets.salesByProduct.labels.map((_,i)=> colors[i % colors.length]),
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
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

  // revenue by location - bar
  const locationCanvas = document.getElementById('chart-location');
  if (!locationCanvas) return;
  const locationCtx = locationCanvas.getContext('2d');
  if (locationChart) {
    locationChart.data.labels = datasets.revenueByLocation.labels;
    locationChart.data.datasets[0].data = datasets.revenueByLocation.values;
    locationChart.update();
    const tile = document.querySelector('[data-tile="revenue-location"]');
    if (tile) applyStoredSettings(locationChart, tile);
  } else {
    locationChart = new Chart(locationCtx, {
      type: 'bar',
      data: {
        labels: datasets.revenueByLocation.labels,
        datasets: [{
          label: 'Revenue',
          data: datasets.revenueByLocation.values,
          backgroundColor: colors[1] + '80'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onClick: (evt, elements) => {
          if (!elements.length) return;
          const index = elements[0].index;
          const location = datasets.revenueByLocation.labels[index];
          if (chartFilters.location === location) {
            chartFilters.location = null;
          } else {
            chartFilters.location = location;
          }
          loadDashboard();
        }
      }
    });
    if (!window.chartInstances) window.chartInstances = {};
    window.chartInstances["chart-location"] = locationChart;
    const tile = document.querySelector('[data-tile="revenue-location"]');
    if (tile) applyStoredSettings(locationChart, tile);
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
          borderColor: colors[0],
          borderWidth: 2,
          fill: false,
        }],
      },
      options: { responsive: true, maintainAspectRatio: false },
    });
    if (!window.chartInstances) window.chartInstances = {};
    window.chartInstances["chart-sales-time"] = salesOverTimeChart;
    const tileTime = document.querySelector('[data-tile="sales-time"]');
    if (tileTime) applyStoredSettings(salesOverTimeChart, tileTime);
  }

  // daily revenue trend - line
  const dailyCanvas = document.getElementById('dailyRevenueChart');
  if (dailyCanvas) {
    const trendData = datasets.salesOverTimeArray || [];
    const dates = trendData.map(d => d.date);
    const revenue = trendData.map(d => d.revenue);
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
            tension: 0.3,
            borderColor: colors[0],
            backgroundColor: colors[0] + '40',
            fill: true,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          }
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
          backgroundColor: [colors[0], colors[1], colors[3]],
        }],
      },
      options: { responsive: true, maintainAspectRatio: false },
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
