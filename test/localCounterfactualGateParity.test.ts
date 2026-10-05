/**
 * Constructor Decision Intelligence -- O5 P4b2: LOCAL MECHANICAL GATE PARITY with the REAL Day Constructor (pure, no DB).
 *
 * The local counterfactual generator needs the Constructor's candidate feasibility gates, but the Constructor's helpers are private and
 * dayConstructor.ts must not change. The generator therefore carries a MINIMAL local copy (`evaluateLocalPlacementGate`): WRONG_INTENT,
 * MALFORMED_CANDIDATE, INSUFFICIENT_DURATION, OUTSIDE_CONSTRUCTION_WINDOW, BLOCKED_BY_COMMITMENT, CONFLICTS_WITH_PROPOSED_ITEM; half-open overlap;
 * placed interval [start, start + required duration); non-positive-length blockers ignored.
 *
 * CURRENT CONSTRUCTOR MECHANICS (audited before the copy was written; `evaluateCandidate` / `deriveExactInterval` / `intervalsOverlap` /
 * `isWithinWindow` / `normalizeBlockedIntervals`):
 *   1 belongs to the intent                    candidate.intentId === intent.id                          else WRONG_INTENT
 *   2 real Dates, start < end                  isNaN / reversed / zero-length                            else MALFORMED_CANDIDATE
 *   3 duration                                 (end - start) / 60000 >= requiredMinutes (finite)         else INSUFFICIENT_DURATION
 *     interval derivation                      [start, start + requiredMinutes * 60000)  (never the raw span)
 *   4 window                                   start >= window.start && end <= window.end (both inclusive-equal ok)  else OUTSIDE_CONSTRUCTION_WINDOW
 *   5 external blockers                        half-open overlap with the NORMALIZED blockers (clipped to the window, merged; blockers with no
 *                                              positive in-window length are dropped)                  else BLOCKED_BY_COMMITMENT
 *   6 Proposed placements                      half-open overlap with every placed interval              else CONFLICTS_WITH_PROPOSED_ITEM
 *   ranking                                    `compareCandidatesForPlacement` -- imported, never copied
 *
 * METHOD. The REAL `constructDay` is used as a TEST ORACLE ONLY (the production generator never calls it): for every combination of a candidate
 * (start offsets around every boundary, spans, invalid shapes), external blockers and Proposed placements (FIXED intents, which the Constructor
 * reserves first) a single FLEXIBLE intent is run through the real Constructor and its verdict (placed interval or the rejection reason) is compared
 * with the local gate's verdict. ZERO mismatches are required, with every verdict category exercised on both sides.
 */
import { constructDay, type ConstructDayInput, type PlacementCandidate } from '../apps/web/lib/dayConstructor';
import { evaluateLocalPlacementGate, type LocalGateFailure } from '../apps/web/lib/localCounterfactual';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const FRIDAY = '2026-10-09';
const at = (h: string) => new Date(`${FRIDAY}T${h}:00Z`);
const ms = (h: string) => at(h).getTime();
const WINDOW = { start: at('09:00'), end: at('17:00') };
type Sp = { start: Date; end: Date };
const span = (a: string, b: string): Sp => ({ start: at(a), end: at(b) });

interface Scenario { name: string; blockers: Sp[]; placed: Sp[] }
const SCENARIOS: Scenario[] = [
  { name: 'empty', blockers: [], placed: [] },
  { name: 'one blocker 11:00-12:00', blockers: [span('11:00', '12:00')], placed: [] },
  { name: 'touching blockers 11:00-12:00 + 12:00-13:00', blockers: [span('11:00', '12:00'), span('12:00', '13:00')], placed: [] },
  { name: 'zero-length blocker at 11:30', blockers: [{ start: at('11:30'), end: at('11:30') }], placed: [] },
  { name: 'reversed blocker 12:00..11:00', blockers: [{ start: at('12:00'), end: at('11:00') }], placed: [] },
  { name: 'blockers partly / wholly outside the window', blockers: [{ start: at('08:00'), end: at('09:30') }, { start: at('16:30'), end: at('18:00') }, { start: at('06:00'), end: at('07:00') }], placed: [] },
  { name: 'one Proposed placement 13:00-14:00', blockers: [], placed: [span('13:00', '14:00')] },
  { name: 'two touching Proposed placements 13:00-14:00 + 14:00-15:00', blockers: [], placed: [span('13:00', '14:00'), span('14:00', '15:00')] },
  { name: 'blocker 11:00-12:00 AND Proposed 13:00-14:00', blockers: [span('11:00', '12:00')], placed: [span('13:00', '14:00')] },
];

