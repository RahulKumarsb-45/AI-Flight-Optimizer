const { query, validationResult } = require('express-validator');
const AppError = require('../utils/AppError');
const airportService = require('../providers/airport/airportService');

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new AppError(errors.array()[0].msg, 400, 'VALIDATION_ERROR'));
  }
  next();
}

function isValidIata(value) {
  return !!airportService.getByIata(value);
}

const flightSearchValidator = [
  query('origin').isLength({ min: 3, max: 3 }).isAlpha().custom((v) => {
    if (!isValidIata(v)) throw new Error(`Unknown origin airport: ${v}`);
    return true;
  }),
  query('destination').isLength({ min: 3, max: 3 }).isAlpha().custom((v) => {
    if (!isValidIata(v)) throw new Error(`Unknown destination airport: ${v}`);
    return true;
  }),
  query('departureDate').isISO8601().withMessage('departureDate must be YYYY-MM-DD').custom((v) => {
    if (new Date(v) < new Date(new Date().toDateString())) {
      throw new Error('departureDate cannot be in the past');
    }
    return true;
  }),
  query('returnDate').optional().isISO8601().withMessage('returnDate must be YYYY-MM-DD'),
  query('adults').optional().isInt({ min: 1, max: 9 }).withMessage('adults must be between 1 and 9'),
  query('cabinClass').optional().isIn(['economy', 'premium_economy', 'business', 'first']),
  handleValidation,
];

module.exports = { flightSearchValidator, handleValidation };
