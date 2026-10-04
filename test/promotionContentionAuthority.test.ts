/**
 * Constructor Decision Intelligence -- O5 P4b2a: the IMMUTABLE PROMOTION CONTENTION AUTHORITY (pure behavior, no DB).
 *
 * WHY. The blocked P4b2 proof showed `ConstructionBasis.initialCandidates UNION finalCandidates` cannot reconstruct every interval a
 * pressured Deferred candidate really attempted against its owners: replenishment overwrites a conflicted loser's list each round and the
 * real search truncates. P3a observed those attempts directly, so the authority is a narrow typed projection of the P3a events of the SAME
 * run, for ONE PromotionInput.
 *
 * Part 1 drives the REAL pipeline (real orchestrator, P3a trace, P3b, P4a / P4a2 promotion inputs, P4b1 basis, P4b1b placements, P4b2a
 * authority) on the exact blocked counterexample: O@11:00; B initial 11:30 (replenished to 10:00); P initial 10:30 (replenished to 10:00); P
 * loses 10:30 to O in round 0 and 10:00 to B in round 1; P's final list is empty. The 10:00 attempt is in NEITHER captured candidate list
 * and IS in the authority. Part 2 drives the pure projection with controlled traces over that real basis / placements: filters, owner
 * authority, duplicates, order, fail-closed reasons, detachment, freezing. Part 3 is the committed, deterministic property sweep of the
 * blocked randomized exploration: COMPLETENESS (zero missing real attempts) and SOUNDNESS (zero invented intervals) over every emitted
 * PromotionInput, with truncating honest searches, while counting how often the old candidate-list reconstruction would have lost one.
 *
 * Date caveat, stated honestly: `Object.freeze` does not stop a Date setter changing a Date's internal time. Safety is OWNERSHIP (every
 * attempt Date is newly created) plus the #208 no-Date-mutator guard. Product / architecture invariants only: no timing or heap layout.
 */
import * as authorityModule from '../apps/web/lib/promotionContentionAuthority';
import { projectContentionAuthority, type PromotionContentionOutcome } from '../apps/web/lib/promotionContentionAuthority';
import type { ConstructionBasis, ConstructionBasisOutcome } from '../apps/web/lib/constructionBasis';
import type { BaselinePlacementsOutcome } from '../apps/web/lib/baselinePlacements';
import type { ContentionEvent, ContentionTrace } from '../apps/web/lib/contentionTrace';
import { assemblePromotionInputs, type PromotionInput } from '../apps/web/lib/promotionInput';
import { preparePromotionInputs } from '../apps/web/lib/promotionInputPreparation';
import { observeShadowPressure } from '../apps/web/lib/shadowPressureObservation';
import { deriveDecisionPressure } from '../apps/web/lib/decisionPressure';
import { projectAbovePressureFacts } from '../apps/web/lib/abovePressurePrecedence';
import * as constructorModule from '../apps/web/lib/dayConstructor';
import type { DecisionFacts } from '../apps/web/lib/decisionFacts';
import { orchestrateConstructDay, orchestrateConstructDayWithDiagnostics, type ConstructDayRequest, type DayConstructorOrchestratorDeps, type RequestedDayIntent } from '../apps/web/lib/dayConstructorOrchestrator';
import { createDecisionFactPreparer } from '../apps/web/lib/decisionFactPreparation';
import type { OpportunityRangeDeps } from '../apps/web/lib/opportunityRangeAdapter';
import type { AvailabilityConfiguration } from '../apps/web/lib/availabilityContext';
import type { TimingCandidate } from '../packages/recommendation/src/timingSearch';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const throwsTypeError = (fn: () => void) => { try { fn(); return false; } catch (e) { return e instanceof TypeError; } };
const reachable = (v: unknown, seen = new Set<unknown>()): Set<unknown> => { if (v !== null && typeof v === 'object' && !seen.has(v)) { seen.add(v); Object.values(v as Record<string, unknown>).forEach((c) => reachable(c, seen)); } return seen; };
const disjoint = (a: Set<unknown>, b: Set<unknown>) => [...a].every((o) => !b.has(o));

