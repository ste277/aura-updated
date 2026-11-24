import type { PgQueryable } from '../auth/postgresAdapter';
import { boundedMs, commitConfirmed, singleFlight, transactionTimeouts } from './deadline';
import type { McpRateLimiter, RateLimitDecision, RateLimitRule } from './rateLimit';

/**
 * AURA-MCP-02-I2b (R1-L1) -- distributed fixed-window rate limiter on the
 * shared Aura Postgres database (table "McpRateLimitWindow", migration 0052).
 *
 * Every instance counts in the same rows, so the limit is global, not
 * per-process. Same guarantees as the in-memory reference limiter
 * (rateLimit.ts), now across instances:
 *   - all-or-nothing: a request is admitted only if EVERY rule is under its
 *     limit; a rejected request consumes nothing;
 *   - one transaction per decision: the rule rows are locked with
 *     SELECT ... FOR UPDATE in a fixed (sorted) key order, so concurrent
 *     decisions on any instance serialise per key and cannot deadlock;
 *   - windows are never reset early: a window is restarted only once it has
 *     expired, and only expired rows are ever deleted;
 *   - storage is bounded by live keys; expired rows are removed in bounded
 *     batches (`cleanupExpired`).
 *
 * I2b-S2 (I2b-1) -- fewer round trips, shorter lock hold. A decision is
 * three round trips whatever the number of rules when the rows exist (the
 * steady state):
 *   1. `BEGIN` + transaction-local timeouts (one simple-protocol message);
 *   2. ONE statement that locks the rows (`FOR UPDATE`, sorted), decides
 *      all-or-nothing, and -- only if every rule is under its limit --
 *      increments them, restarting any window that has expired;
 *   3. COMMIT (admitted) or ROLLBACK (rejected: nothing changes).
 * If a row is missing (a new key, or an expired row removed by cleanup),
 * step 2 changes nothing; the transaction is rolled back and retried with
 * an extra step before it: one `INSERT ... SELECT unnest(keys) ... ON
 * CONFLICT DO NOTHING` creating the missing rows in sorted order (DO NOTHING
 * takes no lock on an existing row). A rejected decision rolls back, so
 * rows it created are discarded.
 * Row locks are therefore held for one statement plus the COMMIT round
 * trip, instead of from the first upsert to COMMIT (previously BEGIN + one
 * upsert per key + SELECT + UPDATE + COMMIT, all under lock).
 *
 * I2b-S2 (I2b-R-2) -- bounded execution, fail closed:
 *   - `SET LOCAL lock_timeout` / `statement_timeout` bound every server-side
 *     wait (transaction-scoped, so safe behind a transaction-mode pooler);
 *   - a client-side decision deadline (`decisionDeadlineMs`) answers DENY
 *     when it expires, whatever the database is doing (hung connection, lock
 *     queue, exhausted pool) and DESTROYS the connection rather than
 *     returning a half-finished transaction to the pool;
 *   - any database error is also a DENY and destroys the connection;
 *   - the opportunistic cleanup is single-flight (never piles up).
 * A denial for these reasons has `limitedBy: "unavailable"`; callers answer
 * 503, not 429 (it is not the client's rate).
 * Edge: if the deadline fires while COMMIT is in flight, the increment may
 * land although the decision was "deny". That only ever over-counts (errs
 * toward deny), never admits extra requests.
 */
export interface PgPoolLike extends PgQueryable {
  connect(): Promise<PgQueryable & { release(err?: unknown): void }>;
}

export interface PostgresRateLimiterOptions {
  pool: PgPoolLike;
  windowMs: number;
  /** Run cleanupExpired about once every N admitted decisions (default 500; 0 disables). */
  cleanupEvery?: number;
  /**
   * Server-side lock wait bound per statement, ms (default 1000). It bounds
   * waits the client has abandoned; the client deadline (below) bounds the
   * answer. Much tighter values turn ordinary bursts on one hot key (queued
   * behind a new row's first insert) into 503s.
   */
  lockTimeoutMs?: number;
  /** Server-side statement bound, ms (default 1000). */
  statementTimeoutMs?: number;
  /** Client-side bound for the whole decision, ms (default 1250, so a deny lands within 1.5 s even with timer jitter). On expiry: deny. */
  decisionDeadlineMs?: number;
  /**
   * I2b-S8 (S3-8): server-side `idle_in_transaction_session_timeout`, ms
   * (default: lockTimeoutMs, i.e. 1000). A process frozen mid-decision
   * (serverless freeze) would otherwise hold its shard row lock until TCP
   * teardown; Postgres now ends that session and releases the lock, so a
   * waiter's own lock_timeout normally outlasts the frozen holder. A live
   * client never idles that long inside a decision: its deadline (1250 ms)
   * has abandoned the transaction by then.
   */
  idleInTransactionTimeoutMs?: number;
}

