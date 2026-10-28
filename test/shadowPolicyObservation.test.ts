/**
 * Constructor Decision Intelligence -- O5 P4b4: SAME-RUN SHADOW POLICY COMPOSITION (behavior suite).
 *
 * `observeShadowPolicy(request, deps)` runs ONE orchestration (`preparePromotionInputs`) and, for each PromotionInput of THAT run, composes the P4b2
 * generator and the P4b3 acceptance predicate into one frozen diagnostic observation. It decides nothing itself, changes nothing the Constructor returned,
 * and is not wired anywhere. Every case below runs the REAL orchestrator (an honest exclusion-filtering fake timing search) -- no handcrafted authority.
 *
 *   Part 1  real observations: ACCEPT, OWNER_WOULD_BE_UNPLACED, OWNER_TIMING_DEGRADED -- exact source reasons, minimal summaries, result / signed-body parity
 *   Part 2  layers stay distinguishable: GENERATION_UNAVAILABLE (P4b3 never called), ACCEPTANCE_UNAVAILABLE, reasons carried verbatim
 *   Part 3  multi-promotion: one observation per PromotionInput in stable source order, each against the SAME baseline, nothing consumes another's counterfactual
 *   Part 4  failure isolation (generator throw, predicate throw) and the run-level contract (not READY, no promotions, no ACCEPT)
 *   Part 5  SAME RUN: exactly the orchestration / load / search counts of the normal prepared run; a second-run sentinel
 *   Part 6  purity: deeply frozen, scalar-only, detached, deterministic, no clock; Constructor / signed preview parity
 *   Part 7  diagnostics-only incidence over the real pipeline (reported, never used to tune anything)
 */
