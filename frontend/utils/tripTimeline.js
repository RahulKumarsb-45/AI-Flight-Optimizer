/**
 * Trip Timeline / Day-by-Day Itinerary — pure calculation logic, no
 * network calls, no React. Builds a chronological day-by-day structure out
 * of data the app has ALREADY fetched elsewhere:
 *
 *  - Flights: `recommendation.legs` (real fromIata/toIata/date per leg,
 *    produced by the optimizer's permutation stage) + `recommendation.legOffers`
 *    (real per-leg flight offers — airline, flight number, departure/arrival
 *    times, price — produced by the flight provider). Never recomputed or
 *    invented here.
 *  - Accommodation: the existing nearby-hotels list for the destination
 *    (`placesService.getHotels`, same data `NearbyPlacesCard` already shows),
 *    passed in already-fetched. Only ever attached to the arrival day, and
 *    always labeled as suggestions — this app has no real booking/check-in
 *    system, so it never claims a specific hotel was booked.
 *  - Tourist attractions: the existing attractions list
 *    (`placesService.getAttractions`, same data `TouristAttractionsCard`
 *    already shows), passed in already-fetched.
 *  - Restaurants: the existing nearby-restaurants list
 *    (`placesService.getRestaurants`), passed in already-fetched.
 *
 * The trip's day span is derived directly from the real leg dates (not from
 * the Budget Optimizer's `nights` heuristic), since leg dates are the most
 * direct real data available and correctly handle one-way, round-trip, and
 * multi-city circuit trips alike.
 *
 * Nothing in this module invents a flight, hotel, restaurant, attraction,
 * date, time, or price. When a piece of data isn't available, the resulting
 * entry is marked unavailable rather than filled in with a guess.
 */

const MAX_ATTRACTIONS_PER_DAY = 3;
const MAX_RESTAURANTS_PER_DAY = 2;
const MAX_HOTEL_SUGGESTIONS = 3;

