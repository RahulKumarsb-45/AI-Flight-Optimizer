jest.mock('../../src/config/env', () => ({ redis: { url: null } }));

/**
 * Resets the module registry and re-requires both `redis` (auto-mocked)
 * and our redisClient module together, so the `createClient` reference
 * this test holds is the SAME instance redisClient.js itself calls —
 * resetModules() alone would otherwise leave an earlier require('redis')
 * pointing at a stale mock instance.
 */
function freshRedisClient(redisUrl) {
  jest.resetModules();
  jest.doMock('../../src/config/env', () => ({ redis: { url: redisUrl } }));
  jest.doMock('redis');
  // eslint-disable-next-line global-require
  const createClient = require('redis').createClient;
  // eslint-disable-next-line global-require
  const redisClient = require('../../src/cache/redisClient');
  return { redisClient, createClient };
}

function mockRedisPackageClient(createClient) {
  const handlers = {};
  const fakeClient = {
    on: jest.fn((event, cb) => {
      handlers[event] = cb;
      return fakeClient;
    }),
    connect: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
  };
  createClient.mockReturnValue(fakeClient);
  return { fakeClient, handlers };
}

describe('redisClient — disabled (no REDIS_URL)', () => {
  test('isEnabled/isAvailable are false and connectRedis resolves null without creating a client', async () => {
    const { redisClient, createClient } = freshRedisClient(null);
    const result = await redisClient.connectRedis();

    expect(redisClient.isEnabled()).toBe(false);
    expect(redisClient.isAvailable()).toBe(false);
    expect(result).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe('redisClient — enabled (REDIS_URL set)', () => {
  test('becomes available once the "ready" event fires', async () => {
    const { redisClient, createClient } = freshRedisClient('redis://localhost:6379');
    const { fakeClient, handlers } = mockRedisPackageClient(createClient);

    const connectPromise = redisClient.connectRedis();
    handlers.ready();
    await connectPromise;

    expect(fakeClient.connect).toHaveBeenCalledTimes(1);
    expect(redisClient.isAvailable()).toBe(true);
  });

  test('isAvailable flips to false when an error event fires after being ready', async () => {
    const { redisClient, createClient } = freshRedisClient('redis://localhost:6379');
    const { handlers } = mockRedisPackageClient(createClient);

    await redisClient.connectRedis();
    handlers.ready();
    expect(redisClient.isAvailable()).toBe(true);

    handlers.error(new Error('ECONNRESET'));
    expect(redisClient.isAvailable()).toBe(false);
  });

  test('a failed initial connection is caught, not thrown, and leaves isAvailable false', async () => {
    const { redisClient, createClient } = freshRedisClient('redis://localhost:6379');
    const { fakeClient } = mockRedisPackageClient(createClient);
    fakeClient.connect.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await redisClient.connectRedis();

    expect(result).toBeNull();
    expect(redisClient.isAvailable()).toBe(false);
  });

  test('a failed initial connection does not permanently block reconnect — a later call retries and can succeed', async () => {
    const { redisClient, createClient } = freshRedisClient('redis://localhost:6379');
    const { fakeClient: firstAttempt } = mockRedisPackageClient(createClient);
    firstAttempt.connect.mockRejectedValue(new Error('ECONNREFUSED'));

    const firstResult = await redisClient.connectRedis();
    expect(firstResult).toBeNull();
    expect(redisClient.isAvailable()).toBe(false);

    // A later request calls connectRedis() again (e.g. from a route handler
    // that lazily ensures a connection). This must build a fresh client and
    // actually attempt to connect again, not just replay the cached failure.
    const secondAttempt = {
      on: jest.fn((event, cb) => {
        secondAttempt.handlers = secondAttempt.handlers || {};
        secondAttempt.handlers[event] = cb;
        return secondAttempt;
      }),
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
    };
    createClient.mockReturnValue(secondAttempt);

    const secondPromise = redisClient.connectRedis();
    secondAttempt.handlers.ready();
    const secondResult = await secondPromise;

    expect(createClient).toHaveBeenCalledTimes(2);
    expect(secondAttempt.connect).toHaveBeenCalledTimes(1);
    expect(secondResult).toBe(secondAttempt);
    expect(redisClient.isAvailable()).toBe(true);
  });

  test('two concurrent connectRedis() calls during a single successful attempt share the same in-flight promise (createClient called once)', async () => {
    const { redisClient, createClient } = freshRedisClient('redis://localhost:6379');
    const { fakeClient, handlers } = mockRedisPackageClient(createClient);

    const [p1, p2] = [redisClient.connectRedis(), redisClient.connectRedis()];
    handlers.ready();
    await Promise.all([p1, p2]);

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(fakeClient.connect).toHaveBeenCalledTimes(1);
  });

  test('disconnectRedis calls quit() gracefully when ready, and clears availability', async () => {
    const { redisClient, createClient } = freshRedisClient('redis://localhost:6379');
    const { fakeClient, handlers } = mockRedisPackageClient(createClient);

    await redisClient.connectRedis();
    handlers.ready();

    await redisClient.disconnectRedis();

    expect(fakeClient.quit).toHaveBeenCalledTimes(1);
    expect(redisClient.isAvailable()).toBe(false);
  });

  describe('reconnectStrategy passed to createClient', () => {
    test('returns an increasing, capped delay before the attempt ceiling', async () => {
      const { redisClient, createClient } = freshRedisClient('redis://localhost:6379');
      mockRedisPackageClient(createClient);
      await redisClient.connectRedis();

      const { socket } = createClient.mock.calls[0][0];
      expect(socket.reconnectStrategy(1)).toBe(200);
      expect(socket.reconnectStrategy(5)).toBe(1000);
      expect(socket.reconnectStrategy(10)).toBe(2000); // still within the attempt ceiling
      expect(socket.reconnectStrategy(9)).toBeLessThanOrEqual(3000); // capped, not unbounded
    });

    test('gives up (returns an Error) past the max attempt count', async () => {
      const { redisClient, createClient } = freshRedisClient('redis://localhost:6379');
      mockRedisPackageClient(createClient);
      await redisClient.connectRedis();

      const { socket } = createClient.mock.calls[0][0];
      expect(socket.reconnectStrategy(11)).toBeInstanceOf(Error);
    });
  });
});
