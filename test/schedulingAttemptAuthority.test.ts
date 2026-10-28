/**
 * Constructor Decision Intelligence -- O5 P4b2b: the IMMUTABLE SCHEDULING ATTEMPT AUTHORITY (pure behavior, no DB).
 *
 * WHY. P4b2-R showed two independent authority gaps, both caused by ephemeral intermediate candidate lists: (1) the promotion contention
 * authority had no Constructor-neutral timing fit, so P's several historical slots could not be ranked (trace order is NOT the
 * Constructor's ranking); (2) `initialCandidates UNION finalCandidates` cannot relocate an owner whose only usable alternative sat in an
 * intermediate replenishment list. P3a already observes "intent attempted slot X with this candidate and lost it to owner Y"; it now also
 * carries the candidate's own descriptive `timingFit`, and ONE normalization projects those events into typed scheduling attempts (the
 * run-level authority) of which the promotion contention authority is a scoped view. No candidate list is captured per round.
 *
 * Part 1 pins the P3a payload: the exact variable (the candidate's own `timingFit`), emission / count unchanged, the Constructor result
 * byte-identical. Part 2 reproduces, on the REAL orchestrator, the three directed fixtures: GOOD@10:00 vs BEST@11:30 (trace order !=
 * neutral ranking), P@10:00 (absent from P's initial and final lists) and O@09:30 (absent from O's initial and final lists, carrying its
 * exact fit). Part 3 pins the semantics (same-slot multi-owner, union dedup, origin parity, pressure parity, trace-order independence,
 * fail-closed). Part 4 pins the same-run composition: typed pairs, run-level basis / placements / attempts, the committed MIDDLE-FAILURE
 * alignment test, failure isolation, normal path zero work. Part 5 is the FULL-HISTORY ORACLE property sweep: scratch instrumentation
 * retains every candidate list of every replenishment round (test-only, never production) and the future authority set
 * (initial UNION final UNION attempts) must reproduce the best neutral owner relocation under the real `compareCandidatesForPlacement`.
 *
 * Date caveat, stated honestly: `Object.freeze` does not stop a Date setter changing a Date's internal time. Safety is OWNERSHIP plus the
 * #208 no-Date-mutator guard. Product / architecture invariants only: no timing, randomness, heap layout or query plan.
 */
import { rankedShuffle } from './fixtureSupport';
import * as attemptModule from '../apps/web/lib/schedulingAttemptAuthority';
import { projectSchedulingAttempts, normalizeSchedulingAttempts, type SchedulingAttempt, type SchedulingAttemptOutcome } from '../apps/web/lib/schedulingAttemptAuthority';
import * as contentionModule from '../apps/web/lib/promotionContentionAuthority';
import { projectContentionAuthority } from '../apps/web/lib/promotionContentionAuthority';
import { preparePromotionInputs, type PromotionRunAuthority } from '../apps/web/lib/promotionInputPreparation';
import type { PromotionInput } from '../apps/web/lib/promotionInput';
import { compareCandidatesForPlacement, constructDay, constructDayWithTrace, type ConstructDayInput, type PlacementCandidate, type PlacementTimingFit } from '../apps/web/lib/dayConstructor';
import { compareByOverloadPrecedence } from '../apps/web/lib/dayIntent';
import { contentionEventKey, type ContentionEvent, type ContentionTrace } from '../apps/web/lib/contentionTrace';
import { orchestrateConstructDay, orchestrateConstructDayWithDiagnostics, type ConstructDayRequest, type DayConstructorOrchestratorDeps, type RequestedDayIntent } from '../apps/web/lib/dayConstructorOrchestrator';
import { createDecisionFactPreparer } from '../apps/web/lib/decisionFactPreparation';
import type { DecisionFacts } from '../apps/web/lib/decisionFacts';
import type { OpportunityRangeDeps } from '../apps/web/lib/opportunityRangeAdapter';
import type { AvailabilityConfiguration } from '../apps/web/lib/availabilityContext';
import type { ConstructionBasis, ConstructionBasisOutcome } from '../apps/web/lib/constructionBasis';
import type { TimingCandidate } from '../packages/recommendation/src/timingSearch';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const reachable = (v: unknown, seen = new Set<unknown>()): Set<unknown> => { if (v !== null && typeof v === 'object' && !seen.has(v)) { seen.add(v); Object.values(v as Record<string, unknown>).forEach((c) => reachable(c, seen)); } return seen; };
const disjoint = (a: Set<unknown>, b: Set<unknown>) => [...a].every((o) => !b.has(o));
const throwsTypeError = (fn: () => void) => { try { fn(); return false; } catch (e) { return e instanceof TypeError; } };

