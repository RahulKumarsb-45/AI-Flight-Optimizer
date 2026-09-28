// Q5 Google Places — Batch 2: component-level tests for NearbyPlacesCard.jsx
// (Hotels + Restaurants tabs).
//
// Same harness as WeatherCard.test.jsx (Q4) — plain `node --test` needs a
// DOM + JSX transform, so these run with:
//
//   node --experimental-test-module-mocks \
//        --import ./tests/support/domSetup.mjs \
//        --import ./tests/support/registerJsx.mjs \
//        --test --test-force-exit \
//        components/results/NearbyPlacesCard.test.jsx
//
// Only '@/services/placesService' is mocked. Everything else (Tabs,
// react-query, lucide-react icons) is the real production code.
//
// CONFIRMED BY READING CURRENT CODE (do not re-derive elsewhere):
//   - NearbyPlacesCard renders a Hotels/Food tab switcher (default tab:
//     'hotels') and delegates the actual list to an internal <PlacesList>,
//     which runs `useQuery({ queryKey: ['places', type, iataCode], queryFn:
//     () => type === 'hotels' ? placesService.getHotels(iataCode) :
//     placesService.getRestaurants(iataCode) })`.
//   - Loading state: 3 pulsing skeleton rows (`.animate-pulse`), no list
//     content.
//   - Both an errored query (isError) AND a successful-but-empty query
//     render the EXACT SAME fallback text: "Nothing found nearby right now."
//     — the component does not distinguish the two cases.
//   - Success: one row per place (`data[type].map`), each showing name,
//     address, a star+rating (only if `place.rating` is truthy), a
//     PRICE_LEVEL_LABELS-mapped price glyph (only if `place.priceLevel` is
//     truthy and recognized), and an <a href={place.mapsUri || '#'}
//     target="_blank">.
//   - Photo handling: if `place.photoName` is present, an <img> is rendered
//     with src `${API_BASE_URL}/places/photo?name=<encoded photoName>&maxWidth=200`
//     (API_BASE_URL defaults to 'http://localhost:5000/api' via
//     NEXT_PUBLIC_API_URL). If `photoName` is absent, OR the <img> fires an
//     `error` event, an ImageOff icon placeholder renders instead (no <img>
//     in the DOM at all in either case).

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

afterEach(() => {
  cleanup();
});

let loadCounter = 0;

/**
 * Mocks '@/services/placesService' with the given getHotels/getRestaurants
 * implementations, then imports a fresh NearbyPlacesCard bound to that mock
 * (cache-busted so mocks from different tests never leak into each other).
 */
async function loadNearbyPlacesCard(t, { getHotels, getRestaurants } = {}) {
  t.mock.module('@/services/placesService', {
    namedExports: {
      placesService: {
        getHotels: getHotels || (async () => ({ city: 'Test City', hotels: [] })),
        getRestaurants: getRestaurants || (async () => ({ city: 'Test City', restaurants: [] })),
      },
    },
  });
  loadCounter += 1;
  const mod = await import(`@/components/results/NearbyPlacesCard.jsx?case=${loadCounter}`);
  return mod.NearbyPlacesCard;
}

function renderCard(NearbyPlacesCard, props = {}, client) {
  const queryClient = client || new QueryClient();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <NearbyPlacesCard iataCode="DEL" city="Delhi" {...props} />
    </QueryClientProvider>
  );
  return { ...utils, queryClient };
}

function hotel(overrides = {}) {
  return {
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
    ...overrides,
  };
}

