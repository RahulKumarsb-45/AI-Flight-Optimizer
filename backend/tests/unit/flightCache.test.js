jest.mock('../../src/cache/redisCache');
jest.mock('../../src/database/pool');

const redisCache = require('../../src/cache/redisCache');
const { query } = require('../../src/database/pool');
const flightCache = require('../../src/cache/flightCache');
const { flightMemoryCache } = require('../../src/cache/memoryCache');

// The in-memory L0 layer is a shared, module-level singleton (see
// memoryCache.js) — every test below uses the same SEARCH_PARAMS cache key,
// so without clearing it a hit populated by one test would silently short-
// circuit a later test's Redis/Postgres assertions. Clearing it here keeps
// each test's cache state independent, same as jest.resetAllMocks() does
// for the Redis/Postgres mocks.
afterEach(() => flightMemoryCache.clear());

const SEARCH_PARAMS = {
  originIata: 'DEL',
  destinationIata: 'BOM',
  departureDate: '2026-11-01',
  returnDate: null,
  adults: 1,
  cabinClass: 'economy',
  provider: 'mock',
};

const OFFERS = [{ price: 4200, provider: 'mock' }];

describe('flightCache.buildCacheKey', () => {
  test('is deterministic for identical params', () => {
    const a = flightCache.buildCacheKey(SEARCH_PARAMS);
    const b = flightCache.buildCacheKey({ ...SEARCH_PARAMS });
    expect(a).toBe(b);
  });

  test('differs when any param changes', () => {
    const a = flightCache.buildCacheKey(SEARCH_PARAMS);
    const b = flightCache.buildCacheKey({ ...SEARCH_PARAMS, adults: 2 });
    expect(a).not.toBe(b);
  });
});

describe('flightCache.getCached — Redis L1 / Postgres L2', () => {
  afterEach(() => jest.resetAllMocks());

  test('returns the Redis value directly without touching Postgres on a Redis hit', async () => {
    redisCache.get.mockResolvedValue(OFFERS);

    const result = await flightCache.getCached(SEARCH_PARAMS);

    expect(result).toEqual(OFFERS);
    expect(query).not.toHaveBeenCalled();
  });

  test('falls through to Postgres when Redis is unavailable (get resolves undefined)', async () => {
    redisCache.get.mockResolvedValue(undefined);
    redisCache.set.mockResolvedValue(false);
    query.mockResolvedValue({ rows: [{ response_json: OFFERS }] });

    const result = await flightCache.getCached(SEARCH_PARAMS);

    expect(result).toEqual(OFFERS);
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('backfills Redis after a Postgres hit', async () => {
    redisCache.get.mockResolvedValue(undefined);
    redisCache.set.mockResolvedValue(true);
    query.mockResolvedValue({ rows: [{ response_json: OFFERS }] });

    await flightCache.getCached(SEARCH_PARAMS);
    // backfill is fire-and-forget; flush microtasks
    await new Promise((resolve) => setImmediate(resolve));

    expect(redisCache.set).toHaveBeenCalledWith(expect.stringContaining('flightcache:'), OFFERS, expect.any(Number));
  });

  test('returns null when neither Redis nor Postgres has the entry', async () => {
    redisCache.get.mockResolvedValue(undefined);
    query.mockResolvedValue({ rows: [] });

    const result = await flightCache.getCached(SEARCH_PARAMS);

    expect(result).toBeNull();
  });

  test('a Postgres read failure is swallowed and returns null instead of throwing', async () => {
    redisCache.get.mockResolvedValue(undefined);
    query.mockRejectedValue(new Error('connection terminated'));

    const result = await flightCache.getCached(SEARCH_PARAMS);

    expect(result).toBeNull();
  });
});

describe('flightCache.setCached — write-through', () => {
  afterEach(() => jest.resetAllMocks());

  test('writes to both Redis and Postgres', async () => {
    redisCache.set.mockResolvedValue(true);
    query.mockResolvedValue({ rows: [] });

    await flightCache.setCached(SEARCH_PARAMS, OFFERS);

    expect(redisCache.set).toHaveBeenCalledWith(expect.stringContaining('flightcache:'), OFFERS, expect.any(Number));
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('a Redis write failure does not prevent the Postgres write', async () => {
    redisCache.set.mockResolvedValue(false);
    query.mockResolvedValue({ rows: [] });

    await expect(flightCache.setCached(SEARCH_PARAMS, OFFERS)).resolves.not.toThrow();
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('a Postgres write failure is swallowed rather than thrown', async () => {
    redisCache.set.mockResolvedValue(true);
    query.mockRejectedValue(new Error('unique_violation'));

    await expect(flightCache.setCached(SEARCH_PARAMS, OFFERS)).resolves.not.toThrow();
  });
});

describe('flightCache — in-memory L0 fallback', () => {
  afterEach(() => jest.resetAllMocks());

  test('a memory hit is returned without calling Redis or Postgres at all', async () => {
    // Populate memory the same way a prior getCached()/setCached() call would.
    flightMemoryCache.set(flightCache.buildCacheKey(SEARCH_PARAMS), OFFERS, 60000);

    const result = await flightCache.getCached(SEARCH_PARAMS);

    expect(result).toEqual(OFFERS);
    expect(redisCache.get).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  test('a Redis hit backfills memory so the next call for the same key skips Redis', async () => {
    redisCache.get.mockResolvedValue(OFFERS);

    await flightCache.getCached(SEARCH_PARAMS);
    redisCache.get.mockClear();
    const second = await flightCache.getCached(SEARCH_PARAMS);

    expect(second).toEqual(OFFERS);
    expect(redisCache.get).not.toHaveBeenCalled();
  });

  test('a Postgres hit (Redis unavailable) backfills memory so a repeat request needs no Postgres round trip', async () => {
    redisCache.get.mockResolvedValue(undefined);
    redisCache.set.mockResolvedValue(false);
    query.mockResolvedValue({ rows: [{ response_json: OFFERS }] });

    await flightCache.getCached(SEARCH_PARAMS);
    query.mockClear();
    const second = await flightCache.getCached(SEARCH_PARAMS);

    expect(second).toEqual(OFFERS);
    expect(query).not.toHaveBeenCalled();
  });

  test('the backend keeps serving cached results from memory even when both Redis and Postgres are unavailable', async () => {
    redisCache.get.mockResolvedValue(OFFERS);
    await flightCache.getCached(SEARCH_PARAMS);

    // Simulate both layers going down for any subsequent call.
    redisCache.get.mockResolvedValue(undefined);
    query.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await flightCache.getCached(SEARCH_PARAMS);
    expect(result).toEqual(OFFERS);
  });

  test('setCached populates memory too, independent of Redis/Postgres outcome', async () => {
    redisCache.set.mockResolvedValue(false);
    query.mockRejectedValue(new Error('unavailable'));

    await flightCache.setCached(SEARCH_PARAMS, OFFERS);

    const result = await flightCache.getCached(SEARCH_PARAMS);
    expect(result).toEqual(OFFERS);
  });

  test('does not return a memory value for a different cache key (no cross-contamination)', async () => {
    flightMemoryCache.set(flightCache.buildCacheKey(SEARCH_PARAMS), OFFERS, 60000);
    redisCache.get.mockResolvedValue(undefined);
    query.mockResolvedValue({ rows: [] });

    const result = await flightCache.getCached({ ...SEARCH_PARAMS, destinationIata: 'MAA' });

    expect(result).toBeNull();
  });
});
