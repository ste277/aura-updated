/**
 * Onboarding V1 PR 1 -- Location Trust Foundation: regression suite for
 * the disclosure surfaces themselves (LocationTrustBanner.tsx, plus the
 * three targeted qualifiers in PlanDayClient.tsx, MuhurthamFinderView.tsx,
 * YouView.tsx) and their wiring in page.tsx. No component-test harness
 * exists in this repo for client components, so this follows the
 * established source-text/regex structural-assertion pattern (see
 * test/locationSaveFailureState.test.ts, test/timingLocationRefresh.test.ts).
 *
 * Covers the 5 scenarios the PR 1 ticket's own test list requires:
 *   1. Unconfirmed disclosure visible
 *   2. Confirmed disclosure absent
 *   3. Confirmation action accessible
 *   4. No blocked Home access
 *   5. No false personalization copy
 */
import * as fs from 'fs';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const bannerSource = fs.readFileSync('apps/web/components/LocationTrustBanner.tsx', 'utf8');
const pageSource = fs.readFileSync('apps/web/app/page.tsx', 'utf8');
const youViewSource = fs.readFileSync('apps/web/components/YouView.tsx', 'utf8');
const planDayClientSource = fs.readFileSync('apps/web/app/plan-day/PlanDayClient.tsx', 'utf8');
const muhurthamSource = fs.readFileSync('apps/web/components/MuhurthamFinderView.tsx', 'utf8');

// ============================================================
// 1/2. LocationTrustBanner: renders its disclosure content when
// unconfirmed, renders NOTHING when confirmed. The early-return guard
// must appear BEFORE the JSX that renders the disclosure copy, so a
// confirmed user structurally can never see it.
// ============================================================

const earlyReturnMatch = bannerSource.match(/if \(locationConfirmed\) return null;/);
check('1a. LocationTrustBanner has an early "if (locationConfirmed) return null" guard', earlyReturnMatch !== null);

const earlyReturnIndex = earlyReturnMatch?.index ?? -1;
const disclosureTextIndex = bannerSource.indexOf('Showing times for');
const confirmCopyIndex = bannerSource.indexOf('Confirm your location for accurate guidance.');
check('1b. the disclosure copy ("Showing times for...") is present', disclosureTextIndex !== -1);
check('1c. the disclosure copy appears AFTER the early-return guard (unreachable when confirmed)', earlyReturnIndex !== -1 && disclosureTextIndex > earlyReturnIndex);
check(
  '2. the "Confirm your location" prompt also appears after the guard (the full disclosure is gone, not partially hidden, when confirmed)',
  earlyReturnIndex !== -1 && confirmCopyIndex > earlyReturnIndex
);

// ============================================================
// 3. Confirmation action is accessible: a real, enabled button wired to
// the onConfirmLocation callback, which page.tsx wires to a handler that
// actually navigates to the editable Location & Time panel (not a dead
// end, not disabled).
// ============================================================

check('3a. LocationTrustBanner renders a PrimaryButton wired to onConfirmLocation', /<PrimaryButton onClick=\{onConfirmLocation\}>/.test(bannerSource));
check('3b. the confirm button is never disabled/conditionally hidden inside the banner', !/disabled/.test(bannerSource));
check('3c. page.tsx wires LocationTrustBanner\'s onConfirmLocation to handleConfirmLocationFromBanner', /onConfirmLocation=\{handleConfirmLocationFromBanner\}/.test(pageSource));
check(
  '3d. handleConfirmLocationFromBanner actually navigates to the You tab\'s Location & Time panel (not a no-op)',
  /const handleConfirmLocationFromBanner = useCallback\(\(\) => \{\s*setYouInitialPanel\('location'\);\s*setActiveTab\('you'\);/.test(pageSource)
);
check(
  '3e. YouView seeds its expanded settings panel from initialOpenPanel (the banner\'s action lands directly on the editable row, not a collapsed list)',
  /useState<[\s\S]*?>\(initialOpenPanel \?\? null\)/.test(youViewSource)
);

// ============================================================
// 4. No blocked Home access: the banner is rendered ALONGSIDE tab
// content (a sibling), never gating it -- Home (and every other tab)
// must render unconditionally regardless of locationConfirmed.
// ============================================================

check(
  '4a. the banner render site is unconditional on locationConfirmed (LocationTrustBanner itself decides visibility, page.tsx never gates its own render on the value)',
  !/\{user\.locationConfirmedAt[\s\S]{0,40}&&[\s\S]{0,40}<LocationTrustBanner/.test(pageSource)
);
check(
  '4b. the Home tab\'s own render condition never references locationConfirmedAt (Home is never blocked by it)',
  !/activeTab === 'home'[\s\S]{0,80}locationConfirmedAt/.test(pageSource)
);
check(
  '4c. there is no early return anywhere in page.tsx gated on an unconfirmed location (e.g. "if (!user.locationConfirmedAt) return")',
  !/if \(!user\.locationConfirmedAt\)/.test(pageSource)
);

// ============================================================
// 5. No false personalization copy: nowhere does an unconfirmed
// location get described as verified/confirmed. The three targeted
// qualifiers (Plan My Day, Muhurtham Finder, Settings/You) each only
// ever ADD an "(unconfirmed)" / "Not yet confirmed" marker -- they never
// remove or contradict it, and the banner's own copy never claims
// verification.
// ============================================================

// Scoped to the JSX return block only (not the file's own doc comments,
// which explicitly discuss the never-imply-verified invariant in prose).
const bannerJsx = bannerSource.slice(bannerSource.indexOf('return ('));
check('5a. LocationTrustBanner\'s rendered copy never claims the location has been verified/confirmed', !/\bverified\b/i.test(bannerJsx) && !/is confirmed/i.test(bannerJsx));

check('5b. PlanDayClient\'s qualifier only renders when locationConfirmed === false', /\{locationConfirmed === false && cityName && \(/.test(planDayClientSource));
check('5c. PlanDayClient\'s qualifier copy explicitly marks the location "(unconfirmed)"', /Timing based on \{cityName\} \(unconfirmed\)/.test(planDayClientSource));

check('5d. MuhurthamFinderView\'s qualifier only appends "(unconfirmed)" when locationConfirmed === false', /\{locationConfirmed === false \? ' \(unconfirmed\)' : ''\}/.test(muhurthamSource));
check(
  '5e. MuhurthamFinderView\'s existing "Using your Timing Location" copy is unchanged (the qualifier only appends, never replaces it)',
  /Using your Timing Location: \{timingLocation\.cityName\}/.test(muhurthamSource)
);

check(
  '5f. YouView\'s Location & Time row appends "Not yet confirmed" only in the unconfirmed branch, and omits it entirely once confirmed (no stale/contradictory copy)',
  /locationConfirmed \? `\$\{cityName\} · \$\{timezone\}` : `\$\{cityName\} · \$\{timezone\} · Not yet confirmed`/.test(youViewSource)
);

if (!allPassed) {
  console.error('\nSome Location Trust Disclosure UI checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL LOCATION TRUST DISCLOSURE UI CHECKS PASSED');
}
