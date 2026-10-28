/**
 * Constructor Decision Intelligence -- O5 P4b3: the PURE COUNTERFACTUAL ACCEPTANCE PREDICATE (inert, deterministic, V1 conservative policy).
 *
 * P4b2 answers "what mechanically happens?". This module answers ONE different question about ONE immutable baseline / counterfactual pair:
 * "is Aura ALLOWED to prefer that mechanical counterfactual over the baseline under the V1 safety policy?" It does not generate, re-rank, search,
 * call the Constructor or the generator, choose another slot or relocation, apply anything, persist, sign or return anything to Plan Day.
 * `ACCEPT` means only "the supplied counterfactual satisfies the V1 policy". Nothing calls this module in production; tests only.
 *
 * INPUT (the minimum authority needed): the ConstructionBasis (neutral intent semantics, window, blockers), the BaselinePlacements (terminal baseline
 * authority), the PromotionInput (the candidate and the authorized owners -- the scope; its owner pressure values are NEVER read) and the P4b2
 * LocalCounterfactual being judged. PromotionContentionAuthority and SchedulingAttempts are deliberately NOT inputs: this module judges the P4b2
 * OUTPUT, never the historical search evidence, and cannot regenerate or re-rank anything.
 *
 * OUTCOMES. `ACCEPT` | `REJECT { reason }` | `UNAVAILABLE { reason }`, kept semantically distinct:
 *   UNAVAILABLE  the evidence cannot be trusted or evaluated: an authority is not READY, the authorities contradict each other, the counterfactual
 *                contradicts ITSELF or the baseline (a silent change its own fields do not declare, a missing / duplicated P, an extra intent, an
 *                overlap, an out-of-window / blocked / wrong-duration placement, a "promotion" that displaces nobody), an instant is non-finite, or a baseline timing fit that policy needs is
 *                unknown. No policy is applied to an untrustworthy structure.
 *   REJECT       the authorities are coherent and the counterfactual TRUTHFULLY describes a change, but policy forbids it.
 * Every structural check runs BEFORE any policy check, so the accept / reject / unavailable determination never depends on the reason ordering.
 *
 * SAME-RUN INTEGRITY. The types carry no run identity and none is added. Cross-consistency is the evidence: the counterfactual must agree with the basis,
 * the baseline and the PromotionInput on every id, interval, duration and declared change. This is sufficient for the policy question (a counterfactual
 * consistent with the supplied baseline is judged on its content); it does NOT prove provenance -- the future composition (P4b4) is what guarantees the
 * four inputs come from one orchestration.
 *
 * THE V1 TRUTH TABLE (reasons in this deterministic precedence; only the REPORTED reason depends on it):
 *   1 FIXED_PLACEMENT_CHANGED     a displaced owner is a baseline FIXED placement. FIXED is immovable and must never ACCEPT.
 *   2 NON_OWNER_CHANGED           a displaced intent is not an owner authorized by the PromotionInput (the scope can never be enlarged).
 *   3 UNNECESSARY_OWNER_CHANGE    a displaced owner's baseline interval does not overlap P's promoted interval: an owner the promotion did not
 *                                 need to touch was changed (minimum change). An authorized owner that is not displaced stays byte-identical.
 *   4 PRECEDENCE_NOT_TIE          for EVERY displaced owner, P must tie with it on every dimension that outranks pressure -- deadline today,
 *                                 importance, deadline -- via the established P3b / P4a primitive `compareAbovePressure` (the Constructor's own
 *                                 comparator with originalOrder neutralised). originalOrder, timing fit and pressure never decide the tie.
 *                                 A tie is required in BOTH directions: P4a authorizes only ties, so a stronger or weaker owner is out of contract.
 *   5 OWNER_WOULD_BE_UNPLACED     ANY displaced owner is left unplaced. V1 is conservative and explicit: there is NO affirmative "safe to defer"
 *                                 authority today -- `DecisionPressure.NONE` means "no ESTABLISHED pressure", NOT "positively established
 *                                 unpressured / safe to defer" -- so losing an owner is never accepted, whatever its pressure value.
 *   6 OWNER_TIMING_DEGRADED       a relocated owner's timing fit must be NO WORSE than its OWN baseline fit, by the Constructor's timing-fit ranking
 *                                 (compared through the exported `compareCandidatesForPlacement`; an undefined fit ranks worst there, so a relocation
 *                                 to an unknown fit is a degradation). P's own fit is never required to be better than anyone's.
 *   7 NET_PROPOSED_LOSS           the counterfactual must hold at least baseline count + 1 placements. A backstop: after the checks above (and the
 *                                 structural validation) it can only hold, so it never replaces a per-owner check.
 * PRESSURE. Pressure is cost-of-deferral evidence, not value: it is never a precedence dimension and is never read here. Audit of P2b (decisionPressure.ts):
 * LAST_KNOWN_OPPORTUNITY is DAY-LEVEL ("the current day is known feasible, an occurrence remains and no later day is known viable or unknown"); it does
 * not encode a slot. A relocation of a pressured owner within the same planning date therefore keeps the pressured opportunity -- it is not owner loss --
 * and pressure alone never rejects; there is deliberately NO OWNER_PRESSURED reason. A later authority distinguishing UNKNOWN / SAFE_TO_DEFER / PRESSURED
 * could relax rule 5; V1 does not invent it.
 * ACCEPT requires every rule above to hold on a structurally trustworthy counterfactual. There is no scoring, no "better schedule" requirement, no
 * utility, no goal value and no comparison of several promotions: one counterfactual, one decision.
 *
 * PURE: synchronous, deterministic, no I/O, snapshot, clock, search, Constructor / orchestrator / generator call, trace, facts, evidence, pressure read,
 * logging, environment or async. Inputs are never mutated; the decision is a frozen record of strings. Never throws.
 */

