/**
 * Expense Calculator — user-facing feature that assembles a full trip
 * expense breakdown purely from data the app has ALREADY computed
 * elsewhere. It never invents a flight, hotel, restaurant, or attraction
 * price and never calls a network API itself.
 *
 * Sources, all read-only:
 *  - Flight: the REAL selected/recommended flight price for all travelers
 *    combined (`recommendation.totalPriceInr`, produced by the flight
 *    provider + optimizer pipeline). This module treats it as a single
 *    actual amount, never a range, and never re-derives or re-multiplies it.
 *  - Accommodation / food / local transport: the existing Budget
 *    Optimizer's per-recommendation `categoryBreakdown`
 *    (backend `budgetEstimator.estimateBudgetBreakdown`), which already
 *    accounts for travelers and trip length (nights). This module reuses
 *    those ranges as-is — it does not recompute or duplicate that logic.
 *  - Tourist attractions: the existing `estimateAttractionsCostInr` heuristic
 *    (Google Places qualitative price-level based), passed in already
 *    computed by the caller.
 *  - Miscellaneous: a small, clearly-labeled buffer for incidentals not
 *    covered by any category above (tips, SIM cards, small purchases) — a
 *    fixed share of the *other estimated* categories only. It is never
 *    applied to the real flight price, and it is derived once from a single
 *    subtotal so it can't silently absorb the same money twice.
 *
 * Every category is tagged so the UI can clearly distinguish real data
 * (flight) from heuristic planning ranges (everything else), and so any
 * category that could not be estimated (e.g. no budget was supplied, so no
 * living-cost range exists; or a one-way trip, so there are no nights to
 * spread a cost across) shows up as unavailable rather than silently zero.
 */

// Heuristic-only buffer, not sourced from any pricing API. Applied to the
// subtotal of the other *estimated* categories (accommodation + food +
// local transport + attractions) — never to the real flight price.
const MISCELLANEOUS_SHARE_OF_ESTIMATES = 0.08;

/**
 * Sums an array of {min, max} ranges, ignoring any null/undefined entries.
 * Returns null when nothing is present, so callers can tell "zero" apart
 * from "not enough data to say".
 */
function sumRanges(ranges) {
  const present = (ranges || []).filter(Boolean);
  if (present.length === 0) return null;
  return present.reduce(
    (acc, r) => ({ min: acc.min + r.min, max: acc.max + r.max }),
    { min: 0, max: 0 }
  );
}

/** Scales a {min, max} range by a factor, rounding to whole rupees. */
function scaleRange(range, factor) {
  if (!range) return null;
  return { min: Math.round(range.min * factor), max: Math.round(range.max * factor) };
}

function categoryEntry(range, extra = {}) {
  return range
    ? { rangeInr: range, isEstimated: true, isAvailable: true, ...extra }
    : { rangeInr: null, isEstimated: true, isAvailable: false, ...extra };
}

/**
 * Builds the full Expense Calculator breakdown.
 *
 * @param {number} flightCostInr - Real, actual total flight price for all
 *   travelers combined (never invented; comes straight from the selected
 *   recommendation). Required — without it there's nothing to calculate.
 * @param {object|null} budgetInsight - The existing per-recommendation
 *   Budget Optimizer output (`recommendation.budgetInsight`), or null when
 *   the user's search didn't include a budget. Supplies `nights`,
 *   `budgetInr`, and `categoryBreakdown` (accommodation/food/localTransport)
 *   — all already travelers- and duration-aware. Never recomputed here.
 * @param {object|null} livingCostEstimate - The existing budget-independent
 *   living-cost heuristic (`recommendation.livingCostEstimate`, produced by
 *   backend `budgetEstimator.estimateLivingCostEstimate`). Supplies the same
 *   `nights`/`categoryBreakdown` shape as `budgetInsight` but never requires
 *   a budget to exist. Used only as a fallback when `budgetInsight` is null
 *   (i.e. no budget was supplied) — when a budget WAS supplied,
 *   `budgetInsight` remains the single source, so nothing here is ever
 *   combined with it or double-counted.
 * @param {{min:number,max:number,basedOnCount:number}|null} attractionsEstimate
 *   - The existing tourist-attractions heuristic estimate, or null when it
 *   hasn't loaded / isn't available.
 * @param {number} travelers - Passed through for display only; every
 *   monetary figure above is already travelers-aware upstream, so this
 *   function never multiplies by travelers itself (that would double-count).
 */
