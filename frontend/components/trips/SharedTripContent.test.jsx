// Q5 Google Places — Batch 3: multi-city Places integration regression
// tests for SharedTripContent.jsx (the public /shared/[shareToken] page).
//
// GAP THIS FILLS: ResultsContent.jsx's multi-city Places orchestration
// (uniqueDestinations dedupe, per-destination useQueries fan-out,
// placesByDestination mapping) was thoroughly covered in Q5 Batch 2
// (components/results/ResultsContent.test.jsx). SharedTripContent.jsx
// duplicates that EXACT same logic (see its own comment: "same public
// `placesService` calls and multi-city fan-out ResultsContent already
// uses") for the Shared Trip view, but had ZERO tests of its own before
// this file — a regression in SharedTripContent's copy of that logic
// (e.g. from a future edit) would not be caught by ResultsContent's tests
// alone, since they are two separate components with two separate copies
// of the fan-out code.
//
// Only '@/services/placesService' is mocked (shared with the real
// NearbyPlacesCard/TouristAttractionsCard this renders, kept real for
// genuine integration coverage), same pattern as
// components/results/ResultsContent.test.jsx. Every other out-of-scope
// dependency (tripService, CategorySummary, RecommendationCard,
// ExpenseCalculatorCard, WeatherCard, PdfExportButton, TripTimelineCard)
// is stubbed since it is unrelated to Places and would otherwise require
// satisfying unrelated prop contracts.
//
// Run via:
//   node --experimental-test-module-mocks \
//        --import ./tests/support/domSetup.mjs \
//        --import ./tests/support/registerJsx.mjs \
//        --test --test-force-exit \
//        components/trips/SharedTripContent.test.jsx
//
// CONFIRMED BY READING CURRENT CODE (do not re-derive elsewhere):
//   - `uniqueDestinations` = `topRecommendation.destinationAirports`
//     (from `trip.result_json.recommendations[0]`) deduped by `.iata`
//     (first occurrence wins), computed via useMemo — identical shape to
//     ResultsContent.jsx.
//   - `hotelsQueries` / `attractionsQueries` / `restaurantsQueries` = one
//     `useQueries` entry per uniqueDestinations entry, query key
//     `['places', <type>, dest.iata]`, queryFn calling the matching
//     `placesService.get*(dest.iata)`.
//   - `placesByDestination` maps each unique destination's IATA to
//     `{ hotels, attractions, restaurants }` — a destination whose query
//     errored simply leaves that key `undefined`, never throws, never
//     borrows another destination's data.
//   - Rendering: the FIRST unique destination gets a <NearbyPlacesCard> in
//     the two-column grid (alongside <WeatherCard>), every OTHER unique
//     destination (`uniqueDestinations.slice(1)`) gets its own additional
//     <NearbyPlacesCard>. EVERY unique destination gets a
//     <TouristAttractionsCard> via `uniqueDestinations.map(...)`.
//   - This data is fetched LIVE on the shared page (not persisted on the
//     trip row) — `trip.result_json` only supplies destinationAirports/
//     legs/etc, never hotels/attractions/restaurants themselves, so
//     nothing here can be "fabricated" from stale stored data.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render, screen, waitFor, cleanup, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

afterEach(() => {
  cleanup();
});

let loadCounter = 0;

/**
 * Records every placesService call (in order, with the iataCode called)
 * and resolves/rejects per-iata according to the given maps. A destination
 * with no entry in a given map resolves to an empty list for that category
 * (mirrors the real API's "no results" shape), never throws by default.
 */
function makePlacesServiceMock({ hotels = {}, restaurants = {}, attractions = {}, cities = {} } = {}) {
  const calls = { hotels: [], restaurants: [], attractions: [] };

  function respond(map, key, listKey) {
    return async (iataCode) => {
      calls[listKey].push(iataCode);
      const entry = map[iataCode];
      if (entry instanceof Error) throw entry;
      return { city: cities[iataCode] || iataCode, [key]: entry || [] };
    };
  }

  const placesService = {
    getHotels: respond(hotels, 'hotels', 'hotels'),
    getRestaurants: respond(restaurants, 'restaurants', 'restaurants'),
    getAttractions: respond(attractions, 'attractions', 'attractions'),
  };

  return { placesService, calls };
}

