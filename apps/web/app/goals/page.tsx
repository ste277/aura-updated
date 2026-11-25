import type { Metadata } from 'next';
import { GoalsListScoped } from './GoalsListClient';

/**
 * Goals -> Planning Integration V1 PR B -- the dedicated Goals list route
 * (this ticket's own section 3: "Goals are persistent, multi-day/month-
 * scale objects" -- a standalone page outside Home's single-page
 * `activeTab` system, mirroring `/plan-day`'s own precedent exactly).
 *
 * AURA-ANDROID-REL-04 (R5): the page itself reads no session; the client
 * entry (GoalsListScoped) verifies the signed-in account first, and only
 * then mounts the list, which is fetched client-side from the existing
 * GET /api/goals through the account-bound API boundary (this ticket's own
 * section 40: reuse the already-merged PR A APIs, no duplicate endpoint).
 */

export const metadata: Metadata = {
  title: 'Goals — Aura',
  description: 'What are you working toward? Create a goal and Aura can help turn it into actions you can plan.',
};

export default function GoalsPage() {
  // AURA-ANDROID-REL-04 (R5): no session read here and no account-derived data in this response;
  // the client entry verifies the account first and only then mounts (and fetches) the page.
  return <GoalsListScoped />;
}
