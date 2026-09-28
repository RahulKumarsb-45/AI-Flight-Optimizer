/**
 * Q3 AI Chat Agent — REAL POSTGRES end-to-end integration tests.
 *
 * Unlike tests/integration/aiAgent.test.js (which fakes the database
 * boundary so the suite still runs in environments without Postgres), this
 * file follows the exact same pattern as this repo's other integration
 * suites (auth.test.js, payment.test.js, shareTrip.test.js): it runs the
 * REAL production code path over HTTP against a REAL Postgres database via
 * tests/helpers/db.js, with `axios` as the only mocked boundary (the
 * external Gemini/Anthropic HTTP call). No real AI provider key or network
 * call is ever used.
 *
 * This is what proves the actual SQL in aiChatService.js is correct against
 * the real ai_conversations/ai_messages schema — column types, NOT NULL /
 * FOREIGN KEY constraints, ON DELETE CASCADE, and real ordering/LIMIT
 * behavior — none of which an in-memory fake DB can verify.
 *
 * Requires a reachable Postgres (see tests/.env.test / .env.test.example)
 * with migrations applied. If that isn't available in a given environment,
 * this file will fail at the database layer; tests/integration/aiAgent.test.js
 * remains this feature's DB-independent fallback coverage.
 */
const request = require('supertest');

jest.mock('axios');
const axios = require('axios');

const app = require('../../src/app');
const config = require('../../src/config/env');
const { resetDb, closeDb } = require('../helpers/db');
const { query } = require('../../src/database/pool');

const USER_A = { name: 'Alice Traveler', email: 'alice.ai@example.com', password: 'Password123' };
const USER_B = { name: 'Bob Traveler', email: 'bob.ai@example.com', password: 'Password123' };

let tokenA;
let tokenB;
let userIdA;

const ORIGINAL_AI_CONFIG = JSON.parse(JSON.stringify(config.ai));

async function registerAndLogin(user) {
  const registerRes = await request(app).post('/api/auth/register').send(user);
  const loginRes = await request(app).post('/api/auth/login').send({ email: user.email, password: user.password });
  return { userId: registerRes.body.data.user.id, token: loginRes.body.data.accessToken };
}

beforeEach(async () => {
  await resetDb();
  jest.clearAllMocks();
  config.ai.provider = 'gemini';
  config.ai.gemini = { apiKey: 'fake-test-gemini-key', model: 'gemini-test-model' };

  ({ userId: userIdA, token: tokenA } = await registerAndLogin(USER_A));
  ({ token: tokenB } = await registerAndLogin(USER_B));
});

afterAll(async () => {
  await closeDb();
});

afterEach(() => {
  config.ai.provider = ORIGINAL_AI_CONFIG.provider;
  config.ai.gemini = { ...ORIGINAL_AI_CONFIG.gemini };
});

function authed(req, token = tokenA) {
  return req.set('Authorization', `Bearer ${token}`);
}

function geminiSuccess({ reply = 'Sure — where are you flying from?', extractedParams = null } = {}) {
  return {
    data: {
      candidates: [
        { finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ reply, extractedParams }) }] } },
      ],
    },
  };
}

