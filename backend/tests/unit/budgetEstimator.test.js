const {
  computeNights,
  estimateBudgetBreakdown,
  estimateLivingCostEstimate,
  suggestBudgetAdjustment,
  splitLivingCostRange,
  selectBudgetOptimizerPick,
  filterRealCandidatesWithinBudget,
} = require('../../src/optimizer/budget/budgetEstimator');
const { scoreCandidates, pickCategories } = require('../../src/optimizer/scoring/scoringEngine');
const { pruneCandidates } = require('../../src/optimizer/stages/pruning');

describe('computeNights', () => {
  test('computes nights between two dates', () => {
    expect(computeNights('2026-08-15', '2026-08-20')).toBe(5);
  });

  test('returns null when there is no return date (one-way trip)', () => {
    expect(computeNights('2026-08-15', null)).toBeNull();
  });

  test('returns null for a same-day or invalid (non-positive) range', () => {
    expect(computeNights('2026-08-15', '2026-08-15')).toBeNull();
  });
});

describe('splitLivingCostRange', () => {
  test('returns null when given no range', () => {
    expect(splitLivingCostRange(null)).toBeNull();
  });

  test('splits a range into accommodation/food/local-transport shares that sum back to the total', () => {
    const result = splitLivingCostRange({ min: 10000, max: 20000 });
    const summedMin = result.accommodation.min + result.food.min + result.localTransport.min;
    const summedMax = result.accommodation.max + result.food.max + result.localTransport.max;
    expect(summedMin).toBe(10000);
    expect(summedMax).toBe(20000);
    // accommodation should be the largest single share by default config
    expect(result.accommodation.min).toBeGreaterThanOrEqual(result.food.min);
    expect(result.food.min).toBeGreaterThanOrEqual(result.localTransport.min);
  });
});

describe('estimateBudgetBreakdown', () => {
  test('returns null when no budget was supplied (invalid/missing budget handling)', () => {
    expect(
      estimateBudgetBreakdown({ flightCostInr: 40000, budgetInr: undefined, departureDate: '2026-08-15', returnDate: '2026-08-20' })
    ).toBeNull();
  });

  test('returns null for a zero budget, treating it the same as missing (falsy)', () => {
    expect(
      estimateBudgetBreakdown({ flightCostInr: 40000, budgetInr: 0, departureDate: '2026-08-15', returnDate: '2026-08-20' })
    ).toBeNull();
  });

  test('marks status "comfortable" when the budget fits comfortably, with a matching category breakdown and total', () => {
    const result = estimateBudgetBreakdown({
      flightCostInr: 40000,
      budgetInr: 200000,
      travelers: 1,
      departureDate: '2026-08-15',
      returnDate: '2026-08-20', // 5 nights
    });
    expect(result.nights).toBe(5);
    expect(result.remainingAfterFlightInr).toBe(160000);
    expect(result.status).toBe('comfortable');
    expect(result.categoryBreakdown).toEqual(
      splitLivingCostRange(result.estimatedTripLivingCostInr)
    );
    expect(result.estimatedTotalTripCostInr.min).toBe(result.flightCostInr + result.estimatedTripLivingCostInr.min);
    expect(result.fitSummary).toMatch(/fits within your budget/);
  });

  test('marks status "tight" when the budget is tight after the flight', () => {
    const result = estimateBudgetBreakdown({
      flightCostInr: 90000,
      budgetInr: 100000,
      travelers: 2,
      departureDate: '2026-08-15',
      returnDate: '2026-08-20', // 5 nights
    });
    expect(result.remainingAfterFlightInr).toBe(10000);
    expect(result.status).toBe('tight');
    expect(result.fitSummary).toMatch(/not comfortably above/);
  });

  test('marks status "over" when the budget is exceeded by the flight alone', () => {
    const result = estimateBudgetBreakdown({
      flightCostInr: 120000,
      budgetInr: 100000,
      departureDate: '2026-08-15',
      returnDate: '2026-08-20',
    });
    expect(result.remainingAfterFlightInr).toBe(-20000);
    expect(result.status).toBe('over');
    expect(result.categoryBreakdown).not.toBeNull(); // living-cost range is still computable
    expect(result.fitSummary).toMatch(/already above your budget/);
  });

  test('marks status "unknown" and skips living-cost/category fields when there is no return date', () => {
    const result = estimateBudgetBreakdown({
      flightCostInr: 40000,
      budgetInr: 100000,
      departureDate: '2026-08-15',
      returnDate: null,
    });
    expect(result.nights).toBeNull();
    expect(result.estimatedTripLivingCostInr).toBeNull();
    expect(result.categoryBreakdown).toBeNull();
    expect(result.estimatedTotalTripCostInr).toBeNull();
    expect(result.status).toBe('unknown');
  });

  test('never invents a category breakdown beyond what the daily-living-cost heuristic already computed', () => {
    const result = estimateBudgetBreakdown({
      flightCostInr: 40000,
      budgetInr: 200000,
      departureDate: '2026-08-15',
      returnDate: '2026-08-20',
    });
    // Every category must be derived purely from the trip living-cost range —
    // no independent/extra numbers should appear.
    const total = result.categoryBreakdown.accommodation.max + result.categoryBreakdown.food.max + result.categoryBreakdown.localTransport.max;
    expect(total).toBe(result.estimatedTripLivingCostInr.max);
  });
});

