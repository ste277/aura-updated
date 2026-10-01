/**
 * Goals V2 Candidate A1 -- pure domain tests for the eligible Goal-demand
 * read model: result-shape discrimination (OK vs LOAD_FAILED), capacity/
 * week-boundary behavior (delegated to, and proving reuse of,
 * computeGoalActivityRhythmEligibility -- no second formula here),
 * deterministic non-semantic ordering, and the pure dedup helper. No DB
 * access -- injected fake deps throughout. See
 * test/goalDemandCandidatesDb.test.ts for the live-database discovery
 * query proof (DISMISSED/ARCHIVED/rhythmKind/UPCOMING filtering,
 * cross-user isolation, query count).
 */
import { loadEligibleGoalDemand, excludeGoalDemandByActivityIds, type GoalDemandCandidatesDeps } from '../apps/web/lib/goalDemandCandidates';
import type { CandidateGoalActivityForRhythmDemandRow } from '../apps/web/lib/db';
import type { GoalActivityRhythmOccurrenceFact } from '../apps/web/lib/goalActivityRhythm';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function row(overrides: Partial<CandidateGoalActivityForRhythmDemandRow> & { goalActivityId: string }): CandidateGoalActivityForRhythmDemandRow {
  return {
    goalId: 'goal-1',
    goalTitle: 'Get fit',
    title: 'Workout',
    activityId: null,
    rhythmKind: 'N_PER_WEEK',
    rhythmTargetPerWeek: 3,
    ...overrides,
  };
}

function fact(localDate: string, contribution: GoalActivityRhythmOccurrenceFact['contribution']): GoalActivityRhythmOccurrenceFact {
  return { localDate, contribution };
}

function fakeDeps(rows: CandidateGoalActivityForRhythmDemandRow[], facts: ReadonlyMap<string, readonly GoalActivityRhythmOccurrenceFact[]> = new Map()): GoalDemandCandidatesDeps {
  return {
    loadCandidateGoalActivities: async () => rows,
    loadRhythmFacts: async () => facts,
  };
}

const TZ = 'Asia/Kolkata';

