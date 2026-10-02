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
import { normalizeGoalActivityRhythm, computeGoalActivityRhythmEligibility } from './goalActivityRhythm';
import { loadEligibleGoalDemand, excludeGoalDemandByActivityIds, type GoalDemandCandidate, type GoalDemandCandidatesDeps } from './goalDemandCandidates';

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
  /**
   * O5 P0a -- set ONLY by the server (`markCanonicalGoalDemandHandoff`
   * below), never by a request: true when this handed-off GoalActivity is
   * ALSO canonical recurring Goal demand under the existing eligibility
   * read model (`loadEligibleGoalDemand`) for the planning date. It is a
   * presentation-time fact telling the client to seed the row with the
   * SAME canonical intent identity an automatic inclusion uses, so the
   * existing server-side matching and acceptance authorization treat both
   * entry paths identically. Absent/false keeps the legacy manual row.
   */
  canonicalDemand?: boolean;
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
   * for, never a duplicate query. Rhythm R3 -- `rhythmKind`/
   * `rhythmTargetPerWeek` are additive, OPTIONAL fields (this same row has
   * always returned them since migration 0043/R2; optional here only so
   * an existing test fixture supplying the pre-R3 shape keeps compiling
   * unchanged -- a real production row always has them). */
  listGoalActivities: (
    userId: string,
    goalId: string
  ) => Promise<
    ReadonlyArray<{ id: string; title: string; activityId: string | null; status: string; plannedActivityId: string | null; linkedPlanStatus: string | null; rhythmKind?: string | null; rhythmTargetPerWeek?: number | null }>
  >;
  /** Rhythm R3 -- `loadGoalActivityRhythmFacts` (db.ts), passed by
   * reference; the SAME batched-per-activity read model R2 already
   * established, never a second eligibility formula. OPTIONAL: an existing
   * test fixture that supplies no Rhythm-aware deps at all simply never
   * admits a COMPLETED activity (the pre-R3, SUGGESTED-only behavior),
   * never a runtime error. */
  loadGoalActivityRhythmFacts?: (userId: string, goalActivityId: string, timezone: string) => Promise<ReadonlyArray<{ localDate: string; contribution: 'COMPLETED' | 'COMMITTED' | 'NONE' }>>;
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
 *
 * Rhythm R3 -- `planningDate`/`timezone` are the SAME authoritative facts
 * `resolvePlanDayServerProps` already resolves for this exact request
 * (page.tsx calls both in the same render); passed in rather than
 * re-derived, so this function and the rest of the page can never disagree
 * about which date is being planned (this ticket's own section 9/10 --
 * never a second, independent "today" computation, never a browser clock).
 * `null` (an unauthenticated/malformed bootstrap, structurally never
 * expected to disagree with THIS function's own independent session check)
 * simply means no GoalActivity can be admitted beyond the existing
 * SUGGESTED case -- fails closed, never guesses a date.
 */
export async function resolveGoalActivityHandoff(deps: GoalActivityHandoffDeps, goalId: string | null, activitiesParam: string | null, planningDate: string | null = null, timezone: string | null = null): Promise<GoalActivityHandoffItem[]> {
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

  const candidates = activities.filter((activity) => requestedIdSet.has(activity.id));
  const admitted = await Promise.all(
    candidates.map(async (activity) => {
      const state = deriveGoalActivityState({
        status: activity.status as GoalActivityStatus,
        plannedActivityId: activity.plannedActivityId,
        linkedPlanStatus: activity.linkedPlanStatus as PlannedActivityStatus | null,
      });
      if (state === 'SUGGESTED') return true;
      // Rhythm R3's own primary behavioral requirement: a COMPLETED
      // N_PER_WEEK activity with remaining weekly capacity is admitted
      // too -- re-derived fresh, server-side, from THIS activity's own
      // persisted rhythmKind/rhythmTargetPerWeek and occurrence facts,
      // never trusted from any client-supplied Rhythm field (this
      // ticket's own section 20). A finite (NONE) COMPLETED activity, or
      // any PLANNED/DISMISSED activity, is never admitted here -- the
      // legacy SUGGESTED-only behavior for everything else is unchanged.
      if (state !== 'COMPLETED' || !planningDate || !timezone || !deps.loadGoalActivityRhythmFacts) return false;
      const rhythm = normalizeGoalActivityRhythm({ rhythmKind: activity.rhythmKind ?? null, rhythmTargetPerWeek: activity.rhythmTargetPerWeek ?? null });
      if (rhythm.kind !== 'N_PER_WEEK') return false;
      const facts = await deps.loadGoalActivityRhythmFacts(session.userId, activity.id, timezone);
      return computeGoalActivityRhythmEligibility({ rhythm, planningLocalDate: planningDate, occurrences: facts }).eligible;
    })
  );

  return candidates.filter((_, index) => admitted[index]).map((activity) => ({ id: activity.id, title: activity.title, activityId: activity.activityId }));
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

// ============================================================
// Goals V2 Candidate A3.2 -- the automatic Goal-demand bootstrap seam
// (this ticket's own section 3/10 of the A3 architecture audit): the
// smallest server-side resolver turning A1's own ownership-scoped
// `loadEligibleGoalDemand` into factual, deduplicated presentation
// candidates for the Plan Day page. Mirrors `resolveGoalActivityHandoff`/
// `resolveCaptureHandoff` above exactly (same session-resolution
// convention, same DI-testable deps shape) -- the ONE deliberate
// difference is that `LOAD_FAILED` is preserved all the way out of this
// function (this ticket's own section 9/10: "do not convert LOAD_FAILED
// to [] inside the resolver"), because A1 itself distinguishes "load
// failed" from "genuinely zero eligible" and this is the first layer
// with the authority to decide how that distinction should degrade --
// the page boundary (page.tsx), not this resolver, makes that call.
//
// Recomputes NO Rhythm eligibility and queries NO Goal/Rhythm state of
// its own (this ticket's own section 3) -- `loadEligibleGoalDemand` (A1)
// is called verbatim, and the only additional step this function performs
// is excluding GoalActivities already represented by the explicit/manual
// Goal handoff, via `excludeGoalDemandByActivityIds` (A2) -- the SAME
// pure set-difference helper A2 already established, reused rather than
// reimplemented (this ticket's own section 7/8).
// ============================================================

export type AutomaticGoalDemandBootstrapResult =
  | {
      status: 'OK';
      suggestions: readonly GoalDemandCandidate[];
      /** O5 P0a -- the subset of `excludeGoalActivityIds` (the manual
       * handoff's own resolved ids) that the SAME single eligible-demand
       * load recognizes as canonical demand. No extra query: it is read
       * from the candidates already loaded. */
      manualCanonicalGoalActivityIds: readonly string[];
    }
  | { status: 'LOAD_FAILED' };

export interface AutomaticGoalDemandBootstrapDeps extends GoalDemandCandidatesDeps {
  getSessionToken: () => string | undefined;
  verifySession: (token: string) => { userId: string } | null;
}

/**
 * `planningLocalDate`/`timezone` are ALWAYS the same `bootstrap.planningDate`/
 * `bootstrap.timezone` values `resolvePlanDayServerProps` already resolved
 * for this exact request (this ticket's own section 5/6: no new date/
 * timezone source, no `Date.now()`/browser clock) -- `null` (an
 * unauthenticated/malformed bootstrap) simply means nothing can be
 * resolved, matching `resolveGoalActivityHandoff`'s own identical
 * "fails closed to an empty result, never guesses" convention for that
 * exact case (distinct from a genuine A1 `LOAD_FAILED`).
 *
 * `excludeGoalActivityIds` must be the IDs of the explicit/manual Goal
 * handoff's own SUCCESSFULLY ownership/eligibility-resolved items (i.e.
 * `resolveGoalActivityHandoff`'s own return value, mapped to ids) --
 * NEVER the raw, unvalidated `?activities=` query-string value (this
 * ticket's own section 19: an invalid/not-owned/ineligible id that failed
 * to resolve to a real manual GoalActivity must never suppress a valid
 * automatic suggestion for a DIFFERENT GoalActivity that happens to share
 * no relation to it beyond appearing in the same raw query string).
 */
export async function resolveAutomaticGoalDemand(
  deps: AutomaticGoalDemandBootstrapDeps,
  planningLocalDate: string | null,
  timezone: string | null,
  excludeGoalActivityIds: readonly string[]
): Promise<AutomaticGoalDemandBootstrapResult> {
  if (!planningLocalDate || !timezone) return { status: 'OK', suggestions: [], manualCanonicalGoalActivityIds: [] };

  const token = deps.getSessionToken();
  if (!token) return { status: 'OK', suggestions: [], manualCanonicalGoalActivityIds: [] };
  const session = deps.verifySession(token);
  if (!session) return { status: 'OK', suggestions: [], manualCanonicalGoalActivityIds: [] };

  const result = await loadEligibleGoalDemand(deps, session.userId, planningLocalDate, timezone);
  if (result.status === 'LOAD_FAILED') return { status: 'LOAD_FAILED' };

  const manualIds = new Set(excludeGoalActivityIds);
  return {
    status: 'OK',
    suggestions: excludeGoalDemandByActivityIds(result.candidates, excludeGoalActivityIds),
    manualCanonicalGoalActivityIds: result.candidates.filter((candidate) => manualIds.has(candidate.goalActivityId)).map((candidate) => candidate.goalActivityId),
  };
}

/**
 * O5 P0a -- pure server-side annotation of the manual handoff: an item is
 * marked `canonicalDemand` iff its id is among the ids the eligible-demand
 * read model itself recognized. Exact id equality only (never a title,
 * label or similarity match); an id the read model did not return -- a
 * finite activity, an ineligible one, an archived Goal's, or any id when
 * the load failed -- is left exactly as the legacy manual item.
 */
export function markCanonicalGoalDemandHandoff(items: readonly GoalActivityHandoffItem[], canonicalGoalActivityIds: readonly string[]): GoalActivityHandoffItem[] {
  const canonical = new Set(canonicalGoalActivityIds);
  return items.map((item) => (canonical.has(item.id) ? { ...item, canonicalDemand: true } : item));
}