function place(idSuffix, name) {
  return {
    id: `places/${idSuffix}`,
    name,
    address: `${name} Address`,
    rating: 4.5,
    ratingCount: 100,
    priceLevel: null,
    openNow: true,
    mapsUri: `https://maps.google.com/?cid=${idSuffix}`,
    location: { lat: 0, lon: 0 },
    photoName: null,
  };
}

function baseRecommendation(destinationAirports) {
  return {
    destinationAirports,
    originAirport: { iata: 'DEL', city: 'New Delhi', isPrimary: true },
    legs: [],
    totalPriceInr: 20000,
    totalDurationMinutes: 300,
    totalStops: 0,
    explanation: 'Test recommendation',
  };
}

function baseTrip(recommendations) {
  return {
    origin_iata: 'DEL',
    destination_countries: ['IN'],
    departure_date: '2026-10-01',
    return_date: null,
    travelers: 1,
    budget_inr: null,
    result_json: { recommendations, categories: {}, meta: {} },
  };
}

/**
 * Mocks every dependency SharedTripContent.jsx imports, EXCEPT
 * '@/services/placesService' (given explicitly) and the two Places card
 * components themselves (kept real for genuine integration coverage).
 * Everything out of scope for Places is stubbed to a trivial component so
 * it can never fail this suite for unrelated reasons.
 */
async function loadSharedTripContent(t, { trip, placesService, shareToken = 'tok_abc123' }) {
  t.mock.module('next/navigation', {
    namedExports: {
      useParams: () => ({ shareToken }),
      useRouter: () => ({ push: () => {} }),
    },
  });
  t.mock.module('@/services/tripService', {
    namedExports: {
      tripService: { getSharedTrip: async () => trip },
    },
  });
  t.mock.module('@/services/placesService', {
    namedExports: { placesService },
  });
  t.mock.module('@/components/results/CategorySummary', {
    namedExports: { CategorySummary: () => null },
  });
  t.mock.module('@/components/results/RecommendationCard', {
    namedExports: { RecommendationCard: () => null },
  });
  t.mock.module('@/components/results/ExpenseCalculatorCard', {
    namedExports: { ExpenseCalculatorCard: () => null },
  });
  t.mock.module('@/components/results/WeatherCard', {
    namedExports: { WeatherCard: () => null },
  });
  t.mock.module('@/components/results/TripTimelineCard', {
    // Captures placesByDestination as JSON in the DOM so tests can assert
    // exactly what each destination's mapped Places data looked like,
    // without re-deriving it from separately rendered cards.
    namedExports: {
      TripTimelineCard: ({ placesByDestination }) => (
        <pre data-testid="places-by-destination">{JSON.stringify(placesByDestination)}</pre>
      ),
    },
  });
  t.mock.module('@/components/results/PdfExportButton', {
    namedExports: { PdfExportButton: () => null },
  });

  loadCounter += 1;

  // NearbyPlacesCard/TouristAttractionsCard are real (unmocked) components,
  // but SharedTripContent.jsx reaches them via aliased '@/components/results/...'
  // specifiers rather than relative './...' ones (they live in a different
  // directory). jsxLoader.mjs deliberately does NOT propagate a parent's
  // cache-bust query onto aliased specifiers (that's what lets an aliased
  // MOCKED dependency, e.g. '@/services/placesService', keep resolving to
  // the plain URL t.mock.module registered against). Left as plain aliased
  // imports, these two components would only ever be loaded/linked once for
  // this whole file — permanently bound to whichever test's placesService
  // mock was active the first time either was imported.
  //
  // Fix: import fresh, explicitly cache-busted instances of the two real
  // components ourselves (same '@/...jsx?case=N' convention already used
  // below for the top-level component, already handled by the loader's
  // existing specifier-level suffix support — no loader change needed),
  // then hand those fresh instances to t.mock.module for the aliased
  // specifiers SharedTripContent.jsx actually imports. Each test therefore
  // gets a brand-new NearbyPlacesCard/TouristAttractionsCard module, which
  // re-resolves '@/services/placesService' against the CURRENTLY registered
  // mock above, instead of reusing a stale binding from an earlier test.
  const { NearbyPlacesCard } = await import(`@/components/results/NearbyPlacesCard.jsx?case=${loadCounter}`);
  const { TouristAttractionsCard } = await import(
    `@/components/results/TouristAttractionsCard.jsx?case=${loadCounter}`
  );
  t.mock.module('@/components/results/NearbyPlacesCard', {
    namedExports: { NearbyPlacesCard },
  });
  t.mock.module('@/components/results/TouristAttractionsCard', {
    namedExports: { TouristAttractionsCard },
  });

  const mod = await import(`@/components/trips/SharedTripContent.jsx?case=${loadCounter}`);
  return mod.SharedTripContent;
}

