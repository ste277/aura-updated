import type { Metadata } from 'next';
import { GoalDetailScoped } from './GoalDetailClient';

/**
 * Goals -> Planning Integration V1 PR B -- Goal detail route. Same
 * client-verified pattern as app/goals/page.tsx (R5: the page reads no session).
 * The actual Goal + its activities are fetched client-side from the
 * existing GET /api/goals/:id (PR A) -- 404/ownership handling is already
 * identical for "doesn't exist" and "belongs to another user" (this
 * ticket's own section 31), so no server-side existence check is needed
 * here beyond authentication itself.
 */

export const metadata: Metadata = {
  title: 'Goal — Aura',
};

export default function GoalDetailPage({ params }: { params: { goalId: string } }) {
  // AURA-ANDROID-REL-04 (R5): no session read here and no account-derived data in this response;
  // the client entry verifies the account first and only then mounts (and fetches) the page.
  return <GoalDetailScoped goalId={params.goalId} />;
}
