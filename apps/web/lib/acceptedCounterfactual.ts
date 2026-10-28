/**
 * Constructor Decision Intelligence -- O5 P4c3: the TYPED SAME-RUN ACCEPTED-COUNTERFACTUAL AUTHORITY (pure, inert).
 *
 * P4b3 answers ACCEPT with a bare frozen `{ status: 'ACCEPT' }` that has no structural link to the counterfactual it judged. A future ACTIVE path
 * must not materialize "a counterfactual plus an accepted flag" that a caller could pair arbitrarily. This module closes that trust boundary: an
 * `AcceptedCounterfactual` is ONE trusted object that exists only when the P4b3 predicate itself returned ACCEPT for exactly that counterfactual,
 * against exactly these same-run authorities.
 *
 * HOW IT CANNOT BE FORGED.
 *   1. There is no parameter through which a caller can say "accepted": `mintAcceptedCounterfactual` takes the four P4b3 inputs (plus the run's baseline result,
 *      O5 P4c4a, which is bound, never trusted as a decision) and CALLS P4b3 itself; the brand is applied only when that call returns ACCEPT. (A caller cannot hand it an ACCEPT.)
 *   2. The type carries a unique-symbol brand that this module does not export, so no object literal or structural copy has the type.
 *   3. At runtime every brand is registered in a module-private WeakSet; `isAcceptedCounterfactual` (the only check consumers use) is false for any
 *      object this module did not mint, however it was cast.
 *   4. The mint is imported by exactly one production module -- the same-run shadow composition (P4b4), which generates and evaluates a pair in the same
 *      pass over the run's own authorities -- pinned by the architecture guard. No general "brand this counterfactual" helper exists.
 *
 * WHAT IT HOLDS. A DETACHED, deeply frozen snapshot: the candidate id, scalar placements (epoch milliseconds -- no mutable Date is ever exposed) and the
 * displaced / relocated owner ids; plus the EXACT construction-basis and baseline-placements OUTCOME OBJECTS it was minted against, so a consumer can
 * prove (by identity) that the basis it is handed belongs to the same run. A mint failure after an ACCEPT never throws: it returns the acceptance without an
 * authority, and every consumer treats a missing authority as "not accepted".
 *
 * Observations are linked to their authority through a module-private WeakMap (`recordAcceptedObservation` / `acceptedCounterfactualOf`), so the P4b4
 * observation shape is unchanged. Pure: no database, clock, search, randomness, logging or environment; nothing here is consumed by production behavior.
 *
 * BASELINE BINDING (O5 P4c4a). The basis and the baseline placements are bound by identity, but a materializer is also handed the baseline CONSTRUCTED-DAY RESULT of the
 * run, and nothing tied that result to the run: a coherent baseline from ANOTHER run (a different blocker / window world) could be combined with this authority and
 * still materialize. The mint therefore also receives the exact baseline result object the SAME composition holds (`prepared.result`), and binds it PRIVATELY: a
 * module-private WeakMap keyed by the authority holds the object itself and a canonical fingerprint of it taken at mint time. `isBaselineOfAcceptedCounterfactual` is the
 * only way to ask the question and it is true ONLY for that very object, unmodified since the mint. There is deliberately no run id, nonce or token a caller could copy
 * between artifacts; and NO structural equality fallback -- a structurally identical clone, or a modified copy, is a different object and is never the run's baseline.
 * (The fingerprint additionally detects an in-place modification of the genuine object after the mint.) Nothing is recomputed: the check is two comparisons.
 */

import { evaluateCounterfactualAcceptance, type CounterfactualAcceptance, type CounterfactualAcceptanceInput } from './counterfactualAcceptance';
import type { ConstructionBasisOutcome } from './constructionBasis';
import type { BaselinePlacementsOutcome } from './baselinePlacements';
import type { PlacementTimingFit } from './dayConstructor';
import type { OrchestrateConstructDayResult } from './dayConstructorOrchestrator';

declare const ACCEPTED_BRAND: unique symbol;

export type AcceptedPlacementSource = 'BASELINE_UNCHANGED' | 'PROMOTED_CONTENTION_ATTEMPT' | 'RELOCATED_CAPTURED_CANDIDATE';

/** One placement of the accepted counterfactual, as scalars (epoch milliseconds): no mutable Date crosses this boundary. */
export interface AcceptedPlacement {
  readonly intentId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly placementSource: AcceptedPlacementSource;
  readonly timingFit?: PlacementTimingFit;
}

export interface AcceptedCounterfactual {
  readonly [ACCEPTED_BRAND]: true;
  readonly candidateIntentId: string;
  /** The exact same-run authorities the pair was judged against (by identity). */
  readonly constructionBasis: ConstructionBasisOutcome;
  readonly baselinePlacements: BaselinePlacementsOutcome;
  readonly promoted: AcceptedPlacement;
  readonly displacedOwnerIds: readonly string[];
  readonly relocated: readonly AcceptedPlacement[];
  /** The COMPLETE counterfactual Proposed set (baseline order, promoted last). */
  readonly placements: readonly AcceptedPlacement[];
}