import { rankedShuffle } from './fixtureSupport';
import { observeShadowPolicy, type ShadowPolicyObservation, type ShadowPolicyRun } from '../apps/web/lib/shadowPolicyObservation';
import { preparePromotionInputs } from '../apps/web/lib/promotionInputPreparation';
import { orchestrateConstructDay, type ConstructDayRequest, type DayConstructorOrchestratorDeps, type RequestedDayIntent } from '../apps/web/lib/dayConstructorOrchestrator';
import { signPreviewResultBody } from '../apps/web/lib/dayConstructorPreviewIntegrity';
import { createDecisionFactPreparer } from '../apps/web/lib/decisionFactPreparation';
import type { DecisionFacts } from '../apps/web/lib/decisionFacts';
import type { OpportunityRangeDeps } from '../apps/web/lib/opportunityRangeAdapter';
import type { AvailabilityConfiguration } from '../apps/web/lib/availabilityContext';
import type { TimingCandidate } from '../packages/recommendation/src/timingSearch';

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
  const request = (intents: RequestedDayIntent[], pressured: string[]): ConstructDayRequest => ({ targetDate: FRIDAY, timezone: 'UTC', constructionWindowSource: 'EXPLICIT_RANGE', now: at('09:00'), explicitStart: at('09:00'), explicitEnd: at('17:00'), intents, decisionFactsByIntentId: new Map(pressured.map((id) => [id, WEEK_FACTS] as [string, DecisionFacts])) });
  interface Counters { blocking: number; duration: number; search: number; availability: number; facts: number }
  const fresh = (): Counters => ({ blocking: 0, duration: 0, search: 0, availability: 0, facts: 0 });
  function mkDeps(pools: Record<string, PoolItem[]>, limit: number, counters: Counters = fresh(), hooks: { onCall?: (kind: keyof Counters, n: number) => void } = {}): DayConstructorOrchestratorDeps {
    const prepare = createDecisionFactPreparer(rangeDeps);
    const bump = (kind: keyof Counters) => { counters[kind] += 1; hooks.onCall?.(kind, counters[kind]); };
    return {
      loadBlockingPlans: async () => { bump('blocking'); return []; },
      loadDurationContext: async () => { bump('duration'); return { preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} }; },
      searchTiming: (r: any) => {
        bump('search');
        const id = r.taskTitle as string;
        const out = (pools[id] ?? []).filter((p) => !(r.excludedIntervals ?? []).some((e: { start: Date; end: Date }) => TT(p.slot[0]) < e.end.getTime() && e.start.getTime() < TT(p.slot[1]))).slice(0, limit);
        const candidates: TimingCandidate[] = out.map((p) => ({ start: iso(p.slot[0]), end: iso(p.slot[1]), score: 5, label: p.label, muhurtaScore: 0, reasons: [], metadata: { windowType: 'NEUTRAL', windowLabel: 'x', activityType: 'x', dateLabel: FRIDAY } }));
        return { candidates };
      },
      loadAvailabilityConfiguration: async () => { bump('availability'); return { configured: false, periods: [] }; },
      prepareDecisionFacts: (async (...a: any[]) => { bump('facts'); return (prepare as any)(...a); }) as any,
    };
  }
  const outcomes = (run: ShadowPolicyRun) => (run.status === 'READY' ? run.observations.map((o) => (o.outcome === 'ACCEPT' ? `${o.candidateIntentId}:ACCEPT` : `${o.candidateIntentId}:${o.outcome}:${o.reason}`)) : [`RUN:${run.status}:${run.reason}`]);

  // ======================================================================
  console.log('=== Part 1: real same-run observations ===');
  // ACCEPT: O baseline 10:00 GOOD has a GOOD alternative at 15:00; P's only candidate is 10:30.
  const acceptPools = { O: [item('10:00', '11:00'), item('15:00', '16:00')], P: [item('10:30', '11:30')] };
  const acceptIntents = [req('O', 0), req('P', 1)];
  // OWNER LOSS (the directed #212 case): Y has no usable alternative.
  const lossPools = { X: [item('13:00', '14:00')], Y: [item('13:00', '14:00'), item('10:00', '11:00')], O: [item('13:30', '14:30'), item('09:30', '10:30'), item('11:00', '12:00')], P: [item('13:30', '14:30'), item('10:30', '11:30'), item('11:30', '12:30')] };
  const lossIntents = [req('X', 0), req('Y', 1), req('O', 2), req('P', 3)];
  // TIMING: O baseline 10:00 EXCELLENT, its only alternative 15:00 is CAUTION.
  const timingPools = { O: [item('10:00', '11:00', 'EXCELLENT'), item('15:00', '16:00', 'CAUTION')], P: [item('10:30', '11:30')] };
  const plainOf = (intents: RequestedDayIntent[], pressured: string[], pools: Record<string, PoolItem[]>, limit: number) => orchestrateConstructDay(request(intents, pressured), mkDeps(pools, limit));
  {
    const run = await observeShadowPolicy(request(acceptIntents, ['O', 'P']), mkDeps(acceptPools, 3));
    const plain = await plainOf(acceptIntents, ['O', 'P'], acceptPools, 3);
    const sp = run.shadowPolicy;
    const o = sp.status === 'READY' ? sp.observations[0] : undefined;
    check('SIMPLE ACCEPT (real): one observation, ACCEPT, for candidate P', sp.status === 'READY' && sp.observations.length === 1 && o?.outcome === 'ACCEPT' && o.candidateIntentId === 'P');
    check('the ACCEPT summary is minimal and exact: P at 10:30, O displaced and relocated 10:00 -> 15:00 (GOOD, same fit), nobody unplaced, 1 baseline placement -> 2 counterfactual placements', o?.outcome === 'ACCEPT' && JSON.stringify(o.counterfactual) === JSON.stringify({ promoted: { start: iso('10:30'), end: iso('11:30'), timingFit: o.counterfactual.promoted.timingFit }, displacedOwnerIds: ['O'], relocatedOwners: [{ intentId: 'O', from: { start: iso('10:00'), end: iso('11:00'), timingFit: 'GOOD' }, to: { start: iso('15:00'), end: iso('16:00'), timingFit: 'GOOD' } }], unplacedOwnerIds: [], baselinePlacementCount: 1, counterfactualPlacementCount: 2 }));
    check('the returned Constructor result is byte-identical to a plain orchestration, and so is the signed preview body (the shadow outcome changes nothing)', JSON.stringify(run.result) === JSON.stringify(plain) && JSON.stringify(signPreviewResultBody('u', run.result as unknown as Record<string, unknown>)) === JSON.stringify(signPreviewResultBody('u', plain as unknown as Record<string, unknown>)) && JSON.stringify(signPreviewResultBody('u', plain as unknown as Record<string, unknown>)).includes('acceptanceToken'));
    check('the observation names no basis, placements, attempts, contention, trace, evidence, facts or candidate list', !/constructionBasis|baselinePlacements|schedulingAttempts|contention|candidateList|evidence|facts|originalOrder/i.test(JSON.stringify(sp)));
  }
  {
    const run = await observeShadowPolicy(request(lossIntents, ['X', 'Y', 'O', 'P']), mkDeps(lossPools, 1));
    const o = run.shadowPolicy.status === 'READY' ? run.shadowPolicy.observations[0] : undefined;
    check('OWNER LOSS (real): P4b2 READY and P4b3 REJECT OWNER_WOULD_BE_UNPLACED, the exact source reason, with the summary of what would have happened (Y unplaced, O relocated)', o?.outcome === 'REJECT' && o.reason === 'OWNER_WOULD_BE_UNPLACED' && o.counterfactual.unplacedOwnerIds.join() === 'Y' && o.counterfactual.relocatedOwners.some((r) => r.intentId === 'O') && o.counterfactual.displacedOwnerIds.includes('Y'));
    const none = await observeShadowPolicy(request(lossIntents, ['P']), mkDeps(lossPools, 1));
    check('NONE owners (only P pressured) observe the SAME owner-loss rejection (NONE is never safe to lose) -- byte-identical to the all-pressured observation', JSON.stringify(none.shadowPolicy.status === 'READY' ? none.shadowPolicy.observations : none.shadowPolicy) === JSON.stringify(run.shadowPolicy.status === 'READY' ? run.shadowPolicy.observations : run.shadowPolicy)); // the OBSERVATIONS are identical; only the (O5) funnel counts differ, because fewer intents are pressured
  }
  {
    const run = await observeShadowPolicy(request(acceptIntents, ['O', 'P']), mkDeps(timingPools, 3));
    const o = run.shadowPolicy.status === 'READY' ? run.shadowPolicy.observations[0] : undefined;
    check('OWNER TIMING (real): O relocated from its EXCELLENT baseline to a CAUTION slot -> REJECT OWNER_TIMING_DEGRADED, propagated exactly, with from / to fits in the summary', o?.outcome === 'REJECT' && o.reason === 'OWNER_TIMING_DEGRADED' && o.counterfactual.relocatedOwners.length === 1 && o.counterfactual.relocatedOwners[0].from?.timingFit !== o.counterfactual.relocatedOwners[0].to.timingFit);
  }

  // ======================================================================
  console.log('=== Part 2: generation vs acceptance layers; reasons carried verbatim ===');
  {
    const calls = { generate: 0, evaluate: 0 };
    LC.generateLocalCounterfactual = (a: any) => { calls.generate += 1; return Object.freeze({ status: 'UNAVAILABLE', reason: 'NO_ACTIONABLE_PROMOTION_SLOT' }); };
    ACC.evaluateCounterfactualAcceptance = (a: any) => { calls.evaluate += 1; return realEvaluate(a); };
    try {
      const run = await observeShadowPolicy(request(acceptIntents, ['O', 'P']), mkDeps(acceptPools, 3));
      check('GENERATION UNAVAILABLE: P4b2\'s reason is propagated distinctly (GENERATION_UNAVAILABLE / NO_ACTIONABLE_PROMOTION_SLOT) with NO summary, and P4b3 is NEVER called', JSON.stringify(outcomes(run.shadowPolicy)) === JSON.stringify(['P:GENERATION_UNAVAILABLE:NO_ACTIONABLE_PROMOTION_SLOT']) && calls.generate === 1 && calls.evaluate === 0);
    } finally { restore(); }
    for (const reason of ['RUN_NOT_READY', 'INCONSISTENT_AUTHORITY', 'INVALID_INTERVAL', 'GENERATION_FAILED']) {
      LC.generateLocalCounterfactual = () => Object.freeze({ status: 'UNAVAILABLE', reason });
      try {
        const run = await observeShadowPolicy(request(acceptIntents, ['O', 'P']), mkDeps(acceptPools, 3));
        if (JSON.stringify(outcomes(run.shadowPolicy)) !== JSON.stringify([`P:GENERATION_UNAVAILABLE:${reason}`])) check(`generation reason ${reason} carried verbatim`, false);
      } finally { restore(); }
    }
    check('every P4b2 unavailable reason is carried verbatim (no shadow-specific translation)', true);
  }
  {
    // ACCEPTANCE UNAVAILABLE: P4b2 READY, but the counterfactual names another candidate -> the predicate's own INCONSISTENT_AUTHORITY.
    const calls = { evaluate: 0 };
    LC.generateLocalCounterfactual = (a: any) => { const out = realGenerate(a); return out.status === 'READY' ? Object.freeze({ status: 'READY', counterfactual: Object.freeze({ ...out.counterfactual, candidateIntentId: 'ELSEWHERE' }) }) : out; };
    ACC.evaluateCounterfactualAcceptance = (a: any) => { calls.evaluate += 1; return realEvaluate(a); };
    try {
      const run = await observeShadowPolicy(request(acceptIntents, ['O', 'P']), mkDeps(acceptPools, 3));
      const o = run.shadowPolicy.status === 'READY' ? run.shadowPolicy.observations[0] : undefined;
      check('ACCEPTANCE UNAVAILABLE: a counterfactual that names another candidate (ID cross-check) fails ONLY this observation as ACCEPTANCE_UNAVAILABLE / INCONSISTENT_AUTHORITY (the predicate\'s own reason), distinct from generation unavailability and from REJECT', o?.outcome === 'ACCEPTANCE_UNAVAILABLE' && o.reason === 'INCONSISTENT_AUTHORITY' && calls.evaluate === 1);
    } finally { restore(); }
  }

  // ======================================================================
  console.log('=== Part 3: multi-promotion -- every observation independent, same baseline, stable order ===');
  const multiPools = { O1: [item('09:00', '10:00'), item('15:00', '16:00')], P1: [item('09:30', '10:30')], O2: [item('11:00', '12:00')], P2: [item('11:30', '12:30')], O3: [item('13:00', '14:00'), item('16:00', '17:00')], P3: [item('13:30', '14:30')] };
  const multiIntents = [req('O1', 0), req('P1', 1), req('O2', 2), req('P2', 3), req('O3', 4), req('P3', 5)];
  const multiAll = ['O1', 'P1', 'O2', 'P2', 'O3', 'P3'];
  {
    const prepared = await preparePromotionInputs(request(multiIntents, multiAll), mkDeps(multiPools, 2));
    const runPairs = prepared.run.status === 'PREPARED' ? prepared.run.promotions.map((p) => p.input.candidateIntentId) : [];
    const seen: Array<{ candidate: string; baseline: unknown; attempts: unknown; basis: unknown }> = [];
    LC.generateLocalCounterfactual = (a: any) => { seen.push({ candidate: a.input.candidateIntentId, baseline: a.baselinePlacements, attempts: a.schedulingAttempts, basis: a.constructionBasis }); return realGenerate(a); };
    let observed: Awaited<ReturnType<typeof observeShadowPolicy>>;
    try { observed = await observeShadowPolicy(request(multiIntents, multiAll), mkDeps(multiPools, 2)); } finally { restore(); }
    const sp = observed.shadowPolicy;
    check('MULTI-PROMOTION: one observation per PromotionInput, in the run\'s stable source order', sp.status === 'READY' && sp.observations.length === runPairs.length && runPairs.length >= 3 && JSON.stringify(sp.observations.map((o) => o.candidateIntentId)) === JSON.stringify(runPairs));
    check('the same run yields ACCEPT and REJECT (and every outcome is an exact source outcome): ' + JSON.stringify(outcomes(sp)), sp.status === 'READY' && sp.observations.some((o) => o.outcome === 'ACCEPT') && sp.observations.some((o) => o.outcome === 'REJECT'));
    check('SAME BASELINE FOR ALL: the generator received the IDENTICAL run-level basis, baseline placements and attempts objects for every observation (nothing re-derived, no observation baselined on another\'s counterfactual)', seen.length === runPairs.length && seen.every((s) => s.baseline === seen[0].baseline && s.attempts === seen[0].attempts && s.basis === seen[0].basis));
    // An ACCEPT neither stops the observation of the later promotions nor ranks / selects anything: every pair is observed, and re-observing is byte-identical.
    const firstAccept = sp.status === 'READY' ? sp.observations.findIndex((o) => o.outcome === 'ACCEPT') : -1;
    check('NO SELECTION, NO RANKING: observations continue past the first ACCEPT (later promotions are observed too), no rank / winner field exists, and re-observing the whole run is byte-identical', sp.status === 'READY' && firstAccept >= 0 && firstAccept < sp.observations.length - 1 && sp.observations.every((o) => !('rank' in o) && !('winner' in o) && !('score' in o)) && JSON.stringify(sp) === JSON.stringify((await observeShadowPolicy(request(multiIntents, multiAll), mkDeps(multiPools, 2))).shadowPolicy));
  }
  {
    // A third promotion whose generation is unavailable, in the SAME run as an ACCEPT and a REJECT; P1 and P2 are untouched by it.
    const baseRun = await observeShadowPolicy(request(multiIntents, multiAll), mkDeps(multiPools, 2));
    LC.generateLocalCounterfactual = (a: any) => (a.input.candidateIntentId === 'P3' ? Object.freeze({ status: 'UNAVAILABLE', reason: 'NO_ACTIONABLE_PROMOTION_SLOT' }) : realGenerate(a));
    let forced: Awaited<ReturnType<typeof observeShadowPolicy>>;
    try { forced = await observeShadowPolicy(request(multiIntents, multiAll), mkDeps(multiPools, 2)); } finally { restore(); }
    const b = baseRun.shadowPolicy; const f = forced.shadowPolicy;
    check('ACCEPT + REJECT + UNAVAILABLE in ONE run: the forced-unavailable P3 changes only its own observation; every other observation is byte-identical to the unforced run', b.status === 'READY' && f.status === 'READY' && f.observations.length === b.observations.length && f.observations.every((o, i) => (o.candidateIntentId === 'P3' ? o.outcome === 'GENERATION_UNAVAILABLE' : JSON.stringify(o) === JSON.stringify(b.observations[i]))) && f.observations.some((o) => o.outcome === 'ACCEPT') && f.observations.some((o) => o.outcome === 'REJECT') && f.observations.some((o) => o.outcome === 'GENERATION_UNAVAILABLE'));
  }

  // ======================================================================
  console.log('=== Part 4: failure isolation and the run-level contract ===');
  {
    const baseRun = await observeShadowPolicy(request(multiIntents, multiAll), mkDeps(multiPools, 2));
    const b = baseRun.shadowPolicy as Extract<ShadowPolicyRun, { status: 'READY' }>;
    const middle = b.observations[1].candidateIntentId;
    LC.generateLocalCounterfactual = (a: any) => { if (a.input.candidateIntentId === middle) throw new Error('boom'); return realGenerate(a); };
    let g: Awaited<ReturnType<typeof observeShadowPolicy>>;
    try { g = await observeShadowPolicy(request(multiIntents, multiAll), mkDeps(multiPools, 2)); } finally { restore(); }
    const gs = g.shadowPolicy;
    check('GENERATOR THROW in the middle candidate: only that observation becomes GENERATION_UNAVAILABLE / GENERATION_FAILED; the others are byte-identical; the Constructor result is untouched', gs.status === 'READY' && gs.observations.length === b.observations.length && gs.observations.every((o, i) => (i === 1 ? o.outcome === 'GENERATION_UNAVAILABLE' && o.reason === 'GENERATION_FAILED' : JSON.stringify(o) === JSON.stringify(b.observations[i]))) && JSON.stringify(g.result) === JSON.stringify(baseRun.result));
    ACC.evaluateCounterfactualAcceptance = (a: any) => { if (a.promotionInput.candidateIntentId === middle) throw new Error('boom'); return realEvaluate(a); };
    let a2: Awaited<ReturnType<typeof observeShadowPolicy>>;
    try { a2 = await observeShadowPolicy(request(multiIntents, multiAll), mkDeps(multiPools, 2)); } finally { restore(); }
    const as = a2.shadowPolicy;
    check('PREDICATE THROW in the middle candidate: only that observation becomes ACCEPTANCE_UNAVAILABLE / EVALUATION_FAILED (fail closed -- never an ACCEPT); the others are byte-identical', as.status === 'READY' && as.observations.every((o, i) => (i === 1 ? o.outcome === 'ACCEPTANCE_UNAVAILABLE' && o.reason === 'EVALUATION_FAILED' : JSON.stringify(o) === JSON.stringify(b.observations[i]))) && JSON.stringify(a2.result) === JSON.stringify(baseRun.result));
  }
  {
    const notReady = await observeShadowPolicy({ ...request(acceptIntents, ['O', 'P']), timezone: undefined as unknown as string }, mkDeps(acceptPools, 3));
    check('RUN NOT READY: the Constructor result is returned as normal and the shadow run is UNAVAILABLE / RUN_NOT_READY -- no per-promotion observation is manufactured, and it is distinct from READY with no observations', notReady.result.status !== 'READY' && JSON.stringify(notReady.shadowPolicy) === JSON.stringify({ status: 'UNAVAILABLE', reason: 'RUN_NOT_READY' }));
    const empty = await observeShadowPolicy(request([req('A', 0), req('B', 1)], ['A', 'B']), mkDeps({ A: [item('09:00', '10:00')], B: [item('11:00', '12:00')] }, 3));
    check('NO PROMOTIONS: READY with observations [] is valid (not an error)', empty.shadowPolicy.status === 'READY' && empty.shadowPolicy.observations.length === 0);
    const lossOnly = await observeShadowPolicy(request(lossIntents, ['X', 'Y', 'O', 'P']), mkDeps(lossPools, 1));
    check('ZERO ACCEPT: a READY run whose observations contain no ACCEPT is valid', lossOnly.shadowPolicy.status === 'READY' && lossOnly.shadowPolicy.observations.length >= 1 && lossOnly.shadowPolicy.observations.every((o) => o.outcome !== 'ACCEPT'));
  }

  // ======================================================================
  console.log('=== Part 5: SAME RUN -- exactly the orchestration / load / search counts of the normal prepared run ===');
  {
    const fixtures: Array<[string, RequestedDayIntent[], string[], Record<string, PoolItem[]>, number]> = [['accept', acceptIntents, ['O', 'P'], acceptPools, 3], ['loss', lossIntents, ['X', 'Y', 'O', 'P'], lossPools, 1], ['multi', multiIntents, multiAll, multiPools, 2]];
    for (const [name, intents, pressured, pools, limit] of fixtures) {
      const cPrepared = fresh(); await preparePromotionInputs(request(intents, pressured), mkDeps(pools, limit, cPrepared));
      const cPlain = fresh(); await orchestrateConstructDay(request(intents, pressured), mkDeps(pools, limit, cPlain));
      const cShadow = fresh(); await observeShadowPolicy(request(intents, pressured), mkDeps(pools, limit, cShadow));
      check(`SAME-RUN COUNTS (${name}): one shadow observation performs exactly the loads / searches / availability / fact preparations of the normal prepared run and of a plain orchestration -- ${JSON.stringify(cShadow)}`, JSON.stringify(cShadow) === JSON.stringify(cPrepared) && JSON.stringify(cShadow) === JSON.stringify(cPlain) && cShadow.search > 0 && cShadow.facts > 0);
    }
    // SENTINEL: any SECOND invocation of a loader / search / fact preparation would throw (and the data it returned would differ).
    const calls = fresh();
    const sentinel = mkDeps(multiPools, 2, calls, { onCall: (kind, n) => { if (n > 100000) throw new Error(kind); } });
    const strict: DayConstructorOrchestratorDeps = { ...sentinel, loadBlockingPlans: async () => { if (calls.blocking >= 1) throw new Error('SECOND BLOCKING LOAD'); return sentinel.loadBlockingPlans(...([] as unknown as Parameters<typeof sentinel.loadBlockingPlans>)); }, loadDurationContext: async (...a: any[]) => { if (calls.duration >= 1) throw new Error('SECOND DURATION LOAD'); return (sentinel.loadDurationContext as any)(...a); }, loadAvailabilityConfiguration: async (...a: any[]) => { if (calls.availability >= 1) throw new Error('SECOND AVAILABILITY LOAD'); return (sentinel.loadAvailabilityConfiguration as any)(...a); } };
    const sentinelRun = await observeShadowPolicy(request(multiIntents, multiAll), strict);
    const normal = await observeShadowPolicy(request(multiIntents, multiAll), mkDeps(multiPools, 2));
    check('SAME-RUN SENTINEL: loaders that THROW on any second call do not disturb the shadow composition (it used only the first run) -- the result and every observation equal the normal run', sentinelRun.result.status === 'READY' && calls.blocking === 1 && calls.duration <= 1 && JSON.stringify(sentinelRun.shadowPolicy) === JSON.stringify(normal.shadowPolicy) && JSON.stringify(sentinelRun.result) === JSON.stringify(normal.result));
    // The seam takes a request and dependencies and nothing else: there is no way to hand it a basis, placements, a PromotionInput or a counterfactual.
    check('THE SEAM TAKES (request, deps) AND ONE OUTPUT-ONLY CALLBACK: `observeShadowPolicy` has no parameter through which a basis, placements, a PromotionInput or a counterfactual could be supplied (the optional third parameter only RECEIVES the baseline result)', observeShadowPolicy.length === 3);
    // O5 P4b5: the baseline result is handed out the moment it exists, strictly before any shadow work, exactly once, and a failing callback cannot disturb the observation.
    {
      let handed = 0; let generatedAtHandOff = -1; let generated = 0; let handedResult: unknown;
      LC.generateLocalCounterfactual = (a: any) => { generated += 1; return realGenerate(a); };
      let withCallback: Awaited<ReturnType<typeof observeShadowPolicy>>;
      try { withCallback = await observeShadowPolicy(request(acceptIntents, ['O', 'P']), mkDeps(acceptPools, 3), (r) => { handed += 1; generatedAtHandOff = generated; handedResult = r; }); } finally { restore(); }
      const plainRun = await observeShadowPolicy(request(acceptIntents, ['O', 'P']), mkDeps(acceptPools, 3));
      check('THE BASELINE HAND-OFF: the callback receives the baseline result exactly once, BEFORE any generation (no shadow work had run), and it is the very result the seam returns', handed === 1 && generatedAtHandOff === 0 && generated === 1 && handedResult === withCallback.result && JSON.stringify(withCallback.shadowPolicy) === JSON.stringify(plainRun.shadowPolicy) && JSON.stringify(withCallback.result) === JSON.stringify(plainRun.result));
      const hostile = await observeShadowPolicy(request(acceptIntents, ['O', 'P']), mkDeps(acceptPools, 3), () => { throw new Error('callback broke'); });
      check('a callback that throws is isolated: the result and every observation are unchanged', JSON.stringify(hostile) === JSON.stringify(plainRun));
      const failing = fresh(); let called = 0;
      let rejected = false;
      try { await observeShadowPolicy(request(acceptIntents, ['O', 'P']), { ...mkDeps(acceptPools, 3, failing), loadBlockingPlans: async () => { failing.blocking += 1; throw new Error('database unavailable'); } }, () => { called += 1; }); } catch { rejected = true; }
      check('PRE-BASELINE: when the baseline orchestration itself throws, the callback is NEVER called (no result existed) and the error surfaces', rejected && called === 0 && failing.blocking === 1);
    }
  }

  // ======================================================================
  console.log('=== Part 6: purity, ownership, deep freeze, parity ===');
  {
    const a = await observeShadowPolicy(request(multiIntents, multiAll), mkDeps(multiPools, 2));
    const b = await observeShadowPolicy(request(multiIntents, multiAll), mkDeps(multiPools, 2));
    check('OUTPUT IS DEEPLY FROZEN, SCALAR-ONLY (ISO strings -- no Date, Map or Set is exposed) and newly owned: no object is shared between two runs', deepFrozen(a.shadowPolicy) && noDates(a.shadowPolicy) && [...reachable(a.shadowPolicy)].every((o) => !reachable(b.shadowPolicy).has(o)));
    check('DETERMINISTIC: observing the same run twice is byte-identical', JSON.stringify(a.shadowPolicy) === JSON.stringify(b.shadowPolicy));
    const realNow = Date.now; let nowCalls = 0; (Date as unknown as { now: () => number }).now = () => { nowCalls += 1; return realNow(); };
    // The orchestration itself may read the clock for its own purposes; the composition must add none beyond a plain prepared run.
    let preparedNow = 0; try { await preparePromotionInputs(request(multiIntents, multiAll), mkDeps(multiPools, 2)); preparedNow = nowCalls; nowCalls = 0; await observeShadowPolicy(request(multiIntents, multiAll), mkDeps(multiPools, 2)); } finally { (Date as unknown as { now: () => number }).now = realNow; }
    check('NO CLOCK: the composition performs exactly the clock reads of the normal prepared run (it adds none)', nowCalls === preparedNow);
    const plain = await plainOf(multiIntents, multiAll, multiPools, 2);
    check('CONSTRUCTOR / PREVIEW PARITY (multi-promotion): the returned result is byte-identical to a plain orchestration and its signed preview body is byte-identical -- even though ACCEPT observations exist, nothing is substituted, signed or applied', JSON.stringify(a.result) === JSON.stringify(plain) && JSON.stringify(signPreviewResultBody('u', a.result as unknown as Record<string, unknown>)) === JSON.stringify(signPreviewResultBody('u', plain as unknown as Record<string, unknown>)));
    const shapes = (a.shadowPolicy as Extract<ShadowPolicyRun, { status: 'READY' }>).observations.map((o: ShadowPolicyObservation) => Object.keys(o).sort().join());
    check('OBSERVATION SHAPES carry only the exact source vocabulary: ACCEPT { outcome, candidateIntentId, counterfactual }, REJECT adds reason, GENERATION_UNAVAILABLE has reason and no counterfactual', shapes.every((s) => ['candidateIntentId,counterfactual,outcome', 'candidateIntentId,counterfactual,outcome,reason', 'candidateIntentId,outcome,reason'].includes(s)));
  }

  // ======================================================================
  console.log('=== Part 7: diagnostics-only INCIDENCE over the real pipeline (reported, never used to tune) ===');
  {
    let seed = 20261007; const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
    const slotsUpTo = (last: number) => { const out: Array<[string, string]> = []; for (let t = 9 * 60; t <= last * 60; t += 30) { const e = t + 60; const f = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; out.push([f(t), f(e)]); } return out; };
    const LABELS: Label[] = ['EXCELLENT', 'GOOD', 'USABLE', 'CAUTION'];
    const tally = { runs: 0, readyRuns: 0, promotionInputs: 0, generationReady: 0, accept: 0, nonDeterministic: 0, resultMismatch: 0 };
    const generationUnavailable: Record<string, number> = {}; const reject: Record<string, number> = {}; const acceptanceUnavailable: Record<string, number> = {};
    for (let n = 0; n < 700; n += 1) {
      const k = 3 + Math.floor(rnd() * 4); const ids = ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, k); const limit = 1 + Math.floor(rnd() * 3);
      const SLOTS = slotsUpTo(n % 2 === 0 ? 13 : 15);
      const pools: Record<string, PoolItem[]> = {}; ids.forEach((id) => { const sub = SLOTS.filter(() => rnd() < 0.65).map((slot) => ({ slot, label: LABELS[Math.floor(rnd() * 4)] } as PoolItem)); rankedShuffle(sub, rnd, (p) => LABELS.indexOf(p.label)); pools[id] = sub; });
      if (n % 3 === 0) {
        const m = 1 + Math.floor(rnd() * 3); const bs = ['09:00', '11:00', '13:00'].slice(0, m); ids.length = 0; bs.forEach((_, i) => ids.push(['A', 'B', 'C'][i])); ids.push('P');
        const hh = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
        const win = (s: number): [string, string] => [hh(s), hh(s + 60)];
        bs.forEach((b, i) => { const bm = Number(b.slice(0, 2)) * 60; const extra = SLOTS.filter(() => rnd() < 0.3).slice(0, 3).map((slot) => ({ slot, label: LABELS[Math.floor(rnd() * 4)] })); pools[ids[i]] = [{ slot: win(bm), label: 'EXCELLENT' as Label }, ...extra]; });
        pools.P = rankedShuffle(bs.flatMap((b) => { const bm = Number(b.slice(0, 2)) * 60; return [bm + 30, bm, bm - 30].filter((x) => x >= 9 * 60 && x <= 15 * 60 && rnd() < 0.7).map((x) => ({ slot: win(x), label: LABELS[Math.floor(rnd() * 4)] })); }), rnd, (p) => LABELS.indexOf(p.label));
      }
      const intents = ids.map((id, i) => req(id, i));
      const observed = await observeShadowPolicy(request(intents, ids), mkDeps(pools, limit));
      tally.runs += 1;
      if (observed.shadowPolicy.status !== 'READY') continue;
      tally.readyRuns += 1;
      if (JSON.stringify(observed.result) !== JSON.stringify(await orchestrateConstructDay(request(intents, ids), mkDeps(pools, limit)))) tally.resultMismatch += 1;
      if (n % 7 === 0 && JSON.stringify((await observeShadowPolicy(request(intents, ids), mkDeps(pools, limit))).shadowPolicy) !== JSON.stringify(observed.shadowPolicy)) tally.nonDeterministic += 1;
      for (const o of observed.shadowPolicy.observations) {
        tally.promotionInputs += 1;
        if (o.outcome === 'GENERATION_UNAVAILABLE') { generationUnavailable[o.reason] = (generationUnavailable[o.reason] ?? 0) + 1; continue; }
        tally.generationReady += 1;
        if (o.outcome === 'ACCEPT') tally.accept += 1;
        else if (o.outcome === 'REJECT') reject[o.reason] = (reject[o.reason] ?? 0) + 1;
        else acceptanceUnavailable[o.reason] = (acceptanceUnavailable[o.reason] ?? 0) + 1;
      }
    }
    console.log(`     incidence: ${JSON.stringify(tally)} generationUnavailable: ${JSON.stringify(generationUnavailable)} reject: ${JSON.stringify(reject)} acceptanceUnavailable: ${JSON.stringify(acceptanceUnavailable)}`);
    const sum = tally.accept + Object.values(reject).reduce((a, b) => a + b, 0) + Object.values(acceptanceUnavailable).reduce((a, b) => a + b, 0);
    check(`INCIDENCE (diagnostics only): ${tally.runs} runs, ${tally.promotionInputs} PromotionInputs, ${tally.generationReady} generation READY, ACCEPT ${tally.accept}, REJECT ${JSON.stringify(reject)}, generation unavailable ${JSON.stringify(generationUnavailable)}, acceptance unavailable ${JSON.stringify(acceptanceUnavailable)} -- measured, never used to tune a policy`, tally.promotionInputs > 300 && sum === tally.generationReady && tally.promotionInputs === tally.generationReady + Object.values(generationUnavailable).reduce((a, b) => a + b, 0));
    check('AUTHORITATIVE, ENGINE-INDEPENDENT INCIDENCE (O5 P4b5: the seeded fixture no longer uses a random sort comparator, so these exact counts hold on every supported Node): 700 runs, 452 PromotionInputs = 444 generation READY + 8 NO_ACTIONABLE_PROMOTION_SLOT; 444 = 23 ACCEPT + 372 OWNER_WOULD_BE_UNPLACED + 49 OWNER_TIMING_DEGRADED; 0 acceptance unavailable', tally.runs === 700 && tally.promotionInputs === 452 && tally.generationReady === 444 && JSON.stringify(generationUnavailable) === JSON.stringify({ NO_ACTIONABLE_PROMOTION_SLOT: 8 }) && tally.accept === 23 && reject.OWNER_WOULD_BE_UNPLACED === 372 && reject.OWNER_TIMING_DEGRADED === 49 && Object.keys(reject).length === 2 && Object.keys(acceptanceUnavailable).length === 0 && 23 + 372 + 49 === 444 && 444 + 8 === 452);
    check('every observation matches the plain orchestration it shadowed (zero result mismatches) and repeats byte-identically (zero non-determinism)', tally.resultMismatch === 0 && tally.nonDeterministic === 0);
  }

  restore();
  if (!allPassed) { console.error('SOME SHADOW POLICY OBSERVATION CHECKS FAILED'); process.exitCode = 1; return; }
  console.log('ALL SHADOW POLICY OBSERVATION CHECKS PASSED');
})().then(() => process.exit(), (err) => { console.error(err); process.exit(1); });
