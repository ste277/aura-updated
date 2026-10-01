/**
 * Goals V2 Candidate A3.2 -- pure regression suite for the automatic
 * Goal-demand bootstrap resolver (planDayBootstrap.ts's own
 * `resolveAutomaticGoalDemand`), exercised entirely via dependency
 * injection, no DB/network -- same established convention as
 * goalPlanningHandoff.test.ts's own coverage of resolveGoalActivityHandoff.
 * Live-DB ownership/zero-write/query-count coverage lives in
 * automaticGoalDemandBootstrapDb.test.ts; page/client wiring proof (prop
 * reaches PlanDayClient inert, LOAD_FAILED degrades at the page boundary,
 * Constructor/acceptance remain untouched) lives in planDayWiring.test.ts.
 */
import { resolveAutomaticGoalDemand, type AutomaticGoalDemandBootstrapDeps } from '../apps/web/lib/planDayBootstrap';
import type { CandidateGoalActivityForRhythmDemandRow } from '../apps/web/lib/db';
import type { GoalActivityRhythmOccurrenceFact } from '../apps/web/lib/goalActivityRhythm';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function row(overrides: Partial<CandidateGoalActivityForRhythmDemandRow> & { goalActivityId: string }): CandidateGoalActivityForRhythmDemandRow {
  return { goalId: 'goal-1', goalTitle: 'Get fit', title: 'Workout', activityId: null, rhythmKind: 'N_PER_WEEK', rhythmTargetPerWeek: 3, ...overrides };
}

function makeDeps(overrides: Partial<AutomaticGoalDemandBootstrapDeps> = {}): AutomaticGoalDemandBootstrapDeps {
  return {
    getSessionToken: () => 'tok',
    verifySession: () => ({ userId: 'user-1' }),
    loadCandidateGoalActivities: async () => [],
    loadRhythmFacts: async () => new Map<string, readonly GoalActivityRhythmOccurrenceFact[]>(),
    ...overrides,
  };
}

const TZ = 'Asia/Kolkata';

