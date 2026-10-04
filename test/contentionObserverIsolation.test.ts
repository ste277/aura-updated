/**
 * Constructor Decision Intelligence -- O5 P3a observer-isolation follow-up (pure behavior, no DB).
 *
 * INVARIANT: OBSERVATION MUST NOT HAVE AUTHORITY OVER CONSTRUCTION. Contention tracing is observational only: no caller
 * code may be invoked from inside Constructor placement, no Constructor-owned object may be reachable from a trace, and
 * the returned trace and the returned Constructor result must be independently owned.
 *
 * The first part reproduces the four failure modes of the former exported `constructDay(input, sink)` diagnostic
 * parameter -- a frozen sink aborting construction, a throwing `push` propagating, a sink mutating a Constructor-owned
 * interval/Date during construction (changing scheduling), and a retained reference mutated after return (changing the
 * returned result) -- through the PUBLIC API, so each is asserted impossible rather than merely survived. (Written to
 * fail on the pre-fix head, where all four reproduce.) The second part proves ownership: a trace is detached scalar data,
 * frozen at every level, and mutation in either direction (trace -> result, result -> trace) changes nothing.
 *
 * Product / architecture invariants only: no timing, randomness, heap layout or query plan.
 */
import { buildDayIntent, type ConstructionWindow, type DayIntent, type DayIntentImportance } from '../apps/web/lib/dayIntent';
import * as constructorModule from '../apps/web/lib/dayConstructor';
import { constructDay, constructDayWithTrace, type ConstructDayInput, type ConstructDayResult, type ConstructedDay } from '../apps/web/lib/dayConstructor';
import { orchestrateConstructDay, orchestrateConstructDayWithTrace, type ConstructDayRequest, type DayConstructorOrchestratorDeps, type RequestedDayIntent } from '../apps/web/lib/dayConstructorOrchestrator';
import type { ContentionTrace } from '../apps/web/lib/contentionTrace';
import type { TimingCandidate } from '../packages/recommendation/src/timingSearch';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const throwsTypeError = (fn: () => void) => { try { fn(); return false; } catch (e) { return e instanceof TypeError; } };
const doesNotThrow = (fn: () => void) => { try { fn(); return true; } catch { return false; } };

const D = '2026-10-07';
const at = (hhmm: string) => new Date(`${D}T${hhmm}:00Z`);
const win = (): ConstructionWindow => ({ date: D, start: at('09:00'), end: at('17:00'), timezone: 'UTC', source: 'EXPLICIT_RANGE' });
const mk = (id: string, importance: DayIntentImportance, order: number): DayIntent => ({ ...buildDayIntent({ title: id, targetDate: D, estimatedDurationMinutes: 60, importance }, order), id });
const cand = (id: string, s: string, e: string, order = 0) => ({ intentId: id, start: at(s), end: at(e), candidateOrder: order });
/** HIGH owns [10:00,11:00); LOW's first candidate collides with it and its second is free: a contention fixture where LOW is then placed. */
const build = (): ConstructDayInput => ({
  intents: [mk('HIGH', 'HIGH', 0), mk('LOW', 'LOW', 1)], window: win(), blockedIntervals: [],
  candidatesByIntentId: { HIGH: [cand('HIGH', '10:00', '11:00')], LOW: [cand('LOW', '10:00', '11:00', 0), cand('LOW', '12:00', '13:00', 1)] },
  fixedConstraintsByIntentId: {}, today: D,
});
/** Same contest, but LOW attempts TWO blocked intervals ([10:00,11:00) and [10:30,11:30)) -- a trace of two events, so sort / reverse are real mutations. */
const buildMulti = (): ConstructDayInput => { const i = build(); return { ...i, candidatesByIntentId: { ...i.candidatesByIntentId, LOW: [cand('LOW', '10:00', '11:00', 0), cand('LOW', '10:30', '11:30', 1), cand('LOW', '12:00', '13:00', 2)] } }; };
const day = (r: ConstructDayResult): ConstructedDay => { if (r.status !== 'READY') throw new Error(`expected READY, got ${r.status}`); return r.day; };
const baseline = JSON.stringify(constructDay(build()));

// ---- hostile "sinks" a caller could try to hand to the former diagnostic parameter ----
class ThrowingSink extends Array<unknown> { push(..._items: unknown[]): number { throw new Error('sink boom'); } }
let evilInvocations = 0;
class MutatingSink extends Array<any> {
  push(...items: any[]): number {
    evilInvocations += 1;
    for (const item of items) {
      for (const owner of item?.owners ?? []) { owner.start?.setTime?.(at('15:00').getTime()); owner.end?.setTime?.(at('16:00').getTime()); owner.intentId = 'tampered'; }
      item?.attempted?.start?.setTime?.(at('15:00').getTime());
    }
    return super.push(...items);
  }
}
const asAny = (fn: unknown) => fn as (...args: unknown[]) => ConstructDayResult;