// ---------------------------------------------------------------------
// Real schema / persistence
// ---------------------------------------------------------------------
describe('POST /api/ai/chat — real Postgres persistence', () => {
  test('creates a real ai_conversations row and two real ai_messages rows for a first message', async () => {
    axios.post.mockResolvedValueOnce(geminiSuccess({ reply: 'Nice, where to?' }));

    const res = await authed(request(app).post('/api/ai/chat')).send({ message: 'I want to plan a trip' });

    expect(res.status).toBe(200);
    const { conversationId } = res.body.data;

    const convResult = await query('SELECT user_id, title FROM ai_conversations WHERE id = $1', [conversationId]);
    expect(convResult.rows).toHaveLength(1);
    expect(convResult.rows[0]).toMatchObject({ user_id: userIdA, title: 'I want to plan a trip' });

    const msgResult = await query(
      'SELECT role, content, structured_params FROM ai_messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [conversationId]
    );
    expect(msgResult.rows).toHaveLength(2);
    expect(msgResult.rows[0]).toMatchObject({ role: 'user', content: 'I want to plan a trip', structured_params: null });
    expect(msgResult.rows[1]).toMatchObject({ role: 'assistant', content: 'Nice, where to?' });
  });

  test('stores extractedParams as real JSONB, round-trippable via the DB', async () => {
    const extractedParams = { originCity: 'Delhi', destinationCountries: ['Thailand'], readyToSearch: false };
    axios.post.mockResolvedValueOnce(geminiSuccess({ reply: 'Got it.', extractedParams }));

    const res = await authed(request(app).post('/api/ai/chat')).send({ message: 'Thailand trip' });
    const { conversationId } = res.body.data;

    const msgResult = await query(
      `SELECT structured_params FROM ai_messages WHERE conversation_id = $1 AND role = 'assistant'`,
      [conversationId]
    );
    expect(msgResult.rows[0].structured_params).toEqual(extractedParams);
  });

  test('a second message on the same conversation updates ai_conversations.updated_at and appends messages (does not create a new conversation row)', async () => {
    axios.post.mockResolvedValueOnce(geminiSuccess({ reply: 'First reply' }));
    const firstRes = await authed(request(app).post('/api/ai/chat')).send({ message: 'first message' });
    const { conversationId } = firstRes.body.data;
    const beforeUpdatedAt = (await query('SELECT updated_at FROM ai_conversations WHERE id = $1', [conversationId])).rows[0]
      .updated_at;

    await new Promise((r) => setTimeout(r, 10));
    axios.post.mockResolvedValueOnce(geminiSuccess({ reply: 'Second reply' }));
    const secondRes = await authed(request(app).post('/api/ai/chat')).send({ message: 'second message', conversationId });

    expect(secondRes.status).toBe(200);
    expect(secondRes.body.data.conversationId).toBe(conversationId);

    const convCount = await query('SELECT count(*)::int AS count FROM ai_conversations WHERE user_id = $1', [userIdA]);
    expect(convCount.rows[0].count).toBe(1); // still exactly one conversation

    const msgCount = await query('SELECT count(*)::int AS count FROM ai_messages WHERE conversation_id = $1', [conversationId]);
    expect(msgCount.rows[0].count).toBe(4); // 2 user + 2 assistant messages

    const afterUpdatedAt = (await query('SELECT updated_at FROM ai_conversations WHERE id = $1', [conversationId])).rows[0]
      .updated_at;
    expect(new Date(afterUpdatedAt).getTime()).toBeGreaterThan(new Date(beforeUpdatedAt).getTime());
  });

  test('does not create a ghost conversation row when the AI provider call fails', async () => {
    axios.post.mockRejectedValueOnce(new Error('connect ETIMEDOUT'));

    const res = await authed(request(app).post('/api/ai/chat')).send({ message: 'this will fail' });

    expect(res.status).toBe(500);
    const convCount = await query('SELECT count(*)::int AS count FROM ai_conversations WHERE user_id = $1', [userIdA]);
    expect(convCount.rows[0].count).toBe(0);
  });

  test('deleting the owning user cascades to delete their conversations and messages (real FK ON DELETE CASCADE)', async () => {
    axios.post.mockResolvedValueOnce(geminiSuccess({ reply: 'ok' }));
    const res = await authed(request(app).post('/api/ai/chat')).send({ message: 'trip to cascade-delete' });
    const { conversationId } = res.body.data;

    await query('DELETE FROM users WHERE id = $1', [userIdA]);

    const convResult = await query('SELECT id FROM ai_conversations WHERE id = $1', [conversationId]);
    const msgResult = await query('SELECT id FROM ai_messages WHERE conversation_id = $1', [conversationId]);
    expect(convResult.rows).toHaveLength(0);
    expect(msgResult.rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
// listConversations / getConversation — deeper real-DB coverage
// ---------------------------------------------------------------------
describe('GET /api/ai/conversations — real Postgres ordering and scoping', () => {
  test('returns only the requesting user\'s conversations, most recently updated first', async () => {
    axios.post.mockResolvedValueOnce(geminiSuccess({ reply: 'r1' }));
    await authed(request(app).post('/api/ai/chat')).send({ message: 'older conversation' });

    await new Promise((r) => setTimeout(r, 10));
    axios.post.mockResolvedValueOnce(geminiSuccess({ reply: 'r2' }));
    const newer = await authed(request(app).post('/api/ai/chat')).send({ message: 'newer conversation' });

    // Bob's own conversation must never show up in Alice's list.
    axios.post.mockResolvedValueOnce(geminiSuccess({ reply: 'r3' }));
    await authed(request(app).post('/api/ai/chat'), tokenB).send({ message: "bob's conversation" });

    const res = await authed(request(app).get('/api/ai/conversations'));

    expect(res.status).toBe(200);
    expect(res.body.data.conversations).toHaveLength(2);
    expect(res.body.data.conversations[0].id).toBe(newer.body.data.conversationId); // most recently updated first
    expect(res.body.data.conversations.map((c) => c.title)).toEqual(
      expect.arrayContaining(['older conversation', 'newer conversation'])
    );
  });

  test('caps the list at 50 conversations (LIMIT 50 in the real query)', async () => {
    const rows = Array.from({ length: 55 }, (_, i) => `('${userIdA}', 'conv ${i}')`).join(',');
    await query(`INSERT INTO ai_conversations (user_id, title) VALUES ${rows}`);

    const res = await authed(request(app).get('/api/ai/conversations'));

    expect(res.status).toBe(200);
    expect(res.body.data.conversations).toHaveLength(50);
  });
});

describe('GET /api/ai/conversations/:conversationId — real Postgres shape and isolation', () => {
  test('returns the full conversation with its ordered messages and structured_params', async () => {
    const extractedParams = { originCity: 'Pune', destinationCountries: [], readyToSearch: false };
    axios.post.mockResolvedValueOnce(geminiSuccess({ reply: 'Where would you like to go?', extractedParams }));
    const chatRes = await authed(request(app).post('/api/ai/chat')).send({ message: 'Hi, planning a trip' });
    const { conversationId } = chatRes.body.data;

    const res = await authed(request(app).get(`/api/ai/conversations/${conversationId}`));

    expect(res.status).toBe(200);
    expect(res.body.data.conversation.id).toBe(conversationId);
    expect(res.body.data.conversation.messages).toHaveLength(2);
    expect(res.body.data.conversation.messages[0]).toMatchObject({ role: 'user', content: 'Hi, planning a trip' });
    expect(res.body.data.conversation.messages[1]).toMatchObject({
      role: 'assistant',
      content: 'Where would you like to go?',
      structured_params: extractedParams,
    });
  });

  test("404s (not another user's data) when the conversation belongs to a different real user", async () => {
    axios.post.mockResolvedValueOnce(geminiSuccess({ reply: "bob's reply" }));
    const bobChat = await authed(request(app).post('/api/ai/chat'), tokenB).send({ message: "bob's trip" });
    const bobConversationId = bobChat.body.data.conversationId;

    const res = await authed(request(app).get(`/api/ai/conversations/${bobConversationId}`), tokenA);

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('AI_CONVERSATION_NOT_FOUND');
  });

  test("404s (not another user's data) when posting a chat message into a real conversation owned by a different user", async () => {
    axios.post.mockResolvedValueOnce(geminiSuccess({ reply: "bob's reply" }));
    const bobChat = await authed(request(app).post('/api/ai/chat'), tokenB).send({ message: "bob's trip" });
    const bobConversationId = bobChat.body.data.conversationId;

    const res = await authed(request(app).post('/api/ai/chat'), tokenA).send({
      message: 'trying to hijack this conversation',
      conversationId: bobConversationId,
    });

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('AI_CONVERSATION_NOT_FOUND');
    // Only Bob's original message pair exists — Alice's attempt inserted nothing.
    const msgCount = await query('SELECT count(*)::int AS count FROM ai_messages WHERE conversation_id = $1', [
      bobConversationId,
    ]);
    expect(msgCount.rows[0].count).toBe(2);
  });
});

// ---------------------------------------------------------------------
// Anthropic provider — real end-to-end HTTP round trip
// ---------------------------------------------------------------------
describe('POST /api/ai/chat — with AI_PROVIDER=anthropic, real DB round trip', () => {
  beforeEach(() => {
    config.ai.provider = 'anthropic';
    config.ai.anthropic = { apiKey: 'fake-test-anthropic-key', model: 'claude-test-model' };
  });

  function anthropicSuccess({ reply = 'Sure, tell me more.', extractedParams = null } = {}) {
    return { data: { content: [{ type: 'text', text: JSON.stringify({ reply, extractedParams }) }] } };
  }

  test('a full chat round trip persists correctly to Postgres when Anthropic is the configured provider', async () => {
    const extractedParams = { originCity: 'Bengaluru', destinationCountries: ['UAE'], readyToSearch: false };
    axios.post.mockResolvedValueOnce(anthropicSuccess({ reply: 'Great choice!', extractedParams }));

    const res = await authed(request(app).post('/api/ai/chat')).send({ message: 'I want to visit the UAE' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ conversationId: expect.any(String), reply: 'Great choice!', extractedParams });
    expect(axios.post).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.anything(),
      expect.objectContaining({ headers: expect.objectContaining({ 'x-api-key': 'fake-test-anthropic-key' }) })
    );

    const msgResult = await query(
      `SELECT role, content, structured_params FROM ai_messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [res.body.data.conversationId]
    );
    expect(msgResult.rows[0]).toMatchObject({ role: 'user', content: 'I want to visit the UAE' });
    expect(msgResult.rows[1]).toMatchObject({ role: 'assistant', content: 'Great choice!' });
    expect(msgResult.rows[1].structured_params).toEqual(extractedParams);
  });

  test('malformed Anthropic output surfaces as 502 AI_PROVIDER_ERROR and creates no conversation row', async () => {
    axios.post.mockResolvedValueOnce({ data: { content: [{ type: 'text', text: 'not json' }] } });

    const res = await authed(request(app).post('/api/ai/chat')).send({ message: 'hi' });

    expect(res.status).toBe(502);
    expect(res.body.errorCode).toBe('AI_PROVIDER_ERROR');
    const convCount = await query('SELECT count(*)::int AS count FROM ai_conversations WHERE user_id = $1', [userIdA]);
    expect(convCount.rows[0].count).toBe(0);
  });

  test('missing ANTHROPIC_API_KEY fails closed with 500 AI_NOT_CONFIGURED and never calls the network', async () => {
    config.ai.anthropic.apiKey = undefined;

    const res = await authed(request(app).post('/api/ai/chat')).send({ message: 'hi' });

    expect(res.status).toBe(500);
    expect(res.body.errorCode).toBe('AI_NOT_CONFIGURED');
    expect(axios.post).not.toHaveBeenCalled();
  });
});
