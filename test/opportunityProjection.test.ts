/**
 * Opportunity Scarcity V1 -- O1 pure projection engine
 * (apps/web/lib/opportunityProjection.ts). No DB, no network, no clock.
 */
import {
  projectOpportunityFacts,
  MAX_PROJECTION_HORIZON_DAYS,
  type OpportunityProjectionInput,
  type DayAvailabilityInput,
  type OpportunityProjectionResult,
} from '../apps/web/lib/opportunityProjection';
import type { BlockedInterval } from '../apps/web/lib/dayCapacity';
import { localDateTimeToUTC, getDatePartsInTimezone } from '../apps/web/lib/timezone';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const IST = 'Asia/Kolkata';
const LA = 'America/Los_Angeles';
const NY = 'America/New_York';
const iso = (s: string) => new Date(s);
const at = (date: string, hhmm: string, tz = IST) => localDateTimeToUTC(date, hhmm, tz);
const win = (date: string, start: string, end: string, tz = IST) => ({ start: at(date, start, tz), end: at(date, end, tz) });
const known = (...windows: { start: Date; end: Date }[]): DayAvailabilityInput => ({ kind: 'KNOWN', windows });
const UNKNOWN: DayAvailabilityInput = { kind: 'UNKNOWN' };
const blk = (date: string, start: string, end: string, tz = IST): BlockedInterval => ({ ...win(date, start, end, tz), source: 'FIXED_PLAN' });
const avail = (entries: Record<string, DayAvailabilityInput>) => new Map(Object.entries(entries));

const PAST_NOW = iso('2026-10-01T00:00:00Z'); // earlier than every horizon day used below: nothing is clipped

function run(overrides: Partial<OpportunityProjectionInput> & { availabilityByDate?: ReadonlyMap<string, DayAvailabilityInput> }): OpportunityProjectionResult {
  return projectOpportunityFacts({
    planningDate: '2026-10-06',
    horizonEndDate: '2026-10-06',
    durationMinutes: 30,
    timezone: IST,
    now: PAST_NOW,
    availabilityByDate: new Map(),
    blockers: [],
    ...overrides,
  });
}
function facts(r: OpportunityProjectionResult) {
  if (r.status !== 'OK') throw new Error(`expected OK, got ${r.code}`);
  return r.facts;
}
function states(r: OpportunityProjectionResult): string {
  if (r.status !== 'OK') throw new Error('expected OK');
  return r.days.map((d) => `${d.date}:${d.state}`).join(' ');
}

const DAYS5 = ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'];
const fit60 = (date: string) => known(win(date, '09:00', '10:00'));

// ============================================================
// Required A-C: counts of viable days (no requirement concept at all)
// ============================================================
{
  const r = run({ horizonEndDate: '2026-10-10', availabilityByDate: avail(Object.fromEntries(DAYS5.map((d) => [d, fit60(d)]))) });
  const f = facts(r);
  check('A. five known days each with a duration-fit span -> viableDays 5, unknownDays 0, coverage COMPLETE', f.viableDays === 5 && f.unknownDays === 0 && f.coverage === 'COMPLETE' && f.evaluatedDays === 5);
}
{
  const a = Object.fromEntries(DAYS5.map((d, i) => [d, i < 2 ? fit60(d) : known(win(d, '09:00', '09:10'))]));
  const f = facts(run({ horizonEndDate: '2026-10-10', availabilityByDate: avail(a) }));
  check('B. two viable days in the horizon -> viableDays 2 (others known infeasible, not unknown)', f.viableDays === 2 && f.unknownDays === 0 && f.coverage === 'COMPLETE');
}
{
  const a = Object.fromEntries(DAYS5.map((d, i) => [d, i === 0 ? fit60(d) : known()]));
  const r = run({ horizonEndDate: '2026-10-10', availabilityByDate: avail(a) });
  const f = facts(r);
  check('C. one viable day -> viableDays 1 (a plain count: no shortfall/at-risk concept exists)', f.viableDays === 1 && f.coverage === 'COMPLETE');
  check('C. the output has no evaluative field: exactly the six original facts plus the four additive first-day/after-first-day facts (P0b)', Object.keys(f).sort().join(',') === 'afterStartEvaluatedDays,afterStartUnknownDays,afterStartViableDays,coverage,evaluatedDays,horizonEndDate,horizonStartDate,startDateState,unknownDays,viableDays');
}

