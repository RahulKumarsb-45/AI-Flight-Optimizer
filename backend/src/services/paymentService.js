const axios = require('axios');
const crypto = require('crypto');
const config = require('../config/env');
const AppError = require('../utils/AppError');
const { query } = require('../database/pool');
const logger = require('../logger/logger');

// Prices are decided HERE, server-side, never trusted from the client —
// a client-supplied amount would be a textbook price-tampering vulnerability.
// Matches what's displayed on the pricing page (frontend/app/pricing/page.js).
const PLAN_PRICES_INR = {
  pro: 499,
  business: 1499,
};

const RAZORPAY_BASE_URL = 'https://api.razorpay.com/v1';

function razorpayAuthHeader() {
  if (!config.razorpay.keyId || !config.razorpay.keySecret) {
    throw new AppError(
      'Payments are not configured. Set RAZORPAY_KEY_ID/SECRET in .env.',
      500,
      'PAYMENTS_NOT_CONFIGURED'
    );
  }
  const token = Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

/**
 * Creates a Razorpay order for one billing cycle (30 days) of the given plan.
 * This is a SIMPLIFIED model — a genuine auto-renewing subscription would use
 * Razorpay's separate Subscriptions API with a pre-created Plan + a mandate
 * for recurring auto-charge, which needs webhook-driven renewal handling.
 * This project charges once per cycle and requires the user to pay again
 * when current_period_end passes — a deliberate scope simplification.
 */
async function createOrder({ userId, plan }) {
  if (!PLAN_PRICES_INR[plan]) {
    throw new AppError(`Unknown plan: ${plan}`, 400, 'INVALID_PLAN');
  }

  const amountInr = PLAN_PRICES_INR[plan];
  const amountPaise = amountInr * 100; // Razorpay amounts are in the smallest currency unit

  const response = await axios.post(
    `${RAZORPAY_BASE_URL}/orders`,
    {
      amount: amountPaise,
      currency: 'INR',
      receipt: `plan_${plan}_${userId}_${Date.now()}`,
      notes: { userId, plan },
    },
    { headers: razorpayAuthHeader() }
  );

  const order = response.data;

  await query(
    `INSERT INTO payment_transactions (user_id, razorpay_order_id, amount_inr, currency, status)
     VALUES ($1, $2, $3, 'INR', 'created')`,
    [userId, order.id, amountInr]
  );

  return {
    orderId: order.id,
    amountPaise,
    amountInr,
    currency: 'INR',
    plan,
    razorpayKeyId: config.razorpay.keyId, // safe to expose — it's the PUBLIC key half
  };
}

/**
 * Verifies the HMAC-SHA256 signature Razorpay's checkout returns after a
 * successful payment. This is the step that actually matters for security —
 * without it, anyone could call /verify with a fabricated payment_id and
 * get a free upgrade. The signature can only be produced by someone who
 * knows RAZORPAY_KEY_SECRET (Razorpay itself).
 */
function isValidSignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
  const expected = crypto
    .createHmac('sha256', config.razorpay.keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');
  return expected === razorpaySignature;
}

async function verifyAndCapturePayment({ userId, razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
  if (!isValidSignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature })) {
    await query(
      `UPDATE payment_transactions SET status = 'failed' WHERE razorpay_order_id = $1 AND user_id = $2`,
      [razorpayOrderId, userId]
    );
    logger.warn('Razorpay signature verification failed', { userId, razorpayOrderId });
    throw new AppError('Payment verification failed.', 400, 'PAYMENT_VERIFICATION_FAILED');
  }

  const txResult = await query(
    `SELECT id, amount_inr FROM payment_transactions WHERE razorpay_order_id = $1 AND user_id = $2`,
    [razorpayOrderId, userId]
  );
  if (txResult.rows.length === 0) {
    throw new AppError('No matching order found for this payment.', 404, 'PAYMENT_ORDER_NOT_FOUND');
  }
  const transaction = txResult.rows[0];

  // Look up the plan from Razorpay's own order notes (not our local state)
  // to avoid drift if PLAN_PRICES_INR ever changes between order-creation
  // and verification.
  const orderRes = await axios.get(`${RAZORPAY_BASE_URL}/orders/${razorpayOrderId}`, {
    headers: razorpayAuthHeader(),
  });
  const plan = orderRes.data.notes?.plan;
  if (!plan || !PLAN_PRICES_INR[plan]) {
    throw new AppError('Could not determine plan for this order.', 500, 'PAYMENT_PLAN_UNKNOWN');
  }

  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const subResult = await query(
    `INSERT INTO subscriptions (user_id, plan, billing_cycle, status, current_period_start, current_period_end)
     VALUES ($1, $2, 'monthly', 'active', $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET
       plan = EXCLUDED.plan,
       status = 'active',
       current_period_start = EXCLUDED.current_period_start,
       current_period_end = EXCLUDED.current_period_end,
       updated_at = now()
     RETURNING *`,
    [userId, plan, now, periodEnd]
  );

  await query(
    `UPDATE payment_transactions SET status = 'success', razorpay_payment_id = $1 WHERE id = $2`,
    [razorpayPaymentId, transaction.id]
  );

  logger.info('Payment verified and subscription activated', { userId, plan, razorpayPaymentId });

  return subResult.rows[0];
}

