import type { Metadata } from 'next';
import { AccountScoped } from '../../../components/AccountScoped';
import { cookies } from 'next/headers';
import { verifySessionToken, SESSION_COOKIE_NAME } from '../../../lib/auth';
import { getUserById } from '../../../lib/db';
import { GoalDetailClient } from './GoalDetailClient';

/**
 * Goals -> Planning Integration V1 PR B -- Goal detail route. Same
 * session-verification pattern as app/goals/page.tsx / app/plan-day/page.tsx.
 * The actual Goal + its activities are fetched client-side from the
 * existing GET /api/goals/:id (PR A) -- 404/ownership handling is already
 * identical for "doesn't exist" and "belongs to another user" (this
 * ticket's own section 31), so no server-side existence check is needed
 * here beyond authentication itself.
 */

export const metadata: Metadata = {
  title: 'Goal — Aura',
};

async function resolveAuthenticated(): Promise<boolean> {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  if (!token) return false;
  const session = verifySessionToken(token);
  if (!session) return false;
  const user = await getUserById(session.userId);
  return user !== null;
}

export default async function GoalDetailPage({ params }: { params: { goalId: string } }) {
  const authenticated = await resolveAuthenticated();
  // AURA-ANDROID-REL-04 (R3): server-rendered from the cookie's account -> reload on account change.
  return <AccountScoped onChange="reload"><GoalDetailClient goalId={params.goalId} authenticated={authenticated} /></AccountScoped>;
}