/** Candidate start anchors: each boundary of the window, every blocker and every Proposed placement, +/- 1 ms, and their required-duration shifts. */
function anchors(sc: Scenario, durationMs: number): number[] {
  const points = [WINDOW.start.getTime(), WINDOW.end.getTime(), ...sc.blockers.flatMap((b) => [b.start.getTime(), b.end.getTime()]), ...sc.placed.flatMap((p) => [p.start.getTime(), p.end.getTime()])];
  const out = new Set<number>();
  for (const point of points) for (const shift of [0, -durationMs]) for (const delta of [-1, 0, 1]) out.add(point + shift + delta);
  out.add(ms('10:00')); out.add(ms('15:30')); out.add(WINDOW.start.getTime() - 3600000);
  for (let minute = 8 * 60; minute <= 17 * 60 + 30; minute += 15) out.add(ms('00:00') + minute * 60000);
  return [...out].sort((a, b) => a - b);
}

type Verdict = { feasible: true; start: number; end: number } | { feasible: false; reason: string };

/** The REAL Constructor as oracle: one FLEXIBLE intent X against the scenario's blockers and Proposed placements (FIXED intents are reserved first). */
function oracle(candidate: PlacementCandidate, durationMinutes: number, sc: Scenario): Verdict {
  const intents: unknown[] = [{ id: 'X', title: 'X', importance: 'MEDIUM', flexibility: 'FLEXIBLE', estimatedDurationMinutes: durationMinutes, originalOrder: 0, targetDate: FRIDAY }];
  const fixed: Record<string, Array<{ intentId: string; start: Date; end: Date }>> = {};
  sc.placed.forEach((p, i) => {
    const id = `F${i}`;
    intents.push({ id, title: id, importance: 'MEDIUM', flexibility: 'FIXED', estimatedDurationMinutes: (p.end.getTime() - p.start.getTime()) / 60000, originalOrder: i + 1, targetDate: FRIDAY });
    fixed[id] = [{ intentId: id, start: p.start, end: p.end }];
  });
  const input = {
    intents: intents as never,
    window: { date: FRIDAY, timezone: 'UTC', start: WINDOW.start, end: WINDOW.end, source: 'EXPLICIT_RANGE' } as never,
    blockedIntervals: sc.blockers.map((b) => ({ start: b.start, end: b.end, source: 'EXTERNAL' as const })),
    candidatesByIntentId: { X: [candidate] },
    fixedConstraintsByIntentId: fixed,
    today: FRIDAY,
  } as ConstructDayInput;
  const result = constructDay(input);
  if (result.status !== 'READY') return { feasible: false, reason: `NOT_READY:${result.status}` };
  const proposed = result.day.proposedItems.find((p) => p.intentId === 'X');
  if (proposed) return { feasible: true, start: proposed.start.getTime(), end: proposed.end.getTime() };
  const deferred = result.day.deferredItems.find((d) => d.intentId === 'X');
  return { feasible: false, reason: deferred?.diagnostics[0]?.reason ?? `DEFERRED:${deferred?.primaryReason}` };
}

const counts: Record<string, number> = {};
let cases = 0; let mismatches = 0; let oracleNotReady = 0; const examples: string[] = [];
const bump = (key: string) => { counts[key] = (counts[key] ?? 0) + 1; };

