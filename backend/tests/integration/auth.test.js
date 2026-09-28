const request = require('supertest');
const app = require('../../src/app');
const { resetDb, closeDb } = require('../helpers/db');

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closeDb();
});

const VALID_USER = { name: 'Test User', email: 'test@example.com', password: 'Password123' };

describe('POST /api/auth/register', () => {
  test('creates a new account and returns sanitized user (no password_hash)', async () => {
    const res = await request(app).post('/api/auth/register').send(VALID_USER);
    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe(VALID_USER.email);
    expect(res.body.data.user.password_hash).toBeUndefined();
  });

  test('rejects a duplicate email with 409', async () => {
    await request(app).post('/api/auth/register').send(VALID_USER);
    const res = await request(app).post('/api/auth/register').send(VALID_USER);
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('AUTH_EMAIL_TAKEN');
  });

  test('rejects a weak password with a validation error', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...VALID_USER, password: 'weak' });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
  });

  test('creates a default free-tier subscription row for the new user', async () => {
    const { query } = require('../../src/database/pool');
    await request(app).post('/api/auth/register').send(VALID_USER);
    const result = await query('SELECT plan, status FROM subscriptions');
    expect(result.rows[0]).toEqual({ plan: 'free', status: 'active' });
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/api/auth/register').send(VALID_USER);
  });

  test('logs in with correct credentials and returns an access token + refresh cookie', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: VALID_USER.password });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.headers['set-cookie'][0]).toMatch(/refresh_token=/);
  });

  test('rejects an incorrect password with 401', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: VALID_USER.email, password: 'WrongPass1' });
    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('AUTH_INVALID_CREDENTIALS');
  });

  test('locks the account after 5 failed attempts', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login').send({ email: VALID_USER.email, password: 'WrongPass1' });
    }
    const res = await request(app).post('/api/auth/login').send({ email: VALID_USER.email, password: VALID_USER.password });
    expect(res.status).toBe(423);
    expect(res.body.errorCode).toBe('AUTH_ACCOUNT_LOCKED');
  });

  test('resets failed attempt count after a successful login', async () => {
    await request(app).post('/api/auth/login').send({ email: VALID_USER.email, password: 'WrongPass1' });
    await request(app).post('/api/auth/login').send({ email: VALID_USER.email, password: 'WrongPass1' });
    const success = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: VALID_USER.password });
    expect(success.status).toBe(200);
  });
});

describe('GET /api/auth/me', () => {
  test('returns 401 without a token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('AUTH_MISSING_TOKEN');
  });

  test('returns the current user profile with a valid access token', async () => {
    await request(app).post('/api/auth/register').send(VALID_USER);
    const loginRes = await request(app).post('/api/auth/login').send({ email: VALID_USER.email, password: VALID_USER.password });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${loginRes.body.data.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(VALID_USER.email);
  });
});

describe('POST /api/auth/refresh', () => {
  test('rotates the refresh token and issues a new access token', async () => {
    await request(app).post('/api/auth/register').send(VALID_USER);
    const loginRes = await request(app).post('/api/auth/login').send({ email: VALID_USER.email, password: VALID_USER.password });
    const cookie = loginRes.headers['set-cookie'];

    const refreshRes = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.data.accessToken).toBeDefined();
    expect(refreshRes.body.data.accessToken).not.toBe(loginRes.body.data.accessToken);
  });

  test('detects reuse of an already-rotated refresh token and revokes the session', async () => {
    await request(app).post('/api/auth/register').send(VALID_USER);
    const loginRes = await request(app).post('/api/auth/login').send({ email: VALID_USER.email, password: VALID_USER.password });
    const cookie = loginRes.headers['set-cookie'];

    await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    const reuseRes = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(reuseRes.status).toBe(401);
    expect(reuseRes.body.errorCode).toBe('AUTH_REFRESH_REUSE_DETECTED');
  });

  test('rejects a missing refresh cookie', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  test('clears the refresh cookie and revokes the session', async () => {
    await request(app).post('/api/auth/register').send(VALID_USER);
    const loginRes = await request(app).post('/api/auth/login').send({ email: VALID_USER.email, password: VALID_USER.password });
    const cookie = loginRes.headers['set-cookie'];

    const logoutRes = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(logoutRes.status).toBe(200);

    const refreshRes = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(refreshRes.status).toBe(401);
  });

  test('is idempotent — logging out without a session does not error', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
  });
});
