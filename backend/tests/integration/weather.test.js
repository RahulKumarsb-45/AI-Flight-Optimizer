/**
 * Q4 Weather + Season — Batch 1: HTTP-level integration tests.
 *
 * These exercise the REAL production code path over HTTP:
 *   routes/weatherRoutes.js -> validators/weatherValidators.js
 *     -> controllers/weatherController.js -> services/weatherService.js
 *     -> providers/airport/airportService.js (real, static dataset)
 *
 * Only `axios` is mocked (the boundary weatherService uses to reach the
 * external OpenWeather API). No real API key or network call is ever made.
 * Unlike the AI Agent routes (Q3), the weather routes touch no database at
 * all, so — unlike aiAgent.test.js — there is no `database/pool` mock here;
 * this file runs against the real Express app with nothing DB-related
 * stubbed, which is possible precisely because weatherController/
 * weatherService never import the DB layer (confirmed by reading the
 * source files above).
 *
 * CONFIRMED BY READING CURRENT CODE (do not re-derive elsewhere):
 *   - routes/weatherRoutes.js has a code comment stating weather is
 *     deliberately public ("No auth required — weather is free-tier,
 *     low-cost, and useful to guests browsing search results.") and none
 *     of its three routes use `requireAuth`. This suite verifies that is
 *     actually true rather than assuming it.
 *   - `iataParamValidator` requires exactly 3 alphabetic characters for
 *     `:iataCode`; `seasonValidator` additionally allows an optional
 *     `month` query param, which must be an integer 1-12 if present.
 *   - All three routes return `{ status: 'success', data: {...} }` on
 *     success (same envelope shape used across this codebase's other
 *     routes) and the shared `errorHandler` shape
 *     `{ status: 'error', errorCode, message, requestId }` on failure.
 */

jest.mock('axios');
const axios = require('axios');

const request = require('supertest');
const app = require('../../src/app');
const config = require('../../src/config/env');
const { weatherCache } = require('../../src/cache/memoryCache');

const ORIGINAL_WEATHER_CONFIG = JSON.parse(JSON.stringify(config.weather));

beforeEach(() => {
  jest.clearAllMocks();
  // weatherCache is a module-level singleton shared across every request in
  // this file (real production cache, not mocked) — clear it before each
  // test so an earlier test's cached DEL entry never short-circuits a later
  // test's axios-call/error-path assertions.
  weatherCache.clear();
  config.weather.apiKey = 'fake-test-openweather-key';
});

afterEach(() => {
  config.weather.apiKey = ORIGINAL_WEATHER_CONFIG.apiKey;
  weatherCache.clear();
});

function currentWeatherSuccess() {
  return {
    data: {
      main: { temp: 29.6, feels_like: 31.2, humidity: 55 },
      wind: { speed: 4 },
      weather: [{ main: 'Clear', description: 'clear sky', icon: '01d' }],
      sys: { sunrise: 1735600000, sunset: 1735640000 },
      dt: 1735620000,
    },
  };
}

function forecastSuccess() {
  return {
    data: {
      list: [
        { dt_txt: '2026-11-01 12:00:00', main: { temp: 28 }, weather: [{ main: 'Clear', description: 'clear sky', icon: '01d' }], pop: 0.1 },
        { dt_txt: '2026-11-02 12:00:00', main: { temp: 27 }, weather: [{ main: 'Rain', description: 'light rain', icon: '10d' }], pop: 0.6 },
      ],
    },
  };
}

// ---------------------------------------------------------------------
// 1. Valid requests & expected response shapes
// ---------------------------------------------------------------------
describe('GET /api/weather/:iataCode/current — valid request', () => {
  test('returns 200 with the expected success envelope and normalized weather shape', async () => {
    axios.get.mockResolvedValueOnce(currentWeatherSuccess());

    const res = await request(app).get('/api/weather/DEL/current');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'success',
      data: {
        airport: { iata: 'DEL', city: 'New Delhi', country: 'India' },
        tempC: 30,
        feelsLikeC: 31,
        humidity: 55,
        windKph: Math.round(4 * 3.6),
        condition: 'Clear',
        description: 'clear sky',
        icon: '01d',
        sunrise: expect.any(String),
        sunset: expect.any(String),
        observedAt: expect.any(String),
      },
    });
  });

  test('accepts a lowercase IATA code (validator only checks isAlpha/length, not case)', async () => {
    axios.get.mockResolvedValueOnce(currentWeatherSuccess());

    const res = await request(app).get('/api/weather/del/current');

    expect(res.status).toBe(200);
    expect(res.body.data.airport.iata).toBe('DEL'); // airport lookup itself uppercases internally
  });
});

