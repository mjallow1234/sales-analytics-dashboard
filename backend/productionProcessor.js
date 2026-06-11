'use strict';

/**
 * processProduction(rows)
 *
 * Parses raw rows from "Daily Production Report" (Google Sheets A:P)
 * and returns structured analytics: KPIs, chart datasets, anomaly engine
 * output, and executive summary lines.
 *
 * Column indices (0-based, confirmed by live header row audit):
 *   0  = Date              (A)
 *   5  = Weight(kg)        (F)
 *   6  = Temp°C            (G)
 *   7  = Time              (H)
 *   8  = Total Output      (I)
 *   15 = Given Out         (P)
 *
 * Columns B–E (1–4) and J–O (9–14) are permanently empty — ignored.
 *
 * Parser rules validated against full 198-row dataset (audit: 2026-06-04).
 */
function processProduction(rows) {
  if (!rows || rows.length < 2) {
    return emptyResult();
  }

  // Row 0 is the header; data starts at index 1
  const dataRows = rows.slice(1);

  // Include today fully — rows dated after today are future placeholders
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  const parsed = [];

  for (const row of dataRows) {
    const rawDate = String(row[0] || '').trim();
    if (!rawDate) continue;

    // Strip weekday prefix: "Monday, 1 June 2026" → "1 June 2026"
    const dateStr = rawDate.replace(/^\w+,\s*/, '');
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) continue;
    if (date > today) continue; // future-dated row — skip

    const rawWeight   = String(row[5]  || '').trim();
    const rawTemp     = String(row[6]  || '').trim();
    const rawTime     = String(row[7]  || '').trim();
    const rawOutput   = String(row[8]  || '').trim();
    const rawGivenOut = String(row[15] || '').trim();

    // ── Weight (kg) ──────────────────────────────────────────────────────────
    // Handles: "80kg", "B1: 80kg B2: 80kg", "B1: 80kg B2: 80kg B3: 60kg"
    const kgMatches = [...rawWeight.matchAll(/(\d+)kg/gi)];
    const weightKg  = kgMatches.reduce((s, m) => s + parseInt(m[1], 10), 0);

    // ── Batch count ──────────────────────────────────────────────────────────
    // Count explicit B1:/B2:... labels; fall back to 1 if any kg found
    const batchLabels = (rawWeight.match(/B\d+:/gi) || []).length;
    const batchCount  = batchLabels > 0 ? batchLabels : (weightKg > 0 ? 1 : 0);

    // ── Temperature (°C) ─────────────────────────────────────────────────────
    // Average valid batch readings; filter placeholder "000°C" (parsed as 0)
    let avgTemp = null;
    if (rawTemp) {
      const tempMatches = [...rawTemp.matchAll(/(\d+)°C/g)];
      const validTemps  = tempMatches.map(m => parseInt(m[1], 10)).filter(t => t > 0);
      if (validTemps.length > 0) {
        const sum = validTemps.reduce((a, b) => a + b, 0);
        avgTemp = Math.round(sum / validTemps.length * 10) / 10;
      }
    }

    // ── Duration (minutes) ───────────────────────────────────────────────────
    // Sum non-zero batch durations; filter placeholder "0h 00m" entries
    let durationMinutes = 0;
    if (rawTime) {
      const timeMatches    = [...rawTime.matchAll(/(\d+)h\s*(\d+)m/g)];
      const validDurations = timeMatches
        .map(m => parseInt(m[1], 10) * 60 + parseInt(m[2], 10))
        .filter(d => d > 0);
      durationMinutes = validDurations.reduce((a, b) => a + b, 0);
    }

    // ── Total Output ─────────────────────────────────────────────────────────
    // Multi-batch: extract B#: values, filter placeholder 0s, guard 1–100
    // Single-batch: plain integer with same validity guard
    let totalOutput = 0;
    if (rawOutput) {
      if (/B\d+:/i.test(rawOutput)) {
        const outputMatches = [...rawOutput.matchAll(/B\d+:\s*(\d+)/gi)];
        totalOutput = outputMatches
          .map(m => parseInt(m[1], 10))
          .filter(v => v >= 1 && v <= 100)
          .reduce((a, b) => a + b, 0);
      } else {
        const v = parseInt(rawOutput, 10);
        if (!isNaN(v) && v >= 1 && v <= 100) totalOutput = v;
      }
    }

    // ── Given Out ────────────────────────────────────────────────────────────
    const givenOut = parseInt(rawGivenOut, 10) || 0;

    const isProductionDay  = weightKg > 0;
    const incompleteOutput = isProductionDay && totalOutput === 0;

    parsed.push({
      date,
      dateStr: date.toISOString().slice(0, 10),
      weightKg,
      batchCount,
      avgTemp,
      durationMinutes,
      totalOutput,
      givenOut,
      isProductionDay,
      incompleteOutput,
    });
  }

  // Ensure chronological order (sheet should already be sorted, but be safe)
  parsed.sort((a, b) => a.date - b.date);

  const productionRows = parsed.filter(r => r.isProductionDay);

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const totalProductionDays = productionRows.length;
  const totalBatches        = productionRows.reduce((s, r) => s + r.batchCount, 0);
  const totalOutput         = productionRows.reduce((s, r) => s + r.totalOutput, 0);
  const totalGivenOut       = parsed.reduce((s, r) => s + r.givenOut, 0);
  const avgOutputPerBatch   = totalBatches > 0
    ? Math.round(totalOutput / totalBatches * 10) / 10
    : 0;
  const totalWeightKg       = productionRows.reduce((s, r) => s + r.weightKg, 0);
  const netStockMovement    = totalOutput - totalGivenOut;

  const validTempRows = productionRows.filter(r => r.avgTemp !== null);
  const avgTemp = validTempRows.length > 0
    ? Math.round(validTempRows.reduce((s, r) => s + r.avgTemp, 0) / validTempRows.length * 10) / 10
    : null;

  // ── Monthly breakdown ────────────────────────────────────────────────────
  const monthlyMap = {};
  for (const row of parsed) {
    const key = row.dateStr.slice(0, 7); // YYYY-MM
    if (!monthlyMap[key]) {
      monthlyMap[key] = { month: key, productionDays: 0, batches: 0, output: 0, givenOut: 0 };
    }
    if (row.isProductionDay) {
      monthlyMap[key].productionDays++;
      monthlyMap[key].batches += row.batchCount;
      monthlyMap[key].output  += row.totalOutput;
    }
    monthlyMap[key].givenOut += row.givenOut;
  }
  const monthlyBreakdown = Object.values(monthlyMap)
    .sort((a, b) => a.month.localeCompare(b.month));

  // ── Chart datasets ───────────────────────────────────────────────────────
  const outputTrend = productionRows.map(r => ({
    date:     r.dateStr,
    output:   r.totalOutput,
    batches:  r.batchCount,
    weightKg: r.weightKg,
  }));

  const givenOutTrend = parsed
    .filter(r => r.givenOut > 0)
    .map(r => ({
      date:          r.dateStr,
      givenOut:      r.givenOut,
      hadProduction: r.isProductionDay,
    }));

  const tempTrend = productionRows
    .filter(r => r.avgTemp !== null)
    .map(r => ({ date: r.dateStr, avgTemp: r.avgTemp }));

  // ── Anomaly engine ───────────────────────────────────────────────────────
  const anomalies = detectAnomalies(parsed, productionRows, { totalGivenOut });

  // ── Inventory calculations ──────────────────────────────────────────────
  const inventoryBalance = buildInventoryBalance(parsed);
  const inventoryTrend = calculateInventoryTrend(inventoryBalance);
  const negativeStockPeriods = detectNegativeStockPeriods(inventoryBalance);

  // ── Executive summary ────────────────────────────────────────────────────
  const executiveSummary = buildExecutiveSummary({
    totalProductionDays,
    totalOutput,
    totalGivenOut,
    avgOutputPerBatch,
    totalBatches,
    totalWeightKg,
    netStockMovement,
    anomalies,
    monthlyBreakdown,
    firstProductionDate: productionRows.length > 0 ? productionRows[0].dateStr : null,
    lastProductionDate:  productionRows.length > 0 ? productionRows[productionRows.length - 1].dateStr : null,
  });

  return {
    kpis: {
      totalProductionDays,
      totalBatches,
      totalOutput,
      totalGivenOut,
      avgOutputPerBatch,
      avgTemp,
      totalWeightKg,
      netStockMovement,
      inventoryTrend,
    },
    monthlyBreakdown,
    charts: { outputTrend, givenOutTrend, tempTrend, inventoryBalance },
    anomalies: {
      ...anomalies,
      inventoryAnomalies: { negativeStockPeriods },
    },
    executiveSummary,
  };
}

