/**
 * Day Constructor V1 -- PR F2 planning-date hardening.
 *
 * The ONE place F2's authoritative planning date is established -- from a
 * real server clock read and the authenticated user's own timezone, never
 * the browser's clock (this ticket's own section 3/13: no client clock
 * read may determine the planning civil date). `/plan-day/page.tsx` (a
 * Server Component) calls `resolvePlanDayServerProps` with the real
 * cookie-reading/`auth.ts`/`db.ts` primitives injected; every actual
 * decision lives here, fully testable with no framework-specific cookie
 * API import at all -- mirroring PR F1's own
 * `handleDayConstructorPreviewRequest` pattern exactly
 * (dayConstructorPreviewRequest.ts): a thin framework adapter wiring real
 * closures into a plain, DI-tested function.
 */

import { getDatePartsInTimezone } from './timezone';
import { resolvePlanningTargetDate, type PlanningHorizon } from './planningHorizon';
import { MAX_PLAN_DAY_INTENTS } from './planDayEntry';
import { deriveGoalActivityState, type GoalActivityStatus, type PlannedActivityStatus } from './goals';
import { deriveCaptureState, type CaptureStatus, type LinkedPlanStatus } from './captures';

export interface PlanDayBootstrap {
  timezone: string;
  planningDate: string;
}

/**
 * Planning Horizon V1 PR P2 -- what `resolvePlanDayServerProps` actually
 * returns: `PlanDayBootstrap`'s own pure civil-date facts, plus the ONE
 * additional fact the Tomorrow UI needs (this ticket's own section 8):
 * whether the user has a saved Availability configuration at all.
 * `resolvePlanDayBootstrap` itself stays entirely unaware of
 * availability (single responsibility preserved) -- this fact is
 * attached here, one level up, where `user` (already fetched for
 * `user.timezone`) is already in scope, so it costs zero extra query and
 * never duplicates H1/H2's own resolution logic.
 */
export interface PlanDayServerProps extends PlanDayBootstrap {
  availabilityConfigured: boolean;
}

/**
 * Pure. The one civil-date derivation this entire feature performs --
 * reused verbatim by both the FIXED-time assembly (planDayEntry.ts) and
 * the preview request's own `targetDate` (this ticket's own section 7),
 * so both can never disagree about which day is being planned.
 *
 * Planning Horizon V1 PR P1 -- `horizon` defaults to `'TODAY'`, so every
 * existing caller that supplies no horizon stays byte-equivalent to
 * before this parameter existed (this ticket's own section 5: "Existing
 * callers that provide no horizon must remain byte-equivalent"). No UI
 * exposes a non-default horizon yet (P2's own scope) -- this parameter
 * only proves the server-side resolution itself is correct.
 */
export function resolvePlanDayBootstrap(userTimezone: string, now: Date, horizon: PlanningHorizon = 'TODAY'): PlanDayBootstrap {
  const currentDate = getDatePartsInTimezone(userTimezone, now).dateStr;
  return { timezone: userTimezone, planningDate: resolvePlanningTargetDate({ horizon, currentDate }) };
}

export interface PlanDayBootstrapDeps {
  /** `() => cookies().get(SESSION_COOKIE_NAME)?.value` in production. */
  getSessionToken: () => string | undefined;
  /** `verifySessionToken` (auth.ts), passed by reference -- the SAME
   * canonical verification every route in this app already uses (this
   * ticket's own section 15: reuse the existing mechanism, never a
   * second auth model). */
  verifySession: (token: string) => { userId: string } | null;
  /** `getUserById` (db.ts), passed by reference. `availabilityConfigured`
   * is optional here (this ticket's own section 8) -- the real `User` row
   * always carries it, but a test fixture supplying only `{ timezone }`
   * (P1's own established convention) must keep working unchanged; a
   * missing value is treated identically to `false` (see
   * `resolvePlanDayServerProps` below), never a fabricated `true`. */
  getUser: (userId: string) => Promise<{ timezone: string; availabilityConfigured?: boolean } | null>;
  /** The authoritative server clock, read exactly once. */
  now: () => Date;
}

