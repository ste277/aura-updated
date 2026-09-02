import { buildTimingSearchRequest } from '../apps/web/lib/timingSearchRequest';
import { runTimingSearch } from '../packages/recommendation/src/timingSearch';
import type { DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const chennaiContext: DailyAssistantContext = {
  now: new Date(Date.UTC(2026, 7, 21, 4, 0, 0)),
  latitude: 13.0827,
  longitude: 80.2707,
  timezone: 'Asia/Kolkata',
  tzOffsetMinutes: 330,
};

// ============================================================
// FIND
// ============================================================

const findResult = buildTimingSearchRequest({
  mode: 'FIND',
  taskTitle: 'Deep Work',
  durationMinutes: 60,
  horizon: 'TODAY',
  timePreference: 'MORNING',
  limit: 3,
}, chennaiContext);
check('Valid FIND request is accepted', findResult.ok === true);
if (findResult.ok) {
  check('FIND request carries mode FIND', findResult.request.mode === 'FIND');
  check('FIND request carries taskTitle, not activityId (free text)', findResult.request.taskTitle === 'Deep Work' && findResult.request.activityId === undefined);
  check('FIND request carries the resolved context untouched', findResult.request.context === chennaiContext);
  check('FIND request carries the requested horizon', findResult.request.horizon === 'TODAY');
  check('FIND request carries the requested limit', findResult.request.limit === 3);
}

const findWithActivityId = buildTimingSearchRequest({
  mode: 'FIND',
  activityId: 'deep-work',
  taskTitle: 'this should be ignored',
  durationMinutes: 30,
  horizon: 'TODAY',
}, chennaiContext);
check('FIND request with activityId omits taskTitle from the built request', findWithActivityId.ok === true && findWithActivityId.ok && findWithActivityId.request.activityId === 'deep-work' && findWithActivityId.request.taskTitle === undefined);

const findWithDateRange = buildTimingSearchRequest({
  mode: 'FIND',
  taskTitle: 'Deep Work',
  durationMinutes: 30,
  dateRange: { start: '2026-08-22', end: '2026-08-23' },
}, chennaiContext);
check('FIND request with an explicit dateRange is accepted', findWithDateRange.ok === true);
if (findWithDateRange.ok) check('FIND request carries the dateRange, not a horizon', JSON.stringify(findWithDateRange.request.dateRange) === JSON.stringify({ start: '2026-08-22', end: '2026-08-23' }) && findWithDateRange.request.horizon === undefined);

// ============================================================
// CHECK
// ============================================================

const checkResult = buildTimingSearchRequest({
  mode: 'CHECK',
  taskTitle: 'Important meeting',
  durationMinutes: 60,
  candidateStart: '2026-08-27T04:30:00.000Z',
}, chennaiContext);
check('Valid CHECK request is accepted', checkResult.ok === true);
if (checkResult.ok) check('CHECK request carries the exact candidateStart', checkResult.request.candidateStart === '2026-08-27T04:30:00.000Z');

const checkMissingStart = buildTimingSearchRequest({
  mode: 'CHECK',
  taskTitle: 'Important meeting',
  durationMinutes: 60,
}, chennaiContext);
check('CHECK request without candidateStart is rejected', checkMissingStart.ok === false);
check('CHECK rejection uses 400', checkMissingStart.ok === false && checkMissingStart.status === 400);

// ============================================================
// COMPARE
// ============================================================

const compareResultReq = buildTimingSearchRequest({
  mode: 'COMPARE',
  taskTitle: 'Dating',
  durationMinutes: 120,
  candidateStarts: ['2026-08-21T13:30:00.000Z', '2026-08-22T13:30:00.000Z'],
}, chennaiContext);
check('Valid COMPARE request is accepted', compareResultReq.ok === true);
if (compareResultReq.ok) check('COMPARE request carries both candidateStarts in order', JSON.stringify(compareResultReq.request.candidateStarts) === JSON.stringify(['2026-08-21T13:30:00.000Z', '2026-08-22T13:30:00.000Z']));

const compareTooFew = buildTimingSearchRequest({
  mode: 'COMPARE',
  taskTitle: 'Dating',
  durationMinutes: 60,
  candidateStarts: ['2026-08-21T13:30:00.000Z'],
}, chennaiContext);
check('COMPARE request with fewer than 2 candidates is rejected', compareTooFew.ok === false);

// ============================================================
// INVALID PAYLOADS
// ============================================================

check('Missing mode is rejected', buildTimingSearchRequest({ durationMinutes: 30, taskTitle: 'x' }, chennaiContext).ok === false);
check('Unknown mode is rejected', buildTimingSearchRequest({ mode: 'DESTROY', durationMinutes: 30, taskTitle: 'x' }, chennaiContext).ok === false);
check('Missing both activityId and taskTitle is rejected', buildTimingSearchRequest({ mode: 'FIND', durationMinutes: 30 }, chennaiContext).ok === false);
check('Duration below the minimum is rejected', buildTimingSearchRequest({ mode: 'FIND', taskTitle: 'x', durationMinutes: 5 }, chennaiContext).ok === false);
check('Duration above the maximum is rejected', buildTimingSearchRequest({ mode: 'FIND', taskTitle: 'x', durationMinutes: 1000 }, chennaiContext).ok === false);
check('Non-numeric duration is rejected', buildTimingSearchRequest({ mode: 'FIND', taskTitle: 'x', durationMinutes: 'a lot' }, chennaiContext).ok === false);
check('Invalid time preference is rejected', buildTimingSearchRequest({ mode: 'FIND', taskTitle: 'x', durationMinutes: 30, timePreference: 'DAWN' }, chennaiContext).ok === false);
check('Malformed dateRange (not YYYY-MM-DD) is rejected', buildTimingSearchRequest({ mode: 'FIND', taskTitle: 'x', durationMinutes: 30, dateRange: { start: '08/22/2026', end: '2026-08-23' } }, chennaiContext).ok === false);
check('dateRange with end before start is rejected', buildTimingSearchRequest({ mode: 'FIND', taskTitle: 'x', durationMinutes: 30, dateRange: { start: '2026-08-23', end: '2026-08-20' } }, chennaiContext).ok === false);
check('dateRange spanning more than 90 days is rejected', buildTimingSearchRequest({ mode: 'FIND', taskTitle: 'x', durationMinutes: 30, dateRange: { start: '2026-01-01', end: '2027-06-01' } }, chennaiContext).ok === false);
check('CUSTOM horizon without custom dates is rejected', buildTimingSearchRequest({ mode: 'FIND', taskTitle: 'x', durationMinutes: 30, horizon: 'CUSTOM' }, chennaiContext).ok === false);
check('Invalid horizon is rejected', buildTimingSearchRequest({ mode: 'FIND', taskTitle: 'x', durationMinutes: 30, horizon: 'NEXT_MILLENNIUM' }, chennaiContext).ok === false);
check('CHECK with a non-date candidateStart is rejected', buildTimingSearchRequest({ mode: 'CHECK', taskTitle: 'x', durationMinutes: 30, candidateStart: 'not a date' }, chennaiContext).ok === false);
check('COMPARE with a non-array candidateStarts is rejected', buildTimingSearchRequest({ mode: 'COMPARE', taskTitle: 'x', durationMinutes: 30, candidateStarts: 'not an array' }, chennaiContext).ok === false);
check('COMPARE with more than 6 candidates is rejected', buildTimingSearchRequest({ mode: 'COMPARE', taskTitle: 'x', durationMinutes: 30, candidateStarts: Array.from({ length: 7 }, (_, i) => `2026-08-2${i % 9}T10:00:00.000Z`) }, chennaiContext).ok === false);
check('activityId longer than 100 characters is rejected', buildTimingSearchRequest({ mode: 'FIND', activityId: 'x'.repeat(101), durationMinutes: 30 }, chennaiContext).ok === false);
check('taskTitle longer than 200 characters is rejected', buildTimingSearchRequest({ mode: 'FIND', taskTitle: 'x'.repeat(201), durationMinutes: 30 }, chennaiContext).ok === false);

// ============================================================
// TIMEZONE / DATE HANDLING
// ============================================================

const newYorkContext: DailyAssistantContext = {
  now: new Date(Date.UTC(2026, 2, 7, 15, 0, 0)),
  latitude: 40.7128,
  longitude: -74.006,
  timezone: 'America/New_York',
  tzOffsetMinutes: -300,
};
const nyFindResult = buildTimingSearchRequest({ mode: 'FIND', taskTitle: 'Deep Work', durationMinutes: 30, horizon: 'TOMORROW' }, newYorkContext);
check('FIND request validation is timezone-agnostic (context passes through unchanged for non-IST users)', nyFindResult.ok === true && nyFindResult.ok && nyFindResult.request.context.timezone === 'America/New_York');

check('dateRange exactly at the 90-day cap is accepted', buildTimingSearchRequest({ mode: 'FIND', taskTitle: 'x', durationMinutes: 30, dateRange: { start: '2026-01-01', end: '2026-04-01' } }, chennaiContext).ok === true);
check('dateRange of zero days (start === end) is accepted', buildTimingSearchRequest({ mode: 'FIND', taskTitle: 'x', durationMinutes: 30, dateRange: { start: '2026-08-21', end: '2026-08-21' } }, chennaiContext).ok === true);

// ============================================================
// Home Compactness follow-up -- end-to-end proof through the REAL
// /api/timing-search request shape: a client that omits timePreference
// entirely (the common case -- no Morning/Afternoon/Evening/Night picker
// touched) gets this validation layer's own 'ANY' default (line ~74,
// `body.timePreference === undefined ? 'ANY' : ...`), and that resolved
// request must still land Date Night in the evening once handed to
// runTimingSearch -- this is the exact live bug caught during manual
// verification (a stricter `request.timePreference ?? activityDefault`
// check in runFind() would have silently treated the validation layer's
// own 'ANY' default as an explicit caller preference and skipped the
// activity default entirely).
// ============================================================
function istHourOf(iso: string): number {
  const d = new Date(iso);
  return (d.getUTCHours() + 5 + Math.floor((d.getUTCMinutes() + 30) / 60)) % 24;
}
const dateNightNoBodyPreference = buildTimingSearchRequest({ mode: 'FIND', activityId: 'date-night', durationMinutes: 90, horizon: 'TODAY', limit: 5 }, chennaiContext);
check('A body with no timePreference field validates OK and defaults to \'ANY\'', dateNightNoBodyPreference.ok === true && dateNightNoBodyPreference.ok && dateNightNoBodyPreference.request.timePreference === 'ANY');
if (dateNightNoBodyPreference.ok) {
  const result = runTimingSearch(dateNightNoBodyPreference.request);
  check(
    'That real request, run end to end, still lands every Date Night candidate in the evening (17:00-21:00 IST)',
    result.candidates.length > 0 && result.candidates.every((c) => istHourOf(c.start) >= 17 && istHourOf(c.start) < 21)
  );
}

console.log(allPassed ? '\nALL TIMING SEARCH API CHECKS PASSED' : '\nSOME TIMING SEARCH API CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
