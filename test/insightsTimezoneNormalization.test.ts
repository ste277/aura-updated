/**
 * Insights Timezone Consistency V1: regression suite for the shared
 * normalization primitives in apps/web/lib/insightsTimezone.ts
 * (toInsightsObservation, classifyDayPart, todayDateKey,
 * lastNCalendarDateKeys, isInCalendarMonth) and the addDaysToDateStr()
 * calendar-stepping helper apps/web/lib/timezone.ts moved from its
 * original private home in myDayOrchestrator.ts (Insights Timezone
 * Consistency V1's own audit, section 22). These are the primitives every
 * Insights calendar/daypart calculation (InsightsView.tsx, the reflection/
 * log join in the insights route) now goes through instead of
 * browser-local `new Date().getFullYear()/getHours()` getters or UTC
 * `.toISOString().slice(0,10)` slicing.
 *
 * No new Panchang/solar math is involved -- everything here composes the
 * pre-existing, already-tested getDatePartsInTimezone()/
 * getMinuteOfDayInTimezone()/resolveTzOffsetMinutes() primitives (see
 * test/timezone.test.ts, test/panchangDay.test.ts for their own direct
 * coverage).
 */
import * as fs from 'fs';
import {
  toInsightsObservation,
  classifyDayPart,
  todayDateKey,
  lastNCalendarDateKeys,
  isInCalendarMonth,
} from '../apps/web/lib/insightsTimezone';
import { addDaysToDateStr } from '../apps/web/lib/timezone';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// Daypart boundary classification -- exact clock-minute boundaries
// (unchanged from the pre-existing InsightsView.tsx hour buckets:
// morning [5,12), afternoon [12,17), evening [17,22), night otherwise).
// ============================================================

check('04:59 (minute 299) -> NIGHT', classifyDayPart(299) === 'NIGHT');
check('05:00 (minute 300) -> MORNING', classifyDayPart(300) === 'MORNING');
check('11:59 (minute 719) -> MORNING', classifyDayPart(719) === 'MORNING');
check('12:00 (minute 720) -> AFTERNOON', classifyDayPart(720) === 'AFTERNOON');
check('16:59 (minute 1019) -> AFTERNOON', classifyDayPart(1019) === 'AFTERNOON');
check('17:00 (minute 1020) -> EVENING', classifyDayPart(1020) === 'EVENING');
check('21:59 (minute 1319) -> EVENING', classifyDayPart(1319) === 'EVENING');
check('22:00 (minute 1320) -> NIGHT', classifyDayPart(1320) === 'NIGHT');
check('00:00 (minute 0) -> NIGHT (wraps past midnight)', classifyDayPart(0) === 'NIGHT');
check('23:59 (minute 1439) -> NIGHT', classifyDayPart(1439) === 'NIGHT');

// ============================================================
// Asia/Kolkata (UTC+5:30, non-DST control) -- UTC crossover correctness.
// 00:30 IST on 2026-09-05 is 2026-09-04T19:00:00Z (the PREVIOUS UTC
// calendar day) -- must still resolve to the correct IST date, not the
// UTC date.
// ============================================================

const kolkataJustAfterMidnight = toInsightsObservation(new Date('2026-09-04T19:00:00.000Z'), 'Asia/Kolkata');
check('Asia/Kolkata 00:30 IST (2026-09-04T19:00:00Z, previous UTC day) belongs to IST date 2026-09-05, not UTC date 2026-09-04', kolkataJustAfterMidnight.dateKey === '2026-09-05');
check('Asia/Kolkata 00:30 IST -> minuteOfDay 30', kolkataJustAfterMidnight.minuteOfDay === 30);
check('Asia/Kolkata 00:30 IST -> NIGHT daypart', kolkataJustAfterMidnight.dayPart === 'NIGHT');

const kolkataJustBeforeMidnight = toInsightsObservation(new Date('2026-09-05T18:29:00.000Z'), 'Asia/Kolkata');
check('Asia/Kolkata 23:59 IST (2026-09-05T18:29:00Z) still belongs to IST date 2026-09-05', kolkataJustBeforeMidnight.dateKey === '2026-09-05');
check('Asia/Kolkata 23:59 IST -> minuteOfDay 1439', kolkataJustBeforeMidnight.minuteOfDay === 1439);

// ============================================================
// Half-hour offset correctness (India is UTC+05:30, not a whole-hour
// offset) -- a 30-minute-resolution instant lands on the exact expected
// minute, proving no whole-hour-offset assumption anywhere in the chain.
// ============================================================

