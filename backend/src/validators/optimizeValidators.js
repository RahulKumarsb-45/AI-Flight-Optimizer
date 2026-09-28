const { body, validationResult } = require('express-validator');
const AppError = require('../utils/AppError');
const airportService = require('../providers/airport/airportService');
const config = require('../config/env');

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new AppError(errors.array()[0].msg, 400, 'VALIDATION_ERROR'));
  }
  next();
}

const optimizeTripValidator = [
  body('originIata')
    .isLength({ min: 3, max: 3 }).isAlpha()
    // express-validator awaits a Promise-returning custom validator, so this
    // can resolve through the full local -> externalAirportCache -> live
    // Ignav lookup chain (airportService.resolveByIata) instead of
    // getByIata(), which only ever checks the local 113-airport dataset.
    // getByIata() would reject a perfectly valid Ignav-only origin (Ignav is
    // the primary airport source) before the request ever reaches the
    // optimizer. A code unknown to local data, the cache, AND a live Ignav
    // lookup still fails validation here exactly as before.
    .custom(async (v) => {
      try {
        await airportService.resolveByIata(v);
      } catch (err) {
        throw new Error(`Unknown origin airport: ${v}`);
      }
      return true;
    }),
  body('destinationCountries')
    .isArray({ min: 1, max: config.optimizer.maxCountriesPerTrip })
    .withMessage(`destinationCountries must be an array of 1-${config.optimizer.maxCountriesPerTrip} ISO country codes`),
  body('destinationCountries.*').isLength({ min: 2, max: 2 }).isAlpha(),
  body('departureDate').isISO8601().withMessage('departureDate must be YYYY-MM-DD'),
  body('returnDate').optional().isISO8601(),
  body('dateFlexible').optional().isBoolean(),
  body('minStayDays').optional().isInt({ min: 1, max: 60 }),
  body('maxStayDays').optional().isInt({ min: 1, max: 60 }),
  body('maxStayDays').custom((value, { req }) => {
    if (req.body.minStayDays != null && value != null && Number(req.body.minStayDays) > Number(value)) {
      throw new Error('minStayDays cannot be greater than maxStayDays');
    }
    return true;
  }),
  body('travelers').optional().isInt({ min: 1, max: 9 }),
  body('budgetInr').optional().isFloat({ min: 1000 }),
  body('preference').optional().isIn(['cheapest', 'fastest', 'balanced']),
  body('nearbyAirportsEnabled').optional().isBoolean(),
  body('cabinClass').optional().isIn(['economy', 'premium_economy', 'business', 'first']),
  handleValidation,
];

module.exports = { optimizeTripValidator, handleValidation };
