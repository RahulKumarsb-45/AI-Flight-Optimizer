/**
 * COUNTRY MASTER DATASET.
 *
 * This is deliberately separate from providers/airport/airportData.js.
 *
 * airportData.js is a small, curated set of ~180 major/mid-size AIRPORTS —
 * it exists to answer "which airports can we route flights through", and it
 * intentionally does NOT cover every country in the world (see its own file
 * header). Deriving the country SELECTOR from that dataset (the old
 * `airportService.listCountries()` behavior) meant a country the flight
 * provider could actually serve, but that had no curated airport entry yet,
 * could never even be selected in the UI.
 *
 * This file instead answers a different, simpler question — "what countries
 * exist" — using `world-countries` (a maintained, data-only npm package
 * covering the full ISO 3166-1 country list, ~250 entries) rather than a
 * hand-maintained list of a few dozen "famous" countries. Airport/flight
 * AVAILABILITY for a given country is resolved separately and later, by
 * providers/airport/airportService.js (expandByCountry) — see
 * optimizer/stages/airportExpansion.js. A country appearing here is not a
 * promise that flights exist for it; it only means it's a real, selectable
 * country. The optimizer independently validates real airport/flight
 * availability before ever recommending a route (see optimizer.js and
 * optimizer/stages/flightFetchStage.js).
 */

const worldCountries = require('world-countries');

/**
 * Curated shortlist of popular tourist-destination ISO 3166-1 alpha-2 codes,
 * shown as a "Popular destinations" quick-pick section ahead of the full
 * country list in the UI. This is a UX convenience only — it is NOT the
 * source of truth for which countries are selectable (see COUNTRIES below,
 * which covers the full dataset), and every country here also appears in
 * the full list with the same data.
 */
const POPULAR_COUNTRY_CODES = [
  'FR', // France
  'IT', // Italy
  'CH', // Switzerland
  'ES', // Spain
  'GB', // United Kingdom
  'DE', // Germany
  'GR', // Greece
  'PT', // Portugal
  'AE', // United Arab Emirates
  'TR', // Turkey
  'JP', // Japan
  'TH', // Thailand
  'SG', // Singapore
  'ID', // Indonesia
  'AU', // Australia
  'NZ', // New Zealand
  'US', // United States
  'CA', // Canada
  'MV', // Maldives
  'EG', // Egypt
  'VN', // Vietnam
  'MY', // Malaysia
  'MU', // Mauritius
  'SC', // Seychelles
  'NL', // Netherlands
  'AT', // Austria
];

const POPULAR_CODE_SET = new Set(POPULAR_COUNTRY_CODES);

/**
 * Normalizes world-countries' rich per-country record down to just what this
 * app needs: an ISO alpha-2 code, a display name, and a region/subregion
 * used purely as informational/filtering metadata (never to block routing —
 * see optimizer.js, which explicitly allows cross-region multi-country
 * circuits).
 */
const COUNTRIES = worldCountries
  .filter((c) => c.cca2 && c.name?.common)
  .map((c) => ({
    countryCode: c.cca2,
    country: c.name.common,
    region: c.subregion || c.region || 'Other',
    popular: POPULAR_CODE_SET.has(c.cca2),
  }))
  .sort((a, b) => a.country.localeCompare(b.country));

const byCountryCode = new Map(COUNTRIES.map((c) => [c.countryCode, c]));

module.exports = { COUNTRIES, POPULAR_COUNTRY_CODES, byCountryCode };
