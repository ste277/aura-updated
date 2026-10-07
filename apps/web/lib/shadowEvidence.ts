/**
 * Constructor Decision Intelligence -- O5 SHADOW EVIDENCE: the PURE per-run evidence derivation (inert, diagnostic only).
 *
 * The P4b5 SHADOW boundary already reports how the PROMOTION POLICY fared (generation / P4b3 outcomes). The future ACTIVE go / no-go also needs to know what the
 * ACTIVE pieces WOULD have done on the very same run. This module answers exactly that, from the ONE run's own artifacts, by REUSING the real, merged pieces -- it
 * reimplements none of them:
 *
 *   selector      the real P4c1 `selectActiveCounterfactual` over the run's observations
 *   gate          the real P4c2a `evaluateMaterializability` over the baseline day, for the selector's APPLY candidate only
 *   materializer  the real P4c3 `materializeActiveResult`, for a MATERIALIZABLE gate only, with the run's own baseline result and the authority's own basis
 *   invariants    `checkMaterializationInvariants` over baseline vs materialized, for a READY materialization only
 *
 * SAME-RUN BY CONSTRUCTION. The only inputs are the baseline result and the `ShadowPolicyRun` that ONE `observeShadowPolicy` call returned: the authority comes from the
 * run's own observation, the basis from that authority, the baseline is the object the authority is bound to (P4c4a). Nothing here reconstructs an authority, a basis, a
 * baseline or a counterfactual independently, and a baseline from another run is reported as BASELINE_PROVENANCE_MISMATCH -- distinctly, never folded into a generic failure.
 *
 * THE MATERIALIZED RESULT NEVER LEAVES THIS FUNCTION. It is a local value, checked and dropped: only bounded categories are returned. SHADOW serves the baseline.
 *
 * NO PRIVATE DATA, NO HIGH CARDINALITY. The output is a closed set of string categories (and counts bucketed to four values): no identifier, title, instant, placement,
 * duration or text can appear in it. It makes no claim about usefulness to the user.
 *
 * Every stage is isolated: an unexpected failure yields a bounded technical-failure category and stops the funnel there; it never throws and never turns into a pass.
 * Pure: no database, clock, randomness, search, Constructor, P4b2 / P4b3 call, logging or environment. At most one selector pass, one gate, one materialization.
 */

import { selectActiveCounterfactual } from './activeSelector';
import { evaluateMaterializability, type MaterializabilityUnavailableReason } from './activeMaterializability';
import { materializeActiveResult, type MaterializerUnavailableReason } from './activeResultMaterializer';
import { checkMaterializationInvariants, type MaterializationInvariantFailure } from './materializationInvariants';
import type { OrchestrateConstructDayResult } from './dayConstructorOrchestrator';
import type { ShadowPolicyRun } from './shadowPolicyObservation';
import type { AcceptedCounterfactual } from './acceptedCounterfactual';

/** A count reported as one of four values: a bounded dimension however large the count is. */
export type ShadowCountBucket = 'ZERO' | 'ONE' | 'TWO' | 'THREE_PLUS';

export function bucketOfCount(count: number): ShadowCountBucket {
  if (!Number.isFinite(count) || count <= 0) return 'ZERO';
  if (count === 1) return 'ONE';
  if (count === 2) return 'TWO';
  return 'THREE_PLUS';
}

export type ShadowSelectorOutcome = 'NOT_EVALUATED' | 'APPLY' | 'NO_ACCEPT' | 'MULTIPLE_ACCEPTS' | 'INCOMPLETE_OBSERVATION';
export type ShadowGateOutcome = 'NOT_EVALUATED' | 'MATERIALIZABLE' | MaterializabilityUnavailableReason;
export type ShadowMaterializerOutcome = 'NOT_EVALUATED' | 'READY' | MaterializerUnavailableReason;
export type ShadowInvariantOutcome = 'NOT_EVALUATED' | 'PASS' | MaterializationInvariantFailure;
export type ShadowEvidenceFailure = 'NONE' | 'SELECTOR_FAILED' | 'GATE_FAILED' | 'MATERIALIZER_FAILED' | 'INVARIANT_CHECK_FAILED' | 'EVIDENCE_FAILED';

export interface ShadowEvidence {
  readonly selector: ShadowSelectorOutcome;
  readonly gate: ShadowGateOutcome;
  readonly materializer: ShadowMaterializerOutcome;
  readonly invariant: ShadowInvariantOutcome;
  readonly failure: ShadowEvidenceFailure;
}

