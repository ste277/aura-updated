/**
 * Constructor Decision Intelligence -- O5 P4a: the TYPED PROMOTION INPUT (pure behavior, no database).
 *
 * Part 1 drives the pure assembler with controlled authority: the full eligibility matrix, the all-owner rule, historical vs
 * final owners, anomalies, fail-closed handling, ownership and immutability. Part 2 proves, over an EXHAUSTIVE fixture
 * matrix, that a PromotionInput exists IF AND ONLY IF the (diagnostic) P3b evaluator classifies the same candidate
 * PRESSURE_ELIGIBLE_AGAINST_ALL_FINAL_OWNERS, with the same final owners in the same order. Part 3 drives the REAL pipeline
 * (real orchestrator, preparer, projection, evidence stage, pressure deriver and the real P3a trace; only data loaders and
 * the timing search are injected) through `preparePromotionInputs`, proving each case on genuine contention and that the
 * Constructor result, the signed tokens, the loader calls and the searches are IDENTICAL to a normal run. Part 4 composes
 * the P2d coherent DecisionSchedulingContext -> facts -> evidence -> pressure -> PromotionInput chain and shows the input
 * follows the context and never a live read. Part 5 pins that nothing in normal scheduling computes an input and that
 * failure is fail-closed.
 *
 * A PromotionInput is permission to ENTER a future policy evaluation, never a promotion: nothing here changes scheduling.
 * Product / architecture invariants only: no timing, randomness, heap layout or query plan.
 */
import { projectAbovePressureFacts, type AbovePressureFacts } from '../apps/web/lib/abovePressurePrecedence';
import * as assemblerModule from '../apps/web/lib/promotionInput';
import { assemblePromotionInputs, type PromotionInput, type PromotionInputAuthority } from '../apps/web/lib/promotionInput';
import { preparePromotionInputs } from '../apps/web/lib/promotionInputPreparation';
import { evaluateShadowPressure } from '../apps/web/lib/shadowPressureEvaluation';
import { observeShadowPressure } from '../apps/web/lib/shadowPressureObservation';
import { createContentionTrace, type ContentionEvent } from '../apps/web/lib/contentionTrace';
import { orchestrateConstructDay, type ConstructDayRequest, type DayConstructorOrchestratorDeps, type RequestedDayIntent } from '../apps/web/lib/dayConstructorOrchestrator';
import { signPreviewResultBody } from '../apps/web/lib/dayConstructorPreviewIntegrity';
import { createDecisionFactPreparer } from '../apps/web/lib/decisionFactPreparation';
import type { DecisionFacts } from '../apps/web/lib/decisionFacts';
import type { DecisionPressure } from '../apps/web/lib/decisionPressure';
import type { DayIntentImportance } from '../apps/web/lib/dayIntent';
import type { OpportunityRangeDeps } from '../apps/web/lib/opportunityRangeAdapter';
import type { AvailabilityConfiguration } from '../apps/web/lib/availabilityContext';
import { createDecisionSchedulingContext, schedulingContextDurationContext, schedulingContextOpportunityRangeDeps, type DecisionSchedulingContextParts } from '../apps/web/lib/decisionSchedulingContext';
import { createGoalDemandDepsFromSchedulingContext, loadGoalDecisionFacts } from '../apps/web/lib/goalDecisionFactsProvider';
import { encodeGoalDemandIntentId } from '../apps/web/lib/goalDemandIntentId';
import type { CandidateGoalActivityForRhythmDemandRow, User } from '../apps/web/lib/db';
import type { TimingCandidate } from '../packages/recommendation/src/timingSearch';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const throwsTypeError = (fn: () => void) => { try { fn(); return false; } catch (e) { return e instanceof TypeError; } };
const reachable = (v: unknown, seen = new Set<unknown>()): unknown[] => (v === null || typeof v !== 'object' || seen.has(v) ? [] : (seen.add(v), [v, ...Object.values(v as Record<string, unknown>).flatMap((c) => reachable(c, seen))]));

// ============================================================
// Part 1 -- the pure assembler
// ============================================================
const TODAY = '2026-10-09';
const L: DayIntentImportance = 'LOW'; const M: DayIntentImportance = 'MEDIUM'; const H: DayIntentImportance = 'HIGH';
const facts = (importance: DayIntentImportance, deadline?: string): AbovePressureFacts => projectAbovePressureFacts({ importance, deadline });
const ev = (loser: string, winner: string, round = 0, s = '11:00', e = '12:00'): ContentionEvent => ({ loserIntentId: loser, winnerIntentId: winner, attemptedStart: `${TODAY}T${s}:00.000Z`, attemptedEnd: `${TODAY}T${e}:00.000Z`, winnerStart: `${TODAY}T11:00:00.000Z`, winnerEnd: `${TODAY}T12:00:00.000Z`, round });
type FinalDay = PromotionInputAuthority['finalDay'];
const finalDay = (proposed: string[], deferred: string[]) => ({ proposedItems: proposed.map((intentId) => ({ intentId })), deferredItems: deferred.map((intentId) => ({ intentId })) }) as unknown as FinalDay;
const LKO: DecisionPressure = 'LAST_KNOWN_OPPORTUNITY';
const authority = (o: { proposed: string[]; deferred: string[]; events?: ContentionEvent[]; pressure?: Record<string, DecisionPressure>; facts?: Record<string, AbovePressureFacts> }): PromotionInputAuthority => ({
  // O5 P4a2: every Proposed intent (a potential owner) carries its own pressure; unless a case states one it is NONE.
  finalDay: finalDay(o.proposed, o.deferred), contentionTrace: createContentionTrace(o.events ?? []), pressureByIntentId: new Map(Object.entries({ ...Object.fromEntries(o.proposed.map((id) => [id, 'NONE' as DecisionPressure])), ...(o.pressure ?? {}) })), precedenceFactsByIntentId: new Map(Object.entries(o.facts ?? {})), planningDate: TODAY,
});
const ids = (inputs: readonly PromotionInput[]) => inputs.map((i) => i.candidateIntentId).join();
const ownersOf = (inputs: readonly PromotionInput[], id: string) => inputs.find((i) => i.candidateIntentId === id)?.owners.map((o) => o.intentId).join();
const base = { proposed: ['A'], deferred: ['B'], events: [ev('B', 'A')], pressure: { A: 'NONE' as DecisionPressure, B: LKO }, facts: { A: facts(M), B: facts(M) } };

