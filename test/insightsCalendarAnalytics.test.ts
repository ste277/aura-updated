/**
 * Insights Timezone Consistency V1: regression suite for InsightsView.tsx's
 * calendar-day analytics -- the streak walk, the "This Month" filter, and
 * the 7-day/30-day day-bucketing -- now that all three are built entirely
 * from apps/web/lib/insightsTimezone.ts's exported primitives instead of
 * browser-local `new Date().getFullYear()/getMonth()/getDate()` getters.
 *
 * InsightsView.tsx is a 'use client' JSX component and can't be imported
 * directly by a plain ts-node test (no React/DOM runtime here, matching
 * this repo's established pattern -- see test/eventLocationAuraMomentPersistence.test.ts's
 * own doc comment). Its streak/This-Month logic is therefore replicated
 * here EXACTLY as implemented (built from the same real, already-tested
 * insightsTimezone.ts primitives, never reimplemented independently), with
 * a source-scan cross-check at the bottom confirming the live component
 * still calls those same primitives and contains no leftover browser-local
 * date getters.
 */
import * as fs from 'fs';
import { toInsightsObservation, todayDateKey, lastNCalendarDateKeys, isInCalendarMonth } from '../apps/web/lib/insightsTimezone';
import { addDaysToDateStr } from '../apps/web/lib/timezone';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

interface FakeEntry {
  id: string;
  loggedAt: Date;
}

function fakeEntry(id: string, iso: string): FakeEntry {
  return { id, loggedAt: new Date(iso) };
}

// Exact replica of InsightsView.tsx's streak walk (apps/web/components/InsightsView.tsx).
function computeStreak(entries: FakeEntry[], timezone: string, now: Date): number {
  const loggedDaysSet = new Set(entries.map((entry) => toInsightsObservation(entry.loggedAt, timezone).dateKey));
  let streak = 0;
  let cursor = todayDateKey(timezone, now);
  while (true) {
    if (loggedDaysSet.has(cursor)) {
      streak++;
      cursor = addDaysToDateStr(cursor, -1);
    } else {
      if (streak === 0) {
        const yesterday = addDaysToDateStr(cursor, -1);
        if (loggedDaysSet.has(yesterday)) {
          streak++;
          cursor = addDaysToDateStr(yesterday, -1);
          continue;
        }
      }
      break;
    }
  }
  return streak;
}

// Exact replica of InsightsView.tsx's "This Month" filter.
function monthEntriesOf(entries: FakeEntry[], timezone: string, now: Date): FakeEntry[] {
  const todayKey = todayDateKey(timezone, now);
  const [currentYear, currentMonth] = todayKey.split('-').map(Number);
  return entries.filter((e) => isInCalendarMonth(toInsightsObservation(e.loggedAt, timezone).dateKey, currentYear, currentMonth));
}

// Exact replica of InsightsView.tsx's 30-day heatmap / 7-day trend day-bucketing.
function dayBucketCounts(entries: FakeEntry[], timezone: string, now: Date, days: number): Record<string, number> {
  const keys = lastNCalendarDateKeys(timezone, now, days);
  const counts: Record<string, number> = {};
  for (const key of keys) {
    counts[key] = entries.filter((e) => toInsightsObservation(e.loggedAt, timezone).dateKey === key).length;
  }
  return counts;
}

const TZ = 'Asia/Kolkata';
const NOW = new Date('2026-09-05T12:00:00.000Z'); // 17:30 IST, 2026-09-05

// ============================================================
// Streak -- basic consecutive days.
// ============================================================

const threeInARow = [
  fakeEntry('a', '2026-09-05T10:00:00.000Z'), // today (15:30 IST)
  fakeEntry('b', '2026-09-04T10:00:00.000Z'), // yesterday
  fakeEntry('c', '2026-09-03T10:00:00.000Z'), // day before
];
check('Streak: 3 consecutive logged days (including today) -> streak of 3', computeStreak(threeInARow, TZ, NOW) === 3);

// ============================================================
// Streak -- today-empty grace preserved (a log yesterday, nothing today,
// still counts as an active 1-day streak, not broken).
// ============================================================

const todayEmptyGrace = [fakeEntry('a', '2026-09-04T10:00:00.000Z')]; // yesterday only
check('Streak: today has no log but yesterday does -> grace applies, streak = 1 (not broken to 0)', computeStreak(todayEmptyGrace, TZ, NOW) === 1);

const trueGap = [fakeEntry('a', '2026-09-02T10:00:00.000Z')]; // 3 days ago, real gap
check('Streak: a real gap (nothing today or yesterday) -> streak = 0', computeStreak(trueGap, TZ, NOW) === 0);

// ============================================================
// Streak across a month boundary -- must NOT be truncated at the boundary
// (brief section 14's explicit requirement).
// ============================================================

const acrossMonthBoundary = [
  fakeEntry('a', '2026-09-05T10:00:00.000Z'), // today, September
  fakeEntry('b', '2026-09-01T10:00:00.000Z'), // September
  fakeEntry('c', '2026-08-31T10:00:00.000Z'), // August (previous month)
  fakeEntry('d', '2026-08-30T10:00:00.000Z'), // August
];
// Fill the gap between 09-01 and 09-05 so this is a genuine unbroken run.
const fullRun = [
  ...acrossMonthBoundary,
  fakeEntry('e', '2026-09-02T10:00:00.000Z'),
  fakeEntry('f', '2026-09-03T10:00:00.000Z'),
  fakeEntry('g', '2026-09-04T10:00:00.000Z'),
];
check('Streak spanning a real month boundary (Aug 30 - Sep 5, unbroken) is NOT truncated at the boundary -> streak = 7', computeStreak(fullRun, TZ, NOW) === 7);

