/**
 * HGR3-B -- Secure Weekly Rhythm Proposal Acceptance.
 *
 * Converts a user-confirmed subset of HGR3-A's read-only weekly proposals
 * (goalRhythmWeeklyProposal.ts, explicitly `committable: false`) into real
 * commitments, one session at a time, through the EXISTING Day Constructor
 * preview+accept pipeline -- never a new signing format, never a new
 * atomic-batch transaction, never a direct PlannedActivity/
 * GoalActivityOccurrence write of its own.
 *
 * WHY PER-SESSION, NEVER ONE BATCH CALL (per the preceding HGR3-B0 audit,
 * re-verified here by direct source read): the Day Constructor's signed-
 * preview-item module (dayConstructorPreviewIntegrity.ts) signs each item
 * per-ITEM, with no structural objection to a different window per item --
 * but the existing accept route's own request shape
 * (`AcceptConstructedDayRequest`, dayConstructorAcceptance.ts) carries
 * exactly ONE `constructionWindow` for an entire call. Three sessions on
 * three different calendar dates genuinely cannot be submitted in ONE
 * call -- but each CAN independently go through its OWN call to the exact
 * same, completely unmodified preview+accept functions, since each call
 * gets its own single-day window. This file is the thin orchestration loop
 * that does that, sequentially, reporting each session's real, independent
 * result -- never one combined transaction.
 *
 * THE CONVERSION PATH, per session (never trusts a client-supplied time):
 *  1. `loadEligibleGoalDemand` (goalDemandCandidates.ts) -- the SAME read
 *     model HGR3-A/Home/Plan My Day already call -- re-validates ownership
 *     and FRESH remaining demand for this GoalActivity, right now. A
 *     client's selection only ever supplies a GoalActivity id and a
 *     calendar date; it is never trusted for title/duration/eligibility,
 *     and it is NEVER handed a specific clock time to sign (see point 3).
 *  2. `buildGoalPlanningSourceIntents` (goalPlanningSourceAdapter.ts) --
 *     the SAME pure mapping the existing automatic Goal-demand flow
 *     already uses for TODAY -- turns that one verified candidate into a
 *     single generic, FLEXIBLE Day Constructor intent, carrying the
 *     reserved `goal-demand:<date>:<goalActivityId>` intentId.
 *  3. `handleDayConstructorPreviewRequest` (dayConstructorPreviewRequest.ts,
 *     byte-identical, unmodified) -- called with a HAND-BUILT
 *     `EXPLICIT_RANGE` construction window scoped to exactly this one
 *     session's own local date (never today's REMAINING_TODAY convenience
 *     path, which this adapter deliberately bypasses for every date). The
 *     intent stays FLEXIBLE, with no `fixedStart` -- this is the
 *     deliberate answer to "must a selected candidate be re-validated
 *     through CHECK before signing": rather than trying to re-validate
 *     HGR3-A's own (by now potentially stale) proposed clock time, this
 *     adapter lets the real Constructor place the session FRESH, for the
 *     chosen date, using its own live availability/blocker/Daily-Rhythm
 *     resolution -- the same genuine scheduling decision a from-scratch
 *     single-day Plan My Day session would make. The resulting signed
 *     item's own start/end is the authoritative time, which may differ
 *     from whatever HGR3-A displayed; that is correct, not a regression --
 *     it is fresher information.
 *  4. The resulting signed `ProposedItem` (with its real `acceptanceToken`,
 *     minted by `signPreviewResultBody` INSIDE step 3, never re-derived or
 *     invented here) is run through the EXACT SAME verification/
 *     authorization/persistence sequence `POST /api/day-constructor/accept`
 *     itself uses (`verifyAcceptanceItems` -> `authorizeGoalActivityLinks`
 *     -> `persistAcceptedConstructedDay`, all three imported verbatim,
 *     never reimplemented) -- see this file's own `acceptOneSession` for
 *     the exact sequence, matching that route's trust order precisely.
 *
 * IDEMPOTENCY (HGR3-B0's own proposal, validated here): each session's
 * own `clientRequestId` is `hgr3b:<goalActivityId>:<localDate>` --
 * deterministic, but never used bare: `PlanCreationIdempotency` is keyed
 * by `(userId, clientRequestId)` (db.ts, unmodified), so this string can
 * never collide across users even though it carries no explicit userId
 * component itself. A `localDate` is already week-specific by
 * construction (it is a full calendar date, not merely a day-of-week), so
 * it cannot collide across weeks either. HGR3-A's own same-day exclusion
 * (selectDistinctDayProposals's `seedOccupiedLocalDates`) already prevents
 * two live sessions of the SAME GoalActivity from ever being proposed for
 * the SAME date in the first place, so this adapter never needs to
 * disambiguate "two distinct intended sessions, same activity, same day"
 * -- that case does not reach acceptance. Retrying the identical session
 * resubmits the identical clientRequestId, which the existing acceptance
 * persistence already classifies as ALREADY_ACCEPTED (zero new writes) or
 * IDEMPOTENCY_CONFLICT (if the stored claim's content genuinely differs --
 * e.g. the Constructor placed it at a different time on a retried,
 * re-generated preview), never a silent duplicate.
 *
 * PARTIAL SUCCESS (never one atomic transaction, per this ticket's own
 * instruction): sessions are processed sequentially, each independently
 * accepted or rejected on its own authoritative, freshly-revalidated
 * state. A later session's failure never rolls back an earlier session's
 * real, already-committed success -- the same "each item attempted
 * independently, never all-or-nothing" discipline this codebase already
 * established elsewhere (collectSkipAllOutcomes, homeMissedRecovery.ts).
 */

