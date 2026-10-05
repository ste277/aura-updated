/**
 * Constructor Decision Intelligence -- O5 P4b5: the SHADOW EXECUTION & OBSERVATION BOUNDARY (behavior suite).
 *
 * Everything runs through the REAL production sequence `handleDayConstructorPreviewRequest` (session -> user -> body -> clock -> orchestrator deps ->
 * preview -> signing) with an honest exclusion-filtering fake timing search, so "the baseline response" is the real signed preview body.
 *
 *   Part 1  mode parsing: OFF is the default; exactly SHADOW selects SHADOW; unknown / ACTIVE / client input is OFF
 *   Part 2  OFF: zero shadow work (a throwing composer is never reached), byte-identical to pre-P4b5, no sink call
 *   Part 3  SHADOW parity: ACCEPT / REJECT / generation unavailable / acceptance unavailable / multi-promotion -> the same status, body and signature as OFF
 *   Part 4  failure isolation: composer throw, sink throw, timer throw, baseline failure -- Plan Day is unchanged
 *   Part 5  ONE orchestration: identical load / search counts for OFF and SHADOW (a table), one sink call, no background work
 *   Part 6  minimal observation: exact metrics schema, no identifier / text / instant / placement; response, headers and body never carry the shadow
 *   Part 7  latency evidence (informational) and the default server sink
 */
