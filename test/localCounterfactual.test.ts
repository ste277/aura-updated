/**
 * Constructor Decision Intelligence -- O5 P4b2: the PURE SCOPE-ISOLATED LOCAL COUNTERFACTUAL GENERATOR (pure behavior, no DB).
 *
 * The generator answers ONE mechanical question -- "what happens if this pressured candidate P is tried in one of its real historical contention
 * slots while every unrelated baseline placement stays pinned?" -- and never whether that is acceptable (P4b3). Part 1 pins the revalidation of the
 * five same-run authorities. Part 2 pins P-slot semantics (contention authority only, comparator ranking, shuffled-order invariance, terminal-overlap
 * scope, non-owner / FIXED / zero-overlap handling, alternate slots). Part 3 pins owner relocation (initial UNION final UNION attempts, dedup, origin
 * neutrality, overload-precedence order, no transitive displacement, unplaceable owners, pressure parity). Part 4 pins ownership, freezing,
 * determinism and independence. Part 5 runs the REAL pipeline (orchestrator diagnostics -> evidence / pressure -> promotion preparation ->
 * contention -> scheduling attempts -> generator) with no handcrafted generator input, and requires the baseline result and signed token unchanged.
 * Part 6 is a deterministic property sweep over real runs against an independent FULL-HISTORY oracle.
 *
 * Date caveat, stated honestly: `Object.freeze` does not stop a Date setter changing a Date's internal time. Safety is OWNERSHIP plus the #208
 * no-Date-mutator guard. Product / architecture invariants only: no timing, randomness, heap layout or query plan.
 */
import { generateLocalCounterfactual, type LocalCounterfactual, type LocalCounterfactualAuthorities, type LocalCounterfactualOutcome, type CounterfactualPlacement } from '../apps/web/lib/localCounterfactual';
import { compareCandidatesForPlacement, type PlacementCandidate, type PlacementTimingFit } from '../apps/web/lib/dayConstructor';
import { compareByOverloadPrecedence } from '../apps/web/lib/dayIntent';
import type { ConstructionBasis, ConstructionBasisOutcome } from '../apps/web/lib/constructionBasis';
import type { BaselinePlacement, BaselinePlacementsOutcome } from '../apps/web/lib/baselinePlacements';
import type { SchedulingAttempt, SchedulingAttemptOutcome } from '../apps/web/lib/schedulingAttemptAuthority';
import type { PromotionContentionOutcome } from '../apps/web/lib/promotionContentionAuthority';
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
const hhmm = (d: Date | number) => new Date(d).toISOString().slice(11, 16);
const plus = (h: string, minutes: number) => new Date(T(h).getTime() + minutes * 60000);
const reachable = (v: unknown, seen = new Set<unknown>()): Set<unknown> => { if (v !== null && typeof v === 'object' && !seen.has(v)) { seen.add(v); Object.values(v as Record<string, unknown>).forEach((c) => reachable(c, seen)); } return seen; };
const disjoint = (a: Set<unknown>, b: Set<unknown>) => [...a].every((o) => !b.has(o));
const throwsTypeError = (fn: () => void) => { try { fn(); return false; } catch (e) { return e instanceof TypeError; } };
function deepFreeze<T>(v: T): T { if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); Object.values(v as Record<string, unknown>).forEach(deepFreeze); } return v; }

// ---------------------------------------------------------------------------------------------------------------------------------
// Synthetic same-run authorities (the generator revalidates them like any caller's)
// ---------------------------------------------------------------------------------------------------------------------------------
type Fit = PlacementTimingFit | undefined;
interface IntentSpec { id: string; fixed?: boolean; importance?: 'HIGH' | 'MEDIUM' | 'LOW'; minutes?: number; deadline?: string }
interface CandSpec { s: string; e?: string; fit?: Fit }
interface Spec {
  intents: IntentSpec[];
  placements: Array<{ id: string; s: string; e?: string; fit?: Fit; fixed?: boolean }>;
  initial?: Record<string, CandSpec[]>;
  final?: Record<string, CandSpec[]>;
  attempts?: Array<{ id: string; s: string; e?: string; fit?: Fit; owners?: string[] }>;
  blockers?: Array<[string, string]>;
  candidate: string;
  owners: string[];
  pressure?: Record<string, 'NONE' | 'LAST_KNOWN_OPPORTUNITY'>;
  slots: Array<{ owner: string; s: string; e?: string; fit?: Fit }>;
}
const endOf = (s: string, e: string | undefined, minutes = 60) => (e ? T(e) : plus(s, minutes));
function build(spec: Spec): LocalCounterfactualAuthorities {
  const minutesOf = (id: string) => spec.intents.find((i) => i.id === id)?.minutes ?? 60;
  const basis: ConstructionBasis = {
    planningDate: FRIDAY,
    window: { date: FRIDAY, timezone: 'UTC', start: T('09:00'), end: T('17:00') },
    intents: spec.intents.map((i, index) => ({ id: i.id, title: i.id, importance: i.importance ?? 'MEDIUM', ...(i.deadline ? { deadline: i.deadline } : {}), estimatedDurationMinutes: i.minutes ?? 60, flexibility: i.fixed ? 'FIXED' : 'FLEXIBLE', originalOrder: index })),
    blockedIntervals: (spec.blockers ?? []).map(([s, e]) => ({ start: T(s), end: T(e), source: 'EXTERNAL' as const })),
    initialCandidates: Object.entries(spec.initial ?? {}).map(([id, list]) => ({ intentId: id, candidates: list.map((c, order) => ({ intentId: id, start: T(c.s), end: endOf(c.s, c.e, minutesOf(id)), ...(c.fit ? { timingFit: c.fit } : {}), candidateOrder: order })) })),
    finalCandidates: Object.entries(spec.final ?? {}).map(([id, list]) => ({ intentId: id, candidates: list.map((c, order) => ({ intentId: id, start: T(c.s), end: endOf(c.s, c.e, minutesOf(id)), ...(c.fit ? { timingFit: c.fit } : {}), candidateOrder: order })) })),
    fixedConstraints: spec.placements.filter((p) => p.fixed).map((p) => ({ intentId: p.id, constraints: [{ intentId: p.id, start: T(p.s), end: endOf(p.s, p.e) }] })),
  };
  const placements: BaselinePlacement[] = spec.placements.map((p) => ({ intentId: p.id, start: T(p.s), end: endOf(p.s, p.e, minutesOf(p.id)), placementSource: p.fixed ? 'FIXED_CONSTRAINT' : 'SELECTED_CANDIDATE', ...(p.fixed ? {} : { timingFit: p.fit, candidateOrder: 0 }) } as BaselinePlacement));
  const attempts: SchedulingAttempt[] = (spec.attempts ?? []).map((a) => ({ intentId: a.id, start: T(a.s), end: endOf(a.s, a.e, minutesOf(a.id)), ...(a.fit ? { timingFit: a.fit } : {}), conflictingOwnerIds: a.owners ?? [] }));
  const input: PromotionInput = { candidateIntentId: spec.candidate, owners: spec.owners.map((id) => ({ intentId: id, pressure: spec.pressure?.[id] ?? 'NONE' })) };
  const contention: PromotionContentionOutcome = { status: 'READY', authority: { candidateIntentId: spec.candidate, attempts: spec.slots.map((s) => ({ ownerIntentId: s.owner, start: T(s.s), end: endOf(s.s, s.e, minutesOf(spec.candidate)), ...(s.fit ? { timingFit: s.fit } : {}) })) } };
  return deepFreeze({
    constructionBasis: { status: 'READY', basis } as ConstructionBasisOutcome,
    baselinePlacements: { status: 'READY', placements: { placements } } as BaselinePlacementsOutcome,
    schedulingAttempts: { status: 'READY', authority: { attempts } } as SchedulingAttemptOutcome,
    input,
    contention,
  });
}
const ready = (o: LocalCounterfactualOutcome): LocalCounterfactual => { if (o.status !== 'READY') throw new Error(`UNAVAILABLE ${o.reason}`); return o.counterfactual; };
const reasonOf = (o: LocalCounterfactualOutcome) => (o.status === 'UNAVAILABLE' ? o.reason : 'READY');
const sh = (p: CounterfactualPlacement) => `${p.intentId}@${hhmm(p.start)}-${hhmm(p.end)}:${p.placementSource === 'BASELINE_UNCHANGED' ? 'B' : p.placementSource === 'PROMOTED_CONTENTION_ATTEMPT' ? 'P' : 'R'}:${p.timingFit ?? '-'}`;
const all = (c: LocalCounterfactual) => c.counterfactualPlacements.map(sh).join(' ');
const withAuth = (a: LocalCounterfactualAuthorities, over: Partial<LocalCounterfactualAuthorities>): LocalCounterfactualAuthorities => ({ ...a, ...over });

// the simple case: P's slot 10:30-11:30 overlaps only O (10:00-11:00); O has a final alternative at 15:00; N (non-owner) sits at 13:00.
const SIMPLE: Spec = {
  intents: [{ id: 'O' }, { id: 'N' }, { id: 'P' }],
  placements: [{ id: 'O', s: '10:00', fit: 'GOOD' }, { id: 'N', s: '13:00', fit: 'BEST' }],
  initial: { O: [{ s: '10:00', fit: 'GOOD' }], N: [{ s: '13:00', fit: 'BEST' }], P: [{ s: '10:30', fit: 'GOOD' }] },
  final: { O: [{ s: '10:00', fit: 'GOOD' }, { s: '15:00', fit: 'GOOD' }], N: [{ s: '13:00', fit: 'BEST' }] },
  candidate: 'P', owners: ['O'],
  slots: [{ owner: 'O', s: '10:30', fit: 'GOOD' }],
};

