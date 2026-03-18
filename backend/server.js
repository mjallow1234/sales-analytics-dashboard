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
    const { OpenAI } = require('openai');
    const openai = new OpenAI();

    const prompt = `You are a sales analytics assistant.
Analyze the following data and answer the question concisely.

Data:
${context}

Question:
${question}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }]
    });

    res.json({ answer: completion.choices[0].message.content });
  } catch (error) {
    console.error('AI query error:', error);
    res.status(500).json({ answer: 'AI service unavailable. Please check your OpenAI API key.' });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Analytics server running on port ${PORT}`);
});
