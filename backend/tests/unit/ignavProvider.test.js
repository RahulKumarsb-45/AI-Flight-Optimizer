jest.mock('axios');
const axios = require('axios');
const config = require('../../src/config/env');
const ignavProvider = require('../../src/providers/flight/ignavProvider');

function oneWayResponse(overrides = {}) {
  return {
    origin: 'SFO',
    destination: 'JFK',
    departure_date: '2026-10-22',
    itineraries: [
      {
        price: { amount: 24999, currency: 'INR', status: 'verified' },
        outbound: {
          carrier: 'American Airlines',
          duration_minutes: 330,
          segments: [
            {
              marketing_carrier_code: 'AA',
              flight_number: '100',
              operating_carrier_name: 'American Airlines',
              departure_airport: 'SFO',
              departure_time_local: '2026-10-22T08:00:00',
              departure_timezone: 'America/Los_Angeles',
              departure_time_utc: '2026-10-22T15:00:00Z',
              arrival_airport: 'JFK',
              arrival_time_local: '2026-10-22T16:30:00',
              arrival_timezone: 'America/New_York',
              arrival_time_utc: '2026-10-22T20:30:00Z',
              duration_minutes: 330,
              aircraft: 'Boeing 777',
            },
          ],
        },
        cabin_class: 'economy',
        requires_self_transfer: false,
        ignav_id: '5e4fcd2f1dc340649eb19f6ee2afb57a',
        ...overrides,
      },
    ],
  };
}

function roundTripResponse() {
  return {
    origin: 'SFO',
    destination: 'LHR',
    departure_date: '2026-10-22',
    return_date: '2026-10-29',
    itineraries: [
      {
        price: { amount: 74999, currency: 'INR', status: 'verified' },
        outbound: {
          carrier: 'British Airways',
          duration_minutes: 625,
          segments: [
            {
              marketing_carrier_code: 'BA',
              flight_number: '286',
              operating_carrier_name: 'British Airways',
              departure_airport: 'SFO',
              departure_time_local: '2026-10-22T17:30:00',
              departure_timezone: 'America/Los_Angeles',
              departure_time_utc: '2026-10-23T00:30:00Z',
              arrival_airport: 'LHR',
              arrival_time_local: '2026-10-23T11:55:00',
              arrival_timezone: 'Europe/London',
              arrival_time_utc: '2026-10-23T10:55:00Z',
              duration_minutes: 625,
              aircraft: 'Airbus A380',
            },
          ],
        },
        inbound: {
          carrier: 'British Airways',
          duration_minutes: 660,
          segments: [
            {
              marketing_carrier_code: 'BA',
              flight_number: '287',
              operating_carrier_name: 'British Airways',
              departure_airport: 'LHR',
              departure_time_local: '2026-10-29T10:00:00',
              departure_timezone: 'Europe/London',
              departure_time_utc: '2026-10-29T09:00:00Z',
              arrival_airport: 'SFO',
              arrival_time_local: '2026-10-29T13:00:00',
              arrival_timezone: 'America/Los_Angeles',
              arrival_time_utc: '2026-10-29T20:00:00Z',
              duration_minutes: 660,
              aircraft: 'Airbus A380',
            },
          ],
        },
        cabin_class: 'economy',
        requires_self_transfer: false,
        ignav_id: 'a1b2c3d4e5f6789012345678abcdef01',
      },
    ],
  };
}

const baseParams = {
  originIata: 'SFO',
  destinationIata: 'JFK',
  departureDate: '2026-10-22',
  adults: 1,
  cabinClass: 'economy',
};

