export interface Condition {
  description: string;
  emoji: string;
}

/** WMO weather interpretation codes, as documented by Open-Meteo. */
const WMO_CODES: Record<number, Condition> = {
  0: { description: 'Clear sky', emoji: '☀️' },
  1: { description: 'Mainly clear', emoji: '🌤️' },
  2: { description: 'Partly cloudy', emoji: '⛅' },
  3: { description: 'Overcast', emoji: '☁️' },
  45: { description: 'Fog', emoji: '🌫️' },
  48: { description: 'Depositing rime fog', emoji: '🌫️' },
  51: { description: 'Light drizzle', emoji: '🌦️' },
  53: { description: 'Moderate drizzle', emoji: '🌦️' },
  55: { description: 'Dense drizzle', emoji: '🌧️' },
  56: { description: 'Light freezing drizzle', emoji: '🌧️' },
  57: { description: 'Dense freezing drizzle', emoji: '🌧️' },
  61: { description: 'Slight rain', emoji: '🌦️' },
  63: { description: 'Moderate rain', emoji: '🌧️' },
  65: { description: 'Heavy rain', emoji: '🌧️' },
  66: { description: 'Light freezing rain', emoji: '🌧️' },
  67: { description: 'Heavy freezing rain', emoji: '🌧️' },
  71: { description: 'Slight snowfall', emoji: '🌨️' },
  73: { description: 'Moderate snowfall', emoji: '🌨️' },
  75: { description: 'Heavy snowfall', emoji: '❄️' },
  77: { description: 'Snow grains', emoji: '🌨️' },
  80: { description: 'Slight rain showers', emoji: '🌦️' },
  81: { description: 'Moderate rain showers', emoji: '🌧️' },
  82: { description: 'Violent rain showers', emoji: '⛈️' },
  85: { description: 'Slight snow showers', emoji: '🌨️' },
  86: { description: 'Heavy snow showers', emoji: '❄️' },
  95: { description: 'Thunderstorm', emoji: '⛈️' },
  96: { description: 'Thunderstorm with slight hail', emoji: '⛈️' },
  99: { description: 'Thunderstorm with heavy hail', emoji: '⛈️' },
};

export function describeWeatherCode(code: number): Condition {
  return WMO_CODES[code] ?? { description: 'Unknown conditions', emoji: '🌡️' };
}

export const isThunderstorm = (code: number) => code >= 95 && code <= 99;
export const isSnow = (code: number) => (code >= 71 && code <= 77) || code === 85 || code === 86;
/** Freezing drizzle and freezing rain: an ice hazard, not just wet. */
export const isFreezingPrecipitation = (code: number) => [56, 57, 66, 67].includes(code);
/** Drizzle, rain, freezing rain and rain showers. */
export const isRain = (code: number) => (code >= 51 && code <= 67) || (code >= 80 && code <= 82);
