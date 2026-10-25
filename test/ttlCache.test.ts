import { describe, expect, it, vi } from 'vitest';
import { DeadlineExceededError, TtlCache } from '../src/lib/ttlCache.js';
import { FIVE_MINUTES, fakeClock } from './helpers/fakes.js';

describe('TtlCache', () => {
  it('serves a cached value until the TTL elapses, then reloads', async () => {
    const clock = fakeClock();
    const cache = new TtlCache<string>({ ttlMs: FIVE_MINUTES, now: clock.now });
    const load = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');

    expect(await cache.getOrLoad('k', load)).toBe('first');
    clock.advance(FIVE_MINUTES - 1);
    expect(await cache.getOrLoad('k', load)).toBe('first');
    expect(load).toHaveBeenCalledTimes(1);

    clock.advance(1); // exactly 5 minutes after the write
    expect(await cache.getOrLoad('k', load)).toBe('second');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not cache failures', async () => {
    const cache = new TtlCache<string>({ ttlMs: FIVE_MINUTES });
    const load = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok');

    await expect(cache.getOrLoad('k', load)).rejects.toThrow('boom');
    expect(cache.size).toBe(0);
    expect(await cache.getOrLoad('k', load)).toBe('ok');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps keys separate', async () => {
    const cache = new TtlCache<string>({ ttlMs: FIVE_MINUTES });
    expect(await cache.getOrLoad('a', () => Promise.resolve('A'))).toBe('A');
    expect(await cache.getOrLoad('b', () => Promise.resolve('B'))).toBe('B');
  });

  it('shares one in-flight load between concurrent callers', async () => {
    const cache = new TtlCache<string>({ ttlMs: FIVE_MINUTES });
    let resolve: (v: string) => void = () => undefined;
    const load = vi.fn(
      () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    );

    const both = Promise.all([cache.getOrLoad('k', load), cache.getOrLoad('k', load)]);
    resolve('value');

    expect(await both).toEqual(['value', 'value']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('applies each caller’s deadline to that caller only', async () => {
    const cache = new TtlCache<string>({ ttlMs: FIVE_MINUTES });
    let resolve: (v: string) => void = () => undefined;
    const load = vi.fn(
      () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    );
    const impatient = new AbortController();

    const first = cache.getOrLoad('k', load, impatient.signal);
    const second = cache.getOrLoad('k', load, new AbortController().signal);
    impatient.abort();
    await expect(first).rejects.toThrow(DeadlineExceededError);

    resolve('value'); // the shared load was not cancelled by the first caller
    expect(await second).toBe('value');
    expect(cache.get('k')).toBe('value');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('evicts the oldest entry beyond maxEntries', () => {
    const cache = new TtlCache<number>({ ttlMs: FIVE_MINUTES, maxEntries: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });
});
