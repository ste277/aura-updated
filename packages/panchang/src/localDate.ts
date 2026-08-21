/**
 * Timezone-safe local-calendar-date helpers for the Panchang domain layer.
 *
 * These are duplicated from apps/web/lib/timezone.ts (same Intl-based
 * algorithm, so behavior is guaranteed identical) rather than imported from
 * there, because packages/ is meant to stay framework-agnostic and
 * consumable by plain ts-node (tests, future CLI tooling) without pulling in
 * apps/web's dependency tree. apps/web/lib/timezone.ts has other existing
 * callers (birth-profile forms, natal chart) that are out of scope for this
 * PR, so it's left untouched; a future cleanup could have one re-export the
 * other.
 *
 * The core principle throughout this module: a "local calendar date" like
 * "2026-08-21" combined with an IANA timezone name is NOT the same instant
 * as `new Date('2026-08-21')` (which is UTC midnight) -- for any timezone
 * east of Greenwich that instant already fell on the *previous* local day.
 * Every function here treats (dateStr, timezone) as the source of truth and
 * only converts to/from absolute instants explicitly and deliberately.
 */

export interface ZonedDateParts {
  year: number;
  /** 1-12, matching SolarInput's convention (not Date#getMonth's 0-11) */
  month: number;
  day: number;
  /** 0=Sunday..6=Saturday, matching Date#getDay and WeekdayIndex */
  weekday: number;
  /** "YYYY-MM-DD" in the given timezone */
  dateStr: string;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** Resolves the correct UTC offset (minutes) for a given IANA timezone at a
 * given instant, DST-correct (uses the platform's own timezone database via
 * Intl rather than a hand-maintained rules table). */
export function resolveTzOffsetMinutes(ianaTimezone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ianaTimezone,
    timeZoneName: 'shortOffset',
  });

  const parts = dtf.formatToParts(date);
  const offsetPart = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+0';

  const match = offsetPart.match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!match) return 0;

  const sign = match[1] === '-' ? -1 : 1;
  const hours = parseInt(match[2], 10);
  const minutes = match[3] ? parseInt(match[3], 10) : 0;

  return sign * (hours * 60 + minutes);
}

/** The calendar date and weekday *in the given IANA timezone* for an instant. */
export function getDatePartsInTimezone(ianaTimezone: string, date: Date): ZonedDateParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ianaTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = dtf.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  const year = parseInt(get('year'), 10);
  const month = parseInt(get('month'), 10);
  const day = parseInt(get('day'), 10);
  const weekday = WEEKDAY_INDEX[get('weekday')] ?? 0;
  const dateStr = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return { year, month, day, weekday, dateStr };
}

/**
 * Converts a local date+time (e.g. "2026-08-21" + "05:36" in "Asia/Kolkata")
 * to the absolute UTC instant it represents. One correction pass is
 * sufficient in practice -- offsets don't change within a single day except
 * exactly at a DST transition moment, an acceptable edge case here (same
 * tradeoff apps/web/lib/timezone.ts's version documents).
 */
export function localDateTimeToUTC(dateStr: string, timeStr: string, ianaTimezone: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);

  const guessUTC = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offsetMinutes = resolveTzOffsetMinutes(ianaTimezone, guessUTC);
  return new Date(guessUTC.getTime() - offsetMinutes * 60000);
}

/**
 * True only for a syntactically well-formed AND calendrically real
 * "YYYY-MM-DD" date (rejects e.g. "2026-02-30", "2026-13-01"), independent
 * of any timezone.
 */
export function isValidCalendarDateString(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
