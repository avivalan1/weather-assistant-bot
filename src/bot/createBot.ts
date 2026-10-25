import { sequentialize } from '@grammyjs/runner';
import { Bot, GrammyError, HttpError, type BotConfig, type Context } from 'grammy';
import { HELP_TEXT } from './format.js';
import { lookupHandler, REPLY_OPTIONS, type LookupDeps } from './handlers.js';

export interface CreateBotOptions extends LookupDeps {
  token: string;
  /** Lets tests pass `botInfo` (skipping getMe) and a fake API transport. */
  botConfig?: BotConfig<Context>;
}

/** Shown in Telegram's command menu (registered at startup). */
export const COMMANDS = [
  { command: 'weather', description: 'Current weather, e.g. /weather London' },
  { command: 'air', description: 'Air quality, e.g. /air Berlin' },
  { command: 'help', description: 'Usage and examples' },
];

const NOT_UNDERSTOOD =
  'I only understand commands. Try /weather London, /air Paris, or /help for more.';

/**
 * Wires Telegram updates to handlers. Knows nothing about how updates arrive
 * (polling vs webhooks): that is decided in index.ts.
 */
export function createBot(options: CreateBotOptions): Bot {
  const { logger } = options;
  const bot = new Bot(options.token, options.botConfig);

  // use() is a function that runs on every incoming update before any command handler.
  // sequentialize puts each user's messages (ctx) in their own queue keyed by chat ID: one user's messages are handled in order, while different users are handled at the same time.
  bot.use(sequentialize((ctx: Context) => ctx.chat?.id.toString()));

  // Telegram command matching is case-sensitive; accept /Weather like /weather.
  // Only the command word is lowercased, never the arguments or an @BotName suffix.
  bot.use((ctx, next) => {
    const message = ctx.message;
    const entity = message?.entities?.[0];
    if (message?.text !== undefined && entity?.type === 'bot_command' && entity.offset === 0) {
      const command = message.text.slice(0, entity.length);
      const at = command.indexOf('@');
      const name = at === -1 ? command : command.slice(0, at);
      const suffix = at === -1 ? '' : command.slice(at);
      message.text = name.toLowerCase() + suffix + message.text.slice(entity.length);
    }
    return next();
  });

  // Only private chats are supported; in groups, point users to a DM.
  bot
    .chatType(['group', 'supergroup'])
    .command(['start', 'help', 'weather', 'air'], (ctx) =>
      ctx.reply('Please message me in a private chat to use this command.'),
    );

  const dm = bot.chatType('private');
  dm.command(['start', 'help'], (ctx) => ctx.reply(HELP_TEXT, REPLY_OPTIONS));
  dm.command('weather', lookupHandler('weather', options));
  dm.command('air', lookupHandler('air', options));

  dm.on('message:text', async (ctx) => {
    const isCommand = ctx.message.text.startsWith('/');
    logger.info(
      { updateId: ctx.update.update_id, outcome: isCommand ? 'unknown_command' : 'not_a_command' },
      'message not handled',
    );
    await ctx.reply(
      isCommand
        ? 'Sorry, I don’t know that command. Send /help to see what I can do.'
        : NOT_UNDERSTOOD,
    );
  });
  dm.on('message', (ctx) => ctx.reply(NOT_UNDERSTOOD));

  // Logs failed Telegram calls, including the runner's getUpdates polling.
  // Only grammY's message is logged: HttpError.error is the underlying fetch
  // error, whose message contains the request URL and therefore the bot token.
  bot.api.config.use(async (prev, method, payload, signal) => {
    try {
      return await prev(method, payload, signal);
    } catch (err) {
      if (err instanceof HttpError) {
        logger.warn({ method, error: err.message }, 'could not reach Telegram');
      }
      throw err;
    }
  });

  // Last line of defence: log and keep running. Handlers already turn expected
  // errors into replies, so anything here is a Telegram API failure or a bug.
  bot.catch(({ error, ctx }) => {
    const updateId = ctx.update.update_id;
    if (error instanceof GrammyError) {
      logger.error({ updateId, description: error.description }, 'Telegram API error');
    } else if (error instanceof HttpError) {
      // Already logged by the API transformer above; record which update it affected.
      logger.error({ updateId, error: error.message }, 'reply could not be delivered');
    } else {
      logger.error({ updateId, err: error }, 'unhandled error in update handler');
    }
  });

  return bot;
}

/**
 * Human-readable reason for a failed Telegram call, safe to log: grammY's own
 * messages never include the token (see the API transformer above).
 */
export function describeTelegramFailure(err: unknown): string {
  if (err instanceof GrammyError) {
    if (err.error_code === 409) {
      return 'another bot instance is already polling with this token (409 Conflict)';
    }
    if (err.error_code === 401) return 'the bot token was rejected or revoked (401 Unauthorized)';
    return `Telegram API error ${err.error_code}: ${err.description}`;
  }
  if (err instanceof HttpError) return `${err.message} Check the network connection.`;
  return err instanceof Error ? err.message : String(err);
}
