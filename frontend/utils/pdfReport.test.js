const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPdfReportModel } = require('./pdfReport');
const { buildTripTimeline } = require('./tripTimeline');
const { computeExpenseBreakdown } = require('./expenseCalculator');

const ORIGIN = { iata: 'DEL', city: 'Delhi', isPrimary: true };
const CDG = { iata: 'CDG', city: 'Paris', isPrimary: true };
const FCO = { iata: 'FCO', city: 'Rome' };

function makeOffer(departureTime, arrivalTime, overrides = {}) {
  return {
    priceInr: 45000,
    stops: 0,
    totalDurationMinutes: 540,
    outbound: [
      { airline: 'AI', flightNumber: 'AI101', fromIata: 'DEL', toIata: 'CDG', departureTime, arrivalTime },
    ],
    ...overrides,
  };
}

test('returns null when there is no recommendation', () => {
  assert.equal(buildPdfReportModel({ recommendation: null }), null);
  assert.equal(buildPdfReportModel({}), null);
});

test('single-destination trip: route, dates, and timeline are reused as-is from buildTripTimeline', () => {
  const legs = [
    { fromIata: 'DEL', toIata: 'CDG', date: '2026-08-15' },
    { fromIata: 'CDG', toIata: 'DEL', date: '2026-08-20' },
  ];
  const legOffers = [
    [makeOffer('2026-08-15T09:00:00.000Z', '2026-08-15T18:00:00.000Z')],
    [
      makeOffer('2026-08-20T10:00:00.000Z', '2026-08-20T13:00:00.000Z', {
        outbound: [
          {
            airline: 'AI',
            flightNumber: 'AI102',
            fromIata: 'CDG',
            toIata: 'DEL',
            departureTime: '2026-08-20T10:00:00.000Z',
            arrivalTime: '2026-08-20T13:00:00.000Z',
          },
        ],
      }),
    ],
  ];
  const recommendation = {
    legs,
    legOffers,
    originAirport: ORIGIN,
    destinationAirports: [CDG],
    totalPriceInr: 90000,
  };
  const timeline = buildTripTimeline({ legs, legOffers, originAirport: ORIGIN, destinationAirports: [CDG] });
  const expenseBreakdown = computeExpenseBreakdown({ flightCostInr: 90000, travelers: 2 });

  const model = buildPdfReportModel({ recommendation, timeline, expenseBreakdown });

  assert.equal(model.origin.iata, 'DEL');
  assert.deepEqual(model.destinations, [{ iata: 'CDG', city: 'Paris' }]);
  assert.equal(model.isMultiCity, false);
  assert.equal(model.isCircuit, true); // 2 legs, 1 destination => out-and-back circuit
  assert.equal(model.routeLabel, 'Delhi \u2192 Paris \u2192 Delhi');
  assert.equal(model.departureDate, '2026-08-15');
  assert.equal(model.returnDate, '2026-08-20');
  assert.equal(model.totalDays, 6);
  assert.equal(model.timelineAvailable, true);
  // Same day objects buildTripTimeline produced — not rebuilt/reshaped.
  assert.equal(model.days, timeline.days);
  assert.equal(model.days.length, 6);
  assert.equal(model.expenseAvailable, true);
  assert.equal(model.expense.totalTripExpenseInr.min, 90000);
  assert.equal(model.expense.categories.flight.amountInr, 90000);
});

test('one-way trip: no return date, isCircuit is false', () => {
  const legs = [{ fromIata: 'DEL', toIata: 'CDG', date: '2026-08-15' }];
  const recommendation = { legs, legOffers: [[]], originAirport: ORIGIN, destinationAirports: [CDG] };
  const timeline = buildTripTimeline({ legs, legOffers: [[]], originAirport: ORIGIN, destinationAirports: [CDG] });

  const model = buildPdfReportModel({ recommendation, timeline, expenseBreakdown: null });

  assert.equal(model.isCircuit, false);
  assert.equal(model.departureDate, '2026-08-15');
  assert.equal(model.returnDate, null);
  assert.equal(model.expenseAvailable, false);
  assert.equal(model.expense, null);
});

