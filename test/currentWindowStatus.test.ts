/**
 * AURA HOME IA V2 FOLLOW-UP FIXES -- Finding C regression coverage.
 *
 * Live validation found the Right Now card displaying "Current - 4:31 AM"
 * during the evening (Brahma Muhurtham's own start time from earlier that
 * morning, mislabeled as if it were the current clock time). Root cause:
 * page.tsx's own currentWindowInfo computation returned the literal string
 * 'Current' as `startTime` whenever there was no active named window (a
 * Neutral gap), and HomeDashboard.tsx concatenated it straight into
 * "{startTime} - {endTime}".
 *
 * computeCurrentWindowStatus() (apps/web/lib/currentWindowStatus.ts) is a
 * pure extraction of that exact minute arithmetic -- unchanged except for
 * the `startTime: null` / `boundaryIsTomorrow` fix -- so it's directly
 * unit-testable here without a component harness or a live DATABASE_URL.
 *
 * currentMinuteOfDay is always already resolved in the user's own
 * configured timezone by the caller (page.tsx's useCurrentMinuteOfDay) --
 * this module does no timezone conversion of its own, so these tests
 * exercise the minute-arithmetic directly across IST/US-timezone-shaped
 * inputs rather than re-deriving timezone conversion.
 */
import * as fs from 'fs';
import { computeCurrentWindowStatus, formatMinuteOfDay, CurrentWindowSource } from '../apps/web/lib/currentWindowStatus';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// Root cause: a Neutral gap (no active named window) must never label
// itself with a fake "Current" start time -- startTime is null instead,
// and the caller (HomeDashboard.tsx) is responsible for an honest sentence.
// ============================================================

{
  // IST-shaped windows (minute-of-day, local clock already resolved) --
  // Brahma Muhurtham 4:31 AM-5:19 AM (271-319), evening "now" at 19:29 (7:29 PM, minute 1169),
  // reproducing the exact live-validation repro (today's Brahma already
  // completed, no other window remains today, so the only later boundary
  // is tomorrow's Brahma at 4:31 AM).
  const windows: CurrentWindowSource[] = [{ type: 'BRAHMA', startMinutes: 271, endMinutes: 319 }];
  const status = computeCurrentWindowStatus('NEUTRAL', windows, 1169);
  check('Neutral gap after today\'s only named window has ended: startTime is null, never the literal "Current"', status.startTime === null);
  check('Neutral gap: endTime is the next window\'s own start time, formatted correctly (4:31 AM)', status.endTime === '4:31 AM');
  check('Neutral gap wrapping past the only window (already ended today): boundaryIsTomorrow is true', status.boundaryIsTomorrow === true);
  check('Neutral gap: timeRemaining counts down to that wrapped boundary correctly (7:29 PM -> 4:31 AM next day = 9h 2m)', status.timeRemaining === '9h 2m');
}

{
  // Same fixture, but "now" is BEFORE today's Brahma window (early morning,
  // minute 200 = 3:20 AM) -- the boundary is today's own Brahma start, not
  // tomorrow's.
  const windows: CurrentWindowSource[] = [{ type: 'BRAHMA', startMinutes: 271, endMinutes: 319 }];
  const status = computeCurrentWindowStatus('NEUTRAL', windows, 200);
  check('Neutral gap before today\'s own named window: boundaryIsTomorrow is false', status.boundaryIsTomorrow === false);
  check('Neutral gap before today\'s own named window: endTime is today\'s own start time (4:31 AM), not wrapped', status.endTime === '4:31 AM');
}

// ============================================================
// Inside a real, active named window -- startTime is a genuine clock time
// (the window's own start), never null, and the range is the window's own
// start/end -- this branch was never broken and must stay exactly as-is.
// ============================================================

{
  const windows: CurrentWindowSource[] = [{ type: 'ABHIJIT', startMinutes: 711, endMinutes: 760 }]; // 11:51 AM - 12:40 PM
  const status = computeCurrentWindowStatus('ABHIJIT', windows, 730); // 12:10 PM, inside the window
  check('Active named window: startTime is the window\'s own genuine start clock time, never null', status.startTime === '11:51 AM');
  check('Active named window: endTime is the window\'s own end', status.endTime === '12:40 PM');
  check('Active named window: boundaryIsTomorrow is always false (the boundary is this window\'s own same-day end)', status.boundaryIsTomorrow === false);
}