console.log('=== eligibility: every gate, one input per eligible final-Deferred candidate ===');
{
  const eligible = assemblePromotionInputs(authority(base));
  check('BASIC ELIGIBLE: pressured + finally Deferred + real contention + one final owner + all above-pressure dimensions tie -> exactly one PromotionInput for B with owner A', eligible.length === 1 && ids(eligible) === 'B' && ownersOf(eligible, 'B') === 'A');
  check('PRESSURE NONE: the same authority with pressure NONE produces no input (NONE can never enter a promotion evaluation)', assemblePromotionInputs(authority({ ...base, pressure: { A: 'NONE', B: 'NONE' } })).length === 0);
  check('MISSING PRESSURE: no pressure on record fails closed -- pressure is never inferred', assemblePromotionInputs(authority({ ...base, pressure: { A: 'NONE' } })).length === 0);
  check('CONTENDED THEN PROPOSED: a pressured candidate that contended but is finally Proposed produces no input', assemblePromotionInputs(authority({ ...base, proposed: ['A', 'B'], deferred: [] })).length === 0);
  check('NO CONTENTION: a pressured final Deferred candidate with no trace event produces no input (a Deferred reason is not contention)', assemblePromotionInputs(authority({ ...base, events: [] })).length === 0);
  check('NO FINAL OWNER: the historical owner is no longer Proposed -> no input', assemblePromotionInputs(authority({ ...base, proposed: [], deferred: ['B', 'A'] })).length === 0);
  check('OWNER ABSENT FROM THE FINAL RESULT ENTIRELY is valid history, not an owner: no input', assemblePromotionInputs(authority({ ...base, events: [ev('B', 'GONE')] })).length === 0);
  const strong = (a: AbovePressureFacts, b: AbovePressureFacts = facts(M)) => assemblePromotionInputs(authority({ ...base, facts: { A: a, B: b } })).length;
  check('IMPORTANCE BLOCK: a HIGH owner against a pressured MEDIUM loser -> no input; a LOW-vs-HIGH loser likewise', strong(facts(H)) === 0 && strong(facts(H), facts(L)) === 0);
  check('DEADLINE-TODAY BLOCK: an owner whose deadline is today blocks, even against a higher-importance loser', strong(facts(M, TODAY)) === 0 && strong(facts(L, TODAY), facts(H)) === 0);
  check('DEADLINE BLOCK: with deadline-today and importance tied, an owner with a stronger (present / earlier) deadline blocks', strong(facts(M, '2026-10-10')) === 0 && strong(facts(M, '2026-10-10'), facts(M, '2026-10-12')) === 0);
  check('LOSER-STRONGER ANOMALY: a loser that outranks its final owner above pressure is an anomaly, never authority -> no input', strong(facts(L), facts(M)) === 0 && strong(facts(M), facts(H)) === 0 && strong(facts(M, '2026-10-12'), facts(M, '2026-10-10')) === 0);
  check('UNKNOWN PRECEDENCE: missing facts for the loser, or for a final owner, -> no input', assemblePromotionInputs(authority({ ...base, facts: { A: facts(M) } })).length === 0 && assemblePromotionInputs(authority({ ...base, facts: { B: facts(M) } })).length === 0);
  check('ORIGINALORDER-ONLY: the facts carry no originalOrder, so candidates that differ only by it (the only dimension pressure is meant to precede) still produce an input', assemblePromotionInputs(authority(base)).length === 1 && JSON.stringify(Object.keys(facts(M, '2026-10-10')).sort()) === JSON.stringify(['deadline', 'importance']));
  check('DUPLICATE IDS fail closed: a loser appearing twice in the final result, or a historical owner appearing twice, -> no input', assemblePromotionInputs(authority({ ...base, deferred: ['B', 'B'] })).length === 0 && assemblePromotionInputs(authority({ ...base, proposed: ['A', 'A'] })).length === 0 && assemblePromotionInputs(authority({ ...base, proposed: ['A'], deferred: ['B', 'A'] })).length === 0);
  check('ROUND IS NEVER READ: the same authority with any round numbers (including malformed / negative ones) yields the identical input', JSON.stringify(assemblePromotionInputs(authority({ ...base, events: [ev('B', 'A', 7)] }))) === JSON.stringify(assemblePromotionInputs(authority(base))) && JSON.stringify(assemblePromotionInputs(authority({ ...base, events: [ev('B', 'A', -3)] }))) === JSON.stringify(assemblePromotionInputs(authority(base))));
  check('ATTEMPTED INTERVALS AND EVENT COUNTS ARE NEVER READ: three events over different intervals and rounds for the same owner give the same single-owner input as one event', JSON.stringify(assemblePromotionInputs(authority({ ...base, events: [ev('B', 'A', 0, '10:00', '11:00'), ev('B', 'A', 0, '10:30', '11:30'), ev('B', 'A', 1, '11:00', '12:00')] }))) === JSON.stringify(assemblePromotionInputs(authority(base))));
}

console.log('=== owners: 1..N, deduplicated, final only, all-owner rule, never collapsed ===');
{
  const two = { proposed: ['A1', 'A2'], deferred: ['B'], pressure: { B: LKO } as Record<string, DecisionPressure>, facts: { A1: facts(M), A2: facts(M), B: facts(M) } as Record<string, AbovePressureFacts> };
  const all = assemblePromotionInputs(authority({ ...two, events: [ev('B', 'A1'), ev('B', 'A2')] }));
  check('MULTI-OWNER ALL-TIE: two final owners that both tie above pressure -> ONE input carrying BOTH owners (never collapsed to a single winner), in order of first appearance in the trace', all.length === 1 && ownersOf(all, 'B') === 'A1,A2');
  check('owner order follows first appearance in the trace, not the final-result or alphabetical order', ownersOf(assemblePromotionInputs(authority({ ...two, events: [ev('B', 'A2'), ev('B', 'A1')] })), 'B') === 'A2,A1');
  check('MULTI-OWNER MIXED: one owner ties, the other is stronger -> no input (the all-owner rule is mandatory)', assemblePromotionInputs(authority({ ...two, facts: { ...two.facts, A2: facts(H) }, events: [ev('B', 'A1'), ev('B', 'A2')] })).length === 0);
  check('MULTI-OWNER ANOMALY: one owner ties, the other is WEAKER above pressure (loser stronger) -> no input; an anomaly is never hidden by a tying owner', assemblePromotionInputs(authority({ ...two, facts: { ...two.facts, A2: facts(L) }, events: [ev('B', 'A1'), ev('B', 'A2')] })).length === 0);
  check('MULTI-OWNER UNKNOWN: a final owner without precedence facts voids the input even though the other owner ties', assemblePromotionInputs(authority({ ...two, facts: { A1: facts(M), B: facts(M) }, events: [ev('B', 'A1'), ev('B', 'A2')] })).length === 0);
  const repeated = assemblePromotionInputs(authority({ ...two, proposed: ['A1'], events: [ev('B', 'A1', 0, '10:00', '11:00'), ev('B', 'A1', 0, '10:30', '11:30'), ev('B', 'A1', 1, '11:00', '12:00')] }));
  check('REPEATED OWNER / MULTI-ROUND OWNER: one owner across several events and rounds is ONE owner entry', repeated.length === 1 && repeated[0].owners.length === 1);
  const historical = assemblePromotionInputs(authority({ proposed: ['A2'], deferred: ['B', 'A1'], events: [ev('B', 'A1', 0), ev('B', 'A2', 1)], pressure: { B: LKO }, facts: { A1: facts(H), A2: facts(M), B: facts(M) } }));
  check('HISTORICAL OWNER REMOVED: A1 (stronger, but no longer Proposed) neither blocks nor appears; the remaining tied FINAL owner A2 is the only owner entry', historical.length === 1 && ownersOf(historical, 'B') === 'A2');
  check('ALL OWNERS REMOVED: every historical owner displaced -> no input', assemblePromotionInputs(authority({ proposed: [], deferred: ['B', 'A1', 'A2'], events: [ev('B', 'A1'), ev('B', 'A2')], pressure: { B: LKO }, facts: two.facts })).length === 0);
  check('only the loser\'s OWN contention relationships define owners: an unrelated Proposed candidate (even one tying above pressure) is never an owner', ownersOf(assemblePromotionInputs(authority({ proposed: ['A', 'X'], deferred: ['B'], events: [ev('B', 'A')], pressure: { B: LKO }, facts: { A: facts(M), X: facts(M), B: facts(M) } })), 'B') === 'A');
}

