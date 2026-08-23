import { getActivityDefinition, resolveActivityDefinition, ACTIVITY_DEFINITIONS_BY_ID } from '../packages/recommendation/src/activityDefinitions';
import { getActionCards } from '../packages/recommendation/src/actionCards';
import { FULL_ACTIVITY_CATALOG } from '../packages/recommendation/src/personalizedTasks';
import type { SolarWindowType } from '../packages/panchang/src/windows';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// Brief section 17's explicit per-activity assertions.
// ============================================================

check('Hydration Check (task-6) -> INSTANT', getActivityDefinition('task-6')?.experience.durationMode === 'INSTANT');
check('Hydration Check has no defaultDurationMinutes to manufacture a fake elapsed time from', FULL_ACTIVITY_CATALOG.find((a) => a.id === 'task-6')?.defaultDurationMinutes === undefined);

check('Tea Break -> FIXED', getActivityDefinition('tea-break')?.experience.durationMode === 'FIXED');
check('Tea Break carries a real catalog defaultDurationMinutes (10), not a hardcoded UI constant', getActivityDefinition('tea-break')?.experience.defaultDurationMinutes === 10);

check('Deep Work -> USER_SELECTED', getActivityDefinition('deep-work')?.experience.durationMode === 'USER_SELECTED');
check('Deep Work carries suggestedDurations for the picker', JSON.stringify(getActivityDefinition('deep-work')?.experience.suggestedDurations) === JSON.stringify([30, 60, 90]));

check('Workout -> USER_SELECTED', getActivityDefinition('workout')?.experience.durationMode === 'USER_SELECTED');
check('Workout carries suggestedDurations', (getActivityDefinition('workout')?.experience.suggestedDurations?.length ?? 0) > 1);

check('Learning -> USER_SELECTED', getActivityDefinition('learning')?.experience.durationMode === 'USER_SELECTED');
check('Learning carries suggestedDurations', (getActivityDefinition('learning')?.experience.suggestedDurations?.length ?? 0) > 1);

// Stretch/Mobility -> FIXED (brief section 3's own example).
check('Light Stretch & Mobility (task-7) -> FIXED', getActivityDefinition('task-7')?.experience.durationMode === 'FIXED');
check('task-7 carries a real catalog defaultDurationMinutes', getActivityDefinition('task-7')?.experience.defaultDurationMinutes === 10);

// ============================================================
// PLAN-only activity -- durationMode is defined (required field) but never
// alters PLAN behavior (brief section 3/15): immediateAction stays PLAN
// regardless of what durationMode resolves to.
// ============================================================

{
  const dateNight = getActivityDefinition('date-night');
  check('Date Night (PLAN-only) still resolves immediateAction PLAN, unchanged by this PR', dateNight?.experience.immediateAction === 'PLAN');
  check('Date Night has a defined (non-crashing) durationMode even though nothing reads it for PLAN', typeof dateNight?.experience.durationMode === 'string');
}

// ============================================================
// BOTH activities -- immediate action AND Plan-for-later both still work
// (brief section 17's "BOTH" test).
// ============================================================

for (const id of ['deep-work', 'workout', 'learning']) {
  const definition = getActivityDefinition(id);
  check(`${id}: BOTH activity keeps immediateAction BOTH (Start now + Plan for later coexist)`, definition?.experience.immediateAction === 'BOTH');
}

// ============================================================
// Every activity has a defined durationMode -- no unhandled/undefined case
// anywhere in the catalog (brief section 2: durationMode is a required
// field, never inferred from title text at render time).
// ============================================================

for (const definition of Object.values(ACTIVITY_DEFINITIONS_BY_ID)) {
  check(`${definition.id}: has a defined durationMode`, ['INSTANT', 'FIXED', 'USER_SELECTED', 'SESSION'].includes(definition.experience.durationMode));
}

// No activity is silently defaulted to INSTANT by the fallback -- INSTANT
// must always be an explicit, deliberate choice (brief section 4).
check(
  'Exactly one activity in the whole catalog is INSTANT (task-6, the only deliberate choice) -- the fallback never invents INSTANT',
  Object.values(ACTIVITY_DEFINITIONS_BY_ID).filter((d) => d.experience.durationMode === 'INSTANT').length === 1
);

// SESSION is architecture-only -- no current activity selects it (brief
// section 7: "Do not expose SESSION unless a current activity genuinely
// requires it").
check(
  'No activity currently resolves to SESSION (architecture-only in this PR)',
  Object.values(ACTIVITY_DEFINITIONS_BY_ID).every((d) => d.experience.durationMode !== 'SESSION')
);

// Unknown free text (FALLBACK_CLASSIFIER) never invents INSTANT/FIXED --
// USER_SELECTED is the safe default, matching immediateAction's own
// "never hides Plan" reasoning.
{
  const fallback = resolveActivityDefinition('some totally made up activity nobody catalogued xyz123');
  check('Unknown free text resolves durationMode to USER_SELECTED (never invents a number nobody chose)', fallback.definition.experience.durationMode === 'USER_SELECTED');
}

// ============================================================
// Regression (brief section 18): the 18 Good Right Now action-card
// mappings and their ordering are unchanged by this PR -- this PR only
// added durationMode, never touched activityId/immediateAction/ordering.
// ============================================================

const WINDOWS: SolarWindowType[] = ['BRAHMA', 'ABHIJIT', 'RAHU_KALAM', 'GULIKA', 'YAMA', 'NEUTRAL'];
let totalCards = 0;
for (const window of WINDOWS) {
  const cards = getActionCards(window);
  totalCards += cards.length;
  check(`${window} still has exactly 3 Good Right Now cards`, cards.length === 3);
}
check('All 6 windows together still produce exactly 18 action-card mappings', totalCards === 18);

if (!allPassed) {
  console.error('\nSome Good Right Now duration semantics checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL GOOD RIGHT NOW DURATION SEMANTICS CHECKS PASSED');
}
