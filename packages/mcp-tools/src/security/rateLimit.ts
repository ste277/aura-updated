/**
 * AURA-MCP-02-I2a -- rate-limit hook for the remote MCP endpoint.
 *
 * The handler depends only on the `McpRateLimiter` interface. The in-memory
 * fixed-window implementation below is the local/dev implementation and the
 * reference behaviour for tests. It is process-local (per serverless
 * instance), so it is NOT sufficient for a multi-instance deployment: a
 * durable, shared store is a staging prerequisite (see the I2a report).
 *
 * Keys are namespaced by the caller (`user:<id>`, `client:<id>`). A request
 * is allowed only if EVERY key is under its limit; a rejected request does
 * not consume budget on any key.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the most-constrained key has budget again (>= 1 when rejected). */
  retryAfterSeconds: number;
  /** Which key namespace rejected the request (e.g. "user"), for audit only. */
  limitedBy?: string;
}

export interface McpRateLimiter {
  check(keys: readonly string[]): Promise<RateLimitDecision> | RateLimitDecision;
}

/** The in-memory limiter answers synchronously. */
export interface SyncMcpRateLimiter extends McpRateLimiter {
  check(keys: readonly string[]): RateLimitDecision;
}

export interface FixedWindowOptions {
  /** Max requests per key per window. */
  limit: number;
  windowMs: number;
  now?: () => number;
  /** Hard cap on tracked keys; the oldest windows are evicted beyond it. */
  maxKeys?: number;
}

export function createFixedWindowRateLimiter(options: FixedWindowOptions): SyncMcpRateLimiter {
  const { limit, windowMs } = options;
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError('limit must be a positive integer');
  if (!Number.isFinite(windowMs) || windowMs < 1) throw new TypeError('windowMs must be positive');
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? 10_000;
  const windows = new Map<string, { start: number; count: number }>();

  return {
    check(keys) {
      const t = now();
      let retryAfterMs = 0;
      let limitedBy: string | undefined;
      const current = keys.map((key) => {
        let w = windows.get(key);
        if (!w || t - w.start >= windowMs) {
          w = { start: t, count: 0 };
          windows.set(key, w);
        }
        if (w.count >= limit) {
          const wait = w.start + windowMs - t;
          if (wait > retryAfterMs) {
            retryAfterMs = wait;
            limitedBy = key.split(':')[0];
          }
        }
        return w;
      });
      if (limitedBy !== undefined) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)), limitedBy };
      }
      for (const w of current) w.count += 1;
      if (windows.size > maxKeys) {
        for (const [key, w] of windows) {
          if (t - w.start >= windowMs || windows.size > maxKeys) windows.delete(key);
          if (windows.size <= maxKeys) break;
        }
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}
