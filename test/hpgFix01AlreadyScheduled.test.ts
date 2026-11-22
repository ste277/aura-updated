// AURA-HPG-FIX-01 (V1-05) -- Home and Plan My Day must not present an
// actionable "today" recommendation for a goal activity whose once-per-day
// session already exists today (planned or completed). The acceptance-time
// guard (DAILY_CAPACITY_EXCEEDED, HTTP 409) is unchanged and remains the
// final safeguard; this only stops the UI offering what it would refuse.
//
// Staging repro (HPG5-V1): after scheduling (and later completing) today's
// "HPG5 evening run", Home still offered "Just today" and Plan My Day's
// "Aura suggests" still offered it for today; accepting returned 409.
import { loadEligibleGoalDemand, isDayOccupiedForGoalActivity, type GoalDemandCandidatesDeps } from '../apps/web/lib/goalDemandCandidates';
import { resolveAutomaticGoalDemand, type AutomaticGoalDemandBootstrapDeps } from '../apps/web/lib/planDayBootstrap';
import { mapGoalDemandToHomeRhythmSuggestions, resolveGoalRhythmCardActions } from '../apps/web/lib/homeGoalRhythmSuggestions';
import { shouldOfferWeeklyReview } from '../apps/web/lib/weeklyPlanReviewClient';
import type { CandidateGoalActivityForRhythmDemandRow } from '../apps/web/lib/db';
import type { GoalActivityRhythmOccurrenceFact } from '../apps/web/lib/goalActivityRhythm';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const TODAY = '2026-11-21';
const TOMORROW = '2026-11-22';

function row(overrides: Partial<CandidateGoalActivityForRhythmDemandRow> & { goalActivityId: string }): CandidateGoalActivityForRhythmDemandRow {
  return { goalId: 'goal-run', goalTitle: 'Run 3x weekly', title: 'Evening run', activityId: null, rhythmKind: 'N_PER_WEEK', rhythmTargetPerWeek: 3, ...overrides };
}

// Week facts as the real loader produces them: `localDate` is the scheduled
// WEEK start (Monday 2026-11-16), never the session day.
const WEEK_START = '2026-11-16';
function weekFact(contribution: GoalActivityRhythmOccurrenceFact['contribution']): GoalActivityRhythmOccurrenceFact {
  return { localDate: WEEK_START, contribution };
}

function deps(
  rows: CandidateGoalActivityForRhythmDemandRow[],
  facts: Record<string, GoalActivityRhythmOccurrenceFact[]>,
  occupancy: Record<string, string[]> | 'THROWS' | 'NOT_WIRED',
  frequencies: Record<string, { kind: string | null; limit: number | null }> = {}
): GoalDemandCandidatesDeps {
  const base: GoalDemandCandidatesDeps = {
    loadCandidateGoalActivities: async () => rows,
    loadRhythmFacts: async () => new Map(Object.entries(facts)),
  };
  if (occupancy === 'NOT_WIRED') return base;
  return {
    ...base,
    loadDailyOccupancy: async () => {
      if (occupancy === 'THROWS') throw new Error('occupancy read failed');
      return new Map(Object.entries(occupancy).map(([id, days]) => [id, { days: new Set(days), dailyFrequencyKind: frequencies[id]?.kind ?? null, dailyFrequencyLimit: frequencies[id]?.limit ?? null }]));
    },
  };
}

