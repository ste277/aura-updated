/**
 * Availability Settings V1 -- PR H2 pure-logic regression suite.
 * Exercises `availabilitySettings.ts` entirely as pure functions -- no
 * DB, no network, no React rendering (this repo's own established
 * convention: pure helpers are tested directly, never the component).
 */
import {
  WEEKDAY_LABELS,
  createEmptyWeekDraft,
  hydrateWeekDraft,
  addPeriod,
  removePeriod,
  updatePeriodTime,
  copyMondayToWeekdays,
  validateWeekDraft,
  flattenWeekDraft,
  periodsOverlap,
  formatPeriodTimeLabel,
  formatWeekdaySummary,
  type WeekAvailabilityDraft,
} from '../apps/web/lib/availabilitySettings';
import type { AvailabilityPeriodInput } from '../apps/web/lib/availabilityContext';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function weekdayPeriods(draft: WeekAvailabilityDraft, weekday: number) {
  return draft.find((d) => d.weekday === weekday)!.periods;
}

function main() {
  // ============================================================
  // 1. Seven weekdays represented.
  // ============================================================
  {
    const draft = createEmptyWeekDraft();
    check('1. createEmptyWeekDraft represents exactly seven weekdays, 0-6 in order', draft.length === 7 && draft.every((d, i) => d.weekday === i));
    check('1b. WEEKDAY_LABELS has exactly seven labels, index 0 = Sunday', WEEKDAY_LABELS.length === 7 && WEEKDAY_LABELS[0] === 'Sunday' && WEEKDAY_LABELS[1] === 'Monday' && WEEKDAY_LABELS[6] === 'Saturday');
    check('1c. every weekday starts with zero periods (never an inferred schedule)', draft.every((d) => d.periods.length === 0));
  }

  // ============================================================
  // 2/3/4. zero / one / multiple periods per day.
  // ============================================================
  {
    const periods: AvailabilityPeriodInput[] = [
      { weekday: 1, startTime: '09:00', endTime: '17:00' },
      { weekday: 3, startTime: '09:00', endTime: '12:00' },
      { weekday: 3, startTime: '14:00', endTime: '17:30' },
    ];
    const draft = hydrateWeekDraft(periods);
    check('2. a weekday with no submitted periods hydrates to zero periods (Not available)', weekdayPeriods(draft, 0).length === 0);
    check('3. a weekday with one submitted period hydrates to exactly one', weekdayPeriods(draft, 1).length === 1);
    check('4. a weekday with multiple submitted periods hydrates to all of them', weekdayPeriods(draft, 3).length === 2);
  }

  // ============================================================
  // 5. Add period.
  // ============================================================
  {
    const draft = addPeriod(createEmptyWeekDraft(), 2);
    check('5. addPeriod creates one new period on the target weekday only', weekdayPeriods(draft, 2).length === 1 && weekdayPeriods(draft, 1).length === 0);
    check('5b. a new period has a reasonable default start/end, never inferred from a clock', weekdayPeriods(draft, 2)[0].startTime === '09:00' && weekdayPeriods(draft, 2)[0].endTime === '17:00');
  }

  // ============================================================
  // 6/7. Remove period / remove final period -> Not available.
  // ============================================================
  {
    let draft = addPeriod(createEmptyWeekDraft(), 4);
    draft = addPeriod(draft, 4);
    check('6. two periods exist before removal', weekdayPeriods(draft, 4).length === 2);
    const idToRemove = weekdayPeriods(draft, 4)[0].id;
    draft = removePeriod(draft, 4, idToRemove);
    check('6b. removePeriod removes exactly the targeted period', weekdayPeriods(draft, 4).length === 1 && weekdayPeriods(draft, 4)[0].id !== idToRemove);
    const lastId = weekdayPeriods(draft, 4)[0].id;
    draft = removePeriod(draft, 4, lastId);
    check('7. removing the final period leaves the weekday at zero periods (Not available)', weekdayPeriods(draft, 4).length === 0);
    check('7b. removing the final period on one weekday never touches other weekdays', draft.every((d) => d.weekday === 4 || d.periods.length === 0));
  }

  // ============================================================
  // 8/9/10/11. Copy Monday to weekdays.
  // ============================================================
  {
    let draft = addPeriod(createEmptyWeekDraft(), 1); // Monday
    draft = updatePeriodTime(draft, 1, weekdayPeriods(draft, 1)[0].id, 'startTime', '09:00');
    draft = addPeriod(draft, 1); // Monday gets a second period.
    draft = updatePeriodTime(draft, 1, weekdayPeriods(draft, 1)[1].id, 'startTime', '14:00');
    draft = updatePeriodTime(draft, 1, weekdayPeriods(draft, 1)[1].id, 'endTime', '17:30');
    // Pre-existing Tue value that must be REPLACED, not merged with.
    draft = addPeriod(draft, 2);
    draft = updatePeriodTime(draft, 2, weekdayPeriods(draft, 2)[0].id, 'startTime', '06:00');
    draft = updatePeriodTime(draft, 2, weekdayPeriods(draft, 2)[0].id, 'endTime', '07:00');

    const mondayBefore = weekdayPeriods(draft, 1).map((p) => ({ start: p.startTime, end: p.endTime }));
    const copied = copyMondayToWeekdays(draft);

    check('8. Copy Monday to weekdays copies Monday\'s period count to Tuesday', weekdayPeriods(copied, 2).length === mondayBefore.length);
    check('9. Copy Monday to weekdays copies BOTH periods exactly (multi-period Monday)', weekdayPeriods(copied, 5).map((p) => `${p.startTime}-${p.endTime}`).join(',') === mondayBefore.map((p) => `${p.start}-${p.end}`).join(','));
    check('10. Copy Monday to weekdays never touches Saturday/Sunday', weekdayPeriods(copied, 6).length === 0 && weekdayPeriods(copied, 0).length === 0);
    check('10b. Copy Monday to weekdays never touches Monday itself', weekdayPeriods(copied, 1).length === mondayBefore.length);
    check('11. Copy Monday to weekdays REPLACES Tuesday\'s prior value (06:00-07:00 gone)', !weekdayPeriods(copied, 2).some((p) => p.startTime === '06:00'));
  }

  // ============================================================
  // 12. Deterministic sorting.
  // ============================================================
  {
    const periods: AvailabilityPeriodInput[] = [
      { weekday: 1, startTime: '14:00', endTime: '17:00' },
      { weekday: 1, startTime: '09:00', endTime: '12:00' },
    ];
    const draft = hydrateWeekDraft(periods);
    check('12. hydrateWeekDraft sorts periods by startTime regardless of input order', weekdayPeriods(draft, 1)[0].startTime === '09:00' && weekdayPeriods(draft, 1)[1].startTime === '14:00');

    const flattened = flattenWeekDraft(hydrateWeekDraft([{ weekday: 3, startTime: '09:00', endTime: '12:00' }, { weekday: 1, startTime: '09:00', endTime: '12:00' }]));
    check('12b. flattenWeekDraft sorts by weekday first', flattened[0].weekday === 1 && flattened[1].weekday === 3);
  }

  // ============================================================
  // 13/14/15/16. Invalid HH:mm / start==end / start>end / cross-midnight.
  // ============================================================
  {
    let draft = addPeriod(createEmptyWeekDraft(), 1);
    draft = updatePeriodTime(draft, 1, weekdayPeriods(draft, 1)[0].id, 'startTime', '9:00'); // not zero-padded
    check('13. an invalid (non-zero-padded) HH:mm is rejected', validateWeekDraft(draft).ok === false);
  }
  {
    let draft = addPeriod(createEmptyWeekDraft(), 1);
    const id = weekdayPeriods(draft, 1)[0].id;
    draft = updatePeriodTime(draft, 1, id, 'startTime', '09:00');
    draft = updatePeriodTime(draft, 1, id, 'endTime', '09:00');
    check('14. start === end is rejected', validateWeekDraft(draft).ok === false);
  }
  {
    let draft = addPeriod(createEmptyWeekDraft(), 1);
    const id = weekdayPeriods(draft, 1)[0].id;
    draft = updatePeriodTime(draft, 1, id, 'startTime', '17:00');
    draft = updatePeriodTime(draft, 1, id, 'endTime', '09:00');
    check('15. start > end is rejected', validateWeekDraft(draft).ok === false);
  }
  {
    let draft = addPeriod(createEmptyWeekDraft(), 5);
    const id = weekdayPeriods(draft, 5)[0].id;
    draft = updatePeriodTime(draft, 5, id, 'startTime', '20:00');
    draft = updatePeriodTime(draft, 5, id, 'endTime', '01:00');
    check('16. a cross-midnight period (20:00-01:00) is rejected, never auto-split', validateWeekDraft(draft).ok === false);
  }

  // ============================================================
  // 17/18. Overlap rejected, touching-period policy.
  // ============================================================
  {
    check('17a. periodsOverlap: 09-12 and 11-14 DO overlap', periodsOverlap({ startTime: '09:00', endTime: '12:00' }, { startTime: '11:00', endTime: '14:00' }) === true);
    check('17b. periodsOverlap: 09-12 and 12-14 (touching) do NOT overlap', periodsOverlap({ startTime: '09:00', endTime: '12:00' }, { startTime: '12:00', endTime: '14:00' }) === false);
    check('17c. periodsOverlap: 09-12 and 14-18 (disjoint) do NOT overlap', periodsOverlap({ startTime: '09:00', endTime: '12:00' }, { startTime: '14:00', endTime: '18:00' }) === false);

    let draft = addPeriod(createEmptyWeekDraft(), 2);
    draft = addPeriod(draft, 2);
    const [first, second] = weekdayPeriods(draft, 2);
    draft = updatePeriodTime(draft, 2, first.id, 'startTime', '09:00');
    draft = updatePeriodTime(draft, 2, first.id, 'endTime', '12:00');
    draft = updatePeriodTime(draft, 2, second.id, 'startTime', '11:00');
    draft = updatePeriodTime(draft, 2, second.id, 'endTime', '14:00');
    check('17. validateWeekDraft rejects two overlapping periods on the same weekday', validateWeekDraft(draft).ok === false);
  }
  {
    // 18. touching-period policy: chosen to ACCEPT (this ticket's own
    // section 17 locked recommendation) -- never rejected, never
    // silently merged into one row by this pure module (H1's own
    // resolver handles merging at resolution time).
    let draft = addPeriod(createEmptyWeekDraft(), 2);
    draft = addPeriod(draft, 2);
    const [first, second] = weekdayPeriods(draft, 2);
    draft = updatePeriodTime(draft, 2, first.id, 'startTime', '09:00');
    draft = updatePeriodTime(draft, 2, first.id, 'endTime', '12:00');
    draft = updatePeriodTime(draft, 2, second.id, 'startTime', '12:00');
    draft = updatePeriodTime(draft, 2, second.id, 'endTime', '14:00');
    const result = validateWeekDraft(draft);
    check('18. touching periods (09-12, 12-14) are ACCEPTED (chosen policy), never rejected', result.ok === true);
    check('18b. touching periods are NOT silently merged into one row by this module', weekdayPeriods(draft, 2).length === 2);
  }

  // ============================================================
  // 19. Empty whole week is valid.
  // ============================================================
  {
    const draft = createEmptyWeekDraft();
    check('19. an entirely empty week passes validation', validateWeekDraft(draft).ok === true);
    check('19b. an entirely empty week flattens to an empty array, not rejected', flattenWeekDraft(draft).length === 0);
  }

  // ============================================================
  // 20. No timezone in the persistence payload.
  // ============================================================
  {
    const draft = hydrateWeekDraft([{ weekday: 1, startTime: '09:00', endTime: '17:00' }]);
    const flattened = flattenWeekDraft(draft);
    check('20. the flattened persistence payload never contains a timezone field', flattened.every((p) => !('timezone' in p)));
    check('20b. the flattened persistence payload never contains the draft-only local id field', flattened.every((p) => !('id' in p)));
  }

  // ============================================================
  // Availability Settings UX V2 PR A -- collapsed-summary display
  // helpers (this ticket's own section 8/9/17/48/49). Presentation-only:
  // never consumed by validation/flatten/persistence above.
  // ============================================================

  // 21. formatPeriodTimeLabel -- "HH:mm" -> "H:MM AM/PM".
  check('21. formatPeriodTimeLabel("09:00") === "9:00 AM"', formatPeriodTimeLabel('09:00') === '9:00 AM');
  check('21b. formatPeriodTimeLabel("17:00") === "5:00 PM"', formatPeriodTimeLabel('17:00') === '5:00 PM');
  check('21c. formatPeriodTimeLabel("00:00") === "12:00 AM" (midnight, not "0:00 AM")', formatPeriodTimeLabel('00:00') === '12:00 AM');
  check('21d. formatPeriodTimeLabel("12:00") === "12:00 PM" (noon, not "0:00 PM")', formatPeriodTimeLabel('12:00') === '12:00 PM');
  check('21e. formatPeriodTimeLabel never mutates its input (pure)', (() => { const t = '09:30'; formatPeriodTimeLabel(t); return t === '09:30'; })());

  // 22. formatWeekdaySummary -- empty day (this ticket's own section 9,
  // wording LOCKED verbatim -- never "Unavailable"/"Off"/"Closed"/"No
  // working hours").
  check('22. formatWeekdaySummary([]) === "Not available"', formatWeekdaySummary([]) === 'Not available');

  // 23. formatWeekdaySummary -- one period (this ticket's own section 8).
  check(
    '23. formatWeekdaySummary([{09:00-17:00}]) === "9:00 AM – 5:00 PM"',
    formatWeekdaySummary([{ startTime: '09:00', endTime: '17:00' }]) === '9:00 AM – 5:00 PM'
  );

  // 24. formatWeekdaySummary -- multiple periods, joined, never exposing
  // "Period 1"/"Period 2" (this ticket's own section 8).
  {
    const summary = formatWeekdaySummary([
      { startTime: '09:00', endTime: '12:00' },
      { startTime: '14:00', endTime: '17:00' },
    ]);
    check('24. formatWeekdaySummary joins two periods with " · "', summary === '9:00 AM – 12:00 PM · 2:00 PM – 5:00 PM');
    check('24b. formatWeekdaySummary never mentions "Period" in its output', !summary.includes('Period') && !summary.includes('period'));
  }

  // 25. formatWeekdaySummary -- sorts by startTime regardless of input
  // order (draft period order is insertion order, not necessarily
  // chronological -- addPeriod always appends).
  {
    const summary = formatWeekdaySummary([
      { startTime: '14:00', endTime: '17:00' },
      { startTime: '09:00', endTime: '12:00' },
    ]);
    check('25. formatWeekdaySummary sorts periods chronologically regardless of input order', summary === '9:00 AM – 12:00 PM · 2:00 PM – 5:00 PM');
  }

  // 26. formatWeekdaySummary never mutates its input (pure).
  check(
    '26. formatWeekdaySummary never mutates its input array',
    (() => {
      const periods = [{ startTime: '14:00', endTime: '17:00' }, { startTime: '09:00', endTime: '12:00' }];
      const before = JSON.stringify(periods);
      formatWeekdaySummary(periods);
      return JSON.stringify(periods) === before;
    })()
  );

  if (!allPassed) {
    console.error('\nSome Availability Settings checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL AVAILABILITY SETTINGS CHECKS PASSED');
  }
}

main();
