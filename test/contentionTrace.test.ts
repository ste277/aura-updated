/**
 * Constructor Decision Intelligence -- O5 P3a: the CONTENTION TRACE (pure behavior, no DB).
 *
 * The REAL Constructor (`constructDay` / `constructDayWithTrace`) and the REAL orchestrator (`orchestrateConstructDay` /
 * `orchestrateConstructDayWithTrace`) run; only the orchestrator's data loaders and timing search are injected fakes.
 *
 * A contention event exists only when a candidate interval that was otherwise individually usable was rejected because it
 * overlaps an interval ALREADY OWNED by a Proposed candidate. This file proves that definition, the scenarios that are
 * NOT contention (no candidates, external blocker, availability, window, duration, capacity label, a final Deferred
 * reason), half-open boundaries, multiple attempts and multiple owners, history across replenishment rounds (the known P0c
 * pattern: a loser later left with NO_CANDIDATES), determinism, immutability, source neutrality, independence from decision
 * pressure and facts -- and that tracing changes NOTHING: the Constructor result, the preview and its signed tokens, the
 * queries and the searches are identical with and without a trace.
 *
 * "Winner" below is descriptive historical ownership of an interval, never a policy-approved winner. These tests assert
 * scheduling invariants only: no heap layout, query plan, wall-clock timing or unordered-collection behavior.
 */
import { buildDayIntent, type ConstructionWindow, type DayIntent, type DayIntentImportance } from '../apps/web/lib/dayIntent';
import type { BlockedInterval } from '../apps/web/lib/dayCapacity';
import { constructDay, constructDayWithTrace, type ConstructDayInput, type ConstructDayResult, type ConstructedDay, type FixedPlacementConstraint, type PlacementCandidate } from '../apps/web/lib/dayConstructor';
import { orchestrateConstructDay, orchestrateConstructDayWithTrace, type ConstructDayRequest, type DayConstructorOrchestratorDeps, type RequestedDayIntent } from '../apps/web/lib/dayConstructorOrchestrator';
import { aggregateContentionTraces, buildContentionEvents, EMPTY_CONTENTION_TRACE, type ContentionEvent, type ContentionTrace } from '../apps/web/lib/contentionTrace';
import { signPreviewResultBody } from '../apps/web/lib/dayConstructorPreviewIntegrity';
import { createDecisionFactPreparer } from '../apps/web/lib/decisionFactPreparation';
import type { DecisionFacts } from '../apps/web/lib/decisionFacts';
import type { OpportunityRangeDeps } from '../apps/web/lib/opportunityRangeAdapter';
import type { AvailabilityConfiguration } from '../apps/web/lib/availabilityContext';
import type { TimingCandidate } from '../packages/recommendation/src/timingSearch';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
function throwsTypeError(fn: () => void): boolean {
  try { fn(); return false; } catch (err) { return err instanceof TypeError; }
}

const D = '2026-10-07';
const at = (hhmm: string) => new Date(`${D}T${hhmm}:00Z`);
const hhmm = (isoString: string) => isoString.slice(11, 16);
const win = (start = '09:00', end = '17:00'): ConstructionWindow => ({ date: D, start: at(start), end: at(end), timezone: 'UTC', source: 'EXPLICIT_RANGE' });
const mk = (id: string, o: { importance?: DayIntentImportance; minutes?: number; order?: number; flexibility?: 'FLEXIBLE' | 'FIXED'; deadline?: string } = {}): DayIntent =>
  ({ ...buildDayIntent({ title: id, targetDate: D, estimatedDurationMinutes: o.minutes ?? 60, importance: o.importance, flexibility: o.flexibility, deadline: o.deadline }, o.order ?? 0), id });
const cand = (id: string, start: string, end: string, order = 0): PlacementCandidate => ({ intentId: id, start: at(start), end: at(end), candidateOrder: order });
const fixedAt = (id: string, start: string, end: string): FixedPlacementConstraint => ({ intentId: id, start: at(start), end: at(end) });
const block = (start: string, end: string, source: BlockedInterval['source'] = 'FIXED_PLAN'): BlockedInterval => ({ start: at(start), end: at(end), source });
const input = (intents: DayIntent[], candidatesByIntentId: Record<string, PlacementCandidate[]>, extra: Partial<ConstructDayInput> = {}): ConstructDayInput =>
  ({ intents, window: win(), blockedIntervals: [], candidatesByIntentId, fixedConstraintsByIntentId: {}, today: D, ...extra });
const day = (r: ConstructDayResult): ConstructedDay => { if (r.status !== 'READY') throw new Error(`expected READY, got ${r.status}`); return r.day; };
/** A compact, order-preserving rendering: `r0 LOW<-HIGH [10:00,11:00) over [10:00,11:00)`. */
const view = (trace: ContentionTrace) => trace.events.map((e) => `r${e.round} ${e.loserIntentId}<-${e.winnerIntentId} [${hhmm(e.attemptedStart)},${hhmm(e.attemptedEnd)}) over [${hhmm(e.winnerStart)},${hhmm(e.winnerEnd)})`);
const traced = (i: ConstructDayInput) => constructDayWithTrace(i);
const proposedIds = (d: ConstructedDay) => d.proposedItems.map((p) => p.intentId);
const deferredIds = (d: ConstructedDay) => d.deferredItems.map((x) => x.intentId);

