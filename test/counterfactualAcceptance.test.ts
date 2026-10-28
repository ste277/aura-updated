/**
 * Constructor Decision Intelligence -- O5 P4b3: the PURE COUNTERFACTUAL ACCEPTANCE PREDICATE (pure behavior, no DB).
 *
 * P4b2 answers "what mechanically happens?"; P4b3 answers "is Aura ALLOWED to prefer that counterfactual over the baseline under the V1 policy?" for ONE
 * immutable pair. ACCEPT means only "satisfies the V1 policy" -- nothing is applied, persisted or signed.
 *
 * THE V1 ACCEPTANCE TRUTH TABLE (written BEFORE the module; reasons in this deterministic precedence, only the REPORTED reason depends on it):
 *   structure (UNAVAILABLE)  authority not READY / contradictory authorities / the counterfactual contradicts itself or the baseline (silent change, missing or
 *                            duplicated P, extra intent, overlap, out of window, on a blocker, wrong duration) / non-finite instant / unknown baseline timing fit
 *   1 FIXED_PLACEMENT_CHANGED   a displaced owner is a baseline FIXED placement
 *   2 NON_OWNER_CHANGED         a displaced intent is not an authorized owner
 *   3 UNNECESSARY_OWNER_CHANGE  a displaced owner does not terminally overlap P's promoted interval (minimum change; undisturbed owners stay identical)
 *   4 PRECEDENCE_NOT_TIE        P must tie EVERY displaced owner on deadline-today / importance / deadline (the established `compareAbovePressure`);
 *                               originalOrder, timing fit and pressure never decide it
 *   5 OWNER_WOULD_BE_UNPLACED   ANY displaced owner unplaced: no affirmative safe-to-defer authority exists (NONE = "no ESTABLISHED pressure", not "safe")
 *   6 OWNER_TIMING_DEGRADED     a relocated owner's fit must be no worse than its OWN baseline fit (Constructor ranking; undefined ranks worst)
 *   7 NET_PROPOSED_LOSS         backstop: count >= baseline + 1
 *   ACCEPT otherwise. Pressure (day-level LAST_KNOWN_OPPORTUNITY) is never read: a same-day relocation keeps the pressured opportunity, and loss is rejected
 *   whatever the pressure value.
 *
 * Part 1 pins every rule on hand-built, coherent baseline / counterfactual pairs. Part 2 pins the structural (UNAVAILABLE) boundary. Part 3 pins
 * determinism: reason precedence, order invariance, pressure and above-pressure parity. Part 4 runs the REAL pipeline (orchestrator diagnostics -> evidence /
 * pressure -> PromotionInput -> contention -> attempts -> P4b2 -> P4b3) for a real ACCEPT and a real REJECT, with baseline / signed-token parity. Part 5 is a
 * diagnostics-only incidence sweep over real generated counterfactuals (reported honestly, never used to tune the policy).
 */
import { rankedShuffle } from './fixtureSupport';
import { evaluateCounterfactualAcceptance, type CounterfactualAcceptance, type CounterfactualAcceptanceInput } from '../apps/web/lib/counterfactualAcceptance';
import { generateLocalCounterfactual, type CounterfactualPlacement, type LocalCounterfactual } from '../apps/web/lib/localCounterfactual';
import { compareAbovePressure, projectAbovePressureFacts } from '../apps/web/lib/abovePressurePrecedence';
import type { ConstructionBasis, ConstructionBasisOutcome } from '../apps/web/lib/constructionBasis';
import type { BaselinePlacement, BaselinePlacementsOutcome } from '../apps/web/lib/baselinePlacements';
import type { PlacementTimingFit } from '../apps/web/lib/dayConstructor';
import type { PromotionInput } from '../apps/web/lib/promotionInput';
import { preparePromotionInputs } from '../apps/web/lib/promotionInputPreparation';
import { orchestrateConstructDay, type ConstructDayRequest, type DayConstructorOrchestratorDeps, type RequestedDayIntent } from '../apps/web/lib/dayConstructorOrchestrator';
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
const FRIDAY = '2026-10-09';
const T = (h: string) => new Date(`${FRIDAY}T${h}:00.000Z`);
const plus = (h: string, minutes: number) => new Date(T(h).getTime() + minutes * 60000);
const reachable = (v: unknown, seen = new Set<unknown>()): Set<unknown> => { if (v !== null && typeof v === 'object' && !seen.has(v)) { seen.add(v); Object.values(v as Record<string, unknown>).forEach((c) => reachable(c, seen)); } return seen; };
const throwsTypeError = (fn: () => void) => { try { fn(); return false; } catch (e) { return e instanceof TypeError; } };
function deepFreeze<T>(v: T): T { if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); Object.values(v as Record<string, unknown>).forEach(deepFreeze); } return v; }

// ---------------------------------------------------------------------------------------------------------------------------------
// Hand-built, COHERENT baseline / counterfactual pairs (the module revalidates them like any caller's)
// ---------------------------------------------------------------------------------------------------------------------------------
type Fit = PlacementTimingFit | undefined;
interface IntentSpec { id: string; importance?: 'HIGH' | 'MEDIUM' | 'LOW'; deadline?: string; fixed?: boolean; minutes?: number }
interface BaseSpec { id: string; s: string; fit?: Fit; fixed?: boolean }
interface World { intents: IntentSpec[]; baseline: BaseSpec[]; blockers?: Array<[string, string]>; owners: string[]; pressure?: Record<string, 'NONE' | 'LAST_KNOWN_OPPORTUNITY'> }
interface Plan { p: { s: string; fit?: Fit }; relocated?: Record<string, { s: string; fit?: Fit }>; unplaced?: string[] }
interface Mutable { placements: CounterfactualPlacement[]; promoted: CounterfactualPlacement; displaced: string[]; relocated: CounterfactualPlacement[]; unplaced: string[]; candidate: string }

