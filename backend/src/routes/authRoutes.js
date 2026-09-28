const express = require('express');
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const { registerValidator, loginValidator } = require('../validators/authValidators');
const { requireAuth } = require('../middleware/auth');
const config = require('../config/env');

const router = express.Router();

// Stricter rate limit on auth routes to slow down brute-force / credential stuffing.
// Disabled in tests: a full auth test suite can legitimately register/login more
// than 10 times a minute, and that's not the abuse pattern this limit targets.
const authLimiter =
  config.nodeEnv === 'test'
    ? (req, res, next) => next()
    : rateLimit({
        windowMs: 1 * 60 * 1000, // 1 minute
        max: 10,
        standardHeaders: true,
        legacyHeaders: false,
        message: {
          status: 'error',
          errorCode: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many attempts. Please try again in a minute.',
        },
      });

router.post('/register', authLimiter, registerValidator, authController.register);
router.post('/login', authLimiter, loginValidator, authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.get('/me', requireAuth, authController.me);

// OAuth routes (Google). If GOOGLE_CLIENT_ID isn't set in .env, the
// controller throws a clear OAUTH_NOT_CONFIGURED error rather than silently
// redirecting somewhere broken.
router.get('/google', authController.googleAuth);
router.get('/google/callback', authController.googleCallback);

module.exports = router;
