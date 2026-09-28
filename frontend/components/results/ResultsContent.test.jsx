// Q5 Google Places — Batch 2: MULTI-CITY PLACES orchestration tests for
// ResultsContent.jsx.
//
// Backend Places routes (see backend/tests/integration/places.test.js,
// Q5 Batch 1) are single-destination only — there is no server-side
// multi-city aggregation. The actual "multi-city Places" behavior (one
// destination airport's data isolated from another's, origin excluded,
// duplicate IATAs deduped) lives entirely in this component's own
// `uniqueDestinations` / `useQueries` / `placesByDestination` logic. These
// tests exercise that real logic end to end, through real NearbyPlacesCard
// and TouristAttractionsCard renders — only their shared dependency
// ('@/services/placesService') is mocked, plus every OTHER out-of-scope
// child (Weather, Trip Timeline, PDF Export, Share Trip, Budget/Expense,
// Category Summary, Recommendation list) which is stubbed out since it is
// explicitly out of scope for this fix and would otherwise require
// satisfying unrelated prop contracts.
//
// Run via:
//   node --experimental-test-module-mocks \
//        --import ./tests/support/domSetup.mjs \
//        --import ./tests/support/registerJsx.mjs \
//        --test --test-force-exit \
//        components/results/ResultsContent.test.jsx
//
// CONFIRMED BY READING CURRENT CODE (do not re-derive elsewhere):
//   - `uniqueDestinations` = `topRecommendation.destinationAirports`
//     deduped by `.iata` (first occurrence wins), computed via useMemo.
//   - `hotelsQueries` / `attractionsQueries` / `restaurantsQueries` = one
//     `useQueries` entry per uniqueDestinations entry, query key
//     `['places', <type>, dest.iata]`, queryFn calling the matching
//     `placesService.get*(dest.iata)` — origin airport is never in this
//     list because `destinationAirports` never includes the origin unless
//     it is itself a genuine stop (out of scope here; not exercised).
//   - `placesByDestination` maps each unique destination's IATA to
//     `{ hotels, attractions, restaurants }` pulled from the matching index
//     of the three queries above — a destination whose query errored simply
//     leaves that key `undefined` in its per-destination object, it does
//     not throw and does not affect any other destination's entry.
//   - Rendering: the FIRST unique destination gets a <NearbyPlacesCard> in
//     the two-column grid (alongside <WeatherCard>), every OTHER unique
//     destination (`uniqueDestinations.slice(1)`) gets its own additional
//     <NearbyPlacesCard>. EVERY unique destination (including the first)
//     gets a <TouristAttractionsCard> via `uniqueDestinations.map(...)`.
//   - `topDestinationIata` (`destinationAirports[0].iata`) separately drives
//     its own hotels/restaurants/attractions queries with the SAME query
//     key shape — for the first destination this is the identical key,
//     so react-query dedupes it into one request, not two.

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

/**
 * Mocks every dependency ResultsContent.jsx imports, EXCEPT
 * '@/services/placesService' (given explicitly, shared with the real
 * NearbyPlacesCard/TouristAttractionsCard it renders) and the two Places
 * card components themselves (kept real for genuine integration coverage).
 * Everything out of scope for the multi-city Places fix is stubbed to a
 * trivial component so it can never fail this suite for unrelated reasons.
 */
async function loadResultsContent(t, { recommendations, placesService, search = '' }) {
  // Computed BEFORE registering any mocks (rather than after, as this used
  // to be) so it's available below: ResultsContent.jsx is loaded from
  // '@/components/results/ResultsContent.jsx?case=<id>', and jsxLoader.mjs
  // deliberately propagates that same '?case=<id>' suffix onto every one of
  // ITS OWN relative ('./...') sibling imports (see jsxLoader.mjs for why —
  // in short, so a real, unmocked sibling like NearbyPlacesCard gets a
  // fresh instance per test, correctly re-bound to whichever
  // '@/services/placesService' mock is active for THIS test, rather than
  // staying permanently linked to an earlier test's mock).
  //
  // That propagation means the resolved URL for e.g. './TripTimelineCard'
  // as imported BY ResultsContent.jsx is actually
  // '.../TripTimelineCard.jsx?case=<id>', not the bare, suffix-less
  // '.../TripTimelineCard.jsx'. A mock registered here as plain
  // './TripTimelineCard' (no suffix) resolves — from this test file, which
  // carries no such suffix itself — to that bare URL instead, so it never
  // matches the suffixed URL ResultsContent.jsx actually asks for, and the
  // REAL TripTimelineCard silently renders instead of the stub. (This only
  // caused an observable failure for TripTimelineCard, since it's the only
  // one of these fully-replaced siblings whose rendered output is asserted
  // on, but the same mismatch existed for all of them.)
  //
  // Fix: register each of these fully-replaced-sibling mocks against that
  // SAME '?case=<id>' suffix, so they resolve to the exact URL
  // ResultsContent.jsx will actually import.
  loadCounter += 1;
  const caseSuffix = `?case=${loadCounter}`;

  t.mock.module('next/navigation', {
    namedExports: {
      useSearchParams: () => new URLSearchParams(search),
      useRouter: () => ({ push: () => {} }),
    },
  });
  t.mock.module('@/hooks/useAuth', {
    namedExports: { useAuth: () => ({ isAuthenticated: false }) },
  });
  t.mock.module('@/components/ui/Toast', {
    namedExports: { useToast: () => ({ toast: () => {} }) },
  });
  t.mock.module('@/services/tripService', {
    namedExports: {
      tripService: {
        optimize: async () => ({
          recommendations,
          categories: {},
          meta: {},
        }),
      },
    },
  });
  t.mock.module('@/services/placesService', {
    namedExports: { placesService },
  });
  t.mock.module(`./OptimizerLoadingState${caseSuffix}`, {
    namedExports: { OptimizerLoadingState: () => <div data-testid="loading-stub" /> },
  });
  t.mock.module(`./CategorySummary${caseSuffix}`, {
    namedExports: { CategorySummary: () => null },
  });
  t.mock.module(`./BudgetInsightCard${caseSuffix}`, {
    namedExports: { BudgetInsightCard: () => null },
  });
  t.mock.module(`./ExpenseCalculatorCard${caseSuffix}`, {
    namedExports: { ExpenseCalculatorCard: () => null },
  });
  t.mock.module(`./RecommendationCard${caseSuffix}`, {
    namedExports: { RecommendationCard: () => null },
  });
  t.mock.module(`./WeatherCard${caseSuffix}`, {
    namedExports: { WeatherCard: () => null },
  });
  t.mock.module(`./TripTimelineCard${caseSuffix}`, {
    // Captures placesByDestination as JSON in the DOM so tests can assert
    // exactly what each destination's mapped Places data looked like,
    // without re-deriving it from separately rendered cards.
    namedExports: {
      TripTimelineCard: ({ placesByDestination }) => (
        <pre data-testid="places-by-destination">{JSON.stringify(placesByDestination)}</pre>
      ),
    },
  });
  t.mock.module(`./PdfExportButton${caseSuffix}`, {
    namedExports: { PdfExportButton: () => null },
  });
  t.mock.module('@/components/trips/ShareTripButton', {
    namedExports: { ShareTripButton: () => null },
  });

  const mod = await import(`@/components/results/ResultsContent.jsx?case=${loadCounter}`);
  return mod.ResultsContent;
}