// ============================================================
// Required D, PARTIAL, ALL UNKNOWN, CONFIGURED_EMPTY
// ============================================================
{
  const a = { '2026-10-06': fit60('2026-10-06'), '2026-10-07': UNKNOWN, '2026-10-08': known() };
  const r = run({ horizonEndDate: '2026-10-09', availabilityByDate: avail(a) }); // 10-09 has no entry at all
  const f = facts(r);
  check('D. unknown days stay visible in the aggregate (explicit UNKNOWN and absent entry both count)', f.unknownDays === 2 && f.viableDays === 1 && f.evaluatedDays === 4);
  check('D. an unknown day is never converted to known infeasible; a known-empty day is never unknown', states(r) === '2026-10-06:KNOWN_FEASIBLE 2026-10-07:UNKNOWN 2026-10-08:KNOWN_INFEASIBLE 2026-10-09:UNKNOWN');
}
{
  const f = facts(run({ availabilityByDate: avail({ '2026-10-06': known() }) }));
  const r = run({ availabilityByDate: avail({ '2026-10-06': known() }) });
  check('CONFIGURED_EMPTY: a known day with zero windows is KNOWN_INFEASIBLE, not UNKNOWN', states(r) === '2026-10-06:KNOWN_INFEASIBLE' && f.unknownDays === 0 && f.viableDays === 0 && f.coverage === 'COMPLETE');
}
{
  const a = { '2026-10-06': fit60('2026-10-06'), '2026-10-07': fit60('2026-10-07'), '2026-10-08': known(), '2026-10-09': UNKNOWN };
  const f = facts(run({ horizonEndDate: '2026-10-09', availabilityByDate: avail(a) }));
  check('PARTIAL: 4 evaluated, 2 feasible, 1 known infeasible, 1 unknown', f.evaluatedDays === 4 && f.viableDays === 2 && f.unknownDays === 1 && f.coverage === 'PARTIAL');
  check('PARTIAL: known infeasible count is derivable (4 - 2 - 1 = 1)', f.evaluatedDays - f.viableDays - f.unknownDays === 1);
  check('lower-bound semantics: true viable lies within [viableDays, viableDays + unknownDays] = [2, 3]', f.viableDays === 2 && f.viableDays + f.unknownDays === 3);
}
{
  const r = run({ horizonEndDate: '2026-10-08' });
  const f = facts(r);
  check('ALL UNKNOWN: viableDays 0, unknownDays = evaluatedDays, coverage UNKNOWN', f.viableDays === 0 && f.unknownDays === f.evaluatedDays && f.evaluatedDays === 3 && f.coverage === 'UNKNOWN');
  check('ALL UNKNOWN: every day is UNKNOWN, never KNOWN_INFEASIBLE (zero here does not mean zero true opportunities)', states(r) === '2026-10-06:UNKNOWN 2026-10-07:UNKNOWN 2026-10-08:UNKNOWN');
}
{
  const f = facts(run({ durationMinutes: 120, horizonEndDate: '2026-10-08', availabilityByDate: avail({ '2026-10-06': fit60('2026-10-06'), '2026-10-07': known(win('2026-10-07', '09:00', '10:30')), '2026-10-08': known() }) }));
  check('G. duration exceeds every known span -> viableDays 0, unknownDays 0, coverage COMPLETE (factual zero under known data)', f.viableDays === 0 && f.unknownDays === 0 && f.coverage === 'COMPLETE');
}

// ============================================================
// Required E, F (today semantics), H (blocker changes feasibility)
// ============================================================
{
  const NOW = at('2026-10-06', '08:00');
  const f = facts(run({ now: NOW, availabilityByDate: avail({ '2026-10-06': known(win('2026-10-06', '09:00', '10:00')) }) }));
  check('E. today is the only supplied day and feasible -> viableDays 1 (a count; no "last chance" notion)', f.viableDays === 1 && f.evaluatedDays === 1);
}
{
  const NOW = at('2026-10-06', '08:00');
  const r = run({
    now: NOW,
    horizonEndDate: '2026-10-07',
    availabilityByDate: avail({ '2026-10-06': known(win('2026-10-06', '09:00', '10:00')), '2026-10-07': known(win('2026-10-07', '09:00', '10:00')) }),
    blockers: [blk('2026-10-06', '09:00', '10:00')],
  });
  check('F. today blocked, tomorrow feasible -> today KNOWN_INFEASIBLE, tomorrow KNOWN_FEASIBLE, viableDays 1', states(r) === '2026-10-06:KNOWN_INFEASIBLE 2026-10-07:KNOWN_FEASIBLE' && facts(r).viableDays === 1);
}
{
  const a = avail({ '2026-10-08': known(win('2026-10-08', '09:00', '10:00')) });
  const without = facts(run({ planningDate: '2026-10-08', horizonEndDate: '2026-10-08', availabilityByDate: a }));
  const withBlocker = facts(run({ planningDate: '2026-10-08', horizonEndDate: '2026-10-08', availabilityByDate: a, blockers: [blk('2026-10-08', '08:30', '10:30')] }));
  check('H (replacement). a generic blocker consuming a future window changes feasibility (1 -> 0) with no Goal/Rhythm concept', without.viableDays === 1 && withBlocker.viableDays === 0 && withBlocker.coverage === 'COMPLETE');
}

// ============================================================
// Today clipping (explicit now; no wall clock)
// ============================================================
{
  const w = known(win('2026-10-06', '09:00', '10:00'));
  const day = (now: string, availability = w) => states(run({ now: at('2026-10-06', now), availabilityByDate: avail({ '2026-10-06': availability }) }));
  check('clip: now before the window -> whole window usable (feasible)', day('08:00') === '2026-10-06:KNOWN_FEASIBLE');
  check('clip: now inside the window leaves 15 minutes of a needed 30 -> infeasible', day('09:45') === '2026-10-06:KNOWN_INFEASIBLE');
  check('clip: window 09:00-11:00 with now 09:45 leaves 75 minutes -> feasible', day('09:45', known(win('2026-10-06', '09:00', '11:00'))) === '2026-10-06:KNOWN_FEASIBLE');
  check('clip: now after the window -> infeasible', day('10:30') === '2026-10-06:KNOWN_INFEASIBLE');
  check('clip: exactly 30 minutes remain (now 09:30) -> feasible', day('09:30') === '2026-10-06:KNOWN_FEASIBLE');
  const lateNow = at('2026-10-06', '23:00');
  const r = run({ now: lateNow, horizonEndDate: '2026-10-07', availabilityByDate: avail({ '2026-10-06': w, '2026-10-07': known(win('2026-10-07', '09:00', '10:00')) }) });
  check('clip: future days are not clipped by now', states(r) === '2026-10-06:KNOWN_INFEASIBLE 2026-10-07:KNOWN_FEASIBLE');
}