// ============================================================
// Multiple windows today, gap between them -- the SOONEST later boundary
// wins, not the day's last window and not a fixed midnight fallback.
// ============================================================

{
  const windows: CurrentWindowSource[] = [
    { type: 'BRAHMA', startMinutes: 271, endMinutes: 319 }, // 4:31-5:19 AM
    { type: 'ABHIJIT', startMinutes: 711, endMinutes: 760 }, // 11:51 AM-12:40 PM
    { type: 'GULIKA', startMinutes: 855, endMinutes: 946 }, // 2:15-3:46 PM
  ];
  const status = computeCurrentWindowStatus('NEUTRAL', windows, 800); // 1:20 PM, between Abhijit and Gulika
  check('Gap between two later windows: the boundary is the SOONEST upcoming one (Gulika), never the day\'s last window', status.endTime === '2:15 PM');
  check('Gap between two later windows: never wraps to tomorrow when a same-day boundary exists', status.boundaryIsTomorrow === false);
}

// ============================================================
// US-timezone-shaped (non-IST, DST-adjacent) inputs -- this function does
// no timezone math of its own (currentMinuteOfDay is pre-resolved), so the
// exact same minute arithmetic must hold regardless of which real-world
// timezone the caller resolved it from.
// ============================================================

{
  // America/New_York-shaped local minutes: a single afternoon window,
  // "now" well past midnight the same local day, before the window.
  const windows: CurrentWindowSource[] = [{ type: 'GULIKA', startMinutes: 900, endMinutes: 960 }]; // 3:00-4:00 PM local
  const status = computeCurrentWindowStatus('NEUTRAL', windows, 60); // 1:00 AM local
  check('Non-IST timezone-shaped input: gap before today\'s own window resolves correctly (no hidden IST assumption)', status.endTime === '3:00 PM' && status.boundaryIsTomorrow === false);
}

// ============================================================
// formatMinuteOfDay -- pure formatting, exercised directly for boundary
// values (midnight, noon, minute rollover).
// ============================================================

check('formatMinuteOfDay(0) -> 12:00 AM (midnight)', formatMinuteOfDay(0) === '12:00 AM');
check('formatMinuteOfDay(720) -> 12:00 PM (noon)', formatMinuteOfDay(720) === '12:00 PM');
check('formatMinuteOfDay(1439) -> 11:59 PM (last minute of the day)', formatMinuteOfDay(1439) === '11:59 PM');
check('formatMinuteOfDay wraps a minute >= 1440 back into 0-1439 (never renders a raw >24h value)', formatMinuteOfDay(1440 + 271) === '4:31 AM');

// ============================================================
// HomeDashboard.tsx's own label-construction branch (currentTimeRange) --
// the actual render-time consumer of `startTime`/`boundaryIsTomorrow`.
// No component-test harness exists in this repo for a plain .tsx file
// under the standard ts-node runner, so this follows the same source-text/
// regex structural-assertion pattern the rest of this repo already uses
// (e.g. test/planLogMyDayRefresh.test.ts).
// ============================================================

const homeDashboardSource = fs.readFileSync('apps/web/components/HomeDashboard.tsx', 'utf8');
check(
  'HomeDashboard.tsx no longer templates currentWindow.startTime unconditionally into "{startTime} - {endTime}" (the root cause of "Current - 4:31 AM")',
  /currentWindow\.startTime !== null/.test(homeDashboardSource)
);
check(
  'HomeDashboard.tsx\'s Neutral-gap branch names endTime as a boundary ("Open until ...") rather than a fake current time',
  /`Open until \$\{currentWindow\.endTime\}/.test(homeDashboardSource)
);
check(
  'HomeDashboard.tsx surfaces boundaryIsTomorrow explicitly when the boundary wrapped to tomorrow',
  /currentWindow\.boundaryIsTomorrow \? ' tomorrow' : ''/.test(homeDashboardSource)
);
check(
  'HomeDashboard.tsx\'s currentWindow prop type documents startTime as nullable (string | null), matching computeCurrentWindowStatus\'s real contract',
  /startTime: string \| null;/.test(homeDashboardSource)
);

if (!allPassed) {
  console.error('\nSome Current Window Status checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL CURRENT WINDOW STATUS CHECKS PASSED');
}
