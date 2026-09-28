const express = require('express');
const paymentController = require('../controllers/paymentController');
const { createOrderValidator, verifyPaymentValidator } = require('../validators/paymentValidators');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/create-order', requireAuth, createOrderValidator, paymentController.createOrder);
router.post('/verify', requireAuth, verifyPaymentValidator, paymentController.verifyPayment);

// No requireAuth — Razorpay's servers call this, authenticated via signature instead.
router.post('/webhook', paymentController.webhook);

module.exports = router;