// ============================================================
// Fragmentation: contiguous fit, never total free minutes
// ============================================================
{
  const one = (windows: { start: Date; end: Date }[], blockers: BlockedInterval[] = [], duration = 30) => facts(run({ durationMinutes: duration, availabilityByDate: avail({ '2026-10-06': known(...windows) }), blockers })).viableDays;
  const D = '2026-10-06';
  check('fragment: exactly-fitting span (30 in 30) -> feasible', one([win(D, '09:00', '09:30')]) === 1);
  check('fragment: one-minute-too-short span (29 for 30) -> infeasible', one([win(D, '09:00', '09:29')]) === 0);
  check('fragment: two windows 09:00-09:20 + 17:00-17:20 (40 free minutes total) -> infeasible for 30', one([win(D, '09:00', '09:20'), win(D, '17:00', '17:20')]) === 0);
  check('fragment: blocker 09:30-10:00 on 09:00-10:00 leaves a 30-minute span -> feasible', one([win(D, '09:00', '10:00')], [blk(D, '09:30', '10:00')]) === 1);
  check('fragment: blocker 09:20-09:40 splits 09:00-10:00 into 20 + 20 -> infeasible', one([win(D, '09:00', '10:00')], [blk(D, '09:20', '09:40')]) === 0);
  check('fragment: overlapping blockers are merged (no double subtraction): 09:10-09:20 + 09:15-09:25 leave 09:25-10:00 = 35 -> feasible', one([win(D, '09:00', '10:00')], [blk(D, '09:10', '09:20'), blk(D, '09:15', '09:25')]) === 1);
  check('fragment: adjacent blockers behave as one stretch: 09:00-09:30 + 09:30-09:50 leave 09:50-10:00 -> infeasible', one([win(D, '09:00', '10:00')], [blk(D, '09:00', '09:30'), blk(D, '09:30', '09:50')]) === 0);
  check('fragment: multiple blockers splitting a window: 09:00-12:00 with blockers 09:30-10:00 and 11:00-11:30 leaves 60,60,30 -> feasible for 60', one([win(D, '09:00', '12:00')], [blk(D, '09:30', '10:00'), blk(D, '11:00', '11:30')], 60) === 1);
  check('fragment: same window, duration 61 -> infeasible', one([win(D, '09:00', '12:00')], [blk(D, '09:30', '10:00'), blk(D, '11:00', '11:30')], 61) === 0);
  check('fragment: touching availability windows form one contiguous span (09:00-09:20 + 09:20-09:50 fit 45)', one([win(D, '09:00', '09:20'), win(D, '09:20', '09:50')], [], 45) === 1);
  check('fragment: overlapping/duplicate/unsorted availability windows are merged, not double-counted', one([win(D, '09:30', '09:50'), win(D, '09:00', '09:40'), win(D, '09:00', '09:40')], [], 45) === 1 && one([win(D, '09:00', '09:40'), win(D, '09:00', '09:40')], [], 45) === 0);
}

// ============================================================
// Boundaries (half-open edges)
// ============================================================
{
  const D = '2026-10-06';
  const base = (blockers: BlockedInterval[], duration = 30, end = '10:00') => facts(run({ durationMinutes: duration, availabilityByDate: avail({ [D]: known(win(D, '09:00', end)) }), blockers })).viableDays;
  check('boundary: blocker ending exactly at availability start has no effect', base([blk(D, '08:00', '09:00')]) === 1);
  check('boundary: blocker starting exactly at availability end has no effect', base([blk(D, '10:00', '11:00')]) === 1);
  check('boundary: blocker exactly consuming the window -> infeasible', base([blk(D, '09:00', '10:00')]) === 0);
  check('boundary: duration exactly equal to the remaining span -> feasible', base([blk(D, '09:00', '09:30')]) === 1);
  check('boundary: blocker entirely outside the supplied availability does not matter', base([blk(D, '06:00', '07:00'), blk(D, '13:00', '14:00')]) === 1);
  check('boundary: blocker overhanging the window start is clipped (08:00-09:40 leaves 09:40-10:00 = 20 -> infeasible)', base([blk(D, '08:00', '09:40')]) === 0);
  check('boundary: a zero-length blocker is ignored', base([blk(D, '09:30', '09:30')]) === 1);
}

