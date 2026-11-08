/**
 * PA-3C-C1B-01 -- regression coverage for the explicit `UNAVAILABLE`
 * solar-window classification: the eight confirmed unsafe-fallback sites
 * (F1-F8), persistence containment, the legacy habit-completion endpoint's
 * new validation, and the D10 Aura Fit scope decision (a typed refusal,
 * not silent reweighting -- see auraFitEngine.ts's own comment for why).
 * Follows this repo's existing standalone ts-node convention: plain
 * assertions, console.log, exit code reflects pass/fail.
 */
import * as fs from 'fs';

import { SolarWindowType, isSolarWindowType, ALL_SOLAR_WINDOW_TYPES } from '../packages/panchang/src/windows';
import { computeDailyEnergyInsight } from '../apps/web/lib/scoreEngine';
import {
  classifyInsightsWindow,
  insightsWindowWeight,
  INSIGHTS_WINDOW_BAND_WEIGHT,
} from '../apps/web/lib/insightsWindowAlignment';
import { getActionCards, getActivityDiscoveryCards } from '../packages/recommendation/src/actionCards';
import { normalizeWindowType } from '../packages/recommendation/src/personalizedTasks';
import { evaluateActivityFit, AuraFitUnavailableError } from '../packages/recommendation/src/auraFitEngine';
import { FULL_ACTIVITY_CATALOG } from '../packages/recommendation/src/personalizedTasks';

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

// ============================================================
// Core contract
// ============================================================

check('UNAVAILABLE is a recognized SolarWindowType member', isSolarWindowType('UNAVAILABLE'));
check('ALL_SOLAR_WINDOW_TYPES includes exactly 7 members (6 original + UNAVAILABLE)', ALL_SOLAR_WINDOW_TYPES.length === 7);
check('A genuinely unrecognized string is NOT a valid SolarWindowType', !isSolarWindowType('SOMETHING_MADE_UP'));
check('Empty string is NOT a valid SolarWindowType', !isSolarWindowType(''));

// ============================================================
// F1 -- scoreEngine.ts
// ============================================================

{
  const unavailable = computeDailyEnergyInsight([], 'UNAVAILABLE', 600);
  check('F1: UNAVAILABLE active type produces a null score, never NEUTRAL\'s 7.8', unavailable.score === null);
  check('F1: UNAVAILABLE active type produces a null stars value', unavailable.stars === null);
  check('F1: UNAVAILABLE active type\'s themeText is honest, not the NEUTRAL "Balanced and stable" copy', !unavailable.themeText.includes('Balanced and stable') && unavailable.themeText.toLowerCase().includes('unavailable'));
  check('F1: UNAVAILABLE active type\'s nextShift fallback also carries a null score (no windows exist to find an upcoming one)', unavailable.nextShift.score === null);

  const neutral = computeDailyEnergyInsight([], 'NEUTRAL', 600);
  check('F1: existing NEUTRAL behavior with no windows is completely unchanged (regression)', neutral.score === 7.8 && neutral.nextShift.score === 7.8);

  const rahu = computeDailyEnergyInsight([], 'RAHU_KALAM', 600);
  check('F1: existing RAHU_KALAM scoring is unchanged', rahu.score === 3.5);
}

// ============================================================
// F2/D10 -- auraFitEngine.ts
// ============================================================

{
  const activity = FULL_ACTIVITY_CATALOG[0];
  let threw = false;
  let isCorrectType = false;
  try {
    evaluateActivityFit({ activity, date: new Date('2026-06-21T12:00:00Z'), windowType: 'UNAVAILABLE' });
  } catch (err) {
    threw = true;
    isCorrectType = err instanceof AuraFitUnavailableError;
  }
  check('F2/D10: evaluateActivityFit throws for UNAVAILABLE windowType (typed refusal, not a fabricated score)', threw);
  check('F2/D10: the thrown error is specifically AuraFitUnavailableError', isCorrectType);

  // Existing valid-window scoring is completely unaffected.
  const abhijitFit = evaluateActivityFit({ activity, date: new Date('2026-06-21T12:00:00Z'), windowType: 'ABHIJIT' });
  check('F2: existing ABHIJIT Aura Fit evaluation still returns a real numeric score', typeof abhijitFit.score === 'number');
}

// ============================================================
// F7 -- actionCards.ts
// ============================================================

