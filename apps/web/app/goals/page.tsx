import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getSessionWithUserFromCookieStore } from '../../lib/session';
import { GoalsListClient } from './GoalsListClient';

/**
 * Goals -> Planning Integration V1 PR B -- the dedicated Goals list route
 * (this ticket's own section 3: "Goals are persistent, multi-day/month-
 * scale objects" -- a standalone page outside Home's single-page
 * `activeTab` system, mirroring `/plan-day`'s own precedent exactly).
 *
 * Same session-verification pattern as app/plan-day/page.tsx: a real
 * async Server Component reading the SAME session cookie every route
 * handler already uses (lib/session.ts), never
 * a second authentication model. Only an `authenticated` boolean is
 * forwarded -- the actual Goal list is fetched client-side from the
 * existing GET /api/goals (this ticket's own section 40: reuse the
 * already-merged PR A APIs, no duplicate endpoint).
 */

export const metadata: Metadata = {
  title: 'Goals — Aura',
  description: 'What are you working toward? Create a goal and Aura can help turn it into actions you can plan.',
};

// AURA-AUTH-SESSION-01-I2 (E2): database-backed verification through
// lib/session.ts (the joined session + user lookup). An outage throws
// SessionVerificationUnavailableError, so the page fails instead of
// rendering as signed out.
async function resolveAuthenticated(): Promise<boolean> {
  return (await getSessionWithUserFromCookieStore(cookies())) !== null;
}

export default async function GoalsPage() {
  const authenticated = await resolveAuthenticated();
  return <GoalsListClient authenticated={authenticated} />;
}
