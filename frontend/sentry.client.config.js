// This file configures the initialization of Sentry for the client (browser)
// runtime. The config here is available for both client- and server-side
// rendering, but only the client-side bundle actually loads this file.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
import * as Sentry from '@sentry/nextjs';

// The DSN is not a secret (Sentry documents it as safe to expose publicly —
// it can only submit events, not read/modify project data), which is why it
// goes through NEXT_PUBLIC_* rather than a server-only env var.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: dsn || undefined,
  // No DSN => no client, no events sent, and no network calls, regardless
  // of what else is configured below.
  enabled: Boolean(dsn),
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
  tracesSampleRate: 0.1,
  // We don't currently use Session Replay; leaving it off avoids capturing
  // any DOM/user content by default until it's deliberately reviewed and
  // configured with masking.
  sendDefaultPii: false,
});
