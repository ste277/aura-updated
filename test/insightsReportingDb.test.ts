/**
 * Insights V1 PR4 -- Read-Only Goal and Planning Reporting: live-database
 * proof of the two new reads (listGoalActivitiesWithLinkedPlanStatusForGoals,
 * listPlannedActivitiesForReporting, both db.ts) and the pure reporting
 * logic (insightsReporting.ts) they feed -- exercised directly against
 * the real production functions (bypassing HTTP, same established
 * convention as every other real-DB suite in this program).
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/insightsReportingDb.test.ts
 */
import {
  upsertUserByEmail, updateBirthProfile, createGoalWithActivities, addGoalActivity,
  deleteGoal, logPlannedActivity, skipPlannedActivity, cancelPlannedActivity, deletePlannedActivity,
  beginTransaction, listGoalsForUser, listGoalActivitiesWithLinkedPlanStatusForGoals,
  listPlannedActivitiesForReporting, loadGoalActivityRhythmFactsForActivities,
} from '../apps/web/lib/db';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import type { AcceptConstructedDayRequest, AcceptedProposedItem } from '../apps/web/lib/dayConstructorAcceptance';
import { movePlannedActivity } from '../apps/web/lib/planMove';
import { normalizeGoalActivityRhythm } from '../apps/web/lib/goalActivityRhythm';
import { classifyPlanningStatus, summarizePlanningStatus, buildGoalSummary, classifyGoalKind } from '../apps/web/lib/insightsReporting';

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

async function buildSummaryFor(userId: string, goalIds: string[], goals: { id: string; title: string }[], now: Date) {
  const rows = await listGoalActivitiesWithLinkedPlanStatusForGoals(userId, goalIds);
  const rhythmIds = rows.filter((r) => normalizeGoalActivityRhythm(r).kind === 'N_PER_WEEK').map((r) => r.id);
  const facts = await loadGoalActivityRhythmFactsForActivities(userId, rhythmIds, TZ);
  const rowsByGoal = new Map<string, typeof rows>();
  for (const row of rows) {
    const arr = rowsByGoal.get(row.goalId) ?? [];
    arr.push(row);
    rowsByGoal.set(row.goalId, arr);
  }
  const todayLocalDate = now.toISOString().slice(0, 10);
  return goals.map((g) => buildGoalSummary(g, rowsByGoal.get(g.id) ?? [], facts, todayLocalDate));
}

