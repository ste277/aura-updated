import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getSessionWithUserFromCookieStore } from '../../../lib/session';
import { pageSessionOrUnavailable } from '../../../lib/sessionPage';
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

// AURA-AUTH-SESSION-01-I2 (E2): database-backed verification through
// lib/session.ts (the joined session + user lookup). An outage answers
// 503 with Retry-After (lib/sessionPage.ts, I2-R1), never signed out.
async function resolveAuthenticated(goalId: string): Promise<boolean> {
  return (await pageSessionOrUnavailable(() => getSessionWithUserFromCookieStore(cookies()), `/goals/${encodeURIComponent(goalId)}`)) !== null;
}

export default async function GoalDetailPage({ params }: { params: { goalId: string } }) {
  const authenticated = await resolveAuthenticated(params.goalId);
  return <GoalDetailClient goalId={params.goalId} authenticated={authenticated} />;
}
