/**
 * Q4 Weather + Season — Batch 1: unit tests for the weather SERVICE layer
 * (src/services/weatherService.js).
 *
 * These call the REAL service function directly (no HTTP layer, no
 * database) and mock only `axios`, the exact boundary weatherService uses
 * to reach the external OpenWeather API. No real API key or network call is
 * ever made. The real in-process cache (cache/memoryCache.js -> weatherCache)
 * and the real airport dataset (providers/airport/airportService.js) are
 * used as-is, same as the equivalent pattern in tests/unit/flightCache.test.js
 * and tests/unit/aiProvider.test.js.
 *
 * CONFIRMED BY READING CURRENT CODE (do not re-derive elsewhere):
 *   - getCurrentWeather/getForecast both: (1) requireApiKey() FIRST — this
 *     runs even before the airport lookup or the cache check, so a missing
 *     key short-circuits everything, even a cache hit; (2) resolve the
 *     IATA code to lat/lon via the app's own static airport dataset — the
 *     provider is called with `lat`/`lon`/`units=metric`/`appid`, never a
 *     client-supplied location string; (3) cache under `current:<iataCode>`
 *     / `forecast:<iataCode>` in the in-process `weatherCache` singleton for
 *     `config.weather.cacheTtlMinutes` minutes (30 in tests/.env.test).
 *   - There is no special-cased handling anywhere in weatherService for a
 *     provider HTTP error, timeout, or 429 — any axios rejection simply
 *     propagates unchanged out of the service function (same "no special
 *     retry/backoff" shape as the AI provider layer in Q3).
 *   - There is no try/catch around parsing the provider response — a
 *     malformed/empty `response.data` shape causes normalizeCurrent()/the
 *     forecast day-bucketing loop to throw a plain TypeError, which also
 *     propagates unchanged (not wrapped in an AppError).
 *   - `getSeasonGuidance` is synchronous, never calls the provider, never
 *     touches the cache, and does not require `config.weather.apiKey` at
 *     all — it only needs airport lat/lon from the static dataset.
 *   - `weatherCache` (cache/memoryCache.js) is a plain synchronous
 *     in-process Map wrapper — get/set never reject or return promises, and
 *     there is no separate Redis/network boundary for weather caching (that
 *     only exists for the flight-search cache in cache/flightCache.js,
 *     which this suite does not touch).
 */

jest.mock('axios');
const axios = require('axios');

const config = require('../../src/config/env');
const weatherService = require('../../src/services/weatherService');
const { weatherCache } = require('../../src/cache/memoryCache');
const AppError = require('../../src/utils/AppError');

const ORIGINAL_WEATHER_CONFIG = JSON.parse(JSON.stringify(config.weather));

// DEL: Northern Hemisphere, non-tropical (lat 28.5562, lon 77.1) — used as
// the default "known good" airport across this file.
const DEL = { iata: 'DEL', city: 'New Delhi', country: 'India', lat: 28.5562, lon: 77.1 };

beforeEach(() => {
  jest.clearAllMocks();
  weatherCache.clear(); // the in-process cache is a module-level singleton — isolate every test
  config.weather.apiKey = 'fake-test-openweather-key';
});

afterEach(() => {
  config.weather.apiKey = ORIGINAL_WEATHER_CONFIG.apiKey;
  config.weather.baseUrl = ORIGINAL_WEATHER_CONFIG.baseUrl;
  config.weather.cacheTtlMinutes = ORIGINAL_WEATHER_CONFIG.cacheTtlMinutes;
  weatherCache.clear();
});

function currentWeatherSuccess({ temp = 30, feelsLike = 32, humidity = 60, windSpeedMs = 5 } = {}) {
  return {
    data: {
      main: { temp, feels_like: feelsLike, humidity },
      wind: { speed: windSpeedMs },
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
        { dt_txt: '2026-11-01 15:00:00', main: { temp: 30 }, weather: [{ main: 'Clouds', description: 'few clouds', icon: '02d' }], pop: 0.2 },
        { dt_txt: '2026-11-02 12:00:00', main: { temp: 27 }, weather: [{ main: 'Rain', description: 'light rain', icon: '10d' }], pop: 0.6 },
      ],
    },
  };
}