import { getDatePartsInTimezone } from './timezone';
import { localCalendarWeekBounds, normalizeGoalActivityRhythm } from './goalActivityRhythm';
import { localDayBoundsUTC } from './myDayOrchestrator';
import { loadEligibleGoalDemand, type GoalDemandCandidatesDeps, type GoalDemandCandidate } from './goalDemandCandidates';
import { buildGoalPlanningSourceIntents } from './goalPlanningSourceAdapter';
import { handleDayConstructorPreviewRequest, type DayConstructorPreviewBoundaryDeps, type DayConstructorPreviewHttpResult } from './dayConstructorPreviewRequest';
import { verifyAcceptanceItems } from './dayConstructorPreviewIntegrity';
import { authorizeGoalActivityLinks } from './goalDemandProvenanceAuthorization';
import { persistAcceptedConstructedDay, type AcceptConstructedDayPersistenceResult } from './dayConstructorAcceptancePersistence';
import type { AcceptConstructedDayRequest, AcceptedProposedItem } from './dayConstructorAcceptance';
import type { ConstructionWindow } from './dayIntent';
import type { User } from './db';

/** Mirrors HGR3-A's own MAX_WEEKLY_RHYTHM_PROPOSALS -- a batch can never
 * legitimately contain more sessions than could ever have been proposed
 * in the first place; a larger submitted array is rejected outright
 * rather than silently truncated. */
export const MAX_WEEKLY_ACCEPTANCE_SESSIONS = 3;

const CLIENT_REQUEST_ID_PREFIX = 'hgr3b';

/** Deterministic, per (user-scoped by the idempotency table itself,
 * never baked into this string), per-GoalActivity, per-local-date. See
 * this module's own header comment for the full collision analysis. */
export function buildWeeklySessionClientRequestId(goalActivityId: string, localDate: string): string {
  return `${CLIENT_REQUEST_ID_PREFIX}:${goalActivityId}:${localDate}`;
}

export interface WeeklyAcceptanceSelection {
  goalActivityId: string;
  /** The civil date (user-local), 'YYYY-MM-DD', the user confirmed for
   * this one session -- NEVER a specific clock time (see this module's
   * header comment, point 3, for why a time is deliberately never
   * accepted from the client at all). */
  localDate: string;
}

export type WeeklySessionAcceptanceOutcome =
  | { goalActivityId: string; localDate: string; outcome: 'ACCEPTED'; plannedActivityId: string; start: string; end: string }
  | { goalActivityId: string; localDate: string; outcome: 'ALREADY_ACCEPTED'; plannedActivityId: string; start: string; end: string }
  /** Safe, non-leaking machine code only -- never a raw DB error, never a
   * stack trace. See `classifyFailureReason` below for the exhaustive
   * mapping. */
  | { goalActivityId: string; localDate: string; outcome: 'FAILED'; reason: string };