// ============================================================
// Streak -- browser/process timezone independence.
// ============================================================

const originalTz = process.env.TZ;
try {
  process.env.TZ = 'America/Los_Angeles';
  const streakLA = computeStreak(threeInARow, TZ, NOW);
  process.env.TZ = 'Pacific/Auckland';
  const streakAuckland = computeStreak(threeInARow, TZ, NOW);
  check('Streak computation is independent of process.env.TZ (identical result under America/Los_Angeles and Pacific/Auckland)', streakLA === 3 && streakAuckland === 3);
} finally {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
}

// ============================================================
// "This Month" filter -- current month counted, previous month and older
// excluded, even though all are well within the 400-day retrieval horizon.
// ============================================================

const mixedMonths = [
  fakeEntry('current-1', '2026-09-05T10:00:00.000Z'),
  fakeEntry('current-2', '2026-09-01T10:00:00.000Z'),
  fakeEntry('previous-month', '2026-08-31T10:00:00.000Z'),
  fakeEntry('much-older', '2026-01-15T10:00:00.000Z'),
];
const thisMonth = monthEntriesOf(mixedMonths, TZ, NOW);
check('"This Month" filter includes only the 2 current-month entries, excludes previous-month and much-older entries', thisMonth.length === 2 && thisMonth.every((e) => e.id.startsWith('current')));

// Year boundary: "This Month" in January must not include December of the
// previous year.
const januaryNow = new Date('2026-01-15T12:00:00.000Z');
const yearBoundaryEntries = [
  fakeEntry('jan', '2026-01-10T10:00:00.000Z'),
  fakeEntry('dec-prev-year', '2025-12-31T10:00:00.000Z'),
];
const januaryMonth = monthEntriesOf(yearBoundaryEntries, TZ, januaryNow);
check('"This Month" at a year boundary (January) excludes December of the previous year', januaryMonth.length === 1 && januaryMonth[0].id === 'jan');

// ============================================================
// 7-day / 30-day day-bucketing -- each log lands on the correct
// Timing-Location calendar date, not a UTC-shifted one.
// ============================================================

const bucketEntries = [
  fakeEntry('today', '2026-09-05T10:00:00.000Z'),
  fakeEntry('near-midnight-ist', '2026-09-04T19:00:00.000Z'), // 00:30 IST on 2026-09-05, previous UTC day
];
const sevenDayBuckets = dayBucketCounts(bucketEntries, TZ, NOW, 7);
check('7-day bucketing: both entries land on 2026-09-05 in Asia/Kolkata (the near-midnight-IST one crosses a UTC day boundary but not an IST one)', sevenDayBuckets['2026-09-05'] === 2);
check('7-day bucketing produces exactly 7 date-key buckets', Object.keys(sevenDayBuckets).length === 7);

const thirtyDayBuckets = dayBucketCounts(bucketEntries, TZ, NOW, 30);
check('30-day bucketing produces exactly 30 date-key buckets', Object.keys(thirtyDayBuckets).length === 30);
check('30-day bucketing also correctly places both entries on 2026-09-05', thirtyDayBuckets['2026-09-05'] === 2);

// ============================================================
// Source-scan cross-check: the live component actually uses these
// primitives, and no browser-local date getter remains for any
// timezone-sensitive classification.
// ============================================================

const viewSource = fs.readFileSync('apps/web/components/InsightsView.tsx', 'utf8');
check('InsightsView.tsx imports toInsightsObservation/todayDateKey/lastNCalendarDateKeys/isInCalendarMonth from lib/insightsTimezone', /from '\.\.\/lib\/insightsTimezone'/.test(viewSource) && /toInsightsObservation/.test(viewSource) && /todayDateKey/.test(viewSource) && /lastNCalendarDateKeys/.test(viewSource) && /isInCalendarMonth/.test(viewSource));
check('InsightsView.tsx imports addDaysToDateStr from lib/timezone', /addDaysToDateStr/.test(viewSource) && /from '\.\.\/lib\/timezone'/.test(viewSource));
check('InsightsView.tsx declares a `timezone` prop on InsightsViewProps', /timezone:\s*string;/.test(viewSource));
// Strip block (/** ... */) and line (// ...) comments before scanning for
// live code patterns -- several doc comments in this file legitimately
// mention `.getFullYear()`/`.getHours()` in PROSE to explain what changed,
// which must not be mistaken for surviving code usage.
const viewSourceNoComments = viewSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
check('InsightsView.tsx no longer reads .getFullYear()/.getMonth()/.getDate()/.getHours() on a log/now Date for classification (only the UTC-anchored, timezone-independent formatWeekdayLabel helper remains, which explicitly forces timeZone: \'UTC\')', !/\.get(FullYear|Month|Date|Hours)\(\)/.test(viewSourceNoComments.replace(/function formatWeekdayLabel[\s\S]*?\n\}/, '')));
check('InsightsView.tsx contains no raw 24*60*60*1000 millisecond-arithmetic date stepping', !/24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(viewSource));
check('page.tsx renders InsightsView with an explicit timezone prop sourced from user.timezone', /<InsightsView\s+timezone=\{user\.timezone\}/.test(fs.readFileSync('apps/web/app/page.tsx', 'utf8')));

console.log(allPassed ? '\nALL INSIGHTS CALENDAR ANALYTICS CHECKS PASSED' : '\nSOME INSIGHTS CALENDAR ANALYTICS CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