console.log('=== several losers: 0..N inputs, independence, a shared owner is not deduplicated across losers ===');
{
  const facts3 = { A: facts(M), B1: facts(M), B2: facts(M), B3: facts(M) };
  const multi = assemblePromotionInputs(authority({ proposed: ['A'], deferred: ['B1', 'B2', 'B3'], events: [ev('B1', 'A'), ev('B2', 'A'), ev('B3', 'A')], pressure: { B1: LKO, B2: LKO, B3: 'NONE' }, facts: facts3 }));
  check('0..N INPUTS: two pressured losers of the same owner produce two inputs (final-result order); the third (NONE) produces none; the shared owner appears in BOTH', ids(multi) === 'B1,B2' && ownersOf(multi, 'B1') === 'A' && ownersOf(multi, 'B2') === 'A');
  const withBlocked = assemblePromotionInputs(authority({ proposed: ['A'], deferred: ['B1', 'B2'], events: [ev('B1', 'A'), ev('B2', 'A')], pressure: { B1: LKO, B2: LKO }, facts: { A: facts(M), B1: facts(L), B2: facts(M) } }));
  check('CROSS-LOSER INDEPENDENCE: B1 (an anomaly, LOW vs MEDIUM) producing no input does not alter B2\'s', ids(withBlocked) === 'B2');
  const reordered = assemblePromotionInputs(authority({ proposed: ['A'], deferred: ['B2', 'B1'], events: [ev('B1', 'A'), ev('B2', 'A')], pressure: { B1: LKO, B2: LKO }, facts: { A: facts(M), B1: facts(M), B2: facts(M) } }));
  check('INPUT ORDER is the final-result (Deferred) order, deterministic, never Map iteration luck', ids(reordered) === 'B2,B1');
}

console.log('=== P3b equivalence: an input exists IF AND ONLY IF P3b says PRESSURE_ELIGIBLE_AGAINST_ALL_FINAL_OWNERS (exhaustive matrix) ===');
{
  const pressures: Array<DecisionPressure | undefined> = ['NONE', LKO, undefined];
  const OWNER_PRESSURES: DecisionPressure[] = ['NONE', LKO]; // O5 P4a2: each owner's own pressure; existence must not depend on it
  const loserStates = ['DEFERRED', 'PROPOSED', 'ABSENT', 'DUPLICATE'] as const;
  const eventSets: ContentionEvent[][] = [[], [ev('B', 'A1')], [ev('B', 'A1'), ev('B', 'A2')], [ev('B', 'A2'), ev('B', 'A1', 3), ev('B', 'A1', 5)], [ev('B', 'GONE'), ev('B', 'A1')]];
  const ownerStates = ['PROPOSED', 'DEFERRED', 'ABSENT', 'DUPLICATE'] as const;
  const factChoices: Array<AbovePressureFacts | undefined> = [facts(H), facts(M), facts(L), facts(M, TODAY), facts(M, '2026-10-12'), undefined];
  let scenarios = 0; let eligibleCount = 0; let mismatch = ''; const pairsSeen = new Set<string>();
  for (const pressure of pressures) for (const loserState of loserStates) for (const events of eventSets) for (const a1 of ownerStates) for (const a2 of ownerStates) for (const p1 of OWNER_PRESSURES) for (const p2 of OWNER_PRESSURES) for (const fb of factChoices) for (const f1 of factChoices) for (const f2 of factChoices) {
    const proposed: string[] = []; const deferred: string[] = [];
    const place = (id: string, state: string) => { if (state === 'PROPOSED' || state === 'DUPLICATE') proposed.push(id); if (state === 'DEFERRED') deferred.push(id); if (state === 'DUPLICATE') deferred.push(id); };
    place('B', loserState === 'DUPLICATE' ? 'DUPLICATE' : loserState === 'DEFERRED' ? 'DEFERRED' : loserState === 'PROPOSED' ? 'PROPOSED' : 'ABSENT');
    place('A1', a1); place('A2', a2);
    const pressureMap: Record<string, DecisionPressure> = { A1: p1, A2: p2 }; if (pressure) pressureMap.B = pressure;
    const factMap: Record<string, AbovePressureFacts> = {}; if (fb) factMap.B = fb; if (f1) factMap.A1 = f1; if (f2) factMap.A2 = f2;
    const auth = authority({ proposed, deferred, events, pressure: pressureMap, facts: factMap });
    const inputs = assemblePromotionInputs(auth);
    const shadow = evaluateShadowPressure({ ...auth });
    const shadowEligible = shadow.observations.filter((o) => o.classification === 'PRESSURE_ELIGIBLE_AGAINST_ALL_FINAL_OWNERS');
    scenarios += 1;
    if (shadowEligible.length > 0) eligibleCount += 1;
    shadow.observations.forEach((o) => pairsSeen.add(o.classification));
    const sameIds = shadowEligible.map((o) => o.loserIntentId).join() === inputs.map((i) => i.candidateIntentId).join();
    const sameOwners = shadowEligible.every((o) => o.owners.filter((w) => w.finalState === 'FINAL_PROPOSED').map((w) => w.ownerIntentId).join() === (ownersOf(inputs, o.loserIntentId) ?? '<none>')) && inputs.every((i) => i.owners.every((w) => w.pressure === auth.pressureByIntentId.get(w.intentId)));
    if (!(sameIds && sameOwners) && !mismatch) mismatch = JSON.stringify({ proposed, deferred, events: events.map((e) => `${e.loserIntentId}>${e.winnerIntentId}`), pressure, fb, f1, f2, inputs, shadow: shadow.observations.map((o) => `${o.loserIntentId}:${o.classification}`) });
  }
  console.log(`[info] ${scenarios} scenarios; ${eligibleCount} eligible; P3b classifications exercised: ${[...pairsSeen].sort().join(',')}`);
  check(`EQUIVALENCE (${scenarios} exhaustive scenarios over pressure x loser final state x contention history x owner final states x each owner's own pressure x precedence facts incl. missing; owner pressure enriches the payload and never changes existence): the set of candidates with an input equals the set P3b classifies PRESSURE_ELIGIBLE_AGAINST_ALL_FINAL_OWNERS, with the same final owners in the same order${mismatch ? ' -- first mismatch ' + mismatch : ''}`, mismatch === '' && eligibleCount > 0);
  check('the matrix exercised every P3b non-eligible classification as well as eligibility (NOT_PRESSURED, NO_CONTENTION, NOT_FINAL_DEFERRED, NO_FINAL_CONTENTION_OWNER, BLOCKED_BY_STRONGER_OWNER, PRECEDENCE_ANOMALY, INCOMPLETE_INPUT), so every non-eligible class is proven to produce no input', ['NOT_PRESSURED', 'NO_CONTENTION', 'NOT_FINAL_DEFERRED', 'NO_FINAL_CONTENTION_OWNER', 'BLOCKED_BY_STRONGER_OWNER', 'PRESSURE_ELIGIBLE_AGAINST_ALL_FINAL_OWNERS', 'PRECEDENCE_ANOMALY', 'INCOMPLETE_INPUT'].every((c) => pairsSeen.has(c)));
}

