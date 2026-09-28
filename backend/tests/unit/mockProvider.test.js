const mockProvider = require('../../src/providers/flight/mockProvider');

describe('mockProvider.search', () => {
  test('returns multiple one-way offers for a valid route', async () => {
    const offers = await mockProvider.search({
      originIata: 'DEL',
      destinationIata: 'LHR',
      departureDate: '2026-08-15',
      adults: 1,
      cabinClass: 'economy',
    });
    expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers) {
      expect(offer.provider).toBe('mock');
      expect(offer.currency).toBe('INR');
      expect(offer.priceInr).toBeGreaterThan(0);
      expect(offer.inbound).toBeNull();
    }
  });

  test('offers are sorted cheapest first', async () => {
    const offers = await mockProvider.search({
      originIata: 'DEL',
      destinationIata: 'LHR',
      departureDate: '2026-08-15',
      adults: 1,
    });
    for (let i = 1; i < offers.length; i++) {
      expect(offers[i].priceInr).toBeGreaterThanOrEqual(offers[i - 1].priceInr);
    }
  });

  test('round trip (returnDate given) includes both outbound and inbound segments', async () => {
    const offers = await mockProvider.search({
      originIata: 'DEL',
      destinationIata: 'LHR',
      departureDate: '2026-08-15',
      returnDate: '2026-08-22',
      adults: 1,
    });
    expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers) {
      expect(offer.outbound.length).toBeGreaterThan(0);
      expect(offer.inbound.length).toBeGreaterThan(0);
    }
  });

  test('price scales with passenger count', async () => {
    const params = { originIata: 'DEL', destinationIata: 'LHR', departureDate: '2026-08-15' };
    const single = await mockProvider.search({ ...params, adults: 1 });
    const family = await mockProvider.search({ ...params, adults: 4 });
    expect(family[0].priceInr).toBeGreaterThan(single[0].priceInr);
  });

  test('longer routes cost more than shorter ones (distance-based pricing)', async () => {
    const short = await mockProvider.search({ originIata: 'DEL', destinationIata: 'BOM', departureDate: '2026-08-15', adults: 1 });
    const long = await mockProvider.search({ originIata: 'DEL', destinationIata: 'JFK', departureDate: '2026-08-15', adults: 1 });
    expect(long[0].priceInr).toBeGreaterThan(short[0].priceInr);
  });

  test('every segment has a valid IATA-format flight number and airline code', async () => {
    const offers = await mockProvider.search({ originIata: 'DEL', destinationIata: 'LHR', departureDate: '2026-08-15', adults: 1 });
    for (const seg of offers[0].outbound) {
      expect(seg.airline).toMatch(/^[A-Z0-9]{2}$/);
      expect(seg.flightNumber).toMatch(/^[A-Z0-9]{2}\d+$/);
    }
  });

  test('arrival time is always after departure time for every segment', async () => {
    const offers = await mockProvider.search({ originIata: 'DEL', destinationIata: 'LHR', departureDate: '2026-08-15', adults: 1 });
    for (const offer of offers) {
      for (const seg of offer.outbound) {
        expect(new Date(seg.arrivalTime).getTime()).toBeGreaterThan(new Date(seg.departureTime).getTime());
      }
    }
  });

  test('falls back gracefully to a default distance for an airport code outside the static dataset', async () => {
    await expect(
      mockProvider.search({ originIata: 'ZZZ', destinationIata: 'LHR', departureDate: '2026-08-15', adults: 1 })
    ).resolves.toBeDefined();
  });
});
