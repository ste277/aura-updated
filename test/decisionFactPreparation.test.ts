/**
 * Constructor Decision Intelligence -- O5 P1: pre-Constructor decision fact
 * preparation (pure behavior, no DB).
 *
 * The REAL orchestrator, the REAL preview handler, the REAL generic
 * preparer, the REAL O2 range adapter and the REAL O1 projection run; only
 * the database loaders and the timing search are injected fakes. Proves:
 *
 *   - facts are PREPARED after duration resolution and BEFORE the
 *     Constructor runs (observed through the real replenishment loop, whose
 *     re-search can only happen after the first construction)
 *   - preparing is not consuming: materially different prepared facts leave
 *     the constructed day identical
 *   - one preparation, one range load, one O1 projection per fact-bearing
 *     candidate; no post-Constructor recomputation
 *   - the exact prepared object is what is attached (deep equal, same
 *     identity, frozen), matched by server-owned id (never title)
 *   - preparation failure never fails or changes a preview
 *   - UNKNOWN stays UNKNOWN, DST partial survives, fallback stays labelled
 */
import { orchestrateConstructDay, type ConstructDayRequest, type DayConstructorOrchestratorDeps, type RequestedDayIntent } from '../apps/web/lib/dayConstructorOrchestrator';
import { runDayConstructorPreview } from '../apps/web/lib/dayConstructorPreviewRequest';
import { attachPreparedDecisionFacts, createDecisionFactPreparer, prepareDecisionFactsFailOpen, type DecisionFactPreparationInput, type DecisionFactPreparer, type PreparedDecisionFacts } from '../apps/web/lib/decisionFactPreparation';
import type { DecisionFacts } from '../apps/web/lib/decisionFacts';
import type { OpportunityRangeDeps } from '../apps/web/lib/opportunityRangeAdapter';
import type { AvailabilityConfiguration } from '../apps/web/lib/availabilityContext';
import type { PlanBlockerCandidate } from '../apps/web/lib/planBlockerLifecycle';
import type { TimingCandidate } from '../packages/recommendation/src/timingSearch';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const iso = (s: string) => new Date(s);
type Weekday = AvailabilityConfiguration['periods'][number]['weekday'];
const workWeek: AvailabilityConfiguration = { configured: true, periods: ([1, 2, 3, 4, 5] as Weekday[]).map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })) };
const UNCONFIGURED: AvailabilityConfiguration = { configured: false, periods: [] };

const DATE = '2026-10-07'; // Wednesday
const NOW = iso('2026-10-07T09:00:00Z');
const recurrence = (start: string, end: string, remaining = 3): DecisionFacts => ({
  recurrence: { period: 'LOCAL_CALENDAR_WEEK', periodStartDate: start, periodEndDate: end, targetPerPeriod: 5, completedInPeriod: 1, committedInPeriod: 5 - remaining - 1, remainingInPeriod: remaining },
});
const WEEK = recurrence('2026-10-05', '2026-10-11');
const NEXT_WEEK = recurrence('2026-10-12', '2026-10-18');

function slot(start: string, end: string): TimingCandidate {
  return { start, end, score: 5, label: 'GOOD', muhurtaScore: 0, reasons: [], metadata: { windowType: 'NEUTRAL', windowLabel: 'Neutral Flow', activityType: 'x', dateLabel: DATE } };
}
const CONTESTED = slot('2026-10-07T11:00:00Z', '2026-10-07T12:00:00Z');

