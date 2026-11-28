import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PlanDayLoader } from './PlanDayLoader';

/**
 * Day Constructor V1 -- the user-reachable "Plan my day" route.
 *
 * AURA-ANDROID-REL-04 IR-01 (R5): this page renders NO account-derived data.
 * Its authoritative bootstrap (planning date and timezone from a server clock
 * read and the user's own timezone, availability, location, Goal/Capture
 * handoffs and automatic Goal demand) is resolved by GET /api/plan-day/bootstrap
 * -- the same resolution code this page used to run -- and fetched by
 * PlanDayLoader only after the client has verified which account is signed in,
 * through the account-bound API boundary. Horizon and handoff query parameters
 * are forwarded unchanged; planningDate/timezone still never come from the client.
 */

export const metadata: Metadata = {
  title: 'Plan my day — Aura',
  description: 'Tell Aura what you want to get done today and see how it fits.',
};

export default function PlanDayPage() {
  return (
    <Suspense fallback={<div role="status" data-account-gate="checking" style={{ minHeight: '40vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', fontSize: 14, padding: 24 }}>Checking your account…</div>}>
      <PlanDayLoader />
    </Suspense>
  );
}
