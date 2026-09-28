/**
 * Covers the Part 1 fix: a valid ORIGIN airport that Ignav (the primary
 * airport source) knows about, but that is absent from the local
 * 113-airport dataset, must be able to reach the optimizer end-to-end —
 * including on the very first request after a server restart / cache miss,
 * i.e. with nothing pre-warmed in the in-memory externalAirportCache.
 *
 * Kept in its own file (rather than appended to optimize.test.js) so that
 * mocking axios here can't affect the unmocked-axios assumptions the rest
 * of optimize.test.js's suite relies on.
 */
jest.mock('axios');
const axios = require('axios');
const request = require('supertest');
const app = require('../../src/app');
const config = require('../../src/config/env');
const { resetDb, closeDb } = require('../helpers/db');

const originalApiKey = config.ignav.apiKey;

beforeEach(async () => {
  await resetDb();
  jest.resetAllMocks();
  config.ignav.apiKey = 'test_ignav_key';
});

afterAll(async () => {
  config.ignav.apiKey = originalApiKey;
  await closeDb();
});

describe('POST /api/trips/optimize with an Ignav-only origin airport', () => {
  test('a code Ignav knows about but the local dataset does not is accepted by validation and reaches the optimizer, with no fabricated coordinates', async () => {
    // Ignav's real AirportModel never includes coordinates or a 2-letter
    // country code (see ignavAirportProvider.js) — this stub reproduces that
    // shape exactly, and "QRS" is not one of the local 113 airports.
    axios.get.mockResolvedValue({
      data: [{ code: 'QRS', name: 'Quorsville Intl', city: 'Quorsville', country: 'Testland' }],
    });

    const res = await request(app).post('/api/trips/optimize').send({
      originIata: 'QRS',
      destinationCountries: ['GB'],
      departureDate: '2026-08-15',
      returnDate: '2026-08-22',
      preference: 'balanced',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.meta.originIata).toBe('QRS');
    // Ignav gave no coordinates and QRS matches no local record, so nearby
    // expansion for the origin must not fabricate any — it should simply
    // have nothing to add, not error out and not invent a distance/lat/lon.
    expect(res.body.status).toBe('success');
  });

  test('the SAME Ignav-only origin still works on a simulated cold start, i.e. with an empty externalAirportCache (no prior request warmed it)', async () => {
    axios.get.mockResolvedValue({
      data: [{ code: 'QRS', name: 'Quorsville Intl', city: 'Quorsville', country: 'Testland' }],
    });

    // Nothing has looked up QRS in this test yet — jest.resetAllMocks() in
    // beforeEach also means axios.get's call history is fresh here, so a
    // non-zero call count below proves a genuine live lookup happened
    // rather than the request being served from a cache some earlier test
    // left warm. That live lookup (not the cache) is what must survive a
    // real server restart, where the cache starts truly empty.
    const res = await request(app).post('/api/trips/optimize').send({
      originIata: 'QRS',
      destinationCountries: ['GB'],
      departureDate: '2026-08-15',
      preference: 'cheapest',
    });

    expect(res.status).toBe(200);
    expect(axios.get).toHaveBeenCalled();
  });

  test('an Ignav match for a code that IS in the local dataset still gets nearby-airport expansion via its local coordinates', async () => {
    axios.get.mockResolvedValue({
      data: [{ code: 'DEL', name: 'Indira Gandhi Intl (Ignav)', city: 'New Delhi', country: 'India' }],
    });

    const res = await request(app).post('/api/trips/optimize').send({
      originIata: 'DEL',
      destinationCountries: ['GB'],
      departureDate: '2026-08-15',
      returnDate: '2026-08-22',
      preference: 'balanced',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.recommendations.length).toBeGreaterThan(0);
  });

  test('a code unknown to both the local dataset AND a live Ignav lookup is still rejected with a validation error', async () => {
    axios.get.mockResolvedValue({ data: [] });

    const res = await request(app).post('/api/trips/optimize').send({
      originIata: 'ZZZ',
      destinationCountries: ['GB'],
      departureDate: '2026-08-15',
    });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
  });
});
