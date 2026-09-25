/**
 * Remaining-Day Recomposition V1 PR F2 -- READ-ONLY proposal generation with minimal disruption.
 *
 * "Given what remains of today, should Aura propose changing the schedule?"  This module answers that with an
 * EPHEMERAL proposal. It never writes, never calls Move, never persists anything and adds no UI.
 *
 * PRODUCT PRINCIPLE: KEEP IS THE DEFAULT. Recomposition is not "rebuild my day"; it is "preserve my day unless
 * changing it is a demonstrable improvement". A plan moves only when
 *   (A) its current slot is no longer feasible (CURRENT_SLOT_INVALID), OR
 *   (B) the proposed slot has a STRICTLY better timing tier than the current slot (BETTER_TIMING_TIER).
 * Same tier (even if earlier), a worse tier, or no alternative all mean KEEP.
 *
 * ARCHITECTURE (nothing here re-implements the Constructor):
 *   PlannedActivity rows (today)  ->  classify: protected vs reconsiderable (F1 `hasFlexibleScheduling`)
 *   -> current-slot feasibility (the Constructor itself, asked with a FIXED intent at the current slot)
 *   -> current-slot timing tier (the existing timing CHECK)
 *   -> hypothetical placement of the reconsiderable plans TOGETHER through `orchestrateConstructDay`
 *      (REMAINING_TODAY window, availability, timing search, blockers, capacity all unchanged), with the
 *      reconsidered plans' own slots RELEASED at the blocker-loading boundary (never by weakening
 *      `isActivePlanBlocker`)
 *   -> minimal-disruption policy -> one coherent hypothetical day.
 * `constructDay` and its candidate ranking are untouched (the strict tier order is read back from the
 * Constructor's own exported `compareCandidatesForPlacement`, never re-invented).
 *
 * COHERENCE WITHOUT POST-HOC EDITS: the Constructor places the reconsidered plans together, so a plan cannot simply
 * be flipped MOVE -> KEEP afterwards (its old slot may already have been given to another plan). Instead the policy
 * is a bounded fixed point: run the hypothetical placement; take the FIRST (chronological) plan whose proposed
 * change is not a meaningful improvement; PIN it -- its current slot becomes an ordinary blocker again -- and
 * re-run the rest. Each pass pins at most one new plan, so with n reconsidered plans there are at most n
 * placement runs (a pass that pins nothing is the last one): termination is immediate, with no backtracking or
 * search. Every surviving MOVE therefore comes from ONE final Constructor run in which every KEEP and every
 * protected plan is a blocker, so the proposal never overlaps itself.
 *
 * KNOWN LIMITATIONS (deliberate V1 scope):
 *  - The Constructor stays greedy, so it can miss a globally better arrangement; the proposal is never WORSE than
 *    today (KEEP wins ties), but it is not an optimizer.
 *  - Importance/deadline are not persisted on PlannedActivity; hypothetical intents take the Constructor's neutral
 *    defaults (MEDIUM, no deadline), so precedence among reconsidered plans falls back to chronological order.
 *  - Today only: no tomorrow deferral, no week planning, no automatic application; a plan that cannot be placed is
 *    left exactly where it is (never cancelled, skipped or deferred).
 *  - The current-slot tier is a timing CHECK by activityId (or title, the acceptance convention); alternatives come
 *    from the orchestrator's FIND, which resolves the activity the same way.
 *  - The separate open-time discrepancy (DailyAgenda openings vs Constructor blockers on LOGGED time) is NOT solved
 *    here and this proposal exposes no "minutes gained" figure.
 */
import { hasFlexibleScheduling } from './plannedActivitySchedulingMode';
import {
  orchestrateConstructDay,
  mapTimingLabelToPlacementFit,
  type ConstructDayRequest,
  type DayConstructorOrchestratorDeps,
  type OrchestrateConstructDayResult,
  type PlanBlockerCandidate,
  type RequestedDayIntent,
} from './dayConstructorOrchestrator';
import { compareCandidatesForPlacement, type PlacementTimingFit, type ProposedItem } from './dayConstructor';
import { localDayBoundsUTC } from './myDayOrchestrator';
import { getDatePartsInTimezone } from './timezone';
import type { TimingCandidate } from '../../../packages/recommendation/src/timingSearch';
import type { PlannedActivity } from './db';

