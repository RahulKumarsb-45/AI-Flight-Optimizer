const crypto = require('crypto');
const { query } = require('../database/pool');
const config = require('../config/env');
const logger = require('../logger/logger');
const redisCache = require('./redisCache');
const { flightMemoryCache } = require('./memoryCache');

const TTL_MS = config.cache.flightTtlMinutes * 60 * 1000;
const REDIS_NAMESPACE = 'flightcache';

function buildCacheKey({ originIata, destinationIata, departureDate, returnDate, adults, cabinClass, provider }) {
  const raw = [originIata, destinationIata, departureDate, returnDate || '', adults, cabinClass, provider].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function redisKeyFor(cacheKey) {
  return `${REDIS_NAMESPACE}:${cacheKey}`;
}

/**
 * Three-layer lookup: in-process memory first (fastest, this instance only),
 * then Redis (fast, shared across every backend instance), then Postgres
 * (durable, the pre-existing source of truth).
 *
 * When Redis is down/unconfigured, redisCache.get() resolves to `undefined`
 * and this simply falls through to Postgres exactly as it did before Q6 —
 * no behavior change for deployments without REDIS_URL set. The in-memory
 * layer is a pure speed optimization on top of that: it never replaces the
 * Postgres fallback, it just means a repeat request on the same instance
 * (e.g. Redis and Postgres are both momentarily unavailable, or simply to
 * save a round trip) can still be served instantly.
 *
 * A Postgres hit backfills both Redis and memory (best-effort, not awaited
 * for Redis) so the next request for the same search is served without
 * another database round trip.
 */
async function getCached(params) {
  const key = buildCacheKey(params);

  const memHit = flightMemoryCache.get(key);
  if (memHit !== null) return memHit;

  const redisResult = await redisCache.get(redisKeyFor(key));
  if (redisResult !== undefined) {
    // `null` here means Redis is up and definitively has no entry — still
    // worth checking Postgres in case a sibling instance's Redis miss
    // hasn't propagated, but in practice both layers share the same TTL
    // and key, so a Redis miss reliably means "not cached" here too.
    if (redisResult !== null) {
      flightMemoryCache.set(key, redisResult, TTL_MS);
      return redisResult;
    }
  }

  try {
    const result = await query(
      `SELECT response_json FROM flight_cache WHERE cache_key = $1 AND expires_at > now()`,
      [key]
    );
    if (result.rows.length === 0) return null;
    const offers = result.rows[0].response_json;

    flightMemoryCache.set(key, offers, TTL_MS);
    redisCache.set(redisKeyFor(key), offers, TTL_MS).catch(() => {
      // best-effort backfill; a failure here just means the next request
      // repeats this same Postgres lookup instead of hitting Redis
    });

    return offers;
  } catch (err) {
    logger.warn('Flight cache read failed, proceeding without cache', { error: err.message });
    return null;
  }
}

/**
 * Write-through: memory + Redis for speed, Postgres for durability. The
 * writes are independent — a Redis or memory failure never blocks the
 * Postgres write (or vice versa), and neither ever blocks the search
 * response itself.
 */
async function setCached(params, offers) {
  const key = buildCacheKey(params);

  flightMemoryCache.set(key, offers, TTL_MS);
  await redisCache.set(redisKeyFor(key), offers, TTL_MS);

  try {
    const expiresAt = new Date(Date.now() + TTL_MS);
    await query(
      `INSERT INTO flight_cache (cache_key, response_json, provider, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (cache_key) DO UPDATE
         SET response_json = EXCLUDED.response_json,
             expires_at = EXCLUDED.expires_at,
             created_at = now()`,
      [key, JSON.stringify(offers), params.provider, expiresAt]
    );
  } catch (err) {
    logger.warn('Flight cache write failed, continuing without caching this result', { error: err.message });
  }
}

/**
 * Deletes expired rows. Intended to be called by a scheduled cron job
 * (wired up in the Production phase) rather than on every request.
 */
async function purgeExpired() {
  const result = await query(`DELETE FROM flight_cache WHERE expires_at <= now()`);
  logger.info('Flight cache purge complete', { deletedRows: result.rowCount });
  return result.rowCount;
}

module.exports = { getCached, setCached, purgeExpired, buildCacheKey };
