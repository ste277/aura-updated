/**
 * Live-database tests for Personalized Daily Story V2 -- myDayOrchestrator.ts's
 * own wiring of DailyPriorityCoverage + priority-person-Moment resolution
 * into buildDailyStory(). Requires a real, reachable DATABASE_URL, same
 * convention as dayBuilderDb.test.ts -- NOT part of ci.yml's
 * math-core-tests job (no Postgres service provisioned there). Run
 * locally with a real DATABASE_URL set:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/personalizedDailyStoryDb.test.ts
 *
 * Creates one throwaway test user + one throwaway SavedPerson (idempotent
 * via email upsert), cleans up the SavedPerson it creates, but leaves the
 * User row in place -- same convention as dayBuilderDb.test.ts.
 */
import { upsertUserByEmail, getUserById, createSavedPerson, deleteSavedPerson, createPlannedActivity, cancelPlannedActivity, deletePlannedActivity, createAuraMoment, revokeAuraMoment, deleteAuraMoment, updateUserDayBuilderPrefs } from '../apps/web/lib/db';
import { buildMyDay } from '../apps/web/lib/myDayOrchestrator';
import { buildDailyStory } from '../apps/web/lib/dailyStory';
import { generatePublicMomentToken, defaultExpiresAt, explanationSnapshotFor } from '../apps/web/lib/auraMoments';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const LOCAL_DATE = '2026-08-24';
const NOW = new Date('2026-08-24T02:30:00.000Z'); // 8:00 AM IST

