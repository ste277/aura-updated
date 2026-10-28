/**
 * O5 P0b -- opportunity FACT QUALITY (pure, no DB).
 *
 * The opportunity facts now report the horizon's FIRST day apart from the
 * days after it (`startDateState`, `afterStartEvaluatedDays`,
 * `afterStartViableDays`, `afterStartUnknownDays`), so a total such as
 * `viableDays == 1` can be told apart from "the first day is the viable
 * one". This suite proves, with the real O1 engine, the real O2 adapter and
 * the real O4 composition (only the two database loaders are fakes):
 *
 *   - the original six O1 facts are exactly what they were
 *   - the new facts partition the totals exactly, for EVERY combination of
 *     day states over every horizon length 1..6 (exhaustive sweep)
 *   - each state/future combination, today clipping, the exact-duration
 *     boundary, unconfigured, configured-empty, DST (gap, overlap and a
 *     30-minute transition), blockers, month/year/leap boundaries,
 *     timezones, multi-window days, one-day horizons and duration basis
 *   - facts only: no policy interpretation of any count
 */
import { projectOpportunityFacts, type DayAvailabilityInput, type OpportunityFacts, type OpportunityProjectionResult } from '../apps/web/lib/opportunityProjection';
import { adaptOpportunityRangeInputs } from '../apps/web/lib/opportunityRangeAdapter';
import { computeOpportunityDecisionFacts } from '../apps/web/lib/opportunityDecisionFacts';
import { addDaysToDateStr, localDateTimeToUTC } from '../apps/web/lib/timezone';
import type { AvailabilityConfiguration } from '../apps/web/lib/availabilityContext';
import type { PlanBlockerCandidate } from '../apps/web/lib/planBlockerLifecycle';
import type { OpportunityRangeDeps } from '../apps/web/lib/opportunityRangeAdapter';
import type { DecisionFacts } from '../apps/web/lib/decisionFacts';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const iso = (s: string) => new Date(s);
const utc = (date: string, hhmm: string) => iso(`${date}T${hhmm}:00Z`);
const win = (date: string, from: string, to: string) => ({ start: utc(date, from), end: utc(date, to) });
const FEASIBLE = (date: string): DayAvailabilityInput => ({ kind: 'KNOWN', windows: [win(date, '09:00', '17:00')] });
const INFEASIBLE: DayAvailabilityInput = { kind: 'KNOWN', windows: [] };
const UNKNOWN: DayAvailabilityInput = { kind: 'UNKNOWN' };

function run(planningDate: string, horizonEndDate: string, byDate: Record<string, DayAvailabilityInput | 'F'>, over: { now?: Date; durationMinutes?: number; blockers?: Array<{ start: Date; end: Date }>; timezone?: string } = {}): OpportunityFacts {
  const map = new Map<string, DayAvailabilityInput>();
  for (const [date, v] of Object.entries(byDate)) map.set(date, v === 'F' ? FEASIBLE(date) : v);
  const result: OpportunityProjectionResult = projectOpportunityFacts({
    planningDate,
    horizonEndDate,
    durationMinutes: over.durationMinutes ?? 30,
    timezone: over.timezone ?? 'UTC',
    now: over.now ?? utc(planningDate, '00:00'),
    availabilityByDate: map,
    blockers: (over.blockers ?? []).map((b) => ({ ...b, source: 'FIXED_PLAN' as const })),
  });
  if (result.status !== 'OK') throw new Error(`projection failed: ${result.code}`);
  return result.facts;
}
const partition = (f: OpportunityFacts) =>
  f.evaluatedDays === 1 + f.afterStartEvaluatedDays &&
  f.viableDays === (f.startDateState === 'KNOWN_FEASIBLE' ? 1 : 0) + f.afterStartViableDays &&
  f.unknownDays === (f.startDateState === 'UNKNOWN' ? 1 : 0) + f.afterStartUnknownDays;

