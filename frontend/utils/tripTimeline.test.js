const test = require('node:test');
const assert = require('node:assert/strict');
const { computeTripDayDates, buildTripTimeline } = require('./tripTimeline');

const ORIGIN = { iata: 'DEL', city: 'Delhi', isPrimary: true };
const DEST = { iata: 'CDG', city: 'Paris', isPrimary: true };

function makeOffer(departureTime, arrivalTime, overrides = {}) {
  return {
    priceInr: 45000,
    stops: 0,
    totalDurationMinutes: 540,
    outbound: [
      {
        airline: 'AI',
        flightNumber: 'AI101',
        fromIata: 'DEL',
        toIata: 'CDG',
        departureTime,
        arrivalTime,
      },
    ],
    ...overrides,
  };
}

test('computeTripDayDates: returns [] when there are no legs / no dates', () => {
  assert.deepEqual(computeTripDayDates([]), []);
  assert.deepEqual(computeTripDayDates(null), []);
  assert.deepEqual(computeTripDayDates([{ fromIata: 'DEL', toIata: 'CDG' }]), []);
});

test('computeTripDayDates: one-day (one-way) trip spans a single date', () => {
  const legs = [{ fromIata: 'DEL', toIata: 'CDG', date: '2026-08-15' }];
  assert.deepEqual(computeTripDayDates(legs), ['2026-08-15']);
});

test('computeTripDayDates: round trip spans departure through return date inclusive', () => {
  const legs = [
    { fromIata: 'DEL', toIata: 'CDG', date: '2026-08-15' },
    { fromIata: 'CDG', toIata: 'DEL', date: '2026-08-20' },
  ];
  const dates = computeTripDayDates(legs);
  assert.equal(dates.length, 6);
  assert.equal(dates[0], '2026-08-15');
  assert.equal(dates[dates.length - 1], '2026-08-20');
});

test('computeTripDayDates: multi-city circuit spans earliest to latest leg date', () => {
  const legs = [
    { fromIata: 'DEL', toIata: 'CDG', date: '2026-08-15' },
    { fromIata: 'CDG', toIata: 'FCO', date: '2026-08-18' },
    { fromIata: 'FCO', toIata: 'DEL', date: '2026-08-22' },
  ];
  const dates = computeTripDayDates(legs);
  assert.equal(dates[0], '2026-08-15');
  assert.equal(dates[dates.length - 1], '2026-08-22');
  assert.equal(dates.length, 8);
});

test('buildTripTimeline: reports unavailable rather than crashing when legs are missing', () => {
  const result = buildTripTimeline({ legs: [], legOffers: [], originAirport: ORIGIN, destinationAirports: [DEST] });
  assert.equal(result.isAvailable, false);
  assert.equal(result.days.length, 0);
  assert.ok(result.reason);
});

test('buildTripTimeline: one-day trip produces a single day with the outbound flight', () => {
  const legs = [{ fromIata: 'DEL', toIata: 'CDG', date: '2026-08-15' }];
  const legOffers = [[makeOffer('2026-08-15T09:00:00.000Z', '2026-08-15T18:00:00.000Z')]];

  const result = buildTripTimeline({ legs, legOffers, originAirport: ORIGIN, destinationAirports: [DEST] });

  assert.equal(result.isAvailable, true);
  assert.equal(result.totalDays, 1);
  assert.equal(result.days.length, 1);
  assert.equal(result.days[0].dayNumber, 1);
  const flightEntry = result.days[0].entries.find((e) => e.type === 'flight');
  assert.equal(flightEntry.status, 'available');
  assert.equal(flightEntry.direction, 'outbound');
  assert.equal(flightEntry.fromIata, 'DEL');
  assert.equal(flightEntry.toIata, 'CDG');
});

test('buildTripTimeline: multi-day round trip places outbound on day 1 and return on the last day', () => {
  const legs = [
    { fromIata: 'DEL', toIata: 'CDG', date: '2026-08-15' },
    { fromIata: 'CDG', toIata: 'DEL', date: '2026-08-20' },
  ];
  const legOffers = [
    [makeOffer('2026-08-15T09:00:00.000Z', '2026-08-15T18:00:00.000Z')],
    [makeOffer('2026-08-20T10:00:00.000Z', '2026-08-20T13:00:00.000Z', {
      outbound: [{ airline: 'AI', flightNumber: 'AI102', fromIata: 'CDG', toIata: 'DEL', departureTime: '2026-08-20T10:00:00.000Z', arrivalTime: '2026-08-20T13:00:00.000Z' }],
    })],
  ];

  const result = buildTripTimeline({ legs, legOffers, originAirport: ORIGIN, destinationAirports: [DEST] });

  assert.equal(result.totalDays, 6);
  const day1Flight = result.days[0].entries.find((e) => e.type === 'flight');
  assert.equal(day1Flight.direction, 'outbound');
  const lastDayFlight = result.days[result.days.length - 1].entries.find((e) => e.type === 'flight');
  assert.equal(lastDayFlight.direction, 'return');
  assert.equal(lastDayFlight.toIata, 'DEL');
});

