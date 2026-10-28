/**
 * Constructor Decision Intelligence -- O5 P3b: the SHADOW PRESSURE EVALUATOR (pure behavior, no DB).
 *
 * Part 1 drives the pure evaluator (`evaluateShadowPressure`) with controlled inputs: the full classification taxonomy, the
 * gates in order, the all-owner rule, historical vs final owners, anomalies, fail-closed handling, ownership and
 * immutability. Part 2 drives the REAL pipeline -- the real orchestrator, preparer, projection, evidence stage, pressure
 * deriver and the real P3a trace; only the data loaders and the timing search are injected -- through
 * `observeShadowPressure`, proving each classification on genuine contention, that the Constructor result, the signed
 * tokens, the queries and the searches are IDENTICAL to a normal run, and that shadow failure never touches the preview.
 *
 * A shadow observation is a classification, never a decision: nothing here says who should have won, and no scenario
 * changes any scheduling outcome. Product / architecture invariants only: no timing, randomness, heap layout or query plan.
 */
import { buildDayIntent, type DayIntentImportance } from '../apps/web/lib/dayIntent';
import { compareByOverloadPrecedence } from '../apps/web/lib/dayIntent';
import { constructDayWithTrace } from '../apps/web/lib/dayConstructor';
import { compareAbovePressure, projectAbovePressureFacts, type AbovePressureFacts } from '../apps/web/lib/abovePressurePrecedence';
import * as evaluatorModule from '../apps/web/lib/shadowPressureEvaluation';
import { evaluateShadowPressure, type ShadowPressureEvaluation, type ShadowPressureInput, type ShadowPressureObservation } from '../apps/web/lib/shadowPressureEvaluation';
import { observeShadowPressure } from '../apps/web/lib/shadowPressureObservation';
import * as pressureModule from '../apps/web/lib/decisionPressure';
import { createContentionTrace, type ContentionEvent } from '../apps/web/lib/contentionTrace';
import { orchestrateConstructDay, type ConstructDayRequest, type DayConstructorOrchestratorDeps, type RequestedDayIntent } from '../apps/web/lib/dayConstructorOrchestrator';
import { signPreviewResultBody } from '../apps/web/lib/dayConstructorPreviewIntegrity';
import { createDecisionFactPreparer } from '../apps/web/lib/decisionFactPreparation';
import type { DecisionFacts } from '../apps/web/lib/decisionFacts';
import type { DecisionPressure } from '../apps/web/lib/decisionPressure';
import type { OpportunityRangeDeps } from '../apps/web/lib/opportunityRangeAdapter';
import type { AvailabilityConfiguration } from '../apps/web/lib/availabilityContext';
import type { TimingCandidate } from '../packages/recommendation/src/timingSearch';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const throwsTypeError = (fn: () => void) => { try { fn(); return false; } catch (e) { return e instanceof TypeError; } };

// ============================================================
// Part 1 -- the pure evaluator
// ============================================================
const TODAY = '2026-10-09';
const L: DayIntentImportance = 'LOW'; const M: DayIntentImportance = 'MEDIUM'; const H: DayIntentImportance = 'HIGH';
const facts = (importance: DayIntentImportance, deadline?: string): AbovePressureFacts => projectAbovePressureFacts({ importance, deadline });
const ev = (loser: string, winner: string, round = 0, s = '11:00', e = '12:00'): ContentionEvent => ({ loserIntentId: loser, winnerIntentId: winner, attemptedStart: `${TODAY}T${s}:00.000Z`, attemptedEnd: `${TODAY}T${e}:00.000Z`, winnerStart: `${TODAY}T11:00:00.000Z`, winnerEnd: `${TODAY}T12:00:00.000Z`, round });
const finalDay = (proposed: string[], deferred: string[]) => ({ proposedItems: proposed.map((intentId) => ({ intentId })), deferredItems: deferred.map((intentId) => ({ intentId })) }) as unknown as ShadowPressureInput['finalDay'];
const input = (o: { proposed: string[]; deferred: string[]; events?: ContentionEvent[]; pressure?: Record<string, DecisionPressure>; facts?: Record<string, AbovePressureFacts> }): ShadowPressureInput => ({
  finalDay: finalDay(o.proposed, o.deferred), contentionTrace: createContentionTrace(o.events ?? []), pressureByIntentId: new Map(Object.entries(o.pressure ?? {})), precedenceFactsByIntentId: new Map(Object.entries(o.facts ?? {})), planningDate: TODAY,
});
const LKO: DecisionPressure = 'LAST_KNOWN_OPPORTUNITY';
const find = (e: ShadowPressureEvaluation, id: string): ShadowPressureObservation => e.observations.find((o) => o.loserIntentId === id)!;
const cls = (i: ShadowPressureInput, id = 'B') => find(evaluateShadowPressure(i), id).classification;

