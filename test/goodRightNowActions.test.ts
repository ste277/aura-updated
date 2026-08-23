import { getActionCards } from '../packages/recommendation/src/actionCards';
import { getActivityDefinition, resolveActivityDefinition, ACTIVITY_DEFINITIONS_BY_ID } from '../packages/recommendation/src/activityDefinitions';
import { findActivityIntent, FULL_ACTIVITY_CATALOG } from '../packages/recommendation/src/personalizedTasks';
import type { SolarWindowType } from '../packages/panchang/src/windows';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const WINDOWS: SolarWindowType[] = ['BRAHMA', 'ABHIJIT', 'RAHU_KALAM', 'GULIKA', 'YAMA', 'NEUTRAL'];

// ============================================================
// Every Good Right Now card resolves to a real action, never a title regex
// (brief section 29) -- either a valid catalog activityId (resolved via
// getActivityDefinition, an id lookup) or an explicit card-level fallback.
// ============================================================

for (const window of WINDOWS) {
  for (const card of getActionCards(window)) {
    if (card.activityId) {
      const definition = getActivityDefinition(card.activityId);
      check(`${window}/${card.id}: activityId "${card.activityId}" resolves to a real ActivityDefinition`, Boolean(definition));
      check(`${window}/${card.id}: resolved definition has a valid immediateAction`, ['LOG_NOW', 'START_NOW', 'PLAN', 'BOTH'].includes(definition?.experience.immediateAction ?? ''));
    } else {
      check(`${window}/${card.id}: no activityId, so it must carry its own explicit immediateAction fallback`, card.immediateAction === 'LOG_NOW' || card.immediateAction === 'START_NOW');
    }
  }
}

// ============================================================
// Specific, intentional mappings (brief section 4/5) -- not the brief's own
// illustrative table applied blindly, but this app's ACTUAL current Good
// Right Now cards, audited and mapped by hand.
// ============================================================

check('NEUTRAL "Hydration check" -> task-6 -> LOG_NOW', getActivityDefinition('task-6')?.experience.immediateAction === 'LOG_NOW');
check('NEUTRAL "Short walk or stretch" -> task-7 -> START_NOW', getActivityDefinition('task-7')?.experience.immediateAction === 'START_NOW');
check('NEUTRAL "Regular work block" -> deep-work -> BOTH', getActivityDefinition('deep-work')?.experience.immediateAction === 'BOTH');
check('ABHIJIT "Heavy lifting..." -> workout -> BOTH', getActivityDefinition('workout')?.experience.immediateAction === 'BOTH');
check('GULIKA "Skill-building..." -> learning -> BOTH', getActivityDefinition('learning')?.experience.immediateAction === 'BOTH');
check('RAHU_KALAM "Step away and reset" -> tea-break -> LOG_NOW', getActivityDefinition('tea-break')?.experience.immediateAction === 'LOG_NOW');
check('BRAHMA "Light mobility or breathwork" -> task-3 -> START_NOW', getActivityDefinition('task-3')?.experience.immediateAction === 'START_NOW');

const neutralCards = getActionCards('NEUTRAL');
check('NEUTRAL has exactly 3 cards, unchanged ordering (no ranking regression, brief section 30)', neutralCards.length === 3 && neutralCards[0].id === 'neutral-focus' && neutralCards[1].id === 'neutral-break' && neutralCards[2].id === 'neutral-hydrate');

const gulikaCards = getActionCards('GULIKA');
check('GULIKA has exactly 3 cards, unchanged ordering', gulikaCards.length === 3 && gulikaCards[0].id === 'gulika-cardio' && gulikaCards[1].id === 'gulika-skill' && gulikaCards[2].id === 'gulika-social');

// Non-catalog "meal" cards -- no activityId, explicit LOG_NOW fallback.
const abhijitMeal = getActionCards('ABHIJIT').find((c) => c.id === 'abhijit-meal');
check('ABHIJIT "Main meal of the day" has no activityId (no generic meal activity in the catalog)', abhijitMeal?.activityId === undefined);
check('ABHIJIT "Main meal of the day" falls back to LOG_NOW', abhijitMeal?.immediateAction === 'LOG_NOW');

// ============================================================
// Full catalog coverage (brief section 4: "map every relevant current
// activity intentionally") -- every catalog entry has a defined
// immediateAction, and the representative PLAN/BOTH/LOG_NOW/START_NOW
// examples from the brief's own mapping intent resolve correctly against
// THIS catalog.
// ============================================================

for (const activity of FULL_ACTIVITY_CATALOG) {
  const definition = getActivityDefinition(activity.id);
  check(`${activity.id}: has a defined immediateAction`, ['LOG_NOW', 'START_NOW', 'PLAN', 'BOTH'].includes(definition?.experience.immediateAction ?? ''));
}

