/**
 * Day Constructor V1 -- PR B: pure deterministic placement engine.
 *
 * ARCHITECTURAL BOUNDARY (this ticket's own section 3): this file is the
 * PURE PLACEMENT ENGINE step only --
 *
 *   I/O ORCHESTRATOR (future PR C)
 *     -> FLEXIBLE: Plans, context, duration resolution, runTimingSearch
 *                  -> normalized PlacementCandidate[]
 *     -> FIXED:    user/request constraint -> FixedPlacementConstraint
 *     -> THIS FILE (pure)
 *     -> ConstructedDay
 *     -> preview -> CHECK -> save (future PR D/E)
 *
 * FIXED VS FLEXIBLE IS AN INPUT-SHAPE BOUNDARY, NOT A CARDINALITY TRICK
 * (pre-commit review fix, this ticket's own section 1/2): a
 * `PlacementCandidate` means exactly one thing -- "a selectable candidate
 * placement" -- for a FLEXIBLE intent. It never ALSO means "the user's
 * mandatory placement constraint" merely because a caller happened to
 * supply only one. A FIXED intent's non-negotiable target is instead
 * represented by its own, structurally distinct
 * `FixedPlacementConstraint` (see that type's own doc comment) -- PR C
 * must never manufacture a fake `PlacementCandidate` to represent a fixed
 * placement, and this file never infers a FIXED intent's target from
 * however many candidates happen to be supplied for it (candidates are
 * simply not consulted at all when placing a FIXED intent).
 *
 * It never calls `runTimingSearch`/`evaluateMuhurta`/`evaluateActivityFit`,
 * never touches the DB, never creates a `PlannedActivity`, and never reads
 * a clock -- every candidate window this file ever reasons about arrives
 * as an already-computed, already-normalized `PlacementCandidate`/
 * `FixedPlacementConstraint` (see those types' own doc comments for
 * exactly what "normalized" means here). `today` (for overload-
 * precedence's own "deadline today" check) is likewise an explicit
 * input, never derived from `new Date()`.
 *
 * REUSES PR A DIRECTLY (this ticket's own section 2): `DayIntent`,
 * `ConstructionWindow`, `compareByOverloadPrecedence`,
 * `sortByOverloadPrecedence`, `sumConstructibleDurationMinutes` (all from
 * `./dayIntent`), and `BlockedInterval`, `normalizeBlockedIntervals`,
 * `computeCapacitySnapshot`, `CapacitySnapshot`, `DayCapacityResult`
 * (all from `./dayCapacity`) -- none of these concepts are redefined or
 * duplicated here.
 *
 * V1 PRODUCT SEMANTICS (this ticket's own section 4, LOCKED): this file
 * places only the EXPLICIT `DayIntent`s it is given. It never invents an
 * activity, never decomposes a goal, never adds a wellbeing/break item of
 * its own, never reschedules or mutates an existing commitment, never
 * shortens/splits an intent's own required duration, and never persists
 * anything -- every existing commitment (`BlockedInterval`) is treated as
 * an immutable given.
 *
 * GREEDY, NOT GLOBALLY OPTIMAL (this ticket's own section 12/13, DELIBERATE
 * V1 LIMITATION): intents are processed strictly in
 * `compareByOverloadPrecedence` order; once an intent is placed, its exact
 * interval is reserved and unavailable to every intent processed after it
 * in the SAME run. This file never backtracks and never explores
 * combinations across intents to find a globally better arrangement -- a
 * higher-precedence intent keeps whichever feasible slot it is assigned
 * even when, in hindsight, a different combination would have let a
 * lower-precedence intent ALSO fit. This is intentional, not an
 * oversight: V1's job is deterministic, explainable placement, not
 * combinatorial optimization.
 */

import {
  compareByOverloadPrecedence,
  sortByOverloadPrecedence,
  sumConstructibleDurationMinutes,
  type ConstructionWindow,
  type ConstructionWindowValidationError,
  type DayIntent,
} from './dayIntent';
import {
  computeCapacitySnapshot,
  normalizeBlockedIntervals,
  type BlockedInterval,
  type CapacitySnapshot,
} from './dayCapacity';

// ============================================================
// PlacementCandidate -- the smallest normalized input the pure engine
// needs (this ticket's own section 6).
// ============================================================

/**
 * A plain-language-safe, deterministic timing-quality tier -- the
 * "existing assistant vocabulary" this ticket's own section 10 asks for.
 * Deliberately its OWN type here, NOT imported from
 * `apps/web/lib/homeTimelineTypes.ts`'s `HomeTimelineStatus` ('Best'|
 * 'Good'|'Workable'|'Caution'): that type is documented as presentation-
 * only (Home Timeline Composer V1's own module doc comment), and the
 * architecture audit's own instruction is not to couple a new domain
 * contract to a presentation type merely because the shapes happen to
 * match. This mirrors PR A's own `BlockedInterval`/
 * `ForwardPlannerBlockingInterval` precedent: same tier structure as
 * `mapTimingLabelToHomeStatus` (homeTimelineComposer.ts) produces, by
 * convention, never by import. A future orchestrator (PR C) is
 * responsible for collapsing a real `TimingCandidateLabel` (EXCELLENT/
 * VERY_GOOD/GOOD/USABLE -- CAUTION is never eligible, see
 * `runTimingSearch`'s own contract) into one of these four tiers before
 * building a `PlacementCandidate` -- this file never sees a raw
 * `TimingCandidateLabel`, a raw numeric score, or a raw `MuhurtaReason`.
 */