const halfHourCase = toInsightsObservation(new Date('2026-09-05T06:15:00.000Z'), 'Asia/Kolkata'); // 11:45 IST
check('Half-hour offset: 2026-09-05T06:15:00Z in Asia/Kolkata is 11:45 IST (minuteOfDay 705), not off by 30 minutes', halfHourCase.minuteOfDay === 705);
check('Half-hour offset: dateKey unaffected (still 2026-09-05)', halfHourCase.dateKey === '2026-09-05');
check('Half-hour offset: 11:45 IST -> MORNING daypart (< 12:00)', halfHourCase.dayPart === 'MORNING');

// ============================================================
// America/New_York DST spring-forward (2026-03-08, 2:00am -> 3:00am
// local -- the 2:00-2:59am hour never occurs). Verified against real
// resolveTzOffsetMinutes()/getMinuteOfDayInTimezone() output.
// ============================================================

const nyPreSpringForward = toInsightsObservation(new Date('2026-03-08T06:30:00.000Z'), 'America/New_York'); // 01:30 EST
check('NY spring-forward: 2026-03-08T06:30:00Z (01:30 EST, before transition) -> minuteOfDay 90', nyPreSpringForward.minuteOfDay === 90);
check('NY spring-forward: dateStr is 2026-03-08', nyPreSpringForward.dateKey === '2026-03-08');

const nyPostSpringForward = toInsightsObservation(new Date('2026-03-08T07:30:00.000Z'), 'America/New_York'); // 03:30 EDT (2am-3am skipped)
check('NY spring-forward: 2026-03-08T07:30:00Z (03:30 EDT, after the skipped hour) -> minuteOfDay 210, not 150', nyPostSpringForward.minuteOfDay === 210);
check('NY spring-forward: still the same calendar date 2026-03-08 across the transition', nyPostSpringForward.dateKey === '2026-03-08');

// ============================================================
// America/New_York DST fall-back (2026-11-01, 2:00am -> 1:00am local --
// the 1:00-1:59am hour occurs twice). Two DIFFERENT UTC instants both
// correctly resolve to the same wall-clock reading -- an inherent, correct
// property of a fall-back transition, not a bug in this code.
// ============================================================

const nyFallBackFirstPass = toInsightsObservation(new Date('2026-11-01T05:30:00.000Z'), 'America/New_York'); // 01:30 EDT (first occurrence)
const nyFallBackSecondPass = toInsightsObservation(new Date('2026-11-01T06:30:00.000Z'), 'America/New_York'); // 01:30 EST (second occurrence, repeated hour)
check('NY fall-back: both the pre- and post-transition instants correctly read local 01:30 (minuteOfDay 90) -- the repeated hour is handled, not skipped or double-counted incorrectly', nyFallBackFirstPass.minuteOfDay === 90 && nyFallBackSecondPass.minuteOfDay === 90);
check('NY fall-back: both instants stay on calendar date 2026-11-01', nyFallBackFirstPass.dateKey === '2026-11-01' && nyFallBackSecondPass.dateKey === '2026-11-01');

const nyPostFallBack = toInsightsObservation(new Date('2026-11-01T07:30:00.000Z'), 'America/New_York'); // 02:30 EST
check('NY fall-back: 2026-11-01T07:30:00Z (02:30 EST, after the repeated hour) -> minuteOfDay 150', nyPostFallBack.minuteOfDay === 150);

// ============================================================
// Browser/process timezone independence -- identical (instant, timezone)
// inputs must produce identical output regardless of the executing
// process's own TZ.
// ============================================================

const originalTz = process.env.TZ;
try {
  const fixedInstant = new Date('2026-09-05T06:15:00.000Z');
  process.env.TZ = 'America/Los_Angeles';
  const resultLA = toInsightsObservation(fixedInstant, 'Asia/Kolkata');
  process.env.TZ = 'Pacific/Auckland';
  const resultAuckland = toInsightsObservation(fixedInstant, 'Asia/Kolkata');
  process.env.TZ = 'Asia/Kolkata';
  const resultKolkata = toInsightsObservation(fixedInstant, 'Asia/Kolkata');
  check(
    'toInsightsObservation is fully independent of process.env.TZ -- identical dateKey/minuteOfDay/dayPart across America/Los_Angeles, Pacific/Auckland, and Asia/Kolkata process TZs',
    resultLA.dateKey === resultAuckland.dateKey && resultAuckland.dateKey === resultKolkata.dateKey &&
    resultLA.minuteOfDay === resultAuckland.minuteOfDay && resultAuckland.minuteOfDay === resultKolkata.minuteOfDay &&
    resultLA.dayPart === resultAuckland.dayPart && resultAuckland.dayPart === resultKolkata.dayPart
  );
} finally {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
}

// ============================================================
// todayDateKey / padded YYYY-MM-DD shape.
// ============================================================

check('todayDateKey returns a padded YYYY-MM-DD string', /^\d{4}-\d{2}-\d{2}$/.test(todayDateKey('Asia/Kolkata', new Date('2026-01-05T12:00:00.000Z'))));
check('todayDateKey pads single-digit month/day (2026-01-05, not 2026-1-5)', todayDateKey('Asia/Kolkata', new Date('2026-01-05T12:00:00.000Z')) === '2026-01-05');

