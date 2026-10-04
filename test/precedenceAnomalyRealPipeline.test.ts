/**
 * Constructor Decision Intelligence -- O5 PRE-P4b: the REAL-PIPELINE PRECEDENCE_ANOMALY regression (pure, no DB).
 *
 * WHAT THIS PINS. A stronger FLEXIBLE candidate can legitimately lose a concrete interval to a WEAKER FIXED candidate, and
 * the downstream pressure stages must then refuse to treat that relationship as promotion authority:
 *
 *   FIXED reservation (the Constructor places every FIXED intent before any FLEXIBLE one)
 *     -> the weaker FIXED owner X holds its declared interval
 *     -> the stronger FLEXIBLE pressured candidate F attempts that otherwise-usable interval and loses
 *     -> the real P3a trace records the contention
 *     -> the final result: X Proposed, F Deferred
 *     -> the reviewed above-pressure primitive says F is STRONGER than X
 *     -> the P3b shadow evaluator classifies F as PRECEDENCE_ANOMALY
 *     -> the P4a / P4a2 assembler emits NO PromotionInput for F.
 *
 * WHY IT IS CALLED AN "ANOMALY" -- AND WHY IT IS NOT A CONSTRUCTOR BUG. "Anomaly" means only that the historical contention
 * owner is WEAKER than the loser according to overload precedence (deadline today, importance, deadline). Another scheduling
 * invariant -- the FIXED reservation rule: a FIXED commitment is a user-declared time that must not be taken by anything
 * flexible, whatever its importance -- legitimately caused the stronger FLEXIBLE candidate to lose. The Constructor behaves as
 * designed and nothing here "fixes" it. The regression requirement is the OTHER side: a policy that may one day let pressure
 * override `originalOrder` must never read this relationship as authority, because the loser is already stronger than the owner
 * on a dimension that outranks pressure and was beaten only by a reservation, not by precedence.
 *
 * CARRIED FORWARD FOR THE P4b POLICY REVIEW (not solved here): `DecisionPressure.NONE` means "no established pressure" -- it is not
 * positive evidence that an intent is safely unpressured, because absent or failed evidence also derives NONE. The FIXED owner X
 * below carries NONE for a structural reason (FIXED never carries pressure), but an owner with NONE may elsewhere include
 * unavailable evidence. P4b0 proposes rejecting owners whose categorical pressure is LAST_KNOWN_OPPORTUNITY; that caveat is to be
 * revisited at P4b3 / P4b4 before any ACTIVE policy. No taxonomy change is made in this slice.
 *
 * NOTHING IS SYNTHESISED. Every value below comes out of the real orchestrator, real preparer, real projection, real evidence
 * stage, real pressure deriver and real P3a trace; only the data loaders and the timing search are injected (the same seam the
 * P3b / P4a suites use). Pressure is DERIVED from real evidence for the pressured candidate -- nothing is injected through a
 * production-callable boundary. Product / architecture invariants only: no timing, randomness, heap layout or query plan.
 */
import { compareAbovePressure, projectAbovePressureFacts } from '../apps/web/lib/abovePressurePrecedence';
import { orchestrateConstructDay, orchestrateConstructDayWithDiagnostics, type ConstructDayRequest, type DayConstructorOrchestratorDeps, type RequestedDayIntent } from '../apps/web/lib/dayConstructorOrchestrator';
import { createDecisionFactPreparer } from '../apps/web/lib/decisionFactPreparation';
import { deriveDecisionPressure } from '../apps/web/lib/decisionPressure';
import { observeShadowPressure } from '../apps/web/lib/shadowPressureObservation';
import { preparePromotionInputs } from '../apps/web/lib/promotionInputPreparation';
import type { DecisionFacts } from '../apps/web/lib/decisionFacts';
import type { OpportunityRangeDeps } from '../apps/web/lib/opportunityRangeAdapter';
import type { AvailabilityConfiguration } from '../apps/web/lib/availabilityContext';
import type { TimingCandidate } from '../packages/recommendation/src/timingSearch';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

