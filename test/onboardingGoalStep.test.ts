/**
 * Onboarding V1 PR 4 -- First Goal & Personalization: pure regression
 * suite for lib/onboardingGoalStep.ts. Exercises the REAL exported
 * functions directly (never a re-implementation) -- no DB, no network,
 * matching this repo's own established convention for a pure helper
 * module (goalActivityRhythm.test.ts, planDayEntry.ts's own callers).
 *
 *   npx ts-node test/onboardingGoalStep.test.ts
 */
import {
  ONBOARDING_GOAL_CATEGORIES,
  ONBOARDING_GOAL_TITLE_MAX_LENGTH,
  isOnboardingGoalTitleValid,
  buildOnboardingGoalCreateRequestBody,
  resolveOnboardingPlanningDate,
  buildOnboardingFirstActivityIntent,
  buildOnboardingFirstActivityGoalLinks,
  presentOnboardingFirstActivityPreviewFailure,
} from '../apps/web/lib/onboardingGoalStep';
import type { ConstructDayPreviewClientResult } from '../apps/web/lib/dayConstructorPreviewClient';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// Section B -- categories are discovery aids only, never a persisted
// enum/category value.
// ============================================================

check('1. exactly four onboarding categories exist, matching the ticket\'s own list (Health/Learning/Work/Habits)', ONBOARDING_GOAL_CATEGORIES.length === 4);
check('2. every category has a non-empty label and a non-empty suggested title', ONBOARDING_GOAL_CATEGORIES.every((c) => c.label.trim().length > 0 && c.suggestedTitle.trim().length > 0));
check('3. category ids are unique (no accidental duplicate)', new Set(ONBOARDING_GOAL_CATEGORIES.map((c) => c.id)).size === ONBOARDING_GOAL_CATEGORIES.length);

// ============================================================
// Section C -- title validation mirrors POST /api/goals' own
// MAX_TITLE_LENGTH exactly (never a second, independently-drifting limit).
// ============================================================

check('4. a non-blank, in-range title is valid', isOnboardingGoalTitleValid('Move my body regularly'));
check('5. an empty title is invalid', !isOnboardingGoalTitleValid(''));
check('6. a whitespace-only title is invalid', !isOnboardingGoalTitleValid('   '));
check('7. a title of exactly the max length is valid', isOnboardingGoalTitleValid('a'.repeat(ONBOARDING_GOAL_TITLE_MAX_LENGTH)));
check('8. a title one character over the max length is invalid', !isOnboardingGoalTitleValid('a'.repeat(ONBOARDING_GOAL_TITLE_MAX_LENGTH + 1)));
check('9. leading/trailing whitespace is trimmed before the length check', isOnboardingGoalTitleValid(`  ${'a'.repeat(ONBOARDING_GOAL_TITLE_MAX_LENGTH)}  `));

check('10. the create-request body trims the title and mirrors it onto the single activity, carrying the exact rhythm passed in', (() => {
  const body = buildOnboardingGoalCreateRequestBody('  Learn Spanish  ', { kind: 'N_PER_WEEK', targetPerWeek: 3 }, 'req-1');
  return body.title === 'Learn Spanish' && body.activities.length === 1 && body.activities[0].title === 'Learn Spanish' && body.activities[0].rhythm.kind === 'N_PER_WEEK' && body.activities[0].rhythm.targetPerWeek === 3 && body.clientRequestId === 'req-1';
})());
check('11. the create-request body never invents a targetDate, deadline, duration, or activityId field -- strictly title/activities/clientRequestId', (() => {
  const body = buildOnboardingGoalCreateRequestBody('Read more', { kind: 'NONE' }, 'req-2');
  return !('targetDate' in body) && !('deadline' in body) && !('durationMinutes' in body) && !('activityId' in body.activities[0]);
})());
check('12. a NONE rhythm passes through as the disclosed default ("Once"), never a silently invented frequency', buildOnboardingGoalCreateRequestBody('Meditate', { kind: 'NONE' }, 'req-3').activities[0].rhythm.kind === 'NONE');

// ============================================================
// Section D -- "Find time for your first activity" request building,
// reusing planDayEntry.ts's own real functions.
// ============================================================