// ============================================================
// Horizon semantics
// ============================================================
{
  const r1 = run({ availabilityByDate: avail({ '2026-10-06': fit60('2026-10-06'), '2026-10-07': fit60('2026-10-07') }) });
  check('horizon: single-day horizon evaluates exactly one day and ignores out-of-horizon entries', facts(r1).evaluatedDays === 1 && facts(r1).viableDays === 1 && facts(r1).horizonStartDate === '2026-10-06' && facts(r1).horizonEndDate === '2026-10-06');
  const r2 = run({ horizonEndDate: '2026-10-09', availabilityByDate: avail(Object.fromEntries(['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'].map((d) => [d, fit60(d)]))) });
  check('horizon: multi-day horizon end is INCLUSIVE and no further period is inferred (10-10 is feasible but not counted)', facts(r2).evaluatedDays === 4 && facts(r2).viableDays === 4 && states(r2).endsWith('2026-10-09:KNOWN_FEASIBLE'));
  const r3 = run({ planningDate: '2026-10-26', horizonEndDate: '2026-11-02', availabilityByDate: avail({ '2026-10-31': fit60('2026-10-31'), '2026-11-01': fit60('2026-11-01') }) });
  check('horizon: month boundary handled by civil-date stepping (8 days)', facts(r3).evaluatedDays === 8 && facts(r3).viableDays === 2 && facts(r3).unknownDays === 6);
  check('horizon: reversed horizon is a typed validation failure (never silently swapped)', (run({ planningDate: '2026-10-08', horizonEndDate: '2026-10-06' }) as any).code === 'INVALID_HORIZON');
  check('horizon: an invalid civil date is a typed failure', (run({ planningDate: '2026-02-30' }) as any).code === 'INVALID_DATE' && (run({ horizonEndDate: 'tomorrow' }) as any).code === 'INVALID_DATE');
  const long = run({ planningDate: '2026-01-01', horizonEndDate: '2027-12-31' });
  check('horizon: an absurdly long range fails closed instead of looping', (long as any).code === 'HORIZON_TOO_LONG' && MAX_PROJECTION_HORIZON_DAYS === 366);
  check('horizon: a range of exactly the maximum length (366 days) is accepted and one day more is rejected', run({ planningDate: '2026-01-01', horizonEndDate: '2027-01-01' }).status === 'OK' && (run({ planningDate: '2026-01-01', horizonEndDate: '2027-01-02' }) as any).code === 'HORIZON_TOO_LONG');
}

// ============================================================
// Typed validation failures
// ============================================================
{
  const code = (o: Partial<OpportunityProjectionInput>) => (run(o) as any).code;
  check('invalid duration: 0, negative, fractional, > 1440, NaN are typed failures', [0, -5, 1.5, 1441, NaN].every((m) => code({ durationMinutes: m }) === 'INVALID_DURATION'));
  check('valid duration bounds: 1 and 1440 are accepted', run({ durationMinutes: 1 }).status === 'OK' && run({ durationMinutes: 1440 }).status === 'OK');
  check('invalid timezone: unknown IANA name and blank are typed failures', code({ timezone: 'Mars/Olympus' }) === 'INVALID_TIMEZONE' && code({ timezone: '  ' }) === 'INVALID_TIMEZONE');
  check('invalid now: an invalid Date is a typed failure', code({ now: new Date(NaN) }) === 'INVALID_NOW');
  const bad = { start: iso('2026-10-06T05:00:00Z'), end: iso('2026-10-06T04:00:00Z') };
  check('malformed blocker (end before start) is a typed failure, not silently ignored', code({ blockers: [{ ...bad, source: 'FIXED_PLAN' }] }) === 'MALFORMED_INTERVAL');
  check('malformed availability window is a typed failure, not treated as unknown/empty', code({ availabilityByDate: avail({ '2026-10-06': known(bad) }) }) === 'MALFORMED_INTERVAL');
  check('a malformed window on an out-of-horizon date is ignored (never evaluated)', code({ availabilityByDate: avail({ '2026-12-25': known(bad) }) }) === undefined);
}

