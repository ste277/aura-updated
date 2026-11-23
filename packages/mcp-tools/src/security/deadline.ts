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

type QueryResultLike<R> = { rows: R[]; rowCount: number | null };
export interface BoundedClient {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResultLike<R>>;
  release(err?: unknown): void;
}
export interface BoundedPool {
  connect(): Promise<BoundedClient>;
}
export interface BoundedStatementOptions {
  /** Client-side answer deadline (checkout + BEGIN + statement), ms. */
  deadlineMs: number;
  /** Server-side `SET LOCAL statement_timeout`, ms. */
  statementTimeoutMs: number;
  /** Server-side `SET LOCAL lock_timeout`, ms. */
  lockTimeoutMs: number;
}

/**
 * AURA-MCP-02-I2b-S4 (S3-2) -- one statement in its own short transaction,
 * bounded on BOTH sides, with no late write after a reported failure:
 *   - `BEGIN; SET LOCAL statement_timeout; SET LOCAL lock_timeout` (one
 *     message; transaction-scoped, so safe behind a transaction-mode pooler):
 *     the server aborts the statement itself instead of running or waiting
 *     on a lock after the client has gone;
 *   - the work is committed only by an explicit COMMIT that this function
 *     sends, and it is NEVER sent once the deadline has answered failure.
 *     A connection abandoned before COMMIT is destroyed, and Postgres rolls
 *     back an uncommitted transaction when its connection ends, so a
 *     statement that finishes after the deadline cannot become durable --
 *     even if the server-side timeouts are larger than the deadline;
 *   - once COMMIT has been sent, the deadline waits for its outcome (bounded
 *     by the pool's client-side query timeout). If that outcome is lost the
 *     answer is still StoreUnavailableError: the only case in which a write
 *     reported as failed may have landed is a lost COMMIT acknowledgement.
 * Every failure is StoreUnavailableError; a connection whose transaction
 * state is uncertain is destroyed, never returned to the pool.
 */
export function boundedStatement<R>(pool: BoundedPool, text: string, params: unknown[] | undefined, o: BoundedStatementOptions): Promise<QueryResultLike<R>> {
  const begin = `BEGIN; SET LOCAL statement_timeout = '${o.statementTimeoutMs}ms'; SET LOCAL lock_timeout = '${o.lockTimeoutMs}ms'`;
  return new Promise((resolve, reject) => {
    let settled = false;
    let commitSent = false;
    let client: BoundedClient | undefined;
    let released = false;
    const fail = (reason: 'timeout' | 'error') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new StoreUnavailableError(reason));
    };
    const destroy = (c: BoundedClient | undefined) => {
      if (!c || released) return;
      released = true;
      try {
        c.release(new Error('bounded statement abandoned'));
      } catch {
        // already gone
      }
    };
    const timer = setTimeout(() => {
      if (commitSent) return; // the outcome is decided by COMMIT now
      fail('timeout');
      destroy(client);
    }, o.deadlineMs);
    (async () => {
      try {
        const c = await pool.connect();
        if (settled) {
          // Never used: clean.
          c.release();
          return;
        }
        client = c;
        await c.query(begin);
        const r = await c.query<R>(text, params);
        if (settled) {
          // Failure already reported: never commit; destroying the
          // connection rolls the transaction back.
          destroy(c);
          return;
        }
        commitSent = true;
        await c.query('COMMIT');
        released = true;
        c.release();
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(r);
        }
      } catch {
        destroy(client);
        fail('error');
      }
    })();
  });
}
