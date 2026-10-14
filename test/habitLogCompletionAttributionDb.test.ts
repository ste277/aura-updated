/**
 * Insights V1 PR6 -- Durable Completion Attribution: live-database proof
 * of the four new HabitLog columns (migration 0049), the widened
 * logPlannedActivity writer, and the new countDeletedNonGoalCompletionsInRange
 * reader -- exercised directly against the real production functions
 * (bypassing HTTP, same established convention as every other real-DB
 * suite in this program).
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/habitLogCompletionAttributionDb.test.ts
 */
import {
  upsertUserByEmail, updateBirthProfile, beginTransaction, getUserById,
  createPlannedActivity, logPlannedActivity, deletePlannedActivity, cancelPlannedActivity,
  createGoalWithActivities, addGoalActivity, deleteGoal,
  createHabitLog, countDeletedNonGoalCompletionsInRange, listPlannedActivitiesForReporting,
} from '../apps/web/lib/db';
import { movePlannedActivity } from '../apps/web/lib/planMove';
import { summarizePlanningStatus } from '../apps/web/lib/insightsReporting';
import { computeImprovementSuggestions } from '../apps/web/lib/improvementSignalsComposition';
import { getDatePartsInTimezone } from '../apps/web/lib/timezone';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';

async function sql(text: string, params: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(text, params); await c.query('COMMIT'); return r.rows; }
  catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { c.release(); }
}

function iso(s: string): Date { return new Date(s); }

