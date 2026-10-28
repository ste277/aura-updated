// AURA DB3 -- structural checks for InsightsDailyBriefingSection.tsx /
// InsightsView.tsx / page.tsx wiring. No component-test harness exists in
// this repo for a plain .tsx file under the standard ts-node runner
// (established convention -- see test/homeDashboardRightNowContract.test.ts's
// own header comment), so this follows the same source-text/regex
// structural-assertion pattern already used throughout DB1/DB2's own
// test suites.
import * as fs from 'fs';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const sectionSource = fs.readFileSync('apps/web/components/InsightsDailyBriefingSection.tsx', 'utf8');
const insightsSource = fs.readFileSync('apps/web/components/InsightsView.tsx', 'utf8');
const pageSource = fs.readFileSync('apps/web/app/page.tsx', 'utf8');
const stripped = (s: string) => s.replace(/\/\/.*$/gm, '').replace(/\s+/g, ' ');
const insightsStripped = stripped(insightsSource);

// ============================================================
// 1. Insertion point: FIRST in Overview, existing tabs preserved
// ============================================================

const overviewBlockIdx = insightsSource.indexOf("activeSubTab === 'overview'");
const sectionUsageIdx = insightsSource.indexOf('<InsightsDailyBriefingSection');
const goalReportingLoadingIdx = insightsSource.indexOf("goalReportingStatus === 'loading'");
check('1. InsightsDailyBriefingSection is rendered inside the Overview tab block', overviewBlockIdx >= 0 && sectionUsageIdx > overviewBlockIdx);
check('1. it is placed BEFORE the existing Goal-reporting loading/suggestions content (first in the hierarchy, matching PR4/PR5\'s own established precedent, never replacing them)', sectionUsageIdx > 0 && sectionUsageIdx < goalReportingLoadingIdx);
check('1. Patterns/Trends/Streaks tabs are untouched (still present, unmodified sub-tab list)', /\(\['overview', 'patterns', 'trends', 'streaks'\] as const\)/.test(insightsSource));
check('1. the existing SegmentedControl for overview/patterns/trends/streaks is unmodified (still exactly 4 options)', /options=\{\(\['overview', 'patterns', 'trends', 'streaks'\] as const\)\.map/.test(insightsSource));

// ============================================================
// 2. DB3 never recreates DB1's interpretation logic in React (same
// discipline as DB2's own card)
// ============================================================

check('2. InsightsDailyBriefingSection never imports from packages/vedic', !/packages\/vedic/.test(sectionSource));
check('2. it never defines its own favorable-house table literal', !/\[2,\s*4,\s*6,\s*8,\s*10,\s*11\]/.test(sectionSource) && !/\[3,\s*6,\s*10,\s*11\]/.test(sectionSource));
check('2. every narrative field is read directly off the fetched briefing (dailyTheme/career/finance/focus/beMindful), never locally composed', /briefing\.dailyTheme/.test(sectionSource) && /briefing\.career/.test(sectionSource) && /briefing\.finance/.test(sectionSource) && /briefing\.focus/.test(sectionSource) && /briefing\.beMindful/.test(sectionSource));
check('2. evidence explanations render DB1\'s own `.summary` strings, never a raw evidence object/JSON', /e\.summary/.test(sectionSource) && !/JSON\.stringify\(.*evidence/.test(sectionSource));
check('2. it imports its types from the DB1 engine module itself (apps/web/lib/dailyAstroBriefing), not a redeclared shape', /import type \{ AstroDailyBriefing, GocharEvidenceRef \} from '\.\.\/lib\/dailyAstroBriefing';/.test(sectionSource));

// ============================================================
// 3. API route extension: backward compatible, bounded, documented
// ============================================================

const routeSource = fs.readFileSync('apps/web/app/api/daily-briefing/today/route.ts', 'utf8');
check('3. the route still has exactly one GET export (no second/parallel historical endpoint)', (routeSource.match(/export async function GET/g) || []).length === 1);
check('3. no ?date= resolves to the exact SAME "today" behavior as DB2 (resolveTodayLocalDate, unconditionally when rawDate is falsy)', /if \(!rawDate\) return \{ status: 'OK', localDate: today \};/.test(routeSource));
check('3. the historical range bound is a named, documented constant (not a magic number inline)', /const MAX_HISTORICAL_DAYS_BACK = 7;/.test(routeSource));
check('3. date validation uses the SAME isValidCalendarDateString DB1 itself uses (no second, redefined validator)', /isValidCalendarDateString\(rawDate\)/.test(routeSource));
check('3. transits.ts is still never imported by this route', !/transits/.test(routeSource));

// ============================================================
// 4. Today/Yesterday navigation
// ============================================================

check('4. a Today/Yesterday SegmentedControl exists with exactly those two options', /value: 'TODAY', label: 'Today'/.test(sectionSource) && /value: 'YESTERDAY', label: 'Yesterday'/.test(sectionSource));
check('4. no full calendar/arbitrary-date browser was built (no <input type="date"> or month-grid UI in this file)', !/type="date"/.test(sectionSource) && !/CalendarGrid|MonthView|DatePicker/i.test(sectionSource));
check('4. yesterday\'s briefing explicitly disclaims being a record of what actually happened', /not a record of what actually happened/.test(sectionSource));

// ============================================================
// 5. Evidence / "Why this guidance?" explanation
// ============================================================

check('5. a per-section expandable "Why this guidance?" control exists', /Why this guidance\? →/.test(sectionSource));
check('5. the rule version is shown alongside the evidence (traceability, not hidden)', /Interpretation rule: \{relevant\[0\]\.ruleVersion\}/.test(sectionSource));
check('5. evidence is filtered by category per section (Career only shows CAREER evidence, etc.) -- never showing unrelated evidence under the wrong heading', /evidence\.filter\(\(e\) => e\.category === category\)/.test(sectionSource));

// ============================================================
// 6. Missing-profile / error states reuse existing patterns
// ============================================================

check('6. the incomplete-profile CTA reuses the EXACT same copy as DB2\'s Home card (consistent product voice)', /Add your birth details to see your personalized daily briefing\./.test(sectionSource));
check('6. the incomplete-profile CTA links through onOpenBirthProfile (no duplicate onboarding flow invented)', /onOpenBirthProfile && \(/.test(sectionSource) && /onClick=\{onOpenBirthProfile\}/.test(sectionSource));
check('6. a retry affordance exists for the error state', /setRetryKey\(\(k\) => k \+ 1\)/.test(sectionSource));
check('6. the loading state uses role="status" + ariaLive="polite" (accessible, no silent layout shift)', /role="status" ariaLive="polite"/.test(sectionSource));
check('6. the error state uses role="alert"', /role="alert"/.test(sectionSource));

// ============================================================
// 7. Async safety -- closure-based cancellation (DB2's own proven
// pattern), with selectedDate added as a dependency
// ============================================================

check('7. the fetch effect declares `cancelled` FRESH inside its own body on every invocation (the exact closure shape DB2\'s review independently proved race-safe)', /let cancelled = false;/.test(sectionSource));
check('7. the effect checks `cancelled` before EVERY state commit (briefing fetch AND the yesterday-only reflection fetch)', (sectionSource.match(/if \(cancelled\) return;/g) || []).length >= 3);
check('7. the effect\'s own dependency array includes selectedDate alongside userId/timezone/retryKey (a date-selection change invalidates an in-flight request, the same as a user/timezone change)', /\[userId, timezone, selectedDate, retryKey\]/.test(sectionSource));
check('7. cleanup sets cancelled=true (unmount AND every dependency-change-triggered re-run)', /cancelled = true;/.test(sectionSource));

// ============================================================
// 8. Reflection integration
// ============================================================

check('8. the reflection fetch reuses the EXISTING, unmodified GET /api/daily-assistant/reflection?date= route (no new reflection storage/endpoint)', /fetch\(`\/api\/daily-assistant\/reflection\?date=\$\{data\.briefing\.localDate\}`\)/.test(sectionSource));
check('8. the reflection is only ever fetched for YESTERDAY, never today (today has no "record" to show yet)', /if \(selectedDate === 'YESTERDAY'\) \{[\s\S]{0,400}reflection\?date=/.test(sectionSource));
check('8. the reflection is rendered in its own, separately labeled section ("Your reflection"), visually distinct from the traditional interpretation above it', /Your reflection/.test(sectionSource));
check('8. the reflection section explicitly frames itself as the user\'s own record, not part of the traditional interpretation', /not part of the traditional interpretation/.test(sectionSource));

// ============================================================
// 9. page.tsx / InsightsView wiring
// ============================================================

check('9. page.tsx threads the real session user\'s id through to InsightsView', /<InsightsView\s*\n\s*userId=\{user\?\.id\}/.test(pageSource));
check('9. page.tsx wires onOpenBirthProfile to the SAME existing Birth Chart navigation used elsewhere (setActiveTab(\'chart\'))', /onOpenBirthProfile=\{\(\) => setActiveTab\('chart'\)\}/.test(pageSource));
check('9. InsightsViewProps gained userId/onOpenBirthProfile as purely ADDITIVE optional props (existing required timezone prop untouched)', /userId\?:\s*string;/.test(insightsSource) && /onOpenBirthProfile\?:\s*\(\) => void;/.test(insightsSource) && /timezone: string;/.test(insightsSource));

if (!allPassed) { console.error('SOME DB3 INSIGHTS STRUCTURAL CHECKS FAILED'); process.exit(1); }
console.log('ALL DB3 INSIGHTS STRUCTURAL CHECKS PASSED');
process.exit(0);