/** Same hard cap the Day Constructor preview uses per request; plans beyond it stay protected. */
export const MAX_RECOMPOSITION_CANDIDATES = 12;

// ============================================================
// Types
// ============================================================

export interface RecompositionSlot {
  start: Date;
  end: Date;
}

export type RecompositionProtectionReason =
  | 'MISSED' // derived: UPCOMING and already elapsed -- Missed Recovery owns it
  | 'ACTIVE' // happening now -- never touched
  | 'SCHEDULING_MODE_NOT_FLEXIBLE' // FIXED, NULL/unknown or anything that is not an explicit FLEXIBLE (F1)
  | 'HAS_ACTIVE_MOMENT' // an active shared AuraMoment is linked (the Move restriction, mirrored)
  | 'OUTSIDE_TODAY' // not wholly inside the remaining local day
  | 'INCONSISTENT_DURATION' // end - start disagrees with durationMinutes: unsafe to re-place
  | 'OVER_CANDIDATE_LIMIT'; // beyond MAX_RECOMPOSITION_CANDIDATES

export interface ProtectedPlan {
  planId: string;
  title: string;
  reason: RecompositionProtectionReason;
}

/** Why the Constructor would not place the plan at its current slot. BLOCKED_OR_UNAVAILABLE covers an overlapping commitment AND an availability gap (the Constructor models a gap as a blocker). */
export type CurrentSlotInvalidReason = 'BLOCKED_OR_UNAVAILABLE' | 'OUTSIDE_REMAINING_WINDOW' | 'NOT_PLACEABLE';

/** What the Constructor's best alternative for a plan looked like when KEEP won. */
export type KeepAlternative = { kind: 'NONE' } | { kind: 'SAME_SLOT' } | { kind: 'SLOT'; slot: RecompositionSlot; tier: PlacementTimingFit | null };

export interface KeepDecision {
  decision: 'KEEP';
  planId: string;
  title: string;
  current: RecompositionSlot;
  reason: 'NO_STRICT_IMPROVEMENT';
  evidence: { currentTier: PlacementTimingFit | null; alternative: KeepAlternative };
}
export interface MoveDecision {
  decision: 'MOVE';
  planId: string;
  title: string;
  current: RecompositionSlot;
  to: RecompositionSlot;
  durationMinutes: number;
  reason: 'BETTER_TIMING_TIER' | 'CURRENT_SLOT_INVALID';
  evidence: { currentTier: PlacementTimingFit | null; proposedTier: PlacementTimingFit | null; currentSlotInvalid?: CurrentSlotInvalidReason };
}
/** The current slot is no longer feasible AND no alternative exists: left exactly where it is, nothing mutated. */
export interface UnresolvedDecision {
  decision: 'UNRESOLVED';
  planId: string;
  title: string;
  current: RecompositionSlot;
  reason: 'CURRENT_SLOT_INVALID_NO_ALTERNATIVE';
  evidence: { currentTier: PlacementTimingFit | null; currentSlotInvalid: CurrentSlotInvalidReason };
}
export type RecompositionDecision = KeepDecision | MoveDecision | UnresolvedDecision;

export interface RemainingDayRecompositionProposal {
  generatedAt: Date;
  targetDate: string;
  timezone: string;
  /** The reconsidered plans exactly as committed today, chronological. */
  currentState: Array<{ planId: string; title: string; slot: RecompositionSlot }>;
  /** The same plans after the decisions (KEEP/UNRESOLVED keep their slot). */
  proposedState: Array<{ planId: string; title: string; slot: RecompositionSlot }>;
  /** One decision per reconsidered plan -- never silently omitted -- in chronological order of the CURRENT slot. */
  decisions: RecompositionDecision[];
  /** Plans that were considered but are protected, with why. History (LOGGED / SKIPPED / MOVED) is not listed. */
  protectedPlans: ProtectedPlan[];
  summary: {
    state: 'NO_CHANGES' | 'CHANGES_PROPOSED';
    moveCount: number;
    keepCount: number;
    unresolvedCount: number;
    /** Hypothetical placement runs performed (<= number of reconsidered plans). */
    placementRuns: number;
  };
}

