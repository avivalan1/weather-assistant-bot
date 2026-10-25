import { describe, expect, it } from 'vitest';
import { aqiCategory, preferredStandard } from '../src/services/aqi.js';

describe('aqiCategory', () => {
  it.each([
    [0, 'Good'],
    [19, 'Good'],
    [20, 'Fair'],
    [59, 'Moderate'],
    [79, 'Poor'],
    [99, 'Very poor'],
    [150, 'Extremely poor'],
  ])('European AQI %i → %s', (value, category) => {
    expect(aqiCategory('european', value)).toBe(category);
  });

  it.each([
    [0, 'Good'],
    [50, 'Good'],
    [51, 'Moderate'],
    [101, 'Unhealthy for sensitive groups'],
    [151, 'Unhealthy'],
    [201, 'Very unhealthy'],
    [301, 'Hazardous'],
  ])('US AQI %i → %s', (value, category) => {
    expect(aqiCategory('us', value)).toBe(category);
  });
});

describe('preferredStandard', () => {
  it('uses the European AQI for European countries and the US AQI elsewhere', () => {
    expect(preferredStandard('DE')).toBe('european');
    expect(preferredStandard('GB')).toBe('european');
    expect(preferredStandard('US')).toBe('us');
    expect(preferredStandard('IL')).toBe('us');
    expect(preferredStandard(undefined)).toBe('us');
  });
});
