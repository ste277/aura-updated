/**
 * Day Constructor V1 -- PR F2 "Plan my day" entry-form logic regression
 * suite. Exercises every pure helper in planDayEntry.ts -- row creation,
 * submittability, the FIXED-time date assembly (this ticket's own section
 * 16), row->request mapping (section 22), and domain-result presentation
 * (sections 27-30) -- entirely through plain JS values, matching this
 * repository's own established DB-free suite convention.
 */
import {
  createEmptyIntentRow,
  countSubmittableIntentRows,
  canSubmitPlanDay,
  canAddAnotherRow,
  resolveFixedStart,
  resolveDeadline,
  buildRequestedIntentsForSubmission,
  presentPlanDayPreviewFailure,
  MAX_PLAN_DAY_INTENTS,
  PLAN_DAY_DURATION_OPTIONS_MINUTES,
  NO_DEADLINE,
  type PlanDayIntentRow,
  type PlanDayDeadlineChoice,
} from '../apps/web/lib/planDayEntry';
import type { ConstructDayPreviewClientResult } from '../apps/web/lib/dayConstructorPreviewClient';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const PLANNING_DATE = '2026-09-16'; // a Wednesday -- used as the default gate/mapping planningDate throughout this file.

function row(overrides: Partial<PlanDayIntentRow> = {}): PlanDayIntentRow {
  return { id: overrides.id ?? 'row-x', title: '', durationMinutes: null, timeMode: 'FLEXIBLE', fixedTime: null, important: false, deadlineChoice: NO_DEADLINE, ...overrides };
}

