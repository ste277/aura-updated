import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { executeFindBestTime } from '../src/tools/findBestTime';
import { TIMING_LIMITS, isRealCalendarDate } from '../src/schemas/findBestTime';
import { buildTimingSearchRequest } from '../../web/lib/timingSearchRequest';
import { resolveTzOffsetMinutes } from '../../web/lib/timezone';
import type { DailyAssistantContext } from '../../../packages/recommendation/src/dailyAssistant';
import { CHENNAI } from './helpers';

const BASE = {
  activityId: 'workout',
  durationMinutes: 45,
  location: CHENNAI,
  timezone: 'Asia/Kolkata',
  referenceTime: '2026-11-09T00:00:00+05:30',
};

function rejects(args: unknown, pattern: RegExp, label: string): void {
  const outcome = executeFindBestTime(args);
  assert.equal(outcome.ok, false, `${label}: expected rejection`);
  if (!outcome.ok) {
    assert.equal(outcome.kind, 'INVALID_INPUT', label);
    assert.match(outcome.message, pattern, label);
  }
}

test('baseline input is accepted', () => {
  const outcome = executeFindBestTime(BASE);
  assert.equal(outcome.ok, true);
});

test('rejects invalid dates', () => {
  rejects({ ...BASE, dateRange: { start: '2026-02-30', end: '2026-03-01' } }, /real calendar date/, 'Feb 30');
  rejects({ ...BASE, dateRange: { start: '2026-13-01', end: '2026-13-02' } }, /real calendar date/, 'month 13');
  rejects({ ...BASE, dateRange: { start: '11/10/2026', end: '11/10/2026' } }, /real calendar date/, 'wrong format');
  assert.equal(isRealCalendarDate('2028-02-29'), true, 'leap day accepted');
  assert.equal(isRealCalendarDate('2027-02-29'), false, 'non-leap Feb 29 rejected');
});

test('rejects invalid timezones (same definition as lib/timezone.ts isValidIanaTimezone)', () => {
  rejects({ ...BASE, timezone: 'Mars/Olympus' }, /IANA timezone/, 'unknown zone');
  rejects({ ...BASE, timezone: 'IST' }, /IANA timezone/, 'abbreviation');
  rejects({ ...BASE, timezone: '' }, /IANA timezone/, 'empty');
});

test('rejects invalid coordinates', () => {
  rejects({ ...BASE, location: { latitude: 91, longitude: 0 } }, /latitude/, 'lat > 90');
  rejects({ ...BASE, location: { latitude: 0, longitude: -181 } }, /longitude/, 'lon < -180');
  rejects({ ...BASE, location: { latitude: '13', longitude: 80 } }, /latitude/, 'string lat');
  rejects({ ...BASE, location: { latitude: 13, longitude: 80, city: 'Chennai' } }, /location/, 'unexpected key');
  rejects({ ...BASE, location: undefined }, /location/, 'missing location');
});

test('rejects unsupported or ambiguous activity input', () => {
  rejects({ ...BASE, activityId: 'exercise' }, /not a supported Aura activity id/, 'unknown id');
  rejects({ ...BASE, activityId: undefined }, /exactly one of activityId or taskTitle/, 'neither');
  rejects({ ...BASE, taskTitle: 'Run' }, /exactly one of activityId or taskTitle/, 'both');
  rejects({ ...BASE, activityId: undefined, taskTitle: '   ' }, /taskTitle/, 'blank title');
  rejects({ ...BASE, activityId: undefined, taskTitle: 'x'.repeat(201) }, /taskTitle/, 'title too long');
});

test('rejects invalid time ranges and oversized search windows', () => {
  rejects({ ...BASE, dateRange: { start: '2026-11-12', end: '2026-11-10' } }, /end must not be before start/, 'reversed');
  rejects({ ...BASE, dateRange: { start: '2026-01-01', end: '2026-04-02' } }, /90 days or fewer/, '91 days');
  rejects({ ...BASE, dateRange: { start: '2026-11-10', end: '2026-11-10' }, horizon: 'TODAY' }, /either dateRange or horizon/, 'both window kinds');
  rejects({ ...BASE, horizon: 'CUSTOM' }, /horizon/, 'CUSTOM not exposed');
  rejects({ ...BASE, referenceTime: '2026-11-09T09:00:00' }, /explicit offset/, 'naive local time');
  rejects({ ...BASE, referenceTime: 'yesterday' }, /explicit offset/, 'not an instant');
  rejects({ ...BASE, durationMinutes: 10 }, /durationMinutes/, 'too short');
  rejects({ ...BASE, durationMinutes: 361 }, /durationMinutes/, 'too long');
  rejects({ ...BASE, limit: 0 }, /limit/, 'limit 0');
  rejects({ ...BASE, limit: 11 }, /limit/, 'limit 11');
  rejects({ ...BASE, timePreference: 'LUNCH' }, /timePreference/, 'bad preference');
});

