/**
 * AURA-MP-3 (62018) -- pure rules for the Home special-day card and for
 * starting a plan with a person. Run (CI: math-core-tests):
 *
 *   npx ts-node test/myPeopleMp3Ui.test.ts
 */
import { dismissalKeyFor, isOccasionDismissedOnHome, occasionDismissalKeys } from '../apps/web/lib/personOccasions';
import {
  homeOccasionHeadline,
  planHandoffForOccasion,
  planHandoffForPerson,
  selectHomeOccasion,
  type UpcomingRow,
} from '../apps/web/lib/myPeopleOccasionUi';

let failed = 0;
let count = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  count++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${!ok && detail !== undefined ? ` -- ${JSON.stringify(detail)}` : ''}`);
  if (!ok) failed++;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const row = (p: Partial<UpcomingRow>): UpcomingRow => ({ occasionId: 'o', personId: 'p', personName: 'Ravi', kind: 'BIRTHDAY', label: null, date: '2026-12-05', daysUntil: 5, turning: null, observedFromLeapDay: false, surfaced: true, dismissed: false, ...p });

// ---- dismissal keys (design 4.4: keyed by the resolved occurrence) ----
const k = occasionDismissalKeys('2026-12-05');
check('year key is the occurrence date at 00:00Z (design: reminderAt = occurrence date)', k.yearKey === '2026-12-05T00:00:00.000Z');
check('ahead key is distinct and deterministic (day before, 12:00Z)', k.aheadKey === '2026-12-04T12:00:00.000Z');
check('keys roll over month and year boundaries', occasionDismissalKeys('2027-01-01').aheadKey === '2026-12-31T12:00:00.000Z' && occasionDismissalKeys('2028-03-01').aheadKey === '2028-02-29T12:00:00.000Z');
check('ahead: "Not now" writes the ahead key; "Not this year" writes the year key', dismissalKeyFor('2026-12-05', 3, 'NOT_NOW') === k.aheadKey && dismissalKeyFor('2026-12-05', 3, 'NOT_THIS_YEAR') === k.yearKey);
check('on the day: either choice ends it for this occurrence (year key)', dismissalKeyFor('2026-12-05', 0, 'NOT_NOW') === k.yearKey && dismissalKeyFor('2026-12-05', 0, 'NOT_THIS_YEAR') === k.yearKey);
check('"Not now" hides ahead of the day only -- the day itself shows once more', isOccasionDismissedOnHome('2026-12-05', 3, new Set([k.aheadKey])) && !isOccasionDismissedOnHome('2026-12-05', 0, new Set([k.aheadKey])));
check('"Not this year" hides ahead and on the day', isOccasionDismissedOnHome('2026-12-05', 3, new Set([k.yearKey])) && isOccasionDismissedOnHome('2026-12-05', 0, new Set([k.yearKey])));
check('a dismissal never carries into next year (different occurrence key)', !isOccasionDismissedOnHome('2027-12-05', 3, new Set([k.yearKey, k.aheadKey])));
const leap = occasionDismissalKeys('2027-02-28');
check('29 Feb observed on 28 Feb: keyed by the observed date', leap.yearKey === '2027-02-28T00:00:00.000Z' && isOccasionDismissedOnHome('2027-02-28', 2, new Set([leap.yearKey])));

// ---- one card at most ----
check('no card when nothing is surfaced', selectHomeOccasion([row({ surfaced: false })]) === null && selectHomeOccasion([]) === null);
check('no card for a dismissed day', selectHomeOccasion([row({ dismissed: true })]) === null);
const sel = selectHomeOccasion([row({ occasionId: 'late', daysUntil: 6 }), row({ occasionId: 'outside', daysUntil: 2, surfaced: false }), row({ occasionId: 'soon', daysUntil: 1, personName: 'Amma' }), row({ occasionId: 'gone', daysUntil: 0, dismissed: true })]);
check('ONE card: the soonest surfaced, not-dismissed day; others counted as "+N more"', sel?.item.occasionId === 'soon' && sel?.moreCount === 1, sel);

// ---- wording: factual, no guilt ----
const lines = [homeOccasionHeadline(row({ daysUntil: 0 })), homeOccasionHeadline(row({ daysUntil: 1, kind: 'ANNIVERSARY', personName: 'Amma' })), homeOccasionHeadline(row({ daysUntil: 5, kind: 'OTHER', label: 'Graduation' }))];
check('headlines: "Ravi\'s birthday is today" / "Amma\'s anniversary is tomorrow" / "Ravi · Graduation is in 5 days"', same(lines, ["Ravi's birthday is today", "Amma's anniversary is tomorrow", 'Ravi · Graduation is in 5 days']), lines);
check('headlines never use guilt or scoring words', !lines.some((l) => /haven't|forgot|overdue|neglect|score|streak|should|don't miss/i.test(l)));

// ---- plan hand-offs (pre-fill only) ----
check('person -> catch-up, no dates (Plan\'s normal horizon)', same(planHandoffForPerson('p1'), { personId: 'p1', activityId: 'catch-up' }));
check('birthday 5 days away -> birthday-party, the day either side', same(planHandoffForOccasion({ personId: 'p1', kind: 'BIRTHDAY', date: '2026-12-05', daysUntil: 5 }), { personId: 'p1', activityId: 'birthday-party', startDate: '2026-12-04', endDate: '2026-12-06' }));
check('anniversary tomorrow -> anniversary-dinner, window never starts before today', same(planHandoffForOccasion({ personId: 'p1', kind: 'ANNIVERSARY', date: '2026-12-05', daysUntil: 1 }), { personId: 'p1', activityId: 'anniversary-dinner', startDate: '2026-12-04', endDate: '2026-12-06' }));
check('other day today -> celebration-dinner, today to tomorrow', same(planHandoffForOccasion({ personId: 'p1', kind: 'OTHER', date: '2026-12-31', daysUntil: 0 }), { personId: 'p1', activityId: 'celebration-dinner', startDate: '2026-12-31', endDate: '2027-01-01' }));
check('29 Feb observed on 28 Feb (non-leap) -> window around the observed day', same(planHandoffForOccasion({ personId: 'p1', kind: 'BIRTHDAY', date: '2027-02-28', daysUntil: 10 }), { personId: 'p1', activityId: 'birthday-party', startDate: '2027-02-27', endDate: '2027-03-01' }));

console.log(failed === 0 ? `\nALL MY PEOPLE MP-3 UI CHECKS PASSED (${count})` : `\n${failed} MY PEOPLE MP-3 UI CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
