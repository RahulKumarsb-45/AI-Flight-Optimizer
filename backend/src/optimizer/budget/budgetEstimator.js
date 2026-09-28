const config = require('../../config/env');

/**
 * Budget Optimizer — pure, dependency-free helpers layered on top of the
 * existing optimizer pipeline. Nothing here calls an external API: it only
 * combines numbers the pipeline already has (real flight price, requested
 * budget, trip length) with a clearly-labeled generic living-cost heuristic
 * (see config.budget) to give the user a fuller picture than "this flight
 * fits your budget" alone — without pretending to know actual hotel/food
 * prices for a specific destination.
 */

/**
 * Nights between two ISO date strings. Returns null when there's no return
 * date (one-way trip) — callers should treat that as "can't estimate a
 * living-cost range", not as zero nights.
 */
function computeNights(departureDate, returnDate) {
  if (!departureDate || !returnDate) return null;
  const diffMs = new Date(`${returnDate}T00:00:00Z`) - new Date(`${departureDate}T00:00:00Z`);
  const nights = Math.round(diffMs / (24 * 60 * 60 * 1000));
  return nights > 0 ? nights : null;
}

/**
 * Splits a combined {min, max} living-cost range into labeled sub-categories
 * (accommodation / food / local transport) using the configured shares. This
 * is purely a proportional split of the same heuristic range — it does not
 * add any new precision or pricing source, it just labels the range honestly
 * instead of lumping everything under one "hotel + food" line.
 */
function splitLivingCostRange(range) {
  if (!range) return null;
  const { accommodationShare, foodShare, localTransportShare } = config.budget;
  const splitBy = (share) => ({
    min: Math.round(range.min * share),
    max: Math.round(range.max * share),
  });
  return {
    accommodation: splitBy(accommodationShare),
    food: splitBy(foodShare),
    localTransport: splitBy(localTransportShare),
  };
}

/**
 * Destination-agnostic living-cost estimate (accommodation / food / local
 * transport) for a trip, independent of whether a budget was supplied.
 * This is the same heuristic (config.budget daily range × travelers ×
 * nights, then split into categories) used by `estimateBudgetBreakdown`
 * below — factored out so the no-budget Expense Calculator path can reuse
 * it without duplicating the calculation or requiring a budget to exist.
 *
 * Returns null when there's no return date (one-way trip, no nights to
 * spread a cost across) — same "not enough data" convention used
 * throughout this module.
 */
function estimateLivingCostEstimate({ travelers = 1, departureDate, returnDate }) {
  const nights = computeNights(departureDate, returnDate);
  if (nights == null) {
    return { nights: null, dailyLivingCostRangeInr: null, estimatedTripLivingCostInr: null, categoryBreakdown: null };
  }

  const { dailyLivingCostMinInr, dailyLivingCostMaxInr } = config.budget;
  const dailyLivingCostRangeInr = {
    min: dailyLivingCostMinInr * travelers,
    max: dailyLivingCostMaxInr * travelers,
  };

  const estimatedTripLivingCostInr = {
    min: dailyLivingCostRangeInr.min * nights,
    max: dailyLivingCostRangeInr.max * nights,
  };

  // Category breakdown (accommodation / food / local transport) for the
  // whole trip — same total as estimatedTripLivingCostInr, just labeled.
  // Tourist attractions are deliberately NOT estimated here: no per-destination
  // attraction pricing is available in this pipeline (Google Places only
  // returns a qualitative price *level*, not an amount), so inventing a rupee
  // figure would misrepresent it as a real price. The frontend adds an
  // attractions line only when it already has that qualitative data loaded
  // for the selected destination.
  const categoryBreakdown = splitLivingCostRange(estimatedTripLivingCostInr);

  return { nights, dailyLivingCostRangeInr, estimatedTripLivingCostInr, categoryBreakdown };
}

/**
 * Builds a per-recommendation budget breakdown. Returns null when no budget
 * was supplied — there's nothing budget-related to say in that case. (For a
 * living-cost estimate that does NOT require a budget, see
 * `estimateLivingCostEstimate` above — used by the Expense Calculator.)
 */