check('Date Night -> PLAN', getActivityDefinition('date-night')?.experience.immediateAction === 'PLAN');
check('Family Dinner -> PLAN', getActivityDefinition('family-dinner')?.experience.immediateAction === 'PLAN');
check('Birthday Party -> PLAN', getActivityDefinition('birthday-party')?.experience.immediateAction === 'PLAN');
check('Movie Night -> PLAN', getActivityDefinition('movie-night')?.experience.immediateAction === 'PLAN');
check('Road Trip -> PLAN', getActivityDefinition('road-trip')?.experience.immediateAction === 'PLAN');
check('Start a Journey -> PLAN', getActivityDefinition('start-journey')?.experience.immediateAction === 'PLAN');
check('Financial Decision -> PLAN', getActivityDefinition('financial-decision')?.experience.immediateAction === 'PLAN');
check('Property Purchase -> PLAN', getActivityDefinition('property-purchase')?.experience.immediateAction === 'PLAN');
check('Griha Pravesh -> PLAN (ceremonial)', getActivityDefinition('griha-pravesh')?.experience.immediateAction === 'PLAN');
check('Business Start -> PLAN', getActivityDefinition('business-start')?.experience.immediateAction === 'PLAN');
check('Deep Work -> BOTH', getActivityDefinition('deep-work')?.experience.immediateAction === 'BOTH');
check('Workout -> BOTH', getActivityDefinition('workout')?.experience.immediateAction === 'BOTH');
check('Learning -> BOTH', getActivityDefinition('learning')?.experience.immediateAction === 'BOTH');
check('Tea Break -> LOG_NOW', getActivityDefinition('tea-break')?.experience.immediateAction === 'LOG_NOW');

// Ambiguous cases flagged in the completion report -- still resolve to a
// safe, defined value (PLAN), not left undefined.
check('Walk Together (flagged ambiguous) resolves to a defined value (PLAN, the safer default)', getActivityDefinition('walk-together')?.experience.immediateAction === 'PLAN');
check('Catch Up (flagged ambiguous) resolves to a defined value (PLAN, the safer default)', getActivityDefinition('catch-up')?.experience.immediateAction === 'PLAN');

// ============================================================
// Fallback default (brief section 3: "smallest product metadata
// extension") -- only reached for a hypothetical future catalog entry with
// no explicit ACTIVITY_METADATA override.
// ============================================================

check('Every activity in ACTIVITY_DEFINITIONS_BY_ID has an explicit, non-crashing immediateAction', Object.values(ACTIVITY_DEFINITIONS_BY_ID).every((d) => Boolean(d.experience.immediateAction)));

// ============================================================
// resolveActivityDefinition's FALLBACK_CLASSIFIER path (free text with no
// catalog match) still returns a valid, safe immediateAction -- never
// crashes, never LOG_NOW/START_NOW-only (which would hide Plan for
// something nobody has actually classified).
// ============================================================

const fallbackResolution = resolveActivityDefinition('some totally made up activity nobody catalogued xyz123');
check('Unknown free text resolves via FALLBACK_CLASSIFIER, not CATALOG', fallbackResolution.source === 'FALLBACK_CLASSIFIER');
check('Unknown free text still gets a defined, safe immediateAction (BOTH -- never hides Plan)', fallbackResolution.definition.experience.immediateAction === 'BOTH');

// ============================================================
// Plan handoff correctness (brief section 11) -- passing the REAL catalog
// title (not a window-flavor card title) into the existing free-text
// prefill must resolve back to the SAME canonical activity via
// findActivityIntent(), the exact function Plan's own search submission
// already uses. This is what makes "Plan for later" actually preselect the
// right activity instead of silently falling through to the fallback
// classifier.
// ============================================================

for (const activityId of ['deep-work', 'workout', 'learning', 'date-night', 'griha-pravesh']) {
  const activity = FULL_ACTIVITY_CATALOG.find((a) => a.id === activityId)!;
  const resolved = findActivityIntent(activity.title);
  check(`Passing the canonical title "${activity.title}" into Plan's prefill resolves back to "${activityId}" via findActivityIntent (not the fallback classifier)`, resolved?.id === activityId);
}

// The bug this fixes: the OLD behavior passed the card's own window-flavor
// title (e.g. "Regular work block") into the same prefill mechanism, which
// does NOT match any deep-work alias.
check('The OLD window-flavor card title "Regular work block" does NOT match deep-work (proves the fix was necessary)', findActivityIntent('Regular work block')?.id !== 'deep-work');

if (!allPassed) {
  console.error('\nSome Good Right Now Actions checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL GOOD RIGHT NOW ACTIONS CHECKS PASSED');
}
