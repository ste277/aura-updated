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
import { AsyncLocalStorage } from 'async_hooks';

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
 * AURA-MCP-02-I2b-S10 -- per-request time budget.
 *
 * A request may make several store calls, each bounded by its own deadline.
 * `runWithRequestBudget(ms, fn)` caps their SUM: inside `fn` (and everything
 * it awaits, via AsyncLocalStorage), every bounded store call uses
 * `min(own deadline, time left in the budget)`, and a call made after the
 * budget is spent fails at once with StoreUnavailableError('timeout') without
 * touching the database. The budget only ever SHORTENS a deadline, so outside
 * a budget (or with time to spare) behaviour is unchanged.
 */
const budgetStore = new AsyncLocalStorage<{ deadlineAt: number }>();

export function runWithRequestBudget<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  if (!Number.isInteger(ms) || ms < 1) throw new TypeError('request budget must be a positive integer');
  return budgetStore.run({ deadlineAt: Date.now() + ms }, fn);
}

/** Runs `fn` outside any request budget (work that must not be cut short by the request's budget). */
export function outsideRequestBudget<T>(fn: () => T): T {
  return budgetStore.exit(fn);
}

/** Time left in the current request budget, ms (Infinity outside a budget; never negative). */
export function requestBudgetRemainingMs(): number {
  const b = budgetStore.getStore();
  return b ? Math.max(0, b.deadlineAt - Date.now()) : Infinity;
}

/** A store-call deadline shortened to the current request budget. 0 = already spent. */
export function budgetedDeadlineMs(ms: number): number {
  return Math.min(ms, requestBudgetRemainingMs());
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
  /**
   * Client-side deadline for the WHOLE operation: checkout + BEGIN +
   * statement + COMMIT, ms (I2b-S10: COMMIT no longer starts a new clock).
   * Shortened to the current request budget (`runWithRequestBudget`).
   */
  deadlineMs: number;
  /** Server-side `SET LOCAL statement_timeout`, ms. */
  statementTimeoutMs: number;
  /** Server-side `SET LOCAL lock_timeout`, ms. */
  lockTimeoutMs: number;
  /**
   * Optional tighter bound for the COMMIT round trip alone, ms. It can only
   * shorten the overall deadline, never extend it. When either expires after
   * COMMIT was sent the outcome is UNKNOWN: the answer is
   * StoreUnavailableError and the connection is destroyed. Never a success.
   */
  commitDeadlineMs?: number;
  /**
   * I2b-S8 (S3-8): server-side `SET LOCAL idle_in_transaction_session_timeout`,
   * ms (default: max(100, lockTimeoutMs)). Only time BETWEEN round trips counts (a
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

function beginText(o: BoundedStatementOptions): string {
  return transactionTimeouts({
    statementTimeoutMs: o.statementTimeoutMs,
    lockTimeoutMs: o.lockTimeoutMs,
    idleInTransactionTimeoutMs: o.idleInTransactionTimeoutMs ?? Math.max(100, o.lockTimeoutMs),
  });
}

/** Destroys a checked-out connection (Postgres rolls back any open transaction). Never throws. */
function destroyClient(c: BoundedClient): void {
  try {
    c.release(new Error('bounded statement abandoned'));
  } catch {
    // already gone
  }
}

/**
 * AURA-MCP-02-I2b-S4 (S3-2) -- one statement in its own short transaction,
 * bounded on BOTH sides, with no late write after a reported failure:
 *   - `BEGIN; SET LOCAL statement_timeout; SET LOCAL lock_timeout;
 *     SET LOCAL idle_in_transaction_session_timeout` (one message;
 *     transaction-scoped, so safe behind a transaction-mode pooler): the
 *     server aborts the statement itself instead of running or waiting on a
 *     lock after the client has gone, and a frozen process cannot hold row
 *     locks until TCP teardown (I2b-S8 / S3-8);
 *   - the work is committed only by an explicit COMMIT that this function
 *     sends, and it is NEVER sent once the deadline has answered failure.
 *     A connection abandoned before COMMIT is destroyed, and Postgres rolls
 *     back an uncommitted transaction when its connection ends, so a
 *     statement that finishes after the deadline cannot become durable;
 *   - I2b-S10: ONE deadline covers checkout, BEGIN, the statement AND the
 *     COMMIT round trip (`deadlineMs`, shortened to the request budget;
 *     `commitDeadlineMs` may only tighten the COMMIT phase). A COMMIT that
 *     does not answer in time, errors, or answers with any tag other than
 *     "COMMIT" (Postgres answers ROLLBACK on an aborted transaction) is
 *     StoreUnavailableError, never a success; the connection is destroyed.
 *     The only case in which a write reported as failed may have landed is
 *     a COMMIT that reached the server but whose answer did not come back
 *     in time -- callers must treat a failure as "outcome unknown".
 * Every failure is StoreUnavailableError; a connection whose transaction
 * state is uncertain is destroyed, never returned to the pool.
 */
export function boundedStatement<R>(pool: BoundedPool, text: string, params: unknown[] | undefined, o: BoundedStatementOptions): Promise<QueryResultLike<R>> {
  const begin = beginText(o);
  const deadlineMs = budgetedDeadlineMs(o.deadlineMs);
  if (deadlineMs <= 0) return Promise.reject(new StoreUnavailableError('timeout'));
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    let settled = false;
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
      destroyClient(c);
    };
    // One clock for every phase, COMMIT included (I2b-S10).
    const timer = setTimeout(() => {
      fail('timeout');
      destroy(client);
    }, deadlineMs);
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
        if (o.commitDeadlineMs !== undefined) {
          const left = deadlineMs - (Date.now() - startedAt);
          commitTimer = setTimeout(() => {
            fail('timeout');
            destroy(c);
          }, Math.max(0, Math.min(o.commitDeadlineMs, left)));
        }
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
        clearTimeout(timer);
        if (commitTimer) clearTimeout(commitTimer);
        resolve(r);
      } catch {
        destroy(client);
        fail('error');
      }
    })();
  });
}

