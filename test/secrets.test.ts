import { BotError } from 'grammy';
import type { Update } from 'grammy/types';
import { describe, expect, it } from 'vitest';
import { createBot } from '../src/bot/createBot.js';
import { createLogger } from '../src/logger.js';
import { BOT_INFO, rejectionOf } from './helpers/fakes.js';

const TOKEN = '123456:SECRET-TOKEN-abcdefghijklmnopqrstuvwxyz';

function capturingLogger() {
  const lines: string[] = [];
  const logger = createLogger('debug', [TOKEN], { write: (line: string) => lines.push(line) });
  return { logger, output: () => lines.join('') };
}

describe('secret handling', () => {
  it('masks the token anywhere in a log line, including inside messages', () => {
    const { logger, output } = capturingLogger();
    logger.error(
      { err: new Error(`request to https://api.telegram.org/bot${TOKEN}/x failed`) },
      TOKEN,
    );

    expect(output()).not.toContain(TOKEN);
    expect(output()).toContain('[redacted]');
  });

  it('never logs the token when Telegram is unreachable', async () => {
    const { logger, output } = capturingLogger();
    const bot = createBot({
      token: TOKEN,
      logger,
      commandTimeoutMs: 1000,
      weather: { getWeather: () => Promise.reject(new Error('unused')) },
      airQuality: { getAirQuality: () => Promise.reject(new Error('unused')) },
      botConfig: {
        botInfo: BOT_INFO,
        // Fails the way node-fetch does in production: the message includes the URL.
        client: {
          fetch: (url: string) =>
            Promise.reject(new Error(`request to ${url} failed, reason: read ETIMEDOUT`)),
        },
      },
    });
    const update: Update = {
      update_id: 1,
      message: {
        message_id: 1,
        date: 0,
        chat: { id: 1, type: 'private', first_name: 'U' },
        from: { id: 1, is_bot: false, first_name: 'U' },
        text: '/help',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }],
      },
    };

    const error = await rejectionOf(bot.handleUpdate(update), BotError);
    await bot.errorHandler(error);

    expect(output()).toContain('could not reach Telegram');
    expect(output()).not.toContain(TOKEN);
    expect(output()).not.toContain('[redacted]'); // the explicit fix works without the safety net
  });
});
