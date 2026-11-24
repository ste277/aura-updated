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

/**
 * AURA-MCP-02-I2b-S11 (S10 review P3-1): every database deadline is an
 * ABSOLUTE instant on a MONOTONIC clock (performance.now), checked
 * explicitly at transaction boundaries -- not only by timer callbacks, which
 * a stalled event loop can delay. Tests may substitute the clock.
 */
let clock: () => number = () => performance.now();
export function monotonicNow(): number {
  return clock();
}
/** Test hook: replace (or with null, restore) the monotonic clock. */
export function setDeadlineClockForTests(fn: (() => number) | null): void {
  clock = fn ?? (() => performance.now());
}

export function runWithRequestBudget<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  if (!Number.isInteger(ms) || ms < 1) throw new TypeError('request budget must be a positive integer');
  return budgetStore.run({ deadlineAt: monotonicNow() + ms }, fn);
}

/** Runs `fn` outside any request budget (work that must not be cut short by the request's budget). */
export function outsideRequestBudget<T>(fn: () => T): T {
  return budgetStore.exit(fn);
}

/** Time left in the current request budget, ms (Infinity outside a budget; never negative). */
export function requestBudgetRemainingMs(): number {
  const b = budgetStore.getStore();
  return b ? Math.max(0, b.deadlineAt - monotonicNow()) : Infinity;
}

/** A store-call deadline shortened to the current request budget. 0 = already spent. */
export function budgetedDeadlineMs(ms: number): number {
  return Math.min(ms, requestBudgetRemainingMs());
}

/**
 * I2b-S12 (S11 review R-P3-1): the ABSOLUTE deadline instant of a store call:
 * min(now + own deadline, the request budget's ORIGINAL instant). The budget
 * instant is used as stored -- never rebuilt from a "remaining" sample and a
 * later clock read, which could stretch the parent budget by the gap.
 */
export function budgetedDeadlineAt(ms: number, now = monotonicNow()): number {
  const b = budgetStore.getStore();
  return Math.min(now + ms, b ? b.deadlineAt : Infinity);
}

/** I2b-S12: the ONE expiry comparison used at every boundary -- expired at or after the instant. */
export function expiredAt(at: number, now = monotonicNow()): boolean {
  return now >= at;
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
  /** node-pg clients are EventEmitters: a checked-out client emits 'error' when its connection dies. */
  on?(event: 'error', listener: (err: unknown) => void): unknown;
  off?(event: 'error', listener: (err: unknown) => void): unknown;
}

/**
 * AURA-MCP-02-I2b-S11 (S10 review P2-1): node-pg removes the pool's
 * idle-client 'error' listener when a client is checked out, so a server-side
 * termination (idle-in-transaction timeout, administrator command, network
 * loss) of a CHECKED-OUT client emits an 'error' event with no listener --
 * an uncaught exception that ends the process. `guardClient` attaches ONE
 * listener at checkout for the whole checkout-to-release lifecycle:
 *   - `releaseClean()` removes exactly that listener, then returns the client
 *     to the pool (which re-installs its own idle listener) -- no leak;
 *   - `discard()` destroys the connection and deliberately LEAVES the
 *     listener attached: a dying socket can still emit after release, and
 *     the pool drops a client released with an error, so the listener goes
 *     away with the discarded client object;
 *   - the first 'error' marks the client broken and runs `onError` (once).
 * Clients without `on` (test fakes) are handled the same way minus the
 * listener.
 */
