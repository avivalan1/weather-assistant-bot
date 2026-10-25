import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const TOKEN = '123456:VALID-LOOKING-TOKEN-abcdefghijklmnop';

describe('loadConfig', () => {
  it('defaults to a 5-minute cache, 3 s per HTTP attempt and an 8 s command budget', () => {
    expect(loadConfig({ BOT_TOKEN: TOKEN })).toEqual({
      botToken: TOKEN,
      logLevel: 'info',
      cacheTtlMs: 5 * 60 * 1000,
      httpTimeoutMs: 3000,
      commandTimeoutMs: 8000,
    });
  });

  it('treats empty values (as copied from .env.example) as unset', () => {
    expect(loadConfig({ BOT_TOKEN: TOKEN, CACHE_TTL_SECONDS: '', LOG_LEVEL: '' })).toMatchObject({
      cacheTtlMs: 300_000,
      logLevel: 'info',
    });
  });

  it('reads overrides from the environment', () => {
    expect(loadConfig({ BOT_TOKEN: TOKEN, CACHE_TTL_SECONDS: '60' }).cacheTtlMs).toBe(60_000);
  });

  it('fails fast with a readable message when the token is missing', () => {
    expect(() => loadConfig({})).toThrow(/BOT_TOKEN is required/);
  });

  it('rejects a malformed token without echoing it', () => {
    const run = () => loadConfig({ BOT_TOKEN: 'not-a-token-secret-value' });
    expect(run).toThrow(/does not look like a Telegram bot token/);
    expect(run).not.toThrow(/not-a-token-secret-value/);
  });

  it('rejects invalid numbers', () => {
    expect(() => loadConfig({ BOT_TOKEN: TOKEN, HTTP_TIMEOUT_MS: '-1' })).toThrow(
      /HTTP_TIMEOUT_MS/,
    );
  });
});
