const { v4: uuidv4 } = require('uuid');
const logger = require('../logger/logger');
const config = require('../config/env');
const AppError = require('../utils/AppError');

/**
 * Attaches a unique requestId to every request for tracing.
 */
function requestIdMiddleware(req, res, next) {
  req.requestId = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

/**
 * Catches unmatched routes.
 */
function notFoundHandler(req, res, next) {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404, 'ROUTE_NOT_FOUND'));
}

/**
 * Centralized error handler. Must be the LAST middleware.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const errorCode = isAppError ? err.errorCode : 'INTERNAL_ERROR';
  const message = isAppError || config.nodeEnv !== 'production'
    ? err.message
    : 'Something went wrong. Please try again.';

  logger.error(err.message, {
    requestId: req.requestId,
    statusCode,
    errorCode,
    path: req.originalUrl,
    method: req.method,
    stack: config.nodeEnv !== 'production' ? err.stack : undefined,
  });

  res.status(statusCode).json({
    status: 'error',
    errorCode,
    message,
    requestId: req.requestId,
  });
}

module.exports = { requestIdMiddleware, notFoundHandler, errorHandler };
