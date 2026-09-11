/**
 * Explicit Duration Preferences Foundation V1: live-database regression
 * suite for apps/web/lib/activityPreferences.ts's set/clear/list helpers
 * against the real "UserActivityPreference" table (migration 0033).
 *
 * Requires a real, reachable DATABASE_URL, same convention as every other
 * *Db.test.ts file in this repo:
 *
 *   DATABASE_URL="postgresql://..." npx tsx test/activityPreferencesDb.test.ts
 *
 * FOUNDATION ONLY: this file proves only the persistence/service contract
 * itself. No Day Builder, Daily Guidance, Forward Planner, or Ask Aura
 * consumer exists yet, so none is exercised here.
 *
 * CASCADE (item 19 of the implementation ticket): not tested here. No
 * delete-User helper exists anywhere in apps/web/lib/db.ts (checked before
 * writing this file), and no other *Db.test.ts file in this repo bypasses
 * db.ts to touch the raw pg Pool directly -- inventing either just for this
 * one assertion would be new, invasive scope for a foundation-only PR
 * (deleting a real User row in the shared dev DB). `onDelete: Cascade` is a
 * standard Prisma/Postgres FK behavior already used identically by
 * CustomCity and DailyReflection in this same schema, not a novel
 * mechanism this feature introduces.
 */
import { upsertUserByEmail, listUserActivityPreferenceRows, upsertUserActivityPreference, deleteUserActivityPreference } from '../apps/web/lib/db';
import { setPreferredActivityDuration, clearPreferredActivityDuration, listUserActivityPreferences } from '../apps/web/lib/activityPreferences';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

