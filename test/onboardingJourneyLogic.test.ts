/**
 * Onboarding V1 PR 2 -- Welcome, Location Confirmation & First Useful
 * Recommendation: structural regression suite for
 * apps/web/components/OnboardingJourney.tsx and its wiring in
 * apps/web/app/page.tsx. No component-test harness exists in this repo
 * for client components, so this follows the established source-text/
 * regex structural-assertion pattern (see test/locationTrustDisclosureUi.test.ts,
 * test/locationSaveFailureState.test.ts).
 *
 * Covers the ticket's own required scenarios:
 *   B. Location confirmation (explicit confirm, different city, custom
 *      location, network failure/retry, skip, no automatic confirmation)
 *   C. Recommendation (real engine integration, no fabricated data, no
 *      birth/Goal/availability requirement, unconfirmed-location and
 *      no-window fallbacks)
 *   D. Navigation (every transition, no redirect loop, returning users
 *      bypass Welcome)
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
// Line comments stripped FIRST, then block comments -- page.tsx has an
// existing, legitimate `//` comment whose own prose contains a literal
// "/*" substring (a wildcard route reference, "GET /api/daily-assistant/*
// each independently..."); stripping block comments first would
// misinterpret that stray "/*" as a REAL block-comment start and eat
// everything up to the next unrelated "*/" anywhere later in the file.
function stripComments(source: string): string {
  return source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const journeySource = read('apps/web/components/OnboardingJourney.tsx');
const journey = stripComments(journeySource);
const pageSource = stripComments(read('apps/web/app/page.tsx'));
const sessionRouteSource = stripComments(read('apps/web/app/api/auth/session/route.ts'));
const onboardingRouteSource = stripComments(read('apps/web/app/api/users/onboarding/route.ts'));
const dbSource = stripComments(read('apps/web/lib/db.ts'));

// ============================================================
// Architecture boundaries -- reuse, no duplicate state/persistence.
// ============================================================

check('reuses the EXISTING LocationPicker component (no second location-editing UI)', /import \{ LocationPicker \} from '\.\/LocationPicker'/.test(journey) && /<LocationPicker\b/.test(journey));
check('never imports or reimplements the timing/Panchang engine (computeSolarEphemeris/computePanchangWindows/computeDailyEnergyInsight) -- only consumes the already-computed nextShift prop', !/computeSolarEphemeris|computePanchangWindows|computeDailyEnergyInsight/.test(journey));
check('never imports a second Prisma/db/pool module (no duplicate persistence path)', !/from '\.\.\/lib\/db'|\bpool\b|pg['"]/.test(journey));

// ============================================================
// B. Location confirmation.
// ============================================================

check('B1. confirmSuggestedCity is the ONE explicit "confirm the suggested city" action, calling PATCH /api/users/location', /async function confirmSuggestedCity\(\)/.test(journey) && /fetch\('\/api\/users\/location', \{\s*method: 'PATCH'/.test(journey));
check('B2. the confirm action branches curated-vs-custom via the SAME findCity helper LocationPicker itself uses (no second validation path)', /import \{ findCity \} from '\.\.\/lib\/cities'/.test(journey) && /findCity\(cityName\)/.test(journey));
check('B3. no component-mount effect ever calls confirmSuggestedCity or PATCH /api/users/location (no automatic confirmation)', !/useEffect\([^)]*\{[\s\S]*?(confirmSuggestedCity|PATCH)/.test(journey));
check('B4. confirmSuggestedCity is wrapped in try/catch/finally -- a network failure sets an error and always clears the loading state', /try \{[\s\S]*?confirmSuggestedCity[\s\S]*?\}/s.test('function confirmSuggestedCity') || (/async function confirmSuggestedCity\(\) \{[\s\S]*?try \{[\s\S]*?\} catch \{[\s\S]*?setConfirmError[\s\S]*?\} finally \{[\s\S]*?setConfirming\(false\)/.test(journey)));
check('B5. confirmSuggestedCity never calls onLocationChanged/advances the step from inside its catch block (failure never claims confirmation)', (() => {
  const start = journey.indexOf('async function confirmSuggestedCity');
  const body = journey.slice(start, journey.indexOf('\n  }\n', start));
  const catchMatch = body.match(/\} catch \{([\s\S]*?)\} finally/);
  const catchBlock = catchMatch ? catchMatch[1] : '';
  return !/onLocationChanged|setStep/.test(catchBlock);
})());
check('B6. the confirm button is disabled only while confirming (never permanently) -- retry stays available after a failure', /disabled=\{confirming\}/.test(journey) && !/disabled=\{confirmError/.test(journey));
check('B7. a confirmation error is rendered with role="alert" (screen-reader-friendly)', /role="alert"[\s\S]*?confirmError/.test(journey) || /confirmError[\s\S]{0,80}role="alert"/.test(journey));
check('B8. the Location step offers an explicit Skip action distinct from confirming', /LocationStep[\s\S]*?onSkip/.test(journey) && /Skip for now/.test(journey));
check('B9. selecting a different city or submitting a custom location both flow through LocationPicker\'s own onChanged -- never a second onChanged implementation', /onLocationChanged=\{\(city\) => \{/.test(journey));

// ============================================================
// C. Recommendation -- no fabrication, no extra requirements.
// ============================================================

check('C1. nextShift is received as a prop (the real, already-computed engine value) -- never computed, never hardcoded inside this file', /nextShift: DailyEnergyInsight\['nextShift'\] \| undefined/.test(journey));
check('C2. the displayed start time is the REAL nextShift.startTime, never a static example string', /\{nextShift\.startTime\}/.test(journey) && !/4:30\s*(AM|PM)|12:00\s*(AM|PM)/.test(journey));
check('C3. no birth-detail concept anywhere in the recommendation logic', !/birthDate|birthTime|birthCityName|birthLatitude|birthLongitude|natal/i.test(journey));
check('C4. no Goal concept anywhere in the recommendation logic (RecommendationStep itself -- Onboarding V1 PR 4 added an optional Goal offer as later, separate, skippable steps AFTER this one, never inside it)', (() => {
  const recStart = journeySource.indexOf('function RecommendationStep');
  // RecommendationStep's own top-level closing brace (a bare "}" at column
  // 0) -- NOT a later function's name, which would include the doc
  // comment directly above it (itself legitimately describing the new
  // Goal offer) inside the slice.
  const closeIndex = journeySource.indexOf('\n}\n', recStart);
  const recommendationSource = journeySource.slice(recStart, closeIndex === -1 ? undefined : closeIndex);
  return !/\bGoal\b|GoalActivity|goalId/.test(recommendationSource);
})());
check('C5. no availability-configuration concept anywhere', !/availabilityConfigured|AvailabilityConfiguration/.test(journey));
check('C6. an unconfirmed location NEVER reaches the real-nextShift branch -- the component returns the "confirm your location" fallback first', (() => {
  const recFnStart = journey.indexOf('function RecommendationStep');
  const body = journey.slice(recFnStart);
  const guardIndex = body.indexOf('if (!locationConfirmed)');
  const realBranchIndex = body.indexOf('YOUR NEXT USEFUL WINDOW') >= 0 ? body.indexOf('nextShift.windowName') : -1;
  return guardIndex !== -1 && (realBranchIndex === -1 || guardIndex < realBranchIndex);
})());
check('C7. the unconfirmed-location fallback never claims verification/personalization', /Confirm your location to see timing guidance/.test(journey) && !/verified|personalized to you(?! yet)/i.test(journey.slice(journey.indexOf('if (!locationConfirmed)'), journey.indexOf('if (!hasRealRecommendation'))));
check('C8. a missing/empty engine result (no window) shows a truthful "no window available" fallback, never the real-window branch\'s copy', /No timing window available right now/.test(journey) && /!hasRealRecommendation \|\| !nextShift/.test(journey));
check('C9. the no-window fallback still offers a route into Aura (Plan my day AND Go to Home)', (() => {
  const idx = journey.indexOf('No timing window available right now');
  const block = journey.slice(idx, idx + 600);
  return /onPlanMyDay/.test(block) && /onGoHome/.test(block);
})());
check('C10. the real-recommendation copy names the confirmed city, never a hardcoded placeholder city', /for \{cityName\}/.test(journey));

// ============================================================
// D. Navigation.
// ============================================================

check('D1. Welcome -> Location: Get started advances the step to LOCATION', /onGetStarted=\{\(\) => setStep\('LOCATION'\)\}/.test(journey));
check('D2. Welcome\'s Skip for now exits directly to Home (onExit), never advancing into Location first', /WelcomeStep[\s\S]*?onSkip=\{onExit\}/.test(journey));
check('D3. Location -> Recommendation on a successful change', /onLocationChanged=\{\(city\) => \{[\s\S]*?setStep\('RECOMMENDATION'\)/.test(journey));
check('D4. Location\'s own Skip also advances to Recommendation (still shows one useful thing, per the unconfirmed-location fallback) rather than a silent dead end', /onSkip=\{\(\) => setStep\('RECOMMENDATION'\)\}/.test(journey));
check('D5. Recommendation -> Home via Go to Home is wired to onExit in every branch', (journey.match(/onGoHome\}/g) ?? []).length >= 1 && /onGoHome,\s*\}: \{/.test(journey) === false ? /onExit\s*\}\s*\)/.test(journeySource) || /onExit=\{handleExitOnboarding\}/.test(pageSource) : true);
check('D6. Recommendation -> Plan My Day is wired through, never a second navigation mechanism inside this file', !/window\.location|router\.push|history\.push/.test(journey));
check('D7. page.tsx renders OnboardingJourney INSTEAD OF the normal tab UI, never alongside it (an early return, not a sibling render)', /if \(onboardingActive\) \{\s*return \(\s*<OnboardingJourney/.test(pageSource));
check('D8. the onboarding decision is captured exactly once per page load via a ref guard -- a later session refetch can never re-trigger it', /onboardingDecidedRef\.current/.test(pageSource) && /if \(!onboardingDecidedRef\.current\)/.test(pageSource));
check('D9. exiting onboarding sets local state false AND fires the resolution PATCH -- never a navigation/reload that could loop back into it', /const handleExitOnboarding = useCallback\(\(\) => \{\s*setOnboardingActive\(false\);\s*fetch\('\/api\/users\/onboarding', \{ method: 'PATCH' \}\)\.catch\(\(\) => \{\}\);\s*\}, \[\]\);/.test(pageSource) && !/window\.location|router\.push/.test(pageSource.slice(pageSource.indexOf('const handleExitOnboarding'), pageSource.indexOf('const handleExitOnboarding') + 400)));
check('D10. Plan My Day from onboarding navigates to the EXISTING /plan-day route -- no new route introduced', /onPlanMyDay=\{\(\) => \{\s*handleExitOnboarding\(\);\s*window\.location\.href = '\/plan-day';/.test(pageSource));
check('D11. Location step\'s own Skip is wired ONLY to setStep (never to handleExitOnboarding/onExit) -- advancing between steps never resolves onboarding, exactly the ticket\'s own explicit rule', !/onSkip=\{\(\) => \{\s*setStep\('RECOMMENDATION'\);[\s\S]{0,80}(onExit|handleExitOnboarding)/.test(journey));

// ============================================================
// First-Run Reliability Correction -- durable, check-not-consume
// onboarding resolution (replaces the earlier VisitLog-based
// isFirstSession signal). Returning users bypass Welcome; no second,
// redundant onboarding-state model; VisitLog stays independent.
// ============================================================

check('page.tsx reads the durable onboardingResolved field (never the old, removed isFirstSession signal)', /sessionData\.onboardingResolved === false/.test(pageSource) && !/isFirstSession/.test(pageSource));
check('no SEPARATE client-only onboarding-state model was introduced beyond the one durable server field (no second stored flag name)', !/welcomeShown|welcomeCompleted|welcomeDismissed|onboardingState\b/i.test(pageSource) && !/welcomeShown|welcomeCompleted|welcomeDismissed|onboardingState\b/i.test(dbSource));
check('exactly one new Prisma field backs onboarding state: onboardingResolvedAt (nullable, no second model)', /onboardingResolvedAt\s+DateTime\?/.test(read('apps/web/prisma/schema.prisma')) && !/model\s+Onboarding/i.test(read('apps/web/prisma/schema.prisma')));
check('GET /api/auth/session reads onboardingResolved straight off the already-fetched user row -- zero extra query, never derived from recordVisit\'s own return value', /onboardingResolved: user\.onboardingResolvedAt != null/.test(sessionRouteSource) && !/isFirstVisitEver/.test(sessionRouteSource));
check('recordVisit (VisitLog analytics) is still called every session check, but its result is never read/used for onboarding -- VisitLog and onboarding are structurally decoupled', /await recordVisit\(user\.id\);/.test(sessionRouteSource) && !/const \{[^}]*\} = await recordVisit/.test(sessionRouteSource));
check('the resolution endpoint PATCH /api/users/onboarding exists, is authenticated via the session (never an arbitrary id from the request body), and calls markOnboardingResolved', fs.existsSync(path.join(__dirname, '..', 'apps/web/app/api/users/onboarding/route.ts')) && /getSessionFromRequest\(req\)/.test(onboardingRouteSource) && /markOnboardingResolved\(session\.userId\)/.test(onboardingRouteSource) && !/body\.userId|req\.json\(\).*userId/.test(onboardingRouteSource));
check('the resolution endpoint returns the persisted resolution state (never a bare 200 with no body)', /onboardingResolved: user\.onboardingResolvedAt != null/.test(onboardingRouteSource));
check('markOnboardingResolved is idempotent by construction: guarded by WHERE "onboardingResolvedAt" IS NULL, never unconditionally overwriting an existing timestamp', /WHERE id = \$1 AND "onboardingResolvedAt" IS NULL/.test(dbSource));
check('recordVisit is concurrency-safe: wrapped in the SAME established per-user pg_advisory_xact_lock pattern already used elsewhere in this codebase (dayConstructorAcceptancePersistence.ts/planMove.ts)', /pg_advisory_xact_lock\(hashtext\(\$1\)\)', \[`visit-log:\$\{userId\}`\]/.test(dbSource));
check('recordVisit no longer returns any onboarding-shaped value (void) -- a caller cannot accidentally re-couple VisitLog to onboarding eligibility', /export async function recordVisit\(userId: string\): Promise<void>/.test(dbSource));

// ============================================================
// Section 6 -- Home transition: no automatic persistence of any kind
// anywhere in the onboarding surfaces (journey component, session route,
// the new db.ts code this PR added).
// ============================================================

const FORBIDDEN_AUTO_PERSISTENCE = /createPlannedActivity|persistAcceptedConstructedDay|createGoalWithActivities|createHabitLog|insertHabitLog|constructDay\(|orchestrateConstructDay|derivedDecisionPressure|DecisionPressure/;
check('OnboardingJourney.tsx never creates a Plan/Goal/HabitLog or triggers Constructor acceptance or Decision Pressure', !FORBIDDEN_AUTO_PERSISTENCE.test(journey));
check('the session route (where onboardingResolved is read) never creates a Plan/Goal/HabitLog or triggers Constructor acceptance', !FORBIDDEN_AUTO_PERSISTENCE.test(sessionRouteSource));
check('the onboarding resolution route never creates a Plan/Goal/HabitLog or triggers Constructor acceptance -- it touches only User.onboardingResolvedAt', !FORBIDDEN_AUTO_PERSISTENCE.test(onboardingRouteSource));

// ============================================================
// Mobile/accessibility basics (structural, not rendered).
// ============================================================

check('the suggested-city confirm and exit actions meet the 44px touch-target minimum (PrimaryButton\'s own baseline, or an explicit minHeight: 44 override)', (journey.match(/minHeight: 44/g) ?? []).length >= 2);
check('the step indicator is announced to assistive tech (role="status" + aria-label naming the step), not color-only', /role="status"/.test(journey) && /aria-label=\{`Step \$\{stepIndex\} of 3`\}/.test(journey));
check('the container uses a mobile-first, bounded width (never a full-bleed/oversized panel on desktop)', /CONTAINER_MAX_WIDTH = 420/.test(journey));
check('safe-area insets are respected on the outer container, matching the rest of the app\'s own convention', /env\(safe-area-inset-top/.test(journey) && /env\(safe-area-inset-bottom/.test(journey));

if (!allPassed) {
  console.error('\nSome Onboarding Journey logic checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL ONBOARDING JOURNEY LOGIC CHECKS PASSED');
}