// ============================================================
// Timezone, process-timezone independence, DST
// ============================================================
{
  // Same instant, same labels, same windows; only the supplied timezone
  // differs. now = 2026-10-06T20:00Z is Oct 7 01:30 in Kolkata (so Oct 7
  // is "today" and its window is clipped) but Oct 6 13:00 in Los Angeles
  // (so Oct 7 is a future day and is not clipped).
  const NOW = iso('2026-10-06T20:00:00Z');
  const window = { start: iso('2026-10-06T19:00:00Z'), end: iso('2026-10-06T23:00:00Z') };
  const inputFor = (timezone: string): Partial<OpportunityProjectionInput> => ({ planningDate: '2026-10-07', horizonEndDate: '2026-10-07', durationMinutes: 210, timezone, now: NOW, availabilityByDate: avail({ '2026-10-07': known(window) }) });
  check('timezone: Asia/Kolkata treats 2026-10-07 as today and clips -> 180 minutes left -> infeasible for 210', states(run(inputFor(IST))) === '2026-10-07:KNOWN_INFEASIBLE');
  check('timezone: America/Los_Angeles treats 2026-10-07 as a future day (not clipped) -> 240 minutes -> feasible for 210', states(run(inputFor(LA))) === '2026-10-07:KNOWN_FEASIBLE');
}
{
  const input = { availabilityByDate: avail({ '2026-10-06': known(win('2026-10-06', '09:00', '09:45')), '2026-10-07': UNKNOWN }), horizonEndDate: '2026-10-07', now: at('2026-10-06', '09:10') };
  const original = process.env.TZ;
  const results: string[] = [];
  for (const tz of ['Pacific/Kiritimati', 'America/Los_Angeles', 'UTC']) {
    process.env.TZ = tz;
    results.push(JSON.stringify(run(input)));
  }
  if (original === undefined) delete process.env.TZ;
  else process.env.TZ = original;
  check('process timezone: identical output under three different process TZ settings', results[0] === results[1] && results[1] === results[2]);
}
{
  // DST: the engine works on ABSOLUTE instants, so real elapsed time is
  // what counts. Instants below are hand-derived UTC values, cross-checked
  // against the canonical local->UTC conversion for non-ambiguous times.
  // Spring forward, New York 2026-03-08: local 01:00 EST = 06:00Z and
  // local 04:00 EDT = 08:00Z -> only 120 real minutes in that wall span.
  const spring = { start: iso('2026-03-08T06:00:00Z'), end: iso('2026-03-08T08:00:00Z') };
  check('DST (canonical conversion cross-check, spring): 01:00 and 04:00 local on 2026-03-08 in New York are 06:00Z and 08:00Z', at('2026-03-08', '01:00', NY).getTime() === spring.start.getTime() && at('2026-03-08', '04:00', NY).getTime() === spring.end.getTime());
  const springInput = (duration: number) => run({ planningDate: '2026-03-08', horizonEndDate: '2026-03-08', durationMinutes: duration, timezone: NY, now: iso('2026-03-01T00:00:00Z'), availabilityByDate: avail({ '2026-03-08': known(spring) }) });
  check('DST spring-forward: a wall span with a skipped hour is 120 real minutes -> 120 fits, 121 does not', facts(springInput(120)).viableDays === 1 && facts(springInput(121)).viableDays === 0);
  // Fall back, New York 2026-11-01: local 00:30 EDT = 04:30Z, local 03:30 EST = 08:30Z -> 240 real minutes.
  const fall = { start: iso('2026-11-01T04:30:00Z'), end: iso('2026-11-01T08:30:00Z') };
  check('DST (canonical conversion cross-check, fall): 00:30 and 03:30 local on 2026-11-01 in New York are 04:30Z and 08:30Z', at('2026-11-01', '00:30', NY).getTime() === fall.start.getTime() && at('2026-11-01', '03:30', NY).getTime() === fall.end.getTime());
  const fallInput = (duration: number) => run({ planningDate: '2026-11-01', horizonEndDate: '2026-11-01', durationMinutes: duration, timezone: NY, now: iso('2026-10-20T00:00:00Z'), availabilityByDate: avail({ '2026-11-01': known(fall) }) });
  check('DST fall-back: a wall span with a repeated hour is 240 real minutes -> 240 fits, 241 does not', facts(fallInput(240)).viableDays === 1 && facts(fallInput(241)).viableDays === 0);
  // Today detection at a DST boundary: 2026-03-09T03:59Z is 23:59 EDT on Mar 8 (still "today" Mar 8).
  const lateInDstDay = run({ planningDate: '2026-03-08', horizonEndDate: '2026-03-09', durationMinutes: 30, timezone: NY, now: iso('2026-03-09T03:59:00Z'), availabilityByDate: avail({ '2026-03-08': known({ start: iso('2026-03-08T13:00:00Z'), end: iso('2026-03-08T14:00:00Z') }), '2026-03-09': known({ start: iso('2026-03-09T13:00:00Z'), end: iso('2026-03-09T14:00:00Z') }) }) });
  check('DST: today detection uses the local date at the boundary (Mar 8 23:59 EDT clips Mar 8 only)', states(lateInDstDay) === '2026-03-08:KNOWN_INFEASIBLE 2026-03-09:KNOWN_FEASIBLE');
  // Exact wall-time -> instant conversion of nonexistent/ambiguous local times is the caller/adapter's responsibility (O2); deliberately not asserted here.
}

