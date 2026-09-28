// Component-level tests for WeatherCard.jsx. These need a DOM + JSX
// transform that plain `node --test` doesn't have out of the box (unlike
// the CommonJS util tests elsewhere in this repo), so they're run with:
//
//   node --experimental-test-module-mocks \
//        --import ./tests/support/domSetup.mjs \
//        --import ./tests/support/registerJsx.mjs \
//        --test --test-force-exit \
//        components/results/WeatherCard.test.jsx
//
// See tests/support/{domSetup,jsxLoader,registerJsx,nextImageStub}.mjs for
// what each --import is doing and why. --test-force-exit is Node's own
// built-in flag (no custom code) for the fact that jsdom/React Query leave
// timers/handles open that would otherwise keep the process alive after
// all tests have already passed.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

afterEach(() => {
  cleanup();
});

let loadCounter = 0;

/**
 * Mocks '@/services/weatherService' with the given getCurrent/getForecast/
 * getSeason implementations, then imports a fresh WeatherCard bound to that
 * mock (cache-busted so mocks from different tests never leak into each
 * other — `t.mock.module` auto-restores when the test ends).
 */
async function loadWeatherCard(t, { getCurrent, getForecast, getSeason }) {
  t.mock.module('@/services/weatherService', {
    namedExports: {
      weatherService: {
        getCurrent: getCurrent || (async () => ({})),
        getForecast: getForecast || (async () => ({ days: [] })),
        getSeason: getSeason || (async () => undefined),
      },
    },
  });
  loadCounter += 1;
  const mod = await import(`@/components/results/WeatherCard.jsx?case=${loadCounter}`);
  return mod.WeatherCard;
}

function renderCard(WeatherCard, props = {}, client) {
  const queryClient = client || new QueryClient();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <WeatherCard iataCode="DEL" city="Delhi" {...props} />
    </QueryClientProvider>
  );
  return { ...utils, queryClient };
}

const FULL_CURRENT = {
  tempC: 28,
  feelsLikeC: 30,
  humidity: 54,
  description: 'clear sky',
  icon: '01d',
};

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

test('WeatherCard: shows the loading skeleton while the current-weather query is in flight', async (t) => {
  const WeatherCard = await loadWeatherCard(t, {
    getCurrent: () => new Promise(() => {}), // never resolves
  });

  const { container } = renderCard(WeatherCard);

  assert.ok(container.querySelector('.animate-pulse'), 'expected the loading skeleton to be rendered');
  assert.equal(screen.queryByText(/Weather in/), null);
});

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

test('WeatherCard: shows the unavailable message when the current-weather query errors, and does not show current-weather content', async (t) => {
  const WeatherCard = await loadWeatherCard(t, {
    getCurrent: async () => {
      throw new Error('boom');
    },
  });

  renderCard(WeatherCard, { city: 'Mumbai' });

  await waitFor(() => screen.getByText('Weather unavailable for Mumbai right now.'));
  assert.equal(screen.queryByText(/°C/), null);
});

test('WeatherCard: the forecast query is disabled once current-weather has errored, but its very first fetch already fired before that error was known (current, documented behavior — not a defensive guarantee)', async (t) => {
  let forecastCalls = 0;
  const WeatherCard = await loadWeatherCard(t, {
    getCurrent: async () => {
      throw new Error('boom');
    },
    getForecast: async () => {
      forecastCalls += 1;
      return { days: [] };
    },
  });

  renderCard(WeatherCard);

  await waitFor(() => screen.getByText(/Weather unavailable/));
  // Give any further (re-)fetch a chance to have fired.
  await new Promise((resolve) => setTimeout(resolve, 50));
  // `enabled: !currentError` is `true` on the very first render (before the
  // current-weather query has settled either way), so React Query already
  // dispatches the forecast fetch before it learns current-weather errored.
  // Once currentError flips true, `enabled` correctly prevents any further
  // fetch — this asserts exactly one call total, never a second one.
  assert.equal(forecastCalls, 1);
});

// ---------------------------------------------------------------------------
// Success — current weather content
// ---------------------------------------------------------------------------

test('WeatherCard: renders temperature, description, humidity and feels-like once the query resolves', async (t) => {
  const WeatherCard = await loadWeatherCard(t, {
    getCurrent: async () => FULL_CURRENT,
  });

  renderCard(WeatherCard, { city: 'Delhi' });

  await waitFor(() => screen.getByText('28°C'));
  assert.ok(screen.getByText('Weather in Delhi'));
  assert.ok(screen.getByText('clear sky'));
  assert.ok(screen.getByText('54% humidity'));
  assert.ok(screen.getByText('Feels like 30°C'));
});

