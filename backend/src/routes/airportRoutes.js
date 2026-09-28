const express = require('express');
const airportController = require('../controllers/airportController');
const {
  searchAirportsValidator,
  iataParamValidator,
  nearbyValidator,
} = require('../validators/airportValidators');

const router = express.Router();

// GET /api/airports?q=lon&limit=8      -> autocomplete search
router.get('/', searchAirportsValidator, airportController.searchAirports);

// GET /api/airports/regions            -> list of all regions
router.get('/regions', airportController.listRegions);

// GET /api/airports/:iataCode          -> single airport detail
router.get('/:iataCode', iataParamValidator, airportController.getAirportByCode);

// GET /api/airports/:iataCode/nearby   -> nearby airport expansion
router.get('/:iataCode/nearby', nearbyValidator, airportController.getNearbyAirports);

module.exports = router;