type Weekday = AvailabilityConfiguration['periods'][number]['weekday'];
const FRIDAY = '2026-10-09'; // the last weekday of its week: scarce for a recurrence candidate with a resolved duration
const workWeek: AvailabilityConfiguration = { configured: true, periods: ([1, 2, 3, 4, 5] as Weekday[]).map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })) };
const rangeDeps: OpportunityRangeDeps = { loadAvailabilityConfiguration: async () => workWeek, loadPlansOverlappingRange: async () => [] };
const at = (h: string) => new Date(`${FRIDAY}T${h}:00Z`);
const timing = (start: string, end: string): TimingCandidate => ({ start: `${FRIDAY}T${start}:00Z`, end: `${FRIDAY}T${end}:00Z`, score: 5, label: 'GOOD', muhurtaScore: 0, reasons: [], metadata: { windowType: 'NEUTRAL', windowLabel: 'Neutral Flow', activityType: 'x', dateLabel: FRIDAY } });
const WEEK_FACTS: DecisionFacts = { recurrence: { period: 'LOCAL_CALENDAR_WEEK', periodStartDate: '2026-10-05', periodEndDate: '2026-10-11', targetPerPeriod: 3, completedInPeriod: 0, committedInPeriod: 0, remainingInPeriod: 3 } };
const overlaps = (c: TimingCandidate, e: { start: Date; end: Date }) => new Date(c.start).getTime() < e.end.getTime() && e.start.getTime() < new Date(c.end).getTime();
const req = (id: string, over: Partial<RequestedDayIntent> = {}): RequestedDayIntent => ({ id, title: id, flexibility: 'FLEXIBLE', durationMinutes: 60, originalOrder: 0, ...over } as RequestedDayIntent);
const request = (intents: RequestedDayIntent[], pressured: string[]): ConstructDayRequest => ({
  targetDate: FRIDAY, timezone: 'UTC', constructionWindowSource: 'EXPLICIT_RANGE', now: at('09:00'), explicitStart: at('09:00'), explicitEnd: at('17:00'), intents,
  decisionFactsByIntentId: new Map(pressured.map((id) => [id, WEEK_FACTS])),
});
/** An honest timing search: per-intent candidate pools filtered by the request's excludedIntervals, exactly as the real engine filters. */
function deps(pools: Record<string, TimingCandidate[]>): DayConstructorOrchestratorDeps {
  return {
    loadBlockingPlans: async () => [],
    loadDurationContext: async () => ({ preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} }),
    searchTiming: (r: any) => { const excluded: Array<{ start: Date; end: Date }> = r.excludedIntervals ?? []; return { candidates: (pools[r.taskTitle ?? r.activityId] ?? []).filter((c) => !excluded.some((e) => overlaps(c, e))) }; },
    loadAvailabilityConfiguration: async () => ({ configured: false, periods: [] }),
    prepareDecisionFacts: createDecisionFactPreparer(rangeDeps),
  };
}
const SLOT = timing('11:00', '12:00');
const day = (r: any) => r.preview.constructedDay;

