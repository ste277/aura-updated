/**
 * Constructor Decision Intelligence -- O5 P4b2: the PURE, SCOPE-ISOLATED LOCAL COUNTERFACTUAL GENERATOR (inert, mechanical, neutral).
 *
 * It answers ONE question and no other: "what mechanically happens if this pressured candidate P is tried in one of its real historical
 * contention slots while every unrelated baseline placement stays pinned?" It does NOT answer "should Aura accept that?": there is no
 * acceptance, safety classification, owner-pressure rule, FIXED-owner policy, non-owner-change rule, net-loss rule or timing-floor rule
 * here. All of that is P4b3. Nothing calls this module in production; it may be imported by tests only.
 *
 * INPUT -- one same-run prepared promotion context (exactly the typed pieces `preparePromotionInputs` returns: the run-level artifacts and one pair):
 *   constructionBasis    the neutral input authority: window, blockers, intents, FIXED constraints, initial + final candidate lists
 *   baselinePlacements   the terminal outcome authority: the exact baseline Proposed placements
 *   schedulingAttempts   the run-level typed attempts (every intent's historical attempted slots, with the candidate's own timing fit)
 *   input                one PromotionInput: the candidate and the authorized FINAL owners (the only release scope; owner pressure is NEVER read)
 *   contention           that input's PromotionContentionAuthority: P's exact historical slots against those owners
 * It never sees the raw P3a trace, DecisionFacts, evidence, scarcity or any caller-supplied pressure. The five pieces are REVALIDATED here
 * (an arbitrary structurally valid object is not trusted); validation never repairs, drops, invents or reconstructs anything.
 *
 * P's SLOTS come ONLY from the contention authority (never from the candidate lists or the attempts directly). Several records for one slot
 * against several owners are ONE scheduling choice, identified by (start, end, timingFit); source order is never an input. The choices are
 * ranked with the Constructor's own exported `compareCandidatesForPlacement` over the captured fit (no discovery order, no invented
 * candidateOrder: equal fit and equal start place the same interval with the same fit, per the #212 proof).
 *
 * LOCAL SCOPE. Baseline placements are PINNED unless they are DISPLACED. For a slot to be usable it must (a) be mechanically valid
 * (finite interval of exactly P's resolved duration, inside the basis window, clear of every external blocker), (b) overlap at least one
 * TERMINAL baseline placement -- a slot over newly free time is non-actionable (P is never promoted into free time) -- and (c) overlap ONLY
 * placements of authorized owners that are FLEXIBLE. A slot overlapping a non-owner, or a FIXED owner, is mechanically unusable (FIXED is
 * immovable; no policy label is produced); the next neutrally ranked slot is tried. The historical owner relation proves why P lost that
 * slot THEN; only the TERMINAL overlap decides who is displaced NOW, so an authorized owner the slot does not terminally overlap stays
 * byte-identically pinned. The first usable slot in ranking order is the one tried; no usable slot -> UNAVAILABLE / NO_ACTIONABLE_PROMOTION_SLOT.
 *
 * OWNER RELOCATION. Each displaced FLEXIBLE owner, in the Constructor's own `compareByOverloadPrecedence` order over its basis intent (never
 * by pressure), picks the best-ranked usable alternative from exactly: initialCandidates(O) UNION finalCandidates(O) UNION the
 * schedulingAttempts of O (their conflict provenance is not carried into ranking). Alternatives are deduplicated by (start, timingFit)
 * -- the placed interval is always [start, start + O's resolved duration) -- keeping the longest span so feasibility is never lost; the
 * origin (initial / final / attempt) never affects ranking. An alternative must pass the same mechanical gates against the window, the
 * blockers, every pinned placement, P and the owners already re-placed: a relocated owner never displaces anything (no transitive
 * displacement), and an owner with no usable alternative is simply left UNPLACED -- a valid neutral result, never a rejection. A relocated
 * owner may land on a worse timing fit; that is reported, never judged.
 *
 * THE MECHANICAL GATES are a minimal local copy of the Constructor's candidate gates (the Constructor's helpers are private):
 * WRONG_INTENT, MALFORMED_CANDIDATE, INSUFFICIENT_DURATION, OUTSIDE_CONSTRUCTION_WINDOW, BLOCKED_BY_COMMITMENT, CONFLICTS_WITH_PROPOSED_ITEM;
 * half-open overlap `a.start < b.end && b.start < a.end`; placed interval [start, start + required duration). A blocker of non-positive
 * length is ignored (the Constructor normalizes it away). localCounterfactualGateParity.test.ts compares this verdict with the REAL
 * Constructor (as a test oracle only) over a deterministic combinatorial grid and requires zero mismatches.
 *
 * OUTPUT -- detached, deeply frozen and complete: the promoted placement, the displaced owner ids in processing order, the relocated owner
 * placements, the unplaced owner ids and the COMPLETE counterfactual Proposed set (baseline order with each displaced owner replaced in
 * place or dropped, the promoted placement last). Placement sources are counterfactual-local (BASELINE_UNCHANGED, PROMOTED_CONTENTION_ATTEMPT,
 * RELOCATED_CAPTURED_CANDIDATE); the baseline contract is untouched. Every Date is a new `new Date(ms)`: freezing does NOT protect a Date's
 * time value, so ownership plus the #208 no-Date-mutator guard (this module is on that list) are the authority.
 *
 * PURE: no database, snapshot, clock, timing search, Constructor / orchestrator call, trace, facts, evidence, pressure read, logging, async or
 * environment. Inputs are never mutated. All-or-nothing; never throws; reasons are generation / integrity reasons only.
 * `DecisionPressure.NONE` means "no established pressure"; nothing here infers anything from it.
 */

