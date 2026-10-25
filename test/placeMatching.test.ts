import { describe, expect, it } from 'vitest';
import type { Place } from '../src/clients/geocodingClient.js';
import { matchesQualifier, normalizeName } from '../src/services/placeMatching.js';

const place = (overrides: Partial<Place>): Place => ({
  id: 1,
  name: 'Somewhere',
  latitude: 0,
  longitude: 0,
  ...overrides,
});

describe('normalizeName', () => {
  it('drops accents, case, dots, parentheticals and a leading "the"', () => {
    expect(normalizeName('  The  Netherlands ')).toBe('netherlands');
    expect(normalizeName('D.C.')).toBe('dc');
    expect(normalizeName('Myanmar (Burma)')).toBe('myanmar');
    expect(normalizeName('Île-de-France')).toBe('ile-de-france');
  });
});

describe('matchesQualifier', () => {
  it('requires an exact country name, so "Guinea" does not match "Papua New Guinea"', () => {
    const png = place({ country: 'Papua New Guinea', countryCode: 'PG' });
    expect(matchesQualifier(png, 'Guinea')).toBe(false);
    expect(matchesQualifier(png, 'Papua New Guinea')).toBe(true);
  });

  it('knows standard English names that differ from the API name', () => {
    const tr = place({ country: 'Republic of Türkiye', countryCode: 'TR' });
    expect(matchesQualifier(tr, 'Türkiye')).toBe(true); // from Intl.DisplayNames
    expect(matchesQualifier(tr, 'Turkey')).toBe(true); // from the alias list
  });

  it('treats a US state code as a state only for US places', () => {
    const georgiaUs = place({ admin1: 'Georgia', countryCode: 'US' });
    const gabon = place({ country: 'Gabon', countryCode: 'GA' });
    expect(matchesQualifier(georgiaUs, 'GA')).toBe(true);
    expect(matchesQualifier(gabon, 'GA')).toBe(true); // also the country code
    expect(matchesQualifier(place({ admin1: 'Georgia', countryCode: 'GE' }), 'GA')).toBe(false);
  });

  it('does not throw on a malformed country code from upstream', () => {
    expect(matchesQualifier(place({ countryCode: '12' }), 'France')).toBe(false);
  });
});
