/**
 * These tests exercise the REAL tripController.js / utils/tokens.js source
 * (not reimplementations of their logic) without needing a live Postgres,
 * Redis, or network — none of which are available in every environment
 * this repo is checked into. They are a supplement to, not a replacement
 * for, tests/integration/shareTrip.test.js (which hits real HTTP routes
 * against a real database and is the fuller end-to-end check — run that
 * one too wherever Postgres is available).
 *
 * How: a handful of npm packages the require chain touches purely at
 * module-load time (dotenv, jsonwebtoken, redis, axios) aren't needed for
 * anything these tests actually call, so they're stubbed via a temporary
 * `Module._load` patch — restored in `after()`. `database/pool.js` (a
 * LOCAL file) is replaced in `require.cache` at its real resolved path
 * with an in-memory fake `query`, so `require('../database/pool')` inside
 * the controller transparently gets the fake — the controller source
 * itself is completely unmodified.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const NOT_INSTALLED_STUBS = {
  dotenv: { config: () => ({}) },
  jsonwebtoken: { sign: () => 'stub.jwt.token', verify: () => ({}) },
  redis: { createClient: () => ({ on() {}, connect: async () => {}, quit: async () => {}, disconnect() {} }) },
  axios: { create: () => ({ get: async () => ({ data: {} }), post: async () => ({ data: {} }) }) },
};

const originalModuleLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(NOT_INSTALLED_STUBS, request)) {
    return NOT_INSTALLED_STUBS[request];
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};

const dbState = { calls: [], impl: async () => ({ rows: [] }) };
async function fakeQuery(text, params) {
  dbState.calls.push({ text, params });
  return dbState.impl(text, params);
}
const poolPath = require.resolve('../../src/database/pool.js');
require.cache[poolPath] = { id: poolPath, filename: poolPath, loaded: true, exports: { query: fakeQuery } };

// eslint-disable-next-line global-require
const tripController = require('../../src/controllers/tripController');
// eslint-disable-next-line global-require
const { generateShareToken } = require('../../src/utils/tokens');
// eslint-disable-next-line global-require
const AppError = require('../../src/utils/AppError');

test.after(() => {
  Module._load = originalModuleLoad;
});

function resetDb(impl) {
  dbState.calls.length = 0;
  dbState.impl = impl || (async () => ({ rows: [] }));
}

function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function makeNext() {
  const calls = [];
  const next = (err) => calls.push(err);
  next.calls = calls;
  return next;
}

// ---------------------------------------------------------------------
// generateShareToken
// ---------------------------------------------------------------------

test('generateShareToken: produces a URL-safe, non-guessable token', () => {
  const token = generateShareToken();
  assert.match(token, /^[A-Za-z0-9_-]+$/, 'must be base64url (no +, /, or = padding that would need URL-encoding)');
  // 24 random bytes base64url-encoded is 32 chars — long enough that
  // brute-forcing/guessing it is infeasible.
  assert.ok(token.length >= 24, `expected a high-entropy token, got length ${token.length}`);
});

test('generateShareToken: is not sequential or derived from anything predictable', () => {
  const tokens = new Set();
  for (let i = 0; i < 500; i++) tokens.add(generateShareToken());
  assert.equal(tokens.size, 500, 'every generated token must be unique');
});

// ---------------------------------------------------------------------
// createShare
// ---------------------------------------------------------------------

test('createShare: 404s when the trip does not belong to the requester', async () => {
  resetDb(async () => ({ rows: [] })); // trip ownership SELECT finds nothing
  const req = { params: { tripId: 'trip-1' }, user: { id: 'user-1' } };
  const res = makeRes();
  const next = makeNext();

  await tripController.createShare(req, res, next);

  assert.equal(next.calls.length, 1);
  assert.ok(next.calls[0] instanceof AppError);
  assert.equal(next.calls[0].errorCode, 'TRIP_NOT_FOUND');
  assert.equal(next.calls[0].statusCode, 404);
});

test('createShare: mints a new token and returns a shareUrl when none exists yet', async () => {
  resetDb(async (text) => {
    if (text.includes('FROM trips')) return { rows: [{ id: 'trip-1' }] }; // ownership check passes
    if (text.includes('SELECT share_token FROM trip_shares')) return { rows: [] }; // no active share yet
    if (text.startsWith('INSERT INTO trip_shares')) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });
  const req = { params: { tripId: 'trip-1' }, user: { id: 'user-1' } };
  const res = makeRes();
  const next = makeNext();

  await tripController.createShare(req, res, next);

  assert.equal(next.calls.length, 0, `expected no error, got: ${next.calls[0]}`);
  assert.equal(res.statusCode, 200);
  assert.match(res.body.data.shareToken, /^[A-Za-z0-9_-]+$/);
  assert.ok(res.body.data.shareUrl.endsWith(`/shared/${res.body.data.shareToken}`));

  const insertCall = dbState.calls.find((c) => c.text.startsWith('INSERT INTO trip_shares'));
  assert.ok(insertCall, 'expected an INSERT into trip_shares');
  // Parameterized — the raw tripId/userId/token must travel as bind params,
  // never concatenated into the SQL text itself.
  assert.deepEqual(insertCall.params, ['trip-1', 'user-1', res.body.data.shareToken]);
  assert.ok(!insertCall.text.includes('trip-1'), 'tripId must not be inlined into the SQL string');
});

test('createShare: is idempotent — reuses an existing active share instead of inserting a new one', async () => {
  resetDb(async (text) => {
    if (text.includes('FROM trips')) return { rows: [{ id: 'trip-1' }] };
    if (text.includes('SELECT share_token FROM trip_shares')) return { rows: [{ share_token: 'existing-token-abc123' }] };
    throw new Error(`unexpected query: ${text}`);
  });
  const req = { params: { tripId: 'trip-1' }, user: { id: 'user-1' } };
  const res = makeRes();
  const next = makeNext();

  await tripController.createShare(req, res, next);

  assert.equal(res.body.data.shareToken, 'existing-token-abc123');
  assert.ok(
    !dbState.calls.some((c) => c.text.startsWith('INSERT INTO trip_shares')),
    'must not insert a second row when an active share already exists'
  );
});

// ---------------------------------------------------------------------
// revokeShare
// ---------------------------------------------------------------------

test('revokeShare: 404s when the trip does not belong to the requester', async () => {
  resetDb(async () => ({ rows: [] }));
  const req = { params: { tripId: 'trip-1' }, user: { id: 'user-1' } };
  const res = makeRes();
  const next = makeNext();

  await tripController.revokeShare(req, res, next);

  assert.equal(next.calls[0].errorCode, 'TRIP_NOT_FOUND');
  assert.ok(!dbState.calls.some((c) => c.text.includes('UPDATE trip_shares')), 'must not attempt the revoke UPDATE');
});

test('revokeShare: marks active shares revoked, scoped to this trip AND this owner', async () => {
  resetDb(async (text) => {
    if (text.includes('FROM trips')) return { rows: [{ id: 'trip-1' }] };
    if (text.includes('UPDATE trip_shares')) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });
  const req = { params: { tripId: 'trip-1' }, user: { id: 'user-1' } };
  const res = makeRes();
  const next = makeNext();

  await tripController.revokeShare(req, res, next);

  assert.equal(next.calls.length, 0);
  assert.equal(res.statusCode, 200);
  const updateCall = dbState.calls.find((c) => c.text.includes('UPDATE trip_shares'));
  assert.ok(updateCall.text.includes('revoked = true'));
  assert.deepEqual(updateCall.params, ['trip-1', 'user-1']);
});

// ---------------------------------------------------------------------
// getSharedTrip
// ---------------------------------------------------------------------

test('getSharedTrip: 404s (SHARE_NOT_FOUND) for a non-existent or revoked token', async () => {
  resetDb(async () => ({ rows: [] }));
  const req = { params: { shareToken: 'does-not-exist' } };
  const res = makeRes();
  const next = makeNext();

  await tripController.getSharedTrip(req, res, next);

  assert.equal(next.calls[0].errorCode, 'SHARE_NOT_FOUND');
  assert.equal(next.calls[0].statusCode, 404);
});

test('getSharedTrip: only ever filters by revoked = false, never returns a revoked row', async () => {
  resetDb(async () => ({ rows: [] }));
  const req = { params: { shareToken: 'revoked-token' } };
  const res = makeRes();
  const next = makeNext();

  await tripController.getSharedTrip(req, res, next);

  const call = dbState.calls[0];
  assert.ok(call.text.includes('ts.revoked = false'), 'query must exclude revoked shares');
  assert.deepEqual(call.params, ['revoked-token']);
});

test('getSharedTrip: returns real stored trip data on a valid token', async () => {
  const storedRow = {
    origin_iata: 'DEL',
    destination_countries: ['GB'],
    departure_date: '2026-08-15',
    return_date: '2026-08-22',
    travelers: 2,
    budget_inr: '150000.00',
    preference: 'balanced',
    status: 'optimized',
    result_json: { recommendations: [{ totalPriceInr: 45000 }], categories: {}, meta: {} },
    created_at: new Date().toISOString(),
  };
  resetDb(async () => ({ rows: [storedRow] }));
  const req = { params: { shareToken: 'valid-token' } };
  const res = makeRes();
  const next = makeNext();

  await tripController.getSharedTrip(req, res, next);

  assert.equal(next.calls.length, 0);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data.trip, storedRow);
});

test('getSharedTrip: SQL never uses SELECT * and never selects user_id — no owner PII can leak', async () => {
  resetDb(async () => ({ rows: [{ origin_iata: 'DEL' }] }));
  const req = { params: { shareToken: 'valid-token' } };
  const res = makeRes();
  const next = makeNext();

  await tripController.getSharedTrip(req, res, next);

  const sql = dbState.calls[0].text;
  assert.ok(!/select\s+\*/i.test(sql), 'must use an explicit column allowlist, not SELECT *');
  assert.ok(!/\buser_id\b/i.test(sql), 'must never select the owning user_id for a public/anonymous viewer');
  assert.ok(!/\busers\b/i.test(sql), 'must never join the users table for the public share view');
});
