/**
 * Day Constructor V1 -- PR C: real-data orchestration + preview contract.
 *
 * ARCHITECTURAL BOUNDARY (this ticket's own section 3):
 *
 *   REQUEST (real user input)
 *     -> REAL-DATA ADAPTATION (this file)
 *     -> NORMALIZED ConstructDayInput (dayConstructor.ts's own contract)
 *     -> constructDay() (dayConstructor.ts, PURE, untouched)
 *     -> PREVIEW CONTRACT (this file)
 *
 * ORCHESTRATOR ASSEMBLES. CONSTRUCTOR DECIDES. This file makes zero
 * placement decisions of its own: it never ranks candidates, never
 * chooses a slot, never decides what gets deferred. Every one of those
 * decisions is made by `constructDay` (dayConstructor.ts), called
 * exactly once per orchestration run. This file's only job is turning
 * real, already-fetched application data into the exact inputs
 * `constructDay` already knows how to consume.
 *
 * PREVIEW ONLY (this ticket's own section 2/22/23): this file never
 * calls `createPlannedActivity`, `saveUpcomingPlanFromCandidate`, any
 * `POST /api/plans` equivalent, or anything that mutates a Plan. It
 * returns a `ConstructDayPreview` -- CHECK-before-save and acceptance
 * belong to a future PR.
 */

import type { User, HabitLogRow } from './db';
import { listPlannedActivitiesForDay, listHabitLogs, listUserAvailabilityPeriods } from './db';
import { resolveAvailability, normalizeUsableWindowsToConstructionWindow, type AvailabilityConfiguration } from './availabilityContext';
import { listUserActivityPreferences, preferredDurationByActivityId, type UserActivityPreference } from './activityPreferences';
import { deriveBehavioralProfile, activityDurationByActivityId } from './behavioralAffinity';
import { durationMinutesFor, GENERIC_DURATION_FALLBACK_MINUTES } from './dayBuilderOrchestrator';
import { localDayBoundsUTC } from './myDayOrchestrator';
import { resolveTzOffsetMinutes, getDatePartsInTimezone } from './timezone';
import { buildPersonalMuhurtaContextForUser } from './natalContext';
import { findActivityIntent, getActivityProfileById } from '../../../packages/recommendation/src/personalizedTasks';
import { classifyTask } from '../../../packages/recommendation/src/dailyAssistant';
import { familyForActivityProfile } from '../../../packages/recommendation/src/auraFitEngine';
import { runTimingSearch, type TimingCandidate, type TimingCandidateLabel, type TimingSearchRequest } from '../../../packages/recommendation/src/timingSearch';
import type { MuhurtaActivityFamily } from '../../../packages/muhurta/src/muhurtaEngine';
import {
  buildDayIntent,
  validateConstructionWindow,
  sumConstructibleDurationMinutes,
  type ConstructionWindow,
  type ConstructionWindowSource,
  type ConstructionWindowValidationError,
  type DayIntent,
  type DayIntentImportance,
  type DayIntentFlexibility,
} from './dayIntent';
import {
  constructDay,
  type ConstructDayInput,
  type ConstructDayResult,
  type ConstructedDay,
  type FixedPlacementConstraint,
  type PlacementCandidate,
  type PlacementTimingFit,
} from './dayConstructor';
import type { BlockedInterval } from './dayCapacity';

// ============================================================
// Request contract (this ticket's own section 4). USER-LEVEL input --
// the caller never manufactures a DayIntent/PlacementCandidate/
// FixedPlacementConstraint directly.
// ============================================================

/**
 * One user-declared outcome/activity, in the shape a real caller (a
 * future PR D form, or Ask Aura) can supply without knowing anything
 * about `DayIntent`'s own internal id-assignment or defaulting rules.
 * `id` is the CALLER's own stable identifier (never generated here) --
 * it survives into `ResolvedIntentSummary.requestedIntentId` and every
 * `ConstructDayWarning.intentId` so a caller can correlate its own
 * request items with the preview's own output, and is threaded straight
 * through as the resulting `DayIntent.id` (see `resolveDayIntent` below)
 * rather than being replaced by `buildDayIntent`'s own auto-incrementing
 * counter, which PR A's own doc comment already anticipates as an
 * orchestration-layer concern ("a future orchestration layer that
 * persists a DayIntent is responsible for assigning a real id at that
 * boundary").
 */
export interface RequestedDayIntent {
  id: string;
  title: string;
  /** USER-PROVIDED, optional. Trusted only after re-validating it is a
   * genuine, current catalog id (this ticket's own section 6: never
   * trust a caller-supplied id blindly) -- an invalid value is treated
   * identically to an omitted one, falling through to alias/classifier
   * resolution from `title`. */
  activityId?: string;
  /** USER-PROVIDED, optional. Wins over every resolved duration source
   * (this ticket's own section 7, step 1). */
  durationMinutes?: number;
  importance?: DayIntentImportance;
  deadline?: string;
  flexibility: DayIntentFlexibility;
  /** Required, and only meaningful, when `flexibility === 'FIXED'` -- the
   * caller's own requested absolute start instant. The matching `end` is
   * always DERIVED by this file from the resolved duration (this
   * ticket's own section 9), never separately supplied -- so a
   * `FixedPlacementConstraint`'s start/end can never disagree with the
   * intent's own resolved duration by construction, for any request this
   * file builds. */
  fixedStart?: Date;
  originalOrder: number;
}