console.log('=== the stronger-than-pressure comparison is the Constructor\'s own comparator with originalOrder neutralised ===');
{
  const importances: DayIntentImportance[] = [H, M, L];
  const deadlines: Array<string | undefined> = [undefined, TODAY, '2026-10-08', '2026-10-10', '2026-10-12'];
  let tieMatchesFull = true; let signAgrees = true; let orderIrrelevant = true; let pairs = 0;
  const mkIntent = (importance: DayIntentImportance, deadline: string | undefined, order: number) => ({ ...buildDayIntent({ title: 't', targetDate: TODAY, importance, deadline, estimatedDurationMinutes: 30 }, order) });
  for (const ia of importances) for (const ib of importances) for (const da of deadlines) for (const db of deadlines) {
    pairs += 1;
    const above = compareAbovePressure(facts(ia, da), facts(ib, db), TODAY);
    const fullEqualOrder = compareByOverloadPrecedence(mkIntent(ia, da, 0), mkIntent(ib, db, 0), TODAY);
    if ((above === 'TIE') !== (fullEqualOrder === 0)) tieMatchesFull = false;
    for (const [oa, ob] of [[0, 5], [5, 0], [3, 3]]) {
      const full = compareByOverloadPrecedence(mkIntent(ia, da, oa), mkIntent(ib, db, ob), TODAY);
      if (above !== 'TIE' && Math.sign(full) !== (above === 'A_STRONGER' ? -1 : 1)) signAgrees = false; // where the stronger dimensions decide, the real comparator decides identically, whatever originalOrder says
    }
    if (compareAbovePressure(facts(ia, da), facts(ib, db), TODAY) !== above) orderIrrelevant = false;
  }
  check(`EXHAUSTIVE (${pairs} pairs of importance x deadline-today / earlier / later / none): \`compareAbovePressure\` is TIE exactly when the real comparator ties with originalOrder equalised`, tieMatchesFull);
  check('where the stronger dimensions decide, the real comparator agrees on the direction for EVERY originalOrder combination (originalOrder can never overrule them, and the helper never reads it)', signAgrees && orderIrrelevant);
  check('the facts carry no originalOrder at all: a projection of an intent has only importance and (optionally) deadline', JSON.stringify(Object.keys(projectAbovePressureFacts({ importance: M, deadline: '2026-10-10' })).sort()) === JSON.stringify(['deadline', 'importance']) && JSON.stringify(Object.keys(projectAbovePressureFacts({ importance: M }))) === JSON.stringify(['importance']));
  check('deadline TODAY outranks importance, then importance, then an earlier / present deadline (the three dimensions, in the comparator\'s own order)', compareAbovePressure(facts(L, TODAY), facts(H), TODAY) === 'A_STRONGER' && compareAbovePressure(facts(H), facts(L), TODAY) === 'A_STRONGER' && compareAbovePressure(facts(M, '2026-10-10'), facts(M), TODAY) === 'A_STRONGER' && compareAbovePressure(facts(M, '2026-10-10'), facts(M, '2026-10-12'), TODAY) === 'A_STRONGER' && compareAbovePressure(facts(M), facts(M), TODAY) === 'TIE');
}

console.log('=== the gates, in order ===');
{
  const base = { proposed: ['A'], deferred: ['B'], events: [ev('B', 'A')], pressure: { A: 'NONE' as DecisionPressure, B: LKO }, facts: { A: facts(M), B: facts(M) } };
  check('ELIGIBLE (all gates pass; the owner differs only by weaker originalOrder, which the facts do not even carry): PRESSURE_ELIGIBLE_AGAINST_ALL_FINAL_OWNERS', cls(input(base)) === 'PRESSURE_ELIGIBLE_AGAINST_ALL_FINAL_OWNERS');
  check('PRESSURE GATE: pressure NONE with real contention and a final Deferral is NOT_PRESSURED (NONE can never become a promotion candidate)', cls(input({ ...base, pressure: { A: 'NONE', B: 'NONE' } })) === 'NOT_PRESSURED');
  check('PRESSURE GATE: no pressure on record for the candidate fails closed (UNAVAILABLE -> NOT_PRESSURED); pressure is never inferred', (() => { const o = find(evaluateShadowPressure(input({ ...base, pressure: { A: 'NONE' } })), 'B'); return o.classification === 'NOT_PRESSURED' && o.pressure === 'UNAVAILABLE'; })());
  check('CONTENTION GATE: LAST_KNOWN_OPPORTUNITY + final Deferred + NO trace event (e.g. deferred for another reason) is NO_CONTENTION -- contention comes from the trace only', cls(input({ ...base, events: [] })) === 'NO_CONTENTION');
  check('FINAL-STATE GATE: pressured, contended, but finally PROPOSED is NOT_FINAL_DEFERRED (recorded for controls, never a promotion candidate)', cls(input({ ...base, proposed: ['A', 'B'], deferred: [] })) === 'NOT_FINAL_DEFERRED');
  check('OWNER GATE: every historical owner is gone from the final schedule -> NO_FINAL_CONTENTION_OWNER (no promotion opportunity is inferred)', cls(input({ ...base, proposed: [], deferred: ['B', 'A'] })) === 'NO_FINAL_CONTENTION_OWNER');
  const strong = (importance: DayIntentImportance, deadline?: string) => cls(input({ ...base, facts: { A: facts(importance, deadline), B: facts(M) } }));
  check('IMPORTANCE: an owner with higher importance BLOCKS pressure (BLOCKED_BY_STRONGER_OWNER) -- explicit user value outranks temporal pressure', strong(H) === 'BLOCKED_BY_STRONGER_OWNER');
  check('DEADLINE TODAY: an owner with its deadline today BLOCKS pressure even against a higher-importance loser', cls(input({ ...base, facts: { A: facts(L, TODAY), B: facts(H) } })) === 'BLOCKED_BY_STRONGER_OWNER');
  check('DEADLINE: with deadline-today and importance tied, an owner with a stronger (present / earlier) deadline BLOCKS pressure', strong(M, '2026-10-10') === 'BLOCKED_BY_STRONGER_OWNER' && cls(input({ ...base, facts: { A: facts(M, '2026-10-10'), B: facts(M, '2026-10-12') } })) === 'BLOCKED_BY_STRONGER_OWNER');
  check('a WEAKER owner on a stronger dimension (the loser outranks it) is a PRECEDENCE_ANOMALY -- classified explicitly, never silently called eligibility', strong(L) === 'PRECEDENCE_ANOMALY' && find(evaluateShadowPressure(input({ ...base, facts: { A: facts(L), B: facts(M) } })), 'B').owners[0].comparison === 'LOSER_STRONGER_ABOVE_PRESSURE');
  check('ORIGINALORDER-ONLY DIFFERENCE: owners and loser that tie on every stronger dimension are eligible however originalOrder would order them (it is weaker than pressure and is not part of the facts)', cls(input(base)) === 'PRESSURE_ELIGIBLE_AGAINST_ALL_FINAL_OWNERS');
}

