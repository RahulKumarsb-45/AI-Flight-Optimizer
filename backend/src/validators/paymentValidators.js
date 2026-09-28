const { body, validationResult } = require('express-validator');
const AppError = require('../utils/AppError');

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new AppError(errors.array()[0].msg, 400, 'VALIDATION_ERROR'));
  }
  next();
}

const createOrderValidator = [
  body('plan').isIn(['pro', 'business']).withMessage('plan must be "pro" or "business"'),
  handleValidation,
];

const verifyPaymentValidator = [
  body('razorpayOrderId').isString().notEmpty(),
  body('razorpayPaymentId').isString().notEmpty(),
  body('razorpaySignature').isString().notEmpty(),
  handleValidation,
];

module.exports = { createOrderValidator, verifyPaymentValidator };
