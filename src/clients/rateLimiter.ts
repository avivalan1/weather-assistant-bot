import type { Clock } from '../lib/ttlCache.js';

export interface RateWindow {
  limit: number;
  windowMs: number;
}

/** Open-Meteo free tier: 600/minute, 5,000/hour, 10,000/day. */
export const OPEN_METEO_FREE_TIER: readonly RateWindow[] = [
  { limit: 600, windowMs: 60_000 },
  { limit: 5_000, windowMs: 3_600_000 },
  { limit: 10_000, windowMs: 86_400_000 },
];

/**
 * Sliding-window limiter across several windows at once. A call is allowed only
 * if it fits in every window; refused calls are not recorded.
 */
export class RateLimiter {
  private timestamps: number[] = [];
  private readonly longestWindowMs: number;

  constructor(
    private readonly windows: readonly RateWindow[],
    private readonly now: Clock = Date.now,
  ) {
    this.longestWindowMs = Math.max(...windows.map((w) => w.windowMs));
  }

  tryAcquire(): boolean {
    const now = this.now();
    // Timestamps are pushed in order, so expired ones are always at the front.
    const firstLive = this.timestamps.findIndex((t) => t > now - this.longestWindowMs);
    this.timestamps = firstLive === -1 ? [] : this.timestamps.slice(firstLive);

    for (const { limit, windowMs } of this.windows) {
      const used = this.timestamps.filter((t) => t > now - windowMs).length;
      if (used >= limit) return false;
    }
    this.timestamps.push(now);
    return true;
  }
}