// ---------------------------------------------------------------------
// 1. Valid requests / correct provider parameters / successful response
// ---------------------------------------------------------------------
describe('weatherService.getCurrentWeather — valid request & provider parameters', () => {
  test('resolves an airport IATA code to lat/lon from the static dataset and calls the provider with the correct params', async () => {
    axios.get.mockResolvedValueOnce(currentWeatherSuccess());

    await weatherService.getCurrentWeather('DEL');

    expect(axios.get).toHaveBeenCalledTimes(1);
    const [url, options] = axios.get.mock.calls[0];
    expect(url).toBe(`${config.weather.baseUrl}/weather`);
    expect(options.params).toEqual({
      lat: DEL.lat,
      lon: DEL.lon,
      units: 'metric',
      appid: config.weather.apiKey,
    });
    expect(options.timeout).toBe(10000);
  });

  test('returns a successful, normalized response shape including the resolved airport', async () => {
    axios.get.mockResolvedValueOnce(currentWeatherSuccess({ temp: 30.4, feelsLike: 32.6, humidity: 60, windSpeedMs: 5 }));

    const result = await weatherService.getCurrentWeather('DEL');

    expect(result.airport).toEqual({ iata: 'DEL', city: DEL.city, country: DEL.country });
    expect(result.tempC).toBe(30); // rounded
    expect(result.feelsLikeC).toBe(33); // rounded
    expect(result.humidity).toBe(60);
    expect(result.windKph).toBe(Math.round(5 * 3.6));
    expect(result.condition).toBe('Clear');
    expect(result.description).toBe('clear sky');
    expect(result.icon).toBe('01d');
    expect(typeof result.sunrise).toBe('string');
    expect(typeof result.sunset).toBe('string');
    expect(typeof result.observedAt).toBe('string');
  });

  test('rejects an unknown/invalid airport code with 400 AIRPORT_NOT_FOUND and never calls the provider', async () => {
    await expect(weatherService.getCurrentWeather('ZZZ')).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'AIRPORT_NOT_FOUND',
    });
    expect(axios.get).not.toHaveBeenCalled();
  });
});

