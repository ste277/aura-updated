/**
 * HGR3-B / HGR3-BH -- Secure Weekly Rhythm Proposal Acceptance, hardened.
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
 * HGR3-BH -- PRODUCT CONTRACT HARDENING (resolves the independent review's
 * 2 P1 findings on the original HGR3-B): Aura recommends a specific time
 * using Panchangam + practical constraints; the user approves THAT time;
 * Aura commits THAT exact time or returns a clear failure requiring
 * renewed approval -- it never silently substitutes a different one. The
 * original HGR3-B deliberately never accepted a client-supplied time at
 * all (building a FLEXIBLE intent and letting the Constructor re-place
 * freely); this review found that discards the exact time (and Muhurta
 * rationale) the user actually reviewed. Both findings are fixed below.
 *
 * THE CONVERSION PATH, per session:
 *  1. INPUT VALIDATION (HGR3-BH) -- `start`/`end` are real ISO instants,
 *     `start < end`, the resulting duration is a sane positive integer
 *     number of minutes, and `start`'s own user-local civil date is
 *     EXACTLY `localDate` (never trusted as already-consistent -- a
 *     client could send any combination). A `start` at or before `now`
 *     is rejected outright (`TIME_ALREADY_ELAPSED`) -- but only AFTER the
 *     idempotency short-circuit below, since a genuine replay of an
 *     already-accepted session must still resolve `ALREADY_ACCEPTED`
 *     even once its own committed time has since passed.
 *  2. IDEMPOTENCY SHORT-CIRCUIT (HGR3-BH, read-only, no preview call) --
 *     see the "RETRY RECONCILIATION" section below. Computed BEFORE any
 *     fresh preview/placement is attempted, specifically so a retry of an
 *     already-accepted FIXED session never has to re-run placement at
 *     all -- which matters because that session's own already-persisted
 *     Plan would otherwise show up as a live blocker against itself (see
 *     that section for the full reasoning).
 *  3. AVAILABILITY (HGR3-BH) -- when the user has a saved, CONFIGURED
 *     Availability Context (availabilityContext.ts) for this local date,
 *     the approved [start, end) must fall entirely inside at least one of
 *     that day's resolved usable windows, or this session fails
 *     `OUTSIDE_AVAILABILITY` rather than silently placing outside it. See
 *     the "AVAILABILITY CONTEXT POLICY" section below for why this is an
 *     adapter-level addition, never a change to the shared orchestrator.
 *  4. `loadEligibleGoalDemand` (goalDemandCandidates.ts) -- the SAME read
 *     model HGR3-A/Home/Plan My Day already call -- re-validates ownership
 *     and FRESH remaining demand for this GoalActivity, right now.
 *  5. `buildGoalPlanningSourceIntents` (goalPlanningSourceAdapter.ts) --
 *     the SAME pure mapping the existing automatic Goal-demand flow
 *     already uses for TODAY -- turns that one verified candidate into
 *     the reserved `goal-demand:<date>:<goalActivityId>` intentId and its
 *     Goal-provenance link; this file then overrides ONLY the
 *     flexibility/time fields (never title/activityId/intentId) to pin
 *     the approved instant (HGR3-BH, see "EXACT-TIME PRESERVATION"
 *     below) -- never a second, hand-rolled intent builder.
 *  6. `handleDayConstructorPreviewRequest` (dayConstructorPreviewRequest.ts,
 *     byte-identical, unmodified) -- called with a HAND-BUILT
 *     `EXPLICIT_RANGE` construction window scoped to exactly this one
 *     session's own local date (never today's REMAINING_TODAY convenience
 *     path, which this adapter deliberately bypasses for every date).
 *  7. The resulting signed `ProposedItem` (with its real `acceptanceToken`,
 *     minted by `signPreviewResultBody` INSIDE step 6, never re-derived or
 *     invented here) is run through the EXACT SAME verification/
 *     authorization/persistence sequence `POST /api/day-constructor/accept`
 *     itself uses (`verifyAcceptanceItems` -> `authorizeGoalActivityLinks`
 *     -> `persistAcceptedConstructedDay`, all three imported verbatim,
 *     never reimplemented) -- see this file's own `acceptOneSession` for
 *     the exact sequence, matching that route's trust order precisely.
 *
 * EXACT-TIME PRESERVATION (HGR3-BH, resolves the independent review's
 * first P1 finding) -- COMPATIBILITY, VERIFIED BY DIRECT SOURCE READ, NOT
 * ASSUMED: `DayIntent.flexibility === 'FIXED'` is a real, already-
 * production-exercised placement contract, NOT merely an overload-
 * precedence signal as an earlier, stale module comment in dayIntent.ts
 * suggested in isolation -- `dayConstructorOrchestrator.ts`'s own
 * `RequestedDayIntent.fixedStart` doc comment states it plainly: "the
 * caller's own requested absolute start instant... derived by this file
 * from the resolved duration, so a FixedPlacementConstraint's start/end
 * can never disagree with the intent's own resolved duration." The actual
 * placement engine (`dayConstructor.ts`'s `placeFixedIntent`/
 * `evaluateFixedConstraint`) either places a FIXED intent at EXACTLY
 * `constraint.start`/`constraint.end` when feasible (no window/blocker/
 * conflict problem), or DEFERS it (`FIXED_WINDOW_CONFLICT`/
 * `OUTSIDE_CONSTRUCTION_WINDOW`/`FIXED_WINDOW_INVALID`) -- it NEVER
 * silently relocates a FIXED intent to a different instant. This is also
 * not a novel, unproven path (unlike EXPLICIT_RANGE-for-a-future-date,
 * which HGR3-B's own review flagged as genuinely first-of-its-kind): the
 * existing manual "Plan with Aura" UI (`planDayEntry.ts`'s
 * `timeMode: 'FIXED'`/`fixedTime`) already lets a real user pick an exact
 * time today through this SAME mechanism. This adapter therefore pins
 * `flexibility: 'FIXED'`, `fixedStart: <the approved start>`,
 * `durationMinutes: <the approved duration>` on the one intent it builds,
 * and separately re-confirms (defensively, `PLACEMENT_MISMATCH` below)
 * that the signed item the preview actually returns carries that EXACT
 * start/end before ever reaching persistence -- never trusting the
 * placement contract alone without a direct equality check.
 *
 * AVAILABILITY CONTEXT POLICY (HGR3-BH, resolves the independent review's
 * first P2 finding) -- NOT a genuinely ambiguous question, verified by
 * direct source read of `dayConstructorOrchestrator.ts`'s own
 * `resolveAvailabilityAwareWindow` doc comment: "Only ever consulted for
 * `constructionWindowSource === 'REMAINING_TODAY'` -- `EXPLICIT_RANGE` is
 * an already-fully-specified caller-supplied window and is never
 * reinterpreted through availability (architecture audit's own section 40
 * recommendation)." That is an existing, deliberate, already-documented
 * architectural decision this file does not revisit or weaken -- the
 * shared orchestrator's own window resolution stays exactly as it is.
 * What WAS genuinely undecided is narrower: should THIS adapter, which is
 * (per the HGR3-B0 audit) the first EXPLICIT_RANGE caller to commit a
 * real session for a user who may have a saved Availability configuration
 * they expect to be respected, enforce that configuration itself? Given
 * Availability IS a hard window boundary everywhere it IS consulted (a
 * candidate/fixed-constraint outside the resolved window is
 * OUTSIDE_CONSTRUCTION_WINDOW, never silently included), and given the
 * ticket's own explicit preference for "a narrowly scoped adapter-level
 * validation over changing shared Day Constructor behavior," this file
 * adds exactly that: when the user has a CONFIGURED (not merely
 * UNCONFIGURED) Availability Context for the selected local date, the
 * approved [start, end) must fall entirely within a resolved usable
 * window, or the session fails closed (`OUTSIDE_AVAILABILITY`) before any
 * preview is even attempted. An UNCONFIGURED user is treated exactly like
 * every other EXPLICIT_RANGE caller already treats one -- no new
 * boundary invented for them. This never touches
 * `resolveAvailabilityAwareWindow`/`orchestrateConstructDay` themselves.
 *
 * RETRY RECONCILIATION (HGR3-BH, resolves the independent review's second
 * P1 finding) -- THE PROBLEM, reproduced and confirmed independently: once
 * a session is genuinely FIXED (see above), a retry of the identical
 * `clientRequestId` would, under the ORIGINAL design, still re-run preview
 * generation BEFORE ever consulting the persistence layer's own
 * idempotency check -- and that fresh preview generation sees the FIRST
 * acceptance's own now-real, already-committed Plan as a live
 * `FIXED_PLAN` blocker (`dayConstructorOrchestrator.ts`'s own
 * `blockingPlanCandidates` -> `isActivePlanBlocker`), so the identical
 * FIXED intent collides with ITS OWN prior commitment and gets deferred
 * (`FIXED_WINDOW_CONFLICT`) before persistence is ever reached -- the
 * exact session a correctly-functioning retry should recognize as already
 * done instead gets misreported as freshly failed.
 *
 * THE FIX: before generating any preview, this file now derives the exact
 * per-item idempotency key this session's eventual persist call would use
 * (`deriveAcceptanceIdempotencyKey`, unmodified, dayConstructorAcceptancePersistence.ts)
 * and performs ONE read-only lookup against the EXISTING
 * `PlanCreationIdempotency` row via `getPlanCreationClaim` (db.ts,
 * unmodified, already exported, already used internally by
 * `persistAcceptedConstructedDay` itself for its own, separate,
 * COMPLETE-set replay classification). If a FILLED claim already exists
 * for this exact key, the real, already-persisted Plan is read back
 * (`getPlannedActivityForOwner`, unmodified, already userId-scoped) and,
 * once its own start/end are confirmed to still equal the approved
 * selection (defense in depth -- this should be structurally guaranteed by
 * the deterministic FIXED placement above, but is never assumed blindly),
 * `ALREADY_ACCEPTED` is returned immediately with that real identity --
 * WITHOUT ever calling preview or persist again, so the self-blocking
 * collision above can never occur for this path.
 *
 * This is the smallest possible read-only addition, not a new idempotency
 * mechanism of its own: it reuses the exact same key-derivation function,
 * the exact same stored claim rows, and the exact same ownership-scoped
 * reads `persistAcceptedConstructedDay` already relies on -- it changes
 * nothing about how that function's own COMPLETE-set/content-match replay
 * classification works for ANY other caller, and an unfilled or absent
 * claim falls through to the exact same preview+persist path as before,
 * entirely unweakened.
 *
 * WHY THIS KEY CAN NEVER MISCLASSIFY A DIFFERENT INTENDED SESSION AS A
 * REPLAY (the independent review's own explicit warning, addressed
 * directly): `buildWeeklySessionClientRequestId` now incorporates the
 * EXACT approved `start`/`end`, not merely `(goalActivityId, localDate)`.
 * Two requests for the same activity on the same date but with genuinely
 * DIFFERENT approved times derive DIFFERENT keys and can never collide --
 * each is correctly treated as its own distinct session, exactly as the
 * product contract demands ("a different time IS a different intended
 * session"). HGR3-A's own same-day exclusion
 * (`selectDistinctDayProposals`'s `seedOccupiedLocalDates`) already keeps
 * this case from arising through the normal proposal flow, but this
 * adapter's own identity scheme does not depend on that upstream policy
 * to stay safe.
 *
 * IDEMPOTENCY KEY SCOPE (unchanged from HGR3-B): never used bare --
 * `PlanCreationIdempotency` is keyed by `(userId, clientRequestId)`
 * (db.ts, unmodified), so this string can never collide across users even
 * though it carries no explicit userId component itself. A `localDate` is
 * already week-specific by construction, so it cannot collide across
 * weeks either.
 *
 * PARTIAL SUCCESS (never one atomic transaction, unchanged from HGR3-B):
 * sessions are processed sequentially, each independently accepted or
 * rejected on its own authoritative, freshly-revalidated state. A later
 * session's failure never rolls back an earlier session's real,
 * already-committed success -- the same "each item attempted
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
import { persistAcceptedConstructedDay, deriveAcceptanceIdempotencyKey, type AcceptConstructedDayPersistenceResult } from './dayConstructorAcceptancePersistence';
import { resolveAvailability, type AvailabilityConfiguration } from './availabilityContext';
import type { AcceptConstructedDayRequest, AcceptedProposedItem } from './dayConstructorAcceptance';
import type { ConstructionWindow } from './dayIntent';
import { getPlanCreationClaim, getPlannedActivityForOwner, type PlanCreationClaim, type PlannedActivity, type User } from './db';

/** Mirrors HGR3-A's own MAX_WEEKLY_RHYTHM_PROPOSALS -- a batch can never
 * legitimately contain more sessions than could ever have been proposed
 * in the first place; a larger submitted array is rejected outright
 * rather than silently truncated. */
