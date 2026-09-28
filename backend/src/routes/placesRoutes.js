const express = require('express');
const placesController = require('../controllers/placesController');
const { iataParamValidator } = require('../validators/placesValidators');

const router = express.Router();

router.get('/photo', placesController.getPhoto);
router.get('/:iataCode/hotels', iataParamValidator, placesController.getHotels);
router.get('/:iataCode/restaurants', iataParamValidator, placesController.getRestaurants);
router.get('/:iataCode/attractions', iataParamValidator, placesController.getAttractions);

module.exports = router;