// ============================================================
// Candidate-local limitation, deadline generalization, determinism, immutability
// ============================================================
{
  const window = known(win('2026-10-09', '17:00', '18:00'));
  const a = facts(run({ planningDate: '2026-10-09', horizonEndDate: '2026-10-09', durationMinutes: 60, availabilityByDate: avail({ '2026-10-09': window }) }));
  const b = facts(run({ planningDate: '2026-10-09', horizonEndDate: '2026-10-09', durationMinutes: 60, availabilityByDate: avail({ '2026-10-09': window }) }));
  check('overlap limitation: two candidates (60 min each) and one 60-minute future window are EACH reported viable on that day', a.viableDays === 1 && b.viableDays === 1);
  check('overlap limitation (documented): this is candidate-local feasibility, not shared capacity -- the engine never receives another candidate', projectOpportunityFacts.length === 1);
}
{
  const d = facts(run({ planningDate: '2026-10-06', horizonEndDate: '2026-10-08', durationMinutes: 90, availabilityByDate: avail({ '2026-10-06': known(win('2026-10-06', '09:00', '10:00')), '2026-10-07': known(win('2026-10-07', '09:00', '11:00')), '2026-10-08': fit60('2026-10-08') }) }));
  check('deadline horizon: arbitrary horizon end (e.g. a due date) behaves identically -- 90-minute task, only 10-07 fits', d.viableDays === 1 && d.evaluatedDays === 3 && d.coverage === 'COMPLETE');
}
{
  const input: OpportunityProjectionInput = {
    planningDate: '2026-10-06',
    horizonEndDate: '2026-10-08',
    durationMinutes: 45,
    timezone: IST,
    now: at('2026-10-06', '09:10'),
    availabilityByDate: avail({ '2026-10-06': known(win('2026-10-06', '09:00', '12:00'), win('2026-10-06', '14:00', '15:00')), '2026-10-07': known(win('2026-10-07', '09:00', '10:00')), '2026-10-08': UNKNOWN }),
    blockers: [blk('2026-10-06', '11:00', '11:30'), blk('2026-10-06', '09:20', '09:40'), blk('2026-10-07', '09:30', '09:40')],
  };
  const snapshot = () => JSON.stringify({ a: Array.from(input.availabilityByDate.entries()), b: input.blockers, n: input.now });
  const before = snapshot();
  const first = JSON.stringify(projectOpportunityFacts(input));
  const second = JSON.stringify(projectOpportunityFacts(input));
  const third = JSON.stringify(projectOpportunityFacts({ ...input }));
  check('determinism: same inputs -> deep-equal output on repeated execution', first === second && second === third);
  check('immutability: inputs are unchanged after projection (unsorted blockers/windows are copied before sorting)', snapshot() === before);
  const frozenWindows = Object.freeze([Object.freeze(win('2026-10-06', '09:00', '10:00'))]);
  const frozenBlockers = Object.freeze([Object.freeze(blk('2026-10-06', '09:20', '09:40')), Object.freeze(blk('2026-10-06', '09:10', '09:25'))]);
  let threw = false;
  try {
    projectOpportunityFacts({ ...input, planningDate: '2026-10-06', horizonEndDate: '2026-10-06', now: PAST_NOW, availabilityByDate: avail({ '2026-10-06': { kind: 'KNOWN', windows: frozenWindows } }), blockers: frozenBlockers });
  } catch {
    threw = true;
  }
  check('immutability: frozen (read-only) inputs are accepted without any mutation attempt', !threw);
}

