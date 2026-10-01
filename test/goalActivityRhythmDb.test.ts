/**
 * Goals V2 Rhythm R2 -- live-database proof of GoalActivityRhythm
 * persistence/normalization round-trips and the read-only
 * loadGoalActivityRhythmFacts loader, including full integration with the
 * pure eligibility engine against REAL rows. No production write path sets
 * a Rhythm policy yet, so this test sets rhythmKind/rhythmTargetPerWeek via
 * raw SQL through beginTransaction() -- same established precedent as
 * goalActivityOccurrenceDb.test.ts (R1) and goalActivityExecutionDb.test.ts
 * (G2.2.1), both of which proved a new column/table's schema capability
 * before any dedicated write function existed for it.
 *
 * Requires a real, reachable DATABASE_URL:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/goalActivityRhythmDb.test.ts
 */
import {
  upsertUserByEmail,
  createGoalWithActivities,
  addGoalActivity,
  createPlannedActivity,
  deletePlannedActivity,
  deleteGoal,
  cancelPlannedActivity,
  beginTransaction,
  loadGoalActivityRhythmFacts,
} from '../apps/web/lib/db';
import { movePlannedActivity } from '../apps/web/lib/planMove';
import { normalizeGoalActivityRhythm, computeGoalActivityRhythmEligibility, localCalendarWeekStart } from '../apps/web/lib/goalActivityRhythm';
import { getDatePartsInTimezone } from '../apps/web/lib/timezone';

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

const insertOccurrence = (userId: string, goalActivityId: string, plannedActivityId: string | null) =>
  sql(`INSERT INTO "GoalActivityOccurrence" (id, "userId", "goalActivityId", "plannedActivityId") VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id`, [userId, goalActivityId, plannedActivityId]);