export const MAX_WEEKLY_ACCEPTANCE_SESSIONS = 3;

/** Mirrors dayIntent.ts's own `validateEstimatedDurationMinutes` bound --
 * never a new, looser rule. */
const MAX_DURATION_MINUTES = 24 * 60;
const MIN_DURATION_MINUTES = 1;

const CLIENT_REQUEST_ID_PREFIX = 'hgr3b';

/** Deterministic, per (user-scoped by the idempotency table itself, never
 * baked into this string), per-GoalActivity, per-local-date, per-EXACT-
 * approved-instant. See this module's own header comment ("WHY THIS KEY
 * CAN NEVER MISCLASSIFY...") for the full collision analysis -- including
 * exactly `start`/`end` (not a normalized/rounded form of them) is
 * deliberate: this file's own input validation (see
 * `validateSelectionShape` below) already rejects anything that is not a
 * well-formed, exact ISO instant pair before this function is ever
 * called, so two calls for the SAME intended session always supply
 * byte-identical strings. */
export function buildWeeklySessionClientRequestId(goalActivityId: string, localDate: string, start: string, end: string): string {
  return `${CLIENT_REQUEST_ID_PREFIX}:${goalActivityId}:${localDate}:${start}:${end}`;
}

export interface WeeklyAcceptanceSelection {
  goalActivityId: string;
  /** The civil date (user-local), 'YYYY-MM-DD', the user confirmed for
   * this one session. Re-verified (never merely trusted) against
   * `start`'s own resolved local date -- see `validateSelectionShape`. */
  localDate: string;
  /** The EXACT local session instant the user approved, as a real ISO
   * 8601 date-time string (HGR3-BH) -- what HGR3-A itself proposed, round-
   * tripped by the client unmodified. Never a bare clock time/offset of
   * its own; the client is expected to echo back exactly the ISO instant
   * HGR3-A's own response already carried for this candidate. */
  start: string;
  /** The EXACT matching end instant -- together with `start`, this
   * determines the committed duration; see `validateSelectionShape`. */
  end: string;
}