describe('GET /api/weather/:iataCode/forecast — valid request', () => {
  test('returns 200 with the expected success envelope and one entry per day', async () => {
    axios.get.mockResolvedValueOnce(forecastSuccess());

    const res = await request(app).get('/api/weather/DEL/forecast');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.airport).toEqual({ iata: 'DEL', city: 'New Delhi', country: 'India' });
    expect(res.body.data.days).toEqual([
      { date: '2026-11-01', tempC: 28, condition: 'Clear', description: 'clear sky', icon: '01d', rainProbabilityPct: 10 },
      { date: '2026-11-02', tempC: 27, condition: 'Rain', description: 'light rain', icon: '10d', rainProbabilityPct: 60 },
    ]);
  });
});

describe('GET /api/weather/:iataCode/season — valid request', () => {
  test('returns 200 with general (non-measured) season guidance, and does not require the provider/API key', async () => {
    config.weather.apiKey = undefined; // proves this endpoint never touches the provider

    const res = await request(app).get('/api/weather/DEL/season?month=7');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'success',
      data: {
        airport: { iata: 'DEL', city: 'New Delhi', country: 'India' },
        month: 7,
        isGeneralGuidance: true,
        guidance: expect.any(String),
      },
    });
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('defaults month to the current month when not supplied', async () => {
    const res = await request(app).get('/api/weather/DEL/season');

    expect(res.status).toBe(200);
    expect(res.body.data.month).toBe(new Date().getMonth() + 1);
  });
});

