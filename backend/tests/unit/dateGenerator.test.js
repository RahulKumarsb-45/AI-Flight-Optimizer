const { generateDatePairs } = require('../../src/optimizer/dateGenerator');

describe('generateDatePairs', () => {
  test('returns exactly one pair when dateFlexible is false', () => {
    const result = generateDatePairs({
      departureDate: '2026-08-15',
      returnDate: '2026-08-22',
      dateFlexible: false,
    });
    expect(result).toEqual([{ departureDate: '2026-08-15', returnDate: '2026-08-22', flexScore: 0 }]);
  });

  test('respects the configured ±3 day flex cap regardless of stay-length range', () => {
    const result = generateDatePairs({
      departureDate: '2026-08-15',
      returnDate: '2026-08-22',
      dateFlexible: true,
    });
    expect(result).toHaveLength(7);
  });

  test('the exact requested pair is included and ranks first (flexScore 0)', () => {
    const result = generateDatePairs({
      departureDate: '2026-08-15',
      returnDate: '2026-08-22',
      dateFlexible: true,
    });
    expect(result[0]).toEqual({ departureDate: '2026-08-15', returnDate: '2026-08-22', flexScore: 0 });
  });

  test('preserves trip duration for every generated pair when no min/max stay given', () => {
    const result = generateDatePairs({
      departureDate: '2026-08-15',
      returnDate: '2026-08-22',
      dateFlexible: true,
    });
    for (const pair of result) {
      const days = (new Date(pair.returnDate) - new Date(pair.departureDate)) / 86400000;
      expect(days).toBe(7);
    }
  });

  test('expands stay-length range when minStayDays/maxStayDays are given', () => {
    const result = generateDatePairs({
      departureDate: '2026-08-15',
      returnDate: '2026-08-22',
      dateFlexible: true,
      minStayDays: 5,
      maxStayDays: 7,
    });
    // 7 departure dates × 3 possible stay lengths (5,6,7) = 21 pairs
    expect(result).toHaveLength(21);
  });

  test('one-way flexible trip (no returnDate) returns null returnDate for every candidate', () => {
    const result = generateDatePairs({
      departureDate: '2026-08-15',
      dateFlexible: true,
    });
    expect(result).toHaveLength(7);
    for (const pair of result) {
      expect(pair.returnDate).toBeNull();
    }
  });

  test('caps an excessively wide stay-length range instead of multiplying combinations unbounded', () => {
    const result = generateDatePairs({
      departureDate: '2026-08-15',
      returnDate: '2026-08-22',
      dateFlexible: true,
      minStayDays: 1,
      maxStayDays: 60, // deliberately excessive — should be clamped, not honored literally
    });
    // 7 departure dates × capped stay-range width (1..8 = 8 lengths) = 56, NOT 7*60=420
    expect(result.length).toBeLessThan(100);
    expect(result.length).toBe(7 * 8);
  });
});
