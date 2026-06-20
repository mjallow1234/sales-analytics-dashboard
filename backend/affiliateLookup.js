// Affiliate Directory Lookup Service
// Fetches and caches affiliate data from Google Sheets CSV

const AFFILIATES_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTzmrVWd3eAY6Nv2EWXBA3UBiEkhYAbw4YTU5KN8IHOHMW2fTE1YMVfMg4WRyvtbxkFo9usxvaCkUqn/pub?gid=371676466&single=true&output=csv';

let affiliateLookup = {}; // Cache: { "ID_001": "Fatou Kuyateh", ... }
let lookupInitialized = false;
let lastRefreshTime = null;

/**
 * Fetch and parse Affiliate CSV from Google Sheets
 * @returns {Promise<Array>} Array of affiliate objects with fields: ID, Name, Email, etc.
 */
async function fetchAffiliatesCsv() {
  try {
    const response = await fetch(AFFILIATES_CSV_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch affiliates CSV: ${response.statusText}`);
    }
    const csvText = await response.text();
    return parseCsv(csvText);
  } catch (error) {
    console.error('Error fetching affiliates CSV:', error);
    throw error;
  }
}

/**
 * Parse CSV text into array of objects
 * Uses header row to determine field names
 * @param {string} csvText - Raw CSV text
 * @returns {Array} Array of objects with header keys
 */
function parseCsv(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length === 0) return [];

  const headers = lines[0].split(',').map(h => h.trim());
  const data = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue; // Skip empty lines

    const values = [];
    let current = '';
    let inQuotes = false;

    // Parse CSV with quote handling
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        if (line[j + 1] === '"') {
          current += '"';
          j++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    // Build object from headers and values
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });

    data.push(row);
  }

  return data;
}

/**
 * Build lookup cache from affiliate array
 * Maps affiliate IDs to names
 * @param {Array} affiliates - Array of affiliate objects
 * @returns {Object} Lookup map { "ID_001": "Name", ... }
 */
function buildLookup(affiliates) {
  const lookup = {};
  affiliates.forEach(affiliate => {
    // Support different possible header names
    const id = affiliate.ID || affiliate['Affiliate ID'] || affiliate['Custom ID'] || '';
    const name = affiliate.Name || affiliate['Affiliate Name'] || affiliate['name'] || '';
    
    if (id && name) {
      lookup[id.trim()] = name.trim();
    }
  });
  return lookup;
}

/**
 * Initialize affiliate lookup cache
 * Fetches from CSV and builds in-memory cache
 * @returns {Promise<Object>} Affiliate lookup cache
 */
async function initializeLookup() {
  if (lookupInitialized) {
    return affiliateLookup;
  }

  try {
    console.log('[affiliateLookup] Initializing affiliate directory cache...');
    const affiliates = await fetchAffiliatesCsv();
    affiliateLookup = buildLookup(affiliates);
    lookupInitialized = true;
    lastRefreshTime = new Date();
    console.log(`[affiliateLookup] Cached ${Object.keys(affiliateLookup).length} affiliates`);
    return affiliateLookup;
  } catch (error) {
    console.error('[affiliateLookup] Failed to initialize:', error);
    throw error;
  }
}

/**
 * Refresh affiliate lookup from CSV
 * @returns {Promise<Object>} Updated affiliate lookup cache
 */
async function refreshLookup() {
  try {
    console.log('[affiliateLookup] Refreshing affiliate directory...');
    const affiliates = await fetchAffiliatesCsv();
    affiliateLookup = buildLookup(affiliates);
    lastRefreshTime = new Date();
    console.log(`[affiliateLookup] Refreshed cache: ${Object.keys(affiliateLookup).length} affiliates`);
    return affiliateLookup;
  } catch (error) {
    console.error('[affiliateLookup] Failed to refresh:', error);
    throw error;
  }
}

/**
 * Get affiliate name by ID
 * If not found in cache, attempts automatic refresh
 * @param {string} affiliateId - Affiliate ID (e.g., "ID_001")
 * @returns {Promise<string>} Affiliate name or "Unknown Affiliate (ID_XXX)"
 */
async function getAffiliateName(affiliateId) {
  if (!affiliateId) return 'Unknown Affiliate';

  affiliateId = String(affiliateId).trim();

  // Check cache first
  if (affiliateLookup[affiliateId]) {
    return affiliateLookup[affiliateId];
  }

  // Not found in cache - try refresh once
  console.log(`[affiliateLookup] Cache miss for ${affiliateId}, refreshing...`);
  try {
    await refreshLookup();
    if (affiliateLookup[affiliateId]) {
      return affiliateLookup[affiliateId];
    }
  } catch (error) {
    console.error(`[affiliateLookup] Failed to refresh for ${affiliateId}:`, error);
  }

  // Still not found - return unknown
  return `Unknown Affiliate (${affiliateId})`;
}

/**
 * Get all affiliates from cache
 * @returns {Object} Affiliate lookup cache
 */
function getLookupCache() {
  return affiliateLookup;
}

/**
 * Get cache status
 * @returns {Object} Status information
 */
function getCacheStatus() {
  return {
    initialized: lookupInitialized,
    affiliateCount: Object.keys(affiliateLookup).length,
    lastRefreshTime,
    cache: affiliateLookup
  };
}

module.exports = {
  initializeLookup,
  refreshLookup,
  getAffiliateName,
  getLookupCache,
  getCacheStatus
};
