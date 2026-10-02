/**
 * Opportunity Scarcity V1 -- O3: recurrence period bounds (pure, no DB).
 *
 * Recurrence Decision Facts now carry the INCLUSIVE local civil-date
 * extent of the period their counts are taken over. This file proves:
 *   - the canonical week helper (Monday-start, Sunday-inclusive end,
 *     month/year/leap boundaries, a 3-year property sweep against an
 *     independent Date.UTC oracle)
 *   - ONE authority: the emitted bounds are exactly the period the
 *     canonical Rhythm eligibility function counts over (occurrences on
 *     the bound dates are counted, the day before/after are not)
 *   - the planning date is server-derived from the user's own timezone
 *     (positive/negative offset, UTC, DST weeks), never from the UTC date
 *     or any client value
 *   - recurrence math is unchanged; eligibility is unchanged; no new
 *     query; forged client bounds are ignored
 */
import { localCalendarWeekBounds, localCalendarWeekStart, computeGoalActivityRhythmEligibility, type GoalActivityRhythmOccurrenceFact } from '../apps/web/lib/goalActivityRhythm';
import { translateGoalDemandToDecisionFacts, loadGoalDecisionFacts } from '../apps/web/lib/goalDecisionFactsProvider';
import { encodeGoalDemandIntentId } from '../apps/web/lib/goalDemandIntentId';
import { parseConstructDayPreviewRequestBody, runDayConstructorPreview } from '../apps/web/lib/dayConstructorPreviewRequest';
import { addDaysToDateStr, getDatePartsInTimezone } from '../apps/web/lib/timezone';
import type { GoalDemandCandidate, GoalDemandCandidatesDeps } from '../apps/web/lib/goalDemandCandidates';
import type { ConstructDayRequest, DayConstructorOrchestratorDeps } from '../apps/web/lib/dayConstructorOrchestrator';
import type { CandidateGoalActivityForRhythmDemandRow, User } from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const iso = (s: string) => new Date(s);

// ============================================================
// 1. Canonical helper -- exact civil dates
// ============================================================
const table: Array<[string, string, string, string]> = [
  ['2026-10-05', '2026-10-05', '2026-10-11', 'Monday maps to its own week'],
  ['2026-10-06', '2026-10-05', '2026-10-11', 'Tuesday'],
  ['2026-10-07', '2026-10-05', '2026-10-11', 'midweek (Wednesday)'],
  ['2026-10-11', '2026-10-05', '2026-10-11', 'Sunday belongs to the week that STARTED the previous Monday'],
  ['2026-10-12', '2026-10-12', '2026-10-18', 'the next Monday starts a new week (end is never "next Monday")'],
  ['2026-04-30', '2026-04-27', '2026-05-03', 'week crossing a month end (Apr -> May)'],
  ['2026-05-03', '2026-04-27', '2026-05-03', 'month-crossing week: the Sunday side'],
  ['2026-12-31', '2026-12-28', '2027-01-03', 'week crossing a year end (Dec -> Jan)'],
  ['2027-01-01', '2026-12-28', '2027-01-03', 'year-crossing week: the January side'],
  ['2025-01-01', '2024-12-30', '2025-01-05', 'year-crossing week starting in the previous year'],
  ['2024-02-29', '2024-02-26', '2024-03-03', 'leap day (2024-02-29) week'],
  ['2024-03-01', '2024-02-26', '2024-03-03', 'leap-day week: the March side'],
  ['2028-02-29', '2028-02-28', '2028-03-05', 'leap day (2028-02-29, a Tuesday)'],
  ['2026-02-28', '2026-02-23', '2026-03-01', 'non-leap February end rolls to 03-01, never 02-29'],
];
for (const [date, start, end, label] of table) {
  const b = localCalendarWeekBounds(date);
  check(`bounds ${date}: ${label} -> ${start}..${end}`, b.startDate === start && b.endDate === end);
}
{
  const dayOfWeek = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
  const dayNumber = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86400000;
  let bad = 0;
  let sweepSize = 0;
  for (let d = '2023-01-01'; d <= '2026-12-31'; d = addDaysToDateStr(d, 1)) {
    sweepSize += 1;
    const b = localCalendarWeekBounds(d);
    const ok =
      /^\d{4}-\d{2}-\d{2}$/.test(b.startDate) &&
      /^\d{4}-\d{2}-\d{2}$/.test(b.endDate) &&
      dayOfWeek(b.startDate) === 1 && // independent oracle: Monday
      dayOfWeek(b.endDate) === 0 && // Sunday
      dayNumber(b.endDate) - dayNumber(b.startDate) === 6 &&
      b.startDate <= d &&
      d <= b.endDate &&
      localCalendarWeekStart(d) === b.startDate;
    if (!ok) bad += 1;
  }
  check(`property sweep over ${sweepSize} consecutive dates (2023-2026): Monday start, Sunday inclusive end, 6 days apart, period contains the date`, bad === 0);
}

