/**
 * PART 2 — real flight API integration tests.
 *
 * Covers the full POST /api/trips/optimize pipeline with
 * FLIGHT_PROVIDER=ignav and a mocked live Ignav fares API (axios.post),
 * proving end-to-end that:
 *   - a real one-way request reaches Ignav's /fares/one-way endpoint
 *   - a real round-trip request reaches Ignav's /fares/round-trip endpoint
 *     (a single combined call, not two independent one-way calls)
 *   - one-way and round-trip recommendation prices are exactly the
 *     amount(s) Ignav quoted (no fabrication, no multiplier, no re-summing)
 *   - the cheapest REAL Ignav offer on a leg is the one used, never an
 *     invented average
 *   - a total Ignav outage never produces mock-provider offers
 *
 * NOTE on round-trip: a single-destination round trip is fetched as ONE
 * combined search (flightFetchStage.fetchRoundTripCandidate), matching
 * FlightProviderContract.js's documented interface and reaching Ignav's
 * real POST /fares/round-trip endpoint. The combined offer's real total
 * price/duration/stops are used directly; the existing per-leg display
 * shape (`legOffers[0]` = outbound view, `legOffers[1]` = inbound view) is
 * preserved for the frontend by splitting the ONE real offer into two
 * views — never by splitting its price. See splitRoundTripOfferForDisplay
 * in flightFetchStage.js for why the inbound view's priceInr is null
 * rather than a guessed number.
 *
 * Origin is 'DEL', which is in the local 91-airport dataset, so this file
 * never needs to touch axios.get (airport lookups) — only axios.post
 * (flight fares) is exercised here, keeping this test focused on the
 * flight-provider layer (see optimizeIgnavOrigin.test.js for the airport
 * side of Ignav).
 *
 * Both cache layers reachable within a single test process are explicitly
 * cleared in beforeEach — the Postgres flight_cache table (resetDb() does
 * not touch it) and the in-process flightMemoryCache L0 layer — so an
 * earlier test's cached Ignav response in this same run can never be
 * silently served in place of a fresh (mocked) provider call.
 */
jest.mock('axios');
const axios = require('axios');
const request = require('supertest');
const app = require('../../src/app');
const config = require('../../src/config/env');
const { query } = require('../../src/database/pool');
const { flightMemoryCache } = require('../../src/cache/memoryCache');
const { resetDb, closeDb } = require('../helpers/db');

const originalProvider = config.flightProvider;
const originalApiKey = config.ignav.apiKey;

function ignavItinerary(fromIata, toIata, dateIso, priceInr, overrides = {}) {
  return {
    price: { amount: priceInr, currency: 'INR', status: 'verified' },
    outbound: {
      carrier: 'Air India',
      duration_minutes: 540,
      segments: [
        {
          marketing_carrier_code: 'AI',
          flight_number: '101',
          departure_airport: fromIata,
          departure_time_utc: `${dateIso}T04:00:00Z`,
          arrival_airport: toIata,
          arrival_time_utc: `${dateIso}T13:00:00Z`,
          duration_minutes: 540,
        },
      ],
    },
    cabin_class: 'economy',
    ignav_id: `ignav_${fromIata}${toIata}_${priceInr}`,
    ...overrides,
  };
}

function ignavRoundTripItinerary(fromIata, toIata, departureDateIso, returnDateIso, totalPriceInr, overrides = {}) {
  return {
    price: { amount: totalPriceInr, currency: 'INR', status: 'verified' }, // ONE total for the whole round trip, exactly as Ignav quotes it
    outbound: {
      carrier: 'Air India',
      duration_minutes: 540,
      segments: [
        {
          marketing_carrier_code: 'AI',
          flight_number: '101',
          departure_airport: fromIata,
          departure_time_utc: `${departureDateIso}T04:00:00Z`,
          arrival_airport: toIata,
          arrival_time_utc: `${departureDateIso}T13:00:00Z`,
          duration_minutes: 540,
        },
      ],
    },
    inbound: {
      carrier: 'Air India',
      duration_minutes: 560,
      segments: [
        {
          marketing_carrier_code: 'AI',
          flight_number: '102',
          departure_airport: toIata,
          departure_time_utc: `${returnDateIso}T14:00:00Z`,
          arrival_airport: fromIata,
          arrival_time_utc: `${returnDateIso}T23:20:00Z`,
          duration_minutes: 560,
        },
      ],
    },
    cabin_class: 'economy',
    ignav_id: `ignav_rt_${fromIata}${toIata}_${totalPriceInr}`,
    ...overrides,
  };
}

