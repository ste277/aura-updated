/**
 * AURA-AUTH-SESSION-01-I1 -- database-enforced bounds for session storage
 * (AURA_AUTH_SESSION_01_REVOCATION_DESIGN.md §8.1).
 *
 * A JavaScript Promise timeout alone leaves the statement running on the
 * server and the connection checked out. Every session operation is therefore
 * bounded in three layers:
 *
 *   L1 acquire  -- a dedicated small pool ("aura-session") with a bounded
 *                  connection wait, so session checks never queue without
 *                  limit or behind slow application queries.
 *   L2 server   -- ONE simple-query message:
 *                    BEGIN; SET LOCAL statement_timeout; SET LOCAL lock_timeout;
 *                    <statement>; COMMIT
 *                  PostgreSQL itself cancels the statement (57014) or the lock
 *                  wait (55P03), freeing backend CPU, locks and snapshot. The
 *                  settings are transaction-local, so they hold through a
 *                  transaction-mode pooler, at the cost of one round trip.
 *   L3 client   -- ONE absolute, monotonic caller deadline over acquire +
 *                  send + result (R1, 39232-01). Every phase is limited by the
 *                  budget that REMAINS: the acquisition wait, and the SET LOCAL
 *                  statement/lock timeouts, are min(phase maximum, remaining).
 *                  A caller may pass its own deadlineAt (e.g. revoke's retry),
 *                  which can only shorten, never extend, the budget. When the
 *                  deadline passes, the connection is DISCARDED (release(err)),
 *                  never returned to the pool, and a late result is never used.
 *
 * Every failure states its outcome (sessionErrors.ts): 'failed' when the
 * statement was never sent or PostgreSQL rejected it before COMMIT, and
 * 'uncertain' when it was sent and the result is unknown.
 *
 * Any failure becomes SessionVerificationUnavailableError (fail closed). A
 * connection that saw any error is discarded; closing it makes the server roll
 * back whatever was open. The pattern follows the MCP I2b deadline module but
 * is reimplemented here so session code does not depend on MCP code.
 *
 * Values are inlined (simple query protocol), so they pass ONLY through
 * sqlLiteral()/sqlInteger(), which accept nothing outside strict patterns.
 *
 * DORMANT: nothing in the application imports this module yet
 * (test/authSessionDormancy.test.ts). No pool is created at import; there is
 * no environment read here.
 */
import { performance } from 'perf_hooks';
import { Pool, type PoolClient, type QueryResult } from 'pg';
import {
  SessionVerificationUnavailableError,
  type SessionOperationOutcome,
  type SessionUnavailableReason,
} from './sessionErrors';
import { SESSION_ID_HASH_PATTERN, SESSION_TTL_HOURS, USER_ID_PATTERN } from './authSessionToken';

export const SESSION_POOL_APPLICATION_NAME = 'aura-session';

/** L1: dedicated pool bounds (five connections; 500 ms acquisition). */
export const SESSION_POOL_BOUNDS = Object.freeze({ max: 5, connectionTimeoutMillis: 500, idleTimeoutMillis: 10_000 });

/**
 * Fixed 30-day lifetime = 720 ELAPSED hours (R1). An hours interval is added
 * to a timestamptz as absolute time, independent of the session TimeZone; a
 * days interval would follow the calendar and give 719 / 721 hours across a
 * daylight-saving transition.
 */
export const SESSION_TTL_SQL = `make_interval(hours => ${SESSION_TTL_HOURS})`;

/**
 * Per-operation MAXIMUM budgets (design §8.1, ticket). They are maxima, not
 * cumulative allowances: each phase is additionally limited by what remains of
 * the caller deadline.
 */
export interface SessionQueryBounds {
  /** L1: maximum wait for a pooled connection, ms. */
  acquireTimeoutMs?: number;
  /** L2: maximum server-side statement_timeout, ms. */
  statementTimeoutMs: number;
  /** L2: maximum server-side lock_timeout, ms. */
  lockTimeoutMs: number;
  /** L3: the whole operation's absolute deadline, ms from its start. */
  deadlineMs: number;
}