check('F7: getActionCards(\'UNAVAILABLE\') returns an empty array, never ACTION_CARDS.NEUTRAL\'s cards', getActionCards('UNAVAILABLE').length === 0);
check('F7: getActionCards(\'NEUTRAL\') is unchanged (non-empty, as before)', getActionCards('NEUTRAL').length > 0);
check('F7: getActionCards(\'ABHIJIT\') is unchanged', getActionCards('ABHIJIT').length > 0);
check('F7: getActivityDiscoveryCards(\'UNAVAILABLE\', ...) returns an empty array, never a fabricated discovery list', getActivityDiscoveryCards('UNAVAILABLE', 6).length === 0);

// ============================================================
// F8 -- personalizedTasks.ts
// ============================================================

check('F8: normalizeWindowType(\'UNAVAILABLE\') returns \'UNAVAILABLE\', never falls through to NEUTRAL', normalizeWindowType('UNAVAILABLE') === 'UNAVAILABLE');
check('F8: normalizeWindowType(\'unavailable\') (lowercase) still normalizes correctly', normalizeWindowType('unavailable') === 'UNAVAILABLE');
check('F8: normalizeWindowType(\'RAHU_KALAM\') is unchanged', normalizeWindowType('RAHU_KALAM') === 'RAHU_KALAM');
check('F8: normalizeWindowType of a genuinely unrecognized string still returns NEUTRAL (pre-existing, unchanged display-normalizer default)', normalizeWindowType('TOTALLY_UNKNOWN_XYZ') === 'NEUTRAL');

// ============================================================
// F3 -- insightsWindowAlignment.ts
// ============================================================

check('F3: classifyInsightsWindow(\'UNAVAILABLE\') is UNCLASSIFIED, never NEUTRAL', classifyInsightsWindow('UNAVAILABLE') === 'UNCLASSIFIED');
check('F3: insightsWindowWeight(\'UNAVAILABLE\') is null, never NEUTRAL\'s 0.7 weight', insightsWindowWeight('UNAVAILABLE') === null);
check('F3: INSIGHTS_WINDOW_BAND_WEIGHT has exactly the 3 original numeric bands (UNCLASSIFIED deliberately has no weight)', Object.keys(INSIGHTS_WINDOW_BAND_WEIGHT).length === 3);
check('F3: existing NEUTRAL weight is unchanged at 0.7', insightsWindowWeight('NEUTRAL') === 0.7);
check('F3: existing SUPPORTIVE (ABHIJIT) weight is unchanged at 1.0', insightsWindowWeight('ABHIJIT') === 1.0);
check('F3: existing FRICTION (RAHU_KALAM) weight is unchanged at 0.0', insightsWindowWeight('RAHU_KALAM') === 0.0);

{
  // Reproduces InsightsView.tsx's own null-filtering pattern to prove a
  // mixed classified/unavailable batch excludes the unavailable entries
  // from BOTH the sum and the divisor, never diluting or inflating.
  const windows = ['ABHIJIT', 'UNAVAILABLE', 'RAHU_KALAM', 'UNAVAILABLE'];
  const weights = windows.map((w) => insightsWindowWeight(w)).filter((w): w is number => w !== null);
  check('F3: a mixed batch filters out exactly the 2 UNAVAILABLE entries', weights.length === 2);
  const avg = Math.round((weights.reduce((s, w) => s + w, 0) / weights.length) * 100);
  check('F3: the correct 2-entry average is 50% (ABHIJIT=1.0, RAHU_KALAM=0.0), not diluted by the 2 excluded entries', avg === 50);

  const allUnavailable = ['UNAVAILABLE', 'UNAVAILABLE'];
  const allUnavailableWeights = allUnavailable.map((w) => insightsWindowWeight(w)).filter((w): w is number => w !== null);
  check('F3: an all-UNAVAILABLE batch has zero classified weights (honest "no data", never a fabricated 0% or 70%)', allUnavailableWeights.length === 0);
}

// ============================================================
// F4 -- muhurtaReasonFormat.ts
// ============================================================

{
  const muhurtaSrc = fs.readFileSync('packages/muhurta/src/muhurtaReasonFormat.ts', 'utf8');
  check('F4: windowLabel has an explicit UNAVAILABLE branch returning a distinct label, not "Neutral Flow"', /if \(type === 'UNAVAILABLE'\) return 'Timing Unavailable';/.test(muhurtaSrc));
}

// ============================================================
// F5/F6 -- Timeline.tsx
// ============================================================