describe('estimateLivingCostEstimate', () => {
  test('computes nights and a category breakdown WITHOUT requiring a budget', () => {
    const result = estimateLivingCostEstimate({
      travelers: 1,
      departureDate: '2026-08-15',
      returnDate: '2026-08-20', // 5 nights
    });
    expect(result.nights).toBe(5);
    expect(result.categoryBreakdown).toEqual(splitLivingCostRange(result.estimatedTripLivingCostInr));
    expect(result.estimatedTripLivingCostInr).not.toBeNull();
  });

  test('scales by travelers the same way as estimateBudgetBreakdown, so figures never double-count', () => {
    const withBudget = estimateBudgetBreakdown({
      flightCostInr: 40000,
      budgetInr: 200000,
      travelers: 2,
      departureDate: '2026-08-15',
      returnDate: '2026-08-20',
    });
    const withoutBudget = estimateLivingCostEstimate({
      travelers: 2,
      departureDate: '2026-08-15',
      returnDate: '2026-08-20',
    });
    expect(withoutBudget.categoryBreakdown).toEqual(withBudget.categoryBreakdown);
    expect(withoutBudget.nights).toBe(withBudget.nights);
  });

  test('returns null nights/categoryBreakdown for a one-way trip (no return date)', () => {
    const result = estimateLivingCostEstimate({ travelers: 1, departureDate: '2026-08-15', returnDate: null });
    expect(result.nights).toBeNull();
    expect(result.categoryBreakdown).toBeNull();
    expect(result.estimatedTripLivingCostInr).toBeNull();
  });

  test('is unaffected by a missing/zero budget, unlike estimateBudgetBreakdown', () => {
    // estimateBudgetBreakdown returns null with no budget — this function must not.
    const result = estimateLivingCostEstimate({
      travelers: 1,
      departureDate: '2026-08-15',
      returnDate: '2026-08-20',
    });
    expect(result).not.toBeNull();
    expect(result.nights).toBe(5);
  });
});

