// server entry point

const express = require('express');
const cors = require('cors');

const { getSalesData } = require('./sheetsService');
const { processSales } = require('./analyticsProcessor');

const app = express();
app.use(cors());

app.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`
    );
  });

  next();
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'sales-analytics-dashboard',
    timestamp: new Date().toISOString(),
  });
});

const analyticsCache = new Map();
const CACHE_TTL = 300000; // 5 minutes

app.get('/analytics', async (req, res) => {
  console.log('Analytics request received');
  try {
    const { startDate, endDate, agent } = req.query;
    const cacheKey = JSON.stringify({ startDate, endDate, agent });

    // Serve from cache if recent
    const cached = analyticsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log('Using cached analytics for', cacheKey);
      return res.json(cached.data);
    }

    console.log('Refreshing analytics for', cacheKey);
    const rows = await getSalesData();
    const analytics = processSales(rows, { startDate, endDate, agent });

    analyticsCache.set(cacheKey, { data: analytics, timestamp: Date.now() });

    res.json(analytics);
  } catch (error) {
    console.error('Analytics endpoint error:', error);
    res.status(500).json({
      error: 'Analytics service unavailable',
      message: 'Failed to retrieve analytics data'
    });
  }
});

app.use(express.json());

function parseQuery(question) {
  const q = question.toLowerCase();

  return {
    metric: q.includes('revenue') || q.includes('money') ? 'revenue'
          : q.includes('sales') ? 'sales'
          : null,

    period: q.includes('3 day') ? '3d'
          : q.includes('7 day') ? '7d'
          : q.includes('month') ? 'month'
          : q.includes('year') ? 'year'
          : 'all',

    type: q.includes('top') ? 'top'
         : q.includes('trend') ? 'trend'
         : q.includes('compare') ? 'compare'
         : 'summary'
  };
}

app.post('/ai-query', async (req, res) => {
  const { question, context, type } = req.body;

  console.log('AI TYPE:', type); // DEBUG

  if (!question && !type) {
    return res.status(400).json({ error: 'Question or type is required' });
  }

  try {
    const ctx = typeof context === 'string' ? JSON.parse(context) : (context || {});

    // Read precomputed values — no recomputation
    const last3DaysRevenue = ctx.last3DaysRevenue || 0;
    const last3DaysSales = ctx.last3DaysSales || 0;
    const last7DaysRevenue = ctx.last7DaysRevenue || 0;
    const last7DaysSales = ctx.last7DaysSales || 0;
    const previous7DaysRevenue = ctx.previous7DaysRevenue || 0;
    const topAgent = ctx.topAgent || { name: 'N/A', revenue: 0 };
    const topLocation = ctx.topLocation || { name: 'N/A', revenue: 0 };
    const anomalies = ctx.anomalies || [];
    const trends = ctx.trends || [];

    // Type-specific instant explanations (no AI dependency)
    if (type) {
      if (type === 'revenue_drop') {
        return res.json({
          answer: `Revenue dropped because total revenue in the last 7 days (${last7DaysRevenue.toLocaleString()} GMD) is lower than the previous 7 days (${previous7DaysRevenue.toLocaleString()} GMD). This indicates reduced sales activity, fewer transactions, or lower order values.`
        });
      }

      if (type === 'agent_dominance') {
        return res.json({
          answer: `One agent (${topAgent.name}) is generating over 50% of total revenue (${topAgent.revenue.toLocaleString()} GMD out of ${(ctx.totalRevenue || 0).toLocaleString()} GMD), meaning sales are heavily dependent on a single performer. This creates risk if that agent becomes inactive.`
        });
      }

      if (type === 'sales_spike') {
        return res.json({
          answer: `Sales increased sharply — last 7 days saw ${last7DaysSales} sales generating ${last7DaysRevenue.toLocaleString()} GMD vs previous 7 days at ${previous7DaysRevenue.toLocaleString()} GMD. This could indicate a successful promotion, seasonal demand, or new customer acquisition.`
        });
      }

      if (type === 'low_retention') {
        return res.json({
          answer: `Low repeat customers means most buyers are not returning. Only ${ctx.repeatCustomers || 0} out of ${ctx.totalCustomers || 0} customers are repeat buyers. This indicates weak customer retention and lack of loyalty.`
        });
      }

      return res.json({
        answer: 'Insight available but no detailed explanation configured.'
      });
    }

    // Parse question intent
    const parsed = parseQuery(question);

    // FAST ENGINE — instant lookups from precomputed data

    if (parsed.period === '3d' && parsed.metric === 'revenue') {
      return res.json({
        answer: `In the last 3 days, you made ${last3DaysRevenue.toLocaleString()} GMD.`
      });
    }

    if (parsed.period === '7d' && parsed.metric === 'revenue') {
      return res.json({
        answer: `In the last 7 days, you made ${last7DaysRevenue.toLocaleString()} GMD.`
      });
    }

    if (parsed.period === '3d') {
      return res.json({
        answer: `In the last 3 days, you made ${last3DaysRevenue.toLocaleString()} GMD from ${last3DaysSales} sales.`
      });
    }

    if (parsed.period === '7d') {
      return res.json({
        answer: `In the last 7 days, you made ${last7DaysRevenue.toLocaleString()} GMD from ${last7DaysSales} sales.`
      });
    }

    if (parsed.type === 'top' && parsed.metric === 'revenue') {
      return res.json({
        answer: `${topAgent.name} is your top agent generating ${topAgent.revenue.toLocaleString()} GMD.`
      });
    }

    if (parsed.type === 'top' && question.toLowerCase().includes('location')) {
      return res.json({
        answer: `${topLocation.name} is your top location generating ${topLocation.revenue.toLocaleString()} GMD.`
      });
    }

    if (parsed.type === 'top') {
      return res.json({
        answer: `${topAgent.name} is your top agent with ${topAgent.revenue.toLocaleString()} GMD in revenue.`
      });
    }

    // Summary / performance
    if (parsed.type === 'summary') {
      return res.json({
        answer: `You have generated ${(ctx.totalRevenue || 0).toLocaleString()} GMD from ${ctx.totalSales || 0} sales. Top agent is ${topAgent.name} and top location is ${topLocation.name}.`
      });
    }

    // Trend / why questions — instant backend answers
    if (parsed.type === 'trend' || question.toLowerCase().includes('why')) {
      const parts = [];
      if (anomalies.length > 0) parts.push('Anomalies: ' + anomalies.join('. '));
      if (trends.length > 0) parts.push('Trends: ' + trends.join('. '));
      if (parts.length === 0) parts.push('No significant anomalies or trends detected.');

      return res.json({
        answer: `Based on your data: ${parts.join(' | ')} Total revenue is ${(ctx.totalRevenue || 0).toLocaleString()} GMD with ${last7DaysRevenue.toLocaleString()} GMD in the last 7 days.`
      });
    }

    // Default fallback
    res.json({
      answer: `You have generated ${(ctx.totalRevenue || 0).toLocaleString()} GMD from ${ctx.totalSales || 0} sales. Top agent is ${topAgent.name} and top location is ${topLocation.name}.`
    });
  } catch (error) {
    console.error('AI query error:', error);
    res.json({ answer: '\u26a0 Something went wrong. Please try again.' });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Analytics server running on port ${PORT}`);
});
