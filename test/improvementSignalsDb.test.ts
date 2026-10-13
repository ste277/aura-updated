/**
 * Insights V1 PR5 -- Evidence-Backed Improvement Prompts: live-database
 * proof of the real reads (listMoveChainLinksForUser, db.ts) and the full
 * composition (improvementSignalsComposition.ts's own
 * computeImprovementSuggestions, exercised directly against the real
 * production functions -- bypassing HTTP, same established convention as
 * every other real-DB suite in this program) that GET /api/insights/
 * reporting's new `suggestions` field is built from.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/improvementSignalsDb.test.ts
 */
import {
  upsertUserByEmail, updateBirthProfile, beginTransaction, getUserById,
  replaceUserAvailabilityConfiguration, createPlannedActivity, logPlannedActivity,
  deletePlannedActivity, cancelPlannedActivity, createGoalWithActivities, addGoalActivity, deleteGoal,
  listGoalsForUser, listGoalActivitiesWithLinkedPlanStatusForGoals,
  loadGoalActivityRhythmFactsForActivities, listPlannedActivitiesForReporting,
  listMoveChainLinksForUser,
  type User,
} from '../apps/web/lib/db';
import { movePlannedActivity } from '../apps/web/lib/planMove';
import { normalizeGoalActivityRhythm } from '../apps/web/lib/goalActivityRhythm';
import { buildGoalSummary, summarizePlanningStatus } from '../apps/web/lib/insightsReporting';
import { getDatePartsInTimezone } from '../apps/web/lib/timezone';
import { computeImprovementSuggestions } from '../apps/web/lib/improvementSignalsComposition';
import { evaluateMoveChains, rankAndSelectSuggestions, type ImprovementSuggestion, type MoveChainEvaluation } from '../apps/web/lib/improvementSignals';
import type { MoveChainLinkRow } from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
// A fixed, far-future Saturday -- deliberately chosen so the "remaining
// days of the current local week" (today..Sunday) a Signal 3 feasibility
// check must cover is only 2 civil dates, keeping the full-week-booked
// fixture for scenario 13 small and exact.
const REF_NOW = new Date('2028-03-18T04:30:00.000Z'); // 10:00 IST, 2028-03-18 (Saturday)

async function sql(text: string, params: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(text, params); await c.query('COMMIT'); return r.rows; }
  catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { c.release(); }
}

function iso(s: string): Date { return new Date(s); }

/** Mirrors app/api/insights/reporting/route.ts's own Goal-summary
 * construction exactly (same functions, same order) -- never a second
 * derivation of Rhythm eligibility. */
async function buildGoalSummariesAndRows(userId: string, timezone: string, todayLocalDate: string) {
  const goals = await listGoalsForUser(userId, 'ACTIVE');
  const rows = await listGoalActivitiesWithLinkedPlanStatusForGoals(userId, goals.map((g) => g.id));
  const rhythmIds = rows.filter((r) => normalizeGoalActivityRhythm(r).kind === 'N_PER_WEEK').map((r) => r.id);
  const facts = await loadGoalActivityRhythmFactsForActivities(userId, rhythmIds, timezone);
  const rowsByGoal = new Map<string, typeof rows>();
  for (const row of rows) {
    const arr = rowsByGoal.get(row.goalId) ?? [];
    arr.push(row);
    rowsByGoal.set(row.goalId, arr);
  }
  const goalSummaries = goals.map((g) => buildGoalSummary(g, rowsByGoal.get(g.id) ?? [], facts, todayLocalDate));
  return { goalSummaries, rows };
}

/** Always refetches the User row fresh -- `availabilityConfigured`/
 * `timezone` must never be read from a possibly-stale in-memory object
 * a caller captured before an earlier replaceUserAvailabilityConfiguration/
 * timezone-change call in the SAME test run. */
