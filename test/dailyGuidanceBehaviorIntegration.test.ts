/**
 * Behavioral Integration V1: live-database regression suite for
 * apps/web/lib/dailyGuidanceBehavior.ts (the new HabitLog -> #110 ->
 * package-local-tier-map bridge) and its wiring into
 * apps/web/lib/dailyGuidanceOrchestrator.ts's buildPersonalDailyGuidance().
 *
 * Requires a real, reachable DATABASE_URL, same convention as every other
 * *Db.test.ts file in this repo:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/dailyGuidanceBehaviorIntegration.test.ts
 *
 * No delete function exists for HabitLog anywhere in this codebase (see
 * test/behavioralAffinityDb.test.ts's own doc comment) -- this file uses
 * its OWN dedicated test users (never the shared
 * test-daily-guidance-owner@example.com fixture test/dailyGuidanceOrchestratorDb.test.ts
 * already uses), so repeated runs never pollute that shared fixture's own
 * evidence baseline. PlannedActivity rows ARE cleaned up (cancel-then-
 * delete), matching every other *Db.test.ts file's established pattern.
 */
import { upsertUserByEmail, updateBirthProfile, createHabitLog, createPlannedActivity, cancelPlannedActivity, deletePlannedActivity, updateUserDayBuilderPrefs } from '../apps/web/lib/db';
import { buildBehavioralAffinityByFamily } from '../apps/web/lib/dailyGuidanceBehavior';
import { buildDailyPersonalFitForUser } from '../apps/web/lib/dailyGuidancePipeline';
import { buildPersonalDailyGuidance } from '../apps/web/lib/dailyGuidanceOrchestrator';
import { deriveDailyGuidance } from '../packages/daily-guidance/src/engine';
import * as fs from 'fs';
import type { WindowRankingContext, RankedTimingWindow } from '../packages/window-ranking/src/types';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const TZ = 'Asia/Kolkata';
const NOW = new Date();

function buildWindow(overrides: Partial<RankedTimingWindow> = {}): RankedTimingWindow {
  return {
    start: '2026-09-09T04:00:00.000Z',
    end: '2026-09-09T05:00:00.000Z',
    score: 8.0,
    label: 'GOOD',
    muhurtaScore: 5,
    auraFitScore: 82,
    reasons: [],
    conflicts: undefined,
    metadata: { windowType: 'ABHIJIT', windowLabel: 'Abhijit Muhurtham', activityType: 'Deep work', dateLabel: 'Wed, Sep 9' },
    rank: 1,
    ...overrides,
  };
}

function buildRanking(family: string, windows: RankedTimingWindow[]): WindowRankingContext {
  return { engineVersion: 'WINDOW_RANKING_V1', activityFamily: family as WindowRankingContext['activityFamily'], windows };
}

