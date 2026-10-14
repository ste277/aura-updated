/**
 * Insights V1 PR7 -- Product Completion Corrections: live-database proof
 * of the three P1 fixes (AURA_INSIGHTS_V1_PRODUCT_COMPLETION_AUDIT.md
 * findings F-1, F-3, F-4) against the FULL reporting composition --
 * mirroring app/api/insights/reporting/route.ts's own exact construction
 * order (listGoalsForUser -> listGoalActivitiesWithLinkedPlanStatusForGoals
 * -> loadGoalActivityRhythmFactsForActivities -> buildGoalSummary ->
 * listPlannedActivitiesForReporting -> summarizePlanningStatus ->
 * countDeletedNonGoalCompletionsInRange -> computeImprovementSuggestions),
 * same established convention as every other real-DB suite in this
 * program (bypassing HTTP, exercising the real production functions
 * directly) -- so every assertion below is against the actual reporting
 * API's own output shape, not an isolated helper call.
 *
 * Uses REAL wall-clock time throughout (never a fictional fixture date):
 * movePlannedActivity's own applyMoveWrites stamps "movedAt" = the
 * database's real now() unconditionally (planMove.ts), so a Move
 * scenario's reporting window must be real-time-bounded to ever see it.
 * Every plan below gets its own, globally unique day offset (the
 * `dayOffset()` counter) so no two plans in this whole suite ever land on
 * the same calendar day -- the one thing that could otherwise make
 * createPlannedActivity/movePlannedActivity's own overlap guard reject a
 * write for reasons unrelated to what this suite is testing.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/insightsReportingPr7CorrectionsDb.test.ts
 */
import {
  upsertUserByEmail, beginTransaction, createPlannedActivity, logPlannedActivity,
  deletePlannedActivity, createGoalWithActivities, addGoalActivity, deleteGoal,
  listGoalsForUser, listGoalActivitiesWithLinkedPlanStatusForGoals,
  loadGoalActivityRhythmFactsForActivities, listPlannedActivitiesForReporting,
  countDeletedNonGoalCompletionsInRange,
} from '../apps/web/lib/db';
import { movePlannedActivity } from '../apps/web/lib/planMove';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import type { AcceptedProposedItem } from '../apps/web/lib/dayConstructorAcceptance';
import { normalizeGoalActivityRhythm } from '../apps/web/lib/goalActivityRhythm';
import { buildGoalSummary, summarizePlanningStatus, classifyPlanningStatus } from '../apps/web/lib/insightsReporting';
import { getDatePartsInTimezone } from '../apps/web/lib/timezone';
import { computeImprovementSuggestions } from '../apps/web/lib/improvementSignalsComposition';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const DEFAULT_RANGE_DAYS = 30;

async function sql(text: string, params: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(text, params); await c.query('COMMIT'); return r.rows; }
  catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { c.release(); }
}

// A globally-unique day-offset counter (never two plans in this suite
// share a calendar day) -- starts far enough in the past/future that it
// never collides with "today" itself.
let pastDayCounter = 25;
let futureDayCounter = 2;
function nextPastDay(hour = 9): Date {
  const d = new Date(Date.now() - pastDayCounter * 24 * 3600_000);
  pastDayCounter -= 1;
  d.setHours(hour, 0, 0, 0);
  return d;
}
function nextFutureDay(hour = 9): Date {
  const d = new Date(Date.now() + futureDayCounter * 24 * 3600_000);
  futureDayCounter += 1;
  d.setHours(hour, 0, 0, 0);
  return d;
}
function plusMin(d: Date, m: number): Date { return new Date(d.getTime() + m * 60000); }

/** Mirrors app/api/insights/reporting/route.ts's own full construction,
 * exactly, in the exact same order -- this IS the reporting API's real
 * output, not a re-derivation. `now` is always fresh real time, `from`/
 * `to` the same default rolling 30-day window route.ts itself computes,
 * padded 5 minutes forward so a movedAt/logTimestamp stamped a few
 * seconds after this suite captured `now` is never excluded by a race. */