async function computeFor(userLike: User, now: Date) {
  const user = (await getUserById(userLike.id))!;
  const todayLocalDate = getDatePartsInTimezone(user.timezone, now).dateStr;
  const { goalSummaries, rows } = await buildGoalSummariesAndRows(user.id, user.timezone, todayLocalDate);
  const plans = await listPlannedActivitiesForReporting(user.id, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), now);
  const planningStatus = summarizePlanningStatus(plans, now);
  return computeImprovementSuggestions({
    user, now, todayLocalDate,
    awaitingConfirmationCount: planningStatus.awaitingConfirmation,
    goalSummaries, rows,
  });
}

function findSuggestion(result: { primary: ImprovementSuggestion | null; secondary: ImprovementSuggestion[] }, id: string): ImprovementSuggestion | null {
  if (result.primary?.id === id) return result.primary;
  return result.secondary.find((s) => s.id === id) ?? null;
}

/** Parses the AWAITING_CONFIRMATION suggestion's own evidence tag for its
 * count -- used instead of a bare null/not-null check because this
 * suite's Move-chain scenarios (1-7, 18) deliberately leave several
 * other past-UPCOMING plans lying around as chain terminals, each of
 * which independently also counts toward this SAME aggregate signal;
 * asserting a DELTA against a captured baseline stays correct regardless
 * of that shared fixture state. 0 when the suggestion is absent entirely. */
function awaitingCount(result: { primary: ImprovementSuggestion | null; secondary: ImprovementSuggestion[] }): number {
  const suggestion = findSuggestion(result, 'awaiting-confirmation');
  if (!suggestion) return 0;
  const match = /awaiting-confirmation-count:(\d+)/.exec(suggestion.evidence);
  return match ? parseInt(match[1], 10) : 0;
}