export interface WeeklyAcceptanceSummary {
  requestedCount: number;
  acceptedCount: number;
  alreadyAcceptedCount: number;
  failedCount: number;
  sessions: readonly WeeklySessionAcceptanceOutcome[];
  /** Recomputed FRESH, via the same `loadEligibleGoalDemand` call every
   * session revalidation already used -- never locally decremented by
   * this file's own arithmetic (this ticket's own explicit instruction).
   * `null` only if every selection failed before any GoalActivity could
   * even be resolved (nothing to recompute demand for). */
  remainingThisWeekByGoalActivityId: ReadonlyMap<string, number>;
}

export interface WeeklyAcceptanceDeps extends GoalDemandCandidatesDeps {
  user: User;
  now: () => Date;
  /** `handleDayConstructorPreviewRequest` in production -- injected so a
   * test can supply a fake that still exercises the real
   * `runDayConstructorPreview`/signing pipeline underneath, or a fully
   * real one against a live DB (see this module's own test files). */
  runPreview: typeof handleDayConstructorPreviewRequest;
  /** `persistAcceptedConstructedDay` in production. */
  persist: typeof persistAcceptedConstructedDay;
  /** `createRealDayConstructorOrchestratorDeps` in production -- the one
   * closure `handleDayConstructorPreviewRequest` REQUIRES, so always
   * threaded through. Correctness of placement/capacity/duration does
   * not depend on anything below.
   *
   * Deliberately NOT threading through `handleDayConstructorPreviewRequest`'s
   * remaining OPTIONAL parameters (`shadowPolicy`, `loadSchedulingContext`/
   * `loadDecisionFactsFromContext`): every one of them is an enrichment
   * the real PREVIEW route adds for its own user-facing multi-intent
   * review screen (presentation-only "decision evidence"/shadow-review
   * annotations), never something `orchestrateConstructDay` itself needs
   * to place an intent correctly -- omitting any of them is, per their
   * own doc comments, "byte-identical to this ticket never having
   * existed." Two separate structural guards
   * (manualGoalProvenanceParityArchitecture.test.ts's "no policy
   * vocabulary" check for `shadowPolicy`; the Decision Scheduling Context
   * architecture guard's "exactly one production call site -- the
   * preview route" / "known only to its five modules" checks for
   * `loadSchedulingContext`/`loadDecisionFactsFromContext`) each pin
   * their respective identifier to an exact, audited file list that does
   * not include this adapter. The correct fix, in both cases, is the
   * same: this adapter genuinely has no use for either feature, so it
   * simply does not reference them -- never extend either guard's
   * allowlist for a caller that doesn't need what it protects. */
  createOrchestratorDeps: DayConstructorPreviewBoundaryDeps['createOrchestratorDeps'];
}

/** The rest of the user's CURRENT local calendar week -- the SAME bounds
 * HGR3-A's own `remainingWeekDateRange` uses, so a selection outside this
 * range (stale, or from a week that has since rolled over) is rejected
 * here rather than silently accepted for the wrong week. */
function isWithinRemainingWeek(localDate: string, planningLocalDate: string): boolean {
  if (localDate < planningLocalDate) return false;
  const bounds = localCalendarWeekBounds(planningLocalDate);
  return localDate <= bounds.endDate;
}

function toIso(value: Date): string {
  return value.toISOString();
}

/** Never leaks a raw AcceptanceRejectionReason/diagnostic detail, DB error,
 * or stack trace -- only the small, closed set of machine codes this
 * module itself defines, each traceable to a specific, understood cause. */
type SessionFailureReason =
  | 'NOT_ELIGIBLE'
  | 'OUTSIDE_CURRENT_WEEK'
  | 'PREVIEW_NOT_READY'
  | 'PREVIEW_FAILED'
  | 'ACCEPTANCE_REJECTED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'SAVE_FAILED';

