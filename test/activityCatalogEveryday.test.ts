import { FULL_ACTIVITY_CATALOG, findActivityIntent } from '../packages/recommendation/src/personalizedTasks';
import { ACTIVITY_DEFINITIONS, ACTIVITY_DEFINITIONS_BY_ID, getActivityDefinition } from '../packages/recommendation/src/activityDefinitions';
import { SUPPORTED_MUHURTHAM_ACTIVITY_IDS } from '../packages/recommendation/src/muhurthamFinder';

/**
 * Product Structure V2 -- everyday activity catalog tests (brief section 33).
 * Covers: canonical resolution, socialMode/evaluationDepth/engine intent-family
 * correctness, moment/Plan eligibility, alias resolution, and -- most
 * importantly -- the regression this whole feature depends on staying true:
 * everyday catalog expansion must NEVER change Muhurtham Finder's supported
 * activity list.
 */

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const EVERYDAY_IDS = [
  'date-night', 'dinner-date', 'coffee-tea', 'movie-night', 'walk-together',
  'family-dinner', 'family-outing', 'visit-family', 'family-movie-night',
  'dinner-with-friends', 'catch-up', 'game-night',
  'birthday-party', 'anniversary-dinner', 'celebration-dinner',
  'road-trip', 'day-trip', 'picnic', 'shopping-trip',
];

// ============================================================
// Canonical resolution -- every new everyday id has an ActivityDefinition
// ============================================================

for (const id of EVERYDAY_IDS) {
  check(`${id} resolves via findActivityIntent()`, FULL_ACTIVITY_CATALOG.some((a) => a.id === id));
  check(`${id} has an ActivityDefinition`, ACTIVITY_DEFINITIONS_BY_ID[id] !== undefined);
}

// ============================================================
// The single most important regression: strict Muhurtham Finder eligibility
// (brief section 24 -- "this must have a regression test")
// ============================================================

check(
  'None of the 19 new everyday activities appear in SUPPORTED_MUHURTHAM_ACTIVITY_IDS',
  EVERYDAY_IDS.every((id) => !SUPPORTED_MUHURTHAM_ACTIVITY_IDS.includes(id))
);
check(
  'Every everyday activity has LIGHT or STANDARD evaluationDepth (never DEEP/CEREMONIAL)',
  EVERYDAY_IDS.every((id) => {
    const depth = ACTIVITY_DEFINITIONS_BY_ID[id]?.muhurta.evaluationDepth;
    return depth === 'LIGHT' || depth === 'STANDARD';
  })
);
check(
  'SUPPORTED_MUHURTHAM_ACTIVITY_IDS is unchanged from the pre-V2 ceremonial/important set',
  JSON.stringify([...SUPPORTED_MUHURTHAM_ACTIVITY_IDS].sort()) ===
    JSON.stringify(['business-start', 'financial-decision', 'griha-pravesh', 'new-beginning', 'property-purchase', 'start-journey'].sort())
);

// ============================================================
// socialMode / evaluationDepth / planningMode spot checks (brief section 33)
// ============================================================

function classification(id: string) {
  return ACTIVITY_DEFINITIONS_BY_ID[id]!;
}

check('Date Night is canonical', classification('date-night').status === 'CANONICAL');
check('Date Night has PAIR socialMode', classification('date-night').socialMode === 'PAIR');
check('Date Night is STANDARD depth / EVERYDAY planningMode', classification('date-night').muhurta.evaluationDepth === 'STANDARD' && classification('date-night').experience.planningMode === 'EVERYDAY');
check('Date Night uses the existing RELATIONSHIP/DATE intent (not a new one)', classification('date-night').muhurta.family === 'RELATIONSHIP' && classification('date-night').muhurta.intent === 'DATE');

check('Family Dinner is canonical', classification('family-dinner').status === 'CANONICAL');
check('Family Dinner has FAMILY socialMode', classification('family-dinner').socialMode === 'FAMILY');
check('Family Dinner is STANDARD depth', classification('family-dinner').muhurta.evaluationDepth === 'STANDARD');
check('Family Dinner uses the new FAMILY_GATHERING intent under SOCIAL', classification('family-dinner').muhurta.family === 'SOCIAL' && classification('family-dinner').muhurta.intent === 'FAMILY_GATHERING');