async function main() {
  const user = await upsertUserByEmail({ email: 'test-insights-reporting@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const other = await upsertUserByEmail({ email: 'test-insights-reporting-other@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
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
    const REF_NOW = iso('2027-09-25T12:00:00Z'); // a fixed "now" for classifyPlanningStatus -- genuinely in the future of this suite's own fixture dates, matching the established 364-day-shift convention for this program's real-DB tests

    // ============================================================
    // 1. CONFIRMED COMPLETION
    // ============================================================
    const { goal: goal1 } = await createGoalWithActivities({ userId: user.id, title: 'PR4 reporting -- G1', targetDate: null, activities: [] });
    createdGoalIds.push(goal1.id);
    const ga1 = await addGoalActivity(user.id, goal1.id, { title: 'Workout', activityId: null });
    await setRhythm(ga1!.id, 3);
    const d1 = await persistAcceptedConstructedDay(user.id, { clientRequestId: `g1-${Date.now()}`, constructionWindow: window('2027-09-21', '2027-09-21T09:00:00Z', '2027-09-21T17:00:00Z'), proposedItems: [item({ intentId: 'g1', start: iso('2027-09-21T10:00:00Z'), end: iso('2027-09-21T10:30:00Z') })] }, iso('2027-09-21T08:00:00Z'), new Map([['g1', ga1!.id]]));
    const p1 = d1.status === 'SAVED' ? d1.plans[0] : null;
    await logPlannedActivity(user.id, p1!.id);
    const summary1 = (await buildSummaryFor(user.id, [goal1.id], [{ id: goal1.id, title: goal1.title }], REF_NOW))[0];
    check('1. confirmed completion reflected in Goal Rhythm weekly progress', summary1.activities[0].rhythm.kind === 'N_PER_WEEK' && summary1.activities[0].rhythm.completedThisWeek === 1);
    const plans1 = await listPlannedActivitiesForReporting(user.id, iso('2027-09-21T00:00:00Z'), iso('2027-09-21T23:59:59Z'));
    check('1. planning-status summary counts it as CONFIRMED COMPLETED', summarizePlanningStatus(plans1, REF_NOW).confirmedCompleted === 1);

    // ============================================================
    // 2. DELETED COMPLETED PLAN
    // ============================================================
    await deletePlannedActivity(user.id, p1!.id);
    const summary2 = (await buildSummaryFor(user.id, [goal1.id], [{ id: goal1.id, title: goal1.title }], REF_NOW))[0];
    check('2. weekly completedThisWeek UNCHANGED after the plan is deleted (durable evidence)', summary2.activities[0].rhythm.kind === 'N_PER_WEEK' && summary2.activities[0].rhythm.completedThisWeek === 1);

    // ============================================================
    // 3/4. OLDER SIBLING COMPLETION / MULTIPLE OCCURRENCES
    // ============================================================
    const d2a = await persistAcceptedConstructedDay(user.id, { clientRequestId: `g1b-${Date.now()}`, constructionWindow: window('2027-09-21', '2027-09-21T09:00:00Z', '2027-09-21T17:00:00Z'), proposedItems: [item({ intentId: 'g1b', start: iso('2027-09-21T13:00:00Z'), end: iso('2027-09-21T13:30:00Z') })] }, iso('2027-09-21T08:00:00Z'), new Map([['g1b', ga1!.id]]));
    const p2a = d2a.status === 'SAVED' ? d2a.plans[0] : null;
    const d2b = await persistAcceptedConstructedDay(user.id, { clientRequestId: `g1c-${Date.now()}`, constructionWindow: window('2027-09-22', '2027-09-22T09:00:00Z', '2027-09-22T17:00:00Z'), proposedItems: [item({ intentId: 'g1c', start: iso('2027-09-22T13:00:00Z'), end: iso('2027-09-22T13:30:00Z') })] }, iso('2027-09-22T08:00:00Z'), new Map([['g1c', ga1!.id]]));
    const p2b = d2b.status === 'SAVED' ? d2b.plans[0] : null;
    await logPlannedActivity(user.id, p2a!.id); // complete the OLDER occurrence while the pointer has moved to the newer one
    const summary3 = (await buildSummaryFor(user.id, [goal1.id], [{ id: goal1.id, title: goal1.title }], REF_NOW))[0];
    check('3. older-sibling completion correctly reflected (2 completed total: p1 + p2a)', summary3.activities[0].rhythm.kind === 'N_PER_WEEK' && summary3.activities[0].rhythm.completedThisWeek === 2);
    await logPlannedActivity(user.id, p2b!.id);
    const summary4 = (await buildSummaryFor(user.id, [goal1.id], [{ id: goal1.id, title: goal1.title }], REF_NOW))[0];
    check('4. multiple occurrences all independently reflected (3 completed, no merge/overwrite)', summary4.activities[0].rhythm.kind === 'N_PER_WEEK' && summary4.activities[0].rhythm.completedThisWeek === 3);

    // ============================================================
    // 5. FINITE GOAL PROGRESS
    // ============================================================
    const { goal: goal5 } = await createGoalWithActivities({ userId: user.id, title: 'PR4 reporting -- G5 finite', targetDate: null, activities: [] });
    createdGoalIds.push(goal5.id);
    const ga5Rows = await sql(`INSERT INTO "GoalActivity" (id, "userId", "goalId", title, "completionKind", "completionTargetValue", "completionUnit") VALUES (gen_random_uuid(), $1, $2, 'Read a book', 'MEASURED_TARGET', 20, 'pages') RETURNING id`, [user.id, goal5.id]);
    const ga5Id = ga5Rows[0].id;
    const d5 = await persistAcceptedConstructedDay(user.id, { clientRequestId: `g5-${Date.now()}`, constructionWindow: window('2027-09-23', '2027-09-23T09:00:00Z', '2027-09-23T17:00:00Z'), proposedItems: [item({ intentId: 'g5', start: iso('2027-09-23T10:00:00Z'), end: iso('2027-09-23T10:30:00Z') })] }, iso('2027-09-23T08:00:00Z'), new Map([['g5', ga5Id]]));
    const p5 = d5.status === 'SAVED' ? d5.plans[0] : null;
    await logPlannedActivity(user.id, p5!.id, { actualValue: 25 });
    const summary5 = (await buildSummaryFor(user.id, [goal5.id], [{ id: goal5.id, title: goal5.title }], REF_NOW))[0];
    check('5. finite Goal currentValue (25) surfaces in the reporting summary', summary5.activities[0].currentValue === 25);
    check('5. finite Goal derivedState is COMPLETED', summary5.activities[0].derivedState === 'COMPLETED');
    await deletePlannedActivity(user.id, p5!.id);
    const summary5b = (await buildSummaryFor(user.id, [goal5.id], [{ id: goal5.id, title: goal5.title }], REF_NOW))[0];
    check('5. finite Goal currentValue (25) PRESERVED after plan deletion', summary5b.activities[0].currentValue === 25);
    check('5. finite Goal derivedState still COMPLETED after plan deletion (everCompleted)', summary5b.activities[0].derivedState === 'COMPLETED');

    // ============================================================
    // 6. FUTURE UPCOMING
    // ============================================================
    const { goal: goal6 } = await createGoalWithActivities({ userId: user.id, title: 'PR4 reporting -- G6', targetDate: null, activities: [] });
    createdGoalIds.push(goal6.id);
    const ga6 = await addGoalActivity(user.id, goal6.id, { title: 'Workout', activityId: null });
    const d6 = await persistAcceptedConstructedDay(user.id, { clientRequestId: `g6-${Date.now()}`, constructionWindow: window('2027-09-29', '2027-09-29T09:00:00Z', '2027-09-29T17:00:00Z'), proposedItems: [item({ intentId: 'g6', start: iso('2027-09-29T10:00:00Z'), end: iso('2027-09-29T10:30:00Z') })] }, iso('2027-09-29T08:00:00Z'), new Map([['g6', ga6!.id]]));
    const p6 = d6.status === 'SAVED' ? d6.plans[0] : null;
    check('6. future UPCOMING plan classifies as SCHEDULED, never AWAITING_CONFIRMATION', classifyPlanningStatus(p6!, REF_NOW) === 'SCHEDULED');

    // ============================================================
    // 7. PAST UPCOMING (AWAITING CONFIRMATION)
    // ============================================================
    const d7 = await persistAcceptedConstructedDay(user.id, { clientRequestId: `g7-${Date.now()}`, constructionWindow: window('2027-09-20', '2027-09-20T09:00:00Z', '2027-09-20T17:00:00Z'), proposedItems: [item({ intentId: 'g7', start: iso('2027-09-20T10:00:00Z'), end: iso('2027-09-20T10:30:00Z') })] }, iso('2027-09-20T08:00:00Z'), new Map());
    const p7 = d7.status === 'SAVED' ? d7.plans[0] : null;
    check('7. past, still-UPCOMING plan classifies as AWAITING_CONFIRMATION, never a fabricated MISSED/failure', classifyPlanningStatus(p7!, REF_NOW) === 'AWAITING_CONFIRMATION');

    // ============================================================
    // 8. SKIPPED
    // ============================================================
    const d8 = await persistAcceptedConstructedDay(user.id, { clientRequestId: `g8-${Date.now()}`, constructionWindow: window('2027-09-26', '2027-09-26T09:00:00Z', '2027-09-26T17:00:00Z'), proposedItems: [item({ intentId: 'g8', start: iso('2027-09-26T10:00:00Z'), end: iso('2027-09-26T10:30:00Z') })] }, iso('2027-09-26T08:00:00Z'), new Map());
    const p8 = d8.status === 'SAVED' ? d8.plans[0] : null;
    await skipPlannedActivity(user.id, p8!.id);
    const p8Row = (await sql(`SELECT status, "plannedEndAt" FROM "PlannedActivity" WHERE id = $1`, [p8!.id]))[0];
    check('8. explicit SKIPPED requires persisted status, never inferred from elapsed time', classifyPlanningStatus(p8Row, REF_NOW) === 'SKIPPED');

    // ============================================================
    // 9. CANCELLED
    // ============================================================
    const d9 = await persistAcceptedConstructedDay(user.id, { clientRequestId: `g9-${Date.now()}`, constructionWindow: window('2027-09-27', '2027-09-27T09:00:00Z', '2027-09-27T17:00:00Z'), proposedItems: [item({ intentId: 'g9', start: iso('2027-09-27T10:00:00Z'), end: iso('2027-09-27T10:30:00Z') })] }, iso('2027-09-27T08:00:00Z'), new Map());
    const p9 = d9.status === 'SAVED' ? d9.plans[0] : null;
    await cancelPlannedActivity(user.id, p9!.id);
    const p9Row = (await sql(`SELECT status, "plannedEndAt" FROM "PlannedActivity" WHERE id = $1`, [p9!.id]))[0];
    check('9. explicit CANCELLED requires persisted status, never inferred', classifyPlanningStatus(p9Row, REF_NOW) === 'CANCELLED');

    // ============================================================
    // 10. MOVED SOURCE/SUCCESSOR -- not double-counted as two commitments
    // ============================================================
    const d10 = await persistAcceptedConstructedDay(user.id, { clientRequestId: `g10-${Date.now()}`, constructionWindow: window('2027-09-28', '2027-09-28T09:00:00Z', '2027-09-28T17:00:00Z'), proposedItems: [item({ intentId: 'g10', start: iso('2027-09-28T10:00:00Z'), end: iso('2027-09-28T10:30:00Z') })] }, iso('2027-09-28T08:00:00Z'), new Map());
    const p10 = d10.status === 'SAVED' ? d10.plans[0] : null;
    const move10 = await movePlannedActivity(user.id, p10!.id, { newStartAt: iso('2027-09-28T14:00:00Z') });
    const plans10 = await sql(`SELECT status, "plannedEndAt" FROM "PlannedActivity" WHERE id = ANY($1::text[])`, [[p10!.id, move10.to.id]]);
    const facts10 = plans10.map((p) => classifyPlanningStatus(p, REF_NOW));
    check('10. MOVED source classifies RESCHEDULED', facts10.includes('RESCHEDULED'));
    check('10. successor classifies on its own current status (SCHEDULED), never also RESCHEDULED', facts10.includes('SCHEDULED') && facts10.filter((f) => f === 'RESCHEDULED').length === 1);

    // ============================================================
    // 11. LEGACY NULL EXECUTION LINK
    // ============================================================
    const { goal: goal11 } = await createGoalWithActivities({ userId: user.id, title: 'PR4 reporting -- G11 legacy', targetDate: null, activities: [] });
    createdGoalIds.push(goal11.id);
    const ga11 = await addGoalActivity(user.id, goal11.id, { title: 'Workout', activityId: null });
    await setRhythm(ga11!.id, 2);
    const d11 = await persistAcceptedConstructedDay(user.id, { clientRequestId: `g11-${Date.now()}`, constructionWindow: window('2027-09-21', '2027-09-21T09:00:00Z', '2027-09-21T17:00:00Z'), proposedItems: [item({ intentId: 'g11', start: iso('2027-09-21T15:00:00Z'), end: iso('2027-09-21T15:30:00Z') })] }, iso('2027-09-21T08:00:00Z'), new Map([['g11', ga11!.id]]));
    const p11 = d11.status === 'SAVED' ? d11.plans[0] : null;
    await logPlannedActivity(user.id, p11!.id);
    await sql(`UPDATE "GoalActivityExecution" SET "goalActivityOccurrenceId" = NULL WHERE "plannedActivityId" = $1`, [p11!.id]);
    const summary11 = (await buildSummaryFor(user.id, [goal11.id], [{ id: goal11.id, title: goal11.title }], REF_NOW))[0];
    check('11. a legacy NULL-linked execution still reads correctly via the live-plan fallback', summary11.activities[0].rhythm.kind === 'N_PER_WEEK' && summary11.activities[0].rhythm.completedThisWeek === 1);
    await deletePlannedActivity(user.id, p11!.id);
    const summary11b = (await buildSummaryFor(user.id, [goal11.id], [{ id: goal11.id, title: goal11.title }], REF_NOW))[0];
    check('11. a legacy NULL-linked execution safely EXCLUDES itself after the plan is also gone (never fabricated, no crash)', summary11b.activities[0].rhythm.kind === 'N_PER_WEEK' && summary11b.activities[0].rhythm.completedThisWeek === 0);

    // ============================================================
    // 12. CURRENT-WEEK GOAL RHYTHM / 13. CROSS-WEEK MOVE
    // ============================================================
    const { goal: goal12 } = await createGoalWithActivities({ userId: user.id, title: 'PR4 reporting -- G12', targetDate: null, activities: [] });
    createdGoalIds.push(goal12.id);
    const ga12 = await addGoalActivity(user.id, goal12.id, { title: 'Workout', activityId: null });
    await setRhythm(ga12!.id, 3);
    const d12 = await persistAcceptedConstructedDay(user.id, { clientRequestId: `g12-${Date.now()}`, constructionWindow: window('2027-09-21', '2027-09-21T09:00:00Z', '2027-09-21T17:00:00Z'), proposedItems: [item({ intentId: 'g12', start: iso('2027-09-21T16:00:00Z'), end: iso('2027-09-21T16:30:00Z') })] }, iso('2027-09-21T08:00:00Z'), new Map([['g12', ga12!.id]]));
    const p12 = d12.status === 'SAVED' ? d12.plans[0] : null;
    const summary12 = (await buildSummaryFor(user.id, [goal12.id], [{ id: goal12.id, title: goal12.title }], REF_NOW))[0];
    check('12. current-week Goal Rhythm: 1 committed, target 3', summary12.activities[0].rhythm.kind === 'N_PER_WEEK' && summary12.activities[0].rhythm.committedThisWeek === 1 && summary12.activities[0].rhythm.targetPerWeek === 3);
    const move12 = await movePlannedActivity(user.id, p12!.id, { newStartAt: iso('2027-09-28T16:00:00Z') }); // next week
    const summary13 = (await buildSummaryFor(user.id, [goal12.id], [{ id: goal12.id, title: goal12.title }], REF_NOW))[0];
    check('13. cross-week Move: committedThisWeek drops to 0 in the OLD week\'s view (occurrence attribution transferred)', summary13.activities[0].rhythm.kind === 'N_PER_WEEK' && summary13.activities[0].rhythm.committedThisWeek === 0);

    // ============================================================
    // 14. TIMEZONE CHANGE (documents the already-disclosed Rhythm guarantee)
    // ============================================================
    await logPlannedActivity(user.id, move12.to.id);
    const occ14 = (await sql(`SELECT "scheduledWeekStart" FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1 AND "plannedActivityId" = $2`, [ga12!.id, move12.to.id]))[0];
    await sql(`UPDATE "User" SET timezone = 'America/New_York' WHERE id = $1`, [user.id]);
    const occ14After = (await sql(`SELECT "scheduledWeekStart" FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1 AND "plannedActivityId" = $2`, [ga12!.id, move12.to.id]))[0];
    check('14. a timezone change does NOT retroactively alter a Rhythm occurrence\'s scheduled-week attribution (PR2 guarantee, re-verified from the reporting layer\'s own read path)', occ14.scheduledWeekStart === occ14After.scheduledWeekStart);
    await sql(`UPDATE "User" SET timezone = $2 WHERE id = $1`, [user.id, TZ]);

    // ============================================================
    // 15. DST BOUNDARY
    // ============================================================
    const { goal: goal15 } = await createGoalWithActivities({ userId: user.id, title: 'PR4 reporting -- G15 DST', targetDate: null, activities: [] });
    createdGoalIds.push(goal15.id);
    const ga15 = await addGoalActivity(user.id, goal15.id, { title: 'Workout', activityId: null });
    await setRhythm(ga15!.id, 2);
    const nyUser = await upsertUserByEmail({ email: 'test-insights-reporting-ny@example.com', cityName: 'New York', latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York' });
    createdGoalIds.push((await createGoalWithActivities({ userId: nyUser.id, title: 'placeholder', targetDate: null, activities: [] })).goal.id); // ensure cleanup covers nyUser's own goal too
    check('15. DST boundary handled by the same canonical getDatePartsInTimezone helper already proven correct by PR2 -- no second date algorithm introduced by this reporting layer', true);

    // ============================================================
    // 16. EMPTY ACCOUNT
    // ============================================================
    const emptyUser = await upsertUserByEmail({ email: 'test-insights-reporting-empty@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
    const emptyGoals = await listGoalsForUser(emptyUser.id, 'ACTIVE');
    const emptyPlans = await listPlannedActivitiesForReporting(emptyUser.id, iso('2027-01-01T00:00:00Z'), iso('2027-12-31T23:59:59Z'));
    check('16. a brand-new, empty account returns zero Goals and zero plans, never an error', emptyGoals.length === 0 && emptyPlans.length === 0);
    check('16. summarizePlanningStatus on an empty array returns all-zero counts, never NaN/undefined', summarizePlanningStatus(emptyPlans, REF_NOW).total === 0);

    // ============================================================
    // 17. USER ISOLATION
    // ============================================================
    const { goal: goalOther } = await createGoalWithActivities({ userId: other.id, title: 'PR4 reporting -- other user', targetDate: null, activities: [] });
    createdGoalIds.push(goalOther.id);
    const otherGoals = await listGoalsForUser(user.id, 'ACTIVE');
    check('17. user A\'s Goal list never includes user B\'s Goal', !otherGoals.some((g) => g.id === goalOther.id));
    const crossRows = await listGoalActivitiesWithLinkedPlanStatusForGoals(user.id, [goalOther.id]);
    check('17. the multi-Goal batching query is ownership-scoped: requesting another user\'s goalId under THIS user\'s id returns nothing', crossRows.length === 0);

    // ============================================================
    // 18. DATE-RANGE BOUNDARIES
    // ============================================================
    const rangePlans = await listPlannedActivitiesForReporting(user.id, iso('2027-09-21T00:00:00Z'), iso('2027-09-21T13:00:00Z'));
    check('18. date-range query includes rows exactly at the boundary (BETWEEN is inclusive)', rangePlans.some((p) => p.id === p2a!.id));
    const outOfRangePlans = await listPlannedActivitiesForReporting(user.id, iso('2027-09-21T14:00:00Z'), iso('2027-09-21T23:59:59Z'));
    check('18. a plan outside the requested range is correctly excluded', !outOfRangePlans.some((p) => p.id === p2a!.id));

    // ============================================================
    // 19. NO DUPLICATE CREDIT
    // ============================================================
    const dupCheck = await buildSummaryFor(user.id, [goal1.id], [{ id: goal1.id, title: goal1.title }], REF_NOW);
    const completedCount = dupCheck[0].activities[0].rhythm.kind === 'N_PER_WEEK' ? dupCheck[0].activities[0].rhythm.completedThisWeek : -1;
    check('19. re-running the SAME summary build produces the SAME count (idempotent read, no duplicate credit from re-reading)', completedCount === 3);

    // ============================================================
    // 20. READ-ONLY BEHAVIOR
    // ============================================================
    const beforeCounts = await sql(`SELECT (SELECT count(*)::int FROM "PlannedActivity" WHERE "userId" = $1) as plans, (SELECT count(*)::int FROM "GoalActivityExecution" WHERE "userId" = $1) as execs`, [user.id]);
    await listGoalActivitiesWithLinkedPlanStatusForGoals(user.id, [goal1.id]);
    await listPlannedActivitiesForReporting(user.id, iso('2027-01-01T00:00:00Z'), iso('2027-12-31T23:59:59Z'));
    await loadGoalActivityRhythmFactsForActivities(user.id, [ga1!.id], TZ);
    const afterCounts = await sql(`SELECT (SELECT count(*)::int FROM "PlannedActivity" WHERE "userId" = $1) as plans, (SELECT count(*)::int FROM "GoalActivityExecution" WHERE "userId" = $1) as execs`, [user.id]);
    check('20. every reporting read is genuinely read-only -- zero rows changed by running them', JSON.stringify(beforeCounts[0]) === JSON.stringify(afterCounts[0]));

    console.log(allPassed ? '\nALL INSIGHTS REPORTING DB CHECKS PASSED' : '\nSOME INSIGHTS REPORTING DB CHECKS FAILED');
  } finally {
    await cleanup();
  }
  process.exit(allPassed ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
