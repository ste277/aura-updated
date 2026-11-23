import type { PgQueryable } from '../auth/postgresAdapter';
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
 *   - windows are never reset early: a window row is replaced only once it
 *     has expired, and only expired rows are ever deleted;
 *   - storage is bounded by live keys; expired rows are removed in bounded
 *     batches (`cleanupExpired`).
 *
 * Failure policy: if the database is unavailable the decision is DENY
 * (`limitedBy: "unavailable"`) -- fail closed.
 */
export interface PgPoolLike extends PgQueryable {
  connect(): Promise<PgQueryable & { release(err?: unknown): void }>;
}

export interface PostgresRateLimiterOptions {
  pool: PgPoolLike;
  windowMs: number;
  /** Run cleanupExpired about once every N admitted decisions (default 500; 0 disables). */
  cleanupEvery?: number;
}

export interface PostgresRateLimiter extends McpRateLimiter {
  check(rules: readonly RateLimitRule[]): Promise<RateLimitDecision>;
  cleanupExpired(batch?: number): Promise<number>;
}

const TABLE = '"McpRateLimitWindow"';

export function createPostgresRateLimiter(options: PostgresRateLimiterOptions): PostgresRateLimiter {
  const { pool, windowMs } = options;
  if (!Number.isFinite(windowMs) || windowMs < 1000) throw new TypeError('windowMs must be at least 1000');
  const cleanupEvery = options.cleanupEvery ?? 500;
  let admitted = 0;

  async function cleanupExpired(batch = 500): Promise<number> {
    const r = await pool.query(`DELETE FROM ${TABLE} WHERE ctid IN (SELECT ctid FROM ${TABLE} WHERE "expiresAt" < now() LIMIT $1)`, [batch]);
    return r.rowCount ?? 0;
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
    const seconds = Math.ceil(windowMs / 1000);

    let client: (PgQueryable & { release(err?: unknown): void }) | undefined;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      // Make sure a row exists for every key, then lock them all in order.
      // An expired window is restarted in place (never before it expires).
      for (const key of keys) {
        await client.query(
          `INSERT INTO ${TABLE} ("key", "windowStart", "count", "expiresAt") VALUES ($1, now(), 0, now() + make_interval(secs => $2::int))
           ON CONFLICT ("key") DO UPDATE SET "windowStart" = now(), "count" = 0, "expiresAt" = now() + make_interval(secs => $2::int)
           WHERE ${TABLE}."expiresAt" <= now()`,
          [key, seconds],
        );
      }
      const locked = await client.query<{ key: string; count: number; retry: string }>(
        `SELECT "key", "count", GREATEST(1, CEIL(EXTRACT(EPOCH FROM ("expiresAt" - now()))))::text AS retry
         FROM ${TABLE} WHERE "key" = ANY($1::text[]) ORDER BY "key" FOR UPDATE`,
        [keys],
      );
      let limitedBy: string | undefined;
      let retryAfterSeconds = 0;
      for (const row of locked.rows) {
        const limit = byKey.get(row.key) as number;
        if (row.count >= limit) {
          const retry = Number(row.retry);
          if (retry >= retryAfterSeconds) {
            retryAfterSeconds = retry;
            limitedBy = row.key.split(':')[0];
          }
        }
      }
      if (limitedBy !== undefined || locked.rows.length !== keys.length) {
        await client.query('ROLLBACK');
        return { allowed: false, retryAfterSeconds: Math.max(1, retryAfterSeconds), limitedBy: limitedBy ?? 'unavailable' };
      }
      await client.query(`UPDATE ${TABLE} SET "count" = "count" + 1 WHERE "key" = ANY($1::text[])`, [keys]);
      await client.query('COMMIT');
      admitted += 1;
      if (cleanupEvery > 0 && admitted % cleanupEvery === 0) cleanupExpired().catch(() => undefined);
      return { allowed: true, retryAfterSeconds: 0 };
    } catch {
      try {
        await client?.query('ROLLBACK');
      } catch {
        // ignore
      }
      // Fail closed: a limiter that cannot decide denies.
      return { allowed: false, retryAfterSeconds: 1, limitedBy: 'unavailable' };
    } finally {
      client?.release();
    }
  }

  return { check, cleanupExpired };
}
