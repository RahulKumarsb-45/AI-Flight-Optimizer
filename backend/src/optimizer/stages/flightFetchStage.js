const providerFactory = require('../../providers/flight/providerFactory');
const flightCache = require('../../cache/flightCache');
const config = require('../../config/env');
const logger = require('../../logger/logger');

/**
 * PRACTICAL FETCH CAP: MAX_PERMUTATIONS (default 500) bounds how many
 * candidate itineraries we're willing to CONSIDER, but actually calling a
 * flight provider 500 times per search would be slow and (for Amadeus)
 * expensive. So after the permutation cap, we take only the best-ranked
 * `MAX_FLIGHT_FETCHES` candidates (by the same flexScore/airportPenalty
 * pre-ranking) and fetch real offers for those. This is a deliberate,
 * documented second cap — not a silent shortcut.
 */
const MAX_FLIGHT_FETCHES = 20;

/**
 * True when a candidate's legs are a simple there-and-back pair for ONE
 * destination (single-destination round trip) rather than a one-way or a
 * multi-city circuit. Multi-city candidates always have 3+ legs (each
 * destination country plus the return to origin — see
 * permutationGenerator.buildMultiCountryCandidates), so this never
 * misfires on a circuit; it only matches the exact shape
 * buildSingleDestinationCandidates produces for a round trip.
 */
function isRoundTripPair(legs) {
  return (
    legs.length === 2 &&
    legs[0].fromIata === legs[1].toIata &&
    legs[0].toIata === legs[1].fromIata
  );
}

function sumSegmentDurations(segments) {
  return (segments || []).reduce((sum, seg) => sum + (seg.durationMinutes || 0), 0);
}

/**
 * Splits ONE real, combined round-trip offer (as returned by a provider's
 * search({ returnDate }) — see FlightProviderContract.js and, for Ignav
 * specifically, ignavProvider.js's POST /fares/round-trip mapping) into the
 * two per-leg "view" objects the existing UI/response shape expects
 * (RecommendationCard.jsx, tripTimeline.js render one offer per displayed
 * leg, via `legOffers[legIndex]`).
 *
 * This is a VIEW split only — never a price split. Ignav (like Amadeus and
 * the mock provider) prices a round trip as ONE combined fare; there is no
 * real, separate "just the outbound" or "just the inbound" amount to
 * report. So the entire real total stays on the outbound view, and the
 * inbound view's priceInr is left null — formatInr() renders that as "—"
 * in the UI — rather than inventing a per-direction split that was never
 * actually quoted. Duration/stops, unlike price, ARE genuinely knowable
 * per direction (each segment already carries its own durationMinutes), so
 * those are computed for real from each direction's own segments rather
 * than approximated.
 */
function splitRoundTripOfferForDisplay(offer) {
  const outboundView = {
    ...offer,
    id: `${offer.id}_outbound`,
    totalDurationMinutes: sumSegmentDurations(offer.outbound),
    stops: Math.max((offer.outbound || []).length - 1, 0),
    inbound: null,
  };
  const inboundView = {
    ...offer,
    id: `${offer.id}_inbound`,
    priceInr: null, // no separate inbound fare exists — see doc comment above
    totalDurationMinutes: sumSegmentDurations(offer.inbound),
    stops: Math.max((offer.inbound || []).length - 1, 0),
    outbound: offer.inbound, // display components read `offer.outbound` as "this leg's segments"
    inbound: null,
  };
  return [outboundView, inboundView];
}

/**
 * Fetches offers (or returns) offers for a single leg's params, de-duplicating
 * concurrent requests for the exact same leg (same route/date/adults/
 * cabinClass/provider) so that when multiple candidates share a leg —
 * common with flexible dates / nearby airports — only one cache lookup
 * and, on a miss, one provider call happens for it, with every caller
 * awaiting the same in-flight promise. This preserves the sequential
 * implementation's effective behavior (a shared leg is fetched once and
 * reused) once fetches are parallelized; without it, concurrent identical
 * cache-miss lookups could race and issue duplicate provider calls.
 *
 * `inFlight` is scoped to a single `fetchFlightsForCandidates` call, so
 * this never causes offers to be reused *across* separate searches — that
 * cross-request reuse is still governed entirely by flightCache's own TTL
 * semantics, untouched here.
 */
function getOrFetchLegOffers(params, inFlight) {
  const key = flightCache.buildCacheKey(params);
  if (!inFlight.has(key)) {
    const promise = (async () => {
      let offers = await flightCache.getCached(params);
      if (!offers) {
        offers = await providerFactory.searchWithFallback(params);
        await flightCache.setCached(params, offers);
      }
      return offers;
    })().finally(() => {
      // Only clear the entry if it's still the one we set (defensive;
      // in practice nothing overwrites it before this runs).
      if (inFlight.get(key) === promise) {
        inFlight.delete(key);
      }
    });
    inFlight.set(key, promise);
  }
  return inFlight.get(key);
}

/**
 * Fetches a single-destination round trip as ONE combined search
 * (originIata/destinationIata/departureDate + returnDate), matching
 * FlightProviderContract.js's documented interface and how mockProvider/
 * amadeusProvider already implement it. This is what makes
 * FLIGHT_PROVIDER=ignav actually reach Ignav's real POST
 * /fares/round-trip endpoint — previously this stage always issued two
 * independent one-way searches (outbound leg, inbound leg) and summed
 * their prices instead, which meant a real combined round-trip fare (and
 * any round-trip-specific pricing) was never actually requested from any
 * provider, Ignav included.
 *
 * totalPriceInr/totalDurationMinutes/totalStops come straight from the
 * provider's own single combined offer — never re-derived from the split
 * display views below, so a real round-trip total is never approximated
 * or re-summed.
 */
