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
  /** AURA-MP-3: hidden from the Home card right now ("Not now" / "Not this year"). */
  dismissed?: boolean;
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


/** "Coming up" shows the next 30 days (design 4.2 default). */
export const COMING_UP_DAYS = 30;
/**
 * The people list shows a person's next special day when it is within 60
 * days -- the upcoming API's maximum window, so every day the list shows is
 * also in the upcoming data, which carries the 29 Feb flag (D4).
 */
export const LIST_NEXT_OCCASION_DAYS = 60;

/**
 * The people-list line for a person's next special day, with the same
 * "(for 29 Feb)" annotation as Coming up and the detail page. The list API
 * item does not carry the leap-day flag, so it is taken from the upcoming
 * data for the same occasion (never inferred from the date alone: a real
 * 28 February is not annotated).
 */
export function personNextOccasionLine(
  next: { id: string; date: string; daysUntil: number },
  upcoming: Array<Pick<UpcomingRow, 'occasionId' | 'observedFromLeapDay'>>
): string {
  const observedFromLeapDay = upcoming.find((u) => u.occasionId === next.id)?.observedFromLeapDay ?? false;
  return nextLine({ date: next.date, daysUntil: next.daysUntil, observedFromLeapDay });
}

/* ------------------------------------------------------------------ */
/* AURA-MP-3 -- planning with a person and the Home special-day card     */
/* ------------------------------------------------------------------ */

/**
 * A hand-off into Plan's normal Find a Time flow. It only PRE-FILLS the
 * form: the user still runs Find, reviews the results and explicitly saves
 * one. `personId` becomes the plan's My People link; the person's own
 * availability is never assumed (Find uses the user's own availability,
 * Daily Rhythm and Panchang ranking only).
 */
export interface PersonPlanHandoff {
  personId: string;
  activityId: string;
  /** Optional date window (YYYY-MM-DD, inclusive) -> Plan's custom range. */
  startDate?: string;
  endDate?: string;
}

/** Catalog activities used to start a plan (all allow a companion). */
export const PLAN_WITH_PERSON_ACTIVITY = 'catch-up';
const CELEBRATION_ACTIVITY: Record<OccasionKind, string> = { BIRTHDAY: 'birthday-party', ANNIVERSARY: 'anniversary-dinner', OTHER: 'celebration-dinner' };

/** "Plan time with Ravi": a catch-up, any time (Plan's default horizon). */
export function planHandoffForPerson(personId: string): PersonPlanHandoff {
  return { personId, activityId: PLAN_WITH_PERSON_ACTIVITY };
}

function shiftCivilDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Occasion -> plan (design 5.6). The occasion date is respected: the window
 * is the day itself and the day either side, never starting before today
 * (`daysUntil` days before the occurrence).
 */
export function planHandoffForOccasion(o: { personId: string; kind: OccasionKind; date: string; daysUntil: number }): PersonPlanHandoff {
  const today = shiftCivilDate(o.date, -o.daysUntil);
  const start = shiftCivilDate(o.date, -1) < today ? today : shiftCivilDate(o.date, -1);
  return { personId: o.personId, activityId: CELEBRATION_ACTIVITY[o.kind], startDate: start, endDate: shiftCivilDate(o.date, 1) };
}

/**
 * The ONE Home card (design 5.7): the soonest special day inside its own
 * reminder window that has not been dismissed for now. `moreCount` = other
 * such days (shown as "+N more", linking to My People). Never a card for a
 * day outside its window, and never more than one.
 */
export function selectHomeOccasion(upcoming: UpcomingRow[]): { item: UpcomingRow; moreCount: number } | null {
  const eligible = upcoming.filter((u) => u.surfaced && !u.dismissed).sort((a, b) => a.daysUntil - b.daysUntil || a.personName.localeCompare(b.personName));
  if (eligible.length === 0) return null;
  return { item: eligible[0], moreCount: eligible.length - 1 };
}

/** Warm, factual Home wording -- no counts of neglect, no scores. */
export function homeOccasionHeadline(item: Pick<UpcomingRow, 'kind' | 'label' | 'personName' | 'daysUntil'>): string {
  const what = occasionTitle(item.kind, item.label, item.personName);
  if (item.daysUntil === 0) return `${what} is today`;
  if (item.daysUntil === 1) return `${what} is tomorrow`;
  return `${what} is in ${item.daysUntil} days`;
}
