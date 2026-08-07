/**
 * Resolves the correct UTC offset (in minutes) for a given IANA timezone on a
 * given date, correctly handling daylight saving time. This is why locations
 * outside India need a `timezone` (IANA name) rather than a fixed
 * `tzOffsetMinutes` — India has no DST, so a fixed offset happened to be safe
 * there, but it would be silently wrong for roughly half the year in places
 * like New York, London, or Sydney.
 *
 * Uses Intl.DateTimeFormat rather than a hand-maintained DST rules table —
 * the browser/Node's timezone database is authoritative and kept up to date
 * by the platform, not by us.
 */
export function resolveTzOffsetMinutes(ianaTimezone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ianaTimezone,
    timeZoneName: 'shortOffset',
  });

  const parts = dtf.formatToParts(date);
  const offsetPart = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+0';

  // offsetPart looks like "GMT+5:30", "GMT-4", "GMT+8"
  const match = offsetPart.match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!match) return 0;

  const sign = match[1] === '-' ? -1 : 1;
  const hours = parseInt(match[2], 10);
  const minutes = match[3] ? parseInt(match[3], 10) : 0;

  return sign * (hours * 60 + minutes);
}

/**
 * The current minute-of-day (0-1439) *in the given IANA timezone*, not the
 * browser's own local timezone. This matters as soon as a user's browser and
 * their selected AuraSchedule location can differ — e.g. someone in California
 * checking Chennai's timings for family there. Using `new Date().getHours()`
 * would silently show the wrong "now" position on the dial in that case.
 */
export function getMinuteOfDayInTimezone(ianaTimezone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ianaTimezone,
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  });
  const parts = dtf.formatToParts(date);
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  return hour * 60 + minute;
}

/** Same idea as getMinuteOfDayInTimezone, but with second-level precision — used
 * for the live countdown, where whole-minute granularity would look static/broken
 * for most of each minute. */
export function getSecondOfDayInTimezone(ianaTimezone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ianaTimezone,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  });
  const parts = dtf.formatToParts(date);
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  const second = parseInt(parts.find((p) => p.type === 'second')?.value ?? '0', 10);
  return hour * 3600 + minute * 60 + second;
}

/**
 * Converts a local date+time (as typed into a birth-data form, e.g. "1990-03-15"
 * + "14:30" in "Asia/Kolkata") to the actual UTC instant it represents. One
 * correction pass is sufficient in practice — offsets don't change within a
 * single day except exactly at a DST transition moment, which is an acceptable
 * edge case for a birth-time input.
 */
export function localDateTimeToUTC(dateStr: string, timeStr: string, ianaTimezone: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);

  // First guess: treat the components as if they were UTC, then correct.
  const guessUTC = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offsetMinutes = resolveTzOffsetMinutes(ianaTimezone, guessUTC);
  return new Date(guessUTC.getTime() - offsetMinutes * 60000);
}