// ─── Anomaly Detection ────────────────────────────────────────────────────────

function detectAnomalies(allRows, productionRows, { totalGivenOut }) {
  // 1. Incomplete production days — weight run but output = 0 (placeholder entry)
  const incompleteProductionDays = productionRows
    .filter(r => r.incompleteOutput)
    .map(r => ({
      date:     r.dateStr,
      weightKg: r.weightKg,
      batches:  r.batchCount,
      avgTemp:  r.avgTemp,
    }));

  // 2. Production gaps — ≥7 consecutive non-production days
  const productionGaps = [];
  let gapStart = null;
  let gapCount  = 0;

  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    if (!row.isProductionDay) {
      if (gapStart === null) {
        gapStart = row.dateStr;
        gapCount = 1;
      } else {
        gapCount++;
      }
    } else {
      if (gapStart !== null && gapCount >= 7) {
        productionGaps.push({
          start:   gapStart,
          end:     allRows[i - 1].dateStr,
          days:    gapCount,
          ongoing: false,
        });
      }
      gapStart = null;
      gapCount = 0;
    }
  }
  // Trailing gap at end of dataset
  if (gapStart !== null && gapCount >= 7) {
    productionGaps.push({
      start:   gapStart,
      end:     allRows[allRows.length - 1].dateStr,
      days:    gapCount,
      ongoing: true,
    });
  }

  // 3. Distribution anomalies — givenOut > 2.5× average across active distribution days
  const activeDays       = allRows.filter(r => r.givenOut > 0);
  const avgDailyGivenOut = activeDays.length > 0 ? totalGivenOut / activeDays.length : 0;
  const distributionAnomalies = allRows
    .filter(r => r.givenOut > 0 && r.givenOut > avgDailyGivenOut * 2.5)
    .map(r => ({
      date:            r.dateStr,
      givenOut:        r.givenOut,
      sameDayOutput:   r.totalOutput,
      excessFromStock: Math.max(0, r.givenOut - r.totalOutput),
    }));

  // 4. Missing temperature readings on production days
  const missingTempDays = productionRows
    .filter(r => r.avgTemp === null)
    .map(r => ({ date: r.dateStr }));

  // 5. Peak production day
  let peakDay = null;
  if (productionRows.length > 0) {
    const best = productionRows.reduce((b, r) => r.totalOutput > b.totalOutput ? r : b, productionRows[0]);
    peakDay = {
      date:     best.dateStr,
      output:   best.totalOutput,
      batches:  best.batchCount,
      weightKg: best.weightKg,
    };
  }

  // 6. Longest consecutive production streak (calendar-day basis)
  let longestStreak = null;
  if (productionRows.length > 0) {
    let maxLen   = 1, curLen = 1;
    let curStart = productionRows[0].dateStr;
    let maxStart = productionRows[0].dateStr;
    let maxEnd   = productionRows[0].dateStr;

    for (let i = 1; i < productionRows.length; i++) {
      const dayDiff = Math.round(
        (productionRows[i].date - productionRows[i - 1].date) / 86400000
      );
      if (dayDiff === 1) {
        curLen++;
      } else {
        curLen   = 1;
        curStart = productionRows[i].dateStr;
      }
      if (curLen > maxLen) {
        maxLen   = curLen;
        maxStart = curStart;
        maxEnd   = productionRows[i].dateStr;
      }
    }
    longestStreak = { start: maxStart, end: maxEnd, days: maxLen };
  }

  return {
    incompleteProductionDays,
    productionGaps,
    distributionAnomalies,
    missingTempDays,
    highlights: { peakDay, longestStreak },
  };
}

