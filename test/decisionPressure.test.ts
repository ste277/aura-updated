/**
 * Constructor Decision Intelligence -- O5 P2b: pure Decision Pressure derivation (pure behavior, no DB).
 *
 * The semantic matrix: ONE minimal canonical positive fixture satisfying every predicate, and then each predicate
 * individually falsified from it -- every single falsification must yield NONE. Plus the real producers: evidence built by
 * the REAL opportunity projection (O1/O2/O4) and the REAL recurrence arithmetic, so the predicate is checked against what
 * the system actually produces, across weekdays, a year boundary and DST transition dates.
 *
 * Pure: the deriver is exercised only through its public function; this file also proves it never reads a clock, logs,
 * mutates its input or throws. Run it under several process timezones: the result must not change.
 */
import { deriveDecisionPressure, type DecisionPressure, type DecisionPressureInput, type PressureCandidateFlexibility } from '../apps/web/lib/decisionPressure';
import { buildDecisionEvidence, type DecisionEvidence } from '../apps/web/lib/decisionEvidence';
import { computeOpportunityDecisionFacts } from '../apps/web/lib/opportunityDecisionFacts';
import { computeGoalActivityRhythmEligibility, localCalendarWeekBounds } from '../apps/web/lib/goalActivityRhythm';
import type { DayIntent } from '../apps/web/lib/dayIntent';
import type { DecisionFacts, OpportunityDecisionFacts, RecurrenceDecisionFacts } from '../apps/web/lib/decisionFacts';
import type { OpportunityRangeDeps } from '../apps/web/lib/opportunityRangeAdapter';
import type { AvailabilityConfiguration } from '../apps/web/lib/availabilityContext';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ---- compile-time: the pressure module's flexibility type is exactly the Constructor's, without importing it ----
const _toIntent: DayIntent['flexibility'] = 'FLEXIBLE' as PressureCandidateFlexibility;
const _toPressure: PressureCandidateFlexibility = 'FLEXIBLE' as DayIntent['flexibility'];
void _toIntent; void _toPressure;

// ---- fixtures ----
type Recurrence = { -readonly [K in keyof RecurrenceDecisionFacts]: unknown };
type Opportunity = { -readonly [K in keyof OpportunityDecisionFacts]: unknown };
interface Spec { recurrence?: Recurrence; opportunity?: Opportunity; planningDate: unknown; flexibility: unknown }

const DATE = '2026-10-07'; // Wednesday
/** The minimal canonical positive: Wed, current day known feasible, nothing later in the week viable or unknown, 3 occurrences remaining. */
const positive = (): Spec => ({
  planningDate: DATE,
  flexibility: 'FLEXIBLE',
  recurrence: { period: 'LOCAL_CALENDAR_WEEK', periodStartDate: '2026-10-05', periodEndDate: '2026-10-11', targetPerPeriod: 5, completedInPeriod: 1, committedInPeriod: 1, remainingInPeriod: 3 },
  opportunity: { horizonStartDate: DATE, horizonEndDate: '2026-10-11', evaluatedDays: 5, viableDays: 1, unknownDays: 0, coverage: 'COMPLETE', durationMinutes: 60, durationBasis: 'RESOLVED', startDateState: 'KNOWN_FEASIBLE', afterStartEvaluatedDays: 4, afterStartViableDays: 0, afterStartUnknownDays: 0 },
});
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const evidenceOf = (spec: Spec): DecisionEvidence | undefined => buildDecisionEvidence({ ...(spec.recurrence ? { recurrence: spec.recurrence as unknown as RecurrenceDecisionFacts } : {}), ...(spec.opportunity ? { opportunity: spec.opportunity as unknown as OpportunityDecisionFacts } : {}) } as DecisionFacts);
const pressureOf = (spec: Spec): DecisionPressure => deriveDecisionPressure({ evidence: evidenceOf(spec), planningDate: spec.planningDate as string, flexibility: spec.flexibility as PressureCandidateFlexibility });
const NONE: DecisionPressure = 'NONE';
const LAST: DecisionPressure = 'LAST_KNOWN_OPPORTUNITY';

