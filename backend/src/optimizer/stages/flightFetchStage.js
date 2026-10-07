const providerFactory = require('../../providers/flight/providerFactory');
const flightCache = require('../../cache/flightCache');
const config = require('../../config/env');
const logger = require('../../logger/logger');

/**
 * Maximum number of candidate itineraries that can be validated
 * against the real flight provider in one optimization request.
 *
 * We do NOT validate all 500 capped candidates because that can create
 * excessive provider/API load.
 *
 * 200 gives later multi-country permutations a fair chance while
 * keeping provider usage bounded.
 */
const MAX_FLIGHT_FETCHES = Number.parseInt(
  process.env.MAX_FLIGHT_FETCHES || '200',
  10
);

/**
 * Number of candidates processed concurrently in one batch.
 *
 * This prevents a large Promise.all() from creating an uncontrolled
 * burst of provider requests.
 */
const FLIGHT_FETCH_BATCH_SIZE = Number.parseInt(
  process.env.FLIGHT_FETCH_BATCH_SIZE || '20',
  10
);

/**
 * TOP_N_RECOMMENDATIONS in optimizerService is 5.
 *
 * Once we have 5 real valid itineraries there is normally no reason
 * to keep consuming provider quota.
 */
const MIN_VALID_RECOMMENDATIONS = 5;

/**
 * True when a candidate's legs are a simple there-and-back pair for
 * ONE destination.
 *
 * Multi-country circuits always have 3+ legs.
 */
function isRoundTripPair(legs) {
  return (
    legs.length === 2 &&
    legs[0].fromIata === legs[1].toIata &&
    legs[0].toIata === legs[1].fromIata
  );
}

function sumSegmentDurations(segments) {
  return (segments || []).reduce(
    (sum, seg) => sum + (seg.durationMinutes || 0),
    0
  );
}

/**
 * Split one real combined round-trip offer into two display views.
 *
 * IMPORTANT:
 * This does NOT split the actual fare.
 * The real combined price remains on the outbound view.
 */
function splitRoundTripOfferForDisplay(offer) {
  const outboundView = {
    ...offer,
    id: `${offer.id}_outbound`,
    totalDurationMinutes: sumSegmentDurations(
      offer.outbound
    ),
    stops: Math.max(
      (offer.outbound || []).length - 1,
      0
    ),
    inbound: null,
  };

  const inboundView = {
    ...offer,
    id: `${offer.id}_inbound`,
    priceInr: null,
    totalDurationMinutes: sumSegmentDurations(
      offer.inbound
    ),
    stops: Math.max(
      (offer.inbound || []).length - 1,
      0
    ),
    outbound: offer.inbound,
    inbound: null,
  };

  return [outboundView, inboundView];
}

/**
 * Fetch offers for one exact flight-leg request.
 *
 * Uses:
 * 1. Memory cache
 * 2. Redis cache
 * 3. Provider
 *
 * Also de-duplicates identical requests that are running
 * simultaneously.
 */
function getOrFetchLegOffers(params, inFlight) {
  const key = flightCache.buildCacheKey(params);

  if (!inFlight.has(key)) {
    const promise = (async () => {
      let offers = await flightCache.getCached(params);

      if (!offers) {
        offers =
          await providerFactory.searchWithFallback(
            params
          );

        await flightCache.setCached(
          params,
          offers
        );
      }

      return offers;
    })().finally(() => {
      if (inFlight.get(key) === promise) {
        inFlight.delete(key);
      }
    });

    inFlight.set(key, promise);
  }

  return inFlight.get(key);
}

/**
 * Fetch a single-destination round trip as ONE combined
 * real provider search.
 */
async function fetchRoundTripCandidate(
  candidate,
  { adults, cabinClass, inFlight }
) {
  const [
    outboundLeg,
    inboundLeg,
  ] = candidate.legs;

  const params = {
    originIata: outboundLeg.fromIata,
    destinationIata: outboundLeg.toIata,
    departureDate: outboundLeg.date,
    returnDate: inboundLeg.date,
    adults,
    cabinClass,
    provider: config.flightProvider,
  };

  const offers = (
    await getOrFetchLegOffers(
      params,
      inFlight
    )
  ).slice(0, 5);

  if (offers.length === 0) {
    return null;
  }

  const cheapest = offers[0];

  const legOffers = [
    [],
    [],
  ];

  offers.forEach((offer) => {
    const [
      outboundView,
      inboundView,
    ] = splitRoundTripOfferForDisplay(
      offer
    );

    legOffers[0].push(
      outboundView
    );

    legOffers[1].push(
      inboundView
    );
  });

  return {
    ...candidate,
    legOffers,

    totalPriceInr:
      cheapest.priceInr,

    totalDurationMinutes:
      cheapest.totalDurationMinutes,

    totalStops:
      cheapest.stops,
  };
}

