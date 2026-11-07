import { getDatePartsInTimezone, getSecondOfDayInTimezone, localDateTimeToUTC } from './timezone';

/**
 * AURA PA-3B-R2: anchors a user's intended local calendar date to noon as
 * an absolute UTC instant via `localDateTimeToUTC()` -- NOT a server-local
 * `new Date(year, month-1, day, 12, 0, 0)` constructor (PA-3B-R1 finding
 * F3). That constructor interprets its arguments in the SERVER process's
 * own timezone, not `timezone` (the target location's); the resulting
 * instant could therefore re-extract to a DIFFERENT calendar day in
 * `timezone` than `localDate` itself (confirmed: Pacific/Kiritimati,
 * server TZ=UTC, intended day 2026-06-16 re-extracted as 2026-06-17).
 *
 * Lives in this plain lib module (not inline in
 * apps/web/app/api/calendar/feed/route.ts) for two reasons: a Next.js
 * app-router `route.ts` may only export HTTP method handlers and a small
 * fixed set of config constants, so exporting this for testability there
 * fails Next's route-type validation at build time; and the math-core test
 * suite (run via ts-node outside the Next.js build) cannot resolve
 * `next/server`, which route.ts imports. This module has neither
 * constraint, so test/pa3bSolarWindowsTimezoneFix.test.ts exercises this
 * exact production function directly.
 */
export function computeUserLocalNoon(localDate: { dateStr: string }, timezone: string): Date {
  return localDateTimeToUTC(localDate.dateStr, '12:00', timezone);
}

/**
 * AURA PA-3B: formats a Date's wall-clock fields AS SEEN IN `ianaTimezone`
 * (the real target-location zone, via Intl -- not the server process's own
 * `TZ`). Paired with `getDailySolarWindows`'s now-corrected UTC instants
 * (see that function's own PA-3B doc comment) so the visible local time in
 * the resulting `DTSTART;TZID=...`/`DTEND;TZID=...` lines is still correct
 * -- previously both sides of this round-trip used server-local `Date`
 * getters/constructors and happened to cancel out only because they used
 * the identical (wrong) interpretation; fixing one side without the other
 * would have broken it.
 */
export function formatLocalICSDate(d: Date, ianaTimezone: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const { year, month, day } = getDatePartsInTimezone(ianaTimezone, d);
  const secondOfDay = getSecondOfDayInTimezone(ianaTimezone, d);
  const hours = Math.floor(secondOfDay / 3600);
  const mins = Math.floor((secondOfDay % 3600) / 60);
  const secs = secondOfDay % 60;

  return `${year}${pad(month)}${pad(day)}T${pad(hours)}${pad(mins)}${pad(secs)}`;
}
