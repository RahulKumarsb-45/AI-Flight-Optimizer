const { param, query, validationResult } = require('express-validator');
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

const seasonValidator = [
  param('iataCode').isLength({ min: 3, max: 3 }).isAlpha(),
  query('month').optional().isInt({ min: 1, max: 12 }).withMessage('month must be 1-12'),
  handleValidation,
];

module.exports = { iataParamValidator, seasonValidator };
