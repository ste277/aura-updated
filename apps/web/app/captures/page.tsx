import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { verifySessionToken, SESSION_COOKIE_NAME } from '../../lib/auth';
import { getUserById } from '../../lib/db';
import { CapturesClient } from './CapturesClient';

/**
 * Quick Capture V1 PR B -- "Things you want to do". Same standalone-route
 * and session-verification pattern as app/goals/page.tsx: only an
 * `authenticated` boolean is forwarded; the list itself is fetched
 * client-side from GET /api/captures (PR A), never a duplicate endpoint.
 */

export const metadata: Metadata = {
  title: 'Things you want to do — Aura',
  description: 'Capture something you want to do. Aura will help find the time.',
};

async function resolveAuthenticated(): Promise<boolean> {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  if (!token) return false;
  const session = verifySessionToken(token);
  if (!session) return false;
  const user = await getUserById(session.userId);
  return user !== null;
}

export default async function CapturesPage() {
  const authenticated = await resolveAuthenticated();
  return <CapturesClient authenticated={authenticated} />;
}
