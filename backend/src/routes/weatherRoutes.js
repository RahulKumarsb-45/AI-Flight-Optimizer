const express = require('express');
const weatherController = require('../controllers/weatherController');
const { iataParamValidator, seasonValidator } = require('../validators/weatherValidators');

const router = express.Router();

// No auth required — weather is free-tier, low-cost, and useful to guests browsing search results.
router.get('/:iataCode/current', iataParamValidator, weatherController.getCurrent);
router.get('/:iataCode/forecast', iataParamValidator, weatherController.getForecast);
router.get('/:iataCode/season', seasonValidator, weatherController.getSeason);

module.exports = router;