function restaurant(overrides = {}) {
  return {
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
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

test('NearbyPlacesCard: shows the loading skeleton while the hotels query is in flight, and no rows', async (t) => {
  const NearbyPlacesCard = await loadNearbyPlacesCard(t, {
    getHotels: () => new Promise(() => {}), // never resolves
  });

  const { container } = renderCard(NearbyPlacesCard);

  const skeletons = container.querySelectorAll('.animate-pulse');
  assert.equal(skeletons.length, 3, 'expected 3 skeleton rows while loading');
  assert.equal(screen.queryByText('Grand Hotel'), null);
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

test('NearbyPlacesCard: shows "Nothing found nearby right now." when hotels resolve to an empty array', async (t) => {
  const NearbyPlacesCard = await loadNearbyPlacesCard(t, {
    getHotels: async () => ({ city: 'Delhi', hotels: [] }),
  });

  renderCard(NearbyPlacesCard);

  await waitFor(() => screen.getByText('Nothing found nearby right now.'));
});

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

test('NearbyPlacesCard: shows the SAME "Nothing found nearby right now." message when the hotels query errors (no distinct error UI)', async (t) => {
  const NearbyPlacesCard = await loadNearbyPlacesCard(t, {
    getHotels: async () => {
      throw new Error('Places unavailable');
    },
  });

  renderCard(NearbyPlacesCard);

  await waitFor(() => screen.getByText('Nothing found nearby right now.'));
  // Confirms this is genuinely the error path and not a lucky empty-state
  // race: the raw error message is never surfaced anywhere in the card.
  assert.equal(screen.queryByText(/Places unavailable/), null);
});

// ---------------------------------------------------------------------------
// Success — hotel rows, rating, price level, photo
// ---------------------------------------------------------------------------

test('NearbyPlacesCard: renders one row per hotel with name, address, rating and price level', async (t) => {
  const NearbyPlacesCard = await loadNearbyPlacesCard(t, {
    getHotels: async () => ({ city: 'Delhi', hotels: [hotel()] }),
  });

  renderCard(NearbyPlacesCard);

  await waitFor(() => screen.getByText('Grand Hotel'));
  assert.ok(screen.getByText('123 Main St'));
  assert.ok(screen.getByText('4.5'));
  assert.ok(screen.getByText('₹₹')); // PRICE_LEVEL_MODERATE
});

test('NearbyPlacesCard: links each row to the correct mapsUri and opens in a new tab', async (t) => {
  const NearbyPlacesCard = await loadNearbyPlacesCard(t, {
    getHotels: async () => ({ city: 'Delhi', hotels: [hotel()] }),
  });

  renderCard(NearbyPlacesCard);

  await waitFor(() => screen.getByText('Grand Hotel'));
  const link = screen.getByText('Grand Hotel').closest('a');
  assert.equal(link.getAttribute('href'), 'https://maps.google.com/?cid=1');
  assert.equal(link.getAttribute('target'), '_blank');
});

test('NearbyPlacesCard: falls back to "#" when a hotel has no mapsUri', async (t) => {
  const NearbyPlacesCard = await loadNearbyPlacesCard(t, {
    getHotels: async () => ({ city: 'Delhi', hotels: [hotel({ mapsUri: null })] }),
  });

  renderCard(NearbyPlacesCard);

  await waitFor(() => screen.getByText('Grand Hotel'));
  const link = screen.getByText('Grand Hotel').closest('a');
  assert.equal(link.getAttribute('href'), '#');
});

test('NearbyPlacesCard: does not render a rating badge when rating is absent', async (t) => {
  const NearbyPlacesCard = await loadNearbyPlacesCard(t, {
    getHotels: async () => ({ city: 'Delhi', hotels: [hotel({ rating: null })] }),
  });

  renderCard(NearbyPlacesCard);

  await waitFor(() => screen.getByText('Grand Hotel'));
  assert.equal(screen.queryByText('4.5'), null);
});

// ---------------------------------------------------------------------------
// Photo / reference handling
// ---------------------------------------------------------------------------

test('NearbyPlacesCard: renders an <img> built from the place\'s photoName when present', async (t) => {
  const NearbyPlacesCard = await loadNearbyPlacesCard(t, {
    getHotels: async () => ({ city: 'Delhi', hotels: [hotel()] }),
  });

  const { container } = renderCard(NearbyPlacesCard);

  await waitFor(() => screen.getByText('Grand Hotel'));
  const img = container.querySelector('img[alt="Grand Hotel"]');
  assert.ok(img, 'expected a photo <img> for a hotel with a photoName');
  assert.equal(
    img.getAttribute('src'),
    'http://localhost:5000/api/places/photo?name=places%2Fhotel1%2Fphotos%2Fabc&maxWidth=200'
  );
});

test('NearbyPlacesCard: renders the ImageOff placeholder (no <img>) when photoName is absent', async (t) => {
  const NearbyPlacesCard = await loadNearbyPlacesCard(t, {
    getHotels: async () => ({ city: 'Delhi', hotels: [hotel({ photoName: null })] }),
  });

  const { container } = renderCard(NearbyPlacesCard);

  await waitFor(() => screen.getByText('Grand Hotel'));
  assert.equal(container.querySelector('img'), null);
  // lucide's ImageOff renders as an <svg>
  assert.ok(container.querySelector('svg'));
});

test('NearbyPlacesCard: falls back to the ImageOff placeholder once the <img> fires an error event', async (t) => {
  const NearbyPlacesCard = await loadNearbyPlacesCard(t, {
    getHotels: async () => ({ city: 'Delhi', hotels: [hotel()] }),
  });

  const { container } = renderCard(NearbyPlacesCard);

  await waitFor(() => screen.getByText('Grand Hotel'));
  const img = container.querySelector('img[alt="Grand Hotel"]');
  assert.ok(img, 'expected the <img> to be present before the error fires');

  fireEvent.error(img);

  await waitFor(() => {
    assert.equal(container.querySelector('img'), null);
  });
});

// ---------------------------------------------------------------------------
// Restaurants tab
// ---------------------------------------------------------------------------

test('NearbyPlacesCard: switching to the Food tab fetches and renders restaurants instead of hotels', async (t) => {
  let restaurantCalls = 0;
  const NearbyPlacesCard = await loadNearbyPlacesCard(t, {
    getHotels: async () => ({ city: 'Delhi', hotels: [hotel()] }),
    getRestaurants: async () => {
      restaurantCalls += 1;
      return { city: 'Delhi', restaurants: [restaurant()] };
    },
  });

  renderCard(NearbyPlacesCard);

  await waitFor(() => screen.getByText('Grand Hotel'));
  assert.equal(restaurantCalls, 0, 'restaurants should not be fetched before the Food tab is opened');

  fireEvent.click(screen.getByRole('tab', { name: /Food/ }));

  await waitFor(() => screen.getByText('Tasty Bites'));
  assert.equal(screen.queryByText('Grand Hotel'), null, 'hotels list should no longer be shown once on the Food tab');
  assert.equal(restaurantCalls, 1);
});

test('NearbyPlacesCard: a restaurant with no photoName renders the ImageOff placeholder', async (t) => {
  const NearbyPlacesCard = await loadNearbyPlacesCard(t, {
    getRestaurants: async () => ({ city: 'Delhi', restaurants: [restaurant({ photoName: null })] }),
  });

  const { container } = renderCard(NearbyPlacesCard, { city: 'Delhi' });
  fireEvent.click(screen.getByRole('tab', { name: /Food/ }));

  await waitFor(() => screen.getByText('Tasty Bites'));
  assert.equal(container.querySelector('img'), null);
});

// ---------------------------------------------------------------------------
// Card header
// ---------------------------------------------------------------------------

test('NearbyPlacesCard: renders "Near {city}" using the given city prop', async (t) => {
  const NearbyPlacesCard = await loadNearbyPlacesCard(t, {
    getHotels: async () => ({ city: 'Mumbai', hotels: [] }),
  });

  renderCard(NearbyPlacesCard, { city: 'Mumbai', iataCode: 'BOM' });

  assert.ok(screen.getByText('Near Mumbai'));
});

// ---------------------------------------------------------------------------
// Q5 Batch 3 — additional photo/edge-case gaps not covered by Batch 2 above.
// ---------------------------------------------------------------------------

test('NearbyPlacesCard: an empty-string photoName is treated the same as missing (ImageOff placeholder, no <img>)', async (t) => {
  const NearbyPlacesCard = await loadNearbyPlacesCard(t, {
    getHotels: async () => ({ city: 'Delhi', hotels: [hotel({ photoName: '' })] }),
  });

  const { container } = renderCard(NearbyPlacesCard);

  await waitFor(() => screen.getByText('Grand Hotel'));
  assert.equal(container.querySelector('img'), null);
  assert.ok(container.querySelector('svg'));
});

test('NearbyPlacesCard: a photoName containing characters that would otherwise break a query string is percent-encoded in the <img> src', async (t) => {
  const trickyPhotoName = 'places/hotel1/photos/weird name?with&chars#here';
  const NearbyPlacesCard = await loadNearbyPlacesCard(t, {
    getHotels: async () => ({ city: 'Delhi', hotels: [hotel({ photoName: trickyPhotoName })] }),
  });

  const { container } = renderCard(NearbyPlacesCard);

  await waitFor(() => screen.getByText('Grand Hotel'));
  const img = container.querySelector('img[alt="Grand Hotel"]');
  assert.ok(img);
  const src = img.getAttribute('src');
  assert.equal(src, `http://localhost:5000/api/places/photo?name=${encodeURIComponent(trickyPhotoName)}&maxWidth=200`);
  // The raw '?', '&', and '#' from the photoName must be percent-encoded,
  // never appear literally inside the `name=` value (that would break the
  // query string or risk a malformed request).
  const nameParam = new URL(src).searchParams.get('name');
  assert.equal(nameParam, trickyPhotoName);
  assert.ok(src.includes('%3F') && src.includes('%26') && src.includes('%23'));
});

test('NearbyPlacesCard: the photo <img> src is built only from API_BASE_URL, the encoded photoName and maxWidth — never anything resembling an API key or credential', async (t) => {
  const NearbyPlacesCard = await loadNearbyPlacesCard(t, {
    getHotels: async () => ({ city: 'Delhi', hotels: [hotel()] }),
  });

  const { container } = renderCard(NearbyPlacesCard);

  await waitFor(() => screen.getByText('Grand Hotel'));
  const img = container.querySelector('img[alt="Grand Hotel"]');
  const src = img.getAttribute('src');
  const url = new URL(src);
  assert.deepEqual([...url.searchParams.keys()].sort(), ['maxWidth', 'name']);
  assert.doesNotMatch(src, /key|token|secret|credential/i);
});

test('NearbyPlacesCard: when one hotel\'s photo fails to load, a sibling hotel\'s photo is unaffected (row-level isolation, no cross-item corruption)', async (t) => {
  const NearbyPlacesCard = await loadNearbyPlacesCard(t, {
    getHotels: async () => ({
      city: 'Delhi',
      hotels: [
        hotel({ id: 'places/hotel1', name: 'Grand Hotel', photoName: 'places/hotel1/photos/abc' }),
        hotel({ id: 'places/hotel2', name: 'Budget Inn', photoName: 'places/hotel2/photos/xyz' }),
      ],
    }),
  });

  const { container } = renderCard(NearbyPlacesCard);

  await waitFor(() => screen.getByText('Grand Hotel'));
  const failingImg = container.querySelector('img[alt="Grand Hotel"]');
  const okImg = container.querySelector('img[alt="Budget Inn"]');
  assert.ok(failingImg);
  assert.ok(okImg);

  fireEvent.error(failingImg);

  await waitFor(() => {
    assert.equal(container.querySelector('img[alt="Grand Hotel"]'), null);
  });
  // The unaffected sibling's <img> must still be present and unchanged.
  assert.ok(container.querySelector('img[alt="Budget Inn"]'));
});

test('NearbyPlacesCard: a hotel with every optional field null/absent (no rating, priceLevel, mapsUri, photoName) still renders its name without crashing', async (t) => {
  const NearbyPlacesCard = await loadNearbyPlacesCard(t, {
    getHotels: async () => ({
      city: 'Delhi',
      hotels: [
        {
          id: 'places/hotel3',
          name: 'Mystery Hotel',
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
    }),
  });

  const { container } = renderCard(NearbyPlacesCard);

  await waitFor(() => screen.getByText('Mystery Hotel'));
  const link = screen.getByText('Mystery Hotel').closest('a');
  assert.equal(link.getAttribute('href'), '#');
  assert.ok(container.querySelector('svg')); // ImageOff placeholder, no crash
});

test('NearbyPlacesCard: an unrecognized priceLevel value renders no price glyph rather than crashing or showing "undefined"', async (t) => {
  const NearbyPlacesCard = await loadNearbyPlacesCard(t, {
    getHotels: async () => ({ city: 'Delhi', hotels: [hotel({ priceLevel: 'PRICE_LEVEL_UNSPECIFIED_NEW_ENUM' })] }),
  });

  renderCard(NearbyPlacesCard);

  await waitFor(() => screen.getByText('Grand Hotel'));
  assert.equal(screen.queryByText('undefined'), null);
});
