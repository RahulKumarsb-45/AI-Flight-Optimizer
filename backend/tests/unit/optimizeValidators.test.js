jest.mock('axios');
const axios = require('axios');
const express = require('express');
const request = require('supertest');
const config = require('../../src/config/env');
const { optimizeTripValidator } = require('../../src/validators/optimizeValidators');

/**
 * Isolated from the full app (no DB/pool involvement) so this can run as a
 * pure unit test: a minimal express app wired with just the validator chain
 * under test plus a dummy 200 handler.
 */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.post('/optimize', optimizeTripValidator, (req, res) => {
    res.status(200).json({ status: 'success' });
  });
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    res.status(err.statusCode || 500).json({ status: 'error', errorCode: err.errorCode, message: err.message });
  });
  return app;
}

const validBody = {
  destinationCountries: ['GB'],
  departureDate: '2026-08-15',
};

describe('optimizeTripValidator originIata (local -> cache -> live Ignav)', () => {
  const originalApiKey = config.ignav.apiKey;
  let app;

  beforeEach(() => {
    jest.resetAllMocks();
    config.ignav.apiKey = 'test_ignav_key';
    app = buildApp();
  });

  afterAll(() => {
    config.ignav.apiKey = originalApiKey;
  });

  test('accepts a known local origin without calling Ignav', async () => {
    axios.get.mockResolvedValue({ data: [] });
    const res = await request(app).post('/optimize').send({ ...validBody, originIata: 'DEL' });
    expect(res.status).toBe(200);
  });

  test('accepts a valid Ignav-only origin absent from the local 113-airport dataset', async () => {
    axios.get.mockResolvedValue({
      data: [{ code: 'QRS', name: 'Quorsville Intl', city: 'Quorsville', country: 'Testland' }],
    });
    const res = await request(app).post('/optimize').send({ ...validBody, originIata: 'QRS' });
    expect(res.status).toBe(200);
  });

  test('rejects a code unknown to both the local dataset and a live Ignav lookup', async () => {
    axios.get.mockResolvedValue({ data: [] });
    const res = await request(app).post('/optimize').send({ ...validBody, originIata: 'ZZZ' });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
  });

  test('rejects a code unknown locally when Ignav itself errors during the live lookup (no crash, clean 400)', async () => {
    axios.get.mockRejectedValue({ response: { status: 500, data: {} } });
    const res = await request(app).post('/optimize').send({ ...validBody, originIata: 'ZZZ' });
    expect(res.status).toBe(400);
  }, 15000);
});
