/**
 * O5 SHADOW ROLLOUT R3 -- the Preview-only manual review harness (behavior suite, real pipeline, honest exclusion-filtering fake
 * timing search; no database -- see shadowRolloutR3PreviewReviewDb.test.ts for the real-DB directed proof).
 *
 *   Part 1  the environment guard: `isPreviewReviewEligibleEnvironment` (unit); `createServerShadowPolicyExecution`'s own
 *           `reviewEligible` for VERCEL_ENV production / preview / development / unset
 *   Part 2  Production negative: even with SHADOW on and a directed real ACCEPT reaching PASS, VERCEL_ENV=production ->
 *           no `shadowReview` field at all (not merely empty) -- the AGGREGATE log line is unaffected
 *   Part 3  Preview + OFF -> no review payload
 *   Part 4  Preview + SHADOW + every non-eligible evidence outcome (NO_ACCEPT, MULTIPLE_ACCEPTS, gate failure, materializer
 *           failure incl. BASELINE_PROVENANCE_MISMATCH, invariant failure) -> baseline response, no review payload
 *   Part 5  the directed real ACCEPT: Preview + SHADOW reaches APPLY/MATERIALIZABLE/READY/PASS -> baseline remains the
 *           returned result, the review payload exists and describes the actual materialized delta, zero writes
 *   Part 6  cross-run provenance negative (reuses the P4c4a model): a structurally identical but foreign baseline never
 *           produces a review payload
 *   Part 7  signing is unchanged; the review alternative cannot be fed into the normal accept path; normal baseline
 *           acceptance verification is unaffected
 *   Part 8  logging: the existing aggregate line never carries activity labels, review deltas or request/user ids
 *   Part 9  performance: the materializer runs at most once per request even when the review hand-off also fires
 */
