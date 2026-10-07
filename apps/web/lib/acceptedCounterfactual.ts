/**
 * Constructor Decision Intelligence -- O5 P4c3: the TYPED SAME-RUN ACCEPTED-COUNTERFACTUAL AUTHORITY (pure, inert).
 *
 * P4b3 answers ACCEPT with a bare frozen `{ status: 'ACCEPT' }` that has no structural link to the counterfactual it judged. A future ACTIVE path
 * must not materialize "a counterfactual plus an accepted flag" that a caller could pair arbitrarily. This module closes that trust boundary: an
 * `AcceptedCounterfactual` is ONE trusted object that exists only when the P4b3 predicate itself returned ACCEPT for exactly that counterfactual,
 * against exactly these same-run authorities.
 *
 * HOW IT CANNOT BE FORGED.
 *   1. There is no parameter through which a caller can say "accepted": `mintAcceptedCounterfactual` takes the four P4b3 inputs and CALLS P4b3 itself;
 *      the brand is applied only when that call returns ACCEPT. (A caller cannot hand it an ACCEPT.)
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
 */

import { evaluateCounterfactualAcceptance, type CounterfactualAcceptance, type CounterfactualAcceptanceInput } from './counterfactualAcceptance';
import type { ConstructionBasisOutcome } from './constructionBasis';
import type { BaselinePlacementsOutcome } from './baselinePlacements';
import type { PlacementTimingFit } from './dayConstructor';

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

function placementOf(p: { readonly intentId: string; readonly start: Date; readonly end: Date; readonly placementSource: AcceptedPlacementSource; readonly timingFit?: PlacementTimingFit }): AcceptedPlacement {
  const base = { intentId: p.intentId, startMs: p.start.getTime(), endMs: p.end.getTime(), placementSource: p.placementSource };
  if (!Number.isFinite(base.startMs) || !Number.isFinite(base.endMs)) throw new Error('non-finite instant');
  return Object.freeze(p.timingFit === undefined ? base : { ...base, timingFit: p.timingFit });
}

/**
 * Evaluates P4b3 over the four same-run authorities and, ONLY if it returns ACCEPT, mints the typed authority for exactly that counterfactual. The
 * acceptance decision is returned unchanged for the caller (the shadow composition) to carry.
 */
export function mintAcceptedCounterfactual(input: CounterfactualAcceptanceInput): MintedAcceptance {
  const acceptance = evaluateCounterfactualAcceptance(input);
  if (acceptance.status !== 'ACCEPT') return Object.freeze({ acceptance });
  try {
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
    return Object.freeze({ acceptance, accepted });
  } catch {
    return Object.freeze({ acceptance });
  }
}

/** The ONLY trust check: true exactly for objects this module minted. */
export function isAcceptedCounterfactual(value: unknown): value is AcceptedCounterfactual {
  return typeof value === 'object' && value !== null && minted.has(value);
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
