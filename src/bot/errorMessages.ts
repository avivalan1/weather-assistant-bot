import { UpstreamError } from '../clients/errors.js';
import { DeadlineExceededError } from '../lib/ttlCache.js';
import { InvalidInputError, LocationNotFoundError } from '../services/errors.js';
import { escapeHtml, exampleCommand, shortLocation, type LookupCommand } from './format.js';

export interface ErrorReply {
  /** HTML-safe text for the user. Never contains internal details. */
  text: string;
  /** Short label for logs and metrics. */
  outcome:
    | 'invalid_input'
    | 'not_found'
    | 'deadline_exceeded'
    | `upstream_${UpstreamError['failure']}`
    | 'internal_error';
  /** Expected errors are logged at info/warn; only unknown ones at error. */
  level: 'info' | 'warn' | 'error';
}

const TOO_SLOW = 'The data provider is taking too long to respond. Please try again shortly.';

export function errorReply(err: unknown, command: LookupCommand): ErrorReply {
  if (err instanceof InvalidInputError) {
    return { text: escapeHtml(err.message), outcome: 'invalid_input', level: 'info' };
  }
  if (err instanceof LocationNotFoundError) {
    return { text: notFoundText(err, command), outcome: 'not_found', level: 'info' };
  }
  if (err instanceof DeadlineExceededError) {
    return { text: TOO_SLOW, outcome: 'deadline_exceeded', level: 'warn' };
  }
  if (err instanceof UpstreamError) {
    const outcome = `upstream_${err.failure}` as const;
    switch (err.failure) {
      case 'rate_limited':
        return {
          text: 'I’m receiving a lot of requests right now. Please try again in a minute.',
          outcome,
          level: 'warn',
        };
      case 'timeout':
        return { text: TOO_SLOW, outcome, level: 'warn' };
      default:
        return {
          text: 'The data provider is unavailable right now. Please try again later.',
          outcome,
          level: 'warn',
        };
    }
  }
  return {
    text: 'Sorry, something went wrong on my side. Please try again.',
    outcome: 'internal_error',
    level: 'error',
  };
}

function notFoundText(err: LocationNotFoundError, command: LookupCommand): string {
  const name = escapeHtml(err.placeName);
  const [first] = err.suggestions;
  if (err.qualifiers.length > 0 && first) {
    // The city exists, but not where the user said: show what does exist.
    const where = escapeHtml(err.qualifiers.join(', '));
    const options = escapeHtml(err.suggestions.map(shortLocation).join(' · '));
    return (
      `I found “${name}”, but not in “${where}”. Did you mean: ${options}?\n` +
      `→ e.g. ${escapeHtml(exampleCommand(command, first))}`
    );
  }
  if (err.qualifiers.length > 0) {
    return `I couldn't find “${name}”. Check the spelling of the city name.`;
  }
  return (
    `I couldn't find “${name}”. Check the spelling, or add a country, ` +
    `e.g. /${command} Springfield, US`
  );
}
