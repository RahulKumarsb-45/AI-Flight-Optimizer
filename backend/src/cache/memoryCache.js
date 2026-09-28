/**
 * Lightweight in-process cache with TTL. Good enough for single-instance
 * deployments and for data that's cheap to recompute (static airport lookups,
 * Amadeus access tokens). NOT shared across multiple server instances —
 * once horizontal scaling is needed, swap this module's internals for a
 * Redis client while keeping the same get/set/del interface (documented
 * as the "Redis-ready" extension point from the architecture phase).
 */
class MemoryCache {
  constructor() {
    this.store = new Map(); // key -> { value, expiresAt }
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttlMs) {
    this.store.set(key, {
      value,
      expiresAt: ttlMs ? Date.now() + ttlMs : null,
    });
  }

  del(key) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }
}

// Singletons: one cache for static reference data, one for provider tokens,
// one for weather (changes slowly — OpenWeather itself only updates ~every 10min).
const staticCache = new MemoryCache();
const tokenCache = new MemoryCache();
const weatherCache = new MemoryCache();
const placesCache = new MemoryCache();

// L0 layer for the flight cache (see cache/flightCache.js). Redis is the
// optional shared L0/L1 across instances and Postgres is the durable
// fallback; this in-process cache sits in front of both so a repeat request
// on the SAME instance within the TTL window is served with no network or
// DB round trip at all — including on a single-instance deployment that has
// no Redis configured, where it still meaningfully cuts down on Postgres
// reads between requests. It follows the exact same get/set/TTL contract as
// the other caches above rather than introducing new cache machinery.
const flightMemoryCache = new MemoryCache();

module.exports = { MemoryCache, staticCache, tokenCache, weatherCache, placesCache, flightMemoryCache };