// A reusable P0c-style contest: one 60-minute slot, HIGH and LOW both flexible.
const contest = (slotStart = '10:00', slotEnd = '11:00', over: { order?: [number, number]; imp?: [DayIntentImportance, DayIntentImportance] } = {}) => {
  const [oh, ol] = over.order ?? [0, 1];
  const [ih, il] = over.imp ?? ['HIGH', 'LOW'];
  const high = mk('HIGH', { importance: ih, order: oh });
  const low = mk('LOW', { importance: il, order: ol });
  return { high, low, build: (reverse = false) => input(reverse ? [low, high] : [high, low], reverse ? { LOW: [cand('LOW', slotStart, slotEnd)], HIGH: [cand('HIGH', slotStart, slotEnd)] } : { HIGH: [cand('HIGH', slotStart, slotEnd)], LOW: [cand('LOW', slotStart, slotEnd)] }) };
};

// ---- orchestrator harness (fake loaders and timing search) ----
type Weekday = AvailabilityConfiguration['periods'][number]['weekday'];
const workWeek: AvailabilityConfiguration = { configured: true, periods: ([1, 2, 3, 4, 5] as Weekday[]).map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })) };
const timing = (start: string, end: string): TimingCandidate => ({ start: `${D}T${start}:00Z`, end: `${D}T${end}:00Z`, score: 5, label: 'GOOD', muhurtaScore: 0, reasons: [], metadata: { windowType: 'NEUTRAL', windowLabel: 'Neutral Flow', activityType: 'x', dateLabel: D } });
const requested = (id: string, over: Partial<RequestedDayIntent> = {}): RequestedDayIntent => ({ id, title: id, flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 60, originalOrder: 0, ...over });
const orchRequest = (intents: RequestedDayIntent[], facts?: Record<string, DecisionFacts>): ConstructDayRequest => ({
  targetDate: D, timezone: 'UTC', constructionWindowSource: 'EXPLICIT_RANGE', now: new Date(`${D}T09:00:00Z`),
  explicitStart: at('09:00'), explicitEnd: at('17:00'), intents, ...(facts ? { decisionFactsByIntentId: new Map(Object.entries(facts)) } : {}),
});
/** `script[n]` is the candidate list returned by the n-th timing search call (initial searches in request order, then replenishment searches). */
function scriptedDeps(script: TimingCandidate[][], calls = { plans: 0, duration: 0, availability: 0, search: 0, log: [] as string[] }, extra: Partial<DayConstructorOrchestratorDeps> = {}) {
  const deps: DayConstructorOrchestratorDeps = {
    loadBlockingPlans: async () => { calls.plans += 1; return []; },
    loadDurationContext: async () => { calls.duration += 1; return { preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} }; },
    searchTiming: (req) => { const n = calls.search; calls.search += 1; calls.log.push(`search#${n}:${(req as { excludedIntervals?: unknown[] }).excludedIntervals?.length ?? 0}`); return { candidates: script[n] ?? [] }; },
    loadAvailabilityConfiguration: async () => { calls.availability += 1; return { configured: false, periods: [] }; },
    ...extra,
  };
  return { deps, calls };
}
const READY = (r: any) => { if (r.status !== 'READY') throw new Error(`expected READY, got ${r.status}`); return r.preview; };

