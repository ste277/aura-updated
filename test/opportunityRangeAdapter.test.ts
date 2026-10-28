/**
 * Opportunity Scarcity V1 -- O2 range adapter (opportunityRangeAdapter.ts),
 * pure tests with injected fakes: no DB, no clock. The projection engine is
 * used ONLY as a test oracle here (to show the adapter's output composes);
 * no production code calls it yet.
 */
import {
  adaptOpportunityRangeInputs,
  loadOpportunityRangeInputs,
  type OpportunityRangeDeps,
  type OpportunityRangeRequest,
  type OpportunityRangeResult,
} from '../apps/web/lib/opportunityRangeAdapter';
import { projectOpportunityFacts } from '../apps/web/lib/opportunityProjection';
import { mergeUsableWindows, type AvailabilityConfiguration } from '../apps/web/lib/availabilityContext';
import { isActivePlanBlocker, type PlanBlockerCandidate } from '../apps/web/lib/planBlockerLifecycle';
import { localDateTimeToUTC, resolveLocalDateTime } from '../apps/web/lib/timezone';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const IST = 'Asia/Kolkata';
const LA = 'America/Los_Angeles';
const NY = 'America/New_York';
const iso = (s: string) => new Date(s);
const at = (date: string, hhmm: string, tz: string) => localDateTimeToUTC(date, hhmm, tz);
const NOW = iso('2026-10-01T00:00:00Z'); // before every range below unless stated

type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
const cfg = (...periods: [Weekday, string, string][]): AvailabilityConfiguration => ({ configured: true, periods: periods.map(([weekday, startTime, endTime]) => ({ weekday, startTime, endTime })) });
const UNCONFIGURED: AvailabilityConfiguration = { configured: false, periods: [] };
const plan = (status: PlanBlockerCandidate['status'], start: string, end: string): PlanBlockerCandidate => ({ start: iso(start), end: iso(end), status });
const req = (startDate: string, endDate: string, timezone = IST, now = NOW): OpportunityRangeRequest => ({ startDate, endDate, timezone, now });

function ok(r: OpportunityRangeResult) {
  if (r.status !== 'OK') throw new Error(`expected OK, got ${r.code}`);
  return r.inputs;
}
const adapt = (request: OpportunityRangeRequest, configuration: AvailabilityConfiguration, plans: PlanBlockerCandidate[] = []) => adaptOpportunityRangeInputs(request, configuration, plans);
function windowsOf(r: OpportunityRangeResult, date: string): string {
  const day = ok(r).availabilityByDate.get(date);
  if (!day) return 'MISSING';
  if (day.kind === 'UNKNOWN') return 'UNKNOWN';
  return day.windows.length === 0 ? 'KNOWN[]' : 'KNOWN[' + day.windows.map((w) => `${w.start.toISOString()}..${w.end.toISOString()}`).join(',') + ']';
}
const span = (date: string, a: string, b: string, tz: string) => `${at(date, a, tz).toISOString()}..${at(date, b, tz).toISOString()}`;

// Mon 2026-10-05 .. Sun 2026-10-11 (weekday: Mon=1 ... Sun=0)
const WEEK = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];

