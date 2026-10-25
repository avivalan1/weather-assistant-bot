export interface Location {
  name: string;
  admin1?: string;
  country?: string;
  countryCode?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
}

export interface ResolvedLocation {
  location: Location;
  /** Other places with the same name, offered as a hint when the query was ambiguous. */
  alternatives: Location[];
}

/** A wall-clock time at the location, with enough context to show its timezone. */
export interface LocalTime {
  /** ISO 8601 local time without offset, e.g. "2026-10-24T18:00". */
  iso: string;
  timezone: string;
  utcOffsetSeconds: number;
}

/** Cache key for per-location data; ~11 m precision is plenty for weather. */
export function locationKey(location: Location): string {
  return `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;
}
