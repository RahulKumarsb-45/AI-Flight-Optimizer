const redisClient = require('./redisClient');
const logger = require('../logger/logger');

/**
 * Thin JSON get/set/del wrapper over the Redis client, used as a shared,
 * cross-instance cache layer (currently wired into flightCache.js).
 *
 * Return-value contract for get():
 * - `undefined` -> Redis is unavailable or the call itself failed. Callers
 *   should treat this exactly like a cache miss and fall through to their
 *   next layer (Postgres, in-memory cache, or the provider itself).
 * - `null`      -> Redis is up and definitively has no value for this key.
 * - anything else -> the cached value, parsed from JSON.
 *
 * Every operation is wrapped in try/catch and never throws — caching is an
 * optimization, not a hard dependency, matching the existing philosophy in
 * flightCache.js and memoryCache.js.
 */

async function get(key) {
  if (!redisClient.isAvailable()) return undefined;
  try {
    const raw = await redisClient.getClient().get(key);
    if (raw === null) return null;
    return JSON.parse(raw);
  } catch (err) {
    logger.warn('Redis GET failed, falling back to next cache layer', { key, error: err.message });
    return undefined;
  }
}

async function set(key, value, ttlMs) {
  if (!redisClient.isAvailable()) return false;
  try {
    const payload = JSON.stringify(value);
    if (ttlMs) {
      await redisClient.getClient().set(key, payload, { PX: ttlMs });
    } else {
      await redisClient.getClient().set(key, payload);
    }
    return true;
  } catch (err) {
    logger.warn('Redis SET failed', { key, error: err.message });
    return false;
  }
}

async function del(key) {
  if (!redisClient.isAvailable()) return false;
  try {
    await redisClient.getClient().del(key);
    return true;
  } catch (err) {
    logger.warn('Redis DEL failed', { key, error: err.message });
    return false;
  }
}

module.exports = { get, set, del };
