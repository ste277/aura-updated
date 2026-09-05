/**
 * Insights Window-Alignment Semantic Correction V1 (PR C1): regression
 * suite for the shared apps/web/lib/insightsWindowAlignment.ts taxonomy,
 * and for the corrected InsightsView.tsx/insights route calculations that
 * now consume it exclusively.
 */
import * as fs from 'fs';
import { classifyInsightsWindow, insightsWindowWeight, INSIGHTS_WINDOW_BAND_WEIGHT } from '../apps/web/lib/insightsWindowAlignment';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// Required mapping (brief section 3/21).
// ============================================================

check('BRAHMA -> SUPPORTIVE', classifyInsightsWindow('BRAHMA') === 'SUPPORTIVE');
check('ABHIJIT -> SUPPORTIVE', classifyInsightsWindow('ABHIJIT') === 'SUPPORTIVE');
check('GULIKA -> NEUTRAL', classifyInsightsWindow('GULIKA') === 'NEUTRAL');
check('NEUTRAL -> NEUTRAL', classifyInsightsWindow('NEUTRAL') === 'NEUTRAL');
check('RAHU_KALAM -> FRICTION', classifyInsightsWindow('RAHU_KALAM') === 'FRICTION');
check('YAMA -> FRICTION', classifyInsightsWindow('YAMA') === 'FRICTION');

// Underscore vs. space-separated display form both classify identically
// (this codebase uses both forms in different places).
check('Space-separated "RAHU KALAM" classifies the same as "RAHU_KALAM"', classifyInsightsWindow('RAHU KALAM') === 'FRICTION');
check('Lowercase input classifies the same as uppercase', classifyInsightsWindow('gulika') === 'NEUTRAL');

// Fails safely for unexpected values.
check('Empty string fails safely to NEUTRAL, never throws', classifyInsightsWindow('') === 'NEUTRAL');
check('null fails safely to NEUTRAL', classifyInsightsWindow(null) === 'NEUTRAL');
check('undefined fails safely to NEUTRAL', classifyInsightsWindow(undefined) === 'NEUTRAL');
check('An unrecognized garbage string fails safely to NEUTRAL', classifyInsightsWindow('NOT_A_REAL_WINDOW') === 'NEUTRAL');

// ============================================================
// Numeric weight mapping -- ordinal, and Gulika == Neutral (never
// Gulika == Brahma/Abhijit).
// ============================================================

check('SUPPORTIVE weight (1.0) > NEUTRAL weight (0.7) > FRICTION weight (0.0)', INSIGHTS_WINDOW_BAND_WEIGHT.SUPPORTIVE > INSIGHTS_WINDOW_BAND_WEIGHT.NEUTRAL && INSIGHTS_WINDOW_BAND_WEIGHT.NEUTRAL > INSIGHTS_WINDOW_BAND_WEIGHT.FRICTION);
check('insightsWindowWeight(GULIKA) === insightsWindowWeight(NEUTRAL)', insightsWindowWeight('GULIKA') === insightsWindowWeight('NEUTRAL'));
check('insightsWindowWeight(GULIKA) !== insightsWindowWeight(BRAHMA) -- Gulika is never scored identically to Brahma', insightsWindowWeight('GULIKA') !== insightsWindowWeight('BRAHMA'));
check('insightsWindowWeight(GULIKA) !== insightsWindowWeight(ABHIJIT)', insightsWindowWeight('GULIKA') !== insightsWindowWeight('ABHIJIT'));
check('insightsWindowWeight(BRAHMA) === 1.0', insightsWindowWeight('BRAHMA') === 1.0);
check('insightsWindowWeight(GULIKA) === 0.7', insightsWindowWeight('GULIKA') === 0.7);
check('insightsWindowWeight(RAHU_KALAM) === 0.0', insightsWindowWeight('RAHU_KALAM') === 0.0);

// ============================================================
// Score independence -- logSource and activitySignificance must no
// longer affect the per-window weight at all (they were removed from
// scoreLoggedWindow / are simply never inputs to this shared helper).
// ============================================================

check('classifyInsightsWindow has exactly 1 parameter (windowType only) -- structurally cannot accept logSource or activitySignificance', classifyInsightsWindow.length === 1);
check('insightsWindowWeight has exactly 1 parameter (windowType only) -- same window-only guarantee', insightsWindowWeight.length === 1);

// ============================================================
// 7-day trend replica -- exact replica of InsightsView.tsx's corrected
// score formula, proving: all-friction -> 0%, all-supportive -> 100%,
// all-neutral -> 70% (the retained neutral display weight), mixed ->
// expected weighted result, Gulika-only day === Neutral-only day, no
// artificial 30% floor, empty day -> null (never a fabricated 75).
// ============================================================

function dayScore(windows: string[]): number | null {
  if (windows.length === 0) return null;
  return Math.round((windows.reduce((sum, w) => sum + insightsWindowWeight(w), 0) / windows.length) * 100);
}

check('All-friction day -> 0%, not floored at 30%', dayScore(['RAHU_KALAM', 'YAMA', 'RAHU_KALAM']) === 0);
check('All-supportive day -> 100%', dayScore(['BRAHMA', 'ABHIJIT', 'BRAHMA']) === 100);
check('All-neutral day -> 70% (the retained neutral display weight)', dayScore(['NEUTRAL', 'NEUTRAL']) === 70);
check('Gulika-only day produces the EXACT SAME score as a Neutral-only day', dayScore(['GULIKA', 'GULIKA', 'GULIKA']) === dayScore(['NEUTRAL', 'NEUTRAL', 'NEUTRAL']));
check('Mixed day (1 supportive + 1 friction) -> 50%', dayScore(['ABHIJIT', 'RAHU_KALAM']) === 50);
check('Mixed day (2 supportive + 1 neutral + 1 friction) -> expected weighted result (68%, i.e. round((1.0+1.0+0.7+0.0)/4*100))', dayScore(['ABHIJIT', 'BRAHMA', 'NEUTRAL', 'RAHU_KALAM']) === 68);
check('Empty day (no logs) -> null, never a fabricated 75%', dayScore([]) === null);