/**
 * Verifies a Razorpay webhook's signature. Uses a SEPARATE secret
 * (RAZORPAY_WEBHOOK_SECRET, configured when the webhook is set up in the
 * Razorpay dashboard) from the API key_secret — signed over the raw request
 * body, which is why app.js captures req.rawBody specifically for this.
 */
function isValidWebhookSignature(rawBody, signatureHeader) {
  if (!config.razorpay.webhookSecret || !signatureHeader) return false;
  const expected = crypto
    .createHmac('sha256', config.razorpay.webhookSecret)
    .update(rawBody)
    .digest('hex');
  return expected === signatureHeader;
}

/**
 * Defensive backup to the synchronous /verify call from checkout: if the
 * user's browser loses connection right after paying (before /verify runs),
 * this webhook independently activates the subscription once Razorpay
 * confirms the payment. Idempotent — safe to receive the same event twice.
 */
async function handleWebhookPaymentCaptured(payload) {
  const payment = payload.payload?.payment?.entity;
  if (!payment) return;

  const orderId = payment.order_id;
  const txResult = await query(`SELECT user_id FROM payment_transactions WHERE razorpay_order_id = $1`, [orderId]);
  if (txResult.rows.length === 0) {
    logger.warn('Webhook payment.captured for unknown order', { orderId });
    return;
  }
  const { user_id: userId } = txResult.rows[0];

  const existing = await query(`SELECT status FROM payment_transactions WHERE razorpay_order_id = $1`, [orderId]);
  if (existing.rows[0]?.status === 'success') {
    return; // already processed via the synchronous /verify path — no-op
  }

  const orderRes = await axios.get(`${RAZORPAY_BASE_URL}/orders/${orderId}`, { headers: razorpayAuthHeader() });
  const plan = orderRes.data.notes?.plan;
  if (!plan) return;

  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  await query(
    `INSERT INTO subscriptions (user_id, plan, billing_cycle, status, current_period_start, current_period_end)
     VALUES ($1, $2, 'monthly', 'active', $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET
       plan = EXCLUDED.plan, status = 'active',
       current_period_start = EXCLUDED.current_period_start,
       current_period_end = EXCLUDED.current_period_end,
       updated_at = now()`,
    [userId, plan, now, periodEnd]
  );
  await query(
    `UPDATE payment_transactions SET status = 'success', razorpay_payment_id = $1 WHERE razorpay_order_id = $2`,
    [payment.id, orderId]
  );

  logger.info('Subscription activated via webhook fallback', { userId, plan, orderId });
}

module.exports = {
  createOrder,
  verifyAndCapturePayment,
  isValidSignature,
  isValidWebhookSignature,
  handleWebhookPaymentCaptured,
  PLAN_PRICES_INR,
};