describe('ignavProvider.search', () => {
  const originalApiKey = config.ignav.apiKey;

  beforeEach(() => {
    jest.resetAllMocks();
    config.ignav.apiKey = 'test_ignav_key';
  });

  afterAll(() => {
    config.ignav.apiKey = originalApiKey;
  });

  test('throws a clear config error and never calls axios when IGNAV_API_KEY is unset', async () => {
    config.ignav.apiKey = undefined;
    await expect(ignavProvider.search(baseParams)).rejects.toThrow(/IGNAV_API_KEY/);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('calls the one-way endpoint with X-Api-Key header and market=IN when no returnDate is given', async () => {
    axios.post.mockResolvedValue({ data: oneWayResponse() });

    await ignavProvider.search(baseParams);

    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body, requestConfig] = axios.post.mock.calls[0];
    expect(url).toContain('/fares/one-way');
    expect(body).toMatchObject({ origin: 'SFO', destination: 'JFK', departure_date: '2026-10-22', market: 'IN' });
    expect(body.return_date).toBeUndefined();
    expect(requestConfig.headers['X-Api-Key']).toBe('test_ignav_key');
  });

  test('calls the round-trip endpoint and includes return_date when returnDate is given', async () => {
    axios.post.mockResolvedValue({ data: roundTripResponse() });

    await ignavProvider.search({ ...baseParams, destinationIata: 'LHR', returnDate: '2026-10-29' });

    const [url, body] = axios.post.mock.calls[0];
    expect(url).toContain('/fares/round-trip');
    expect(body.return_date).toBe('2026-10-29');
  });

  test('maps price.amount/currency straight through, unmodified — no fake conversion or multiplier', async () => {
    axios.post.mockResolvedValue({ data: oneWayResponse() });

    const offers = await ignavProvider.search(baseParams);

    expect(offers).toHaveLength(1);
    expect(offers[0].priceInr).toBe(24999);
    expect(offers[0].currency).toBe('INR');
    expect(offers[0].provider).toBe('ignav');
    expect(offers[0].id).toBe('5e4fcd2f1dc340649eb19f6ee2afb57a');
  });

  test('maps airline, flight number, airports, and duration from the segment', async () => {
    axios.post.mockResolvedValue({ data: oneWayResponse() });

    const offers = await ignavProvider.search(baseParams);
    const seg = offers[0].outbound[0];

    expect(seg.airline).toBe('AA');
    expect(seg.flightNumber).toBe('AA100');
    expect(seg.fromIata).toBe('SFO');
    expect(seg.toIata).toBe('JFK');
    expect(seg.departureTime).toBe('2026-10-22T15:00:00Z');
    expect(seg.arrivalTime).toBe('2026-10-22T20:30:00Z');
    expect(seg.durationMinutes).toBe(330);
  });

  test('computes stops as segments.length - 1 for a direct flight', async () => {
    axios.post.mockResolvedValue({ data: oneWayResponse() });
    const offers = await ignavProvider.search(baseParams);
    expect(offers[0].stops).toBe(0);
    expect(offers[0].inbound).toBeNull();
  });

  test('round trip includes an inbound leg and sums stops/duration across both legs', async () => {
    axios.post.mockResolvedValue({ data: roundTripResponse() });
    const offers = await ignavProvider.search({ ...baseParams, destinationIata: 'LHR', returnDate: '2026-10-29' });

    expect(offers[0].inbound).not.toBeNull();
    expect(offers[0].inbound[0].airline).toBe('BA');
    expect(offers[0].totalDurationMinutes).toBe(625 + 660);
    expect(offers[0].stops).toBe(0);
  });

  test('drops (does not fabricate) an itinerary whose price currency is not INR', async () => {
    const response = oneWayResponse({ price: { amount: 299, currency: 'USD', status: 'verified' } });
    axios.post.mockResolvedValue({ data: response });

    const offers = await ignavProvider.search(baseParams);
    expect(offers).toEqual([]);
  });

  test('does NOT unnecessarily discard a valid INR offer over currency-code formatting (lowercase/whitespace)', async () => {
    const response = oneWayResponse({ price: { amount: 24999, currency: 'inr', status: 'verified' } });
    axios.post.mockResolvedValue({ data: response });

    const offers = await ignavProvider.search(baseParams);
    expect(offers).toHaveLength(1);
    expect(offers[0].priceInr).toBe(24999);
    expect(offers[0].currency).toBe('INR');
  });

  test('accepts a numeric-string price amount rather than dropping the offer, without altering the value', async () => {
    const response = oneWayResponse({ price: { amount: '24999', currency: 'INR', status: 'verified' } });
    axios.post.mockResolvedValue({ data: response });

    const offers = await ignavProvider.search(baseParams);
    expect(offers).toHaveLength(1);
    expect(offers[0].priceInr).toBe(24999);
    expect(typeof offers[0].priceInr).toBe('number');
  });

  test('drops (does not fabricate) an itinerary whose price amount is not a usable number', async () => {
    const response = oneWayResponse({ price: { amount: 'not_a_number', currency: 'INR', status: 'verified' } });
    axios.post.mockResolvedValue({ data: response });

    const offers = await ignavProvider.search(baseParams);
    expect(offers).toEqual([]);
  });

  test('still drops an itinerary with a genuinely different currency (not just a formatting difference)', async () => {
    const response = oneWayResponse({ price: { amount: 299, currency: 'GBP', status: 'verified' } });
    axios.post.mockResolvedValue({ data: response });

    const offers = await ignavProvider.search(baseParams);
    expect(offers).toEqual([]);
  });

  test('offers are sorted cheapest first', async () => {
    const response = oneWayResponse();
    response.itineraries.push({
      ...response.itineraries[0],
      ignav_id: 'cheaper_one',
      price: { amount: 9999, currency: 'INR', status: 'verified' },
    });
    axios.post.mockResolvedValue({ data: response });

    const offers = await ignavProvider.search(baseParams);
    expect(offers[0].id).toBe('cheaper_one');
    expect(offers[0].priceInr).toBeLessThan(offers[1].priceInr);
  });

  test('maps a 401 response to a clear, non-retried auth error', async () => {
    axios.post.mockRejectedValue({ response: { status: 401, data: { error: { code: 'invalid_api_key' } } } });
    await expect(ignavProvider.search(baseParams)).rejects.toThrow(/rejected the configured API key/);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test('maps a 402 (billing_required) response to a clear billing error, not a silent mock substitution', async () => {
    axios.post.mockRejectedValue({ response: { status: 402, data: { error: { code: 'billing_required' } } } });
    await expect(ignavProvider.search(baseParams)).rejects.toThrow(/billing/i);
  });

  test('surfaces an invalid_request 400 error with the field-level message', async () => {
    axios.post.mockRejectedValue({
      response: {
        status: 400,
        data: { error: { type: 'invalid_request', code: 'invalid_airport_code', message: 'origin must be a supported code.', field: 'origin' } },
      },
    });
    await expect(ignavProvider.search(baseParams)).rejects.toThrow(/origin must be a supported code/);
  });

  test('retries a 429 up to the retry cap and eventually succeeds', async () => {
    axios.post
      .mockRejectedValueOnce({ response: { status: 429, data: { error: { code: 'monthly_spend_limit_reached' } } } })
      .mockResolvedValueOnce({ data: oneWayResponse() });

    const offers = await ignavProvider.search(baseParams);
    expect(offers).toHaveLength(1);
    expect(axios.post).toHaveBeenCalledTimes(2);
  }, 10000);

  test('retries a 5xx upstream error and eventually succeeds', async () => {
    axios.post
      .mockRejectedValueOnce({ response: { status: 503, data: {} } })
      .mockResolvedValueOnce({ data: oneWayResponse() });

    const offers = await ignavProvider.search(baseParams);
    expect(offers).toHaveLength(1);
    expect(axios.post).toHaveBeenCalledTimes(2);
  }, 10000);

  test('gives up after MAX_RETRIES and throws a generic provider-unavailable error', async () => {
    axios.post.mockRejectedValue({ response: { status: 500, data: {} } });
    await expect(ignavProvider.search(baseParams)).rejects.toThrow(/temporarily unavailable/);
  }, 15000);

  test('returns an empty array (not an error) when Ignav returns no itineraries', async () => {
    axios.post.mockResolvedValue({ data: { origin: 'SFO', destination: 'JFK', departure_date: '2026-10-22', itineraries: [] } });
    const offers = await ignavProvider.search(baseParams);
    expect(offers).toEqual([]);
  });
});