import { compareCandidatesForPlacement, type PlacementCandidate, type PlacementTimingFit } from './dayConstructor';
import { compareByOverloadPrecedence, type DayIntent } from './dayIntent';
import type { PromotionInput } from './promotionInput';
import type { PromotionContentionOutcome } from './promotionContentionAuthority';
import type { SchedulingAttemptOutcome } from './schedulingAttemptAuthority';
import type { ConstructionBasis, ConstructionBasisIntent, ConstructionBasisOutcome } from './constructionBasis';
import type { BaselinePlacementsOutcome } from './baselinePlacements';

export interface LocalCounterfactualAuthorities {
  readonly constructionBasis: ConstructionBasisOutcome;
  readonly baselinePlacements: BaselinePlacementsOutcome;
  readonly schedulingAttempts: SchedulingAttemptOutcome;
  readonly input: PromotionInput;
  readonly contention: PromotionContentionOutcome;
}

export type CounterfactualPlacementSource = 'BASELINE_UNCHANGED' | 'PROMOTED_CONTENTION_ATTEMPT' | 'RELOCATED_CAPTURED_CANDIDATE';

export interface CounterfactualPlacement {
  readonly intentId: string;
  readonly start: Date;
  readonly end: Date;
  readonly placementSource: CounterfactualPlacementSource;
  /** Carried exactly as the baseline placement / the chosen slot or candidate carried it; absent for a FIXED placement. */
  readonly timingFit?: PlacementTimingFit;
}

export interface LocalCounterfactual {
  readonly candidateIntentId: string;
  readonly promotedPlacement: CounterfactualPlacement;
  /** The authorized FLEXIBLE owners the chosen slot terminally overlaps, in the order they were re-placed. */
  readonly displacedOwnerIds: readonly string[];
  readonly relocatedPlacements: readonly CounterfactualPlacement[];
  readonly unplacedOwnerIds: readonly string[];
  /** The COMPLETE counterfactual Proposed set: baseline order, each displaced owner replaced in place (or dropped), the promoted placement last. */
  readonly counterfactualPlacements: readonly CounterfactualPlacement[];
}

export type LocalCounterfactualUnavailableReason = 'RUN_NOT_READY' | 'INCONSISTENT_AUTHORITY' | 'INVALID_INTERVAL' | 'NO_ACTIONABLE_PROMOTION_SLOT' | 'GENERATION_FAILED';
export type LocalCounterfactualOutcome =
  | { readonly status: 'READY'; readonly counterfactual: LocalCounterfactual }
  | { readonly status: 'UNAVAILABLE'; readonly reason: LocalCounterfactualUnavailableReason };

export type LocalGateFailure = 'WRONG_INTENT' | 'MALFORMED_CANDIDATE' | 'INSUFFICIENT_DURATION' | 'OUTSIDE_CONSTRUCTION_WINDOW' | 'BLOCKED_BY_COMMITMENT' | 'CONFLICTS_WITH_PROPOSED_ITEM';
export type LocalGateVerdict =
  | { readonly feasible: true; readonly start: number; readonly end: number }
  | { readonly feasible: false; readonly reason: LocalGateFailure };