export interface PostgresRateLimiter extends McpRateLimiter {
  check(rules: readonly RateLimitRule[]): Promise<RateLimitDecision>;
  cleanupExpired(batch?: number): Promise<number>;
}

const TABLE = '"McpRateLimitWindow"';
const UNAVAILABLE: RateLimitDecision = Object.freeze({ allowed: false, retryAfterSeconds: 1, limitedBy: 'unavailable' });
/** Fast path, then INSERT path, then one more INSERT path if cleanup removed a row in between. */
const MAX_ATTEMPTS = 3;

const ENSURE_ROWS = `INSERT INTO ${TABLE} ("key", "windowStart", "count", "expiresAt")
  SELECT k, now(), 0, now() + make_interval(secs => $2::int) FROM unnest($1::text[]) AS k ORDER BY k
  ON CONFLICT ("key") DO NOTHING`;

const DECIDE = `WITH want AS (
    SELECT w."key", w."lim" FROM unnest($1::text[], $2::int[]) AS w("key", "lim")
  ), locked AS (
    SELECT t."key",
           CASE WHEN t."expiresAt" <= now() THEN 0 ELSE t."count" END AS "cnt",
           GREATEST(1, CEIL(EXTRACT(EPOCH FROM (t."expiresAt" - now()))))::int AS "retry"
    FROM ${TABLE} t WHERE t."key" = ANY($1::text[]) ORDER BY t."key" FOR UPDATE
  ), verdict AS (
    SELECT (SELECT count(*) FROM locked) = cardinality($1::text[]) AND COALESCE(bool_and(l."cnt" < w."lim"), false) AS "ok"
    FROM locked l JOIN want w ON w."key" = l."key"
  ), bumped AS (
    UPDATE ${TABLE} t SET
      "count" = CASE WHEN t."expiresAt" <= now() THEN 1 ELSE t."count" + 1 END,
      "windowStart" = CASE WHEN t."expiresAt" <= now() THEN now() ELSE t."windowStart" END,
      "expiresAt" = CASE WHEN t."expiresAt" <= now() THEN now() + make_interval(secs => $3::int) ELSE t."expiresAt" END
    FROM verdict v WHERE v."ok" AND t."key" = ANY($1::text[])
    RETURNING t."key"
  )
  SELECT l."key", l."cnt", l."retry", (SELECT "ok" FROM verdict) AS "ok", (SELECT count(*) FROM bumped)::int AS "bumped" FROM locked l`;

type PooledClient = PgQueryable & { release(err?: unknown): void };

