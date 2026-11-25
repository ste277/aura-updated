import type { Metadata } from 'next';
import { AccountScoped } from '../../../components/AccountScoped';
import { resolveServerAccount } from '../../../lib/serverAccount';
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

export default async function GoalDetailPage({ params }: { params: { goalId: string } }) {
  const serverAccount = await resolveServerAccount();
  const authenticated = serverAccount !== null;
  // AURA-ANDROID-REL-04 (R3/R4): rendered for `serverAccount`; shown only once the client's verification agrees.
  return <AccountScoped onChange="reload" serverAccount={serverAccount}><GoalDetailClient goalId={params.goalId} authenticated={authenticated} /></AccountScoped>;
}
