/**
 * Goals -> Planning Integration V1 PR B -- pure regression suite for
 * apps/web/lib/goalsPresentation.ts (template labels, derived-state
 * labels, progress copy, civil-date display). No DB/network access, no
 * component rendering -- this repository has no component-rendering
 * harness (confirmed precedent: homeDashboardLogic.test.ts/
 * planDayWiring.test.ts test imported pure helpers and read real source
 * respectively, never a render tree), so UI-level correctness is proven
 * here (pure decision logic) and in goalsUiWiring.test.ts (structural
 * source-reading, matching planDayWiring.test.ts's own convention).
 */
import {
  GOAL_TEMPLATE_OPTIONS,
  GOAL_TEMPLATE_LABELS,
  presentGoalTemplateCategory,
  presentGoalActivityStateLabel,
  formatGoalProgressLabel,
  formatGoalTargetDateLabel,
  formatGoalActivityCompletion,
  isValidCivilDateString,
  goalHasOngoingRhythmActivity,
  type GoalActivityRhythmView,
} from '../apps/web/lib/goalsPresentation';
import { GOAL_TEMPLATE_CATEGORIES, type GoalTemplateCategory } from '../apps/web/lib/goals';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// Template labels (this ticket's own section 11) -- never the raw enum.
// ============================================================
check('11. GET_FITTER -> "Get fitter"', presentGoalTemplateCategory('GET_FITTER') === 'Get fitter');
check('11. MEDITATE_REGULARLY -> "Meditate regularly"', presentGoalTemplateCategory('MEDITATE_REGULARLY') === 'Meditate regularly');
check('11. FINISH_PROJECT -> "Finish a project"', presentGoalTemplateCategory('FINISH_PROJECT') === 'Finish a project');
check('11. STUDY_CONSISTENTLY -> "Study consistently"', presentGoalTemplateCategory('STUDY_CONSISTENTLY') === 'Study consistently');
check('Y. every template label is human text, never the raw enum string itself', GOAL_TEMPLATE_CATEGORIES.every((c) => GOAL_TEMPLATE_LABELS[c] !== c));
check('every real GoalTemplateCategory has exactly one dropdown option', GOAL_TEMPLATE_CATEGORIES.every((c) => GOAL_TEMPLATE_OPTIONS.filter((o) => o.value === c).length === 1));
check('11/12. "Start from scratch" is present as its own option with value null (never a GoalTemplateCategory)', GOAL_TEMPLATE_OPTIONS.some((o) => o.value === null && o.label === 'Start from scratch'));
check('12. "Start from scratch" is listed last (reads as "or do it yourself", not the default suggestion)', GOAL_TEMPLATE_OPTIONS[GOAL_TEMPLATE_OPTIONS.length - 1].value === null);
check('exactly 5 template options total (4 real categories + scratch)', GOAL_TEMPLATE_OPTIONS.length === 5);

// ============================================================
// Derived-state labels (this ticket's own section 17)
// ============================================================
check('K/17. SUGGESTED renders no badge at all (a normal actionable row, not a labeled one)', presentGoalActivityStateLabel('SUGGESTED') === null);
check('L/17. PLANNED -> "Planned"', presentGoalActivityStateLabel('PLANNED') === 'Planned');
check('M/17. COMPLETED -> "Completed"', presentGoalActivityStateLabel('COMPLETED') === 'Completed');
check('DISMISSED -> "Dismissed" (human label, distinct from the raw enum casing/word)', presentGoalActivityStateLabel('DISMISSED') === 'Dismissed');

// ============================================================
// Progress copy (this ticket's own section 7/J). `hasOngoingRhythmActivity:
// false` on every fixture here -- Goals V2 Rhythm R4's own section 42 DB
// test requirement: a finite-only Goal's progress presentation must stay
// byte-identical to this pre-R4 behavior.
// ============================================================
check('J. "0 of 3 completed"', formatGoalProgressLabel({ total: 3, completed: 0, hasOngoingRhythmActivity: false }) === '0 of 3 completed');
check('J. "1 of 3 completed"', formatGoalProgressLabel({ total: 3, completed: 1, hasOngoingRhythmActivity: false }) === '1 of 3 completed');
check('J. "3 of 3 completed"', formatGoalProgressLabel({ total: 3, completed: 3, hasOngoingRhythmActivity: false }) === '3 of 3 completed');
check('J. zero activities reads as "No activities yet", never "0 of 0 completed"', formatGoalProgressLabel({ total: 0, completed: 0, hasOngoingRhythmActivity: false }) === 'No activities yet');