import { compareCandidatesForPlacement, type PlacementCandidate, type PlacementTimingFit } from './dayConstructor';
import { compareAbovePressure, projectAbovePressureFacts } from './abovePressurePrecedence';
import type { PromotionInput } from './promotionInput';
import type { ConstructionBasis, ConstructionBasisOutcome } from './constructionBasis';
import type { BaselinePlacementsOutcome } from './baselinePlacements';
import type { LocalCounterfactual } from './localCounterfactual';

export interface CounterfactualAcceptanceInput {
  readonly constructionBasis: ConstructionBasisOutcome;
  readonly baselinePlacements: BaselinePlacementsOutcome;
  readonly promotionInput: PromotionInput;
  readonly counterfactual: LocalCounterfactual;
}

export type CounterfactualRejectionReason =
  | 'FIXED_PLACEMENT_CHANGED'
  | 'NON_OWNER_CHANGED'
  | 'UNNECESSARY_OWNER_CHANGE'
  | 'PRECEDENCE_NOT_TIE'
  | 'OWNER_WOULD_BE_UNPLACED'
  | 'OWNER_TIMING_DEGRADED'
  | 'NET_PROPOSED_LOSS';

export type CounterfactualAcceptanceUnavailableReason = 'RUN_NOT_READY' | 'INCONSISTENT_AUTHORITY' | 'INVALID_INTERVAL' | 'COUNTERFACTUAL_INVALID' | 'BASELINE_TIMING_UNKNOWN' | 'EVALUATION_FAILED';

export type CounterfactualAcceptance =
  | { readonly status: 'ACCEPT' }
  | { readonly status: 'REJECT'; readonly reason: CounterfactualRejectionReason }
  | { readonly status: 'UNAVAILABLE'; readonly reason: CounterfactualAcceptanceUnavailableReason };

function unavailable(reason: CounterfactualAcceptanceUnavailableReason): CounterfactualAcceptance {
  return Object.freeze({ status: 'UNAVAILABLE', reason });
}

function reject(reason: CounterfactualRejectionReason): CounterfactualAcceptance {
  return Object.freeze({ status: 'REJECT', reason });
}

