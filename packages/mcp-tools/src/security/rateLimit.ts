/**
 * AURA-MCP-02-I2a / I2a-R1 -- rate-limit hook for the remote MCP endpoint.
 *
 * The handler depends only on the `McpRateLimiter` interface and passes one
 * rule per bucket, each with its own limit (remoteMcpHandler builds a
 * per-user bucket and a much larger per-client ceiling, so one user's
 * traffic can never exhaust another user's allowance -- F2).
 *
 * The in-memory fixed-window implementation below is the local/dev
 * implementation and the reference behaviour for tests. Guarantees (F3/F4):
 *   - a request is allowed only if EVERY rule is under its limit, and a
 *     rejected request consumes nothing and creates no state;
 *   - an active (unexpired) window is NEVER evicted, so eviction can never
 *     reset a limit;
 *   - memory is bounded by `maxKeys`. When the table is full of active
 *     windows, requests that would need a NEW key are rejected
 *     (`limitedBy: "capacity"`) -- fail closed, never fail open.
 *
 * It is process-local (per serverless instance), so it is NOT sufficient
 * for a multi-instance deployment: a durable, shared store is an I2b
 * prerequisite.
 */

export interface RateLimitRule {
  /** Namespaced key, e.g. `user:<id>` or `client:<id>`. */
  key: string;
  /** Max requests for this key per window. */
  limit: number;
}

/** I2b-S12: the bounded set of limiter failure causes (also the only values the audit sink accepts). */
export const LIMITER_UNAVAILABLE_CAUSES = ['deadline', 'commit_timeout', 'commit_late', 'commit_lost', 'commit_failed', 'checkout', 'driver', 'internal'] as const;
export type LimiterUnavailableCause = (typeof LIMITER_UNAVAILABLE_CAUSES)[number];

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the most-constrained key has budget again (>= 1 when rejected). */
  retryAfterSeconds: number;
  /** Which namespace rejected the request ("user", "client" or "capacity"), for audit only. */
  limitedBy?: string;
  /**
   * I2b-S11 / S12 (S10 review P2-3, S11 review R-P2-2), diagnostics only, set
   * when `limitedBy` is "unavailable" (the caller's answer is the same
   * fail-closed 503 in every case). A bounded code, never a raw error:
   *   - "deadline"          the absolute decision deadline was reached with NO
   *                         COMMIT sent (incl. after a ROLLBACK acknowledgement
   *                         or before a retry): expected load shedding, nothing
   *                         was counted;
   *   - "commit_timeout"    COMMIT was sent and the deadline expired before its
   *                         answer: GENUINELY AMBIGUOUS (the increment may have
   *                         landed -- over-count, never over-admission); part of
   *                         expected deadline shedding;
   *   - "commit_late"       COMMIT was CONFIRMED after the deadline: counted, not
   *                         admitted (over-count only); expected shedding;
   *   - "commit_lost"       the connection failed AFTER COMMIT was sent:
   *                         GENUINELY AMBIGUOUS accounting, but an infrastructure
   *                         failure -- never counted as healthy shedding;
   *   - "commit_failed"     the server explicitly refused the COMMIT (an error
   *                         response, or the ROLLBACK tag): nothing was counted;
   *                         an infrastructure failure, not shedding;
   *   - "checkout"          no connection could be checked out;
   *   - "driver"            a statement or the connection failed before COMMIT;
   *   - "internal"          an invariant failed or no decision was reached.
   */
  cause?: LimiterUnavailableCause;
}

export interface McpRateLimiter {
  check(rules: readonly RateLimitRule[]): Promise<RateLimitDecision> | RateLimitDecision;
}

/** The in-memory limiter answers synchronously. */
export interface SyncMcpRateLimiter extends McpRateLimiter {
  check(rules: readonly RateLimitRule[]): RateLimitDecision;
  /** Number of tracked windows (diagnostics/tests). */
  size(): number;
}

export interface FixedWindowOptions {
  windowMs: number;
  now?: () => number;
  /** Hard cap on tracked windows (default 10,000). */
  maxKeys?: number;
}

export function createFixedWindowRateLimiter(options: FixedWindowOptions): SyncMcpRateLimiter {
  const { windowMs } = options;
  if (!Number.isFinite(windowMs) || windowMs < 1) throw new TypeError('windowMs must be positive');
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? 10_000;
  if (!Number.isInteger(maxKeys) || maxKeys < 1) throw new TypeError('maxKeys must be a positive integer');
  const windows = new Map<string, { start: number; count: number }>();

  const sweepExpired = (t: number) => {
    for (const [key, w] of windows) if (t - w.start >= windowMs) windows.delete(key);
  };

  return {
    size: () => windows.size,
    check(rules) {
      if (rules.length === 0) return { allowed: true, retryAfterSeconds: 0 };
      for (const r of rules) {
        if (!Number.isInteger(r.limit) || r.limit < 1) throw new TypeError(`invalid limit for ${r.key.split(':')[0]}`);
      }
      const t = now();
      let retryAfterMs = 0;
      let limitedBy: string | undefined;
      let newKeys = 0;
      // Pass 1: decide without mutating anything.
      for (const r of rules) {
        const w = windows.get(r.key);
        const active = w && t - w.start < windowMs ? w : undefined;
        if (!active) {
          newKeys += 1;
          continue;
        }
        if (active.count >= r.limit) {
          const wait = active.start + windowMs - t;
          if (wait >= retryAfterMs) {
            retryAfterMs = wait;
            limitedBy = r.key.split(':')[0];
          }
        }
      }
      if (limitedBy !== undefined) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)), limitedBy };
      }
      // Capacity: only expired windows may ever be removed.
      if (newKeys > 0 && windows.size + newKeys > maxKeys) {
        sweepExpired(t);
        if (windows.size + newKeys > maxKeys) {
          let oldest = Infinity;
          for (const w of windows.values()) oldest = Math.min(oldest, w.start);
          return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - t) / 1000)), limitedBy: 'capacity' };
        }
      }
      // Pass 2: commit.
      for (const r of rules) {
        const w = windows.get(r.key);
        if (!w || t - w.start >= windowMs) windows.set(r.key, { start: t, count: 1 });
        else w.count += 1;
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}