// ============================================================
// Goals V2 Rhythm R4 -- hasOngoingRhythmActivity suppresses the label
// entirely (this ticket's own section 17-19): a Goal containing an
// ongoing N_PER_WEEK activity cannot be honestly summarized as finite
// "N of M completed".
// ============================================================
check('R4. hasOngoingRhythmActivity suppresses the progress label to null, regardless of total/completed', formatGoalProgressLabel({ total: 1, completed: 1, hasOngoingRhythmActivity: true }) === null);

// ============================================================
// Goals V2 Rhythm R4 -- 53. Goal-level progress audit: finite-only
// unchanged, Rhythm-only never a misleading "1 of 1", mixed Goal never a
// misleading universal N-of-M.
// ============================================================
const none: GoalActivityRhythmView = { kind: 'NONE' };
const nPerWeek: GoalActivityRhythmView = { kind: 'N_PER_WEEK', targetPerWeek: 1, completedThisWeek: 1, committedThisWeek: 0, remainingThisWeek: 0, eligibleForAnotherOccurrence: false };
check('53. finite-only Goal (every activity NONE): hasOngoingRhythmActivity false -- existing N-of-M progress unchanged', goalHasOngoingRhythmActivity([{ rhythm: none }, { rhythm: none }]) === false);
check('53. Rhythm-only Goal (one N_PER_WEEK activity, just completed its only weekly session): hasOngoingRhythmActivity true -- never shows a misleading "1 of 1"', goalHasOngoingRhythmActivity([{ rhythm: nPerWeek }]) === true);
check('53. mixed Goal (one finite NONE + one N_PER_WEEK): hasOngoingRhythmActivity true -- never a misleading universal N-of-M', goalHasOngoingRhythmActivity([{ rhythm: none }, { rhythm: nPerWeek }]) === true);
check('53. zero activities: hasOngoingRhythmActivity false (vacuously -- nothing ongoing to misrepresent)', goalHasOngoingRhythmActivity([]) === false);

// ============================================================
// Civil-date display (this ticket's own section 13/G) -- must never
// reinterpret the calendar day through any timezone.
// ============================================================
check('G. "2026-09-25" displays as "Sep 25"', formatGoalTargetDateLabel('2026-09-25') === 'Sep 25');
check('G. a year-boundary date displays correctly ("2026-01-01" -> "Jan 1")', formatGoalTargetDateLabel('2026-01-01') === 'Jan 1');
check('G. a last-day-of-month date displays correctly ("2026-12-31" -> "Dec 31")', formatGoalTargetDateLabel('2026-12-31') === 'Dec 31');
check('G. isValidCivilDateString (reused directly from lib/goals.ts) accepts the exact format the UI submits', isValidCivilDateString('2026-09-25') === true);
check('G. isValidCivilDateString rejects a browser-locale date string, so the UI cannot accidentally submit one', isValidCivilDateString('09/25/2026') === false);

// ============================================================
// Goals V2 G3.2 -- formatGoalActivityCompletion (activity-level "what
// counts as doing this, and what happened")
// ============================================================

// 32/45. DONE -- no completion-detail line at all, regardless of
// currentValue (legacy-normalized DONE reads identically).
check('32. DONE + currentValue null -> null (no line)', formatGoalActivityCompletion({ kind: 'DONE' }, null) === null);
check('45. legacy-normalized DONE -> null, no crash', formatGoalActivityCompletion({ kind: 'DONE' }, null) === null);

// 33-37. DURATION
check('33. DURATION 30 / null -> "30 min"', formatGoalActivityCompletion({ kind: 'DURATION', targetValue: 30 }, null) === '30 min');
check('34. DURATION 30 / 30 (matching, COMPLETED) -> compact "30 min", no redundant 30/30', formatGoalActivityCompletion({ kind: 'DURATION', targetValue: 30 }, 30) === '30 min');
check('35. DURATION 30 / 18 (differs) -> "18 / 30 min"', formatGoalActivityCompletion({ kind: 'DURATION', targetValue: 30 }, 18) === '18 / 30 min');
check('36. DURATION 30 / 45 (above target) -> "45 / 30 min", no clamp', formatGoalActivityCompletion({ kind: 'DURATION', targetValue: 30 }, 45) === '45 / 30 min');
check('37. DURATION 30 / 0 (zero, execution exists) -> "0 / 30 min", never treated as missing', formatGoalActivityCompletion({ kind: 'DURATION', targetValue: 30 }, 0) === '0 / 30 min');