(async () => {
  // F: the stronger FLEXIBLE candidate (HIGH importance, AND first in submission / originalOrder), pressured by real scarcity facts.
  // X: the weaker FIXED commitment (LOW importance, declared 11:00-12:00, submitted second).
  const F = req('F', { importance: 'HIGH', originalOrder: 0 });
  const X = req('X', { flexibility: 'FIXED', fixedStart: at('11:00'), importance: 'LOW', originalOrder: 1 } as Partial<RequestedDayIntent>);
  const pools = { F: [SLOT] };
  const run = async () => {
    const diag = await orchestrateConstructDayWithDiagnostics(request([F, X], ['F']), deps(pools));
    const shadowed = await observeShadowPressure(request([F, X], ['F']), deps(pools));
    const prepared = await preparePromotionInputs(request([F, X], ['F']), deps(pools));
    const plain = await orchestrateConstructDay(request([F, X], ['F']), deps(pools));
    return { diag, shadowed, prepared, plain };
  };
  const real = await run();

  console.log('=== the real pipeline: FIXED reservation -> weaker FIXED owner -> stronger FLEXIBLE loser ===');
  const result: any = real.diag.result;
  check('the run is READY and the Constructor outcome is the baseline: the weaker FIXED X is Proposed at its declared interval (placementSource FIXED_CONSTRAINT) and the stronger FLEXIBLE F is Deferred', result.status === 'READY' && day(result).proposedItems.map((p: any) => p.intentId).join() === 'X' && day(result).deferredItems.map((d: any) => d.intentId).join() === 'F' && day(result).proposedItems[0].placementSource === 'FIXED_CONSTRAINT' && day(result).proposedItems[0].start.toISOString() === at('11:00').toISOString() && day(result).proposedItems[0].end.toISOString() === at('12:00').toISOString());
  const events = real.diag.contentionTrace.events.filter((e) => e.loserIntentId === 'F');
  check('REAL CONTENTION (P3a): the trace holds an event for F as the loser with X as the owner, and the attempted interval is the otherwise-usable 11:00-12:00 slot that overlaps X (the Constructor, not the fixture, produced it)', events.length >= 1 && events.every((e) => e.winnerIntentId === 'X' && e.attemptedStart === at('11:00').toISOString() && e.attemptedEnd === at('12:00').toISOString() && e.winnerStart === at('11:00').toISOString() && e.winnerEnd === at('12:00').toISOString()));
  check('THE CONTENTION IS CANDIDATE-VS-CANDIDATE ONLY: this run has no external blocker, F\'s slot lies inside the 09:00-17:00 window and is long enough, and P3a records only rejections caused by an interval a Proposed candidate already owns -- every event in the trace is F versus X, so the reserved FIXED interval alone explains it', real.diag.contentionTrace.events.length >= 1 && real.diag.contentionTrace.events.every((e) => e.loserIntentId === 'F' && e.winnerIntentId === 'X') && new Date(result.preview.constructionWindow.start).getTime() <= at('11:00').getTime() && new Date(result.preview.constructionWindow.end).getTime() >= at('12:00').getTime());

  console.log('=== the above-pressure relation is asserted through the reviewed primitive, not inferred from the fixture ===');
  const resolved = new Map<string, any>(result.preview.resolvedIntents.map((r: any) => [r.requestedIntentId, r.dayIntent]));
  const relation = compareAbovePressure(projectAbovePressureFacts(resolved.get('F')), projectAbovePressureFacts(resolved.get('X')), FRIDAY);
  check('compareAbovePressure(F, X) === A_STRONGER: F (HIGH) is stronger than X (LOW) on a dimension that outranks pressure, and the reverse call says B_STRONGER', relation === 'A_STRONGER' && compareAbovePressure(projectAbovePressureFacts(resolved.get('X')), projectAbovePressureFacts(resolved.get('F')), FRIDAY) === 'B_STRONGER');
  check('F ALSO PRECEDES X BY THE PLAIN OVERLOAD ORDER AND BY originalOrder (importance HIGH vs LOW; originalOrder 0 vs 1): precedence alone would have placed F first -- only the FIXED reservation explains the loss', resolved.get('F').importance === 'HIGH' && resolved.get('X').importance === 'LOW' && resolved.get('F').originalOrder < resolved.get('X').originalOrder && resolved.get('X').flexibility === 'FIXED');

  console.log('=== pressure: derived from real evidence for F; X carries the canonical NONE ===');
  const evidence = real.diag.evidenceByIntentId;
  check('F: real recurrence + opportunity evidence (scarce Friday, resolved duration) derives LAST_KNOWN_OPPORTUNITY; X (FIXED, no facts) derives NONE -- both through the production deriver, nothing injected', deriveDecisionPressure({ evidence: evidence.get('F'), planningDate: FRIDAY, flexibility: 'FLEXIBLE' }) === 'LAST_KNOWN_OPPORTUNITY' && deriveDecisionPressure({ evidence: evidence.get('X'), planningDate: FRIDAY, flexibility: 'FIXED' }) === 'NONE' && evidence.get('X') === undefined);

  console.log('=== downstream: P3b says PRECEDENCE_ANOMALY, P4a / P4a2 emit no PromotionInput ===');
  const shadow: any = real.shadowed.shadow;
  const observation = shadow.status === 'EVALUATED' ? shadow.evaluation.observations.find((o: any) => o.loserIntentId === 'F') : undefined;
  check('P3b (real pipeline): F is FINAL_DEFERRED with pressure LAST_KNOWN_OPPORTUNITY, its only owner X is FINAL_PROPOSED and compares LOSER_STRONGER_ABOVE_PRESSURE -> classification PRECEDENCE_ANOMALY', !!observation && observation.finalState === 'FINAL_DEFERRED' && observation.pressure === 'LAST_KNOWN_OPPORTUNITY' && observation.owners.length === 1 && observation.owners[0].ownerIntentId === 'X' && observation.owners[0].finalState === 'FINAL_PROPOSED' && observation.owners[0].comparison === 'LOSER_STRONGER_ABOVE_PRESSURE' && observation.classification === 'PRECEDENCE_ANOMALY');
  const promotion: any = real.prepared.promotion;
  check('P4a / P4a2 (real pipeline): the preparation is PREPARED and holds NO PromotionInput for F -- an anomaly can never become policy authority', promotion.status === 'PREPARED' && promotion.inputs.length === 0);
  check('inertness: the Constructor result, with the shadow stage and with the promotion preparation, is deep-identical to a plain orchestrateConstructDay (nothing downstream altered scheduling)', JSON.stringify(real.shadowed.result) === JSON.stringify(real.plain) && JSON.stringify(real.prepared.result) === JSON.stringify(real.plain) && JSON.stringify(real.diag.result) === JSON.stringify(real.plain));

  console.log('=== controls: the FIXED reservation is the cause ===');
  {
    // Same candidates and identical precedence, but X is FLEXIBLE: no reservation, so precedence decides and the stronger F wins.
    const Xflex = req('X', { importance: 'LOW', originalOrder: 1 });
    const flexPools = { F: [SLOT], X: [SLOT] };
    const diag = await orchestrateConstructDayWithDiagnostics(request([F, Xflex], ['F']), deps(flexPools));
    const shadowed = await observeShadowPressure(request([F, Xflex], ['F']), deps(flexPools));
    const r: any = diag.result;
    check('CONTROL (X FLEXIBLE): with the very same importance and order and no reservation, the stronger F is Proposed and the weaker X is the one Deferred -- there is no anomaly and F is not a loser at all', day(r).proposedItems.map((p: any) => p.intentId).join() === 'F' && day(r).deferredItems.map((d: any) => d.intentId).join() === 'X' && !diag.contentionTrace.events.some((e) => e.loserIntentId === 'F') && (shadowed.shadow as any).evaluation.observations.every((o: any) => o.classification !== 'PRECEDENCE_ANOMALY'));
    // A FIXED owner that is NOT weaker: the same reservation produces an ordinary (non-anomalous) relationship.
    const Xequal = req('X', { flexibility: 'FIXED', fixedStart: at('11:00'), importance: 'HIGH', originalOrder: 1 } as Partial<RequestedDayIntent>);
    const equal = await observeShadowPressure(request([F, Xequal], ['F']), deps(pools));
    const eq: any = (equal.shadow as any).evaluation.observations.find((o: any) => o.loserIntentId === 'F');
    check('CONTROL (X FIXED but equally important): the same reservation against an owner that TIES above pressure is the ordinary eligible relationship, not an anomaly -- so the anomaly in the main fixture comes from the precedence difference, not from the mere presence of a FIXED owner', !!eq && eq.owners[0].comparison === 'TIES_ABOVE_PRESSURE' && eq.classification === 'PRESSURE_ELIGIBLE_AGAINST_ALL_FINAL_OWNERS');
    const Xstronger = req('X', { flexibility: 'FIXED', fixedStart: at('11:00'), importance: 'LOW', originalOrder: 1 } as Partial<RequestedDayIntent>);
    const Fweaker = req('F', { importance: 'LOW', originalOrder: 0 });
    const weaker = await preparePromotionInputs(request([Fweaker, Xstronger], ['F']), deps(pools));
    check('CONTROL (F no stronger than the FIXED owner): a pressured loser that merely TIES a FIXED owner does get an input -- exactly the case P4b must later reject because a FIXED owner is immovable (no FIXED policy is added here)', (weaker.promotion as any).status === 'PREPARED' && (weaker.promotion as any).inputs.length === 1 && (weaker.promotion as any).inputs[0].owners[0].intentId === 'X' && (weaker.promotion as any).inputs[0].owners[0].pressure === 'NONE');
  }

  console.log('=== determinism ===');
  {
    const reps: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const again = await run();
      const sh: any = again.shadowed.shadow;
      reps.push(JSON.stringify({ shadow: sh.evaluation.observations.map((o: any) => [o.loserIntentId, o.classification, o.owners.map((w: any) => [w.ownerIntentId, w.comparison])]), inputs: (again.prepared.promotion as any).inputs, trace: again.diag.contentionTrace.events.map((e) => [e.loserIntentId, e.winnerIntentId, e.attemptedStart]) }));
    }
    check('10 independent runs of the whole real pipeline give an identical anomaly classification, the same (empty) promotion inputs and the same trace', reps.every((r) => r === reps[0]) && reps[0].includes('PRECEDENCE_ANOMALY'));
  }

  if (!allPassed) { console.error('SOME PRECEDENCE ANOMALY REAL-PIPELINE CHECKS FAILED'); process.exitCode = 1; return; }
  console.log('ALL PRECEDENCE ANOMALY REAL-PIPELINE CHECKS PASSED');
})().then(() => process.exit(), (err) => { console.error(err); process.exit(1); });