// ============================================================
// lastNCalendarDateKeys -- exactly N calendar dates ending today
// (inclusive), oldest first, DST-safe date-string stepping.
// ============================================================

const seven = lastNCalendarDateKeys('Asia/Kolkata', new Date('2026-09-05T12:00:00.000Z'), 7);
check('lastNCalendarDateKeys(count=7) returns exactly 7 entries', seven.length === 7);
check('lastNCalendarDateKeys(count=7) ends with today (2026-09-05)', seven[6] === '2026-09-05');
check('lastNCalendarDateKeys(count=7) starts 6 days before today (2026-08-30)', seven[0] === '2026-08-30');
check('lastNCalendarDateKeys(count=7) is ordered oldest-to-newest with no gaps', seven.every((k, i) => i === 0 || addDaysToDateStr(seven[i - 1], 1) === k));

const thirty = lastNCalendarDateKeys('Asia/Kolkata', new Date('2026-09-05T12:00:00.000Z'), 30);
check('lastNCalendarDateKeys(count=30) returns exactly 30 entries', thirty.length === 30);
check('lastNCalendarDateKeys(count=30) ends with today (2026-09-05)', thirty[29] === '2026-09-05');
check('lastNCalendarDateKeys(count=30) starts 29 days before today (2026-08-07)', thirty[0] === '2026-08-07');

// DST-safety: a 30-day window spanning the actual 2026 US fall-back
// transition (2026-11-01) still yields exactly 30 unique, gap-free calendar
// dates in America/New_York -- proving the stepping is real-calendar-day
// based, not a 24h-millisecond approximation that could skip/duplicate a
// day across the transition.
const acrossDst = lastNCalendarDateKeys('America/New_York', new Date('2026-11-10T12:00:00.000Z'), 30);
check('lastNCalendarDateKeys across a real DST fall-back transition still returns exactly 30 unique dates', new Set(acrossDst).size === 30);
check('lastNCalendarDateKeys across DST is still gap-free/ordered', acrossDst.every((k, i) => i === 0 || addDaysToDateStr(acrossDst[i - 1], 1) === k));

// ============================================================
// isInCalendarMonth -- month/year boundary correctness.
// ============================================================

check('isInCalendarMonth: a date in the target month/year matches', isInCalendarMonth('2026-09-15', 2026, 9));
check('isInCalendarMonth: a date in the previous month does not match', !isInCalendarMonth('2026-08-31', 2026, 9));
check('isInCalendarMonth: a date in the next month does not match', !isInCalendarMonth('2026-10-01', 2026, 9));
check('isInCalendarMonth: year boundary -- December of the previous year does not match January of the target year', !isInCalendarMonth('2025-12-31', 2026, 1));
check('isInCalendarMonth: year boundary -- January 1st of the target year matches', isInCalendarMonth('2026-01-01', 2026, 1));

// ============================================================
// addDaysToDateStr -- moved from myDayOrchestrator.ts's own private
// implementation (Insights Timezone Consistency V1, audit section 22) to
// apps/web/lib/timezone.ts, now shared. Confirm the move preserved
// behavior exactly and myDayOrchestrator.ts imports the shared version
// rather than keeping its own private copy.
// ============================================================

check('addDaysToDateStr steps forward correctly', addDaysToDateStr('2026-02-27', 3) === '2026-03-02');
check('addDaysToDateStr steps backward correctly (negative days)', addDaysToDateStr('2026-03-02', -3) === '2026-02-27');
check('addDaysToDateStr handles a leap-year February correctly (2028 is a leap year)', addDaysToDateStr('2028-02-28', 1) === '2028-02-29');
check('addDaysToDateStr handles a non-leap-year February correctly (2026 is not a leap year)', addDaysToDateStr('2026-02-28', 1) === '2026-03-01');
check('addDaysToDateStr handles a year boundary', addDaysToDateStr('2026-12-31', 1) === '2027-01-01');

const orchestratorSource = fs.readFileSync('apps/web/lib/myDayOrchestrator.ts', 'utf8');
check('myDayOrchestrator.ts no longer declares its own private addDaysToDateStr (imports the shared one from timezone.ts instead)', !/function addDaysToDateStr/.test(orchestratorSource));
check('myDayOrchestrator.ts imports addDaysToDateStr from ./timezone', /import\s*\{[^}]*addDaysToDateStr[^}]*\}\s*from\s*'\.\/timezone'/.test(orchestratorSource));

console.log(allPassed ? '\nALL INSIGHTS TIMEZONE NORMALIZATION CHECKS PASSED' : '\nSOME INSIGHTS TIMEZONE NORMALIZATION CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