describe('suggestBudgetAdjustment', () => {
  test('returns null when no budget was supplied', () => {
    expect(suggestBudgetAdjustment({ budgetInr: undefined, resultCount: 0, cheapestOverBudgetInr: 60000 })).toBeNull();
  });

  test('returns null when nothing was pruned for budget', () => {
    expect(suggestBudgetAdjustment({ budgetInr: 50000, resultCount: 3, cheapestOverBudgetInr: null })).toBeNull();
  });

  test('suggests the real cheapest over-budget price when there are zero results', () => {
    const result = suggestBudgetAdjustment({ budgetInr: 50000, resultCount: 0, cheapestOverBudgetInr: 62000 });
    expect(result.suggestedBudgetInr).toBe(62000);
    expect(result.message).toMatch(/62,000/);
  });

  test('suggests a close-miss adjustment when results exist but a cheap option was just over budget', () => {
    const result = suggestBudgetAdjustment({ budgetInr: 50000, resultCount: 3, cheapestOverBudgetInr: 53000 });
    expect(result).not.toBeNull();
    expect(result.suggestedBudgetInr).toBe(53000);
  });

  test('does not suggest an adjustment when the next-cheapest option is far above budget', () => {
    const result = suggestBudgetAdjustment({ budgetInr: 50000, resultCount: 3, cheapestOverBudgetInr: 90000 });
    expect(result).toBeNull();
  });

  test('mentions a real alternate date when the cheapest over-budget candidate flew on a different day than requested', () => {
    const candidate = {
      departureDate: '2026-08-18',
      totalPriceInr: 55000,
      destinationAirports: [{ city: 'Bangkok' }],
    };
    const result = suggestBudgetAdjustment({
      budgetInr: 50000,
      resultCount: 0,
      cheapestOverBudgetInr: 55000,
      cheapestOverBudgetCandidate: candidate,
      requestedDepartureDate: '2026-08-15',
    });
    expect(result.alternateDate).toBe('2026-08-18');
    expect(result.message).toMatch(/2026-08-18/);
    expect(result.alternateDestinationCity).toBe('Bangkok');
    expect(result.message).toMatch(/Bangkok/);
  });

  test('does not claim an alternate date when the cheapest over-budget candidate matches the requested date', () => {
    const candidate = {
      departureDate: '2026-08-15',
      totalPriceInr: 55000,
      destinationAirports: [{ city: 'Bangkok' }],
    };
    const result = suggestBudgetAdjustment({
      budgetInr: 50000,
      resultCount: 0,
      cheapestOverBudgetInr: 55000,
      cheapestOverBudgetCandidate: candidate,
      requestedDepartureDate: '2026-08-15',
    });
    expect(result.alternateDate).toBeNull();
    expect(result.message).not.toMatch(/2026-08-15\)/);
  });

  test('does not fabricate an alternate date/destination when no candidate object was passed (price-only caller)', () => {
    const result = suggestBudgetAdjustment({
      budgetInr: 50000,
      resultCount: 0,
      cheapestOverBudgetInr: 62000,
    });
    expect(result.alternateDate).toBeNull();
    expect(result.alternateDestinationCity).toBeNull();
    expect(result.message).toMatch(/62,000/);
  });
});

describe('filterRealCandidatesWithinBudget', () => {
  function flightCandidate(overrides = {}) {
    return {
      legs: [{ fromIata: 'DEL', toIata: 'BKK' }],
      departureDate: '2026-08-15',
      returnDate: '2026-08-20',
      totalPriceInr: 50000,
      totalStops: 0,
      totalDurationMinutes: 400,
      destinationAirports: [{ city: 'Bangkok', iata: 'BKK' }],
      ...overrides,
    };
  }

  test('returns every candidate unchanged (real objects, not copies with altered fields) when no budget was supplied', () => {
    const candidates = [flightCandidate({ totalPriceInr: 40000 }), flightCandidate({ totalPriceInr: 900000 })];
    const result = filterRealCandidatesWithinBudget(candidates, undefined);
    expect(result).toEqual(candidates);
    expect(result[0]).toBe(candidates[0]);
  });

  test('keeps only real candidates at or under the budget, dropping over-budget ones', () => {
    const inBudget = flightCandidate({ totalPriceInr: 45000 });
    const exactlyAtBudget = flightCandidate({ totalPriceInr: 50000 });
    const overBudget = flightCandidate({ totalPriceInr: 50001 });
    const result = filterRealCandidatesWithinBudget([inBudget, exactlyAtBudget, overBudget], 50000);
    expect(result).toEqual([inBudget, exactlyAtBudget]);
  });

  test('does NOT apply the normal-display rules (stop count, duration ceiling) — only budget', () => {
    // This candidate would be dropped by pruneCandidates() for having too many
    // stops, but it is a real, affordable candidate and must survive this filter.
    const manyStopsButAffordable = flightCandidate({ totalPriceInr: 30000, totalStops: 5 });
    const result = filterRealCandidatesWithinBudget([manyStopsButAffordable], 50000);
    expect(result).toEqual([manyStopsButAffordable]);
  });

  test('empty input returns empty output without throwing', () => {
    expect(filterRealCandidatesWithinBudget([], 50000)).toEqual([]);
    expect(filterRealCandidatesWithinBudget(undefined, 50000)).toEqual([]);
  });
});

