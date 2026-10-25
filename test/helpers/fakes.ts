import type { Update, UserFromGetMe } from 'grammy/types';
import { vi } from 'vitest';
import { createBot } from '../../src/bot/createBot.js';
import { AirQualityClient } from '../../src/clients/airQualityClient.js';
import { ForecastClient } from '../../src/clients/forecastClient.js';
import { GeocodingClient } from '../../src/clients/geocodingClient.js';
import { HttpClient, type FetchFn } from '../../src/clients/http.js';
import { OPEN_METEO_FREE_TIER, RateLimiter } from '../../src/clients/rateLimiter.js';
import { TtlCache } from '../../src/lib/ttlCache.js';
import { createNullLogger } from '../../src/logger.js';
import { AirQualityService } from '../../src/services/airQualityService.js';
import { LocationService } from '../../src/services/locationService.js';
import { WeatherService } from '../../src/services/weatherService.js';

export const FIVE_MINUTES = 5 * 60 * 1000;

/** Manually advanced clock shared by caches and the rate limiter. */
export function fakeClock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Route = (url: URL, init: RequestInit) => Response | Promise<Response>;

/**
 * Stands in for global fetch. Routes by API host; an unrouted host fails the test
 * loudly instead of silently reaching the network.
 */
export function fakeFetch(routes: Partial<Record<'geocoding' | 'forecast' | 'air', Route>>) {
  const hosts: Record<string, keyof typeof routes> = {
    'geocoding-api.open-meteo.com': 'geocoding',
    'api.open-meteo.com': 'forecast',
    'air-quality-api.open-meteo.com': 'air',
  };
  return vi.fn<FetchFn>(async (url, init) => {
    const name = hosts[url.host];
    const route = name && routes[name];
    if (!route) throw new Error(`Unexpected request in test: ${url.href}`);
    return route(url, init);
  });
}

/** A fetch that never answers, so only the AbortSignal timeout can end it. */
export const hangingRoute: Route = (_url, init) =>
  new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => {
      const reason: unknown = init.signal?.reason;
      reject(reason instanceof Error ? reason : new Error('aborted'));
    });
  });

/** Sends headers and part of the JSON body, then stalls until the timeout aborts it. */
export const stallingBodyRoute: Route = (_url, init) => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"value":'));
      init.signal?.addEventListener('abort', () => {
        const reason: unknown = init.signal?.reason;
        controller.error(reason instanceof Error ? reason : new Error('aborted'));
      });
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
};

export function createHttp(fetch: FetchFn, clock = fakeClock(), timeoutMs = 50) {
  return new HttpClient({
    logger: createNullLogger(),
    rateLimiter: new RateLimiter(OPEN_METEO_FREE_TIER, clock.now),
    timeoutMs,
    fetch,
    sleep: () => Promise.resolve(),
  });
}

export const BOT_INFO: UserFromGetMe = {
  id: 42,
  is_bot: true,
  first_name: 'Weather Test Bot',
  username: 'weather_test_bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

/**
 * Fake Telegram Bot API at the HTTP level: grammY's full request pipeline runs,
 * every call succeeds, each method name is recorded in `methods`, and the text
 * of each sendMessage in `sentTexts`.
 */
export function fakeTelegramFetch(sentTexts: string[], methods: string[] = []) {
  return (url: string, init: { body?: unknown }): Promise<Response> => {
    methods.push(url.slice(url.lastIndexOf('/') + 1));
    if (url.endsWith('/sendMessage') && typeof init.body === 'string') {
      const payload: unknown = JSON.parse(init.body);
      if (typeof payload === 'object' && payload !== null && 'text' in payload) {
        sentTexts.push(String(payload.text));
      }
    }
    return Promise.resolve(json({ ok: true, result: true }));
  };
}

/** Awaits a promise that must reject with `type`, and returns the narrowed error. */
export async function rejectionOf<E extends Error>(
  promise: Promise<unknown>,
  type: new (...args: never[]) => E,
): Promise<E> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof type) return err;
    throw err;
  }
  throw new Error(`expected a ${type.name}, but the promise resolved`);
}

/**
 * The full app (real grammY, services, clients, caches) with Telegram and
 * Open-Meteo replaced by fakes. `send()` feeds an update in; `replies` holds
 * every sendMessage call the bot made.
 */
export function createTestBot(
  fetch: FetchFn,
  timing: { httpTimeoutMs?: number; commandTimeoutMs?: number; typingIntervalMs?: number } = {},
) {
  const clock = fakeClock();
  const http = createHttp(fetch, clock, timing.httpTimeoutMs);
  const ttlMs = FIVE_MINUTES;
  const cache = <V>() => new TtlCache<V>({ ttlMs, now: clock.now });
  const locations = new LocationService(new GeocodingClient(http), cache());
  const replies: string[] = [];
  const telegramMethods: string[] = [];
  const bot = createBot({
    token: '123456:TEST-TOKEN-NOT-REAL-000000000000000',
    weather: new WeatherService(locations, new ForecastClient(http), cache()),
    airQuality: new AirQualityService(locations, new AirQualityClient(http), cache()),
    logger: createNullLogger(),
    commandTimeoutMs: timing.commandTimeoutMs ?? 1000,
    ...(timing.typingIntervalMs !== undefined && { typingIntervalMs: timing.typingIntervalMs }),
    botConfig: {
      botInfo: BOT_INFO,
      client: { fetch: fakeTelegramFetch(replies, telegramMethods) },
    },
  });

  let updateId = 1;
  async function send(text: string, chatType: 'private' | 'group' = 'private', userId = 7) {
    const command = /^\/\w+(@\w+)?/.exec(text)?.[0];
    const chat =
      chatType === 'private'
        ? ({ id: userId, type: 'private', first_name: 'Tester' } as const)
        : ({ id: -100, type: 'group', title: 'Test group' } as const);
    const update: Update = {
      update_id: updateId++,
      message: {
        message_id: updateId,
        date: Math.floor(clock.now() / 1000),
        chat,
        from: { id: userId, is_bot: false, first_name: 'Tester' },
        text,
        ...(command && { entities: [{ type: 'bot_command', offset: 0, length: command.length }] }),
      },
    };
    await bot.handleUpdate(update);
  }

  return {
    bot,
    clock,
    replies,
    telegramMethods,
    send,
    lastReply: () => replies.at(-1) ?? '',
  };
}
