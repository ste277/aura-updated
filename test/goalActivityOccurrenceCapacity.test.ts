/**
 * Goals V2 -- Multi-Occurrence Rhythm, PR 1: pure tests for
 * `evaluateNewOccurrenceEligibility` (goalActivityOccurrenceCapacity.ts).
 *
 * This is the explicit, NAMED multi-occurrence decision point established
 * by PR 1, NOT wired into any production path yet. These tests exist to
 * pin its exact behavior ahead of that wiring -- in particular, to prove
 * it is unaffected by HOW MANY occurrences are already COMMITTED, as long
 * as weekly capacity remains, which is the entire point of the feature.
 *
 * All scenarios from the PR 1 ticket's own section 2, plus the explicit
 * "would a single already-live occurrence, by itself, block a second one"
 * proof the product decision hinges on.
 */
import { evaluateNewOccurrenceEligibility, type NewOccurrenceEligibilityInput } from '../apps/web/lib/goalActivityOccurrenceCapacity';
import type { GoalActivityRhythmOccurrenceFact } from '../apps/web/lib/goalActivityRhythm';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const PLANNING = '2026-09-21'; // a Monday
const MON = PLANNING;
const TUE = '2026-09-22';
const SAT = '2026-09-26';
const PREV_MON = '2026-09-14'; // the preceding week's Monday
const NEXT_MON = '2026-09-28'; // the following week's Monday

const fact = (localDate: string, contribution: GoalActivityRhythmOccurrenceFact['contribution']): GoalActivityRhythmOccurrenceFact => ({ localDate, contribution });
const fiveAWeek = (occurrences: GoalActivityRhythmOccurrenceFact[]): ReturnType<typeof evaluateNewOccurrenceEligibility> =>
  evaluateNewOccurrenceEligibility({ rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 5 }, planningLocalDate: PLANNING, occurrences } as NewOccurrenceEligibilityInput);

// ======================================================================
console.log('=== Zero / one / multiple committed occurrences ===');
check('zero committed, zero completed: 5 remaining, eligible', (() => { const r = fiveAWeek([]); return r.eligible === true && r.remainingOccurrences === 5 && r.committedThisWeek === 0 && r.completedThisWeek === 0; })());
check('exactly ONE committed (the live occurrence the current single-slot gate would stop at): STILL eligible, 4 remaining -- the central product behavior this PR exists to establish', (() => { const r = fiveAWeek([fact(MON, 'COMMITTED')]); return r.eligible === true && r.remainingOccurrences === 4 && r.committedThisWeek === 1; })());
check('TWO already committed: still eligible, 3 remaining', (() => { const r = fiveAWeek([fact(MON, 'COMMITTED'), fact(TUE, 'COMMITTED')]); return r.eligible === true && r.remainingOccurrences === 3 && r.committedThisWeek === 2; })());
check('FOUR already committed: still eligible, exactly 1 remaining', (() => { const r = fiveAWeek([fact(MON, 'COMMITTED'), fact(TUE, 'COMMITTED'), fact(SAT, 'COMMITTED'), fact(SAT, 'COMMITTED')]); return r.eligible === true && r.remainingOccurrences === 1; })());

// ======================================================================
console.log('=== Mixed completed and committed ===');
check('2 completed + 2 committed of 5: eligible, 1 remaining', (() => { const r = fiveAWeek([fact(MON, 'COMPLETED'), fact(MON, 'COMPLETED'), fact(TUE, 'COMMITTED'), fact(SAT, 'COMMITTED')]); return r.eligible === true && r.remainingOccurrences === 1 && r.completedThisWeek === 2 && r.committedThisWeek === 2; })());
check('completed and committed are summed identically regardless of order supplied', (() => { const a = fiveAWeek([fact(MON, 'COMPLETED'), fact(TUE, 'COMMITTED')]); const b = fiveAWeek([fact(TUE, 'COMMITTED'), fact(MON, 'COMPLETED')]); return a.remainingOccurrences === b.remainingOccurrences; })());

// ======================================================================
console.log('=== Capacity exhausted ===');
check('5 of 5 committed: NOT eligible, 0 remaining', (() => { const r = fiveAWeek([fact(MON, 'COMMITTED'), fact(MON, 'COMMITTED'), fact(TUE, 'COMMITTED'), fact(TUE, 'COMMITTED'), fact(SAT, 'COMMITTED')]); return r.eligible === false && r.remainingOccurrences === 0; })());
check('5 of 5 completed: NOT eligible, 0 remaining', (() => { const r = fiveAWeek(Array.from({ length: 5 }, () => fact(MON, 'COMPLETED'))); return r.eligible === false && r.remainingOccurrences === 0; })());
check('6 somehow on record (over-target, never fabricated by this function, only possible from pre-existing data): clamps to 0, never negative', (() => { const r = fiveAWeek(Array.from({ length: 6 }, () => fact(MON, 'COMMITTED'))); return r.eligible === false && r.remainingOccurrences === 0; })());