beforeEach(async () => {
  await resetDb();
  await query('TRUNCATE TABLE flight_cache');
  flightMemoryCache.clear(); // in-process L0 cache isn't touched by TRUNCATE — must clear separately for true per-test isolation
  jest.resetAllMocks();
  config.flightProvider = 'ignav';
  config.ignav.apiKey = 'test_ignav_key';
});

afterAll(async () => {
  config.flightProvider = originalProvider;
  config.ignav.apiKey = originalApiKey;
  await closeDb();
});

describe('POST /api/trips/optimize with FLIGHT_PROVIDER=ignav (real fares API, mocked at the HTTP boundary)', () => {
  test('one-way: a real Ignav /fares/one-way request is made and the recommendation price is exactly what Ignav quoted', async () => {
    axios.post.mockResolvedValue({
      data: { itineraries: [ignavItinerary('DEL', 'LHR', '2027-03-10', 41000)] },
    });

    const res = await request(app).post('/api/trips/optimize').send({
      originIata: 'DEL',
      destinationCountries: ['GB'],
      departureDate: '2027-03-10',
      travelers: 1,
      preference: 'cheapest',
    });

    expect(res.status).toBe(200);
    expect(axios.post).toHaveBeenCalled();
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toContain('/fares/one-way');
    expect(body.return_date).toBeUndefined();
    expect(body.market).toBe('IN');

    expect(res.body.data.recommendations.length).toBeGreaterThan(0);
    const top = res.body.data.recommendations[0];
    expect(top.totalPriceInr).toBe(41000);
    expect(top.legOffers[0][0].provider).toBe('ignav');
    expect(top.legOffers[0][0].currency).toBe('INR');
  });

  test('round-trip: a real Ignav /fares/round-trip request is made (ONE combined call, not two one-way calls) and the recommendation price is exactly Ignav\'s quoted total', async () => {
    axios.post.mockImplementation(async (url, body) => ({
      data: { itineraries: [ignavRoundTripItinerary(body.origin, body.destination, body.departure_date, body.return_date, 76500)] },
    }));

    const res = await request(app).post('/api/trips/optimize').send({
      originIata: 'DEL',
      destinationCountries: ['GB'],
      departureDate: '2027-03-10',
      returnDate: '2027-03-17',
      travelers: 1,
      preference: 'cheapest',
    });

    expect(res.status).toBe(200);
    // exactly one Ignav call per candidate leg-pair, hitting the real
    // round-trip endpoint with both dates — never two separate one-way calls
    expect(axios.post).toHaveBeenCalled();
    for (const [url, body] of axios.post.mock.calls) {
      expect(url).toContain('/fares/round-trip');
      expect(body.return_date).toBe('2027-03-17');
      expect(body.departure_date).toBe('2027-03-10');
    }

    const top = res.body.data.recommendations[0];
    // the exact combined total Ignav quoted — never re-summed from two fares
    expect(top.totalPriceInr).toBe(76500);
    expect(top.totalDurationMinutes).toBe(540 + 560);

    // response format is preserved: still one legOffers array per displayed leg
    expect(top.legOffers).toHaveLength(2);
    const outboundOffer = top.legOffers[0][0];
    const inboundOffer = top.legOffers[1][0];

    expect(outboundOffer.provider).toBe('ignav');
    expect(outboundOffer.currency).toBe('INR');
    expect(outboundOffer.outbound[0].airline).toBe('AI');
    expect(outboundOffer.outbound[0].flightNumber).toBe('AI101');
    expect(outboundOffer.outbound[0].fromIata).toBe('DEL');
    expect(outboundOffer.outbound[0].toIata).toBe('LHR');
    expect(outboundOffer.stops).toBe(0);
    // the whole real total is attached once (outbound view) — never split/guessed
    expect(outboundOffer.priceInr).toBe(76500);

    // inbound view carries the REAL return segment (flight number, airports,
    // duration) — mapped correctly even though it's under `.outbound` in the
    // display-view shape (see splitRoundTripOfferForDisplay)
    expect(inboundOffer.outbound[0].airline).toBe('AI');
    expect(inboundOffer.outbound[0].flightNumber).toBe('AI102');
    expect(inboundOffer.outbound[0].fromIata).toBe('LHR');
    expect(inboundOffer.outbound[0].toIata).toBe('DEL');
    expect(inboundOffer.stops).toBe(0);
    // no separate inbound fare was ever quoted by Ignav — must be null, never fabricated
    expect(inboundOffer.priceInr).toBeNull();
  });

  test('round-trip with multiple Ignav offers: the cheapest REAL combined itinerary is used, never an invented average', async () => {
    axios.post.mockImplementation(async (url, body) => ({
      data: {
        itineraries: [
          ignavRoundTripItinerary(body.origin, body.destination, body.departure_date, body.return_date, 90000, { ignav_id: 'mid' }),
          ignavRoundTripItinerary(body.origin, body.destination, body.departure_date, body.return_date, 68000, { ignav_id: 'cheapest' }),
          ignavRoundTripItinerary(body.origin, body.destination, body.departure_date, body.return_date, 99000, { ignav_id: 'priciest' }),
        ],
      },
    }));

    const res = await request(app).post('/api/trips/optimize').send({
      originIata: 'DEL',
      destinationCountries: ['GB'],
      departureDate: '2027-03-10',
      returnDate: '2027-03-17',
      travelers: 1,
      preference: 'cheapest',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.recommendations[0].totalPriceInr).toBe(68000);
  });

  test('a total Ignav outage on the round-trip endpoint never produces mock-provider offers', async () => {
    axios.post.mockRejectedValue({ response: { status: 401, data: { error: { code: 'invalid_api_key' } } } });

    const res = await request(app).post('/api/trips/optimize').send({
      originIata: 'DEL',
      destinationCountries: ['GB'],
      departureDate: '2027-03-10',
      returnDate: '2027-03-17',
      travelers: 1,
      preference: 'cheapest',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.recommendations).toEqual([]);
  });

  test('multiple Ignav offers on a leg: the cheapest REAL offer is used for pricing, never an invented average or estimate', async () => {
    axios.post.mockResolvedValue({
      data: {
        itineraries: [
          ignavItinerary('DEL', 'LHR', '2027-03-10', 52000, { ignav_id: 'mid' }),
          ignavItinerary('DEL', 'LHR', '2027-03-10', 38000, { ignav_id: 'cheapest' }),
          ignavItinerary('DEL', 'LHR', '2027-03-10', 60000, { ignav_id: 'priciest' }),
        ],
      },
    });

    const res = await request(app).post('/api/trips/optimize').send({
      originIata: 'DEL',
      destinationCountries: ['GB'],
      departureDate: '2027-03-10',
      travelers: 1,
      preference: 'cheapest',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.recommendations[0].totalPriceInr).toBe(38000);
  });

  test('a total Ignav outage (invalid API key on every call) never produces mock-provider offers — recommendations stay empty rather than being filled with fake data', async () => {
    axios.post.mockRejectedValue({ response: { status: 401, data: { error: { code: 'invalid_api_key' } } } });

    const res = await request(app).post('/api/trips/optimize').send({
      originIata: 'DEL',
      destinationCountries: ['GB'],
      departureDate: '2027-03-10',
      travelers: 1,
      preference: 'cheapest',
    });

    // The optimizer's per-candidate error isolation (flightFetchStage.js,
    // pre-existing/shared across all providers) drops every candidate whose
    // leg fetch throws, so a total provider outage currently surfaces as a
    // 200 with zero recommendations rather than a distinct error status.
    // The critical property this test guards is the second assertion: it
    // must never fill that gap with mock/fabricated offers.
    expect(res.status).toBe(200);
    expect(res.body.data.recommendations).toEqual([]);
    expect(res.body.data.meta.resultCount).toBe(0);
  });

  test('Ignav billing failure (402) on every call also never falls back to mock offers', async () => {
    axios.post.mockRejectedValue({ response: { status: 402, data: { error: { code: 'billing_required' } } } });

    const res = await request(app).post('/api/trips/optimize').send({
      originIata: 'DEL',
      destinationCountries: ['GB'],
      departureDate: '2027-03-10',
      travelers: 1,
      preference: 'cheapest',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.recommendations).toEqual([]);
  });
});
