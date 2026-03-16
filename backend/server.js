// server entry point

const express = require('express');
const cors = require('cors');

const { getSalesData } = require('./sheetsService');
const { processSales } = require('./analyticsProcessor');

const app = express();
app.use(cors());

let analyticsCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 300000; // 5 minutes

app.get('/analytics', async (req, res) => {
  try {
    const { startDate, endDate, agent } = req.query;

    // Serve from cache if recent
    if (analyticsCache && Date.now() - cacheTimestamp < CACHE_TTL) {
      console.log('Serving analytics from cache');
      return res.json(analyticsCache);
    }

    console.log('Refreshing analytics cache from Google Sheets');
    const rows = await getSalesData();
    const analytics = processSales(rows, { startDate, endDate, agent });

    analyticsCache = analytics;
    cacheTimestamp = Date.now();

    res.json(analytics);
  } catch (err) {
    console.error('Error fetching analytics:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Analytics server running on port ${PORT}`);
});
