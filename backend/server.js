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

    // Intent detection
    const q = question.toLowerCase();

    // FAST ENGINE — instant backend-computed answers, no AI

    // Revenue last X days
    if (q.includes('3 day')) {
      return res.json({
        answer: `In the last 3 days, you made ${last3DaysRevenue.toLocaleString()} GMD from ${last3DaysSales} sales.`
      });
    }

    if (q.includes('7 day')) {
      return res.json({
        answer: `In the last 7 days, you made ${last7DaysRevenue.toLocaleString()} GMD from ${last7DaysSales} sales.`
      });
    }

    // Top agent
    if (q.includes('top agent') || q.includes('best agent')) {
      return res.json({
        answer: `${topAgent[0]} is your top agent with ${topAgent[1].toLocaleString()} GMD in revenue.`
      });
    }

    // Top location
    if (q.includes('top location') || q.includes('best location')) {
      return res.json({
        answer: `${topLocation[0]} is your top location generating ${topLocation[1].toLocaleString()} GMD.`
      });
    }

    // Summary
    if (q.includes('summary') || q.includes('sales flow') || q.includes('performance')) {
      return res.json({
        answer: `You have generated ${ctx.totalRevenue.toLocaleString()} GMD from ${ctx.totalSales} sales. Top agent is ${topAgent[0]} and top location is ${topLocation[0]}.`
      });
    }

    // ONLY if nothing matches — fall back to AI with timeout protection
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5000);

    const summary = `
Total Sales: ${ctx.totalSales}
Total Revenue: ${ctx.totalRevenue}
Last 7 Days Revenue: ${last7DaysRevenue}
Top Agent: ${topAgent?.[0]}
Top Location: ${topLocation?.[0]}
`;

    const prompt = `
You are a sales analyst.

STRICT RULES:
- DO NOT assume anything
- DO NOT invent numbers
- DO NOT average or estimate
- ONLY use the provided numbers

DATA:
${summary}

Explain insights clearly.

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
    res.json({ answer: data.response });
  } catch (error) {
    console.error('AI query error:', error);
    res.status(500).json({ answer: 'Local AI service unavailable. Ensure Ollama is running.' });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Analytics server running on port ${PORT}`);
});
