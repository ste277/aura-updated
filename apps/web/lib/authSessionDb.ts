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
 *   L3 client   -- one absolute deadline over acquire + send + result. When it
 *                  passes, the connection is DISCARDED (release(err)), never
 *                  returned to the pool, and a late result is never used.
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
import { SessionVerificationUnavailableError, type SessionUnavailableReason } from './sessionErrors';
import { SESSION_ID_HASH_PATTERN, USER_ID_PATTERN } from './authSessionToken';

export const SESSION_POOL_APPLICATION_NAME = 'aura-session';

/** L1: dedicated pool bounds. */
export const SESSION_POOL_BOUNDS = Object.freeze({ max: 5, connectionTimeoutMillis: 500, idleTimeoutMillis: 10_000 });

export interface SessionQueryBounds {
  /** L2: server-side statement_timeout, ms. */
  statementTimeoutMs: number;
  /** L2: server-side lock_timeout, ms. */
  lockTimeoutMs: number;
  /** L3: client-side absolute deadline over acquire + send + result, ms. */
  deadlineMs: number;
}

/** Session lookups: the 2-second budget. */
export const SESSION_LOOKUP_BOUNDS: Readonly<SessionQueryBounds> = Object.freeze({ statementTimeoutMs: 1000, lockTimeoutMs: 250, deadlineMs: 2000 });
/** Create / revoke: may briefly wait behind a B3 FOR SHARE re-check. */
export const SESSION_WRITE_BOUNDS: Readonly<SessionQueryBounds> = Object.freeze({ statementTimeoutMs: 1500, lockTimeoutMs: 1000, deadlineMs: 2000 });
/** Bounded batch cleanup. */
export const SESSION_CLEANUP_BOUNDS: Readonly<SessionQueryBounds> = Object.freeze({ statementTimeoutMs: 5000, lockTimeoutMs: 1000, deadlineMs: 6000 });

export const SESSION_REVOKE_REASONS = ['logout', 'logout_all', 'account_deleted', 'admin'] as const;
export type SessionRevokeReason = (typeof SESSION_REVOKE_REASONS)[number];

function boundedInt(name: string, value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function checkBounds(b: SessionQueryBounds): SessionQueryBounds {
  return {
    statementTimeoutMs: boundedInt('statementTimeoutMs', b.statementTimeoutMs, 10, 30_000),
    lockTimeoutMs: boundedInt('lockTimeoutMs', b.lockTimeoutMs, 10, 30_000),
    deadlineMs: boundedInt('deadlineMs', b.deadlineMs, 10, 60_000),
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

function classify(err: unknown): SessionUnavailableReason {
  if (err instanceof SessionVerificationUnavailableError) return err.reason;
  const code = (err as { code?: unknown } | null)?.code;
  if (code === '57014') return 'statement_timeout';
  if (code === '55P03') return 'lock_timeout';
  if (typeof code === 'string' && code.startsWith('23')) return 'constraint';
  const message = err instanceof Error ? err.message : '';
  // node-pg's own acquisition timeout (connectionTimeoutMillis).
  if (/timeout exceeded when trying to connect/i.test(message)) return 'acquire';
  return 'driver';
}

class DeadlineExceeded extends Error {}

export interface BoundedResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

/**
 * Runs ONE statement under L1-L3. Returns that statement's rows.
 *
 * `statement` must be built only from fixed SQL plus sqlLiteral()/sqlInteger()
 * values. Exported for lib/authSessionStore.ts and the bound tests only.
 */
export async function boundedSessionQuery(pool: Pool, statement: string, bounds: SessionQueryBounds): Promise<BoundedResult> {
  const b = checkBounds(bounds);
  if (typeof statement !== 'string' || statement.length === 0 || statement.includes(';')) {
    throw new TypeError('Exactly one statement, without a terminator, is required.');
  }
  const deadlineAt = performance.now() + b.deadlineMs;
  const remaining = () => Math.max(0, deadlineAt - performance.now());

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineExceeded()), b.deadlineMs);
  });

  let client: PoolClient | null = null;
  let abandoned = false;
  let broken: unknown = null;
  const onClientError = (err: unknown) => {
    broken = err ?? new Error('client error');
  };

  try {
    // L1 -- acquire, within both the pool bound and the overall deadline.
    const connecting = pool.connect();
    connecting.then(
      (c) => {
        if (abandoned) c.release(new Error('session query abandoned during checkout'));
      },
      () => {}
    );
    client = await Promise.race([connecting, deadline]);
    if (remaining() === 0) throw new DeadlineExceeded();
    client.on('error', onClientError);

    // L2 -- one message; PostgreSQL enforces the timeouts itself.
    const text =
      `BEGIN; SET LOCAL statement_timeout = '${b.statementTimeoutMs}ms'; ` +
      `SET LOCAL lock_timeout = '${b.lockTimeoutMs}ms'; ${statement}; COMMIT`;
    const running = client.query(text) as unknown as Promise<QueryResult[] | QueryResult>;
    running.catch(() => {});
    const results = await Promise.race([running, deadline]);

    // L3 -- a result that arrives after the deadline is never used.
    if (remaining() === 0) throw new DeadlineExceeded();
    if (broken) throw broken;
    if (!Array.isArray(results) || results.length !== 5) throw new SessionVerificationUnavailableError('shape');
    const result = results[3];
    if (!result || !Array.isArray(result.rows)) throw new SessionVerificationUnavailableError('shape');

    client.off('error', onClientError);
    client.release();
    client = null;
    return { rows: result.rows as Record<string, unknown>[], rowCount: result.rowCount ?? 0 };
  } catch (err) {
    abandoned = true;
    if (client) {
      // Discard: never return a connection that timed out, errored or may hold
      // an open or aborted transaction. Closing it rolls back on the server.
      // The error listener stays attached to absorb late socket errors.
      client.release(err instanceof Error ? err : new Error('session query failed'));
      client = null;
    }
    if (err instanceof DeadlineExceeded) throw new SessionVerificationUnavailableError('deadline');
    throw new SessionVerificationUnavailableError(classify(err));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Maps an error from a caller-owned transaction to the fail-closed error. */
export function toSessionUnavailable(err: unknown): SessionVerificationUnavailableError {
  return err instanceof SessionVerificationUnavailableError ? err : new SessionVerificationUnavailableError(classify(err));
}
