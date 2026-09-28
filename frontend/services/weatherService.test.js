// Uses node:test's built-in ES module mocking (`t.mock.module`), available
// behind --experimental-test-module-mocks. Run via:
//   node --experimental-test-module-mocks --import ./tests/support/register.mjs --test services/weatherService.test.js
// (see frontend/tests/support/register.mjs for why --import is needed: it
// teaches plain `node` how to resolve the "@/" alias that Next.js/webpack
// normally handles, so weatherService.js's `import ... from '@/lib/apiClient'`
// can be loaded outside of Next's build pipeline.)
import { test } from 'node:test';
import assert from 'node:assert/strict';

let loadCounter = 0;

/**
 * Mocks '@/lib/apiClient' with the given `api.get` implementation, then
 * imports a fresh instance of weatherService bound to that mock. A
 * per-import cache-busting query string ensures each test gets its own
 * module instance (so mocks from different tests never leak into each
 * other), and `t.mock.module` auto-restores when the test ends.
 */
async function loadWeatherService(t, getImpl) {
  t.mock.module('@/lib/apiClient', {
    namedExports: { api: { get: getImpl } },
  });
  loadCounter += 1;
  const mod = await import(`@/services/weatherService.js?case=${loadCounter}`);
  return mod.weatherService;
}

// ---------------------------------------------------------------------------
// getCurrent
// ---------------------------------------------------------------------------

test('getCurrent: requests the current-weather endpoint for the given IATA code', async (t) => {
  const calls = [];
  const weatherService = await loadWeatherService(t, async (path) => {
    calls.push(path);
    return { data: { tempC: 1 } };
  });

  await weatherService.getCurrent('DEL');

  assert.deepEqual(calls, ['/weather/DEL/current']);
});

test('getCurrent: returns the backend payload (res.data) unchanged, with no added/dropped fields', async (t) => {
  const backendPayload = {
    airport: { iata: 'DEL', city: 'Delhi', country: 'IN' },
    tempC: 28,
    feelsLikeC: 30,
    humidity: 54,
    windKph: 12,
    condition: 'Clear',
    description: 'clear sky',
    icon: '01d',
    sunrise: '2026-09-12T00:30:00.000Z',
    sunset: '2026-09-12T12:45:00.000Z',
    observedAt: '2026-09-12T06:00:00.000Z',
  };
  const weatherService = await loadWeatherService(t, async () => ({ data: backendPayload }));

  const result = await weatherService.getCurrent('DEL');

  assert.deepEqual(result, backendPayload);
});

test('getCurrent: uses a different path per IATA code (parameters are not hardcoded)', async (t) => {
  const calls = [];
  const weatherService = await loadWeatherService(t, async (path) => {
    calls.push(path);
    return { data: {} };
  });

  await weatherService.getCurrent('BOM');
  await weatherService.getCurrent('JFK');

  assert.deepEqual(calls, ['/weather/BOM/current', '/weather/JFK/current']);
});

// ---------------------------------------------------------------------------
// getForecast
// ---------------------------------------------------------------------------

test('getForecast: requests the forecast endpoint for the given IATA code', async (t) => {
  const calls = [];
  const weatherService = await loadWeatherService(t, async (path) => {
    calls.push(path);
    return { data: { days: [] } };
  });

  await weatherService.getForecast('CDG');

  assert.deepEqual(calls, ['/weather/CDG/forecast']);
});

test('getForecast: returns the backend payload (days array) unchanged', async (t) => {
  const backendPayload = {
    airport: { iata: 'CDG', city: 'Paris', country: 'FR' },
    days: [
      { date: '2026-09-13', tempC: 19, condition: 'Clouds', description: 'overcast clouds', icon: '04d', rainProbabilityPct: 20 },
      { date: '2026-09-14', tempC: 21, condition: 'Clear', description: 'clear sky', icon: '01d', rainProbabilityPct: 0 },
    ],
  };
  const weatherService = await loadWeatherService(t, async () => ({ data: backendPayload }));

  const result = await weatherService.getForecast('CDG');

  assert.deepEqual(result, backendPayload);
});

// ---------------------------------------------------------------------------
// getSeason
// ---------------------------------------------------------------------------

test('getSeason: omits the month query param when no month is passed', async (t) => {
  const calls = [];
  const weatherService = await loadWeatherService(t, async (path) => {
    calls.push(path);
    return { data: { isGeneralGuidance: true, guidance: 'x' } };
  });

  await weatherService.getSeason('DEL');

  assert.deepEqual(calls, ['/weather/DEL/season']);
});

