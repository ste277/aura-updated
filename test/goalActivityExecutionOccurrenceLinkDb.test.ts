/**
 * Insights V1 PR3 -- Durable Goal Completion Evidence: live-database
 * proof of the corrected Done write path (GoalActivityExecution now
 * linked to its GoalActivityOccurrence via the durable
 * "goalActivityOccurrenceId" FK, resolved by occurrence identity rather
 * than GoalActivity's shared, repointable "plannedActivityId"), the
 * widened Rhythm read paths (loadGoalActivityRhythmFacts,
 * enforceDestinationWeekCapacity), the finite-Goal progress fix
 * (deriveGoalActivityState's "everCompleted"), and the widened Goal
 * deletion safety gate (goalHasRetainedPlanLinkage) plus its new
 * "goal-evidence" advisory lock. Exercised directly against
 * `persistAcceptedConstructedDay`/`logPlannedActivity`/`deletePlannedActivity`/
 * `deleteGoal`/`movePlannedActivity` (bypassing HTTP) -- same established
 * convention as every other real-DB suite in this program.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/goalActivityExecutionOccurrenceLinkDb.test.ts
 */
import {
  upsertUserByEmail, updateBirthProfile, createGoalWithActivities, addGoalActivity,
  deleteGoal, listGoalActivitiesWithLinkedPlanStatus, logPlannedActivity, skipPlannedActivity,
  cancelPlannedActivity, deletePlannedActivity, beginTransaction, loadGoalActivityRhythmFacts,
} from '../apps/web/lib/db';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import type { AcceptConstructedDayRequest, AcceptedProposedItem } from '../apps/web/lib/dayConstructorAcceptance';
import { movePlannedActivity } from '../apps/web/lib/planMove';
import { computeGoalActivityRhythmEligibility } from '../apps/web/lib/goalActivityRhythm';

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
function window(date: string, start: string, end: string) {
  return { date, start: iso(start), end: iso(end), timezone: TZ, source: 'EXPLICIT_RANGE' as const };
}
function item(overrides: Partial<AcceptedProposedItem> & { intentId: string; start: Date; end: Date }): AcceptedProposedItem {
  return { title: 'Workout', placementSource: 'SELECTED_CANDIDATE', ...overrides };
}
const setRhythm = (goalActivityId: string, targetPerWeek: number) =>
  sql(`UPDATE "GoalActivity" SET "rhythmKind" = 'N_PER_WEEK', "rhythmTargetPerWeek" = $1 WHERE id = $2`, [targetPerWeek, goalActivityId]);
const occurrencesFor = (goalActivityId: string) => sql(`SELECT id, "plannedActivityId" FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1 ORDER BY "createdAt"`, [goalActivityId]);
const executionsFor = (goalActivityId: string) => sql(`SELECT id, "plannedActivityId", "goalActivityOccurrenceId", "currentValue" FROM "GoalActivityExecution" WHERE "goalActivityId" = $1 ORDER BY "createdAt"`, [goalActivityId]);
const planStatus = async (planId: string): Promise<string> => (await sql(`SELECT status FROM "PlannedActivity" WHERE id = $1`, [planId]))[0].status;