(async () => {
  // ============================================================
  // Availability: configured week, known empty, unconfigured, mixed
  // ============================================================
  {
    const r = adapt(req('2026-10-05', '2026-10-11'), cfg([1, '09:00', '12:00'], [3, '18:00', '19:00'], [5, '10:00', '11:00'], [5, '13:00', '14:00']));
    check('configured week: Monday window is the canonical instants of 09:00-12:00 IST', windowsOf(r, '2026-10-05') === `KNOWN[${span('2026-10-05', '09:00', '12:00', IST)}]`);
    check('configured week: Wednesday 18:00-19:00', windowsOf(r, '2026-10-07') === `KNOWN[${span('2026-10-07', '18:00', '19:00', IST)}]`);
    check('configured week: Friday has two windows in order', windowsOf(r, '2026-10-09') === `KNOWN[${span('2026-10-09', '10:00', '11:00', IST)},${span('2026-10-09', '13:00', '14:00', IST)}]`);
    check('configured week: one entry for every date in the range, no more', ok(r).availabilityByDate.size === 7 && WEEK.every((d) => ok(r).availabilityByDate.has(d)));
    check('configured week: weekdays without a window are known empty (Tue/Thu/Sat/Sun)', ['2026-10-06', '2026-10-08', '2026-10-10', '2026-10-11'].every((d) => windowsOf(r, d) === 'KNOWN[]'));
  }
  {
    const r = adapt(req('2026-10-05', '2026-10-07'), cfg([1, '09:00', '10:00'], [3, '09:00', '10:00']));
    check('mixed weekdays: Mon known windows, Tue KNOWN EMPTY (not unknown), Wed known windows', windowsOf(r, '2026-10-05').startsWith('KNOWN[2') && windowsOf(r, '2026-10-06') === 'KNOWN[]' && windowsOf(r, '2026-10-07').startsWith('KNOWN[2'));
    check('configured-empty: a configured user with an all-empty week is KNOWN empty for every day', WEEK.every((d) => windowsOf(adapt(req('2026-10-05', '2026-10-11'), cfg()), d) === 'KNOWN[]'));
  }
  {
    const r = adapt(req('2026-10-05', '2026-10-11'), UNCONFIGURED);
    check('unconfigured: every date in the range is UNKNOWN', WEEK.every((d) => windowsOf(r, d) === 'UNKNOWN'));
    const withStalePeriods = adapt(req('2026-10-05', '2026-10-11'), { configured: false, periods: [{ weekday: 1, startTime: '09:00', endTime: '17:00' }] });
    check('unconfigured: stored period rows are ignored when the user is not configured -- still UNKNOWN, no synthesized window', WEEK.every((d) => windowsOf(withStalePeriods, d) === 'UNKNOWN'));
    const today = adapt({ startDate: '2026-10-05', endDate: '2026-10-05', timezone: IST, now: at('2026-10-05', '10:00', IST) }, UNCONFIGURED);
    check('unconfigured TODAY: UNKNOWN -- the constructor\'s remaining-today fallback is NOT used', windowsOf(today, '2026-10-05') === 'UNKNOWN');
  }

  // ============================================================
  // Today: windows are the full canonical windows; the projection engine owns clipping
  // ============================================================
  {
    const nowInside = at('2026-10-05', '10:30', IST);
    const r = adapt({ startDate: '2026-10-05', endDate: '2026-10-05', timezone: IST, now: nowInside }, cfg([1, '09:00', '12:00']));
    check('today (now inside the window): the adapter supplies the FULL canonical window, not a clipped one', windowsOf(r, '2026-10-05') === `KNOWN[${span('2026-10-05', '09:00', '12:00', IST)}]`);
    const facts = (now: Date, dur: number) => {
      const inputs = ok(adapt({ startDate: '2026-10-05', endDate: '2026-10-05', timezone: IST, now }, cfg([1, '09:00', '12:00'])));
      const res = projectOpportunityFacts({ planningDate: '2026-10-05', horizonEndDate: '2026-10-05', durationMinutes: dur, timezone: IST, now, availabilityByDate: inputs.availabilityByDate, blockers: inputs.blockers });
      return res.status === 'OK' ? res.days[0].state : 'ERR';
    };
    check('composition: now before / inside / after the window -> the engine clips (feasible / 90 left for 90 / infeasible)', facts(at('2026-10-05', '08:00', IST), 60) === 'KNOWN_FEASIBLE' && facts(nowInside, 90) === 'KNOWN_FEASIBLE' && facts(nowInside, 91) === 'KNOWN_INFEASIBLE' && facts(at('2026-10-05', '12:30', IST), 30) === 'KNOWN_INFEASIBLE');
    const farFuture = adapt(req('2026-10-12', '2026-10-12', IST, iso('2026-10-12T10:00:00Z')), cfg([1, '09:00', '12:00']));
    check('future/same-day windows are identical whether or not the date is "today" (no clipping inside the adapter)', windowsOf(farFuture, '2026-10-12') === `KNOWN[${span('2026-10-12', '09:00', '12:00', IST)}]`);
  }

  // ============================================================
  // Timezones: UTC, positive offset, negative offset
  // ============================================================
  {
    const r = adapt(req('2026-10-05', '2026-10-06', 'UTC'), cfg([1, '09:00', '10:00'], [2, '23:00', '23:59']));
    check('UTC: windows are the literal wall times, civil boundaries preserved', windowsOf(r, '2026-10-05') === '' + `KNOWN[2026-10-05T09:00:00.000Z..2026-10-05T10:00:00.000Z]` && windowsOf(r, '2026-10-06') === 'KNOWN[2026-10-06T23:00:00.000Z..2026-10-06T23:59:00.000Z]');
    const bad = adapt(req('2026-10-05', '2026-10-05', 'UTC'), UNCONFIGURED);
    check('UTC is accepted as a timezone (the runtime contract), not rejected', bad.status === 'OK');
  }
  {
    // Kolkata: 00:30-02:00 IST on the 6th is 19:00Z-20:30Z on the 5th (a different UTC date).
    const r = adapt(req('2026-10-06', '2026-10-06', IST), cfg([2, '00:30', '02:00']));
    check('positive offset (Kolkata): the window belongs to local date 10-06 although its UTC instants fall on 10-05', windowsOf(r, '2026-10-06') === 'KNOWN[2026-10-05T19:00:00.000Z..2026-10-05T20:30:00.000Z]');
    // LA: 22:00-23:30 PDT on the 6th is 05:00Z-06:30Z on the 7th.
    const la = adapt(req('2026-10-06', '2026-10-06', LA), cfg([2, '22:00', '23:30']));
    check('negative offset (Los Angeles): the window belongs to local date 10-06 although its UTC instants fall on 10-07', windowsOf(la, '2026-10-06') === 'KNOWN[2026-10-07T05:00:00.000Z..2026-10-07T06:30:00.000Z]');
  }

  // ============================================================
  // UTC bounds of the plan query (no 24-hour assumption)
  // ============================================================
  {
    const bounds = async (request: OpportunityRangeRequest) => {
      let seen: { from: Date; to: Date } | undefined;
      await loadOpportunityRangeInputs(request, { loadAvailabilityConfiguration: async () => UNCONFIGURED, loadPlansOverlappingRange: async (b) => ((seen = b), []) });
      return seen!;
    };
    const u = await bounds(req('2026-10-05', '2026-10-07', 'UTC'));
    check('UTC bounds: local start of the first date through local start of the day AFTER the last date', u.from.toISOString() === '2026-10-05T00:00:00.000Z' && u.to.toISOString() === '2026-10-08T00:00:00.000Z');
    const k = await bounds(req('2026-10-05', '2026-10-05', IST));
    check('Kolkata bounds: 2026-10-04T18:30Z .. 2026-10-05T18:30Z', k.from.toISOString() === '2026-10-04T18:30:00.000Z' && k.to.toISOString() === '2026-10-05T18:30:00.000Z');
    const spring = await bounds(req('2026-03-07', '2026-03-08', NY));
    check('DST spring-forward range (NY 03-07..03-08): the range is 47 hours, not 48', (spring.to.getTime() - spring.from.getTime()) / 3600000 === 47 && spring.from.toISOString() === '2026-03-07T05:00:00.000Z' && spring.to.toISOString() === '2026-03-09T04:00:00.000Z');
    const fall = await bounds(req('2026-10-31', '2026-11-01', NY));
    check('DST fall-back range (NY 10-31..11-01): the range is 49 hours, not 48', (fall.to.getTime() - fall.from.getTime()) / 3600000 === 49);
    const la = await bounds(req('2026-10-06', '2026-10-06', LA));
    check('Los Angeles bounds: 2026-10-06T07:00Z .. 2026-10-07T07:00Z', la.from.toISOString() === '2026-10-06T07:00:00.000Z' && la.to.toISOString() === '2026-10-07T07:00:00.000Z');
  }

  // ============================================================
  // DST: characterize the canonical conversion, then encode the contract
  // ============================================================
  {
    // Canonical contract (characterized, not wished for): ordinary times on a transition day resolve
    // exactly; wall times inside the transition hour are NONEXISTENT (spring gap) or AMBIGUOUS (fall overlap).
    check('canonical (characterized): NY 2026-03-08 01:59 and 03:00 are exact; 02:30 is NONEXISTENT', resolveLocalDateTime('2026-03-08', '01:59', NY).status === 'OK' && resolveLocalDateTime('2026-03-08', '03:00', NY).status === 'OK' && resolveLocalDateTime('2026-03-08', '02:30', NY).status === 'NONEXISTENT');
    check('canonical (characterized): NY 2026-11-01 00:30 and 02:00 are exact; 01:30 is AMBIGUOUS', resolveLocalDateTime('2026-11-01', '00:30', NY).status === 'OK' && resolveLocalDateTime('2026-11-01', '02:00', NY).status === 'OK' && resolveLocalDateTime('2026-11-01', '01:30', NY).status === 'AMBIGUOUS');
    const s = (d: string, tz: string, ...p: [Weekday, string, string][]) => adapt(req(d, d, tz), cfg(...p));
    // 2026-03-08 and 2026-11-01 are Sundays (weekday 0).
    check('spring-forward: an ordinary daytime window on the transition day is exact (EDT: 13:00Z..14:00Z)', windowsOf(s('2026-03-08', NY, [0, '09:00', '10:00']), '2026-03-08') === 'KNOWN[2026-03-08T13:00:00.000Z..2026-03-08T14:00:00.000Z]');
    check('spring-forward: a window spanning the skipped hour keeps real elapsed time (01:00 EST..04:00 EDT = 06:00Z..08:00Z, 120 real minutes)', windowsOf(s('2026-03-08', NY, [0, '01:00', '04:00']), '2026-03-08') === 'KNOWN[2026-03-08T06:00:00.000Z..2026-03-08T08:00:00.000Z]');
    check('spring-forward: a window boundary INSIDE the nonexistent hour (02:30) is UNKNOWN, never a guessed instant', windowsOf(s('2026-03-08', NY, [0, '02:30', '05:00']), '2026-03-08') === 'UNKNOWN' && windowsOf(s('2026-03-08', NY, [0, '00:30', '02:30']), '2026-03-08') === 'UNKNOWN');
    check('fall-back: a window spanning the repeated hour is exact and 240 real minutes (00:30 EDT..03:30 EST = 04:30Z..08:30Z)', windowsOf(s('2026-11-01', NY, [0, '00:30', '03:30']), '2026-11-01') === 'KNOWN[2026-11-01T04:30:00.000Z..2026-11-01T08:30:00.000Z]');
    check('fall-back: a window boundary INSIDE the ambiguous hour (01:30) is UNKNOWN, never a guessed occurrence', windowsOf(s('2026-11-01', NY, [0, '01:30', '04:00']), '2026-11-01') === 'UNKNOWN');
    const zones: [string, string, string][] = [
      [LA, '2026-03-08', '02:30'],
      ['Europe/London', '2026-03-29', '01:30'],
      ['Australia/Sydney', '2026-10-04', '02:30'],
      [LA, '2026-11-01', '01:30'],
      ['Europe/London', '2026-10-25', '01:30'],
      ['Australia/Sydney', '2026-04-05', '02:30'],
    ];
    const weekdayOf = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay() as Weekday;
    check(
      'every zone/transition: a boundary in the transition hour is UNKNOWN regardless of the zone-dependent legacy conversion',
      zones.every(([tz, d, t]) => windowsOf(adapt(req(d, d, tz), cfg([weekdayOf(d), t, '12:00'])), d) === 'UNKNOWN')
    );
    check('non-DST zone: the same wall time is just exact (Kolkata 02:30, UTC 02:30)', windowsOf(s('2026-03-08', IST, [0, '02:30', '04:00']), '2026-03-08').startsWith('KNOWN[') && windowsOf(s('2026-03-08', 'UTC', [0, '02:30', '04:00']), '2026-03-08').startsWith('KNOWN['));
    const ordinary = adapt(req('2026-03-07', '2026-03-09', NY), cfg([6, '09:00', '10:00'], [0, '09:00', '10:00'], [1, '09:00', '10:00']));
    check('a transition elsewhere in the range does not affect other dates (Sat/Mon exact, Sun exact)', ['2026-03-07', '2026-03-08', '2026-03-09'].every((d) => windowsOf(ordinary, d).startsWith('KNOWN[2')));
  }

  // ============================================================
  // Blockers
  // ============================================================
  {
    const R = req('2026-10-06', '2026-10-07', IST);
    const within = ok(adapt(R, UNCONFIGURED, [plan('UPCOMING', '2026-10-06T05:00:00Z', '2026-10-06T06:00:00Z')])).blockers;
    check('within-day blocker: the exact absolute interval, tagged as a fixed plan', within.length === 1 && within[0].start.toISOString() === '2026-10-06T05:00:00.000Z' && within[0].end.toISOString() === '2026-10-06T06:00:00.000Z' && within[0].source === 'FIXED_PLAN');
    // cross-midnight (IST): 23:30 IST 10-06 .. 01:00 IST 10-07  =  18:00Z .. 19:30Z on 10-06
    const crossPlan = plan('UPCOMING', '2026-10-06T18:00:00Z', '2026-10-06T19:30:00Z');
    const config = cfg([2, '23:00', '23:59'], [3, '00:00', '02:00']);
    const inputs = ok(adapt(R, config, [crossPlan]));
    check('cross-midnight blocker: kept once as one absolute interval (not split, not lost)', inputs.blockers.length === 1);
    const project = (duration: number) => {
      const res = projectOpportunityFacts({ planningDate: '2026-10-06', horizonEndDate: '2026-10-07', durationMinutes: duration, timezone: IST, now: NOW, availabilityByDate: inputs.availabilityByDate, blockers: inputs.blockers });
      return res.status === 'OK' ? res.days.map((d) => d.state).join(' ') : 'ERR';
    };
    // day 1 window 23:00-23:59 minus 23:30-: leaves 30 min; day 2 window 00:00-02:00 minus -01:00 leaves 60 min
    check('cross-midnight blocker: BOTH local dates see the overlap (day 1 keeps 30 min, day 2 keeps 60 min)', project(30) === 'KNOWN_FEASIBLE KNOWN_FEASIBLE' && project(31) === 'KNOWN_INFEASIBLE KNOWN_FEASIBLE' && project(61) === 'KNOWN_INFEASIBLE KNOWN_INFEASIBLE' && project(60) === 'KNOWN_INFEASIBLE KNOWN_FEASIBLE');
    const bounds = { from: at('2026-10-06', '00:00', IST), to: at('2026-10-08', '00:00', IST) };
    const edges = ok(adapt(R, UNCONFIGURED, [
      plan('UPCOMING', new Date(bounds.from.getTime() - 3600000).toISOString(), new Date(bounds.from.getTime() + 3600000).toISOString()), // starts before, ends inside
      plan('UPCOMING', new Date(bounds.to.getTime() - 3600000).toISOString(), new Date(bounds.to.getTime() + 3600000).toISOString()), // starts inside, ends after
      plan('UPCOMING', new Date(bounds.from.getTime() - 7200000).toISOString(), new Date(bounds.to.getTime() + 7200000).toISOString()), // spans the whole range
      plan('UPCOMING', new Date(bounds.from.getTime() - 7200000).toISOString(), bounds.from.toISOString()), // ends exactly at the start: no overlap
      plan('UPCOMING', bounds.to.toISOString(), new Date(bounds.to.getTime() + 3600000).toISOString()), // starts exactly at the end: no overlap
      plan('UPCOMING', new Date(bounds.from.getTime() - 86400000).toISOString(), new Date(bounds.from.getTime() - 82800000).toISOString()), // wholly before
    ])).blockers;
    check('range edges: starts-before/ends-inside, starts-inside/ends-after and range-spanning plans are kept; plans merely touching the range or wholly outside are dropped (half-open)', edges.length === 3);
  }
  {
    const R = req('2026-10-06', '2026-10-06', IST, iso('2026-10-06T10:00:00Z'));
    const kinds = (status: PlanBlockerCandidate['status'], start: string, end: string) => ok(adapt(R, UNCONFIGURED, [plan(status, start, end)])).blockers.length;
    const F = ['2026-10-06T15:00:00Z', '2026-10-06T16:00:00Z']; // later than now
    const P = ['2026-10-06T07:00:00Z', '2026-10-06T08:00:00Z']; // already elapsed
    check('inactive statuses never block: CANCELLED, SKIPPED, MOVED (future)', kinds('CANCELLED', F[0], F[1]) === 0 && kinds('SKIPPED', F[0], F[1]) === 0 && kinds('MOVED', F[0], F[1]) === 0);
    check('UPCOMING (not yet elapsed) blocks; LOGGED blocks', kinds('UPCOMING', F[0], F[1]) === 1 && kinds('LOGGED', F[0], F[1]) === 1);
    check('lifecycle reuse: an ELAPSED UPCOMING plan does not block (opportunity blocking semantics, unlike a recurrence count) while an elapsed LOGGED plan still does', kinds('UPCOMING', P[0], P[1]) === 0 && kinds('LOGGED', P[0], P[1]) === 1);
    check('lifecycle reuse: results equal isActivePlanBlocker itself for every status', (['UPCOMING', 'LOGGED', 'CANCELLED', 'SKIPPED', 'MOVED'] as const).every((s) => (kinds(s, F[0], F[1]) === 1) === isActivePlanBlocker(plan(s, F[0], F[1]), iso('2026-10-06T10:00:00Z'))));
  }

  // ============================================================
  // Query count: independent of range length
  // ============================================================
  {
    const counts = async (days: number) => {
      const c = { availability: 0, plans: 0 };
      const deps: OpportunityRangeDeps = {
        loadAvailabilityConfiguration: async () => ((c.availability += 1), cfg([1, '09:00', '10:00'])),
        loadPlansOverlappingRange: async () => ((c.plans += 1), []),
      };
      const end = new Date(Date.UTC(2026, 9, 5 + days - 1)).toISOString().slice(0, 10);
      const result = await loadOpportunityRangeInputs(req('2026-10-05', end), deps);
      return { ...c, inMemoryDays: ok(result).availabilityByDate.size };
    };
    const [one, two, seven, ninety] = [await counts(1), await counts(2), await counts(7), await counts(90)];
    check('query count: 1 day -> 1 availability load + 1 plan query, 1 in-memory day resolution', one.availability === 1 && one.plans === 1 && one.inMemoryDays === 1);
    check('query count: 2 days -> 1 + 1, 2 day resolutions', two.availability === 1 && two.plans === 1 && two.inMemoryDays === 2);
    check('query count: 7 days -> 1 + 1, 7 day resolutions', seven.availability === 1 && seven.plans === 1 && seven.inMemoryDays === 7);
    check('query count does not scale with the range (90 days -> still 1 + 1)', ninety.availability === 1 && ninety.plans === 1 && ninety.inMemoryDays === 90);
  }

  // ============================================================
  // Validation: fails before any load
  // ============================================================
  {
    let loads = 0;
    const deps: OpportunityRangeDeps = { loadAvailabilityConfiguration: async () => ((loads += 1), UNCONFIGURED), loadPlansOverlappingRange: async () => ((loads += 1), []) };
    const code = async (r: OpportunityRangeRequest) => ((await loadOpportunityRangeInputs(r, deps)) as any).code;
    check('invalid date -> INVALID_DATE (no rollover): 2026-02-30, 2026-13-01, not-a-date', (await code(req('2026-02-30', '2026-03-02'))) === 'INVALID_DATE' && (await code(req('2026-10-05', '2026-13-01'))) === 'INVALID_DATE' && (await code(req('not-a-date', '2026-10-05'))) === 'INVALID_DATE');
    check('reversed range -> INVALID_RANGE (never swapped)', (await code(req('2026-10-08', '2026-10-05'))) === 'INVALID_RANGE');
    check('range longer than the projection engine\'s single authoritative bound -> RANGE_TOO_LONG', (await code(req('2026-01-01', '2027-01-02'))) === 'RANGE_TOO_LONG' && ((await loadOpportunityRangeInputs(req('2026-01-01', '2027-01-01'), deps)) as any).status === 'OK');
    check('invalid timezone and invalid now are typed failures', (await code(req('2026-10-05', '2026-10-05', 'Not/A_Real_Timezone'))) === 'INVALID_TIMEZONE' && (await code(req('2026-10-05', '2026-10-05', IST, new Date(NaN)))) === 'INVALID_NOW');
    check('every invalid request failed BEFORE any load (loads happen only for the one valid 366-day request: 2)', loads === 2);
  }

  // ============================================================
  // Determinism, immutability, composition
  // ============================================================
  {
    const config = cfg([1, '14:00', '15:00'], [1, '09:00', '12:00'], [3, '09:00', '10:00']);
    const plans = [plan('UPCOMING', '2026-10-07T05:00:00Z', '2026-10-07T06:00:00Z'), plan('LOGGED', '2026-10-06T05:00:00Z', '2026-10-06T06:00:00Z')];
    const a = JSON.stringify([...ok(adapt(req('2026-10-05', '2026-10-09'), config, plans)).availabilityByDate.entries()]) + JSON.stringify(ok(adapt(req('2026-10-05', '2026-10-09'), config, plans)).blockers);
    const b = JSON.stringify([...ok(adapt(req('2026-10-05', '2026-10-09'), config, plans)).availabilityByDate.entries()]) + JSON.stringify(ok(adapt(req('2026-10-05', '2026-10-09'), config, plans)).blockers);
    check('determinism: the same range/timezone/now/configuration/plans produce identical output', a === b);
    const frozenConfig: AvailabilityConfiguration = Object.freeze({ configured: true, periods: Object.freeze(config.periods.map((p) => Object.freeze({ ...p }))) });
    const frozenPlans = Object.freeze(plans.map((p) => Object.freeze({ ...p })));
    let threw = false;
    try {
      adaptOpportunityRangeInputs(req('2026-10-05', '2026-10-09'), frozenConfig, frozenPlans);
    } catch {
      threw = true;
    }
    check('immutability: frozen configuration and plans are accepted (nothing is mutated)', !threw);
    check('unsorted periods for one weekday come back merged and ordered (Monday 14-15 then 09-12 -> 09-12, 14-15)', windowsOf(adapt(req('2026-10-05', '2026-10-05'), config), '2026-10-05') === `KNOWN[${span('2026-10-05', '09:00', '12:00', IST)},${span('2026-10-05', '14:00', '15:00', IST)}]`);
    const full = ok(adapt(req('2026-10-05', '2026-10-09'), cfg([1, '09:00', '10:00'], [2, '09:00', '09:20'], [3, '09:00', '11:00']), [plan('UPCOMING', '2026-10-07T03:30:00Z', '2026-10-07T05:00:00Z')]));
    const res = projectOpportunityFacts({ planningDate: '2026-10-05', horizonEndDate: '2026-10-09', durationMinutes: 60, timezone: IST, now: NOW, availabilityByDate: full.availabilityByDate, blockers: full.blockers });
    check('composition with the engine: Mon fits 60, Tue too short, Wed blocked by a plan, Thu/Fri known empty -> viable 1, unknown 0, COMPLETE', res.status === 'OK' && res.facts.viableDays === 1 && res.facts.unknownDays === 0 && res.facts.coverage === 'COMPLETE' && res.days[0].state === 'KNOWN_FEASIBLE' && res.days[2].state === 'KNOWN_INFEASIBLE');
    const unk = ok(adapt(req('2026-10-05', '2026-10-07'), UNCONFIGURED));
    const resU = projectOpportunityFacts({ planningDate: '2026-10-05', horizonEndDate: '2026-10-07', durationMinutes: 30, timezone: IST, now: NOW, availabilityByDate: unk.availabilityByDate, blockers: unk.blockers });
    check('composition: an unconfigured range yields coverage UNKNOWN (never zero opportunities)', resU.status === 'OK' && resU.facts.coverage === 'UNKNOWN' && resU.facts.unknownDays === 3 && resU.facts.viableDays === 0);
  }

  // ============================================================
  // Window-merge consolidation: the one canonical merge, exercised directly
  // ============================================================
  {
    const w = (a: string, b: string) => ({ start: iso(a), end: iso(b) });
    const m = (xs: { start: Date; end: Date }[]) => mergeUsableWindows(xs).map((x) => `${x.start.toISOString().slice(11, 16)}-${x.end.toISOString().slice(11, 16)}`).join(',');
    const D = '2026-10-06T';
    check('merge: overlapping spans merge', m([w(D + '09:00:00Z', D + '10:00:00Z'), w(D + '09:30:00Z', D + '11:00:00Z')]) === '09:00-11:00');
    check('merge: touching (adjacent) spans merge into one contiguous span', m([w(D + '09:00:00Z', D + '10:00:00Z'), w(D + '10:00:00Z', D + '11:00:00Z')]) === '09:00-11:00');
    check('merge: duplicate spans collapse', m([w(D + '09:00:00Z', D + '10:00:00Z'), w(D + '09:00:00Z', D + '10:00:00Z')]) === '09:00-10:00');
    check('merge: a contained span is absorbed', m([w(D + '09:00:00Z', D + '12:00:00Z'), w(D + '10:00:00Z', D + '11:00:00Z')]) === '09:00-12:00');
    check('merge: unsorted input is sorted; a separated span stays separate', m([w(D + '14:00:00Z', D + '15:00:00Z'), w(D + '09:00:00Z', D + '10:00:00Z')]) === '09:00-10:00,14:00-15:00');
    check('merge: a one-minute gap is preserved', m([w(D + '09:00:00Z', D + '10:00:00Z'), w(D + '10:01:00Z', D + '11:00:00Z')]) === '09:00-10:00,10:01-11:00');
    const frozen = Object.freeze([Object.freeze(w(D + '10:00:00Z', D + '11:00:00Z')), Object.freeze(w(D + '09:00:00Z', D + '10:30:00Z'))]);
    let mutated = false;
    try {
      mergeUsableWindows(frozen);
    } catch {
      mutated = true;
    }
    check('merge: never mutates its input (frozen input accepted, original order unchanged)', !mutated && frozen[0].start.toISOString().startsWith(D + '10:00'));
  }

  if (!allPassed) {
    console.error('SOME OPPORTUNITY RANGE ADAPTER CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL OPPORTUNITY RANGE ADAPTER CHECKS PASSED');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
