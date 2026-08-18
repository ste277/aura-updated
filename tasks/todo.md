# Fix #1: panchang date/weekday must come from the user's timezone, not the browser clock

## The bug

`apps/web/app/page.tsx` computes the day's ephemeris from browser-local date
parts, and `todayDateStr` from `toISOString()` (UTC):

- A Chennai user at 1 AM IST gets **yesterday's** windows (`toISOString` is
  still on the previous UTC date).
- A diaspora user (NY browser, Chennai profile) gets windows for the wrong
  **weekday** → wrong Rahu Kalam / Gulika / Yama segments.

Time-of-day was already tz-correct (`getMinuteOfDayInTimezone`); only the
date/weekday path is broken.

## Plan

- [x] Add `getDatePartsInTimezone(ianaTz, date)` to `apps/web/lib/timezone.ts`
      → `{year, month, day, weekday, dateStr}` via `Intl.DateTimeFormat`
      (same pattern as the existing helpers)
- [x] `page.tsx`: derive `todayDateStr`, the ephemeris `year/month/day`, and
      `weekday` from the helper (user tz, `FALLBACK_TZ` when logged out)
- [x] `page.tsx`: `loggedActivitiesToday` filter — compare log dates in user tz
- [x] Test: `test/timezone.test.ts` with known cross-date cases (late-night IST
      vs UTC date; NY-browser/Chennai-profile weekday) + run in CI
- [x] Verify: test passes; `tsc --noEmit` clean

Out of scope (follow-up): calendar components' "today" highlight also uses the
browser clock — cosmetic, not window-math.
