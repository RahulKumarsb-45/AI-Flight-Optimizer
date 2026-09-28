const { query, param, validationResult } = require('express-validator');
const AppError = require('../utils/AppError');

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const firstError = errors.array()[0];
    return next(new AppError(firstError.msg, 400, 'VALIDATION_ERROR'));
  }
  next();
}

const searchAirportsValidator = [
  query('q').optional().isString().trim().isLength({ max: 100 }),
  query('limit').optional().isInt({ min: 1, max: 25 }).withMessage('limit must be between 1 and 25'),
  handleValidation,
];

const iataParamValidator = [
  param('iataCode').isLength({ min: 3, max: 3 }).withMessage('IATA code must be exactly 3 letters').isAlpha(),
  handleValidation,
];

const nearbyValidator = [
  param('iataCode').isLength({ min: 3, max: 3 }).withMessage('IATA code must be exactly 3 letters').isAlpha(),
  query('limit').optional().isInt({ min: 1, max: 10 }).withMessage('limit must be between 1 and 10'),
  query('maxDistanceKm').optional().isInt({ min: 10, max: 1000 }),
  handleValidation,
];

module.exports = { searchAirportsValidator, iataParamValidator, nearbyValidator, handleValidation };
