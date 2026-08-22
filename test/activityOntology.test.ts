import { evaluateActivityFit, familyForActivityProfile } from '../packages/recommendation/src/auraFitEngine';
import { FULL_ACTIVITY_CATALOG, findActivityIntent } from '../packages/recommendation/src/personalizedTasks';
import {
  ACTIVITY_DEFINITIONS,
  getActivityDefinition,
  resolveActivityDefinition,
  toLegacyMuhurtaFamily,
} from '../packages/recommendation/src/activityDefinitions';
import { classifyMuhurtaActivity } from '../packages/muhurta/src/muhurtaEngine';
import { familyForIntent, legacyFamilyToIntent } from '../packages/muhurta/src/activityOntology';

let allPassed = true;

function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// --- Every catalog activity resolves through explicit metadata --------------

check(
  'Every catalog activity has an ActivityDefinition',
  ACTIVITY_DEFINITIONS.length === FULL_ACTIVITY_CATALOG.length
);

check(
  'Every ActivityDefinition has a non-empty family, intent, and socialMode',
  ACTIVITY_DEFINITIONS.every((def) => Boolean(def.muhurta.family) && Boolean(def.muhurta.intent) && Boolean(def.socialMode))
);

check(
  'getActivityDefinition resolves a known catalog id',
  getActivityDefinition('start-journey')?.muhurta.intent === 'JOURNEY_START'
);

check(
  'getActivityDefinition resolves by ActivityProfile object',
  (() => {
    const activity = FULL_ACTIVITY_CATALOG.find((item) => item.id === 'dating');
    return activity ? getActivityDefinition(activity)?.muhurta.intent === 'DATE' : false;
  })()
);

// --- Backward compatibility: toLegacyMuhurtaFamily() must exactly match today's engine input ---

check(
  'MuhurtaClassification does not carry a legacy engine family (kept out of the canonical model)',
  ACTIVITY_DEFINITIONS.every((def) => !('legacyFamily' in def.muhurta))
);

check(
  'toLegacyMuhurtaFamily() matches familyForActivityProfile() for every catalog activity (zero scoring change)',
  FULL_ACTIVITY_CATALOG.every((activity) => {
    const def = getActivityDefinition(activity);
    return def ? toLegacyMuhurtaFamily(def) === familyForActivityProfile(activity) : false;
  })
);

// --- Status: ambiguous/legacy activities are flagged, not silently treated as canonical ---

check('High-Stakes Decision or Pitch is flagged AMBIGUOUS', getActivityDefinition('task-1')?.status === 'AMBIGUOUS');
check('High-Stakes Decision or Pitch uses the broader IMPORTANT_DECISION intent', getActivityDefinition('task-1')?.muhurta.intent === 'IMPORTANT_DECISION');
check('Breathwork & Strategic Visioning is flagged AMBIGUOUS', getActivityDefinition('task-3')?.status === 'AMBIGUOUS');
check('New Beginning is flagged LEGACY_ALIAS', getActivityDefinition('new-beginning')?.status === 'LEGACY_ALIAS');
check(
  'Every non-CANONICAL activity documents why via notes',
  ACTIVITY_DEFINITIONS.filter((def) => def.status !== 'CANONICAL').every((def) => Boolean(def.notes))
);
check(
  'Most activities remain CANONICAL (status is the exception, not the norm)',
  ACTIVITY_DEFINITIONS.filter((def) => def.status === 'CANONICAL').length >= ACTIVITY_DEFINITIONS.length - 3
);

// --- Significance can be decoupled from the raw catalog field when it's a poor Muhurta proxy ---

check(
  'Workout significance is decoupled to MEDIUM (catalog HIGH reflects planner priority, not Muhurta importance)',
  getActivityDefinition('workout')?.muhurta.significance === 'MEDIUM'
);
check(
  'Workout intent/family are unchanged by the significance override',
  getActivityDefinition('workout')?.muhurta.intent === 'WORKOUT' && getActivityDefinition('workout')?.muhurta.family === 'HEALTH'
);

// --- Financial Decision uses the broader intent, not the too-specific INVESTMENT ---

check(
  'Financial Decision uses IMPORTANT_FINANCIAL_DECISION, not the too-specific INVESTMENT',
  getActivityDefinition('financial-decision')?.muhurta.intent === 'IMPORTANT_FINANCIAL_DECISION'
);

// Sanity: family taxonomy is internally consistent (every intent used by the
// catalog resolves to the family it's declared under).
check(
  'Every ActivityDefinition.family matches familyForIntent(intent)',
  ACTIVITY_DEFINITIONS.every((def) => def.muhurta.family === familyForIntent(def.muhurta.intent))
);

// --- Known catalog activity -> explicit ActivityDefinition (not title regex) ---

// Product Structure V2: "road trip" now resolves to the dedicated EVERYDAY
// road-trip activity (OUTING intent), not the IMPORTANT/DEEP start-journey
// -- a casual weekend road trip is a different occasion from an important
// journey or relocation (see activityDefinitions.ts's road-trip notes and
// personalizedTasks.ts's start-journey comment). This is an intentional
// product change, not a regression -- start-journey's own aliases no
// longer include "road trip" at all.
const roadTrip = resolveActivityDefinition('I need to start my road trip');
check('Known free-text phrase resolves via the catalog, not the classifier', roadTrip.source === 'CATALOG');
check('Known free-text phrase resolves to the dedicated everyday road-trip activity', roadTrip.activity?.id === 'road-trip');
check('Known free-text phrase carries the OUTING intent', roadTrip.definition.muhurta.intent === 'OUTING');
check(
  'Catalog resolution keeps the exact legacy family the engine already uses today',
  toLegacyMuhurtaFamily(roadTrip.definition) === familyForActivityProfile(findActivityIntent('I need to start my road trip')!)
);

// --- Unknown/free-text task -> existing classifier fallback (untouched) ---

const freeTextTitle = 'file the quarterly expense paperwork';
const fallback = resolveActivityDefinition(freeTextTitle);
check('Unrecognized free text falls back to the classifier', fallback.source === 'FALLBACK_CLASSIFIER');
check(
  'Fallback resolution matches classifyMuhurtaActivity() directly (fallback path unchanged)',
  toLegacyMuhurtaFamily(fallback.definition) === classifyMuhurtaActivity(freeTextTitle)
);
check(
  'Fallback intent maps back to the same broad family bucket',
  fallback.definition.muhurta.family === familyForIntent(legacyFamilyToIntent(classifyMuhurtaActivity(freeTextTitle)))
);

// --- Regression: Aura Fit scoring is untouched by this refactor -------------

const date = new Date(Date.UTC(2026, 6, 28, 6, 45, 0));
const journeyActivity = findActivityIntent('start a journey')!;
const fitBefore = evaluateActivityFit({ activity: journeyActivity, date, windowType: 'ABHIJIT' });
check(
  'evaluateActivityFit still runs and produces a scored, labeled result (engine untouched)',
  typeof fitBefore.score === 'number' && Boolean(fitBefore.label)
);
check(
  'Journey start still scores well during Abhijit (existing behaviour preserved)',
  fitBefore.score >= 70
);

console.log(allPassed ? '\nALL ACTIVITY ONTOLOGY CHECKS PASSED' : '\nSOME ACTIVITY ONTOLOGY CHECKS FAILED');
process.exit(allPassed ? 0 : 1);