export interface ConstructDayRequest {
  /** Local calendar date (YYYY-MM-DD) the construction window targets --
   * the SAME `dateStr` convention every other date in this pipeline
   * uses. */
  targetDate: string;
  timezone: string;
  constructionWindowSource: ConstructionWindowSource;
  /**
   * ALWAYS required, regardless of `constructionWindowSource` (pre-
   * commit review fix, this ticket's own section 7: "no hidden new
   * Date()... introduce the smallest explicit reference instant
   * required"). Serves two roles, deliberately unified into one field
   * rather than two:
   *
   *   1. For `'REMAINING_TODAY'`: the window's own `start` (unchanged
   *      from the original design).
   *   2. For EITHER window source: the REFERENCE INSTANT
   *      `isActivePlanBlocker` (below) uses to decide whether a
   *      persisted `'UPCOMING'` Plan is still an active commitment or
   *      has already elapsed into a derived `MISSED` state (this
   *      ticket's own section 3/4/5) -- never the server's own clock,
   *      never re-read per Plan.
   *
   * This file never calls `new Date()` itself.
   */
  now: Date;
  /** Required iff `constructionWindowSource === 'EXPLICIT_RANGE'`. */
  explicitStart?: Date;
  explicitEnd?: Date;
  intents: RequestedDayIntent[];
}

// ============================================================
// Dependency injection boundary (this ticket's own section 27). Narrow,
// explicit seams for the three real-data operations this file needs --
// production defaults wire them to genuine repository functions
// (`createRealDayConstructorOrchestratorDeps` below); tests inject
// deterministic fakes with no DB/network involved.
// ============================================================

/**
 * The persisted status of a real `PlannedActivity` row (db.ts) --
 * exactly the three real DB-column values, reproduced here rather than
 * imported so this file's own lifecycle adapter has a self-contained,
 * directly-testable input shape independent of the full `PlannedActivity`
 * interface (which carries many fields irrelevant to blocking, e.g.
 * `recommendation`/`score`/`calendarUrl`).
 */
export type PlanBlockerStatus = 'UPCOMING' | 'LOGGED' | 'CANCELLED';

/** The minimal shape `isActivePlanBlocker` needs to decide whether one
 * Plan blocks time -- deliberately NOT the full `PlannedActivity`
 * interface. */
export interface PlanBlockerCandidate {
  start: Date;
  end: Date;
  status: PlanBlockerStatus;
}

/**
 * PlannedActivity + reference instant -> blocking or non-blocking (this
 * ticket's own section 6 adapter; kept in the orchestrator layer, never
 * added to PR A/B, never a new schema field, never a new general
 * lifecycle framework). Reproduces -- never imports, since
 * `dailyAgenda.ts`'s own `timeBasedStatus` is a private, unexported
 * helper, and PR A already established the precedent of reproducing a
 * tiny formula rather than cross-importing across module boundaries --
 * the EXACT distinguishing fact that file's own doc comment states
 * verbatim: "a Plan whose window has elapsed is NOT automatically
 * 'completed' -- completion is decided exclusively by
 * plan.status === 'LOGGED'... An elapsed, unlogged Plan is 'MISSED'."
 *
 *   - `'CANCELLED'` never blocks. Already excluded by
 *     `listPlannedActivitiesForDay`'s own SQL filter in production
 *     (`status <> 'CANCELLED'`); re-checked here defensively for any
 *     other caller of this function.
 *   - `'LOGGED'` ALWAYS blocks, regardless of the reference instant.
 *     `dailyAgenda.ts`'s own rule --
 *     `plan.status === 'LOGGED' ? 'COMPLETED' : timeBasedStatus(...)` --
 *     never runs the elapsed-time check for a LOGGED row at all: real
 *     historical execution occupies its own time slot exactly as
 *     immutably as a future commitment does (this ticket's own section
 *     4's option A -- confirmed correct by re-reading the actual
 *     lifecycle code, not assumed).
 *   - `'UPCOMING'` blocks ONLY while it has not yet elapsed relative to
 *     `referenceInstant` (`end >= referenceInstant`) -- the exact
 *     complement of `dailyAgenda.ts`'s own `endAt < now -> 'MISSED'`
 *     rule. A derived-MISSED row (committed to, never logged, already
 *     elapsed) represents a slot nothing actually occupies, and must
 *     not block a new proposal (this ticket's own section 5, verbatim:
 *     "an old persisted UPCOMING row must NOT automatically become a
 *     blocker ... merely because storage still says UPCOMING").
 *
 * `referenceInstant` is always the orchestration request's own explicit
 * `now` (§7: "no hidden new Date()") -- for `REMAINING_TODAY` this is
 * the same instant the window itself starts from; for `EXPLICIT_RANGE`
 * it is the SAME field, reused for lifecycle purposes only (the window's
 * own bounds still come from `explicitStart`/`explicitEnd` verbatim).
 */
export function isActivePlanBlocker(plan: PlanBlockerCandidate, referenceInstant: Date): boolean {
  if (plan.status === 'CANCELLED') return false;
  if (plan.status === 'LOGGED') return true;
  return plan.end.getTime() >= referenceInstant.getTime();
}

export interface DayConstructorOrchestratorDeps {
  /** Real Plan commitments for the target local day, in the minimal
   * `PlanBlockerCandidate` shape `isActivePlanBlocker` (above) evaluates
   * -- called EXACTLY ONCE per orchestration run (this ticket's own
   * section 20), never once per intent. Lifecycle filtering
   * (`isActivePlanBlocker`) is applied by `orchestrateConstructDay`
   * itself, AFTER this call returns -- this dependency's own job is
   * only to fetch the raw rows, never to decide which ones block. */
  loadBlockingPlans: (dayBoundsUTC: { from: Date; to: Date }) => Promise<PlanBlockerCandidate[]>;
  /** The two duration-personalization maps `durationMinutesFor`
   * (dayBuilderOrchestrator.ts) already accepts -- fetched ONCE per
   * orchestration run, exactly like `buildIntentionalDaySuggestions`'s
   * own established convention (its own doc comment: "fetched by the
   * CALLER -- this function never fetches preferences/behavior itself"). */
  loadDurationContext: () => Promise<{ preferredDurationByActivityId: Readonly<Record<string, number>>; behavioralDurationByActivityId: Readonly<Record<string, number>> }>;
  /** A thin wrapper around the real, pure, synchronous `runTimingSearch`
   * -- takes everything EXCEPT `context` (already pre-bound by the
   * production factory to the real user's own location/timezone/
   * personalContext at the single `now` this orchestration run uses).
   * Called once per FLEXIBLE intent (this ticket's own section 20: "only
   * if its API inherently requires it"); never for a FIXED intent (this
   * ticket's own section 9). May throw -- `orchestrateConstructDay`
   * catches this explicitly and reports `TIMING_SEARCH_FAILED`, never
   * silently reinterpreting a thrown error as "zero candidates found"
   * (this ticket's own section 19). */
  searchTiming: (request: Omit<TimingSearchRequest, 'context'>) => { candidates: TimingCandidate[] };
  /** Availability Context V1 PR H1 -- the user's saved availability
   * schedule, in the exact shape `resolveAvailability`
   * (availabilityContext.ts) consumes. Called EXACTLY ONCE per
   * orchestration run, same convention as `loadDurationContext` above.
   * This dependency's own job is only to fetch `User.
   * availabilityConfigured` + the raw period rows -- it makes no
   * resolution decision of its own (that stays entirely inside the pure
   * `resolveAvailability`, never duplicated here). */
  loadAvailabilityConfiguration: () => Promise<AvailabilityConfiguration>;
}

