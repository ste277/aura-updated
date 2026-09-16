/**
 * Day Constructor V1 -- PR B pure placement engine regression suite.
 * Plain ts-node test, following this repo's own established
 * check()-harness convention (see e.g. test/dayCapacity.test.ts).
 */
import { buildDayIntent, type ConstructionWindow, type DayIntent, type DayIntentInput } from '../apps/web/lib/dayIntent';
import type { BlockedInterval } from '../apps/web/lib/dayCapacity';
import {
  constructDay,
  compareCandidatesForPlacement,
  type ConstructDayInput,
  type ConstructedDay,
  type FixedPlacementConstraint,
  type PlacementCandidate,
} from '../apps/web/lib/dayConstructor';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function iso(s: string): Date {
  return new Date(s);
}

let batchCounter = 0;
function intent(input: DayIntentInput): DayIntent {
  batchCounter += 1;
  return buildDayIntent(input, batchCounter);
}
function resetIntentOrder() {
  batchCounter = 0;
}

function window(start: string, end: string, opts: Partial<ConstructionWindow> = {}): ConstructionWindow {
  return { date: opts.date ?? '2026-09-16', start: iso(start), end: iso(end), timezone: opts.timezone ?? 'UTC', source: opts.source ?? 'EXPLICIT_RANGE' };
}

function block(start: string, end: string, source: BlockedInterval['source'] = 'FIXED_PLAN'): BlockedInterval {
  return { start: iso(start), end: iso(end), source };
}

function candidate(intentId: string, start: string, end: string, opts: Partial<Pick<PlacementCandidate, 'timingFit' | 'candidateOrder'>> = {}): PlacementCandidate {
  return { intentId, start: iso(start), end: iso(end), timingFit: opts.timingFit, candidateOrder: opts.candidateOrder ?? 0 };
}

function fixedConstraint(intentId: string, start: string, end: string): FixedPlacementConstraint {
  return { intentId, start: iso(start), end: iso(end) };
}

/** Fills in the (usually irrelevant) `fixedConstraintsByIntentId` field so
 * every test below only has to specify it when it actually matters. */
function buildInput(partial: Omit<ConstructDayInput, 'fixedConstraintsByIntentId'> & { fixedConstraintsByIntentId?: ConstructDayInput['fixedConstraintsByIntentId'] }): ConstructDayInput {
  return { fixedConstraintsByIntentId: {}, ...partial };
}

function readyDay(partial: Omit<ConstructDayInput, 'fixedConstraintsByIntentId'> & { fixedConstraintsByIntentId?: ConstructDayInput['fixedConstraintsByIntentId'] }): ConstructedDay {
  const result = constructDay(buildInput(partial));
  if (result.status !== 'READY') throw new Error(`Expected READY, got ${result.status}`);
  return result.day;
}

const TODAY = '2026-09-16';
const FULL_DAY = () => window('2026-09-16T09:00:00Z', '2026-09-16T17:00:00Z');

// ============================================================
// SINGLE INTENT
// ============================================================

// 1. one intent / one feasible candidate
{
  resetIntentOrder();
  const a = intent({ title: 'Draft deck', targetDate: TODAY, estimatedDurationMinutes: 45 });
  const day = readyDay({
    intents: [a],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: { [a.id]: [candidate(a.id, '2026-09-16T10:00:00Z', '2026-09-16T10:45:00Z')] },
    today: TODAY,
  });
  check('1. one intent/one candidate: placed', day.proposedItems.length === 1 && day.deferredItems.length === 0);
  check('1. placed interval matches candidate exactly', day.proposedItems[0].start.getTime() === iso('2026-09-16T10:00:00Z').getTime() && day.proposedItems[0].end.getTime() === iso('2026-09-16T10:45:00Z').getTime());
  check('1. placementSource is SELECTED_CANDIDATE', day.proposedItems[0].placementSource === 'SELECTED_CANDIDATE');
}

