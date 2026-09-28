const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { query } = require('../database/pool');
const AppError = require('../utils/AppError');
const logger = require('../logger/logger');
const {
  generateAccessToken,
  generateRefreshToken,
  hashToken,
  verifyRefreshToken,
  refreshExpiryDate,
} = require('../utils/tokens');

const SALT_ROUNDS = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;

async function findUserByEmail(email) {
  const result = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  return result.rows[0] || null;
}

async function findUserById(id) {
  const result = await query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0] || null;
}

/**
 * Register a new local (email/password) account.
 */
async function register({ name, email, password }) {
  const existing = await findUserByEmail(email);
  if (existing) {
    throw new AppError('An account with this email already exists', 409, 'AUTH_EMAIL_TAKEN');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const verificationToken = crypto.randomBytes(32).toString('hex');

  const result = await query(
    `INSERT INTO users (name, email, password_hash, auth_provider, email_verification_token)
     VALUES ($1, $2, $3, 'local', $4)
     RETURNING id, name, email, avatar_url, email_verified, created_at`,
    [name, email.toLowerCase(), passwordHash, verificationToken]
  );

  // create default free subscription row
  await query(
    `INSERT INTO subscriptions (user_id, plan, status) VALUES ($1, 'free', 'active')`,
    [result.rows[0].id]
  );

  // create empty preferences row
  await query(`INSERT INTO user_preferences (user_id) VALUES ($1)`, [result.rows[0].id]);

  logger.info('User registered', { userId: result.rows[0].id });

  // NOTE: actual email sending (verification link) is wired up in the notifications module.
  // The token is generated and stored now so that module can send it once email service is configured.

  return result.rows[0];
}

/**
 * Finds an existing OAuth user or creates a new one. Deliberately does NOT
 * auto-link an OAuth login to an existing account under a different
 * provider (including 'local') just because the email matches — that's a
 * known account-takeover vector if the OAuth provider's email isn't
 * trustworthy. Instead we surface a clear error telling the person which
 * method their account actually uses.
 */
async function findOrCreateOAuthUser({ provider, providerId, email, name, avatarUrl, emailVerified }) {
  const byProvider = await query(
    `SELECT id, name, email, auth_provider, avatar_url, email_verified, created_at
     FROM users WHERE auth_provider = $1 AND provider_id = $2`,
    [provider, providerId]
  );
  if (byProvider.rows.length > 0) {
    return byProvider.rows[0];
  }

  const existingByEmail = await findUserByEmail(email);
  if (existingByEmail) {
    throw new AppError(
      `An account already exists for ${email} using ${existingByEmail.auth_provider === 'local' ? 'a password' : existingByEmail.auth_provider}. Please sign in that way instead.`,
      409,
      'AUTH_EMAIL_TAKEN_DIFFERENT_PROVIDER'
    );
  }

  const result = await query(
    `INSERT INTO users (name, email, auth_provider, provider_id, avatar_url, email_verified)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, email, auth_provider, avatar_url, email_verified, created_at`,
    [name, email.toLowerCase(), provider, providerId, avatarUrl, emailVerified]
  );

  await query(`INSERT INTO subscriptions (user_id, plan, status) VALUES ($1, 'free', 'active')`, [result.rows[0].id]);
  await query(`INSERT INTO user_preferences (user_id) VALUES ($1)`, [result.rows[0].id]);

  logger.info('User registered via OAuth', { userId: result.rows[0].id, provider });

  return result.rows[0];
}

/**
 * Local login with email + password. Includes brute-force lockout.
 */
async function login({ email, password }) {
  const user = await findUserByEmail(email);
  if (!user || user.auth_provider !== 'local') {
    throw new AppError('Invalid email or password', 401, 'AUTH_INVALID_CREDENTIALS');
  }

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new AppError(
      `Account temporarily locked due to repeated failed logins. Try again later.`,
      423,
      'AUTH_ACCOUNT_LOCKED'
    );
  }

  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) {
    const attempts = user.failed_login_attempts + 1;
    const lockUntil = attempts >= MAX_FAILED_ATTEMPTS
      ? new Date(Date.now() + LOCK_DURATION_MINUTES * 60000)
      : null;

    await query(
      `UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3`,
      [attempts, lockUntil, user.id]
    );

    throw new AppError('Invalid email or password', 401, 'AUTH_INVALID_CREDENTIALS');
  }

  // reset failed attempts on success
  await query(
    `UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1`,
    [user.id]
  );

  return sanitizeUser(user);
}

/**
 * Issues a new access + refresh token pair and persists the refresh session.
 */
async function issueSession(user, { userAgent, ipAddress } = {}) {
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  const tokenHash = hashToken(refreshToken);

  await query(
    `INSERT INTO sessions (user_id, refresh_token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [user.id, tokenHash, userAgent || null, ipAddress || null, refreshExpiryDate()]
  );

  return { accessToken, refreshToken };
}

/**
 * Rotates a refresh token: verifies it, checks it's not revoked, issues a new pair,
 * and revokes the old session (rotation prevents replay if a token is stolen).
 */
async function refreshSession(rawRefreshToken, { userAgent, ipAddress } = {}) {
  let payload;
  try {
    payload = verifyRefreshToken(rawRefreshToken);
  } catch (err) {
    throw new AppError('Invalid or expired refresh token', 401, 'AUTH_INVALID_REFRESH_TOKEN');
  }

  const tokenHash = hashToken(rawRefreshToken);
  const result = await query(
    `SELECT * FROM sessions WHERE user_id = $1 AND refresh_token_hash = $2`,
    [payload.sub, tokenHash]
  );
  const session = result.rows[0];

  if (!session) {
    throw new AppError('Session expired or not found. Please log in again.', 401, 'AUTH_SESSION_EXPIRED');
  }

  if (session.revoked) {
    // This exact refresh token was already rotated/used once before. A legitimate
    // client would only ever present the LATEST token, so this means either a
    // replay of an old request or a stolen token being used after the real
    // owner already rotated past it — revoke every session for this user as a
    // precaution, not just this one.
    await query(`UPDATE sessions SET revoked = true WHERE user_id = $1`, [payload.sub]);
    logger.warn('Refresh token reuse detected — all sessions revoked', { userId: payload.sub });
    throw new AppError('Refresh token already used. Please log in again.', 401, 'AUTH_REFRESH_REUSE_DETECTED');
  }

  if (new Date(session.expires_at) < new Date()) {
    throw new AppError('Session expired. Please log in again.', 401, 'AUTH_SESSION_EXPIRED');
  }

  // revoke old session (rotation)
  await query(`UPDATE sessions SET revoked = true WHERE id = $1`, [session.id]);

  const user = await findUserById(payload.sub);
  if (!user) {
    throw new AppError('User no longer exists', 401, 'AUTH_USER_NOT_FOUND');
  }

  return issueSession(user, { userAgent, ipAddress });
}

async function logout(rawRefreshToken) {
  if (!rawRefreshToken) return;
  const tokenHash = hashToken(rawRefreshToken);
  await query(`UPDATE sessions SET revoked = true WHERE refresh_token_hash = $1`, [tokenHash]);
}

function sanitizeUser(user) {
  const { password_hash, email_verification_token, password_reset_token, ...safe } = user;
  return safe;
}

module.exports = {
  register,
  login,
  issueSession,
  refreshSession,
  logout,
  findUserByEmail,
  findUserById,
  findOrCreateOAuthUser,
  sanitizeUser,
};
