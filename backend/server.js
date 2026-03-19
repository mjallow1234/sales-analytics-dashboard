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

    // Time-based calculations (last 7 days)
    const now = new Date();
    const last7Days = new Date();
    last7Days.setDate(now.getDate() - 7);

    let last7DaysSales = 0;
    let last7DaysRevenue = 0;

    Object.entries(ctx.salesOverTime || {}).forEach(([date, count]) => {
      const d = new Date(date);
      if (d >= last7Days) {
        last7DaysSales += count;
      }
    });

    Object.entries(ctx.revenueOverTime || {}).forEach(([date, revenue]) => {
      const d = new Date(date);
      if (d >= last7Days) {
        last7DaysRevenue += revenue;
      }
    });

    // Extract top agent and location
    const topAgent = Object.entries(ctx.revenueByAgent || {})
      .sort((a, b) => b[1] - a[1])[0];

    const topLocation = Object.entries(ctx.revenueByLocation || {})
      .sort((a, b) => b[1] - a[1])[0];

    // Fast path for common questions (no AI needed)
    if (question.toLowerCase().includes('7 days')) {
      return res.json({
        answer: `In the last 7 days, you made ${last7DaysRevenue.toLocaleString()} GMD from ${last7DaysSales} sales.`
      });
    }

    const summary = `
Total Sales: ${ctx.totalSales}
Total Revenue: ${ctx.totalRevenue}

Last 7 Days:
- Sales: ${last7DaysSales}
- Revenue: ${last7DaysRevenue}

Top Agent:
- ${topAgent?.[0]} (${topAgent?.[1]})

Top Location:
- ${topLocation?.[0]} (${topLocation?.[1]})
`;

    const prompt = `
You are a professional sales analyst.

Use ONLY the data below.
Do NOT say "not enough data" if values exist.
Do NOT guess.

DATA:
${summary}

Answer the question clearly using numbers.

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
      })
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