export type RemainingDayRecompositionResult =
  | { status: 'READY'; proposal: RemainingDayRecompositionProposal }
  | { status: 'NO_USABLE_CAPACITY' }
  | { status: 'TIMEZONE_MISSING' }
  | { status: 'INVALID_REQUEST'; reason: string }
  | { status: 'TIMING_FAILED'; reason: string };

export interface RecompositionDeps extends Omit<DayConstructorOrchestratorDeps, 'loadBlockingPlans'> {
  /** Every plan of the local day EXCEPT cancelled ones (`listPlannedActivitiesForDay`): read once per run. */
  loadPlansForDay: (bounds: { from: Date; to: Date }) => Promise<PlannedActivity[]>;
  /** Ids (among those given) that have an ACTIVE, unexpired AuraMoment linked -- the existing Move restriction. */
  loadPlanIdsWithActiveMoment: (planIds: string[], now: Date) => Promise<ReadonlySet<string>>;
  /** The existing timing CHECK for an exact start (the acceptance convention: activityId else title). May throw. */
  checkTiming: (request: { activityId?: string; taskTitle?: string; candidateStart: Date; durationMinutes: number }) => TimingCandidate;
}

// ============================================================
// Timing-tier comparison -- the Constructor's own order, not a new score
// ============================================================

/**
 * -1 when `a` is a strictly better tier than `b`, 1 when strictly worse, 0 when equal. Read back from the
 * Constructor's exported `compareCandidatesForPlacement` with everything but the tier held identical, so the
 * ordering (BEST < GOOD < WORKABLE < CAUTION < unknown) has exactly one definition. `null`/undefined = unknown =
 * weaker than every real tier.
 */
export function compareTimingTiers(a: PlacementTimingFit | null | undefined, b: PlacementTimingFit | null | undefined): -1 | 0 | 1 {
  const at = new Date(0);
  const make = (fit: PlacementTimingFit | null | undefined) => ({ intentId: 'tier', start: at, end: at, candidateOrder: 0, ...(fit ? { timingFit: fit } : {}) });
  const delta = compareCandidatesForPlacement(make(a), make(b));
  return delta < 0 ? -1 : delta > 0 ? 1 : 0;
}

export const isStrictlyBetterTier = (proposed: PlacementTimingFit | null | undefined, current: PlacementTimingFit | null | undefined) => compareTimingTiers(proposed, current) < 0;

// ============================================================
// Classification (pure)
// ============================================================

const MINUTE_MS = 60_000;

export interface ClassifiedPlans {
  /** Reconsiderable plans, chronological (start, id) -- the deterministic order everything downstream uses. */
  candidates: PlannedActivity[];
  protectedPlans: ProtectedPlan[];
}

/**
 * Splits today's plans into the reconsiderable set and the protected set. Rules (first match wins, for an UPCOMING plan):
 *   non-UPCOMING          history (LOGGED / SKIPPED / MOVED / CANCELLED): never a candidate, never listed
 *   end < now             MISSED (derived; Missed Recovery owns it)
 *   start <= now          ACTIVE
 *   not explicit FLEXIBLE FIXED / NULL / unknown (F1 `hasFlexibleScheduling`, never truthiness)
 *   active AuraMoment     HAS_ACTIVE_MOMENT
 *   not inside today      OUTSIDE_TODAY
 *   end - start != duration  INCONSISTENT_DURATION (fail closed)
 * Manual-Move eligibility is deliberately not consulted: a FIXED plan may still be moved by the user, but Aura may
 * not reconsider it.
 */
