/**
 * Constructor Decision Intelligence -- O5 P4b4: SAME-RUN SHADOW POLICY COMPOSITION (inert, diagnostic only).
 *
 * It answers ONE question: "what would the local promotion policy have decided on THIS exact run?" It composes the three reviewed stages and adds
 * nothing to them:
 *
 *   ONE orchestration (`preparePromotionInputs`)  ->  per PromotionInput:  P4b2 `generateLocalCounterfactual`  ->  P4b3 `evaluateCounterfactualAcceptance`
 *
 * SAME-RUN BY CONSTRUCTION, NOT BY COMMENT. The only exported seam is `observeShadowPolicy(request, deps)`: it takes the REQUEST and the orchestration
 * DEPENDENCIES and nothing else, calls `preparePromotionInputs` exactly once, and derives every authority P4b2 and P4b3 need (basis, baseline placements,
 * scheduling attempts, promotion input, contention) from that ONE run's result. There is no exported function that accepts a basis, placements, a
 * promotion input or a counterfactual from a caller, so no production caller can pair a counterfactual with authorities from another run. The composer
 * itself is module-private. No second orchestration, no second timing search, no evidence / facts / duration / availability load, no second pressure
 * derivation: the PromotionInput (and its owner pressure payload) is the one the run produced.
 *
 * ONE OBSERVATION PER PROMOTION. Every eligible PromotionInput yields exactly one observation, in the run's stable source order. Each is evaluated
 * INDEPENDENTLY against the SAME immutable baseline (no observation ever consumes another's counterfactual); nothing stops at an ACCEPT, ranks ACCEPTs
 * or chooses a winner -- that is a later slice. A pair is processed from its own typed `{input, contention}` object (never by parallel-array index), and a
 * throw in one pair's generation or acceptance becomes THAT observation's unavailable outcome with the existing source reason; the others are intact.
 *
 * LAYERS STAY DISTINGUISHABLE and carry the EXACT source reason (no translation, no competing vocabulary):
 *   GENERATION_UNAVAILABLE   P4b2 produced no counterfactual (reason: its LocalCounterfactualUnavailableReason); P4b3 is NOT called
 *   ACCEPTANCE_UNAVAILABLE   P4b2 READY, P4b3 could not evaluate (reason: its CounterfactualAcceptanceUnavailableReason)
 *   REJECT                   P4b2 READY, P4b3 REJECT (reason: its CounterfactualRejectionReason)
 *   ACCEPT                   P4b2 READY, P4b3 ACCEPT
 * The run level is explicit too: READY { observations } (possibly empty -- not an error; possibly no ACCEPT) | UNAVAILABLE { reason } when the baseline
 * run is not READY or the preparation failed: no per-promotion observation is manufactured from incomplete authority.
 *
 * MINIMAL DIAGNOSTIC SUMMARY. A READY-generation observation carries only a detached, deeply frozen summary of the change: the promoted slot, the
 * displaced owner ids, each relocated owner's baseline -> counterfactual slot, the unplaced owner ids and the two placement counts. Instants are ISO
 * strings (no Date aliasing). It never carries the construction basis, the scheduling attempts, the contention authority, the raw trace, candidate
 * history, evidence or facts, nor a second copy of the schedule.
 *
 * NO POLICY HERE. This module decides nothing: it never reads pressure, timing fit ranking, importance or a deadline to classify an outcome; ACCEPT /
 * REJECT is exactly what P4b3 returned. It also reconstructs no generator mechanics.
 *
 * SHADOW MEANING. It runs only when a caller (today: tests only) asks for it; nothing in production calls it, nothing wires it into Plan Day, a route,
 * the preview body, signing, acceptance or persistence, and ACCEPT has no user-visible or scheduling effect. The returned Constructor result is the
 * orchestration's result, untouched. Pure over the run: no database, query, write, transaction, clock, randomness, logging, flag or environment.
 */

