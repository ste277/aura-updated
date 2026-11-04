/**
 * HGR1 -- Home Goal-Rhythm Integration.
 *
 * Pure, DI-based regression coverage for Home's own Rhythm-suggestion
 * surfacing (homeGoalRhythmSuggestions.ts's presentation projection),
 * exercised against the REAL `loadEligibleGoalDemand` (goalDemandCandidates.ts)
 * -- the exact same read model Plan My Day's own `resolveAutomaticGoalDemand`
 * (planDayBootstrap.ts) already consumes. No DB/network: fake deps throughout,
 * same established convention as goalDemandCandidates.test.ts/
 * automaticGoalDemandBootstrap.test.ts. Archived-Goal/DISMISSED-activity
 * SQL-level exclusion is proven live in test/goalDemandCandidatesDb.test.ts
 * (not duplicated here -- this file only proves Home's own new integration
 * glue never re-admits what the discovery query already excluded).
 */
import * as fs from 'fs';
import * as path from 'path';
import { loadEligibleGoalDemand, type GoalDemandCandidatesDeps } from '../apps/web/lib/goalDemandCandidates';
import { resolveAutomaticGoalDemand, resolveGoalActivityHandoff, type AutomaticGoalDemandBootstrapDeps, type GoalActivityHandoffDeps } from '../apps/web/lib/planDayBootstrap';
import { mapGoalDemandToHomeRhythmSuggestions, formatRhythmRemainingLabel } from '../apps/web/lib/homeGoalRhythmSuggestions';
import type { CandidateGoalActivityForRhythmDemandRow } from '../apps/web/lib/db';
import type { GoalActivityRhythmOccurrenceFact } from '../apps/web/lib/goalActivityRhythm';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';

function row(overrides: Partial<CandidateGoalActivityForRhythmDemandRow> & { goalActivityId: string }): CandidateGoalActivityForRhythmDemandRow {
  return { goalId: 'goal-1', goalTitle: 'Get fit', title: 'Run', activityId: 'running', rhythmKind: 'N_PER_WEEK', rhythmTargetPerWeek: 3, ...overrides };
}

function fact(localDate: string, contribution: GoalActivityRhythmOccurrenceFact['contribution']): GoalActivityRhythmOccurrenceFact {
  return { localDate, contribution };
}

/** Counts how many times each dep function was actually invoked -- used by
 * check 11 to prove loading Home calls ONLY the two read functions
 * `GoalDemandCandidatesDeps` exposes, nothing else, exactly once each. */
function countingDeps(rows: CandidateGoalActivityForRhythmDemandRow[], facts: ReadonlyMap<string, readonly GoalActivityRhythmOccurrenceFact[]> = new Map()): { deps: GoalDemandCandidatesDeps; calls: { discovery: number; facts: number } } {
  const calls = { discovery: 0, facts: 0 };
  const deps: GoalDemandCandidatesDeps = {
    loadCandidateGoalActivities: async () => {
      calls.discovery += 1;
      return rows;
    },
    loadRhythmFacts: async () => {
      calls.facts += 1;
      return facts;
    },
  };
  return { deps, calls };
}

