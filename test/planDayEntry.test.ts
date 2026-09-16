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
  buildRequestedIntentsForSubmission,
  presentPlanDayPreviewFailure,
  MAX_PLAN_DAY_INTENTS,
  PLAN_DAY_DURATION_OPTIONS_MINUTES,
  type PlanDayIntentRow,
} from '../apps/web/lib/planDayEntry';
import type { ConstructDayPreviewClientResult } from '../apps/web/lib/dayConstructorPreviewClient';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function row(overrides: Partial<PlanDayIntentRow> = {}): PlanDayIntentRow {
  return { id: overrides.id ?? 'row-x', title: '', durationMinutes: null, timeMode: 'FLEXIBLE', fixedTime: null, ...overrides };
}

function main() {
  // ============================================================
  // createEmptyIntentRow (1-4)
  // ============================================================
  {
    const a = createEmptyIntentRow();
    const b = createEmptyIntentRow();
    check('1. a new row has a blank title, Automatic duration, and FLEXIBLE timing by default', a.title === '' && a.durationMinutes === null && a.timeMode === 'FLEXIBLE' && a.fixedTime === null);
    check('2. two rows created in sequence have distinct, stable ids', a.id !== b.id);
    check('3. an id is never derived from the (blank) title', a.id.length > 0 && !a.id.includes('title'));
    check('4. id is a non-empty opaque string', typeof a.id === 'string' && a.id.length > 0);
  }

  // ============================================================
  // countSubmittableIntentRows / canSubmitPlanDay (5-15)
  // ============================================================
  check('5. a single blank row has zero submittable intents', countSubmittableIntentRows([row()]) === 0);
  check('6. a single blank row cannot be submitted', canSubmitPlanDay([row()]) === false);
  check('7. a whitespace-only title is treated as blank, not counted', countSubmittableIntentRows([row({ title: '   ' })]) === 0);
  check('8. one real title makes the form submittable', canSubmitPlanDay([row({ title: 'Workout' })]) === true);
  check('9. a blank row alongside a valid row does not block submission (blank rows are simply excluded)', canSubmitPlanDay([row({ title: 'Workout' }), row()]) === true);
  check('10. multiple valid rows all count', countSubmittableIntentRows([row({ title: 'A' }), row({ title: 'B' }), row()]) === 2);
  check('11. FIXED with a title but no chosen time is INCOMPLETE -- never submittable', canSubmitPlanDay([row({ title: 'Call Mum', timeMode: 'FIXED', fixedTime: null })]) === false);
  check('12. FIXED with a title and a chosen time is submittable', canSubmitPlanDay([row({ title: 'Call Mum', timeMode: 'FIXED', fixedTime: '14:30' })]) === true);
  check('13. an incomplete FIXED row blocks the WHOLE submission even when another row is complete', canSubmitPlanDay([row({ title: 'Workout' }), row({ title: 'Call Mum', timeMode: 'FIXED', fixedTime: null })]) === false);
  check('14. a blank row toggled to FIXED with no time is still just "blank" -- never blocks submission on its own', canSubmitPlanDay([row({ title: 'Workout' }), row({ title: '', timeMode: 'FIXED', fixedTime: null })]) === true);
  check('15. zero rows (defensive) cannot be submitted', canSubmitPlanDay([]) === false);

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
    '25. planDayEntry.ts has no clock of its own anywhere (planning-date hardening: no client new Date() may determine the planning civil date)',
    !require('fs').readFileSync(require('path').join(__dirname, '../apps/web/lib/planDayEntry.ts'), 'utf8').includes('new Date(')
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
    check('37. importance is never sent in V1', !keys.includes('importance'));
    check('38. deadline is never sent in V1', !keys.includes('deadline'));
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
  // presentPlanDayPreviewFailure (41-52)
  // ============================================================
  function outcome(status: Exclude<ConstructDayPreviewClientResult, { status: 'READY' }>['status'], extra: Record<string, unknown> = {}) {
    return { status, ...extra } as Exclude<ConstructDayPreviewClientResult, { status: 'READY' }>;
  }
  {
    const p = presentPlanDayPreviewFailure(outcome('NO_USABLE_CAPACITY'));
    check('41. NO_USABLE_CAPACITY is NOT retryable (only editing helps, this ticket\'s own section 28)', p.retryable === false);
    check('42. NO_USABLE_CAPACITY copy never surfaces the raw enum name', !p.message.includes('NO_USABLE_CAPACITY'));
  }
  {
    const p = presentPlanDayPreviewFailure(outcome('TIMING_SEARCH_FAILED'));
    check('43. TIMING_SEARCH_FAILED IS retryable (this ticket\'s own section 29)', p.retryable === true);
  }
  check('44. INVALID_CONSTRUCTION_WINDOW is retryable and never leaks the raw name', (() => { const p = presentPlanDayPreviewFailure(outcome('INVALID_CONSTRUCTION_WINDOW')); return p.retryable === true && !p.message.includes('INVALID_CONSTRUCTION_WINDOW'); })());
  check('45. TIMEZONE_MISSING is retryable and never leaks the raw name', (() => { const p = presentPlanDayPreviewFailure(outcome('TIMEZONE_MISSING')); return p.retryable === true && !p.message.includes('TIMEZONE_MISSING'); })());
  check('46. INVALID_REQUEST is retryable, generic copy, no raw diagnostics (this ticket\'s own section 30)', (() => { const p = presentPlanDayPreviewFailure(outcome('INVALID_REQUEST')); return p.retryable === true && !p.message.includes('INVALID_REQUEST'); })());
  check('47. HTTP_ERROR 401 is NOT retryable (a stale session needs a fresh sign-in, not a resubmit)', presentPlanDayPreviewFailure(outcome('HTTP_ERROR', { httpStatus: 401 })).retryable === false);
  check('48. HTTP_ERROR 500 IS retryable', presentPlanDayPreviewFailure(outcome('HTTP_ERROR', { httpStatus: 500 })).retryable === true);
  check('49. NETWORK_ERROR is retryable', presentPlanDayPreviewFailure(outcome('NETWORK_ERROR')).retryable === true);
  check('50. UNKNOWN_RESPONSE is retryable', presentPlanDayPreviewFailure(outcome('UNKNOWN_RESPONSE')).retryable === true);
  check('51. every failure presentation carries a non-empty message', (['NO_USABLE_CAPACITY', 'TIMING_SEARCH_FAILED', 'INVALID_CONSTRUCTION_WINDOW', 'TIMEZONE_MISSING', 'INVALID_REQUEST', 'NETWORK_ERROR', 'UNKNOWN_RESPONSE'] as const).every((s) => presentPlanDayPreviewFailure(outcome(s)).message.length > 0));
  check('52. duration options reuse ForwardPlannerViews own numeric set verbatim (no second taxonomy)', PLAN_DAY_DURATION_OPTIONS_MINUTES.join(',') === '15,30,60,90,120');

  if (!allPassed) {
    console.error('\nSome Plan Day Entry checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL PLAN DAY ENTRY CHECKS PASSED');
  }
}

main();
