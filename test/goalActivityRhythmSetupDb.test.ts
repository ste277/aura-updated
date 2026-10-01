/**
 * Goals V2 Rhythm R5 -- live-database proof of the minimum Rhythm setup
 * UX, exercised directly against the real route handlers (bypassing
 * HTTP) -- same duck-typed fakeRequest convention as
 * test/activityPreferencesApi.test.ts and
 * test/goalActivityRhythmGoalDetailDb.test.ts (R4). Covers this ticket's
 * own sections 47-56: manual NONE/weekly creation, invalid rejection
 * (no partial write), finite/ongoing template behavior, first-plan/
 * complete-replan/target-met integration (reusing R3's own
 * persistAcceptedConstructedDay), edit semantics (prospective, history-
 * preserving, commitment-preserving), and user isolation.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/goalActivityRhythmSetupDb.test.ts
 */
import { upsertUserByEmail, updateBirthProfile, beginTransaction, listGoalActivitiesWithLinkedPlanStatus } from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import type { AcceptConstructedDayRequest, AcceptedProposedItem } from '../apps/web/lib/dayConstructorAcceptance';
import { deriveGoalActivityState } from '../apps/web/lib/goals';
import { getDatePartsInTimezone } from '../apps/web/lib/timezone';
import { localCalendarWeekStart } from '../apps/web/lib/goalActivityRhythm';
import { POST as createGoal } from '../apps/web/app/api/goals/route';
import { POST as addActivity } from '../apps/web/app/api/goals/[goalId]/activities/route';
import { PATCH as setRhythmRoute } from '../apps/web/app/api/goals/[goalId]/activities/[goalActivityId]/rhythm/route';
import { GET as getGoalDetail } from '../apps/web/app/api/goals/[goalId]/route';

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

function iso(s: string): Date {
  return new Date(s);
}
function window(date: string, start: string, end: string) {
  return { date, start: iso(start), end: iso(end), timezone: TZ, source: 'EXPLICIT_RANGE' as const };
}
function item(overrides: Partial<AcceptedProposedItem> & { intentId: string; start: Date; end: Date }): AcceptedProposedItem {
  return { title: 'Untitled', placementSource: 'SELECTED_CANDIDATE', ...overrides };
}

/** Duck-typed stand-in for NextRequest -- see activityPreferencesApi.test.ts's
 * own header comment for why a real NextRequest is never imported here. */
function fakeRequest(cookie: string | undefined, jsonBody: unknown): any {
  return {
    cookies: { get: (name: string) => (cookie !== undefined && name === 'as_session' ? { value: cookie } : undefined) },
    json: async () => jsonBody,
  };
}

async function callCreateGoal(token: string, body: unknown): Promise<{ status: number; body: any }> {
  const res: any = await createGoal(fakeRequest(token, body));
  return { status: res.status, body: await res.json() };
}
async function callAddActivity(token: string, goalId: string, body: unknown): Promise<{ status: number; body: any }> {
  const res: any = await addActivity(fakeRequest(token, body), { params: { goalId } });
  return { status: res.status, body: await res.json() };
}
async function callSetRhythm(token: string, goalId: string, goalActivityId: string, body: unknown): Promise<{ status: number; body: any }> {
  const res: any = await setRhythmRoute(fakeRequest(token, body), { params: { goalId, goalActivityId } });
  return { status: res.status, body: await res.json() };
}
async function callGetGoalDetail(token: string, goalId: string): Promise<{ status: number; body: any }> {
  const res: any = await getGoalDetail(fakeRequest(token, undefined), { params: { goalId } });
  return { status: res.status, body: await res.json() };
}

