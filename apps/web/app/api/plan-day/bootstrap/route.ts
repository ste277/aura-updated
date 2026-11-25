import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE_NAME } from '../../../../lib/auth';
import { getSessionFromRequest } from '../../../../lib/session';
import { getUserById, listGoalActivitiesWithLinkedPlanStatus, listCapturesWithLinkedPlanStatus, loadGoalActivityRhythmFacts } from '../../../../lib/db';
import { resolvePlanDayServerProps, resolveGoalActivityHandoff, resolveCaptureHandoff, resolveAutomaticGoalDemand, markCanonicalGoalDemandHandoff } from '../../../../lib/planDayBootstrap';
import { createRealGoalDemandCandidatesDeps } from '../../../../lib/goalDemandCandidates';
import { parseHorizonSearchParam } from '../../../../lib/planningHorizon';

/**
 * AURA-ANDROID-REL-04 IR-01 (R5) -- Plan Day's account-derived bootstrap, moved
 * out of the server-rendered page so that NO account data is in the initial
 * page response. The client (app/plan-day/PlanDayLoader.tsx) fetches this only
 * after its own session verification, through the shared account boundary:
 * this route is ACCOUNT-SCOPED (lib/accountRoutePolicy.ts default), so the
 * middleware refuses a request that does not state the session's account
 * (503) or states another one (409). The resolution below is the same code the
 * page ran before (unchanged deps, the same single clock read, the same
 * session/user verification), and the cookie stays the only authorization.
 *
 * Original page notes (kept):
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
 * handler in this app already uses -- read from this route's own request
 * cookies (R6; formerly `next/headers`'s `cookies()` in the page), not a
 * second authentication model (this ticket's own section 15).
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
export const dynamic = 'force-dynamic';

const one = (v: string | null) => (v === null ? undefined : v);

const NOT_AUTHENTICATED = () => NextResponse.json({ error: 'Not authenticated.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: NextRequest) {
  // R6: the protected-API contract -- no (or an invalid) session is 401, never an empty 200.
  // (A session without the account statement, or stating another account, is refused earlier by the middleware: 503 / 409.)
  if (!getSessionFromRequest(req)) return NOT_AUTHENTICATED();
  const q = req.nextUrl.searchParams;
  // Same shape the page received from Next.js; a repeated key stays an array (treated as absent below, as before).
  const pick = (k: string): string | string[] | undefined => { const all = q.getAll(k); return all.length > 1 ? all : one(q.get(k)); };
  const searchParams = { horizon: pick('horizon'), fromGoal: pick('fromGoal'), activities: pick('activities'), captures: pick('captures') };
  const horizon = parseHorizonSearchParam(searchParams.horizon);
  const bootstrap = await resolvePlanDayServerProps({
    getSessionToken: () => req.cookies.get(SESSION_COOKIE_NAME)?.value,
    verifySession: (token) => verifySessionToken(token),
    getUser: (userId) => getUserById(userId),
    now: () => new Date(),
  }, horizon);
  if (!bootstrap) return NOT_AUTHENTICATED(); // the session's user no longer exists

  // Goals -> Planning Integration V1 PR C -- resolved fresh on every
  // render (this ticket's own section 8: reload-safety), entirely
  // separate from the bootstrap above. A malformed/repeated query param
  // (Next.js's `string | string[]` typing for a duplicated key) is
  // treated as absent, never guessed at.
  const fromGoal = typeof searchParams.fromGoal === 'string' ? searchParams.fromGoal : null;
  const activitiesParam = typeof searchParams.activities === 'string' ? searchParams.activities : null;
  const goalActivities = await resolveGoalActivityHandoff(
    {
      getSessionToken: () => req.cookies.get(SESSION_COOKIE_NAME)?.value,
      verifySession: (token) => verifySessionToken(token),
      listGoalActivities: (userId, goalId) => listGoalActivitiesWithLinkedPlanStatus(userId, goalId),
      loadGoalActivityRhythmFacts: (userId, goalActivityId, timezone) => loadGoalActivityRhythmFacts(userId, goalActivityId, timezone),
    },
    fromGoal,
    activitiesParam,
    // Rhythm R3 -- the SAME authoritative planning date/timezone `bootstrap`
    // above already resolved for this exact request, never a second,
    // independent "today" computation.
    bootstrap?.planningDate ?? null,
    bootstrap?.timezone ?? null
  );

  // Quick Capture V1 PR B -- same fresh, server-side, ids-only resolution.
  const capturesParam = typeof searchParams.captures === 'string' ? searchParams.captures : null;
  const captures = await resolveCaptureHandoff(
    {
      getSessionToken: () => req.cookies.get(SESSION_COOKIE_NAME)?.value,
      verifySession: (token) => verifySessionToken(token),
      listCaptures: (userId) => listCapturesWithLinkedPlanStatus(userId),
    },
    capturesParam
  );

  // Goals V2 Candidate A3.2 -- automatic Goal-demand bootstrap (A3
  // architecture audit's own section 3: server bootstrap, parallel to the
  // manual handoff above). Runs AFTER `goalActivities` above has already
  // resolved (never in parallel with it) -- this ticket's own section 22:
  // automatic dedup depends on the explicit/manual handoff's own
  // SUCCESSFULLY ownership-resolved ids, never the raw `activitiesParam`
  // string (section 19), so this call is deliberately sequenced after it
  // rather than forced into a Promise.all. LOAD_FAILED is preserved all
  // the way out of `resolveAutomaticGoalDemand` and degraded to an empty
  // suggestion list ONLY here, at the page boundary (this ticket's own
  // section 10) -- never silently reinterpreted as "no eligible Goals"
  // inside the resolver itself.
  const automaticGoalDemand = await resolveAutomaticGoalDemand(
    {
      getSessionToken: () => req.cookies.get(SESSION_COOKIE_NAME)?.value,
      verifySession: (token) => verifySessionToken(token),
      ...createRealGoalDemandCandidatesDeps(),
    },
    bootstrap?.planningDate ?? null,
    bootstrap?.timezone ?? null,
    goalActivities.map((activity) => activity.id)
  );
  const autoGoalSuggestions = automaticGoalDemand.status === 'OK' ? automaticGoalDemand.suggestions : [];
  // O5 P0a -- a manual handoff item that the SAME eligible-demand load
  // recognizes as canonical recurring demand is marked, so the client seeds
  // it with the canonical intent identity (identical to an automatic
  // inclusion). On LOAD_FAILED nothing is marked: legacy manual rows.
  const handoffGoalActivities = markCanonicalGoalDemandHandoff(goalActivities, automaticGoalDemand.status === 'OK' ? automaticGoalDemand.manualCanonicalGoalActivityIds : []);

  return NextResponse.json(
    {
      timezone: bootstrap?.timezone ?? null,
      planningDate: bootstrap?.planningDate ?? null,
      horizon: bootstrap ? horizon : null,
      availabilityConfigured: bootstrap?.availabilityConfigured ?? null,
      locationConfirmed: bootstrap?.locationConfirmed ?? null,
      cityName: bootstrap?.cityName ?? null,
      goalActivities: handoffGoalActivities,
      captures,
      autoGoalSuggestions,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