function rangeDeps(configuration: AvailabilityConfiguration, plans: PlanBlockerCandidate[] = []) {
  const calls = { config: 0, plans: 0 };
  const deps: OpportunityRangeDeps = {
    loadAvailabilityConfiguration: async () => {
      calls.config += 1;
      return configuration;
    },
    loadPlansOverlappingRange: async () => {
      calls.plans += 1;
      return plans;
    },
  };
  return { deps, calls };
}
function orchestratorDeps(log: string[] = [], candidates: TimingCandidate[] = [CONTESTED]): DayConstructorOrchestratorDeps {
  return {
    loadBlockingPlans: async () => [],
    loadDurationContext: async () => ({ preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} }),
    searchTiming: (request) => {
      log.push(`search:${(request as { excludedIntervals?: unknown[] }).excludedIntervals?.length ?? 0}`);
      return { candidates };
    },
    loadAvailabilityConfiguration: async () => UNCONFIGURED,
  };
}
const requested = (overrides: Partial<RequestedDayIntent> & { id: string }): RequestedDayIntent => ({ title: overrides.id, flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 60, originalOrder: 0, ...overrides });
const request = (intents: RequestedDayIntent[], facts?: Record<string, DecisionFacts>, overrides: Partial<ConstructDayRequest> = {}): ConstructDayRequest => ({
  targetDate: DATE,
  timezone: 'UTC',
  constructionWindowSource: 'EXPLICIT_RANGE',
  now: NOW,
  explicitStart: iso('2026-10-07T09:00:00Z'),
  explicitEnd: iso('2026-10-07T17:00:00Z'),
  intents,
  ...(facts ? { decisionFactsByIntentId: new Map(Object.entries(facts)) } : {}),
  ...overrides,
});
const contest = (facts?: Record<string, DecisionFacts>) => request([requested({ id: 'A', importance: 'HIGH', originalOrder: 0 }), requested({ id: 'B', importance: 'LOW', originalOrder: 1 })], facts);
const READY = (r: any) => {
  if (r.status !== 'READY') throw new Error(`expected READY, got ${r.status}`);
  return r.preview;
};
const constructedView = (preview: any) => JSON.stringify({ day: preview.constructedDay, warnings: preview.warnings, window: preview.constructionWindow });
const fixedPreparer = (byId: Record<string, DecisionFacts>): DecisionFactPreparer => async () => new Map(Object.entries(byId));
const stripPrepared = (preview: any) => JSON.stringify(preview.resolvedIntents.map((r: any) => ({ id: r.requestedIntentId, d: { ...r.dayIntent, decisionFacts: r.dayIntent.decisionFacts?.recurrence ? { recurrence: r.dayIntent.decisionFacts.recurrence } : undefined } })));

