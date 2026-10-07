/**
 * Constructor Decision Intelligence -- O5 P4b5: the SHADOW EXECUTION & OBSERVATION BOUNDARY (server-only, OFF by default).
 *
 * It answers "WHEN may the pure P4b4 shadow composition run in production, and what minimal observation may leave it?" -- and nothing else. It never
 * answers "should the counterfactual replace the baseline": there is no ACTIVE mode, no substitution, and the Constructor result it returns is, in every
 * mode, the one the baseline orchestration produced.
 *
 * ONE MODULE OWNS the mode check, the shadow invocation, the failure isolation and the observation emission; P4b2, P4b3 and P4b4 stay unaware of modes,
 * sinks, telemetry and latency.
 *
 * NO DUPLICATED BASELINE. The Plan Day preview calls `orchestrateConstructDay` once. `observeShadowPolicy` (P4b4) runs ONE orchestration of its own and
 * returns, as `result`, exactly what `orchestrateConstructDay` returns for the same request and deps (same queries, same searches, same output; proven by
 * the P3a / P4a / P4b4 parity suites). So in SHADOW the preview calls `observeShadowPolicy` INSTEAD of `orchestrateConstructDay`, never in addition: there
 * is exactly one orchestration per request in both modes (the suite pins identical load / search / query counts). Under OFF nothing but the mode lookup
 * is added and the original call is made unchanged.
 *
 * MODES. Exactly 'OFF' | 'SHADOW'. OFF is the default; the mode comes from the server environment only (`AURA_SHADOW_POLICY_MODE`, read here and nowhere
 * else, exactly the value SHADOW; anything else -- missing, empty, misspelled, any other word -- is OFF, failing closed). No request body, header, cookie or
 * query can select a mode: the preview request parser reads a fixed whitelist of fields and the mode never reaches it. There is no database lookup.
 *
 * FAIL-OPEN RELATIVE TO PLAN DAY, AND NEVER A SECOND BASELINE RUN. "Fail-open" here means: discard the shadow observation and its failure, preserve the baseline
 * response -- it never means the policy accepts. A shadow failure has exactly two phases, and the boundary tells them apart STRUCTURALLY, never by guessing:
 *   PRE-BASELINE   the baseline orchestration itself failed (no result exists yet). That is not a shadow failure: the error surfaces exactly as
 *                  `orchestrateConstructDay`'s would (same error object, same HTTP mapping upstream) and NOTHING is re-run merely because SHADOW is on.
 *   POST-BASELINE  a result exists and a later shadow step failed. The composition hands the baseline result to this boundary the moment it exists
 *                  (an output-only callback, strictly before any shadow work), so the boundary serves THAT result -- it never runs the Constructor or the
 *                  preparation again. (P4b4 contains its own failures, so in practice this phase cannot even occur; the boundary is correct if it does.)
 * Summarising and emitting the observation are isolated too: a failure of the metric derivation, the timer or the sink is discarded. The invariant, for every
 * outcome of one preview request (OFF, every SHADOW outcome, every failure): the authoritative baseline orchestration runs AT MOST ONCE.
 *
 * SYNCHRONOUS, AWAITED, NO BACKGROUND WORK. The shadow composition is awaited inside the request. There is no fire-and-forget promise, no queue, no timer
 * and no timeout (the composition is bounded, pure CPU over at most MAX_INTENTS_PER_REQUEST intents; the sink is a synchronous function that returns
 * nothing, so it cannot leave work for after the response).
 *
 * MINIMAL OBSERVATION. The sink never receives the P4b4 observation. It receives `ShadowPolicyMetrics`, a separate type of closed categories and small
 * counts: the mode, a run category, how many observations, how many generations were READY, counts per typed unavailable / reject reason, how many
 * ACCEPTs, and a coarse latency bucket. No user, intent, owner, goal, activity or plan identifier, no title or free text, no timestamp or placement, no
 * stack trace -- low cardinality by construction, and nothing that could be fed back into scheduling (the sink returns nothing). The default server sink
 * writes ONE structured line per SHADOW request to the existing server log stream (there is no other server-side telemetry mechanism; the ProductEvent
 * table is user-scoped, database-backed and a closed taxonomy, so using it would add a write to the request path). No database table is added.
 *
 * SHADOW EVIDENCE (O5). After the baseline exists and the existing latency has been read, the boundary also asks the pure `deriveShadowEvidence` what the REAL P4c1 selector,
 * P4c2a gate, P4c3 materializer and the invariant verifier WOULD have done on this very run, and adds the answer to the same line as bounded categories (plus two count
 * buckets: positively pressured intents, and those that lost real P3a contention). The materialized result it builds is discarded inside that function: the returned value is
 * `observed.result`, the baseline, in every outcome. The derivation is SHADOW-only (OFF returns before any evidence reference), failure-isolated (a failure is the bounded
 * category EVIDENCE_FAILED), one pass, pure (no query, search, Constructor run, clock or store of its own), and claims nothing about usefulness: it reports what happened.
 *
 * A shadow ACCEPT has no operational effect: no substitution, no new preview, no signing change, no persistence, no recomposition, no notification, and
 * nothing in the HTTP response, headers or status. No learning, no acceptance-rate target, no policy feedback loop.
 */

