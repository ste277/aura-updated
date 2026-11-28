/**
 * AURA-MR1 -- My Rhythm foundation, against a real (disposable CI/local)
 * Postgres with the full migration chain applied, including 0053.
 *
 * Proves, through the real route handlers and db.ts:
 *   A. backward compatibility: a row written with ONLY the pre-0053 columns
 *      reads as "active, no preferences" and behaves exactly as before;
 *   B. set / partially update / clear preferences (PATCH .../rhythm) and read
 *      them back (GET /api/goals/[goalId]);
 *   C. invalid inputs are rejected and leave the row untouched;
 *   D. preferences inconsistent with the recurrence rules are rejected;
 *   E. ownership: another user (or another Goal) can never read or modify a
 *      rhythm;
 *   F. pause: target/preferences preserved, confirmed plans untouched, no new
 *      recommendations (Goal demand) and no new sessions from any path;
 *   G. resume: eligibility returns under the unchanged weekly-count rules, and
 *      no duplicate session can be created.
 *
 * Never touches staging/Production: DATABASE_URL must point at a disposable
 * database (CI's postgres service, or an isolated local cluster).
 */
import { POST as plansRoute } from '../apps/web/app/api/plans/route';
import { boundHeaders } from './rel04BoundTestHeaders';
import { PATCH as rhythmRoute } from '../apps/web/app/api/goals/[goalId]/activities/[goalActivityId]/rhythm/route';
import { GET as goalDetailRoute } from '../apps/web/app/api/goals/[goalId]/route';
import { upsertUserByEmail, createGoalWithActivities, beginTransaction } from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { loadEligibleGoalDemand, createRealGoalDemandCandidatesDeps } from '../apps/web/lib/goalDemandCandidates';
import { getDatePartsInTimezone, addDaysToDateStr } from '../apps/web/lib/timezone';
import { localCalendarWeekStart } from '../apps/web/lib/goalActivityRhythm';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const TZ = 'Asia/Kolkata';

function fakeRequest(token: string | undefined, body: unknown): any {
  return {
    cookies: { get: (n: string) => (token !== undefined && n === 'as_session' ? { value: token } : undefined) },
    headers: boundHeaders(token),
    nextUrl: new URL('http://localhost/api/test'),
    json: async () => body,
  };
}

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

async function patchRhythm(token: string | undefined, goalId: string, goalActivityId: string, body: unknown): Promise<{ status: number; body: any }> {
  const res: any = await rhythmRoute(fakeRequest(token, body), { params: { goalId, goalActivityId } });
  return { status: res.status, body: await res.json() };
}
async function getGoal(token: string, goalId: string): Promise<{ status: number; body: any }> {
  const res: any = await goalDetailRoute(fakeRequest(token, undefined), { params: { goalId } });
  return { status: res.status, body: await res.json() };
}
async function postPlan(token: string, title: string, start: Date, goalActivityId: string): Promise<{ status: number; body: any }> {
  const end = new Date(start.getTime() + 30 * 60_000);
  const res: any = await plansRoute(fakeRequest(token, { title, plannedStartAt: start.toISOString(), plannedEndAt: end.toISOString(), durationMinutes: 30, windowType: 'NEUTRAL', goalActivityId }));
  return { status: res.status, body: await res.json() };
}

/** Every column of the GoalActivity row, as one comparable string. */
async function activityFingerprint(id: string): Promise<string> {
  const rows = await sql(`SELECT row_to_json(ga)::text AS j FROM "GoalActivity" ga WHERE id = $1`, [id]);
  return rows[0]?.j ?? 'MISSING';
}
async function activityRow(id: string): Promise<any> {
  return (await sql(`SELECT * FROM "GoalActivity" WHERE id = $1`, [id]))[0];
}

/** 10:00 IST on `localDate` (UTC 04:30) -- a fixed, unambiguous instant. */
function at10Ist(localDate: string): Date {
  return new Date(`${localDate}T04:30:00.000Z`);
}

