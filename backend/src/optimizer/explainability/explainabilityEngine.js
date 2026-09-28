/**
 * TEMPLATE-BASED EXPLAINABILITY (per architecture decision: search-result
 * explanations are rule/template-based, not LLM-generated — this keeps them
 * free, instant, and deterministic. LLM-generated conversational explanations
 * are a separate concern, handled by the AI Chat module, not here.)
 */

function formatInr(amount) {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Explains why `candidate` ranked where it did, primarily by comparing it
 * against the next-best alternative on whichever dimension the requested
 * preference cares about most.
 */
function explainCandidate(candidate, allCandidates, preference = 'balanced') {
  const rank = allCandidates.findIndex((c) => c === candidate);
  const reasons = [];

  if (rank === 0) {
    reasons.push(buildTopPickReason(candidate, allCandidates, preference));
  } else {
    const topPick = allCandidates[0];
    reasons.push(buildComparisonReason(candidate, topPick));
  }

  if (candidate.totalStops === 0) {
    reasons.push('This is a direct flight with no layovers.');
  } else if (candidate.totalStops === 1) {
    reasons.push('This itinerary has one layover.');
  } else {
    reasons.push(`This itinerary has ${candidate.totalStops} layovers.`);
  }

  const nonPrimaryAirports = [candidate.originAirport, ...(candidate.destinationAirports || [])]
    .filter((a) => a && a.isPrimary === false);
  if (nonPrimaryAirports.length > 0) {
    const names = nonPrimaryAirports.map((a) => `${a.city} (${a.iata})`).join(', ');
    reasons.push(`Uses a nearby airport (${names}) instead of the main one — often cheaper for a short extra journey.`);
  }

  return reasons.join(' ');
}

function buildTopPickReason(candidate, allCandidates, preference) {
  const preferenceLabel = { cheapest: 'lowest price', fastest: 'shortest travel time', balanced: 'best overall balance of price and time' }[preference] || 'best overall value';

  if (allCandidates.length === 1) {
    return `Recommended: ${formatInr(candidate.totalPriceInr)}, ${formatDuration(candidate.totalDurationMinutes)} total travel time.`;
  }

  return `Top pick for ${preferenceLabel} — ${formatInr(candidate.totalPriceInr)} total, ${formatDuration(candidate.totalDurationMinutes)} travel time.`;
}

function buildComparisonReason(candidate, topPick) {
  const priceDiff = candidate.totalPriceInr - topPick.totalPriceInr;
  const durationDiffMinutes = candidate.totalDurationMinutes - topPick.totalDurationMinutes;

  const parts = [];

  if (priceDiff > 0) {
    parts.push(`costs ${formatInr(priceDiff)} more than the top pick`);
  } else if (priceDiff < 0) {
    parts.push(`costs ${formatInr(Math.abs(priceDiff))} less than the top pick`);
  }

  if (Math.abs(durationDiffMinutes) >= 15) {
    if (durationDiffMinutes < 0) {
      parts.push(`saves ${formatDuration(Math.abs(durationDiffMinutes))}`);
    } else {
      parts.push(`takes ${formatDuration(durationDiffMinutes)} longer`);
    }
  }

  if (candidate.totalStops < topPick.totalStops) {
    parts.push('has fewer layovers');
  } else if (candidate.totalStops > topPick.totalStops) {
    parts.push('has more layovers');
  }

  if (parts.length === 0) {
    return 'A comparable alternative to the top pick.';
  }

  const joined = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} but ${parts[parts.length - 1]}`;
  return `This option ${joined}.`;
}

/**
 * Explains category picks (cheapest / fastest / balanced) relative to each other —
 * used on the results page's "compare" view.
 */
function explainCategoryPicks({ cheapest, fastest, balanced }) {
  if (!cheapest || !fastest) return {};

  const priceSavings = fastest.totalPriceInr - cheapest.totalPriceInr;
  const timeCost = cheapest.totalDurationMinutes - fastest.totalDurationMinutes;

  return {
    cheapest: `${formatInr(cheapest.totalPriceInr)} — the lowest price found, but ${formatDuration(Math.abs(timeCost))} slower than the fastest option.`,
    fastest: `${formatDuration(fastest.totalDurationMinutes)} — the quickest way to get there, for ${formatInr(Math.abs(priceSavings))} more than the cheapest option.`,
    balanced: balanced
      ? `${formatInr(balanced.totalPriceInr)}, ${formatDuration(balanced.totalDurationMinutes)} — the best trade-off between price and travel time.`
      : undefined,
  };
}

module.exports = { explainCandidate, explainCategoryPicks, formatInr, formatDuration };