async function throwsAsync(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

const TZ = 'Asia/Kolkata';

async function main() {
  const userA = await upsertUserByEmail({ email: 'test-activity-preferences-owner-a@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const userB = await upsertUserByEmail({ email: 'test-activity-preferences-owner-b@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });

  try {
    // Clean slate for both test users before asserting anything -- this
    // file's own users are dedicated (never the shared daily-guidance/
    // forward-planner test users), but repeated runs of THIS file would
    // otherwise accumulate/collide with a prior run's rows.
    for (const activityId of ['workout', 'deep-work', 'coffee-tea', 'birthday-party', 'learning']) {
      await clearPreferredActivityDuration({ userId: userA.id, activityId });
      await clearPreferredActivityDuration({ userId: userB.id, activityId });
    }

    // ============================================================
    // 1-2. SET + READ
    // ============================================================
    await setPreferredActivityDuration({ userId: userA.id, activityId: 'workout', preferredDurationMinutes: 45 });
    let userAPrefs = await listUserActivityPreferences(userA.id);
    check('1-2. set then read: workout preference is present with the set value', userAPrefs.some((p) => p.activityId === 'workout' && p.preferredDurationMinutes === 45));

    // ============================================================
    // 3-4. UPDATE (upsert) an existing preference
    // ============================================================
    await setPreferredActivityDuration({ userId: userA.id, activityId: 'workout', preferredDurationMinutes: 60 });
    userAPrefs = await listUserActivityPreferences(userA.id);
    const workoutEntries = userAPrefs.filter((p) => p.activityId === 'workout');
    check('3. update: workout preference now reads back the new value (60)', workoutEntries.length === 1 && workoutEntries[0].preferredDurationMinutes === 60);
    check('4. exactly one row for (userA, workout) after update -- no duplicate created', workoutEntries.length === 1);

    // ============================================================
    // 31. UPSERT UNIQUENESS -- set 30 then 45, expect one row, 45
    // ============================================================
    await setPreferredActivityDuration({ userId: userA.id, activityId: 'deep-work', preferredDurationMinutes: 30 });
    await setPreferredActivityDuration({ userId: userA.id, activityId: 'deep-work', preferredDurationMinutes: 45 });
    const rawDeepWorkRows = (await listUserActivityPreferenceRows(userA.id)).filter((r) => r.activityId === 'deep-work');
    check('31. upsert uniqueness: setting the same (user, activity) twice leaves exactly one row', rawDeepWorkRows.length === 1);
    check('31. upsert uniqueness: the surviving row carries the LATEST value (45)', rawDeepWorkRows[0]?.preferredDurationMinutes === 45);

    // ============================================================
    // 5-6, 32. CLEAR + idempotent clear
    // ============================================================
    await clearPreferredActivityDuration({ userId: userA.id, activityId: 'deep-work' });
    userAPrefs = await listUserActivityPreferences(userA.id);
    check('5. clear: deep-work preference is gone after clearing', !userAPrefs.some((p) => p.activityId === 'deep-work'));

    const secondClearThrew = await throwsAsync(() => clearPreferredActivityDuration({ userId: userA.id, activityId: 'deep-work' }));
    check('6, 32. clearing an already-missing preference succeeds silently (no throw)', !secondClearThrew);

    const neverSetClearThrew = await throwsAsync(() => clearPreferredActivityDuration({ userId: userB.id, activityId: 'learning' }));
    check('32. clearing a preference that was NEVER set succeeds silently (no throw)', !neverSetClearThrew);

    // set, clear, clear again -- must never throw either time
    await setPreferredActivityDuration({ userId: userB.id, activityId: 'learning', preferredDurationMinutes: 30 });
    await clearPreferredActivityDuration({ userId: userB.id, activityId: 'learning' });
    const clearAgainThrew = await throwsAsync(() => clearPreferredActivityDuration({ userId: userB.id, activityId: 'learning' }));
    check('32. set -> clear -> clear again: neither clear call throws', !clearAgainThrew);

    // ============================================================
    // 7-8. USER ISOLATION -- runtime-tested, not just where-clause inspection
    // ============================================================
    await setPreferredActivityDuration({ userId: userA.id, activityId: 'coffee-tea', preferredDurationMinutes: 20 });
    await setPreferredActivityDuration({ userId: userB.id, activityId: 'coffee-tea', preferredDurationMinutes: 90 });
    const userAAfter = await listUserActivityPreferences(userA.id);
    const userBAfter = await listUserActivityPreferences(userB.id);
    check('7. user isolation: userA never sees userB\'s coffee-tea preference', userAAfter.find((p) => p.activityId === 'coffee-tea')?.preferredDurationMinutes === 20);
    check('7. user isolation: userB never sees userA\'s coffee-tea preference', userBAfter.find((p) => p.activityId === 'coffee-tea')?.preferredDurationMinutes === 90);
    check('8. two users independently hold the SAME activityId with different values', userAAfter.find((p) => p.activityId === 'coffee-tea')!.preferredDurationMinutes !== userBAfter.find((p) => p.activityId === 'coffee-tea')!.preferredDurationMinutes);

    // ============================================================
    // 9-10, 34. ONE USER, MULTIPLE ACTIVITIES -- deterministic ordering,
    // and activity-level (not family-level) independence, same as #115's
    // own family-collision proof (coffee-tea vs birthday-party, both SOCIAL).
    // ============================================================
    await setPreferredActivityDuration({ userId: userA.id, activityId: 'birthday-party', preferredDurationMinutes: 150 });
    // userA now holds: birthday-party (150), coffee-tea (20), workout (60)
    const userAFull = await listUserActivityPreferences(userA.id);
    check('9. one user can hold multiple independent activityId preferences', userAFull.length >= 3);
    check('34. family collision: coffee-tea and birthday-party (same SOCIAL family) hold independent values', userAFull.find((p) => p.activityId === 'coffee-tea')?.preferredDurationMinutes === 20 && userAFull.find((p) => p.activityId === 'birthday-party')?.preferredDurationMinutes === 150);

    const activityIds = userAFull.map((p) => p.activityId);
    const sortedActivityIds = [...activityIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    check('10. deterministic activityId ascending ordering', JSON.stringify(activityIds) === JSON.stringify(sortedActivityIds));

    // ============================================================
    // 11. UNKNOWN ACTIVITY REJECTED (at write time)
    // ============================================================
    const unknownSetThrew = await throwsAsync(() => setPreferredActivityDuration({ userId: userA.id, activityId: 'not-a-real-activity-xyz', preferredDurationMinutes: 45 }));
    check('11. setting a preference for an unknown activityId is rejected', unknownSetThrew);
    const unknownClearThrew = await throwsAsync(() => clearPreferredActivityDuration({ userId: userA.id, activityId: 'not-a-real-activity-xyz' }));
    check('11. clearing a preference for an unknown activityId is also rejected (consistent input contract with set)', unknownClearThrew);

    // ============================================================
    // 12-16. BOUNDARY / INVALID DURATIONS
    // ============================================================
    await setPreferredActivityDuration({ userId: userB.id, activityId: 'workout', preferredDurationMinutes: 15 });
    let userBBoundary = await listUserActivityPreferences(userB.id);
    check('12. lower boundary 15 is accepted and stored', userBBoundary.find((p) => p.activityId === 'workout')?.preferredDurationMinutes === 15);

    await setPreferredActivityDuration({ userId: userB.id, activityId: 'workout', preferredDurationMinutes: 360 });
    userBBoundary = await listUserActivityPreferences(userB.id);
    check('13. upper boundary 360 is accepted and stored', userBBoundary.find((p) => p.activityId === 'workout')?.preferredDurationMinutes === 360);

    check('14. 14 (just under floor) rejected at write time', await throwsAsync(() => setPreferredActivityDuration({ userId: userB.id, activityId: 'workout', preferredDurationMinutes: 14 })));
    check('15. 361 (just over ceiling) rejected at write time', await throwsAsync(() => setPreferredActivityDuration({ userId: userB.id, activityId: 'workout', preferredDurationMinutes: 361 })));
    check('16. decimal (45.5) rejected at write time', await throwsAsync(() => setPreferredActivityDuration({ userId: userB.id, activityId: 'workout', preferredDurationMinutes: 45.5 })));

    // After all the rejected attempts above, the stored value must still be
    // the last successfully-set one (360) -- a rejected write must never
    // partially apply.
    userBBoundary = await listUserActivityPreferences(userB.id);
    check('12-16. rejected writes never partially apply -- workout still reads back 360', userBBoundary.find((p) => p.activityId === 'workout')?.preferredDurationMinutes === 360);

    // ============================================================
    // 33. ARBITRARY VALID VALUE not in any catalog suggestedDurations
    // ============================================================
    await setPreferredActivityDuration({ userId: userB.id, activityId: 'deep-work', preferredDurationMinutes: 50 });
    const arbitraryPrefs = await listUserActivityPreferences(userB.id);
    check('33. an arbitrary valid duration (50) not in suggestedDurations is accepted and stored -- suggestedDurations are UI hints only', arbitraryPrefs.find((p) => p.activityId === 'deep-work')?.preferredDurationMinutes === 50);

    // ============================================================
    // 17-18, 29. RETIRED/UNKNOWN STORED ACTIVITYID -- fail-closed on READ,
    // never mutated/deleted by the read path itself. Insert directly via
    // the raw row-level DB function (bypassing service-layer validation,
    // exactly as the implementation ticket instructs) since
    // setPreferredActivityDuration would itself reject this activityId.
    // ============================================================
    const retiredRow = await upsertUserActivityPreference(userA.id, 'retired-activity-that-no-longer-exists', 99);
    const userAWithRetired = await listUserActivityPreferences(userA.id);
    check('17. a stored row with an activityId that no longer resolves is OMITTED from the read result', !userAWithRetired.some((p) => p.activityId === 'retired-activity-that-no-longer-exists'));

    const rawRowsAfterRead = await listUserActivityPreferenceRows(userA.id);
    check('18. the retired row itself still exists in the DB after the read -- filter, never mutate/delete', rawRowsAfterRead.some((r) => r.id === retiredRow.id && r.activityId === 'retired-activity-that-no-longer-exists'));

    // ============================================================
    // 20. createdAt/updatedAt -- light, non-brittle check: updatedAt moves
    // forward (or stays equal) after an upsert-update, createdAt never
    // changes across an update.
    // ============================================================
    const beforeUpdateRow = (await listUserActivityPreferenceRows(userA.id)).find((r) => r.activityId === 'workout')!;
    await new Promise((resolve) => setTimeout(resolve, 10));
    await setPreferredActivityDuration({ userId: userA.id, activityId: 'workout', preferredDurationMinutes: 75 });
    const afterUpdateRow = (await listUserActivityPreferenceRows(userA.id)).find((r) => r.activityId === 'workout')!;
    check('20. createdAt is stable across an update', new Date(beforeUpdateRow.createdAt).getTime() === new Date(afterUpdateRow.createdAt).getTime());
    check('20. updatedAt moves forward after an update', new Date(afterUpdateRow.updatedAt).getTime() >= new Date(beforeUpdateRow.updatedAt).getTime());
  } finally {
    // Idempotent cleanup -- leaves both dedicated test users with zero
    // preference rows, matching this repo's established *Db.test.ts
    // finally-block convention.
    for (const activityId of ['workout', 'deep-work', 'coffee-tea', 'birthday-party', 'learning']) {
      await clearPreferredActivityDuration({ userId: userA.id, activityId }).catch(() => undefined);
      await clearPreferredActivityDuration({ userId: userB.id, activityId }).catch(() => undefined);
    }
    // The synthetic retired-activity row (item 17/18/29) was inserted via
    // the raw, non-validating row-level primitive, so it is cleaned up the
    // same way -- clearPreferredActivityDuration would reject its
    // unknown activityId before ever reaching the DB.
    await deleteUserActivityPreference(userA.id, 'retired-activity-that-no-longer-exists').catch(() => undefined);
  }

  if (!allPassed) {
    console.error('\nSome Explicit Duration Preferences (live-database) checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL EXPLICIT DURATION PREFERENCES (LIVE-DATABASE) CHECKS PASSED');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
