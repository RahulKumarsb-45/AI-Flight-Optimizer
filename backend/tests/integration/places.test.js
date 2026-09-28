/**
 * Q5 Google Places — Batch 1: HTTP-level integration tests.
 *
 * These exercise the REAL production code path over HTTP:
 *   routes/placesRoutes.js -> validators/placesValidators.js
 *     -> controllers/placesController.js -> services/placesService.js
 *     -> providers/airport/airportService.js (real, static dataset)
 *
 * Only `axios` is mocked (the boundary placesService uses to reach the
 * external Google Places API). No real API key or network call is ever
 * made. Same pattern as tests/integration/weather.test.js (Q4).
 *
 * CONFIRMED BY READING CURRENT CODE (do not re-derive elsewhere):
 *   - routes/placesRoutes.js registers no auth middleware on any of its
 *     four routes (GET /photo, GET /:iataCode/hotels, /restaurants,
 *     /attractions) — same "public" shape as the weather routes.
 *   - `iataParamValidator` (shared shape with weather's) requires exactly
 *     3 alphabetic characters for `:iataCode` and applies to hotels/
 *     restaurants/attractions but NOT to /photo, which instead validates
 *     its `name` query param inside the controller itself (must start
 *     with 'places/').
 *   - All three place-search routes return
 *     `{ status: 'success', data: { city, hotels|restaurants|attractions } }`
 *     on success; /photo returns raw bytes with a Content-Type header
 *     mirroring the provider's, plus `Cache-Control: public, max-age=86400`.
 *   - The shared errorHandler shape is
 *     `{ status: 'error', errorCode, message, requestId }` on failure, and
 *     never includes a `stack` field in the response body regardless of
 *     NODE_ENV (stack is only ever passed to the logger).
 */

jest.mock('axios');
const axios = require('axios');

const request = require('supertest');
const app = require('../../src/app');
const config = require('../../src/config/env');
const { placesCache } = require('../../src/cache/memoryCache');

const ORIGINAL_PLACES_CONFIG = JSON.parse(JSON.stringify(config.places));

beforeEach(() => {
  jest.clearAllMocks();
  // placesCache is a module-level singleton shared across every request in
  // this file (real production cache, not mocked) — clear it before each
  // test so an earlier test's cached DEL entry never short-circuits a later
  // test's axios-call/error-path assertions.
  placesCache.clear();
  config.places.apiKey = 'fake-test-google-places-key';
});

afterEach(() => {
  config.places.apiKey = ORIGINAL_PLACES_CONFIG.apiKey;
  placesCache.clear();
});

function placesSuccess(places) {
  return { data: { places } };
}

function hotelPlace() {
  return {
    id: 'places/hotel1',
    displayName: { text: 'Grand Hotel' },
    formattedAddress: '123 Main St',
    rating: 4.5,
    userRatingCount: 200,
    priceLevel: 'PRICE_LEVEL_MODERATE',
    currentOpeningHours: { openNow: true },
    googleMapsUri: 'https://maps.google.com/?cid=1',
    location: { latitude: 28.6, longitude: 77.2 },
    photos: [{ name: 'places/hotel1/photos/abc' }],
  };
}

function restaurantPlace() {
  return {
    id: 'places/rest1',
    displayName: { text: 'Tasty Bites' },
    formattedAddress: '456 Food St',
    rating: 4.2,
    userRatingCount: 80,
    priceLevel: 'PRICE_LEVEL_INEXPENSIVE',
    currentOpeningHours: { openNow: false },
    googleMapsUri: 'https://maps.google.com/?cid=2',
    location: { latitude: 28.55, longitude: 77.11 },
    photos: [],
  };
}

function attractionPlace() {
  return {
    id: 'places/attr1',
    displayName: { text: 'Historic Fort' },
    formattedAddress: '789 Heritage Rd',
    rating: 4.8,
    userRatingCount: 5000,
    priceLevel: null,
    currentOpeningHours: { openNow: true },
    googleMapsUri: 'https://maps.google.com/?cid=3',
    location: { latitude: 28.65, longitude: 77.23 },
    photos: [{ name: 'places/attr1/photos/xyz' }],
    editorialSummary: { text: 'A historic Mughal-era fort.' },
    primaryTypeDisplayName: { text: 'Historical landmark' },
  };
}

