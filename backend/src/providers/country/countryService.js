const { COUNTRIES, byCountryCode } = require('./countryData');

/**
 * Full, alphabetically-sorted country master list — every entry carries a
 * `popular` flag so callers (the /api/countries response, the frontend
 * CountryMultiSelect) can render a "Popular destinations" section ahead of
 * the complete "All countries" list without needing a second dataset or a
 * second request. This list is intentionally NOT filtered by airport or
 * flight availability — see countryData.js's header comment.
 */
function listCountries() {
  return COUNTRIES;
}

function getByCode(countryCode) {
  if (!countryCode) return null;
  return byCountryCode.get(countryCode.toUpperCase()) || null;
}

module.exports = { listCountries, getByCode };
