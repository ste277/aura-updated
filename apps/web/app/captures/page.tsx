import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getSessionWithUserFromCookieStore } from '../../lib/session';
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

// AURA-AUTH-SESSION-01-I2 (E2): database-backed verification through
// lib/session.ts (the joined session + user lookup). An outage throws
// SessionVerificationUnavailableError, so the page fails instead of
// rendering as signed out.
async function resolveAuthenticated(): Promise<boolean> {
  return (await getSessionWithUserFromCookieStore(cookies())) !== null;
}

export default async function CapturesPage() {
  const authenticated = await resolveAuthenticated();
  return <CapturesClient authenticated={authenticated} />;
}
