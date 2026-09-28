const { param, validationResult } = require('express-validator');
const AppError = require('../utils/AppError');

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new AppError(errors.array()[0].msg, 400, 'VALIDATION_ERROR'));
  }
  next();
}

const iataParamValidator = [
  param('iataCode').isLength({ min: 3, max: 3 }).isAlpha().withMessage('IATA code must be exactly 3 letters'),
  handleValidation,
];

module.exports = { iataParamValidator };