import { preparePromotionInputs, type PromotionPair, type PromotionRunAuthority } from './promotionInputPreparation';
import type { ConstructDayRequest, DayConstructorOrchestratorDeps, OrchestrateConstructDayResult } from './dayConstructorOrchestrator';
import { generateLocalCounterfactual, type LocalCounterfactual, type LocalCounterfactualUnavailableReason } from './localCounterfactual';
import type { CounterfactualAcceptanceUnavailableReason, CounterfactualRejectionReason } from './counterfactualAcceptance';
import { mintAcceptedCounterfactual, recordAcceptedObservation } from './acceptedCounterfactual';
import type { PlacementTimingFit } from './dayConstructor';

/** A placement slot as scalars: ISO instants and the carried timing fit (absent for a FIXED placement). */
export interface ShadowSlot {
  readonly start: string;
  readonly end: string;
  readonly timingFit?: PlacementTimingFit;
}

export interface ShadowRelocatedOwner {
  readonly intentId: string;
  /** The owner's baseline slot; null only if the run-level baseline does not carry it (never for a READY counterfactual that P4b3 validates). */
  readonly from: ShadowSlot | null;
  readonly to: ShadowSlot;
}

/** The minimal change the counterfactual would have made, detached from every authority. */
export interface ShadowCounterfactualSummary {
  readonly promoted: ShadowSlot;
  readonly displacedOwnerIds: readonly string[];
  readonly relocatedOwners: readonly ShadowRelocatedOwner[];
  readonly unplacedOwnerIds: readonly string[];
  readonly baselinePlacementCount: number;
  readonly counterfactualPlacementCount: number;
}

export type ShadowPolicyObservation =
  | { readonly outcome: 'GENERATION_UNAVAILABLE'; readonly candidateIntentId: string; readonly reason: LocalCounterfactualUnavailableReason }
  | { readonly outcome: 'ACCEPTANCE_UNAVAILABLE'; readonly candidateIntentId: string; readonly reason: CounterfactualAcceptanceUnavailableReason; readonly counterfactual: ShadowCounterfactualSummary | null }
  | { readonly outcome: 'REJECT'; readonly candidateIntentId: string; readonly reason: CounterfactualRejectionReason; readonly counterfactual: ShadowCounterfactualSummary }
  | { readonly outcome: 'ACCEPT'; readonly candidateIntentId: string; readonly counterfactual: ShadowCounterfactualSummary };

export type ShadowPolicyRun =
  | { readonly status: 'READY'; readonly observations: readonly ShadowPolicyObservation[] }
  | { readonly status: 'UNAVAILABLE'; readonly reason: 'RUN_NOT_READY' | 'PREPARATION_FAILED' | 'OBSERVATION_FAILED' };

type PreparedRun = Extract<PromotionRunAuthority, { status: 'PREPARED' }>;

/**
 * The ONLY seam: one orchestration, then the shadow composition over THAT run. (An optional OUTPUT-ONLY callback receives the baseline result the moment it exists.) The Constructor result is returned exactly as the orchestration produced
 * it; the shadow outcome can never alter, delay or abort it.
 */
export async function observeShadowPolicy(request: ConstructDayRequest, deps: DayConstructorOrchestratorDeps, onBaselineResult?: (result: OrchestrateConstructDayResult) => void): Promise<{ result: OrchestrateConstructDayResult; shadowPolicy: ShadowPolicyRun }> {
  const prepared = await preparePromotionInputs(request, deps);
  // OUTPUT-ONLY hand-off (O5 P4b5): the instant the ONE baseline orchestration has produced its result -- strictly BEFORE any shadow work -- a caller that needs to
  // survive a later shadow failure can hold it, so it never has to run the baseline again. It carries the baseline RESULT only: no authority goes in or out.
  try {
    onBaselineResult?.(prepared.result);
  } catch {
    // The hand-off failed: the shadow side continues; the caller simply does not hold the result.
  }
  if (prepared.run.status !== 'PREPARED') return { result: prepared.result, shadowPolicy: Object.freeze({ status: 'UNAVAILABLE', reason: prepared.run.reason }) };
  try {
    return { result: prepared.result, shadowPolicy: compose(prepared.run, prepared.result) };
  } catch {
    return { result: prepared.result, shadowPolicy: Object.freeze({ status: 'UNAVAILABLE', reason: 'OBSERVATION_FAILED' }) };
  }
}