test('getSeason: includes ?month=<n> when a month is passed', async (t) => {
  const calls = [];
  const weatherService = await loadWeatherService(t, async (path) => {
    calls.push(path);
    return { data: { isGeneralGuidance: true, guidance: 'x' } };
  });

  await weatherService.getSeason('DEL', 6);

  assert.deepEqual(calls, ['/weather/DEL/season?month=6']);
});

test('getSeason: returns the backend guidance payload unchanged', async (t) => {
  const backendPayload = {
    airport: { iata: 'DEL', city: 'Delhi', country: 'IN' },
    month: 6,
    isGeneralGuidance: true,
    guidance: 'This is generally summer season here (Northern Hemisphere) — expect warmer weather.',
  };
  const weatherService = await loadWeatherService(t, async () => ({ data: backendPayload }));

  const result = await weatherService.getSeason('DEL', 6);

  assert.deepEqual(result, backendPayload);
});

// ---------------------------------------------------------------------------
// Network / API error handling — weatherService has no try/catch of its own,
// so these tests document that api.get's rejection propagates unchanged for
// all three methods (a network failure or a non-2xx ApiError alike).
// ---------------------------------------------------------------------------

test('getCurrent: propagates a network-level failure unchanged (no swallowing/wrapping)', async (t) => {
  const networkError = new TypeError('Failed to fetch');
  const weatherService = await loadWeatherService(t, async () => {
    throw networkError;
  });

  await assert.rejects(() => weatherService.getCurrent('DEL'), (err) => err === networkError);
});

test('getForecast: propagates an ApiError (non-2xx backend response) unchanged, preserving status/errorCode', async (t) => {
  const apiError = Object.assign(new Error('Weather is not configured. Set OPENWEATHER_API_KEY in .env.'), {
    status: 500,
    errorCode: 'WEATHER_NOT_CONFIGURED',
  });
  const weatherService = await loadWeatherService(t, async () => {
    throw apiError;
  });

  await assert.rejects(
    () => weatherService.getForecast('DEL'),
    (err) => err === apiError && err.status === 500 && err.errorCode === 'WEATHER_NOT_CONFIGURED'
  );
});

test('getSeason: propagates a 404 ApiError unchanged for an unknown IATA code', async (t) => {
  const apiError = Object.assign(new Error('Unknown airport code'), {
    status: 404,
    errorCode: 'AIRPORT_NOT_FOUND',
  });
  const weatherService = await loadWeatherService(t, async () => {
    throw apiError;
  });

  await assert.rejects(
    () => weatherService.getSeason('ZZZ'),
    (err) => err === apiError && err.status === 404
  );
});

// ---------------------------------------------------------------------------
// Malformed / empty response handling — documents CURRENT behavior only.
// weatherService does no defensive checking of the shape api.get resolves
// with; it just reads `.data` off whatever comes back.
// ---------------------------------------------------------------------------

test('getCurrent: a response body with no "data" field resolves to undefined (not an error)', async (t) => {
  const weatherService = await loadWeatherService(t, async () => ({}));

  const result = await weatherService.getCurrent('DEL');

  assert.equal(result, undefined);
});

test('getCurrent: an explicit null "data" field resolves to null (not an error)', async (t) => {
  const weatherService = await loadWeatherService(t, async () => ({ data: null }));

  const result = await weatherService.getCurrent('DEL');

  assert.equal(result, null);
});

test('getForecast: a response with an empty days array passes through as-is', async (t) => {
  const weatherService = await loadWeatherService(t, async () => ({ data: { days: [] } }));

  const result = await weatherService.getForecast('DEL');

  assert.deepEqual(result, { days: [] });
});

test('getCurrent: when api.get itself resolves to null (e.g. apiClient failed to parse the body), reading .data throws synchronously — current behavior is unguarded', async (t) => {
  const weatherService = await loadWeatherService(t, async () => null);

  await assert.rejects(() => weatherService.getCurrent('DEL'), TypeError);
});

// ---------------------------------------------------------------------------
// Frontend caching — weatherService itself has no cache/memoization; any
// caching (e.g. React Query's staleTime) lives one layer up in the
// components that call this service, not here. This test documents that
// every call reaches api.get, i.e. there is no request de-duplication at
// this layer.
// ---------------------------------------------------------------------------

test('getCurrent: does not cache — calling it twice for the same code calls api.get twice', async (t) => {
  const calls = [];
  const weatherService = await loadWeatherService(t, async (path) => {
    calls.push(path);
    return { data: { tempC: 1 } };
  });

  await weatherService.getCurrent('DEL');
  await weatherService.getCurrent('DEL');

  assert.deepEqual(calls, ['/weather/DEL/current', '/weather/DEL/current']);
});
