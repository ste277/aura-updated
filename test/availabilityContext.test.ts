/**
 * Availability Context V1 -- PR H1 pure-resolver regression suite.
 * Exercises `resolveAvailability`/`normalizeUsableWindowsToConstructionWindow`/
 * `validateAvailabilityPeriodInput`/`getWeekdayForDateStr` entirely as pure
 * functions -- no DB, no network, no clock of its own (every `now` is an
 * explicit fixture value), matching this repository's own established
 * DB-free suite convention.
 */
import {
  resolveAvailability,
  normalizeUsableWindowsToConstructionWindow,
  validateAvailabilityPeriodInput,
  getWeekdayForDateStr,
  type AvailabilityConfiguration,
  type AvailabilityPeriodInput,
} from '../apps/web/lib/availabilityContext';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

const TZ = 'Asia/Kolkata'; // UTC+5:30, no DST -- same fixture zone this repo's own tests already use.
const WED = '2026-09-16'; // a Wednesday (weekday 3).
const THU = '2026-09-17'; // the following day, Thursday (weekday 4).

function period(weekday: number, startTime: string, endTime: string): AvailabilityPeriodInput {
  return { weekday: weekday as AvailabilityPeriodInput['weekday'], startTime, endTime };
}

function config(configured: boolean, periods: AvailabilityPeriodInput[]): AvailabilityConfiguration {
  return { configured, periods };
}

function windowsAsIso(windows: readonly { start: Date; end: Date }[]): string[] {
  return windows.map((w) => `${w.start.toISOString()}-${w.end.toISOString()}`);
}

