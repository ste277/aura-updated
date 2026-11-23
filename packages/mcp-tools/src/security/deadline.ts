/**
 * AURA-MCP-02-I2b-S2 (I2b-R-2) -- bounded execution for OAuth state and
 * rate-limit database work.
 *
 * `StoreUnavailableError` marks an infrastructure failure (database timeout,
 * refused connection, exhausted pool). It is fail-closed by construction:
 *   - `statusCode` 503 / `expose` false: when it escapes an `oidc-provider`
 *     adapter call, the library's error handler answers 503 with the generic
 *     `server_error` body (no description, no stack) and issues nothing;
 *   - the Aura handlers map it to 503 `temporarily_unavailable`;
 *   - its message is fixed, so no query text, parameter or driver detail can
 *     leak through it.
 * Identify it with `isStoreUnavailableError` (name-based, so it also works
 * across separately bundled copies of this module).
 */
export class StoreUnavailableError extends Error {
  readonly statusCode = 503;
  readonly expose = false;
  constructor(readonly reason: 'timeout' | 'error' = 'error') {
    super('OAuth state store unavailable');
    this.name = 'StoreUnavailableError';
  }
}

export function isStoreUnavailableError(err: unknown): err is StoreUnavailableError {
  return !!err && typeof err === 'object' && (err as { name?: unknown }).name === 'StoreUnavailableError';
}

/**
 * Bounds for every `pg` pool that serves OAuth state or rate limiting
 * (passed through by the app, which owns the driver). `connectionTimeoutMillis`:
 * a checkout that cannot be served fails instead of waiting forever.
 * `query_timeout`: node-pg's client-side read timeout (sends nothing to the
 * server, so it also works behind a transaction-mode pooler). Calibrate
 * against the target database's p99 latency before any staging use.
 */
export const MCP_PG_POOL_BOUNDS = Object.freeze({ max: 5, connectionTimeoutMillis: 2000, query_timeout: 3000, idleTimeoutMillis: 10_000 });

/** Validates a millisecond option: an integer in [min, max]. */
export function boundedMs(name: string, value: number | undefined, fallback: number, min: number, max: number): number {
  const v = value ?? fallback;
  if (!Number.isInteger(v) || v < min || v > max) throw new TypeError(`${name} must be an integer between ${min} and ${max}`);
  return v;
}

/**
 * Settles with `work` or rejects with StoreUnavailableError('timeout') after
 * `ms`, whichever comes first. Any rejection of `work` is also converted to
 * StoreUnavailableError('error'), so driver errors never propagate (and never
 * reach a response or a log line) as-is. A late result of `work` is ignored.
 */
export function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new StoreUnavailableError('timeout')), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        reject(new StoreUnavailableError('error'));
      },
    );
  });
}

/**
 * At most one run of `task` in flight at a time; calls made while one is
 * running are skipped (resolve to `undefined`) rather than queued. Used for
 * the opportunistic cleanup DELETEs, which must not pile up on a slow
 * database (load amplification).
 */
export function singleFlight<T>(task: () => Promise<T>): () => Promise<T | undefined> {
  let running = false;
  return async () => {
    if (running) return undefined;
    running = true;
    try {
      return await task();
    } finally {
      running = false;
    }
  };
}
