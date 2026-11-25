import { cookies } from 'next/headers';
import { verifySessionToken, SESSION_COOKIE_NAME } from './auth';
import { getUserById } from './db';

/**
 * AURA-ANDROID-REL-04 IR-01 (R4) -- the account a server-rendered page was
 * rendered FOR: the same rule as GET /api/auth/session (valid cookie AND an
 * existing user), so the client can require agreement between this value and
 * its own first verification before showing the page (components/AccountScoped).
 * null = rendered signed out.
 */
export async function resolveServerAccount(): Promise<string | null> {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const session = verifySessionToken(token);
  if (!session) return null;
  const user = await getUserById(session.userId);
  return user ? user.id : null;
}