import { orchestrateConstructDay, type ConstructDayRequest, type DayConstructorOrchestratorDeps, type OrchestrateConstructDayResult } from './dayConstructorOrchestrator';
import { observeShadowPolicy, type ShadowPolicyObservation, type ShadowPolicyRun } from './shadowPolicyObservation';
import { bucketOfCount, deriveShadowEvidence, NOT_EVALUATED_EVIDENCE, type ShadowCountBucket, type ShadowEvidence, type ShadowEvidenceDeps } from './shadowEvidence';

export type ShadowPolicyMode = 'OFF' | 'SHADOW';

export const SHADOW_POLICY_MODE_ENV = 'AURA_SHADOW_POLICY_MODE';

/** Exactly the value SHADOW selects SHADOW; every other value (missing, empty, misspelled, unknown) is OFF. */
export function parseShadowPolicyMode(raw: unknown): ShadowPolicyMode {
  return typeof raw === 'string' && raw.trim() === 'SHADOW' ? 'SHADOW' : 'OFF';
}

/** The typed reason of one observation outcome, taken from the composition's own contract (no reason vocabulary is defined or translated here). */
type ReasonOf<O extends ShadowPolicyObservation['outcome']> = Extract<ShadowPolicyObservation, { outcome: O }> extends { readonly reason: infer R } ? R & string : never;

export type ShadowPolicyLatencyBucket = 'LT_50_MS' | 'LT_250_MS' | 'LT_1000_MS' | 'GTE_1000_MS' | 'UNKNOWN';
export type ShadowPolicyRunCategory = 'READY' | 'RUN_NOT_READY' | 'PREPARATION_FAILED' | 'OBSERVATION_FAILED' | 'TECHNICAL_FAILURE';

/** The ONLY thing a sink receives: closed categories and small counts. No identifiers, no text, no instants, no placements. */
export interface ShadowPolicyMetrics {
  readonly mode: 'SHADOW';
  readonly run: ShadowPolicyRunCategory;
  /** How many observations (one per eligible input) the run produced. */
  readonly observations: number;
  readonly generationReady: number;
  readonly generationUnavailable: Readonly<Partial<Record<ReasonOf<'GENERATION_UNAVAILABLE'>, number>>>;
  readonly accepted: number;
  readonly rejected: Readonly<Partial<Record<ReasonOf<'REJECT'>, number>>>;
  readonly acceptanceUnavailable: Readonly<Partial<Record<ReasonOf<'ACCEPTANCE_UNAVAILABLE'>, number>>>;
  readonly latency: ShadowPolicyLatencyBucket;
  /**
   * O5 SHADOW EVIDENCE (additive; bounded categories only). ELIGIBLE RUN = a SHADOW request whose baseline Constructor result is READY and whose promotion preparation
   * PREPARED (run category READY): only those carry a funnel; every other run category is reported as itself with the zero / NOT_EVALUATED defaults.
   *   pressured          bucketed count of resolved intents with POSITIVE DecisionPressure (LAST_KNOWN_OPPORTUNITY; NONE is not positive); a run counts as pressured iff this is not ZERO
   *   pressuredContested bucketed count of those pressured intents that were the loser of at least one ACTUAL P3a contention event
   * `observations` above is the number of PromotionInputs prepared (a run has promotion inputs iff it is not 0).
   */
  readonly pressured: ShadowCountBucket;
  readonly pressuredContested: ShadowCountBucket;
  /** What the REAL P4c1 selector, P4c2a gate, P4c3 materializer and the invariant check WOULD have done on this run (discarded; the baseline is served). */
  readonly evidence: ShadowEvidence;
  /** Time attributable to SHADOW itself: from the moment the baseline result existed to the end of the evidence derivation. Never includes the baseline orchestration. */
  readonly shadowOverheadLatency: ShadowPolicyLatencyBucket;
}