describe('Regression: Budget Optimizer must see the complete real candidate set, not just what survived normal-display pruning', () => {
  function flightCandidate(overrides = {}) {
    return {
      legs: [{ fromIata: 'DEL', toIata: 'BKK' }],
      departureDate: '2026-08-15',
      returnDate: '2026-08-20', // 5 nights, same for both candidates below
      totalPriceInr: 50000,
      totalStops: 0,
      totalDurationMinutes: 400,
      destinationAirports: [{ city: 'Bangkok', iata: 'BKK' }],
      ...overrides,
    };
  }

  test('a real, cheaper, in-budget candidate that normal pruning drops (too many stops) is still found and correctly picked as best value', () => {
    // Real candidate A: cheapest, in budget, but has more stops than the
    // normal-display ceiling allows (pruneCandidates would drop it).
    const cheaperManyStops = flightCandidate({ totalPriceInr: 40000, totalStops: 5, totalDurationMinutes: 500 });
    // Real candidate B: also in budget, fewer stops, but pricier — this is
    // the only one that would remain after normal pruning.
    const pricierFewStops = flightCandidate({ totalPriceInr: 48000, totalStops: 0, totalDurationMinutes: 450 });

    const enrichedCandidates = [cheaperManyStops, pricierFewStops];
    const budgetInr = 50000;

    // Sanity check: this is exactly today's (buggy) input to the Budget
    // Optimizer — normal pruning removes the cheaper real candidate.
    const { filtered: prunedCandidates } = pruneCandidates(enrichedCandidates, { budgetInr });
    expect(prunedCandidates).toEqual([pricierFewStops]);

    // OLD (buggy) wiring: Budget Optimizer only ever sees prunedCandidates,
    // so it can only ever pick the pricier option — it never even considers
    // the real, cheaper, in-budget candidate.
    const oldResult = selectBudgetOptimizerPick({ candidates: prunedCandidates, budgetInr });
    expect(oldResult.bestValueCandidate).toBe(pricierFewStops);

    // NEW (fixed) wiring: Budget Optimizer evaluates the full real candidate
    // set filtered only by budget, so it correctly finds and picks the
    // cheaper real candidate as the better value.
    const fixedInput = filterRealCandidatesWithinBudget(enrichedCandidates, budgetInr);
    expect(fixedInput).toEqual(enrichedCandidates); // both are real and in budget
    const fixedResult = selectBudgetOptimizerPick({ candidates: fixedInput, budgetInr });
    expect(fixedResult.bestValueCandidate).toBe(cheaperManyStops);
    expect(fixedResult.status).toBe('within_budget');
  });

  test('never invents a candidate: the picked "best value" is always one of the exact real objects passed in', () => {
    const real1 = flightCandidate({ totalPriceInr: 42000, totalStops: 2 });
    const real2 = flightCandidate({ totalPriceInr: 44000, totalStops: 0 });
    const budgetInr = 50000;
    const result = selectBudgetOptimizerPick({
      candidates: filterRealCandidatesWithinBudget([real1, real2], budgetInr),
      budgetInr,
    });
    expect([real1, real2]).toContain(result.bestValueCandidate);
  });

  test('does not make the Budget Optimizer\'s "none fit" case worse: cheapest-over-budget behavior is unchanged', () => {
    const candidates = [flightCandidate({ totalPriceInr: 70000 }), flightCandidate({ totalPriceInr: 65000, departureDate: '2026-08-17' })];
    const budgetInr = 50000;
    const { cheapestOverBudgetInr, cheapestOverBudgetCandidate } = pruneCandidates(candidates, { budgetInr });

    const fixedInput = filterRealCandidatesWithinBudget(candidates, budgetInr);
    expect(fixedInput).toEqual([]); // nothing real fits the budget

    const result = selectBudgetOptimizerPick({
      candidates: fixedInput,
      budgetInr,
      cheapestOverBudgetInr,
      cheapestOverBudgetCandidate,
      requestedDepartureDate: '2026-08-15',
    });
    expect(result.status).toBe('over_budget');
    expect(result.cheapestRealCandidate.totalPriceInr).toBe(65000);
    expect(result.suggestion.alternateDate).toBe('2026-08-17');
  });
});