interface Span { readonly start: Date; readonly end: Date }

function unavailable(reason: LocalCounterfactualUnavailableReason): LocalCounterfactualOutcome {
  return Object.freeze({ status: 'UNAVAILABLE', reason });
}

/** Half-open [start, end): touching intervals do not overlap. Exactly the Constructor's formula. */
function overlapsMs(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * The Constructor's candidate feasibility gates, in the Constructor's order, as a pure verdict. `blockers` are the external blockers (a
 * blocker of non-positive length is ignored), `placed` every placement already occupying time. The placed interval is
 * [candidate.start, candidate.start + requiredMinutes) -- never the raw candidate span.
 */
export function evaluateLocalPlacementGate(candidate: { readonly intentId: string; readonly start: Date; readonly end: Date }, intentId: string, requiredMinutes: number, window: Span, blockers: readonly Span[], placed: readonly Span[]): LocalGateVerdict {
  if (candidate.intentId !== intentId) return { feasible: false, reason: 'WRONG_INTENT' };
  if (!(candidate.start instanceof Date) || Number.isNaN(candidate.start.getTime())) return { feasible: false, reason: 'MALFORMED_CANDIDATE' };
  if (!(candidate.end instanceof Date) || Number.isNaN(candidate.end.getTime())) return { feasible: false, reason: 'MALFORMED_CANDIDATE' };
  if (candidate.start.getTime() >= candidate.end.getTime()) return { feasible: false, reason: 'MALFORMED_CANDIDATE' };
  const candidateMinutes = (candidate.end.getTime() - candidate.start.getTime()) / 60000;
  if (!Number.isFinite(candidateMinutes) || candidateMinutes < requiredMinutes) return { feasible: false, reason: 'INSUFFICIENT_DURATION' };
  const start = candidate.start.getTime();
  const end = start + requiredMinutes * 60000;
  if (!(start >= window.start.getTime() && end <= window.end.getTime())) return { feasible: false, reason: 'OUTSIDE_CONSTRUCTION_WINDOW' };
  if (blockers.some((blocker) => blocker.start.getTime() < blocker.end.getTime() && overlapsMs(start, end, blocker.start.getTime(), blocker.end.getTime()))) return { feasible: false, reason: 'BLOCKED_BY_COMMITMENT' };
  if (placed.some((other) => overlapsMs(start, end, other.start.getTime(), other.end.getTime()))) return { feasible: false, reason: 'CONFLICTS_WITH_PROPOSED_ITEM' };
  return { feasible: true, start, end };
}

interface Placed {
  readonly intentId: string;
  readonly start: number;
  readonly end: number;
  readonly source: 'FIXED_CONSTRAINT' | 'SELECTED_CANDIDATE';
  readonly timingFit: PlacementTimingFit | undefined;
}

interface Slot {
  readonly start: number;
  readonly end: number;
  readonly timingFit: PlacementTimingFit | undefined;
}

interface Alternative {
  readonly start: number;
  readonly end: number;
  readonly timingFit: PlacementTimingFit | undefined;
}

function isFiniteDate(date: Date): boolean {
  return date instanceof Date && Number.isFinite(date.getTime());
}

function ownDate(ms: number): Date {
  return Object.freeze(new Date(ms));
}

function toPlacementCandidate(intentId: string, start: number, end: number, timingFit: PlacementTimingFit | undefined): PlacementCandidate {
  return { intentId, start: new Date(start), end: new Date(end), timingFit, candidateOrder: 0 };
}

function placement(intentId: string, start: number, end: number, placementSource: CounterfactualPlacementSource, timingFit: PlacementTimingFit | undefined): CounterfactualPlacement {
  return Object.freeze({ intentId, start: ownDate(start), end: ownDate(end), placementSource, ...(timingFit === undefined ? {} : { timingFit }) });
}

interface ValidContext {
  readonly ok: true;
  readonly basis: ConstructionBasis;
  readonly placed: readonly Placed[];
  readonly candidate: ConstructionBasisIntent;
  readonly ownerIds: readonly string[];
  readonly slots: readonly Slot[];
  readonly attempts: readonly (Alternative & { readonly intentId: string })[];
}
type Validated = ValidContext | { readonly ok: false; readonly reason: LocalCounterfactualUnavailableReason };

/** Revalidates the five authorities against each other. Validation only: nothing is repaired, dropped, invented or reconstructed. */
function validate(a: LocalCounterfactualAuthorities): Validated {
  const fail = (reason: LocalCounterfactualUnavailableReason): Validated => ({ ok: false, reason });
  if (a.constructionBasis.status !== 'READY' || a.baselinePlacements.status !== 'READY' || a.schedulingAttempts.status !== 'READY' || a.contention.status !== 'READY') return fail('RUN_NOT_READY');
  const basis = a.constructionBasis.basis;
  const baseline = a.baselinePlacements.placements.placements;
  const attempts = a.schedulingAttempts.authority.attempts;
  const contention = a.contention.authority;
  const candidateId = a.input.candidateIntentId;
  const ownerIds = a.input.owners.map((owner) => owner.intentId);

  // Integrity of every instant that will be consumed.
  if (!isFiniteDate(basis.window.start) || !isFiniteDate(basis.window.end) || basis.window.start.getTime() >= basis.window.end.getTime()) return fail('INVALID_INTERVAL');
  if (basis.blockedIntervals.some((blocker) => !isFiniteDate(blocker.start) || !isFiniteDate(blocker.end))) return fail('INVALID_INTERVAL');
  if (baseline.some((p) => !isFiniteDate(p.start) || !isFiniteDate(p.end) || p.start.getTime() >= p.end.getTime())) return fail('INVALID_INTERVAL');
  if (attempts.some((attempt) => !isFiniteDate(attempt.start) || !isFiniteDate(attempt.end) || attempt.start.getTime() >= attempt.end.getTime())) return fail('INVALID_INTERVAL');
  if (contention.attempts.some((attempt) => !isFiniteDate(attempt.start) || !isFiniteDate(attempt.end) || attempt.start.getTime() >= attempt.end.getTime())) return fail('INVALID_INTERVAL');

  // Identity: the pair, the candidate, the owners.
  const intentIds = basis.intents.map((intent) => intent.id);
  if (new Set(intentIds).size !== intentIds.length) return fail('INCONSISTENT_AUTHORITY');
  if (contention.candidateIntentId !== candidateId) return fail('INCONSISTENT_AUTHORITY');
  if (intentIds.filter((id) => id === candidateId).length !== 1) return fail('INCONSISTENT_AUTHORITY');
  const candidate = basis.intents.find((intent) => intent.id === candidateId)!;
  if (candidate.flexibility !== 'FLEXIBLE' || candidate.estimatedDurationMinutes === undefined || !Number.isFinite(candidate.estimatedDurationMinutes) || candidate.estimatedDurationMinutes <= 0) return fail('INCONSISTENT_AUTHORITY');
  if (baseline.some((p) => p.intentId === candidateId)) return fail('INCONSISTENT_AUTHORITY');
  if (ownerIds.length === 0 || new Set(ownerIds).size !== ownerIds.length) return fail('INCONSISTENT_AUTHORITY');
  if (ownerIds.some((id) => id === candidateId || !intentIds.includes(id) || !baseline.some((p) => p.intentId === id))) return fail('INCONSISTENT_AUTHORITY');
  // The contention authority can never enlarge the release scope, and every authorized owner keeps its support relationship.
  if (contention.attempts.some((attempt) => !ownerIds.includes(attempt.ownerIntentId))) return fail('INCONSISTENT_AUTHORITY');
  if (ownerIds.some((id) => !contention.attempts.some((attempt) => attempt.ownerIntentId === id))) return fail('INCONSISTENT_AUTHORITY');
  if (contention.attempts.length === 0) return fail('INCONSISTENT_AUTHORITY');
  if (attempts.some((attempt) => !intentIds.includes(attempt.intentId) || attempt.conflictingOwnerIds.some((id) => !intentIds.includes(id)))) return fail('INCONSISTENT_AUTHORITY');

  // The baseline placements must still be consistent with THIS basis.
  const placedIds = baseline.map((p) => p.intentId);
  if (new Set(placedIds).size !== placedIds.length) return fail('INCONSISTENT_AUTHORITY');
  const placed: Placed[] = [];
  for (const p of baseline) {
    const intent = basis.intents.find((candidateIntent) => candidateIntent.id === p.intentId);
    if (!intent) return fail('INCONSISTENT_AUTHORITY');
    const start = p.start.getTime();
    const end = p.end.getTime();
    if (start < basis.window.start.getTime() || end > basis.window.end.getTime()) return fail('INCONSISTENT_AUTHORITY');
    if (basis.blockedIntervals.some((blocker) => blocker.start.getTime() < blocker.end.getTime() && overlapsMs(start, end, blocker.start.getTime(), blocker.end.getTime()))) return fail('INCONSISTENT_AUTHORITY');
    if (p.placementSource === 'FIXED_CONSTRAINT') {
      if (intent.flexibility !== 'FIXED') return fail('INCONSISTENT_AUTHORITY');
    } else {
      if (intent.flexibility !== 'FLEXIBLE' || intent.estimatedDurationMinutes === undefined || end !== start + intent.estimatedDurationMinutes * 60000) return fail('INCONSISTENT_AUTHORITY');
    }
    placed.push({ intentId: p.intentId, start, end, source: p.placementSource, timingFit: p.timingFit });
  }
  for (let i = 0; i < placed.length; i += 1) for (let j = i + 1; j < placed.length; j += 1) if (overlapsMs(placed[i].start, placed[i].end, placed[j].start, placed[j].end)) return fail('INCONSISTENT_AUTHORITY');

  // P's slots: the exact historical contention slots, identified by (start, end, timingFit); the owner relationships are provenance only.
  const requiredMs = candidate.estimatedDurationMinutes * 60000;
  const slots: Slot[] = [];
  for (const attempt of contention.attempts) {
    const start = attempt.start.getTime();
    const end = attempt.end.getTime();
    if (end - start !== requiredMs) return fail('INVALID_INTERVAL');
    if (!slots.some((slot) => slot.start === start && slot.end === end && slot.timingFit === attempt.timingFit)) slots.push({ start, end, timingFit: attempt.timingFit });
  }
  return {
    ok: true,
    basis,
    placed,
    candidate,
    ownerIds,
    slots,
    attempts: attempts.map((attempt) => ({ intentId: attempt.intentId, start: attempt.start.getTime(), end: attempt.end.getTime(), timingFit: attempt.timingFit })),
  };
}

/** The captured alternatives of one displaced owner: initial UNION final UNION its own scheduling attempts, one per (start, timingFit), longest span kept. */
function ownerAlternatives(basis: ConstructionBasis, context: ValidContext, intentId: string): Alternative[] | undefined {
  const found: Alternative[] = [];
  const add = (start: number, end: number, timingFit: PlacementTimingFit | undefined) => {
    const existing = found.findIndex((alternative) => alternative.start === start && alternative.timingFit === timingFit);
    if (existing === -1) found.push({ start, end, timingFit });
    else if (end > found[existing].end) found[existing] = { start, end, timingFit };
  };
  for (const list of [...basis.initialCandidates, ...basis.finalCandidates]) {
    if (list.intentId !== intentId) continue;
    for (const candidate of list.candidates) {
      if (candidate.intentId !== intentId) continue; // a WRONG_INTENT candidate is never usable
      if (!isFiniteDate(candidate.start) || !isFiniteDate(candidate.end)) return undefined;
      add(candidate.start.getTime(), candidate.end.getTime(), candidate.timingFit);
    }
  }
  for (const attempt of context.attempts) if (attempt.intentId === intentId) add(attempt.start, attempt.end, attempt.timingFit);
  return found;
}

/**
 * Generates the local counterfactual for ONE promotion pair over the (revalidated) same-run authorities. Pure, synchronous, deterministic;
 * never throws. Independent per call: several pairs are never jointly optimized and each starts from the same baseline.
 */
export function generateLocalCounterfactual(authorities: LocalCounterfactualAuthorities): LocalCounterfactualOutcome {
  try {
    const context = validate(authorities);
    if (!context.ok) return unavailable(context.reason);
    const { basis, placed, candidate, ownerIds, slots } = context;
    const candidateId = candidate.id;
    const window: Span = { start: basis.window.start, end: basis.window.end };
    const blockers: Span[] = basis.blockedIntervals.map((blocker) => ({ start: blocker.start, end: blocker.end }));
    const requiredMinutes = candidate.estimatedDurationMinutes as number;

    // Rank P's slots with the Constructor's own comparator over the captured fit (never discovery order).
    const ranked = [...slots].sort((a, b) => compareCandidatesForPlacement(toPlacementCandidate(candidateId, a.start, a.end, a.timingFit), toPlacementCandidate(candidateId, b.start, b.end, b.timingFit)) || a.end - b.end);

    let chosen: Slot | undefined;
    let overlapped: readonly Placed[] = [];
    for (const slot of ranked) {
      const verdict = evaluateLocalPlacementGate({ intentId: candidateId, start: new Date(slot.start), end: new Date(slot.end) }, candidateId, requiredMinutes, window, blockers, []);
      if (!verdict.feasible) {
        if (verdict.reason === 'OUTSIDE_CONSTRUCTION_WINDOW' || verdict.reason === 'BLOCKED_BY_COMMITMENT') continue;
        return unavailable('INVALID_INTERVAL');
      }
      const terminal = placed.filter((p) => overlapsMs(slot.start, slot.end, p.start, p.end));
      if (terminal.length === 0) continue; // newly free time: never a promotion slot
      if (terminal.some((p) => !ownerIds.includes(p.intentId) || p.source === 'FIXED_CONSTRAINT')) continue; // a non-owner or a FIXED owner is never moved
      chosen = slot;
      overlapped = terminal;
      break;
    }
    if (!chosen) return unavailable('NO_ACTIONABLE_PROMOTION_SLOT');

    // Displaced owners, in the Constructor's own overload-precedence order (never by pressure).
    const displaced = overlapped.map((p) => basis.intents.find((intent) => intent.id === p.intentId)!);
    displaced.sort((a, b) => compareByOverloadPrecedence(a as unknown as DayIntent, b as unknown as DayIntent, basis.planningDate) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const displacedIds = displaced.map((intent) => intent.id);

    const occupied: Span[] = placed.filter((p) => !displacedIds.includes(p.intentId)).map((p) => ({ start: new Date(p.start), end: new Date(p.end) }));
    occupied.push({ start: new Date(chosen.start), end: new Date(chosen.end) });
    const relocated: CounterfactualPlacement[] = [];
    const unplaced: string[] = [];
    for (const owner of displaced) {
      const alternatives = ownerAlternatives(basis, context, owner.id);
      if (alternatives === undefined) return unavailable('INVALID_INTERVAL');
      const requiredOwnerMinutes = owner.estimatedDurationMinutes as number;
      const usable: Array<{ alternative: Alternative; start: number; end: number }> = [];
      for (const alternative of alternatives) {
        const verdict = evaluateLocalPlacementGate({ intentId: owner.id, start: new Date(alternative.start), end: new Date(alternative.end) }, owner.id, requiredOwnerMinutes, window, blockers, occupied);
        if (verdict.feasible) usable.push({ alternative, start: verdict.start, end: verdict.end });
      }
      usable.sort((a, b) => compareCandidatesForPlacement(toPlacementCandidate(owner.id, a.start, a.end, a.alternative.timingFit), toPlacementCandidate(owner.id, b.start, b.end, b.alternative.timingFit)));
      const best = usable[0];
      if (!best) {
        unplaced.push(owner.id);
        continue;
      }
      relocated.push(placement(owner.id, best.start, best.end, 'RELOCATED_CAPTURED_CANDIDATE', best.alternative.timingFit));
      occupied.push({ start: new Date(best.start), end: new Date(best.end) });
    }

    const promotedPlacement = placement(candidateId, chosen.start, chosen.end, 'PROMOTED_CONTENTION_ATTEMPT', chosen.timingFit);
    const counterfactualPlacements: CounterfactualPlacement[] = [];
    for (const p of placed) {
      if (!displacedIds.includes(p.intentId)) {
        counterfactualPlacements.push(placement(p.intentId, p.start, p.end, 'BASELINE_UNCHANGED', p.timingFit));
        continue;
      }
      const replacement = relocated.find((r) => r.intentId === p.intentId);
      if (replacement) counterfactualPlacements.push(placement(replacement.intentId, replacement.start.getTime(), replacement.end.getTime(), replacement.placementSource, replacement.timingFit));
    }
    counterfactualPlacements.push(placement(promotedPlacement.intentId, promotedPlacement.start.getTime(), promotedPlacement.end.getTime(), promotedPlacement.placementSource, promotedPlacement.timingFit));

    return Object.freeze({
      status: 'READY',
      counterfactual: Object.freeze({
        candidateIntentId: candidateId,
        promotedPlacement,
        displacedOwnerIds: Object.freeze([...displacedIds]),
        relocatedPlacements: Object.freeze(relocated.map((r) => placement(r.intentId, r.start.getTime(), r.end.getTime(), r.placementSource, r.timingFit))),
        unplacedOwnerIds: Object.freeze([...unplaced]),
        counterfactualPlacements: Object.freeze(counterfactualPlacements),
      }),
    });
  } catch {
    return unavailable('GENERATION_FAILED');
  }
}