type Weekday = AvailabilityConfiguration['periods'][number]['weekday'];
const FRIDAY = '2026-10-09';
const workWeek: AvailabilityConfiguration = { configured: true, periods: ([1, 2, 3, 4, 5] as Weekday[]).map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })) };
const rangeDeps: OpportunityRangeDeps = { loadAvailabilityConfiguration: async () => workWeek, loadPlansOverlappingRange: async () => [] };
const at = (h: string) => new Date(`${FRIDAY}T${h}:00Z`);
const iso = (h: string) => `${FRIDAY}T${h}:00.000Z`;
const T = (h: string) => new Date(iso(h)).getTime();
const hhmm = (d: Date | string | number) => new Date(d).toISOString().slice(11, 16);
type Label = 'EXCELLENT' | 'GOOD' | 'USABLE' | 'CAUTION';
const FIT: Record<Label, PlacementTimingFit> = { EXCELLENT: 'BEST', GOOD: 'GOOD', USABLE: 'WORKABLE', CAUTION: 'CAUTION' };
interface PoolItem { slot: [string, string]; label: Label }
const item = (a: string, b: string, label: Label = 'GOOD'): PoolItem => ({ slot: [a, b], label });
const overlapsMs = (aS: number, aE: number, bS: number, bE: number) => aS < bE && bS < aE;
const WEEK_FACTS: DecisionFacts = { recurrence: { period: 'LOCAL_CALENDAR_WEEK', periodStartDate: '2026-10-05', periodEndDate: '2026-10-11', targetPerPeriod: 3, completedInPeriod: 0, committedInPeriod: 0, remainingInPeriod: 3 } };
const req = (id: string, order: number, over: Partial<RequestedDayIntent> = {}): RequestedDayIntent => ({ id, title: id, flexibility: 'FLEXIBLE', durationMinutes: 60, originalOrder: order, ...over } as RequestedDayIntent);
const request = (intents: RequestedDayIntent[], pressured: string[]): ConstructDayRequest => ({
  targetDate: FRIDAY, timezone: 'UTC', constructionWindowSource: 'EXPLICIT_RANGE', now: at('09:00'), explicitStart: at('09:00'), explicitEnd: at('17:00'), intents,
  decisionFactsByIntentId: new Map(pressured.map((id) => [id, WEEK_FACTS] as [string, DecisionFacts])),
});
interface Calls { search: number; plans: number; duration: number; availability: number }
type History = Record<string, Array<Array<{ start: number; fit: PlacementTimingFit }>>>;
/** An HONEST search: filters its pool by `excludedIntervals` BEFORE truncating to `limit` (the real search's order). Retains EVERY list it ever returns into `hist` -- a scratch ORACLE, never production. */
function mkDeps(pools: Record<string, PoolItem[]>, limit: number, hist: History = {}, blockers: Array<{ start: Date; end: Date; status: 'UPCOMING' }> = [], calls: Calls = { search: 0, plans: 0, duration: 0, availability: 0 }): { deps: DayConstructorOrchestratorDeps; calls: Calls; hist: History } {
  return {
    calls, hist,
    deps: {
      loadBlockingPlans: async () => { calls.plans += 1; return blockers; },
      loadDurationContext: async () => { calls.duration += 1; return { preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} }; },
      searchTiming: (r: any) => {
        calls.search += 1;
        const id = r.taskTitle as string;
        const out = (pools[id] ?? []).filter((p) => !(r.excludedIntervals ?? []).some((e: { start: Date; end: Date }) => T(p.slot[0]) < e.end.getTime() && e.start.getTime() < T(p.slot[1]))).slice(0, limit);
        (hist[id] ??= []).push(out.map((p) => ({ start: T(p.slot[0]), fit: FIT[p.label] })));
        const candidates: TimingCandidate[] = out.map((p) => ({ start: iso(p.slot[0]), end: iso(p.slot[1]), score: 5, label: p.label, muhurtaScore: 0, reasons: [], metadata: { windowType: 'NEUTRAL', windowLabel: 'x', activityType: 'x', dateLabel: FRIDAY } }));
        return { candidates };
      },
      loadAvailabilityConfiguration: async () => { calls.availability += 1; return { configured: false, periods: [] }; },
      prepareDecisionFacts: createDecisionFactPreparer(rangeDeps),
    },
  };
}
const ready = <T extends { status: string }>(o: T): Extract<T, { status: 'READY' }> => { if (o.status !== 'READY') throw new Error(`not READY: ${JSON.stringify(o)}`); return o as Extract<T, { status: 'READY' }>; };
const attemptShape = (a: SchedulingAttempt) => `${a.intentId}@${hhmm(a.start)}-${hhmm(a.end)}:${a.timingFit ?? '-'}:[${a.conflictingOwnerIds.join(',')}]`;
const asPC = (id: string, start: number, fit: PlacementTimingFit | undefined, order = 0): PlacementCandidate => ({ intentId: id, start: new Date(start), end: new Date(start + 3600000), timingFit: fit, candidateOrder: order });
const rankBy = (id: string, items: Array<{ start: number; fit?: PlacementTimingFit }>) => [...items].sort((a, b) => compareCandidatesForPlacement(asPC(id, a.start, a.fit), asPC(id, b.start, b.fit)));
const evt = (loser: string, winner: string, s: string, e: string, round = 0, fit?: PlacementTimingFit): ContentionEvent => ({ loserIntentId: loser, winnerIntentId: winner, attemptedStart: iso(s), attemptedEnd: iso(e), winnerStart: iso(s), winnerEnd: iso(e), round, ...(fit === undefined ? {} : { timingFit: fit }) });
const traceOf = (events: ContentionEvent[]): ContentionTrace => ({ events });
const runOf = (p: { run: PromotionRunAuthority }) => { if (p.run.status !== 'PREPARED') throw new Error('run not prepared'); return p.run; };

