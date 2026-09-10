/**
 * Live-database tests for Personal Guidance Orchestration V1 -- the full
 * end-to-end buildPersonalDailyGuidance() flow, plus
 * collectPlanCandidates/collectDayBuilderCandidates individually. Requires
 * a real, reachable DATABASE_URL, same convention as dayBuilderDb.test.ts/
 * savedPersonDb.test.ts -- NOT part of ci.yml's math-core-tests job (no
 * Postgres service provisioned there).
 *
 * Run locally with a real DATABASE_URL set:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/dailyGuidanceOrchestratorDb.test.ts
 *
 * Creates one throwaway test user (idempotent via email upsert, given a
 * complete birth profile) and one throwaway PlannedActivity per check
 * that needs one, cleaning up every Plan it creates in a finally block --
 * same convention as dayBuilderDb.test.ts's own SavedPerson cleanup.
 * Leaves the User row in place (same convention).
 */
import { upsertUserByEmail, updateBirthProfile, createPlannedActivity, cancelPlannedActivity, deletePlannedActivity, updateUserDayBuilderPrefs } from '../apps/web/lib/db';
import { buildPersonalDailyGuidance } from '../apps/web/lib/dailyGuidanceOrchestrator';
import { collectPlanCandidates, collectDayBuilderCandidates } from '../apps/web/lib/dailyGuidanceCandidates';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
// A fixed instant on a real day, matching this repo's own established
// fixed-fake-"now" convention for DB tests (see dayBuilderDb.test.ts).
const NOW = new Date('2026-09-09T04:00:00.000Z'); // 9:30 AM IST

