const mockProvider = require('./mockProvider');
const amadeusProvider = require('./amadeusProvider');
const ignavProvider = require('./ignavProvider');
const config = require('../../config/env');
const logger = require('../../logger/logger');

const PROVIDERS = {
  mock: mockProvider,
  amadeus: amadeusProvider,
  ignav: ignavProvider,
};

/**
 * Returns the active flight provider based on FLIGHT_PROVIDER env var.
 * Everything downstream (optimizer, search controller) calls
 * getProvider().search(...) and never imports a concrete provider module —
 * this is the seam that lets us add a 3rd/4th provider later with zero
 * changes to optimizer code.
 */
function getProvider(name = config.flightProvider) {
  const provider = PROVIDERS[name];
  if (!provider) {
    logger.warn(`Unknown FLIGHT_PROVIDER "${name}", falling back to mock`);
    return PROVIDERS.mock;
  }
  return provider;
}

/**
 * Calls the configured provider's search().
 *
 * IMPORTANT: this used to silently retry against mockProvider whenever the
 * primary (real) provider threw — e.g. missing/invalid credentials, a
 * billing problem, or an upstream outage. That meant a misconfigured or
 * down real provider could serve made-up mock prices to users with no
 * indication they weren't real. That is exactly the "silent fake price"
 * failure mode this project must never have, so there is no fallback here
 * anymore: when FLIGHT_PROVIDER is a real provider (e.g. 'ignav') and it
 * fails, the error propagates to the caller — which surfaces a clear error
 * to the frontend (see errorHandler.js) instead of a fake result. The mock
 * provider is only ever used when FLIGHT_PROVIDER=mock is explicitly set
 * (local dev / tests), which is a normal getProvider() call, not a
 * fallback. The exported name is kept for backward compatibility with
 * existing call sites (searchController.js, flightFetchStage.js) and their
 * tests, which mock this function directly.
 */
async function searchWithFallback(params) {
  return getProvider().search(params);
}

module.exports = { getProvider, searchWithFallback };