async function main() {
  const user = await upsertUserByEmail({ email: 'test-goal-activity-rhythm@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });

  const createdGoalIds: string[] = [];
  const createdPlanIds: string[] = [];
  const cleanup = async () => {
    for (const planId of createdPlanIds) {
      await cancelPlannedActivity(user.id, planId).catch(() => {});
      await deletePlannedActivity(user.id, planId).catch(() => {});
    }
    for (const goalId of createdGoalIds) {
      await deleteGoal(user.id, goalId).catch(() => {});
    }
    // deletePlannedActivity only ever scopes to LOGGED/CANCELLED (by design,
    // same as production) -- a SKIPPED fixture plan above would otherwise
    // survive this cleanup and leak into a later run against the same
    // upserted user. Safe here only because this is disposable test data.
    await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [user.id]).catch(() => {});
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [user.id]).catch(() => {});
  };

  try {
    // ============================================================
    // 37. existing row -> NONE (no migration backfill; a freshly-created
    // GoalActivity through the EXISTING write path leaves rhythmKind NULL)
    // ============================================================
    const { goal } = await createGoalWithActivities({ userId: user.id, title: 'Meditate regularly (R2 fixture)', targetDate: null, activities: [] });
    createdGoalIds.push(goal.id);
    const goalActivity = await addGoalActivity(user.id, goal.id, { title: 'Meditate 10 minutes', activityId: null });
    const freshRow = (await sql(`SELECT "rhythmKind", "rhythmTargetPerWeek" FROM "GoalActivity" WHERE id = $1`, [goalActivity!.id]))[0];
    check('37. a freshly-created GoalActivity has rhythmKind/rhythmTargetPerWeek NULL (no production writer sets them)', freshRow.rhythmKind === null && freshRow.rhythmTargetPerWeek === null);
    check('37. that NULL row normalizes to canonical NONE', normalizeGoalActivityRhythm({ rhythmKind: freshRow.rhythmKind, rhythmTargetPerWeek: freshRow.rhythmTargetPerWeek }).kind === 'NONE');

    // ============================================================
    // 37. explicit NONE persists as canonical NONE (all-null)
    // ============================================================
    await sql(`UPDATE "GoalActivity" SET "rhythmKind" = NULL, "rhythmTargetPerWeek" = NULL WHERE id = $1`, [goalActivity!.id]);
    const explicitNoneRow = (await sql(`SELECT "rhythmKind", "rhythmTargetPerWeek" FROM "GoalActivity" WHERE id = $1`, [goalActivity!.id]))[0];
    check('37. explicit NONE (both columns null) normalizes to NONE', normalizeGoalActivityRhythm(explicitNoneRow).kind === 'NONE');

    // ============================================================
    // 37. new N_PER_WEEK(3) round-trips exactly
    // ============================================================
    await sql(`UPDATE "GoalActivity" SET "rhythmKind" = 'N_PER_WEEK', "rhythmTargetPerWeek" = 3 WHERE id = $1`, [goalActivity!.id]);
    const nPerWeekRow = (await sql(`SELECT "rhythmKind", "rhythmTargetPerWeek" FROM "GoalActivity" WHERE id = $1`, [goalActivity!.id]))[0];
    const roundTripped = normalizeGoalActivityRhythm(nPerWeekRow);
    check('37. N_PER_WEEK(3) round-trips exactly through persistence', roundTripped.kind === 'N_PER_WEEK' && roundTripped.targetPerWeek === 3);

    // ============================================================
    // 37. invalid persisted value -> safe non-recurrent normalization
    // ============================================================
    await sql(`UPDATE "GoalActivity" SET "rhythmKind" = 'N_PER_WEEK', "rhythmTargetPerWeek" = 0 WHERE id = $1`, [goalActivity!.id]);
    const invalidTargetRow = (await sql(`SELECT "rhythmKind", "rhythmTargetPerWeek" FROM "GoalActivity" WHERE id = $1`, [goalActivity!.id]))[0];
    check('37. an invalid persisted target (0) normalizes to NONE, never silently recurrent', normalizeGoalActivityRhythm(invalidTargetRow).kind === 'NONE');
    await sql(`UPDATE "GoalActivity" SET "rhythmKind" = 'WEEKLY_SOMETHING', "rhythmTargetPerWeek" = 3 WHERE id = $1`, [goalActivity!.id]);
    const unknownKindRow = (await sql(`SELECT "rhythmKind", "rhythmTargetPerWeek" FROM "GoalActivity" WHERE id = $1`, [goalActivity!.id]))[0];
    check('37. an unrecognized persisted rhythmKind normalizes to NONE, never thrown, never recurrent', normalizeGoalActivityRhythm(unknownKindRow).kind === 'NONE');

    // reset to a known-good N_PER_WEEK(3) for the fact-loader tests below
    await sql(`UPDATE "GoalActivity" SET "rhythmKind" = 'N_PER_WEEK', "rhythmTargetPerWeek" = 3 WHERE id = $1`, [goalActivity!.id]);

    // ============================================================
    // 37. no migration backfill: the migration itself created zero rows
    // (re-confirmed directly against this exact GoalActivity's OWN history --
    // every row above was explicitly written by THIS test, never by the
    // migration)
    // ============================================================
    check('37. no occurrence was created merely by setting a Rhythm policy', (await sql(`SELECT count(*)::int n FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [goalActivity!.id]))[0].n === 0);
    check('37. no PlannedActivity was created merely by setting a Rhythm policy', (await sql(`SELECT count(*)::int n FROM "PlannedActivity" WHERE "userId" = $1`, [user.id]))[0].n === 0);
    check('37. no GoalActivityExecution was created merely by setting a Rhythm policy', (await sql(`SELECT count(*)::int n FROM "GoalActivityExecution" WHERE "goalActivityId" = $1`, [goalActivity!.id]))[0].n === 0);

    // ============================================================
    // Fact loader + full integration against REAL rows, across real
    // statuses and a real week boundary, in a real timezone.
    // ============================================================
    // Pick an anchor "planning" instant and derive the current local week's
    // Monday purely from real primitives (never a hardcoded date), so this
    // test is not time-bomb-fragile.
    const now = new Date();
    const planningLocalDate = getDatePartsInTimezone(TZ, now).dateStr;
    const weekStart = localCalendarWeekStart(planningLocalDate);
    // A safe mid-week local time (10:00 local) on the week's Wednesday, well
    // clear of the week's own start/end boundaries.
    const wedLocalDateStr = (() => {
      // weekStart is a Monday; +2 days = Wednesday.
      const [y, m, d] = weekStart.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      dt.setUTCDate(dt.getUTCDate() + 2);
      return dt.toISOString().slice(0, 10);
    })();
    // Asia/Kolkata is a fixed UTC+5:30 offset (no DST), so `hour:00 local`
    // on wedLocalDateStr converts exactly via plain arithmetic.
    const atWedLocal = (hour: number) => {
      const [y, m, d] = wedLocalDateStr.split('-').map(Number);
      const utcHour = hour - 5;
      const utcMinute = -30;
      return new Date(Date.UTC(y, m - 1, d, utcHour, 0) + utcMinute * 60000);
    };

    const planLogged = await createPlannedActivity({ userId: user.id, title: 'Meditate 10 minutes', plannedStartAt: atWedLocal(7), plannedEndAt: atWedLocal(8), durationMinutes: 10, windowType: 'NEUTRAL' });
    const planUpcoming = await createPlannedActivity({ userId: user.id, title: 'Meditate 10 minutes', plannedStartAt: atWedLocal(9), plannedEndAt: atWedLocal(10), durationMinutes: 10, windowType: 'NEUTRAL' });
    const planSkipped = await createPlannedActivity({ userId: user.id, title: 'Meditate 10 minutes', plannedStartAt: atWedLocal(11), plannedEndAt: atWedLocal(12), durationMinutes: 10, windowType: 'NEUTRAL' });
    const planCancelled = await createPlannedActivity({ userId: user.id, title: 'Meditate 10 minutes', plannedStartAt: atWedLocal(13), plannedEndAt: atWedLocal(14), durationMinutes: 10, windowType: 'NEUTRAL' });
    createdPlanIds.push(planLogged.id, planUpcoming.id, planSkipped.id, planCancelled.id);

    await sql(`UPDATE "PlannedActivity" SET status = 'LOGGED', "loggedAt" = now() WHERE id = $1`, [planLogged.id]);
    await sql(`UPDATE "PlannedActivity" SET status = 'SKIPPED', "skippedAt" = now() WHERE id = $1`, [planSkipped.id]);
    await cancelPlannedActivity(user.id, planCancelled.id);

    await insertOccurrence(user.id, goalActivity!.id, planLogged.id);
    await insertOccurrence(user.id, goalActivity!.id, planUpcoming.id);
    await insertOccurrence(user.id, goalActivity!.id, planSkipped.id);
    await insertOccurrence(user.id, goalActivity!.id, planCancelled.id);

    const facts = await loadGoalActivityRhythmFacts(user.id, goalActivity!.id, TZ);
    check('fact loader returns exactly 4 facts (one per linked occurrence)', facts.length === 4);
    check('fact loader derives COMPLETED for the LOGGED plan', facts.filter((f) => f.contribution === 'COMPLETED').length === 1);
    check('fact loader derives COMMITTED for the UPCOMING plan', facts.filter((f) => f.contribution === 'COMMITTED').length === 1);
    check('fact loader derives NONE for both SKIPPED and CANCELLED plans', facts.filter((f) => f.contribution === 'NONE').length === 2);
    check('fact loader resolves each localDate in the REQUESTED timezone, landing in the current local week', facts.every((f) => localCalendarWeekStart(f.localDate) === weekStart));

    const eligibility = computeGoalActivityRhythmEligibility({ rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 3 }, planningLocalDate, occurrences: facts });
    check('end-to-end: 3/week with 1 completed + 1 committed (skip/cancel ignored) -> remaining 1, eligible', eligibility.eligible === true && eligibility.remainingOccurrences === 1);

    // ============================================================
    // 15/21. Move safety -- prove the pure model + loader support
    // "repoint, don't duplicate" once a future ticket wires it, WITHOUT any
    // production wiring existing yet in R1/R2.
    // ============================================================
    // A safely-future instant relative to the REAL wall clock (movePlannedActivity
    // rejects a past destination) -- the exact date is otherwise irrelevant to
    // this test's own assertions (contribution counts, never a specific week).
    const moveResult = await movePlannedActivity(user.id, planUpcoming.id, { newStartAt: new Date(Math.ceil((Date.now() + 3 * 3600000) / 60000) * 60000) });
    const factsAfterMoveUnrepointed = await loadGoalActivityRhythmFacts(user.id, goalActivity!.id, TZ);
    check('15. immediately after a Move, with NO production repoint wiring yet, the occurrence still points at the now-MOVED plan -- contributes NONE (fails safe, never double-counts, never COMMITTED off a dead row)', factsAfterMoveUnrepointed.filter((f) => f.contribution === 'COMMITTED').length === 0 && factsAfterMoveUnrepointed.some((f) => f.contribution === 'NONE'));

    // Manually repoint the occurrence to the successor -- simulating EXACTLY
    // what a future production wiring ticket (R3+) will do atomically inside
    // applyMoveWrites, proven here at the schema/loader level only.
    await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = $1 WHERE "plannedActivityId" = $2`, [moveResult.to.id, planUpcoming.id]);
    createdPlanIds.push(moveResult.to.id);
    const factsAfterRepoint = await loadGoalActivityRhythmFacts(user.id, goalActivity!.id, TZ);
    check('15/21. after repointing to the successor, there are STILL exactly 4 facts (never 5) -- the Move never created a second occurrence/fact', factsAfterRepoint.length === 4);
    check('15/21. the repointed occurrence now correctly contributes COMMITTED again (its successor is UPCOMING) -- same occurrence, different schedule placement, never double-counted alongside the old MOVED row', factsAfterRepoint.filter((f) => f.contribution === 'COMMITTED').length === 1 && factsAfterRepoint.filter((f) => f.contribution === 'COMPLETED').length === 1 && factsAfterRepoint.filter((f) => f.contribution === 'NONE').length === 2);
  } finally {
    await cleanup();
  }

  if (!allPassed) {
    console.error('SOME GOAL ACTIVITY RHYTHM DB CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL GOAL ACTIVITY RHYTHM DB CHECKS PASSED');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