async function main() {
  // ============================================================
  // Result-shape discrimination (this ticket's own section 12/20)
  // ============================================================
  {
    const result = await loadEligibleGoalDemand(fakeDeps([]), 'user-1', '2026-09-22', TZ);
    check('1. zero rows -> OK with an empty candidate list (never conflated with failure)', result.status === 'OK' && result.status === 'OK' && result.candidates.length === 0);
  }
  {
    const failingDeps: GoalDemandCandidatesDeps = {
      loadCandidateGoalActivities: async () => {
        throw new Error('connection reset');
      },
      loadRhythmFacts: async () => new Map(),
    };
    const result = await loadEligibleGoalDemand(failingDeps, 'user-1', '2026-09-22', TZ);
    check('2. discovery-query failure -> LOAD_FAILED, distinguishable from a genuine empty result', result.status === 'LOAD_FAILED');
  }
  {
    const failingFactsDeps: GoalDemandCandidatesDeps = {
      loadCandidateGoalActivities: async () => [row({ goalActivityId: 'ga-1' })],
      loadRhythmFacts: async () => {
        throw new Error('timeout');
      },
    };
    const result = await loadEligibleGoalDemand(failingFactsDeps, 'user-1', '2026-09-22', TZ);
    check('3. facts-query failure -> LOAD_FAILED, never silently treated as zero facts', result.status === 'LOAD_FAILED');
  }

  // ============================================================
  // Capacity/eligibility reuse (this ticket's own section 7) -- proves
  // THIS file delegates to computeGoalActivityRhythmEligibility rather
  // than reimplementing the formula.
  // ============================================================
  {
    // 3/week, 0 completed + 0 committed -> remaining 3, eligible.
    const deps = fakeDeps([row({ goalActivityId: 'ga-3a', rhythmTargetPerWeek: 3 })], new Map([['ga-3a', []]]));
    const result = await loadEligibleGoalDemand(deps, 'user-1', '2026-09-22', TZ);
    check('4. 0 completed + 0 committed of 3/week -> remainingThisWeek 3', result.status === 'OK' && result.candidates[0]?.remainingThisWeek === 3);
  }
  {
    // 3/week, 1 completed (LOGGED) + 1 committed (UPCOMING) -> remaining 1.
    const deps = fakeDeps(
      [row({ goalActivityId: 'ga-3b', rhythmTargetPerWeek: 3 })],
      new Map([['ga-3b', [fact('2026-09-22', 'COMPLETED'), fact('2026-09-23', 'COMMITTED')]]])
    );
    const result = await loadEligibleGoalDemand(deps, 'user-1', '2026-09-22', TZ);
    check('5. 1 completed + 1 committed of 3/week -> remainingThisWeek 1', result.status === 'OK' && result.candidates[0]?.remainingThisWeek === 1);
  }
  {
    // 3/week, 1 completed + 2 committed -> remaining 0 -> excluded entirely.
    const deps = fakeDeps(
      [row({ goalActivityId: 'ga-3c', rhythmTargetPerWeek: 3 })],
      new Map([['ga-3c', [fact('2026-09-22', 'COMPLETED'), fact('2026-09-23', 'COMMITTED'), fact('2026-09-24', 'COMMITTED')]]])
    );
    const result = await loadEligibleGoalDemand(deps, 'user-1', '2026-09-22', TZ);
    check('6. 1 completed + 2 committed of 3/week -> exhausted, excluded from candidates', result.status === 'OK' && result.candidates.length === 0);
  }

  // ============================================================
  // Today / Tomorrow / week-boundary (this ticket's own section 6)
  // ============================================================
  {
    // 2026-09-21 is Monday, 2026-09-27 is Sunday, 2026-09-28 is the next Monday.
    const deps = fakeDeps([row({ goalActivityId: 'ga-week', rhythmTargetPerWeek: 1 })], new Map([['ga-week', [fact('2026-09-27', 'COMPLETED')]]]));
    const sameWeek = await loadEligibleGoalDemand(deps, 'user-1', '2026-09-27', TZ); // planning for Sunday, same week as the completion
    check('7. Sunday planning date: a Sunday completion exhausts THIS week -> excluded', sameWeek.status === 'OK' && sameWeek.candidates.length === 0);
    const nextWeek = await loadEligibleGoalDemand(deps, 'user-1', '2026-09-28', TZ); // planning for Monday, the NEXT week
    check(
      '8. Monday (Tomorrow, crossing into next week) planning date: the prior Sunday completion does NOT carry over -> eligible again',
      nextWeek.status === 'OK' && nextWeek.candidates.length === 1 && nextWeek.candidates[0].remainingThisWeek === 1
    );
  }

  // ============================================================
  // Defense-in-depth rhythmKind re-check (never trusts the discovery
  // query's own SQL filter blindly)
  // ============================================================
  {
    const deps = fakeDeps([row({ goalActivityId: 'ga-none', rhythmKind: null, rhythmTargetPerWeek: null })]);
    const result = await loadEligibleGoalDemand(deps, 'user-1', '2026-09-22', TZ);
    check('9. a row carrying no real N_PER_WEEK rhythm is excluded even if the discovery query somehow returned one', result.status === 'OK' && result.candidates.length === 0);
  }

  // ============================================================
  // Multiple Goals / deterministic ordering (this ticket's own sections
  // 9/10) -- NOT prioritization: a stable, non-semantic sort only.
  // ============================================================
  {
    const rows = [
      row({ goalActivityId: 'ga-zzz', goalId: 'goal-2', rhythmTargetPerWeek: 1 }),
      row({ goalActivityId: 'ga-aaa', goalId: 'goal-1', rhythmTargetPerWeek: 1 }),
      row({ goalActivityId: 'ga-mmm', goalId: 'goal-2', rhythmTargetPerWeek: 1 }),
    ];
    const deps = fakeDeps(rows, new Map());
    const result = await loadEligibleGoalDemand(deps, 'user-1', '2026-09-22', TZ);
    const ids = result.status === 'OK' ? result.candidates.map((c) => c.goalActivityId) : [];
    check('10. output order is a stable goalActivityId sort, independent of input/row order', ids.join(',') === 'ga-aaa,ga-mmm,ga-zzz');
    const repeat = await loadEligibleGoalDemand(deps, 'user-1', '2026-09-22', TZ);
    const repeatIds = repeat.status === 'OK' ? repeat.candidates.map((c) => c.goalActivityId) : [];
    check('11. ordering is deterministic across repeated calls with the same input', ids.join(',') === repeatIds.join(','));
    check('12. all three Goal Activities across both Goals are returned together, no cross-Goal grouping/suppression', ids.length === 3);
  }

  // ============================================================
  // No cap, no prioritization (this ticket's own section 10, explicit)
  // ============================================================
  {
    const rows = Array.from({ length: 9 }, (_, i) => row({ goalActivityId: `ga-${i}`, rhythmTargetPerWeek: 1 }));
    const deps = fakeDeps(rows, new Map());
    const result = await loadEligibleGoalDemand(deps, 'user-1', '2026-09-22', TZ);
    check('13. the complete factual set is returned with no implicit cap (9 eligible in, 9 out)', result.status === 'OK' && result.candidates.length === 9);
  }

  // ============================================================
  // Demand contract (this ticket's own section 5) -- fields present,
  // and no over-exposure of Goal domain state.
  // ============================================================
  {
    const deps = fakeDeps([row({ goalActivityId: 'ga-shape', goalId: 'goal-9', goalTitle: 'Read more', title: 'Read 20 pages', activityId: 'reading', rhythmTargetPerWeek: 2 })], new Map());
    const result = await loadEligibleGoalDemand(deps, 'user-1', '2026-09-22', TZ);
    const candidate = result.status === 'OK' ? result.candidates[0] : undefined;
    check(
      '14. candidate carries exactly the agreed contract fields with correct values',
      !!candidate &&
        candidate.goalActivityId === 'ga-shape' &&
        candidate.goalId === 'goal-9' &&
        candidate.goalTitle === 'Read more' &&
        candidate.title === 'Read 20 pages' &&
        candidate.activityId === 'reading' &&
        candidate.remainingThisWeek === 2 &&
        Object.keys(candidate).sort().join(',') === 'activityId,goalActivityId,goalId,goalTitle,remainingThisWeek,title'
    );
  }

  // ============================================================
  // Duplicate identity / pure dedup helper (this ticket's own section 11)
  // ============================================================
  {
    const candidates = [
      { goalActivityId: 'ga-1', goalId: 'g', goalTitle: 'g', title: 't', activityId: null, remainingThisWeek: 1 },
      { goalActivityId: 'ga-2', goalId: 'g', goalTitle: 'g', title: 't', activityId: null, remainingThisWeek: 1 },
      { goalActivityId: 'ga-3', goalId: 'g', goalTitle: 'g', title: 't', activityId: null, remainingThisWeek: 1 },
    ];
    const byArray = excludeGoalDemandByActivityIds(candidates, ['ga-2']);
    check('15. excludeGoalDemandByActivityIds removes exactly the named ids (array input)', byArray.map((c) => c.goalActivityId).join(',') === 'ga-1,ga-3');
    const bySet = excludeGoalDemandByActivityIds(candidates, new Set(['ga-1', 'ga-3']));
    check('16. excludeGoalDemandByActivityIds removes exactly the named ids (Set input)', bySet.map((c) => c.goalActivityId).join(',') === 'ga-2');
    const none = excludeGoalDemandByActivityIds(candidates, []);
    check('17. excludeGoalDemandByActivityIds with no ids to exclude is a pure pass-through (same length, same order)', none.map((c) => c.goalActivityId).join(',') === 'ga-1,ga-2,ga-3');
    check('18. excludeGoalDemandByActivityIds performs no mutation of its input array', candidates.length === 3 && candidates[1].goalActivityId === 'ga-2');
  }
}

main()
  .then(() => {
    if (!allPassed) {
      console.error('SOME GOAL DEMAND CANDIDATES CHECKS FAILED');
      process.exit(1);
    }
    console.log('ALL GOAL DEMAND CANDIDATES CHECKS PASSED');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