type Weekday = AvailabilityConfiguration['periods'][number]['weekday'];
const FRIDAY = '2026-10-09';
const workWeek: AvailabilityConfiguration = { configured: true, periods: ([1, 2, 3, 4, 5] as Weekday[]).map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })) };
const rangeDeps: OpportunityRangeDeps = { loadAvailabilityConfiguration: async () => workWeek, loadPlansOverlappingRange: async () => [] };
const at = (h: string) => new Date(`${FRIDAY}T${h}:00Z`);
const hhmm = (d: Date | string) => new Date(d).toISOString().slice(11, 16);
const timing = (s: string, e: string): TimingCandidate => ({ start: `${FRIDAY}T${s}:00Z`, end: `${FRIDAY}T${e}:00Z`, score: 5, label: 'GOOD', muhurtaScore: 0, reasons: [], metadata: { windowType: 'NEUTRAL', windowLabel: 'x', activityType: 'x', dateLabel: FRIDAY } });
const overlapsC = (c: TimingCandidate, e: { start: Date; end: Date }) => new Date(c.start).getTime() < e.end.getTime() && e.start.getTime() < new Date(c.end).getTime();
/** An HONEST search: filters its pool by `excludedIntervals` BEFORE truncating to `limit` (the real search's order), exactly like the real thing. */
const limited = (pools: Record<string, TimingCandidate[]>, limit: number) => (r: any): TimingCandidate[] => (pools[r.taskTitle ?? r.activityId] ?? []).filter((c) => !(r.excludedIntervals ?? []).some((e: { start: Date; end: Date }) => overlapsC(c, e))).slice(0, limit);
const WEEK_FACTS: DecisionFacts = { recurrence: { period: 'LOCAL_CALENDAR_WEEK', periodStartDate: '2026-10-05', periodEndDate: '2026-10-11', targetPerPeriod: 3, completedInPeriod: 0, committedInPeriod: 0, remainingInPeriod: 3 } };
const req = (id: string, order: number): RequestedDayIntent => ({ id, title: id, flexibility: 'FLEXIBLE', durationMinutes: 60, originalOrder: order } as RequestedDayIntent);
const request = (intents: RequestedDayIntent[], pressured: string[]): ConstructDayRequest => ({
  targetDate: FRIDAY, timezone: 'UTC', constructionWindowSource: 'EXPLICIT_RANGE', now: at('09:00'), explicitStart: at('09:00'), explicitEnd: at('17:00'), intents,
  decisionFactsByIntentId: new Map(pressured.map((id) => [id, WEEK_FACTS] as [string, DecisionFacts])),
});
interface Calls { search: number; plans: number; duration: number; availability: number }
const mkDeps = (search: (r: any) => TimingCandidate[], calls: Calls = { search: 0, plans: 0, duration: 0, availability: 0 }): { deps: DayConstructorOrchestratorDeps; calls: Calls } => ({
  calls,
  deps: {
    loadBlockingPlans: async () => { calls.plans += 1; return []; },
    loadDurationContext: async () => { calls.duration += 1; return { preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} }; },
    searchTiming: (r: any) => { calls.search += 1; return { candidates: search(r) }; },
    loadAvailabilityConfiguration: async () => { calls.availability += 1; return { configured: false, periods: [] }; },
    prepareDecisionFacts: createDecisionFactPreparer(rangeDeps),
  },
});
const ready = (o: PromotionContentionOutcome) => { if (o.status !== 'READY') throw new Error(`authority ${o.reason}`); return o.authority; };
const reasonOf = (o: PromotionContentionOutcome) => (o.status === 'UNAVAILABLE' ? o.reason : 'READY');
const attemptShape = (o: PromotionContentionOutcome) => ready(o).attempts.map((a) => `${a.ownerIntentId}@${hhmm(a.start)}-${hhmm(a.end)}`).join(' ');
const ev = (loser: string, winner: string, s: string, e: string, round = 0): ContentionEvent => ({ loserIntentId: loser, winnerIntentId: winner, attemptedStart: `${FRIDAY}T${s}:00.000Z`, attemptedEnd: `${FRIDAY}T${e}:00.000Z`, winnerStart: `${FRIDAY}T${s}:00.000Z`, winnerEnd: `${FRIDAY}T${e}:00.000Z`, round });
const traceOf = (events: ContentionEvent[]): ContentionTrace => ({ events });

// The exact blocked counterexample.
const POOLS = { O: [timing('11:00', '12:00')], B: [timing('11:30', '12:30'), timing('10:00', '11:00')], P: [timing('10:30', '11:30'), timing('10:00', '11:00')] };
const INTENTS = [req('O', 0), req('B', 1), req('P', 2)];