async function main() {
  const userA = await upsertUserByEmail({ email: 'test-rhythm-setup-a@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const userB = await upsertUserByEmail({ email: 'test-rhythm-setup-b@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await updateBirthProfile(userA.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  await updateBirthProfile(userB.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  const tokenA = createSessionToken(userA.id, userA.email);
  const tokenB = createSessionToken(userB.id, userB.email);

  const createdPlanIds: string[] = [];
  const createdGoalIds: string[] = [];
  // Raw-SQL hard delete -- same convention as goalActivityRhythmGoalDetailDb
  // .test.ts (R4); these production delete functions are not under test
  // here and are deliberately narrow about which statuses they accept.
  const cleanup = async () => {
    if (createdPlanIds.length > 0) await sql(`DELETE FROM "PlannedActivity" WHERE id = ANY($1::text[])`, [createdPlanIds]);
    if (createdGoalIds.length > 0) await sql(`DELETE FROM "Goal" WHERE id = ANY($1::text[])`, [createdGoalIds]);
  };

  try {
    // ============================================================
    // 47. Manual NONE -- default Once persists NONE; existing finite
    // behavior unchanged.
    // ============================================================
    {
      const created = await callCreateGoal(tokenA, { title: 'Scratch goal 47' });
      createdGoalIds.push(created.body.goal.id);
      const res = await callAddActivity(tokenA, created.body.goal.id, { title: 'Read a book', rhythm: { kind: 'NONE' } });
      check('47. manual add with explicit Once (NONE) succeeds', res.status === 200);
      check('47. persisted rhythmKind/rhythmTargetPerWeek are both null', res.body.rhythmKind === null && res.body.rhythmTargetPerWeek === null);

      const resOmitted = await callAddActivity(tokenA, created.body.goal.id, { title: 'Read another book' });
      check('47. manual add OMITTING rhythm entirely ALSO persists NONE (this ticket\'s own section 42 API compatibility)', resOmitted.status === 200 && resOmitted.body.rhythmKind === null && resOmitted.body.rhythmTargetPerWeek === null);
    }

    // ============================================================
    // 48. Manual weekly -- 3 times/week persists exact N_PER_WEEK(3); R4
    // reads exact 3.
    // ============================================================
    {
      const created = await callCreateGoal(tokenA, { title: 'Scratch goal 48' });
      createdGoalIds.push(created.body.goal.id);
      const res = await callAddActivity(tokenA, created.body.goal.id, { title: 'Swim', rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 3 } });
      check('48. manual add with 3/week succeeds', res.status === 200);
      check('48. persisted exactly rhythmKind N_PER_WEEK, rhythmTargetPerWeek 3', res.body.rhythmKind === 'N_PER_WEEK' && res.body.rhythmTargetPerWeek === 3);

      const detail = await callGetGoalDetail(tokenA, created.body.goal.id);
      const activity = detail.body.activities.find((a: any) => a.id === res.body.id);
      check('48. R4 Goal Detail reads back the exact same N (3), never rounded/altered', activity.rhythm.kind === 'N_PER_WEEK' && activity.rhythm.targetPerWeek === 3);
    }

    // ============================================================
    // 49. Invalid -- 0/negative/fractional/missing-target-while-weekly all
    // rejected; no partial GoalActivity write.
    // ============================================================
    {
      const created = await callCreateGoal(tokenA, { title: 'Scratch goal 49' });
      createdGoalIds.push(created.body.goal.id);
      const goalId = created.body.goal.id;

      const zero = await callAddActivity(tokenA, goalId, { title: 'Bad zero', rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 0 } });
      check('49. targetPerWeek 0 rejected (400)', zero.status === 400);
      const negative = await callAddActivity(tokenA, goalId, { title: 'Bad negative', rhythm: { kind: 'N_PER_WEEK', targetPerWeek: -3 } });
      check('49. targetPerWeek -3 rejected (400), never coerced to 3', negative.status === 400);
      const fractional = await callAddActivity(tokenA, goalId, { title: 'Bad fractional', rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 2.5 } });
      check('49. targetPerWeek 2.5 rejected (400), never rounded', fractional.status === 400);
      const missing = await callAddActivity(tokenA, goalId, { title: 'Bad missing', rhythm: { kind: 'N_PER_WEEK' } });
      check('49. N_PER_WEEK with no targetPerWeek at all rejected (400)', missing.status === 400);
      const nonNumber = await callAddActivity(tokenA, goalId, { title: 'Bad string', rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 'three' } });
      check('49. targetPerWeek "three" (non-number) rejected (400)', nonNumber.status === 400);

      const rowsAfter = await sql(`SELECT title FROM "GoalActivity" WHERE "goalId" = $1`, [goalId]);
      check('49. no partial GoalActivity write occurred for any of the 5 rejected attempts (zero rows)', rowsAfter.length === 0);

      // Same invalid set, but through the template-creation path
      // (activityRhythms) -- this ticket's own section 49 "no partial
      // GoalActivity write" applies there too (createGoalWithActivities's
      // own transaction).
      const badTemplate = await callCreateGoal(tokenA, { title: 'Bad template goal', templateCategory: 'GET_FITTER', activityRhythms: [{ kind: 'N_PER_WEEK', targetPerWeek: 0 }, { kind: 'NONE' }, { kind: 'NONE' }] });
      check('49. an invalid entry inside activityRhythms rejects the WHOLE Goal creation request (400)', badTemplate.status === 400);
      check('49. no Goal row was created for the rejected template request', (await sql(`SELECT id FROM "Goal" WHERE title = 'Bad template goal'`)).length === 0);

      const mismatchedLength = await callCreateGoal(tokenA, { title: 'Mismatched goal', templateCategory: 'GET_FITTER', activityRhythms: [{ kind: 'NONE' }] });
      check('49. activityRhythms whose length does not match the template\'s own activity count is rejected (400)', mismatchedLength.status === 400);
    }

    // ============================================================
    // 50. Template finite -- FINISH_PROJECT remains NONE for all
    // activities absent explicit override.
    // ============================================================
    {
      const created = await callCreateGoal(tokenA, { title: 'Finite template 50', templateCategory: 'FINISH_PROJECT' });
      createdGoalIds.push(created.body.goal.id);
      check('50. FINISH_PROJECT creates exactly 3 activities', created.body.activities.length === 3);
      check('50. every FINISH_PROJECT activity persists NONE (both columns null)', created.body.activities.every((a: any) => a.rhythmKind === null && a.rhythmTargetPerWeek === null));
    }

    // ============================================================
    // 51. Template ongoing -- for every template classified ongoing
    // (GET_FITTER/MEDITATE_REGULARLY/STUDY_CONSISTENTLY), exact N is
    // NEVER persisted without an explicit user choice (no hidden
    // default) when activityRhythms is omitted.
    // ============================================================
    {
      for (const category of ['GET_FITTER', 'MEDITATE_REGULARLY', 'STUDY_CONSISTENTLY']) {
        const created = await callCreateGoal(tokenA, { title: `Ongoing template 51 ${category}`, templateCategory: category });
        createdGoalIds.push(created.body.goal.id);
        check(`51. ${category} creation OMITTING activityRhythms persists NONE for every activity (no hidden default)`, created.body.activities.every((a: any) => a.rhythmKind === null && a.rhythmTargetPerWeek === null));
      }

      // An explicit, user-chosen activityRhythms DOES persist exactly as
      // given -- proving the mechanism works, not merely that omission is
      // safe.
      const explicit = await callCreateGoal(tokenA, { title: 'Explicit GET_FITTER 51', templateCategory: 'GET_FITTER', activityRhythms: [{ kind: 'N_PER_WEEK', targetPerWeek: 3 }, { kind: 'NONE' }, { kind: 'N_PER_WEEK', targetPerWeek: 2 }] });
      createdGoalIds.push(explicit.body.goal.id);
      check('51. an explicit activityRhythms choice persists EXACTLY as given, per activity (3/week, NONE, 2/week)', explicit.body.activities[0].rhythmTargetPerWeek === 3 && explicit.body.activities[1].rhythmKind === null && explicit.body.activities[2].rhythmTargetPerWeek === 2);
    }

    // ============================================================
    // 52-54. First plan / complete+replan / target met -- reusing R3's
    // own persistAcceptedConstructedDay directly (bypassing HTTP), same
    // convention as test/goalActivityRhythmMaterializationDb.test.ts.
    // ============================================================
    async function makeOccurrenceFor(userId: string, goalActivityId: string, intentId: string, startIso: string, endIso: string, windowDate: string) {
      const req: AcceptConstructedDayRequest = {
        clientRequestId: `r5-rhythm-${intentId}-${Date.now()}-${Math.random()}`,
        constructionWindow: window(windowDate, `${windowDate}T06:00:00Z`, `${windowDate}T20:00:00Z`),
        proposedItems: [item({ intentId, start: iso(startIso), end: iso(endIso) })],
      };
      return persistAcceptedConstructedDay(userId, req, iso(`${windowDate}T05:00:00Z`), new Map([[intentId, goalActivityId]]));
    }
    async function derivedStateOf(userId: string, goalId: string, goalActivityId: string): Promise<string | null> {
      const rows = await listGoalActivitiesWithLinkedPlanStatus(userId, goalId);
      const row = rows.find((r) => r.id === goalActivityId);
      if (!row) return null;
      return deriveGoalActivityState({ status: row.status, plannedActivityId: row.plannedActivityId, linkedPlanStatus: row.linkedPlanStatus });
    }

    // 52. First occurrence.
    {
      const created = await callCreateGoal(tokenA, { title: 'First plan 52', templateCategory: null as any });
      const goalId = created.body.goal.id;
      createdGoalIds.push(goalId);
      const added = await callAddActivity(tokenA, goalId, { title: 'Meditate 10 minutes', rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 3 } });
      const gaId = added.body.id;

      const result = await makeOccurrenceFor(userA.id, gaId, 'p52', '2026-09-22T10:00:00Z', '2026-09-22T10:10:00Z', '2026-09-22');
      check('52. first occurrence materializes successfully (SAVED)', result.status === 'SAVED');
      if (result.status === 'SAVED') createdPlanIds.push(result.plans[0].id);
      const occRows = await sql(`SELECT id FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [gaId]);
      check('52. exactly one GoalActivityOccurrence row created', occRows.length === 1);
      check('52. derivedState is PLANNED after the first occurrence', (await derivedStateOf(userA.id, goalId, gaId)) === 'PLANNED');
    }

    // 53. Complete + replan.
    {
      const created = await callCreateGoal(tokenA, { title: 'Complete replan 53', templateCategory: null as any });
      const goalId = created.body.goal.id;
      createdGoalIds.push(goalId);
      const added = await callAddActivity(tokenA, goalId, { title: 'Meditate 10 minutes', rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 3 } });
      const gaId = added.body.id;

      const r1 = await makeOccurrenceFor(userA.id, gaId, 'p53a', '2026-09-23T10:00:00Z', '2026-09-23T10:10:00Z', '2026-09-23');
      check('53. O1/P1 materializes', r1.status === 'SAVED');
      if (r1.status !== 'SAVED') throw new Error('setup failed');
      const p1Id = r1.plans[0].id;
      createdPlanIds.push(p1Id);

      await sql(`UPDATE "PlannedActivity" SET status = 'LOGGED', "loggedAt" = now() WHERE id = $1`, [p1Id]);

      const r2 = await makeOccurrenceFor(userA.id, gaId, 'p53b', '2026-09-23T11:00:00Z', '2026-09-23T11:10:00Z', '2026-09-23');
      check('53. O2/P2 materializes after O1 completes', r2.status === 'SAVED');
      if (r2.status !== 'SAVED') throw new Error('setup failed');
      const p2Id = r2.plans[0].id;
      createdPlanIds.push(p2Id);

      check('53. O1/P1 and O2/P2 are TWO DISTINCT occurrence rows', p1Id !== p2Id);
      const gaRow = (await sql(`SELECT "plannedActivityId" FROM "GoalActivity" WHERE id = $1`, [gaId]))[0];
      check('53. GoalActivity\'s current pointer is now P2 (the new one), not P1', gaRow.plannedActivityId === p2Id);
      const p1Status = (await sql(`SELECT status FROM "PlannedActivity" WHERE id = $1`, [p1Id]))[0].status;
      check('53. P1 remains historical LOGGED, untouched by the replan', p1Status === 'LOGGED');
      const occRows = await sql(`SELECT "plannedActivityId" FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1 ORDER BY "createdAt"`, [gaId]);
      check('53. exactly two occurrence rows exist, one per materialization', occRows.length === 2 && occRows[0].plannedActivityId === p1Id && occRows[1].plannedActivityId === p2Id);
    }

    // 54. Target met -- no third materialization same week.
    {
      const created = await callCreateGoal(tokenA, { title: 'Target met 54', templateCategory: null as any });
      const goalId = created.body.goal.id;
      createdGoalIds.push(goalId);
      const added = await callAddActivity(tokenA, goalId, { title: 'Meditate 10 minutes', rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 2 } });
      const gaId = added.body.id;

      const r1 = await makeOccurrenceFor(userA.id, gaId, 'p54a', '2026-09-24T10:00:00Z', '2026-09-24T10:10:00Z', '2026-09-24');
      if (r1.status === 'SAVED') { createdPlanIds.push(r1.plans[0].id); await sql(`UPDATE "PlannedActivity" SET status = 'LOGGED', "loggedAt" = now() WHERE id = $1`, [r1.plans[0].id]); }
      const r2 = await makeOccurrenceFor(userA.id, gaId, 'p54b', '2026-09-24T11:00:00Z', '2026-09-24T11:10:00Z', '2026-09-24');
      if (r2.status === 'SAVED') { createdPlanIds.push(r2.plans[0].id); await sql(`UPDATE "PlannedActivity" SET status = 'LOGGED', "loggedAt" = now() WHERE id = $1`, [r2.plans[0].id]); }
      check('54. both weekly occurrences materialize (target 2, 2 completed)', r1.status === 'SAVED' && r2.status === 'SAVED');

      const r3 = await makeOccurrenceFor(userA.id, gaId, 'p54c', '2026-09-24T12:00:00Z', '2026-09-24T12:10:00Z', '2026-09-24');
      check('54. a THIRD materialization attempt in the same week is refused (capacity exhausted), never a third occurrence', r3.status !== 'SAVED');
      const occRows = await sql(`SELECT id FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [gaId]);
      check('54. exactly 2 occurrence rows exist, never 3', occRows.length === 2);
    }

    // ============================================================
    // 55/56. Edit semantics -- prospective, history-preserving,
    // commitment-preserving. 3->2, 2->4, Rhythm->NONE, NONE->Rhythm.
    //
    // Unlike 52-54 (which only assert STRUCTURAL facts -- row counts,
    // derivedState, SAVED status -- independent of any particular week),
    // this section also reads remainingThisWeek/eligibleForAnotherOccurrence
    // through the real Goal Detail API, which always computes against REAL
    // "today" (app/api/goals/[goalId]/route.ts's own getDatePartsInTimezone
    // call, never a test-injected date). So these three occurrences must
    // land in the ACTUAL current local week -- a fixed fictional date here
    // would silently fall into a different, non-"this week" bucket and
    // read back as 0 facts, same lesson already learned in
    // test/goalActivityRhythmGoalDetailDb.test.ts (R4).
    // ============================================================
    const todayLocalDate55 = getDatePartsInTimezone(TZ, new Date()).dateStr;
    const thisWeekStart55 = localCalendarWeekStart(todayLocalDate55);
    const thisWeekWed55 = (() => {
      const [y, m, d] = thisWeekStart55.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      dt.setUTCDate(dt.getUTCDate() + 2);
      return dt.toISOString().slice(0, 10);
    })();
    {
      const created = await callCreateGoal(tokenA, { title: 'Edit semantics 55', templateCategory: null as any });
      const goalId = created.body.goal.id;
      createdGoalIds.push(goalId);
      const added = await callAddActivity(tokenA, goalId, { title: 'Meditate 10 minutes', rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 3 } });
      const gaId = added.body.id;

      // 2 completed + 1 upcoming, all in the REAL current local week.
      // makeOccurrenceFor's own `now` is fixed at T05:00:00Z on the given
      // windowDate (matching sections 52-54's own convention above) -- so
      // every item start here must stay safely after that, same as those
      // sections' own 10/11/12 o'clock choices.
      const r1 = await makeOccurrenceFor(userA.id, gaId, 'p55a', `${thisWeekWed55}T10:00:00Z`, `${thisWeekWed55}T10:10:00Z`, thisWeekWed55);
      if (r1.status === 'SAVED') { createdPlanIds.push(r1.plans[0].id); await sql(`UPDATE "PlannedActivity" SET status = 'LOGGED', "loggedAt" = now() WHERE id = $1`, [r1.plans[0].id]); }
      const r2 = await makeOccurrenceFor(userA.id, gaId, 'p55b', `${thisWeekWed55}T11:00:00Z`, `${thisWeekWed55}T11:10:00Z`, thisWeekWed55);
      if (r2.status === 'SAVED') { createdPlanIds.push(r2.plans[0].id); await sql(`UPDATE "PlannedActivity" SET status = 'LOGGED', "loggedAt" = now() WHERE id = $1`, [r2.plans[0].id]); }
      const r3 = await makeOccurrenceFor(userA.id, gaId, 'p55c', `${thisWeekWed55}T12:00:00Z`, `${thisWeekWed55}T12:10:00Z`, thisWeekWed55);
      let upcomingPlanId: string | null = null;
      if (r3.status === 'SAVED') { upcomingPlanId = r3.plans[0].id; createdPlanIds.push(upcomingPlanId); }
      check('55. setup: 2 LOGGED + 1 UPCOMING materialized (3/week target exactly met by commitment)', r1.status === 'SAVED' && r2.status === 'SAVED' && r3.status === 'SAVED' && upcomingPlanId !== null);

      // 3 -> 2: historical facts preserved, the UPCOMING plan is NOT
      // auto-cancelled (this ticket's own section 21).
      const edit32 = await callSetRhythm(tokenA, goalId, gaId, { rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 2 } });
      check('55. 3 -> 2 edit succeeds', edit32.status === 200);
      const upcomingStatusAfter = (await sql(`SELECT status FROM "PlannedActivity" WHERE id = $1`, [upcomingPlanId]))[0].status;
      check('55. editing 3 -> 2 does NOT cancel the existing UPCOMING commitment', upcomingStatusAfter === 'UPCOMING');
      const occCountAfter32 = (await sql(`SELECT id FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [gaId])).length;
      check('55. editing 3 -> 2 creates/deletes no occurrence row (still exactly 3)', occCountAfter32 === 3);
      const detailAfter32 = await callGetGoalDetail(tokenA, goalId);
      const activityAfter32 = detailAfter32.body.activities.find((a: any) => a.id === gaId);
      check('55. after 3 -> 2 with 2 completed + 1 committed, remainingThisWeek is 0 (capacity already exhausted by the preserved commitments)', activityAfter32.rhythm.remainingThisWeek === 0 && activityAfter32.rhythm.eligibleForAnotherOccurrence === false);

      // 2 -> 4: may create additional capacity, never auto-materializes.
      const edit24 = await callSetRhythm(tokenA, goalId, gaId, { rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 4 } });
      check('55. 2 -> 4 edit succeeds', edit24.status === 200);
      const occCountAfter24 = (await sql(`SELECT id FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [gaId])).length;
      check('55. editing 2 -> 4 does not automatically materialize anything (still exactly 3 occurrence rows)', occCountAfter24 === 3);
      const detailAfter24 = await callGetGoalDetail(tokenA, goalId);
      const activityAfter24 = detailAfter24.body.activities.find((a: any) => a.id === gaId);
      check('55. after 2 -> 4, remainingThisWeek reopens to 1 (4 - 2 completed - 1 committed), eligible again', activityAfter24.rhythm.remainingThisWeek === 1 && activityAfter24.rhythm.eligibleForAnotherOccurrence === true);

      // Rhythm -> NONE: historical occurrences remain; existing UPCOMING
      // plan remains (this ticket's own section 22).
      const editToNone = await callSetRhythm(tokenA, goalId, gaId, { rhythm: { kind: 'NONE' } });
      check('56. N_PER_WEEK -> NONE edit succeeds', editToNone.status === 200);
      const occCountAfterNone = (await sql(`SELECT id FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [gaId])).length;
      check('56. switching to NONE deletes NO occurrence rows (still exactly 3, historical occurrences remain)', occCountAfterNone === 3);
      const upcomingStatusAfterNone = (await sql(`SELECT status FROM "PlannedActivity" WHERE id = $1`, [upcomingPlanId]))[0].status;
      check('56. switching to NONE does NOT cancel the existing UPCOMING plan automatically', upcomingStatusAfterNone === 'UPCOMING');
      const detailAfterNone = await callGetGoalDetail(tokenA, goalId);
      const activityAfterNone = detailAfterNone.body.activities.find((a: any) => a.id === gaId);
      check('56. R4 presentation now reads rhythm.kind NONE', activityAfterNone.rhythm.kind === 'NONE');

      // NONE -> Rhythm: no historical backfill -- the pre-existing 2
      // LOGGED/1 UPCOMING occurrences are NOT retroactively claimed as
      // THIS week's facts if they belong to a past week; the fact loader
      // simply re-reads whatever occurrence rows already exist (it never
      // invents new ones).
      const beforeBackfillCount = (await sql(`SELECT id FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [gaId])).length;
      const editBackToRhythm = await callSetRhythm(tokenA, goalId, gaId, { rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 5 } });
      check('56. NONE -> N_PER_WEEK(5) edit succeeds', editBackToRhythm.status === 200);
      const afterBackfillCount = (await sql(`SELECT id FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [gaId])).length;
      check('56. NONE -> Rhythm creates ZERO new occurrence rows (no historical backfill, this ticket\'s own section 23)', afterBackfillCount === beforeBackfillCount);
    }

    // ============================================================
    // 56/57. User isolation -- User B cannot set/edit User A's Rhythm,
    // cannot create a GoalActivity under User A's Goal, cannot observe
    // private policy through an unauthorized API call.
    // ============================================================
    {
      const created = await callCreateGoal(tokenA, { title: 'Isolation 56', templateCategory: null as any });
      const goalId = created.body.goal.id;
      createdGoalIds.push(goalId);
      const added = await callAddActivity(tokenA, goalId, { title: 'Meditate 10 minutes', rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 3 } });
      const gaId = added.body.id;

      const crossEdit = await callSetRhythm(tokenB, goalId, gaId, { rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 7 } });
      check('56. User B cannot edit User A\'s GoalActivity Rhythm (404, never leaking existence)', crossEdit.status === 404);
      const unaffected = (await sql(`SELECT "rhythmTargetPerWeek" FROM "GoalActivity" WHERE id = $1`, [gaId]))[0].rhythmTargetPerWeek;
      check('56. the cross-user edit attempt had zero effect -- target is still 3', unaffected === 3);

      const crossAdd = await callAddActivity(tokenB, goalId, { title: 'Injected activity', rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 1 } });
      check('56. User B cannot create a GoalActivity under User A\'s Goal (404)', crossAdd.status === 404);

      const crossRead = await callGetGoalDetail(tokenB, goalId);
      check('56. User B cannot observe User A\'s private Rhythm policy through Goal Detail (404)', crossRead.status === 404);
    }
  } finally {
    await cleanup();
  }

  if (!allPassed) {
    console.error('SOME GOAL ACTIVITY RHYTHM SETUP DB CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL GOAL ACTIVITY RHYTHM SETUP DB CHECKS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
