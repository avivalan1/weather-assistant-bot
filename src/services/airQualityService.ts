import type { AirQuality, AirQualityClient, AqiValues } from '../clients/airQualityClient.js';
import type { TtlCache } from '../lib/ttlCache.js';
import { AQI_STANDARDS, aqiCategory, preferredStandard, type AqiStandard } from './aqi.js';
import type { LocationService } from './locationService.js';
import { locationKey, type LocalTime, type Location } from './types.js';

export interface AqiReading {
  standard: AqiStandard;
  value: number;
  category: string;
}

export interface AirQualityReport {
  location: Location;
  alternatives: Location[];
  /** Model estimate for the current hour; null if CAMS has no value here. */
  current: (AqiReading & { time: LocalTime }) | null;
  /** Highest forecast value for the rest of the local day, if any. */
  forecastPeak: (AqiReading & { time: LocalTime }) | null;
}

export class AirQualityService {
  constructor(
    private readonly locations: Pick<LocationService, 'resolve'>,
    private readonly airQuality: Pick<AirQualityClient, 'getAirQuality'>,
    private readonly cache: TtlCache<AirQuality>,
  ) {}

  /** `deadline` bounds how long this caller waits; shared upstream calls carry on for others. */
  async getAirQuality(cityInput: string, deadline?: AbortSignal): Promise<AirQualityReport> {
    const { location, alternatives } = await this.locations.resolve(cityInput, deadline);
    const data = await this.cache.getOrLoad(
      locationKey(location),
      () => this.airQuality.getAirQuality(location),
      deadline,
    );

    // Prefer the regional standard; fall back to the other one only if it has a value and ours doesn't.
    const preferred = preferredStandard(location.countryCode);
    const fallback = otherStandard(preferred);
    const standardId =
      readAqi(data.current, preferred) === null && readAqi(data.current, fallback) !== null
        ? fallback
        : preferred;
    const standard = AQI_STANDARDS[standardId];
    const at = (iso: string): LocalTime => ({
      iso,
      timezone: data.timezone,
      utcOffsetSeconds: data.utcOffsetSeconds,
    });

    const currentValue = readAqi(data.current, standardId);
    const current =
      currentValue === null
        ? null
        : { ...reading(standard, currentValue), time: at(data.current.time) };

    // Local ISO strings in one timezone sort chronologically as plain strings.
    let peak: { value: number; time: string } | null = null;
    for (const hour of data.hourly) {
      const value = readAqi(hour, standardId);
      if (
        hour.time > data.current.time &&
        value !== null &&
        (peak === null || value > peak.value)
      ) {
        peak = { value, time: hour.time };
      }
    }
    const forecastPeak =
      peak === null ? null : { ...reading(standard, peak.value), time: at(peak.time) };

    return { location, alternatives, current, forecastPeak };
  }
}

function readAqi(values: AqiValues, standard: AqiStandard['id']): number | null {
  return standard === 'european' ? values.europeanAqi : values.usAqi;
}

const otherStandard = (id: AqiStandard['id']) => (id === 'european' ? 'us' : 'european');

function reading(standard: AqiStandard, value: number): AqiReading {
  const rounded = Math.round(value);
  return { standard, value: rounded, category: aqiCategory(standard.id, rounded) };
}