/** Parses a 'YYYY-MM-DD' date string as a UTC date, so day-math is DST-safe. */
function parseDateOnly(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`);
}

function toDateOnlyString(date) {
  return date.toISOString().split('T')[0];
}

/** Inclusive count of calendar days between two 'YYYY-MM-DD' strings. */
function daysBetweenInclusive(startStr, endStr) {
  const start = parseDateOnly(startStr);
  const end = parseDateOnly(endStr);
  const diffDays = Math.round((end - start) / (24 * 60 * 60 * 1000));
  return Math.max(diffDays, 0) + 1;
}

/**
 * Builds the ordered list of 'YYYY-MM-DD' calendar dates a trip spans,
 * from the earliest to the latest real leg date (inclusive). Returns an
 * empty array when there isn't at least one valid leg date to anchor on.
 */
function computeTripDayDates(legs) {
  const legDates = (legs || []).map((leg) => leg?.date).filter(Boolean);
  if (legDates.length === 0) return [];

  const sorted = [...legDates].sort();
  const minDateStr = sorted[0];
  const maxDateStr = sorted[sorted.length - 1];

  const totalDays = daysBetweenInclusive(minDateStr, maxDateStr);
  const start = parseDateOnly(minDateStr);

  const dates = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(toDateOnlyString(d));
  }
  return dates;
}

/** Labels a leg as outbound / return / connecting, using only real airport data. */
function describeLegDirection(leg, index, legs, originAirport) {
  if (index === 0) return 'outbound';
  if (originAirport && leg.toIata === originAirport.iata) return 'return';
  if (index === legs.length - 1) return 'return';
  return 'connecting';
}

/**
 * Builds a flight timeline entry for a single leg. Uses the first (cheapest)
 * offer for that leg — the same one `RecommendationCard` displays — and
 * never fabricates a time or price when no offer was found for the leg.
 */
function buildFlightEntry({ leg, offer, direction }) {
  if (!offer) {
    return {
      type: 'flight',
      status: 'unavailable',
      direction,
      fromIata: leg.fromIata,
      toIata: leg.toIata,
      date: leg.date,
      note: 'No flight offer is available for this leg yet.',
    };
  }

  const segments = offer.outbound || [];
  const firstSegment = segments[0];
  const lastSegment = segments[segments.length - 1];

  return {
    type: 'flight',
    status: 'available',
    direction,
    fromIata: leg.fromIata,
    toIata: leg.toIata,
    date: leg.date,
    departureTime: firstSegment?.departureTime ?? null,
    arrivalTime: lastSegment?.arrivalTime ?? null,
    stops: offer.stops ?? null,
    totalDurationMinutes: offer.totalDurationMinutes ?? null,
    priceInr: offer.priceInr ?? null,
    segments: segments.map((seg) => ({
      airline: seg.airline,
      flightNumber: seg.flightNumber,
      fromIata: seg.fromIata,
      toIata: seg.toIata,
      departureTime: seg.departureTime,
      arrivalTime: seg.arrivalTime,
    })),
  };
}

/**
 * Splits an already-fetched places list (hotels/attractions/restaurants)
 * across a set of eligible day indices, `perDayCap` items per day, in list
 * order. Extra items beyond capacity simply aren't placed on the timeline
 * (they're still visible in their own existing card) — never fabricated,
 * never overlapped onto a day that's already full.
 */
function distributeAcrossDays(items, eligibleDayIndices, perDayCap) {
  const byDayIndex = new Map();
  if (!items || items.length === 0 || eligibleDayIndices.length === 0) return byDayIndex;

  let cursor = 0;
  for (const dayIndex of eligibleDayIndices) {
    const slice = items.slice(cursor, cursor + perDayCap);
    if (slice.length > 0) byDayIndex.set(dayIndex, slice);
    cursor += perDayCap;
    if (cursor >= items.length) break;
  }
  return byDayIndex;
}

function rangeInclusive(start, end) {
  const out = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

/**
 * For a genuine multi-city circuit, figures out which real destination each
 * day-range of the trip actually belongs to. A leg only starts a "stay" when
 * it lands somewhere in `destinationAirports` (an ACTUAL destination) — the
 * final leg landing back at the origin never does, so the origin is never
 * treated as a place needing its own hotel/attraction/restaurant data.
 *
 * A stay runs from its leg's date through the day before the next leg's
 * date (i.e. through the day you actually depart that destination), or
 * through the last day of the trip if nothing follows it.
 */
function computeDestinationStays({ legs, dayDates, originAirport, destinationAirports }) {
  const destinationIatas = new Set((destinationAirports || []).map((d) => d.iata));
  const cityByIata = new Map((destinationAirports || []).map((d) => [d.iata, d.city]));
  const stays = [];

  (legs || []).forEach((leg, idx) => {
    const isActualDestination = destinationIatas.has(leg.toIata) && leg.toIata !== originAirport?.iata;
    if (!isActualDestination) return; // e.g. the final leg returning to the origin

    const startDayIndex = dayDates.indexOf(leg.date);
    if (startDayIndex === -1) return; // defensive: a leg date outside the computed span

    let endDayIndex = dayDates.length - 1;
    const nextLeg = legs[idx + 1];
    if (nextLeg) {
      const nextDayIndex = dayDates.indexOf(nextLeg.date);
      if (nextDayIndex !== -1) endDayIndex = Math.max(startDayIndex, nextDayIndex - 1);
    }

    stays.push({ iata: leg.toIata, city: cityByIata.get(leg.toIata) || null, startDayIndex, endDayIndex });
  });

  return stays;
}

/**
 * Attaches accommodation/attractions/restaurants entries for a real
 * multi-city circuit, using each destination's OWN places data
 * (`placesByDestination[iata]`) scoped to the day-range it's actually the
 * current destination — never destination[0]'s data bleeding across the
 * whole trip. A destination with no data (fetch failed, or nothing found)
 * simply contributes no entries for its days, same "graceful, never
 * fabricated" behavior as the single-destination path below.
 */
function attachPerDestinationEntries({ days, stays, placesByDestination }) {
  let anyHotels = false;
  let anyAttractions = false;
  let anyRestaurants = false;

  for (const stay of stays) {
    const placesData = placesByDestination?.[stay.iata] || {};
    const { hotels, attractions, restaurants } = placesData;
    const stayLength = stay.endDayIndex - stay.startDayIndex + 1;

    if (Array.isArray(hotels) && hotels.length > 0) {
      anyHotels = true;
      days[stay.startDayIndex].entries.push({
        type: 'accommodation',
        status: 'available',
        city: stay.city,
        options: hotels.slice(0, MAX_HOTEL_SUGGESTIONS),
      });
    }

    if (Array.isArray(attractions) && attractions.length > 0) {
      anyAttractions = true;
      const fullDays = rangeInclusive(stay.startDayIndex, stay.endDayIndex).filter(
        (d) => stayLength < 3 || (d !== stay.startDayIndex && d !== stay.endDayIndex)
      );
      const byDay = distributeAcrossDays(attractions, fullDays, MAX_ATTRACTIONS_PER_DAY);
      for (const [dayIndex, items] of byDay.entries()) {
        days[dayIndex].entries.push({ type: 'attractions', status: 'available', items });
      }
    }

    if (Array.isArray(restaurants) && restaurants.length > 0) {
      anyRestaurants = true;
      const eligibleDayIndices = rangeInclusive(stay.startDayIndex, stay.endDayIndex);
      const byDay = distributeAcrossDays(restaurants, eligibleDayIndices, MAX_RESTAURANTS_PER_DAY);
      for (const [dayIndex, items] of byDay.entries()) {
        days[dayIndex].entries.push({ type: 'restaurants', status: 'available', items });
      }
    }
  }

  return { anyHotels, anyAttractions, anyRestaurants };
}

/**
 * Builds the full day-by-day itinerary.
 *
 * @param {object} params
 * @param {Array} params.legs - recommendation.legs (real fromIata/toIata/date)
 * @param {Array} params.legOffers - recommendation.legOffers (per-leg offers)
 * @param {object} params.originAirport - recommendation.originAirport
 * @param {Array} params.destinationAirports - recommendation.destinationAirports
 * @param {Array|null} params.hotels - already-fetched hotels for the destination, or null/undefined if not loaded
 * @param {Array|null} params.attractions - already-fetched attractions for the destination, or null/undefined if not loaded
 * @param {Array|null} params.restaurants - already-fetched restaurants for the destination, or null/undefined if not loaded
 * @param {string|null} params.destinationCity - destination city name, for labeling only
 * @param {object|null} params.placesByDestination - optional, for real multi-city
 *   circuits only: `{ [iata]: { hotels, attractions, restaurants } }`, one
 *   already-fetched places set per actual destination. When there is more
 *   than one destination AND this is provided, each destination's own data
 *   is used for its own days instead of the flat hotels/attractions/
 *   restaurants above (which are ignored in that case). Single-destination
 *   trips always use the flat params above, unchanged.
 */
function buildTripTimeline({
  legs,
  legOffers,
  originAirport,
  destinationAirports,
  hotels,
  attractions,
  restaurants,
  destinationCity,
  placesByDestination,
}) {
  const dayDates = computeTripDayDates(legs);

  if (dayDates.length === 0) {
    return {
      isAvailable: false,
      reason: 'No flight date information is available for this trip yet.',
      days: [],
    };
  }

  const totalDays = dayDates.length;
  const days = dayDates.map((date, index) => ({
    dayNumber: index + 1,
    date,
    entries: [],
  }));

  // Place each leg's flight entry on the day matching its real date.
  (legs || []).forEach((leg, idx) => {
    const dayIndex = dayDates.indexOf(leg.date);
    if (dayIndex === -1) return; // defensive: a leg date outside the computed span
    const offer = legOffers?.[idx]?.[0] || null;
    const direction = describeLegDirection(leg, idx, legs, originAirport);
    days[dayIndex].entries.push(buildFlightEntry({ leg, offer, direction }));
  });

  // Real multi-city circuit (more than one actual destination) with real
  // per-destination data supplied: use each destination's own hotels/
  // attractions/restaurants for its own days, instead of one destination's
  // data applied to the whole trip. Single-destination trips (the vast
  // majority, and every pre-existing caller) are completely unaffected —
  // they fall through to the exact original flat-list logic below.
  const isMultiDestination = (destinationAirports?.length || 0) > 1;
  const usedPerDestinationData = Boolean(isMultiDestination && placesByDestination);

  let hotelsAvailable;
  let attractionsAvailable;
  let restaurantsAvailable;

  if (usedPerDestinationData) {
    const stays = computeDestinationStays({ legs, dayDates, originAirport, destinationAirports });
    const flags = attachPerDestinationEntries({ days, stays, placesByDestination });
    hotelsAvailable = flags.anyHotels;
    attractionsAvailable = flags.anyAttractions;
    restaurantsAvailable = flags.anyRestaurants;
  } else {
    // Accommodation suggestions: arrival day only, never a claimed booking.
    hotelsAvailable = Array.isArray(hotels) && hotels.length > 0;
    if (hotelsAvailable) {
      days[0].entries.push({
        type: 'accommodation',
        status: 'available',
        city: destinationCity || destinationAirports?.[0]?.city || null,
        options: hotels.slice(0, MAX_HOTEL_SUGGESTIONS),
      });
    }

    // Attractions: spread across "full" days (excluding pure travel days —
    // the arrival and departure day — once the trip is long enough to have
    // any). For 1–2 day trips there's no day to safely exclude, so every day
    // is eligible.
    attractionsAvailable = Array.isArray(attractions) && attractions.length > 0;
    if (attractionsAvailable) {
      const eligibleDayIndices =
        totalDays >= 3
          ? days.slice(1, totalDays - 1).map((_, i) => i + 1)
          : days.map((_, i) => i);
      const byDay = distributeAcrossDays(attractions, eligibleDayIndices, MAX_ATTRACTIONS_PER_DAY);
      for (const [dayIndex, items] of byDay.entries()) {
        days[dayIndex].entries.push({ type: 'attractions', status: 'available', items });
      }
    }

    // Restaurants: spread across every day (a meal suggestion is reasonable
    // even on arrival/departure days, unlike a full outing).
    restaurantsAvailable = Array.isArray(restaurants) && restaurants.length > 0;
    if (restaurantsAvailable) {
      const eligibleDayIndices = days.map((_, i) => i);
      const byDay = distributeAcrossDays(restaurants, eligibleDayIndices, MAX_RESTAURANTS_PER_DAY);
      for (const [dayIndex, items] of byDay.entries()) {
        days[dayIndex].entries.push({ type: 'restaurants', status: 'available', items });
      }
    }
  }

  // Order each day's entries chronologically: flights by their real
  // departure time first, then accommodation (arrival-day check-in framing),
  // then attractions, then restaurants. Days with no timed flight keep
  // this same stable relative order.
  const typeOrder = { flight: 0, accommodation: 1, attractions: 2, restaurants: 3 };
  for (const day of days) {
    day.entries.sort((a, b) => {
      if (a.type === 'flight' && b.type === 'flight') {
        return (a.departureTime || '').localeCompare(b.departureTime || '');
      }
      return typeOrder[a.type] - typeOrder[b.type];
    });
  }

  return {
    isAvailable: true,
    totalDays,
    hotelsAvailable,
    attractionsAvailable,
    restaurantsAvailable,
    usedPerDestinationData,
    days,
  };
}

module.exports = {
  computeTripDayDates,
  daysBetweenInclusive,
  buildTripTimeline,
};
