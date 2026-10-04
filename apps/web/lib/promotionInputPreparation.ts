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
 * OWNER PRESSURE (O5 P4a2). The pressure map holds EVERY resolved intent's derived pressure -- the candidate's and each
 * potential owner's -- from the same run and the same immutable evidence, so a PromotionOwner's pressure and the candidate's
 * belong to one evaluation. No second derivation path, no extra read, nothing caller-supplied. One intent id carries one
 * pressure: a duplicate resolved id fails the whole preparation closed.
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
 * CONTENTION AUTHORITY (O5 P4b2a). The same run's diagnostics also hold the P3a trace, the ConstructionBasis and the BaselinePlacements, so this is
 * the one boundary where all of them coexist with the assembled inputs. For each input it projects, once and with an isolated failure path, a
 * narrow typed PromotionContentionAuthority (the exact intervals the candidate attempted and lost to its authorized owners) and returns it as the
 * index-aligned sibling `contention`. Existing `promotion` semantics are unchanged; no second orchestration; the raw trace goes no further.
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
import { projectContentionAuthority, type PromotionContentionOutcome } from './promotionContentionAuthority';

export type PromotionInputOutcome =
  | { readonly status: 'PREPARED'; readonly inputs: readonly PromotionInput[] }
  | { readonly status: 'UNAVAILABLE'; readonly reason: 'RUN_NOT_READY' | 'PREPARATION_FAILED' };

export async function preparePromotionInputs(request: ConstructDayRequest, deps: DayConstructorOrchestratorDeps): Promise<{ result: OrchestrateConstructDayResult; promotion: PromotionInputOutcome; contention: readonly PromotionContentionOutcome[] }> {
  const diagnostics = await orchestrateConstructDayWithDiagnostics(request, deps);
  const result = diagnostics.result;
  if (result.status !== 'READY') return { result, promotion: Object.freeze({ status: 'UNAVAILABLE', reason: 'RUN_NOT_READY' }), contention: NO_AUTHORITIES };
  try {
    const pressureByIntentId = new Map<string, DecisionPressure>();
    const precedenceFactsByIntentId = new Map<string, AbovePressureFacts>();
    for (const resolved of result.preview.resolvedIntents) {
      const id = resolved.requestedIntentId;
      if (pressureByIntentId.has(id)) throw new Error('duplicate resolved intent id: one intent cannot carry two pressures'); // fail closed (caught below): never pick one
      pressureByIntentId.set(id, deriveDecisionPressure({ evidence: diagnostics.evidenceByIntentId.get(id), planningDate: diagnostics.planningDate, flexibility: resolved.dayIntent.flexibility }));
      precedenceFactsByIntentId.set(id, projectAbovePressureFacts(resolved.dayIntent));
    }
    const inputs = assemblePromotionInputs({ finalDay: result.preview.constructedDay, contentionTrace: diagnostics.contentionTrace, pressureByIntentId, precedenceFactsByIntentId, planningDate: diagnostics.planningDate });
    // O5 P4b2a: ONE contention authority per input, from this SAME run's trace, basis and baseline placements. Its failure is isolated:
    // it can only make that entry UNAVAILABLE -- never the inputs, never the Constructor result.
    const contention = Object.freeze(inputs.map((input) => contentionFor(diagnostics.contentionTrace, input, diagnostics.constructionBasis, diagnostics.baselinePlacements)));
    return { result, promotion: Object.freeze({ status: 'PREPARED', inputs }), contention };
  } catch {
    return { result, promotion: Object.freeze({ status: 'UNAVAILABLE', reason: 'PREPARATION_FAILED' }), contention: NO_AUTHORITIES };
  }
}

const NO_AUTHORITIES: readonly PromotionContentionOutcome[] = Object.freeze([]);

function contentionFor(...args: Parameters<typeof projectContentionAuthority>): PromotionContentionOutcome {
  try {
    return projectContentionAuthority(...args);
  } catch {
    return Object.freeze({ status: 'UNAVAILABLE', reason: 'CAPTURE_FAILED' });
  }
}