describe('Smart Budget Optimizer: candidate selection is real-data-driven, never fabricated', () => {
  function flightCandidate(overrides = {}) {
    return {
      legs: [{ fromIata: 'DEL', toIata: 'BKK' }],
      departureDate: '2026-08-15',
      returnDate: '2026-08-20',
      totalPriceInr: 50000,
      totalStops: 0,
      totalDurationMinutes: 400,
      destinationAirports: [{ city: 'Bangkok', iata: 'BKK' }],
      ...overrides,
    };
  }

  test('identifies the cheapest suitable candidate and the best-value (balanced) candidate from real, in-budget results only', () => {
    const candidates = [
      flightCandidate({ totalPriceInr: 45000, totalDurationMinutes: 900, totalStops: 2 }), // cheapest but slow/stopy
      flightCandidate({ totalPriceInr: 48000, totalDurationMinutes: 420, totalStops: 0 }), // good balance
      flightCandidate({ totalPriceInr: 90000, totalDurationMinutes: 300, totalStops: 0 }), // over budget
    ];

    const { filtered } = pruneCandidates(candidates, { budgetInr: 50000 });
    // The over-budget candidate must never appear in what "best value" is chosen from.
    expect(filtered.every((c) => c.totalPriceInr <= 50000)).toBe(true);

    const scored = scoreCandidates(filtered, 'balanced');
    const categories = pickCategories(scored);

    expect(categories.cheapest.totalPriceInr).toBe(45000);
    // Best-value pick must be one of the real candidates that were actually searched.
    expect(filtered).toContainEqual(expect.objectContaining({ totalPriceInr: categories.balanced.totalPriceInr }));
  });

  test('when nothing fits the budget, no in-budget "best value" is fabricated — only a real over-budget suggestion is offered', () => {
    const candidates = [
      flightCandidate({ totalPriceInr: 70000 }),
      flightCandidate({ totalPriceInr: 65000, departureDate: '2026-08-17' }),
    ];

    const { filtered, cheapestOverBudgetInr, cheapestOverBudgetCandidate } = pruneCandidates(candidates, { budgetInr: 50000 });
    expect(filtered).toHaveLength(0);

    const scored = scoreCandidates(filtered, 'balanced');
    expect(pickCategories(scored)).toEqual({});

    // The suggestion must point at the real cheapest over-budget candidate (65000, on 08-17), not an invented figure.
    expect(cheapestOverBudgetInr).toBe(65000);
    const suggestion = suggestBudgetAdjustment({
      budgetInr: 50000,
      resultCount: 0,
      cheapestOverBudgetInr,
      cheapestOverBudgetCandidate,
      requestedDepartureDate: '2026-08-15',
    });
    expect(suggestion.suggestedBudgetInr).toBe(65000);
    expect(suggestion.alternateDate).toBe('2026-08-17');
  });
});

