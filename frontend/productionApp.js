'use strict';

// ── Chart.js global defaults (match sales dashboard style) ──────────────────
Chart.defaults.color          = '#8892a4';
Chart.defaults.borderColor    = '#2d3448';
Chart.defaults.font.family    = "'Inter', 'Segoe UI', sans-serif";
Chart.defaults.font.size      = 12;
Chart.defaults.plugins.legend.display = false;

// Active chart instances — destroyed before re-render
let outputChart   = null;
let givenOutChart = null;
let tempChart     = null;

// ── Utility: animate numeric counter ────────────────────────────────────────
function animateProdCounter(el, finalValue, formatter) {
  if (el === null || el === undefined) return;
  const duration  = 800;
  const start     = performance.now();
  const startVal  = 0;

  function step(now) {
    const elapsed  = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased    = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const current  = startVal + (finalValue - startVal) * eased;
    el.textContent = formatter(current, progress < 1);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ── KPI population ──────────────────────────────────────────────────────────
function populateKPIs(kpis) {
  const {
    totalProductionDays, totalBatches, totalOutput, totalGivenOut,
    avgOutputPerBatch, avgTemp, totalWeightKg, netStockMovement,
  } = kpis;

  const intFmt   = (v) => Math.round(v).toLocaleString();
  const floatFmt = (v, inProgress) => inProgress
    ? Math.round(v).toString()
    : v.toFixed(1);

  animateProdCounter(document.getElementById('kpiProdDays'),    totalProductionDays, intFmt);
  animateProdCounter(document.getElementById('kpiTotalBatches'), totalBatches,        intFmt);
  animateProdCounter(document.getElementById('kpiTotalOutput'),  totalOutput,         intFmt);
  animateProdCounter(document.getElementById('kpiTotalGivenOut'),totalGivenOut,       intFmt);

  animateProdCounter(
    document.getElementById('kpiAvgOutput'),
    avgOutputPerBatch,
    floatFmt
  );

  const tempEl = document.getElementById('kpiAvgTemp');
  if (avgTemp !== null) {
    animateProdCounter(tempEl, avgTemp, (v, ip) => (ip ? Math.round(v) : v.toFixed(1)) + '°C');
  } else {
    tempEl.textContent = 'N/A';
  }

  animateProdCounter(
    document.getElementById('kpiTotalWeight'),
    totalWeightKg,
    (v) => Math.round(v).toLocaleString() + ' kg'
  );

  // Net stock movement — animated with sign prefix
  animateProdCounter(
    document.getElementById('kpiNetStock'),
    Math.abs(netStockMovement),
    (v, ip) => {
      const n   = Math.round(v);
      const sign = netStockMovement >= 0 ? '+' : '−';
      return ip ? n.toLocaleString() : sign + n.toLocaleString();
    }
  );

  // Apply accent class to stock card
  const stockCard = document.getElementById('kpiStockCard');
  if (netStockMovement >= 0) {
    stockCard.classList.add('kpi-stock-positive');
    stockCard.classList.remove('kpi-stock-negative');
  } else {
    stockCard.classList.add('kpi-stock-negative');
    stockCard.classList.remove('kpi-stock-positive');
  }
}

// ── Executive Summary ────────────────────────────────────────────────────────
function populateExecutiveSummary(lines) {
  const body = document.getElementById('execSummaryBody');
  if (!body) return;

  body.innerHTML = '';
  lines.forEach(line => {
    const div = document.createElement('div');
    const isWarning = line.startsWith('⚠');
    div.className = 'exec-line' + (isWarning ? ' exec-warning' : '');
    div.textContent = line;
    body.appendChild(div);
  });
}

// ── Monthly Breakdown Table ──────────────────────────────────────────────────
function populateMonthlyTable(monthlyBreakdown) {
  const tbody = document.getElementById('monthlyTableBody');
  const tfoot = document.getElementById('monthlyTableFoot');
  if (!tbody || !tfoot) return;

  tbody.innerHTML = '';
  const months = [
    'Jan','Feb','Mar','Apr','May','Jun',
    'Jul','Aug','Sep','Oct','Nov','Dec',
  ];

  let totDays = 0, totBatches = 0, totOutput = 0, totGivenOut = 0;

  monthlyBreakdown.forEach(m => {
    const [, mm] = m.month.split('-');
    const label  = months[parseInt(mm, 10) - 1] + ' ' + m.month.slice(0, 4);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${label}</td>
      <td>${m.productionDays}</td>
      <td>${m.batches}</td>
      <td>${m.output.toLocaleString()}</td>
      <td>${m.givenOut.toLocaleString()}</td>
    `;
    tbody.appendChild(tr);

    totDays     += m.productionDays;
    totBatches  += m.batches;
    totOutput   += m.output;
    totGivenOut += m.givenOut;
  });

  tfoot.innerHTML = `
    <tr>
      <td><strong>Total</strong></td>
      <td>${totDays}</td>
      <td>${totBatches}</td>
      <td>${totOutput.toLocaleString()}</td>
      <td>${totGivenOut.toLocaleString()}</td>
    </tr>
  `;
}

// ── Chart Renders ────────────────────────────────────────────────────────────

function renderOutputTrend(outputTrend) {
  const canvas = document.getElementById('chartOutputTrend');
  if (!canvas) return;

  if (outputChart) { outputChart.destroy(); outputChart = null; }

  const labels = outputTrend.map(d => d.date);
  const data   = outputTrend.map(d => d.output);
  const colors = data.map(v => v === 0 ? '#fca5a5' : '#60a5fa');

  outputChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Bags Produced',
        data,
        backgroundColor: colors,
        borderRadius: 3,
      }],
    },
    options: {
      maintainAspectRatio: false,
      responsive: true,
      scales: {
        x: {
          ticks: {
            maxTicksLimit: 20,
            maxRotation: 45,
          },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Bags' },
        },
      },
      plugins: {
        tooltip: {
          callbacks: {
            afterBody: (items) => {
              const idx  = items[0].dataIndex;
              const row  = outputTrend[idx];
              return [`Batches: ${row.batches}`, `Weight: ${row.weightKg} kg`];
            },
          },
        },
      },
    },
  });
}

function renderGivenOutChart(givenOutTrend) {
  const canvas = document.getElementById('chartGivenOut');
  if (!canvas) return;

  if (givenOutChart) { givenOutChart.destroy(); givenOutChart = null; }

  const labels = givenOutTrend.map(d => d.date);
  const data   = givenOutTrend.map(d => d.givenOut);
  const colors = givenOutTrend.map(d => d.hadProduction ? '#a78bfa' : '#c4b5fd');

  givenOutChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Given Out',
        data,
        backgroundColor: colors,
        borderRadius: 3,
      }],
    },
    options: {
      maintainAspectRatio: false,
      responsive: true,
      scales: {
        x: { ticks: { maxTicksLimit: 16, maxRotation: 45 } },
        y: { beginAtZero: true, title: { display: true, text: 'Units' } },
      },
      plugins: {
        tooltip: {
          callbacks: {
            afterBody: (items) => {
              const row = givenOutTrend[items[0].dataIndex];
              return [row.hadProduction ? 'Production day' : 'Distribution only'];
            },
          },
        },
      },
    },
  });
}

function renderTempTrend(tempTrend) {
  const canvas = document.getElementById('chartTemp');
  if (!canvas) return;

  if (tempChart) { tempChart.destroy(); tempChart = null; }

  const labels = tempTrend.map(d => d.date);
  const data   = tempTrend.map(d => d.avgTemp);

  tempChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Avg Temp (°C)',
        data,
        borderColor:     '#f97316',
        backgroundColor: 'rgba(249,115,22,0.12)',
        fill:            true,
        tension:         0.3,
        pointRadius:     2,
        pointHoverRadius: 5,
      }],
    },
    options: {
      maintainAspectRatio: false,
      responsive: true,
      scales: {
        x: { ticks: { maxTicksLimit: 16, maxRotation: 45 } },
        y: {
          min: 100,
          title: { display: true, text: '°C' },
        },
      },
    },
  });
}

// ── Anomaly Sidebar ──────────────────────────────────────────────────────────
function populateSidebar(anomalies) {
  const {
    incompleteProductionDays, productionGaps,
    distributionAnomalies, missingTempDays, highlights,
  } = anomalies;

  // --- Incomplete days ---
  const incompleteSection = document.getElementById('incompleteSection');
  const incompleteList    = document.getElementById('incompleteList');
  if (incompleteProductionDays.length > 0) {
    incompleteSection.style.display = 'block';
    incompleteList.innerHTML = incompleteProductionDays.map(d => `
      <div class="anomaly-item anomaly-highlight">
        <span class="anomaly-date">${d.date}</span>
        <span class="anomaly-detail">${d.weightKg} kg run — no output recorded</span>
      </div>
    `).join('');
  }

  // --- Production gaps ---
  const gapsSection = document.getElementById('gapsSection');
  const gapsList    = document.getElementById('gapsList');
  if (productionGaps.length > 0) {
    gapsSection.style.display = 'block';
    gapsList.innerHTML = productionGaps.map(g => `
      <div class="anomaly-item anomaly-gap">
        <span class="anomaly-date">${g.days} days${g.ongoing ? ' (ongoing)' : ''}</span>
        <span class="anomaly-detail">${g.start} → ${g.end}</span>
      </div>
    `).join('');
  }

  // --- Highlights ---
  const highlightsSection = document.getElementById('highlightsSection');
  const highlightsList    = document.getElementById('highlightsList');
  const highlightItems    = [];

  if (highlights.peakDay) {
    const p = highlights.peakDay;
    highlightItems.push(`
      <div class="anomaly-item anomaly-highlight">
        <span class="anomaly-date">Peak Day: ${p.date}</span>
        <span class="anomaly-detail">${p.output} bags — ${p.batches} batch${p.batches !== 1 ? 'es' : ''} — ${p.weightKg} kg</span>
      </div>
    `);
  }
  if (highlights.longestStreak) {
    const s = highlights.longestStreak;
    highlightItems.push(`
      <div class="anomaly-item anomaly-highlight">
        <span class="anomaly-date">Longest Streak: ${s.days} days</span>
        <span class="anomaly-detail">${s.start} – ${s.end}</span>
      </div>
    `);
  }
  if (missingTempDays.length > 0) {
    highlightItems.push(`
      <div class="anomaly-item">
        <span class="anomaly-date">Missing Temp Readings: ${missingTempDays.length} day${missingTempDays.length !== 1 ? 's' : ''}</span>
        <span class="anomaly-detail">${missingTempDays.map(d => d.date).join(', ')}</span>
      </div>
    `);
  }
  if (highlightItems.length > 0) {
    highlightsSection.style.display = 'block';
    highlightsList.innerHTML = highlightItems.join('');
  }

  // --- Distribution anomalies ---
  const distSection = document.getElementById('distSection');
  const distList    = document.getElementById('distList');
  if (distributionAnomalies.length > 0) {
    distSection.style.display = 'block';
    distList.innerHTML = distributionAnomalies.map(d => `
      <div class="anomaly-item anomaly-dist">
        <span class="anomaly-date">${d.date} — ${d.givenOut} units out</span>
        <span class="anomaly-detail">Same-day output: ${d.sameDayOutput} | Excess from stock: ${d.excessFromStock}</span>
      </div>
    `).join('');
  }
}

// ── Main loader ──────────────────────────────────────────────────────────────
async function loadProductionDashboard() {
  const overlay = document.getElementById('loadingOverlay');
  try {
    const response = await fetch('/production-analytics');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    populateKPIs(data.kpis);
    populateExecutiveSummary(data.executiveSummary);
    populateMonthlyTable(data.monthlyBreakdown);

    renderOutputTrend(data.charts.outputTrend);
    renderGivenOutChart(data.charts.givenOutTrend);
    renderTempTrend(data.charts.tempTrend);

    populateSidebar(data.anomalies);
  } catch (err) {
    console.error('Failed to load production analytics:', err);
    const body = document.getElementById('execSummaryBody');
    if (body) {
      body.innerHTML = '<span class="exec-line exec-warning">⚠ Failed to load production data. Please refresh or check your connection.</span>';
    }
  } finally {
    if (overlay) overlay.style.display = 'none';
  }
}

// ── Sidebar toggle + boot ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const sidebarToggle = document.getElementById('toggle-prod-sidebar');
  const prodSidebar   = document.getElementById('prodSidebar');
  const prodMain      = document.getElementById('prodMain');

  if (sidebarToggle && prodSidebar && prodMain) {
    sidebarToggle.addEventListener('click', () => {
      prodSidebar.classList.toggle('closed');
      prodMain.classList.toggle('expanded');
    });
  }

  loadProductionDashboard();
});
