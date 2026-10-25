import { describe, expect, it } from 'vitest';
import { InvalidInputError, LocationNotFoundError } from '../src/services/errors.js';
import { parseCityQuery } from '../src/services/locationService.js';
import { rejectionOf } from './helpers/fakes.js';
import { locationServiceWithRealData } from './helpers/geocodingFixtures.js';

describe('parseCityQuery', () => {
  it('normalizes whitespace and keeps multi-word names', () => {
    expect(parseCityQuery('   New    York  ')).toMatchObject({ name: 'New York', qualifiers: [] });
  });

  it('splits comma-separated qualifiers', () => {
    expect(parseCityQuery('Paris, Texas, US')).toMatchObject({
      name: 'Paris',
      qualifiers: ['Texas', 'US'],
    });
  });

  it('accepts non-Latin scripts and diacritics', () => {
    expect(parseCityQuery('São Paulo').name).toBe('São Paulo');
    expect(parseCityQuery('תל אביב').name).toBe('תל אביב');
  });

  it.each([
    ['empty', '   '],
    ['too long', 'a'.repeat(101)],
    ['digits', 'Area 51'],
    ['markup', '<script>'],
    ['leading comma', ', France'],
    ['empty qualifier', 'Paris,'],
  ])('rejects %s input', (_label, input) => {
    expect(() => parseCityQuery(input)).toThrow(InvalidInputError);
  });
});