/**
 * Real production wiring. Reuses existing repository functions verbatim
 * -- no new DB query shape, no new engine call:
 *
 *   - `listPlannedActivitiesForDay` (db.ts) -- the EXACT SAME function
 *     Forward Planner's own orchestrator already uses as its own raw row
 *     source (forwardPlannerOrchestrator.ts). Its own SQL filter already
 *     excludes `CANCELLED`; `status` is passed straight through
 *     (verbatim, not re-derived) to `isActivePlanBlocker` (this file's
 *     own lifecycle adapter, pre-commit review fix), which is what
 *     decides LOGGED-vs-UPCOMING-vs-elapsed-MISSED blocking -- this
 *     factory itself performs NO filtering of its own.
 *   - `listUserActivityPreferences` + `preferredDurationByActivityId`
 *     (activityPreferences.ts), `listHabitLogs` + `deriveBehavioralProfile`
 *     + `activityDurationByActivityId` (behavioralAffinity.ts) -- the
 *     SAME two-map assembly `dayBuilderOrchestrator.ts`'s own callers
 *     already perform before calling `durationMinutesFor`.
 *   - `runTimingSearch` (timingSearch.ts) -- called verbatim, with
 *     `context` pre-bound from the real `user`/`now` this factory
 *     closes over (`resolveTzOffsetMinutes`, `buildPersonalMuhurtaContextForUser`
 *     -- the SAME two calls `buildIntentionalDaySuggestions` already
 *     makes to build its own `DailyAssistantContext`).
 */
export function createRealDayConstructorOrchestratorDeps(user: User, now: Date): DayConstructorOrchestratorDeps {
  return {
    loadBlockingPlans: async (dayBoundsUTC) => {
      const plans = await listPlannedActivitiesForDay(user.id, dayBoundsUTC.from, dayBoundsUTC.to);
      return plans.map((plan) => ({ start: new Date(plan.plannedStartAt), end: new Date(plan.plannedEndAt), status: plan.status }));
    },
    loadDurationContext: async () => {
      const [preferences, habitLogs]: [UserActivityPreference[], HabitLogRow[]] = await Promise.all([listUserActivityPreferences(user.id), listHabitLogs(user.id)]);
      const behavioralProfile = deriveBehavioralProfile(habitLogs, user.timezone, now);
      return {
        preferredDurationByActivityId: preferredDurationByActivityId(preferences),
        behavioralDurationByActivityId: activityDurationByActivityId(behavioralProfile),
      };
    },
    searchTiming: (request) => {
      const context: TimingSearchRequest['context'] = {
        now,
        latitude: user.latitude,
        longitude: user.longitude,
        timezone: user.timezone,
        tzOffsetMinutes: resolveTzOffsetMinutes(user.timezone, now),
        personalContext: buildPersonalMuhurtaContextForUser(user),
      };
      return runTimingSearch({ ...request, context } as TimingSearchRequest);
    },
    loadAvailabilityConfiguration: async () => {
      const periods = await listUserAvailabilityPeriods(user.id);
      return {
        configured: user.availabilityConfigured === true,
        periods: periods.map((row) => ({ weekday: row.weekday as AvailabilityConfiguration['periods'][number]['weekday'], startTime: row.startTime, endTime: row.endTime })),
      };
    },
  };
}

// ============================================================
// Timing label mapping (this ticket's own section 11) -- ONE explicit
// adapter, defined exactly once, reused for every candidate. Mirrors
// `homeTimelineComposer.ts`'s own established `mapTimingLabelToHomeStatus`
// tier collapse (EXCELLENT/VERY_GOOD -> best tier, GOOD -> good tier,
// USABLE -> workable tier, CAUTION -> caution tier) -- NOT imported from
// there (that function returns presentation-cased 'Best'/'Good'/etc.
// strings for a different, presentation-owned type; importing it here
// would blur this file's own domain boundary), but semantically
// identical and non-arbitrary: every one of the five real
// `TimingCandidateLabel` values maps to exactly one `PlacementTimingFit`
// tier with no ambiguity, so this file never had to stop and ask for a
// product decision here (this ticket's own section 11's own escape
// hatch was not needed).
// ============================================================

function mapTimingLabelToPlacementFit(label: TimingCandidateLabel): PlacementTimingFit {
  switch (label) {
    case 'EXCELLENT':
    case 'VERY_GOOD':
      return 'BEST';
    case 'GOOD':
      return 'GOOD';
    case 'USABLE':
      return 'WORKABLE';
    case 'CAUTION':
      return 'CAUTION';
  }
}

