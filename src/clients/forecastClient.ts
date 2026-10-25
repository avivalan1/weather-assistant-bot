import { z } from 'zod';
import type { HttpClient } from './http.js';
import { localDate, localDateTime } from './schemas.js';

const BASE_URL = 'https://api.open-meteo.com/v1/forecast';

const CURRENT = ['temperature_2m', 'apparent_temperature', 'weather_code', 'wind_speed_10m'];
const HOURLY = ['temperature_2m', 'precipitation_probability', 'weather_code', 'uv_index'];
const DAILY = ['temperature_2m_min', 'temperature_2m_max', 'sunset'];

/** Non-empty array typed as `[T, ...T[]]`, so index 0 is known to exist. */
const nonEmpty = <T extends z.ZodType>(item: T) => z.tuple([item]).rest(item);

const ForecastResponseSchema = z.object({
  timezone: z.string(),
  timezone_abbreviation: z.string(),
  utc_offset_seconds: z.number().int(),
  // Assert the units we asked for, so a silent API change can't show °F as °C.
  current_units: z.object({
    temperature_2m: z.literal('°C'),
    wind_speed_10m: z.literal('km/h'),
  }),
  current: z.object({
    time: localDateTime,
    temperature_2m: z.number(),
    apparent_temperature: z.number(),
    weather_code: z.number().int(),
    wind_speed_10m: z.number(),
  }),
  hourly_units: z.object({ temperature_2m: z.literal('°C') }),
  // Open-Meteo sends hourly data as parallel columns. Zip them into rows, then
  // validate each row, so a short or malformed column fails validation.
  hourly: z
    .object({
      time: z.array(z.unknown()),
      temperature_2m: z.array(z.unknown()),
      precipitation_probability: z.array(z.unknown()),
      weather_code: z.array(z.unknown()),
      uv_index: z.array(z.unknown()),
    })
    .transform((h) =>
      h.time.map((time, i) => ({
        time,
        temperature_2m: h.temperature_2m[i],
        precipitation_probability: h.precipitation_probability[i],
        weather_code: h.weather_code[i],
        uv_index: h.uv_index[i],
      })),
    )
    .pipe(
      z.array(
        z.object({
          time: localDateTime,
          temperature_2m: z.number(),
          precipitation_probability: z.number().nullable(),
          weather_code: z.number().int(),
          uv_index: z.number().nullable(),
        }),
      ),
    ),
  daily: z.object({
    time: nonEmpty(localDate),
    temperature_2m_min: nonEmpty(z.number()),
    temperature_2m_max: nonEmpty(z.number()),
    sunset: nonEmpty(localDateTime),
  }),
});

export interface ForecastHour {
  /** Local time, ISO 8601 without offset, e.g. "2026-10-24T18:00". */
  time: string;
  temperatureC: number;
  precipitationProbability: number | null;
  weatherCode: number;
  uvIndex: number | null;
}

export interface Forecast {
  timezone: string;
  timezoneAbbreviation: string;
  utcOffsetSeconds: number;
  current: {
    /** Local time at the location, ISO 8601 without offset, e.g. "2026-10-24T18:00". */
    time: string;
    temperatureC: number;
    apparentTemperatureC: number;
    weatherCode: number;
    windSpeedKmh: number;
  };
  /** The whole local day, for the reply's min/max. */
  today: {
    date: string;
    minC: number;
    maxC: number;
    /**
     * Local sunset, e.g. "2026-10-24T18:40". In polar night it equals midnight
     * (the sun never rises); in polar day it falls on the next date.
     */
    sunset: string;
  };
  /** Hourly forecast for the whole local day (00:00–23:00). */
  hourly: ForecastHour[];
}

export interface Coordinates {
  latitude: number;
  longitude: number;
  /** IANA timezone; defaults to `auto` (derived from coordinates). */
  timezone?: string;
}

export class ForecastClient {
  constructor(private readonly http: HttpClient) {}

  async getForecast({ latitude, longitude, timezone }: Coordinates): Promise<Forecast> {
    const url = new URL(BASE_URL);
    url.search = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current: CURRENT.join(','),
      hourly: HOURLY.join(','),
      daily: DAILY.join(','),
      // Local timezone makes "today" the location's local day, not UTC.
      timezone: timezone ?? 'auto',
      forecast_days: '1',
      temperature_unit: 'celsius',
      wind_speed_unit: 'kmh',
    }).toString();

    const data = await this.http.getJson('forecast', url, ForecastResponseSchema);
    const d = data.daily;
    return {
      timezone: data.timezone,
      timezoneAbbreviation: data.timezone_abbreviation,
      utcOffsetSeconds: data.utc_offset_seconds,
      current: {
        time: data.current.time,
        temperatureC: data.current.temperature_2m,
        apparentTemperatureC: data.current.apparent_temperature,
        weatherCode: data.current.weather_code,
        windSpeedKmh: data.current.wind_speed_10m,
      },
      today: {
        date: d.time[0],
        minC: d.temperature_2m_min[0],
        maxC: d.temperature_2m_max[0],
        sunset: d.sunset[0],
      },
      hourly: data.hourly.map((hour) => ({
        time: hour.time,
        temperatureC: hour.temperature_2m,
        precipitationProbability: hour.precipitation_probability,
        weatherCode: hour.weather_code,
        uvIndex: hour.uv_index,
      })),
    };
  }
}