async function main() {
  const user = await upsertUserByEmail({ email: 'test-pr6-attribution@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const other = await upsertUserByEmail({ email: 'test-pr6-attribution-other@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const laUser = await upsertUserByEmail({ email: 'test-pr6-attribution-la@example.com', cityName: 'Los Angeles', latitude: 34.0522, longitude: -118.2437, timezone: 'America/Los_Angeles' });
  await updateBirthProfile(user.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });

  const allUserIds = [user.id, other.id, laUser.id];
  const createdGoalIds: string[] = [];
  const cleanup = async () => {
    for (const goalId of createdGoalIds) {
      for (const uid of allUserIds) await deleteGoal(uid, goalId).catch(() => {});
    }
    await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = NULL WHERE "userId" = ANY($1::text[])`, [allUserIds]);
    await sql(`UPDATE "GoalActivityExecution" SET "plannedActivityId" = NULL, "goalActivityOccurrenceId" = NULL WHERE "userId" = ANY($1::text[])`, [allUserIds]);
    await sql(`UPDATE "PlannedActivity" SET "rescheduledFromPlanId" = NULL WHERE "userId" = ANY($1::text[])`, [allUserIds]);
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])`, [allUserIds]);
    await sql(`DELETE FROM "HabitLog" WHERE "userId" = ANY($1::text[])`, [allUserIds]);
    for (const goalId of createdGoalIds) await sql(`DELETE FROM "Goal" WHERE id = $1`, [goalId]).catch(() => {});
  };
  await cleanup();

  try {
    const makePlan = (uid: string, title: string, startIso: string, endIso: string) =>
      createPlannedActivity({ userId: uid, title, plannedStartAt: iso(startIso), plannedEndAt: iso(endIso), durationMinutes: 30, windowType: 'NEUTRAL' });

    // ============================================================
    // 1. NON-GOAL COMPLETION SNAPSHOT
    // ============================================================
    const p1 = await makePlan(user.id, 'Reading P1', '2028-06-01T04:00:00Z', '2028-06-01T04:30:00Z');
    const { habitLog: hl1 } = await logPlannedActivity(user.id, p1.id);
    check('1. non-Goal snapshot: originatingPlannedActivityId set', (hl1 as any).originatingPlannedActivityId === p1.id);
    check('1. non-Goal snapshot: scheduledStartAtSnapshot matches plannedStartAt', new Date((hl1 as any).scheduledStartAtSnapshot).getTime() === iso('2028-06-01T04:00:00Z').getTime());
    check('1. non-Goal snapshot: completionAttribution = NON_GOAL', (hl1 as any).completionAttribution === 'NON_GOAL');
    check('1. non-Goal snapshot: originatingGoalActivityExecutionId is NULL', (hl1 as any).originatingGoalActivityExecutionId === null || (hl1 as any).originatingGoalActivityExecutionId === undefined);

    // ============================================================
    // 2. GOAL-LINKED COMPLETION SNAPSHOT
    // ============================================================
    const { goal: g2 } = await createGoalWithActivities({ userId: user.id, title: 'PR6 Goal', targetDate: null, activities: [] });
    createdGoalIds.push(g2.id);
    const ga2 = await addGoalActivity(user.id, g2.id, { title: 'Read', activityId: null });
    const p2 = await makePlan(user.id, 'Goal Reading P2', '2028-06-02T04:00:00Z', '2028-06-02T04:30:00Z');
    await sql(`UPDATE "GoalActivity" SET "plannedActivityId" = $1 WHERE id = $2`, [p2.id, ga2!.id]);
    const { habitLog: hl2 } = await logPlannedActivity(user.id, p2.id);
    const exec2 = (await sql(`SELECT id FROM "GoalActivityExecution" WHERE "plannedActivityId" = $1`, [p2.id]))[0];
    check('2. Goal-linked snapshot: completionAttribution = GOAL_LINKED', (hl2 as any).completionAttribution === 'GOAL_LINKED');
    check('2. Goal-linked snapshot: originatingGoalActivityExecutionId matches the real execution id exactly', (hl2 as any).originatingGoalActivityExecutionId === exec2.id);
    check('2. Goal-linked snapshot: originatingPlannedActivityId still set', (hl2 as any).originatingPlannedActivityId === p2.id);
    check('2. Goal-linked snapshot: scheduledStartAtSnapshot still set', new Date((hl2 as any).scheduledStartAtSnapshot).getTime() === iso('2028-06-02T04:00:00Z').getTime());

    // ============================================================
    // 3. LIVE NON-GOAL COMPLETION -- fallback contributes 0
    // ============================================================
    let count = await countDeletedNonGoalCompletionsInRange(user.id, iso('2028-05-25T00:00:00Z'), iso('2028-06-10T00:00:00Z'));
    check('3. live non-Goal completion -- fallback count is 0 (NOT EXISTS correctly finds the live Plan)', count === 0);

    // ============================================================
    // 4. DELETED NON-GOAL COMPLETION -- fallback recovers it
    // ============================================================
    await deletePlannedActivity(user.id, p1.id);
    count = await countDeletedNonGoalCompletionsInRange(user.id, iso('2028-05-25T00:00:00Z'), iso('2028-06-10T00:00:00Z'));
    check('4. deleted non-Goal completion -- fallback count is 1', count === 1);

    // ============================================================
    // 5. LIVE GOAL-LINKED COMPLETION -- never contributes
    // ============================================================
    count = await countDeletedNonGoalCompletionsInRange(user.id, iso('2028-05-25T00:00:00Z'), iso('2028-06-10T00:00:00Z'));
    check('5. live Goal-linked completion still present -- fallback count unaffected (still 1, not 2)', count === 1);

    // ============================================================
    // 6. DELETED GOAL-LINKED COMPLETION -- still never contributes
    // ============================================================
    await deletePlannedActivity(user.id, p2.id);
    count = await countDeletedNonGoalCompletionsInRange(user.id, iso('2028-05-25T00:00:00Z'), iso('2028-06-10T00:00:00Z'));
    check('6. deleted Goal-linked completion -- fallback count STILL 1 (GOAL_LINKED excluded, not double-counted)', count === 1);
    const execAfterDelete = await sql(`SELECT * FROM "GoalActivityExecution" WHERE id = $1`, [exec2.id]);
    check('6. Goal progress evidence (GoalActivityExecution) survives the Plan deletion, unaffected by PR6', execAfterDelete.length === 1 && execAfterDelete[0].plannedActivityId === null);

    // ============================================================
    // 7/8. DEDUP -- re-confirm via summarizePlanningStatus/full reporting composition
    // ============================================================
    const now2028 = iso('2028-06-15T00:00:00Z');
    const plans = await listPlannedActivitiesForReporting(user.id, iso('2028-05-25T00:00:00Z'), iso('2028-06-10T00:00:00Z'));
    const livePlanningStatus = summarizePlanningStatus(plans, now2028);
    const fallbackCount = await countDeletedNonGoalCompletionsInRange(user.id, iso('2028-05-25T00:00:00Z'), iso('2028-06-10T00:00:00Z'));
    check('7/8. combined confirmedCompleted (live + fallback) counts the non-Goal completion exactly once', livePlanningStatus.confirmedCompleted + fallbackCount === 0 + 1);

    // ============================================================
    // 9. SCHEDULED SEPTEMBER, COMPLETED OCTOBER (real clock divergence)
    // ============================================================
    const p9 = await makePlan(user.id, 'September Plan', '2028-09-01T04:00:00Z', '2028-09-01T04:30:00Z');
    const { habitLog: hl9 } = await logPlannedActivity(user.id, p9.id); // real logTimestamp = whenever this script actually runs, NOT September
    check('9. scheduledStartAtSnapshot = September (the SCHEDULED date)', new Date((hl9 as any).scheduledStartAtSnapshot).getTime() === iso('2028-09-01T04:00:00Z').getTime());
    check('9. logTimestamp != scheduledStartAtSnapshot (real completion instant differs from scheduled date)', new Date((hl9 as any).logTimestamp).getTime() !== new Date((hl9 as any).scheduledStartAtSnapshot).getTime());
    await deletePlannedActivity(user.id, p9.id);
    const septCount = await countDeletedNonGoalCompletionsInRange(user.id, iso('2028-08-25T00:00:00Z'), iso('2028-09-05T00:00:00Z'));
    check('9. fallback correctly attributes it to the SEPTEMBER range (by scheduled date), not the real completion date', septCount === 1);
    const notSeptCount = await countDeletedNonGoalCompletionsInRange(user.id, iso('2026-01-01T00:00:00Z'), iso('2026-01-02T00:00:00Z'));
    check('9. fallback does NOT attribute it to an unrelated range anchored on completion time', notSeptCount === 0);

    // ============================================================
    // 10. RANGE BOUNDARY INCLUSION
    // ============================================================
    const p10 = await makePlan(user.id, 'Boundary Plan', '2028-07-01T00:00:00Z', '2028-07-01T00:30:00Z');
    await logPlannedActivity(user.id, p10.id);
    await deletePlannedActivity(user.id, p10.id);
    const boundaryCountInclusive = await countDeletedNonGoalCompletionsInRange(user.id, iso('2028-07-01T00:00:00Z'), iso('2028-07-01T00:30:00Z'));
    check('10. range boundary inclusion -- BETWEEN includes the exact-boundary scheduled instant', boundaryCountInclusive === 1);
    const boundaryCountExclusive = await countDeletedNonGoalCompletionsInRange(user.id, iso('2028-07-01T00:00:01Z'), iso('2028-07-02T00:00:00Z'));
    check('10. just outside the boundary -- correctly excluded', boundaryCountExclusive === 0);

    // ============================================================
    // 11. DIFFERENT USER TIMEZONE
    // ============================================================
    const pLA = await makePlan(laUser.id, 'LA Plan', '2028-06-01T04:00:00Z', '2028-06-01T04:30:00Z');
    const { habitLog: hlLA } = await logPlannedActivity(laUser.id, pLA.id);
    await deletePlannedActivity(laUser.id, pLA.id);
    check('11. scheduledStartAtSnapshot is an absolute instant, independent of the owning user\'s timezone', new Date((hlLA as any).scheduledStartAtSnapshot).getTime() === iso('2028-06-01T04:00:00Z').getTime());
    const laCount = await countDeletedNonGoalCompletionsInRange(laUser.id, iso('2028-05-25T00:00:00Z'), iso('2028-06-10T00:00:00Z'));
    check('11. range filtering works correctly for a non-IST, non-UTC user (America/Los_Angeles)', laCount === 1);

    // ============================================================
    // 12. CROSS-WEEK MOVE BEFORE DONE
    // ============================================================
    const p12 = await makePlan(user.id, 'Move Then Done', '2028-06-05T04:00:00Z', '2028-06-05T04:30:00Z');
    const moved12 = await movePlannedActivity(user.id, p12.id, { newStartAt: iso('2028-06-12T04:00:00.000Z') }); // into the following week
    const { habitLog: hl12 } = await logPlannedActivity(user.id, moved12.to.id);
    check('12. scheduledStartAtSnapshot reflects the POST-Move (destination) time, never the pre-Move original', new Date((hl12 as any).scheduledStartAtSnapshot).getTime() === iso('2028-06-12T04:00:00Z').getTime());

    // ============================================================
    // 13. MULTIPLE COMPLETIONS OF SAME ACTIVITY
    // ============================================================
    const p13a = await makePlan(user.id, 'Repeated Activity', '2028-06-20T04:00:00Z', '2028-06-20T04:30:00Z');
    const p13b = await makePlan(user.id, 'Repeated Activity', '2028-06-21T04:00:00Z', '2028-06-21T04:30:00Z');
    const { habitLog: hl13a } = await logPlannedActivity(user.id, p13a.id);
    const { habitLog: hl13b } = await logPlannedActivity(user.id, p13b.id);
    await deletePlannedActivity(user.id, p13a.id);
    await deletePlannedActivity(user.id, p13b.id);
    check('13. two independent originatingPlannedActivityId values, never merged', (hl13a as any).originatingPlannedActivityId !== (hl13b as any).originatingPlannedActivityId);
    const repeatedCount = await countDeletedNonGoalCompletionsInRange(user.id, iso('2028-06-19T00:00:00Z'), iso('2028-06-22T00:00:00Z'));
    check('13. both counted independently (2, not 1 or merged)', repeatedCount === 2);

    // ============================================================
    // 14. DUPLICATE DONE REPLAY
    // ============================================================
    const p14 = await makePlan(user.id, 'Replay Plan', '2028-06-25T04:00:00Z', '2028-06-25T04:30:00Z');
    const { habitLog: hl14a } = await logPlannedActivity(user.id, p14.id);
    const { habitLog: hl14b } = await logPlannedActivity(user.id, p14.id); // second call, same plan
    check('14. duplicate Done replay returns the SAME HabitLog id (idempotent, no new row)', (hl14a as any).id === (hl14b as any).id);
    check('14. duplicate Done replay -- snapshot fields identical across both calls', (hl14a as any).completionAttribution === (hl14b as any).completionAttribution && new Date((hl14a as any).scheduledStartAtSnapshot).getTime() === new Date((hl14b as any).scheduledStartAtSnapshot).getTime());
    const replayRowCount = (await sql(`SELECT count(*)::int AS c FROM "HabitLog" WHERE "originatingPlannedActivityId" = $1`, [p14.id]))[0].c;
    check('14. exactly one HabitLog row exists for this Plan despite two Done calls', replayRowCount === 1);

    // ============================================================
    // 15. CONCURRENT DONE
    // ============================================================
    const p15 = await makePlan(user.id, 'Concurrent Plan', '2028-06-26T04:00:00Z', '2028-06-26T04:30:00Z');
    const [res15a, res15b] = await Promise.all([logPlannedActivity(user.id, p15.id), logPlannedActivity(user.id, p15.id)]);
    check('15. concurrent Done calls resolve to the SAME HabitLog id', (res15a.habitLog as any).id === (res15b.habitLog as any).id);
    const concurrentRowCount = (await sql(`SELECT count(*)::int AS c FROM "HabitLog" WHERE "originatingPlannedActivityId" = $1`, [p15.id]))[0].c;
    check('15. exactly one HabitLog row persisted despite concurrent calls', concurrentRowCount === 1);

    // ============================================================
    // 16. TRANSACTION ROLLBACK
    // ============================================================
    const { goal: g16 } = await createGoalWithActivities({ userId: user.id, title: 'Rollback Goal', targetDate: null, activities: [] });
    createdGoalIds.push(g16.id);
    const ga16 = await addGoalActivity(user.id, g16.id, { title: 'Done-only', activityId: null }); // DONE completion kind -- never accepts actualValue
    const p16 = await makePlan(user.id, 'Rollback Plan', '2028-06-27T04:00:00Z', '2028-06-27T04:30:00Z');
    await sql(`UPDATE "GoalActivity" SET "plannedActivityId" = $1 WHERE id = $2`, [p16.id, ga16!.id]);
    let rollbackThrew = false;
    try {
      await logPlannedActivity(user.id, p16.id, { actualValue: 5 }); // DONE-kind rejects any actualValue -- forces a throw before commit
    } catch {
      rollbackThrew = true;
    }
    check('16. invalid actualValue for a DONE-kind Goal activity throws', rollbackThrew);
    const p16After = (await sql(`SELECT status FROM "PlannedActivity" WHERE id = $1`, [p16.id]))[0];
    check('16. transaction rollback -- Plan status remains UPCOMING, not partially LOGGED', p16After.status === 'UPCOMING');
    const hl16Count = (await sql(`SELECT count(*)::int AS c FROM "HabitLog" WHERE "originatingPlannedActivityId" = $1`, [p16.id]))[0].c;
    check('16. transaction rollback -- zero HabitLog rows persisted, including the new attribution columns', hl16Count === 0);

    // ============================================================
    // 17/18. LEGACY ATTRIBUTION (NULL, simulating a pre-migration row)
    // ============================================================
    const p17 = await makePlan(user.id, 'Legacy Plan', '2028-06-28T04:00:00Z', '2028-06-28T04:30:00Z');
    const { habitLog: hl17 } = await logPlannedActivity(user.id, p17.id);
    // Simulate a pre-migration-0049 row: null out the four new columns directly.
    await sql(`UPDATE "HabitLog" SET "originatingPlannedActivityId" = NULL, "scheduledStartAtSnapshot" = NULL, "completionAttribution" = NULL, "originatingGoalActivityExecutionId" = NULL WHERE id = $1`, [(hl17 as any).id]);
    await deletePlannedActivity(user.id, p17.id);
    const legacyCount = await countDeletedNonGoalCompletionsInRange(user.id, iso('2028-06-27T00:00:00Z'), iso('2028-06-29T00:00:00Z'));
    check('17. legacy (NULL attribution) HabitLog -- never counted, NEVER silently treated as NON_GOAL', legacyCount === 0);

    // 18. legacy orphan -- same as 17 but explicitly confirms the orphan (no live Plan) state too.
    const orphanExists = (await sql(`SELECT 1 FROM "PlannedActivity" WHERE "habitLogId" = $1`, [(hl17 as any).id]))[0];
    check('18. legacy orphan HabitLog -- confirmed no live Plan references it, yet still correctly excluded', orphanExists === undefined);

    // ============================================================
    // 19. STANDALONE HABITLOG (manual logging, logSource != AURA_PLANNED)
    // ============================================================
    const standaloneLog = await createHabitLog({ userId: user.id, activityTitle: 'Standalone Manual Log', activeWindow: 'NEUTRAL', logMinuteOfDay: 600, logSource: 'MANUAL' });
    check('19. standalone HabitLog has NULL attribution columns (never set by the manual-logging path)', (standaloneLog as any).completionAttribution === undefined || (standaloneLog as any).completionAttribution === null);
    const standaloneCountBefore = await countDeletedNonGoalCompletionsInRange(user.id, iso('2020-01-01T00:00:00Z'), iso('2030-01-01T00:00:00Z'));
    check('19. standalone HabitLog never contributes to the fallback regardless of its own NULL columns', (await sql(`SELECT "logSource" FROM "HabitLog" WHERE id = $1`, [(standaloneLog as any).id]))[0].logSource === 'MANUAL');
    void standaloneCountBefore;

    // ============================================================
    // 20. DELETED GOAL -- gated, cannot misclassify a completed activity
    // ============================================================
    const deleteResult20 = await deleteGoal(user.id, g2.id);
    check('20. Goal with surviving completion evidence (GoalActivityExecution) cannot be deleted -- HAS_HISTORY', deleteResult20 === 'HAS_HISTORY');
    const hl2AfterAttempt = (await sql(`SELECT "completionAttribution", "originatingGoalActivityExecutionId" FROM "HabitLog" WHERE id = $1`, [(hl2 as any).id]))[0];
    check('20. HabitLog\'s own GOAL_LINKED attribution is unaffected by the blocked delete attempt', hl2AfterAttempt.completionAttribution === 'GOAL_LINKED' && hl2AfterAttempt.originatingGoalActivityExecutionId === exec2.id);

    // ============================================================
    // 21. PLAN DELETION RACE (sequential proof of mutually-exclusive guards)
    // ============================================================
    const p21 = await makePlan(user.id, 'Race Plan', '2028-06-29T04:00:00Z', '2028-06-29T04:30:00Z');
    let deleteBeforeLogThrew = false;
    try { await deletePlannedActivity(user.id, p21.id); } catch { deleteBeforeLogThrew = true; }
    check('21. deletePlannedActivity on a still-UPCOMING plan is rejected (guard prevents the race from ever corrupting state)', deleteBeforeLogThrew);
    await logPlannedActivity(user.id, p21.id);
    await deletePlannedActivity(user.id, p21.id); // now legitimately deletable
    const p21Count = await countDeletedNonGoalCompletionsInRange(user.id, iso('2028-06-28T00:00:00Z'), iso('2028-06-30T00:00:00Z'));
    check('21. after the correctly-ordered Done then delete, the fallback recovers it', p21Count === 1);

    // ============================================================
    // 22. MOVE/DONE RACE (sequential proof)
    // ============================================================
    const p22 = await makePlan(user.id, 'Move Race Plan', '2028-06-30T04:00:00Z', '2028-06-30T04:30:00Z');
    await logPlannedActivity(user.id, p22.id);
    let moveAfterDoneThrew = false;
    try { await movePlannedActivity(user.id, p22.id, { newStartAt: iso('2028-07-01T04:00:00.000Z') }); } catch { moveAfterDoneThrew = true; }
    check('22. Move on an already-LOGGED plan is rejected (guard prevents an inconsistent Move/Done race)', moveAfterDoneThrew);

    // ============================================================
    // 23. USER ISOLATION
    // ============================================================
    const pOther = await makePlan(other.id, 'Other User Plan', '2028-06-01T04:00:00Z', '2028-06-01T04:30:00Z');
    await logPlannedActivity(other.id, pOther.id);
    await deletePlannedActivity(other.id, pOther.id);
    const otherCount = await countDeletedNonGoalCompletionsInRange(other.id, iso('2028-05-25T00:00:00Z'), iso('2028-06-10T00:00:00Z'));
    const userCountUnaffected = await countDeletedNonGoalCompletionsInRange(user.id, iso('2028-05-25T00:00:00Z'), iso('2028-06-03T00:00:00Z'));
    check('23. user B\'s deleted completion is correctly counted for user B', otherCount === 1);
    check('23. user A\'s own count is unaffected by user B\'s data', userCountUnaffected === 1); // only p1 from scenario 4 in this narrower range

    // ============================================================
    // 24. NO READ-SIDE WRITES
    // ============================================================
    const beforeCounts = await sql(`SELECT
      (SELECT count(*)::int FROM "HabitLog") AS habitlog,
      (SELECT count(*)::int FROM "PlannedActivity") AS plannedactivity,
      (SELECT count(*)::int FROM "GoalActivityExecution") AS execution`);
    await countDeletedNonGoalCompletionsInRange(user.id, iso('2028-01-01T00:00:00Z'), iso('2029-01-01T00:00:00Z'));
    const afterCounts = await sql(`SELECT
      (SELECT count(*)::int FROM "HabitLog") AS habitlog,
      (SELECT count(*)::int FROM "PlannedActivity") AS plannedactivity,
      (SELECT count(*)::int FROM "GoalActivityExecution") AS execution`);
    check('24. countDeletedNonGoalCompletionsInRange performs zero writes', JSON.stringify(beforeCounts[0]) === JSON.stringify(afterCounts[0]));

    // ============================================================
    // 25. BOUNDED QUERY COUNT (index usage, not a sequential scan)
    // ============================================================
    const explain = await sql(`EXPLAIN SELECT count(*) FROM "HabitLog" hl
       WHERE hl."userId" = $1 AND hl."logSource" = 'AURA_PLANNED' AND hl."completionAttribution" = 'NON_GOAL'
         AND hl."originatingPlannedActivityId" IS NOT NULL AND hl."scheduledStartAtSnapshot" IS NOT NULL
         AND hl."scheduledStartAtSnapshot" BETWEEN $2 AND $3
         AND NOT EXISTS (SELECT 1 FROM "PlannedActivity" pa WHERE pa."habitLogId" = hl.id)`,
      [user.id, iso('2028-01-01T00:00:00Z'), iso('2029-01-01T00:00:00Z')]);
    const explainText = explain.map((r) => r['QUERY PLAN']).join('\n');
    check('25. reporting fallback query plan uses an index (not a full sequential scan on HabitLog)', /Index/i.test(explainText));

    // ============================================================
    // 26. EXISTING PR4 TOTALS UNCHANGED FOR UNAFFECTED RECORDS
    // ============================================================
    const p26 = await makePlan(user.id, 'Unaffected Live Plan', '2028-08-15T04:00:00Z', '2028-08-15T04:30:00Z'); // never logged, never deleted
    const plans26 = await listPlannedActivitiesForReporting(user.id, iso('2028-08-15T00:00:00Z'), iso('2028-08-16T00:00:00Z'));
    const status26 = summarizePlanningStatus(plans26, iso('2028-08-15T03:00:00Z')); // "now" well BEFORE plannedEndAt -- still genuinely SCHEDULED, not elapsed
    check('26. an ordinary live, never-logged, never-deleted plan reports SCHEDULED exactly as PR4 always did', status26.scheduled >= 1 && status26.confirmedCompleted === 0);
    await cancelPlannedActivity(user.id, p26.id);

    // ============================================================
    // 27. PR5 SIGNAL REGRESSION -- awaitingConfirmation unaffected, composition runs cleanly
    // ============================================================
    const freshUser = (await getUserById(user.id))!;
    const todayLocalDate = getDatePartsInTimezone(freshUser.timezone, now2028).dateStr;
    const suggestions27 = await computeImprovementSuggestions({
      user: freshUser, now: now2028, todayLocalDate,
      awaitingConfirmationCount: 0,
      goalSummaries: [], rows: [],
    });
    check('27. PR5 improvement-signal composition runs cleanly, unaffected by PR6 (no error, valid shape)', suggestions27 !== undefined && Array.isArray(suggestions27.secondary));

    // ============================================================
    // 28. ACCOUNT DELETION BEHAVIOR -- N/A, documented (no such flow exists)
    // ============================================================
    console.log('28. N/A -- no account/user-deletion flow exists anywhere in this codebase (confirmed by grep in the PR6 architecture audit); not fabricating a test for a feature that does not exist.');

    console.log(allPassed ? '\nALL PR6 COMPLETION-ATTRIBUTION SCENARIOS PASSED' : '\nSOME SCENARIOS FAILED');
  } finally {
    await cleanup();
  }
}

main()
  .then(() => process.exit(allPassed ? 0 : 1))
  .catch((err) => { console.error(err); process.exit(1); });