export type PlacementTimingFit = 'BEST' | 'GOOD' | 'WORKABLE' | 'CAUTION';

/**
 * One already-feasible-per-the-timing-engine candidate window for one
 * FLEXIBLE `DayIntent`. "Normalized" means: real Panchang/Muhurta
 * candidate generation (`runTimingSearch`, `evaluateMuhurta`) has ALREADY
 * run upstream (future PR C) -- this file only ever compares/ranks/places
 * already-computed candidates, it never generates one.
 *
 * FLEXIBLE ONLY (pre-commit review fix, this ticket's own section 1/2):
 * a `PlacementCandidate` is a *selectable alternative* -- it exists to be
 * ranked against its siblings for the SAME intent (see
 * `compareCandidatesForPlacement` below). A FIXED intent's own
 * non-negotiable target is a structurally DIFFERENT concept
 * (`FixedPlacementConstraint`, below) and never flows through this type
 * -- `constructDay` never even looks at `ConstructDayInput.
 * candidatesByIntentId` when placing a FIXED intent, so supplying
 * candidates for one has no effect on its placement at all (see
 * `placeOneIntent`'s own FIXED branch).
 */
export interface PlacementCandidate {
  /** Must equal the `DayIntent.id` this candidate was generated for.
   * Redundant with the map key `constructDay`'s own input keys candidates
   * by (`ConstructDayInput.candidatesByIntentId`), and deliberately so --
   * see `evaluateCandidate`'s own `WRONG_INTENT` gate, this ticket's own
   * section 21 "candidate wrong intentId" malformed-input case. */
  intentId: string;
  /** Absolute UTC instant the candidate window opens. */
  start: Date;
  /** Absolute UTC instant the candidate window closes. May be longer
   * than the intent's own required duration (see this file's own
   * "duration semantics" section below for how the exact placed interval
   * is derived from a candidate that offers more time than needed). */
  end: Date;
  /** OPTIONAL normalized timing quality (this ticket's own section 6:
   * "optional normalized timing quality") -- absent when no timing-
   * quality signal is available for this candidate. An absent
   * `timingFit` still participates in feasibility and CAN still be
   * placed; it only ranks worse than every present tier when choosing
   * among multiple feasible candidates for the same FLEXIBLE intent
   * (see `TIMING_FIT_RANK` below -- a documented V1 decision, since the
   * ticket does not specify this case explicitly: "no signal" is treated
   * as weaker evidence than even `'CAUTION'`, which is at least a real,
   * if weak, engine assessment). */
  timingFit?: PlacementTimingFit;
  /** Stable, deterministic ordering among candidates the caller supplied
   * for the SAME intent -- e.g. the position `runTimingSearch`'s own
   * FIND result already returned them in. The FINAL tiebreak when two
   * candidates are otherwise equally ranked (this ticket's own section
   * 10: "3. candidateOrder"). Never re-derived from array position by
   * this file -- callers must supply it explicitly, exactly like
   * `DayIntent.originalOrder`. */
  candidateOrder: number;
}

/**
 * A FIXED intent's one non-negotiable target interval (pre-commit review
 * fix, this ticket's own section 2). Structurally distinct from
 * `PlacementCandidate`: it carries no `timingFit`/`candidateOrder`,
 * because a fixed placement is never ranked against anything -- its
 * location came from the caller (the user, or an external commitment),
 * not from timing quality. Kept inside this file's own placement domain
 * (not added to `DayIntent`, per this ticket's own explicit instruction
 * not to bloat that type merely to carry a construction-run-specific
 * timestamp pair) and never persisted.
 */
export interface FixedPlacementConstraint {
  /** Must equal the `DayIntent.id` this constraint targets. Redundant
   * with the map key `ConstructDayInput.fixedConstraintsByIntentId` own
   * keys by, matching `PlacementCandidate.intentId`'s own defensive
   * convention. */
  intentId: string;
  /** Absolute UTC instant the mandatory placement begins. */
  start: Date;
  /** Absolute UTC instant the mandatory placement ends. Must equal
   * `start` plus exactly the intent's own `estimatedDurationMinutes` --
   * see `placeOneIntent`'s own FIXED branch for the exact validation
   * (a mismatch is `FIXED_WINDOW_INVALID`, never silently reconciled by
   * trusting one value over the other). */
  end: Date;
}

// ============================================================
// Duration semantics (this ticket's own section 8)
// ============================================================

/**
 * Derives the EXACT placed interval from a candidate and an intent's own
 * required duration, or `null` when the candidate cannot honestly provide
 * it. Recommended V1 rule, implemented literally:
 *
 *   - The candidate's own span (`end - start`) must be >= the required
 *     duration -- otherwise `null` (the candidate is rejected outright,
 *     see `evaluateCandidate`'s own `INSUFFICIENT_DURATION` gate).
 *   - The placed interval is exactly `[candidate.start, candidate.start +
 *     requiredMinutes)` -- this file NEVER silently expands an intent to
 *     consume a longer candidate window than it actually needs (this
 *     ticket's own explicit example: a 45-minute intent inside a
 *     10:00-11:30 candidate places at exactly 10:00-10:45, never
 *     10:00-11:30).
 *
 * The caller (`evaluateCandidate`) is responsible for re-checking this
 * DERIVED interval against the construction window and every blocker --
 * never the raw, longer candidate span -- exactly matching this ticket's
 * own instruction to "verify the resulting exact interval remains
 * feasible."
 */
