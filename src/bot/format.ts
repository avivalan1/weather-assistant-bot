import type { AirQualityReport } from '../services/airQualityService.js';
import type { LocalTime, Location } from '../services/types.js';
import type { WeatherReport } from '../services/weatherService.js';

/** Replies use Telegram's HTML parse mode, so every dynamic value is escaped. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const OPEN_METEO_LINK = '<a href="https://open-meteo.com/">Open-Meteo.com</a>';

export type LookupCommand = 'weather' | 'air';

export const HELP_TEXT = [
  '<b>Weather &amp; air quality assistant</b>',
  '',
  '/weather &lt;city&gt; – current weather, today’s min/max and a tip',
  '/air &lt;city&gt; – air quality index (AQI)',
  '/help – this message',
  '',
  '<b>Examples</b>',
  '/weather London',
  '/weather New York',
  '/air Rio de Janeiro',
  '',
  '<b>Ambiguous names</b>',
  'I pick the best-known match. Add a country or region after a comma to choose another:',
  '/weather Paris, Texas',
  '/air Springfield, US',
].join('\n');

export function usageText(command: LookupCommand): string {
  const example = command === 'weather' ? 'New York' : 'Berlin';
  return `Please add a city, for example:\n/${command} ${example}`;
}

export function formatWeather(report: WeatherReport): string {
  const { condition, today } = report;
  return [
    `${condition.emoji} <b>${escapeHtml(formatLocation(report.location))}</b>`,
    '',
    `Now: <b>${formatTemp(report.temperatureC)}</b> (feels like ${formatTemp(report.feelsLikeC)}), ${condition.description}`,
    `Today (${today.date}): min ${formatTemp(today.minC)} · max ${formatTemp(today.maxC)}`,
    '',
    `💡 ${report.suggestion.text}`,
    '',
    `<i>As of ${escapeHtml(formatLocalTime(report.observedAt))}</i>`,
    ...alternativesHint(report.alternatives, 'weather'),
    '',
    `Weather data by ${OPEN_METEO_LINK}`,
  ].join('\n');
}

export function formatAirQuality(report: AirQualityReport): string {
  const { current, forecastPeak } = report;
  const lines = [`🌫️ <b>Air quality – ${escapeHtml(formatLocation(report.location))}</b>`, ''];

  if (current) {
    lines.push(
      `${current.standard.name}: <b>${current.value}</b> – ${current.category}`,
      `<i>CAMS model estimate for ${escapeHtml(formatLocalTime(current.time))}, not a ground-station measurement.</i>`,
    );
  } else {
    lines.push('No current AQI value is available for this location.');
  }
  if (forecastPeak) {
    lines.push(
      '',
      `📈 <b>Forecast</b>: peak ${forecastPeak.value} (${forecastPeak.category}) at ${clockTime(forecastPeak.time.iso)} today`,
    );
  }

  const year = (current ?? forecastPeak)?.time.iso.slice(0, 4) ?? String(new Date().getFullYear());
  lines.push(
    ...alternativesHint(report.alternatives, 'air'),
    '',
    `Air quality data by ${OPEN_METEO_LINK} · Generated using Copernicus Atmosphere Monitoring Service information ${year}`,
  );
  return lines.join('\n');
}

/** "Paris, Île-de-France Region, France"; the region is skipped when it repeats the name. */
export function formatLocation(location: Location): string {
  const parts = [location.name];
  if (location.admin1 && location.admin1 !== location.name) parts.push(location.admin1);
  if (location.country) parts.push(location.country);
  return parts.join(', ');
}

/** "2026-10-24 18:00 Europe/Paris (UTC+02:00)" */
export function formatLocalTime(time: LocalTime): string {
  const date = time.iso.slice(0, 10);
  return `${date} ${clockTime(time.iso)} ${time.timezone} (${formatUtcOffset(time.utcOffsetSeconds)})`;
}

export function formatUtcOffset(seconds: number): string {
  const sign = seconds < 0 ? '-' : '+';
  const minutes = Math.abs(seconds) / 60;
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `UTC${sign}${hh}:${mm}`;
}

function formatTemp(celsius: number): string {
  // Avoid printing "-0.0°C".
  const rounded = Math.round(celsius * 10) / 10 || 0;
  return `${rounded.toFixed(1)}°C`;
}

function clockTime(iso: string): string {
  return iso.slice(11, 16);
}

/** Compact name for lists: "Paris, Texas, US". */
export function shortLocation(location: Location): string {
  return [location.name, regionOf(location), location.countryCode].filter(Boolean).join(', ');
}

/** A ready-to-send command that selects `location`, e.g. "/weather Paris, Texas". */
export function exampleCommand(command: LookupCommand, location: Location): string {
  const narrowBy = regionOf(location) ?? location.country;
  return `/${command} ${narrowBy ? `${location.name}, ${narrowBy}` : location.name}`;
}

/** The region, unless it just repeats the name (e.g. Prague, Prague). */
const regionOf = (location: Location) =>
  location.admin1 === location.name ? undefined : location.admin1;

function alternativesHint(alternatives: Location[], command: LookupCommand): string[] {
  const [first] = alternatives;
  if (!first) return [];
  return [
    `Other matches: ${escapeHtml(alternatives.map(shortLocation).join(' · '))}`,
    `→ e.g. ${escapeHtml(exampleCommand(command, first))}`,
  ];
}
