/**
 * Q3 AI Chat Agent — HTTP-level integration tests.
 *
 * These exercise the REAL production code path over HTTP:
 *   routes/aiRoutes.js -> middleware/auth.js -> validators/aiValidators.js
 *     -> controllers/aiController.js -> services/aiChatService.js
 *     -> services/aiProvider/{gemini,anthropic}Provider.js
 *
 * Two boundaries are mocked, deliberately:
 *   - `axios`: the module both AI provider files use to reach the external
 *     Gemini/Anthropic HTTP APIs. No real API key or network call is ever
 *     made.
 *   - `database/pool` (`query`/`withTransaction`): this repo's other
 *     integration tests (auth.test.js, payment.test.js, shareTrip.test.js)
 *     run against a real Postgres via tests/helpers/db.js. That database is
 *     not available in every environment this suite is run in, so — same
 *     technique already used in tests/unit/shareTrip.controller.test.js —
 *     the DB boundary is faked here with an in-memory implementation keyed
 *     off the query text. This still runs every other line of production
 *     code for real: real Express routing, real helmet/cors middleware,
 *     real JWT verification in middleware/auth.js, real express-validator
 *     rules, and the real aiController/aiChatService logic (including the
 *     conversation-ownership check that enforces per-user isolation).
 *   Wherever this repo's Postgres IS available, tests/integration/*.test.js
 *   already cover the equivalent full-stack-with-real-DB path for other
 *   features (auth, payments, sharing); this file is this feature's
 *   equivalent for the parts that don't require Postgres to verify.
 */

jest.mock('axios');
const axios = require('axios');

jest.mock('../../src/database/pool', () => {
  const client = { query: jest.fn(), release: jest.fn() };
  return {
    query: jest.fn(),
    withTransaction: jest.fn(async (cb) => cb(client)),
    pool: {},
    __client: client,
  };
});

const request = require('supertest');
const app = require('../../src/app');
const config = require('../../src/config/env');
const dbMock = require('../../src/database/pool');
const { generateAccessToken } = require('../../src/utils/tokens');

const USER_A = { id: '11111111-1111-1111-1111-111111111111', email: 'alice@example.com' };
const USER_B = { id: '22222222-2222-2222-2222-222222222222', email: 'bob@example.com' };

function tokenFor(user) {
  return generateAccessToken(user);
}

function authed(req, user = USER_A) {
  return req.set('Authorization', `Bearer ${tokenFor(user)}`);
}

const ORIGINAL_AI_CONFIG = JSON.parse(JSON.stringify(config.ai));

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) so a `mockResolvedValueOnce`/
  // `mockRejectedValueOnce` queued by one test but never consumed (e.g. a
  // request that short-circuited on validation before reaching axios)
  // can never leak into and be consumed by the next test.
  jest.resetAllMocks();
  dbMock.withTransaction.mockImplementation(async (cb) => cb(dbMock.__client));
  // Deterministic provider for this suite regardless of local .env.
  config.ai.provider = 'gemini';
  config.ai.gemini = { apiKey: 'fake-test-gemini-key', model: 'gemini-test-model' };
});

afterEach(() => {
  config.ai.provider = ORIGINAL_AI_CONFIG.provider;
  config.ai.gemini = { ...ORIGINAL_AI_CONFIG.gemini };
  config.ai.anthropic = { ...ORIGINAL_AI_CONFIG.anthropic };
});

function geminiSuccess({ reply = 'Sure — where are you flying from?', extractedParams = null } = {}) {
  return {
    data: {
      candidates: [
        { finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ reply, extractedParams }) }] } },
      ],
    },
  };
}

/** Configures the mocked pool for a brand-new conversation (no conversationId sent). */
function mockDbForNewConversation({ insertedConversationId = 'conv-new-1' } = {}) {
  dbMock.query.mockImplementation(async () => ({ rows: [] }));
  dbMock.__client.query.mockImplementation(async (text) => {
    if (text.startsWith('INSERT INTO ai_conversations')) return { rows: [{ id: insertedConversationId }] };
    return { rows: [] };
  });
}

/** Configures the mocked pool as if `conversationId` is owned by `ownerId`. */
function mockDbForExistingConversation({ conversationId, ownerId, historyRows = [] }) {
  dbMock.query.mockImplementation(async (text, params) => {
    if (text.includes('FROM ai_conversations WHERE id')) {
      return params[0] === conversationId && params[1] === ownerId ? { rows: [{ id: conversationId }] } : { rows: [] };
    }
    if (text.includes('FROM ai_messages')) {
      return { rows: historyRows };
    }
    return { rows: [] };
  });
  dbMock.__client.query.mockImplementation(async () => ({ rows: [] }));
}

