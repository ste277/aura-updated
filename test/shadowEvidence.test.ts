/**
 * O5 SHADOW EVIDENCE OBSERVABILITY -- behavior suite (pure, real pipeline, honest exclusion-filtering fake timing search; no database).
 *
 *   Part 1  the funnel through the REAL SHADOW boundary: directed ACCEPT (positive pressure, real contention, promotion prepared, ACCEPT, selector APPLY, gate MATERIALIZABLE,
 *           materializer READY, invariants PASS) -- and the externally returned result is the BASELINE object, never the materialized one
 *   Part 2  every other funnel outcome: NO_ACCEPT, MULTIPLE_ACCEPTS, typed generation-unavailable, real P4b3 REJECT (reason preserved), gate failure (DEFERRED_DIAGNOSTIC_UNRESOLVED),
 *           BASELINE_PROVENANCE_MISMATCH (counted distinctly, baseline returned, no exception)
 *   Part 3  the invariant check: PASS on a real materialization and each bounded FAIL category on a synthetic corruption; no production path can forge an authority
 *   Part 4  failure isolation: an injected observability exception (technical failure recorded, baseline unchanged), the OFF path does no evidence work
 *   Part 5  privacy and cardinality: the emitted line has only closed categories; latency buckets (existing latency unchanged + SHADOW-attributable overhead); performance (informational)
 */
import { observeShadowPolicy, type ShadowPolicyObservation, type ShadowPolicyRun } from '../apps/web/lib/shadowPolicyObservation';
import { orchestrateConstructDayWithShadowPolicy, type ShadowPolicyMetrics } from '../apps/web/lib/shadowPolicyExecution';
import { deriveShadowEvidence, bucketOfCount } from '../apps/web/lib/shadowEvidence';
import { checkMaterializationInvariants } from '../apps/web/lib/materializationInvariants';
import { orchestrateConstructDay, type ConstructDayRequest, type DayConstructorOrchestratorDeps, type OrchestrateConstructDayResult, type RequestedDayIntent } from '../apps/web/lib/dayConstructorOrchestrator';
import { createDecisionFactPreparer } from '../apps/web/lib/decisionFactPreparation';
import type { DecisionFacts } from '../apps/web/lib/decisionFacts';
import type { OpportunityRangeDeps } from '../apps/web/lib/opportunityRangeAdapter';
import type { AvailabilityConfiguration } from '../apps/web/lib/availabilityContext';
import type { TimingCandidate } from '../packages/recommendation/src/timingSearch';
import { acceptedCounterfactualOf, type AcceptedCounterfactual } from '../apps/web/lib/acceptedCounterfactual';
import { selectActiveCounterfactual } from '../apps/web/lib/activeSelector';
import { materializeActiveResult } from '../apps/web/lib/activeResultMaterializer';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const LC = require('../apps/web/lib/localCounterfactual') as { generateLocalCounterfactual: (a: any) => any };
const realGenerate = LC.generateLocalCounterfactual;

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const FRIDAY = '2026-10-09';
const clone = <T>(v: T): T => {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Date) return new Date(v.getTime()) as unknown as T;
  if (Array.isArray(v)) return v.map(clone) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) out[k] = clone((v as Record<string, unknown>)[k]);
  return out as T;
};

