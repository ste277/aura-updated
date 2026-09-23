import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { verifySessionToken, SESSION_COOKIE_NAME } from '../../lib/auth';
import { getUserById } from '../../lib/db';
import { GoalsListClient } from './GoalsListClient';

/**
 * Goals -> Planning Integration V1 PR B -- the dedicated Goals list route
 * (this ticket's own section 3: "Goals are persistent, multi-day/month-
 * scale objects" -- a standalone page outside Home's single-page
 * `activeTab` system, mirroring `/plan-day`'s own precedent exactly).
 *
 * Same session-verification pattern as app/plan-day/page.tsx: a real
 * async Server Component reading the SAME session cookie every route
 * handler already uses (`verifySessionToken`/`SESSION_COOKIE_NAME`), never
 * a second authentication model. Only an `authenticated` boolean is
 * forwarded -- the actual Goal list is fetched client-side from the
 * existing GET /api/goals (this ticket's own section 40: reuse the
 * already-merged PR A APIs, no duplicate endpoint).
 */

export const metadata: Metadata = {
  title: 'Goals — Aura',
  description: 'What are you working toward? Create a goal and Aura can help turn it into actions you can plan.',
};

async function resolveAuthenticated(): Promise<boolean> {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  if (!token) return false;
  const session = verifySessionToken(token);
  if (!session) return false;
  const user = await getUserById(session.userId);
  return user !== null;
}

export default async function GoalsPage() {
  const authenticated = await resolveAuthenticated();
  return <GoalsListClient authenticated={authenticated} />;
}