const minutesOf = (w: World, id: string) => w.intents.find((i) => i.id === id)?.minutes ?? 60;
function bases(w: World): { basis: ConstructionBasisOutcome; placements: BaselinePlacementsOutcome } {
  const basis: ConstructionBasis = {
    planningDate: FRIDAY,
    window: { date: FRIDAY, timezone: 'UTC', start: T('09:00'), end: T('17:00') },
    intents: w.intents.map((i, index) => ({ id: i.id, title: i.id, importance: i.importance ?? 'MEDIUM', ...(i.deadline ? { deadline: i.deadline } : {}), estimatedDurationMinutes: i.minutes ?? 60, flexibility: i.fixed ? 'FIXED' : 'FLEXIBLE', originalOrder: index })),
    blockedIntervals: (w.blockers ?? []).map(([s, e]) => ({ start: T(s), end: T(e), source: 'EXTERNAL' as const })),
    initialCandidates: [], finalCandidates: [], fixedConstraints: [],
  };
  const placements: BaselinePlacement[] = w.baseline.map((b) => ({ intentId: b.id, start: T(b.s), end: plus(b.s, minutesOf(w, b.id)), placementSource: b.fixed ? 'FIXED_CONSTRAINT' : 'SELECTED_CANDIDATE', ...(b.fixed ? {} : { timingFit: b.fit, candidateOrder: 0 }) } as BaselinePlacement));
  return { basis: { status: 'READY', basis } as ConstructionBasisOutcome, placements: { status: 'READY', placements: { placements } } as BaselinePlacementsOutcome };
}
const row = (w: World, id: string, s: string, source: CounterfactualPlacement['placementSource'], fit: Fit): CounterfactualPlacement => ({ intentId: id, start: T(s), end: plus(s, minutesOf(w, id)), placementSource: source, ...(fit ? { timingFit: fit } : {}) });
function mutableOf(w: World, plan: Plan): Mutable {
  const placements: CounterfactualPlacement[] = []; const relocated: CounterfactualPlacement[] = []; const displaced: string[] = [];
  for (const b of w.baseline) {
    const move = plan.relocated?.[b.id];
    if (move) { const r = row(w, b.id, move.s, 'RELOCATED_CAPTURED_CANDIDATE', move.fit); placements.push(r); relocated.push(r); displaced.push(b.id); }
    else if (plan.unplaced?.includes(b.id)) displaced.push(b.id);
    else placements.push(row(w, b.id, b.s, 'BASELINE_UNCHANGED', b.fixed ? undefined : b.fit));
  }
  const promoted = row(w, 'P', plan.p.s, 'PROMOTED_CONTENTION_ATTEMPT', plan.p.fit);
  placements.push(promoted);
  return { placements, promoted, displaced, relocated, unplaced: [...(plan.unplaced ?? [])], candidate: 'P' };
}
function input(w: World, plan: Plan, edit?: (m: Mutable) => void): CounterfactualAcceptanceInput {
  const m = mutableOf(w, plan); edit?.(m);
  const { basis, placements } = bases(w);
  const counterfactual: LocalCounterfactual = { candidateIntentId: m.candidate, promotedPlacement: m.promoted, displacedOwnerIds: m.displaced, relocatedPlacements: m.relocated, unplacedOwnerIds: m.unplaced, counterfactualPlacements: m.placements };
  const promotionInput: PromotionInput = { candidateIntentId: 'P', owners: w.owners.map((id) => ({ intentId: id, pressure: w.pressure?.[id] ?? 'NONE' })) };
  return deepFreeze({ constructionBasis: basis, baselinePlacements: placements, promotionInput, counterfactual });
}
const verdict = (d: CounterfactualAcceptance) => (d.status === 'ACCEPT' ? 'ACCEPT' : `${d.status}:${d.reason}`);
const decide = (w: World, plan: Plan, edit?: (m: Mutable) => void) => verdict(evaluateCounterfactualAcceptance(input(w, plan, edit)));

// the simple world: O (10:00-11:00 GOOD, owner) and N (13:00 BEST, non-owner); P ties O on everything above pressure (all MEDIUM, no deadline).
const SIMPLE: World = { intents: [{ id: 'O' }, { id: 'N' }, { id: 'P' }], baseline: [{ id: 'O', s: '10:00', fit: 'GOOD' }, { id: 'N', s: '13:00', fit: 'BEST' }], owners: ['O'] };
const OK: Plan = { p: { s: '10:30', fit: 'GOOD' }, relocated: { O: { s: '15:00', fit: 'GOOD' } } };