(async () => {
  // ======================================================================
  console.log('=== Part 1: revalidating the five same-run authorities (validation only: nothing repaired, dropped or invented) ===');
  {
    const base = build(SIMPLE);
    const cf = ready(generateLocalCounterfactual(base));
    check('SANITY: the well-formed context generates READY', cf.candidateIntentId === 'P');
    const R = (a: LocalCounterfactualAuthorities) => reasonOf(generateLocalCounterfactual(a));
    const readyBasis = base.constructionBasis as { status: 'READY'; basis: ConstructionBasis };
    const readyPlacements = base.baselinePlacements as { status: 'READY'; placements: { placements: readonly BaselinePlacement[] } };
    const readyContention = base.contention as { status: 'READY'; authority: { candidateIntentId: string; attempts: readonly { ownerIntentId: string; start: Date; end: Date; timingFit?: PlacementTimingFit }[] } };
    check('EVERY authority must be READY: basis, placements, scheduling attempts or contention UNAVAILABLE -> UNAVAILABLE / RUN_NOT_READY (no partial generation)', R(withAuth(base, { constructionBasis: { status: 'UNAVAILABLE', reason: 'ASSEMBLY_FAILED' } })) === 'RUN_NOT_READY' && R(withAuth(base, { baselinePlacements: { status: 'UNAVAILABLE', reason: 'CAPTURE_FAILED' } })) === 'RUN_NOT_READY' && R(withAuth(base, { schedulingAttempts: { status: 'UNAVAILABLE', reason: 'CAPTURE_FAILED' } })) === 'RUN_NOT_READY' && R(withAuth(base, { contention: { status: 'UNAVAILABLE', reason: 'NO_MATCHING_CONTENTION' } })) === 'RUN_NOT_READY');
    check('READY attempts with `[]` is VALID (no contention attempts), not a failure: owner relocation still works from the basis candidates', ready(generateLocalCounterfactual(base)).relocatedPlacements.map(sh).join() === 'O@15:00-16:00:R:GOOD' && (base.schedulingAttempts as { status: string; authority: { attempts: unknown[] } }).authority.attempts.length === 0);
    check('PAIR CONSISTENCY: the contention authority\'s candidate must equal the PromotionInput\'s candidate -> INCONSISTENT_AUTHORITY', R(withAuth(base, { contention: { status: 'READY', authority: { ...readyContention.authority, candidateIntentId: 'N' } } })) === 'INCONSISTENT_AUTHORITY');
    check('CANDIDATE: must exist exactly once in the basis; a Deferred baseline candidate (no placement); a duplicate intent id anywhere in the basis fails closed', R(withAuth(base, { input: { candidateIntentId: 'ZZ', owners: base.input.owners }, contention: { status: 'READY', authority: { ...readyContention.authority, candidateIntentId: 'ZZ' } } })) === 'INCONSISTENT_AUTHORITY' && R(build({ ...SIMPLE, placements: [...SIMPLE.placements, { id: 'P', s: '15:30' }] })) === 'INCONSISTENT_AUTHORITY' && R(withAuth(base, { constructionBasis: { status: 'READY', basis: { ...readyBasis.basis, intents: [...readyBasis.basis.intents, readyBasis.basis.intents[0]] } } })) === 'INCONSISTENT_AUTHORITY');
    check('OWNERS: distinct, in the basis, holding a baseline placement, and never the candidate; an empty owner list fails closed', R(build({ ...SIMPLE, owners: ['O', 'O'] })) === 'INCONSISTENT_AUTHORITY' && R(build({ ...SIMPLE, owners: ['ZZ'] })) === 'INCONSISTENT_AUTHORITY' && R(build({ ...SIMPLE, owners: ['P'] })) === 'INCONSISTENT_AUTHORITY' && R(build({ ...SIMPLE, owners: [] })) === 'INCONSISTENT_AUTHORITY' && R(build({ ...SIMPLE, intents: [...SIMPLE.intents, { id: 'D' }], owners: ['O', 'D'], slots: [...SIMPLE.slots, { owner: 'D', s: '10:30', fit: 'GOOD' }] })) === 'INCONSISTENT_AUTHORITY');
    check('CONTENTION CANNOT EXPAND THE RELEASE SCOPE: a contention owner that PromotionInput did not authorize (even a real placed non-owner) fails closed; an authorized owner with no supporting contention record fails closed', R(build({ ...SIMPLE, slots: [...SIMPLE.slots, { owner: 'N', s: '13:30', fit: 'GOOD' }] })) === 'INCONSISTENT_AUTHORITY' && R(build({ ...SIMPLE, owners: ['O', 'N'] })) === 'INCONSISTENT_AUTHORITY' && R(build({ ...SIMPLE, slots: [] })) === 'INCONSISTENT_AUTHORITY');
    check('PLACEMENTS must still match THIS basis: an unknown id, duplicate placements, overlapping placements, a placement outside the window or on a blocker, a FIXED / FLEXIBLE source mismatch, a wrong duration -> INCONSISTENT_AUTHORITY', R(build({ ...SIMPLE, placements: [...SIMPLE.placements, { id: 'ZZ', s: '15:00' }] })) === 'INCONSISTENT_AUTHORITY' && R(build({ ...SIMPLE, placements: [...SIMPLE.placements, { id: 'N', s: '15:00' }] })) === 'INCONSISTENT_AUTHORITY' && R(build({ ...SIMPLE, placements: [{ id: 'O', s: '10:00', fit: 'GOOD' }, { id: 'N', s: '10:30', fit: 'BEST' }] })) === 'INCONSISTENT_AUTHORITY' && R(build({ ...SIMPLE, placements: [{ id: 'O', s: '08:00', fit: 'GOOD' }, SIMPLE.placements[1]] })) === 'INCONSISTENT_AUTHORITY' && R(build({ ...SIMPLE, blockers: [['10:00', '10:15']] })) === 'INCONSISTENT_AUTHORITY' && R(build({ ...SIMPLE, placements: [{ id: 'O', s: '10:00', fixed: true }, SIMPLE.placements[1]] })) === 'INCONSISTENT_AUTHORITY' && R(build({ ...SIMPLE, placements: [{ id: 'O', s: '10:00', e: '12:00', fit: 'GOOD' }, SIMPLE.placements[1]] })) === 'INCONSISTENT_AUTHORITY');
    check('MALFORMED INSTANTS fail closed -> INVALID_INTERVAL: a non-finite window, blocker, placement, attempt or contention interval; a contention slot whose length is not P\'s resolved duration', R(withAuth(base, { constructionBasis: { status: 'READY', basis: { ...readyBasis.basis, window: { ...readyBasis.basis.window, end: new Date(NaN) } } } })) === 'INVALID_INTERVAL' && R(withAuth(base, { constructionBasis: { status: 'READY', basis: { ...readyBasis.basis, blockedIntervals: [{ start: new Date(NaN), end: T('12:00'), source: 'EXTERNAL' }] } } })) === 'INVALID_INTERVAL' && R(withAuth(base, { baselinePlacements: { status: 'READY', placements: { placements: [{ ...readyPlacements.placements.placements[0], start: new Date(NaN) }, readyPlacements.placements.placements[1]] } } })) === 'INVALID_INTERVAL' && R(withAuth(base, { schedulingAttempts: { status: 'READY', authority: { attempts: [{ intentId: 'O', start: new Date(NaN), end: T('11:00'), conflictingOwnerIds: [] }] } } })) === 'INVALID_INTERVAL' && R(withAuth(base, { contention: { status: 'READY', authority: { ...readyContention.authority, attempts: [{ ownerIntentId: 'O', start: new Date(NaN), end: T('11:30') }] } } })) === 'INVALID_INTERVAL' && R(build({ ...SIMPLE, slots: [{ owner: 'O', s: '10:30', e: '12:00', fit: 'GOOD' }] })) === 'INVALID_INTERVAL');
    check('SCHEDULING ATTEMPTS naming an intent that is not in the basis fail closed (no reconstruction, no repair)', R(build({ ...SIMPLE, attempts: [{ id: 'ZZ', s: '09:30', owners: [] }] })) === 'INCONSISTENT_AUTHORITY' && R(build({ ...SIMPLE, attempts: [{ id: 'O', s: '09:30', owners: ['ZZ'] }] })) === 'INCONSISTENT_AUTHORITY');
    check('the candidate must be FLEXIBLE with a resolved positive duration', R(build({ ...SIMPLE, intents: [{ id: 'O' }, { id: 'N' }, { id: 'P', fixed: true }] })) === 'INCONSISTENT_AUTHORITY' && R(build({ ...SIMPLE, intents: [{ id: 'O' }, { id: 'N' }, { id: 'P', minutes: 0 }] })) !== 'READY');
    check('the UNAVAILABLE taxonomy is generation / integrity only: RUN_NOT_READY, INCONSISTENT_AUTHORITY, INVALID_INTERVAL, NO_ACTIONABLE_PROMOTION_SLOT, GENERATION_FAILED -- no policy term exists', (() => { const reasons = [R(withAuth(base, { constructionBasis: { status: 'UNAVAILABLE', reason: 'ASSEMBLY_FAILED' } })), R(build({ ...SIMPLE, owners: ['ZZ'] })), R(build({ ...SIMPLE, slots: [{ owner: 'O', s: '10:30', e: '12:00' }] })), R(build({ ...SIMPLE, slots: [{ owner: 'O', s: '16:00', fit: 'GOOD' }] }))]; return reasons.join() === 'RUN_NOT_READY,INCONSISTENT_AUTHORITY,INVALID_INTERVAL,NO_ACTIONABLE_PROMOTION_SLOT' && !/PRESSURED|FIXED_OWNER|PRECEDENCE|NON_OWNER|NET_|TIMING_FLOOR|SAFE|ACCEPT|REJECT/.test(reasons.join()); })());
    check('a throwing source is caught (GENERATION_FAILED), never an exception', reasonOf(generateLocalCounterfactual({ get constructionBasis(): never { throw new Error('boom'); } } as unknown as LocalCounterfactualAuthorities)) === 'GENERATION_FAILED');
  }

  // ======================================================================
  console.log('=== Part 2: P\'s slots, terminal-overlap scope, pinned non-owners, FIXED, alternate slots ===');
  {
    const cf = ready(generateLocalCounterfactual(build(SIMPLE)));
    check('SIMPLE CASE: P\'s historical slot overlaps one FLEXIBLE owner O; O has a usable alternative -> P placed at the slot, O relocated (RELOCATED, fit carried), the non-owner N unchanged', all(cf) === 'O@15:00-16:00:R:GOOD N@13:00-14:00:B:BEST P@10:30-11:30:P:GOOD' && cf.displacedOwnerIds.join() === 'O' && cf.unplacedOwnerIds.length === 0 && sh(cf.promotedPlacement) === 'P@10:30-11:30:P:GOOD');
    check('OWNER UNPLACEABLE: O has no alternative -> P is placed, O is simply UNPLACED, the result is a valid READY counterfactual (never a rejection)', (() => { const c = ready(generateLocalCounterfactual(build({ ...SIMPLE, final: { O: [{ s: '10:00', fit: 'GOOD' }] } }))); return all(c) === 'N@13:00-14:00:B:BEST P@10:30-11:30:P:GOOD' && c.unplacedOwnerIds.join() === 'O' && c.relocatedPlacements.length === 0 && c.displacedOwnerIds.join() === 'O'; })());
  }
  {
    // GOOD discovered first, BEST later: the comparator, not discovery order, selects.
    const spec: Spec = {
      intents: [{ id: 'O1' }, { id: 'O2' }, { id: 'P' }],
      placements: [{ id: 'O1', s: '10:00', fit: 'GOOD' }, { id: 'O2', s: '13:00', fit: 'GOOD' }],
      final: { O1: [{ s: '10:00', fit: 'GOOD' }, { s: '15:00', fit: 'GOOD' }], O2: [{ s: '13:00', fit: 'GOOD' }, { s: '15:30', fit: 'GOOD' }] },
      candidate: 'P', owners: ['O1', 'O2'],
      slots: [{ owner: 'O1', s: '10:00', fit: 'GOOD' }, { owner: 'O2', s: '13:00', fit: 'BEST' }, { owner: 'O1', s: '10:30', fit: 'WORKABLE' }],
    };
    const cf = ready(generateLocalCounterfactual(build(spec)));
    check('GOOD / BEST: slots discovered as GOOD@10:00, BEST@13:00, WORKABLE@10:30 -> the Constructor\'s own comparator selects BEST@13:00 (O2 displaced); discovery order is never a ranking', sh(cf.promotedPlacement) === 'P@13:00-14:00:P:BEST' && cf.displacedOwnerIds.join() === 'O2' && all(cf).startsWith('O1@10:00-11:00:B:GOOD'));
    // Shuffled authority: every permutation of the contention attempts, the basis candidate lists and the attempt list gives the SAME bytes.
    const baseBytes = JSON.stringify(generateLocalCounterfactual(build(spec)));
    const perms = <T,>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest])));
    let identical = true; let variants = 0;
    for (const slotOrder of perms(spec.slots)) for (const listOrder of perms(spec.final!.O1)) {
      variants += 1;
      const shuffled: Spec = { ...spec, slots: slotOrder, final: { ...spec.final, O1: listOrder }, attempts: ([{ id: 'O1', s: '09:30', owners: ['O2'] }, { id: 'O1', s: '15:00', fit: 'GOOD' as Fit, owners: [] as string[] }] as NonNullable<Spec['attempts']>).reverse() };
      const orderedAttempts: Spec = { ...shuffled, attempts: [...shuffled.attempts!].reverse() };
      if (JSON.stringify(generateLocalCounterfactual(build(shuffled))) !== JSON.stringify(generateLocalCounterfactual(build(orderedAttempts)))) identical = false;
      if (JSON.stringify(generateLocalCounterfactual(build({ ...spec, slots: slotOrder, final: { ...spec.final, O1: listOrder } }))) !== baseBytes) identical = false;
    }
    check(`SHUFFLED-ORDER INVARIANCE (the behavioral proof the heuristic trace-order guard cannot give): ${variants} permutations of the contention attempts x candidate-list order x scheduling-attempt order yield byte-identical results and the same selected P slot`, identical && variants >= 12);
  }
  {
    const spec: Spec = {
      intents: [{ id: 'O1' }, { id: 'O2' }, { id: 'P' }],
      placements: [{ id: 'O1', s: '10:00', fit: 'GOOD' }, { id: 'O2', s: '11:00', fit: 'GOOD' }],
      final: { O1: [{ s: '10:00', fit: 'GOOD' }, { s: '14:00', fit: 'GOOD' }], O2: [{ s: '11:00', fit: 'GOOD' }, { s: '15:00', fit: 'GOOD' }] },
      candidate: 'P', owners: ['O1', 'O2'],
      slots: [{ owner: 'O1', s: '10:30', fit: 'GOOD' }, { owner: 'O2', s: '10:30', fit: 'GOOD' }],
    };
    const cf = ready(generateLocalCounterfactual(build(spec)));
    check('MULTI-OWNER SAME P SLOT: the slot terminally overlaps O1 and O2 -> both are displaced and re-placed (one slot, two owner relationships)', cf.displacedOwnerIds.join() === 'O1,O2' && all(cf) === 'O1@14:00-15:00:R:GOOD O2@15:00-16:00:R:GOOD P@10:30-11:30:P:GOOD');
    const hist: Spec = { ...spec, placements: [{ id: 'O1', s: '10:00', fit: 'GOOD' }, { id: 'O2', s: '13:00', fit: 'GOOD' }], final: { O1: spec.final!.O1, O2: [{ s: '13:00', fit: 'GOOD' }, { s: '15:00', fit: 'GOOD' }] } };
    const c2 = ready(generateLocalCounterfactual(build(hist)));
    check('HISTORICAL MULTI-OWNER, TERMINAL ONE: the slot\'s history names O1 AND O2, but only O1 terminally overlaps -> only O1 is displaced; O2 stays BYTE-IDENTICALLY pinned (an authorized owner is not released merely because it is authorized)', c2.displacedOwnerIds.join() === 'O1' && all(c2) === 'O1@14:00-15:00:R:GOOD O2@13:00-14:00:B:GOOD P@10:30-11:30:P:GOOD');
    const moved = build({ ...spec, owners: ['O1'], slots: [{ owner: 'O1', s: '10:30', fit: 'GOOD' }], placements: [{ id: 'O1', s: '14:00', fit: 'GOOD' }, { id: 'O2', s: '11:00', fit: 'GOOD' }] });
    check('HISTORICAL OWNER MOVED AWAY / ZERO TERMINAL OWNER: the only historical slot overlaps no authorized terminal owner (it overlaps a NON-owner instead) -> not actionable, and P is never promoted into newly free time', reasonOf(generateLocalCounterfactual(moved)) === 'NO_ACTIONABLE_PROMOTION_SLOT' && reasonOf(generateLocalCounterfactual(build({ ...spec, owners: ['O1'], slots: [{ owner: 'O1', s: '16:00', fit: 'GOOD' }], placements: [{ id: 'O1', s: '10:00', fit: 'GOOD' }, { id: 'O2', s: '11:00', fit: 'GOOD' }] }))) === 'NO_ACTIONABLE_PROMOTION_SLOT');
  }
  {
    // alternate P slot: the best-ranked slot overlaps a pinned NON-owner; the next-ranked valid historical slot is tried.
    const spec: Spec = {
      intents: [{ id: 'O' }, { id: 'N' }, { id: 'P' }],
      placements: [{ id: 'O', s: '10:00', fit: 'GOOD' }, { id: 'N', s: '13:00', fit: 'GOOD' }],
      final: { O: [{ s: '10:00', fit: 'GOOD' }, { s: '15:00', fit: 'GOOD' }] },
      candidate: 'P', owners: ['O'],
      slots: [{ owner: 'O', s: '10:30', fit: 'GOOD' }, { owner: 'O', s: '13:00', fit: 'BEST' }],
    };
    const cf = ready(generateLocalCounterfactual(build(spec)));
    check('NON-OWNER BLOCK + ALTERNATE SLOT: the best-ranked slot (BEST@13:00) overlaps the pinned non-owner N and is unusable -> the next-ranked slot (GOOD@10:30, displacing O) is generated; N is untouched', sh(cf.promotedPlacement) === 'P@10:30-11:30:P:GOOD' && all(cf).includes('N@13:00-14:00:B:GOOD') && cf.displacedOwnerIds.join() === 'O');
    check('ALL P SLOTS UNUSABLE: every slot overlaps a non-owner -> UNAVAILABLE / NO_ACTIONABLE_PROMOTION_SLOT', reasonOf(generateLocalCounterfactual(build({ ...spec, slots: [{ owner: 'O', s: '13:00', fit: 'BEST' }, { owner: 'O', s: '13:30', fit: 'GOOD' }] }))) === 'NO_ACTIONABLE_PROMOTION_SLOT');
    const fixedSpec: Spec = { ...spec, intents: [{ id: 'O', fixed: true }, { id: 'N' }, { id: 'P' }], placements: [{ id: 'O', s: '10:00', fixed: true }, { id: 'N', s: '13:00', fit: 'GOOD' }], final: {}, slots: [{ owner: 'O', s: '10:30', fit: 'GOOD' }] };
    const fixedOutcome = generateLocalCounterfactual(build(fixedSpec));
    check('FIXED OWNER (mechanics only): a slot that would have to move a FIXED authorized owner cannot be generated -> NO_ACTIONABLE_PROMOTION_SLOT; no FIXED_OWNER policy result exists; with another valid slot the FIXED owner is simply never moved', reasonOf(fixedOutcome) === 'NO_ACTIONABLE_PROMOTION_SLOT' && (() => { const two = ready(generateLocalCounterfactual(build({ ...fixedSpec, intents: [{ id: 'O', fixed: true }, { id: 'O2' }, { id: 'N' }, { id: 'P' }], owners: ['O', 'O2'], placements: [{ id: 'O', s: '10:00', fixed: true }, { id: 'O2', s: '14:00', fit: 'GOOD' }, { id: 'N', s: '13:00', fit: 'GOOD' }], final: { O2: [{ s: '14:00', fit: 'GOOD' }, { s: '15:30', fit: 'GOOD' }] }, slots: [{ owner: 'O', s: '10:30', fit: 'BEST' }, { owner: 'O2', s: '14:00', fit: 'GOOD' }] }))); return sh(two.promotedPlacement) === 'P@14:00-15:00:P:GOOD' && all(two).includes('O@10:00-11:00:B:-'); })());
    const blockedSlot = build({ ...spec, blockers: [['10:45', '11:15']], placements: [{ id: 'O', s: '09:30', fit: 'GOOD' }, { id: 'N', s: '13:00', fit: 'GOOD' }], slots: [{ owner: 'O', s: '10:30', fit: 'BEST' }, { owner: 'O', s: '09:30', fit: 'GOOD' }] });
    check('EXTERNAL BLOCKER / WINDOW: a slot that overlaps an external blocker or lies outside the window is mechanically unusable and skipped (the next slot is tried)', sh(ready(generateLocalCounterfactual(blockedSlot)).promotedPlacement) === 'P@09:30-10:30:P:GOOD' && reasonOf(generateLocalCounterfactual(build({ ...spec, slots: [{ owner: 'O', s: '08:30', fit: 'GOOD' }] }))) === 'NO_ACTIONABLE_PROMOTION_SLOT');
    check('NO POLICY LABELS: nothing in a READY or UNAVAILABLE outcome names SAFE / UNSAFE / ACCEPT / REJECT / OWNER_PRESSURED / FIXED_OWNER / NET_PROPOSED_LOSS / TIMING_FLOOR / NON_OWNER_CHANGED', !/SAFE|ACCEPT|REJECT|OWNER_PRESSURED|FIXED_OWNER|NET_PROPOSED|TIMING_FLOOR|NON_OWNER_CHANGED|PRECEDENCE_NOT_TIE/.test(JSON.stringify([cf, fixedOutcome, generateLocalCounterfactual(build({ ...spec, slots: [{ owner: 'O', s: '13:00', fit: 'BEST' }] }))])));
  }

  // ======================================================================
  console.log('=== Part 3: owner relocation (initial UNION final UNION attempts), neutral order, no transitive displacement ===');
  {
    const base: Spec = { ...SIMPLE, initial: { O: [{ s: '10:00', fit: 'GOOD' }, { s: '14:00', fit: 'WORKABLE' }] }, final: { O: [{ s: '10:00', fit: 'GOOD' }] } };
    check('INITIAL-ONLY OWNER (B@11:30-style): the alternative exists only in the INITIAL list -> relocation succeeds from the initial list', all(ready(generateLocalCounterfactual(build(base)))).includes('O@14:00-15:00:R:WORKABLE'));
    check('FINAL OWNER ALTERNATIVE: the alternative exists only in the FINAL list -> relocation succeeds from the final list', all(ready(generateLocalCounterfactual(build(SIMPLE)))).includes('O@15:00-16:00:R:GOOD'));
    const attemptOnly: Spec = { ...SIMPLE, initial: { O: [{ s: '10:00', fit: 'GOOD' }] }, final: { O: [{ s: '10:00', fit: 'GOOD' }] }, attempts: [{ id: 'O', s: '09:30', fit: 'GOOD', owners: ['Y'] }], intents: [{ id: 'O' }, { id: 'N' }, { id: 'P' }, { id: 'Y' }] };
    const noAttempts = generateLocalCounterfactual(build({ ...attemptOnly, attempts: [] }));
    check('ATTEMPT-ONLY OWNER (the committed O@09:30 case): O\'s only alternative is a scheduling attempt absent from initial and final -> relocation succeeds ONLY because the attempts supplement the basis (without them O is unplaced)', all(ready(generateLocalCounterfactual(build(attemptOnly)))).includes('O@09:30-10:30:R:GOOD') && ready(noAttempts).unplacedOwnerIds.join() === 'O');
    // dedup + origin neutrality
    const inAll = build({ ...SIMPLE, initial: { O: [{ s: '10:00', fit: 'GOOD' }, { s: '15:00', fit: 'GOOD' }] }, final: { O: [{ s: '10:00', fit: 'GOOD' }, { s: '15:00', fit: 'GOOD', e: '16:30' }] }, attempts: [{ id: 'O', s: '15:00', fit: 'GOOD', owners: ['N'] }], intents: SIMPLE.intents });
    const onlyInitial = build({ ...SIMPLE, initial: { O: [{ s: '10:00', fit: 'GOOD' }, { s: '15:00', fit: 'GOOD' }] }, final: {} });
    const onlyFinal = build({ ...SIMPLE, initial: {}, final: { O: [{ s: '10:00', fit: 'GOOD' }, { s: '15:00', fit: 'GOOD' }] } });
    const onlyAttempt = build({ ...SIMPLE, initial: {}, final: { O: [{ s: '10:00', fit: 'GOOD' }] }, attempts: [{ id: 'O', s: '15:00', fit: 'GOOD', owners: ['N'] }] });
    const results = [inAll, onlyInitial, onlyFinal, onlyAttempt].map((a) => all(ready(generateLocalCounterfactual(a))));
    check('DEDUP + ORIGIN NEUTRALITY: the same alternative (15:00 GOOD) present in initial, final AND attempts is ONE scheduling choice (a longer span in one source does not change the placed interval), and placing it from any single source gives the identical result', results.every((r) => r === results[0]) && results[0] === 'O@15:00-16:00:R:GOOD N@13:00-14:00:B:BEST P@10:30-11:30:P:GOOD');
    // ranking: best fit first, then earlier start (the Constructor's comparator); the baseline slot is not usable
    const ranking: Spec = { ...SIMPLE, final: { O: [{ s: '10:00', fit: 'GOOD' }, { s: '14:00', fit: 'CAUTION' }, { s: '15:00', fit: 'WORKABLE' }, { s: '16:00', fit: 'GOOD' }, { s: '15:30', fit: 'GOOD' }] } };
    check('OWNER RANKING with the real comparator: the best timing tier wins, then the earlier start -> GOOD@15:30 beats GOOD@16:00, WORKABLE@15:00 and CAUTION@14:00 (and the released baseline slot 10:00 fails its overlap with P by itself)', all(ready(generateLocalCounterfactual(build(ranking)))).includes('O@15:30-16:30:R:GOOD'));
    check('TIMING DEGRADATION is allowed: a relocation to a WORSE fit than the baseline is generated and reported, never rejected', all(ready(generateLocalCounterfactual(build({ ...SIMPLE, final: { O: [{ s: '10:00', fit: 'GOOD' }, { s: '15:00', fit: 'CAUTION' }] } })))).includes('O@15:00-16:00:R:CAUTION'));
    // conflicts
    const nonOwnerConflict = build({ ...SIMPLE, final: { O: [{ s: '10:00', fit: 'GOOD' }, { s: '13:00', fit: 'BEST' }, { s: '16:00', fit: 'WORKABLE' }] } });
    check('OWNER ALTERNATIVE CONFLICTS A NON-OWNER: the best alternative (BEST@13:00) overlaps the pinned non-owner N -> the next alternative is tried and N is never moved', (() => { const c = ready(generateLocalCounterfactual(nonOwnerConflict)); return all(c) === 'O@16:00-17:00:R:WORKABLE N@13:00-14:00:B:BEST P@10:30-11:30:P:GOOD'; })());
    check('OWNER ALTERNATIVE CONFLICTS P: an alternative overlapping the promoted slot is skipped (here the earlier GOOD@11:00 overlaps P@10:30-11:30) and the next one is used', all(ready(generateLocalCounterfactual(build({ ...SIMPLE, final: { O: [{ s: '10:00', fit: 'GOOD' }, { s: '11:00', fit: 'GOOD' }, { s: '11:30', fit: 'WORKABLE' }] } })))).includes('O@11:30-12:30:R:WORKABLE'));
    const twoOwners: Spec = {
      intents: [{ id: 'A', importance: 'LOW' }, { id: 'B', importance: 'HIGH' }, { id: 'P' }],
      placements: [{ id: 'A', s: '10:00', fit: 'GOOD' }, { id: 'B', s: '11:00', fit: 'GOOD' }],
      final: { A: [{ s: '10:00', fit: 'GOOD' }, { s: '14:00', fit: 'GOOD' }, { s: '15:00', fit: 'CAUTION' }], B: [{ s: '11:00', fit: 'GOOD' }, { s: '14:00', fit: 'GOOD' }] },
      candidate: 'P', owners: ['A', 'B'],
      slots: [{ owner: 'A', s: '10:30', fit: 'GOOD' }, { owner: 'B', s: '10:30', fit: 'GOOD' }],
    };
    const o = ready(generateLocalCounterfactual(build(twoOwners)));
    check('OWNER ORDER (neutral Constructor precedence): both owners want 14:00 -> the HIGH-importance B (processed FIRST by `compareByOverloadPrecedence`, not by pressure or input order) takes it; the LOW-importance A falls to its next alternative; displaced order is B, A', o.displacedOwnerIds.join() === 'B,A' && all(o) === 'A@15:00-16:00:R:CAUTION B@14:00-15:00:R:GOOD P@10:30-11:30:P:GOOD');
    check('NO TRANSITIVE DISPLACEMENT: the relocated owner B holds 14:00 and A may NOT displace it (A is pushed to another alternative); no placement outside the displaced owners changes', (() => { const unchanged = o.counterfactualPlacements.filter((p) => p.placementSource === 'BASELINE_UNCHANGED').length === 0; const noOverlap = o.counterfactualPlacements.every((p, i, list) => list.every((q, j) => i === j || !(p.start.getTime() < q.end.getTime() && q.start.getTime() < p.end.getTime()))); return unchanged && noOverlap; })());
    const flipped = JSON.stringify(generateLocalCounterfactual(build({ ...twoOwners, pressure: { A: 'LAST_KNOWN_OPPORTUNITY', B: 'LAST_KNOWN_OPPORTUNITY' } })));
    const none = JSON.stringify(generateLocalCounterfactual(build({ ...twoOwners, pressure: { A: 'NONE', B: 'NONE' } })));
    const mixed = JSON.stringify(generateLocalCounterfactual(build({ ...twoOwners, pressure: { A: 'LAST_KNOWN_OPPORTUNITY', B: 'NONE' } })));
    check('PRESSURE PARITY: the same authorities with every owner NONE, every owner LAST_KNOWN_OPPORTUNITY, or mixed produce BYTE-IDENTICAL output (pressure is never read; NONE means "no established pressure" and licenses no inference; owner order is by Constructor precedence only)', flipped === none && none === mixed);
    const unplaced = ready(generateLocalCounterfactual(build({ ...twoOwners, final: { A: [{ s: '10:00', fit: 'GOOD' }, { s: '14:00', fit: 'GOOD' }], B: [{ s: '11:00', fit: 'GOOD' }, { s: '14:00', fit: 'GOOD' }] } })));
    check('an owner left without any alternative stays UNPLACED while the others relocate (A has only the contested 14:00): valid neutral output, listed in `unplacedOwnerIds`', unplaced.unplacedOwnerIds.join() === 'A' && unplaced.relocatedPlacements.map(sh).join() === 'B@14:00-15:00:R:GOOD' && !all(unplaced).includes('A@'));
    check('OWNER DEADLINE PRECEDENCE: a deadline-today owner is processed before a higher-importance owner (the Constructor\'s own order), proving the comparator, not a local ordering, decides', (() => { const c = ready(generateLocalCounterfactual(build({ ...twoOwners, intents: [{ id: 'A', importance: 'LOW', deadline: FRIDAY }, { id: 'B', importance: 'HIGH' }, { id: 'P' }] }))); return c.displacedOwnerIds.join() === 'A,B'; })());
    check('the processing order equals `compareByOverloadPrecedence` over the basis intents (cross-check with the real comparator)', (() => { const intents = [{ id: 'A', importance: 'LOW', originalOrder: 0 }, { id: 'B', importance: 'HIGH', originalOrder: 1 }] as never[]; return compareByOverloadPrecedence(intents[1], intents[0], FRIDAY) < 0 && o.displacedOwnerIds[0] === 'B'; })());
  }

  // ======================================================================
  console.log('=== Part 4: ownership, freezing, determinism, independence ===');
  {
    const a = build({ ...SIMPLE, attempts: [{ id: 'O', s: '09:30', fit: 'GOOD', owners: ['N'] }], intents: SIMPLE.intents });
    const snapshot = JSON.stringify(a);
    const outcome = generateLocalCounterfactual(a);
    const cf = ready(outcome);
    check('INPUTS ARE NEVER MUTATED: the basis, placements, attempts, input and contention are byte-identical after generation (they are deep-frozen, so a write would throw)', JSON.stringify(a) === snapshot);
    check(`DETACHED: none of the ${reachable(outcome).size} output objects / arrays / Dates is reachable from any authority`, disjoint(reachable(outcome), reachable(a)));
    check('DEEP FREEZE: the outcome, the counterfactual, every array, every placement and every Date is frozen; writes throw -- and the freeze is NOT claimed to protect a Date\'s time value', [...reachable(outcome)].every((o) => Object.isFrozen(o)) && throwsTypeError(() => { (cf.counterfactualPlacements as unknown as unknown[]).push({}); }) && throwsTypeError(() => { (cf.promotedPlacement as { intentId: string }).intentId = 'x'; }) && throwsTypeError(() => { (cf.displacedOwnerIds as unknown as string[]).push('x'); }));
    const copy = JSON.parse(JSON.stringify(a)) as LocalCounterfactualAuthorities;
    const fromCopy = JSON.stringify(generateLocalCounterfactual(revive(copy)));
    check('SOURCE MUTATION AFTER GENERATION (test only): changing a source Date / array afterwards leaves the earlier output unchanged', (() => { const rev = revive(JSON.parse(JSON.stringify(a))); const out = generateLocalCounterfactual(rev); const snap = JSON.stringify(out); (rev.baselinePlacements as unknown as { placements: { placements: BaselinePlacement[] } }).placements.placements.forEach((p) => { try { p.start.setTime(0); } catch { /* frozen? Dates are not */ } }); return JSON.stringify(out) === snap && fromCopy === JSON.stringify(outcome); })());
    check('DETERMINISM: the same semantic authority input yields byte-equivalent output across repeated calls and across independently built (equal) authorities', Array.from({ length: 10 }, () => JSON.stringify(generateLocalCounterfactual(build({ ...SIMPLE, attempts: [{ id: 'O', s: '09:30', fit: 'GOOD', owners: ['N'] }] })))).every((j) => j === JSON.stringify(outcome)));
    const realNow = Date.now; let nowCalls = 0; (Date as unknown as { now: () => number }).now = () => { nowCalls += 1; return realNow(); };
    try { generateLocalCounterfactual(a); } finally { (Date as unknown as { now: () => number }).now = realNow; }
    check('NO CLOCK: generation calls Date.now zero times', nowCalls === 0);
    const again = generateLocalCounterfactual(a);
    check('INDEPENDENT OUTPUTS: two calls on the same authorities share NO object, array or Date (every output is newly owned each time)', disjoint(reachable(outcome), reachable(again)) && JSON.stringify(again) === JSON.stringify(outcome));
    const foreign = ready(generateLocalCounterfactual(build({ ...SIMPLE, final: { O: [{ s: '10:00', fit: 'GOOD' }] }, attempts: [{ id: 'N', s: '15:00', fit: 'BEST', owners: ['P'] }] })));
    check('OWNER ALTERNATIVES ARE THE OWNER\'S OWN: scheduling attempts of ANOTHER intent (here a BEST@15:00 attempt of the non-owner N) are never used to relocate O -> O stays unplaced', foreign.unplacedOwnerIds.join() === 'O' && foreign.relocatedPlacements.length === 0);
    // several pairs evaluated against the SAME run-level baseline: independent, no sequential mutation
    const shared = build({ ...SIMPLE, intents: [{ id: 'O' }, { id: 'N' }, { id: 'P' }, { id: 'Q' }], placements: [{ id: 'O', s: '10:00', fit: 'GOOD' }, { id: 'N', s: '13:00', fit: 'BEST' }], initial: { O: [{ s: '10:00', fit: 'GOOD' }] }, final: { O: [{ s: '10:00', fit: 'GOOD' }, { s: '15:00', fit: 'GOOD' }] } });
    const pairP = shared;
    const pairQ = withAuth(shared, { input: { candidateIntentId: 'Q', owners: [{ intentId: 'O', pressure: 'NONE' }] }, contention: { status: 'READY', authority: { candidateIntentId: 'Q', attempts: [{ ownerIntentId: 'O', start: T('10:00'), end: T('11:00'), timingFit: 'BEST' }] } } });
    const p1 = JSON.stringify(generateLocalCounterfactual(pairP)); const q1 = JSON.stringify(generateLocalCounterfactual(pairQ)); const p2 = JSON.stringify(generateLocalCounterfactual(pairP));
    check('MULTIPLE PROMOTION INPUTS: one pair per call, each from the SAME run-level baseline; evaluating Q does not change P (no sequential mutation, no first-accepted choice among inputs)', p1 === p2 && p1 !== q1 && ready(JSON.parse(q1) as never as LocalCounterfactualOutcome) !== undefined);
    check('the output contains exactly the promoted P, the baseline placements outside the displaced owners (unchanged), and the relocated owners: NO other intent is placed (no global replan), P transitions Deferred -> placed', (() => { const ids = cf.counterfactualPlacements.map((p) => p.intentId).sort(); return ids.join() === 'N,O,P' && cf.counterfactualPlacements.filter((p) => p.placementSource === 'BASELINE_UNCHANGED').map((p) => p.intentId).join() === 'N' && cf.counterfactualPlacements[cf.counterfactualPlacements.length - 1].intentId === 'P'; })());
  }
  function revive(raw: LocalCounterfactualAuthorities): LocalCounterfactualAuthorities {
    const dateKeys = new Set(['start', 'end']);
    const walk = (v: unknown): unknown => { if (Array.isArray(v)) return v.map(walk); if (v && typeof v === 'object') { const out: Record<string, unknown> = {}; for (const [k, c] of Object.entries(v as Record<string, unknown>)) out[k] = dateKeys.has(k) && typeof c === 'string' ? new Date(c) : walk(c); return out; } return v; };
    return walk(raw) as LocalCounterfactualAuthorities;
  }

  // ======================================================================
  console.log('=== Part 5: the REAL pipeline -- orchestrator diagnostics -> evidence / pressure -> PromotionInput -> contention -> attempts -> generator ===');
  type Weekday = AvailabilityConfiguration['periods'][number]['weekday'];
  const workWeek: AvailabilityConfiguration = { configured: true, periods: ([1, 2, 3, 4, 5] as Weekday[]).map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })) };
  const rangeDeps: OpportunityRangeDeps = { loadAvailabilityConfiguration: async () => workWeek, loadPlansOverlappingRange: async () => [] };
  const at = (h: string) => new Date(`${FRIDAY}T${h}:00Z`);
  const iso = (h: string) => `${FRIDAY}T${h}:00.000Z`;
  const TT = (h: string) => new Date(iso(h)).getTime();
  type Label = 'EXCELLENT' | 'GOOD' | 'USABLE' | 'CAUTION';
  const FIT: Record<Label, PlacementTimingFit> = { EXCELLENT: 'BEST', GOOD: 'GOOD', USABLE: 'WORKABLE', CAUTION: 'CAUTION' };
  interface PoolItem { slot: [string, string]; label: Label }
  const item = (a: string, b: string, label: Label = 'GOOD'): PoolItem => ({ slot: [a, b], label });
  const WEEK_FACTS: DecisionFacts = { recurrence: { period: 'LOCAL_CALENDAR_WEEK', periodStartDate: '2026-10-05', periodEndDate: '2026-10-11', targetPerPeriod: 3, completedInPeriod: 0, committedInPeriod: 0, remainingInPeriod: 3 } };
  const req = (id: string, order: number, over: Partial<RequestedDayIntent> = {}): RequestedDayIntent => ({ id, title: id, flexibility: 'FLEXIBLE', durationMinutes: 60, originalOrder: order, ...over } as RequestedDayIntent);
  const request = (intents: RequestedDayIntent[], pressured: string[]): ConstructDayRequest => ({ targetDate: FRIDAY, timezone: 'UTC', constructionWindowSource: 'EXPLICIT_RANGE', now: at('09:00'), explicitStart: at('09:00'), explicitEnd: at('17:00'), intents, decisionFactsByIntentId: new Map(pressured.map((id) => [id, WEEK_FACTS] as [string, DecisionFacts])) });
  type History = Record<string, Array<Array<{ start: number; fit: PlacementTimingFit }>>>;
  function mkDeps(pools: Record<string, PoolItem[]>, limit: number, hist: History = {}, blockers: Array<{ start: Date; end: Date; status: 'UPCOMING' }> = []): DayConstructorOrchestratorDeps {
    return {
      loadBlockingPlans: async () => blockers,
      loadDurationContext: async () => ({ preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} }),
      searchTiming: (r: any) => {
        const id = r.taskTitle as string;
        const out = (pools[id] ?? []).filter((p) => !(r.excludedIntervals ?? []).some((e: { start: Date; end: Date }) => TT(p.slot[0]) < e.end.getTime() && e.start.getTime() < TT(p.slot[1]))).slice(0, limit);
        (hist[id] ??= []).push(out.map((p) => ({ start: TT(p.slot[0]), fit: FIT[p.label] })));
        const candidates: TimingCandidate[] = out.map((p) => ({ start: iso(p.slot[0]), end: iso(p.slot[1]), score: 5, label: p.label, muhurtaScore: 0, reasons: [], metadata: { windowType: 'NEUTRAL', windowLabel: 'x', activityType: 'x', dateLabel: FRIDAY } }));
        return { candidates };
      },
      loadAvailabilityConfiguration: async () => ({ configured: false, periods: [] }),
      prepareDecisionFacts: createDecisionFactPreparer(rangeDeps),
    };
  }
  const authoritiesOf = async (intents: RequestedDayIntent[], pressured: string[], pools: Record<string, PoolItem[]>, limit: number, hist: History = {}, blockers: Array<{ start: Date; end: Date; status: 'UPCOMING' }> = []) => {
    const prepared = await preparePromotionInputs(request(intents, pressured), mkDeps(pools, limit, hist, blockers));
    if (prepared.run.status !== 'PREPARED') throw new Error('run not prepared');
    const run = prepared.run;
    return { prepared, run, contexts: run.promotions.map((pair) => ({ constructionBasis: run.constructionBasis, baselinePlacements: run.baselinePlacements, schedulingAttempts: run.schedulingAttempts, input: pair.input, contention: pair.contention }) as LocalCounterfactualAuthorities) };
  };
  {
    // The directed owner-relocation case, end to end: X@13:00, Y@10:00, O@11:00 baseline; P Deferred; O's only useful alternative 09:30 lives in an intermediate list.
    const pools = { X: [item('13:00', '14:00')], Y: [item('13:00', '14:00'), item('10:00', '11:00')], O: [item('13:30', '14:30'), item('09:30', '10:30'), item('11:00', '12:00')], P: [item('13:30', '14:30'), item('10:30', '11:30'), item('11:30', '12:30')] };
    const plainDeps = mkDeps(pools, 1);
    const plain = await orchestrateConstructDay(request([req('X', 0), req('Y', 1), req('O', 2), req('P', 3)], ['X', 'Y', 'O', 'P']), plainDeps);
    const { prepared, contexts } = await authoritiesOf([req('X', 0), req('Y', 1), req('O', 2), req('P', 3)], ['X', 'Y', 'O', 'P'], pools, 1);
    const before = JSON.stringify(prepared.result);
    const outcome = generateLocalCounterfactual(contexts[0]);
    const cf = ready(outcome);
    check('COMPOSED REAL PIPELINE (directed case): real orchestrator -> evidence / pressure -> PromotionInput -> contention -> scheduling attempts -> generator (no handcrafted input) generates P@10:30 (GOOD, the earliest of three equally fitted historical slots), displacing Y and O with X pinned', contexts.length === 1 && sh(cf.promotedPlacement) === 'P@10:30-11:30:P:GOOD' && cf.displacedOwnerIds.join() === 'Y,O' && all(cf).includes('X@13:00-14:00:B:GOOD'));
    check('ATTEMPT-ONLY RELOCATION END TO END: O -- whose 09:30 alternative is in NEITHER the initial nor the final list -- relocates to 09:30 (GOOD) from the scheduling attempts; Y has no usable alternative and is left unplaced; the result equals the full-history oracle\'s', cf.relocatedPlacements.map(sh).join() === 'O@09:30-10:30:R:GOOD' && cf.unplacedOwnerIds.join() === 'Y' && all(cf) === 'X@13:00-14:00:B:GOOD O@09:30-10:30:R:GOOD P@10:30-11:30:P:GOOD');
    check('BASELINE RESULT BYTE-IDENTICAL: the Constructor result of the preparation run is unchanged by invoking the generator (before / after), equals a plain orchestration, and the signed preview token body is byte-identical (the generator is not wired)', JSON.stringify(prepared.result) === before && JSON.stringify(prepared.result) === JSON.stringify(plain) && JSON.stringify(signPreviewResultBody('u', prepared.result as unknown as Record<string, unknown>)) === JSON.stringify(signPreviewResultBody('u', plain as unknown as Record<string, unknown>)) && JSON.stringify(signPreviewResultBody('u', plain as unknown as Record<string, unknown>)).includes('acceptanceToken'));
    const pressureOff = await authoritiesOf([req('X', 0), req('Y', 1), req('O', 2), req('P', 3)], ['P'], pools, 1);
    check('PRESSURE PARITY (real pipeline): with only P pressured the owners are NONE; with all four pressured they are LAST_KNOWN_OPPORTUNITY -- the generator output is byte-identical', pressureOff.prepared.promotion.status === 'PREPARED' && pressureOff.prepared.promotion.inputs[0].owners.every((o) => o.pressure === 'NONE') && prepared.promotion.status === 'PREPARED' && prepared.promotion.inputs[0].owners.every((o) => o.pressure === 'LAST_KNOWN_OPPORTUNITY') && JSON.stringify(generateLocalCounterfactual(pressureOff.contexts[0])) === JSON.stringify(outcome));
  }
  {
    // The #211 fixture: P@10:00 is absent from P's initial and final lists but is a real historical contention slot (against B).
    const pools = { O: [item('11:00', '12:00')], B: [item('11:30', '12:30'), item('10:00', '11:00')], P: [item('10:30', '11:30'), item('10:00', '11:00')] };
    const { run, contexts } = await authoritiesOf([req('O', 0), req('B', 1), req('P', 2)], ['O', 'B', 'P'], pools, 1);
    const basis = (run.constructionBasis as { status: 'READY'; basis: ConstructionBasis }).basis;
    const pLists = [...basis.initialCandidates, ...basis.finalCandidates].filter((l) => l.intentId === 'P').flatMap((l) => l.candidates.map((c) => hhmm(c.start)));
    const cf = ready(generateLocalCounterfactual(contexts[0]));
    check('P INTERMEDIATE SLOT: P@10:00 is absent from P\'s initial and final candidate lists (they hold only 10:30) yet is a real contention slot; the generator ranks its slots from the contention authority (both GOOD -> the earlier 10:00 wins) and displaces only the owner it terminally overlaps, B', !pLists.includes('10:00') && sh(cf.promotedPlacement) === 'P@10:00-11:00:P:GOOD' && cf.displacedOwnerIds.join() === 'B');
    const bestPools = { O: [item('11:00', '12:00')], B: [item('11:30', '12:30'), item('10:00', '11:00')], P: [item('10:30', '11:30', 'EXCELLENT'), item('10:00', '11:00')] };
    const second = await authoritiesOf([req('O', 0), req('B', 1), req('P', 2)], ['O', 'B', 'P'], bestPools, 1);
    const c2 = ready(generateLocalCounterfactual(second.contexts[0]));
    const bBasis = (second.run.constructionBasis as { status: 'READY'; basis: ConstructionBasis }).basis;
    const bInitial = bBasis.initialCandidates.find((l) => l.intentId === 'B')!.candidates.map((c) => hhmm(c.start));
    const bFinal = bBasis.finalCandidates.find((l) => l.intentId === 'B')!.candidates.map((c) => hhmm(c.start));
    check('INITIAL-ONLY OWNER END TO END (B@11:30-style): P\'s best slot (BEST@10:30) terminally overlaps B and O; O (no alternative) is unplaced and B relocates to 11:30 -- a candidate that exists ONLY in B\'s INITIAL list (its final list holds 10:00)', JSON.stringify(bInitial) === '["11:30"]' && JSON.stringify(bFinal) === '["10:00"]' && c2.displacedOwnerIds.join() === 'O,B' && all(c2) === 'B@11:30-12:30:R:GOOD P@10:30-11:30:P:BEST' && c2.unplacedOwnerIds.join() === 'O');
  }
  {
    // GOOD discovered first, BEST later, on the real pipeline.
    const pools = { A: [item('10:00', '11:00')], B: [item('11:30', '12:30')], P: [item('10:00', '11:00', 'GOOD'), item('11:30', '12:30', 'EXCELLENT')] };
    const { contexts } = await authoritiesOf([req('A', 0), req('B', 1), req('P', 2)], ['A', 'B', 'P'], pools, 3);
    const cf = ready(generateLocalCounterfactual(contexts[0]));
    check('GOOD / BEST END TO END: P discovered GOOD@10:00 first and BEST@11:30 second (real search labels) -> the generator selects BEST@11:30 by the real comparator and displaces only B', sh(cf.promotedPlacement) === 'P@11:30-12:30:P:BEST' && cf.displacedOwnerIds.join() === 'B');
  }

  // ======================================================================
  console.log('=== Part 6: property sweep over REAL runs against an independent FULL-HISTORY oracle ===');
  {
    let seed = 20261006; const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
    const slotsUpTo = (last: number) => { const out: Array<[string, string]> = []; for (let t = 9 * 60; t <= last * 60; t += 30) { const e = t + 60; const f = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; out.push([f(t), f(e)]); } return out; };
    const LABELS: Label[] = ['EXCELLENT', 'GOOD', 'USABLE', 'CAUTION'];
    const tally = { runs: 0, pairs: 0, ready: 0, noActionable: 0, otherUnavailable: 0, invariantViolations: 0, oracleMismatches: 0, shuffleMismatches: 0, pressureMismatches: 0, displacedOwners: 0, relocated: 0, unplaced: 0, attemptOnlyRelocations: 0, alternateSlotCases: 0, multiOwnerDisplacements: 0 };
    const RUNS = 900;
    for (let n = 0; n < RUNS; n += 1) {
      const k = 3 + Math.floor(rnd() * 4); const ids = ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, k); const limit = 1 + Math.floor(rnd() * 3);
      const SLOTS = slotsUpTo(n % 2 === 0 ? 13 : 15);
      const pools: Record<string, PoolItem[]> = {}; ids.forEach((id) => { const sub = SLOTS.filter(() => rnd() < 0.65).map((slot) => ({ slot, label: LABELS[Math.floor(rnd() * 4)] } as PoolItem)); sub.sort((a, b) => LABELS.indexOf(a.label) - LABELS.indexOf(b.label) || rnd() - 0.5); pools[id] = sub; });
      if (n % 3 === 0) {
        // STRUCTURED runs: the owners each hold a distinct slot and have roomy alternatives; P's candidates all overlap the owners' slots, so P is Deferred after real contention.
        const m = 1 + Math.floor(rnd() * 3); const bases = ['09:00', '11:00', '13:00'].slice(0, m);
        ids.length = 0; bases.forEach((_, i) => ids.push(['A', 'B', 'C'][i])); ids.push('P');
        const hh = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
        const win = (startMinutes: number): [string, string] => [hh(startMinutes), hh(startMinutes + 60)];
        const lab = (): Label => LABELS[Math.floor(rnd() * 4)];
        bases.forEach((b, i) => { const bm = Number(b.slice(0, 2)) * 60; const extra = SLOTS.filter(() => rnd() < 0.3).slice(0, 3).map((slot) => ({ slot, label: lab() })); pools[ids[i]] = [{ slot: win(bm), label: 'EXCELLENT' as Label }, ...extra]; });
        const pSlots = bases.flatMap((b) => { const bm = Number(b.slice(0, 2)) * 60; return [bm + 30, bm, bm - 30].filter((x) => x >= 9 * 60 && x <= 15 * 60 && rnd() < 0.7).map((x) => ({ slot: win(x), label: lab() })); });
        pools.P = pSlots.sort((a, b) => LABELS.indexOf(a.label) - LABELS.indexOf(b.label) || rnd() - 0.5);
      }
      const fixed = n % 3 === 0 ? undefined : (rnd() < 0.2 ? ids[ids.length - 1] : undefined);
      const blockers = rnd() < 0.2 ? [{ start: at('12:30'), end: at('13:00'), status: 'UPCOMING' as const }] : [];
      const hist: History = {};
      const intents = ids.map((id, i) => (id === fixed ? req(id, i, { flexibility: 'FIXED', fixedStart: at('14:00') } as Partial<RequestedDayIntent>) : req(id, i)));
      const { prepared, run, contexts } = await authoritiesOf(intents, ids, pools, limit, hist, blockers);
      tally.runs += 1;
      if (prepared.result.status !== 'READY') continue;
      const dayIntents = new Map(prepared.result.preview.resolvedIntents.map((r) => [r.requestedIntentId, r.dayIntent]));
      const basis = (run.constructionBasis as { status: 'READY'; basis: ConstructionBasis }).basis;
      const baseline = (run.baselinePlacements as { status: 'READY'; placements: { placements: readonly BaselinePlacement[] } }).placements.placements;
      const attempts = (run.schedulingAttempts as { status: 'READY'; authority: { attempts: readonly SchedulingAttempt[] } }).authority.attempts;
      const win = [basis.window.start.getTime(), basis.window.end.getTime()]; const blk = basis.blockedIntervals.map((b) => [b.start.getTime(), b.end.getTime()]);
      const ov = (a: number, b: number, c: number, d: number) => a < d && c < b;
      for (const ctx of contexts) {
        tally.pairs += 1;
        const outcome = generateLocalCounterfactual(ctx);
        if (outcome.status === 'UNAVAILABLE') { if (outcome.reason === 'NO_ACTIONABLE_PROMOTION_SLOT') tally.noActionable += 1; else tally.otherUnavailable += 1; if (outcome.reason !== 'NO_ACTIONABLE_PROMOTION_SLOT') continue; }
        const pid = ctx.input.candidateIntentId; const owners = ctx.input.owners.map((o) => o.intentId);
        const contentionAttempts = (ctx.contention as { status: 'READY'; authority: { attempts: readonly { ownerIntentId: string; start: Date; end: Date; timingFit?: PlacementTimingFit }[] } }).authority.attempts;
        // --- independent oracle (written differently from the generator, using the FULL history of every candidate list as the owner pool)
        const slots: Array<{ s: number; e: number; fit: PlacementTimingFit | undefined }> = [];
        contentionAttempts.forEach((a) => { if (!slots.some((x) => x.s === a.start.getTime() && x.e === a.end.getTime() && x.fit === a.timingFit)) slots.push({ s: a.start.getTime(), e: a.end.getTime(), fit: a.timingFit }); });
        const pc = (id: string, s: number, e: number, fit: Fit): PlacementCandidate => ({ intentId: id, start: new Date(s), end: new Date(e), timingFit: fit, candidateOrder: 0 });
        const usable = slots.filter((sl) => sl.s >= win[0] && sl.e <= win[1] && !blk.some((b) => ov(sl.s, sl.e, b[0], b[1]))).filter((sl) => { const hit = baseline.filter((p) => ov(sl.s, sl.e, p.start.getTime(), p.end.getTime())); return hit.length > 0 && hit.every((p) => owners.includes(p.intentId) && p.placementSource === 'SELECTED_CANDIDATE'); }).sort((a, b) => compareCandidatesForPlacement(pc(pid, a.s, a.e, a.fit), pc(pid, b.s, b.e, b.fit)));
        if (usable.length === 0) { if (outcome.status !== 'UNAVAILABLE') tally.oracleMismatches += 1; continue; }
        if (outcome.status !== 'READY') { tally.oracleMismatches += 1; continue; }
        tally.ready += 1; const cf = outcome.counterfactual;
        const slot = usable[0];
        if (slots.length > usable.length && sh(cf.promotedPlacement) !== undefined) tally.alternateSlotCases += (slots.findIndex((x) => x === slot) >= 0 && slots.length > 1 ? 1 : 0);
        const displaced = baseline.filter((p) => ov(slot.s, slot.e, p.start.getTime(), p.end.getTime())).map((p) => p.intentId).sort((a, b) => compareByOverloadPrecedence(dayIntents.get(a)!, dayIntents.get(b)!, FRIDAY) || a.localeCompare(b));
        const occupied = baseline.filter((p) => !displaced.includes(p.intentId)).map((p) => [p.start.getTime(), p.end.getTime()]); occupied.push([slot.s, slot.e]);
        const expected: string[] = [];
        for (const id of displaced) {
          const pool = [...(hist[id] ?? []).flat(), ...[...basis.initialCandidates, ...basis.finalCandidates].filter((l) => l.intentId === id).flatMap((l) => l.candidates.map((c) => ({ start: c.start.getTime(), fit: c.timingFit as PlacementTimingFit })))];
          const best = pool.filter((c) => c.start >= win[0] && c.start + 3600000 <= win[1] && !blk.some((b) => ov(c.start, c.start + 3600000, b[0], b[1])) && !occupied.some((o) => ov(c.start, c.start + 3600000, o[0], o[1]))).sort((a, b) => compareCandidatesForPlacement(pc(id, a.start, a.start + 3600000, a.fit), pc(id, b.start, b.start + 3600000, b.fit)))[0];
          if (best) { occupied.push([best.start, best.start + 3600000]); expected.push(`${id}@${best.start}:${best.fit}`); } else expected.push(`${id}@-`);
        }
        const actual = displaced.map((id) => { const r = cf.relocatedPlacements.find((p) => p.intentId === id); return r ? `${id}@${r.start.getTime()}:${r.timingFit}` : `${id}@-`; });
        if (expected.join() !== actual.join() || sh(cf.promotedPlacement) !== `${pid}@${hhmm(slot.s)}-${hhmm(slot.e)}:P:${slot.fit ?? '-'}`) tally.oracleMismatches += 1;
        // --- invariants
        const idsOut = cf.counterfactualPlacements.map((p) => p.intentId);
        const bad =
          cf.displacedOwnerIds.some((id) => !owners.includes(id)) ||
          idsOut.some((id) => id !== pid && !baseline.some((p) => p.intentId === id)) || new Set(idsOut).size !== idsOut.length ||
          baseline.filter((p) => !cf.displacedOwnerIds.includes(p.intentId)).some((p) => { const o = cf.counterfactualPlacements.find((q) => q.intentId === p.intentId); return !o || o.placementSource !== 'BASELINE_UNCHANGED' || o.start.getTime() !== p.start.getTime() || o.end.getTime() !== p.end.getTime() || o.timingFit !== (p.placementSource === 'FIXED_CONSTRAINT' ? undefined : p.timingFit); }) ||
          cf.counterfactualPlacements.some((p, i, list) => p.start.getTime() < win[0] || p.end.getTime() > win[1] || blk.some((b) => ov(p.start.getTime(), p.end.getTime(), b[0], b[1])) || list.some((q, j) => i !== j && ov(p.start.getTime(), p.end.getTime(), q.start.getTime(), q.end.getTime()))) ||
          cf.relocatedPlacements.some((r) => { const set = [...basis.initialCandidates, ...basis.finalCandidates].filter((l) => l.intentId === r.intentId).flatMap((l) => l.candidates.map((c) => `${c.start.getTime()}|${c.timingFit}`)); const att = attempts.filter((a) => a.intentId === r.intentId).map((a) => `${a.start.getTime()}|${a.timingFit}`); return ![...set, ...att].includes(`${r.start.getTime()}|${r.timingFit}`); }) ||
          cf.promotedPlacement.placementSource !== 'PROMOTED_CONTENTION_ATTEMPT';
        if (bad) tally.invariantViolations += 1;
        tally.displacedOwners += cf.displacedOwnerIds.length; tally.relocated += cf.relocatedPlacements.length; tally.unplaced += cf.unplacedOwnerIds.length; if (cf.displacedOwnerIds.length >= 2) tally.multiOwnerDisplacements += 1;
        cf.relocatedPlacements.forEach((r) => { const inLists = [...basis.initialCandidates, ...basis.finalCandidates].some((l) => l.intentId === r.intentId && l.candidates.some((c) => c.start.getTime() === r.start.getTime() && c.timingFit === r.timingFit)); if (!inLists) tally.attemptOnlyRelocations += 1; });
        // --- shuffled authority and pressure parity on the same pair
        const shuffledAttempts = [...contentionAttempts].reverse();
        const shuffled: LocalCounterfactualAuthorities = { ...ctx, contention: { status: 'READY', authority: { candidateIntentId: pid, attempts: shuffledAttempts } }, schedulingAttempts: { status: 'READY', authority: { attempts: [...attempts].reverse() } } };
        if (JSON.stringify(generateLocalCounterfactual(shuffled)) !== JSON.stringify(outcome)) tally.shuffleMismatches += 1;
        const flippedPressure: LocalCounterfactualAuthorities = { ...ctx, input: { candidateIntentId: pid, owners: ctx.input.owners.map((o) => ({ intentId: o.intentId, pressure: o.pressure === 'NONE' ? 'LAST_KNOWN_OPPORTUNITY' : 'NONE' })) } };
        if (JSON.stringify(generateLocalCounterfactual(flippedPressure)) !== JSON.stringify(outcome)) tally.pressureMismatches += 1;
      }
    }
    console.log(`     sweep: ${JSON.stringify(tally)}`);
    check(`ORACLE EQUALITY: over ${tally.runs} deterministic real runs (${tally.pairs} promotion pairs, ${tally.ready} READY counterfactuals, ${tally.displacedOwners} displaced owners) the generator equals an independently written oracle that uses the FULL history of every candidate list: ZERO mismatches in the selected P slot, the displaced set and every owner relocation / unplaced result`, tally.pairs > 400 && tally.ready > 150 && tally.oracleMismatches === 0);
    check('INVARIANTS on every READY result: only authorized owners displaced; every other baseline placement unchanged byte-for-byte (non-owners, undisturbed owners, FIXED); no extra intent placed; no overlap, window or blocker violation; every relocated placement comes from initial UNION final UNION the owner\'s attempts; P placed at a contention slot', tally.invariantViolations === 0);
    check('no UNAVAILABLE reason other than NO_ACTIONABLE_PROMOTION_SLOT occurs on real, consistent authorities', tally.otherUnavailable === 0);
    check('SHUFFLE and PRESSURE invariance hold on every real pair (reversed contention order and reversed attempt order, and every owner pressure flipped): zero byte differences', tally.shuffleMismatches === 0 && tally.pressureMismatches === 0);
    check(`the sweep is MEANINGFUL: ${tally.relocated} relocations (${tally.attemptOnlyRelocations} that exist only as scheduling attempts), ${tally.unplaced} unplaced owners, ${tally.multiOwnerDisplacements} multi-owner displacements and ${tally.noActionable} non-actionable pairs all occur`, tally.relocated > 60 && tally.unplaced > 5 && tally.multiOwnerDisplacements > 5 && tally.noActionable > 0);
  }

  if (!allPassed) { console.error('SOME LOCAL COUNTERFACTUAL CHECKS FAILED'); process.exitCode = 1; return; }
  console.log('ALL LOCAL COUNTERFACTUAL CHECKS PASSED');
})().then(() => process.exit(), (err) => { console.error(err); process.exit(1); });
