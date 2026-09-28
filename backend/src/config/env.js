const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

/**
 * Which .env file backs process.env is derived from NODE_ENV so every
 * entry point that loads this module — src/server.js, src/database/
 * migrate.js, src/database/seed.js, AND the Jest test run — resolves to
 * the SAME file for the SAME NODE_ENV, instead of each entry point
 * deciding independently.
 *
 * Previously this was a bare `require('dotenv').config()`, which always
 * loads plain `.env` no matter what NODE_ENV was. Jest happened to look
 * right anyway ONLY because tests/setupEnv.js (a Jest `setupFiles` entry)
 * runs earlier and manually loads `.env.test` first — dotenv never
 * overwrites a variable that's already set, so that early load "won".
 * But running `npm run migrate` directly (as the docs instruct when
 * setting up a dedicated test database) went through this exact line
 * with no such head start: it always applied schema.sql to `.env`'s
 * database, never `.env.test`'s — even when NODE_ENV=test was set — so a
 * schema change (like adding `trip_shares`) could be migrated into the
 * dev database while the test database silently never received it.
 * Resolving the file here, once, for every entry point closes that gap.
 */
const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
const envPath = path.join(__dirname, '..', '..', envFile);
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config(); // fall back to default .env resolution
}

function required(name, fallback = undefined) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    // eslint-disable-next-line no-console
    console.warn(`[config] Missing env var: ${name} (continuing with undefined — set this before production use)`);
  }
  return value;
}

/**
 * For secrets where a dev-convenience fallback would be a real security hole
 * in production (JWT signing secrets, etc.) — refuses to boot rather than
 * silently signing tokens with a fallback value that's public knowledge
 * (it's sitting in this very file).
 */
function requiredInProduction(name, devFallback) {
  const value = process.env[name];
  if (!value) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        `[config] FATAL: ${name} must be set in production. Refusing to start with an insecure default.`
      );
    }
    // eslint-disable-next-line no-console
    console.warn(`[config] Missing env var: ${name} — using an insecure dev-only fallback. Do not deploy like this.`);
    return devFallback;
  }
  return value;
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',

  db: {
    url: required('DATABASE_URL'),
    ssl: process.env.PG_SSL === 'true',
  },

  jwt: {
    accessSecret: requiredInProduction('JWT_ACCESS_SECRET', 'dev_access_secret_change_me'),
    refreshSecret: requiredInProduction('JWT_REFRESH_SECRET', 'dev_refresh_secret_change_me'),
    accessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
    refreshExpires: process.env.JWT_REFRESH_EXPIRES || '30d',
  },

  oauth: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackUrl: process.env.GOOGLE_CALLBACK_URL,
    },
  },

  flightProvider: process.env.FLIGHT_PROVIDER || 'mock',
  amadeus: {
    clientId: process.env.AMADEUS_CLIENT_ID,
    clientSecret: process.env.AMADEUS_CLIENT_SECRET,
    baseUrl: process.env.AMADEUS_BASE_URL || 'https://test.api.amadeus.com',
  },
  ignav: {
    apiKey: process.env.IGNAV_API_KEY,
    baseUrl: process.env.IGNAV_BASE_URL || 'https://ignav.com/api',
    // Ignav's `market` param controls result currency/locale. Defaulting to
    // 'IN' means fares come back priced in INR directly from the provider —
    // no client-side currency conversion (and therefore no invented exchange
    // rate) is needed to match the app's existing INR-only display.
    market: process.env.IGNAV_MARKET || 'IN',
  },

  ai: {
    provider: process.env.AI_PROVIDER || 'gemini', // gemini | anthropic
    gemini: {
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    },
  },

  weather: {
    apiKey: process.env.OPENWEATHER_API_KEY,
    baseUrl: 'https://api.openweathermap.org/data/2.5', // free tier: current + 5-day/3-hour forecast only
    cacheTtlMinutes: parseInt(process.env.WEATHER_CACHE_TTL_MINUTES || '30', 10),
  },

  places: {
    apiKey: process.env.GOOGLE_PLACES_API_KEY,
    cacheTtlHours: parseInt(process.env.PLACES_CACHE_TTL_HOURS || '24', 10),
  },

  // Rough, destination-agnostic planning heuristics used by the Budget
  // Optimizer to estimate "living cost" (hotel + food + local transport)
  // per traveler per day, on top of the real flight price. These are NOT
  // pulled from any pricing API (none is configured for hotel/food rates) —
  // they are intentionally a wide, clearly-labeled range so the UI never
  // implies more precision than it has. Overridable via env for tuning.
  budget: {
    dailyLivingCostMinInr: parseInt(process.env.BUDGET_DAILY_MIN_INR || '1500', 10),
    dailyLivingCostMaxInr: parseInt(process.env.BUDGET_DAILY_MAX_INR || '4000', 10),
    // How the single "daily living cost" range above is split into the
    // categories shown in the Budget Optimizer breakdown. These are rough
    // proportions (not sourced from any pricing API either), used only to
    // turn one combined range into labeled sub-estimates. Must sum to 1.
    accommodationShare: parseFloat(process.env.BUDGET_ACCOMMODATION_SHARE || '0.5'),
    foodShare: parseFloat(process.env.BUDGET_FOOD_SHARE || '0.3'),
    localTransportShare: parseFloat(process.env.BUDGET_LOCAL_TRANSPORT_SHARE || '0.2'),
  },

  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  },

  email: {
    resendApiKey: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM || 'noreply@flightoptimizer.app',
  },

  optimizer: {
    maxNearbyAirports: parseInt(process.env.MAX_NEARBY_AIRPORTS || '3', 10),
    maxDateFlexDays: parseInt(process.env.MAX_DATE_FLEX_DAYS || '3', 10),
    maxPermutations: parseInt(process.env.MAX_PERMUTATIONS || '500', 10),
    maxCountriesPerTrip: parseInt(process.env.MAX_COUNTRIES_PER_TRIP || '4', 10),
  },

  cache: {
    flightTtlMinutes: parseInt(process.env.FLIGHT_CACHE_TTL_MINUTES || '20', 10),
    staticTtlHours: parseInt(process.env.STATIC_CACHE_TTL_HOURS || '24', 10),
  },

  // Optional. When unset, the app runs entirely on its existing Postgres
  // (flight_cache table) and in-memory (cache/memoryCache.js) caches —
  // Redis is a pure accelerator, never a hard requirement.
  redis: {
    url: process.env.REDIS_URL || null,
  },

  // Optional error monitoring. Sentry is only ever active when a DSN is
  // configured AND it hasn't been explicitly disabled — never active in
  // tests regardless of DSN, so test runs stay hermetic (no outbound
  // network calls, no dependency on a real Sentry project).
  sentry: {
    dsn: process.env.SENTRY_DSN || '',
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE || undefined,
    tracesSampleRate: (() => {
      const v = parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE);
      return Number.isFinite(v) ? v : 0.1;
    })(),
    enabled:
      !!process.env.SENTRY_DSN &&
      process.env.SENTRY_ENABLED !== 'false' &&
      process.env.NODE_ENV !== 'test',
  },
};