export const SESSION_ACQUIRE_TIMEOUT_MS = 500;

/** Lookup: acquire 500, lock 250, statement 1 000, caller deadline 2 000 ms. */
export const SESSION_LOOKUP_BOUNDS: Readonly<Required<SessionQueryBounds>> = Object.freeze({ acquireTimeoutMs: 500, lockTimeoutMs: 250, statementTimeoutMs: 1000, deadlineMs: 2000 });
/** Foreground writes (create / revoke): acquire 500, lock 1 000, statement 1 500, caller deadline 2 000 ms. */
export const SESSION_WRITE_BOUNDS: Readonly<Required<SessionQueryBounds>> = Object.freeze({ acquireTimeoutMs: 500, lockTimeoutMs: 1000, statementTimeoutMs: 1500, deadlineMs: 2000 });
/** Background cleanup (never on an interactive path): acquire 500, lock 1 000, statement 5 000, caller deadline 6 000 ms. */
export const SESSION_CLEANUP_BOUNDS: Readonly<Required<SessionQueryBounds>> = Object.freeze({ acquireTimeoutMs: 500, lockTimeoutMs: 1000, statementTimeoutMs: 5000, deadlineMs: 6000 });

export const SESSION_REVOKE_REASONS = ['logout', 'logout_all', 'account_deleted', 'admin'] as const;
export type SessionRevokeReason = (typeof SESSION_REVOKE_REASONS)[number];