console.log('=== owners: 0..N, deduplicated, historical vs final, all-owner rule ===');
{
  const ten = { A1: facts(M), A2: facts(M), B: facts(M) };
  const two = { proposed: ['A1', 'A2'], deferred: ['B'], pressure: { B: LKO } as Record<string, DecisionPressure>, facts: ten as Record<string, AbovePressureFacts> };
  const all = evaluateShadowPressure(input({ ...two, events: [ev('B', 'A1'), ev('B', 'A2')] }));
  check('MULTI-OWNER ALL-TIE: two final owners, both tie above pressure -> eligible against ALL final owners; the observation carries both owners (cardinality 2, never collapsed to one)', find(all, 'B').classification === 'PRESSURE_ELIGIBLE_AGAINST_ALL_FINAL_OWNERS' && find(all, 'B').owners.map((o) => o.ownerIntentId).join() === 'A1,A2' && find(all, 'B').owners.every((o) => o.comparison === 'TIES_ABOVE_PRESSURE' && o.finalState === 'FINAL_PROPOSED'));
  const mixed = evaluateShadowPressure(input({ ...two, facts: { ...ten, A2: facts(H) }, events: [ev('B', 'A1'), ev('B', 'A2')] }));
  check('MULTI-OWNER MIXED: one owner ties, the other has HIGHER importance -> BLOCKED_BY_STRONGER_OWNER (not globally eligible); per-owner comparisons AND the aggregate are both recorded', find(mixed, 'B').classification === 'BLOCKED_BY_STRONGER_OWNER' && find(mixed, 'B').owners.map((o) => o.comparison).join() === 'TIES_ABOVE_PRESSURE,OWNER_STRONGER_ABOVE_PRESSURE');
  const anomalyMixed = evaluateShadowPressure(input({ ...two, facts: { A1: facts(L), A2: facts(H), B: facts(M) }, events: [ev('B', 'A1'), ev('B', 'A2')] }));
  check('an anomaly is never hidden by another owner\'s block: a loser-stronger owner plus an owner-stronger owner is PRECEDENCE_ANOMALY', find(anomalyMixed, 'B').classification === 'PRECEDENCE_ANOMALY');
  const manyEvents = evaluateShadowPressure(input({ ...two, proposed: ['A1'], events: [ev('B', 'A1', 0, '10:00', '11:00'), ev('B', 'A1', 0, '10:30', '11:30'), ev('B', 'A1', 1, '11:00', '12:00')] }));
  check('MULTIPLE EVENTS, SAME OWNER (three attempted intervals, two rounds): the owner is compared ONCE; the event count (3) is metadata only, never strength', find(manyEvents, 'B').owners.length === 1 && find(manyEvents, 'B').owners[0].contentionEventCount === 3 && find(manyEvents, 'B').contentionEventCount === 3);
  const historical = evaluateShadowPressure(input({ proposed: ['A2'], deferred: ['B', 'A1'], events: [ev('B', 'A1', 0), ev('B', 'A2', 1)], pressure: { B: LKO }, facts: { A1: facts(H), A2: facts(M), B: facts(M) } }));
  check('HISTORICAL OWNER REMOVED: A1 (stronger, but no longer Proposed) keeps its comparison as evidence yet does NOT block; the remaining FINAL owner A2 ties -> eligible against all FINAL owners', find(historical, 'B').classification === 'PRESSURE_ELIGIBLE_AGAINST_ALL_FINAL_OWNERS' && find(historical, 'B').owners.map((o) => `${o.ownerIntentId}:${o.finalState}:${o.comparison}`).join() === 'A1:NOT_FINAL_PROPOSED:OWNER_STRONGER_ABOVE_PRESSURE,A2:FINAL_PROPOSED:TIES_ABOVE_PRESSURE');
  const unknownOwner = evaluateShadowPressure(input({ proposed: ['A'], deferred: ['B'], events: [ev('B', 'GONE')], pressure: { B: LKO }, facts: { B: facts(M) } }));
  check('OWNER NOT IN THE FINAL RESULT AT ALL is valid history, not corruption: it is NOT_FINAL_PROPOSED and (no final owner remains) the classification is NO_FINAL_CONTENTION_OWNER', find(unknownOwner, 'B').owners[0].finalState === 'NOT_FINAL_PROPOSED' && find(unknownOwner, 'B').classification === 'NO_FINAL_CONTENTION_OWNER');
  check('only the loser\'s OWN contention relationships are used: an unrelated Proposed candidate never enters the owner set', find(evaluateShadowPressure(input({ proposed: ['A', 'X'], deferred: ['B'], events: [ev('B', 'A')], pressure: { B: LKO }, facts: { A: facts(M), B: facts(M), X: facts(H) } })), 'B').classification === 'PRESSURE_ELIGIBLE_AGAINST_ALL_FINAL_OWNERS');
}