function renderPage(SharedTripContent) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <SharedTripContent />
    </QueryClientProvider>
  );
}

// ---------------------------------------------------------------------------
// 1. Multiple actual destinations each get their own Places data
// ---------------------------------------------------------------------------

test('SharedTripContent: each of two real destinations gets its own hotels, restaurants and attractions fetched by its own IATA', async (t) => {
  const { placesService, calls } = makePlacesServiceMock({
    hotels: { BOM: [place('bomh1', 'Mumbai Grand Hotel')], BLR: [place('blrh1', 'Bengaluru Suites')] },
    restaurants: { BOM: [place('bomr1', 'Mumbai Diner')], BLR: [place('blrr1', 'Bengaluru Cafe')] },
    attractions: { BOM: [place('boma1', 'Gateway of India')], BLR: [place('blra1', 'Lalbagh Garden')] },
    cities: { BOM: 'Mumbai', BLR: 'Bengaluru' },
  });

  const recommendations = [
    baseRecommendation([
      { iata: 'BOM', city: 'Mumbai', isPrimary: true },
      { iata: 'BLR', city: 'Bengaluru', isPrimary: true },
    ]),
  ];

  const SharedTripContent = await loadSharedTripContent(t, { trip: baseTrip(recommendations), placesService });
  renderPage(SharedTripContent);

  await waitFor(() => screen.getByText('Mumbai Grand Hotel'));
  await waitFor(() => screen.getByText('Bengaluru Suites'));
  await waitFor(() => screen.getByText('Gateway of India'));
  await waitFor(() => screen.getByText('Lalbagh Garden'));

  assert.deepEqual([...new Set(calls.hotels)].sort(), ['BLR', 'BOM']);
  assert.deepEqual([...new Set(calls.attractions)].sort(), ['BLR', 'BOM']);
});

// ---------------------------------------------------------------------------
// 2. Origin airport is NOT unnecessarily queried as a destination
// ---------------------------------------------------------------------------

test('SharedTripContent: the origin airport (DEL) is never queried for hotels, restaurants or attractions', async (t) => {
  const { placesService, calls } = makePlacesServiceMock({
    hotels: { BOM: [place('h1', 'Mumbai Hotel')] },
    cities: { BOM: 'Mumbai' },
  });

  const recommendations = [baseRecommendation([{ iata: 'BOM', city: 'Mumbai', isPrimary: true }])];

  const SharedTripContent = await loadSharedTripContent(t, { trip: baseTrip(recommendations), placesService });
  renderPage(SharedTripContent);

  await waitFor(() => screen.getByText('Mumbai Hotel'));

  assert.ok(!calls.hotels.includes('DEL'), 'origin IATA DEL must never be queried for hotels');
  assert.ok(!calls.restaurants.includes('DEL'), 'origin IATA DEL must never be queried for restaurants');
  assert.ok(!calls.attractions.includes('DEL'), 'origin IATA DEL must never be queried for attractions');
});

// ---------------------------------------------------------------------------
// 3. Duplicate destination IATAs are deduplicated
// ---------------------------------------------------------------------------

test('SharedTripContent: a repeated destination IATA (multi-city circuit revisiting a city) is fetched only once and rendered only once', async (t) => {
  const { placesService, calls } = makePlacesServiceMock({
    hotels: { BOM: [place('h1', 'Mumbai Hotel')] },
    attractions: { BOM: [place('a1', 'Gateway of India')] },
    cities: { BOM: 'Mumbai' },
  });

  // Circuit: DEL -> BOM -> BLR -> BOM (BOM appears twice).
  const recommendations = [
    baseRecommendation([
      { iata: 'BOM', city: 'Mumbai', isPrimary: true },
      { iata: 'BLR', city: 'Bengaluru', isPrimary: true },
      { iata: 'BOM', city: 'Mumbai', isPrimary: true },
    ]),
  ];

  const SharedTripContent = await loadSharedTripContent(t, { trip: baseTrip(recommendations), placesService });
  renderPage(SharedTripContent);

  await waitFor(() => screen.getByText('Mumbai Hotel'));
  await waitFor(() => screen.getByText('Gateway of India'));

  assert.equal(calls.hotels.filter((c) => c === 'BOM').length, 1, 'BOM hotels should be fetched exactly once');
  assert.equal(
    calls.attractions.filter((c) => c === 'BOM').length,
    1,
    'BOM attractions should be fetched exactly once'
  );
  // Only 2 unique destinations (BOM, BLR) -> exactly 2 "Near <city>" cards,
  // never 3 even though destinationAirports had 3 entries.
  assert.equal(screen.getAllByText(/^Near /).length, 2);
});