// ---- instrumentation: the deriver must not read a clock or log ----
let clockReads = 0; let logs = 0;
const realNow = Date.now;
Date.now = () => { clockReads += 1; return realNow(); };
const realConsole = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
const quiet = <T>(fn: () => T): T => {
  const count = () => { logs += 1; };
  console.warn = count; console.error = count; console.info = count; console.debug = count;
  try { return fn(); } finally { console.warn = realConsole.warn; console.error = realConsole.error; console.info = realConsole.info; console.debug = realConsole.debug; }
};

(async () => {
  // ============================================================
  console.log('=== the canonical positive fixture and the positive cases ===');
  check('POSITIVE: the minimal canonical fixture (every predicate satisfied) is LAST_KNOWN_OPPORTUNITY', pressureOf(positive()) === LAST);
  check('output is a primitive categorical value (a string literal), never an object or a number', typeof pressureOf(positive()) === 'string' && (['NONE', 'LAST_KNOWN_OPPORTUNITY'] as string[]).includes(pressureOf(positive())));
  for (const remaining of [1, 2, 3, 7]) {
    const s = positive(); s.recurrence!.targetPerPeriod = remaining + 2; s.recurrence!.completedInPeriod = 1; s.recurrence!.committedInPeriod = 1; s.recurrence!.remainingInPeriod = remaining;
    check(`REMAINING ${remaining}: any positive remaining qualifies (not only 1) -- "last known opportunity for at least one remaining occurrence"`, pressureOf(s) === LAST);
  }
  const noShortfall = positive(); noShortfall.recurrence!.targetPerPeriod = 9; noShortfall.recurrence!.completedInPeriod = 0; noShortfall.recurrence!.committedInPeriod = 0; noShortfall.recurrence!.remainingInPeriod = 9;
  check('NO SHORTFALL MATH: 9 remaining occurrences against 1 viable day is still just LAST_KNOWN_OPPORTUNITY (occurrences and civil days are different units; nothing is subtracted or scored)', pressureOf(noShortfall) === LAST);
  const sunday = positive(); sunday.planningDate = '2026-10-11'; sunday.opportunity = { ...sunday.opportunity!, horizonStartDate: '2026-10-11', evaluatedDays: 1, viableDays: 1, afterStartEvaluatedDays: 0, afterStartViableDays: 0, afterStartUnknownDays: 0 };
  check('ONE-DAY HORIZON (Sunday, the period end): afterStart counts are all zero, every other predicate passes -> LAST_KNOWN_OPPORTUNITY', pressureOf(sunday) === LAST);
  const monday = positive(); monday.planningDate = '2026-10-05'; monday.opportunity = { ...monday.opportunity!, horizonStartDate: '2026-10-05', evaluatedDays: 7, viableDays: 1, afterStartEvaluatedDays: 6 };
  check('MONDAY (the period start): planning date equals periodStartDate -> qualifies', pressureOf(monday) === LAST);
  const friday = positive(); friday.planningDate = '2026-10-09'; friday.opportunity = { ...friday.opportunity!, horizonStartDate: '2026-10-09', evaluatedDays: 3, viableDays: 1, afterStartEvaluatedDays: 2 };
  check('MIDWEEK (Friday, two later days both known infeasible): qualifies', pressureOf(friday) === LAST);
  const yearEnd = positive(); yearEnd.planningDate = '2027-01-01'; yearEnd.recurrence = { ...yearEnd.recurrence!, periodStartDate: '2026-12-28', periodEndDate: '2027-01-03' }; yearEnd.opportunity = { ...yearEnd.opportunity!, horizonStartDate: '2027-01-01', horizonEndDate: '2027-01-03', evaluatedDays: 3, viableDays: 1, afterStartEvaluatedDays: 2 };
  check('YEAR BOUNDARY: a Monday 2026-12-28 .. Sunday 2027-01-03 period with the planning date in January qualifies (string-ordered civil dates, no Date arithmetic)', pressureOf(yearEnd) === LAST);
  const priorYear = clone(yearEnd); priorYear.planningDate = '2026-12-30'; priorYear.opportunity = { ...priorYear.opportunity!, horizonStartDate: '2026-12-30', evaluatedDays: 5, afterStartEvaluatedDays: 4 };
  check('YEAR BOUNDARY: the planning date in December, the horizon running into January, qualifies', pressureOf(priorYear) === LAST);
  for (const [label, date, start, end] of [['US spring-forward Sunday 2026-03-08', '2026-03-08', '2026-03-02', '2026-03-08'], ['US fall-back Sunday 2026-11-01', '2026-11-01', '2026-10-26', '2026-11-01'], ['Auckland spring-forward Sunday 2026-09-27', '2026-09-27', '2026-09-21', '2026-09-27']] as const) {
    const s = positive(); s.planningDate = date; s.recurrence = { ...s.recurrence!, periodStartDate: start, periodEndDate: end }; s.opportunity = { ...s.opportunity!, horizonStartDate: date, horizonEndDate: end, evaluatedDays: 1, viableDays: 1, afterStartEvaluatedDays: 0 };
    check(`DST (civil-date evidence only): ${label} -> deterministic LAST_KNOWN_OPPORTUNITY; no DST arithmetic exists in the deriver`, pressureOf(s) === LAST);
    const mid = clone(s); mid.planningDate = start; mid.opportunity = { ...mid.opportunity!, horizonStartDate: start, evaluatedDays: 7, afterStartEvaluatedDays: 6 };
    check(`DST: the Monday of that week (${start}) is equally deterministic`, pressureOf(mid) === LAST);
  }

  // ============================================================
  console.log('=== the semantic matrix: each predicate individually falsified from the positive fixture -> NONE ===');
  const falsifications: Array<[string, (s: Spec) => void]> = [
    // A / B / F -- who and what evidence
    ['FIXED candidate (pressure is for deferrable work)', (s) => { s.flexibility = 'FIXED'; }],
    ['unknown flexibility value', (s) => { s.flexibility = 'FLEX'; }],
    ['missing flexibility', (s) => { s.flexibility = undefined; }],
    ['recurrence evidence absent', (s) => { delete s.recurrence; }],
    ['opportunity evidence absent', (s) => { delete s.opportunity; }],
    // C -- period kind
    ['recurrence period is not LOCAL_CALENDAR_WEEK (a future kind is never inferred)', (s) => { s.recurrence!.period = 'LOCAL_CALENDAR_MONTH'; }],
    ['recurrence period missing', (s) => { s.recurrence!.period = undefined; }],
    // D -- planning date inside the period
    ['planning date before periodStartDate', (s) => { s.planningDate = '2026-10-04'; }],
    ['planning date after periodEndDate', (s) => { s.planningDate = '2026-10-12'; }],
    // E -- remaining
    ['remainingInPeriod 0 (no demand left)', (s) => { s.recurrence!.targetPerPeriod = 2; s.recurrence!.completedInPeriod = 1; s.recurrence!.committedInPeriod = 1; s.recurrence!.remainingInPeriod = 0; }],
    // G / H -- aligned horizon
    ['horizon starts before the planning date (start mismatch)', (s) => { s.opportunity!.horizonStartDate = '2026-10-06'; }],
    ['horizon starts after the planning date (start mismatch)', (s) => { s.opportunity!.horizonStartDate = '2026-10-08'; }],
    ['horizon ends before the period end (end mismatch)', (s) => { s.opportunity!.horizonEndDate = '2026-10-10'; }],
    ['horizon ends after the period end (end mismatch)', (s) => { s.opportunity!.horizonEndDate = '2026-10-12'; }],
    // I -- duration basis
    ['GENERIC_FALLBACK duration (even though every other fact looks scarce)', (s) => { s.opportunity!.durationBasis = 'GENERIC_FALLBACK'; }],
    ['unknown duration basis', (s) => { s.opportunity!.durationBasis = 'GUESSED'; }],
    // J -- current day
    ['current day KNOWN_INFEASIBLE (impossible work is never labelled urgent)', (s) => { s.opportunity!.startDateState = 'KNOWN_INFEASIBLE'; s.opportunity!.viableDays = 0; }],
    ['current day UNKNOWN', (s) => { s.opportunity!.startDateState = 'UNKNOWN'; s.opportunity!.viableDays = 0; s.opportunity!.unknownDays = 1; }],
    ['unrecognized current-day state', (s) => { s.opportunity!.startDateState = 'MAYBE'; s.opportunity!.viableDays = 0; }],
    // K / L -- later days
    ['a later day is known viable', (s) => { s.opportunity!.afterStartViableDays = 1; s.opportunity!.viableDays = 2; }],
    ['several later days are known viable', (s) => { s.opportunity!.afterStartViableDays = 4; s.opportunity!.viableDays = 5; }],
    ['a later day is unknown', (s) => { s.opportunity!.afterStartUnknownDays = 1; s.opportunity!.unknownDays = 1; }],
    ['every later day is unknown', (s) => { s.opportunity!.afterStartUnknownDays = 4; s.opportunity!.unknownDays = 4; }],
    // M -- coverage
    ['coverage PARTIAL', (s) => { s.opportunity!.coverage = 'PARTIAL'; }],
    ['coverage UNKNOWN', (s) => { s.opportunity!.coverage = 'UNKNOWN'; }],
    ['unrecognized coverage', (s) => { s.opportunity!.coverage = 'MOSTLY'; }],
    // N -- partition invariants
    ['evaluated partition broken (evaluatedDays != 1 + afterStartEvaluatedDays), too high', (s) => { s.opportunity!.evaluatedDays = 6; }],
    ['evaluated partition broken, too low', (s) => { s.opportunity!.evaluatedDays = 4; }],
    ['viable partition broken (viableDays counts a day nothing accounts for)', (s) => { s.opportunity!.viableDays = 2; }],
    ['viable partition broken (viableDays 0 although the start day is KNOWN_FEASIBLE)', (s) => { s.opportunity!.viableDays = 0; }],
    ['unknown partition broken (unknownDays 1 with nothing unknown)', (s) => { s.opportunity!.unknownDays = 1; }],
    // recurrence arithmetic (the producer's exact relation)
    ['recurrence arithmetic: remaining larger than max(0, target - completed - committed)', (s) => { s.recurrence!.remainingInPeriod = 4; }],
    ['recurrence arithmetic: remaining smaller than max(0, target - completed - committed) but still positive', (s) => { s.recurrence!.remainingInPeriod = 2; }],
    ['recurrence arithmetic: completed + committed exceed the target but remaining is positive', (s) => { s.recurrence!.targetPerPeriod = 2; s.recurrence!.completedInPeriod = 2; s.recurrence!.committedInPeriod = 2; s.recurrence!.remainingInPeriod = 1; }],
    // date order
    ['periodStartDate after periodEndDate', (s) => { s.recurrence!.periodStartDate = '2026-10-12'; s.recurrence!.periodEndDate = '2026-10-05'; }],
    ['horizonStartDate after horizonEndDate', (s) => { s.opportunity!.horizonStartDate = '2026-10-12'; s.opportunity!.horizonEndDate = '2026-10-11'; s.planningDate = '2026-10-12'; }],
  ];
  for (const [label, mutate] of falsifications) {
    const s = positive(); mutate(s);
    check(`NONE: ${label}`, pressureOf(s) === NONE);
  }
  let matrixCount = falsifications.length;

  // malformed counts (every count the predicate reads), malformed duration, malformed dates
  const BAD_COUNTS: unknown[] = [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, '3', null, undefined, {}];
  const recurrenceCountFields = ['targetPerPeriod', 'completedInPeriod', 'committedInPeriod', 'remainingInPeriod'] as const;
  const opportunityCountFields = ['evaluatedDays', 'viableDays', 'unknownDays', 'afterStartEvaluatedDays', 'afterStartViableDays', 'afterStartUnknownDays'] as const;
  let countCases = 0; let countAllNone = true;
  for (const field of recurrenceCountFields) for (const bad of BAD_COUNTS) { const s = positive(); (s.recurrence as Record<string, unknown>)[field] = bad; countCases += 1; if (pressureOf(s) !== NONE) { countAllNone = false; console.log(`   [diag] recurrence.${field} = ${String(bad)} qualified`); } }
  for (const field of opportunityCountFields) for (const bad of BAD_COUNTS) { const s = positive(); (s.opportunity as Record<string, unknown>)[field] = bad; countCases += 1; if (pressureOf(s) !== NONE) { countAllNone = false; console.log(`   [diag] opportunity.${field} = ${String(bad)} qualified`); } }
  check(`MALFORMED COUNTS: all ${countCases} cases (NaN, Infinity, negative, fractional, string, null, undefined, object in each of the 4 recurrence and 6 opportunity counts) -> NONE`, countAllNone);
  matrixCount += countCases;
  let durationAllNone = true; let durationCases = 0;
  for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 30.5, '60', null, undefined]) { const s = positive(); s.opportunity!.durationMinutes = bad; durationCases += 1; if (pressureOf(s) !== NONE) durationAllNone = false; }
  check(`MALFORMED DURATION: all ${durationCases} cases (0, negative, NaN, Infinity, fractional, string, null, undefined) -> NONE`, durationAllNone);
  matrixCount += durationCases;
  const BAD_DATES: unknown[] = ['2026-02-30', '2026-13-01', '2026-1-5', '2026/10/07', '', ' 2026-10-07', '2026-10-07T00:00:00Z', 20261007, null, undefined];
  let dateAllNone = true; let dateCases = 0;
  for (const bad of BAD_DATES) {
    for (const where of ['planning', 'periodStart', 'periodEnd', 'horizonStart', 'horizonEnd'] as const) {
      const s = positive();
      if (where === 'planning') s.planningDate = bad; else if (where === 'periodStart') s.recurrence!.periodStartDate = bad; else if (where === 'periodEnd') s.recurrence!.periodEndDate = bad; else if (where === 'horizonStart') s.opportunity!.horizonStartDate = bad; else s.opportunity!.horizonEndDate = bad;
      dateCases += 1;
      if (pressureOf(s) !== NONE) { dateAllNone = false; console.log(`   [diag] ${where} = ${String(bad)} qualified`); }
    }
  }
  check(`MALFORMED DATES: all ${dateCases} cases (impossible calendar dates, wrong shapes, empty, number, null, undefined) at each of the 5 date inputs -> NONE`, dateAllNone);
  matrixCount += dateCases;
  console.log(`   [info] semantic matrix: ${matrixCount} individually falsified fixtures, every one NONE`);
  check(`THE MATRIX IS EXHAUSTIVE: ${matrixCount} single-predicate falsifications of the one positive fixture all yield NONE`, matrixCount >= 150);

  // ============================================================
  console.log('=== absence and malformed evidence never throw ===');
  check('absent evidence -> NONE (no throw)', deriveDecisionPressure({ evidence: undefined, planningDate: DATE, flexibility: 'FLEXIBLE' }) === NONE);
  check('empty evidence object -> NONE', deriveDecisionPressure({ evidence: Object.freeze({}), planningDate: DATE, flexibility: 'FLEXIBLE' }) === NONE);
  const hostile = { get recurrence(): never { throw new Error('boom'); }, opportunity: undefined } as unknown as DecisionEvidence;
  check('evidence whose property access throws fails CLOSED to NONE (no throw, nothing logged)', quiet(() => deriveDecisionPressure({ evidence: hostile, planningDate: DATE, flexibility: 'FLEXIBLE' })) === NONE);
  for (const junk of [5, 'x', true, [], null] as unknown[]) {
    check(`non-object evidence (${JSON.stringify(junk)}) -> NONE`, deriveDecisionPressure({ evidence: junk as DecisionEvidence, planningDate: DATE, flexibility: 'FLEXIBLE' }) === NONE);
  }
  check('absent input fields do not throw: planning date undefined -> NONE', deriveDecisionPressure({ evidence: evidenceOf(positive()), planningDate: undefined as unknown as string, flexibility: 'FLEXIBLE' }) === NONE);

  // ============================================================
  console.log('=== purity: immutable input, deterministic, idempotent, no clock, no logging ===');
  const evidence = evidenceOf(positive())!;
  const input: DecisionPressureInput = Object.freeze({ evidence, planningDate: DATE, flexibility: 'FLEXIBLE' as const });
  const before = JSON.stringify(evidence);
  clockReads = 0; logs = 0;
  const results = quiet(() => Array.from({ length: 50 }, () => deriveDecisionPressure(input)));
  check('DETERMINISM / IDEMPOTENCE: 50 repeated calls on the same input all return LAST_KNOWN_OPPORTUNITY', results.every((r) => r === LAST));
  check('EVIDENCE IMMUTABILITY: the (frozen) evidence and the (frozen) input are unchanged after every call, and no call threw writing to them', JSON.stringify(evidence) === before && Object.isFrozen(evidence) && Object.isFrozen(evidence.recurrence) && Object.isFrozen(evidence.opportunity) && Object.isFrozen(input));
  check('NO CLOCK: the deriver never read Date.now()', clockReads === 0);
  check('NO LOGGING: the deriver wrote nothing to the console, for either result or for malformed evidence', logs === 0);
  const other = clone(positive());
  check('STRUCTURALLY EQUAL INPUTS give the same pressure regardless of object identity', pressureOf(other) === pressureOf(positive()));

  // ============================================================
  console.log('=== source neutrality and independence between candidates ===');
  const sameEvidence = (): DecisionEvidence => evidenceOf(positive())!;
  const asAutomatic = deriveDecisionPressure({ evidence: sameEvidence(), planningDate: DATE, flexibility: 'FLEXIBLE' });
  const asManual = deriveDecisionPressure({ evidence: sameEvidence(), planningDate: DATE, flexibility: 'FLEXIBLE' });
  check('SOURCE NEUTRALITY: the deriver has no id, title or source input at all; identical evidence derived for an "automatic" and a "manual canonical" candidate is identical pressure', asAutomatic === asManual && asAutomatic === LAST && deriveDecisionPressure.length === 1);
  const a = positive(); const b = positive(); b.opportunity!.afterStartViableDays = 2; b.opportunity!.viableDays = 3;
  const batch = [a, b, a, b].map(pressureOf);
  check('MULTIPLE CANDIDATES: each is derived independently from its own evidence, in any order, with no comparison (A pressured, B not, A pressured, B not)', batch.join() === [LAST, NONE, LAST, NONE].join());
  const both = [positive(), positive()].map(pressureOf);
  check('TWO CANDIDATES MAY BOTH BE LAST_KNOWN_OPPORTUNITY: the deriver does not choose between them', both.every((p) => p === LAST));
  check('the deriver is independent of the order candidates are asked about', [b, a].map(pressureOf).join() === [NONE, LAST].join());
  check('LEGACY / FACT-FREE candidate (no evidence): NONE', deriveDecisionPressure({ evidence: buildDecisionEvidence(undefined), planningDate: DATE, flexibility: 'FLEXIBLE' }) === NONE);
  check('NON-GOAL candidate: a generic candidate that carries the same authoritative evidence qualifies identically (the deriver cannot see what produced it)', deriveDecisionPressure({ evidence: sameEvidence(), planningDate: DATE, flexibility: 'FLEXIBLE' }) === LAST);

  // ============================================================
  console.log('=== the REAL producers: opportunity projection + recurrence arithmetic -> evidence -> pressure ===');
  type Weekday = AvailabilityConfiguration['periods'][number]['weekday'];
  const configured = (weekdays: number[]): AvailabilityConfiguration => ({ configured: true, periods: (weekdays as Weekday[]).map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })) });
  const UNCONFIGURED: AvailabilityConfiguration = { configured: false, periods: [] };
  const rangeDeps = (config: AvailabilityConfiguration, blocked: Array<{ start: Date; end: Date }> = []): OpportunityRangeDeps => ({
    loadAvailabilityConfiguration: async () => config,
    loadPlansOverlappingRange: async () => blocked.map((b) => ({ start: b.start, end: b.end, status: 'UPCOMING' as const })),
  });
  /** Real recurrence facts (the real week bounds and the real rhythm eligibility), real opportunity facts (the real projection), evidence, pressure. */
  const real = async (planningDate: string, timezone: string, nowIso: string, config: AvailabilityConfiguration, opts: { target?: number; completed?: number; committed?: number; durationBasis?: 'RESOLVED' | 'GENERIC_FALLBACK'; blocked?: Array<{ start: Date; end: Date }>; flexibility?: PressureCandidateFlexibility } = {}) => {
    const week = localCalendarWeekBounds(planningDate);
    const target = opts.target ?? 3; const completed = opts.completed ?? 0; const committed = opts.committed ?? 0;
    const elig = computeGoalActivityRhythmEligibility({ rhythm: { kind: 'N_PER_WEEK', targetPerWeek: target }, planningLocalDate: planningDate, occurrences: [...Array.from({ length: completed }, (_, i) => ({ localDate: week.startDate, contribution: 'COMPLETED' as const, id: `c${i}` })), ...Array.from({ length: committed }, (_, i) => ({ localDate: week.startDate, contribution: 'COMMITTED' as const, id: `m${i}` }))] } as never);
    const facts: DecisionFacts = { recurrence: { period: 'LOCAL_CALENDAR_WEEK', periodStartDate: week.startDate, periodEndDate: week.endDate, targetPerPeriod: target, completedInPeriod: elig.completedThisWeek, committedInPeriod: elig.committedThisWeek, remainingInPeriod: elig.remainingOccurrences } };
    const opp = await computeOpportunityDecisionFacts([{ intentId: 'c', durationMinutes: 60, durationBasis: opts.durationBasis ?? 'RESOLVED', facts }], { planningDate, timezone, now: new Date(nowIso) }, rangeDeps(config, opts.blocked));
    const ev = buildDecisionEvidence({ ...facts, ...(opp.get('c') ? { opportunity: opp.get('c') } : {}) });
    return { ev, opportunity: opp.get('c'), pressure: deriveDecisionPressure({ evidence: ev, planningDate, flexibility: opts.flexibility ?? 'FLEXIBLE' }) };
  };
  const MON_FRI = [1, 2, 3, 4, 5];
  const fri = await real('2026-10-09', 'UTC', '2026-10-09T09:00:00Z', configured(MON_FRI));
  check('REAL PRODUCER: Friday, availability Mon-Fri, Saturday/Sunday known infeasible -> today is the last known opportunity (the real projection satisfies every partition invariant the deriver checks)', fri.opportunity?.coverage === 'COMPLETE' && fri.opportunity?.afterStartViableDays === 0 && fri.opportunity?.afterStartUnknownDays === 0 && fri.opportunity?.startDateState === 'KNOWN_FEASIBLE' && fri.pressure === LAST);
  const wed = await real('2026-10-07', 'UTC', '2026-10-07T09:00:00Z', configured(MON_FRI));
  check('REAL PRODUCER: Wednesday with Thursday and Friday still viable -> NONE (a later day is known viable)', wed.opportunity!.afterStartViableDays === 2 && wed.pressure === NONE);
  const unconf = await real('2026-10-09', 'UTC', '2026-10-09T09:00:00Z', UNCONFIGURED);
  check('REAL PRODUCER: unconfigured availability -> every day UNKNOWN -> NONE (uncertainty suppresses pressure)', unconf.opportunity!.coverage === 'UNKNOWN' && unconf.pressure === NONE);
  const blockedFri = await real('2026-10-09', 'UTC', '2026-10-09T09:00:00Z', configured(MON_FRI), { blocked: [{ start: new Date('2026-10-09T09:00:00Z'), end: new Date('2026-10-09T17:00:00Z') }] });
  check('REAL PRODUCER: Friday fully blocked by an existing plan -> the start day is KNOWN_INFEASIBLE -> NONE (impossible work is not urgent)', blockedFri.opportunity!.startDateState === 'KNOWN_INFEASIBLE' && blockedFri.pressure === NONE);
  const fallback = await real('2026-10-09', 'UTC', '2026-10-09T09:00:00Z', configured(MON_FRI), { durationBasis: 'GENERIC_FALLBACK' });
  check('REAL PRODUCER: the same scarce Friday but with a GENERIC_FALLBACK duration -> NONE', fallback.opportunity!.durationBasis === 'GENERIC_FALLBACK' && fallback.pressure === NONE);
  const satOpen = await real('2026-10-09', 'UTC', '2026-10-09T09:00:00Z', configured([1, 2, 3, 4, 5, 6]));
  check('REAL PRODUCER: Friday with Saturday also available -> NONE', satOpen.opportunity!.afterStartViableDays === 1 && satOpen.pressure === NONE);
  const zero = await real('2026-10-09', 'UTC', '2026-10-09T09:00:00Z', configured(MON_FRI), { target: 3, completed: 2, committed: 1 });
  check('REAL PRODUCER: target met (3 = 2 completed + 1 committed) -> remainingInPeriod 0 -> NONE', zero.ev?.recurrence?.remainingInPeriod === 0 && zero.pressure === NONE);
  const multi = await real('2026-10-09', 'UTC', '2026-10-09T09:00:00Z', configured(MON_FRI), { target: 7, completed: 0, committed: 0 });
  check('REAL PRODUCER: 7 remaining against a single viable day -> LAST_KNOWN_OPPORTUNITY (remaining > 1)', multi.ev?.recurrence?.remainingInPeriod === 7 && multi.pressure === LAST);
  const fixedReal = await real('2026-10-09', 'UTC', '2026-10-09T09:00:00Z', configured(MON_FRI), { flexibility: 'FIXED' });
  check('REAL PRODUCER: identical evidence for a FIXED candidate -> NONE', fixedReal.ev !== undefined && fixedReal.pressure === NONE);
  const sunReal = await real('2026-10-11', 'UTC', '2026-10-11T09:00:00Z', configured([0, 1, 2, 3, 4, 5, 6]));
  check('REAL PRODUCER: Sunday, the period end (one-day horizon, availability on Sunday) -> LAST_KNOWN_OPPORTUNITY', sunReal.opportunity!.evaluatedDays === 1 && sunReal.opportunity!.afterStartEvaluatedDays === 0 && sunReal.pressure === LAST);
  const monReal = await real('2026-10-05', 'UTC', '2026-10-05T09:00:00Z', configured([1]));
  check('REAL PRODUCER: Monday (period start) with availability only on Monday -> LAST_KNOWN_OPPORTUNITY', monReal.opportunity!.evaluatedDays === 7 && monReal.pressure === LAST);
  const monMore = await real('2026-10-05', 'UTC', '2026-10-05T09:00:00Z', configured(MON_FRI));
  check('REAL PRODUCER: Monday with Tuesday-Friday available -> NONE', monMore.pressure === NONE);
  const newYear = await real('2027-01-01', 'UTC', '2027-01-01T09:00:00Z', configured(MON_FRI));
  check('REAL PRODUCER, YEAR BOUNDARY: the real week bounds 2026-12-28 .. 2027-01-03 with the planning date Friday 2027-01-01 -> aligned horizon, LAST_KNOWN_OPPORTUNITY', newYear.ev?.recurrence?.periodStartDate === '2026-12-28' && newYear.ev?.recurrence?.periodEndDate === '2027-01-03' && newYear.opportunity!.horizonEndDate === '2027-01-03' && newYear.pressure === LAST);
  const decWeek = await real('2026-12-30', 'UTC', '2026-12-30T09:00:00Z', configured([3, 5]));
  check('REAL PRODUCER, YEAR BOUNDARY: planning Wednesday 2026-12-30, Friday 2027-01-01 still viable -> NONE', decWeek.pressure === NONE);
  const dstSpring = await real('2026-03-08', 'America/Los_Angeles', '2026-03-08T16:00:00Z', configured([0, 1, 2, 3, 4, 5, 6]));
  check('REAL PRODUCER, DST: US spring-forward Sunday (23-hour day), the period end -> deterministic LAST_KNOWN_OPPORTUNITY', dstSpring.opportunity?.horizonStartDate === '2026-03-08' && dstSpring.pressure === LAST);
  const dstFall = await real('2026-11-01', 'America/Los_Angeles', '2026-11-01T17:00:00Z', configured([0, 1, 2, 3, 4, 5, 6]));
  check('REAL PRODUCER, DST: US fall-back Sunday (25-hour day), the period end -> deterministic LAST_KNOWN_OPPORTUNITY', dstFall.opportunity?.horizonStartDate === '2026-11-01' && dstFall.pressure === LAST);
  const dstWeek = await real('2026-03-05', 'America/Los_Angeles', '2026-03-05T17:00:00Z', configured(MON_FRI));
  check('REAL PRODUCER, DST: the week containing the spring-forward date, Thursday with Friday still viable -> NONE', dstWeek.pressure === NONE);

  Date.now = realNow;
  if (!allPassed) {
    console.error('SOME DECISION PRESSURE CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL DECISION PRESSURE CHECKS PASSED');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