function buildExplicitRangeWindow(localDate: string, timezone: string, now: Date): { explicitStart: string; explicitEnd: string } {
  const { from, to } = localDayBoundsUTC(localDate, timezone);
  const isToday = localDate === getDatePartsInTimezone(timezone, now).dateStr;
  // Mirrors the EXISTING REMAINING_TODAY path's own clamp
  // (`resolveConstructionWindow`: `start = request.now`) -- never a new
  // rule. A future date's window is the whole local day; today's window
  // starts at the authoritative clock, never at local midnight, so a
  // session can never be proposed into an already-elapsed morning.
  const explicitStart = isToday && now.getTime() > from.getTime() ? now : from;
  return { explicitStart: toIso(explicitStart), explicitEnd: toIso(to) };
}

/** One session, start to finish. Never throws on an ordinary domain
 * outcome -- only a genuine infrastructure failure inside `deps.persist`/
 * `deps.runPreview` themselves propagates, exactly like every other
 * caller of these two functions in this codebase. */
async function acceptOneSession(deps: WeeklyAcceptanceDeps, userId: string, selection: WeeklyAcceptanceSelection, planningLocalDate: string): Promise<WeeklySessionAcceptanceOutcome> {
  const { goalActivityId, localDate } = selection;

  if (!isWithinRemainingWeek(localDate, planningLocalDate)) {
    return { goalActivityId, localDate, outcome: 'FAILED', reason: 'OUTSIDE_CURRENT_WEEK' satisfies SessionFailureReason };
  }

  // Step 1 -- fresh, authoritative ownership + eligibility. Never the
  // HGR3-A response the client is confirming from; this call happens
  // now, inside THIS acceptance, independently.
  const demand = await loadEligibleGoalDemand(deps, userId, planningLocalDate, deps.user.timezone);
  if (demand.status === 'LOAD_FAILED') return { goalActivityId, localDate, outcome: 'FAILED', reason: 'PREVIEW_FAILED' satisfies SessionFailureReason };
  let candidate = demand.candidates.find((c) => c.goalActivityId === goalActivityId);

  if (!candidate) {
    // `loadEligibleGoalDemand` itself EXCLUDES a GoalActivity whose
    // weekly target is already fully met from `demand.candidates`
    // entirely (goalDemandCandidates.ts: `if (!eligibility.eligible)
    // continue;`) -- so "not found here" means EITHER "not owned by
    // this user / not a real N_PER_WEEK activity" (genuinely
    // NOT_ELIGIBLE, below) OR "owned, real, but currently has zero
    // remaining demand" -- which is exactly the state a session that
    // was ALREADY accepted (by this same request, earlier in this
    // batch, or an earlier, separate request) leaves behind. Those two
    // cases must not be conflated: only the real acceptance pipeline's
    // own idempotency check (Step 4 below) can tell "this exact session
    // already succeeded" (ALREADY_ACCEPTED) apart from "this is a
    // genuinely new, over-capacity request" (a fresh CAPACITY_EXCEEDED
    // rejection, mapped to NOT_ELIGIBLE below) -- so this file resolves
    // OWNERSHIP separately, from the raw (unfiltered-by-eligibility) rows
    // the SAME read model's own discovery query already exposes, and
    // falls through to the real preview+persist pipeline whenever
    // ownership genuinely holds, letting that pipeline's own real check
    // decide between those two cases rather than guessing here.
    const rows = await deps.loadCandidateGoalActivities(userId);
    const row = rows.find((r) => r.goalActivityId === goalActivityId);
    const rhythm = row ? normalizeGoalActivityRhythm({ rhythmKind: row.rhythmKind, rhythmTargetPerWeek: row.rhythmTargetPerWeek }) : null;
    if (!row || !rhythm || rhythm.kind !== 'N_PER_WEEK') {
      return { goalActivityId, localDate, outcome: 'FAILED', reason: 'NOT_ELIGIBLE' satisfies SessionFailureReason };
    }
    // A minimal, owned candidate for intent-building ONLY -- `remainingThisWeek`/`rhythm.*`
    // below are never read by `buildGoalPlanningSourceIntents`'s own
    // `toGenericIntent` (title/activityId/goalActivityId only); real
    // capacity enforcement happens downstream, inside the real
    // persistence transaction, regardless of this placeholder.
    candidate = { goalActivityId: row.goalActivityId, goalId: row.goalId, goalTitle: row.goalTitle, title: row.title, activityId: row.activityId, remainingThisWeek: 0, rhythm: { targetPerWeek: rhythm.targetPerWeek ?? 0, completedThisWeek: 0, committedThisWeek: 0, remainingOccurrences: 0 } };
  }

  // Step 2 -- the SAME pure mapping the existing automatic Goal-demand
  // flow already uses, never a second, hand-rolled intent builder.
  const sourceResult = buildGoalPlanningSourceIntents({ candidates: [candidate], planningLocalDate: localDate, manualGoalActivityIds: [] });
  if (sourceResult.status !== 'OK' || sourceResult.intents.length !== 1) {
    return { goalActivityId, localDate, outcome: 'FAILED', reason: 'PREVIEW_FAILED' satisfies SessionFailureReason };
  }
  const [intent] = sourceResult.intents;
  const rawGoalActivityLinks = sourceResult.goalActivityLinks;

  // Step 3 -- the real, unmodified preview pipeline, with a hand-built
  // EXPLICIT_RANGE window scoped to exactly this one date (never the
  // REMAINING_TODAY convenience path, which only ever targets today).
  const now = deps.now();
  const { explicitStart, explicitEnd } = buildExplicitRangeWindow(localDate, deps.user.timezone, now);
  const previewBody = { targetDate: localDate, constructionWindowSource: 'EXPLICIT_RANGE', explicitStart, explicitEnd, intents: [intent] };

  let previewResult: DayConstructorPreviewHttpResult;
  try {
    previewResult = await deps.runPreview({
      getSession: () => ({ userId }),
      getUser: async () => deps.user,
      getBody: async () => previewBody,
      now: () => now,
      createOrchestratorDeps: deps.createOrchestratorDeps,
    });
  } catch {
    return { goalActivityId, localDate, outcome: 'FAILED', reason: 'PREVIEW_FAILED' satisfies SessionFailureReason };
  }

  const previewBodyResult = previewResult.body as { status?: string; preview?: { constructionWindow?: ConstructionWindow; constructedDay?: { proposedItems?: Array<AcceptedProposedItem & { acceptanceToken?: unknown }> } } };
  if (previewResult.httpStatus !== 200 || previewBodyResult.status !== 'READY') {
    return { goalActivityId, localDate, outcome: 'FAILED', reason: 'PREVIEW_NOT_READY' satisfies SessionFailureReason };
  }
  const window = previewBodyResult.preview?.constructionWindow;
  const proposedItems = previewBodyResult.preview?.constructedDay?.proposedItems ?? [];
  const placed = proposedItems.find((p) => p.intentId === intent.id);
  if (!window || !placed) {
    // A legitimate, non-error deferral (e.g. NO_CANDIDATES for this one
    // date) -- never fabricated as an acceptance, never retried
    // automatically.
    return { goalActivityId, localDate, outcome: 'FAILED', reason: 'PREVIEW_NOT_READY' satisfies SessionFailureReason };
  }

  // Step 4 -- the EXACT verification -> authorization -> persistence
  // sequence `POST /api/day-constructor/accept` itself runs, in the same
  // order, on the SAME real functions (none reimplemented).
  const proposedItem: AcceptedProposedItem = { intentId: placed.intentId, activityId: placed.activityId, title: placed.title, start: placed.start, end: placed.end, placementSource: placed.placementSource };
  const tokens = new Map<string, unknown>([[placed.intentId, (placed as { acceptanceToken?: unknown }).acceptanceToken]]);
  const integrityDiagnostics = verifyAcceptanceItems(userId, window, [proposedItem], tokens);
  if (integrityDiagnostics.length > 0) return { goalActivityId, localDate, outcome: 'FAILED', reason: 'ACCEPTANCE_REJECTED' satisfies SessionFailureReason };

  const authorization = authorizeGoalActivityLinks([proposedItem], window.date, rawGoalActivityLinks);
  if (authorization.status === 'REJECTED') return { goalActivityId, localDate, outcome: 'FAILED', reason: 'ACCEPTANCE_REJECTED' satisfies SessionFailureReason };

  const clientRequestId = buildWeeklySessionClientRequestId(goalActivityId, localDate);
  const acceptRequest: AcceptConstructedDayRequest = { clientRequestId, constructionWindow: window, proposedItems: [proposedItem] };

  let persistResult: AcceptConstructedDayPersistenceResult;
  try {
    persistResult = await deps.persist(userId, acceptRequest, now, authorization.goalActivityLinks, new Map());
  } catch {
    return { goalActivityId, localDate, outcome: 'FAILED', reason: 'SAVE_FAILED' satisfies SessionFailureReason };
  }

  switch (persistResult.status) {
    case 'SAVED': {
      const plan = persistResult.plans[0];
      return { goalActivityId, localDate, outcome: 'ACCEPTED', plannedActivityId: plan.id, start: toIso(new Date(plan.plannedStartAt)), end: toIso(new Date(plan.plannedEndAt)) };
    }
    case 'ALREADY_ACCEPTED': {
      const plan = persistResult.plans[0];
      return { goalActivityId, localDate, outcome: 'ALREADY_ACCEPTED', plannedActivityId: plan.id, start: toIso(new Date(plan.plannedStartAt)), end: toIso(new Date(plan.plannedEndAt)) };
    }
    case 'REJECTED':
      return { goalActivityId, localDate, outcome: 'FAILED', reason: 'ACCEPTANCE_REJECTED' satisfies SessionFailureReason };
    case 'IDEMPOTENCY_CONFLICT':
      return { goalActivityId, localDate, outcome: 'FAILED', reason: 'IDEMPOTENCY_CONFLICT' satisfies SessionFailureReason };
    case 'SAVE_FAILED':
      // Weekly/daily capacity exhaustion is reported as the same
      // NOT_ELIGIBLE reason the pre-persistence eligibility check uses --
      // both mean "no remaining demand for this session," regardless of
      // which layer caught it. Never a raw SchedulingEligibilityErrorCode
      // (internal vocabulary) leaked to the response.
      if (persistResult.code === 'CAPACITY_EXCEEDED' || persistResult.code === 'DAILY_CAPACITY_EXCEEDED') {
        return { goalActivityId, localDate, outcome: 'FAILED', reason: 'NOT_ELIGIBLE' satisfies SessionFailureReason };
      }
      return { goalActivityId, localDate, outcome: 'FAILED', reason: 'SAVE_FAILED' satisfies SessionFailureReason };
  }
}