test('rejects invalid work hours and workdays', () => {
  const rhythm = { workStart: '09:00', workEnd: '17:00', workDays: [1, 2, 3, 4, 5] };
  rejects({ ...BASE, dailyRhythm: { ...rhythm, workStart: '9:00' } }, /HH:mm/, 'unpadded hour');
  rejects({ ...BASE, dailyRhythm: { ...rhythm, workEnd: '24:00' } }, /HH:mm/, '24:00');
  rejects({ ...BASE, dailyRhythm: { ...rhythm, workStart: '18:00' } }, /before workEnd/, 'overnight');
  rejects({ ...BASE, dailyRhythm: { ...rhythm, workDays: [7] } }, /workDays/, 'weekday 7');
  rejects({ ...BASE, dailyRhythm: { ...rhythm, workDays: [1.5] } }, /workDays/, 'fractional weekday');
  rejects({ ...BASE, dailyRhythm: { workStart: '09:00', workEnd: '17:00' } }, /workDays/, 'missing workDays');
});

test('accepts empty and duplicate workDays, normalized by the shared validator', () => {
  const run = (workDays: number[]) => executeFindBestTime({ ...BASE, dailyRhythm: { workStart: '09:00', workEnd: '17:00', workDays } });
  const empty = run([]);
  const dupes = run([3, 1, 1, 3]);
  assert.equal(empty.ok && dupes.ok, true);
  if (empty.ok && dupes.ok) {
    assert.deepEqual(empty.result.query.dailyRhythm?.workDays, []);
    assert.deepEqual(dupes.result.query.dailyRhythm?.workDays, [1, 3]);
  }
});

test('rejects fractional limit and impossible referenceTime dates', () => {
  rejects({ ...BASE, limit: 2.5 }, /limit/, 'fractional limit');
  rejects({ ...BASE, referenceTime: '2026-02-30T00:00:00Z' }, /referenceTime/, 'Feb 30 instant');
});

test('rejects unexpected top-level fields (adapter level; see protocol 5b for the wire)', () => {
  rejects({ ...BASE, userId: 'someone-else' }, /userId|Unrecognized/i, 'userId smuggling');
});

test('schema bounds agree with buildTimingSearchRequest at every boundary', () => {
  const now = new Date('2026-11-09T00:00:00+05:30');
  const context: DailyAssistantContext = { now, ...CHENNAI, timezone: 'Asia/Kolkata', tzOffsetMinutes: resolveTzOffsetMinutes('Asia/Kolkata', now) };
  const route = (body: Record<string, unknown>) => buildTimingSearchRequest({ mode: 'FIND', activityId: 'workout', durationMinutes: 45, ...body }, context).ok;
  const tool = (args: Record<string, unknown>) => executeFindBestTime({ ...BASE, ...args }).ok;

  const cases: Record<string, unknown>[] = [
    { durationMinutes: TIMING_LIMITS.MIN_DURATION_MINUTES - 1 },
    { durationMinutes: TIMING_LIMITS.MIN_DURATION_MINUTES },
    { durationMinutes: TIMING_LIMITS.MAX_DURATION_MINUTES },
    { durationMinutes: TIMING_LIMITS.MAX_DURATION_MINUTES + 1 },
    { limit: TIMING_LIMITS.MIN_LIMIT - 1 },
    { limit: TIMING_LIMITS.MIN_LIMIT },
    { limit: TIMING_LIMITS.MAX_LIMIT },
    { limit: TIMING_LIMITS.MAX_LIMIT + 1 },
    { dateRange: { start: '2026-01-01', end: '2026-04-01' } }, // exactly 90
    { dateRange: { start: '2026-01-01', end: '2026-04-02' } }, // 91
    { dateRange: { start: '2026-11-10', end: '2026-11-09' } }, // reversed
  ];
  for (const c of cases) {
    assert.equal(tool(c), route(c), `boundary agreement for ${JSON.stringify(c)}`);
  }
});

test('pipeline exceptions are returned as CALCULATION_FAILED without message, stack or paths', () => {
  // Compiled CommonJS reads the export at call time, so patching the module
  // object substitutes a failing pipeline without touching any source file.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('../../web/lib/timingSearchDailyRhythm');
  const original = mod.runTimingSearchWithDailyRhythm;
  mod.runTimingSearchWithDailyRhythm = () => {
    const err = new Error('secret=hunter2 at /Users/someone/aura/db.ts');
    err.name = 'SolarComputationError';
    throw err;
  };
  try {
    const outcome = executeFindBestTime(BASE);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.kind, 'CALCULATION_FAILED');
      assert.equal(outcome.message, 'The timing calculation could not be completed (SolarComputationError).');
      assert.doesNotMatch(outcome.message, /hunter2|\/Users|db\.ts|\n\s+at /);
    }
  } finally {
    mod.runTimingSearchWithDailyRhythm = original;
  }
});

test('referenceTime defaults to the injected clock and is disclosed', () => {
  const fixed = new Date('2026-11-10T03:00:00Z');
  const outcome = executeFindBestTime({ ...BASE, referenceTime: undefined }, () => fixed);
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.result.query.referenceTime, fixed.toISOString());
    assert.equal(outcome.result.query.referenceTimeSource, 'SERVER_CLOCK');
    assert.deepEqual(outcome.result.query.searchWindow, { horizon: 'TODAY' });
  }
});