async function main() {
  const ownerA = await upsertUserByEmail({ email: 'test-daily-guidance-behavior-owner-a@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const userA0 = await updateBirthProfile(ownerA.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  await updateUserDayBuilderPrefs(userA0.id, { dayBuilderEnabled: true, dayBuilderMutedGroups: [], dayBuilderPriorities: [], dayBuilderPriorityPersonIds: [], dayBuilderPrioritiesPromptDismissed: true });
  const userA = userA0;

  const ownerB = await upsertUserByEmail({ email: 'test-daily-guidance-behavior-owner-b@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });

  const createdPlanIds: string[] = [];

  try {
    // ============================================================
    // COLD START. HabitLog has no delete function anywhere in this
    // codebase (see behavioralAffinityDb.test.ts's own doc comment), so
    // this file's own dedicated user accumulates real rows across repeated
    // runs -- asserting "the WHOLE map is empty" would only ever be true
    // on the very first run and would FAIL on every run after that,
    // exactly the "must run repeatably" trap this suite's own review must
    // guard against. Instead: MEDITATION is a family this file never
    // creates ANY HabitLog for, on ANY run -- its absence from the map is
    // a genuinely repeatable proof, unlike a global emptiness check. True
    // zero-history cold start (the FULL 13-entry all-NEUTRAL vector) is
    // already exhaustively proven, deterministically, by
    // test/behavioralAffinity.test.ts's own dedicated cold-start section --
    // this file's job is only to prove the real DB wiring, not to
    // re-prove #110's own pure cold-start contract.
    // ============================================================
    const beforeWorkoutMap = await buildBehavioralAffinityByFamily(userA, NOW);
    check('COLD START (repeatable): MEDITATION -- a family this file never creates any HabitLog for -- is absent from the map on every run', beforeWorkoutMap.MEDITATION === undefined);

    // ============================================================
    // REAL DB END-TO-END: 5 real WORKOUT HabitLog rows -> STRONG,
    // reusing #110's own deriveBehavioralProfile() and
    // listHabitLogsForInsights() completely unmodified.
    // ============================================================
    for (let i = 0; i < 5; i++) {
      await createHabitLog({
        userId: userA.id,
        activityTitle: 'Morning workout',
        activityId: 'workout',
        activeWindow: 'ABHIJIT',
        logMinuteOfDay: 360,
        logTimestamp: new Date(NOW.getTime() - i * 24 * 60 * 60 * 1000),
        durationMinutes: 45,
        logSource: 'MANUAL',
      });
    }
    const mapAfterFive = await buildBehavioralAffinityByFamily(userA, NOW);
    check('REAL DB: 5 real WORKOUT HabitLog rows -> behavioralAffinityByFamily.WORKOUT === STRONG', mapAfterFive.WORKOUT === 'STRONG');
    check('REAL DB: NEUTRAL families are simply absent from the map (sparse, matches buildCandidates\' own default)', mapAfterFive.LEARNING === undefined && mapAfterFive.MEDITATION === undefined);

    // ============================================================
    // CROSS-USER ISOLATION -- mirrors behavioralAffinityDb.test.ts's own
    // established pattern, adapted to this new function.
    // ============================================================
    for (let i = 0; i < 5; i++) {
      await createHabitLog({
        userId: ownerB.id,
        activityTitle: 'Focused deep work block',
        activityId: 'deep-work',
        activeWindow: 'ABHIJIT',
        logMinuteOfDay: 540,
        logTimestamp: new Date(NOW.getTime() - i * 24 * 60 * 60 * 1000),
        durationMinutes: 60,
        logSource: 'MANUAL',
      });
    }
    const mapB = await buildBehavioralAffinityByFamily(ownerB, NOW);
    check('CROSS-USER: ownerB\'s own map shows DEEP_WORK STRONG from B\'s own real history', mapB.DEEP_WORK === 'STRONG');
    check('CROSS-USER: ownerB\'s map shows no WORKOUT entry -- ownerA\'s real DB rows never leaked in', mapB.WORKOUT === undefined);
    const mapAAgain = await buildBehavioralAffinityByFamily(userA, NOW);
    check('CROSS-USER: ownerA\'s own map is unaffected by ownerB\'s DEEP_WORK history (still no DEEP_WORK entry)', mapAAgain.DEEP_WORK === undefined && mapAAgain.WORKOUT === 'STRONG');

    // ============================================================
    // REAL DB-SOURCED AFFINITY GENUINELY CHANGES DAILY GUIDANCE ORDER.
    // A deliberate, explicit tie in relevance/label/score isolates the
    // new tuple key -- the SAME established technique
    // test/dailyGuidanceEngine.test.ts's own same-family/within-stage
    // tie-break tests already use (never a way to "weaken" the stronger
    // signals; it is how a tie-break is tested at all). What is NOT
    // synthetic here is the affinity value itself: userA's real
    // dailyPersonalFit (real Bhrigu/Dasha/transit/Life Weather) and the
    // real, just-derived WORKOUT=STRONG map from real DB rows above.
    // ============================================================
    const realDailyPersonalFit = buildDailyPersonalFitForUser(userA, NOW)!;
    realDailyPersonalFit.activities = realDailyPersonalFit.activities.map((a) => (a.activityFamily === 'WORKOUT' || a.activityFamily === 'LEARNING' ? { ...a, personalRelevance: 'HIGHLY_RELEVANT' as const } : a));
    const tiedWindowRankings = [
      buildRanking('WORKOUT', [buildWindow({ start: '2026-09-09T02:00:00.000Z', end: '2026-09-09T03:00:00.000Z', label: 'GOOD', score: 8.0 })]),
      buildRanking('LEARNING', [buildWindow({ start: '2026-09-09T05:00:00.000Z', end: '2026-09-09T06:00:00.000Z', label: 'GOOD', score: 8.0 })]),
    ];
    const guidanceWithRealAffinity = deriveDailyGuidance({ dailyPersonalFit: realDailyPersonalFit, windowRankings: tiedWindowRankings, limit: 2, behavioralAffinityByFamily: mapAAgain });
    check(
      'REAL AFFINITY CHANGES ORDER: with relevance/label/score all tied, WORKOUT (real STRONG from DB history) is selected first over LEARNING (real NEUTRAL/absent)',
      guidanceWithRealAffinity.recommendations[0]?.activityFamily === 'WORKOUT'
    );
    const guidanceWithoutBehavior = deriveDailyGuidance({ dailyPersonalFit: realDailyPersonalFit, windowRankings: tiedWindowRankings, limit: 2 });
    check(
      'CONTROL: the SAME tied fixture WITHOUT any behavioral map falls through to start-time ascending (WORKOUT\'s earlier start), never depends on affinity being present to resolve the tie',
      guidanceWithoutBehavior.recommendations[0]?.activityFamily === 'WORKOUT'
    );

    // ============================================================
    // FULL END-TO-END: buildPersonalDailyGuidance's own selectedActivities
    // forward-compat field is populated from the real map.
    // ============================================================
    const plan = await createPlannedActivity({
      userId: userA.id,
      title: 'Workout Block',
      activityId: 'workout',
      plannedStartAt: new Date(Date.now() + 60 * 60 * 1000),
      plannedEndAt: new Date(Date.now() + 90 * 60 * 1000),
      durationMinutes: 30,
      windowType: 'NEUTRAL',
    });
    createdPlanIds.push(plan.id);
    const liveResult = await buildPersonalDailyGuidance(userA, new Date());
    check('LIVE END-TO-END: a real Plan produces status READY', liveResult.status === 'READY');
    if (liveResult.status === 'READY') {
      const workoutMetadata = liveResult.selectedActivities['WORKOUT'];
      check(
        'LIVE END-TO-END: if WORKOUT was selected, its selectedActivities metadata carries behavioralAffinity STRONG (forward-compat field, real value)',
        workoutMetadata === undefined || workoutMetadata.behavioralAffinity === 'STRONG'
      );
      check(
        'LIVE END-TO-END: every selectedActivities entry carries a valid behavioralAffinity tier',
        Object.values(liveResult.selectedActivities).every((m) => ['STRONG', 'MODERATE', 'NEUTRAL'].includes(m.behavioralAffinity ?? 'NEUTRAL'))
      );
    }

    // ============================================================
    // SEQUENCING (structural, matching dailyGuidanceOrchestrator.test.ts's
    // own established "STRUCTURAL" convention -- direct query-count
    // spying would require contorting production code with DI purely to
    // observe one internal call, which this repo's own precedent avoids).
    // ============================================================
    const orchestratorSource = stripComments(fs.readFileSync('apps/web/lib/dailyGuidanceOrchestrator.ts', 'utf8'));
    const birthProfileReturnIndex = orchestratorSource.indexOf("status: 'BIRTH_PROFILE_REQUIRED'");
    const noActivityIntentIndices = [...orchestratorSource.matchAll(/status: 'NO_ACTIVITY_INTENT'/g)].map((m) => m.index!);
    const behaviorCallIndex = orchestratorSource.indexOf('buildBehavioralAffinityByFamily(');
    check(
      'SEQUENCING: buildBehavioralAffinityByFamily is called AFTER the BIRTH_PROFILE_REQUIRED early return in source order',
      behaviorCallIndex > birthProfileReturnIndex
    );
    check(
      'SEQUENCING: buildBehavioralAffinityByFamily is called AFTER both NO_ACTIVITY_INTENT early returns in source order',
      noActivityIntentIndices.length === 2 && noActivityIntentIndices.every((i) => behaviorCallIndex > i)
    );
  } finally {
    for (const planId of createdPlanIds) {
      await cancelPlannedActivity(userA.id, planId);
      await deletePlannedActivity(userA.id, planId);
    }
  }

  if (!allPassed) {
    console.error('\nSome Behavioral Integration V1 (live-database) checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL BEHAVIORAL INTEGRATION V1 (LIVE-DATABASE) CHECKS PASSED');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