test('buildTripTimeline: missing flight offer for a leg is marked unavailable, never fabricated', () => {
  const legs = [{ fromIata: 'DEL', toIata: 'CDG', date: '2026-08-15' }];
  const legOffers = [[]]; // no offer found for this leg

  const result = buildTripTimeline({ legs, legOffers, originAirport: ORIGIN, destinationAirports: [DEST] });
  const flightEntry = result.days[0].entries.find((e) => e.type === 'flight');
  assert.equal(flightEntry.status, 'unavailable');
  assert.equal(flightEntry.departureTime, undefined);
  assert.ok(flightEntry.note);
});

test('buildTripTimeline: attractions/hotels/restaurants are omitted entirely when not loaded', () => {
  const legs = [{ fromIata: 'DEL', toIata: 'CDG', date: '2026-08-15' }];
  const legOffers = [[makeOffer('2026-08-15T09:00:00.000Z', '2026-08-15T18:00:00.000Z')]];

  const result = buildTripTimeline({
    legs,
    legOffers,
    originAirport: ORIGIN,
    destinationAirports: [DEST],
    hotels: null,
    attractions: undefined,
    restaurants: [],
  });

  assert.equal(result.hotelsAvailable, false);
  assert.equal(result.attractionsAvailable, false);
  assert.equal(result.restaurantsAvailable, false);
  const types = result.days[0].entries.map((e) => e.type);
  assert.ok(!types.includes('accommodation'));
  assert.ok(!types.includes('attractions'));
  assert.ok(!types.includes('restaurants'));
});

test('buildTripTimeline: hotel suggestions attach only to day 1, capped, never a claimed booking', () => {
  const legs = [
    { fromIata: 'DEL', toIata: 'CDG', date: '2026-08-15' },
    { fromIata: 'CDG', toIata: 'DEL', date: '2026-08-17' },
  ];
  const legOffers = [
    [makeOffer('2026-08-15T09:00:00.000Z', '2026-08-15T18:00:00.000Z')],
    [makeOffer('2026-08-17T10:00:00.000Z', '2026-08-17T13:00:00.000Z')],
  ];
  const hotels = [{ id: 'h1', name: 'Hotel A' }, { id: 'h2', name: 'Hotel B' }, { id: 'h3', name: 'Hotel C' }, { id: 'h4', name: 'Hotel D' }];

  const result = buildTripTimeline({ legs, legOffers, originAirport: ORIGIN, destinationAirports: [DEST], hotels });

  assert.equal(result.hotelsAvailable, true);
  const day1Accom = result.days[0].entries.find((e) => e.type === 'accommodation');
  assert.ok(day1Accom);
  assert.equal(day1Accom.options.length, 3); // capped at MAX_HOTEL_SUGGESTIONS
  const otherDaysHaveAccom = result.days.slice(1).some((d) => d.entries.some((e) => e.type === 'accommodation'));
  assert.equal(otherDaysHaveAccom, false);
});

test('buildTripTimeline: attractions are spread across full (non-travel) days on a longer trip, capped per day', () => {
  const legs = [
    { fromIata: 'DEL', toIata: 'CDG', date: '2026-08-15' },
    { fromIata: 'CDG', toIata: 'DEL', date: '2026-08-19' },
  ];
  const legOffers = [
    [makeOffer('2026-08-15T09:00:00.000Z', '2026-08-15T18:00:00.000Z')],
    [makeOffer('2026-08-19T10:00:00.000Z', '2026-08-19T13:00:00.000Z')],
  ];
  const attractions = Array.from({ length: 7 }, (_, i) => ({ id: `a${i}`, name: `Attraction ${i}` }));

  const result = buildTripTimeline({ legs, legOffers, originAirport: ORIGIN, destinationAirports: [DEST], attractions });

  assert.equal(result.attractionsAvailable, true);
  // 5-day trip: day 1 (arrival) and day 5 (departure) excluded, days 2-4 eligible
  assert.equal(result.days[0].entries.some((e) => e.type === 'attractions'), false);
  assert.equal(result.days[4].entries.some((e) => e.type === 'attractions'), false);
  for (const day of result.days.slice(1, 4)) {
    const entry = day.entries.find((e) => e.type === 'attractions');
    assert.ok(entry);
    assert.ok(entry.items.length <= 3);
  }
});

