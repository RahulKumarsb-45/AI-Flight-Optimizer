const MAX_REASONABLE_STOPS = 3;
const MAX_REASONABLE_DURATION_MULTIPLIER = 3; // vs the cheapest-duration candidate in the set

/**
 * Removes candidates that fail hard sanity/business rules. Each rule is
 * applied independently and logged in the returned `prunedReasons` summary
 * so the API response can tell the user *why* some options were dropped
 * (useful for "we found 45 routes, showing the best 5" UX, and for debugging).
 */
function pruneCandidates(candidates, { budgetInr } = {}) {
  const reasons = { overBudget: 0, tooManyStops: 0, tooLongDuration: 0, duplicate: 0 };
  const seen = new Set();

  // Tracked alongside filtering (not instead of it) so the Budget Optimizer
  // can later suggest "raise your budget to ~₹X" using a real observed price
  // from this same search, instead of inventing a number. Only the single
  // cheapest one is kept — that's all a suggestion needs. The full candidate
  // is kept too (not just its price) so the suggestion can also mention a
  // real alternate date/destination when the cheapest over-budget option
  // happens to differ from what was requested.
  let cheapestOverBudgetInr = null;
  let cheapestOverBudgetCandidate = null;

  let filtered = candidates.filter((c) => {
    if (budgetInr && c.totalPriceInr > budgetInr) {
      reasons.overBudget++;
      if (cheapestOverBudgetInr == null || c.totalPriceInr < cheapestOverBudgetInr) {
        cheapestOverBudgetInr = c.totalPriceInr;
        cheapestOverBudgetCandidate = c;
      }
      return false;
    }
    if (c.totalStops > MAX_REASONABLE_STOPS) {
      reasons.tooManyStops++;
      return false;
    }
    return true;
  });

  // duplicate detection: same route + same date + same total price = same itinerary
  filtered = filtered.filter((c) => {
    const key = `${c.legs.map((l) => `${l.fromIata}-${l.toIata}`).join('>')}_${c.departureDate}_${c.totalPriceInr}`;
    if (seen.has(key)) {
      reasons.duplicate++;
      return false;
    }
    seen.add(key);
    return true;
  });

  // relative duration pruning: drop anything wildly longer than the fastest option
  // found (e.g. a 30-hour itinerary when a 9-hour direct exists) — these are
  // almost never what a user wants even if technically "valid".
  if (filtered.length > 0) {
    const fastest = Math.min(...filtered.map((c) => c.totalDurationMinutes));
    const ceiling = fastest * MAX_REASONABLE_DURATION_MULTIPLIER;
    filtered = filtered.filter((c) => {
      if (c.totalDurationMinutes > ceiling) {
        reasons.tooLongDuration++;
        return false;
      }
      return true;
    });
  }

  return {
    filtered,
    reasons,
    totalBeforePruning: candidates.length,
    totalAfterPruning: filtered.length,
    cheapestOverBudgetInr,
    cheapestOverBudgetCandidate,
  };
}

module.exports = { pruneCandidates };
