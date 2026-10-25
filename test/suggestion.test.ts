import { describe, expect, it } from 'vitest';
import { suggest, type SuggestionInput } from '../src/services/suggestion.js';

/** Mild, dry, calm day that triggers no rule. */
const calm: SuggestionInput = {
  afterSunset: false,
  upcomingWeatherCodes: [1, 1, 2],
  weatherCode: 1,
  currentTempC: 20,
  minTempC: 14,
  maxTempC: 24,
  windSpeedKmh: 10,
  precipitationProbabilityMax: 10,
  uvIndexMax: 3,
};

describe('suggest', () => {
  it.each<[string, Partial<SuggestionInput>, string]>([
    ['thunderstorm code', { weatherCode: 95 }, 'thunderstorm'],
    ['snow code', { weatherCode: 73 }, 'snow-ice'],
    ['freezing rain above 0°C', { weatherCode: 66, minTempC: 1 }, 'snow-ice'],
    ['freezing drizzle', { weatherCode: 56 }, 'snow-ice'],
    ['freezing minimum', { minTempC: 0 }, 'snow-ice'],
    ['rain code', { weatherCode: 61 }, 'rain'],
    ['high rain probability', { precipitationProbabilityMax: 50 }, 'rain'],
    ['hot maximum', { maxTempC: 30 }, 'heat'],
    ['strong wind', { windSpeedKmh: 40 }, 'wind'],
    ['high UV', { uvIndexMax: 6 }, 'uv'],
    ['chilly now', { currentTempC: 9.9 }, 'cold'],
    ['nothing notable', {}, 'pleasant'],
    ['thunderstorm later today', { upcomingWeatherCodes: [1, 95] }, 'thunderstorm'],
    ['freezing rain later today', { upcomingWeatherCodes: [1, 67] }, 'snow-ice'],
    ['rain later today', { upcomingWeatherCodes: [2, 61] }, 'rain'],
  ])('%s → %s', (_label, overrides, expected) => {
    expect(suggest({ ...calm, ...overrides }).id).toBe(expected);
  });

  it('stays just below each threshold', () => {
    const nearMisses: Partial<SuggestionInput> = {
      minTempC: 0.1,
      precipitationProbabilityMax: 49,
      maxTempC: 29.9,
      windSpeedKmh: 39.9,
      uvIndexMax: 5.9,
      currentTempC: 10,
    };
    expect(suggest({ ...calm, ...nearMisses }).id).toBe('pleasant');
  });

  it('returns exactly one suggestion, by priority: safety before comfort', () => {
    // Stormy, hot, windy and high UV at once: the storm warning wins.
    const result = suggest({
      ...calm,
      weatherCode: 96,
      maxTempC: 35,
      windSpeedKmh: 60,
      uvIndexMax: 9,
    });
    expect(result.id).toBe('thunderstorm');
    expect(result.text).toMatch(/stay indoors/i);
  });

  it('prefers rain over heat on a hot rainy day', () => {
    expect(suggest({ ...calm, weatherCode: 80, maxTempC: 33 }).id).toBe('rain');
  });

  it('treats missing precipitation and UV data as no signal', () => {
    expect(suggest({ ...calm, precipitationProbabilityMax: null, uvIndexMax: null }).id).toBe(
      'pleasant',
    );
  });
});

describe('suggest after sunset', () => {
  it('does not call it "a good day to be outside" after dark', () => {
    const result = suggest({ ...calm, afterSunset: true });
    expect(result.id).toBe('pleasant');
    expect(result.text).toMatch(/night/);
    expect(result.text).not.toMatch(/good day/);
  });

  it('words heat warnings for the night', () => {
    expect(suggest({ ...calm, afterSunset: true, maxTempC: 31 }).text).toMatch(/Hot night/);
  });

  it('keeps safety warnings unchanged at night', () => {
    expect(suggest({ ...calm, afterSunset: true, weatherCode: 95 }).text).toMatch(/stay indoors/);
  });
});