function estimateBudgetBreakdown({ flightCostInr, budgetInr, travelers = 1, departureDate, returnDate }) {
  if (!budgetInr) return null;

  const remainingAfterFlightInr = Math.round(budgetInr - flightCostInr);

  // Reuses the same budget-independent living-cost heuristic as the Expense
  // Calculator's no-budget path — never duplicated/recomputed here.
  const { nights, dailyLivingCostRangeInr, estimatedTripLivingCostInr, categoryBreakdown } =
    estimateLivingCostEstimate({ travelers, departureDate, returnDate });

  const estimatedTotalTripCostInr = estimatedTripLivingCostInr
    ? { min: flightCostInr + estimatedTripLivingCostInr.min, max: flightCostInr + estimatedTripLivingCostInr.max }
    : null;

  const suggestedDailyBudgetInr =
    nights != null && remainingAfterFlightInr > 0 ? Math.round(remainingAfterFlightInr / nights) : null;

  // 'over': flight alone blew the budget (shouldn't normally reach here, since
  // pruning already drops these, but kept as a defensive label).
  // 'tight': what's left after flights doesn't comfortably cover even the low
  // end of the living-cost estimate.
  // 'comfortable': what's left covers at least the low end of the estimate.
  // 'unknown': no return date, so a living-cost estimate isn't possible.
  let status = 'unknown';
  if (remainingAfterFlightInr < 0) {
    status = 'over';
  } else if (estimatedTripLivingCostInr) {
    status = remainingAfterFlightInr >= estimatedTripLivingCostInr.min ? 'comfortable' : 'tight';
  }

  // Short, honest explanation of *why* this breakdown looks the way it does —
  // built from the numbers above only, never a separately-invented claim.
  let fitSummary = null;
  if (status === 'comfortable') {
    fitSummary = `Flight cost plus the estimated stay, food, and local-travel range fits within your budget, leaving at least ${
      remainingAfterFlightInr - (estimatedTripLivingCostInr?.min ?? 0) >= 0
        ? `₹${(remainingAfterFlightInr - (estimatedTripLivingCostInr?.min ?? 0)).toLocaleString('en-IN')}`
        : '₹0'
    } of headroom.`;
  } else if (status === 'tight') {
    fitSummary =
      'What\'s left after the flight covers the lower end of the estimated stay, food, and local-travel range, but not comfortably above it.';
  } else if (status === 'over') {
    fitSummary = 'The flight price alone is already above your budget.';
  }

  return {
    flightCostInr,
    budgetInr,
    remainingAfterFlightInr,
    nights,
    dailyLivingCostRangeInr,
    estimatedTripLivingCostInr,
    categoryBreakdown,
    estimatedTotalTripCostInr,
    suggestedDailyBudgetInr,
    status,
    fitSummary,
    note:
      'Stay/food/local-travel figures are a general planning range, not real prices for this destination — no hotel, food, or local-transport pricing source is configured.',
  };
}

/**
 * Trip-level "smart suggestion" for when the requested budget filtered out
 * most or all candidates. Uses the real cheapest over-budget candidate
 * observed during this same search (from the pruning stage) — never a
 * made-up price, date, or destination.
 *
 * When `cheapestOverBudgetCandidate` is available (the full candidate, not
 * just its price), the suggestion also says whether that cheaper option
 * falls on a different date or a different destination airport than what
 * was requested — both taken directly from real search-result data, never
 * invented. If only the price is available (e.g. an older caller), the
 * message degrades gracefully to a price-only suggestion.
 */
function suggestBudgetAdjustment({
  budgetInr,
  resultCount,
  cheapestOverBudgetInr,
  cheapestOverBudgetCandidate = null,
  requestedDepartureDate = null,
}) {
  if (!budgetInr || cheapestOverBudgetInr == null) return null;

  const priceText = `₹${cheapestOverBudgetInr.toLocaleString('en-IN')}`;

  // Only describe an "alternate date" / "alternate destination" when we
  // actually have the real candidate to compare against the request — this
  // is real data already present in this search's own results, not a fresh
  // lookup.
  const isAlternateDate = Boolean(
    cheapestOverBudgetCandidate?.departureDate &&
      requestedDepartureDate &&
      cheapestOverBudgetCandidate.departureDate !== requestedDepartureDate
  );
  const alternateDestinationCity = cheapestOverBudgetCandidate?.destinationAirports?.[0]?.city || null;

  const context = [];
  if (isAlternateDate) context.push(`departing ${cheapestOverBudgetCandidate.departureDate}`);
  if (alternateDestinationCity) context.push(`to ${alternateDestinationCity}`);
  const contextSuffix = context.length ? ` (${context.join(', ')})` : '';

  const base = {
    suggestedBudgetInr: cheapestOverBudgetInr,
    alternateDate: isAlternateDate ? cheapestOverBudgetCandidate.departureDate : null,
    alternateDestinationCity,
  };

  if (resultCount === 0) {
    return {
      ...base,
      message: `Your budget wasn't quite enough for any trip we found — raising it to about ${priceText} would unlock at least one option${contextSuffix}.`,
    };
  }

  // Still got some results, but a meaningfully cheaper next-best option was
  // right on the other side of the budget line — worth a nudge, not an alarm.
  const isCloseMiss = cheapestOverBudgetInr <= budgetInr * 1.15;
  if (isCloseMiss) {
    return {
      ...base,
      message: `A trip for about ${priceText}${contextSuffix} (just above your budget) was found — a small increase could unlock more options.`,
    };
  }

  return null;
}

/**
 * Midpoint of a {min, max} range, or null when the range itself is null
 * (e.g. one-way trips, where no living-cost estimate is possible).
 */
function midpoint(range) {
  return range ? (range.min + range.max) / 2 : null;
}

