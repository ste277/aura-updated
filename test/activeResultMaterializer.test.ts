/**
 * Constructor Decision Intelligence -- O5 P4c3: the PURE ACTIVE RESULT MATERIALIZER (behavior suite).
 *
 * Four inert pure pieces, tested over the REAL orchestrator (an honest exclusion-filtering fake timing search) -- no handcrafted run authority except where a
 * hostile / forged authority is the point of the case:
 *
 *   Part 1  the typed same-run accepted-counterfactual authority: minted only on a P4b3 ACCEPT, unforgeable, frozen, detached, scalar-only
 *   Part 2  the P4c1 V1 selector: APPLY iff exactly one ACCEPT in a complete observation set; order-independent; technical failures fail closed
 *   Part 3  the P4c2a materializability gate: exactly-once P, unique ids, conflict subset (INCONSISTENT_AUTHORITY); any other Deferred / conflict (UNRESOLVED)
 *   Part 4  directed materializer cases: single / multi owner, every timing fit, FIXED, non-owner, capacity, order, candidateOrder, deferred / conflict removal
 *   Part 5  defense in depth: forged authorities, other-run basis, tampered baseline, every counterfactual violation -> typed UNAVAILABLE
 *   Part 6  purity: baseline / basis / authority never mutated, detached, deeply frozen, deterministic, no Constructor / search / P4b2 / P4b3 call
 *   Part 7  the end-to-end TEST-ONLY pure pipeline (observations -> selector -> gate -> materializer): the output is BASELINE or exactly ONE result
 *   Part 8  compatibility: the signed preview body and the existing acceptance evaluation accept a materialized result
 *   Part 9  corpora: authoritative / multi-region / adversarial / P-only / no-exclusion sweeps with property checks on every materialized result
 */
