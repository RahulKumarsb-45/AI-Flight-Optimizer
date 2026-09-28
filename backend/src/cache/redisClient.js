const { createClient } = require('redis');
const config = require('../config/env');
const logger = require('../logger/logger');

/**
 * Thin connection manager around node-redis v4.
 *
 * Design goals:
 * - Redis is an OPTIONAL accelerator, never a hard dependency. If REDIS_URL
 *   isn't set, or the server is unreachable, or it drops mid-run, every
 *   caller in this codebase (see redisCache.js) falls back to the existing
 *   Postgres / in-memory caches instead of failing the request.
 * - Reconnection uses node-redis's built-in `reconnectStrategy` with capped
 *   exponential backoff. After too many failed attempts we stop retrying
 *   (returning an Error from the strategy tells node-redis to give up)
 *   rather than hammering a dead Redis instance forever — the app keeps
 *   running on its fallback caches either way.
 * - `isAvailable()` is the single source of truth callers check before
 *   trying a Redis operation, so a mid-request disconnect degrades
 *   gracefully instead of throwing.
 */

const MAX_RECONNECT_ATTEMPTS = 10;

let client = null;
let isReady = false;
let connectPromise = null;

function isEnabled() {
  return !!config.redis.url;
}

function isAvailable() {
  return isEnabled() && isReady && !!client;
}

function getClient() {
  return client;
}

function reconnectStrategy(retries) {
  if (retries > MAX_RECONNECT_ATTEMPTS) {
    logger.error(
      `Redis: giving up after ${MAX_RECONNECT_ATTEMPTS} reconnect attempts — continuing on cache fallback only`
    );
    return new Error('Redis reconnect attempts exhausted');
  }
  const delayMs = Math.min(retries * 200, 3000);
  logger.warn(`Redis: connection lost, retrying (attempt ${retries + 1}/${MAX_RECONNECT_ATTEMPTS}) in ${delayMs}ms`);
  return delayMs;
}

/**
 * Connects to Redis if REDIS_URL is configured. Safe to call multiple times
 * (returns the existing connect promise). Never throws — a failed connection
 * is logged and the app continues with cache fallbacks.
 */
async function connectRedis() {
  if (!isEnabled()) {
    logger.info('REDIS_URL not set — Redis cache disabled, using in-memory/Postgres cache fallback only');
    return null;
  }
  // Reuse an in-flight or previously-*successful* connect attempt. A failed
  // attempt clears connectPromise/client below (see catch), so this only
  // short-circuits genuinely redundant calls — it never permanently pins the
  // module to a dead connection.
  if (connectPromise) return connectPromise;

  const attemptedClient = createClient({
    url: config.redis.url,
    socket: { reconnectStrategy },
  });

  attemptedClient.on('error', (err) => {
    isReady = false;
    logger.warn('Redis client error — falling back to non-Redis cache path', { error: err.message });
  });
  attemptedClient.on('ready', () => {
    isReady = true;
    logger.info('Redis client connected and ready');
  });
  attemptedClient.on('end', () => {
    isReady = false;
    logger.warn('Redis connection closed');
  });

  client = attemptedClient;

  connectPromise = attemptedClient
    .connect()
    .then(() => attemptedClient)
    .catch((err) => {
      isReady = false;
      logger.warn('Redis initial connection failed — continuing on cache fallback only', { error: err.message });
      // Do NOT leave connectPromise/client pointing at this dead attempt —
      // that would permanently short-circuit connectRedis() above and make
      // every later call return the same cached `null` forever, even once
      // Redis becomes reachable again. Clearing both means the next
      // connectRedis() call (e.g. on the next incoming request) builds a
      // fresh client and genuinely retries instead of replaying this failure.
      if (client === attemptedClient) {
        client = null;
      }
      connectPromise = null;
      return null;
    });

  return connectPromise;
}

/**
 * Closes the Redis connection cleanly. Called from server.js on
 * SIGTERM/SIGINT so a deploy/restart doesn't leave a dangling socket.
 */
async function disconnectRedis() {
  if (!client) return;
  try {
    if (isReady) {
      await client.quit();
    } else {
      client.disconnect();
    }
    logger.info('Redis client disconnected');
  } catch (err) {
    logger.warn('Error while disconnecting Redis client', { error: err.message });
  } finally {
    isReady = false;
    client = null;
    connectPromise = null;
  }
}

/** Test-only: resets module state between test files. */
function _resetForTests() {
  client = null;
  isReady = false;
  connectPromise = null;
}

module.exports = {
  connectRedis,
  disconnectRedis,
  getClient,
  isAvailable,
  isEnabled,
  _resetForTests,
};
