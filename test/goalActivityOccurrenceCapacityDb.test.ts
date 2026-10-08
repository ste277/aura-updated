/**
 * Goals V2 -- Multi-Occurrence Rhythm, PR 1: live-database proof that the
 * ALREADY-EXISTING, UNCHANGED lifecycle functions behave correctly when a
 * GoalActivity has TWO distinct UPCOMING occurrences on record at once --
 * the exact state the later wiring PR will make reachable through the
 * normal write path, which this PR does not touch.
 *
 * Scenarios A-H, per the ticket's own section 3:
 *   A  two distinct UPCOMING occurrences coexist for one GoalActivity
 *   B  each occurrence carries its own, distinct Plan link
 *   C  cancelling one occurrence's plan leaves the other fully untouched
 *   D  completing (logging) one occurrence's plan leaves the other untouched
 *   E  moving one occurrence's plan across a week boundary updates only
 *      its own association
 *   F  a retried acceptance request (same clientRequestId) cannot create
 *      a second occurrence -- the EXISTING PlanCreationIdempotency replay
 *      check, exercised verbatim, never a new mechanism
 *   G  two concurrent requests for the LAST weekly slot cannot both
 *      succeed -- the EXISTING per-user advisory lock
 *      (`day-constructor-accept:<userId>`), exercised verbatim
 *   H  archiving the Goal does not mutate any existing occurrence
 *
 * THE FIXTURE FOR A/B/C/D/E/H is built with DIRECT SQL plus the general-
 * purpose `createPlannedActivity` -- never by calling
 * `materializeGoalActivityRhythmOccurrence` twice. That function's
 * existing `HAS_LIVE_COMMITMENT` guard (db.ts:3092) is UNCHANGED by this
 * PR and would correctly refuse a second UPCOMING link while one is
 * already live -- this file does not bypass, weaken or route around that
 * guard anywhere; it only gives the REAL downstream lifecycle functions
 * (cancel/log/Move/archive) a pre-existing multi-occurrence state to
 * prove themselves against ahead of any later PR that wires the write
 * path open.
 *
 * SCENARIOS F AND G deliberately use the UNCHANGED single-link production
 * write path (`persistAcceptedConstructedDay`) on a FRESH GoalActivity,
 * not the direct-SQL fixture -- idempotency and the per-user advisory
 * lock are both existing guarantees that hold regardless of single- vs
 * multi-occurrence design, and already need no new mechanism to prove
 * (confirmed against the identical pattern already proven in
 * goalActivityRhythmMaterializationDb.test.ts sections 55/56).
 *
 * NOT part of ci.yml's math-core-tests job (no Postgres service
 * provisioned there) -- same convention as every other *Db.test.ts file.
 *
 *   DATABASE_URL="postgresql://..." npx tsx test/goalActivityOccurrenceCapacityDb.test.ts
 */
import {
  upsertUserByEmail,
  updateBirthProfile,
  createGoalWithActivities,
  addGoalActivity,
  deleteGoal,
  createPlannedActivity,
  cancelPlannedActivity,
  logPlannedActivity,
  archiveGoal,
  loadCandidateGoalActivitiesForRhythmDemand,
  beginTransaction,
} from '../apps/web/lib/db';
import { movePlannedActivity } from '../apps/web/lib/planMove';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import type { AcceptConstructedDayRequest, AcceptedProposedItem } from '../apps/web/lib/dayConstructorAcceptance';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const MIN = 60000;
const GOAL_TITLE_PREFIX = 'PR1 Multi-Occurrence fixture ';

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
  return { title: 'Meditate 10 minutes', placementSource: 'SELECTED_CANDIDATE', ...overrides };
}

const setRhythm = (goalActivityId: string, targetPerWeek: number) =>
  sql(`UPDATE "GoalActivity" SET "rhythmKind" = 'N_PER_WEEK', "rhythmTargetPerWeek" = $1 WHERE id = $2`, [targetPerWeek, goalActivityId]);
const occurrencesFor = (goalActivityId: string) =>
  sql(`SELECT id, "plannedActivityId" FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1 ORDER BY "createdAt"`, [goalActivityId]);
