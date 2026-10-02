/**
 * Goals V2 Candidate B3.1 -- live-database proof of Goal-create
 * idempotency, exercised directly against the real POST /api/goals route
 * handler (bypassing HTTP, same duck-typed fakeRequest convention as
 * test/goalsReviewedCreateDb.test.ts / test/goalActivityRhythmSetupDb.test.ts).
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/goalsCreateIdempotencyDb.test.ts
 */
import { upsertUserByEmail, updateBirthProfile, beginTransaction } from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { POST as createGoal } from '../apps/web/app/api/goals/route';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';

async function sql(text: string, params: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try {
    const r = await c.query(text, params);
    await c.query('COMMIT');
    return r.rows;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

function fakeRequest(cookie: string, jsonBody: unknown): any {
  return { cookies: { get: (name: string) => (name === 'as_session' ? { value: cookie } : undefined) }, json: async () => jsonBody };
}
async function callCreateGoal(token: string, body: unknown): Promise<{ status: number; body: any }> {
  const res: any = await createGoal(fakeRequest(token, body));
  return { status: res.status, body: await res.json() };
}
async function goalCount(userId: string): Promise<number> {
  return (await sql(`SELECT count(*)::int n FROM "Goal" WHERE "userId" = $1`, [userId]))[0].n;
}
async function activityCount(goalId: string): Promise<number> {
  return (await sql(`SELECT count(*)::int n FROM "GoalActivity" WHERE "goalId" = $1`, [goalId]))[0].n;
}

async function main() {
  const userA = await upsertUserByEmail({ email: 'test-b3-1-idempotency-a@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const userB = await upsertUserByEmail({ email: 'test-b3-1-idempotency-b@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await updateBirthProfile(userA.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  await updateBirthProfile(userB.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  const tokenA = createSessionToken(userA.id, userA.email);
  const tokenB = createSessionToken(userB.id, userB.email);

  const cleanup = async () => {
    await sql(`DELETE FROM "GoalActivity" WHERE "userId" = ANY($1::text[])`, [[userA.id, userB.id]]);
    await sql(`DELETE FROM "Goal" WHERE "userId" = ANY($1::text[])`, [[userA.id, userB.id]]);
  };
  await cleanup();

  try {
    // ============================================================
    // SEQUENTIAL REPLAY (section 16)
    // ============================================================
    console.log('=== SEQUENTIAL REPLAY ===');
    const seqReqId = 'client-req-sequential-1';
    const seqBody = { title: 'Get fitter', activities: [{ title: 'Go for a run', activityId: 'workout' }, { title: 'Stretch / mobility', activityId: 'task-7' }], clientRequestId: seqReqId };
    const seqFirst = await callCreateGoal(tokenA, seqBody);
    check('sequential: first request succeeds', !!seqFirst.body?.goal?.id);
    const seqGoalId = seqFirst.body.goal.id;
    check('sequential: exactly 1 Goal after first request', (await goalCount(userA.id)) === 1);
    check('sequential: exactly 2 GoalActivities after first request', (await activityCount(seqGoalId)) === 2);

    const seqSecond = await callCreateGoal(tokenA, seqBody);
    check('sequential: replay also returns 200 with the SAME Goal id', seqSecond.body?.goal?.id === seqGoalId);
    check('sequential: replay creates NO new Goal (still exactly 1)', (await goalCount(userA.id)) === 1);
    check('sequential: replay creates NO new GoalActivity rows (still exactly 2)', (await activityCount(seqGoalId)) === 2);

    // ============================================================
    // CONCURRENT REPLAY (section 17 -- mandatory, sequential alone is
    // insufficient proof)
    // ============================================================
    console.log('=== CONCURRENT REPLAY ===');
    const concReqId = 'client-req-concurrent-1';
    const concBody = { title: 'Meditate regularly', activities: [{ title: 'Meditate 10 minutes', activityId: 'meditation', completionRequirement: { kind: 'DURATION', targetValue: 10 } }], clientRequestId: concReqId };
    const [concResA, concResB] = await Promise.all([callCreateGoal(tokenA, concBody), callCreateGoal(tokenA, concBody)]);
    check('concurrent: both requests succeed (200, a real Goal id each)', !!concResA.body?.goal?.id && !!concResB.body?.goal?.id);
    check('concurrent: both requests resolve to the IDENTICAL Goal id', concResA.body.goal.id === concResB.body.goal.id);
    const concGoals = await sql(`SELECT id FROM "Goal" WHERE "userId" = $1 AND title = $2`, [userA.id, 'Meditate regularly']);
    check('concurrent: exactly ONE Goal row exists in the database (real concurrency, not sequential)', concGoals.length === 1);
    check('concurrent: exactly ONE GoalActivity set exists (no duplicate activities from the race)', (await activityCount(concResA.body.goal.id)) === 1);

    // ============================================================
    // CONCURRENCY STRESS SANITY (section 30) -- several INDEPENDENT
    // clientRequestIds, each submitted as its own concurrent pair, all
    // racing together in the SAME Promise.all. Catches a class of bug
    // sequential/single-pair testing cannot: accidental cross-request
    // state sharing (e.g. a closure/module-level variable leaking
    // between concurrent invocations of the same stateless route
    // handler). Require exactly one Goal per logical id, never cross-
    // contamination between the independent pairs.
    // ============================================================
    console.log('=== CONCURRENCY STRESS SANITY (multiple independent id pairs, raced together) ===');
    const stressReqIds = ['client-req-stress-1', 'client-req-stress-2', 'client-req-stress-3', 'client-req-stress-4', 'client-req-stress-5'];
    const stressBodies = stressReqIds.map((reqId, i) => ({ title: `Stress goal ${i}`, activities: [{ title: `Stress activity ${i}`, activityId: null }], clientRequestId: reqId }));
    const stressResults = await Promise.all(stressBodies.flatMap((b) => [callCreateGoal(tokenA, b), callCreateGoal(tokenA, b)]));
    check('stress: all 10 concurrent requests (5 pairs) succeeded', stressResults.every((r) => !!r.body?.goal?.id));
    for (let i = 0; i < stressReqIds.length; i += 1) {
      const [a, b] = [stressResults[i * 2], stressResults[i * 2 + 1]];
      check(`stress: pair ${i} resolved to the identical Goal id`, a.body.goal.id === b.body.goal.id);
      check(`stress: pair ${i} got its OWN title, never a sibling pair's`, a.body.goal.title === `Stress goal ${i}`);
    }
    const distinctStressGoalIds = new Set(stressResults.map((r) => r.body.goal.id));
    check('stress: exactly 5 distinct Goal ids total (one per logical clientRequestId, never 10, never fewer)', distinctStressGoalIds.size === 5);
    const stressGoalRows = await sql(`SELECT count(*)::int n FROM "Goal" WHERE "userId" = $1 AND title LIKE 'Stress goal %'`, [userA.id]);
    check('stress: exactly 5 Goal rows actually persisted', stressGoalRows[0].n === 5);

    // ============================================================
    // PAYLOAD MISMATCH (section 9/18) -- fails closed, never mutates
    // ============================================================
    console.log('=== PAYLOAD MISMATCH ===');
    const mismatchReqId = 'client-req-mismatch-1';
    const mismatchFirst = await callCreateGoal(tokenA, { title: 'Study consistently', activities: [{ title: 'Study session', activityId: 'learning' }], clientRequestId: mismatchReqId });
    check('mismatch setup: first request succeeds', !!mismatchFirst.body?.goal?.id);
    const mismatchGoalId = mismatchFirst.body.goal.id;
    const beforeMismatch = await sql(`SELECT title FROM "Goal" WHERE id = $1`, [mismatchGoalId]);

    const mismatchSecond = await callCreateGoal(tokenA, { title: 'Completely different goal', activities: [{ title: 'Something else', activityId: null }], clientRequestId: mismatchReqId });
    check('mismatch: a materially different request under the SAME clientRequestId is rejected (409)', mismatchSecond.status === 409);
    check('mismatch: response carries the IDEMPOTENCY_CONFLICT code', mismatchSecond.body?.code === 'IDEMPOTENCY_CONFLICT');
    check('mismatch: no second Goal was created', (await sql(`SELECT count(*)::int n FROM "Goal" WHERE "userId" = $1 AND title = 'Completely different goal'`, [userA.id]))[0].n === 0);
    const afterMismatch = await sql(`SELECT title FROM "Goal" WHERE id = $1`, [mismatchGoalId]);
    check('mismatch: the ORIGINAL Goal is never silently mutated', afterMismatch[0].title === beforeMismatch[0].title && afterMismatch[0].title === 'Study consistently');

    // ============================================================
    // CROSS-USER ISOLATION (section 19)
    // ============================================================
    console.log('=== CROSS-USER ISOLATION ===');
    const sharedReqId = 'client-req-shared-literal-X';
    const isoA = await callCreateGoal(tokenA, { title: 'User A goal', activities: [], clientRequestId: sharedReqId });
    const isoB = await callCreateGoal(tokenB, { title: 'User B goal', activities: [], clientRequestId: sharedReqId });
    check('cross-user: both users succeed independently with the identical literal clientRequestId', !!isoA.body?.goal?.id && !!isoB.body?.goal?.id);
    check('cross-user: two DISTINCT Goal ids (no collision across users)', isoA.body.goal.id !== isoB.body.goal.id);
    check('cross-user: User A got User A\'s own title back, never User B\'s', isoA.body.goal.title === 'User A goal');
    check('cross-user: User B got User B\'s own title back, never User A\'s', isoB.body.goal.title === 'User B goal');
    const isoAReplay = await callCreateGoal(tokenA, { title: 'User A goal', activities: [], clientRequestId: sharedReqId });
    check('cross-user: User A replaying the shared id returns User A\'s OWN Goal, never leaks User B\'s', isoAReplay.body.goal.id === isoA.body.goal.id && isoAReplay.body.goal.title === 'User A goal');

    // ============================================================
    // FAILURE RECOVERY (section 11/20) -- a request that fails
    // VALIDATION never reaches the INSERT at all in this architecture
    // (no separate claim-then-fill step exists to leave orphaned -- see
    // goalCreateIdempotency.ts's own doc comment), so there is no
    // "claim exists, Goal absent" state to inject/test directly. What IS
    // directly testable and is the property section 11 actually cares
    // about: a failed attempt under a given clientRequestId never
    // poisons a later, valid retry under that SAME id.
    // ============================================================
    console.log('=== FAILURE RECOVERY (retry after a validation failure is never poisoned) ===');
    const recoveryReqId = 'client-req-recovery-1';
    const recoveryFailed = await callCreateGoal(tokenA, { title: 'Recoverable goal', activities: [{ title: 'Bad', activityId: 'definitely-not-a-real-catalog-id' }], clientRequestId: recoveryReqId });
    check('failure recovery: the invalid-activityId attempt is rejected (4xx)', recoveryFailed.status >= 400 && recoveryFailed.status < 500);
    check('failure recovery: zero Goal created by the failed attempt', (await sql(`SELECT count(*)::int n FROM "Goal" WHERE "userId" = $1 AND title = 'Recoverable goal'`, [userA.id]))[0].n === 0);
    const recoveryRetry = await callCreateGoal(tokenA, { title: 'Recoverable goal', activities: [{ title: 'Good', activityId: null }], clientRequestId: recoveryReqId });
    check('failure recovery: a valid retry under the SAME clientRequestId succeeds cleanly (never permanently rejected)', !!recoveryRetry.body?.goal?.id);
    check('failure recovery: exactly ONE Goal exists after the retry', (await sql(`SELECT count(*)::int n FROM "Goal" WHERE "userId" = $1 AND title = 'Recoverable goal'`, [userA.id]))[0].n === 1);

    // ============================================================
    // REVIEWED-ACTIVITIES REPLAY (section 21) -- rename/remove/freeform/
    // Rhythm/completionRequirement together, replayed.
    // ============================================================
    console.log('=== REVIEWED ACTIVITIES REPLAY ===');
    const reviewedReqId = 'client-req-reviewed-1';
    const reviewedBody = {
      title: 'Reviewed activities replay',
      activities: [
        { title: 'Renamed cardio', activityId: 'workout', rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 4 } }, // renamed template row
        { title: 'Custom journaling', activityId: null, completionRequirement: { kind: 'MEASURED_TARGET', targetValue: 1, unit: 'entry' } }, // freeform
      ],
      clientRequestId: reviewedReqId,
    };
    const reviewedFirst = await callCreateGoal(tokenA, reviewedBody);
    check('reviewed replay setup: first request succeeds with exactly 2 activities', reviewedFirst.body?.activities?.length === 2);
    const reviewedGoalId = reviewedFirst.body.goal.id;
    const reviewedSecond = await callCreateGoal(tokenA, reviewedBody);
    check('reviewed replay: same Goal id returned', reviewedSecond.body.goal.id === reviewedGoalId);
    check('reviewed replay: no duplicate GoalActivity rows (still exactly 2)', (await activityCount(reviewedGoalId)) === 2);
    const reviewedRows = await sql(`SELECT title, "activityId", "completionKind", "completionTargetValue", "completionUnit", "rhythmKind", "rhythmTargetPerWeek" FROM "GoalActivity" WHERE "goalId" = $1 ORDER BY "createdAt"`, [reviewedGoalId]);
    check('reviewed replay: renamed title + preserved activityId + Rhythm intact', reviewedRows[0].title === 'Renamed cardio' && reviewedRows[0].activityId === 'workout' && reviewedRows[0].rhythmKind === 'N_PER_WEEK' && reviewedRows[0].rhythmTargetPerWeek === 4);
    check('reviewed replay: freeform MEASURED_TARGET completion intact', reviewedRows[1].title === 'Custom journaling' && reviewedRows[1].activityId === null && reviewedRows[1].completionKind === 'MEASURED_TARGET' && reviewedRows[1].completionTargetValue === 1 && reviewedRows[1].completionUnit === 'entry');

    // ============================================================
    // ZERO-ACTIVITIES REPLAY (section 22)
    // ============================================================
    console.log('=== ZERO ACTIVITIES REPLAY ===');
    const zeroReqId = 'client-req-zero-1';
    const zeroBody = { title: 'Zero activities replay', activities: [], clientRequestId: zeroReqId };
    const zeroFirst = await callCreateGoal(tokenA, zeroBody);
    check('zero-activity replay setup: first request creates a Goal with zero activities', !!zeroFirst.body?.goal?.id && zeroFirst.body.activities.length === 0);
    const zeroGoalId = zeroFirst.body.goal.id;
    const zeroSecond = await callCreateGoal(tokenA, zeroBody);
    check('zero-activity replay: same Goal id, still zero activities, no template expansion', zeroSecond.body.goal.id === zeroGoalId && zeroSecond.body.activities.length === 0);
    check('zero-activity replay: zero GoalActivity rows exist for this Goal', (await activityCount(zeroGoalId)) === 0);

    // ============================================================
    // LEGACY MODE (section 23) -- clientRequestId wraps BOTH request
    // modes uniformly (the idempotency block sits after both branches
    // converge on `activitiesWithRhythm`); this is an intentional design
    // choice, not an oversight -- pinned explicitly here.
    // ============================================================
    console.log('=== LEGACY MODE IS ALSO PROTECTED ===');
    const legacyReqId = 'client-req-legacy-1';
    const legacyBody = { title: 'Legacy template replay', templateCategory: 'STUDY_CONSISTENTLY', clientRequestId: legacyReqId };
    const legacyFirst = await callCreateGoal(tokenA, legacyBody);
    check('legacy mode setup: first legacy-template request succeeds', !!legacyFirst.body?.goal?.id && legacyFirst.body.activities.length === 1);
    const legacyGoalId = legacyFirst.body.goal.id;
    const legacySecond = await callCreateGoal(tokenA, legacyBody);
    check('legacy mode: replay returns the SAME Goal id (idempotency protects legacy template creation too)', legacySecond.body.goal.id === legacyGoalId);
    check('legacy mode: no duplicate GoalActivity from the legacy replay', (await activityCount(legacyGoalId)) === 1);

    // ============================================================
    // OMITTED clientRequestId -- confirms the additive/optional rollout:
    // UNCHANGED, unprotected behavior when no id is supplied.
    // ============================================================
    console.log('=== OMITTED clientRequestId (unchanged legacy behavior) ===');
    const noIdBody = { title: 'No idempotency requested', activities: [{ title: 'x', activityId: null }] };
    const noId1 = await callCreateGoal(tokenA, noIdBody);
    const noId2 = await callCreateGoal(tokenA, noIdBody);
    check('omitted clientRequestId: two identical requests create TWO separate Goals (no idempotency applied -- exact pre-B3.1 behavior)', noId1.body.goal.id !== noId2.body.goal.id);
    check('omitted clientRequestId: both succeed independently', !!noId1.body?.goal?.id && !!noId2.body?.goal?.id);

    if (!allPassed) {
      console.error('SOME GOALS CREATE IDEMPOTENCY CHECKS FAILED');
      process.exit(1);
    }
    console.log('ALL GOALS CREATE IDEMPOTENCY CHECKS PASSED');
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
