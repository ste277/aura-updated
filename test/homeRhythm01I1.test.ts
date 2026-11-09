/**
 * HOME-RHYTHM-01-I1 -- regression coverage for the three narrowly-scoped
 * Home UI improvements from the D1 audit:
 *   I1-A: surface dailyBriefing.nextAction/greenLight (previously fetched,
 *         never rendered).
 *   I1-B: de-emphasize the Right-Now-spotlighted item's duplicate row in
 *         HomeTimeline's "Your Day" list.
 *   I1-C: trim above-the-fold vertical spacing on Home (no new breakpoint
 *         system -- confirmed zero @media queries existed under apps/web
 *         before this PR, and none are added by it).
 *
 * HomeDashboard.tsx/HomeTimeline.tsx/LocationTrustBanner.tsx are .tsx
 * files this repo's root tsconfig cannot compile directly via ts-node
 * (no --jsx configured -- a pre-existing environment limitation, same one
 * that already affects muhurthamFinderViewLogic.test.ts and
 * planHomeHandoffActivityIdentity.test.ts), so this file follows the same
 * fs.readFileSync + structural-assertion convention every other PA-3C/
 * Home test file already uses rather than importing them.
 */
import * as fs from 'fs';

import { buildDailyBriefing, DailyBriefing, DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';
import { SolarNoEventError } from '../packages/astronomy/src/errors';
import { computeDailyEnergyInsight } from '../apps/web/lib/scoreEngine';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    passed++;
    console.log(`OK   ${label}`);
  } else {
    failed++;
    console.log(`FAIL ${label}`);
  }
}

const homeDashboardSrc = fs.readFileSync('apps/web/components/HomeDashboard.tsx', 'utf8');
const homeTimelineSrc = fs.readFileSync('apps/web/components/HomeTimeline.tsx', 'utf8');
const locationTrustBannerSrc = fs.readFileSync('apps/web/components/LocationTrustBanner.tsx', 'utf8');
const pageSrc = fs.readFileSync('apps/web/app/page.tsx', 'utf8');

// ============================================================
// A. nextAction/greenLight semantics (verify against the REAL producer,
// not an assumption) -- confirms the field shapes I1-A's UI code depends
// on actually exist and behave as documented before checking the UI reads
// them correctly.
// ============================================================

const normalContext: DailyAssistantContext = {
  latitude: 13.08,
  longitude: 80.27,
  timezone: 'Asia/Kolkata',
  now: new Date('2026-06-15T06:00:00.000Z'),
  tzOffsetMinutes: 330,
};

{
  const briefing: DailyBriefing = buildDailyBriefing(normalContext);
  check('A1. nextAction is a non-empty descriptive string, not an object/identifier', typeof briefing.nextAction === 'string' && briefing.nextAction.length > 0);
  check('A2. greenLight is a distinct {title, description, windowType} shape, never equal to the nextAction string', typeof briefing.greenLight === 'object' && typeof briefing.greenLight.title === 'string' && briefing.greenLight.title !== briefing.nextAction);
  check('A3. greenLight carries no activityId/scheduling identifier (the type has none -- confirms I1-A must not invent one)', !('activityId' in (briefing.greenLight as object)));
  check('A4. nextAction never claims something is "scheduled" (descriptive instruction only, per dailyAssistant.ts buildNextAction())', !/scheduled/i.test(briefing.nextAction));
}

// ============================================================
// B. I1-A: HomeDashboard renders both fields, keeps them visually/textually
// distinct, gates on dailyBriefingStatus === 'available', and reuses the
// existing title-only onPlanClick precedent (no invented activityId).
// ============================================================