/**
 * Real (never invented) candidates that are within budget, drawn straight
 * from the full fetched candidate set — independent of the normal-display
 * pruning rules (stop-count ceiling, duplicate de-dup, relative-duration
 * ceiling) applied by stages/pruning.js for what's shown to the user.
 *
 * The Budget Optimizer answers "what can I actually afford", not "what's a
 * pleasant flight to display", so its candidate pool must be every real
 * fetched candidate that fits the budget — not just the smaller subset that
 * also happened to survive those unrelated display-quality filters. This is
 * a read-only budget filter only: it does not touch stop count, duration, or
 * duplicates, and it never alters the candidates it's given.
 */
function filterRealCandidatesWithinBudget(candidates = [], budgetInr) {
  if (!budgetInr) return candidates.slice();
  return candidates.filter((c) => c.totalPriceInr <= budgetInr);
}

/**
 * The Smart Budget Optimizer's single entry point: given the REAL candidates
 * that survived budget pruning for this search (never a fresh lookup, never
 * an invented one), decides what to tell the user about their budget.
 *
 * Case A — one or more candidates fit the budget: picks the best-value one
 * by comparing real flight price + estimated total trip cost (flight +
 * stay/food/local-travel) across the in-budget set, using trip duration only
 * to break ties between options that cost about the same. Returns that
 * candidate's own per-recommendation budget breakdown plus a short, honest
 * explanation built from those same numbers.
 *
 * Case B — nothing fits: defers entirely to `suggestBudgetAdjustment`, which
 * already knows how to surface the real cheapest over-budget candidate, a
 * real alternate date/destination when one exists in this same search's
 * results, or (when neither exists) the plain required budget increase.
 *
 * Every field returned traces back to a candidate that was actually part of
 * this search — nothing is fabricated, no extra flight/price lookups happen.
 */
function selectBudgetOptimizerPick({
  candidates = [],
  budgetInr,
  travelers = 1,
  cheapestOverBudgetInr = null,
  cheapestOverBudgetCandidate = null,
  requestedDepartureDate = null,
} = {}) {
  if (!budgetInr) return null;

  if (candidates.length === 0) {
    const suggestion = suggestBudgetAdjustment({
      budgetInr,
      resultCount: 0,
      cheapestOverBudgetInr,
      cheapestOverBudgetCandidate,
      requestedDepartureDate,
    });
    return {
      status: 'over_budget',
      bestValueCandidate: null,
      budgetInsight: null,
      reason: null,
      // Real numbers only: the cheapest actual over-budget candidate found
      // during this same search, if any, and the resulting suggestion.
      cheapestRealCandidate: cheapestOverBudgetCandidate,
      requiredBudgetIncreaseInr:
        cheapestOverBudgetInr != null ? Math.max(0, cheapestOverBudgetInr - budgetInr) : null,
      suggestion,
    };
  }

  // Rank the real in-budget candidates by estimated total trip cost
  // (midpoint of flight + stay/food/local-travel), falling back to flight
  // price alone when no trip-length estimate is possible (one-way trips),
  // then by duration to prefer the faster option among near-equal costs.
  let best = null;
  let bestInsight = null;
  let bestCostForRanking = Infinity;

  for (const candidate of candidates) {
    const insight = estimateBudgetBreakdown({
      flightCostInr: candidate.totalPriceInr,
      budgetInr,
      travelers,
      departureDate: candidate.departureDate,
      returnDate: candidate.returnDate,
    });
    const costForRanking = midpoint(insight?.estimatedTotalTripCostInr) ?? candidate.totalPriceInr;

    const isBetter =
      best === null ||
      costForRanking < bestCostForRanking ||
      (costForRanking === bestCostForRanking &&
        candidate.totalDurationMinutes < best.totalDurationMinutes);

    if (isBetter) {
      best = candidate;
      bestInsight = insight;
      bestCostForRanking = costForRanking;
    }
  }

  const totalCostText = bestInsight?.estimatedTotalTripCostInr
    ? `an estimated total trip cost of ₹${Math.round(bestInsight.estimatedTotalTripCostInr.min).toLocaleString(
        'en-IN'
      )}–₹${Math.round(bestInsight.estimatedTotalTripCostInr.max).toLocaleString('en-IN')}`
    : `a flight price of ₹${best.totalPriceInr.toLocaleString('en-IN')}`;
  const durationText =
    candidates.length > 1 && best.totalDurationMinutes != null
      ? ` and a ${Math.round(best.totalDurationMinutes / 60)}h total trip time`
      : '';
  const reason = `Out of ${candidates.length} option${
    candidates.length > 1 ? 's' : ''
  } that fit your budget, this one has ${totalCostText}${durationText} — the best real balance of cost and budget fit found in this search.`;

  return {
    status: 'within_budget',
    bestValueCandidate: best,
    budgetInsight: bestInsight,
    reason,
    cheapestRealCandidate: null,
    requiredBudgetIncreaseInr: null,
    suggestion: null,
  };
}

module.exports = {
  computeNights,
  estimateBudgetBreakdown,
  estimateLivingCostEstimate,
  suggestBudgetAdjustment,
  splitLivingCostRange,
  selectBudgetOptimizerPick,
  filterRealCandidatesWithinBudget,
};