test('buildTripTimeline: entries within a day are chronological — flight, accommodation, attractions, restaurants', () => {
  const legs = [{ fromIata: 'DEL', toIata: 'CDG', date: '2026-08-15' }];
  const legOffers = [[makeOffer('2026-08-15T09:00:00.000Z', '2026-08-15T18:00:00.000Z')]];
  const hotels = [{ id: 'h1', name: 'Hotel A' }];
  const attractions = [{ id: 'a1', name: 'Attraction A' }];
  const restaurants = [{ id: 'r1', name: 'Restaurant A' }];

  const result = buildTripTimeline({
    legs,
    legOffers,
    originAirport: ORIGIN,
    destinationAirports: [DEST],
    hotels,
    attractions,
    restaurants,
  });

  const types = result.days[0].entries.map((e) => e.type);
  assert.deepEqual(types, ['flight', 'accommodation', 'attractions', 'restaurants']);
});

test('buildTripTimeline: does not crash and stays well-formed with only a departure date (no legOffers passed)', () => {
  const legs = [{ fromIata: 'DEL', toIata: 'CDG', date: '2026-08-15' }];
  const result = buildTripTimeline({ legs, legOffers: undefined, originAirport: ORIGIN, destinationAirports: [DEST] });
  assert.equal(result.isAvailable, true);
  const flightEntry = result.days[0].entries.find((e) => e.type === 'flight');
  assert.equal(flightEntry.status, 'unavailable');
});

// ---------------------------------------------------------------------
// Multi-city destination fix
// ---------------------------------------------------------------------

const FCO = { iata: 'FCO', city: 'Rome' };
const CIRCUIT_DESTS = [DEST, FCO]; // Paris, then Rome, then back to Delhi

function circuitLegs() {
  return [
    { fromIata: 'DEL', toIata: 'CDG', date: '2026-08-15' }, // arrive Paris
    { fromIata: 'CDG', toIata: 'FCO', date: '2026-08-18' }, // Paris -> Rome
    { fromIata: 'FCO', toIata: 'DEL', date: '2026-08-22' }, // Rome -> home
  ];
}

test('buildTripTimeline: multi-city — each destination gets its own hotels/attractions/restaurants', () => {
  const placesByDestination = {
    CDG: {
      hotels: [{ id: 'p-h1', name: 'Paris Hotel' }],
      attractions: [{ id: 'p-a1', name: 'Eiffel Tower' }],
      restaurants: [{ id: 'p-r1', name: 'Paris Bistro' }],
    },
    FCO: {
      hotels: [{ id: 'r-h1', name: 'Rome Hotel' }],
      attractions: [{ id: 'r-a1', name: 'Colosseum' }],
      restaurants: [{ id: 'r-r1', name: 'Rome Trattoria' }],
    },
  };

  const result = buildTripTimeline({
    legs: circuitLegs(),
    legOffers: [],
    originAirport: ORIGIN,
    destinationAirports: CIRCUIT_DESTS,
    placesByDestination,
  });

  assert.equal(result.isAvailable, true);
  assert.equal(result.usedPerDestinationData, true);
  assert.equal(result.hotelsAvailable, true);
  assert.equal(result.attractionsAvailable, true);
  assert.equal(result.restaurantsAvailable, true);

  // Paris hotel suggestion lands on day 1 (arrival in Paris), not Rome's.
  const day1Hotel = result.days[0].entries.find((e) => e.type === 'accommodation');
  assert.ok(day1Hotel);
  assert.equal(day1Hotel.options[0].name, 'Paris Hotel');
  assert.equal(day1Hotel.city, 'Paris');

  // Rome hotel suggestion lands on the day the trip arrives in Rome
  // (2026-08-18 => day index 3, since day dates run 08-15..08-22).
  const romeArrivalDayIndex = 3;
  const romeDayHotel = result.days[romeArrivalDayIndex].entries.find((e) => e.type === 'accommodation');
  assert.ok(romeDayHotel);
  assert.equal(romeDayHotel.options[0].name, 'Rome Hotel');
  assert.equal(romeDayHotel.city, 'Rome');

  // Rome's hotel is never attached to a Paris day, and vice versa.
  for (const day of result.days.slice(1, romeArrivalDayIndex)) {
    assert.equal(day.entries.some((e) => e.type === 'accommodation'), false);
  }

  // Attractions/restaurants for each city only ever appear within that
  // city's own day range (day indices 0-2 for Paris, 3-7 for Rome).
  const parisDays = result.days.slice(0, 3);
  const romeDays = result.days.slice(3);
  const parisAttractionNames = parisDays.flatMap((d) =>
    d.entries.filter((e) => e.type === 'attractions').flatMap((e) => e.items.map((i) => i.name))
  );
  const romeAttractionNames = romeDays.flatMap((d) =>
    d.entries.filter((e) => e.type === 'attractions').flatMap((e) => e.items.map((i) => i.name))
  );
  assert.ok(parisAttractionNames.includes('Eiffel Tower'));
  assert.ok(romeAttractionNames.includes('Colosseum'));
  assert.ok(!parisAttractionNames.includes('Colosseum'));
  assert.ok(!romeAttractionNames.includes('Eiffel Tower'));
});

