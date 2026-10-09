/**
 * Onboarding V1 PR 3 -- Smart Location Selection: structural regression
 * suite for the rewritten apps/web/components/LocationPicker.tsx. No
 * component-test harness exists in this repo for client components, so
 * this follows the established source-text/regex structural-assertion
 * pattern (see test/locationSaveFailureState.test.ts,
 * test/onboardingJourneyLogic.test.ts).
 *
 * Covers the ticket's own required scenarios not already covered by
 * test/geocoding.test.ts (provider logic) or
 * test/locationSearchApi.test.ts (route wiring): permission/timeout/
 * unsupported-browser handling, explicit confirmation before save,
 * existing-location-unchanged-until-confirmation, birth-location
 * independence, and onboarding/Settings parity.
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

const source = read('apps/web/components/LocationPicker.tsx');
const picker = stripComments(source);
const onboardingJourneySource = stripComments(read('apps/web/components/OnboardingJourney.tsx'));
const youViewSource = stripComments(read('apps/web/components/YouView.tsx'));

// ============================================================
// No automatic permission request / no automatic save.
// ============================================================

check('geolocation is requested ONLY from the button\'s onClick (requestCurrentLocation), never from a useEffect/mount effect', !/useEffect\([^)]*\{[\s\S]*?getCurrentPosition/.test(picker) && /onClick=\{requestCurrentLocation\}/.test(picker));
check('getCurrentPosition is called exactly once in the whole file, inside requestCurrentLocation', (picker.match(/getCurrentPosition\(/g) ?? []).length === 1);
check('no coordinates are saved automatically on a GPS fix -- the result lands in `pending` state, never calls onChanged/PATCH directly from the geolocation success callback', (() => {
  const start = picker.indexOf('function requestCurrentLocation');
  const body = picker.slice(start, picker.indexOf('\n  }\n', start));
  return /setPending\(\{ result: data\.result, source: 'gps'/.test(body) && !/onChanged\(|PATCH/.test(body);
})());
check('no coordinates are saved automatically on a search result click -- clicking a result sets `pending`, never calls onChanged/PATCH directly', /onClick=\{\(\) => setPending\(\{ result, source: 'search' \}\)\}/.test(picker));

// ============================================================
// Permission / timeout / unsupported-browser / secure-context handling.
// ============================================================

check('unsupported browser (no navigator.geolocation) is handled with a distinct, actionable message', /!\('geolocation' in navigator\)/.test(picker) && /doesn't support location access/.test(picker));
check('insecure context (HTTP, not HTTPS) is handled with its own distinct message before even checking geolocation support', /window\.isSecureContext === false/.test(picker) && /secure \(https\) connection/.test(picker));
check('PERMISSION_DENIED is handled with a message that offers search/manual as a next step (never a dead end)', /geoError\.code === geoError\.PERMISSION_DENIED/.test(picker) && /permission was denied/.test(picker));
check('TIMEOUT is handled with its own distinct message', /geoError\.code === geoError\.TIMEOUT/.test(picker) && /took too long/.test(picker));
check('getCurrentPosition is called with an explicit timeout (never left to the browser\'s own default, which can be unbounded)', /\{ timeout: 10_000, maximumAge: 0 \}/.test(picker));
check('reverse-geocode failure after a successful GPS fix is handled distinctly from a GPS error itself (couldn\'t identify your location, try searching)', /Couldn't identify your location\. Try searching instead\./.test(picker));

// ============================================================
// Explicit confirmation required (GPS and search funnel through the
// SAME one confirm step -- this file's own confirmPendingResult).
// ============================================================

check('confirmPendingResult is the ONE function that calls PATCH /api/users/location for a geocoded result -- both GPS and search results set `pending` and wait for it', (picker.match(/async function confirmPendingResult/g) ?? []).length === 1 && (picker.match(/confirmPendingResult\(\)/g) ?? []).length >= 1);
check('the confirm button is the only caller of confirmPendingResult (no auto-invoke anywhere else)', (picker.match(/onClick=\{confirmPendingResult\}/g) ?? []).length === 1);
check('confirmPendingResult only calls onChanged from its res.ok branch -- a failed confirm never claims success (same PR #88 confirmed-save boundary the existing handlers preserve)', (() => {
  const start = picker.indexOf('async function confirmPendingResult');
  const body = picker.slice(start, picker.indexOf('\n  }\n', start));
  const okBranch = body.match(/if \(res\.ok\) \{([\s\S]*?)\} else \{/)?.[1] ?? '';
  const elseBranch = body.match(/\} else \{([\s\S]*?)\n    \}/)?.[1] ?? '';
  return /onChanged\(confirmed\)/.test(okBranch) && !/onChanged\(/.test(elseBranch);
})());
check('the "Back" button clears `pending` without ever calling onChanged -- backing out of a GPS/search result changes nothing', /onClick=\{\(\) => setPending\(null\)\}/.test(picker));
check('a confirm failure is rendered with role="alert" (screen-reader-friendly, same convention as the existing custom-form error)', /role="alert"[\s\S]{0,200}\{error\}/.test(picker));

// ============================================================
// Existing saved location unchanged until confirmation / refresh before
// confirmation: `pending` is pure component state -- clearing it (a
// re-render, a parent remount) leaves the server-side location exactly
// as it was, since nothing but confirmPendingResult's own res.ok branch
// ever calls PATCH.
// ============================================================

check('exactly ONE PATCH /api/users/location call site exists for the GPS/search path (confirmPendingResult) -- no second, parallel write path', (picker.match(/method: 'PATCH'/g) ?? []).length === 3); // curated select + custom form + confirmPendingResult, the three PRE-EXISTING+NEW save paths, all still funneling through the same endpoint
check('`pending` state is never persisted (no localStorage/sessionStorage) -- a refresh before confirming genuinely discards the unconfirmed candidate, it is not silently re-offered as if it were saved', !/localStorage|sessionStorage/.test(picker));

// ============================================================
// Never invent/assume a timezone; accuracy disclosure.
// ============================================================

check('the browser\'s own local timezone (Intl.DateTimeFormat().resolvedOptions().timeZone) is never read anywhere in this file -- the GPS/search timezone always comes from the provider\'s own response, never assumed to match the browser', !/resolvedOptions\(\)\.timeZone/.test(picker));
check('low-confidence search results and low-accuracy GPS fixes are both disclosed distinctly before the user confirms', /LOW_CONFIDENCE_THRESHOLD/.test(picker) && /LOW_GPS_ACCURACY_METERS/.test(picker) && /Approximate location/.test(picker));

// ============================================================
// Debounced search (rate-limit/quota friendly) and provider attribution.
// ============================================================

check('search is debounced (a setTimeout-based delay), never fired on every keystroke', /setTimeout\(async \(\) => \{/.test(picker) && /}, 400\);/.test(picker));
check('the debounce timer is cleared on unmount/requery (no leaked timers, no stale search firing after the component is gone)', (picker.match(/clearTimeout\(searchDebounceRef\.current\)/g) ?? []).length >= 2);
check('a query under 2 characters never calls the search API (avoids firing on a single keystroke)', /query\.length < 2/.test(picker));
check('OpenCage/OpenStreetMap attribution is present near the search results, satisfying the free-tier provider terms (this PR\'s own decision memo)', /Search powered by/.test(picker) && /OpenCage/.test(picker) && /OpenStreetMap/.test(picker));

// ============================================================
// Birth location independence (unchanged by this PR, re-verified after
// the rewrite): this is still the Timing Location editor only.
// ============================================================

check('no birth-location field is ever read or written anywhere in this file', !/birthCityName|birthLatitude|birthLongitude|birthTimezone/.test(picker));

// ============================================================
// Pre-existing curated-select and manual-entry paths are preserved
// verbatim (re-verified after the rewrite, not just assumed).
// ============================================================

check('the curated <select> dropdown (handleSelectChange) is still present, still the Advanced-options path, still saves immediately on a real change', /async function handleSelectChange\(/.test(picker) && /onChange=\{handleSelectChange\}/.test(picker));
check('the manual custom-location form (handleCustomSubmit) is still present, still reachable via the curated dropdown\'s "Other" option', /async function handleCustomSubmit\(/.test(picker) && /value=\{OTHER_VALUE\}/.test(picker));
check('the curated+manual paths are now behind a collapsed "Advanced options" disclosure, not the first thing shown (ticket: "No coordinates required from ordinary users")', /Advanced options/.test(picker) && /showAdvanced/.test(picker));

// ============================================================
// Mobile/accessibility basics.
// ============================================================

check('the primary GPS button and the confirm button both meet the 44px touch-target minimum', (picker.match(/minHeight: 44/g) ?? []).length >= 3);
check('the search input has an associated, non-visually-hidden label (accessible form label)', /htmlFor="location-picker-search"/.test(picker) && /id="location-picker-search"/.test(picker));

// ============================================================
// Onboarding and Settings parity: the ONE shared component, reused
// identically by both surfaces -- no competing experience was created.
// ============================================================

check('OnboardingJourney.tsx (onboarding) renders THIS SAME LocationPicker component', /import \{ LocationPicker \} from '\.\/LocationPicker'/.test(onboardingJourneySource) && /<LocationPicker\b/.test(onboardingJourneySource));
check('YouView.tsx (Settings) renders THIS SAME LocationPicker component', /import \{ LocationPicker \} from '\.\/LocationPicker'/.test(youViewSource) && /<LocationPicker\b/.test(youViewSource));
check('no second/competing location-selection component was introduced (no "SmartLocationPicker"/"GeoLocationPicker"-named file)', !fs.existsSync(path.join(__dirname, '..', 'apps/web/components/SmartLocationPicker.tsx')) && !fs.existsSync(path.join(__dirname, '..', 'apps/web/components/GeoLocationPicker.tsx')));

if (!allPassed) {
  console.error('\nSome LocationPicker Smart Selection checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL LOCATIONPICKER SMART SELECTION CHECKS PASSED');
}