import { handleDayConstructorPreviewRequest, parseConstructDayPreviewRequestBody, type DayConstructorPreviewBoundaryDeps, type DayConstructorPreviewHttpResult } from '../apps/web/lib/dayConstructorPreviewRequest';
import { createServerShadowPolicyExecution, parseShadowPolicyMode, serverLogShadowPolicySink, SHADOW_POLICY_MODE_ENV, summarizeShadowPolicyRun, type ShadowPolicyExecution, type ShadowPolicyMetrics } from '../apps/web/lib/shadowPolicyExecution';
import { observeShadowPolicy } from '../apps/web/lib/shadowPolicyObservation';
import type { DayConstructorOrchestratorDeps } from '../apps/web/lib/dayConstructorOrchestrator';
import { createDecisionFactPreparer } from '../apps/web/lib/decisionFactPreparation';
import type { DecisionFacts } from '../apps/web/lib/decisionFacts';
import type { OpportunityRangeDeps } from '../apps/web/lib/opportunityRangeAdapter';
import type { AvailabilityConfiguration } from '../apps/web/lib/availabilityContext';
import type { TimingCandidate } from '../packages/recommendation/src/timingSearch';
import type { User } from '../apps/web/lib/db';

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
  const USER = { id: 'user-1', timezone: 'UTC', email: 'someone@example.com' } as unknown as User;

  interface Counters { blocking: number; duration: number; search: number; availability: number; facts: number }
  const fresh = (): Counters => ({ blocking: 0, duration: 0, search: 0, availability: 0, facts: 0 });
  function mkDeps(pools: Record<string, PoolItem[]>, limit: number, counters: Counters = fresh(), failBlocking = false): DayConstructorOrchestratorDeps {
    const prepare = createDecisionFactPreparer(rangeDeps);
    return {
      loadBlockingPlans: async () => { counters.blocking += 1; if (failBlocking) throw new Error('database unavailable'); return []; },
      loadDurationContext: async () => { counters.duration += 1; return { preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} }; },
      searchTiming: (r: any) => {
        counters.search += 1;
        const id = r.taskTitle as string;
        const out = (pools[id] ?? []).filter((p) => !(r.excludedIntervals ?? []).some((e: { start: Date; end: Date }) => TT(p.slot[0]) < e.end.getTime() && e.start.getTime() < TT(p.slot[1]))).slice(0, limit);
        const candidates: TimingCandidate[] = out.map((p) => ({ start: iso(p.slot[0]), end: iso(p.slot[1]), score: 5, label: p.label, muhurtaScore: 0, reasons: [], metadata: { windowType: 'NEUTRAL', windowLabel: 'x', activityType: 'x', dateLabel: FRIDAY } }));
        return { candidates };
      },
      loadAvailabilityConfiguration: async () => { counters.availability += 1; return { configured: false, periods: [] }; },
      prepareDecisionFacts: (async (...a: any[]) => { counters.facts += 1; return (prepare as any)(...a); }) as any,
    };
  }
  interface Scenario { name: string; ids: string[]; pressured: string[]; pools: Record<string, PoolItem[]>; limit: number }
  const SCENARIOS: Record<string, Scenario> = {
    accept: { name: 'accept', ids: ['O', 'P'], pressured: ['O', 'P'], pools: { O: [item('10:00', '11:00'), item('15:00', '16:00')], P: [item('10:30', '11:30')] }, limit: 3 },
    loss: { name: 'loss', ids: ['X', 'Y', 'O', 'P'], pressured: ['X', 'Y', 'O', 'P'], pools: { X: [item('13:00', '14:00')], Y: [item('13:00', '14:00'), item('10:00', '11:00')], O: [item('13:30', '14:30'), item('09:30', '10:30'), item('11:00', '12:00')], P: [item('13:30', '14:30'), item('10:30', '11:30'), item('11:30', '12:30')] }, limit: 1 },
    timing: { name: 'timing', ids: ['O', 'P'], pressured: ['O', 'P'], pools: { O: [item('10:00', '11:00', 'EXCELLENT'), item('15:00', '16:00', 'CAUTION')], P: [item('10:30', '11:30')] }, limit: 3 },
    multi: { name: 'multi', ids: ['O1', 'P1', 'O2', 'P2', 'O3', 'P3'], pressured: ['O1', 'P1', 'O2', 'P2', 'O3', 'P3'], pools: { O1: [item('09:00', '10:00'), item('15:00', '16:00')], P1: [item('09:30', '10:30')], O2: [item('11:00', '12:00')], P2: [item('11:30', '12:30')], O3: [item('13:00', '14:00'), item('16:00', '17:00')], P3: [item('13:30', '14:30')] }, limit: 2 },
    none: { name: 'none', ids: ['A', 'B'], pressured: ['A', 'B'], pools: { A: [item('09:00', '10:00')], B: [item('11:00', '12:00')] }, limit: 3 },
  };
  const bodyOf = (sc: Scenario, extra: Record<string, unknown> = {}) => ({ targetDate: FRIDAY, constructionWindowSource: 'EXPLICIT_RANGE', explicitStart: `${FRIDAY}T09:00:00.000Z`, explicitEnd: `${FRIDAY}T17:00:00.000Z`, intents: sc.ids.map((id) => ({ id, title: id, flexibility: 'FLEXIBLE', durationMinutes: 60 })), ...extra });
  const boundary = (sc: Scenario, execution: (() => ShadowPolicyExecution) | undefined, counters: Counters = fresh(), over: { body?: unknown; user?: User; failBlocking?: boolean; passShadowKey?: boolean } = {}): DayConstructorPreviewBoundaryDeps => ({
    getSession: () => ({ userId: 'user-1' }),
    getUser: async () => over.user ?? USER,
    getBody: async () => (over.body !== undefined ? over.body : bodyOf(sc)),
    now: () => at('09:00'),
    createOrchestratorDeps: () => mkDeps(sc.pools, sc.limit, counters, over.failBlocking === true),
    loadDecisionFacts: async () => new Map(sc.pressured.map((id) => [id, WEEK_FACTS] as [string, DecisionFacts])),
    ...(execution ? { shadowPolicy: execution } : {}),
  });
  const run = (sc: Scenario, execution: (() => ShadowPolicyExecution) | undefined, counters?: Counters, over?: Parameters<typeof boundary>[3]) => handleDayConstructorPreviewRequest(boundary(sc, execution, counters, over));
  const same = (a: DayConstructorPreviewHttpResult, b: DayConstructorPreviewHttpResult) => JSON.stringify(a) === JSON.stringify(b);
  const recorder = () => { const seen: ShadowPolicyMetrics[] = []; return { seen, sink: { record: (m: ShadowPolicyMetrics) => { seen.push(m); } } }; };
  const ON = (sink?: { record: (m: ShadowPolicyMetrics) => void }, extra: Partial<ShadowPolicyExecution> = {}) => (): ShadowPolicyExecution => ({ mode: 'SHADOW', sink, ...extra });

  // ======================================================================
  console.log('=== Part 1: mode parsing -- OFF by default, exactly SHADOW selects SHADOW ===');
  {
    const offs: unknown[] = [undefined, null, '', ' ', 'OFF', 'off', 'shadow', 'Shadow', 'ACTIVE', 'active', 'ON', 'true', '1', 'SHADOWS', 'SHADOW,ACTIVE', 'SHADOW ACTIVE', 123, true, {}, []];
    check('every missing, empty, misspelled, other-case, unknown or non-string value is OFF -- including ACTIVE (no such mode exists)', offs.every((v) => parseShadowPolicyMode(v) === 'OFF'));
    check('exactly SHADOW (surrounding whitespace ignored) selects SHADOW', parseShadowPolicyMode('SHADOW') === 'SHADOW' && parseShadowPolicyMode('  SHADOW\n') === 'SHADOW');
    const saved = process.env[SHADOW_POLICY_MODE_ENV];
    try {
      delete process.env[SHADOW_POLICY_MODE_ENV];
      const unset = createServerShadowPolicyExecution();
      process.env[SHADOW_POLICY_MODE_ENV] = 'SHADOW';
      const on = createServerShadowPolicyExecution();
      process.env[SHADOW_POLICY_MODE_ENV] = 'garbage';
      const bad = createServerShadowPolicyExecution();
      check('THE SERVER ENVIRONMENT IS THE ONLY SOURCE: unset -> OFF (the default), SHADOW -> SHADOW, garbage -> OFF; the default sink is the server log sink; no database is read', unset.mode === 'OFF' && on.mode === 'SHADOW' && bad.mode === 'OFF' && on.sink === serverLogShadowPolicySink && SHADOW_POLICY_MODE_ENV === 'AURA_SHADOW_POLICY_MODE');
    } finally { if (saved === undefined) delete process.env[SHADOW_POLICY_MODE_ENV]; else process.env[SHADOW_POLICY_MODE_ENV] = saved; }
  }
  {
    const sc = SCENARIOS.accept;
    const parsed = parseConstructDayPreviewRequestBody(bodyOf(sc, { shadowPolicyMode: 'SHADOW', shadowPolicy: 'SHADOW', mode: 'SHADOW', policyMode: 'ACTIVE', counterfactual: true, evaluateCounterfactual: true }), { timezone: 'UTC', now: at('09:00') });
    check('CLIENT INPUT CANNOT SELECT A MODE: a body carrying shadowPolicyMode / mode / policyMode ACTIVE / counterfactual flags parses to a request that contains none of them', parsed.ok && !/shadow|mode|policy|counterfactual/i.test(JSON.stringify(parsed.request)));
    let observed = 0; let generated = 0;
    LC.generateLocalCounterfactual = (x: any) => { generated += 1; return realGenerate(x); };
    let result: DayConstructorPreviewHttpResult;
    try { result = await run(sc, () => ({ mode: 'OFF', observe: async (...a) => { observed += 1; return observeShadowPolicy(...a); } }), undefined, { body: bodyOf(sc, { shadowPolicyMode: 'SHADOW', mode: 'SHADOW', policyMode: 'ACTIVE', shadowPolicy: { mode: 'SHADOW' }, shadowPolicyExecution: { mode: 'SHADOW' } }) }); } finally { restore(); }
    check('a request body asking for SHADOW / ACTIVE under a server OFF runs ZERO shadow work (no composer call, no generator call) and answers exactly the plain response', observed === 0 && generated === 0 && same(result, await run(sc, undefined)));
  }

  // ======================================================================
  console.log('=== Part 2: OFF -- zero shadow work, byte-identical to pre-P4b5 ===');
  {
    for (const key of Object.keys(SCENARIOS)) {
      const sc = SCENARIOS[key];
      const plain = await run(sc, undefined);
      let composer = 0; let sinkCalls = 0;
      const off = await run(sc, () => ({ mode: 'OFF', sink: { record: () => { sinkCalls += 1; } }, observe: async () => { composer += 1; throw new Error('the shadow composer must never be reached under OFF'); } }));
      if (!(same(plain, off) && composer === 0 && sinkCalls === 0 && plain.httpStatus === 200)) check(`OFF (${key}) is byte-identical`, false);
    }
    check('OFF (every scenario): a composer that THROWS IF CALLED is never invoked (count 0), no sink call, and the status, body and signature equal the response with no settings at all', true);
    const cPlain = fresh(); await run(SCENARIOS.multi, undefined, cPlain);
    const cOff = fresh(); await run(SCENARIOS.multi, () => ({ mode: 'OFF', sink: { record: () => undefined } }), cOff);
    check('OFF adds no load, search or preparation: the counters equal the response with no settings (shadow work, preparation and observation emission are all zero)', JSON.stringify(cPlain) === JSON.stringify(cOff));
  }

  // ======================================================================
  console.log('=== Part 3: SHADOW parity -- the baseline response is unchanged whatever the shadow decides ===');
  const metricsOf = async (sc: Scenario) => { const r = recorder(); const shadow = await run(sc, ON(r.sink)); return { shadow, plain: await run(sc, undefined), seen: r.seen }; };
  {
    const results: Record<string, Awaited<ReturnType<typeof metricsOf>>> = {};
    for (const key of ['accept', 'loss', 'timing', 'multi', 'none']) results[key] = await metricsOf(SCENARIOS[key]);
    for (const [key, r] of Object.entries(results)) check(`SHADOW parity (${key}): HTTP status, body (preview items, signed tokens) are byte-identical to OFF; exactly one metrics record was emitted`, same(r.shadow, r.plain) && r.shadow.httpStatus === 200 && r.seen.length === 1);
    const m = (k: string) => results[k].seen[0];
    check('SHADOW ACCEPT: one observation, ACCEPT counted -- and the response is still the plain baseline', m('accept').run === 'READY' && m('accept').observations === 1 && m('accept').generationReady === 1 && m('accept').accepted === 1 && JSON.stringify(m('accept').rejected) === '{}');
    check('SHADOW REJECT (owner loss): REJECT counted by its exact typed reason', m('loss').accepted === 0 && JSON.stringify(m('loss').rejected) === JSON.stringify({ OWNER_WOULD_BE_UNPLACED: 1 }));
    check('SHADOW REJECT (owner timing): REJECT counted by its exact typed reason', JSON.stringify(m('timing').rejected) === JSON.stringify({ OWNER_TIMING_DEGRADED: 1 }) && m('timing').accepted === 0);
    check('SHADOW MULTI-PROMOTION: all observations are counted (an ACCEPT does not stop or select anything) while the response is still ONE baseline', m('multi').observations >= 3 && m('multi').accepted >= 1 && Object.keys(m('multi').rejected).length >= 1 && m('multi').observations === m('multi').generationReady + Object.values(m('multi').generationUnavailable).reduce((a, b) => a + (b ?? 0), 0));
    check('SHADOW with NO PromotionInputs: a valid READY observation of zero (not an error)', m('none').run === 'READY' && m('none').observations === 0 && m('none').accepted === 0);
    const unready = await run(SCENARIOS.accept, ON(recorder().sink), undefined, { user: { ...USER, timezone: '' } as User });
    const unreadyPlain = await run(SCENARIOS.accept, undefined, undefined, { user: { ...USER, timezone: '' } as User });
    const ur = recorder(); await run(SCENARIOS.accept, ON(ur.sink), undefined, { user: { ...USER, timezone: '' } as User });
    check('SHADOW with a baseline run that is not READY: the response equals OFF, and only a run-level category (RUN_NOT_READY, no fabricated counts) is observed', same(unready, unreadyPlain) && ur.seen.length === 1 && ur.seen[0].run === 'RUN_NOT_READY' && ur.seen[0].observations === 0 && ur.seen[0].generationReady === 0);
  }
  {
    const r1 = recorder();
    LC.generateLocalCounterfactual = () => Object.freeze({ status: 'UNAVAILABLE', reason: 'NO_ACTIONABLE_PROMOTION_SLOT' });
    let gu: DayConstructorPreviewHttpResult;
    try { gu = await run(SCENARIOS.accept, ON(r1.sink)); } finally { restore(); }
    check('SHADOW GENERATION UNAVAILABLE: counted by its exact reason, no acceptance counts, response byte-identical to OFF', same(gu, await run(SCENARIOS.accept, undefined)) && JSON.stringify(r1.seen[0].generationUnavailable) === JSON.stringify({ NO_ACTIONABLE_PROMOTION_SLOT: 1 }) && r1.seen[0].generationReady === 0 && r1.seen[0].accepted === 0);
    const r2 = recorder();
    LC.generateLocalCounterfactual = (a: any) => { const out = realGenerate(a); return out.status === 'READY' ? Object.freeze({ status: 'READY', counterfactual: Object.freeze({ ...out.counterfactual, candidateIntentId: 'ELSEWHERE' }) }) : out; };
    let au: DayConstructorPreviewHttpResult;
    try { au = await run(SCENARIOS.accept, ON(r2.sink)); } finally { restore(); }
    check('SHADOW ACCEPTANCE UNAVAILABLE: counted by its exact reason (distinct from generation unavailable), response byte-identical to OFF', same(au, await run(SCENARIOS.accept, undefined)) && JSON.stringify(r2.seen[0].acceptanceUnavailable) === JSON.stringify({ INCONSISTENT_AUTHORITY: 1 }) && r2.seen[0].generationReady === 1 && JSON.stringify(r2.seen[0].generationUnavailable) === '{}');
  }

  // ======================================================================
  console.log('=== Part 4: failure isolation -- fail-open relative to Plan Day ===');
  {
    const plain = await run(SCENARIOS.multi, undefined);
    const rec = recorder();
    const thrown = await run(SCENARIOS.multi, ON(rec.sink, { observe: async () => { throw new Error('composer defect'); } }));
    check('SHADOW COMPOSER THROW: caught at the boundary; the status, body and signature equal OFF (the baseline is served); a generic TECHNICAL_FAILURE category -- with no error text -- is observed', same(thrown, plain) && rec.seen.length === 1 && rec.seen[0].run === 'TECHNICAL_FAILURE' && !/composer defect/.test(JSON.stringify(rec.seen)));
    let sinkCalls = 0;
    const sinkThrow = await run(SCENARIOS.multi, ON({ record: () => { sinkCalls += 1; throw new Error('sink down'); } }));
    check('SINK THROW: the baseline response is unchanged (the sink was reached once and its failure discarded)', same(sinkThrow, plain) && sinkCalls === 1);
    const hostileSink = await run(SCENARIOS.multi, () => ({ mode: 'SHADOW', get sink(): never { throw new Error('hostile settings'); } } as unknown as ShadowPolicyExecution));
    check('a settings object whose sink accessor throws is discarded too: the baseline response is unchanged', same(hostileSink, plain));
    const rec2 = recorder();
    const timerThrow = await run(SCENARIOS.multi, ON(rec2.sink, { monotonicNow: () => { throw new Error('clock broke'); } }));
    check('TIMER FAILURE cannot fail Plan Day: the response is unchanged and the latency is simply UNKNOWN', same(timerThrow, plain) && rec2.seen.length === 1 && rec2.seen[0].latency === 'UNKNOWN');
    const ticks = [0, 12]; const rec3 = recorder();
    await run(SCENARIOS.multi, ON(rec3.sink, { monotonicNow: () => ticks.shift() ?? 12 }));
    check('the latency bucket is a coarse category from the injected MONOTONIC source (observability only: the response is not a function of it)', rec3.seen[0].latency === 'LT_50_MS');
    // The baseline orchestration itself failing: SHADOW surfaces exactly the plain failure.
    const plainFail = await run(SCENARIOS.accept, undefined, fresh(), { failBlocking: true });
    const shadowFail = await run(SCENARIOS.accept, ON(recorder().sink), fresh(), { failBlocking: true });
    check('A BASELINE FAILURE is not a shadow failure: a database error inside the orchestration yields the SAME generic HTTP 500 body under SHADOW as under OFF (and nothing is observed as ACCEPT)', plainFail.httpStatus === 500 && same(plainFail, shadowFail));
    const cOffFail = fresh(); await run(SCENARIOS.accept, undefined, cOffFail, { failBlocking: true });
    const cShadowFail = fresh(); await run(SCENARIOS.accept, ON(recorder().sink), cShadowFail, { failBlocking: true });
    console.log(`     failure-path load counts (documented): OFF blocking=${cOffFail.blocking}, SHADOW blocking=${cShadowFail.blocking} (the fallback re-runs the unchanged baseline once; a healthy run never takes this path)`);
    check('the ONLY path with a second baseline run is the failure path of the composer (documented): a healthy SHADOW run performs the same single load as OFF', cOffFail.blocking === 1 && cShadowFail.blocking === 2);
  }

  // ======================================================================
  console.log('=== Part 5: ONE orchestration -- identical load / search counts for OFF and SHADOW ===');
  {
    const rows: string[] = [];
    let identical = true;
    for (const key of ['accept', 'loss', 'timing', 'multi', 'none']) {
      const cOff = fresh(); await run(SCENARIOS[key], undefined, cOff);
      const cShadow = fresh(); await run(SCENARIOS[key], ON(recorder().sink), cShadow);
      rows.push(`${key.padEnd(7)} OFF ${JSON.stringify(cOff)}  SHADOW ${JSON.stringify(cShadow)}`);
      if (JSON.stringify(cOff) !== JSON.stringify(cShadow) || cShadow.blocking !== 1 || cShadow.search === 0) identical = false;
    }
    rows.forEach((r) => console.log(`     ${r}`));
    check('QUERY / SEARCH / PREPARATION DELTA = 0: per scenario the blocker, duration, availability and fact loads and every timing search are IDENTICAL for OFF and SHADOW (one orchestration, never two)', identical);
    let composerCalls = 0;
    await run(SCENARIOS.multi, ON(recorder().sink, { observe: async (...a) => { composerCalls += 1; return observeShadowPolicy(...a); } }));
    check('SHADOW calls the composition exactly once per request and (healthy path) nothing else orchestrates', composerCalls === 1);
    const r = recorder();
    await run(SCENARIOS.multi, ON(r.sink));
    const after = r.seen.length;
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 5));
    check('NO BACKGROUND WORK: the single metrics record exists when the response resolves and nothing is emitted afterwards (no unawaited promise, queue or timer)', after === 1 && r.seen.length === 1);
  }

  // ======================================================================
  console.log('=== Part 6: minimal observation; nothing leaks into the response ===');
  {
    const rec = recorder();
    const shadowed = await run(SCENARIOS.multi, ON(rec.sink));
    const m = rec.seen[0];
    const KEYS = ['acceptanceUnavailable', 'accepted', 'generationReady', 'generationUnavailable', 'latency', 'mode', 'observations', 'rejected', 'run'];
    check('THE EXACT SINK SCHEMA: { mode, run, observations, generationReady, generationUnavailable{reason:n}, accepted, rejected{reason:n}, acceptanceUnavailable{reason:n}, latency } -- nothing else', JSON.stringify(Object.keys(m).sort()) === JSON.stringify(KEYS) && m.mode === 'SHADOW');
    const text = JSON.stringify(m);
    const allKeys = (v: unknown): string[] => (v !== null && typeof v === 'object' ? Object.entries(v as Record<string, unknown>).flatMap(([k, c]) => [k, ...allKeys(c)]) : []);
    const scalarValues = (v: unknown): unknown[] => (v !== null && typeof v === 'object' ? Object.values(v as Record<string, unknown>).flatMap(scalarValues) : [v]);
    check('NO IDENTIFIERS, TEXT, INSTANTS OR PLACEMENTS: no user, intent, owner, candidate, goal, activity or plan identifier; no title; no timestamp; no placement -- every key is a fixed vocabulary word or a typed reason, every value a small count or a closed category', !/user-1|someone@example|"O1"|"P1"|"O2"|"P2"|"O3"|"P3"/.test(text) && !/\d{4}-\d{2}-\d{2}/.test(text) && !/\d{2}:\d{2}/.test(text) && allKeys(m).every((k) => /^(mode|run|observations|generationReady|generationUnavailable|accepted|rejected|acceptanceUnavailable|latency|[A-Z][A-Z_]+)$/.test(k) && !/(user|intent|candidate|goal|activity|plan|title|slot|start|end|time)/i.test(k.replace(/^(NO_ACTIONABLE_PROMOTION_SLOT|OWNER_WOULD_BE_UNPLACED|OWNER_TIMING_DEGRADED|FIXED_PLACEMENT_CHANGED|NON_OWNER_CHANGED|UNNECESSARY_OWNER_CHANGE|PRECEDENCE_NOT_TIE|NET_PROPOSED_LOSS|RUN_NOT_READY|INCONSISTENT_AUTHORITY|INVALID_INTERVAL|GENERATION_FAILED|COUNTERFACTUAL_INVALID|BASELINE_TIMING_UNKNOWN|EVALUATION_FAILED)$/, ''))) && scalarValues(m).every((x) => typeof x === 'number' || ['SHADOW', 'READY', 'RUN_NOT_READY', 'PREPARATION_FAILED', 'OBSERVATION_FAILED', 'TECHNICAL_FAILURE', 'LT_50_MS', 'LT_250_MS', 'LT_1000_MS', 'GTE_1000_MS', 'UNKNOWN'].includes(x as string)));
    check('LOW CARDINALITY: every key is from a fixed vocabulary and every value is a small count or a closed category (nested maps are keyed by typed reasons only)', Object.values(m.rejected).concat(Object.values(m.generationUnavailable), Object.values(m.acceptanceUnavailable)).every((n) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 12) && ['READY', 'RUN_NOT_READY', 'PREPARATION_FAILED', 'OBSERVATION_FAILED', 'TECHNICAL_FAILURE'].includes(m.run) && ['LT_50_MS', 'LT_250_MS', 'LT_1000_MS', 'GTE_1000_MS', 'UNKNOWN'].includes(m.latency));
    check('THE SINK PAYLOAD IS FROZEN and shares nothing with the composition (it is derived from outcomes and typed reasons only)', Object.isFrozen(m) && Object.isFrozen(m.rejected) && Object.isFrozen(m.generationUnavailable) && Object.isFrozen(m.acceptanceUnavailable));
    const body = JSON.stringify(shadowed.body);
    check('NO RESPONSE LEAK: the HTTP result has only { httpStatus, body }; the body carries no shadow, counterfactual, promotion, policy or decision field', JSON.stringify(Object.keys(shadowed).sort()) === JSON.stringify(['body', 'httpStatus']) && !/shadow|counterfactual|promotion|policy|acceptedByPolicy|OWNER_WOULD|ACCEPT"/i.test(body.replace(/acceptanceToken/g, '')));
    check('summarizeShadowPolicyRun reads only outcomes and typed reasons: an unavailable run carries no fabricated counts', (() => { const u = summarizeShadowPolicyRun({ status: 'UNAVAILABLE', reason: 'PREPARATION_FAILED' }, 'UNKNOWN'); return u.run === 'PREPARATION_FAILED' && u.observations === 0 && u.accepted === 0; })());
  }

  // ======================================================================
  console.log('=== Part 7: default server sink and latency evidence (informational) ===');
  {
    const lines: string[] = []; const realInfo = console.info;
    console.info = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
    let shadowedDefault: DayConstructorPreviewHttpResult; let offDefault: DayConstructorPreviewHttpResult;
    try { shadowedDefault = await run(SCENARIOS.accept, () => ({ mode: 'SHADOW', sink: serverLogShadowPolicySink })); offDefault = await run(SCENARIOS.accept, () => ({ mode: 'OFF', sink: serverLogShadowPolicySink })); } finally { console.info = realInfo; }
    const parsed = lines.length === 1 ? JSON.parse(lines[0]) : undefined;
    check('THE DEFAULT SERVER SINK writes exactly ONE structured aggregate line per SHADOW request and nothing under OFF; the line is the minimal metrics plus a fixed event tag', lines.length === 1 && parsed?.event === 'DAY_CONSTRUCTOR_SHADOW_POLICY' && parsed.mode === 'SHADOW' && parsed.accepted === 1 && same(shadowedDefault, offDefault));
    const time = async (execution: (() => ShadowPolicyExecution) | undefined) => { const out: number[] = []; for (let i = 0; i < 40; i += 1) { const t = performance.now(); await run(SCENARIOS.multi, execution); out.push(performance.now() - t); } out.sort((a, b) => a - b); return { median: out[20], p95: out[37] }; };
    await time(undefined); await time(ON(recorder().sink));
    const off = await time(undefined); const on = await time(ON(recorder().sink));
    console.log(`     latency (multi-promotion fixture, 40 runs, fake in-memory deps, whole preview incl. signing): OFF median ${off.median.toFixed(2)} ms p95 ${off.p95.toFixed(2)} ms | SHADOW median ${on.median.toFixed(2)} ms p95 ${on.p95.toFixed(2)} ms | added orchestrations 0, added searches 0, added queries 0`);
    check('the latency evidence was measured (informational: no timing assertion; the work added is pure in-memory composition over one run)', Number.isFinite(off.median) && Number.isFinite(on.median));
  }

  restore();
  if (!allPassed) { console.error('SOME SHADOW EXECUTION CHECKS FAILED'); process.exitCode = 1; return; }
  console.log('ALL SHADOW EXECUTION CHECKS PASSED');
})().then(() => process.exit(), (err) => { console.error(err); process.exit(1); });
