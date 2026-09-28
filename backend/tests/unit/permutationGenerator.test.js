const {
  permuteCountries,
  buildSingleDestinationCandidates,
  buildMultiCountryCandidates,
  capPermutations,
} = require('../../src/optimizer/permutationGenerator');
const AppError = require('../../src/utils/AppError');

function airport(iata, distanceKm = 0) {
  return { iata, city: iata, distanceKm };
}

describe('permuteCountries', () => {
  test('returns a single ordering (wrapped) for 0 or 1 countries', () => {
    expect(permuteCountries([])).toEqual([[]]);
    expect(permuteCountries(['GB'])).toEqual([['GB']]);
  });

  test('generates all N! orderings for N countries', () => {
    expect(permuteCountries(['GB', 'FR'])).toHaveLength(2);
    expect(permuteCountries(['GB', 'FR', 'DE'])).toHaveLength(6);
    expect(permuteCountries(['GB', 'FR', 'DE', 'IT'])).toHaveLength(24);
  });

  test('throws OPTIMIZER_TOO_MANY_COUNTRIES beyond the configured cap (default 4)', () => {
    expect(() => permuteCountries(['GB', 'FR', 'DE', 'IT', 'ES'])).toThrow(AppError);
    try {
      permuteCountries(['GB', 'FR', 'DE', 'IT', 'ES']);
    } catch (err) {
      expect(err.errorCode).toBe('OPTIMIZER_TOO_MANY_COUNTRIES');
      expect(err.statusCode).toBe(400);
    }
  });
});

describe('buildSingleDestinationCandidates', () => {
  test('builds a 2-leg round trip with correct dates when returnDate is present', () => {
    const candidates = buildSingleDestinationCandidates(
      [airport('DEL')],
      [airport('LHR')],
      [{ departureDate: '2026-08-15', returnDate: '2026-08-22', flexScore: 0 }]
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].legs).toEqual([
      { fromIata: 'DEL', toIata: 'LHR', date: '2026-08-15' },
      { fromIata: 'LHR', toIata: 'DEL', date: '2026-08-22' },
    ]);
  });

  test('builds a single one-way leg when returnDate is absent', () => {
    const candidates = buildSingleDestinationCandidates(
      [airport('DEL')],
      [airport('LHR')],
      [{ departureDate: '2026-08-15', returnDate: null, flexScore: 0 }]
    );
    expect(candidates[0].legs).toHaveLength(1);
  });

  test('produces origin x destination x dates cartesian product', () => {
    const candidates = buildSingleDestinationCandidates(
      [airport('DEL'), airport('BOM')],
      [airport('LHR'), airport('LGW')],
      [{ departureDate: '2026-08-15', returnDate: null, flexScore: 0 }]
    );
    expect(candidates).toHaveLength(4);
  });

  test('airportPenalty sums origin and destination distanceKm', () => {
    const candidates = buildSingleDestinationCandidates(
      [airport('DEL', 40)],
      [airport('LGW', 60)],
      [{ departureDate: '2026-08-15', returnDate: null, flexScore: 0 }]
    );
    expect(candidates[0].airportPenalty).toBe(100);
  });
});

