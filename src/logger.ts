import { pino, type DestinationStream, type Logger } from 'pino';

export type { Logger };

/**
 * Structured JSON logger. Pretty output in development comes from piping
 * through `pino-pretty` (see `npm run dev`), so production logs stay machine-readable.
 *
 * Every `secrets` value is masked in the final output. Telegram puts the bot token
 * in request URLs, so low-level network errors can carry it inside a message string,
 * where field-based redaction cannot see it.
 */
export function createLogger(
  level: string,
  secrets: readonly string[] = [],
  out: { write: (line: string) => unknown } = process.stdout,
): Logger {
  const masked = secrets.filter((s) => s.length > 0);
  const destination: DestinationStream = {
    write: (line) => {
      out.write(masked.reduce((text, secret) => text.replaceAll(secret, '[redacted]'), line));
    },
  };
  return pino({ level, base: { service: 'telegram-weather-assistant' } }, destination);
}

/** Silent logger for tests. */
export function createNullLogger(): Logger {
  return pino({ level: 'silent' });
}
