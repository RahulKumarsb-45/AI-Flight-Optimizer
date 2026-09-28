const request = require('supertest');
const app = require('../../src/app');
const { resetDb, closeDb } = require('../helpers/db');

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closeDb();
});

async function registerAndLogin() {
  await request(app).post('/api/auth/register').send({
    name: 'Trip Tester',
    email: 'tripper@example.com',
    password: 'Password123',
  });
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'tripper@example.com', password: 'Password123' });
  return res.body.data.accessToken;
}

describe('POST /api/trips/optimize', () => {
  test('guest search succeeds and does not persist a trip (no tripId)', async () => {
    const res = await request(app).post('/api/trips/optimize').send({
      originIata: 'DEL',
      destinationCountries: ['GB'],
      departureDate: '2026-08-15',
      returnDate: '2026-08-22',
      travelers: 1,
      preference: 'balanced',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.tripId).toBeNull();
    expect(res.body.data.recommendations.length).toBeGreaterThan(0);
  });

  test('authenticated search returns a tripId and persists it to the trips table', async () => {
    const token = await registerAndLogin();
    const res = await request(app)
      .post('/api/trips/optimize')
      .set('Authorization', `Bearer ${token}`)
      .send({
        originIata: 'DEL',
        destinationCountries: ['GB'],
        departureDate: '2026-08-15',
        returnDate: '2026-08-22',
        travelers: 2,
        budgetInr: 300000,
        preference: 'balanced',
      });
    expect(res.status).toBe(200);
    expect(res.body.data.tripId).not.toBeNull();

    const { query } = require('../../src/database/pool');
    const dbRow = await query('SELECT * FROM trips WHERE id = $1', [res.body.data.tripId]);
    expect(dbRow.rows[0].status).toBe('optimized');
  });

  test('round trip prices include BOTH outbound and return legs, not just outbound', async () => {
    const oneWay = await request(app).post('/api/trips/optimize').send({
      originIata: 'DEL',
      destinationCountries: ['GB'],
      departureDate: '2026-08-15',
      travelers: 1,
      preference: 'cheapest',
    });
    const roundTrip = await request(app).post('/api/trips/optimize').send({
      originIata: 'DEL',
      destinationCountries: ['GB'],
      departureDate: '2026-08-15',
      returnDate: '2026-08-22',
      travelers: 1,
      preference: 'cheapest',
    });
    expect(roundTrip.body.data.recommendations[0].totalPriceInr).toBeGreaterThan(
      oneWay.body.data.recommendations[0].totalPriceInr
    );
  });

  test('an impossibly low budget prunes every candidate to zero results', async () => {
    const res = await request(app).post('/api/trips/optimize').send({
      originIata: 'DEL',
      destinationCountries: ['GB'],
      departureDate: '2026-08-15',
      returnDate: '2026-08-22',
      budgetInr: 1000,
      preference: 'cheapest',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.recommendations).toHaveLength(0);
    expect(res.body.data.meta.pruning.reasons.overBudget).toBeGreaterThan(0);
  });

  test('rejects more than 4 destination countries with a validation error', async () => {
    const res = await request(app).post('/api/trips/optimize').send({
      originIata: 'DEL',
      destinationCountries: ['GB', 'FR', 'DE', 'IT', 'ES'],
      departureDate: '2026-08-15',
    });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
  });

  test('rejects an unknown origin airport code', async () => {
    const res = await request(app).post('/api/trips/optimize').send({
      originIata: 'ZZZ',
      destinationCountries: ['GB'],
      departureDate: '2026-08-15',
    });
    expect(res.status).toBe(400);
  });

  test('rejects minStayDays greater than maxStayDays', async () => {
    const res = await request(app).post('/api/trips/optimize').send({
      originIata: 'DEL',
      destinationCountries: ['GB'],
      departureDate: '2026-08-15',
      dateFlexible: true,
      minStayDays: 10,
      maxStayDays: 3,
    });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
  });

  test('multi-country trip produces a circuit with staggered leg dates', async () => {
    const res = await request(app).post('/api/trips/optimize').send({
      originIata: 'DEL',
      destinationCountries: ['GB', 'FR'],
      departureDate: '2026-09-01',
      returnDate: '2026-09-10',
      preference: 'cheapest',
    });
    expect(res.status).toBe(200);
    const top = res.body.data.recommendations[0];
    const dates = top.legs.map((l) => l.date);
    expect(new Set(dates).size).toBeGreaterThan(1);
  });
});