function deriveExactInterval(candidate: PlacementCandidate, requiredMinutes: number): { start: Date; end: Date } | null {
  const candidateMinutes = (candidate.end.getTime() - candidate.start.getTime()) / 60000;
  if (!Number.isFinite(candidateMinutes) || candidateMinutes < requiredMinutes) return null;
  return { start: candidate.start, end: new Date(candidate.start.getTime() + requiredMinutes * 60000) };
}

/** `[start, end)` -- the exact convention `apps/web/lib/forwardPlanner.ts`'s
 * own (private) `intervalsOverlap` and PR A's `dayCapacity.ts` own
 * (private) `intervalsOverlap` already establish: two intervals that
 * merely touch at an endpoint (09:00-10:00 and 10:00-11:00) do NOT
 * overlap. Reproduced here rather than imported, matching PR A's own
 * precedent for this exact formula (kept import-free of any single other
 * domain's module). */
function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

function isWithinWindow(interval: { start: Date; end: Date }, window: ConstructionWindow): boolean {
  return interval.start.getTime() >= window.start.getTime() && interval.end.getTime() <= window.end.getTime();
}

/** A placed interval, self-owning its `intentId` -- the single source of
 * truth used both for overlap checks AND for attributing a conflict to
 * "the intent that already holds this slot" (this ticket's own section
 * 17 "preservedHigherPriorityIntent?" explanation fact). No separate
 * lookup map is needed: the owner travels with the interval itself. */
interface OwnedInterval {
  start: Date;
  end: Date;
  intentId: string;
}

function findOverlapping(interval: { start: Date; end: Date }, blockers: readonly OwnedInterval[]): OwnedInterval | undefined {
  return blockers.find((blocker) => intervalsOverlap(interval.start, interval.end, blocker.start, blocker.end));
}

/** Plain overlap check against unowned blockers (real `BlockedInterval`s
 * have no placing intent to attribute a conflict to) -- kept separate
 * from `findOverlapping` so a normalized-blocker check never needs to
 * fabricate a placeholder `intentId` just to satisfy `OwnedInterval`'s
 * shape. */
function overlapsAny(interval: { start: Date; end: Date }, blockers: readonly { start: Date; end: Date }[]): boolean {
  return blockers.some((blocker) => intervalsOverlap(interval.start, interval.end, blocker.start, blocker.end));
}

// ============================================================
// Feasibility (this ticket's own section 7 -- a hard gate, evaluated
// BEFORE any timing-quality comparison; no score can rescue an
// infeasible candidate).
// ============================================================

/** Per-CANDIDATE rejection reasons -- more granular than the per-INTENT
 * `PlacementDeferralReason` below (this ticket's own section 15: "use
 * primaryReason + diagnostics[]" to avoid guessing a single dominant
 * cause when multiple candidates fail for different reasons). Every
 * value here maps into `diagnostics[]`, never directly into
 * `primaryReason` except when every rejected candidate for an intent
 * shares the identical reason (see `summarizeRejections` below). */
export type PlacementCandidateRejectionReason =
  | 'WRONG_INTENT'
  | 'MALFORMED_CANDIDATE'
  | 'INSUFFICIENT_DURATION'
  | 'OUTSIDE_CONSTRUCTION_WINDOW'
  | 'BLOCKED_BY_COMMITMENT'
  | 'CONFLICTS_WITH_PROPOSED_ITEM';

/** The reasons above that ALSO carry the derived interval that triggered
 * them -- only the three overlap/containment gates ever successfully
 * derive an interval before rejecting; the structural gates
 * (WRONG_INTENT/MALFORMED_CANDIDATE/INSUFFICIENT_DURATION) never reach
 * that point, so they carry no interval. Conflict-owner attribution
 * (`findOverlapping` against `placedIntervals`) is only ever attempted
 * for these three. */
type CandidateEvaluation =
  | { feasible: true; interval: { start: Date; end: Date } }
  | { feasible: false; reason: Extract<PlacementCandidateRejectionReason, 'WRONG_INTENT' | 'MALFORMED_CANDIDATE' | 'INSUFFICIENT_DURATION'> }
  | { feasible: false; reason: Extract<PlacementCandidateRejectionReason, 'OUTSIDE_CONSTRUCTION_WINDOW' | 'BLOCKED_BY_COMMITMENT' | 'CONFLICTS_WITH_PROPOSED_ITEM'>; interval: { start: Date; end: Date } };

/**
 * The feasibility gate, exactly this ticket's own section 7 list, in
 * order (a candidate fails at the FIRST gate it does not clear -- gates
 * are cheap-to-expensive ordered on purpose, e.g. a structural check
 * before an O(n) overlap scan):
 *
 *   1. belongs to the intent           -> WRONG_INTENT
 *   2. valid start < end, real Dates   -> MALFORMED_CANDIDATE
 *   3. satisfies required duration     -> INSUFFICIENT_DURATION
 *   4. (derived exact interval) lies completely inside ConstructionWindow
 *                                       -> OUTSIDE_CONSTRUCTION_WINDOW
 *   5. does not overlap a normalized BlockedInterval
 *                                       -> BLOCKED_BY_COMMITMENT
 *   6. does not overlap an already-placed proposed item (this run)
 *                                       -> CONFLICTS_WITH_PROPOSED_ITEM
 *
 * Gate 7 from this ticket's own list ("satisfies FIXED placement
 * constraint when applicable") does not apply to this function at all
 * (pre-commit review fix): FIXED intents never reach `evaluateCandidate`
 * -- they are placed via `evaluateFixedConstraint` below, against their
 * own `FixedPlacementConstraint`, never against a `PlacementCandidate`.
 */
