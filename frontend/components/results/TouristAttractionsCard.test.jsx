// Q5 Google Places — Batch 2: component-level tests for
// TouristAttractionsCard.jsx.
//
// Same harness as WeatherCard.test.jsx / NearbyPlacesCard.test.jsx — run
// with:
//
//   node --experimental-test-module-mocks \
//        --import ./tests/support/domSetup.mjs \
//        --import ./tests/support/registerJsx.mjs \
//        --test --test-force-exit \
//        components/results/TouristAttractionsCard.test.jsx
//
// Only '@/services/placesService' is mocked.
//
// CONFIRMED BY READING CURRENT CODE (do not re-derive elsewhere):
//   - `useQuery({ queryKey: ['places', 'attractions', iataCode], queryFn:
//     () => placesService.getAttractions(iataCode), enabled:
//     Boolean(iataCode) })`.
//   - Loading: 3 pulsing skeleton rows (`.animate-pulse`).
//   - Error: renders `error?.message` if present, else the fixed fallback
//     "Couldn't load tourist attractions right now." — DISTINCT from the
//     empty-state message (unlike NearbyPlacesCard, which reuses the same
//     text for both).
//   - Empty (no error, zero results): "No tourist attractions found for
//     {city} yet."
//   - Success: one row per attraction with name, description (only if
//     present), category + address (only if present), star+rating (only if
//     `place.rating` is truthy), and an <a href={place.mapsUri || '#'}
//     target="_blank">.
//   - Photo: <img> built from `place.photoName` at
//     `${API_BASE_URL}/places/photo?name=<encoded>&maxWidth=300` (note: 300,
//     not 200 — a different maxWidth than NearbyPlacesCard). Absent
//     photoName, or an `error` event on the <img>, falls back to an ImageOff
//     icon placeholder.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

afterEach(() => {
  cleanup();
});

let loadCounter = 0;

async function loadTouristAttractionsCard(t, { getAttractions } = {}) {
  t.mock.module('@/services/placesService', {
    namedExports: {
      placesService: {
        getAttractions: getAttractions || (async () => ({ city: 'Test City', attractions: [] })),
      },
    },
  });
  loadCounter += 1;
  const mod = await import(`@/components/results/TouristAttractionsCard.jsx?case=${loadCounter}`);
  return mod.TouristAttractionsCard;
}

function renderCard(TouristAttractionsCard, props = {}, client) {
  const queryClient = client || new QueryClient();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <TouristAttractionsCard iataCode="DEL" city="Delhi" {...props} />
    </QueryClientProvider>
  );
  return { ...utils, queryClient };
}

