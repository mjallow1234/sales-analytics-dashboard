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

function processSales(data, filters = {}) {
  const { startDate, endDate, agent: filterAgent } = filters;
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

  // track per-customer stats
  const customerStats = {};
  // track daily sales
  const salesOverTime = {};
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

    totalSales += 1;

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
          if (!salesOverTime[date]) {
            salesOverTime[date] = 0;
          }
          salesOverTime[date]++;
        }
      }
    }

    // update customer stats regardless of amount validity
    if (phone !== undefined) {
      if (!customerStats[phone]) {
        customerStats[phone] = { name, purchases: 0, totalSpent: 0 };
      }
      customerStats[phone].purchases += 1;
      if (validAmount) {
        customerStats[phone].totalSpent += amount;
      }
    }
  });

  // compute customer-level metrics
  let repeatCustomers = 0;
  const topCustomersArray = [];
  for (const [phone, stats] of Object.entries(customerStats)) {
    if (stats.purchases > 1) repeatCustomers += 1;
    topCustomersArray.push({ name: stats.name, phone, purchases: stats.purchases, totalSpent: stats.totalSpent });
  }

  topCustomersArray.sort((a, b) => b.totalSpent - a.totalSpent);
  const topCustomers = topCustomersArray.slice(0, 5);

  // purchase frequency distribution
  const purchaseDistribution = {
    onePurchase: 0,
    twoPurchases: 0,
    threePlusPurchases: 0,
  };
  Object.values(customerStats).forEach(cust => {
    if (cust.purchases === 1) purchaseDistribution.onePurchase++;
    else if (cust.purchases === 2) purchaseDistribution.twoPurchases++;
    else if (cust.purchases >= 3) purchaseDistribution.threePlusPurchases++;
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
    salesByProduct,
    revenueByLocation,
    revenueGrowth,
  };
}

module.exports = { processSales };