/**
 * `null` means "not authenticated" -- the caller (page.tsx) passes this
 * through to `PlanDayClient` as absent props, which redirects to Home
 * exactly like this app's own established client-side pattern
 * (window.location.href), never a second, server-side redirect mechanism
 * (this ticket's own section 15/19: no new architecture).
 *
 * Planning Horizon V1 PR P1 -- `horizon` defaults to `'TODAY'` and is
 * forwarded verbatim to `resolvePlanDayBootstrap`, so this full
 * session -> user -> bootstrap sequence is directly testable against a
 * requested horizon with no cookie-framework/NextRequest involvement,
 * exactly like every other boundary in this file. `page.tsx` (the real
 * Server Component caller) does not pass a horizon yet -- P2's own
 * scope.
 */
export async function resolvePlanDayServerProps(deps: PlanDayBootstrapDeps, horizon: PlanningHorizon = 'TODAY'): Promise<PlanDayServerProps | null> {
  const token = deps.getSessionToken();
  if (!token) return null;

  const session = deps.verifySession(token);
  if (!session) return null;

  const user = await deps.getUser(session.userId);
  if (!user) return null;

  const bootstrap = resolvePlanDayBootstrap(user.timezone, deps.now(), horizon);
  return { ...bootstrap, availabilityConfigured: user.availabilityConfigured === true };
}

// ============================================================
// Goals -> Planning Integration V1 PR C -- the Goal -> Plan My Day
// handoff (this ticket's own section 6/7/8). Resolved server-side, at
// bootstrap time, exactly like `resolvePlanDayServerProps` above:
// `?fromGoal=&activities=` supplies ID REFERENCES ONLY (this ticket's own
// section 6 -- "do NOT serialize titles/activity metadata into the URL"),
// and every title/activityId this function returns is re-fetched fresh
// from the database, never trusted from the client. Eligibility
// (derivedState === 'SUGGESTED') is re-evaluated on EVERY call, which is
// what makes this reload-safe by construction (this ticket's own section
// 8 -- "Tab B must not seed the now-PLANNED activity"): a stale tab that
// reloads re-invokes the whole Server Component, which calls this
// function fresh, which re-derives eligibility from the CURRENT database
// state, not from anything the originating Goal detail screen once knew.
// ============================================================

export interface GoalActivityHandoffItem {
  id: string;
  title: string;
  activityId: string | null;
}

export interface GoalActivityHandoffDeps {
  /** Same shape as `PlanDayBootstrapDeps.getSessionToken` -- a second,
   * independent session read (this file's own established convention:
   * `resolvePlanDayServerProps` above already does its own; every Goals
   * route (app/goals/page.tsx, app/goals/[goalId]/page.tsx) already does
   * its own too). A cookie read + HMAC verify is cheap; this is not a
   * meaningful duplication cost. */
  getSessionToken: () => string | undefined;
  verifySession: (token: string) => { userId: string } | null;
  /** `listGoalActivitiesWithLinkedPlanStatus` (db.ts), passed by
   * reference -- the SAME already-merged PR A read this ticket's own
   * section 40's "reuse the already-merged PR A APIs" instruction asks
   * for, never a duplicate query. */
  listGoalActivities: (
    userId: string,
    goalId: string
  ) => Promise<
    ReadonlyArray<{ id: string; title: string; activityId: string | null; status: string; plannedActivityId: string | null; linkedPlanStatus: string | null }>
  >;
}

/**
 * `goalId`/`activitiesParam` are the raw, untrusted `?fromGoal=`/
 * `?activities=` query string values (or `null`/absent). Returns an empty
 * array for every unauthenticated/malformed/not-owned/ineligible case --
 * never throws, never distinguishes "doesn't exist" from "not yours" from
 * "not eligible right now" (this ticket's own section 7/8: a stale or
 * foreign id simply fails to seed a row, silently, exactly like every
 * other ownership boundary already established in this codebase, e.g.
 * PR A's own `addGoalActivity` returning `null` for an unowned Goal).
 */
