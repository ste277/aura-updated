/**
 * Constructor Decision Intelligence -- O5 P4b1: the IMMUTABLE CONSTRUCTION BASIS (pure behavior, no DB).
 *
 * Part 1 drives the pure module with controlled inputs: ownership, deep freeze, entry-vs-empty candidate semantics, invalid dates,
 * duplicate ids, fail-closed assembly. Part 2 drives the REAL orchestrator (real preparer, projection, evidence stage, pressure,
 * replenishment and Constructor; only data loaders and the timing search are injected): the basis is captured at the right points
 * of the SAME run (initial candidates at T1, before replenishment overwrites them; final at T3), shares NO mutable object or Date
 * with the baseline working state or result, leaves the baseline result and signed tokens byte-identical, repeats no search, runs
 * no extra Constructor pass, makes no extra loader call, and can never make the baseline fail.
 *
 * Date caveat, stated honestly: `Object.freeze` does not stop a Date setter changing a Date's internal time. Safety here is OWNERSHIP
 * (every basis Date is a new Date) plus the #208 no-Date-mutator architecture guard -- the tests prove ownership, never "freeze
 * protects the Date". Product / architecture invariants only: no timing, randomness, heap layout or query plan.
 */
import * as basisModule from '../apps/web/lib/constructionBasis';
import { assembleConstructionBasis, captureCandidateLists, type ConstructionBasis, type ConstructionBasisOutcome } from '../apps/web/lib/constructionBasis';
import * as constructorModule from '../apps/web/lib/dayConstructor';
import type { ConstructDayInput, PlacementCandidate } from '../apps/web/lib/dayConstructor';
import { orchestrateConstructDay, orchestrateConstructDayWithDiagnostics, type ConstructDayRequest, type DayConstructorOrchestratorDeps, type RequestedDayIntent } from '../apps/web/lib/dayConstructorOrchestrator';
import { signPreviewResultBody } from '../apps/web/lib/dayConstructorPreviewIntegrity';
import { createDecisionFactPreparer } from '../apps/web/lib/decisionFactPreparation';
import type { DecisionFacts } from '../apps/web/lib/decisionFacts';
import type { OpportunityRangeDeps } from '../apps/web/lib/opportunityRangeAdapter';
import type { AvailabilityConfiguration } from '../apps/web/lib/availabilityContext';
import type { DayIntent, ConstructionWindow } from '../apps/web/lib/dayIntent';
import type { TimingCandidate } from '../packages/recommendation/src/timingSearch';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const throwsTypeError = (fn: () => void) => { try { fn(); return false; } catch (e) { return e instanceof TypeError; } };
/** every object (arrays, plain objects AND Dates) reachable from a value */
const reachable = (v: unknown, seen = new Set<unknown>()): Set<unknown> => { if (v !== null && typeof v === 'object' && !seen.has(v)) { seen.add(v); Object.values(v as Record<string, unknown>).forEach((c) => reachable(c, seen)); } return seen; };
const datesIn = (v: unknown) => [...reachable(v)].filter((o): o is Date => o instanceof Date);
const disjoint = (a: Set<unknown>, b: Set<unknown>) => [...a].every((o) => !b.has(o));
const ready = (o: ConstructionBasisOutcome): ConstructionBasis => { if (o.status !== 'READY') throw new Error(`basis ${o.reason}`); return o.basis; };

// ============================================================
// Part 1 -- the pure module
// ============================================================
const T = '2026-10-09';
const D = (h: string) => new Date(`${T}T${h}:00Z`);
const cand = (intentId: string, s: string, e: string, order: number, fit?: PlacementCandidate['timingFit']): PlacementCandidate => ({ intentId, start: D(s), end: D(e), ...(fit ? { timingFit: fit } : {}), candidateOrder: order });
const intent = (id: string, over: Partial<DayIntent> = {}): DayIntent => ({ id, title: id, importance: 'MEDIUM', flexibility: 'FLEXIBLE', source: 'USER_TYPED', originalOrder: 0, estimatedDurationMinutes: 60, ...over } as DayIntent);
const window: ConstructionWindow = { date: T, timezone: 'UTC', start: D('09:00'), end: D('17:00'), source: 'EXPLICIT_RANGE' } as ConstructionWindow;
function source() {
  const facts = { recurrence: { period: 'LOCAL_CALENDAR_WEEK' } } as unknown as DecisionFacts;
  const A = intent('A', { activityId: 'workout', deadline: '2026-10-10', decisionFacts: facts, activityFamily: 'EXERCISE' as never });
  const F = intent('F', { flexibility: 'FIXED', importance: 'HIGH', originalOrder: 1 });
  const initial = { A: [cand('A', '11:00', '12:00', 0, 'BEST'), cand('A', '13:00', '14:00', 1)], N: [] as PlacementCandidate[] };
  const final = { A: [cand('A', '13:00', '14:00', 0)], N: [] as PlacementCandidate[] };
  const fixed = { F: [{ intentId: 'F', start: D('13:00'), end: D('14:00') }] };
  const blockers = [{ start: D('15:00'), end: D('16:00'), source: 'FIXED_PLAN' as const }];
  const intents = [A, F, intent('N', { originalOrder: 2 })];
  const initialLists = captureCandidateLists(['A', 'F', 'N'], initial);
  return { facts, intents, initial, final, fixed, blockers, initialLists, input: { planningDate: T, window, intents, blockedIntervals: blockers, initialCandidates: initialLists, finalCandidatesByIntentId: final, fixedConstraintsByIntentId: fixed } };
}