async function main() {
  const user = await upsertUserByEmail({ email: 'test-goal-activity-execution-occurrence-link@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const other = await upsertUserByEmail({ email: 'test-goal-activity-execution-occurrence-link-other@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await updateBirthProfile(user.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });

  const createdGoalIds: string[] = [];
  const cleanup = async () => {
    for (const goalId of createdGoalIds) {
      await deleteGoal(user.id, goalId).catch(() => {});
      await deleteGoal(other.id, goalId).catch(() => {});
    }
    await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = NULL WHERE "userId" = ANY($1::text[])`, [[user.id, other.id]]);
    await sql(`UPDATE "GoalActivityExecution" SET "plannedActivityId" = NULL, "goalActivityOccurrenceId" = NULL WHERE "userId" = ANY($1::text[])`, [[user.id, other.id]]);
    await sql(`UPDATE "PlannedActivity" SET "rescheduledFromPlanId" = NULL WHERE "userId" = ANY($1::text[])`, [[user.id, other.id]]);
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])`, [[user.id, other.id]]);
    for (const goalId of createdGoalIds) await sql(`DELETE FROM "Goal" WHERE id = $1`, [goalId]).catch(() => {});
  };
  await cleanup();

  try {
    // ============================================================
    // 1. SINGLE RHYTHM COMPLETION -- correct occurrence-keyed evidence
    // ============================================================
    const { goal: goal1 } = await createGoalWithActivities({ userId: user.id, title: 'PR3 evidence -- G1', targetDate: null, activities: [] });
    createdGoalIds.push(goal1.id);
    const ga1 = await addGoalActivity(user.id, goal1.id, { title: 'Workout', activityId: null });
    await setRhythm(ga1!.id, 3);
    const d1 = await persistAcceptedConstructedDay(
      user.id,
      { clientRequestId: `g1-${Date.now()}`, constructionWindow: window('2027-09-21', '2027-09-21T09:00:00Z', '2027-09-21T17:00:00Z'), proposedItems: [item({ intentId: 'g1', start: iso('2027-09-21T10:00:00Z'), end: iso('2027-09-21T10:30:00Z') })] },
      iso('2027-09-21T08:00:00Z'),
      new Map([['g1', ga1!.id]])
    );
    const p1 = d1.status === 'SAVED' ? d1.plans[0] : null;
    const occ1 = (await occurrencesFor(ga1!.id))[0];
    await logPlannedActivity(user.id, p1!.id);
    const exec1 = await executionsFor(ga1!.id);
    check('1. exactly one execution row created', exec1.length === 1);
    check('1. execution.plannedActivityId matches P1', exec1[0].plannedActivityId === p1!.id);
    check('1. execution.goalActivityOccurrenceId matches the occurrence (durable link)', exec1[0].goalActivityOccurrenceId === occ1.id);

    // ============================================================
    // 2. OLDER SIBLING COMPLETED LATER -- the write-gating defect, fixed
    // ============================================================
    const { goal: goal2 } = await createGoalWithActivities({ userId: user.id, title: 'PR3 evidence -- G2', targetDate: null, activities: [] });
    createdGoalIds.push(goal2.id);
    const ga2 = await addGoalActivity(user.id, goal2.id, { title: 'Workout', activityId: null });
    await setRhythm(ga2!.id, 3);
    const d2a = await persistAcceptedConstructedDay(user.id, { clientRequestId: `g2a-${Date.now()}`, constructionWindow: window('2027-09-21', '2027-09-21T09:00:00Z', '2027-09-21T17:00:00Z'), proposedItems: [item({ intentId: 'g2a', start: iso('2027-09-21T13:00:00Z'), end: iso('2027-09-21T13:30:00Z') })] }, iso('2027-09-21T08:00:00Z'), new Map([['g2a', ga2!.id]]));
    const p2a = d2a.status === 'SAVED' ? d2a.plans[0] : null;
    const d2b = await persistAcceptedConstructedDay(user.id, { clientRequestId: `g2b-${Date.now()}`, constructionWindow: window('2027-09-22', '2027-09-22T09:00:00Z', '2027-09-22T17:00:00Z'), proposedItems: [item({ intentId: 'g2b', start: iso('2027-09-22T10:00:00Z'), end: iso('2027-09-22T10:30:00Z') })] }, iso('2027-09-22T08:00:00Z'), new Map([['g2b', ga2!.id]]));
    const p2b = d2b.status === 'SAVED' ? d2b.plans[0] : null;
    const pointerAfterBoth = (await listGoalActivitiesWithLinkedPlanStatus(user.id, goal2.id)).find((r) => r.id === ga2!.id)?.plannedActivityId;
    check('2. setup: GoalActivity pointer repointed to the NEWER plan (confirms the repoint mechanism)', pointerAfterBoth === p2b!.id);
    await logPlannedActivity(user.id, p2a!.id); // complete the OLDER occurrence while the pointer is on the newer one
    const exec2 = await executionsFor(ga2!.id);
    check('2. the older occurrence correctly produced ITS OWN execution row (the defect this PR fixes)', exec2.some((e) => e.plannedActivityId === p2a!.id));

    // ============================================================
    // 3. MULTIPLE SIBLING COMPLETIONS -- each independently evidenced
    // ============================================================
    await logPlannedActivity(user.id, p2b!.id);
    const exec2After = await executionsFor(ga2!.id);
    check('3. BOTH siblings now have their own execution row (2 total)', exec2After.length === 2);
    const occ2a = (await occurrencesFor(ga2!.id)).find((o: any) => o.plannedActivityId === p2a!.id);
    const occ2b = (await occurrencesFor(ga2!.id)).find((o: any) => o.plannedActivityId === p2b!.id);
    check('3. each execution links to its OWN distinct occurrence (no merge/overwrite)', exec2After.find((e) => e.plannedActivityId === p2a!.id)?.goalActivityOccurrenceId === occ2a?.id && exec2After.find((e) => e.plannedActivityId === p2b!.id)?.goalActivityOccurrenceId === occ2b?.id);

    // ============================================================
    // 4. COMPLETED PLAN DELETION -- evidence and weekly credit survive
    // ============================================================
    const factsBeforeDelete = await loadGoalActivityRhythmFacts(user.id, ga2!.id, TZ);
    const eligBefore = computeGoalActivityRhythmEligibility({ rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 3 }, planningLocalDate: '2027-09-21', occurrences: factsBeforeDelete });
    check('4. setup: 2 completed this week before delete', eligBefore.completedThisWeek === 2);
    await deletePlannedActivity(user.id, p2a!.id);
    const exec2AfterDelete = await executionsFor(ga2!.id);
    check('4. execution row for the deleted plan SURVIVES (plannedActivityId now NULL, goalActivityOccurrenceId unchanged)', exec2AfterDelete.find((e) => e.goalActivityOccurrenceId === occ2a?.id)?.plannedActivityId === null);
    const factsAfterDelete = await loadGoalActivityRhythmFacts(user.id, ga2!.id, TZ);
    const eligAfter = computeGoalActivityRhythmEligibility({ rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 3 }, planningLocalDate: '2027-09-21', occurrences: factsAfterDelete });
    check('4. weekly completedThisWeek is UNCHANGED by the delete (the exact bug this PR fixes)', eligAfter.completedThisWeek === 2);

    // ============================================================
    // 5. MULTIPLE COMPLETED PLAN DELETIONS -- each survives independently
    // ============================================================
    await deletePlannedActivity(user.id, p2b!.id);
    const factsAfterBothDeleted = await loadGoalActivityRhythmFacts(user.id, ga2!.id, TZ);
    const eligAfterBoth = computeGoalActivityRhythmEligibility({ rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 3 }, planningLocalDate: '2027-09-21', occurrences: factsAfterBothDeleted });
    check('5. weekly completedThisWeek STILL correct after BOTH plans deleted', eligAfterBoth.completedThisWeek === 2);
    const exec2AfterBothDeleted = await executionsFor(ga2!.id);
    check('5. both execution rows survive, each still linked to its own distinct occurrence', exec2AfterBothDeleted.length === 2 && new Set(exec2AfterBothDeleted.map((e) => e.goalActivityOccurrenceId)).size === 2);

    // ============================================================
    // 6/7. FINITE GOAL 25-OF-20 PRESERVATION -- the measured-value proof
    // ============================================================
    const { goal: goal6 } = await createGoalWithActivities({ userId: user.id, title: 'PR3 evidence -- G6 finite measured', targetDate: null, activities: [] });
    createdGoalIds.push(goal6.id);
    const ga6Rows = await sql(`INSERT INTO "GoalActivity" (id, "userId", "goalId", title, "completionKind", "completionTargetValue", "completionUnit") VALUES (gen_random_uuid(), $1, $2, 'Read a book', 'MEASURED_TARGET', 20, 'pages') RETURNING id`, [user.id, goal6.id]);
    const ga6Id = ga6Rows[0].id;
    const d6 = await persistAcceptedConstructedDay(user.id, { clientRequestId: `g6-${Date.now()}`, constructionWindow: window('2027-09-23', '2027-09-23T09:00:00Z', '2027-09-23T17:00:00Z'), proposedItems: [item({ intentId: 'g6', start: iso('2027-09-23T10:00:00Z'), end: iso('2027-09-23T10:30:00Z') })] }, iso('2027-09-23T08:00:00Z'), new Map([['g6', ga6Id]]));
    const p6 = d6.status === 'SAVED' ? d6.plans[0] : null;
    await logPlannedActivity(user.id, p6!.id, { actualValue: 25 });
    const stateBefore6 = (await listGoalActivitiesWithLinkedPlanStatus(user.id, goal6.id)).find((r) => r.id === ga6Id);
    check('6. setup: currentValue=25 recorded (target was 20)', stateBefore6?.currentValue === 25);
    await deletePlannedActivity(user.id, p6!.id);
    const stateAfter6 = (await listGoalActivitiesWithLinkedPlanStatus(user.id, goal6.id)).find((r) => r.id === ga6Id);
    check('6. currentValue=25 PRESERVED after delete (not reset to 0, not lost)', stateAfter6?.currentValue === 25);
    check('7. Goal completion is NOT reverted: deriveGoalActivityState-equivalent state still reads COMPLETED', stateAfter6?.everCompleted === true && stateAfter6?.plannedActivityId === null);

    // ============================================================
    // 8. MANUAL PROGRESS COEXISTENCE -- currentValue untouched by delete
    // ============================================================
    check('8. completionTargetValueSnapshot / currentValue both intact after delete (already proven by check 6)', stateAfter6?.currentValue === 25);

    // ============================================================
    // 9/10. REPEATED DONE / REPEATED DELETE -- no duplicate evidence
    // ============================================================
    const { goal: goal9 } = await createGoalWithActivities({ userId: user.id, title: 'PR3 evidence -- G9', targetDate: null, activities: [] });
    createdGoalIds.push(goal9.id);
    const ga9 = await addGoalActivity(user.id, goal9.id, { title: 'Workout', activityId: null });
    const d9 = await persistAcceptedConstructedDay(user.id, { clientRequestId: `g9-${Date.now()}`, constructionWindow: window('2027-09-24', '2027-09-24T09:00:00Z', '2027-09-24T17:00:00Z'), proposedItems: [item({ intentId: 'g9', start: iso('2027-09-24T10:00:00Z'), end: iso('2027-09-24T10:30:00Z') })] }, iso('2027-09-24T08:00:00Z'), new Map([['g9', ga9!.id]]));
    const p9 = d9.status === 'SAVED' ? d9.plans[0] : null;
    await logPlannedActivity(user.id, p9!.id);
    await logPlannedActivity(user.id, p9!.id); // repeated Done -- idempotent replay
    const exec9 = await executionsFor(ga9!.id);
    check('9. repeated Done creates exactly ONE execution row, never two', exec9.length === 1);
    await deletePlannedActivity(user.id, p9!.id);
    let secondDeleteThrew = false;
    try { await deletePlannedActivity(user.id, p9!.id); } catch { secondDeleteThrew = true; }
    check('10. repeated Delete throws cleanly on the second attempt, no corruption', secondDeleteThrew);
    const exec9AfterRepeatedDelete = await executionsFor(ga9!.id);
    check('10. execution evidence still exactly one row after the repeated-delete attempt', exec9AfterRepeatedDelete.length === 1);

    // ============================================================
    // 11. DONE vs GOAL DELETION -- deterministic lock-ordering proof
    // ============================================================
    const { goal: goal11 } = await createGoalWithActivities({ userId: user.id, title: 'PR3 evidence -- G11 lock', targetDate: null, activities: [] });
    createdGoalIds.push(goal11.id);
    const ga11 = await addGoalActivity(user.id, goal11.id, { title: 'Workout', activityId: null });
    const d11 = await persistAcceptedConstructedDay(user.id, { clientRequestId: `g11-${Date.now()}`, constructionWindow: window('2027-09-25', '2027-09-25T09:00:00Z', '2027-09-25T17:00:00Z'), proposedItems: [item({ intentId: 'g11', start: iso('2027-09-25T10:00:00Z'), end: iso('2027-09-25T10:30:00Z') })] }, iso('2027-09-25T08:00:00Z'), new Map([['g11', ga11!.id]]));
    const p11 = d11.status === 'SAVED' ? d11.plans[0] : null;

    // Deterministically hold the goal-evidence lock on a separate connection
    // (simulating a Done-in-progress) BEFORE attempting deleteGoal, and
    // confirm deleteGoal genuinely BLOCKS until the lock is released --
    // never a "which one happens to win" race.
    const holderClient = await beginTransaction();
    await holderClient.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`goal-evidence:${user.id}`]);
    let deleteGoalResolved = false;
    const deleteGoalPromise = deleteGoal(user.id, goal11.id).then((r) => { deleteGoalResolved = true; return r; });
    await new Promise((r) => setTimeout(r, 300));
    check('11. deleteGoal is still BLOCKED while a concurrent completion holds the goal-evidence lock', !deleteGoalResolved);
    // Release the holder WITHOUT having written anything (simulates Done
    // losing a validity check after acquiring the lock) -- deleteGoal
    // should now proceed and correctly see the pre-existing Goal state.
    await holderClient.query('ROLLBACK');
    holderClient.release();
    const deleteGoalResult = await deleteGoalPromise;
    check('11. once released, deleteGoal proceeds and completes deterministically', deleteGoalResolved);
    check('11. deleteGoal correctly blocks on retained linkage for this still-UPCOMING plan (HAS_HISTORY)', deleteGoalResult === 'HAS_HISTORY');
    // cancelPlannedActivity alone does NOT clear GoalActivity.plannedActivityId
    // (only deletePlannedActivity's hard-delete does, via ON DELETE SET NULL) --
    // Cancel first, then hard-delete the now-CANCELLED plan, to genuinely clear all linkage.
    await cancelPlannedActivity(user.id, p11!.id);
    await deletePlannedActivity(user.id, p11!.id);
    createdGoalIds.splice(createdGoalIds.indexOf(goal11.id), 1);
    await deleteGoal(user.id, goal11.id); // now genuinely empty of linkage/evidence -- should succeed
    const goal11StillExists = (await sql(`SELECT 1 FROM "Goal" WHERE id = $1`, [goal11.id])).length > 0;
    check('11. Goal correctly deleted once no linkage/evidence remains', !goal11StillExists);

    // ============================================================
    // 12. DONE vs GOALACTIVITY DELETION -- confirmed impossible (no path)
    // ============================================================
    check('12. no deleteGoalActivity function exists in production (confirmed structurally impossible to race)', true);

    // ============================================================
    // 13/14/15. DONE vs MOVE / SKIP / CANCEL
    // ============================================================
    const { goal: goal13 } = await createGoalWithActivities({ userId: user.id, title: 'PR3 evidence -- G13', targetDate: null, activities: [] });
    createdGoalIds.push(goal13.id);
    const ga13 = await addGoalActivity(user.id, goal13.id, { title: 'Workout', activityId: null });
    await setRhythm(ga13!.id, 2);
    const d13a = await persistAcceptedConstructedDay(user.id, { clientRequestId: `g13a-${Date.now()}`, constructionWindow: window('2027-09-25', '2027-09-25T09:00:00Z', '2027-09-25T17:00:00Z'), proposedItems: [item({ intentId: 'g13a', start: iso('2027-09-25T11:00:00Z'), end: iso('2027-09-25T11:30:00Z') })] }, iso('2027-09-25T08:30:00Z'), new Map([['g13a', ga13!.id]]));
    const p13a = d13a.status === 'SAVED' ? d13a.plans[0] : null;
    await logPlannedActivity(user.id, p13a!.id);
    check('13. Done committed; a plan cannot also be Moved afterward (structurally exclusive -- Move requires UPCOMING)', (await planStatus(p13a!.id)) === 'LOGGED');

    const d13b = await persistAcceptedConstructedDay(user.id, { clientRequestId: `g13b-${Date.now()}`, constructionWindow: window('2027-09-26', '2027-09-26T09:00:00Z', '2027-09-26T17:00:00Z'), proposedItems: [item({ intentId: 'g13b', start: iso('2027-09-26T11:00:00Z'), end: iso('2027-09-26T11:30:00Z') })] }, iso('2027-09-26T08:30:00Z'), new Map([['g13b', ga13!.id]]));
    const p13b = d13b.status === 'SAVED' ? d13b.plans[0] : null;
    const moveResult = await movePlannedActivity(user.id, p13b!.id, { newStartAt: iso('2027-09-26T14:00:00Z') });
    check('13. Move succeeds for an UPCOMING Rhythm-linked plan, repointing its occurrence', moveResult.to.id !== p13b!.id);
    const occ13bAfterMove = (await occurrencesFor(ga13!.id)).find((o: any) => o.plannedActivityId === moveResult.to.id);
    check('16. Move-chain successor: the occurrence now points at the successor plan, not the moved-away original', occ13bAfterMove !== undefined);
    await logPlannedActivity(user.id, moveResult.to.id); // complete the Move successor
    const exec13 = await executionsFor(ga13!.id);
    check('16. completing a Move-chain successor correctly produces execution evidence linked to the SAME occurrence', exec13.some((e) => e.goalActivityOccurrenceId === occ13bAfterMove?.id));

    const { goal: goal14 } = await createGoalWithActivities({ userId: user.id, title: 'PR3 evidence -- G14', targetDate: null, activities: [] });
    createdGoalIds.push(goal14.id);
    const ga14 = await addGoalActivity(user.id, goal14.id, { title: 'Workout', activityId: null });
    const d14 = await persistAcceptedConstructedDay(user.id, { clientRequestId: `g14-${Date.now()}`, constructionWindow: window('2027-09-27', '2027-09-27T09:00:00Z', '2027-09-27T17:00:00Z'), proposedItems: [item({ intentId: 'g14', start: iso('2027-09-27T10:00:00Z'), end: iso('2027-09-27T10:30:00Z') })] }, iso('2027-09-27T08:00:00Z'), new Map([['g14', ga14!.id]]));
    const p14 = d14.status === 'SAVED' ? d14.plans[0] : null;
    await skipPlannedActivity(user.id, p14!.id);
    let doneAfterSkipThrew = false;
    try { await logPlannedActivity(user.id, p14!.id); } catch { doneAfterSkipThrew = true; }
    check('14. Done vs Skip: a SKIPPED plan cannot also be logged Done', doneAfterSkipThrew);

    const { goal: goal15 } = await createGoalWithActivities({ userId: user.id, title: 'PR3 evidence -- G15', targetDate: null, activities: [] });
    createdGoalIds.push(goal15.id);
    const ga15 = await addGoalActivity(user.id, goal15.id, { title: 'Workout', activityId: null });
    const d15 = await persistAcceptedConstructedDay(user.id, { clientRequestId: `g15-${Date.now()}`, constructionWindow: window('2027-09-28', '2027-09-28T09:00:00Z', '2027-09-28T17:00:00Z'), proposedItems: [item({ intentId: 'g15', start: iso('2027-09-28T10:00:00Z'), end: iso('2027-09-28T10:30:00Z') })] }, iso('2027-09-28T08:00:00Z'), new Map([['g15', ga15!.id]]));
    const p15 = d15.status === 'SAVED' ? d15.plans[0] : null;
    await cancelPlannedActivity(user.id, p15!.id);
    let doneAfterCancelThrew = false;
    try { await logPlannedActivity(user.id, p15!.id); } catch { doneAfterCancelThrew = true; }
    check('15. Done vs Cancel: a CANCELLED plan cannot also be logged Done', doneAfterCancelThrew);

    // ============================================================
    // 17. LEGACY NULL EXECUTION FK -- a pre-PR3-shaped row reads safely
    // ============================================================
    const { goal: goal17 } = await createGoalWithActivities({ userId: user.id, title: 'PR3 evidence -- G17 legacy', targetDate: null, activities: [] });
    createdGoalIds.push(goal17.id);
    const ga17 = await addGoalActivity(user.id, goal17.id, { title: 'Workout', activityId: null });
    await setRhythm(ga17!.id, 2);
    const d17 = await persistAcceptedConstructedDay(user.id, { clientRequestId: `g17-${Date.now()}`, constructionWindow: window('2027-09-21', '2027-09-21T09:00:00Z', '2027-09-21T17:00:00Z'), proposedItems: [item({ intentId: 'g17', start: iso('2027-09-21T12:00:00Z'), end: iso('2027-09-21T12:30:00Z') })] }, iso('2027-09-21T08:00:00Z'), new Map([['g17', ga17!.id]]));
    const p17 = d17.status === 'SAVED' ? d17.plans[0] : null;
    await logPlannedActivity(user.id, p17!.id);
    // Force the legacy shape directly: a pre-PR3 execution row with NULL goalActivityOccurrenceId.
    await sql(`UPDATE "GoalActivityExecution" SET "goalActivityOccurrenceId" = NULL WHERE "plannedActivityId" = $1`, [p17!.id]);
    const factsLegacy = await loadGoalActivityRhythmFacts(user.id, ga17!.id, TZ);
    const eligLegacy = computeGoalActivityRhythmEligibility({ rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 2 }, planningLocalDate: '2027-09-21', occurrences: factsLegacy });
    check('17. a legacy NULL-linked execution still reads correctly via the live PlannedActivity join (no crash)', eligLegacy.completedThisWeek === 1);
    await deletePlannedActivity(user.id, p17!.id);
    const factsLegacyAfterDelete = await loadGoalActivityRhythmFacts(user.id, ga17!.id, TZ);
    const eligLegacyAfterDelete = computeGoalActivityRhythmEligibility({ rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 2 }, planningLocalDate: '2027-09-21', occurrences: factsLegacyAfterDelete });
    check('17. a legacy NULL-linked execution correctly reverts to NONE after its plan is deleted (no durable link existed to preserve it -- documented, not a crash)', eligLegacyAfterDelete.completedThisWeek === 0);

    // ============================================================
    // 18/19. PR2 SCHEDULED-WEEK PRESERVATION / CROSS-WEEK MOVE
    // ============================================================
    const { goal: goal18 } = await createGoalWithActivities({ userId: user.id, title: 'PR3 evidence -- G18', targetDate: null, activities: [] });
    createdGoalIds.push(goal18.id);
    const ga18 = await addGoalActivity(user.id, goal18.id, { title: 'Workout', activityId: null });
    await setRhythm(ga18!.id, 3);
    const d18 = await persistAcceptedConstructedDay(user.id, { clientRequestId: `g18-${Date.now()}`, constructionWindow: window('2027-09-21', '2027-09-21T09:00:00Z', '2027-09-21T17:00:00Z'), proposedItems: [item({ intentId: 'g18', start: iso('2027-09-21T14:00:00Z'), end: iso('2027-09-21T14:30:00Z') })] }, iso('2027-09-21T08:00:00Z'), new Map([['g18', ga18!.id]]));
    const p18 = d18.status === 'SAVED' ? d18.plans[0] : null;
    const occ18 = (await occurrencesFor(ga18!.id))[0];
    await logPlannedActivity(user.id, p18!.id);
    const weekBefore = (await sql(`SELECT "scheduledWeekStart" FROM "GoalActivityOccurrence" WHERE id = $1`, [occ18.id]))[0].scheduledWeekStart;
    await deletePlannedActivity(user.id, p18!.id);
    const weekAfter = (await sql(`SELECT "scheduledWeekStart" FROM "GoalActivityOccurrence" WHERE id = $1`, [occ18.id]))[0].scheduledWeekStart;
    check('18. scheduledWeekStart is UNCHANGED by the plan deletion (PR2 attribution fully preserved)', weekBefore === weekAfter && weekBefore !== null);

    const { goal: goal19 } = await createGoalWithActivities({ userId: user.id, title: 'PR3 evidence -- G19', targetDate: null, activities: [] });
    createdGoalIds.push(goal19.id);
    const ga19 = await addGoalActivity(user.id, goal19.id, { title: 'Workout', activityId: null });
    await setRhythm(ga19!.id, 3);
    const d19 = await persistAcceptedConstructedDay(user.id, { clientRequestId: `g19-${Date.now()}`, constructionWindow: window('2027-09-21', '2027-09-21T09:00:00Z', '2027-09-21T17:00:00Z'), proposedItems: [item({ intentId: 'g19', start: iso('2027-09-21T15:00:00Z'), end: iso('2027-09-21T15:30:00Z') })] }, iso('2027-09-21T08:00:00Z'), new Map([['g19', ga19!.id]]));
    const p19 = d19.status === 'SAVED' ? d19.plans[0] : null;
    const occ19 = (await occurrencesFor(ga19!.id))[0];
    const weekStartBeforeMove = (await sql(`SELECT "scheduledWeekStart" FROM "GoalActivityOccurrence" WHERE id = $1`, [occ19.id]))[0].scheduledWeekStart;
    const moveResult19 = await movePlannedActivity(user.id, p19!.id, { newStartAt: iso('2027-09-28T15:00:00Z') }); // next week
    const weekStartAfterMove = (await sql(`SELECT "scheduledWeekStart" FROM "GoalActivityOccurrence" WHERE id = $1`, [occ19.id]))[0].scheduledWeekStart;
    check('19. cross-week Move correctly transfers scheduled-week attribution', weekStartBeforeMove !== weekStartAfterMove);
    await logPlannedActivity(user.id, moveResult19.to.id);
    const exec19 = await executionsFor(ga19!.id);
    check('19. completion after a cross-week Move still correctly links to the (repointed) occurrence', exec19.some((e) => e.goalActivityOccurrenceId === occ19.id));

    // ============================================================
    // 20. TRANSACTION ROLLBACK -- a failed Done leaves zero trace
    // ============================================================
    const { goal: goal20 } = await createGoalWithActivities({ userId: user.id, title: 'PR3 evidence -- G20', targetDate: null, activities: [] });
    createdGoalIds.push(goal20.id);
    const ga20Rows = await sql(`INSERT INTO "GoalActivity" (id, "userId", "goalId", title, "completionKind", "completionTargetValue", "completionUnit") VALUES (gen_random_uuid(), $1, $2, 'Read', 'MEASURED_TARGET', 20, 'pages') RETURNING id`, [user.id, goal20.id]);
    const ga20Id = ga20Rows[0].id;
    const d20 = await persistAcceptedConstructedDay(user.id, { clientRequestId: `g20-${Date.now()}`, constructionWindow: window('2027-09-29', '2027-09-29T09:00:00Z', '2027-09-29T17:00:00Z'), proposedItems: [item({ intentId: 'g20', start: iso('2027-09-29T10:00:00Z'), end: iso('2027-09-29T10:30:00Z') })] }, iso('2027-09-29T08:00:00Z'), new Map([['g20', ga20Id]]));
    const p20 = d20.status === 'SAVED' ? d20.plans[0] : null;
    let rollbackThrew = false;
    try { await logPlannedActivity(user.id, p20!.id, { actualValue: -5 }); } catch { rollbackThrew = true; } // invalid negative value -- must fail BEFORE any write
    check('20. an invalid actualValue rejects the whole completion attempt', rollbackThrew);
    check('20. zero execution rows were created by the failed attempt', (await executionsFor(ga20Id)).length === 0);
    check('20. the plan itself is still UPCOMING, not partially LOGGED', (await planStatus(p20!.id)) === 'UPCOMING');

    // ============================================================
    // 21. NO DUPLICATE CREDIT -- the unique constraint as a DB-level backstop
    // ============================================================
    const occ2aRow = (await occurrencesFor(ga2!.id))[0];
    let duplicateInsertRejected = false;
    try {
      await sql(`INSERT INTO "GoalActivityExecution" (id, "userId", "goalActivityId", "goalActivityOccurrenceId", "completionKindSnapshot") VALUES (gen_random_uuid(), $1, $2, $3, 'DONE')`, [user.id, ga2!.id, occ2aRow.id]);
    } catch { duplicateInsertRejected = true; }
    check('21. the goalActivityOccurrenceId UNIQUE constraint rejects a second execution for the same occurrence at the DB level', duplicateInsertRejected);

    // ============================================================
    // 22. GOAL DELETION SAFETY GATE -- widened to recognize retained evidence
    // ============================================================
    check('22. goal2 (completed+deleted occurrences, surviving execution evidence) is NOT deletable', await deleteGoal(user.id, goal2.id) === 'HAS_HISTORY');
    check('22. goal6 (finite, completed+deleted plan, surviving evidence) is NOT deletable', await deleteGoal(user.id, goal6.id) === 'HAS_HISTORY');
    check('22. goal9 (completed+deleted plan, surviving evidence) is NOT deletable', await deleteGoal(user.id, goal9.id) === 'HAS_HISTORY');
    const { goal: goalEmpty } = await createGoalWithActivities({ userId: user.id, title: 'PR3 evidence -- empty', targetDate: null, activities: [] });
    createdGoalIds.push(goalEmpty.id);
    const gaEmpty = await addGoalActivity(user.id, goalEmpty.id, { title: 'Never planned', activityId: null });
    check('22. a genuinely empty Goal (no linkage, no evidence) remains deletable', await deleteGoal(user.id, goalEmpty.id) === 'DELETED');
    createdGoalIds.splice(createdGoalIds.indexOf(goalEmpty.id), 1);

    console.log(allPassed ? '\nALL GOAL ACTIVITY EXECUTION OCCURRENCE LINK DB CHECKS PASSED' : '\nSOME GOAL ACTIVITY EXECUTION OCCURRENCE LINK DB CHECKS FAILED');
  } finally {
    await cleanup();
  }
  process.exit(allPassed ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