function computeExpenseBreakdown({
  flightCostInr,
  budgetInsight = null,
  livingCostEstimate = null,
  attractionsEstimate = null,
  travelers = 1,
} = {}) {
  if (flightCostInr == null || Number.isNaN(flightCostInr)) return null;

  // budgetInsight and livingCostEstimate are never both used at once: when a
  // budget was supplied, budgetInsight already carries this same
  // nights/categoryBreakdown heuristic (see backend budgetEstimator.js), so
  // livingCostEstimate is only consulted as a fallback when there's no
  // budget — this can't double-count the same figures under two labels.
  const nights = budgetInsight?.nights ?? livingCostEstimate?.nights ?? null;
  const budgetInr = budgetInsight?.budgetInr ?? null;
  const categoryBreakdown = budgetInsight?.categoryBreakdown ?? livingCostEstimate?.categoryBreakdown ?? null;

  const accommodationRange = categoryBreakdown?.accommodation ?? null;
  const foodRange = categoryBreakdown?.food ?? null;
  const localTransportRange = categoryBreakdown?.localTransport ?? null;
  const attractionsRange = attractionsEstimate
    ? { min: attractionsEstimate.min, max: attractionsEstimate.max }
    : null;

  // Miscellaneous is derived exactly once, from a single subtotal of the
  // *other estimated* categories only — never from the flight price, and
  // never re-derived from an already-combined total (that would double
  // count the same rupees under two labels).
  const estimatedSubtotal = sumRanges([accommodationRange, foodRange, localTransportRange, attractionsRange]);
  const miscellaneousRange = estimatedSubtotal
    ? scaleRange(estimatedSubtotal, MISCELLANEOUS_SHARE_OF_ESTIMATES)
    : null;

  const categories = {
    flight: { amountInr: flightCostInr, isEstimated: false, isAvailable: true, source: 'actual' },
    accommodation: categoryEntry(accommodationRange),
    food: categoryEntry(foodRange),
    localTransport: categoryEntry(localTransportRange),
    attractions: categoryEntry(
      attractionsRange,
      attractionsEstimate ? { basedOnCount: attractionsEstimate.basedOnCount } : {}
    ),
    miscellaneous: categoryEntry(miscellaneousRange),
  };

  // Total = the one real flight amount + every other category's range,
  // summed exactly once each. Flight is deliberately excluded from
  // `estimatedSubtotal`/`miscellaneousRange` above, so there's no overlap
  // between "real" and "estimated" money here.
  const otherTotal = sumRanges([accommodationRange, foodRange, localTransportRange, attractionsRange, miscellaneousRange]);
  const totalTripExpenseInr = otherTotal
    ? { min: flightCostInr + otherTotal.min, max: flightCostInr + otherTotal.max }
    : { min: flightCostInr, max: flightCostInr };

  // Conservative (worst-case) comparison against budget: uses the top of
  // the total range, so "remaining budget" never overstates what's left.
  let remainingBudgetInr = null;
  let overBudgetInr = null;
  if (budgetInr) {
    const diff = budgetInr - totalTripExpenseInr.max;
    if (diff >= 0) remainingBudgetInr = diff;
    else overBudgetInr = Math.abs(diff);
  }

  return {
    travelers,
    nights,
    budgetInr,
    categories,
    totalTripExpenseInr,
    remainingBudgetInr,
    overBudgetInr,
    hasFullEstimate: Boolean(accommodationRange && foodRange && localTransportRange),
    note:
      'Flight is the actual recommended price. Accommodation, food, local transport, attractions, and miscellaneous are heuristic planning ranges — not real prices for this destination.',
  };
}

module.exports = {
  computeExpenseBreakdown,
  sumRanges,
  scaleRange,
  MISCELLANEOUS_SHARE_OF_ESTIMATES,
};