console.log('=== the pure module: contents, candidate-entry semantics, ownership ===');
{
  const s = source();
  const out = assembleConstructionBasis(s.input);
  const basis = ready(out);
  check('READY with exactly the documented top-level fields (planningDate, window, intents, blockedIntervals, initialCandidates, finalCandidates, fixedConstraints) -- no policy, evidence, facts, pressure or source field', out.status === 'READY' && Object.keys(basis).sort().join() === 'blockedIntervals,finalCandidates,fixedConstraints,initialCandidates,intents,planningDate,window');
  check('INTENTS: request order, ids / titles / importance / deadline / duration / flexibility / originalOrder preserved exactly; decision facts, activity family and DayIntent source are NOT carried; nothing renumbered', basis.intents.map((i) => i.id).join() === 'A,F,N' && basis.intents[0].deadline === '2026-10-10' && basis.intents[0].activityId === 'workout' && basis.intents[1].flexibility === 'FIXED' && basis.intents[1].originalOrder === 1 && basis.intents[2].originalOrder === 2 && basis.intents.every((i) => !('decisionFacts' in i) && !('activityFamily' in i) && !('source' in i)) && Object.keys(basis.intents[0]).sort().join() === 'activityId,deadline,estimatedDurationMinutes,flexibility,id,importance,originalOrder,title');
  check('ABSENT optional fields stay ABSENT (no `undefined` keys): an intent without activityId / deadline has neither key', !('activityId' in basis.intents[1]) && !('deadline' in basis.intents[1]));
  check('WINDOW: date, timezone and both instants copied; the window `source` kind (unread by the Constructor) is not carried', basis.window.date === T && basis.window.timezone === 'UTC' && basis.window.start.getTime() === D('09:00').getTime() && basis.window.end.getTime() === D('17:00').getTime() && Object.keys(basis.window).sort().join() === 'date,end,start,timezone');
  check('BLOCKERS and FIXED authority copied exactly (blocker source tag, fixed constraint instants and intent id)', basis.blockedIntervals.length === 1 && basis.blockedIntervals[0].source === 'FIXED_PLAN' && basis.blockedIntervals[0].start.getTime() === D('15:00').getTime() && basis.fixedConstraints.length === 1 && basis.fixedConstraints[0].intentId === 'F' && basis.fixedConstraints[0].constraints[0].end.getTime() === D('14:00').getTime());
  check('CANDIDATE ENTRY SEMANTICS: A and N have entries, F (never searched) has none; N\'s entry is an EMPTY list ("searched, nothing usable") -- absent and empty are distinguished, in request order, in BOTH collections', basis.initialCandidates.map((l) => l.intentId).join() === 'A,N' && basis.finalCandidates.map((l) => l.intentId).join() === 'A,N' && basis.initialCandidates[1].candidates.length === 0 && !basis.initialCandidates.some((l) => l.intentId === 'F'));
  check('INITIAL vs FINAL: the initial list keeps both candidates exactly (timingFit, candidateOrder 0 and 1) while the final list holds the terminal one -- the two are captured separately and not merged or reordered', basis.initialCandidates[0].candidates.map((c) => `${c.start.toISOString().slice(11, 16)}:${c.timingFit ?? '-'}:${c.candidateOrder}`).join() === '11:00:BEST:0,13:00:-:1' && basis.finalCandidates[0].candidates.map((c) => `${c.start.toISOString().slice(11, 16)}:${c.candidateOrder}`).join() === '13:00:0' && !('timingFit' in basis.finalCandidates[0].candidates[0]));
  const sourceObjects = new Set<unknown>([...reachable(s.intents), ...reachable(s.initial), ...reachable(s.final), ...reachable(s.fixed), ...reachable(s.blockers), ...reachable(window), ...reachable(s.initialLists)]);
  check('OWNERSHIP: the basis shares NO object, array or Date with any source (intents, candidate maps, fixed constraints, blockers, window, even the T1 capture)', disjoint(reachable(basis), sourceObjects));
  check('INITIAL and FINAL candidate objects are separately owned (no object is shared between the two collections), though they may be equal by value', disjoint(reachable(basis.initialCandidates), reachable(basis.finalCandidates)));
  const datePairs: Array<[Date, Date]> = [[basis.window.start, window.start], [basis.window.end, window.end], [basis.blockedIntervals[0].start, s.blockers[0].start], [basis.blockedIntervals[0].end, s.blockers[0].end], [basis.fixedConstraints[0].constraints[0].start, s.fixed.F[0].start], [basis.fixedConstraints[0].constraints[0].end, s.fixed.F[0].end], [basis.initialCandidates[0].candidates[0].start, s.initial.A[0].start], [basis.initialCandidates[0].candidates[1].end, s.initial.A[1].end], [basis.finalCandidates[0].candidates[0].start, s.final.A[0].start], [basis.finalCandidates[0].candidates[0].end, s.final.A[0].end]];
  check(`EVERY DATE-BEARING PATH (${datePairs.length} audited: window start/end, blocker start/end, FIXED start/end, initial candidate start/end, final candidate start/end): basisDate !== sourceDate and basisDate.getTime() === sourceDate.getTime()`, datePairs.every(([b, o]) => b !== o && b.getTime() === o.getTime()) && datesIn(basis).length === 12);
  check('DEEP FREEZE: the basis, every array, every nested object and every (owned) Date is frozen; writes at every depth throw', [...reachable(basis)].every((o) => Object.isFrozen(o)) && throwsTypeError(() => { (basis as { planningDate: string }).planningDate = 'x'; }) && throwsTypeError(() => { (basis.intents as unknown as unknown[]).push({}); }) && throwsTypeError(() => { (basis.initialCandidates[0].candidates[0] as { candidateOrder: number }).candidateOrder = 9; }) && throwsTypeError(() => { (basis.window as { timezone: string }).timezone = 'x'; }));
  const frozenDate = Object.freeze(new Date(5)); frozenDate.setTime(9);
  check('THE FREEZE CAVEAT IS REAL AND NOT RELIED ON: `Object.freeze(new Date(...))` does NOT stop `setTime` -- (demonstrated in this test only); basis Dates are protected by OWNERSHIP plus the #208 no-Date-mutator guard, which is why no test here mutates a basis Date and calls it safe', frozenDate.getTime() === 9);
  const before = JSON.stringify(basis);
  s.initial.A.push(cand('A', '16:00', '17:00', 2)); s.initial.A[0].start.setTime(0); s.intents[0].title = 'changed'; s.intents[0].originalOrder = 99; s.blockers[0].start.setTime(0); s.blockers.push({ start: D('1:00'), end: D('2:00'), source: 'FIXED_PLAN' }); s.fixed.F[0].end.setTime(0); window.start.setTime(0); s.final.A[0].start.setTime(0); s.initialLists![0].candidates.length;
  check('SOURCE MUTATION AFTER CREATION (test only): pushing to a source array, changing source fields and calling setTime on SOURCE Dates leaves the basis byte-identical', JSON.stringify(basis) === before);
  window.start = D('09:00');
}

