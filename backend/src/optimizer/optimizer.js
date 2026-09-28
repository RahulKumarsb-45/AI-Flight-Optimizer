const { expandOrigin, expandDestinationCountry } = require('./stages/airportExpansion');

const { generateDatePairs } = require('./dateGenerator');

const {
  buildSingleDestinationCandidates,
  buildMultiCountryCandidates,
  capPermutations,
} = require('./permutationGenerator');

const { fetchFlightsForCandidates } = require('./stages/flightFetchStage');

const { pruneCandidates } = require('./stages/pruning');

const { scoreCandidates, pickCategories } = require('./scoring/scoringEngine');

const {
  explainCandidate,
  explainCategoryPicks,
} = require('./explainability/explainabilityEngine');

const {
  estimateBudgetBreakdown,
  estimateLivingCostEstimate,
  suggestBudgetAdjustment,
  selectBudgetOptimizerPick,
  filterRealCandidatesWithinBudget,
} = require('./budget/budgetEstimator');

const logger = require('../logger/logger');

const TOP_N_RECOMMENDATIONS = 5;

async function optimizeTrip(request) {
  const {
    originIata,
    destinationCountries,
    departureDate,
    returnDate,
    dateFlexible = false,
    minStayDays,
    maxStayDays,
    travelers = 1,
    budgetInr,
    preference = 'balanced',
    nearbyAirportsEnabled = true,
    cabinClass = 'economy',
  } = request;

  const originOptions = await expandOrigin(
    originIata,
    nearbyAirportsEnabled
  );

  const datePairs = generateDatePairs({
    departureDate,
    returnDate,
    dateFlexible,
    minStayDays,
    maxStayDays,
  });

  /*
   * Single vs multi-country routing.
   *
   * destinationCountries.length === 1:
   *   Ordinary single-destination round trip / one-way, with full
   *   nearby-airport expansion on that one leg (buildSingleDestinationCandidates).
   *
   * destinationCountries.length >= 2:
   *   A REAL connected multi-country circuit:
   *     Origin -> Country1 -> Country2 -> ... -> CountryN -> Origin
   *   generated via buildMultiCountryCandidates, which itself tries every
   *   country ORDERING (permuteCountries — up to N! = 24 for the max of 4
   *   countries) so e.g. Italy+France+Switzerland can come back as
   *   BOM->Italy->France->Switzerland->BOM, BOM->France->Italy->Switzerland->BOM,
   *   etc. We deliberately do NOT build one independent round trip per
   *   country here — that was the root cause of the old "3 countries -> 3
   *   unrelated round trips" bug.
   *
   * Each country contributes a small set of top-ranked airports (not just
   * its #1 airport) via expandDestinationCountry — buildMultiCountryCandidates
   * then also varies which airport is used per country
   * (e.g. FCO vs MXP for Italy), still bounded by MULTI_COUNTRY_AIRPORTS_PER_COUNTRY
   * so a 4-country trip stays at (<=24 orderings) x (<=airports^4 combos),
   * matching the documented worst case of ~1900 raw candidates — well before
   * any flight API call. capPermutations() below trims that down to
   * config.optimizer.maxPermutations, and flightFetchStage separately caps
   * actual provider calls, so this never turns into an API-call explosion.
   *
   * includeNearby is intentionally left off for multi-country airport
   * expansion (independent of the user's nearbyAirportsEnabled toggle,
   * which still fully applies to the origin and to single-country trips) —
   * see airportExpansion.js's design note: full nearby-airport expansion on
   * every leg of a 4-country circuit would multiply combinations far beyond
   * what's computationally reasonable.
   */
  const MULTI_COUNTRY_AIRPORTS_PER_COUNTRY = 3;

  let rawCandidates;
  let countriesWithNoAirports = [];

  if (destinationCountries.length === 1) {
    const destinationOptions = expandDestinationCountry(destinationCountries[0], {
      airportsPerCountry: 3,
      includeNearby: nearbyAirportsEnabled,
    });

    rawCandidates = buildSingleDestinationCandidates(
      originOptions,
      destinationOptions,
      datePairs
    );
  } else {
    const countryAirportSets = destinationCountries.map((countryCode) =>
      expandDestinationCountry(countryCode, {
        airportsPerCountry: MULTI_COUNTRY_AIRPORTS_PER_COUNTRY,
        includeNearby: false,
      })
    );

    // A country with zero resolvable airports (no curated/Ignav coverage)
    // can't participate in any real circuit. We don't silently drop it from
    // the requested route (that would return a trip the user didn't ask
    // for) — instead we surface it via meta.countriesWithNoAirports so the
    // API/UI can explain the gap gracefully, and let the natural
    // cartesian-product collapse in buildMultiCountryCandidates produce zero
    // candidates for this search rather than throwing.
    countriesWithNoAirports = destinationCountries.filter(
      (_, i) => countryAirportSets[i].length === 0
    );

    rawCandidates =
      countriesWithNoAirports.length > 0
        ? []
        : buildMultiCountryCandidates(originOptions, countryAirportSets, datePairs);

    if (countriesWithNoAirports.length > 0) {
      logger.warn('Multi-country search aborted: no airport data for one or more countries', {
        destinationCountries,
        countriesWithNoAirports,
      });
    }
  }

  const {
    candidates: cappedCandidates,
    totalGenerated,
    totalAfterCap,
    wasCapped,
  } = capPermutations(rawCandidates);

  logger.info('Optimizer permutation stage complete', {
    totalGenerated,
    totalAfterCap,
    wasCapped,
    destinationCountries,
  });

  const enrichedCandidates = await fetchFlightsForCandidates(
    cappedCandidates,
    {
      adults: travelers,
      cabinClass,
    }
  );

  if (
    cappedCandidates.length > 0 &&
    enrichedCandidates.length === 0
  ) {
    logger.error(
      'All candidate flight fetches returned no offers — check FLIGHT_PROVIDER config/credentials',
      {
        flightProvider: require('../config/env').flightProvider,
        candidatesAttempted: cappedCandidates.length,
        originIata,
        destinationCountries,
      }
    );
  }

  const {
    filtered: prunedCandidates,
    reasons,
    totalBeforePruning,
    totalAfterPruning,
    cheapestOverBudgetInr,
    cheapestOverBudgetCandidate,
  } = pruneCandidates(enrichedCandidates, {
    budgetInr,
  });

  const scored = scoreCandidates(
    prunedCandidates,
    preference
  );

  const topRecommendations = scored
    .slice(0, TOP_N_RECOMMENDATIONS)
    .map((candidate) => ({
      ...candidate,

      explanation: explainCandidate(
        candidate,
        scored,
        preference
      ),

      budgetInsight: estimateBudgetBreakdown({
        flightCostInr: candidate.totalPriceInr,
        budgetInr,
        travelers,
        departureDate: candidate.departureDate,
        returnDate: candidate.returnDate,
      }),

      livingCostEstimate: estimateLivingCostEstimate({
        travelers,
        departureDate: candidate.departureDate,
        returnDate: candidate.returnDate,
      }),
    }));

  const categories = pickCategories(scored);

  const categoryExplanations =
    explainCategoryPicks(categories);

  const budgetSuggestion = suggestBudgetAdjustment({
    budgetInr,
    resultCount: topRecommendations.length,
    cheapestOverBudgetInr,
    cheapestOverBudgetCandidate,
    requestedDepartureDate: departureDate,
  });

  const budgetOptimizer = selectBudgetOptimizerPick({
    candidates: filterRealCandidatesWithinBudget(
      enrichedCandidates,
      budgetInr
    ),
    budgetInr,
    travelers,
    cheapestOverBudgetInr,
    cheapestOverBudgetCandidate,
    requestedDepartureDate: departureDate,
  });

  return {
    recommendations: topRecommendations,

    budgetOptimizer,

    categories: {
      cheapest: categories.cheapest
        ? {
            ...categories.cheapest,
            explanation:
              categoryExplanations.cheapest,
          }
        : null,

      fastest: categories.fastest
        ? {
            ...categories.fastest,
            explanation:
              categoryExplanations.fastest,
          }
        : null,

      balanced: categories.balanced
        ? {
            ...categories.balanced,
            explanation:
              categoryExplanations.balanced,
          }
        : null,
    },

    meta: {
      originIata,
      destinationCountries,
      preference,

      permutations: {
        totalGenerated,
        totalAfterCap,
        wasCapped,
      },

      pruning: {
        totalBeforePruning,
        totalAfterPruning,
        reasons,
      },

      resultCount: topRecommendations.length,

      budgetSuggestion,

      countriesWithNoAirports,
    },
  };
}

module.exports = { optimizeTrip };