export type Clock = () => number;

/** A caller's own deadline passed while it waited for a value. */
export class DeadlineExceededError extends Error {
  override readonly name = 'DeadlineExceededError';
  constructor() {
    super('deadline exceeded while waiting for the value');
  }
}

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export interface TtlCacheOptions {
  ttlMs: number;
  /** Upper bound on stored entries; the oldest entry is evicted first. */
  maxEntries?: number;
  /** Injectable for tests, so expiry can be checked without real waiting. */
  now?: Clock;
}

/**
 * In-memory cache that only stores successful results.
 *
 * `getOrLoad` also shares in-flight loads: concurrent callers asking for the same
 * key wait on one upstream request. If that request fails, nothing is cached and
 * the next caller tries again.
 *
 * Because a load is shared, it must not be bound to any one caller's deadline.
 * Each caller instead waits with its own: when it passes, that caller gets a
 * DeadlineExceededError while the load carries on for the others (and is cached).
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly inFlight = new Map<string, Promise<V>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: Clock;

  constructor(options: TtlCacheOptions) {
    this.ttlMs = options.ttlMs;
    this.maxEntries = options.maxEntries ?? 1000;
    this.now = options.now ?? Date.now;
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    // Re-inserting moves the key to the end of the Map's insertion order,
    // so the first key is always the oldest write.
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  async getOrLoad(key: string, load: () => Promise<V>, deadline?: AbortSignal): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    if (deadline?.aborted === true) throw new DeadlineExceededError();

    // inFlight: requests currently in progress, stored as promises
    let shared = this.inFlight.get(key);
    if (!shared) {
      shared = load()
      // on success
        .then((value) => {
          this.set(key, value);
          return value;
        })
        .finally(() => {
          this.inFlight.delete(key);
        });
      this.inFlight.set(key, shared);
    }
    return deadline ? waitWithDeadline(shared, deadline) : shared;
  }

  get size(): number {
    // entries: finished results with an expiry time ("Paris forecast, valid until 14:05").
    return this.entries.size;
  }
}

/** Settles like `promise`, or rejects with DeadlineExceededError if `deadline` aborts first. */
function waitWithDeadline<V>(promise: Promise<V>, deadline: AbortSignal): Promise<V> {
  return new Promise<V>((resolve, reject) => {
    const onAbort = () => {
      reject(new DeadlineExceededError());
    };
    deadline.addEventListener('abort', onAbort, { once: true });
    // Always attaches a rejection handler, so a shared load that fails after every
    // caller has given up is still handled.
    promise.then(resolve, reject).finally(() => {
      deadline.removeEventListener('abort', onAbort);
    });
  });
}