/**
 * Fetch every leg of one candidate.
 *
 * A multi-country candidate is considered valid ONLY when
 * every leg has at least one real flight offer.
 */
async function fetchOneCandidate(
  candidate,
  { adults, cabinClass, inFlight }
) {
  try {
    if (
      isRoundTripPair(
        candidate.legs
      )
    ) {
      return await fetchRoundTripCandidate(
        candidate,
        {
          adults,
          cabinClass,
          inFlight,
        }
      );
    }

    const legOffers =
      await Promise.all(
        candidate.legs.map(
          async (leg) => {
            const params = {
              originIata:
                leg.fromIata,

              destinationIata:
                leg.toIata,

              departureDate:
                leg.date,

              adults,
              cabinClass,
              provider:
                config.flightProvider,
            };

            const offers =
              await getOrFetchLegOffers(
                params,
                inFlight
              );

            return offers.slice(
              0,
              5
            );
          }
        )
      );

    const cheapestPerLeg =
      legOffers
        .map(
          (offers) =>
            offers[0]
        )
        .filter(Boolean);

    /**
     * If even ONE leg has no real flight,
     * this complete itinerary is invalid.
     */
    if (
      cheapestPerLeg.length !==
      candidate.legs.length
    ) {
      return null;
    }

    return {
      ...candidate,

      legOffers,

      totalPriceInr:
        cheapestPerLeg.reduce(
          (sum, offer) =>
            sum + offer.priceInr,
          0
        ),

      totalDurationMinutes:
        cheapestPerLeg.reduce(
          (sum, offer) =>
            sum +
            offer.totalDurationMinutes,
          0
        ),

      totalStops:
        cheapestPerLeg.reduce(
          (sum, offer) =>
            sum + offer.stops,
          0
        ),
    };
  } catch (err) {
    logger.warn(
      'Skipping candidate due to fetch error',
      {
        legs:
          candidate?.legs,
        error:
          err.message,
      }
    );

    return null;
  }
}

/**
 * Create a route signature for a candidate.
 *
 * Example:
 *
 * DEL -> SYD -> NRT -> AKL -> SIN -> DEL
 *
 * gets a different signature from:
 *
 * DEL -> NRT -> SYD -> AKL -> SIN -> DEL
 *
 * This prevents the old "first 20 candidates" problem where
 * many candidates from the same route structure could consume
 * the entire validation budget.
 */
function getCandidateRouteKey(
  candidate
) {
  if (
    !candidate ||
    !Array.isArray(
      candidate.legs
    )
  ) {
    return 'unknown';
  }

  return candidate.legs
    .map(
      (leg) =>
        `${leg.fromIata || ''}-${leg.toIata || ''}`
    )
    .join('|');
}

/**
 * Select candidates fairly across different route structures.
 *
 * Instead of:
 *
 * candidates.slice(0, 20)
 *
 * we group candidates by route and take them
 * round-robin.
 *
 * This gives different country permutations a chance
 * to reach the real flight provider.
 */
function selectCandidatesForValidation(
  candidates,
  limit
) {
  if (
    !Array.isArray(candidates) ||
    candidates.length === 0 ||
    limit <= 0
  ) {
    return [];
  }

  if (
    candidates.length <= limit
  ) {
    return candidates.slice();
  }

  const groups =
    new Map();

  for (
    const candidate of candidates
  ) {
    const key =
      getCandidateRouteKey(
        candidate
      );

    if (!groups.has(key)) {
      groups.set(
        key,
        []
      );
    }

    groups
      .get(key)
      .push(candidate);
  }

  const selected = [];

  const iterators =
    Array.from(
      groups.values()
    ).map(
      (group) => ({
        group,
        index: 0,
      })
    );

  while (
    selected.length <
    limit
  ) {
    let addedThisRound =
      false;

    for (
      const iterator of iterators
    ) {
      if (
        iterator.index <
          iterator.group.length &&
        selected.length <
          limit
      ) {
        selected.push(
          iterator.group[
            iterator.index
          ]
        );

        iterator.index += 1;

        addedThisRound =
          true;
      }
    }

    if (
      !addedThisRound
    ) {
      break;
    }
  }

  return selected;
}

