/**
 * Timezone-safe local-calendar-date helpers for the Panchang domain layer.
 *
 * These began as duplicates of apps/web/lib/timezone.ts because packages/ is
 * meant to stay framework-agnostic and consumable by plain ts-node (tests,
 * future CLI tooling) without apps/web's dependency tree. The local-wall-time
 * -> UTC conversion (localDateTimeToUTC / resolveLocalDateTime) now lives ONLY
 * here and apps/web/lib/timezone.ts re-exports it, so there is a single
 * implementation (Home Move DST correction).
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

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

export type LocalDateTimeResolution =
  /** Exactly one UTC instant has this wall time in this timezone. */
  | { status: 'OK'; instant: Date }
  /** A spring-forward gap: the wall time never happens. */
  | { status: 'NONEXISTENT' }
  /** A fall-back overlap: the wall time happens twice (earlier = first, later = second occurrence). */
  | { status: 'AMBIGUOUS'; earlier: Date; later: Date }
  /** The date/time text is not a real "YYYY-MM-DD" / "HH:MM". */
  | { status: 'INVALID' };

/**
 * Solves "this calendar date + this clock time in this IANA timezone" for the
 * UTC instant(s), EXACTLY -- and says so when there is not exactly one.
 *
 * Reading the wall time as if it were UTC gives a naive instant N. The true
 * instant is t = N - offset(t), and the offset that applies at t may differ
 * from the offset at N only when a transition lies between them, so every
 * offset that can apply is one of the offsets seen a day either side of N.
 * (Real zones never change offset twice within 24 hours.) For each such
 * candidate offset o, t = N - o is a solution iff the zone's offset AT t is
 * really o. That is a deterministic, bounded (at most three offsets) search
 * whose every accepted answer round-trips exactly by construction:
 *   0 solutions -> NONEXISTENT (spring-forward gap)
 *   1 solution  -> OK
 *   2 solutions -> AMBIGUOUS   (fall-back overlap)
 * Nothing here consults the browser timezone; only the given IANA zone.
 */
export function resolveLocalDateTime(dateStr: string, timeStr: string, ianaTimezone: string): LocalDateTimeResolution {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const t = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(timeStr);
  if (!d || !t || !isValidCalendarDateString(dateStr)) return { status: 'INVALID' };
  const hour = Number(t[1]);
  const minute = Number(t[2]);
  if (hour > 23 || minute > 59) return { status: 'INVALID' };

  const naive = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), hour, minute);
  const offsets = new Set<number>([
    resolveTzOffsetMinutes(ianaTimezone, new Date(naive - DAY_MS)),
    resolveTzOffsetMinutes(ianaTimezone, new Date(naive)),
    resolveTzOffsetMinutes(ianaTimezone, new Date(naive + DAY_MS)),
  ]);
  const instants = [...offsets]
    .map((offset) => ({ offset, at: naive - offset * MINUTE_MS }))
    .filter(({ offset, at }) => resolveTzOffsetMinutes(ianaTimezone, new Date(at)) === offset)
    .map(({ at }) => at)
    .sort((a, b) => a - b);
  if (instants.length === 0) return { status: 'NONEXISTENT' };
  if (instants.length === 1) return { status: 'OK', instant: new Date(instants[0]) };
  return { status: 'AMBIGUOUS', earlier: new Date(instants[0]), later: new Date(instants[1]) };
}

/**
 * The ORIGINAL single-sample conversion, kept byte-for-byte in behavior: read
 * the wall time as if it were UTC, sample the zone's offset AT THAT INSTANT, and
 * subtract it. It is only exact when no transition lies between that sample and
 * the true instant, and for a wall time that does not exist or occurs twice its
 * result depends on the zone's offset sign and the transition's geometry (it is
 * not a policy). It exists solely so existing total-function callers keep the
 * exact results they had for those two classes of input; it is never used for a
 * wall time that exists exactly once.
 */
function legacySingleSampleLocalDateTimeToUTC(dateStr: string, timeStr: string, ianaTimezone: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);

  const guessUTC = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offsetMinutes = resolveTzOffsetMinutes(ianaTimezone, guessUTC);
  return new Date(guessUTC.getTime() - offsetMinutes * MINUTE_MS);
}

/**
 * BACKWARD-COMPATIBLE TOTAL API for existing callers: converts a local
 * date+time (e.g. "2026-08-21" + "05:36" in "Asia/Kolkata") to a UTC instant and
 * never rejects.
 *  - A wall time that exists exactly once (every ordinary time, INCLUDING
 *    ordinary times on a DST-transition day) resolves EXACTLY, via
 *    resolveLocalDateTime.
 *  - A wall time inside a spring-forward gap, one repeated by a fall-back
 *    overlap, or unparseable text keeps the legacy single-sample result
 *    (legacySingleSampleLocalDateTimeToUTC) exactly as before this correction.
 *    That legacy result is a compatibility artifact, NOT a recommended policy:
 *    it depends on the zone and the transition, and differs between eastern and
 *    western zones.
 * Interactive scheduling that takes a wall time from a person should call
 * resolveLocalDateTime and handle NONEXISTENT / AMBIGUOUS explicitly (as Home
 * Move does) instead of using this function.
 */
export function localDateTimeToUTC(dateStr: string, timeStr: string, ianaTimezone: string): Date {
  const resolved = resolveLocalDateTime(dateStr, timeStr, ianaTimezone);
  if (resolved.status === 'OK') return resolved.instant;
  return legacySingleSampleLocalDateTimeToUTC(dateStr, timeStr, ianaTimezone);
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
