const test = require('node:test');
const assert = require('node:assert/strict');
const { computeExpenseBreakdown, sumRanges, scaleRange } = require('./expenseCalculator');

function makeBudgetInsight(overrides = {}) {
  return {
    flightCostInr: 40000,
    budgetInr: 200000,
    nights: 5,
    categoryBreakdown: {
      accommodation: { min: 25000, max: 40000 },
      food: { min: 15000, max: 24000 },
      localTransport: { min: 10000, max: 16000 },
    },
    ...overrides,
  };
}

test('returns null when flight cost is missing', () => {
  assert.equal(computeExpenseBreakdown({ flightCostInr: null }), null);
  assert.equal(computeExpenseBreakdown({}), null);
});

test('category calculations: reuses categoryBreakdown and attraction estimate as-is', () => {
  const result = computeExpenseBreakdown({
    flightCostInr: 40000,
    budgetInsight: makeBudgetInsight(),
    attractionsEstimate: { min: 3000, max: 7000, basedOnCount: 4 },
  });

  assert.equal(result.categories.flight.amountInr, 40000);
  assert.equal(result.categories.flight.isEstimated, false);
  assert.deepEqual(result.categories.accommodation.rangeInr, { min: 25000, max: 40000 });
  assert.deepEqual(result.categories.food.rangeInr, { min: 15000, max: 24000 });
  assert.deepEqual(result.categories.localTransport.rangeInr, { min: 10000, max: 16000 });
  assert.deepEqual(result.categories.attractions.rangeInr, { min: 3000, max: 7000 });
  assert.equal(result.categories.attractions.basedOnCount, 4);

  // Miscellaneous = 8% of (accommodation + food + local transport + attractions)
  const subtotalMin = 25000 + 15000 + 10000 + 3000;
  const subtotalMax = 40000 + 24000 + 16000 + 7000;
  assert.deepEqual(result.categories.miscellaneous.rangeInr, {
    min: Math.round(subtotalMin * 0.08),
    max: Math.round(subtotalMax * 0.08),
  });
});

test('travelers: figures are not re-multiplied here (already travelers-aware upstream)', () => {
  const insight = makeBudgetInsight(); // pretend this was already computed for 3 travelers
  const resultFor1 = computeExpenseBreakdown({ flightCostInr: 40000, budgetInsight: insight, travelers: 1 });
  const resultFor3 = computeExpenseBreakdown({ flightCostInr: 40000, budgetInsight: insight, travelers: 3 });

  // Same category ranges regardless of the `travelers` value passed in —
  // this function must not scale by travelers a second time.
  assert.deepEqual(resultFor1.categories.accommodation.rangeInr, resultFor3.categories.accommodation.rangeInr);
  assert.deepEqual(resultFor1.totalTripExpenseInr, resultFor3.totalTripExpenseInr);
  assert.equal(resultFor3.travelers, 3);
});

test('duration: one-way trip (no nights) leaves living-cost categories unavailable', () => {
  const result = computeExpenseBreakdown({
    flightCostInr: 40000,
    budgetInsight: makeBudgetInsight({ nights: null, categoryBreakdown: null }),
  });

  assert.equal(result.nights, null);
  assert.equal(result.categories.accommodation.isAvailable, false);
  assert.equal(result.categories.accommodation.rangeInr, null);
  assert.equal(result.hasFullEstimate, false);
  // Total collapses to just the real flight price when nothing else is known.
  assert.deepEqual(result.totalTripExpenseInr, { min: 40000, max: 40000 });
});

test('total trip expense: sums flight (actual) + every available category range exactly once', () => {
  const result = computeExpenseBreakdown({
    flightCostInr: 40000,
    budgetInsight: makeBudgetInsight(),
    attractionsEstimate: { min: 3000, max: 7000, basedOnCount: 2 },
  });

  const misc = result.categories.miscellaneous.rangeInr;
  const expectedMin = 40000 + 25000 + 15000 + 10000 + 3000 + misc.min;
  const expectedMax = 40000 + 40000 + 24000 + 16000 + 7000 + misc.max;

  assert.deepEqual(result.totalTripExpenseInr, { min: expectedMin, max: expectedMax });
});