function renderPage(ResultsContent) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <ResultsContent />
    </QueryClientProvider>
  );
}

const DEFAULT_SEARCH = 'origin=DEL&destinations=IN&departureDate=2026-10-01';

// ---------------------------------------------------------------------------
// 1. Multiple actual destinations each get their own Places data
// ---------------------------------------------------------------------------

test('ResultsContent: each of two real destinations gets its own hotels, restaurants and attractions fetched by its own IATA', async (t) => {
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

  const ResultsContent = await loadResultsContent(t, { recommendations, placesService, search: DEFAULT_SEARCH });
  renderPage(ResultsContent);

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

test('ResultsContent: the origin airport (DEL) is never queried for hotels, restaurants or attractions', async (t) => {
  const { placesService, calls } = makePlacesServiceMock({
    hotels: { BOM: [place('h1', 'Mumbai Hotel')] },
    cities: { BOM: 'Mumbai' },
  });

  const recommendations = [baseRecommendation([{ iata: 'BOM', city: 'Mumbai', isPrimary: true }])];

  const ResultsContent = await loadResultsContent(t, { recommendations, placesService, search: DEFAULT_SEARCH });
  renderPage(ResultsContent);

  await waitFor(() => screen.getByText('Mumbai Hotel'));

  assert.ok(!calls.hotels.includes('DEL'), 'origin IATA DEL must never be queried for hotels');
  assert.ok(!calls.restaurants.includes('DEL'), 'origin IATA DEL must never be queried for restaurants');
  assert.ok(!calls.attractions.includes('DEL'), 'origin IATA DEL must never be queried for attractions');
});

// ---------------------------------------------------------------------------
// 3. Duplicate destination IATAs are deduplicated
// ---------------------------------------------------------------------------

test('ResultsContent: a repeated destination IATA (multi-city circuit revisiting a city) is fetched only once and rendered only once', async (t) => {
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

  const ResultsContent = await loadResultsContent(t, { recommendations, placesService, search: DEFAULT_SEARCH });
  renderPage(ResultsContent);

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

test('ResultsContent: a hotels failure for one destination does not affect another destination\'s hotels, restaurants or attractions', async (t) => {
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

  const ResultsContent = await loadResultsContent(t, { recommendations, placesService, search: DEFAULT_SEARCH });
  const { container } = renderPage(ResultsContent);

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

test('ResultsContent: placesByDestination maps each unique destination IATA to its own (never swapped) hotels/attractions/restaurants', async (t) => {
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

  const ResultsContent = await loadResultsContent(t, { recommendations, placesService, search: DEFAULT_SEARCH });
  renderPage(ResultsContent);

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
// 6. Single-destination trips still work (first-destination query dedupe)
// ---------------------------------------------------------------------------

test('ResultsContent: a single-destination trip fetches hotels for that destination exactly once (no duplicate request for destination[0])', async (t) => {
  const { placesService, calls } = makePlacesServiceMock({
    hotels: { BOM: [place('h1', 'Mumbai Hotel')] },
    cities: { BOM: 'Mumbai' },
  });

  const recommendations = [baseRecommendation([{ iata: 'BOM', city: 'Mumbai', isPrimary: true }])];

  const ResultsContent = await loadResultsContent(t, { recommendations, placesService, search: DEFAULT_SEARCH });
  renderPage(ResultsContent);

  await waitFor(() => screen.getByText('Mumbai Hotel'));
  // Give any duplicate fetch a chance to fire.
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(calls.hotels.filter((c) => c === 'BOM').length, 1);
  assert.equal(screen.getAllByText(/^Near /).length, 1);
});
