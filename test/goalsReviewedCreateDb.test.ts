/**
 * Goals V2 Candidate B3 -- live-database proof of the explicit
 * reviewed-activities Goal-create contract, exercised directly against
 * the real POST /api/goals route handler (bypassing HTTP, same
 * duck-typed fakeRequest convention as test/goalActivityRhythmSetupDb.test.ts
 * / test/activityPreferencesApi.test.ts). No DB access for the pure
 * request-mode classifier itself -- see test/goals.test.ts for that.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/goalsReviewedCreateDb.test.ts
 */
import { upsertUserByEmail, updateBirthProfile, beginTransaction } from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { loadEligibleGoalDemand, createRealGoalDemandCandidatesDeps } from '../apps/web/lib/goalDemandCandidates';
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

/** Duck-typed stand-in for NextRequest -- see
 * test/goalActivityRhythmSetupDb.test.ts's own header comment for why a
 * real NextRequest is never imported here. */
function fakeRequest(cookie: string | undefined, jsonBody: unknown): any {
  return {
    cookies: { get: (name: string) => (cookie !== undefined && name === 'as_session' ? { value: cookie } : undefined) },
    json: async () => jsonBody,
  };
}

async function callCreateGoal(token: string | undefined, body: unknown): Promise<{ status: number; body: any }> {
  const res: any = await createGoal(fakeRequest(token, body));
  return { status: res.status, body: await res.json() };
}

