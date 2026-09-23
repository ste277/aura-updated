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
  isValidCivilDateString,
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
// Progress copy (this ticket's own section 7/J)
// ============================================================
check('J. "0 of 3 completed"', formatGoalProgressLabel({ total: 3, completed: 0 }) === '0 of 3 completed');
check('J. "1 of 3 completed"', formatGoalProgressLabel({ total: 3, completed: 1 }) === '1 of 3 completed');
check('J. "3 of 3 completed"', formatGoalProgressLabel({ total: 3, completed: 3 }) === '3 of 3 completed');
check('J. zero activities reads as "No activities yet", never "0 of 0 completed"', formatGoalProgressLabel({ total: 0, completed: 0 }) === 'No activities yet');

// ============================================================
// Civil-date display (this ticket's own section 13/G) -- must never
// reinterpret the calendar day through any timezone.
// ============================================================
check('G. "2026-09-25" displays as "Sep 25"', formatGoalTargetDateLabel('2026-09-25') === 'Sep 25');
check('G. a year-boundary date displays correctly ("2026-01-01" -> "Jan 1")', formatGoalTargetDateLabel('2026-01-01') === 'Jan 1');
check('G. a last-day-of-month date displays correctly ("2026-12-31" -> "Dec 31")', formatGoalTargetDateLabel('2026-12-31') === 'Dec 31');
check('G. isValidCivilDateString (reused directly from lib/goals.ts) accepts the exact format the UI submits', isValidCivilDateString('2026-09-25') === true);
check('G. isValidCivilDateString rejects a browser-locale date string, so the UI cannot accidentally submit one', isValidCivilDateString('09/25/2026') === false);

if (!allPassed) {
  console.error('SOME GOALS PRESENTATION CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOALS PRESENTATION CHECKS PASSED');
