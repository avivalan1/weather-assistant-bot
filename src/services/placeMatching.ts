import type { Place } from '../clients/geocodingClient.js';

/** USPS codes, so "Paris, TX" and "Washington, DC" work like the full state names. */
const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana',
  IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', PR: 'Puerto Rico', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin',
  WY: 'Wyoming',
}; // prettier-ignore

/**
 * Everyday country names that differ from both Open-Meteo's name and the standard
 * English name (e.g. Open-Meteo says "Republic of Türkiye", Intl says "Türkiye").
 */
const COUNTRY_ALIASES: Record<string, string> = {
  america: 'US',
  usa: 'US',
  'united states of america': 'US',
  uk: 'GB',
  britain: 'GB',
  'great britain': 'GB',
  holland: 'NL',
  turkey: 'TR',
  'czech republic': 'CZ',
  korea: 'KR',
  'republic of korea': 'KR',
  uae: 'AE',
  burma: 'MM',
  'ivory coast': 'CI',
};

const englishRegionNames = new Intl.DisplayNames(['en'], { type: 'region' });

/**
 * Canonical form for comparing names: no accents, lowercase, dots dropped
 * ("D.C." → "dc"), parentheticals and a leading "the" removed, single spaces.
 */
export function normalizeName(text: string): string {
  return text
    // split letters from accents
    .normalize('NFD')
    // remove the accent marks
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    // drop dots and apostrophes	
    .replace(/[.’']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

/**
 * Whether one comma-separated qualifier ("TX", "Texas", "US", "Turkey") fits a place.
 *  - 2-letter codes match a country code OR a US state code; "CA" accepts both
 *    Canada and California, and the caller keeps the best-ranked of either.
 *  - Country names must match one of the country's known names exactly, so
 *    "Guinea" can't match "Papua New Guinea".
 *  - Regions match on whole words, so "Holland" fits "North Holland" but "Or"
 *    no longer fits "Oregon".
 */
export function matchesQualifier(place: Place, qualifier: string): boolean {
  const q = normalizeName(qualifier);
  if (q === '') return false;

  if (q.length === 2) {
    const code = q.toUpperCase();
    if (place.countryCode === code) return true;
    const state = US_STATES[code];
    if (state !== undefined && place.countryCode === 'US' && place.admin1 !== undefined) {
      return normalizeName(place.admin1) === normalizeName(state);
    }
  }

  if (place.countryCode !== undefined && countryNames(place).has(q)) return true;

  return place.admin1 !== undefined && ` ${normalizeName(place.admin1)} `.includes(` ${q} `);
}

function countryNames(place: Place): Set<string> {
  const code = place.countryCode ?? '';
  const names = new Set<string>();
  if (place.country !== undefined) names.add(normalizeName(place.country));
  const standard = standardCountryName(code);
  if (standard !== undefined) names.add(normalizeName(standard));
  for (const [alias, aliasCode] of Object.entries(COUNTRY_ALIASES)) {
    if (aliasCode === code) names.add(alias);
  }
  return names;
}

function standardCountryName(code: string): string | undefined {
  try {
    return englishRegionNames.of(code);
  } catch {
    return undefined; // malformed code from upstream data; RangeError
  }
}
