// Sentry must be initialized before any other module (especially `express`
// and `http`) is required, so its instrumentation can patch them. This file
// has no other job — keep it side-effect-only and require it first thing in
// both app.js and server.js.
const Sentry = require('@sentry/node');
const config = require('./config/env');
const { scrubEvent } = require('./sentry/scrubEvent');

if (config.sentry.enabled) {
  Sentry.init({
    dsn: config.sentry.dsn,
    environment: config.sentry.environment,
    release: config.sentry.release,
    tracesSampleRate: config.sentry.tracesSampleRate,
    // We do our own explicit scrubbing (below) rather than relying on
    // Sentry's default PII inclusion.
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
  });
}

module.exports = Sentry;