/**
 * Fetch flight offers in bounded batches.
 *
 * Important:
 *
 * - Does NOT only check first 20 candidates.
 * - Maximum 200 candidates by default.
 * - Only 20 candidates are processed concurrently.
 * - Different route permutations are selected fairly.
 * - Stops when 5 valid real itineraries are found.
 * - If fewer than 5 exist, continues until the configured
 *   validation limit is exhausted.
 */
async function fetchFlightsForCandidates(
  candidates,
  {
    adults = 1,
    cabinClass = 'economy',
  } = {}
) {
  if (
    !Array.isArray(candidates) ||
    candidates.length === 0
  ) {
    return [];
  }

  const safeMaxFetches =
    Number.isFinite(
      MAX_FLIGHT_FETCHES
    )
      ? Math.max(
          1,
          MAX_FLIGHT_FETCHES
        )
      : 200;

  const safeBatchSize =
    Number.isFinite(
      FLIGHT_FETCH_BATCH_SIZE
    )
      ? Math.max(
          1,
          FLIGHT_FETCH_BATCH_SIZE
        )
      : 20;

  /**
   * Select candidates from different route structures
   * instead of blindly taking candidates 0..19.
   */
  const candidatesToFetch =
    selectCandidatesForValidation(
      candidates,
      Math.min(
        candidates.length,
        safeMaxFetches
      )
    );

  const skipped =
    candidates.length -
    candidatesToFetch.length;

  if (skipped > 0) {
    logger.info(
      'Flight fetch cap applied',
      {
        totalCandidates:
          candidates.length,

        selectedForValidation:
          candidatesToFetch.length,

        skipped,

        maxFlightFetches:
          safeMaxFetches,

        strategy:
          'route-diverse-round-robin',
      }
    );
  }

  const inFlight =
    new Map();

  const validResults =
    [];

  /**
   * Process candidates in batches.
   */
  for (
    let start = 0;
    start <
    candidatesToFetch.length;
    start += safeBatchSize
  ) {
    const batch =
      candidatesToFetch.slice(
        start,
        start +
          safeBatchSize
      );

    logger.info(
      'Flight validation batch started',
      {
        batchStart:
          start,

        batchSize:
          batch.length,

        totalSelected:
          candidatesToFetch.length,
      }
    );

    const results =
      await Promise.all(
        batch.map(
          (candidate) =>
            fetchOneCandidate(
              candidate,
              {
                adults,
                cabinClass,
                inFlight,
              }
            )
        )
      );

    const successful =
      results.filter(
        Boolean
      );

    validResults.push(
      ...successful
    );

    logger.info(
      'Flight validation batch completed',
      {
        batchStart:
          start,

        batchSize:
          batch.length,

        successfulCandidates:
          successful.length,

        totalValidCandidates:
          validResults.length,
      }
    );

    /**
     * We need 5 real candidates for the
     * TOP_N_RECOMMENDATIONS = 5 stage.
     *
     * Stop here to avoid unnecessary provider usage.
     */
    if (
      validResults.length >=
      MIN_VALID_RECOMMENDATIONS
    ) {
      logger.info(
        'Minimum real itinerary target reached',
        {
          validCandidates:
            validResults.length,

          batchesProcessed:
            Math.ceil(
              (start +
                batch.length) /
                safeBatchSize
            ),
        }
      );

      break;
    }
  }

  logger.info(
    'Flight candidate fetch completed',
    {
      provider:
        config.flightProvider,

      requestedCandidates:
        candidatesToFetch.length,

      successfulCandidates:
        validResults.length,

      droppedCandidates:
        candidatesToFetch.length -
        validResults.length,
    }
  );

  return validResults;
}

module.exports = {
  fetchFlightsForCandidates,
  MAX_FLIGHT_FETCHES,
  FLIGHT_FETCH_BATCH_SIZE,
};