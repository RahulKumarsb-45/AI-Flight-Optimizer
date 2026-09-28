// This file configures the initialization of Sentry for the edge runtime
// (middleware, edge route handlers) — a separate, more limited runtime from
// the Node.js server, so it gets its own config file.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: dsn || undefined,
  enabled: Boolean(dsn),
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
});
