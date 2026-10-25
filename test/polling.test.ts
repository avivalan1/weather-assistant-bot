import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBot } from '../src/bot/createBot.js';
import { startPolling } from '../src/bot/polling.js';
import { createLogger } from '../src/logger.js';
import { BOT_INFO, json } from './helpers/fakes.js';

const TOKEN = '123456:SECRET-POLLING-TOKEN-abcdefghijklmnopqrst';

/**
 * The real grammY runner against a fake Telegram. `getUpdates` answers come from
 * `respond`, called with the attempt number (1, 2, …).
 */
function pollingBot(respond: (attempt: number, url: string) => Promise<Response>) {
  const lines: string[] = [];
  const logger = createLogger('debug', [TOKEN], { write: (line: string) => lines.push(line) });
  let attempt = 0;
  const bot = createBot({
    token: TOKEN,
    logger,
    commandTimeoutMs: 1000,
    weather: { getWeather: () => Promise.reject(new Error('unused')) },
    airQuality: { getAirQuality: () => Promise.reject(new Error('unused')) },
    botConfig: {
      botInfo: BOT_INFO,
      client: { fetch: (url: string) => respond(++attempt, url) },
    },
  });
  return { bot, logger, logs: () => lines.join('') };
}

const conflict = () =>
  json(
    { ok: false, error_code: 409, description: 'Conflict: terminated by other getUpdates request' },
    409,
  );

describe('startPolling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits with code 1 and names the cause when another instance takes over (409)', async () => {
    const { bot, logger, logs } = pollingBot(() => Promise.resolve(conflict()));
    expect(await startPolling(bot, logger).finished).toBe(1);
    expect(logs()).toContain('another bot instance is already polling with this token');
    expect(logs()).toContain('"level":60'); // fatal
  });

  it('never prints the token when a polling request fails at the network level', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // 1st poll: a network failure whose message holds the URL (and token), as
    // node-fetch produces in production. 2nd poll: 409, which ends polling.
    const { bot, logger, logs } = pollingBot((attempt, url) =>
      attempt === 1
        ? Promise.reject(new Error(`request to ${url} failed, reason: read ETIMEDOUT`))
        : Promise.resolve(conflict()),
    );

    expect(await startPolling(bot, logger).finished).toBe(1);
    // Render arguments the way console.error does, including nested `cause`/`error` objects.
    const printed = consoleError.mock.calls
      .flat()
      .map((arg) => (typeof arg === 'string' ? arg : inspect(arg, { depth: 5 })))
      .join(' ');
    expect(printed).not.toContain(TOKEN);
    expect(logs()).toContain('could not reach Telegram'); // still visible in our logs
    expect(logs()).not.toContain(TOKEN);
  });

  it('exits with code 0 after a requested stop', async () => {
    const { bot, logger } = pollingBot(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            resolve(json({ ok: true, result: [] }));
          }, 10),
        ),
    );
    const polling = startPolling(bot, logger);
    await new Promise((r) => setTimeout(r, 30));
    await polling.stop();
    expect(await polling.finished).toBe(0);
  });
});
