const config = require('../config/env');
const AppError = require('../utils/AppError');

/**
 * Distributes a departure date across N legs of a trip.
 * - If a returnDate is given, leg dates are spread evenly across the
 *   [departureDate, returnDate] window (so a 3-country circuit doesn't
 *   search every leg on the same single day).
 * - If no returnDate is given, falls back to a 3-day-per-stop heuristic —
 *   documented default spacing, not a real preference signal.
 */
function distributeLegDates(departureDate, returnDate, numLegs) {
  const dep = new Date(`${departureDate}T00:00:00Z`);
  const dates = [];

  if (!returnDate) {
    for (let i = 0; i < numLegs; i++) {
      const d = new Date(dep);
      d.setUTCDate(d.getUTCDate() + i * 3);
      dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
  }

  const ret = new Date(`${returnDate}T00:00:00Z`);
  const totalDays = Math.max(Math.round((ret - dep) / (24 * 60 * 60 * 1000)), 1);

  for (let i = 0; i < numLegs; i++) {
    const offsetDays = numLegs > 1 ? Math.round((i * totalDays) / numLegs) : 0;
    const d = new Date(dep);
    d.setUTCDate(d.getUTCDate() + offsetDays);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

/**
 * Generates every ordering of a list of countries (used for multi-country
 * circuit trips, e.g. origin -> France -> Italy -> Spain -> origin).
 * Capped at MAX_COUNTRIES_PER_TRIP — beyond 4 countries, N! orderings grow
 * too fast (5! = 120, 6! = 720) to be worth exploring exhaustively here.
 */
function permuteCountries(countries) {
  if (countries.length > config.optimizer.maxCountriesPerTrip) {
    throw new AppError(
      `Trips are limited to ${config.optimizer.maxCountriesPerTrip} destination countries`,
      400,
      'OPTIMIZER_TOO_MANY_COUNTRIES'
    );
  }
  if (countries.length <= 1) return [countries];

  const results = [];
  const permute = (arr, current = []) => {
    if (arr.length === 0) {
      results.push(current);
      return;
    }
    for (let i = 0; i < arr.length; i++) {
      const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
      permute(rest, [...current, arr[i]]);
    }
  };
  permute(countries);
  return results;
}

/**
 * Combines origin airport options x destination airport options x date pairs
 * into concrete search candidates, for a SINGLE-destination-country trip.
 *
 * Every candidate here is still just metadata (no flight API calls yet) —
 * that keeps this stage cheap even before the MAX_PERMUTATIONS cap is applied.
 */
function buildSingleDestinationCandidates(originOptions, destinationOptions, datePairs) {
  const candidates = [];
  for (const origin of originOptions) {
    for (const destination of destinationOptions) {
      for (const dates of datePairs) {
        const legs = dates.returnDate
          ? [
              { fromIata: origin.iata, toIata: destination.iata, date: dates.departureDate },
              { fromIata: destination.iata, toIata: origin.iata, date: dates.returnDate },
            ]
          : [{ fromIata: origin.iata, toIata: destination.iata, date: dates.departureDate }];

        candidates.push({
          legs,
          originAirport: origin,
          destinationAirports: [destination],
          departureDate: dates.departureDate,
          returnDate: dates.returnDate,
          flexScore: dates.flexScore,
          // lower rank-distance = better airport pick; used to pre-sort before truncating
          airportPenalty: origin.distanceKm + (destination.distanceKm || 0),
        });
      }
    }
  }
  return candidates;
}

/**
 * Cartesian product of one airport-options array per country, e.g.
 *   [[FCO, MXP], [CDG, ORY], [ZRH]]
 * ->
 *   [[FCO, CDG, ZRH], [FCO, ORY, ZRH], [MXP, CDG, ZRH], [MXP, ORY, ZRH]]
 *
 * Picks exactly one airport per country per combination, preserving the
 * given country order. If any country's airport array is empty (no usable
 * airport data for that country — see expandDestinationCountry), the
 * product collapses to [] for that whole ordering rather than silently
 * dropping the country from the circuit: the caller (buildMultiCountryCandidates)
 * simply produces no candidates for it, which the optimizer then surfaces as
 * "no valid itinerary" rather than fabricating a shorter circuit than the
 * user asked for.
 */
function airportCombinationsForOrdering(countryAirportArrays) {
  let combos = [[]];
  for (const airports of countryAirportArrays) {
    if (airports.length === 0) return [];
    const next = [];
    for (const combo of combos) {
      for (const airport of airports) {
        next.push([...combo, airport]);
      }
    }
    combos = next;
  }
  return combos;
}

/**
 * Builds multi-country circuit candidates: origin -> country1 -> country2 -> ... -> origin.
 *
 * `countryAirportSets` is an array of airport-option arrays, one per selected
 * country (e.g. [[FCO, MXP, VCE], [CDG, ORY], [ZRH, GVA]] for Italy, France,
 * Switzerland) — see airportExpansion.expandDestinationCountry, which caps
 * each country's array at a small `airportsPerCountry` (top 2-3 ranked
 * airports) specifically so this stays bounded.
 *
 * For every country ORDERING (permuteCountries) this also expands every
 * AIRPORT COMBINATION across the ordered countries (airportCombinationsForOrdering)
 * — e.g. BOM->FCO->CDG->ZRH->BOM and BOM->MXP->CDG->GVA->BOM are both
 * generated as distinct candidates — rather than collapsing every country to
 * just its single top airport. Total raw candidates per country-count is
 * bounded by (country orderings) x (airportsPerCountry ^ countryCount) x
 * (date pairs); capPermutations() below then trims the full raw set down to
 * config.optimizer.maxPermutations before any flight API calls happen, and
 * flightFetchStage further caps actual provider calls to its own
 * MAX_FLIGHT_FETCHES ceiling — so this expansion never translates into an
 * unbounded number of real flight searches.
 */
function buildMultiCountryCandidates(originOptions, countryAirportSets, datePairs) {
  const orderings = permuteCountries(countryAirportSets);
  const candidates = [];

  for (const origin of originOptions) {
    for (const ordering of orderings) {
      const airportCombos = airportCombinationsForOrdering(ordering);

      for (const destinationAirports of airportCombos) {
        for (const dates of datePairs) {
          const stops = [...destinationAirports, origin]; // each destination, then back to origin
          const legDates = distributeLegDates(dates.departureDate, dates.returnDate, stops.length);

          const legs = [];
          let previous = origin.iata;
          stops.forEach((stop, idx) => {
            legs.push({ fromIata: previous, toIata: stop.iata, date: legDates[idx] });
            previous = stop.iata;
          });

          const airportPenalty =
            origin.distanceKm +
            destinationAirports.reduce((sum, a) => sum + (a.distanceKm || 0), 0);

          candidates.push({
            legs,
            originAirport: origin,
            destinationAirports,
            departureDate: dates.departureDate,
            returnDate: dates.returnDate,
            flexScore: dates.flexScore,
            airportPenalty,
          });
        }
      }
    }
  }
  return candidates;
}

/**
 * Applies the hard MAX_PERMUTATIONS cap. Candidates are pre-sorted by a cheap
 * "closeness to what the user asked for" score (flexScore + airportPenalty)
 * BEFORE truncation, so if we have to cut candidates, we cut the least
 * relevant ones first rather than an arbitrary slice.
 */
function capPermutations(candidates) {
  const sorted = [...candidates].sort(
    (a, b) => a.flexScore + a.airportPenalty - (b.flexScore + b.airportPenalty)
  );
  const capped = sorted.slice(0, config.optimizer.maxPermutations);
  return {
    candidates: capped,
    totalGenerated: candidates.length,
    totalAfterCap: capped.length,
    wasCapped: candidates.length > capped.length,
  };
}

module.exports = {
  permuteCountries,
  buildSingleDestinationCandidates,
  buildMultiCountryCandidates,
  airportCombinationsForOrdering,
  capPermutations,
};