console.log('=== the pure module: fail-closed and semantics ===');
{
  const s = source();
  check('DUPLICATE INTENT IDS make the neutral authority ambiguous: UNAVAILABLE / DUPLICATE_INTENT_ID, never a last-write-wins basis', JSON.stringify(assembleConstructionBasis({ ...s.input, intents: [intent('A'), intent('A', { originalOrder: 1 })] })) === JSON.stringify({ status: 'UNAVAILABLE', reason: 'DUPLICATE_INTENT_ID' }));
  check('a missing T1 capture (it could not be taken) is UNAVAILABLE / ASSEMBLY_FAILED -- never a basis without its initial authority', JSON.stringify(assembleConstructionBasis({ ...s.input, initialCandidates: undefined })) === JSON.stringify({ status: 'UNAVAILABLE', reason: 'ASSEMBLY_FAILED' }));
  check('a non-Date where a Date must be copied makes the whole basis UNAVAILABLE (no partial basis, nothing thrown out of the module)', JSON.stringify(assembleConstructionBasis({ ...s.input, window: { ...window, start: '2026-10-09T09:00:00Z' as unknown as Date } })) === JSON.stringify({ status: 'UNAVAILABLE', reason: 'ASSEMBLY_FAILED' }) && captureCandidateLists(['A'], { A: [{ ...cand('A', '11:00', '12:00', 0), start: 'x' as unknown as Date }] }) === undefined);
  const invalid = new Date(Number.NaN);
  const out = assembleConstructionBasis({ ...s.input, finalCandidatesByIntentId: { A: [{ ...cand('A', '11:00', '12:00', 0), start: invalid }] } });
  check('INVALID DATE: baseline semantics are preserved, not normalized -- an Invalid Date candidate copies as an Invalid Date (the Constructor classifies it MALFORMED_CANDIDATE itself); the basis is a NEW instance', out.status === 'READY' && Number.isNaN(out.basis.finalCandidates[0].candidates[0].start.getTime()) && out.basis.finalCandidates[0].candidates[0].start !== invalid);
  check('NO CANDIDATE INVENTION: an intent absent from the candidate map gets no entry in either collection; an empty list stays an empty entry', ready(assembleConstructionBasis({ ...s.input, initialCandidates: captureCandidateLists(['A', 'F', 'N'], {}), finalCandidatesByIntentId: { N: [] } })).initialCandidates.length === 0 && ready(assembleConstructionBasis({ ...s.input, initialCandidates: captureCandidateLists(['A', 'F', 'N'], {}), finalCandidatesByIntentId: { N: [] } })).finalCandidates.map((l) => `${l.intentId}:${l.candidates.length}`).join() === 'N:0');
  check('COLLECTION ORDER follows the intent (request) order, never object-key or insertion order of the candidate map', ready(assembleConstructionBasis({ ...s.input, finalCandidatesByIntentId: { N: [], A: s.final.A } })).finalCandidates.map((l) => l.intentId).join() === 'A,N');
  const realNow = Date.now; let nowCalls = 0; (Date as unknown as { now: () => number }).now = () => { nowCalls += 1; return realNow(); };
  try { assembleConstructionBasis(s.input); captureCandidateLists(['A'], s.final); } finally { (Date as unknown as { now: () => number }).now = realNow; }
  check('NO CLOCK: assembling and capturing call Date.now zero times (all time values are copies of existing instants)', nowCalls === 0);
  check('ASSEMBLY DOES NOT MUTATE ITS SOURCE: the source intents (including their decision facts), candidate maps and fixed constraints are unchanged by an assembly', JSON.stringify(s.intents) === JSON.stringify(source().intents) && JSON.stringify(s.final) === JSON.stringify(source().final) && JSON.stringify(s.fixed) === JSON.stringify(source().fixed));
}