console.log('=== O5 P4a2: owner pressure -- each owner carries its OWN categorical pressure; existence is unchanged ===');
{
  const two = { proposed: ['A1', 'A2'], deferred: ['B'], pressure: { B: LKO } as Record<string, DecisionPressure>, facts: { A1: facts(M), A2: facts(M), B: facts(M) } as Record<string, AbovePressureFacts> };
  const owners = (inputs: readonly PromotionInput[]) => JSON.stringify(inputs[0]?.owners ?? []);
  check('BASIC CONTROL: pressured candidate, owner pressure NONE -> the input exists and owner A carries pressure NONE', owners(assemblePromotionInputs(authority(base))) === JSON.stringify([{ intentId: 'A', pressure: 'NONE' }]));
  const pressuredOwner = assemblePromotionInputs(authority({ ...base, pressure: { A: LKO, B: LKO } }));
  check('PRESSURED OWNER CONTROL (closes the P4b0 discovery): the owner is ALSO LAST_KNOWN_OPPORTUNITY and everything above pressure ties -> the input STILL exists and the owner carries LAST_KNOWN_OPPORTUNITY (rejecting it is an active-policy rule for P4b, not an admission rule)', pressuredOwner.length === 1 && owners(pressuredOwner) === JSON.stringify([{ intentId: 'A', pressure: LKO }]));
  const mixed = assemblePromotionInputs(authority({ ...two, pressure: { ...two.pressure, A1: 'NONE', A2: LKO }, events: [ev('B', 'A1'), ev('B', 'A2')] }));
  check('MULTI-OWNER MIX: owners {A1 NONE, A2 LAST_KNOWN_OPPORTUNITY} are both retained, each with its own pressure, in trace order (nothing aggregated)', owners(mixed) === JSON.stringify([{ intentId: 'A1', pressure: 'NONE' }, { intentId: 'A2', pressure: LKO }]));
  check('the owner pressure is the OWNER\'s, not the candidate\'s: a NONE owner of a LAST_KNOWN_OPPORTUNITY candidate is NONE, and reversing the owners\' pressures reverses the payload while the owner ORDER is unchanged', owners(assemblePromotionInputs(authority({ ...two, pressure: { ...two.pressure, A1: LKO, A2: 'NONE' }, events: [ev('B', 'A1'), ev('B', 'A2')] }))) === JSON.stringify([{ intentId: 'A1', pressure: LKO }, { intentId: 'A2', pressure: 'NONE' }]));
  const allPressured = assemblePromotionInputs(authority({ ...two, pressure: { ...two.pressure, A1: LKO, A2: LKO }, events: [ev('B', 'A1'), ev('B', 'A2')] }));
  check('ALL OWNERS PRESSURED: every owner is retained with LAST_KNOWN_OPPORTUNITY; the input is not suppressed', allPressured.length === 1 && allPressured[0].owners.length === 2 && allPressured[0].owners.every((w) => w.pressure === LKO));
  check('STRONGER OWNER / ANOMALY are unchanged by owner pressure: no input whatever the owner\'s pressure', [LKO, 'NONE' as DecisionPressure].every((op) => assemblePromotionInputs(authority({ ...base, pressure: { A: op, B: LKO }, facts: { A: facts(H), B: facts(M) } })).length === 0 && assemblePromotionInputs(authority({ ...base, pressure: { A: op, B: LKO }, facts: { A: facts(L), B: facts(M) } })).length === 0));
  check('HISTORICAL OWNER: a historical owner that is no longer final Proposed carries no payload at all -- it is absent, so its pressure is never read', (() => { const out = assemblePromotionInputs(authority({ proposed: ['A2'], deferred: ['B', 'A1'], events: [ev('B', 'A1', 0), ev('B', 'A2', 1)], pressure: { B: LKO, A2: 'NONE' }, facts: { A1: facts(H), A2: facts(M), B: facts(M) } })); return out.length === 1 && owners(out) === JSON.stringify([{ intentId: 'A2', pressure: 'NONE' }]); })());
  check('REPEATED OWNER: one owner entry carrying exactly one pressure value however many events / rounds', owners(assemblePromotionInputs(authority({ ...base, pressure: { A: LKO, B: LKO }, events: [ev('B', 'A', 0, '10:00', '11:00'), ev('B', 'A', 1, '10:30', '11:30'), ev('B', 'A', 2)] }))) === JSON.stringify([{ intentId: 'A', pressure: LKO }]));
  const partial = authority({ ...base });
  const noOwnerPressure: PromotionInputAuthority = { ...partial, pressureByIntentId: new Map([['B', LKO]]) };
  const shadowOfPartial = evaluateShadowPressure({ ...noOwnerPressure });
  check('MISSING OWNER PRESSURE fails closed: with the candidate\'s pressure on record but no pressure for its final owner there is no input (never a partially authoritative owner) -- while the P3b oracle, which has no owner-pressure notion, still classifies the relationship eligible (this is an authority-completeness gate, not an eligibility change; the production boundary derives pressure for every resolved intent)', assemblePromotionInputs(noOwnerPressure).length === 0 && shadowOfPartial.observations.some((o) => o.classification === 'PRESSURE_ELIGIBLE_AGAINST_ALL_FINAL_OWNERS'));
  check('a non-categorical owner value is never accepted either (an out-of-contract value is treated as missing)', assemblePromotionInputs({ ...partial, pressureByIntentId: new Map<string, DecisionPressure>([['B', LKO], ['A', 'HIGH' as unknown as DecisionPressure]]) }).length === 0);
  check('ONE ENTRY, ONE PRESSURE: a pressure map holds exactly one value per intent id, so an owner can never resolve to two pressures within one assembly; duplicate ids in the final result fail closed (above)', new Map<string, DecisionPressure>([['A', 'NONE'], ['A', LKO]]).size === 1);
  check('the candidate\'s own pressure is still encoded by existence only: the input has no candidate `pressure` field', !('pressure' in assemblePromotionInputs(authority(base))[0]));
  check('OWNER ORDER IS UNCHANGED BY PRESSURE: owners follow first appearance in the trace for every combination of owner pressures', [['NONE', 'NONE'], ['NONE', LKO], [LKO, 'NONE'], [LKO, LKO]].every(([p1, p2]) => ownersOf(assemblePromotionInputs(authority({ ...two, pressure: { ...two.pressure, A1: p1 as DecisionPressure, A2: p2 as DecisionPressure }, events: [ev('B', 'A2'), ev('B', 'A1')] })), 'B') === 'A2,A1'));
}

console.log('=== VALID-ONLY matrix (normalised, internally consistent scheduling states only): eligibility identical to P3b, owner payload exact ===');
{
  // Only VALID states: every candidate has facts, one id per candidate, the loser is Deferred or Proposed, owners are Proposed or displaced (Deferred),
  // the loser has a contention event with each historical owner, and every intent carries a categorical pressure.
  const validFacts = [facts(H), facts(M), facts(L), facts(M, TODAY), facts(M, '2026-10-12'), facts(M, '2026-10-10'), facts(H, TODAY), facts(L, '2026-10-10')];
  const eventSets: ContentionEvent[][] = [[ev('B', 'A1')], [ev('B', 'A1'), ev('B', 'A2')], [ev('B', 'A2'), ev('B', 'A1', 3), ev('B', 'A1', 5)], [ev('B', 'A1')]];
  const PRS: DecisionPressure[] = ['NONE', LKO];
  let n = 0; let eligible = 0; let bad = 0; let ownerPressureBad = 0;
  for (const pb of PRS) for (const pa1 of PRS) for (const pa2 of PRS) for (const bs of ['D', 'P']) for (const events of eventSets) for (const s1 of ['P', 'D']) for (const s2 of ['P', 'D']) for (const fb of validFacts) for (const f1 of validFacts) for (const f2 of validFacts) {
    const proposed: string[] = []; const deferred: string[] = [];
    (bs === 'D' ? deferred : proposed).push('B'); (s1 === 'P' ? proposed : deferred).push('A1'); (s2 === 'P' ? proposed : deferred).push('A2');
    const auth = authority({ proposed, deferred, events, pressure: { B: pb, A1: pa1, A2: pa2 }, facts: { B: fb, A1: f1, A2: f2 } });
    const inputs = assemblePromotionInputs(auth);
    const shadowEligible = evaluateShadowPressure({ ...auth }).observations.filter((o) => o.classification === 'PRESSURE_ELIGIBLE_AGAINST_ALL_FINAL_OWNERS');
    n += 1; if (shadowEligible.length) eligible += 1;
    const same = shadowEligible.map((o) => o.loserIntentId).join() === inputs.map((i) => i.candidateIntentId).join() && shadowEligible.every((o) => o.owners.filter((w) => w.finalState === 'FINAL_PROPOSED').map((w) => w.ownerIntentId).join() === ownersOf(inputs, o.loserIntentId));
    if (!same) bad += 1;
    if (!inputs.every((i) => i.owners.every((w) => w.pressure === auth.pressureByIntentId.get(w.intentId)))) ownerPressureBad += 1;
  }
  console.log(`[info] valid-only matrix: ${n} scenarios, ${eligible} eligible`);
  check(`VALID-ONLY EQUIVALENCE (${n} valid scenarios = 2 candidate pressures x 4 owner-pressure combinations x 2 loser states x 4 contention histories x 4 owner states x 8^3 precedence facts): zero eligibility mismatches against P3b and every owner's payload pressure equals that owner's own pressure`, n === 131072 && eligible > 0 && bad === 0 && ownerPressureBad === 0);
}