{
  const timelineSrc = fs.readFileSync('apps/web/components/Timeline.tsx', 'utf8');
  check('F5: getWindowMeta has an explicit UNAVAILABLE branch before falling through to Neutral Flow', /clean\.includes\('UNAVAILABLE'\)[\s\S]{0,150}Solar Timing Unavailable/.test(timelineSrc));
  check('F6: actionQueryForWindow has an explicit UNAVAILABLE branch returning \'UNAVAILABLE\', not \'NEUTRAL\'', /if \(clean\.includes\('UNAVAILABLE'\)\) return 'UNAVAILABLE';/.test(timelineSrc));
}

// ============================================================
// Home page.tsx -- activeType feed (upstream of F1/F5/F6/F7/F8)
// ============================================================

{
  const pageSrc = fs.readFileSync('apps/web/app/page.tsx', 'utf8');
  check('Home: activeType falls back to \'UNAVAILABLE\' when solar is null, never silently \'NEUTRAL\'', /return solar \? getActiveWindow\(windows, currentMinuteOfDay\) : 'UNAVAILABLE';/.test(pageSrc));
}

// ============================================================
// HomeDashboard.tsx -- getWindowTone / getHeroHeadline / FlowRing
// ============================================================

{
  const homeSrc = fs.readFileSync('apps/web/components/HomeDashboard.tsx', 'utf8');
  check('HomeDashboard: getWindowTone has an explicit UNAVAILABLE branch before any numeric score comparison', /cleanWindow\.includes\('UNAVAILABLE'\)[\s\S]{0,100}Timing Unavailable/.test(homeSrc));
  check('HomeDashboard: getHeroHeadline has an explicit UNAVAILABLE branch, not the favorable default', /cleanWindow\.includes\('UNAVAILABLE'\)\) return 'Solar timing unavailable/.test(homeSrc));
  check('HomeDashboard: FlowRing accepts a null score and skips drawing a fabricated fill arc', /score === null \? null[\s\S]{0,400}normalized !== null &&/.test(homeSrc));
}

// ============================================================
// Persistence containment -- habit logging / plan completion
// ============================================================

{
  const habitLogsSrc = fs.readFileSync('apps/web/app/api/habit-logs/route.ts', 'utf8');
  check('Habit logging: SolarNoEventError is caught and mapped to \'UNAVAILABLE\'', /err instanceof SolarNoEventError[\s\S]{0,80}activeWindow = 'UNAVAILABLE'/.test(habitLogsSrc));
  check('Habit logging: any OTHER error (invalid input / computation error) still propagates, never silently caught', /\} else \{\s*\n\s*throw err;\s*\n\s*\}/.test(habitLogsSrc));

  const planCompletionSrc = fs.readFileSync('apps/web/lib/planCompletionHistory.ts', 'utf8');
  check('Plan completion: SolarNoEventError is caught and mapped to \'UNAVAILABLE\'', /err instanceof SolarNoEventError[\s\S]{0,80}activeWindow = 'UNAVAILABLE'/.test(planCompletionSrc));
}

// ============================================================
// D9 -- legacy habit-completion endpoint
// ============================================================

{
  const legacyRouteSrc = fs.readFileSync('apps/web/app/api/habits/[habitId]/log/route.ts', 'utf8');
  check('D9: legacy endpoint validates activeWindow against isSolarWindowType, not a bare non-empty check', /isSolarWindowType\(activeWindow\)/.test(legacyRouteSrc));
  check('D9: legacy endpoint still imports/uses logHabitCompletion (route not deleted or renamed)', /logHabitCompletion/.test(legacyRouteSrc));
}

// ============================================================
// windowNotificationPlanner.ts -- exhaustive Record forced a decision
// ============================================================

{
  const plannerSrc = fs.readFileSync('apps/web/lib/windowNotificationPlanner.ts', 'utf8');
  check('DEFAULT_NOTIFICATION_PREFS has an explicit UNAVAILABLE: false entry (TypeScript-forced, not accidentally omitted)', /UNAVAILABLE: false/.test(plannerSrc));
}

// ============================================================
// actionCards.ts -- ACTION_CARDS.UNAVAILABLE is deliberately empty
// ============================================================

{
  const actionCardsSrc = fs.readFileSync('packages/recommendation/src/actionCards.ts', 'utf8');
  check('ACTION_CARDS.UNAVAILABLE is deliberately an empty array, not a copy of NEUTRAL\'s cards', /UNAVAILABLE: \[\],/.test(actionCardsSrc));
}

console.log(allPassed());
process.exit(failed === 0 ? 0 : 1);

function allPassed(): string {
  return failed === 0
    ? `\n${passed} passed, 0 failed.\nALL PA-3C-C1B-01 CHECKS PASSED`
    : `\n${passed} passed, ${failed} failed.\nSOME PA-3C-C1B-01 CHECKS FAILED`;
}
