/**
 * Behavioral Personalization Foundation V1 (#110): live-database
 * regression suite for the real DB boundary this feature will eventually
 * be wired through -- listHabitLogsForInsights()/listPlannedActivitiesForDay()
 * (apps/web/lib/db.ts, both UNCHANGED) feeding
 * apps/web/lib/behavioralAffinity.ts's pure deriveBehavioralProfile().
 *
 * Requires a real, reachable DATABASE_URL, same convention as every other
 * *Db.test.ts file in this repo:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/behavioralAffinityDb.test.ts
 *
 * No delete function exists for HabitLog anywhere in this codebase (see
 * test/insightsHistoryCompletenessDb.test.ts's own doc comment, and
 * test/insightsHistoryCompletenessDb.test.ts's established pattern), so
 * this file does not attempt HabitLog cleanup -- repeated runs accumulate
 * a few extra rows for its own DEDICATED test users (never the shared
 * daily-guidance/forward-planner test user), an accepted low-cost
 * tradeoff. PlannedActivity rows created for the dedup proof ARE cleaned
 * up (cancel-then-delete is supported for Plans), matching every other
 * *Db.test.ts file's own established finally-block convention.
 *
 * MERGE-CRITICAL (deduplication): this file's own "one completion -> one
 * observation" section is the empirical proof behind
 * behavioralAffinity.ts's own design decision to read ONLY HabitLog, never
 * PlannedActivity, as its evidence source -- see that module's own doc
 * comment for the full reasoning this test proves.
 */
import { upsertUserByEmail, createHabitLog, listHabitLogsForInsights, listPlannedActivitiesForDay, createPlannedActivity, deletePlannedActivity, logPlannedActivity } from '../apps/web/lib/db';
import { deriveBehavioralProfile, BEHAVIORAL_AFFINITY_RECENCY_DAYS } from '../apps/web/lib/behavioralAffinity';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const NOW = new Date();

