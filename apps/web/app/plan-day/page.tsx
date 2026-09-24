import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { verifySessionToken, SESSION_COOKIE_NAME } from '../../lib/auth';
import { getUserById, listGoalActivitiesWithLinkedPlanStatus } from '../../lib/db';
import { resolvePlanDayServerProps, resolveGoalActivityHandoff } from '../../lib/planDayBootstrap';
import { parseHorizonSearchParam } from '../../lib/planningHorizon';
import { PlanDayClient } from './PlanDayClient';

/**
 * Day Constructor V1 -- PR F2. The user-reachable "Plan my day" entry
 * point, at a dedicated route (mirroring `/find`'s own precedent of a
 * standalone page outside Home's single-page `activeTab` system, this
 * ticket's own section 5).
 *
 * Planning-date hardening -- unlike `/find` (a thin Server Component with
 * no data read at all), this file IS a real async Server Component doing
 * a genuine session/user read, matching the established precedent already
 * in this codebase (`app/moment/[token]/page.tsx`'s own async data-reading
 * Server Component). It establishes the ONE authoritative planning date
 * (`resolvePlanDayServerProps`, planDayBootstrap.ts) from a real server
 * clock read and the authenticated user's own timezone -- passed down as
 * plain props, never recomputed from the browser's clock. This reuses the
 * EXACT SAME canonical session verification (`verifySessionToken`,
 * `SESSION_COOKIE_NAME`) and user lookup (`getUserById`) every route
 * handler in this app already uses -- `next/headers`'s `cookies()` is the
 * standard, first-party Next.js primitive for reading that SAME cookie
 * from within a Server Component (where a `NextRequest` isn't available),
 * not a second authentication model (this ticket's own section 15).
 *
 * Planning Horizon V1 PR P2 -- `searchParams.horizon` is parsed here,
 * server-side, into a real `PlanningHorizon` (`parseHorizonSearchParam`,
 * planningHorizon.ts) and forwarded to `resolvePlanDayServerProps`.
 * Selecting a horizon client-side (PlanDayClient.tsx) navigates to
 * `/plan-day?horizon=...`, which re-invokes THIS Server Component --
 * every horizon resolution is therefore a genuinely fresh server render,
 * with its own fresh `now()` read (never `oldPlanningDate + 1`, never a
 * browser-clock computation -- this ticket's own section 6/7).
 */

export const metadata: Metadata = {
  title: 'Plan my day — Aura',
  description: 'Tell Aura what you want to get done today and see how it fits.',
};

export default async function PlanDayPage({
  searchParams,
}: {
  searchParams: { horizon?: string | string[]; fromGoal?: string | string[]; activities?: string | string[] };
}) {
  const horizon = parseHorizonSearchParam(searchParams.horizon);
  const bootstrap = await resolvePlanDayServerProps({
    getSessionToken: () => cookies().get(SESSION_COOKIE_NAME)?.value,
    verifySession: (token) => verifySessionToken(token),
    getUser: (userId) => getUserById(userId),
    now: () => new Date(),
  }, horizon);

  // Goals -> Planning Integration V1 PR C -- resolved fresh on every
  // render (this ticket's own section 8: reload-safety), entirely
  // separate from the bootstrap above. A malformed/repeated query param
  // (Next.js's `string | string[]` typing for a duplicated key) is
  // treated as absent, never guessed at.
  const fromGoal = typeof searchParams.fromGoal === 'string' ? searchParams.fromGoal : null;
  const activitiesParam = typeof searchParams.activities === 'string' ? searchParams.activities : null;
  const goalActivities = await resolveGoalActivityHandoff(
    {
      getSessionToken: () => cookies().get(SESSION_COOKIE_NAME)?.value,
      verifySession: (token) => verifySessionToken(token),
      listGoalActivities: (userId, goalId) => listGoalActivitiesWithLinkedPlanStatus(userId, goalId),
    },
    fromGoal,
    activitiesParam
  );

  return (
    <PlanDayClient
      timezone={bootstrap?.timezone ?? null}
      planningDate={bootstrap?.planningDate ?? null}
      horizon={bootstrap ? horizon : null}
      availabilityConfigured={bootstrap?.availabilityConfigured ?? null}
      goalActivities={goalActivities}
    />
  );
}