test('WeatherCard: renders the condition icon with the correct OpenWeatherMap URL when current.icon is present', async (t) => {
  const WeatherCard = await loadWeatherCard(t, {
    getCurrent: async () => FULL_CURRENT,
  });

  const { container } = renderCard(WeatherCard);

  await waitFor(() => screen.getByText('28°C'));
  const img = container.querySelector('img[alt="clear sky"]');
  assert.ok(img, 'expected a condition icon <img>');
  assert.equal(img.getAttribute('src'), 'https://openweathermap.org/img/wn/01d@2x.png');
});

test('WeatherCard: renders no condition icon when current.icon is absent', async (t) => {
  const WeatherCard = await loadWeatherCard(t, {
    getCurrent: async () => ({ ...FULL_CURRENT, icon: undefined }),
  });

  const { container } = renderCard(WeatherCard);

  await waitFor(() => screen.getByText('28°C'));
  assert.equal(container.querySelector('img'), null);
});

// ---------------------------------------------------------------------------
// Forecast rendering
// ---------------------------------------------------------------------------

test('WeatherCard: renders one cell per forecast day, each with its temperature and icon', async (t) => {
  const days = [
    { date: '2026-09-13', tempC: 19, description: 'overcast clouds', icon: '04d' },
    { date: '2026-09-14', tempC: 21, description: 'clear sky', icon: '01d' },
    { date: '2026-09-15', tempC: 23, description: 'light rain', icon: '10d' },
  ];
  const WeatherCard = await loadWeatherCard(t, {
    getCurrent: async () => FULL_CURRENT,
    getForecast: async () => ({ days }),
  });

  const { container } = renderCard(WeatherCard);

  await waitFor(() => screen.getByText('19°'));
  assert.ok(screen.getByText('21°'));
  assert.ok(screen.getByText('23°'));
  const forecastIcons = container.querySelectorAll('img[src*="openweathermap.org/img/wn/"]:not([src*="@2x"])');
  assert.equal(forecastIcons.length, 3);
});

test('WeatherCard: renders no forecast section when forecast.days is empty', async (t) => {
  const WeatherCard = await loadWeatherCard(t, {
    getCurrent: async () => FULL_CURRENT,
    getForecast: async () => ({ days: [] }),
  });

  const { container } = renderCard(WeatherCard);

  await waitFor(() => screen.getByText('28°C'));
  assert.equal(container.querySelector('.grid-cols-5'), null);
});

// ---------------------------------------------------------------------------
// Season guidance rendering
// ---------------------------------------------------------------------------

test('WeatherCard: renders season guidance text and the general-guidance caveat when isGeneralGuidance is true', async (t) => {
  const WeatherCard = await loadWeatherCard(t, {
    getCurrent: async () => FULL_CURRENT,
    getSeason: async () => ({
      guidance: 'This is generally summer season here — expect warmer weather.',
      isGeneralGuidance: true,
    }),
  });

  renderCard(WeatherCard);

  await waitFor(() => screen.getByText(/generally summer season/));
  assert.ok(screen.getByText(/General seasonal guidance, not this city.s exact climate data\./));
});

test('WeatherCard: renders season guidance without the caveat when isGeneralGuidance is false', async (t) => {
  const WeatherCard = await loadWeatherCard(t, {
    getCurrent: async () => FULL_CURRENT,
    getSeason: async () => ({
      guidance: 'Measured seasonal data for this city.',
      isGeneralGuidance: false,
    }),
  });

  renderCard(WeatherCard);

  await waitFor(() => screen.getByText('Measured seasonal data for this city.'));
  assert.equal(screen.queryByText(/General seasonal guidance/), null);
});

test('WeatherCard: renders no season block when the season query resolves to nothing', async (t) => {
  const WeatherCard = await loadWeatherCard(t, {
    getCurrent: async () => FULL_CURRENT,
    getSeason: async () => undefined,
  });

  const { container } = renderCard(WeatherCard);

  await waitFor(() => screen.getByText('28°C'));
  assert.equal(container.querySelector('.bg-amber-50'), null);
});

// ---------------------------------------------------------------------------
// React Query caching — WeatherCard sets staleTime on all three queries, so
// remounting with the same QueryClient inside the stale window should not
// re-hit weatherService.
// ---------------------------------------------------------------------------

test('WeatherCard: does not refetch current weather on remount within the staleTime window (same QueryClient)', async (t) => {
  let currentCalls = 0;
  const WeatherCard = await loadWeatherCard(t, {
    getCurrent: async () => {
      currentCalls += 1;
      return FULL_CURRENT;
    },
  });

  const queryClient = new QueryClient();
  const first = renderCard(WeatherCard, {}, queryClient);
  await waitFor(() => within(first.container).getByText('28°C'));
  first.unmount();

  const second = renderCard(WeatherCard, {}, queryClient);
  await waitFor(() => within(second.container).getByText('28°C'));

  assert.equal(currentCalls, 1, 'expected the cached (stale-tolerant) value to be reused, not refetched');
});
