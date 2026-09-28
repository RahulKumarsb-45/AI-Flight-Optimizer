/**
 * Q5 Google Places — Batch 1: unit tests for the Places SERVICE layer
 * (src/services/placesService.js).
 *
 * These call the REAL service functions directly (no HTTP layer, no
 * database) and mock only `axios`, the exact boundary placesService uses to
 * reach the external Google Places API. No real API key or network call is
 * ever made. The real in-process cache (cache/memoryCache.js -> placesCache)
 * is used as-is, same pattern as tests/unit/weatherService.test.js (Q4).
 *
 * CONFIRMED BY READING CURRENT CODE (do not re-derive elsewhere):
 *   - getNearbyHotels/getNearbyRestaurants/getTouristAttractions/getPhotoBytes
 *     all funnel through requireApiKey() FIRST (throws 500
 *     PLACES_NOT_CONFIGURED if config.places.apiKey is falsy) — this runs
 *     even before the cache check.
 *   - searchNearby() POSTs to
 *     'https://places.googleapis.com/v1/places:searchNearby' with body
 *     { includedTypes, maxResultCount: 10, locationRestriction: { circle:
 *     { center: { latitude, longitude }, radius } }, rankPreference:
 *     'POPULARITY' } and headers { 'Content-Type', 'X-Goog-Api-Key':
 *     config.places.apiKey, 'X-Goog-FieldMask': <mask> }, timeout 10000.
 *   - Hotels: includedTypes ['lodging'], radius 5000 (DEFAULT_RADIUS_METERS),
 *     base FIELD_MASK, cache prefix 'hotels'.
 *   - Restaurants: includedTypes ['restaurant'], radius 5000, base
 *     FIELD_MASK, cache prefix 'restaurants'.
 *   - Attractions: includedTypes ['tourist_attraction'], radius 10000
 *     (ATTRACTIONS_RADIUS_METERS), the WIDER ATTRACTIONS_FIELD_MASK (adds
 *     editorialSummary + primaryTypeDisplayName), cache prefix 'attractions',
 *     and results are normalized with normalizeAttraction (adds
 *     `description`/`category` on top of the base normalizePlace shape).
 *   - Cache key is `${cacheKeyPrefix}:${lat.toFixed(3)},${lon.toFixed(3)}`
 *     in the shared `placesCache` singleton, TTL = config.places.cacheTtlHours
 *     hours. A cache hit returns the stored array WITHOUT calling axios again.
 *   - Results are built via `(response.data.places || []).map(normalize)` —
 *     so a response whose `data` is present but has no `places` key (e.g.
 *     `{}`) is NOT an error: it silently normalizes to an empty array. Only
 *     when `response.data` itself is missing/undefined does the `.places`
 *     property access throw, which is caught by the surrounding try/catch
 *     and re-thrown as a generic AppError (502 PLACES_PROVIDER_ERROR) —
 *     there is no dedicated "malformed shape" error code.
 *   - Provider error mapping: an axios rejection with `err.response.status
 *     === 403` becomes a 502 PLACES_PROVIDER_ERROR AppError with a
 *     dedicated "API key is invalid / Places API (New) not enabled"
 *     message; every other rejection (or the malformed-response TypeError
 *     above) becomes a 502 PLACES_PROVIDER_ERROR AppError with the generic
 *     message 'Could not fetch nearby places right now.' — there is no
 *     passthrough of the raw provider error like in weatherService.
 *   - getPhotoBytes(): GETs
 *     `https://places.googleapis.com/v1/${photoName}/media` with
 *     `params: { maxWidthPx, key: config.places.apiKey }`,
 *     `responseType: 'arraybuffer'`, timeout 10000, and returns
 *     `{ data: Buffer, contentType }` (contentType falls back to
 *     'image/jpeg' if the provider omits the header). On ANY rejection
 *     (no 403 special-case here) it throws a 502 PLACES_PROVIDER_ERROR
 *     AppError with message 'Could not load this photo right now.' — the
 *     configured API key is only ever sent as an outgoing request param,
 *     never included in any thrown error or returned value.
 *   - normalizePlace()/normalizeAttraction() never throw on missing optional
 *     fields (rating, priceLevel, openNow, mapsUri, photos, editorialSummary,
 *     primaryTypeDisplayName all fall back to null/0/'Unknown' as coded).
 */

jest.mock('axios');
const axios = require('axios');

const config = require('../../src/config/env');
const placesService = require('../../src/services/placesService');
const { placesCache } = require('../../src/cache/memoryCache');
const AppError = require('../../src/utils/AppError');