// ---------------------------------------------------------------------
// 2. Invalid / missing location input
// ---------------------------------------------------------------------
describe('Weather routes — invalid/missing location input', () => {
  test('a too-short iataCode is rejected with 400 VALIDATION_ERROR before the provider is ever called', async () => {
    const res = await request(app).get('/api/weather/DE/current');

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('a too-long iataCode is rejected with 400 VALIDATION_ERROR', async () => {
    const res = await request(app).get('/api/weather/DELHI/current');

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('a non-alphabetic iataCode (numbers) is rejected with 400 VALIDATION_ERROR', async () => {
    const res = await request(app).get('/api/weather/123/current');

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('a well-formed but unknown/non-existent 3-letter airport code is rejected with 400 AIRPORT_NOT_FOUND (passes validation, fails at the service layer)', async () => {
    const res = await request(app).get('/api/weather/ZZZ/current');

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('AIRPORT_NOT_FOUND');
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('an out-of-range season month is rejected with 400 VALIDATION_ERROR', async () => {
    const res = await request(app).get('/api/weather/DEL/season?month=13');

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
  });

  test('a non-numeric season month is rejected with 400 VALIDATION_ERROR', async () => {
    const res = await request(app).get('/api/weather/DEL/season?month=july');

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
  });

  test('missing iataCode entirely (no route match) results in a 404, not a 500 or a crash', async () => {
    const res = await request(app).get('/api/weather//current');

    expect([404, 400]).toContain(res.status); // exact code depends on Express's route-matching for an empty param segment
  });
});

// ---------------------------------------------------------------------
// 3. Authentication requirement
// ---------------------------------------------------------------------
describe('Weather routes — authentication is NOT required (per current code)', () => {
  test('GET .../current succeeds with no Authorization header at all', async () => {
    axios.get.mockResolvedValueOnce(currentWeatherSuccess());
    const res = await request(app).get('/api/weather/DEL/current');
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(200);
  });

  test('GET .../forecast succeeds with no Authorization header at all', async () => {
    axios.get.mockResolvedValueOnce(forecastSuccess());
    const res = await request(app).get('/api/weather/DEL/forecast');
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(200);
  });

  test('GET .../season succeeds with no Authorization header at all', async () => {
    const res = await request(app).get('/api/weather/DEL/season');
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(200);
  });

  test('a garbage Authorization header does not break the (unauthenticated) route — it is simply ignored', async () => {
    axios.get.mockResolvedValueOnce(currentWeatherSuccess());
    const res = await request(app)
      .get('/api/weather/DEL/current')
      .set('Authorization', 'Bearer not-a-real-jwt');
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------
// 4. Safe error responses & security (no secret/config/stack-trace leakage)
// ---------------------------------------------------------------------
describe('Weather routes — safe error responses & security', () => {
  test('missing OPENWEATHER_API_KEY surfaces as 500 WEATHER_NOT_CONFIGURED without leaking internals', async () => {
    config.weather.apiKey = undefined;

    const res = await request(app).get('/api/weather/DEL/current');

    expect(res.status).toBe(500);
    expect(res.body.errorCode).toBe('WEATHER_NOT_CONFIGURED');
    expect(axios.get).not.toHaveBeenCalled();
    expect(res.body.stack).toBeUndefined();
  });

  test('a provider HTTP error surfaces as a failed response, not a 200, and never exposes the configured API key', async () => {
    const providerError = new Error('Request failed with status code 500');
    providerError.response = { status: 500, data: { message: 'internal error' } };
    axios.get.mockRejectedValueOnce(providerError);

    const res = await request(app).get('/api/weather/DEL/current');

    expect(res.status).toBe(500);
    expect(res.body.status).toBe('error');
    expect(JSON.stringify(res.body)).not.toContain(config.weather.apiKey);
  });

  test('a provider timeout surfaces as a failed response, not a hang or a 200', async () => {
    const timeoutError = new Error('timeout of 10000ms exceeded');
    timeoutError.code = 'ECONNABORTED';
    axios.get.mockRejectedValueOnce(timeoutError);

    const res = await request(app).get('/api/weather/DEL/forecast');

    expect(res.status).toBe(500);
    expect(res.body.status).toBe('error');
  });

  test('a provider 429 rate-limit response surfaces as a failed response (no special-cased handling exists for weather)', async () => {
    const rateLimitError = new Error('Request failed with status code 429');
    rateLimitError.response = { status: 429, data: { message: 'rate limited' } };
    axios.get.mockRejectedValueOnce(rateLimitError);

    const res = await request(app).get('/api/weather/DEL/current');

    expect(res.status).toBe(500);
    expect(res.body.status).toBe('error');
  });

  test('malformed (non-JSON-shaped) provider output surfaces as a failed response, never a 200 with garbage data', async () => {
    axios.get.mockResolvedValueOnce({ data: { unexpected: 'shape' } });

    const res = await request(app).get('/api/weather/DEL/current');

    expect(res.status).toBe(500);
    expect(res.body.status).toBe('error');
  });

  test('an empty provider response surfaces as a failed response, never a 200 with garbage data', async () => {
    axios.get.mockResolvedValueOnce({ data: {} });

    const res = await request(app).get('/api/weather/DEL/current');

    expect(res.status).toBe(500);
    expect(res.body.status).toBe('error');
  });

  test('the configured OpenWeather API key is never exposed in a successful response', async () => {
    axios.get.mockResolvedValueOnce(currentWeatherSuccess());

    const res = await request(app).get('/api/weather/DEL/current');

    expect(JSON.stringify(res.body)).not.toContain(config.weather.apiKey);
  });

  test('no response (success or error) ever includes a Node stack trace or the raw axios error config (which would carry the appid query param)', async () => {
    const providerError = new Error('Request failed with status code 401');
    providerError.response = { status: 401, data: { message: 'Invalid API key' } };
    providerError.config = { url: `${config.weather.baseUrl}/weather`, params: { appid: config.weather.apiKey } };
    axios.get.mockRejectedValueOnce(providerError);

    const res = await request(app).get('/api/weather/DEL/current');

    expect(res.body).not.toHaveProperty('config');
    expect(res.body.stack).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
    expect(JSON.stringify(res.body)).not.toContain(config.weather.apiKey);
  });

  test('no response ever includes the DB connection string or JWT signing secrets (defense in depth — weather touches neither)', async () => {
    axios.get.mockRejectedValueOnce(new Error('connect ETIMEDOUT'));

    const res = await request(app).get('/api/weather/DEL/current');

    const body = JSON.stringify(res.body);
    expect(body).not.toContain(config.jwt.accessSecret);
    expect(body).not.toContain(config.jwt.refreshSecret);
    if (config.db.url) expect(body).not.toContain(config.db.url);
    expect(body).not.toMatch(/postgres(ql)?:\/\/[^"]*:[^"]*@/i);
  });
});