console.log('=== ownership, immutability, determinism, purity ===');
{
  const a = authority({ proposed: ['A1', 'A2'], deferred: ['B'], events: [ev('B', 'A1'), ev('B', 'A2')], pressure: { B: LKO }, facts: { A1: facts(M), A2: facts(M), B: facts(M) } });
  const before = JSON.stringify([a.finalDay, a.contentionTrace, [...a.pressureByIntentId], [...a.precedenceFactsByIntentId]]);
  const out = assemblePromotionInputs(a);
  check('INPUTS ARE NEVER MUTATED: the final day, the trace, the pressure map and the facts map are unchanged by an assembly', JSON.stringify([a.finalDay, a.contentionTrace, [...a.pressureByIntentId], [...a.precedenceFactsByIntentId]]) === before);
  check('DEEP IMMUTABILITY: the collection, each input, the owner collection and each owner are frozen; writes at every depth throw', reachable(out).every((o) => Object.isFrozen(o)) && throwsTypeError(() => { (out as unknown as PromotionInput[]).push(out[0]); }) && throwsTypeError(() => { (out[0] as { candidateIntentId: string }).candidateIntentId = 'X'; }) && throwsTypeError(() => { (out[0].owners as unknown as unknown[]).push({}); }) && throwsTypeError(() => { (out[0].owners[0] as { intentId: string }).intentId = 'X'; }));
  const inputObjects = new Set<unknown>([...reachable(a.finalDay), ...reachable(a.contentionTrace), ...a.pressureByIntentId.keys(), ...reachable([...a.precedenceFactsByIntentId.values()])]);
  check('DETACHED: no object reachable from the output is shared with any input (no Constructor, trace or facts object is retained)', reachable(out).every((o) => !inputObjects.has(o)));
  check('OUTPUT CONTENT: stable intent ids and each owner own categorical pressure only -- the input keys are exactly candidateIntentId,owners and an owner has only intentId,pressure (NONE | LAST_KNOWN_OPPORTUNITY); no candidate pressure copy, no Date, Map, Set, function, importance, deadline, round, interval, count, reason, title, evidence or source', Object.keys(out[0]).sort().join() === 'candidateIntentId,owners' && Object.keys(out[0].owners[0]).join() === 'intentId,pressure' && out.every((i) => i.owners.every((w) => w.pressure === 'NONE' || w.pressure === 'LAST_KNOWN_OPPORTUNITY')) && reachable(out).every((o) => Array.isArray(o) || Object.getPrototypeOf(o) === Object.prototype) && !/Date|Map|Set|=>/.test(JSON.stringify(out)) && ['round', 'attempted', 'importance', 'deadline', 'count', 'title', 'evidence', 'recurrence', 'opportunity', 'durationbasis'].every((k) => !JSON.stringify(out).toLowerCase().includes(k)));
  const again = assemblePromotionInputs(a);
  const firstObjects = new Set<unknown>(reachable(out));
  check('INDEPENDENT OWNERSHIP: two assemblies of the same authority share no object at any depth (no cached or shared owner / input record), so one consumer\'s reference can never be another\'s', JSON.stringify(out) === JSON.stringify(again) && reachable(again).every((o) => !firstObjects.has(o)));
  const reps = Array.from({ length: 20 }, () => JSON.stringify(assemblePromotionInputs(a)));
  check('DETERMINISM: 20 assemblies are byte-identical', reps.every((r) => r === reps[0]));
  check('NO SOURCE VOCABULARY IN BEHAVIOR: ids shaped like automatic Goal demand, a manual hand-off and a typed row yield the same inputs modulo the ids themselves', (() => { const run = (x: string, y: string) => JSON.stringify(assemblePromotionInputs(authority({ proposed: [x], deferred: [y], events: [ev(y, x)], pressure: { [y]: LKO }, facts: { [x]: facts(M), [y]: facts(M) } }))).split(JSON.stringify(x).slice(1, -1)).join('OWNER').split(JSON.stringify(y).slice(1, -1)).join('LOSER'); const r = [run('A', 'B'), run('goal-demand:2026-10-09:ga-1', 'goal-demand:2026-10-09:ga-2'), run('plan-day-goal-ga-1', 'plan-day-goal-ga-2'), run('typed-1', 'typed-2')]; return r.every((v) => v === r[0]) && r[0].includes('LOSER'); })());
  check('0 inputs is a valid, frozen empty collection', (() => { const none = assemblePromotionInputs(authority({ proposed: [], deferred: [] })); return none.length === 0 && Object.isFrozen(none); })());
}

// ============================================================
// Part 3 -- the REAL pipeline through preparePromotionInputs
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
  const preparedRun = deps(script, undefined, blockers);
  const shadowRun = deps(script, undefined, blockers);
  const normalRun = deps(script, undefined, blockers);
  const prepared = await preparePromotionInputs(request(intents, pressured), preparedRun.deps);
  const shadowed = await observeShadowPressure(request(intents, pressured), shadowRun.deps);
  const normal = await orchestrateConstructDay(request(intents, pressured), normalRun.deps);
  const inputs = prepared.promotion.status === 'PREPARED' ? prepared.promotion.inputs : undefined;
  const baselineSame = JSON.stringify(prepared.result) === JSON.stringify(normal) && JSON.stringify(preparedRun.calls) === JSON.stringify(normalRun.calls);
  const shadowEligible = shadowed.shadow.status === 'EVALUATED' ? shadowed.shadow.evaluation.observations.filter((o) => o.classification === 'PRESSURE_ELIGIBLE_AGAINST_ALL_FINAL_OWNERS').map((o) => o.loserIntentId).join() : '<unavailable>';
  const p3bAgrees = inputs !== undefined && ids(inputs) === shadowEligible;
  return { prepared, inputs, baselineSame, p3bAgrees, normal, calls: preparedRun.calls };
}
const SLOT: TimingCandidate[] = [timing('11:00', '12:00')];
const day = (r: any) => r.preview.constructedDay;