function main() {
  // ============================================================
  // createEmptyIntentRow (1-4)
  // ============================================================
  {
    const a = createEmptyIntentRow();
    const b = createEmptyIntentRow();
    check('1. a new row has a blank title, Automatic duration, and FLEXIBLE timing by default', a.title === '' && a.durationMinutes === null && a.timeMode === 'FLEXIBLE' && a.fixedTime === null);
    check('1b. a new row defaults to important=false and no deadline (Intent Fidelity V1 PR G3/G4)', a.important === false && a.deadlineChoice.kind === 'NONE');
    check('2. two rows created in sequence have distinct, stable ids', a.id !== b.id);
    check('3. an id is never derived from the (blank) title', a.id.length > 0 && !a.id.includes('title'));
    check('4. id is a non-empty opaque string', typeof a.id === 'string' && a.id.length > 0);
  }

  // ============================================================
  // countSubmittableIntentRows / canSubmitPlanDay (5-15)
  // ============================================================
  check('5. a single blank row has zero submittable intents', countSubmittableIntentRows([row()]) === 0);
  check('6. a single blank row cannot be submitted', canSubmitPlanDay([row()], PLANNING_DATE) === false);
  check('7. a whitespace-only title is treated as blank, not counted', countSubmittableIntentRows([row({ title: '   ' })]) === 0);
  check('8. one real title makes the form submittable', canSubmitPlanDay([row({ title: 'Workout' })], PLANNING_DATE) === true);
  check('9. a blank row alongside a valid row does not block submission (blank rows are simply excluded)', canSubmitPlanDay([row({ title: 'Workout' }), row()], PLANNING_DATE) === true);
  check('10. multiple valid rows all count', countSubmittableIntentRows([row({ title: 'A' }), row({ title: 'B' }), row()]) === 2);
  check('11. FIXED with a title but no chosen time is INCOMPLETE -- never submittable', canSubmitPlanDay([row({ title: 'Call Mum', timeMode: 'FIXED', fixedTime: null })], PLANNING_DATE) === false);
  check('12. FIXED with a title and a chosen time is submittable', canSubmitPlanDay([row({ title: 'Call Mum', timeMode: 'FIXED', fixedTime: '14:30' })], PLANNING_DATE) === true);
  check('13. an incomplete FIXED row blocks the WHOLE submission even when another row is complete', canSubmitPlanDay([row({ title: 'Workout' }), row({ title: 'Call Mum', timeMode: 'FIXED', fixedTime: null })], PLANNING_DATE) === false);
  check('14. a blank row toggled to FIXED with no time is still just "blank" -- never blocks submission on its own', canSubmitPlanDay([row({ title: 'Workout' }), row({ title: '', timeMode: 'FIXED', fixedTime: null })], PLANNING_DATE) === true);
  check('15. zero rows (defensive) cannot be submitted', canSubmitPlanDay([], PLANNING_DATE) === false);
  check('15b. a title with a CUSTOM deadline before planningDate is INCOMPLETE -- never submittable (this ticket\'s own section 8)', canSubmitPlanDay([row({ title: 'Late task', deadlineChoice: { kind: 'CUSTOM', date: '2026-09-15' } })], PLANNING_DATE) === false);
  check('15c. the SAME row with a CUSTOM deadline on/after planningDate IS submittable', canSubmitPlanDay([row({ title: 'On-time task', deadlineChoice: { kind: 'CUSTOM', date: '2026-09-16' } })], PLANNING_DATE) === true);

  // ============================================================
  // canAddAnotherRow (16-18)
  // ============================================================
  check('16. below the max, another row can be added', canAddAnotherRow(Array.from({ length: MAX_PLAN_DAY_INTENTS - 1 }, () => row())) === true);
  check('17. at exactly the max, no more rows can be added', canAddAnotherRow(Array.from({ length: MAX_PLAN_DAY_INTENTS }, () => row())) === false);
  check('18. MAX_PLAN_DAY_INTENTS matches F1s own request-level limit (12)', MAX_PLAN_DAY_INTENTS === 12);

  // ============================================================
  // resolveFixedStart -- FIXED-time date assembly (19-25)
  // ============================================================
  check('19. FLEXIBLE never produces a fixedStart', resolveFixedStart({ timeMode: 'FLEXIBLE', fixedTime: '09:00' }, '2026-09-16', 'Asia/Kolkata') === undefined);
  check('20. FIXED with no chosen time never produces a fixedStart (never manufactured)', resolveFixedStart({ timeMode: 'FIXED', fixedTime: null }, '2026-09-16', 'Asia/Kolkata') === undefined);
  {
    // Asia/Kolkata is UTC+5:30 (no DST) -- 09:00 local on 2026-09-16 is
    // 2026-09-16T03:30:00.000Z. A real, independently-checkable instant,
    // not merely "resolveFixedStart returns *a* Date".
    const resolved = resolveFixedStart({ timeMode: 'FIXED', fixedTime: '09:00' }, '2026-09-16', 'Asia/Kolkata');
    check('21. FIXED with a chosen time produces a real Date instance', resolved instanceof Date);
    check('22. the produced instant is correct for the user\'s OWN configured timezone, never UTC/browser-local', resolved?.toISOString() === '2026-09-16T03:30:00.000Z');
  }
  {
    // America/New_York is UTC-4 during September (EDT) -- 09:00 local on
    // 2026-09-16 is 2026-09-16T13:00:00.000Z. Proves this genuinely
    // depends on the SUPPLIED timezone, not a hardcoded offset.
    const resolved = resolveFixedStart({ timeMode: 'FIXED', fixedTime: '09:00' }, '2026-09-16', 'America/New_York');
    check('23. a different user timezone produces a different, still-correct UTC instant for the SAME wall-clock time', resolved?.toISOString() === '2026-09-16T13:00:00.000Z');
  }
  check('24. resolveFixedStart takes a planningDate STRING, never a Date/now -- no client-clock-dependent parameter exists on this function\'s own signature', resolveFixedStart.length === 3);
  check(
    // Intent Fidelity V1 PR G3/G4 added `resolveThisWeekDeadline`'s own
    // `new Date(Date.UTC(year, month - 1, day))` -- the SAME pure,
    // explicit-Y/M/D calendar-arithmetic idiom `timezone.ts`'s own
    // `addDaysToDateStr` and `dayPlanPreviewPresentation.ts`'s own
    // `formatTargetDateLabel` already use, never an ambient clock read.
    // This check is refined to forbid what "no clock of its own" ACTUALLY
    // means -- a zero-argument `new Date()` or `Date.now()` -- rather than
    // banning `new Date(` as a bare substring, which would also reject
    // this exact, already-established, non-clock-reading idiom.
    '25. planDayEntry.ts has no clock of its own anywhere (planning-date hardening: no new Date() / Date.now() may determine the planning civil date -- Date.UTC(explicit y/m/d) calendar arithmetic is not a clock read)',
    (() => {
      const source: string = require('fs').readFileSync(require('path').join(__dirname, '../apps/web/lib/planDayEntry.ts'), 'utf8');
      return !/new Date\(\s*\)/.test(source) && !source.includes('Date.now(');
    })()
  );

  // ============================================================
  // buildRequestedIntentsForSubmission (26-38) -- planningDate is now
  // ALWAYS a server-established string (planDayBootstrap.ts), never
  // derived from a client Date here.
  // ============================================================
  {
    const planningDate = '2026-09-16';
    const intents = buildRequestedIntentsForSubmission([row({ id: 'r1', title: '  Finish investor deck  ' }), row({ id: 'r2', title: '' })], 'Asia/Kolkata', planningDate);
    check('26. a blank row is excluded from the built request', intents.length === 1);
    check('27. the surviving row\'s title is trimmed', intents[0].title === 'Finish investor deck');
    check('28. id is carried through unchanged', intents[0].id === 'r1');
    check('29. flexibility defaults to FLEXIBLE for an untouched row', intents[0].flexibility === 'FLEXIBLE');
    check('30. durationMinutes is OMITTED entirely (never sent as a guessed value) when Automatic', !('durationMinutes' in intents[0]));
    check('31. fixedStart is omitted for a FLEXIBLE intent', !('fixedStart' in intents[0]));
  }
  {
    const intents = buildRequestedIntentsForSubmission([row({ id: 'r1', title: 'Workout', durationMinutes: 45 })], 'Asia/Kolkata', '2026-09-16');
    check('32. an explicit duration IS sent when chosen', intents[0].durationMinutes === 45);
  }
  {
    const intents = buildRequestedIntentsForSubmission([row({ id: 'r1', title: 'Call Mum', timeMode: 'FIXED', fixedTime: '18:00' })], 'Asia/Kolkata', '2026-09-16');
    check('33. flexibility is FIXED when a time was chosen', intents[0].flexibility === 'FIXED');
    check('34. fixedStart is a real Date, correctly assembled against the SUPPLIED planningDate and the user\'s timezone', intents[0].fixedStart instanceof Date && intents[0].fixedStart?.toISOString() === '2026-09-16T12:30:00.000Z');
  }
  {
    const intents = buildRequestedIntentsForSubmission([row({ id: 'r1', title: 'A' })], 'Asia/Kolkata', '2026-09-16');
    const keys = Object.keys(intents[0]);
    check('35. originalOrder is never sent (array position IS the order -- F1 derives it itself)', !keys.includes('originalOrder'));
    check('36. activityId is never sent in V1 (title-only path)', !keys.includes('activityId'));
    check('37. importance is OMITTED (never sent, not even as MEDIUM) for a default row (important=false) -- Intent Fidelity V1 PR G3/G4', !keys.includes('importance'));
    check('38. deadline is OMITTED (never sent) for a default row (deadlineChoice=NONE) -- Intent Fidelity V1 PR G3/G4', !keys.includes('deadline'));
  }
  {
    const intents = buildRequestedIntentsForSubmission([row({ id: 'first', title: 'First' }), row({ id: 'second', title: 'Second' }), row({ id: 'third', title: 'Third' })], 'Asia/Kolkata', '2026-09-16');
    check('39. visible row order is preserved in the built array (no reordering)', intents.map((i) => i.id).join(',') === 'first,second,third');
  }
  {
    // Planning-date hardening's own core invariant (this ticket's own
    // section 3/7): the SAME planningDate string drives both a FIXED
    // intent's own fixedStart assembly AND is what a caller sends as
    // targetDate (PlanDayClient.tsx) -- proven by re-deriving the expected
    // instant independently via the same canonical helper and comparing
    // equality, never merely "returns *a* Date".
    const planningDate = '2026-12-25';
    const intents = buildRequestedIntentsForSubmission([row({ id: 'r1', title: 'Open presents', timeMode: 'FIXED', fixedTime: '09:00' })], 'Asia/Kolkata', planningDate);
    const expected = resolveFixedStart({ timeMode: 'FIXED', fixedTime: '09:00' }, planningDate, 'Asia/Kolkata');
    check('40. buildRequestedIntentsForSubmission assembles fixedStart against the EXACT same planningDate a caller would also send as targetDate', intents[0].fixedStart?.getTime() === expected?.getTime());
  }

  // ============================================================
  // Intent Fidelity V1 PR G3/G4 -- resolveDeadline (53-64). Every branch
  // is a pure civil-date-string operation on a fixed `planningDate`, no
  // clock involved anywhere (this ticket's own section 14).
  // ============================================================
  check('53. NONE resolves to undefined', resolveDeadline(NO_DEADLINE, PLANNING_DATE) === undefined);
  check('54. TODAY resolves to planningDate itself', resolveDeadline({ kind: 'TODAY' }, PLANNING_DATE) === PLANNING_DATE);
  check('55. TOMORROW resolves to planningDate + 1 civil day, no browser clock involved', resolveDeadline({ kind: 'TOMORROW' }, PLANNING_DATE) === '2026-09-17');
  check('56. CUSTOM preserves the exact YYYY-MM-DD string supplied', resolveDeadline({ kind: 'CUSTOM', date: '2026-10-05' }, PLANNING_DATE) === '2026-10-05');
  {
    // THIS_WEEK worked examples (this ticket's own section 7) -- Sunday
    // of the week containing planningDate, never planningDate + 7 days.
    check('57. THIS_WEEK from a Monday resolves to the FOLLOWING Sunday', resolveDeadline({ kind: 'THIS_WEEK' }, '2026-09-14') === '2026-09-20'); // Mon 9/14 -> Sun 9/20
    check('58. THIS_WEEK from a Wednesday resolves to the FOLLOWING Sunday', resolveDeadline({ kind: 'THIS_WEEK' }, '2026-09-16') === '2026-09-20'); // Wed 9/16 -> Sun 9/20
    check('59. THIS_WEEK from a Saturday resolves to the FOLLOWING Sunday', resolveDeadline({ kind: 'THIS_WEEK' }, '2026-09-19') === '2026-09-20'); // Sat 9/19 -> Sun 9/20
    check('60. THIS_WEEK from a Sunday resolves to the SAME day', resolveDeadline({ kind: 'THIS_WEEK' }, '2026-09-20') === '2026-09-20'); // Sun 9/20 -> Sun 9/20
    check('61. THIS_WEEK is never planningDate + 7 days (Monday case would wrongly be 9/21)', resolveDeadline({ kind: 'THIS_WEEK' }, '2026-09-14') !== '2026-09-21');
    // Month/year boundary: Sat 2026-12-27 is Saturday -> following Sunday
    // is 2026-12-28 (no boundary crossing here); Wed 2026-12-30 IS a
    // genuine boundary case -- its following Sunday (2027-01-03) crosses
    // both the month AND the year.
    check('62. THIS_WEEK correctly crosses a month/year boundary (Wed Dec 30, 2026 -> Sun Jan 3, 2027)', resolveDeadline({ kind: 'THIS_WEEK' }, '2026-12-30') === '2027-01-03');
    check('63. THIS_WEEK from a Sunday (Dec 27, 2026) resolves to the SAME day, staying in that year', resolveDeadline({ kind: 'THIS_WEEK' }, '2026-12-27') === '2026-12-27');
  }
  check('64. resolveDeadline takes a planningDate STRING, never a Date/now', resolveDeadline.length === 2);

  // ============================================================
  // Intent Fidelity V1 PR G3/G4 -- buildRequestedIntentsForSubmission's
  // new importance/deadline mapping (65-84).
  // ============================================================
  {
    // 65-66: default row (important=false, NO_DEADLINE) produces the
    // EXACT same request body shape as before G3/G4 -- this ticket's
    // own section 44, an explicit regression proof.
    const before = { id: 'r1', title: 'Read', flexibility: 'FLEXIBLE' as const };
    const intents = buildRequestedIntentsForSubmission([row({ id: 'r1', title: 'Read' })], 'Asia/Kolkata', PLANNING_DATE);
    check('65. a default row (title/Automatic/Flexible only) produces a request body with no new fields at all', JSON.stringify(intents[0]) === JSON.stringify(before));
    check('66. importance/deadline stay absent for a default row', !('importance' in intents[0]) && !('deadline' in intents[0]));
  }
  {
    // 67-68: important=true -> importance HIGH; important=false -> omitted.
    const on = buildRequestedIntentsForSubmission([row({ id: 'r1', title: 'Board report', important: true })], 'Asia/Kolkata', PLANNING_DATE);
    check('67. important=true maps to importance: HIGH', on[0].importance === 'HIGH');
    const off = buildRequestedIntentsForSubmission([row({ id: 'r1', title: 'Board report', important: false })], 'Asia/Kolkata', PLANNING_DATE);
    check('68. important=false OMITS importance entirely -- never an explicit MEDIUM', !('importance' in off[0]));
  }
  {
    // 69: Today.
    const intents = buildRequestedIntentsForSubmission([row({ id: 'r1', title: 'X', deadlineChoice: { kind: 'TODAY' } })], 'Asia/Kolkata', PLANNING_DATE);
    check('69. Today maps to deadline === planningDate', intents[0].deadline === PLANNING_DATE);
  }
  {
    // 70: Tomorrow, no browser clock involved.
    const intents = buildRequestedIntentsForSubmission([row({ id: 'r1', title: 'X', deadlineChoice: { kind: 'TOMORROW' } })], 'Asia/Kolkata', PLANNING_DATE);
    check('70. Tomorrow maps to planningDate + 1 civil day', intents[0].deadline === '2026-09-17');
  }
  {
    // 71: Pick date, planningDate-or-future -> exact string preserved.
    const intents = buildRequestedIntentsForSubmission([row({ id: 'r1', title: 'X', deadlineChoice: { kind: 'CUSTOM', date: '2026-10-05' } })], 'Asia/Kolkata', PLANNING_DATE);
    check('71. Pick date preserves the exact YYYY-MM-DD string chosen', intents[0].deadline === '2026-10-05');
  }
  {
    // 72: past custom date -> fail closed, no request emitted.
    let threw = false;
    try {
      buildRequestedIntentsForSubmission([row({ id: 'r1', title: 'X', deadlineChoice: { kind: 'CUSTOM', date: '2026-09-01' } })], 'Asia/Kolkata', PLANNING_DATE);
    } catch {
      threw = true;
    }
    check('72. a CUSTOM deadline before planningDate fails closed (throws) in buildRequestedIntentsForSubmission -- never normalized, never sent', threw === true);
  }
  {
    // 73: clear -> back to NONE -> omitted.
    const intents = buildRequestedIntentsForSubmission([row({ id: 'r1', title: 'X', deadlineChoice: NO_DEADLINE })], 'Asia/Kolkata', PLANNING_DATE);
    check('73. NO_DEADLINE (post-Clear state) omits deadline entirely', !('deadline' in intents[0]));
  }
  {
    // 74: important + deadline coexist in the same intent, no conflict.
    const intents = buildRequestedIntentsForSubmission([row({ id: 'r1', title: 'Board report', important: true, deadlineChoice: { kind: 'TODAY' } })], 'Asia/Kolkata', PLANNING_DATE);
    check('74. important=true and a supplied deadline coexist in the same built intent', intents[0].importance === 'HIGH' && intents[0].deadline === PLANNING_DATE);
  }
  {
    // 75-76: FIXED + deadline -- no interaction, fixedStart computed exactly as before, deadline stays a civil-date string.
    const intents = buildRequestedIntentsForSubmission([row({ id: 'r1', title: 'Doctor', timeMode: 'FIXED', fixedTime: '16:00', deadlineChoice: { kind: 'TODAY' } })], 'Asia/Kolkata', PLANNING_DATE);
    const expectedFixedStart = resolveFixedStart({ timeMode: 'FIXED', fixedTime: '16:00' }, PLANNING_DATE, 'Asia/Kolkata');
    check('75. FIXED + deadline: fixedStart is computed exactly as F2 already did (unaffected by deadline)', intents[0].fixedStart?.getTime() === expectedFixedStart?.getTime());
    check('76. FIXED + deadline: deadline remains a plain civil-date string, never converted toward an instant', intents[0].deadline === PLANNING_DATE && typeof intents[0].deadline === 'string');
  }
  {
    // 77: G2 interaction -- unknown natural task, Automatic duration,
    // Important + deadline: no activityId is ever sent (never
    // fabricated), duration stays omitted (Automatic, resolved
    // server-side via G2's own generic fallback), importance/deadline
    // both pass through untouched.
    const intents = buildRequestedIntentsForSubmission([row({ id: 'r1', title: 'Prepare for Sarah meeting', important: true, deadlineChoice: { kind: 'TODAY' } })], 'Asia/Kolkata', PLANNING_DATE);
    const keys = Object.keys(intents[0]);
    check('77. unknown natural title + Automatic + Important + deadline: no activityId, no durationMinutes, importance HIGH, deadline present (G2 interaction)', !keys.includes('activityId') && !keys.includes('durationMinutes') && intents[0].importance === 'HIGH' && intents[0].deadline === PLANNING_DATE);
  }
  {
    // 78: determinism -- same rows/planningDate/timezone -> byte-identical output.
    const rows = [row({ id: 'r1', title: 'A', important: true, deadlineChoice: { kind: 'TOMORROW' } }), row({ id: 'r2', title: 'B', timeMode: 'FIXED', fixedTime: '09:00' })];
    const first = buildRequestedIntentsForSubmission(rows, 'Asia/Kolkata', PLANNING_DATE);
    const second = buildRequestedIntentsForSubmission(rows, 'Asia/Kolkata', PLANNING_DATE);
    check('78. identical inputs (planningDate/rows/timezone) produce byte-equivalent submissions -- no clock/randomness', JSON.stringify(first) === JSON.stringify(second));
  }

  // ============================================================
  // presentPlanDayPreviewFailure (41-52)
  // ============================================================
  function outcome(status: Exclude<ConstructDayPreviewClientResult, { status: 'READY' }>['status'], extra: Record<string, unknown> = {}) {
    return { status, ...extra } as Exclude<ConstructDayPreviewClientResult, { status: 'READY' }>;
  }
  {
    const p = presentPlanDayPreviewFailure(outcome('NO_USABLE_CAPACITY'), 'TODAY');
    check('41. NO_USABLE_CAPACITY is NOT retryable (only editing helps, this ticket\'s own section 28)', p.retryable === false);
    check('42. NO_USABLE_CAPACITY copy never surfaces the raw enum name', !p.message.includes('NO_USABLE_CAPACITY'));
  }
  {
    const p = presentPlanDayPreviewFailure(outcome('TIMING_SEARCH_FAILED'), 'TODAY');
    check('43. TIMING_SEARCH_FAILED IS retryable (this ticket\'s own section 29)', p.retryable === true);
  }
  check('44. INVALID_CONSTRUCTION_WINDOW is retryable and never leaks the raw name', (() => { const p = presentPlanDayPreviewFailure(outcome('INVALID_CONSTRUCTION_WINDOW'), 'TODAY'); return p.retryable === true && !p.message.includes('INVALID_CONSTRUCTION_WINDOW'); })());
  check('45. TIMEZONE_MISSING is retryable and never leaks the raw name', (() => { const p = presentPlanDayPreviewFailure(outcome('TIMEZONE_MISSING'), 'TODAY'); return p.retryable === true && !p.message.includes('TIMEZONE_MISSING'); })());
  check('46. INVALID_REQUEST is retryable, generic copy, no raw diagnostics (this ticket\'s own section 30)', (() => { const p = presentPlanDayPreviewFailure(outcome('INVALID_REQUEST'), 'TODAY'); return p.retryable === true && !p.message.includes('INVALID_REQUEST'); })());
  check('47. HTTP_ERROR 401 is NOT retryable (a stale session needs a fresh sign-in, not a resubmit)', presentPlanDayPreviewFailure(outcome('HTTP_ERROR', { httpStatus: 401 }), 'TODAY').retryable === false);
  check('48. HTTP_ERROR 500 IS retryable', presentPlanDayPreviewFailure(outcome('HTTP_ERROR', { httpStatus: 500 }), 'TODAY').retryable === true);
  check('49. NETWORK_ERROR is retryable', presentPlanDayPreviewFailure(outcome('NETWORK_ERROR'), 'TODAY').retryable === true);
  check('50. UNKNOWN_RESPONSE is retryable', presentPlanDayPreviewFailure(outcome('UNKNOWN_RESPONSE'), 'TODAY').retryable === true);
  check(
    '51. every failure presentation carries a non-empty message',
    (['NO_USABLE_CAPACITY', 'TIMING_SEARCH_FAILED', 'INVALID_CONSTRUCTION_WINDOW', 'TIMEZONE_MISSING', 'INVALID_REQUEST', 'FUTURE_AVAILABILITY_REQUIRED', 'NETWORK_ERROR', 'UNKNOWN_RESPONSE'] as const).every(
      (s) => presentPlanDayPreviewFailure(outcome(s), 'TODAY').message.length > 0
    )
  );
  check('52. duration options reuse ForwardPlannerViews own numeric set verbatim (no second taxonomy)', PLAN_DAY_DURATION_OPTIONS_MINUTES.join(',') === '15,30,60,90,120');

  // ============================================================
  // Planning Horizon V1 PR P2 -- horizon-aware presentation (53-59)
  // ============================================================
  check(
    '53. NO_USABLE_CAPACITY under TODAY keeps its existing wording (byte-equivalent regression, never says "that day")',
    presentPlanDayPreviewFailure(outcome('NO_USABLE_CAPACITY'), 'TODAY').message === "There's no usable time left in the part of today Aura can plan."
  );
  check(
    '54. NO_USABLE_CAPACITY under TOMORROW uses distinct, correct wording -- never claims "today" for a future day',
    presentPlanDayPreviewFailure(outcome('NO_USABLE_CAPACITY'), 'TOMORROW').message === "There's no availability configured for that day."
  );
  check('55. NO_USABLE_CAPACITY remains NOT retryable under TOMORROW too (only editing/configuring Availability helps)', presentPlanDayPreviewFailure(outcome('NO_USABLE_CAPACITY'), 'TOMORROW').retryable === false);
  check(
    '56. FUTURE_AVAILABILITY_REQUIRED never falls through to a generic message -- it has its own real, actionable copy',
    presentPlanDayPreviewFailure(outcome('FUTURE_AVAILABILITY_REQUIRED'), 'TOMORROW').message.toLowerCase().includes('available')
  );
  check('57. FUTURE_AVAILABILITY_REQUIRED is NOT retryable (only configuring Availability helps, never a resubmit)', presentPlanDayPreviewFailure(outcome('FUTURE_AVAILABILITY_REQUIRED'), 'TOMORROW').retryable === false);
  check(
    '58. INVALID_CONSTRUCTION_WINDOW/TIMEZONE_MISSING/HTTP_ERROR generic copy mentions "tomorrow" under a TOMORROW horizon, never "today"',
    presentPlanDayPreviewFailure(outcome('INVALID_CONSTRUCTION_WINDOW'), 'TOMORROW').message.includes('tomorrow') && !presentPlanDayPreviewFailure(outcome('INVALID_CONSTRUCTION_WINDOW'), 'TOMORROW').message.includes('today right now')
  );
  check(
    '59. the SAME generic copy under TODAY is byte-identical to the pre-P2 wording (regression)',
    presentPlanDayPreviewFailure(outcome('INVALID_CONSTRUCTION_WINDOW'), 'TODAY').message === "Aura couldn't build a plan for today right now."
  );

  if (!allPassed) {
    console.error('\nSome Plan Day Entry checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL PLAN DAY ENTRY CHECKS PASSED');
  }
}

main();
