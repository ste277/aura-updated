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
  /**
   * I2b-S8 (S5): client-side bound for the COMMIT round trip, ms (default:
   * `deadlineMs`). When it expires the outcome is UNKNOWN: the answer is
   * StoreUnavailableError and the connection is destroyed. Never a success.
   */
  commitDeadlineMs?: number;
  /**
   * I2b-S8 (S3-8): server-side `SET LOCAL idle_in_transaction_session_timeout`,
   * ms (default: lockTimeoutMs). Only time BETWEEN round trips counts (a
   * statement waiting on a lock is active, not idle). If this process freezes
   * mid-transaction, Postgres ends the session and releases its locks.
   */
  idleInTransactionTimeoutMs?: number;
}

/** I2b-S8 (S3-8): transaction-local timeouts for a BEGIN message. Integers only (validated by callers). */
export function transactionTimeouts(o: { statementTimeoutMs: number; lockTimeoutMs: number; idleInTransactionTimeoutMs: number }): string {
  for (const v of [o.statementTimeoutMs, o.lockTimeoutMs, o.idleInTransactionTimeoutMs]) if (!Number.isInteger(v) || v < 1) throw new TypeError('timeouts must be positive integers');
  return `BEGIN; SET LOCAL statement_timeout = '${o.statementTimeoutMs}ms'; SET LOCAL lock_timeout = '${o.lockTimeoutMs}ms'; SET LOCAL idle_in_transaction_session_timeout = '${o.idleInTransactionTimeoutMs}ms'`;
}

/**
 * I2b-S8 (S5): a COMMIT is confirmed only by the server's command tag.
 * Postgres answers COMMIT on an aborted transaction with the tag ROLLBACK
 * and no error; anything but "COMMIT" is therefore an unconfirmed outcome.
 */
export function commitConfirmed(result: unknown): boolean {
  return !!result && typeof result === 'object' && (result as { command?: unknown }).command === 'COMMIT';
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
 *   - once COMMIT has been sent, its round trip has its own bound
 *     (`commitDeadlineMs`, I2b-S8 / S5; previously only the pool's query
 *     timeout). A COMMIT that does not answer in time, errors, or answers
 *     with any tag other than "COMMIT" (Postgres answers ROLLBACK on an
 *     aborted transaction) is StoreUnavailableError, never a success: the
 *     only case in which a write reported as failed may have landed is a
 *     COMMIT that reached the server but whose answer did not come back;
 *   - I2b-S8 (S3-8): the transaction also sets
 *     `idle_in_transaction_session_timeout`, so a frozen process cannot
 *     hold row locks until TCP teardown.
 * Every failure is StoreUnavailableError; a connection whose transaction
 * state is uncertain is destroyed, never returned to the pool.
 */
export function boundedStatement<R>(pool: BoundedPool, text: string, params: unknown[] | undefined, o: BoundedStatementOptions): Promise<QueryResultLike<R>> {
  const begin = transactionTimeouts({
    statementTimeoutMs: o.statementTimeoutMs,
    lockTimeoutMs: o.lockTimeoutMs,
    idleInTransactionTimeoutMs: o.idleInTransactionTimeoutMs ?? Math.max(100, o.lockTimeoutMs),
  });
  const commitDeadlineMs = o.commitDeadlineMs ?? o.deadlineMs;
  return new Promise((resolve, reject) => {
    let settled = false;
    let commitSent = false;
    let client: BoundedClient | undefined;
    let released = false;
    let commitTimer: ReturnType<typeof setTimeout> | undefined;
    const fail = (reason: 'timeout' | 'error') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (commitTimer) clearTimeout(commitTimer);
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
        clearTimeout(timer);
        // I2b-S8 (S5): the COMMIT round trip has its own bound. On expiry the
        // outcome is unknown (it may land later): report failure, destroy.
        commitTimer = setTimeout(() => {
          fail('timeout');
          destroy(c);
        }, commitDeadlineMs);
        const done = await c.query('COMMIT');
        if (settled) {
          destroy(c);
          return;
        }
        if (!commitConfirmed(done)) {
          // Not confirmed (e.g. ROLLBACK tag): never a success.
          destroy(c);
          fail('error');
          return;
        }
        released = true;
        c.release();
        settled = true;
        clearTimeout(commitTimer);
        resolve(r);
      } catch {
        destroy(client);
        fail('error');
      }
    })();
  });
}