(async () => {
  const warn = console.warn;

  // ============================================================
  // Timing: prepared after resolution, strictly BEFORE the Constructor
  // ============================================================
  {
    const log: string[] = [];
    const preparer: DecisionFactPreparer = async (input) => {
      log.push(`prepare:${input.intents.length}`);
      await new Promise((resolve) => setTimeout(resolve, 15)); // slow preparation must still finish first
      log.push('prepared');
      return new Map();
    };
    const result = await orchestrateConstructDay(contest({ A: WEEK, B: WEEK }), { ...orchestratorDeps(log), prepareDecisionFacts: preparer });
    const preview = READY(result);
    // The two initial searches (one per FLEXIBLE intent) precede preparation; the replenishment
    // re-search of the conflicted loser can only happen AFTER the first constructDay call.
    check('PREPARATION ORDER: initial searches, then preparation (completing), then the replenishment re-search -- which only exists after the first constructDay', JSON.stringify(log) === JSON.stringify(['search:0', 'search:0', 'prepare:2', 'prepared', 'search:1']));
    check('the contest still resolves exactly as in the P0c baseline: A proposed, B deferred', preview.constructedDay.proposedItems.map((p: any) => p.intentId).join() === 'A' && preview.constructedDay.deferredItems.map((d: any) => d.intentId).join() === 'B');
  }
  {
    let seen: DecisionFactPreparationInput | undefined;
    const preparer: DecisionFactPreparer = async (input) => {
      seen = input;
      return new Map();
    };
    await orchestrateConstructDay(request([requested({ id: 'first', originalOrder: 0, durationMinutes: 30 }), requested({ id: 'second', originalOrder: 1, durationMinutes: undefined, activityId: undefined, title: 'Zzqx unclassifiable' })], { first: WEEK }), { ...orchestratorDeps(), prepareDecisionFacts: preparer });
    check('preparation input: request order preserved, the ALREADY-resolved duration (30 explicit; 45 generic fallback), the fallback flag from the resolution\'s own warning, the provider facts untouched', !!seen && seen.intents.map((i) => i.intentId).join() === 'first,second' && seen.intents[0].durationMinutes === 30 && seen.intents[0].durationFromGenericFallback === false && seen.intents[1].durationMinutes === 45 && seen.intents[1].durationFromGenericFallback === true && seen.intents[0].facts === WEEK && seen.intents[1].facts === undefined);
    check('preparation context is the server request\'s own planning date, timezone and reference instant', !!seen && seen.context.planningDate === DATE && seen.context.timezone === 'UTC' && seen.context.now.getTime() === NOW.getTime());
  }

  // ============================================================
  // Preparing is not consuming
  // ============================================================
  {
    const bare = READY(await orchestrateConstructDay(contest({ A: WEEK, B: WEEK }), orchestratorDeps()));
    const favoursLoser = READY(await orchestrateConstructDay(contest({ A: WEEK, B: WEEK }), { ...orchestratorDeps(), prepareDecisionFacts: fixedPreparer({ A: { ...WEEK, opportunity: { horizonStartDate: DATE, horizonEndDate: '2026-10-11', evaluatedDays: 5, viableDays: 5, unknownDays: 0, coverage: 'COMPLETE', durationMinutes: 60, durationBasis: 'RESOLVED', startDateState: 'KNOWN_FEASIBLE', afterStartEvaluatedDays: 4, afterStartViableDays: 4, afterStartUnknownDays: 0 } }, B: { ...WEEK, opportunity: { horizonStartDate: DATE, horizonEndDate: '2026-10-11', evaluatedDays: 5, viableDays: 0, unknownDays: 0, coverage: 'COMPLETE', durationMinutes: 60, durationBasis: 'RESOLVED', startDateState: 'KNOWN_INFEASIBLE', afterStartEvaluatedDays: 4, afterStartViableDays: 0, afterStartUnknownDays: 0 } } }) }));
    const favoursWinner = READY(await orchestrateConstructDay(contest({ A: WEEK, B: WEEK }), { ...orchestratorDeps(), prepareDecisionFacts: fixedPreparer({ B: { ...WEEK, opportunity: { horizonStartDate: DATE, horizonEndDate: DATE, evaluatedDays: 1, viableDays: 0, unknownDays: 0, coverage: 'COMPLETE', durationMinutes: 60, durationBasis: 'GENERIC_FALLBACK', startDateState: 'KNOWN_FEASIBLE', afterStartEvaluatedDays: 0, afterStartViableDays: 0, afterStartUnknownDays: 0 } } }) }));
    check('NO CONSUMPTION: prepared facts that make the LOW candidate look maximally scarce (and the HIGH one abundant) leave the constructed day, warnings and window byte-identical', constructedView(favoursLoser) === constructedView(bare) && constructedView(favoursWinner) === constructedView(bare));
    check('NO CONSUMPTION: the winner is still the HIGH candidate and the loser still the LOW candidate whatever was prepared', favoursLoser.constructedDay.proposedItems[0].intentId === 'A' && favoursLoser.constructedDay.deferredItems[0].intentId === 'B');
    check('the only difference is the preview metadata: the resolved intents carry the prepared facts, everything else about them is unchanged', stripPrepared(favoursLoser) === stripPrepared(bare) && favoursLoser.resolvedIntents[1].dayIntent.decisionFacts.opportunity.viableDays === 0 && bare.resolvedIntents[1].dayIntent.decisionFacts?.opportunity === undefined);
    const reversed = READY(await orchestrateConstructDay(request([requested({ id: 'B', importance: 'LOW', originalOrder: 0 }), requested({ id: 'A', importance: 'HIGH', originalOrder: 1 })], { A: WEEK, B: WEEK }), { ...orchestratorDeps(), prepareDecisionFacts: fixedPreparer({ A: { ...WEEK, opportunity: favoursLoser.resolvedIntents[1].dayIntent.decisionFacts.opportunity } }) }));
    check('NO CONSUMPTION under input reversal: still A wins, B deferred', reversed.constructedDay.proposedItems[0].intentId === 'A' && reversed.constructedDay.deferredItems[0].intentId === 'B');
    check('a deferred (losing) intent keeps its prepared facts in the resolved-intent metadata exactly as the current preview contract exposes them', favoursLoser.constructedDay.deferredItems[0].intentId === 'B' && favoursLoser.resolvedIntents.find((r: any) => r.requestedIntentId === 'B').dayIntent.decisionFacts.opportunity.startDateState === 'KNOWN_INFEASIBLE');
  }

  // ============================================================
  // Single preparation, single range load, single projection per candidate
  // ============================================================
  {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const projection = require('../apps/web/lib/opportunityProjection');
    const original = projection.projectOpportunityFacts;
    let projections = 0;
    let preparations = 0;
    projection.projectOpportunityFacts = (...args: unknown[]) => {
      projections += 1;
      return original(...args);
    };
    try {
      const { deps, calls } = rangeDeps(workWeek);
      const real = createDecisionFactPreparer(deps);
      const counting: DecisionFactPreparer = async (input) => {
        preparations += 1;
        return real(input);
      };
      const r = contest({ A: WEEK, B: WEEK });
      r.intents.push(requested({ id: 'C', importance: 'MEDIUM', originalOrder: 2, durationMinutes: 30 }), requested({ id: 'T', title: 'typed, no facts', importance: 'MEDIUM', originalOrder: 3 }));
      (r.decisionFactsByIntentId as Map<string, DecisionFacts>).set('C', NEXT_WEEK);
      const preview = READY(await orchestrateConstructDay(r, { ...orchestratorDeps(), prepareDecisionFacts: counting }));
      check('ONE preparation per preview (never once before and once after construction)', preparations === 1);
      check('ONE O1 projection per fact-bearing candidate (3 candidates have a horizon, 1 typed has none) and none after construction', projections === 3);
      check('ONE O2 range load for the whole preview (one availability load, one plan query) regardless of candidate count', calls.config === 1 && calls.plans === 1);
      check('the typed intent with no facts gets nothing and does not trigger work of its own', preview.resolvedIntents.find((x: any) => x.requestedIntentId === 'T').dayIntent.decisionFacts === undefined);
    } finally {
      projection.projectOpportunityFacts = original;
    }
  }

  // ============================================================
  // Attachment: the exact prepared object, correct identity, frozen
  // ============================================================
  {
    let capturedPrepared: PreparedDecisionFacts | undefined;
    const { deps } = rangeDeps(workWeek);
    const real = createDecisionFactPreparer(deps);
    const capturing: DecisionFactPreparer = async (input) => {
      capturedPrepared = await real(input);
      return capturedPrepared;
    };
    const preview = READY(await orchestrateConstructDay(contest({ A: WEEK, B: WEEK }), { ...orchestratorDeps(), prepareDecisionFacts: capturing }));
    const attached = (id: string) => preview.resolvedIntents.find((x: any) => x.requestedIntentId === id).dayIntent.decisionFacts;
    check('ATTACHMENT: the object attached to each resolved intent IS the object prepared before construction (same identity, hence deep equal)', !!capturedPrepared && attached('A') === capturedPrepared.get('A') && attached('B') === capturedPrepared.get('B') && JSON.stringify(attached('A')) === JSON.stringify(capturedPrepared.get('A')));
    check('the prepared facts keep the exact 12-field opportunity contract and the provider\'s recurrence entry unchanged', JSON.stringify(Object.keys(attached('A').opportunity)) === JSON.stringify(['horizonStartDate', 'horizonEndDate', 'evaluatedDays', 'viableDays', 'unknownDays', 'coverage', 'durationMinutes', 'durationBasis', 'startDateState', 'afterStartEvaluatedDays', 'afterStartViableDays', 'afterStartUnknownDays']) && attached('A').recurrence === WEEK.recurrence);
    check('IMMUTABLE SNAPSHOT: the prepared facts and their opportunity entry are frozen', Object.isFrozen(attached('A')) && Object.isFrozen(attached('A').opportunity));
    check('the facts are candidate-local: both candidates see the same viable days (no capacity allocated between them)', attached('A').opportunity.viableDays === attached('B').opportunity.viableDays && attached('A').opportunity.viableDays === 3);
    check('original order preserved: resolved intents come back in request order', preview.resolvedIntents.map((x: any) => x.requestedIntentId).join() === 'A,B');
  }
  {
    const a = { requestedIntentId: 'x', dayIntent: { decisionFacts: undefined as DecisionFacts | undefined, title: 'same title' } };
    const b = { requestedIntentId: 'y', dayIntent: { decisionFacts: undefined as DecisionFacts | undefined, title: 'same title' } };
    const prepared: PreparedDecisionFacts = new Map([['y', Object.freeze({ ...WEEK })]]);
    const out = attachPreparedDecisionFacts([a, b], prepared);
    check('attachment is by server-owned id only: identical titles do not swap, an intent with nothing prepared is returned untouched, and the input is never mutated', out[0] === a && out[1].dayIntent.decisionFacts === prepared.get('y') && a.dayIntent.decisionFacts === undefined && b.dayIntent.decisionFacts === undefined);
    check('attaching an empty prepared set returns the same entries without change', attachPreparedDecisionFacts([a, b], new Map()).every((entry, i) => entry === [a, b][i]));
  }

  // ============================================================
  // Duplicate titles / same activity, different durations (through the real preparer)
  // ============================================================
  {
    const lunch: PlanBlockerCandidate = { start: iso('2026-10-08T12:00:00Z'), end: iso('2026-10-08T13:00:00Z'), status: 'UPCOMING' };
    const { deps } = rangeDeps(workWeek, [lunch]);
    const r = request(
      [requested({ id: 'short', title: 'Same title', importance: 'HIGH', originalOrder: 0, durationMinutes: 30 }), requested({ id: 'long', title: 'Same title', importance: 'LOW', originalOrder: 1, durationMinutes: 300 }), requested({ id: 'next', title: 'Same title', importance: 'LOW', originalOrder: 2, durationMinutes: 30 })],
      { short: WEEK, long: WEEK, next: NEXT_WEEK }
    );
    const preview = READY(await orchestrateConstructDay(r, { ...orchestratorDeps(), prepareDecisionFacts: createDecisionFactPreparer(deps) }));
    const opp = (id: string) => preview.resolvedIntents.find((x: any) => x.requestedIntentId === id).dayIntent.decisionFacts.opportunity;
    check('DUPLICATE TITLES: three intents with identical titles each get THEIR OWN facts (different duration, different horizon)', opp('short').durationMinutes === 30 && opp('long').durationMinutes === 300 && opp('next').durationMinutes === 30 && opp('short').horizonStartDate === DATE && opp('next').horizonStartDate === '2026-10-12');
    check('SAME ACTIVITY, DIFFERENT DURATION: each projection uses its own resolved duration (30 min fits Wed/Thu/Fri = 3; 300 min cannot use Thursday\'s split day = 2)', opp('short').viableDays === 3 && opp('long').viableDays === 2);
  }

  // ============================================================
  // Failure: never fails or changes a preview
  // ============================================================
  {
    console.warn = () => {};
    const bare = READY(await orchestrateConstructDay(contest({ A: WEEK, B: WEEK }), orchestratorDeps()));
    let calls = 0;
    const rejecting: DecisionFactPreparer = async () => {
      calls += 1;
      throw new Error('boom');
    };
    const throwingSync: DecisionFactPreparer = (() => {
      calls += 1;
      throw new Error('sync boom');
    }) as unknown as DecisionFactPreparer;
    const viaRejecting = READY(await orchestrateConstructDay(contest({ A: WEEK, B: WEEK }), { ...orchestratorDeps(), prepareDecisionFacts: rejecting }));
    const viaSync = READY(await orchestrateConstructDay(contest({ A: WEEK, B: WEEK }), { ...orchestratorDeps(), prepareDecisionFacts: throwingSync }));
    console.warn = warn;
    check('FAILURE BEFORE THE CONSTRUCTOR: a rejecting or throwing preparer yields a preview byte-identical to the one built without any preparer (constructed day AND metadata)', JSON.stringify(viaRejecting) === JSON.stringify(bare) && JSON.stringify(viaSync) === JSON.stringify(bare));
    check('no retry loop: each failing preparer was called exactly once per preview', calls === 2);
    console.warn = () => {};
    const failingRange: OpportunityRangeDeps = { loadAvailabilityConfiguration: async () => { throw new Error('availability down'); }, loadPlansOverlappingRange: async () => [] };
    const viaRange = READY(await orchestrateConstructDay(contest({ A: WEEK, B: WEEK }), { ...orchestratorDeps(), prepareDecisionFacts: createDecisionFactPreparer(failingRange) }));
    console.warn = warn;
    check('O2 FAILURE: a failing range load yields no opportunity facts and an otherwise identical preview (nothing fabricated)', JSON.stringify(viaRange) === JSON.stringify(bare));
    console.warn = () => {};
    check('prepareDecisionFactsFailOpen: no preparer and a failing preparer both resolve to an empty set', (await prepareDecisionFactsFailOpen(undefined, { intents: [], context: { planningDate: DATE, timezone: 'UTC', now: NOW } })).size === 0 && (await prepareDecisionFactsFailOpen(rejecting, { intents: [], context: { planningDate: DATE, timezone: 'UTC', now: NOW } })).size === 0);
    console.warn = warn;
  }

  // ============================================================
  // Through the REAL preview handler: UNKNOWN, DST, fallback, source neutrality
  // ============================================================
  const body = (intents: Array<Record<string, unknown>>) => ({ constructionWindowSource: 'EXPLICIT_RANGE', explicitStart: '2026-10-07T09:00:00Z', explicitEnd: '2026-10-07T17:00:00Z', intents: intents.map((i) => ({ flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 30, ...i })) });
  const provider = (facts: Record<string, DecisionFacts>) => async () => new Map(Object.entries(facts));
  const factsOf = (res: { body: unknown }, id: string) => (res.body as any).preview.resolvedIntents.find((x: any) => x.requestedIntentId === id).dayIntent.decisionFacts;
  {
    const { deps, calls } = rangeDeps(UNCONFIGURED);
    const r = await runDayConstructorPreview(body([{ id: 'i1', title: 'Recurring one' }]), 'UTC', NOW, orchestratorDeps(), provider({ i1: WEEK }), deps);
    const o = factsOf(r, 'i1').opportunity;
    check('UNKNOWN stays UNKNOWN when prepared before the Constructor: unconfigured availability -> 5 evaluated, 5 unknown, 0 viable, UNKNOWN (never a COMPLETE zero)', !!o && o.evaluatedDays === 5 && o.unknownDays === 5 && o.viableDays === 0 && o.coverage === 'UNKNOWN' && calls.config === 1);
  }
  {
    const cfg: AvailabilityConfiguration = { configured: true, periods: [...workWeek.periods, { weekday: 0 as Weekday, startTime: '01:30', endTime: '03:00' }] };
    const { deps } = rangeDeps(cfg);
    const dstNow = iso('2026-10-26T13:00:00Z');
    const r = await runDayConstructorPreview({ constructionWindowSource: 'EXPLICIT_RANGE', explicitStart: '2026-10-26T14:00:00Z', explicitEnd: '2026-10-26T22:00:00Z', intents: [{ id: 'd1', title: 'DST', flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 30 }] }, 'America/New_York', dstNow, orchestratorDeps(), provider({ d1: recurrence('2026-10-26', '2026-11-01') }), deps);
    const o = factsOf(r, 'd1').opportunity;
    check('DST: the repeated 01:30 Sunday window stays UNKNOWN (not zero) after the move: 7 evaluated, 5 viable (lower bound), 1 unknown, PARTIAL', !!o && o.evaluatedDays === 7 && o.viableDays === 5 && o.unknownDays === 1 && o.coverage === 'PARTIAL');
  }
  {
    const { deps } = rangeDeps(workWeek);
    const fallback = await runDayConstructorPreview(body([{ id: 'f1', title: 'Zzqx unclassifiable', activityId: undefined, durationMinutes: undefined }]), 'UTC', NOW, orchestratorDeps(), provider({ f1: WEEK }), deps);
    const bare = await runDayConstructorPreview(body([{ id: 'f1', title: 'Zzqx unclassifiable', activityId: undefined, durationMinutes: undefined }]), 'UTC', NOW, orchestratorDeps(), provider({ f1: WEEK }));
    const o = factsOf(fallback, 'f1').opportunity;
    check('GENERIC_FALLBACK: the fact is labelled GENERIC_FALLBACK over the 45-minute fallback (matching the preview\'s own warning) and stays inert (identical constructed day)', !!o && o.durationBasis === 'GENERIC_FALLBACK' && o.durationMinutes === 45 && constructedView((fallback.body as any).preview) === constructedView((bare.body as any).preview));
  }
  {
    const { deps } = rangeDeps(workWeek);
    const r = await runDayConstructorPreview(body([{ id: 'goal-demand:2026-10-07:ga-1', title: 'Looks like a Goal id' }, { id: 'typed-1', title: 'Typed' }]), 'UTC', NOW, orchestratorDeps(), provider({ 'goal-demand:2026-10-07:ga-1': WEEK, 'typed-1': WEEK }), deps);
    check('SOURCE NEUTRALITY: identical facts yield identical prepared opportunity facts whatever the id looks like (no source branch)', JSON.stringify(factsOf(r, 'goal-demand:2026-10-07:ga-1').opportunity) === JSON.stringify(factsOf(r, 'typed-1').opportunity));
  }
  {
    const { deps, calls } = rangeDeps(workWeek);
    const typed = await runDayConstructorPreview(body([{ id: 'typed-1', title: 'Write report' }]), 'UTC', NOW, orchestratorDeps(), provider({}), deps);
    const fixed = await runDayConstructorPreview(body([{ id: 'fx', title: 'Fixed thing', flexibility: 'FIXED', fixedStart: '2026-10-07T10:00:00Z' }]), 'UTC', NOW, orchestratorDeps(), provider({}), deps);
    check('NON-GOAL and FIXED intents without a horizon: no facts, no range load, normal construction', (typed.body as any).status === 'READY' && factsOf(typed, 'typed-1') === undefined && factsOf(fixed, 'fx') === undefined && calls.config === 0 && calls.plans === 0 && (fixed.body as any).preview.constructedDay.proposedItems.length === 1);
    const empty = await orchestrateConstructDay(request([]), { ...orchestratorDeps(), prepareDecisionFacts: createDecisionFactPreparer(deps) });
    check('EMPTY DAY: no intents -> no filler, no facts, no load', empty.status === 'READY' && empty.preview.constructedDay.proposedItems.length === 0 && empty.preview.constructedDay.deferredItems.length === 0 && calls.config === 0);
  }
  {
    const { deps, calls } = rangeDeps(workWeek);
    const withPreparer = await runDayConstructorPreview(body([{ id: 'i1', title: 'A', importance: 'HIGH' }, { id: 'i2', title: 'B', importance: 'LOW' }]), 'UTC', NOW, orchestratorDeps(), provider({ i1: WEEK, i2: WEEK }), deps);
    const without = await runDayConstructorPreview(body([{ id: 'i1', title: 'A', importance: 'HIGH' }, { id: 'i2', title: 'B', importance: 'LOW' }]), 'UTC', NOW, orchestratorDeps(), provider({ i1: WEEK, i2: WEEK }));
    check('through the real handler: the constructed day is byte-identical with and without preparation, and the handler no longer performs a post-Constructor load (exactly one)', constructedView((withPreparer.body as any).preview) === constructedView((without.body as any).preview) && calls.config === 1 && calls.plans === 1);
    const forged = await runDayConstructorPreview({ ...body([{ id: 'i1', title: 'A', opportunity: { viableDays: 99 }, decisionFacts: { opportunity: { viableDays: 99 } } }]), opportunity: { viableDays: 99 } }, 'UTC', NOW, orchestratorDeps(), provider({ i1: WEEK }), rangeDeps(workWeek).deps);
    check('forged client opportunity values are ignored: the prepared fact is server-derived', factsOf(forged, 'i1').opportunity.viableDays === 3);
  }

  if (!allPassed) {
    console.error('SOME DECISION FACT PREPARATION CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL DECISION FACT PREPARATION CHECKS PASSED');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