// 38-41. MEASURED_TARGET
check('38. MEASURED_TARGET 20 pages / null -> "20 pages"', formatGoalActivityCompletion({ kind: 'MEASURED_TARGET', targetValue: 20, unit: 'pages' }, null) === '20 pages');
check('39. MEASURED_TARGET 20 pages / 12 -> "12 / 20 pages"', formatGoalActivityCompletion({ kind: 'MEASURED_TARGET', targetValue: 20, unit: 'pages' }, 12) === '12 / 20 pages');
check('40. MEASURED_TARGET 20 pages / 25 (above) -> "25 / 20 pages", no clamp', formatGoalActivityCompletion({ kind: 'MEASURED_TARGET', targetValue: 20, unit: 'pages' }, 25) === '25 / 20 pages');
check('41. MEASURED_TARGET 20 pages / 0 -> "0 / 20 pages"', formatGoalActivityCompletion({ kind: 'MEASURED_TARGET', targetValue: 20, unit: 'pages' }, 0) === '0 / 20 pages');
check('MEASURED_TARGET matching target (symmetric with DURATION\'s own compact-match rule) -> "20 pages", not "20 / 20 pages"', formatGoalActivityCompletion({ kind: 'MEASURED_TARGET', targetValue: 20, unit: 'pages' }, 20) === '20 pages');

// 42. fractional values -- no accidental integer rounding, no trailing .0/.50
check('42. DURATION 12.5 / null -> "12.5 min"', formatGoalActivityCompletion({ kind: 'DURATION', targetValue: 12.5 }, null) === '12.5 min');
check('42. MEASURED_TARGET 1.25 km / null -> "1.25 km"', formatGoalActivityCompletion({ kind: 'MEASURED_TARGET', targetValue: 1.25, unit: 'km' }, null) === '1.25 km');
check('42. MEASURED_TARGET 1.25 km / 0.75 -> "0.75 / 1.25 km"', formatGoalActivityCompletion({ kind: 'MEASURED_TARGET', targetValue: 1.25, unit: 'km' }, 0.75) === '0.75 / 1.25 km');
check('42. a whole-number target never grows a trailing ".0"', formatGoalActivityCompletion({ kind: 'DURATION', targetValue: 30 }, null) === '30 min');

// 16. free-form unit rendered verbatim, no taxonomy/pluralization heuristics
check('16. unit "glasses" rendered verbatim', formatGoalActivityCompletion({ kind: 'MEASURED_TARGET', targetValue: 8, unit: 'glasses' }, null) === '8 glasses');
check('16. unit "reps" rendered verbatim', formatGoalActivityCompletion({ kind: 'MEASURED_TARGET', targetValue: 10, unit: 'reps' }, 10) === '10 reps');
check('17. DURATION unit is always the implicit "min", never a persisted completionUnit (DURATION never carries one per G2.1)', formatGoalActivityCompletion({ kind: 'DURATION', targetValue: 5 }, null) === '5 min');

// 21/22/43. lifecycle independence -- the formatter itself takes no
// derivedState input at all, so it is structurally incapable of inferring
// completion/failure from numeric progress; re-asserted explicitly here.
check('21/43. currentValue (25) > target (20) produces a plain factual string -- the formatter has no derivedState parameter to threshold against', formatGoalActivityCompletion({ kind: 'MEASURED_TARGET', targetValue: 20, unit: 'pages' }, 25) === '25 / 20 pages');
check('22/43. currentValue (12) < target (20) produces a plain factual string, never "Partial"/"Failed"/"Incomplete"/"Missed target"', /partial|fail|incomplete|missed/i.test(formatGoalActivityCompletion({ kind: 'MEASURED_TARGET', targetValue: 20, unit: 'pages' }, 12) ?? '') === false);

if (!allPassed) {
  console.error('SOME GOALS PRESENTATION CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOALS PRESENTATION CHECKS PASSED');