const planStatus = async (planId: string): Promise<string> => (await sql(`SELECT status FROM "PlannedActivity" WHERE id = $1`, [planId]))[0].status;

async function createUpcomingPlan(userId: string, title: string, startIso: string, durationMinutes = 10) {
  return createPlannedActivity({
    userId,
    title: `${title} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    plannedStartAt: new Date(startIso),
    plannedEndAt: new Date(new Date(startIso).getTime() + durationMinutes * MIN),
    durationMinutes,
    windowType: 'NEUTRAL',
  });
}

async function insertOccurrence(userId: string, goalActivityId: string, plannedActivityId: string | null) {
  const rows = await sql(
    `INSERT INTO "GoalActivityOccurrence" (id, "userId", "goalActivityId", "plannedActivityId") VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id, "plannedActivityId"`,
    [userId, goalActivityId, plannedActivityId]
  );
  return rows[0] as { id: string; plannedActivityId: string | null };
}

/**
 * The scaffold scenarios A/B/C/D/E/H all build on: two independent
 * GoalActivityOccurrence rows, each pointing at its own distinct UPCOMING
 * PlannedActivity. `GoalActivity.plannedActivityId` (its own `@unique`
 * column) is pointed at the more-recently-created occurrence's plan, the
 * same "latest wins" convention production's own single-slot write path
 * already establishes -- not asserted on by most scenarios below; the
 * occurrence rows are the ledger these tests actually prove against.
 */
async function buildTwoUpcomingOccurrences(userId: string, goalActivityId: string, tag: string, day1Iso: string, day2Iso: string) {
  const plan1 = await createUpcomingPlan(userId, `PR1 ${tag} session A`, day1Iso);
  const plan2 = await createUpcomingPlan(userId, `PR1 ${tag} session B`, day2Iso);
  const occ1 = await insertOccurrence(userId, goalActivityId, plan1.id);
  const occ2 = await insertOccurrence(userId, goalActivityId, plan2.id);
  await sql(`UPDATE "GoalActivity" SET "plannedActivityId" = $1 WHERE id = $2`, [plan2.id, goalActivityId]);
  return { plan1, plan2, occ1, occ2 };
}

async function main() {
  const user = await upsertUserByEmail({ email: 'test-pr1-multi-occurrence@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await updateBirthProfile(user.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });

  const createdGoalIds: string[] = [];
  const cleanup = async () => {
    const leftovers = await sql(`SELECT id FROM "Goal" WHERE "userId" = $1 AND title LIKE $2`, [user.id, `${GOAL_TITLE_PREFIX}%`]);
    for (const row of leftovers) if (!createdGoalIds.includes(row.id)) createdGoalIds.push(row.id);
    await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [user.id]);
    await sql(`UPDATE "GoalActivity" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [user.id]);
    await sql(`UPDATE "PlannedActivity" SET "rescheduledFromPlanId" = NULL WHERE "userId" = $1`, [user.id]);
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [user.id]);
    for (const goalId of createdGoalIds) await deleteGoal(user.id, goalId).catch(() => {});
  };
  await cleanup(); // purge any leftovers from a prior interrupted run against the same upserted user

  try {
    // ============================================================
    // A + B -- two distinct UPCOMING occurrences coexist, each with its
    // own unique Plan link
    // ============================================================
    const { goal: goalAB } = await createGoalWithActivities({ userId: user.id, title: `${GOAL_TITLE_PREFIX}AB`, targetDate: null, activities: [] });
    createdGoalIds.push(goalAB.id);
    const gaAB = await addGoalActivity(user.id, goalAB.id, { title: 'Meditate 10 minutes', activityId: null });
    await setRhythm(gaAB!.id, 5);
    const fixAB = await buildTwoUpcomingOccurrences(user.id, gaAB!.id, 'AB', '2026-09-22T09:00:00Z', '2026-09-23T09:00:00Z');

    check('A. two distinct UPCOMING occurrences coexist for the same GoalActivity', fixAB.plan1.status === 'UPCOMING' && fixAB.plan2.status === 'UPCOMING' && fixAB.occ1.id !== fixAB.occ2.id);
    check('A. the schema/existing write paths tolerate this state (two occurrence rows under one GoalActivity, no constraint violation)', (await occurrencesFor(gaAB!.id)).length === 2);
    // Superseded by Multi-Occurrence Rhythm PR 2, which explicitly wires
    // multi-occurrence demand into this exact query (its own single-
    // live-plan SQL exclusion removed) -- so this GoalActivity is now
    // correctly INCLUDED here, matching PR 2's own intended behavior.
    const candidatesAB = await loadCandidateGoalActivitiesForRhythmDemand(user.id);
    check('A. the candidate query now includes this GoalActivity despite its two coexisting UPCOMING occurrences (Multi-Occurrence Rhythm PR 2)', candidatesAB.some((r) => r.goalActivityId === gaAB!.id));
    check('B. each occurrence has its own, distinct Plan link -- never shared', fixAB.occ1.plannedActivityId === fixAB.plan1.id && fixAB.occ2.plannedActivityId === fixAB.plan2.id && fixAB.plan1.id !== fixAB.plan2.id);

    // ============================================================
    // C -- cancelling one occurrence's plan leaves the other untouched
    // ============================================================
    const { goal: goalC } = await createGoalWithActivities({ userId: user.id, title: `${GOAL_TITLE_PREFIX}C`, targetDate: null, activities: [] });
    createdGoalIds.push(goalC.id);
    const gaC = await addGoalActivity(user.id, goalC.id, { title: 'Meditate 10 minutes', activityId: null });
    await setRhythm(gaC!.id, 5);
    const fixC = await buildTwoUpcomingOccurrences(user.id, gaC!.id, 'C', '2026-09-22T10:00:00Z', '2026-09-23T10:00:00Z');
    await cancelPlannedActivity(user.id, fixC.plan1.id);
    const occsC = await occurrencesFor(gaC!.id);
    check('C. the cancelled plan is now CANCELLED', (await planStatus(fixC.plan1.id)) === 'CANCELLED');
    check('C. its own occurrence row still points to that (now cancelled) plan -- cancelPlannedActivity never touches GoalActivityOccurrence.plannedActivityId', occsC.find((o: any) => o.id === fixC.occ1.id)?.plannedActivityId === fixC.plan1.id);
    check('C. the OTHER occurrence is completely untouched: still points to its own plan, which remains UPCOMING', occsC.find((o: any) => o.id === fixC.occ2.id)?.plannedActivityId === fixC.plan2.id && (await planStatus(fixC.plan2.id)) === 'UPCOMING');

    // ============================================================
    // D -- completing (logging) one occurrence's plan leaves the other untouched
    // ============================================================
    const { goal: goalD } = await createGoalWithActivities({ userId: user.id, title: `${GOAL_TITLE_PREFIX}D`, targetDate: null, activities: [] });
    createdGoalIds.push(goalD.id);
    const gaD = await addGoalActivity(user.id, goalD.id, { title: 'Meditate 10 minutes', activityId: null });
    await setRhythm(gaD!.id, 5);
    const fixD = await buildTwoUpcomingOccurrences(user.id, gaD!.id, 'D', '2026-09-22T11:00:00Z', '2026-09-23T11:00:00Z');
    await logPlannedActivity(user.id, fixD.plan2.id);
    const occsD = await occurrencesFor(gaD!.id);
    check('D. the logged plan is now LOGGED', (await planStatus(fixD.plan2.id)) === 'LOGGED');
    check('D. its own occurrence row still points to that (now logged) plan', occsD.find((o: any) => o.id === fixD.occ2.id)?.plannedActivityId === fixD.plan2.id);
    check('D. the OTHER occurrence is completely untouched: still points to its own plan, which remains UPCOMING', occsD.find((o: any) => o.id === fixD.occ1.id)?.plannedActivityId === fixD.plan1.id && (await planStatus(fixD.plan1.id)) === 'UPCOMING');

    // ============================================================
    // E -- moving one occurrence's plan across a week boundary updates
    // only its own association (planMove.ts has zero week-boundary
    // special-casing: it always repoints exactly the occurrence rows
    // that pointed at the moved plan, regardless of distance moved)
    // ============================================================
    const { goal: goalE } = await createGoalWithActivities({ userId: user.id, title: `${GOAL_TITLE_PREFIX}E`, targetDate: null, activities: [] });
    createdGoalIds.push(goalE.id);
    const gaE = await addGoalActivity(user.id, goalE.id, { title: 'Meditate 10 minutes', activityId: null });
    await setRhythm(gaE!.id, 5);
    // movePlannedActivity validates its destination against the REAL wall
    // clock, so this scenario (unlike A-D/H) uses real near-future instants.
    const moveBase = Math.ceil((Date.now() + 2 * 3600000) / MIN) * MIN;
    const fixE = await buildTwoUpcomingOccurrences(user.id, gaE!.id, 'E', new Date(moveBase).toISOString(), new Date(moveBase + 3600000).toISOString());
    const eightDaysMs = 8 * 24 * 3600000; // > 7 days: guaranteed to cross at least one Monday week boundary regardless of what day "now" is
    const moveResultE = await movePlannedActivity(user.id, fixE.plan1.id, { newStartAt: new Date(moveBase + eightDaysMs) });
    const occsE = await occurrencesFor(gaE!.id);
    check('E. the moved plan is now MOVED (historical)', (await planStatus(fixE.plan1.id)) === 'MOVED');
    check('E. the successor plan lands at least 7 days later -- a genuine week-boundary crossing, not a same-week reschedule', moveResultE.to.plannedStartAt.getTime() - fixE.plan1.plannedStartAt.getTime() >= 7 * 24 * 3600000);
    check('E. its own occurrence now points to the SUCCESSOR plan in the new week', occsE.find((o: any) => o.id === fixE.occ1.id)?.plannedActivityId === moveResultE.to.id);
    check('E. the OTHER occurrence\'s association is completely unaffected by a Move on a DIFFERENT occurrence\'s plan', occsE.find((o: any) => o.id === fixE.occ2.id)?.plannedActivityId === fixE.plan2.id && (await planStatus(fixE.plan2.id)) === 'UPCOMING');

    // ============================================================
    // F -- a retried acceptance request (same clientRequestId) cannot
    // create a second occurrence (existing idempotency, exercised
    // verbatim, independent of the multi-occurrence fixture above)
    // ============================================================
    const { goal: goalF } = await createGoalWithActivities({ userId: user.id, title: `${GOAL_TITLE_PREFIX}F`, targetDate: null, activities: [] });
    createdGoalIds.push(goalF.id);
    const gaF = await addGoalActivity(user.id, goalF.id, { title: 'Meditate 10 minutes', activityId: null });
    await setRhythm(gaF!.id, 2);
    const reqF: AcceptConstructedDayRequest = {
      clientRequestId: `pr1-f-${Date.now()}`,
      constructionWindow: window('2026-09-22', '2026-09-22T06:00:00Z', '2026-09-22T20:00:00Z'),
      proposedItems: [item({ intentId: 'intent-f', start: iso('2026-09-22T15:00:00Z'), end: iso('2026-09-22T15:10:00Z') })],
    };
    const firstF = await persistAcceptedConstructedDay(user.id, reqF, iso('2026-09-22T08:00:00Z'), new Map([['intent-f', gaF!.id]]));
    const retryF = await persistAcceptedConstructedDay(user.id, reqF, iso('2026-09-22T08:05:00Z'), new Map([['intent-f', gaF!.id]]));
    check('F. first acceptance SAVES', firstF.status === 'SAVED');
    check('F. an identical retry (same clientRequestId) returns ALREADY_ACCEPTED, never a second materialization', retryF.status === 'ALREADY_ACCEPTED');
    check('F. exactly ONE occurrence exists after the retry (PlanCreationIdempotency replay check, reused verbatim)', (await occurrencesFor(gaF!.id)).length === 1);

    // ============================================================
    // G -- two concurrent requests for the LAST weekly slot cannot both
    // succeed (existing per-user advisory lock, exercised verbatim)
    // ============================================================
    const { goal: goalG } = await createGoalWithActivities({ userId: user.id, title: `${GOAL_TITLE_PREFIX}G`, targetDate: null, activities: [] });
    createdGoalIds.push(goalG.id);
    const gaG = await addGoalActivity(user.id, goalG.id, { title: 'Meditate 10 minutes', activityId: null });
    await setRhythm(gaG!.id, 1); // exactly one weekly slot -- the "last slot" scenario
    const reqGa: AcceptConstructedDayRequest = {
      clientRequestId: `pr1-g-a-${Date.now()}`,
      constructionWindow: window('2026-09-22', '2026-09-22T06:00:00Z', '2026-09-22T20:00:00Z'),
      proposedItems: [item({ intentId: 'intent-g-a', start: iso('2026-09-22T12:00:00Z'), end: iso('2026-09-22T12:10:00Z') })],
    };
    const reqGb: AcceptConstructedDayRequest = {
      clientRequestId: `pr1-g-b-${Date.now()}`,
      constructionWindow: window('2026-09-22', '2026-09-22T06:00:00Z', '2026-09-22T20:00:00Z'),
      proposedItems: [item({ intentId: 'intent-g-b', start: iso('2026-09-22T13:00:00Z'), end: iso('2026-09-22T13:10:00Z') })],
    };
    const [resGa, resGb] = await Promise.all([
      persistAcceptedConstructedDay(user.id, reqGa, iso('2026-09-22T08:00:00Z'), new Map([['intent-g-a', gaG!.id]])),
      persistAcceptedConstructedDay(user.id, reqGb, iso('2026-09-22T08:00:00Z'), new Map([['intent-g-b', gaG!.id]])),
    ]);
    const successesG = [resGa, resGb].filter((r) => r.status === 'SAVED').length;
    const failuresG = [resGa, resGb].filter((r) => r.status === 'SAVE_FAILED').length;
    check('G. exactly ONE of two concurrent requests for the last weekly slot succeeds, the other deterministically fails (never both succeeding)', successesG === 1 && failuresG === 1);
    check('G. exactly ONE occurrence exists after both concurrent attempts resolve -- the per-user advisory lock (day-constructor-accept:<userId>) serializes them, not timing luck', (await occurrencesFor(gaG!.id)).length === 1);

    // ============================================================
    // H -- archiving the Goal does not mutate any existing occurrence
    // ============================================================
    const { goal: goalH } = await createGoalWithActivities({ userId: user.id, title: `${GOAL_TITLE_PREFIX}H`, targetDate: null, activities: [] });
    createdGoalIds.push(goalH.id);
    const gaH = await addGoalActivity(user.id, goalH.id, { title: 'Meditate 10 minutes', activityId: null });
    await setRhythm(gaH!.id, 5);
    const fixH = await buildTwoUpcomingOccurrences(user.id, gaH!.id, 'H', '2026-09-22T14:00:00Z', '2026-09-23T14:00:00Z');
    const archivedH = await archiveGoal(user.id, goalH.id);
    const occsH = await occurrencesFor(gaH!.id);
    check('H. archiveGoal succeeds and flips Goal.status to ARCHIVED', archivedH?.status === 'ARCHIVED');
    check('H. both occurrence rows still exist, untouched', occsH.length === 2);
    check('H. O1 still points to the SAME plan, unchanged', occsH.find((o: any) => o.id === fixH.occ1.id)?.plannedActivityId === fixH.plan1.id);
    check('H. O2 still points to the SAME plan, unchanged', occsH.find((o: any) => o.id === fixH.occ2.id)?.plannedActivityId === fixH.plan2.id);
    check('H. both PlannedActivity rows remain UPCOMING, unchanged by archiving their Goal', (await planStatus(fixH.plan1.id)) === 'UPCOMING' && (await planStatus(fixH.plan2.id)) === 'UPCOMING');
  } finally {
    await cleanup();
  }

  if (!allPassed) {
    console.error('SOME GOAL ACTIVITY OCCURRENCE CAPACITY DB CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL GOAL ACTIVITY OCCURRENCE CAPACITY DB CHECKS PASSED');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
