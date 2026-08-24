import { getDatePartsInTimezone, resolveTzOffsetMinutes } from '../../apps/web/lib/timezone';

/** Today's (or an explicit offsetDays-from-today's) local hh:mm in the
 * given IANA timezone, as a real UTC instant -- reuses the app's own
 * timezone helpers, never a second date-math implementation. */
export function localTimeToday(hour: number, minute: number, timezone: string, offsetDays = 0): Date {
  const now = new Date();
  const base = new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  const parts = getDatePartsInTimezone(timezone, base);
  const tzOffsetMinutes = resolveTzOffsetMinutes(timezone, base);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute) - tzOffsetMinutes * 60_000);
}