async function main() {
  const user0 = await upsertUserByEmail({ email: 'test-daily-guidance-owner@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const user = await updateBirthProfile(user0.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  await updateUserDayBuilderPrefs(user.id, { dayBuilderEnabled: true, dayBuilderMutedGroups: [], dayBuilderPriorities: [], dayBuilderPriorityPersonIds: [], dayBuilderPrioritiesPromptDismissed: true });

  const createdPlanIds: string[] = [];

  try {
    // ============================================================
    // BIRTH_PROFILE_REQUIRED.
    // ============================================================
    const incompleteUser = { ...user, birthDate: null };
    const incompleteResult = await buildPersonalDailyGuidance(incompleteUser, NOW);
    check('BIRTH_PROFILE_REQUIRED: missing birthDate -> status BIRTH_PROFILE_REQUIRED', incompleteResult.status === 'BIRTH_PROFILE_REQUIRED');

    // ============================================================
    // NO_ACTIVITY_INTENT -- complete profile, but no Plans and Day
    // Builder disabled (so it contributes nothing either).
    // ============================================================
    const noIntentUser = { ...user, dayBuilderEnabled: false };
    const noIntentResult = await buildPersonalDailyGuidance(noIntentUser, NOW);
    check('NO_ACTIVITY_INTENT: complete profile, zero Plans today, Day Builder disabled -> status NO_ACTIVITY_INTENT', noIntentResult.status === 'NO_ACTIVITY_INTENT');

    // ============================================================
    // PLAN CANDIDATE COLLECTION.
    // ============================================================
    const plan = await createPlannedActivity({
      userId: user.id,
      title: 'Deep Work Block',
      activityId: 'deep-work',
      plannedStartAt: new Date('2026-09-09T05:00:00.000Z'), // 10:30 AM IST
      plannedEndAt: new Date('2026-09-09T06:00:00.000Z'),
      durationMinutes: 60,
      windowType: 'NEUTRAL',
    });
    createdPlanIds.push(plan.id);

    const planCandidates = await collectPlanCandidates(user, NOW);
    check('PLAN CANDIDATES: an eligible Plan with a resolved activityId produces exactly one candidate', planCandidates.length === 1);
    check('PLAN CANDIDATES: candidate.source is PLAN', planCandidates[0]?.source === 'PLAN');
    check('PLAN CANDIDATES: candidate.activityFamily is derived (DEEP_WORK for deep-work)', planCandidates[0]?.activityFamily === 'DEEP_WORK');
    check('PLAN CANDIDATES: candidate.timingCandidates has exactly one CHECK-evaluated window', planCandidates[0]?.timingCandidates.length === 1);
    check('PLAN CANDIDATES: the CHECK-evaluated window matches the Plan\'s own scheduled instant (never a FIND-searched different time)', planCandidates[0]?.timingCandidates[0]?.start === plan.plannedStartAt.toISOString());

    // ============================================================
    // TITLE-ONLY PLAN EXCLUSION.
    // ============================================================
    const titleOnlyPlan = await createPlannedActivity({
      userId: user.id,
      title: 'Something unresolved',
      activityId: null,
      plannedStartAt: new Date('2026-09-09T07:00:00.000Z'),
      plannedEndAt: new Date('2026-09-09T08:00:00.000Z'),
      durationMinutes: 60,
      windowType: 'NEUTRAL',
    });
    createdPlanIds.push(titleOnlyPlan.id);
    const withTitleOnly = await collectPlanCandidates(user, NOW);
    check('TITLE-ONLY PLAN: a Plan with activityId=null is excluded from candidates (never a guessed family)', withTitleOnly.length === 1 && withTitleOnly.every((c) => c.sourceEntityId !== titleOnlyPlan.id));

    // ============================================================
    // MISSED PLAN EXCLUSION.
    // ============================================================
    const missedPlan = await createPlannedActivity({
      userId: user.id,
      title: 'Already elapsed',
      activityId: 'workout',
      plannedStartAt: new Date('2026-09-09T01:00:00.000Z'), // 6:30 AM IST -- before NOW
      plannedEndAt: new Date('2026-09-09T01:30:00.000Z'),
      durationMinutes: 30,
      windowType: 'BRAHMA',
    });
    createdPlanIds.push(missedPlan.id);
    const withMissed = await collectPlanCandidates(user, NOW);
    check('MISSED PLAN: an elapsed, unlogged Plan is excluded (the identical MISSED rule dailyAgenda.ts uses)', withMissed.every((c) => c.sourceEntityId !== missedPlan.id));

    // ============================================================
    // DAY BUILDER CANDIDATE COLLECTION (SOLO only).
    // ============================================================
    const dayBuilderCandidates = await collectDayBuilderCandidates(user, NOW);
    check('DAY BUILDER CANDIDATES: every returned candidate has a non-empty activityId', dayBuilderCandidates.every((c) => c.activityId.length > 0));
    check('DAY BUILDER CANDIDATES: every returned candidate has at least one timing candidate reused from Day Builder\'s own FIND result', dayBuilderCandidates.every((c) => c.timingCandidates.length > 0));

    // ============================================================
    // FULL END-TO-END: READY with a real recommendation.
    // ============================================================
    const readyResult = await buildPersonalDailyGuidance(user, NOW);
    check('READY: a complete profile + at least one eligible Plan produces status READY', readyResult.status === 'READY');
    if (readyResult.status === 'READY') {
      check('READY: guidance.recommendations preserved verbatim from #104 (rank 1..N present)', readyResult.guidance.recommendations.every((r, i) => r.rank === i + 1));
      check('READY: selectedActivities contains metadata only for families actually in guidance.recommendations', Object.keys(readyResult.selectedActivities).every((family) => readyResult.guidance.recommendations.some((r) => r.activityFamily === family)));
      const deepWorkRecommendation = readyResult.guidance.recommendations.find((r) => r.activityFamily === 'DEEP_WORK');
      if (deepWorkRecommendation) {
        check('READY: DEEP_WORK selectedActivities metadata traces back to the real Plan (activityId=deep-work, source=PLAN)', readyResult.selectedActivities['DEEP_WORK']?.activityId === 'deep-work' && readyResult.selectedActivities['DEEP_WORK']?.source === 'PLAN');
      }
    }

    // ============================================================
    // DETERMINISM (real DB, same inputs).
    // ============================================================
    const secondReadyResult = await buildPersonalDailyGuidance(user, NOW);
    check('DETERMINISM: two calls with the identical user+now+Plans produce deeply-equal guidance.recommendations', JSON.stringify((readyResult as { guidance?: unknown }).guidance) === JSON.stringify((secondReadyResult as { guidance?: unknown }).guidance));
  } finally {
    // deletePlannedActivity only removes LOGGED/CANCELLED rows (never a
    // live UPCOMING commitment) -- every Plan this file creates stays
    // UPCOMING, so it must be cancelled first, matching the app's own
    // two-step cancel-then-delete flow (apps/web/lib/db.ts's own
    // cancelPlannedActivity/deletePlannedActivity pair).
    for (const planId of createdPlanIds) {
      await cancelPlannedActivity(user.id, planId);
      await deletePlannedActivity(user.id, planId);
    }
  }

  if (!allPassed) {
    console.error('\nSome Personal Guidance Orchestration (live-database) checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL PERSONAL GUIDANCE ORCHESTRATION (LIVE-DATABASE) CHECKS PASSED');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
