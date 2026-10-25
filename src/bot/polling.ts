import { run } from '@grammyjs/runner';
import type { Bot } from 'grammy';
import type { Logger } from '../logger.js';
import { describeTelegramFailure } from './createBot.js';

export interface Polling {
  /** Requests a clean stop; `finished` then resolves with exit code 0. */
  stop: () => Promise<void>;
  /**
   * Resolves with the process exit code once polling ends: 0 after `stop()`,
   * 1 if polling died for good (e.g. 409: another instance uses the token;
   * 401: token revoked), so a process supervisor sees a crash.
   */
  finished: Promise<number>;
}

/** Long polling with concurrent update handling (see createBot's sequentialize). */
export function startPolling(bot: Bot, logger: Logger): Polling {
  const runner = run(bot, {
    runner: {
      // The runner would console.error raw fetch errors, which carry the token in
      // the request URL. Failures are logged by createBot's API transformer instead.
      silent: true,
      fetch: { allowed_updates: ['message'] },
    },
  });

  const finished = (async () => {
    try {
      await runner.task();
      logger.info('stopped');
      return 0;
    } catch (err) {
      logger.fatal({ error: describeTelegramFailure(err) }, 'polling stopped');
      return 1;
    }
  })();

  return { stop: () => runner.stop(), finished };
}
