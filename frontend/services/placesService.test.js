// Q5 Google Places — Batch 3: unit tests for the FRONTEND placesService
// (services/placesService.js). This is a gap left by Batch 1 (backend
// service/route tests) and Batch 2 (component tests, which mock this
// module entirely) — nothing exercises the real placesService.js code
// itself until now.
//
// Same harness/pattern as services/weatherService.test.js (sibling
// service, already covered): mocks only '@/lib/apiClient', the exact
// boundary this module uses to reach the backend. No real network call,
// no real API key, ever.
//
// Run via:
//   node --experimental-test-module-mocks --import ./tests/support/register.mjs --test services/placesService.test.js
//
// CONFIRMED BY READING CURRENT CODE (do not re-derive elsewhere):
//   - getHotels/getRestaurants/getAttractions each call
//     `api.get('/places/<iataCode>/<hotels|restaurants|attractions>')` and
//     return `res.data` unchanged — no defensive checking of shape, no
//     added/dropped fields, no caching of its own (any caching lives one
//     layer up, in react-query).
//   - There is no `getPhotoBytes`/photo method here — NearbyPlacesCard and
//     TouristAttractionsCard build the photo <img> src directly from
//     API_BASE_URL, they don't go through this service.
//   - No API key or credential is ever referenced by this file, so there is
//     nothing for a request to leak here by construction — but that only
//     holds as long as this file (and only this file) forms the whole
//     request path, which these tests pin down for regression purposes.
import { test } from 'node:test';
import assert from 'node:assert/strict';

let loadCounter = 0;

/**
 * Mocks '@/lib/apiClient' with the given `api.get` implementation, then
 * imports a fresh instance of placesService bound to that mock. A
 * per-import cache-busting query string ensures each test gets its own
 * module instance (so mocks from different tests never leak into each
 * other), and `t.mock.module` auto-restores when the test ends.
 */
async function loadPlacesService(t, getImpl) {
  t.mock.module('@/lib/apiClient', {
    namedExports: { api: { get: getImpl } },
  });
  loadCounter += 1;
  const mod = await import(`@/services/placesService.js?case=${loadCounter}`);
  return mod.placesService;
}

// ---------------------------------------------------------------------------
// getHotels / getRestaurants / getAttractions — correct endpoint per IATA
// ---------------------------------------------------------------------------

test('getHotels: requests the hotels endpoint for the given IATA code', async (t) => {
  const calls = [];
  const placesService = await loadPlacesService(t, async (path) => {
    calls.push(path);
    return { data: { city: 'Delhi', hotels: [] } };
  });

  await placesService.getHotels('DEL');

  assert.deepEqual(calls, ['/places/DEL/hotels']);
});

test('getRestaurants: requests the restaurants endpoint for the given IATA code', async (t) => {
  const calls = [];
  const placesService = await loadPlacesService(t, async (path) => {
    calls.push(path);
    return { data: { city: 'Delhi', restaurants: [] } };
  });

  await placesService.getRestaurants('DEL');

  assert.deepEqual(calls, ['/places/DEL/restaurants']);
});

test('getAttractions: requests the attractions endpoint for the given IATA code', async (t) => {
  const calls = [];
  const placesService = await loadPlacesService(t, async (path) => {
    calls.push(path);
    return { data: { city: 'Delhi', attractions: [] } };
  });

  await placesService.getAttractions('DEL');

  assert.deepEqual(calls, ['/places/DEL/attractions']);
});

test('getHotels/getRestaurants/getAttractions: use a different path per IATA code (parameters are not hardcoded)', async (t) => {
  const calls = [];
  const placesService = await loadPlacesService(t, async (path) => {
    calls.push(path);
    return { data: {} };
  });

  await placesService.getHotels('BOM');
  await placesService.getRestaurants('BLR');
  await placesService.getAttractions('JFK');

  assert.deepEqual(calls, ['/places/BOM/hotels', '/places/BLR/restaurants', '/places/JFK/attractions']);
});

test('getHotels: returns the backend payload (res.data) unchanged, with no added/dropped fields', async (t) => {
  const backendPayload = {
    city: 'New Delhi',
    hotels: [
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
    ],
  };
  const placesService = await loadPlacesService(t, async () => ({ data: backendPayload }));

  const result = await placesService.getHotels('DEL');

  assert.deepEqual(result, backendPayload);
});

// ---------------------------------------------------------------------------
// Malformed / empty response handling — documents CURRENT behavior only.
// placesService does no defensive checking of the shape api.get resolves
// with; it just reads `.data` off whatever comes back (same as
// weatherService — this is a deliberate, shared, thin-wrapper pattern).
// ---------------------------------------------------------------------------

test('getHotels: a response body with no "data" field resolves to undefined (not an error)', async (t) => {
  const placesService = await loadPlacesService(t, async () => ({}));

  const result = await placesService.getHotels('DEL');

  assert.equal(result, undefined);
});

test('getAttractions: an explicit null "data" field resolves to null (not an error)', async (t) => {
  const placesService = await loadPlacesService(t, async () => ({ data: null }));

  const result = await placesService.getAttractions('DEL');

  assert.equal(result, null);
});

test('getRestaurants: a response with an empty restaurants array passes through as-is', async (t) => {
  const placesService = await loadPlacesService(t, async () => ({ data: { city: 'Delhi', restaurants: [] } }));

  const result = await placesService.getRestaurants('DEL');

  assert.deepEqual(result, { city: 'Delhi', restaurants: [] });
});

