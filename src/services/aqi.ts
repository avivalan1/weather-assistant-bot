export type AqiStandardId = 'european' | 'us';

export interface AqiStandard {
  id: AqiStandardId;
  name: string;
}

export const AQI_STANDARDS: Record<AqiStandardId, AqiStandard> = {
  european: { id: 'european', name: 'European AQI (EEA)' },
  us: { id: 'us', name: 'US AQI (EPA)' },
};

/** Upper bounds are exclusive except the last band, which is open-ended. */
interface Band {
  below: number;
  category: string;
}

// Open-Meteo / EEA: 0-20 good, 20-40 fair, 40-60 moderate, 60-80 poor, 80-100 very poor, >100 extremely poor.
const EUROPEAN_BANDS: readonly Band[] = [
  { below: 20, category: 'Good' },
  { below: 40, category: 'Fair' },
  { below: 60, category: 'Moderate' },
  { below: 80, category: 'Poor' },
  { below: 100, category: 'Very poor' },
  { below: Infinity, category: 'Extremely poor' },
];

// US EPA: 0-50 good, 51-100 moderate, 101-150 USG, 151-200 unhealthy, 201-300 very unhealthy, 301+ hazardous.
const US_BANDS: readonly Band[] = [
  { below: 51, category: 'Good' },
  { below: 101, category: 'Moderate' },
  { below: 151, category: 'Unhealthy for sensitive groups' },
  { below: 201, category: 'Unhealthy' },
  { below: 301, category: 'Very unhealthy' },
  { below: Infinity, category: 'Hazardous' },
];

export function aqiCategory(standard: AqiStandardId, value: number): string {
  const bands = standard === 'european' ? EUROPEAN_BANDS : US_BANDS;
  // The last band is unbounded, so a match is guaranteed for any non-NaN value.
  return bands.find((b) => value < b.below)?.category ?? 'Unknown';
}

/** ISO 3166-1 alpha-2 codes of countries covered by the European AQI (EEA members & neighbours). */
const EUROPEAN_COUNTRIES = new Set([
  'AD', 'AL', 'AT', 'BA', 'BE', 'BG', 'BY', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES',
  'FI', 'FO', 'FR', 'GB', 'GI', 'GR', 'HR', 'HU', 'IE', 'IM', 'IS', 'IT', 'LI', 'LT',
  'LU', 'LV', 'MC', 'MD', 'ME', 'MK', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'RS', 'SE',
  'SI', 'SK', 'SM', 'UA', 'VA', 'XK',
]); // prettier-ignore

/** European AQI for European locations, US AQI everywhere else. */
export function preferredStandard(countryCode: string | undefined): AqiStandardId {
  return countryCode !== undefined && EUROPEAN_COUNTRIES.has(countryCode) ? 'european' : 'us';
}