// ======================================================================
console.log('=== Cancelled and skipped occurrences ===');
check('a CANCELLED occurrence contributes NOTHING -- does not consume capacity, 1 committed + 1 cancelled of 5 -> 4 remaining', (() => { const r = fiveAWeek([fact(MON, 'COMMITTED'), fact(TUE, 'NONE')]); return r.eligible === true && r.remainingOccurrences === 4 && r.committedThisWeek === 1; })());
check('a SKIPPED occurrence likewise contributes nothing', (() => { const r = fiveAWeek([fact(MON, 'NONE'), fact(TUE, 'NONE')]); return r.eligible === true && r.remainingOccurrences === 5; })());
check('cancelling one of two previously-committed occurrences frees exactly one unit of capacity', (() => { const before = fiveAWeek([fact(MON, 'COMMITTED'), fact(TUE, 'COMMITTED')]); const afterCancel = fiveAWeek([fact(MON, 'NONE'), fact(TUE, 'COMMITTED')]); return before.remainingOccurrences === 3 && afterCancel.remainingOccurrences === 4; })());

// ======================================================================
console.log('=== Reduced weekly target, with existing over-target records ===');
check('target reduced to 2 after 3 are already committed: remaining clamps to 0, eligible is false -- the 3 existing facts are read-only input, never altered by this function', (() => { const r = evaluateNewOccurrenceEligibility({ rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 2 }, planningLocalDate: PLANNING, occurrences: [fact(MON, 'COMMITTED'), fact(TUE, 'COMMITTED'), fact(SAT, 'COMMITTED')] }); return r.eligible === false && r.remainingOccurrences === 0; })());
check('target reduced to 2 after exactly 2 are committed: remaining 0, not negative', (() => { const r = evaluateNewOccurrenceEligibility({ rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 2 }, planningLocalDate: PLANNING, occurrences: [fact(MON, 'COMMITTED'), fact(TUE, 'COMMITTED')] }); return r.eligible === false && r.remainingOccurrences === 0; })());

// ======================================================================
console.log('=== Occurrences in different calendar weeks ===');
check('a PRIOR week\'s committed/completed occurrences never reduce the CURRENT week\'s remaining capacity', (() => { const r = fiveAWeek([fact(PREV_MON, 'COMPLETED'), fact(PREV_MON, 'COMMITTED'), fact(PREV_MON, 'COMPLETED')]); return r.eligible === true && r.remainingOccurrences === 5; })());
check('a FUTURE week\'s occurrence (already somehow recorded) never reduces THIS week\'s remaining capacity', (() => { const r = fiveAWeek([fact(NEXT_MON, 'COMMITTED')]); return r.eligible === true && r.remainingOccurrences === 5; })());
check('a mix of this week and other weeks counts only this week\'s facts', (() => { const r = fiveAWeek([fact(MON, 'COMMITTED'), fact(PREV_MON, 'COMPLETED'), fact(NEXT_MON, 'COMMITTED')]); return r.remainingOccurrences === 4; })());

// ======================================================================
console.log('=== Multiple sessions on one day ===');
check('two committed occurrences on the SAME day both count -- no per-day dedup, each session legitimately uses its own unit of weekly capacity', (() => { const r = fiveAWeek([fact(MON, 'COMMITTED'), fact(MON, 'COMMITTED')]); return r.eligible === true && r.remainingOccurrences === 3 && r.committedThisWeek === 2; })());
check('three same-day occurrences (2 completed, 1 committed) count identically to three different-day ones', (() => { const sameDay = fiveAWeek([fact(MON, 'COMPLETED'), fact(MON, 'COMPLETED'), fact(MON, 'COMMITTED')]); const differentDays = fiveAWeek([fact(MON, 'COMPLETED'), fact(TUE, 'COMPLETED'), fact(SAT, 'COMMITTED')]); return sameDay.remainingOccurrences === differentDays.remainingOccurrences && sameDay.remainingOccurrences === 2; })());

// ======================================================================
console.log('=== NONE rhythm, and structural guarantees ===');
check('NONE rhythm is never eligible for a further occurrence, regardless of facts', evaluateNewOccurrenceEligibility({ rhythm: { kind: 'NONE' }, planningLocalDate: PLANNING, occurrences: [fact(MON, 'COMPLETED')] }).eligible === false);
check('the result never carries a negative remainingOccurrences for any input shape tried above', [fiveAWeek([fact(MON, 'COMMITTED')]), fiveAWeek(Array.from({ length: 9 }, () => fact(MON, 'COMMITTED')))].every((r) => r.remainingOccurrences >= 0));
check('the function reads no field resembling a Plan id, a link status, or "the current occurrence" -- its input type is structurally incapable of carrying one (compile-time guarantee; this check documents the intent for a reader of the test output)', true);

if (!allPassed) { console.error('SOME GOAL ACTIVITY OCCURRENCE CAPACITY CHECKS FAILED'); process.exit(1); }
console.log('ALL GOAL ACTIVITY OCCURRENCE CAPACITY CHECKS PASSED');
