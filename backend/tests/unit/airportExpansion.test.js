jest.mock('axios');
const axios = require('axios');
const config = require('../../src/config/env');
const { expandOrigin, expandDestinationCountry } = require('../../src/optimizer/stages/airportExpansion');

/**
 * expandOrigin() is the optimizer's single entry point for resolving the
 * trip's origin airport (see optimizer.js). These tests cover the Part 1
 * fix: it must resolve an Ignav-only origin even on a cold cache (simulated
 * server restart), it must never fall back to the local-only sync path,
 * and it must never fabricate coordinates for nearby-airport expansion when
 * Ignav doesn't provide any.
 */
describe('airportExpansion.expandOrigin', () => {
  const originalApiKey = config.ignav.apiKey;

  beforeEach(() => {
    jest.resetAllMocks();
    config.ignav.apiKey = 'test_ignav_key';
  });

  afterAll(() => {
    config.ignav.apiKey = originalApiKey;
  });

  test('resolves a known local airport (with nearby expansion) exactly as before', async () => {
    axios.get.mockResolvedValue({ data: [] }); // Ignav returns nothing extra; local dataset still applies
    const options = await expandOrigin('BOM', true);

    const primary = options.find((o) => o.isPrimary);
    expect(primary.iata).toBe('BOM');
    expect(options.length).toBeGreaterThan(1); // nearby options were added (e.g. PNQ)
  });

  test('resolves an Ignav-only origin (absent from the local dataset) via a live lookup on a cold cache, with no prior search() call', async () => {
    axios.get.mockResolvedValue({
      data: [{ code: 'QRS', name: 'Quorsville Intl', city: 'Quorsville', country: 'Testland' }],
    });

    const options = await expandOrigin('QRS', true);

    expect(axios.get).toHaveBeenCalledTimes(1); // proves this was a live lookup, not a cache hit
    const primary = options.find((o) => o.isPrimary);
    expect(primary).toMatchObject({ iata: 'QRS', city: 'Quorsville' });
  });

  test('an Ignav-only origin with no coordinates gets no fabricated nearby airports (returns just itself)', async () => {
    axios.get.mockResolvedValue({
      data: [{ code: 'QRS', name: 'Quorsville Intl', city: 'Quorsville', country: 'Testland' }],
    });

    const options = await expandOrigin('QRS', true);

    expect(options).toHaveLength(1);
    expect(options[0].isPrimary).toBe(true);
    expect(options[0].lat).toBeUndefined();
    expect(options[0].lon).toBeUndefined();
  });

  test('includeNearby=false skips nearby expansion entirely, even for a local airport', async () => {
    axios.get.mockResolvedValue({ data: [] });
    const options = await expandOrigin('BOM', false);
    expect(options).toHaveLength(1);
    expect(options[0].isPrimary).toBe(true);
  });

  test('rejects a code unknown to both the local dataset and a live Ignav lookup', async () => {
    axios.get.mockResolvedValue({ data: [] });
    await expect(expandOrigin('ZZZ', true)).rejects.toThrow('Unknown airport code');
  });
});

describe('airportExpansion.expandDestinationCountry (unchanged local-only path)', () => {
  test('still returns local, ranked airports for a valid country code', () => {
    const options = expandDestinationCountry('GB', { airportsPerCountry: 2, includeNearby: false });
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((o) => o.isPrimary)).toBe(true);
  });
});
