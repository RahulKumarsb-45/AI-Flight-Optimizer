const axios = require('axios');
const config = require('../../config/env');
const { tokenCache } = require('../../cache/memoryCache');
const logger = require('../../logger/logger');
const AppError = require('../../utils/AppError');

const TOKEN_CACHE_KEY = 'amadeus_access_token';
const MAX_RETRIES = 3;
const MAX_CONCURRENT_REQUESTS = 5; // simple concurrency cap to respect Amadeus rate limits

let activeRequests = 0;
const queue = [];

function acquireSlot() {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      if (activeRequests < MAX_CONCURRENT_REQUESTS) {
        activeRequests++;
        resolve();
      } else {
        queue.push(tryAcquire);
      }
    };
    tryAcquire();
  });
}

function releaseSlot() {
  activeRequests--;
  const next = queue.shift();
  if (next) next();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * OAuth2 client_credentials token, cached in-memory until just before expiry
 * (proactive refresh, not reactive-on-401) — avoids an extra round trip on
 * every search request.
 */
async function getAccessToken() {
  const cached = tokenCache.get(TOKEN_CACHE_KEY);
  if (cached) return cached;

  if (!config.amadeus.clientId || !config.amadeus.clientSecret) {
    throw new AppError(
      'Amadeus credentials are not configured. Set AMADEUS_CLIENT_ID/SECRET in .env, or use FLIGHT_PROVIDER=mock.',
      500,
      'AMADEUS_NOT_CONFIGURED'
    );
  }

  const response = await axios.post(
    `${config.amadeus.baseUrl}/v1/security/oauth2/token`,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.amadeus.clientId,
      client_secret: config.amadeus.clientSecret,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const { access_token: token, expires_in: expiresInSeconds } = response.data;

  // refresh 60s before actual expiry to avoid using an about-to-expire token mid-request
  const ttlMs = Math.max((expiresInSeconds - 60) * 1000, 10000);
  tokenCache.set(TOKEN_CACHE_KEY, token, ttlMs);

  logger.info('Amadeus access token refreshed', { expiresInSeconds });
  return token;
}

/**
 * Performs a GET request against Amadeus with retry + 429 handling.
 * - 429: respects Retry-After header, retries up to MAX_RETRIES
 * - 5xx: exponential backoff retry
 * - 401: forces a token refresh once, then retries
 */
async function amadeusGet(path, params, attempt = 1) {
  await acquireSlot();
  try {
    const token = await getAccessToken();
    const response = await axios.get(`${config.amadeus.baseUrl}${path}`, {
      params,
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    });
    return response.data;
  } catch (err) {
    const status = err.response?.status;

    if (status === 401 && attempt === 1) {
      tokenCache.del(TOKEN_CACHE_KEY); // force refresh
      return amadeusGet(path, params, attempt + 1);
    }

    if (status === 429 && attempt <= MAX_RETRIES) {
      const retryAfterSeconds = parseInt(err.response.headers['retry-after'] || '2', 10);
      logger.warn('Amadeus rate limited, backing off', { retryAfterSeconds, attempt });
      await sleep(retryAfterSeconds * 1000);
      return amadeusGet(path, params, attempt + 1);
    }

    if (status >= 500 && attempt <= MAX_RETRIES) {
      const backoffMs = 500 * 2 ** attempt;
      logger.warn('Amadeus server error, retrying', { status, backoffMs, attempt });
      await sleep(backoffMs);
      return amadeusGet(path, params, attempt + 1);
    }

    logger.error('Amadeus request failed', {
      path,
      status,
      message: err.response?.data?.errors?.[0]?.detail || err.message,
    });
    throw new AppError(
      'Flight search provider is temporarily unavailable. Please try again shortly.',
      502,
      'AMADEUS_PROVIDER_ERROR'
    );
  } finally {
    releaseSlot();
  }
}

/**
 * Normalizes an Amadeus flight-offer object into our FlightProviderContract shape.
 */
function normalizeOffer(offer, usdToInrRate) {
  const priceUsd = parseFloat(offer.price.total);
  const priceInr = Math.round(priceUsd * usdToInrRate);

  const itineraries = offer.itineraries.map((itin) => ({
    totalDurationMinutes: parseIsoDurationToMinutes(itin.duration),
    segments: itin.segments.map((seg) => ({
      airline: seg.carrierCode,
      flightNumber: `${seg.carrierCode}${seg.number}`,
      fromIata: seg.departure.iataCode,
      toIata: seg.arrival.iataCode,
      departureTime: seg.departure.at,
      arrivalTime: seg.arrival.at,
      durationMinutes: parseIsoDurationToMinutes(seg.duration || itin.duration),
    })),
  }));

  const outbound = itineraries[0];
  const inbound = itineraries[1] || null;
  const stops = (outbound?.segments.length || 1) - 1 + (inbound ? inbound.segments.length - 1 : 0);

  return {
    id: offer.id,
    provider: 'amadeus',
    priceInr,
    currency: 'INR',
    totalDurationMinutes: outbound.totalDurationMinutes + (inbound?.totalDurationMinutes || 0),
    stops,
    outbound: outbound.segments,
    inbound: inbound ? inbound.segments : null,
    bookableUntil: offer.lastTicketingDate || null,
  };
}

function parseIsoDurationToMinutes(isoDuration) {
  // e.g. "PT7H45M" -> 465
  const match = /PT(?:(\d+)H)?(?:(\d+)M)?/.exec(isoDuration || '');
  if (!match) return 0;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  return hours * 60 + minutes;
}

// Static approximate rate — a real deployment should pull this from a currency
// API and cache it (see cache/ module). Kept simple here since exchange-rate
// fetching is out of scope for the flight-provider abstraction itself.
const USD_TO_INR_FALLBACK_RATE = 87;

async function search({ originIata, destinationIata, departureDate, returnDate, adults = 1, cabinClass = 'economy' }) {
  const params = {
    originLocationCode: originIata,
    destinationLocationCode: destinationIata,
    departureDate,
    adults,
    travelClass: cabinClass.toUpperCase(),
    currencyCode: 'USD',
    max: 20,
  };
  if (returnDate) params.returnDate = returnDate;

  const data = await amadeusGet('/v2/shopping/flight-offers', params);
  const offers = data.data || [];

  return offers
    .map((offer) => normalizeOffer(offer, USD_TO_INR_FALLBACK_RATE))
    .sort((a, b) => a.priceInr - b.priceInr);
}

module.exports = { search };