export function guardClient(c: BoundedClient, onError: (err: unknown) => void): { readonly broken: boolean; releaseClean(): void; discard(): void } {
  let broken = false;
  let done = false;
  const listener = (err: unknown) => {
    if (broken) return;
    broken = true;
    try {
      onError(err);
    } catch {
      // never rethrow from an 'error' listener
    }
  };
  c.on?.('error', listener);
  return {
    get broken() {
      return broken;
    },
    releaseClean() {
      if (done) return;
      done = true;
      if (broken) {
        destroyClient(c);
        return;
      }
      c.off?.('error', listener);
      try {
        c.release();
      } catch {
        // ignore
      }
    },
    discard() {
      if (done) return;
      done = true;
      destroyClient(c);
    },
  };
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
  // I2b-S11/S12: one ABSOLUTE monotonic deadline for every phase, taken from
  // the original request-budget instant (never reconstructed).
  const startedAt = monotonicNow();
  const deadlineAt = budgetedDeadlineAt(o.deadlineMs, startedAt);
  if (expiredAt(deadlineAt, startedAt)) return Promise.reject(new StoreUnavailableError('timeout'));
  const deadlineMs = deadlineAt - startedAt;
  const expired = (at: number) => expiredAt(at);
  return new Promise((resolve, reject) => {
    let settled = false;
    let guard: ReturnType<typeof guardClient> | undefined;
    let commitTimer: ReturnType<typeof setTimeout> | undefined;
    const fail = (reason: 'timeout' | 'error') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (commitTimer) clearTimeout(commitTimer);
      guard?.discard(); // an uncertain connection is never reused
      reject(new StoreUnavailableError(reason));
    };
    // The timer only WAKES us; the explicit checks below decide.
    const timer = setTimeout(() => fail('timeout'), deadlineMs);
    (async () => {
      try {
        const c = await pool.connect();
        if (settled || expired(deadlineAt)) {
          // Late checkout: never used, so it is clean -- return it unused.
          try {
            c.release();
          } catch {
            // ignore
          }
          fail('timeout');
          return;
        }
        guard = guardClient(c, () => fail('error'));
        await c.query(begin);
        const r = await c.query<R>(text, params);
        // Pre-COMMIT check: past the deadline (even if its timer has not
        // run yet) the work is abandoned -- discarding the connection rolls
        // the transaction back. COMMIT is never sent late.
        if (settled || guard.broken || expired(deadlineAt)) {
          fail('timeout');
          return;
        }
        let commitAt = deadlineAt;
        if (o.commitDeadlineMs !== undefined) {
          commitAt = Math.min(deadlineAt, monotonicNow() + o.commitDeadlineMs);
          commitTimer = setTimeout(() => fail('timeout'), Math.max(0, commitAt - monotonicNow()));
        }
        const done = await c.query('COMMIT');
        if (settled) return;
        if (!commitConfirmed(done)) {
          fail('error'); // e.g. ROLLBACK tag: never a success
          return;
        }
        // A confirmed but LATE acknowledgement is reported as failure: the
        // caller must treat the outcome as unknown (it did land).
        if (expired(commitAt)) {
          settled = true;
          clearTimeout(timer);
          if (commitTimer) clearTimeout(commitTimer);
          guard.releaseClean(); // the transaction is finished; the connection is clean
          reject(new StoreUnavailableError('timeout'));
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (commitTimer) clearTimeout(commitTimer);
        guard.releaseClean();
        resolve(r);
      } catch {
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
  const startedAt = monotonicNow();
  const deadlineAt = budgetedDeadlineAt(o.deadlineMs, startedAt);
  if (expiredAt(deadlineAt, startedAt)) return Promise.reject(new StoreUnavailableError('timeout'));
  const deadlineMs = deadlineAt - startedAt;
  return new Promise((resolve, reject) => {
    let settled = false;
    let guard: ReturnType<typeof guardClient> | undefined;
    // After phase 1: COMMIT sent? (an error before it means the server rolled back)
    let commitSent = false;
    let decided = false;
    let holdTimer: ReturnType<typeof setTimeout> | undefined;
    const fail = (reason: 'timeout' | 'error') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      guard?.discard();
      reject(new StoreUnavailableError(reason));
    };
    const timer = setTimeout(() => fail('timeout'), deadlineMs);
    (async () => {
      try {
        const c = await pool.connect();
        if (settled || expiredAt(deadlineAt)) {
          try {
            c.release();
          } catch {
            // ignore
          }
          fail('timeout');
          return;
        }
        // P2-1: one listener for the whole hold. A connection that dies while
        // held (idle-in-transaction timeout, terminated backend) is discarded;
        // the server has rolled the uncommitted activation back.
        guard = guardClient(c, () => {
          if (!settled) {
            fail('error');
            return;
          }
          if (!commitSent) {
            decided = true;
            clearTimeout(holdTimer);
          }
          guard?.discard();
        });
        const g = guard;
        await c.query(begin);
        const r = await c.query<R>(text, params);
        if (settled || g.broken || expiredAt(deadlineAt)) {
          fail('timeout');
          return;
        }
        settled = true;
        clearTimeout(timer);
        const holdAt = monotonicNow() + o.holdMs;
        holdTimer = setTimeout(() => abort(), o.holdMs);
        (holdTimer as { unref?: () => void }).unref?.();
        function abort(): void {
          if (decided) return;
          decided = true;
          clearTimeout(holdTimer);
          g.discard();
        }
        resolve({
          result: r,
          abort,
          commit(commitMs: number): Promise<HeldCommitOutcome> {
            if (decided || g.broken) return Promise.resolve('not_committed');
            // P3-1: a hold whose timer has not run yet but whose instant has passed is abandoned.
            if (expiredAt(holdAt)) {
              abort();
              return Promise.resolve('not_committed');
            }
            decided = true;
            clearTimeout(holdTimer);
            const commitAt = monotonicNow() + Math.max(1, commitMs);
            return new Promise<HeldCommitOutcome>((done) => {
              let answered = false;
              const answer = (v: HeldCommitOutcome) => {
                if (answered) return;
                answered = true;
                clearTimeout(t);
                done(v);
              };
              const t = setTimeout(() => {
                g.discard();
                answer('unknown');
              }, Math.max(1, commitMs));
              commitSent = true;
              c.query('COMMIT').then(
                (res) => {
                  if (answered) {
                    g.discard(); // late answer: the connection is already discarded
                    return;
                  }
                  if (!commitConfirmed(res)) {
                    g.discard();
                    answer('unknown');
                    return;
                  }
                  g.releaseClean();
                  // Confirmed, but past its bound: report "unknown" (it landed) -- never a silent late success.
                  answer(expiredAt(commitAt) ? 'unknown' : 'committed');
                },
                () => {
                  g.discard();
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
