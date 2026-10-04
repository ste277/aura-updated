/**
 * Constructor Decision Intelligence -- O5 P4b1b: the IMMUTABLE BASELINE PLACEMENTS (pure, inert, detached).
 *
 * THE SEMANTIC BOUNDARY, pinned:
 *
 *   ConstructionBasis   = the baseline scheduling INPUT authority   -- what the Constructor was GIVEN   (constructionBasis.ts)
 *   BaselinePlacements  = the baseline scheduling OUTCOME authority -- what that same run actually CHOSE (this module)
 *
 * They are separate contracts and neither owns policy. A future bounded counterfactual (P4b2) must know exactly where every
 * baseline Proposed placement sits -- to pin the non-owners, and to tell which authorized owners a promotion actually displaces --
 * and that is historical fact: it cannot be inferred from candidate lists, precedence or `originalOrder`, and it must not be
 * recovered by running the Constructor again. It is therefore CAPTURED, directly from the final `result.day` of the SAME
 * orchestration run, at the same T4 step that assembles the ConstructionBasis (the orchestrator calls this module; no caller can
 * hand it an arbitrary result to bless).
 *
 * CONTENT: one entry for every and only final Proposed item, in the result's own order (not re-sorted): intentId, start, end,
 * placementSource, and -- for a SELECTED_CANDIDATE -- the timingFit and candidateOrder the real result carries. Nothing the
 * ConstructionBasis already owns is repeated (title, activity, importance, deadline, flexibility, originalOrder), and no Deferred
 * intent appears. An empty day is a valid READY outcome with `placements: []`.
 *
 * SAME-RUN PAIRING WITHOUT IDENTIFIERS. READY is returned only after the placements are VALIDATED against the very ConstructionBasis
 * of the same run (validation, never reconstruction -- nothing is chosen or repaired):
 *   - the basis itself must be READY
 *   - every placement id exists exactly once in the basis intents; no placement id repeats
 *   - every placement lies inside the basis window and avoids every basis blocker (half-open: [start, end) overlaps
 *     `start < otherEnd && end > otherStart`, so touching intervals do not overlap), and placements are pairwise disjoint
 *   - FIXED_CONSTRAINT: the intent is FIXED and its single basis fixed constraint has EXACTLY the placement's start and end
 *   - SELECTED_CANDIDATE: the intent is FLEXIBLE with a resolved duration, the interval is [candidate.start, start + duration), and a
 *     candidate of that intent in the TERMINAL (final) candidate list matches start, timingFit and candidateOrder exactly and is long
 *     enough. FINAL, not initial: the baseline decision came from terminal orchestration state -- a replenished intent is placed
 *     from a list that may not exist in its initial list at all.
 * READY therefore implies the paired basis is READY; there is no run id, timestamp or hash to forge. A future P4b2 must still
 * revalidate the pair at its own boundary.
 *
 * OWNERSHIP AND IMMUTABILITY. Every Date is a newly allocated `new Date(source.getTime())`; every array and object is new; everything is
 * `Object.freeze`d -- BUT freezing does NOT stop a Date setter changing a Date's time value. Date safety rests on this module owning every
 * Date it holds plus the #208 architecture guard that the audited scheduling path contains no Date mutator.
 *
 * INERT AND OPTIONAL. All-or-nothing (`READY` or `UNAVAILABLE` with an infrastructural reason), never throws, never a partial result; the
 * orchestrator guards the call again so the baseline never depends on it. No pressure, promotion input, owner, facts, evidence, shadow
 * result, flag, Goal or manual / automatic field; no database, clock, timing search, Constructor call, JSON / structuredClone, logging.
 */

import type { ConstructedDay, PlacementTimingFit } from './dayConstructor';
import type { ConstructionBasis, ConstructionBasisOutcome } from './constructionBasis';

export interface BaselinePlacement {
  readonly intentId: string;
  readonly start: Date;
  readonly end: Date;
  readonly placementSource: 'FIXED_CONSTRAINT' | 'SELECTED_CANDIDATE';
  /** Only a SELECTED_CANDIDATE carries these, exactly as the real Proposed item does. */
  readonly timingFit?: PlacementTimingFit;
  readonly candidateOrder?: number;
}

export interface BaselinePlacements {
  readonly placements: readonly BaselinePlacement[];
}