// ─── Executive Summary Builder ────────────────────────────────────────────────

function buildExecutiveSummary({
  totalProductionDays, totalOutput, totalGivenOut, avgOutputPerBatch,
  totalBatches, totalWeightKg, netStockMovement, anomalies, monthlyBreakdown,
  firstProductionDate, lastProductionDate,
}) {
  const lines = [];
  const range = firstProductionDate
    ? `${firstProductionDate} – ${lastProductionDate}`
    : 'N/A';

  lines.push(
    `${totalProductionDays} production days completed (${range}).`
  );
  lines.push(
    `${totalBatches} batches — ${totalWeightKg.toLocaleString()} kg of raw material processed.`
  );
  lines.push(
    `${totalOutput.toLocaleString()} bags produced. ` +
    `${totalGivenOut.toLocaleString()} units distributed. ` +
    `Net stock change: ${netStockMovement >= 0 ? '+' : ''}${netStockMovement.toLocaleString()} units.`
  );
  lines.push(`Average output: ${avgOutputPerBatch} units per batch.`);

  if (monthlyBreakdown.length > 0) {
    const best = monthlyBreakdown.reduce((b, m) => m.output > b.output ? m : b);
    lines.push(
      `Strongest month: ${formatMonth(best.month)} — ${best.output} bags across ${best.productionDays} production days.`
    );
  }

  if (anomalies.highlights.longestStreak) {
    const s = anomalies.highlights.longestStreak;
    lines.push(
      `Longest production streak: ${s.days} consecutive days (${s.start} – ${s.end}).`
    );
  }

  if (anomalies.productionGaps.length > 0) {
    const longest = anomalies.productionGaps.reduce((a, b) => a.days > b.days ? a : b);
    const suffix  = longest.ongoing ? ' — ongoing' : '';
    lines.push(
      `⚠ Longest production gap: ${longest.days} days (${longest.start} → ${longest.end}${suffix}).`
    );
  }

  if (anomalies.incompleteProductionDays.length > 0) {
    const n     = anomalies.incompleteProductionDays.length;
    const dates = anomalies.incompleteProductionDays.map(d => d.date).join(', ');
    lines.push(
      `⚠ ${n} incomplete production entr${n === 1 ? 'y' : 'ies'} — weight run, no output recorded: ${dates}.`
    );
  }

  return lines;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMonth(yyyyMM) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [, mm] = yyyyMM.split('-');
  return months[parseInt(mm, 10) - 1] + ' ' + yyyyMM.slice(0, 4);
}

