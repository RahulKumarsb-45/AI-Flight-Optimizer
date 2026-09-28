const weatherService = require('../services/weatherService');

async function getCurrent(req, res, next) {
  try {
    const result = await weatherService.getCurrentWeather(req.params.iataCode);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
}

async function getForecast(req, res, next) {
  try {
    const result = await weatherService.getForecast(req.params.iataCode);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
}

async function getSeason(req, res, next) {
  try {
    const month = req.query.month ? parseInt(req.query.month, 10) : new Date().getMonth() + 1;
    const result = weatherService.getSeasonGuidance(req.params.iataCode, month);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = { getCurrent, getForecast, getSeason };