console.log('=== fail closed ===');
{
  const base = { proposed: ['A'], deferred: ['B'], events: [ev('B', 'A')], pressure: { B: LKO } as Record<string, DecisionPressure> };
  const noLoserFacts = find(evaluateShadowPressure(input({ ...base, facts: { A: facts(M) } })), 'B');
  const noOwnerFacts = find(evaluateShadowPressure(input({ ...base, facts: { B: facts(M) } })), 'B');
  check('MISSING PRECEDENCE FACTS (loser or owner) -> INCOMPLETE_INPUT / MISSING_PRECEDENCE_FACTS, never eligible', noLoserFacts.classification === 'INCOMPLETE_INPUT' && noLoserFacts.incompleteReason === 'MISSING_PRECEDENCE_FACTS' && noOwnerFacts.classification === 'INCOMPLETE_INPUT' && noOwnerFacts.owners[0].comparison === 'UNKNOWN_PRECEDENCE');
  const absent = find(evaluateShadowPressure(input({ proposed: ['A'], deferred: [], events: [ev('GHOST', 'A')], pressure: { GHOST: LKO }, facts: { A: facts(M), GHOST: facts(M) } })), 'GHOST');
  check('LOSER ABSENT FROM THE FINAL RESULT -> INCOMPLETE_INPUT / LOSER_NOT_IN_FINAL_RESULT (fails closed)', absent.classification === 'INCOMPLETE_INPUT' && absent.incompleteReason === 'LOSER_NOT_IN_FINAL_RESULT' && absent.finalState === 'ABSENT_FROM_FINAL_RESULT');
  const dup = find(evaluateShadowPressure(input({ proposed: ['A'], deferred: ['B', 'B'], events: [ev('B', 'A')], pressure: { B: LKO }, facts: { A: facts(M), B: facts(M) } })), 'B');
  const dupBoth = find(evaluateShadowPressure(input({ proposed: ['A', 'B'], deferred: ['B'], events: [ev('B', 'A')], pressure: { B: LKO }, facts: { A: facts(M), B: facts(M) } })), 'B');
  const dupOwner = find(evaluateShadowPressure(input({ proposed: ['A', 'A'], deferred: ['B'], events: [ev('B', 'A')], pressure: { B: LKO }, facts: { A: facts(M), B: facts(M) } })), 'B');
  check('DUPLICATE INTENT IDS (twice Deferred, Proposed and Deferred, or a duplicated owner) -> INCOMPLETE_INPUT / DUPLICATE_INTENT_ID: no arbitrary choice is ever made', dup.classification === 'INCOMPLETE_INPUT' && dup.incompleteReason === 'DUPLICATE_INTENT_ID' && dupBoth.incompleteReason === 'DUPLICATE_INTENT_ID' && dupOwner.incompleteReason === 'DUPLICATE_INTENT_ID');
  {
    // AUDIT: the Constructor itself does not guarantee unique intent ids (the PUBLIC preview request rejects duplicates at its boundary); the evaluator therefore fails closed.
    const at9 = (h: string) => new Date(`${TODAY}T${h}:00Z`);
    const dupIntent = (order: number) => ({ ...buildDayIntent({ title: 'X', targetDate: TODAY, estimatedDurationMinutes: 60 }, order), id: 'X' });
    const raw = constructDayWithTrace({ intents: [dupIntent(0), dupIntent(1)], window: { date: TODAY, start: at9('09:00'), end: at9('17:00'), timezone: 'UTC', source: 'EXPLICIT_RANGE' }, blockedIntervals: [], candidatesByIntentId: { X: [{ intentId: 'X', start: at9('10:00'), end: at9('11:00'), candidateOrder: 0 }] }, fixedConstraintsByIntentId: {}, today: TODAY });
    const day = (raw.result as { day: ShadowPressureInput['finalDay'] }).day;
    const o = find(evaluateShadowPressure({ finalDay: day, contentionTrace: raw.trace, pressureByIntentId: new Map([['X', LKO]]), precedenceFactsByIntentId: new Map([['X', facts(M)]]), planningDate: TODAY }), 'X');
    check('REAL CONSTRUCTOR, DUPLICATE ID (raw `constructDay` does not reject it: the same id appears twice in the result) -> the evaluator fails closed: INCOMPLETE_INPUT / DUPLICATE_INTENT_ID', day.deferredItems.length === 2 && o.classification === 'INCOMPLETE_INPUT' && o.incompleteReason === 'DUPLICATE_INTENT_ID' && o.finalState === 'AMBIGUOUS_ID');
  }
  check('an empty trace and an empty final day produce no observations (nothing is fabricated)', evaluateShadowPressure(input({ proposed: [], deferred: [] })).observations.length === 0);
}

