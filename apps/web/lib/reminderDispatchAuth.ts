import { timingSafeEqual } from 'crypto';

/**
 * AURA-REM-01: accepts EITHER secret. Vercel Cron sends
 * `Authorization: Bearer <CRON_SECRET>` automatically when CRON_SECRET is
 * set, so requiring a second, identically-valued
 * INTERNAL_REMINDER_DISPATCH_SECRET was an extra, easy-to-miss setup step.
 * An external scheduler can use either. Still fail-closed: with neither set,
 * every request gets 404. Constant-time comparison.
 */
export function dispatchSecrets(env: Record<string, string | undefined> = process.env): string[] {
  return [env.CRON_SECRET, env.INTERNAL_REMINDER_DISPATCH_SECRET].filter((value): value is string => typeof value === 'string' && value.length >= 16);
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isDispatchAuthorized(authHeader: string | null, secrets: string[]): boolean {
  if (!authHeader || secrets.length === 0) return false;
  return secrets.some((secret) => safeEqual(authHeader, `Bearer ${secret}`));
}