(async () => {
  console.log('=== REAL pipeline: basic contention, pressure, and the stronger dimensions ===');
  {
    const A = req('A', { originalOrder: 0 }); const B = req('B', { originalOrder: 1 });
    const basic = await pipeline([A, B], ['B'], [SLOT, SLOT, []]);
    check('BASIC ELIGIBLE (real pipeline): B (pressured: scarce Friday, resolved duration) really loses to A, is finally Deferred, and differs only by originalOrder -> exactly ONE PromotionInput (candidate B, owner A)', basic.inputs?.length === 1 && ids(basic.inputs) === 'B' && ownersOf(basic.inputs, 'B') === 'A' && basic.p3bAgrees);
    check('SCHEDULING IS THE BASELINE: the Constructor result, loader calls and searches are identical to a normal run -- A Proposed, B Deferred (the input is not applied)', basic.baselineSame && day(basic.prepared.result).proposedItems.map((p: any) => p.intentId).join() === 'A' && day(basic.prepared.result).deferredItems.map((d: any) => d.intentId).join() === 'B');
    const none = await pipeline([A, B], [], [SLOT, SLOT, []]);
    check('NONE CONTROL: the same real contention with NO pressure facts (pressure NONE) -> zero PromotionInputs', none.inputs?.length === 0 && none.baselineSame && none.p3bAgrees);
    const importance = await pipeline([req('A', { importance: 'HIGH', originalOrder: 0 }), req('B', { importance: 'LOW', originalOrder: 1 })], ['B'], [SLOT, SLOT, []]);
    check('IMPORTANCE BLOCK (real): a pressured LOW loses to HIGH -> zero PromotionInputs', importance.inputs?.length === 0 && importance.baselineSame && importance.p3bAgrees);
    const deadlineToday = await pipeline([req('A', { deadline: FRIDAY, originalOrder: 0 }), req('B', { originalOrder: 1 })], ['B'], [SLOT, SLOT, []]);
    check('DEADLINE-TODAY BLOCK (real): an owner with its deadline today -> zero PromotionInputs', deadlineToday.inputs?.length === 0 && deadlineToday.baselineSame && deadlineToday.p3bAgrees);
    const deadline = await pipeline([req('A', { deadline: '2026-10-10', originalOrder: 0 }), req('B', { originalOrder: 1 })], ['B'], [SLOT, SLOT, []]);
    check('DEADLINE BLOCK (real): an owner with a stronger non-today deadline (importance tied) -> zero PromotionInputs', deadline.inputs?.length === 0 && deadline.baselineSame && deadline.p3bAgrees);
    const reversed = await pipeline([B, A], ['B'], [SLOT, SLOT, []]);
    check('REVERSE SUBMISSION ORDER: the intents submitted in the opposite order leave the input unchanged (originalOrder is the intents\' own and is not a blocking dimension)', JSON.stringify(reversed.inputs) === JSON.stringify(basic.inputs) && reversed.baselineSame);
  }

  console.log('=== REAL pipeline: multiple owners (a real P3a multi-owner trace) ===');
  {
    const A1 = req('A1', { durationMinutes: 30, originalOrder: 0 }); const A2 = req('A2', { durationMinutes: 30, originalOrder: 1 }); const B = req('B', { originalOrder: 2 });
    const script = [[timing('11:00', '11:30')], [timing('11:30', '12:00')], [timing('11:15', '12:15')], []];
    const allTie = await pipeline([A1, A2, B], ['B'], script);
    check('MULTI-OWNER ALL-TIE (real): B\'s attempted interval overlaps TWO Proposed owners; both tie above pressure -> ONE input with BOTH owners (not collapsed)', allTie.inputs?.length === 1 && ownersOf(allTie.inputs, 'B') === 'A1,A2' && allTie.baselineSame && allTie.p3bAgrees);
    const mixed = await pipeline([A1, req('A2', { durationMinutes: 30, importance: 'HIGH', originalOrder: 1 }), B], ['B'], script);
    check('MULTI-OWNER MIXED (real): one owner ties, the other has HIGHER importance -> zero PromotionInputs', mixed.inputs?.length === 0 && mixed.baselineSame && mixed.p3bAgrees);
  }

  console.log('=== REAL pipeline: historical vs final owners across replenishment rounds ===');
  {
    const G = req('G', { importance: 'HIGH', originalOrder: 0 }); const Hh = req('H', { originalOrder: 1 }); const O = req('O', { originalOrder: 2 }); const Lo = req('L', { originalOrder: 3 });
    const S3 = [timing('11:00', '12:00')]; const S2 = [timing('13:00', '14:00')];
    const remains = await pipeline([G, Hh, O, Lo], ['L'], [S3, S3, S2, S2, S2, S2]);
    check('HISTORICAL OWNER REMOVED (real): L first lost to O (round 0); O is later displaced and L loses again to H (round 1). The input carries only the FINAL owner H -- the displaced historical owner O is not an owner entry', remains.inputs?.length === 1 && ownersOf(remains.inputs, 'L') === 'H' && remains.baselineSame && remains.p3bAgrees);
    const gone = await pipeline([G, Hh, O, Lo], ['L'], [S3, S3, S2, S2, S2, [], []]);
    check('ALL OWNERS REMOVED (real): L\'s only owner O is displaced and L is left with NO_CANDIDATES -> zero PromotionInputs', gone.inputs?.length === 0 && gone.baselineSame && gone.p3bAgrees);
    const A = req('A', { originalOrder: 0 }); const B = req('B', { originalOrder: 1 });
    const placedLater = await pipeline([A, B], ['B'], [SLOT, SLOT, [timing('13:00', '14:00')]]);
    check('CONTENDED THEN PROPOSED (real): B really contended but replenishment found it another slot and it ends Proposed -> zero PromotionInputs', placedLater.inputs?.length === 0 && day(placedLater.prepared.result).proposedItems.map((p: any) => p.intentId).sort().join() === 'A,B' && placedLater.baselineSame && placedLater.p3bAgrees);
    const multiRound = await pipeline([G, Hh, O, Lo], ['H', 'L'], [S3, S3, S2, S2, S2, S2]);
    check('SEVERAL LOSERS / MULTI-ROUND (real): across the replenishment rounds the same owner is one entry per loser and every produced input agrees with P3b', multiRound.baselineSame && multiRound.p3bAgrees && (multiRound.inputs ?? []).every((i) => new Set(i.owners.map((o) => o.intentId)).size === i.owners.length));
  }

  console.log('=== REAL pipeline: controls that are NOT contention, FIXED, fallback ===');
  {
    const A = req('A', { originalOrder: 0 }); const B = req('B', { originalOrder: 1 });
    const noCand = await pipeline([A, B], ['B'], [SLOT, []]);
    check('PRESSURE WITHOUT CONTENTION (real): B is pressured and finally Deferred because it has no candidate intervals -> zero PromotionInputs (a Deferred reason is not contention)', noCand.inputs?.length === 0 && noCand.baselineSame && noCand.p3bAgrees);
    const blocked = await pipeline([B], ['B'], [SLOT], [{ start: at('11:00'), end: at('12:00'), status: 'UPCOMING' }]);
    check('EXTERNAL BLOCKER (real): B deferred only because an existing plan occupies its slot -> zero PromotionInputs (candidate-vs-blocker is not contention)', blocked.inputs?.length === 0 && blocked.baselineSame);
    const fixed = await pipeline([req('F1', { flexibility: 'FIXED', fixedStart: at('11:00'), originalOrder: 0 }), req('F2', { flexibility: 'FIXED', fixedStart: at('11:30'), originalOrder: 1 })], ['F1', 'F2'], []);
    check('FIXED (real): a FIXED candidate can really lose contention but its pressure is NONE upstream -> zero PromotionInputs', fixed.inputs?.length === 0 && fixed.baselineSame && fixed.p3bAgrees);
    const fallback = await pipeline([A, req('B', { originalOrder: 1, durationMinutes: undefined })], ['B'], [SLOT, SLOT, []]);
    check('GENERIC_FALLBACK (real): a candidate whose duration is the generic fallback has pressure NONE upstream -> zero PromotionInputs (P4a never inspects the duration basis)', fallback.inputs?.length === 0 && fallback.baselineSame && fallback.p3bAgrees);
  }

  console.log('=== REAL pipeline (O5 P4a2): owner pressure comes from the same run\'s evidence, whatever the owner is ===');
  {
    const A = req('A', { originalOrder: 0 }); const B = req('B', { originalOrder: 1 });
    const ownerPressures = (inputs: readonly PromotionInput[] | undefined, id: string) => JSON.stringify(inputs?.find((i) => i.candidateIntentId === id)?.owners ?? null);
    const basic = await pipeline([A, B], ['B'], [SLOT, SLOT, []]);
    check('BASIC (real): the pressured loser B vs an UNPRESSURED owner A -> the input exists and A carries pressure NONE', ownerPressures(basic.inputs, 'B') === JSON.stringify([{ intentId: 'A', pressure: 'NONE' }]) && basic.baselineSame && basic.p3bAgrees);
    const bothPressured = await pipeline([A, B], ['A', 'B'], [SLOT, SLOT, []]);
    check('PRESSURED OWNER (real; the P4b0 discovery): A and B are BOTH pressured (scarce Friday, resolved durations), tie on every dimension above pressure, B really loses to A -> the input STILL exists (eligibility unchanged, P3b agrees) and owner A carries LAST_KNOWN_OPPORTUNITY', ownerPressures(bothPressured.inputs, 'B') === JSON.stringify([{ intentId: 'A', pressure: 'LAST_KNOWN_OPPORTUNITY' }]) && bothPressured.baselineSame && bothPressured.p3bAgrees);
    const A1 = req('A1', { durationMinutes: 30, originalOrder: 0 }); const A2 = req('A2', { durationMinutes: 30, originalOrder: 1 }); const B3 = req('B', { originalOrder: 2 });
    const script = [[timing('11:00', '11:30')], [timing('11:30', '12:00')], [timing('11:15', '12:15')], []];
    const mixed = await pipeline([A1, A2, B3], ['A1', 'B'], script);
    check('MULTI-OWNER MIX (real): B really loses to TWO owners, one pressured (A1) and one not (A2) -> both retained in trace order with their own pressure', ownerPressures(mixed.inputs, 'B') === JSON.stringify([{ intentId: 'A1', pressure: 'LAST_KNOWN_OPPORTUNITY' }, { intentId: 'A2', pressure: 'NONE' }]) && mixed.baselineSame && mixed.p3bAgrees);
    const allPressured = await pipeline([A1, A2, B3], ['A1', 'A2', 'B'], script);
    check('ALL OWNERS PRESSURED (real): both owners are retained with LAST_KNOWN_OPPORTUNITY; the input is not suppressed', ownerPressures(allPressured.inputs, 'B') === JSON.stringify([{ intentId: 'A1', pressure: 'LAST_KNOWN_OPPORTUNITY' }, { intentId: 'A2', pressure: 'LAST_KNOWN_OPPORTUNITY' }]) && allPressured.p3bAgrees);
    const strongerOwner = await pipeline([req('A', { importance: 'HIGH', originalOrder: 0 }), req('B', { importance: 'LOW', originalOrder: 1 })], ['A', 'B'], [SLOT, SLOT, []]);
    check('STRONGER OWNER (real): a pressured HIGH owner still blocks -- no input whatever the owner\'s pressure', strongerOwner.inputs?.length === 0 && strongerOwner.p3bAgrees);
    const fixedOwner = await pipeline([req('F', { flexibility: 'FIXED', fixedStart: at('11:00'), originalOrder: 0 } as Partial<RequestedDayIntent>), req('B', { originalOrder: 1 })], ['F', 'B'], [SLOT]);
    check('FIXED OWNER (real): a FIXED owner never receives pressure upstream, so it carries NONE even when facts were supplied for it (no special P4a2 FIXED policy -- P4b rejects a FIXED owner separately)', ownerPressures(fixedOwner.inputs, 'B') === JSON.stringify([{ intentId: 'F', pressure: 'NONE' }]) && fixedOwner.baselineSame && fixedOwner.p3bAgrees);
    const fallbackOwner = await pipeline([req('A', { originalOrder: 0, durationMinutes: undefined }), B], ['A', 'B'], [SLOT, SLOT, []]);
    check('GENERIC_FALLBACK OWNER (real): an owner whose duration is the generic fallback has pressure NONE upstream and carries NONE', fallbackOwner.inputs?.length === 1 && ownerPressures(fallbackOwner.inputs, 'B') === JSON.stringify([{ intentId: 'A', pressure: 'NONE' }]) && fallbackOwner.p3bAgrees);
    const dup = await preparePromotionInputs(request([req('A', { originalOrder: 0 }), req('A', { originalOrder: 1 }), B], ['B']), deps([SLOT, SLOT, []]).deps);
    check('DUPLICATE RESOLVED ID fails closed: one intent id can never carry two pressures -- the preparation is UNAVAILABLE with NO inputs (never picks one)', dup.promotion.status === 'UNAVAILABLE' && !('inputs' in dup.promotion));
  }

  console.log('=== source parity: automatic / manual / generic ===');
  {
    const shapes: Array<[string, string]> = [['ow-1', 'lo-2'], ['goal-demand:2026-10-09:ga-1', 'goal-demand:2026-10-09:ga-2'], ['plan-day-goal-ga-1', 'plan-day-goal-ga-2'], ['typed-1', 'typed-2']];
    const runs: string[] = [];
    for (const [a, b] of shapes) {
      const r = await pipeline([req(a, { originalOrder: 0 }), req(b, { originalOrder: 1 })], [b], [SLOT, SLOT, []]);
      runs.push(JSON.stringify(r.inputs).split(JSON.stringify(a).slice(1, -1)).join('OWNER').split(JSON.stringify(b).slice(1, -1)).join('LOSER'));
    }
    const runsPressuredOwner: string[] = [];
    for (const [a, b] of shapes) {
      const r = await pipeline([req(a, { originalOrder: 0 }), req(b, { originalOrder: 1 })], [a, b], [SLOT, SLOT, []]);
      runsPressuredOwner.push(JSON.stringify(r.inputs).split(JSON.stringify(a).slice(1, -1)).join('OWNER').split(JSON.stringify(b).slice(1, -1)).join('LOSER'));
    }
    check('AUTO / MANUAL / GENERIC PARITY (real): equivalent scheduling authority yields the SAME PromotionInput -- including the owners\' pressure, whether the owner is unpressured or pressured -- whether the ids look like automatic Goal demand, a manual hand-off or a generic typed intent', runs.every((r) => r === runs[0]) && runs[0].includes('LOSER') && runs[0].includes('OWNER') && runs[0].includes('"pressure":"NONE"') && runsPressuredOwner.every((r) => r === runsPressuredOwner[0]) && runsPressuredOwner[0].includes('"pressure":"LAST_KNOWN_OPPORTUNITY"'));
  }

  console.log('=== composed authority: P2d coherent context -> facts -> evidence -> pressure -> PromotionInput ===');
  {
    const cand = (id: string, activityId: string): CandidateGoalActivityForRhythmDemandRow => ({ goalActivityId: id, goalId: 'g1', goalTitle: 'G', title: id, activityId, rhythmKind: 'N_PER_WEEK', rhythmTargetPerWeek: 3 });
    type ContextPlans = NonNullable<DecisionSchedulingContextParts['opportunity']>['plans'];
    const contextParts = (plans: ContextPlans): DecisionSchedulingContextParts => ({
      recurrence: { candidateRows: [cand('ga-1', 'workout'), cand('ga-2', 'workout')], occurrenceRows: [] },
      durationSources: { preferenceRows: [{ activityId: 'workout', preferredDurationMinutes: 60 }], habitLogs: [] },
      opportunity: { configured: true, periods: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })), planRangeFrom: new Date(`${FRIDAY}T00:00:00Z`), planRangeTo: new Date('2026-10-12T00:00:00Z'), plans },
    });
    const idA = encodeGoalDemandIntentId(FRIDAY, 'ga-1'); const idB = encodeGoalDemandIntentId(FRIDAY, 'ga-2');
    const user = { id: 'u1' } as unknown as User;
    const compose = async (plans: ContextPlans) => {
      const ctx = createDecisionSchedulingContext(contextParts(plans));
      const intents = [req(idA, { activityId: 'workout', durationMinutes: undefined, originalOrder: 0 }), req(idB, { activityId: 'workout', durationMinutes: undefined, originalOrder: 1 })];
      const shell: ConstructDayRequest = request(intents, []);
      const factsFromContext = await loadGoalDecisionFacts(user, shell, createGoalDemandDepsFromSchedulingContext(ctx));
      const live = { calls: 0 };
      const run = deps([SLOT, SLOT, []]);
      const contextDeps: DayConstructorOrchestratorDeps = { ...run.deps, loadDurationContext: async () => schedulingContextDurationContext(ctx, 'UTC', at('09:00')), prepareDecisionFacts: createDecisionFactPreparer(schedulingContextOpportunityRangeDeps(ctx)) };
      // a live range reader that must never be reached on this path
      (rangeDeps as { loadPlansOverlappingRange: OpportunityRangeDeps['loadPlansOverlappingRange'] }).loadPlansOverlappingRange = async () => { live.calls += 1; return []; };
      try {
        const out = await preparePromotionInputs({ ...shell, decisionFactsByIntentId: factsFromContext }, contextDeps);
        return { out, live, factsFromContext, run };
      } finally {
        (rangeDeps as { loadPlansOverlappingRange: OpportunityRangeDeps['loadPlansOverlappingRange'] }).loadPlansOverlappingRange = async () => [];
      }
    };
    const s0 = await compose([]);
    check('COHERENT AUTHORITY (S0): the facts come from the context, the duration (stored preference 60) and the availability / blocker adaptation come from the SAME context, and the resulting pressure yields exactly one PromotionInput (the later Friday candidate vs the first) -- with zero live range reads', s0.factsFromContext.size === 2 && s0.out.promotion.status === 'PREPARED' && (s0.out.promotion as { inputs: readonly PromotionInput[] }).inputs.length === 1 && s0.live.calls === 0 && (s0.out.promotion as { inputs: readonly PromotionInput[] }).inputs[0].owners.every((w) => w.pressure === 'LAST_KNOWN_OPPORTUNITY'));
    const s1 = await compose([{ plannedStartAt: new Date(`${FRIDAY}T09:00:00Z`), plannedEndAt: new Date(`${FRIDAY}T17:00:00Z`), status: 'UPCOMING' }]);
    check('THE INPUT FOLLOWS THE CONTEXT: a context whose persisted plans commit the whole day (a different coherent state) makes the supply KNOWN_INFEASIBLE, pressure NONE, and the SAME Constructor scenario produces zero PromotionInputs -- pressure is never injected from outside', s1.out.promotion.status === 'PREPARED' && (s1.out.promotion as { inputs: readonly PromotionInput[] }).inputs.length === 0 && JSON.stringify(day(s1.out.result)) === JSON.stringify(day(s0.out.result)));
  }

  console.log('=== inert: normal runs never assemble an input; failure is fail-closed; tokens are identical ===');
  {
    const A = req('A', { originalOrder: 0 }); const B = req('B', { originalOrder: 1 });
    const realAssemble = assemblerModule.assemblePromotionInputs;
    let assembleCalls = 0;
    (assemblerModule as any).assemblePromotionInputs = (...a: unknown[]) => { assembleCalls += 1; return (realAssemble as any)(...a); };
    try {
      await orchestrateConstructDay(request([A, B], ['B']), deps([SLOT, SLOT, []]).deps);
      check('NORMAL PREVIEW PATH: `orchestrateConstructDay` assembles no PromotionInput (zero calls to the assembler)', assembleCalls === 0);
      const ok = await preparePromotionInputs(request([A, B], ['B']), deps([SLOT, SLOT, []]).deps);
      check('the preparation boundary assembles once, after construction', assembleCalls === 1 && ok.promotion.status === 'PREPARED');
      const baseline = JSON.stringify(await orchestrateConstructDay(request([A, B], ['B']), deps([SLOT, SLOT, []]).deps));
      (assemblerModule as any).assemblePromotionInputs = () => { throw new Error('assembly boom'); };
      const failing = await preparePromotionInputs(request([A, B], ['B']), deps([SLOT, SLOT, []]).deps);
      check('FAIL CLOSED (assembler throws): the Constructor result is returned exactly as normal and the outcome is UNAVAILABLE / PREPARATION_FAILED with NO inputs', JSON.stringify(failing.result) === baseline && failing.promotion.status === 'UNAVAILABLE' && (failing.promotion as { reason: string }).reason === 'PREPARATION_FAILED' && !('inputs' in failing.promotion));
      const notReady = await preparePromotionInputs({ ...request([A, B], ['B']), timezone: '' }, deps([SLOT, SLOT, []]).deps);
      check('a run that is not READY returns its result untouched with the outcome UNAVAILABLE / RUN_NOT_READY', notReady.result.status === 'TIMEZONE_MISSING' && notReady.promotion.status === 'UNAVAILABLE' && (notReady.promotion as { reason: string }).reason === 'RUN_NOT_READY');
    } finally {
      (assemblerModule as any).assemblePromotionInputs = realAssemble;
    }
    const sign = (r: unknown) => JSON.stringify(signPreviewResultBody('user-1', r as Record<string, unknown>));
    const prepared = await preparePromotionInputs(request([A, B], ['B']), deps([SLOT, SLOT, []]).deps);
    const plain = await orchestrateConstructDay(request([A, B], ['B']), deps([SLOT, SLOT, []]).deps);
    check('TOKENS: the signed preview body, every acceptance token included, is identical with and without P4a assembly; the preview carries no promotion output', sign(prepared.result) === sign(plain) && sign(plain).includes('acceptanceToken') && !JSON.stringify(prepared.result).toLowerCase().includes('promotion'));
    const outcomeIsFrozen = Object.isFrozen(prepared.promotion) && reachable(prepared.promotion).every((o) => Object.isFrozen(o));
    check('the outcome (status + inputs) is deeply frozen', outcomeIsFrozen);
  }

  if (!allPassed) { console.error('SOME PROMOTION INPUT CHECKS FAILED'); process.exitCode = 1; return; }
  console.log('ALL PROMOTION INPUT CHECKS PASSED');
})().then(() => process.exit(), (err) => { console.error(err); process.exit(1); });