function evaluateCandidate(
  candidate: PlacementCandidate,
  intent: DayIntent,
  requiredMinutes: number,
  window: ConstructionWindow,
  normalizedBlockers: readonly BlockedInterval[],
  placedIntervals: readonly OwnedInterval[]
): CandidateEvaluation {
  if (candidate.intentId !== intent.id) return { feasible: false, reason: 'WRONG_INTENT' };
  if (!(candidate.start instanceof Date) || Number.isNaN(candidate.start.getTime())) return { feasible: false, reason: 'MALFORMED_CANDIDATE' };
  if (!(candidate.end instanceof Date) || Number.isNaN(candidate.end.getTime())) return { feasible: false, reason: 'MALFORMED_CANDIDATE' };
  if (candidate.start.getTime() >= candidate.end.getTime()) return { feasible: false, reason: 'MALFORMED_CANDIDATE' };

  const interval = deriveExactInterval(candidate, requiredMinutes);
  if (!interval) return { feasible: false, reason: 'INSUFFICIENT_DURATION' };
  if (!isWithinWindow(interval, window)) return { feasible: false, reason: 'OUTSIDE_CONSTRUCTION_WINDOW', interval };
  if (overlapsAny(interval, normalizedBlockers)) return { feasible: false, reason: 'BLOCKED_BY_COMMITMENT', interval };
  if (findOverlapping(interval, placedIntervals)) return { feasible: false, reason: 'CONFLICTS_WITH_PROPOSED_ITEM', interval };

  return { feasible: true, interval };
}

/** Rejection reasons specific to placing a FIXED intent against its own
 * `FixedPlacementConstraint` -- deliberately a SEPARATE, smaller set
 * from `PlacementCandidateRejectionReason`: a fixed constraint is never
 * "insufficient duration" (its span either exactly matches the required
 * duration or it does not -- validated by the caller before this
 * function is even called) and never "wrong intent" (the caller looks it
 * up by the intent's own id, there is no array to mismatch against). */
type FixedConstraintEvaluation =
  | { feasible: true }
  | { feasible: false; reason: 'OUTSIDE_CONSTRUCTION_WINDOW' }
  | { feasible: false; reason: 'BLOCKED_BY_COMMITMENT' }
  | { feasible: false; reason: 'CONFLICTS_WITH_PROPOSED_ITEM'; conflictingIntentId?: string };

/**
 * The feasibility gate for a FIXED intent's own non-negotiable target --
 * structurally simpler than `evaluateCandidate` because there is no
 * duration-derivation step (the constraint's own `[start, end)` IS the
 * placement, already validated by the caller to exactly match the
 * intent's required duration) and no ranking step (a fixed placement is
 * never chosen among alternatives -- this ticket's own section 6: "Do
 * not rank FIXED placement using timingFit/candidateOrder/timing
 * score/Muhurta quality"). Still enforces the SAME immutability rule as
 * `evaluateCandidate`: a conflict never moves the blocker or the
 * already-placed higher-precedence item, it only rejects this FIXED
 * intent's own placement (this ticket's own section 4).
 */
function evaluateFixedConstraint(constraint: FixedPlacementConstraint, window: ConstructionWindow, normalizedBlockers: readonly BlockedInterval[], placedIntervals: readonly OwnedInterval[]): FixedConstraintEvaluation {
  if (!isWithinWindow(constraint, window)) return { feasible: false, reason: 'OUTSIDE_CONSTRUCTION_WINDOW' };
  if (overlapsAny(constraint, normalizedBlockers)) return { feasible: false, reason: 'BLOCKED_BY_COMMITMENT' };
  const conflictingProposed = findOverlapping(constraint, placedIntervals);
  if (conflictingProposed) return { feasible: false, reason: 'CONFLICTS_WITH_PROPOSED_ITEM', conflictingIntentId: conflictingProposed.intentId };
  return { feasible: true };
}

// ============================================================
// Candidate ranking within one FLEXIBLE intent (this ticket's own
// section 10). Never invents a new preference score: with only
// `timingFit` supplied, ranking is exactly [timingFit, earlier start,
// candidateOrder].
// ============================================================

/** Undefined `timingFit` ranks WORST (rank 4, below `'CAUTION'`'s rank
 * 3) -- a documented V1 decision (see `PlacementCandidate.timingFit`'s
 * own doc comment): "no signal" is treated as weaker evidence than even
 * a real but weak engine assessment. */
const TIMING_FIT_RANK: Record<PlacementTimingFit, number> = { BEST: 0, GOOD: 1, WORKABLE: 2, CAUTION: 3 };
const UNKNOWN_TIMING_FIT_RANK = 4;

function timingFitRank(fit: PlacementTimingFit | undefined): number {
  return fit === undefined ? UNKNOWN_TIMING_FIT_RANK : TIMING_FIT_RANK[fit];
}

/** Lower-ranked (better) candidates sort FIRST. Exported for direct unit
 * testing of the ordering rule in isolation from the rest of placement. */
export function compareCandidatesForPlacement(a: PlacementCandidate, b: PlacementCandidate): number {
  const fitDelta = timingFitRank(a.timingFit) - timingFitRank(b.timingFit);
  if (fitDelta !== 0) return fitDelta;
  const startDelta = a.start.getTime() - b.start.getTime();
  if (startDelta !== 0) return startDelta;
  return a.candidateOrder - b.candidateOrder;
}

