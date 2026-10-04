/**
 * Constructor Decision Intelligence -- O5 P4a: the promotion-input PREPARATION BOUNDARY (internal, inert).
 *
 * Runs the real Day Constructor orchestration exactly as `orchestrateConstructDay` does (same queries, same searches, same
 * result, same signed tokens) and -- strictly AFTER the Constructor has produced its final result -- derives each
 * candidate's DecisionPressure from the immutable evidence the P2a stage prepared FOR THIS RUN, projects the normalised
 * stronger-than-pressure facts of each intent, and hands those, with the P3a ContentionTrace and the final result, to the
 * pure assembler (promotionInput.ts). Nothing computed here can flow back into construction: the Constructor decided first,
 * from inputs that never included evidence, pressure, a trace or any promotion value.
 *
 * COHERENCE PROVENANCE. Pressure is derived here, from the evidence the orchestration itself prepared during THIS run
 * (`orchestrateConstructDayWithDiagnostics`' write-only hand-off) -- never accepted from a caller. When the run's
 * dependencies are the P2d snapshot-backed ones (the production preview binding), that evidence was built from the single
 * coherent DecisionSchedulingContext; this module reads no database, opens no snapshot and holds no context. The only
 * reachable inputs are the request, the orchestration dependencies and what the run itself produced, so no external caller
 * can inject pressure, eligibility, owners or a PromotionInput into scheduling.
 *
 * WHY THIS IS NOT WIRED INTO THE NORMAL PREVIEW. The preview calls `orchestrateConstructDay`, unchanged. No scheduling
 * consumer of a promotion input exists (P4b is not implemented), so computing one inside every preview would add work whose
 * result is discarded. This is the internal boundary P4b (or a test) calls; until then nothing in production calls it. It is
 * not part of any route, preview body, signed contract, acceptance, persistence or user-facing surface.
 *
 * FAIL CLOSED. If the run is not READY, or any pure stage throws, the Constructor result is returned exactly as normal and
 * the outcome is UNAVAILABLE with no inputs -- a partial or guessed input is never produced.
 *
 * It names no source, no value signal other than through the shared above-pressure projection, and no timing quality; it
 * does not read DecisionFacts, raw recurrence / opportunity fields, the scheduling context, or any P3b shadow output.
 */

import { orchestrateConstructDayWithDiagnostics, type ConstructDayRequest, type DayConstructorOrchestratorDeps, type OrchestrateConstructDayResult } from './dayConstructorOrchestrator';
import { deriveDecisionPressure, type DecisionPressure } from './decisionPressure';
import { projectAbovePressureFacts, type AbovePressureFacts } from './abovePressurePrecedence';
import { assemblePromotionInputs, type PromotionInput } from './promotionInput';

export type PromotionInputOutcome =
  | { readonly status: 'PREPARED'; readonly inputs: readonly PromotionInput[] }
  | { readonly status: 'UNAVAILABLE'; readonly reason: 'RUN_NOT_READY' | 'PREPARATION_FAILED' };

export async function preparePromotionInputs(request: ConstructDayRequest, deps: DayConstructorOrchestratorDeps): Promise<{ result: OrchestrateConstructDayResult; promotion: PromotionInputOutcome }> {
  const diagnostics = await orchestrateConstructDayWithDiagnostics(request, deps);
  const result = diagnostics.result;
  if (result.status !== 'READY') return { result, promotion: Object.freeze({ status: 'UNAVAILABLE', reason: 'RUN_NOT_READY' }) };
  try {
    const pressureByIntentId = new Map<string, DecisionPressure>();
    const precedenceFactsByIntentId = new Map<string, AbovePressureFacts>();
    for (const resolved of result.preview.resolvedIntents) {
      const id = resolved.requestedIntentId;
      pressureByIntentId.set(id, deriveDecisionPressure({ evidence: diagnostics.evidenceByIntentId.get(id), planningDate: diagnostics.planningDate, flexibility: resolved.dayIntent.flexibility }));
      precedenceFactsByIntentId.set(id, projectAbovePressureFacts(resolved.dayIntent));
    }
    const inputs = assemblePromotionInputs({ finalDay: result.preview.constructedDay, contentionTrace: diagnostics.contentionTrace, pressureByIntentId, precedenceFactsByIntentId, planningDate: diagnostics.planningDate });
    return { result, promotion: Object.freeze({ status: 'PREPARED', inputs }) };
  } catch {
    return { result, promotion: Object.freeze({ status: 'UNAVAILABLE', reason: 'PREPARATION_FAILED' }) };
  }
}
