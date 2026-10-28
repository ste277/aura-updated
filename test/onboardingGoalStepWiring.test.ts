/**
 * Onboarding V1 PR 4 -- First Goal & Personalization: structural
 * regression suite for the GOAL/FIRST_STEP steps added to
 * apps/web/components/OnboardingJourney.tsx. No component-test harness
 * exists in this repo for client components, so this follows the
 * established source-text/regex structural-assertion pattern (see
 * test/onboardingJourneyLogic.test.ts, test/locationPickerSmartSelection.test.ts).
 *
 * Covers the ticket's own required invariants:
 *   A. No competing Goal/planning model (reuse only).
 *   B. Optional first Goal (categories are discovery aids, no required
 *      birth/availability, skip always available).
 *   C. Minimum Goal input (no invented defaults for frequency/duration/
 *      deadline/completion beyond the EXISTING disclosed ones).
 *   D. First actionable step (reuses Day Constructor preview/accept
 *      verbatim, never auto-schedules, preserves safeguards).
 *   E. Skip/interruption (idempotent create, no re-opening onboarding).
 *   F. Personalization (no mandatory birth/availability).
 */
import * as fs from 'fs';
import * as path from 'path';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function read(rel: string): string {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}
function stripComments(source: string): string {
  return source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const journeySource = read('apps/web/components/OnboardingJourney.tsx');
const journey = stripComments(journeySource);
const pageSource = stripComments(read('apps/web/app/page.tsx'));
const helperSource = stripComments(read('apps/web/lib/onboardingGoalStep.ts'));

// ============================================================
// A. Reuse, no competing Goal/planning model.
// ============================================================

check('A1. Goal creation reuses the EXISTING POST /api/goals contract -- no second Goal-creation endpoint', /fetch\('\/api\/goals', \{\s*method: 'POST'/.test(journey) && !/\/api\/goals\/[^']*create|\/api\/onboarding-goals/.test(journey));
check('A2. the first-activity step reuses the EXISTING DayPlanPreviewController/DayPlanPreview UNMODIFIED -- imported, never redefined in this file', /import \{ DayPlanPreviewController \} from '\.\/DayPlanPreviewController'/.test(journey) && !/function DayPlanPreviewController|function DayPlanPreview\b/.test(journey));
check('A3. reuses the EXISTING previewConstructedDay client helper -- no second preview request implementation (no second "/api/day-constructor/preview" fetch literal in this file)', /import \{ previewConstructedDay \} from '\.\.\/lib\/dayConstructorPreviewClient'/.test(journey) && !/\/api\/day-constructor\/preview/.test(journey));
check('A4. reuses the EXISTING RhythmPicker component for the one Goal activity\'s rhythm -- no second rhythm-input control', /import \{ RhythmPicker, type RhythmPickerValue \} from '\.\/RhythmPicker'/.test(journey) && !/function RhythmPicker/.test(journey));
check('A5. no second Goal/GoalActivity persistence path -- this file never imports db.ts/createGoalWithActivities/persistAcceptedConstructedDay directly (every write goes through the existing API routes / DayPlanPreviewController)', !/from '\.\.\/lib\/db'|createGoalWithActivities|persistAcceptedConstructedDay/.test(journey));
check('A6. onboardingGoalStep.ts itself never calls fetch/constructs a second Day Constructor engine -- purely request/response shaping around the EXISTING pipeline', !/fetch\(/.test(helperSource) && !/function constructDay\b|function orchestrateConstructDay\b/.test(helperSource));

// ============================================================
// B. Optional first Goal -- categories, custom entry, always-visible skip.
// ============================================================

check('B1. the Goal offer\'s own prompt matches the ticket verbatim', /What would you like Aura to help you accomplish\?/.test(journey));
check('B2. category chips come from the shared ONBOARDING_GOAL_CATEGORIES list, never a second inline hardcoded list', /ONBOARDING_GOAL_CATEGORIES\.map/.test(journey));
check('B3. a custom/freeform intention entry point exists distinct from the category chips', /Enter my own/.test(journey) && /function chooseCustom/.test(journey));
check('B4. category selection never submits anything by itself -- it only sets the editable title and moves to COMPOSE, the user still explicitly taps Create goal', (() => {
  const start = journey.indexOf('function chooseCategory');
  const body = journey.slice(start, journey.indexOf('\n  }', start));
  return /setTitle\(category\.suggestedTitle\)/.test(body) && /setPhase\('COMPOSE'\)/.test(body) && !/fetch\(/.test(body);
})());
check('B5. Skip for now is present in BOTH the category-choice screen and the compose screen (never a dead end at either point)', (journey.match(/Skip for now/g) ?? []).length >= 2);
check('B6. the Goal step\'s Skip is wired to the SAME onSkip/onExit exit used by the rest of onboarding, never a bespoke second exit mechanism', /function GoalStep\(\{ onGoalCreated, onSkip \}/.test(journey) && /step === 'GOAL'[\s\S]{0,260}onSkip=\{onExit\}/.test(journey));

// ============================================================
// C. Minimum Goal input -- no invented defaults beyond the existing,
// already-disclosed ones (NONE rhythm / "Once").
// ============================================================

check('C1. no targetDate/deadline field is ever collected or sent by this step', !/targetDate|deadline/i.test(helperSource) && !/onboarding-goal-target-date|onboarding-goal-deadline/.test(journey));
check('C2. no duration field is ever collected for the Goal activity itself (Day Constructor resolves duration downstream, exactly as it already does for every other typed row)', !/durationMinutes.*onboarding-goal|onboarding-goal.*durationMinutes/.test(journey));
check('C3. the rhythm picker is ALWAYS rendered (never hidden/conditionally omitted) -- the "Once" default stays visible and editable, never a silent server-side default the user never saw', /<RhythmPicker value=\{rhythm \?\? \{ kind: 'NONE' \}\} onChange=\{setRhythm\}/.test(journey));
check('C4. a currently-invalid rhythm (e.g. empty Custom) disables Create goal rather than silently falling back to NONE', /disabled=\{!isOnboardingGoalTitleValid\(title\) \|\| rhythm === null \|\| submitting\}/.test(journey));
check('C5. the title input enforces the SAME max length the server itself enforces (ONBOARDING_GOAL_TITLE_MAX_LENGTH, mirroring MAX_TITLE_LENGTH in app/api/goals/route.ts) -- never a second, independently-chosen limit', /maxLength=\{ONBOARDING_GOAL_TITLE_MAX_LENGTH\}/.test(journey));

// ============================================================
// D. First actionable step -- reuses the existing pipeline, never
// auto-schedules, preserves every safeguard by construction (none of
// FIXED/availability/capacity/locking logic is reimplemented here).
// ============================================================

check('D1. the first-activity preview is requested automatically on mount (so the user sees it immediately after creating a Goal) but NEVER auto-accepted -- onSaved only fires from the reused controller\'s own explicit user action', /useEffect\(\(\) => \{\s*runPreview\(\);\s*\}, \[runPreview\]\);/.test(journey) && !/acceptConstructedDay\(/.test(journey));
check('D2. the created GoalActivity is linked via goalActivityLinks exactly as the EXISTING Goal -> Planning handoff already does (buildOnboardingFirstActivityGoalLinks / buildGoalActivityLinksForAccept), never a bespoke linking mechanism', /buildOnboardingFirstActivityGoalLinks/.test(journey) && /buildGoalActivityLinksForAccept/.test(helperSource));
check('D3. onDiscard/onSaved on the reused controller both resolve onboarding via onDone -- declining and accepting are both treated as a complete, valid outcome (never an error)', /onDiscard=\{onDone\}/.test(journey) && /onSaved=\{onDone\}/.test(journey));
check('D4. a failed/non-READY preview explicitly states the Goal is still saved, never implying it was lost or that nothing happened', /Your goal is saved -- you can plan it anytime from Goals or Plan my day\./.test(journey));
check('D5. a retryable failure offers Try again using the SAME runPreview function, never a hand-rolled duplicate request', /state\.retryable &&[\s\S]{0,80}onClick=\{runPreview\}/.test(journey));
check('D6. this file never constructs a ProposedItem/PlannedActivity object literal itself -- scheduling facts only ever come back from the reused preview/accept pipeline', !/placementSource:\s*'(FIXED_CONSTRAINT|SELECTED_CANDIDATE)'/.test(journey));

// ============================================================
// E. Skip / interruption / idempotency.
// ============================================================

check('E1. a fresh clientRequestId is generated once per GoalStep mount and reused across retries -- the SAME idempotency lifecycle CreateGoalModal already establishes, never regenerated per keystroke/attempt', /const \[clientRequestId\] = useState\(\(\) => crypto\.randomUUID\(\)\);/.test(journey));
check('E2. Create goal is disabled while a request is in flight (double-submit UI guard) -- the REAL protection is still the server-side clientRequestId, this is defense-in-depth only', /disabled=\{!isOnboardingGoalTitleValid\(title\) \|\| rhythm === null \|\| submitting\}/.test(journey));
check('E3. no onboarding step anywhere persists its own position/progress to localStorage/sessionStorage -- a refresh mid-Goal-flow behaves exactly like a refresh mid-Location-step already does today (restarts at WELCOME, never a half-resolved state)', !/localStorage|sessionStorage/.test(journey));
check('E4. exiting from GOAL or FIRST_STEP always funnels through the ONE existing onExit (handleExitOnboarding) -- never a second resolution path, never reopens onboarding based on Goal count', /onExit=\{handleExitOnboarding\}/.test(pageSource) && !/onboardingActive[\s\S]{0,40}goals\.length|hasGoals/.test(pageSource));
check('E5. GOAL/FIRST_STEP are excluded from the 3-step progress indicator (never shown as "Step 4 of 3") -- they are an optional continuation, not additional required setup', /stepIndex !== null &&/.test(journey) && /step === 'RECOMMENDATION' \? 3 : null/.test(journey));

// ============================================================
// F. Personalization -- no mandatory birth details or availability
// anywhere in this new surface.
// ============================================================

check('F1. no birth-detail concept anywhere in the Goal/first-activity steps', !/birthDate|birthTime|birthCityName|birthLatitude|birthLongitude|natal/i.test(journey));
check('F2. no availability-configuration concept anywhere in the Goal/first-activity steps (the reused Day Constructor pipeline resolves this server-side exactly as it already does for Plan My Day -- this file never gates on it)', !/availabilityConfigured|AvailabilityConfiguration/.test(journey));
check('F3. onboardingGoalStep.ts itself never references birth or availability concepts', !/birthDate|birthTime|birthCityName|availabilityConfigured|AvailabilityConfiguration/i.test(helperSource));

// ============================================================
// Mobile/accessibility basics, consistent with this file's own
// pre-existing convention.
// ============================================================

check('a confirm/creation failure is rendered with role="alert" in the Goal step, same convention as the existing LocationStep error', /role="alert"[\s\S]{0,200}\{error\}/.test(journey));
check('every new primary/secondary action in the Goal/first-activity steps meets the 44px touch-target minimum', (journey.match(/minHeight: 44/g) ?? []).length >= 6);

if (!allPassed) {
  console.error('\nSome Onboarding Goal Step Wiring checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL ONBOARDING GOAL STEP WIRING CHECKS PASSED');
}
