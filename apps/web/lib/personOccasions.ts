/**
 * AURA-MP-1 -- pure special-day (PersonOccasion) date logic. No I/O.
 *
 * A special day is a CIVIL calendar day (month/day, optional year). "Today"
 * is the calendar date in the USER's own timezone, and every comparison is
 * plain calendar-day arithmetic on Y/M/D (Date.UTC component maths), never
 * millisecond offsets -- so DST and the user's local midnight can never shift
 * a special day by one.
 *
 * Rules (design AURA-MP-01, D4/D5 and 11.3):
 *   - unknown year (year = null): the day still recurs every year; there is
 *     simply no age / anniversary count ("turning" = null);
 *   - 29 February is observed on 28 February in non-leap years (D4);
 *   - surfaced = 0 <= daysUntil <= remindDaysBefore (null = never ahead).
 *
 * All date maths goes through nextOccurrence(), which branches on
 * `calendar`. Only GREGORIAN exists today; a future calendar type (e.g. a
 * tithi-dated day, R3) adds a branch here and nothing else changes, because
 * callers only ever see the RESOLVED occurrence date.
 */

export type OccasionCalendar = 'GREGORIAN';

export interface OccasionDateFields {
  calendar: OccasionCalendar;
  month: number | null;
  day: number | null;
  year: number | null;
}

export interface CivilDate {
  year: number;
  month: number; // 1-12
  day: number;
}