// ============================================================
// Intent resolution (this ticket's own section 6). Preferred hierarchy,
// implemented literally:
//   1. explicit, RE-VALIDATED activityId (never trusted blindly)
//   2. findActivityIntent alias/title match
//   3. classifyTask coarse-family fallback (NEVER fabricates an
//      activityId -- activityId stays undefined, only activityFamily is
//      set, exactly this ticket's own "allowed: activityId = undefined,
//      activityFamily = resolved coarse family. Do not invent a catalog
//      match" instruction).
// ============================================================

interface ActivityResolution {
  activityId?: string;
  activityFamily?: MuhurtaActivityFamily;
  resolvedToCoarseFamily: boolean;
}

function resolveActivity(requested: RequestedDayIntent): ActivityResolution {
  if (requested.activityId) {
    const validated = getActivityProfileById(requested.activityId);
    if (validated) return { activityId: validated.id, activityFamily: familyForActivityProfile(validated), resolvedToCoarseFamily: false };
    // A supplied but unrecognized activityId is never trusted -- fall
    // through to title-based resolution exactly as if none had been
    // supplied at all (this ticket's own section 6: "Trusted only after
    // re-validating it is a genuine, current catalog id").
  }
  const aliasMatch = findActivityIntent(requested.title);
  if (aliasMatch) return { activityId: aliasMatch.id, activityFamily: familyForActivityProfile(aliasMatch), resolvedToCoarseFamily: false };

  const classified = classifyTask(requested.title);
  return { activityId: undefined, activityFamily: classified.family, resolvedToCoarseFamily: true };
}

// ============================================================
// Duration resolution (this ticket's own section 7, extended by Intent
// Fidelity V1 PR G2). Reuses `durationMinutesFor` (dayBuilderOrchestrator.ts)
// verbatim -- the SAME canonical chain already documented there: explicit
// preference -> behavioral typical duration -> catalog default -> catalog
// suggested -> `GENERIC_DURATION_FALLBACK_MINUTES`. That floor is NOT a
// new arbitrary fallback invented by this file -- it is
// `durationMinutesFor`'s own, already-canonical, already-shipped final
// case, and its own existing test suite already proves it is a general
// "no activity-specific signal at all" default (it fires even for a
// syntactically-valid but nonexistent activity id), not one scoped to
// resolved catalog activities.
//
// PR G2 (post-V1 audit gap G2): a free-text intent that never resolved a
// real `activityId` (a pure coarse-family fallback, or no classification
// signal at all) used to leave `estimatedDurationMinutes` `undefined`
// here -- `durationMinutesFor` cannot be called at all without a real
// `activityId` string (it looks up `getActivityDefinition(activityId)`
// internally), and the domain-level 45-minute floor lived ONLY inside
// that function, unreachable from this branch. This file still never
// fabricates a placeholder id merely to reach that function (identity
// and duration estimation stay separate concerns, this ticket's own
// section 7/9) -- instead it now applies the SAME
// `GENERIC_DURATION_FALLBACK_MINUTES` directly, since the audit
// confirmed that value already means "no better information exists,"
// which is exactly the situation an unresolved `activityId` represents.
// `fromGenericFallback: true` here activates the SAME already-shipped
// `DURATION_FROM_GENERIC_FALLBACK` warning/"Estimated duration" preview
// copy a resolved activity would get from `durationMinutesFor`'s own
// final case -- no new presentation path, this file's own already-built
// one simply becomes reachable for this input shape too.
// ============================================================

interface DurationResolution {
  estimatedDurationMinutes?: number;
  /** True whenever the returned value came from the generic duration
   * floor rather than an explicit request, a stored preference, a
   * behavioral pattern, or a real catalog default/suggested duration --
   * whether that floor was reached via `durationMinutesFor` (a resolved
   * activity with no stronger signal) or applied directly here (no
   * resolved activity at all, this ticket's own PR G2). An explanation
   * fact, not a failure. */
  fromGenericFallback: boolean;
}

function resolveDuration(
  requested: RequestedDayIntent,
  activityId: string | undefined,
  durationContext: { preferredDurationByActivityId: Readonly<Record<string, number>>; behavioralDurationByActivityId: Readonly<Record<string, number>> }
): DurationResolution {
  if (requested.durationMinutes !== undefined) return { estimatedDurationMinutes: requested.durationMinutes, fromGenericFallback: false };
  if (!activityId) return { estimatedDurationMinutes: GENERIC_DURATION_FALLBACK_MINUTES, fromGenericFallback: true };

  const resolved = durationMinutesFor(activityId, durationContext.preferredDurationByActivityId, durationContext.behavioralDurationByActivityId);
  const cameFromPreference = durationContext.preferredDurationByActivityId[activityId] !== undefined;
  const cameFromBehavior = durationContext.behavioralDurationByActivityId[activityId] !== undefined;
  const catalogProfile = getActivityProfileById(activityId);
  const cameFromCatalog = catalogProfile?.defaultDurationMinutes !== undefined;
  return { estimatedDurationMinutes: resolved, fromGenericFallback: !cameFromPreference && !cameFromBehavior && !cameFromCatalog };
}

/**
 * Availability Context V1 PR H1 hardening -- the ONE shared per-intent
 * resolution step (`resolveActivity` + `resolveDuration` +
 * `buildDayIntent`), extracted so the CONFIGURED_EMPTY early-exit path
 * below and the normal per-intent loop both call the EXACT SAME code,
 * never a second/duplicated resolution. Deliberately excludes
 * `runTimingSearch`/`FixedPlacementConstraint` construction -- those are
 * placement concerns, not duration-resolution concerns (this ticket's
 * own section 9/13: "duration resolution and timing search are separate
 * concerns... avoid duplicating resolveActivity/resolveDuration... if
 * existing orchestration can expose/reuse them cleanly"), so a caller
 * that only needs a resolved `DayIntent` (e.g. to sum requested minutes)
 * never pays for a timing-search call it doesn't need.
 */