function compose(run: PreparedRun, baseline: OrchestrateConstructDayResult): ShadowPolicyRun {
  return Object.freeze({ status: 'READY', observations: Object.freeze(run.promotions.map((pair) => observePair(run, pair, baseline))) });
}

/** One promotion, from its own typed pair and the run-level authorities: generation, then (only if READY) acceptance. Never throws. */
function observePair(run: PreparedRun, pair: PromotionPair, baseline: OrchestrateConstructDayResult): ShadowPolicyObservation {
  const candidateIntentId = pair.input.candidateIntentId;
  let stage: 'GENERATION' | 'ACCEPTANCE' = 'GENERATION';
  try {
    const generated = generateLocalCounterfactual({ constructionBasis: run.constructionBasis, baselinePlacements: run.baselinePlacements, schedulingAttempts: run.schedulingAttempts, input: pair.input, contention: pair.contention });
    if (generated.status !== 'READY') return Object.freeze({ outcome: 'GENERATION_UNAVAILABLE', candidateIntentId, reason: generated.reason });
    stage = 'ACCEPTANCE';
    // O5 P4c3: the predicate is evaluated INSIDE the typed-authority mint, over exactly this counterfactual and these same-run authorities; the brand exists only for an ACCEPT.
    // O5 P4c4a: the mint also receives THIS run's baseline result (`prepared.result`) and binds it privately to the authority (same-run provenance of the baseline).
    const { acceptance, accepted } = mintAcceptedCounterfactual({ constructionBasis: run.constructionBasis, baselinePlacements: run.baselinePlacements, promotionInput: pair.input, counterfactual: generated.counterfactual }, baseline);
    const counterfactual = summarize(run, generated.counterfactual);
    if (acceptance.status === 'ACCEPT') {
      const observation = Object.freeze({ outcome: 'ACCEPT', candidateIntentId, counterfactual } as const);
      if (accepted) recordAcceptedObservation(observation, accepted);
      return observation;
    }
    if (acceptance.status === 'REJECT') return Object.freeze({ outcome: 'REJECT', candidateIntentId, reason: acceptance.reason, counterfactual });
    return Object.freeze({ outcome: 'ACCEPTANCE_UNAVAILABLE', candidateIntentId, reason: acceptance.reason, counterfactual });
  } catch {
    // Failure isolation: only THIS observation is affected, with the existing source reason of the stage that failed.
    return stage === 'GENERATION'
      ? Object.freeze({ outcome: 'GENERATION_UNAVAILABLE', candidateIntentId, reason: 'GENERATION_FAILED' })
      : Object.freeze({ outcome: 'ACCEPTANCE_UNAVAILABLE', candidateIntentId, reason: 'EVALUATION_FAILED', counterfactual: null });
  }
}

function slotOf(placement: { readonly start: Date; readonly end: Date; readonly timingFit?: PlacementTimingFit }): ShadowSlot {
  const slot = { start: placement.start.toISOString(), end: placement.end.toISOString() };
  return Object.freeze(placement.timingFit === undefined ? slot : { ...slot, timingFit: placement.timingFit });
}

function summarize(run: PreparedRun, cf: LocalCounterfactual): ShadowCounterfactualSummary {
  const baseline = run.baselinePlacements.status === 'READY' ? run.baselinePlacements.placements.placements : [];
  const relocatedOwners = cf.relocatedPlacements.map((placement) => {
    const from = baseline.find((row) => row.intentId === placement.intentId);
    return Object.freeze({ intentId: placement.intentId, from: from ? slotOf(from) : null, to: slotOf(placement) });
  });
  return Object.freeze({
    promoted: slotOf(cf.promotedPlacement),
    displacedOwnerIds: Object.freeze([...cf.displacedOwnerIds]),
    relocatedOwners: Object.freeze(relocatedOwners),
    unplacedOwnerIds: Object.freeze([...cf.unplacedOwnerIds]),
    baselinePlacementCount: baseline.length,
    counterfactualPlacementCount: cf.counterfactualPlacements.length,
  });
}
