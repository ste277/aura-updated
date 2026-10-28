/**
 * Constructor Decision Intelligence -- O5 SHADOW ROLLOUT R3: the PURE REVIEW-PAYLOAD BUILDER (inert, display-only).
 *
 * Preview-only, internal-experiment support. Turns the SAME run's baseline result, READY materialized result and typed
 * accepted authority (the exact objects `deriveShadowEvidence` already produced and is about to discard) into the
 * MINIMAL information an authorized internal tester needs to answer "would I prefer this to the baseline day?" -- and
 * nothing else.
 *
 * NO NEW SCHEDULING INTERPRETATION. Every changed placement comes straight from the authority's OWN pre-computed
 * `promoted` / `relocated` / `displacedOwnerIds` (acceptedCounterfactual.ts) -- this module does not diff, rank, infer
 * or recompute which items changed; it only looks up the ALREADY-AUTHORITATIVE answer and formats it for display.
 *
 * NO PRIVATE OR INTERNAL DATA. The only fields read from either result are `intentId`, `title`, `start`, `end`,
 * `timingFit` and `primaryReason` (just to detect "was Deferred") on ProposedItem/DeferredItem -- the same fields the
 * existing preview response already exposes to this authenticated user for their own day. No ConstructionBasis,
 * BaselinePlacements, SchedulingAttempts, contention trace, DecisionFacts, fingerprint or database id outside those
 * already-displayed fields ever reaches the returned payload.
 *
 * FAIL CLOSED, NEVER THROWS. Any inconsistency (a missing title, an unmatched relocated owner, a non-READY result)
 * yields `undefined` -- no partial or guessed review is ever produced; the caller simply shows no review panel.
 *
 * Pure: no database, clock, randomness, logging or environment.
 */

import type { OrchestrateConstructDayResult } from './dayConstructorOrchestrator';
import type { AcceptedCounterfactual, AcceptedPlacement } from './acceptedCounterfactual';
import type { PlacementTimingFit, ProposedItem } from './dayConstructor';

export type ShadowReviewReason = 'WOULD_OTHERWISE_BE_DEFERRED';

export interface ShadowReviewSlot {
  readonly status: 'DEFERRED' | 'SCHEDULED';
  readonly start?: string;
  readonly end?: string;
  readonly timingFit?: PlacementTimingFit;
}

export interface ShadowReviewItem {
  readonly intentId: string;
  readonly title: string;
  readonly kind: 'PROMOTED' | 'MOVED';
  readonly baseline: ShadowReviewSlot;
  readonly alternative: ShadowReviewSlot;
}

export interface ShadowReviewPayload {
  readonly reason: ShadowReviewReason;
  readonly changedItems: readonly ShadowReviewItem[];
}

type ReadyResult = Extract<OrchestrateConstructDayResult, { status: 'READY' }>;

function alternativeSlot(p: AcceptedPlacement): ShadowReviewSlot {
  return { status: 'SCHEDULED', start: new Date(p.startMs).toISOString(), end: new Date(p.endMs).toISOString(), timingFit: p.timingFit };
}

function baselineSlotOfOwner(item: ProposedItem): ShadowReviewSlot {
  return { status: 'SCHEDULED', start: item.start.toISOString(), end: item.end.toISOString(), timingFit: item.timingFit };
}

export function buildShadowReviewPayload(baselineResult: OrchestrateConstructDayResult, materializedResult: OrchestrateConstructDayResult, accepted: AcceptedCounterfactual): ShadowReviewPayload | undefined {
  try {
    if (baselineResult.status !== 'READY' || materializedResult.status !== 'READY') return undefined;
    const baseline = baselineResult as ReadyResult;
    const titleById = new Map((materializedResult as ReadyResult).preview.constructedDay.proposedItems.map((item) => [item.intentId, item.title] as const));
    const changedItems: ShadowReviewItem[] = [];

    const candidateTitle = titleById.get(accepted.candidateIntentId);
    const deferred = baseline.preview.constructedDay.deferredItems.find((item) => item.intentId === accepted.candidateIntentId);
    if (candidateTitle === undefined || !deferred) return undefined;
    changedItems.push({ intentId: accepted.candidateIntentId, title: candidateTitle, kind: 'PROMOTED', baseline: { status: 'DEFERRED' }, alternative: alternativeSlot(accepted.promoted) });

    const relocatedById = new Map(accepted.relocated.map((p) => [p.intentId, p] as const));
    const baselineProposedById = new Map(baseline.preview.constructedDay.proposedItems.map((item) => [item.intentId, item] as const));
    for (const ownerId of accepted.displacedOwnerIds) {
      const relocatedPlacement = relocatedById.get(ownerId);
      const ownerTitle = titleById.get(ownerId);
      const baselineOwnerItem = baselineProposedById.get(ownerId);
      if (!relocatedPlacement || ownerTitle === undefined || !baselineOwnerItem) return undefined; // same-run data must be fully consistent, or show nothing
      changedItems.push({ intentId: ownerId, title: ownerTitle, kind: 'MOVED', baseline: baselineSlotOfOwner(baselineOwnerItem), alternative: alternativeSlot(relocatedPlacement) });
    }

    return Object.freeze({ reason: 'WOULD_OTHERWISE_BE_DEFERRED', changedItems: Object.freeze(changedItems) });
  } catch {
    return undefined;
  }
}
