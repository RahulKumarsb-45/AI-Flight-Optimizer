jest.mock('../../src/providers/flight/providerFactory');
jest.mock('../../src/cache/flightCache');

const providerFactory = require('../../src/providers/flight/providerFactory');
const flightCache = require('../../src/cache/flightCache');
const { fetchFlightsForCandidates, MAX_FLIGHT_FETCHES } = require('../../src/optimizer/stages/flightFetchStage');

function offer(priceInr, overrides = {}) {
  return { priceInr, totalDurationMinutes: 300, stops: 0, ...overrides };
}

function candidate(id, legs) {
  return { id, legs };
}

function leg(fromIata, toIata, date) {
  return { fromIata, toIata, date };
}

// flightCache.buildCacheKey is used by the stage as a plain (non-hashing-
// dependent) key for in-flight de-duplication — a simple deterministic
// stand-in is enough here and keeps assertions about "same leg" readable.
function fakeBuildCacheKey(params) {
  return [params.originIata, params.destinationIata, params.departureDate, params.adults, params.cabinClass, params.provider].join(
    '|'
  );
}

beforeEach(() => {
  jest.resetAllMocks();
  flightCache.buildCacheKey.mockImplementation(fakeBuildCacheKey);
});

describe('fetchFlightsForCandidates — B1 concurrency behavior', () => {
  test('fetches offers for independent candidates concurrently, not one-at-a-time', async () => {
    // Two candidates, two distinct legs. If fetches were still sequential,
    // the second provider call could only start after the first resolves;
    // here we make the FIRST call the slower one and assert the second
    // call is already in-flight before the first finishes — proof the two
    // awaits are running concurrently rather than being serialized.
    let secondCallStartedBeforeFirstResolved = false;
    let resolveFirst;
    const firstPending = new Promise((resolve) => {
      resolveFirst = resolve;
    });

    providerFactory.searchWithFallback.mockImplementation(async (params) => {
      if (params.originIata === 'DEL') {
        await firstPending;
        return [offer(5000)];
      }
      // second call: mark that it started while the first is still pending
      secondCallStartedBeforeFirstResolved = true;
      return [offer(3000)];
    });
    flightCache.getCached.mockResolvedValue(null);
    flightCache.setCached.mockResolvedValue(undefined);

    const candidates = [candidate('a', [leg('DEL', 'LHR', '2026-08-15')]), candidate('b', [leg('BOM', 'DXB', '2026-08-15')])];

    const resultPromise = fetchFlightsForCandidates(candidates);
    // let microtasks for both candidates' first-leg calls run
    await Promise.resolve();
    await Promise.resolve();
    expect(secondCallStartedBeforeFirstResolved).toBe(true);

    resolveFirst();
    const results = await resultPromise;
    expect(results).toHaveLength(2);
  });

  test('preserves candidate order in the output regardless of which fetch resolves first', async () => {
    providerFactory.searchWithFallback.mockImplementation(async (params) => {
      // candidate "slow" resolves after candidate "fast" despite being first in input order
      const delayMs = params.originIata === 'SLOW' ? 20 : 0;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return [offer(1000)];
    });
    flightCache.getCached.mockResolvedValue(null);
    flightCache.setCached.mockResolvedValue(undefined);

    const candidates = [
      candidate('slow', [leg('SLOW', 'X', '2026-08-15')]),
      candidate('fast', [leg('FAST', 'Y', '2026-08-15')]),
      candidate('mid', [leg('MID', 'Z', '2026-08-15')]),
    ];

    const results = await fetchFlightsForCandidates(candidates);
    expect(results.map((c) => c.id)).toEqual(['slow', 'fast', 'mid']);
  });

  test('de-duplicates concurrent identical leg fetches (single-flight): only one provider call per unique leg', async () => {
    providerFactory.searchWithFallback.mockResolvedValue([offer(4200)]);
    flightCache.getCached.mockResolvedValue(null);
    flightCache.setCached.mockResolvedValue(undefined);

    // Three candidates that all need the exact same leg (e.g. different
    // dates permutations collapsed to the same route/date by coincidence,
    // or a shared onward leg in multi-city itineraries).
    const sameLeg = leg('DEL', 'LHR', '2026-08-15');
    const candidates = [candidate('a', [sameLeg]), candidate('b', [sameLeg]), candidate('c', [sameLeg])];

    const results = await fetchFlightsForCandidates(candidates);

    expect(results).toHaveLength(3);
    expect(providerFactory.searchWithFallback).toHaveBeenCalledTimes(1);
    expect(flightCache.setCached).toHaveBeenCalledTimes(1);
  });

  test('still checks the cache first per unique leg and skips the provider entirely on a cache hit', async () => {
    flightCache.getCached.mockResolvedValue([offer(2200)]);
    providerFactory.searchWithFallback.mockResolvedValue([offer(9999)]);

    const candidates = [candidate('a', [leg('DEL', 'BOM', '2026-08-15')])];
    const results = await fetchFlightsForCandidates(candidates);

    expect(results[0].totalPriceInr).toBe(2200);
    expect(providerFactory.searchWithFallback).not.toHaveBeenCalled();
    expect(flightCache.setCached).not.toHaveBeenCalled();
  });

  test('drops a candidate (without throwing or affecting others) when one of its legs has no offers', async () => {
    flightCache.getCached.mockResolvedValue(null);
    flightCache.setCached.mockResolvedValue(undefined);
    providerFactory.searchWithFallback.mockImplementation(async (params) => {
      if (params.originIata === 'NOOFFERS') return [];
      return [offer(1500)];
    });

    const candidates = [
      candidate('missing', [leg('NOOFFERS', 'X', '2026-08-15')]),
      candidate('ok', [leg('DEL', 'BOM', '2026-08-15')]),
    ];

    const results = await fetchFlightsForCandidates(candidates);
    expect(results.map((c) => c.id)).toEqual(['ok']);
  });

  test('drops a candidate on a provider error without rejecting the whole batch or throwing an unhandled rejection', async () => {
    flightCache.getCached.mockResolvedValue(null);
    flightCache.setCached.mockResolvedValue(undefined);
    providerFactory.searchWithFallback.mockImplementation(async (params) => {
      if (params.originIata === 'FAIL') throw new Error('provider down');
      return [offer(1500)];
    });

    const candidates = [
      candidate('broken', [leg('FAIL', 'X', '2026-08-15')]),
      candidate('ok', [leg('DEL', 'BOM', '2026-08-15')]),
    ];

    await expect(fetchFlightsForCandidates(candidates)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'ok' })])
    );
    const results = await fetchFlightsForCandidates(candidates);
    expect(results.map((c) => c.id)).toEqual(['ok']);
  });

  test('a shared failing leg drops every candidate that depends on it, each independently (single-flight failure fan-out)', async () => {
    flightCache.getCached.mockResolvedValue(null);
    flightCache.setCached.mockResolvedValue(undefined);
    providerFactory.searchWithFallback.mockRejectedValue(new Error('provider down'));

    const sameLeg = leg('FAIL', 'X', '2026-08-15');
    const candidates = [candidate('a', [sameLeg]), candidate('b', [sameLeg])];

    const results = await fetchFlightsForCandidates(candidates);
    expect(results).toEqual([]);
    // still only one underlying provider call for the shared leg
    expect(providerFactory.searchWithFallback).toHaveBeenCalledTimes(1);
  });

  test('still applies the MAX_FLIGHT_FETCHES cap before fetching', async () => {
    flightCache.getCached.mockResolvedValue(null);
    flightCache.setCached.mockResolvedValue(undefined);
    providerFactory.searchWithFallback.mockResolvedValue([offer(1000)]);

    const candidates = Array.from({ length: MAX_FLIGHT_FETCHES + 10 }, (_, i) =>
      candidate(`c${i}`, [leg('DEL', 'BOM', '2026-08-15')])
    );

    const results = await fetchFlightsForCandidates(candidates);
    expect(results).toHaveLength(MAX_FLIGHT_FETCHES);
    expect(results.map((c) => c.id)).toEqual(candidates.slice(0, MAX_FLIGHT_FETCHES).map((c) => c.id));
  });

  test('a round-trip candidate (there-and-back leg pair) is fetched as ONE combined call with returnDate set, and totals come straight from that single real offer', async () => {
    flightCache.getCached.mockResolvedValue(null);
    flightCache.setCached.mockResolvedValue(undefined);
    providerFactory.searchWithFallback.mockImplementation(async (params) => {
      expect(params.originIata).toBe('DEL');
      expect(params.destinationIata).toBe('LHR');
      expect(params.departureDate).toBe('2026-08-15');
      expect(params.returnDate).toBe('2026-08-22'); // proves ONE combined round-trip call, not two separate one-way calls
      return [
        offer(9500, {
          totalDurationMinutes: 780,
          stops: 1,
          outbound: [{ durationMinutes: 400 }],
          inbound: [{ durationMinutes: 380 }, { durationMinutes: 0 }],
        }),
      ];
    });

    const candidates = [candidate('rt', [leg('DEL', 'LHR', '2026-08-15'), leg('LHR', 'DEL', '2026-08-22')])];
    const results = await fetchFlightsForCandidates(candidates);

    // exactly one provider call for the whole round trip, never one per direction
    expect(providerFactory.searchWithFallback).toHaveBeenCalledTimes(1);
    expect(results[0].totalPriceInr).toBe(9500);
    expect(results[0].totalDurationMinutes).toBe(780);
    expect(results[0].totalStops).toBe(1);
  });

  test('round-trip legOffers keep the existing per-leg display shape (one offer array per leg) without fabricating a per-direction price split', async () => {
    flightCache.getCached.mockResolvedValue(null);
    flightCache.setCached.mockResolvedValue(undefined);
    providerFactory.searchWithFallback.mockResolvedValue([
      offer(9500, {
        totalDurationMinutes: 780,
        stops: 1,
        outbound: [{ durationMinutes: 400 }],
        inbound: [{ durationMinutes: 380 }],
      }),
    ]);

    const candidates = [candidate('rt', [leg('DEL', 'LHR', '2026-08-15'), leg('LHR', 'DEL', '2026-08-22')])];
    const results = await fetchFlightsForCandidates(candidates);

    expect(results[0].legOffers).toHaveLength(2); // matches candidate.legs.length, same as before
    const [outboundView] = results[0].legOffers[0];
    const [inboundView] = results[0].legOffers[1];

    // the entire real combined total is on the outbound view; never split/guessed
    expect(outboundView.priceInr).toBe(9500);
    // no separate inbound fare exists — must be null, never a fabricated number
    expect(inboundView.priceInr).toBeNull();
    expect(outboundView.totalDurationMinutes).toBe(400);
    expect(inboundView.totalDurationMinutes).toBe(380);
  });

  test('a one-way candidate (single leg) is completely unaffected by the round-trip combined-call path', async () => {
    flightCache.getCached.mockResolvedValue(null);
    flightCache.setCached.mockResolvedValue(undefined);
    providerFactory.searchWithFallback.mockImplementation(async (params) => {
      expect(params.returnDate).toBeUndefined();
      return [offer(4200)];
    });

    const candidates = [candidate('ow', [leg('DEL', 'BOM', '2026-08-15')])];
    const results = await fetchFlightsForCandidates(candidates);

    expect(results[0].totalPriceInr).toBe(4200);
    expect(results[0].legOffers).toHaveLength(1);
  });

  test('a multi-city circuit (3+ legs) still fetches each leg independently, never collapsed into a round-trip combined call', async () => {
    flightCache.getCached.mockResolvedValue(null);
    flightCache.setCached.mockResolvedValue(undefined);
    providerFactory.searchWithFallback.mockImplementation(async (params) => {
      expect(params.returnDate).toBeUndefined();
      return [offer(1000)];
    });

    const candidates = [
      candidate('circuit', [
        leg('DEL', 'CDG', '2026-08-15'),
        leg('CDG', 'FCO', '2026-08-18'),
        leg('FCO', 'DEL', '2026-08-22'),
      ]),
    ];
    const results = await fetchFlightsForCandidates(candidates);

    expect(providerFactory.searchWithFallback).toHaveBeenCalledTimes(3);
    expect(results[0].totalPriceInr).toBe(3000);
    expect(results[0].legOffers).toHaveLength(3);
  });
});
