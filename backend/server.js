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
  if (!question) {
    return res.status(400).json({ error: 'Question is required' });
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

    // Type-specific anomaly explanations
    if (type) {
      let prompt = '';

      if (type === 'revenue_drop') {
        prompt = `Revenue dropped.\n\nData:\n- Last 7 days revenue: ${last7DaysRevenue}\n- Previous 7 days revenue: ${previous7DaysRevenue}\n\nExplain WHY this drop might have happened based on sales patterns. Be specific. No guessing numbers.`;
      } else if (type === 'agent_dominance') {
        prompt = `One agent dominates revenue.\n\nData:\n- Top agent: ${topAgent.name}\n- Agent revenue: ${topAgent.revenue}\n- Total revenue: ${ctx.totalRevenue || 0}\n\nExplain risks and implications of this situation.`;
      } else if (type === 'sales_spike') {
        prompt = `Sales increased sharply this week.\n\nData:\n- Last 7 days sales: ${last7DaysSales}\n- Last 7 days revenue: ${last7DaysRevenue}\n- Previous 7 days revenue: ${previous7DaysRevenue}\n\nExplain what might be driving this spike. Be specific.`;
      } else if (type === 'low_retention') {
        prompt = `Low repeat customers detected.\n\nData:\n- Repeat customers: ${ctx.repeatCustomers || 0}\n- Total customers: ${ctx.totalCustomers || 0}\n\nExplain why retention may be low and business impact.`;
      } else {
        prompt = `Explain the sales situation.\n\nData:\n- Total Revenue: ${ctx.totalRevenue || 0}\n- Last 7 Days Revenue: ${last7DaysRevenue}\n- Anomalies: ${anomalies.join('; ') || 'None'}\n- Trends: ${trends.join('; ') || 'None'}\n\nExplain patterns clearly.`;
      }

      try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 5000);

        const response = await fetch('http://localhost:11434/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ model: 'phi3:mini', prompt, stream: false })
        });

        const data = await response.json();
        return res.json({ answer: data.response || 'No insight available' });
      } catch (err) {
        console.error('AI ERROR:', err);
        return res.json({ answer: '\u26a0 Unable to generate explanation right now. Please try again.' });
      }
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

    // AI only for trend analysis or explanatory "why" questions
    if (parsed.type === 'trend' || question.toLowerCase().includes('why')) {
      const prompt = `
You are a senior sales analyst.

DATA:
- Total Revenue: ${ctx.totalRevenue || 0}
- Last 7 Days Revenue: ${last7DaysRevenue}
- Anomalies: ${anomalies.join('; ') || 'None'}
- Trends: ${trends.join('; ') || 'None'}

RULES:
- Do NOT guess
- Do NOT estimate
- Only explain patterns
- Be short and actionable

Question:
${question}
`;

      try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 5000);

        const response = await fetch('http://localhost:11434/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            model: 'phi3:mini',
            prompt,
            stream: false
          })
        });

        const data = await response.json();
        return res.json({
          answer: data.response || 'No insight available'
        });
      } catch (err) {
        console.error('AI ERROR:', err);
        return res.json({
          answer: '\u26a0 Unable to generate explanation right now. Please try again.'
        });
      }
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