export const NOT_EVALUATED_EVIDENCE: ShadowEvidence = Object.freeze({ selector: 'NOT_EVALUATED', gate: 'NOT_EVALUATED', materializer: 'NOT_EVALUATED', invariant: 'NOT_EVALUATED', failure: 'NONE' });

/** Test injection only: the materializer (to exercise the invariant FAIL path without forging an authority). Production passes nothing. */
export interface ShadowEvidenceDeps {
  readonly materialize?: typeof materializeActiveResult;
  /**
   * O5 SHADOW ROLLOUT R3 (production-used, Preview-only; see shadowPolicyExecution.ts's `reviewEligible`): an OUTPUT-ONLY hand-off,
   * invoked at most once, the instant a READY materialization has ALSO passed every invariant (never on NOT_EVALUATED, a reject
   * reason, a gate/materializer failure or an invariant FAIL) -- the SAME baseline, the SAME materialized result and the SAME
   * accepted authority this one run produced, never reconstructed. It carries no bounded category back and never changes what
   * `deriveShadowEvidence` returns: a failure here is isolated and cannot affect the evidence outcome. Omitted everywhere outside
   * the Preview-eligible SHADOW boundary.
   */
  readonly onReviewReady?: (handoff: { readonly baselineResult: OrchestrateConstructDayResult; readonly materializedResult: OrchestrateConstructDayResult; readonly accepted: AcceptedCounterfactual }) => void;
}

function frozen(evidence: ShadowEvidence): ShadowEvidence {
  return Object.freeze(evidence);
}

export function deriveShadowEvidence(baselineResult: OrchestrateConstructDayResult, run: ShadowPolicyRun, deps: ShadowEvidenceDeps = {}): ShadowEvidence {
  if (run.status !== 'READY') return NOT_EVALUATED_EVIDENCE;
  let selection: ReturnType<typeof selectActiveCounterfactual>;
  try {
    selection = selectActiveCounterfactual(run);
  } catch {
    return frozen({ ...NOT_EVALUATED_EVIDENCE, failure: 'SELECTOR_FAILED' });
  }
  if (selection.status !== 'APPLY') return frozen({ ...NOT_EVALUATED_EVIDENCE, selector: selection.reason });
  const applied = { ...NOT_EVALUATED_EVIDENCE, selector: 'APPLY' as const };

  let gate: ReturnType<typeof evaluateMaterializability>;
  try {
    if (baselineResult.status !== 'READY') return frozen({ ...applied, failure: 'GATE_FAILED' });
    gate = evaluateMaterializability(baselineResult.preview.constructedDay, selection.candidateIntentId);
  } catch {
    return frozen({ ...applied, failure: 'GATE_FAILED' });
  }
  if (gate.status !== 'MATERIALIZABLE') return frozen({ ...applied, gate: gate.reason });
  const gated = { ...applied, gate: 'MATERIALIZABLE' as const };

  let materialized: ReturnType<typeof materializeActiveResult>;
  try {
    materialized = (deps.materialize ?? materializeActiveResult)({ baselineResult, constructionBasis: selection.acceptedCounterfactual.constructionBasis, accepted: selection.acceptedCounterfactual });
  } catch {
    return frozen({ ...gated, failure: 'MATERIALIZER_FAILED' });
  }
  if (materialized.status !== 'READY') return frozen({ ...gated, materializer: materialized.reason });
  const built = { ...gated, materializer: 'READY' as const };

  try {
    const invariant = checkMaterializationInvariants(baselineResult, materialized.result, selection.acceptedCounterfactual);
    if (invariant === 'PASS') notifyReviewReady(deps, baselineResult, materialized.result, selection.acceptedCounterfactual);
    return frozen({ ...built, invariant });
  } catch {
    return frozen({ ...built, failure: 'INVARIANT_CHECK_FAILED' });
  }
}

/** O5 SHADOW ROLLOUT R3: the hand-off call site, isolated -- a throwing (or absent) `onReviewReady` can never affect the evidence this function returns. */
function notifyReviewReady(deps: ShadowEvidenceDeps, baselineResult: OrchestrateConstructDayResult, materializedResult: OrchestrateConstructDayResult, accepted: AcceptedCounterfactual): void {
  try {
    deps.onReviewReady?.({ baselineResult, materializedResult, accepted });
  } catch {
    // Isolated: a hand-off failure can never turn a PASS into anything else, and never escapes.
  }
}