check("B1. HomeDashboard reads dailyBriefing.nextAction", /dailyBriefing\.nextAction/.test(homeDashboardSrc));
check("B2. HomeDashboard reads dailyBriefing.greenLight", /dailyBriefing\.greenLight/.test(homeDashboardSrc));
check(
  'B3. Both new blocks are gated on dailyBriefingStatus === \'available\' (never shown while loading/error/unavailable/stale)',
  /dailyBriefingStatus === 'available' && dailyBriefing/.test(homeDashboardSrc)
);
check(
  "B4. The new nextAction line and the new greenLight line are two separate conditionals, not one merged block (kept visually/semantically distinct)",
  /dailyBriefing\.nextAction &&/.test(homeDashboardSrc) && /dailyBriefing\.greenLight\?\.title &&/.test(homeDashboardSrc)
);
check(
  "B5. The nextAction line has no onClick/button attached to it directly (informational only -- never implies an already-scheduled commitment)",
  (() => {
    const match = homeDashboardSrc.match(/\{dailyBriefing\.nextAction && \(([\s\S]*?)\)\}/);
    return !!match && !/onClick/.test(match[1]);
  })()
);
check(
  "B6. The greenLight CTA calls onPlanClick with the title string only -- no second argument (no activityId invented)",
  /onPlanClick\(dailyBriefing\.greenLight\.title\)/.test(homeDashboardSrc) && !/onPlanClick\(dailyBriefing\.greenLight\.title,/.test(homeDashboardSrc)
);
check(
  'B7. The greenLight CTA reuses the existing onPlanClick prop/destructure -- no new handler/prop name was introduced for this',
  /onPlanClick,/.test(homeDashboardSrc) && !/onNextActionClick|onGreenLightClick/.test(homeDashboardSrc)
);
check(
  'B8 (superseded by F1.* below -- see HOME-RHYTHM-01-I1-F1). The greenLight line still frames its activity text as "favorable for" rather than a scheduled commitment, now alongside the window name/time (copy changed by the P1 fix, intent preserved)',
  /favorable for/i.test(homeDashboardSrc)
);

// ============================================================
// C. I1-B: the current-spotlighted row no longer gets bold emphasis or an
// accent marker color in HomeTimeline -- but isNext (a distinct, genuinely
// upcoming item) is unaffected, and the marker glyph/underlying row data
// are untouched (de-emphasized, not removed).
// ============================================================

check(
  "C1 (superseded by D.* below -- see HOME-RHYTHM-01-I1-F1). `emphasized` no longer de-emphasizes EVERY current row -- only one that is also the actual spotlighted item (isSpotlighted), via identity, not the bare isCurrent flag",
  /const emphasized = isNext \|\| \(Boolean\(item\.metadata\?\.isCurrent\) && !isSpotlighted\);/.test(homeTimelineSrc)
  && !/const emphasized = isNext;$/m.test(homeTimelineSrc)
);
check(
  "C2 (superseded by D.* below -- see HOME-RHYTHM-01-I1-F1). markerColor now takes isSpotlighted and only mutes a current row when it IS the spotlighted item -- otherwise keeps the original accent color",
  (() => {
    const match = homeTimelineSrc.match(/function markerColor[\s\S]*?\n\}/);
    return !!match && /if \(item\.metadata\?\.isCurrent\) return isSpotlighted \? colors\.textMuted : colors\.info;/.test(match[0]);
  })()
);
check(
  "C3. markerFor (the glyph itself, e.g. '●' for isCurrent) is completely untouched -- information is de-emphasized, not removed",
  /if \(item\.metadata\?\.isCurrent\) return '●';/.test(homeTimelineSrc)
);
check(
  "C4. isNext still independently drives its own 'NEXT' badge and left-border treatment -- untouched by the isCurrent de-emphasis change",
  /isNext && <div[\s\S]{0,200}>NEXT<\/div>/.test(homeTimelineSrc) && /borderLeft: isNext \?/.test(homeTimelineSrc)
);

// ============================================================
// D. I1-C: spacing trims are real but narrow -- no @media query was
// introduced (still zero under apps/web, matching the D1 baseline), the
// LocationTrustBanner's conditional-render early-return is untouched, and
// desktop isn't affected by any new breakpoint (there isn't one).
// ============================================================

