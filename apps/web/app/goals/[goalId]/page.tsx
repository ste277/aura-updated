import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getSessionWithUserFromCookieStore } from '../../../lib/session';
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
// lib/session.ts (the joined session + user lookup). An outage throws
// SessionVerificationUnavailableError, so the page fails instead of
// rendering as signed out.
async function resolveAuthenticated(): Promise<boolean> {
  return (await getSessionWithUserFromCookieStore(cookies())) !== null;
}

export default async function GoalDetailPage({ params }: { params: { goalId: string } }) {
  const authenticated = await resolveAuthenticated();
  return <GoalDetailClient goalId={params.goalId} authenticated={authenticated} />;
}
