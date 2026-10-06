/**
 * Constructor Decision Intelligence -- O5 P4c3 (P4c1 V1): the PURE ACTIVE SELECTOR (inert).
 *
 * Over the COMPLETE set of one run's shadow observations it returns either NO_CHANGE or exactly ONE accepted counterfactual to apply. It is the
 * narrowest defensible V1: it applies a promotion only when there is nothing to choose between.
 *
 *   APPLY     iff the observation set is COMPLETE (no technical observation failure that could hide another ACCEPT) and contains EXACTLY ONE P4b3-ACCEPTed
 *             counterfactual, each of which carries its typed same-run authority.
 *   NO_CHANGE otherwise: NO_ACCEPT (nothing accepted), MULTIPLE_ACCEPTS (no ranking, no winner: the safe alternatives may be mutually exclusive and no legitimate
 *             authority orders them), INCOMPLETE_OBSERVATION (a technical failure -- GENERATION_FAILED, EVALUATION_FAILED -- or a run-level composition failure, or an
 *             ACCEPT whose typed authority is missing, could hide a second ACCEPT; failing closed is the only safe answer).
 *
 * VALUE AUTHORITY, stated rather than hidden: the selector computes no score and reads no client fact (importance, deadline, originalOrder) or provenance. An
 * observation exists only for a candidate whose server-derived pressure is LAST_KNOWN_OPPORTUNITY on actual contention (P4a), and ACCEPT is the P4b3 no-regret
 * dominance over the baseline (one more activity placed, every owner no worse, FIXED and non-owners untouched). The single reason it can give is therefore
 * LAST_KNOWN_OPPORTUNITY_RESCUED. Ordinary outcomes -- generation unavailable, acceptance unavailable, REJECT -- never become APPLY, and are not technical failures.
 *
 * Observation ORDER is not authority: the decision depends only on the multiset of outcomes. Pure and deterministic; no database, clock, search, Constructor,
 * randomness or mutation; at most one APPLY by construction (a single value is returned). It does NOT materialize, sort Proposed, derive candidateOrder,
 * recompute capacity or repair Deferred diagnostics -- that is the materializer's job, behind its own gate.
 */

import { acceptedCounterfactualOf, type AcceptedCounterfactual } from './acceptedCounterfactual';
import type { ShadowPolicyObservation, ShadowPolicyRun } from './shadowPolicyObservation';

export type ActiveSelectionNoChangeReason = 'NO_ACCEPT' | 'MULTIPLE_ACCEPTS' | 'INCOMPLETE_OBSERVATION';

export type ActiveSelection =
  | { readonly status: 'NO_CHANGE'; readonly reason: ActiveSelectionNoChangeReason }
  | {
      readonly status: 'APPLY';
      readonly candidateIntentId: string;
      readonly acceptedCounterfactual: AcceptedCounterfactual;
      readonly selectionReason: 'LAST_KNOWN_OPPORTUNITY_RESCUED';
    };

/** A technical failure of the observation itself (not an ordinary unavailable or reject outcome): it could hide an ACCEPT. */
function isTechnicalFailure(observation: ShadowPolicyObservation): boolean {
  return (observation.outcome === 'GENERATION_UNAVAILABLE' && observation.reason === 'GENERATION_FAILED') || (observation.outcome === 'ACCEPTANCE_UNAVAILABLE' && observation.reason === 'EVALUATION_FAILED');
}

const NO_ACCEPT = Object.freeze({ status: 'NO_CHANGE', reason: 'NO_ACCEPT' } as const);
const MULTIPLE_ACCEPTS = Object.freeze({ status: 'NO_CHANGE', reason: 'MULTIPLE_ACCEPTS' } as const);
const INCOMPLETE_OBSERVATION = Object.freeze({ status: 'NO_CHANGE', reason: 'INCOMPLETE_OBSERVATION' } as const);

export function selectActiveCounterfactual(run: ShadowPolicyRun): ActiveSelection {
  try {
    if (run.status !== 'READY') return INCOMPLETE_OBSERVATION;
    const accepts: ShadowPolicyObservation[] = [];
    for (const observation of run.observations) {
      if (isTechnicalFailure(observation)) return INCOMPLETE_OBSERVATION;
      if (observation.outcome === 'ACCEPT') accepts.push(observation);
    }
    if (accepts.some((observation) => acceptedCounterfactualOf(observation) === undefined)) return INCOMPLETE_OBSERVATION;
    if (accepts.length === 0) return NO_ACCEPT;
    if (accepts.length > 1) return MULTIPLE_ACCEPTS;
    const accepted = acceptedCounterfactualOf(accepts[0])!;
    if (accepted.candidateIntentId !== accepts[0].candidateIntentId) return INCOMPLETE_OBSERVATION;
    return Object.freeze({ status: 'APPLY', candidateIntentId: accepted.candidateIntentId, acceptedCounterfactual: accepted, selectionReason: 'LAST_KNOWN_OPPORTUNITY_RESCUED' });
  } catch {
    return INCOMPLETE_OBSERVATION;
  }
}