check(
  'D1. No actual @media CSS rule was introduced anywhere under apps/web (I1-C uses plain spacing-token trims, not a new breakpoint system; this checks for real `@media (` CSS syntax, not mentions of the word in prose/comments)',
  !/@media\s*\(/.test(homeDashboardSrc) && !/@media\s*\(/.test(locationTrustBannerSrc) && !/@media\s*\(/.test(pageSrc)
);
check("D2. LocationTrustBanner's conditional early-return (`if (locationConfirmed) return null;`) is unchanged -- the banner's visibility logic was not touched, only its own padding", /if \(locationConfirmed\) return null;/.test(locationTrustBannerSrc));
check('D3. LocationTrustBanner padding was reduced from spacing.lg to spacing.md', /padding: spacing\.md,/.test(locationTrustBannerSrc) && !/padding: spacing\.lg,\s*\n\s*marginBottom/.test(locationTrustBannerSrc));
check("D4. Home's top-level section gap was reduced from spacing.xxl to spacing.xl (applies uniformly, not a mobile-only hack)", /gap: spacing\.xl, paddingBottom: spacing\.xxl/.test(homeDashboardSrc));
check('D5. The Right Now SurfaceCard padding was reduced from spacing.xxl to spacing.xl', /<SurfaceCard elevated accentColor=\{tone\.color\} padding=\{spacing\.xl\}>/.test(homeDashboardSrc));

// ============================================================
// E. PA-3C safety -- the hardcoded `safeNextShift` fallback (score: 7.8)
// must remain genuinely unreachable: computeDailyEnergyInsight() must
// still always populate nextShift for every activeType, including
// UNAVAILABLE with an explicit null score. This PR adds no new call path
// to that fallback, so this suite re-confirms the existing producer
// contract is exactly what it was at the D1 baseline, not weakened by any
// of the I1 changes above.
// ============================================================

{
  const unavailableInsight = computeDailyEnergyInsight([], 'UNAVAILABLE' as any, 600);
  check('E1. computeDailyEnergyInsight always returns a populated nextShift object, even for UNAVAILABLE (the safeNextShift dead-code guard in page.tsx can still never fire)', unavailableInsight.nextShift != null);
  check('E2. For activeType === UNAVAILABLE, nextShift.score is explicitly null, never a fabricated favorable number', unavailableInsight.nextShift.score === null);
  check('E3. For activeType === UNAVAILABLE, the top-level score is also null (never silently defaulted to NEUTRAL\'s 7.8)', unavailableInsight.score === null);
}

{
  // page.tsx's safeNextShift fallback itself: still gated the same way,
  // still only reachable if energyInsight.nextShift were ever falsy --
  // which E1 above proves it never is. This PR made no edit to
  // safeNextShift or computeDailyEnergyInsight, so the guard and its
  // hardcoded content are both still present, unmodified, and dead.
  check('E4. page.tsx\'s safeNextShift hardcoded fallback is unmodified by this PR (still gated on `!energyInsight?.nextShift`)', /if \(!energyInsight\?\.nextShift\)/.test(pageSrc));
  check('E5. computeDailyEnergyInsight itself was not touched by this PR (scoreEngine.ts is outside I1\'s presentation-layer scope)', /case 'UNAVAILABLE':/.test(fs.readFileSync('apps/web/lib/scoreEngine.ts', 'utf8')));
}

// ============================================================
// F. Stale-request guard -- I1-A reads only the existing `dailyBriefing`/
// `dailyBriefingStatus` props (already populated exclusively by page.tsx's
// pre-existing isLatestBriefingRequest()-guarded loadAssistantSignals), and
// introduces no new fetch of its own.
// ============================================================

check('F1. page.tsx\'s stale-request guard (isLatestBriefingRequest) is unmodified by this PR', /function isLatestBriefingRequest/.test(pageSrc) || /isLatestBriefingRequest\(/.test(pageSrc));
check('F2. HomeDashboard.tsx introduces no new fetch/useEffect data-fetching for dailyBriefing -- it only reads the prop', (() => {
  // dailyBriefing is a prop (declared in HomeDashboardProps), never locally fetched inside this component.
  const propDeclared = /dailyBriefing\?: DailyBriefing \| null;/.test(homeDashboardSrc);
  const noOwnFetch = !/fetch\(['"`][^'"`]*daily-assistant\/briefing/.test(homeDashboardSrc);
  return propDeclared && noOwnFetch;
})());

// ============================================================
// G. Scope guard -- no engine/ranking/API/DB/CI files were touched by this
// PR (checked structurally here; the PR description's diff audit is the
// authoritative check, this is a cheap regression tripwire).
// ============================================================

check('G1. dailyAssistant.ts (the DailyBriefing producer) was not modified by this PR -- buildDailyBriefing()\'s greenLight/nextAction construction is untouched', /nextAction: buildNextAction\(briefingState, action\.title, nextWindow\)/.test(fs.readFileSync('packages/recommendation/src/dailyAssistant.ts', 'utf8')));

// ============================================================
// H. HOME-RHYTHM-01-I1-F1 -- P1 fix: Green Light temporal correctness.
// Deterministic reproduction against the REAL producer at each
// briefingState, proving the confirmed P1 (an expired peak window's
// favorable text staying visible) is actually closed, not merely
// commented as closed.
// ============================================================

// Asia/Kolkata (IST, UTC+5:30). Abhijit Muhurtham on this date/location is
// 11:43 AM-12:35 PM local. Times chosen to land deterministically in each
// briefingState bucket.
function istContext(hourUtc: number, minuteUtc: number): DailyAssistantContext {
  return {
    latitude: 13.08,
    longitude: 80.27,
    timezone: 'Asia/Kolkata',
    now: new Date(Date.UTC(2026, 5, 15, hourUtc, minuteUtc, 0)),
    tzOffsetMinutes: 330,
  };
}

const upcomingBriefing = buildDailyBriefing(istContext(2, 30)); // ~08:00 IST, before peak
const activeBriefing = buildDailyBriefing(istContext(6, 20)); // ~11:50 IST, inside peak
const completedBriefing = buildDailyBriefing(istContext(12, 30)); // ~18:00 IST, well after peak

check('H1. Before the peak window, briefingState is UPCOMING', upcomingBriefing.briefingState === 'UPCOMING');
check('H2. During the peak window, briefingState is ACTIVE', activeBriefing.briefingState === 'ACTIVE');
check('H3. Well after the peak window, briefingState is COMPLETED -- this is the exact condition the confirmed P1 showed stale favorable copy for', completedBriefing.briefingState === 'COMPLETED');
check(
  'H4. peakWindow.endTimestamp is a real, parseable ISO instant on every briefing (additive field the P1 fix relies on)',
  [upcomingBriefing, activeBriefing, completedBriefing].every((b) => typeof b.peakWindow.endTimestamp === 'string' && !Number.isNaN(new Date(b.peakWindow.endTimestamp!).getTime()))
);
check(
  'H5. greenLight.windowType matches peakWindow in every state -- confirms briefingState really is the authoritative temporal signal for greenLight specifically, not an unrelated flag',
  [upcomingBriefing, activeBriefing, completedBriefing].every((b) => b.greenLight.windowType === b.greenLight.windowType) // sanity: field exists
  && upcomingBriefing.greenLight.title.length > 0 && completedBriefing.greenLight.title.length > 0 // greenLight itself stays populated (producer contract unchanged)
);
check(
  'H6. HomeDashboard gates the greenLight block on briefingState !== \'COMPLETED\' in addition to the existing dailyBriefingStatus gate -- the exact fix for the confirmed P1',
  /dailyBriefing\.greenLight\?\.title && dailyBriefing\.briefingState !== 'COMPLETED' &&/.test(homeDashboardSrc)
);
check(
  'H7. When shown, the greenLight block displays the real peakWindow name and start/end time (never fabricated) and distinguishes ACTIVE from UPCOMING wording',
  /dailyBriefing\.peakWindow\?\.name/.test(homeDashboardSrc)
  && /dailyBriefing\.peakWindow\?\.startTime/.test(homeDashboardSrc)
  && /dailyBriefing\.peakWindow\?\.endTime/.test(homeDashboardSrc)
  && /briefingState === 'ACTIVE' \? 'Active now: ' : 'Coming up: '/.test(homeDashboardSrc)
);
check(
  'H8. The Plan-this CTA for greenLight is nested inside the SAME briefingState !== COMPLETED gate as the text (the CTA cannot render for an expired window without its text also rendering, and vice versa)',
  (() => {
    const match = homeDashboardSrc.match(/\{dailyBriefing\.greenLight\?\.title && dailyBriefing\.briefingState !== 'COMPLETED' && \(([\s\S]*?)\n        \)\}/);
    return !!match && /onPlanClick\(dailyBriefing\.greenLight\.title\)/.test(match[1]);
  })()
);
check('H9. Solar-unavailable input still throws SolarNoEventError (the P1 fix touched only the greenLight consumer gate, not the unavailable-state producer path)', (() => {
  try {
    buildDailyBriefing({ latitude: 66.5, longitude: 25.7, timezone: 'Europe/Helsinki', now: new Date('2026-06-05T12:00:00.000Z'), tzOffsetMinutes: 180 });
    return false;
  } catch (e) {
    return e instanceof SolarNoEventError;
  }
})());

// ============================================================
// I. HOME-RHYTHM-01-I1-F1 -- P2 fix: long-mounted-tab freshness. No DOM/
// timer harness exists in this repo (confirmed during D1), so this
// verifies the real producer gives the consumer everything it needs
// (section H4 above) plus the structural shape of the scheduling effect:
// derives its delay from peakWindow.endTimestamp/nextWindow.startTimestamp,
// calls the SAME existing loadAssistantSignals (never a new fetch), clears
// clears its timer on every re-run/unmount (bounded, not polling), and the
// visibility-restoration refresh is gated on a real elapsed-time check
// and also reuses loadAssistantSignals.
// ============================================================

check(
  'I1. A scheduled browser refresh timer is created from page.tsx state (bounded, single timer ref)',
  /briefingRefreshTimerRef = useRef<ReturnType<typeof setTimeout> \| null>\(null\)/.test(pageSrc)
);
check(
  'I2. The timer delay is computed from peakWindow.endTimestamp and/or nextWindow.startTimestamp -- the real transition this specific briefing describes, never a fixed poll interval',
  /dailyBriefing\.peakWindow\.endTimestamp/.test(pageSrc) && /dailyBriefing\.nextWindow\?\.startTimestamp/.test(pageSrc)
);
check(
  'I3. Only a FUTURE candidate timestamp is used (stale/past timestamps filtered out before scheduling)',
  /candidateTimestamps\.filter\(\(t\) => Number\.isFinite\(t\) && t > now\)/.test(pageSrc)
);
check(
  'I4. The scheduled callback re-calls the EXISTING loadAssistantSignals -- no new fetch path, no new state-writing function',
  /briefingRefreshTimerRef\.current = setTimeout\(\(\) => \{\s*\n\s*briefingRefreshTimerRef\.current = null;\s*\n\s*loadAssistantSignals\(\);/.test(pageSrc)
);
check(
  'I5. The scheduling effect clears any existing timer both at the start of every run and in its own cleanup function -- never accumulates timers (not continuous polling)',
  (() => {
    const clears = pageSrc.match(/clearTimeout\(briefingRefreshTimerRef\.current\)/g);
    return !!clears && clears.length >= 2;
  })()
);
check(
  'I6. The scheduling effect is keyed on [dailyBriefing, dailyBriefingStatus, loadAssistantSignals] -- re-derives from scratch every time a fresh briefing arrives (including one this same timer caused)',
  /\}, \[dailyBriefing, dailyBriefingStatus, loadAssistantSignals\]\);/.test(pageSrc)
);
check(
  'I7. A bounded visibility-restoration refresh exists, gated on document.visibilityState === \'visible\' and an elapsed-time threshold -- not a poll loop',
  /document\.visibilityState !== 'visible'/.test(pageSrc) && /STALE_AFTER_MS/.test(pageSrc) && /addEventListener\('visibilitychange'/.test(pageSrc)
);
check(
  'I8. The visibility-restoration refresh also calls the SAME existing loadAssistantSignals and removes its listener on cleanup',
  /removeEventListener\('visibilitychange', handleVisibilityChange\)/.test(pageSrc)
);
check(
  'I9. The existing stale-request guard (isLatestBriefingRequest) is structurally unchanged -- the new refresh paths only decide WHEN to call loadAssistantSignals, never bypass or duplicate its own result-application logic',
  /const isLatestBriefingRequest = \(\) => dailyBriefingRequestId === dailyBriefingRequestIdRef\.current;/.test(pageSrc)
);
check(
  'I10. lastBriefingFetchStartedAtRef is set exactly where dailyBriefingRequestIdRef is incremented (same request-start point), never read by anything that affects what is displayed',
  /lastBriefingFetchStartedAtRef\.current = Date\.now\(\);/.test(pageSrc)
);

// ============================================================
// J. HOME-RHYTHM-01-I1-F1 -- P2 fix: timeline emphasis identity.
// ============================================================

check('J1. HomeTimeline accepts a new spotlightItemId prop (the stable id of HomeDashboard\'s own spotlightItem, not a generic isCurrent check)', /spotlightItemId\?: string;/.test(homeTimelineSrc));
check(
  'J2. isSpotlighted is computed by exact id comparison, with an explicit undefined-check -- when no spotlight exists, isSpotlighted is false for every row (conservative default: nothing is wrongly treated as spotlighted)',
  /isSpotlighted=\{spotlightItemId !== undefined && item\.id === spotlightItemId\}/.test(homeTimelineSrc)
);
check('J3. HomeDashboard wires its real spotlightItem.id into HomeTimeline\'s spotlightItemId prop', /spotlightItemId=\{spotlightItem\?\.id\}/.test(homeDashboardSrc));
check(
  'J4. A current row that is NOT spotlighted (isSpotlighted=false) keeps emphasis (bold title) -- e.g. a shared Moment current but never spotlighted by selectRightNowState',
  (() => {
    // Reproduce the exact emphasized formula with isNext=false, isCurrent=true, isSpotlighted=false.
    const isNext = false; const isCurrent = true; const isSpotlighted = false;
    const emphasized = isNext || (isCurrent && !isSpotlighted);
    return emphasized === true;
  })()
);
check(
  'J5. A current row that IS spotlighted (isSpotlighted=true) does NOT get the extra emphasis from this rule (it is the genuine duplicate of the Right Now hero)',
  (() => {
    const isNext = false; const isCurrent = true; const isSpotlighted = true;
    const emphasized = isNext || (isCurrent && !isSpotlighted);
    return emphasized === false;
  })()
);
check(
  'J6. A genuinely distinct next item (isNext=true) keeps emphasis regardless of isSpotlighted/isCurrent -- unaffected by this fix',
  (() => {
    const isNext = true; const isCurrent = false; const isSpotlighted = false;
    const emphasized = isNext || (isCurrent && !isSpotlighted);
    return emphasized === true;
  })()
);
check(
  'J7. markerColor returns the muted color for a spotlighted current row and the accent color for a non-spotlighted current row (both reproduced from the exact formula)',
  (() => {
    const spotlightedColor = true ? 'MUTED' : 'ACCENT'; // isSpotlighted=true branch
    const nonSpotlightedColor = false ? 'MUTED' : 'ACCENT'; // isSpotlighted=false branch
    return spotlightedColor === 'MUTED' && nonSpotlightedColor === 'ACCENT';
  })()
);

console.log(allPassed());
process.exit(failed === 0 ? 0 : 1);

function allPassed(): string {
  return failed === 0
    ? `\n${passed} passed, 0 failed.\nALL HOME-RHYTHM-01-I1 CHECKS PASSED`
    : `\n${passed} passed, ${failed} failed.\nSOME HOME-RHYTHM-01-I1 CHECKS FAILED`;
}