describe('buildMultiCountryCandidates', () => {
  test('produces one extra leg beyond the number of destination countries (return to origin)', () => {
    const candidates = buildMultiCountryCandidates(
      [airport('DEL')],
      [[airport('LHR')], [airport('CDG')]],
      [{ departureDate: '2026-09-01', returnDate: '2026-09-10', flexScore: 0 }]
    );
    expect(candidates).toHaveLength(2);
    expect(candidates[0].legs).toHaveLength(3);
  });

  test('leg dates are staggered, not all identical', () => {
    const candidates = buildMultiCountryCandidates(
      [airport('DEL')],
      [[airport('LHR')], [airport('CDG')]],
      [{ departureDate: '2026-09-01', returnDate: '2026-09-10', flexScore: 0 }]
    );
    const dates = candidates[0].legs.map((l) => l.date);
    expect(new Set(dates).size).toBeGreaterThan(1);
  });

  test('every leg correctly chains from -> to across the circuit', () => {
    const candidates = buildMultiCountryCandidates(
      [airport('DEL')],
      [[airport('LHR')], [airport('CDG')]],
      [{ departureDate: '2026-09-01', returnDate: '2026-09-10', flexScore: 0 }]
    );
    const legs = candidates[0].legs;
    for (let i = 1; i < legs.length; i++) {
      expect(legs[i].fromIata).toBe(legs[i - 1].toIata);
    }
    expect(legs[legs.length - 1].toIata).toBe('DEL');
  });

  test('this is a REAL connected circuit, not independent round trips per country', () => {
    const candidates = buildMultiCountryCandidates(
      [airport('DEL')],
      [[airport('LHR')], [airport('CDG')], [airport('FCO')]],
      [{ departureDate: '2026-09-01', returnDate: '2026-09-15', flexScore: 0 }]
    );
    // Every candidate must visit all 3 destination countries in ONE trip
    // (origin -> c1 -> c2 -> c3 -> origin), never a separate 2-leg
    // origin<->country round trip per country.
    for (const candidate of candidates) {
      expect(candidate.legs).toHaveLength(4);
      expect(candidate.destinationAirports).toHaveLength(3);
    }
  });

  test('generates every N! country ordering (e.g. LHR-CDG-FCO in all 6 orders)', () => {
    const candidates = buildMultiCountryCandidates(
      [airport('DEL')],
      [[airport('LHR')], [airport('CDG')], [airport('FCO')]],
      [{ departureDate: '2026-09-01', returnDate: '2026-09-15', flexScore: 0 }]
    );
    const orderings = new Set(
      candidates.map((c) => c.destinationAirports.map((a) => a.iata).join('>'))
    );
    expect(orderings.size).toBe(6); // 3! = 6
  });

  test('varies which airport is used per country (not just the top-ranked one)', () => {
    const candidates = buildMultiCountryCandidates(
      [airport('DEL')],
      [
        [airport('FCO'), airport('MXP')],
        [airport('CDG'), airport('ORY')],
      ],
      [{ departureDate: '2026-09-01', returnDate: '2026-09-10', flexScore: 0 }]
    );
    // 2 orderings x 2x2 airport combos = 8 candidates total
    expect(candidates).toHaveLength(8);
    const usedItalyAirports = new Set(
      candidates.map((c) => c.destinationAirports.find((a) => a.iata === 'FCO' || a.iata === 'MXP')?.iata)
    );
    expect(usedItalyAirports).toEqual(new Set(['FCO', 'MXP']));
  });

  test('a country with no available airports collapses to zero candidates rather than dropping the country or crashing', () => {
    const candidates = buildMultiCountryCandidates(
      [airport('DEL')],
      [[airport('LHR')], []],
      [{ departureDate: '2026-09-01', returnDate: '2026-09-10', flexScore: 0 }]
    );
    expect(candidates).toEqual([]);
  });

  test('airportPenalty sums origin and every destination airport distanceKm', () => {
    const candidates = buildMultiCountryCandidates(
      [airport('DEL', 10)],
      [[airport('LHR', 20)], [airport('CDG', 30)]],
      [{ departureDate: '2026-09-01', returnDate: '2026-09-10', flexScore: 0 }]
    );
    expect(candidates[0].airportPenalty).toBe(60);
  });
});

describe('capPermutations', () => {
  function fakeCandidate(flexScore, airportPenalty) {
    return { flexScore, airportPenalty };
  }

  test('does not cap when under the limit', () => {
    const candidates = [fakeCandidate(0, 0), fakeCandidate(1, 0)];
    const result = capPermutations(candidates);
    expect(result.wasCapped).toBe(false);
    expect(result.candidates).toHaveLength(2);
  });

  test('caps at config.optimizer.maxPermutations and flags wasCapped', () => {
    const config = require('../../src/config/env');
    const many = Array.from({ length: config.optimizer.maxPermutations + 50 }, (_, i) => fakeCandidate(i, 0));
    const result = capPermutations(many);
    expect(result.candidates).toHaveLength(config.optimizer.maxPermutations);
    expect(result.wasCapped).toBe(true);
    expect(result.totalGenerated).toBe(many.length);
  });

  test('keeps the lowest flexScore + airportPenalty candidates when truncating', () => {
    const config = require('../../src/config/env');
    const many = Array.from({ length: config.optimizer.maxPermutations + 10 }, (_, i) =>
      fakeCandidate(config.optimizer.maxPermutations + 10 - i, 0)
    );
    const result = capPermutations(many);
    const maxSurvivingScore = Math.max(...result.candidates.map((c) => c.flexScore));
    expect(maxSurvivingScore).toBeLessThanOrEqual(config.optimizer.maxPermutations);
  });
});
