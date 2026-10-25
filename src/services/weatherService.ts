import type { Forecast, ForecastClient } from '../clients/forecastClient.js';
import type { TtlCache } from '../lib/ttlCache.js';
import type { LocationService } from './locationService.js';
import { suggest, type Suggestion, type SuggestionInput } from './suggestion.js';
import { locationKey, type LocalTime, type Location } from './types.js';
import { describeWeatherCode, type Condition } from './weatherCodes.js';

export interface WeatherReport {
  location: Location;
  alternatives: Location[];
  observedAt: LocalTime;
  temperatureC: number;
  feelsLikeC: number;
  condition: Condition;
  today: { date: string; minC: number; maxC: number };
  suggestion: Suggestion;
}

export class WeatherService {
  constructor(
    private readonly locations: Pick<LocationService, 'resolve'>,
    private readonly forecasts: Pick<ForecastClient, 'getForecast'>,
    private readonly cache: TtlCache<Forecast>,
  ) {}

  /** `deadline` bounds how long this caller waits; shared upstream calls carry on for others. */
  async getWeather(cityInput: string, deadline?: AbortSignal): Promise<WeatherReport> {
    const { location, alternatives } = await this.locations.resolve(cityInput, deadline);
    const forecast = await this.cache.getOrLoad(
      locationKey(location),
      () => this.forecasts.getForecast(location),
      deadline,
    );
    const { current, today } = forecast;

    return {
      location,
      alternatives,
      observedAt: {
        iso: current.time,
        timezone: forecast.timezone,
        utcOffsetSeconds: forecast.utcOffsetSeconds,
      },
      temperatureC: current.temperatureC,
      feelsLikeC: current.apparentTemperatureC,
      condition: describeWeatherCode(current.weatherCode),
      today: { date: today.date, minC: today.minC, maxC: today.maxC },
      suggestion: suggest(suggestionInput(forecast)),
    };
  }
}

/**
 * The suggestion looks at now and the remaining hours of the local day, never at
 * hours already past (the same rule /air uses for its forecast peak).
 */
export function suggestionInput(forecast: Forecast): SuggestionInput {
  const { current } = forecast;
  // `current.time` is e.g. "…T18:15"; the "…T18:00" slot is still the current hour.
  // Local ISO strings in one timezone compare chronologically as plain strings.
  const currentHour = current.time.slice(0, 13);
  const ahead = forecast.hourly.filter((hour) => hour.time.slice(0, 13) >= currentHour);
  const temperatures = [current.temperatureC, ...ahead.map((hour) => hour.temperatureC)];
  return {
    // Local ISO times in one timezone compare chronologically as strings.
    afterSunset: current.time >= forecast.today.sunset,
    weatherCode: current.weatherCode,
    currentTempC: current.temperatureC,
    windSpeedKmh: current.windSpeedKmh,
    upcomingWeatherCodes: ahead.map((hour) => hour.weatherCode),
    minTempC: Math.min(...temperatures),
    maxTempC: Math.max(...temperatures),
    precipitationProbabilityMax: maxOrNull(ahead.map((hour) => hour.precipitationProbability)),
    uvIndexMax: maxOrNull(ahead.map((hour) => hour.uvIndex)),
  };
}

function maxOrNull(values: (number | null)[]): number | null {
  const numbers = values.filter((v): v is number => v !== null);
  return numbers.length > 0 ? Math.max(...numbers) : null;
}
