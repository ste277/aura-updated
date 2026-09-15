/**
 * Day Constructor V1 -- PR A domain contract regression suite (DayIntent,
 * ConstructionWindow, overload precedence comparator).
 */
import {
  buildDayIntent,
  compareByOverloadPrecedence,
  sortByOverloadPrecedence,
  sumConstructibleDurationMinutes,
  validateConstructionWindow,
  validateDayIntentDateStr,
  validateEstimatedDurationMinutes,
  type DayIntent,
} from '../apps/web/lib/dayIntent';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function throws(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

// ============================================================
// buildDayIntent -- defaults, validation, USER/DEFAULTED/ENGINE-DERIVED
// ============================================================
{
  const intent = buildDayIntent({ title: 'Finish investor presentation', targetDate: '2026-09-16' }, 0);
  check('minimal input: importance defaults to MEDIUM', intent.importance === 'MEDIUM');
  check('minimal input: flexibility defaults to FLEXIBLE', intent.flexibility === 'FLEXIBLE');
  check('minimal input: source defaults to USER_TYPED', intent.source === 'USER_TYPED');
  check('minimal input: activityId stays undefined (never guessed)', intent.activityId === undefined);
  check('minimal input: estimatedDurationMinutes stays undefined (DURATION_UNKNOWN)', intent.estimatedDurationMinutes === undefined);
  check('originalOrder equals the supplied batchIndex', intent.originalOrder === 0);
  check('id is assigned and non-empty', typeof intent.id === 'string' && intent.id.length > 0);
  check('title is trimmed', buildDayIntent({ title: '  Draft the deck  ', targetDate: '2026-09-16' }, 0).title === 'Draft the deck');
}
{
  check('empty title throws', throws(() => buildDayIntent({ title: '   ', targetDate: '2026-09-16' }, 0)));
  check('negative batchIndex throws', throws(() => buildDayIntent({ title: 'x', targetDate: '2026-09-16' }, -1)));
  check('non-integer batchIndex throws', throws(() => buildDayIntent({ title: 'x', targetDate: '2026-09-16' }, 1.5)));
}
{
  const explicit = buildDayIntent(
    { title: 'Finish deck', targetDate: '2026-09-16', deadline: '2026-09-16', importance: 'HIGH', flexibility: 'FIXED', estimatedDurationMinutes: 90 },
    2
  );
  check('explicit fields are preserved verbatim, never overridden by defaults', explicit.importance === 'HIGH' && explicit.flexibility === 'FIXED' && explicit.deadline === '2026-09-16' && explicit.estimatedDurationMinutes === 90);
  check('explicit originalOrder', explicit.originalOrder === 2);
}

// ============================================================
// Date/duration validation -- REJECTS, never coerces
// ============================================================
check('valid dateStr accepted', validateDayIntentDateStr('2026-09-16', 'x') === '2026-09-16');
check('invalid dateStr rejected (bad format)', throws(() => validateDayIntentDateStr('16-09-2026', 'x')));
check('invalid dateStr rejected (impossible date)', throws(() => validateDayIntentDateStr('2026-02-30', 'x')));
check('valid duration accepted', validateEstimatedDurationMinutes(45) === 45);
check('zero duration rejected', throws(() => validateEstimatedDurationMinutes(0)));
check('negative duration rejected', throws(() => validateEstimatedDurationMinutes(-15)));
check('non-integer duration rejected', throws(() => validateEstimatedDurationMinutes(45.5)));
check('duration over 1440 rejected', throws(() => validateEstimatedDurationMinutes(1441)));
check('buildDayIntent rejects an invalid targetDate', throws(() => buildDayIntent({ title: 'x', targetDate: 'not-a-date' }, 0)));
check('buildDayIntent rejects an invalid deadline', throws(() => buildDayIntent({ title: 'x', targetDate: '2026-09-16', deadline: 'nope' }, 0)));

// ============================================================
// sumConstructibleDurationMinutes -- unknown duration handling (#20)
// ============================================================
{
  const known1 = buildDayIntent({ title: 'A', targetDate: '2026-09-16', estimatedDurationMinutes: 30 }, 0);
  const unknown = buildDayIntent({ title: 'B', targetDate: '2026-09-16' }, 1);
  const known2 = buildDayIntent({ title: 'C', targetDate: '2026-09-16', estimatedDurationMinutes: 45 }, 2);
  const { totalMinutes, unknownDurationIntentIds } = sumConstructibleDurationMinutes([known1, unknown, known2]);
  check('20. unknown-duration intent excluded from total, not treated as zero silently', totalMinutes === 75);
  check('20. unknown-duration intent id reported, not swallowed', unknownDurationIntentIds.length === 1 && unknownDurationIntentIds[0] === unknown.id);
}
check('sumConstructibleDurationMinutes on empty list is zero, no ids', (() => {
  const r = sumConstructibleDurationMinutes([]);
  return r.totalMinutes === 0 && r.unknownDurationIntentIds.length === 0;
})());

// ============================================================
// ConstructionWindow validation
// ============================================================
check('valid window passes', validateConstructionWindow({ date: '2026-09-16', start: new Date('2026-09-16T00:00:00Z'), end: new Date('2026-09-16T10:00:00Z'), timezone: 'UTC', source: 'EXPLICIT_RANGE' }) === null);
check('missing timezone fails closed', validateConstructionWindow({ date: '2026-09-16', start: new Date('2026-09-16T00:00:00Z'), end: new Date('2026-09-16T10:00:00Z'), timezone: '', source: 'EXPLICIT_RANGE' })?.code === 'TIMEZONE_MISSING');
check('invalid date fails closed', validateConstructionWindow({ date: 'garbage', start: new Date('2026-09-16T00:00:00Z'), end: new Date('2026-09-16T10:00:00Z'), timezone: 'UTC', source: 'EXPLICIT_RANGE' })?.code === 'INVALID_DATE');
check('start >= end fails closed', validateConstructionWindow({ date: '2026-09-16', start: new Date('2026-09-16T10:00:00Z'), end: new Date('2026-09-16T10:00:00Z'), timezone: 'UTC', source: 'EXPLICIT_RANGE' })?.code === 'INVALID_RANGE');
check('invalid Date object fails closed', validateConstructionWindow({ date: '2026-09-16', start: new Date('not-a-date'), end: new Date('2026-09-16T10:00:00Z'), timezone: 'UTC', source: 'EXPLICIT_RANGE' })?.code === 'INVALID_RANGE');

// ============================================================
// Overload precedence comparator -- the LOCKED 7-step order
// ============================================================
function intent(fields: Partial<DayIntent> & { originalOrder: number }): DayIntent {
  return {
    id: `t-${fields.originalOrder}`,
    title: 'x',
    targetDate: '2026-09-16',
    importance: 'MEDIUM',
    flexibility: 'FLEXIBLE',
    source: 'USER_TYPED',
    ...fields,
  } as DayIntent;
}

{
  const today = '2026-09-16';
  const deadlineToday = intent({ originalOrder: 0, deadline: today, importance: 'LOW' });
  const highImportanceNoDeadline = intent({ originalOrder: 1, importance: 'HIGH' });
  check('2>3: deadline-today outranks HIGH importance with no deadline', compareByOverloadPrecedence(deadlineToday, highImportanceNoDeadline, today) < 0);
}
{
  const today = '2026-09-16';
  const high = intent({ originalOrder: 0, importance: 'HIGH' });
  const medium = intent({ originalOrder: 1, importance: 'MEDIUM' });
  const low = intent({ originalOrder: 2, importance: 'LOW' });
  check('3-5: HIGH before MEDIUM', compareByOverloadPrecedence(high, medium, today) < 0);
  check('3-5: MEDIUM before LOW', compareByOverloadPrecedence(medium, low, today) < 0);
}
{
  const today = '2026-09-16';
  const earlierDeadline = intent({ originalOrder: 0, importance: 'MEDIUM', deadline: '2026-09-17' });
  const laterDeadline = intent({ originalOrder: 1, importance: 'MEDIUM', deadline: '2026-09-20' });
  const noDeadline = intent({ originalOrder: 2, importance: 'MEDIUM' });
  check('6: earlier deadline outranks later deadline within same importance', compareByOverloadPrecedence(earlierDeadline, laterDeadline, today) < 0);
  check('6: having a deadline outranks having none, within same importance', compareByOverloadPrecedence(laterDeadline, noDeadline, today) < 0);
}
{
  const today = '2026-09-16';
  const first = intent({ originalOrder: 0, importance: 'MEDIUM' });
  const second = intent({ originalOrder: 1, importance: 'MEDIUM' });
  check('7: original order is the final tiebreak', compareByOverloadPrecedence(first, second, today) < 0);
}
{
  const today = '2026-09-16';
  const items = [
    intent({ originalOrder: 3, importance: 'LOW' }),
    intent({ originalOrder: 0, importance: 'MEDIUM', deadline: today }),
    intent({ originalOrder: 1, importance: 'HIGH' }),
    intent({ originalOrder: 2, importance: 'MEDIUM' }),
  ];
  const sorted = sortByOverloadPrecedence(items, today);
  check('sortByOverloadPrecedence: deadline-today first', sorted[0].originalOrder === 0);
  check('sortByOverloadPrecedence: HIGH second', sorted[1].originalOrder === 1);
  check('sortByOverloadPrecedence: MEDIUM third', sorted[2].originalOrder === 2);
  check('sortByOverloadPrecedence: LOW last', sorted[3].originalOrder === 3);
  check('sortByOverloadPrecedence: never mutates the input array', items[0].originalOrder === 3);
}
{
  // Timing/Muhurta quality must be structurally unreachable -- there is
  // no parameter on this function a caller could even supply a
  // TimingCandidate/score through.
  check('compareByOverloadPrecedence has exactly 3 parameters (a, b, today) -- no timing/score input possible', compareByOverloadPrecedence.length === 3);
}

if (!allPassed) {
  console.error('\nSome Day Intent checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL DAY INTENT CHECKS PASSED');
}