test('getHotels: a hotel entry with null/missing optional fields (rating, priceLevel, mapsUri, photoName) passes through unchanged, never patched or fabricated', async (t) => {
  const backendPayload = {
    city: 'Delhi',
    hotels: [
      {
        id: 'places/hotel2',
        name: 'Budget Inn',
        address: null,
        rating: null,
        ratingCount: 0,
        priceLevel: null,
        openNow: null,
        mapsUri: null,
        location: null,
        photoName: null,
      },
    ],
  };
  const placesService = await loadPlacesService(t, async () => ({ data: backendPayload }));

  const result = await placesService.getHotels('DEL');

  assert.deepEqual(result, backendPayload);
});

test('getHotels: when api.get itself resolves to null (e.g. apiClient failed to parse the body), reading .data throws synchronously — current behavior is unguarded', async (t) => {
  const placesService = await loadPlacesService(t, async () => null);

  await assert.rejects(() => placesService.getHotels('DEL'), TypeError);
});

// ---------------------------------------------------------------------------
// Network / provider error handling — placesService has no try/catch of its
// own, so a rejection from api.get (network failure or a non-2xx ApiError,
// e.g. the backend's PLACES_PROVIDER_ERROR/PLACES_NOT_CONFIGURED) propagates
// unchanged for all three methods.
// ---------------------------------------------------------------------------

test('getHotels: propagates a network-level failure unchanged (no swallowing/wrapping)', async (t) => {
  const networkError = new TypeError('Failed to fetch');
  const placesService = await loadPlacesService(t, async () => {
    throw networkError;
  });

  await assert.rejects(() => placesService.getHotels('DEL'), (err) => err === networkError);
});

test('getRestaurants: propagates a 502 PLACES_PROVIDER_ERROR ApiError unchanged, preserving status/errorCode/message', async (t) => {
  const apiError = Object.assign(new Error('Could not fetch nearby places right now.'), {
    status: 502,
    errorCode: 'PLACES_PROVIDER_ERROR',
  });
  const placesService = await loadPlacesService(t, async () => {
    throw apiError;
  });

  await assert.rejects(
    () => placesService.getRestaurants('DEL'),
    (err) => err === apiError && err.status === 502 && err.errorCode === 'PLACES_PROVIDER_ERROR'
  );
});

test('getAttractions: propagates a 500 PLACES_NOT_CONFIGURED ApiError unchanged', async (t) => {
  const apiError = Object.assign(new Error('Places data is not configured. Set GOOGLE_PLACES_API_KEY in .env.'), {
    status: 500,
    errorCode: 'PLACES_NOT_CONFIGURED',
  });
  const placesService = await loadPlacesService(t, async () => {
    throw apiError;
  });

  await assert.rejects(
    () => placesService.getAttractions('DEL'),
    (err) => err === apiError && err.status === 500 && err.errorCode === 'PLACES_NOT_CONFIGURED'
  );
});

test('getHotels: propagates a 400 AIRPORT_NOT_FOUND ApiError unchanged for an unknown IATA code', async (t) => {
  const apiError = Object.assign(new Error('Unknown airport code'), {
    status: 400,
    errorCode: 'AIRPORT_NOT_FOUND',
  });
  const placesService = await loadPlacesService(t, async () => {
    throw apiError;
  });

  await assert.rejects(
    () => placesService.getHotels('ZZZ'),
    (err) => err === apiError && err.status === 400
  );
});

// ---------------------------------------------------------------------------
// Security — the frontend service never adds any credential/API key to the
// outgoing request; only the IATA code appears in the path. This pins down
// the current, correct behavior as a regression guard.
// ---------------------------------------------------------------------------

test('getHotels/getRestaurants/getAttractions: the request path never contains anything other than "/places/<iataCode>/<resource>" — no key, token, or extra query param is ever appended here', async (t) => {
  const calls = [];
  const placesService = await loadPlacesService(t, async (path) => {
    calls.push(path);
    return { data: {} };
  });

  await placesService.getHotels('DEL');
  await placesService.getRestaurants('DEL');
  await placesService.getAttractions('DEL');

  for (const path of calls) {
    assert.match(path, /^\/places\/DEL\/(hotels|restaurants|attractions)$/);
  }
});

// ---------------------------------------------------------------------------
// Frontend caching — placesService itself has no cache/memoization of its
// own; any caching (react-query's staleTime, used by NearbyPlacesCard /
// TouristAttractionsCard / ResultsContent / SharedTripContent) lives one
// layer up. This documents there is no request de-duplication at this
// layer, so a stale cache in one caller can never accidentally return
// another destination's data here.
// ---------------------------------------------------------------------------

test('getHotels: does not cache — calling it twice for the same code calls api.get twice', async (t) => {
  const calls = [];
  const placesService = await loadPlacesService(t, async (path) => {
    calls.push(path);
    return { data: { hotels: [] } };
  });

  await placesService.getHotels('DEL');
  await placesService.getHotels('DEL');

  assert.deepEqual(calls, ['/places/DEL/hotels', '/places/DEL/hotels']);
});

test('getHotels: calls for two different destinations never share or mix results — each call resolves to exactly the payload its own api.get response provided', async (t) => {
  const placesService = await loadPlacesService(t, async (path) => {
    if (path === '/places/BOM/hotels') return { data: { city: 'Mumbai', hotels: [{ id: 'h1', name: 'Mumbai Hotel' }] } };
    if (path === '/places/BLR/hotels') return { data: { city: 'Bengaluru', hotels: [{ id: 'h2', name: 'Bengaluru Hotel' }] } };
    throw new Error(`unexpected path: ${path}`);
  });

  const [bom, blr] = await Promise.all([placesService.getHotels('BOM'), placesService.getHotels('BLR')]);

  assert.equal(bom.hotels[0].name, 'Mumbai Hotel');
  assert.equal(blr.hotels[0].name, 'Bengaluru Hotel');
});