test('remaining budget: budget comfortably covers the (conservative) total', () => {
  const result = computeExpenseBreakdown({
    flightCostInr: 40000,
    budgetInsight: makeBudgetInsight({ budgetInr: 500000 }),
  });

  assert.equal(result.overBudgetInr, null);
  assert.equal(result.remainingBudgetInr, 500000 - result.totalTripExpenseInr.max);
  assert.ok(result.remainingBudgetInr > 0);
});

test('over budget: total (conservative, top of range) exceeds the supplied budget', () => {
  const result = computeExpenseBreakdown({
    flightCostInr: 40000,
    budgetInsight: makeBudgetInsight({ budgetInr: 60000 }),
  });

  assert.equal(result.remainingBudgetInr, null);
  assert.equal(result.overBudgetInr, result.totalTripExpenseInr.max - 60000);
  assert.ok(result.overBudgetInr > 0);
});

test('missing/estimated categories: no budget supplied at all (budgetInsight is null)', () => {
  const result = computeExpenseBreakdown({
    flightCostInr: 55000,
    budgetInsight: null,
    attractionsEstimate: { min: 2000, max: 5000, basedOnCount: 1 },
  });

  assert.equal(result.budgetInr, null);
  assert.equal(result.nights, null);
  assert.equal(result.categories.accommodation.isAvailable, false);
  assert.equal(result.categories.food.isAvailable, false);
  assert.equal(result.categories.localTransport.isAvailable, false);
  // Attractions is independent of a budget being set, so it's still there.
  assert.equal(result.categories.attractions.isAvailable, true);
  assert.equal(result.remainingBudgetInr, null);
  assert.equal(result.overBudgetInr, null);
  // Total is flight + attractions + the misc buffer derived from attractions alone.
  const misc = result.categories.miscellaneous.rangeInr;
  assert.deepEqual(result.totalTripExpenseInr, {
    min: 55000 + 2000 + misc.min,
    max: 55000 + 5000 + misc.max,
  });
});

function makeLivingCostEstimate(overrides = {}) {
  return {
    nights: 5,
    categoryBreakdown: {
      accommodation: { min: 25000, max: 40000 },
      food: { min: 15000, max: 24000 },
      localTransport: { min: 10000, max: 16000 },
    },
    ...overrides,
  };
}

test('no-budget estimate: uses livingCostEstimate fallback when budgetInsight is null', () => {
  const result = computeExpenseBreakdown({
    flightCostInr: 55000,
    budgetInsight: null,
    livingCostEstimate: makeLivingCostEstimate(),
    attractionsEstimate: { min: 2000, max: 5000, basedOnCount: 1 },
  });

  assert.equal(result.budgetInr, null); // still no budget, since none was supplied
  assert.equal(result.nights, 5);
  assert.deepEqual(result.categories.accommodation.rangeInr, { min: 25000, max: 40000 });
  assert.deepEqual(result.categories.food.rangeInr, { min: 15000, max: 24000 });
  assert.deepEqual(result.categories.localTransport.rangeInr, { min: 10000, max: 16000 });
  assert.equal(result.categories.accommodation.isAvailable, true);
  assert.equal(result.categories.accommodation.isEstimated, true);
  assert.equal(result.hasFullEstimate, true);
  // No budget was supplied, so there's still nothing to compare against.
  assert.equal(result.remainingBudgetInr, null);
  assert.equal(result.overBudgetInr, null);

  // Total = flight + accommodation + food + localTransport + attractions + misc, exactly once each.
  const subtotal = { min: 25000 + 15000 + 10000 + 2000, max: 40000 + 24000 + 16000 + 5000 };
  const misc = scaleRange(subtotal, 0.08);
  assert.deepEqual(result.totalTripExpenseInr, {
    min: 55000 + subtotal.min + misc.min,
    max: 55000 + subtotal.max + misc.max,
  });
});