async function fetchRoundTripCandidate(candidate, { adults, cabinClass, inFlight }) {
  const [outboundLeg, inboundLeg] = candidate.legs;
  const params = {
    originIata: outboundLeg.fromIata,
    destinationIata: outboundLeg.toIata,
    departureDate: outboundLeg.date,
    returnDate: inboundLeg.date,
    adults,
    cabinClass,
    provider: config.flightProvider,
  };

  const offers = (await getOrFetchLegOffers(params, inFlight)).slice(0, 5); // keep top 5 real round-trip offers for scoring flexibility
  if (offers.length === 0) {
    return null; // no real round-trip offers found — drop this candidate, never substitute anything
  }

  const cheapest = offers[0]; // providers sort cheapest-first already
  const legOffers = [[], []];
  offers.forEach((offer) => {
    const [outboundView, inboundView] = splitRoundTripOfferForDisplay(offer);
    legOffers[0].push(outboundView);
    legOffers[1].push(inboundView);
  });

  return {
    ...candidate,
    legOffers,
    totalPriceInr: cheapest.priceInr,
    totalDurationMinutes: cheapest.totalDurationMinutes,
    totalStops: cheapest.stops,
  };
}

/**
 * Fetches offers for every leg of one candidate (in parallel, since legs of
 * the same candidate are independent of each other) and derives the same
 * enriched-candidate shape the previous sequential implementation produced.
 * Returns `null` for anything the old code used to silently drop (a
 * missing offer on some leg, or a thrown error) so the caller can filter
 * it out while preserving candidate order.
 *
 * A single-destination round trip (see isRoundTripPair) is delegated to
 * fetchRoundTripCandidate for a real combined-fare fetch; everything else
 * (one-way, and multi-city circuits of 3+ legs) keeps the exact per-leg
 * fetch-and-sum behavior this function always had — one-way is completely
 * unaffected by this change.
 */
async function fetchOneCandidate(candidate, { adults, cabinClass, inFlight }) {
  try {
    if (isRoundTripPair(candidate.legs)) {
      return await fetchRoundTripCandidate(candidate, { adults, cabinClass, inFlight });
    }

    const legOffers = await Promise.all(
      candidate.legs.map(async (leg) => {
        const params = {
          originIata: leg.fromIata,
          destinationIata: leg.toIata,
          departureDate: leg.date,
          adults,
          cabinClass,
          provider: config.flightProvider,
        };
        const offers = await getOrFetchLegOffers(params, inFlight);
        return offers.slice(0, 5); // keep top 5 cheapest per leg for scoring flexibility
      })
    );

    const cheapestPerLeg = legOffers.map((offers) => offers[0]).filter(Boolean);
    if (cheapestPerLeg.length !== candidate.legs.length) {
      return null; // couldn't find offers for at least one leg — drop this candidate
    }

    return {
      ...candidate,
      legOffers,
      totalPriceInr: cheapestPerLeg.reduce((sum, o) => sum + o.priceInr, 0),
      totalDurationMinutes: cheapestPerLeg.reduce((sum, o) => sum + o.totalDurationMinutes, 0),
      totalStops: cheapestPerLeg.reduce((sum, o) => sum + o.stops, 0),
    };
  } catch (err) {
    logger.warn('Skipping candidate due to fetch error', { legs: candidate.legs, error: err.message });
    return null;
  }
}

/**
 * Fetches flight offers for every leg of every candidate itinerary.
 *
 * Returns candidates enriched with `legOffers: NormalizedFlightOffer[][]`
 * (best few offers per leg) and computed totals. For one-way and
 * multi-city candidates, totals use the cheapest offer per independently-
 * fetched leg, exactly as before. For a single-destination round trip,
 * the whole candidate is fetched as ONE combined real fare (see
 * fetchRoundTripCandidate) and totals come straight from that fare —
 * pruning/scoring stages operate on this either way without needing to
 * know which path produced it.
 *
 * Candidates are fetched concurrently rather than one-at-a-time: each
 * candidate's own fetch is wrapped in its own try/catch (as before, one
 * candidate's provider error only drops that candidate, nothing else) so
 * `Promise.all` here never rejects, and results are filtered afterwards —
 * `Promise.all` preserves input order in its output array, so the final
 * list has the same relative ordering as the old sequential loop would
 * have produced. The actual provider concurrency ceiling still comes from
 * amadeusProvider's existing internal cap (MAX_CONCURRENT_REQUESTS), so
 * this never bypasses that protection — it just stops needlessly
 * serializing calls that were already independent of one another.
 */
async function fetchFlightsForCandidates(candidates, { adults = 1, cabinClass = 'economy' } = {}) {
  const toFetch = candidates.slice(0, MAX_FLIGHT_FETCHES);
  const skipped = candidates.length - toFetch.length;
  if (skipped > 0) {
    logger.info('Flight fetch cap applied', { totalCandidates: candidates.length, fetched: toFetch.length, skipped });
  }

  const inFlight = new Map();
  const results = await Promise.all(
    toFetch.map((candidate) => fetchOneCandidate(candidate, { adults, cabinClass, inFlight }))
  );

  return results.filter(Boolean);
}

module.exports = { fetchFlightsForCandidates, MAX_FLIGHT_FETCHES };