// ============================================================
// Deferred / conflict / proposed result contracts (this ticket's own
// section 15/16/17).
// ============================================================

/** Per-INTENT primary reason -- always exactly one, chosen so a caller
 * never has to guess which of several per-candidate rejection reasons
 * was "the" cause (this ticket's own section 15). */
export type PlacementDeferralReason =
  | 'DURATION_UNKNOWN'
  | 'NO_CANDIDATES'
  | 'NO_FEASIBLE_WINDOW'
  | 'BLOCKED_BY_COMMITMENT'
  | 'CONFLICTS_WITH_PROPOSED_ITEM'
  | 'OUTSIDE_CONSTRUCTION_WINDOW'
  | 'FIXED_WINDOW_INVALID'
  | 'FIXED_WINDOW_CONFLICT';

export interface PlacementDiagnostic {
  candidateOrder: number;
  reason: PlacementCandidateRejectionReason;
}

export interface DeferredItem {
  intentId: string;
  primaryReason: PlacementDeferralReason;
  /** One entry per candidate that was actually evaluated and rejected --
   * empty when `primaryReason` itself never reached per-candidate
   * evaluation (`DURATION_UNKNOWN`, `NO_CANDIDATES`, and the FIXED-count
   * validation case of `FIXED_WINDOW_INVALID`). */
  diagnostics: PlacementDiagnostic[];
}

/**
 * Explanation fact (this ticket's own section 17): the SUBSET of
 * `deferredItems` whose reason genuinely represents a competing claim on
 * time, rather than plain infeasibility (a candidate too short, or
 * entirely outside the window, is not "in conflict" with anything).
 * `conflictingIntentId` is the "preservedHigherPriorityIntent" fact this
 * ticket's own section 17 calls for, populated only when the cause was
 * another intent's own already-placed interval from this same run
 * (never populated for a conflict against a pre-existing
 * `BlockedInterval`, which has no owning intent to name).
 */
export interface PlacementConflict {
  intentId: string;
  conflictingIntentId?: string;
  reason: Extract<PlacementDeferralReason, 'BLOCKED_BY_COMMITMENT' | 'CONFLICTS_WITH_PROPOSED_ITEM' | 'FIXED_WINDOW_CONFLICT'>;
}

/** `requiresConfirmation` is always `true` in V1 -- this is a PROPOSAL,
 * never a persisted commitment (this ticket's own section 16: "Do NOT
 * add persistence IDs. Do NOT create PlannedActivity objects."). */
export interface ProposedItem {
  intentId: string;
  activityId?: string;
  title: string;
  start: Date;
  end: Date;
  /** Explanation fact (pre-commit review fix, this ticket's own section
   * 9): distinguishes a FIXED placement (its interval came verbatim from
   * a `FixedPlacementConstraint`, never ranked) from a FLEXIBLE one (its
   * interval was chosen among candidates by `compareCandidatesForPlacement`).
   * Materially simplifies future preview/explanation: without this, a
   * FIXED item's absent `timingFit`/`candidateOrder` would be
   * indistinguishable from a FLEXIBLE item that simply had no timing
   * signal available. */
  placementSource: 'FIXED_CONSTRAINT' | 'SELECTED_CANDIDATE';
  /** Only ever present when `placementSource === 'SELECTED_CANDIDATE'`
   * -- a FIXED placement is never ranked by timing quality (this
   * ticket's own section 6), so it carries no `timingFit`. */
  timingFit?: PlacementTimingFit;
  /** Only ever present when `placementSource === 'SELECTED_CANDIDATE'`
   * -- a FIXED placement has no candidate list to have been ordered
   * within. */
  candidateOrder?: number;
  requiresConfirmation: true;
}

export interface ConstructedDay {
  date: string;
  proposedItems: ProposedItem[];
  deferredItems: DeferredItem[];
  conflicts: PlacementConflict[];
  /** `computeCapacitySnapshot` (dayCapacity.ts, reused verbatim -- this
   * ticket's own section 18: "Do not introduce a second capacity
   * formula") run against the total requested minutes across every
   * constructible (known-duration) intent, BEFORE any placement was
   * attempted -- "how full would today be if everything got placed." */
  requestedCapacity: CapacitySnapshot;
  /** The identical function run again, against only the minutes of the
   * items actually placed -- "how full today actually ended up." */
  proposedCapacity: CapacitySnapshot;
}

export interface ConstructDayInput {
  /** Every intent this construction run should attempt to place --
   * processed in `compareByOverloadPrecedence` order (this ticket's own
   * section 9), never in list order. */
  intents: readonly DayIntent[];
  window: ConstructionWindow;
  /** RAW (not yet normalized) blockers -- `constructDay` normalizes them
   * exactly once via PR A's own `normalizeBlockedIntervals`, reused
   * verbatim (this ticket's own section 19: "Do not write a second
   * interval-merging implementation"). */
  blockedIntervals: readonly BlockedInterval[];
  /** Candidates for each FLEXIBLE intent, keyed by `DayIntent.id`. Never
   * consulted for a FIXED intent (pre-commit review fix -- see
   * `PlacementCandidate`'s own doc comment). An intent with no entry (or
   * an empty array) is treated identically to one with zero supplied
   * candidates (`NO_CANDIDATES`). Iteration in `constructDay` is ALWAYS
   * driven by the `intents` array/its own precedence order, never by
   * this map's own key enumeration -- see this file's own determinism
   * contract. */
  candidatesByIntentId: Readonly<Record<string, readonly PlacementCandidate[]>>;
  /** Fixed constraints for each FIXED intent, keyed by `DayIntent.id`
   * (pre-commit review fix, this ticket's own section 2/3). A valid
   * FIXED intent has EXACTLY ONE entry in its own array here; zero
   * entries is a missing constraint, more than one is an ambiguous
   * constraint -- both are `FIXED_WINDOW_INVALID` (see `placeOneIntent`'s
   * own FIXED branch). Never consulted for a FLEXIBLE intent. Array-
   * shaped (not a single optional value) specifically so the "two
   * constraints for the same intent" case is representable and
   * explicitly rejected, never structurally prevented from ever being
   * supplied (this ticket's own section 4: "Do not silently select
   * one"). */
  fixedConstraintsByIntentId: Readonly<Record<string, readonly FixedPlacementConstraint[]>>;
  /** The caller's own already-resolved local `dateStr` ("today"), passed
   * straight through to `compareByOverloadPrecedence`/
   * `sortByOverloadPrecedence` -- this file never reads a clock itself. */
  today: string;
}