export function classifyPlansForRecomposition(plans: readonly PlannedActivity[], now: Date, dayBounds: { from: Date; to: Date }, planIdsWithActiveMoment: ReadonlySet<string>): ClassifiedPlans {
  const protectedPlans: ProtectedPlan[] = [];
  const eligible: PlannedActivity[] = [];
  const ordered = [...plans].sort((a, b) => new Date(a.plannedStartAt).getTime() - new Date(b.plannedStartAt).getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const plan of ordered) {
    if (plan.status !== 'UPCOMING') continue;
    const start = new Date(plan.plannedStartAt).getTime();
    const end = new Date(plan.plannedEndAt).getTime();
    const protect = (reason: RecompositionProtectionReason) => protectedPlans.push({ planId: plan.id, title: plan.title, reason });
    if (end < now.getTime()) protect('MISSED');
    else if (start <= now.getTime()) protect('ACTIVE');
    else if (!hasFlexibleScheduling(plan)) protect('SCHEDULING_MODE_NOT_FLEXIBLE');
    else if (planIdsWithActiveMoment.has(plan.id)) protect('HAS_ACTIVE_MOMENT');
    else if (start < dayBounds.from.getTime() || end > dayBounds.to.getTime()) protect('OUTSIDE_TODAY');
    else if (!Number.isFinite(plan.durationMinutes) || plan.durationMinutes <= 0 || end - start !== plan.durationMinutes * MINUTE_MS) protect('INCONSISTENT_DURATION');
    else eligible.push(plan);
  }
  const candidates = eligible.slice(0, MAX_RECOMPOSITION_CANDIDATES);
  for (const plan of eligible.slice(MAX_RECOMPOSITION_CANDIDATES)) protectedPlans.push({ planId: plan.id, title: plan.title, reason: 'OVER_CANDIDATE_LIMIT' });
  return { candidates, protectedPlans };
}

// ============================================================
// The service
// ============================================================

const slotOf = (plan: PlannedActivity): RecompositionSlot => ({ start: new Date(plan.plannedStartAt), end: new Date(plan.plannedEndAt) });
const toBlockerCandidate = (plan: PlannedActivity): PlanBlockerCandidate => ({ start: new Date(plan.plannedStartAt), end: new Date(plan.plannedEndAt), status: plan.status });

type PinnedDecision = { kind: 'KEEP'; alternative: KeepAlternative } | { kind: 'UNRESOLVED' };

