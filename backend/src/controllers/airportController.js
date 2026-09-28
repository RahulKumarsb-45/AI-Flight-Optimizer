const airportService = require('../providers/airport/airportService');
const AppError = require('../utils/AppError');

async function searchAirports(req, res, next) {
  try {
    const { q, limit } = req.query;
    if (!q || q.trim().length < 1) {
      return res.status(200).json({ status: 'success', data: { results: [] } });
    }
    // search() queries Ignav (the primary, external source) first and
    // enriches/fills with the local dataset — see airportService.js.
    const results = await airportService.search(q, limit ? parseInt(limit, 10) : 8);
    res.status(200).json({ status: 'success', data: { results } });
  } catch (err) {
    next(err);
  }
}

async function getAirportByCode(req, res, next) {
  try {
    // resolveByIata checks local data, then previously-seen Ignav results,
    // then falls back to a live Ignav lookup — so a valid airport that
    // isn't in the local 113-airport dataset can still be resolved here.
    const airport = await airportService.resolveByIata(req.params.iataCode);
    res.status(200).json({ status: 'success', data: { airport } });
  } catch (err) {
    next(err);
  }
}

async function getNearbyAirports(req, res, next) {
  try {
    const { iataCode } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
    const maxDistanceKm = req.query.maxDistanceKm ? parseInt(req.query.maxDistanceKm, 10) : undefined;

    // Resolve the origin the same external-aware way as getAirportByCode,
    // then reuse the shared distance logic (getNearbyAirportsFor) rather
    // than the sync, local/cache-only getNearbyAirports() that the
    // optimizer's flight-search path relies on.
    const origin = await airportService.resolveByIata(iataCode);
    const nearby = airportService.getNearbyAirportsFor(origin, limit, maxDistanceKm);
    res.status(200).json({ status: 'success', data: { origin: iataCode.toUpperCase(), nearby } });
  } catch (err) {
    next(err);
  }
}

function listRegions(req, res, next) {
  try {
    res.status(200).json({ status: 'success', data: { regions: airportService.listRegions() } });
  } catch (err) {
    next(err);
  }
}

function expandCountry(req, res, next) {
  try {
    const { countryCode } = req.params;
    if (!countryCode || countryCode.length !== 2) {
      throw new AppError('countryCode must be a 2-letter ISO code, e.g. GB', 400, 'VALIDATION_ERROR');
    }
    const airports = airportService.expandByCountry(countryCode);
    res.status(200).json({ status: 'success', data: { countryCode: countryCode.toUpperCase(), airports } });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  searchAirports,
  getAirportByCode,
  getNearbyAirports,
  listRegions,
  expandCountry,
};