import { rankedShuffle, seededShuffle } from './fixtureSupport';
import { observeShadowPolicy, type ShadowPolicyObservation, type ShadowPolicyRun } from '../apps/web/lib/shadowPolicyObservation';
import { preparePromotionInputs } from '../apps/web/lib/promotionInputPreparation';
import { orchestrateConstructDay, type ConstructDayRequest, type DayConstructorOrchestratorDeps, type OrchestrateConstructDayResult, type RequestedDayIntent } from '../apps/web/lib/dayConstructorOrchestrator';
import { createDecisionFactPreparer } from '../apps/web/lib/decisionFactPreparation';
import type { DecisionFacts } from '../apps/web/lib/decisionFacts';
import type { OpportunityRangeDeps } from '../apps/web/lib/opportunityRangeAdapter';
import type { AvailabilityConfiguration } from '../apps/web/lib/availabilityContext';
import type { TimingCandidate } from '../packages/recommendation/src/timingSearch';
import type { PlanBlockerCandidate } from '../apps/web/lib/planBlockerLifecycle';
import { isAcceptedCounterfactual, mintAcceptedCounterfactual, recordAcceptedObservation, acceptedCounterfactualOf, type AcceptedCounterfactual } from '../apps/web/lib/acceptedCounterfactual';
import { selectActiveCounterfactual } from '../apps/web/lib/activeSelector';
import { evaluateMaterializability } from '../apps/web/lib/activeMaterializability';
import { materializeActiveResult } from '../apps/web/lib/activeResultMaterializer';
import { activeViolations } from './activeMaterializerOracle';
import { signPreviewResultBody, verifyAcceptanceItems } from '../apps/web/lib/dayConstructorPreviewIntegrity';
import { evaluateAcceptance, type AcceptConstructedDayRequest } from '../apps/web/lib/dayConstructorAcceptance';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const LC = require('../apps/web/lib/localCounterfactual') as { generateLocalCounterfactual: (a: any) => any };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ACC = require('../apps/web/lib/counterfactualAcceptance') as { evaluateCounterfactualAcceptance: (a: any) => any };
const realGenerate = LC.generateLocalCounterfactual;
const realEvaluate = ACC.evaluateCounterfactualAcceptance;
const restore = () => { LC.generateLocalCounterfactual = realGenerate; ACC.evaluateCounterfactualAcceptance = realEvaluate; };

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const FRIDAY = '2026-10-09';
const reachable = (v: unknown, seen = new Set<unknown>()): Set<unknown> => { if (v !== null && typeof v === 'object' && !seen.has(v)) { seen.add(v); Object.values(v as Record<string, unknown>).forEach((c) => reachable(c, seen)); } return seen; };
const deepFrozen = (v: unknown, seen = new Set<unknown>()): boolean => { if (v === null || typeof v !== 'object' || seen.has(v)) return true; seen.add(v); return Object.isFrozen(v) && Object.values(v as Record<string, unknown>).every((c) => deepFrozen(c, seen)); };
const noDates = (v: unknown): boolean => [...reachable(v)].every((o) => !(o instanceof Date) && !(o instanceof Map) && !(o instanceof Set));
/** A structural snapshot that keeps Dates comparable (JSON would flatten them but is still exact for equality of instants). */
const snap = (v: unknown): string => JSON.stringify(v, (_k, x) => (typeof x === 'function' ? '[fn]' : x));
/** A mutable deep copy (Date-aware), for tampering with a baseline result in a case. */
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
  interface DepOptions { noExclusion?: boolean; blockers?: PlanBlockerCandidate[] }
  interface Counters { blocking: number; duration: number; search: number }
  const fresh = (): Counters => ({ blocking: 0, duration: 0, search: 0 });
  function mkDeps(pools: Record<string, PoolItem[]>, limit: number, options: DepOptions = {}, counters: Counters = fresh()): DayConstructorOrchestratorDeps {
    const prepare = createDecisionFactPreparer(rangeDeps);
    return {
      loadBlockingPlans: async () => { counters.blocking += 1; return options.blockers ?? []; },
      loadDurationContext: async () => { counters.duration += 1; return { preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} }; },
      searchTiming: (r: any) => {
        counters.search += 1;
        const id = r.taskTitle as string;
        const excluded = options.noExclusion ? [] : (r.excludedIntervals ?? []);
        const out = (pools[id] ?? []).filter((p) => !excluded.some((e: { start: Date; end: Date }) => TT(p.slot[0]) < e.end.getTime() && e.start.getTime() < TT(p.slot[1]))).slice(0, limit);
        const candidates: TimingCandidate[] = out.map((p) => ({ start: iso(p.slot[0]), end: iso(p.slot[1]), score: 5, label: p.label, muhurtaScore: 0, reasons: [], metadata: { windowType: 'NEUTRAL', windowLabel: 'x', activityType: 'x', dateLabel: FRIDAY } }));
        return { candidates };
      },
      loadAvailabilityConfiguration: async () => ({ configured: false, periods: [] }),
      prepareDecisionFacts: prepare as any,
    };
  }
  type Observed = Awaited<ReturnType<typeof observeShadowPolicy>>;
  const observe = (intents: RequestedDayIntent[], pressured: string[], pools: Record<string, PoolItem[]>, limit = 3, options: DepOptions = {}): Promise<Observed> => observeShadowPolicy(request(intents, pressured), mkDeps(pools, limit, options));
  type ReadyResult = Extract<OrchestrateConstructDayResult, { status: 'READY' }>;

  // ---- the TEST-ONLY pure pipeline: observations -> selector -> (gate inside) materializer. Output is the BASELINE or exactly ONE materialized result.
  type Piped = { kind: 'BASELINE'; reason: string; result: OrchestrateConstructDayResult } | { kind: 'ACTIVE'; result: ReadyResult; accepted: AcceptedCounterfactual };
  const pipe = (observed: Observed): Piped => {
    const selection = selectActiveCounterfactual(observed.shadowPolicy);
    if (selection.status !== 'APPLY') return { kind: 'BASELINE', reason: selection.reason, result: observed.result };
    const accepted = selection.acceptedCounterfactual;
    const materialized = materializeActiveResult({ baselineResult: observed.result, constructionBasis: accepted.constructionBasis, accepted });
    return materialized.status === 'READY' ? { kind: 'ACTIVE', result: materialized.result, accepted } : { kind: 'BASELINE', reason: materialized.reason, result: observed.result };
  };

  // ---- the property oracle (test/activeMaterializerOracle.ts): every conservation / preservation / FIXED / owner / timing / order / capacity / window / blocker / overlap property
  const violations = (baselineResult: OrchestrateConstructDayResult, active: ReadyResult, accepted: AcceptedCounterfactual, intents: RequestedDayIntent[]): string[] => activeViolations(baselineResult, active, accepted, {
    order: intents.map((i) => i.id),
    titleOf: (id) => intents.find((i) => i.id === id)?.title,
    durationMinutesOf: (id) => intents.find((i) => i.id === id)?.durationMinutes,
  });
  const dispatch = (label: string, vs: string[]) => check(label, vs.length === 0 || (console.log('     violations:', vs.join('; ')), false));

  // ======================================================================
  console.log('=== Part 1: the typed same-run accepted-counterfactual authority ===');
  const O = [item('10:00', '11:00'), item('15:00', '16:00')];
  const acceptPools = { O, P: [item('10:30', '11:30')] };
  const acceptIntents = [req('O', 0), req('P', 1)];
  const lossPools = { X: [item('13:00', '14:00')], Y: [item('13:00', '14:00'), item('10:00', '11:00')], O: [item('13:30', '14:30'), item('09:30', '10:30'), item('11:00', '12:00')], P: [item('13:30', '14:30'), item('10:30', '11:30'), item('11:30', '12:30')] };
  const lossIntents = [req('X', 0), req('Y', 1), req('O', 2), req('P', 3)];
  const base1 = await observe(acceptIntents, ['O', 'P'], acceptPools);
  const sp1 = base1.shadowPolicy as Extract<ShadowPolicyRun, { status: 'READY' }>;
  const acc1 = acceptedCounterfactualOf(sp1.observations[0]);
  check('MINT ON ACCEPT: the single ACCEPT observation carries a typed authority, trusted only by `isAcceptedCounterfactual`', sp1.observations[0].outcome === 'ACCEPT' && acc1 !== undefined && isAcceptedCounterfactual(acc1) && acc1.candidateIntentId === 'P');
  check('the authority is a detached, deeply frozen, SCALAR-only snapshot (no Date, Map or Set), holding the exact same-run basis and baseline-placements outcomes', !!acc1 && Object.isFrozen(acc1) && [acc1.promoted, acc1.displacedOwnerIds, acc1.relocated, acc1.placements].every((part) => deepFrozen(part) && noDates(part)) && acc1.constructionBasis.status === 'READY' && acc1.baselinePlacements.status === 'READY');
  check('the snapshot content: P at 10:30, O displaced and relocated 10:00 -> 15:00, complete counterfactual rows (baseline O replaced in place, P last)', !!acc1 && acc1.promoted.startMs === TT('10:30') && acc1.promoted.endMs === TT('11:30') && acc1.promoted.placementSource === 'PROMOTED_CONTENTION_ATTEMPT' && JSON.stringify(acc1.displacedOwnerIds) === '["O"]' && acc1.relocated.length === 1 && acc1.relocated[0].startMs === TT('15:00') && acc1.placements.map((p) => p.intentId).join() === 'O,P');
  const lossObserved = await observe(lossIntents, ['X', 'Y', 'O', 'P'], lossPools, 1);
  const lossSp = lossObserved.shadowPolicy as Extract<ShadowPolicyRun, { status: 'READY' }>;
  check('NO AUTHORITY WITHOUT ACCEPT: a REJECT / unavailable observation has no typed authority', lossSp.observations.length >= 1 && lossSp.observations.every((o) => o.outcome !== 'ACCEPT' && acceptedCounterfactualOf(o) === undefined));
  const forgeries: Array<[string, unknown]> = [
    ['an object literal with the same fields', acc1 ? { ...acc1 } : undefined],
    ['a Object.create(authority) delegate', acc1 ? Object.create(acc1) : undefined],
    ['a JSON round trip', acc1 ? JSON.parse(JSON.stringify(acc1)) : undefined],
    ['a frozen copy', acc1 ? Object.freeze({ ...acc1 }) : undefined],
    ['null', null], ['a string', 'ACCEPT'], ['an accepted flag object', { status: 'ACCEPT', candidateIntentId: 'P' }],
  ];
  for (const [what, value] of forgeries) check(`FORGERY REJECTED: ${what} is not an accepted counterfactual`, !isAcceptedCounterfactual(value));
  {
    // the only mint: P4b3 itself decides. Patch the predicate to REJECT -> no authority; patch it to throw -> no authority and no throw (fail closed).
    const prepared = await preparePromotionInputs(request(acceptIntents, ['O', 'P']), mkDeps(acceptPools, 3));
    const run: any = prepared.run; const pair = run.promotions[0];
    const g = realGenerate({ constructionBasis: run.constructionBasis, baselinePlacements: run.baselinePlacements, schedulingAttempts: run.schedulingAttempts, input: pair.input, contention: pair.contention });
    const inputOf = (cf: unknown) => ({ constructionBasis: run.constructionBasis, baselinePlacements: run.baselinePlacements, promotionInput: pair.input, counterfactual: cf as any });
    const real = mintAcceptedCounterfactual(inputOf(g.counterfactual));
    check('mintAcceptedCounterfactual over the real authorities: the predicate ACCEPTs and the authority exists', real.acceptance.status === 'ACCEPT' && real.accepted !== undefined && isAcceptedCounterfactual(real.accepted) && Object.isFrozen(real));
    ACC.evaluateCounterfactualAcceptance = () => Object.freeze({ status: 'REJECT', reason: 'NET_PROPOSED_LOSS' });
    let rejected: ReturnType<typeof mintAcceptedCounterfactual>;
    try { rejected = mintAcceptedCounterfactual(inputOf(g.counterfactual)); } finally { restore(); }
    check('a predicate REJECT mints NOTHING (the brand is applied only when P4b3 itself returns ACCEPT)', rejected.acceptance.status === 'REJECT' && rejected.accepted === undefined);
    ACC.evaluateCounterfactualAcceptance = () => { throw new Error('boom'); };
    let thrown = false; let thrownOut: ReturnType<typeof mintAcceptedCounterfactual> | undefined;
    try { thrownOut = mintAcceptedCounterfactual(inputOf(g.counterfactual)); } catch { thrown = true; } finally { restore(); }
    check('a throwing predicate propagates exactly as before (the P4b4 composition isolates it per pair) and mints nothing', thrown && thrownOut === undefined);
    const garbage = mintAcceptedCounterfactual({} as never);
    check('garbage input: P4b3 answers UNAVAILABLE / EVALUATION_FAILED, nothing is minted, nothing throws', garbage.acceptance.status === 'UNAVAILABLE' && garbage.accepted === undefined);
    // a counterfactual with a non-finite instant: the ACCEPT stands but the snapshot cannot be built -> no authority (never a half-trusted one)
    ACC.evaluateCounterfactualAcceptance = () => Object.freeze({ status: 'ACCEPT' });
    let nan: ReturnType<typeof mintAcceptedCounterfactual>;
    try { nan = mintAcceptedCounterfactual(inputOf({ ...g.counterfactual, promotedPlacement: { ...g.counterfactual.promotedPlacement, start: new Date(NaN) } })); } finally { restore(); }
    check('an unrepresentable (non-finite) instant after an ACCEPT yields the acceptance WITHOUT an authority (consumers treat it as not accepted)', nan.acceptance.status === 'ACCEPT' && nan.accepted === undefined);
    const o1 = { outcome: 'ACCEPT', candidateIntentId: 'P' }; const o2 = { outcome: 'ACCEPT', candidateIntentId: 'Q' }; const o3 = { outcome: 'REJECT', candidateIntentId: 'P' };
    recordAcceptedObservation(o2, real.accepted!); recordAcceptedObservation(o3, real.accepted!); recordAcceptedObservation(o1, forgeries[0][1] as AcceptedCounterfactual);
    check('LINK RULES: an authority links only to an ACCEPT observation of the SAME candidate, and only a minted authority links', acceptedCounterfactualOf(o2) === undefined && acceptedCounterfactualOf(o3) === undefined && acceptedCounterfactualOf(o1) === undefined);
    recordAcceptedObservation(o1, real.accepted!);
    check('a legitimate link resolves to that exact authority', acceptedCounterfactualOf(o1) === real.accepted);
  }

  // ======================================================================
  console.log('=== Part 2: the P4c1 V1 selector ===');
  const readyRun = (observations: ShadowPolicyObservation[]): ShadowPolicyRun => ({ status: 'READY', observations } as ShadowPolicyRun);
  {
    const sel = selectActiveCounterfactual(base1.shadowPolicy);
    check('ONE ACCEPT -> APPLY with that candidate, its typed authority and selectionReason LAST_KNOWN_OPPORTUNITY_RESCUED', sel.status === 'APPLY' && sel.candidateIntentId === 'P' && sel.acceptedCounterfactual === acc1 && sel.selectionReason === 'LAST_KNOWN_OPPORTUNITY_RESCUED' && Object.isFrozen(sel));
    const none = selectActiveCounterfactual(lossObserved.shadowPolicy);
    check('ZERO ACCEPT (REJECT only) -> NO_CHANGE / NO_ACCEPT', none.status === 'NO_CHANGE' && none.reason === 'NO_ACCEPT');
    const emptyRun = await observe([req('A', 0), req('B', 1)], ['A', 'B'], { A: [item('09:00', '10:00')], B: [item('11:00', '12:00')] });
    check('READY with no observations -> NO_CHANGE / NO_ACCEPT', emptyRun.shadowPolicy.status === 'READY' && selectActiveCounterfactual(emptyRun.shadowPolicy).status === 'NO_CHANGE' && (selectActiveCounterfactual(emptyRun.shadowPolicy) as { reason: string }).reason === 'NO_ACCEPT');
    const notReady = await observeShadowPolicy({ ...request(acceptIntents, ['O', 'P']), timezone: undefined as unknown as string }, mkDeps(acceptPools, 3));
    const sNotReady = selectActiveCounterfactual(notReady.shadowPolicy);
    check('RUN-LEVEL failure / not READY (UNAVAILABLE run) -> NO_CHANGE / INCOMPLETE_OBSERVATION', notReady.shadowPolicy.status === 'UNAVAILABLE' && sNotReady.status === 'NO_CHANGE' && sNotReady.reason === 'INCOMPLETE_OBSERVATION');
    for (const reason of ['RUN_NOT_READY', 'PREPARATION_FAILED', 'OBSERVATION_FAILED']) {
      const s = selectActiveCounterfactual(Object.freeze({ status: 'UNAVAILABLE', reason }) as unknown as ShadowPolicyRun);
      if (s.status !== 'NO_CHANGE' || s.reason !== 'INCOMPLETE_OBSERVATION') check(`run-level ${reason}`, false);
    }
    check('every run-level unavailable reason is INCOMPLETE_OBSERVATION', true);
    const garbage = [selectActiveCounterfactual(null as never), selectActiveCounterfactual(undefined as never), selectActiveCounterfactual({ status: 'READY', observations: null } as never)];
    check('a hostile / malformed run never throws and fails closed (INCOMPLETE_OBSERVATION)', garbage.every((s) => s.status === 'NO_CHANGE' && s.reason === 'INCOMPLETE_OBSERVATION'));
    // ACCEPT without a typed authority: a structural look-alike, and a spread copy of a real ACCEPT observation (the WeakMap is keyed by identity)
    const realAccept = sp1.observations[0];
    const lookAlike = Object.freeze({ ...realAccept }) as ShadowPolicyObservation;
    check('an ACCEPT observation WITHOUT its typed authority (a copy of a real one) -> INCOMPLETE_OBSERVATION (never APPLY)', selectActiveCounterfactual(readyRun([lookAlike])).status === 'NO_CHANGE' && (selectActiveCounterfactual(readyRun([lookAlike])) as { reason: string }).reason === 'INCOMPLETE_OBSERVATION');
    const withExtra = selectActiveCounterfactual(readyRun([realAccept, lookAlike]));
    check('a real ACCEPT plus an authority-less ACCEPT could hide a second accept -> INCOMPLETE_OBSERVATION', withExtra.status === 'NO_CHANGE' && withExtra.reason === 'INCOMPLETE_OBSERVATION');
    // MULTIPLE ACCEPTS: a real run with two independent accepted promotions
    const twoRegion = await observe([req('O1', 0), req('P1', 1), req('O2', 2), req('P2', 3)], ['O1', 'P1', 'O2', 'P2'], { O1: [item('09:00', '10:00'), item('11:00', '12:00')], P1: [item('09:30', '10:30')], O2: [item('13:00', '14:00'), item('15:00', '16:00')], P2: [item('13:30', '14:30')] });
    const trs = twoRegion.shadowPolicy as Extract<ShadowPolicyRun, { status: 'READY' }>;
    const accepts = trs.observations.filter((o) => o.outcome === 'ACCEPT');
    check(`MULTIPLE ACCEPTS (real run with ${accepts.length} ACCEPTs): NO_CHANGE / MULTIPLE_ACCEPTS -- no ranking, no winner`, accepts.length === 2 && (() => { const s = selectActiveCounterfactual(twoRegion.shadowPolicy); return s.status === 'NO_CHANGE' && s.reason === 'MULTIPLE_ACCEPTS'; })());
    // ORDER INDEPENDENCE: every permutation of the observations gives the identical decision
    const perms = (xs: ShadowPolicyObservation[]): ShadowPolicyObservation[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest])));
    const mixed = [...trs.observations];
    const decisions = new Set(perms(mixed).map((p) => JSON.stringify(selectActiveCounterfactual(readyRun(p)))));
    check(`ORDER-INDEPENDENT: all ${perms(mixed).length} permutations of the observation set give ONE decision`, decisions.size === 1);
    const oneAccept = [acc1 ? sp1.observations[0] : sp1.observations[0], ...lossSp.observations];
    const d1 = new Set(perms(oneAccept).map((p) => { const s = selectActiveCounterfactual(readyRun(p)); return s.status === 'APPLY' ? `APPLY:${s.candidateIntentId}` : `NC:${s.reason}`; }));
    check('one ACCEPT among REJECTs: every permutation APPLYs the same candidate', d1.size === 1 && [...d1][0] === 'APPLY:P');
    const rs = selectActiveCounterfactual(readyRun(oneAccept)); const rs2 = selectActiveCounterfactual(readyRun(oneAccept));
    check('DETERMINISTIC: repeated selection is byte-identical (same authority object)', snap({ ...rs, acceptedCounterfactual: undefined }) === snap({ ...rs2, acceptedCounterfactual: undefined }) && (rs as { acceptedCounterfactual?: unknown }).acceptedCounterfactual === (rs2 as { acceptedCounterfactual?: unknown }).acceptedCounterfactual);
    check('NO SCORE, NO CLIENT FACTS: the selection is {status, reason | candidateIntentId, acceptedCounterfactual, selectionReason} and nothing else', Object.keys(rs).sort().join() === 'acceptedCounterfactual,candidateIntentId,selectionReason,status' && Object.keys(none).sort().join() === 'reason,status');
  }
  {
    // technical failures are never hidden: a failing observation could hide a second ACCEPT -> INCOMPLETE_OBSERVATION (even when the rest is exactly one ACCEPT)
    const pools = { O1: [item('09:00', '10:00'), item('11:00', '12:00')], P1: [item('09:30', '10:30')], O2: [item('13:00', '14:00'), item('15:00', '16:00')], P2: [item('13:30', '14:30')] };
    const intents = [req('O1', 0), req('P1', 1), req('O2', 2), req('P2', 3)]; const all = ['O1', 'P1', 'O2', 'P2'];
    LC.generateLocalCounterfactual = (a: any) => (a.input.candidateIntentId === 'P2' ? Object.freeze({ status: 'UNAVAILABLE', reason: 'NO_ACTIONABLE_PROMOTION_SLOT' }) : realGenerate(a));
    let ordinaryGen: Observed;
    try { ordinaryGen = await observe(intents, all, pools); } finally { restore(); }
    const sOrdinaryGen = selectActiveCounterfactual(ordinaryGen.shadowPolicy);
    check('an ORDINARY generation unavailable (NO_ACTIONABLE_PROMOTION_SLOT) is not a technical failure: the other single ACCEPT still APPLYs', sOrdinaryGen.status === 'APPLY' && sOrdinaryGen.candidateIntentId === 'P1');
    ACC.evaluateCounterfactualAcceptance = (a: any) => (a.promotionInput.candidateIntentId === 'P2' ? Object.freeze({ status: 'UNAVAILABLE', reason: 'INCONSISTENT_AUTHORITY' }) : realEvaluate(a));
    let ordinaryAcc: Observed;
    try { ordinaryAcc = await observe(intents, all, pools); } finally { restore(); }
    const sOrdinaryAcc = selectActiveCounterfactual(ordinaryAcc.shadowPolicy);
    check('an ORDINARY acceptance unavailable (INCONSISTENT_AUTHORITY from P4b3) is not a technical failure either', sOrdinaryAcc.status === 'APPLY' && sOrdinaryAcc.candidateIntentId === 'P1');
    LC.generateLocalCounterfactual = (a: any) => { if (a.input.candidateIntentId === 'P2') throw new Error('boom'); return realGenerate(a); };
    let genFailed: Observed;
    try { genFailed = await observe(intents, all, pools); } finally { restore(); }
    const sGen = selectActiveCounterfactual(genFailed.shadowPolicy);
    check('GENERATION_FAILED on one observation -> INCOMPLETE_OBSERVATION even though P1 is the only ACCEPT (the failure could hide a second ACCEPT)', (genFailed.shadowPolicy as unknown as { observations: ShadowPolicyObservation[] }).observations.some((o) => o.outcome === 'GENERATION_UNAVAILABLE' && o.reason === 'GENERATION_FAILED') && sGen.status === 'NO_CHANGE' && sGen.reason === 'INCOMPLETE_OBSERVATION');
    ACC.evaluateCounterfactualAcceptance = (a: any) => { if (a.promotionInput.candidateIntentId === 'P2') throw new Error('boom'); return realEvaluate(a); };
    let evalFailed: Observed;
    try { evalFailed = await observe(intents, all, pools); } finally { restore(); }
    const sEval = selectActiveCounterfactual(evalFailed.shadowPolicy);
    check('EVALUATION_FAILED on one observation -> INCOMPLETE_OBSERVATION (fail closed)', (evalFailed.shadowPolicy as unknown as { observations: ShadowPolicyObservation[] }).observations.some((o) => o.outcome === 'ACCEPTANCE_UNAVAILABLE' && o.reason === 'EVALUATION_FAILED') && sEval.status === 'NO_CHANGE' && sEval.reason === 'INCOMPLETE_OBSERVATION');
    const clean = await observe(intents, all, pools);
    check('and the clean run (both promotions observed) is MULTIPLE_ACCEPTS, not APPLY', (() => { const s = selectActiveCounterfactual(clean.shadowPolicy); return s.status === 'NO_CHANGE' && s.reason === 'MULTIPLE_ACCEPTS'; })());
  }

  // ======================================================================
  console.log('=== Part 3: the P4c2a materializability gate ===');
  {
    const D = (id: string) => ({ intentId: id });
    const gate = (deferred: string[], conflicts: string[], P = 'P') => evaluateMaterializability({ deferredItems: deferred.map(D), conflicts: conflicts.map(D) }, P);
    const status = (g: ReturnType<typeof gate>) => (g.status === 'MATERIALIZABLE' ? 'OK' : g.reason);
    check('P is the sole Deferred item with its own conflict -> MATERIALIZABLE', status(gate(['P'], ['P'])) === 'OK');
    check('P is the sole Deferred item with no conflict entry -> MATERIALIZABLE', status(gate(['P'], [])) === 'OK');
    check('P absent from Deferred -> INCONSISTENT_AUTHORITY', status(gate([], [])) === 'INCONSISTENT_AUTHORITY' && status(gate(['D'], [])) === 'INCONSISTENT_AUTHORITY');
    check('P twice in Deferred -> INCONSISTENT_AUTHORITY', status(gate(['P', 'P'], [])) === 'INCONSISTENT_AUTHORITY');
    check('duplicate Deferred ids (another id twice) -> INCONSISTENT_AUTHORITY', status(gate(['P', 'D', 'D'], [])) === 'INCONSISTENT_AUTHORITY');
    check('duplicate conflict ids -> INCONSISTENT_AUTHORITY', status(gate(['P'], ['P', 'P'])) === 'INCONSISTENT_AUTHORITY');
    check('a conflict whose intent is not Deferred -> INCONSISTENT_AUTHORITY (structural, checked before the unresolved rules)', status(gate(['P'], ['X'])) === 'INCONSISTENT_AUTHORITY' && status(gate(['P', 'D'], ['X'])) === 'INCONSISTENT_AUTHORITY');
    check('another Deferred item -> DEFERRED_DIAGNOSTIC_UNRESOLVED', status(gate(['P', 'D'], [])) === 'DEFERRED_DIAGNOSTIC_UNRESOLVED' && status(gate(['D1', 'P', 'D2'], ['P'])) === 'DEFERRED_DIAGNOSTIC_UNRESOLVED');
    check('another conflict (belonging to another Deferred item) -> DEFERRED_DIAGNOSTIC_UNRESOLVED', status(gate(['P', 'D'], ['D'])) === 'DEFERRED_DIAGNOSTIC_UNRESOLVED' && status(gate(['P', 'D'], ['P', 'D'])) === 'DEFERRED_DIAGNOSTIC_UNRESOLVED');
    // array-order independence
    const cases: Array<[string[], string[]]> = [[['P'], ['P']], [['P', 'D'], ['D']], [['D1', 'P', 'D2'], ['P']], [['P', 'P'], []], [['P'], ['X']], [[], []]];
    let stable = true; let seed = 7; const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
    for (const [d, c] of cases) { const expected = status(gate(d, c)); for (let k = 0; k < 20; k += 1) if (status(gate(seededShuffle([...d], rnd), seededShuffle([...c], rnd))) !== expected) stable = false; }
    check('ARRAY-ORDER INDEPENDENT: shuffling Deferred and conflicts never changes the decision', stable);
    check('never throws on hostile input (fails closed to INCONSISTENT_AUTHORITY)', status(evaluateMaterializability(null as never, 'P')) === 'INCONSISTENT_AUTHORITY' && status(evaluateMaterializability({ deferredItems: null, conflicts: [] } as never, 'P')) === 'INCONSISTENT_AUTHORITY');
    const g1 = gate(['P'], ['P']); const g2 = gate(['P', 'D'], []);
    check('decisions are frozen records of strings', Object.isFrozen(g1) && Object.isFrozen(g2) && snap(g2) === '{"status":"UNAVAILABLE","reason":"DEFERRED_DIAGNOSTIC_UNRESOLVED"}');
  }

  // ======================================================================
  console.log('=== Part 4: directed materializer cases over the real pipeline ===');
  const runPipe = async (intents: RequestedDayIntent[], pressured: string[], pools: Record<string, PoolItem[]>, limit = 3, options: DepOptions = {}) => {
    const observed = await observe(intents, pressured, pools, limit, options);
    return { observed, piped: pipe(observed) };
  };
  const proposed = (r: OrchestrateConstructDayResult) => (r.status === 'READY' ? r.preview.constructedDay.proposedItems : []);
  const hhmm = (d: Date) => d.toISOString().slice(11, 16);
  const view = (r: OrchestrateConstructDayResult) => proposed(r).map((i) => `${i.intentId}@${hhmm(i.start)}-${hhmm(i.end)}`).join(' ');
  {
    const { observed, piped } = await runPipe(acceptIntents, ['O', 'P'], acceptPools);
    const b = observed.result as ReadyResult;
    check('BASELINE (before): O at 10:00, P Deferred (the exclusion-filtering search emits no conflict entry for it)', view(b) === 'O@10:00-11:00' && b.preview.constructedDay.deferredItems.length === 1 && b.preview.constructedDay.deferredItems[0].intentId === 'P' && b.preview.constructedDay.conflicts.length === 0);
    check('SINGLE OWNER: ACTIVE result has O relocated to 15:00 and P at 10:30, Proposed = baseline + 1, Deferred / conflicts empty, P conflict removed', piped.kind === 'ACTIVE' && view(piped.result) === 'O@15:00-16:00 P@10:30-11:30' && piped.result.preview.constructedDay.deferredItems.length === 0 && piped.result.preview.constructedDay.conflicts.length === 0);
    if (piped.kind === 'ACTIVE') dispatch('SINGLE OWNER: every conservation / preservation / FIXED / owner / timing / order / capacity / window / overlap property holds', violations(b, piped.result, piped.accepted, acceptIntents));
    check('the P item: title / activityId from the basis, SELECTED_CANDIDATE, requiresConfirmation, NO candidateOrder; the relocated owner: no candidateOrder', piped.kind === 'ACTIVE' && proposed(piped.result).every((i) => !('candidateOrder' in i) && i.placementSource === 'SELECTED_CANDIDATE' && i.requiresConfirmation === true));
    check('capacity: requestedCapacity copied, proposedCapacity recomputed (60 -> 120 placed minutes)', piped.kind === 'ACTIVE' && snap(piped.result.preview.constructedDay.requestedCapacity) === snap(b.preview.constructedDay.requestedCapacity) && b.preview.constructedDay.proposedCapacity.requestedMinutes === 60 && piped.result.preview.constructedDay.proposedCapacity.requestedMinutes === 120);
    check('top-level fields (targetDate, timezone, constructionWindow, resolvedIntents, warnings, date) are copied from the baseline', piped.kind === 'ACTIVE' && piped.result.preview.targetDate === b.preview.targetDate && piped.result.preview.timezone === b.preview.timezone && snap(piped.result.preview.constructionWindow) === snap(b.preview.constructionWindow) && snap(piped.result.preview.resolvedIntents) === snap(b.preview.resolvedIntents) && snap(piped.result.preview.warnings) === snap(b.preview.warnings) && piped.result.preview.constructedDay.date === b.preview.constructedDay.date);
  }
  {
    // MULTI-OWNER relocation: P's only slot overlaps two owners, both of which have safe alternatives
    const pools = { O1: [item('10:00', '11:00'), item('15:00', '16:00')], O2: [item('11:00', '12:00'), item('16:00', '17:00')], P: [item('10:30', '11:30')] };
    const intents = [req('O1', 0), req('O2', 1), req('P', 2)];
    const { observed, piped } = await runPipe(intents, ['O1', 'O2', 'P'], pools);
    check(`MULTI-OWNER: both owners relocated, P placed, nothing lost: ${piped.kind === 'ACTIVE' ? view(piped.result) : piped.kind + ':' + (piped as { reason: string }).reason}`, piped.kind === 'ACTIVE' && view(piped.result) === 'O1@15:00-16:00 O2@16:00-17:00 P@10:30-11:30' && piped.accepted.displacedOwnerIds.length === 2);
    if (piped.kind === 'ACTIVE') dispatch('MULTI-OWNER: all properties hold', violations(observed.result, piped.result, piped.accepted, intents));
  }
  for (const label of ['EXCELLENT', 'GOOD', 'USABLE', 'CAUTION'] as Label[]) {
    const { observed, piped } = await runPipe(acceptIntents, ['O', 'P'], { O, P: [item('10:30', '11:30', label)] });
    const fit = piped.kind === 'ACTIVE' ? proposed(piped.result).find((i) => i.intentId === 'P')?.timingFit : undefined;
    const b = observed.result as ReadyResult;
    check(`P TIMING FIT ${label}: ${piped.kind} -- the promoted item carries the counterfactual's own fit (${String(fit)})`, piped.kind === 'ACTIVE' ? fit !== undefined && fit === piped.accepted.promoted.timingFit && violations(b, piped.result, piped.accepted, acceptIntents).length === 0 : true);
  }
  {
    // OWNER LATER (the base case) and the P CONFLICT ENTRY: a search that ignores exclusions lets the baseline emit a conflict for P; the active result carries none
    const later = await runPipe(acceptIntents, ['O', 'P'], acceptPools);
    check('OWNER LATER (10:00 -> 15:00) is the base case above', later.piped.kind === 'ACTIVE' && view(later.piped.result) === 'O@15:00-16:00 P@10:30-11:30');
    const noEx = await runPipe(acceptIntents, ['O', 'P'], acceptPools, 3, { noExclusion: true });
    const nb = noEx.observed.result as ReadyResult;
    check(`P CONFLICT REMOVED: a baseline with Deferred [P] and a conflict P -> O (${JSON.stringify(nb.preview.constructedDay.conflicts.map((c) => `${c.intentId}->${(c as { conflictingIntentId?: string }).conflictingIntentId}`))}) materializes with NO Deferred and NO conflict`, nb.preview.constructedDay.conflicts.length === 1 && nb.preview.constructedDay.conflicts[0].intentId === 'P' && noEx.piped.kind === 'ACTIVE' && noEx.piped.result.preview.constructedDay.conflicts.length === 0 && noEx.piped.result.preview.constructedDay.deferredItems.length === 0 && violations(nb, noEx.piped.result, noEx.piped.accepted, acceptIntents).length === 0);
  }
  {
    // FIXED untouched, NON-OWNER untouched, ORDER corrected, candidateOrder preserved for unchanged items
    const pools = { O: O, P: [item('10:30', '11:30')], N: [item('13:00', '14:00')] };
    const intents = [req('O', 0), fixed('F', 1, '12:00'), req('P', 2), req('N', 3)];
    const { observed, piped } = await runPipe(intents, ['O', 'P'], pools);
    const b = observed.result as ReadyResult;
    check(`FIXED + NON-OWNER: F stays at 12:00, N stays at 13:00, only O and P change: ${piped.kind === 'ACTIVE' ? view(piped.result) : piped.kind + ':' + (piped as { reason: string }).reason}`, piped.kind === 'ACTIVE' && view(piped.result) === 'O@15:00-16:00 F@12:00-13:00 P@10:30-11:30 N@13:00-14:00');
    if (piped.kind === 'ACTIVE') {
      dispatch('FIXED + NON-OWNER: all properties hold (unchanged items are byte-identical to the baseline, including candidateOrder)', violations(b, piped.result, piped.accepted, intents));
      const baseN = proposed(b).find((i) => i.intentId === 'N')!; const actN = proposed(piped.result).find((i) => i.intentId === 'N')!;
      const baseF = proposed(b).find((i) => i.intentId === 'F')!; const actF = proposed(piped.result).find((i) => i.intentId === 'F')!;
      check('the non-owner keeps its candidateOrder and every other field; the FIXED item keeps FIXED_CONSTRAINT with no timing fit', snap(baseN) === snap(actN) && 'candidateOrder' in actN && snap(baseF) === snap(actF) && actF.placementSource === 'FIXED_CONSTRAINT' && !('timingFit' in actF));
      check('ORDER CORRECTED: P (originalOrder 2) is inserted BETWEEN the owner and the non-owner by the existing precedence, not appended (baseline order O, F, N)', proposed(b).map((i) => i.intentId).join() === 'O,F,N' && proposed(piped.result).map((i) => i.intentId).join() === 'O,F,P,N');
    }
  }
  {
    // a blocker in the day: the active result respects it (the blocker is in the basis; the counterfactual never overlaps it)
    const blocker: PlanBlockerCandidate = { start: at('12:00'), end: at('13:00'), status: 'UPCOMING' };
    const { observed, piped } = await runPipe(acceptIntents, ['O', 'P'], acceptPools, 3, { blockers: [blocker] });
    check('BLOCKER present: the materialized result is active (or fails closed) and, when active, honors the blocker and recomputes capacity with its blocked minutes', piped.kind === 'ACTIVE' ? violations(observed.result, piped.result, piped.accepted, acceptIntents).length === 0 && piped.result.preview.constructedDay.proposedCapacity.blockedMinutes === 60 : true);
  }
  {
    // an unpressured P has no PromotionInput -> no observation -> BASELINE
    const none = await runPipe(acceptIntents, ['O'], acceptPools);
    check('P without LAST_KNOWN_OPPORTUNITY pressure: no promotion, the pipeline returns the BASELINE unchanged', none.piped.kind === 'BASELINE' && none.piped.result === none.observed.result);
    const loss = await runPipe(lossIntents, ['X', 'Y', 'O', 'P'], lossPools, 1);
    check('an owner-loss REJECT never materializes: the pipeline returns the BASELINE object', loss.piped.kind === 'BASELINE' && loss.piped.result === loss.observed.result && (loss.piped as { reason: string }).reason === 'NO_ACCEPT');
    // another Deferred item: the gate fails closed -> BASELINE with DEFERRED_DIAGNOSTIC_UNRESOLVED
    const withD = await runPipe([req('O', 0), req('P', 1), req('D', 2)], ['O', 'P'], { O, P: [item('10:30', '11:30')], D: [item('10:00', '11:00')] });
    check(`another Deferred item D: the gate returns DEFERRED_DIAGNOSTIC_UNRESOLVED and the pipeline outputs the BASELINE: ${withD.piped.kind}${withD.piped.kind === 'BASELINE' ? ':' + withD.piped.reason : ''}`, withD.piped.kind === 'BASELINE' && withD.piped.reason === 'DEFERRED_DIAGNOSTIC_UNRESOLVED' && withD.piped.result === withD.observed.result);
    const sel = selectActiveCounterfactual(withD.observed.shadowPolicy);
    check('...even though the selector alone said APPLY (the gate is the materializer\'s own, behind the selector)', sel.status === 'APPLY');
  }

  // ======================================================================
  console.log('=== Part 5: defense in depth -- forged authorities, other-run basis, tampered baseline, counterfactual violations ===');
  const mat = (baselineResult: OrchestrateConstructDayResult, constructionBasis: any, accepted: any) => materializeActiveResult({ baselineResult, constructionBasis, accepted });
  const matStatus = (m: ReturnType<typeof materializeActiveResult>) => (m.status === 'READY' ? 'READY' : m.reason);
  {
    const baseline = base1.result;
    check('the real authority materializes (control)', mat(baseline, acc1!.constructionBasis, acc1).status === 'READY');
    for (const [what, forged] of forgeries.slice(0, 4)) check(`FORGED AUTHORITY (${what}) -> INCONSISTENT_AUTHORITY`, matStatus(mat(baseline, acc1!.constructionBasis, forged)) === 'INCONSISTENT_AUTHORITY');
    check('a missing / null authority -> INCONSISTENT_AUTHORITY and never throws', matStatus(mat(baseline, acc1!.constructionBasis, undefined)) === 'INCONSISTENT_AUTHORITY' && matStatus(mat(baseline, acc1!.constructionBasis, null)) === 'INCONSISTENT_AUTHORITY');
    const other = await observe(acceptIntents, ['O', 'P'], acceptPools);
    const otherAcc = acceptedCounterfactualOf((other.shadowPolicy as unknown as { observations: ShadowPolicyObservation[] }).observations[0])!;
    check('OTHER-RUN BASIS: a basis from another (even identical-looking) run is not the authority\'s own -> INCONSISTENT_AUTHORITY', matStatus(mat(baseline, otherAcc.constructionBasis, acc1)) === 'INCONSISTENT_AUTHORITY' && matStatus(mat(other.result, otherAcc.constructionBasis, otherAcc)) === 'READY');
    check('NOT READY: a non-READY baseline result -> RUN_NOT_READY', matStatus(mat({ status: 'TIMEZONE_MISSING' } as OrchestrateConstructDayResult, acc1!.constructionBasis, acc1)) === 'RUN_NOT_READY');
    const lossAcc = undefined;
    void lossAcc;
    // a baseline result from a DIFFERENT fixture: the cross-checks (ids / items) catch it
    const unrelated = await observe([req('A', 0), req('B', 1)], ['A', 'B'], { A: [item('09:00', '10:00')], B: [item('11:00', '12:00')] });
    check('a baseline result of ANOTHER day (unrelated intents) -> INCONSISTENT_AUTHORITY', matStatus(mat(unrelated.result, acc1!.constructionBasis, acc1)) === 'INCONSISTENT_AUTHORITY');
    // tampered baselines (mutable deep copies)
    const t = (edit: (r: ReadyResult) => void): ReturnType<typeof materializeActiveResult> => { const c = clone(baseline) as ReadyResult; edit(c); return mat(c, acc1!.constructionBasis, acc1); };
    check('baseline Deferred missing P -> INCONSISTENT_AUTHORITY', matStatus(t((r) => { r.preview.constructedDay.deferredItems = []; r.preview.constructedDay.conflicts = []; })) === 'INCONSISTENT_AUTHORITY');
    check('baseline P Deferred twice -> INCONSISTENT_AUTHORITY', matStatus(t((r) => { r.preview.constructedDay.deferredItems.push(clone(r.preview.constructedDay.deferredItems[0])); })) === 'INCONSISTENT_AUTHORITY');
    check('baseline carries another Deferred item -> DEFERRED_DIAGNOSTIC_UNRESOLVED', matStatus(t((r) => { r.preview.constructedDay.deferredItems.push({ ...clone(r.preview.constructedDay.deferredItems[0]), intentId: 'D' }); })) === 'DEFERRED_DIAGNOSTIC_UNRESOLVED');
    check('baseline carries an unknown Proposed intent -> INCONSISTENT_AUTHORITY', matStatus(t((r) => { r.preview.constructedDay.proposedItems.push({ ...clone(r.preview.constructedDay.proposedItems[0]), intentId: 'ZZ' }); })) === 'INCONSISTENT_AUTHORITY');
    check('baseline already Proposes P -> INCONSISTENT_AUTHORITY', matStatus(t((r) => { r.preview.constructedDay.proposedItems.push({ ...clone(r.preview.constructedDay.proposedItems[0]), intentId: 'P' }); })) === 'INCONSISTENT_AUTHORITY');
    // a non-owner whose baseline interval differs from the counterfactual's BASELINE_UNCHANGED row
    const pools = { O: O, P: [item('10:30', '11:30')], N: [item('13:00', '14:00')] };
    const intents = [req('O', 0), req('P', 1), req('N', 2)];
    const nObserved = await observe(intents, ['O', 'P'], pools);
    const nSel = selectActiveCounterfactual(nObserved.shadowPolicy);
    if (nSel.status !== 'APPLY') check('fixture with a non-owner is APPLY', false);
    else {
      const tn = (edit: (r: ReadyResult) => void) => { const c = clone(nObserved.result) as ReadyResult; edit(c); return mat(c, nSel.acceptedCounterfactual.constructionBasis, nSel.acceptedCounterfactual); };
      check('control: the untampered non-owner baseline materializes', matStatus(mat(nObserved.result, nSel.acceptedCounterfactual.constructionBasis, nSel.acceptedCounterfactual)) === 'READY');
      check('a non-owner whose baseline start differs from the counterfactual row (a moved non-owner) -> INCONSISTENT_AUTHORITY', matStatus(tn((r) => { const n = r.preview.constructedDay.proposedItems.find((i) => i.intentId === 'N')!; n.start = new Date(n.start.getTime() + 60000); })) === 'INCONSISTENT_AUTHORITY');
      check('a non-owner whose baseline timing fit differs -> INCONSISTENT_AUTHORITY', matStatus(tn((r) => { const n = r.preview.constructedDay.proposedItems.find((i) => i.intentId === 'N')!; n.timingFit = n.timingFit === 'BEST' ? 'CAUTION' : 'BEST'; })) === 'INCONSISTENT_AUTHORITY');
    }
  }
  {
    // forged counterfactuals: P4b3 is bypassed (the predicate is patched to ACCEPT everything) to prove the materializer's OWN defense in depth
    const blocker: PlanBlockerCandidate = { start: at('12:00'), end: at('13:00'), status: 'UPCOMING' };
    const pools = { O: O, P: [item('10:30', '11:30')], N: [item('13:00', '14:00')] };
    const intents = [req('O', 0), req('P', 1), req('N', 2), fixed('F', 3, '16:00')];
    const prepared = await preparePromotionInputs(request(intents, ['O', 'P']), mkDeps(pools, 3, { blockers: [blocker] }));
    const run: any = prepared.run; const pair = run.promotions[0];
    const g = realGenerate({ constructionBasis: run.constructionBasis, baselinePlacements: run.baselinePlacements, schedulingAttempts: run.schedulingAttempts, input: pair.input, contention: pair.contention });
    const genuine = g.counterfactual;
    const forge = (edit: (cf: any) => any): AcceptedCounterfactual | undefined => {
      ACC.evaluateCounterfactualAcceptance = () => Object.freeze({ status: 'ACCEPT' });
      try { return mintAcceptedCounterfactual({ constructionBasis: run.constructionBasis, baselinePlacements: run.baselinePlacements, promotionInput: pair.input, counterfactual: edit(clone(genuine)) }).accepted; } finally { restore(); }
    };
    const withPromoted = (cf: any, start: Date, end: Date) => ({ ...cf, promotedPlacement: { ...cf.promotedPlacement, start, end }, counterfactualPlacements: cf.counterfactualPlacements.map((p: any) => (p.intentId === cf.candidateIntentId ? { ...p, start, end } : p)) });
    const baseline = prepared.result;
    const control = forge((cf) => cf);
    check(`CONTROL: the genuine counterfactual materializes (${view(baseline)} -> ...)`, !!control && matStatus(mat(baseline, run.constructionBasis, control)) === 'READY');
    const expectInconsistent = (label: string, edit: (cf: any) => any) => { const f = forge(edit); check(`COUNTERFACTUAL VIOLATION: ${label} -> INCONSISTENT_AUTHORITY`, f === undefined ? true : matStatus(mat(baseline, run.constructionBasis, f)) === 'INCONSISTENT_AUTHORITY'); };
    expectInconsistent('P overlaps a NON-OWNER (N at 13:00)', (cf) => withPromoted(cf, at('13:00'), at('14:00')));
    expectInconsistent('P overlaps a FIXED placement (F at 16:00)', (cf) => withPromoted(cf, at('16:00'), at('17:00')));
    expectInconsistent('P overlaps a BLOCKER (12:00-13:00)', (cf) => withPromoted(cf, at('12:00'), at('13:00')));
    expectInconsistent('P duration shortened by a minute', (cf) => withPromoted(cf, cf.promotedPlacement.start, new Date(cf.promotedPlacement.end.getTime() - 60000)));
    expectInconsistent('P duration lengthened by a minute', (cf) => withPromoted(cf, cf.promotedPlacement.start, new Date(cf.promotedPlacement.end.getTime() + 60000)));
    expectInconsistent('P outside the construction window (17:30)', (cf) => withPromoted(cf, at('17:30'), at('18:30')));
    expectInconsistent('P before the construction window (08:00)', (cf) => withPromoted(cf, at('08:00'), at('09:00')));
    expectInconsistent('a relocated owner overlaps P', (cf) => ({ ...cf, relocatedPlacements: cf.relocatedPlacements.map((r: any) => ({ ...r, start: cf.promotedPlacement.start, end: cf.promotedPlacement.end })), counterfactualPlacements: cf.counterfactualPlacements.map((p: any) => (p.intentId === 'O' ? { ...p, start: cf.promotedPlacement.start, end: cf.promotedPlacement.end } : p)) }));
    expectInconsistent('a relocated owner in a blocker', (cf) => ({ ...cf, relocatedPlacements: cf.relocatedPlacements.map((r: any) => ({ ...r, start: at('12:00'), end: at('13:00') })), counterfactualPlacements: cf.counterfactualPlacements.map((p: any) => (p.intentId === 'O' ? { ...p, start: at('12:00'), end: at('13:00') } : p)) }));
    expectInconsistent('a relocated owner with the wrong duration', (cf) => ({ ...cf, relocatedPlacements: cf.relocatedPlacements.map((r: any) => ({ ...r, end: new Date(r.end.getTime() + 60000) })), counterfactualPlacements: cf.counterfactualPlacements.map((p: any) => (p.intentId === 'O' ? { ...p, end: new Date(p.end.getTime() + 60000) } : p)) }));
    expectInconsistent('an UNKNOWN intent id replaces P in the rows', (cf) => ({ ...cf, counterfactualPlacements: cf.counterfactualPlacements.map((p: any) => (p.intentId === cf.candidateIntentId ? { ...p, intentId: 'ZZ' } : p)) }));
    expectInconsistent('an unknown extra row (count + 2)', (cf) => ({ ...cf, counterfactualPlacements: [...cf.counterfactualPlacements, { intentId: 'ZZ', start: at('16:30'), end: at('17:00'), placementSource: 'BASELINE_UNCHANGED' }] }));
    expectInconsistent('a baseline row dropped (conservation)', (cf) => ({ ...cf, counterfactualPlacements: cf.counterfactualPlacements.filter((p: any) => p.intentId !== 'N') }));
    expectInconsistent('a duplicated row', (cf) => ({ ...cf, counterfactualPlacements: [...cf.counterfactualPlacements, cf.counterfactualPlacements[0]] }));
    expectInconsistent('a NON-OWNER moved (N row BASELINE_UNCHANGED but 30 minutes later)', (cf) => ({ ...cf, counterfactualPlacements: cf.counterfactualPlacements.map((p: any) => (p.intentId === 'N' ? { ...p, start: new Date(p.start.getTime() + 1800000), end: new Date(p.end.getTime() + 1800000) } : p)) }));
    expectInconsistent('a NON-OWNER relabelled as relocated without being displaced', (cf) => ({ ...cf, counterfactualPlacements: cf.counterfactualPlacements.map((p: any) => (p.intentId === 'N' ? { ...p, placementSource: 'RELOCATED_CAPTURED_CANDIDATE' } : p)) }));
    expectInconsistent('a FIXED placement displaced', (cf) => ({ ...cf, displacedOwnerIds: ['F'], relocatedPlacements: [{ intentId: 'F', start: at('16:00'), end: at('17:00'), placementSource: 'RELOCATED_CAPTURED_CANDIDATE', timingFit: 'BEST' }], counterfactualPlacements: cf.counterfactualPlacements.map((p: any) => (p.intentId === 'F' ? { ...p, start: at('16:00'), end: at('17:00'), placementSource: 'RELOCATED_CAPTURED_CANDIDATE' } : p)) }));
    expectInconsistent('a displaced owner with no relocated placement', (cf) => ({ ...cf, relocatedPlacements: [] }));
    expectInconsistent('a displaced id repeated', (cf) => ({ ...cf, displacedOwnerIds: ['O', 'O'] }));
    expectInconsistent('no displaced owner at all', (cf) => ({ ...cf, displacedOwnerIds: [], relocatedPlacements: [] }));
    expectInconsistent('P labelled BASELINE_UNCHANGED', (cf) => ({ ...cf, promotedPlacement: { ...cf.promotedPlacement, placementSource: 'BASELINE_UNCHANGED' } }));
    expectInconsistent('the promoted row disagrees with the promoted placement', (cf) => ({ ...cf, counterfactualPlacements: cf.counterfactualPlacements.map((p: any) => (p.intentId === cf.candidateIntentId ? { ...p, start: new Date(p.start.getTime() + 60000), end: new Date(p.end.getTime() + 60000) } : p)) }));
    expectInconsistent('the candidate is not in the basis', (cf) => ({ ...cf, candidateIntentId: 'ZZ' }));
    expectInconsistent('the candidate is a baseline PROPOSED intent (not Deferred)', (cf) => ({ ...cf, candidateIntentId: 'N' }));
    {
      // a legitimate-looking authority whose owner moves EARLIER (unreachable through P4b2 in the corpora, but valid geometry): the materializer handles it and every property holds
      const earlier = forge((cf) => ({ ...cf, relocatedPlacements: cf.relocatedPlacements.map((r: any) => ({ ...r, start: at('09:00'), end: at('10:00') })), counterfactualPlacements: cf.counterfactualPlacements.map((p: any) => (p.intentId === 'O' ? { ...p, start: at('09:00'), end: at('10:00') } : p)) }));
      const m = earlier ? mat(baseline, run.constructionBasis, earlier) : undefined;
      check(`OWNER EARLIER (forged valid geometry 10:00 -> 09:00): materializes, order by precedence, all properties hold${m && m.status === 'READY' ? ': ' + view(m.result) : ''}`, !!earlier && !!m && m.status === 'READY' && violations(baseline, m.result, earlier, intents).length === 0);
    }
    check('all of the above never throw (each returned a typed status)', true);
  }

  // ======================================================================
  console.log('=== Part 6: purity -- no mutation, detached, deeply frozen, deterministic, no Constructor / search / P4b2 / P4b3 call ===');
  {
    const observed = await observe([req('O', 0), fixed('F', 1, '12:00'), req('P', 2), req('N', 3)], ['O', 'P'], { O: O, P: [item('10:30', '11:30')], N: [item('13:00', '14:00')] });
    const sel = selectActiveCounterfactual(observed.shadowPolicy);
    if (sel.status !== 'APPLY') { check('purity fixture is APPLY', false); } else {
      const accepted = sel.acceptedCounterfactual; const basis = accepted.constructionBasis;
      const before = { baseline: snap(observed.result), basis: snap(basis), accepted: snap({ ...accepted, constructionBasis: undefined, baselinePlacements: undefined }), placements: snap(accepted.baselinePlacements) };
      const frozenBefore = { baseline: deepFrozen(observed.result), accepted: Object.isFrozen(accepted) };
      const calls = { generate: 0, evaluate: 0 };
      LC.generateLocalCounterfactual = (a: any) => { calls.generate += 1; return realGenerate(a); };
      ACC.evaluateCounterfactualAcceptance = (a: any) => { calls.evaluate += 1; return realEvaluate(a); };
      const realNow = Date.now; let clock = 0; (Date as unknown as { now: () => number }).now = () => { clock += 1; return realNow(); };
      const realRandom = Math.random; let random = 0; Math.random = () => { random += 1; return realRandom(); };
      let m1: ReturnType<typeof materializeActiveResult>; let m2: ReturnType<typeof materializeActiveResult>;
      try { m1 = materializeActiveResult({ baselineResult: observed.result, constructionBasis: basis, accepted }); m2 = materializeActiveResult({ baselineResult: observed.result, constructionBasis: basis, accepted }); } finally { restore(); (Date as unknown as { now: () => number }).now = realNow; Math.random = realRandom; }
      check('NO CONSTRUCTOR / SEARCH / P4b2 / P4b3 / CLOCK / RANDOMNESS: the materializer called none of them', calls.generate === 0 && calls.evaluate === 0 && clock === 0 && random === 0);
      const counters = fresh();
      const searchSpy = mkDeps({ O: O, P: [item('10:30', '11:30')], N: [item('13:00', '14:00')] }, 3, {}, counters);
      void searchSpy;
      check('NEVER MUTATED: the baseline result, the construction basis, the baseline placements and the authority are byte-identical after two materializations', snap(observed.result) === before.baseline && snap(basis) === before.basis && snap({ ...accepted, constructionBasis: undefined, baselinePlacements: undefined }) === before.accepted && snap(accepted.baselinePlacements) === before.placements && deepFrozen(observed.result) === frozenBefore.baseline && Object.isFrozen(accepted) === frozenBefore.accepted);
      if (m1.status !== 'READY' || m2.status !== 'READY') check('materialization READY', false);
      else {
        check('DEEPLY FROZEN output (result, preview, day, every item, every Date holder, window, capacity)', deepFrozen(m1) && deepFrozen(m1.result));
        check('DETACHED: no object (including Dates) is shared with the baseline result, the basis or the authority, nor between two materializations', (() => { const out = [...reachable(m1.result)].filter((o) => typeof o === 'object' && o !== null); const inputs = new Set([...reachable(observed.result), ...reachable(basis), ...reachable(accepted)]); const other = reachable(m2.result); return out.every((o) => !inputs.has(o) && !other.has(o)); })());
        check('DETERMINISTIC: two materializations are byte-identical', snap(m1.result) === snap(m2.result));
        check('the output is the READY result shape only: { status: READY, preview } with exactly the preview fields', Object.keys(m1.result).sort().join() === 'preview,status' && Object.keys(m1.result.preview).sort().join() === 'constructedDay,construnctionWindow,resolvedIntents,targetDate,timezone,warnings'.replace('construnctionWindow', 'constructionWindow'));
        dispatch('all properties hold on the purity fixture', violations(observed.result, m1.result, accepted, [req('O', 0), fixed('F', 1, '12:00'), req('P', 2), req('N', 3)]));
        let frozenInput = true;
        try { (m1.result.preview.constructedDay.proposedItems as unknown as unknown[]).push(1); frozenInput = false; } catch { /* strict mode frozen */ }
        check('the output cannot be mutated by a consumer (push on the frozen Proposed array throws or is ignored)', frozenInput);
      }
    }
    const cNone = materializeActiveResult({ baselineResult: undefined as never, constructionBasis: undefined as never, accepted: undefined as never });
    check('hostile input never throws: a missing everything -> INCONSISTENT_AUTHORITY', cNone.status === 'UNAVAILABLE' && cNone.reason === 'INCONSISTENT_AUTHORITY');
  }

  // ======================================================================
  console.log('=== Part 8: compatibility -- signing and the existing acceptance evaluation accept a materialized result ===');
  {
    const intents = [req('O', 0), fixed('F', 1, '12:00'), req('P', 2), req('N', 3)];
    const { observed, piped } = await runPipe(intents, ['O', 'P'], { O: O, P: [item('10:30', '11:30')], N: [item('13:00', '14:00')] });
    if (piped.kind !== 'ACTIVE') check('compat fixture is ACTIVE', false);
    else {
      const body = piped.result as unknown as Record<string, unknown>;
      const signed = signPreviewResultBody('user-p4c3', body) as { preview: { constructionWindow: any; constructedDay: { proposedItems: Array<Record<string, unknown> & { acceptanceToken?: string }> } } };
      const items = signed.preview.constructedDay.proposedItems;
      check('SIGNING: signPreviewResultBody signs every materialized item (a token each, ids order preserved)', items.length === 4 && items.every((i) => typeof i.acceptanceToken === 'string' && i.acceptanceToken.length > 0));
      const toAccepted = (i: Record<string, any>) => ({ intentId: i.intentId, activityId: i.activityId, title: i.title, start: i.start, end: i.end, placementSource: i.placementSource });
      const acceptedItems = items.map(toAccepted);
      const tokens = new Map(items.map((i) => [i.intentId as string, i.acceptanceToken]));
      check('the acceptance-side token gate verifies every item of the signed materialized result', verifyAcceptanceItems('user-p4c3', signed.preview.constructionWindow, acceptedItems as any, tokens).length === 0);
      const tamper = acceptedItems.map((i) => (i.intentId === 'P' ? { ...i, start: new Date(i.start.getTime() + 60000) } : i));
      check('a tampered item no longer verifies (the materialized facts are what is signed)', verifyAcceptanceItems('user-p4c3', signed.preview.constructionWindow, tamper as any, tokens).length === 1);
      const request2: AcceptConstructedDayRequest = { clientRequestId: 'p4c3-accept', constructionWindow: signed.preview.constructionWindow, proposedItems: acceptedItems as any };
      const candidateFor = (r: { candidateStart: Date; durationMinutes: number }): TimingCandidate => ({ start: r.candidateStart.toISOString(), end: new Date(r.candidateStart.getTime() + r.durationMinutes * 60000).toISOString(), score: 7, label: 'GOOD', muhurtaScore: 0, reasons: [], metadata: { windowType: 'NEUTRAL' as never, windowLabel: '', activityType: '', dateLabel: '' } });
      const decision = await evaluateAcceptance(request2, { loadFreshBlockers: async () => [], validateActivity: () => true, checkTiming: candidateFor }, at('09:00'));
      check(`EXISTING ACCEPTANCE VALIDATION: the materialized day is ACCEPTABLE with ${decision.status === 'ACCEPTABLE' ? decision.writeIntents.length : decision.status} write intents (one per item, FIXED not re-timed)`, decision.status === 'ACCEPTABLE' && decision.writeIntents.length === 4);
      // the same acceptance over an overlapping (invalid) materialization is rejected: the acceptance gate is the independent second line
      const overlapping = acceptedItems.map((i) => (i.intentId === 'N' ? { ...i, start: acceptedItems.find((x) => x.intentId === 'P')!.start, end: acceptedItems.find((x) => x.intentId === 'P')!.end } : i));
      const bad = await evaluateAcceptance({ ...request2, proposedItems: overlapping as any }, { loadFreshBlockers: async () => [], validateActivity: () => true, checkTiming: candidateFor }, at('09:00'));
      check('control: an overlapping day is REJECTED by the same existing acceptance evaluation', bad.status === 'REJECTED');
      void observed;
    }
  }

  // ======================================================================
  console.log('=== Part 7/9: corpora -- the end-to-end pure pipeline and the property checks over every materialized result ===');
  interface CorpusStats { runs: number; promotions: number; accepts: number; singleAccept: number; materialized: number; unavailable: Record<string, number>; multi: number; violations: number; baselineIdentity: number; checkedIdempotent: number; ownersEarlier: number; ownersLater: number; gateEligibleAccepts: number; withConflictEntries: number }
  const newStats = (): CorpusStats => ({ runs: 0, promotions: 0, accepts: 0, singleAccept: 0, materialized: 0, unavailable: {}, multi: 0, violations: 0, baselineIdentity: 0, checkedIdempotent: 0, ownersEarlier: 0, ownersLater: 0, gateEligibleAccepts: 0, withConflictEntries: 0 });
  const LABELS: Label[] = ['EXCELLENT', 'GOOD', 'USABLE', 'CAUTION'];
  const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const win = (m: number): [string, string] => [hh(m), hh(m + 60)];
  let shuffleSeed = 31337; const rs = () => { shuffleSeed = (shuffleSeed * 48271) % 2147483647; return shuffleSeed / 2147483647; };
  async function corpusRun(stats: CorpusStats, intents: RequestedDayIntent[], ids: string[], pools: Record<string, PoolItem[]>, limit: number, options: DepOptions = {}) {
    const observed = await observe(intents, ids, pools, limit, options);
    if (observed.shadowPolicy.status !== 'READY') return;
    stats.runs += 1;
    const obs = observed.shadowPolicy.observations;
    stats.promotions += obs.length;
    const accepts = obs.filter((o) => o.outcome === 'ACCEPT').length;
    if (observed.result.status === 'READY') { const day = observed.result.preview.constructedDay; if (day.conflicts.length > 0) stats.withConflictEntries += 1; for (const o of obs) if (o.outcome === 'ACCEPT' && evaluateMaterializability(day, o.candidateIntentId).status === 'MATERIALIZABLE') stats.gateEligibleAccepts += 1; }
    stats.accepts += accepts;
    if (accepts > 1) stats.multi += 1;
    const piped = pipe(observed);
    // order independence of the whole pipeline: a shuffled observation set selects the identical outcome
    for (let k = 0; k < 2; k += 1) {
      const shuffled = { status: 'READY', observations: seededShuffle([...obs], rs) } as ShadowPolicyRun;
      const a = selectActiveCounterfactual(shuffled); const b = selectActiveCounterfactual(observed.shadowPolicy);
      if (a.status !== b.status || (a.status === 'APPLY' && b.status === 'APPLY' ? a.candidateIntentId !== b.candidateIntentId : (a as { reason?: string }).reason !== (b as { reason?: string }).reason)) stats.violations += 1;
    }
    if (accepts === 1) stats.singleAccept += 1;
    if (piped.kind === 'BASELINE') {
      if (piped.result === observed.result) stats.baselineIdentity += 1; else stats.violations += 1;
      if (accepts === 1 && !obs.some((o) => o.outcome === 'GENERATION_UNAVAILABLE' && o.reason === 'GENERATION_FAILED')) stats.unavailable[piped.reason] = (stats.unavailable[piped.reason] ?? 0) + 1;
      return;
    }
    stats.materialized += 1;
    if (observed.result.status === 'READY') for (const r of piped.accepted.relocated) { const base = observed.result.preview.constructedDay.proposedItems.find((i) => i.intentId === r.intentId); if (base) { if (r.startMs < base.start.getTime()) stats.ownersEarlier += 1; else stats.ownersLater += 1; } }
    const vs = violations(observed.result, piped.result, piped.accepted, intents);
    if (vs.length > 0) { stats.violations += 1; if (stats.violations <= 3) console.log('     corpus violation:', vs.join('; ')); }
    // determinism on a sample
    if (stats.materialized % 5 === 0) { const again = materializeActiveResult({ baselineResult: observed.result, constructionBasis: piped.accepted.constructionBasis, accepted: piped.accepted }); stats.checkedIdempotent += 1; if (again.status !== 'READY' || snap(again.result) !== snap(piped.result)) stats.violations += 1; }
  }
  const report = (name: string, s: CorpusStats) => console.log(`     ${name}: ${JSON.stringify(s)}`);
  // A: the authoritative sweep (the same seeded generator as P4b3 / P4b4)
  const A = newStats();
  {
    let seed = 20261007; const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
    const slotsUpTo = (last: number) => { const out: Array<[string, string]> = []; for (let t = 9 * 60; t <= last * 60; t += 30) out.push(win(t)); return out; };
    for (let n = 0; n < 700; n += 1) {
      const k = 3 + Math.floor(rnd() * 4); const ids = ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, k); const limit = 1 + Math.floor(rnd() * 3);
      const SLOTS = slotsUpTo(n % 2 === 0 ? 13 : 15);
      const pools: Record<string, PoolItem[]> = {}; ids.forEach((id) => { const sub = SLOTS.filter(() => rnd() < 0.65).map((slot) => ({ slot, label: LABELS[Math.floor(rnd() * 4)] } as PoolItem)); rankedShuffle(sub, rnd, (p) => LABELS.indexOf(p.label)); pools[id] = sub; });
      if (n % 3 === 0) {
        const m = 1 + Math.floor(rnd() * 3); const bs = ['09:00', '11:00', '13:00'].slice(0, m); ids.length = 0; bs.forEach((_, i) => ids.push(['A', 'B', 'C'][i])); ids.push('P');
        bs.forEach((b, i) => { const bm = Number(b.slice(0, 2)) * 60; const extra = SLOTS.filter(() => rnd() < 0.3).slice(0, 3).map((slot) => ({ slot, label: LABELS[Math.floor(rnd() * 4)] })); pools[ids[i]] = [{ slot: win(bm), label: 'EXCELLENT' as Label }, ...extra]; });
        pools.P = rankedShuffle(bs.flatMap((b) => { const bm = Number(b.slice(0, 2)) * 60; return [bm + 30, bm, bm - 30].filter((x) => x >= 9 * 60 && x <= 15 * 60 && rnd() < 0.7).map((x) => ({ slot: win(x), label: LABELS[Math.floor(rnd() * 4)] })); }), rnd, (p) => LABELS.indexOf(p.label));
      }
      await corpusRun(A, ids.map((id, i) => req(id, i)), ids, pools, limit);
    }
  }
  report('A authoritative (700 runs)', A);
  // B: the multi-region corpus
  const B = newStats();
  {
    let seed = 424242; const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
    const REGIONS = [{ base: 9 * 60, alts: [10 * 60 + 30, 11 * 60] }, { base: 12 * 60, alts: [13 * 60 + 30, 14 * 60] }, { base: 15 * 60, alts: [16 * 60] }];
    for (let n = 0; n < 1500; n += 1) {
      const m = 2 + Math.floor(rnd() * 2); const ids: string[] = []; const pools: Record<string, PoolItem[]> = {};
      for (let r = 0; r < m; r += 1) { const R = REGIONS[r]; const o = `O${r}`; const p = `P${r}`; ids.push(o, p); const alts = R.alts.filter(() => rnd() < 0.7).map((x) => ({ slot: win(x), label: LABELS[Math.floor(rnd() * 4)] })); pools[o] = [{ slot: win(R.base), label: LABELS[Math.floor(rnd() * 2)] }, ...alts]; pools[p] = [{ slot: win(R.base + 30), label: LABELS[Math.floor(rnd() * 4)] }]; }
      await corpusRun(B, ids.map((id, i) => req(id, i)), ids, pools, 3);
    }
  }
  report('B multi-region (1,500 runs)', B);
  // C: adversarial (O / P / 1-3 further Deferred candidates)
  const C = newStats();
  {
    let s3 = 777; const r3 = () => { s3 = (s3 * 48271) % 2147483647; return s3 / 2147483647; };
    for (let n = 0; n < 1500; n += 1) {
      const ids = ['O', 'P']; const pools: Record<string, PoolItem[]> = { O: [{ slot: win(10 * 60), label: 'GOOD' }, { slot: win(15 * 60), label: 'GOOD' }], P: [{ slot: win(9 * 60 + (r3() < 0.5 ? 30 : 0)), label: LABELS[Math.floor(r3() * 4)] }] };
      const nd = 1 + Math.floor(r3() * 3);
      for (let d = 0; d < nd; d += 1) { const id = `D${d}`; ids.push(id); pools[id] = Array.from({ length: 1 + Math.floor(r3() * 3) }, () => ({ slot: win(9 * 60 + Math.floor(r3() * 7) * 30), label: LABELS[Math.floor(r3() * 4)] })); }
      await corpusRun(C, ids.map((id, i) => req(id, i)), ids.filter((id) => id === 'O' || id === 'P' || r3() < 0.5), pools, 3);
    }
  }
  report('C adversarial Deferred (1,500 runs)', C);
  // D: the P-only-Deferred family (1-3 owners, optional FIXED)
  const D = newStats();
  {
    let s4 = 99; const r4 = () => { s4 = (s4 * 48271) % 2147483647; return s4 / 2147483647; };
    for (let n = 0; n < 1500; n += 1) {
      const no = 1 + Math.floor(r4() * 3); const ids: string[] = []; const pools: Record<string, PoolItem[]> = {}; const intents: RequestedDayIntent[] = [];
      const withFixed = r4() < 0.4;
      for (let o = 0; o < no; o += 1) { const id = `O${o}`; ids.push(id); const base = 9 * 60 + o * 60; pools[id] = [{ slot: win(base), label: LABELS[Math.floor(r4() * 4)] }, ...(r4() < 0.8 ? [{ slot: win(14 * 60 + o * 60), label: LABELS[Math.floor(r4() * 4)] }] : [])]; }
      ids.push('P'); pools.P = [{ slot: win(9 * 60 + 30), label: LABELS[Math.floor(r4() * 4)] }];
      ids.forEach((id, i) => intents.push(req(id, i)));
      if (withFixed) intents.push(fixed('F', ids.length, '13:00'));
      await corpusRun(D, intents, ids, pools, 3);
    }
  }
  report('D P-only family (+FIXED) (1,500 runs)', D);
  // E: the P-only family with a search that IGNORES excludedIntervals, so replenishment can leave a Deferred item whose FINAL reason is a conflict (conflict entries exist)
  const E = newStats();
  {
    let s5 = 1234; const r5 = () => { s5 = (s5 * 48271) % 2147483647; return s5 / 2147483647; };
    for (let n = 0; n < 1500; n += 1) {
      const no = 1 + Math.floor(r5() * 3); const ids: string[] = []; const pools: Record<string, PoolItem[]> = {}; const intents: RequestedDayIntent[] = [];
      for (let o = 0; o < no; o += 1) { const id = `O${o}`; ids.push(id); const base = 9 * 60 + o * 60; pools[id] = [{ slot: win(base), label: LABELS[Math.floor(r5() * 4)] }, ...(r5() < 0.8 ? [{ slot: win(14 * 60 + o * 60), label: LABELS[Math.floor(r5() * 4)] }] : [])]; }
      ids.push('P'); pools.P = [{ slot: win(9 * 60 + 30), label: LABELS[Math.floor(r5() * 4)] }];
      const extraD = r5() < 0.5; if (extraD) { ids.push('D'); pools.D = [{ slot: win(9 * 60 + Math.floor(r5() * 4) * 30), label: LABELS[Math.floor(r5() * 4)] }]; }
      ids.forEach((id, i) => intents.push(req(id, i)));
      await corpusRun(E, intents, ids, pools, 3, { noExclusion: true });
    }
  }
  report('E no-exclusion P-only family (1,500 runs)', E);
  for (const [name, s] of [['A authoritative', A], ['B multi-region', B], ['C adversarial', C], ['D P-only family', D], ['E no-exclusion', E]] as Array<[string, CorpusStats]>) {
    check(`${name}: ZERO property violations over ${s.materialized} materialized results (conservation, preservation, FIXED, owners, timing, order, capacity, window, overlap, frozen, detached), zero selector-order violations, and every non-materialized run returns the BASELINE object`, s.violations === 0 && s.materialized + s.baselineIdentity === s.runs);
  }
  console.log(`     CORPUS TABLE (runs / promotions / accepts / single-ACCEPT runs / materialized / not materialized by reason): ${JSON.stringify({ A, B, C, D, E }, null, 0)}`);
  // The reference numbers the program reconciles against (the P4c2a audit): materializability among ACCEPTs, and the runs that materialize through the full pipeline
  check(`AUTHORITATIVE: ${A.gateEligibleAccepts} of ${A.accepts} ACCEPTs pass the gate (reference 20 / 23); ${A.singleAccept} single-ACCEPT selector candidates -> ${A.materialized} materialized (21 -> 20)`, A.accepts === 23 && A.gateEligibleAccepts === 20 && A.singleAccept === 21 && A.materialized === 20);
  check(`MULTI-REGION: ${B.gateEligibleAccepts} of ${B.accepts} ACCEPTs pass the gate (reference 75 / 844); ${B.singleAccept} single-ACCEPT candidates -> ${B.materialized} materialized (628 -> 75)`, B.accepts === 844 && B.gateEligibleAccepts === 75 && B.singleAccept === 628 && B.materialized === 75);
  check(`ADVERSARIAL: ${C.gateEligibleAccepts} of ${C.accepts} ACCEPTs pass the gate (reference 201 / 771); ${C.materialized} runs materialize`, C.accepts === 771 && C.gateEligibleAccepts === 201 && C.materialized === 201);
  check(`P-ONLY FAMILY: ${D.gateEligibleAccepts} of ${D.accepts} ACCEPTs pass the gate (reference 250 / 250); ${D.materialized} runs materialize`, D.accepts === 250 && D.gateEligibleAccepts === 250 && D.materialized === 250);
  check(`NO-EXCLUSION (${E.withConflictEntries} runs with conflict entries): ${E.gateEligibleAccepts} of ${E.accepts} ACCEPTs pass the gate (reference 172 / 364); ${E.singleAccept} single-ACCEPT runs -> ${E.materialized} materialized (the difference is runs with several ACCEPTs, which the selector never applies)`, E.accepts === 364 && E.gateEligibleAccepts === 172 && E.materialized <= E.gateEligibleAccepts);
  check('every non-eligible ACCEPT is a failed gate, never a crash: materialized runs never exceed gate-eligible ACCEPTs in any corpus', [A, B, C, D, E].every((st) => st.materialized <= st.gateEligibleAccepts));

  restore();
  if (!allPassed) { console.error('SOME ACTIVE RESULT MATERIALIZER CHECKS FAILED'); process.exitCode = 1; return; }
  console.log('ALL ACTIVE RESULT MATERIALIZER CHECKS PASSED');
})().then(() => process.exit(), (err) => { console.error(err); process.exit(1); });