export interface MintedAcceptance {
  readonly acceptance: CounterfactualAcceptance;
  /** Present only when P4b3 returned ACCEPT for exactly this counterfactual and the detached snapshot was built. */
  readonly accepted?: AcceptedCounterfactual;
}

const minted = new WeakSet<object>();
const linkedAuthority = new WeakMap<object, AcceptedCounterfactual>();
/** O5 P4c4a -- the PRIVATE same-run baseline binding: the exact baseline result object of the minting run, and its canonical fingerprint at mint time. Never exported. */
const baselineBindings = new WeakMap<object, { readonly baseline: object; readonly fingerprint: string }>();

function placementOf(p: { readonly intentId: string; readonly start: Date; readonly end: Date; readonly placementSource: AcceptedPlacementSource; readonly timingFit?: PlacementTimingFit }): AcceptedPlacement {
  const base = { intentId: p.intentId, startMs: p.start.getTime(), endMs: p.end.getTime(), placementSource: p.placementSource };
  if (!Number.isFinite(base.startMs) || !Number.isFinite(base.endMs)) throw new Error('non-finite instant');
  return Object.freeze(p.timingFit === undefined ? base : { ...base, timingFit: p.timingFit });
}

/**
 * Evaluates P4b3 over the four same-run authorities and, ONLY if it returns ACCEPT, mints the typed authority for exactly that counterfactual, privately bound to
 * `baselineResult`: the baseline constructed-day result of THE SAME run (the composition passes its own `prepared.result`). The acceptance decision is returned
 * unchanged for the caller (the shadow composition) to carry. A baseline that is not an object, or that cannot be fingerprinted, mints nothing (fail closed).
 */
export function mintAcceptedCounterfactual(input: CounterfactualAcceptanceInput, baselineResult: OrchestrateConstructDayResult): MintedAcceptance {
  const acceptance = evaluateCounterfactualAcceptance(input);
  if (acceptance.status !== 'ACCEPT') return Object.freeze({ acceptance });
  try {
    if (typeof baselineResult !== 'object' || baselineResult === null) return Object.freeze({ acceptance });
    const fingerprint = JSON.stringify(baselineResult);
    if (typeof fingerprint !== 'string') return Object.freeze({ acceptance });
    const cf = input.counterfactual;
    const accepted = Object.freeze({
      candidateIntentId: cf.candidateIntentId,
      constructionBasis: input.constructionBasis,
      baselinePlacements: input.baselinePlacements,
      promoted: placementOf(cf.promotedPlacement),
      displacedOwnerIds: Object.freeze([...cf.displacedOwnerIds]),
      relocated: Object.freeze(cf.relocatedPlacements.map(placementOf)),
      placements: Object.freeze(cf.counterfactualPlacements.map(placementOf)),
    }) as unknown as AcceptedCounterfactual;
    minted.add(accepted);
    baselineBindings.set(accepted, Object.freeze({ baseline: baselineResult, fingerprint }));
    return Object.freeze({ acceptance, accepted });
  } catch {
    return Object.freeze({ acceptance });
  }
}

/** The ONLY trust check: true exactly for objects this module minted. */
export function isAcceptedCounterfactual(value: unknown): value is AcceptedCounterfactual {
  return typeof value === 'object' && value !== null && minted.has(value);
}

/**
 * O5 P4c4a -- true ONLY if `baselineResult` is the very baseline object the minting run bound to `accepted`, unmodified since the mint. Identity, never structure: a clone
 * or a modified copy is rejected; an authority this module did not mint has no binding and is rejected; it never throws.
 */
export function isBaselineOfAcceptedCounterfactual(accepted: unknown, baselineResult: unknown): boolean {
  try {
    if (!isAcceptedCounterfactual(accepted) || typeof baselineResult !== 'object' || baselineResult === null) return false;
    const binding = baselineBindings.get(accepted);
    return binding !== undefined && binding.baseline === baselineResult && JSON.stringify(baselineResult) === binding.fingerprint;
  } catch {
    return false;
  }
}

/** Links one ACCEPT observation to its authority. Both must be what they claim: a valid minted authority and an ACCEPT observation for the same candidate. */
export function recordAcceptedObservation(observation: { readonly outcome: string; readonly candidateIntentId: string }, accepted: AcceptedCounterfactual): void {
  if (!isAcceptedCounterfactual(accepted) || observation.outcome !== 'ACCEPT' || observation.candidateIntentId !== accepted.candidateIntentId) return;
  linkedAuthority.set(observation, accepted);
}

/** The authority linked to an observation, or undefined (an ACCEPT observation without one is treated as not accepted by every consumer). */
export function acceptedCounterfactualOf(observation: object): AcceptedCounterfactual | undefined {
  return linkedAuthority.get(observation);
}
