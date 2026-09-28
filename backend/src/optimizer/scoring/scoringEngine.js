/**
 * Weight profiles per user preference. Weather/season scoring hooks are
 * present but default to a neutral contribution (0.5) until the AI phase
 * (Part 4) supplies real weather/season scores per destination — keeping
 * the field here now means that phase only needs to populate a number,
 * not change this engine's shape.
 */
const WEIGHT_PROFILES = {
  cheapest: { price: 0.7, duration: 0.15, stops: 0.15, weather: 0, season: 0 },
  fastest: { price: 0.15, duration: 0.65, stops: 0.2, weather: 0, season: 0 },
  balanced: { price: 0.4, duration: 0.3, stops: 0.2, weather: 0.05, season: 0.05 },
};

/**
 * Min-max normalizes a value into a 0-1 "goodness" score where 1 = best in set.
 * Lower raw value = better for price/duration/stops (cheaper/faster/fewer stops wins).
 */
function normalizeInverse(value, min, max) {
  if (max === min) return 1; // all candidates identical on this dimension
  return 1 - (value - min) / (max - min);
}

/**
 * Scores every candidate 0-100 using the weight profile for the requested
 * preference. Returns candidates sorted best-first, each annotated with
 * `score` and `scoreBreakdown` (per-factor contribution — this feeds the
 * template-based explainability engine directly, no LLM call needed).
 */
function scoreCandidates(candidates, preference = 'balanced') {
  if (candidates.length === 0) return [];

  const weights = WEIGHT_PROFILES[preference] || WEIGHT_PROFILES.balanced;

  const prices = candidates.map((c) => c.totalPriceInr);
  const durations = candidates.map((c) => c.totalDurationMinutes);
  const stops = candidates.map((c) => c.totalStops);

  const priceRange = [Math.min(...prices), Math.max(...prices)];
  const durationRange = [Math.min(...durations), Math.max(...durations)];
  const stopsRange = [Math.min(...stops), Math.max(...stops)];

  const scored = candidates.map((c) => {
    const priceScore = normalizeInverse(c.totalPriceInr, ...priceRange);
    const durationScore = normalizeInverse(c.totalDurationMinutes, ...durationRange);
    const stopsScore = normalizeInverse(c.totalStops, ...stopsRange);
    const weatherScore = 0.5; // neutral placeholder — populated in AI phase
    const seasonScore = 0.5; // neutral placeholder — populated in AI phase

    const weighted =
      priceScore * weights.price +
      durationScore * weights.duration +
      stopsScore * weights.stops +
      weatherScore * weights.weather +
      seasonScore * weights.season;

    return {
      ...c,
      score: Math.round(weighted * 100),
      scoreBreakdown: {
        price: { value: c.totalPriceInr, normalized: priceScore, weight: weights.price },
        duration: { value: c.totalDurationMinutes, normalized: durationScore, weight: weights.duration },
        stops: { value: c.totalStops, normalized: stopsScore, weight: weights.stops },
      },
    };
  });

  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Convenience: picks distinct "best of" categories from a scored set,
 * regardless of the primary preference used for the main ranking.
 */
function pickCategories(candidates) {
  if (candidates.length === 0) return {};
  const cheapest = [...candidates].sort((a, b) => a.totalPriceInr - b.totalPriceInr)[0];
  const fastest = [...candidates].sort((a, b) => a.totalDurationMinutes - b.totalDurationMinutes)[0];
  const balanced = [...candidates].sort((a, b) => b.score - a.score)[0];
  return { cheapest, fastest, balanced };
}

module.exports = { scoreCandidates, pickCategories, WEIGHT_PROFILES };