// ---------------------------------------------------------------------
// 1. HOTELS
// ---------------------------------------------------------------------
describe('GET /api/places/:iataCode/hotels', () => {
  test('valid request returns 200 with the expected success envelope', async () => {
    axios.post.mockResolvedValueOnce(placesSuccess([hotelPlace()]));

    const res = await request(app).get('/api/places/DEL/hotels');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.city).toBe('New Delhi');
    expect(res.body.data.hotels).toEqual([
      expect.objectContaining({ id: 'places/hotel1', name: 'Grand Hotel' }),
    ]);
  });

  test('resolves the IATA code to the correct destination lat/lon before calling the provider', async () => {
    axios.post.mockResolvedValueOnce(placesSuccess([]));

    await request(app).get('/api/places/DEL/hotels');

    const [, body] = axios.post.mock.calls[0];
    expect(body.locationRestriction.circle.center).toEqual({ latitude: 28.5562, longitude: 77.1 });
  });

  test('empty results resolve to a 200 with an empty hotels array', async () => {
    axios.post.mockResolvedValueOnce(placesSuccess([]));

    const res = await request(app).get('/api/places/DEL/hotels');

    expect(res.status).toBe(200);
    expect(res.body.data.hotels).toEqual([]);
  });

  test('a provider/API error surfaces as a 502 PLACES_PROVIDER_ERROR, not a 200', async () => {
    const providerError = new Error('Request failed with status code 500');
    providerError.response = { status: 500, data: {} };
    axios.post.mockRejectedValueOnce(providerError);

    const res = await request(app).get('/api/places/DEL/hotels');

    expect(res.status).toBe(502);
    expect(res.body.status).toBe('error');
    expect(res.body.errorCode).toBe('PLACES_PROVIDER_ERROR');
  });

  test('a malformed provider response (missing `places`) surfaces as 200 with an empty array, never garbage data', async () => {
    axios.post.mockResolvedValueOnce({ data: {} });

    const res = await request(app).get('/api/places/DEL/hotels');

    expect(res.status).toBe(200);
    expect(res.body.data.hotels).toEqual([]);
  });

  test('a completely missing provider response body surfaces as a 502, never a crash or 200', async () => {
    axios.post.mockResolvedValueOnce({});

    const res = await request(app).get('/api/places/DEL/hotels');

    expect(res.status).toBe(502);
    expect(res.body.errorCode).toBe('PLACES_PROVIDER_ERROR');
  });

  test('missing GOOGLE_PLACES_API_KEY surfaces as 500 PLACES_NOT_CONFIGURED without leaking internals', async () => {
    config.places.apiKey = undefined;

    const res = await request(app).get('/api/places/DEL/hotels');

    expect(res.status).toBe(500);
    expect(res.body.errorCode).toBe('PLACES_NOT_CONFIGURED');
    expect(axios.post).not.toHaveBeenCalled();
    expect(res.body.stack).toBeUndefined();
  });
});

