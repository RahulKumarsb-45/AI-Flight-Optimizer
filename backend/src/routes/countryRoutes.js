const express = require('express');
const { param, validationResult } = require('express-validator');
const airportController = require('../controllers/airportController');
const countryController = require('../controllers/countryController');
const AppError = require('../utils/AppError');

const router = express.Router();

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new AppError(errors.array()[0].msg, 400, 'VALIDATION_ERROR'));
  }
  next();
}

// GET /api/countries               -> list all countries (country master dataset,
//                                      independent of curated airport coverage)
router.get('/', countryController.listCountries);

// GET /api/countries/:countryCode/airports  -> airports in a country, ranked
router.get(
  '/:countryCode/airports',
  [param('countryCode').isLength({ min: 2, max: 2 }).isAlpha(), handleValidation],
  airportController.expandCountry
);

module.exports = router;
