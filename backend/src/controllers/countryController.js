const countryService = require('../providers/country/countryService');

/**
 * GET /api/countries
 * Returns the full country master list (see providers/country/countryData.js),
 * each entry flagged `popular` so the frontend can render a "Popular
 * destinations" section ahead of the full "All countries" list from a
 * single response. This is intentionally decoupled from
 * providers/airport/airportService — country SELECTION availability and
 * airport/flight availability are resolved separately (the latter by
 * airportController.expandCountry, called once a country is actually
 * selected).
 */
function listCountries(req, res, next) {
  try {
    res.status(200).json({ status: 'success', data: { countries: countryService.listCountries() } });
  } catch (err) {
    next(err);
  }
}

module.exports = { listCountries };
