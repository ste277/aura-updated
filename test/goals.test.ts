/**
 * Goals -> Planning Integration V1 PR A -- pure domain regression suite for
 * apps/web/lib/goals.ts (lifecycle derivation, progress, civil-date
 * encoding, template taxonomy/resolution). No DB access -- see
 * goalsDb.test.ts for live-Postgres CRUD/ownership/transaction coverage.
 */
import {
  deriveGoalActivityState,
  computeGoalProgress,
  isValidCivilDateString,
  parseGoalTargetDate,
  toGoalTargetDateString,
  isGoalTemplateCategory,
  GOAL_TEMPLATE_CATEGORIES,
  GOAL_TEMPLATES,
  resolveGoalTemplateActivities,
} from '../apps/web/lib/goals';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// deriveGoalActivityState -- every branch (test plan items K-O)
// ============================================================
check('K. persisted SUGGESTED + no link -> derived SUGGESTED', deriveGoalActivityState({ status: 'SUGGESTED', plannedActivityId: null, linkedPlanStatus: null }) === 'SUGGESTED');
check('L. persisted DISMISSED (even with a link) -> derived DISMISSED', deriveGoalActivityState({ status: 'DISMISSED', plannedActivityId: 'p1', linkedPlanStatus: 'UPCOMING' }) === 'DISMISSED');
check('M. linked + UPCOMING -> derived PLANNED', deriveGoalActivityState({ status: 'SUGGESTED', plannedActivityId: 'p1', linkedPlanStatus: 'UPCOMING' }) === 'PLANNED');
check('N. linked + LOGGED -> derived COMPLETED', deriveGoalActivityState({ status: 'SUGGESTED', plannedActivityId: 'p1', linkedPlanStatus: 'LOGGED' }) === 'COMPLETED');
check('O. linked + CANCELLED -> derived SUGGESTED (available to plan again)', deriveGoalActivityState({ status: 'SUGGESTED', plannedActivityId: 'p1', linkedPlanStatus: 'CANCELLED' }) === 'SUGGESTED');
check('edge: plannedActivityId set but linkedPlanStatus missing (row gone) -> derived SUGGESTED, not a crash', deriveGoalActivityState({ status: 'SUGGESTED', plannedActivityId: 'p1', linkedPlanStatus: null }) === 'SUGGESTED');

// ============================================================
// computeGoalProgress (test plan items P-Q)
// ============================================================
check(
  'P. progress excludes DISMISSED from both total and completed',
  (() => {
    const p = computeGoalProgress(['DISMISSED', 'COMPLETED', 'PLANNED', 'SUGGESTED']);
    return p.total === 3 && p.completed === 1;
  })()
);
check('Q. progress handles zero activities', (() => { const p = computeGoalProgress([]); return p.total === 0 && p.completed === 0; })());
check('progress: all dismissed -> total 0, completed 0 (never divides by zero elsewhere)', (() => { const p = computeGoalProgress(['DISMISSED', 'DISMISSED']); return p.total === 0 && p.completed === 0; })());
check('progress: PLANNED does not count as completed', (() => { const p = computeGoalProgress(['PLANNED']); return p.total === 1 && p.completed === 0; })());

// ============================================================
// Civil-date encoding/round-trip (test plan items C, AB)
// ============================================================
check('C. civil date round-trips: "2026-09-25" -> Date -> "2026-09-25"', toGoalTargetDateString(parseGoalTargetDate('2026-09-25')) === '2026-09-25');
check('C. civil date is stored as literal UTC midnight (never shifted by local/server timezone)', parseGoalTargetDate('2026-09-25').toISOString() === '2026-09-25T00:00:00.000Z');
check('isValidCivilDateString accepts a real, well-formed date', isValidCivilDateString('2026-01-01') === true);
check('AB. isValidCivilDateString rejects a calendrically-invalid date (Feb 30)', isValidCivilDateString('2026-02-30') === false);
check('AB. isValidCivilDateString rejects a malformed string', isValidCivilDateString('25-09-2026') === false);
check('AB. isValidCivilDateString rejects a non-date-shaped string', isValidCivilDateString('not-a-date') === false);
check('AB. isValidCivilDateString rejects a bare instant/timestamp', isValidCivilDateString('2026-09-25T00:00:00.000Z') === false);
check('AB. isValidCivilDateString rejects non-string input', isValidCivilDateString(20260925 as unknown) === false);
check('AB. isValidCivilDateString rejects null', isValidCivilDateString(null) === false);

// ============================================================
// Template taxonomy (test plan items 17/18/AC, and the ticket's own
// section 9 instruction to document why UserPriorityGroup/
// DailyIntentionGroupId are NOT reused)
// ============================================================
check('AC. isGoalTemplateCategory accepts every declared category', GOAL_TEMPLATE_CATEGORIES.every((c) => isGoalTemplateCategory(c)));
check('AC. isGoalTemplateCategory rejects an unknown category', isGoalTemplateCategory('NOT_A_REAL_CATEGORY') === false);
check('AC. isGoalTemplateCategory rejects a UserPriorityGroup value (RELATIONSHIPS is not a GoalTemplateCategory -- the taxonomies are deliberately distinct)', isGoalTemplateCategory('RELATIONSHIPS') === false);
check('AC. isGoalTemplateCategory rejects non-string input', isGoalTemplateCategory(42) === false);
check('exactly 4 template categories exist (deliberately small, per this ticket\'s own section 16)', GOAL_TEMPLATE_CATEGORIES.length === 4);
check('every template category has at least one activity title', GOAL_TEMPLATE_CATEGORIES.every((c) => GOAL_TEMPLATES[c].length > 0));

// resolveGoalTemplateActivities -- verified against the REAL, live catalog
// (packages/recommendation/src/personalizedTasks.ts), not a mocked one.
check(
  'GET_FITTER activities resolve to real catalog ids where the catalog genuinely supports the mapping ("run"/"training" -> workout, "stretch"/"mobility" -> task-7)',
  (() => {
    const activities = resolveGoalTemplateActivities('GET_FITTER');
    return activities.length === 3 && activities.every((a) => a.activityId !== null);
  })()
);
check('MEDITATE_REGULARLY resolves to the real "meditation" catalog id', resolveGoalTemplateActivities('MEDITATE_REGULARLY')[0].activityId === 'meditation');
check('STUDY_CONSISTENTLY resolves to the real "learning" catalog id', resolveGoalTemplateActivities('STUDY_CONSISTENTLY')[0].activityId === 'learning');
check(
  'FINISH_PROJECT: no fallback activityId is forced -- every activity resolves to null because no catalog entry genuinely matches these titles (this ticket\'s own section 11 instruction, verified against the live catalog rather than assumed)',
  resolveGoalTemplateActivities('FINISH_PROJECT').every((a) => a.activityId === null)
);
check('resolveGoalTemplateActivities preserves the exact static titles verbatim', resolveGoalTemplateActivities('MEDITATE_REGULARLY')[0].title === 'Meditate 10 minutes');

if (!allPassed) {
  console.error('SOME GOALS DOMAIN CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOALS DOMAIN CHECKS PASSED');
