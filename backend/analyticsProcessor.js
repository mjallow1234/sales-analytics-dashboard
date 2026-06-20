// Data processing logic

/**
 * Process sales rows fetched from Google Sheets.
 * @param {Array<Array<any>>} data - raw rows, first row is headers
 * @returns {Object} metrics
 */
// normalize agent names for consistent keys
function normalizeAgentName(name) {
  if (!name) return 'Unknown';
  return name
    .toString()
    .trim()
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function calculateDaysSince(lastPurchaseDate, currentDate) {
  if (!lastPurchaseDate) return Infinity;
  const last = new Date(lastPurchaseDate);
  const current = new Date(currentDate);
  const diffTime = current.getTime() - last.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

function generateCustomerIntelligence(allTimeStats, filteredStats, currentDate) {
  // Calculate activity status and days since for all-time metrics
  const allCustomers = [];
  let atRiskCount = 0;
  let lostCount = 0;
  let dormantRevenue = 0;
  const loyalByAllTime = [];

  Object.entries(allTimeStats).forEach(([phone, allStats]) => {
    const filtered = filteredStats[phone] || { purchases: 0, spent: 0, lastPurchaseDate: null };
    
    // All-time calculations
    const daysSinceLastPurchase = calculateDaysSince(allStats.lastPurchaseDate, currentDate);
    let activityStatus = 'Never'; // Default for no purchases
    if (daysSinceLastPurchase !== Infinity) {
      if (daysSinceLastPurchase <= 30) {
        activityStatus = 'Active';
      } else if (daysSinceLastPurchase > 30 && daysSinceLastPurchase <= 90) {
        activityStatus = 'At Risk';
        atRiskCount++;
      } else if (daysSinceLastPurchase > 90) {
        activityStatus = 'Lost';
        lostCount++;
        dormantRevenue += allStats.spent;
      }
    }

    // Filtered period calculations
    let filteredRecurringStatus = 'New';
    if (filtered.purchases >= 5) {
      filteredRecurringStatus = 'Loyal';
    } else if (filtered.purchases >= 2) {
      filteredRecurringStatus = 'Returning';
    }

    const customer = {
      name: allStats.name,
      phone,
      location: allStats.location || 'Unknown',
      
      // Filtered period metrics
      filteredOrders: filtered.purchases,
      filteredRevenue: filtered.spent,
      filteredRecurringStatus,
      
      // All-time metrics
      allTimeOrders: allStats.purchases,
      allTimeRevenue: allStats.spent,
      allTimeLastPurchaseDate: allStats.lastPurchaseDate,
      daysSinceLastPurchase: daysSinceLastPurchase === Infinity ? null : daysSinceLastPurchase,
      activityStatus,
      
      // Customer lifetime value
      customerLifetimeValue: allStats.spent
    };

    allCustomers.push(customer);

    // Track loyal customers for summary
    if (allStats.purchases >= 5) {
      loyalByAllTime.push({
        name: allStats.name,
        phone,
        allTimeOrders: allStats.purchases,
        allTimeRevenue: allStats.spent
      });
    }
  });

  // Sort for rankings and summaries
  allCustomers.sort((a, b) => b.filteredRevenue - a.filteredRevenue);
  loyalByAllTime.sort((a, b) => b.allTimeRevenue - a.allTimeRevenue);
  const topLoyalCustomers = loyalByAllTime.slice(0, 5);

  // Add rank to all customers
  allCustomers.forEach((customer, index) => {
    customer.rank = index + 1;
  });

  // Calculate KPIs
  const totalCustomersFiltered = Object.keys(filteredStats).length;
  let repeatCustomersFiltered = 0;
  let loyalCustomersFiltered = 0;
  let activeCustomersCount = 0;

  Object.values(filteredStats).forEach(stats => {
    if (stats.purchases > 1) repeatCustomersFiltered++;
    if (stats.purchases >= 5) loyalCustomersFiltered++;
  });

  // Count active customers (all-time basis)
  allCustomers.forEach(customer => {
    if (customer.activityStatus === 'Active') {
      activeCustomersCount++;
    }
  });

  return {
    kpis: {
      totalCustomers: totalCustomersFiltered,
      repeatCustomers: repeatCustomersFiltered,
      loyalCustomers: loyalCustomersFiltered,
      activeCustomersCount: activeCustomersCount,
      atRiskCustomers: atRiskCount,
      lostCustomersCount: lostCount,
      dormantRevenue: dormantRevenue
    },
    allCustomers,
    topLoyalCustomers
  };
}

function processSales(data, filters = {}) {
  const { startDate, endDate, agent: filterAgent } = filters;

  // Debug logging for date filtering
  console.log('Date filter:', startDate, '→', endDate);

  let normalizedAgent;
  if (filterAgent) {
    normalizedAgent = normalizeAgentName(filterAgent);
  }

  if (!Array.isArray(data) || data.length === 0) {
    return {
      totalSales: 0,
      totalRevenue: 0,
      totalCustomers: 0,
      revenueByAgent: {},
      customerIntelligence: {
        kpis: {
          totalCustomers: 0,
          repeatCustomers: 0,
          loyalCustomers: 0,
          atRiskCustomers: 0,
          lostCustomersCount: 0,
          dormantRevenue: 0
        },
        allCustomers: [],
        topLoyalCustomers: []
      }
    };
  }

  const headers = data[0];
  const phoneIdx = headers.indexOf('Phone');
  const amountIdx = headers.indexOf('Amount');
  const agentIdx = headers.indexOf('Agent');
  const nameIdx = headers.indexOf('Name');
  const dateIdx = headers.indexOf('Date');
  const productIdx = headers.indexOf('Product');
  const quantityIdx = headers.indexOf('Quantity');
  const locationIdx = headers.indexOf('Address');

  const rows = data.slice(1); // skip header
  console.log('Rows before filter:', rows.length);

  // ===== FIRST PASS: ALL-TIME METRICS (No filters) =====
  const allTimeStats = {};
  rows.forEach((row) => {
    const phone = phoneIdx >= 0 ? row[phoneIdx] : undefined;
    if (!phone) return;

    const name = nameIdx >= 0 ? row[nameIdx] || 'Unknown' : 'Unknown';
    let amountStr = amountIdx >= 0 ? row[amountIdx] : '';
    amountStr = String(amountStr).replace(/[^0-9.\-]/g, '');
    let amount = parseFloat(amountStr);
    if (isNaN(amount)) amount = 0;

    const validAmount = amount > 0 && amount <= 100000;
    const location = locationIdx >= 0 ? (row[locationIdx] || '').toString().trim() : 'Unknown';
    
    let rowDateParsed = null;
    if (dateIdx >= 0) {
      const raw = row[dateIdx];
      if (raw) {
        const parsed = new Date(raw);
        if (!isNaN(parsed.getTime())) {
          rowDateParsed = parsed;
        }
      }
    }

    if (!allTimeStats[phone]) {
      allTimeStats[phone] = {
        name,
        purchases: 0,
        spent: 0,
        lastPurchaseDate: null,
        location: location
      };
    }

    allTimeStats[phone].purchases += 1;
    if (validAmount) {
      allTimeStats[phone].spent += amount;
    }

    // Update most recent location
    if (location !== 'Unknown') {
      allTimeStats[phone].location = location;
    }

    // Track most recent date
    if (rowDateParsed) {
      if (!allTimeStats[phone].lastPurchaseDate) {
        allTimeStats[phone].lastPurchaseDate = rowDateParsed.toISOString().split('T')[0];
      } else {
        const existingDate = new Date(allTimeStats[phone].lastPurchaseDate);
        if (rowDateParsed > existingDate) {
          allTimeStats[phone].lastPurchaseDate = rowDateParsed.toISOString().split('T')[0];
        }
      }
    }
  });

  // ===== SECOND PASS: FILTERED-PERIOD METRICS (With filters) =====
  const revenueByAgent = {};
  const phones = new Set();

  let totalSales = 0;
  let totalRevenue = 0;

  // revenue growth tracking
  let previousRevenue = 0;
  let currentRevenue = 0;

  // prepare filter period boundaries for growth
  const filterStartDate = startDate ? new Date(startDate) : null;
  const filterEndDate = endDate ? new Date(endDate) : new Date();
  let periodDiff = null;
  let previousStart = null;
  let previousEnd = null;
  if (filterStartDate) {
    periodDiff = filterEndDate.getTime() - filterStartDate.getTime();
    previousEnd = filterStartDate;
    previousStart = new Date(filterStartDate.getTime() - (periodDiff || 0));
  }

  // track per-customer stats (filtered period)
  const filteredStats = {};
  // track daily sales
  const salesOverTime = {};
  // track daily revenue
  const revenueOverTime = {};
  // track sales by product
  const salesByProduct = {};
  // track revenue by location
  const revenueByLocation = {};

  rows.forEach((row) => {
    // parse date once for filtering and growth
    let rowDateParsed = null;
    if (dateIdx >= 0) {
      const raw = row[dateIdx];
      if (raw) {
        const parsed = new Date(raw);
        if (!isNaN(parsed.getTime())) {
          rowDateParsed = parsed;
        }
      }
    }

    // apply filters first (date range and agent)
    if (startDate || endDate) {
      if (!rowDateParsed) {
        return; // no valid date: can't evaluate range
      }
      const rowTime = rowDateParsed.getTime();
      if (startDate) {
        const startTime = new Date(startDate).getTime();
        if (rowTime < startTime) return;
      }
      if (endDate) {
        const endTime = new Date(endDate).getTime();
        if (rowTime > endTime) return;
      }
    }
    if (normalizedAgent) {
      const rowAgent = agentIdx >= 0 ? normalizeAgentName(row[agentIdx]) : '';
      if (rowAgent !== normalizedAgent) return;
    }

    const phone = phoneIdx >= 0 ? row[phoneIdx] : undefined;
    const name = nameIdx >= 0 ? row[nameIdx] || 'Unknown' : 'Unknown';
    let amountStr = amountIdx >= 0 ? row[amountIdx] : '';
    const agentRaw = agentIdx >= 0 ? row[agentIdx] : undefined;
    const agent = normalizeAgentName(agentRaw);

    // strip currency text (e.g. "900.00 GMD") and parse
    amountStr = String(amountStr).replace(/[^0-9.\-]/g, '');
    let amount = parseFloat(amountStr);
    if (isNaN(amount)) {
      amount = 0;
    }

    // aggregate revenue by location
    if (locationIdx >= 0) {
      let location = (row[locationIdx] || '').toString().trim();
      if (!location) {
        location = 'Unknown';
      }
      if (!revenueByLocation[location]) {
        revenueByLocation[location] = 0;
      }
      revenueByLocation[location] += amount;
    }

    const quantity = quantityIdx >= 0 ? (parseInt(row[quantityIdx], 10) || 1) : 1;
    totalSales += quantity;

    // validate amount before counting it as revenue
    const validAmount = amount > 0 && amount <= 100000;
    if (validAmount) {
      totalRevenue += amount;
      if (!revenueByAgent[agent]) {
        revenueByAgent[agent] = 0;
      }
      revenueByAgent[agent] += amount;

      // accumulate growth periods if date is available
      if (rowDateParsed && filterStartDate) {
        if (previousStart && rowDateParsed >= previousStart && rowDateParsed < previousEnd) {
          previousRevenue += amount;
        }
        if (rowDateParsed >= filterStartDate) {
          currentRevenue += amount;
        }
      }
    }

    // track product metrics regardless of amount validity (units still count)
    if (productIdx >= 0) {
      // normalize product names: trim, lowercase, map known values, and default
      let product = (row[productIdx] || '').toString().trim();
      product = product.toLowerCase();
      if (product === 'deygeh') {
        product = 'Deygeh';
      }
      if (!product) {
        product = 'Unknown';
      }
      const qty = quantityIdx >= 0 ? parseFloat(row[quantityIdx]) || 1 : 1;
      if (!salesByProduct[product]) {
        salesByProduct[product] = { units: 0, revenue: 0 };
      }
      salesByProduct[product].units += qty;
      if (validAmount) {
        salesByProduct[product].revenue += amount;
      }
    }

    if (phone !== undefined) phones.add(phone);

    // count sale for the given date
    if (dateIdx >= 0) {
      const dateRaw = row[dateIdx];
      if (dateRaw) {
        const parsedDate = new Date(dateRaw);
        if (!isNaN(parsedDate.getTime())) {
          const date = parsedDate.toISOString().split('T')[0];
          salesOverTime[date] = (salesOverTime[date] || 0) + quantity;
          if (amount > 0 && amount <= 100000) {
            revenueOverTime[date] = (revenueOverTime[date] || 0) + amount;
          };
        }
      }
    }

    // update filtered-period customer stats
    if (phone !== undefined) {
      if (!filteredStats[phone]) {
        filteredStats[phone] = { purchases: 0, spent: 0, lastPurchaseDate: null };
      }
      filteredStats[phone].purchases += 1;
      if (validAmount) {
        filteredStats[phone].spent += amount;
      }
      // Track most recent date in filtered period
      if (rowDateParsed) {
        if (!filteredStats[phone].lastPurchaseDate) {
          filteredStats[phone].lastPurchaseDate = rowDateParsed.toISOString().split('T')[0];
        } else {
          const existingDate = new Date(filteredStats[phone].lastPurchaseDate);
          if (rowDateParsed > existingDate) {
            filteredStats[phone].lastPurchaseDate = rowDateParsed.toISOString().split('T')[0];
          }
        }
      }
    }
  });

  console.log('Rows after filter:', totalSales, '(sales counted)');

  // compute customer-level metrics for filtered period
  let repeatCustomers = 0;
  const topCustomersArray = [];
  for (const [phone, stats] of Object.entries(filteredStats)) {
    if (stats.purchases > 1) repeatCustomers += 1;
    topCustomersArray.push({
      name: allTimeStats[phone]?.name || 'Unknown',
      phone,
      purchases: stats.purchases,
      totalSpent: stats.spent
    });
  }

  topCustomersArray.sort((a, b) => b.totalSpent - a.totalSpent);
  const topCustomers = topCustomersArray.slice(0, 5);

  // purchase frequency distribution (filtered period)
  const purchaseDistribution = {
    onePurchase: 0,
    twoPurchases: 0,
    threePlusPurchases: 0,
  };
  Object.values(filteredStats).forEach(stats => {
    if (stats.purchases === 1) purchaseDistribution.onePurchase++;
    else if (stats.purchases === 2) purchaseDistribution.twoPurchases++;
    else if (stats.purchases >= 3) purchaseDistribution.threePlusPurchases++;
  });

  // calculate revenue growth percentage
  let revenueGrowth = 0;
  if (previousRevenue > 0) {
    revenueGrowth = ((currentRevenue - previousRevenue) / previousRevenue) * 100;
  }

  // leaderboard of agents by total revenue (descending)
  const agentLeaderboard = Object.entries(revenueByAgent)
    .map(([agent, revenue]) => ({ agent, revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  // --- Anomaly detection, trends, recommendations ---
  const now = new Date();
  const last3Start = new Date(now);
  last3Start.setDate(now.getDate() - 3);
  const last7Start = new Date(now);
  last7Start.setDate(now.getDate() - 7);
  const prev7Start = new Date(now);
  prev7Start.setDate(now.getDate() - 14);

  let last3DaysRevenue = 0;
  let last3DaysSales = 0;
  let last7DaysRevenue = 0;
  let previous7DaysRevenue = 0;
  let last7DaysSales = 0;
  let previous7DaysSales = 0;

  Object.entries(revenueOverTime).forEach(([date, value]) => {
    const d = new Date(date);
    if (d >= last3Start) last3DaysRevenue += value;
    if (d >= last7Start) last7DaysRevenue += value;
    else if (d >= prev7Start) previous7DaysRevenue += value;
  });

  Object.entries(salesOverTime).forEach(([date, count]) => {
    const d = new Date(date);
    if (d >= last3Start) last3DaysSales += count;
    if (d >= last7Start) last7DaysSales += count;
    else if (d >= prev7Start) previous7DaysSales += count;
  });

  const totalCustomers = phones.size;
  const topAgentEntry = agentLeaderboard[0];
  const topAgentName = topAgentEntry ? topAgentEntry.agent : 'N/A';
  const topAgentRevenue = topAgentEntry ? topAgentEntry.revenue : 0;

  const locEntries = Object.entries(revenueByLocation).sort((a, b) => b[1] - a[1]);
  const topLocationName = locEntries[0] ? locEntries[0][0] : 'N/A';
  const topLocationRevenue = locEntries[0] ? locEntries[0][1] : 0;

  // Anomalies
  const anomalies = [];
  if (previous7DaysRevenue > 0 && last7DaysRevenue < previous7DaysRevenue * 0.8) {
    anomalies.push('\u26a0 Revenue dropped more than 20% compared to last week');
  }
  if (previous7DaysSales > 0 && last7DaysSales > previous7DaysSales * 1.3) {
    anomalies.push('\ud83d\ude80 Sales increased sharply this week');
  }
  if (totalRevenue > 0 && topAgentRevenue / totalRevenue > 0.5) {
    anomalies.push(`\ud83d\udd25 ${topAgentName} is generating over 50% of total revenue`);
  }

  // Trends
  const trends = [];
  if (previous7DaysRevenue > 0) {
    const growthRate = ((last7DaysRevenue - previous7DaysRevenue) / previous7DaysRevenue) * 100;
    if (growthRate > 10) {
      trends.push(`\ud83d\udcc8 Revenue is growing at ${growthRate.toFixed(1)}%`);
    } else if (growthRate < -10) {
      trends.push(`\ud83d\udcc9 Revenue is declining at ${Math.abs(growthRate).toFixed(1)}%`);
    }
  }
  if (totalCustomers > 0) {
    if (repeatCustomers / totalCustomers > 0.3) {
      trends.push('\ud83d\udc8e High repeat customer rate \u2014 strong retention');
    } else {
      trends.push('\u26a0 Low repeat customers \u2014 retention needs improvement');
    }
  }

  // Recommendations
  const recommendations = [];
  if (previous7DaysRevenue > 0 && last7DaysRevenue < previous7DaysRevenue) {
    recommendations.push('\ud83d\udc49 Increase promotions or agent incentives to boost short-term sales');
  }
  if (totalRevenue > 0 && topAgentRevenue / totalRevenue > 0.5) {
    recommendations.push('\ud83d\udc49 Distribute leads more evenly across agents to reduce dependency risk');
  }
  if (totalCustomers > 0 && repeatCustomers / totalCustomers < 0.2) {
    recommendations.push('\ud83d\udc49 Introduce loyalty offers to improve repeat purchases');
  }

  // Generate customer intelligence
  const currentDate = new Date().toISOString().split('T')[0];
  const customerIntelligence = generateCustomerIntelligence(allTimeStats, filteredStats, currentDate);

  return {
    totalSales,
    totalRevenue,
    totalCustomers: phones.size,
    revenueByAgent,
    agentLeaderboard,
    repeatCustomers,
    topCustomers,
    purchaseDistribution,
    salesOverTime,
    revenueOverTime,
    salesByProduct,
    revenueByLocation,
    revenueGrowth,
    last3DaysRevenue,
    last3DaysSales,
    last7DaysRevenue,
    last7DaysSales,
    previous7DaysRevenue,
    topAgent: topAgentEntry ? { name: topAgentName, revenue: topAgentRevenue } : null,
    topLocation: locEntries[0] ? { name: topLocationName, revenue: topLocationRevenue } : null,
    anomalies,
    trends,
    recommendations,
    intelligenceBrief: [...anomalies, ...trends, ...recommendations],
    customerIntelligence
  };
}

module.exports = { processSales };
