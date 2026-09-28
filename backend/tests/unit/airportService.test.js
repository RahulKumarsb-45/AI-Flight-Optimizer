jest.mock('axios');
const axios = require('axios');
const config = require('../../src/config/env');
const airportService = require('../../src/providers/airport/airportService');

describe('airportService.getByIata / requireByIata (local dataset)', () => {
  test('finds a known airport case-insensitively', () => {
    expect(airportService.getByIata('del')).not.toBeNull();
    expect(airportService.getByIata('DEL').city).toBe('New Delhi');
  });

  test('returns null for an unknown code via getByIata', () => {
    expect(airportService.getByIata('ZZZ')).toBeNull();
  });

  test('requireByIata throws AppError for a code unknown to both local data and any prior external search', () => {
    expect(() => airportService.requireByIata('ZZZ')).toThrow('Unknown airport code');
  });
});

describe('airportService.search (Ignav primary + local enrichment/fallback)', () => {
  const originalApiKey = config.ignav.apiKey;

  beforeEach(() => {
    jest.resetAllMocks();
    config.ignav.apiKey = 'test_ignav_key';
  });

  afterAll(() => {
    config.ignav.apiKey = originalApiKey;
  });

  test('empty query returns no results without calling Ignav', async () => {
    await expect(airportService.search('')).resolves.toEqual([]);
    await expect(airportService.search('   ')).resolves.toEqual([]);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('calls GET /airports with q and limit and the X-Api-Key header', async () => {
    axios.get.mockResolvedValue({ data: [] });
    await airportService.search('mumbai', 5);

    expect(axios.get).toHaveBeenCalledTimes(1);
    const [url, requestConfig] = axios.get.mock.calls[0];
    expect(url).toContain('/airports');
    expect(requestConfig.params).toEqual({ q: 'mumbai', limit: 5 });
    expect(requestConfig.headers['X-Api-Key']).toBe('test_ignav_key');
  });

  test('an Ignav-only airport (absent from the local 113-airport dataset) is returned, with no fabricated coordinates', async () => {
    axios.get.mockResolvedValue({
      data: [{ code: 'XYZ', name: 'Made Up Intl', city: 'Nowhere', country: 'Testland' }],
    });

    const results = await airportService.search('nowhere', 5);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ iata: 'XYZ', name: 'Made Up Intl', city: 'Nowhere', country: 'Testland' });
    expect(results[0].lat).toBeUndefined();
    expect(results[0].lon).toBeUndefined();
  });

  test('an Ignav match for a code that IS in the local dataset is enriched with local lat/lon/countryCode/rank, keeping Ignav name/city/country as authoritative', async () => {
    axios.get.mockResolvedValue({
      data: [{ code: 'DEL', name: 'Indira Gandhi Intl (Ignav)', city: 'New Delhi', country: 'India' }],
    });

    const results = await airportService.search('del', 5);
    expect(results[0].name).toBe('Indira Gandhi Intl (Ignav)');
    expect(results[0].lat).toBe(28.5562);
    expect(results[0].countryCode).toBe('IN');
  });

  test('local dataset does NOT limit search: when Ignav returns fewer than `limit`, local-only matches fill the remaining slots', async () => {
    axios.get.mockResolvedValue({ data: [{ code: 'ZZZ', name: 'Ignav Only', city: 'Somewhere', country: 'Nowhereland' }] });

    const results = await airportService.search('a', 25);
    expect(results.some((r) => r.iata === 'ZZZ')).toBe(true);
    // plenty of local airports contain "a" in city/name — confirms local fill kicked in
    expect(results.length).toBeGreaterThan(1);
  });

  test('never double-lists a code Ignav already returned, even though it also matches locally', async () => {
    axios.get.mockResolvedValue({
      data: [{ code: 'DEL', name: 'Indira Gandhi Intl', city: 'New Delhi', country: 'India' }],
    });

    const results = await airportService.search('del', 10);
    expect(results.filter((r) => r.iata === 'DEL')).toHaveLength(1);
  });

  test('falls back to local-only results (not an error) when Ignav is unreachable', async () => {
    axios.get.mockRejectedValue({ response: { status: 500, data: {} } });

    const results = await airportService.search('mumbai', 5);
    expect(results.some((a) => a.iata === 'BOM')).toBe(true);
  }, 15000);

  test('falls back to local-only results (not an error) when IGNAV_API_KEY is unset', async () => {
    config.ignav.apiKey = undefined;
    const results = await airportService.search('delhi', 5);
    expect(results.some((a) => a.iata === 'DEL')).toBe(true);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('respects the limit parameter across the merged (Ignav + local) result set', async () => {
    axios.get.mockResolvedValue({ data: [] });
    const results = await airportService.search('a', 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  test('gibberish query with no Ignav or local matches returns no results without throwing', async () => {
    axios.get.mockResolvedValue({ data: [] });
    await expect(airportService.search('zzzzxxxxqqqq')).resolves.toEqual([]);
  });
});

describe('airportService.requireByIata accepts an Ignav-only airport once seen via search()', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    config.ignav.apiKey = 'test_ignav_key';
  });

  test('a code only Ignav knows about becomes resolvable via requireByIata after a search() call finds it', async () => {
    axios.get.mockResolvedValue({
      data: [{ code: 'QRS', name: 'Quorsville Intl', city: 'Quorsville', country: 'Testland' }],
    });

    expect(() => airportService.requireByIata('QRS')).toThrow('Unknown airport code');
    await airportService.search('quorsville', 5);
    expect(airportService.requireByIata('QRS').city).toBe('Quorsville');
  });
});

describe('airportService.resolveByIata (async, live-lookup fallback)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    config.ignav.apiKey = 'test_ignav_key';
  });

  test('resolves a known local airport without calling Ignav', async () => {
    const airport = await airportService.resolveByIata('BOM');
    expect(airport.city).toBe('Mumbai');
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('resolves a code never seen before via a live Ignav lookup, matching the exact code', async () => {
    axios.get.mockResolvedValue({
      data: [
        { code: 'ABQ', name: 'Albuquerque Intl', city: 'Albuquerque', country: 'USA' },
        { code: 'ABZ', name: 'Not this one', city: 'Aberdeen', country: 'UK' },
      ],
    });

    const airport = await airportService.resolveByIata('abq');
    expect(airport.city).toBe('Albuquerque');
  });

  test('throws AIRPORT_NOT_FOUND when neither local, cache, nor a live Ignav lookup can resolve the code', async () => {
    axios.get.mockResolvedValue({ data: [] });
    await expect(airportService.resolveByIata('QQQ')).rejects.toThrow('Unknown airport code');
  });

  test('throws AIRPORT_NOT_FOUND (not a 502) when Ignav itself errors during the live lookup', async () => {
    axios.get.mockRejectedValue({ response: { status: 500, data: {} } });
    await expect(airportService.resolveByIata('QQQ')).rejects.toThrow('Unknown airport code');
  }, 15000);
});

describe('airportService.getNearbyAirports (sync, local/cache-only — unchanged for the optimizer)', () => {
  test('finds Pune as a nearby airport to Mumbai within a reasonable radius', () => {
    const nearby = airportService.getNearbyAirports('BOM');
    expect(nearby.some((a) => a.iata === 'PNQ')).toBe(true);
  });

  test('never returns the origin airport itself', () => {
    const nearby = airportService.getNearbyAirports('BOM');
    expect(nearby.some((a) => a.iata === 'BOM')).toBe(false);
  });

  test('respects the configured limit (default MAX_NEARBY_AIRPORTS)', () => {
    const nearby = airportService.getNearbyAirports('BOM');
    expect(nearby.length).toBeLessThanOrEqual(config.optimizer.maxNearbyAirports);
  });

  test('each result includes a distanceKm within the requested max radius', () => {
    const nearby = airportService.getNearbyAirports('BOM', 3, 300);
    for (const a of nearby) {
      expect(a.distanceKm).toBeLessThanOrEqual(300);
    }
  });
});

describe('airportService.getNearbyAirportsFor with an external-only origin (no coordinates)', () => {
  test('returns an empty array rather than throwing or fabricating coordinates', () => {
    const externalOrigin = { iata: 'XYZ', name: 'Made Up Intl', city: 'Nowhere', country: 'Testland' };
    expect(airportService.getNearbyAirportsFor(externalOrigin)).toEqual([]);
  });
});

describe('airportService.expandByCountry', () => {
  test('returns airports for a valid country code, ranked by importance', () => {
    const airports = airportService.expandByCountry('IN');
    expect(airports.length).toBeGreaterThan(0);
    for (let i = 1; i < airports.length; i++) {
      expect(airports[i - 1].rank).toBeGreaterThanOrEqual(airports[i].rank);
    }
  });

  test('returns an empty array for a country not in the dataset', () => {
    expect(airportService.expandByCountry('ZZ')).toEqual([]);
  });
});

describe('airportService.listCountries / listRegions', () => {
  test('listCountries returns unique countries with no duplicates', () => {
    const countries = airportService.listCountries();
    const codes = countries.map((c) => c.countryCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  test('listRegions returns a non-empty sorted list', () => {
    const regions = airportService.listRegions();
    expect(regions.length).toBeGreaterThan(0);
    expect(regions).toEqual([...regions].sort());
  });
});