test('no-budget estimate: budgetInsight (when present) always wins over livingCostEstimate, never combined', () => {
  const result = computeExpenseBreakdown({
    flightCostInr: 40000,
    budgetInsight: makeBudgetInsight(), // 5 nights, budgetInr 200000
    livingCostEstimate: makeLivingCostEstimate({
      nights: 30,
      categoryBreakdown: {
        accommodation: { min: 999999, max: 999999 },
        food: { min: 999999, max: 999999 },
        localTransport: { min: 999999, max: 999999 },
      },
    }),
  });

  // budgetInsight's own figures are used, not livingCostEstimate's — proof
  // the two are never merged or double-counted.
  assert.equal(result.nights, 5);
  assert.equal(result.budgetInr, 200000);
  assert.deepEqual(result.categories.accommodation.rangeInr, { min: 25000, max: 40000 });
});

test('no-budget estimate: one-way trip (no nights) leaves categories unavailable even with livingCostEstimate present', () => {
  const result = computeExpenseBreakdown({
    flightCostInr: 55000,
    budgetInsight: null,
    livingCostEstimate: { nights: null, categoryBreakdown: null },
  });

  assert.equal(result.nights, null);
  assert.equal(result.categories.accommodation.isAvailable, false);
  assert.equal(result.hasFullEstimate, false);
});

test('missing/estimated categories: no attractions data loaded yet', () => {
  const result = computeExpenseBreakdown({
    flightCostInr: 40000,
    budgetInsight: makeBudgetInsight(),
    attractionsEstimate: null,
  });

  assert.equal(result.categories.attractions.isAvailable, false);
  assert.equal(result.categories.attractions.rangeInr, null);
  // Miscellaneous is still derived from the categories that ARE available.
  assert.ok(result.categories.miscellaneous.isAvailable);
});

test('double-count prevention: miscellaneous excludes flight and is derived once', () => {
  const result = computeExpenseBreakdown({
    flightCostInr: 100000,
    budgetInsight: makeBudgetInsight(),
    attractionsEstimate: { min: 3000, max: 7000, basedOnCount: 3 },
  });

  const subtotal = sumRanges([
    result.categories.accommodation.rangeInr,
    result.categories.food.rangeInr,
    result.categories.localTransport.rangeInr,
    result.categories.attractions.rangeInr,
  ]);
  assert.deepEqual(result.categories.miscellaneous.rangeInr, scaleRange(subtotal, 0.08));

  // Doubling the flight price must change the total by exactly the flight
  // delta — proof the flight amount isn't leaking into the miscellaneous
  // (or any other estimated) category.
  const doubledFlight = computeExpenseBreakdown({
    flightCostInr: 200000,
    budgetInsight: makeBudgetInsight(),
    attractionsEstimate: { min: 3000, max: 7000, basedOnCount: 3 },
  });
  assert.deepEqual(doubledFlight.categories.miscellaneous.rangeInr, result.categories.miscellaneous.rangeInr);
  assert.equal(doubledFlight.totalTripExpenseInr.min - result.totalTripExpenseInr.min, 100000);
  assert.equal(doubledFlight.totalTripExpenseInr.max - result.totalTripExpenseInr.max, 100000);
});

test('double-count prevention: sum of parts equals the reported total exactly', () => {
  const result = computeExpenseBreakdown({
    flightCostInr: 40000,
    budgetInsight: makeBudgetInsight(),
    attractionsEstimate: { min: 3000, max: 7000, basedOnCount: 2 },
  });

  const partsMin =
    result.categories.flight.amountInr +
    result.categories.accommodation.rangeInr.min +
    result.categories.food.rangeInr.min +
    result.categories.localTransport.rangeInr.min +
    result.categories.attractions.rangeInr.min +
    result.categories.miscellaneous.rangeInr.min;
  const partsMax =
    result.categories.flight.amountInr +
    result.categories.accommodation.rangeInr.max +
    result.categories.food.rangeInr.max +
    result.categories.localTransport.rangeInr.max +
    result.categories.attractions.rangeInr.max +
    result.categories.miscellaneous.rangeInr.max;

  assert.equal(result.totalTripExpenseInr.min, partsMin);
  assert.equal(result.totalTripExpenseInr.max, partsMax);
});

test('sumRanges ignores nulls and returns null when everything is null', () => {
  assert.equal(sumRanges([null, undefined]), null);
  assert.deepEqual(sumRanges([{ min: 1, max: 2 }, null, { min: 3, max: 4 }]), { min: 4, max: 6 });
});