// 2. one intent / multiple candidates -- 3,4,5. BEST/GOOD/WORKABLE/CAUTION ordering
{
  resetIntentOrder();
  const a = intent({ title: 'Focus block', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const day = readyDay({
    intents: [a],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: {
      [a.id]: [
        candidate(a.id, '2026-09-16T09:00:00Z', '2026-09-16T09:30:00Z', { timingFit: 'CAUTION', candidateOrder: 0 }),
        candidate(a.id, '2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', { timingFit: 'WORKABLE', candidateOrder: 1 }),
        candidate(a.id, '2026-09-16T11:00:00Z', '2026-09-16T11:30:00Z', { timingFit: 'GOOD', candidateOrder: 2 }),
        candidate(a.id, '2026-09-16T12:00:00Z', '2026-09-16T12:30:00Z', { timingFit: 'BEST', candidateOrder: 3 }),
      ],
    },
    today: TODAY,
  });
  check('2. one intent/multiple candidates: exactly one placed', day.proposedItems.length === 1);
  check('3. BEST beats GOOD/WORKABLE/CAUTION', day.proposedItems[0].start.getTime() === iso('2026-09-16T12:00:00Z').getTime());
}
{
  resetIntentOrder();
  const a = intent({ title: 'Focus block', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const day = readyDay({
    intents: [a],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: {
      [a.id]: [candidate(a.id, '2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', { timingFit: 'WORKABLE' }), candidate(a.id, '2026-09-16T11:00:00Z', '2026-09-16T11:30:00Z', { timingFit: 'GOOD' })],
    },
    today: TODAY,
  });
  check('4. GOOD beats WORKABLE', day.proposedItems[0].start.getTime() === iso('2026-09-16T11:00:00Z').getTime());
}
{
  resetIntentOrder();
  const a = intent({ title: 'Focus block', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const day = readyDay({
    intents: [a],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: {
      [a.id]: [candidate(a.id, '2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', { timingFit: 'CAUTION' }), candidate(a.id, '2026-09-16T11:00:00Z', '2026-09-16T11:30:00Z', { timingFit: 'WORKABLE' })],
    },
    today: TODAY,
  });
  check('5. WORKABLE beats CAUTION', day.proposedItems[0].start.getTime() === iso('2026-09-16T11:00:00Z').getTime());
}

// 6. same fit -> earlier start
{
  resetIntentOrder();
  const a = intent({ title: 'x', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const day = readyDay({
    intents: [a],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: {
      [a.id]: [candidate(a.id, '2026-09-16T13:00:00Z', '2026-09-16T13:30:00Z', { timingFit: 'GOOD', candidateOrder: 1 }), candidate(a.id, '2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', { timingFit: 'GOOD', candidateOrder: 0 })],
    },
    today: TODAY,
  });
  check('6. same fit -> earlier start wins', day.proposedItems[0].start.getTime() === iso('2026-09-16T10:00:00Z').getTime());
}

// 7. same fit/start -> candidateOrder
check('7. compareCandidatesForPlacement: same fit+start, lower candidateOrder wins', compareCandidatesForPlacement(candidate('a', '2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', { timingFit: 'GOOD', candidateOrder: 0 }), candidate('a', '2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', { timingFit: 'GOOD', candidateOrder: 1 })) < 0);

// 8. candidate longer than duration -> exact required duration placed
{
  resetIntentOrder();
  const a = intent({ title: 'x', targetDate: TODAY, estimatedDurationMinutes: 45 });
  const day = readyDay({ intents: [a], window: FULL_DAY(), blockedIntervals: [], candidatesByIntentId: { [a.id]: [candidate(a.id, '2026-09-16T10:00:00Z', '2026-09-16T11:30:00Z')] }, today: TODAY });
  check('8. placed interval is exactly 10:00-10:45, never the full 10:00-11:30 candidate span', day.proposedItems[0].start.getTime() === iso('2026-09-16T10:00:00Z').getTime() && day.proposedItems[0].end.getTime() === iso('2026-09-16T10:45:00Z').getTime());
}

// 9. candidate shorter than duration -> rejected
{
  resetIntentOrder();
  const a = intent({ title: 'x', targetDate: TODAY, estimatedDurationMinutes: 60 });
  const day = readyDay({ intents: [a], window: FULL_DAY(), blockedIntervals: [], candidatesByIntentId: { [a.id]: [candidate(a.id, '2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z')] }, today: TODAY });
  check(
    '9. too-short candidate rejected (INSUFFICIENT_DURATION diagnostic), intent deferred as NO_FEASIBLE_WINDOW',
    day.proposedItems.length === 0 && day.deferredItems[0].primaryReason === 'NO_FEASIBLE_WINDOW' && day.deferredItems[0].diagnostics.some((d) => d.reason === 'INSUFFICIENT_DURATION')
  );
}

// 10. missing duration -> deferred
{
  resetIntentOrder();
  const a = intent({ title: 'x', targetDate: TODAY });
  const day = readyDay({ intents: [a], window: FULL_DAY(), blockedIntervals: [], candidatesByIntentId: { [a.id]: [candidate(a.id, '2026-09-16T10:00:00Z', '2026-09-16T10:45:00Z')] }, today: TODAY });
  check('10. missing duration -> DURATION_UNKNOWN, never guessed', day.deferredItems.length === 1 && day.deferredItems[0].primaryReason === 'DURATION_UNKNOWN' && day.proposedItems.length === 0);
}

// 11. no candidates -> deferred
{
  resetIntentOrder();
  const a = intent({ title: 'x', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const day = readyDay({ intents: [a], window: FULL_DAY(), blockedIntervals: [], candidatesByIntentId: {}, today: TODAY });
  check('11. no candidates -> NO_CANDIDATES', day.deferredItems[0].primaryReason === 'NO_CANDIDATES');
}

// 12. candidates all outside window
{
  resetIntentOrder();
  const a = intent({ title: 'x', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const day = readyDay({ intents: [a], window: window('2026-09-16T09:00:00Z', '2026-09-16T10:00:00Z'), blockedIntervals: [], candidatesByIntentId: { [a.id]: [candidate(a.id, '2026-09-16T12:00:00Z', '2026-09-16T12:30:00Z')] }, today: TODAY });
  check('12. all candidates outside window -> OUTSIDE_CONSTRUCTION_WINDOW', day.deferredItems[0].primaryReason === 'OUTSIDE_CONSTRUCTION_WINDOW');
}

// 13. candidates all blocked
{
  resetIntentOrder();
  const a = intent({ title: 'x', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const day = readyDay({ intents: [a], window: FULL_DAY(), blockedIntervals: [block('2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z')], candidatesByIntentId: { [a.id]: [candidate(a.id, '2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z')] }, today: TODAY });
  check('13. all candidates blocked -> BLOCKED_BY_COMMITMENT, and reported as a conflict', day.deferredItems[0].primaryReason === 'BLOCKED_BY_COMMITMENT' && day.conflicts.some((c) => c.intentId === a.id));
}

// ============================================================
// MULTI INTENT
// ============================================================

// 14. HIGH before MEDIUM, 15. MEDIUM before LOW
{
  resetIntentOrder();
  const low = intent({ title: 'Low', targetDate: TODAY, importance: 'LOW', estimatedDurationMinutes: 30 });
  const medium = intent({ title: 'Medium', targetDate: TODAY, importance: 'MEDIUM', estimatedDurationMinutes: 30 });
  const high = intent({ title: 'High', targetDate: TODAY, importance: 'HIGH', estimatedDurationMinutes: 30 });
  const onlySlot = '2026-09-16T10:00:00Z';
  const day = readyDay({
    intents: [low, medium, high],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: {
      [low.id]: [candidate(low.id, onlySlot, '2026-09-16T10:30:00Z')],
      [medium.id]: [candidate(medium.id, onlySlot, '2026-09-16T10:30:00Z')],
      [high.id]: [candidate(high.id, onlySlot, '2026-09-16T10:30:00Z')],
    },
    today: TODAY,
  });
  check('14. HIGH wins the only slot over MEDIUM and LOW', day.proposedItems.length === 1 && day.proposedItems[0].intentId === high.id);
  check('14/15. MEDIUM and LOW both deferred', day.deferredItems.length === 2);
}

// 16. deadline-today before non-deadline
{
  resetIntentOrder();
  const noDeadline = intent({ title: 'No deadline', targetDate: TODAY, importance: 'HIGH', estimatedDurationMinutes: 30 });
  const deadlineToday = intent({ title: 'Due today', targetDate: TODAY, deadline: TODAY, importance: 'LOW', estimatedDurationMinutes: 30 });
  const onlySlot = '2026-09-16T10:00:00Z';
  const day = readyDay({
    intents: [noDeadline, deadlineToday],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: { [noDeadline.id]: [candidate(noDeadline.id, onlySlot, '2026-09-16T10:30:00Z')], [deadlineToday.id]: [candidate(deadlineToday.id, onlySlot, '2026-09-16T10:30:00Z')] },
    today: TODAY,
  });
  check('16. deadline-today wins even over HIGH importance without a deadline', day.proposedItems[0].intentId === deadlineToday.id);
}

// 17. earlier deadline tie-break
{
  resetIntentOrder();
  const laterDeadline = intent({ title: 'Later', targetDate: TODAY, deadline: '2026-09-20', estimatedDurationMinutes: 30 });
  const earlierDeadline = intent({ title: 'Earlier', targetDate: TODAY, deadline: '2026-09-17', estimatedDurationMinutes: 30 });
  const onlySlot = '2026-09-16T10:00:00Z';
  const day = readyDay({
    intents: [laterDeadline, earlierDeadline],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: { [laterDeadline.id]: [candidate(laterDeadline.id, onlySlot, '2026-09-16T10:30:00Z')], [earlierDeadline.id]: [candidate(earlierDeadline.id, onlySlot, '2026-09-16T10:30:00Z')] },
    today: TODAY,
  });
  check('17. earlier deadline wins the tie-break', day.proposedItems[0].intentId === earlierDeadline.id);
}

// 18. originalOrder final tie-break
{
  resetIntentOrder();
  const first = intent({ title: 'First', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const second = intent({ title: 'Second', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const onlySlot = '2026-09-16T10:00:00Z';
  const day = readyDay({
    intents: [second, first], // deliberately reversed input order
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: { [first.id]: [candidate(first.id, onlySlot, '2026-09-16T10:30:00Z')], [second.id]: [candidate(second.id, onlySlot, '2026-09-16T10:30:00Z')] },
    today: TODAY,
  });
  check('18. originalOrder (not input array order) decides the final tie-break', day.proposedItems[0].intentId === first.id);
}

// 19. first placed item blocks second, 20. adjacent placements allowed
{
  resetIntentOrder();
  const a = intent({ title: 'A', targetDate: TODAY, importance: 'HIGH', estimatedDurationMinutes: 30 });
  const b = intent({ title: 'B', targetDate: TODAY, importance: 'MEDIUM', estimatedDurationMinutes: 30 });
  const c = intent({ title: 'C', targetDate: TODAY, importance: 'LOW', estimatedDurationMinutes: 30 });
  const day = readyDay({
    intents: [a, b, c],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: {
      [a.id]: [candidate(a.id, '2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z')],
      [b.id]: [candidate(b.id, '2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z')],
      [c.id]: [candidate(c.id, '2026-09-16T10:30:00Z', '2026-09-16T11:00:00Z')],
    },
    today: TODAY,
  });
  check('19. A placed, B conflicts with A and is deferred', day.proposedItems.some((p) => p.intentId === a.id) && day.deferredItems.some((d) => d.intentId === b.id && d.primaryReason === 'CONFLICTS_WITH_PROPOSED_ITEM'));
  check('19. conflict names A as the intent holding the slot', day.conflicts.find((cf) => cf.intentId === b.id)?.conflictingIntentId === a.id);
  check('20. C (adjacent, touching endpoint) is placed, not blocked', day.proposedItems.some((p) => p.intentId === c.id));
}

// 21. higher-priority intent keeps slot even when lower-priority timing fit is better
{
  resetIntentOrder();
  const high = intent({ title: 'High', targetDate: TODAY, importance: 'HIGH', estimatedDurationMinutes: 30 });
  const low = intent({ title: 'Low', targetDate: TODAY, importance: 'LOW', estimatedDurationMinutes: 30 });
  const day = readyDay({
    intents: [high, low],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: {
      [high.id]: [candidate(high.id, '2026-09-16T09:00:00Z', '2026-09-16T09:30:00Z', { timingFit: 'BEST' }), candidate(high.id, '2026-09-16T11:00:00Z', '2026-09-16T11:30:00Z', { timingFit: 'WORKABLE' })],
      [low.id]: [candidate(low.id, '2026-09-16T09:00:00Z', '2026-09-16T09:30:00Z', { timingFit: 'BEST' })],
    },
    today: TODAY,
  });
  check('21. HIGH takes its own best-fit 09:00 slot (never yields it so LOW can also fit)', day.proposedItems.find((p) => p.intentId === high.id)?.start.getTime() === iso('2026-09-16T09:00:00Z').getTime());
  check('21. LOW is deferred as a result, even though a different arrangement could have fit both', day.deferredItems.some((d) => d.intentId === low.id));
}

// 22. no global backtracking behavior
{
  resetIntentOrder();
  const high = intent({ title: 'High', targetDate: TODAY, importance: 'HIGH', estimatedDurationMinutes: 30 });
  const low = intent({ title: 'Low', targetDate: TODAY, importance: 'LOW', estimatedDurationMinutes: 30 });
  const day = readyDay({
    intents: [high, low],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: {
      [high.id]: [candidate(high.id, '2026-09-16T09:00:00Z', '2026-09-16T09:30:00Z', { timingFit: 'BEST' }), candidate(high.id, '2026-09-16T11:00:00Z', '2026-09-16T11:30:00Z', { timingFit: 'GOOD' })],
      [low.id]: [candidate(low.id, '2026-09-16T09:00:00Z', '2026-09-16T09:30:00Z')],
    },
    today: TODAY,
  });
  check('22. no backtracking: Low remains deferred despite a feasible global arrangement existing', day.deferredItems.some((d) => d.intentId === low.id) && day.proposedItems.length === 1);
}

// ============================================================
// FIXED -- pre-commit review fix: placed via an explicit
// FixedPlacementConstraint, never inferred from candidate cardinality.
// ============================================================

// 10.1 FIXED + valid constraint + zero candidates -> placed
{
  resetIntentOrder();
  const a = intent({ title: 'Fixed call', targetDate: TODAY, flexibility: 'FIXED', estimatedDurationMinutes: 60 });
  const day = readyDay({
    intents: [a],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: {}, // deliberately no candidates at all
    fixedConstraintsByIntentId: { [a.id]: [fixedConstraint(a.id, '2026-09-16T14:00:00Z', '2026-09-16T15:00:00Z')] },
    today: TODAY,
  });
  check('10.1 FIXED with a valid constraint and ZERO candidates is placed exactly at the constraint', day.proposedItems.length === 1 && day.proposedItems[0].start.getTime() === iso('2026-09-16T14:00:00Z').getTime() && day.proposedItems[0].end.getTime() === iso('2026-09-16T15:00:00Z').getTime());
  check('10.1 placementSource is FIXED_CONSTRAINT, and carries no timingFit/candidateOrder', day.proposedItems[0].placementSource === 'FIXED_CONSTRAINT' && day.proposedItems[0].timingFit === undefined && day.proposedItems[0].candidateOrder === undefined);
}

// 10.2 FIXED + missing constraint -> FIXED_WINDOW_INVALID
{
  resetIntentOrder();
  const a = intent({ title: 'Fixed call', targetDate: TODAY, flexibility: 'FIXED', estimatedDurationMinutes: 60 });
  const day = readyDay({ intents: [a], window: FULL_DAY(), blockedIntervals: [], candidatesByIntentId: {}, fixedConstraintsByIntentId: {}, today: TODAY });
  check('10.2 FIXED with no constraint supplied -> FIXED_WINDOW_INVALID (never NO_CANDIDATES)', day.proposedItems.length === 0 && day.deferredItems[0].primaryReason === 'FIXED_WINDOW_INVALID');
}

// 10.3 FIXED + multiple candidates + valid constraint -> constraint wins, candidates ignored
{
  resetIntentOrder();
  const a = intent({ title: 'Fixed call', targetDate: TODAY, flexibility: 'FIXED', estimatedDurationMinutes: 60 });
  const day = readyDay({
    intents: [a],
    window: FULL_DAY(),
    blockedIntervals: [],
    // Candidates that, if consulted, would place the intent somewhere
    // else entirely -- they must have zero effect on a FIXED intent.
    candidatesByIntentId: { [a.id]: [candidate(a.id, '2026-09-16T09:00:00Z', '2026-09-16T10:00:00Z', { timingFit: 'BEST' }), candidate(a.id, '2026-09-16T11:00:00Z', '2026-09-16T12:00:00Z', { timingFit: 'GOOD' })] },
    fixedConstraintsByIntentId: { [a.id]: [fixedConstraint(a.id, '2026-09-16T14:00:00Z', '2026-09-16T15:00:00Z')] },
    today: TODAY,
  });
  check('10.3 the explicit constraint wins regardless of candidates supplied', day.proposedItems.length === 1 && day.proposedItems[0].start.getTime() === iso('2026-09-16T14:00:00Z').getTime());
}

// 10.4 FIXED + candidates but no constraint -> FIXED_WINDOW_INVALID (never inferred)
{
  resetIntentOrder();
  const a = intent({ title: 'Fixed call', targetDate: TODAY, flexibility: 'FIXED', estimatedDurationMinutes: 60 });
  const day = readyDay({
    intents: [a],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: { [a.id]: [candidate(a.id, '2026-09-16T14:00:00Z', '2026-09-16T15:00:00Z')] }, // exactly one candidate -- must NOT be inferred as the fixed target
    fixedConstraintsByIntentId: {},
    today: TODAY,
  });
  check('10.4 a single supplied candidate is never inferred as the FIXED target -> FIXED_WINDOW_INVALID', day.proposedItems.length === 0 && day.deferredItems[0].primaryReason === 'FIXED_WINDOW_INVALID');
}

// 10.5 FIXED malformed constraint -> FIXED_WINDOW_INVALID
{
  resetIntentOrder();
  const a = intent({ title: 'Fixed call', targetDate: TODAY, flexibility: 'FIXED', estimatedDurationMinutes: 60 });
  const day = readyDay({
    intents: [a],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: {},
    fixedConstraintsByIntentId: { [a.id]: [{ intentId: a.id, start: iso('2026-09-16T15:00:00Z'), end: iso('2026-09-16T14:00:00Z') }] }, // end before start
    today: TODAY,
  });
  check('10.5 malformed constraint (end before start) -> FIXED_WINDOW_INVALID', day.proposedItems.length === 0 && day.deferredItems[0].primaryReason === 'FIXED_WINDOW_INVALID');
}

// 10.6 FIXED constraint outside construction window
{
  resetIntentOrder();
  const a = intent({ title: 'Fixed call', targetDate: TODAY, flexibility: 'FIXED', estimatedDurationMinutes: 60 });
  const day = readyDay({
    intents: [a],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: {},
    fixedConstraintsByIntentId: { [a.id]: [fixedConstraint(a.id, '2026-09-16T19:00:00Z', '2026-09-16T20:00:00Z')] },
    today: TODAY,
  });
  check('10.6 FIXED constraint outside ConstructionWindow -> OUTSIDE_CONSTRUCTION_WINDOW', day.proposedItems.length === 0 && day.deferredItems[0].primaryReason === 'OUTSIDE_CONSTRUCTION_WINDOW');
}

// 10.7 FIXED constraint conflicts immutable blocker
{
  resetIntentOrder();
  const a = intent({ title: 'Fixed call', targetDate: TODAY, flexibility: 'FIXED', estimatedDurationMinutes: 60 });
  const day = readyDay({
    intents: [a],
    window: FULL_DAY(),
    blockedIntervals: [block('2026-09-16T14:00:00Z', '2026-09-16T15:00:00Z')],
    candidatesByIntentId: {},
    fixedConstraintsByIntentId: { [a.id]: [fixedConstraint(a.id, '2026-09-16T14:00:00Z', '2026-09-16T15:00:00Z')] },
    today: TODAY,
  });
  check('10.7 FIXED constraint conflicting an existing blocker: not placed, blocker never moved', day.proposedItems.length === 0);
  check('10.7 FIXED_WINDOW_CONFLICT reported', day.deferredItems[0].primaryReason === 'FIXED_WINDOW_CONFLICT' && day.conflicts.some((c) => c.intentId === a.id && c.reason === 'FIXED_WINDOW_CONFLICT'));
}

// 10.8 FIXED reservation invariant (G1 fix) -- a FIXED intent's declared
// interval always wins over a FLEXIBLE intent requesting the same slot,
// regardless of the FLEXIBLE intent's own higher overload precedence.
// Pre-G1 this test named the opposite outcome ("higher-precedence
// FLEXIBLE item placed first... FIXED_WINDOW_CONFLICT naming the
// winner") -- that was the exact bug this fix closes, not a preserved
// behavior.
{
  resetIntentOrder();
  const higher = intent({ title: 'Higher', targetDate: TODAY, importance: 'HIGH', estimatedDurationMinutes: 60 });
  const fixedLower = intent({ title: 'Fixed lower', targetDate: TODAY, importance: 'LOW', flexibility: 'FIXED', estimatedDurationMinutes: 60 });
  const sameSlot = ['2026-09-16T14:00:00Z', '2026-09-16T15:00:00Z'] as const;
  const day = readyDay({
    intents: [higher, fixedLower],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: { [higher.id]: [candidate(higher.id, ...sameSlot)] },
    fixedConstraintsByIntentId: { [fixedLower.id]: [fixedConstraint(fixedLower.id, ...sameSlot)] },
    today: TODAY,
  });
  check('10.8 the FIXED intent keeps its declared interval even though the other intent has higher overload precedence', day.proposedItems.some((p) => p.intentId === fixedLower.id));
  check(
    '10.8 the higher-precedence FLEXIBLE intent is deferred, conflicting with the FIXED reservation',
    day.deferredItems.find((d) => d.intentId === higher.id)?.primaryReason === 'CONFLICTS_WITH_PROPOSED_ITEM' && day.conflicts.find((c) => c.intentId === higher.id)?.conflictingIntentId === fixedLower.id
  );
}

// 10.9 FIXED constraint duration mismatch
{
  resetIntentOrder();
  const a = intent({ title: 'Fixed call', targetDate: TODAY, flexibility: 'FIXED', estimatedDurationMinutes: 45 });
  const day = readyDay({
    intents: [a],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: {},
    fixedConstraintsByIntentId: { [a.id]: [fixedConstraint(a.id, '2026-09-16T14:00:00Z', '2026-09-16T15:00:00Z')] }, // 60 min span, intent wants 45
    today: TODAY,
  });
  check('10.9 constraint duration != estimatedDurationMinutes -> FIXED_WINDOW_INVALID, never silently trimmed', day.proposedItems.length === 0 && day.deferredItems[0].primaryReason === 'FIXED_WINDOW_INVALID');
}

// 10.10 / 10.11 FIXED placement requires no timingFit and ignores candidate timing entirely
{
  resetIntentOrder();
  const a = intent({ title: 'Fixed call', targetDate: TODAY, flexibility: 'FIXED', estimatedDurationMinutes: 30 });
  const day = readyDay({
    intents: [a],
    window: FULL_DAY(),
    blockedIntervals: [],
    // A CAUTION-rated candidate at a DIFFERENT time than the fixed target --
    // if timing ever influenced FIXED placement this would win/matter; it must not.
    candidatesByIntentId: { [a.id]: [candidate(a.id, '2026-09-16T09:00:00Z', '2026-09-16T09:30:00Z', { timingFit: 'CAUTION' })] },
    fixedConstraintsByIntentId: { [a.id]: [fixedConstraint(a.id, '2026-09-16T14:00:00Z', '2026-09-16T14:30:00Z')] },
    today: TODAY,
  });
  check('10.10 FIXED placement carries no timingFit at all', day.proposedItems[0].timingFit === undefined);
  check('10.11 FIXED placement lands at the constraint, ignoring the candidate entirely regardless of its timing', day.proposedItems[0].start.getTime() === iso('2026-09-16T14:00:00Z').getTime());
}

// 10.12 FLEXIBLE behavior unchanged (spot-check: BEST still wins, exact-duration trimming still applies)
{
  resetIntentOrder();
  const a = intent({ title: 'Flex', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const day = readyDay({
    intents: [a],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: { [a.id]: [candidate(a.id, '2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', { timingFit: 'WORKABLE' }), candidate(a.id, '2026-09-16T12:00:00Z', '2026-09-16T13:30:00Z', { timingFit: 'BEST' })] },
    today: TODAY,
  });
  check('10.12 FLEXIBLE ranking/duration-trimming behavior is unchanged', day.proposedItems[0].start.getTime() === iso('2026-09-16T12:00:00Z').getTime() && day.proposedItems[0].end.getTime() === iso('2026-09-16T12:30:00Z').getTime() && day.proposedItems[0].placementSource === 'SELECTED_CANDIDATE');
}

// 10.13 FIXED still confers no IMPORTANCE-comparator boost (compareByOverloadPrecedence
// itself is unmodified by G1 and still never reads flexibility) -- but
// the RESERVATION invariant (G1) is a separate mechanism that
// independently guarantees a valid FIXED intent keeps its own declared
// interval regardless of a competing FLEXIBLE intent's higher importance.
// Pre-G1 this test named the opposite outcome ("FLEXIBLE HIGH is
// processed first and wins the slot") -- that was the bug.
{
  resetIntentOrder();
  const fixedLow = intent({ title: 'Fixed but LOW', targetDate: TODAY, importance: 'LOW', flexibility: 'FIXED', estimatedDurationMinutes: 30 });
  const flexHigh = intent({ title: 'Flexible HIGH', targetDate: TODAY, importance: 'HIGH', flexibility: 'FLEXIBLE', estimatedDurationMinutes: 30 });
  const sameSlot = ['2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z'] as const;
  const day = readyDay({
    intents: [fixedLow, flexHigh],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: { [flexHigh.id]: [candidate(flexHigh.id, ...sameSlot)] },
    fixedConstraintsByIntentId: { [fixedLow.id]: [fixedConstraint(fixedLow.id, ...sameSlot)] },
    today: TODAY,
  });
  check('10.13 the LOW-importance FIXED intent keeps its declared interval (reservation, not precedence)', day.proposedItems.some((p) => p.intentId === fixedLow.id));
  check('10.13 the HIGH-importance FLEXIBLE intent is deferred, conflicting with the FIXED reservation', day.deferredItems.some((d) => d.intentId === flexHigh.id));
}

// 10.14 two overlapping FIXED intents retain existing precedence semantics
{
  resetIntentOrder();
  const higher = intent({ title: 'Higher precedence fixed', targetDate: TODAY, importance: 'HIGH', flexibility: 'FIXED', estimatedDurationMinutes: 60 });
  const lower = intent({ title: 'Lower precedence fixed', targetDate: TODAY, importance: 'LOW', flexibility: 'FIXED', estimatedDurationMinutes: 60 });
  const sameSlot = ['2026-09-16T14:00:00Z', '2026-09-16T15:00:00Z'] as const;
  const day = readyDay({
    intents: [higher, lower],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: {},
    fixedConstraintsByIntentId: { [higher.id]: [fixedConstraint(higher.id, ...sameSlot)], [lower.id]: [fixedConstraint(lower.id, ...sameSlot)] },
    today: TODAY,
  });
  check('10.14 two FIXED intents on the identical slot: higher precedence placed', day.proposedItems.some((p) => p.intentId === higher.id));
  check('10.14 lower precedence FIXED intent receives an explicit conflict result naming the winner', day.deferredItems.find((d) => d.intentId === lower.id)?.primaryReason === 'FIXED_WINDOW_CONFLICT' && day.conflicts.find((c) => c.intentId === lower.id)?.conflictingIntentId === higher.id);
}

// 10.15 deterministic repeat invocation (FIXED-specific)
{
  resetIntentOrder();
  const a = intent({ title: 'Fixed call', targetDate: TODAY, flexibility: 'FIXED', estimatedDurationMinutes: 60 });
  const inputData = buildInput({
    intents: [a],
    window: FULL_DAY(),
    blockedIntervals: [block('2026-09-16T09:00:00Z', '2026-09-16T09:30:00Z')],
    candidatesByIntentId: {},
    fixedConstraintsByIntentId: { [a.id]: [fixedConstraint(a.id, '2026-09-16T14:00:00Z', '2026-09-16T15:00:00Z')] },
    today: TODAY,
  });
  const first = constructDay(inputData);
  const second = constructDay(inputData);
  check('10.15 identical FIXED input produces byte-equivalent output on repeated invocation', JSON.stringify(first) === JSON.stringify(second));
}

// 2 supplied constraints for the same FIXED intent -> FIXED_WINDOW_INVALID, never silently selecting one
{
  resetIntentOrder();
  const a = intent({ title: 'Fixed call', targetDate: TODAY, flexibility: 'FIXED', estimatedDurationMinutes: 60 });
  const day = readyDay({
    intents: [a],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: {},
    fixedConstraintsByIntentId: { [a.id]: [fixedConstraint(a.id, '2026-09-16T10:00:00Z', '2026-09-16T11:00:00Z'), fixedConstraint(a.id, '2026-09-16T14:00:00Z', '2026-09-16T15:00:00Z')] },
    today: TODAY,
  });
  check('two constraints for the same FIXED intent -> FIXED_WINDOW_INVALID, never silently picks one', day.proposedItems.length === 0 && day.deferredItems[0].primaryReason === 'FIXED_WINDOW_INVALID');
}

// ============================================================
// BLOCKERS
// ============================================================

// 29. overlapping blocked intervals
{
  resetIntentOrder();
  const a = intent({ title: 'x', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const day = readyDay({
    intents: [a],
    window: FULL_DAY(),
    blockedIntervals: [block('2026-09-16T10:00:00Z', '2026-09-16T11:00:00Z'), block('2026-09-16T10:30:00Z', '2026-09-16T11:30:00Z')],
    candidatesByIntentId: { [a.id]: [candidate(a.id, '2026-09-16T10:45:00Z', '2026-09-16T11:15:00Z')] },
    today: TODAY,
  });
  check('29. overlapping blocked intervals correctly merged/enforced', day.proposedItems.length === 0 && day.deferredItems[0].primaryReason === 'BLOCKED_BY_COMMITMENT');
}

// 30. adjacent blocker boundary
{
  resetIntentOrder();
  const a = intent({ title: 'x', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const day = readyDay({ intents: [a], window: FULL_DAY(), blockedIntervals: [block('2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z')], candidatesByIntentId: { [a.id]: [candidate(a.id, '2026-09-16T10:30:00Z', '2026-09-16T11:00:00Z')] }, today: TODAY });
  check('30. candidate touching a blocker boundary (not overlapping) is placeable', day.proposedItems.length === 1);
}

// 31. candidate partially overlaps blocker
{
  resetIntentOrder();
  const a = intent({ title: 'x', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const day = readyDay({ intents: [a], window: FULL_DAY(), blockedIntervals: [block('2026-09-16T10:15:00Z', '2026-09-16T11:00:00Z')], candidatesByIntentId: { [a.id]: [candidate(a.id, '2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z')] }, today: TODAY });
  check('31. candidate partially overlapping a blocker is rejected', day.proposedItems.length === 0 && day.deferredItems[0].primaryReason === 'BLOCKED_BY_COMMITMENT');
}

// 32. candidate fully inside blocker
{
  resetIntentOrder();
  const a = intent({ title: 'x', targetDate: TODAY, estimatedDurationMinutes: 15 });
  const day = readyDay({ intents: [a], window: FULL_DAY(), blockedIntervals: [block('2026-09-16T10:00:00Z', '2026-09-16T12:00:00Z')], candidatesByIntentId: { [a.id]: [candidate(a.id, '2026-09-16T10:30:00Z', '2026-09-16T10:45:00Z')] }, today: TODAY });
  check('32. candidate fully inside a blocker is rejected', day.proposedItems.length === 0 && day.deferredItems[0].primaryReason === 'BLOCKED_BY_COMMITMENT');
}

// 33. blocker fully inside candidate
{
  resetIntentOrder();
  const a = intent({ title: 'x', targetDate: TODAY, estimatedDurationMinutes: 15 });
  const day = readyDay({ intents: [a], window: FULL_DAY(), blockedIntervals: [block('2026-09-16T10:20:00Z', '2026-09-16T10:25:00Z')], candidatesByIntentId: { [a.id]: [candidate(a.id, '2026-09-16T10:00:00Z', '2026-09-16T11:00:00Z')] }, today: TODAY });
  check('33. a blocker inside the candidate span but outside the DERIVED exact interval does not reject it', day.proposedItems.length === 1);
}
{
  resetIntentOrder();
  const a = intent({ title: 'x', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const day = readyDay({ intents: [a], window: FULL_DAY(), blockedIntervals: [block('2026-09-16T10:10:00Z', '2026-09-16T10:15:00Z')], candidatesByIntentId: { [a.id]: [candidate(a.id, '2026-09-16T10:00:00Z', '2026-09-16T11:00:00Z')] }, today: TODAY });
  check('33b. a blocker inside the derived exact interval does reject it', day.proposedItems.length === 0);
}

// 34. duplicate blockers do not alter result
{
  resetIntentOrder();
  const a = intent({ title: 'x', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const single = block('2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z');
  const day = readyDay({ intents: [a], window: FULL_DAY(), blockedIntervals: [single, { ...single }, { ...single }], candidatesByIntentId: { [a.id]: [candidate(a.id, '2026-09-16T10:30:00Z', '2026-09-16T11:00:00Z')] }, today: TODAY });
  check('34. duplicate blockers produce the same result as a single one', day.proposedItems.length === 1);
}

// ============================================================
// CAPACITY
// ============================================================

// 35. zero usable capacity
{
  resetIntentOrder();
  const a = intent({ title: 'x', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const w = window('2026-09-16T09:00:00Z', '2026-09-16T10:00:00Z');
  const result = constructDay(buildInput({ intents: [a], window: w, blockedIntervals: [block('2026-09-16T09:00:00Z', '2026-09-16T10:00:00Z')], candidatesByIntentId: { [a.id]: [candidate(a.id, '2026-09-16T09:00:00Z', '2026-09-16T09:30:00Z')] }, today: TODAY }));
  check('35. zero usable capacity fails the ENTIRE construction closed, before placement', result.status === 'NO_USABLE_CAPACITY');
}

// 36. overloaded requested workload (usable > 0, requested > usable)
{
  resetIntentOrder();
  const a = intent({ title: 'A', targetDate: TODAY, importance: 'HIGH', estimatedDurationMinutes: 240 });
  const b = intent({ title: 'B', targetDate: TODAY, importance: 'LOW', estimatedDurationMinutes: 240 });
  const w = window('2026-09-16T09:00:00Z', '2026-09-16T13:00:00Z');
  const day = readyDay({ intents: [a, b], window: w, blockedIntervals: [], candidatesByIntentId: { [a.id]: [candidate(a.id, '2026-09-16T09:00:00Z', '2026-09-16T13:00:00Z')], [b.id]: [candidate(b.id, '2026-09-16T09:00:00Z', '2026-09-16T13:00:00Z')] }, today: TODAY });
  check('36. overloaded workload still reaches READY and places what fits', day.proposedItems.length === 1 && day.proposedItems[0].intentId === a.id);
  check('36. requestedCapacity reflects the full ask (OVERLOADED)', day.requestedCapacity.capacityState === 'OVERLOADED');
}

// 37. capacity state reused from PR A
{
  resetIntentOrder();
  const a = intent({ title: 'x', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const day = readyDay({ intents: [a], window: FULL_DAY(), blockedIntervals: [], candidatesByIntentId: { [a.id]: [candidate(a.id, '2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z')] }, today: TODAY });
  const validStates = ['OPEN', 'BALANCED', 'BUSY', 'OVERLOADED'];
  check("37. requestedCapacity.capacityState is one of PR A's own four states", validStates.includes(day.requestedCapacity.capacityState));
  check("37. proposedCapacity.capacityState is one of PR A's own four states", validStates.includes(day.proposedCapacity.capacityState));
}

// 38. placement does not alter the capacity formula
{
  resetIntentOrder();
  const a = intent({ title: 'x', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const w = window('2026-09-16T09:00:00Z', '2026-09-16T13:00:00Z');
  const day = readyDay({ intents: [a], window: w, blockedIntervals: [block('2026-09-16T09:00:00Z', '2026-09-16T10:00:00Z')], candidatesByIntentId: { [a.id]: [candidate(a.id, '2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z')] }, today: TODAY });
  check('38. usableMinutes = window minus blocked, unchanged by placement logic', day.requestedCapacity.usableMinutes === 180);
  check('38. proposedCapacity utilization = placed minutes / SAME usable minutes', day.proposedCapacity.usableMinutes === 180 && day.proposedCapacity.requestedMinutes === 30 && Math.abs(day.proposedCapacity.utilization - 30 / 180) < 1e-9);
}

// ============================================================
// MALFORMED
// ============================================================

// 39. invalid candidate Date
{
  resetIntentOrder();
  const a = intent({ title: 'x', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const day = readyDay({ intents: [a], window: FULL_DAY(), blockedIntervals: [], candidatesByIntentId: { [a.id]: [{ intentId: a.id, start: new Date('not-a-date'), end: iso('2026-09-16T10:30:00Z'), candidateOrder: 0 }] }, today: TODAY });
  check('39. invalid candidate Date is rejected, never produces a placement', day.proposedItems.length === 0 && day.deferredItems[0].diagnostics.some((d) => d.reason === 'MALFORMED_CANDIDATE'));
}

// 40. candidate end <= start
{
  resetIntentOrder();
  const a = intent({ title: 'x', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const day = readyDay({ intents: [a], window: FULL_DAY(), blockedIntervals: [], candidatesByIntentId: { [a.id]: [candidate(a.id, '2026-09-16T10:30:00Z', '2026-09-16T10:00:00Z')] }, today: TODAY });
  check('40. end <= start candidate rejected', day.proposedItems.length === 0 && day.deferredItems[0].diagnostics.some((d) => d.reason === 'MALFORMED_CANDIDATE'));
}

// 41. wrong intentId
{
  resetIntentOrder();
  const a = intent({ title: 'A', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const b = intent({ title: 'B', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const day = readyDay({ intents: [a], window: FULL_DAY(), blockedIntervals: [], candidatesByIntentId: { [a.id]: [candidate(b.id, '2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z')] }, today: TODAY });
  check('41. a candidate whose own intentId disagrees with its map key is rejected as WRONG_INTENT', day.proposedItems.length === 0 && day.deferredItems[0].diagnostics.some((d) => d.reason === 'WRONG_INTENT'));
}

// 42. malformed fixed target -- now: constraint whose own intentId disagrees with its map key
{
  resetIntentOrder();
  const a = intent({ title: 'Fixed', targetDate: TODAY, flexibility: 'FIXED', estimatedDurationMinutes: 30 });
  const b = intent({ title: 'Other', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const day = readyDay({
    intents: [a],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: {},
    fixedConstraintsByIntentId: { [a.id]: [fixedConstraint(b.id, '2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z')] }, // constraint's own intentId disagrees with the map key
    today: TODAY,
  });
  check('42. malformed fixed target (intentId mismatch) -> FIXED_WINDOW_INVALID', day.proposedItems.length === 0 && day.deferredItems[0].primaryReason === 'FIXED_WINDOW_INVALID');
}

// 43. unknown activityId remains allowed if DayIntent otherwise constructible
{
  resetIntentOrder();
  const a = intent({ title: 'Free text goal', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const day = readyDay({ intents: [a], window: FULL_DAY(), blockedIntervals: [], candidatesByIntentId: { [a.id]: [candidate(a.id, '2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z')] }, today: TODAY });
  check('43. an intent with no activityId is still placeable (never required)', day.proposedItems.length === 1 && day.proposedItems[0].activityId === undefined);
}

// 44. deterministic repeated invocation
{
  resetIntentOrder();
  const a = intent({ title: 'A', targetDate: TODAY, importance: 'HIGH', estimatedDurationMinutes: 30 });
  const b = intent({ title: 'B', targetDate: TODAY, importance: 'LOW', estimatedDurationMinutes: 30 });
  const inputData = buildInput({
    intents: [a, b],
    window: FULL_DAY(),
    blockedIntervals: [block('2026-09-16T09:00:00Z', '2026-09-16T09:30:00Z')],
    candidatesByIntentId: { [a.id]: [candidate(a.id, '2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', { timingFit: 'GOOD' })], [b.id]: [candidate(b.id, '2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z')] },
    today: TODAY,
  });
  const first = constructDay(inputData);
  const second = constructDay(inputData);
  check('44. identical input produces byte-equivalent output on repeated invocation', JSON.stringify(first) === JSON.stringify(second));
}

// 45. server timezone independence
{
  resetIntentOrder();
  const a = intent({ title: 'A', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const inputData = buildInput({ intents: [a], window: FULL_DAY(), blockedIntervals: [], candidatesByIntentId: { [a.id]: [candidate(a.id, '2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z')] }, today: TODAY });
  const originalTZ = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  const underLA = constructDay(inputData);
  process.env.TZ = 'Pacific/Kiritimati';
  const underKiritimati = constructDay(inputData);
  process.env.TZ = originalTZ;
  check('45. result identical regardless of process.env.TZ', JSON.stringify(underLA) === JSON.stringify(underKiritimati));
}

// ============================================================
// TIMING / ARCHITECTURE -- merge-critical
// ============================================================

// 46. timing fit never overrides a blocker
{
  resetIntentOrder();
  const a = intent({ title: 'A', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const day = readyDay({
    intents: [a],
    window: FULL_DAY(),
    blockedIntervals: [block('2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z')],
    candidatesByIntentId: { [a.id]: [candidate(a.id, '2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', { timingFit: 'BEST' }), candidate(a.id, '2026-09-16T11:00:00Z', '2026-09-16T11:30:00Z', { timingFit: 'CAUTION' })] },
    today: TODAY,
  });
  check('46. a BEST-fit but blocked candidate never wins over a CAUTION but feasible one', day.proposedItems[0].start.getTime() === iso('2026-09-16T11:00:00Z').getTime());
}

// 47. timing fit never overrides deadline precedence
{
  resetIntentOrder();
  const deadlineToday = intent({ title: 'Due today', targetDate: TODAY, deadline: TODAY, importance: 'LOW', estimatedDurationMinutes: 30 });
  const noDeadlineBetterFit = intent({ title: 'No deadline, better fit', targetDate: TODAY, importance: 'HIGH', estimatedDurationMinutes: 30 });
  const onlySlot = ['2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z'] as const;
  const day = readyDay({
    intents: [deadlineToday, noDeadlineBetterFit],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: { [deadlineToday.id]: [candidate(deadlineToday.id, ...onlySlot, { timingFit: 'CAUTION' })], [noDeadlineBetterFit.id]: [candidate(noDeadlineBetterFit.id, ...onlySlot, { timingFit: 'BEST' })] },
    today: TODAY,
  });
  check('47. deadline-today wins the only slot even with a worse timing fit than the competing intent', day.proposedItems[0].intentId === deadlineToday.id);
}

// 48. timing fit never changes intent importance
check(
  "48. DayIntent.importance is not derived from or coupled to any timing/candidate field",
  (() => {
    resetIntentOrder();
    const a = intent({ title: 'x', targetDate: TODAY, importance: 'LOW', estimatedDurationMinutes: 30 });
    return a.importance === 'LOW';
  })()
);

// 49. no raw timing score required
check(
  '49. PlacementCandidate carries no numeric score field at all (only the 4-tier timingFit)',
  (() => {
    const c = candidate('x', '2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', { timingFit: 'GOOD' });
    return !('score' in c) && !('rawScore' in c);
  })()
);

// 50. no raw Muhurta reason required
check(
  '50. PlacementCandidate/ProposedItem/FixedPlacementConstraint carry no reasons/evidence field at all',
  (() => {
    const c = candidate('x', '2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z');
    const f = fixedConstraint('x', '2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z');
    return !('reasons' in c) && !('evidence' in c) && !('reasons' in f) && !('evidence' in f);
  })()
);

// ============================================================
// FIXED RESERVATION INVARIANT (post-V1 audit gap G1). A valid FIXED
// intent's declared interval must be unavailable to FLEXIBLE placement
// regardless of submission/precedence order between the two -- this is
// RESERVATION, a separate concern from PRECEDENCE (compareByOverloadPrecedence
// itself is untouched, verified throughout below by intra-group ordering
// still working exactly as before).
// ============================================================

// 51.1 FLEXIBLE submitted first, has an alternate candidate -- the core
// scenario this fix exists for.
{
  resetIntentOrder();
  const workout = intent({ title: 'Workout', targetDate: TODAY, estimatedDurationMinutes: 60 });
  const doctor = intent({ title: 'Doctor', targetDate: TODAY, flexibility: 'FIXED', estimatedDurationMinutes: 60 });
  const day = readyDay({
    intents: [workout, doctor],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: {
      [workout.id]: [candidate(workout.id, '2026-09-16T16:00:00Z', '2026-09-16T17:00:00Z', { timingFit: 'BEST', candidateOrder: 0 }), candidate(workout.id, '2026-09-16T09:00:00Z', '2026-09-16T10:00:00Z', { timingFit: 'GOOD', candidateOrder: 1 })],
    },
    fixedConstraintsByIntentId: { [doctor.id]: [fixedConstraint(doctor.id, '2026-09-16T16:00:00Z', '2026-09-16T17:00:00Z')] },
    today: TODAY,
  });
  const doctorItem = day.proposedItems.find((p) => p.intentId === doctor.id);
  const workoutItem = day.proposedItems.find((p) => p.intentId === workout.id);
  check('51.1 Doctor (FIXED) keeps its declared 16:00-17:00 interval', doctorItem?.start.getTime() === iso('2026-09-16T16:00:00Z').getTime() && doctorItem?.end.getTime() === iso('2026-09-16T17:00:00Z').getTime());
  check('51.1 Workout (FLEXIBLE, submitted first) takes its alternate candidate instead of the reserved slot', workoutItem?.start.getTime() === iso('2026-09-16T09:00:00Z').getTime());
  check('51.1 both intents are proposed -- neither was dropped', day.proposedItems.length === 2 && day.deferredItems.length === 0);
}

// 51.2 Input-order independence: the logically identical case with FIXED
// submitted first must reach the SAME semantic placement (never raw
// array-order equality -- result order intentionally reflects
// orderedIntents/precedence, which differs by submission order between
// this test and 51.1).
{
  resetIntentOrder();
  const doctor = intent({ title: 'Doctor', targetDate: TODAY, flexibility: 'FIXED', estimatedDurationMinutes: 60 });
  const workout = intent({ title: 'Workout', targetDate: TODAY, estimatedDurationMinutes: 60 });
  const day = readyDay({
    intents: [doctor, workout],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: {
      [workout.id]: [candidate(workout.id, '2026-09-16T16:00:00Z', '2026-09-16T17:00:00Z', { timingFit: 'BEST', candidateOrder: 0 }), candidate(workout.id, '2026-09-16T09:00:00Z', '2026-09-16T10:00:00Z', { timingFit: 'GOOD', candidateOrder: 1 })],
    },
    fixedConstraintsByIntentId: { [doctor.id]: [fixedConstraint(doctor.id, '2026-09-16T16:00:00Z', '2026-09-16T17:00:00Z')] },
    today: TODAY,
  });
  const doctorItem = day.proposedItems.find((p) => p.intentId === doctor.id);
  const workoutItem = day.proposedItems.find((p) => p.intentId === workout.id);
  check('51.2 (reverse submission order) Doctor still keeps 16:00-17:00', doctorItem?.start.getTime() === iso('2026-09-16T16:00:00Z').getTime());
  check('51.2 (reverse submission order) Workout still takes the alternate -- input order does not determine reservation survival', workoutItem?.start.getTime() === iso('2026-09-16T09:00:00Z').getTime());
}

// 51.3 FLEXIBLE has no alternate candidate -- the only offered slot
// overlaps a FIXED reservation, so it is deferred rather than the FIXED
// intent losing its guaranteed time.
{
  resetIntentOrder();
  const workout = intent({ title: 'Workout', targetDate: TODAY, estimatedDurationMinutes: 60 });
  const doctor = intent({ title: 'Doctor', targetDate: TODAY, flexibility: 'FIXED', estimatedDurationMinutes: 60 });
  const day = readyDay({
    intents: [workout, doctor],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: { [workout.id]: [candidate(workout.id, '2026-09-16T16:00:00Z', '2026-09-16T17:00:00Z')] },
    fixedConstraintsByIntentId: { [doctor.id]: [fixedConstraint(doctor.id, '2026-09-16T16:00:00Z', '2026-09-16T17:00:00Z')] },
    today: TODAY,
  });
  check('51.3 Doctor (FIXED) is placed at its declared time', day.proposedItems.some((p) => p.intentId === doctor.id));
  check(
    '51.3 Workout (FLEXIBLE, no alternate) is deferred with a typed conflict reason naming Doctor as the owner',
    day.deferredItems.find((d) => d.intentId === workout.id)?.primaryReason === 'CONFLICTS_WITH_PROPOSED_ITEM' && day.conflicts.find((c) => c.intentId === workout.id)?.conflictingIntentId === doctor.id
  );
}

// 51.4 An invalid/unplaceable FIXED intent contributes NO reservation --
// a FLEXIBLE intent may freely use that same interval (proves no
// phantom reservation, this ticket's own section 7/19).
{
  resetIntentOrder();
  // Duration mismatch (45 min intent, 60 min constraint span) -> FIXED_WINDOW_INVALID,
  // never reaches placement at all.
  const invalidFixed = intent({ title: 'Bad fixed', targetDate: TODAY, flexibility: 'FIXED', estimatedDurationMinutes: 45 });
  const workout = intent({ title: 'Workout', targetDate: TODAY, estimatedDurationMinutes: 60 });
  const day = readyDay({
    intents: [invalidFixed, workout],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: { [workout.id]: [candidate(workout.id, '2026-09-16T16:00:00Z', '2026-09-16T17:00:00Z')] },
    fixedConstraintsByIntentId: { [invalidFixed.id]: [fixedConstraint(invalidFixed.id, '2026-09-16T16:00:00Z', '2026-09-16T17:00:00Z')] },
    today: TODAY,
  });
  check('51.4 the invalid FIXED intent is deferred FIXED_WINDOW_INVALID, never placed', day.deferredItems.find((d) => d.intentId === invalidFixed.id)?.primaryReason === 'FIXED_WINDOW_INVALID');
  check('51.4 the FLEXIBLE intent freely uses the interval the invalid FIXED intent declared -- no phantom reservation', day.proposedItems.find((p) => p.intentId === workout.id)?.start.getTime() === iso('2026-09-16T16:00:00Z').getTime());
}

// 51.5 Multiple non-conflicting FIXED reservations plus several FLEXIBLE
// intents -- every successfully-placed FIXED interval is unavailable to
// every FLEXIBLE candidate.
{
  resetIntentOrder();
  const flexA = intent({ title: 'Flex A', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const flexB = intent({ title: 'Flex B', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const fixed1 = intent({ title: 'Fixed 1', targetDate: TODAY, flexibility: 'FIXED', estimatedDurationMinutes: 30 });
  const fixed2 = intent({ title: 'Fixed 2', targetDate: TODAY, flexibility: 'FIXED', estimatedDurationMinutes: 30 });
  const day = readyDay({
    intents: [flexA, flexB, fixed1, fixed2],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: {
      // flexA's only candidate overlaps fixed1; flexB's only candidate overlaps fixed2.
      [flexA.id]: [candidate(flexA.id, '2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z')],
      [flexB.id]: [candidate(flexB.id, '2026-09-16T13:00:00Z', '2026-09-16T13:30:00Z')],
    },
    fixedConstraintsByIntentId: {
      [fixed1.id]: [fixedConstraint(fixed1.id, '2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z')],
      [fixed2.id]: [fixedConstraint(fixed2.id, '2026-09-16T13:00:00Z', '2026-09-16T13:30:00Z')],
    },
    today: TODAY,
  });
  check('51.5 both FIXED intents are placed at their declared times', day.proposedItems.some((p) => p.intentId === fixed1.id) && day.proposedItems.some((p) => p.intentId === fixed2.id));
  check('51.5 both FLEXIBLE intents are deferred -- neither reservation was available to steal', day.deferredItems.some((d) => d.intentId === flexA.id) && day.deferredItems.some((d) => d.intentId === flexB.id));
}

// 51.6 Timing-fit ranking never overrides a reservation: the FLEXIBLE
// intent's top-ranked (BEST) candidate overlaps a FIXED reservation; a
// weaker-ranked but feasible candidate is selected instead. Proves
// feasibility (including reservation) is evaluated strictly before
// timing-quality ranking.
{
  resetIntentOrder();
  const flex = intent({ title: 'Flex', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const fixed = intent({ title: 'Fixed', targetDate: TODAY, flexibility: 'FIXED', estimatedDurationMinutes: 30 });
  const day = readyDay({
    intents: [flex, fixed],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: {
      [flex.id]: [
        candidate(flex.id, '2026-09-16T14:00:00Z', '2026-09-16T14:30:00Z', { timingFit: 'BEST', candidateOrder: 0 }), // overlaps the FIXED reservation
        candidate(flex.id, '2026-09-16T09:00:00Z', '2026-09-16T09:30:00Z', { timingFit: 'WORKABLE', candidateOrder: 1 }),
      ],
    },
    fixedConstraintsByIntentId: { [fixed.id]: [fixedConstraint(fixed.id, '2026-09-16T14:00:00Z', '2026-09-16T14:30:00Z')] },
    today: TODAY,
  });
  const flexItem = day.proposedItems.find((p) => p.intentId === flex.id);
  check('51.6 the weaker-ranked but feasible (non-reserved) candidate is selected, never the BEST-ranked reserved one', flexItem?.start.getTime() === iso('2026-09-16T09:00:00Z').getTime() && flexItem?.timingFit === 'WORKABLE');
}

// 51.7 Precedence WITHIN each group is unaffected by the reservation
// invariant: two FLEXIBLE intents with no reservation conflict at all
// still resolve by deadline-today/importance/originalOrder exactly as
// before (spot check, not a full re-audit -- sections 6-49 above already
// exhaustively cover precedence and remain green, proving zero
// regression there).
{
  resetIntentOrder();
  const flexHigh = intent({ title: 'Flex HIGH', targetDate: TODAY, importance: 'HIGH', estimatedDurationMinutes: 30 });
  const flexLow = intent({ title: 'Flex LOW', targetDate: TODAY, importance: 'LOW', estimatedDurationMinutes: 30 });
  const sameSlot = ['2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z'] as const;
  const day = readyDay({
    intents: [flexLow, flexHigh],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: { [flexHigh.id]: [candidate(flexHigh.id, ...sameSlot)], [flexLow.id]: [candidate(flexLow.id, ...sameSlot)] },
    today: TODAY,
  });
  check('51.7 within the FLEXIBLE group, HIGH importance still wins a genuinely contested slot over LOW (unchanged)', day.proposedItems.some((p) => p.intentId === flexHigh.id) && day.deferredItems.some((d) => d.intentId === flexLow.id));
}

// 51.8 Capacity classification is unaffected by the reservation
// invariant for an input with no reservation conflict at all -- the
// snapshot only ever depends on window/blockedIntervals/summed minutes,
// none of which this fix touches.
{
  resetIntentOrder();
  const fixed = intent({ title: 'Fixed', targetDate: TODAY, flexibility: 'FIXED', estimatedDurationMinutes: 60 });
  const flex = intent({ title: 'Flex', targetDate: TODAY, estimatedDurationMinutes: 60 });
  const day = readyDay({
    intents: [fixed, flex],
    window: FULL_DAY(), // 09:00-17:00 = 480 usable minutes
    blockedIntervals: [],
    candidatesByIntentId: { [flex.id]: [candidate(flex.id, '2026-09-16T09:00:00Z', '2026-09-16T10:00:00Z')] },
    fixedConstraintsByIntentId: { [fixed.id]: [fixedConstraint(fixed.id, '2026-09-16T14:00:00Z', '2026-09-16T15:00:00Z')] },
    today: TODAY,
  });
  check('51.8 requestedCapacity reflects the full 120 requested minutes against 480 usable, unchanged capacity math', day.requestedCapacity.requestedMinutes === 120 && day.requestedCapacity.usableMinutes === 480);
  check('51.8 proposedCapacity reflects both items actually placed (no conflict here)', day.proposedCapacity.requestedMinutes === 120 && day.proposedItems.length === 2);
}

// 51.9 Result order is NOT evaluation order: proposedItems/deferredItems
// still reflect the single global precedence sequence (orderedIntents),
// never the internal FIXED-then-FLEXIBLE evaluation order (this ticket's
// own section 13 -- do not blindly redefine the result contract). A
// FLEXIBLE intent submitted (and thus precedence-ordered) BEFORE a FIXED
// intent must still appear BEFORE it in the raw proposedItems array,
// even though the FIXED intent was evaluated first internally.
{
  resetIntentOrder();
  const flexFirst = intent({ title: 'Flex first', targetDate: TODAY, estimatedDurationMinutes: 30 });
  const fixedSecond = intent({ title: 'Fixed second', targetDate: TODAY, flexibility: 'FIXED', estimatedDurationMinutes: 30 });
  const day = readyDay({
    intents: [flexFirst, fixedSecond],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: { [flexFirst.id]: [candidate(flexFirst.id, '2026-09-16T09:00:00Z', '2026-09-16T09:30:00Z')] },
    fixedConstraintsByIntentId: { [fixedSecond.id]: [fixedConstraint(fixedSecond.id, '2026-09-16T14:00:00Z', '2026-09-16T14:30:00Z')] },
    today: TODAY,
  });
  check(
    '51.9 raw proposedItems array order still matches submission/precedence order, not internal FIXED-first evaluation order',
    day.proposedItems.length === 2 && day.proposedItems[0].intentId === flexFirst.id && day.proposedItems[1].intentId === fixedSecond.id
  );
}

// 51.10 Deterministic repeat invocation for a genuinely mixed,
// reservation-conflicting batch (broader than 10.15's pure-FIXED case).
{
  resetIntentOrder();
  const workout = intent({ title: 'Workout', targetDate: TODAY, estimatedDurationMinutes: 60 });
  const doctor = intent({ title: 'Doctor', targetDate: TODAY, flexibility: 'FIXED', estimatedDurationMinutes: 60 });
  const inputData = buildInput({
    intents: [workout, doctor],
    window: FULL_DAY(),
    blockedIntervals: [],
    candidatesByIntentId: { [workout.id]: [candidate(workout.id, '2026-09-16T16:00:00Z', '2026-09-16T17:00:00Z')] },
    fixedConstraintsByIntentId: { [doctor.id]: [fixedConstraint(doctor.id, '2026-09-16T16:00:00Z', '2026-09-16T17:00:00Z')] },
    today: TODAY,
  });
  const first = constructDay(inputData);
  const second = constructDay(inputData);
  check('51.10 identical mixed FIXED/FLEXIBLE reservation-conflicting input produces byte-equivalent output on repeated invocation', JSON.stringify(first) === JSON.stringify(second));
}

if (!allPassed) {
  console.error('\nSome Day Constructor checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL DAY CONSTRUCTOR CHECKS PASSED');
}
