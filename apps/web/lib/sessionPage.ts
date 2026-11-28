import { redirect } from 'next/navigation';
import { SessionVerificationUnavailableError } from './sessionErrors';

/**
 * AURA-AUTH-SESSION-01-I2-R1 (39246-03) -- the E2 server-page boundary for a
 * session-store outage. A page's session lookup that cannot be verified is an
 * outage, never "signed out": the request is sent to /session-unavailable,
 * which answers HTTP 503 with Retry-After and a "Try again" link back to the
 * page (Rev 3 §2.3 sessionUnavailableResponse semantics; an App Router page
 * itself cannot choose its status code). Any other error propagates.
 */
export async function pageSessionOrUnavailable<T>(lookup: () => Promise<T>, returnTo: string): Promise<T> {
  try {
    return await lookup();
  } catch (err) {
    if (err instanceof SessionVerificationUnavailableError) redirect(sessionUnavailablePath(returnTo));
    throw err;
  }
}

/** Only a same-origin absolute path may be a return target. */
export function safeReturnPath(value: string | null | undefined): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f]/.test(value)) return '/';
  return value.length > 512 ? '/' : value;
}

export function sessionUnavailablePath(returnTo: string): string {
  return `/session-unavailable?returnTo=${encodeURIComponent(safeReturnPath(returnTo))}`;
}
