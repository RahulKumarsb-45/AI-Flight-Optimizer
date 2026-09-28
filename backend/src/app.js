// Must be required first: Sentry needs to be initialized before express/http
// are required so its instrumentation can patch them.
const Sentry = require('./instrument');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const config = require('./config/env');
const logger = require('./logger/logger');
const routes = require('./routes/index');
const AppError = require('./utils/AppError');
const { requestIdMiddleware, notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();

// Required when deployed behind a reverse proxy (Render, Vercel, etc.) so that
// req.ip reflects the real client IP (from X-Forwarded-For) rather than the
// proxy's IP. Without this, per-IP rate limiting is effectively disabled in
// production (every request appears to come from the same proxy IP) and
// express-rate-limit will warn about an unsafe X-Forwarded-For configuration.
if (config.nodeEnv === 'production') {
  app.set('trust proxy', 1);
}

// ------------------------------------------------------------------
// Security & core middleware
// ------------------------------------------------------------------
app.use(helmet());
app.use(
  cors({
    origin: config.frontendUrl,
    credentials: true, // required so the httpOnly refresh_token cookie is sent/received
  })
);
app.use(
  express.json({
    limit: '1mb',
    verify: (req, res, buf) => {
      req.rawBody = buf; // needed for webhook signature verification (Razorpay, etc.)
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
app.use(requestIdMiddleware);

// General API rate limit (auth routes have their own stricter limit).
// Skipped entirely in tests — automated test suites fire many requests in
// quick succession and aren't the traffic pattern this limit protects against.
if (config.nodeEnv !== 'test') {
  app.use(
    '/api',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );
}

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info('request', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - start,
    });
  });
  next();
});

// ------------------------------------------------------------------
// Routes
// ------------------------------------------------------------------
app.use('/api', routes);

// ------------------------------------------------------------------
// Error handling (must be last)
// ------------------------------------------------------------------
app.use(notFoundHandler);

// Reports errors to Sentry, then calls next(err) so our own errorHandler
// still runs and the API response shape/status codes are unchanged.
// Expected 4xx AppErrors (validation, bad credentials, not-found, etc.) are
// normal application flow and are not forwarded — only 5xx AppErrors and
// truly unexpected (non-AppError) exceptions are.
Sentry.setupExpressErrorHandler(app, {
  shouldHandleError(error) {
    if (error instanceof AppError) return error.statusCode >= 500;
    return true;
  },
});

app.use(errorHandler);

module.exports = app;