/**
 * Mirrors `DayCapacityResult`'s own fail-closed shape (dayCapacity.ts):
 * a malformed `ConstructionWindow` or genuinely zero usable capacity
 * fails the ENTIRE construction closed before any placement is even
 * attempted (this ticket's own section 18: "Before placement: zero
 * usable capacity must fail closed"). An OVERLOADED-but-nonzero-capacity
 * day (requested > usable, but usable > 0) is NOT one of these failure
 * cases -- it still reaches `'READY'`, with the greedy placement loop
 * itself producing the deferred/conflict items that explain what did not
 * fit (this ticket's own section 9/12/13 examples are all exactly this
 * case).
 */
export type ConstructDayResult =
  | { status: 'READY'; day: ConstructedDay }
  | { status: 'NO_USABLE_CAPACITY'; constructionWindowMinutes: number; blockedMinutes: number; requestedMinutes: number }
  | { status: 'INVALID_CONSTRUCTION_WINDOW'; error: ConstructionWindowValidationError }
  | { status: 'TIMEZONE_MISSING' };

// ============================================================
// Single-intent placement
// ============================================================

interface PlaceOneIntentOutcome {
  proposed?: ProposedItem;
  deferred?: DeferredItem;
  conflict?: PlacementConflict;
  /** The exact interval to register as "already placed" for every
   * intent processed after this one -- present only when `proposed` is. */
  placedInterval?: { start: Date; end: Date };
}

/** Picks a single shared `primaryReason` when every rejected candidate
 * failed for the SAME reason, else the umbrella `'NO_FEASIBLE_WINDOW'`
 * (this ticket's own section 15). */
function summarizeRejections(diagnostics: readonly PlacementDiagnostic[]): PlacementDeferralReason {
  const distinctReasons = new Set(diagnostics.map((d) => d.reason));
  if (distinctReasons.size === 1) {
    const shared = diagnostics[0].reason;
    if (shared === 'BLOCKED_BY_COMMITMENT' || shared === 'CONFLICTS_WITH_PROPOSED_ITEM' || shared === 'OUTSIDE_CONSTRUCTION_WINDOW') return shared;
  }
  return 'NO_FEASIBLE_WINDOW';
}

/**
 * Places a single FIXED intent against its own `FixedPlacementConstraint`
 * -- never consults `candidatesByIntentId` at all (pre-commit review
 * fix, this ticket's own section 5: "FIXED must not depend on
 * candidates"). Zero or more-than-one supplied constraints, a malformed
 * constraint, or a duration mismatch are all `FIXED_WINDOW_INVALID`
 * (this ticket's own section 4); a structurally valid constraint that
 * loses to the construction window or an existing/already-placed
 * interval is `OUTSIDE_CONSTRUCTION_WINDOW`/`FIXED_WINDOW_CONFLICT`.
 */
function placeFixedIntent(intent: DayIntent, requiredMinutes: number, constraints: readonly FixedPlacementConstraint[], window: ConstructionWindow, normalizedBlockers: readonly BlockedInterval[], placedIntervals: readonly OwnedInterval[]): PlaceOneIntentOutcome {
  if (constraints.length !== 1) {
    // Zero (missing) or more than one (ambiguous, "do not silently
    // select one" -- this ticket's own section 4) are both invalid.
    return { deferred: { intentId: intent.id, primaryReason: 'FIXED_WINDOW_INVALID', diagnostics: [] } };
  }
  const constraint = constraints[0];
  if (constraint.intentId !== intent.id) {
    return { deferred: { intentId: intent.id, primaryReason: 'FIXED_WINDOW_INVALID', diagnostics: [] } };
  }
  if (!(constraint.start instanceof Date) || Number.isNaN(constraint.start.getTime()) || !(constraint.end instanceof Date) || Number.isNaN(constraint.end.getTime()) || constraint.start.getTime() >= constraint.end.getTime()) {
    return { deferred: { intentId: intent.id, primaryReason: 'FIXED_WINDOW_INVALID', diagnostics: [] } };
  }
  const constraintMinutes = (constraint.end.getTime() - constraint.start.getTime()) / 60000;
  if (constraintMinutes !== requiredMinutes) {
    return { deferred: { intentId: intent.id, primaryReason: 'FIXED_WINDOW_INVALID', diagnostics: [] } };
  }

  const evaluation = evaluateFixedConstraint(constraint, window, normalizedBlockers, placedIntervals);
  if (evaluation.feasible) {
    const proposed: ProposedItem = {
      intentId: intent.id,
      activityId: intent.activityId,
      title: intent.title,
      start: constraint.start,
      end: constraint.end,
      placementSource: 'FIXED_CONSTRAINT',
      requiresConfirmation: true,
    };
    return { proposed, placedInterval: { start: constraint.start, end: constraint.end } };
  }
  if (evaluation.reason === 'OUTSIDE_CONSTRUCTION_WINDOW') {
    return { deferred: { intentId: intent.id, primaryReason: 'OUTSIDE_CONSTRUCTION_WINDOW', diagnostics: [] } };
  }
  // BLOCKED_BY_COMMITMENT or CONFLICTS_WITH_PROPOSED_ITEM -- either way,
  // from a FIXED intent's own point of view this is a single, specific
  // "your fixed slot is unavailable" fact (this ticket's own section 4/
  // 14), reported as FIXED_WINDOW_CONFLICT never the generic
  // BLOCKED_BY_COMMITMENT/CONFLICTS_WITH_PROPOSED_ITEM a FLEXIBLE
  // intent's own multi-candidate diagnosis would use.
  const conflictingIntentId = evaluation.reason === 'CONFLICTS_WITH_PROPOSED_ITEM' ? evaluation.conflictingIntentId : undefined;
  return {
    deferred: { intentId: intent.id, primaryReason: 'FIXED_WINDOW_CONFLICT', diagnostics: [] },
    conflict: { intentId: intent.id, conflictingIntentId, reason: 'FIXED_WINDOW_CONFLICT' },
  };
}

