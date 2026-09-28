const airportService = require('../../providers/airport/airportService');
const config = require('../../config/env');

/**
 * Expands a single origin IATA into itself + nearby alternatives (if enabled),
 * capped by config.optimizer.maxNearbyAirports.
 *
 * Resolves the origin via airportService.resolveByIata() (async) rather than
 * the sync requireByIata()/getNearbyAirports() pair. requireByIata() only
 * ever checks the local dataset plus whatever happens to already be sitting
 * in the in-memory externalAirportCache — right after a server restart (or
 * simply for a code no one has searched for yet, i.e. a cache miss) that
 * cache is empty, so a perfectly valid Ignav-only airport would 404 out of
 * the optimizer even though Ignav (the primary source) knows about it fine.
 * resolveByIata() falls all the way through to a live Ignav lookup on a
 * cache miss, so the optimizer no longer depends on the cache having been
 * pre-warmed by some earlier, unrelated request.
 *
 * Once `origin` is resolved we already have the full airport object, so
 * nearby-airport expansion goes through getNearbyAirportsFor(origin)
 * (accepts an already-resolved airport) instead of getNearbyAirports(iata)
 * (which would just call requireByIata() a second time and reintroduce the
 * exact cache dependency we're avoiding above). getNearbyAirportsFor()
 * itself already refuses to fabricate coordinates: if Ignav didn't provide
 * any (and no local record matched to fill them in), it logs a warning and
 * returns [] rather than guessing — see airportService.js.
 */
async function expandOrigin(originIata, includeNearby = true) {
  const origin = await airportService.resolveByIata(originIata);
  const options = [{ ...origin, distanceKm: 0, isPrimary: true }];

  if (includeNearby) {
    const nearby = airportService.getNearbyAirportsFor(origin);
    options.push(...nearby.map((a) => ({ ...a, isPrimary: false })));
  }

  return options;
}

/**
 * Expands a destination COUNTRY into a small set of candidate airports.
 *
 * DESIGN DECISION: for multi-country trips (2+ destination countries) we only
 * take the top `airportsPerCountry` ranked airports (default 2) rather than
 * every airport + nearby-airport combination. Doing full nearby-airport
 * expansion on every leg of a 4-country trip would multiply out to
 * thousands of permutations before a single flight is even searched.
 * Single-destination trips get the fuller nearby-airport treatment since
 * there's only one leg to expand.
 */
function expandDestinationCountry(countryCode, { airportsPerCountry = 2, includeNearby = false } = {}) {
  const topAirports = airportService.expandByCountry(countryCode, airportsPerCountry);

  if (!includeNearby) {
    return topAirports.map((a) => ({ ...a, isPrimary: true }));
  }

  const expanded = [];
  for (const airport of topAirports) {
    expanded.push({ ...airport, isPrimary: true });
    const nearby = airportService.getNearbyAirports(airport.iata, config.optimizer.maxNearbyAirports);
    expanded.push(...nearby.map((a) => ({ ...a, isPrimary: false })));
  }
  return expanded;
}

module.exports = { expandOrigin, expandDestinationCountry };
