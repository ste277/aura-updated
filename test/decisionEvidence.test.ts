/**
 * Constructor Decision Intelligence -- O5 P2a: immutable DecisionEvidence (pure behavior, no DB).
 *
 * Proves, with the REAL builder, the REAL preparation stage and the REAL orchestrator (only the database loaders and the
 * timing search are injected fakes):
 *
 *   - evidence is built by value and frozen: nothing a provider, a DecisionFacts object, an opportunity source or another
 *     candidate does afterwards can change it, and every write to it fails loudly (this file runs in strict mode)
 *   - it carries exactly the seven recurrence and twelve opportunity contract fields, nothing derived, and absence stays
 *     absence (no zero or UNKNOWN is ever invented)
 *   - it is built once per fact-bearing candidate per preview, at the preparation stage, never again through
 *     replenishment or attachment
 *   - it is inert: the preview (constructed day, resolved-intent metadata, signed tokens) is byte-identical with and
 *     without the evidence stage, a failing evidence build never fails a preview, and a maximally scarce LOW candidate
 *     still loses
 */
import { buildDecisionEvidence, type DecisionEvidence, type OpportunityEvidence, type RecurrenceEvidence } from '../apps/web/lib/decisionEvidence';
import * as evidenceModule from '../apps/web/lib/decisionEvidence';
import * as preparationModule from '../apps/web/lib/decisionFactPreparation';
import { prepareDecisionEvidence, createDecisionFactPreparer, type DecisionFactPreparer, type PreparationIntentInput, type PreparedDecisionFacts } from '../apps/web/lib/decisionFactPreparation';
import { orchestrateConstructDay, type ConstructDayRequest, type DayConstructorOrchestratorDeps, type RequestedDayIntent } from '../apps/web/lib/dayConstructorOrchestrator';
import { signPreviewResultBody } from '../apps/web/lib/dayConstructorPreviewIntegrity';
import type { DecisionFacts, OpportunityDecisionFacts, RecurrenceDecisionFacts } from '../apps/web/lib/decisionFacts';
import type { OpportunityRangeDeps } from '../apps/web/lib/opportunityRangeAdapter';
import type { AvailabilityConfiguration } from '../apps/web/lib/availabilityContext';
import type { TimingCandidate } from '../packages/recommendation/src/timingSearch';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
/** Runs `fn`; true only if it throws a TypeError (the strict-mode failure of a write to a frozen object). */
function throwsTypeError(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch (err) {
    return err instanceof TypeError;
  }
}

const RECURRENCE_KEYS = ['period', 'periodStartDate', 'periodEndDate', 'targetPerPeriod', 'completedInPeriod', 'committedInPeriod', 'remainingInPeriod'];
const OPPORTUNITY_KEYS = ['horizonStartDate', 'horizonEndDate', 'evaluatedDays', 'viableDays', 'unknownDays', 'coverage', 'durationMinutes', 'durationBasis', 'startDateState', 'afterStartEvaluatedDays', 'afterStartViableDays', 'afterStartUnknownDays'];

const recurrenceSource = (overrides: Partial<RecurrenceDecisionFacts> = {}): RecurrenceDecisionFacts => ({
  period: 'LOCAL_CALENDAR_WEEK', periodStartDate: '2026-10-05', periodEndDate: '2026-10-11', targetPerPeriod: 5, completedInPeriod: 1, committedInPeriod: 1, remainingInPeriod: 3, ...overrides,
});
const opportunitySource = (overrides: Partial<OpportunityDecisionFacts> = {}): OpportunityDecisionFacts => ({
  horizonStartDate: '2026-10-07', horizonEndDate: '2026-10-11', evaluatedDays: 5, viableDays: 3, unknownDays: 1, coverage: 'PARTIAL', durationMinutes: 60, durationBasis: 'RESOLVED', startDateState: 'KNOWN_FEASIBLE', afterStartEvaluatedDays: 4, afterStartViableDays: 2, afterStartUnknownDays: 1, ...overrides,
});
const bothFacts = (): DecisionFacts => ({ recurrence: recurrenceSource(), opportunity: opportunitySource() });