/**
 * The orchestration entry point -- deliberately SEQUENTIAL, never
 * parallel (this ticket's own explicit preference; the per-user advisory
 * lock inside `persistAcceptedConstructedDay` would serialize concurrent
 * calls for the same user regardless, so sequential processing costs no
 * real throughput and stays far simpler to reason about). Each session is
 * revalidated and accepted independently; a later session's failure never
 * undoes an earlier session's real success.
 */
export async function acceptWeeklyRhythmSessions(deps: WeeklyAcceptanceDeps, userId: string, planningLocalDate: string, selections: readonly WeeklyAcceptanceSelection[]): Promise<WeeklyAcceptanceSummary> {
  const bounded = selections.slice(0, MAX_WEEKLY_ACCEPTANCE_SESSIONS);
  const sessions: WeeklySessionAcceptanceOutcome[] = [];
  for (const selection of bounded) {
    sessions.push(await acceptOneSession(deps, userId, selection, planningLocalDate));
  }

  // Recomputed fresh, once per distinct GoalActivity touched by this
  // batch, AFTER every session has been attempted -- never the stale
  // per-session `candidate.remainingThisWeek` read mid-loop, and never
  // locally decremented by this function's own arithmetic.
  const remaining = new Map<string, number>();
  const goalActivityIds = [...new Set(bounded.map((s) => s.goalActivityId))];
  if (goalActivityIds.length > 0) {
    const demand = await loadEligibleGoalDemand(deps, userId, planningLocalDate, deps.user.timezone);
    if (demand.status === 'OK') {
      for (const id of goalActivityIds) {
        const candidate = demand.candidates.find((c) => c.goalActivityId === id);
        remaining.set(id, candidate ? candidate.remainingThisWeek : 0);
      }
    }
  }

  return {
    requestedCount: selections.length,
    acceptedCount: sessions.filter((s) => s.outcome === 'ACCEPTED').length,
    alreadyAcceptedCount: sessions.filter((s) => s.outcome === 'ALREADY_ACCEPTED').length,
    failedCount: sessions.filter((s) => s.outcome === 'FAILED').length,
    sessions,
    remainingThisWeekByGoalActivityId: remaining,
  };
}