describe('selectBudgetOptimizerPick', () => {
  function flightCandidate(overrides = {}) {
    return {
      legs: [{ fromIata: 'DEL', toIata: 'BKK' }],
      departureDate: '2026-08-15',
      returnDate: '2026-08-20', // 5 nights
      totalPriceInr: 50000,
      totalStops: 0,
      totalDurationMinutes: 400,
      destinationAirports: [{ city: 'Bangkok', iata: 'BKK' }],
      ...overrides,
    };
  }

  test('returns null when no budget was supplied (invalid/missing budget)', () => {
    expect(selectBudgetOptimizerPick({ candidates: [flightCandidate()], budgetInr: undefined })).toBeNull();
  });

  test('Case A: picks the real in-budget candidate with the lowest estimated total trip cost, not just the cheapest flight', () => {
    const cheapButSlow = flightCandidate({ totalPriceInr: 45000, totalDurationMinutes: 900 }); // cheap flight, same nights
    const betterValue = flightCandidate({ totalPriceInr: 48000, totalDurationMinutes: 420 });
    // Both have the same 5-night estimated living-cost range, so the ~3000
    // higher flight price makes cheapButSlow strictly better on total cost —
    // this test instead checks the tie-break path below.
    const result = selectBudgetOptimizerPick({
      candidates: [cheapButSlow, betterValue],
      budgetInr: 60000,
      travelers: 1,
    });

    expect(result.status).toBe('within_budget');
    // cheapButSlow has the lower estimated total trip cost (cheaper flight,
    // identical living-cost estimate) so it must win on cost, even though
    // its duration is worse — duration is only a tie-breaker.
    expect(result.bestValueCandidate.totalPriceInr).toBe(45000);
    expect(result.budgetInsight).not.toBeNull();
    expect(result.reason).toMatch(/best real balance/);
    expect(result.suggestion).toBeNull();
    expect(result.cheapestRealCandidate).toBeNull();
  });

  test('Case A: breaks a cost tie using real trip duration', () => {
    const slower = flightCandidate({ totalPriceInr: 50000, totalDurationMinutes: 900 });
    const faster = flightCandidate({ totalPriceInr: 50000, totalDurationMinutes: 300 });

    const result = selectBudgetOptimizerPick({
      candidates: [slower, faster],
      budgetInr: 60000,
    });

    expect(result.bestValueCandidate.totalDurationMinutes).toBe(300);
  });

  test('Case A: never returns a candidate that was not in the provided (already budget-filtered) list', () => {
    const candidates = [
      flightCandidate({ totalPriceInr: 45000 }),
      flightCandidate({ totalPriceInr: 48000, totalDurationMinutes: 200 }),
    ];
    const result = selectBudgetOptimizerPick({ candidates, budgetInr: 50000 });

    expect(candidates).toContain(result.bestValueCandidate);
  });

  test('Case B: no candidates fit — defers to the real cheapest over-budget candidate, never fabricating an in-budget pick', () => {
    const cheapestOverBudgetCandidate = flightCandidate({ totalPriceInr: 65000, departureDate: '2026-08-17' });

    const result = selectBudgetOptimizerPick({
      candidates: [],
      budgetInr: 50000,
      cheapestOverBudgetInr: 65000,
      cheapestOverBudgetCandidate,
      requestedDepartureDate: '2026-08-15',
    });

    expect(result.status).toBe('over_budget');
    expect(result.bestValueCandidate).toBeNull();
    expect(result.cheapestRealCandidate).toBe(cheapestOverBudgetCandidate);
    expect(result.requiredBudgetIncreaseInr).toBe(15000);
    expect(result.suggestion.alternateDate).toBe('2026-08-17');
    expect(result.suggestion.alternateDestinationCity).toBe('Bangkok');
  });

  test('Case B: no real alternative exists at all — still reports the required increase without inventing a date/destination', () => {
    const result = selectBudgetOptimizerPick({
      candidates: [],
      budgetInr: 50000,
      cheapestOverBudgetInr: null,
      cheapestOverBudgetCandidate: null,
    });

    expect(result.status).toBe('over_budget');
    expect(result.cheapestRealCandidate).toBeNull();
    expect(result.requiredBudgetIncreaseInr).toBeNull();
    expect(result.suggestion).toBeNull();
  });

  test('invalid/missing budget: a zero budget is treated as no budget (same as estimateBudgetBreakdown)', () => {
    expect(selectBudgetOptimizerPick({ candidates: [flightCandidate()], budgetInr: 0 })).toBeNull();
  });
});
