/**
 * Deterministic fixture calendar for the automatic Goal lifecycle DB test (test-only; no production consumer).
 *
 * WHY. `automaticGoalLifecycleClosureDb.test.ts` hard-coded the week 2026-10-05 .. 2026-10-12. Preview takes an explicit `now`, but the ACCEPT route's
 * stale-preview check (`validateNotStale`, "the proposed start has elapsed") reads the real wall clock, `movePlannedActivity` requires "a destination in the
 * future" against the database clock, and the timing search reads the real clock for "today". So the fixture was only correct while its calendar days were
 * still in the future: on 2026-10-06 (the first fixture day) the same assertions began failing on every CI run -- and on clean main -- with no code change.
 * Production is right to refuse past plans; the fixture's calendar was bound to the day it was written.
 *
 * THE FIX. The fixture week is ANCHORED, not hard-coded: the Monday that starts a Monday-start week at least `FIXTURE_MIN_LEAD_DAYS` calendar days
 * after the reference date (local to the pinned timezone). Every fixture instant is an offset from that anchor, so the weekday structure the lifecycle
 * semantics need (Monday-start Rhythm week, a Sunday before the boundary, the next Monday) is identical on every run date, while the whole week is always
 * in the future of the real clocks that production code consults. `fixtureAnchorMonday` is a PURE function of its arguments (unit-tested over simulated run
 * dates, including month / year / leap-day boundaries and every weekday); `realClockReferenceForFixture` is the ONE approved wall-clock read, and its
 * value is used only to choose a future anchor -- never as a lifecycle input.
 */
import { getDatePartsInTimezone } from '../apps/web/lib/timezone';

/** Lead time: comfortably beyond any CI run duration, clock skew or day boundary, so the anchor week is always wholly in the future. */
export const FIXTURE_MIN_LEAD_DAYS = 28;

/** Civil-date arithmetic on YYYY-MM-DD strings (UTC calendar math; no timezone, DST or host-clock involvement). */
export function addCivilDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** ISO weekday of a civil date: 1 = Monday .. 7 = Sunday. */
export function civilWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 7 : js;
}

/** The first Monday on or after `FIXTURE_MIN_LEAD_DAYS` days after the reference instant's local civil date in `timezone`. Pure. */
export function fixtureAnchorMonday(referenceNow: Date, timezone: string): string {
  const today = getDatePartsInTimezone(timezone, referenceNow).dateStr;
  const earliest = addCivilDays(today, FIXTURE_MIN_LEAD_DAYS);
  return addCivilDays(earliest, (8 - civilWeekday(earliest)) % 7);
}

/** The ONE approved wall-clock read: used only to place the fixture week in the future; never an input to any lifecycle assertion. */
export function realClockReferenceForFixture(): Date {
  // Test-only simulation hook for the repeatability matrix (simulated run dates); never set in CI.
  const simulated = process.env.LIFECYCLE_FIXTURE_REFERENCE_NOW;
  if (simulated !== undefined) {
    const parsed = new Date(simulated);
    if (Number.isNaN(parsed.getTime())) throw new Error('LIFECYCLE_FIXTURE_REFERENCE_NOW must be a valid ISO instant');
    return parsed;
  }
  return new Date();
}