// ---------------------------------------------------------------------------
// 4. One destination's Places failure does not corrupt other destinations
// ---------------------------------------------------------------------------

test("SharedTripContent: a hotels failure for one destination does not affect another destination's hotels, restaurants or attractions", async (t) => {
  const { placesService } = makePlacesServiceMock({
    hotels: { BOM: new Error('Places provider down'), BLR: [place('h1', 'Bengaluru Suites')] },
    restaurants: { BOM: [place('r1', 'Mumbai Diner')], BLR: [place('r2', 'Bengaluru Cafe')] },
    attractions: { BOM: [place('a1', 'Gateway of India')], BLR: [place('a2', 'Lalbagh Garden')] },
    cities: { BOM: 'Mumbai', BLR: 'Bengaluru' },
  });

  const recommendations = [
    baseRecommendation([
      { iata: 'BOM', city: 'Mumbai', isPrimary: true },
      { iata: 'BLR', city: 'Bengaluru', isPrimary: true },
    ]),
  ];

  const SharedTripContent = await loadSharedTripContent(t, { trip: baseTrip(recommendations), placesService });
  const { container } = renderPage(SharedTripContent);

  // BLR (unaffected destination) still renders its real hotel data.
  await waitFor(() => screen.getByText('Bengaluru Suites'));

  // BOM's Nearby Places card defaults to the Hotels tab, where its query
  // failed: it shows the fallback message instead of crashing the page or
  // showing another destination's hotel.
  const nearMumbai = screen.getByText('Near Mumbai').closest('div').parentElement;
  assert.ok(within(nearMumbai).getByText('Nothing found nearby right now.'));
  assert.ok(!within(nearMumbai).queryByText('Bengaluru Suites'), "BOM's card must never show BLR's hotel");

  // BOM's restaurants query is unaffected by the hotels failure — switch
  // that same card to its Food tab to see it.
  fireEvent.click(within(nearMumbai).getByText('Food'));
  await waitFor(() => within(nearMumbai).getByText('Mumbai Diner'));

  // BOM's attractions (a separate card entirely) render fine too.
  await waitFor(() => screen.getByText('Gateway of India'));

  // The page itself never crashed — BLR's card is present and correct.
  assert.ok(container.querySelector('body') !== undefined);
});

// ---------------------------------------------------------------------------
// 5. Correct Places data is associated with the correct destination
// ---------------------------------------------------------------------------

test('SharedTripContent: placesByDestination maps each unique destination IATA to its own (never swapped) hotels/attractions/restaurants', async (t) => {
  const { placesService } = makePlacesServiceMock({
    hotels: { BOM: [place('bomh', 'Mumbai Hotel')], BLR: [place('blrh', 'Bengaluru Hotel')] },
    restaurants: { BOM: [place('bomr', 'Mumbai Restaurant')], BLR: [place('blrr', 'Bengaluru Restaurant')] },
    attractions: { BOM: [place('boma', 'Mumbai Attraction')], BLR: [place('blra', 'Bengaluru Attraction')] },
    cities: { BOM: 'Mumbai', BLR: 'Bengaluru' },
  });

  const recommendations = [
    baseRecommendation([
      { iata: 'BOM', city: 'Mumbai', isPrimary: true },
      { iata: 'BLR', city: 'Bengaluru', isPrimary: true },
    ]),
  ];

  const SharedTripContent = await loadSharedTripContent(t, { trip: baseTrip(recommendations), placesService });
  renderPage(SharedTripContent);

  const pre = await waitFor(() => screen.getByTestId('places-by-destination'));
  const mapped = await waitFor(() => {
    const parsed = JSON.parse(pre.textContent);
    assert.ok(parsed.BOM?.hotels?.length, 'expected BOM hotels to be populated by now');
    assert.ok(parsed.BLR?.hotels?.length, 'expected BLR hotels to be populated by now');
    return parsed;
  });

  assert.equal(mapped.BOM.hotels[0].name, 'Mumbai Hotel');
  assert.equal(mapped.BOM.restaurants[0].name, 'Mumbai Restaurant');
  assert.equal(mapped.BOM.attractions[0].name, 'Mumbai Attraction');

  assert.equal(mapped.BLR.hotels[0].name, 'Bengaluru Hotel');
  assert.equal(mapped.BLR.restaurants[0].name, 'Bengaluru Restaurant');
  assert.equal(mapped.BLR.attractions[0].name, 'Bengaluru Attraction');

  // Never swapped.
  assert.notEqual(mapped.BOM.hotels[0].name, mapped.BLR.hotels[0].name);
});