function attraction(overrides = {}) {
  return {
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
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

test('TouristAttractionsCard: shows the loading skeleton while the attractions query is in flight', async (t) => {
  const TouristAttractionsCard = await loadTouristAttractionsCard(t, {
    getAttractions: () => new Promise(() => {}),
  });

  const { container } = renderCard(TouristAttractionsCard);

  const skeletons = container.querySelectorAll('.animate-pulse');
  assert.equal(skeletons.length, 3);
  assert.equal(screen.queryByText('Historic Fort'), null);
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

test('TouristAttractionsCard: shows "No tourist attractions found for {city} yet." when the list is empty', async (t) => {
  const TouristAttractionsCard = await loadTouristAttractionsCard(t, {
    getAttractions: async () => ({ city: 'Delhi', attractions: [] }),
  });

  renderCard(TouristAttractionsCard, { city: 'Delhi' });

  await waitFor(() => screen.getByText('No tourist attractions found for Delhi yet.'));
});

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

test('TouristAttractionsCard: shows the thrown error message when the query rejects with one', async (t) => {
  const TouristAttractionsCard = await loadTouristAttractionsCard(t, {
    getAttractions: async () => {
      throw new Error('Could not fetch nearby places right now.');
    },
  });

  renderCard(TouristAttractionsCard);

  await waitFor(() => screen.getByText('Could not fetch nearby places right now.'));
  assert.equal(screen.queryByText(/No tourist attractions found/), null);
});

test('TouristAttractionsCard: falls back to the generic unavailable message when the thrown error has no message', async (t) => {
  const TouristAttractionsCard = await loadTouristAttractionsCard(t, {
    getAttractions: async () => {
      throw new Error();
    },
  });

  renderCard(TouristAttractionsCard);

  await waitFor(() => screen.getByText("Couldn't load tourist attractions right now."));
});

// ---------------------------------------------------------------------------
// Success — attraction rows
// ---------------------------------------------------------------------------

test('TouristAttractionsCard: renders one row per attraction with name, description, category, address and rating', async (t) => {
  const TouristAttractionsCard = await loadTouristAttractionsCard(t, {
    getAttractions: async () => ({ city: 'Delhi', attractions: [attraction()] }),
  });

  renderCard(TouristAttractionsCard);

  await waitFor(() => screen.getByText('Historic Fort'));
  assert.ok(screen.getByText('A historic Mughal-era fort.'));
  assert.ok(screen.getByText('Historical landmark'));
  assert.ok(screen.getByText('789 Heritage Rd'));
  assert.ok(screen.getByText('4.8'));
});

test('TouristAttractionsCard: omits the description paragraph when the attraction has none', async (t) => {
  const TouristAttractionsCard = await loadTouristAttractionsCard(t, {
    getAttractions: async () => ({ city: 'Delhi', attractions: [attraction({ description: null })] }),
  });

  renderCard(TouristAttractionsCard);

  await waitFor(() => screen.getByText('Historic Fort'));
  assert.equal(screen.queryByText('A historic Mughal-era fort.'), null);
});

test('TouristAttractionsCard: links each row to the correct mapsUri and opens in a new tab', async (t) => {
  const TouristAttractionsCard = await loadTouristAttractionsCard(t, {
    getAttractions: async () => ({ city: 'Delhi', attractions: [attraction()] }),
  });

  renderCard(TouristAttractionsCard);

  await waitFor(() => screen.getByText('Historic Fort'));
  const link = screen.getByText('Historic Fort').closest('a');
  assert.equal(link.getAttribute('href'), 'https://maps.google.com/?cid=3');
  assert.equal(link.getAttribute('target'), '_blank');
});

test('TouristAttractionsCard: multiple attractions each render their own row, in the given order', async (t) => {
  const TouristAttractionsCard = await loadTouristAttractionsCard(t, {
    getAttractions: async () => ({
      city: 'Delhi',
      attractions: [
        attraction({ id: 'places/attr1', name: 'Historic Fort' }),
        attraction({ id: 'places/attr2', name: 'City Museum', mapsUri: 'https://maps.google.com/?cid=4' }),
      ],
    }),
  });

  renderCard(TouristAttractionsCard);

  await waitFor(() => screen.getByText('Historic Fort'));
  assert.ok(screen.getByText('City Museum'));
});

// ---------------------------------------------------------------------------
// Photo / reference handling
// ---------------------------------------------------------------------------

test('TouristAttractionsCard: renders an <img> at maxWidth=300 built from photoName when present', async (t) => {
  const TouristAttractionsCard = await loadTouristAttractionsCard(t, {
    getAttractions: async () => ({ city: 'Delhi', attractions: [attraction()] }),
  });

  const { container } = renderCard(TouristAttractionsCard);

  await waitFor(() => screen.getByText('Historic Fort'));
  const img = container.querySelector('img[alt="Historic Fort"]');
  assert.ok(img, 'expected a photo <img> for an attraction with a photoName');
  assert.equal(
    img.getAttribute('src'),
    'http://localhost:5000/api/places/photo?name=places%2Fattr1%2Fphotos%2Fxyz&maxWidth=300'
  );
});

test('TouristAttractionsCard: renders the ImageOff placeholder when photoName is absent', async (t) => {
  const TouristAttractionsCard = await loadTouristAttractionsCard(t, {
    getAttractions: async () => ({ city: 'Delhi', attractions: [attraction({ photoName: null })] }),
  });

  const { container } = renderCard(TouristAttractionsCard);

  await waitFor(() => screen.getByText('Historic Fort'));
  assert.equal(container.querySelector('img'), null);
  assert.ok(container.querySelector('svg'));
});

test('TouristAttractionsCard: falls back to the ImageOff placeholder once the <img> fires an error event', async (t) => {
  const TouristAttractionsCard = await loadTouristAttractionsCard(t, {
    getAttractions: async () => ({ city: 'Delhi', attractions: [attraction()] }),
  });

  const { container } = renderCard(TouristAttractionsCard);

  await waitFor(() => screen.getByText('Historic Fort'));
  const img = container.querySelector('img[alt="Historic Fort"]');
  assert.ok(img);

  fireEvent.error(img);

  await waitFor(() => {
    assert.equal(container.querySelector('img'), null);
  });
});

// ---------------------------------------------------------------------------
// Card header
// ---------------------------------------------------------------------------

test('TouristAttractionsCard: renders "Things to do in {city}" using the given city prop', async (t) => {
  const TouristAttractionsCard = await loadTouristAttractionsCard(t, {
    getAttractions: async () => ({ city: 'Mumbai', attractions: [] }),
  });

  renderCard(TouristAttractionsCard, { city: 'Mumbai', iataCode: 'BOM' });

  assert.ok(screen.getByText('Things to do in Mumbai'));
});

test('TouristAttractionsCard: the attractions query is disabled (no fetch) when iataCode is falsy', async (t) => {
  let calls = 0;
  const TouristAttractionsCard = await loadTouristAttractionsCard(t, {
    getAttractions: async () => {
      calls += 1;
      return { city: 'Delhi', attractions: [attraction()] };
    },
  });

  renderCard(TouristAttractionsCard, { iataCode: undefined });

  // Give any (incorrect) fetch a chance to fire.
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(calls, 0);
});

// ---------------------------------------------------------------------------
// Q5 Batch 3 — additional photo/edge-case gaps not covered by Batch 2 above.
// ---------------------------------------------------------------------------

test('TouristAttractionsCard: an empty-string photoName is treated the same as missing (ImageOff placeholder, no <img>)', async (t) => {
  const TouristAttractionsCard = await loadTouristAttractionsCard(t, {
    getAttractions: async () => ({ city: 'Delhi', attractions: [attraction({ photoName: '' })] }),
  });

  const { container } = renderCard(TouristAttractionsCard);

  await waitFor(() => screen.getByText('Historic Fort'));
  assert.equal(container.querySelector('img'), null);
  assert.ok(container.querySelector('svg'));
});

test('TouristAttractionsCard: a photoName containing characters that would otherwise break a query string is percent-encoded in the <img> src', async (t) => {
  const trickyPhotoName = 'places/attr1/photos/weird name?with&chars#here';
  const TouristAttractionsCard = await loadTouristAttractionsCard(t, {
    getAttractions: async () => ({ city: 'Delhi', attractions: [attraction({ photoName: trickyPhotoName })] }),
  });

  const { container } = renderCard(TouristAttractionsCard);

  await waitFor(() => screen.getByText('Historic Fort'));
  const img = container.querySelector('img[alt="Historic Fort"]');
  assert.ok(img);
  const src = img.getAttribute('src');
  assert.equal(src, `http://localhost:5000/api/places/photo?name=${encodeURIComponent(trickyPhotoName)}&maxWidth=300`);
  const nameParam = new URL(src).searchParams.get('name');
  assert.equal(nameParam, trickyPhotoName);
});

test('TouristAttractionsCard: the photo <img> src is built only from API_BASE_URL, the encoded photoName and maxWidth — never anything resembling an API key or credential', async (t) => {
  const TouristAttractionsCard = await loadTouristAttractionsCard(t, {
    getAttractions: async () => ({ city: 'Delhi', attractions: [attraction()] }),
  });

  const { container } = renderCard(TouristAttractionsCard);

  await waitFor(() => screen.getByText('Historic Fort'));
  const img = container.querySelector('img[alt="Historic Fort"]');
  const src = img.getAttribute('src');
  const url = new URL(src);
  assert.deepEqual([...url.searchParams.keys()].sort(), ['maxWidth', 'name']);
  assert.doesNotMatch(src, /key|token|secret|credential/i);
});

test("TouristAttractionsCard: when one attraction's photo fails to load, a sibling attraction's photo is unaffected (row-level isolation, no cross-item corruption)", async (t) => {
  const TouristAttractionsCard = await loadTouristAttractionsCard(t, {
    getAttractions: async () => ({
      city: 'Delhi',
      attractions: [
        attraction({ id: 'places/attr1', name: 'Historic Fort', photoName: 'places/attr1/photos/xyz' }),
        attraction({ id: 'places/attr2', name: 'City Museum', photoName: 'places/attr2/photos/uvw' }),
      ],
    }),
  });

  const { container } = renderCard(TouristAttractionsCard);

  await waitFor(() => screen.getByText('Historic Fort'));
  const failingImg = container.querySelector('img[alt="Historic Fort"]');
  const okImg = container.querySelector('img[alt="City Museum"]');
  assert.ok(failingImg);
  assert.ok(okImg);

  fireEvent.error(failingImg);

  await waitFor(() => {
    assert.equal(container.querySelector('img[alt="Historic Fort"]'), null);
  });
  assert.ok(container.querySelector('img[alt="City Museum"]'));
});

test('TouristAttractionsCard: an attraction with every optional field null/absent (no description, category, address, rating, photoName) still renders its name without crashing', async (t) => {
  const TouristAttractionsCard = await loadTouristAttractionsCard(t, {
    getAttractions: async () => ({
      city: 'Delhi',
      attractions: [
        {
          id: 'places/attr3',
          name: 'Mystery Spot',
          address: null,
          rating: null,
          ratingCount: 0,
          priceLevel: null,
          openNow: null,
          mapsUri: null,
          location: null,
          photoName: null,
          description: null,
          category: null,
        },
      ],
    }),
  });

  const { container } = renderCard(TouristAttractionsCard);

  await waitFor(() => screen.getByText('Mystery Spot'));
  const link = screen.getByText('Mystery Spot').closest('a');
  assert.equal(link.getAttribute('href'), '#');
  assert.ok(container.querySelector('svg')); // ImageOff placeholder, no crash
});
