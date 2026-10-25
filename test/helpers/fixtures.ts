/** Response bodies modelled on real Open-Meteo responses (trimmed). */

export const parisGeocoding = {
  results: [
    {
      id: 2988507,
      name: 'Paris',
      latitude: 48.85341,
      longitude: 2.3488,
      country_code: 'FR',
      country: 'France',
      admin1: 'Île-de-France Region',
      timezone: 'Europe/Paris',
      population: 2138551,
    },
    {
      id: 4717560,
      name: 'Paris',
      latitude: 33.66094,
      longitude: -95.55551,
      country_code: 'US',
      country: 'United States',
      admin1: 'Texas',
      timezone: 'America/Chicago',
      population: 24782,
    },
    {
      id: 4647963,
      name: 'Paris',
      latitude: 36.302,
      longitude: -88.32671,
      country_code: 'US',
      country: 'United States',
      admin1: 'Tennessee',
      timezone: 'America/Chicago',
      population: 10150,
    },
  ],
  generationtime_ms: 0.3,
};

export const telAvivGeocoding = {
  results: [
    {
      id: 293397,
      name: 'Tel Aviv',
      latitude: 32.08088,
      longitude: 34.78057,
      country_code: 'IL',
      country: 'Israel',
      admin1: 'Tel Aviv',
      timezone: 'Asia/Jerusalem',
      population: 432892,
    },
    {
      id: 6941122,
      name: 'Tel Aviv Luna Park',
      latitude: 32.10666,
      longitude: 34.81265,
      country_code: 'IL',
      country: 'Israel',
      admin1: 'Tel Aviv',
      timezone: 'Asia/Jerusalem',
    },
  ],
};

export const rioGeocoding = {
  results: [
    {
      id: 3451190,
      name: 'Rio de Janeiro',
      latitude: -22.90642,
      longitude: -43.18223,
      country_code: 'BR',
      country: 'Brazil',
      admin1: 'Rio de Janeiro',
      timezone: 'America/Sao_Paulo',
      population: 6023699,
    },
  ],
};

export const noGeocodingResults = { generationtime_ms: 0.12 };

interface ForecastHourBody {
  temperature_2m: number;
  precipitation_probability: number | null;
  weather_code: number;
  uv_index: number | null;
}

/**
 * Forecast for Paris on 2026-10-24, "now" = 18:00. By default it rains all day.
 * `hour(h)` overrides individual hours (0–23) of the hourly forecast.
 */
export function forecastBody(
  overrides: {
    weatherCode?: number;
    temperature?: number;
    /** Local time of "now", default "2026-10-24T18:00". */
    time?: string;
    /** Local sunset, default "2026-10-24T18:40" (after "now"). */
    sunset?: string;
    hour?: (h: number) => Partial<ForecastHourBody>;
  } = {},
) {
  const hours = Array.from({ length: 24 }, (_, h) => ({
    time: `2026-10-24T${String(h).padStart(2, '0')}:00`,
    temperature_2m: 9 + Math.min(h, 24 - h) / 3,
    precipitation_probability: 100,
    weather_code: 61,
    uv_index: h >= 9 && h <= 16 ? 1.6 : 0,
    ...overrides.hour?.(h),
  }));
  return {
    latitude: 48.86,
    longitude: 2.35,
    utc_offset_seconds: 7200,
    timezone: 'Europe/Paris',
    timezone_abbreviation: 'GMT+2',
    current_units: { time: 'iso8601', temperature_2m: '°C', wind_speed_10m: 'km/h' },
    current: {
      time: overrides.time ?? '2026-10-24T18:00',
      interval: 900,
      temperature_2m: overrides.temperature ?? 11.6,
      apparent_temperature: 8.8,
      weather_code: overrides.weatherCode ?? 61,
      wind_speed_10m: 16.9,
    },
    hourly_units: { time: 'iso8601', temperature_2m: '°C' },
    hourly: {
      time: hours.map((h) => h.time),
      temperature_2m: hours.map((h) => h.temperature_2m),
      precipitation_probability: hours.map((h) => h.precipitation_probability),
      weather_code: hours.map((h) => h.weather_code),
      uv_index: hours.map((h) => h.uv_index),
    },
    daily: {
      time: ['2026-10-24'],
      temperature_2m_min: [8.8],
      temperature_2m_max: [13.2],
      sunset: [overrides.sunset ?? '2026-10-24T18:40'],
    },
  };
}

/** Hourly CAMS forecast for one local day; "now" is 18:00 and the peak is at 21:00. */
export function airQualityBody(
  overrides: { europeanAqi?: number | null; usAqi?: number | null } = {},
) {
  const hours = Array.from({ length: 24 }, (_, h) => `2026-10-24T${String(h).padStart(2, '0')}:00`);
  return {
    latitude: -22.9,
    longitude: -43.2,
    utc_offset_seconds: -10800,
    timezone: 'America/Sao_Paulo',
    timezone_abbreviation: 'GMT-3',
    current: {
      time: '2026-10-24T18:00',
      interval: 3600,
      european_aqi: overrides.europeanAqi === undefined ? 24 : overrides.europeanAqi,
      us_aqi: overrides.usAqi === undefined ? 42 : overrides.usAqi,
    },
    hourly: {
      time: hours,
      // Highest value of the day (90) is at 03:00, i.e. in the past; it must not be the "peak".
      european_aqi: hours.map((_, h) => (h === 3 ? 90 : h === 21 ? 35 : 20)),
      us_aqi: hours.map((_, h) => (h === 3 ? 160 : h === 21 ? 77 : 30)),
    },
  };
}
