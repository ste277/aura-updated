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
 * narrows the attack surface for a single server instance; it does not
 * survive a restart or share state across multiple instances -- a real
 * limitation, not hidden here, and worth a DB-backed limiter (reusing the
 * AuthCode table's pattern) if this endpoint ever needs to survive scaling
 * out horizontally.
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
