/**
 * AURA-AUTH-SESSION-01-I2 -- test support: real v2 sessions for route tests.
 *
 * Replaces the removed v1 `createSessionToken` (which signed {userId, email,
 * exp} with AUTH_SECRET and needed no database). A v2 session is a committed
 * AuthSession row on the test database plus its signed token, so every route
 * test now exercises the real, database-backed verification path.
 */
import { createAuthSession, revokeAuthSession } from '../apps/web/lib/authSessionStore';
import { activeSessionCookieName, getSessionPool, issueSessionToken } from '../apps/web/lib/session';
import { hashSessionId, verifySessionTokenV2, deriveSessionKey } from '../apps/web/lib/authSessionToken';
import { getAuthSecret } from '../apps/web/lib/auth';

/** The cookie name route tests must present (`as_sid` outside production). */
export const TEST_SESSION_COOKIE = activeSessionCookieName();

/** A live session for `userId` (a real "User".id) and its cookie value. `_email` is accepted for call-site compatibility only. */
export async function createTestSessionToken(userId: string, _email?: string): Promise<string> {
  const session = await createAuthSession(getSessionPool(), userId);
  return issueSessionToken(session);
}

/** The AuthSession idHash a token refers to (for revoking / expiring it directly in tests). */
export function testSessionIdHash(token: string): string {
  const claims = verifySessionTokenV2(deriveSessionKey(getAuthSecret()), token, Date.now());
  if (!claims) throw new Error('not a valid v2 test session token');
  return hashSessionId(claims.sid);
}

export async function revokeTestSession(token: string): Promise<void> {
  await revokeAuthSession(getSessionPool(), testSessionIdHash(token), 'admin');
}

/** A minimal NextRequest stand-in carrying the session cookie. */
export function cookieRequest(token?: string, extra: Record<string, unknown> = {}): any {
  return { cookies: { get: (n: string) => (token !== undefined && n === TEST_SESSION_COOKIE ? { value: token } : undefined) }, ...extra };
}

/** The database-backed verification of a cookie value (lib/session.ts), as an injected `verifySession` seam. */
export async function verifyTestSessionToken(token: string): Promise<{ userId: string } | null> {
  const { getSessionFromCookieStore } = await import('../apps/web/lib/session');
  const s = await getSessionFromCookieStore({ get: (n: string) => (n === TEST_SESSION_COOKIE ? { value: token } : undefined) });
  return s ? { userId: s.userId } : null;
}
