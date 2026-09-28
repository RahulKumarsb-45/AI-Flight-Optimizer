const axios = require('axios');
const config = require('../../config/env');
const logger = require('../../logger/logger');
const AppError = require('../../utils/AppError');

/**
 * IGNAV AIRPORT PROVIDER
 * ======================
 * Real airport search/autocomplete data from https://ignav.com
 * (GET /api/airports?q=...&limit=...), per the current official contract
 * published at https://ignav.com/api/openapi.json (confirmed 2026 —
 * operationId `search_airports_api_airports_get`).
 *
 * Auth is the same static X-Api-Key header as ignavProvider.js (flight
 * fares) — Ignav's OpenAPI spec applies one `ApiKeyAuth` security scheme
 * across the whole API, so IGNAV_API_KEY now backs two capabilities
 * (fares + airports) rather than needing a second credential.
 *
 * Response shape per Ignav's `AirportModel`: { code, name, city, country }.
 * Notably this does NOT include coordinates or a 2-letter country code —
 * nothing in this file invents them. Callers (airportService.js) are
 * responsible for enriching with the local dataset's lat/lon when the
 * returned code happens to match a known airport, and for leaving those
 * fields absent otherwise.
 *
 * This is a read path for an interactive autocomplete box, so retries are
 * capped low (MAX_RETRIES = 2, short backoff) to keep typeahead responsive
 * rather than mirroring the fares provider's more patient retry budget.
 */

const MAX_RETRIES = 2;
const MAX_CONCURRENT_REQUESTS = 5; // same concurrency-cap shape as ignavProvider.js
const REQUEST_TIMEOUT_MS = 8000;

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
 * Performs a GET /api/airports request with retry + error mapping.
 * Mirrors ignavProvider.js's ignavPost error-mapping shape, adapted to the
 * status codes Ignav's OpenAPI spec documents for this endpoint (400, 401,
 * 402, 403, 429, 503) plus a generic branch for anything else.
 */
async function ignavAirportGet(params, attempt = 1) {
  if (!config.ignav.apiKey) {
    throw new AppError(
      'Ignav credentials are not configured. Set IGNAV_API_KEY in .env.',
      500,
      'IGNAV_NOT_CONFIGURED'
    );
  }

  await acquireSlot();
  try {
    const response = await axios.get(`${config.ignav.baseUrl}/airports`, {
      headers: { 'X-Api-Key': config.ignav.apiKey },
      params,
      timeout: REQUEST_TIMEOUT_MS,
    });
    return response.data;
  } catch (err) {
    const status = err.response?.status;
    const errorBody = err.response?.data?.error;
    const code = errorBody?.code;

    if (status === 401) {
      logger.error('Ignav rejected the configured API key (airport search)', { code });
      throw new AppError('Airport search provider rejected the configured API key.', 502, 'IGNAV_AUTH_ERROR');
    }

    if (status === 403) {
      logger.error('Ignav account is not ready (airport search)', { code });
      throw new AppError(
        'Airport search provider account is not ready (email verification pending).',
        502,
        'IGNAV_ACCOUNT_ERROR'
      );
    }

    if (status === 402) {
      logger.error('Ignav billing issue (airport search)', { code });
      throw new AppError(
        'Airport search provider billing is not set up, or payment failed.',
        502,
        'IGNAV_BILLING_ERROR'
      );
    }

    if (status === 429 && attempt <= MAX_RETRIES) {
      const backoffMs = 300 * 2 ** attempt;
      logger.warn('Ignav airport search rate limited, backing off', { code, backoffMs, attempt });
      await sleep(backoffMs);
      return ignavAirportGet(params, attempt + 1);
    }

    if ((status === 503 || status >= 500) && attempt <= MAX_RETRIES) {
      const backoffMs = 300 * 2 ** attempt;
      logger.warn('Ignav airport search upstream error, retrying', { status, code, backoffMs, attempt });
      await sleep(backoffMs);
      return ignavAirportGet(params, attempt + 1);
    }

    if (status >= 400 && status < 500) {
      logger.warn('Ignav rejected the airport search request', { status, code, field: errorBody?.field });
      throw new AppError(
        errorBody?.message || 'Airport search provider rejected the request.',
        400,
        code || 'IGNAV_INVALID_REQUEST'
      );
    }

    logger.error('Ignav airport search request failed', { status, code, message: err.message });
    throw new AppError(
      'Airport search provider is temporarily unavailable.',
      502,
      'IGNAV_PROVIDER_ERROR'
    );
  } finally {
    releaseSlot();
  }
}

/**
 * Searches Ignav's airport directory. Returns Ignav's own AirportModel
 * shape verbatim (`{ code, name, city, country }`) — normalization into
 * this app's internal airport shape happens in airportService.js, which
 * also decides how/whether to fall back to the local dataset on failure.
 *
 * @param {string} query - free-text query (IATA code, city, or airport name)
 * @param {number} limit - 1-20 per Ignav's documented bound; values outside
 *   that range are clamped rather than sent through and rejected as a 400.
 */
async function searchAirports(query, limit = 10) {
  // Number.isFinite(...) (not `limit || 10`) so an explicit 0 is clamped up
  // to 1 rather than being mistaken for "no limit given" and defaulted to 10.
  const requested = Number.isFinite(limit) ? limit : 10;
  const clampedLimit = Math.max(1, Math.min(20, requested));
  const data = await ignavAirportGet({ q: query, limit: clampedLimit });
  return Array.isArray(data) ? data : [];
}

module.exports = { searchAirports };