describe('LocationService.resolve (real geocoding data)', () => {
  it('picks the top match and offers same-named places elsewhere as hints', async () => {
    const { service } = locationServiceWithRealData();
    const result = await service.resolve('Paris');

    expect(result.location).toMatchObject({ admin1: 'Île-de-France Region', countryCode: 'FR' });
    expect(result.alternatives.map((a) => a.admin1)).toEqual(['Texas', 'Tennessee']); // capped at 2
  });

  // Everyday spellings, including the cases a code review found failing.
  it.each([
    // US state codes
    ['Paris, TX', 'Texas', 'US'],
    ['Atlanta, GA', 'Georgia', 'US'],
    ['Washington, DC', 'District of Columbia', 'US'],
    ['Washington, D.C.', 'District of Columbia', 'US'],
    ['Albany, NY', 'New York', 'US'],
    ['Albany, GA', 'Georgia', 'US'],
    ['Portland, OR', 'Oregon', 'US'],
    ['Portland, ME', 'Maine', 'US'], // ME is also Montenegro
    ['Springfield, MA', 'Massachusetts', 'US'],
    ['Springfield, IL', 'Illinois', 'US'],
    ['Amsterdam, NY', 'New York', 'US'],
    // Full state / region names
    ['Paris, Texas', 'Texas', 'US'],
    ['Paris, ile-de-france', 'Île-de-France Region', 'FR'],
    ['London, Ontario', 'Ontario', 'CA'],
    ['Amsterdam, Holland', 'North Holland', 'NL'], // whole word inside "North Holland"
    // Country names as people write them vs. Open-Meteo's names
    ['Amsterdam, Netherlands', 'North Holland', 'NL'], // "The Netherlands"
    ['Amsterdam, The Netherlands', 'North Holland', 'NL'],
    ['Prague, Czech Republic', 'Prague', 'CZ'], // "Czechia"
    ['Prague, Czechia', 'Prague', 'CZ'],
    ['Istanbul, Turkey', 'Istanbul', 'TR'], // "Republic of Türkiye"
    ['Istanbul, Türkiye', 'Istanbul', 'TR'],
    ['Seoul, Korea', 'Seoul', 'KR'], // "South Korea"
    ['Seoul, South Korea', 'Seoul', 'KR'],
    ['London, UK', 'England', 'GB'],
    ['London, England', 'England', 'GB'], // a region of GB, matched via admin1
    ['London, United Kingdom', 'England', 'GB'],
    ['London, Canada', 'Ontario', 'CA'],
    ['Paris, France', 'Île-de-France Region', 'FR'],
    ['Paris, Texas, US', 'Texas', 'US'],
    ["'s-Hertogenbosch", 'North Brabant', 'NL'],
  ])('resolves "%s" to %s, %s', async (input, admin1, countryCode) => {
    const { service } = locationServiceWithRealData();
    expect((await service.resolve(input)).location).toMatchObject({ admin1, countryCode });
  });

  it('accepts a 2-letter code as state or country and offers the other reading', async () => {
    const { service } = locationServiceWithRealData();
    // CA: London, Ontario (Canada, 422k people) outranks London, California (1.9k).
    const result = await service.resolve('London, CA');
    expect(result.location).toMatchObject({ admin1: 'Ontario', countryCode: 'CA' });
    expect(result.alternatives).toContainEqual(
      expect.objectContaining({ admin1: 'California', countryCode: 'US' }),
    );
  });

  it('lists other matches that also fit the qualifier', async () => {
    const { service } = locationServiceWithRealData();
    const result = await service.resolve('Paris, US');
    expect(result.location.admin1).toBe('Texas');
    expect(result.alternatives.map((a) => a.admin1)).toEqual(['Tennessee', 'Kentucky']);
  });

  it('offers what the name matched when the qualifier rules everything out', async () => {
    const { service } = locationServiceWithRealData();
    const err = await rejectionOf(service.resolve('Paris, Japan'), LocationNotFoundError);
    expect(err).toMatchObject({ placeName: 'Paris', qualifiers: ['Japan'] });
    expect(err.suggestions.map((s) => s.admin1)).toEqual([
      'Île-de-France Region',
      'Texas',
      'Tennessee',
    ]);
  });

  it('treats Scotland as a region, not as the whole UK', async () => {
    const { service } = locationServiceWithRealData();
    // Real data has Birmingham, England but no Birmingham in Scotland.
    const err = await rejectionOf(service.resolve('Birmingham, Scotland'), LocationNotFoundError);
    expect(err.suggestions[0]).toMatchObject({ admin1: 'England', countryCode: 'GB' });
  });

  it('matches regions on whole words only', async () => {
    const { service } = locationServiceWithRealData();
    // "Tex" must not match "Texas" (the old prefix match made "OR" work only by luck).
    await expect(service.resolve('Paris, Tex')).rejects.toThrow(LocationNotFoundError);
  });

  it('ignores differently named matches when building hints', async () => {
    const { service } = locationServiceWithRealData();
    const result = await service.resolve('Istanbul');
    // Real data also returns "Istanbul Airport" and "Istanbul Old Town" in the same region.
    expect(result.alternatives.map((a) => a.name)).not.toContain('Istanbul Airport');
  });

  it('throws LocationNotFoundError for an unknown city, without suggestions, and does not cache it', async () => {
    const { service, fetch } = locationServiceWithRealData();
    const err = await rejectionOf(service.resolve('Atlantis'), LocationNotFoundError);
    expect(err.suggestions).toEqual([]);
    await expect(service.resolve('Atlantis')).rejects.toThrow(LocationNotFoundError);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('shares a cache entry only when geocoding would get the same name', async () => {
    const { service, fetch } = locationServiceWithRealData();
    await service.resolve('Washington, DC');
    await service.resolve('  WASHINGTON ,  d.c. '); // same search; qualifier spelled differently
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Hague', 'The Hague'],
    ['Xian', "Xi'an"],
    ['Paris', 'Paris (Texas)'],
  ])('never answers "%s" and "%s" from the same cache entry', async (first, second) => {
    const { service, fetch } = locationServiceWithRealData();
    await service.resolve(first).catch(() => undefined);
    await service.resolve(second).catch(() => undefined);
    expect(fetch.mock.calls.map(([url]) => url.searchParams.get('name'))).toEqual([first, second]);
  });

  it('validates input before calling the API', async () => {
    const { service, fetch } = locationServiceWithRealData();
    await expect(service.resolve('12345')).rejects.toThrow(InvalidInputError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