// ============================================================
// Part 2 -- the REAL orchestrator
// ============================================================
type Weekday = AvailabilityConfiguration['periods'][number]['weekday'];
const FRIDAY = '2026-10-09';
const workWeek: AvailabilityConfiguration = { configured: true, periods: ([1, 2, 3, 4, 5] as Weekday[]).map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })) };
const rangeDeps: OpportunityRangeDeps = { loadAvailabilityConfiguration: async () => workWeek, loadPlansOverlappingRange: async () => [] };
const at = (h: string) => new Date(`${FRIDAY}T${h}:00Z`);
const timing = (s: string, e: string): TimingCandidate => ({ start: `${FRIDAY}T${s}:00Z`, end: `${FRIDAY}T${e}:00Z`, score: 5, label: 'GOOD', muhurtaScore: 0, reasons: [], metadata: { windowType: 'NEUTRAL', windowLabel: 'x', activityType: 'x', dateLabel: FRIDAY } });
const overlaps = (c: TimingCandidate, e: { start: Date; end: Date }) => new Date(c.start).getTime() < e.end.getTime() && e.start.getTime() < new Date(c.end).getTime();
const req = (id: string, over: Partial<RequestedDayIntent> = {}): RequestedDayIntent => ({ id, title: id, flexibility: 'FLEXIBLE', durationMinutes: 60, originalOrder: 0, ...over } as RequestedDayIntent);
const request = (intents: RequestedDayIntent[], over: Partial<ConstructDayRequest> = {}): ConstructDayRequest => ({ targetDate: FRIDAY, timezone: 'UTC', constructionWindowSource: 'EXPLICIT_RANGE', now: at('09:00'), explicitStart: at('09:00'), explicitEnd: at('17:00'), intents, ...over });
interface Counts { searches: number; blockers: number; duration: number; availability: number; searchLog: Array<{ title: string; candidates: string[] }> }
const newCounts = (): Counts => ({ searches: 0, blockers: 0, duration: 0, availability: 0, searchLog: [] });
/** an honest timing search: per-intent pools filtered by the request's excludedIntervals (like the real engine); or a scripted one by call index */
function mkDeps(plans: Array<{ start: Date; end: Date; status: 'UPCOMING' }>, search: (r: any) => TimingCandidate[], counts: Counts): DayConstructorOrchestratorDeps {
  return {
    loadBlockingPlans: async () => { counts.blockers += 1; return plans; },
    loadDurationContext: async () => { counts.duration += 1; return { preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} }; },
    searchTiming: (r: any) => { counts.searches += 1; const c = search(r); counts.searchLog.push({ title: r.taskTitle ?? r.activityId, candidates: c.map((x) => x.start.slice(11, 16)) }); return { candidates: c }; },
    loadAvailabilityConfiguration: async () => { counts.availability += 1; return { configured: false, periods: [] }; },
    prepareDecisionFacts: createDecisionFactPreparer(rangeDeps),
  };
}
const honest = (pools: Record<string, TimingCandidate[]>) => (r: any) => ((pools[r.taskTitle ?? r.activityId] ?? []).filter((c) => !(r.excludedIntervals ?? []).some((e: { start: Date; end: Date }) => overlaps(c, e))));
const scripted = (script: TimingCandidate[][]) => { let n = 0; return () => script[n++] ?? []; };

