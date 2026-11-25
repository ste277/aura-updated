import type { Metadata } from 'next';
import { AccountScoped } from '../../components/AccountScoped';
import { resolveServerAccount } from '../../lib/serverAccount';
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

export default async function GoalsPage() {
  const serverAccount = await resolveServerAccount();
  const authenticated = serverAccount !== null;
  // AURA-ANDROID-REL-04 (R3/R4): rendered for `serverAccount`; shown only once the client's verification agrees.
  return <AccountScoped onChange="reload" serverAccount={serverAccount}><GoalsListClient authenticated={authenticated} /></AccountScoped>;
}
