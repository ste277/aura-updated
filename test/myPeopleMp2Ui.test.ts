/**
 * AURA-MP-2 (62016) -- pure special-day UI helpers (lib/myPeopleOccasionUi.ts):
 * formatting, optional year, 29 February, reminder choices, and the
 * untouched / changed / cleared payload contract. Run (CI: math-core-tests):
 *
 *   npx ts-node test/myPeopleMp2Ui.test.ts
 */
import {
  birthdayFromChartDate,
  buildOccasionCreatePayload,
  buildOccasionEditPayload,
  describeDaysUntil,
  formatCivilDay,
  formatSavedDay,
  nextLine,
  occasionTitle,
  reminderLabel,
  turningText,
  validateOccasionValues,
  type OccasionFormValues,
  type OccasionRow,
} from '../apps/web/lib/myPeopleOccasionUi';

let failed = 0;
let count = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  count++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${!ok && detail !== undefined ? ` -- ${JSON.stringify(detail)}` : ''}`);
  if (!ok) failed++;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const V = (p: Partial<OccasionFormValues>): OccasionFormValues => ({ kind: 'BIRTHDAY', label: '', month: '12', day: '5', year: '', reminder: '7', ...p });
const Y = 2026;

// ---- formatting ----
check('civil day: 2026-12-05 is "Sat 5 Dec" (no timezone shift)', formatCivilDay('2026-12-05') === 'Sat 5 Dec');
check('civil day: 2027-01-01 is "Fri 1 Jan" (year rollover)', formatCivilDay('2027-01-01') === 'Fri 1 Jan');
check('saved day without a year: "5 December"', formatSavedDay(12, 5, null) === '5 December');
check('saved day with a year: "29 February 2000"', formatSavedDay(2, 29, 2000) === '29 February 2000');
check('days until: Today / Tomorrow / In 9 days', describeDaysUntil(0) === 'Today' && describeDaysUntil(1) === 'Tomorrow' && describeDaysUntil(9) === 'In 9 days');
check('29 Feb observed on 28 Feb is labelled "(for 29 Feb)" (D4)', nextLine({ date: '2027-02-28', daysUntil: 3, observedFromLeapDay: true }) === 'Sun 28 Feb (for 29 Feb) · In 3 days');
check('turning: birthday "Turns 40"; anniversary ordinals 1st/2nd/3rd/11th/12th/13th/21st', turningText('BIRTHDAY', 40) === 'Turns 40' && ['1st', '2nd', '3rd', '11th', '12th', '13th', '21st', '112th'].every((o, i) => turningText('ANNIVERSARY', [1, 2, 3, 11, 12, 13, 21, 112][i]) === `${o} anniversary`));
check('turning: unknown year (null) or 0 shows nothing; OTHER never shows a count', turningText('BIRTHDAY', null) === null && turningText('BIRTHDAY', 0) === null && turningText('OTHER', 5) === null);
check('titles: "Ravi\'s birthday", "Amma\'s anniversary", "Ravi · Graduation"', occasionTitle('BIRTHDAY', null, 'Ravi') === "Ravi's birthday" && occasionTitle('ANNIVERSARY', null, 'Amma') === "Amma's anniversary" && occasionTitle('OTHER', 'Graduation', 'Ravi') === 'Ravi · Graduation');
check('reminder labels: 7 / 0 / null / other', reminderLabel(7) === 'Reminder a week before and on the day' && reminderLabel(0) === 'Reminder on the day' && reminderLabel(null) === 'No reminder' && reminderLabel(3) === 'Reminder 3 days before and on the day');

// ---- validation (mirrors the API, design 11.3) ----
check('valid: 5 December, no year', validateOccasionValues(V({}), Y) === null);
check('valid: 29 February without a year', validateOccasionValues(V({ month: '2', day: '29' }), Y) === null);
check('valid: 29 February 2000 (leap year)', validateOccasionValues(V({ month: '2', day: '29', year: '2000' }), Y) === null);
check('refused: 29 February 2001 (not a leap year), with a clear message', /wasn't a leap year/.test(validateOccasionValues(V({ month: '2', day: '29', year: '2001' }), Y) ?? ''));
check('refused: 29 February 1900 (century, not a leap year)', validateOccasionValues(V({ month: '2', day: '29', year: '1900' }), Y) !== null);
check('refused: 31 April and 30 February', validateOccasionValues(V({ month: '4', day: '31' }), Y) !== null && validateOccasionValues(V({ month: '2', day: '30' }), Y) !== null);
check('refused: no day or no month', validateOccasionValues(V({ day: '' }), Y) !== null && validateOccasionValues(V({ month: '' }), Y) !== null);
check('refused: year before 1900, after this year, or not 4 digits', [ '1899', '2027', '99' ].every((y) => validateOccasionValues(V({ year: y }), Y) !== null));
check('valid: year exactly 1900 and exactly this year', validateOccasionValues(V({ year: '1900' }), Y) === null && validateOccasionValues(V({ year: '2026' }), Y) === null);
check('refused: another important date without a name', validateOccasionValues(V({ kind: 'OTHER', label: '  ' }), Y) !== null);

// ---- create payload: untouched optional fields omitted ----
const c1 = buildOccasionCreatePayload(V({}), Y, false);
check('create: birthday, no year, reminder untouched -> exactly {kind, month, day} (API default 7 applies)', c1.ok && same(c1.body, { kind: 'BIRTHDAY', month: 12, day: 5 }), c1);
const c2 = buildOccasionCreatePayload(V({ kind: 'ANNIVERSARY', year: '2012', reminder: '0' }), Y, true);
check('create: anniversary with a year, "on the day only" chosen -> year and remindDaysBefore 0 sent', c2.ok && same(c2.body, { kind: 'ANNIVERSARY', month: 12, day: 5, year: 2012, remindDaysBefore: 0 }), c2);
const c3 = buildOccasionCreatePayload(V({ kind: 'OTHER', label: ' Graduation ', reminder: 'off' }), Y, true);
check('create: other date -> trimmed label; "No reminder" -> remindDaysBefore null', c3.ok && same(c3.body, { kind: 'OTHER', month: 12, day: 5, label: 'Graduation', remindDaysBefore: null }), c3);
const c4 = buildOccasionCreatePayload(V({ label: 'ignored' }), Y, false);
check('create: a label is never sent for a birthday', c4.ok && !('label' in (c4.body ?? {})), c4);
check('create: invalid date -> refused, no body', !buildOccasionCreatePayload(V({ month: '2', day: '29', year: '2023' }), Y, false).ok);

// ---- edit payload: only changed fields; cleared year -> null ----
const saved: OccasionRow = { id: 'o1', kind: 'BIRTHDAY', label: null, month: 12, day: 5, year: 1990, remindDaysBefore: 7, next: null };
const e0 = buildOccasionEditPayload(saved, V({ year: '1990' }), Y);
check('edit: no change -> no request (null body)', e0.ok && e0.body === null, e0);
const e1 = buildOccasionEditPayload(saved, V({ year: '' }), Y);
check('edit: clearing the year -> exactly {year: null}', e1.ok && same(e1.body, { year: null }), e1);
const e2 = buildOccasionEditPayload(saved, V({ year: '1990', reminder: 'off' }), Y);
check('edit: reminder off -> exactly {remindDaysBefore: null}', e2.ok && same(e2.body, { remindDaysBefore: null }), e2);
const e3 = buildOccasionEditPayload(saved, V({ year: '1990', day: '6' }), Y);
check('edit: day only -> exactly {day: 6}', e3.ok && same(e3.body, { day: 6 }), e3);
const custom: OccasionRow = { ...saved, remindDaysBefore: 3 };
const e4 = buildOccasionEditPayload(custom, V({ year: '1990', reminder: '3' }), Y);
check('edit: a saved reminder outside the three choices (3 days) is kept -> no request', e4.ok && e4.body === null, e4);

// ---- explicit chart copy (D3) ----
check('chart birth date -> birthday values only when complete', same(birthdayFromChartDate('2000-02-29'), { year: 2000, month: 2, day: 29 }) && birthdayFromChartDate('') === null && birthdayFromChartDate(null) === null && birthdayFromChartDate('2000-02') === null);

console.log(failed === 0 ? `\nALL MY PEOPLE MP-2 UI CHECKS PASSED (${count})` : `\n${failed} MY PEOPLE MP-2 UI CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