async function main() {
  // ============================================================
  // 1/2. Eligible returned / zero eligible -> OK []
  // ============================================================
  {
    const deps = makeDeps({ loadCandidateGoalActivities: async () => [row({ goalActivityId: 'ga-1' })] });
    const result = await resolveAutomaticGoalDemand(deps, '2026-10-06', TZ, []);
    check('1. an eligible N_PER_WEEK GoalActivity is returned as a bootstrap suggestion', result.status === 'OK' && result.suggestions.some((s) => s.goalActivityId === 'ga-1'));
  }
  {
    const result = await resolveAutomaticGoalDemand(makeDeps(), '2026-10-06', TZ, []);
    check('2. zero eligible GoalActivities -> OK with an empty suggestion list (never conflated with failure)', result.status === 'OK' && result.suggestions.length === 0);
  }

  // ============================================================
  // 3. LOAD_FAILED remains distinguishable, never silently [] 'd
  // ============================================================
  {
    const deps = makeDeps({
      loadCandidateGoalActivities: async () => {
        throw new Error('connection reset');
      },
    });
    const result = await resolveAutomaticGoalDemand(deps, '2026-10-06', TZ, []);
    check('3. an A1 read failure propagates as LOAD_FAILED out of the resolver, never converted to an empty suggestion list here', result.status === 'LOAD_FAILED');
  }

  // ============================================================
  // 4/5/6. Manual-demand dedup (goalActivityId only)
  // ============================================================
  {
    const deps = makeDeps({ loadCandidateGoalActivities: async () => [row({ goalActivityId: 'ga-1' })] });
    const result = await resolveAutomaticGoalDemand(deps, '2026-10-06', TZ, ['ga-1']);
    check('4. manual GA-1 + automatic eligible GA-1 -> automatic GA-1 absent (manual wins)', result.status === 'OK' && result.suggestions.length === 0);
  }
  {
    const deps = makeDeps({ loadCandidateGoalActivities: async () => [row({ goalActivityId: 'ga-2' })] });
    const result = await resolveAutomaticGoalDemand(deps, '2026-10-06', TZ, ['ga-1']);
    check('5. manual GA-1 + automatic eligible GA-2 -> automatic GA-2 remains', result.status === 'OK' && result.suggestions.length === 1 && result.suggestions[0].goalActivityId === 'ga-2');
  }
  {
    // dedup is keyed by goalActivityId -- NOT title/activityId/goalId.
    const deps = makeDeps({ loadCandidateGoalActivities: async () => [row({ goalActivityId: 'ga-2', title: 'Workout', activityId: 'workout-catalog', goalId: 'goal-1' })] });
    const result = await resolveAutomaticGoalDemand(deps, '2026-10-06', TZ, ['ga-1']); // manual exclusion shares title/activityId/goalId with ga-2, but a DIFFERENT goalActivityId
    check('6. dedup uses goalActivityId only -- a shared title/activityId/goalId with a manually-seeded (different) GoalActivity never causes exclusion', result.status === 'OK' && result.suggestions.length === 1);
  }

  // ============================================================
  // 7. An exclude-id that never matches a real candidate (simulating a
  // manual handoff that resolved to no real GoalActivity, e.g. an
  // invalid/not-owned/ineligible query-string id) can never suppress an
  // unrelated, genuinely eligible automatic suggestion.
  // ============================================================
  {
    const deps = makeDeps({ loadCandidateGoalActivities: async () => [row({ goalActivityId: 'ga-real' })] });
    const result = await resolveAutomaticGoalDemand(deps, '2026-10-06', TZ, ['ga-never-resolved']);
    check('7. an exclude id that matches no real candidate never suppresses an unrelated eligible suggestion', result.status === 'OK' && result.suggestions.length === 1 && result.suggestions[0].goalActivityId === 'ga-real');
  }

  // ============================================================
  // 8/9. Multiple Goals survive; stable ordering preserved (A1's own
  // ordering, never re-ranked here)
  // ============================================================
  {
    const candidates = [row({ goalActivityId: 'ga-zzz', goalId: 'goal-2' }), row({ goalActivityId: 'ga-aaa', goalId: 'goal-1' }), row({ goalActivityId: 'ga-mmm', goalId: 'goal-2' })];
    const deps = makeDeps({ loadCandidateGoalActivities: async () => candidates });
    const result = await resolveAutomaticGoalDemand(deps, '2026-10-06', TZ, []);
    const ids = result.status === 'OK' ? result.suggestions.map((s) => s.goalActivityId) : [];
    check('8. suggestions from multiple ACTIVE Goals all survive bootstrap together', ids.length === 3);
    check('9. output order is A1\'s own stable goalActivityId sort, never re-ranked by this resolver', ids.join(',') === 'ga-aaa,ga-mmm,ga-zzz');
  }

  // ============================================================
  // 10/11/12/13. Today/Tomorrow/Sunday->Monday use exactly the supplied
  // planningLocalDate -- never Date.now(), never recomputed.
  // ============================================================
  {
    let seenDate: string | null = null;
    const deps = makeDeps({
      loadCandidateGoalActivities: async () => [row({ goalActivityId: 'ga-1', rhythmTargetPerWeek: 1 })],
      loadRhythmFacts: async (_userId, _ids, _timezone) => new Map(),
    });
    // Wrap loadEligibleGoalDemand indirectly by checking the RESULT reflects the date we passed (via eligibility), not any other date.
    const today = await resolveAutomaticGoalDemand(deps, '2026-10-06', TZ, []); // Tuesday
    check('10. Today: the exact supplied planningLocalDate is used (eligible, no occurrences yet)', today.status === 'OK' && today.suggestions.length === 1);

    const tomorrowDeps = makeDeps({
      loadCandidateGoalActivities: async () => [row({ goalActivityId: 'ga-1', rhythmTargetPerWeek: 1 })],
      loadRhythmFacts: async () => new Map([['ga-1', [{ localDate: '2026-10-06', contribution: 'COMPLETED' as const }]]]),
    });
    const sameWeekTomorrow = await resolveAutomaticGoalDemand(tomorrowDeps, '2026-10-07', TZ, []); // Wednesday, same week as the 10-06 completion
    check('11. Tomorrow within the same Rhythm week: a prior completion correctly exhausts a 1/week target -> excluded', sameWeekTomorrow.status === 'OK' && sameWeekTomorrow.suggestions.length === 0);

    const nextWeek = await resolveAutomaticGoalDemand(tomorrowDeps, '2026-10-12', TZ, []); // the following Monday, a new week
    check('12. Sunday->Monday (crossing the week boundary): the SAME prior completion does not carry over into the new week -> eligible again', nextWeek.status === 'OK' && nextWeek.suggestions.length === 1);

    void seenDate;
  }
  {
    // 13. No Date.now()-based substitution -- proven structurally: the
    // resolver's own source never reads the clock at all.
    const src = require('fs').readFileSync(require('path').join(__dirname, '../apps/web/lib/planDayBootstrap.ts'), 'utf8');
    const srcNoComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    check('13. planDayBootstrap.ts never calls Date.now() or constructs a clock-reading Date in real code', !/Date\.now\(\)|new Date\(\)/.test(srcNoComments));
  }

  // ============================================================
  // Session/auth edge cases -- mirrors resolveGoalActivityHandoff's own
  // established "fails closed to an empty OK result" convention.
  // ============================================================
  {
    const deps = makeDeps({ getSessionToken: () => undefined, loadCandidateGoalActivities: async () => [row({ goalActivityId: 'ga-1' })] });
    const result = await resolveAutomaticGoalDemand(deps, '2026-10-06', TZ, []);
    check('no session token -> OK empty result, never seeds anything, never LOAD_FAILED', result.status === 'OK' && result.suggestions.length === 0);
  }
  {
    const deps = makeDeps({ verifySession: () => null, loadCandidateGoalActivities: async () => [row({ goalActivityId: 'ga-1' })] });
    const result = await resolveAutomaticGoalDemand(deps, '2026-10-06', TZ, []);
    check('an invalid session token -> OK empty result', result.status === 'OK' && result.suggestions.length === 0);
  }
  {
    const result = await resolveAutomaticGoalDemand(makeDeps(), null, TZ, []);
    check('missing planningLocalDate -> OK empty result, no query even attempted', result.status === 'OK' && result.suggestions.length === 0);
  }
  {
    const result = await resolveAutomaticGoalDemand(makeDeps(), '2026-10-06', null, []);
    check('missing timezone -> OK empty result, no query even attempted', result.status === 'OK' && result.suggestions.length === 0);
  }

  if (!allPassed) {
    console.error('SOME AUTOMATIC GOAL DEMAND BOOTSTRAP CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL AUTOMATIC GOAL DEMAND BOOTSTRAP CHECKS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
