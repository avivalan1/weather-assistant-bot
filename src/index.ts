import { createBot, COMMANDS, describeTelegramFailure } from './bot/createBot.js';
import { startPolling } from './bot/polling.js';
import { AirQualityClient } from './clients/airQualityClient.js';
import { ForecastClient } from './clients/forecastClient.js';
import { GeocodingClient } from './clients/geocodingClient.js';
import { HttpClient } from './clients/http.js';
import { OPEN_METEO_FREE_TIER, RateLimiter } from './clients/rateLimiter.js';
import { loadConfig, type Config } from './config.js';
import { TtlCache } from './lib/ttlCache.js';
import { createLogger } from './logger.js';
import { AirQualityService } from './services/airQualityService.js';
import { LocationService } from './services/locationService.js';
import { WeatherService } from './services/weatherService.js';

/**
 * Composition root: the only place where concrete implementations are wired together.
 *
 * Fatal paths set `process.exitCode` and return instead of calling `process.exit()`,
 * so buffered log output (e.g. piped to pino-pretty) is flushed before Node exits.
 */
async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
    return;
  }

  // The token is masked in every log line as a last line of defence.
  const logger = createLogger(config.logLevel, [config.botToken]);
  process.on('unhandledRejection', (err) => {
    logger.error({ err }, 'unhandled promise rejection');
  });

  const http = new HttpClient({
    logger,
    // One limiter for all three Open-Meteo APIs: the free-tier quota is shared.
    rateLimiter: new RateLimiter(OPEN_METEO_FREE_TIER),
    timeoutMs: config.httpTimeoutMs,
  });
  // One cache per data type; keys inside each are per location.
  const ttlMs = config.cacheTtlMs;
  const locations = new LocationService(new GeocodingClient(http), new TtlCache({ ttlMs }));
  const weather = new WeatherService(locations, new ForecastClient(http), new TtlCache({ ttlMs }));
  const airQuality = new AirQualityService(
    locations,
    new AirQualityClient(http),
    new TtlCache({ ttlMs }),
  );

  const bot = createBot({
    token: config.botToken,
    weather,
    airQuality,
    logger,
    commandTimeoutMs: config.commandTimeoutMs,
  });

  try {
    await bot.init(); // validates the token via getMe
  } catch (err) {
    logger.fatal({ error: describeTelegramFailure(err) }, 'could not connect to Telegram');
    process.exitCode = 1;
    return;
  }
  await bot.api.setMyCommands(COMMANDS).catch((err: unknown) => {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'could not register command menu',
    );
  });

  const polling = startPolling(bot, logger);
  logger.info({ username: bot.botInfo.username, cacheTtlMs: ttlMs }, 'bot started (long polling)');

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    void polling.stop(); // `finished` then resolves with 0
  };
  process.once('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    shutdown('SIGTERM');
  });

  process.exitCode = await polling.finished;
}

main().catch((err: unknown) => {
  console.error('fatal:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
