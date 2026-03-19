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

    // Precompute top agent
    const agentEntries = Object.entries(ctx.revenueByAgent || {}).sort((a, b) => b[1] - a[1]);
    const topAgent = agentEntries.length ? `${agentEntries[0][0]} (${agentEntries[0][1]})` : 'N/A';
    const topAgents = agentEntries.slice(0, 3)
      .map(([name, rev]) => `  ${name}: ${rev}`)
      .join('\n') || '  None';

    // Precompute top location
    const locEntries = Object.entries(ctx.revenueByLocation || {}).sort((a, b) => b[1] - a[1]);
    const topLocation = locEntries.length ? `${locEntries[0][0]} (${locEntries[0][1]})` : 'N/A';
    const topLocations = locEntries.slice(0, 3)
      .map(([name, rev]) => `  ${name}: ${rev}`)
      .join('\n') || '  None';

    // Precompute last 3 days sales and revenue
    const salesDates = Object.keys(ctx.salesOverTime || {}).sort().slice(-3);
    const last3DaysSales = salesDates.reduce((sum, d) => sum + (ctx.salesOverTime[d] || 0), 0);
    const revDates = Object.keys(ctx.revenueOverTime || {}).sort().slice(-3);
    const last3DaysRevenue = revDates.reduce((sum, d) => sum + (ctx.revenueOverTime[d] || 0), 0);
    const recentBreakdown = salesDates
      .map(d => `  ${d}: ${ctx.salesOverTime[d]} units`)
      .join('\n') || '  No recent data';

    const summary = `Total Sales: ${ctx.totalSales || 0}
Total Revenue: ${ctx.totalRevenue || 0}
Repeat Customers: ${ctx.repeatCustomers || 0}

Top Agent: ${topAgent}
Top Location: ${topLocation}

Top 3 Agents:
${topAgents}

Top 3 Locations:
${topLocations}

Sales Last 3 Days: ${last3DaysSales} units
Revenue Last 3 Days: ${last3DaysRevenue}

Daily Breakdown (last 3 days):
${recentBreakdown}`;

    const prompt = `You are a professional sales data analyst.

You MUST ONLY answer using the provided data.
Do NOT guess.
If the data is missing, say "Not enough data".

DATA:
${summary}

RULES:
- Be concise (2-3 sentences max)
- Use numbers from the data
- Do not hallucinate
- If asked about time (e.g. last 3 days), use the computed values above

QUESTION:
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
