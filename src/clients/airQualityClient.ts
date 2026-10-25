import { z } from 'zod';
import type { Coordinates } from './forecastClient.js';
import type { HttpClient } from './http.js';
import { localDateTime } from './schemas.js';

const BASE_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const VARIABLES = 'european_aqi,us_aqi';

const aqi = z.number().nonnegative().nullable();

const AirQualityResponseSchema = z
  .object({
    timezone: z.string(),
    timezone_abbreviation: z.string(),
    utc_offset_seconds: z.number().int(),
    current: z.object({
      time: localDateTime,
      european_aqi: aqi,
      us_aqi: aqi,
    }),
    hourly: z.object({
      time: z.array(localDateTime),
      european_aqi: z.array(aqi),
      us_aqi: z.array(aqi),
    }),
  })
  .refine(
    (r) =>
      r.hourly.european_aqi.length === r.hourly.time.length &&
      r.hourly.us_aqi.length === r.hourly.time.length,
    { message: 'hourly arrays must have equal length' },
  );

export interface AqiValues {
  europeanAqi: number | null;
  usAqi: number | null;
}

export interface AirQuality {
  timezone: string;
  timezoneAbbreviation: string;
  utcOffsetSeconds: number;
  /** CAMS model value for the current hour (local time, ISO 8601 without offset). */
  current: AqiValues & { time: string };
  /** Hourly CAMS forecast for the local day. */
  hourly: (AqiValues & { time: string })[];
}

export class AirQualityClient {
  constructor(private readonly http: HttpClient) {}

  async getAirQuality({ latitude, longitude, timezone }: Coordinates): Promise<AirQuality> {
    const url = new URL(BASE_URL);
    url.search = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current: VARIABLES,
      hourly: VARIABLES,
      timezone: timezone ?? 'auto',
      forecast_days: '1',
    }).toString();

    const data = await this.http.getJson('air-quality', url, AirQualityResponseSchema);
    return {
      timezone: data.timezone,
      timezoneAbbreviation: data.timezone_abbreviation,
      utcOffsetSeconds: data.utc_offset_seconds,
      current: {
        time: data.current.time,
        europeanAqi: data.current.european_aqi,
        usAqi: data.current.us_aqi,
      },
      hourly: data.hourly.time.map((time, i) => ({
        time,
        europeanAqi: data.hourly.european_aqi[i] ?? null,
        usAqi: data.hourly.us_aqi[i] ?? null,
      })),
    };
  }
}
