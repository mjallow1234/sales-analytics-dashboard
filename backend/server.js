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
  const { question, context } = req.body;
  if (!question) {
    return res.status(400).json({ error: 'Question is required' });
  }

  try {
    const ctx = typeof context === 'string' ? JSON.parse(context) : (context || {});

    // Time-based calculations
    const now = new Date();
    const last3Days = new Date();
    last3Days.setDate(now.getDate() - 3);
    const last7Days = new Date();
    last7Days.setDate(now.getDate() - 7);

    let last3DaysSales = 0;
    let last3DaysRevenue = 0;
    let last7DaysSales = 0;
    let last7DaysRevenue = 0;

    Object.entries(ctx.salesOverTime || {}).forEach(([date, count]) => {
      const d = new Date(date);
      if (d >= last3Days) last3DaysSales += count;
      if (d >= last7Days) last7DaysSales += count;
    });

    Object.entries(ctx.revenueOverTime || {}).forEach(([date, revenue]) => {
      const d = new Date(date);
      if (d >= last3Days) last3DaysRevenue += revenue;
      if (d >= last7Days) last7DaysRevenue += revenue;
    });

    // Extract top agent and location
    const topAgent = Object.entries(ctx.revenueByAgent || {})
      .sort((a, b) => b[1] - a[1])[0];

    const topLocation = Object.entries(ctx.revenueByLocation || {})
      .sort((a, b) => b[1] - a[1])[0];

    // Parse question intent
    const parsed = parseQuery(question);

    // FAST ENGINE — instant backend-computed answers

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
        answer: `${topAgent[0]} is your top agent generating ${topAgent[1].toLocaleString()} GMD.`
      });
    }

    if (parsed.type === 'top' && question.toLowerCase().includes('location')) {
      return res.json({
        answer: `${topLocation[0]} is your top location generating ${topLocation[1].toLocaleString()} GMD.`
      });
    }

    if (parsed.type === 'top') {
      return res.json({
        answer: `${topAgent[0]} is your top agent with ${topAgent[1].toLocaleString()} GMD in revenue.`
      });
    }

    // Monthly analysis
    if (parsed.period === 'month') {
      const monthly = {};
      Object.entries(ctx.revenueOverTime || {}).forEach(([date, value]) => {
        const month = date.slice(0, 7);
        monthly[month] = (monthly[month] || 0) + value;
      });
      const bestMonth = Object.entries(monthly).sort((a, b) => b[1] - a[1])[0];
      if (bestMonth) {
        return res.json({
          answer: `Your best month was ${bestMonth[0]} with ${bestMonth[1].toLocaleString()} GMD in revenue.`
        });
      }
    }

    // Summary / performance
    if (parsed.type === 'summary') {
      return res.json({
        answer: `You have generated ${ctx.totalRevenue.toLocaleString()} GMD from ${ctx.totalSales} sales. Top agent is ${topAgent?.[0]} and top location is ${topLocation?.[0]}.`
      });
    }

    // AI only for trend analysis or explanatory "why" questions
    if (parsed.type === 'trend' || question.toLowerCase().includes('why')) {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 5000);

      const anomalies = ctx.anomalies || [];
      const trends = ctx.trends || [];

      const prompt = `
You are a sales analyst.

You are given REAL computed data:
- Total Revenue: ${ctx.totalRevenue}
- Last 7 Days Revenue: ${last7DaysRevenue}
- Trends: ${trends.join(', ') || 'None'}
- Anomalies: ${anomalies.join(', ') || 'None'}

Rules:
- NEVER guess or estimate
- NEVER invent numbers
- Only explain insights
- Be concise and actionable

Question:
${question}
`;

      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'phi3',
          prompt: prompt,
          stream: false
        }),
        signal: controller.signal
      });

      const data = await response.json();
      return res.json({ answer: data.response });
    }

    // Default fallback — return computed summary
    res.json({
      answer: `You have generated ${ctx.totalRevenue.toLocaleString()} GMD from ${ctx.totalSales} sales. Top agent is ${topAgent?.[0]} and top location is ${topLocation?.[0]}.`
    });
  } catch (error) {
    console.error('AI query error:', error);
    res.status(500).json({ answer: 'Local AI service unavailable. Ensure Ollama is running.' });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Analytics server running on port ${PORT}`);
});
