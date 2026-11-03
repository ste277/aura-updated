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
import { upsertUserByEmail, updateBirthProfile, createPlannedActivity, cancelPlannedActivity, deletePlannedActivity, updateUserDayBuilderPrefs, setDailyWorkPreferences, clearDailyWorkPreferences, getUserById } from '../apps/web/lib/db';
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
    // HOME RECOMMENDATIONS: DAILY RHYTHM ALIGNMENT -- real, live Day
    // Builder suggestion (muted to only the SELF taxonomy group, which
    // resolves deterministically to a 'workout' SOLO suggestion with 3
    // real FIND-searched timing candidates for this fixed user+now) is
    // genuinely reordered/filtered by the real, now-wired
    // applyDailyRhythmPreference call inside resolveDayBuilderCandidates
    // -- never a mock, never a reimplementation.
    // ============================================================
    const dailyRhythmUser0 = await upsertUserByEmail({ email: 'test-daily-guidance-rhythm@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
    const dailyRhythmUserBase = await updateBirthProfile(dailyRhythmUser0.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
    await updateUserDayBuilderPrefs(dailyRhythmUserBase.id, {
      dayBuilderEnabled: true,
      dayBuilderMutedGroups: ['RELATIONSHIPS', 'FAMILY', 'SOCIAL', 'WORK', 'ENJOYMENT'], // only SELF (-> workout/walk/meditation) active
      dayBuilderPriorities: [],
      dayBuilderPriorityPersonIds: [],
      dayBuilderPrioritiesPromptDismissed: true,
    });

    // Baseline: no Daily Rhythm configured -> unchanged (DR2's own "no
    // work preferences -> unchanged behavior" rule, verified through
    // THIS PR's new call site, not just the already-tested pure function).
    await clearDailyWorkPreferences(dailyRhythmUserBase.id);
    const dailyRhythmUserUnconfigured = await getUserById(dailyRhythmUserBase.id);
    const baselineCandidates = await collectDayBuilderCandidates(dailyRhythmUserUnconfigured!, NOW);
    const workoutBaseline = baselineCandidates.find((c) => c.activityId === 'workout');
    check('DAILY RHYTHM (missing prefs): a real Day Builder workout suggestion is produced with multiple timing candidates', workoutBaseline !== undefined && workoutBaseline.timingCandidates.length > 1);
    const baselineFirstStart = workoutBaseline?.timingCandidates[0]?.start;

    // All candidates inside a wide work window (09:00-17:00 IST) -> no
    // outside-work alternative exists in this batch -> fallback to the
    // full, original, unfiltered set (never an empty/excluded result).
    await setDailyWorkPreferences(dailyRhythmUserBase.id, { workStart: '09:00', workEnd: '17:00', workDays: [1, 2, 3, 4, 5] });
    const dailyRhythmUserWideWork = await getUserById(dailyRhythmUserBase.id);
    const wideWorkCandidates = await collectDayBuilderCandidates(dailyRhythmUserWideWork!, NOW);
    const workoutWideWork = wideWorkCandidates.find((c) => c.activityId === 'workout');
    check('DAILY RHYTHM (all candidates inside a wide work window): fallback preserves the full original candidate count (never excluded)', workoutWideWork?.timingCandidates.length === workoutBaseline?.timingCandidates.length);
    check('DAILY RHYTHM (all candidates inside a wide work window): rank-1 candidate is unchanged from the unfiltered baseline', workoutWideWork?.timingCandidates[0]?.start === baselineFirstStart);

    // Narrower work window (10:00-17:00 IST) -> exactly one of the real
    // candidates (09:30 IST) falls outside it -> genuinely reordered:
    // the previously-non-rank-1 outside-work candidate is promoted to
    // rank 1, and the inside-work candidates are deprioritized away.
    await setDailyWorkPreferences(dailyRhythmUserBase.id, { workStart: '10:00', workEnd: '17:00', workDays: [1, 2, 3, 4, 5] });
    const dailyRhythmUserNarrowWork = await getUserById(dailyRhythmUserBase.id);
    const narrowWorkCandidates = await collectDayBuilderCandidates(dailyRhythmUserNarrowWork!, NOW);
    const workoutNarrowWork = narrowWorkCandidates.find((c) => c.activityId === 'workout');
    check('DAILY RHYTHM (one outside-work candidate exists): the preferred outside-work window is genuinely promoted to rank 1 (different from the unfiltered baseline)', workoutNarrowWork?.timingCandidates[0]?.start !== undefined && workoutNarrowWork.timingCandidates[0].start !== baselineFirstStart);
    check('DAILY RHYTHM (one outside-work candidate exists): the surviving set is strictly narrower than the unfiltered baseline (a real preference, not a no-op)', (workoutNarrowWork?.timingCandidates.length ?? 0) < (workoutBaseline?.timingCandidates.length ?? 0));

    // Non-workday (Daily Rhythm configured, but NOW's own weekday is not
    // among workDays) -> no workday restriction inherited, unchanged.
    await setDailyWorkPreferences(dailyRhythmUserBase.id, { workStart: '10:00', workEnd: '17:00', workDays: [0] }); // 2026-09-09 is a Wednesday (weekday 3), not Sunday (0)
    const dailyRhythmUserNonWorkday = await getUserById(dailyRhythmUserBase.id);
    const nonWorkdayCandidates = await collectDayBuilderCandidates(dailyRhythmUserNonWorkday!, NOW);
    const workoutNonWorkday = nonWorkdayCandidates.find((c) => c.activityId === 'workout');
    check('DAILY RHYTHM (non-configured workday): unchanged, no workday restriction inherited', workoutNonWorkday?.timingCandidates[0]?.start === baselineFirstStart && workoutNonWorkday?.timingCandidates.length === workoutBaseline?.timingCandidates.length);

    // Display/commit consistency (the critical requirement): the
    // candidate promoted to rank 1 by the narrow-work-window filter above
    // is EXACTLY the instant that reaches guidance.recommendations[...].timing
    // -- the same real DailyGuidanceRecommendation Home renders AND the
    // same value HomeDashboard.tsx's handlePlanOpportunity passes to the
    // existing commit/re-verification call (candidateStart: item.start) --
    // proven through the REAL, unmodified downstream engines
    // (selectOneCandidatePerFamily -> deriveWindowRanking -> #104), not
    // merely asserted.
    const narrowWorkReady = await buildPersonalDailyGuidance(dailyRhythmUserNarrowWork!, NOW);
    check('DAILY RHYTHM DISPLAY/COMMIT CONSISTENCY: buildPersonalDailyGuidance reaches READY for the Daily-Rhythm-reordered user', narrowWorkReady.status === 'READY');
    if (narrowWorkReady.status === 'READY') {
      const workoutRecommendation = narrowWorkReady.guidance.recommendations.find((r) => r.activityFamily === 'WORKOUT');
      check('DAILY RHYTHM DISPLAY/COMMIT CONSISTENCY: a WORKOUT recommendation is present', workoutRecommendation !== undefined);
      check(
        "DAILY RHYTHM DISPLAY/COMMIT CONSISTENCY: the recommendation's displayed/committed timing.start is EXACTLY the Daily-Rhythm-preferred (outside-work) instant, not the original unfiltered rank-1",
        workoutRecommendation?.timing.start === workoutNarrowWork?.timingCandidates[0]?.start && workoutRecommendation?.timing.start !== baselineFirstStart
      );
    }

    // Restore to unconfigured so this doesn't leak into the shared
    // fixture user's later assertions below (none currently depend on
    // it, but matches this file's own "leave state clean" discipline).
    await clearDailyWorkPreferences(dailyRhythmUserBase.id);

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
