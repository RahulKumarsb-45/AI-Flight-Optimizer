/**
 * Rate limiting on POST /api/ai/chat.
 *
 * routes/aiRoutes.js intentionally builds `chatLimiter` as a no-op when
 * `config.nodeEnv === 'test'` (see the comment there) so automated test
 * suites firing many requests in quick succession don't trip it. That means
 * the REAL `express-rate-limit` instance this route uses in dev/production
 * is never constructed at all under `NODE_ENV=test` — there is no way to
 * exercise it by hitting the normal app through supertest with the test
 * env active.
 *
 * To still test the real limiter config (15 requests/60s, the exact
 * RATE_LIMIT_EXCEEDED body) WITHOUT changing that production behavior or
 * the test env for the rest of the suite, this file:
 *   - jest.doMock()s `config/env` to a copy with nodeEnv set to
 *     'production' (env values only — no code changes), so the ternary in
 *     aiRoutes.js picks the real rateLimit(...) branch instead of the no-op.
 *   - jest.isolateModules() to get a FRESH require of the REAL
 *     `../../src/routes/aiRoutes` under that mocked config — this is the
 *     unmodified production module, just loaded with a different config
 *     value, exactly as it would be if this app were actually deployed.
 *   - Mocks only `middleware/auth` (to skip real JWT verification, which
 *     isn't what's under test here) and `controllers/aiController` (to
 *     avoid needing a database or AI provider), isolating the limiter
 *     itself as the thing being verified.
 */
const express = require('express');
const request = require('supertest');

describe('POST /api/ai/chat — rate limiting (real express-rate-limit config, outside NODE_ENV=test)', () => {
  let app;

  beforeEach(() => {
    jest.resetModules();

    jest.doMock('../../src/config/env', () => ({
      ...jest.requireActual('../../src/config/env'),
      nodeEnv: 'production',
    }));

    // Auth and the controller are mocked purely so this test only exercises
    // the rate limiter, not JWT verification or the DB/AI-provider-backed
    // controller logic (both already covered elsewhere).
    jest.doMock('../../src/middleware/auth', () => ({
      requireAuth: (req, res, next) => {
        req.user = { id: 'rate-limit-test-user', email: 'ratelimit@example.com' };
        next();
      },
      optionalAuth: (req, res, next) => next(),
    }));
    jest.doMock('../../src/controllers/aiController', () => ({
      chat: (req, res) => res.status(200).json({ status: 'success', data: { conversationId: 'x', reply: 'ok', extractedParams: null } }),
      listConversations: (req, res) => res.status(200).json({ status: 'success', data: { conversations: [] } }),
      getConversation: (req, res) => res.status(200).json({ status: 'success', data: { conversation: {} } }),
    }));

    // eslint-disable-next-line global-require
    const aiRoutes = require('../../src/routes/aiRoutes');
    app = express();
    app.use(express.json());
    app.use('/api/ai', aiRoutes);
  });

  afterEach(() => {
    jest.dontMock('../../src/config/env');
    jest.dontMock('../../src/middleware/auth');
    jest.dontMock('../../src/controllers/aiController');
  });

  test('allows the first 15 chat requests within the window', async () => {
    for (let i = 0; i < 15; i++) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).post('/api/ai/chat').send({ message: `message ${i}` });
      expect(res.status).toBe(200);
    }
  });

  test('rejects the 16th chat request within the same 60s window with 429 RATE_LIMIT_EXCEEDED', async () => {
    for (let i = 0; i < 15; i++) {
      // eslint-disable-next-line no-await-in-loop
      await request(app).post('/api/ai/chat').send({ message: `message ${i}` });
    }

    const res = await request(app).post('/api/ai/chat').send({ message: 'one too many' });

    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      status: 'error',
      errorCode: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many messages. Please wait a moment.',
    });
  });

  test('sends standard RateLimit-* headers (standardHeaders: true) and no legacy X-RateLimit-* headers', async () => {
    const res = await request(app).post('/api/ai/chat').send({ message: 'hi' });

    expect(res.headers).toHaveProperty('ratelimit-limit');
    expect(res.headers).toHaveProperty('ratelimit-remaining');
    expect(res.headers['x-ratelimit-limit']).toBeUndefined();
  });

  test('rate limiting only applies to POST /chat, not GET /conversations', async () => {
    for (let i = 0; i < 20; i++) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).get('/api/ai/conversations');
      expect(res.status).toBe(200);
    }
  });
});