// ---------------------------------------------------------------------
// 1. Basic chat endpoint flow
// ---------------------------------------------------------------------
describe('POST /api/ai/chat — basic flow', () => {
  test('an authenticated user sending a valid message gets the expected response shape', async () => {
    mockDbForNewConversation({ insertedConversationId: 'conv-abc-123' });
    const extractedParams = { originCity: 'Delhi', destinationCountries: ['Japan'], readyToSearch: false };
    axios.post.mockResolvedValueOnce(geminiSuccess({ reply: 'Great, when would you like to travel?', extractedParams }));

    const res = await authed(request(app).post('/api/ai/chat')).send({ message: 'I want to go to Japan' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'success',
      data: {
        conversationId: 'conv-abc-123',
        reply: 'Great, when would you like to travel?',
        extractedParams,
      },
    });
  });

  test('persists both the user message and the assistant reply for a new conversation', async () => {
    mockDbForNewConversation({ insertedConversationId: 'conv-persist-1' });
    axios.post.mockResolvedValueOnce(geminiSuccess({ reply: 'Got it.' }));

    await authed(request(app).post('/api/ai/chat')).send({ message: 'Hello there' });

    const insertCalls = dbMock.__client.query.mock.calls.map((c) => c[0]);
    expect(insertCalls.some((sql) => sql.startsWith('INSERT INTO ai_conversations'))).toBe(true);
    // role ('user' / 'assistant') is inlined as a SQL literal by the current
    // implementation, not passed as a bind param — so we match on the SQL
    // text itself, and check the actual bind params that ARE used.
    const userInsert = dbMock.__client.query.mock.calls.find(
      (c) => c[0].includes('INSERT INTO ai_messages') && c[0].includes("'user'")
    );
    const assistantInsert = dbMock.__client.query.mock.calls.find(
      (c) => c[0].includes('INSERT INTO ai_messages') && c[0].includes("'assistant'")
    );
    expect(userInsert[1]).toEqual(['conv-persist-1', 'Hello there']);
    expect(assistantInsert[1][0]).toBe('conv-persist-1');
    expect(assistantInsert[1][1]).toBe('Got it.');
  });

  test('continuing an existing, owned conversation reuses its id and sends prior history to the provider', async () => {
    mockDbForExistingConversation({
      conversationId: '33333333-3333-4333-8333-333333333333',
      ownerId: USER_A.id,
      historyRows: [{ role: 'user', content: 'earlier message' }, { role: 'assistant', content: 'earlier reply' }],
    });
    axios.post.mockResolvedValueOnce(geminiSuccess({ reply: 'Following up on that...' }));

    const res = await authed(request(app).post('/api/ai/chat')).send({
      message: 'a follow-up',
      conversationId: '33333333-3333-4333-8333-333333333333',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.conversationId).toBe('33333333-3333-4333-8333-333333333333');
    const [, body] = axios.post.mock.calls[0];
    expect(body.contents[0]).toEqual({ role: 'user', parts: [{ text: 'earlier message' }] });
    expect(body.contents[1]).toEqual({ role: 'model', parts: [{ text: 'earlier reply' }] });
    expect(body.contents[body.contents.length - 1]).toEqual({ role: 'user', parts: [{ text: 'a follow-up' }] });
  });

  test('rejects an unauthenticated request with 401 and never calls the AI provider', async () => {
    const res = await request(app).post('/api/ai/chat').send({ message: 'hi' });

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('AUTH_MISSING_TOKEN');
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('rejects a request with an invalid/garbage bearer token with 401', async () => {
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', 'Bearer not-a-real-jwt')
      .send({ message: 'hi' });

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('AUTH_INVALID_TOKEN');
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('rejects a missing message field with 400 VALIDATION_ERROR', async () => {
    const res = await authed(request(app).post('/api/ai/chat')).send({});

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('rejects an empty-string message with 400 VALIDATION_ERROR', async () => {
    const res = await authed(request(app).post('/api/ai/chat')).send({ message: '' });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('rejects a whitespace-only message with 400 VALIDATION_ERROR (trimmed to empty by the validator)', async () => {
    const res = await authed(request(app).post('/api/ai/chat')).send({ message: '     ' });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('rejects a message over the 1000-character limit with 400 VALIDATION_ERROR', async () => {
    const res = await authed(request(app).post('/api/ai/chat')).send({ message: 'a'.repeat(1001) });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('rejects a non-string message (malformed request body) with 400 VALIDATION_ERROR', async () => {
    const res = await authed(request(app).post('/api/ai/chat')).send({ message: 12345 });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('rejects a non-UUID conversationId (malformed request) with 400 VALIDATION_ERROR', async () => {
    const res = await authed(request(app).post('/api/ai/chat')).send({
      message: 'hi',
      conversationId: 'not-a-valid-uuid',
    });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('a malformed (unparseable) JSON body never reaches the AI provider', async () => {
    // Documents actual current behavior: express.json() throws a raw
    // SyntaxError for unparseable JSON, which isn't an AppError, so the
    // generic error handler returns 500 rather than a 400 VALIDATION_ERROR.
    // This is a body-parsing failure caught before routing/auth even run.
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Content-Type', 'application/json')
      .send('{ this is not valid json');

    expect(res.status).toBe(500);
    expect(res.body.status).toBe('error');
    expect(axios.post).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------
// 2. AI provider error handling, as surfaced through the HTTP endpoint
// ---------------------------------------------------------------------
describe('POST /api/ai/chat — AI provider error handling', () => {
  beforeEach(() => {
    mockDbForNewConversation();
  });

  test('surfaces a provider HTTP error (e.g. 500 from Gemini) as a failed response without creating a conversation row', async () => {
    const providerError = new Error('Request failed with status code 500');
    providerError.response = { status: 500, data: { error: { message: 'internal error' } } };
    axios.post.mockRejectedValueOnce(providerError);

    const res = await authed(request(app).post('/api/ai/chat')).send({ message: 'hi' });

    expect(res.status).toBe(500);
    expect(res.body.status).toBe('error');
    expect(dbMock.__client.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO ai_conversations'), expect.anything());
  });

  test('surfaces a provider timeout as a failed response, not a hang or a 200', async () => {
    const timeoutError = new Error('timeout of 20000ms exceeded');
    timeoutError.code = 'ECONNABORTED';
    axios.post.mockRejectedValueOnce(timeoutError);

    const res = await authed(request(app).post('/api/ai/chat')).send({ message: 'hi' });

    expect(res.status).toBe(500);
    expect(res.body.status).toBe('error');
  });

  test('rejects with 502 AI_PROVIDER_ERROR when the provider returns malformed (non-JSON) output', async () => {
    axios.post.mockResolvedValueOnce({
      data: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'not valid json' }] } }] },
    });

    const res = await authed(request(app).post('/api/ai/chat')).send({ message: 'hi' });

    expect(res.status).toBe(502);
    expect(res.body.errorCode).toBe('AI_PROVIDER_ERROR');
  });

  test('rejects with 502 AI_PROVIDER_ERROR when the provider returns an empty/unexpected response', async () => {
    axios.post.mockResolvedValueOnce({ data: { candidates: [] } });

    const res = await authed(request(app).post('/api/ai/chat')).send({ message: 'hi' });

    expect(res.status).toBe(502);
    expect(res.body.errorCode).toBe('AI_PROVIDER_ERROR');
  });

  test('rejects with 500 AI_NOT_CONFIGURED when the AI API key is missing, and never calls the provider', async () => {
    config.ai.gemini.apiKey = undefined;

    const res = await authed(request(app).post('/api/ai/chat')).send({ message: 'hi' });

    expect(res.status).toBe(500);
    expect(res.body.errorCode).toBe('AI_NOT_CONFIGURED');
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('rejects with 400 AI_SAFETY_BLOCKED when Gemini blocks the content for safety', async () => {
    axios.post.mockResolvedValueOnce({ data: { candidates: [{ finishReason: 'SAFETY', content: undefined }] } });

    const res = await authed(request(app).post('/api/ai/chat')).send({ message: 'hi' });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('AI_SAFETY_BLOCKED');
  });

  test('surfaces a provider rate-limit response (429) as a failed response (current code has no special-cased retry/backoff)', async () => {
    const rateLimitError = new Error('Request failed with status code 429');
    rateLimitError.response = { status: 429, data: { error: { message: 'rate limited' } } };
    axios.post.mockRejectedValueOnce(rateLimitError);

    const res = await authed(request(app).post('/api/ai/chat')).send({ message: 'hi' });

    expect(res.status).toBe(500); // generic error handler — not a dedicated 429/RATE_LIMIT_EXCEEDED path
    expect(res.body.status).toBe('error');
  });
});

// ---------------------------------------------------------------------
// 3. Security
// ---------------------------------------------------------------------
describe('POST /api/ai/chat — security', () => {
  test('authentication is enforced on the chat endpoint', async () => {
    const res = await request(app).post('/api/ai/chat').send({ message: 'hi' });
    expect(res.status).toBe(401);
  });

  test('authentication is enforced on GET /api/ai/conversations', async () => {
    const res = await request(app).get('/api/ai/conversations');
    expect(res.status).toBe(401);
  });

  test('authentication is enforced on GET /api/ai/conversations/:conversationId', async () => {
    const res = await request(app).get('/api/ai/conversations/33333333-3333-3333-3333-333333333333');
    expect(res.status).toBe(401);
  });

  test('the configured AI API key is never exposed in a successful chat response', async () => {
    mockDbForNewConversation();
    axios.post.mockResolvedValueOnce(geminiSuccess({ reply: 'hello' }));

    const res = await authed(request(app).post('/api/ai/chat')).send({ message: 'hi' });

    expect(JSON.stringify(res.body)).not.toContain(config.ai.gemini.apiKey);
  });

  test('the configured AI API key is never exposed in an error response', async () => {
    mockDbForNewConversation();
    const authError = new Error('Request failed with status code 401');
    authError.response = { status: 401, data: { error: { message: 'API key not valid' } } };
    axios.post.mockRejectedValueOnce(authError);

    const res = await authed(request(app).post('/api/ai/chat')).send({ message: 'hi' });

    expect(JSON.stringify(res.body)).not.toContain(config.ai.gemini.apiKey);
  });

  test('an internal error response never leaks a stack trace', async () => {
    mockDbForNewConversation();
    axios.post.mockRejectedValueOnce(new Error('connect ETIMEDOUT'));

    const res = await authed(request(app).post('/api/ai/chat')).send({ message: 'hi' });

    expect(res.body.stack).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/); // no stack-trace-shaped strings
  });

  test('one user cannot read another user\'s conversation (404, not another user\'s data)', async () => {
    const sharedConversationId = '44444444-4444-4444-8444-444444444444';
    mockDbForExistingConversation({ conversationId: sharedConversationId, ownerId: USER_A.id });

    const res = await authed(request(app).get(`/api/ai/conversations/${sharedConversationId}`), USER_B);

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('AI_CONVERSATION_NOT_FOUND');
  });

  test('one user cannot post a chat message into another user\'s existing conversation', async () => {
    const sharedConversationId = '55555555-5555-4555-8555-555555555555';
    mockDbForExistingConversation({ conversationId: sharedConversationId, ownerId: USER_A.id });

    const res = await authed(
      request(app).post('/api/ai/chat').send({ message: 'sneaky', conversationId: sharedConversationId }),
      USER_B
    );

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('AI_CONVERSATION_NOT_FOUND');
    expect(axios.post).not.toHaveBeenCalled(); // ownership is checked before ever calling the AI provider
  });

  test('the rightful owner CAN read their own conversation (sanity check for the isolation tests above)', async () => {
    const conversationId = '66666666-6666-4666-8666-666666666666';
    mockDbForExistingConversation({
      conversationId,
      ownerId: USER_A.id,
      historyRows: [{ role: 'user', content: 'hi' }],
    });
    dbMock.query.mockImplementation(async (text, params) => {
      if (text.includes('FROM ai_conversations WHERE id') && text.includes('created_at')) {
        return params[0] === conversationId && params[1] === USER_A.id
          ? { rows: [{ id: conversationId, title: 'My trip', created_at: new Date().toISOString() }] }
          : { rows: [] };
      }
      if (text.includes('FROM ai_messages')) {
        return { rows: [{ id: 'm1', role: 'user', content: 'hi', structured_params: null, created_at: new Date().toISOString() }] };
      }
      return { rows: [] };
    });

    const res = await authed(request(app).get(`/api/ai/conversations/${conversationId}`), USER_A);

    expect(res.status).toBe(200);
    expect(res.body.data.conversation.id).toBe(conversationId);
  });

  test('listConversations scopes its query to the requesting user\'s id, not a client-supplied value', async () => {
    dbMock.query.mockImplementation(async () => ({ rows: [] }));

    await authed(request(app).get('/api/ai/conversations'), USER_B);

    const call = dbMock.query.mock.calls.find((c) => c[0].includes('FROM ai_conversations') && c[0].includes('ORDER BY updated_at'));
    expect(call[1]).toEqual([USER_B.id]);
  });
});
