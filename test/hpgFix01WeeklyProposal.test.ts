// AURA-HPG-FIX-01 -- the weekly plan dialog ("Plan remaining N") must only
// propose sessions that weekly acceptance could actually accept.
//
// Staging repro (HPG5-V1, Sat 2026-11-21 ~18:30 IST): after today's run was
// completed, the dialog proposed "Saturday 6:26 PM" -- a time that had
// already started, overlapped an existing 6:26-7:11 PM plan, and fell on a
// day that already had this activity's completed session. Acceptance then
// refused it ("That time has already passed").
//
// Root causes:
//  (a) no elapsed-time filter on proposals;
//  (b) no existing-plan overlap filter on proposals;
//  (c) the "occupied day" seed read the rhythm fact `localDate`, which is the
//      occurrence's scheduled WEEK start (Monday), never the session day.
// Server-side acceptance validation is unchanged and still the final gate.
import {
  generateWeeklyRhythmProposal,
  filterProposableCandidates,
  type WeeklyRhythmProposalDeps,
  type WeeklyRhythmProposalResult,
} from '../apps/web/lib/goalRhythmWeeklyProposal';
import type { CandidateGoalActivityForRhythmDemandRow } from '../apps/web/lib/db';
import type { GoalActivityRhythmOccurrenceFact } from '../apps/web/lib/goalActivityRhythm';
import type { PlanBlockerCandidate } from '../apps/web/lib/planBlockerLifecycle';
import type { AvailabilityConfiguration } from '../apps/web/lib/availabilityContext';
import type { TimingCandidate, TimingSearchRequest } from '../packages/recommendation/src/timingSearch';
import type { TimingSearchResponseWithDailyRhythm } from '../apps/web/lib/timingSearchDailyRhythm';
import type { DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
// Sat 2026-11-21 18:30 IST
const NOW = new Date('2026-11-21T13:00:00.000Z');
const TODAY = '2026-11-21';

function cand(startIso: string, minutes: number, score: number): TimingCandidate {
  const end = new Date(new Date(startIso).getTime() + minutes * 60_000).toISOString();
  return { start: startIso, end, score, label: 'GOOD', muhurtaScore: 0, reasons: [], metadata: { windowType: 'NEUTRAL' as never, windowLabel: '', activityType: 'Workout', dateLabel: startIso.slice(0, 10) } };
}
function plan(startIso: string, endIso: string, status: PlanBlockerCandidate['status']): PlanBlockerCandidate {
  return { start: new Date(startIso), end: new Date(endIso), status };
}

// 18:26 IST today (already started), 19:00 IST today, Sun 11:45 IST, Mon 07:00 IST
const PAST_TODAY = cand('2026-11-21T12:56:00.000Z', 45, 9.5);
const LATER_TODAY = cand('2026-11-21T13:30:00.000Z', 30, 9.0);
const SUN = cand('2026-11-22T06:15:00.000Z', 45, 8.0);
const SUN_LATE = cand('2026-11-22T14:00:00.000Z', 45, 7.5);

// ---------- 1. Pure filter ----------
{
  const out = filterProposableCandidates([PAST_TODAY, LATER_TODAY, SUN], { now: NOW, timezone: TZ, blockers: [], availability: null });
  check('1. an already-started time is never proposable', !out.includes(PAST_TODAY));
  check('1. a start exactly at now is not proposable (acceptance uses start <= now)', filterProposableCandidates([cand(NOW.toISOString(), 30, 9)], { now: NOW, timezone: TZ, blockers: [], availability: null }).length === 0);
  check('1. future candidates kept in original ranking order', out.length === 2 && out[0] === LATER_TODAY && out[1] === SUN);
}
{
  // existing 6:26-7:11 PM plan (UPCOMING, still running) overlaps 19:00-19:30 IST
  const blockers = [plan('2026-11-21T12:56:00.000Z', '2026-11-21T13:41:00.000Z', 'UPCOMING')];
  const out = filterProposableCandidates([LATER_TODAY, SUN], { now: NOW, timezone: TZ, blockers, availability: null });
  check('1. overlap with an active UPCOMING plan is excluded', !out.includes(LATER_TODAY) && out.includes(SUN));
  const logged = filterProposableCandidates([SUN], { now: NOW, timezone: TZ, blockers: [plan('2026-11-22T06:00:00.000Z', '2026-11-22T06:30:00.000Z', 'LOGGED')], availability: null });
  check('1. overlap with a LOGGED (completed) plan is excluded, same as the constructor', logged.length === 0);
  const inactive = filterProposableCandidates([SUN], { now: NOW, timezone: TZ, blockers: [plan('2026-11-22T06:00:00.000Z', '2026-11-22T06:30:00.000Z', 'SKIPPED'), plan('2026-11-22T06:00:00.000Z', '2026-11-22T06:30:00.000Z', 'CANCELLED'), plan('2026-11-22T06:00:00.000Z', '2026-11-22T06:30:00.000Z', 'MOVED')], availability: null });
  check('1. SKIPPED / CANCELLED / MOVED plans never block', inactive.length === 1);
  const touching = filterProposableCandidates([SUN], { now: NOW, timezone: TZ, blockers: [plan('2026-11-22T05:45:00.000Z', '2026-11-22T06:15:00.000Z', 'UPCOMING')], availability: null });
  check('1. a plan ending exactly at the candidate start does not overlap (half-open)', touching.length === 1);
}
{
  // Availability configured: Sunday 17:00-21:00 IST only.
  const availability: AvailabilityConfiguration = { configured: true, periods: [{ weekday: 0, startTime: '17:00', endTime: '21:00' }] };
  const out = filterProposableCandidates([SUN, SUN_LATE], { now: NOW, timezone: TZ, blockers: [], availability });
  check('1. outside configured availability is excluded; inside is kept', !out.includes(SUN) && out.includes(SUN_LATE));
  const unconfigured = filterProposableCandidates([SUN], { now: NOW, timezone: TZ, blockers: [], availability: { configured: false, periods: [] } });
  check('1. unconfigured availability imposes no boundary (same as acceptance)', unconfigured.length === 1);
}

// ---------- 2. End to end through generateWeeklyRhythmProposal ----------
function row(): CandidateGoalActivityForRhythmDemandRow {
  return { goalActivityId: 'ga-run', goalId: 'goal-run', goalTitle: 'Run 3x weekly', title: 'Evening run', activityId: null, rhythmKind: 'N_PER_WEEK', rhythmTargetPerWeek: 3 };
}
const CONTEXT: DailyAssistantContext = { now: NOW, latitude: 13.08, longitude: 80.27, timezone: TZ, tzOffsetMinutes: 330 };

function depsWith(opts: { ranked: TimingCandidate[]; occupancy?: string[]; blockers?: PlanBlockerCandidate[]; availability?: AvailabilityConfiguration; failBlockers?: boolean }): WeeklyRhythmProposalDeps {
  // Real-loader shape: the completed session's fact carries the WEEK start.
  const facts = new Map<string, GoalActivityRhythmOccurrenceFact[]>([['ga-run', [{ localDate: '2026-11-16', contribution: 'COMPLETED' }]]]);
  return {
    loadCandidateGoalActivities: async () => [row()],
    loadRhythmFacts: async () => facts,
    ...(opts.occupancy ? { loadDailyOccupancy: async () => new Map([['ga-run', { days: new Set(opts.occupancy), dailyFrequencyKind: null, dailyFrequencyLimit: null }]]) } : {}),
    runFind: (_request: TimingSearchRequest): TimingSearchResponseWithDailyRhythm => ({ mode: 'FIND', candidates: opts.ranked }),
    loadBlockingPlans: async () => {
      if (opts.failBlockers) throw new Error('blockers failed');
      return opts.blockers ?? [];
    },
    ...(opts.availability ? { loadAvailabilityConfiguration: async () => opts.availability! } : {}),
  };
}
async function run(deps: WeeklyRhythmProposalDeps): Promise<WeeklyRhythmProposalResult> {
  return generateWeeklyRhythmProposal(deps, { userId: 'u1', goalActivityId: 'ga-run', planningLocalDate: TODAY, timezone: TZ, context: CONTEXT, dailyRhythmPrefs: { workStart: null, workEnd: null, workDays: [] } });
}

async function main() {
  {
    // The staging scenario: today already has the completed run; the
    // top-ranked slot already started and overlaps an existing plan.
    const result = await run(depsWith({
      ranked: [PAST_TODAY, LATER_TODAY, SUN],
      occupancy: [TODAY],
      blockers: [plan('2026-11-21T12:56:00.000Z', '2026-11-21T13:41:00.000Z', 'UPCOMING')],
    }));
    const dates = result.status === 'OK' ? result.proposals.map((p) => p.localDate) : [];
    check('2. staging repro: no proposal for today (completed session already that day)', result.status === 'OK' && !dates.includes(TODAY));
    check('2. staging repro: no elapsed or overlapping time proposed', result.status === 'OK' && result.proposals.every((p) => p.start !== PAST_TODAY.start && p.start !== LATER_TODAY.start));
    check('2. staging repro: the valid Sunday slot is still proposed', result.status === 'OK' && result.proposals.some((p) => p.start === SUN.start));
    check('2. fewer valid days than remaining -> honest shortfall', result.status === 'OK' && result.requestedCount === 2 && result.proposals.length === 1 && result.shortfallReason === 'FEWER_SUITABLE_DAYS_THAN_REQUESTED');
  }
  {
    // Without the daily-occupancy fix the week-start fact (Monday) would be
    // the only "occupied" day, so today would wrongly remain proposable.
    const result = await run(depsWith({ ranked: [LATER_TODAY, SUN], occupancy: [TODAY] }));
    check('2. day occupancy comes from the session day, not the week-start fact', result.status === 'OK' && result.proposals.length === 1 && result.proposals[0].localDate === '2026-11-22');
  }
  {
    const result = await run(depsWith({ ranked: [LATER_TODAY, SUN], occupancy: [] }));
    check('2. no session today and no conflicts -> today and Sunday both proposed', result.status === 'OK' && result.proposals.length === 2);
  }
  {
    const result = await run(depsWith({ ranked: [LATER_TODAY, SUN], occupancy: [], failBlockers: true }));
    check('2. existing-plan load failure -> SEARCH_FAILED, never unfiltered proposals', result.status === 'SEARCH_FAILED');
  }
  {
    const availability: AvailabilityConfiguration = { configured: true, periods: [{ weekday: 0, startTime: '17:00', endTime: '21:00' }] };
    const result = await run(depsWith({ ranked: [SUN, SUN_LATE], occupancy: [], availability }));
    check('2. configured availability respected end to end', result.status === 'OK' && result.proposals.length === 1 && result.proposals[0].start === SUN_LATE.start);
  }

  if (!allPassed) {
    console.error('\nhpgFix01WeeklyProposal: FAILED');
    process.exit(1);
  }
  console.log('\nhpgFix01WeeklyProposal: all checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
