import { z } from 'zod';

const ConfigSchema = z.object({
  BOT_TOKEN: z
    .string({ error: 'BOT_TOKEN is required (get one from @BotFather)' })
    .regex(/^\d+:[\w-]{30,}$/, 'BOT_TOKEN does not look like a Telegram bot token'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  HTTP_TIMEOUT_MS: z.coerce.number().int().positive().max(30_000).default(3000),
  COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(8000),
});

export interface Config {
  botToken: string;
  logLevel: z.infer<typeof ConfigSchema>['LOG_LEVEL'];
  cacheTtlMs: number;
  httpTimeoutMs: number;
  commandTimeoutMs: number;
}

/**
 * Validates environment variables once at startup so misconfiguration fails fast
 * with a readable message. Error messages never echo the values themselves.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Treat empty strings (e.g. `LOG_LEVEL=` copied from .env.example) as unset.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const result = ConfigSchema.safeParse(cleaned);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${issues.join('\n')}`);
  }
  const c = result.data;
  return {
    botToken: c.BOT_TOKEN,
    logLevel: c.LOG_LEVEL,
    cacheTtlMs: c.CACHE_TTL_SECONDS * 1000,
    httpTimeoutMs: c.HTTP_TIMEOUT_MS,
    commandTimeoutMs: c.COMMAND_TIMEOUT_MS,
  };
}