async function main() {
  // ============================================================
  // 1. Eligible N_PER_WEEK GoalActivity appears in Home candidates
  // ============================================================
  {
    const { deps } = countingDeps([row({ goalActivityId: 'ga-run' })]);
    const result = await loadEligibleGoalDemand(deps, 'user-1', '2026-11-05', TZ);
    const suggestions = result.status === 'OK' ? mapGoalDemandToHomeRhythmSuggestions(result.candidates) : [];
    check('1. an eligible 3x/week GoalActivity appears in Home\'s mapped suggestions', suggestions.some((s) => s.goalActivityId === 'ga-run' && s.remainingThisWeek === 3));
  }

  // ============================================================
  // 2. Weekly target already satisfied does NOT appear as unmet demand
  // ============================================================
  {
    const { deps } = countingDeps(
      [row({ goalActivityId: 'ga-satisfied', rhythmTargetPerWeek: 2 })],
      new Map([['ga-satisfied', [fact('2026-11-02', 'COMPLETED'), fact('2026-11-03', 'COMPLETED')]]])
    );
    const result = await loadEligibleGoalDemand(deps, 'user-1', '2026-11-05', TZ);
    const suggestions = result.status === 'OK' ? mapGoalDemandToHomeRhythmSuggestions(result.candidates) : [];
    check('2. a 2/week target already fully completed does NOT appear as unmet Home demand', !suggestions.some((s) => s.goalActivityId === 'ga-satisfied'));
  }

  // ============================================================
  // 3. A GoalActivity the discovery query excludes (archived Goal /
  // DISMISSED activity, the SQL filter proven live in
  // goalDemandCandidatesDb.test.ts) is never re-admitted by Home's own
  // mapping -- Home introduces no second discovery/filter of its own.
  // ============================================================
  {
    // Simulates the discovery query having ALREADY excluded an archived
    // Goal's activity (it simply never appears among the rows) --
    // confirms Home's mapper does not independently re-derive/re-admit it.
    const { deps } = countingDeps([row({ goalActivityId: 'ga-visible' })]); // 'ga-archived' deliberately absent
    const result = await loadEligibleGoalDemand(deps, 'user-1', '2026-11-05', TZ);
    const suggestions = result.status === 'OK' ? mapGoalDemandToHomeRhythmSuggestions(result.candidates) : [];
    check('3. a GoalActivity absent from discovery (e.g. an archived Goal, excluded server-side) never appears on Home', !suggestions.some((s) => s.goalActivityId === 'ga-archived') && suggestions.length === 1);
  }

  // ============================================================
  // 4. An existing planned (UPCOMING) occurrence does not create duplicate
  // demand -- it is counted as COMMITTED capacity, reducing remaining.
  // ============================================================
  {
    const { deps } = countingDeps([row({ goalActivityId: 'ga-committed', rhythmTargetPerWeek: 1 })], new Map([['ga-committed', [fact('2026-11-04', 'COMMITTED')]]]));
    const result = await loadEligibleGoalDemand(deps, 'user-1', '2026-11-05', TZ);
    const suggestions = result.status === 'OK' ? mapGoalDemandToHomeRhythmSuggestions(result.candidates) : [];
    check('4. a 1/week target with one already-UPCOMING occurrence is exhausted -- no duplicate Home demand', !suggestions.some((s) => s.goalActivityId === 'ga-committed'));
  }

  // ============================================================
  // 5. A completed (LOGGED) occurrence is counted correctly
  // ============================================================
  {
    const { deps } = countingDeps([row({ goalActivityId: 'ga-partial', rhythmTargetPerWeek: 3 })], new Map([['ga-partial', [fact('2026-11-04', 'COMPLETED')]]]));
    const result = await loadEligibleGoalDemand(deps, 'user-1', '2026-11-05', TZ);
    const suggestion = result.status === 'OK' ? mapGoalDemandToHomeRhythmSuggestions(result.candidates)[0] : undefined;
    check('5. 1 completed of 3/week -> remainingThisWeek 2, correctly counted', suggestion?.remainingThisWeek === 2);
    check('5b. progress label reflects the exact real count, never invented', suggestion?.progressLabel === formatRhythmRemainingLabel(2, 3) && suggestion?.progressLabel === '2 sessions remaining this week (of 3)');
  }

  // ============================================================
  // 6. User timezone/week boundary is respected (Monday-start local week)
  // ============================================================
  {
    // 2026-11-01 is Sunday, 2026-11-02 is the next Monday (new week).
    const { deps } = countingDeps([row({ goalActivityId: 'ga-week', rhythmTargetPerWeek: 1 })], new Map([['ga-week', [fact('2026-11-01', 'COMPLETED')]]]));
    const sameWeek = await loadEligibleGoalDemand(deps, 'user-1', '2026-11-01', TZ);
    check('6a. a Sunday completion exhausts that same week\'s Home demand', sameWeek.status === 'OK' && mapGoalDemandToHomeRhythmSuggestions(sameWeek.candidates).length === 0);
    const nextWeek = await loadEligibleGoalDemand(deps, 'user-1', '2026-11-02', TZ);
    const nextSuggestions = nextWeek.status === 'OK' ? mapGoalDemandToHomeRhythmSuggestions(nextWeek.candidates) : [];
    check('6b. crossing into the next Monday-start week, the prior Sunday completion does not carry over', nextSuggestions.length === 1 && nextSuggestions[0].remainingThisWeek === 1);
  }

  // ============================================================
  // 7. Home and Plan My Day AGREE on eligibility -- both surfaces
  // delegate to the exact same loadEligibleGoalDemand call with the same
  // facts; this asserts they can never diverge.
  // ============================================================
  {
    const rows: CandidateGoalActivityForRhythmDemandRow[] = [row({ goalActivityId: 'ga-agree', rhythmTargetPerWeek: 3 })];
    const facts = new Map([['ga-agree', [fact('2026-11-04', 'COMPLETED'), fact('2026-11-05', 'COMMITTED')]]]);

    // Home's own path.
    const { deps: homeDeps } = countingDeps(rows, facts);
    const homeResult = await loadEligibleGoalDemand(homeDeps, 'user-1', '2026-11-05', TZ);
    const homeSuggestion = homeResult.status === 'OK' ? mapGoalDemandToHomeRhythmSuggestions(homeResult.candidates)[0] : undefined;

    // Plan My Day's own path (planDayBootstrap.ts's resolveAutomaticGoalDemand), same underlying facts.
    const planDayDeps: AutomaticGoalDemandBootstrapDeps = {
      getSessionToken: () => 'tok',
      verifySession: () => ({ userId: 'user-1' }),
      ...countingDeps(rows, facts).deps,
    };
    const planDayResult = await resolveAutomaticGoalDemand(planDayDeps, '2026-11-05', TZ, []);
    const planDaySuggestion = planDayResult.status === 'OK' ? planDayResult.suggestions.find((s) => s.goalActivityId === 'ga-agree') : undefined;

    check(
      '7. Home and Plan My Day agree exactly on this GoalActivity\'s eligibility (both delegate to the same loadEligibleGoalDemand call)',
      homeSuggestion !== undefined &&
        planDaySuggestion !== undefined &&
        homeSuggestion.remainingThisWeek === 1 &&
        planDaySuggestion.remainingThisWeek === 1 &&
        homeSuggestion.remainingThisWeek === planDaySuggestion.remainingThisWeek
    );
  }

  // ============================================================
  // 8. Daily Rhythm preference is preserved -- this PR introduces no
  // second Daily-Rhythm-aware timing decision on Home: Rhythm candidates
  // carry no timing/window of their own (the handoff defers all timing
  // -- and therefore all Daily Rhythm filtering -- to Plan My Day, where
  // applyDailyRhythmPreference already correctly applies, unchanged).
  // Structural confirmation that this PR's own new files never reference
  // or duplicate that filtering logic.
  // ============================================================
  {
    const newFiles = ['apps/web/lib/homeGoalRhythmSuggestions.ts', 'apps/web/components/GoalRhythmSuggestionsCard.tsx', 'apps/web/app/api/daily-assistant/goal-rhythm/route.ts'];
    const referencesDailyRhythm = newFiles.some((f) => /applyDailyRhythmPreference|dailyRhythmScheduling/.test(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')));
    check('8. this PR\'s new Home-integration files introduce no second Daily Rhythm filter (timing/filtering stays exclusively Plan My Day\'s, unchanged)', !referencesDailyRhythm);
  }

  // ============================================================
  // 9. Existing non-recurring Home recommendations remain unaffected --
  // this PR's new files touch neither dailyGuidanceOrchestrator.ts nor
  // dailyGuidanceCandidates.ts; verified by the absence of any import
  // edge from this PR's files into that pipeline (structural guard), full
  // behavioral regression proof is the existing, unmodified
  // dailyGuidanceOrchestratorDb.test.ts / dailyGuidanceDailyRhythmAlignment.test.ts suites (run in CI, not duplicated here).
  // ============================================================
  {
    const pageSource = fs.readFileSync(path.join(__dirname, '..', 'apps/web/app/page.tsx'), 'utf8');
    const guidanceFetchStillPresent = /\/api\/daily-assistant\/guidance/.test(pageSource) && /loadGuidance/.test(pageSource);
    check('9. the pre-existing Home guidance fetch (Best For You / astrology-ranked recommendations) is untouched by this PR\'s addition', guidanceFetchStillPresent);
  }

  // ============================================================
  // 10. Home action preserves GoalActivity identity through the handoff,
  // end-to-end: the mapped suggestion's planHandoff round-trips through
  // the REAL resolveGoalActivityHandoff (the server-side function the
  // /plan-day page actually calls for `?fromGoal=&activities=`).
  // ============================================================
  {
    const { deps } = countingDeps([row({ goalActivityId: 'ga-identity', goalId: 'goal-identity', title: 'Read' })]);
    const result = await loadEligibleGoalDemand(deps, 'user-1', '2026-11-05', TZ);
    const suggestion = result.status === 'OK' ? mapGoalDemandToHomeRhythmSuggestions(result.candidates)[0] : undefined;
    check('10a. the mapped suggestion carries the exact source goalId/goalActivityId into its planHandoff', suggestion?.planHandoff.fromGoal === 'goal-identity' && suggestion?.planHandoff.activities === 'ga-identity');

    const handoffDeps: GoalActivityHandoffDeps = {
      getSessionToken: () => 'tok',
      verifySession: () => ({ userId: 'user-1' }),
      listGoalActivities: async () => [{ id: 'ga-identity', title: 'Read', activityId: null, status: 'SUGGESTED', plannedActivityId: null, linkedPlanStatus: null }],
    };
    const handoffItems = suggestion ? await resolveGoalActivityHandoff(handoffDeps, suggestion.planHandoff.fromGoal, suggestion.planHandoff.activities, '2026-11-05', TZ) : [];
    check('10b. feeding the suggestion\'s own planHandoff into the real Plan My Day handoff resolver resolves back to the SAME GoalActivity id', handoffItems.length === 1 && handoffItems[0].id === 'ga-identity');
  }

  // ============================================================
  // 11. No database writes occur merely from loading Home -- the deps
  // surface exposes only two READ functions, and exactly one call to each
  // happens per load, nothing else.
  // ============================================================
  {
    const { deps, calls } = countingDeps([row({ goalActivityId: 'ga-readonly' })]);
    await loadEligibleGoalDemand(deps, 'user-1', '2026-11-05', TZ);
    check('11a. exactly one discovery read and one facts read occur per Home load -- no repeats, no extra calls', calls.discovery === 1 && calls.facts === 1);
    const routeSource = fs.readFileSync(path.join(__dirname, '..', 'apps/web/app/api/daily-assistant/goal-rhythm/route.ts'), 'utf8');
    const stripped = routeSource.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    check('11b. the new Home route contains no write-shaped call (create/update/delete/insert) anywhere in its source', !/\b(create|update|delete|insert)\s*\(/i.test(stripped));
  }
}

main()
  .then(() => {
    if (!allPassed) {
      console.error('SOME HOME GOAL RHYTHM SUGGESTIONS CHECKS FAILED');
      process.exit(1);
    }
    console.log('ALL HOME GOAL RHYTHM SUGGESTIONS CHECKS PASSED');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