// ============================================================
// ELAPSED DAYS (correction): a day earlier than the local date of `now`
// is KNOWN_INFEASIBLE unconditionally -- never UNKNOWN, never feasible.
// now = 2026-10-10T12:00Z = 17:30 IST, so the local date is 2026-10-10.
// ============================================================
{
  const NOW = iso('2026-10-10T12:00:00Z');
  const one = (date: string, availability?: DayAvailabilityInput, blockers: BlockedInterval[] = []) =>
    run({ now: NOW, planningDate: date, horizonEndDate: date, availabilityByDate: availability ? avail({ [date]: availability }) : new Map(), blockers });
  const span = (a: string, b: string) => ({ start: iso(a), end: iso(b) });

  const noAvail = one('2026-10-08');
  check('past/no availability: KNOWN_INFEASIBLE (not UNKNOWN)', states(noAvail) === '2026-10-08:KNOWN_INFEASIBLE');
  check('past/no availability: unknownDays does NOT increase; evaluatedDays still counts the day', facts(noAvail).unknownDays === 0 && facts(noAvail).viableDays === 0 && facts(noAvail).evaluatedDays === 1 && facts(noAvail).coverage === 'COMPLETE');
  check('past/explicit UNKNOWN availability: also KNOWN_INFEASIBLE', states(one('2026-10-08', UNKNOWN)) === '2026-10-08:KNOWN_INFEASIBLE');
  check('past/normal elapsed window: KNOWN_INFEASIBLE', states(one('2026-10-08', known(span('2026-10-08T09:00:00Z', '2026-10-08T10:00:00Z')))) === '2026-10-08:KNOWN_INFEASIBLE');
  const futureLooking = one('2026-10-08', known(span('2026-10-11T09:00:00Z', '2026-10-11T10:00:00Z')));
  check('past/future-looking window (date label 10-08, instants on 10-11): KNOWN_INFEASIBLE -- an inconsistent payload cannot resurrect a past day', states(futureLooking) === '2026-10-08:KNOWN_INFEASIBLE' && facts(futureLooking).viableDays === 0);
  check('past/straddling window (instants straddle now): KNOWN_INFEASIBLE', states(one('2026-10-08', known(span('2026-10-10T11:00:00Z', '2026-10-10T13:00:00Z')))) === '2026-10-08:KNOWN_INFEASIBLE');
  check('past: supplied windows/blockers cannot change an elapsed day (with and without a blocker -> same result)', states(one('2026-10-09', known(span('2026-10-12T03:00:00Z', '2026-10-12T05:00:00Z')), [blk('2026-10-12', '09:00', '10:00')])) === '2026-10-09:KNOWN_INFEASIBLE');

  const allPast = run({ now: NOW, planningDate: '2026-10-05', horizonEndDate: '2026-10-08', availabilityByDate: avail({ '2026-10-06': fit60('2026-10-06') }) });
  check('all-past horizon: evaluatedDays = 4, viableDays 0, unknownDays 0, coverage COMPLETE (zero remaining opportunities)', facts(allPast).evaluatedDays === 4 && facts(allPast).viableDays === 0 && facts(allPast).unknownDays === 0 && facts(allPast).coverage === 'COMPLETE');

  // 3-day example: past, today unknown, tomorrow feasible
  const example = run({ now: NOW, planningDate: '2026-10-09', horizonEndDate: '2026-10-11', availabilityByDate: avail({ '2026-10-10': UNKNOWN, '2026-10-11': fit60('2026-10-11') }) });
  check('aggregation example: past + today unknown + tomorrow feasible -> evaluated 3, viable 1, unknown 1, known infeasible 1, PARTIAL',
    states(example) === '2026-10-09:KNOWN_INFEASIBLE 2026-10-10:UNKNOWN 2026-10-11:KNOWN_FEASIBLE' &&
      facts(example).evaluatedDays === 3 && facts(example).viableDays === 1 && facts(example).unknownDays === 1 && facts(example).evaluatedDays - facts(example).viableDays - facts(example).unknownDays === 1 && facts(example).coverage === 'PARTIAL');

  // mixed horizon: each rule applied independently
  const todayWindow = known(win('2026-10-10', '17:00', '19:00')); // 17:00-19:00 IST; now is 17:30 -> 90 minutes remain
  const mixed = run({ now: NOW, planningDate: '2026-10-09', horizonEndDate: '2026-10-11', availabilityByDate: avail({ '2026-10-09': fit60('2026-10-09'), '2026-10-10': todayWindow, '2026-10-11': fit60('2026-10-11') }) });
  check('mixed horizon: past (even with a fitting window) infeasible, today clipped-and-feasible, future feasible', states(mixed) === '2026-10-09:KNOWN_INFEASIBLE 2026-10-10:KNOWN_FEASIBLE 2026-10-11:KNOWN_FEASIBLE' && facts(mixed).viableDays === 2);
  const mixedTight = run({ now: NOW, durationMinutes: 100, planningDate: '2026-10-09', horizonEndDate: '2026-10-11', availabilityByDate: avail({ '2026-10-09': known(win('2026-10-09', '09:00', '12:00')), '2026-10-10': todayWindow, '2026-10-11': known(win('2026-10-11', '09:00', '12:00')) }) });
  check('mixed horizon: today is clipped (90 left < 100) while the future day is not (180 >= 100)', states(mixedTight) === '2026-10-09:KNOWN_INFEASIBLE 2026-10-10:KNOWN_INFEASIBLE 2026-10-11:KNOWN_FEASIBLE');

  // coverage: elapsed days never create uncertainty by themselves
  const pastPlusKnown = run({ now: NOW, planningDate: '2026-10-08', horizonEndDate: '2026-10-11', availabilityByDate: avail({ '2026-10-10': todayWindow, '2026-10-11': fit60('2026-10-11') }) });
  check('coverage: elapsed days alongside fully known later days stay COMPLETE', facts(pastPlusKnown).coverage === 'COMPLETE' && facts(pastPlusKnown).unknownDays === 0);
  const pastPlusUnknown = run({ now: NOW, planningDate: '2026-10-08', horizonEndDate: '2026-10-09', availabilityByDate: new Map() });
  check('coverage: elapsed days with no later day in the horizon never produce UNKNOWN/PARTIAL', facts(pastPlusUnknown).coverage === 'COMPLETE' && facts(pastPlusUnknown).unknownDays === 0);
  const lower = run({ now: NOW, planningDate: '2026-10-08', horizonEndDate: '2026-10-12', availabilityByDate: avail({ '2026-10-11': fit60('2026-10-11') }) }); // 08,09 past; 10 unknown (no entry); 11 feasible; 12 unknown
  check('lower bound unchanged by elapsed days: viable 1, unknown 2 -> true viable within [1, 3]; the two elapsed days add nothing to either bound', facts(lower).viableDays === 1 && facts(lower).unknownDays === 2 && facts(lower).evaluatedDays === 5 && facts(lower).coverage === 'PARTIAL');
}

