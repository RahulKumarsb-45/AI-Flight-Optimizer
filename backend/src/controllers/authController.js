const config = require('../config/env');
const authService = require('../services/authService');
const oauthService = require('../services/oauthService');
const { parseDurationMs } = require('../utils/tokens');
const { query } = require('../database/pool');
const logger = require('../logger/logger');

const REFRESH_COOKIE_NAME = 'refresh_token';

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    // 'lax' works in local dev since frontend:3000 and backend:5000 share the
    // "localhost" hostname (same-site by the SameSite spec, port doesn't
    // matter). In production, frontend (Vercel) and backend (Render) are on
    // genuinely different sites — cross-site fetch() calls (e.g. silent
    // refresh from the frontend, and the OAuth callback redirect landing on
    // the frontend) need SameSite=None to have this cookie sent at all.
    // None requires Secure, which is already production-conditional above.
    sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
    path: '/api/auth', // only sent to auth endpoints
    maxAge: parseDurationMs(config.jwt.refreshExpires), // always matches JWT_REFRESH_EXPIRES
  };
}

async function register(req, res, next) {
  try {
    const user = await authService.register(req.body);
    res.status(201).json({
      status: 'success',
      message: 'Account created. Please check your email to verify your account.',
      data: { user },
    });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const user = await authService.login(req.body); // already sanitized by authService
    const { accessToken, refreshToken } = await authService.issueSession(user, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
    res.status(200).json({
      status: 'success',
      data: { user, accessToken },
    });
  } catch (err) {
    next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!rawRefreshToken) {
      return res.status(401).json({
        status: 'error',
        errorCode: 'AUTH_MISSING_REFRESH_TOKEN',
        message: 'No refresh token provided',
        requestId: req.requestId,
      });
    }

    const { accessToken, refreshToken } = await authService.refreshSession(rawRefreshToken, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
    res.status(200).json({ status: 'success', data: { accessToken } });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    await authService.logout(rawRefreshToken);
    const { maxAge, ...clearOptions } = refreshCookieOptions();
    res.clearCookie(REFRESH_COOKIE_NAME, clearOptions);
    res.status(200).json({ status: 'success', message: 'Logged out' });
  } catch (err) {
    next(err);
  }
}

async function me(req, res, next) {
  try {
    const user = await authService.findUserById(req.user.id);
    const subResult = await query(
      `SELECT plan, status, current_period_end FROM subscriptions WHERE user_id = $1`,
      [req.user.id]
    );
    res.status(200).json({
      status: 'success',
      data: { user: authService.sanitizeUser(user), subscription: subResult.rows[0] || null },
    });
  } catch (err) {
    next(err);
  }
}

// ------------------------------------------------------------------
// OAuth (Google)
// ------------------------------------------------------------------
// Both callbacks follow the same shape: establish our own session (refresh
// cookie) then redirect to a frontend landing page with NO token in the URL.
// The frontend page calls /api/auth/refresh (relying on the cookie just set)
// to obtain an access token — avoids ever putting a token in a URL, browser
// history, or server access logs.

async function googleAuth(req, res, next) {
  try {
    res.redirect(oauthService.buildGoogleAuthUrl());
  } catch (err) {
    next(err);
  }
}

async function googleCallback(req, res, _next) {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.redirect(`${config.frontendUrl}/login?error=oauth_denied`);
    }
    if (!state || !oauthService.verifyOAuthState(state)) {
      return res.redirect(`${config.frontendUrl}/login?error=oauth_invalid_state`);
    }

    const providerToken = await oauthService.exchangeGoogleCode(code);
    const profile = await oauthService.fetchGoogleProfile(providerToken);
    const user = await authService.findOrCreateOAuthUser({ provider: 'google', ...profile });

    const { refreshToken } = await authService.issueSession(user, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
    res.redirect(`${config.frontendUrl}/auth/callback`);
  } catch (err) {
    logger.error('Google OAuth callback failed', { error: err.message });
    res.redirect(`${config.frontendUrl}/login?error=oauth_failed`);
  }
}

module.exports = { register, login, refresh, logout, me, googleAuth, googleCallback };