export type WeeklySessionAcceptanceOutcome =
  | { goalActivityId: string; localDate: string; outcome: 'ACCEPTED'; plannedActivityId: string; start: string; end: string }
  | { goalActivityId: string; localDate: string; outcome: 'ALREADY_ACCEPTED'; plannedActivityId: string; start: string; end: string }
  /** Safe, non-leaking machine code only -- never a raw DB error, never a
   * stack trace. See `classifyFailureReason`/this file's own inline
   * `SessionFailureReason` union for the exhaustive mapping. */
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
  /** `getPlanCreationClaim` in production (HGR3-BH) -- the read-only
   * reconciliation lookup; see this module's own "RETRY RECONCILIATION"
   * header section. */
  getPlanCreationClaim: typeof getPlanCreationClaim;
  /** `getPlannedActivityForOwner` in production (HGR3-BH) -- resolves the
   * real, already-userId-scoped Plan a filled claim points at. */
  getPlannedActivityForOwner: typeof getPlannedActivityForOwner;
  /** The real `AvailabilityConfiguration` read (HGR3-BH) -- the SAME
   * shape/semantics `createRealDayConstructorOrchestratorDeps`'s own
   * `loadAvailabilityConfiguration` closure already builds for the
   * shared orchestrator, reused here as an independent, adapter-level
   * read; see this module's own "AVAILABILITY CONTEXT POLICY" header
   * section for why this check lives here rather than inside the
   * orchestrator. */
  loadAvailabilityConfiguration: () => Promise<AvailabilityConfiguration>;
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
  /** HGR3-BH -- `start`/`end` are not both valid ISO instants, `start` is
   * not strictly before `end`, or the resulting duration is not a sane
   * positive integer number of minutes. */
  | 'INVALID_TIME_RANGE'
  /** HGR3-BH -- `start`'s own resolved user-local civil date does not
   * equal the claimed `localDate`. */
  | 'TIME_DATE_MISMATCH'
  /** HGR3-BH -- `start` is at or before the authoritative current
   * instant; a genuine replay of an already-accepted session is resolved
   * BEFORE this check runs (see this file's own "RETRY RECONCILIATION"
   * header section), so this can only fire for a genuinely new,
   * never-before-accepted request. */
  | 'TIME_ALREADY_ELAPSED'
  /** HGR3-BH -- the user has a CONFIGURED Availability Context for this
   * local date, and the approved [start, end) does not fall entirely
   * within a resolved usable window. */
  | 'OUTSIDE_AVAILABILITY'
  | 'PREVIEW_NOT_READY'
  /** HGR3-BH -- the real preview pipeline deferred this exact FIXED
   * instant (a conflict, an elapsed/out-of-window instant the pipeline's
   * own checks caught independently, or any other real scheduling
   * infeasibility) -- never a silent relocation to a different time. */
  | 'TIME_NO_LONGER_AVAILABLE'
  /** HGR3-BH -- defensive only: the signed item the preview returned did
   * not carry the EXACT approved start/end. Should be structurally
   * unreachable given `placeFixedIntent`'s own contract (see this file's
   * own "EXACT-TIME PRESERVATION" header section), but this file never
   * persists on trust alone. */
  | 'PLACEMENT_MISMATCH'
  | 'PREVIEW_FAILED'
  | 'ACCEPTANCE_REJECTED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'SAVE_FAILED';

