jest.mock('../../src/cache/redisClient');

const redisClient = require('../../src/cache/redisClient');
const redisCache = require('../../src/cache/redisCache');

function mockClient(overrides = {}) {
  return {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    ...overrides,
  };
}

describe('redisCache.get', () => {
  afterEach(() => jest.resetAllMocks());

  test('returns undefined (not null/false) when Redis is unavailable, signalling "try the next layer"', async () => {
    redisClient.isAvailable.mockReturnValue(false);
    const result = await redisCache.get('some:key');
    expect(result).toBeUndefined();
  });

  test('returns null when Redis is up but the key genuinely does not exist', async () => {
    redisClient.isAvailable.mockReturnValue(true);
    redisClient.getClient.mockReturnValue(mockClient({ get: jest.fn().mockResolvedValue(null) }));
    const result = await redisCache.get('missing:key');
    expect(result).toBeNull();
  });

  test('returns the parsed value on a real hit', async () => {
    redisClient.isAvailable.mockReturnValue(true);
    const value = { offers: [{ price: 4200 }] };
    redisClient.getClient.mockReturnValue(mockClient({ get: jest.fn().mockResolvedValue(JSON.stringify(value)) }));
    const result = await redisCache.get('hit:key');
    expect(result).toEqual(value);
  });

  test('returns undefined (not a thrown error) if the Redis call itself fails', async () => {
    redisClient.isAvailable.mockReturnValue(true);
    redisClient.getClient.mockReturnValue(
      mockClient({ get: jest.fn().mockRejectedValue(new Error('connection reset')) })
    );
    const result = await redisCache.get('flaky:key');
    expect(result).toBeUndefined();
  });
});

describe('redisCache.set', () => {
  afterEach(() => jest.resetAllMocks());

  test('is a no-op returning false when Redis is unavailable', async () => {
    redisClient.isAvailable.mockReturnValue(false);
    const ok = await redisCache.set('k', { a: 1 }, 1000);
    expect(ok).toBe(false);
  });

  test('serializes the value and passes a millisecond TTL through PX', async () => {
    redisClient.isAvailable.mockReturnValue(true);
    const set = jest.fn().mockResolvedValue('OK');
    redisClient.getClient.mockReturnValue(mockClient({ set }));

    const ok = await redisCache.set('k', { a: 1 }, 5000);

    expect(ok).toBe(true);
    expect(set).toHaveBeenCalledWith('k', JSON.stringify({ a: 1 }), { PX: 5000 });
  });

  test('sets without a TTL option when none is given', async () => {
    redisClient.isAvailable.mockReturnValue(true);
    const set = jest.fn().mockResolvedValue('OK');
    redisClient.getClient.mockReturnValue(mockClient({ set }));

    await redisCache.set('k', { a: 1 });

    expect(set).toHaveBeenCalledWith('k', JSON.stringify({ a: 1 }));
  });

  test('returns false (never throws) if the Redis call fails', async () => {
    redisClient.isAvailable.mockReturnValue(true);
    redisClient.getClient.mockReturnValue(
      mockClient({ set: jest.fn().mockRejectedValue(new Error('write failed')) })
    );
    const ok = await redisCache.set('k', { a: 1 }, 1000);
    expect(ok).toBe(false);
  });
});

describe('redisCache.del', () => {
  afterEach(() => jest.resetAllMocks());

  test('is a no-op returning false when Redis is unavailable', async () => {
    redisClient.isAvailable.mockReturnValue(false);
    const ok = await redisCache.del('k');
    expect(ok).toBe(false);
  });

  test('deletes the key and returns true on success', async () => {
    redisClient.isAvailable.mockReturnValue(true);
    const del = jest.fn().mockResolvedValue(1);
    redisClient.getClient.mockReturnValue(mockClient({ del }));

    const ok = await redisCache.del('k');

    expect(ok).toBe(true);
    expect(del).toHaveBeenCalledWith('k');
  });
});
