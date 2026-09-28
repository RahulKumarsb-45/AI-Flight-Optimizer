const placesService = require('../services/placesService');
const airportService = require('../providers/airport/airportService');
const AppError = require('../utils/AppError');

async function getHotels(req, res, next) {
  try {
    const airport = airportService.requireByIata(req.params.iataCode);
    const hotels = await placesService.getNearbyHotels({ lat: airport.lat, lon: airport.lon });
    res.status(200).json({ status: 'success', data: { city: airport.city, hotels } });
  } catch (err) {
    next(err);
  }
}

async function getRestaurants(req, res, next) {
  try {
    const airport = airportService.requireByIata(req.params.iataCode);
    const restaurants = await placesService.getNearbyRestaurants({ lat: airport.lat, lon: airport.lon });
    res.status(200).json({ status: 'success', data: { city: airport.city, restaurants } });
  } catch (err) {
    next(err);
  }
}

async function getAttractions(req, res, next) {
  try {
    const airport = airportService.requireByIata(req.params.iataCode);
    const attractions = await placesService.getTouristAttractions({ lat: airport.lat, lon: airport.lon });
    res.status(200).json({ status: 'success', data: { city: airport.city, attractions } });
  } catch (err) {
    next(err);
  }
}

async function getPhoto(req, res, next) {
  try {
    const { name } = req.query;
    if (!name || !name.startsWith('places/')) {
      throw new AppError('A valid photo "name" query param is required.', 400, 'VALIDATION_ERROR');
    }
    const maxWidthPx = req.query.maxWidth ? parseInt(req.query.maxWidth, 10) : 400;

    const { data, contentType } = await placesService.getPhotoBytes({ photoName: name, maxWidthPx });

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.status(200).send(data);
  } catch (err) {
    next(err);
  }
}

module.exports = { getHotels, getRestaurants, getAttractions, getPhoto };
