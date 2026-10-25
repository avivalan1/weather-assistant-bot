import { z } from 'zod';
import type { HttpClient } from './http.js';

const BASE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const RESULT_COUNT = 10;

const PlaceSchema = z.object({
  id: z.number(),
  name: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  country: z.string().optional(),
  country_code: z.string().length(2).optional(),
  admin1: z.string().optional(),
  timezone: z.string().optional(),
  population: z.number().optional(),
});

// The API omits `results` entirely when nothing matches.
const SearchResponseSchema = z.object({
  results: z.array(PlaceSchema).optional(),
});

export interface Place {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  countryCode?: string;
  admin1?: string;
  timezone?: string;
  population?: number;
}

export class GeocodingClient {
  constructor(private readonly http: HttpClient) {}

  /** Returns matches ranked by Open-Meteo (largely by population); empty if none. */
  async search(name: string): Promise<Place[]> {
    const url = new URL(BASE_URL);
    url.search = new URLSearchParams({
      name,
      count: String(RESULT_COUNT),
      language: 'en',
      format: 'json',
    }).toString();

    const data = await this.http.getJson('geocoding', url, SearchResponseSchema);
    return (data.results ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      latitude: r.latitude,
      longitude: r.longitude,
      ...(r.country !== undefined && { country: r.country }),
      ...(r.country_code !== undefined && { countryCode: r.country_code.toUpperCase() }),
      ...(r.admin1 !== undefined && { admin1: r.admin1 }),
      ...(r.timezone !== undefined && { timezone: r.timezone }),
      ...(r.population !== undefined && { population: r.population }),
    }));
  }
}