async function main() {
  const createdUser = await upsertUserByEmail({ email: 'test-personalized-story-owner@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  // Defensive pre-clean: this is a real, persistent database, and a
  // PREVIOUS run of this exact file (or one that crashed mid-way) may have
  // left this throwaway user's own priorities non-empty. `user` below MUST
  // reflect the reset, not the possibly-stale row upsertUserByEmail returned.
  const user = await updateUserDayBuilderPrefs(createdUser.id, { dayBuilderEnabled: true, dayBuilderMutedGroups: [], dayBuilderPriorities: [], dayBuilderPriorityPersonIds: [], dayBuilderPrioritiesPromptDismissed: false });

  const createdPersonIds: string[] = [];
  const createdMomentTokens: string[] = [];
  // deletePlannedActivity() only removes LOGGED/CANCELLED rows (an
  // Activity-Log-only operation) -- cancel first, then delete, so these
  // throwaway UPCOMING Plans never silently accumulate coverage across
  // separate runs of this file (the exact test-hygiene bug
  // dayBuilderDb.test.ts's own dismissal section already hit once, fixed
  // there via cleanup rather than by leaving rows behind).
  const createdPlanIds: string[] = [];

  try {
    // ============================================================
    // No preferences preserves current story behavior, end to end
    // through the real orchestrator (not just the pure function).
    // ============================================================
    const baseline = await buildMyDay(user, LOCAL_DATE, NOW);
    const directCall = buildDailyStory(baseline.agenda, 8 * 60);
    check('buildMyDay with no priorities configured -> story matches a plain buildDailyStory call', JSON.stringify(baseline.story) === JSON.stringify(directCall));

    // ============================================================
    // Selected priorities affect the real, DB-backed narrative --
    // a real Plan matching WORK marks it covered.
    // ============================================================
    const workPlan = await createPlannedActivity({
      userId: user.id,
      title: 'Deep Work',
      plannedStartAt: new Date('2026-08-24T04:00:00.000Z'),
      plannedEndAt: new Date('2026-08-24T05:00:00.000Z'),
      durationMinutes: 60,
      windowType: 'NEUTRAL',
    });
    createdPlanIds.push(workPlan.id);
    await updateUserDayBuilderPrefs(user.id, { dayBuilderEnabled: true, dayBuilderMutedGroups: [], dayBuilderPriorities: ['WORK', 'WELLBEING'], dayBuilderPriorityPersonIds: [], dayBuilderPrioritiesPromptDismissed: false });
    // Re-read so the in-memory user object reflects the just-persisted priorities.
    const userWithWork = (await getUserById(user.id))!;
    const withWorkCovered = await buildMyDay(userWithWork, LOCAL_DATE, NOW);
    check('coverage correctly identifies a represented priority (WORK, via the real Plan)', withWorkCovered.story.headline === 'Your day has structure');
    check('narrative mentions the covered priority factually', withWorkCovered.story.narrative.includes('focused work'));

    // ============================================================
    // Adding a suggestion updates agenda -> coverage -> story: same
    // buildMyDay call, called AGAIN after a second matching Plan lands,
    // with no special client-side fake narrative -- just a fresh derive.
    // ============================================================
    const workoutPlan = await createPlannedActivity({
      userId: user.id,
      title: 'Workout',
      plannedStartAt: new Date('2026-08-24T06:00:00.000Z'),
      plannedEndAt: new Date('2026-08-24T06:45:00.000Z'),
      durationMinutes: 45,
      windowType: 'NEUTRAL',
    });
    createdPlanIds.push(workoutPlan.id);
    const afterWorkoutAdded = await buildMyDay(userWithWork, LOCAL_DATE, NOW);
    check('adding a suggestion (a real Workout Plan) -> WELLBEING becomes covered too -> "A balanced day ahead"', afterWorkoutAdded.story.headline === 'A balanced day ahead');
    check('the story changed as a direct result of the new agenda, not a fake client-side rewrite', afterWorkoutAdded.story.narrative !== withWorkCovered.story.narrative);

    // ============================================================
    // Priority person can appear naturally in the owner-facing story --
    // a real AuraMoment with a real priority SavedPerson.
    // ============================================================
    const partner = await createSavedPerson(user.id, {
      name: 'Reena', relationshipType: 'PARTNER', birthDate: '1990-05-15', birthTime: '09:00', birthTimezone: TZ,
      birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707,
    });
    createdPersonIds.push(partner.id);

    const coffeeStart = new Date('2026-08-24T10:00:00.000Z'); // 3:30 PM IST -- later today relative to NOW (8 AM IST)
    const coffeeEnd = new Date('2026-08-24T10:45:00.000Z');
    const moment = await createAuraMoment({
      ownerUserId: user.id,
      publicToken: generatePublicMomentToken(),
      scope: 'SHARED',
      source: 'PLAN',
      activityId: 'coffee-tea',
      activityTitle: 'Coffee / Tea',
      activityIcon: '☕',
      startAt: coffeeStart,
      endAt: coffeeEnd,
      timezone: TZ,
      savedPersonId: partner.id,
      sharedPersonDisplayName: partner.name,
      senderDisplayName: 'Test Owner',
      ratingLabel: 'STRONG_TOGETHER_FIT',
      explanationSnapshot: explanationSnapshotFor('coffee-tea', 'SHARED'),
      expiresAt: defaultExpiresAt(coffeeEnd),
    });
    createdMomentTokens.push(moment.publicToken);

    await updateUserDayBuilderPrefs(user.id, { dayBuilderEnabled: true, dayBuilderMutedGroups: [], dayBuilderPriorities: ['RELATIONSHIPS'], dayBuilderPriorityPersonIds: [partner.id], dayBuilderPrioritiesPromptDismissed: false });
    const userWithPriorityPerson = (await getUserById(user.id))!;
    const withPriorityPersonMoment = await buildMyDay(userWithPriorityPerson, LOCAL_DATE, NOW);
    check('A priority person\'s real Moment -> "You\'ve made room for what matters"', withPriorityPersonMoment.story.headline === "You've made room for what matters");
    check('The story names the priority person naturally, using the real Moment\'s display name', withPriorityPersonMoment.story.narrative.includes('Reena'));
    check('No internal identifiers (SavedPerson id, activityId) leak into the narrative', !withPriorityPersonMoment.story.narrative.includes(partner.id) && !withPriorityPersonMoment.story.narrative.includes('coffee-tea'));

    // A moment that has ALREADY ENDED must not be treated as "later today".
    const farFuturePastNow = new Date('2026-08-24T12:00:00.000Z'); // 5:30 PM IST, after the coffee moment already ended (10:45Z)
    const afterMomentPassed = await buildMyDay(userWithPriorityPerson, LOCAL_DATE, farFuturePastNow);
    check('An already-ENDED Moment is no longer treated as "later today" (headline reverts to a non-person-specific one)', afterMomentPassed.story.headline !== "You've made room for what matters");
  } finally {
    for (const id of createdPersonIds) {
      await deleteSavedPerson(user.id, id);
    }
    for (const id of createdPlanIds) {
      await cancelPlannedActivity(user.id, id);
      await deletePlannedActivity(user.id, id);
    }
    for (const token of createdMomentTokens) {
      await revokeAuraMoment(user.id, token);
      await deleteAuraMoment(user.id, token);
    }
    // Restore to a clean, unconfigured state so a re-run of this file (or
    // any other file sharing this throwaway user) starts fresh.
    await updateUserDayBuilderPrefs(user.id, { dayBuilderEnabled: true, dayBuilderMutedGroups: [], dayBuilderPriorities: [], dayBuilderPriorityPersonIds: [], dayBuilderPrioritiesPromptDismissed: false });
  }

  if (!allPassed) {
    console.error('\nSome Personalized Daily Story DB checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL PERSONALIZED DAILY STORY DB CHECKS PASSED');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