/** Exported for direct boundary testing (HGR3-BH P2-1) -- a test can
 * compare this function's own output against `localDayBoundsUTC`'s
 * independently, across multiple timezones/DST transitions, rather than
 * only inferring correctness from a final persisted date. */
export function buildExplicitRangeWindow(localDate: string, timezone: string, now: Date): { explicitStart: string; explicitEnd: string } {
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

interface ValidatedSelectionTime {
  start: Date;
  end: Date;
  durationMinutes: number;
}

/** HGR3-BH -- pure input-shape validation only (never a scheduling-
 * feasibility decision; that is the real preview pipeline's job). Returns
 * `null` with the specific reason on any malformed input. */
function validateSelectionShape(selection: WeeklyAcceptanceSelection, timezone: string): { ok: true; value: ValidatedSelectionTime } | { ok: false; reason: 'INVALID_TIME_RANGE' | 'TIME_DATE_MISMATCH' } {
  const start = new Date(selection.start);
  const end = new Date(selection.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start.getTime() >= end.getTime()) {
    return { ok: false, reason: 'INVALID_TIME_RANGE' };
  }
  const rawMinutes = (end.getTime() - start.getTime()) / 60000;
  if (!Number.isInteger(rawMinutes) || rawMinutes < MIN_DURATION_MINUTES || rawMinutes > MAX_DURATION_MINUTES) {
    return { ok: false, reason: 'INVALID_TIME_RANGE' };
  }
  const startLocalDate = getDatePartsInTimezone(timezone, start).dateStr;
  if (startLocalDate !== selection.localDate) {
    return { ok: false, reason: 'TIME_DATE_MISMATCH' };
  }
  return { ok: true, value: { start, end, durationMinutes: rawMinutes } };
}

/** HGR3-BH -- the read-only reconciliation lookup. Returns the real,
 * already-committed outcome when a FILLED claim already exists for this
 * EXACT session identity, or `null` when there is nothing to reconcile
 * (genuinely fresh, or an unfilled/absent claim -- either way the normal
 * preview+persist path is the correct next step, unchanged). Never
 * writes anything; never calls preview or persist. */
async function reconcileExistingAcceptance(
  deps: WeeklyAcceptanceDeps,
  userId: string,
  goalActivityId: string,
  localDate: string,
  intentId: string,
  clientRequestId: string,
  approved: ValidatedSelectionTime
): Promise<WeeklySessionAcceptanceOutcome | null> {
  const itemKey = deriveAcceptanceIdempotencyKey(clientRequestId, intentId);
  const claim: PlanCreationClaim | null = await deps.getPlanCreationClaim(userId, itemKey);
  if (!claim || !claim.plannedActivityId) return null;
  const plan: PlannedActivity | null = await deps.getPlannedActivityForOwner(userId, claim.plannedActivityId);
  if (!plan) return null;
  // Defense in depth (this file's own explicit discipline, see "RETRY
  // RECONCILIATION" above) -- never trust a filled claim's own existence
  // alone; confirm the real, persisted Plan actually carries the EXACT
  // approved instant before reporting it as the approved session's own
  // outcome.
  if (new Date(plan.plannedStartAt).getTime() !== approved.start.getTime() || new Date(plan.plannedEndAt).getTime() !== approved.end.getTime()) return null;
  return { goalActivityId, localDate, outcome: 'ALREADY_ACCEPTED', plannedActivityId: plan.id, start: toIso(new Date(plan.plannedStartAt)), end: toIso(new Date(plan.plannedEndAt)) };
}

/** HGR3-BH -- true when the user has a CONFIGURED (not merely
 * UNCONFIGURED) Availability Context for `localDate` and `[start, end)`
 * falls outside every resolved usable window for that day. See this
 * file's own "AVAILABILITY CONTEXT POLICY" header section. */
async function violatesConfiguredAvailability(deps: WeeklyAcceptanceDeps, localDate: string, timezone: string, now: Date, approved: ValidatedSelectionTime): Promise<boolean> {
  const configuration = await deps.loadAvailabilityConfiguration();
  const resolution = resolveAvailability({ targetDate: localDate, timezone, now, configuration });
  if (resolution.status !== 'CONFIGURED') return false; // UNCONFIGURED -- no hard boundary this adapter introduces; identical to every other existing EXPLICIT_RANGE caller's own treatment.
  return !resolution.usableWindows.some((w) => approved.start.getTime() >= w.start.getTime() && approved.end.getTime() <= w.end.getTime());
}

/** One session, start to finish. Never throws on an ordinary domain
 * outcome -- only a genuine infrastructure failure inside `deps.persist`/
 * `deps.runPreview` themselves propagates, exactly like every other
 * caller of these two functions in this codebase. */
async function acceptOneSession(deps: WeeklyAcceptanceDeps, userId: string, selection: WeeklyAcceptanceSelection, planningLocalDate: string): Promise<WeeklySessionAcceptanceOutcome> {
  const { goalActivityId, localDate } = selection;

  // Step 1 (HGR3-BH) -- pure input-shape validation, always first: a
  // malformed time never even reaches week-bounds/idempotency/
  // availability checks.
  const shape = validateSelectionShape(selection, deps.user.timezone);
  if (!shape.ok) return { goalActivityId, localDate, outcome: 'FAILED', reason: shape.reason satisfies SessionFailureReason };
  const approved = shape.value;

  if (!isWithinRemainingWeek(localDate, planningLocalDate)) {
    return { goalActivityId, localDate, outcome: 'FAILED', reason: 'OUTSIDE_CURRENT_WEEK' satisfies SessionFailureReason };
  }

  const clientRequestId = buildWeeklySessionClientRequestId(goalActivityId, localDate, selection.start, selection.end);
  const now = deps.now();

  // Step 2 -- fresh, authoritative ownership + eligibility. Never the
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
    // own idempotency check (Step 2 above, or persist's own check below)
    // can tell "this exact session already succeeded" (ALREADY_ACCEPTED)
    // apart from "this is a genuinely new, over-capacity request" (a
    // fresh CAPACITY_EXCEEDED rejection, mapped to NOT_ELIGIBLE below) --
    // so this file resolves OWNERSHIP separately, from the raw
    // (unfiltered-by-eligibility) rows the SAME read model's own
    // discovery query already exposes, and falls through to the real
    // preview+persist pipeline whenever ownership genuinely holds,
    // letting that pipeline's own real check decide between those two
    // cases rather than guessing here.
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

  // Step 3 -- the SAME pure mapping the existing automatic Goal-demand
  // flow already uses, never a second, hand-rolled intent builder. This
  // file only overrides the flexibility/time fields on the ONE intent it
  // gets back (HGR3-BH -- see "EXACT-TIME PRESERVATION" above); title,
  // activityId, intentId and the Goal-provenance link are all exactly
  // what the shared mapping already produced. Critically (HGR3-BH), this
  // is also the ONE place this file ever learns the real `intentId` --
  // it never calls `encodeGoalDemandIntentId` itself (that encoder's own
  // caller set is a separate, hardcoded architecture guard --
  // `manualGoalProvenanceParityArchitecture.test.ts`'s "the encoder is
  // called only by the three known producers/matchers" -- this adapter
  // has no legitimate reason to become a fourth; reusing
  // `buildGoalPlanningSourceIntents`'s own already-derived id, exactly
  // like reusing its intent-shape, is the correct amount of trust in the
  // existing mapping, not a workaround).
  const sourceResult = buildGoalPlanningSourceIntents({ candidates: [candidate], planningLocalDate: localDate, manualGoalActivityIds: [] });
  if (sourceResult.status !== 'OK' || sourceResult.intents.length !== 1) {
    return { goalActivityId, localDate, outcome: 'FAILED', reason: 'PREVIEW_FAILED' satisfies SessionFailureReason };
  }
  const [genericIntent] = sourceResult.intents;
  const rawGoalActivityLinks = sourceResult.goalActivityLinks;

  // Step 4 (HGR3-BH) -- the reconciliation short-circuit, BEFORE any
  // preview is generated, using the REAL intentId Step 3 just derived.
  // See this file's own "RETRY RECONCILIATION" header section for
  // exactly why this ordering matters. Deliberately runs AFTER Step 2's
  // ownership resolution (never before it) so an already-accepted
  // session whose weekly demand the SAME acceptance fully consumed is
  // still correctly reached via Step 2's own raw-rows fallback, rather
  // than this file guessing ownership itself; deliberately runs BEFORE
  // the elapsed-time/availability checks below so a genuine replay is
  // never newly rejected merely because wall-clock time or the user's
  // availability settings have since moved on.
  const reconciled = await reconcileExistingAcceptance(deps, userId, goalActivityId, localDate, genericIntent.id, clientRequestId, approved);
  if (reconciled) return reconciled;

  // Step 5 (HGR3-BH) -- only a genuinely new request reaches here.
  if (approved.start.getTime() <= now.getTime()) {
    return { goalActivityId, localDate, outcome: 'FAILED', reason: 'TIME_ALREADY_ELAPSED' satisfies SessionFailureReason };
  }

  // Step 6 (HGR3-BH) -- adapter-level Availability Context enforcement.
  if (await violatesConfiguredAvailability(deps, localDate, deps.user.timezone, now, approved)) {
    return { goalActivityId, localDate, outcome: 'FAILED', reason: 'OUTSIDE_AVAILABILITY' satisfies SessionFailureReason };
  }

  // `fixedStart` is sent as a real ISO STRING, never a `Date` instance:
  // this adapter calls `handleDayConstructorPreviewRequest` in-process
  // (never over real HTTP/JSON), but that function's own request parser
  // (`parseIsoDate`, dayConstructorPreviewRequest.ts) deliberately only
  // accepts the shape a genuine JSON request body would produce after
  // `JSON.parse` -- a string -- exactly like the real client
  // (`dayConstructorPreviewClient.ts`'s own `previewConstructedDay`)
  // already `JSON.stringify`s its own `Date` fields before sending.
  const intent = { ...genericIntent, flexibility: 'FIXED' as const, fixedStart: toIso(approved.start), durationMinutes: approved.durationMinutes };

  // Step 7 -- the real, unmodified preview pipeline, with a hand-built
  // EXPLICIT_RANGE window scoped to exactly this one date (never the
  // REMAINING_TODAY convenience path, which only ever targets today).
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
    // The FIXED intent was deferred -- a real conflict, an out-of-window
    // instant, or any other genuine scheduling infeasibility the real
    // pipeline's own checks caught. Never fabricated as an acceptance,
    // never silently relocated, never retried automatically.
    return { goalActivityId, localDate, outcome: 'FAILED', reason: 'TIME_NO_LONGER_AVAILABLE' satisfies SessionFailureReason };
  }

  // HGR3-BH -- defensive equality check (see "EXACT-TIME PRESERVATION"
  // above): `placeFixedIntent` should make this structurally impossible
  // to fail, but this file never persists a signed item without directly
  // confirming it still carries the EXACT approved instant.
  if (new Date(placed.start).getTime() !== approved.start.getTime() || new Date(placed.end).getTime() !== approved.end.getTime()) {
    return { goalActivityId, localDate, outcome: 'FAILED', reason: 'PLACEMENT_MISMATCH' satisfies SessionFailureReason };
  }

  // Step 8 -- the EXACT verification -> authorization -> persistence
  // sequence `POST /api/day-constructor/accept` itself runs, in the same
  // order, on the SAME real functions (none reimplemented).
  const proposedItem: AcceptedProposedItem = { intentId: placed.intentId, activityId: placed.activityId, title: placed.title, start: placed.start, end: placed.end, placementSource: placed.placementSource };
  const tokens = new Map<string, unknown>([[placed.intentId, (placed as { acceptanceToken?: unknown }).acceptanceToken]]);
  const integrityDiagnostics = verifyAcceptanceItems(userId, window, [proposedItem], tokens);
  if (integrityDiagnostics.length > 0) return { goalActivityId, localDate, outcome: 'FAILED', reason: 'ACCEPTANCE_REJECTED' satisfies SessionFailureReason };

  const authorization = authorizeGoalActivityLinks([proposedItem], window.date, rawGoalActivityLinks);
  if (authorization.status === 'REJECTED') return { goalActivityId, localDate, outcome: 'FAILED', reason: 'ACCEPTANCE_REJECTED' satisfies SessionFailureReason };

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