import { observeShadowPolicy, type ShadowPolicyObservation, type ShadowPolicyRun } from '../apps/web/lib/shadowPolicyObservation';
import {
  orchestrateConstructDayWithShadowPolicy,
  createServerShadowPolicyExecution,
  isPreviewReviewEligibleEnvironment,
  SHADOW_POLICY_MODE_ENV,
  type ShadowPolicyExecution,
  type ShadowPolicyMetrics,
} from '../apps/web/lib/shadowPolicyExecution';
import { handleDayConstructorPreviewRequest, type DayConstructorPreviewBoundaryDeps } from '../apps/web/lib/dayConstructorPreviewRequest';
import { orchestrateConstructDay, type ConstructDayRequest, type DayConstructorOrchestratorDeps, type OrchestrateConstructDayResult, type RequestedDayIntent } from '../apps/web/lib/dayConstructorOrchestrator';
import { createDecisionFactPreparer } from '../apps/web/lib/decisionFactPreparation';
import type { DecisionFacts } from '../apps/web/lib/decisionFacts';
import type { OpportunityRangeDeps } from '../apps/web/lib/opportunityRangeAdapter';
import type { AvailabilityConfiguration } from '../apps/web/lib/availabilityContext';
import type { TimingCandidate } from '../packages/recommendation/src/timingSearch';
import { selectActiveCounterfactual } from '../apps/web/lib/activeSelector';
import { materializeActiveResult } from '../apps/web/lib/activeResultMaterializer';
import { verifyAcceptanceItems, verifyPreviewItem } from '../apps/web/lib/dayConstructorPreviewIntegrity';
import type { User } from '../apps/web/lib/db';
import type { ShadowReviewPayload } from '../apps/web/lib/shadowReviewDelta';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const LC = require('../apps/web/lib/localCounterfactual') as { generateLocalCounterfactual: (a: any) => any };
const realGenerate = LC.generateLocalCounterfactual;

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
  const req = (id: string, order: number, over: Partial<RequestedDayIntent> = {}): RequestedDayIntent => ({ id, title: id, flexibility: 'FLEXIBLE', durationMinutes: 60, originalOrder: order, ...over } as RequestedDayIntent);
  const fixed = (id: string, order: number, start: string): RequestedDayIntent => req(id, order, { flexibility: 'FIXED', fixedStart: at(start) } as Partial<RequestedDayIntent>);
  const request = (intents: RequestedDayIntent[], pressured: string[]): ConstructDayRequest => ({ targetDate: FRIDAY, timezone: 'UTC', constructionWindowSource: 'EXPLICIT_RANGE', now: at('09:00'), explicitStart: at('09:00'), explicitEnd: at('17:00'), intents, decisionFactsByIntentId: new Map(pressured.map((id) => [id, WEEK_FACTS] as [string, DecisionFacts])) });
  function mkDeps(pools: Record<string, PoolItem[]>, limit: number, counts = { search: 0, materialize: 0 }): DayConstructorOrchestratorDeps {
    const prepare = createDecisionFactPreparer(rangeDeps);
    return {
      loadBlockingPlans: async () => [],
      loadDurationContext: async () => ({ preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} }),
      searchTiming: (r: any) => {
        counts.search += 1;
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
  const O = [item('10:00', '11:00'), item('15:00', '16:00')];
  const ACCEPT = { intents: [req('O', 0), req('P', 1)], pressured: ['O', 'P'], pools: { O, P: [item('10:30', '11:30')] }, limit: 3 };
  const MULTI = { intents: [req('O1', 0), req('P1', 1), req('O2', 2), req('P2', 3)], pressured: ['O1', 'P1', 'O2', 'P2'], pools: { O1: [item('09:00', '10:00'), item('11:00', '12:00')], P1: [item('09:30', '10:30')], O2: [item('13:00', '14:00'), item('15:00', '16:00')], P2: [item('13:30', '14:30')] }, limit: 3 };
  const LOSS = { intents: [req('X', 0), req('Y', 1), req('O', 2), req('P', 3)], pressured: ['X', 'Y', 'O', 'P'], pools: { X: [item('13:00', '14:00')], Y: [item('13:00', '14:00'), item('10:00', '11:00')], O: [item('13:30', '14:30'), item('09:30', '10:30'), item('11:00', '12:00')], P: [item('13:30', '14:30'), item('10:30', '11:30'), item('11:30', '12:30')] }, limit: 1 };
  const GATE_FAIL = { intents: [req('O', 0), req('P', 1), req('D', 2)], pressured: ['O', 'P'], pools: { O, P: [item('10:30', '11:30')], D: [item('10:00', '11:00')] }, limit: 3 };
  interface Scenario { intents: RequestedDayIntent[]; pressured: string[]; pools: Record<string, PoolItem[]>; limit: number }
  const requestOf = (s: Scenario) => request(s.intents, s.pressured);
  const depsOf = (s: Scenario, counts?: { search: number; materialize: number }) => mkDeps(s.pools, s.limit, counts);
  const view = (r: OrchestrateConstructDayResult) => (r.status === 'READY' ? r.preview.constructedDay.proposedItems.map((i) => `${i.intentId}@${i.start.toISOString().slice(11, 16)}`).sort().join(',') : r.status);

  const USER: User = { id: 'u1', email: 'u1@example.com', cityName: 'x', latitude: 0, longitude: 0, timezone: 'UTC', createdAt: new Date(0), birthDate: null, birthTime: null, birthCityName: null, birthLatitude: null, birthLongitude: null, birthTimezone: null, remindersEnabled: true, reminderLeadMinutes: 15, dayBuilderEnabled: true, dayBuilderMutedGroups: [], dayBuilderPriorities: [], dayBuilderPriorityPersonIds: [], dayBuilderPrioritiesPromptDismissed: false } as unknown as User;

  interface Run { httpStatus: number; body: Record<string, unknown>; metrics: ShadowPolicyMetrics[]; searchCalls: number; materializeCalls: number }
  async function runPreview(s: Scenario, execution: ShadowPolicyExecution | undefined): Promise<Run> {
    const metrics: ShadowPolicyMetrics[] = [];
    const counts = { search: 0, materialize: 0 };
    const deps = mkDeps(s.pools, s.limit, counts);
    const execWithSink: ShadowPolicyExecution | undefined = execution ? { ...execution, sink: { record: (m: ShadowPolicyMetrics) => { metrics.push(m); } } } : undefined;
    const boundary: DayConstructorPreviewBoundaryDeps = {
      getSession: () => ({ userId: USER.id }),
      getUser: async () => USER,
      getBody: async () => ({ intents: s.intents.map((i) => ({ id: i.id, title: i.title, durationMinutes: i.durationMinutes, flexibility: i.flexibility, fixedStart: (i as any).fixedStart?.toISOString() })) }),
      now: () => at('09:00'),
      createOrchestratorDeps: () => deps,
      loadDecisionFacts: async (_u, r) => new Map(s.pressured.map((id) => [id, WEEK_FACTS] as [string, DecisionFacts])).size ? new Map(s.pressured.filter((id) => r.intents.some((i) => i.id === id)).map((id) => [id, WEEK_FACTS])) : new Map(),
      shadowPolicy: execWithSink ? () => execWithSink : undefined,
    };
    const result = await handleDayConstructorPreviewRequest(boundary);
    return { httpStatus: result.httpStatus, body: result.body, metrics, searchCalls: counts.search, materializeCalls: counts.materialize };
  }
  const SHADOW_PREVIEW_ELIGIBLE: ShadowPolicyExecution = { mode: 'SHADOW', reviewEligible: true };
  const SHADOW_PRODUCTION: ShadowPolicyExecution = { mode: 'SHADOW', reviewEligible: false };

  // ======================================================================
  console.log('=== Part 1: the environment guard ===');
  check('isPreviewReviewEligibleEnvironment: exactly "production" is excluded; Preview, Development and unset are all potentially eligible (documented, deliberate)', isPreviewReviewEligibleEnvironment('production') === false && isPreviewReviewEligibleEnvironment('preview') === true && isPreviewReviewEligibleEnvironment('development') === true && isPreviewReviewEligibleEnvironment(undefined) === true && isPreviewReviewEligibleEnvironment('') === true && isPreviewReviewEligibleEnvironment('PRODUCTION') === true);
  {
    const before = process.env.VERCEL_ENV;
    try {
      process.env.VERCEL_ENV = 'production';
      check('createServerShadowPolicyExecution: VERCEL_ENV=production -> reviewEligible is false', createServerShadowPolicyExecution().reviewEligible === false);
      process.env.VERCEL_ENV = 'preview';
      check('createServerShadowPolicyExecution: VERCEL_ENV=preview -> reviewEligible is true', createServerShadowPolicyExecution().reviewEligible === true);
      delete process.env.VERCEL_ENV;
      check('createServerShadowPolicyExecution: VERCEL_ENV unset (plain local dev) -> reviewEligible is true (deliberate, documented)', createServerShadowPolicyExecution().reviewEligible === true);
    } finally { if (before === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = before; }
  }

  // ======================================================================
  console.log('=== Part 2: Production negative (SHADOW on, directed ACCEPT reaches PASS, but reviewEligible=false) ===');
  {
    const prod = await runPreview(ACCEPT, SHADOW_PRODUCTION);
    check('Production: HTTP 200, READY, and the body has NO shadowReview key at all (not an empty one)', prod.httpStatus === 200 && (prod.body as any).status === 'READY' && !('shadowReview' in prod.body));
    check('Production: the AGGREGATE evidence line still reaches PASS internally (telemetry is env-independent) -- only the review payload is withheld', prod.metrics.length === 1 && prod.metrics[0].evidence.selector === 'APPLY' && prod.metrics[0].evidence.materializer === 'READY' && prod.metrics[0].evidence.invariant === 'PASS');
    const previewSame = await runPreview(ACCEPT, SHADOW_PREVIEW_ELIGIBLE);
    check('Preview with the SAME scenario DOES carry shadowReview -- the only difference is reviewEligible', 'shadowReview' in previewSame.body);
  }

  // ======================================================================
  console.log('=== Part 3: Preview + OFF ===');
  {
    const off = await runPreview(ACCEPT, undefined);
    check('OFF: no shadowReview field, no evidence line at all', !('shadowReview' in off.body) && off.metrics.length === 0);
  }

  // ======================================================================
  console.log('=== Part 4: Preview + SHADOW + every non-eligible evidence outcome ===');
  {
    const noAccept = await runPreview({ ...ACCEPT, pressured: ['O'] }, SHADOW_PREVIEW_ELIGIBLE);
    check('NO_ACCEPT: baseline response, no review payload', !('shadowReview' in noAccept.body) && noAccept.metrics[0]?.evidence.selector === 'NO_ACCEPT');
    const multi = await runPreview(MULTI, SHADOW_PREVIEW_ELIGIBLE);
    check('MULTIPLE_ACCEPTS: baseline response, no review payload', !('shadowReview' in multi.body) && multi.metrics[0]?.evidence.selector === 'MULTIPLE_ACCEPTS' && multi.metrics[0]?.accepted === 2);
    const loss = await runPreview(LOSS, SHADOW_PREVIEW_ELIGIBLE);
    check('a real P4b3 REJECT (owner-loss): baseline response, no review payload', !('shadowReview' in loss.body) && loss.metrics[0]?.evidence.selector === 'NO_ACCEPT');
    const gateFail = await runPreview(GATE_FAIL, SHADOW_PREVIEW_ELIGIBLE);
    check('gate unavailable (DEFERRED_DIAGNOSTIC_UNRESOLVED): baseline response, no review payload', !('shadowReview' in gateFail.body) && gateFail.metrics[0]?.evidence.gate === 'DEFERRED_DIAGNOSTIC_UNRESOLVED');
    LC.generateLocalCounterfactual = () => Object.freeze({ status: 'UNAVAILABLE', reason: 'NO_ACTIONABLE_PROMOTION_SLOT' });
    let genUn: Run;
    try { genUn = await runPreview(ACCEPT, SHADOW_PREVIEW_ELIGIBLE); } finally { LC.generateLocalCounterfactual = realGenerate; }
    check('typed generation unavailable: baseline response, no review payload', !('shadowReview' in genUn.body));
    // materializer unavailable, including provenance mismatch, injected safely at the materializer-dep level (no production path can forge this)
    const matThrow = await runPreview(ACCEPT, { ...SHADOW_PREVIEW_ELIGIBLE, evidenceDeps: { materialize: () => Object.freeze({ status: 'UNAVAILABLE', reason: 'BASELINE_PROVENANCE_MISMATCH' }) } });
    check('materializer unavailable (BASELINE_PROVENANCE_MISMATCH): baseline response, no review payload, counted distinctly', !('shadowReview' in matThrow.body) && matThrow.metrics[0]?.evidence.materializer === 'BASELINE_PROVENANCE_MISMATCH');
    // invariant failure, injected at the materializer-dep level by corrupting the READY result it hands back (never forging an authority)
    const invFail = await runPreview(ACCEPT, {
      ...SHADOW_PREVIEW_ELIGIBLE,
      evidenceDeps: { materialize: (input) => { const out = materializeActiveResult(input); if (out.status !== 'READY') return out; const clone = JSON.parse(JSON.stringify(out.result)); clone.preview.constructedDay.proposedItems.push({ ...clone.preview.constructedDay.proposedItems[0], intentId: 'EXTRA' }); clone.preview.constructedDay.proposedItems = clone.preview.constructedDay.proposedItems.map((it: any) => ({ ...it, start: new Date(it.start), end: new Date(it.end) })); return { status: 'READY', result: clone }; } },
    });
    check('READY but invariant != PASS: baseline response, no review payload', !('shadowReview' in invFail.body) && invFail.metrics[0]?.evidence.materializer === 'READY' && invFail.metrics[0]?.evidence.invariant !== 'PASS' && invFail.metrics[0]?.evidence.invariant !== 'NOT_EVALUATED');
  }

  // ======================================================================
  console.log('=== Part 5: the directed real ACCEPT ===');
  let directedPayload: ShadowReviewPayload | undefined;
  {
    const plain = await orchestrateConstructDay(requestOf(ACCEPT), depsOf(ACCEPT));
    const accept = await runPreview(ACCEPT, SHADOW_PREVIEW_ELIGIBLE);
    check('APPLY / MATERIALIZABLE / READY / PASS reached on this run', accept.metrics[0]?.evidence.selector === 'APPLY' && accept.metrics[0]?.evidence.gate === 'MATERIALIZABLE' && accept.metrics[0]?.evidence.materializer === 'READY' && accept.metrics[0]?.evidence.invariant === 'PASS');
    check('BASELINE REMAINS AUTHORITATIVE: the returned body\'s Proposed/Deferred sets equal the plain preview\'s own', JSON.stringify((accept.body as any).preview.constructedDay.proposedItems.map((i: any) => i.intentId)) === JSON.stringify((plain as any).preview.constructedDay.proposedItems.map((i: any) => i.intentId)) && JSON.stringify((accept.body as any).preview.constructedDay.deferredItems.map((i: any) => i.intentId)) === JSON.stringify((plain as any).preview.constructedDay.deferredItems.map((i: any) => i.intentId)));
    check('the baseline proposedItems are unchanged: only the owner O is Proposed, at its original 10:00 slot', (accept.body as any).preview.constructedDay.proposedItems.length === 1 && (accept.body as any).preview.constructedDay.proposedItems[0].intentId === 'O' && new Date((accept.body as any).preview.constructedDay.proposedItems[0].start).toISOString() === iso('10:00'));
    const review = (accept.body as any).shadowReview as ShadowReviewPayload;
    directedPayload = review;
    check('the review payload EXISTS and describes the actual materialized delta: P promoted to 10:30, O moved to 15:00', review !== undefined && review.changedItems.length === 2 && review.changedItems[0].kind === 'PROMOTED' && review.changedItems[0].intentId === 'P' && review.changedItems[0].alternative.start === iso('10:30') && review.changedItems[1].kind === 'MOVED' && review.changedItems[1].intentId === 'O' && review.changedItems[1].alternative.start === iso('15:00'));
    check('the review items carry no acceptanceToken and no internal authority shape', !('acceptanceToken' in (review.changedItems[0] as any)) && !JSON.stringify(review).includes('constructionBasis'));
  }

  // ======================================================================
  console.log('=== Part 6: cross-run provenance negative ===');
  {
    const a = await observeShadowPolicy(requestOf(ACCEPT), depsOf(ACCEPT));
    const b = await observeShadowPolicy(requestOf(ACCEPT), depsOf(ACCEPT));
    let review: ShadowReviewPayload | undefined;
    const execution: ShadowPolicyExecution = { mode: 'SHADOW', reviewEligible: true, onReview: (r) => { review = r; }, observe: async (_r, _d, cb) => { cb?.(b.result); return { result: b.result, shadowPolicy: a.shadowPolicy }; } };
    const result = await orchestrateConstructDayWithShadowPolicy(requestOf(ACCEPT), depsOf(ACCEPT), execution);
    check('A\'s authority with B\'s (structurally identical, foreign) baseline -> BASELINE_PROVENANCE_MISMATCH, no review payload, the baseline is returned', result === b.result && review === undefined);
  }

  // ======================================================================
  console.log('=== Part 7: signing, accept-path negative, normal acceptance unaffected ===');
  {
    const accept = await runPreview(ACCEPT, SHADOW_PREVIEW_ELIGIBLE);
    const rawWindow = (accept.body as any).preview.constructionWindow;
    const window = { ...rawWindow, start: new Date(rawWindow.start), end: new Date(rawWindow.end) };
    const items: Array<Record<string, unknown>> = ((accept.body as any).preview.constructedDay.proposedItems as Array<Record<string, unknown>>).map((i) => ({ ...i, start: new Date(i.start as string), end: new Date(i.end as string) }));
    check('SIGNING UNCHANGED: every baseline proposedItem carries its own acceptanceToken, exactly as before R3', items.every((i) => typeof i.acceptanceToken === 'string'));
    const tokens = new Map(items.map((i) => [i.intentId as string, i.acceptanceToken]));
    const verified = verifyAcceptanceItems(USER.id, window, items as any, tokens);
    check('normal baseline acceptance verification still succeeds unchanged', verified.length === 0);
    const review = (accept.body as any).shadowReview as ShadowReviewPayload;
    const fakeSubmission = { intentId: review.changedItems[0].intentId, title: review.changedItems[0].title, start: new Date(review.changedItems[0].alternative.start!), end: new Date(review.changedItems[0].alternative.end!), activityId: undefined };
    const noToken = verifyPreviewItem({ userId: USER.id, window, item: fakeSubmission as any }, undefined);
    check('the review alternative has NO token at all -> verification fails immediately (INVALID_REQUEST at the accept route, before any write)', noToken.ok === false);
    const stolenToken = verifyPreviewItem({ userId: USER.id, window, item: fakeSubmission as any }, tokens.get('O')); // the only OTHER real token available
    check('even a real token from a DIFFERENT item cannot authorize the review alternative (bound to its own exact facts)', stolenToken.ok === false);
  }

  // ======================================================================
  console.log('=== Part 8: logging never carries review data ===');
  {
    const lines: string[] = []; const realInfo = console.info;
    const before = process.env.VERCEL_ENV; const beforeMode = process.env[SHADOW_POLICY_MODE_ENV]; process.env.VERCEL_ENV = 'preview'; process.env[SHADOW_POLICY_MODE_ENV] = 'SHADOW';
    console.info = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
    try {
      await handleDayConstructorPreviewRequest({
        getSession: () => ({ userId: USER.id }), getUser: async () => USER, getBody: async () => ({ intents: ACCEPT.intents.map((i) => ({ id: i.id, title: i.title, durationMinutes: i.durationMinutes, flexibility: i.flexibility })) }), now: () => at('09:00'),
        createOrchestratorDeps: () => mkDeps(ACCEPT.pools, ACCEPT.limit), loadDecisionFacts: async (_u, r) => new Map(ACCEPT.pressured.filter((id) => r.intents.some((i) => i.id === id)).map((id) => [id, WEEK_FACTS])),
        shadowPolicy: createServerShadowPolicyExecution,
      });
    } finally { console.info = realInfo; if (before === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = before; if (beforeMode === undefined) delete process.env[SHADOW_POLICY_MODE_ENV]; else process.env[SHADOW_POLICY_MODE_ENV] = beforeMode; }
    check('exactly ONE aggregate log line, and it contains no activity label, no review delta, no request/user id', lines.length === 1 && !/Workout|Reading|"O"|"P"|u1|review|title|start|end/i.test(lines[0].replace(/"MATERIALIZABLE"|"NOT_EVALUATED"/g, '')));
    check('the aggregate line schema is unchanged by R3 (still the same closed key set)', JSON.stringify(Object.keys(JSON.parse(lines[0])).sort()) === JSON.stringify(['acceptanceUnavailable', 'accepted', 'event', 'evidence', 'generationReady', 'generationUnavailable', 'latency', 'mode', 'observations', 'pressured', 'pressuredContested', 'rejected', 'run', 'shadowOverheadLatency']));
  }

  // ======================================================================
  console.log('=== Part 9: performance -- the materializer runs at most once even with the review hand-off ===');
  {
    let materializeCalls = 0;
    const result = await orchestrateConstructDayWithShadowPolicy(requestOf(ACCEPT), depsOf(ACCEPT), {
      mode: 'SHADOW', reviewEligible: true, onReview: () => undefined,
      evidenceDeps: { materialize: (input) => { materializeCalls += 1; return materializeActiveResult(input); } },
    });
    check('exactly ONE materializer call for the whole request (evidence + review share it; no second policy evaluation)', materializeCalls === 1 && view(result) === 'O@10:00');
  }

  if (!allPassed) { console.error('SOME SHADOW ROLLOUT R3 PREVIEW REVIEW CHECKS FAILED'); process.exit(1); }
  console.log('ALL SHADOW ROLLOUT R3 PREVIEW REVIEW CHECKS PASSED');
})();