/** One-way, synchronous, returns nothing: it cannot hold the request open and cannot feed anything back into scheduling. */
export interface ShadowPolicySink {
  readonly record: (metrics: ShadowPolicyMetrics) => void;
}

export interface ShadowPolicyExecution {
  readonly mode: ShadowPolicyMode;
  readonly sink?: ShadowPolicySink;
  /** Test injection only: the shadow composer. Production uses `observeShadowPolicy`. */
  readonly observe?: typeof observeShadowPolicy;
  /** Test injection only: a monotonic millisecond source, for the latency bucket (observability only). */
  readonly monotonicNow?: () => number;
  /** Test injection only: the evidence derivation (to exercise an observability failure) and its materializer (to exercise the invariant FAIL path). Production uses `deriveShadowEvidence`. */
  readonly deriveEvidence?: typeof deriveShadowEvidence;
  readonly evidenceDeps?: ShadowEvidenceDeps;
}

/** The default server sink: one structured aggregate line per SHADOW request. Only ever invoked in SHADOW. */
export const serverLogShadowPolicySink: ShadowPolicySink = Object.freeze({
  record: (metrics: ShadowPolicyMetrics): void => {
    console.info(JSON.stringify({ event: 'DAY_CONSTRUCTOR_SHADOW_POLICY', ...metrics }));
  },
});

/** The production execution settings: the mode from the server environment ONLY (OFF unless exactly SHADOW) and the default server sink. */
export function createServerShadowPolicyExecution(): ShadowPolicyExecution {
  return Object.freeze({ mode: parseShadowPolicyMode(process.env[SHADOW_POLICY_MODE_ENV]), sink: serverLogShadowPolicySink });
}

function bucketOf(elapsedMs: number): ShadowPolicyLatencyBucket {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 'UNKNOWN';
  if (elapsedMs < 50) return 'LT_50_MS';
  if (elapsedMs < 250) return 'LT_250_MS';
  if (elapsedMs < 1000) return 'LT_1000_MS';
  return 'GTE_1000_MS';
}

function bump<K extends string>(counts: Partial<Record<K, number>>, key: K): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

/** Derive the minimal metrics from a P4b4 run: outcomes and typed reasons only -- no identifier, summary, slot or instant is read. */
export function summarizeShadowPolicyRun(run: ShadowPolicyRun, latency: ShadowPolicyLatencyBucket, evidence: ShadowEvidence = NOT_EVALUATED_EVIDENCE, shadowOverheadLatency: ShadowPolicyLatencyBucket = 'UNKNOWN'): ShadowPolicyMetrics {
  if (run.status !== 'READY') return Object.freeze({ mode: 'SHADOW', run: run.reason, observations: 0, generationReady: 0, generationUnavailable: Object.freeze({}), accepted: 0, rejected: Object.freeze({}), acceptanceUnavailable: Object.freeze({}), latency, pressured: 'ZERO', pressuredContested: 'ZERO', evidence, shadowOverheadLatency });
  const generationUnavailable: Partial<Record<ReasonOf<'GENERATION_UNAVAILABLE'>, number>> = {};
  const rejected: Partial<Record<ReasonOf<'REJECT'>, number>> = {};
  const acceptanceUnavailable: Partial<Record<ReasonOf<'ACCEPTANCE_UNAVAILABLE'>, number>> = {};
  let accepted = 0;
  let generationReady = 0;
  for (const observation of run.observations) {
    if (observation.outcome === 'GENERATION_UNAVAILABLE') { bump(generationUnavailable, observation.reason); continue; }
    generationReady += 1;
    if (observation.outcome === 'ACCEPT') accepted += 1;
    else if (observation.outcome === 'REJECT') bump(rejected, observation.reason);
    else bump(acceptanceUnavailable, observation.reason);
  }
  return Object.freeze({ mode: 'SHADOW', run: 'READY', observations: run.observations.length, generationReady, generationUnavailable: Object.freeze(generationUnavailable), accepted, rejected: Object.freeze(rejected), acceptanceUnavailable: Object.freeze(acceptanceUnavailable), latency, pressured: bucketOfCount(run.funnel.pressuredIntents), pressuredContested: bucketOfCount(run.funnel.pressuredContendedIntents), evidence, shadowOverheadLatency });
}