console.log('=== granularity, order, ownership, immutability ===');
{
  const i = input({ proposed: ['A'], deferred: ['B', 'C'], events: [ev('B', 'A'), ev('P', 'A')], pressure: { B: LKO, C: LKO, P: LKO }, facts: { A: facts(M), B: facts(M), C: facts(M), P: facts(M) } });
  const e = evaluateShadowPressure(i);
  check('ONE OBSERVATION PER FINAL DEFERRED CANDIDATE, in final-result order, then any other candidate that appears as a loser in the trace -- never one independent decision per event', e.observations.map((o) => o.loserIntentId).join() === 'B,C,P' && find(e, 'C').classification === 'NO_CONTENTION' && find(e, 'P').classification === 'INCOMPLETE_INPUT');
  const frozenInput = i;
  const before = JSON.stringify({ d: frozenInput.finalDay, t: frozenInput.contentionTrace, p: [...frozenInput.pressureByIntentId], f: [...frozenInput.precedenceFactsByIntentId] });
  evaluateShadowPressure(frozenInput);
  check('INPUT OWNERSHIP: evaluating mutates neither the final result, the trace, the pressure map nor the precedence facts', JSON.stringify({ d: frozenInput.finalDay, t: frozenInput.contentionTrace, p: [...frozenInput.pressureByIntentId], f: [...frozenInput.precedenceFactsByIntentId] }) === before);
  const obs = find(e, 'B');
  check('OUTPUT OWNERSHIP: the evaluation, its observations array, every observation, every owner array and every owner comparison are frozen; writes throw', Object.isFrozen(e) && Object.isFrozen(e.observations) && Object.isFrozen(obs) && Object.isFrozen(obs.owners) && obs.owners.every((o) => Object.isFrozen(o)) && throwsTypeError(() => { (obs as { classification: string }).classification = 'x'; }) && throwsTypeError(() => { (obs.owners as unknown as unknown[]).push({}); }) && throwsTypeError(() => { (e.observations as unknown as unknown[]).length = 0; }));
  const reachable = (v: unknown, seen = new Set<unknown>()): unknown[] => (v === null || typeof v !== 'object' || seen.has(v) ? [] : (seen.add(v), [v, ...Object.values(v as Record<string, unknown>).flatMap((c) => reachable(c, seen))]));
  const inputObjects = new Set<unknown>([...reachable(i.finalDay), ...reachable(i.contentionTrace), ...reachable(i.pressureByIntentId), ...reachable([...i.precedenceFactsByIntentId.values()])]);
  check('DETACHED: no object reachable from the output is shared with any input', reachable(e).every((o) => !inputObjects.has(o)));
  check('OUTPUT CONTENT: stable ids and enums only -- no title, activity, Goal, user, score or user-facing copy; the observation keys are exactly the documented ones', Object.keys(obs).sort().join() === 'classification,contentionEventCount,finalState,loserIntentId,owners,pressure' && Object.keys(obs.owners[0]).sort().join() === 'comparison,contentionEventCount,finalState,ownerIntentId');
  const reps = Array.from({ length: 20 }, () => JSON.stringify(evaluateShadowPressure(i)));
  check('DETERMINISM: 20 evaluations are byte-identical', reps.every((r) => r === reps[0]));
  check('NO ROUND DATA: round numbers are neither read nor emitted (the P3a round-label debt is not relied on)', !JSON.stringify(e).includes('round') && JSON.stringify(evaluateShadowPressure(input({ proposed: ['A'], deferred: ['B'], events: [ev('B', 'A', 7)], pressure: { B: LKO }, facts: { A: facts(M), B: facts(M) } }))) === JSON.stringify(evaluateShadowPressure(input({ proposed: ['A'], deferred: ['B'], events: [ev('B', 'A', 0)], pressure: { B: LKO }, facts: { A: facts(M), B: facts(M) } }))));
  check('SOURCE-NEUTRAL: ids shaped like a Goal automatic demand, a manual hand-off and a typed row classify identically (the evaluator sees ids and enums only)', (() => { const run = (a: string, b: string) => JSON.stringify(evaluateShadowPressure(input({ proposed: [a], deferred: [b], events: [ev(b, a)], pressure: { [b]: LKO }, facts: { [a]: facts(M), [b]: facts(M) } }))).split(JSON.stringify(a)).join('"OWNER"').split(JSON.stringify(b)).join('"LOSER"'); const base = run('A', 'B'); return [run('goal-demand:2026-10-09:ga-1', 'goal-demand:2026-10-09:ga-2'), run('plan-day-goal-ga-1', 'plan-day-goal-ga-2'), run('typed-1', 'typed-2')].every((x) => x === base); })());
}

// ============================================================
// Part 2 -- the REAL pipeline through observeShadowPressure
// ============================================================
type Weekday = AvailabilityConfiguration['periods'][number]['weekday'];
const FRIDAY = '2026-10-09'; // the last weekday of its week: scarce for a recurrence candidate with a resolved duration
const workWeek: AvailabilityConfiguration = { configured: true, periods: ([1, 2, 3, 4, 5] as Weekday[]).map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })) };
const rangeDeps: OpportunityRangeDeps = { loadAvailabilityConfiguration: async () => workWeek, loadPlansOverlappingRange: async () => [] };
const at = (h: string) => new Date(`${FRIDAY}T${h}:00Z`);
const timing = (start: string, end: string): TimingCandidate => ({ start: `${FRIDAY}T${start}:00Z`, end: `${FRIDAY}T${end}:00Z`, score: 5, label: 'GOOD', muhurtaScore: 0, reasons: [], metadata: { windowType: 'NEUTRAL', windowLabel: 'Neutral Flow', activityType: 'x', dateLabel: FRIDAY } });
const WEEK_FACTS: DecisionFacts = { recurrence: { period: 'LOCAL_CALENDAR_WEEK', periodStartDate: '2026-10-05', periodEndDate: '2026-10-11', targetPerPeriod: 3, completedInPeriod: 0, committedInPeriod: 0, remainingInPeriod: 3 } };
const req = (id: string, over: Partial<RequestedDayIntent> = {}): RequestedDayIntent => ({ id, title: id, flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 60, originalOrder: 0, ...over });
const request = (intents: RequestedDayIntent[], pressured: string[]): ConstructDayRequest => ({
  targetDate: FRIDAY, timezone: 'UTC', constructionWindowSource: 'EXPLICIT_RANGE', now: at('09:00'), explicitStart: at('09:00'), explicitEnd: at('17:00'), intents,
  decisionFactsByIntentId: new Map(pressured.map((id) => [id, WEEK_FACTS])),
});
interface Calls { plans: number; duration: number; search: number }
function deps(script: TimingCandidate[][], calls: Calls = { plans: 0, duration: 0, search: 0 }, blockers: Array<{ start: Date; end: Date; status: 'UPCOMING' }> = []): { deps: DayConstructorOrchestratorDeps; calls: Calls } {
  return { calls, deps: {
    loadBlockingPlans: async () => { calls.plans += 1; return blockers; },
    loadDurationContext: async () => { calls.duration += 1; return { preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} }; },
    searchTiming: () => { const n = calls.search; calls.search += 1; return { candidates: script[n] ?? [] }; },
    loadAvailabilityConfiguration: async () => ({ configured: false, periods: [] }),
    prepareDecisionFacts: createDecisionFactPreparer(rangeDeps),
  } };
}
async function pipeline(intents: RequestedDayIntent[], pressured: string[], script: TimingCandidate[][], blockers: Array<{ start: Date; end: Date; status: 'UPCOMING' }> = []) {
  const shadowRun = deps(script, undefined, blockers);
  const normalRun = deps(script, undefined, blockers);
  const observed = await observeShadowPressure(request(intents, pressured), shadowRun.deps);
  const normal = await orchestrateConstructDay(request(intents, pressured), normalRun.deps);
  const evaluation = observed.shadow.status === 'EVALUATED' ? observed.shadow.evaluation : undefined;
  const baselineSame = JSON.stringify(observed.result) === JSON.stringify(normal) && JSON.stringify(shadowRun.calls) === JSON.stringify(normalRun.calls);
  return { observed, evaluation, baselineSame, normal, calls: shadowRun.calls };
}
const SLOT: TimingCandidate[] = [timing('11:00', '12:00')];
const day = (r: any) => r.preview.constructedDay;

