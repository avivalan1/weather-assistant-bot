import type { GeocodingClient, Place } from '../clients/geocodingClient.js';
import type { TtlCache } from '../lib/ttlCache.js';
import { InvalidInputError, LocationNotFoundError } from './errors.js';
import { matchesQualifier, normalizeName } from './placeMatching.js';
import type { Location, ResolvedLocation } from './types.js';

export const MAX_QUERY_LENGTH = 100;
const MAX_ALTERNATIVES = 2;
const MAX_SUGGESTIONS = 3;

// Letters in any script (incl. combining marks), spaces and . , ' ’ ( ) -; must start with a
// letter, optionally after an apostrophe ('s-Hertogenbosch). Digits are rejected on purpose.
const CITY_PATTERN = /^['’]?\p{L}[\p{L}\p{M}\s.,'’()-]*$/u;

export interface CityQuery {
  /** The place name sent to geocoding, e.g. "Paris". */
  name: string;
  /** Optional comma-separated narrowing terms, e.g. ["Texas"] or ["US"]. */
  qualifiers: string[];
  /**
   * Cache key. The name part is exactly what geocoding receives, only lowercased
   * (the API ignores case): "The Hague" and "Hague", or "Xi'an" and "Xian", are
   * different places. Qualifiers are normalized, since only our matcher reads them.
   */
  key: string;
}

/**
 * Validates and normalizes user input. "Paris, Texas, US" becomes
 * name "Paris" with qualifiers ["Texas", "US"].
 */
export function parseCityQuery(input: string): CityQuery {
  // cleans up the whitespace 
  const text = input.replace(/\s+/g, ' ').trim();
  if (text === '') {
    throw new InvalidInputError('Please provide a city name.');
  }
  if (text.length > MAX_QUERY_LENGTH) {
    throw new InvalidInputError(`City names must be at most ${MAX_QUERY_LENGTH} characters.`);
  }
  if (!CITY_PATTERN.test(text)) {
    throw new InvalidInputError(
      "City names may only contain letters, spaces and . , ' - ( ) characters.",
    );
  }

  // split cuts at every comma, and trim cleans every piece
  const [name = '', ...qualifiers] = text.split(',').map((part) => part.trim());
  if (name === '' || qualifiers.some((q) => q === '')) {
    throw new InvalidInputError('Use the format "City" or "City, Country", e.g. "Paris, France".');
  }
  const key = [name.toLowerCase(), ...qualifiers.map(normalizeName)].join('|');
  return { name, qualifiers, key };
}

export class LocationService {
  constructor(
    private readonly geocoding: Pick<GeocodingClient, 'search'>,
    private readonly cache: TtlCache<ResolvedLocation>,
  ) {}

  /**
   * Ambiguity strategy: take Open-Meteo's top-ranked match (largely by population)
   * among the places that fit every "City, Region/Country" qualifier. Same-named
   * places in other regions are returned as hints, so the reply can say how to
   * pick a different one (e.g. "London, CA" resolves to Ontario and offers
   * California). If qualifiers rule out every match, the error carries what the
   * name alone found, so the reply can offer those instead.
   */
  async resolve(input: string, deadline?: AbortSignal): Promise<ResolvedLocation> {
    const query = parseCityQuery(input);
    return this.cache.getOrLoad(
      query.key,
      async () => {
        // query.name is city
        const places = await this.geocoding.search(query.name);
        // keep only the places that fit the qualifiers
        const matches = places.filter((p) => query.qualifiers.every((q) => matchesQualifier(p, q)));
        // best = the first match
        const [best, ...others] = matches;
        if (!best) {
          // Thrown inside the loader, so a "not found" is never cached.
          throw new LocationNotFoundError(
            query.name,
            query.qualifiers,
            suggestionsFor(query.name, places).map(toLocation),
          );
        }
        return {
          location: toLocation(best),
          alternatives: distinctRegions(others, best, MAX_ALTERNATIVES).map(toLocation),
        };
      },
      deadline,
    );
  }
}

/**
 * Same-named places in regions other than `exclude`'s, e.g. Paris (Texas) for
 * Paris (France). Filtering by name skips unrelated matches like "Tel Aviv Luna Park".
 */
function distinctRegions(places: Place[], exclude: Place | undefined, limit: number): Place[] {
  const seen = new Set(exclude ? [regionKey(exclude)] : []);
  const result: Place[] = [];
  for (const place of places) {
    // Skip any place whose name isn't the same as the answer's. 
    if (exclude && !sameName(place, exclude.name)) continue;
    // TO-DO: think of a smarter solution
    // If we already have a place in this region (or it's the answer's own region, which was pre-seeded), skip it.
    if (seen.has(regionKey(place))) continue;
    seen.add(regionKey(place));
    result.push(place);
    if (result.length === limit) break;
  }
  return result;
}

/** What the bare name found, preferring exact name matches: offered when qualifiers ruled everything out. */
function suggestionsFor(name: string, places: Place[]): Place[] {
  const exact = places.filter((p) => sameName(p, name));
  return distinctRegions(exact.length > 0 ? exact : places, undefined, MAX_SUGGESTIONS);
}

const sameName = (place: Place, name: string) => normalizeName(place.name) === normalizeName(name);

const regionKey = (p: Place) => `${p.countryCode ?? ''}|${p.admin1 ?? ''}`;

function toLocation(place: Place): Location {
  return {
    name: place.name,
    latitude: place.latitude,
    longitude: place.longitude,
    ...(place.admin1 !== undefined && { admin1: place.admin1 }),
    ...(place.country !== undefined && { country: place.country }),
    ...(place.countryCode !== undefined && { countryCode: place.countryCode }),
    ...(place.timezone !== undefined && { timezone: place.timezone }),
  };
}