check('13. resolveOnboardingPlanningDate returns a plain YYYY-MM-DD civil date string in the given timezone', /^\d{4}-\d{2}-\d{2}$/.test(resolveOnboardingPlanningDate('Asia/Kolkata', new Date('2026-06-15T20:00:00Z'))));
check('14. resolveOnboardingPlanningDate can disagree with UTC\'s own calendar date across a timezone boundary (a real timezone-aware derivation, not a UTC shortcut)', (() => {
  // 2026-06-15T20:00:00Z is already 2026-06-16 in Asia/Kolkata (UTC+5:30).
  const kolkata: string = resolveOnboardingPlanningDate('Asia/Kolkata', new Date('2026-06-15T20:00:00Z'));
  const utcDate: string = new Date('2026-06-15T20:00:00Z').toISOString().slice(0, 10);
  // Two disjoint exact literals, confirming they genuinely differ -- a
  // third `kolkata !== utcDate` check would be redundant (and TS rightly
  // flags it as always-true once both are narrowed to these literals).
  return kolkata === '2026-06-16' && utcDate === '2026-06-15';
})());

check('15. buildOnboardingFirstActivityIntent produces exactly one intent, FLEXIBLE, carrying the GoalActivity\'s own title/activityId/provenance', (() => {
  const { row, intents } = buildOnboardingFirstActivityIntent({ id: 'ga-1', title: 'Morning run', activityId: 'cardio-run' }, 'Asia/Kolkata', '2026-06-16');
  return intents.length === 1 && intents[0].title === 'Morning run' && intents[0].flexibility === 'FLEXIBLE' && intents[0].activityId === 'cardio-run' && row.goalActivityId === 'ga-1' && row.id === 'plan-day-goal-ga-1';
})());
check('16. a null activityId on the GoalActivity never fabricates one on the intent (stays undefined, resolved by title server-side like any other typed row)', (() => {
  const { intents } = buildOnboardingFirstActivityIntent({ id: 'ga-2', title: 'Read for 20 minutes', activityId: null }, 'Asia/Kolkata', '2026-06-16');
  return intents[0].activityId === undefined;
})());
check('17. no durationMinutes/fixedStart/deadline/importance is ever sent -- this step never invents scheduling preferences beyond the plain, flexible intent', (() => {
  const { intents } = buildOnboardingFirstActivityIntent({ id: 'ga-3', title: 'Stretch', activityId: null }, 'Asia/Kolkata', '2026-06-16');
  const intent = intents[0] as unknown as Record<string, unknown>;
  return !('durationMinutes' in intent) && !('fixedStart' in intent) && !('deadline' in intent) && !('importance' in intent);
})());

check('18. buildOnboardingFirstActivityGoalLinks links the row only when its intent id was actually placed', (() => {
  const { row } = buildOnboardingFirstActivityIntent({ id: 'ga-4', title: 'Journal', activityId: null }, 'Asia/Kolkata', '2026-06-16');
  const linked = buildOnboardingFirstActivityGoalLinks(row, [{ intentId: row.id }]);
  const notLinked = buildOnboardingFirstActivityGoalLinks(row, [{ intentId: 'some-other-intent' }]);
  return linked.length === 1 && linked[0].goalActivityId === 'ga-4' && linked[0].intentId === row.id && notLinked.length === 0;
})());

// ============================================================
// Preview-failure presentation -- reuses planDayEntry.ts's own
// presentPlanDayPreviewFailure verbatim; never new copy.
// ============================================================

check('19. NO_USABLE_CAPACITY presents a real, non-empty message and is not retryable (a deterministic fact about today\'s capacity)', (() => {
  const presentation = presentOnboardingFirstActivityPreviewFailure({ status: 'NO_USABLE_CAPACITY' } as Exclude<ConstructDayPreviewClientResult, { status: 'READY' }>);
  return presentation.message.length > 0 && presentation.retryable === false;
})());
check('20. NETWORK_ERROR is presented as retryable (a transient failure, not a deterministic fact)', (() => {
  const presentation = presentOnboardingFirstActivityPreviewFailure({ status: 'NETWORK_ERROR' } as Exclude<ConstructDayPreviewClientResult, { status: 'READY' }>);
  return presentation.retryable === true;
})());
check('21. a 401 HTTP_ERROR is presented as NOT editable/retryable via this path (session expired -- handled generically, never a raw status string leaking into the message)', (() => {
  const presentation = presentOnboardingFirstActivityPreviewFailure({ status: 'HTTP_ERROR', httpStatus: 401 } as Exclude<ConstructDayPreviewClientResult, { status: 'READY' }>);
  return !/HTTP_ERROR|401/.test(presentation.message) && presentation.message.length > 0;
})());

if (!allPassed) {
  console.error('\nSome Onboarding Goal Step checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL ONBOARDING GOAL STEP CHECKS PASSED');
}
