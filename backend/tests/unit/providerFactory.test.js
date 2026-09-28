jest.mock('../../src/providers/flight/mockProvider');
jest.mock('../../src/providers/flight/amadeusProvider');
jest.mock('../../src/providers/flight/ignavProvider');

const mockProvider = require('../../src/providers/flight/mockProvider');
const amadeusProvider = require('../../src/providers/flight/amadeusProvider');
const ignavProvider = require('../../src/providers/flight/ignavProvider');
const config = require('../../src/config/env');
const providerFactory = require('../../src/providers/flight/providerFactory');

const params = { originIata: 'DEL', destinationIata: 'LHR', departureDate: '2026-08-15', adults: 1 };

describe('providerFactory', () => {
  const originalProvider = config.flightProvider;

  afterEach(() => {
    config.flightProvider = originalProvider;
    jest.resetAllMocks();
  });

  test('getProvider() returns ignavProvider when FLIGHT_PROVIDER=ignav', () => {
    config.flightProvider = 'ignav';
    expect(providerFactory.getProvider()).toBe(ignavProvider);
  });

  test('getProvider() returns amadeusProvider when FLIGHT_PROVIDER=amadeus', () => {
    config.flightProvider = 'amadeus';
    expect(providerFactory.getProvider()).toBe(amadeusProvider);
  });

  test('getProvider() returns mockProvider when FLIGHT_PROVIDER=mock', () => {
    config.flightProvider = 'mock';
    expect(providerFactory.getProvider()).toBe(mockProvider);
  });

  test('getProvider() falls back to mock for an unrecognized provider name (config typo, not a runtime failure)', () => {
    config.flightProvider = 'not_a_real_provider';
    expect(providerFactory.getProvider()).toBe(mockProvider);
  });

  test('searchWithFallback calls the configured real provider and returns its offers as-is', async () => {
    config.flightProvider = 'ignav';
    const realOffers = [{ id: 'real1', provider: 'ignav', priceInr: 12345 }];
    ignavProvider.search.mockResolvedValue(realOffers);

    const result = await providerFactory.searchWithFallback(params);

    expect(result).toBe(realOffers);
    expect(mockProvider.search).not.toHaveBeenCalled();
  });

  test('searchWithFallback does NOT silently substitute mock data when the real provider (ignav) throws', async () => {
    config.flightProvider = 'ignav';
    ignavProvider.search.mockRejectedValue(new Error('Ignav credentials are not configured.'));

    await expect(providerFactory.searchWithFallback(params)).rejects.toThrow('Ignav credentials are not configured.');
    expect(mockProvider.search).not.toHaveBeenCalled();
  });

  test('searchWithFallback does NOT silently substitute mock data when the real provider (amadeus) throws', async () => {
    config.flightProvider = 'amadeus';
    amadeusProvider.search.mockRejectedValue(new Error('Amadeus provider error'));

    await expect(providerFactory.searchWithFallback(params)).rejects.toThrow('Amadeus provider error');
    expect(mockProvider.search).not.toHaveBeenCalled();
  });

  test('searchWithFallback with FLIGHT_PROVIDER=mock just calls mockProvider directly', async () => {
    config.flightProvider = 'mock';
    const mockOffers = [{ id: 'mock1', provider: 'mock', priceInr: 5000 }];
    mockProvider.search.mockResolvedValue(mockOffers);

    const result = await providerFactory.searchWithFallback(params);
    expect(result).toBe(mockOffers);
  });
});