export async function recomposeRemainingDay(input: { timezone: string; now: Date }, deps: RecompositionDeps): Promise<RemainingDayRecompositionResult> {
  const { timezone, now } = input;
  if (!timezone || !timezone.trim()) return { status: 'TIMEZONE_MISSING' };
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return { status: 'INVALID_REQUEST', reason: 'now must be a valid Date.' };

  // Today only, in the user's own timezone (existing utilities; absolute instants for feasibility).
  const targetDate = getDatePartsInTimezone(timezone, now).dateStr;
  const dayBounds = localDayBoundsUTC(targetDate, timezone);

  const rows = await deps.loadPlansForDay(dayBounds);
  const upcomingFutureIds = rows.filter((row) => row.status === 'UPCOMING' && new Date(row.plannedStartAt).getTime() > now.getTime()).map((row) => row.id).sort();
  const momentIds = upcomingFutureIds.length > 0 ? await deps.loadPlanIdsWithActiveMoment(upcomingFutureIds, now) : new Set<string>();
  const { candidates, protectedPlans } = classifyPlansForRecomposition(rows, now, dayBounds, momentIds);

  const emptyProposal = (): RemainingDayRecompositionResult => ({
    status: 'READY',
    proposal: { generatedAt: now, targetDate, timezone, currentState: [], proposedState: [], decisions: [], protectedPlans, summary: { state: 'NO_CHANGES', moveCount: 0, keepCount: 0, unresolvedCount: 0, placementRuns: 0 } },
  });
  if (candidates.length === 0) return emptyProposal();

  // One consistent snapshot per run: the duration/availability reads happen once (determinism, and fewer reads).
  let durationContext: ReturnType<DayConstructorOrchestratorDeps['loadDurationContext']> | undefined;
  let availability: ReturnType<DayConstructorOrchestratorDeps['loadAvailabilityConfiguration']> | undefined;
  const constructorDeps = (excluded: ReadonlySet<string>): DayConstructorOrchestratorDeps => ({
    // The ONLY place a plan's slot is released: an explicit id set, at the loading boundary. isActivePlanBlocker is untouched.
    loadBlockingPlans: async () => rows.filter((row) => !excluded.has(row.id)).map(toBlockerCandidate),
    loadDurationContext: () => (durationContext ??= deps.loadDurationContext()),
    searchTiming: deps.searchTiming,
    loadAvailabilityConfiguration: () => (availability ??= deps.loadAvailabilityConfiguration()),
  });
  const baseRequest = { targetDate, timezone, constructionWindowSource: 'REMAINING_TODAY' as const, now };
  const candidateIds = new Set(candidates.map((plan) => plan.id));
  const intentFor = (plan: PlannedActivity, index: number, flexibility: 'FLEXIBLE' | 'FIXED'): RequestedDayIntent => ({
    id: plan.id, // identity survives planning: intentId = PlannedActivity.id
    title: plan.title,
    activityId: plan.activityId ?? undefined,
    durationMinutes: plan.durationMinutes,
    flexibility,
    ...(flexibility === 'FIXED' ? { fixedStart: new Date(plan.plannedStartAt) } : {}),
    originalOrder: index,
  });
  const fail = (result: Exclude<OrchestrateConstructDayResult, { status: 'READY' }>): RemainingDayRecompositionResult => {
    switch (result.status) {
      case 'NO_USABLE_CAPACITY': return { status: 'NO_USABLE_CAPACITY' };
      case 'TIMEZONE_MISSING': return { status: 'TIMEZONE_MISSING' };
      case 'TIMING_SEARCH_FAILED': return { status: 'TIMING_FAILED', reason: result.reason };
      case 'INVALID_REQUEST': return { status: 'INVALID_REQUEST', reason: result.reason };
      case 'INVALID_CONSTRUCTION_WINDOW': return { status: 'INVALID_REQUEST', reason: 'The remaining-day window is invalid.' };
      case 'FUTURE_AVAILABILITY_REQUIRED': return { status: 'INVALID_REQUEST', reason: 'Availability is required for a future date; recomposition is today-only.' };
    }
  };

  // ---- current-slot feasibility (the Constructor itself, asked about the current slot as a FIXED intent) ----
  const currentInvalid = new Map<string, CurrentSlotInvalidReason>();
  const currentTier = new Map<string, PlacementTimingFit | null>();
  for (const [index, plan] of candidates.entries()) {
    const result = await orchestrateConstructDay({ ...baseRequest, intents: [intentFor(plan, index, 'FIXED')] } as ConstructDayRequest, constructorDeps(candidateIds));
    if (result.status !== 'READY') return fail(result);
    const day = result.preview.constructedDay;
    if (!day.proposedItems.some((item) => item.intentId === plan.id)) {
      const deferred = day.deferredItems.find((item) => item.intentId === plan.id);
      currentInvalid.set(plan.id, deferred?.primaryReason === 'FIXED_WINDOW_CONFLICT' ? 'BLOCKED_OR_UNAVAILABLE' : deferred?.primaryReason === 'OUTSIDE_CONSTRUCTION_WINDOW' ? 'OUTSIDE_REMAINING_WINDOW' : 'NOT_PLACEABLE');
    }
    // Timing quality of the current slot, from the existing CHECK -- never assumed good because it is current.
    try {
      const checked = deps.checkTiming({ activityId: plan.activityId ?? undefined, taskTitle: plan.title, candidateStart: new Date(plan.plannedStartAt), durationMinutes: plan.durationMinutes });
      currentTier.set(plan.id, mapTimingLabelToPlacementFit(checked.label));
    } catch (error) {
      return { status: 'TIMING_FAILED', reason: error instanceof Error ? error.message : String(error) };
    }
  }

  // ---- bounded fixed point: pin the first non-meaningful plan, re-place the rest ----
  const pinned = new Map<string, PinnedDecision>();
  let placementRuns = 0;
  let finalPlacements = new Map<string, ProposedItem>();
  for (;;) {
    const active = candidates.filter((plan) => !pinned.has(plan.id));
    if (active.length === 0) { finalPlacements = new Map(); break; }
    const released = new Set(active.map((plan) => plan.id));
    const result = await orchestrateConstructDay({ ...baseRequest, intents: active.map((plan, index) => intentFor(plan, index, 'FLEXIBLE')) } as ConstructDayRequest, constructorDeps(released));
    placementRuns += 1;
    if (result.status !== 'READY') return fail(result);
    const placements = new Map(result.preview.constructedDay.proposedItems.map((item) => [item.intentId, item]));

    let toPin: { plan: PlannedActivity; pin: PinnedDecision } | null = null;
    for (const plan of active) {
      const placement = placements.get(plan.id);
      const invalid = currentInvalid.get(plan.id);
      const sameSlot = !!placement && placement.start.getTime() === new Date(plan.plannedStartAt).getTime();
      const meaningful = !!placement && !sameSlot && (invalid !== undefined || isStrictlyBetterTier(placement.timingFit ?? null, currentTier.get(plan.id)));
      if (meaningful) continue;
      if (invalid !== undefined) toPin = { plan, pin: { kind: 'UNRESOLVED' } };
      else toPin = { plan, pin: { kind: 'KEEP', alternative: !placement ? { kind: 'NONE' } : sameSlot ? { kind: 'SAME_SLOT' } : { kind: 'SLOT', slot: { start: placement.start, end: placement.end }, tier: placement.timingFit ?? null } } };
      break;
    }
    if (!toPin) { finalPlacements = placements; break; }
    pinned.set(toPin.plan.id, toPin.pin);
  }

  // ---- decisions: one per reconsidered plan, chronological ----
  const decisions: RecompositionDecision[] = candidates.map((plan): RecompositionDecision => {
    const current = slotOf(plan);
    const tier = currentTier.get(plan.id) ?? null;
    const pin = pinned.get(plan.id);
    if (pin?.kind === 'KEEP') return { decision: 'KEEP', planId: plan.id, title: plan.title, current, reason: 'NO_STRICT_IMPROVEMENT', evidence: { currentTier: tier, alternative: pin.alternative } };
    if (pin?.kind === 'UNRESOLVED') return { decision: 'UNRESOLVED', planId: plan.id, title: plan.title, current, reason: 'CURRENT_SLOT_INVALID_NO_ALTERNATIVE', evidence: { currentTier: tier, currentSlotInvalid: currentInvalid.get(plan.id)! } };
    const placement = finalPlacements.get(plan.id)!; // unpinned at the fixed point <=> a meaningful move
    const invalid = currentInvalid.get(plan.id);
    return {
      decision: 'MOVE', planId: plan.id, title: plan.title, current,
      to: { start: placement.start, end: placement.end }, durationMinutes: plan.durationMinutes,
      reason: invalid !== undefined ? 'CURRENT_SLOT_INVALID' : 'BETTER_TIMING_TIER',
      evidence: { currentTier: tier, proposedTier: placement.timingFit ?? null, ...(invalid !== undefined ? { currentSlotInvalid: invalid } : {}) },
    };
  });

  const moveCount = decisions.filter((d) => d.decision === 'MOVE').length;
  return {
    status: 'READY',
    proposal: {
      generatedAt: now, targetDate, timezone,
      currentState: candidates.map((plan) => ({ planId: plan.id, title: plan.title, slot: slotOf(plan) })),
      proposedState: decisions.map((d) => ({ planId: d.planId, title: d.title, slot: d.decision === 'MOVE' ? d.to : d.current })),
      decisions, protectedPlans,
      summary: { state: moveCount > 0 ? 'CHANGES_PROPOSED' : 'NO_CHANGES', moveCount, keepCount: decisions.filter((d) => d.decision === 'KEEP').length, unresolvedCount: decisions.filter((d) => d.decision === 'UNRESOLVED').length, placementRuns },
    },
  };
}