describe('weatherService.getForecast — valid request & provider parameters', () => {
  test('calls the provider with the correct params and condenses to one entry per day', async () => {
    axios.get.mockResolvedValueOnce(forecastSuccess());

    const result = await weatherService.getForecast('DEL');

    expect(axios.get).toHaveBeenCalledTimes(1);
    const [url, options] = axios.get.mock.calls[0];
    expect(url).toBe(`${config.weather.baseUrl}/forecast`);
    expect(options.params).toEqual({ lat: DEL.lat, lon: DEL.lon, units: 'metric', appid: config.weather.apiKey });

    expect(result.airport).toEqual({ iata: 'DEL', city: DEL.city, country: DEL.country });
    expect(result.days).toHaveLength(2); // two distinct dt_txt dates in the mocked response
    expect(result.days[0]).toEqual({
      date: '2026-11-01',
      tempC: 28,
      condition: 'Clear',
      description: 'clear sky',
      icon: '01d',
      rainProbabilityPct: 10,
    });
    expect(result.days[1].date).toBe('2026-11-02');
    expect(result.days[1].rainProbabilityPct).toBe(60);
  });

  test('rejects an unknown/invalid airport code with 400 AIRPORT_NOT_FOUND and never calls the provider', async () => {
    await expect(weatherService.getForecast('ZZZ')).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'AIRPORT_NOT_FOUND',
    });
    expect(axios.get).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------
// 2. Provider error handling
// ---------------------------------------------------------------------
describe('weatherService — provider error handling', () => {
  test('a provider HTTP error (e.g. 500 from OpenWeather) propagates unchanged (no special-cased wrapping)', async () => {
    const providerError = new Error('Request failed with status code 500');
    providerError.response = { status: 500, data: { message: 'internal error' } };
    axios.get.mockRejectedValueOnce(providerError);

    await expect(weatherService.getCurrentWeather('DEL')).rejects.toBe(providerError);
  });

  test('a provider timeout propagates unchanged, not silently swallowed', async () => {
    const timeoutError = new Error('timeout of 10000ms exceeded');
    timeoutError.code = 'ECONNABORTED';
    axios.get.mockRejectedValueOnce(timeoutError);

    await expect(weatherService.getCurrentWeather('DEL')).rejects.toThrow('timeout of 10000ms exceeded');
  });

  test('a provider rate-limit response (429) propagates unchanged — current code has no special-cased retry/backoff for weather', async () => {
    const rateLimitError = new Error('Request failed with status code 429');
    rateLimitError.response = { status: 429, data: { message: 'rate limited' } };
    axios.get.mockRejectedValueOnce(rateLimitError);

    await expect(weatherService.getCurrentWeather('DEL')).rejects.toBe(rateLimitError);
    expect(rateLimitError).not.toBeInstanceOf(AppError); // no app-level rate-limit handling exists to convert it
  });

  test('a malformed provider response (missing expected fields) throws rather than returning bad/partial data', async () => {
    axios.get.mockResolvedValueOnce({ data: { main: {}, weather: [] } }); // no wind, no sys, no dt

    await expect(weatherService.getCurrentWeather('DEL')).rejects.toThrow();
  });

  test('an empty provider response (no data at all) throws rather than returning bad/partial data', async () => {
    axios.get.mockResolvedValueOnce({ data: {} });

    await expect(weatherService.getCurrentWeather('DEL')).rejects.toThrow();
  });

  test('an empty forecast list from the provider resolves to zero days rather than throwing (documents current pass-through behavior)', async () => {
    axios.get.mockResolvedValueOnce({ data: { list: [] } });

    const result = await weatherService.getForecast('DEL');

    expect(result.days).toEqual([]);
  });

  test('a missing forecast `list` field throws (current code assumes it is always an array)', async () => {
    axios.get.mockResolvedValueOnce({ data: {} });

    await expect(weatherService.getForecast('DEL')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------
// 3. Missing weather API configuration
// ---------------------------------------------------------------------
describe('weatherService — missing API configuration', () => {
  test('getCurrentWeather rejects with 500 WEATHER_NOT_CONFIGURED when no API key is set, and never calls the provider', async () => {
    config.weather.apiKey = undefined;

    await expect(weatherService.getCurrentWeather('DEL')).rejects.toMatchObject({
      statusCode: 500,
      errorCode: 'WEATHER_NOT_CONFIGURED',
    });
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('getForecast rejects with 500 WEATHER_NOT_CONFIGURED when no API key is set, and never calls the provider', async () => {
    config.weather.apiKey = undefined;

    await expect(weatherService.getForecast('DEL')).rejects.toMatchObject({
      statusCode: 500,
      errorCode: 'WEATHER_NOT_CONFIGURED',
    });
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('a missing API key short-circuits BEFORE the cache is even checked — a stale/would-be cache hit is not returned', async () => {
    // Populate the cache first while configured...
    axios.get.mockResolvedValueOnce(currentWeatherSuccess());
    await weatherService.getCurrentWeather('DEL');
    expect(axios.get).toHaveBeenCalledTimes(1);

    // ...then remove the key and confirm the (still-valid, still-cached)
    // entry is NOT served — requireApiKey() runs first in current code.
    config.weather.apiKey = undefined;
    await expect(weatherService.getCurrentWeather('DEL')).rejects.toMatchObject({
      errorCode: 'WEATHER_NOT_CONFIGURED',
    });
  });

  test('getSeasonGuidance does NOT require an API key (it never calls the provider)', () => {
    config.weather.apiKey = undefined;

    const result = weatherService.getSeasonGuidance('DEL', 7);

    expect(result.isGeneralGuidance).toBe(true);
    expect(axios.get).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------
// 4. Caching
// ---------------------------------------------------------------------
describe('weatherService — caching (in-process weatherCache)', () => {
  test('cache miss: the first call for a given airport calls the provider and populates the cache', async () => {
    axios.get.mockResolvedValueOnce(currentWeatherSuccess());

    await weatherService.getCurrentWeather('DEL');

    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(weatherCache.get('current:DEL')).not.toBeNull();
  });

  test('cache hit: a second call within the TTL window returns the cached value and does NOT call the provider again', async () => {
    axios.get.mockResolvedValueOnce(currentWeatherSuccess({ temp: 25 }));

    const first = await weatherService.getCurrentWeather('DEL');
    const second = await weatherService.getCurrentWeather('DEL');

    expect(axios.get).toHaveBeenCalledTimes(1); // provider not called unnecessarily on cache hit
    expect(second).toEqual(first);
  });

  test('current-weather and forecast are cached under separate keys — a current-weather cache hit does not short-circuit a forecast request', async () => {
    axios.get.mockResolvedValueOnce(currentWeatherSuccess());
    axios.get.mockResolvedValueOnce(forecastSuccess());

    await weatherService.getCurrentWeather('DEL');
    await weatherService.getForecast('DEL');

    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  test('a different airport gets its own cache entry (no cross-airport cache pollution)', async () => {
    axios.get.mockResolvedValueOnce(currentWeatherSuccess({ temp: 30 }));
    axios.get.mockResolvedValueOnce(currentWeatherSuccess({ temp: 15 }));

    const del = await weatherService.getCurrentWeather('DEL');
    const bom = await weatherService.getCurrentWeather('BOM');

    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(del.tempC).toBe(30);
    expect(bom.tempC).toBe(15);
  });

  test('cache expiry: after the configured TTL elapses, the next call calls the provider again rather than serving stale data', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    try {
      axios.get.mockResolvedValueOnce(currentWeatherSuccess({ temp: 20 }));
      await weatherService.getCurrentWeather('DEL');
      expect(axios.get).toHaveBeenCalledTimes(1);

      // Advance past config.weather.cacheTtlMinutes (30 min in .env.test).
      jest.setSystemTime(Date.now() + 30 * 60 * 1000 + 1000);

      axios.get.mockResolvedValueOnce(currentWeatherSuccess({ temp: 21 }));
      const afterExpiry = await weatherService.getCurrentWeather('DEL');

      expect(axios.get).toHaveBeenCalledTimes(2); // cache entry expired -> provider called again
      expect(afterExpiry.tempC).toBe(21);
    } finally {
      jest.useRealTimers();
    }
  });

  test('cache failure (get() throws) is not caught anywhere in weatherService — it propagates like any other unexpected error (current behavior, no fallback)', async () => {
    const cacheError = new Error('cache backend unavailable');
    const getSpy = jest.spyOn(weatherCache, 'get').mockImplementationOnce(() => {
      throw cacheError;
    });

    await expect(weatherService.getCurrentWeather('DEL')).rejects.toBe(cacheError);
    expect(axios.get).not.toHaveBeenCalled(); // the throw happens before the provider would be reached

    getSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------
// 5. Season guidance (part of the same weather feature; no provider/cache)
// ---------------------------------------------------------------------
describe('weatherService.getSeasonGuidance', () => {
  test('flags itself as general (non-measured) guidance and resolves the airport from the static dataset', () => {
    const result = weatherService.getSeasonGuidance('DEL', 7);

    expect(result.airport).toEqual({ iata: 'DEL', city: DEL.city, country: DEL.country });
    expect(result.month).toBe(7);
    expect(result.isGeneralGuidance).toBe(true);
    expect(typeof result.guidance).toBe('string');
  });

  test('gives tropical guidance for a near-equator airport regardless of month', () => {
    const result = weatherService.getSeasonGuidance('SIN', 1);
    expect(result.guidance).toMatch(/equator/i);
  });

  test('gives Northern Hemisphere summer guidance for a July query at a Northern Hemisphere airport', () => {
    const result = weatherService.getSeasonGuidance('DEL', 7);
    expect(result.guidance).toMatch(/summer/i);
    expect(result.guidance).toMatch(/Northern/);
  });

  test('gives Southern Hemisphere summer guidance for a January query at a Southern Hemisphere airport (opposite season from the Northern Hemisphere)', () => {
    const result = weatherService.getSeasonGuidance('SYD', 1);
    expect(result.guidance).toMatch(/summer/i);
    expect(result.guidance).toMatch(/Southern/);
  });

  test('throws AIRPORT_NOT_FOUND for an unknown airport code', () => {
    expect(() => weatherService.getSeasonGuidance('ZZZ', 7)).toThrow(
      expect.objectContaining({ statusCode: 400, errorCode: 'AIRPORT_NOT_FOUND' })
    );
  });
});
