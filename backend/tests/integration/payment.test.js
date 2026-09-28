/**
 * Razorpay integration tests.
 *
 * These exercise the REAL production code path end-to-end over HTTP:
 *   routes/paymentRoutes.js -> controllers/paymentController.js
 *     -> services/paymentService.js -> real Postgres
 *
 * The only thing mocked is `axios`, which is the correct boundary: it's the
 * module paymentService.js uses to talk to Razorpay's Orders API. No real
 * Razorpay key, order, or payment is ever used — `axios.post`/`axios.get`
 * are jest mocks standing in for Razorpay's servers. Signatures are computed
 * with the same HMAC the production code uses, over the dummy
 * RAZORPAY_KEY_SECRET configured in tests/.env.test (see .env.test.example),
 * never a real secret.
 */
const request = require('supertest');
const crypto = require('crypto');

jest.mock('axios');
const axios = require('axios');

const app = require('../../src/app');
const config = require('../../src/config/env');
const { resetDb, closeDb } = require('../helpers/db');
const { query } = require('../../src/database/pool');
const { PLAN_PRICES_INR } = require('../../src/services/paymentService');

const VALID_USER = { name: 'Payer', email: 'payer@example.com', password: 'Password123' };

let accessToken;
let userId;

beforeEach(async () => {
  await resetDb();
  jest.clearAllMocks();

  const registerRes = await request(app).post('/api/auth/register').send(VALID_USER);
  userId = registerRes.body.data.user.id;
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: VALID_USER.email, password: VALID_USER.password });
  accessToken = loginRes.body.data.accessToken;
});

afterAll(async () => {
  await closeDb();
});

function authed(req) {
  return req.set('Authorization', `Bearer ${accessToken}`);
}

function computeSignature(razorpayOrderId, razorpayPaymentId) {
  return crypto
    .createHmac('sha256', config.razorpay.keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');
}

// Webhook signatures are computed over the RAW request body (see app.js's
// express.json({ verify }) capturing req.rawBody), not a derived string like
// the /verify endpoint's signature. supertest's `.send(payload)` serializes
// the object with JSON.stringify(payload) as the actual bytes sent, so
// signing that same JSON.stringify output reproduces what production code
// (which HMACs req.rawBody) will actually see.
function computeWebhookSignature(payload) {
  return crypto
    .createHmac('sha256', config.razorpay.webhookSecret)
    .update(JSON.stringify(payload))
    .digest('hex');
}

function paymentCapturedPayload({ orderId, paymentId, amountPaise = PLAN_PRICES_INR.pro * 100 }) {
  return {
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: paymentId,
          order_id: orderId,
          amount: amountPaise,
          status: 'captured',
        },
      },
    },
  };
}

