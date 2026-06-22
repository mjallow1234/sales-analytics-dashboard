// Affiliate Directory Lookup Service
// Fetches and caches affiliate data from the Affiliate Portal API

const AFFILIATES_API_BASE = 'https://affiliates.sidrahsalaam.com/php/api';
const AFFILIATES_API_URL = `${AFFILIATES_API_BASE}/affiliates.php`;
const AFFILIATES_LOGIN_URL = `${AFFILIATES_API_BASE}/login.php`;
const PORTAL_LOGIN_IDENTIFIER = 'admin';
const PORTAL_LOGIN_PASSWORD = 'SidrahPass2025!';
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;

let affiliateLookup = {};
let lookupInitialized = false;
let lastRefreshTime = null;
let refreshTimer = null;
let refreshInProgress = null;
let authCookie = null;

function normalizeAffiliateId(value) {
  if (!value && value !== 0) return '';
  return String(value).trim();
}

function normalizeAffiliateName(value) {
  if (!value && value !== 0) return '';
  return String(value).trim();
}

function buildLookup(affiliates) {
  const lookup = {};
  if (!Array.isArray(affiliates)) return lookup;

  affiliates.forEach((affiliate) => {
    const id = normalizeAffiliateId(
      affiliate.id ||
      affiliate.ID ||
      affiliate['Affiliate ID'] ||
      affiliate['Custom ID'] ||
      affiliate.custom_id ||
      affiliate.AffiliateID ||
      affiliate.aff ||
      affiliate.Affiliate
    );

    const name = normalizeAffiliateName(
      affiliate.name ||
      affiliate.Name ||
      affiliate['Affiliate Name'] ||
      affiliate.Affiliate ||
      affiliate.FullName ||
      affiliate['Full Name']
    );

    if (id && name) {
      lookup[id] = name;
    }
  });

  return lookup;
}

async function loginToAffiliatesPortal() {
  const response = await fetch(AFFILIATES_LOGIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ identifier: PORTAL_LOGIN_IDENTIFIER, password: PORTAL_LOGIN_PASSWORD })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Portal login failed: ${response.status} ${response.statusText} ${body}`);
  }

  const payload = await response.json().catch(() => ({}));
  if (!payload?.success) {
    throw new Error(`Portal login failed: ${payload?.error || JSON.stringify(payload)}`);
  }

  const setCookieHeader = response.headers.get('set-cookie');
  if (!setCookieHeader) {
    throw new Error('Portal login succeeded but no session cookie was returned');
  }

  authCookie = setCookieHeader
    .split(',')
    .map((cookie) => cookie.split(';')[0])
    .filter(Boolean)
    .join('; ');

  return authCookie;
}

async function fetchAffiliatesApi(attempt = 0) {
  if (!authCookie) {
    await loginToAffiliatesPortal();
  }

  const response = await fetch(AFFILIATES_API_URL, {
    headers: {
      Accept: 'application/json',
      Cookie: authCookie
    }
  });

  if ((response.status === 401 || response.status === 403) && attempt === 0) {
    authCookie = null;
    await loginToAffiliatesPortal();
    return fetchAffiliatesApi(attempt + 1);
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch affiliates API: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.affiliates)) {
    return payload.affiliates;
  }

  if (Array.isArray(payload?.leaderboard)) {
    return payload.leaderboard;
  }

  throw new Error('Invalid affiliate API response format');
}

async function refreshLookup() {
  if (refreshInProgress) {
    return refreshInProgress;
  }

  refreshInProgress = (async () => {
    const affiliates = await fetchAffiliatesApi();
    const lookup = buildLookup(affiliates);
    if (Object.keys(lookup).length > 0) {
      affiliateLookup = lookup;
      lookupInitialized = true;
      lastRefreshTime = new Date();
    }
    return affiliateLookup;
  })();

  try {
    return await refreshInProgress;
  } finally {
    refreshInProgress = null;
  }
}

function scheduleAutoRefresh() {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    refreshLookup().catch(() => {});
  }, REFRESH_INTERVAL_MS);
  if (typeof refreshTimer.unref === 'function') {
    refreshTimer.unref();
  }
}

async function initializeLookup() {
  if (lookupInitialized) {
    return affiliateLookup;
  }

  await refreshLookup();
  scheduleAutoRefresh();
  return affiliateLookup;
}

function getAffiliateNameSync(affiliateId) {
  const id = normalizeAffiliateId(affiliateId);
  if (!id) {
    return 'Unknown Affiliate';
  }

  return affiliateLookup[id] || `Unknown Affiliate (${id})`;
}

async function getAffiliateName(affiliateId) {
  const id = normalizeAffiliateId(affiliateId);
  if (!id) {
    return 'Unknown Affiliate';
  }

  if (affiliateLookup[id]) {
    return affiliateLookup[id];
  }

  await refreshLookup();

  return affiliateLookup[id] || `Unknown Affiliate (${id})`;
}

function getLookupCache() {
  return affiliateLookup;
}

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
  getAffiliateNameSync,
  getLookupCache,
  getCacheStatus
};
