import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { UpstreamError } from '../src/clients/errors.js';
import { HttpClient } from '../src/clients/http.js';
import { RateLimiter } from '../src/clients/rateLimiter.js';
import { createNullLogger } from '../src/logger.js';
import {
  createHttp,
  fakeClock,
  fakeFetch,
  hangingRoute,
  json,
  rejectionOf,
  stallingBodyRoute,
} from './helpers/fakes.js';

const Schema = z.object({ value: z.number() });
const URL_ = new URL('https://api.open-meteo.com/v1/forecast');

const failureOf = (promise: Promise<unknown>) => rejectionOf(promise, UpstreamError);

describe('HttpClient', () => {
  it('returns validated data', async () => {
    const fetch = fakeFetch({ forecast: () => json({ value: 1, extra: 'ignored' }) });
    expect(await createHttp(fetch).getJson('forecast', URL_, Schema)).toEqual({ value: 1 });
  });

  it('turns a hanging request into a timeout error after one retry', async () => {
    const fetch = fakeFetch({ forecast: hangingRoute });
    const err = await failureOf(createHttp(fetch).getJson('forecast', URL_, Schema));
    expect(err.failure).toBe('timeout');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reports a stall while the body is arriving as a timeout and retries it', async () => {
    const fetch = fakeFetch({ forecast: stallingBodyRoute });
    const err = await failureOf(createHttp(fetch).getJson('forecast', URL_, Schema));
    expect(err.failure).toBe('timeout'); // not 'invalid_response'
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('recovers when only the first attempt stalls', async () => {
    let calls = 0;
    const fetch = fakeFetch({
      forecast: (url, init) => (++calls === 1 ? hangingRoute(url, init) : json({ value: 3 })),
    });
    expect(await createHttp(fetch).getJson('forecast', URL_, Schema)).toEqual({ value: 3 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries a 5xx once and succeeds', async () => {
    let calls = 0;
    const fetch = fakeFetch({
      forecast: () =>
        ++calls === 1 ? json({ error: true, reason: 'down' }, 503) : json({ value: 2 }),
    });
    expect(await createHttp(fetch).getJson('forecast', URL_, Schema)).toEqual({ value: 2 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('gives up after one retry on repeated 5xx', async () => {
    const fetch = fakeFetch({ forecast: () => json({}, 500) });
    const err = await failureOf(createHttp(fetch).getJson('forecast', URL_, Schema));
    expect(err).toMatchObject({ failure: 'http', status: 500 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 4xx and keeps the API reason', async () => {
    const fetch = fakeFetch({
      forecast: () => json({ error: true, reason: 'Latitude must be in range' }, 400),
    });
    const err = await failureOf(createHttp(fetch).getJson('forecast', URL_, Schema));
    expect(err.failure).toBe('http');
    expect(err.message).toContain('Latitude must be in range');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('maps HTTP 429 to rate_limited', async () => {
    const fetch = fakeFetch({ forecast: () => json({ error: true }, 429) });
    expect((await failureOf(createHttp(fetch).getJson('forecast', URL_, Schema))).failure).toBe(
      'rate_limited',
    );
  });

  it('rejects responses that fail schema validation', async () => {
    const fetch = fakeFetch({ forecast: () => json({ value: 'not a number' }) });
    expect((await failureOf(createHttp(fetch).getJson('forecast', URL_, Schema))).failure).toBe(
      'invalid_response',
    );
  });

  it('rejects non-JSON bodies', async () => {
    const fetch = fakeFetch({ forecast: () => new Response('<html>oops</html>') });
    expect((await failureOf(createHttp(fetch).getJson('forecast', URL_, Schema))).failure).toBe(
      'invalid_response',
    );
  });

  it('maps a network failure to a transient error and retries it', async () => {
    const fetch = fakeFetch({
      forecast: () => Promise.reject(new TypeError('fetch failed')),
    });
    expect((await failureOf(createHttp(fetch).getJson('forecast', URL_, Schema))).failure).toBe(
      'network',
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('refuses calls locally once the rate limit is reached', async () => {
    const clock = fakeClock();
    const fetch = fakeFetch({ forecast: () => json({ value: 1 }) });
    const http = new HttpClient({
      logger: createNullLogger(),
      rateLimiter: new RateLimiter([{ limit: 2, windowMs: 60_000 }], clock.now),
      timeoutMs: 50,
      fetch,
    });

    await http.getJson('forecast', URL_, Schema);
    await http.getJson('forecast', URL_, Schema);
    expect((await failureOf(http.getJson('forecast', URL_, Schema))).failure).toBe('rate_limited');
    expect(fetch).toHaveBeenCalledTimes(2);

    clock.advance(60_000); // window slides past the first two calls
    await expect(http.getJson('forecast', URL_, Schema)).resolves.toEqual({ value: 1 });
  });
});
