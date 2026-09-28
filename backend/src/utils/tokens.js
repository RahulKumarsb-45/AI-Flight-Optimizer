const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config/env');

/**
 * Generates a short-lived access token (sent in response body, used as Bearer token).
 */
function generateAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, jti: crypto.randomUUID() },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessExpires }
  );
}

/**
 * Generates a long-lived refresh token (stored in httpOnly cookie).
 * The raw token is returned to set in the cookie; only its HASH is stored in DB
 * so a leaked DB dump can't be used to forge sessions.
 */
function generateRefreshToken(user) {
  const raw = jwt.sign(
    { sub: user.id, type: 'refresh', jti: crypto.randomUUID() },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpires }
  );
  return raw;
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function verifyRefreshToken(rawToken) {
  return jwt.verify(rawToken, config.jwt.refreshSecret);
}

/**
 * Parses a duration string like "30d", "15m", "12h" into milliseconds.
 * Shared by refreshExpiryDate() (DB storage) and the auth controller's
 * cookie maxAge — using one parser for both keeps them from drifting apart
 * if JWT_REFRESH_EXPIRES is ever changed in .env.
 */
function parseDurationMs(durationStr, fallbackMs = 30 * 24 * 60 * 60 * 1000) {
  const match = /^(\d+)([smhd])$/.exec(durationStr || '');
  if (!match) return fallbackMs;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const unitMs = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit];
  return value * unitMs;
}

/**
 * Converts JWT_REFRESH_EXPIRES (e.g. "30d") into a JS Date for DB storage.
 */
function refreshExpiryDate() {
  return new Date(Date.now() + parseDurationMs(config.jwt.refreshExpires));
}

/**
 * Short-lived signed "state" token for the OAuth redirect flow — CSRF
 * protection without needing server-side session storage (Redis, etc.).
 * The state travels: our redirect -> Google -> back to our callback,
 * and we verify it's genuinely ours and hasn't expired before trusting the
 * authorization code that comes with it.
 */
function generateOAuthState() {
  return jwt.sign({ nonce: crypto.randomUUID() }, config.jwt.accessSecret, { expiresIn: '10m' });
}

function verifyOAuthState(state) {
  try {
    jwt.verify(state, config.jwt.accessSecret);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Generates a secure, non-guessable public share-link identifier for a
 * shared Trip. 24 random bytes (192 bits) base64url-encoded — a URL-safe,
 * fixed-length string with no dictionary structure, so it can't be
 * predicted, incremented, or brute-forced the way a sequential/UUID trip
 * id could be. This is intentionally a distinct value from `trips.id`:
 * the trip's own id is never used as the public lookup key.
 */
function generateShareToken() {
  return crypto.randomBytes(24).toString('base64url');
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  hashToken,
  verifyRefreshToken,
  refreshExpiryDate,
  parseDurationMs,
  generateOAuthState,
  verifyOAuthState,
  generateShareToken,
};