// ---------------------------------------------------------------------------
// 6. Missing Places data (nothing found, not an error) is handled safely
// ---------------------------------------------------------------------------

test('SharedTripContent: a destination with genuinely no hotels/attractions/restaurants (empty arrays, not an error) renders its empty-state fallbacks rather than fabricating data', async (t) => {
  const { placesService } = makePlacesServiceMock({
    hotels: { BOM: [place('bomh', 'Mumbai Hotel')], BLR: [] },
    attractions: { BOM: [place('boma', 'Mumbai Attraction')], BLR: [] },
    restaurants: { BOM: [], BLR: [] },
    cities: { BOM: 'Mumbai', BLR: 'Bengaluru' },
  });

  const recommendations = [
    baseRecommendation([
      { iata: 'BOM', city: 'Mumbai', isPrimary: true },
      { iata: 'BLR', city: 'Bengaluru', isPrimary: true },
    ]),
  ];

  const SharedTripContent = await loadSharedTripContent(t, { trip: baseTrip(recommendations), placesService });
  renderPage(SharedTripContent);

  await waitFor(() => screen.getByText('Mumbai Hotel'));

  const nearBengaluru = screen.getByText('Near Bengaluru').closest('div').parentElement;
  assert.ok(within(nearBengaluru).getByText('Nothing found nearby right now.'));
  assert.ok(
    !within(nearBengaluru).queryByText('Mumbai Hotel'),
    "Bengaluru's empty hotels card must never show Mumbai's hotel"
  );

  await waitFor(() => screen.getByText('No tourist attractions found for Bengaluru yet.'));
});

// ---------------------------------------------------------------------------
// 7. Single-destination shared trips still work (first-destination dedupe)
// ---------------------------------------------------------------------------

test('SharedTripContent: a single-destination shared trip fetches hotels for that destination exactly once (no duplicate request for destination[0])', async (t) => {
  const { placesService, calls } = makePlacesServiceMock({
    hotels: { BOM: [place('h1', 'Mumbai Hotel')] },
    cities: { BOM: 'Mumbai' },
  });

  const recommendations = [baseRecommendation([{ iata: 'BOM', city: 'Mumbai', isPrimary: true }])];

  const SharedTripContent = await loadSharedTripContent(t, { trip: baseTrip(recommendations), placesService });
  renderPage(SharedTripContent);

  await waitFor(() => screen.getByText('Mumbai Hotel'));
  // Give any duplicate fetch a chance to fire.
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(calls.hotels.filter((c) => c === 'BOM').length, 1);
  assert.equal(screen.getAllByText(/^Near /).length, 1);
});

// ---------------------------------------------------------------------------
// 8. No recommendation data at all (edge case specific to shared/stored
//    trips — result_json could theoretically be empty) never crashes and
//    never invents Places data.
// ---------------------------------------------------------------------------

test('SharedTripContent: a shared trip with no stored recommendations renders the "no recommendation data" message and never calls placesService', async (t) => {
  const { placesService, calls } = makePlacesServiceMock();

  const SharedTripContent = await loadSharedTripContent(t, { trip: baseTrip([]), placesService });
  renderPage(SharedTripContent);

  await waitFor(() => screen.getByText('No recommendation data was stored for this trip.'));

  assert.deepEqual(calls.hotels, []);
  assert.deepEqual(calls.restaurants, []);
  assert.deepEqual(calls.attractions, []);
});
