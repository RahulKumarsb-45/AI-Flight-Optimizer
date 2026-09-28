/**
 * Google OAuth integration tests.
 *
 * These exercise the REAL production code path end-to-end over HTTP:
 *   routes/authRoutes.js -> controllers/authController.js
 *     -> services/oauthService.js + services/authService.js -> real Postgres
 *
 * The only thing mocked is `axios`, which is the correct boundary: it's the
 * module oauthService.js uses to talk to Google's token + userinfo endpoints.
 * No real Google account, authorization code, or token is ever used —
 * `axios.post`/`axios.get` are jest mocks that stand in for Google's servers.
 *
 * The OAuth "state" param is a real signed JWT produced by the actual
 * utils/tokens.js#generateOAuthState, so verifyOAuthState() in production
 * code is genuinely exercised (not bypassed).
 */
const request = require('supertest');

jest.mock('axios');
const axios = require('axios');

const app = require('../../src/app');
const config = require('../../src/config/env');
const { resetDb, closeDb } = require('../helpers/db');
const { generateOAuthState } = require('../../src/utils/tokens');
const { query } = require('../../src/database/pool');

beforeEach(async () => {
  await resetDb();
  jest.clearAllMocks();
});

afterAll(async () => {
  await closeDb();
});

function mockGoogleSuccess({
  providerId = 'google-uid-123',
  email = 'newuser@gmail.com',
  name = 'New User',
  picture = 'https://example.com/pic.jpg',
  emailVerified = true,
} = {}) {
  axios.post.mockResolvedValueOnce({ data: { access_token: 'fake-google-access-token' } });
  axios.get.mockResolvedValueOnce({
    data: {
      sub: providerId,
      email,
      name,
      picture,
      email_verified: emailVerified,
    },
  });
}

describe('GET /api/auth/google — redirect-initiation', () => {
  test('redirects to Google\'s consent screen with the correct params when configured', async () => {
    const res = await request(app).get('/api/auth/google');

    expect(res.status).toBe(302);
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.get).not.toHaveBeenCalled();

    const location = new URL(res.headers.location);
    expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(location.searchParams.get('client_id')).toBe(config.oauth.google.clientId);
    expect(location.searchParams.get('redirect_uri')).toBe(config.oauth.google.callbackUrl);
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('scope')).toBe('openid email profile');
    expect(location.searchParams.get('access_type')).toBe('online');
    expect(location.searchParams.get('prompt')).toBe('select_account');

    // The state param must itself be a state this server will accept back.
    const state = location.searchParams.get('state');
    expect(state).toBeTruthy();
    const { verifyOAuthState } = require('../../src/utils/tokens');
    expect(verifyOAuthState(state)).toBe(true);
  });

  test('generates a fresh, unique state on every call (CSRF protection)', async () => {
    const first = await request(app).get('/api/auth/google');
    const second = await request(app).get('/api/auth/google');

    const firstState = new URL(first.headers.location).searchParams.get('state');
    const secondState = new URL(second.headers.location).searchParams.get('state');
    expect(firstState).not.toBe(secondState);
  });

  test('fails with OAUTH_NOT_CONFIGURED (not a silent/broken redirect) when GOOGLE_CLIENT_ID is unset', async () => {
    const originalClientId = config.oauth.google.clientId;
    config.oauth.google.clientId = undefined;

    try {
      const res = await request(app).get('/api/auth/google');
      expect(res.status).toBe(500);
      expect(res.body.errorCode).toBe('OAUTH_NOT_CONFIGURED');
    } finally {
      config.oauth.google.clientId = originalClientId;
    }
  });
});

