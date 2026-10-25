import { BotError, GrammyError, HttpError } from 'grammy';
import { describeTelegramFailure } from '../src/bot/createBot.js';
import { describe, expect, it } from 'vitest';
import {
  FIVE_MINUTES,
  createTestBot,
  fakeFetch,
  hangingRoute,
  json,
  rejectionOf,
} from './helpers/fakes.js';
import {
  airQualityBody,
  forecastBody,
  noGeocodingResults,
  parisGeocoding,
  rioGeocoding,
  telAvivGeocoding,
} from './helpers/fixtures.js';

/** Fake Open-Meteo that answers every geocoding query from one fixture. */
function happyFetch(geocoding: unknown = parisGeocoding) {
  return fakeFetch({
    geocoding: () => json(geocoding),
    forecast: () => json(forecastBody()),
    air: () => json(airQualityBody()),
  });
}

const callsTo = (fetch: ReturnType<typeof fakeFetch>, host: string) =>
  fetch.mock.calls.filter(([url]) => url.host === host).length;

describe('/weather', () => {
  it('replies with location, temperature, min/max, a suggestion and attribution', async () => {
    const fetch = happyFetch();
    const t = createTestBot(fetch);

    await t.send('/weather Paris');

    const reply = t.lastReply();
    expect(reply).toContain('Paris, Île-de-France Region, France');
    expect(reply).toContain('Now: <b>11.6°C</b> (feels like 8.8°C), Slight rain');
    expect(reply).toContain('Today (2026-10-24): min 8.8°C · max 13.2°C');
    expect(reply).toContain('💡 Rain is likely: take an umbrella.');
    expect(reply).toContain('As of 2026-10-24 18:00 Europe/Paris (UTC+02:00)');
    expect(reply).toContain('Weather data by <a href="https://open-meteo.com/">Open-Meteo.com</a>');
  });

  it('bases the tip on the rest of the day, not on hours already past', async () => {
    // Rain all morning; dry from 18:00 ("now") onwards, after a 17:30 sunset.
    const dryEvening = forecastBody({
      weatherCode: 3,
      sunset: '2026-10-24T17:30',
      hour: (h) => (h < 18 ? {} : { weather_code: 3, precipitation_probability: 0 }),
    });
    const t = createTestBot(
      fakeFetch({ geocoding: () => json(parisGeocoding), forecast: () => json(dryEvening) }),
    );
    await t.send('/weather Paris');
    expect(t.lastReply()).not.toMatch(/umbrella/);
    expect(t.lastReply()).toContain('💡 Calm, mild night');
  });

  it('uses daytime wording before sunrise, when the day is still ahead', async () => {
    // 05:00, before dawn; dry and calm, a 33 °C afternoon ahead.
    const hotDayAhead = forecastBody({
      time: '2026-10-24T05:00',
      weatherCode: 0,
      hour: (h) => ({
        weather_code: 0,
        precipitation_probability: 0,
        temperature_2m: h >= 12 && h <= 16 ? 33 : 24,
      }),
    });
    const t = createTestBot(
      fakeFetch({ geocoding: () => json(parisGeocoding), forecast: () => json(hotDayAhead) }),
    );
    await t.send('/weather Paris');
    expect(t.lastReply()).toContain('💡 Hot day: stay hydrated');
  });

  it('requests Celsius and the location’s local day from the API', async () => {
    const fetch = happyFetch();
    await createTestBot(fetch).send('/weather Paris');

    const forecastUrl = fetch.mock.calls.find(([url]) => url.host === 'api.open-meteo.com')?.[0];
    expect(forecastUrl?.searchParams.get('temperature_unit')).toBe('celsius');
    expect(forecastUrl?.searchParams.get('timezone')).toBe('Europe/Paris');
  });

  it('hints at other places with the same name', async () => {
    const t = createTestBot(happyFetch());
    await t.send('/weather Paris');
    expect(t.lastReply()).toContain('Other matches: Paris, Texas, US · Paris, Tennessee, US');
    expect(t.lastReply()).toContain('/weather Paris, Texas');
  });

  it('chooses the place named after a comma', async () => {
    const t = createTestBot(happyFetch());
    await t.send('/weather Paris, Texas');
    expect(t.lastReply()).toContain('Paris, Texas, United States');
    expect(t.lastReply()).not.toContain('Other matches');
  });

  it('asks for a city when the argument is missing', async () => {
    const fetch = happyFetch();
    const t = createTestBot(fetch);
    await t.send('/weather');
    await t.send('/weather    ');
    expect(t.replies).toEqual([
      'Please add a city, for example:\n/weather New York',
      'Please add a city, for example:\n/weather New York',
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('escapes HTML in data from the API, so it cannot break or inject formatting', async () => {
    const [france] = parisGeocoding.results;
    const t = createTestBot(
      fakeFetch({
        geocoding: () => json({ results: [{ ...france, admin1: 'Île <i>de</i> France & Co' }] }),
        forecast: () => json(forecastBody()),
      }),
    );
    await t.send('/weather Paris');
    expect(t.lastReply()).toContain('Paris, Île &lt;i&gt;de&lt;/i&gt; France &amp; Co, France');
    expect(t.lastReply()).not.toContain('<i>de</i>');
  });

  it('rejects a forecast whose hourly columns do not line up', async () => {
    const broken = forecastBody();
    broken.hourly.uv_index = broken.hourly.uv_index.slice(0, 20);
    const t = createTestBot(
      fakeFetch({ geocoding: () => json(parisGeocoding), forecast: () => json(broken) }),
    );
    await t.send('/weather Paris');
    expect(t.lastReply()).toBe(
      'The data provider is unavailable right now. Please try again later.',
    );
  });

  it.each([
    ['forecast date', 'forecast'],
    ['air-quality time', 'air'],
  ] as const)('rejects a malformed %s instead of printing it', async (_label, api) => {
    const forecast = forecastBody();
    forecast.daily.time = ['<b>2026-10-24</b>'];
    const air = airQualityBody();
    air.current.time = '2026-10-24T18:00<i>';
    const t = createTestBot(
      fakeFetch({
        geocoding: () => json(parisGeocoding),
        forecast: () => json(api === 'forecast' ? forecast : forecastBody()),
        air: () => json(api === 'air' ? air : airQualityBody()),
      }),
    );
    await t.send(api === 'forecast' ? '/weather Paris' : '/air Paris');
    expect(t.lastReply()).toBe(
      'The data provider is unavailable right now. Please try again later.',
    );
  });

  it('rejects forecasts that are not in Celsius instead of mislabelling them', async () => {
    const fahrenheit = forecastBody({ temperature: 52.9 });
    fahrenheit.current_units.temperature_2m = '°F';
    const t = createTestBot(
      fakeFetch({ geocoding: () => json(parisGeocoding), forecast: () => json(fahrenheit) }),
    );
    await t.send('/weather Paris');
    expect(t.lastReply()).toBe(
      'The data provider is unavailable right now. Please try again later.',
    );
  });

  it('treats command names case-insensitively', async () => {
    const t = createTestBot(happyFetch());
    await t.send('/Weather Paris');
    expect(t.lastReply()).toContain('Paris, Île-de-France Region, France');
    await t.send('/HELP');
    expect(t.lastReply()).toContain('/weather New York');
  });

  it('accepts US state codes', async () => {
    const t = createTestBot(happyFetch());
    await t.send('/weather Paris, TX');
    expect(t.lastReply()).toContain('Paris, Texas, United States');
  });

  it('shows what exists when the city is not in the given country', async () => {
    const t = createTestBot(happyFetch());
    await t.send('/weather Paris, Japan');
    expect(t.lastReply()).toBe(
      'I found “Paris”, but not in “Japan”. Did you mean: ' +
        'Paris, Île-de-France Region, FR · Paris, Texas, US · Paris, Tennessee, US?\n' +
        '→ e.g. /weather Paris, Île-de-France Region',
    );
  });

  it('explains when the city is unknown', async () => {
    const t = createTestBot(happyFetch(noGeocodingResults));
    await t.send('/weather Atlantis');
    expect(t.lastReply()).toContain("I couldn't find “Atlantis”");
  });

  it('rejects invalid input without calling the API', async () => {
    const fetch = happyFetch();
    const t = createTestBot(fetch);
    await t.send('/weather <b>hi</b>');
    expect(t.lastReply()).toMatch(/may only contain letters/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('/air', () => {
  it('replies with AQI value, standard, category, labelled timestamp, forecast and credits', async () => {
    const t = createTestBot(happyFetch(rioGeocoding));

    await t.send('/air Rio de Janeiro'); // multi-word city

    const reply = t.lastReply();
    expect(reply).toContain('Air quality – Rio de Janeiro, Brazil');
    expect(reply).toContain('US AQI (EPA): <b>42</b> – Good');
    expect(reply).toContain(
      'CAMS model estimate for 2026-10-24 18:00 America/Sao_Paulo (UTC-03:00), not a ground-station measurement.',
    );
    // Peak among *future* hours only (03:00 had a higher value but is in the past).
    expect(reply).toContain('<b>Forecast</b>: peak 77 (Moderate) at 21:00 today');
    expect(reply).toContain('Open-Meteo.com');
    expect(reply).toContain('Copernicus Atmosphere Monitoring Service information 2026');
  });

  it('uses the European AQI for European cities', async () => {
    const t = createTestBot(happyFetch(parisGeocoding));
    await t.send('/air Paris');
    expect(t.lastReply()).toContain('European AQI (EEA): <b>24</b> – Fair');
  });

  it('falls back to the other standard when the preferred value is missing', async () => {
    const fetch = fakeFetch({
      geocoding: () => json(parisGeocoding),
      air: () => json(airQualityBody({ europeanAqi: null })),
    });
    const t = createTestBot(fetch);
    await t.send('/air Paris');
    expect(t.lastReply()).toContain('US AQI (EPA): <b>42</b> – Good');
  });

  it('does not suggest unrelated places as alternatives', async () => {
    const t = createTestBot(happyFetch(telAvivGeocoding));
    await t.send('/air Tel Aviv');
    expect(t.lastReply()).toContain('Air quality – Tel Aviv, Israel');
    expect(t.lastReply()).not.toContain('Luna Park');
  });

  it('suggests /air commands, not /weather, for other matches', async () => {
    const t = createTestBot(happyFetch());
    await t.send('/air Paris');
    expect(t.lastReply()).toContain('Other matches: Paris, Texas, US · Paris, Tennessee, US');
    expect(t.lastReply()).toContain('/air Paris, Texas');
    await t.send('/air Paris, Japan');
    expect(t.lastReply()).toContain('→ e.g. /air Paris, Île-de-France Region');
  });

  it('asks for a city when the argument is missing', async () => {
    const fetch = happyFetch();
    const t = createTestBot(fetch);
    await t.send('/air');
    expect(t.lastReply()).toBe('Please add a city, for example:\n/air Berlin');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('API failures', () => {
  it('reports an outage and keeps serving later requests', async () => {
    let down = true;
    const fetch = fakeFetch({
      geocoding: () => json(parisGeocoding),
      forecast: () =>
        down ? json({ error: true, reason: 'maintenance' }, 503) : json(forecastBody()),
    });
    const t = createTestBot(fetch);

    await t.send('/weather Paris');
    expect(t.lastReply()).toBe(
      'The data provider is unavailable right now. Please try again later.',
    );

    down = false;
    await t.send('/weather Paris');
    expect(t.lastReply()).toContain('11.6°C'); // failure was not cached
  });

  it('caps the total wait per command, across geocoding, forecast and retries', async () => {
    // Geocoding stalls once, then succeeds on retry (~200 ms); the forecast then
    // hangs on both attempts (~400 ms). Without a budget: ~600 ms. Budget: 250 ms.
    let geocodingCalls = 0;
    const t = createTestBot(
      fakeFetch({
        geocoding: (url, init) =>
          ++geocodingCalls === 1 ? hangingRoute(url, init) : json(parisGeocoding),
        forecast: hangingRoute,
      }),
      { httpTimeoutMs: 200, commandTimeoutMs: 250 },
    );
    const started = performance.now();
    await t.send('/weather Paris');
    expect(performance.now() - started).toBeLessThan(450);
    expect(t.lastReply()).toMatch(/taking too long/);
  });

  it('gives a user who joins an in-flight request their own time budget', async () => {
    const delayed = (ms: number, body: unknown) => () =>
      new Promise<Response>((r) =>
        setTimeout(() => {
          r(json(body));
        }, ms),
      );
    const t = createTestBot(
      fakeFetch({
        geocoding: delayed(100, parisGeocoding),
        forecast: delayed(200, forecastBody()),
      }),
      { httpTimeoutMs: 1000, commandTimeoutMs: 250 },
    );

    // User A: geocoding done at ~100 ms, forecast in flight until ~300 ms, budget ends at 250 ms.
    const userA = t.send('/weather Paris', 'private', 1);
    await new Promise((r) => setTimeout(r, 150));
    // User B joins at ~150 ms: geocoding is cached and the forecast is already in flight.
    const userB = t.send('/weather Paris', 'private', 2);
    await Promise.all([userA, userB]);

    expect(t.replies).toHaveLength(2);
    expect(t.replies[0]).toMatch(/taking too long/); // A ran out of time
    expect(t.replies[1]).toContain('Now: <b>11.6°C</b>'); // B was not cut off by A's deadline
  });

  it('keeps the typing indicator alive while waiting', async () => {
    const slow = () =>
      new Promise<Response>((r) =>
        setTimeout(() => {
          r(json(parisGeocoding));
        }, 120),
      );
    const t = createTestBot(fakeFetch({ geocoding: slow, forecast: () => json(forecastBody()) }), {
      httpTimeoutMs: 500,
      typingIntervalMs: 30,
    });
    await t.send('/weather Paris');
    const typing = t.telegramMethods.filter((m) => m === 'sendChatAction').length;
    expect(typing).toBeGreaterThanOrEqual(3); // once at start, then re-sent every 30 ms
    const countAfterReply = typing;
    await new Promise((r) => setTimeout(r, 80));
    expect(t.telegramMethods.filter((m) => m === 'sendChatAction')).toHaveLength(countAfterReply);
  });

  it('reports a timeout', async () => {
    const t = createTestBot(
      fakeFetch({ geocoding: () => json(parisGeocoding), forecast: hangingRoute }),
    );
    await t.send('/weather Paris');
    expect(t.lastReply()).toMatch(/taking too long/);
  });

  it('reports malformed API data instead of crashing', async () => {
    const t = createTestBot(
      fakeFetch({ geocoding: () => json(parisGeocoding), air: () => json({ unexpected: true }) }),
    );
    await t.send('/air Paris');
    expect(t.lastReply()).toBe(
      'The data provider is unavailable right now. Please try again later.',
    );
  });

  it('reports upstream rate limiting', async () => {
    const t = createTestBot(fakeFetch({ geocoding: () => json({ error: true }, 429) }));
    await t.send('/weather Paris');
    expect(t.lastReply()).toMatch(/try again in a minute/);
  });

  it('hands Telegram API failures to the error handler instead of crashing', async () => {
    const t = createTestBot(happyFetch());
    t.bot.api.config.use(() => Promise.reject(new Error('Telegram is down')));

    // Mirrors what @grammyjs/runner does: handleUpdate, then bot.errorHandler on failure.
    const error = await rejectionOf(t.send('/help'), BotError);
    await expect(Promise.resolve(t.bot.errorHandler(error))).resolves.toBeUndefined();
  });
});

describe('cache', () => {
  it('reuses results for 5 minutes, separately per data type, then refetches', async () => {
    const fetch = happyFetch();
    const t = createTestBot(fetch);

    await t.send('/weather Paris');
    await t.send('/weather paris');
    await t.send('/air Paris');
    expect(callsTo(fetch, 'geocoding-api.open-meteo.com')).toBe(1);
    expect(callsTo(fetch, 'api.open-meteo.com')).toBe(1);
    expect(callsTo(fetch, 'air-quality-api.open-meteo.com')).toBe(1);

    t.clock.advance(FIVE_MINUTES);
    await t.send('/weather Paris');
    expect(callsTo(fetch, 'geocoding-api.open-meteo.com')).toBe(2);
    expect(callsTo(fetch, 'api.open-meteo.com')).toBe(2);
  });

  it('keeps different locations apart', async () => {
    const fetch = happyFetch();
    const t = createTestBot(fetch);
    await t.send('/weather Paris');
    await t.send('/weather Paris, Texas');
    expect(callsTo(fetch, 'api.open-meteo.com')).toBe(2);
  });
});

describe('other messages', () => {
  it('shows usage examples for /help and /start', async () => {
    const t = createTestBot(happyFetch());
    await t.send('/help');
    await t.send('/start');
    expect(t.replies[0]).toContain('/weather New York');
    expect(t.replies[0]).toContain('/weather Paris, Texas');
    expect(t.replies[1]).toBe(t.replies[0]);
  });

  it('answers unknown commands', async () => {
    const t = createTestBot(happyFetch());
    await t.send('/forecast London');
    expect(t.lastReply()).toMatch(/don’t know that command/);
  });

  it('answers plain text with a hint', async () => {
    const t = createTestBot(happyFetch());
    await t.send('hello');
    expect(t.lastReply()).toMatch(/only understand commands/);
  });

  it('points group chats to a private chat', async () => {
    const fetch = happyFetch();
    const t = createTestBot(fetch);
    await t.send('/weather Paris', 'group');
    expect(t.lastReply()).toMatch(/private chat/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('describeTelegramFailure', () => {
  const apiError = (code: number, description: string) =>
    new GrammyError('failed', { ok: false, error_code: code, description }, 'getUpdates', {});

  it('names the cause of fatal polling errors', () => {
    expect(describeTelegramFailure(apiError(409, 'Conflict'))).toMatch(/another bot instance/);
    expect(describeTelegramFailure(apiError(401, 'Unauthorized'))).toMatch(/revoked/);
  });

  it('never includes the underlying fetch error, which carries the token in its URL', () => {
    const leak = new Error('request to https://api.telegram.org/bot123:SECRET/getMe failed');
    const text = describeTelegramFailure(
      new HttpError("Network request for 'getMe' failed!", leak),
    );
    expect(text).not.toContain('SECRET');
  });
});
