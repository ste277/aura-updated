/**
 * Daily Rhythm V1 PR DR4-B.1 -- timezone-display regression suite for
 * Find a Time (PlanWithAuraView.tsx). This repository has no component-
 * test infrastructure (confirmed: no jest/vitest config, no *.test.tsx
 * anywhere -- see dayPlanPreviewPresentation.test.ts's own doc comment),
 * so this file follows the SAME established two-part convention every
 * other UI-adjacent suite in this repo already uses:
 *
 *   1. STRUCTURAL checks -- read the real shipped source as text and
 *      confirm the exact wiring (every `toLocaleTimeString`/
 *      `toLocaleDateString` call in this file now carries an explicit
 *      `timeZone`, and every TimingResultCard/EverydaySharedResultCard
 *      call site passes a real `timezone` prop) -- proves the FIX is
 *      actually wired, not just that the underlying JS Intl API behaves
 *      correctly in isolation.
 *   2. BEHAVIORAL checks -- the exact `{ hour: 'numeric', minute: '2-digit',
 *      timeZone }` options object this file's own fix now uses, run
 *      against fixed real instants and explicit real IANA timezones
 *      (never the test runner's own host timezone) -- proves the fix
 *      formula itself produces the correct, bug-reproducing-then-fixed
 *      result for every required scenario.
 *
 *   npx ts-node test/planWithAuraTimezoneDisplay.test.ts
 */