export async function resolveGoalActivityHandoff(deps: GoalActivityHandoffDeps, goalId: string | null, activitiesParam: string | null): Promise<GoalActivityHandoffItem[]> {
  if (!goalId || !activitiesParam) return [];
  const requestedIds = Array.from(new Set(activitiesParam.split(',').map((id) => id.trim()).filter(Boolean))).slice(0, MAX_PLAN_DAY_INTENTS);
  if (requestedIds.length === 0) return [];

  const token = deps.getSessionToken();
  if (!token) return [];
  const session = deps.verifySession(token);
  if (!session) return [];

  const requestedIdSet = new Set(requestedIds);
  // Already scoped to `(userId, goalId)` inside the query itself -- a
  // non-owned or non-existent Goal simply returns zero rows, no separate
  // existence check needed (same "identical presentation, no leak" pattern
  // this ticket's own section 8/PR B's 404 handling already established).
  const activities = await deps.listGoalActivities(session.userId, goalId);

  return activities
    .filter((activity) => requestedIdSet.has(activity.id))
    .filter(
      (activity) =>
        deriveGoalActivityState({
          status: activity.status as GoalActivityStatus,
          plannedActivityId: activity.plannedActivityId,
          linkedPlanStatus: activity.linkedPlanStatus as PlannedActivityStatus | null,
        }) === 'SUGGESTED'
    )
    .map((activity) => ({ id: activity.id, title: activity.title, activityId: activity.activityId }));
}

// ============================================================
// Quick Capture V1 PR B -- the Capture -> Plan My Day handoff, the exact
// sibling of resolveGoalActivityHandoff above. `?captures=<id,id,...>`
// supplies ID REFERENCES ONLY; every title is re-read from the database for
// the authenticated user, and eligibility (derived state OPEN) is
// re-evaluated on EVERY render, so a stale/reloaded link never seeds a
// Capture that has since been planned, completed or removed.
// ============================================================

export interface CaptureHandoffItem {
  id: string;
  title: string;
}

export interface CaptureHandoffDeps {
  getSessionToken: () => string | undefined;
  verifySession: (token: string) => { userId: string } | null;
  /** `listCapturesWithLinkedPlanStatus` (db.ts), passed by reference. */
  listCaptures: (
    userId: string
  ) => Promise<ReadonlyArray<{ id: string; title: string; status: string; completedAt: Date | null; linkedPlanStatus: string | null }>>;
}

/**
 * Returns [] for every unauthenticated/malformed/not-owned/ineligible case
 * and never throws. Ids are de-duplicated here (authoritatively -- React keys
 * never hide duplicates). Output order is the user's own list order (newest
 * first, as shown on the Things-you-want-to-do page), not URL order: the
 * DB read already scopes by userId, so foreign ids simply never match.
 */
export async function resolveCaptureHandoff(deps: CaptureHandoffDeps, capturesParam: string | null): Promise<CaptureHandoffItem[]> {
  if (!capturesParam) return [];
  const requestedIds = Array.from(new Set(capturesParam.split(',').map((id) => id.trim()).filter(Boolean))).slice(0, MAX_PLAN_DAY_INTENTS);
  if (requestedIds.length === 0) return [];

  const token = deps.getSessionToken();
  if (!token) return [];
  const session = deps.verifySession(token);
  if (!session) return [];

  const requested = new Set(requestedIds);
  const captures = await deps.listCaptures(session.userId);
  return captures
    .filter((capture) => requested.has(capture.id))
    .filter(
      (capture) =>
        deriveCaptureState({
          status: capture.status as CaptureStatus,
          completedAt: capture.completedAt,
          linkedPlanStatus: capture.linkedPlanStatus as LinkedPlanStatus | null,
        }) === 'OPEN'
    )
    .map((capture) => ({ id: capture.id, title: capture.title }));
}
