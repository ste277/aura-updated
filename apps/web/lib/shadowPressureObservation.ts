/**
 * Constructor Decision Intelligence -- O5 P3b: the shadow observation BOUNDARY (inert diagnostics).
 *
 * Runs the real Day Constructor orchestration exactly as `orchestrateConstructDay` does (same queries, same searches, same
 * result, same signed tokens) and -- strictly AFTER the Constructor has produced its final result -- derives each
 * candidate's DecisionPressure from the immutable evidence the P2a stage prepared, projects the normalised
 * stronger-than-pressure facts of each intent, and hands the lot, with the P3a ContentionTrace, to the pure shadow
 * evaluator. Nothing computed here can flow back into construction: the Constructor decides first, from inputs that never
 * included evidence, pressure, a trace or any shadow value.
 *
 * WHY THIS IS NOT WIRED INTO THE NORMAL PREVIEW. Plan Day preview calls `orchestrateConstructDay`, unchanged. There is no
 * durable telemetry sink yet, so computing a shadow observation inside every preview would add work whose result is
 * discarded. This entry point is the boundary a later observation slice (or a test) calls; until one exists, real shadow
 * incidence is UNKNOWN and nothing in production calls it. It is not part of any route, preview body, signed contract,
 * acceptance, persistence or user-facing surface, and no client can supply pressure or a classification.
 *
 * FAIL OPEN. Shadow evaluation is observation only: if it cannot be produced (the run was not READY, or the pure stages
 * throw for any reason) the Constructor result is returned exactly as normal with `shadow` marked UNAVAILABLE. Shadow code
 * never aborts, alters or delays the preview result.
 *
 * Pressure authority is unchanged: this module consumes pressure only through `deriveDecisionPressure` over the immutable
 * evidence (DecisionFacts -> DecisionEvidence -> deriveDecisionPressure -> DecisionPressure); it reads no raw recurrence
 * or opportunity field and no DecisionFacts. It names no source, no value signal and no timing quality.
 */

import { orchestrateConstructDayWithDiagnostics, type ConstructDayRequest, type DayConstructorOrchestratorDeps, type OrchestrateConstructDayResult } from './dayConstructorOrchestrator';
import { deriveDecisionPressure, type DecisionPressure } from './decisionPressure';
import { evaluateShadowPressure, type ShadowPressureEvaluation } from './shadowPressureEvaluation';
import { projectAbovePressureFacts, type AbovePressureFacts } from './abovePressurePrecedence';

export type ShadowPressureOutcome =
  | { readonly status: 'EVALUATED'; readonly evaluation: ShadowPressureEvaluation }
  | { readonly status: 'UNAVAILABLE'; readonly reason: 'RUN_NOT_READY' | 'EVALUATION_FAILED' };

export async function observeShadowPressure(request: ConstructDayRequest, deps: DayConstructorOrchestratorDeps): Promise<{ result: OrchestrateConstructDayResult; shadow: ShadowPressureOutcome }> {
  const diagnostics = await orchestrateConstructDayWithDiagnostics(request, deps);
  const result = diagnostics.result;
  if (result.status !== 'READY') return { result, shadow: Object.freeze({ status: 'UNAVAILABLE', reason: 'RUN_NOT_READY' }) };
  try {
    const pressureByIntentId = new Map<string, DecisionPressure>();
    const precedenceFactsByIntentId = new Map<string, AbovePressureFacts>();
    for (const resolved of result.preview.resolvedIntents) {
      const id = resolved.requestedIntentId;
      pressureByIntentId.set(id, deriveDecisionPressure({ evidence: diagnostics.evidenceByIntentId.get(id), planningDate: diagnostics.planningDate, flexibility: resolved.dayIntent.flexibility }));
      precedenceFactsByIntentId.set(id, projectAbovePressureFacts(resolved.dayIntent));
    }
    const evaluation = evaluateShadowPressure({ finalDay: result.preview.constructedDay, contentionTrace: diagnostics.contentionTrace, pressureByIntentId, precedenceFactsByIntentId, planningDate: diagnostics.planningDate });
    return { result, shadow: Object.freeze({ status: 'EVALUATED', evaluation }) };
  } catch {
    return { result, shadow: Object.freeze({ status: 'UNAVAILABLE', reason: 'EVALUATION_FAILED' }) };
  }
}
