/**
 * PDF Export — pure data-assembly layer, no PDF library, no React, no
 * network calls. Turns already-computed Trip Timeline (`buildTripTimeline`,
 * see utils/tripTimeline.js) and Expense Calculator (`computeExpenseBreakdown`,
 * see utils/expenseCalculator.js) output into a flat, renderer-agnostic
 * "report model" that `generateTripPdf.js` draws onto a PDF page.
 *
 * This module deliberately does NOT recompute anything those two modules
 * already produced — it only reshapes their existing output for layout
 * purposes (grouping, presence flags) and reuses `utils/format.js` for any
 * display strings. Trip origin/destination(s), flights, day-by-day
 * itinerary, hotels, attractions, and restaurants all come straight from
 * the `timeline` argument (already reused from the real Trip Timeline);
 * the expense breakdown, its total, and budget/remaining figures all come
 * straight from the `expenseBreakdown` argument (already reused from the
 * real Expense Calculator). Nothing here invents a value — a missing
 * section is simply flagged unavailable so the renderer can say so rather
 * than guess.
 */

/**
 * @param {object} params
 * @param {object|null} params.recommendation - The selected recommendation
 *   (`recommendation.originAirport` / `.destinationAirports` / `.legs`),
 *   same object every other trip UI already reads from. Required — there is
 *   nothing to export without it.
 * @param {object|null} params.timeline - The exact return value of
 *   `buildTripTimeline(...)` for this recommendation (see
 *   utils/tripTimeline.js) — the SAME call `TripTimelineCard` already makes
 *   with the same inputs, never a second implementation of that logic.
 * @param {object|null} params.expenseBreakdown - The exact return value of
 *   `computeExpenseBreakdown(...)` for this recommendation (see
 *   utils/expenseCalculator.js) — the SAME object already passed to
 *   `ExpenseCalculatorCard`, not recomputed here.
 * @param {Date} [params.generatedAt] - Defaults to now; only used to stamp
 *   "Generated on" in the PDF, never trip data.
 */
function buildPdfReportModel({ recommendation, timeline = null, expenseBreakdown = null, generatedAt = new Date() }) {
  if (!recommendation) return null;

  const { originAirport = null, destinationAirports = [], legs = [] } = recommendation;

  // Same convention TripTimelineCard/RecommendationCard already use: a
  // circuit has more legs than actual destinations (it ends back at the
  // origin), a single out-and-back or one-way trip doesn't.
  const isCircuit = legs.length > destinationAirports.length;
  const isMultiCity = destinationAirports.length > 1;

  const timelineAvailable = Boolean(timeline?.isAvailable);
  const days = timelineAvailable ? timeline.days : [];

  const routeCities = [originAirport?.city, ...destinationAirports.map((d) => d.city)].filter(Boolean);
  const routeLabel = routeCities.length > 0 ? routeCities.join(' \u2192 ') + (isCircuit ? ' \u2192 ' + originAirport.city : '') : null;

  return {
    generatedAt,
    origin: originAirport ? { iata: originAirport.iata, city: originAirport.city } : null,
    destinations: destinationAirports.map((d) => ({ iata: d.iata, city: d.city })),
    isMultiCity,
    isCircuit,
    routeLabel,
    departureDate: days[0]?.date ?? null,
    returnDate: days.length > 1 ? days[days.length - 1].date : null,
    totalDays: timelineAvailable ? timeline.totalDays : 0,
    timelineAvailable,
    timelineUnavailableReason: !timelineAvailable ? timeline?.reason ?? 'Trip date information is not available.' : null,
    // Per-destination availability flags, straight from buildTripTimeline —
    // not recomputed. Used so the PDF can say "not shown — data hasn't
    // loaded" instead of silently omitting a section.
    hotelsAvailable: Boolean(timeline?.hotelsAvailable),
    attractionsAvailable: Boolean(timeline?.attractionsAvailable),
    restaurantsAvailable: Boolean(timeline?.restaurantsAvailable),
    usedPerDestinationData: Boolean(timeline?.usedPerDestinationData),
    // Each day's entries (flight/accommodation/attractions/restaurants) are
    // passed through completely unmodified from the Trip Timeline result —
    // the renderer reads the same entry shapes TripTimelineCard already
    // renders in the UI.
    days,
    expenseAvailable: Boolean(expenseBreakdown),
    expense: expenseBreakdown
      ? {
          travelers: expenseBreakdown.travelers,
          nights: expenseBreakdown.nights,
          categories: expenseBreakdown.categories,
          totalTripExpenseInr: expenseBreakdown.totalTripExpenseInr,
          budgetInr: expenseBreakdown.budgetInr,
          remainingBudgetInr: expenseBreakdown.remainingBudgetInr,
          overBudgetInr: expenseBreakdown.overBudgetInr,
          hasFullEstimate: expenseBreakdown.hasFullEstimate,
          note: expenseBreakdown.note,
        }
      : null,
  };
}

module.exports = { buildPdfReportModel };