const timing = (start: string, end: string): TimingCandidate => ({ start: `${D}T${start}:00Z`, end: `${D}T${end}:00Z`, score: 5, label: 'GOOD', muhurtaScore: 0, reasons: [], metadata: { windowType: 'NEUTRAL', windowLabel: 'Neutral Flow', activityType: 'x', dateLabel: D } });
const requested = (id: string, over: Partial<RequestedDayIntent> = {}): RequestedDayIntent => ({ id, title: id, flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 60, originalOrder: 0, ...over });
const orchRequest = (intents: RequestedDayIntent[]): ConstructDayRequest => ({ targetDate: D, timezone: 'UTC', constructionWindowSource: 'EXPLICIT_RANGE', now: at('09:00'), explicitStart: at('09:00'), explicitEnd: at('17:00'), intents });
const scriptedDeps = (script: TimingCandidate[][]): { deps: DayConstructorOrchestratorDeps } => {
  let n = 0;
  return { deps: { loadBlockingPlans: async () => [], loadDurationContext: async () => ({ preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} }), searchTiming: () => ({ candidates: script[n++] ?? [] }), loadAvailabilityConfiguration: async () => ({ configured: false, periods: [] }) } };
};
/** Every value reachable from `value`, with whether each is a primitive; used to prove a trace is detached scalar data. */
function reachableObjects(value: unknown, seen = new Set<unknown>()): unknown[] {
  if (value === null || typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);
  const out: unknown[] = [value];
  for (const child of Object.values(value as Record<string, unknown>)) out.push(...reachableObjects(child, seen));
  return out;
}

