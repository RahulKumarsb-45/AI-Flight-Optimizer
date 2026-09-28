const countryService = require('../../src/providers/country/countryService');
const { POPULAR_COUNTRY_CODES } = require('../../src/providers/country/countryData');

describe('countryService.listCountries', () => {
  const countries = countryService.listCountries();

  test('returns the full ISO country master list, far beyond the curated airport dataset', () => {
    // The curated airport dataset (airportData.js) only covers a subset of
    // countries; the country master list must not be limited to it.
    expect(countries.length).toBeGreaterThan(100);
  });

  test('every entry has a 2-letter countryCode, a display name, and a region', () => {
    for (const c of countries) {
      expect(c.countryCode).toMatch(/^[A-Z]{2}$/);
      expect(typeof c.country).toBe('string');
      expect(c.country.length).toBeGreaterThan(0);
      expect(typeof c.region).toBe('string');
    }
  });

  test('has no duplicate country codes', () => {
    const codes = countries.map((c) => c.countryCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  test('is sorted alphabetically by country name', () => {
    const names = countries.map((c) => c.country);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  test('flags every configured popular destination as popular, and nothing else', () => {
    const flaggedPopular = countries.filter((c) => c.popular).map((c) => c.countryCode);
    expect(new Set(flaggedPopular)).toEqual(new Set(POPULAR_COUNTRY_CODES));
  });

  test('includes well-known countries missing from the curated airport dataset (e.g. small/less-common nations)', () => {
    // Andorra (AD) is a real, selectable country with no curated airport
    // entry in airportData.js — it must still appear in the country
    // selector. Airport/flight availability for it is validated separately
    // by the optimizer, not by whether it's listed here.
    const codes = new Set(countries.map((c) => c.countryCode));
    expect(codes.has('AD')).toBe(true);
  });
});

describe('countryService.getByCode', () => {
  test('resolves a known country case-insensitively', () => {
    expect(countryService.getByCode('it')).toMatchObject({ countryCode: 'IT', country: 'Italy' });
    expect(countryService.getByCode('IT')).toMatchObject({ countryCode: 'IT', country: 'Italy' });
  });

  test('returns null for an unknown or empty code', () => {
    expect(countryService.getByCode('ZZ')).toBeNull();
    expect(countryService.getByCode('')).toBeNull();
    expect(countryService.getByCode(undefined)).toBeNull();
  });
});