(async () => {
  type Weekday = AvailabilityConfiguration['periods'][number]['weekday'];
  const workWeek: AvailabilityConfiguration = { configured: true, periods: ([1, 2, 3, 4, 5] as Weekday[]).map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })) };
  const rangeDeps: OpportunityRangeDeps = { loadAvailabilityConfiguration: async () => workWeek, loadPlansOverlappingRange: async () => [] };
  const at = (h: string) => new Date(`${FRIDAY}T${h}:00Z`);
  const iso = (h: string) => `${FRIDAY}T${h}:00.000Z`;
  const TT = (h: string) => new Date(iso(h)).getTime();
  type Label = 'EXCELLENT' | 'GOOD' | 'USABLE' | 'CAUTION';
  interface PoolItem { slot: [string, string]; label: Label }
  const item = (a: string, b: string, label: Label = 'GOOD'): PoolItem => ({ slot: [a, b], label });
  const WEEK_FACTS: DecisionFacts = { recurrence: { period: 'LOCAL_CALENDAR_WEEK', periodStartDate: '2026-10-05', periodEndDate: '2026-10-11', targetPerPeriod: 3, completedInPeriod: 0, committedInPeriod: 0, remainingInPeriod: 3 } };
  const req = (id: string, order: number, over: Partial<RequestedDayIntent> = {}): RequestedDayIntent => ({ id, title: id, flexibility: 'FLEXIBLE', durationMinutes: 60, originalOrder: order, ...over } as RequestedDayIntent);
  const fixed = (id: string, order: number, start: string): RequestedDayIntent => req(id, order, { flexibility: 'FIXED', fixedStart: at(start) } as Partial<RequestedDayIntent>);
  const request = (intents: RequestedDayIntent[], pressured: string[]): ConstructDayRequest => ({ targetDate: FRIDAY, timezone: 'UTC', constructionWindowSource: 'EXPLICIT_RANGE', now: at('09:00'), explicitStart: at('09:00'), explicitEnd: at('17:00'), intents, decisionFactsByIntentId: new Map(pressured.map((id) => [id, WEEK_FACTS] as [string, DecisionFacts])) });
  function mkDeps(pools: Record<string, PoolItem[]>, limit: number, counters = { search: 0, blocking: 0 }): DayConstructorOrchestratorDeps {
    const prepare = createDecisionFactPreparer(rangeDeps);
    return {
      loadBlockingPlans: async () => { counters.blocking += 1; return []; },
      loadDurationContext: async () => ({ preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} }),
      searchTiming: (r: any) => {
        counters.search += 1;
        const excluded = r.excludedIntervals ?? [];
        const out = (pools[r.taskTitle as string] ?? []).filter((p) => !excluded.some((e: { start: Date; end: Date }) => TT(p.slot[0]) < e.end.getTime() && e.start.getTime() < TT(p.slot[1]))).slice(0, limit);
        const candidates: TimingCandidate[] = out.map((p) => ({ start: iso(p.slot[0]), end: iso(p.slot[1]), score: 5, label: p.label, muhurtaScore: 0, reasons: [], metadata: { windowType: 'NEUTRAL', windowLabel: 'x', activityType: 'x', dateLabel: FRIDAY } }));
        return { candidates };
      },
      loadAvailabilityConfiguration: async () => ({ configured: false, periods: [] }),
      prepareDecisionFacts: prepare as any,
    };
  }
  type ReadyResult = Extract<OrchestrateConstructDayResult, { status: 'READY' }>;
  interface Scenario { intents: RequestedDayIntent[]; pressured: string[]; pools: Record<string, PoolItem[]>; limit: number }
  const O = [item('10:00', '11:00'), item('15:00', '16:00')];
  const SCENARIOS: Record<string, Scenario> = {
    accept: { intents: [req('O', 0), req('P', 1)], pressured: ['O', 'P'], pools: { O, P: [item('10:30', '11:30')] }, limit: 3 },
    // the same accept shape plus an independent NON-owner N placed away from the contention (used to corrupt a non-owner / FIXED item in the synthetic invariant cases)
    acceptWithBystanders: { intents: [req('O', 0), req('P', 1), req('N', 2), fixed('F', 3, '13:00')], pressured: ['O', 'P'], pools: { O, P: [item('10:30', '11:30')], N: [item('14:00', '15:00')] }, limit: 3 },
    unpressuredCandidate: { intents: [req('O', 0), req('P', 1)], pressured: ['O'], pools: { O, P: [item('10:30', '11:30')] }, limit: 3 },
    noContention: { intents: [req('A', 0), req('B', 1)], pressured: ['A', 'B'], pools: { A: [item('09:00', '10:00')], B: [item('11:00', '12:00')] }, limit: 3 },
    multi: { intents: [req('O1', 0), req('P1', 1), req('O2', 2), req('P2', 3)], pressured: ['O1', 'P1', 'O2', 'P2'], pools: { O1: [item('09:00', '10:00'), item('11:00', '12:00')], P1: [item('09:30', '10:30')], O2: [item('13:00', '14:00'), item('15:00', '16:00')], P2: [item('13:30', '14:30')] }, limit: 3 },
    loss: { intents: [req('X', 0), req('Y', 1), req('O', 2), req('P', 3)], pressured: ['X', 'Y', 'O', 'P'], pools: { X: [item('13:00', '14:00')], Y: [item('13:00', '14:00'), item('10:00', '11:00')], O: [item('13:30', '14:30'), item('09:30', '10:30'), item('11:00', '12:00')], P: [item('13:30', '14:30'), item('10:30', '11:30'), item('11:30', '12:30')] }, limit: 1 },
    otherDeferred: { intents: [req('O', 0), req('P', 1), req('D', 2)], pressured: ['O', 'P'], pools: { O, P: [item('10:30', '11:30')], D: [item('10:00', '11:00')] }, limit: 3 },
  };
  const requestOf = (s: Scenario) => request(s.intents, s.pressured);
  const depsOf = (s: Scenario) => mkDeps(s.pools, s.limit);
  const view = (r: OrchestrateConstructDayResult) => (r.status === 'READY' ? r.preview.constructedDay.proposedItems.map((i) => `${i.intentId}@${i.start.toISOString().slice(11, 16)}`).join(',') : r.status);

  interface Shadowed { result: OrchestrateConstructDayResult; seen: ShadowPolicyMetrics[]; baseline?: OrchestrateConstructDayResult; plain: OrchestrateConstructDayResult }
  async function shadow(s: Scenario, extra: Record<string, unknown> = {}): Promise<Shadowed> {
    const seen: ShadowPolicyMetrics[] = [];
    let baseline: OrchestrateConstructDayResult | undefined;
    const observe: typeof observeShadowPolicy = async (rq, dp, cb) => observeShadowPolicy(rq, dp, (r) => { baseline = r; cb?.(r); });
    const plain = await orchestrateConstructDay(requestOf(s), depsOf(s));
    const result = await orchestrateConstructDayWithShadowPolicy(requestOf(s), depsOf(s), { mode: 'SHADOW', sink: { record: (x: ShadowPolicyMetrics) => { seen.push(x); } }, observe, ...extra } as never);
    return { result, seen, baseline, plain };
  }
  const evidenceOf = (sh: Shadowed) => sh.seen[0]?.evidence;

  // ======================================================================
  console.log('=== Part 1: the funnel through the real SHADOW boundary -- a directed ACCEPT ===');
  const acc = await shadow(SCENARIOS.accept);
  const m: ShadowPolicyMetrics = acc.seen[0];
  check('ONE aggregate observation is emitted for the eligible SHADOW run', acc.seen.length === 1 && m.mode === 'SHADOW' && m.run === 'READY');
  check('POSITIVE PRESSURE: both intents carry LAST_KNOWN_OPPORTUNITY -> pressured bucket TWO', m.pressured === 'TWO');
  check('REAL CONTENTION: the candidate P lost to the owner O in the P3a trace -> exactly ONE pressured intent was contended (the loser; the owner is not a loser)', m.pressuredContested === 'ONE');
  check('PROMOTION PREPARED: one PromotionInput, one observation, generation READY, one P4b3 ACCEPT, no reject / unavailable', m.observations === 1 && m.generationReady === 1 && m.accepted === 1 && Object.keys(m.rejected).length === 0 && Object.keys(m.acceptanceUnavailable).length === 0 && Object.keys(m.generationUnavailable).length === 0);
  check('SELECTOR APPLY -> GATE MATERIALIZABLE -> MATERIALIZER READY -> INVARIANTS PASS (the real P4c1 / P4c2a / P4c3 and the invariant check ran on this run), no technical failure', JSON.stringify(m.evidence) === JSON.stringify({ selector: 'APPLY', gate: 'MATERIALIZABLE', materializer: 'READY', invariant: 'PASS', failure: 'NONE' }));
  check('SHADOW IS INERT: the returned result IS the baseline object of this run (identity), equals a plain orchestration, and is NOT the materialized day (the owner is still at 10:00 and P still Deferred)', acc.result === acc.baseline && JSON.stringify(acc.result) === JSON.stringify(acc.plain) && view(acc.result) === 'O@10:00' && (acc.result as ReadyResult).preview.constructedDay.deferredItems.some((d) => d.intentId === 'P'));
  check('the sink payload is frozen', Object.isFrozen(m) && Object.isFrozen(m.evidence));
  {
    const o = await observeShadowPolicy(requestOf(SCENARIOS.accept), depsOf(SCENARIOS.accept));
    const sel = selectActiveCounterfactual(o.shadowPolicy);
    const mat = sel.status === 'APPLY' ? materializeActiveResult({ baselineResult: o.result, constructionBasis: sel.acceptedCounterfactual.constructionBasis, accepted: sel.acceptedCounterfactual }) : undefined;
    check('independently: the real materializer builds P@10:30 with O relocated to 15:00 for this very run (the different day the evidence discarded)', !!mat && mat.status === 'READY' && view(mat.result).split(',').sort().join() === 'O@15:00,P@10:30');
    check('and deriveShadowEvidence over that run yields exactly the same categories as the boundary emitted', JSON.stringify(deriveShadowEvidence(o.result, o.shadowPolicy)) === JSON.stringify(m.evidence));
  }

  // ======================================================================
  console.log('=== Part 2: every other funnel outcome ===');
  {
    const none = await shadow(SCENARIOS.unpressuredCandidate);
    check('NO POSITIVE PRESSURE ON THE CANDIDATE: P has no pressure -> no promotion input, observations 0, selector NO_ACCEPT, nothing downstream evaluated', none.seen[0].pressured === 'ONE' && none.seen[0].pressuredContested === 'ZERO' && none.seen[0].observations === 0 && JSON.stringify(none.seen[0].evidence) === JSON.stringify({ selector: 'NO_ACCEPT', gate: 'NOT_EVALUATED', materializer: 'NOT_EVALUATED', invariant: 'NOT_EVALUATED', failure: 'NONE' }) && none.result === none.baseline);
    const nc = await shadow(SCENARIOS.noContention);
    check('PRESSURE BUT NO CONTENTION: both pressured, none contended, no promotion -> NO_ACCEPT (pressure is not contention)', nc.seen[0].pressured === 'TWO' && nc.seen[0].pressuredContested === 'ZERO' && nc.seen[0].observations === 0 && nc.seen[0].evidence.selector === 'NO_ACCEPT' && nc.result === nc.baseline);
    const multi = await shadow(SCENARIOS.multi);
    check('MULTIPLE_ACCEPTS: two ACCEPTs, the selector refuses to rank (MULTIPLE_ACCEPTS), the gate / materializer / invariants are NOT evaluated, the baseline is returned', multi.seen[0].accepted === 2 && multi.seen[0].pressuredContested === 'TWO' && JSON.stringify(multi.seen[0].evidence) === JSON.stringify({ selector: 'MULTIPLE_ACCEPTS', gate: 'NOT_EVALUATED', materializer: 'NOT_EVALUATED', invariant: 'NOT_EVALUATED', failure: 'NONE' }) && multi.result === multi.baseline && JSON.stringify(multi.result) === JSON.stringify(multi.plain));
    const loss = await shadow(SCENARIOS.loss);
    check('REAL P4b3 REJECT: the typed reason is preserved in the existing `rejected` map (OWNER_WOULD_BE_UNPLACED), the selector is NO_ACCEPT, nothing downstream runs, the baseline is returned', (loss.seen[0].rejected as Record<string, number>).OWNER_WOULD_BE_UNPLACED >= 1 && loss.seen[0].accepted === 0 && loss.seen[0].evidence.selector === 'NO_ACCEPT' && loss.seen[0].evidence.gate === 'NOT_EVALUATED' && loss.result === loss.baseline);
    LC.generateLocalCounterfactual = () => Object.freeze({ status: 'UNAVAILABLE', reason: 'NO_ACTIONABLE_PROMOTION_SLOT' });
    let genUn: Shadowed;
    try { genUn = await shadow(SCENARIOS.accept); } finally { LC.generateLocalCounterfactual = realGenerate; }
    check('TYPED GENERATION UNAVAILABLE: counted under its exact reason (NO_ACTIONABLE_PROMOTION_SLOT) in the existing map, no counterfactual, selector NO_ACCEPT, baseline returned', (genUn.seen[0].generationUnavailable as Record<string, number>).NO_ACTIONABLE_PROMOTION_SLOT === 1 && genUn.seen[0].generationReady === 0 && genUn.seen[0].evidence.selector === 'NO_ACCEPT' && genUn.result === genUn.baseline);
    LC.generateLocalCounterfactual = () => { throw new Error('boom'); };
    let genFail: Shadowed;
    try { genFail = await shadow(SCENARIOS.accept); } finally { LC.generateLocalCounterfactual = realGenerate; }
    check('A GENERATION THROW is a typed technical reason (GENERATION_FAILED), the selector reports INCOMPLETE_OBSERVATION (the failure could hide an ACCEPT), the baseline is returned', (genFail.seen[0].generationUnavailable as Record<string, number>).GENERATION_FAILED === 1 && genFail.seen[0].evidence.selector === 'INCOMPLETE_OBSERVATION' && genFail.result === genFail.baseline);
    const gate = await shadow(SCENARIOS.otherDeferred);
    check('GATE FAILURE: another Deferred item -> selector APPLY, gate DEFERRED_DIAGNOSTIC_UNRESOLVED, the materializer is NOT applied (NOT_EVALUATED), invariants NOT_EVALUATED, baseline returned', JSON.stringify(gate.seen[0].evidence) === JSON.stringify({ selector: 'APPLY', gate: 'DEFERRED_DIAGNOSTIC_UNRESOLVED', materializer: 'NOT_EVALUATED', invariant: 'NOT_EVALUATED', failure: 'NONE' }) && gate.result === gate.baseline);
    // BASELINE_PROVENANCE_MISMATCH through the reporting boundary: the composition's run belongs to run A, the baseline the boundary holds is run B's (a coherent, different day)
    const a = await observeShadowPolicy(requestOf(SCENARIOS.accept), depsOf(SCENARIOS.accept));
    const b = await observeShadowPolicy(requestOf(SCENARIOS.accept), depsOf(SCENARIOS.accept));
    const seen: ShadowPolicyMetrics[] = [];
    let thrown = false; let result: OrchestrateConstructDayResult | undefined;
    try {
      result = await orchestrateConstructDayWithShadowPolicy(requestOf(SCENARIOS.accept), depsOf(SCENARIOS.accept), { mode: 'SHADOW', sink: { record: (x) => { seen.push(x); } }, observe: async (_r, _d, cb) => { cb?.(b.result); return { result: b.result, shadowPolicy: a.shadowPolicy }; } });
    } catch { thrown = true; }
    check('BASELINE_PROVENANCE_MISMATCH: run A\'s authority with run B\'s (structurally identical but foreign) baseline -> materializer BASELINE_PROVENANCE_MISMATCH, counted distinctly (never folded into a generic failure), no invariant run, no exception, the baseline is returned', !thrown && result === b.result && seen.length === 1 && JSON.stringify(seen[0].evidence) === JSON.stringify({ selector: 'APPLY', gate: 'MATERIALIZABLE', materializer: 'BASELINE_PROVENANCE_MISMATCH', invariant: 'NOT_EVALUATED', failure: 'NONE' }));
    check('the P4c4a provenance guard is unchanged: a CLONED baseline of the very same run is also a mismatch (identity, not structure)', (() => { const e = deriveShadowEvidence(clone(a.result), a.shadowPolicy); return e.materializer === 'BASELINE_PROVENANCE_MISMATCH' && e.invariant === 'NOT_EVALUATED'; })());
    const notReady = deriveShadowEvidence({ status: 'TIMEZONE_MISSING' } as OrchestrateConstructDayResult, a.shadowPolicy);
    check('a not-READY baseline with a READY run fails closed as GATE_FAILED (never a pass, never a throw)', notReady.failure === 'GATE_FAILED' && notReady.materializer === 'NOT_EVALUATED' && notReady.invariant === 'NOT_EVALUATED');
    const unavailable = deriveShadowEvidence(a.result, { status: 'UNAVAILABLE', reason: 'PREPARATION_FAILED' });
    check('a run that is not READY is not eligible: every stage NOT_EVALUATED, no failure', JSON.stringify(unavailable) === JSON.stringify({ selector: 'NOT_EVALUATED', gate: 'NOT_EVALUATED', materializer: 'NOT_EVALUATED', invariant: 'NOT_EVALUATED', failure: 'NONE' }));
  }

  // ======================================================================
  console.log('=== Part 3: the invariant check ===');
  {
    const o = await observeShadowPolicy(requestOf(SCENARIOS.acceptWithBystanders), depsOf(SCENARIOS.acceptWithBystanders));
    const sel = selectActiveCounterfactual(o.shadowPolicy);
    check('the bystander scenario still has exactly one real ACCEPT and a READY materialization (bystanders: N flexible, F fixed)', sel.status === 'APPLY');
    if (sel.status === 'APPLY') {
      const accepted = sel.acceptedCounterfactual as AcceptedCounterfactual;
      const real = materializeActiveResult({ baselineResult: o.result, constructionBasis: accepted.constructionBasis, accepted });
      check('the real materialization passes every invariant (PASS)', real.status === 'READY' && checkMaterializationInvariants(o.result, real.result, accepted) === 'PASS');
      if (real.status === 'READY') {
        const tamper = (edit: (r: ReadyResult) => void): string => { const r = clone(real.result) as ReadyResult; edit(r); return checkMaterializationInvariants(o.result, r, accepted); };
        const items = (r: ReadyResult) => r.preview.constructedDay.proposedItems;
        const shift = (i: { start: Date; end: Date }) => { i.start = new Date(i.start.getTime() + 60000); i.end = new Date(i.end.getTime() + 60000); };
        check('FAIL FIXED_ITEM_MOVED: a FIXED placement was moved', tamper((r) => shift(items(r).find((i) => i.intentId === 'F')!)) === 'FIXED_ITEM_MOVED');
        check('FAIL UNRELATED_ITEM_MOVED: a non-owner flexible item was moved', tamper((r) => shift(items(r).find((i) => i.intentId === 'N')!)) === 'UNRELATED_ITEM_MOVED');
        check('FAIL OWNER_MISSING: a baseline Proposed intent disappeared (and was replaced, so the count is unchanged)', tamper((r) => { const x = items(r).find((i) => i.intentId === 'N')!; x.intentId = 'GHOST'; }) === 'OWNER_MISSING');
        check('FAIL PROPOSED_COUNT_REDUCED: fewer Proposed items than the baseline', tamper((r) => { r.preview.constructedDay.proposedItems = items(r).slice(0, 2); }) === 'PROPOSED_COUNT_REDUCED');
        check('FAIL UNAUTHORIZED_DISPLACEMENT: an extra item that is neither a baseline item nor the promoted candidate', tamper((r) => { r.preview.constructedDay.proposedItems = [...items(r), { ...clone(items(r)[0]), intentId: 'EXTRA' }]; }) === 'UNAUTHORIZED_DISPLACEMENT');
        check('the promoted candidate missing (count equal to the baseline) is a reduced count against baseline + 1 and never passes', tamper((r) => { r.preview.constructedDay.proposedItems = items(r).filter((i) => i.intentId !== 'P'); }) !== 'PASS');
        check('FAIL BASELINE_PROVENANCE_INVALID: a cloned baseline is not the baseline bound to the authority (the P4c4a same-run guarantee holds inside the verifier too)', checkMaterializationInvariants(clone(o.result), real.result, accepted) === 'BASELINE_PROVENANCE_INVALID');
        check('FAIL CHECK_FAILED: a malformed materialized result never passes and never throws (a missing authority is BASELINE_PROVENANCE_INVALID)', checkMaterializationInvariants(o.result, { status: 'READY' } as never, accepted) === 'CHECK_FAILED' && checkMaterializationInvariants(o.result, null as never, accepted) === 'CHECK_FAILED' && checkMaterializationInvariants(o.result, real.result, null as never) === 'BASELINE_PROVENANCE_INVALID'); // a missing authority is not bound to any baseline: fail closed, never PASS
        // through the boundary: a SYNTHETIC invariant failure is emitted as a bounded FAIL category and the baseline is still what is returned
        const seen: ShadowPolicyMetrics[] = [];
        let baseline: OrchestrateConstructDayResult | undefined;
        const result = await orchestrateConstructDayWithShadowPolicy(requestOf(SCENARIOS.acceptWithBystanders), depsOf(SCENARIOS.acceptWithBystanders), {
          mode: 'SHADOW', sink: { record: (x) => { seen.push(x); } },
          observe: async (r, d, cb) => observeShadowPolicy(r, d, (x) => { baseline = x; cb?.(x); }),
          evidenceDeps: { materialize: (input) => { const out = materializeActiveResult(input); if (out.status !== 'READY') return out; const r = clone(out.result) as ReadyResult; shift(r.preview.constructedDay.proposedItems.find((i) => i.intentId === 'N')!); return { status: 'READY', result: r }; } },
        });
        check('SYNTHETIC INVARIANT FAILURE through the boundary: UNRELATED_ITEM_MOVED is emitted (not suppressed, not folded into PASS), the baseline is returned, the failure category is a policy-independent bounded value', seen.length === 1 && seen[0].evidence.invariant === 'UNRELATED_ITEM_MOVED' && seen[0].evidence.materializer === 'READY' && seen[0].evidence.failure === 'NONE' && result === baseline);
        check('NO PRODUCTION PATH CAN FORGE AUTHORITY: with a forged accepted look-alike (a spread copy of a real authority) the verifier reports BASELINE_PROVENANCE_INVALID, and the evidence derivation never accepts an observation without its minted authority (INCOMPLETE_OBSERVATION)', checkMaterializationInvariants(o.result, real.result, { ...accepted } as AcceptedCounterfactual) === 'BASELINE_PROVENANCE_INVALID' && (() => { const ob = (o.shadowPolicy as Extract<ShadowPolicyRun, { status: 'READY' }>).observations.map((x) => Object.freeze({ ...x }) as ShadowPolicyObservation); return deriveShadowEvidence(o.result, Object.freeze({ status: 'READY', observations: Object.freeze(ob), funnel: { pressuredIntents: 0, pressuredContendedIntents: 0 } }) as ShadowPolicyRun).selector === 'INCOMPLETE_OBSERVATION'; })());
        check('and the authority of an ACCEPT is still resolvable only from the real observation (the linked authority, unchanged by this slice)', acceptedCounterfactualOf((o.shadowPolicy as Extract<ShadowPolicyRun, { status: 'READY' }>).observations.find((x) => x.outcome === 'ACCEPT')!) === accepted);
      }
    }
  }

  // ======================================================================
  console.log('=== Part 4: failure isolation; OFF does no evidence work ===');
  {
    const thrownEvidence = await shadow(SCENARIOS.accept, { deriveEvidence: () => { throw new Error('observability defect'); } });
    check('AN INJECTED OBSERVABILITY EXCEPTION: the baseline is returned unchanged, ONE line is still emitted with the bounded technical-failure category EVIDENCE_FAILED and no error text, and the existing policy metrics are intact', thrownEvidence.result === thrownEvidence.baseline && thrownEvidence.seen.length === 1 && thrownEvidence.seen[0].evidence.failure === 'EVIDENCE_FAILED' && thrownEvidence.seen[0].accepted === 1 && !/observability defect/.test(JSON.stringify(thrownEvidence.seen)));
    const selectorFail = deriveShadowEvidence((await observeShadowPolicy(requestOf(SCENARIOS.accept), depsOf(SCENARIOS.accept))).result, { status: 'READY', observations: [], funnel: null } as never);
    check('a hostile run object never makes the derivation throw (bounded category only)', selectorFail.failure === 'NONE' || selectorFail.failure === 'SELECTOR_FAILED');
    const matThrow = await shadow(SCENARIOS.accept, { evidenceDeps: { materialize: () => { throw new Error('materializer defect'); } } });
    check('a materializer defect is isolated: MATERIALIZER_FAILED, invariants NOT_EVALUATED, baseline returned', matThrow.seen[0].evidence.failure === 'MATERIALIZER_FAILED' && matThrow.seen[0].evidence.invariant === 'NOT_EVALUATED' && matThrow.result === matThrow.baseline);
    const spy = { evidence: 0 };
    const seen: ShadowPolicyMetrics[] = []; const calls = { search: 0, blocking: 0 };
    const off = await orchestrateConstructDayWithShadowPolicy(requestOf(SCENARIOS.accept), mkDeps(SCENARIOS.accept.pools, 3, calls), { mode: 'OFF', sink: { record: (x) => { seen.push(x); } }, deriveEvidence: (...a: Parameters<typeof deriveShadowEvidence>) => { spy.evidence += 1; return deriveShadowEvidence(...a); } });
    const plainCalls = { search: 0, blocking: 0 };
    const plain = await orchestrateConstructDay(requestOf(SCENARIOS.accept), mkDeps(SCENARIOS.accept.pools, 3, plainCalls));
    check('OFF DOES NO EVIDENCE WORK: nothing derived, nothing emitted, the plain result and the identical load / search counts of a plain orchestration', spy.evidence === 0 && seen.length === 0 && JSON.stringify(off) === JSON.stringify(plain) && calls.search === plainCalls.search && calls.blocking === plainCalls.blocking);
    const noSettings = await orchestrateConstructDayWithShadowPolicy(requestOf(SCENARIOS.accept), depsOf(SCENARIOS.accept));
    check('no settings at all behaves as OFF', JSON.stringify(noSettings) === JSON.stringify(plain));
    const shadowCalls = { search: 0, blocking: 0 };
    await orchestrateConstructDayWithShadowPolicy(requestOf(SCENARIOS.accept), mkDeps(SCENARIOS.accept.pools, 3, shadowCalls), { mode: 'SHADOW', sink: { record: () => undefined } });
    check('NO SECOND CONSTRUCTOR / SEARCH / QUERY: SHADOW with the full evidence funnel performs exactly the searches and loads of a plain orchestration', shadowCalls.search === plainCalls.search && shadowCalls.blocking === plainCalls.blocking);
  }

  // ======================================================================
  console.log('=== Part 5: privacy, cardinality, latency, performance ===');
  {
    const lines = [acc, ...(await Promise.all([SCENARIOS.multi, SCENARIOS.loss, SCENARIOS.otherDeferred, SCENARIOS.noContention].map((s) => shadow(s))))].map((x) => x.seen[0]);
    const text = JSON.stringify(lines);
    check('NO PRIVATE OR HIGH-CARDINALITY CONTENT: no intent id (O, P, N, X, Y ...), no title, no instant, no placement, no id-like or time-like string anywhere in the emitted lines', !/"[OPNXYFD][0-9]?"/.test(text) && !/\d{4}-\d{2}-\d{2}/.test(text) && !/\d{2}:\d{2}/.test(text) && !/intent|title|candidate|owner|user|goal|plan|occurrence|uuid/i.test(text.replace(/OWNER_WOULD_BE_UNPLACED|OWNER_TIMING_DEGRADED|UNNECESSARY_OWNER_CHANGE|OWNER_MISSING/g, '')));
    const KEYS = ['acceptanceUnavailable', 'accepted', 'evidence', 'generationReady', 'generationUnavailable', 'latency', 'mode', 'observations', 'pressured', 'pressuredContested', 'rejected', 'run', 'shadowOverheadLatency'];
    const EVIDENCE_KEYS = ['failure', 'gate', 'invariant', 'materializer', 'selector'];
    const BUCKETS = ['ZERO', 'ONE', 'TWO', 'THREE_PLUS'];
    check('EXACT SCHEMA, CLOSED VOCABULARY: only the reviewed keys, count buckets from four values, evidence from the closed categories', lines.every((l) => JSON.stringify(Object.keys(l).sort()) === JSON.stringify(KEYS) && JSON.stringify(Object.keys(l.evidence).sort()) === JSON.stringify(EVIDENCE_KEYS) && BUCKETS.includes(l.pressured) && BUCKETS.includes(l.pressuredContested)));
    check('bucketOfCount is a total, bounded function: negatives / NaN / Infinity -> ZERO, 0 -> ZERO, 1 -> ONE, 2 -> TWO, 3 / 12 / 10^9 -> THREE_PLUS', [bucketOfCount(-1), bucketOfCount(NaN), bucketOfCount(0), bucketOfCount(1), bucketOfCount(2), bucketOfCount(3), bucketOfCount(12), bucketOfCount(1e9)].join() === 'ZERO,ZERO,ZERO,ONE,TWO,THREE_PLUS,THREE_PLUS,THREE_PLUS' && bucketOfCount(Infinity) === 'ZERO');
    // latency: the existing latency is unchanged and measured BEFORE the evidence work; the SHADOW-attributable overhead runs from the baseline hand-off to the end of the evidence
    const ticks = [0, 950, 960, 1000]; // start, baseline hand-off, existing-latency read, evidence done
    const seen: ShadowPolicyMetrics[] = [];
    await orchestrateConstructDayWithShadowPolicy(requestOf(SCENARIOS.accept), depsOf(SCENARIOS.accept), { mode: 'SHADOW', sink: { record: (x) => { seen.push(x); } }, monotonicNow: () => ticks.shift() ?? 5000 });
    check('LATENCY: the existing P4b5 latency (start -> before the evidence work, 960 ms) is LT_1000_MS and the SHADOW-attributable overhead (baseline hand-off -> evidence done, 50 ms) is LT_250_MS -- two independent buckets; the overhead excludes the baseline orchestration and the existing latency excludes the evidence work; neither claims a threshold', seen[0].latency === 'LT_1000_MS' && seen[0].shadowOverheadLatency === 'LT_250_MS');
    const broken: ShadowPolicyMetrics[] = [];
    const resultBroken = await orchestrateConstructDayWithShadowPolicy(requestOf(SCENARIOS.accept), depsOf(SCENARIOS.accept), { mode: 'SHADOW', sink: { record: (x) => { broken.push(x); } }, monotonicNow: () => { throw new Error('clock'); } });
    check('a broken clock makes both latency buckets UNKNOWN and changes nothing else (evidence still derived, baseline returned)', broken.length === 1 && broken[0].latency === 'UNKNOWN' && broken[0].shadowOverheadLatency === 'UNKNOWN' && broken[0].evidence.materializer === 'READY' && view(resultBroken) === 'O@10:00');
    // performance (informational): the evidence derivation over one run, repeated -- reported, never gated on an invented threshold
    const o = await observeShadowPolicy(requestOf(SCENARIOS.accept), depsOf(SCENARIOS.accept));
    const N = 200; const t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i += 1) deriveShadowEvidence(o.result, o.shadowPolicy);
    const per = Number(process.hrtime.bigint() - t0) / 1e6 / N;
    const t1 = process.hrtime.bigint();
    for (let i = 0; i < 50; i += 1) await observeShadowPolicy(requestOf(SCENARIOS.accept), depsOf(SCENARIOS.accept));
    const baseMs = Number(process.hrtime.bigint() - t1) / 1e6 / 50;
    console.log(`     informational: evidence derivation ${per.toFixed(3)} ms per run; one shadow-composed orchestration ${baseMs.toFixed(3)} ms (in-memory fakes; no database)`);
    check('PERFORMANCE IS BOUNDED BY CONSTRUCTION: the derivation is at most one selector pass, one gate, one materialization and one invariant check (no loop over searches, no re-run) -- measured, not thresholded', Number.isFinite(per) && per >= 0);
  }

  if (!allPassed) { console.error('SOME SHADOW EVIDENCE CHECKS FAILED'); process.exit(1); }
  console.log('ALL SHADOW EVIDENCE CHECKS PASSED');
})();