function placeOneIntent(
  intent: DayIntent,
  candidates: readonly PlacementCandidate[],
  fixedConstraints: readonly FixedPlacementConstraint[],
  window: ConstructionWindow,
  normalizedBlockers: readonly BlockedInterval[],
  placedIntervals: readonly OwnedInterval[]
): PlaceOneIntentOutcome {
  if (intent.estimatedDurationMinutes === undefined) {
    return { deferred: { intentId: intent.id, primaryReason: 'DURATION_UNKNOWN', diagnostics: [] } };
  }
  const requiredMinutes = intent.estimatedDurationMinutes;

  if (intent.flexibility === 'FIXED') {
    return placeFixedIntent(intent, requiredMinutes, fixedConstraints, window, normalizedBlockers, placedIntervals);
  }

  if (candidates.length === 0) {
    return { deferred: { intentId: intent.id, primaryReason: 'NO_CANDIDATES', diagnostics: [] } };
  }

  // FLEXIBLE: evaluate every supplied candidate, rank the feasible ones,
  // place the best.
  const diagnostics: PlacementDiagnostic[] = [];
  const feasible: { candidate: PlacementCandidate; interval: { start: Date; end: Date } }[] = [];
  let firstConflictInterval: { start: Date; end: Date } | undefined;
  for (const candidate of candidates) {
    const evaluation = evaluateCandidate(candidate, intent, requiredMinutes, window, normalizedBlockers, placedIntervals);
    if (evaluation.feasible) {
      feasible.push({ candidate, interval: evaluation.interval });
      continue;
    }
    diagnostics.push({ candidateOrder: candidate.candidateOrder, reason: evaluation.reason });
    if (evaluation.reason === 'CONFLICTS_WITH_PROPOSED_ITEM' && !firstConflictInterval) firstConflictInterval = evaluation.interval;
  }

  if (feasible.length === 0) {
    const primaryReason = summarizeRejections(diagnostics);
    const deferred: DeferredItem = { intentId: intent.id, primaryReason, diagnostics };
    if (primaryReason === 'BLOCKED_BY_COMMITMENT' || primaryReason === 'CONFLICTS_WITH_PROPOSED_ITEM') {
      const owner = primaryReason === 'CONFLICTS_WITH_PROPOSED_ITEM' && firstConflictInterval ? findOverlapping(firstConflictInterval, placedIntervals)?.intentId : undefined;
      return { deferred, conflict: { intentId: intent.id, conflictingIntentId: owner, reason: primaryReason } };
    }
    return { deferred };
  }

  feasible.sort((a, b) => compareCandidatesForPlacement(a.candidate, b.candidate));
  const chosen = feasible[0];
  const proposed: ProposedItem = {
    intentId: intent.id,
    activityId: intent.activityId,
    title: intent.title,
    start: chosen.interval.start,
    end: chosen.interval.end,
    placementSource: 'SELECTED_CANDIDATE',
    timingFit: chosen.candidate.timingFit,
    candidateOrder: chosen.candidate.candidateOrder,
    requiresConfirmation: true,
  };
  return { proposed, placedInterval: chosen.interval };
}

// ============================================================
// constructDay -- the main entry point.
// ============================================================

