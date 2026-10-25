import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GeocodingClient } from '../../src/clients/geocodingClient.js';
import { TtlCache } from '../../src/lib/ttlCache.js';
import { LocationService } from '../../src/services/locationService.js';
import type { ResolvedLocation } from '../../src/services/types.js';
import { FIVE_MINUTES, createHttp, fakeFetch, json } from './fakes.js';

const FIXTURE_DIR = join(import.meta.dirname, '..', 'fixtures', 'geocoding');

/**
 * Real Open-Meteo geocoding responses (top 10 results, trimmed to the fields we
 * use), captured from the live API so tests see real naming such as
 * "The Netherlands", "Czechia" and "Republic of Türkiye".
 */
export function realGeocoding(name: string): unknown {
  const file = join(FIXTURE_DIR, `${name.toLowerCase().replace(/\s+/g, '-')}.json`);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { results: [] }; // a name without a fixture behaves like an unknown city
  }
}

/** LocationService over the real geocoding client and schema, fed by captured responses. */
export function locationServiceWithRealData() {
  const fetch = fakeFetch({
    geocoding: (url) => json(realGeocoding(url.searchParams.get('name') ?? '')),
  });
  const service = new LocationService(
    new GeocodingClient(createHttp(fetch)),
    new TtlCache<ResolvedLocation>({ ttlMs: FIVE_MINUTES }),
  );
  return { service, fetch };
}
