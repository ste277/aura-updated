/**
 * Goals V2 Rhythm R4 -- UI regression suite for Goal Detail's weekly
 * Rhythm presentation (this ticket's own section 52). Two halves, same
 * convention as this repo's other Goal Detail test pairs
 * (goalsPresentation.test.ts for pure copy/logic + goalPlanningHandoffUi
 * .test.ts for source-reading structural wiring, since this repository has
 * no component-rendering harness):
 *
 *   1. Pure formatter checks (imported directly) -- the exact wording for
 *      frequency and weekly progress, including every DO-NOT from this
 *      ticket's own section 9/10.
 *   2. Source-reading checks against GoalDetailClient.tsx -- that the
 *      component actually wires these formatters in, that an ongoing
 *      activity never gets a permanent "Completed" badge, and that
 *      Plan with Aura availability still follows the one canonical
 *      eligibility field.
 */
import fs from 'fs';
import path from 'path';
import {
  formatGoalActivityRhythmFrequencyLabel,
  formatGoalActivityRhythmWeeklyProgressLabel,
  presentGoalActivityRhythmAwareStateLabel,
  type GoalActivityRhythmView,
} from '../apps/web/lib/goalsPresentation';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function read(relPath: string): string {
  return fs.readFileSync(path.join(__dirname, relPath), 'utf8');
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function nPerWeek(overrides: Partial<Extract<GoalActivityRhythmView, { kind: 'N_PER_WEEK' }>>): GoalActivityRhythmView {
  return { kind: 'N_PER_WEEK', targetPerWeek: 1, completedThisWeek: 0, committedThisWeek: 0, remainingThisWeek: 1, eligibleForAnotherOccurrence: true, ...overrides };
}

// ============================================================
// 1. Pure formatter checks.
// ============================================================

// -- Frequency (section 9) --
check('9. 1/week -> "Once a week" (singular, the one consistent wording this app uses)', formatGoalActivityRhythmFrequencyLabel(1) === 'Once a week');
check('9. 2/week -> "2 times a week"', formatGoalActivityRhythmFrequencyLabel(2) === '2 times a week');
check('9. 5/week -> "5 times a week"', formatGoalActivityRhythmFrequencyLabel(5) === '5 times a week');
check('9. 7/week never reads "Daily" (not semantically identical to "every day" under the current model)', formatGoalActivityRhythmFrequencyLabel(7) === '7 times a week' && formatGoalActivityRhythmFrequencyLabel(7) !== 'Daily');
check('9. never the vague "A few times a week" -- the exact N is always shown', !/a few times/i.test(formatGoalActivityRhythmFrequencyLabel(3)));

// -- Weekly progress (section 10/11/21/22/23/24) --
check('21. empty week (0 completed, 0 committed) reads calmly, no warning language', formatGoalActivityRhythmWeeklyProgressLabel(nPerWeek({ completedThisWeek: 0, committedThisWeek: 0 })) === 'No sessions completed this week');
check('10. 1 completed, 0 committed -> "1 session this week" (singular)', formatGoalActivityRhythmWeeklyProgressLabel(nPerWeek({ completedThisWeek: 1, committedThisWeek: 0 })) === '1 session this week');
check('10. 3 completed, 0 committed -> "3 sessions this week" (plural, no ratio)', formatGoalActivityRhythmWeeklyProgressLabel(nPerWeek({ completedThisWeek: 3, committedThisWeek: 0 })) === '3 sessions this week');
check('22. partial week (2 completed, 1 committed) distinguishes both facts, never silently sums them', formatGoalActivityRhythmWeeklyProgressLabel(nPerWeek({ completedThisWeek: 2, committedThisWeek: 1 })) === '2 sessions completed this week · 1 planned');
check('11. an UPCOMING occurrence is never presented as completed (0 completed, 1 committed never reads "1 completed")', formatGoalActivityRhythmWeeklyProgressLabel(nPerWeek({ completedThisWeek: 0, committedThisWeek: 1 })) === '1 planned this week');
check('45/23. target met (3 completed, 0 committed, 3/week) still just factual "3 sessions this week", never "COMPLETED"/"Goal complete"', formatGoalActivityRhythmWeeklyProgressLabel(nPerWeek({ targetPerWeek: 3, completedThisWeek: 3, committedThisWeek: 0, remainingThisWeek: 0, eligibleForAnotherOccurrence: false })) === '3 sessions this week');
check('47/24. over target (4 completed against 3/week) reads the real count, never clamped/negative language', formatGoalActivityRhythmWeeklyProgressLabel(nPerWeek({ targetPerWeek: 3, completedThisWeek: 4, committedThisWeek: 0, remainingThisWeek: 0, eligibleForAnotherOccurrence: false })) === '4 sessions this week');
check('NONE returns null (nothing to say)', formatGoalActivityRhythmWeeklyProgressLabel({ kind: 'NONE' }) === null);

const ALL_PROGRESS_LABELS = [
  formatGoalActivityRhythmWeeklyProgressLabel(nPerWeek({ completedThisWeek: 0, committedThisWeek: 0 })),
  formatGoalActivityRhythmWeeklyProgressLabel(nPerWeek({ completedThisWeek: 1, committedThisWeek: 0 })),
  formatGoalActivityRhythmWeeklyProgressLabel(nPerWeek({ completedThisWeek: 3, committedThisWeek: 0 })),
  formatGoalActivityRhythmWeeklyProgressLabel(nPerWeek({ completedThisWeek: 2, committedThisWeek: 1 })),
  formatGoalActivityRhythmWeeklyProgressLabel(nPerWeek({ completedThisWeek: 0, committedThisWeek: 1 })),
].join(' ');
const DO_NOT_WORDS = /behind|on track|perfect week|missed|failed|streak|score|consistency/i;
check('10. no motivational judgment word appears across any weekly-progress wording (behind/on track/perfect/missed/failed/streak/score/consistency)', !DO_NOT_WORDS.test(ALL_PROGRESS_LABELS));
check('10/11. no "X of Y" ratio framing appears across any weekly-progress wording', !/\d+\s+of\s+\d+/i.test(ALL_PROGRESS_LABELS));

// -- Ongoing-activity state label (section 15/16) --
check('15. NONE + COMPLETED still reads "Completed" -- finite semantics fully preserved', presentGoalActivityRhythmAwareStateLabel('COMPLETED', { kind: 'NONE' }) === 'Completed');
check('15. NONE + SUGGESTED/PLANNED/DISMISSED pass through unchanged', presentGoalActivityRhythmAwareStateLabel('SUGGESTED', { kind: 'NONE' }) === null && presentGoalActivityRhythmAwareStateLabel('PLANNED', { kind: 'NONE' }) === 'Planned' && presentGoalActivityRhythmAwareStateLabel('DISMISSED', { kind: 'NONE' }) === 'Dismissed');
check('14/15. N_PER_WEEK + COMPLETED + still eligible -> never the permanent "Completed" badge', presentGoalActivityRhythmAwareStateLabel('COMPLETED', nPerWeek({ eligibleForAnotherOccurrence: true })) !== 'Completed');
check('23. N_PER_WEEK + COMPLETED + target met (not eligible) -> still never "Completed" (ongoing, not finished)', presentGoalActivityRhythmAwareStateLabel('COMPLETED', nPerWeek({ eligibleForAnotherOccurrence: false })) !== 'Completed');
check('15. N_PER_WEEK + SUGGESTED/PLANNED pass through unchanged (only COMPLETED is remapped)', presentGoalActivityRhythmAwareStateLabel('SUGGESTED', nPerWeek({})) === null && presentGoalActivityRhythmAwareStateLabel('PLANNED', nPerWeek({})) === 'Planned');

// ============================================================
// 2. Source-reading checks against GoalDetailClient.tsx.
// ============================================================
const source = stripComments(read('../apps/web/app/goals/[goalId]/GoalDetailClient.tsx'));

check('4/12. ActivityRow wires in both the frequency and weekly-progress formatters', /formatGoalActivityRhythmFrequencyLabel/.test(source) && /formatGoalActivityRhythmWeeklyProgressLabel/.test(source));
check('15/16. ActivityRow\'s state label comes from the Rhythm-aware wrapper, never the original presentGoalActivityStateLabel directly for a row that could be N_PER_WEEK', /presentGoalActivityRhythmAwareStateLabel\(activity\.derivedState, activity\.rhythm\)/.test(source));
check('24. still never a per-activity progress bar (role="progressbar" appears at most once, the existing Goal-level bar)', (source.match(/role="progressbar"/g) ?? []).length <= 1);
check('13. Plan with Aura selectability still reads the one canonical eligibleForAnotherOccurrence field, never a second flag', /a\.rhythm\.kind === 'N_PER_WEEK' && a\.rhythm\.eligibleForAnotherOccurrence/.test(source));
check('32. no Rhythm configuration control was added (no input/select tied to a rhythm field)', !/<select[^>]*rhythm/i.test(source) && !/<input[^>]*rhythm/i.test(source));
check('33. no history/calendar/streak/trend UI was added', !/calendar|streak|trend|history/i.test(source));

if (!allPassed) {
  console.error('SOME GOAL ACTIVITY RHYTHM GOAL DETAIL UI CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOAL ACTIVITY RHYTHM GOAL DETAIL UI CHECKS PASSED');