// ---------------------------------------------------------------------
// 2. RESTAURANTS
// ---------------------------------------------------------------------
describe('GET /api/places/:iataCode/restaurants', () => {
  test('valid request returns 200 with the expected success envelope', async () => {
    axios.post.mockResolvedValueOnce(placesSuccess([restaurantPlace()]));

    const res = await request(app).get('/api/places/DEL/restaurants');

    expect(res.status).toBe(200);
    expect(res.body.data.city).toBe('New Delhi');
    expect(res.body.data.restaurants).toEqual([
      expect.objectContaining({ id: 'places/rest1', name: 'Tasty Bites' }),
    ]);
  });

  test('calls the provider with the correct location parameters', async () => {
    axios.post.mockResolvedValueOnce(placesSuccess([]));

    await request(app).get('/api/places/BOM/restaurants');

    const [, body] = axios.post.mock.calls[0];
    expect(body.includedTypes).toEqual(['restaurant']);
    expect(body.locationRestriction.circle.center).toEqual({ latitude: 19.0896, longitude: 72.8656 });
  });

  test('empty results resolve to a 200 with an empty restaurants array', async () => {
    axios.post.mockResolvedValueOnce(placesSuccess([]));

    const res = await request(app).get('/api/places/DEL/restaurants');

    expect(res.status).toBe(200);
    expect(res.body.data.restaurants).toEqual([]);
  });

  test('a provider/API error surfaces as a 502, not a 200', async () => {
    const providerError = new Error('Request failed with status code 500');
    providerError.response = { status: 500, data: {} };
    axios.post.mockRejectedValueOnce(providerError);

    const res = await request(app).get('/api/places/DEL/restaurants');

    expect(res.status).toBe(502);
    expect(res.body.errorCode).toBe('PLACES_PROVIDER_ERROR');
  });

  test('a malformed provider response surfaces as 200 with an empty array', async () => {
    axios.post.mockResolvedValueOnce({ data: { unexpected: 'shape' } });

    const res = await request(app).get('/api/places/DEL/restaurants');

    expect(res.status).toBe(200);
    expect(res.body.data.restaurants).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// 3. TOURIST ATTRACTIONS
// ---------------------------------------------------------------------
describe('GET /api/places/:iataCode/attractions', () => {
  test('valid request returns 200 with the expected success envelope including description/category', async () => {
    axios.post.mockResolvedValueOnce(placesSuccess([attractionPlace()]));

    const res = await request(app).get('/api/places/DEL/attractions');

    expect(res.status).toBe(200);
    expect(res.body.data.city).toBe('New Delhi');
    expect(res.body.data.attractions).toEqual([
      expect.objectContaining({
        id: 'places/attr1',
        name: 'Historic Fort',
        description: 'A historic Mughal-era fort.',
        category: 'Historical landmark',
      }),
    ]);
  });

  test('calls the provider with the correct IATA-resolved location, radius, and type', async () => {
    axios.post.mockResolvedValueOnce(placesSuccess([]));

    await request(app).get('/api/places/DEL/attractions');

    const [, body, options] = axios.post.mock.calls[0];
    expect(body.includedTypes).toEqual(['tourist_attraction']);
    expect(body.locationRestriction.circle.center).toEqual({ latitude: 28.5562, longitude: 77.1 });
    expect(body.locationRestriction.circle.radius).toBe(10000);
    expect(options.headers['X-Goog-FieldMask']).toMatch(/editorialSummary/);
  });

  test('empty results resolve to a 200 with an empty attractions array', async () => {
    axios.post.mockResolvedValueOnce(placesSuccess([]));

    const res = await request(app).get('/api/places/DEL/attractions');

    expect(res.status).toBe(200);
    expect(res.body.data.attractions).toEqual([]);
  });

  test('a provider/API error surfaces as a 502, not a 200', async () => {
    const providerError = new Error('Request failed with status code 500');
    providerError.response = { status: 500, data: {} };
    axios.post.mockRejectedValueOnce(providerError);

    const res = await request(app).get('/api/places/DEL/attractions');

    expect(res.status).toBe(502);
    expect(res.body.errorCode).toBe('PLACES_PROVIDER_ERROR');
  });

  test('a malformed provider response surfaces as 200 with an empty array', async () => {
    axios.post.mockResolvedValueOnce({ data: {} });

    const res = await request(app).get('/api/places/DEL/attractions');

    expect(res.status).toBe(200);
    expect(res.body.data.attractions).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// 4. PHOTOS
// ---------------------------------------------------------------------
describe('GET /api/places/photo', () => {
  test('a valid photo reference returns 200 with the image bytes and correct content type', async () => {
    const bytes = Buffer.from('fake-jpeg-bytes');
    axios.get.mockResolvedValueOnce({ data: bytes, headers: { 'content-type': 'image/jpeg' } });

    const res = await request(app)
      .get('/api/places/photo')
      .query({ name: 'places/hotel1/photos/abc' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('public, max-age=86400');
    expect(Buffer.compare(res.body, bytes)).toBe(0);
  });

  test('calls the provider with the exact photo reference from the query string', async () => {
    axios.get.mockResolvedValueOnce({ data: Buffer.from('x'), headers: {} });

    await request(app).get('/api/places/photo').query({ name: 'places/hotel1/photos/abc', maxWidth: 800 });

    const [url, options] = axios.get.mock.calls[0];
    expect(url).toBe('https://places.googleapis.com/v1/places/hotel1/photos/abc/media');
    expect(options.params.maxWidthPx).toBe(800);
  });

  test('a missing `name` query param is rejected with 400 VALIDATION_ERROR and never calls the provider', async () => {
    const res = await request(app).get('/api/places/photo');

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('an invalid/malformed `name` (not starting with "places/") is rejected with 400 VALIDATION_ERROR', async () => {
    const res = await request(app).get('/api/places/photo').query({ name: '../../etc/passwd' });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('a failed photo request surfaces as a 502, not a 200 or a hang', async () => {
    const providerError = new Error('Request failed with status code 404');
    providerError.response = { status: 404, data: {} };
    axios.get.mockRejectedValueOnce(providerError);

    const res = await request(app).get('/api/places/photo').query({ name: 'places/missing/photos/x' });

    expect(res.status).toBe(502);
    expect(res.body.errorCode).toBe('PLACES_PROVIDER_ERROR');
  });

  test('the configured Places API key is never exposed in the response for a successful photo request', async () => {
    axios.get.mockResolvedValueOnce({ data: Buffer.from('x'), headers: { 'content-type': 'image/jpeg' } });

    const res = await request(app).get('/api/places/photo').query({ name: 'places/hotel1/photos/abc' });

    expect(JSON.stringify(res.headers)).not.toContain(config.places.apiKey);
  });
});

// ---------------------------------------------------------------------
// 5. SECURITY
// ---------------------------------------------------------------------
describe('Places routes — security', () => {
  test('an invalid IATA code (wrong length) is rejected with 400 VALIDATION_ERROR before the provider is ever called', async () => {
    const res = await request(app).get('/api/places/DE/hotels');

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('an invalid IATA code (non-alphabetic) is rejected with 400 VALIDATION_ERROR', async () => {
    const res = await request(app).get('/api/places/123/restaurants');

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('a well-formed but unknown airport code is rejected with 400 AIRPORT_NOT_FOUND, and the provider is never called', async () => {
    const res = await request(app).get('/api/places/ZZZ/attractions');

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('AIRPORT_NOT_FOUND');
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('provider errors never leak the configured API key in the error response body', async () => {
    const providerError = new Error('Request failed with status code 500');
    providerError.response = { status: 500, data: { message: 'internal error' } };
    axios.post.mockRejectedValueOnce(providerError);

    const res = await request(app).get('/api/places/DEL/hotels');

    expect(JSON.stringify(res.body)).not.toContain(config.places.apiKey);
  });

  test('provider errors never leak a stack trace in the response body', async () => {
    const providerError = new Error('Request failed with status code 500');
    providerError.response = { status: 500, data: {} };
    axios.post.mockRejectedValueOnce(providerError);

    const res = await request(app).get('/api/places/DEL/restaurants');

    expect(res.body.stack).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/); // no stack-frame-looking text
  });

  test('missing API key configuration never leaks internal config values in the response', async () => {
    config.places.apiKey = undefined;

    const res = await request(app).get('/api/places/DEL/attractions');

    expect(res.status).toBe(500);
    expect(res.body.errorCode).toBe('PLACES_NOT_CONFIGURED');
    expect(res.body.stack).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/GOOGLE_PLACES_API_KEY=\S+/);
  });

  test('the success responses never include the configured API key anywhere in the body', async () => {
    axios.post.mockResolvedValueOnce(placesSuccess([hotelPlace()]));

    const res = await request(app).get('/api/places/DEL/hotels');

    expect(JSON.stringify(res.body)).not.toContain(config.places.apiKey);
  });

  test('routes require no Authorization header (public, same shape as weather routes)', async () => {
    axios.post.mockResolvedValueOnce(placesSuccess([]));

    const res = await request(app).get('/api/places/DEL/hotels');

    expect(res.status).not.toBe(401);
    expect(res.status).toBe(200);
  });
});
