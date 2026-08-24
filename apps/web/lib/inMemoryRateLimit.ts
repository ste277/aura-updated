/**
 * Recipient Conversion V1 (brief section 20) -- a deliberately minimal,
 * process-local sliding-window rate limiter for the new public,
 * unauthenticated guest endpoints. The app has no existing generic
 * rate-limit infrastructure to reuse (the only precedent,
 * countRecentAuthRequests in lib/db.ts, is a DB-backed counter purpose-built
 * for the AuthCode table) -- building a second DB-backed system for one
 * narrow-scope endpoint would be substantial new infrastructure the brief
 * explicitly permits skipping ("rate-limit if current infrastructure
 * supports it"). This in-memory version is the smallest thing that actually
 * narrows the attack surface for a single server instance.
 *
 * KNOWN PRODUCTION DEBT (Recipient Conversion V1 Hardening, brief section
 * 12 -- documented, deliberately NOT fixed in this PR, which is scoped to
 * hardening the conversion flow itself, not building shared infra):
 *   - State is process-local: does not survive a restart, and is NOT
 *     shared across multiple server instances/replicas. In a horizontally
 *     scaled deployment, the *effective* limit is `maxRequests` per
 *     instance, not globally -- an attacker distributing requests across
 *     instances (or simply hitting a load balancer that round-robins) can
 *     exceed the intended limit by roughly the instance count.
 *   - No persistence means a deploy/restart silently resets everyone's
 *     window to zero.
 *   - If/when this needs to survive horizontal scaling, the fix is a
 *     DB-backed counter reusing lib/db.ts's countRecentAuthRequests
 *     pattern (same idea: a row per request, COUNT() over a time window),
 *     or a shared cache (Redis) if one is ever introduced for other
 *     reasons -- do not introduce Redis solely for this.
 */

const buckets = new Map<string, number[]>();

/** Returns true if `key` is currently allowed `maxRequests` per `windowMs`. */
export function isRateLimited(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const windowStart = now - windowMs;
  const timestamps = (buckets.get(key) ?? []).filter((ts) => ts > windowStart);

  if (timestamps.length >= maxRequests) {
    buckets.set(key, timestamps);
    return true;
  }

  timestamps.push(now);
  buckets.set(key, timestamps);

  // Opportunistic cleanup so the map doesn't grow unbounded across the
  // process lifetime -- cheap, and only runs when a key is actually hit.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.every((ts) => ts <= windowStart)) buckets.delete(k);
    }
  }

  return false;
}