(async () => {
  // ============================================================
  // EXHAUSTIVE: every combination of day states, every horizon length 1..6
  // ============================================================
  {
    const STATES: Array<'F' | 'I' | 'U'> = ['F', 'I', 'U'];
    let combos = 0;
    let bad = 0;
    let oldBad = 0;
    for (let length = 1; length <= 6; length++) {
      const total = Math.pow(3, length);
      for (let n = 0; n < total; n++) {
        const states: Array<'F' | 'I' | 'U'> = [];
        let x = n;
        for (let i = 0; i < length; i++) {
          states.push(STATES[x % 3]);
          x = Math.floor(x / 3);
        }
        const start = '2026-10-12'; // a Monday, in the future relative to now => no clipping
        const byDate: Record<string, DayAvailabilityInput> = {};
        const dates: string[] = [];
        states.forEach((s, i) => {
          const d = addDaysToDateStr(start, i);
          dates.push(d);
          byDate[d] = s === 'F' ? FEASIBLE(d) : s === 'I' ? INFEASIBLE : UNKNOWN;
        });
        const f = run(start, dates[dates.length - 1], byDate, { now: utc('2026-10-05', '00:00') });
        combos += 1;
        // Independent oracle for the NEW facts (computed from the injected states, not from O1's output).
        const exp = {
          startDateState: states[0] === 'F' ? 'KNOWN_FEASIBLE' : states[0] === 'I' ? 'KNOWN_INFEASIBLE' : 'UNKNOWN',
          afterStartEvaluatedDays: length - 1,
          afterStartViableDays: states.slice(1).filter((s) => s === 'F').length,
          afterStartUnknownDays: states.slice(1).filter((s) => s === 'U').length,
        };
        if (f.startDateState !== exp.startDateState || f.afterStartEvaluatedDays !== exp.afterStartEvaluatedDays || f.afterStartViableDays !== exp.afterStartViableDays || f.afterStartUnknownDays !== exp.afterStartUnknownDays || !partition(f)) bad += 1;
        // Independent oracle for the ORIGINAL facts: they must be exactly what they always were.
        const viable = states.filter((s) => s === 'F').length;
        const unknown = states.filter((s) => s === 'U').length;
        const coverage = unknown === 0 ? 'COMPLETE' : unknown === length ? 'UNKNOWN' : 'PARTIAL';
        if (f.evaluatedDays !== length || f.viableDays !== viable || f.unknownDays !== unknown || f.coverage !== coverage || f.horizonStartDate !== start || f.horizonEndDate !== dates[dates.length - 1]) oldBad += 1;
      }
    }
    check(`exhaustive sweep over ${combos} day-state combinations (horizon lengths 1..6): the new facts equal an independent oracle and partition the totals exactly`, bad === 0 && combos === 1092);
    check('...and the ORIGINAL six facts (evaluated, viable, unknown, coverage, horizon dates) equal an independent oracle in every combination: P0b is purely additive', oldBad === 0);
  }

  // ============================================================
  // The week fixture: Mon..Fri 09-17 known, Sat/Sun known-empty
  // ============================================================
  const WEEK: Record<string, DayAvailabilityInput | 'F'> = { '2026-10-05': 'F', '2026-10-06': 'F', '2026-10-07': 'F', '2026-10-08': 'F', '2026-10-09': 'F', '2026-10-10': INFEASIBLE, '2026-10-11': INFEASIBLE };
  {
    const f = run('2026-10-05', '2026-10-11', WEEK);
    check('Monday..Sunday horizon: six days after the first; first day KNOWN_FEASIBLE; 4 later viable (Tue-Fri); totals 7 evaluated / 5 viable', f.startDateState === 'KNOWN_FEASIBLE' && f.afterStartEvaluatedDays === 6 && f.afterStartViableDays === 4 && f.afterStartUnknownDays === 0 && f.evaluatedDays === 7 && f.viableDays === 5);
  }
  {
    const f = run('2026-10-07', '2026-10-11', WEEK, { now: utc('2026-10-07', '08:00') });
    check('mid-week start (Wednesday): first day feasible, 4 later days (Thu, Fri, Sat, Sun) of which 2 viable', f.startDateState === 'KNOWN_FEASIBLE' && f.afterStartEvaluatedDays === 4 && f.afterStartViableDays === 2 && partition(f));
  }
  {
    // viable first day, nothing viable or unknown after
    const f = run('2026-10-09', '2026-10-11', WEEK, { now: utc('2026-10-09', '08:00') });
    check('first day VIABLE, no later viable or unknown day: KNOWN_FEASIBLE, after 2 evaluated / 0 viable / 0 unknown (a fact, not a label)', f.startDateState === 'KNOWN_FEASIBLE' && f.afterStartEvaluatedDays === 2 && f.afterStartViableDays === 0 && f.afterStartUnknownDays === 0 && f.viableDays === 1);
  }
  {
    // first day viable, later viable
    const f = run('2026-10-05', '2026-10-07', WEEK, { now: utc('2026-10-05', '08:00') });
    check('first day VIABLE and later days viable: KNOWN_FEASIBLE, after 2 viable', f.startDateState === 'KNOWN_FEASIBLE' && f.afterStartViableDays === 2 && f.viableDays === 3);
  }
  {
    // the case that motivates the contract: viableDays == 1 but the first day is NOT the viable one
    const f = run('2026-10-10', '2026-10-12', { '2026-10-10': INFEASIBLE, '2026-10-11': INFEASIBLE, '2026-10-12': 'F' }, { now: utc('2026-10-10', '08:00') });
    check('first day INFEASIBLE, a later day viable: viableDays is 1 yet startDateState is KNOWN_INFEASIBLE -- a total of one does NOT mean the first day', f.viableDays === 1 && f.startDateState === 'KNOWN_INFEASIBLE' && f.afterStartViableDays === 1);
    const g = run('2026-10-09', '2026-10-11', { '2026-10-09': 'F', '2026-10-10': INFEASIBLE, '2026-10-11': INFEASIBLE }, { now: utc('2026-10-09', '08:00') });
    check('...and the same total of one with the viable day FIRST is distinguishable', g.viableDays === 1 && g.startDateState === 'KNOWN_FEASIBLE' && g.afterStartViableDays === 0 && f.afterStartViableDays !== g.afterStartViableDays);
  }
  {
    const f = run('2026-10-07', '2026-10-09', { '2026-10-07': 'F', '2026-10-08': UNKNOWN, '2026-10-09': 'F' }, { now: utc('2026-10-07', '08:00') });
    check('first day viable, a later day UNKNOWN: after 2 evaluated / 1 viable / 1 unknown; coverage PARTIAL (unchanged semantics)', f.startDateState === 'KNOWN_FEASIBLE' && f.afterStartUnknownDays === 1 && f.afterStartViableDays === 1 && f.coverage === 'PARTIAL');
    const g = run('2026-10-07', '2026-10-09', { '2026-10-07': INFEASIBLE, '2026-10-08': UNKNOWN, '2026-10-09': INFEASIBLE }, { now: utc('2026-10-07', '08:00') });
    check('first day INFEASIBLE, a later day UNKNOWN: reported separately (infeasible start, 1 unknown later, 0 viable later)', g.startDateState === 'KNOWN_INFEASIBLE' && g.afterStartUnknownDays === 1 && g.afterStartViableDays === 0);
    const h = run('2026-10-07', '2026-10-09', { '2026-10-07': UNKNOWN, '2026-10-08': 'F', '2026-10-09': 'F' }, { now: utc('2026-10-07', '08:00') });
    check('first day UNKNOWN, later days viable: UNKNOWN is independent of the later state', h.startDateState === 'UNKNOWN' && h.afterStartViableDays === 2 && h.afterStartUnknownDays === 0 && h.unknownDays === 1);
    check('UNKNOWN later days are never turned into zero opportunity: an all-unknown later span has 0 viable BUT its unknown count says why', run('2026-10-07', '2026-10-09', { '2026-10-07': 'F', '2026-10-08': UNKNOWN, '2026-10-09': UNKNOWN }, { now: utc('2026-10-07', '08:00') }).afterStartUnknownDays === 2);
  }

  // ============================================================
  // One-day horizons and empty later sets are KNOWN empty sets
  // ============================================================
  for (const [label, avail, state] of [['feasible', 'F', 'KNOWN_FEASIBLE'], ['infeasible', INFEASIBLE, 'KNOWN_INFEASIBLE'], ['unknown', UNKNOWN, 'UNKNOWN']] as const) {
    const f = run('2026-10-11', '2026-10-11', { '2026-10-11': avail }, { now: utc('2026-10-11', '00:00') });
    check(`one-day horizon (${label}): state ${state}; later set is a KNOWN empty set -- 0 evaluated, 0 viable, 0 unknown (never "unknown")`, f.startDateState === state && f.afterStartEvaluatedDays === 0 && f.afterStartViableDays === 0 && f.afterStartUnknownDays === 0 && partition(f));
  }
  {
    const f = run('2026-10-11', '2026-10-11', { '2026-10-11': INFEASIBLE });
    check('Sunday as the period end (a weekly horizon 10-11..10-11): later counts are all zero, nothing is inferred', f.afterStartEvaluatedDays === 0 && f.afterStartViableDays === 0 && f.afterStartUnknownDays === 0);
  }

  // ============================================================
  // Today clipping and the exact-duration boundary (O1's authority)
  // ============================================================
  {
    // availability existed earlier today (09:00-10:00) but none remains after now = 12:00
    const f = run('2026-10-07', '2026-10-08', { '2026-10-07': { kind: 'KNOWN', windows: [win('2026-10-07', '09:00', '10:00')] }, '2026-10-08': 'F' }, { now: utc('2026-10-07', '12:00') });
    check('today: availability that existed only EARLIER today leaves the first day KNOWN_INFEASIBLE (it reflects the time remaining, not the original day)', f.startDateState === 'KNOWN_INFEASIBLE' && f.afterStartViableDays === 1 && f.viableDays === 1);
    const exact = run('2026-10-07', '2026-10-07', { '2026-10-07': { kind: 'KNOWN', windows: [win('2026-10-07', '09:00', '10:00')] } }, { now: utc('2026-10-07', '09:30') });
    const short = run('2026-10-07', '2026-10-07', { '2026-10-07': { kind: 'KNOWN', windows: [win('2026-10-07', '09:00', '10:00')] } }, { now: utc('2026-10-07', '09:31') });
    check('remaining interval EXACTLY the duration (09:30..10:00, 30 min) is KNOWN_FEASIBLE; one minute short (09:31) is KNOWN_INFEASIBLE', exact.startDateState === 'KNOWN_FEASIBLE' && short.startDateState === 'KNOWN_INFEASIBLE');
    const later = run('2026-10-07', '2026-10-08', { '2026-10-07': 'F', '2026-10-08': { kind: 'KNOWN', windows: [win('2026-10-08', '09:00', '09:30')] } }, { now: utc('2026-10-07', '16:45') });
    check('later days are NOT clipped by now (a later 30-minute day stays feasible at exactly 30 minutes) while the clipped first day is infeasible', later.startDateState === 'KNOWN_INFEASIBLE' && later.afterStartViableDays === 1);
  }
  {
    // planning date in the past: O1's rule (past civil dates are KNOWN_INFEASIBLE, never UNKNOWN)
    const f = run('2026-10-05', '2026-10-07', { '2026-10-05': UNKNOWN, '2026-10-06': 'F', '2026-10-07': 'F' }, { now: utc('2026-10-07', '08:00') });
    check('a historical first day is KNOWN_INFEASIBLE regardless of what was supplied (never invented as UNKNOWN); the elapsed later day too; today remains', f.startDateState === 'KNOWN_INFEASIBLE' && f.afterStartViableDays === 1 && f.afterStartUnknownDays === 0 && f.unknownDays === 0);
  }

  // ============================================================
  // Unconfigured / configured-empty, through the real O2 adapter
  // ============================================================
  const adapt = (configuration: AvailabilityConfiguration, startDate: string, endDate: string, timezone: string, now: Date, plans: PlanBlockerCandidate[] = []) => {
    const result = adaptOpportunityRangeInputs({ startDate, endDate, timezone, now }, configuration, plans);
    if (result.status !== 'OK') throw new Error(result.code);
    const projected = projectOpportunityFacts({ planningDate: startDate, horizonEndDate: endDate, durationMinutes: 30, timezone, now, availabilityByDate: result.inputs.availabilityByDate, blockers: result.inputs.blockers });
    if (projected.status !== 'OK') throw new Error(projected.code);
    return projected.facts;
  };
  const workWeek = (extra: AvailabilityConfiguration['periods'] = []): AvailabilityConfiguration => ({ configured: true, periods: [...([1, 2, 3, 4, 5] as const).map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })), ...extra] });
  {
    const f = adapt({ configured: false, periods: [] }, '2026-10-07', '2026-10-11', 'UTC', utc('2026-10-07', '08:00'));
    check('UNCONFIGURED: the first day UNKNOWN and every later day UNKNOWN (no Constructor fallback): after 4 evaluated / 0 viable / 4 unknown; coverage UNKNOWN', f.startDateState === 'UNKNOWN' && f.afterStartEvaluatedDays === 4 && f.afterStartViableDays === 0 && f.afterStartUnknownDays === 4 && f.coverage === 'UNKNOWN');
    const e = adapt({ configured: true, periods: [] }, '2026-10-07', '2026-10-11', 'UTC', utc('2026-10-07', '08:00'));
    check('CONFIGURED EMPTY: known infeasible, NOT unknown: first day KNOWN_INFEASIBLE, after 4 evaluated / 0 viable / 0 unknown; coverage COMPLETE', e.startDateState === 'KNOWN_INFEASIBLE' && e.afterStartEvaluatedDays === 4 && e.afterStartUnknownDays === 0 && e.coverage === 'COMPLETE');
  }

  // ============================================================
  // DST: O2's uncertainty propagates unchanged (gap, overlap, 30-minute)
  // ============================================================
  {
    // New York fall back Sunday 2026-11-01: 01:30 happens twice (overlap). A Sunday window starting 01:30 is not exactly convertible.
    const ny = workWeek([{ weekday: 0, startTime: '01:30', endTime: '03:00' }]);
    const asLaterDay = adapt(ny, '2026-10-26', '2026-11-01', 'America/New_York', localDateTimeToUTC('2026-10-26', '08:00', 'America/New_York'));
    check('DST overlap (NY 2026-11-01) as a LATER day: UNKNOWN (never zero): first day feasible, after 6 evaluated / 4 viable / 1 unknown', asLaterDay.startDateState === 'KNOWN_FEASIBLE' && asLaterDay.afterStartEvaluatedDays === 6 && asLaterDay.afterStartViableDays === 4 && asLaterDay.afterStartUnknownDays === 1 && asLaterDay.coverage === 'PARTIAL');
    const asFirstDay = adapt(ny, '2026-11-01', '2026-11-03', 'America/New_York', localDateTimeToUTC('2026-11-01', '00:30', 'America/New_York'));
    check('DST overlap as the FIRST day: startDateState UNKNOWN, and the later days are evaluated independently', asFirstDay.startDateState === 'UNKNOWN' && asFirstDay.afterStartEvaluatedDays === 2 && asFirstDay.afterStartViableDays === 2 && asFirstDay.unknownDays === 1);
    // spring forward Sunday 2026-03-08: 02:30 does not exist (gap)
    const gap = adapt(workWeek([{ weekday: 0, startTime: '02:30', endTime: '04:00' }]), '2026-03-02', '2026-03-08', 'America/New_York', localDateTimeToUTC('2026-03-02', '08:00', 'America/New_York'));
    check('DST gap (NY 2026-03-08, 02:30 does not exist): the Sunday is UNKNOWN', gap.afterStartUnknownDays === 1 && gap.afterStartViableDays === 4);
    // 30-minute transition: Australia/Lord_Howe starts DST 2026-10-04 at 02:00 -> 02:30, so 02:15 does not exist
    const lh = adapt({ configured: true, periods: [{ weekday: 0, startTime: '02:15', endTime: '05:00' }, { weekday: 1, startTime: '09:00', endTime: '17:00' }] }, '2026-10-03', '2026-10-05', 'Australia/Lord_Howe', localDateTimeToUTC('2026-10-03', '00:30', 'Australia/Lord_Howe'));
    check('non-one-hour DST transition (Lord Howe, 30 minutes): the affected Sunday window is UNKNOWN; the Saturday and Monday are evaluated normally', lh.afterStartUnknownDays === 1 && lh.afterStartViableDays === 1 && lh.startDateState === 'KNOWN_INFEASIBLE');
    const ordinary = adapt(ny, '2026-10-26', '2026-10-31', 'America/New_York', localDateTimeToUTC('2026-10-26', '08:00', 'America/New_York'));
    check('an ordinary week with no transition has no unknown days (granularity is per date)', ordinary.afterStartUnknownDays === 0 && ordinary.coverage === 'COMPLETE');
  }

  // ============================================================
  // Blockers (through the real O2 adapter): today only vs a future day only
  // ============================================================
  {
    const cfg = workWeek();
    const now = utc('2026-10-07', '08:00');
    const base = adapt(cfg, '2026-10-07', '2026-10-11', 'UTC', now);
    const todayBlocked = adapt(cfg, '2026-10-07', '2026-10-11', 'UTC', now, [{ start: utc('2026-10-07', '08:30'), end: utc('2026-10-07', '17:30'), status: 'UPCOMING' }]);
    const futureBlocked = adapt(cfg, '2026-10-07', '2026-10-11', 'UTC', now, [{ start: utc('2026-10-08', '08:30'), end: utc('2026-10-08', '17:30'), status: 'UPCOMING' }]);
    check('blocking TODAY only: the first day turns KNOWN_INFEASIBLE and the later counts are unchanged', base.startDateState === 'KNOWN_FEASIBLE' && todayBlocked.startDateState === 'KNOWN_INFEASIBLE' && todayBlocked.afterStartViableDays === base.afterStartViableDays && todayBlocked.viableDays === base.viableDays - 1);
    check('blocking a FUTURE day only: the later viable count drops by one and the first day is unchanged', futureBlocked.startDateState === base.startDateState && futureBlocked.afterStartViableDays === base.afterStartViableDays - 1 && futureBlocked.afterStartEvaluatedDays === base.afterStartEvaluatedDays);
  }
  {
    // several fitting windows on one day still count as ONE viable day
    const f = run('2026-10-07', '2026-10-08', { '2026-10-07': 'F', '2026-10-08': { kind: 'KNOWN', windows: [win('2026-10-08', '09:00', '10:00'), win('2026-10-08', '11:00', '12:00'), win('2026-10-08', '13:00', '14:00'), win('2026-10-08', '15:00', '16:00')] } }, { now: utc('2026-10-07', '08:00') });
    check('civil days, not windows: one later day with FOUR fitting windows is exactly ONE later viable day', f.afterStartViableDays === 1 && f.afterStartEvaluatedDays === 1);
  }

  // ============================================================
  // Civil-date boundaries and timezones
  // ============================================================
  {
    const span = (start: string, end: string) => {
      const dates: string[] = [];
      for (let d = start; d <= end; d = addDaysToDateStr(d, 1)) dates.push(d);
      const by: Record<string, DayAvailabilityInput | 'F'> = {};
      dates.forEach((d) => (by[d] = 'F'));
      return run(start, end, by, { now: utc(start, '00:00') });
    };
    const month = span('2026-04-30', '2026-05-03');
    const year = span('2026-12-31', '2027-01-03');
    const leap = span('2024-02-29', '2024-03-03');
    const nonLeap = span('2026-02-28', '2026-03-01');
    check('month boundary (Apr 30 .. May 3): 3 later days', month.afterStartEvaluatedDays === 3 && partition(month));
    check('year boundary (Dec 31 .. Jan 3): 3 later days', year.afterStartEvaluatedDays === 3 && partition(year));
    check('leap day (2024-02-29 .. 03-03): 3 later days; non-leap Feb 28 .. Mar 1: 1 later day', leap.afterStartEvaluatedDays === 3 && nonLeap.afterStartEvaluatedDays === 1);
  }
  {
    // Kolkata: UTC Sunday 20:00Z is already Monday local. The horizon the preview derives starts at the LOCAL Monday.
    const tzCfg = workWeek();
    const kolkataNow = iso('2026-10-11T20:00:00Z');
    const kol = adapt(tzCfg, '2026-10-12', '2026-10-18', 'Asia/Kolkata', kolkataNow);
    const la = adapt(tzCfg, '2026-10-11', '2026-10-11', 'America/Los_Angeles', kolkataNow);
    const u = adapt(tzCfg, '2026-10-12', '2026-10-18', 'UTC', iso('2026-10-12T00:00:00Z'));
    check('Kolkata (local Monday): the first day is Monday, six later days, 4 later viable', kol.startDateState !== 'KNOWN_INFEASIBLE' && kol.afterStartEvaluatedDays === 6 && kol.afterStartViableDays === 4);
    check('Los Angeles (still local Sunday, period end): one-day horizon, first day known-empty, no later days', la.startDateState === 'KNOWN_INFEASIBLE' && la.afterStartEvaluatedDays === 0);
    check('UTC Monday: six later days', u.afterStartEvaluatedDays === 6 && u.startDateState === 'KNOWN_FEASIBLE');
  }

  // ============================================================
  // O4 composition: transport, required fields, duration basis, candidate-local
  // ============================================================
  {
    const rangeDeps: OpportunityRangeDeps = { loadAvailabilityConfiguration: async () => workWeek(), loadPlansOverlappingRange: async () => [] };
    const WEEKFACTS: DecisionFacts = { recurrence: { period: 'LOCAL_CALENDAR_WEEK', periodStartDate: '2026-10-05', periodEndDate: '2026-10-11', targetPerPeriod: 3, completedInPeriod: 0, committedInPeriod: 0, remainingInPeriod: 3 } };
    const out = await computeOpportunityDecisionFacts(
      [
        { intentId: 'a', durationMinutes: 30, durationBasis: 'RESOLVED', facts: WEEKFACTS },
        { intentId: 'b', durationMinutes: 45, durationBasis: 'GENERIC_FALLBACK', facts: WEEKFACTS },
      ],
      { planningDate: '2026-10-07', timezone: 'UTC', now: utc('2026-10-07', '08:00') },
      rangeDeps
    );
    const a = out.get('a')!;
    const b = out.get('b')!;
    check('O4 transports all four new facts with explicit, non-optional values', ['startDateState', 'afterStartEvaluatedDays', 'afterStartViableDays', 'afterStartUnknownDays'].every((k) => (a as any)[k] !== undefined) && a.startDateState === 'KNOWN_FEASIBLE' && a.afterStartEvaluatedDays === 4 && a.afterStartViableDays === 2 && a.afterStartUnknownDays === 0);
    check('O4 old fields keep their meaning: evaluated 5, viable 3, unknown 0, COMPLETE, horizon 10-07..10-11', a.horizonStartDate === '2026-10-07' && a.horizonEndDate === '2026-10-11' && a.evaluatedDays === 5 && a.viableDays === 3 && a.unknownDays === 0 && a.coverage === 'COMPLETE' && partition({ ...a } as unknown as OpportunityFacts));
    check('RESOLVED and GENERIC_FALLBACK produce the SAME structural fields (same keys, same order); only the basis (and the duration used) differ', JSON.stringify(Object.keys(a)) === JSON.stringify(Object.keys(b)) && a.durationBasis === 'RESOLVED' && b.durationBasis === 'GENERIC_FALLBACK' && b.durationMinutes === 45);
    check('candidate-local: two candidates may both count the same later day (no shared-capacity inference)', a.afterStartViableDays === 2 && b.afterStartViableDays === 2);
    const none = await computeOpportunityDecisionFacts([{ intentId: 'x', durationMinutes: 30, durationBasis: 'RESOLVED', facts: {} }], { planningDate: '2026-10-07', timezone: 'UTC', now: utc('2026-10-07', '08:00') }, rangeDeps);
    check('no horizon (no recurrence facts): no opportunity facts at all, so no new field can silently mean zero', none.size === 0);
  }

  if (!allPassed) {
    console.error('SOME OPPORTUNITY FACT QUALITY CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL OPPORTUNITY FACT QUALITY CHECKS PASSED');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