// ============================================================
// Reflection-grouping replica -- Brahma/Abhijit -> supportive (aligned),
// Rahu/Yama -> friction, Gulika/Neutral -> neither side (counted in
// `total` but not `aligned` or `friction`).
// ============================================================

function classifyForReflectionGrouping(windows: string[]): { aligned: number; friction: number; total: number } {
  let aligned = 0;
  let friction = 0;
  windows.forEach((w) => {
    const band = classifyInsightsWindow(w);
    if (band === 'SUPPORTIVE') aligned++;
    if (band === 'FRICTION') friction++;
  });
  return { aligned, friction, total: windows.length };
}

const brahmaAbhijit = classifyForReflectionGrouping(['BRAHMA', 'ABHIJIT']);
check('Brahma/Abhijit both count as aligned/supportive', brahmaAbhijit.aligned === 2 && brahmaAbhijit.friction === 0);

const rahuYama = classifyForReflectionGrouping(['RAHU_KALAM', 'YAMA']);
check('Rahu/Yama both count as friction', rahuYama.friction === 2 && rahuYama.aligned === 0);

const gulikaNeutral = classifyForReflectionGrouping(['GULIKA', 'NEUTRAL']);
check('Gulika/Neutral count toward neither aligned nor friction (only total)', gulikaNeutral.aligned === 0 && gulikaNeutral.friction === 0 && gulikaNeutral.total === 2);

// ============================================================
// Source-scan cross-check: confirm the live files actually use the
// shared helper exclusively, and that no independent competing
// classification logic remains anywhere in Insights.
// ============================================================

const viewSource = fs.readFileSync('apps/web/components/InsightsView.tsx', 'utf8');
check('InsightsView.tsx imports classifyInsightsWindow/insightsWindowWeight from the shared helper', /from '\.\.\/lib\/insightsWindowAlignment'/.test(viewSource) && /classifyInsightsWindow/.test(viewSource) && /insightsWindowWeight/.test(viewSource));
check('InsightsView.tsx no longer declares scoreLoggedWindow', !/function scoreLoggedWindow/.test(viewSource));
check('InsightsView.tsx contains no independent ABHIJIT/BRAHMA/GULIKA-vs-RAHU/YAMA string-match classification blocks', !/includes\('(RAHU|YAMA|ABHIJIT|BRAHMA|GULIKA)'\)/.test(viewSource));

const routeSource = fs.readFileSync('apps/web/app/api/daily-assistant/insights/route.ts', 'utf8');
check('insights/route.ts imports classifyInsightsWindow from the shared helper', /from '\.\.\/\.\.\/\.\.\/\.\.\/lib\/insightsWindowAlignment'/.test(routeSource) && /classifyInsightsWindow/.test(routeSource));
check('insights/route.ts contains no independent ABHIJIT/BRAHMA/GULIKA-vs-RAHU/YAMA string-match classification blocks', !/includes\('(RAHU|YAMA|ABHIJIT|BRAHMA|GULIKA)'\)/.test(routeSource));

// The signed percentage-point delta formula (PR #75) must be untouched.
check('insights/route.ts still uses the PR #75 signed percentage-point delta formula, unchanged', /Math\.round\(\(alignedRate! - unalignedRate!\) \* 100\)/.test(routeSource));
check('insights/route.ts still requires both comparison groups before computing a delta (hasValidComparison), unchanged', /alignedRate !== null && unalignedRate !== null/.test(routeSource));

// Timing Location date-axis primitives (PR #76) must be untouched.
check('InsightsView.tsx still uses lastNCalendarDateKeys/todayDateKey/toInsightsObservation for date bucketing (PR #76 unchanged)', /lastNCalendarDateKeys\(timezone/.test(viewSource) && /todayDateKey\(timezone/.test(viewSource) && /toInsightsObservation\(/.test(viewSource));
check('insights/route.ts still buckets the log side of the reflection join via getDatePartsInTimezone(user.timezone, ...) (PR #76 unchanged)', /getDatePartsInTimezone\(user\.timezone,\s*new Date\(log\.logTimestamp\)\)\.dateStr/.test(routeSource));

// auraGuidedRate/monthAuraGuidedRate must be unchanged (logSource-only, not touched by this PR).
check('InsightsView.tsx still computes monthAuraGuidedRate from logSource only (AURA_PLANNED/AURA_DO_NOW), unchanged shape', /monthAuraGuidedCount\+\+/.test(viewSource) && /source === 'AURA_PLANNED' \|\| source === 'AURA_DO_NOW'/.test(viewSource));

// activitySignificance/logSource no longer feed the per-entry timing weight.
const analyticsBlock = viewSource.slice(viewSource.indexOf('const analytics = useMemo'), viewSource.indexOf('return {\n      totalActivities,'));
check('The per-entry timing weight (entryScore/insightsWindowWeight calls) inside the analytics block never reads activitySignificance', !/insightsWindowWeight\([^)]*activitySignificance/.test(analyticsBlock));

console.log(allPassed ? '\nALL INSIGHTS WINDOW ALIGNMENT CHECKS PASSED' : '\nSOME INSIGHTS WINDOW ALIGNMENT CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
