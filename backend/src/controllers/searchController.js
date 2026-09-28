const providerFactory = require('../providers/flight/providerFactory');
const flightCache = require('../cache/flightCache');
const config = require('../config/env');
const { query } = require('../database/pool');
const logger = require('../logger/logger');

/**
 * GET /api/search/flights
 * Single origin -> destination leg search. This is the building block the
 * optimizer engine (Part B4) will call repeatedly for each permutation —
 * exposed directly here too so the frontend/dev can test flight search
 * before the full optimizer pipeline exists.
 */
async function searchFlights(req, res, next) {
  try {
    const {
      origin,
      destination,
      departureDate,
      returnDate,
      adults = 1,
      cabinClass = 'economy',
    } = req.query;

    const params = {
      originIata: origin.toUpperCase(),
      destinationIata: destination.toUpperCase(),
      departureDate,
      returnDate: returnDate || undefined,
      adults: parseInt(adults, 10),
      cabinClass,
      provider: config.flightProvider,
    };

    const cached = await flightCache.getCached(params);
    if (cached) {
      logger.debug('Flight search cache hit', { origin, destination, departureDate });
      return res.status(200).json({ status: 'success', data: { offers: cached, cached: true } });
    }

    const offers = await providerFactory.searchWithFallback(params);
    await flightCache.setCached(params, offers);

    // fire-and-forget search history logging (don't block the response on it)
    if (req.user) {
      query(
        `INSERT INTO search_history (user_id, origin_iata, destination_countries, search_params, result_count)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.user.id, params.originIata, [], JSON.stringify(params), offers.length]
      ).catch((err) => logger.warn('Failed to log search history', { error: err.message }));
    }

    res.status(200).json({ status: 'success', data: { offers, cached: false } });
  } catch (err) {
    next(err);
  }
}

module.exports = { searchFlights };