test('buildTripTimeline: multi-city — origin is never treated as a destination needing places data', () => {
  const placesByDestination = {
    CDG: { hotels: [{ id: 'p-h1', name: 'Paris Hotel' }] },
    FCO: { hotels: [{ id: 'r-h1', name: 'Rome Hotel' }] },
  };

  const result = buildTripTimeline({
    legs: circuitLegs(),
    legOffers: [],
    originAirport: ORIGIN,
    destinationAirports: CIRCUIT_DESTS,
    placesByDestination,
  });

  // The final leg lands back at DEL (the origin) — it must never generate
  // its own accommodation entry, and DEL was never a key placesByDestination
  // needed to supply.
  assert.ok(!Object.prototype.hasOwnProperty.call(placesByDestination, 'DEL'));
  const lastDayAccommodation = result.days[result.days.length - 1].entries.find((e) => e.type === 'accommodation');
  assert.equal(lastDayAccommodation, undefined);
});

test('buildTripTimeline: multi-city — missing data for one destination does not crash and does not borrow another destination\'s data', () => {
  const placesByDestination = {
    CDG: {
      hotels: [{ id: 'p-h1', name: 'Paris Hotel' }],
      attractions: [{ id: 'p-a1', name: 'Eiffel Tower' }],
      restaurants: [{ id: 'p-r1', name: 'Paris Bistro' }],
    },
    // FCO (Rome) intentionally has no entry at all — simulates a failed or
    // empty Places fetch for that destination.
  };

  const result = buildTripTimeline({
    legs: circuitLegs(),
    legOffers: [],
    originAirport: ORIGIN,
    destinationAirports: CIRCUIT_DESTS,
    placesByDestination,
  });

  assert.equal(result.isAvailable, true);
  const romeArrivalDayIndex = 3;
  for (const day of result.days.slice(romeArrivalDayIndex)) {
    assert.equal(day.entries.some((e) => e.type === 'accommodation'), false);
    assert.equal(day.entries.some((e) => e.type === 'attractions'), false);
  }
  // Paris (which does have data) is unaffected by Rome's missing data.
  const day1Hotel = result.days[0].entries.find((e) => e.type === 'accommodation');
  assert.ok(day1Hotel);
});

test('buildTripTimeline: multi-city — falls back to legacy flat-list behavior when placesByDestination is not supplied', () => {
  const hotels = [{ id: 'h1', name: 'Some Hotel' }];

  const result = buildTripTimeline({
    legs: circuitLegs(),
    legOffers: [],
    originAirport: ORIGIN,
    destinationAirports: CIRCUIT_DESTS,
    hotels,
  });

  assert.equal(result.usedPerDestinationData, false);
  // Legacy behavior: flat hotel list attaches to day 0 regardless of which
  // destination it actually belongs to.
  const day1Hotel = result.days[0].entries.find((e) => e.type === 'accommodation');
  assert.ok(day1Hotel);
  assert.equal(day1Hotel.options[0].name, 'Some Hotel');
});

test('buildTripTimeline: single-destination behavior is completely unchanged when placesByDestination is passed but there is only one destination', () => {
  const legs = [{ fromIata: 'DEL', toIata: 'CDG', date: '2026-08-15' }];
  const legOffers = [[makeOffer('2026-08-15T09:00:00.000Z', '2026-08-15T18:00:00.000Z')]];
  const hotels = [{ id: 'h1', name: 'Hotel A' }];

  const withExtra = buildTripTimeline({
    legs,
    legOffers,
    originAirport: ORIGIN,
    destinationAirports: [DEST],
    hotels,
    placesByDestination: { CDG: { hotels: [{ id: 'ignored', name: 'Should not be used' }] } },
  });
  const withoutExtra = buildTripTimeline({ legs, legOffers, originAirport: ORIGIN, destinationAirports: [DEST], hotels });

  assert.equal(withExtra.usedPerDestinationData, false);
  assert.deepEqual(withExtra.days, withoutExtra.days);
});
