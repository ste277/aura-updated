/**
 * Constructor Decision Intelligence -- O5 P4b1b: the IMMUTABLE BASELINE PLACEMENTS (pure behavior, no DB).
 *
 * Part 1 drives the REAL orchestrator (real preparer, projection, evidence stage, pressure, replenishment and Constructor; only data
 * loaders and the timing search are injected): the baseline Proposed placements are captured from the same run's terminal `result.day`
 * -- exact intervals, placement source, timing fit and candidate order, in the result's own order, Deferred intents excluded, an empty
 * day valid -- validated against the SAME run's ConstructionBasis (FIXED against the fixed constraint, flexible against the TERMINAL
 * candidate list, which a replenishment fixture proves is not the initial one), detached from the result and the basis, deeply frozen,
 * and leaving the baseline result, signed tokens and every call count untouched. Part 2 drives the pure capture with synthetic
 * (deliberately invalid) days over a real basis: every validation failure becomes UNAVAILABLE and nothing is repaired or chosen.
 *
 * Date caveat, stated honestly: `Object.freeze` does not stop a Date setter changing a Date's internal time. Safety is OWNERSHIP (every
 * captured Date is a new Date) plus the #208 no-Date-mutator guard. Product / architecture invariants only: no timing, randomness,
 * heap layout or query plan.
 */
import * as placementsModule from '../apps/web/lib/baselinePlacements';
import { captureBaselinePlacements, type BaselinePlacementsOutcome } from '../apps/web/lib/baselinePlacements';
import type { ConstructionBasis, ConstructionBasisOutcome } from '../apps/web/lib/constructionBasis';
import * as constructorModule from '../apps/web/lib/dayConstructor';
import type { ConstructDayInput } from '../apps/web/lib/dayConstructor';
import { orchestrateConstructDay, orchestrateConstructDayWithDiagnostics, type ConstructDayRequest, type DayConstructorOrchestratorDeps, type RequestedDayIntent } from '../apps/web/lib/dayConstructorOrchestrator';
import { signPreviewResultBody } from '../apps/web/lib/dayConstructorPreviewIntegrity';
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
const basisOf = (o: ConstructionBasisOutcome): ConstructionBasis => { if (o.status !== 'READY') throw new Error(`basis ${o.reason}`); return o.basis; };
const READY = (o: BaselinePlacementsOutcome) => { if (o.status !== 'READY') throw new Error(`placements ${o.reason}`); return o.placements.placements; };