/**
 * The Plan Day orchestration call. OFF (or no settings): the original `orchestrateConstructDay` call, unchanged, with nothing else done. SHADOW: ONE
 * orchestration through the P4b4 composition (instead of, never in addition to, the plain call), the baseline result returned untouched, the minimal
 * metrics handed to the sink, every shadow-side failure discarded.
 */
export async function orchestrateConstructDayWithShadowPolicy(request: ConstructDayRequest, deps: DayConstructorOrchestratorDeps, execution?: ShadowPolicyExecution): Promise<OrchestrateConstructDayResult> {
  if (!execution || execution.mode !== 'SHADOW') return orchestrateConstructDay(request, deps);
  const observe = execution.observe ?? observeShadowPolicy;
  const started = startTimer(execution);
  let held: { readonly result: OrchestrateConstructDayResult } | undefined;
  let baselineAt: number | undefined;
  let observed: Awaited<ReturnType<typeof observeShadowPolicy>>;
  try {
    observed = await observe(request, deps, (result) => { held = { result }; baselineAt = startTimer(execution); });
  } catch (error) {
    if (!held) throw error; // PRE-BASELINE: the baseline orchestration itself failed -- surface it exactly as the plain call would; never re-run it
    emit(execution, summarizeTechnicalFailure()); // POST-BASELINE: serve the baseline result that already exists
    return held.result;
  }
  emitRun(execution, observed.shadowPolicy, started, observed.result, baselineAt);
  return observed.result; // THE BASELINE, in every outcome: the evidence below only ever produces bounded categories, never a result
}

function startTimer(execution: ShadowPolicyExecution): number | undefined {
  try {
    return (execution.monotonicNow ?? (() => performance.now()))();
  } catch {
    return undefined;
  }
}

/** The evidence derivation, isolated: any failure becomes a bounded technical-failure category and never propagates. */
function evidenceFor(execution: ShadowPolicyExecution, baseline: OrchestrateConstructDayResult, run: ShadowPolicyRun): ShadowEvidence {
  try {
    return (execution.deriveEvidence ?? deriveShadowEvidence)(baseline, run, execution.evidenceDeps);
  } catch {
    return Object.freeze({ ...NOT_EVALUATED_EVIDENCE, failure: 'EVIDENCE_FAILED' });
  }
}

function emitRun(execution: ShadowPolicyExecution, run: ShadowPolicyRun, started: number | undefined, baseline: OrchestrateConstructDayResult, baselineAt: number | undefined): void {
  try {
    const latency: ShadowPolicyLatencyBucket = started === undefined ? 'UNKNOWN' : elapsedBucket(execution, started); // the existing P4b5 latency: unchanged, measured before the evidence work
    const evidence = evidenceFor(execution, baseline, run);
    const shadowOverheadLatency: ShadowPolicyLatencyBucket = baselineAt === undefined ? 'UNKNOWN' : elapsedBucket(execution, baselineAt);
    emit(execution, summarizeShadowPolicyRun(run, latency, evidence, shadowOverheadLatency));
  } catch {
    // The metric derivation failed: discard the observation, preserve the baseline.
  }
}

function elapsedBucket(execution: ShadowPolicyExecution, since: number): ShadowPolicyLatencyBucket {
  try {
    return bucketOf((execution.monotonicNow ?? (() => performance.now()))() - since);
  } catch {
    return 'UNKNOWN';
  }
}

function summarizeTechnicalFailure(): ShadowPolicyMetrics {
  return Object.freeze({ mode: 'SHADOW', run: 'TECHNICAL_FAILURE', observations: 0, generationReady: 0, generationUnavailable: Object.freeze({}), accepted: 0, rejected: Object.freeze({}), acceptanceUnavailable: Object.freeze({}), latency: 'UNKNOWN', pressured: 'ZERO', pressuredContested: 'ZERO', evidence: NOT_EVALUATED_EVIDENCE, shadowOverheadLatency: 'UNKNOWN' });
}

function emit(execution: ShadowPolicyExecution, metrics: ShadowPolicyMetrics): void {
  try {
    execution.sink?.record(metrics);
  } catch {
    // The sink failed: discard it, preserve the baseline.
  }
}