(async () => {
  // ======================================================================
  console.log('=== Part 1: the V1 policy, rule by rule (coherent pairs) ===');
  {
    const d = evaluateCounterfactualAcceptance(input(SIMPLE, OK));
    check('SIMPLE ACCEPT: P promoted, owner O relocated with the SAME timing fit, P ties O above pressure, nothing else changes -> ACCEPT (and only that: the decision carries no score, count or reason)', verdict(d) === 'ACCEPT' && Object.keys(d).join() === 'status');
    check('BETTER OWNER TIMING: O relocated from WORKABLE to BEST -> ACCEPT (the floor is "no worse", not "equal")', decide({ ...SIMPLE, baseline: [{ id: 'O', s: '10:00', fit: 'WORKABLE' }, SIMPLE.baseline[1]] }, { p: OK.p, relocated: { O: { s: '15:00', fit: 'BEST' } } }) === 'ACCEPT');
    check('WORSE OWNER TIMING: O relocated from GOOD to CAUTION (and to WORKABLE) -> REJECT OWNER_TIMING_DEGRADED; the relocated fit being UNKNOWN (undefined ranks worst) is also a degradation', decide(SIMPLE, { p: OK.p, relocated: { O: { s: '15:00', fit: 'CAUTION' } } }) === 'REJECT:OWNER_TIMING_DEGRADED' && decide(SIMPLE, { p: OK.p, relocated: { O: { s: '15:00', fit: 'WORKABLE' } } }) === 'REJECT:OWNER_TIMING_DEGRADED' && decide(SIMPLE, { p: OK.p, relocated: { O: { s: '15:00', fit: undefined } } }) === 'REJECT:OWNER_TIMING_DEGRADED');
    {
      // O5 P4b4 (committed #214 review debt): the TIMING-FLOOR GRID. The floor is decided by the fit RANK alone -- never by where the owner moves (earlier or later),
      // never by candidateOrder (not an input; the comparator shell is a pinned constant). Baseline fit x relocated fit x relocation direction, every fit value.
      const FITS = ['BEST', 'GOOD', 'WORKABLE', 'CAUTION', undefined] as const;
      const rankOf = (f: string | undefined) => (f === undefined ? 4 : ['BEST', 'GOOD', 'WORKABLE', 'CAUTION'].indexOf(f));
      const gridWorld = (direction: 'LATE_TO_EARLY' | 'EARLY_TO_LATE', baselineFit: Fit): { w: World; plan: (fit: Fit) => Plan } => ({
        w: { intents: [{ id: 'O' }, { id: 'N' }, { id: 'P' }], baseline: [{ id: 'O', s: direction === 'LATE_TO_EARLY' ? '15:00' : '09:00', fit: baselineFit }, { id: 'N', s: '13:00', fit: 'BEST' }], owners: ['O'] },
        plan: (fit) => (direction === 'LATE_TO_EARLY' ? { p: { s: '15:30', fit: 'GOOD' }, relocated: { O: { s: '09:00', fit } } } : { p: { s: '09:30', fit: 'GOOD' }, relocated: { O: { s: '15:00', fit } } }),
      });
      const cells: string[] = [];
      for (const baselineFit of FITS) for (const relocatedFit of FITS) for (const direction of ['LATE_TO_EARLY', 'EARLY_TO_LATE'] as const) {
        const { w, plan } = gridWorld(direction, baselineFit);
        const want = baselineFit === undefined ? 'UNAVAILABLE:BASELINE_TIMING_UNKNOWN' : rankOf(relocatedFit) > rankOf(baselineFit) ? 'REJECT:OWNER_TIMING_DEGRADED' : 'ACCEPT';
        if (decide(w, plan(relocatedFit)) !== want) cells.push(`${baselineFit}->${relocatedFit} ${direction}`);
      }
      check('TIMING-FLOOR GRID (committed): over every baseline fit x relocated fit (BEST, GOOD, WORKABLE, CAUTION, unknown) x earlier / later relocation (50 cells) same or better -> ACCEPT, worse (an unknown relocated fit ranks worst) -> REJECT OWNER_TIMING_DEGRADED, unknown baseline -> UNAVAILABLE BASELINE_TIMING_UNKNOWN' + (cells.length ? ` -- mismatches: ${cells.join('; ')}` : ''), cells.length === 0);
      const same = (direction: 'LATE_TO_EARLY' | 'EARLY_TO_LATE') => { const { w, plan } = gridWorld(direction, 'GOOD'); return decide(w, plan('GOOD')); };
      check('SAME-FIT START INDEPENDENCE (pinned): baseline GOOD @ 15:00 relocated to GOOD @ 09:00, and baseline GOOD @ 09:00 relocated to GOOD @ 15:00, never reject for timing -> ACCEPT both ways', same('LATE_TO_EARLY') === 'ACCEPT' && same('EARLY_TO_LATE') === 'ACCEPT');
    }
    check('P\'S OWN FIT IS NOT A CONDITION: P promoted at CAUTION while O keeps GOOD -> ACCEPT (P is promoted for pressure, not for timing)', decide(SIMPLE, { p: { s: '10:30', fit: 'CAUTION' }, relocated: OK.relocated }) === 'ACCEPT');
    check('CRITICAL NONE FIXTURE: a displaced owner left UNPLACED -> REJECT OWNER_WOULD_BE_UNPLACED, whether the owner\'s pressure is NONE or LAST_KNOWN_OPPORTUNITY (NONE means "no established pressure", not "safe to defer")', decide({ ...SIMPLE, pressure: { O: 'NONE' } }, { p: OK.p, unplaced: ['O'] }) === 'REJECT:OWNER_WOULD_BE_UNPLACED' && decide({ ...SIMPLE, pressure: { O: 'LAST_KNOWN_OPPORTUNITY' } }, { p: OK.p, unplaced: ['O'] }) === 'REJECT:OWNER_WOULD_BE_UNPLACED');
    check('NONE RELOCATED SAME FIT -> ACCEPT: NONE does not block when the owner is still scheduled; PRESSURED RELOCATED SAME DAY -> ACCEPT: LAST_KNOWN_OPPORTUNITY is DAY-level (the current day stays the opportunity), so a same-day relocation is not owner loss and pressure alone never rejects', decide({ ...SIMPLE, pressure: { O: 'NONE' } }, OK) === 'ACCEPT' && decide({ ...SIMPLE, pressure: { O: 'LAST_KNOWN_OPPORTUNITY' } }, OK) === 'ACCEPT');
    const fixedWorld: World = { intents: [{ id: 'F', fixed: true }, { id: 'N' }, { id: 'P' }], baseline: [{ id: 'F', s: '10:00', fixed: true }, { id: 'N', s: '13:00', fit: 'BEST' }], owners: ['F'] };
    check('FIXED CHANGED: a counterfactual that (truthfully) moves, or drops, a baseline FIXED placement never ACCEPTs -> REJECT FIXED_PLACEMENT_CHANGED', decide(fixedWorld, { p: { s: '10:30', fit: 'GOOD' }, relocated: { F: { s: '15:00' } } }) === 'REJECT:FIXED_PLACEMENT_CHANGED' && decide(fixedWorld, { p: { s: '10:30', fit: 'GOOD' }, unplaced: ['F'] }) === 'REJECT:FIXED_PLACEMENT_CHANGED');
    check('NON-OWNER MOVED: N is not an authorized owner; a counterfactual that truthfully moves (or drops) it -> REJECT NON_OWNER_CHANGED', decide(SIMPLE, { p: { s: '13:30', fit: 'GOOD' }, relocated: { N: { s: '15:00', fit: 'BEST' } } }) === 'REJECT:NON_OWNER_CHANGED' && decide(SIMPLE, { p: { s: '13:30', fit: 'GOOD' }, unplaced: ['N'] }) === 'REJECT:NON_OWNER_CHANGED');
    const twoOwners: World = { intents: [{ id: 'O1' }, { id: 'O2' }, { id: 'P' }], baseline: [{ id: 'O1', s: '10:00', fit: 'GOOD' }, { id: 'O2', s: '13:00', fit: 'GOOD' }], owners: ['O1', 'O2'] };
    check('UNDISTURBED AUTHORIZED OWNER MOVED: O2 is authorized but P\'s interval does not overlap it; a counterfactual that nevertheless displaces it -> REJECT UNNECESSARY_OWNER_CHANGE (minimum change); with O2 untouched the same promotion ACCEPTs', decide(twoOwners, { p: { s: '10:30', fit: 'GOOD' }, relocated: { O1: { s: '14:00', fit: 'GOOD' }, O2: { s: '16:00', fit: 'GOOD' } } }) === 'REJECT:UNNECESSARY_OWNER_CHANGE' && decide(twoOwners, { p: { s: '10:30', fit: 'GOOD' }, relocated: { O1: { s: '15:00', fit: 'GOOD' } } }) === 'ACCEPT');
    // above-pressure precedence
    const tie = (o: IntentSpec, p: IntentSpec = { id: 'P' }): World => ({ ...SIMPLE, intents: [o, { id: 'N' }, p] });
    check('PRECEDENCE: an owner that OUTRANKS P on importance, a deadline-today owner, a stronger-deadline owner -> REJECT PRECEDENCE_NOT_TIE', decide(tie({ id: 'O', importance: 'HIGH' }), OK) === 'REJECT:PRECEDENCE_NOT_TIE' && decide(tie({ id: 'O', deadline: FRIDAY }), OK) === 'REJECT:PRECEDENCE_NOT_TIE' && decide(tie({ id: 'O', deadline: '2026-10-10' }, { id: 'P', deadline: '2026-10-12' }), OK) === 'REJECT:PRECEDENCE_NOT_TIE');
    check('PRECEDENCE, THE OTHER DIRECTION: P stronger than O (P HIGH vs O LOW) is also not a tie -> REJECT PRECEDENCE_NOT_TIE (P4a authorizes only ties; a non-tie pair is out of contract and never ACCEPTs)', decide(tie({ id: 'O', importance: 'LOW' }, { id: 'P', importance: 'HIGH' }), OK) === 'REJECT:PRECEDENCE_NOT_TIE');
    check('originalOrder, timing fit and pressure must NOT affect the tie: owner and candidate with different originalOrder (always, by construction), O BEST vs P CAUTION, and every pressure combination -> ACCEPT; the same equal-importance / equal-deadline tie with a deadline on both -> ACCEPT', decide({ ...SIMPLE, baseline: [{ id: 'O', s: '10:00', fit: 'BEST' }, SIMPLE.baseline[1]] }, { p: { s: '10:30', fit: 'CAUTION' }, relocated: { O: { s: '15:00', fit: 'BEST' } } }) === 'ACCEPT' && decide({ ...SIMPLE, pressure: { O: 'LAST_KNOWN_OPPORTUNITY' } }, OK) === 'ACCEPT' && decide(tie({ id: 'O', deadline: '2026-10-12' }, { id: 'P', deadline: '2026-10-12' }), OK) === 'ACCEPT');
    // multi-owner
    const multi: World = { intents: [{ id: 'A' }, { id: 'B' }, { id: 'P' }], baseline: [{ id: 'A', s: '10:00', fit: 'GOOD' }, { id: 'B', s: '11:00', fit: 'GOOD' }], owners: ['A', 'B'] };
    const both = { A: { s: '14:00', fit: 'GOOD' as Fit }, B: { s: '15:00', fit: 'GOOD' as Fit } };
    check('MULTI-OWNER ALL PASS -> ACCEPT; every displaced owner is judged independently and ONE failure rejects the whole counterfactual: one timing fail, one unplaced, one precedence fail', decide(multi, { p: { s: '10:30', fit: 'GOOD' }, relocated: both }) === 'ACCEPT' && decide(multi, { p: { s: '10:30', fit: 'GOOD' }, relocated: { A: both.A, B: { s: '15:00', fit: 'CAUTION' } } }) === 'REJECT:OWNER_TIMING_DEGRADED' && decide(multi, { p: { s: '10:30', fit: 'GOOD' }, relocated: { A: both.A }, unplaced: ['B'] }) === 'REJECT:OWNER_WOULD_BE_UNPLACED' && decide({ ...multi, intents: [{ id: 'A' }, { id: 'B', importance: 'HIGH' }, { id: 'P' }] }, { p: { s: '10:30', fit: 'GOOD' }, relocated: both }) === 'REJECT:PRECEDENCE_NOT_TIE');
    const accepted = input(multi, { p: { s: '10:30', fit: 'GOOD' }, relocated: both });
    check('NET COUNT: an ACCEPTed counterfactual holds exactly baseline count + 1 placements (here 2 + 1 = 3) -- count is a backstop and is never a substitute for the per-owner rules', evaluateCounterfactualAcceptance(accepted).status === 'ACCEPT' && accepted.counterfactual.counterfactualPlacements.length === 3 && decide(multi, { p: { s: '10:30', fit: 'GOOD' }, relocated: { A: both.A }, unplaced: ['B'] }) !== 'ACCEPT');
    check('the touching boundary is NOT overlap (half-open): O relocated to start exactly where P ends, and P touching an unmoved non-owner, are both valid -> ACCEPT', decide(SIMPLE, { p: { s: '10:30', fit: 'GOOD' }, relocated: { O: { s: '11:30', fit: 'GOOD' } } }) === 'ACCEPT' && decide({ ...SIMPLE, baseline: [{ id: 'O', s: '12:00', fit: 'GOOD' }, { id: 'N', s: '10:30', fit: 'BEST' }] }, { p: { s: '11:30', fit: 'GOOD' }, relocated: { O: { s: '14:00', fit: 'GOOD' } } }) === 'ACCEPT');
  }

  // ======================================================================
  console.log('=== Part 2: the structural boundary -- an untrustworthy structure is UNAVAILABLE, never a policy REJECT ===');
  {
    const U = (edit: (m: Mutable) => void, plan: Plan = OK, w: World = SIMPLE) => decide(w, plan, edit);
    const baseIn = input(SIMPLE, OK);
    const R = (i: CounterfactualAcceptanceInput) => verdict(evaluateCounterfactualAcceptance(i));
    check('RUN NOT READY: the basis or the baseline placements not READY -> UNAVAILABLE / RUN_NOT_READY', R({ ...baseIn, constructionBasis: { status: 'UNAVAILABLE', reason: 'ASSEMBLY_FAILED' } }) === 'UNAVAILABLE:RUN_NOT_READY' && R({ ...baseIn, baselinePlacements: { status: 'UNAVAILABLE', reason: 'CAPTURE_FAILED' } }) === 'UNAVAILABLE:RUN_NOT_READY');
    check('AUTHORITIES MUST AGREE: the counterfactual\'s candidate differs from the PromotionInput\'s; P present in the BASELINE; an unknown or non-placed owner; duplicate owners; the candidate listed as an owner -> UNAVAILABLE / INCONSISTENT_AUTHORITY', U((m) => { m.candidate = 'N'; }) === 'UNAVAILABLE:INCONSISTENT_AUTHORITY' && decide({ ...SIMPLE, baseline: [...SIMPLE.baseline, { id: 'P', s: '15:30', fit: 'GOOD' }] }, OK) === 'UNAVAILABLE:INCONSISTENT_AUTHORITY' && decide({ ...SIMPLE, owners: ['ZZ'] }, OK) === 'UNAVAILABLE:INCONSISTENT_AUTHORITY' && decide({ ...SIMPLE, intents: [...SIMPLE.intents, { id: 'D' }], owners: ['O', 'D'] }, OK) === 'UNAVAILABLE:INCONSISTENT_AUTHORITY' && decide({ ...SIMPLE, owners: ['O', 'O'] }, OK) === 'UNAVAILABLE:INCONSISTENT_AUTHORITY' && decide({ ...SIMPLE, owners: ['P'] }, OK) === 'UNAVAILABLE:INCONSISTENT_AUTHORITY');
    check('A SILENT SHIFT that stays valid (a non-owner moved 30 minutes, still BASELINE_UNCHANGED, no overlap, same duration) is a contradiction, not a policy question -> UNAVAILABLE / COUNTERFACTUAL_INVALID', U((m) => { m.placements = m.placements.map((p) => (p.intentId === 'N' ? { ...p, start: T('13:30'), end: T('14:30') } : p)); }) === 'UNAVAILABLE:COUNTERFACTUAL_INVALID');
    check('P MISSING / DUPLICATED / WRONG SOURCE -> UNAVAILABLE / COUNTERFACTUAL_INVALID', U((m) => { m.placements = m.placements.filter((p) => p.intentId !== 'P'); }) === 'UNAVAILABLE:COUNTERFACTUAL_INVALID' && U((m) => { m.placements = [...m.placements, { ...m.promoted, start: T('16:00'), end: T('17:00') }]; }) === 'UNAVAILABLE:COUNTERFACTUAL_INVALID' && U((m) => { m.placements = m.placements.map((p) => (p.intentId === 'P' ? { ...p, placementSource: 'BASELINE_UNCHANGED' as const } : p)); }) === 'UNAVAILABLE:COUNTERFACTUAL_INVALID' && U((m) => { m.promoted = { ...m.promoted, start: T('11:00'), end: T('12:00') }; }) === 'UNAVAILABLE:COUNTERFACTUAL_INVALID');
    check('EXTRA INTENT (pinned): a placement for an intent that is neither in the baseline nor P -- an unknown id or a Deferred intent that "became placed" -- is a contradiction of the counterfactual\'s own scope -> UNAVAILABLE / COUNTERFACTUAL_INVALID (not a policy reject)', U((m) => { m.placements = [...m.placements, row(SIMPLE, 'Z', '15:00', 'BASELINE_UNCHANGED', 'GOOD')]; }, OK, { ...SIMPLE, intents: [...SIMPLE.intents, { id: 'Z' }] }) === 'UNAVAILABLE:COUNTERFACTUAL_INVALID' && U((m) => { m.placements = [...m.placements, row(SIMPLE, 'ZZ', '15:00', 'RELOCATED_CAPTURED_CANDIDATE', 'GOOD')]; }) === 'UNAVAILABLE:COUNTERFACTUAL_INVALID');
    check('A "PROMOTION" THAT DISPLACES NOBODY (P in free time, nothing declared displaced) is not a promotion counterfactual -- the baseline could have placed it, and the pair may not share a run -> UNAVAILABLE / COUNTERFACTUAL_INVALID', decide(SIMPLE, { p: { s: '14:00', fit: 'GOOD' } }) === 'UNAVAILABLE:COUNTERFACTUAL_INVALID');
    check('DUPLICATE PLACEMENT, OVERLAPPING RESULT, OUTSIDE WINDOW, BLOCKER CONFLICT, WRONG DURATION -> UNAVAILABLE / COUNTERFACTUAL_INVALID', U((m) => { m.placements = [...m.placements, m.placements[1]]; }) === 'UNAVAILABLE:COUNTERFACTUAL_INVALID' && decide(SIMPLE, { p: { s: '13:30', fit: 'GOOD' }, relocated: OK.relocated }) === 'UNAVAILABLE:COUNTERFACTUAL_INVALID' && decide(SIMPLE, { p: { s: '10:30', fit: 'GOOD' }, relocated: { O: { s: '16:30', fit: 'GOOD' } } }) === 'UNAVAILABLE:COUNTERFACTUAL_INVALID' && decide({ ...SIMPLE, blockers: [['15:30', '15:45']] }, OK) === 'UNAVAILABLE:COUNTERFACTUAL_INVALID' && U((m) => { m.placements = m.placements.map((p) => (p.intentId === 'O' ? { ...p, end: plus('15:00', 90) } : p)); m.relocated = m.relocated.map((p) => ({ ...p, end: plus('15:00', 90) })); }) === 'UNAVAILABLE:COUNTERFACTUAL_INVALID');
    check('A NON-POSITIVE blocker is ignored exactly as the Constructor ignores it; a blocker that merely TOUCHES a placement is not a conflict', decide({ ...SIMPLE, blockers: [['15:00', '15:00'], ['16:00', '16:30']] }, OK) === 'ACCEPT');
    check('SILENT CHANGES are contradictions, not policy: a non-owner moved while labelled BASELINE_UNCHANGED, a FIXED placement silently moved, a baseline placement silently dropped, a displaced owner not declared -> UNAVAILABLE / COUNTERFACTUAL_INVALID', U((m) => { m.placements = m.placements.map((p) => (p.intentId === 'N' ? { ...p, start: T('15:30'), end: T('16:30') } : p)); }) === 'UNAVAILABLE:COUNTERFACTUAL_INVALID' && decide({ intents: [{ id: 'F', fixed: true }, { id: 'N' }, { id: 'P' }, { id: 'O' }], baseline: [{ id: 'F', s: '10:00', fixed: true }, { id: 'O', s: '12:00', fit: 'GOOD' }, { id: 'N', s: '13:00', fit: 'BEST' }], owners: ['F', 'O'] }, { p: { s: '12:30', fit: 'GOOD' }, relocated: { O: { s: '15:00', fit: 'GOOD' } } }, (m) => { m.placements = m.placements.map((p) => (p.intentId === 'F' ? { ...p, start: T('15:30'), end: T('16:30') } : p)); }) === 'UNAVAILABLE:COUNTERFACTUAL_INVALID' && U((m) => { m.placements = m.placements.filter((p) => p.intentId !== 'N'); }) === 'UNAVAILABLE:COUNTERFACTUAL_INVALID' && U((m) => { m.displaced = []; }) === 'UNAVAILABLE:COUNTERFACTUAL_INVALID');
    check('DECLARED CHANGE LISTS must agree with the placements: relocated not displaced, unplaced AND relocated, an unplaced owner still placed, displaced duplicated, a relocated entry that disagrees with its placement -> UNAVAILABLE / COUNTERFACTUAL_INVALID', U((m) => { m.displaced = []; m.unplaced = []; }) === 'UNAVAILABLE:COUNTERFACTUAL_INVALID' && U((m) => { m.unplaced = ['O']; }) === 'UNAVAILABLE:COUNTERFACTUAL_INVALID' && U((m) => { m.displaced = ['O', 'O']; }) === 'UNAVAILABLE:COUNTERFACTUAL_INVALID' && U((m) => { m.relocated = [{ ...m.relocated[0], start: T('15:30'), end: T('16:30') }]; }) === 'UNAVAILABLE:COUNTERFACTUAL_INVALID' && U((m) => { m.displaced = ['O', 'ZZ']; }) === 'UNAVAILABLE:COUNTERFACTUAL_INVALID');
    check('NON-FINITE INSTANTS anywhere (the window, a blocker, a baseline placement, a counterfactual placement, the promoted placement) -> UNAVAILABLE / INVALID_INTERVAL', R({ ...baseIn, constructionBasis: { status: 'READY', basis: { ...(baseIn.constructionBasis as unknown as { basis: ConstructionBasis }).basis, window: { ...(baseIn.constructionBasis as unknown as { basis: ConstructionBasis }).basis.window, end: new Date(NaN) } } } }) === 'UNAVAILABLE:INVALID_INTERVAL' && U((m) => { m.placements = m.placements.map((p) => (p.intentId === 'N' ? { ...p, start: new Date(NaN) } : p)); }) === 'UNAVAILABLE:INVALID_INTERVAL' && U((m) => { m.promoted = { ...m.promoted, end: new Date(NaN) }; }) === 'UNAVAILABLE:INVALID_INTERVAL' && R({ ...baseIn, baselinePlacements: { status: 'READY', placements: { placements: [{ ...(baseIn.baselinePlacements as unknown as { placements: { placements: BaselinePlacement[] } }).placements.placements[0], start: new Date(NaN) }] } } }) === 'UNAVAILABLE:INVALID_INTERVAL');
    check('BASELINE PLACEMENTS must be coherent with the basis: duplicate ids, overlapping baseline placements, a placement of an unknown intent, a wrong duration, a FIXED / FLEXIBLE source mismatch -> UNAVAILABLE / INCONSISTENT_AUTHORITY', decide({ ...SIMPLE, baseline: [...SIMPLE.baseline, SIMPLE.baseline[0]] }, OK) === 'UNAVAILABLE:INCONSISTENT_AUTHORITY' && decide({ ...SIMPLE, baseline: [{ id: 'O', s: '10:00', fit: 'GOOD' }, { id: 'N', s: '10:30', fit: 'BEST' }] }, OK) === 'UNAVAILABLE:INCONSISTENT_AUTHORITY' && decide({ ...SIMPLE, baseline: [...SIMPLE.baseline, { id: 'ZZ', s: '15:00', fit: 'GOOD' }] }, OK) === 'UNAVAILABLE:INCONSISTENT_AUTHORITY' && decide({ ...SIMPLE, intents: [{ id: 'O' }, { id: 'N' }, { id: 'P' }].map((i) => (i.id === 'N' ? { ...i, fixed: true } : i)) }, OK) === 'UNAVAILABLE:INCONSISTENT_AUTHORITY');
    const unknownFit = decide({ ...SIMPLE, baseline: [{ id: 'O', s: '10:00', fit: undefined }, SIMPLE.baseline[1]] }, { p: OK.p, relocated: { O: { s: '15:00', fit: 'BEST' } } });
    check('BASELINE TIMING FIT UNKNOWN for a relocated owner -> UNAVAILABLE / BASELINE_TIMING_UNKNOWN (an unknown baseline fit is never treated as safe); an UNKNOWN fit on a non-relocated placement is irrelevant', unknownFit === 'UNAVAILABLE:BASELINE_TIMING_UNKNOWN' && decide({ ...SIMPLE, baseline: [{ id: 'O', s: '10:00', fit: 'GOOD' }, { id: 'N', s: '13:00', fit: undefined }] }, OK) === 'ACCEPT');
    check('the module never throws: a hostile source is UNAVAILABLE / EVALUATION_FAILED', verdict(evaluateCounterfactualAcceptance({ get constructionBasis(): never { throw new Error('boom'); } } as unknown as CounterfactualAcceptanceInput)) === 'UNAVAILABLE:EVALUATION_FAILED');
  }

  // ======================================================================
  console.log('=== Part 3: determinism -- reason precedence, order invariance, pressure and above-pressure parity ===');
  {
    const multi: World = { intents: [{ id: 'F', fixed: true }, { id: 'A' }, { id: 'N' }, { id: 'P' }], baseline: [{ id: 'F', s: '10:00', fixed: true }, { id: 'A', s: '11:00', fit: 'GOOD' }, { id: 'N', s: '12:00', fit: 'BEST' }], owners: ['F', 'A'] };
    // P 10:30-11:30 overlaps F (10:00-11:00) and A (11:00-12:00).
    check('REASON PRECEDENCE: with several violations the reported reason follows the pinned order -- FIXED before unplaced, non-owner before precedence, unplaced before timing, unplaced before the count backstop', decide(multi, { p: { s: '10:30', fit: 'GOOD' }, relocated: { F: { s: '15:00' } }, unplaced: ['A'] }) === 'REJECT:FIXED_PLACEMENT_CHANGED' && decide({ ...SIMPLE, intents: [{ id: 'O', importance: 'HIGH' }, { id: 'N' }, { id: 'P' }] }, { p: { s: '13:30', fit: 'GOOD' }, relocated: { N: { s: '15:00', fit: 'BEST' } } }) === 'REJECT:NON_OWNER_CHANGED' && decide({ ...SIMPLE, intents: [{ id: 'O', importance: 'HIGH' }, { id: 'N' }, { id: 'P' }] }, { p: OK.p, unplaced: ['O'] }) === 'REJECT:PRECEDENCE_NOT_TIE' && decide({ intents: [{ id: 'A' }, { id: 'B' }, { id: 'P' }], baseline: [{ id: 'A', s: '10:00', fit: 'GOOD' }, { id: 'B', s: '11:00', fit: 'GOOD' }], owners: ['A', 'B'] }, { p: { s: '10:30', fit: 'GOOD' }, relocated: { A: { s: '14:00', fit: 'CAUTION' } }, unplaced: ['B'] }) === 'REJECT:OWNER_WOULD_BE_UNPLACED');
    const world: World = { intents: [{ id: 'A' }, { id: 'B' }, { id: 'P' }], baseline: [{ id: 'A', s: '10:00', fit: 'GOOD' }, { id: 'B', s: '11:00', fit: 'GOOD' }, { id: 'N', s: '13:00', fit: 'BEST' }], owners: ['A', 'B'] };
    const w2: World = { ...world, intents: [...world.intents, { id: 'N' }] };
    const plan: Plan = { p: { s: '10:30', fit: 'GOOD' }, relocated: { A: { s: '14:00', fit: 'GOOD' }, B: { s: '15:00', fit: 'CAUTION' } } };
    const base = verdict(evaluateCounterfactualAcceptance(input(w2, plan)));
    let identical = true; let variants = 0;
    const perms = <T,>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest])));
    for (const placementOrder of perms([0, 1, 2, 3])) for (const ownerOrder of perms(['A', 'B'])) {
      variants += 1;
      const i = input({ ...w2, owners: ownerOrder }, plan, (m) => { m.placements = placementOrder.map((k) => m.placements[k]); m.displaced = [...m.displaced].reverse(); m.relocated = [...m.relocated].reverse(); });
      if (verdict(evaluateCounterfactualAcceptance(i)) !== base) identical = false;
    }
    check(`ORDER INVARIANCE: ${variants} permutations of the counterfactual placement order x owner order x displaced / relocated list order give the SAME decision and the SAME reason (${base})`, identical && variants === 48 && base === 'REJECT:OWNER_TIMING_DEGRADED');
    const accept = decide(w2, { p: plan.p, relocated: { A: { s: '14:00', fit: 'GOOD' }, B: { s: '15:00', fit: 'GOOD' } } });
    let acceptIdentical = true;
    for (const placementOrder of perms([0, 1, 2, 3])) { const i = input(w2, { p: plan.p, relocated: { A: { s: '14:00', fit: 'GOOD' }, B: { s: '15:00', fit: 'GOOD' } } }, (m) => { m.placements = placementOrder.map((k) => m.placements[k]); }); if (verdict(evaluateCounterfactualAcceptance(i)) !== 'ACCEPT') acceptIdentical = false; }
    check('an ACCEPT is likewise independent of the placement order', accept === 'ACCEPT' && acceptIdentical);
    // pressure parity: every combination of owner pressure over a reject and an accept
    const combos: Array<Record<string, 'NONE' | 'LAST_KNOWN_OPPORTUNITY'>> = [{ A: 'NONE', B: 'NONE' }, { A: 'NONE', B: 'LAST_KNOWN_OPPORTUNITY' }, { A: 'LAST_KNOWN_OPPORTUNITY', B: 'NONE' }, { A: 'LAST_KNOWN_OPPORTUNITY', B: 'LAST_KNOWN_OPPORTUNITY' }];
    const okPlan: Plan = { p: plan.p, relocated: { A: { s: '14:00', fit: 'GOOD' }, B: { s: '15:00', fit: 'GOOD' } } };
    const lossPlan: Plan = { p: plan.p, relocated: { A: { s: '14:00', fit: 'GOOD' } }, unplaced: ['B'] };
    check('PRESSURE PARITY: over all 4 owner-pressure combinations the ACCEPT stays ACCEPT, the owner-loss stays REJECT OWNER_WOULD_BE_UNPLACED and the timing failure stays REJECT OWNER_TIMING_DEGRADED -- pressure is never read, and NONE is never "safe to lose"', combos.every((c) => decide({ ...w2, pressure: c }, okPlan) === 'ACCEPT' && decide({ ...w2, pressure: c }, lossPlan) === 'REJECT:OWNER_WOULD_BE_UNPLACED' && decide({ ...w2, pressure: c }, plan) === 'REJECT:OWNER_TIMING_DEGRADED'));
    // above-pressure parity with the established primitive over a grid
    const imps = ['HIGH', 'MEDIUM', 'LOW'] as const; const deadlines = [undefined, FRIDAY, '2026-10-10', '2026-10-12'];
    let gridOk = true; let cells = 0; let ties = 0;
    for (const pi of imps) for (const oi of imps) for (const pd of deadlines) for (const od of deadlines) {
      cells += 1;
      const w: World = { ...SIMPLE, intents: [{ id: 'O', importance: oi, deadline: od }, { id: 'N' }, { id: 'P', importance: pi, deadline: pd }] };
      const expectTie = compareAbovePressure(projectAbovePressureFacts({ importance: pi, deadline: pd }), projectAbovePressureFacts({ importance: oi, deadline: od }), FRIDAY) === 'TIE';
      if (expectTie) ties += 1;
      if ((decide(w, OK) === 'ACCEPT') !== expectTie || (!expectTie && decide(w, OK) !== 'REJECT:PRECEDENCE_NOT_TIE')) gridOk = false;
    }
    check(`ABOVE-PRESSURE PARITY: over ${cells} importance x deadline combinations (${ties} ties) the module accepts exactly when the ESTABLISHED P3b / P4a primitive \`compareAbovePressure\` says TIE and otherwise reports PRECEDENCE_NOT_TIE -- the same comparator with originalOrder neutralised, never a second copy`, gridOk && cells === 144 && ties > 0 && ties < cells);
    const frozenInput = input(SIMPLE, OK); const snapshot = JSON.stringify(frozenInput);
    const outcome = evaluateCounterfactualAcceptance(frozenInput);
    check('PURE AND IMMUTABLE: the inputs are byte-identical after evaluation (they are deep-frozen), the decision is a frozen record of strings sharing nothing with the inputs, and repeated calls are byte-equal', JSON.stringify(frozenInput) === snapshot && Object.isFrozen(outcome) && throwsTypeError(() => { (outcome as { status: string }).status = 'x'; }) && [...reachable(outcome)].every((o) => !reachable(frozenInput).has(o)) && Array.from({ length: 10 }, () => JSON.stringify(evaluateCounterfactualAcceptance(frozenInput))).every((j) => j === JSON.stringify(outcome)));
    const realNow = Date.now; let nowCalls = 0; (Date as unknown as { now: () => number }).now = () => { nowCalls += 1; return realNow(); };
    try { evaluateCounterfactualAcceptance(frozenInput); } finally { (Date as unknown as { now: () => number }).now = realNow; }
    check('NO CLOCK: evaluation calls Date.now zero times', nowCalls === 0);
  }

  // ======================================================================
  console.log('=== Part 4: the REAL pipeline -- orchestrator diagnostics -> evidence / pressure -> PromotionInput -> contention -> attempts -> P4b2 -> P4b3 ===');
  type Weekday = AvailabilityConfiguration['periods'][number]['weekday'];
  const workWeek: AvailabilityConfiguration = { configured: true, periods: ([1, 2, 3, 4, 5] as Weekday[]).map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })) };
  const rangeDeps: OpportunityRangeDeps = { loadAvailabilityConfiguration: async () => workWeek, loadPlansOverlappingRange: async () => [] };
  const at = (h: string) => new Date(`${FRIDAY}T${h}:00Z`);
  const iso = (h: string) => `${FRIDAY}T${h}:00.000Z`;
  const TT = (h: string) => new Date(iso(h)).getTime();
  type Label = 'EXCELLENT' | 'GOOD' | 'USABLE' | 'CAUTION';
  interface PoolItem { slot: [string, string]; label: Label }
  const item = (a: string, b: string, label: Label = 'GOOD'): PoolItem => ({ slot: [a, b], label });
  const WEEK_FACTS: DecisionFacts = { recurrence: { period: 'LOCAL_CALENDAR_WEEK', periodStartDate: '2026-10-05', periodEndDate: '2026-10-11', targetPerPeriod: 3, completedInPeriod: 0, committedInPeriod: 0, remainingInPeriod: 3 } };
  const req = (id: string, order: number, over: Partial<RequestedDayIntent> = {}): RequestedDayIntent => ({ id, title: id, flexibility: 'FLEXIBLE', durationMinutes: 60, originalOrder: order, ...over } as RequestedDayIntent);
  const request = (intents: RequestedDayIntent[], pressured: string[]): ConstructDayRequest => ({ targetDate: FRIDAY, timezone: 'UTC', constructionWindowSource: 'EXPLICIT_RANGE', now: at('09:00'), explicitStart: at('09:00'), explicitEnd: at('17:00'), intents, decisionFactsByIntentId: new Map(pressured.map((id) => [id, WEEK_FACTS] as [string, DecisionFacts])) });
  function mkDeps(pools: Record<string, PoolItem[]>, limit: number, blockers: Array<{ start: Date; end: Date; status: 'UPCOMING' }> = []): DayConstructorOrchestratorDeps {
    return {
      loadBlockingPlans: async () => blockers,
      loadDurationContext: async () => ({ preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} }),
      searchTiming: (r: any) => {
        const id = r.taskTitle as string;
        const out = (pools[id] ?? []).filter((p) => !(r.excludedIntervals ?? []).some((e: { start: Date; end: Date }) => TT(p.slot[0]) < e.end.getTime() && e.start.getTime() < TT(p.slot[1]))).slice(0, limit);
        const candidates: TimingCandidate[] = out.map((p) => ({ start: iso(p.slot[0]), end: iso(p.slot[1]), score: 5, label: p.label, muhurtaScore: 0, reasons: [], metadata: { windowType: 'NEUTRAL', windowLabel: 'x', activityType: 'x', dateLabel: FRIDAY } }));
        return { candidates };
      },
      loadAvailabilityConfiguration: async () => ({ configured: false, periods: [] }),
      prepareDecisionFacts: createDecisionFactPreparer(rangeDeps),
    };
  }
  const realRun = async (intents: RequestedDayIntent[], pressured: string[], pools: Record<string, PoolItem[]>, limit: number, blockers: Array<{ start: Date; end: Date; status: 'UPCOMING' }> = []) => {
    const prepared = await preparePromotionInputs(request(intents, pressured), mkDeps(pools, limit, blockers));
    if (prepared.run.status !== 'PREPARED') throw new Error('run not prepared');
    const run = prepared.run;
    return { prepared, run, pairs: run.promotions.map((pair) => {
      const generated = generateLocalCounterfactual({ constructionBasis: run.constructionBasis, baselinePlacements: run.baselinePlacements, schedulingAttempts: run.schedulingAttempts, input: pair.input, contention: pair.contention });
      return { pair, generated, accept: generated.status === 'READY' ? evaluateCounterfactualAcceptance({ constructionBasis: run.constructionBasis, baselinePlacements: run.baselinePlacements, promotionInput: pair.input, counterfactual: generated.counterfactual }) : undefined };
    }) };
  };
  {
    // REAL ACCEPT: O baseline 10:00 GOOD has a GOOD alternative at 15:00 in its candidate list; P's only candidate is 10:30.
    const pools = { O: [item('10:00', '11:00'), item('15:00', '16:00')], P: [item('10:30', '11:30')] };
    const intents = [req('O', 0), req('P', 1)];
    const plain = await orchestrateConstructDay(request(intents, ['O', 'P']), mkDeps(pools, 3));
    const { prepared, pairs } = await realRun(intents, ['O', 'P'], pools, 3);
    const before = JSON.stringify(prepared.result);
    const first = pairs[0];
    check('REAL ACCEPT: real orchestrator -> evidence / pressure -> PromotionInput -> contention -> attempts -> P4b2 generates P@10:30 with O relocated to 15:00 (GOOD, the same fit) -> P4b3 ACCEPTs (no handcrafted authority anywhere)', pairs.length === 1 && first.generated.status === 'READY' && first.generated.counterfactual.relocatedPlacements.map((p) => `${p.intentId}@${p.start.toISOString().slice(11, 16)}:${p.timingFit}`).join() === 'O@15:00:GOOD' && first.accept?.status === 'ACCEPT');
    const { prepared: p2, pairs: pairs2 } = await realRun(intents, ['O', 'P'], pools, 3);
    check('BASELINE PARITY: the Constructor result is byte-identical before / after the decision, equals a plain orchestration, and the signed preview body is byte-identical (P4b3 is not wired); evaluating again changes nothing', JSON.stringify(prepared.result) === before && JSON.stringify(prepared.result) === JSON.stringify(plain) && JSON.stringify(signPreviewResultBody('u', prepared.result as unknown as Record<string, unknown>)) === JSON.stringify(signPreviewResultBody('u', plain as unknown as Record<string, unknown>)) && JSON.stringify(signPreviewResultBody('u', plain as unknown as Record<string, unknown>)).includes('acceptanceToken') && JSON.stringify(pairs2[0].accept) === JSON.stringify(first.accept) && JSON.stringify(p2.result) === before);
    // REAL REJECT: the directed #212 case -- Y has no usable alternative and is left unplaced.
    const dpools = { X: [item('13:00', '14:00')], Y: [item('13:00', '14:00'), item('10:00', '11:00')], O: [item('13:30', '14:30'), item('09:30', '10:30'), item('11:00', '12:00')], P: [item('13:30', '14:30'), item('10:30', '11:30'), item('11:30', '12:30')] };
    const rejectRun = await realRun([req('X', 0), req('Y', 1), req('O', 2), req('P', 3)], ['X', 'Y', 'O', 'P'], dpools, 1);
    const rr = rejectRun.pairs[0];
    check('REAL REJECT: the real counterfactual relocates O (attempt-only 09:30) but leaves Y unplaced -> P4b3 REJECTs OWNER_WOULD_BE_UNPLACED (all owners were pressured: LAST_KNOWN_OPPORTUNITY does not make loss acceptable)', rr.generated.status === 'READY' && rr.generated.counterfactual.unplacedOwnerIds.join() === 'Y' && rr.accept?.status === 'REJECT' && (rr.accept as { reason: string }).reason === 'OWNER_WOULD_BE_UNPLACED');
    const noPressure = await realRun([req('X', 0), req('Y', 1), req('O', 2), req('P', 3)], ['P'], dpools, 1);
    check('REAL NONE FIXTURE: with only P pressured the owners are NONE -- the same unplaced owner is still REJECTed (NONE is not "safe to defer"), and the decision is byte-identical to the all-pressured run', noPressure.prepared.promotion.status === 'PREPARED' && noPressure.prepared.promotion.inputs[0].owners.every((o) => o.pressure === 'NONE') && JSON.stringify(noPressure.pairs[0].accept) === JSON.stringify(rr.accept));
  }

  // ======================================================================
  console.log('=== Part 5: diagnostics-only INCIDENCE over real generated counterfactuals (reported honestly; never used to tune the policy) ===');
  {
    let seed = 20261007; const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
    const slotsUpTo = (last: number) => { const out: Array<[string, string]> = []; for (let t = 9 * 60; t <= last * 60; t += 30) { const e = t + 60; const f = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; out.push([f(t), f(e)]); } return out; };
    const LABELS: Label[] = ['EXCELLENT', 'GOOD', 'USABLE', 'CAUTION'];
    const reasons: Record<string, number> = {}; const tally = { runs: 0, pairs: 0, generated: 0, notGenerated: 0, evaluated: 0, accept: 0, pressureMismatch: 0, nonDeterministic: 0, unavailable: 0 };
    for (let n = 0; n < 700; n += 1) {
      const k = 3 + Math.floor(rnd() * 4); const ids = ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, k); const limit = 1 + Math.floor(rnd() * 3);
      const SLOTS = slotsUpTo(n % 2 === 0 ? 13 : 15);
      const pools: Record<string, PoolItem[]> = {}; ids.forEach((id) => { const sub = SLOTS.filter(() => rnd() < 0.65).map((slot) => ({ slot, label: LABELS[Math.floor(rnd() * 4)] } as PoolItem)); rankedShuffle(sub, rnd, (p) => LABELS.indexOf(p.label)); pools[id] = sub; });
      if (n % 3 === 0) {
        const m = 1 + Math.floor(rnd() * 3); const bs = ['09:00', '11:00', '13:00'].slice(0, m); ids.length = 0; bs.forEach((_, i) => ids.push(['A', 'B', 'C'][i])); ids.push('P');
        const hh = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
        const win = (s: number): [string, string] => [hh(s), hh(s + 60)];
        bs.forEach((b, i) => { const bm = Number(b.slice(0, 2)) * 60; const extra = SLOTS.filter(() => rnd() < 0.3).slice(0, 3).map((slot) => ({ slot, label: LABELS[Math.floor(rnd() * 4)] })); pools[ids[i]] = [{ slot: win(bm), label: 'EXCELLENT' as Label }, ...extra]; });
        pools.P = rankedShuffle(bs.flatMap((b) => { const bm = Number(b.slice(0, 2)) * 60; return [bm + 30, bm, bm - 30].filter((x) => x >= 9 * 60 && x <= 15 * 60 && rnd() < 0.7).map((x) => ({ slot: win(x), label: LABELS[Math.floor(rnd() * 4)] })); }), rnd, (p) => LABELS.indexOf(p.label));
      }
      const intents = ids.map((id, i) => req(id, i));
      const { prepared, pairs } = await realRun(intents, ids, pools, limit);
      tally.runs += 1;
      if (prepared.result.status !== 'READY') continue;
      for (const { pair, generated, accept } of pairs) {
        tally.pairs += 1;
        if (generated.status !== 'READY' || !accept) { tally.notGenerated += 1; continue; }
        tally.generated += 1; tally.evaluated += 1;
        const key = accept.status === 'ACCEPT' ? 'ACCEPT' : `${accept.status}:${accept.reason}`;
        reasons[key] = (reasons[key] ?? 0) + 1; if (accept.status === 'ACCEPT') tally.accept += 1; if (accept.status === 'UNAVAILABLE') tally.unavailable += 1;
        const run = prepared.run as Extract<typeof prepared.run, { status: 'PREPARED' }>;
        const flipped: PromotionInput = { candidateIntentId: pair.input.candidateIntentId, owners: pair.input.owners.map((o) => ({ intentId: o.intentId, pressure: o.pressure === 'NONE' ? 'LAST_KNOWN_OPPORTUNITY' : 'NONE' })) };
        const again = evaluateCounterfactualAcceptance({ constructionBasis: run.constructionBasis, baselinePlacements: run.baselinePlacements, promotionInput: flipped, counterfactual: generated.counterfactual });
        if (JSON.stringify(again) !== JSON.stringify(accept)) tally.pressureMismatch += 1;
        if (JSON.stringify(evaluateCounterfactualAcceptance({ constructionBasis: run.constructionBasis, baselinePlacements: run.baselinePlacements, promotionInput: pair.input, counterfactual: generated.counterfactual })) !== JSON.stringify(accept)) tally.nonDeterministic += 1;
      }
    }
    console.log(`     incidence: ${JSON.stringify(tally)} reasons: ${JSON.stringify(reasons)}`);
    check(`INCIDENCE (diagnostics only): of ${tally.generated} real P4b2 counterfactuals (${tally.runs} deterministic runs, ${tally.pairs} promotion pairs, ${tally.notGenerated} without an actionable slot), ACCEPT = ${tally.accept}; REJECT / UNAVAILABLE by reason: ${JSON.stringify(reasons)} -- reported as measured, never used to tune the policy`, tally.generated > 300 && tally.evaluated === tally.generated);
    check('AUTHORITATIVE, ENGINE-INDEPENDENT INCIDENCE (O5 P4b5: seeded Fisher-Yates + a pure comparator replaced the random sort comparator): 700 runs, 452 pairs, 444 generated, 8 without an actionable slot; 23 ACCEPT + 372 OWNER_WOULD_BE_UNPLACED + 49 OWNER_TIMING_DEGRADED = 444; 0 UNAVAILABLE -- identical on every supported Node', tally.runs === 700 && tally.pairs === 452 && tally.generated === 444 && tally.notGenerated === 8 && tally.accept === 23 && reasons['REJECT:OWNER_WOULD_BE_UNPLACED'] === 372 && reasons['REJECT:OWNER_TIMING_DEGRADED'] === 49 && Object.keys(reasons).length === 3 && tally.unavailable === 0);
    check('REAL COUNTERFACTUALS ARE STRUCTURALLY TRUSTWORTHY: zero UNAVAILABLE decisions over every real generated counterfactual (P4b2 output always satisfies the structural contract P4b3 revalidates)', tally.unavailable === 0);
    check('the V1 policy is REACHABLE on real contracts: real ACCEPTs and real REJECTs both occur (and ACCEPT / REJECT are the only decisions)', tally.accept > 0 && Object.keys(reasons).some((r) => r.startsWith('REJECT')) && Object.keys(reasons).every((r) => r === 'ACCEPT' || r.startsWith('REJECT:')));
    check('every real decision is unchanged by flipping every owner pressure and by repetition (zero differences)', tally.pressureMismatch === 0 && tally.nonDeterministic === 0);
  }

  if (!allPassed) { console.error('SOME COUNTERFACTUAL ACCEPTANCE CHECKS FAILED'); process.exitCode = 1; return; }
  console.log('ALL COUNTERFACTUAL ACCEPTANCE CHECKS PASSED');
})().then(() => process.exit(), (err) => { console.error(err); process.exit(1); });