async function main() {
  const user = await upsertUserByEmail({ email: 'test-b3-reviewed-create@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const other = await upsertUserByEmail({ email: 'test-b3-reviewed-create-other@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await updateBirthProfile(user.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  const token = createSessionToken(user.id, user.email);

  const cleanup = async () => {
    await sql(`DELETE FROM "GoalActivity" WHERE "userId" = ANY($1::text[])`, [[user.id, other.id]]);
    await sql(`DELETE FROM "Goal" WHERE "userId" = ANY($1::text[])`, [[user.id, other.id]]);
  };
  await cleanup();

  try {
    // ============================================================
    // 23/24. LEGACY COMPATIBILITY -- the exact shipped request shape still
    // works, unchanged, and creates exactly the same GoalActivities as
    // before this ticket.
    // ============================================================
    console.log('=== LEGACY COMPATIBILITY ===');
    const legacy = await callCreateGoal(token, { title: 'Get fitter (legacy)', templateCategory: 'GET_FITTER' });
    check('legacy: 200/201-shaped success', !!legacy.body?.goal?.id);
    check('legacy: exactly 3 GET_FITTER activities created', legacy.body.activities.length === 3);
    check('legacy: activities carry real template titles', legacy.body.activities.some((a: any) => a.title === 'Go for a run'));

    // ============================================================
    // 24. EXPLICIT REVIEW -- SUBSET. GET_FITTER template has A/B/C; submit
    // only A and C (B removed in review). No template re-expansion.
    // ============================================================
    console.log('=== EXPLICIT REVIEW: SUBSET ===');
    const subset = await callCreateGoal(token, {
      title: 'Get fitter (reviewed subset)',
      activities: [
        { title: 'Go for a run', activityId: 'workout' },
        { title: 'Stretch / mobility', activityId: 'task-7' },
      ],
    });
    check('subset: Goal created', !!subset.body?.goal?.id);
    check('subset: exactly 2 activities created (B removed, never reintroduced)', subset.body.activities.length === 2);
    check('subset: "Strength training session" (B) is absent', !subset.body.activities.some((a: any) => a.title === 'Strength training session'));
    check('subset: both kept activities present', subset.body.activities.some((a: any) => a.title === 'Go for a run') && subset.body.activities.some((a: any) => a.title === 'Stretch / mobility'));

    // ============================================================
    // 25. EXPLICIT REVIEW -- RENAME. Renamed title, valid existing
    // activityId preserved (never rematched from the new title).
    // ============================================================
    console.log('=== EXPLICIT REVIEW: RENAME ===');
    const renamed = await callCreateGoal(token, {
      title: 'Get fitter (renamed)',
      activities: [{ title: 'Morning cardio', activityId: 'workout' }],
    });
    check('rename: Goal created', !!renamed.body?.goal?.id);
    check('rename: renamed title persisted verbatim', renamed.body.activities[0].title === 'Morning cardio');
    check('rename: activityId preserved exactly as submitted (never rematched from the new title)', renamed.body.activities[0].activityId === 'workout');

    // ============================================================
    // 26. EXPLICIT REVIEW -- FREEFORM.
    // ============================================================
    console.log('=== EXPLICIT REVIEW: FREEFORM ===');
    const freeform = await callCreateGoal(token, {
      title: 'Learn Spanish',
      activities: [{ title: 'Practice pronunciation with a partner', activityId: null }],
    });
    check('freeform: Goal created', !!freeform.body?.goal?.id);
    check('freeform: exactly one freeform GoalActivity created', freeform.body.activities.length === 1 && freeform.body.activities[0].title === 'Practice pronunciation with a partner');
    check('freeform: activityId is null (never inferred from title)', freeform.body.activities[0].activityId === null);
    check('freeform: completion defaults to DONE', freeform.body.activities[0].completionKind === null);

    // ============================================================
    // 27. COMPLETION -- DURATION and MEASURED_TARGET preserved; omitted ->
    // DONE; invalid -> whole request rejected, zero writes.
    // ============================================================
    console.log('=== COMPLETION REQUIREMENT ===');
    const completion = await callCreateGoal(token, {
      title: 'Completion variety',
      activities: [
        { title: 'Meditate 10 minutes', activityId: 'meditation', completionRequirement: { kind: 'DURATION', targetValue: 10 } },
        { title: 'Drink water', activityId: null, completionRequirement: { kind: 'MEASURED_TARGET', targetValue: 2, unit: 'litres' } },
        { title: 'Call parents', activityId: null },
      ],
    });
    const durationRow = completion.body.activities.find((a: any) => a.title === 'Meditate 10 minutes');
    const measuredRow = completion.body.activities.find((a: any) => a.title === 'Drink water');
    const doneRow = completion.body.activities.find((a: any) => a.title === 'Call parents');
    check('DURATION preserved via canonical persisted fields', durationRow?.completionKind === 'DURATION' && durationRow?.completionTargetValue === 10);
    check('MEASURED_TARGET preserved via canonical persisted fields', measuredRow?.completionKind === 'MEASURED_TARGET' && measuredRow?.completionTargetValue === 2 && measuredRow?.completionUnit === 'litres');
    check('omitted completionRequirement -> DONE (all three columns null)', doneRow?.completionKind === null && doneRow?.completionTargetValue === null && doneRow?.completionUnit === null);

    const beforeInvalidCompletion = (await sql(`SELECT count(*)::int n FROM "Goal" WHERE "userId" = $1`, [user.id]))[0].n;
    const invalidCompletion = await callCreateGoal(token, {
      title: 'Invalid completion',
      activities: [{ title: 'Bad', activityId: null, completionRequirement: { kind: 'DURATION' } }], // missing required targetValue
    });
    check('invalid completionRequirement: whole request rejected (4xx)', invalidCompletion.status >= 400 && invalidCompletion.status < 500);
    const afterInvalidCompletion = (await sql(`SELECT count(*)::int n FROM "Goal" WHERE "userId" = $1`, [user.id]))[0].n;
    check('invalid completionRequirement: zero new Goal rows (no partial write)', afterInvalidCompletion === beforeInvalidCompletion);

    // ============================================================
    // 28. RHYTHM -- NONE/N_PER_WEEK persist correctly; invalid target
    // rejects, zero writes.
    // ============================================================
    console.log('=== RHYTHM ===');
    const rhythmOk = await callCreateGoal(token, {
      title: 'Rhythm variety',
      activities: [
        { title: 'Finite task', activityId: null },
        { title: 'Ongoing task', activityId: null, rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 3 } },
      ],
    });
    const finiteRow = rhythmOk.body.activities.find((a: any) => a.title === 'Finite task');
    const ongoingRow = rhythmOk.body.activities.find((a: any) => a.title === 'Ongoing task');
    check('omitted rhythm -> NONE', finiteRow?.rhythmKind === null && finiteRow?.rhythmTargetPerWeek === null);
    check('explicit N_PER_WEEK rhythm persists correctly', ongoingRow?.rhythmKind === 'N_PER_WEEK' && ongoingRow?.rhythmTargetPerWeek === 3);

    const beforeInvalidRhythm = (await sql(`SELECT count(*)::int n FROM "Goal" WHERE "userId" = $1`, [user.id]))[0].n;
    const invalidRhythm = await callCreateGoal(token, {
      title: 'Invalid rhythm',
      activities: [{ title: 'Bad rhythm', activityId: null, rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 0 } }], // zero is rejected
    });
    check('invalid Rhythm: whole request rejected (4xx)', invalidRhythm.status >= 400 && invalidRhythm.status < 500);
    const afterInvalidRhythm = (await sql(`SELECT count(*)::int n FROM "Goal" WHERE "userId" = $1`, [user.id]))[0].n;
    check('invalid Rhythm: zero new Goal rows', afterInvalidRhythm === beforeInvalidRhythm);

    // ============================================================
    // 29. INVALID ACTIVITY ID -- closes the known trust gap for this
    // route. Otherwise-valid Goal with one unknown non-null activityId.
    // ============================================================
    console.log('=== INVALID ACTIVITY ID (TRUST GAP CLOSED) ===');
    const beforeInvalidActivityId = (await sql(`SELECT count(*)::int n FROM "Goal" WHERE "userId" = $1`, [user.id]))[0].n;
    const invalidActivityId = await callCreateGoal(token, {
      title: 'Spoofed activity id',
      activities: [{ title: 'Looks legit', activityId: 'definitely-not-a-real-catalog-id' }],
    });
    check('invalid activityId: whole request rejected (4xx)', invalidActivityId.status >= 400 && invalidActivityId.status < 500);
    const afterInvalidActivityId = (await sql(`SELECT count(*)::int n FROM "Goal" WHERE "userId" = $1`, [user.id]))[0].n;
    check('invalid activityId: zero Goal rows created', afterInvalidActivityId === beforeInvalidActivityId);
    const afterInvalidActivityIdRows = (await sql(`SELECT count(*)::int n FROM "GoalActivity" ga JOIN "Goal" g ON g.id = ga."goalId" WHERE g."userId" = $1 AND g.title = 'Spoofed activity id'`, [user.id]))[0].n;
    check('invalid activityId: zero GoalActivity rows created', afterInvalidActivityIdRows === 0);

    // ============================================================
    // 30. EXPLICIT EMPTY -- activities: [] creates a Goal with zero
    // GoalActivities, and never expands templateCategory even if present.
    // ============================================================
    console.log('=== EXPLICIT EMPTY ===');
    const explicitEmpty = await callCreateGoal(token, { title: 'Explicit empty', activities: [], templateCategory: 'GET_FITTER' });
    check('explicit empty: Goal created', !!explicitEmpty.body?.goal?.id);
    check('explicit empty: zero GoalActivities (templateCategory never re-expanded in EXPLICIT_REVIEW mode)', explicitEmpty.body.activities.length === 0);

    // ============================================================
    // 31. AMBIGUOUS REQUEST -- both activities and activityRhythms present.
    // ============================================================
    console.log('=== AMBIGUOUS REQUEST ===');
    const beforeAmbiguous = (await sql(`SELECT count(*)::int n FROM "Goal" WHERE "userId" = $1`, [user.id]))[0].n;
    const ambiguous = await callCreateGoal(token, {
      title: 'Ambiguous',
      templateCategory: 'GET_FITTER',
      activityRhythms: [{ kind: 'NONE' }, { kind: 'NONE' }, { kind: 'NONE' }],
      activities: [{ title: 'Custom', activityId: null }],
    });
    check('ambiguous request: rejected (4xx), never silently picks one', ambiguous.status >= 400 && ambiguous.status < 500);
    const afterAmbiguous = (await sql(`SELECT count(*)::int n FROM "Goal" WHERE "userId" = $1`, [user.id]))[0].n;
    check('ambiguous request: zero new Goal rows', afterAmbiguous === beforeAmbiguous);

    // ============================================================
    // 32. MULTI-ROW ATOMIC FAILURE -- a later row invalid -> zero writes
    // for the WHOLE request, including the earlier, individually-valid
    // rows.
    // ============================================================
    console.log('=== MULTI-ROW ATOMIC FAILURE ===');
    const beforeAtomicFailure = (await sql(`SELECT count(*)::int n FROM "Goal" WHERE "userId" = $1`, [user.id]))[0].n;
    const atomicFailure = await callCreateGoal(token, {
      title: 'Atomic failure',
      activities: [
        { title: 'Valid one', activityId: null },
        { title: 'Valid two', activityId: null },
        { title: 'Invalid three', activityId: 'not-a-real-id' },
      ],
    });
    check('atomic failure: rejected (4xx)', atomicFailure.status >= 400 && atomicFailure.status < 500);
    const afterAtomicFailure = (await sql(`SELECT count(*)::int n FROM "Goal" WHERE "userId" = $1`, [user.id]))[0].n;
    check('atomic failure: zero new Goal rows (the two valid rows are never persisted alone)', afterAtomicFailure === beforeAtomicFailure);
    const atomicFailureActivityRows = (await sql(`SELECT count(*)::int n FROM "GoalActivity" WHERE title IN ('Valid one', 'Valid two')`))[0].n;
    check('atomic failure: zero GoalActivity rows for the otherwise-valid siblings', atomicFailureActivityRows === 0);

    // ============================================================
    // size bound -- a request exceeding MAX_REVIEWED_ACTIVITIES is
    // rejected outright, zero writes.
    // ============================================================
    console.log('=== SIZE BOUND ===');
    const beforeSizeBound = (await sql(`SELECT count(*)::int n FROM "Goal" WHERE "userId" = $1`, [user.id]))[0].n;
    const tooMany = await callCreateGoal(token, {
      title: 'Too many activities',
      activities: Array.from({ length: 21 }, (_, i) => ({ title: `Activity ${i}`, activityId: null })),
    });
    check('size bound: a request with 21 activities (over the 20 cap) is rejected', tooMany.status >= 400 && tooMany.status < 500);
    const afterSizeBound = (await sql(`SELECT count(*)::int n FROM "Goal" WHERE "userId" = $1`, [user.id]))[0].n;
    check('size bound: zero new Goal rows', afterSizeBound === beforeSizeBound);

    // ============================================================
    // ownership/security -- Goal is created for the authenticated user
    // only; no userId is ever accepted from the client.
    // ============================================================
    console.log('=== OWNERSHIP ===');
    const ownership = await callCreateGoal(token, { title: 'Ownership check', activities: [{ title: 'x', activityId: null }], userId: other.id } as any);
    check('ownership: the Goal is created for the AUTHENTICATED user, ignoring any client-supplied userId', ownership.body.goal.userId === user.id);
    check('ownership: unauthenticated request is rejected', (await callCreateGoal(undefined, { title: 'No auth', activities: [] })).status === 401);

    // ============================================================
    // 33. CANDIDATE A HANDOFF -- one focused composed test: explicit
    // reviewed Goal creation with a recurring Rhythm -> GoalActivity
    // persisted -> loadEligibleGoalDemand sees it. Does NOT rerun the
    // full A3.5 lifecycle (that regression lives in its own test file).
    // ============================================================
    console.log('=== CANDIDATE A HANDOFF ===');
    const handoff = await callCreateGoal(token, {
      title: 'Candidate A handoff',
      activities: [{ title: 'Read 10 pages', activityId: null, rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 4 } }],
    });
    const handoffActivityId = handoff.body.activities[0].id as string;
    const elig = await loadEligibleGoalDemand(createRealGoalDemandCandidatesDeps(), user.id, '2026-10-06', TZ);
    check('Candidate A handoff: A1 discovery sees the explicitly reviewed-created GoalActivity', elig.status === 'OK' && elig.candidates.some((c) => c.goalActivityId === handoffActivityId && c.remainingThisWeek === 4));

    if (!allPassed) {
      console.error('SOME GOALS REVIEWED CREATE CHECKS FAILED');
      process.exit(1);
    }
    console.log('ALL GOALS REVIEWED CREATE CHECKS PASSED');
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