type Weekday = AvailabilityConfiguration['periods'][number]['weekday'];
const FRIDAY = '2026-10-09';
const workWeek: AvailabilityConfiguration = { configured: true, periods: ([1, 2, 3, 4, 5] as Weekday[]).map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })) };
const rangeDeps: OpportunityRangeDeps = { loadAvailabilityConfiguration: async () => workWeek, loadPlansOverlappingRange: async () => [] };
const at = (h: string) => new Date(`${FRIDAY}T${h}:00Z`);
const timing = (s: string, e: string, label: TimingCandidate['label'] = 'GOOD'): TimingCandidate => ({ start: `${FRIDAY}T${s}:00Z`, end: `${FRIDAY}T${e}:00Z`, score: 5, label, muhurtaScore: 0, reasons: [], metadata: { windowType: 'NEUTRAL', windowLabel: 'x', activityType: 'x', dateLabel: FRIDAY } });
const overlapsC = (c: TimingCandidate, e: { start: Date; end: Date }) => new Date(c.start).getTime() < e.end.getTime() && e.start.getTime() < new Date(c.end).getTime();
const req = (id: string, over: Partial<RequestedDayIntent> = {}): RequestedDayIntent => ({ id, title: id, flexibility: 'FLEXIBLE', durationMinutes: 60, originalOrder: 0, ...over } as RequestedDayIntent);
const request = (intents: RequestedDayIntent[], over: Partial<ConstructDayRequest> = {}): ConstructDayRequest => ({ targetDate: FRIDAY, timezone: 'UTC', constructionWindowSource: 'EXPLICIT_RANGE', now: at('09:00'), explicitStart: at('09:00'), explicitEnd: at('17:00'), intents, ...over });
interface Counts { searches: number; blockers: number; duration: number; availability: number }
const newCounts = (): Counts => ({ searches: 0, blockers: 0, duration: 0, availability: 0 });
type Plan = { start: Date; end: Date; status: 'UPCOMING' };
function mkDeps(plans: Plan[], search: (r: any) => TimingCandidate[], counts: Counts): DayConstructorOrchestratorDeps {
  return {
    loadBlockingPlans: async () => { counts.blockers += 1; return plans; },
    loadDurationContext: async () => { counts.duration += 1; return { preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} }; },
    searchTiming: (r: any) => { counts.searches += 1; return { candidates: search(r) }; },
    loadAvailabilityConfiguration: async () => { counts.availability += 1; return { configured: false, periods: [] }; },
    prepareDecisionFacts: createDecisionFactPreparer(rangeDeps),
  };
}
const honest = (pools: Record<string, TimingCandidate[]>) => (r: any) => ((pools[r.taskTitle ?? r.activityId] ?? []).filter((c) => !(r.excludedIntervals ?? []).some((e: { start: Date; end: Date }) => overlapsC(c, e))));
const scripted = (script: TimingCandidate[][]) => { let n = 0; return () => script[n++] ?? []; };
async function run(intents: RequestedDayIntent[], plans: Plan[], search: (r: any) => TimingCandidate[], over: Partial<ConstructDayRequest> = {}) {
  const counts = newCounts(); const inputs: ConstructDayInput[] = []; let constructions = 0;
  const realTrace = constructorModule.constructDayWithTrace;
  (constructorModule as any).constructDayWithTrace = (input: ConstructDayInput, round?: number) => { constructions += 1; inputs.push(input); return realTrace(input, round); };
  try { const diag = await orchestrateConstructDayWithDiagnostics(request(intents, over), mkDeps(plans, search, counts)); return { diag, counts, inputs, constructions }; } finally { (constructorModule as any).constructDayWithTrace = realTrace; }
}
async function runPlain(intents: RequestedDayIntent[], plans: Plan[], search: (r: any) => TimingCandidate[], over: Partial<ConstructDayRequest> = {}) {
  const counts = newCounts(); let constructions = 0;
  const realConstruct = constructorModule.constructDay;
  (constructorModule as any).constructDay = (input: ConstructDayInput) => { constructions += 1; return realConstruct(input); };
  try { const result = await orchestrateConstructDay(request(intents, over), mkDeps(plans, search, counts)); return { result, counts, constructions }; } finally { (constructorModule as any).constructDay = realConstruct; }
}
const S1 = timing('11:00', '12:00'); const S2 = timing('13:00', '14:00'); const S3 = timing('15:00', '16:00'); const S4 = timing('12:00', '13:00');
const day = (r: any) => r.preview.constructedDay;
const hhmm = (d: Date) => d.toISOString().slice(11, 16);
const shape = (ps: readonly { intentId: string; start: Date; end: Date; placementSource: string; timingFit?: string; candidateOrder?: number }[]) => ps.map((p) => `${p.intentId}@${hhmm(p.start)}-${hhmm(p.end)}:${p.placementSource}:${p.timingFit ?? '-'}:${p.candidateOrder ?? '-'}`).join(' ');

