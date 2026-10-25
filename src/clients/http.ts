import type { z } from 'zod';
import type { Logger } from '../logger.js';
import { UpstreamError } from './errors.js';
import type { RateLimiter } from './rateLimiter.js';

export type FetchFn = (input: URL, init: RequestInit) => Promise<Response>;

export interface HttpClientOptions {
  logger: Logger;
  rateLimiter: RateLimiter;
  timeoutMs: number;
  /** Extra attempts for transient failures (timeout, network, 5xx). */
  retries?: number;
  retryDelayMs?: number;
  /** Injected so tests never touch the network. */
  fetch?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The only place that performs HTTP. Every response is validated against a
 * zod schema before it is returned, so callers receive typed, trusted data.
 */
export class HttpClient {
  private readonly logger: Logger;
  private readonly fetch: FetchFn;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly retries: number;
  private readonly retryDelayMs: number;

  constructor(private readonly options: HttpClientOptions) {
    this.logger = options.logger.child({ component: 'http' });
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? defaultSleep;
    this.retries = options.retries ?? 1;
    this.retryDelayMs = options.retryDelayMs ?? 300;
  }

  async getJson<S extends z.ZodType>(service: string, url: URL, schema: S): Promise<z.output<S>> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.attempt(service, url, schema);
      } catch (err) {
        if (err instanceof UpstreamError && err.isTransient && attempt < this.retries) {
          this.logger.warn(
            { service, attempt, failure: err.failure },
            'transient failure, retrying',
          );
          await this.sleep(this.retryDelayMs);
          continue;
        }
        throw err;
      }
    }
  }

  private async attempt<S extends z.ZodType>(
    service: string,
    url: URL,
    schema: S,
  ): Promise<z.output<S>> {

    // Gate 1: rate limiter ("is there quota left?" (600/min, 5,000/hour, 10,000/day)
    if (!this.options.rateLimiter.tryAcquire()) {
      throw new UpstreamError(service, 'rate_limited', 'local rate limit reached');
    }

    const started = Date.now();
    let response: Response;
    let text: string;
    try {
      // Gate 2: network and timeout 
      // The timeout covers both the request and reading the body, and a stall
      // in either surfaces here as a TimeoutError.
      const signal = AbortSignal.timeout(this.options.timeoutMs);
      response = await this.fetch(url, { signal, headers: { accept: 'application/json' } });
      text = await response.text();
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      this.logger.warn(
        {
          service,
          failure: timedOut ? 'timeout' : 'network',
          durationMs: Date.now() - started,
          error: err instanceof Error ? err.message : String(err),
        },
        'request failed',
      );
      throw new UpstreamError(
        service,
        timedOut ? 'timeout' : 'network',
        timedOut ? 'timed out' : 'network error',
        undefined,
        { cause: err },
      );
    }

    const durationMs = Date.now() - started;
    const body = parseJson(text);
    if (!response.ok) {
      const reason = readOpenMeteoReason(body);
      this.logger.warn(
        { service, status: response.status, reason, durationMs },
        'non-2xx response',
      );
      throw new UpstreamError(
        service,
        response.status === 429 ? 'rate_limited' : 'http',
        `HTTP ${response.status}${reason ? `: ${reason}` : ''}`,
        response.status,
      );
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      // A complete body that is not JSON or not the expected shape: the API changed or broke.
      this.logger.error({ service, issues: parsed.error.issues, durationMs }, 'invalid response');
      throw new UpstreamError(service, 'invalid_response', 'response failed validation');
    }

    this.logger.debug({ service, status: response.status, durationMs }, 'request ok');
    return parsed.data;
  }
}

/** `undefined` for a body that is not JSON; schema validation then reports it. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Open-Meteo reports errors as `{ "error": true, "reason": "..." }`. */
function readOpenMeteoReason(body: unknown): string | undefined {
  if (typeof body === 'object' && body !== null && 'reason' in body) {
    const { reason } = body;
    if (typeof reason === 'string') return reason;
  }
  return undefined;
}