/** run the diagnostics path while recording the Constructor inputs (the orchestrator's real mutable working objects) */
async function runWithBasis(intents: RequestedDayIntent[], plans: Array<{ start: Date; end: Date; status: 'UPCOMING' }>, search: (r: any) => TimingCandidate[], over: Partial<ConstructDayRequest> = {}) {
  const counts = newCounts(); const inputs: ConstructDayInput[] = []; let constructions = 0;
  const realTrace = constructorModule.constructDayWithTrace;
  (constructorModule as any).constructDayWithTrace = (input: ConstructDayInput, round?: number) => { constructions += 1; inputs.push(input); return realTrace(input, round); };
  const rq = request(intents, over);
  try {
    const diag = await orchestrateConstructDayWithDiagnostics(rq, mkDeps(plans, search, counts));
    return { diag, counts, inputs, constructions, rq };
  } finally { (constructorModule as any).constructDayWithTrace = realTrace; }
}
async function runPlain(intents: RequestedDayIntent[], plans: Array<{ start: Date; end: Date; status: 'UPCOMING' }>, search: (r: any) => TimingCandidate[], over: Partial<ConstructDayRequest> = {}) {
  const counts = newCounts(); let constructions = 0;
  const realConstruct = constructorModule.constructDay;
  (constructorModule as any).constructDay = (input: ConstructDayInput) => { constructions += 1; return realConstruct(input); };
  try { const result = await orchestrateConstructDay(request(intents, over), mkDeps(plans, search, counts)); return { result, counts, constructions }; } finally { (constructorModule as any).constructDay = realConstruct; }
}
const S1 = timing('11:00', '12:00'); const S2 = timing('13:00', '14:00'); const S3 = timing('15:00', '16:00');
const hhmm = (d: Date) => d.toISOString().slice(11, 16);
const listOf = (lists: ConstructionBasis['initialCandidates'], id: string) => lists.find((l) => l.intentId === id)?.candidates.map((c) => hhmm(c.start)).join('|');

