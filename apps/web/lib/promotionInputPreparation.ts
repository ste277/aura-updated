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
 * SAME-RUN AUTHORITY (O5 P4b2a / P4b2b). The same run's diagnostics also hold the P3a trace, the ConstructionBasis and the BaselinePlacements, so
 * this is the one boundary where all of them coexist with the assembled inputs. It hands ONE same-run structure to a future pure generator:
 *   run { constructionBasis, baselinePlacements, schedulingAttempts, promotions: [ { input, contention } ] }
 * The basis and placements are run-level and appear ONCE (a pass-through of the already-immutable outcomes -- no second producer). The
 * scheduling attempts are the run-level typed projection of the trace. Each promotion is a TYPED PAIR built in one expression from its
 * input: `contention` is projected from THAT input (isolated: its failure makes only that pair's contention UNAVAILABLE and never shifts
 * another pair), so there is no positional trust between parallel arrays. Existing `promotion` semantics are unchanged; no second
 * orchestration; the raw trace goes no further.
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
import { projectSchedulingAttempts, type SchedulingAttemptOutcome } from './schedulingAttemptAuthority';

export type PromotionInputOutcome =
  | { readonly status: 'PREPARED'; readonly inputs: readonly PromotionInput[] }
  | { readonly status: 'UNAVAILABLE'; readonly reason: 'RUN_NOT_READY' | 'PREPARATION_FAILED' };

type Diagnostics = Awaited<ReturnType<typeof orchestrateConstructDayWithDiagnostics>>;

/** One PromotionInput and ITS OWN contention authority, paired where it is built (never by position). */
export interface PromotionPair {
  readonly input: PromotionInput;
  readonly contention: PromotionContentionOutcome;
}

/**
 * O5 SHADOW EVIDENCE: the run's funnel COUNTS (numbers only -- no identifier), counted from the SAME pressure map and the SAME P3a trace this run derived, never a second derivation:
 *   pressuredIntents          resolved intents whose derived DecisionPressure is LAST_KNOWN_OPPORTUNITY (NONE is not positive)
 *   pressuredContendedIntents those pressured intents that were the LOSER of at least one actual P3a contention event (real contention, never inferred from Deferred / capacity)
 */
export interface PromotionFunnelCounts {
  readonly pressuredIntents: number;
  readonly pressuredContendedIntents: number;
}

export type PromotionRunAuthority =
  | {
      readonly status: 'PREPARED';
      readonly constructionBasis: Diagnostics['constructionBasis'];
      readonly baselinePlacements: Diagnostics['baselinePlacements'];
      readonly schedulingAttempts: SchedulingAttemptOutcome;
      readonly promotions: readonly PromotionPair[];
      readonly funnel: PromotionFunnelCounts;
    }
  | { readonly status: 'UNAVAILABLE'; readonly reason: 'RUN_NOT_READY' | 'PREPARATION_FAILED' };

export async function preparePromotionInputs(request: ConstructDayRequest, deps: DayConstructorOrchestratorDeps): Promise<{ result: OrchestrateConstructDayResult; promotion: PromotionInputOutcome; run: PromotionRunAuthority }> {
  const diagnostics = await orchestrateConstructDayWithDiagnostics(request, deps);
  const result = diagnostics.result;
  if (result.status !== 'READY') return { result, promotion: Object.freeze({ status: 'UNAVAILABLE', reason: 'RUN_NOT_READY' }), run: RUN_NOT_READY };
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
    // O5 P4b2a / P4b2b: ONE typed pair per input, from this SAME run's trace, basis and baseline placements; the run-level scheduling attempts
    // from the same trace. Each projection's failure is isolated: it can only make ITS OWN outcome UNAVAILABLE -- never the inputs, never the result.
    const promotions = Object.freeze(inputs.map((input) => Object.freeze({ input, contention: contentionFor(diagnostics.contentionTrace, input, diagnostics.constructionBasis, diagnostics.baselinePlacements) })));
    const schedulingAttempts = attemptsFor(diagnostics.contentionTrace, diagnostics.constructionBasis);
    const pressured = [...pressureByIntentId].filter(([, pressure]) => pressure === 'LAST_KNOWN_OPPORTUNITY').map(([id]) => id);
    const losers = new Set(diagnostics.contentionTrace.events.map((event) => event.loserIntentId));
    const funnel: PromotionFunnelCounts = Object.freeze({ pressuredIntents: pressured.length, pressuredContendedIntents: pressured.filter((id) => losers.has(id)).length });
    const run: PromotionRunAuthority = Object.freeze({ status: 'PREPARED', constructionBasis: diagnostics.constructionBasis, baselinePlacements: diagnostics.baselinePlacements, schedulingAttempts, promotions, funnel });
    return { result, promotion: Object.freeze({ status: 'PREPARED', inputs }), run };
  } catch {
    return { result, promotion: Object.freeze({ status: 'UNAVAILABLE', reason: 'PREPARATION_FAILED' }), run: RUN_PREPARATION_FAILED };
  }
}

const RUN_NOT_READY: PromotionRunAuthority = Object.freeze({ status: 'UNAVAILABLE', reason: 'RUN_NOT_READY' });
const RUN_PREPARATION_FAILED: PromotionRunAuthority = Object.freeze({ status: 'UNAVAILABLE', reason: 'PREPARATION_FAILED' });

function contentionFor(...args: Parameters<typeof projectContentionAuthority>): PromotionContentionOutcome {
  try {
    return projectContentionAuthority(...args);
  } catch {
    return Object.freeze({ status: 'UNAVAILABLE', reason: 'CAPTURE_FAILED' });
  }
}

function attemptsFor(...args: Parameters<typeof projectSchedulingAttempts>): SchedulingAttemptOutcome {
  try {
    return projectSchedulingAttempts(...args);
  } catch {
    return Object.freeze({ status: 'UNAVAILABLE', reason: 'CAPTURE_FAILED' });
  }
}
