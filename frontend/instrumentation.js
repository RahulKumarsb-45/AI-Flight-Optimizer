import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config.js');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config.js');
  }
}

// Captures errors thrown from nested React Server Components that Next.js
// itself intercepts (App Router), which otherwise wouldn't reach
// app/global-error.js.
export const onRequestError = Sentry.captureRequestError;