(async () => {
  console.log('=== REAL orchestrator: a mixed day (flexible + FIXED + deferred + blocker) ===');
  {
    const plans: Plan[] = [{ start: at('15:00'), end: at('16:00'), status: 'UPCOMING' }];
    const fixedStart = at('13:00');
    const intents = [req('A', { originalOrder: 0, importance: 'HIGH' }), req('X', { flexibility: 'FIXED', fixedStart, originalOrder: 1 } as Partial<RequestedDayIntent>), req('N', { originalOrder: 2 }), req('L', { originalOrder: 3 })];
    const search = honest({ A: [timing('11:00', '12:00', 'EXCELLENT'), S3], N: [], L: [S1] });
    const r = await run(intents, plans, search);
    const placements = READY(r.diag.baselinePlacements);
    const proposed = day(r.diag.result).proposedItems as Array<{ intentId: string; start: Date; end: Date; placementSource: string; timingFit?: string; candidateOrder?: number }>;
    check('FLEXIBLE capture: A\'s placement is the exact selected candidate -- interval 11:00-12:00, SELECTED_CANDIDATE, the real timingFit (BEST, from the EXCELLENT label) and candidateOrder -- and FIXED capture: X\'s is exactly its constraint 13:00-14:00 as FIXED_CONSTRAINT with neither timingFit nor candidateOrder', placements.some((p) => p.intentId === 'A' && hhmm(p.start) === '11:00' && hhmm(p.end) === '12:00' && p.placementSource === 'SELECTED_CANDIDATE' && p.timingFit === 'BEST' && p.candidateOrder === 0) && placements.some((p) => p.intentId === 'X' && hhmm(p.start) === '13:00' && hhmm(p.end) === '14:00' && p.placementSource === 'FIXED_CONSTRAINT' && !('timingFit' in p) && !('candidateOrder' in p)));
    check('EVERY AND ONLY the final Proposed items, in the result\'s own order and with the result\'s own values; the Deferred intents (N: nothing searched usable, L: lost its only slot) do not appear', shape(placements) === shape(proposed) && placements.length === proposed.length && day(r.diag.result).deferredItems.map((d: any) => d.intentId).sort().join() === 'L,N' && !placements.some((p) => p.intentId === 'N' || p.intentId === 'L'));
    check('same-run pairing: the diagnostics outcome carries a READY ConstructionBasis AND READY placements for the same run; the placements validated against that basis (their ids are basis intents, the FIXED one equals the basis fixed constraint)', r.diag.constructionBasis.status === 'READY' && r.diag.baselinePlacements.status === 'READY' && placements.every((p) => basisOf(r.diag.constructionBasis).intents.some((i) => i.id === p.intentId)));
    check('SEPARATE CONTRACTS: the placements carry no title, activity, importance, deadline, flexibility or originalOrder (the basis owns those), no pressure / promotion / facts / source field, and the basis carries no placement', placements.every((p) => Object.keys(p).every((k) => ['intentId', 'start', 'end', 'placementSource', 'timingFit', 'candidateOrder'].includes(k))) && !JSON.stringify(basisOf(r.diag.constructionBasis)).includes('placementSource') && !/pressure|promotion|owner|facts|goal|manual|automatic|title|importance/i.test(JSON.stringify(placements)));
    const working = new Set<unknown>([...r.inputs.flatMap((i) => [...reachable(i)]), ...reachable(r.diag.result), ...reachable(plans), fixedStart]);
    check(`DETACHED: none of the ${reachable(r.diag.baselinePlacements).size} captured objects / Dates is reachable from the Constructor result (whose Proposed Dates alias the live candidate Dates), the recorded Constructor inputs, the loader plans, the request or the ConstructionBasis`, disjoint(reachable(r.diag.baselinePlacements), working) && disjoint(reachable(r.diag.baselinePlacements), reachable(r.diag.constructionBasis)) && placements.every((p) => { const o = proposed.find((x) => x.intentId === p.intentId)!; return p.start !== o.start && p.end !== o.end && p.start.getTime() === o.start.getTime() && p.end.getTime() === o.end.getTime(); }));
    const snapshot = JSON.stringify(r.diag.baselinePlacements);
    proposed.forEach((p) => { p.start.setTime(0); p.end.setTime(0); }); r.inputs[r.inputs.length - 1].window.start.setTime(0); fixedStart.setTime(0); plans[0].start.setTime(0);
    check('SOURCE MUTATION (test only): setTime on the SOURCE result / window / FIXED / plan Dates after capture leaves the placements byte-identical', JSON.stringify(r.diag.baselinePlacements) === snapshot);
    check('DEEP FREEZE: the outcome, the placements array, every placement and every (owned) Date is frozen; writes throw -- and the freeze is NOT claimed to protect a Date\'s time value', [...reachable(r.diag.baselinePlacements)].every((o) => Object.isFrozen(o)) && throwsTypeError(() => { (placements as unknown as unknown[]).push({}); }) && throwsTypeError(() => { (placements[0] as { intentId: string }).intentId = 'x'; }));
  }

  console.log('=== REAL orchestrator: order, touching boundaries, empty day ===');
  {
    // B (HIGH) is placed LATER (13:00) than A (LOW, 11:00): result order is precedence order [B, A], which is neither id order nor start order.
    const r = await run([req('A', { importance: 'LOW', originalOrder: 0 }), req('B', { importance: 'HIGH', originalOrder: 1 })], [], honest({ A: [S1], B: [S2] }));
    check('BASELINE ORDER is the result\'s own (precedence) order, not sorted by id or by start: B@13:00 comes before A@11:00', READY(r.diag.baselinePlacements).map((p) => p.intentId).join() === 'B,A' && day(r.diag.result).proposedItems.map((p: any) => p.intentId).join() === 'B,A');
    const touching = await run([req('A', { originalOrder: 0 }), req('C', { originalOrder: 1 })], [], honest({ A: [S1], C: [S4] }));
    check('TOUCHING: two placements that merely touch (11:00-12:00 and 12:00-13:00) are both valid -- half-open semantics, exactly as the Constructor places them', touching.diag.baselinePlacements.status === 'READY' && READY(touching.diag.baselinePlacements).length === 2);
    const touchBlocker = await run([req('T', { originalOrder: 0 })], [{ start: at('15:00'), end: at('16:00'), status: 'UPCOMING' }], honest({ T: [timing('14:00', '15:00')] }));
    check('TOUCHING A BLOCKER: a placement ending exactly where an external blocker begins (14:00-15:00 against a 15:00-16:00 plan) is valid -- it is not a blocker conflict', shape(READY(touchBlocker.diag.baselinePlacements)) === 'T@14:00-15:00:SELECTED_CANDIDATE:GOOD:0');
    const empty = await run([req('N', { originalOrder: 0 })], [], honest({ N: [] }));
    check('EMPTY DAY: a baseline with no Proposed item is a valid READY outcome with `placements: []` (not UNAVAILABLE)', empty.diag.baselinePlacements.status === 'READY' && READY(empty.diag.baselinePlacements).length === 0 && day(empty.diag.result).proposedItems.length === 0);
    const fixedOnly = await run([req('F1', { flexibility: 'FIXED', fixedStart: at('11:00'), originalOrder: 0 } as Partial<RequestedDayIntent>)], [], honest({}));
    check('FIXED-ONLY DAY: exactly the FIXED placement, validated against the basis constraint with no candidate list involved', shape(READY(fixedOnly.diag.baselinePlacements)) === 'F1@11:00-12:00:FIXED_CONSTRAINT:-:-');
  }

  console.log('=== REAL orchestrator: the replenishment fixture -- validation is against FINAL candidate authority ===');
  {
    // A owns 11:00. B's initial list [11:00] conflicts, so B is replenished and the (scripted) real search returns 15:00, which is NOT in B's initial list.
    const intents = [req('A', { originalOrder: 0 }), req('B', { originalOrder: 1 })];
    const r = await run(intents, [], scripted([[S1], [S1], [S3]]));
    const placements = READY(r.diag.baselinePlacements);
    const basis = basisOf(r.diag.constructionBasis);
    const b = placements.find((p) => p.intentId === 'B')!;
    check('REPLENISHED (real): B was placed at 15:00 from a REPLENISHED list; that candidate is in B\'s FINAL list and NOT in its INITIAL list ([11:00]) -- yet the placement validates, because the baseline decision came from terminal state', !!b && hhmm(b.start) === '15:00' && basis.initialCandidates.find((l) => l.intentId === 'B')!.candidates.map((c) => hhmm(c.start)).join() === '11:00' && basis.finalCandidates.find((l) => l.intentId === 'B')!.candidates.map((c) => hhmm(c.start)).join() === '15:00' && r.diag.baselinePlacements.status === 'READY' && shape(placements) === shape(day(r.diag.result).proposedItems));
  }

  console.log('=== the capture never touches the baseline ===');
  {
    const plans: Plan[] = [{ start: at('15:00'), end: at('16:00'), status: 'UPCOMING' }];
    const intents = [req('A', { originalOrder: 0 }), req('X', { flexibility: 'FIXED', fixedStart: at('13:00'), originalOrder: 1 } as Partial<RequestedDayIntent>), req('B', { originalOrder: 2 })];
    const pools = honest({ A: [S1], B: [S1, S2] });
    const r = await run(intents, plans, pools); const plain = await runPlain(intents, [{ ...plans[0] }], pools);
    check('BASELINE IDENTITY and TOKEN IDENTITY: the result with the placements is deep-identical to the plain orchestration and the signed preview body (every acceptance token) is byte-identical', JSON.stringify(r.diag.result) === JSON.stringify(plain.result) && JSON.stringify(signPreviewResultBody('u', r.diag.result as unknown as Record<string, unknown>)) === JSON.stringify(signPreviewResultBody('u', plain.result as unknown as Record<string, unknown>)) && JSON.stringify(signPreviewResultBody('u', plain.result as unknown as Record<string, unknown>)).includes('acceptanceToken'));
    check('CALL COUNTS: Constructor passes, timing searches and blocker / duration / availability loader calls are IDENTICAL with and without the capture (' + r.constructions + ' passes, ' + r.counts.searches + ' searches)', r.constructions === plain.constructions && r.counts.searches === plain.counts.searches && r.counts.blockers === plain.counts.blockers && r.counts.duration === plain.counts.duration && r.counts.availability === plain.counts.availability);
    check('NOT PUBLIC: no result key mentions placements; they are only on the internal diagnostics outcome', !JSON.stringify(r.diag.result).toLowerCase().includes('baselineplacement') && Object.keys(r.diag).sort().join() === 'baselinePlacements,constructionBasis,contentionTrace,evidenceByIntentId,planningDate,result');
    const realCapture = placementsModule.captureBaselinePlacements; let captures = 0;
    (placementsModule as any).captureBaselinePlacements = (...a: unknown[]) => { captures += 1; return (realCapture as any)(...a); };
    try {
      await orchestrateConstructDay(request(intents), mkDeps([{ ...plans[0] }], pools, newCounts()));
      check('NORMAL PATH: `orchestrateConstructDay` (the preview entry point) performs ZERO placement capture', captures === 0);
      await orchestrateConstructDayWithDiagnostics(request(intents), mkDeps([{ ...plans[0] }], pools, newCounts()));
      check('DIAGNOSTICS PATH: exactly ONE capture, through the same orchestration', captures === 1);
      (placementsModule as any).captureBaselinePlacements = () => { throw new Error('capture boom'); };
      const failing = await orchestrateConstructDayWithDiagnostics(request(intents), mkDeps([{ ...plans[0] }], pools, newCounts()));
      check('FAILURE ISOLATION (the capture throws): the baseline result is deep-identical to the plain run, the signed body unchanged, the basis still READY, and the placements UNAVAILABLE / CAPTURE_FAILED -- no partial authority', JSON.stringify(failing.result) === JSON.stringify(plain.result) && failing.constructionBasis.status === 'READY' && JSON.stringify(failing.baselinePlacements) === JSON.stringify({ status: 'UNAVAILABLE', reason: 'CAPTURE_FAILED' }));
    } finally { (placementsModule as any).captureBaselinePlacements = realCapture; }
    const dupReq = [req('A', { originalOrder: 0 }), req('A', { originalOrder: 1 }), req('B', { originalOrder: 2 })];
    const dup = await orchestrateConstructDayWithDiagnostics(request(dupReq), mkDeps([], honest({ A: [S1], B: [S2] }), newCounts()));
    check('BASIS UNAVAILABLE (duplicate request ids): the placements are NOT independently READY -- UNAVAILABLE / BASIS_UNAVAILABLE -- so READY placements can never be paired with an unavailable basis; the baseline result is exactly the plain one', dup.constructionBasis.status === 'UNAVAILABLE' && JSON.stringify(dup.baselinePlacements) === JSON.stringify({ status: 'UNAVAILABLE', reason: 'BASIS_UNAVAILABLE' }) && JSON.stringify(dup.result) === JSON.stringify(await orchestrateConstructDay(request(dupReq), mkDeps([], honest({ A: [S1], B: [S2] }), newCounts()))));
    const notReady = await orchestrateConstructDayWithDiagnostics(request(intents, { timezone: '' }), mkDeps([], honest({}), newCounts()));
    check('a run that is not READY has no placements: UNAVAILABLE / RUN_NOT_READY; a timing-search failure likewise leaves READY nowhere', notReady.result.status === 'TIMEZONE_MISSING' && JSON.stringify(notReady.baselinePlacements) === JSON.stringify({ status: 'UNAVAILABLE', reason: 'RUN_NOT_READY' }) && (await orchestrateConstructDayWithDiagnostics(request(intents), { ...mkDeps([], honest({}), newCounts()), searchTiming: () => { throw new Error('search down'); } })).baselinePlacements.status === 'UNAVAILABLE');
    check('READY placements imply a READY basis in every diagnostics outcome observed (no READY placements are ever paired with an unavailable or mismatched basis)', [r.diag, dup, notReady].every((d) => d.baselinePlacements.status !== 'READY' || d.constructionBasis.status === 'READY'));
    const shapes: Array<[string, string]> = [['ow-1', 'lo-2'], ['goal-demand:2026-10-09:ga-1', 'goal-demand:2026-10-09:ga-2'], ['plan-day-goal-ga-1', 'plan-day-goal-ga-2'], ['typed-1', 'typed-2']];
    const shaped: string[] = [];
    for (const [a, b2] of shapes) { const s = await run([req(a, { originalOrder: 0 }), req(b2, { originalOrder: 1 })], [], honest({ [a]: [S1], [b2]: [S2] })); shaped.push(JSON.stringify(s.diag.baselinePlacements).split(a).join('OWNER').split(b2).join('LOSER')); }
    check('SOURCE NEUTRALITY: ids shaped like automatic Goal demand, a manual hand-off and a generic typed intent yield structurally identical placements', shaped.every((x) => x === shaped[0]) && shaped[0].includes('LOSER'));
  }

  console.log('=== the pure capture: every validation failure is UNAVAILABLE -- nothing is repaired or chosen ===');
  {
    const plans: Plan[] = [{ start: at('15:00'), end: at('16:00'), status: 'UPCOMING' }];
    const base = await run([req('A', { originalOrder: 0 }), req('X', { flexibility: 'FIXED', fixedStart: at('13:00'), originalOrder: 1 } as Partial<RequestedDayIntent>), req('B', { originalOrder: 2 })], plans, honest({ A: [S1], B: [S4] }));
    const basisOutcome = base.diag.constructionBasis as ConstructionBasisOutcome;
    const good = () => (day(base.diag.result).proposedItems as any[]).map((p) => ({ ...p, start: new Date(p.start.getTime()), end: new Date(p.end.getTime()) }));
    const withItems = (items: any[]) => captureBaselinePlacements({ proposedItems: items } as any, basisOutcome);
    const reasonOf = (o: BaselinePlacementsOutcome) => (o.status === 'READY' ? 'READY' : o.reason);
    const item = (over: Record<string, unknown>) => ({ intentId: 'A', title: 'A', start: at('11:00'), end: at('12:00'), placementSource: 'SELECTED_CANDIDATE', timingFit: 'GOOD', candidateOrder: 0, requiresConfirmation: true, ...over });
    check('the unmodified real day validates READY (control for the synthetic failures below)', reasonOf(withItems(good())) === 'READY');
    // A LAX real run: the (scripted, deliberately unfiltered) timing search offers candidates the Constructor itself rejects -- one inside the plan blocker, one before
    // the window, one overlapping A. They land in the basis's FINAL candidate lists, so a synthetic day that places them matches the candidate authority and can fail ONLY on
    // the validation each case targets (otherwise these controls would pass vacuously on the candidate check).
    const lax = await run([req('A', { originalOrder: 0 }), req('B', { originalOrder: 1 }), req('T', { originalOrder: 2 }), req('W', { originalOrder: 3 })], plans, (r: any) => ({ A: [S1], B: [timing('11:30', '12:30')], T: [S3], W: [timing('08:00', '09:00')] } as Record<string, TimingCandidate[]>)[r.taskTitle] ?? []);
    const laxBasis = lax.diag.constructionBasis as ConstructionBasisOutcome;
    const laxItem = (id: string, s: string, e: string) => item({ intentId: id, start: at(s), end: at(e), timingFit: 'GOOD', candidateOrder: 0 });
    const laxWith = (items: any[]) => captureBaselinePlacements({ proposedItems: items } as any, laxBasis);
    check('CONTROL for the three targeted validations: the lax run is READY and its real baseline (A alone) validates; each synthetic placement below is a captured final candidate, so it can fail only its own targeted check', laxBasis.status === 'READY' && reasonOf(laxWith([laxItem('A', '11:00', '12:00')])) === 'READY' && ['B', 'T', 'W'].every((id) => (laxBasis as any).basis.finalCandidates.some((l: any) => l.intentId === id && l.candidates.length === 1)));
    check('OVERLAP: A (11:00-12:00) and B (11:30-12:30), both captured candidates, overlap -> UNAVAILABLE / INVALID_PLACEMENT (synthetic -- the real Constructor never produces this)', reasonOf(laxWith([laxItem('A', '11:00', '12:00'), laxItem('B', '11:30', '12:30')])) === 'INVALID_PLACEMENT');
    check('BLOCKER CONFLICT: T placed at its captured 15:00-16:00 candidate sits inside the 15:00-16:00 plan blocker -> UNAVAILABLE / INVALID_PLACEMENT (it would otherwise validate)', reasonOf(laxWith([laxItem('T', '15:00', '16:00')])) === 'INVALID_PLACEMENT');
    check('OUTSIDE THE WINDOW: W placed at its captured 08:00-09:00 candidate lies before the 09:00 window start -> UNAVAILABLE / INVALID_PLACEMENT (it would otherwise validate)', reasonOf(laxWith([laxItem('W', '08:00', '09:00')])) === 'INVALID_PLACEMENT');
    check('UNKNOWN INTENT: a placement id that is not a basis intent is UNAVAILABLE', reasonOf(withItems([item({ intentId: 'ghost' })])) === 'INVALID_PLACEMENT');
    check('DUPLICATE PLACEMENT ID: the same intent placed twice is UNAVAILABLE / DUPLICATE_INTENT_ID -- never last-write-wins', reasonOf(withItems([item({}), item({ start: at('12:00'), end: at('13:00') })])) === 'DUPLICATE_INTENT_ID');
    const x = good().find((p) => p.intentId === 'X');
    check('FIXED MISMATCH: a FIXED placement shifted by one minute, or an intent that is not FIXED claiming FIXED_CONSTRAINT, or a FIXED intent claiming SELECTED_CANDIDATE, is UNAVAILABLE', reasonOf(withItems([{ ...x, start: new Date(x.start.getTime() + 60000), end: new Date(x.end.getTime() + 60000) }])) === 'INVALID_PLACEMENT' && reasonOf(withItems([item({ placementSource: 'FIXED_CONSTRAINT', timingFit: undefined, candidateOrder: undefined })])) === 'INVALID_PLACEMENT' && reasonOf(withItems([{ ...x, placementSource: 'SELECTED_CANDIDATE', candidateOrder: 0 }])) === 'INVALID_PLACEMENT');
    check('FLEXIBLE CANDIDATE MISMATCH: a placement whose start is not a captured final candidate, whose timingFit or candidateOrder differs, or whose length is not the intent\'s duration, is UNAVAILABLE -- nothing is matched fuzzily or repaired', ['start', 'timingFit', 'candidateOrder', 'duration'].every((k) => reasonOf(withItems([k === 'start' ? item({ start: at('11:01'), end: at('12:01') }) : k === 'timingFit' ? item({ timingFit: 'WORKABLE' }) : k === 'candidateOrder' ? item({ candidateOrder: 3 }) : item({ end: at('12:30') })])) === 'INVALID_PLACEMENT') && reasonOf(withItems([item({ candidateOrder: undefined })])) === 'INVALID_PLACEMENT');
    check('INVALID DATE: a placement with an Invalid Date, or start >= end, is UNAVAILABLE; a non-Date is CAPTURE_FAILED (never thrown out)', reasonOf(withItems([item({ start: new Date(Number.NaN) })])) === 'INVALID_PLACEMENT' && reasonOf(withItems([item({ start: at('12:00'), end: at('11:00') })])) === 'INVALID_PLACEMENT' && reasonOf(withItems([item({ start: '2026-10-09T11:00:00Z' })])) === 'CAPTURE_FAILED');
    check('a placement that is not in the basis\'s FINAL candidate list but is in no list at all, or whose intent has no candidate entry, is UNAVAILABLE (absent authority is not repaired)', reasonOf(withItems([item({ intentId: 'X', placementSource: 'SELECTED_CANDIDATE' })])) === 'INVALID_PLACEMENT');
    const sourceDay = { proposedItems: good() };
    const before = JSON.stringify(sourceDay);
    captureBaselinePlacements(sourceDay as any, basisOutcome);
    check('INPUT IMMUTABILITY: capturing does not mutate the result day it reads', JSON.stringify(sourceDay) === before);
    check('a basis that is not READY makes any day UNAVAILABLE / BASIS_UNAVAILABLE', reasonOf(captureBaselinePlacements(sourceDay as any, { status: 'UNAVAILABLE', reason: 'ASSEMBLY_FAILED' })) === 'BASIS_UNAVAILABLE');
    const realNow = Date.now; let nowCalls = 0; (Date as unknown as { now: () => number }).now = () => { nowCalls += 1; return realNow(); };
    try { captureBaselinePlacements(sourceDay as any, basisOutcome); } finally { (Date as unknown as { now: () => number }).now = realNow; }
    check('NO CLOCK: capturing calls Date.now zero times', nowCalls === 0);
    const again = JSON.stringify(captureBaselinePlacements(sourceDay as any, basisOutcome));
    check('DETERMINISM: repeated capture of the same day over the same basis is byte-identical', Array.from({ length: 10 }, () => JSON.stringify(captureBaselinePlacements(sourceDay as any, basisOutcome))).every((j) => j === again));
  }

  if (!allPassed) { console.error('SOME BASELINE PLACEMENTS CHECKS FAILED'); process.exitCode = 1; return; }
  console.log('ALL BASELINE PLACEMENTS CHECKS PASSED');
})().then(() => process.exit(), (err) => { console.error(err); process.exit(1); });
