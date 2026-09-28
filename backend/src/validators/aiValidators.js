const { body, param, validationResult } = require('express-validator');
const AppError = require('../utils/AppError');

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new AppError(errors.array()[0].msg, 400, 'VALIDATION_ERROR'));
  }
  next();
}

const chatValidator = [
  body('message').isString().trim().isLength({ min: 1, max: 1000 }).withMessage('message must be 1-1000 characters'),
  body('conversationId').optional().isUUID().withMessage('conversationId must be a valid UUID'),
  handleValidation,
];

const conversationIdParamValidator = [
  param('conversationId').isUUID(),
  handleValidation,
];

module.exports = { chatValidator, conversationIdParamValidator };