(async () => {
  const warn = console.warn;

  // ============================================================
  console.log('=== strict-mode precondition ===');
  const probe = Object.freeze({ a: 1 });
  check('this file runs in strict mode: a write to a frozen object THROWS instead of being silently ignored', throwsTypeError(() => { (probe as { a: number }).a = 2; }));

  // ============================================================
  console.log('=== content: exactly the contract fields, absence stays absence ===');
  check('absent facts -> no evidence', buildDecisionEvidence(undefined) === undefined);
  check('facts carrying no category ({}) -> no evidence at all (nothing is manufactured)', buildDecisionEvidence({}) === undefined);
  const recOnly = buildDecisionEvidence({ recurrence: recurrenceSource() })!;
  check('recurrence-only facts -> recurrence evidence and NO opportunity key (no zero / UNKNOWN filler)', !!recOnly.recurrence && !('opportunity' in recOnly) && recOnly.opportunity === undefined);
  const oppOnly = buildDecisionEvidence({ opportunity: opportunitySource() })!;
  check('opportunity-only facts -> opportunity evidence and NO recurrence key', !!oppOnly.opportunity && !('recurrence' in oppOnly) && oppOnly.recurrence === undefined);
  const both = buildDecisionEvidence(bothFacts())!;
  check('both -> both categories', !!both.recurrence && !!both.opportunity);
  check('RECURRENCE CONTRACT: exactly the seven fields, in contract order, values preserved exactly (no reinterpretation)', JSON.stringify(Object.keys(both.recurrence!)) === JSON.stringify(RECURRENCE_KEYS) && JSON.stringify(both.recurrence) === JSON.stringify(recurrenceSource()));
  check('OPPORTUNITY CONTRACT: exactly the twelve P0b fields, in contract order, values preserved exactly', JSON.stringify(Object.keys(both.opportunity!)) === JSON.stringify(OPPORTUNITY_KEYS) && JSON.stringify(both.opportunity) === JSON.stringify(opportunitySource()));
  const extra = buildDecisionEvidence({ recurrence: { ...recurrenceSource(), pressure: 9 } as unknown as RecurrenceDecisionFacts, opportunity: { ...opportunitySource(), winner: true } as unknown as OpportunityDecisionFacts })!;
  check('only contract fields are evidence: an extra property on a source object is NOT carried over', JSON.stringify(Object.keys(extra.recurrence!)) === JSON.stringify(RECURRENCE_KEYS) && JSON.stringify(Object.keys(extra.opportunity!)) === JSON.stringify(OPPORTUNITY_KEYS));
  const edge = buildDecisionEvidence({ recurrence: recurrenceSource({ completedInPeriod: 0, committedInPeriod: 0, remainingInPeriod: 0, targetPerPeriod: 0 }), opportunity: opportunitySource({ viableDays: 0, unknownDays: 5, coverage: 'UNKNOWN', durationBasis: 'GENERIC_FALLBACK', startDateState: 'UNKNOWN', afterStartViableDays: 0, afterStartUnknownDays: 4 }) })!;
  check('values are carried as data and never interpreted: UNKNOWN stays UNKNOWN, GENERIC_FALLBACK stays GENERIC_FALLBACK, zeros stay zeros, no field is added or dropped', edge.opportunity!.coverage === 'UNKNOWN' && edge.opportunity!.durationBasis === 'GENERIC_FALLBACK' && edge.opportunity!.startDateState === 'UNKNOWN' && edge.opportunity!.viableDays === 0 && edge.opportunity!.unknownDays === 5 && edge.recurrence!.remainingInPeriod === 0 && Object.keys(edge.opportunity!).length === 12 && Object.keys(edge.recurrence!).length === 7);
  check('the builder takes the facts and nothing else (no intent id, no source, no clock)', buildDecisionEvidence.length === 1);

  // ============================================================
  console.log('=== owned by value: no shared references ===');
  const providerFacts = bothFacts();
  const ev = buildDecisionEvidence(providerFacts)!;
  check('NO SHARED NESTED REFERENCES: the recurrence and opportunity evidence objects are not the provider\'s objects', ev.recurrence !== providerFacts.recurrence && ev.opportunity !== providerFacts.opportunity && ev !== (providerFacts as unknown));
  const snapshotJson = JSON.stringify(ev);
  (providerFacts.recurrence as { completedInPeriod: number }).completedInPeriod = 99;
  (providerFacts.recurrence as { remainingInPeriod: number }).remainingInPeriod = 0;
  (providerFacts.opportunity as { viableDays: number }).viableDays = 0;
  (providerFacts.opportunity as { coverage: string }).coverage = 'UNKNOWN';
  check('PROVIDER MUTATION: mutating the original recurrence object afterwards does not change the evidence', ev.recurrence!.completedInPeriod === 1 && ev.recurrence!.remainingInPeriod === 3);
  check('OPPORTUNITY-SOURCE MUTATION: mutating the original opportunity object afterwards does not change the evidence', ev.opportunity!.viableDays === 3 && ev.opportunity!.coverage === 'PARTIAL');
  check('the whole evidence is byte-identical after every source mutation', JSON.stringify(ev) === snapshotJson);
  const sharedFacts: DecisionFacts = bothFacts();
  const decisionFactsView: DecisionFacts = { ...sharedFacts };
  const evShared = buildDecisionEvidence(sharedFacts)!;
  (decisionFactsView.recurrence as { targetPerPeriod: number }).targetPerPeriod = 7;
  check('DECISIONFACTS MUTATION: mutating a DecisionFacts view that shares the provider\'s recurrence object does not change the evidence', evShared.recurrence!.targetPerPeriod === 5);

  // ============================================================
  console.log('=== deep immutability: runtime freeze, rejected writes, readonly types ===');
  check('OUTER FREEZE: the evidence object is frozen', Object.isFrozen(both));
  check('NESTED FREEZE: the recurrence and the opportunity evidence are each frozen', Object.isFrozen(both.recurrence) && Object.isFrozen(both.opportunity));
  check('OUTER MUTATION: reassigning evidence.recurrence / evidence.opportunity, adding a key, or deleting a key all throw', throwsTypeError(() => { (both as { recurrence?: unknown }).recurrence = {}; }) && throwsTypeError(() => { (both as { opportunity?: unknown }).opportunity = {}; }) && throwsTypeError(() => { (both as { extra?: unknown }).extra = 1; }) && throwsTypeError(() => { delete (both as { recurrence?: unknown }).recurrence; }));
  check('NESTED MUTATION: writing EVERY recurrence field throws and leaves the value unchanged', RECURRENCE_KEYS.every((key) => { const before = (both.recurrence as unknown as Record<string, unknown>)[key]; const threw = throwsTypeError(() => { (both.recurrence as unknown as Record<string, unknown>)[key] = 'x'; }); return threw && (both.recurrence as unknown as Record<string, unknown>)[key] === before; }));
  check('NESTED MUTATION: writing EVERY opportunity field throws and leaves the value unchanged', OPPORTUNITY_KEYS.every((key) => { const before = (both.opportunity as unknown as Record<string, unknown>)[key]; const threw = throwsTypeError(() => { (both.opportunity as unknown as Record<string, unknown>)[key] = 'x'; }); return threw && (both.opportunity as unknown as Record<string, unknown>)[key] === before; }));
  check('adding a key to a nested evidence object throws', throwsTypeError(() => { (both.recurrence as unknown as Record<string, unknown>).extra = 1; }) && throwsTypeError(() => { (both.opportunity as unknown as Record<string, unknown>).extra = 1; }));
  // Compile-time half: the types are readonly too (runtime freezing alone would not stop a typed caller). The
  // `@ts-expect-error` lines fail the TYPE CHECK of this file -- not just a run -- if any of these ever became assignable.
  const typed: DecisionEvidence = both;
  const typedRec: RecurrenceEvidence = both.recurrence!;
  const typedOpp: OpportunityEvidence = both.opportunity!;
  let typeLevelReadonly = true;
  try {
    // @ts-expect-error evidence.recurrence is readonly
    typed.recurrence = undefined;
    typeLevelReadonly = false;
  } catch { /* the runtime freeze rejected it, as intended */ }
  try {
    // @ts-expect-error evidence.opportunity is readonly
    typed.opportunity = undefined;
    typeLevelReadonly = false;
  } catch { /* rejected */ }
  try {
    // @ts-expect-error recurrence fields are readonly
    typedRec.completedInPeriod = 5;
    typeLevelReadonly = false;
  } catch { /* rejected */ }
  try {
    // @ts-expect-error opportunity fields are readonly
    typedOpp.viableDays = 5;
    typeLevelReadonly = false;
  } catch { /* rejected */ }
  check('READONLY TYPES: assignments to evidence, evidence.recurrence, evidence.opportunity and their fields are compile errors (@ts-expect-error) and are also rejected at runtime', typeLevelReadonly);

  // ============================================================
  console.log('=== isolation, reuse, equality ===');
  const shared = bothFacts();
  const a = buildDecisionEvidence(shared)!;
  const b = buildDecisionEvidence(shared)!;
  check('REUSED SOURCE: building twice from the same authoritative source object yields independently owned evidence (no shared object at any level)', a !== b && a.recurrence !== b.recurrence && a.opportunity !== b.opportunity && a.recurrence !== shared.recurrence && b.recurrence !== shared.recurrence);
  check('STRUCTURAL EQUALITY: identical inputs give structurally identical evidence', JSON.stringify(a) === JSON.stringify(b));
  check('REFERENCE INEQUALITY: independent builds do not depend on shared mutable nested references', Object.isFrozen(a.recurrence) && Object.isFrozen(b.recurrence) && a.recurrence !== b.recurrence);
  const factsA: DecisionFacts = { recurrence: recurrenceSource({ targetPerPeriod: 3 }), opportunity: opportunitySource({ viableDays: 5 }) };
  const factsB: DecisionFacts = { recurrence: recurrenceSource({ targetPerPeriod: 4 }), opportunity: opportunitySource({ viableDays: 1 }) };
  const evA = buildDecisionEvidence(factsA)!;
  const evB = buildDecisionEvidence(factsB)!;
  (factsA.recurrence as { targetPerPeriod: number }).targetPerPeriod = 99;
  (factsA.opportunity as { viableDays: number }).viableDays = 99;
  check('CROSS-CANDIDATE ISOLATION: changing candidate A\'s source (or its evidence) does not alter candidate B\'s evidence, and A\'s evidence did not follow its own source', evB.recurrence!.targetPerPeriod === 4 && evB.opportunity!.viableDays === 1 && evA.recurrence!.targetPerPeriod === 3 && evA.opportunity!.viableDays === 5 && throwsTypeError(() => { (evA.recurrence as { targetPerPeriod: number }).targetPerPeriod = 0; }) && evB.recurrence!.targetPerPeriod === 4);

  // ============================================================
  console.log('=== the preparation-stage builder: prepared facts over provider facts, fail-open, source-neutral ===');
  const intent = (intentId: string, facts: DecisionFacts | undefined): PreparationIntentInput => ({ intentId, durationMinutes: 60, durationFromGenericFallback: false, facts });
  const none: PreparedDecisionFacts = new Map();
  const result = prepareDecisionEvidence([intent('i1', { recurrence: recurrenceSource() }), intent('i2', undefined), intent('i3', {})], none);
  check('only fact-bearing intents get evidence (recurrence-only: recurrence only); an intent with no facts, or none of the categories, gets NO entry (no fabricated zero demand)', result.size === 1 && !!result.get('i1')?.recurrence && result.get('i1')!.opportunity === undefined && !result.has('i2') && !result.has('i3'));
  check('the result is synchronous (no promise): evidence preparation performs no I/O', !(result instanceof Promise) && typeof (result as unknown as { then?: unknown }).then === 'undefined');
  const preparedFacts: PreparedDecisionFacts = new Map([['i1', Object.freeze({ recurrence: recurrenceSource(), opportunity: opportunitySource() })]]);
  const withPrepared = prepareDecisionEvidence([intent('i1', { recurrence: recurrenceSource() })], preparedFacts);
  check('the evidence reflects the facts AS PREPARED: the prepared opportunity facts are included, and nothing is recomputed', JSON.stringify(withPrepared.get('i1')) === JSON.stringify({ recurrence: recurrenceSource(), opportunity: opportunitySource() }));
  check('PROVIDER FAILURE: when no facts could be prepared, evidence holds only what the provider carried -- no opportunity is invented, no UNKNOWN or zero is created', JSON.stringify(prepareDecisionEvidence([intent('i1', { recurrence: recurrenceSource() })], none).get('i1')) === JSON.stringify({ recurrence: recurrenceSource() }));
  const sameFacts = (): DecisionFacts => ({ recurrence: recurrenceSource(), opportunity: opportunitySource() });
  const neutral = prepareDecisionEvidence([intent('goal-demand:2026-10-07:ga-1', sameFacts()), intent('plan-day-goal-ga-1', sameFacts()), intent('typed-1', sameFacts())], none);
  check('SOURCE NEUTRALITY: identical authoritative facts give deeply equal evidence whatever the intent id looks like (an automatic demand id, a manual hand-off id, a typed id) -- there is no source branch', JSON.stringify(neutral.get('goal-demand:2026-10-07:ga-1')) === JSON.stringify(neutral.get('plan-day-goal-ga-1')) && JSON.stringify(neutral.get('typed-1')) === JSON.stringify(neutral.get('plan-day-goal-ga-1')));
  const multi = prepareDecisionEvidence([intent('g1', { recurrence: recurrenceSource({ targetPerPeriod: 2 }) }), intent('g2', { recurrence: recurrenceSource({ targetPerPeriod: 6 }), opportunity: opportunitySource({ viableDays: 0 }) }), intent('g3', { recurrence: recurrenceSource({ targetPerPeriod: 4 }) })], none);
  check('MULTIPLE CANDIDATES: evidence is candidate-local -- each keeps its own values with no cross-contamination', multi.get('g1')!.recurrence!.targetPerPeriod === 2 && multi.get('g2')!.recurrence!.targetPerPeriod === 6 && multi.get('g3')!.recurrence!.targetPerPeriod === 4 && multi.get('g1')!.opportunity === undefined && multi.get('g2')!.opportunity!.viableDays === 0 && multi.get('g3')!.opportunity === undefined);
  const sharedSource = recurrenceSource();
  const reuse = prepareDecisionEvidence([intent('x', { recurrence: sharedSource }), intent('y', { recurrence: sharedSource })], none);
  check('two intents handed the SAME source object get independently owned evidence', reuse.get('x')!.recurrence !== reuse.get('y')!.recurrence && reuse.get('x')!.recurrence !== sharedSource);
  {
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => { warnings.push(args); };
    const poisoned = { get recurrence(): RecurrenceDecisionFacts { throw new Error('malformed provider output'); } } as unknown as DecisionFacts;
    const failOpen = prepareDecisionEvidence([intent('bad', poisoned), intent('good', { recurrence: recurrenceSource() })], none);
    console.warn = warn;
    check('FAIL-OPEN: evidence that cannot be built for one intent is skipped (warned, never fabricated), and the other intents are unaffected', !failOpen.has('bad') && failOpen.has('good') && warnings.length === 1);
  }

  // ============================================================
  console.log('=== through the real orchestrator: built once, never recomputed, inert ===');
  const DATE = '2026-10-07';
  const NOW = new Date('2026-10-07T09:00:00Z');
  type Weekday = AvailabilityConfiguration['periods'][number]['weekday'];
  const workWeek: AvailabilityConfiguration = { configured: true, periods: ([1, 2, 3, 4, 5] as Weekday[]).map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })) };
  const slot = (start: string, end: string): TimingCandidate => ({ start, end, score: 5, label: 'GOOD', muhurtaScore: 0, reasons: [], metadata: { windowType: 'NEUTRAL', windowLabel: 'Neutral Flow', activityType: 'x', dateLabel: DATE } });
  const CONTESTED = slot('2026-10-07T11:00:00Z', '2026-10-07T12:00:00Z');
  const orchestratorDeps = (log: string[] = []): DayConstructorOrchestratorDeps => ({
    loadBlockingPlans: async () => [],
    loadDurationContext: async () => ({ preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} }),
    searchTiming: () => { log.push('search'); return { candidates: [CONTESTED] }; },
    loadAvailabilityConfiguration: async () => ({ configured: false, periods: [] }),
  });
  const requested = (id: string, overrides: Partial<RequestedDayIntent> = {}): RequestedDayIntent => ({ id, title: id, flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 60, originalOrder: 0, ...overrides });
  const request = (intents: RequestedDayIntent[], facts?: Record<string, DecisionFacts>): ConstructDayRequest => ({
    targetDate: DATE, timezone: 'UTC', constructionWindowSource: 'EXPLICIT_RANGE', now: NOW,
    explicitStart: new Date('2026-10-07T09:00:00Z'), explicitEnd: new Date('2026-10-07T17:00:00Z'), intents,
    ...(facts ? { decisionFactsByIntentId: new Map(Object.entries(facts)) } : {}),
  });
  const contest = (facts?: Record<string, DecisionFacts>) => request([requested('A', { importance: 'HIGH', originalOrder: 0 }), requested('B', { importance: 'LOW', originalOrder: 1 })], facts);
  const READY = (r: any) => { if (r.status !== 'READY') throw new Error(`expected READY, got ${r.status}`); return r.preview; };
  const fixedPreparer = (byId: Record<string, DecisionFacts>): DecisionFactPreparer => async () => new Map(Object.entries(byId));
  const rangeDeps = (): OpportunityRangeDeps => ({ loadAvailabilityConfiguration: async () => workWeek, loadPlansOverlappingRange: async () => [] });
  const WEEK = (): DecisionFacts => ({ recurrence: recurrenceSource() });

  // Count real builder invocations (the preparation stage calls it through the module object).
  const realBuild = evidenceModule.buildDecisionEvidence;
  let builds: Array<DecisionFacts | undefined> = [];
  const realPrepare = preparationModule.prepareDecisionEvidence;
  const setBuild = (fn: typeof realBuild) => { (evidenceModule as any).buildDecisionEvidence = fn; };
  const setPrepare = (fn: typeof realPrepare) => { (preparationModule as any).prepareDecisionEvidence = fn; };
  setBuild((facts) => { builds.push(facts); return realBuild(facts); });
  let evidenceStageCalls = 0;
  setPrepare((...args) => { evidenceStageCalls += 1; return realPrepare(...args); });

  try {
    // A contest (replenishment re-search of the conflicted loser) with two fact-bearing candidates and one typed intent with none.
    builds = []; evidenceStageCalls = 0;
    const log: string[] = [];
    const withFacts = READY(await orchestrateConstructDay(request([requested('A', { importance: 'HIGH', originalOrder: 0 }), requested('B', { importance: 'LOW', originalOrder: 1 }), requested('T', { originalOrder: 2, activityId: undefined, title: 'Write report' })], { A: WEEK(), B: WEEK() }), { ...orchestratorDeps(log), prepareDecisionFacts: fixedPreparer({ A: { ...WEEK(), opportunity: opportunitySource() } }) }));
    check('REPLENISHMENT RAN: a real contest re-searched the conflicted loser after the first construction (so there was a window in which evidence could have been rebuilt)', log.filter((e) => e === 'search').length >= 3 && withFacts.constructedDay.proposedItems.length >= 1);
    check('ONE evidence stage per preview, and exactly ONE build per fact-bearing candidate (2), none for the typed intent with no facts, none during replenishment or attachment', evidenceStageCalls === 1 && builds.length === 2);
    check('the evidence was built from the facts AS PREPARED: candidate A\'s build saw the prepared opportunity facts, candidate B\'s only its provider facts', builds.filter((f) => !!f?.opportunity).length === 1 && builds.filter((f) => !f?.opportunity && !!f?.recurrence).length === 1);

    // Inertness: replace the whole evidence stage with an empty one; the preview must not change by a single byte.
    const scenarios: Array<[string, () => ConstructDayRequest, DayConstructorOrchestratorDeps]> = [
      ['no facts', () => contest(), orchestratorDeps()],
      ['recurrence only', () => contest({ A: WEEK(), B: WEEK() }), orchestratorDeps()],
      ['opportunity only (prepared)', () => contest({ A: WEEK(), B: WEEK() }), { ...orchestratorDeps(), prepareDecisionFacts: fixedPreparer({ A: { opportunity: opportunitySource() }, B: { opportunity: opportunitySource({ viableDays: 0 }) } }) }],
      ['both facts (prepared)', () => contest({ A: WEEK(), B: WEEK() }), { ...orchestratorDeps(), prepareDecisionFacts: fixedPreparer({ A: { ...WEEK(), opportunity: opportunitySource() }, B: { ...WEEK(), opportunity: opportunitySource({ viableDays: 0 }) } }) }],
      ['both facts (real preparer, real range adapter)', () => contest({ A: WEEK(), B: WEEK() }), { ...orchestratorDeps(), prepareDecisionFacts: createDecisionFactPreparer(rangeDeps()) }],
    ];
    for (const [label, makeRequest, deps] of scenarios) {
      setPrepare(realPrepare);
      const real = JSON.stringify(READY(await orchestrateConstructDay(makeRequest(), deps)));
      setPrepare(() => new Map());
      const without = JSON.stringify(READY(await orchestrateConstructDay(makeRequest(), deps)));
      setPrepare((...args) => { evidenceStageCalls += 1; return realPrepare(...args); });
      check(`NO OUTPUT DRIFT [${label}]: the whole preview (constructed day, warnings, window, resolved-intent metadata incl. attached DecisionFacts) is byte-identical with and without the evidence stage`, real === without);
    }

    // The attached DecisionFacts keep the P1 contract exactly.
    setPrepare(realPrepare);
    const preparedMap: PreparedDecisionFacts = new Map([['A', Object.freeze({ ...WEEK(), opportunity: Object.freeze(opportunitySource()) })]]);
    const attached = READY(await orchestrateConstructDay(contest({ A: WEEK(), B: WEEK() }), { ...orchestratorDeps(), prepareDecisionFacts: async () => preparedMap }));
    const attachedA = attached.resolvedIntents.find((r: any) => r.requestedIntentId === 'A').dayIntent.decisionFacts;
    check('ATTACHMENT CONTRACT PRESERVED: the object attached to the resolved intent is still the exact object the preparer produced (P1 identity), with its recurrence first and the 12-field opportunity after', attachedA === preparedMap.get('A') && JSON.stringify(Object.keys(attachedA)) === JSON.stringify(['recurrence', 'opportunity']) && Object.keys(attachedA.opportunity).length === 12);

    // Scarcity: the maximally scarce LOW candidate still loses.
    const scarceLow = (): Record<string, DecisionFacts> => ({
      A: { ...WEEK(), opportunity: opportunitySource({ viableDays: 5, unknownDays: 0, coverage: 'COMPLETE', evaluatedDays: 5, afterStartViableDays: 4, afterStartUnknownDays: 0, afterStartEvaluatedDays: 4 }) },
      B: { recurrence: recurrenceSource({ targetPerPeriod: 7, completedInPeriod: 0, committedInPeriod: 0, remainingInPeriod: 7 }), opportunity: opportunitySource({ viableDays: 1, unknownDays: 0, coverage: 'COMPLETE', evaluatedDays: 1, startDateState: 'KNOWN_FEASIBLE', afterStartEvaluatedDays: 0, afterStartViableDays: 0, afterStartUnknownDays: 0, horizonEndDate: DATE }) },
    });
    const scarce = READY(await orchestrateConstructDay(contest({ A: WEEK(), B: WEEK() }), { ...orchestratorDeps(), prepareDecisionFacts: fixedPreparer(scarceLow()) }));
    const bare = READY(await orchestrateConstructDay(contest(), orchestratorDeps()));
    const constructedView = (p: any) => JSON.stringify({ day: p.constructedDay, warnings: p.warnings, window: p.constructionWindow });
    const evidenceForLow = prepareDecisionEvidence([intent('B', WEEK())], new Map([['B', scarceLow().B]])).get('B')!;
    check('SCARCE LOW CANDIDATE: with the LOW candidate given maximally scarce qualifying-looking evidence (1 viable day, target 7, 7 remaining) the winner is still HIGH and the loser still LOW, and the constructed day is byte-identical to the fact-free one', evidenceForLow.opportunity!.viableDays === 1 && evidenceForLow.recurrence!.remainingInPeriod === 7 && scarce.constructedDay.proposedItems[0].intentId === 'A' && scarce.constructedDay.deferredItems[0].intentId === 'B' && constructedView(scarce) === constructedView(bare));

    // Signing: tokens are over the proposed items only, never over decision facts or evidence.
    const bodyOf = (preview: any) => ({ status: 'READY', preview });
    const sign = (preview: any) => JSON.stringify(signPreviewResultBody('user-1', bodyOf(preview)));
    setPrepare(realPrepare);
    const factsDeps = { ...orchestratorDeps(), prepareDecisionFacts: fixedPreparer({ A: { ...WEEK(), opportunity: opportunitySource() } }) };
    const signedReal = sign(READY(await orchestrateConstructDay(contest({ A: WEEK(), B: WEEK() }), factsDeps)));
    setPrepare(() => new Map());
    const signedWithout = sign(READY(await orchestrateConstructDay(contest({ A: WEEK(), B: WEEK() }), factsDeps)));
    check('TOKEN IDENTITY: the signed preview body -- every acceptance token included -- is identical with and without the evidence stage (tokens are HMACs over the proposed items, not over decision facts)', signedReal === signedWithout && signedReal.includes('acceptanceToken'));
    setPrepare(realPrepare);

    // Failure: preparation failure and evidence failure never change or fail a preview.
    console.warn = () => {};
    const baselineNoPrep = JSON.stringify(READY(await orchestrateConstructDay(contest({ A: WEEK(), B: WEEK() }), orchestratorDeps())));
    let preparerCalls = 0;
    const rejecting: DayConstructorOrchestratorDeps = { ...orchestratorDeps(), prepareDecisionFacts: async () => { preparerCalls += 1; throw new Error('boom'); } };
    const throwing: DayConstructorOrchestratorDeps = { ...orchestratorDeps(), prepareDecisionFacts: () => { preparerCalls += 1; throw new Error('sync boom'); } };
    builds = [];
    const viaRejecting = JSON.stringify(READY(await orchestrateConstructDay(contest({ A: WEEK(), B: WEEK() }), rejecting)));
    const viaThrowing = JSON.stringify(READY(await orchestrateConstructDay(contest({ A: WEEK(), B: WEEK() }), throwing)));
    check('PREPARATION FAILURE UNCHANGED: a rejecting or synchronously throwing preparer yields the exact preview built without any preparer, each called once, no retry', viaRejecting === baselineNoPrep && viaThrowing === baselineNoPrep && preparerCalls === 2);
    check('on preparation failure evidence is built only from what the provider carried (recurrence), with no opportunity invented', builds.length === 4 && builds.every((f) => !!f?.recurrence && !f?.opportunity));
    setBuild(() => { throw new Error('evidence builder failure'); });
    const viaBuilderFailure = JSON.stringify(READY(await orchestrateConstructDay(contest({ A: WEEK(), B: WEEK() }), { ...orchestratorDeps(), prepareDecisionFacts: fixedPreparer({ A: { ...WEEK(), opportunity: opportunitySource() } }) })));
    setBuild(realBuild);
    const reference = JSON.stringify(READY(await orchestrateConstructDay(contest({ A: WEEK(), B: WEEK() }), { ...orchestratorDeps(), prepareDecisionFacts: fixedPreparer({ A: { ...WEEK(), opportunity: opportunitySource() } }) })));
    check('EVIDENCE FAILURE NON-INTERFERENCE: a builder that throws for every candidate never turns into a failed preview, and the preview is byte-identical to the one built normally', viaBuilderFailure === reference);
    console.warn = warn;
  } finally {
    setBuild(realBuild);
    setPrepare(realPrepare);
    console.warn = warn;
  }

  if (!allPassed) {
    console.error('SOME DECISION EVIDENCE CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL DECISION EVIDENCE CHECKS PASSED');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