// ============================================================
// 2. Provider -- harness with the REAL eligibility chain
// ============================================================
const FAKE_USER = (timezone: string, id = 'u1') => ({ id, timezone }) as User;
const row = (id: string, kind: string | null = 'N_PER_WEEK', target: number | null = 3): CandidateGoalActivityForRhythmDemandRow => ({ goalActivityId: id, goalId: 'g', goalTitle: 'g', title: 't', activityId: null, rhythmKind: kind, rhythmTargetPerWeek: target });
function depsFor(rows: CandidateGoalActivityForRhythmDemandRow[], occurrences: Record<string, GoalActivityRhythmOccurrenceFact[]> = {}) {
  const calls = { discovery: 0, facts: 0 };
  const deps: GoalDemandCandidatesDeps = {
    loadCandidateGoalActivities: async () => {
      calls.discovery += 1;
      return rows;
    },
    loadRhythmFacts: async () => {
      calls.facts += 1;
      return new Map(Object.entries(occurrences));
    },
  };
  return { deps, calls };
}
/** The server-side request exactly as the preview boundary derives it:
 * the planning date comes from the user's own timezone and clock. */
function serverRequest(timezone: string, now: Date, activityIds: string[]): ConstructDayRequest {
  const planningDate = getDatePartsInTimezone(timezone, now).dateStr;
  const parsed = parseConstructDayPreviewRequestBody({ intents: activityIds.map((id) => ({ id: encodeGoalDemandIntentId(planningDate, id), title: id, flexibility: 'FLEXIBLE' })) }, { timezone, now });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.request;
}
const factFor = async (timezone: string, now: Date, activityId: string, rows = [row(activityId)], occurrences: Record<string, GoalActivityRhythmOccurrenceFact[]> = {}) => {
  const request = serverRequest(timezone, now, [activityId]);
  const { deps } = depsFor(rows, occurrences);
  const facts = await loadGoalDecisionFacts(FAKE_USER(timezone), request, deps);
  return { request, recurrence: facts.get(request.intents[0].id)?.recurrence };
};