test('multi-city circuit: destinations list has every real stop, route label includes the return to origin', () => {
  const legs = [
    { fromIata: 'DEL', toIata: 'CDG', date: '2026-08-15' },
    { fromIata: 'CDG', toIata: 'FCO', date: '2026-08-18' },
    { fromIata: 'FCO', toIata: 'DEL', date: '2026-08-22' },
  ];
  const recommendation = { legs, legOffers: [], originAirport: ORIGIN, destinationAirports: [CDG, FCO] };
  const placesByDestination = {
    CDG: { hotels: [{ id: 'p-h', name: 'Paris Hotel' }], attractions: [{ id: 'p-a', name: 'Eiffel Tower' }] },
    FCO: { hotels: [{ id: 'r-h', name: 'Rome Hotel' }], attractions: [{ id: 'r-a', name: 'Colosseum' }] },
  };
  const timeline = buildTripTimeline({
    legs,
    legOffers: [],
    originAirport: ORIGIN,
    destinationAirports: [CDG, FCO],
    placesByDestination,
  });

  const model = buildPdfReportModel({ recommendation, timeline, expenseBreakdown: null });

  assert.equal(model.isMultiCity, true);
  assert.equal(model.isCircuit, true);
  assert.deepEqual(model.destinations, [
    { iata: 'CDG', city: 'Paris' },
    { iata: 'FCO', city: 'Rome' },
  ]);
  assert.equal(model.routeLabel, 'Delhi \u2192 Paris \u2192 Rome \u2192 Delhi');
  assert.equal(model.usedPerDestinationData, true);
  assert.equal(model.hotelsAvailable, true);
  assert.equal(model.attractionsAvailable, true);

  // Each destination's data only appears on its own days — the report model
  // doesn't touch this per-day placement, it's exactly what buildTripTimeline
  // already computed.
  const parisHotelDay = model.days.find((d) =>
    d.entries.some((e) => e.type === 'accommodation' && e.city === 'Paris')
  );
  const romeHotelDay = model.days.find((d) =>
    d.entries.some((e) => e.type === 'accommodation' && e.city === 'Rome')
  );
  assert.ok(parisHotelDay);
  assert.ok(romeHotelDay);
  assert.notEqual(parisHotelDay.dayNumber, romeHotelDay.dayNumber);
});

test('missing timeline data: reports unavailable rather than fabricating dates or days', () => {
  const recommendation = { legs: [], legOffers: [], originAirport: ORIGIN, destinationAirports: [CDG] };
  const timeline = buildTripTimeline({ legs: [], legOffers: [], originAirport: ORIGIN, destinationAirports: [CDG] });

  const model = buildPdfReportModel({ recommendation, timeline, expenseBreakdown: null });

  assert.equal(model.timelineAvailable, false);
  assert.ok(model.timelineUnavailableReason);
  assert.deepEqual(model.days, []);
  assert.equal(model.departureDate, null);
  assert.equal(model.returnDate, null);
  assert.equal(model.totalDays, 0);
});

test('no timeline object passed at all (e.g. caller has no leg data yet): still returns a well-formed model', () => {
  const recommendation = { legs: [], legOffers: [], originAirport: ORIGIN, destinationAirports: [CDG] };
  const model = buildPdfReportModel({ recommendation, timeline: null, expenseBreakdown: null });

  assert.equal(model.timelineAvailable, false);
  assert.equal(model.timelineUnavailableReason, 'Trip date information is not available.');
  assert.deepEqual(model.days, []);
});

test('expense data is passed through unchanged — budget/remaining/over-budget figures are never recomputed', () => {
  const legs = [{ fromIata: 'DEL', toIata: 'CDG', date: '2026-08-15' }];
  const recommendation = { legs, legOffers: [[]], originAirport: ORIGIN, destinationAirports: [CDG] };
  const timeline = buildTripTimeline({ legs, legOffers: [[]], originAirport: ORIGIN, destinationAirports: [CDG] });
  const expenseBreakdown = computeExpenseBreakdown({
    flightCostInr: 50000,
    budgetInsight: {
      budgetInr: 60000,
      nights: 3,
      categoryBreakdown: {
        accommodation: { min: 5000, max: 8000 },
        food: { min: 2000, max: 4000 },
        localTransport: { min: 1000, max: 2000 },
      },
    },
    travelers: 1,
  });

  const model = buildPdfReportModel({ recommendation, timeline, expenseBreakdown });

  assert.equal(model.expense.budgetInr, 60000);
  assert.equal(model.expense.travelers, 1);
  assert.equal(model.expense.nights, 3);
  // Same reference values expenseBreakdown already computed — spot-check a
  // couple of fields rather than asserting object identity, since the
  // model intentionally copies only the fields the PDF needs.
  assert.deepEqual(model.expense.categories.accommodation.rangeInr, { min: 5000, max: 8000 });
  assert.equal(
    model.expense.remainingBudgetInr != null || model.expense.overBudgetInr != null,
    true
  );
});

test('generatedAt defaults to now but never influences trip data fields', () => {
  const legs = [{ fromIata: 'DEL', toIata: 'CDG', date: '2026-08-15' }];
  const recommendation = { legs, legOffers: [[]], originAirport: ORIGIN, destinationAirports: [CDG] };
  const timeline = buildTripTimeline({ legs, legOffers: [[]], originAirport: ORIGIN, destinationAirports: [CDG] });

  const before = Date.now();
  const model = buildPdfReportModel({ recommendation, timeline, expenseBreakdown: null });
  const after = Date.now();

  assert.ok(model.generatedAt instanceof Date);
  assert.ok(model.generatedAt.getTime() >= before && model.generatedAt.getTime() <= after);
  assert.equal(model.departureDate, '2026-08-15');
});
