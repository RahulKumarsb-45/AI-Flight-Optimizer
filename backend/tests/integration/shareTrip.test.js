const request = require('supertest');
const app = require('../../src/app');
const { resetDb, closeDb } = require('../helpers/db');
const { query } = require('../../src/database/pool');

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closeDb();
});

const OWNER = { name: 'Owner', email: 'owner@example.com', password: 'Password123' };
const OTHER = { name: 'Other', email: 'other@example.com', password: 'Password123' };

async function registerAndLogin(user) {
  await request(app).post('/api/auth/register').send(user);
  const res = await request(app).post('/api/auth/login').send({ email: user.email, password: user.password });
  return res.body.data.accessToken;
}

async function createOptimizedTrip(token, overrides = {}) {
  const res = await request(app)
    .post('/api/trips/optimize')
    .set('Authorization', `Bearer ${token}`)
    .send({
      originIata: 'DEL',
      destinationCountries: ['GB'],
      departureDate: '2026-08-15',
      returnDate: '2026-08-22',
      travelers: 2,
      preference: 'balanced',
      ...overrides,
    });
  return res.body.data.tripId;
}

async function createMultiCityTrip(token) {
  const res = await request(app)
    .post('/api/trips/optimize')
    .set('Authorization', `Bearer ${token}`)
    .send({
      originIata: 'DEL',
      destinationCountries: ['GB', 'FR'],
      departureDate: '2026-08-15',
      returnDate: '2026-08-25',
      travelers: 1,
      preference: 'balanced',
    });
  return res.body.data.tripId;
}

