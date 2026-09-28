const { withSentryConfig } = require('@sentry/nextjs/config');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone', // produces a minimal self-contained server for Docker
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
};

// withSentryConfig injects the Sentry SDK and (optionally) uploads source
// maps at build time. It's safe to apply even with Sentry fully disabled
// (no NEXT_PUBLIC_SENTRY_DSN) — the app just won't send events. Source-map
// upload itself is a separate, independent step that silently no-ops
// without SENTRY_AUTH_TOKEN/SENTRY_ORG/SENTRY_PROJECT, so it never blocks
// or fails a normal `next build` for anyone who hasn't set those up.
module.exports = withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  telemetry: false,
  widenClientFileUpload: true,
  webpack: {
    removeDebugLogging: true,
    // This project doesn't use Vercel cron monitors or Sentry's tunnel route.
    automaticVercelMonitors: false,
  },
});