// ---- local-date boundary: classification uses localDate(now, supplied timezone), never the UTC date
{
  // Positive offset. now = 2026-10-09T20:00Z: UTC date is 10-09, but it is already 2026-10-10 01:30 in Kolkata.
  const NOW = iso('2026-10-09T20:00:00Z');
  const r = run({
    now: NOW,
    timezone: IST,
    planningDate: '2026-10-09',
    horizonEndDate: '2026-10-10',
    availabilityByDate: avail({ '2026-10-09': known({ start: iso('2026-10-09T21:00:00Z'), end: iso('2026-10-09T22:00:00Z') }), '2026-10-10': known(win('2026-10-10', '09:00', '10:00', IST)) }),
  });
  check('positive offset (Kolkata): 10-09 is already elapsed locally although it is still the current UTC date -> KNOWN_INFEASIBLE; 10-10 is local today -> feasible', states(r) === '2026-10-09:KNOWN_INFEASIBLE 2026-10-10:KNOWN_FEASIBLE');
  const sameInstantsUtc = run({
    now: NOW,
    timezone: 'UTC',
    planningDate: '2026-10-09',
    horizonEndDate: '2026-10-10',
    availabilityByDate: avail({ '2026-10-09': known({ start: iso('2026-10-09T21:00:00Z'), end: iso('2026-10-09T22:00:00Z') }), '2026-10-10': known(win('2026-10-10', '09:00', '10:00', IST)) }),
  });
  check('positive offset (control): the same instants under timezone UTC treat 10-09 as today (clipped, still feasible) -- so classification really depends on the supplied zone', states(sameInstantsUtc) === '2026-10-09:KNOWN_FEASIBLE 2026-10-10:KNOWN_FEASIBLE');
  // Negative offset. now = 2026-10-10T03:00Z: UTC date is 10-10, but it is still 2026-10-09 20:00 in Los Angeles.
  const NOW_LA = iso('2026-10-10T03:00:00Z');
  const la = run({
    now: NOW_LA,
    timezone: LA,
    planningDate: '2026-10-09',
    horizonEndDate: '2026-10-10',
    availabilityByDate: avail({ '2026-10-09': known(win('2026-10-09', '21:00', '23:00', LA)), '2026-10-10': known(win('2026-10-10', '09:00', '10:00', LA)) }),
  });
  check('negative offset (Los Angeles): 10-09 is still local today although the UTC date is already 10-10 -> clipped, remaining evening window feasible; 10-10 is a future day', states(la) === '2026-10-09:KNOWN_FEASIBLE 2026-10-10:KNOWN_FEASIBLE');
  const laElapsed = run({
    now: NOW_LA,
    timezone: LA,
    planningDate: '2026-10-09',
    horizonEndDate: '2026-10-09',
    availabilityByDate: avail({ '2026-10-09': known(win('2026-10-09', '09:00', '10:00', LA)) }),
  });
  check('negative offset: today in Los Angeles with only a morning window (already elapsed) -> infeasible (clipping, not the elapsed-day rule)', states(laElapsed) === '2026-10-09:KNOWN_INFEASIBLE');
}

// ============================================================
// TIMEZONE VALIDATION (correction): O1 accepts exactly what the
// canonical date helpers accept -- not the form-input validator.
// ============================================================
{
  const probe = (timezone: string) => run({ timezone, availabilityByDate: avail({ '2026-10-06': known({ start: iso('2026-10-06T09:00:00Z'), end: iso('2026-10-06T10:00:00Z') }) }) });
  check('timezone UTC is accepted and evaluated', probe('UTC').status === 'OK' && facts(probe('UTC')).viableDays === 1);
  check('timezone Etc/UTC is accepted and evaluated', probe('Etc/UTC').status === 'OK' && facts(probe('Etc/UTC')).viableDays === 1);
  check('named zones Asia/Kolkata, America/New_York, Europe/London, America/Los_Angeles are accepted', [IST, NY, 'Europe/London', LA].every((tz) => probe(tz).status === 'OK'));
  check('a genuinely invalid zone is a typed failure: Not/A_Real_Timezone', (probe('Not/A_Real_Timezone') as any).code === 'INVALID_TIMEZONE');
  check('blank and whitespace-only zones are typed failures', (probe('') as any).code === 'INVALID_TIMEZONE' && (probe('   ') as any).code === 'INVALID_TIMEZONE');
  const identifiers = ['UTC', 'Etc/UTC', 'GMT', 'Asia/Kolkata', 'America/New_York', 'Europe/London', 'Not/A_Real_Timezone', 'Mars/Olympus', '', 'India'];
  const canonicalAccepts = (tz: string) => {
    try {
      getDatePartsInTimezone(tz, iso('2026-10-06T00:00:00Z'));
      return true;
    } catch {
      return false;
    }
  };
  check('consistency: O1 accepts a zone if and only if the canonical getDatePartsInTimezone can resolve it (no stricter private dialect)', identifiers.every((tz) => (probe(tz).status === 'OK') === canonicalAccepts(tz)));
}
{
  // Process-timezone independence after the correction, including a UTC input and the elapsed-day rule.
  const input = (timezone: string) => ({
    now: iso('2026-10-10T12:00:00Z'),
    timezone,
    planningDate: '2026-10-08',
    horizonEndDate: '2026-10-11',
    availabilityByDate: avail({ '2026-10-08': known({ start: iso('2026-10-11T03:00:00Z'), end: iso('2026-10-11T04:00:00Z') }), '2026-10-10': known(win('2026-10-10', '17:00', '19:00')), '2026-10-11': UNKNOWN }),
  });
  const original = process.env.TZ;
  const outputs: Record<string, string[]> = { UTC: [], [IST]: [], [NY]: [] };
  for (const processTz of ['UTC', NY, IST, 'Pacific/Kiritimati']) {
    process.env.TZ = processTz;
    for (const supplied of Object.keys(outputs)) outputs[supplied].push(JSON.stringify(projectOpportunityFacts({ durationMinutes: 30, blockers: [], ...input(supplied) })));
  }
  if (original === undefined) delete process.env.TZ;
  else process.env.TZ = original;
  check('process timezone: for each supplied zone (UTC, Kolkata, New York), output is identical under process TZ UTC / New York / Kolkata / Kiritimati', Object.values(outputs).every((list) => list.every((o) => o === list[0])));
}

if (!allPassed) {
  console.error('SOME OPPORTUNITY PROJECTION CHECKS FAILED');
  process.exit(1);
}
console.log('ALL OPPORTUNITY PROJECTION CHECKS PASSED');