describe('POST /api/trips/:tripId/share', () => {
  test('creates a share link for a trip the user owns', async () => {
    const token = await registerAndLogin(OWNER);
    const tripId = await createOptimizedTrip(token);

    const res = await request(app).post(`/api/trips/${tripId}/share`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.shareToken).toBeTruthy();
    expect(res.body.data.shareUrl).toContain(res.body.data.shareToken);
  });

  test('the share token is high-entropy and not derived from the trip id', async () => {
    const token = await registerAndLogin(OWNER);
    const tripId = await createOptimizedTrip(token);

    const res = await request(app).post(`/api/trips/${tripId}/share`).set('Authorization', `Bearer ${token}`);
    const { shareToken } = res.body.data;

    // base64url alphabet only, no dashes copied from the UUID trip id, and
    // long enough (24 random bytes) that it can't be brute-forced.
    expect(shareToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(shareToken.length).toBeGreaterThanOrEqual(24);
    expect(shareToken).not.toBe(tripId);
    expect(shareToken.toLowerCase()).not.toContain(tripId.toLowerCase());
  });

  test('is idempotent: repeated calls return the same active token instead of piling up rows', async () => {
    const token = await registerAndLogin(OWNER);
    const tripId = await createOptimizedTrip(token);

    const first = await request(app).post(`/api/trips/${tripId}/share`).set('Authorization', `Bearer ${token}`);
    const second = await request(app).post(`/api/trips/${tripId}/share`).set('Authorization', `Bearer ${token}`);

    expect(second.body.data.shareToken).toBe(first.body.data.shareToken);
    const rows = await query('SELECT id FROM trip_shares WHERE trip_id = $1', [tripId]);
    expect(rows.rows.length).toBe(1);
  });

  test('rejects sharing a trip that does not belong to the requester', async () => {
    const ownerToken = await registerAndLogin(OWNER);
    const tripId = await createOptimizedTrip(ownerToken);
    const otherToken = await registerAndLogin(OTHER);

    const res = await request(app).post(`/api/trips/${tripId}/share`).set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('TRIP_NOT_FOUND');
  });

  test('rejects sharing without authentication', async () => {
    const token = await registerAndLogin(OWNER);
    const tripId = await createOptimizedTrip(token);

    const res = await request(app).post(`/api/trips/${tripId}/share`);

    expect(res.status).toBe(401);
  });
});

describe('GET /api/trips/shared/:shareToken', () => {
  test('retrieves a shared trip with real stored trip data, no auth required', async () => {
    const token = await registerAndLogin(OWNER);
    const tripId = await createOptimizedTrip(token, { budgetInr: 150000 });
    const shareRes = await request(app).post(`/api/trips/${tripId}/share`).set('Authorization', `Bearer ${token}`);
    const { shareToken } = shareRes.body.data;

    const res = await request(app).get(`/api/trips/shared/${shareToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.trip.origin_iata).toBe('DEL');
    expect(res.body.data.trip.destination_countries).toEqual(['GB']);
    expect(res.body.data.trip.travelers).toBe(2);
    expect(Number(res.body.data.trip.budget_inr)).toBe(150000);
    expect(res.body.data.trip.result_json.recommendations.length).toBeGreaterThan(0);
  });

  test('preserves all actual destinations, flights, and per-destination data for a multi-city trip', async () => {
    const token = await registerAndLogin(OWNER);
    const tripId = await createMultiCityTrip(token);
    const shareRes = await request(app).post(`/api/trips/${tripId}/share`).set('Authorization', `Bearer ${token}`);
    const { shareToken } = shareRes.body.data;

    const res = await request(app).get(`/api/trips/shared/${shareToken}`);
    const topRecommendation = res.body.data.trip.result_json.recommendations[0];

    expect(res.status).toBe(200);
    expect(res.body.data.trip.destination_countries).toEqual(['GB', 'FR']);
    // A real multi-city circuit has more than one actual destination airport,
    // and every leg (outbound + connecting + return) must be present.
    expect(topRecommendation.destinationAirports.length).toBeGreaterThan(1);
    expect(topRecommendation.legs.length).toBeGreaterThanOrEqual(topRecommendation.destinationAirports.length);
  });

  test('returns 404 for a non-existent share token', async () => {
    const res = await request(app).get('/api/trips/shared/does-not-exist-at-all-00000000');
    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('SHARE_NOT_FOUND');
  });

  test('returns 404 for a malformed share token (validation, before any DB lookup)', async () => {
    const res = await request(app).get('/api/trips/shared/short');
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
  });

  test('returns 404 for a revoked share link', async () => {
    const token = await registerAndLogin(OWNER);
    const tripId = await createOptimizedTrip(token);
    const shareRes = await request(app).post(`/api/trips/${tripId}/share`).set('Authorization', `Bearer ${token}`);
    const { shareToken } = shareRes.body.data;

    await request(app).delete(`/api/trips/${tripId}/share`).set('Authorization', `Bearer ${token}`);
    const res = await request(app).get(`/api/trips/shared/${shareToken}`);

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('SHARE_NOT_FOUND');
  });

  test('never leaks the owning user id, email, or any auth/session data', async () => {
    const token = await registerAndLogin(OWNER);
    const tripId = await createOptimizedTrip(token);
    const shareRes = await request(app).post(`/api/trips/${tripId}/share`).set('Authorization', `Bearer ${token}`);
    const { shareToken } = shareRes.body.data;

    const res = await request(app).get(`/api/trips/shared/${shareToken}`);
    const body = JSON.stringify(res.body);

    expect(res.body.data.trip.user_id).toBeUndefined();
    expect(body).not.toContain(OWNER.email);
    expect(body).not.toContain('password');
    expect(body).not.toContain('refresh_token');
    expect(body).not.toContain(token); // the JWT access token itself
  });

  test('a private (unshared) trip cannot be accessed via a guessed or unrelated token', async () => {
    const token = await registerAndLogin(OWNER);
    await createOptimizedTrip(token); // never shared

    const res = await request(app).get('/api/trips/shared/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('SHARE_NOT_FOUND');
  });
});

describe('DELETE /api/trips/:tripId/share', () => {
  test('rejects revoking a share for a trip that does not belong to the requester', async () => {
    const ownerToken = await registerAndLogin(OWNER);
    const tripId = await createOptimizedTrip(ownerToken);
    await request(app).post(`/api/trips/${tripId}/share`).set('Authorization', `Bearer ${ownerToken}`);
    const otherToken = await registerAndLogin(OTHER);

    const res = await request(app).delete(`/api/trips/${tripId}/share`).set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('TRIP_NOT_FOUND');
  });

  test('after revoking, sharing again issues a brand new token', async () => {
    const token = await registerAndLogin(OWNER);
    const tripId = await createOptimizedTrip(token);
    const first = await request(app).post(`/api/trips/${tripId}/share`).set('Authorization', `Bearer ${token}`);

    await request(app).delete(`/api/trips/${tripId}/share`).set('Authorization', `Bearer ${token}`);
    const second = await request(app).post(`/api/trips/${tripId}/share`).set('Authorization', `Bearer ${token}`);

    expect(second.body.data.shareToken).not.toBe(first.body.data.shareToken);
  });
});