(async () => {
  console.log('=== REAL pipeline: the blocked counterexample (P3a -> P3b -> P4a2 -> P4b1 -> P4b1b -> P4b2a) ===');
  const diag = await orchestrateConstructDayWithDiagnostics(request(INTENTS, ['O', 'B', 'P']), mkDeps(limited(POOLS, 1)).deps);
  if (diag.result.status !== 'READY' || diag.constructionBasis.status !== 'READY' || diag.baselinePlacements.status !== 'READY') throw new Error('fixture run not READY');
  const basisOutcome: ConstructionBasisOutcome = diag.constructionBasis;
  const placementsOutcome: BaselinePlacementsOutcome = diag.baselinePlacements;
  const basis: ConstructionBasis = basisOutcome.basis;
  const day = diag.result.preview.constructedDay;
  const prepared = await preparePromotionInputs(request(INTENTS, ['O', 'B', 'P']), mkDeps(limited(POOLS, 1)).deps);
  const input: PromotionInput = prepared.promotion.status === 'PREPARED' ? prepared.promotion.inputs[0] : (undefined as never);
  {
    check('SCENARIO IS THE BLOCKED ONE: O proposed 11:00, B proposed 10:00 (replenished), P finally Deferred; P3a recorded P@10:30 vs O (round 0), P@10:00 vs B (round 1)', day.proposedItems.map((p: any) => `${p.intentId}@${hhmm(p.start)}`).join() === 'O@11:00,B@10:00' && day.deferredItems.map((d: any) => d.intentId).join() === 'P' && diag.contentionTrace.events.filter((e) => e.loserIntentId === 'P').map((e) => `r${e.round} ${hhmm(e.attemptedStart)} vs ${e.winnerIntentId}`).join() === 'r0 10:30 vs O,r1 10:00 vs B');
    check('P4a2: exactly one PromotionInput -- candidate P, owners O and B -- from the same real pipeline', JSON.stringify(input.owners.map((o) => o.intentId)) === '["O","B"]' && input.candidateIntentId === 'P' && prepared.promotion.status === 'PREPARED' && prepared.promotion.inputs.length === 1);
    const shadow = await observeShadowPressure(request(INTENTS, ['O', 'B', 'P']), mkDeps(limited(POOLS, 1)).deps);
    check('P3b (the diagnostic oracle) classifies P PRESSURE_ELIGIBLE_AGAINST_ALL_FINAL_OWNERS, in agreement with the promotion input', shadow.shadow.status === 'EVALUATED' && shadow.shadow.evaluation.observations.some((o) => o.loserIntentId === 'P' && o.classification === 'PRESSURE_ELIGIBLE_AGAINST_ALL_FINAL_OWNERS'));
    check('THE BOUNDARY HANDS ONE AUTHORITY PER INPUT, in input order, from the SAME run', prepared.contention.length === 1 && ready(prepared.contention[0]).candidateIntentId === 'P');
    check('BOTH historical P attempts are preserved, in the trace\'s own order: P@10:30-11:30 vs O and P@10:00-11:00 vs B', attemptShape(prepared.contention[0]) === 'O@10:30-11:30 B@10:00-11:00');
    const pInit = basis.initialCandidates.find((l) => l.intentId === 'P')!.candidates.map((c) => hhmm(c.start));
    const pFinal = basis.finalCandidates.find((l) => l.intentId === 'P')!.candidates.map((c) => hhmm(c.start));
    check('MISSING-INTERMEDIATE PROOF: the 10:00 slot is NOT in P\'s initial candidates (10:30 only) and NOT in P\'s final candidates (empty), and IS in the authority -- the exact loss that blocked P4b2', JSON.stringify(pInit) === '["10:30"]' && pFinal.length === 0 && ready(prepared.contention[0]).attempts.some((a) => a.ownerIntentId === 'B' && hhmm(a.start) === '10:00' && hhmm(a.end) === '11:00'));
    check('the authority does NOT replace the candidate lists: the basis still holds initial AND final lists (B\'s relocation slot 11:30 survives only in its INITIAL list)', basis.initialCandidates.find((l) => l.intentId === 'B')!.candidates.map((c) => hhmm(c.start)).join() === '11:30' && basis.finalCandidates.find((l) => l.intentId === 'B')!.candidates.map((c) => hhmm(c.start)).join() === '10:00');
    check('CONTRACT SHAPE: exactly { candidateIntentId, attempts: [ { ownerIntentId, start, end } ] } -- no round, winner interval, pressure, importance, deadline, originalOrder, timing fit, candidate order, raw event or classification', JSON.stringify(Object.keys(ready(prepared.contention[0])).sort()) === '["attempts","candidateIntentId"]' && ready(prepared.contention[0]).attempts.every((a) => Object.keys(a).sort().join() === 'end,ownerIntentId,start') && !/round|winner|pressure|importance|deadline|originalOrder|timingFit|candidateOrder|classification/i.test(Object.keys(reachableObject(ready(prepared.contention[0]))).join()));
    const direct = projectContentionAuthority(diag.contentionTrace, input, basisOutcome, placementsOutcome);
    check('the pure projection over the diagnostics\' own trace, the same input and the same basis / placements equals what the boundary handed over', JSON.stringify(direct) === JSON.stringify(prepared.contention[0]));
    check('P4a / P4a2 UNCHANGED: the boundary still returns the same `promotion` outcome shape (PREPARED, inputs only) -- the contention is a SEPARATE sibling', Object.keys(prepared.promotion).sort().join() === 'inputs,status' && Object.keys(prepared).sort().join() === 'contention,promotion,result');
  }
  function reachableObject(v: unknown): Record<string, true> { const keys: Record<string, true> = {}; const seen = new Set<unknown>(); const walk = (x: unknown) => { if (x !== null && typeof x === 'object' && !seen.has(x)) { seen.add(x); if (!(x instanceof Date)) for (const [k, c] of Object.entries(x as Record<string, unknown>)) { keys[k] = true; walk(c); } } }; walk(v); return keys; }

  console.log('=== filters: candidate, owner, no owner expansion ===');
  {
    const real = diag.contentionTrace.events;
    const noise: ContentionEvent[] = [ev('B', 'O', '11:30', '12:30'), ev('X', 'O', '11:00', '12:00'), ev('P', 'Z', '10:00', '11:00'), ev('P', 'P', '10:00', '11:00')];
    const polluted = traceOf([...noise.slice(0, 2), ...real, ...noise.slice(2)]);
    const out = projectContentionAuthority(polluted, input, basisOutcome, placementsOutcome);
    check('CANDIDATE FILTER: another loser\'s events (B lost to O at 11:30; X lost to O) are excluded -- only loser P\'s attempts remain', attemptShape(out) === 'O@10:30-11:30 B@10:00-11:00');
    check('OWNER FILTER: an event whose winner is not an owner of the PromotionInput (Z, or P itself) is excluded -- the unrelated trace owner never appears', !ready(out).attempts.some((a) => a.ownerIntentId === 'Z' || a.ownerIntentId === 'P'));
    // B is a real, placed, basis intent but NOT authorized by a narrower PromotionInput: its attempt must not enter and B must not become movable.
    const narrower: PromotionInput = { candidateIntentId: 'P', owners: [{ intentId: 'O', pressure: 'NONE' }] };
    const narrow = projectContentionAuthority(diag.contentionTrace, narrower, basisOutcome, placementsOutcome);
    check('NO OWNER EXPANSION: with the PromotionInput authorizing only O, the real P-vs-B attempt (a placed basis intent, a real event) is NOT in the authority -- the trace cannot enlarge the owner scope', attemptShape(narrow) === 'O@10:30-11:30' && !ready(narrow).attempts.some((a) => a.ownerIntentId === 'B'));
    const unauthorizedOnly = traceOf([ev('P', 'B', '10:00', '11:00')]);
    check('an authorized owner with NO supporting event is an inconsistent pairing (never a quiet widening): INCONSISTENT_INPUT', reasonOf(projectContentionAuthority(unauthorizedOnly, input, basisOutcome, placementsOutcome)) === 'INCONSISTENT_INPUT');
    check('MULTIPLE AUTHORIZED OWNERS: attempts are preserved against EACH authorized owner (O and B)', new Set(ready(prepared.contention[0]).attempts.map((a) => a.ownerIntentId)).size === 2);
  }

  console.log('=== duplicates and order ===');
  {
    const dupTrace = traceOf([ev('P', 'O', '10:30', '11:30', 0), ev('P', 'O', '10:30', '11:30', 1), ev('P', 'B', '10:00', '11:00', 1), ev('P', 'B', '10:00', '11:00', 2), ev('P', 'B', '10:30', '11:30', 2)]);
    const out = projectContentionAuthority(dupTrace, input, basisOutcome, placementsOutcome);
    check('DEDUP (pinned): the same (owner, start, end) recorded in several rounds is ONE attempt -- the round is not part of the contract, so the repetition carries nothing a generator can use; first occurrence wins', attemptShape(out) === 'O@10:30-11:30 B@10:00-11:00 B@10:30-11:30');
    check('DEDUP keeps DISTINCT owners over the same interval (P3a emits one event per overlapping owner): O@10:30-11:30 and B@10:30-11:30 would both survive', attemptShape(projectContentionAuthority(traceOf([ev('P', 'O', '10:30', '11:30'), ev('P', 'B', '10:30', '11:30')]), input, basisOutcome, placementsOutcome)) === 'O@10:30-11:30 B@10:30-11:30');
    check('ORDER: the trace\'s own order is preserved among surviving events (no policy ordering): reversing the source reverses the attempts', attemptShape(projectContentionAuthority(traceOf([ev('P', 'B', '10:00', '11:00'), ev('P', 'O', '10:30', '11:30')]), input, basisOutcome, placementsOutcome)) === 'B@10:00-11:00 O@10:30-11:30');
    check('DISTINCT attempted intervals against the SAME owner are all preserved (this is exactly the authority P4b2 proved missing)', attemptShape(projectContentionAuthority(traceOf([ev('P', 'O', '10:30', '11:30'), ev('P', 'O', '10:45', '11:45'), ev('P', 'B', '10:00', '11:00')]), input, basisOutcome, placementsOutcome)) === 'O@10:30-11:30 O@10:45-11:45 B@10:00-11:00');
  }

  console.log('=== fail closed ===');
  {
    const good = traceOf(diag.contentionTrace.events as ContentionEvent[]);
    const R = (t: ContentionTrace, i: PromotionInput, b: ConstructionBasisOutcome = basisOutcome, p: BaselinePlacementsOutcome = placementsOutcome) => reasonOf(projectContentionAuthority(t, i, b, p));
    check('ZERO MATCH: a trace with no event for the candidate (or none for its owners) -> UNAVAILABLE / NO_MATCHING_CONTENTION', R(traceOf([]), input) === 'NO_MATCHING_CONTENTION' && R(traceOf([ev('B', 'O', '11:30', '12:30')]), input) === 'NO_MATCHING_CONTENTION');
    check('UNKNOWN CANDIDATE: a candidate id that is not a basis intent -> INCONSISTENT_INPUT', R(good, { candidateIntentId: 'ZZ', owners: input.owners }) === 'INCONSISTENT_INPUT');
    check('UNKNOWN OWNER: an owner id that is not a basis intent -> INCONSISTENT_INPUT', R(good, { candidateIntentId: 'P', owners: [{ intentId: 'O', pressure: 'NONE' }, { intentId: 'ZZ', pressure: 'NONE' }] }) === 'INCONSISTENT_INPUT');
    check('UNAUTHORIZED / UNPLACED OWNER: an authorized owner that holds no baseline placement (P itself is a basis intent but Deferred) -> INCONSISTENT_INPUT; a candidate that IS placed (O) -> INCONSISTENT_INPUT', R(good, { candidateIntentId: 'P', owners: [{ intentId: 'O', pressure: 'NONE' }, { intentId: 'P', pressure: 'NONE' }] }) === 'INCONSISTENT_INPUT' && R(good, { candidateIntentId: 'O', owners: [{ intentId: 'B', pressure: 'NONE' }] }) === 'INCONSISTENT_INPUT');
    const withoutB: BaselinePlacementsOutcome = { status: 'READY', placements: { placements: (placementsOutcome.status === 'READY' ? placementsOutcome.placements.placements : []).filter((p) => p.intentId !== 'B') } };
    check('an authorized owner that holds NO baseline placement (B removed from the placements of the pairing) -> INCONSISTENT_INPUT: the authority never implies an owner can be moved that the baseline did not place', R(good, input, basisOutcome, withoutB) === 'INCONSISTENT_INPUT');
    check('EMPTY / DUPLICATE owners -> INCONSISTENT_INPUT', R(good, { candidateIntentId: 'P', owners: [] }) === 'INCONSISTENT_INPUT' && R(good, { candidateIntentId: 'P', owners: [input.owners[0], input.owners[0]] }) === 'INCONSISTENT_INPUT');
    check('basis or placements not READY -> RUN_NOT_READY (no partial authority)', R(good, input, { status: 'UNAVAILABLE', reason: 'ASSEMBLY_FAILED' }) === 'RUN_NOT_READY' && R(good, input, basisOutcome, { status: 'UNAVAILABLE', reason: 'CAPTURE_FAILED' }) === 'RUN_NOT_READY');
    check('a malformed attempted interval (invalid date, or start >= end) -> CAPTURE_FAILED, never a guessed or partial authority', R(traceOf([{ ...ev('P', 'O', '10:30', '11:30'), attemptedStart: 'not-a-date' }, ev('P', 'B', '10:00', '11:00')]), input) === 'CAPTURE_FAILED' && R(traceOf([ev('P', 'O', '11:30', '10:30'), ev('P', 'B', '10:00', '11:00')]), input) === 'CAPTURE_FAILED');
    check('a throwing source is caught: UNAVAILABLE / CAPTURE_FAILED (never an exception)', R({ get events(): never { throw new Error('boom'); } } as unknown as ContentionTrace, input) === 'CAPTURE_FAILED');
    check('the failure outcomes are frozen and carry only a reason', Object.isFrozen(projectContentionAuthority(traceOf([]), input, basisOutcome, placementsOutcome)));
  }

  console.log('=== ownership, detachment, freeze ===');
  {
    const trace = JSON.parse(JSON.stringify(diag.contentionTrace)) as ContentionTrace;
    const out = projectContentionAuthority(trace, input, basisOutcome, placementsOutcome);
    const a = ready(out);
    const sources = new Set<unknown>([...reachable(trace), ...reachable(input), ...reachable(basisOutcome), ...reachable(placementsOutcome)]);
    check(`DETACHED: none of the ${reachable(out).size} authority objects / Dates / arrays is reachable from the trace, the PromotionInput, the ConstructionBasis or the BaselinePlacements`, disjoint(reachable(out), sources));
    const snapshot = JSON.stringify(out);
    (trace.events as ContentionEvent[]).forEach((e) => { (e as { attemptedStart: string }).attemptedStart = 'x'; });
    for (const l of basis.finalCandidates) for (const c of l.candidates) { try { c.start.setTime(0); } catch { /* frozen */ } }
    check('SOURCE MUTATION (test only): changing the source trace strings and the basis Dates after projection leaves the authority byte-identical', JSON.stringify(out) === snapshot);
    check('every attempt Date is a newly created, valid Date of the exact attempted instants (10:30-11:30 and 10:00-11:00 UTC)', a.attempts.every((x) => x.start instanceof Date && x.end instanceof Date && Number.isFinite(x.start.getTime())) && a.attempts[0].start.toISOString() === `${FRIDAY}T10:30:00.000Z` && a.attempts[1].end.toISOString() === `${FRIDAY}T11:00:00.000Z`);
    check('DEEP FREEZE: the outcome, the authority, the attempts array, every attempt and every Date are frozen; writes throw -- and the freeze is NOT claimed to protect a Date\'s time value', [...reachable(out)].every((o) => Object.isFrozen(o)) && throwsTypeError(() => { (a.attempts as unknown as unknown[]).push({}); }) && throwsTypeError(() => { (a.attempts[0] as { ownerIntentId: string }).ownerIntentId = 'x'; }) && throwsTypeError(() => { (a as { candidateIntentId: string }).candidateIntentId = 'x'; }));
    check('INPUTS ARE NEVER MUTATED: the trace, the PromotionInput, the basis and the placements are byte-identical after repeated projection', (() => { const t = JSON.stringify(diag.contentionTrace); const i = JSON.stringify(input); const b = JSON.stringify(basisOutcome); const p = JSON.stringify(placementsOutcome); for (let k = 0; k < 5; k += 1) projectContentionAuthority(diag.contentionTrace, input, basisOutcome, placementsOutcome); return t === JSON.stringify(diag.contentionTrace) && i === JSON.stringify(input) && b === JSON.stringify(basisOutcome) && p === JSON.stringify(placementsOutcome); })());
    const realNow = Date.now; let nowCalls = 0; (Date as unknown as { now: () => number }).now = () => { nowCalls += 1; return realNow(); };
    try { projectContentionAuthority(diag.contentionTrace, input, basisOutcome, placementsOutcome); } finally { (Date as unknown as { now: () => number }).now = realNow; }
    check('NO CLOCK and DETERMINISM: projection reads Date.now zero times and is byte-identical across repeats', nowCalls === 0 && Array.from({ length: 10 }, () => JSON.stringify(projectContentionAuthority(diag.contentionTrace, input, basisOutcome, placementsOutcome))).every((j) => j === JSON.stringify(prepared.contention[0])));
  }

  console.log('=== no policy: owner pressure never changes the captured intervals ===');
  {
    const flipped = (p: 'NONE' | 'LAST_KNOWN_OPPORTUNITY'): PromotionInput => ({ candidateIntentId: input.candidateIntentId, owners: input.owners.map((o) => ({ intentId: o.intentId, pressure: p })) });
    const none = JSON.stringify(projectContentionAuthority(diag.contentionTrace, flipped('NONE'), basisOutcome, placementsOutcome));
    const last = JSON.stringify(projectContentionAuthority(diag.contentionTrace, flipped('LAST_KNOWN_OPPORTUNITY'), basisOutcome, placementsOutcome));
    check('SYNTHETIC: the same owner set with every owner NONE vs every owner LAST_KNOWN_OPPORTUNITY yields byte-identical authority', none === last && none === JSON.stringify(prepared.contention[0]));
    const onlyP = await preparePromotionInputs(request(INTENTS, ['P']), mkDeps(limited(POOLS, 1)).deps);
    const ownersNone = onlyP.promotion.status === 'PREPARED' ? onlyP.promotion.inputs[0].owners.map((o) => o.pressure).join() : '<unavailable>';
    check('REAL PIPELINE: with only P pressured the owners are NONE; with all three pressured the owners are LAST_KNOWN_OPPORTUNITY -- and the authority intervals are byte-identical', ownersNone === 'NONE,NONE' && prepared.promotion.status === 'PREPARED' && prepared.promotion.inputs[0].owners.every((o) => o.pressure === 'LAST_KNOWN_OPPORTUNITY') && JSON.stringify(onlyP.contention) === JSON.stringify(prepared.contention));
  }

  console.log('=== multiple promotion inputs: one separate authority each ===');
  {
    // O wins 11:00; P1 and P2 both lose to it (P1 attempted 11:00 only; P2 attempted 11:00 and 11:30 vs O). Neither can ever be placed.
    const intents = [req('O', 0), req('P1', 1), req('P2', 2)];
    const pools = { O: [timing('11:00', '12:00')], P1: [timing('11:00', '12:00')], P2: [timing('11:00', '12:00'), timing('11:30', '12:30')] };
    const r = await preparePromotionInputs(request(intents, ['O', 'P1', 'P2']), mkDeps(limited(pools, 3)).deps);
    const inputs = r.promotion.status === 'PREPARED' ? r.promotion.inputs : [];
    check('two PromotionInputs (P1, P2) produce two separate, input-aligned authorities, each ONLY its own loser\'s attempts against O (no joint authority, no cross-contamination)', inputs.map((i) => i.candidateIntentId).join() === 'P1,P2' && r.contention.length === 2 && ready(r.contention[0]).candidateIntentId === 'P1' && ready(r.contention[1]).candidateIntentId === 'P2' && attemptShape(r.contention[0]) === 'O@11:00-12:00' && attemptShape(r.contention[1]) === 'O@11:00-12:00 O@11:30-12:30');
  }

  console.log('=== same run, baseline untouched, normal path zero work, failure isolation ===');
  {
    const real = authorityModule.projectContentionAuthority; let calls = 0;
    (authorityModule as any).projectContentionAuthority = (...a: unknown[]) => { calls += 1; return (real as any)(...a); };
    try {
      const plain = mkDeps(limited(POOLS, 1)); const plainResult = await orchestrateConstructDay(request(INTENTS, ['O', 'B', 'P']), plain.deps);
      check('NORMAL PATH: `orchestrateConstructDay` (the preview entry point) performs ZERO authority projections', calls === 0);
      const diagOnly = await orchestrateConstructDayWithDiagnostics(request(INTENTS, ['O', 'B', 'P']), mkDeps(limited(POOLS, 1)).deps);
      check('DIAGNOSTICS ENTRY POINT alone performs ZERO authority projections (only the internal promotion boundary does, once per input)', calls === 0 && diagOnly.result.status === 'READY');
      const withBoundary = mkDeps(limited(POOLS, 1)); const b = await preparePromotionInputs(request(INTENTS, ['O', 'B', 'P']), withBoundary.deps);
      check('the promotion boundary projects exactly ONCE per PromotionInput (1) and runs NO second orchestration: identical loader / search call counts to the normal run', calls === 1 && JSON.stringify(withBoundary.calls) === JSON.stringify(plain.calls));
      check('BASELINE IDENTITY: the Constructor result of the boundary run is deep-identical to the normal orchestration', JSON.stringify(b.result) === JSON.stringify(plainResult));
    } finally { (authorityModule as any).projectContentionAuthority = real; }
    // Failure isolation: the projection throws -> the entry becomes UNAVAILABLE, the inputs and the Constructor result are untouched.
    (authorityModule as any).projectContentionAuthority = () => { throw new Error('boom'); };
    try {
      const failing = await preparePromotionInputs(request(INTENTS, ['O', 'B', 'P']), mkDeps(limited(POOLS, 1)).deps);
      const normal = await orchestrateConstructDay(request(INTENTS, ['O', 'B', 'P']), mkDeps(limited(POOLS, 1)).deps);
      check('FAILURE ISOLATION: a throwing projection makes ONLY that authority UNAVAILABLE / CAPTURE_FAILED -- the PromotionInput outcome is still PREPARED with the same input and the Constructor result is byte-identical to a normal run', failing.contention.length === 1 && reasonOf(failing.contention[0]) === 'CAPTURE_FAILED' && failing.promotion.status === 'PREPARED' && JSON.stringify(failing.promotion) === JSON.stringify(prepared.promotion) && JSON.stringify(failing.result) === JSON.stringify(normal));
    } finally { (authorityModule as any).projectContentionAuthority = real; }
    const notReady = await preparePromotionInputs({ ...request(INTENTS, ['O', 'B', 'P']), timezone: '' }, mkDeps(limited(POOLS, 1)).deps);
    check('a not-READY run yields no authorities (empty), exactly like no inputs', notReady.promotion.status === 'UNAVAILABLE' && notReady.contention.length === 0);
    const none = await preparePromotionInputs(request(INTENTS, []), mkDeps(limited(POOLS, 1)).deps);
    check('no PromotionInput (nobody pressured) -> no authority is projected', none.promotion.status === 'PREPARED' && none.promotion.inputs.length === 0 && none.contention.length === 0);
  }

  console.log('=== the Constructor is not touched or called ===');
  {
    const realTrace = constructorModule.constructDayWithTrace; const realPlain = constructorModule.constructDay; let n = 0;
    (constructorModule as any).constructDayWithTrace = (...a: unknown[]) => { n += 1; return (realTrace as any)(...a); };
    (constructorModule as any).constructDay = (...a: unknown[]) => { n += 1; return (realPlain as any)(...a); };
    try {
      const trace = diag.contentionTrace;
      for (let k = 0; k < 5; k += 1) projectContentionAuthority(trace, input, basisOutcome, placementsOutcome);
      check('the pure projection performs ZERO Constructor passes (no second construction, no timing search: it has no dependency to call)', n === 0);
    } finally { (constructorModule as any).constructDayWithTrace = realTrace; (constructorModule as any).constructDay = realPlain; }
  }

  console.log('=== PROPERTY SWEEP: completeness and soundness over every emitted PromotionInput ===');
  {
    let seed = 20261004; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const SLOTS: Array<[string, string]> = [['09:00', '10:00'], ['09:30', '10:30'], ['10:00', '11:00'], ['10:30', '11:30'], ['11:00', '12:00'], ['11:30', '12:30'], ['12:00', '13:00'], ['12:30', '13:30'], ['13:00', '14:00']];
    const SCENARIOS = 1200;
    const tally = { runs: 0, inputs: 0, authorities: 0, attempts: 0, missing: 0, invented: 0, notReady: 0, outsideOwnerScope: 0, ownerWithoutPlacement: 0, notOverlappingOwnerPlacement: 0, multiRoundInputs: 0, reconstructionWouldLose: 0, lostIntervals: 0 };
    for (let n = 0; n < SCENARIOS; n += 1) {
      const k = 3 + Math.floor(rnd() * 2);
      const ids = ['A', 'B', 'C', 'D'].slice(0, k);
      const limit = n % 5 === 4 ? 99 : 1 + Math.floor(rnd() * 3);
      const pools: Record<string, TimingCandidate[]> = {};
      ids.forEach((id) => { pools[id] = SLOTS.filter(() => rnd() < 0.5).map(([a, b]) => timing(a, b)); });
      const intents = ids.map((id, i) => req(id, i));
      const search = limited(pools, limit);
      const diagnostics = await orchestrateConstructDayWithDiagnostics(request(intents, ids), mkDeps(search).deps);
      const run = await preparePromotionInputs(request(intents, ids), mkDeps(search).deps);
      tally.runs += 1;
      if (diagnostics.result.status !== 'READY' || diagnostics.constructionBasis.status !== 'READY' || diagnostics.baselinePlacements.status !== 'READY' || run.promotion.status !== 'PREPARED') { tally.notReady += 1; continue; }
      const finalBasis = diagnostics.constructionBasis.basis;
      const placements = diagnostics.baselinePlacements.placements.placements;
      const maxRound = Math.max(-1, ...diagnostics.contentionTrace.events.map((e) => e.round));
      run.promotion.inputs.forEach((promotion, index) => {
        tally.inputs += 1;
        const outcome = run.contention[index];
        if (!outcome || outcome.status !== 'READY') { tally.notReady += 1; return; }
        tally.authorities += 1;
        const ownerIds = new Set(promotion.owners.map((o) => o.intentId));
        const key = (owner: string, s: Date | string, e: Date | string) => `${owner}|${new Date(s).toISOString()}|${new Date(e).toISOString()}`;
        // Ground truth: the real P3a events of this candidate against its authorized owners (distinct by owner + interval).
        const truth = new Set(diagnostics.contentionTrace.events.filter((e) => e.loserIntentId === promotion.candidateIntentId && ownerIds.has(e.winnerIntentId)).map((e) => key(e.winnerIntentId, e.attemptedStart, e.attemptedEnd)));
        const got = new Set(outcome.authority.attempts.map((a) => key(a.ownerIntentId, a.start, a.end)));
        tally.attempts += got.size;
        for (const t of truth) if (!got.has(t)) tally.missing += 1;
        for (const g of got) if (!truth.has(g)) tally.invented += 1;
        if (outcome.authority.attempts.some((a) => !ownerIds.has(a.ownerIntentId))) tally.outsideOwnerScope += 1;
        if (outcome.authority.attempts.some((a) => !placements.some((p) => p.intentId === a.ownerIntentId))) tally.ownerWithoutPlacement += 1;
        // Empirical scheduling invariant: each attempted interval really overlaps its owner's FINAL baseline placement.
        if (outcome.authority.attempts.some((a) => { const p = placements.find((x) => x.intentId === a.ownerIntentId)!; return !(a.start.getTime() < p.end.getTime() && p.start.getTime() < a.end.getTime()); })) tally.notOverlappingOwnerPlacement += 1;
        if (maxRound >= 1) tally.multiRoundInputs += 1;
        // What the REJECTED candidate-list reconstruction would have lost for this input.
        const lists = [finalBasis.initialCandidates, finalBasis.finalCandidates].flatMap((c) => c.filter((l) => l.intentId === promotion.candidateIntentId).flatMap((l) => l.candidates));
        const listed = new Set(lists.map((c) => `${c.start.toISOString()}|${new Date(c.start.getTime() + 3600000).toISOString()}`));
        const lost = outcome.authority.attempts.filter((a) => !listed.has(`${a.start.toISOString()}|${a.end.toISOString()}`));
        if (lost.length > 0) { tally.reconstructionWouldLose += 1; tally.lostIntervals += lost.length; }
      });
    }
    console.log(`     sweep: ${JSON.stringify(tally)}`);
    check(`COMPLETENESS (the principal P4b2a proof): over ${tally.inputs} real PromotionInputs from ${tally.runs} deterministic runs (${tally.attempts} distinct attempts), EVERY real P3a candidate->authorized-owner attempted interval is in the authority: ZERO missing`, tally.inputs >= 150 && tally.missing === 0 && tally.authorities === tally.inputs);
    check('SOUNDNESS: ZERO invented intervals -- every authority interval is a real P3a event of that candidate against an authorized owner', tally.invented === 0 && tally.outsideOwnerScope === 0);
    check('BASELINE CONSISTENCY: every authority owner holds a final baseline placement and every attempted interval overlaps that owner\'s final placement (the scheduling invariant the counterfactual relies on): zero violations', tally.ownerWithoutPlacement === 0 && tally.notOverlappingOwnerPlacement === 0);
    check(`the sweep is MEANINGFUL: ${tally.multiRoundInputs} inputs come from multi-round replenishment, and for ${tally.reconstructionWouldLose} inputs (${tally.lostIntervals} intervals) the REJECTED initial-UNION-final candidate reconstruction would have lost a real attempt that the authority preserves`, tally.multiRoundInputs > 0 && tally.reconstructionWouldLose > 0 && tally.lostIntervals > 0);
  }

  if (!allPassed) { console.error('SOME PROMOTION CONTENTION AUTHORITY CHECKS FAILED'); process.exitCode = 1; return; }
  console.log('ALL PROMOTION CONTENTION AUTHORITY CHECKS PASSED');
})().then(() => process.exit(), (err) => { console.error(err); process.exit(1); });