(async () => {
  // ======================================================================
  console.log('=== Part 1: the P3a observation point -- the candidate\'s OWN timing fit, descriptive only ===');
  {
    // Direct Constructor trace: O owns 10:00-11:00; P offers GOOD@10:00 and BEST@10:30 (both conflict). The FIXED loser has no candidate, hence no fit.
    const cand = (intentId: string, s: string, e: string, timingFit: PlacementTimingFit | undefined, candidateOrder: number): PlacementCandidate => ({ intentId, start: at(s), end: at(e), timingFit, candidateOrder });
    const mkInput = (fits: [PlacementTimingFit | undefined, PlacementTimingFit | undefined]): ConstructDayInput => ({
      intents: [
        { id: 'O', title: 'O', importance: 'MEDIUM', flexibility: 'FLEXIBLE', estimatedDurationMinutes: 60, originalOrder: 0 },
        { id: 'P', title: 'P', importance: 'MEDIUM', flexibility: 'FLEXIBLE', estimatedDurationMinutes: 60, originalOrder: 1 },
        { id: 'F', title: 'F', importance: 'MEDIUM', flexibility: 'FIXED', estimatedDurationMinutes: 60, originalOrder: 2 },
        { id: 'G', title: 'G', importance: 'MEDIUM', flexibility: 'FIXED', estimatedDurationMinutes: 60, originalOrder: 3 },
      ] as never,
      window: { date: FRIDAY, timezone: 'UTC', start: at('09:00'), end: at('17:00'), source: 'EXPLICIT_RANGE' } as never,
      blockedIntervals: [],
      candidatesByIntentId: { O: [cand('O', '10:00', '11:00', 'GOOD', 0)], P: [cand('P', '10:00', '11:00', fits[0], 0), cand('P', '10:30', '11:30', fits[1], 1)] },
      fixedConstraintsByIntentId: { F: [{ intentId: 'F', start: at('10:00'), end: at('11:00') }], G: [{ intentId: 'G', start: at('10:30'), end: at('11:30') }] },
      today: FRIDAY,
    });
    const withFit = constructDayWithTrace(mkInput(['GOOD', 'BEST']));
    const noFit = constructDayWithTrace(mkInput([undefined, undefined]));
    const pEvents = withFit.trace.events.filter((e) => e.loserIntentId === 'P');
    check('THE SOURCE IS THE CANDIDATE ITSELF: each P contention event carries exactly the `timingFit` of the candidate that attempted that interval (GOOD for 10:00, BEST for 10:30) -- read at the rejection point, not recomputed or joined', pEvents.map((e) => `${hhmm(e.attemptedStart)}:${e.timingFit}`).join() === '10:00:GOOD,10:30:BEST');
    check('a candidate with NO timing fit yields an event with NO `timingFit` key (absent, never a guess), and a FIXED target (no candidate exists) carries none', noFit.trace.events.filter((e) => e.loserIntentId === 'P').every((e) => !('timingFit' in e)) && withFit.trace.events.filter((e) => e.loserIntentId === 'G').every((e) => !('timingFit' in e)) && withFit.trace.events.some((e) => e.loserIntentId === 'G'));
    check('EMISSION UNCHANGED: the same candidates with and without timing fits yield the identical event sequence by event identity (same count, owners, intervals, rounds) -- only the descriptive payload differs', withFit.trace.events.map(contentionEventKey).join('\n') === noFit.trace.events.map(contentionEventKey).join('\n') && withFit.trace.events.length === noFit.trace.events.length && withFit.trace.events.length >= 3);
    check('CONSTRUCTOR BEHAVIOR UNCHANGED: the traced result equals the plain `constructDay` result byte-for-byte (the payload is observational and write-only)', JSON.stringify(withFit.result) === JSON.stringify(constructDay(mkInput(['GOOD', 'BEST']))));
    check('the event contract is the old one plus the optional descriptive field: exactly loserIntentId, winnerIntentId, attemptedStart, attemptedEnd, winnerStart, winnerEnd, round, timingFit; the key set is detached strings (no Date, no candidate)', pEvents.every((e) => Object.keys(e).sort().join() === 'attemptedEnd,attemptedStart,loserIntentId,round,timingFit,winnerEnd,winnerIntentId,winnerStart') && pEvents.every((e) => Object.values(e).every((v) => typeof v === 'string' || typeof v === 'number')));
    check('CANDIDATE ORDER AUDIT: two attempts with equal timingFit and equal start place the SAME interval with the SAME fit, so `candidateOrder` can only label which duplicate was chosen -- it is not carried', (() => { const a = compareCandidatesForPlacement(asPC('X', 5, 'GOOD', 0), asPC('X', 5, 'GOOD', 7)); const sameSlot = [asPC('X', 5, 'GOOD', 0), asPC('X', 5, 'GOOD', 7)].sort(compareCandidatesForPlacement); return a < 0 && sameSlot[0].start.getTime() === sameSlot[1].start.getTime() && sameSlot[0].timingFit === sameSlot[1].timingFit; })());
  }

  // ======================================================================
  console.log('=== Part 2: directed fixtures on the REAL orchestrator ===');
  // (a) GOOD @ 10:00 first, BEST @ 11:30 second: trace order is not the neutral ranking.
  {
    const pools = { A: [item('10:00', '11:00')], B: [item('11:30', '12:30')], P: [item('10:00', '11:00', 'GOOD'), item('11:30', '12:30', 'EXCELLENT')] };
    const prepared = await preparePromotionInputs(request([req('A', 0), req('B', 1), req('P', 2)], ['A', 'B', 'P']), mkDeps(pools, 3).deps);
    const run = runOf(prepared);
    const attempts = ready(run.schedulingAttempts).authority.attempts.filter((a) => a.intentId === 'P');
    check('GOOD VS BEST (neutral ranking): P attempted GOOD@10:00 (trace order first) and BEST@11:30 (second); the authority carries both exact fits', attempts.map((a) => `${hhmm(a.start)}:${a.timingFit}`).join() === '10:00:GOOD,11:30:BEST');
    const ranked = rankBy('P', attempts.map((a) => ({ start: a.start.getTime(), fit: a.timingFit })));
    check('TRACE ORDER != NEUTRAL RANKING: the real `compareCandidatesForPlacement`, fed from the authority payload alone, ranks BEST@11:30 FIRST although the trace discovered GOOD@10:00 first', hhmm(ranked[0].start) === '11:30' && hhmm(attempts[0].start) === '10:00');
    const contention = ready(run.promotions[0].contention).authority.attempts;
    check('the promotion contention view carries the same fits, per authorized owner (A for 10:00, B for 11:30)', contention.map((a) => `${a.ownerIntentId}@${hhmm(a.start)}:${a.timingFit}`).join() === 'A@10:00:GOOD,B@11:30:BEST');
  }
  // (b) the earlier P example: 10:00 absent from P's initial and final candidates but present in the attempt authority.
  const BLOCKED_POOLS = { O: [item('11:00', '12:00')], B: [item('11:30', '12:30'), item('10:00', '11:00')], P: [item('10:30', '11:30'), item('10:00', '11:00')] };
  {
    const prepared = await preparePromotionInputs(request([req('O', 0), req('B', 1), req('P', 2)], ['O', 'B', 'P']), mkDeps(BLOCKED_POOLS, 1).deps);
    const run = runOf(prepared);
    const basis = ready(run.constructionBasis).basis;
    const att = ready(run.schedulingAttempts).authority.attempts;
    const pInit = basis.initialCandidates.find((l) => l.intentId === 'P')!.candidates.map((c) => hhmm(c.start));
    const pFinal = basis.finalCandidates.find((l) => l.intentId === 'P')!.candidates.map((c) => hhmm(c.start));
    check('P MISSING-INTERMEDIATE REGRESSION: 10:00 is NOT in P\'s initial list (10:30 only) and NOT in its final list (empty), and IS in the scheduling attempt authority with its exact fit (GOOD) against B', JSON.stringify(pInit) === '["10:30"]' && pFinal.length === 0 && att.some((a) => a.intentId === 'P' && hhmm(a.start) === '10:00' && a.timingFit === 'GOOD' && a.conflictingOwnerIds.join() === 'B'));
    const bInit = basis.initialCandidates.find((l) => l.intentId === 'B')!.candidates.map((c) => hhmm(c.start));
    const bFinal = basis.finalCandidates.find((l) => l.intentId === 'B')!.candidates.map((c) => hhmm(c.start));
    check('INITIAL-ONLY OWNER: B\'s 11:30 is available from the basis INITIAL list and not from its final list; B\'s terminal 10:00 is available from the basis FINAL list -- the attempts supplement, they do not replace, the basis', JSON.stringify(bInit) === '["11:30"]' && JSON.stringify(bFinal) === '["10:00"]');
    const bAttempt = att.find((a) => a.intentId === 'B' && hhmm(a.start) === '11:30');
    const dedup = new Map<string, number>(); [...basis.initialCandidates.find((l) => l.intentId === 'B')!.candidates.map((c) => ({ start: c.start.getTime(), fit: c.timingFit })), ...basis.finalCandidates.find((l) => l.intentId === 'B')!.candidates.map((c) => ({ start: c.start.getTime(), fit: c.timingFit })), ...att.filter((a) => a.intentId === 'B').map((a) => ({ start: a.start.getTime(), fit: a.timingFit }))].forEach((c) => dedup.set(`${c.start}|${c.fit}`, (dedup.get(`${c.start}|${c.fit}`) ?? 0) + 1));
    check('UNION DEDUP: B\'s 11:30 appears in the basis (initial) AND as an attempt, with the same (start, timingFit) identity -- one scheduling choice, not two', !!bAttempt && bAttempt.timingFit === 'GOOD' && [...dedup.keys()].length === 2 && (dedup.get(`${T('11:30')}|GOOD`) ?? 0) === 2);
  }
  // (c) the directed OWNER counterexample: O's usable alternative 09:30 exists only in an intermediate list.
  const DIRECTED_POOLS = {
    X: [item('13:00', '14:00')],
    Y: [item('13:00', '14:00'), item('10:00', '11:00')],
    O: [item('13:30', '14:30'), item('09:30', '10:30'), item('11:00', '12:00')],
    P: [item('13:30', '14:30'), item('10:30', '11:30'), item('11:30', '12:30')],
  };
  let directedHist: History = {};
  {
    directedHist = {};
    const prepared = await preparePromotionInputs(request([req('X', 0), req('Y', 1), req('O', 2), req('P', 3)], ['X', 'Y', 'O', 'P']), mkDeps(DIRECTED_POOLS, 1, directedHist).deps);
    const run = runOf(prepared);
    const basis = ready(run.constructionBasis).basis;
    const placements = ready(run.baselinePlacements).placements.placements;
    const att = ready(run.schedulingAttempts).authority.attempts;
    check('DIRECTED COUNTEREXAMPLE REPRODUCED (real orchestrator): X@13:00, Y@10:00, O@11:00 placed; P Deferred; P\'s authorized owners are X, Y and O', placements.map((p) => `${p.intentId}@${hhmm(p.start)}`).join() === 'X@13:00,Y@10:00,O@11:00' && prepared.promotion.status === 'PREPARED' && prepared.promotion.inputs.length === 1 && prepared.promotion.inputs[0].owners.map((o) => o.intentId).join() === 'X,Y,O');
    const oInit = basis.initialCandidates.find((l) => l.intentId === 'O')!.candidates.map((c) => hhmm(c.start));
    const oFinal = basis.finalCandidates.find((l) => l.intentId === 'O')!.candidates.map((c) => hhmm(c.start));
    check('MISSING FROM BASIS: O\'s 09:30 is ABSENT from O\'s initialCandidates (13:30) and from O\'s finalCandidates (11:00) -- it lived only in an intermediate replenishment list', JSON.stringify(oInit) === '["13:30"]' && JSON.stringify(oFinal) === '["11:00"]' && JSON.stringify(directedHist.O.map((l) => l.map((c) => hhmm(c.start)))) === '[["13:30"],["09:30"],["11:00"]]');
    const o0930 = att.find((a) => a.intentId === 'O' && hhmm(a.start) === '09:30');
    check('OWNER INTERMEDIATE SURVIVES: the scheduling attempt authority contains O @ 09:30-10:30 carrying the EXACT fit O had when attempting it (GOOD) and the historical provenance Y -- owner relocation authority no longer depends on the lost list', !!o0930 && o0930.timingFit === 'GOOD' && hhmm(o0930.end) === '10:30' && o0930.conflictingOwnerIds.join() === 'Y');
    check('NOT RESTRICTED TO P\'s OWNERS: O\'s own attempts are kept whatever owner they lost to (here Y and X), because their future availability is recomputed against the counterfactual placements', att.filter((a) => a.intentId === 'O').map((a) => `${hhmm(a.start)}:[${a.conflictingOwnerIds.join(',')}]`).join() === '13:30:[X],09:30:[Y]');
    // Sufficiency on the directed case: relocating O after P takes the historical slot 10:30-11:30 (displacing Y and O) with X pinned.
    const pinned = [[T('13:00'), T('14:00')]]; const pSlot = [T('10:30'), T('11:30')];
    const feasible = (cands: Array<{ start: number; fit?: PlacementTimingFit }>, occupied: number[][]) => rankBy('O', cands.filter((c) => !occupied.some((o) => overlapsMs(c.start, c.start + 3600000, o[0], o[1])))).slice(0, 1);
    const occ = [...pinned, pSlot];
    const unionOnly = [...basis.initialCandidates.find((l) => l.intentId === 'O')!.candidates, ...basis.finalCandidates.find((l) => l.intentId === 'O')!.candidates].map((c) => ({ start: c.start.getTime(), fit: c.timingFit }));
    const authoritySet = [...unionOnly, ...att.filter((a) => a.intentId === 'O').map((a) => ({ start: a.start.getTime(), fit: a.timingFit }))];
    const fullHistory = directedHist.O.flat().map((c) => ({ start: c.start, fit: c.fit }));
    check('SUFFICIENCY ON THE DIRECTED CASE: initial UNION final leaves O UNPLACED (the P4b2-R gap); initial UNION final UNION attempts reproduces the FULL-HISTORY best neutral result, O @ 09:30', feasible(unionOnly, occ).length === 0 && feasible(authoritySet, occ).map((c) => hhmm(c.start)).join() === '09:30' && feasible(fullHistory, occ).map((c) => hhmm(c.start)).join() === '09:30');
  }

  // ======================================================================
  console.log('=== Part 3: semantics ===');
  const blockedRun = async (pressured: string[] = ['O', 'B', 'P']) => preparePromotionInputs(request([req('O', 0), req('B', 1), req('P', 2)], pressured), mkDeps(BLOCKED_POOLS, 1).deps);
  const blockedDiag = await orchestrateConstructDayWithDiagnostics(request([req('O', 0), req('B', 1), req('P', 2)], ['O', 'B', 'P']), mkDeps(BLOCKED_POOLS, 1).deps);
  if (blockedDiag.result.status !== 'READY' || blockedDiag.constructionBasis.status !== 'READY' || blockedDiag.baselinePlacements.status !== 'READY') throw new Error('fixture not READY');
  const bOutcome: ConstructionBasisOutcome = blockedDiag.constructionBasis;
  {
    // identical slot against several owners: A 10:00-11:00, B 11:00-12:00, P candidate 10:30-11:30 overlaps BOTH.
    const pools = { A: [item('10:00', '11:00')], B: [item('11:00', '12:00')], P: [item('10:30', '11:30', 'EXCELLENT')] };
    const prepared = await preparePromotionInputs(request([req('A', 0), req('B', 1), req('P', 2)], ['A', 'B', 'P']), mkDeps(pools, 1).deps);
    const run = runOf(prepared);
    const att = ready(run.schedulingAttempts).authority.attempts.filter((a) => a.intentId === 'P');
    check('IDENTICAL SLOT, MULTIPLE OWNERS: ONE attempted candidate conflicting with A and B is ONE scheduling attempt (one slot, one fit) listing BOTH conflicting owners -- no relationship is lost', att.length === 1 && attemptShape(att[0]) === 'P@10:30-11:30:BEST:[A,B]');
    const view = ready(run.promotions[0].contention).authority.attempts;
    check('the promotion contention view expands that one slot to one record per authorized owner (A and B), both with the same interval and fit -- a consumer groups them as one slot', view.length === 2 && view.every((a) => hhmm(a.start) === '10:30' && a.timingFit === 'BEST') && view.map((a) => a.ownerIntentId).join() === 'A,B');
  }
  {
    // origin parity: the same candidate values rank identically whatever their origin.
    const basis: ConstructionBasis = bOutcome.status === 'READY' ? bOutcome.basis : (undefined as never);
    const att = ready(projectSchedulingAttempts(blockedDiag.contentionTrace, bOutcome)).authority.attempts;
    const fromBasis = basis.initialCandidates.find((l) => l.intentId === 'B')!.candidates.map((c) => ({ start: c.start.getTime(), fit: c.timingFit }));
    const fromAttempt = att.filter((a) => a.intentId === 'B').map((a) => ({ start: a.start.getTime(), fit: a.timingFit }));
    const mixedA = rankBy('B', [...fromBasis, ...fromAttempt]); const mixedB = rankBy('B', [...fromAttempt, ...fromBasis]);
    check('ORIGIN PARITY: a candidate from the basis and the same candidate from an attempt rank identically (same position under the real comparator) in any input order -- origin is never a ranking dimension', JSON.stringify(mixedA.map((c) => [c.start, c.fit])) === JSON.stringify(mixedB.map((c) => [c.start, c.fit])) && fromBasis.some((b) => fromAttempt.some((a) => a.start === b.start && a.fit === b.fit)));
  }
  {
    const r1 = await blockedRun(['O', 'B', 'P']); const r2 = await blockedRun(['P']);
    check('OWNER PRESSURE PARITY: with owners pressured (LAST_KNOWN_OPPORTUNITY) vs not (NONE) the run-level attempts and the contention view are byte-identical -- pressure never reaches the attempts', JSON.stringify(runOf(r1).schedulingAttempts) === JSON.stringify(runOf(r2).schedulingAttempts) && JSON.stringify(runOf(r1).promotions.map((p) => p.contention)) === JSON.stringify(runOf(r2).promotions.map((p) => p.contention)) && r1.promotion.status === 'PREPARED' && r2.promotion.status === 'PREPARED' && r1.promotion.inputs[0].owners.every((o) => o.pressure === 'LAST_KNOWN_OPPORTUNITY') && r2.promotion.inputs[0].owners.every((o) => o.pressure === 'NONE'));
  }
  {
    const events = blockedDiag.contentionTrace.events as ContentionEvent[];
    const setOf = (list: readonly SchedulingAttempt[]) => list.map((a) => `${attemptShape(a).replace(/\[[^\]]*\]/, '')}|${[...a.conflictingOwnerIds].sort().join(',')}`).sort().join('\n');
    const base = setOf(ready(projectSchedulingAttempts(blockedDiag.contentionTrace, bOutcome)).authority.attempts);
    let identical = true; let rankingEqual = true;
    const rankOf = (list: readonly SchedulingAttempt[]) => rankBy('P', list.filter((a) => a.intentId === 'P').map((a) => ({ start: a.start.getTime(), fit: a.timingFit }))).map((c) => `${c.start}:${c.fit}`).join();
    const baseRank = rankOf(ready(projectSchedulingAttempts(blockedDiag.contentionTrace, bOutcome)).authority.attempts);
    for (let k = 0; k < 8; k += 1) {
      const shuffled = [...events]; for (let i = shuffled.length - 1; i > 0; i -= 1) { const j = (i * 7 + k * 3) % (i + 1); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
      const out = ready(projectSchedulingAttempts(traceOf(shuffled), bOutcome)).authority.attempts;
      if (setOf(out) !== base) identical = false; if (rankOf(out) !== baseRank) rankingEqual = false;
    }
    check('RAW TRACE ORDER INDEPENDENCE: permuting the event order leaves the SET of attempts (intent, interval, fit, owner set) and the neutral ranking by `compareCandidatesForPlacement` unchanged -- only the order of discovery moves', identical && rankingEqual);
  }
  {
    const okTrace = traceOf([evt('P', 'O', '10:30', '11:30', 0, 'GOOD')]);
    const reasonOf = (o: SchedulingAttemptOutcome) => (o.status === 'UNAVAILABLE' ? o.reason : 'READY');
    check('INVALID timingFit (runtime payload not one of BEST / GOOD / WORKABLE / CAUTION) -> UNAVAILABLE / CAPTURE_FAILED (fail closed, never repaired)', reasonOf(projectSchedulingAttempts(traceOf([{ ...evt('P', 'O', '10:30', '11:30'), timingFit: 'EXCELLENT' as never }]), bOutcome)) === 'CAPTURE_FAILED' && reasonOf(projectSchedulingAttempts(okTrace, bOutcome)) === 'READY');
    check('INVALID DATE (unparseable instant, or start >= end) -> CAPTURE_FAILED', reasonOf(projectSchedulingAttempts(traceOf([{ ...evt('P', 'O', '10:30', '11:30'), attemptedStart: 'nope' }]), bOutcome)) === 'CAPTURE_FAILED' && reasonOf(projectSchedulingAttempts(traceOf([evt('P', 'O', '11:30', '10:30')]), bOutcome)) === 'CAPTURE_FAILED');
    check('UNKNOWN INTENT (attempting intent or conflicting owner not in the same run\'s basis) -> UNAVAILABLE / INCONSISTENT_INPUT', reasonOf(projectSchedulingAttempts(traceOf([evt('ZZ', 'O', '10:30', '11:30')]), bOutcome)) === 'INCONSISTENT_INPUT' && reasonOf(projectSchedulingAttempts(traceOf([evt('P', 'ZZ', '10:30', '11:30')]), bOutcome)) === 'INCONSISTENT_INPUT');
    check('basis not READY -> RUN_NOT_READY; a throwing source -> CAPTURE_FAILED; the empty trace is a valid READY authority with no attempts', reasonOf(projectSchedulingAttempts(okTrace, { status: 'UNAVAILABLE', reason: 'ASSEMBLY_FAILED' })) === 'RUN_NOT_READY' && reasonOf(projectSchedulingAttempts({ get events(): never { throw new Error('boom'); } } as unknown as ContentionTrace, bOutcome)) === 'CAPTURE_FAILED' && ready(projectSchedulingAttempts(traceOf([]), bOutcome)).authority.attempts.length === 0);
    check('NORMALIZATION: identical slots across owners and rounds merge (owners unioned in order of first appearance); slots differing in timingFit stay DISTINCT; a FIXED-style event without a fit is its own slot', (() => { const out = normalizeSchedulingAttempts(traceOf([evt('P', 'O', '10:30', '11:30', 0, 'GOOD'), evt('P', 'B', '10:30', '11:30', 0, 'GOOD'), evt('P', 'O', '10:30', '11:30', 1, 'GOOD'), evt('P', 'O', '10:30', '11:30', 2, 'BEST'), evt('P', 'O', '10:30', '11:30', 3)])); return out.map(attemptShape).join() === 'P@10:30-11:30:GOOD:[O,B],P@10:30-11:30:BEST:[O],P@10:30-11:30:-:[O]'; })());
    const input: PromotionInput = { candidateIntentId: 'P', owners: [{ intentId: 'O', pressure: 'NONE' }, { intentId: 'B', pressure: 'NONE' }] };
    const viaView = projectContentionAuthority(blockedDiag.contentionTrace, input, bOutcome, blockedDiag.baselinePlacements);
    const viaAttempts = ready(projectSchedulingAttempts(blockedDiag.contentionTrace, bOutcome)).authority.attempts.filter((a) => a.intentId === 'P');
    check('SINGLE SOURCE: the promotion contention view equals the run-level attempts of P filtered to the authorized owners and expanded per owner (start, end, fit all identical) -- there is no second semantic projection of the raw trace', ready(viaView).authority.attempts.map((a) => `${a.ownerIntentId}@${a.start.getTime()}-${a.end.getTime()}:${a.timingFit}`).join() === viaAttempts.flatMap((a) => a.conflictingOwnerIds.filter((o) => input.owners.some((w) => w.intentId === o)).map((o) => `${o}@${a.start.getTime()}-${a.end.getTime()}:${a.timingFit}`)).join());
  }
  {
    const out = ready(projectSchedulingAttempts(blockedDiag.contentionTrace, bOutcome));
    const sources = new Set<unknown>([...reachable(blockedDiag.contentionTrace), ...reachable(bOutcome), ...reachable(blockedDiag.baselinePlacements)]);
    check(`DETACHED: none of the ${reachable(out).size} attempt objects / Dates / arrays is reachable from the trace, the basis or the placements`, disjoint(reachable(out), sources));
    const view = ready(projectContentionAuthority(blockedDiag.contentionTrace, { candidateIntentId: 'P', owners: [{ intentId: 'O', pressure: 'NONE' }, { intentId: 'B', pressure: 'NONE' }] }, bOutcome, blockedDiag.baselinePlacements));
    check('the contention view\'s Dates are FRESH copies, not aliases of the run-level attempt Dates (mutating one world cannot reach the other)', disjoint(reachable(view), reachable(out)));
    check('DEEP FREEZE: the outcome, authority, attempts array, every attempt, every owner list and every Date is frozen; writes throw -- and the freeze is NOT claimed to protect a Date\'s time value', [...reachable(out)].every((o) => Object.isFrozen(o)) && throwsTypeError(() => { (out.authority.attempts as unknown as unknown[]).push({}); }) && throwsTypeError(() => { (out.authority.attempts[0].conflictingOwnerIds as unknown as string[]).push('x'); }) && throwsTypeError(() => { (out.authority.attempts[0] as { intentId: string }).intentId = 'x'; }));
    const snapshot = JSON.stringify(out);
    const sourceCopy = JSON.parse(JSON.stringify(blockedDiag.contentionTrace)) as { events: Array<{ attemptedStart: string }> };
    const fromCopy = ready(projectSchedulingAttempts(sourceCopy as unknown as ContentionTrace, bOutcome));
    const copySnapshot = JSON.stringify(fromCopy);
    sourceCopy.events.forEach((e) => { e.attemptedStart = 'x'; });
    check('SOURCE MUTATION (test only): changing the source trace strings after projection leaves the attempt authority byte-identical', JSON.stringify(fromCopy) === copySnapshot && JSON.stringify(out) === snapshot);
  }

  // ======================================================================
  console.log('=== Part 4: same-run composition, typed pairs, failure isolation ===');
  {
    const normal = mkDeps(BLOCKED_POOLS, 1); const plain = await orchestrateConstructDay(request([req('O', 0), req('B', 1), req('P', 2)], ['O', 'B', 'P']), normal.deps);
    const boundary = mkDeps(BLOCKED_POOLS, 1); const prepared = await preparePromotionInputs(request([req('O', 0), req('B', 1), req('P', 2)], ['O', 'B', 'P']), boundary.deps);
    const run = runOf(prepared);
    check('ONE RUN: the boundary performs exactly the normal run\'s timing searches and loader calls (no second orchestration, search, Constructor pass or read) and its Constructor result is identical to the normal orchestration', JSON.stringify(boundary.calls) === JSON.stringify(normal.calls) && JSON.stringify(prepared.result) === JSON.stringify(plain));
    check('RUN-LEVEL SHAPE: exactly { status, constructionBasis, baselinePlacements, schedulingAttempts, promotions, funnel (O5 SHADOW EVIDENCE: three counts, no identifier) } -- the basis and the placements appear ONCE, at run level, and every pair is exactly { input, contention }', Object.keys(run).sort().join() === 'baselinePlacements,constructionBasis,funnel,promotions,schedulingAttempts,status' && run.promotions.every((p) => Object.keys(p).sort().join() === 'contention,input') && !JSON.stringify(run.promotions).includes('constructionBasis') && !JSON.stringify(run.promotions).includes('placementSource'));
    check('SAME RUN: the basis, placements, attempts and every pair describe the same baseline (placements are the plain result\'s Proposed items; attempt and pair intents are basis intents)', ready(run.baselinePlacements).placements.placements.map((p) => p.intentId).join() === (plain.status === 'READY' ? plain.preview.constructedDay.proposedItems.map((p: { intentId: string }) => p.intentId).join() : '') && ready(run.schedulingAttempts).authority.attempts.every((a) => ready(run.constructionBasis).basis.intents.some((i) => i.id === a.intentId)));
    check('ID CROSS-CHECK: for every pair whose contention is READY, authority.candidateIntentId equals input.candidateIntentId', run.promotions.every((p) => p.contention.status !== 'READY' || p.contention.authority.candidateIntentId === p.input.candidateIntentId) && run.promotions.length === 1);
    check('P4a / P4a2 UNCHANGED: `promotion` is still { status: PREPARED, inputs } with the same input; the outer shape is exactly { result, promotion, run }', Object.keys(prepared.promotion).sort().join() === 'inputs,status' && Object.keys(prepared).sort().join() === 'promotion,result,run');
  }
  {
    // MIDDLE FAILURE (the #211 committed-suite gap): P1 READY, P2's projection throws, P3 READY. Pairing must stay P1->P1, P2->P2, P3->P3.
    const pools = { O: [item('11:00', '12:00')], P1: [item('11:00', '12:00')], P2: [item('11:00', '12:00'), item('11:30', '12:30')], P3: [item('11:00', '12:00')] };
    const intents = [req('O', 0), req('P1', 1), req('P2', 2), req('P3', 3)]; const ids = ['O', 'P1', 'P2', 'P3'];
    const base = await preparePromotionInputs(request(intents, ids), mkDeps(pools, 3).deps);
    const real = contentionModule.projectContentionAuthority;
    (contentionModule as any).projectContentionAuthority = (t: ContentionTrace, i: PromotionInput, b: unknown, p: unknown) => { if (i.candidateIntentId === 'P2') throw new Error('boom'); return (real as any)(t, i, b, p); };
    let failing; try { failing = await preparePromotionInputs(request(intents, ids), mkDeps(pools, 3).deps); } finally { (contentionModule as any).projectContentionAuthority = real; }
    const pairs = runOf(failing).promotions; const basePairs = runOf(base).promotions;
    check('MIDDLE FAILURE ALIGNMENT: three pairs in input order P1, P2, P3; P1 and P3 READY with their OWN candidate ids, P2 UNAVAILABLE / CAPTURE_FAILED -- nothing shifted or compacted', pairs.map((p) => p.input.candidateIntentId).join() === 'P1,P2,P3' && pairs[0].contention.status === 'READY' && pairs[1].contention.status === 'UNAVAILABLE' && (pairs[1].contention as { reason: string }).reason === 'CAPTURE_FAILED' && pairs[2].contention.status === 'READY' && ready(pairs[0].contention).authority.candidateIntentId === 'P1' && ready(pairs[2].contention).authority.candidateIntentId === 'P3');
    check('the surviving pairs are byte-identical to the unfailed run\'s, the PromotionInput outcome and the Constructor result are untouched, and the run-level attempts are unaffected', JSON.stringify(pairs[0]) === JSON.stringify(basePairs[0]) && JSON.stringify(pairs[2]) === JSON.stringify(basePairs[2]) && JSON.stringify(failing.promotion) === JSON.stringify(base.promotion) && JSON.stringify(failing.result) === JSON.stringify(base.result) && JSON.stringify(runOf(failing).schedulingAttempts) === JSON.stringify(runOf(base).schedulingAttempts));
  }
  {
    const normal = await orchestrateConstructDay(request([req('O', 0), req('B', 1), req('P', 2)], ['O', 'B', 'P']), mkDeps(BLOCKED_POOLS, 1).deps);
    const realProject = attemptModule.projectSchedulingAttempts; const realNormalize = attemptModule.normalizeSchedulingAttempts; let projections = 0; let normalizations = 0;
    (attemptModule as any).projectSchedulingAttempts = (...a: unknown[]) => { projections += 1; return (realProject as any)(...a); };
    (attemptModule as any).normalizeSchedulingAttempts = (...a: unknown[]) => { normalizations += 1; return (realNormalize as any)(...a); };
    try {
      await orchestrateConstructDay(request([req('O', 0), req('B', 1), req('P', 2)], ['O', 'B', 'P']), mkDeps(BLOCKED_POOLS, 1).deps);
      await orchestrateConstructDayWithDiagnostics(request([req('O', 0), req('B', 1), req('P', 2)], ['O', 'B', 'P']), mkDeps(BLOCKED_POOLS, 1).deps);
      check('NORMAL PATH and DIAGNOSTICS ENTRY: zero scheduling-attempt projections and zero normalizations (only the internal promotion boundary does the work)', projections === 0 && normalizations === 0);
      const b = await preparePromotionInputs(request([req('O', 0), req('B', 1), req('P', 2)], ['O', 'B', 'P']), mkDeps(BLOCKED_POOLS, 1).deps);
      check('the promotion boundary projects the run-level attempts ONCE (which normalizes internally) and the single PromotionInput\'s contention view calls the SAME exported normalization once more from outside: one shared function, no second semantic path', projections === 1 && normalizations === 1 && JSON.stringify(b.result) === JSON.stringify(normal));
    } finally { (attemptModule as any).projectSchedulingAttempts = realProject; (attemptModule as any).normalizeSchedulingAttempts = realNormalize; }
    (attemptModule as any).projectSchedulingAttempts = () => { throw new Error('boom'); };
    let failed; try { failed = await preparePromotionInputs(request([req('O', 0), req('B', 1), req('P', 2)], ['O', 'B', 'P']), mkDeps(BLOCKED_POOLS, 1).deps); } finally { (attemptModule as any).projectSchedulingAttempts = realProject; }
    const reference = await preparePromotionInputs(request([req('O', 0), req('B', 1), req('P', 2)], ['O', 'B', 'P']), mkDeps(BLOCKED_POOLS, 1).deps);
    const fr = runOf(failed);
    check('FAILURE ISOLATION: a throwing attempt projection makes ONLY `schedulingAttempts` UNAVAILABLE / CAPTURE_FAILED -- the PromotionInput outcome, the pairs, the basis, the placements and the Constructor result are untouched', fr.schedulingAttempts.status === 'UNAVAILABLE' && (fr.schedulingAttempts as { reason: string }).reason === 'CAPTURE_FAILED' && JSON.stringify(failed.promotion) === JSON.stringify(reference.promotion) && JSON.stringify(fr.promotions) === JSON.stringify(runOf(reference).promotions) && JSON.stringify(failed.result) === JSON.stringify(normal));
    const notReady = await preparePromotionInputs({ ...request([req('O', 0), req('B', 1), req('P', 2)], ['O', 'B', 'P']), timezone: '' }, mkDeps(BLOCKED_POOLS, 1).deps);
    check('a not-READY run yields run UNAVAILABLE / RUN_NOT_READY (no partial authority), exactly like no inputs', notReady.promotion.status === 'UNAVAILABLE' && notReady.run.status === 'UNAVAILABLE' && (notReady.run as { reason: string }).reason === 'RUN_NOT_READY');
  }

  // ======================================================================
  console.log('=== Part 5: FULL-HISTORY ORACLE property sweep (scratch instrumentation; the history is an oracle only) ===');
  {
    let seed = 20261005; const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
    const SLOTS: Array<[string, string]> = []; for (let t = 9 * 60; t <= 13 * 60; t += 30) { const e = t + 60; SLOTS.push([`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`, `${String(Math.floor(e / 60)).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`]); }
    const LABELS: Label[] = ['EXCELLENT', 'GOOD', 'USABLE', 'CAUTION'];
    const tally = { runs: 0, multiRoundRuns: 0, promotionInputs: 0, pAttempts: 0, ownersExamined: 0, fullHistoryCandidates: 0, attemptAuthorityCandidates: 0, intermediateOnlyCandidates: 0, missingFutureAuthority: 0, usefulIntermediateOnly: 0, rankingMismatches: 0, fitMismatch: 0, simulations: 0, outcomeDiffAuthorityVsFull: 0, traceFirstNotRankFirst: 0, multiSlotInputs: 0, eventsNotInAttempts: 0, attemptsNotFromEvents: 0 };
    const RUNS = 1100;
    for (let n = 0; n < RUNS; n += 1) {
      const k = 4 + Math.floor(rnd() * 3); const ids = ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, k); const limit = 1 + Math.floor(rnd() * 2);
      const pools: Record<string, PoolItem[]> = {}; ids.forEach((id) => { const sub = SLOTS.filter(() => rnd() < 0.65).map((slot) => ({ slot, label: LABELS[Math.floor(rnd() * 4)] } as PoolItem)); rankedShuffle(sub, rnd, (p) => LABELS.indexOf(p.label)); pools[id] = sub; });
      const fixed = rnd() < 0.2 ? ids[ids.length - 1] : undefined;
      const blockers = rnd() < 0.2 ? [{ start: at('12:30'), end: at('13:00'), status: 'UPCOMING' as const }] : [];
      const hist: History = {};
      const intents = ids.map((id, i) => (id === fixed ? req(id, i, { flexibility: 'FIXED', fixedStart: at('14:00') } as Partial<RequestedDayIntent>) : req(id, i)));
      const prepared = await preparePromotionInputs(request(intents, ids), mkDeps(pools, limit, hist, blockers).deps);
      tally.runs += 1;
      if (prepared.result.status !== 'READY' || prepared.run.status !== 'PREPARED') continue;
      const run = prepared.run;
      const basisOutcome = run.constructionBasis; const placementsOutcome = run.baselinePlacements; const attemptOutcome = run.schedulingAttempts;
      if (basisOutcome.status !== 'READY' || placementsOutcome.status !== 'READY' || attemptOutcome.status !== 'READY') { tally.missingFutureAuthority += 1; continue; }
      const basis = basisOutcome.basis; const placements = placementsOutcome.placements.placements.map((p) => ({ id: p.intentId, s: p.start.getTime(), e: p.end.getTime(), src: p.placementSource }));
      const attempts = attemptOutcome.authority.attempts;
      const dayIntents = new Map(prepared.result.preview.resolvedIntents.map((r) => [r.requestedIntentId, r.dayIntent]));
      if (Object.values(hist).some((lists) => lists.length >= 3)) tally.multiRoundRuns += 1;
      const win = { s: basis.window.start.getTime(), e: basis.window.end.getTime() }; const blk = basis.blockedIntervals.map((b) => ({ s: b.start.getTime(), e: b.end.getTime() }));
      const usableStatic = (start: number) => start >= win.s && start + 3600000 <= win.e && !blk.some((b) => overlapsMs(start, start + 3600000, b.s, b.e));
      const authoritySetOf = (id: string): Array<{ start: number; fit: PlacementTimingFit | undefined }> => {
        const lists = [...(basis.initialCandidates.find((l) => l.intentId === id)?.candidates ?? []), ...(basis.finalCandidates.find((l) => l.intentId === id)?.candidates ?? [])].map((c) => ({ start: c.start.getTime(), fit: c.timingFit }));
        const att = attempts.filter((a) => a.intentId === id).map((a) => ({ start: a.start.getTime(), fit: a.timingFit }));
        const seen = new Set<string>(); return [...lists, ...att].filter((c) => { const key = `${c.start}|${c.fit ?? ''}`; if (seen.has(key)) return false; seen.add(key); return true; });
      };
      // (1) every statically valid candidate of every historical list is in the future authority set; fits agree with the oracle
      for (const id of ids) {
        if (id === fixed) continue;
        const have = new Set(authoritySetOf(id).map((c) => `${c.start}|${c.fit ?? ''}`)); const listed = new Set([...(basis.initialCandidates.find((l) => l.intentId === id)?.candidates ?? []), ...(basis.finalCandidates.find((l) => l.intentId === id)?.candidates ?? [])].map((c) => `${c.start.getTime()}|${c.timingFit ?? ''}`));
        tally.attemptAuthorityCandidates += have.size;
        for (const list of hist[id] ?? []) for (const c of list) {
          tally.fullHistoryCandidates += 1;
          if (!listed.has(`${c.start}|${c.fit}`)) tally.intermediateOnlyCandidates += 1;
          if (usableStatic(c.start) && !have.has(`${c.start}|${c.fit}`)) tally.missingFutureAuthority += 1;
        }
      }
      // (2) soundness / completeness against the raw trace
      const diag = await orchestrateConstructDayWithDiagnostics(request(intents, ids), mkDeps(pools, limit, {}, blockers).deps);
      const eventKeys = new Set(diag.contentionTrace.events.map((e) => `${e.loserIntentId}|${new Date(e.attemptedStart).getTime()}|${new Date(e.attemptedEnd).getTime()}|${e.timingFit ?? ''}|${e.winnerIntentId}`));
      const attemptKeys = new Set(attempts.flatMap((a) => a.conflictingOwnerIds.map((o) => `${a.intentId}|${a.start.getTime()}|${a.end.getTime()}|${a.timingFit ?? ''}|${o}`)));
      for (const key of eventKeys) if (!attemptKeys.has(key)) tally.eventsNotInAttempts += 1;
      for (const key of attemptKeys) if (!eventKeys.has(key)) tally.attemptsNotFromEvents += 1;
      // (3) the fit an attempt carries is the fit the oracle recorded for that exact start
      for (const a of attempts) { if (a.timingFit === undefined) continue; const seenFit = (hist[a.intentId] ?? []).flat().find((c) => c.start === a.start.getTime()); if (!seenFit || seenFit.fit !== a.timingFit) tally.fitMismatch += 1; }
      // (4) per PromotionInput: ranking and owner relocation under FULL history vs the future authority set
      run.promotions.forEach((pair) => {
        tally.promotionInputs += 1;
        if (pair.contention.status !== 'READY') return;
        const owners = new Set(pair.input.owners.map((o) => o.intentId)); const pid = pair.input.candidateIntentId;
        const slotMap = new Map<string, { s: number; e: number; fit?: PlacementTimingFit; idx: number }>();
        pair.contention.authority.attempts.forEach((a) => { const key = `${a.start.getTime()}|${a.end.getTime()}|${a.timingFit ?? ''}`; if (!slotMap.has(key)) slotMap.set(key, { s: a.start.getTime(), e: a.end.getTime(), fit: a.timingFit, idx: slotMap.size }); });
        tally.pAttempts += slotMap.size;
        const usable: Array<{ s: number; e: number; fit?: PlacementTimingFit; idx: number; over: typeof placements }> = [];
        for (const sl of slotMap.values()) {
          if (!usableStatic(sl.s)) continue;
          const over = placements.filter((p) => overlapsMs(sl.s, sl.e, p.s, p.e));
          if (over.length === 0 || over.some((p) => !owners.has(p.id) || p.src === 'FIXED_CONSTRAINT')) continue;
          usable.push({ ...sl, over });
        }
        if (usable.length >= 2) {
          tally.multiSlotInputs += 1;
          const ranked = [...usable].sort((a, b) => compareCandidatesForPlacement(asPC(pid, a.s, a.fit), asPC(pid, b.s, b.fit)));
          const oracleRanked = [...usable].sort((a, b) => { const fa = (hist[pid] ?? []).flat().find((c) => c.start === a.s)?.fit; const fb = (hist[pid] ?? []).flat().find((c) => c.start === b.s)?.fit; return compareCandidatesForPlacement(asPC(pid, a.s, fa), asPC(pid, b.s, fb)); });
          if (ranked[0].idx !== oracleRanked[0].idx) tally.rankingMismatches += 1;
          if (usable.slice().sort((a, b) => a.idx - b.idx)[0].idx !== ranked[0].idx) tally.traceFirstNotRankFirst += 1;
        }
        for (const sl of usable) {
          tally.simulations += 1;
          const displaced = sl.over.map((p) => p.id).sort((a, b) => compareByOverloadPrecedence(dayIntents.get(a)!, dayIntents.get(b)!, FRIDAY) || a.localeCompare(b));
          tally.ownersExamined += displaced.length;
          const simulate = (poolOf: (id: string) => Array<{ start: number; fit: PlacementTimingFit | undefined }>) => {
            const occupied = placements.filter((p) => !displaced.includes(p.id)).map((p) => [p.s, p.e]); occupied.push([sl.s, sl.e]);
            const out: string[] = [];
            for (const id of displaced) {
              const feasible = rankBy(id, poolOf(id).filter((c) => usableStatic(c.start) && !occupied.some((o) => overlapsMs(c.start, c.start + 3600000, o[0], o[1]))));
              const best = feasible[0]; out.push(best ? `${id}@${best.start}:${best.fit ?? ''}` : `${id}@-`); if (best) occupied.push([best.start, best.start + 3600000]);
            }
            return out.join();
          };
          const full = simulate((id) => { const base = authoritySetOf(id).filter(() => false); const all = [...(hist[id] ?? []).flat(), ...(basis.initialCandidates.find((l) => l.intentId === id)?.candidates ?? []).map((c) => ({ start: c.start.getTime(), fit: c.timingFit as PlacementTimingFit })), ...(basis.finalCandidates.find((l) => l.intentId === id)?.candidates ?? []).map((c) => ({ start: c.start.getTime(), fit: c.timingFit as PlacementTimingFit }))]; void base; const seen = new Set<string>(); return all.filter((c) => { const key = `${c.start}|${c.fit}`; if (seen.has(key)) return false; seen.add(key); return true; }); });
          const future = simulate(authoritySetOf);
          const listsOnly = simulate((id) => [...(basis.initialCandidates.find((l) => l.intentId === id)?.candidates ?? []), ...(basis.finalCandidates.find((l) => l.intentId === id)?.candidates ?? [])].map((c) => ({ start: c.start.getTime(), fit: c.timingFit })));
          if (full !== future) tally.outcomeDiffAuthorityVsFull += 1;
          if (full !== listsOnly) tally.usefulIntermediateOnly += 1;
        }
      });
    }
    console.log(`     sweep: ${JSON.stringify(tally)}`);
    check(`COMPLETENESS (the principal P4b2b proof): over ${tally.runs} deterministic runs (${tally.multiRoundRuns} multi-round), ${tally.fullHistoryCandidates} candidates of the FULL-HISTORY oracle (${tally.intermediateOnlyCandidates} intermediate-only): ZERO statically-valid candidate is missing from initial UNION final UNION attempts`, tally.runs >= 1000 && tally.fullHistoryCandidates > 5000 && tally.intermediateOnlyCandidates > 0 && tally.missingFutureAuthority === 0);
    check(`SUFFICIENCY (owner relocation): over ${tally.simulations} counterfactual simulations (${tally.ownersExamined} displaced owners, ${tally.promotionInputs} PromotionInputs, ${tally.pAttempts} P slots) the future authority set reproduces the FULL-HISTORY best neutral result under the real comparator in every case: ZERO outcome differences`, tally.simulations > 1500 && tally.outcomeDiffAuthorityVsFull === 0);
    check('SOUNDNESS AND COMPLETENESS vs the raw trace: every P3a (loser, interval, fit, owner) is in the attempts and every attempt-owner pair comes from a real event: zero missing, zero invented', tally.eventsNotInAttempts === 0 && tally.attemptsNotFromEvents === 0);
    check('RANKING FAITHFULNESS: the fit every attempt carries equals the fit the oracle recorded for that start (zero mismatches), and P\'s slot ranking from the authority payload equals the oracle ranking (zero mismatches)', tally.fitMismatch === 0 && tally.rankingMismatches === 0);
    check(`TRACE ORDER IS NOT A RANKING: among ${tally.multiSlotInputs} inputs with several usable P slots, the first-discovered slot differed from the comparator's best ${tally.traceFirstNotRankFirst} times -- so a ranking taken from trace order would have been wrong`, tally.multiSlotInputs > 20 && tally.traceFirstNotRankFirst > 0);
    check('the intermediate-only candidates are real but, in random runs, rarely decisive (initial UNION final alone would differ in ' + tally.usefulIntermediateOnly + ' simulations); the directed counterexample in Part 2 is the committed case where they are decisive', tally.usefulIntermediateOnly >= 0);
  }

  if (!allPassed) { console.error('SOME SCHEDULING ATTEMPT AUTHORITY CHECKS FAILED'); process.exitCode = 1; return; }
  console.log('ALL SCHEDULING ATTEMPT AUTHORITY CHECKS PASSED');
})().then(() => process.exit(), (err) => { console.error(err); process.exit(1); });