export type BaselinePlacementsUnavailableReason = 'RUN_NOT_READY' | 'BASIS_UNAVAILABLE' | 'CAPTURE_FAILED' | 'DUPLICATE_INTENT_ID' | 'INVALID_PLACEMENT';
export type BaselinePlacementsOutcome =
  | { readonly status: 'READY'; readonly placements: BaselinePlacements }
  | { readonly status: 'UNAVAILABLE'; readonly reason: BaselinePlacementsUnavailableReason };

/** A newly allocated, frozen Date with the same timestamp (an invalid Date stays invalid). Throws for a non-Date: the caller treats that as CAPTURE_FAILED. */
function ownDate(source: Date): Date {
  return Object.freeze(new Date(source.getTime()));
}

function unavailable(reason: BaselinePlacementsUnavailableReason): BaselinePlacementsOutcome {
  return Object.freeze({ status: 'UNAVAILABLE', reason });
}

/** Half-open [start, end) overlap: touching intervals do not overlap. */
function overlaps(a: { readonly start: Date; readonly end: Date }, b: { readonly start: Date; readonly end: Date }): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

function validate(placements: readonly BaselinePlacement[], basis: ConstructionBasis): BaselinePlacementsUnavailableReason | undefined {
  const ids = placements.map((placement) => placement.intentId);
  if (new Set(ids).size !== ids.length) return 'DUPLICATE_INTENT_ID';
  for (const placement of placements) {
    const intent = basis.intents.find((candidate) => candidate.id === placement.intentId);
    if (!intent) return 'INVALID_PLACEMENT';
    const startMs = placement.start.getTime();
    const endMs = placement.end.getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) return 'INVALID_PLACEMENT';
    if (startMs < basis.window.start.getTime() || endMs > basis.window.end.getTime()) return 'INVALID_PLACEMENT';
    if (basis.blockedIntervals.some((blocker) => overlaps(placement, blocker))) return 'INVALID_PLACEMENT';
    if (placement.placementSource === 'FIXED_CONSTRAINT') {
      if (intent.flexibility !== 'FIXED' || placement.timingFit !== undefined || placement.candidateOrder !== undefined) return 'INVALID_PLACEMENT';
      const entry = basis.fixedConstraints.find((candidate) => candidate.intentId === placement.intentId);
      if (!entry || entry.constraints.length !== 1) return 'INVALID_PLACEMENT';
      const constraint = entry.constraints[0];
      if (constraint.start.getTime() !== startMs || constraint.end.getTime() !== endMs) return 'INVALID_PLACEMENT';
    } else {
      if (intent.flexibility !== 'FLEXIBLE' || intent.estimatedDurationMinutes === undefined || typeof placement.candidateOrder !== 'number') return 'INVALID_PLACEMENT';
      if (endMs !== startMs + intent.estimatedDurationMinutes * 60000) return 'INVALID_PLACEMENT';
      const list = basis.finalCandidates.find((candidate) => candidate.intentId === placement.intentId);
      if (!list) return 'INVALID_PLACEMENT';
      const matched = list.candidates.some((candidate) => candidate.intentId === placement.intentId && candidate.start.getTime() === startMs && candidate.end.getTime() >= endMs && candidate.timingFit === placement.timingFit && candidate.candidateOrder === placement.candidateOrder);
      if (!matched) return 'INVALID_PLACEMENT';
    }
  }
  for (let i = 0; i < placements.length; i += 1) for (let j = i + 1; j < placements.length; j += 1) if (overlaps(placements[i], placements[j])) return 'INVALID_PLACEMENT';
  return undefined;
}

/**
 * Captures the final Proposed items of the SAME run's `day` (copied, in the result's own order) and validates them against that run's
 * ConstructionBasis. Never throws.
 */
export function captureBaselinePlacements(day: Pick<ConstructedDay, 'proposedItems'>, basisOutcome: ConstructionBasisOutcome): BaselinePlacementsOutcome {
  try {
    if (basisOutcome.status !== 'READY') return unavailable('BASIS_UNAVAILABLE');
    const placements = Object.freeze(
      day.proposedItems.map((item) =>
        Object.freeze({
          intentId: item.intentId,
          start: ownDate(item.start),
          end: ownDate(item.end),
          placementSource: item.placementSource,
          ...(item.timingFit === undefined ? {} : { timingFit: item.timingFit }),
          ...(item.candidateOrder === undefined ? {} : { candidateOrder: item.candidateOrder }),
        })
      )
    );
    const problem = validate(placements, basisOutcome.basis);
    if (problem !== undefined) return unavailable(problem);
    return Object.freeze({ status: 'READY', placements: Object.freeze({ placements }) });
  } catch {
    return unavailable('CAPTURE_FAILED');
  }
}
