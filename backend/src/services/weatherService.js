const axios = require('axios');
const config = require('../config/env');
const AppError = require('../utils/AppError');
const { weatherCache } = require('../cache/memoryCache');
const redisCache = require('../cache/redisCache');
const airportService = require('../providers/airport/airportService');

const CACHE_TTL_MS = config.weather.cacheTtlMinutes * 60 * 1000;
const REDIS_NAMESPACE = 'weathercache';

function redisKeyFor(cacheKey) {
  return `${REDIS_NAMESPACE}:${cacheKey}`;
}

/**
 * Same two-layer read used by cache/flightCache.js: in-process memory first
 * (this instance only), then Redis (shared across every backend instance —
 * a no-op that resolves to `undefined` immediately when REDIS_URL isn't
 * set/reachable, exactly like before this change). A Redis hit backfills
 * the memory cache so subsequent reads on this instance skip Redis too.
 * Returns `null` when neither layer has anything cached.
 */
async function getFromCache(cacheKey) {
  const memHit = weatherCache.get(cacheKey);
  if (memHit) return memHit;

  const redisResult = await redisCache.get(redisKeyFor(cacheKey));
  if (redisResult) {
    weatherCache.set(cacheKey, redisResult, CACHE_TTL_MS);
    return redisResult;
  }
  return null;
}

/**
 * Write-through: memory (this instance) + Redis (shared), same TTL as
 * before. redisCache.set() never rejects (see cache/redisCache.js) — a
 * Redis failure is already swallowed there and just means the next request
 * on another instance repeats this same provider call.
 */
function writeToCache(cacheKey, value) {
  weatherCache.set(cacheKey, value, CACHE_TTL_MS);
  redisCache.set(redisKeyFor(cacheKey), value, CACHE_TTL_MS);
}

function requireApiKey() {
  if (!config.weather.apiKey) {
    throw new AppError(
      'Weather is not configured. Set OPENWEATHER_API_KEY in .env.',
      500,
      'WEATHER_NOT_CONFIGURED'
    );
  }
}

function normalizeCurrent(data) {
  return {
    tempC: Math.round(data.main.temp),
    feelsLikeC: Math.round(data.main.feels_like),
    humidity: data.main.humidity,
    windKph: Math.round(data.wind.speed * 3.6),
    condition: data.weather[0]?.main,
    description: data.weather[0]?.description,
    icon: data.weather[0]?.icon,
    sunrise: new Date(data.sys.sunrise * 1000).toISOString(),
    sunset: new Date(data.sys.sunset * 1000).toISOString(),
    observedAt: new Date(data.dt * 1000).toISOString(),
  };
}

/**
 * Current weather for an airport (by IATA code, resolved to lat/lon via our
 * own airport dataset — never trusts a client-supplied lat/lon directly).
 */
async function getCurrentWeather(iataCode) {
  requireApiKey();
  const airport = airportService.requireByIata(iataCode);

  const cacheKey = `current:${iataCode}`;
  const cached = await getFromCache(cacheKey);
  if (cached) return cached;

  const response = await axios.get(`${config.weather.baseUrl}/weather`, {
    params: { lat: airport.lat, lon: airport.lon, units: 'metric', appid: config.weather.apiKey },
    timeout: 10000,
  });

  const result = {
    airport: { iata: airport.iata, city: airport.city, country: airport.country },
    ...normalizeCurrent(response.data),
  };
  writeToCache(cacheKey, result);
  return result;
}

/**
 * 5-day / 3-hour forecast, condensed to one representative entry per day
 * (closest to midday) — the free tier returns 40 x 3-hour slots, which is
 * more granularity than a trip-planning UI needs.
 */
async function getForecast(iataCode) {
  requireApiKey();
  const airport = airportService.requireByIata(iataCode);

  const cacheKey = `forecast:${iataCode}`;
  const cached = await getFromCache(cacheKey);
  if (cached) return cached;

  const response = await axios.get(`${config.weather.baseUrl}/forecast`, {
    params: { lat: airport.lat, lon: airport.lon, units: 'metric', appid: config.weather.apiKey },
    timeout: 10000,
  });

  const byDay = new Map();
  for (const slot of response.data.list) {
    const date = slot.dt_txt.split(' ')[0];
    const hour = parseInt(slot.dt_txt.split(' ')[1].split(':')[0], 10);
    const distanceFromMidday = Math.abs(hour - 12);
    const existing = byDay.get(date);
    if (!existing || distanceFromMidday < existing.distanceFromMidday) {
      byDay.set(date, { distanceFromMidday, slot });
    }
  }

  const days = Array.from(byDay.entries()).map(([date, { slot }]) => ({
    date,
    tempC: Math.round(slot.main.temp),
    condition: slot.weather[0]?.main,
    description: slot.weather[0]?.description,
    icon: slot.weather[0]?.icon,
    rainProbabilityPct: Math.round((slot.pop || 0) * 100),
  }));

  const result = {
    airport: { iata: airport.iata, city: airport.city, country: airport.country },
    days,
  };
  writeToCache(cacheKey, result);
  return result;
}

/**
 * SEASON GUIDANCE — DELIBERATELY A HEURISTIC, NOT DATA.
 *
 * Genuine month-by-month climate statistics require OpenWeather's One Call
 * API, which needs a payment card on file even within its free daily
 * allowance — not something to require for a demo. Rather than fabricate
 * precise-looking numbers we don't have, this gives honest, general
 * hemisphere/latitude-based guidance only, and flags itself as such so the
 * frontend can label it clearly rather than presenting it as measured data.
 */
function getSeasonGuidance(iataCode, month) {
  const airport = airportService.requireByIata(iataCode);
  const isNorthernHemisphere = airport.lat >= 0;
  const isTropical = Math.abs(airport.lat) < 23.5;

  let guidance;
  if (isTropical) {
    guidance =
      'This destination is near the equator, so temperatures stay fairly consistent year-round — the bigger factor is usually the wet vs. dry season rather than hot vs. cold.';
  } else {
    const localSummerMonths = isNorthernHemisphere ? [6, 7, 8] : [12, 1, 2];
    const localWinterMonths = isNorthernHemisphere ? [12, 1, 2] : [6, 7, 8];
    if (localSummerMonths.includes(month)) {
      guidance = `This is generally summer season here (${isNorthernHemisphere ? 'Northern' : 'Southern'} Hemisphere) — expect warmer weather.`;
    } else if (localWinterMonths.includes(month)) {
      guidance = `This is generally winter season here (${isNorthernHemisphere ? 'Northern' : 'Southern'} Hemisphere) — pack for cold weather.`;
    } else {
      guidance = `This falls in a shoulder season here (${isNorthernHemisphere ? 'Northern' : 'Southern'} Hemisphere) — moderate weather is typical, but check the forecast closer to your trip.`;
    }
  }

  return {
    airport: { iata: airport.iata, city: airport.city, country: airport.country },
    month,
    isGeneralGuidance: true,
    guidance,
  };
}

module.exports = { getCurrentWeather, getForecast, getSeasonGuidance };
