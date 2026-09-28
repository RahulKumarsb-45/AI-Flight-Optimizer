const express = require('express');
const searchController = require('../controllers/searchController');
const { flightSearchValidator } = require('../validators/searchValidators');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/search/flights?origin=DEL&destination=LHR&departureDate=2026-08-10&adults=1
router.get('/flights', optionalAuth, flightSearchValidator, searchController.searchFlights);

module.exports = router;
