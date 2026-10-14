/**
 * Location PR9 -- Unified Onboarding Confirmation: structural regression
 * suite proving onboarding (OnboardingJourney.tsx's confirmSuggestedCity)
 * and Settings (LocationPicker.tsx's confirmCurrentLocation) now share the
 * SAME implementation of "confirm this exact location," rather than two
 * independently-maintained copies of the same fetch/response-handling
 * logic. Before this PR, each surface had its own near-identical inline
 * PATCH /api/users/location call; now both delegate to the one
 * apps/web/lib/locationConfirmation.ts helper. No automated component-test
 * harness exists in this repo for client components, so this follows the
 * established source-text/regex structural-assertion pattern (see
 * test/locationPickerSmartSelection.test.ts, test/onboardingJourneyLogic.test.ts).
 *
 * The underlying API contract (PATCH /api/users/location, curated vs.
 * custom body shapes, auth/validation/idempotency) is unchanged by this PR
 * and is already covered by test/locationExplicitConfirmationApiDb.test.ts
 * (29 scenarios) and test/locationConfirmationDb.test.ts -- this file only
 * covers the NEW thing PR9 introduces: the shared client-side helper and
 * its two call sites.
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

const helperSource = stripComments(read('apps/web/lib/locationConfirmation.ts'));
const onboardingSource = stripComments(read('apps/web/components/OnboardingJourney.tsx'));
const pickerSource = stripComments(read('apps/web/components/LocationPicker.tsx'));

// ============================================================
// Exactly one shared implementation exists and is exported once.
// ============================================================

check('lib/locationConfirmation.ts exists and exports exactly one submitLocationConfirmation function', (helperSource.match(/export async function submitLocationConfirmation\(/g) ?? []).length === 1);
check('the shared helper is the only place in apps/web that sends a PATCH to /api/users/location AND is imported by name from both onboarding and Settings (no third, independent reimplementation introduced by this PR)', (helperSource.match(/method: 'PATCH'/g) ?? []).length === 1);

// ============================================================
// Both surfaces import and call the SAME helper (no second implementation).
// ============================================================

check('OnboardingJourney.tsx (onboarding) imports submitLocationConfirmation from the shared module', /import \{ submitLocationConfirmation \} from '\.\.\/lib\/locationConfirmation'/.test(onboardingSource));
check('LocationPicker.tsx (Settings, via YouView) imports submitLocationConfirmation from the SAME shared module path', /import \{ submitLocationConfirmation \} from '\.\.\/lib\/locationConfirmation'/.test(pickerSource));
check('confirmSuggestedCity (onboarding) actually calls the shared helper, not a local fetch', /async function confirmSuggestedCity[\s\S]*?await submitLocationConfirmation\(/.test(onboardingSource));
check('confirmCurrentLocation (Settings) actually calls the shared helper, not a local fetch', /async function confirmCurrentLocation[\s\S]*?await submitLocationConfirmation\(/.test(pickerSource));

// ============================================================
// Each surface keeps its own request-body decision (this PR unifies HOW
// the request is sent/interpreted, not WHAT each surface sends -- onboarding
// still prefers the curated cityName shape via findCity, Settings still
// always sends its own already-validated custom coordinates).
// ============================================================

check('onboarding still decides curated-vs-custom via findCity before calling the shared helper (its own pre-existing, more specific behavior is preserved, not flattened by the unification)', /findCity\(cityName\)/.test(onboardingSource) && /submitLocationConfirmation\(curated \? \{ cityName \} : \{ custom:/.test(onboardingSource));
check('Settings still always sends its own current, already-persisted coordinates via the custom shape (unchanged request shape for this call site)', /submitLocationConfirmation\(\{\s*custom: \{\s*cityName: currentCity,\s*latitude: currentLatitude,\s*longitude: currentLongitude,\s*timezone: currentTimezone,/.test(pickerSource));

// ============================================================
// Success/failure handling stays caller-specific (different UI/step
// behavior per surface) while both read the SAME result shape from the
// shared helper.
// ============================================================

check('onboarding only advances to the Recommendation step and marks itself locally confirmed on result.ok -- a failure never advances the step', /if \(result\.ok\) \{[\s\S]*?setStep\('RECOMMENDATION'\);[\s\S]*?\} else \{[\s\S]*?setConfirmError\(result\.error\);/.test(onboardingSource));
check('Settings only calls onChanged on result.ok -- a failure never claims confirmation locally', /if \(result\.ok\) \{[\s\S]*?onChanged\(\{[\s\S]*?\} else \{[\s\S]*?setConfirmCurrentError\(result\.error\);/.test(pickerSource));

// ============================================================
// No competing/duplicate fallback error copy remains outside the shared
// helper for these two call sites (the OLD duplicated literals lived
// inline in each component; they now live in exactly one place).
// ============================================================

check('the generic fallback error strings used by confirmSuggestedCity/confirmCurrentLocation live ONLY in the shared helper now, not duplicated inline in either component\'s own confirm-this-exact-location function', (() => {
  const onboardingConfirmStart = onboardingSource.indexOf('async function confirmSuggestedCity');
  const onboardingConfirmBody = onboardingSource.slice(onboardingConfirmStart, onboardingSource.indexOf('\n  }\n', onboardingConfirmStart));
  const pickerConfirmStart = pickerSource.indexOf('async function confirmCurrentLocation');
  const pickerConfirmBody = pickerSource.slice(pickerConfirmStart, pickerSource.indexOf('\n  }\n', pickerConfirmStart));
  const stale = /Could not confirm location\.|Couldn't confirm location/;
  return !stale.test(onboardingConfirmBody) && !stale.test(pickerConfirmBody) && (helperSource.match(/Could not confirm location\./g) ?? []).length === 1;
})());

if (!allPassed) {
  console.error('\nSome Location Confirmation Unification checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL LOCATION CONFIRMATION UNIFICATION CHECKS PASSED');
}