/**
 * Outcome of committing a held transaction:
 *   - 'committed': the server confirmed COMMIT (command tag "COMMIT");
 *   - 'not_committed': COMMIT was never sent (aborted, hold expired, or the
 *     connection had already failed) -- the transaction is rolled back by
 *     the server when the connection ends, so its write did NOT land;
 *   - 'unknown': COMMIT was sent but not confirmed in time (or answered
 *     ROLLBACK / an error) -- it may or may not have landed.
 */
export type HeldCommitOutcome = 'committed' | 'not_committed' | 'unknown';

export interface HeldTransaction<R> {
  readonly result: QueryResultLike<R>;
  /** Sends COMMIT (bounded by `deadlineMs`). Never throws. Only the first call (or abort) counts. */
  commit(deadlineMs: number): Promise<HeldCommitOutcome>;
  /** Abandons the transaction WITHOUT committing: the connection is destroyed, so the server rolls it back. Idempotent; never throws. */
  abort(): void;
}

/**
 * AURA-MCP-02-I2b-S10 -- like `boundedStatement`, but the transaction stays
 * OPEN after the statement, holding its row locks, until the caller decides:
 * `commit()` or `abort()`. If neither happens within `holdMs` the
 * transaction is aborted automatically; if this process freezes or dies,
 * `idle_in_transaction_session_timeout` (server side) or the dropped
 * connection rolls it back. Nothing is written unless the caller commits.
 * Phase 1 (checkout + BEGIN + statement) is bounded by `deadlineMs` (and the
 * request budget) and rejects with StoreUnavailableError on any failure.
 */
export function heldStatement<R>(pool: BoundedPool, text: string, params: unknown[] | undefined, o: BoundedStatementOptions & { holdMs: number }): Promise<HeldTransaction<R>> {
  if (!Number.isInteger(o.holdMs) || o.holdMs < 1) return Promise.reject(new TypeError('holdMs must be a positive integer'));
  const begin = beginText(o);
  const deadlineMs = budgetedDeadlineMs(o.deadlineMs);
  if (deadlineMs <= 0) return Promise.reject(new StoreUnavailableError('timeout'));
  return new Promise((resolve, reject) => {
    let settled = false;
    let client: BoundedClient | undefined;
    const fail = (reason: 'timeout' | 'error') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (client) destroyClient(client);
      reject(new StoreUnavailableError(reason));
    };
    const timer = setTimeout(() => fail('timeout'), deadlineMs);
    (async () => {
      try {
        const c = await pool.connect();
        if (settled) {
          c.release();
          return;
        }
        client = c;
        await c.query(begin);
        const r = await c.query<R>(text, params);
        if (settled) return; // already failed: fail() destroyed the connection (rollback)
        settled = true;
        clearTimeout(timer);
        let decided = false;
        const holdTimer = setTimeout(() => abort(), o.holdMs);
        (holdTimer as { unref?: () => void }).unref?.();
        function abort(): void {
          if (decided) return;
          decided = true;
          clearTimeout(holdTimer);
          destroyClient(c);
        }
        resolve({
          result: r,
          abort,
          commit(commitMs: number): Promise<HeldCommitOutcome> {
            if (decided) return Promise.resolve('not_committed');
            decided = true;
            clearTimeout(holdTimer);
            return new Promise<HeldCommitOutcome>((done) => {
              let answered = false;
              const answer = (v: HeldCommitOutcome) => {
                if (answered) return;
                answered = true;
                clearTimeout(t);
                done(v);
              };
              const t = setTimeout(() => {
                destroyClient(c);
                answer('unknown');
              }, Math.max(1, commitMs));
              c.query('COMMIT').then(
                (res) => {
                  if (answered) {
                    destroyClient(c); // late answer: the connection is already discarded
                    return;
                  }
                  if (commitConfirmed(res)) {
                    try {
                      c.release();
                    } catch {
                      // ignore
                    }
                    answer('committed');
                  } else {
                    destroyClient(c);
                    answer('unknown');
                  }
                },
                () => {
                  destroyClient(c);
                  answer('unknown');
                },
              );
            });
          },
        });
      } catch {
        fail('error');
      }
    })();
  });
}