/** Half-open [start, end): touching intervals do not overlap. */
function overlapsMs(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

interface Row {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly fit: PlacementTimingFit | undefined;
}

interface BaselineRow extends Row {
  readonly fixed: boolean;
}

function finiteInterval(start: Date, end: Date): boolean {
  return start instanceof Date && end instanceof Date && Number.isFinite(start.getTime()) && Number.isFinite(end.getTime());
}

/** Is `relocated` strictly WORSE than `baseline` by the Constructor's own timing-fit ranking? Same start and order, so only the fit decides. */
function isWorseFit(baseline: PlacementTimingFit | undefined, relocated: PlacementTimingFit | undefined): boolean {
  const shell = (timingFit: PlacementTimingFit | undefined): PlacementCandidate => ({ intentId: 'x', start: new Date(0), end: new Date(1), timingFit, candidateOrder: 0 });
  return compareCandidatesForPlacement(shell(baseline), shell(relocated)) < 0;
}

/**
 * Judges ONE immutable baseline / counterfactual pair under the V1 policy. Pure, synchronous, deterministic; never throws; never mutates, regenerates or
 * re-ranks anything.
 */
export function evaluateCounterfactualAcceptance(input: CounterfactualAcceptanceInput): CounterfactualAcceptance {
  try {
    if (input.constructionBasis.status !== 'READY' || input.baselinePlacements.status !== 'READY') return unavailable('RUN_NOT_READY');
    const basis: ConstructionBasis = input.constructionBasis.basis;
    const baselinePlacements = input.baselinePlacements.placements.placements;
    const cf = input.counterfactual;
    const candidateId = input.promotionInput.candidateIntentId;
    const ownerIds = input.promotionInput.owners.map((owner) => owner.intentId);

    // ---- STRUCTURE: instants -------------------------------------------------------------------------------------------------------------------
    if (!isFiniteDate(basis.window.start) || !isFiniteDate(basis.window.end) || basis.window.start.getTime() >= basis.window.end.getTime()) return unavailable('INVALID_INTERVAL');
    if (basis.blockedIntervals.some((blocker) => !finiteInterval(blocker.start, blocker.end))) return unavailable('INVALID_INTERVAL');
    if (baselinePlacements.some((p) => !finiteInterval(p.start, p.end))) return unavailable('INVALID_INTERVAL');
    if (cf.counterfactualPlacements.some((p) => !finiteInterval(p.start, p.end)) || !finiteInterval(cf.promotedPlacement.start, cf.promotedPlacement.end) || cf.relocatedPlacements.some((p) => !finiteInterval(p.start, p.end))) return unavailable('INVALID_INTERVAL');
    const windowStart = basis.window.start.getTime();
    const windowEnd = basis.window.end.getTime();
    const blockers = basis.blockedIntervals.map((blocker) => ({ start: blocker.start.getTime(), end: blocker.end.getTime() })).filter((blocker) => blocker.start < blocker.end);

    // ---- STRUCTURE: the basis, the baseline, the promotion scope ---------------------------------------------------------------------------------
    const intentIds = basis.intents.map((intent) => intent.id);
    if (new Set(intentIds).size !== intentIds.length) return unavailable('INCONSISTENT_AUTHORITY');
    const intentOf = (id: string) => basis.intents.find((intent) => intent.id === id);
    const baseline: BaselineRow[] = [];
    for (const p of baselinePlacements) {
      const intent = intentOf(p.intentId);
      if (!intent) return unavailable('INCONSISTENT_AUTHORITY');
      const start = p.start.getTime();
      const end = p.end.getTime();
      if (start >= end || start < windowStart || end > windowEnd) return unavailable('INCONSISTENT_AUTHORITY');
      if (blockers.some((blocker) => overlapsMs(start, end, blocker.start, blocker.end))) return unavailable('INCONSISTENT_AUTHORITY');
      if (intent.estimatedDurationMinutes === undefined || end - start !== intent.estimatedDurationMinutes * 60000) return unavailable('INCONSISTENT_AUTHORITY');
      if ((p.placementSource === 'FIXED_CONSTRAINT') !== (intent.flexibility === 'FIXED')) return unavailable('INCONSISTENT_AUTHORITY');
      baseline.push({ id: p.intentId, start, end, fit: p.placementSource === 'FIXED_CONSTRAINT' ? undefined : p.timingFit, fixed: p.placementSource === 'FIXED_CONSTRAINT' });
    }
    if (new Set(baseline.map((row) => row.id)).size !== baseline.length) return unavailable('INCONSISTENT_AUTHORITY');
    for (let i = 0; i < baseline.length; i += 1) for (let j = i + 1; j < baseline.length; j += 1) if (overlapsMs(baseline[i].start, baseline[i].end, baseline[j].start, baseline[j].end)) return unavailable('INCONSISTENT_AUTHORITY');

    const candidate = intentOf(candidateId);
    if (!candidate || candidate.flexibility !== 'FLEXIBLE' || candidate.estimatedDurationMinutes === undefined || !(candidate.estimatedDurationMinutes > 0)) return unavailable('INCONSISTENT_AUTHORITY');
    if (cf.candidateIntentId !== candidateId) return unavailable('INCONSISTENT_AUTHORITY');
    if (baseline.some((row) => row.id === candidateId)) return unavailable('INCONSISTENT_AUTHORITY');
    if (ownerIds.length === 0 || new Set(ownerIds).size !== ownerIds.length) return unavailable('INCONSISTENT_AUTHORITY');
    if (ownerIds.some((id) => id === candidateId || !intentIds.includes(id) || !baseline.some((row) => row.id === id))) return unavailable('INCONSISTENT_AUTHORITY');

    // ---- STRUCTURE: the counterfactual must be internally coherent and agree with the baseline -----------------------------------------------------
    const rows = cf.counterfactualPlacements;
    const rowIds = rows.map((p) => p.intentId);
    if (new Set(rowIds).size !== rowIds.length) return unavailable('COUNTERFACTUAL_INVALID');
    if (rowIds.some((id) => id !== candidateId && !baseline.some((row) => row.id === id))) return unavailable('COUNTERFACTUAL_INVALID'); // an extra intent (or an unknown one)
    const promotedRows = rows.filter((p) => p.intentId === candidateId);
    if (promotedRows.length !== 1 || promotedRows[0].placementSource !== 'PROMOTED_CONTENTION_ATTEMPT') return unavailable('COUNTERFACTUAL_INVALID');
    if (rows.filter((p) => p.placementSource === 'PROMOTED_CONTENTION_ATTEMPT').length !== 1) return unavailable('COUNTERFACTUAL_INVALID');
    const promoted = promotedRows[0];
    if (cf.promotedPlacement.intentId !== candidateId || cf.promotedPlacement.start.getTime() !== promoted.start.getTime() || cf.promotedPlacement.end.getTime() !== promoted.end.getTime() || cf.promotedPlacement.timingFit !== promoted.timingFit) return unavailable('COUNTERFACTUAL_INVALID');
    for (const p of rows) {
      const intent = intentOf(p.intentId)!;
      const start = p.start.getTime();
      const end = p.end.getTime();
      if (start >= end || start < windowStart || end > windowEnd) return unavailable('COUNTERFACTUAL_INVALID');
      if (blockers.some((blocker) => overlapsMs(start, end, blocker.start, blocker.end))) return unavailable('COUNTERFACTUAL_INVALID');
      if (intent.estimatedDurationMinutes === undefined || end - start !== intent.estimatedDurationMinutes * 60000) return unavailable('COUNTERFACTUAL_INVALID');
    }
    for (let i = 0; i < rows.length; i += 1) for (let j = i + 1; j < rows.length; j += 1) if (overlapsMs(rows[i].start.getTime(), rows[i].end.getTime(), rows[j].start.getTime(), rows[j].end.getTime())) return unavailable('COUNTERFACTUAL_INVALID');
    const displaced = cf.displacedOwnerIds;
    // A promotion counterfactual must displace someone: a P that fits in free time without touching a baseline placement could have been placed by the baseline, so the pair is not a promotion counterfactual at all (and may not share a run).
    if (displaced.length === 0) return unavailable('COUNTERFACTUAL_INVALID');
    const relocatedIds = cf.relocatedPlacements.map((p) => p.intentId);
    const unplacedIds = cf.unplacedOwnerIds;
    if (new Set(displaced).size !== displaced.length || new Set(relocatedIds).size !== relocatedIds.length || new Set(unplacedIds).size !== unplacedIds.length) return unavailable('COUNTERFACTUAL_INVALID');
    if (displaced.some((id) => !baseline.some((row) => row.id === id))) return unavailable('COUNTERFACTUAL_INVALID');
    if (relocatedIds.some((id) => !displaced.includes(id) || unplacedIds.includes(id)) || unplacedIds.some((id) => !displaced.includes(id))) return unavailable('COUNTERFACTUAL_INVALID');
    if (displaced.some((id) => !relocatedIds.includes(id) && !unplacedIds.includes(id))) return unavailable('COUNTERFACTUAL_INVALID');
    for (const r of cf.relocatedPlacements) {
      const row = rows.find((p) => p.intentId === r.intentId);
      if (!row || row.placementSource !== 'RELOCATED_CAPTURED_CANDIDATE' || row.start.getTime() !== r.start.getTime() || row.end.getTime() !== r.end.getTime() || row.timingFit !== r.timingFit) return unavailable('COUNTERFACTUAL_INVALID');
    }
    if (rows.some((p) => p.placementSource === 'RELOCATED_CAPTURED_CANDIDATE' && !relocatedIds.includes(p.intentId))) return unavailable('COUNTERFACTUAL_INVALID');
    if (unplacedIds.some((id) => rowIds.includes(id))) return unavailable('COUNTERFACTUAL_INVALID');
    for (const base of baseline) {
      if (displaced.includes(base.id)) continue;
      const row = rows.find((p) => p.intentId === base.id);
      // A baseline placement that is not declared displaced must survive byte-identically: a silent change or drop is a contradiction, not a policy question.
      if (!row || row.placementSource !== 'BASELINE_UNCHANGED' || row.start.getTime() !== base.start || row.end.getTime() !== base.end || row.timingFit !== base.fit) return unavailable('COUNTERFACTUAL_INVALID');
    }
    if (rows.some((p) => p.placementSource === 'BASELINE_UNCHANGED' && (displaced.includes(p.intentId) || !baseline.some((row) => row.id === p.intentId)))) return unavailable('COUNTERFACTUAL_INVALID');
    // The timing floor needs the owner's OWN baseline fit: unknown is never treated as safe.
    if (relocatedIds.some((id) => { const base = baseline.find((row) => row.id === id)!; return !base.fixed && base.fit === undefined; })) return unavailable('BASELINE_TIMING_UNKNOWN');

    // ---- POLICY (V1), in the deterministic reason precedence -------------------------------------------------------------------------------------
    const displacedRows = displaced.map((id) => baseline.find((row) => row.id === id)!);
    if (displacedRows.some((row) => row.fixed)) return reject('FIXED_PLACEMENT_CHANGED');
    if (displacedRows.some((row) => !ownerIds.includes(row.id))) return reject('NON_OWNER_CHANGED');
    if (displacedRows.some((row) => !overlapsMs(row.start, row.end, promoted.start.getTime(), promoted.end.getTime()))) return reject('UNNECESSARY_OWNER_CHANGE');
    const candidateFacts = projectAbovePressureFacts(candidate);
    if (displacedRows.some((row) => compareAbovePressure(candidateFacts, projectAbovePressureFacts(intentOf(row.id)!), basis.planningDate) !== 'TIE')) return reject('PRECEDENCE_NOT_TIE');
    if (unplacedIds.length > 0) return reject('OWNER_WOULD_BE_UNPLACED');
    if (cf.relocatedPlacements.some((r) => isWorseFit(baseline.find((row) => row.id === r.intentId)!.fit, r.timingFit))) return reject('OWNER_TIMING_DEGRADED');
    if (rows.length < baseline.length + 1) return reject('NET_PROPOSED_LOSS');
    return Object.freeze({ status: 'ACCEPT' });
  } catch {
    return unavailable('EVALUATION_FAILED');
  }
}

function isFiniteDate(date: Date): boolean {
  return date instanceof Date && Number.isFinite(date.getTime());
}