(async () => {
  console.log('=== REAL orchestrator: the replenishment case closes the P4b0 hand-off gap ===');
  {
    // A (order 0) takes 11:00; B (order 1) loses it, is replenished (the real excludedIntervals now cover A's slot) and finds nothing.
    const intents = [req('A', { originalOrder: 0 }), req('B', { originalOrder: 1 })];
    const run = await runWithBasis(intents, [], honest({ A: [S1], B: [S1] }));
    const basis = ready(run.diag.constructionBasis);
    check('REPLENISHED (real): B\'s INITIAL list still holds the 11:00 slot it lost, while its FINAL list is the replenished authority (empty) -- the overwritten list exists only because it was captured at T1, with no search repeated', listOf(basis.initialCandidates, 'B') === '11:00' && listOf(basis.finalCandidates, 'B') === '' && basis.finalCandidates.some((l) => l.intentId === 'B') && listOf(basis.initialCandidates, 'A') === '11:00' && listOf(basis.finalCandidates, 'A') === '11:00');
    check('the real search log proves the capture came from the ORIGINAL search: B was searched twice (initial, then replenished with a larger exclusion), A once; the basis holds the first of B\'s results and the last', run.counts.searchLog.filter((l) => l.title === 'B').length === 2 && run.counts.searchLog.filter((l) => l.title === 'B')[0].candidates.join() === '11:00' && run.counts.searchLog.filter((l) => l.title === 'B')[1].candidates.join() === '');
    const plain = await runPlain(intents, [], honest({ A: [S1], B: [S1] }));
    check('NO EXTRA WORK: the number of timing searches, blocker / duration / availability loader calls and Constructor passes is IDENTICAL with and without the basis (searches ' + run.counts.searches + ', Constructor passes ' + run.constructions + ')', run.counts.searches === plain.counts.searches && run.counts.blockers === plain.counts.blockers && run.counts.duration === plain.counts.duration && run.counts.availability === plain.counts.availability && run.constructions === plain.constructions && run.constructions >= 2);
    check('BASELINE IDENTITY: the Constructor / orchestrator result with the basis is deep-identical to the plain orchestration, and the signed preview body (every acceptance token included) is byte-identical', JSON.stringify(run.diag.result) === JSON.stringify(plain.result) && JSON.stringify(signPreviewResultBody('user-1', run.diag.result as unknown as Record<string, unknown>)) === JSON.stringify(signPreviewResultBody('user-1', plain.result as unknown as Record<string, unknown>)) && JSON.stringify(signPreviewResultBody('user-1', plain.result as unknown as Record<string, unknown>)).includes('acceptanceToken'));
    check('NOT PUBLIC: the orchestration result carries no basis; the basis is only on the internal diagnostics outcome', !JSON.stringify(run.diag.result).toLowerCase().includes('basis') && !JSON.stringify(plain.result).toLowerCase().includes('basis') && Object.keys(run.diag).sort().join() === 'constructionBasis,contentionTrace,evidenceByIntentId,planningDate,result');
  }

  console.log('=== REAL orchestrator: multi-round replenishment ===');
  {
    const G = req('G', { importance: 'HIGH', originalOrder: 0 }); const H = req('H', { originalOrder: 1 }); const O = req('O', { originalOrder: 2 }); const L = req('L', { originalOrder: 3 });
    const script = [[S1], [S1], [S2], [S2], [S2], [S2]];
    const run = await runWithBasis([G, H, O, L], [], scripted(script));
    const basis = ready(run.diag.constructionBasis);
    const firstOf = (t: string) => run.counts.searchLog.find((l) => l.title === t)!.candidates.join('|');
    const lastOf = (t: string) => [...run.counts.searchLog].reverse().find((l) => l.title === t)!.candidates.join('|');
    check('MULTI-ROUND (real, scripted search from the P3b fixture): more than one replenishment search ran; for EVERY flexible intent the basis\'s initial list equals its FIRST search result and its final list equals its LAST', run.counts.searches > 4 && ['G', 'H', 'O', 'L'].every((t) => listOf(basis.initialCandidates, t) === firstOf(t) && listOf(basis.finalCandidates, t) === lastOf(t)) && ['H', 'L'].some((t) => firstOf(t) !== lastOf(t) || run.counts.searchLog.filter((l) => l.title === t).length > 1));
    const plain = await runPlain([G, H, O, L], [], scripted(script));
    check('the multi-round run is untouched by the basis: identical result, searches and Constructor passes', JSON.stringify(run.diag.result) === JSON.stringify(plain.result) && run.counts.searches === plain.counts.searches && run.constructions === plain.constructions);
  }

  console.log('=== REAL orchestrator: a mixed day (FIXED + FLEXIBLE + external blocker + empty search) ===');
  {
    const plans = [{ start: at('15:00'), end: at('16:00'), status: 'UPCOMING' as const }];
    const fixedStart = at('13:00');
    const intents = [req('A', { originalOrder: 0, importance: 'HIGH' }), req('X', { flexibility: 'FIXED', fixedStart, originalOrder: 1 } as Partial<RequestedDayIntent>), req('N', { originalOrder: 2 })];
    const run = await runWithBasis(intents, plans, honest({ A: [S1, S2, S3], N: [] }));
    const basis = ready(run.diag.constructionBasis);
    check('MIXED DAY: intents in request order with FIXED / FLEXIBLE preserved; the external blocker carried (plan blocker copy; the search already excluded it, so A\'s list has no 15:00 slot); the FIXED constraint carried; FIXED X has NO candidate entry while searched N has an EMPTY one', basis.intents.map((i) => `${i.id}:${i.flexibility}`).join() === 'A:FLEXIBLE,X:FIXED,N:FLEXIBLE' && basis.blockedIntervals.some((b) => b.source === 'FIXED_PLAN' && b.start.getTime() === at('15:00').getTime() && b.end.getTime() === at('16:00').getTime()) && basis.fixedConstraints.length === 1 && basis.fixedConstraints[0].intentId === 'X' && basis.fixedConstraints[0].constraints[0].start.getTime() === fixedStart.getTime() && basis.fixedConstraints[0].constraints[0].end.getTime() === at('14:00').getTime() && !basis.initialCandidates.some((l) => l.intentId === 'X') && basis.initialCandidates.find((l) => l.intentId === 'N')!.candidates.length === 0 && listOf(basis.initialCandidates, 'A') === '11:00|13:00');
    check('the window, planning date and durations are the baseline\'s own (no recomputation): 09:00-17:00 UTC on the request date, durations 60, originalOrder untouched', basis.planningDate === FRIDAY && basis.window.start.getTime() === at('09:00').getTime() && basis.window.end.getTime() === at('17:00').getTime() && basis.window.timezone === 'UTC' && basis.intents.every((i) => i.estimatedDurationMinutes === 60) && basis.intents.map((i) => i.originalOrder).join() === '0,1,2');
    check('NO POLICY / SOURCE / FACTS ANYWHERE: no key or value anywhere in the basis names pressure, promotion, owner, facts, evidence, shadow, Goal, recurrence or opportunity', !/pressure|promotion|owner|decisionfacts|evidence|shadow|goal|recurrence|opportunity|provenance|manual|automatic/i.test(JSON.stringify(basis)));
    // ---- detachment from the orchestrator's REAL working objects ----
    const working = new Set<unknown>([...run.inputs.flatMap((i) => [...reachable(i)]), ...reachable(run.diag.result), ...reachable(run.rq), ...reachable(plans), fixedStart]);
    check(`DETACHED FROM THE BASELINE WORKING STATE: none of the ${reachable(basis).size} objects / Dates in the basis is reachable from the recorded Constructor inputs (the live candidate map, intents, blockers, FIXED constraints, window), the Constructor result (Proposed / Deferred), the resolved intents, the request or the loader-supplied plans`, disjoint(reachable(basis), working) && run.inputs.length >= 1);
    const proposed = (run.diag.result as any).preview.constructedDay.proposedItems as Array<{ intentId: string; start: Date; end: Date }>;
    const aItem = proposed.find((p) => p.intentId === 'A')!;
    const aFinal = basis.finalCandidates.find((l) => l.intentId === 'A')!.candidates.find((c) => c.start.getTime() === aItem.start.getTime())!;
    check('CONSTRUCTOR-RESULT DETACHMENT: A\'s Proposed interval equals its selected candidate by value but shares no Date with the basis (the Proposed item aliases the orchestrator\'s own candidate Date, not the basis copy)', !!aFinal && aFinal.start !== aItem.start && aFinal.end !== aItem.end && aFinal.end.getTime() === aItem.end.getTime());
    const snapshot = JSON.stringify(basis);
    const live = run.inputs[run.inputs.length - 1];
    live.window.start.setTime(0); live.blockedIntervals[0]?.start.setTime(0); aItem.start.setTime(0); aItem.end.setTime(0); fixedStart.setTime(0); plans[0].start.setTime(0);
    Object.values(live.candidatesByIntentId).forEach((list) => { list.forEach((c) => c.start.setTime(0)); (list as PlacementCandidate[]).length = 0; });
    (live.intents as DayIntent[]).forEach((i) => { i.title = 'mutated'; i.originalOrder = -5; });
    check('SOURCE MUTATION (test only): after the run, setTime on the SOURCE window / blocker / FIXED / Proposed / candidate Dates, emptying the live candidate lists and rewriting the live intents leaves the basis byte-identical', JSON.stringify(basis) === snapshot);
    check('DEEP FREEZE on the real basis: every object, array and (owned) Date reachable from it is frozen', [...reachable(basis)].every((o) => Object.isFrozen(o)));
    const again = await runWithBasis([req('A', { originalOrder: 0, importance: 'HIGH' }), req('X', { flexibility: 'FIXED', fixedStart: at('13:00'), originalOrder: 1 } as Partial<RequestedDayIntent>), req('N', { originalOrder: 2 })], [{ start: at('15:00'), end: at('16:00'), status: 'UPCOMING' }], honest({ A: [S1, S2, S3], N: [] }));
    check('DETERMINISM: an identical run assembles a byte-identical basis', JSON.stringify(ready(again.diag.constructionBasis)) === snapshot);
    const reversed = await runWithBasis([...intents].reverse(), [{ start: at('15:00'), end: at('16:00'), status: 'UPCOMING' }], honest({ A: [S1, S2, S3], N: [] }));
    check('ORDER: collection order follows the REQUEST order (reversing the request reverses the intents and the candidate-list order) and never the candidate map\'s key order', ready(reversed.diag.constructionBasis).intents.map((i) => i.id).join() === 'N,X,A' && ready(reversed.diag.constructionBasis).initialCandidates.map((l) => l.intentId).join() === 'N,A');
  }

  console.log('=== REAL orchestrator: no-replenishment, FIXED-only, no-candidate, source parity ===');
  {
    const none = await runWithBasis([req('A', { originalOrder: 0 }), req('C', { originalOrder: 1 })], [], honest({ A: [S1], C: [S2] }));
    const nb = ready(none.diag.constructionBasis);
    check('NO REPLENISHMENT: initial and final lists are equal by value for every intent yet are separately owned objects', JSON.stringify(nb.initialCandidates) === JSON.stringify(nb.finalCandidates) && disjoint(reachable(nb.initialCandidates), reachable(nb.finalCandidates)) && none.counts.searches === 2);
    const fixedOnly = await runWithBasis([req('F1', { flexibility: 'FIXED', fixedStart: at('11:00'), originalOrder: 0 } as Partial<RequestedDayIntent>)], [], honest({}));
    const fb = ready(fixedOnly.diag.constructionBasis);
    check('FIXED-ONLY DAY: deterministic -- the FIXED constraint is captured, both candidate collections are empty (nothing was searched), and no search ran', fb.fixedConstraints.length === 1 && fb.initialCandidates.length === 0 && fb.finalCandidates.length === 0 && fixedOnly.counts.searches === 0);
    const empty = await runWithBasis([req('N', { originalOrder: 0 })], [], honest({ N: [] }));
    const eb = ready(empty.diag.constructionBasis);
    check('NO-CANDIDATE FLEXIBLE: the intent has an entry with an EMPTY list in both collections (searched, found nothing), not an absent entry', eb.initialCandidates.length === 1 && eb.initialCandidates[0].candidates.length === 0 && eb.finalCandidates.length === 1 && eb.finalCandidates[0].candidates.length === 0);
    const shapes: Array<[string, string]> = [['ow-1', 'lo-2'], ['goal-demand:2026-10-09:ga-1', 'goal-demand:2026-10-09:ga-2'], ['plan-day-goal-ga-1', 'plan-day-goal-ga-2'], ['typed-1', 'typed-2']];
    const shaped: string[] = [];
    for (const [a, b] of shapes) {
      const r = await runWithBasis([req(a, { originalOrder: 0 }), req(b, { originalOrder: 1 })], [], honest({ [a]: [S1], [b]: [S1] }));
      shaped.push(JSON.stringify(ready(r.diag.constructionBasis)).split(a).join('OWNER').split(b).join('LOSER'));
    }
    check('SOURCE NEUTRALITY: ids shaped like automatic Goal demand, a manual hand-off and a generic typed intent assemble structurally identical bases (the basis sees ids and neutral scheduling fields only)', shaped.every((x) => x === shaped[0]) && shaped[0].includes('LOSER'));
  }

  console.log('=== the basis can never affect the baseline ===');
  {
    const intents = [req('A', { originalOrder: 0 }), req('B', { originalOrder: 1 })];
    const plain = await runPlain(intents, [], honest({ A: [S1], B: [S1] }));
    const realAssemble = basisModule.assembleConstructionBasis; const realCapture = basisModule.captureCandidateLists;
    let assembles = 0; let captures = 0;
    (basisModule as any).assembleConstructionBasis = (...a: unknown[]) => { assembles += 1; return (realAssemble as any)(...a); };
    (basisModule as any).captureCandidateLists = (...a: unknown[]) => { captures += 1; return (realCapture as any)(...a); };
    try {
      await orchestrateConstructDay(request(intents), mkDeps([], honest({ A: [S1], B: [S1] }), newCounts()));
      check('NORMAL PATH COST: `orchestrateConstructDay` (the preview\'s entry point) performs no basis capture and no assembly -- zero calls', assembles === 0 && captures === 0);
      const diag = await orchestrateConstructDayWithDiagnostics(request(intents), mkDeps([], honest({ A: [S1], B: [S1] }), newCounts()));
      check('the diagnostics entry performs exactly one T1 capture and one T4 assembly, through the same orchestration', assembles === 1 && captures === 1 && diag.constructionBasis.status === 'READY');
      (basisModule as any).assembleConstructionBasis = () => { throw new Error('assembly boom'); };
      const failing = await orchestrateConstructDayWithDiagnostics(request(intents), mkDeps([], honest({ A: [S1], B: [S1] }), newCounts()));
      check('FAILURE ISOLATION (assembly throws): the baseline result is deep-identical to the plain run, the signed body is unchanged, and the basis is UNAVAILABLE / ASSEMBLY_FAILED -- no partial basis', JSON.stringify(failing.result) === JSON.stringify(plain.result) && JSON.stringify(signPreviewResultBody('u', failing.result as unknown as Record<string, unknown>)) === JSON.stringify(signPreviewResultBody('u', plain.result as unknown as Record<string, unknown>)) && JSON.stringify(failing.constructionBasis) === JSON.stringify({ status: 'UNAVAILABLE', reason: 'ASSEMBLY_FAILED' }));
      (basisModule as any).assembleConstructionBasis = realAssemble;
      (basisModule as any).captureCandidateLists = () => { throw new Error('capture boom'); };
      const failingCapture = await orchestrateConstructDayWithDiagnostics(request(intents), mkDeps([], honest({ A: [S1], B: [S1] }), newCounts()));
      check('FAILURE ISOLATION (the T1 capture throws): same -- the baseline is untouched and the basis is UNAVAILABLE (never built without its initial authority)', JSON.stringify(failingCapture.result) === JSON.stringify(plain.result) && failingCapture.constructionBasis.status === 'UNAVAILABLE');
    } finally { (basisModule as any).assembleConstructionBasis = realAssemble; (basisModule as any).captureCandidateLists = realCapture; }
    const dup = await orchestrateConstructDayWithDiagnostics(request([req('A', { originalOrder: 0 }), req('A', { originalOrder: 1 }), req('B', { originalOrder: 2 })]), mkDeps([], honest({ A: [S1], B: [S2] }), newCounts()));
    const dupPlain = await orchestrateConstructDay(request([req('A', { originalOrder: 0 }), req('A', { originalOrder: 1 }), req('B', { originalOrder: 2 })]), mkDeps([], honest({ A: [S1], B: [S2] }), newCounts()));
    check('DUPLICATE REQUEST IDS: the baseline result is exactly what the plain orchestration returns, and the basis fails closed -- UNAVAILABLE / DUPLICATE_INTENT_ID', JSON.stringify(dup.result) === JSON.stringify(dupPlain) && JSON.stringify(dup.constructionBasis) === JSON.stringify({ status: 'UNAVAILABLE', reason: 'DUPLICATE_INTENT_ID' }));
    const notReady = await orchestrateConstructDayWithDiagnostics(request(intents, { timezone: '' }), mkDeps([], honest({}), newCounts()));
    check('a run that is not READY (here a missing timezone) has no basis: UNAVAILABLE / RUN_NOT_READY, result untouched', notReady.result.status === 'TIMEZONE_MISSING' && JSON.stringify(notReady.constructionBasis) === JSON.stringify({ status: 'UNAVAILABLE', reason: 'RUN_NOT_READY' }));
    const searchFailure = await orchestrateConstructDayWithDiagnostics(request(intents), { ...mkDeps([], honest({}), newCounts()), searchTiming: () => { throw new Error('search down'); } });
    check('a timing-search failure (a typed domain outcome) still returns its own result and a basis that is UNAVAILABLE -- the optional basis never changes what the baseline reports', searchFailure.result.status === 'TIMING_SEARCH_FAILED' && searchFailure.constructionBasis.status === 'UNAVAILABLE');
  }

  if (!allPassed) { console.error('SOME CONSTRUCTION BASIS CHECKS FAILED'); process.exitCode = 1; return; }
  console.log('ALL CONSTRUCTION BASIS CHECKS PASSED');
})().then(() => process.exit(), (err) => { console.error(err); process.exit(1); });