for (const durationMinutes of [30, 60]) {
  const durationMs = durationMinutes * 60000;
  for (const sc of SCENARIOS) {
    // The Proposed placements must themselves be placeable, or they would not be Proposed: they sit inside the window, clear of blockers and each other.
    for (const start of anchors(sc, durationMs)) {
      const shapes: Array<{ label: string; build: () => PlacementCandidate }> = [
        { label: 'exact', build: () => ({ intentId: 'X', start: new Date(start), end: new Date(start + durationMs), timingFit: 'GOOD', candidateOrder: 0 }) },
        { label: 'one ms short', build: () => ({ intentId: 'X', start: new Date(start), end: new Date(start + durationMs - 1), timingFit: 'GOOD', candidateOrder: 0 }) },
        { label: 'one ms long', build: () => ({ intentId: 'X', start: new Date(start), end: new Date(start + durationMs + 1), timingFit: 'BEST', candidateOrder: 1 }) },
        { label: 'double span', build: () => ({ intentId: 'X', start: new Date(start), end: new Date(start + 2 * durationMs), timingFit: 'CAUTION', candidateOrder: 2 }) },
        { label: 'zero length', build: () => ({ intentId: 'X', start: new Date(start), end: new Date(start), timingFit: 'WORKABLE', candidateOrder: 0 }) },
        { label: 'reversed', build: () => ({ intentId: 'X', start: new Date(start + durationMs), end: new Date(start), timingFit: 'GOOD', candidateOrder: 0 }) },
        { label: 'invalid start', build: () => ({ intentId: 'X', start: new Date(NaN), end: new Date(start + durationMs), timingFit: 'GOOD', candidateOrder: 0 }) },
        { label: 'invalid end', build: () => ({ intentId: 'X', start: new Date(start), end: new Date(NaN), timingFit: 'GOOD', candidateOrder: 0 }) },
        { label: 'wrong intent', build: () => ({ intentId: 'Y', start: new Date(start), end: new Date(start + durationMs), timingFit: 'GOOD', candidateOrder: 0 }) },
      ];
      for (const shape of shapes) {
        const candidate = shape.build();
        const real = oracle(candidate, durationMinutes, sc);
        const local = evaluateLocalPlacementGate(candidate, 'X', durationMinutes, WINDOW, sc.blockers, sc.placed);
        cases += 1;
        if (real.feasible === false && real.reason.startsWith('NOT_READY')) oracleNotReady += 1;
        const same = real.feasible === local.feasible && (real.feasible ? (local.feasible && local.start === real.start && local.end === real.end) : (!local.feasible && local.reason === real.reason));
        bump(real.feasible ? 'FEASIBLE' : (real as { reason: string }).reason);
        if (!same) { mismatches += 1; if (examples.length < 5) examples.push(`${sc.name} d=${durationMinutes} ${shape.label} start=${new Date(start).toISOString().slice(11, 23)} real=${JSON.stringify(real)} local=${JSON.stringify(local)}`); }
      }
    }
  }
}