function resolveRequestedDayIntent(
  requested: RequestedDayIntent,
  targetDate: string,
  durationContext: { preferredDurationByActivityId: Readonly<Record<string, number>>; behavioralDurationByActivityId: Readonly<Record<string, number>> }
): { dayIntent: DayIntent; warnings: ConstructDayWarning[] } {
  const warnings: ConstructDayWarning[] = [];
  const activity = resolveActivity(requested);
  if (activity.resolvedToCoarseFamily) warnings.push({ intentId: requested.id, code: 'ACTIVITY_RESOLVED_TO_COARSE_FAMILY' });

  const duration = resolveDuration(requested, activity.activityId, durationContext);
  if (duration.fromGenericFallback) warnings.push({ intentId: requested.id, code: 'DURATION_FROM_GENERIC_FALLBACK' });

  // buildDayIntent performs its own validation/defaulting (importance,
  // flexibility, dates); its auto-assigned `id` is then overridden with
  // the caller's own requested id (see RequestedDayIntent.id's own doc
  // comment) -- everything else about the built DayIntent is kept.
  const built = buildDayIntent(
    {
      title: requested.title,
      targetDate,
      deadline: requested.deadline,
      importance: requested.importance,
      activityId: activity.activityId,
      activityFamily: activity.activityFamily,
      estimatedDurationMinutes: duration.estimatedDurationMinutes,
      flexibility: requested.flexibility,
    },
    requested.originalOrder
  );
  return { dayIntent: { ...built, id: requested.id }, warnings };
}

// ============================================================
// Warnings (this ticket's own section 18) -- distinct from constructor
// failures. A warning never turns a valid proposal into an error.
// ============================================================

export type ConstructDayWarningCode = 'ACTIVITY_RESOLVED_TO_COARSE_FAMILY' | 'DURATION_FROM_GENERIC_FALLBACK' | 'NO_TIMING_CANDIDATES_FOUND';

export interface ConstructDayWarning {
  /** The REQUESTED intent's own caller-supplied id (never the internal
   * `DayIntent.id`, though for this file's own construction the two are
   * always identical -- see `RequestedDayIntent.id`'s own doc comment). */
  intentId: string;
  code: ConstructDayWarningCode;
}

// ============================================================
// Preview contract (this ticket's own section 17). Small, sufficient for
// a future PR D to render what Aura proposes, what could not be placed
// and why, capacity state, and which times were Aura-selected vs.
// user-fixed -- without inventing any UI copy here.
// ============================================================

export interface ResolvedIntentSummary {
  requestedIntentId: string;
  dayIntent: DayIntent;
}

export interface ConstructDayPreview {
  targetDate: string;
  timezone: string;
  constructionWindow: ConstructionWindow;
  resolvedIntents: ResolvedIntentSummary[];
  constructedDay: ConstructedDay;
  warnings: ConstructDayWarning[];
}

/**
 * Top-level orchestration result. `'READY'` carries the full preview.
 * `'NO_USABLE_CAPACITY'`/`'INVALID_CONSTRUCTION_WINDOW'`/`'TIMEZONE_MISSING'`
 * are passed straight through from `constructDay`'s own fail-closed
 * contract (dayConstructor.ts/dayCapacity.ts) -- never re-derived or
 * re-worded here. `'INVALID_REQUEST'` covers a malformed
 * `ConstructDayRequest` itself (this ticket's own section 5: e.g.
 * `REMAINING_TODAY` without `now`, `EXPLICIT_RANGE` without explicit
 * bounds) caught BEFORE any real-data fetch is attempted.
 * `'TIMING_SEARCH_FAILED'` is the explicit distinction this ticket's own
 * section 19 requires: a thrown/failed search is never silently
 * reinterpreted as "this intent simply has no good candidates" (which
 * stays a legitimate, non-error `NO_CANDIDATES` deferral inside
 * `constructedDay.deferredItems`).
 */
export type OrchestrateConstructDayResult =
  | { status: 'READY'; preview: ConstructDayPreview }
  | { status: 'NO_USABLE_CAPACITY'; constructionWindowMinutes: number; blockedMinutes: number; requestedMinutes: number }
  | { status: 'INVALID_CONSTRUCTION_WINDOW'; error: ConstructionWindowValidationError }
  | { status: 'TIMEZONE_MISSING' }
  | { status: 'INVALID_REQUEST'; reason: string }
  | { status: 'TIMING_SEARCH_FAILED'; requestedIntentId: string; reason: string }
  /** Planning Horizon V1 PR P1 (this ticket's own section 8/12/13/22) --
   * `constructionWindowSource === 'REMAINING_TODAY'`, availability is
   * UNCONFIGURED, and `targetDate` is NOT the caller's own current civil
   * day. The pre-P1 REMAINING_TODAY fallback (`start = request.now`,
   * `end = that future day's own midnight`) is only ever correct when
   * `targetDate` IS today -- reusing it for a future date would silently
   * construct a window spanning from right now through a LATER day's
   * midnight. Rather than inventing a full-civil-day/default-daytime/
   * 9-5 fallback (which `dayIntent.ts`'s own locked principle forbids:
   * "the constructor must never pretend that an application default
   * represents known user availability"), this fails closed: future
   * planning requires a real, saved Availability configuration. `TODAY`
   * + UNCONFIGURED is completely unaffected -- see
   * `resolveAvailabilityAwareWindow` below. */
  | { status: 'FUTURE_AVAILABILITY_REQUIRED' };

// ============================================================
// Construction window resolution (this ticket's own section 5) -- no
// silent working-day/sleep inference. REMAINING_TODAY's own `start` is
// the request's own explicit `now`; its `end` is the target local day's
// own midnight boundary (`localDayBoundsUTC`, the SAME canonical
// dateStr-based helper Forward Planner/Daily Agenda already use --
// never a server-local calendar day). EXPLICIT_RANGE uses the caller's
// own explicit bounds verbatim.
// ============================================================

