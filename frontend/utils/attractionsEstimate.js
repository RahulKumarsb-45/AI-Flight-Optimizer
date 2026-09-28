/**
 * Budget Optimizer: heuristic tourist-attraction cost estimate.
 *
 * Google Places only reports a qualitative `priceLevel` per place (e.g.
 * "PRICE_LEVEL_MODERATE"), never an actual amount — so this maps that
 * qualitative signal to a wide, clearly-labeled INR planning range. It is
 * NOT a real price lookup, and it never fires a network request of its own:
 * callers are expected to pass in attraction data that's already been
 * fetched elsewhere (e.g. by TouristAttractionsCard), so this adds an
 * estimate without any additional API calls.
 */
const PRICE_LEVEL_RANGES_INR = {
  PRICE_LEVEL_FREE: { min: 0, max: 0 },
  PRICE_LEVEL_INEXPENSIVE: { min: 200, max: 600 },
  PRICE_LEVEL_MODERATE: { min: 600, max: 1500 },
  PRICE_LEVEL_EXPENSIVE: { min: 1500, max: 3500 },
  PRICE_LEVEL_VERY_EXPENSIVE: { min: 3500, max: 8000 },
};

/**
 * Returns { min, max, basedOnCount } for the trip, or null when there isn't
 * enough reliable data to say anything (no attractions, none with a known
 * price level, or no trip length to spread the estimate across).
 */
export function estimateAttractionsCostInr(attractions, nights) {
  if (!Array.isArray(attractions) || attractions.length === 0 || !nights || nights <= 0) return null;

  const priced = attractions.filter((a) => a?.priceLevel && PRICE_LEVEL_RANGES_INR[a.priceLevel]);
  if (priced.length === 0) return null;

  const avgMin = priced.reduce((sum, a) => sum + PRICE_LEVEL_RANGES_INR[a.priceLevel].min, 0) / priced.length;
  const avgMax = priced.reduce((sum, a) => sum + PRICE_LEVEL_RANGES_INR[a.priceLevel].max, 0) / priced.length;

  // Heuristic: assume roughly one paid attraction visited per day of the
  // trip, capped by how many priced attractions we actually found nearby.
  const attractionsPerTrip = Math.min(nights, priced.length);

  return {
    min: Math.round(avgMin * attractionsPerTrip),
    max: Math.round(avgMax * attractionsPerTrip),
    basedOnCount: priced.length,
  };
}