console.log(`     parity: ${cases} cases; verdict categories seen by the REAL Constructor: ${JSON.stringify(counts)}`);
if (examples.length) console.log(`     mismatches: ${examples.join(' | ')}`);
const reasons: LocalGateFailure[] = ['WRONG_INTENT', 'MALFORMED_CANDIDATE', 'INSUFFICIENT_DURATION', 'OUTSIDE_CONSTRUCTION_WINDOW', 'BLOCKED_BY_COMMITMENT', 'CONFLICTS_WITH_PROPOSED_ITEM'];
check(`GATE PARITY: over ${cases} deterministic cases (2 durations x ${SCENARIOS.length} blocker / Proposed scenarios x boundary +/- 1 ms starts x candidate shapes) the local gate's verdict -- feasibility, the rejection reason AND the placed interval -- equals the REAL Constructor's: ZERO mismatches`, cases > 8000 && mismatches === 0 && oracleNotReady === 0);
check('COVERAGE: the real Constructor produced every verdict the local gate can: FEASIBLE and all six rejection reasons each appear many times (so no gate is vacuously "equal")', (counts['FEASIBLE'] ?? 0) > 200 && reasons.every((reason) => (counts[reason] ?? 0) > 20));
check('HALF-OPEN OVERLAP: placements that merely touch (end == other.start) do NOT conflict, one millisecond of overlap DOES -- identical to the Constructor, for blockers and Proposed placements', (() => {
  const touching = evaluateLocalPlacementGate({ intentId: 'X', start: at('12:00'), end: at('13:00') }, 'X', 60, WINDOW, [span('11:00', '12:00')], [span('13:00', '14:00')]);
  const overlapping = evaluateLocalPlacementGate({ intentId: 'X', start: new Date(ms('12:00') - 1), end: new Date(ms('13:00') - 1) }, 'X', 60, WINDOW, [span('11:00', '12:00')], []);
  const overlappingPlaced = evaluateLocalPlacementGate({ intentId: 'X', start: new Date(ms('12:00') + 1), end: new Date(ms('13:00') + 1) }, 'X', 60, WINDOW, [], [span('13:00', '14:00')]);
  return touching.feasible && !overlapping.feasible && overlapping.reason === 'BLOCKED_BY_COMMITMENT' && !overlappingPlaced.feasible && overlappingPlaced.reason === 'CONFLICTS_WITH_PROPOSED_ITEM';
})());
check('WINDOW INCLUSIVITY: an interval that starts exactly at the window start and one that ends exactly at the window end are INSIDE; one millisecond beyond either is OUTSIDE -- identical to the Constructor', (() => {
  const a = evaluateLocalPlacementGate({ intentId: 'X', start: at('09:00'), end: at('10:00') }, 'X', 60, WINDOW, [], []);
  const b = evaluateLocalPlacementGate({ intentId: 'X', start: at('16:00'), end: at('17:00') }, 'X', 60, WINDOW, [], []);
  const c = evaluateLocalPlacementGate({ intentId: 'X', start: new Date(ms('09:00') - 1), end: new Date(ms('10:00') - 1) }, 'X', 60, WINDOW, [], []);
  const d = evaluateLocalPlacementGate({ intentId: 'X', start: new Date(ms('16:00') + 1), end: new Date(ms('17:00') + 1) }, 'X', 60, WINDOW, [], []);
  return a.feasible && b.feasible && !c.feasible && c.reason === 'OUTSIDE_CONSTRUCTION_WINDOW' && !d.feasible && d.reason === 'OUTSIDE_CONSTRUCTION_WINDOW';
})());
check('DURATION: the placed interval is [start, start + required duration), never the raw (longer) span, and a span one millisecond short is INSUFFICIENT -- identical to the Constructor', (() => {
  const long = evaluateLocalPlacementGate({ intentId: 'X', start: at('10:00'), end: at('12:00') }, 'X', 60, WINDOW, [], []);
  const short = evaluateLocalPlacementGate({ intentId: 'X', start: at('10:00'), end: new Date(ms('11:00') - 1) }, 'X', 60, WINDOW, [], []);
  return long.feasible && long.end === ms('11:00') && !short.feasible && short.reason === 'INSUFFICIENT_DURATION';
})());
check('the gate is pure: it does not mutate its inputs (blockers, placements, candidate Dates are byte-identical afterwards)', (() => {
  const blockers = [span('11:00', '12:00')]; const placed = [span('13:00', '14:00')]; const candidate = { intentId: 'X', start: at('10:00'), end: at('11:00') };
  const before = JSON.stringify([blockers, placed, candidate]);
  for (let i = 0; i < 5; i += 1) evaluateLocalPlacementGate(candidate, 'X', 60, WINDOW, blockers, placed);
  return before === JSON.stringify([blockers, placed, candidate]);
})());

if (!allPassed) { console.error('SOME LOCAL GATE PARITY CHECKS FAILED'); process.exit(1); }
console.log('ALL LOCAL GATE PARITY CHECKS PASSED');