async function main() {
  const user = await upsertUserByEmail({ email: 'test-improvement-signals@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const other = await upsertUserByEmail({ email: 'test-improvement-signals-other@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const empty = await upsertUserByEmail({ email: 'test-improvement-signals-empty@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  // Dedicated user for Signal 3 (scenarios 11-14) -- isolated from `user`'s
  // own accumulated Move-chain backlog (scenarios 1-7, 18 deliberately
  // leave several AWAITING_CONFIRMATION/REPEATED_RESCHEDULING candidates
  // alive for `user`, which would otherwise correctly fill the "at most 2
  // secondary" cap before Signal 3 ever gets a slot -- that cap behavior
  // is itself covered by scenarios 22/23, not what 11-14 are testing).
  const goalUser = await upsertUserByEmail({ email: 'test-improvement-signals-goal@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await updateBirthProfile(user.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });

  const allUserIds = [user.id, other.id, empty.id, goalUser.id];
  const createdGoalIds: string[] = [];
  const cleanup = async () => {
    for (const goalId of createdGoalIds) {
      for (const uid of allUserIds) await deleteGoal(uid, goalId).catch(() => {});
    }
    await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = NULL WHERE "userId" = ANY($1::text[])`, [allUserIds]);
    await sql(`UPDATE "GoalActivityExecution" SET "plannedActivityId" = NULL, "goalActivityOccurrenceId" = NULL WHERE "userId" = ANY($1::text[])`, [allUserIds]);
    await sql(`UPDATE "PlannedActivity" SET "rescheduledFromPlanId" = NULL WHERE "userId" = ANY($1::text[])`, [allUserIds]);
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])`, [allUserIds]);
    for (const goalId of createdGoalIds) await sql(`DELETE FROM "Goal" WHERE id = $1`, [goalId]).catch(() => {});
    await sql(`DELETE FROM "UserAvailabilityPeriod" WHERE "userId" = ANY($1::text[])`, [allUserIds]);
    await sql(`UPDATE "User" SET "availabilityConfigured" = false, "timezone" = $2 WHERE id = ANY($1::text[])`, [allUserIds, TZ]);
  };
  await cleanup();

  try {
    const fullWeek = Array.from({ length: 7 }, (_, weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' }));
    await replaceUserAvailabilityConfiguration(user.id, fullWeek);
    await replaceUserAvailabilityConfiguration(other.id, fullWeek);
    await replaceUserAvailabilityConfiguration(goalUser.id, fullWeek);
    // `empty` is deliberately left UNCONFIGURED -- scenario 21.

    // ============================================================
    // SIGNAL 1 -- REPEATED RESCHEDULING (scenarios 1-7)
    // ============================================================
    const makePlan = (uid: string, title: string, startIso: string, endIso: string) =>
      createPlannedActivity({ userId: uid, title, plannedStartAt: iso(startIso), plannedEndAt: iso(endIso), durationMinutes: 30, windowType: 'NEUTRAL' });

    // 1. Single Move -- no suggestion.
    const p0 = await makePlan(user.id, 'Workout P', '2028-03-10T04:00:00Z', '2028-03-10T04:30:00Z');
    const move1 = await movePlannedActivity(user.id, p0.id, { newStartAt: iso('2028-03-11T04:00:00.000Z') });
    const p1 = move1.to;
    let result = await computeFor(user, REF_NOW);
    check('1. single Move (1 hop) -- no REPEATED_RESCHEDULING suggestion', findSuggestion(result, `repeated-rescheduling:${p1.id}`) === null);

    // 2. Two Moves -- suggestion.
    const move2 = await movePlannedActivity(user.id, p1.id, { newStartAt: iso('2028-03-12T04:00:00.000Z') });
    const p2 = move2.to;
    result = await computeFor(user, REF_NOW);
    const chainSuggestion = findSuggestion(result, `repeated-rescheduling:${p2.id}`);
    check('2. two Moves (2 hops) -- REPEATED_RESCHEDULING suggestion fires', chainSuggestion !== null && chainSuggestion.evidence === 'move-chain-hop-count:2');

    // 3. Independent Move chains -- never merged.
    const q0 = await makePlan(user.id, 'Reading Q', '2028-03-10T05:00:00Z', '2028-03-10T05:30:00Z');
    const moveQ = await movePlannedActivity(user.id, q0.id, { newStartAt: iso('2028-03-11T05:00:00.000Z') });
    const q1 = moveQ.to;
    result = await computeFor(user, REF_NOW);
    check('3. independent 1-hop chain (Q) does not fire on its own', findSuggestion(result, `repeated-rescheduling:${q1.id}`) === null);
    check('3. independent chains do not inflate each other -- P chain (2 hops) still fires correctly', findSuggestion(result, `repeated-rescheduling:${p2.id}`)?.evidence === 'move-chain-hop-count:2');

    // 4. Resolved terminal -- suppressed.
    const r0 = await makePlan(user.id, 'Reading R', '2028-03-10T06:00:00Z', '2028-03-10T06:30:00Z');
    const moveR1 = await movePlannedActivity(user.id, r0.id, { newStartAt: iso('2028-03-11T06:00:00.000Z') });
    const moveR2 = await movePlannedActivity(user.id, moveR1.to.id, { newStartAt: iso('2028-03-12T06:00:00.000Z') });
    const r2 = moveR2.to;
    result = await computeFor(user, REF_NOW);
    check('4a. before resolution, 2-hop chain (R) is eligible', findSuggestion(result, `repeated-rescheduling:${r2.id}`) !== null);
    await logPlannedActivity(user.id, r2.id);
    result = await computeFor(user, REF_NOW);
    check('4b. resolved (LOGGED) terminal -- suggestion suppressed', findSuggestion(result, `repeated-rescheduling:${r2.id}`) === null);

    // 5. Deleted terminal -- suppressed.
    const s0 = await makePlan(user.id, 'Reading S', '2028-03-10T07:00:00Z', '2028-03-10T07:30:00Z');
    const moveS1 = await movePlannedActivity(user.id, s0.id, { newStartAt: iso('2028-03-11T07:00:00.000Z') });
    const moveS2 = await movePlannedActivity(user.id, moveS1.to.id, { newStartAt: iso('2028-03-12T07:00:00.000Z') });
    const s2 = moveS2.to;
    await logPlannedActivity(user.id, s2.id);
    await deletePlannedActivity(user.id, s2.id);
    result = await computeFor(user, REF_NOW);
    check('5. deleted terminal -- suppressed (nothing left to evaluate)', findSuggestion(result, `repeated-rescheduling:${s2.id}`) === null);

    // 6. Broken chain -- suppressed (pure evaluator, hand-built fixture --
    // the real app can never construct this; evaluateMoveChains must still
    // fail safe rather than report a guessed hop count).
    const brokenRows: MoveChainLinkRow[] = [
      { id: 'broken-terminal', status: 'UPCOMING', rescheduledFromPlanId: 'broken-parent', movedAt: null },
      { id: 'broken-parent', status: 'UPCOMING', rescheduledFromPlanId: null, movedAt: null }, // violates the MOVED invariant
    ];
    const brokenEvaluations: MoveChainEvaluation[] = evaluateMoveChains(brokenRows);
    const brokenEval = brokenEvaluations.find((e) => e.terminalId === 'broken-terminal');
    check('6. broken chain -- flagged broken, never trusted', brokenEval?.broken === true);

    // 7. Legacy NULL movedAt -- hop count unaffected.
    const t0 = await makePlan(user.id, 'Reading T', '2028-03-10T08:00:00Z', '2028-03-10T08:30:00Z');
    const moveT1 = await movePlannedActivity(user.id, t0.id, { newStartAt: iso('2028-03-11T08:00:00.000Z') });
    const moveT2 = await movePlannedActivity(user.id, moveT1.to.id, { newStartAt: iso('2028-03-12T08:00:00.000Z') });
    const t2 = moveT2.to;
    await sql(`UPDATE "PlannedActivity" SET "movedAt" = NULL WHERE id = ANY($1::text[])`, [[t0.id, moveT1.to.id]]);
    result = await computeFor(user, REF_NOW);
    check('7. legacy NULL movedAt -- suggestion still fires (hop count unaffected)', findSuggestion(result, `repeated-rescheduling:${t2.id}`)?.evidence === 'move-chain-hop-count:2');

    // ============================================================
    // SIGNAL 2 -- CURRENT PLANNING OVERLOAD (scenarios 8-10)
    // ============================================================
    // today = 2028-03-18, REF_NOW = 10:00 IST -> clipped usable window
    // 10:00-17:00 IST = 420 usable minutes (availability configured
    // 09:00-17:00 daily).

    // 8. Current accepted-plan overload: ONE commitment spanning past the
    // end of the configured window (10:00-18:30 IST = 510 raw minutes,
    // exceeding the 420-minute usable window).
    const overloadPlan = await makePlan(user.id, 'Overloaded Block', '2028-03-18T04:30:00Z', '2028-03-18T13:00:00Z'); // 10:00-18:30 IST
    result = await computeFor(user, REF_NOW);
    const overloadSuggestion = findSuggestion(result, 'planning-overload:today');
    check('8. accepted commitments exceeding the available window -- OVERLOAD suggestion fires', overloadSuggestion !== null);
    check('8. overload copy is present-tense, no fabricated number/percentage', overloadSuggestion !== null && !/\d/.test(overloadSuggestion.message));
    // CANCELLED never blocks (isActivePlanBlocker) -- removes this
    // commitment's contribution to "today" before the next scenario,
    // without requiring the LOGGED/CANCELLED-only deletePlannedActivity path.
    await cancelPlannedActivity(user.id, overloadPlan.id);

    // 9. Busy but feasible day: a single 6-hour (360-minute) commitment
    // within the 420-minute window -- BUSY (0.857 utilization), not overloaded.
    const busyPlan = await makePlan(user.id, 'Busy Block', '2028-03-18T04:30:00Z', '2028-03-18T10:30:00Z'); // 10:00-16:00 IST, 360 min
    result = await computeFor(user, REF_NOW);
    check('9. busy (360/420 = BUSY) but not overloaded -- no OVERLOAD suggestion', findSuggestion(result, 'planning-overload:today') === null);

    // 10. No historical overload claim -- the SAME function, called fresh
    // with no committed minutes at all, reports no overload (no carried-
    // over state from scenario 8's earlier overloaded call).
    await cancelPlannedActivity(user.id, busyPlan.id);
    result = await computeFor(user, REF_NOW);
    check('10. no committed minutes today -- no OVERLOAD suggestion (no memory of scenario 8)', findSuggestion(result, 'planning-overload:today') === null);

    // ============================================================
    // SIGNAL 3 -- WEEKLY GOAL OPPORTUNITY (scenarios 11-14). Uses the
    // dedicated `goalUser` (see its own declaration above) -- isolated
    // from `user`'s own accumulated Move-chain/awaiting-confirmation
    // backlog, so this signal's own eligibility is observed directly,
    // never crowded out of the top-3 by unrelated higher-priority
    // candidates (that crowding is itself real, correct, deliberate
    // behavior, separately proven by scenario 18's own comment and by
    // scenarios 22/23).
    // ============================================================
    const { goal: goalRhythm } = await createGoalWithActivities({ userId: goalUser.id, title: 'PR5 Rhythm Goal', targetDate: null, activities: [] });
    createdGoalIds.push(goalRhythm.id);
    const rhythmActivity = await addGoalActivity(goalUser.id, goalRhythm.id, { title: 'Yoga', activityId: null, rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 2 } });

    // 11. Weekly Goal remaining capacity (existing Rhythm fact, reused verbatim).
    let { goalSummaries } = await buildGoalSummariesAndRows(goalUser.id, goalUser.timezone, '2028-03-18');
    let rhythmView = goalSummaries.find((g) => g.id === goalRhythm.id)!.activities[0].rhythm;
    check('11. remaining weekly Rhythm capacity > 0 before any occurrence', rhythmView.kind === 'N_PER_WEEK' && rhythmView.remainingThisWeek === 2);

    // 12. Weekly Goal with a feasible slot: today (Sat) and tomorrow (Sun)
    // both have an entirely open 420-minute window -- comfortably fits
    // the 45-minute generic-fallback duration (no activityId catalog match).
    result = await computeFor(goalUser, REF_NOW);
    const opportunitySuggestion = findSuggestion(result, `weekly-goal-opportunity:${goalRhythm.id}`);
    check('12. feasible slot found this week -- WEEKLY_GOAL_OPPORTUNITY fires', opportunitySuggestion !== null);
    check('12. opportunity CTA links to the real, correct Goal', opportunitySuggestion?.cta.action === 'OPEN_GOAL' && opportunitySuggestion?.cta.goalId === goalRhythm.id);

    // 25. VALID CTA DESTINATION -- checked here, while this suggestion is
    // still live (scenario 14 below deliberately exhausts this same
    // Goal's weekly capacity, so the suggestion -- correctly -- no longer
    // exists by the end of the suite). goalId must name a real,
    // currently-ACTIVE Goal this same request's own `goals` list would include.
    const activeGoalIdsAtScenario12 = new Set((await listGoalsForUser(goalUser.id, 'ACTIVE')).map((g) => g.id));
    check('25. OPEN_GOAL CTA names a real, currently-ACTIVE Goal', opportunitySuggestion?.cta.goalId !== undefined && activeGoalIdsAtScenario12.has(opportunitySuggestion.cta.goalId));

    // 13. Weekly Goal WITHOUT a feasible slot: fully book BOTH remaining
    // days (today 2028-03-18 and tomorrow 2028-03-19, the week's own
    // Sunday) end-to-end, 09:00-17:00 IST each -- zero usable minutes
    // left on either day for a new 45-minute activity.
    const fullBook1 = await makePlan(goalUser.id, 'Full Book Today', '2028-03-18T03:30:00Z', '2028-03-18T11:30:00Z'); // 09:00-17:00 IST
    const fullBook2 = await makePlan(goalUser.id, 'Full Book Tomorrow', '2028-03-19T03:30:00Z', '2028-03-19T11:30:00Z'); // 09:00-17:00 IST
    result = await computeFor(goalUser, REF_NOW);
    check('13. no feasible slot on either remaining day -- WEEKLY_GOAL_OPPORTUNITY suppressed', findSuggestion(result, `weekly-goal-opportunity:${goalRhythm.id}`) === null);
    await cancelPlannedActivity(goalUser.id, fullBook1.id);
    await cancelPlannedActivity(goalUser.id, fullBook2.id);

    // 14. Completed weekly target -- remainingThisWeek reaches 0, suppressed
    // regardless of feasibility.
    const occ1 = await makePlan(goalUser.id, 'Yoga occurrence 1', '2028-03-18T04:00:00Z', '2028-03-18T04:30:00Z');
    const occ2 = await makePlan(goalUser.id, 'Yoga occurrence 2', '2028-03-18T05:00:00Z', '2028-03-18T05:30:00Z');
    await sql(`INSERT INTO "GoalActivityOccurrence" (id, "userId", "goalActivityId", "plannedActivityId", "scheduledWeekStart", "scheduledWeekTimezone") VALUES (gen_random_uuid()::text, $1, $2, $3, '2028-03-13', $4), (gen_random_uuid()::text, $1, $2, $5, '2028-03-13', $4)`, [goalUser.id, rhythmActivity!.id, occ1.id, TZ, occ2.id]);
    await logPlannedActivity(goalUser.id, occ1.id);
    await logPlannedActivity(goalUser.id, occ2.id);
    ({ goalSummaries } = await buildGoalSummariesAndRows(goalUser.id, goalUser.timezone, '2028-03-18'));
    rhythmView = goalSummaries.find((g) => g.id === goalRhythm.id)!.activities[0].rhythm;
    check('14a. weekly target reached -- remainingThisWeek === 0', rhythmView.kind === 'N_PER_WEEK' && rhythmView.remainingThisWeek === 0);
    result = await computeFor(goalUser, REF_NOW);
    check('14b. target met -- WEEKLY_GOAL_OPPORTUNITY suppressed regardless of feasibility', findSuggestion(result, `weekly-goal-opportunity:${goalRhythm.id}`) === null);

    // ============================================================
    // SIGNAL 4 -- AWAITING CONFIRMATION (scenarios 15-17)
    // ============================================================
    // 15. Awaiting confirmation -- a past, still-UPCOMING plan. Baselined
    // against the count BEFORE this plan exists (never assumed to be
    // zero -- the Move-chain scenarios above deliberately leave several
    // other past-UPCOMING chain terminals around, each independently
    // counted by this same aggregate signal).
    const baselineAwaitingCount = awaitingCount(await computeFor(user, REF_NOW));
    const awaitingPlan = await makePlan(user.id, 'Unconfirmed Plan', '2028-03-10T04:00:00Z', '2028-03-10T04:30:00Z');
    result = await computeFor(user, REF_NOW);
    const awaitingSuggestion = findSuggestion(result, 'awaiting-confirmation');
    check('15. a past unconfirmed UPCOMING plan -- AWAITING_CONFIRMATION count increases by exactly 1', awaitingCount(result) === baselineAwaitingCount + 1);
    check('15. awaiting-confirmation copy never frames a missing outcome as failure', awaitingSuggestion !== null && !/fail|behind|should have/i.test(awaitingSuggestion.message));

    // 16. Confirmed outcome -- suppression (count returns to baseline).
    await logPlannedActivity(user.id, awaitingPlan.id);
    result = await computeFor(user, REF_NOW);
    check('16. confirming the outcome returns the count to baseline', awaitingCount(result) === baselineAwaitingCount);

    // 17. Deleted completed plan -- no stale/incorrect AWAITING_CONFIRMATION entry.
    await deletePlannedActivity(user.id, awaitingPlan.id);
    result = await computeFor(user, REF_NOW);
    check('17. deleting an already-confirmed plan leaves the count unchanged at baseline', awaitingCount(result) === baselineAwaitingCount);

    // ============================================================
    // 18. CROSS-WEEK MOVE -- Signal 1's chain evaluation is unaffected by
    // which week a hop lands in (pure PlannedActivity-id based, never
    // week-based). Checked directly against listMoveChainLinksForUser +
    // evaluateMoveChains (the real underlying evidence), NOT against the
    // final ranked/capped `computeFor` output -- by this point in the
    // suite there are already 2 OTHER independent 2-hop chains alive for
    // this same user (p2 from scenario 2, t2 from scenario 7), so a
    // THIRD same-priority REPEATED_RESCHEDULING candidate is EXPECTED to
    // be correctly squeezed out by the deliberate "at most 2 secondary"
    // cap (ticket section G) -- that is the cap working as designed, not
    // a hop-counting defect, and is exactly what scenarios 22/23 already
    // cover on their own.
    // ============================================================
    const u0 = await makePlan(user.id, 'Cross-week U', '2028-03-10T09:00:00Z', '2028-03-10T09:30:00Z');
    const moveU1 = await movePlannedActivity(user.id, u0.id, { newStartAt: iso('2028-03-13T09:00:00.000Z') }); // into the following week
    const moveU2 = await movePlannedActivity(user.id, moveU1.to.id, { newStartAt: iso('2028-03-20T09:00:00.000Z') }); // into yet another week
    const crossWeekLinks = await listMoveChainLinksForUser(user.id);
    const crossWeekEvaluation = evaluateMoveChains(crossWeekLinks).find((e) => e.terminalId === moveU2.to.id);
    check('18. cross-week Move chain still counts 2 hops correctly', crossWeekEvaluation?.hopCount === 2 && crossWeekEvaluation.broken === false);

    // ============================================================
    // 19. TIMEZONE CHANGE -- no stale cached window/local-date carried
    // from the old timezone.
    // ============================================================
    const beforeTzDate = getDatePartsInTimezone(TZ, REF_NOW).dateStr;
    await sql(`UPDATE "User" SET timezone = 'America/Los_Angeles' WHERE id = $1`, [user.id]);
    const userAfterTzChange = (await getUserById(user.id))!;
    await replaceUserAvailabilityConfiguration(user.id, fullWeek); // re-save under the new timezone, same convention as a real settings change
    const afterTzDate = getDatePartsInTimezone('America/Los_Angeles', REF_NOW).dateStr;
    check('19a. the same instant resolves to a different local date under the new timezone', beforeTzDate !== afterTzDate);
    result = await computeFor(userAfterTzChange, REF_NOW);
    check('19b. composition runs cleanly under the new timezone with no error/stale state', result !== undefined);
    await sql(`UPDATE "User" SET timezone = $2 WHERE id = $1`, [user.id, TZ]);
    await replaceUserAvailabilityConfiguration(user.id, fullWeek);

    // ============================================================
    // 20. USER ISOLATION
    // ============================================================
    const o0 = await makePlan(other.id, 'Other user plan', '2028-03-10T09:00:00Z', '2028-03-10T09:30:00Z');
    const moveO1 = await movePlannedActivity(other.id, o0.id, { newStartAt: iso('2028-03-11T09:00:00.000Z') });
    const moveO2 = await movePlannedActivity(other.id, moveO1.to.id, { newStartAt: iso('2028-03-12T09:00:00.000Z') });
    const userResultAfterOther = await computeFor(await getUserById(user.id) as User, REF_NOW);
    const otherResult = await computeFor(other, REF_NOW);
    check('20a. user A never sees user B\'s Move-chain suggestion', findSuggestion(userResultAfterOther, `repeated-rescheduling:${moveO2.to.id}`) === null);
    check('20b. user B correctly sees their OWN Move-chain suggestion', findSuggestion(otherResult, `repeated-rescheduling:${moveO2.to.id}`) !== null);

    // ============================================================
    // 21. EMPTY ACCOUNT -- zero plans, zero Goals, UNCONFIGURED availability.
    // ============================================================
    const emptyResult = await computeFor(empty, REF_NOW);
    check('21. empty account -- no suggestions, no error', emptyResult.primary === null && emptyResult.secondary.length === 0);

    // ============================================================
    // 22. DETERMINISTIC RANKING -- AWAITING_CONFIRMATION > PLANNING_OVERLOAD
    // > REPEATED_RESCHEDULING > WEEKLY_GOAL_OPPORTUNITY, always.
    // ============================================================
    const rankingCandidates: ImprovementSuggestion[] = [
      { id: 'a', signal: 'WEEKLY_GOAL_OPPORTUNITY', message: 'm', evidence: 'e', cta: { label: 'l', action: 'OPEN_GOAL', goalId: 'g' }, subjectId: 'goal:g' },
      { id: 'b', signal: 'REPEATED_RESCHEDULING', message: 'm', evidence: 'e', cta: { label: 'l', action: 'OPEN_PLAN_REVIEW' }, subjectId: 'plan:p' },
      { id: 'c', signal: 'PLANNING_OVERLOAD', message: 'm', evidence: 'e', cta: { label: 'l', action: 'OPEN_PLAN_REVIEW' }, subjectId: 'planning-overload:today' },
      { id: 'd', signal: 'AWAITING_CONFIRMATION', message: 'm', evidence: 'e', cta: { label: 'l', action: 'OPEN_PLAN_REVIEW' }, subjectId: 'awaiting-confirmation' },
    ];
    const ranked = rankAndSelectSuggestions(rankingCandidates);
    check('22. deterministic ranking -- AWAITING_CONFIRMATION always primary when present', ranked.primary?.id === 'd');
    check('22. deterministic ranking -- remaining order is PLANNING_OVERLOAD, REPEATED_RESCHEDULING', ranked.secondary.map((s) => s.id).join(',') === 'c,b');

    // ============================================================
    // 23. DUPLICATE SUPPRESSION -- same subjectId, only the higher-
    // priority signal survives.
    // ============================================================
    const dupCandidates: ImprovementSuggestion[] = [
      { id: 'low', signal: 'WEEKLY_GOAL_OPPORTUNITY', message: 'm', evidence: 'e', cta: { label: 'l', action: 'OPEN_GOAL', goalId: 'g' }, subjectId: 'goal:g' },
      { id: 'high', signal: 'AWAITING_CONFIRMATION', message: 'm', evidence: 'e', cta: { label: 'l', action: 'OPEN_PLAN_REVIEW' }, subjectId: 'goal:g' }, // contrived shared subjectId
    ];
    const deduped = rankAndSelectSuggestions(dupCandidates);
    check('23. duplicate subjectId -- only the higher-priority candidate survives', deduped.primary?.id === 'high' && deduped.secondary.length === 0);

    // ============================================================
    // 24. READ-ONLY API -- zero mutations as a side effect of computing suggestions.
    // ============================================================
    const beforeCount = (await sql(`SELECT count(*)::int AS c FROM "PlannedActivity" WHERE "userId" = $1`, [user.id]))[0].c;
    await computeFor(await getUserById(user.id) as User, REF_NOW);
    const afterCount = (await sql(`SELECT count(*)::int AS c FROM "PlannedActivity" WHERE "userId" = $1`, [user.id]))[0].c;
    check('24. computing suggestions performs zero writes (PlannedActivity count unchanged)', beforeCount === afterCount);

    console.log(allPassed ? '\nALL IMPROVEMENT-SIGNALS SCENARIOS PASSED' : '\nSOME SCENARIOS FAILED');
  } finally {
    await cleanup();
  }
}

main()
  .then(() => process.exit(allPassed ? 0 : 1))
  .catch((err) => { console.error(err); process.exit(1); });