(async () => {
  console.log('=== REAL pipeline: basic contention, pressure, and the stronger dimensions ===');
  {
    const A = req('A', { originalOrder: 0 }); const B = req('B', { originalOrder: 1 });
    const basic = await pipeline([A, B], ['B'], [SLOT, SLOT, []]);
    const b = find(basic.evaluation!, 'B');
    check('BASIC ELIGIBLE (real pipeline): B (pressured: scarce Friday, resolved duration) loses real contention to A, is finally Deferred, and differs from A only by originalOrder -> PRESSURE_ELIGIBLE_AGAINST_ALL_FINAL_OWNERS', b.pressure === LKO && b.classification === 'PRESSURE_ELIGIBLE_AGAINST_ALL_FINAL_OWNERS' && b.owners.length === 1 && b.owners[0].ownerIntentId === 'A' && b.finalState === 'FINAL_DEFERRED');
    check('SCHEDULING IS THE BASELINE: the shadow run\'s Constructor result, loader calls and searches are identical to a normal run -- A Proposed, B Deferred (NO_CANDIDATES after the conflicted replenishment)', basic.baselineSame && day(basic.observed.result).proposedItems.map((p: any) => p.intentId).join() === 'A' && day(basic.observed.result).deferredItems[0].primaryReason === 'NO_CANDIDATES' && basic.observed.result.status === 'READY');
    const none = await pipeline([A, B], [], [SLOT, SLOT, []]);
    check('NONE CONTROL: the same real contention with NO pressure facts (pressure NONE) is NOT_PRESSURED', find(none.evaluation!, 'B').classification === 'NOT_PRESSURED' && find(none.evaluation!, 'B').pressure === 'NONE' && none.baselineSame);
    const importance = await pipeline([req('A', { importance: 'HIGH', originalOrder: 0 }), req('B', { importance: 'LOW', originalOrder: 1 })], ['B'], [SLOT, SLOT, []]);
    check('IMPORTANCE CONTROL: a pressured LOW loses to HIGH -> BLOCKED_BY_STRONGER_OWNER (explicit user value is never overridden by temporal pressure)', find(importance.evaluation!, 'B').classification === 'BLOCKED_BY_STRONGER_OWNER' && importance.baselineSame);
    const deadlineToday = await pipeline([req('A', { deadline: FRIDAY, originalOrder: 0 }), req('B', { originalOrder: 1 })], ['B'], [SLOT, SLOT, []]);
    check('DEADLINE-TODAY CONTROL: a pressured candidate that loses to an owner with its deadline today -> BLOCKED_BY_STRONGER_OWNER', find(deadlineToday.evaluation!, 'B').classification === 'BLOCKED_BY_STRONGER_OWNER' && deadlineToday.baselineSame);
    const deadline = await pipeline([req('A', { deadline: '2026-10-10', originalOrder: 0 }), req('B', { originalOrder: 1 })], ['B'], [SLOT, SLOT, []]);
    check('DEADLINE CONTROL: a pressured candidate that loses to an owner with a stronger non-today deadline (importance tied) -> BLOCKED_BY_STRONGER_OWNER', find(deadline.evaluation!, 'B').classification === 'BLOCKED_BY_STRONGER_OWNER' && deadline.baselineSame);
    const reversed = await pipeline([B, A], ['B'], [SLOT, SLOT, []]);
    check('REVERSE INPUT: submitting the intents in reverse order leaves the Constructor outcome (A Proposed, B Deferred) and the shadow classification unchanged', JSON.stringify(find(reversed.evaluation!, 'B')) === JSON.stringify(b) && reversed.baselineSame);
  }

  console.log('=== REAL pipeline: multiple owners (a real P3a multi-owner trace) ===');
  {
    const A1 = req('A1', { durationMinutes: 30, originalOrder: 0 }); const A2 = req('A2', { durationMinutes: 30, originalOrder: 1 }); const B = req('B', { originalOrder: 2 });
    const script = [[timing('11:00', '11:30')], [timing('11:30', '12:00')], [timing('11:15', '12:15')], []];
    const allTie = await pipeline([A1, A2, B], ['B'], script);
    const o = find(allTie.evaluation!, 'B');
    check('MULTI-OWNER ALL-TIE (real): B\'s one attempted interval overlaps TWO Proposed owners (the trace holds two events); both tie above pressure -> eligible against ALL final owners, with both owners in the observation', o.owners.map((x) => x.ownerIntentId).sort().join() === 'A1,A2' && o.contentionEventCount === 2 && o.classification === 'PRESSURE_ELIGIBLE_AGAINST_ALL_FINAL_OWNERS' && allTie.baselineSame);
    const mixed = await pipeline([A1, req('A2', { durationMinutes: 30, importance: 'HIGH', originalOrder: 1 }), B], ['B'], script);
    const m = find(mixed.evaluation!, 'B');
    check('MULTI-OWNER MIXED (real): one owner ties, the other has HIGHER importance -> BLOCKED_BY_STRONGER_OWNER; per-owner results are recorded', m.classification === 'BLOCKED_BY_STRONGER_OWNER' && m.owners.map((x) => x.comparison).sort().join() === 'OWNER_STRONGER_ABOVE_PRESSURE,TIES_ABOVE_PRESSURE' && mixed.baselineSame);
  }

  console.log('=== REAL pipeline: historical vs final owners across replenishment rounds ===');
  {
    // Round 0: G (HIGH) takes S3; H loses S3 to G; O takes S2; L loses S2 to O. H is re-searched and takes S2 in round 1,
    // pushing O out; L (re-searched) either loses to H again or has no candidates left.
    const G = req('G', { importance: 'HIGH', originalOrder: 0 }); const Hh = req('H', { originalOrder: 1 }); const O = req('O', { originalOrder: 2 }); const Lo = req('L', { originalOrder: 3 });
    const S3 = [timing('11:00', '12:00')]; const S2 = [timing('13:00', '14:00')];
    const remains = await pipeline([G, Hh, O, Lo], ['L'], [S3, S3, S2, S2, S2, S2]);
    const l = find(remains.evaluation!, 'L');
    check('HISTORICAL OWNER REMOVED (real): L first lost to O (round 0); O is later displaced (no longer Proposed) and L loses again to H (round 1). L\'s owners are {O: NOT_FINAL_PROPOSED (kept as evidence), H: FINAL_PROPOSED}; the aggregate is judged against the FINAL owner H only (tie -> eligible)', l.owners.map((x) => `${x.ownerIntentId}:${x.finalState}`).sort().join() === 'H:FINAL_PROPOSED,O:NOT_FINAL_PROPOSED' && l.classification === 'PRESSURE_ELIGIBLE_AGAINST_ALL_FINAL_OWNERS' && remains.baselineSame && day(remains.observed.result).proposedItems.map((p: any) => p.intentId).sort().join() === 'G,H');
    const gone = await pipeline([G, Hh, O, Lo], ['L'], [S3, S3, S2, S2, S2, [], []]);
    const g = find(gone.evaluation!, 'L');
    check('NO FINAL OWNER (real): L\'s only owner O is displaced and L is left with NO_CANDIDATES -> NO_FINAL_CONTENTION_OWNER; no promotion opportunity is inferred and the earlier conflict is still on record', g.classification === 'NO_FINAL_CONTENTION_OWNER' && g.owners.length === 1 && g.owners[0].ownerIntentId === 'O' && g.owners[0].finalState === 'NOT_FINAL_PROPOSED' && day(gone.observed.result).deferredItems.some((d: any) => d.intentId === 'L' && d.primaryReason === 'NO_CANDIDATES') && gone.baselineSame);
    const A = req('A', { originalOrder: 0 }); const B = req('B', { originalOrder: 1 });
    const placedLater = await pipeline([A, B], ['B'], [SLOT, SLOT, [timing('13:00', '14:00')]]);
    check('FINAL-PROPOSED CONTROL (real): B is pressured and genuinely contended, but replenishment finds it another slot and it ends Proposed -> NOT_FINAL_DEFERRED (never a promotion candidate)', find(placedLater.evaluation!, 'B').classification === 'NOT_FINAL_DEFERRED' && day(placedLater.observed.result).proposedItems.map((p: any) => p.intentId).sort().join() === 'A,B' && placedLater.baselineSame);
  }

  console.log('=== REAL pipeline: controls that are NOT contention, FIXED, fallback ===');
  {
    const A = req('A', { originalOrder: 0 }); const B = req('B', { originalOrder: 1 });
    const noCand = await pipeline([A, B], ['B'], [SLOT, []]);
    check('NO-CONTENTION CONTROL (real): B is pressured and finally Deferred because it has no candidate intervals (NO_CANDIDATES) -> NO_CONTENTION: a final Deferred reason or a pressured Deferral is never contention', find(noCand.evaluation!, 'B').classification === 'NO_CONTENTION' && find(noCand.evaluation!, 'B').contentionEventCount === 0 && noCand.baselineSame);
    const blocked = await pipeline([B], ['B'], [SLOT], [{ start: at('11:00'), end: at('12:00'), status: 'UPCOMING' }]);
    check('EXTERNAL BLOCKER (real): B is pressured and Deferred only because an existing plan occupies its slot -> NO_CONTENTION (candidate-vs-blocker is not candidate-vs-candidate contention)', find(blocked.evaluation!, 'B').classification === 'NO_CONTENTION' && day(blocked.observed.result).deferredItems[0].primaryReason === 'BLOCKED_BY_COMMITMENT' && blocked.baselineSame);
    const fixedLoser = await pipeline([req('F1', { flexibility: 'FIXED', fixedStart: at('11:00'), originalOrder: 0 }), req('F2', { flexibility: 'FIXED', fixedStart: at('11:30'), originalOrder: 1 })], ['F1', 'F2'], []);
    const f2 = find(fixedLoser.evaluation!, 'F2');
    check('FIXED (real): a FIXED candidate can genuinely lose contention (it has a trace event) but is NEVER pressured -- P2b gives FIXED pressure NONE even with scarce evidence -> NOT_PRESSURED', f2.contentionEventCount === 1 && f2.pressure === 'NONE' && f2.classification === 'NOT_PRESSURED' && fixedLoser.baselineSame);
    const fallback = await pipeline([A, req('B', { originalOrder: 1, durationMinutes: undefined })], ['B'], [SLOT, SLOT, []]);
    check('FALLBACK CONTROL (real): a candidate whose duration comes from the generic fallback has pressure NONE upstream (the shadow stage never inspects the duration basis) -> NOT_PRESSURED', find(fallback.evaluation!, 'B').classification === 'NOT_PRESSURED' && find(fallback.evaluation!, 'B').pressure === 'NONE' && fallback.baselineSame);
  }

  console.log('=== source parity: automatic / manual / generic ===');
  {
    const shapes: Array<[string, string]> = [['A', 'B'], ['goal-demand:2026-10-09:ga-1', 'goal-demand:2026-10-09:ga-2'], ['plan-day-goal-ga-1', 'plan-day-goal-ga-2'], ['typed-1', 'typed-2']];
    const runs: string[] = [];
    for (const [a, b] of shapes) {
      const r = await pipeline([req(a, { originalOrder: 0 }), req(b, { originalOrder: 1 })], [b], [SLOT, SLOT, []]);
      runs.push(JSON.stringify(r.evaluation).split(JSON.stringify(a)).join('"OWNER"').split(JSON.stringify(b)).join('"LOSER"'));
    }
    check('AUTO / MANUAL / GENERIC PARITY: equivalent scheduling inputs with the same facts give the same pressure and the SAME shadow classification whether the ids look like automatic Goal demand, a manual hand-off or a generic typed intent (the shadow stage sees none of that)', runs.every((r) => r === runs[0]) && runs[0].includes('PRESSURE_ELIGIBLE_AGAINST_ALL_FINAL_OWNERS'));
  }

  console.log('=== inert: normal runs never compute a shadow observation; shadow failure never touches the result ===');
  {
    const A = req('A', { originalOrder: 0 }); const B = req('B', { originalOrder: 1 });
    const realEvaluate = evaluatorModule.evaluateShadowPressure; const realDerive = pressureModule.deriveDecisionPressure;
    let evaluateCalls = 0; let deriveCalls = 0;
    (evaluatorModule as any).evaluateShadowPressure = (...a: unknown[]) => { evaluateCalls += 1; return (realEvaluate as any)(...a); };
    (pressureModule as any).deriveDecisionPressure = (...a: unknown[]) => { deriveCalls += 1; return (realDerive as any)(...a); };
    try {
      const normalRun = deps([SLOT, SLOT, []]);
      await orchestrateConstructDay(request([A, B], ['B']), normalRun.deps);
      check('NORMAL PREVIEW PATH: `orchestrateConstructDay` computes no shadow observation and derives no pressure (zero calls to the evaluator or the pressure deriver)', evaluateCalls === 0 && deriveCalls === 0);
      const shadowRun = deps([SLOT, SLOT, []]);
      const ok = await observeShadowPressure(request([A, B], ['B']), shadowRun.deps);
      check('the shadow boundary derives pressure once per resolved intent and evaluates once, after construction', evaluateCalls === 1 && deriveCalls === 2 && ok.shadow.status === 'EVALUATED');
      const baseline = JSON.stringify(await orchestrateConstructDay(request([A, B], ['B']), deps([SLOT, SLOT, []]).deps));
      (evaluatorModule as any).evaluateShadowPressure = () => { throw new Error('shadow boom'); };
      const failing = await observeShadowPressure(request([A, B], ['B']), deps([SLOT, SLOT, []]).deps);
      check('FAIL OPEN (evaluator throws): the Constructor result is returned exactly as normal and the shadow outcome is UNAVAILABLE / EVALUATION_FAILED -- shadow code can never abort or alter a preview', JSON.stringify(failing.result) === baseline && failing.shadow.status === 'UNAVAILABLE' && (failing.shadow as { reason: string }).reason === 'EVALUATION_FAILED');
      (evaluatorModule as any).evaluateShadowPressure = realEvaluate;
      (pressureModule as any).deriveDecisionPressure = () => { throw new Error('derive boom'); };
      const failingDerive = await observeShadowPressure(request([A, B], ['B']), deps([SLOT, SLOT, []]).deps);
      check('FAIL OPEN (pressure derivation throws): same -- the result is untouched and the shadow outcome is UNAVAILABLE', JSON.stringify(failingDerive.result) === baseline && failingDerive.shadow.status === 'UNAVAILABLE');
      const notReady = await observeShadowPressure({ ...request([A, B], ['B']), timezone: '' }, deps([SLOT, SLOT, []]).deps);
      check('a run that is not READY (here a missing timezone) returns its result untouched with the shadow outcome UNAVAILABLE / RUN_NOT_READY', notReady.result.status === 'TIMEZONE_MISSING' && notReady.shadow.status === 'UNAVAILABLE' && (notReady.shadow as { reason: string }).reason === 'RUN_NOT_READY');
    } finally {
      (evaluatorModule as any).evaluateShadowPressure = realEvaluate;
      (pressureModule as any).deriveDecisionPressure = realDerive;
    }
    const sign = (r: unknown) => JSON.stringify(signPreviewResultBody('user-1', r as Record<string, unknown>));
    const shadowed = await observeShadowPressure(request([A, B], ['B']), deps([SLOT, SLOT, []]).deps);
    const plain = await orchestrateConstructDay(request([A, B], ['B']), deps([SLOT, SLOT, []]).deps);
    check('TOKENS: the signed preview body, every acceptance token included, is identical with and without the shadow stage; the preview carries no shadow output', sign(shadowed.result) === sign(plain) && sign(plain).includes('acceptanceToken') && !JSON.stringify(shadowed.result).toLowerCase().includes('shadow'));
  }

  if (!allPassed) { console.error('SOME SHADOW PRESSURE EVALUATION CHECKS FAILED'); process.exitCode = 1; return; }
  console.log('ALL SHADOW PRESSURE EVALUATION CHECKS PASSED');
})().then(() => process.exit(), (err) => { console.error(err); process.exit(1); });
