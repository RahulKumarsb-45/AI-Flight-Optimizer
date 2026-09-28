jest.mock('axios');
const axios = require('axios');
const config = require('../../src/config/env');
const ignavAirportProvider = require('../../src/providers/airport/ignavAirportProvider');

describe('ignavAirportProvider.searchAirports', () => {
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
    await expect(ignavAirportProvider.searchAirports('del')).rejects.toThrow(/IGNAV_API_KEY/);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('calls GET /airports with q and limit, and the X-Api-Key header', async () => {
    axios.get.mockResolvedValue({ data: [] });

    await ignavAirportProvider.searchAirports('mumbai', 5);

    expect(axios.get).toHaveBeenCalledTimes(1);
    const [url, requestConfig] = axios.get.mock.calls[0];
    expect(url).toContain('/airports');
    expect(requestConfig.params).toEqual({ q: 'mumbai', limit: 5 });
    expect(requestConfig.headers['X-Api-Key']).toBe('test_ignav_key');
  });

  test('clamps limit into Ignav\'s documented 1-20 range rather than sending an out-of-range value', async () => {
    axios.get.mockResolvedValue({ data: [] });

    await ignavAirportProvider.searchAirports('a', 999);
    expect(axios.get.mock.calls[0][1].params.limit).toBe(20);

    await ignavAirportProvider.searchAirports('a', 0);
    expect(axios.get.mock.calls[1][1].params.limit).toBe(1);
  });

  test('returns the AirportModel array (code, name, city, country) verbatim — no invented fields', async () => {
    const data = [{ code: 'DEL', name: 'Indira Gandhi International Airport', city: 'New Delhi', country: 'India' }];
    axios.get.mockResolvedValue({ data });

    const results = await ignavAirportProvider.searchAirports('del', 5);
    expect(results).toEqual(data);
  });

  test('returns an empty array (not an error) when Ignav returns no matches', async () => {
    axios.get.mockResolvedValue({ data: [] });
    const results = await ignavAirportProvider.searchAirports('zzzzxxxxqqqq', 5);
    expect(results).toEqual([]);
  });

  test('maps a 401 response to a clear, non-retried auth error', async () => {
    axios.get.mockRejectedValue({ response: { status: 401, data: { error: { code: 'invalid_api_key' } } } });
    await expect(ignavAirportProvider.searchAirports('del')).rejects.toThrow(/rejected the configured API key/);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  test('maps a 402 (billing_required) response to a clear billing error', async () => {
    axios.get.mockRejectedValue({ response: { status: 402, data: { error: { code: 'billing_required' } } } });
    await expect(ignavAirportProvider.searchAirports('del')).rejects.toThrow(/billing/i);
  });

  test('surfaces a 400 invalid-request error with the field-level message', async () => {
    axios.get.mockRejectedValue({
      response: { status: 400, data: { error: { code: 'invalid_query', message: 'q must not be empty.', field: 'q' } } },
    });
    await expect(ignavAirportProvider.searchAirports('')).rejects.toThrow(/q must not be empty/);
  });

  test('retries a 429 up to the retry cap and eventually succeeds', async () => {
    axios.get
      .mockRejectedValueOnce({ response: { status: 429, data: { error: { code: 'rate_limited' } } } })
      .mockResolvedValueOnce({ data: [] });

    const results = await ignavAirportProvider.searchAirports('del');
    expect(results).toEqual([]);
    expect(axios.get).toHaveBeenCalledTimes(2);
  }, 10000);

  test('retries a 503 upstream error and eventually succeeds', async () => {
    axios.get
      .mockRejectedValueOnce({ response: { status: 503, data: {} } })
      .mockResolvedValueOnce({ data: [] });

    const results = await ignavAirportProvider.searchAirports('del');
    expect(results).toEqual([]);
    expect(axios.get).toHaveBeenCalledTimes(2);
  }, 10000);

  test('gives up after MAX_RETRIES and throws a generic provider-unavailable error', async () => {
    axios.get.mockRejectedValue({ response: { status: 500, data: {} } });
    await expect(ignavAirportProvider.searchAirports('del')).rejects.toThrow(/temporarily unavailable/);
  }, 15000);
});
