/**
 * AURA-MP-2 (62016) -- pure helpers for the My People special-day screens
 * (formatting, client-side validation and payload builders). No I/O, no
 * React. The MP-1 API stays the authority for every rule; these mirror it so
 * the form can refuse an invalid date before sending anything.
 *
 * Field contract (same as the person form, R4):
 *   - untouched optional fields are omitted; the API default stands
 *     (remindDaysBefore -> 7, a week before and on the day, D5);
 *   - an edit sends only changed fields; clearing the year sends null;
 *   - nothing is inferred: no year, label or reminder is filled in unless the
 *     user chose it (a chart birth date is copied only on request, D3);
 *   - invalid dates are refused before any request (29 Feb is accepted, and
 *     with a year only in a leap year; D4 / design 11.3).
 */
import { isLeapYear, isValidMonthDay } from './personOccasions';

export type OccasionKind = 'BIRTHDAY' | 'ANNIVERSARY' | 'OTHER';

export interface OccasionRow {
  id: string;
  kind: OccasionKind;
  label: string | null;
  month: number | null;
  day: number | null;
  year: number | null;
  remindDaysBefore: number | null;
  next: { date: string; daysUntil: number; turning: number | null; observedFromLeapDay: boolean } | null;
}

export interface UpcomingRow {
  occasionId: string;
  personId: string;
  personName: string;
  kind: OccasionKind;
  label: string | null;
  date: string;
  daysUntil: number;
  turning: number | null;
  observedFromLeapDay: boolean;
  surfaced: boolean;
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const OCCASION_LIMIT_PER_PERSON = 10;
export const KIND_ICON: Record<OccasionKind, string> = { BIRTHDAY: '🎂', ANNIVERSARY: '💍', OTHER: '📅' };
export const KIND_NAME: Record<OccasionKind, string> = { BIRTHDAY: 'Birthday', ANNIVERSARY: 'Anniversary', OTHER: 'Special day' };

/** In-app reminder choices (D5). The API default is 7: a week before and on the day. */
export const REMINDER_DEFAULT = 7;
export const REMINDER_CHOICES: Array<{ value: string; days: number | null; label: string }> = [
  { value: '7', days: 7, label: 'A week before and on the day' },
  { value: '0', days: 0, label: 'On the day only' },
  { value: 'off', days: null, label: 'No reminder' },
];
const reminderValue = (days: number | null) => (days == null ? 'off' : String(days));

export function reminderLabel(days: number | null): string {
  if (days == null) return 'No reminder';
  if (days === 0) return 'Reminder on the day';
  if (days === 7) return 'Reminder a week before and on the day';
  return `Reminder ${days} day${days === 1 ? '' : 's'} before and on the day`;
}

/** "Sat 5 Dec" from "YYYY-MM-DD" (a civil date: computed in UTC, never shifted). */
export function formatCivilDay(date: string): string {
  const [y, m, d] = date.split('-').map((n) => parseInt(n, 10));
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${d} ${MONTHS[m - 1].slice(0, 3)}`;
}

/** The saved date itself: "5 December", "5 December 1990", "29 February". */
export function formatSavedDay(month: number | null, day: number | null, year: number | null): string {
  if (month == null || day == null) return '';
  return `${day} ${MONTHS[month - 1]}${year != null ? ` ${year}` : ''}`;
}

export function describeDaysUntil(daysUntil: number): string {
  if (daysUntil === 0) return 'Today';
  if (daysUntil === 1) return 'Tomorrow';
  return `In ${daysUntil} days`;
}

const ordinal = (n: number) => {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
};

/** "Turns 40" / "10th anniversary" -- only when the year is known (turning > 0). */
export function turningText(kind: OccasionKind, turning: number | null): string | null {
  if (turning == null || turning <= 0) return null;
  if (kind === 'BIRTHDAY') return `Turns ${turning}`;
  if (kind === 'ANNIVERSARY') return `${ordinal(turning)} anniversary`;
  return null;
}

/** "Ravi's birthday", "Amma's anniversary", "Ravi · Graduation". */
export function occasionTitle(kind: OccasionKind, label: string | null, personName?: string): string {
  if (kind === 'OTHER') return personName ? `${personName} · ${label ?? 'Special day'}` : label ?? 'Special day';
  const what = kind === 'BIRTHDAY' ? 'birthday' : 'anniversary';
  return personName ? `${personName}'s ${what}` : KIND_NAME[kind];
}

/** "Sat 5 Dec · In 9 days" plus the 29 Feb note (D4). */
export function nextLine(next: { date: string; daysUntil: number; observedFromLeapDay: boolean }): string {
  return `${formatCivilDay(next.date)}${next.observedFromLeapDay ? ' (for 29 Feb)' : ''} · ${describeDaysUntil(next.daysUntil)}`;
}

export interface OccasionFormValues {
  kind: OccasionKind;
  label: string;
  month: string; // '' | '1'..'12'
  day: string; // '' | '1'..'31'
  year: string; // '' = unknown (optional)
  reminder: string; // REMINDER_CHOICES value, or a preserved saved value
}

type OccasionPayload = { ok: true; body: Record<string, unknown> | null } | { ok: false; error: string };

/** Client-side check mirroring the API (design 11.3); the server still decides. */
export function validateOccasionValues(values: OccasionFormValues, currentYear: number): string | null {
  const month = Number(values.month);
  const day = Number(values.day);
  if (!values.month || !values.day) return 'Choose a day and a month.';
  if (!isValidMonthDay(month, day)) return `${MONTHS[month - 1]} doesn't have a day ${day}.`;
  if (values.year.trim()) {
    const year = Number(values.year);
    if (!/^\d{4}$/.test(values.year.trim()) || year < 1900 || year > currentYear) return `The year must be between 1900 and ${currentYear}, or left empty.`;
    if (month === 2 && day === 29 && !isLeapYear(year)) return `${year} wasn't a leap year, so it has no 29 February. Check the year, or leave it empty.`;
  }
  if (values.kind === 'OTHER' && !values.label.trim()) return 'Give this day a name, for example "Graduation".';
  if (values.label.trim().length > 60) return 'The name must be 60 characters or fewer.';
  return null;
}

const reminderDays = (value: string): number | null => (value === 'off' ? null : Number(value));

export function buildOccasionCreatePayload(values: OccasionFormValues, currentYear: number, reminderTouched: boolean): OccasionPayload {
  const error = validateOccasionValues(values, currentYear);
  if (error) return { ok: false, error };
  const body: Record<string, unknown> = { kind: values.kind, month: Number(values.month), day: Number(values.day) };
  if (values.year.trim()) body.year = Number(values.year);
  if (values.kind === 'OTHER') body.label = values.label.trim();
  if (reminderTouched) body.remindDaysBefore = reminderDays(values.reminder);
  return { ok: true, body };
}

export function occasionToValues(o: OccasionRow): OccasionFormValues {
  return {
    kind: o.kind,
    label: o.label ?? '',
    month: o.month != null ? String(o.month) : '',
    day: o.day != null ? String(o.day) : '',
    year: o.year != null ? String(o.year) : '',
    reminder: reminderValue(o.remindDaysBefore),
  };
}

/** Only changed fields; a cleared year is sent as null. No change -> null body. */
export function buildOccasionEditPayload(original: OccasionRow, values: OccasionFormValues, currentYear: number): OccasionPayload {
  const error = validateOccasionValues(values, currentYear);
  if (error) return { ok: false, error };
  const before = occasionToValues(original);
  const body: Record<string, unknown> = {};
  if (values.month !== before.month) body.month = Number(values.month);
  if (values.day !== before.day) body.day = Number(values.day);
  if (values.year.trim() !== before.year) body.year = values.year.trim() ? Number(values.year) : null;
  if (values.kind === 'OTHER' && values.label.trim() !== before.label) body.label = values.label.trim();
  if (values.reminder !== before.reminder) body.remindDaysBefore = reminderDays(values.reminder);
  return { ok: true, body: Object.keys(body).length > 0 ? body : null };
}

/** D3: the chart birth date, offered for an explicit copy only ("YYYY-MM-DD" -> values). */
export function birthdayFromChartDate(birthDate: string | null | undefined): { month: number; day: number; year: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDate ?? '');
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

