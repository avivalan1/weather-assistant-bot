import type { Context } from 'grammy';
import type { Logger } from '../logger.js';
import type { AirQualityService } from '../services/airQualityService.js';
import type { WeatherService } from '../services/weatherService.js';
import { errorReply } from './errorMessages.js';
import { formatAirQuality, formatWeather, usageText, type LookupCommand } from './format.js';

export const REPLY_OPTIONS = {
  parse_mode: 'HTML',
  link_preview_options: { is_disabled: true },
} as const;

/** The minimal slice of a grammY command context that the handler needs. */
export type LookupContext = Pick<Context, 'update' | 'reply' | 'replyWithChatAction'> & {
  match: string;
};

export interface LookupDeps {
  weather: Pick<WeatherService, 'getWeather'>;
  airQuality: Pick<AirQualityService, 'getAirQuality'>;
  logger: Logger;
  /** Upper bound on the time a user waits for a reply, across all upstream calls. */
  commandTimeoutMs: number;
  /** Telegram shows "typing…" for at most 5 s, so it is re-sent at this interval. */
  typingIntervalMs?: number;
}

/**
 * Shared flow for /weather and /air: validate presence of the argument, call the
 * service, reply. Every failure becomes a friendly reply; nothing is rethrown.
 */
export function lookupHandler(command: LookupCommand, deps: LookupDeps) {
  return async (ctx: LookupContext): Promise<void> => {
    // `ctx.match` is everything after the command, so multi-word cities just work.
    const query = ctx.match.trim();
    // creates a logger that automatically adds updateId and command to every line it writes, so all log lines for one request can be found together.
    const log = deps.logger.child({ updateId: ctx.update.update_id, command });

    if (query === '') {
      log.info({ outcome: 'missing_argument' }, 'command handled');
      await ctx.reply(usageText(command), REPLY_OPTIONS);
      return;
    }

    // Starts the "typing…" indicator and re-sends it every 4s
    const stopTyping = keepTyping(ctx, deps.typingIntervalMs ?? 4000, log);

    // A signal that "fires" after 8 s. It's passed down to the service and, from there, to the cache, so this user never waits longer than 8s.
    const deadline = AbortSignal.timeout(deps.commandTimeoutMs);
    const started = performance.now();
    let text: string;
    try {
      text =
        command === 'weather'
          ? formatWeather(await deps.weather.getWeather(query, deadline))
          : formatAirQuality(await deps.airQuality.getAirQuality(query, deadline));
      log.info({ query, outcome: 'ok', durationMs: elapsed(started) }, 'command handled');
    } catch (err) {
      const reply = errorReply(err, command);
      log[reply.level](
        { query, outcome: reply.outcome, durationMs: elapsed(started), err },
        'command failed',
      );
      text = reply.text;
    } finally {
      stopTyping();
    }
    await ctx.reply(text, REPLY_OPTIONS);
  };
}

const elapsed = (started: number) => Math.round(performance.now() - started);

/** Best-effort "typing…" indicator until the returned function is called; never fails the request. */
function keepTyping(ctx: LookupContext, intervalMs: number, log: Logger): () => void {
  const send = () => {
    ctx.replyWithChatAction('typing').catch((err: unknown) => {
      log.debug({ err }, 'chat action failed');
    });
  };
  send();
  const timer = setInterval(send, intervalMs);
  return () => {
    clearInterval(timer);
  };
}
