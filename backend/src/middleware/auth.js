const jwt = require('jsonwebtoken');
const config = require('../config/env');
const AppError = require('../utils/AppError');

/**
 * Requires a valid access token in the Authorization: Bearer <token> header.
 * Attaches req.user = { id, email }
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(new AppError('Authentication required', 401, 'AUTH_MISSING_TOKEN'));
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwt.accessSecret);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new AppError('Access token expired', 401, 'AUTH_TOKEN_EXPIRED'));
    }
    return next(new AppError('Invalid access token', 401, 'AUTH_INVALID_TOKEN'));
  }
}

/**
 * Optional auth: attaches req.user if a valid token is present, but does not fail if absent.
 * Used for routes that support both guest and logged-in behavior (e.g. flight search).
 */
function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return next();

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwt.accessSecret);
    req.user = { id: payload.sub, email: payload.email };
  } catch (err) {
    // ignore invalid/expired token for optional auth
  }
  next();
}

module.exports = { requireAuth, optionalAuth };