const ORIGINAL_PLACES_CONFIG = JSON.parse(JSON.stringify(config.places));

const BASE_URL = 'https://places.googleapis.com/v1/places:searchNearby';

// DEL: Indira Gandhi Intl (lat 28.5562, lon 77.1) — the default "known
// good" airport coordinates used across this file (matches airportData.js).
const DEL = { lat: 28.5562, lon: 77.1 };

beforeEach(() => {
  jest.clearAllMocks();
  placesCache.clear(); // in-process cache is a module-level singleton — isolate every test
  config.places.apiKey = 'fake-test-google-places-key';
});

afterEach(() => {
  config.places.apiKey = ORIGINAL_PLACES_CONFIG.apiKey;
  config.places.cacheTtlHours = ORIGINAL_PLACES_CONFIG.cacheTtlHours;
  placesCache.clear();
});

function placesSuccess(places) {
  return { data: { places } };
}

function hotelPlace(overrides = {}) {
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
    ...overrides,
  };
}

function restaurantPlace(overrides = {}) {
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
    ...overrides,
  };
}

function attractionPlace(overrides = {}) {
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
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// 1. HOTELS
// ---------------------------------------------------------------------
describe('placesService.getNearbyHotels', () => {
  test('successful search returns normalized hotel data', async () => {
    axios.post.mockResolvedValueOnce(placesSuccess([hotelPlace()]));

    const result = await placesService.getNearbyHotels({ lat: DEL.lat, lon: DEL.lon });

    expect(result).toEqual([
      {
        id: 'places/hotel1',
        name: 'Grand Hotel',
        address: '123 Main St',
        rating: 4.5,
        ratingCount: 200,
        priceLevel: 'PRICE_LEVEL_MODERATE',
        openNow: true,
        mapsUri: 'https://maps.google.com/?cid=1',
        location: { lat: 28.6, lon: 77.2 },
        photoName: 'places/hotel1/photos/abc',
      },
    ]);
  });

  test('calls the provider with the correct location/destination parameters', async () => {
    axios.post.mockResolvedValueOnce(placesSuccess([]));

    await placesService.getNearbyHotels({ lat: DEL.lat, lon: DEL.lon });

    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body, options] = axios.post.mock.calls[0];
    expect(url).toBe(BASE_URL);
    expect(body).toEqual({
      includedTypes: ['lodging'],
      maxResultCount: 10,
      locationRestriction: {
        circle: { center: { latitude: DEL.lat, longitude: DEL.lon }, radius: 5000 },
      },
      rankPreference: 'POPULARITY',
    });
    expect(options.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': config.places.apiKey,
    });
    expect(options.headers['X-Goog-FieldMask']).toEqual(expect.any(String));
    expect(options.headers['X-Goog-FieldMask']).not.toMatch(/editorialSummary/);
    expect(options.timeout).toBe(10000);
  });

  test('empty results from the provider resolve to an empty array, not an error', async () => {
    axios.post.mockResolvedValueOnce(placesSuccess([]));

    const result = await placesService.getNearbyHotels({ lat: DEL.lat, lon: DEL.lon });

    expect(result).toEqual([]);
  });

  test('a provider/API error (e.g. 500) is wrapped as a 502 PLACES_PROVIDER_ERROR AppError', async () => {
    const providerError = new Error('Request failed with status code 500');
    providerError.response = { status: 500, data: { message: 'internal error' } };
    axios.post.mockRejectedValueOnce(providerError);

    await expect(placesService.getNearbyHotels({ lat: DEL.lat, lon: DEL.lon })).rejects.toMatchObject({
      statusCode: 502,
      errorCode: 'PLACES_PROVIDER_ERROR',
    });
  });

  test('a 403 provider error (invalid key / API not enabled) is wrapped with the dedicated message', async () => {
    const forbiddenError = new Error('Request failed with status code 403');
    forbiddenError.response = { status: 403, data: { message: 'forbidden' } };
    axios.post.mockRejectedValueOnce(forbiddenError);

    await expect(placesService.getNearbyHotels({ lat: DEL.lat, lon: DEL.lon })).rejects.toMatchObject({
      statusCode: 502,
      errorCode: 'PLACES_PROVIDER_ERROR',
      message: expect.stringMatching(/Places API key is invalid/),
    });
  });

  test('a malformed response missing the `places` key resolves to an empty array (current pass-through behavior)', async () => {
    axios.post.mockResolvedValueOnce({ data: {} });

    const result = await placesService.getNearbyHotels({ lat: DEL.lat, lon: DEL.lon });

    expect(result).toEqual([]);
  });

  test('a malformed response missing `data` entirely is caught and wrapped as a 502 PLACES_PROVIDER_ERROR (not a raw crash)', async () => {
    axios.post.mockResolvedValueOnce({});

    await expect(placesService.getNearbyHotels({ lat: DEL.lat, lon: DEL.lon })).rejects.toMatchObject({
      statusCode: 502,
      errorCode: 'PLACES_PROVIDER_ERROR',
    });
  });

  test('missing API configuration rejects with 500 PLACES_NOT_CONFIGURED and never calls the provider', async () => {
    config.places.apiKey = undefined;

    await expect(placesService.getNearbyHotels({ lat: DEL.lat, lon: DEL.lon })).rejects.toMatchObject({
      statusCode: 500,
      errorCode: 'PLACES_NOT_CONFIGURED',
    });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('missing API key short-circuits BEFORE the cache is checked — a stale/would-be cache hit is not returned', async () => {
    axios.post.mockResolvedValueOnce(placesSuccess([hotelPlace()]));
    await placesService.getNearbyHotels({ lat: DEL.lat, lon: DEL.lon });
    expect(axios.post).toHaveBeenCalledTimes(1);

    config.places.apiKey = undefined;
    await expect(placesService.getNearbyHotels({ lat: DEL.lat, lon: DEL.lon })).rejects.toMatchObject({
      errorCode: 'PLACES_NOT_CONFIGURED',
    });
  });

  test('cache hit: a second call for the same coordinates does not call the provider again', async () => {
    axios.post.mockResolvedValueOnce(placesSuccess([hotelPlace()]));

    const first = await placesService.getNearbyHotels({ lat: DEL.lat, lon: DEL.lon });
    const second = await placesService.getNearbyHotels({ lat: DEL.lat, lon: DEL.lon });

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });
});

// ---------------------------------------------------------------------
// 2. RESTAURANTS
// ---------------------------------------------------------------------
describe('placesService.getNearbyRestaurants', () => {
  test('successful search returns normalized restaurant data', async () => {
    axios.post.mockResolvedValueOnce(placesSuccess([restaurantPlace()]));

    const result = await placesService.getNearbyRestaurants({ lat: DEL.lat, lon: DEL.lon });

    expect(result).toEqual([
      {
        id: 'places/rest1',
        name: 'Tasty Bites',
        address: '456 Food St',
        rating: 4.2,
        ratingCount: 80,
        priceLevel: 'PRICE_LEVEL_INEXPENSIVE',
        openNow: false,
        mapsUri: 'https://maps.google.com/?cid=2',
        location: { lat: 28.55, lon: 77.11 },
        photoName: null,
      },
    ]);
  });

  test('calls the provider with the correct location parameters and includedTypes', async () => {
    axios.post.mockResolvedValueOnce(placesSuccess([]));

    await placesService.getNearbyRestaurants({ lat: DEL.lat, lon: DEL.lon });

    const [url, body] = axios.post.mock.calls[0];
    expect(url).toBe(BASE_URL);
    expect(body.includedTypes).toEqual(['restaurant']);
    expect(body.locationRestriction.circle.center).toEqual({ latitude: DEL.lat, longitude: DEL.lon });
    expect(body.locationRestriction.circle.radius).toBe(5000);
  });

  test('empty results from the provider resolve to an empty array', async () => {
    axios.post.mockResolvedValueOnce(placesSuccess([]));

    const result = await placesService.getNearbyRestaurants({ lat: DEL.lat, lon: DEL.lon });

    expect(result).toEqual([]);
  });

  test('a provider/API error is wrapped as a 502 PLACES_PROVIDER_ERROR AppError', async () => {
    const providerError = new Error('Request failed with status code 500');
    providerError.response = { status: 500, data: {} };
    axios.post.mockRejectedValueOnce(providerError);

    await expect(placesService.getNearbyRestaurants({ lat: DEL.lat, lon: DEL.lon })).rejects.toMatchObject({
      statusCode: 502,
      errorCode: 'PLACES_PROVIDER_ERROR',
    });
  });

  test('a malformed response (missing `places` key) resolves to an empty array', async () => {
    axios.post.mockResolvedValueOnce({ data: { unexpected: 'shape' } });

    const result = await placesService.getNearbyRestaurants({ lat: DEL.lat, lon: DEL.lon });

    expect(result).toEqual([]);
  });

  test('restaurants and hotels are cached under separate keys — a hotel cache hit does not short-circuit a restaurant request', async () => {
    axios.post.mockResolvedValueOnce(placesSuccess([hotelPlace()]));
    axios.post.mockResolvedValueOnce(placesSuccess([restaurantPlace()]));

    await placesService.getNearbyHotels({ lat: DEL.lat, lon: DEL.lon });
    await placesService.getNearbyRestaurants({ lat: DEL.lat, lon: DEL.lon });

    expect(axios.post).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------
// 3. TOURIST ATTRACTIONS
// ---------------------------------------------------------------------
describe('placesService.getTouristAttractions', () => {
  test('successful search returns normalized attraction data including description/category', async () => {
    axios.post.mockResolvedValueOnce(placesSuccess([attractionPlace()]));

    const result = await placesService.getTouristAttractions({ lat: DEL.lat, lon: DEL.lon });

    expect(result).toEqual([
      {
        id: 'places/attr1',
        name: 'Historic Fort',
        address: '789 Heritage Rd',
        rating: 4.8,
        ratingCount: 5000,
        priceLevel: null,
        openNow: true,
        mapsUri: 'https://maps.google.com/?cid=3',
        location: { lat: 28.65, lon: 77.23 },
        photoName: 'places/attr1/photos/xyz',
        description: 'A historic Mughal-era fort.',
        category: 'Historical landmark',
      },
    ]);
  });

  test('calls the provider with the correct IATA-resolved location, wider radius, and includedTypes', async () => {
    axios.post.mockResolvedValueOnce(placesSuccess([]));

    await placesService.getTouristAttractions({ lat: DEL.lat, lon: DEL.lon });

    const [url, body, options] = axios.post.mock.calls[0];
    expect(url).toBe(BASE_URL);
    expect(body.includedTypes).toEqual(['tourist_attraction']);
    expect(body.locationRestriction.circle.center).toEqual({ latitude: DEL.lat, longitude: DEL.lon });
    expect(body.locationRestriction.circle.radius).toBe(10000); // ATTRACTIONS_RADIUS_METERS, wider than hotels/restaurants
    expect(options.headers['X-Goog-FieldMask']).toMatch(/editorialSummary/);
    expect(options.headers['X-Goog-FieldMask']).toMatch(/primaryTypeDisplayName/);
  });

  test('empty results from the provider resolve to an empty array', async () => {
    axios.post.mockResolvedValueOnce(placesSuccess([]));

    const result = await placesService.getTouristAttractions({ lat: DEL.lat, lon: DEL.lon });

    expect(result).toEqual([]);
  });

  test('a provider/API error is wrapped as a 502 PLACES_PROVIDER_ERROR AppError', async () => {
    const providerError = new Error('Request failed with status code 503');
    providerError.response = { status: 503, data: {} };
    axios.post.mockRejectedValueOnce(providerError);

    await expect(placesService.getTouristAttractions({ lat: DEL.lat, lon: DEL.lon })).rejects.toMatchObject({
      statusCode: 502,
      errorCode: 'PLACES_PROVIDER_ERROR',
    });
  });

  test('a malformed attraction place missing editorialSummary/primaryTypeDisplayName normalizes with null description/category rather than throwing', async () => {
    axios.post.mockResolvedValueOnce(
      placesSuccess([attractionPlace({ editorialSummary: undefined, primaryTypeDisplayName: undefined })])
    );

    const result = await placesService.getTouristAttractions({ lat: DEL.lat, lon: DEL.lon });

    expect(result[0].description).toBeNull();
    expect(result[0].category).toBeNull();
  });

  test('attractions use a separate cache key from hotels/restaurants at the same coordinates', async () => {
    axios.post.mockResolvedValueOnce(placesSuccess([hotelPlace()]));
    axios.post.mockResolvedValueOnce(placesSuccess([attractionPlace()]));

    await placesService.getNearbyHotels({ lat: DEL.lat, lon: DEL.lon });
    await placesService.getTouristAttractions({ lat: DEL.lat, lon: DEL.lon });

    expect(axios.post).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------
// 4. PHOTOS
// ---------------------------------------------------------------------
describe('placesService.getPhotoBytes', () => {
  test('a valid photo request returns the image bytes and content type', async () => {
    const bytes = Buffer.from('fake-jpeg-bytes');
    axios.get.mockResolvedValueOnce({
      data: bytes,
      headers: { 'content-type': 'image/jpeg' },
    });

    const result = await placesService.getPhotoBytes({ photoName: 'places/hotel1/photos/abc' });

    expect(result.data).toEqual(bytes);
    expect(result.contentType).toBe('image/jpeg');
  });

  test('calls the provider with the correct photo reference, maxWidthPx, and API key as a request param', async () => {
    axios.get.mockResolvedValueOnce({ data: Buffer.from('x'), headers: {} });

    await placesService.getPhotoBytes({ photoName: 'places/hotel1/photos/abc', maxWidthPx: 800 });

    expect(axios.get).toHaveBeenCalledTimes(1);
    const [url, options] = axios.get.mock.calls[0];
    expect(url).toBe('https://places.googleapis.com/v1/places/hotel1/photos/abc/media');
    expect(options.params).toEqual({ maxWidthPx: 800, key: config.places.apiKey });
    expect(options.responseType).toBe('arraybuffer');
    expect(options.timeout).toBe(10000);
  });

  test('defaults maxWidthPx to 400 when not supplied', async () => {
    axios.get.mockResolvedValueOnce({ data: Buffer.from('x'), headers: {} });

    await placesService.getPhotoBytes({ photoName: 'places/hotel1/photos/abc' });

    expect(axios.get.mock.calls[0][1].params.maxWidthPx).toBe(400);
  });

  test('falls back to image/jpeg when the provider omits a content-type header', async () => {
    axios.get.mockResolvedValueOnce({ data: Buffer.from('x'), headers: {} });

    const result = await placesService.getPhotoBytes({ photoName: 'places/hotel1/photos/abc' });

    expect(result.contentType).toBe('image/jpeg');
  });

  test('a failed photo request (provider error) is wrapped as a 502 PLACES_PROVIDER_ERROR AppError, not the raw error', async () => {
    const providerError = new Error('Request failed with status code 404');
    providerError.response = { status: 404, data: {} };
    axios.get.mockRejectedValueOnce(providerError);

    await expect(placesService.getPhotoBytes({ photoName: 'places/missing/photos/x' })).rejects.toMatchObject({
      statusCode: 502,
      errorCode: 'PLACES_PROVIDER_ERROR',
      message: 'Could not load this photo right now.',
    });
  });

  test('missing API configuration rejects with 500 PLACES_NOT_CONFIGURED and never calls the provider', async () => {
    config.places.apiKey = undefined;

    await expect(placesService.getPhotoBytes({ photoName: 'places/hotel1/photos/abc' })).rejects.toMatchObject({
      statusCode: 500,
      errorCode: 'PLACES_NOT_CONFIGURED',
    });
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('cache hit: a second request for the same photoName/maxWidthPx does not call the provider again', async () => {
    axios.get.mockResolvedValueOnce({ data: Buffer.from('x'), headers: { 'content-type': 'image/png' } });

    const first = await placesService.getPhotoBytes({ photoName: 'places/hotel1/photos/abc', maxWidthPx: 200 });
    const second = await placesService.getPhotoBytes({ photoName: 'places/hotel1/photos/abc', maxWidthPx: 200 });

    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  test('the API key never appears in a thrown error message or the returned photo result', async () => {
    const providerError = new Error('Request failed with status code 500');
    providerError.response = { status: 500, data: {} };
    axios.get.mockRejectedValueOnce(providerError);

    let caught;
    try {
      await placesService.getPhotoBytes({ photoName: 'places/hotel1/photos/abc' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect(caught.message).not.toContain(config.places.apiKey);
    expect(JSON.stringify(caught)).not.toContain(config.places.apiKey);
  });
});

// ---------------------------------------------------------------------
// 5. SECURITY (service-level)
// ---------------------------------------------------------------------
describe('placesService — security-relevant behavior', () => {
  test('provider errors never leak the configured API key in the thrown AppError', async () => {
    const providerError = new Error('Request failed with status code 500');
    providerError.response = { status: 500, data: { message: 'server blew up', key: config.places.apiKey } };
    axios.post.mockRejectedValueOnce(providerError);

    let caught;
    try {
      await placesService.getNearbyHotels({ lat: DEL.lat, lon: DEL.lon });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect(caught.message).not.toContain(config.places.apiKey);
    expect(caught.errorCode).toBe('PLACES_PROVIDER_ERROR');
  });

  test('provider errors never leak the raw provider error object (only a generic AppError is thrown)', async () => {
    const providerError = new Error('Some internal provider stack trace text');
    providerError.response = { status: 500, data: {} };
    axios.post.mockRejectedValueOnce(providerError);

    await expect(placesService.getNearbyRestaurants({ lat: DEL.lat, lon: DEL.lon })).rejects.not.toBe(providerError);
  });

  test('the outgoing request never sends the API key anywhere except the documented header/param (never in the body)', async () => {
    axios.post.mockResolvedValueOnce(placesSuccess([]));

    await placesService.getNearbyHotels({ lat: DEL.lat, lon: DEL.lon });

    const [, body] = axios.post.mock.calls[0];
    expect(JSON.stringify(body)).not.toContain(config.places.apiKey);
  });
});