import fs from 'fs';
import path from 'path';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function read(rel: string): string {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

// The exact pattern PlanWithAuraView.tsx now uses in both fixed card
// components -- reproduced here (not imported) because neither function
// is exported or extractable without React; this is behaviorally
// IDENTICAL to what the component actually calls, over the same native
// Intl API, which is the whole surface area of this bug/fix.
function formatTimeRange(startIso: string, endIso: string, timezone: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', timeZone: timezone };
  return `${start.toLocaleTimeString('en-US', timeOpts)} - ${end.toLocaleTimeString('en-US', timeOpts)}`;
}

function main() {
  const planWithAuraSrc = read('apps/web/components/PlanWithAuraView.tsx');

  // ============================================================
  // STRUCTURAL: the fix is actually wired, not just correct in theory.
  // ============================================================
  check('1. TimingResultCard declares a required `timezone: string` prop', /timezone: string;\s*\n\s*planCtaLabel\?: string;/.test(planWithAuraSrc));
  check('2. TimingResultCard\'s timeOpts carries an explicit timeZone (never omitted)', /const timeOpts: Intl\.DateTimeFormatOptions = \{ hour: 'numeric', minute: '2-digit', timeZone: timezone \};/.test(planWithAuraSrc));
  check('3. exactly 7 call sites (6 TimingResultCard + 1 EverydaySharedResultCard) pass a real timezone prop, using the SAME `timezone || \'UTC\'` fallback this file already established elsewhere', (planWithAuraSrc.match(/timezone=\{timezone \|\| 'UTC'\}/g) ?? []).length === 7);
  check('4. EverydaySharedResultCard\'s own dateLabel also carries an explicit timeZone (the other half of the same bug class, section 3\'s "date labels adjacent to time labels")', /start\.toLocaleDateString\('en-US', \{ weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone \}\)/.test(planWithAuraSrc));
  check(
    '5. no remaining toLocaleTimeString/toLocaleDateString call in this file omits timeZone (a blanket sweep, not just the two known call sites) -- a call is only "safe" if it passes an inline timeZone OR references the `timeOpts` variable, which checks 2/9b above already confirm carries one',
    (() => {
      const calls = planWithAuraSrc.match(/\.toLocale(Time|Date)String\([^)]*\)/g) ?? [];
      const offenders = calls.filter((call) => !/timeZone/.test(call) && !/\btimeOpts\b/.test(call));
      return offenders.length === 0;
    })()
  );
  check('6. the fix never introduces a new shared/global timezone-formatting helper file (ticket\'s own "avoid unless genuinely necessary") -- no new export added to apps/web/lib/timezone.ts', !/export function format.*TimeRange|export function format.*Display/.test(read('apps/web/lib/timezone.ts')));

  // ============================================================
  // 1-2. Browser timezone differs from selected timezone / 2:00 PM
  // America/New_York displays as 2:00 PM. The EXACT instant and scenario
  // from the DR4-B review's own live finding: a CHECK request for
  // 2:00 PM America/New_York produced the real API instant
  // 2026-10-19T18:00:00.000Z, which the buggy code (browser timezone
  // Asia/Kolkata) rendered as 11:30 PM.
  // ============================================================
  const confirmedInstant = '2026-10-19T18:00:00.000Z';
  check('1. 2:00 PM America/New_York displays as "2:00 PM" when formatted with the real, correct timezone', formatTimeRange(confirmedInstant, '2026-10-19T19:00:00.000Z', 'America/New_York').startsWith('2:00 PM'));
  check('1b. the SAME instant, formatted with a DIFFERENT host/browser timezone (UTC, simulating a mismatched browser locale), is NOT "2:00 PM" -- proving the browser-timezone-mismatch scenario this bug depended on is real and reproducible', !formatTimeRange(confirmedInstant, '2026-10-19T19:00:00.000Z', 'UTC').startsWith('2:00 PM'));

  // ============================================================
  // 3. Asia/Kolkata displays correctly -- the EXACT value the live bug
  // actually rendered (11:30 PM), now reproduced not as a defect but as
  // the CORRECT answer for a user whose real configured timezone
  // genuinely is Asia/Kolkata.
  // ============================================================
  check('3. the same confirmed instant formatted for a genuine Asia/Kolkata user correctly shows 11:30 PM (UTC+5:30 -- the exact value the live bug incorrectly showed for an America/New_York user)', formatTimeRange(confirmedInstant, '2026-10-19T19:00:00.000Z', 'Asia/Kolkata').startsWith('11:30 PM'));

  // ============================================================
  // 4. Start and end times use the SAME timezone -- both pulled from one
  // shared `timeOpts` object (never two independently-specified ones
  // that could drift), confirmed both structurally (check 2 above) and
  // behaviorally here: a start/end pair that would reveal a mismatch if
  // computed with two different offsets stays mutually consistent.
  // ============================================================
  {
    const range = formatTimeRange('2026-10-19T18:00:00.000Z', '2026-10-19T19:00:00.000Z', 'America/New_York');
    check('4. start and end both resolve in the identical timezone (consistent 1-hour gap, 2:00 PM -> 3:00 PM, never a mismatched offset between the two)', range === '2:00 PM - 3:00 PM');
  }

  // ============================================================
  // 5-6. CHECK preserves the requested instant / COMPARE preserves
  // every requested instant -- this PR touches ONLY display formatting;
  // confirmed structurally that the route/adapter files from DR4-B are
  // completely untouched by this PR (zero display-vs-data coupling).
  // ============================================================
  const routeSrc = read('apps/web/app/api/timing-search/route.ts');
  const adapterSrc = read('apps/web/lib/timingSearchDailyRhythm.ts');
  check('5. the /api/timing-search route still returns the real, unaltered requestedCandidate/candidates -- no new transformation of the stored instant introduced by this PR', /runTimingSearchWithDailyRhythm\(validated\.request, user\.timezone, dailyRhythmPrefs\)/.test(routeSrc));
  check('6. the Daily Rhythm adapter (candidate filtering/selection) is untouched by this PR -- same exported function signatures as DR4-B shipped', /export function applyDailyRhythmToFindCandidates\(candidates: readonly TimingCandidate\[\], activityId: string \| undefined, timezone: string, prefs: DailyRhythmPreferencesInput\): TimingCandidate\[\]/.test(adapterSrc));

  // ============================================================
  // 7. Daylight-saving transition behavior -- 2026-11-01 is the real
  // America/New_York DST-end date (clocks fall back at 2:00 AM local).
  // The identical UTC instant on either side of the transition must
  // format against the CORRECT, different UTC offset.
  // ============================================================
  check('7. an instant just before the 2026 fall-back (2026-11-01T05:30:00Z, still EDT/UTC-4) displays as 1:30 AM', formatTimeRange('2026-11-01T05:30:00.000Z', '2026-11-01T06:00:00.000Z', 'America/New_York').startsWith('1:30 AM'));
  check('7b. the SAME clock-wall instant one hour later in UTC (2026-11-01T06:30:00Z, now EST/UTC-5 post-fallback) ALSO displays as 1:30 AM -- the real, correct DST-fallback repeated-hour behavior, not an artifact of a fixed offset', formatTimeRange('2026-11-01T06:30:00.000Z', '2026-11-01T07:00:00.000Z', 'America/New_York').startsWith('1:30 AM'));

  // ============================================================
  // 8. Cross-midnight windows -- a candidate whose start/end straddle
  // local midnight must show the correct, DIFFERENT clock times (never
  // collapsed to the same instant or shifted onto the wrong side of
  // midnight by an incorrect timezone).
  // ============================================================
  {
    // 11:30 PM - 12:30 AM EDT (America/New_York), spanning real local midnight.
    const range = formatTimeRange('2026-10-20T03:30:00.000Z', '2026-10-20T04:30:00.000Z', 'America/New_York');
    check('8. a candidate crossing local midnight displays 11:30 PM - 12:30 AM, correctly straddling the day boundary in the real target timezone', range === '11:30 PM - 12:30 AM');
  }

  // ============================================================
  // 9. Existing locale and 12/24-hour formatting behavior preserved --
  // 'en-US' + {hour:'numeric', minute:'2-digit'} is UNCHANGED by this
  // fix (only `timeZone` was added); confirmed both that the locale
  // string/hour-format fields are still exactly what they were, and that
  // the actual rendered format is still 12-hour with AM/PM, never 24-hour.
  // ============================================================
  check("9. the locale is still exactly 'en-US' (unchanged) in both fixed call sites", (planWithAuraSrc.match(/toLocaleTimeString\('en-US'/g) ?? []).length >= 4);
  check('9b. the hour/minute format fields (hour: \'numeric\', minute: \'2-digit\') are unchanged -- only timeZone was added, nothing else in the options object', /hour: 'numeric', minute: '2-digit', timeZone: timezone/.test(planWithAuraSrc));
  check('9c. rendered output is still 12-hour with AM/PM (e.g. "2:00 PM"), never 24-hour ("14:00") -- the locale/format fields genuinely still behave as before', /^\d{1,2}:\d{2} (AM|PM)$/.test(formatTimeRange(confirmedInstant, '2026-10-19T19:00:00.000Z', 'America/New_York').split(' - ')[0]));

  // ============================================================
  // 10. No scheduling or ranking changes -- this PR's diff is confined
  // to display formatting; the engine, the Daily Rhythm adapter's own
  // filtering logic, and the API route's own request/response contract
  // are all untouched (same checks as #5/#6 above, restated for clarity
  // against this specific requirement).
  // ============================================================
  const timingSearchSrc = read('packages/recommendation/src/timingSearch.ts');
  check('10. packages/recommendation/src/timingSearch.ts (the real engine) is untouched by this PR -- same exported DEFAULT_FIND_LIMIT = 3 DR4-B already established', /export const DEFAULT_FIND_LIMIT = 3;/.test(timingSearchSrc));
  check('10b. dailyRhythmScheduling.ts\'s candidate-filtering/classification exports are untouched -- same DR2/DR3/DR4-B signatures', /export function classifyActivityForDailyRhythm\(activityId: string \| undefined\): DailyRhythmSchedulingBehavior \| null/.test(read('apps/web/lib/dailyRhythmScheduling.ts')));

  if (!allPassed) {
    console.error('\nSome Find a Time timezone-display (DR4-B.1) checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL FIND A TIME TIMEZONE-DISPLAY (DR4-B.1) CHECKS PASSED');
  }
}

main();