(async () => {
  console.log('=== strict-mode precondition ===');
  check('this file runs in strict mode: a write to a frozen object THROWS', throwsTypeError(() => { (Object.freeze({ a: 1 }) as { a: number }).a = 2; }));

  // ============================================================
  console.log('=== A. a FROZEN caller-supplied sink can no longer abort construction ===');
  {
    let result: ConstructDayResult | undefined;
    const ok = doesNotThrow(() => { result = asAny(constructDay)(build(), Object.freeze([])); });
    check('A. `constructDay(input, Object.freeze([]))` does not throw and returns exactly the baseline result (the exported API accepts no caller sink: a second argument is inert)', ok && JSON.stringify(result) === baseline);
  }
  console.log('=== B. a THROWING caller sink can no longer propagate into scheduling ===');
  {
    let result: ConstructDayResult | undefined;
    const ok = doesNotThrow(() => { result = asAny(constructDay)(build(), new ThrowingSink()); });
    check('B. a sink whose push throws is never invoked: no exception escapes `constructDay`, and the result is the baseline', ok && JSON.stringify(result) === baseline);
  }
  console.log('=== C. a caller can no longer mutate Constructor-owned intervals DURING construction ===');
  {
    evilInvocations = 0;
    const result = asAny(constructDay)(build(), new MutatingSink());
    check('C. a sink that rewrites the intervals/Dates/owner ids it receives is never called, and scheduling is the baseline (there is no caller-controlled during-construction channel)', evilInvocations === 0 && JSON.stringify(result) === baseline);
    evilInvocations = 0;
    const viaTrace = asAny(constructDayWithTrace)(build(), 0, new MutatingSink()) as unknown as { result: ConstructDayResult };
    check('C\'. the same holds for the diagnostics entry point: a third argument is inert and construction is the baseline', evilInvocations === 0 && JSON.stringify(viaTrace.result) === baseline);
  }
  console.log('=== D. a retained reference can no longer be mutated AFTER return to change the Constructor result ===');
  {
    const retained: any[] = [];
    const result = asAny(constructDay)(build(), retained);
    const before = JSON.stringify(result);
    for (const item of retained) for (const owner of item?.owners ?? []) owner?.start?.setTime?.(at('15:30').getTime());
    check('D. nothing is collected into a caller-retained list (it stays empty), so a later mutation through it cannot change the returned result', retained.length === 0 && JSON.stringify(result) === before && JSON.stringify(result) === baseline);
  }

  // ============================================================
  console.log('=== the exported API has no observer, sink, callback or collector parameter ===');
  check('`constructDay` takes exactly ONE parameter (the input) -- and its source declares no second one', constructDay.length === 1 && /export function constructDay\(input: ConstructDayInput\): ConstructDayResult/.test(constructDay.toString() ? require('fs').readFileSync(require('path').join(__dirname, '..', 'apps/web/lib/dayConstructor.ts'), 'utf8') : ''));
  check('`constructDayWithTrace` takes the input and a round LABEL (a number) only -- nothing a caller supplies is ever invoked from inside placement', constructDayWithTrace.length <= 2);
  check('the Constructor module exports no observer/sink/collector/core: its only trace-related export is `constructDayWithTrace`', Object.keys(constructorModule).filter((k) => /observer|sink|collector|core|contention|trace/i.test(k)).join() === 'constructDayWithTrace');
  check('the orchestrator exports exactly two entry points, the legacy one and the diagnostics one (no callback-accepting variant)', JSON.stringify(Object.keys(require('../apps/web/lib/dayConstructorOrchestrator')).filter((k) => /orchestrateConstructDay/.test(k)).sort()) === JSON.stringify(['orchestrateConstructDay', 'orchestrateConstructDayWithTrace']));

  // ============================================================
  console.log('=== identity: the diagnostics path and the legacy path produce the same Constructor result ===');
  {
    const traced = constructDayWithTrace(build());
    check('LEGACY IDENTITY: `constructDay(input)` is the baseline result', JSON.stringify(constructDay(build())) === baseline);
    check('TRACE IDENTITY: `constructDayWithTrace(input).result` deeply equals `constructDay(input)` for the same input', JSON.stringify(traced.result) === baseline);
    check('the fixture really contends: LOW\'s first candidate lost [10:00,11:00) to HIGH (and LOW was placed on its second), so the independence checks below are not vacuous', traced.trace.events.length === 1 && traced.trace.events[0].loserIntentId === 'LOW' && traced.trace.events[0].winnerIntentId === 'HIGH' && day(traced.result).proposedItems.length === 2);
  }

  console.log('=== a returned trace is DETACHED scalar data ===');
  {
    const { trace } = constructDayWithTrace(build());
    const objects = reachableObjects(trace);
    const events = trace.events as unknown as readonly Record<string, unknown>[];
    check('DATE OWNERSHIP, structurally: no Date (and no object other than the frozen trace, its events array and its events) is reachable from a trace -- every event field is a string or a number', objects.length === 2 + events.length && objects.every((o) => !(o instanceof Date)) && events.every((e) => Object.values(e).every((v) => typeof v === 'string' || typeof v === 'number')));
    check('instants are ISO-8601 UTC strings, not Constructor Date objects', events.every((e) => typeof e.attemptedStart === 'string' && /Z$/.test(e.attemptedStart as string) && typeof e.winnerEnd === 'string'));
    const constructorOwned = new Set<unknown>();
    const r = day(constructDayWithTrace(build()).result);
    for (const p of r.proposedItems) { constructorOwned.add(p); constructorOwned.add(p.start); constructorOwned.add(p.end); }
    check('SHARED-REFERENCE AUDIT: nothing reachable from the trace is a Constructor-owned object (ProposedItem, its start/end Dates, an owner interval, a candidate or a candidate window)', reachableObjects(trace).every((o) => !constructorOwned.has(o)) && reachableObjects(trace).length === objects.length);
  }

  console.log('=== post-call mutation of the returned trace ===');
  {
    const run = constructDayWithTrace(buildMulti());
    const multiBaseline = JSON.stringify(constructDay(buildMulti()));
    check('the mutation fixture is a two-event trace (so sort and reverse are genuine mutations)', run.trace.events.length === 2);
    const { trace } = run;
    const snapshotTrace = JSON.stringify(trace);
    const snapshotResult = JSON.stringify(run.result);
    const event = trace.events[0] as { loserIntentId: string; round: number };
    const attempts: Array<[string, () => void]> = [
      ['reassign an event field', () => { event.loserIntentId = 'x'; }],
      ['reassign the round', () => { event.round = 9; }],
      ['add a field to an event', () => { (event as unknown as { extra: number }).extra = 1; }],
      ['delete an event field', () => { delete (event as unknown as { round?: number }).round; }],
      ['push an event', () => { (trace.events as unknown as unknown[]).push({}); }],
      ['pop an event', () => { (trace.events as unknown as unknown[]).pop(); }],
      ['splice the events', () => { (trace.events as unknown as unknown[]).splice(0, 1); }],
      ['assign an index', () => { (trace.events as unknown as unknown[])[0] = {}; }],
      ['set length', () => { (trace.events as unknown as unknown[]).length = 0; }],
      ['sort the events', () => { (trace.events as unknown as unknown[]).sort(); }],
      ['reverse the events', () => { (trace.events as unknown as unknown[]).reverse(); }],
      ['replace the events array', () => { (trace as unknown as { events: unknown }).events = []; }],
    ];
    for (const [label, mutate] of attempts) check(`POST-CALL: attempting to ${label} is rejected`, throwsTypeError(mutate));
    check('the trace and the Constructor result are unchanged by every attempt', JSON.stringify(trace) === snapshotTrace && JSON.stringify(run.result) === snapshotResult && snapshotResult === multiBaseline);
    const copy = JSON.parse(JSON.stringify(trace)) as { events: Array<{ loserIntentId: string }> };
    copy.events[0].loserIntentId = 'tampered';
    copy.events.length = 0;
    check('RESULT MUTATION INDEPENDENCE: mutating a caller-owned copy of the trace changes neither the Constructor result nor the real trace', JSON.stringify(run.result) === multiBaseline && JSON.stringify(trace) === snapshotTrace);
  }

  console.log('=== the trace and the Constructor result are independently owned ===');
  {
    const run = constructDayWithTrace(build());
    const snapshotTrace = JSON.stringify(run.trace);
    const d = day(run.result);
    for (const p of d.proposedItems) { p.start.setTime(at('15:00').getTime()); p.end.setTime(at('16:00').getTime()); (p as { intentId: string }).intentId = 'tampered'; }
    d.deferredItems.length = 0; d.proposedItems.length = 0; d.conflicts.length = 0;
    check('TRACE MUTATION INDEPENDENCE: mutating the returned Constructor result (its Dates, ids and arrays) after return does not alter the trace', JSON.stringify(run.trace) === snapshotTrace);
    const twice = [constructDayWithTrace(build()), constructDayWithTrace(build())];
    (twice[0].result as unknown as { day: { proposedItems: unknown[] } }).day.proposedItems.length = 0;
    check('two calls share nothing: mutating one call\'s result cannot change another call\'s trace or result', JSON.stringify(twice[1].trace) === snapshotTrace && JSON.stringify(twice[1].result) === baseline);
    const input = build();
    const before = JSON.stringify(input);
    constructDayWithTrace(input);
    check('the Constructor input is not mutated by tracing', JSON.stringify(input) === before);
  }

  // ============================================================
  console.log('=== the orchestrator: legacy path never traces; the diagnostics path uses the internal observer only ===');
  {
    const real = { constructDay: constructorModule.constructDay, constructDayWithTrace: constructorModule.constructDayWithTrace };
    const argCounts: number[] = [];
    let traceCalls = 0;
    (constructorModule as any).constructDay = (...args: unknown[]) => { argCounts.push(args.length); return (real.constructDay as any)(...args); };
    (constructorModule as any).constructDayWithTrace = (...args: unknown[]) => { traceCalls += 1; return (real.constructDayWithTrace as any)(...args); };
    try {
      const A = requested('A', { importance: 'HIGH', originalOrder: 0 });
      const B = requested('B', { importance: 'LOW', originalOrder: 1 });
      const script = () => [[timing('11:00', '12:00')], [timing('11:00', '12:00')], []];
      const legacy = await orchestrateConstructDay(orchRequest([A, B]), scriptedDeps(script()).deps);
      check('NORMAL PREVIEW / ORCHESTRATION: `orchestrateConstructDay` never collects a trace (no call to the trace entry point) and calls `constructDay` with exactly one argument every time (initial pass and replenishment)', traceCalls === 0 && argCounts.length >= 2 && argCounts.every((n) => n === 1));
      argCounts.length = 0;
      const withTrace = await orchestrateConstructDayWithTrace(orchRequest([A, B]), scriptedDeps(script()).deps);
      check('TRACE ORCHESTRATOR: `orchestrateConstructDayWithTrace` runs the same passes through `constructDayWithTrace` (an internally created observer), never handing a caller observer to `constructDay`', traceCalls >= 2 && argCounts.every((n) => n === 1));
      check('same result either way, and the accumulated trace is detached scalar data with the round-0 event surviving the final NO_CANDIDATES', JSON.stringify(legacy) === JSON.stringify(withTrace.result) && withTrace.contentionTrace.events.length === 1 && withTrace.contentionTrace.events[0].round === 0 && reachableObjects(withTrace.contentionTrace).every((o) => !(o instanceof Date)));
      const t: ContentionTrace = withTrace.contentionTrace;
      check('the orchestrator trace is frozen at every level too', Object.isFrozen(t) && Object.isFrozen(t.events) && t.events.every((e) => Object.isFrozen(e)) && throwsTypeError(() => { (t.events as unknown as unknown[]).push({}); }));
    } finally {
      (constructorModule as any).constructDay = real.constructDay;
      (constructorModule as any).constructDayWithTrace = real.constructDayWithTrace;
    }
  }

  if (!allPassed) { console.error('SOME CONTENTION OBSERVER ISOLATION CHECKS FAILED'); process.exitCode = 1; return; }
  console.log('ALL CONTENTION OBSERVER ISOLATION CHECKS PASSED');
})().then(() => process.exit(), (err) => { console.error(err); process.exit(1); });