type ConstructionWindowResolution =
  | { status: 'READY'; window: ConstructionWindow }
  | { status: 'INVALID_REQUEST'; reason: string }
  | { status: 'TIMEZONE_MISSING' }
  | { status: 'INVALID_CONSTRUCTION_WINDOW'; error: ConstructionWindowValidationError };

function resolveConstructionWindow(request: ConstructDayRequest): ConstructionWindowResolution {
  if (!request.timezone || !request.timezone.trim()) return { status: 'TIMEZONE_MISSING' };
  // `now` is required for BOTH window sources as of the pre-commit
  // review fix (see ConstructDayRequest.now's own doc comment) -- a
  // defensive runtime check here, since a JS/JSON caller crossing a
  // request boundary is not bound by the TypeScript type.
  if (!(request.now instanceof Date) || Number.isNaN(request.now.getTime())) return { status: 'INVALID_REQUEST', reason: 'now must be a valid Date, for either constructionWindowSource.' };

  let start: Date;
  let end: Date;
  if (request.constructionWindowSource === 'REMAINING_TODAY') {
    start = request.now;
    end = localDayBoundsUTC(request.targetDate, request.timezone).to;
  } else {
    if (!request.explicitStart || !request.explicitEnd) return { status: 'INVALID_REQUEST', reason: 'explicitStart and explicitEnd are required when constructionWindowSource is EXPLICIT_RANGE.' };
    start = request.explicitStart;
    end = request.explicitEnd;
  }

  const window: ConstructionWindow = { date: request.targetDate, start, end, timezone: request.timezone, source: request.constructionWindowSource };
  const error = validateConstructionWindow(window);
  if (error) return error.code === 'TIMEZONE_MISSING' ? { status: 'TIMEZONE_MISSING' } : { status: 'INVALID_CONSTRUCTION_WINDOW', error };
  return { status: 'READY', window };
}

// ============================================================
// Candidate normalization (this ticket's own section 10/12/13).
//
// SAFETY OF candidate.start AS AN EXACT PLACEMENT START (this ticket's
// own section 12, the "STOP if unsafe" checkpoint): confirmed safe, no
// stop required. `runTimingSearch`'s FIND mode (timingSearch.ts) always
// receives `durationMinutes` as a REQUEST-LEVEL field (never per-
// candidate) and evaluates each stepped instant via
// `evaluateTimingCandidate({profile, start, durationMinutes, context})`
// -- meaning every returned `TimingCandidate` already has
// `end - start === durationMinutes`, the EXACT duration this file
// requested. There is no "broad window containing an implied good
// sub-period" case to normalize around: a FIND candidate's own
// [start, end) IS already the exact, duration-matched placement PR B's
// own `deriveExactInterval` expects. Passing it through verbatim (never
// widening or re-deriving it here) is therefore safe and correct.
//
// `candidateOrder` is the candidate's own position in
// `TimingSearchResponse.candidates` -- FIND's own result is already
// ranked/sorted by the engine itself, so preserving array index
// preserves a real, meaningful, deterministic order (this ticket's own
// section 10 example: "e.g. the position runTimingSearch's own FIND
// result already returned them in"), never re-derived independently
// here.
//
// Malformed engine output (this ticket's own section 28: "malformed
// timing candidates filtered/fail safely") is dropped at this
// normalization boundary -- a candidate whose own `start`/`end` do not
// parse to a valid, ordered Date pair never reaches `constructDay` at
// all (`null` return, filtered by the caller).
// ============================================================

function normalizeCandidate(intentId: string, candidate: TimingCandidate, candidateOrder: number): PlacementCandidate | null {
  const start = new Date(candidate.start);
  const end = new Date(candidate.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start.getTime() >= end.getTime()) return null;
  return { intentId, start, end, timingFit: mapTimingLabelToPlacementFit(candidate.label), candidateOrder };
}

// ============================================================
// orchestrateConstructDay -- the main entry point. ORCHESTRATOR
// ASSEMBLES, CONSTRUCTOR DECIDES (this ticket's own section 3): every
// placement decision below is made by exactly one `constructDay` call;
// this function only resolves real data into that call's own inputs.
// ============================================================

/**
 * Availability Context V1 PR H1 -- resolves the target-day window using a
 * user's saved availability when one exists, otherwise defers entirely to
 * the EXISTING `resolveConstructionWindow` (below, untouched). Only ever
 * consulted for `constructionWindowSource === 'REMAINING_TODAY'` --
 * `EXPLICIT_RANGE` is an already-fully-specified caller-supplied window
 * and is never reinterpreted through availability (architecture audit's
 * own section 40 recommendation).
 *
 * UNCONFIGURED -> `{ status: 'UNCONFIGURED_TODAY' }` (targetDate IS the
 * caller's own current civil day) -> the caller must fall through to
 * `resolveConstructionWindow(request)` verbatim (this ticket's own
 * section 19 -- zero behavioral change for an existing user), OR
 * `{ status: 'FUTURE_AVAILABILITY_REQUIRED' }` (targetDate is NOT today
 * -- Planning Horizon V1 PR P1, this ticket's own section 8/12) -- the
 * caller must fail the whole orchestration closed, NEVER fall through to
 * `resolveConstructionWindow(request)` for a non-today date (see
 * `OrchestrateConstructDayResult['FUTURE_AVAILABILITY_REQUIRED']`'s own
 * doc comment for why). `resolveAvailability` itself is untouched --
 * this "is targetDate today" check is deliberately made HERE, at the
 * orchestration boundary (this ticket's own section 8: "Prefer enforcing
 * this at the orchestration boundary"), never inside the pure resolver.
 *
 * CONFIGURED with zero usable windows (this ticket's own section 18,
 * "CONFIGURED_EMPTY") -> `{ status: 'NO_USABLE_CAPACITY' }`: the caller
 * must report this directly, NEVER fabricate a zero-length
 * `ConstructionWindow` to pass through the normal path (this ticket's
 * own section 28 -- `validateConstructionWindow` already rejects
 * `start >= end` as `INVALID_CONSTRUCTION_WINDOW`, the wrong status for
 * a genuinely, deliberately empty day). Unaffected by P1 -- CONFIGURED_
 * EMPTY reaches this status regardless of which date it targets.
 *
 * CONFIGURED with at least one usable window -> `{ status: 'READY',
 * window, gapBlockers }`: `window` replaces what
 * `resolveConstructionWindow` would have produced; `gapBlockers` must be
 * merged into the existing Plan-blocker list before normalization
 * (architecture audit's own section 23/56 -- `dayConstructor.ts`/
 * `dayCapacity.ts` still consume exactly one window + one blocker list,
 * unchanged). Unaffected by P1 -- a future date's CONFIGURED windows
 * were already correctly unclipped by `resolveAvailability` before this
 * ticket existed.
 */