describe('POST /api/payments/create-order — order creation success', () => {
  test('creates a Razorpay order for a valid plan and records a "created" transaction', async () => {
    axios.post.mockResolvedValueOnce({ data: { id: 'order_fake_123', status: 'created' } });

    const res = await authed(request(app).post('/api/payments/create-order')).send({ plan: 'pro' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      orderId: 'order_fake_123',
      amountInr: PLAN_PRICES_INR.pro,
      amountPaise: PLAN_PRICES_INR.pro * 100,
      currency: 'INR',
      plan: 'pro',
      razorpayKeyId: config.razorpay.keyId,
    });

    // Price came from the server-side price table, not anything the client sent.
    expect(axios.post).toHaveBeenCalledWith(
      'https://api.razorpay.com/v1/orders',
      expect.objectContaining({ amount: PLAN_PRICES_INR.pro * 100, currency: 'INR' }),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.stringMatching(/^Basic /) }) })
    );

    const txResult = await query(
      `SELECT user_id, razorpay_order_id, amount_inr, status FROM payment_transactions WHERE razorpay_order_id = $1`,
      ['order_fake_123']
    );
    expect(txResult.rows[0]).toMatchObject({
      user_id: userId,
      razorpay_order_id: 'order_fake_123',
      status: 'created',
    });
    expect(Number(txResult.rows[0].amount_inr)).toBe(PLAN_PRICES_INR.pro);
  });

  test('supports the business plan at its own price point', async () => {
    axios.post.mockResolvedValueOnce({ data: { id: 'order_fake_biz', status: 'created' } });

    const res = await authed(request(app).post('/api/payments/create-order')).send({ plan: 'business' });

    expect(res.status).toBe(201);
    expect(res.body.data.amountInr).toBe(PLAN_PRICES_INR.business);
    expect(res.body.data.amountPaise).toBe(PLAN_PRICES_INR.business * 100);
  });

  test('requires authentication', async () => {
    const res = await request(app).post('/api/payments/create-order').send({ plan: 'pro' });
    expect(res.status).toBe(401);
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('POST /api/payments/create-order — invalid request', () => {
  test('rejects an unknown plan with a validation error and never calls Razorpay', async () => {
    const res = await authed(request(app).post('/api/payments/create-order')).send({ plan: 'ultra-deluxe' });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    expect(axios.post).not.toHaveBeenCalled();

    const txResult = await query('SELECT count(*)::int AS count FROM payment_transactions');
    expect(txResult.rows[0].count).toBe(0);
  });

  test('rejects a missing plan field', async () => {
    const res = await authed(request(app).post('/api/payments/create-order')).send({});
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('POST /api/payments/verify — payment verification', () => {
  async function seedCreatedOrder(razorpayOrderId, plan = 'pro') {
    await query(
      `INSERT INTO payment_transactions (user_id, razorpay_order_id, amount_inr, currency, status)
       VALUES ($1, $2, $3, 'INR', 'created')`,
      [userId, razorpayOrderId, PLAN_PRICES_INR[plan]]
    );
  }

  test('activates the subscription on a correctly signed payment', async () => {
    await seedCreatedOrder('order_verify_1', 'pro');
    axios.get.mockResolvedValueOnce({ data: { notes: { plan: 'pro', userId } } });

    const signature = computeSignature('order_verify_1', 'pay_verify_1');
    const res = await authed(request(app).post('/api/payments/verify')).send({
      razorpayOrderId: 'order_verify_1',
      razorpayPaymentId: 'pay_verify_1',
      razorpaySignature: signature,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.subscription).toMatchObject({ plan: 'pro', status: 'active' });

    const subResult = await query(`SELECT plan, status FROM subscriptions WHERE user_id = $1`, [userId]);
    expect(subResult.rows[0]).toMatchObject({ plan: 'pro', status: 'active' });

    const txResult = await query(
      `SELECT status, razorpay_payment_id FROM payment_transactions WHERE razorpay_order_id = $1`,
      ['order_verify_1']
    );
    expect(txResult.rows[0]).toMatchObject({ status: 'success', razorpay_payment_id: 'pay_verify_1' });
  });

  test('404s when verifying a payment for an order that was never created', async () => {
    const signature = computeSignature('order_never_created', 'pay_x');
    const res = await authed(request(app).post('/api/payments/verify')).send({
      razorpayOrderId: 'order_never_created',
      razorpayPaymentId: 'pay_x',
      razorpaySignature: signature,
    });

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('PAYMENT_ORDER_NOT_FOUND');
  });
});

describe('POST /api/payments/verify — invalid signature', () => {
  test('rejects a forged signature, marks the transaction failed, and never looks up the order on Razorpay', async () => {
    await query(
      `INSERT INTO payment_transactions (user_id, razorpay_order_id, amount_inr, currency, status)
       VALUES ($1, 'order_bad_sig', $2, 'INR', 'created')`,
      [userId, PLAN_PRICES_INR.pro]
    );

    const res = await authed(request(app).post('/api/payments/verify')).send({
      razorpayOrderId: 'order_bad_sig',
      razorpayPaymentId: 'pay_bad_sig',
      razorpaySignature: 'not-the-real-hmac-signature',
    });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('PAYMENT_VERIFICATION_FAILED');

    // Signature check fails fast, before ever calling out to Razorpay again.
    expect(axios.get).not.toHaveBeenCalled();

    const txResult = await query(`SELECT status FROM payment_transactions WHERE razorpay_order_id = $1`, [
      'order_bad_sig',
    ]);
    expect(txResult.rows[0].status).toBe('failed');

    // Registration already creates a default free-tier subscription row —
    // the point here is that the failed verification did NOT upgrade it.
    const subResult = await query(`SELECT plan, status FROM subscriptions WHERE user_id = $1`, [userId]);
    expect(subResult.rows[0]).toMatchObject({ plan: 'free', status: 'active' });
  });

  test('rejects a signature computed with the wrong payment id (mismatched payload)', async () => {
    await query(
      `INSERT INTO payment_transactions (user_id, razorpay_order_id, amount_inr, currency, status)
       VALUES ($1, 'order_mismatch', $2, 'INR', 'created')`,
      [userId, PLAN_PRICES_INR.pro]
    );
    const signatureForADifferentPaymentId = computeSignature('order_mismatch', 'pay_the_attacker_actually_paid_for');

    const res = await authed(request(app).post('/api/payments/verify')).send({
      razorpayOrderId: 'order_mismatch',
      razorpayPaymentId: 'pay_something_else',
      razorpaySignature: signatureForADifferentPaymentId,
    });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('PAYMENT_VERIFICATION_FAILED');
  });
});

describe('Razorpay failure/error handling', () => {
  test('create-order surfaces a 500 and stores no transaction row when Razorpay is unreachable', async () => {
    axios.post.mockRejectedValueOnce(new Error('connect ETIMEDOUT api.razorpay.com'));

    const res = await authed(request(app).post('/api/payments/create-order')).send({ plan: 'pro' });

    expect(res.status).toBe(500);
    expect(res.body.status).toBe('error');

    const txResult = await query('SELECT count(*)::int AS count FROM payment_transactions');
    expect(txResult.rows[0].count).toBe(0); // no partial/orphaned row on failure
  });

  test('verify surfaces a 500 when the post-signature order lookup fails, without activating a subscription', async () => {
    await query(
      `INSERT INTO payment_transactions (user_id, razorpay_order_id, amount_inr, currency, status)
       VALUES ($1, 'order_lookup_fails', $2, 'INR', 'created')`,
      [userId, PLAN_PRICES_INR.pro]
    );
    axios.get.mockRejectedValueOnce(new Error('connect ETIMEDOUT api.razorpay.com'));
    const signature = computeSignature('order_lookup_fails', 'pay_lookup_fails');

    const res = await authed(request(app).post('/api/payments/verify')).send({
      razorpayOrderId: 'order_lookup_fails',
      razorpayPaymentId: 'pay_lookup_fails',
      razorpaySignature: signature,
    });

    expect(res.status).toBe(500);

    const subResult = await query(`SELECT plan, status FROM subscriptions WHERE user_id = $1`, [userId]);
    expect(subResult.rows[0]).toMatchObject({ plan: 'free', status: 'active' }); // never upgraded
  });

  test('create-order fails closed when Razorpay credentials are not configured', async () => {
    const originalKeyId = config.razorpay.keyId;
    const originalKeySecret = config.razorpay.keySecret;
    config.razorpay.keyId = undefined;
    config.razorpay.keySecret = undefined;

    try {
      const res = await authed(request(app).post('/api/payments/create-order')).send({ plan: 'pro' });
      expect(res.status).toBe(500);
      expect(res.body.errorCode).toBe('PAYMENTS_NOT_CONFIGURED');
      expect(axios.post).not.toHaveBeenCalled();
    } finally {
      config.razorpay.keyId = originalKeyId;
      config.razorpay.keySecret = originalKeySecret;
    }
  });
});

describe('Razorpay — no secret leakage', () => {
  test('create-order response exposes only the public key id, never the key secret', async () => {
    axios.post.mockResolvedValueOnce({ data: { id: 'order_secret_check', status: 'created' } });

    const res = await authed(request(app).post('/api/payments/create-order')).send({ plan: 'pro' });

    const bodyAsString = JSON.stringify(res.body);
    expect(bodyAsString).not.toContain(config.razorpay.keySecret);
    expect(res.body.data.razorpayKeyId).toBe(config.razorpay.keyId);
  });

  test('verify response and error responses never include the key secret or webhook secret', async () => {
    await query(
      `INSERT INTO payment_transactions (user_id, razorpay_order_id, amount_inr, currency, status)
       VALUES ($1, 'order_secret_check_2', $2, 'INR', 'created')`,
      [userId, PLAN_PRICES_INR.pro]
    );

    const badRes = await authed(request(app).post('/api/payments/verify')).send({
      razorpayOrderId: 'order_secret_check_2',
      razorpayPaymentId: 'pay_x',
      razorpaySignature: 'nope',
    });
    expect(JSON.stringify(badRes.body)).not.toContain(config.razorpay.keySecret);
    expect(JSON.stringify(badRes.body)).not.toContain(config.razorpay.webhookSecret);

    axios.get.mockResolvedValueOnce({ data: { notes: { plan: 'pro', userId } } });
    const signature = computeSignature('order_secret_check_2', 'pay_ok');
    const okRes = await authed(request(app).post('/api/payments/verify')).send({
      razorpayOrderId: 'order_secret_check_2',
      razorpayPaymentId: 'pay_ok',
      razorpaySignature: signature,
    });
    expect(JSON.stringify(okRes.body)).not.toContain(config.razorpay.keySecret);
    expect(JSON.stringify(okRes.body)).not.toContain(config.razorpay.webhookSecret);
  });
});

describe('POST /api/payments/webhook — signature-based, no auth', () => {
  test('is reachable without a Bearer token (Razorpay\'s servers call it, not a logged-in browser)', async () => {
    const payload = paymentCapturedPayload({ orderId: 'order_wh_noauth', paymentId: 'pay_wh_noauth' });
    const signature = computeWebhookSignature(payload);

    // No .set('Authorization', ...) at all — requireAuth is intentionally not on this route.
    const res = await request(app)
      .post('/api/payments/webhook')
      .set('x-razorpay-signature', signature)
      .send(payload);

    expect(res.status).toBe(200);
  });

  test('activates the subscription for a valid payment.captured event with a valid signature', async () => {
    await query(
      `INSERT INTO payment_transactions (user_id, razorpay_order_id, amount_inr, currency, status)
       VALUES ($1, 'order_wh_valid', $2, 'INR', 'created')`,
      [userId, PLAN_PRICES_INR.pro]
    );
    axios.get.mockResolvedValueOnce({ data: { notes: { plan: 'pro', userId } } });

    const payload = paymentCapturedPayload({ orderId: 'order_wh_valid', paymentId: 'pay_wh_valid' });
    const signature = computeWebhookSignature(payload);

    const res = await request(app)
      .post('/api/payments/webhook')
      .set('x-razorpay-signature', signature)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'success' });

    const subResult = await query(`SELECT plan, status FROM subscriptions WHERE user_id = $1`, [userId]);
    expect(subResult.rows[0]).toMatchObject({ plan: 'pro', status: 'active' });

    const txResult = await query(
      `SELECT status, razorpay_payment_id FROM payment_transactions WHERE razorpay_order_id = $1`,
      ['order_wh_valid']
    );
    expect(txResult.rows[0]).toMatchObject({ status: 'success', razorpay_payment_id: 'pay_wh_valid' });
  });

  test('rejects a forged/incorrect webhook signature with 400 and does no processing', async () => {
    await query(
      `INSERT INTO payment_transactions (user_id, razorpay_order_id, amount_inr, currency, status)
       VALUES ($1, 'order_wh_bad_sig', $2, 'INR', 'created')`,
      [userId, PLAN_PRICES_INR.pro]
    );
    const payload = paymentCapturedPayload({ orderId: 'order_wh_bad_sig', paymentId: 'pay_wh_bad_sig' });

    const res = await request(app)
      .post('/api/payments/webhook')
      .set('x-razorpay-signature', 'not-the-real-signature')
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ status: 'error', message: 'Invalid signature' });
    expect(axios.get).not.toHaveBeenCalled();

    const txResult = await query(`SELECT status FROM payment_transactions WHERE razorpay_order_id = $1`, [
      'order_wh_bad_sig',
    ]);
    expect(txResult.rows[0].status).toBe('created'); // untouched — never processed
  });

  test('rejects a request with no signature header at all', async () => {
    const payload = paymentCapturedPayload({ orderId: 'order_wh_missing_sig', paymentId: 'pay_x' });

    const res = await request(app).post('/api/payments/webhook').send(payload); // no x-razorpay-signature header

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ status: 'error', message: 'Invalid signature' });
  });

  test('is idempotent: replaying the same event after /verify already succeeded is a safe no-op', async () => {
    await query(
      `INSERT INTO payment_transactions (user_id, razorpay_order_id, amount_inr, currency, status, razorpay_payment_id)
       VALUES ($1, 'order_wh_idempotent', $2, 'INR', 'success', 'pay_wh_idempotent')`,
      [userId, PLAN_PRICES_INR.pro]
    );

    const payload = paymentCapturedPayload({ orderId: 'order_wh_idempotent', paymentId: 'pay_wh_idempotent' });
    const signature = computeWebhookSignature(payload);

    const res = await request(app)
      .post('/api/payments/webhook')
      .set('x-razorpay-signature', signature)
      .send(payload);

    expect(res.status).toBe(200);
    // Already-processed transactions short-circuit before ever calling Razorpay again.
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('acknowledges 200 for an unknown/unmatched order without throwing', async () => {
    const payload = paymentCapturedPayload({ orderId: 'order_never_seen_by_us', paymentId: 'pay_x' });
    const signature = computeWebhookSignature(payload);

    const res = await request(app)
      .post('/api/payments/webhook')
      .set('x-razorpay-signature', signature)
      .send(payload);

    expect(res.status).toBe(200);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('ignores non-"payment.captured" events but still acknowledges with 200', async () => {
    const payload = { event: 'payment.failed', payload: { payment: { entity: { id: 'pay_x' } } } };
    const signature = computeWebhookSignature(payload);

    const res = await request(app)
      .post('/api/payments/webhook')
      .set('x-razorpay-signature', signature)
      .send(payload);

    expect(res.status).toBe(200);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('still responds 200 (so Razorpay does not retry) even if internal processing throws after a valid signature', async () => {
    await query(
      `INSERT INTO payment_transactions (user_id, razorpay_order_id, amount_inr, currency, status)
       VALUES ($1, 'order_wh_proc_fails', $2, 'INR', 'created')`,
      [userId, PLAN_PRICES_INR.pro]
    );
    axios.get.mockRejectedValueOnce(new Error('connect ETIMEDOUT api.razorpay.com'));

    const payload = paymentCapturedPayload({ orderId: 'order_wh_proc_fails', paymentId: 'pay_wh_proc_fails' });
    const signature = computeWebhookSignature(payload);

    const res = await request(app)
      .post('/api/payments/webhook')
      .set('x-razorpay-signature', signature)
      .send(payload);

    expect(res.status).toBe(200); // signature was valid; processing failure is logged, not surfaced as an error
    const subResult = await query(`SELECT plan FROM subscriptions WHERE user_id = $1`, [userId]);
    expect(subResult.rows[0].plan).toBe('free'); // never actually activated
  });

  test('never leaks the webhook secret or key secret in any webhook response', async () => {
    const payload = paymentCapturedPayload({ orderId: 'order_wh_secret_check', paymentId: 'pay_x' });

    const badRes = await request(app)
      .post('/api/payments/webhook')
      .set('x-razorpay-signature', 'wrong')
      .send(payload);
    expect(JSON.stringify(badRes.body)).not.toContain(config.razorpay.webhookSecret);
    expect(JSON.stringify(badRes.body)).not.toContain(config.razorpay.keySecret);

    const signature = computeWebhookSignature(payload);
    const okRes = await request(app)
      .post('/api/payments/webhook')
      .set('x-razorpay-signature', signature)
      .send(payload);
    expect(JSON.stringify(okRes.body)).not.toContain(config.razorpay.webhookSecret);
    expect(JSON.stringify(okRes.body)).not.toContain(config.razorpay.keySecret);
  });
});
