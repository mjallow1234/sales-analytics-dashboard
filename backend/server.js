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

    const topAgents = Object.entries(ctx.revenueByAgent || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, rev]) => `  ${name}: ${rev}`)
      .join('\n');

    const topLocations = Object.entries(ctx.revenueByLocation || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, rev]) => `  ${name}: ${rev}`)
      .join('\n');

    const salesDates = Object.keys(ctx.salesOverTime || {}).sort().slice(-3);
    const recentSales = salesDates
      .map(d => `  ${d}: ${ctx.salesOverTime[d]} units`)
      .join('\n') || '  No recent data';

    const summary = `Total Sales: ${ctx.totalSales || 0}
Total Revenue: ${ctx.totalRevenue || 0}
Repeat Customers: ${ctx.repeatCustomers || 0}

Top 3 Agents:
${topAgents || '  None'}

Top 3 Locations:
${topLocations || '  None'}

Recent Sales (last 3 days):
${recentSales}`;

    const prompt = `You are a sales analytics assistant. Answer concisely in 2-3 sentences.

Data:
${summary}

Question:
${question}`;

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