async function main() {
  // ---------- 1. Pure gate ----------
  const occ = (kind: string | null, limit: number | null = null) => ({ days: new Set([TODAY]), dailyFrequencyKind: kind, dailyFrequencyLimit: limit });
  check('1. ONCE_PER_DAY (null kind) + session today -> occupied', isDayOccupiedForGoalActivity(occ(null), TODAY));
  check('1. explicit ONCE_PER_DAY + session today -> occupied', isDayOccupiedForGoalActivity(occ('ONCE_PER_DAY'), TODAY));
  check('1. same activity, a different day -> not occupied', !isDayOccupiedForGoalActivity(occ(null), TOMORROW));
  check('1. MULTIPLE_PER_DAY is never blocked by an existing session', !isDayOccupiedForGoalActivity(occ('MULTIPLE_PER_DAY'), TODAY));
  check('1. CUSTOM (reserved, not enforceable) is never blocked', !isDayOccupiedForGoalActivity(occ('CUSTOM', 2), TODAY));
  check('1. an invalid persisted pair normalizes to ONCE_PER_DAY, same as the write guard', isDayOccupiedForGoalActivity(occ('MULTIPLE_PER_DAY', 3), TODAY));
  check('1. no occupancy entry -> not occupied', !isDayOccupiedForGoalActivity(undefined, TODAY));

  // ---------- 2. Read model ----------
  {
    const rows = [row({ goalActivityId: 'ga-run' }), row({ goalActivityId: 'ga-med', title: 'Meditate', rhythmTargetPerWeek: 2 })];
    const facts = { 'ga-run': [weekFact('COMPLETED')] };
    const result = await loadEligibleGoalDemand(deps(rows, facts, { 'ga-run': [TODAY] }), 'u1', TODAY, TZ);
    const run = result.status === 'OK' ? result.candidates.find((c) => c.goalActivityId === 'ga-run') : undefined;
    const med = result.status === 'OK' ? result.candidates.find((c) => c.goalActivityId === 'ga-med') : undefined;
    check('2. activity with today\'s session is still weekly-eligible (2 remaining)', run?.remainingThisWeek === 2);
    check('2. ...and flagged scheduledOnPlanningDate', run?.scheduledOnPlanningDate === true);
    check('2. activity with nothing today -> scheduledOnPlanningDate false', med?.scheduledOnPlanningDate === false);

    const tomorrow = await loadEligibleGoalDemand(deps(rows, facts, { 'ga-run': [TODAY] }), 'u1', TOMORROW, TZ);
    const runTomorrow = tomorrow.status === 'OK' ? tomorrow.candidates.find((c) => c.goalActivityId === 'ga-run') : undefined;
    check('2. planning for tomorrow: today\'s session does not block', runTomorrow?.scheduledOnPlanningDate === false);

    const legacy = await loadEligibleGoalDemand(deps(rows, facts, 'NOT_WIRED'), 'u1', TODAY, TZ);
    check('2. occupancy loader not wired -> field absent (legacy shape unchanged)', legacy.status === 'OK' && legacy.candidates.every((c) => !('scheduledOnPlanningDate' in c)));

    const failed = await loadEligibleGoalDemand(deps(rows, facts, 'THROWS'), 'u1', TODAY, TZ);
    check('2. occupancy read failure degrades to "no hint", never LOAD_FAILED', failed.status === 'OK' && failed.candidates.length === 2 && failed.candidates.every((c) => !('scheduledOnPlanningDate' in c)));

    const multi = await loadEligibleGoalDemand(deps([row({ goalActivityId: 'ga-run' })], facts, { 'ga-run': [TODAY] }, { 'ga-run': { kind: 'MULTIPLE_PER_DAY', limit: null } }), 'u1', TODAY, TZ);
    check('2. MULTIPLE_PER_DAY activity is not flagged', multi.status === 'OK' && multi.candidates[0]?.scheduledOnPlanningDate === false);
  }

  // ---------- 3. Plan My Day "Aura suggests" ----------
  {
    const rows = [row({ goalActivityId: 'ga-run' }), row({ goalActivityId: 'ga-med', title: 'Meditate', rhythmTargetPerWeek: 2 })];
    const base = deps(rows, {}, { 'ga-run': [TODAY] });
    const bootstrapDeps: AutomaticGoalDemandBootstrapDeps = { ...base, getSessionToken: () => 'tok', verifySession: () => ({ userId: 'u1' }) };
    const auto = await resolveAutomaticGoalDemand(bootstrapDeps, TODAY, TZ, []);
    check('3. already-scheduled-today activity is NOT offered in Aura suggests', auto.status === 'OK' && !auto.suggestions.some((s) => s.goalActivityId === 'ga-run'));
    check('3. other eligible activities are still offered', auto.status === 'OK' && auto.suggestions.some((s) => s.goalActivityId === 'ga-med'));

    const manual = await resolveAutomaticGoalDemand(bootstrapDeps, TODAY, TZ, ['ga-run']);
    check('3. an explicit manual handoff is still recognised (server guard decides, not hidden)', manual.status === 'OK' && manual.manualCanonicalGoalActivityIds.includes('ga-run'));

    const autoTomorrow = await resolveAutomaticGoalDemand(bootstrapDeps, TOMORROW, TZ, []);
    check('3. planning tomorrow still offers it', autoTomorrow.status === 'OK' && autoTomorrow.suggestions.some((s) => s.goalActivityId === 'ga-run'));
  }

  // ---------- 4. Home rhythm card actions ----------
  {
    const result = await loadEligibleGoalDemand(deps([row({ goalActivityId: 'ga-run' })], { 'ga-run': [weekFact('COMPLETED')] }, { 'ga-run': [TODAY] }), 'u1', TODAY, TZ);
    const [suggestion] = result.status === 'OK' ? mapGoalDemandToHomeRhythmSuggestions(result.candidates) : [];
    check('4. Home suggestion carries scheduledToday', suggestion?.scheduledToday === true);

    const two = resolveGoalRhythmCardActions({ remainingThisWeek: 2, scheduledToday: true }, shouldOfferWeeklyReview(2));
    check('4. scheduled today, 2 remaining -> no "Just today", weekly review primary', two.todayHandoff === null && two.weeklyReview && two.primaryLabel === 'Plan remaining 2');
    check('4. scheduled today -> explanatory note shown', two.scheduledTodayNote === "Today's session is already planned.");

    const one = resolveGoalRhythmCardActions({ remainingThisWeek: 1, scheduledToday: true }, shouldOfferWeeklyReview(1));
    check('4. scheduled today, 1 remaining -> "Plan another day" (weekly review), never "Plan it" for today', one.todayHandoff === null && one.weeklyReview && one.primaryLabel === 'Plan another day');

    const free2 = resolveGoalRhythmCardActions({ remainingThisWeek: 2 }, shouldOfferWeeklyReview(2));
    check('4. not scheduled today, 2 remaining -> unchanged ("Just today" + "Plan remaining 2")', free2.todayHandoff === 'JUST_TODAY' && free2.weeklyReview && free2.primaryLabel === 'Plan remaining 2' && free2.scheduledTodayNote === null);
    const free1 = resolveGoalRhythmCardActions({ remainingThisWeek: 1, scheduledToday: false }, shouldOfferWeeklyReview(1));
    check('4. not scheduled today, 1 remaining -> unchanged single "Plan it"', free1.todayHandoff === 'PLAN_IT' && !free1.weeklyReview && free1.primaryLabel === 'Plan it');
  }

  if (!allPassed) {
    console.error('\nhpgFix01AlreadyScheduled: FAILED');
    process.exit(1);
  }
  console.log('\nhpgFix01AlreadyScheduled: all checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