async function main() {
  const emailA = 'mr1-foundation-a@example.com';
  const emailB = 'mr1-foundation-b@example.com';
  const purge = async () => {
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" IN (SELECT id FROM "User" WHERE email = ANY($1))`, [[emailA, emailB]]);
    await sql(`DELETE FROM "Goal" WHERE "userId" IN (SELECT id FROM "User" WHERE email = ANY($1))`, [[emailA, emailB]]);
  };
  await purge();

  const userA = await upsertUserByEmail({ email: emailA, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const userB = await upsertUserByEmail({ email: emailB, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const tokA = createSessionToken(userA.id, userA.email);
  const tokB = createSessionToken(userB.id, userB.email);

  // A full future local week (Monday..Sunday), at least 7 days out, so every
  // session below falls in ONE week regardless of today's weekday or time.
  const todayLocal = getDatePartsInTimezone(TZ, new Date()).dateStr;
  const weekMonday = localCalendarWeekStart(addDaysToDateStr(todayLocal, 8));
  const tue = addDaysToDateStr(weekMonday, 1);
  const wed = addDaysToDateStr(weekMonday, 2);
  const thu = addDaysToDateStr(weekMonday, 3);
  const deps = createRealGoalDemandCandidatesDeps();
  const demandFor = async (goalActivityId: string) => {
    const r = await loadEligibleGoalDemand(deps, userA.id, weekMonday, TZ);
    if (r.status !== 'OK') return 'LOAD_FAILED' as const;
    return r.candidates.find((c) => c.goalActivityId === goalActivityId) ?? null;
  };

  try {
    const { goal, activities } = await createGoalWithActivities({
      userId: userA.id,
      title: 'MR1 Fitness',
      targetDate: null,
      activities: [
        { title: 'MR1 Walk', activityId: null, rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 2 } },
        { title: 'MR1 Once', activityId: null, rhythm: { kind: 'NONE' } },
      ],
    });
    const { goal: otherGoal } = await createGoalWithActivities({ userId: userA.id, title: 'MR1 Other goal', targetDate: null, activities: [{ title: 'MR1 Other', activityId: null, rhythm: { kind: 'NONE' } }] });
    const walk = activities.find((a) => a.title === 'MR1 Walk')!;
    const onceActivity = activities.find((a) => a.title === 'MR1 Once')!;

    // ============================================================
    // A. Backward compatibility -- a row written with ONLY pre-0053 columns.
    // ============================================================
    const legacyId = `mr1-legacy-${Date.now()}`;
    await sql(
      `INSERT INTO "GoalActivity" (id, "userId", "goalId", title, "activityId", "rhythmKind", "rhythmTargetPerWeek", "updatedAt") VALUES ($1, $2, $3, 'MR1 Legacy 3x', NULL, 'N_PER_WEEK', 3, now())`,
      [legacyId, userA.id, goal.id]
    );
    const legacyRow = await activityRow(legacyId);
    check('A1. a pre-0053-shaped insert gets rhythmPausedAt NULL, weekdays {}, time NULL, duration NULL', legacyRow.rhythmPausedAt === null && same(legacyRow.rhythmPreferredWeekdays, []) && legacyRow.rhythmPreferredTimeOfDay === null && legacyRow.rhythmPreferredDurationMinutes === null);
    check('A2. its weekly policy is preserved exactly (N_PER_WEEK, 3)', legacyRow.rhythmKind === 'N_PER_WEEK' && legacyRow.rhythmTargetPerWeek === 3);
    const detailA = await getGoal(tokA, goal.id);
    const legacyView = detailA.body.activities.find((a: any) => a.id === legacyId);
    check('A3. GET goal detail exposes it as active with no preferences', detailA.status === 200 && legacyView.rhythmPaused === false && same(legacyView.rhythmPreferences, { preferredWeekdays: [], preferredTimeOfDay: null, preferredDurationMinutes: null }));
    check('A4. its rhythm view (weekly progress) is unchanged: 3 remaining', legacyView.rhythm.kind === 'N_PER_WEEK' && legacyView.rhythm.targetPerWeek === 3 && legacyView.rhythm.remainingThisWeek === 3);
    const legacyDemand = await demandFor(legacyId);
    check('A5. it is still offered as Goal demand (recommendations unchanged when preferences are unset)', legacyDemand !== null && legacyDemand !== 'LOAD_FAILED' && legacyDemand.remainingThisWeek === 3);
    const onceView = detailA.body.activities.find((a: any) => a.id === onceActivity.id);
    check('A6. a NONE activity reads as not paused, no preferences', onceView.rhythmPaused === false && same(onceView.rhythmPreferences.preferredWeekdays, []));
    const legacyRhythmOnly = await patchRhythm(tokA, goal.id, legacyId, { rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 4 } });
    check('A7. the R5 request shape { rhythm } alone still works unchanged (200, target updated)', legacyRhythmOnly.status === 200 && legacyRhythmOnly.body.rhythmTargetPerWeek === 4 && legacyRhythmOnly.body.rhythmPaused === false);

    // ============================================================
    // B. Create, partially update, clear and read back preferences.
    // ============================================================
    const setPrefs = await patchRhythm(tokA, goal.id, walk.id, { preferences: { preferredWeekdays: [4, 2], preferredTimeOfDay: 'MORNING', preferredDurationMinutes: 45 } });
    check('B1. setting all three preferences -> 200', setPrefs.status === 200);
    check('B2. response carries normalized preferences (weekdays sorted)', same(setPrefs.body.rhythmPreferences, { preferredWeekdays: [2, 4], preferredTimeOfDay: 'MORNING', preferredDurationMinutes: 45 }) && setPrefs.body.rhythmPaused === false);
    let walkRow = await activityRow(walk.id);
    check('B3. persisted columns match', same(walkRow.rhythmPreferredWeekdays, [2, 4]) && walkRow.rhythmPreferredTimeOfDay === 'MORNING' && walkRow.rhythmPreferredDurationMinutes === 45);
    check('B4. the weekly target is untouched by a preferences-only update', walkRow.rhythmKind === 'N_PER_WEEK' && walkRow.rhythmTargetPerWeek === 2);
    const partial = await patchRhythm(tokA, goal.id, walk.id, { preferences: { preferredTimeOfDay: 'EVENING' } });
    check('B5. a partial update changes only the provided field', partial.status === 200 && same(partial.body.rhythmPreferences, { preferredWeekdays: [2, 4], preferredTimeOfDay: 'EVENING', preferredDurationMinutes: 45 }));
    const detailB = await getGoal(tokA, goal.id);
    check('B6. GET goal detail returns the persisted preferences', same(detailB.body.activities.find((a: any) => a.id === walk.id).rhythmPreferences, { preferredWeekdays: [2, 4], preferredTimeOfDay: 'EVENING', preferredDurationMinutes: 45 }));
    const clearDuration = await patchRhythm(tokA, goal.id, walk.id, { preferences: { preferredDurationMinutes: null } });
    check('B7. clearing one preference (null) leaves the others', clearDuration.status === 200 && clearDuration.body.rhythmPreferredDurationMinutes === null && clearDuration.body.rhythmPreferredTimeOfDay === 'EVENING');
    const clearAll = await patchRhythm(tokA, goal.id, walk.id, { preferences: { preferredWeekdays: null, preferredTimeOfDay: null, preferredDurationMinutes: null } });
    walkRow = await activityRow(walk.id);
    check('B8. clearing every preference restores the defaults ({} / NULL / NULL)', clearAll.status === 200 && same(walkRow.rhythmPreferredWeekdays, []) && walkRow.rhythmPreferredTimeOfDay === null && walkRow.rhythmPreferredDurationMinutes === null);
    const clearWithEmptyArray = await patchRhythm(tokA, goal.id, walk.id, { preferences: { preferredWeekdays: [] } });
    check('B9. [] also clears weekdays', clearWithEmptyArray.status === 200 && same(clearWithEmptyArray.body.rhythmPreferredWeekdays, []));
    // Leave a realistic preference set in place for the pause scenarios.
    await patchRhythm(tokA, goal.id, walk.id, { preferences: { preferredWeekdays: [2, 3, 4], preferredTimeOfDay: 'MORNING', preferredDurationMinutes: 30 } });

    // ============================================================
    // C. Invalid inputs -> 400 and the row is untouched.
    // ============================================================
    const beforeInvalid = await activityFingerprint(walk.id);
    const invalidBodies: Array<[string, unknown]> = [
      ['weekday 7', { preferences: { preferredWeekdays: [7] } }],
      ['weekday -1', { preferences: { preferredWeekdays: [-1] } }],
      ['fractional weekday', { preferences: { preferredWeekdays: [1.5] } }],
      ['string weekday', { preferences: { preferredWeekdays: ['1'] } }],
      ['duplicate weekday', { preferences: { preferredWeekdays: [2, 2] } }],
      ['weekdays not an array', { preferences: { preferredWeekdays: '2,4' } }],
      ['time ANY', { preferences: { preferredTimeOfDay: 'ANY' } }],
      ['lowercase time', { preferences: { preferredTimeOfDay: 'morning' } }],
      ['unknown time', { preferences: { preferredTimeOfDay: 'DAWN' } }],
      ['duration 0', { preferences: { preferredDurationMinutes: 0 } }],
      ['negative duration', { preferences: { preferredDurationMinutes: -30 } }],
      ['duration below engine minimum', { preferences: { preferredDurationMinutes: 14 } }],
      ['duration above engine maximum', { preferences: { preferredDurationMinutes: 361 } }],
      ['fractional duration', { preferences: { preferredDurationMinutes: 30.5 } }],
      ['string duration', { preferences: { preferredDurationMinutes: '30' } }],
      ['unknown preference key', { preferences: { preferredWeekday: [1] } }],
      ['preferences not an object', { preferences: [1, 2] }],
      ['paused not boolean', { paused: 'yes' }],
      ['rhythm null', { rhythm: null }],
      ['invalid rhythm target', { rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 0 } }],
      ['empty body', {}],
      ['valid preferences + invalid paused (whole request rejected)', { preferences: { preferredTimeOfDay: 'NIGHT' }, paused: 1 }],
    ];
    for (const [label, body] of invalidBodies) {
      const r = await patchRhythm(tokA, goal.id, walk.id, body);
      check(`C. rejects ${label} with 400 and an error message`, r.status === 400 && typeof r.body.error === 'string');
    }
    check('C. the row is byte-identical after every rejected request', (await activityFingerprint(walk.id)) === beforeInvalid);

    // ============================================================
    // D. Consistency with the existing recurrence rules.
    // ============================================================
    const beforeConsistency = await activityFingerprint(walk.id);
    const tooFewDays = await patchRhythm(tokA, goal.id, walk.id, { preferences: { preferredWeekdays: [0] } });
    check('D1. 2x a week with only one preferred day -> 400 (unsatisfiable under once-per-day)', tooFewDays.status === 400);
    const raiseTarget = await patchRhythm(tokA, goal.id, walk.id, { rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 4 } });
    check('D2. raising the target above the preferred day count -> 400 (merged state validated)', raiseTarget.status === 400);
    check('D3. both rejected requests left the row unchanged', (await activityFingerprint(walk.id)) === beforeConsistency);
    const prefsOnOnce = await patchRhythm(tokA, goal.id, onceActivity.id, { preferences: { preferredTimeOfDay: 'MORNING' } });
    check('D4. preferences on a NONE (finite) activity -> 400', prefsOnOnce.status === 400);
    const pauseOnce = await patchRhythm(tokA, goal.id, onceActivity.id, { paused: true });
    check('D5. pausing a NONE (finite) activity -> 400', pauseOnce.status === 400);
    const noneWithPrefs = await patchRhythm(tokA, goal.id, walk.id, { rhythm: { kind: 'NONE' }, preferences: { preferredTimeOfDay: 'MORNING' } });
    check('D6. switching to NONE while setting a preference -> 400', noneWithPrefs.status === 400);

    // ============================================================
    // E. Ownership and authorization.
    // ============================================================
    const beforeOwnership = await activityFingerprint(walk.id);
    const crossUser = await patchRhythm(tokB, goal.id, walk.id, { paused: true });
    check('E1. another user cannot pause this rhythm (404)', crossUser.status === 404);
    const crossUserPrefs = await patchRhythm(tokB, goal.id, walk.id, { preferences: { preferredWeekdays: [0, 1, 2] } });
    check('E2. another user cannot change its preferences (404)', crossUserPrefs.status === 404);
    const wrongGoal = await patchRhythm(tokA, otherGoal.id, walk.id, { paused: true });
    check('E3. the activity under a different Goal id is not found (404)', wrongGoal.status === 404);
    const noSession = await patchRhythm(undefined, goal.id, walk.id, { paused: true });
    check('E4. unauthenticated -> 401', noSession.status === 401);
    const crossRead = await getGoal(tokB, goal.id);
    check('E5. another user cannot read the persisted preferences (GET 404)', crossRead.status === 404);
    check('E6. none of the refused requests changed the row', (await activityFingerprint(walk.id)) === beforeOwnership);

    // ============================================================
    // F. Pause -- confirmed plans untouched, no new recommendations/sessions.
    // ============================================================
    const confirmed = await postPlan(tokA, 'MR1 Walk', at10Ist(tue), walk.id);
    check('F0. setup: a confirmed rhythm session exists (200)', confirmed.status === 200 && typeof confirmed.body.id === 'string');
    const occurrencesBefore = await sql(`SELECT * FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [walk.id]);
    check('F0. setup: exactly one occurrence linked to it', occurrencesBefore.length === 1 && occurrencesBefore[0].plannedActivityId === confirmed.body.id);
    const planSnapshot = (await sql(`SELECT row_to_json(p)::text AS j FROM "PlannedActivity" p WHERE id = $1`, [confirmed.body.id]))[0].j;
    const occurrenceSnapshot = JSON.stringify(occurrencesBefore);
    const demandBeforePause = await demandFor(walk.id);
    check('F0. setup: before pausing it is offered as demand with 1 remaining', demandBeforePause !== null && demandBeforePause !== 'LOAD_FAILED' && demandBeforePause.remainingThisWeek === 1);

    const paused = await patchRhythm(tokA, goal.id, walk.id, { paused: true });
    walkRow = await activityRow(walk.id);
    check('F1. pause -> 200, rhythmPaused true, rhythmPausedAt set', paused.status === 200 && paused.body.rhythmPaused === true && walkRow.rhythmPausedAt instanceof Date);
    check('F2. pause preserves the weekly target and every preference', walkRow.rhythmKind === 'N_PER_WEEK' && walkRow.rhythmTargetPerWeek === 2 && same(walkRow.rhythmPreferredWeekdays, [2, 3, 4]) && walkRow.rhythmPreferredTimeOfDay === 'MORNING' && walkRow.rhythmPreferredDurationMinutes === 30);
    const planAfterPause = (await sql(`SELECT row_to_json(p)::text AS j, status FROM "PlannedActivity" p WHERE id = $1`, [confirmed.body.id]))[0];
    check('F3. the confirmed plan is byte-identical and still UPCOMING (not cancelled, skipped or completed)', planAfterPause.j === planSnapshot && planAfterPause.status === 'UPCOMING');
    check('F4. its occurrence row is unchanged', JSON.stringify(await sql(`SELECT * FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [walk.id])) === occurrenceSnapshot);
    check('F5. no execution/completion record was created by pausing', (await sql(`SELECT 1 FROM "GoalActivityExecution" WHERE "goalActivityId" = $1`, [walk.id])).length === 0);
    check('F6. a paused rhythm is no longer offered as Goal demand (Home / Plan My Day / weekly proposal source)', (await demandFor(walk.id)) === null);
    check('F7. other, unpaused rhythms are still offered (pause is per activity)', (await demandFor(legacyId)) !== null);

    const plansBefore = (await sql(`SELECT COUNT(*)::int AS c FROM "PlannedActivity" WHERE "userId" = $1`, [userA.id]))[0].c;
    const whilePaused = await postPlan(tokA, 'MR1 Walk', at10Ist(wed), walk.id);
    check('F8. a new Goal-linked session while paused is refused (400 GOAL_ACTIVITY_NOT_AVAILABLE)', whilePaused.status === 400 && whilePaused.body.code === 'GOAL_ACTIVITY_NOT_AVAILABLE');
    check('F9. ...and no plan was created (no orphan, no fallback finite link)', (await sql(`SELECT COUNT(*)::int AS c FROM "PlannedActivity" WHERE "userId" = $1`, [userA.id]))[0].c === plansBefore);
    check('F10. ...and no occurrence was created', (await sql(`SELECT COUNT(*)::int AS c FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [walk.id]))[0].c === 1);
    check('F11. ...and GoalActivity.plannedActivityId still points at the confirmed session', (await activityRow(walk.id)).plannedActivityId === confirmed.body.id);

    const pausedAtFirst = (await activityRow(walk.id)).rhythmPausedAt.getTime();
    await new Promise((r) => setTimeout(r, 20));
    const pausedAgain = await patchRhythm(tokA, goal.id, walk.id, { paused: true });
    check('F12. pausing again is idempotent: 200 and the ORIGINAL pause instant is kept', pausedAgain.status === 200 && (await activityRow(walk.id)).rhythmPausedAt.getTime() === pausedAtFirst);
    const prefsWhilePaused = await patchRhythm(tokA, goal.id, walk.id, { preferences: { preferredTimeOfDay: 'AFTERNOON' } });
    check('F13. editing preferences while paused keeps it paused', prefsWhilePaused.status === 200 && prefsWhilePaused.body.rhythmPaused === true && prefsWhilePaused.body.rhythmPreferredTimeOfDay === 'AFTERNOON');
    const detailPaused = (await getGoal(tokA, goal.id)).body.activities.find((a: any) => a.id === walk.id);
    check('F14. GET goal detail shows paused, preferences, and the unchanged weekly progress (1 committed)', detailPaused.rhythmPaused === true && detailPaused.rhythmPreferences.preferredTimeOfDay === 'AFTERNOON' && detailPaused.rhythm.kind === 'N_PER_WEEK');

    // ============================================================
    // G. Resume -- eligibility returns under the unchanged weekly rules; no duplicates.
    // ============================================================
    const resumed = await patchRhythm(tokA, goal.id, walk.id, { paused: false });
    walkRow = await activityRow(walk.id);
    check('G1. resume -> 200, rhythmPausedAt cleared, target and preferences intact', resumed.status === 200 && resumed.body.rhythmPaused === false && walkRow.rhythmPausedAt === null && walkRow.rhythmTargetPerWeek === 2 && same(walkRow.rhythmPreferredWeekdays, [2, 3, 4]));
    const demandAfterResume = await demandFor(walk.id);
    check('G2. offered as demand again with remaining = target 2 - 1 confirmed = 1 (existing weekly-count rule)', demandAfterResume !== null && demandAfterResume !== 'LOAD_FAILED' && demandAfterResume.remainingThisWeek === 1);
    check('G3. resuming created no plan and no occurrence by itself (no automatic scheduling)', (await sql(`SELECT COUNT(*)::int AS c FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [walk.id]))[0].c === 1 && (await sql(`SELECT COUNT(*)::int AS c FROM "PlannedActivity" WHERE "userId" = $1`, [userA.id]))[0].c === plansBefore);
    const sameDay = await postPlan(tokA, 'MR1 Walk', new Date(at10Ist(tue).getTime() + 3 * 3600_000), walk.id);
    check('G4. a second session on the SAME day is refused (once-per-day rule unchanged)', sameDay.status === 409 && sameDay.body.code === 'DAILY_CAPACITY_EXCEEDED');
    const second = await postPlan(tokA, 'MR1 Walk', at10Ist(wed), walk.id);
    check('G5. after resume, the second weekly session can be confirmed (200)', second.status === 200);
    const third = await postPlan(tokA, 'MR1 Walk', at10Ist(thu), walk.id);
    check('G6. a third session beyond the weekly target is refused (409 CAPACITY_EXCEEDED) -- no duplicate plan', third.status === 409 && third.body.code === 'CAPACITY_EXCEEDED');
    check('G7. exactly two occurrences and two live Walk plans exist', (await sql(`SELECT COUNT(*)::int AS c FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [walk.id]))[0].c === 2 && (await sql(`SELECT COUNT(*)::int AS c FROM "PlannedActivity" WHERE "userId" = $1 AND title = 'MR1 Walk' AND status = 'UPCOMING'`, [userA.id]))[0].c === 2);
    check('G8. with the target met, it is no longer offered as demand', (await demandFor(walk.id)) === null);

    // ============================================================
    // H. Switching back to NONE clears preferences and pause; finite path unchanged.
    // ============================================================
    await patchRhythm(tokA, goal.id, walk.id, { paused: true });
    const toNone = await patchRhythm(tokA, goal.id, walk.id, { rhythm: { kind: 'NONE' } });
    walkRow = await activityRow(walk.id);
    check('H1. { rhythm: NONE } -> 200 and clears preferences and pause', toNone.status === 200 && walkRow.rhythmKind === null && walkRow.rhythmPausedAt === null && same(walkRow.rhythmPreferredWeekdays, []) && walkRow.rhythmPreferredTimeOfDay === null && walkRow.rhythmPreferredDurationMinutes === null);
    check('H2. ...and leaves the confirmed sessions in place', (await sql(`SELECT COUNT(*)::int AS c FROM "PlannedActivity" WHERE "userId" = $1 AND title = 'MR1 Walk' AND status = 'UPCOMING'`, [userA.id]))[0].c === 2);
    const finitePlan = await postPlan(tokA, 'MR1 Once', at10Ist(thu), onceActivity.id);
    check('H3. a finite (NONE) activity still links through the unchanged legacy path (200, linked)', finitePlan.status === 200 && (await activityRow(onceActivity.id)).plannedActivityId === finitePlan.body.id);

    // ============================================================
    // I. Concurrent edits serialize (row lock) -- neither update is lost.
    // ============================================================
    const legacyNow = await activityRow(legacyId);
    check('I0. setup: legacy rhythm is weekly (4x) and active', legacyNow.rhythmTargetPerWeek === 4 && legacyNow.rhythmPausedAt === null);
    const [c1, c2] = await Promise.all([
      patchRhythm(tokA, goal.id, legacyId, { paused: true }),
      patchRhythm(tokA, goal.id, legacyId, { preferences: { preferredDurationMinutes: 50 } }),
    ]);
    const legacyAfter = await activityRow(legacyId);
    check('I1. two concurrent PATCHes both succeed and both effects persist', c1.status === 200 && c2.status === 200 && legacyAfter.rhythmPausedAt !== null && legacyAfter.rhythmPreferredDurationMinutes === 50);
  } finally {
    await purge().catch((e) => console.error('cleanup failed', e));
  }

  if (!allPassed) {
    console.error('\nSome checks FAILED.');
    process.exit(1);
  }
  console.log('\nAll checks passed.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
