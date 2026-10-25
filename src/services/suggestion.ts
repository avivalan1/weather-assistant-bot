import { isFreezingPrecipitation, isRain, isSnow, isThunderstorm } from './weatherCodes.js';

/**
 * Conditions now plus the rest of the local day (from the current hour on).
 * Hours that have already passed are deliberately excluded: morning rain should
 * not trigger an umbrella tip in the evening.
 */
export interface SuggestionInput {
  /**
   * Today's sunset has passed. Before sunrise the day is still ahead, so it
   * counts as day: at 05:00 a hot day ahead is a "hot day", not a "hot night".
   */
  afterSunset: boolean;
  weatherCode: number;
  currentTempC: number;
  windSpeedKmh: number;
  /** Weather codes for the remaining hours of the local day. */
  upcomingWeatherCodes: number[];
  /** Lowest / highest temperature over the remaining hours, including now. */
  minTempC: number;
  maxTempC: number;
  precipitationProbabilityMax: number | null;
  uvIndexMax: number | null;
}

export type SuggestionId =
  'thunderstorm' | 'snow-ice' | 'rain' | 'heat' | 'wind' | 'uv' | 'cold' | 'pleasant';

export interface Suggestion {
  id: SuggestionId;
  text: string;
}

interface Rule {
  id: SuggestionId;
  applies: (w: SuggestionInput) => boolean;
  text: string;
  /** Used after today's sunset, when the daytime wording would not fit. */
  nightText?: string;
}

export const THRESHOLDS = {
  freezingC: 0,
  rainProbabilityPct: 50,
  hotC: 30,
  windyKmh: 40,
  highUv: 6,
  chillyC: 10,
} as const;

/** True if the code holds now or for any remaining hour today. */
const nowOrLater = (w: SuggestionInput, test: (code: number) => boolean) =>
  // eg. The rule (bring an umbrella) should fire if it rains now OR later today
  test(w.weatherCode) || w.upcomingWeatherCodes.some(test);

/** Ordered by priority: safety first, then comfort. The first match wins. */
const RULES: readonly Rule[] = [
  {
    id: 'thunderstorm',
    applies: (w) => nowOrLater(w, isThunderstorm),
    text: 'Thunderstorms expected: stay indoors and avoid open areas.',
  },
  {
    id: 'snow-ice',
    applies: (w) =>
      nowOrLater(w, isSnow) ||
      nowOrLater(w, isFreezingPrecipitation) ||
      w.minTempC <= THRESHOLDS.freezingC,
    text: 'Snow, ice or freezing rain: dress warmly and watch for slippery ground.',
  },
  {
    id: 'rain',
    applies: (w) =>
      nowOrLater(w, isRain) ||
      (w.precipitationProbabilityMax ?? 0) >= THRESHOLDS.rainProbabilityPct,
    text: 'Rain is likely: take an umbrella.',
  },
  {
    id: 'heat',
    applies: (w) => w.maxTempC >= THRESHOLDS.hotC,
    text: 'Hot day: stay hydrated and avoid the midday sun.',
    nightText: 'Hot night: stay hydrated and keep cool.',
  },
  {
    id: 'wind',
    applies: (w) => w.windSpeedKmh >= THRESHOLDS.windyKmh,
    text: 'Strong wind: secure loose items and take care outdoors.',
  },
  {
    id: 'uv',
    applies: (w) => (w.uvIndexMax ?? 0) >= THRESHOLDS.highUv,
    text: 'High UV today: wear sunscreen and sunglasses.',
  },
  {
    id: 'cold',
    applies: (w) => w.currentTempC < THRESHOLDS.chillyC,
    text: 'Chilly out: bring a jacket.',
  },
];

const PLEASANT: Rule = {
  id: 'pleasant',
  applies: () => true,
  text: 'Pleasant conditions: a good day to be outside.',
  nightText: 'Calm, mild night: nothing to worry about if you head out.',
};

export function suggest(weather: SuggestionInput): Suggestion {
  const rule = RULES.find((r) => r.applies(weather)) ?? PLEASANT;
  const text = weather.afterSunset && rule.nightText !== undefined ? rule.nightText : rule.text;
  return { id: rule.id, text };
}