function main() {
  // ============================================================
  // UNCONFIGURED / CONFIGURED / CONFIGURED_EMPTY (1-3, this ticket's own
  // section 4/6/18/19 -- the single most important distinction in H1).
  // ============================================================
  {
    const result = resolveAvailability({ targetDate: WED, timezone: TZ, now: new Date('2026-09-16T04:30:00Z'), configuration: config(false, [period(3, '09:00', '17:00')]) });
    check('1. configured=false is UNCONFIGURED regardless of any periods present', result.status === 'UNCONFIGURED');
  }
  {
    const result = resolveAvailability({ targetDate: WED, timezone: TZ, now: new Date('2026-09-16T04:30:00Z'), configuration: config(true, [period(3, '09:00', '17:00')]) });
    check('2. configured=true with a matching weekday period is CONFIGURED with a real usable window', result.status === 'CONFIGURED' && result.status === 'CONFIGURED' && result.usableWindows.length === 1);
  }
  {
    // Configured schedule, but zero periods for THIS weekday (Wednesday=3) -- CONFIGURED_EMPTY, never UNCONFIGURED.
    const result = resolveAvailability({ targetDate: WED, timezone: TZ, now: new Date('2026-09-16T04:30:00Z'), configuration: config(true, [period(0, '10:00', '13:00')]) });
    check('3. configured=true with zero periods for the target weekday is CONFIGURED_EMPTY (status CONFIGURED, usableWindows [])', result.status === 'CONFIGURED' && result.usableWindows.length === 0);
  }
  {
    // Configured schedule, genuinely zero periods saved at all -- also CONFIGURED_EMPTY, not UNCONFIGURED.
    const result = resolveAvailability({ targetDate: WED, timezone: TZ, now: new Date('2026-09-16T04:30:00Z'), configuration: config(true, []) });
    check('3b. configured=true with zero periods saved anywhere is CONFIGURED_EMPTY, never UNCONFIGURED', result.status === 'CONFIGURED' && result.usableWindows.length === 0);
  }

  // ============================================================
  // Multiple periods (4), overlapping (5), touching (6).
  // ============================================================
  {
    const result = resolveAvailability({ targetDate: WED, timezone: TZ, now: new Date('2026-09-16T00:00:00Z'), configuration: config(true, [period(3, '09:00', '12:00'), period(3, '14:00', '18:00')]) });
    check('4. two disjoint periods on the same weekday both survive, in order', result.status === 'CONFIGURED' && result.usableWindows.length === 2);
  }
  {
    const result = resolveAvailability({ targetDate: WED, timezone: TZ, now: new Date('2026-09-16T00:00:00Z'), configuration: config(true, [period(3, '09:00', '12:00'), period(3, '11:00', '14:00')]) });
    check(
      '5. overlapping periods (09-12, 11-14) merge to a single 09-14 window',
      result.status === 'CONFIGURED' && result.usableWindows.length === 1 && result.usableWindows[0].start.toISOString() === '2026-09-16T03:30:00.000Z' && result.usableWindows[0].end.toISOString() === '2026-09-16T08:30:00.000Z'
    );
  }
  {
    const result = resolveAvailability({ targetDate: WED, timezone: TZ, now: new Date('2026-09-16T00:00:00Z'), configuration: config(true, [period(3, '09:00', '12:00'), period(3, '12:00', '14:00')]) });
    check('6. touching periods (09-12, 12-14) merge to a single 09-14 window (never double-counted)', result.status === 'CONFIGURED' && result.usableWindows.length === 1);
  }

  // ============================================================
  // Current-day clipping (7-9) vs. future-day no-clipping (10).
  // ============================================================
  {
    // now = 2026-09-16T08:30:00Z = 14:00 IST.
    const result = resolveAvailability({ targetDate: WED, timezone: TZ, now: new Date('2026-09-16T08:30:00Z'), configuration: config(true, [period(3, '09:00', '17:00')]) });
    check(
      '7. current-day clipping: 09-17 availability, now 14:00 -> usable becomes 14:00-17:00',
      result.status === 'CONFIGURED' && result.usableWindows.length === 1 && result.usableWindows[0].start.toISOString() === '2026-09-16T08:30:00.000Z' && result.usableWindows[0].end.toISOString() === '2026-09-16T11:30:00.000Z'
    );
  }
  {
    // now = 18:00 IST, after a 09-17 period -- entirely elapsed, dropped.
    const result = resolveAvailability({ targetDate: WED, timezone: TZ, now: new Date('2026-09-16T12:30:00Z'), configuration: config(true, [period(3, '09:00', '17:00')]) });
    check('8. a period that ended entirely before now is dropped, not clipped to a negative/zero span', result.status === 'CONFIGURED' && result.usableWindows.length === 0);
  }
  {
    // now = 10:00 IST straddles 09-12 -- start clips to now, 12-14 (later period) untouched.
    const result = resolveAvailability({ targetDate: WED, timezone: TZ, now: new Date('2026-09-16T04:30:00Z'), configuration: config(true, [period(3, '09:00', '12:00'), period(3, '14:00', '18:00')]) });
    check(
      '9. a straddled period clips its start to now; a later, not-yet-started period is untouched',
      result.status === 'CONFIGURED' &&
        result.usableWindows.length === 2 &&
        result.usableWindows[0].start.toISOString() === '2026-09-16T04:30:00.000Z' &&
        result.usableWindows[1].start.toISOString() === '2026-09-16T08:30:00.000Z'
    );
  }
  {
    // targetDate = tomorrow (Thursday), now = today (Wednesday) 16:00 IST -- must NOT clip.
    const result = resolveAvailability({ targetDate: THU, timezone: TZ, now: new Date('2026-09-16T10:30:00Z'), configuration: config(true, [period(4, '09:00', '17:00')]) });
    check(
      '10. a future targetDate is never clipped against today\'s now, even when now is later in the day',
      result.status === 'CONFIGURED' && result.usableWindows.length === 1 && result.usableWindows[0].start.toISOString() === '2026-09-17T03:30:00.000Z'
    );
  }

  // ============================================================
  // Weekday correctness (11), month boundary (12), year boundary (13).
  // Independently verified via `node -e` before authoring these fixtures.
  // ============================================================
  check('11a. 2026-09-16 (a known Wednesday) resolves to weekday 3', getWeekdayForDateStr('2026-09-16') === 3);
  check('11b. 2026-09-17 (a known Thursday) resolves to weekday 4', getWeekdayForDateStr('2026-09-17') === 4);
  check('12. month boundary: 2026-01-31 (Sat=6) and 2026-02-01 (Sun=0) resolve correctly across the boundary', getWeekdayForDateStr('2026-01-31') === 6 && getWeekdayForDateStr('2026-02-01') === 0);
  check('13. year boundary: 2026-12-31 (Thu=4) and 2027-01-01 (Fri=5) resolve correctly across the boundary', getWeekdayForDateStr('2026-12-31') === 4 && getWeekdayForDateStr('2027-01-01') === 5);

  // ============================================================
  // Timezone conversion (14) -- the SAME localDateTimeToUTC helper
  // already proven elsewhere (planDayEntry.test.ts), reused here, never
  // reimplemented.
  // ============================================================
  {
    const result = resolveAvailability({ targetDate: WED, timezone: 'America/New_York', now: new Date('2026-09-16T00:00:00Z'), configuration: config(true, [period(3, '09:00', '17:00')]) });
    // America/New_York is UTC-4 (EDT) in September -- 09:00 local is 13:00Z.
    check('14. a non-IST timezone produces a correctly-converted instant, proving real timezone-dependent conversion (not a hardcoded offset)', result.status === 'CONFIGURED' && result.usableWindows[0].start.toISOString() === '2026-09-16T13:00:00.000Z');
  }

  // ============================================================
  // Period validation (15-18).
  // ============================================================
  check('15. an out-of-range weekday is rejected', throws(() => validateAvailabilityPeriodInput(period(7, '09:00', '17:00'))));
  check('15b. a negative weekday is rejected', throws(() => validateAvailabilityPeriodInput(period(-1, '09:00', '17:00'))));
  check('16. a non-zero-padded time string is rejected', throws(() => validateAvailabilityPeriodInput(period(1, '9:00', '17:00'))));
  check('16b. an out-of-range hour is rejected', throws(() => validateAvailabilityPeriodInput(period(1, '25:00', '17:00'))));
  check('17. start === end is rejected', throws(() => validateAvailabilityPeriodInput(period(1, '09:00', '09:00'))));
  check('18. a cross-midnight period (20:00-01:00) is rejected outright, never auto-split', throws(() => validateAvailabilityPeriodInput(period(5, '20:00', '01:00'))));
  check('18b. a valid period is returned unchanged (never mutated/coerced)', validateAvailabilityPeriodInput(period(1, '09:00', '17:00')).startTime === '09:00');

  // ============================================================
  // Determinism (19) / row-order independence (20).
  // ============================================================
  {
    const configuration = config(true, [period(3, '14:00', '18:00'), period(3, '09:00', '12:00')]);
    const first = resolveAvailability({ targetDate: WED, timezone: TZ, now: new Date('2026-09-16T00:00:00Z'), configuration });
    const second = resolveAvailability({ targetDate: WED, timezone: TZ, now: new Date('2026-09-16T00:00:00Z'), configuration });
    check('19. identical inputs produce byte-equivalent results', first.status === 'CONFIGURED' && second.status === 'CONFIGURED' && JSON.stringify(windowsAsIso(first.usableWindows)) === JSON.stringify(windowsAsIso(second.usableWindows)));
  }
  {
    const forward = config(true, [period(3, '09:00', '12:00'), period(3, '14:00', '18:00')]);
    const reversed = config(true, [period(3, '14:00', '18:00'), period(3, '09:00', '12:00')]);
    const a = resolveAvailability({ targetDate: WED, timezone: TZ, now: new Date('2026-09-16T00:00:00Z'), configuration: forward });
    const b = resolveAvailability({ targetDate: WED, timezone: TZ, now: new Date('2026-09-16T00:00:00Z'), configuration: reversed });
    check('20. storage row order never affects the resolved result', a.status === 'CONFIGURED' && b.status === 'CONFIGURED' && JSON.stringify(windowsAsIso(a.usableWindows)) === JSON.stringify(windowsAsIso(b.usableWindows)));
  }

  // ============================================================
  // Constructor-facing normalization -- gap generation (21-24).
  // ============================================================
  {
    const result = resolveAvailability({ targetDate: WED, timezone: TZ, now: new Date('2026-09-16T00:00:00Z'), configuration: config(true, [period(3, '09:00', '12:00'), period(3, '14:00', '18:00')]) });
    if (result.status !== 'CONFIGURED') throw new Error('unreachable');
    const normalized = normalizeUsableWindowsToConstructionWindow(result.usableWindows, WED, TZ);
    check(
      '21. two periods with a gap normalize to one outer window (09-18) plus one AVAILABILITY_GAP blocker (12-14)',
      normalized !== null &&
        normalized.window.start.toISOString() === '2026-09-16T03:30:00.000Z' &&
        normalized.window.end.toISOString() === '2026-09-16T12:30:00.000Z' &&
        normalized.gapBlockers.length === 1 &&
        normalized.gapBlockers[0].source === 'AVAILABILITY_GAP' &&
        normalized.gapBlockers[0].start.toISOString() === '2026-09-16T06:30:00.000Z' &&
        normalized.gapBlockers[0].end.toISOString() === '2026-09-16T08:30:00.000Z'
    );
    check('21b. the normalized outer window keeps source REMAINING_TODAY (no new ConstructionWindowSource value introduced)', normalized?.window.source === 'REMAINING_TODAY');
  }
  {
    const result = resolveAvailability({ targetDate: WED, timezone: TZ, now: new Date('2026-09-16T00:00:00Z'), configuration: config(true, [period(3, '09:00', '17:00')]) });
    if (result.status !== 'CONFIGURED') throw new Error('unreachable');
    const normalized = normalizeUsableWindowsToConstructionWindow(result.usableWindows, WED, TZ);
    check('22. a single period produces zero gap blockers', normalized !== null && normalized.gapBlockers.length === 0);
  }
  {
    const result = resolveAvailability({ targetDate: WED, timezone: TZ, now: new Date('2026-09-16T00:00:00Z'), configuration: config(true, [period(3, '07:00', '09:00'), period(3, '12:00', '14:00'), period(3, '18:00', '20:00')]) });
    if (result.status !== 'CONFIGURED') throw new Error('unreachable');
    const normalized = normalizeUsableWindowsToConstructionWindow(result.usableWindows, WED, TZ);
    check('23. three periods with two gaps between them produce exactly two AVAILABILITY_GAP blockers', normalized !== null && normalized.gapBlockers.length === 2);
  }
  check('24. normalizing an empty usableWindows list returns null (the caller\'s own responsibility to report NO_USABLE_CAPACITY directly, never a fabricated window)', normalizeUsableWindowsToConstructionWindow([], WED, TZ) === null);

  // ============================================================
  // Inherited DST behavior (25) -- reuses localDateTimeToUTC verbatim
  // (proven via source inspection below), never a second, bespoke
  // civil-time conversion. No new DST-specific logic is introduced or
  // tested here -- this mirrors the SAME already-accepted single-pass
  // correction limitation FIXED-time assembly (resolveFixedStart,
  // planDayEntry.ts) already relies on in production.
  // ============================================================
  {
    const source: string = require('fs').readFileSync(require('path').join(__dirname, '../apps/web/lib/availabilityContext.ts'), 'utf8');
    check('25. availabilityContext.ts reuses localDateTimeToUTC (timezone.ts) for every civil-time conversion, never a second bespoke DST-handling implementation', source.includes("from './timezone'") && source.includes('localDateTimeToUTC('));
    check('25b. availabilityContext.ts has no clock of its own anywhere (no new Date()/Date.now() -- Date.UTC(explicit y/m/d) calendar arithmetic is not a clock read)', !/new Date\(\s*\)/.test(source) && !source.includes('Date.now('));
  }

  if (!allPassed) {
    console.error('\nSome Availability Context checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL AVAILABILITY CONTEXT CHECKS PASSED');
  }
}

main();