/**
 * Constructs a proposed day from explicit intents, existing constraints,
 * and already-computed candidate windows. Pure: given the same
 * `ConstructDayInput`, always returns byte-equivalent output (see this
 * file's own determinism contract -- no clock read, no randomness, no DB,
 * no `Object.keys`/`Object.entries` iteration order dependency, since
 * every loop is driven by the caller-ordered `intents` array or an
 * already-sorted candidate array, never by `candidatesByIntentId`'s own
 * key enumeration).
 *
 * Algorithm (this ticket's own section 12, implemented literally):
 *   1. Validate `window`/compute capacity for the FULL requested load;
 *      fail the whole construction closed on `TIMEZONE_MISSING`/
 *      `INVALID_CONSTRUCTION_WINDOW`/`NO_USABLE_CAPACITY` (section 18).
 *   2. Sort intents by `compareByOverloadPrecedence` (PR A, reused
 *      verbatim -- section 9).
 *   3. FIXED RESERVATION INVARIANT (post-V1 audit gap G1): EVALUATE in
 *      two phases over that SAME precedence-sorted sequence -- every
 *      FIXED intent first (in its own precedence-relative order), then
 *      every FLEXIBLE intent (in its own precedence-relative order) --
 *      so a successfully-placed FIXED intent's exact interval always
 *      enters `placedIntervals` before any FLEXIBLE candidate is ever
 *      evaluated, regardless of submission/precedence order between the
 *      two. `compareByOverloadPrecedence` itself is NEVER modified --
 *      reservation (can a FLEXIBLE intent occupy a FIXED intent's
 *      declared time? no) and precedence (which intent is deferred when
 *      the day is impossible? unchanged) remain separate concerns; this
 *      two-phase EVALUATION order only changes when each intent's own
 *      placement is attempted, never how same-flexibility intents rank
 *      against each other (still `compareByOverloadPrecedence`,
 *      unmodified). An invalid/infeasible FIXED intent contributes
 *      nothing to `placedIntervals` (only a successful `outcome.proposed`
 *      ever does, exactly as before) -- never a phantom reservation.
 *   4. RESULT ORDER is deliberately NOT the evaluation order: every
 *      outcome is recorded by intent id during the two-phase evaluation,
 *      then `proposedItems`/`deferredItems`/`conflicts` are rebuilt by
 *      walking `orderedIntents` (the SAME single global precedence
 *      sequence step 2 already produced) exactly once more. This
 *      preserves the pre-existing, externally-observable result-array
 *      ordering contract byte-for-byte (e.g. `DayPlanPreview`'s own
 *      "Couldn't fit" section renders `deferredItems` in raw array order,
 *      never re-sorted) -- evaluation order changed to fix placement
 *      correctness; result order did not change at all.
 *   5. Compute a second capacity snapshot against only the minutes
 *      actually placed (section 18).
 */
export function constructDay(input: ConstructDayInput): ConstructDayResult {
  const { intents, window, blockedIntervals, candidatesByIntentId, fixedConstraintsByIntentId, today } = input;

  const { totalMinutes: requestedMinutes } = sumConstructibleDurationMinutes(intents);
  const requestedCapacityResult = computeCapacitySnapshot(window, blockedIntervals, requestedMinutes);
  if (requestedCapacityResult.status !== 'READY') {
    return requestedCapacityResult;
  }

  const normalizedBlockers = normalizeBlockedIntervals(blockedIntervals, window);
  const orderedIntents = sortByOverloadPrecedence(intents, today);

  // Reservation invariant (G1) -- a stable partition of the SAME
  // precedence-sorted sequence: every FIXED intent (own relative order
  // preserved), then every FLEXIBLE intent (own relative order
  // preserved). Evaluation order only -- see this function's own doc
  // comment, steps 3/4.
  const evaluationOrder = [...orderedIntents.filter((intent) => intent.flexibility === 'FIXED'), ...orderedIntents.filter((intent) => intent.flexibility === 'FLEXIBLE')];

  const outcomesByIntentId = new Map<string, PlaceOneIntentOutcome>();
  const placedIntervals: OwnedInterval[] = [];

  for (const intent of evaluationOrder) {
    const candidates = candidatesByIntentId[intent.id] ?? [];
    const fixedConstraints = fixedConstraintsByIntentId[intent.id] ?? [];
    const outcome = placeOneIntent(intent, candidates, fixedConstraints, window, normalizedBlockers, placedIntervals);
    outcomesByIntentId.set(intent.id, outcome);
    if (outcome.proposed && outcome.placedInterval) {
      placedIntervals.push({ ...outcome.placedInterval, intentId: intent.id });
    }
  }

  // Result order is deliberately NOT evaluation order -- rebuilt by
  // walking `orderedIntents` (the single global precedence sequence),
  // preserving the pre-existing, externally-observable array ordering
  // contract byte-for-byte.
  const proposedItems: ProposedItem[] = [];
  const deferredItems: DeferredItem[] = [];
  const conflicts: PlacementConflict[] = [];
  for (const intent of orderedIntents) {
    const outcome = outcomesByIntentId.get(intent.id)!;
    if (outcome.proposed) proposedItems.push(outcome.proposed);
    if (outcome.deferred) deferredItems.push(outcome.deferred);
    if (outcome.conflict) conflicts.push(outcome.conflict);
  }

  const placedMinutes = proposedItems.reduce((total, item) => total + (item.end.getTime() - item.start.getTime()) / 60000, 0);
  const proposedCapacityResult = computeCapacitySnapshot(window, blockedIntervals, placedMinutes);
  // proposedCapacityResult is structurally guaranteed READY here: the
  // SAME window/blockedIntervals already produced a READY result above
  // with a >= requestedMinutes value, and placedMinutes can only be
  // <= requestedMinutes (every placed item's duration came from an
  // already-summed constructible intent) -- usableMinutes is therefore
  // identically > 0 on this second call too.
  const proposedCapacity = proposedCapacityResult.status === 'READY' ? proposedCapacityResult.snapshot : requestedCapacityResult.snapshot;

  const day: ConstructedDay = {
    date: window.date,
    proposedItems,
    deferredItems,
    conflicts,
    requestedCapacity: requestedCapacityResult.snapshot,
    proposedCapacity,
  };
  return { status: 'READY', day };
}