async function resolveAvailabilityAwareWindow(
  request: ConstructDayRequest,
  deps: DayConstructorOrchestratorDeps
): Promise<
  | { status: 'UNCONFIGURED_TODAY' }
  | { status: 'FUTURE_AVAILABILITY_REQUIRED' }
  | { status: 'NO_USABLE_CAPACITY' }
  | { status: 'READY'; window: ConstructionWindow; gapBlockers: BlockedInterval[] }
> {
  const availabilityConfig = await deps.loadAvailabilityConfiguration();
  const resolution = resolveAvailability({ targetDate: request.targetDate, timezone: request.timezone, now: request.now, configuration: availabilityConfig });
  if (resolution.status === 'UNCONFIGURED') {
    const isTargetDateToday = request.targetDate === getDatePartsInTimezone(request.timezone, request.now).dateStr;
    return isTargetDateToday ? { status: 'UNCONFIGURED_TODAY' } : { status: 'FUTURE_AVAILABILITY_REQUIRED' };
  }
  if (resolution.usableWindows.length === 0) return { status: 'NO_USABLE_CAPACITY' };
  const normalized = normalizeUsableWindowsToConstructionWindow(resolution.usableWindows, request.targetDate, request.timezone)!;
  return { status: 'READY', window: normalized.window, gapBlockers: normalized.gapBlockers };
}