export function createPostgresRateLimiter(options: PostgresRateLimiterOptions): PostgresRateLimiter {
  const { pool, windowMs } = options;
  if (!Number.isFinite(windowMs) || windowMs < 1000) throw new TypeError('windowMs must be at least 1000');
  const cleanupEvery = options.cleanupEvery ?? 500;
  const lockTimeoutMs = boundedMs('lockTimeoutMs', options.lockTimeoutMs, 1000, 10, 10_000);
  const statementTimeoutMs = boundedMs('statementTimeoutMs', options.statementTimeoutMs, 1000, 50, 30_000);
  const decisionDeadlineMs = boundedMs('decisionDeadlineMs', options.decisionDeadlineMs, 1250, 50, 30_000);
  const idleInTransactionTimeoutMs = boundedMs('idleInTransactionTimeoutMs', options.idleInTransactionTimeoutMs, lockTimeoutMs, 100, 60_000);
  // Integers validated above, so interpolation is safe; SET cannot take bind parameters.
  const BEGIN = transactionTimeouts({ statementTimeoutMs, lockTimeoutMs, idleInTransactionTimeoutMs });
  let admitted = 0;

  async function cleanupExpired(batch = 500): Promise<number> {
    const r = await pool.query(`DELETE FROM ${TABLE} WHERE ctid IN (SELECT ctid FROM ${TABLE} WHERE "expiresAt" < now() LIMIT $1)`, [batch]);
    return r.rowCount ?? 0;
  }
  const backgroundCleanup = singleFlight(() => cleanupExpired());

  /**
   * One transaction. `ensureRows` false is the fast path (rows usually
   * exist): BEGIN, DECIDE, COMMIT. Returns null when a row was missing at
   * decision time; the caller retries with `ensureRows` (INSERT first).
   */
  async function attempt(client: PooledClient, ensureRows: boolean, keys: string[], limits: number[], byKey: Map<string, number>, seconds: number): Promise<RateLimitDecision | null> {
    await client.query(BEGIN);
    if (ensureRows) await client.query(ENSURE_ROWS, [keys, seconds]);
    const r = await client.query<{ key: string; cnt: number; retry: number; ok: boolean | null; bumped: number }>(DECIDE, [keys, limits, seconds]);
    if (r.rows.length !== keys.length) {
      // A row is missing (new key, or removed by cleanup after expiry):
      // nothing was changed; release the locks and take the INSERT path.
      await client.query('ROLLBACK');
      return null;
    }
    const ok = r.rows[0]?.ok === true;
    if (ok) {
      if (r.rows.length !== keys.length || r.rows[0].bumped !== keys.length) throw new Error('rate-limit invariant violated');
      // I2b-S8 (S5): admit only on a CONFIRMED commit (tag "COMMIT"); an
      // unconfirmed outcome is a deny, which can only over-count.
      if (!commitConfirmed(await client.query('COMMIT'))) throw new Error('commit not confirmed');
      return { allowed: true, retryAfterSeconds: 0 };
    }
    await client.query('ROLLBACK');
    let limitedBy: string | undefined;
    let retryAfterSeconds = 0;
    for (const row of r.rows) {
      if (row.cnt >= (byKey.get(row.key) as number) && row.retry >= retryAfterSeconds) {
        retryAfterSeconds = row.retry;
        limitedBy = row.key.split(':')[0];
      }
    }
    if (limitedBy === undefined) return null; // nothing over its limit, so a row was missing
    return { allowed: false, retryAfterSeconds: Math.max(1, retryAfterSeconds), limitedBy };
  }

  async function check(rules: readonly RateLimitRule[]): Promise<RateLimitDecision> {
    if (rules.length === 0) return { allowed: true, retryAfterSeconds: 0 };
    for (const r of rules) {
      if (!Number.isInteger(r.limit) || r.limit < 1) throw new TypeError(`invalid limit for ${r.key.split(':')[0]}`);
      if (typeof r.key !== 'string' || r.key.length === 0 || r.key.length > 200) throw new TypeError('invalid rate-limit key');
    }
    // Deduplicate (keep the strictest limit) and sort: fixed lock order.
    const byKey = new Map<string, number>();
    for (const r of rules) byKey.set(r.key, Math.min(r.limit, byKey.get(r.key) ?? Infinity));
    const keys = [...byKey.keys()].sort();
    const limits = keys.map((k) => byKey.get(k) as number);
    const seconds = Math.ceil(windowMs / 1000);

    return new Promise<RateLimitDecision>((resolve) => {
      let answered = false;
      let client: PooledClient | undefined;
      let released = false;
      const answer = (d: RateLimitDecision) => {
        if (answered) return;
        answered = true;
        clearTimeout(timer);
        resolve(d);
      };
      // Ends the connection (pg-pool removes a client released with an error):
      // an abandoned or failed transaction is never reused.
      const destroy = (c: PooledClient | undefined) => {
        if (!c || released) return;
        released = true;
        try {
          c.release(new Error('rate-limit decision abandoned'));
        } catch {
          // already gone
        }
      };
      const timer = setTimeout(() => {
        answer(UNAVAILABLE);
        destroy(client);
      }, decisionDeadlineMs);

      (async () => {
        try {
          const c = await pool.connect();
          if (answered) {
            // The deadline already answered. The late connection was never
            // used (no transaction), so it is clean: return it to the pool.
            c.release();
            return;
          }
          client = c;
          let decision: RateLimitDecision | null = null;
          for (let i = 0; i < MAX_ATTEMPTS && decision === null && !answered; i += 1) decision = await attempt(c, i > 0, keys, limits, byKey, seconds);
          if (answered) {
            destroy(c);
            return;
          }
          released = true;
          c.release();
          if (decision?.allowed) {
            admitted += 1;
            if (cleanupEvery > 0 && admitted % cleanupEvery === 0) backgroundCleanup().catch(() => undefined);
          }
          answer(decision ?? UNAVAILABLE);
        } catch {
          // Fail closed: a limiter that cannot decide denies.
          destroy(client);
          answer(UNAVAILABLE);
        }
      })();
    });
  }

  return { check, cleanupExpired };
}