describe('GET /api/auth/google/callback — valid OAuth flow', () => {
  test('exchanges the code, fetches the profile, creates a session, and redirects to the frontend', async () => {
    mockGoogleSuccess();
    const state = generateOAuthState();

    const res = await request(app)
      .get('/api/auth/google/callback')
      .query({ code: 'valid-auth-code', state });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${config.frontendUrl}/auth/callback`);
    expect(res.headers['set-cookie']?.[0]).toMatch(/refresh_token=/);

    // The code exchange and profile fetch actually happened, against Google's
    // real endpoints (mocked), with the code/token correctly threaded through.
    expect(axios.post).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({ code: 'valid-auth-code', grant_type: 'authorization_code' })
    );
    expect(axios.get).toHaveBeenCalledWith(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      expect.objectContaining({ headers: { Authorization: 'Bearer fake-google-access-token' } })
    );
  });
});

describe('GET /api/auth/google/callback — new user', () => {
  test('creates a new user + free subscription + preferences row on first login', async () => {
    mockGoogleSuccess({ providerId: 'google-new-1', email: 'brandnew@gmail.com' });
    const state = generateOAuthState();

    const res = await request(app)
      .get('/api/auth/google/callback')
      .query({ code: 'valid-auth-code', state });

    expect(res.status).toBe(302);

    const userResult = await query(
      `SELECT id, auth_provider, provider_id, email, email_verified FROM users WHERE email = $1`,
      ['brandnew@gmail.com']
    );
    expect(userResult.rows).toHaveLength(1);
    expect(userResult.rows[0].auth_provider).toBe('google');
    expect(userResult.rows[0].provider_id).toBe('google-new-1');
    expect(userResult.rows[0].email_verified).toBe(true);

    const subResult = await query(
      `SELECT plan, status FROM subscriptions WHERE user_id = $1`,
      [userResult.rows[0].id]
    );
    expect(subResult.rows[0]).toEqual({ plan: 'free', status: 'active' });

    const prefsResult = await query(`SELECT user_id FROM user_preferences WHERE user_id = $1`, [
      userResult.rows[0].id,
    ]);
    expect(prefsResult.rows).toHaveLength(1);
  });
});

describe('GET /api/auth/google/callback — existing user', () => {
  test('logs the same user back in on a second visit instead of creating a duplicate', async () => {
    const providerId = 'google-existing-1';
    const email = 'returning@gmail.com';

    mockGoogleSuccess({ providerId, email });
    const firstRes = await request(app)
      .get('/api/auth/google/callback')
      .query({ code: 'code-1', state: generateOAuthState() });
    expect(firstRes.status).toBe(302);

    mockGoogleSuccess({ providerId, email });
    const secondRes = await request(app)
      .get('/api/auth/google/callback')
      .query({ code: 'code-2', state: generateOAuthState() });
    expect(secondRes.status).toBe(302);
    expect(secondRes.headers['set-cookie']?.[0]).toMatch(/refresh_token=/);

    const userResult = await query(`SELECT id FROM users WHERE auth_provider = 'google' AND provider_id = $1`, [
      providerId,
    ]);
    expect(userResult.rows).toHaveLength(1); // no duplicate account created

    const subResult = await query(`SELECT count(*)::int AS count FROM subscriptions WHERE user_id = $1`, [
      userResult.rows[0].id,
    ]);
    expect(subResult.rows[0].count).toBe(1); // subscription wasn't re-created either
  });
});

describe('GET /api/auth/google/callback — invalid/missing token', () => {
  test('redirects to oauth_failed and creates no user when Google rejects the authorization code', async () => {
    axios.post.mockRejectedValueOnce(new Error('invalid_grant: code was already redeemed'));
    const state = generateOAuthState();

    const res = await request(app)
      .get('/api/auth/google/callback')
      .query({ code: 'expired-or-reused-code', state });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${config.frontendUrl}/login?error=oauth_failed`);
    expect(res.headers['set-cookie']).toBeUndefined();

    // The failed exchange means the userinfo endpoint should never be reached.
    expect(axios.get).not.toHaveBeenCalled();

    const userResult = await query('SELECT count(*)::int AS count FROM users');
    expect(userResult.rows[0].count).toBe(0);
  });

  test('redirects to oauth_failed when Google returns a response with no access_token', async () => {
    axios.post.mockResolvedValueOnce({ data: {} }); // token missing entirely
    axios.get.mockRejectedValueOnce(new Error('Request failed with status code 401'));
    const state = generateOAuthState();

    const res = await request(app)
      .get('/api/auth/google/callback')
      .query({ code: 'some-code', state });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${config.frontendUrl}/login?error=oauth_failed`);

    const userResult = await query('SELECT count(*)::int AS count FROM users');
    expect(userResult.rows[0].count).toBe(0);
  });
});

describe('GET /api/auth/google/callback — authentication failure', () => {
  test('rejects a missing state param without ever calling Google', async () => {
    const res = await request(app).get('/api/auth/google/callback').query({ code: 'some-code' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${config.frontendUrl}/login?error=oauth_invalid_state`);
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('rejects a forged/invalid state token without ever calling Google', async () => {
    const res = await request(app)
      .get('/api/auth/google/callback')
      .query({ code: 'some-code', state: 'not-a-real-signed-jwt' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${config.frontendUrl}/login?error=oauth_invalid_state`);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('redirects to oauth_denied when the user declines consent on Google\'s screen', async () => {
    const res = await request(app)
      .get('/api/auth/google/callback')
      .query({ error: 'access_denied', state: generateOAuthState() });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${config.frontendUrl}/login?error=oauth_denied`);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('does not silently link to an existing local (password) account with the same email', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Local User', email: 'shared@example.com', password: 'Password123' });

    mockGoogleSuccess({ providerId: 'google-collision-1', email: 'shared@example.com' });
    const res = await request(app)
      .get('/api/auth/google/callback')
      .query({ code: 'some-code', state: generateOAuthState() });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${config.frontendUrl}/login?error=oauth_failed`);
    expect(res.headers['set-cookie']).toBeUndefined();

    const userResult = await query('SELECT count(*)::int AS count FROM users WHERE email = $1', [
      'shared@example.com',
    ]);
    expect(userResult.rows[0].count).toBe(1); // still just the original local account
  });
});