(async () => {
  console.log('=== strict-mode precondition ===');
  check('this file runs in strict mode: a write to a frozen object THROWS', throwsTypeError(() => { (Object.freeze({ a: 1 }) as { a: number }).a = 2; }));

  // ============================================================
  console.log('=== the definition: HIGH vs LOW on one 60-minute slot (non-overloaded day) ===');
  {
    const c = contest();
    const r = traced(c.build());
    const d = day(r.result);
    check('baseline behavior is unchanged: HIGH stays Proposed, LOW stays Deferred (CONFLICTS_WITH_PROPOSED_ITEM)', JSON.stringify(proposedIds(d)) === JSON.stringify(['HIGH']) && JSON.stringify(deferredIds(d)) === JSON.stringify(['LOW']) && d.deferredItems[0].primaryReason === 'CONFLICTS_WITH_PROPOSED_ITEM');
    check('TRACE: LOW lost the candidate interval [10:00,11:00) to HIGH, who already owned [10:00,11:00) -- exactly one event, round 0', JSON.stringify(view(r.trace)) === JSON.stringify(['r0 LOW<-HIGH [10:00,11:00) over [10:00,11:00)']));
    check('EVENT SHAPE: exactly loser, winner, attempted start/end, winner start/end and round -- Constructor identity and instants only (no source, activity, title, Goal, provenance or user-facing field)', JSON.stringify(Object.keys(r.trace.events[0])) === JSON.stringify(['loserIntentId', 'winnerIntentId', 'attemptedStart', 'attemptedEnd', 'winnerStart', 'winnerEnd', 'round']));
    check('instants are ISO-8601 UTC strings; the round is an integer', r.trace.events[0].attemptedStart === '2026-10-07T10:00:00.000Z' && Number.isInteger(r.trace.events[0].round));
    check('NON-OVERLOAD CONTENTION: the day is NOT labelled overloaded (requested 120 of 480 minutes) yet real candidate-vs-candidate contention occurred -- capacityState cannot gate contention', d.requestedCapacity.capacityState !== 'OVERLOADED' && d.requestedCapacity.requestedMinutes === 120 && d.requestedCapacity.usableMinutes === 480 && r.trace.events.length === 1);
    check('P3b FACT: the Deferred candidate is identifiable as one that actually contended with a Proposed owner (loser in the trace, owner still Proposed in the final day)', d.deferredItems.filter((x) => r.trace.events.some((e) => e.loserIntentId === x.intentId && proposedIds(d).includes(e.winnerIntentId))).map((x) => x.intentId).join() === 'LOW');
  }

  console.log('=== reverse input, candidate order and determinism ===');
  {
    const c = contest();
    const forward = traced(c.build(false));
    const reversed = traced(c.build(true));
    check('REVERSE INPUT: the production outcome is the same baseline (HIGH Proposed, LOW Deferred) and the trace identifies the same historical owner and loser', JSON.stringify(proposedIds(day(reversed.result))) === JSON.stringify(['HIGH']) && JSON.stringify(deferredIds(day(reversed.result))) === JSON.stringify(['LOW']) && JSON.stringify(reversed.trace) === JSON.stringify(forward.trace));
    const twoEach = input([c.high, c.low], { HIGH: [cand('HIGH', '10:00', '11:00', 0), cand('HIGH', '13:00', '14:00', 1)], LOW: [cand('LOW', '10:00', '11:00', 0), cand('LOW', '13:00', '14:00', 1)] });
    const twoEachReversed = input([c.low, c.high], { LOW: [cand('LOW', '13:00', '14:00', 1), cand('LOW', '10:00', '11:00', 0)], HIGH: [cand('HIGH', '13:00', '14:00', 1), cand('HIGH', '10:00', '11:00', 0)] });
    check('the trace is independent of input array order AND of candidate array order: reversing both leaves an identical trace and an identical constructed day', JSON.stringify(traced(twoEach).trace) === JSON.stringify(traced(twoEachReversed).trace) && JSON.stringify(day(traced(twoEach).result)) === JSON.stringify(day(traced(twoEachReversed).result)));
    const reps = Array.from({ length: 20 }, () => JSON.stringify(traced(c.build()).trace));
    check('DETERMINISM: 20 repetitions give byte-identical traces', reps.every((x) => x === reps[0]));
  }

  console.log('=== equal importance, deadline precedence: contention is recorded, never interpreted ===');
  {
    const eq = contest('10:00', '11:00', { imp: ['MEDIUM', 'MEDIUM'] });
    const r = traced(eq.build());
    check('EQUAL IMPORTANCE: submission order still decides (unchanged) -- HIGH (first) is Proposed, LOW (second) Deferred; the trace records the actual loser', JSON.stringify(proposedIds(day(r.result))) === JSON.stringify(['HIGH']) && JSON.stringify(view(r.trace)) === JSON.stringify(['r0 LOW<-HIGH [10:00,11:00) over [10:00,11:00)']));
    check('EQUAL IMPORTANCE, reversed array: the same winner/loser (originalOrder is carried by the intent)', JSON.stringify(view(traced(eq.build(true)).trace)) === JSON.stringify(view(r.trace)));
    const swapped = contest('10:00', '11:00', { imp: ['MEDIUM', 'MEDIUM'], order: [1, 0] });
    const rs = traced(swapped.build());
    check('swapping originalOrder swaps the actual loser, and the trace follows the outcome (LOW first now owns the slot)', JSON.stringify(proposedIds(day(rs.result))) === JSON.stringify(['LOW']) && JSON.stringify(view(rs.trace)) === JSON.stringify(['r0 HIGH<-LOW [10:00,11:00) over [10:00,11:00)']));
    const hi = mk('HIGH', { importance: 'HIGH', order: 0 });
    const lowToday = mk('LOW', { importance: 'LOW', order: 1, deadline: D });
    const rd = traced(input([hi, lowToday], { HIGH: [cand('HIGH', '10:00', '11:00')], LOW: [cand('LOW', '10:00', '11:00')] }));
    check('DEADLINE TODAY: the existing precedence (deadline today above importance) is unchanged -- LOW is Proposed, HIGH Deferred -- and the trace records contention only (HIGH lost to LOW)', JSON.stringify(proposedIds(day(rd.result))) === JSON.stringify(['LOW']) && JSON.stringify(view(rd.trace)) === JSON.stringify(['r0 HIGH<-LOW [10:00,11:00) over [10:00,11:00)']) && JSON.stringify(day(rd.result)) === JSON.stringify(day(constructDay(input([hi, lowToday], { HIGH: [cand('HIGH', '10:00', '11:00')], LOW: [cand('LOW', '10:00', '11:00')] })))));
    const med = mk('MED', { importance: 'MEDIUM', order: 1, deadline: '2026-10-08' });
    const hi2 = mk('HIGH', { importance: 'HIGH', order: 0 });
    const re = traced(input([hi2, med], { HIGH: [cand('HIGH', '10:00', '11:00')], MED: [cand('MED', '10:00', '11:00')] }));
    check('EARLIER NON-TODAY DEADLINE: importance still outranks it (unchanged) -- HIGH without a deadline beats MEDIUM with an earlier one; the trace does not interpret either', JSON.stringify(proposedIds(day(re.result))) === JSON.stringify(['HIGH']) && JSON.stringify(view(re.trace)) === JSON.stringify(['r0 MED<-HIGH [10:00,11:00) over [10:00,11:00)']));
    const l1 = mk('L1', { importance: 'LOW', order: 0 });
    const l2 = mk('L2', { importance: 'LOW', order: 1, deadline: '2026-10-08' });
    const rl = traced(input([l1, l2], { L1: [cand('L1', '10:00', '11:00')], L2: [cand('L2', '10:00', '11:00')] }));
    check('among equal importance the existing earlier-deadline rule is unchanged -- the one with a deadline owns the slot, the other is the recorded loser', JSON.stringify(proposedIds(day(rl.result))) === JSON.stringify(['L2']) && JSON.stringify(view(rl.trace)) === JSON.stringify(['r0 L1<-L2 [10:00,11:00) over [10:00,11:00)']));
  }

  // ============================================================
  console.log('=== fragmentation: aggregate free minutes look sufficient, concrete interval ownership decides ===');
  {
    const high = mk('HIGH', { importance: 'HIGH', order: 0, minutes: 60 });
    const low = mk('LOW', { importance: 'LOW', order: 1, minutes: 90 });
    const i = input([high, low], { HIGH: [cand('HIGH', '10:00', '11:00')], LOW: [cand('LOW', '10:30', '12:00')] }, { window: win('09:00', '13:00') });
    const r = traced(i);
    const d = day(r.result);
    check('FRAGMENTATION: after HIGH the day still has 180 free minutes (>= LOW\'s 90), yet LOW is Deferred because its only candidate interval [10:30,12:00) overlaps HIGH\'s [10:00,11:00)', d.proposedCapacity.usableMinutes - d.proposedCapacity.requestedMinutes >= 90 && JSON.stringify(deferredIds(d)) === JSON.stringify(['LOW']));
    check('the trace reflects CONCRETE interval ownership, not aggregate capacity: attempted [10:30,12:00) over owner [10:00,11:00)', JSON.stringify(view(r.trace)) === JSON.stringify(['r0 LOW<-HIGH [10:30,12:00) over [10:00,11:00)']) && d.requestedCapacity.capacityState !== 'OVERLOADED');
    check('the attempted interval is the EXACT derived interval, not the requested day or a longer candidate span: a 90-minute candidate window [10:30,13:00) for a 60-minute intent attempts [10:30,11:30)', (() => { const l60 = mk('LOW', { importance: 'LOW', order: 1, minutes: 60 }); return JSON.stringify(view(traced(input([high, l60], { HIGH: [cand('HIGH', '10:00', '11:00')], LOW: [cand('LOW', '10:30', '12:00')] }, { window: win('09:00', '13:00') })).trace)) === JSON.stringify(['r0 LOW<-HIGH [10:30,11:30) over [10:00,11:00)']); })());
  }

  // ============================================================
  console.log('=== NOT CONTENTION: controls that must produce ZERO events ===');
  {
    const high = mk('HIGH', { importance: 'HIGH', order: 0 });
    const low = mk('LOW', { importance: 'LOW', order: 1 });
    const blocker = traced(input([low], { LOW: [cand('LOW', '10:00', '11:00')] }, { blockedIntervals: [block('10:00', '11:00')] }));
    check('EXTERNAL BLOCKER: a candidate that loses only to an existing PlannedActivity (BLOCKED_BY_COMMITMENT) is not candidate-vs-candidate contention -- zero events', day(blocker.result).deferredItems[0].primaryReason === 'BLOCKED_BY_COMMITMENT' && blocker.trace.events.length === 0);
    const both = traced(input([high, low], { HIGH: [cand('HIGH', '10:00', '11:00')], LOW: [cand('LOW', '10:30', '11:30')] }, { blockedIntervals: [block('11:00', '12:00')] }));
    check('A candidate overlapping BOTH an external blocker and a Proposed owner is rejected by the blocker gate first (the reason recorded at that evaluation point): the Proposed overlap is not the reason, so zero events', day(both.result).deferredItems[0].primaryReason === 'BLOCKED_BY_COMMITMENT' && both.trace.events.length === 0);
    const gap = traced(input([low], { LOW: [cand('LOW', '10:00', '11:00')] }, { blockedIntervals: [block('10:00', '11:00', 'AVAILABILITY_GAP')] }));
    check('AVAILABILITY: a candidate rejected only by a configured availability gap is not contention -- zero events', gap.trace.events.length === 0 && day(gap.result).deferredItems[0].primaryReason === 'BLOCKED_BY_COMMITMENT');
    const outside = traced(input([high, low], { HIGH: [cand('HIGH', '10:00', '11:00')], LOW: [cand('LOW', '08:00', '09:00')] }));
    check('OUTSIDE THE CONSTRUCTION WINDOW: an interval outside the window is rejected as such -- zero events even while another candidate holds the day', day(outside.result).deferredItems[0].primaryReason === 'OUTSIDE_CONSTRUCTION_WINDOW' && outside.trace.events.length === 0);
    const none = traced(input([high, low], { HIGH: [cand('HIGH', '10:00', '11:00')], LOW: [] }));
    check('NO CANDIDATES: a candidate with no candidate intervals is not contention -- zero events (NO_CANDIDATES)', day(none.result).deferredItems[0].primaryReason === 'NO_CANDIDATES' && none.trace.events.length === 0);
    const tooShort = traced(input([high, low], { HIGH: [cand('HIGH', '10:00', '11:00')], LOW: [cand('LOW', '10:00', '10:30')] }));
    check('DURATION: a candidate interval too short for its duration cannot be "individually usable" -- zero events (INSUFFICIENT_DURATION)', day(tooShort.result).deferredItems[0].diagnostics[0].reason === 'INSUFFICIENT_DURATION' && tooShort.trace.events.length === 0);
    const unknown = traced(input([high, { ...mk('LOW', { importance: 'LOW', order: 1 }), estimatedDurationMinutes: undefined }], { HIGH: [cand('HIGH', '10:00', '11:00')], LOW: [cand('LOW', '10:00', '11:00')] }));
    check('an intent whose duration is unknown never reaches a candidate -- zero events (DURATION_UNKNOWN)', day(unknown.result).deferredItems[0].primaryReason === 'DURATION_UNKNOWN' && unknown.trace.events.length === 0);
    const separate = traced(input([high, low], { HIGH: [cand('HIGH', '10:00', '11:00')], LOW: [cand('LOW', '13:00', '14:00')] }));
    check('NO CONFLICT: two candidates in different slots are both Proposed -- the trace is the shared empty trace', day(separate.result).proposedItems.length === 2 && separate.trace === EMPTY_CONTENTION_TRACE && separate.trace.events.length === 0);
    check('CAPACITY LABEL ALONE IS NEVER EVIDENCE: a genuinely OVERLOADED day whose candidates never overlap (only fixed blockers and distinct slots) has zero events', (() => { const a = mk('A', { importance: 'HIGH', order: 0, minutes: 240 }); const b = mk('B', { importance: 'LOW', order: 1, minutes: 240 }); const c3 = mk('C', { importance: 'LOW', order: 2, minutes: 240 }); const r = traced(input([a, b, c3], { A: [cand('A', '09:00', '13:00')], B: [cand('B', '13:00', '17:00')], C: [] })); return day(r.result).requestedCapacity.capacityState === 'OVERLOADED' && r.trace.events.length === 0; })());
    const finalOnly = traced(input([high, low], { HIGH: [cand('HIGH', '10:00', '11:00')], LOW: [] }));
    check('A final Deferred reason never proves contention either way: NO_CANDIDATES with no earlier conflict is zero events, and (below) NO_CANDIDATES after a conflict still has the event', finalOnly.trace.events.length === 0);
  }

  console.log('=== half-open boundaries ===');
  {
    const high = mk('HIGH', { importance: 'HIGH', order: 0 });
    const low = mk('LOW', { importance: 'LOW', order: 1 });
    const run = (s: string, e: string) => traced(input([high, low], { HIGH: [cand('HIGH', '10:00', '11:00')], LOW: [cand('LOW', s, e)] }));
    const after = run('11:00', '12:00');
    const before = run('09:00', '10:00');
    check('BOUNDARY TOUCH: a candidate that starts exactly when the Proposed interval ends ([11:00,12:00) vs [10:00,11:00)) does not conflict -- LOW is Proposed, zero events', JSON.stringify(proposedIds(day(after.result))) === JSON.stringify(['HIGH', 'LOW']) && after.trace.events.length === 0);
    check('BOUNDARY TOUCH: a candidate that ends exactly when the Proposed interval starts ([09:00,10:00) vs [10:00,11:00)) does not conflict -- zero events', JSON.stringify(proposedIds(day(before.result))) === JSON.stringify(['HIGH', 'LOW']) && before.trace.events.length === 0);
    const overlap = run('10:59', '11:59');
    check('TRUE OVERLAP: a one-minute overlap ([10:59,11:59) vs [10:00,11:00)) IS contention', JSON.stringify(deferredIds(day(overlap.result))) === JSON.stringify(['LOW']) && JSON.stringify(view(overlap.trace)) === JSON.stringify(['r0 LOW<-HIGH [10:59,11:59) over [10:00,11:00)']));
    const earlyOverlap = run('09:01', '10:01');
    check('TRUE OVERLAP at the other end: one minute into the Proposed interval from before ([09:01,10:01)) is contention', JSON.stringify(view(earlyOverlap.trace)) === JSON.stringify(['r0 LOW<-HIGH [09:01,10:01) over [10:00,11:00)']));
  }

  console.log('=== multiple attempts, multiple owners, duplicates ===');
  {
    const high = mk('HIGH', { importance: 'HIGH', order: 0 });
    const low = mk('LOW', { importance: 'LOW', order: 1 });
    const attempts = [cand('LOW', '10:00', '11:00', 0), cand('LOW', '10:30', '11:30', 1), cand('LOW', '12:00', '13:00', 2)];
    const r = traced(input([high, low], { HIGH: [cand('HIGH', '10:00', '11:00')], LOW: attempts }));
    check('MULTIPLE ATTEMPTS: two of three candidate intervals are blocked by the Proposed owner -> two distinct events (not collapsed), in a deterministic order (attempted start), even though LOW is then PLACED on its free interval', JSON.stringify(view(r.trace)) === JSON.stringify(['r0 LOW<-HIGH [10:00,11:00) over [10:00,11:00)', 'r0 LOW<-HIGH [10:30,11:30) over [10:00,11:00)']) && JSON.stringify(proposedIds(day(r.result))) === JSON.stringify(['HIGH', 'LOW']));
    const reversed = traced(input([high, low], { HIGH: [cand('HIGH', '10:00', '11:00')], LOW: [...attempts].reverse() }));
    check('the same two events come out whatever order the candidates were supplied in', JSON.stringify(view(reversed.trace)) === JSON.stringify(view(r.trace)));
    const allBlocked = traced(input([high, low], { HIGH: [cand('HIGH', '10:00', '11:00')], LOW: attempts.slice(0, 2) }));
    check('all attempts blocked: LOW is Deferred (CONFLICTS_WITH_PROPOSED_ITEM) and BOTH attempted intervals are on record', day(allBlocked.result).deferredItems[0].primaryReason === 'CONFLICTS_WITH_PROPOSED_ITEM' && allBlocked.trace.events.length === 2);
    const dup = traced(input([high, low], { HIGH: [cand('HIGH', '10:00', '11:00')], LOW: [cand('LOW', '10:00', '11:00', 0), cand('LOW', '10:00', '11:00', 1)] }));
    check('NO DUPLICATE EVENTS: the same interval offered twice for one loser yields ONE event (identical loser, owner, attempted interval, owner interval and round)', dup.trace.events.length === 1);

    const h1 = mk('H1', { importance: 'HIGH', order: 0, minutes: 30 });
    const h2 = mk('H2', { importance: 'HIGH', order: 1, minutes: 30 });
    const lw = mk('LOW', { importance: 'LOW', order: 2, minutes: 60 });
    const multi = traced(input([h1, h2, lw], { H1: [cand('H1', '10:00', '10:30')], H2: [cand('H2', '10:30', '11:00')], LOW: [cand('LOW', '10:15', '11:15')] }));
    check('MULTIPLE OWNERS: an attempted interval [10:15,11:15) overlapping two adjacent Proposed intervals yields one event PER OWNER, in placement order (H1 then H2) -- no arbitrary single owner', JSON.stringify(view(multi.trace)) === JSON.stringify(['r0 LOW<-H1 [10:15,11:15) over [10:00,10:30)', 'r0 LOW<-H2 [10:15,11:15) over [10:30,11:00)']));
    check('the existing single-owner Constructor attribution (`conflicts[].conflictingIntentId`) is unchanged: still the first placed owner', day(multi.result).conflicts[0].conflictingIntentId === 'H1');
  }

  console.log('=== FIXED participates in ownership like any other proposed interval ===');
  {
    const f = mk('FIX', { importance: 'MEDIUM', order: 0, flexibility: 'FIXED' });
    const x = mk('X', { importance: 'HIGH', order: 1 });
    const r = traced(input([x, f], { X: [cand('X', '10:30', '11:30')] }, { fixedConstraintsByIntentId: { FIX: [fixedAt('FIX', '10:00', '11:00')] } }));
    check('a FLEXIBLE candidate that overlaps a FIXED item\'s interval loses to it (FIXED is reserved first, unchanged) -- the trace records the concrete conflict with no special policy meaning', JSON.stringify(proposedIds(day(r.result))) === JSON.stringify(['FIX']) && JSON.stringify(view(r.trace)) === JSON.stringify(['r0 X<-FIX [10:30,11:30) over [10:00,11:00)']));
    const f1 = mk('F1', { importance: 'HIGH', order: 0, flexibility: 'FIXED' });
    const f2 = mk('F2', { importance: 'LOW', order: 1, flexibility: 'FIXED' });
    const rf = traced(input([f1, f2], {}, { fixedConstraintsByIntentId: { F1: [fixedAt('F1', '10:00', '11:00')], F2: [fixedAt('F2', '10:30', '11:30')] } }));
    check('two overlapping FIXED intents: the one later in precedence loses (FIXED_WINDOW_CONFLICT, unchanged); its constraint is the attempted interval', day(rf.result).deferredItems[0].primaryReason === 'FIXED_WINDOW_CONFLICT' && JSON.stringify(view(rf.trace)) === JSON.stringify(['r0 F2<-F1 [10:30,11:30) over [10:00,11:00)']));
    const fb = traced(input([f2], {}, { fixedConstraintsByIntentId: { F2: [fixedAt('F2', '10:30', '11:30')] }, blockedIntervals: [block('10:00', '11:00')] }));
    check('a FIXED intent rejected by an external blocker is not contention -- zero events', fb.trace.events.length === 0);
    const fe = traced(input([f1, f2], {}, { fixedConstraintsByIntentId: { F1: [fixedAt('F1', '10:00', '11:00')], F2: [fixedAt('F2', '11:00', '12:00')] } }));
    check('touching FIXED intervals do not conflict -- both Proposed, zero events', day(fe.result).proposedItems.length === 2 && fe.trace.events.length === 0);
  }

  // ============================================================
  console.log('=== the orchestrator: history across Constructor rounds (the known P0c pattern) ===');
  {
    const A = requested('A', { importance: 'HIGH', originalOrder: 0 });
    const B = requested('B', { importance: 'LOW', originalOrder: 1 });
    // Round 0: both search the same 11:00-12:00 slot. B conflicts with A, replenishment searches again for B...
    const nothingLeft = scriptedDeps([[timing('11:00', '12:00')], [timing('11:00', '12:00')], []]);
    const p0c = await orchestrateConstructDayWithTrace(orchRequest([A, B]), nothingLeft.deps);
    const pv = READY(p0c.result);
    check('P0C PATTERN: B first loses to a Proposed owner; replenishment then leaves B with NO_CANDIDATES -- the FINAL Deferred reason is NO_CANDIDATES (no trace of the conflict in the result)', pv.constructedDay.deferredItems.length === 1 && pv.constructedDay.deferredItems[0].intentId === 'B' && pv.constructedDay.deferredItems[0].primaryReason === 'NO_CANDIDATES' && pv.constructedDay.deferredItems[0].diagnostics.length === 0 && nothingLeft.calls.search === 3);
    check('FINAL NO_CANDIDATES REGRESSION: the accumulated trace STILL proves the earlier candidate-vs-candidate conflict (B lost [11:00,12:00) to A, round 0) -- history is not erased by the later round', JSON.stringify(view(p0c.contentionTrace)) === JSON.stringify(['r0 B<-A [11:00,12:00) over [11:00,12:00)']));
    check('P3b FACT after the final reason: B is Deferred, is a recorded loser, and its historical owner A is still Proposed in the final day', pv.constructedDay.deferredItems.some((d: any) => p0c.contentionTrace.events.some((e) => e.loserIntentId === d.intentId && pv.constructedDay.proposedItems.some((p: any) => p.intentId === e.winnerIntentId))));

    const reconflict = scriptedDeps([[timing('11:00', '12:00')], [timing('11:00', '12:00')], [timing('11:30', '12:30')]]);
    const rc = await orchestrateConstructDayWithTrace(orchRequest([A, B]), reconflict.deps);
    check('MULTI-ROUND: when the replenished candidate conflicts again, BOTH rounds\' events survive in round order (round 0 [11:00,12:00), then round 1 [11:30,12:30)) -- earlier history is appended to, never overwritten', JSON.stringify(view(rc.contentionTrace)) === JSON.stringify(['r0 B<-A [11:00,12:00) over [11:00,12:00)', 'r1 B<-A [11:30,12:30) over [11:00,12:00)']));
    const resolved = scriptedDeps([[timing('11:00', '12:00')], [timing('11:00', '12:00')], [timing('13:00', '14:00')]]);
    const rr = await orchestrateConstructDayWithTrace(orchRequest([A, B]), resolved.deps);
    check('MULTI-ROUND: when replenishment RESOLVES the conflict (B is placed in round 1), the round-0 event remains as historical fact', READY(rr.result).constructedDay.proposedItems.map((p: any) => p.intentId).join() === 'A,B' && JSON.stringify(view(rr.contentionTrace)) === JSON.stringify(['r0 B<-A [11:00,12:00) over [11:00,12:00)']));
    check('ROUND NUMBERING is deterministic: the first Constructor pass is 0, each replenishment re-run the next integer', [...rc.contentionTrace.events].map((e) => e.round).join() === '0,1');
    const again = await orchestrateConstructDayWithTrace(orchRequest([A, B]), scriptedDeps([[timing('11:00', '12:00')], [timing('11:00', '12:00')], [timing('11:30', '12:30')]]).deps);
    check('the accumulated trace is deterministic across repeated runs', JSON.stringify(again.contentionTrace) === JSON.stringify(rc.contentionTrace));
    const aggregated = aggregateContentionTraces([p0c.contentionTrace, p0c.contentionTrace]);
    check('AGGREGATION: an event identical in every field including the round is kept once; distinct rounds are kept separately', aggregated.events.length === 1 && aggregateContentionTraces([p0c.contentionTrace, rc.contentionTrace]).events.length === 2);
  }

  console.log('=== tracing changes NOTHING: result, preview, tokens, queries, searches ===');
  {
    const A = requested('A', { importance: 'HIGH', originalOrder: 0 });
    const B = requested('B', { importance: 'LOW', originalOrder: 1 });
    const script = () => [[timing('11:00', '12:00')], [timing('11:00', '12:00')], [timing('11:30', '12:30')]];
    const plain = scriptedDeps(script());
    const withTrace = scriptedDeps(script());
    const plainResult = await orchestrateConstructDay(orchRequest([A, B]), plain.deps);
    const tracedResult = await orchestrateConstructDayWithTrace(orchRequest([A, B]), withTrace.deps);
    check('OUTPUT: the orchestrated result is byte-identical with and without a trace request (Proposed, Deferred, conflicts, capacity, warnings, resolved intents)', JSON.stringify(plainResult) === JSON.stringify(tracedResult.result));
    const sign = (res: unknown) => JSON.stringify(signPreviewResultBody('user-1', res as Record<string, unknown>));
    check('TOKENS: the signed preview body, every acceptance token included, is identical (the trace is not part of the preview or its signature)', sign(plainResult) === sign(tracedResult.result) && sign(plainResult).includes('acceptanceToken'));
    check('QUERY / SEARCH PROFILE: the same loader calls and the same timing searches (same count, same excluded-interval sizes) -- tracing adds no query, no candidate generation and no second pass', JSON.stringify(plain.calls) === JSON.stringify(withTrace.calls) && plain.calls.search === 3 && plain.calls.plans === 1 && plain.calls.duration === 1);
    check('the preview carries no contention anywhere (it is not part of the public contract)', !JSON.stringify(tracedResult.result).toLowerCase().includes('contention'));
    // direct Constructor equality over every scenario shape
    const shapes: ConstructDayInput[] = [
      contest().build(), contest('10:00', '11:00', { imp: ['MEDIUM', 'MEDIUM'] }).build(true),
      input([mk('H1', { importance: 'HIGH', minutes: 30 }), mk('H2', { importance: 'HIGH', order: 1, minutes: 30 }), mk('LOW', { importance: 'LOW', order: 2 })], { H1: [cand('H1', '10:00', '10:30')], H2: [cand('H2', '10:30', '11:00')], LOW: [cand('LOW', '10:15', '11:15')] }),
      input([mk('F', { flexibility: 'FIXED' }), mk('X', { order: 1 })], { X: [cand('X', '10:30', '11:30')] }, { fixedConstraintsByIntentId: { F: [fixedAt('F', '10:00', '11:00')] } }),
      input([mk('LOW')], { LOW: [cand('LOW', '10:00', '11:00')] }, { blockedIntervals: [block('10:00', '11:00')] }),
      input([mk('A', { minutes: 120 })], { A: [] }, { window: win('10:00', '10:00') }),
    ];
    check('CONSTRUCTOR RESULT: for every shape (contest, equal importance reversed, multi-owner, FIXED, blocker, invalid window) `constructDayWithTrace(input).result` and `constructDay(input)` are byte-identical', shapes.every((s) => JSON.stringify(constructDay(s)) === JSON.stringify(constructDayWithTrace(s).result)));
    check('a failed construction (invalid window / no usable capacity) returns the shared empty trace', constructDayWithTrace(shapes[5]).trace === EMPTY_CONTENTION_TRACE && constructDayWithTrace(shapes[5]).result.status !== 'READY');
    const frozenInput = contest().build();
    const before = JSON.stringify(frozenInput);
    constructDayWithTrace(frozenInput);
    check('the Constructor input is not mutated by tracing', JSON.stringify(frozenInput) === before);
  }

  console.log('=== independent of decision pressure, evidence and facts (scheduling mechanics only) ===');
  {
    const A = requested('A', { importance: 'HIGH', originalOrder: 0 });
    const B = requested('B', { importance: 'LOW', originalOrder: 1 });
    const week = { period: 'LOCAL_CALENDAR_WEEK' as const, periodStartDate: '2026-10-05', periodEndDate: '2026-10-11', targetPerPeriod: 7, completedInPeriod: 0, committedInPeriod: 0, remainingInPeriod: 7 };
    const rangeDeps: OpportunityRangeDeps = { loadAvailabilityConfiguration: async () => workWeek, loadPlansOverlappingRange: async () => [] };
    const script = () => [[timing('11:00', '12:00')], [timing('11:00', '12:00')], []];
    const bare = await orchestrateConstructDayWithTrace(orchRequest([A, B]), scriptedDeps(script()).deps);
    const withFacts = await orchestrateConstructDayWithTrace(orchRequest([A, B], { A: { recurrence: week }, B: { recurrence: week } }), scriptedDeps(script(), undefined, { prepareDecisionFacts: createDecisionFactPreparer(rangeDeps) }).deps);
    const scarceLoser = await orchestrateConstructDayWithTrace(orchRequest([A, B], { B: { recurrence: week } }), scriptedDeps(script(), undefined, { prepareDecisionFacts: createDecisionFactPreparer(rangeDeps) }).deps);
    check('PRESSURE / FACTS INDEPENDENCE: the trace is identical with no facts, with recurrence + opportunity facts on both candidates, and with maximally scarce facts on only the loser (the Constructor and its trace read none of them)', JSON.stringify(bare.contentionTrace) === JSON.stringify(withFacts.contentionTrace) && JSON.stringify(bare.contentionTrace) === JSON.stringify(scarceLoser.contentionTrace) && bare.contentionTrace.events.length === 1);
    check('and the constructed day is unchanged by those facts too (HIGH Proposed, B Deferred NO_CANDIDATES)', JSON.stringify(READY(bare.result).constructedDay) === JSON.stringify(READY(withFacts.result).constructedDay));
  }

  console.log('=== source neutrality at the Constructor boundary ===');
  {
    const idSets: Array<[string, string]> = [['HIGH', 'LOW'], ['goal-demand:2026-10-07:ga-1', 'goal-demand:2026-10-07:ga-2'], ['plan-day-goal-ga-1', 'plan-day-goal-ga-2'], ['typed-1', 'typed-2']];
    const traces = idSets.map(([hi, lo]) => {
      const h = mk(hi, { importance: 'HIGH', order: 0 });
      const l = mk(lo, { importance: 'LOW', order: 1 });
      const t = traced(input([h, l], { [hi]: [cand(hi, '10:00', '11:00')], [lo]: [cand(lo, '10:00', '11:00')] })).trace;
      return JSON.stringify(t).split(hi).join('WIN').split(lo).join('LOSE');
    });
    check('SOURCE NEUTRALITY: equivalent scheduling inputs produce the equivalent trace whether the ids look like a Goal automatic demand, a manual hand-off or a typed row (the Constructor sees Constructor identity only)', traces.every((t) => t === traces[0]) && traces[0].includes('"loserIntentId":"LOSE"'));
  }

  console.log('=== immutability and defensive ownership ===');
  {
    const c = contest();
    const lowCand = cand('LOW', '10:00', '11:00');
    const i = input([c.high, c.low], { HIGH: [cand('HIGH', '10:00', '11:00')], LOW: [lowCand] });
    const r = traced(i);
    const event = r.trace.events[0];
    check('the trace, its events array and every event are frozen', Object.isFrozen(r.trace) && Object.isFrozen(r.trace.events) && r.trace.events.every((e) => Object.isFrozen(e)));
    check('STRICT-MODE WRITES FAIL LOUDLY: reassigning any event field, adding a key, pushing to events and replacing events all throw', throwsTypeError(() => { (event as { round: number }).round = 9; }) && throwsTypeError(() => { (event as { loserIntentId: string }).loserIntentId = 'x'; }) && throwsTypeError(() => { (event as unknown as { extra: number }).extra = 1; }) && throwsTypeError(() => { (r.trace.events as ContentionEvent[]).push(event); }) && throwsTypeError(() => { (r.trace as { events: unknown }).events = []; }));
    const snapshot = JSON.stringify(r.trace);
    lowCand.start.setTime(at('15:00').getTime());
    check('DEFENSIVE OWNERSHIP: mutating the candidate\'s Date after construction cannot change a recorded event (instants are copied as immutable strings)', JSON.stringify(r.trace) === snapshot);
    const again = traced(contest().build());
    check('a caller\'s mutation of one returned trace cannot affect another call\'s trace or the Constructor result', JSON.stringify(again.trace) === snapshot && JSON.stringify(day(again.result)) === JSON.stringify(day(traced(contest().build()).result)));
    const built = buildContentionEvents(0, []);
    check('building from no attempts is empty, and the shared empty trace is frozen', built.length === 0 && Object.isFrozen(EMPTY_CONTENTION_TRACE) && Object.isFrozen(EMPTY_CONTENTION_TRACE.events));
  }

  if (!allPassed) { console.error('SOME CONTENTION TRACE CHECKS FAILED'); process.exitCode = 1; return; }
  console.log('ALL CONTENTION TRACE CHECKS PASSED');
})().then(() => process.exit(), (err) => { console.error(err); process.exit(1); });