async function main() {
  const ownerA = await upsertUserByEmail({ email: 'test-behavioral-affinity-owner-a@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const ownerB = await upsertUserByEmail({ email: 'test-behavioral-affinity-owner-b@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });

  const sinceDate = new Date(NOW.getTime() - BEHAVIORAL_AFFINITY_RECENCY_DAYS * 24 * 60 * 60 * 1000);
  const createdPlanIds: string[] = [];

  try {
    // ============================================================
    // BASIC END-TO-END: real HabitLog rows, fetched via the real,
    // unmodified listHabitLogsForInsights(), produce the expected
    // affinity tier through the real, unmodified deriveBehavioralProfile().
    // ============================================================
    for (let i = 0; i < 5; i++) {
      await createHabitLog({
        userId: ownerA.id,
        activityTitle: 'Morning workout',
        activityId: 'workout',
        activeWindow: 'ABHIJIT',
        logMinuteOfDay: 360,
        logTimestamp: new Date(NOW.getTime() - i * 24 * 60 * 60 * 1000),
        durationMinutes: 45,
        logSource: 'MANUAL',
      });
    }

    const ownerALogs = await listHabitLogsForInsights(ownerA.id, sinceDate);
    check('real DB: listHabitLogsForInsights returns at least the 5 WORKOUT logs just created', ownerALogs.filter((l) => l.activityId === 'workout').length >= 5);

    const ownerAProfile = deriveBehavioralProfile(ownerALogs, TZ, NOW);
    const workout = ownerAProfile.activities.find((a) => a.activityFamily === 'WORKOUT')!;
    check('real DB end-to-end: 5 real WORKOUT HabitLog rows -> affinity STRONG', workout.affinity === 'STRONG' && workout.evidenceCount >= 5);
    check('real DB end-to-end: profile still returns the full 13-family cold-start-shaped vector', ownerAProfile.activities.length === 13);
    // Baseline DEEP_WORK evidenceCount BEFORE the dedup-proof Plan below is
    // created -- this file has no HabitLog cleanup (see its own doc
    // comment), so repeated runs genuinely accumulate real DEEP_WORK rows
    // for ownerA across executions. The dedup proof below must assert a
    // DELTA of +1 from this baseline, never a fixed absolute count, or it
    // would be a fragile assumption of a pristine DB rather than a
    // deterministic proof of the dedup invariant itself.
    const deepWorkBaselineCount = ownerAProfile.activities.find((a) => a.activityFamily === 'DEEP_WORK')!.evidenceCount;

    // ============================================================
    // CROSS-USER ISOLATION (brief item 22/36): User A's WORKOUT history
    // must never leak into User B's derived profile, and vice versa.
    // ============================================================
    for (let i = 0; i < 5; i++) {
      await createHabitLog({
        userId: ownerB.id,
        activityTitle: 'Focused coding session',
        activityId: 'deep-work',
        activeWindow: 'BRAHMA',
        logMinuteOfDay: 330,
        logTimestamp: new Date(NOW.getTime() - i * 24 * 60 * 60 * 1000),
        durationMinutes: 60,
        logSource: 'MANUAL',
      });
    }

    const ownerBLogs = await listHabitLogsForInsights(ownerB.id, sinceDate);
    check('CROSS-USER: listHabitLogsForInsights(ownerB) never returns any of ownerA\'s rows', ownerBLogs.every((l) => l.userId === ownerB.id));
    check('CROSS-USER: listHabitLogsForInsights(ownerA) never returns any of ownerB\'s rows', ownerALogs.every((l) => l.userId === ownerA.id));

    const ownerBProfile = deriveBehavioralProfile(ownerBLogs, TZ, NOW);
    const ownerBWorkout = ownerBProfile.activities.find((a) => a.activityFamily === 'WORKOUT')!;
    const ownerBDeepWork = ownerBProfile.activities.find((a) => a.activityFamily === 'DEEP_WORK')!;
    check('CROSS-USER: ownerB\'s own derived profile shows DEEP_WORK affinity from B\'s own real history', ownerBDeepWork.affinity === 'STRONG' && ownerBDeepWork.evidenceCount >= 5);
    check('CROSS-USER: ownerB\'s derived profile shows WORKOUT at 0 evidence -- ownerA\'s real DB rows never leaked in', ownerBWorkout.evidenceCount === 0);

    // ============================================================
    // MERGE-CRITICAL -- DEDUPLICATION PROOF: a real completed Plan
    // produces EXACTLY ONE HabitLog row (never a second, separate
    // observation), and behavioralAffinity.ts's own design (HabitLog-only
    // evidence) is the correct, non-duplicating choice.
    // ============================================================
    const plan = await createPlannedActivity({
      userId: ownerA.id,
      title: 'Deep Work Block',
      activityId: 'deep-work',
      plannedStartAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      plannedEndAt: new Date(NOW.getTime() - 30 * 60 * 1000), // already elapsed, so it's completable
      durationMinutes: 30,
      windowType: 'NEUTRAL',
    });
    createdPlanIds.push(plan.id);

    const { plan: loggedPlan, habitLog: planHabitLog } = await logPlannedActivity(ownerA.id, plan.id);
    check('DEDUP: completing the Plan sets status=LOGGED and stamps a real habitLogId', loggedPlan.status === 'LOGGED' && Boolean(loggedPlan.habitLogId));
    check('DEDUP: the returned HabitLog id matches the Plan\'s own habitLogId (the real, exact linkage)', planHabitLog.id === loggedPlan.habitLogId);
    check('DEDUP: the generated HabitLog carries logSource AURA_PLANNED and the Plan\'s own activityId copied verbatim', planHabitLog.logSource === 'AURA_PLANNED' && planHabitLog.activityId === 'deep-work');

    const plansInRange = await listPlannedActivitiesForDay(ownerA.id, sinceDate, new Date(NOW.getTime() + 24 * 60 * 60 * 1000));
    const matchingPlan = plansInRange.find((p) => p.id === plan.id);
    check('DEDUP: listPlannedActivitiesForDay independently confirms the SAME plan, LOGGED, with the SAME habitLogId', Boolean(matchingPlan) && matchingPlan!.status === 'LOGGED' && matchingPlan!.habitLogId === planHabitLog.id);

    const logsIncludingPlanCompletion = await listHabitLogsForInsights(ownerA.id, sinceDate);
    const matchingHabitLogRows = logsIncludingPlanCompletion.filter((l) => l.id === planHabitLog.id);
    check('DEDUP: listHabitLogsForInsights returns that exact HabitLog row EXACTLY ONCE (never duplicated at the query level)', matchingHabitLogRows.length === 1);

    // The actual invariant this whole section exists to prove: feeding
    // ONLY the HabitLog array (behavioralAffinity.ts's real, chosen
    // design) into deriveBehavioralProfile counts this one real-world
    // completion as exactly ONE additional observation for DEEP_WORK --
    // a DELTA of +1 from the baseline captured before this Plan was
    // created, never +2 from double counting the same completion via both
    // HabitLog and PlannedActivity. Asserting a delta (not a fixed
    // absolute count) is deliberate: this file has no HabitLog cleanup
    // (see its own doc comment), so repeated runs genuinely accumulate
    // real DEEP_WORK rows for ownerA -- a fixed "evidenceCount === 1"
    // assertion would only hold on a pristine DB and would itself be a
    // false negative on every subsequent run, not a real proof of dedup.
    const profileAfterPlanCompletion = deriveBehavioralProfile(logsIncludingPlanCompletion, TZ, NOW);
    const deepWorkAfter = profileAfterPlanCompletion.activities.find((a) => a.activityFamily === 'DEEP_WORK')!;
    check('DEDUP: the Plan-completion-originated HabitLog contributes exactly ONE additional observation to DEEP_WORK\'s evidenceCount (baseline+1), never two', deepWorkAfter.evidenceCount === deepWorkBaselineCount + 1);

    // Demonstrates WHY: naively also converting the LOGGED Plan into a
    // second synthetic observation (the mistake behavioralAffinity.ts's
    // own design deliberately avoids) would double the count to 2 for the
    // SAME real-world event -- proving the two sources really are the
    // same fact, not two independent ones, and confirming HabitLog-only
    // is the correct dedup-safe design rather than an unproven assumption.
    const wouldBeDoubleCounted = matchingHabitLogRows.length + (matchingPlan && matchingPlan.status === 'LOGGED' ? 1 : 0);
    check('DEDUP: naively summing "HabitLog rows" + "LOGGED Plans" for this one completion would incorrectly total 2, confirming why PlannedActivity is deliberately excluded from deriveBehavioralProfile\'s own input', wouldBeDoubleCounted === 2);

    // ============================================================
    // REAL DATE BOUNDS: an old HabitLog outside the recency window is
    // returned by a wide DB query but still correctly excluded by
    // deriveBehavioralProfile's own recency filter.
    // ============================================================
    const oldLog = await createHabitLog({
      userId: ownerA.id,
      activityTitle: 'Old meditation session',
      activityId: 'meditation',
      activeWindow: 'BRAHMA',
      logMinuteOfDay: 330,
      logTimestamp: new Date(NOW.getTime() - (BEHAVIORAL_AFFINITY_RECENCY_DAYS + 30) * 24 * 60 * 60 * 1000),
      durationMinutes: 20,
      logSource: 'MANUAL',
    });
    const wideRangeLogs = await listHabitLogsForInsights(ownerA.id, new Date(NOW.getTime() - (BEHAVIORAL_AFFINITY_RECENCY_DAYS + 60) * 24 * 60 * 60 * 1000));
    check('REAL DATE BOUNDS: a wide DB query genuinely returns the old, out-of-policy-window log', wideRangeLogs.some((l) => l.id === oldLog.id));
    const profileFromWideQuery = deriveBehavioralProfile(wideRangeLogs, TZ, NOW);
    const meditationFromWide = profileFromWideQuery.activities.find((a) => a.activityFamily === 'MEDITATION')!;
    check('REAL DATE BOUNDS: deriveBehavioralProfile\'s own recency filter still excludes it, regardless of what the DB query returned', meditationFromWide.evidenceCount === 0);
  } finally {
    // The one Plan this file creates ends up LOGGED (deliberately, for the
    // dedup proof above) by the time cleanup runs -- deletePlannedActivity
    // already accepts LOGGED directly (see its own doc comment), so there
    // is no UPCOMING state left to cancel first here.
    for (const planId of createdPlanIds) {
      await deletePlannedActivity(ownerA.id, planId).catch(() => undefined);
    }
  }

  if (!allPassed) {
    console.error('\nSome Behavioral Affinity (live-database) checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL BEHAVIORAL AFFINITY (LIVE-DATABASE) CHECKS PASSED');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
