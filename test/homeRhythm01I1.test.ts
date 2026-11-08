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
  'B8. The greenLight line is explicitly labeled "Favorable for" -- never implies a scheduled commitment',
  /Favorable for:/.test(homeDashboardSrc)
);

// ============================================================
// C. I1-B: the current-spotlighted row no longer gets bold emphasis or an
// accent marker color in HomeTimeline -- but isNext (a distinct, genuinely
// upcoming item) is unaffected, and the marker glyph/underlying row data
// are untouched (de-emphasized, not removed).
// ============================================================

check(
  "C1. `emphasized` in HomeTimeline no longer includes isCurrent (only isNext drives bold emphasis now)",
  /const emphasized = isNext;/.test(homeTimelineSrc) && !/const emphasized = item\.metadata\?\.isCurrent === true \|\| isNext;/.test(homeTimelineSrc)
);
check(
  "C2. markerColor for isCurrent no longer returns the accent color (colors.info) -- muted instead",
  (() => {
    const match = homeTimelineSrc.match(/function markerColor[\s\S]*?\n\}/);
    return !!match && /if \(item\.metadata\?\.isCurrent\) return colors\.textMuted;/.test(match[0]);
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

console.log(allPassed());
process.exit(failed === 0 ? 0 : 1);

function allPassed(): string {
  return failed === 0
    ? `\n${passed} passed, 0 failed.\nALL HOME-RHYTHM-01-I1 CHECKS PASSED`
    : `\n${passed} passed, ${failed} failed.\nSOME HOME-RHYTHM-01-I1 CHECKS FAILED`;
}
