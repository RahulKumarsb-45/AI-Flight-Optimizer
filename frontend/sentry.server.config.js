// This file configures the initialization of Sentry on the server (Node.js
// runtime) side — SSR, route handlers, and server components.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
import * as Sentry from '@sentry/nextjs';

// NEXT_PUBLIC_* variables are inlined at build time into both client AND
// server bundles, so it's safe (and simpler) to reuse the same public DSN
// here rather than requiring a second, server-only env var.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: dsn || undefined,
  enabled: Boolean(dsn),
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
});
