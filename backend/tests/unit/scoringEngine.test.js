const { scoreCandidates, pickCategories } = require('../../src/optimizer/scoring/scoringEngine');

function candidate(overrides = {}) {
  return {
    totalPriceInr: 50000,
    totalDurationMinutes: 600,
    totalStops: 0,
    ...overrides,
  };
}

describe('scoreCandidates', () => {
  test('returns empty array for empty input', () => {
    expect(scoreCandidates([], 'balanced')).toEqual([]);
  });

  test('cheapest preference ranks the lowest price first even if slower', () => {
    const candidates = [
      candidate({ totalPriceInr: 80000, totalDurationMinutes: 300 }),
      candidate({ totalPriceInr: 30000, totalDurationMinutes: 900 }),
    ];
    const scored = scoreCandidates(candidates, 'cheapest');
    expect(scored[0].totalPriceInr).toBe(30000);
  });

  test('fastest preference ranks the shortest duration first even if pricier', () => {
    const candidates = [
      candidate({ totalPriceInr: 80000, totalDurationMinutes: 300 }),
      candidate({ totalPriceInr: 30000, totalDurationMinutes: 900 }),
    ];
    const scored = scoreCandidates(candidates, 'fastest');
    expect(scored[0].totalDurationMinutes).toBe(300);
  });

  test('falls back to balanced weights for an unknown preference', () => {
    const candidates = [candidate(), candidate({ totalPriceInr: 10000 })];
    const scored = scoreCandidates(candidates, 'not_a_real_preference');
    expect(scored).toHaveLength(2);
    expect(scored[0].score).toBeGreaterThanOrEqual(scored[1].score);
  });

  test('every candidate gets a score between 0 and 100', () => {
    const candidates = [candidate({ totalPriceInr: 20000 }), candidate({ totalPriceInr: 90000, totalStops: 2 })];
    const scored = scoreCandidates(candidates, 'balanced');
    for (const c of scored) {
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(100);
    }
  });

  test('identical candidates on a dimension do not produce NaN scores (division-by-zero guard)', () => {
    const candidates = [candidate(), candidate()]; // identical on every dimension
    const scored = scoreCandidates(candidates, 'balanced');
    for (const c of scored) {
      expect(Number.isNaN(c.score)).toBe(false);
    }
  });

  test('includes a scoreBreakdown with price/duration/stops for explainability', () => {
    const scored = scoreCandidates([candidate()], 'balanced');
    expect(scored[0].scoreBreakdown).toHaveProperty('price');
    expect(scored[0].scoreBreakdown).toHaveProperty('duration');
    expect(scored[0].scoreBreakdown).toHaveProperty('stops');
  });
});

describe('pickCategories', () => {
  test('returns empty object for empty input', () => {
    expect(pickCategories([])).toEqual({});
  });

  test('picks distinct cheapest and fastest when they differ', () => {
    const candidates = scoreCandidates(
      [
        candidate({ totalPriceInr: 20000, totalDurationMinutes: 900 }),
        candidate({ totalPriceInr: 90000, totalDurationMinutes: 300 }),
      ],
      'balanced'
    );
    const categories = pickCategories(candidates);
    expect(categories.cheapest.totalPriceInr).toBe(20000);
    expect(categories.fastest.totalDurationMinutes).toBe(300);
  });

  test('balanced pick is whichever candidate has the highest score', () => {
    const candidates = scoreCandidates(
      [candidate({ totalPriceInr: 50000, totalDurationMinutes: 600 }), candidate({ totalPriceInr: 51000, totalDurationMinutes: 650 })],
      'balanced'
    );
    const categories = pickCategories(candidates);
    const expectedBest = [...candidates].sort((a, b) => b.score - a.score)[0];
    expect(categories.balanced.score).toBe(expectedBest.score);
  });
});
