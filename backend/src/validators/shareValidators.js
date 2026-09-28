const { param, validationResult } = require('express-validator');
const AppError = require('../utils/AppError');

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new AppError(errors.array()[0].msg, 400, 'VALIDATION_ERROR'));
  }
  next();
}

// Matches the shape produced by tokens.js#generateShareToken (base64url —
// letters, digits, '-' and '_' only). Rejecting anything else before it
// reaches the database is defense-in-depth on top of the parameterized
// query — it also means a malformed/garbage link fails fast with a clear
// validation error instead of a generic "not found".
const shareTokenParamValidator = [
  param('shareToken')
    .isString()
    .isLength({ min: 16, max: 64 })
    .withMessage('Invalid share link')
    .matches(/^[A-Za-z0-9_-]+$/)
    .withMessage('Invalid share link'),
  handleValidation,
];

module.exports = { shareTokenParamValidator };