// ─── Inventory Calculations ──────────────────────────────────────────────────

function buildInventoryBalance(parsed) {
  let cumulative = 0;
  const result = [];

  for (const row of parsed) {
    cumulative += (row.totalOutput - row.givenOut);
    result.push({
      date: row.dateStr,
      cumulative: cumulative,
      produced: row.totalOutput,
      distributed: row.givenOut,
    });
  }

  return result;
}

function calculateInventoryTrend(inventoryBalance) {
  if (inventoryBalance.length === 0) {
    return 'stable';
  }

  // Compare first third, middle third, last third to determine trend
  // If recent cumulative > older cumulative → improving
  // If recent cumulative < older cumulative → declining
  // If relatively flat → stable

  const len = inventoryBalance.length;
  const firstVal = inventoryBalance[0].cumulative;
  const midVal = inventoryBalance[Math.floor(len / 2)].cumulative;
  const lastVal = inventoryBalance[len - 1].cumulative;

  // Calculate trend slopes
  // Improving: cumulative increasing overall
  // Declining: cumulative decreasing overall
  // Stable: relatively flat

  const overallChange = lastVal - firstVal;
  const threshold = Math.abs(firstVal) * 0.1; // 10% of starting absolute value

  if (overallChange > threshold) {
    return 'improving';
  } else if (overallChange < -threshold) {
    return 'declining';
  } else {
    return 'stable';
  }
}

function detectNegativeStockPeriods(inventoryBalance) {
  const periods = [];
  let periodStart = null;
  let minStock = 0;

  for (let i = 0; i < inventoryBalance.length; i++) {
    const bal = inventoryBalance[i];

    if (bal.cumulative < 0) {
      if (periodStart === null) {
        periodStart = i;
        minStock = bal.cumulative;
      } else {
        minStock = Math.min(minStock, bal.cumulative);
      }
    } else {
      if (periodStart !== null) {
        periods.push({
          startDate: inventoryBalance[periodStart].date,
          endDate: inventoryBalance[i - 1].date,
          minStock: minStock,
          days: i - periodStart,
        });
        periodStart = null;
        minStock = 0;
      }
    }
  }

  // Trailing negative period (ends at last data point)
  if (periodStart !== null) {
    periods.push({
      startDate: inventoryBalance[periodStart].date,
      endDate: inventoryBalance[inventoryBalance.length - 1].date,
      minStock: minStock,
      days: inventoryBalance.length - periodStart,
    });
  }

  return periods;
}

function emptyResult() {
  return {
    kpis: {
      totalProductionDays: 0, totalBatches: 0, totalOutput: 0,
      totalGivenOut: 0, avgOutputPerBatch: 0, avgTemp: null,
      totalWeightKg: 0, netStockMovement: 0,
      inventoryTrend: 'stable',
    },
    monthlyBreakdown: [],
    charts: { outputTrend: [], givenOutTrend: [], tempTrend: [], inventoryBalance: [] },
    anomalies: {
      incompleteProductionDays: [], productionGaps: [],
      distributionAnomalies: [], missingTempDays: [],
      highlights: { peakDay: null, longestStreak: null },
      inventoryAnomalies: { negativeStockPeriods: [] },
    },
    executiveSummary: ['No production data available.'],
  };
}

module.exports = { processProduction };