export async function orchestrateConstructDay(request: ConstructDayRequest, deps: DayConstructorOrchestratorDeps): Promise<OrchestrateConstructDayResult> {
  // Same defensive runtime checks `resolveConstructionWindow` itself
  // performs (below, untouched) -- duplicated here ONLY so a malformed
  // request fails before `deps.loadAvailabilityConfiguration`'s own I/O
  // is ever attempted, never to change either check's own behavior.
  if (!request.timezone || !request.timezone.trim()) return { status: 'TIMEZONE_MISSING' };
  if (!(request.now instanceof Date) || Number.isNaN(request.now.getTime())) return { status: 'INVALID_REQUEST', reason: 'now must be a valid Date, for either constructionWindowSource.' };

  let window: ConstructionWindow;
  let availabilityGapBlockers: BlockedInterval[] = [];

  if (request.constructionWindowSource === 'REMAINING_TODAY') {
    const availabilityWindow = await resolveAvailabilityAwareWindow(request, deps);
    if (availabilityWindow.status === 'FUTURE_AVAILABILITY_REQUIRED') {
      // Planning Horizon V1 PR P1 -- fails the whole orchestration closed
      // before any real-data fetch beyond `loadAvailabilityConfiguration`
      // is attempted (this ticket's own section 8/12): never falls
      // through to `resolveConstructionWindow`'s REMAINING_TODAY branch,
      // which is only correct for today.
      return { status: 'FUTURE_AVAILABILITY_REQUIRED' };
    }
    if (availabilityWindow.status === 'NO_USABLE_CAPACITY') {
      // CONFIGURED_EMPTY hardening: `requestedMinutes` means "the total
      // resolved duration requested by the user," identical to the
      // normal path's own semantics -- never "0 because we exited
      // early." Resolves each intent's real duration via the EXACT SAME
      // `resolveRequestedDayIntent` (and its own `resolveActivity`/
      // `resolveDuration`/`buildDayIntent`) the normal per-intent loop
      // below calls, then sums via the SAME canonical
      // `sumConstructibleDurationMinutes` `constructDay` itself uses --
      // no second duration resolver, no timing search (never reached:
      // this file's own `resolveRequestedDayIntent` never calls
      // `deps.searchTiming`), no `constructDay` call, no candidate
      // generation, no fabricated window.
      const durationContext = await deps.loadDurationContext();
      const dayIntents = request.intents.map((requested) => resolveRequestedDayIntent(requested, request.targetDate, durationContext).dayIntent);
      const { totalMinutes: requestedMinutes } = sumConstructibleDurationMinutes(dayIntents);
      return { status: 'NO_USABLE_CAPACITY', constructionWindowMinutes: 0, blockedMinutes: 0, requestedMinutes };
    }
    if (availabilityWindow.status === 'READY') {
      window = availabilityWindow.window;
      availabilityGapBlockers = availabilityWindow.gapBlockers;
    } else {
      // UNCONFIGURED_TODAY (the only remaining possibility here -- the
      // FUTURE_AVAILABILITY_REQUIRED case already returned above) -- the
      // exact existing REMAINING_TODAY path, unchanged (this ticket's
      // own section 9).
      const windowResolution = resolveConstructionWindow(request);
      if (windowResolution.status !== 'READY') return windowResolution;
      window = windowResolution.window;
    }
  } else {
    // EXPLICIT_RANGE -- never touched by availability resolution.
    const windowResolution = resolveConstructionWindow(request);
    if (windowResolution.status !== 'READY') return windowResolution;
    window = windowResolution.window;
  }

  // Real-data fetches -- EXACTLY ONCE each per orchestration run (this
  // ticket's own section 20), never once per intent.
  const dayBounds = localDayBoundsUTC(request.targetDate, request.timezone);
  const [blockingPlanCandidates, durationContext] = await Promise.all([deps.loadBlockingPlans(dayBounds), deps.loadDurationContext()]);
  // Lifecycle filtering happens HERE, in the orchestrator's own testable
  // core (this ticket's own section 6: "Keep this in the orchestrator
  // layer") -- `deps.loadBlockingPlans` only fetches raw rows;
  // `isActivePlanBlocker` (above) is what actually decides LOGGED (always
  // blocks) vs CANCELLED (never blocks) vs UPCOMING (blocks only while
  // not yet elapsed relative to `request.now`, the SAME reference
  // instant regardless of window source -- see ConstructDayRequest.now's
  // own doc comment). Availability-gap blockers (Availability Context V1
  // PR H1) are prepended -- `[]` for every UNCONFIGURED/EXPLICIT_RANGE
  // request, so this list is byte-identical to before in those cases.
  const blockedIntervals: BlockedInterval[] = [
    ...availabilityGapBlockers,
    ...blockingPlanCandidates.filter((plan) => isActivePlanBlocker(plan, request.now)).map((plan) => ({ start: plan.start, end: plan.end, source: 'FIXED_PLAN' as const })),
  ];

  const warnings: ConstructDayWarning[] = [];
  const resolvedIntents: ResolvedIntentSummary[] = [];
  const candidatesByIntentId: Record<string, PlacementCandidate[]> = {};
  const fixedConstraintsByIntentId: Record<string, FixedPlacementConstraint[]> = {};

  for (const requested of request.intents) {
    const { dayIntent, warnings: intentWarnings } = resolveRequestedDayIntent(requested, request.targetDate, durationContext);
    warnings.push(...intentWarnings);
    resolvedIntents.push({ requestedIntentId: requested.id, dayIntent });

    if (requested.flexibility === 'FIXED') {
      // Never manufacture a PlacementCandidate for a FIXED intent (this
      // ticket's own section 9) -- candidatesByIntentId is simply never
      // populated for this intent's own id.
      if (requested.fixedStart && dayIntent.estimatedDurationMinutes !== undefined) {
        const end = new Date(requested.fixedStart.getTime() + dayIntent.estimatedDurationMinutes * 60000);
        fixedConstraintsByIntentId[dayIntent.id] = [{ intentId: dayIntent.id, start: requested.fixedStart, end }];
      }
      // A missing fixedStart, or an unresolved duration, leaves
      // fixedConstraintsByIntentId[dayIntent.id] unset entirely --
      // constructDay's own placeFixedIntent (or its own DURATION_UNKNOWN
      // gate, evaluated first) produces the correct typed deferral. This
      // file never converts a FIXED intent to FLEXIBLE to route around a
      // missing constraint (this ticket's own explicit prohibition).
      continue;
    }

    // FLEXIBLE
    if (dayIntent.estimatedDurationMinutes === undefined) continue; // constructDay's own DURATION_UNKNOWN gate handles this; no search to run.

    // Construction-Window-Aware Timing Search V1 -- `searchWindow` is the
    // SAME resolved `window` every candidate is later checked against in
    // `evaluateCandidate` (dayConstructor.ts's own `isWithinWindow` gate),
    // passed straight through with zero conversion (both are already the
    // same `{ start: Date; end: Date }` absolute-instant shape). This is
    // what fixes the root cause the audit found: FIND's own candidate
    // ranking/limit now only ever considers instants this specific
    // orchestration run could actually use, so a narrow construction
    // window can no longer have its own genuinely-feasible in-window
    // candidates silently truncated away in favor of higher-scoring but
    // useless out-of-window ones. `dayConstructor.ts`'s own feasibility
    // gates (window/blockers/conflicts) are completely unchanged and
    // remain the sole authority on final placement -- this only narrows
    // what FIND bothers to generate and rank in the first place.
    const searchWindow = { start: window.start, end: window.end };
    const searchRequest: Omit<TimingSearchRequest, 'context'> = dayIntent.activityId
      ? { mode: 'FIND', activityId: dayIntent.activityId, durationMinutes: dayIntent.estimatedDurationMinutes, dateRange: { start: request.targetDate, end: request.targetDate }, searchWindow }
      : { mode: 'FIND', taskTitle: requested.title, durationMinutes: dayIntent.estimatedDurationMinutes, dateRange: { start: request.targetDate, end: request.targetDate }, searchWindow };

    let searchResult: { candidates: TimingCandidate[] };
    try {
      searchResult = deps.searchTiming(searchRequest);
    } catch (err) {
      // Infrastructure/search failure -- distinct from "no candidates
      // exist" (this ticket's own section 19). Fails the whole
      // orchestration closed rather than silently deferring this one
      // intent as though the engine had genuinely found nothing.
      return { status: 'TIMING_SEARCH_FAILED', requestedIntentId: requested.id, reason: err instanceof Error ? err.message : String(err) };
    }

    const normalized = searchResult.candidates
      .map((candidate, index) => normalizeCandidate(dayIntent.id, candidate, index))
      .filter((candidate): candidate is PlacementCandidate => candidate !== null);
    candidatesByIntentId[dayIntent.id] = normalized;
    if (normalized.length === 0) warnings.push({ intentId: requested.id, code: 'NO_TIMING_CANDIDATES_FOUND' });
  }

  // Exactly one constructDay call -- every placement decision is made
  // there, never in this file (this ticket's own section 3).
  const constructInput: ConstructDayInput = {
    intents: resolvedIntents.map((r) => r.dayIntent),
    window,
    blockedIntervals,
    candidatesByIntentId,
    fixedConstraintsByIntentId,
    today: request.targetDate,
  };
  const result: ConstructDayResult = constructDay(constructInput);
  if (result.status !== 'READY') return result;

  return {
    status: 'READY',
    preview: {
      targetDate: request.targetDate,
      timezone: request.timezone,
      constructionWindow: window,
      resolvedIntents,
      constructedDay: result.day,
      warnings,
    },
  };
}