(async () => {
  // ---- exact emitted contract ----
  {
    const { recurrence, request } = await factFor('UTC', iso('2026-10-06T10:00:00Z'), 'ga-1', [row('ga-1')], { 'ga-1': [{ localDate: '2026-10-05', contribution: 'COMPLETED' }, { localDate: '2026-10-09', contribution: 'COMMITTED' }] });
    check('contract: the emitted fact has exactly period, periodStartDate, periodEndDate, targetPerPeriod, completedInPeriod, committedInPeriod, remainingInPeriod (in that order)', JSON.stringify(recurrence) === JSON.stringify({ period: 'LOCAL_CALENDAR_WEEK', periodStartDate: '2026-10-05', periodEndDate: '2026-10-11', targetPerPeriod: 3, completedInPeriod: 1, committedInPeriod: 1, remainingInPeriod: 1 }));
    check('contract: bounds are plain civil-date strings (not Date/instants)', typeof recurrence?.periodStartDate === 'string' && typeof recurrence?.periodEndDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(recurrence!.periodStartDate) && /^\d{4}-\d{2}-\d{2}$/.test(recurrence!.periodEndDate));
    check('period consistency: periodStartDate <= planning date <= periodEndDate', recurrence!.periodStartDate <= request.targetDate && request.targetDate <= recurrence!.periodEndDate);
    check('fact consistency: remainingInPeriod = max(0, target - completed - committed)', recurrence!.remainingInPeriod === Math.max(0, recurrence!.targetPerPeriod - recurrence!.completedInPeriod - recurrence!.committedInPeriod));
  }

  // ---- SINGLE AUTHORITY: the emitted bounds are the period the counts are taken over ----
  const scenarios: Array<[string, string, Date]> = [
    ['UTC Monday', 'UTC', iso('2026-10-05T00:00:00Z')],
    ['UTC Sunday 23:59:59', 'UTC', iso('2026-10-11T23:59:59Z')],
    ['UTC next Monday 00:00:00', 'UTC', iso('2026-10-12T00:00:00Z')],
    ['positive offset: UTC Sunday is already local Monday (Asia/Kolkata)', 'Asia/Kolkata', iso('2026-10-11T20:00:00Z')],
    ['negative offset: UTC Monday is still local Sunday (America/Los_Angeles)', 'America/Los_Angeles', iso('2026-10-12T03:00:00Z')],
    ['year boundary (Pacific/Auckland, UTC Dec 31 is local Jan 1)', 'Pacific/Auckland', iso('2026-12-31T12:00:00Z')],
    ['leap day (Europe/London)', 'Europe/London', iso('2024-02-29T12:00:00Z')],
    ['DST start week, spring forward Sunday (America/New_York 2026-03-08)', 'America/New_York', iso('2026-03-08T12:00:00Z')],
    ['DST start week, just before the 02:00 gap (America/New_York)', 'America/New_York', iso('2026-03-08T06:59:00Z')],
    ['DST end week, fall back Sunday (America/New_York 2026-11-01)', 'America/New_York', iso('2026-11-01T12:00:00Z')],
    ['DST start Sunday (Australia/Sydney 2026-10-04)', 'Australia/Sydney', iso('2026-10-03T14:30:00Z')],
    ['DST start week (Europe/London 2026-03-29)', 'Europe/London', iso('2026-03-29T12:00:00Z')],
  ];
  for (const [label, tz, now] of scenarios) {
    const planningDate = getDatePartsInTimezone(tz, now).dateStr;
    const utcDate = now.toISOString().slice(0, 10);
    // Occurrences ON the bounds count; the day BEFORE the start and the
    // day AFTER the end do not. The bounds are read from the emitted fact.
    const probe = await factFor(tz, now, 'ga-1');
    const b = probe.recurrence!;
    const occurrences: GoalActivityRhythmOccurrenceFact[] = [
      { localDate: b.periodStartDate, contribution: 'COMPLETED' },
      { localDate: b.periodEndDate, contribution: 'COMMITTED' },
      { localDate: addDaysToDateStr(b.periodStartDate, -1), contribution: 'COMPLETED' },
      { localDate: addDaysToDateStr(b.periodEndDate, 1), contribution: 'COMMITTED' },
    ];
    const { recurrence } = await factFor(tz, now, 'ga-1', [row('ga-1')], { 'ga-1': occurrences });
    const canonical = computeGoalActivityRhythmEligibility({ rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 3 }, planningLocalDate: planningDate, occurrences });
    const dates: string[] = [];
    for (let d = b.periodStartDate; d <= b.periodEndDate; d = addDaysToDateStr(d, 1)) dates.push(d);
    check(`${label}: planning date ${planningDate} in ${b.periodStartDate}..${b.periodEndDate}`, b.periodStartDate <= planningDate && planningDate <= b.periodEndDate);
    check(`${label}: exactly 7 distinct consecutive civil dates, Monday..Sunday`, dates.length === 7 && new Date(`${b.periodStartDate}T00:00:00Z`).getUTCDay() === 1 && new Date(`${b.periodEndDate}T00:00:00Z`).getUTCDay() === 0);
    check(`${label}: single authority -- counts over the emitted bounds (1 completed, 1 committed) match canonical eligibility exactly`, recurrence?.completedInPeriod === 1 && recurrence?.committedInPeriod === 1 && recurrence?.completedInPeriod === canonical.completedThisWeek && recurrence?.committedInPeriod === canonical.committedThisWeek && recurrence?.remainingInPeriod === canonical.remainingOccurrences);
    // Only a distinguishing case when the UTC date and the local date fall in DIFFERENT weeks.
    if (localCalendarWeekStart(utcDate) !== localCalendarWeekStart(planningDate)) check(`${label}: UTC date ${utcDate} and local date ${planningDate} are in different weeks; bounds follow the LOCAL date, not the UTC date`, b.periodStartDate <= planningDate && planningDate <= b.periodEndDate && !(b.periodStartDate <= utcDate && utcDate <= b.periodEndDate));
  }
  {
    const kolkata = (await factFor('Asia/Kolkata', iso('2026-10-11T20:00:00Z'), 'ga-1')).recurrence!;
    const la = (await factFor('America/Los_Angeles', iso('2026-10-12T03:00:00Z'), 'ga-1')).recurrence!;
    check('positive offset: UTC Sunday 2026-10-11 20:00Z is Monday 10-12 01:30 IST -> week 10-12..10-18 (UTC-date derivation would give 10-05..10-11)', kolkata.periodStartDate === '2026-10-12' && kolkata.periodEndDate === '2026-10-18');
    check('negative offset: UTC Monday 2026-10-12 03:00Z is Sunday 10-11 20:00 PDT -> week 10-05..10-11 (UTC-date derivation would give 10-12..10-18)', la.periodStartDate === '2026-10-05' && la.periodEndDate === '2026-10-11');
    const utcBefore = (await factFor('UTC', iso('2026-10-11T23:59:59Z'), 'ga-1')).recurrence!;
    const utcAfter = (await factFor('UTC', iso('2026-10-12T00:00:00Z'), 'ga-1')).recurrence!;
    check('UTC is a valid planning zone: 23:59:59 Sunday -> 10-05..10-11', utcBefore.periodStartDate === '2026-10-05' && utcBefore.periodEndDate === '2026-10-11');
    check('UTC: 00:00:00 the next Monday -> 10-12..10-18', utcAfter.periodStartDate === '2026-10-12' && utcAfter.periodEndDate === '2026-10-18');
    const ny = (await factFor('America/New_York', iso('2026-03-08T12:00:00Z'), 'ga-1')).recurrence!;
    check('DST week (NY spring forward Sun 2026-03-08): bounds are the civil Monday 03-02 .. Sunday 03-08, not a 7x24h UTC span', ny.periodStartDate === '2026-03-02' && ny.periodEndDate === '2026-03-08');
    const nyFall = (await factFor('America/New_York', iso('2026-11-01T12:00:00Z'), 'ga-1')).recurrence!;
    check('DST week (NY fall back Sun 2026-11-01): 10-26..11-01', nyFall.periodStartDate === '2026-10-26' && nyFall.periodEndDate === '2026-11-01');
  }

  // ---- cross-user: same instant, different authoritative timezones ----
  {
    const now = iso('2026-10-11T20:00:00Z');
    const a = (await factFor('Asia/Kolkata', now, 'ga-1')).recurrence!;
    const b = (await factFor('America/Los_Angeles', now, 'ga-1')).recurrence!;
    check('cross-user: the same instant yields each user\'s OWN local week (Kolkata 10-12..10-18, Los Angeles 10-05..10-11), no leakage', a.periodStartDate === '2026-10-12' && b.periodStartDate === '2026-10-05' && a.periodEndDate === '2026-10-18' && b.periodEndDate === '2026-10-11');
  }

  // ---- multiple goals / non-recurrent / zero remaining / math equivalence ----
  {
    const now = iso('2026-10-07T09:00:00Z');
    const request = serverRequest('UTC', now, ['ga-a', 'ga-b', 'ga-c', 'ga-none', 'ga-full']);
    const { deps, calls } = depsFor(
      [row('ga-a', 'N_PER_WEEK', 2), row('ga-b', 'N_PER_WEEK', 5), row('ga-c', 'N_PER_WEEK', 7), row('ga-none', null, null), row('ga-full', 'N_PER_WEEK', 1)],
      {
        'ga-a': [{ localDate: '2026-10-05', contribution: 'COMPLETED' }],
        'ga-b': [{ localDate: '2026-10-08', contribution: 'COMMITTED' }, { localDate: '2026-09-30', contribution: 'COMPLETED' }],
        'ga-full': [{ localDate: '2026-10-06', contribution: 'COMPLETED' }],
      }
    );
    const facts = await loadGoalDecisionFacts(FAKE_USER('UTC'), request, deps);
    const idOf = (a: string) => request.intents.find((i) => i.title === a)!.id;
    const fa = facts.get(idOf('ga-a'))?.recurrence;
    const fb = facts.get(idOf('ga-b'))?.recurrence;
    const fc = facts.get(idOf('ga-c'))?.recurrence;
    check('multiple goals: every eligible recurrence fact carries the same week bounds', [fa, fb, fc].every((f) => f?.periodStartDate === '2026-10-05' && f?.periodEndDate === '2026-10-11'));
    check('math unchanged: ga-a (target 2, 1 completed) -> 1 remaining; ga-b (target 5, 1 committed, last-week completion ignored) -> 4; ga-c untouched -> 7', fa?.remainingInPeriod === 1 && fa?.completedInPeriod === 1 && fb?.remainingInPeriod === 4 && fb?.committedInPeriod === 1 && fb?.completedInPeriod === 0 && fc?.remainingInPeriod === 7);
    check('non-recurrent (rhythmKind null) receives no recurrence period facts', !facts.has(idOf('ga-none')));
    check('zero remaining: an exhausted activity stays excluded upstream -- no fact, no bounds', !facts.has(idOf('ga-full')));
    check('query count unchanged: one discovery + one batched facts call for the whole request', calls.discovery === 1 && calls.facts === 1);
    const legacyShape = (f: NonNullable<typeof fa>) => ({ period: f.period, targetPerPeriod: f.targetPerPeriod, completedInPeriod: f.completedInPeriod, committedInPeriod: f.committedInPeriod, remainingInPeriod: f.remainingInPeriod });
    check('recurrence math is byte-identical to the pre-O3 shape once the two bound fields are removed', JSON.stringify(legacyShape(fa!)) === JSON.stringify({ period: 'LOCAL_CALENDAR_WEEK', targetPerPeriod: 2, completedInPeriod: 1, committedInPeriod: 0, remainingInPeriod: 1 }));
  }
  {
    // the pure translate function: bounds come from the planning date it is given
    const c = { goalActivityId: 'ga-1', goalId: 'g', goalTitle: 'g', title: 't', activityId: null, remainingThisWeek: 2, rhythm: { targetPerWeek: 3, completedThisWeek: 1, committedThisWeek: 0, remainingOccurrences: 2 } } as GoalDemandCandidate;
    const out = translateGoalDemandToDecisionFacts([c], '2026-12-31', new Set([encodeGoalDemandIntentId('2026-12-31', 'ga-1')]));
    const f = out.get(encodeGoalDemandIntentId('2026-12-31', 'ga-1'))!.recurrence!;
    check('translate: year-crossing planning date yields 2026-12-28..2027-01-03', f.periodStartDate === '2026-12-28' && f.periodEndDate === '2027-01-03');
    check('translate: no candidates -> no facts (and no bound computation)', translateGoalDemandToDecisionFacts([], 'not-a-date', new Set()).size === 0);
  }

  // ---- failure behavior + zero queries for an empty request ----
  {
    const failing: GoalDemandCandidatesDeps = {
      loadCandidateGoalActivities: async () => {
        throw new Error('db down');
      },
      loadRhythmFacts: async () => new Map(),
    };
    const out = await loadGoalDecisionFacts(FAKE_USER('UTC'), serverRequest('UTC', iso('2026-10-07T09:00:00Z'), ['ga-1']), failing);
    check('provider failure: a failed Goal-demand load still yields NO facts (bound derivation adds no new failure mode)', out.size === 0);
    const { deps, calls } = depsFor([row('ga-1')]);
    const none = await loadGoalDecisionFacts(FAKE_USER('UTC'), { ...serverRequest('UTC', iso('2026-10-07T09:00:00Z'), ['ga-1']), intents: [] }, deps);
    check('an intent-less request performs zero queries and emits nothing', none.size === 0 && calls.discovery === 0 && calls.facts === 0);
  }

  // ---- forged client bounds through the REAL preview handler ----
  {
    const orchestratorDeps: DayConstructorOrchestratorDeps = {
      loadBlockingPlans: async () => [],
      loadDurationContext: async () => ({ preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} }),
      searchTiming: () => ({ candidates: [] }),
      loadAvailabilityConfiguration: async () => ({ configured: false, periods: [] }),
    };
    const NOW = iso('2026-10-07T09:00:00Z');
    const id = encodeGoalDemandIntentId('2026-10-07', 'ga-1');
    const forged = { recurrence: { period: 'LOCAL_CALENDAR_WEEK', periodStartDate: '1999-01-04', periodEndDate: '1999-01-10', targetPerPeriod: 99, completedInPeriod: 0, committedInPeriod: 0, remainingInPeriod: 99 } };
    const body = {
      constructionWindowSource: 'EXPLICIT_RANGE',
      explicitStart: '2026-10-07T09:00:00Z',
      explicitEnd: '2026-10-07T17:00:00Z',
      periodStartDate: '1999-01-04',
      periodEndDate: '1999-01-10',
      timezone: 'Pacific/Kiritimati',
      decisionFactsByIntentId: { [id]: forged },
      decisionFacts: forged,
      intents: [{ id, title: 'ga-1', flexibility: 'FLEXIBLE', durationMinutes: 30, decisionFacts: forged, periodStartDate: '1999-01-04', periodEndDate: '1999-01-10' }],
    };
    const { deps } = depsFor([row('ga-1')]);
    const result = await runDayConstructorPreview(body, 'UTC', NOW, orchestratorDeps, (request) => loadGoalDecisionFacts(FAKE_USER('UTC'), request, deps));
    const resolved = JSON.parse(JSON.stringify(result.body)).preview.resolvedIntents.find((r: any) => r.requestedIntentId === id);
    const f = resolved?.dayIntent?.decisionFacts?.recurrence;
    check('forged client bounds / counts / timezone are ignored: the emitted fact is server-derived (2026-10-05..2026-10-11, target 3)', f?.periodStartDate === '2026-10-05' && f?.periodEndDate === '2026-10-11' && f?.targetPerPeriod === 3 && f?.remainingInPeriod === 3);
    const withoutProvider = await runDayConstructorPreview(body, 'UTC', NOW, orchestratorDeps);
    const r2 = JSON.parse(JSON.stringify(withoutProvider.body)).preview.resolvedIntents.find((r: any) => r.requestedIntentId === id);
    check('forged client bounds with NO provider: the intent carries no facts at all (the forged values are never authoritative)', r2?.dayIntent?.decisionFacts === undefined);
  }

  if (!allPassed) {
    console.error('SOME RECURRENCE PERIOD BOUNDS CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL RECURRENCE PERIOD BOUNDS CHECKS PASSED');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