/** A monotonic clock with timers. Injected only by controlled-clock tests. */
export interface SessionClock {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export const SYSTEM_SESSION_CLOCK: SessionClock = Object.freeze({
  now: () => performance.now(),
  setTimer: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimer: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
});

export interface SessionQueryOptions {
  /** Absolute deadline on `clock` (monotonic ms). Can only shorten the operation's own budget. */
  deadlineAt?: number;
  clock?: SessionClock;
}

function boundedInt(name: string, value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function checkBounds(b: SessionQueryBounds): Required<SessionQueryBounds> {
  return {
    acquireTimeoutMs: boundedInt('acquireTimeoutMs', b.acquireTimeoutMs ?? SESSION_ACQUIRE_TIMEOUT_MS, 1, 10_000),
    statementTimeoutMs: boundedInt('statementTimeoutMs', b.statementTimeoutMs, 1, 30_000),
    lockTimeoutMs: boundedInt('lockTimeoutMs', b.lockTimeoutMs, 1, 30_000),
    deadlineMs: boundedInt('deadlineMs', b.deadlineMs, 1, 60_000),
  };
}

/**
 * Creates the dedicated session pool. Called by its owner (I2 wiring, or a
 * test) -- never at import. `overrides` exists for tests only and is bounded.
 */
export function createSessionPool(
  connectionString: string,
  overrides: Partial<{ max: number; connectionTimeoutMillis: number; idleTimeoutMillis: number }> = {}
): Pool {
  if (typeof connectionString !== 'string' || connectionString.length === 0) {
    throw new TypeError('A database connection string is required.');
  }
  const pool = new Pool({
    connectionString,
    max: boundedInt('max', overrides.max ?? SESSION_POOL_BOUNDS.max, 1, 20),
    connectionTimeoutMillis: boundedInt('connectionTimeoutMillis', overrides.connectionTimeoutMillis ?? SESSION_POOL_BOUNDS.connectionTimeoutMillis, 50, 10_000),
    idleTimeoutMillis: boundedInt('idleTimeoutMillis', overrides.idleTimeoutMillis ?? SESSION_POOL_BOUNDS.idleTimeoutMillis, 100, 60_000),
    application_name: SESSION_POOL_APPLICATION_NAME,
  });
  // An idle client that errors (server restart, terminated backend) must not
  // crash the process. Log the class only -- never a message, which can quote values.
  pool.on('error', (err) => {
    console.error(`[auth-session] pool client error (${err instanceof Error ? err.name : 'Error'})`);
  });
  return pool;
}

// --- Literals (the only way a value reaches session SQL) ---------------------

export type SessionLiteralKind = 'idHash' | 'userId' | 'reason';

/**
 * A single-quoted SQL literal for a value that has passed a strict pattern.
 * None of the accepted alphabets contain a quote, backslash or NUL, so the
 * quoting cannot be escaped. Anything else throws before SQL is built.
 */
export function sqlLiteral(value: unknown, kind: SessionLiteralKind): string {
  if (typeof value !== 'string') throw new TypeError(`Invalid ${kind}.`);
  const ok =
    kind === 'idHash'
      ? SESSION_ID_HASH_PATTERN.test(value)
      : kind === 'userId'
        ? USER_ID_PATTERN.test(value)
        : (SESSION_REVOKE_REASONS as readonly string[]).includes(value);
  if (!ok) throw new TypeError(`Invalid ${kind}.`);
  return `'${value}'`;
}

export function sqlInteger(value: unknown, min: number, max: number): string {
  if (typeof value !== 'number') throw new TypeError('Invalid integer.');
  return String(boundedInt('value', value, min, max));
}

// --- Bounded execution -------------------------------------------------------

/** SQLSTATE classes PostgreSQL raises BEFORE COMMIT takes effect: the transaction did not commit. */
const CONFIRMED_FAILURE_CLASSES = ['22', '23', '25', '40', '42', '0A'];

/** Classifies an error raised AFTER the message was sent. */
function classifySent(err: unknown): SessionVerificationUnavailableError {
  if (err instanceof SessionVerificationUnavailableError) return err;
  const code = (err as { code?: unknown } | null)?.code;
  if (code === '57014') return new SessionVerificationUnavailableError('statement_timeout', 'failed');
  if (code === '55P03') return new SessionVerificationUnavailableError('lock_timeout', 'failed');
  if (typeof code === 'string' && code.startsWith('23')) return new SessionVerificationUnavailableError('constraint', 'failed');
  if (typeof code === 'string' && CONFIRMED_FAILURE_CLASSES.includes(code.slice(0, 2))) {
    return new SessionVerificationUnavailableError('driver', 'failed');
  }
  // No SQLSTATE (socket / protocol error), connection exceptions (08),
  // operator intervention (57P), internal errors: the COMMIT may have run.
  return new SessionVerificationUnavailableError('driver', 'uncertain');
}

/** Classifies an error raised BEFORE anything was sent: always a confirmed failure. */
function classifyUnsent(err: unknown): SessionVerificationUnavailableError {
  if (err instanceof SessionVerificationUnavailableError) return new SessionVerificationUnavailableError(err.reason, 'failed');
  const message = err instanceof Error ? err.message : '';
  // node-pg's own acquisition timeout (connectionTimeoutMillis).
  if (/timeout exceeded when trying to connect/i.test(message)) return new SessionVerificationUnavailableError('acquire', 'failed');
  return new SessionVerificationUnavailableError('driver', 'failed');
}

const TIMED_OUT = Symbol('timed-out');

/** Resolves to TIMED_OUT after `ms` on `clock`; cancel() releases the timer. */
function timeout(clock: SessionClock, ms: number): { promise: Promise<typeof TIMED_OUT>; cancel: () => void } {
  let handle: unknown;
  const promise = new Promise<typeof TIMED_OUT>((resolve) => {
    handle = clock.setTimer(() => resolve(TIMED_OUT), Math.max(0, ms));
  });
  return { promise, cancel: () => clock.clearTimer(handle) };
}

export interface BoundedResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

/**
 * Runs ONE statement under L1-L3 within one absolute deadline. Returns that
 * statement's rows, or throws SessionVerificationUnavailableError with a
 * reason and an outcome ('failed' = confirmed not applied; 'uncertain').
 *
 * `statement` must be built only from fixed SQL plus sqlLiteral()/sqlInteger()
 * values. Exported for lib/authSessionStore.ts and the bound tests only.
 */
export async function boundedSessionQuery(
  pool: Pool,
  statement: string,
  bounds: SessionQueryBounds,
  opts: SessionQueryOptions = {}
): Promise<BoundedResult> {
  const b = checkBounds(bounds);
  if (typeof statement !== 'string' || statement.length === 0 || statement.includes(';')) {
    throw new TypeError('Exactly one statement, without a terminator, is required.');
  }
  const clock = opts.clock ?? SYSTEM_SESSION_CLOCK;
  const startedAt = clock.now();
  const deadlineAt = Math.min(startedAt + b.deadlineMs, opts.deadlineAt ?? Number.POSITIVE_INFINITY);
  const remaining = () => deadlineAt - clock.now();

  // Nothing is sent once the caller's budget is gone.
  if (!(remaining() > 0)) throw new SessionVerificationUnavailableError('deadline', 'failed');

  let client: PoolClient | null = null;
  let abandoned = false;
  let broken: unknown = null;
  const onClientError = (err: unknown) => {
    broken = err ?? new Error('client error');
  };
  const discard = (reason: string) => {
    if (client) {
      // Never return a connection that timed out, errored or may hold an open
      // or aborted transaction. Closing it rolls back on the server. The error
      // listener stays attached to absorb late socket errors.
      client.release(new Error(reason));
      client = null;
    }
  };

  // L1 -- acquire within min(acquisition maximum, remaining budget).
  const connecting = pool.connect();
  connecting.then(
    (c) => {
      if (abandoned) c.release(new Error('session query abandoned during checkout'));
    },
    () => {}
  );
  const acquireWait = Math.min(b.acquireTimeoutMs, remaining());
  const acquireTimer = timeout(clock, acquireWait);
  let acquired: PoolClient | typeof TIMED_OUT;
  try {
    acquired = await Promise.race([connecting, acquireTimer.promise]);
  } catch (err) {
    abandoned = true;
    throw classifyUnsent(err);
  } finally {
    acquireTimer.cancel();
  }
  if (acquired === TIMED_OUT) {
    abandoned = true;
    throw new SessionVerificationUnavailableError(remaining() > 0 ? 'acquire' : 'deadline', 'failed');
  }
  client = acquired;
  client.on('error', onClientError);

  // L2 -- the server-side limits are min(phase maximum, remaining budget).
  const left = Math.floor(remaining());
  if (left < 1) {
    discard('session query deadline reached before send');
    throw new SessionVerificationUnavailableError('deadline', 'failed');
  }
  const statementMs = Math.min(b.statementTimeoutMs, left);
  const lockMs = Math.min(b.lockTimeoutMs, statementMs);
  const text =
    `BEGIN; SET LOCAL statement_timeout = '${statementMs}ms'; ` +
    `SET LOCAL lock_timeout = '${lockMs}ms'; ${statement}; COMMIT`;

  // L3 -- from here the outcome of a failure is uncertain unless PostgreSQL
  // itself reports a confirmed failure.
  const sendTimer = timeout(clock, left);
  let results: QueryResult[] | QueryResult | typeof TIMED_OUT;
  try {
    const running = client.query(text) as unknown as Promise<QueryResult[] | QueryResult>;
    running.catch(() => {});
    results = await Promise.race([running, sendTimer.promise]);
  } catch (err) {
    discard('session query failed');
    throw classifySent(err);
  } finally {
    sendTimer.cancel();
  }
  if (results === TIMED_OUT || remaining() < 0) {
    discard('session query deadline exceeded');
    throw new SessionVerificationUnavailableError('deadline', 'uncertain');
  }
  if (broken) {
    discard('session client error');
    throw new SessionVerificationUnavailableError('driver', 'uncertain');
  }
  if (!Array.isArray(results) || results.length !== 5 || !results[3] || !Array.isArray(results[3].rows)) {
    discard('unexpected session query result shape');
    throw new SessionVerificationUnavailableError('shape', 'uncertain');
  }
  const result = results[3];
  const c = client as PoolClient;
  c.off('error', onClientError);
  c.release();
  client = null;
  return { rows: result.rows as Record<string, unknown>[], rowCount: result.rowCount ?? 0 };
}

/** Maps an error from a caller-owned transaction to the fail-closed error (with its outcome). */
export function toSessionUnavailable(err: unknown): SessionVerificationUnavailableError {
  return classifySent(err);
}

export type { SessionOperationOutcome, SessionUnavailableReason };