async function buildReportingResponse(userId: string, timezone: string) {
  const now = new Date();
  const to = new Date(now.getTime() + 5 * 60_000);
  const from = new Date(now.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
  const todayLocalDate = getDatePartsInTimezone(timezone, now).dateStr;
  const user = { id: userId, timezone } as any;

  const goals = await listGoalsForUser(userId, 'ACTIVE');
  const rows = await listGoalActivitiesWithLinkedPlanStatusForGoals(userId, goals.map((g) => g.id));
  const rhythmActivityIds = rows.filter((row) => normalizeGoalActivityRhythm(row).kind === 'N_PER_WEEK').map((row) => row.id);
  const factsByActivityId = await loadGoalActivityRhythmFactsForActivities(userId, rhythmActivityIds, timezone);
  const rowsByGoalId = new Map<string, typeof rows>();
  for (const row of rows) {
    const existing = rowsByGoalId.get(row.goalId);
    if (existing) existing.push(row); else rowsByGoalId.set(row.goalId, [row]);
  }
  const goalSummaries = goals.map((goal) => buildGoalSummary(goal, rowsByGoalId.get(goal.id) ?? [], factsByActivityId, todayLocalDate));

  const plans = await listPlannedActivitiesForReporting(userId, from, to);
  const livePlanningStatus = summarizePlanningStatus(plans, now);
  const deletedNonGoalCompletionCount = await countDeletedNonGoalCompletionsInRange(userId, from, to);
  const planningStatus = {
    ...livePlanningStatus,
    confirmedCompleted: livePlanningStatus.confirmedCompleted + deletedNonGoalCompletionCount,
    total: livePlanningStatus.total + deletedNonGoalCompletionCount,
  };

  const awaitingConfirmationPlans = plans
    .filter((plan) => classifyPlanningStatus(plan, now) === 'AWAITING_CONFIRMATION')
    .sort((a, b) => new Date(b.plannedStartAt).getTime() - new Date(a.plannedStartAt).getTime());

  const suggestions = await computeImprovementSuggestions({
    user, now, todayLocalDate,
    awaitingConfirmationCount: planningStatus.awaitingConfirmation,
    soleUnconfirmedPlanId: awaitingConfirmationPlans.length === 1 ? awaitingConfirmationPlans[0].id : null,
    goalSummaries, rows,
  });

  const goalActivitiesWithProgress = goalSummaries.reduce((sum, g) => sum + g.progress.completed, 0);

  return { goals: goalSummaries, planningStatus, suggestions, goalActivitiesWithProgress, plans };
}

function window(date: string, start: Date, end: Date) {
  return { date, start, end, timezone: TZ, source: 'EXPLICIT_RANGE' as const };
}
function item(overrides: Partial<AcceptedProposedItem> & { intentId: string; start: Date; end: Date }): AcceptedProposedItem {
  return { title: 'Stretch', placementSource: 'SELECTED_CANDIDATE', ...overrides };
}

async function main() {
  const user = await upsertUserByEmail({ email: 'test-pr7-corrections@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const other = await upsertUserByEmail({ email: 'test-pr7-corrections-other@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });

  const allUserIds = [user.id, other.id];
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
    await sql(`DELETE FROM "GoalActivity" WHERE "goalId" IN (SELECT id FROM "Goal" WHERE "userId" = ANY($1::text[]))`, [allUserIds]);
    for (const goalId of createdGoalIds) await sql(`DELETE FROM "Goal" WHERE id = $1`, [goalId]).catch(() => {});
  };
  await cleanup();

  try {
    const makePlan = (uid: string, title: string, start: Date, minutes = 30) =>
      createPlannedActivity({ userId: uid, title, plannedStartAt: start, plannedEndAt: plusMin(start, minutes), durationMinutes: minutes, windowType: 'NEUTRAL' });
    const link = (planId: string, goalActivityId: string) => sql(`UPDATE "GoalActivity" SET "plannedActivityId" = $1 WHERE id = $2`, [planId, goalActivityId]);

    // ============================================================
    // 1/2/3. REPEATED GOAL COMPLETIONS + DISTINCT GOAL ACTIVITY COUNT +
    // PARTIAL GOAL COMPLETION (finding F-1 -- units preserved, not changed)
    // ============================================================
    const { goal: goalRhythm, activities: rhythmActs } = await createGoalWithActivities({
      userId: user.id, title: 'Exercise', targetDate: null,
      activities: [{ title: 'Workout', activityId: null, rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 7 } }],
    });
    createdGoalIds.push(goalRhythm.id);
    // 5 real completions of the SAME rhythm Goal activity.
    for (let i = 0; i < 5; i++) {
      const s = nextPastDay(6);
      const p = await makePlan(user.id, 'Workout', s);
      await link(p.id, rhythmActs[0].id);
      await logPlannedActivity(user.id, p.id);
    }
    const { goal: goalFinite, activities: finiteActs } = await createGoalWithActivities({
      userId: user.id, title: 'Read 5 Books', targetDate: null,
      activities: [0, 1, 2, 3, 4].map((i) => ({ title: `Book ${i + 1}`, activityId: null })),
    });
    createdGoalIds.push(goalFinite.id);
    // 2 of 5 distinct finite activities completed (partial completion).
    for (let i = 0; i < 2; i++) {
      const s = nextPastDay(20);
      const p = await makePlan(user.id, `Book ${i + 1}`, s, 60);
      await link(p.id, finiteActs[i].id);
      await logPlannedActivity(user.id, p.id);
    }

    let resp = await buildReportingResponse(user.id, TZ);
    check('1. repeated completions of the SAME rhythm Goal activity -- confirmedCompleted counts all 5 events', resp.planningStatus.confirmedCompleted === 7);
    check('2. distinct Goal activity count -- goalActivitiesWithProgress counts SLOTS, not events (1 Workout slot + 2 Book slots = 3, never 7)', resp.goalActivitiesWithProgress === 3);
    check('3. partial Goal completion -- Read 5 Books shows exactly 2 of 5 completed, not more/less', resp.goals.find((g) => g.id === goalFinite.id)!.progress.completed === 2 && resp.goals.find((g) => g.id === goalFinite.id)!.progress.total === 5);

    // ============================================================
    // 4. OVER-TARGET GOAL COMPLETION -- 3 real completions THIS WEEK of a
    // rhythm activity, via the real Day-Constructor-acceptance pipeline
    // (persistAcceptedConstructedDay), so GoalActivityOccurrence rows
    // actually exist and completedThisWeek is genuinely evaluated, not
    // silently 0 from a bypassed pipeline. All 3 are accepted while the
    // target is still 5/week (within capacity -- evaluateNewOccurrenceEligibility
    // would correctly REFUSE a 3rd occurrence against a target of 2, by
    // design, the same capacity gate Day Constructor itself always
    // enforces); the target is then lowered to 2/week via a direct Goal
    // edit, the realistic way a user actually ends up over-target
    // (completed 3 sessions, then reduced their own weekly goal) -- never
    // bypassing the eligibility gate itself, which is correct, unrelated,
    // pre-existing behavior this PR does not touch.
    // ============================================================
    const { goal: goalOver } = await createGoalWithActivities({ userId: user.id, title: 'Stretch Goal', targetDate: null, activities: [] });
    createdGoalIds.push(goalOver.id);
    const overAct = await addGoalActivity(user.id, goalOver.id, { title: 'Stretch', activityId: null, rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 5 } });
    const now0 = new Date();
    const todayStr = getDatePartsInTimezone(TZ, now0).dateStr;
    for (let i = 0; i < 3; i++) {
      const dayStart = new Date(now0.getTime() - i * 24 * 3600_000);
      dayStart.setHours(7, 0, 0, 0);
      const dayStr = getDatePartsInTimezone(TZ, dayStart).dateStr;
      const acceptedAt = new Date(dayStart.getTime() - 2 * 3600_000); // strictly before the item's own start
      const d = await persistAcceptedConstructedDay(
        user.id,
        { clientRequestId: `pr7-over-${i}-${Date.now()}`, constructionWindow: window(dayStr, new Date(dayStart.getTime() - 3600_000), plusMin(dayStart, 600)), proposedItems: [item({ intentId: `pr7-over-${i}`, start: dayStart, end: plusMin(dayStart, 15) })] },
        acceptedAt,
        new Map([[`pr7-over-${i}`, overAct!.id]])
      );
      if (d.status !== 'SAVED') throw new Error(`persistAcceptedConstructedDay failed for over-target fixture: ${JSON.stringify(d)}`);
      await logPlannedActivity(user.id, d.plans[0].id);
    }
    // Lower the target below the 3 already-completed occurrences.
    await sql(`UPDATE "GoalActivity" SET "rhythmTargetPerWeek" = 2 WHERE id = $1`, [overAct!.id]);
    const rows4 = await listGoalActivitiesWithLinkedPlanStatusForGoals(user.id, [goalOver.id]);
    const facts4 = await loadGoalActivityRhythmFactsForActivities(user.id, [overAct!.id], TZ);
    const summary4 = buildGoalSummary(goalOver, rows4, facts4, todayStr);
    const overRhythm = summary4.activities[0].rhythm as any;
    check('4. over-target Goal completion -- completedThisWeek (3) exceeds targetPerWeek (2), reported as the real count, never clamped', overRhythm.completedThisWeek === 3 && overRhythm.targetPerWeek === 2);
    check('4. over-target Goal completion -- remainingThisWeek never goes negative', overRhythm.remainingThisWeek >= 0);

    // ============================================================
    // 5. DELETED COMPLETED GOAL PLAN -- GOAL_LINKED completion evidence
    // lives in GoalActivityExecution (survives the delete, PR3), but
    // `planningStatus.confirmedCompleted` reflects the LIVE PlannedActivity
    // set -- the PR6 HabitLog fallback deliberately EXCLUDES GOAL_LINKED
    // completions (never double-counted against GoalActivityExecution),
    // so deleting a GOAL_LINKED plan correctly DECREASES confirmedCompleted
    // by exactly 1, while the Goal's own progress is unaffected.
    // ============================================================
    const { goal: goalDel, activities: delActs } = await createGoalWithActivities({
      userId: user.id, title: 'Meditate', targetDate: null, activities: [{ title: 'Meditate', activityId: null }],
    });
    createdGoalIds.push(goalDel.id);
    const sDelGoal = nextPastDay(8);
    const pDelGoal = await makePlan(user.id, 'Meditate', sDelGoal, 20);
    await link(pDelGoal.id, delActs[0].id);
    await logPlannedActivity(user.id, pDelGoal.id);
    const beforeDelete = await buildReportingResponse(user.id, TZ);
    await deletePlannedActivity(user.id, pDelGoal.id);
    const afterDelete = await buildReportingResponse(user.id, TZ);
    check('5. deleted completed Goal Plan -- confirmedCompleted decreases by exactly 1 (GOAL_LINKED evidence lives in GoalActivityExecution, never recovered via the PR6 HabitLog fallback)', afterDelete.planningStatus.confirmedCompleted === beforeDelete.planningStatus.confirmedCompleted - 1);
    check('5. deleted completed Goal Plan -- Goal progress itself survives the deletion', afterDelete.goals.find((g) => g.id === goalDel.id)?.progress.completed === 1);

    // ============================================================
    // 6. DELETED NON-GOAL PLAN -- PR6 fallback still contributes.
    // ============================================================
    const sDelNonGoal = nextPastDay(9);
    const pDelNonGoal = await makePlan(user.id, 'Deleted non-goal activity', sDelNonGoal);
    await logPlannedActivity(user.id, pDelNonGoal.id);
    const beforeDelNonGoal = await buildReportingResponse(user.id, TZ);
    await deletePlannedActivity(user.id, pDelNonGoal.id);
    const afterDelNonGoal = await buildReportingResponse(user.id, TZ);
    check('6. deleted non-Goal Plan -- confirmedCompleted UNCHANGED across the delete (PR6 fallback recovers it)', afterDelNonGoal.planningStatus.confirmedCompleted === beforeDelNonGoal.planningStatus.confirmedCompleted);

    // ============================================================
    // 7/9/11. SINGLE MOVE, WITHIN WINDOW, FUTURE-SCHEDULED SOURCE
    // (finding F-3 -- the core fix). A single Move (1 hop): terminal
    // still UPCOMING, scheduled in the FUTURE (so the OLD
    // plannedStartAt-based filter would have missed it entirely),
    // movedAt is real now() (always within the 30-day window).
    // ============================================================
    const singleMoveOrig = nextFutureDay(9);
    const singleMoveSrc = await makePlan(user.id, 'Single-move activity', singleMoveOrig);
    const singleMoveDest = nextFutureDay(9);
    await movePlannedActivity(user.id, singleMoveSrc.id, { newStartAt: singleMoveDest });
    resp = await buildReportingResponse(user.id, TZ);
    check('7/9/11. single Move, future-scheduled source, movedAt within window -- Planning Patterns counts it (the exact F-3 repro: old plannedStartAt-only filter would have shown 0 here)', resp.plans.some((p) => p.id === singleMoveSrc.id && p.status === 'MOVED') && resp.planningStatus.rescheduled >= 1);
    check('7. single Move (1 hop) -- does NOT fire REPEATED_RESCHEDULING (needs >= 2 hops)', ![resp.suggestions.primary, ...resp.suggestions.secondary].some((s) => s?.signal === 'REPEATED_RESCHEDULING' && s.cta.planId === singleMoveSrc.id));

    // ============================================================
    // 8/15/17. TWO-HOP MOVE CHAIN -- REPEATED_RESCHEDULING fires AND
    // Planning Patterns' rescheduled count is consistent with it (never
    // "0 rescheduled" next to a live "moved a few times" suggestion --
    // the exact audit-confirmed contradiction, now fixed).
    // ============================================================
    const chainStart = nextFutureDay(10);
    const chain0 = await makePlan(user.id, 'Chain activity', chainStart, 60);
    const hop1Start = nextFutureDay(10);
    const move1 = await movePlannedActivity(user.id, chain0.id, { newStartAt: hop1Start });
    const hop2Start = nextFutureDay(10);
    const move2 = await movePlannedActivity(user.id, move1.to.id, { newStartAt: hop2Start });
    resp = await buildReportingResponse(user.id, TZ);
    const allSuggestions = [resp.suggestions.primary, ...resp.suggestions.secondary].filter((s): s is NonNullable<typeof s> => s !== null);
    const reschedSuggestion = allSuggestions.find((s) => s.signal === 'REPEATED_RESCHEDULING' && s.evidence === 'move-chain-hop-count:2');
    check('8. two-hop Move chain -- REPEATED_RESCHEDULING fires', reschedSuggestion !== undefined);
    check('15. PR5 suggestion/reporting consistency -- Planning Patterns rescheduled count is NOT 0 when a live REPEATED_RESCHEDULING suggestion exists for recent Moves (the confirmed audit contradiction, now fixed)', resp.planningStatus.rescheduled >= 3); // includes scenario 7's single move too
    // The chain's terminal is scheduled in the future (by construction,
    // a live actionable REPEATED_RESCHEDULING terminal always is), so it
    // falls OUTSIDE listPlannedActivitiesForReporting's own backward-
    // looking range -- resp.plans correctly omits it, same as it omits
    // any other future-scheduled UPCOMING plan (unrelated to the F-3 fix,
    // which only concerns MOVED-row attribution). Verified directly
    // against the database instead.
    const terminalRow = reschedSuggestion ? (await sql(`SELECT id, status FROM "PlannedActivity" WHERE id = $1`, [reschedSuggestion.cta.planId]))[0] : null;
    check('17. relevant Plan navigation -- REPEATED_RESCHEDULING cta.planId is the chain\'s real, live (UPCOMING) terminal id', reschedSuggestion?.cta.planId === move2.to.id && terminalRow?.status === 'UPCOMING');

    // ============================================================
    // 10. MOVE OUTSIDE REPORTING WINDOW -- a Move whose movedAt is
    // BEFORE `from` must not be silently counted under the 30-day label,
    // even though its terminal might still be live/unresolved. Simulated
    // by backdating movedAt directly (movedAt is otherwise always real
    // now() -- there is no production path to genuinely move something
    // 31 days ago in a live test run).
    // ============================================================
    const oldMoveOrig = nextFutureDay(11);
    const oldMoveSrc = await makePlan(user.id, 'Old move activity', oldMoveOrig);
    await movePlannedActivity(user.id, oldMoveSrc.id, { newStartAt: nextFutureDay(11) });
    const outsideWindow = new Date(Date.now() - (DEFAULT_RANGE_DAYS + 5) * 24 * 3600_000);
    await sql(`UPDATE "PlannedActivity" SET "movedAt" = $1 WHERE id = $2`, [outsideWindow, oldMoveSrc.id]);
    resp = await buildReportingResponse(user.id, TZ);
    check('10. Move outside the reporting window (movedAt before `from`) -- NOT counted (no silent all-time counting under the 30-day label)', !resp.plans.some((p) => p.id === oldMoveSrc.id));

    // ============================================================
    // 12. CROSS-WEEK MOVE -- plannedStartAt lands weeks in the future
    // (a different civil week than today); attribution still follows
    // movedAt (real now, within window) regardless.
    // ============================================================
    const crossWeekOrig = nextFutureDay(12);
    const crossWeekSrc = await makePlan(user.id, 'Cross-week move', crossWeekOrig);
    await movePlannedActivity(user.id, crossWeekSrc.id, { newStartAt: nextFutureDay(12) });
    resp = await buildReportingResponse(user.id, TZ);
    check('12. cross-week Move -- counted by movedAt (now, within window) despite plannedStartAt being weeks in the future', resp.plans.some((p) => p.id === crossWeekSrc.id && p.status === 'MOVED'));

    // ============================================================
    // 13. LEGACY NULL movedAt -- falls back to plannedStartAt, never
    // fabricated.
    // ============================================================
    const legacyOrig = nextPastDay(10); // within window by plannedStartAt
    const legacySrc = await makePlan(user.id, 'Legacy move, no movedAt', legacyOrig);
    await movePlannedActivity(user.id, legacySrc.id, { newStartAt: nextFutureDay(13) });
    await sql(`UPDATE "PlannedActivity" SET "movedAt" = NULL WHERE id = $1`, [legacySrc.id]);
    resp = await buildReportingResponse(user.id, TZ);
    check('13. legacy NULL movedAt -- falls back to plannedStartAt (within window), never fabricated, still counted', resp.plans.some((p) => p.id === legacySrc.id && p.status === 'MOVED' && p.movedAt === null));

    // ============================================================
    // 14. NO DUPLICATE MOVE COUNT -- the 2-hop chain above (scenario 8)
    // contributes exactly 2 RESCHEDULED facts (source + its own
    // successor-that-was-also-moved), never double-counted, and the
    // chain's CURRENT terminal is never ALSO counted as RESCHEDULED.
    // ============================================================
    const chainRows = await sql(`SELECT id, status FROM "PlannedActivity" WHERE "userId" = $1 AND title = 'Chain activity'`, [user.id]);
    check('14. no duplicate Move count -- exactly 3 rows exist for the 2-hop chain (2 MOVED + 1 live UPCOMING terminal)', chainRows.length === 3);
    check('14. no duplicate Move count -- exactly 2 of those 3 rows are MOVED (2 real Move operations, not 4)', chainRows.filter((r) => r.status === 'MOVED').length === 2);

    // ============================================================
    // 16. MULTIPLE UNCONFIRMED PLANS -- cta.planFilter set, no planId
    // (no single deterministic target invented).
    // ============================================================
    await makePlan(user.id, 'Unconfirmed 1', nextPastDay(2));
    await makePlan(user.id, 'Unconfirmed 2', nextPastDay(1));
    resp = await buildReportingResponse(user.id, TZ);
    const awaitingSuggestionMulti = [resp.suggestions.primary, ...resp.suggestions.secondary].find((s) => s?.signal === 'AWAITING_CONFIRMATION');
    check('16. multiple unconfirmed Plans -- AWAITING_CONFIRMATION fires with cta.planFilter = AWAITING_CONFIRMATION, no planId (count >= 2)', resp.planningStatus.awaitingConfirmation >= 2 && awaitingSuggestionMulti?.cta.planFilter === 'AWAITING_CONFIRMATION' && awaitingSuggestionMulti?.cta.planId === undefined);

    // ============================================================
    // 18. STALE/DELETED PLAN TARGET -- a planId the suggestion emits is
    // always a real, currently-existing plan at generation time (never
    // fabricated); confirmed here for AWAITING_CONFIRMATION with exactly
    // one unconfirmed plan (scenario 17 already confirmed it for
    // REPEATED_RESCHEDULING above).
    // ============================================================
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1 AND title IN ('Unconfirmed 1', 'Unconfirmed 2')`, [user.id]);
    const soleUnconf = await makePlan(user.id, 'Sole unconfirmed', nextPastDay(1));
    resp = await buildReportingResponse(user.id, TZ);
    const awaitingSuggestionSole = [resp.suggestions.primary, ...resp.suggestions.secondary].find((s) => s?.signal === 'AWAITING_CONFIRMATION');
    check('18. stale/deleted Plan target -- with exactly one unconfirmed plan, cta.planId is that REAL plan\'s id (never invented, never a stale id from the just-deleted pair above)', awaitingSuggestionSole?.cta.planId === soleUnconf.id);

    // ============================================================
    // 19. USER ISOLATION -- user B's Moves/Goals/unconfirmed plans never
    // leak into user A's counts or suggestions, and vice versa.
    // ============================================================
    const otherPlan = await makePlan(other.id, 'Other user activity', nextPastDay(1));
    await logPlannedActivity(other.id, otherPlan.id);
    const respOther = await buildReportingResponse(other.id, TZ);
    resp = await buildReportingResponse(user.id, TZ);
    check('19. user isolation -- other user\'s single completion never appears in user A\'s plans list', !resp.plans.some((p) => p.id === otherPlan.id));
    check('19. user isolation -- other user\'s own reporting response correctly shows their own 1 completion', respOther.planningStatus.confirmedCompleted === 1);

    // ============================================================
    // 20. NO READ-SIDE WRITES -- the full reporting composition performs
    // zero writes (PlannedActivity row count for this user unchanged
    // across a call).
    // ============================================================
    const countBefore = (await sql(`SELECT count(*)::int AS c FROM "PlannedActivity" WHERE "userId" = $1`, [user.id]))[0].c;
    await buildReportingResponse(user.id, TZ);
    const countAfter = (await sql(`SELECT count(*)::int AS c FROM "PlannedActivity" WHERE "userId" = $1`, [user.id]))[0].c;
    check('20. no read-side writes -- PlannedActivity row count for this user is unchanged by computing the full reporting response', countBefore === countAfter);

    console.log(allPassed ? '\nALL PR7 CORRECTIONS SCENARIOS PASSED' : '\nSOME PR7 CORRECTIONS SCENARIOS FAILED');
  } finally {
    await cleanup();
  }

  process.exit(allPassed ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