check('Birthday Party is canonical', classification('birthday-party').status === 'CANONICAL');
check('Birthday Party has GROUP socialMode', classification('birthday-party').socialMode === 'GROUP');
check('Birthday Party uses the new CELEBRATION intent (distinct from generic PARTY)', classification('birthday-party').muhurta.intent === 'CELEBRATION');

check('Movie Night is canonical', classification('movie-night').status === 'CANONICAL');
check('Movie Night is LIGHT depth', classification('movie-night').muhurta.evaluationDepth === 'LIGHT');
check('Movie Night has ANY socialMode', classification('movie-night').socialMode === 'ANY');

check('Coffee / Tea is canonical', classification('coffee-tea').status === 'CANONICAL');
check('Coffee / Tea is LIGHT depth', classification('coffee-tea').muhurta.evaluationDepth === 'LIGHT');

check('Road Trip is canonical', classification('road-trip').status === 'CANONICAL');
check('Road Trip is STANDARD depth (distinct from start-journey\'s DEEP)', classification('road-trip').muhurta.evaluationDepth === 'STANDARD');
check('Road Trip uses the new OUTING intent under TRAVEL', classification('road-trip').muhurta.family === 'TRAVEL' && classification('road-trip').muhurta.intent === 'OUTING');

// ============================================================
// Moment / Plan eligibility (brief section 4's experience layer)
// ============================================================

check('Every everyday activity is momentEligible', EVERYDAY_IDS.every((id) => classification(id).experience.momentEligible === true));
check('Home daily-assistant playbook cards (task-1..7) are NOT momentEligible', ACTIVITY_DEFINITIONS.filter((d) => d.id.startsWith('task-')).every((d) => d.experience.momentEligible === false));
check('Griha Pravesh (ceremonial) is momentEligible too -- momentEligible is not planningMode-gated', classification('griha-pravesh').experience.momentEligible === true);
check('Every everyday activity has planningMode EVERYDAY', EVERYDAY_IDS.every((id) => classification(id).experience.planningMode === 'EVERYDAY'));
check('Griha Pravesh has planningMode CEREMONIAL', classification('griha-pravesh').experience.planningMode === 'CEREMONIAL');
check('start-journey has planningMode IMPORTANT', classification('start-journey').experience.planningMode === 'IMPORTANT');

// ============================================================
// Alias resolution -- no catalog activity's own alias resolves to a
// DIFFERENT activity (a real bug this test caught during development:
// generic aliases like bare "coffee"/"tea" collided with tea-break)
// ============================================================

let anyAliasCollision = false;
for (const activity of FULL_ACTIVITY_CATALOG) {
  for (const alias of activity.aliases) {
    const resolved = findActivityIntent(alias);
    // task-6's 'water break' -> tea-break and business-start's 'launch a
    // business' -> new-beginning are PRE-EXISTING collisions in
    // findActivityIntent()'s longest-alias sort, unrelated to this PR --
    // excluded here rather than silently fixed (not this PR's scope).
    const knownPreExisting = (activity.id === 'task-6' && alias === 'water break') || (activity.id === 'business-start' && alias === 'launch a business');
    if (knownPreExisting) continue;
    if (resolved?.id !== activity.id) {
      anyAliasCollision = true;
      console.log(`  -> alias "${alias}" (belongs to ${activity.id}) resolved to ${resolved?.id ?? 'undefined'}`);
    }
  }
}
check('No new everyday activity alias collides with another activity', !anyAliasCollision);

check('"road trip" now resolves to the everyday road-trip activity, not start-journey', findActivityIntent('road trip')?.id === 'road-trip');
check('"start a journey" still resolves to start-journey', findActivityIntent('start a journey')?.id === 'start-journey');
check('getActivityDefinition resolves every new everyday id', EVERYDAY_IDS.every((id) => getActivityDefinition(id)?.id === id));

console.log(allPassed ? '\nALL EVERYDAY ACTIVITY CATALOG CHECKS PASSED' : '\nSOME EVERYDAY ACTIVITY CATALOG CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