export interface ResolvedOccurrence {
  /** "YYYY-MM-DD" of the next occurrence on or after `from`. */
  date: string;
  /** Whole calendar days from `from` (0 = today). */
  daysUntil: number;
  /** Age / anniversary number on that occurrence, or null when the year is unknown. */
  turning: number | null;
  /** True when a 29 Feb day is being observed on 28 Feb this year. */
  observedFromLeapDay: boolean;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** True when month/day is a real calendar day in SOME year (29 Feb allowed). */
export function isValidMonthDay(month: number, day: number): boolean {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  const max = month === 2 ? 29 : daysInMonth(2001, month);
  return day <= max;
}

export function parseCivilDate(dateStr: string): CivilDate {
  const [year, month, day] = dateStr.split('-').map((n) => parseInt(n, 10));
  return { year, month, day };
}

export function formatCivilDate(date: CivilDate): string {
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

function civilDayNumber(date: CivilDate): number {
  return Math.round(Date.UTC(date.year, date.month - 1, date.day) / 86_400_000);
}

/** The date this month/day falls on in `year` (29 Feb -> 28 Feb in non-leap years). */
function gregorianInYear(month: number, day: number, year: number): { date: CivilDate; observedFromLeapDay: boolean } {
  if (month === 2 && day === 29 && !isLeapYear(year)) {
    return { date: { year, month: 2, day: 28 }, observedFromLeapDay: true };
  }
  return { date: { year, month, day }, observedFromLeapDay: false };
}

/**
 * The next occurrence of a special day on or after `fromLocalDate` (the
 * user's local "today", "YYYY-MM-DD"). Returns null for a calendar type this
 * build cannot resolve or for incomplete date fields.
 */
export function nextOccurrence(occasion: OccasionDateFields, fromLocalDate: string): ResolvedOccurrence | null {
  if (occasion.calendar !== 'GREGORIAN') return null;
  const { month, day } = occasion;
  if (month == null || day == null || !isValidMonthDay(month, day)) return null;

  const from = parseCivilDate(fromLocalDate);
  let candidate = gregorianInYear(month, day, from.year);
  if (civilDayNumber(candidate.date) < civilDayNumber(from)) {
    candidate = gregorianInYear(month, day, from.year + 1);
  }
  const daysUntil = civilDayNumber(candidate.date) - civilDayNumber(from);
  const turning = occasion.year != null && candidate.date.year >= occasion.year ? candidate.date.year - occasion.year : null;
  return {
    date: formatCivilDate(candidate.date),
    daysUntil,
    turning,
    observedFromLeapDay: candidate.observedFromLeapDay,
  };
}

/** Surfaced ahead of time only within the special day's own lead window (D5). */
export function isOccasionSurfaced(daysUntil: number, remindDaysBefore: number | null): boolean {
  if (remindDaysBefore == null) return false;
  return daysUntil >= 0 && daysUntil <= remindDaysBefore;
}

export interface UpcomingOccasionSource extends OccasionDateFields {
  id: string;
  savedPersonId: string;
  kind: 'BIRTHDAY' | 'ANNIVERSARY' | 'OTHER';
  label: string | null;
  remindDaysBefore: number | null;
}

export interface UpcomingOccasion {
  occasionId: string;
  personId: string;
  personName: string;
  kind: 'BIRTHDAY' | 'ANNIVERSARY' | 'OTHER';
  label: string | null;
  date: string;
  daysUntil: number;
  turning: number | null;
  observedFromLeapDay: boolean;
  surfaced: boolean;
}

/**
 * Special days whose next occurrence is within `withinDays` of the user's
 * local today, soonest first (ties by person name). People not found in
 * `peopleById` are skipped (never shown with a missing name).
 */
export function listUpcomingOccasions(
  occasions: UpcomingOccasionSource[],
  peopleById: Map<string, { name: string }>,
  fromLocalDate: string,
  withinDays: number
): UpcomingOccasion[] {
  const out: UpcomingOccasion[] = [];
  for (const occasion of occasions) {
    const person = peopleById.get(occasion.savedPersonId);
    if (!person) continue;
    const next = nextOccurrence(occasion, fromLocalDate);
    if (!next || next.daysUntil > withinDays) continue;
    out.push({
      occasionId: occasion.id,
      personId: occasion.savedPersonId,
      personName: person.name,
      kind: occasion.kind,
      label: occasion.label,
      date: next.date,
      daysUntil: next.daysUntil,
      turning: next.turning,
      observedFromLeapDay: next.observedFromLeapDay,
      surfaced: isOccasionSurfaced(next.daysUntil, occasion.remindDaysBefore),
    });
  }
  return out.sort((a, b) => a.daysUntil - b.daysUntil || a.personName.localeCompare(b.personName));
}

/* ------------------------------------------------------------------ */
/* AURA-MP-3 -- Home special-day card (design 4.4 / 5.7)                */
/* ------------------------------------------------------------------ */

/**
 * The Home card shows a SURFACED special day (0 <= daysUntil <=
 * remindDaysBefore) at most once ahead and once on the day:
 *   - ahead (daysUntil > 0): "Not now" hides it until the day itself;
 *     "Not this year" hides it for this occurrence;
 *   - on the day (daysUntil = 0): either choice ends it for this occurrence.
 * Each choice is one ReminderAttention row keyed by the RESOLVED occurrence
 * date (calendar-neutral), so the dismissal never carries into next year
 * and a changed date is a new occurrence.
 */
export type OccasionDismissScope = 'NOT_NOW' | 'NOT_THIS_YEAR';

export function occasionDismissalKeys(occurrenceDate: string): { yearKey: string; aheadKey: string } {
  const { year, month, day } = parseCivilDate(occurrenceDate);
  const dayBefore = new Date(Date.UTC(year, month - 1, day - 1));
  return {
    // "Not this year" / handled on the day (design: reminderAt = the occurrence date).
    yearKey: `${occurrenceDate}T00:00:00.000Z`,
    // "Not now" ahead of the day: a distinct, deterministic key for the same occurrence.
    aheadKey: `${dayBefore.toISOString().slice(0, 10)}T12:00:00.000Z`,
  };
}

/** Which key a dismissal writes. On the day, "Not now" also ends it for the year. */
export function dismissalKeyFor(occurrenceDate: string, daysUntil: number, scope: OccasionDismissScope): string {
  const keys = occasionDismissalKeys(occurrenceDate);
  return scope === 'NOT_NOW' && daysUntil > 0 ? keys.aheadKey : keys.yearKey;
}

/** Hidden from Home right now, given the owner's stored keys (ISO strings). */
export function isOccasionDismissedOnHome(occurrenceDate: string, daysUntil: number, storedKeys: Set<string>): boolean {
  const keys = occasionDismissalKeys(occurrenceDate);
  if (storedKeys.has(keys.yearKey)) return true;
  return daysUntil > 0 && storedKeys.has(keys.aheadKey);
}
