const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

/**
 * Resolve the .env file from NODE_ENV so every entry point
 * uses the same environment file for the same environment.
 *
 * - development/production -> .env
 * - test -> .env.test
 */
const envFile =
  process.env.NODE_ENV === 'test'
    ? '.env.test'
    : '.env';

const envPath = path.join(
  __dirname,
  '..',
  '..',
  envFile
);

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

function required(name, fallback = undefined) {
  const value = process.env[name] ?? fallback;

  if (value === undefined) {
    // eslint-disable-next-line no-console
    console.warn(
      `[config] Missing env var: ${name} (continuing with undefined — set this before production use)`
    );
  }

  return value;
}

/**
 * Secrets that must exist in production.
 * Development/test environments can use a fallback.
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
    console.warn(
      `[config] Missing env var: ${name} — using an insecure dev-only fallback. Do not deploy like this.`
    );

    return devFallback;
  }

  return value;
}

module.exports = {
  // ============================================================
  // Application
  // ============================================================

  nodeEnv:
    process.env.NODE_ENV || 'development',

  port:
    parseInt(process.env.PORT || '5000', 10),

  frontendUrl:
    process.env.FRONTEND_URL ||
    'http://localhost:3000',

  // ============================================================
  // Database
  // ============================================================

  db: {
    url:
      required('DATABASE_URL'),

    ssl:
      process.env.PG_SSL === 'true',
  },

  // ============================================================
  // JWT
  // ============================================================

  jwt: {
    accessSecret:
      requiredInProduction(
        'JWT_ACCESS_SECRET',
        'dev_access_secret_change_me'
      ),

    refreshSecret:
      requiredInProduction(
        'JWT_REFRESH_SECRET',
        'dev_refresh_secret_change_me'
      ),

    accessExpires:
      process.env.JWT_ACCESS_EXPIRES || '15m',

    refreshExpires:
      process.env.JWT_REFRESH_EXPIRES || '30d',
  },

  // ============================================================
  // OAuth
  // ============================================================

  oauth: {
    google: {
      clientId:
        process.env.GOOGLE_CLIENT_ID,

      clientSecret:
        process.env.GOOGLE_CLIENT_SECRET,

      callbackUrl:
        process.env.GOOGLE_CALLBACK_URL,
    },
  },

  // ============================================================
  // Flight Provider
  // ============================================================

  flightProvider:
    process.env.FLIGHT_PROVIDER || 'mock',

  amadeus: {
    clientId:
      process.env.AMADEUS_CLIENT_ID,

    clientSecret:
      process.env.AMADEUS_CLIENT_SECRET,

    baseUrl:
      process.env.AMADEUS_BASE_URL ||
      'https://test.api.amadeus.com',
  },

  ignav: {
    apiKey:
      process.env.IGNAV_API_KEY,

    baseUrl:
      process.env.IGNAV_BASE_URL ||
      'https://ignav.com/api',

    market:
      process.env.IGNAV_MARKET || 'IN',
  },

  // ============================================================
  // AI / SHREYA
  // ============================================================
  //
  // Groq is the primary AI provider.
  // Current model: openai/gpt-oss-120b
  // Anthropic remains available as an optional provider.
  //

  ai: {
    provider:
      process.env.AI_PROVIDER || 'groq',

    groq: {
      apiKey:
        process.env.GROQ_API_KEY,

      model:
        process.env.GROQ_MODEL ||
        'openai/gpt-oss-120b',
    },

    anthropic: {
      apiKey:
        process.env.ANTHROPIC_API_KEY,

      model:
        process.env.ANTHROPIC_MODEL ||
        'claude-sonnet-4-6',
    },
  },

  // ============================================================
  // Weather
  // ============================================================

  weather: {
    apiKey:
      process.env.OPENWEATHER_API_KEY,

    baseUrl:
      'https://api.openweathermap.org/data/2.5',

    cacheTtlMinutes:
      parseInt(
        process.env.WEATHER_CACHE_TTL_MINUTES || '30',
        10
      ),
  },

  // ============================================================
  // Places
  // ============================================================
  //
  // Google Places has been replaced by Geoapify.
  //

  places: {
    apiKey:
      process.env.GEOAPIFY_API_KEY,

    cacheTtlHours:
      parseInt(
        process.env.PLACES_CACHE_TTL_HOURS || '24',
        10
      ),
  },

  // ============================================================
  // Budget Optimizer
  // ============================================================

  budget: {
    dailyLivingCostMinInr:
      parseInt(
        process.env.BUDGET_DAILY_MIN_INR || '1500',
        10
      ),

    dailyLivingCostMaxInr:
      parseInt(
        process.env.BUDGET_DAILY_MAX_INR || '4000',
        10
      ),

    accommodationShare:
      parseFloat(
        process.env.BUDGET_ACCOMMODATION_SHARE || '0.5'
      ),

    foodShare:
      parseFloat(
        process.env.BUDGET_FOOD_SHARE || '0.3'
      ),

    localTransportShare:
      parseFloat(
        process.env.BUDGET_LOCAL_TRANSPORT_SHARE || '0.2'
      ),
  },

  // ============================================================
  // Razorpay
  // ============================================================

  razorpay: {
    keyId:
      process.env.RAZORPAY_KEY_ID,

    keySecret:
      process.env.RAZORPAY_KEY_SECRET,

    webhookSecret:
      process.env.RAZORPAY_WEBHOOK_SECRET,
  },

  // ============================================================
  // Email
  // ============================================================

  email: {
    resendApiKey:
      process.env.RESEND_API_KEY,

    from:
      process.env.EMAIL_FROM ||
      'noreply@flightoptimizer.app',
  },

  // ============================================================
  // Optimizer
  // ============================================================

  optimizer: {
    maxNearbyAirports:
      parseInt(
        process.env.MAX_NEARBY_AIRPORTS || '3',
        10
      ),

    maxDateFlexDays:
      parseInt(
        process.env.MAX_DATE_FLEX_DAYS || '3',
        10
      ),

    maxPermutations:
      parseInt(
        process.env.MAX_PERMUTATIONS || '500',
        10
      ),

    maxCountriesPerTrip:
      parseInt(
        process.env.MAX_COUNTRIES_PER_TRIP || '4',
        10
      ),
  },

  // ============================================================
  // Cache
  // ============================================================

  cache: {
    flightTtlMinutes:
      parseInt(
        process.env.FLIGHT_CACHE_TTL_MINUTES || '20',
        10
      ),

    staticTtlHours:
      parseInt(
        process.env.STATIC_TTL_HOURS || '24',
        10
      ),
  },

  // ============================================================
  // Redis
  // ============================================================

  redis: {
    url:
      process.env.REDIS_URL || null,
  },

  // ============================================================
  // Sentry
  // ============================================================

  sentry: {
    dsn:
      process.env.SENTRY_DSN || '',

    environment:
      process.env.SENTRY_ENVIRONMENT ||
      process.env.NODE_ENV ||
      'development',

    release:
      process.env.SENTRY_RELEASE ||
      undefined,

    tracesSampleRate: (() => {
      const value = parseFloat(
        process.env.SENTRY_TRACES_SAMPLE_RATE
      );

      return Number.isFinite(value)
        ? value
        : 0.1;
    })(),

    enabled:
      !!process.env.SENTRY_DSN &&
      process.env.SENTRY_ENABLED !== 'false' &&
      process.env.NODE_ENV !== 'test',
  },
};