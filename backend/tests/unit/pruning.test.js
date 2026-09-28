const { pruneCandidates } = require('../../src/optimizer/stages/pruning');

function candidate(overrides = {}) {
  return {
    legs: [{ fromIata: 'DEL', toIata: 'LHR' }],
    departureDate: '2026-08-15',
    totalPriceInr: 50000,
    totalStops: 0,
    totalDurationMinutes: 600,
    ...overrides,
  };
}

describe('pruneCandidates', () => {
  test('removes candidates over budget', () => {
    const candidates = [candidate({ totalPriceInr: 40000 }), candidate({ totalPriceInr: 90000 })];
    const { filtered, reasons } = pruneCandidates(candidates, { budgetInr: 50000 });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].totalPriceInr).toBe(40000);
    expect(reasons.overBudget).toBe(1);
  });

  test('tracks the full cheapest over-budget candidate object, not just its price', () => {
    const candidates = [
      candidate({ totalPriceInr: 90000, departureDate: '2026-08-15' }),
      candidate({ totalPriceInr: 70000, departureDate: '2026-08-17' }),
    ];
    const { cheapestOverBudgetInr, cheapestOverBudgetCandidate } = pruneCandidates(candidates, { budgetInr: 50000 });
    expect(cheapestOverBudgetInr).toBe(70000);
    expect(cheapestOverBudgetCandidate.totalPriceInr).toBe(70000);
    expect(cheapestOverBudgetCandidate.departureDate).toBe('2026-08-17');
  });

  test('does not prune on budget when budgetInr is not provided', () => {
    const candidates = [candidate({ totalPriceInr: 500000 })];
    const { filtered } = pruneCandidates(candidates, {});
    expect(filtered).toHaveLength(1);
  });

  test('removes candidates with more than 3 stops', () => {
    const candidates = [candidate({ totalStops: 2 }), candidate({ totalStops: 4 })];
    const { filtered, reasons } = pruneCandidates(candidates, {});
    expect(filtered).toHaveLength(1);
    expect(reasons.tooManyStops).toBe(1);
  });

  test('removes exact duplicates (same route + date + price)', () => {
    const candidates = [candidate(), candidate(), candidate({ totalPriceInr: 60000 })];
    const { filtered, reasons } = pruneCandidates(candidates, {});
    expect(filtered).toHaveLength(2);
    expect(reasons.duplicate).toBe(1);
  });

  test('does not treat different dates as duplicates', () => {
    const candidates = [candidate({ departureDate: '2026-08-15' }), candidate({ departureDate: '2026-08-16' })];
    const { filtered } = pruneCandidates(candidates, {});
    expect(filtered).toHaveLength(2);
  });

  test('removes candidates far longer than the fastest option (relative duration ceiling)', () => {
    const candidates = [
      candidate({ totalDurationMinutes: 300, totalPriceInr: 10000 }), // fastest
      candidate({ totalDurationMinutes: 1200, totalPriceInr: 20000 }), // 4x fastest, over the 3x ceiling
    ];
    const { filtered, reasons } = pruneCandidates(candidates, {});
    expect(filtered).toHaveLength(1);
    expect(filtered[0].totalDurationMinutes).toBe(300);
    expect(reasons.tooLongDuration).toBe(1);
  });

  test('handles an empty input array without throwing', () => {
    const { filtered, totalBeforePruning, totalAfterPruning } = pruneCandidates([], {});
    expect(filtered).toEqual([]);
    expect(totalBeforePruning).toBe(0);
    expect(totalAfterPruning).toBe(0);
  });

  test('reports accurate before/after counts', () => {
    const candidates = [candidate({ totalPriceInr: 999999 }), candidate({ totalPriceInr: 10000 })];
    const { totalBeforePruning, totalAfterPruning } = pruneCandidates(candidates, { budgetInr: 50000 });
    expect(totalBeforePruning).toBe(2);
    expect(totalAfterPruning).toBe(1);
  });
});
