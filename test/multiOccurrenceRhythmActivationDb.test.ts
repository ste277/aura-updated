/**
 * Goals V2 -- Multi-Occurrence Rhythm, PR 2: live-database proof of the
 * WIRED production behavior -- a GoalActivity with an N_PER_WEEK Rhythm
 * may now carry more than one simultaneously-UPCOMING occurrence, through
 * the REAL read path (loadEligibleGoalDemand -> loadCandidateGoalActivitiesForRhythmDemand)
 * and the REAL write path (persistAcceptedConstructedDay ->
 * materializeGoalActivityRhythmOccurrence), up to weekly capacity. Unlike
 * PR 1's own DB suite (which built its two-occurrence fixture via direct
 * SQL, because the production write path still refused a second UPCOMING
 * link at that point), every fixture here is built by actually ACCEPTING
 * through the real Day Constructor acceptance pipeline -- the thing PR 2
 * makes possible.
 *
 * Scenarios A-K, per the ticket's own section 7, plus one additional
 * proof of the new request-level duplicate-GoalActivity guard PR 2 adds
 * (replacing the protection the removed HAS_LIVE_COMMITMENT rejection
 * used to provide incidentally):
 *   A  one UPCOMING occurrence, capacity remains -> still discoverable/eligible
 *   B  a second occurrence is accepted -> two distinct UPCOMING plans coexist
 *   C  capacity exhausted -> no further suggestion or acceptance
 *   D  cancel one -> sibling remains intact
 *   E  complete one -> sibling remains intact
 *   F  move one across a week boundary -> counts update correctly
 *   G  retry acceptance (same clientRequestId) -> no duplicate occurrence
 *   H  concurrent final-slot acceptance -> at most one succeeds
 *   I  NONE-rhythm behavior unchanged
 *   J  a past-due UPCOMING occurrence is not auto-completed or auto-released
 *   K  an existing legacy single-occurrence record continues to work
 *   L  one request with two intents for the SAME GoalActivity is rejected
 *      (the new explicit "one canonical Goal-demand row per draft" guard)
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/multiOccurrenceRhythmActivationDb.test.ts
 */
import { upsertUserByEmail, updateBirthProfile, createGoalWithActivities, addGoalActivity, deleteGoal, cancelPlannedActivity, logPlannedActivity, beginTransaction } from '../apps/web/lib/db';
import { movePlannedActivity } from '../apps/web/lib/planMove';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import type { AcceptConstructedDayRequest, AcceptedProposedItem } from '../apps/web/lib/dayConstructorAcceptance';
import { loadEligibleGoalDemand, createRealGoalDemandCandidatesDeps } from '../apps/web/lib/goalDemandCandidates';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const MIN = 60000;
const GOAL_TITLE_PREFIX = 'PR2 Multi-Occurrence Activation fixture ';
const realDeps = createRealGoalDemandCandidatesDeps();

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
  return { title: 'Strength training', placementSource: 'SELECTED_CANDIDATE', ...overrides };
}
const occurrencesFor = (goalActivityId: string) =>
  sql(`SELECT id, "plannedActivityId" FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1 ORDER BY "createdAt"`, [goalActivityId]);
const planStatus = async (planId: string): Promise<string> => (await sql(`SELECT status FROM "PlannedActivity" WHERE id = $1`, [planId]))[0].status;

async function main() {
  const user = await upsertUserByEmail({ email: 'test-pr2-multi-occurrence-activation@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
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
    // A + B -- one UPCOMING occurrence still leaves capacity, and a
    // second occurrence is genuinely ACCEPTED through the real pipeline.
    // ============================================================
    const { goal: goalAB } = await createGoalWithActivities({ userId: user.id, title: `${GOAL_TITLE_PREFIX}AB`, targetDate: null, activities: [] });
    createdGoalIds.push(goalAB.id);
    const gaAB = await addGoalActivity(user.id, goalAB.id, { title: 'Strength training', activityId: null, rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 5 } });

    const reqA: AcceptConstructedDayRequest = {
      clientRequestId: `pr2-a-${Date.now()}`,
      constructionWindow: window('2026-10-06', '2026-10-06T06:00:00Z', '2026-10-06T20:00:00Z'),
      proposedItems: [item({ intentId: 'intent-a', start: iso('2026-10-06T09:00:00Z'), end: iso('2026-10-06T09:30:00Z') })],
    };
    const decisionA = await persistAcceptedConstructedDay(user.id, reqA, iso('2026-10-06T08:00:00Z'), new Map([['intent-a', gaAB!.id]]));
    check('A setup: first occurrence SAVES', decisionA.status === 'SAVED');
    const planA = decisionA.status === 'SAVED' ? decisionA.plans[0] : null;

    const demandAfterA = await loadEligibleGoalDemand(realDeps, user.id, '2026-10-06', TZ);
    const candidateAfterA = demandAfterA.status === 'OK' ? demandAfterA.candidates.find((c) => c.goalActivityId === gaAB!.id) : undefined;
    check('A. with one UPCOMING occurrence and capacity remaining (5-0-1=4), the GoalActivity is STILL discoverable/eligible for another suggestion', !!candidateAfterA && candidateAfterA.remainingThisWeek === 4);

    const reqB: AcceptConstructedDayRequest = {
      clientRequestId: `pr2-b-${Date.now()}`,
      constructionWindow: window('2026-10-07', '2026-10-07T06:00:00Z', '2026-10-07T20:00:00Z'),
      proposedItems: [item({ intentId: 'intent-b', start: iso('2026-10-07T09:00:00Z'), end: iso('2026-10-07T09:30:00Z') })],
    };
    const decisionB = await persistAcceptedConstructedDay(user.id, reqB, iso('2026-10-07T08:00:00Z'), new Map([['intent-b', gaAB!.id]]));
    check('B. a SECOND occurrence for the SAME GoalActivity is genuinely ACCEPTED (not refused by a single-live-commitment gate)', decisionB.status === 'SAVED');
    const planB = decisionB.status === 'SAVED' ? decisionB.plans[0] : null;
    check('B. two DISTINCT UPCOMING PlannedActivity rows now exist', planA!.id !== planB!.id && (await planStatus(planA!.id)) === 'UPCOMING' && (await planStatus(planB!.id)) === 'UPCOMING');
    const occsAB = await occurrencesFor(gaAB!.id);
    check('B. exactly two GoalActivityOccurrence rows exist, each with its own distinct Plan link', occsAB.length === 2 && occsAB[0].plannedActivityId !== occsAB[1].plannedActivityId);

    // ============================================================
    // C -- capacity exhausted: no further suggestion or acceptance
    // ============================================================
    const { goal: goalC } = await createGoalWithActivities({ userId: user.id, title: `${GOAL_TITLE_PREFIX}C`, targetDate: null, activities: [] });
    createdGoalIds.push(goalC.id);
    const gaC = await addGoalActivity(user.id, goalC.id, { title: 'Strength training', activityId: null, rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 2 } });
    const reqC1: AcceptConstructedDayRequest = { clientRequestId: `pr2-c1-${Date.now()}`, constructionWindow: window('2026-10-06', '2026-10-06T06:00:00Z', '2026-10-06T20:00:00Z'), proposedItems: [item({ intentId: 'intent-c1', start: iso('2026-10-06T10:00:00Z'), end: iso('2026-10-06T10:30:00Z') })] };
    const reqC2: AcceptConstructedDayRequest = { clientRequestId: `pr2-c2-${Date.now()}`, constructionWindow: window('2026-10-07', '2026-10-07T06:00:00Z', '2026-10-07T20:00:00Z'), proposedItems: [item({ intentId: 'intent-c2', start: iso('2026-10-07T10:00:00Z'), end: iso('2026-10-07T10:30:00Z') })] };
    check('C setup: first of 2/week SAVES', (await persistAcceptedConstructedDay(user.id, reqC1, iso('2026-10-06T08:00:00Z'), new Map([['intent-c1', gaC!.id]]))).status === 'SAVED');
    check('C setup: second of 2/week SAVES (capacity now exactly full)', (await persistAcceptedConstructedDay(user.id, reqC2, iso('2026-10-07T08:00:00Z'), new Map([['intent-c2', gaC!.id]]))).status === 'SAVED');
    const demandAtC = await loadEligibleGoalDemand(realDeps, user.id, '2026-10-07', TZ);
    check('C. capacity exhausted: the GoalActivity no longer appears as a suggestion', demandAtC.status === 'OK' && !demandAtC.candidates.some((c) => c.goalActivityId === gaC!.id));
    const reqC3: AcceptConstructedDayRequest = { clientRequestId: `pr2-c3-${Date.now()}`, constructionWindow: window('2026-10-08', '2026-10-08T06:00:00Z', '2026-10-08T20:00:00Z'), proposedItems: [item({ intentId: 'intent-c3', start: iso('2026-10-08T10:00:00Z'), end: iso('2026-10-08T10:30:00Z') })] };
    const occsCBefore = await occurrencesFor(gaC!.id);
    const decisionC3 = await persistAcceptedConstructedDay(user.id, reqC3, iso('2026-10-08T08:00:00Z'), new Map([['intent-c3', gaC!.id]]));
    check('C. a THIRD acceptance attempt FAILS the whole transaction (capacity exhausted)', decisionC3.status === 'SAVE_FAILED');
    check('C. no third occurrence was created by the failed attempt', (await occurrencesFor(gaC!.id)).length === occsCBefore.length);

    // ============================================================
    // D -- cancel one: sibling remains intact
    // ============================================================
    const { goal: goalD } = await createGoalWithActivities({ userId: user.id, title: `${GOAL_TITLE_PREFIX}D`, targetDate: null, activities: [] });
    createdGoalIds.push(goalD.id);
    const gaD = await addGoalActivity(user.id, goalD.id, { title: 'Strength training', activityId: null, rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 5 } });
    const reqD1: AcceptConstructedDayRequest = { clientRequestId: `pr2-d1-${Date.now()}`, constructionWindow: window('2026-10-06', '2026-10-06T06:00:00Z', '2026-10-06T20:00:00Z'), proposedItems: [item({ intentId: 'intent-d1', start: iso('2026-10-06T11:00:00Z'), end: iso('2026-10-06T11:30:00Z') })] };
    const reqD2: AcceptConstructedDayRequest = { clientRequestId: `pr2-d2-${Date.now()}`, constructionWindow: window('2026-10-07', '2026-10-07T06:00:00Z', '2026-10-07T20:00:00Z'), proposedItems: [item({ intentId: 'intent-d2', start: iso('2026-10-07T11:00:00Z'), end: iso('2026-10-07T11:30:00Z') })] };
    const decisionD1 = await persistAcceptedConstructedDay(user.id, reqD1, iso('2026-10-06T08:00:00Z'), new Map([['intent-d1', gaD!.id]]));
    const decisionD2 = await persistAcceptedConstructedDay(user.id, reqD2, iso('2026-10-07T08:00:00Z'), new Map([['intent-d2', gaD!.id]]));
    check('D setup: two occurrences SAVED', decisionD1.status === 'SAVED' && decisionD2.status === 'SAVED');
    const planD1 = (decisionD1 as any).plans[0];
    const planD2 = (decisionD2 as any).plans[0];
    await cancelPlannedActivity(user.id, planD1.id);
    check('D. the cancelled plan is CANCELLED', (await planStatus(planD1.id)) === 'CANCELLED');
    check('D. the sibling occurrence remains fully intact: still points to its own plan, which remains UPCOMING', (await planStatus(planD2.id)) === 'UPCOMING');
    const demandAfterD = await loadEligibleGoalDemand(realDeps, user.id, '2026-10-07', TZ);
    const candidateAfterD = demandAfterD.status === 'OK' ? demandAfterD.candidates.find((c) => c.goalActivityId === gaD!.id) : undefined;
    check('D. the cancellation correctly frees its capacity back (remainingThisWeek 4, not 3 -- cancelled never consumed)', !!candidateAfterD && candidateAfterD.remainingThisWeek === 4);

    // ============================================================
    // E -- complete one: sibling remains intact
    // ============================================================
    const { goal: goalE } = await createGoalWithActivities({ userId: user.id, title: `${GOAL_TITLE_PREFIX}E`, targetDate: null, activities: [] });
    createdGoalIds.push(goalE.id);
    const gaE = await addGoalActivity(user.id, goalE.id, { title: 'Strength training', activityId: null, rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 5 } });
    const reqE1: AcceptConstructedDayRequest = { clientRequestId: `pr2-e1-${Date.now()}`, constructionWindow: window('2026-10-06', '2026-10-06T06:00:00Z', '2026-10-06T20:00:00Z'), proposedItems: [item({ intentId: 'intent-e1', start: iso('2026-10-06T12:00:00Z'), end: iso('2026-10-06T12:30:00Z') })] };
    const reqE2: AcceptConstructedDayRequest = { clientRequestId: `pr2-e2-${Date.now()}`, constructionWindow: window('2026-10-07', '2026-10-07T06:00:00Z', '2026-10-07T20:00:00Z'), proposedItems: [item({ intentId: 'intent-e2', start: iso('2026-10-07T12:00:00Z'), end: iso('2026-10-07T12:30:00Z') })] };
    const decisionE1 = await persistAcceptedConstructedDay(user.id, reqE1, iso('2026-10-06T08:00:00Z'), new Map([['intent-e1', gaE!.id]]));
    const decisionE2 = await persistAcceptedConstructedDay(user.id, reqE2, iso('2026-10-07T08:00:00Z'), new Map([['intent-e2', gaE!.id]]));
    check('E setup: two occurrences SAVED', decisionE1.status === 'SAVED' && decisionE2.status === 'SAVED');
    const planE1 = (decisionE1 as any).plans[0];
    const planE2 = (decisionE2 as any).plans[0];
    await logPlannedActivity(user.id, planE1.id);
    check('E. the completed plan is LOGGED', (await planStatus(planE1.id)) === 'LOGGED');
    check('E. the sibling occurrence remains fully intact: still UPCOMING, untouched by the sibling\'s completion', (await planStatus(planE2.id)) === 'UPCOMING');
    const demandAfterE = await loadEligibleGoalDemand(realDeps, user.id, '2026-10-07', TZ);
    const candidateAfterE = demandAfterE.status === 'OK' ? demandAfterE.candidates.find((c) => c.goalActivityId === gaE!.id) : undefined;
    check('E. completedThisWeek=1 and committedThisWeek=1 are correctly distinguished, remainingThisWeek=3 (5-1-1)', !!candidateAfterE && candidateAfterE.rhythm.completedThisWeek === 1 && candidateAfterE.rhythm.committedThisWeek === 1 && candidateAfterE.remainingThisWeek === 3);

    // ============================================================
    // F -- move one across a week boundary: counts update correctly.
    // Real near-future instants (movePlannedActivity validates against
    // the real wall clock, independent of any test-injected `now`).
    // ============================================================
    const { goal: goalF } = await createGoalWithActivities({ userId: user.id, title: `${GOAL_TITLE_PREFIX}F`, targetDate: null, activities: [] });
    createdGoalIds.push(goalF.id);
    const gaF = await addGoalActivity(user.id, goalF.id, { title: 'Strength training', activityId: null, rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 5 } });
    const moveBase = Math.ceil((Date.now() + 2 * 3600000) / MIN) * MIN;
    const moveWindowDate = new Date(moveBase).toISOString().slice(0, 10);
    const reqF: AcceptConstructedDayRequest = {
      clientRequestId: `pr2-f-${Date.now()}`,
      constructionWindow: window(moveWindowDate, new Date(moveBase - 3600000).toISOString(), new Date(moveBase + 24 * 3600000).toISOString()),
      proposedItems: [item({ intentId: 'intent-f', start: new Date(moveBase), end: new Date(moveBase + 30 * MIN) })],
    };
    const decisionF = await persistAcceptedConstructedDay(user.id, reqF, new Date(moveBase - 1800000), new Map([['intent-f', gaF!.id]]));
    check('F setup: occurrence created for the Move test', decisionF.status === 'SAVED');
    const planF = (decisionF as any).plans[0];
    const todayCount = await loadEligibleGoalDemand(realDeps, user.id, moveWindowDate, TZ);
    const candidateToday = todayCount.status === 'OK' ? todayCount.candidates.find((c) => c.goalActivityId === gaF!.id) : undefined;
    check('F. before the Move: committedThisWeek=1 counts this week, remainingThisWeek=4', !!candidateToday && candidateToday.rhythm.committedThisWeek === 1 && candidateToday.remainingThisWeek === 4);
    const eightDaysMs = 8 * 24 * 3600000; // > 7 days: guaranteed to cross at least one Monday week boundary
    const moveResultF = await movePlannedActivity(user.id, planF.id, { newStartAt: new Date(moveBase + eightDaysMs) });
    const newWeekDate = new Date(moveBase + eightDaysMs).toISOString().slice(0, 10);
    const afterMoveOldWeek = await loadEligibleGoalDemand(realDeps, user.id, moveWindowDate, TZ);
    const candidateOldWeekAfterMove = afterMoveOldWeek.status === 'OK' ? afterMoveOldWeek.candidates.find((c) => c.goalActivityId === gaF!.id) : undefined;
    check('F. after the Move: the OLD week no longer counts the moved occurrence (remainingThisWeek back to full, 5)', !!candidateOldWeekAfterMove && candidateOldWeekAfterMove.rhythm.committedThisWeek === 0 && candidateOldWeekAfterMove.remainingThisWeek === 5);
    const afterMoveNewWeek = await loadEligibleGoalDemand(realDeps, user.id, newWeekDate, TZ);
    const candidateNewWeekAfterMove = afterMoveNewWeek.status === 'OK' ? afterMoveNewWeek.candidates.find((c) => c.goalActivityId === gaF!.id) : undefined;
    check('F. after the Move: the NEW week now counts the occurrence at its successor plan, remainingThisWeek reduced to 4', !!candidateNewWeekAfterMove && candidateNewWeekAfterMove.rhythm.committedThisWeek === 1 && candidateNewWeekAfterMove.remainingThisWeek === 4);
    check('F. exactly ONE occurrence row exists throughout (Move repoints, never creates a second)', (await occurrencesFor(gaF!.id)).length === 1 && (await occurrencesFor(gaF!.id))[0].plannedActivityId === moveResultF.to.id);

    // ============================================================
    // G -- retry acceptance (same clientRequestId): no duplicate occurrence
    // ============================================================
    const { goal: goalG } = await createGoalWithActivities({ userId: user.id, title: `${GOAL_TITLE_PREFIX}G`, targetDate: null, activities: [] });
    createdGoalIds.push(goalG.id);
    const gaG = await addGoalActivity(user.id, goalG.id, { title: 'Strength training', activityId: null, rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 5 } });
    const reqG: AcceptConstructedDayRequest = { clientRequestId: `pr2-g-${Date.now()}`, constructionWindow: window('2026-10-06', '2026-10-06T06:00:00Z', '2026-10-06T20:00:00Z'), proposedItems: [item({ intentId: 'intent-g', start: iso('2026-10-06T13:00:00Z'), end: iso('2026-10-06T13:30:00Z') })] };
    const firstG = await persistAcceptedConstructedDay(user.id, reqG, iso('2026-10-06T08:00:00Z'), new Map([['intent-g', gaG!.id]]));
    const retryG = await persistAcceptedConstructedDay(user.id, reqG, iso('2026-10-06T08:05:00Z'), new Map([['intent-g', gaG!.id]]));
    check('G. first acceptance SAVES', firstG.status === 'SAVED');
    check('G. an identical retry (same clientRequestId) returns ALREADY_ACCEPTED, never a second materialization', retryG.status === 'ALREADY_ACCEPTED');
    check('G. exactly ONE occurrence exists after the retry', (await occurrencesFor(gaG!.id)).length === 1);

    // ============================================================
    // H -- concurrent final-slot acceptance: at most one succeeds
    // ============================================================
    const { goal: goalH } = await createGoalWithActivities({ userId: user.id, title: `${GOAL_TITLE_PREFIX}H`, targetDate: null, activities: [] });
    createdGoalIds.push(goalH.id);
    const gaH = await addGoalActivity(user.id, goalH.id, { title: 'Strength training', activityId: null, rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 2 } });
    // Pre-fill ONE of the two slots, leaving exactly one final slot contested.
    const reqHSetup: AcceptConstructedDayRequest = { clientRequestId: `pr2-h-setup-${Date.now()}`, constructionWindow: window('2026-10-06', '2026-10-06T06:00:00Z', '2026-10-06T20:00:00Z'), proposedItems: [item({ intentId: 'intent-h-setup', start: iso('2026-10-06T14:00:00Z'), end: iso('2026-10-06T14:30:00Z') })] };
    check('H setup: first of 2/week SAVES', (await persistAcceptedConstructedDay(user.id, reqHSetup, iso('2026-10-06T08:00:00Z'), new Map([['intent-h-setup', gaH!.id]]))).status === 'SAVED');
    const reqHa: AcceptConstructedDayRequest = { clientRequestId: `pr2-h-a-${Date.now()}`, constructionWindow: window('2026-10-07', '2026-10-07T06:00:00Z', '2026-10-07T20:00:00Z'), proposedItems: [item({ intentId: 'intent-h-a', start: iso('2026-10-07T14:00:00Z'), end: iso('2026-10-07T14:30:00Z') })] };
    const reqHb: AcceptConstructedDayRequest = { clientRequestId: `pr2-h-b-${Date.now()}`, constructionWindow: window('2026-10-07', '2026-10-07T06:00:00Z', '2026-10-07T20:00:00Z'), proposedItems: [item({ intentId: 'intent-h-b', start: iso('2026-10-07T15:00:00Z'), end: iso('2026-10-07T15:30:00Z') })] };
    const [resHa, resHb] = await Promise.all([
      persistAcceptedConstructedDay(user.id, reqHa, iso('2026-10-07T08:00:00Z'), new Map([['intent-h-a', gaH!.id]])),
      persistAcceptedConstructedDay(user.id, reqHb, iso('2026-10-07T08:00:00Z'), new Map([['intent-h-b', gaH!.id]])),
    ]);
    const successesH = [resHa, resHb].filter((r) => r.status === 'SAVED').length;
    const failuresH = [resHa, resHb].filter((r) => r.status === 'SAVE_FAILED').length;
    check('H. exactly ONE of two concurrent requests for the LAST weekly slot succeeds, the other deterministically fails', successesH === 1 && failuresH === 1);
    check('H. exactly TWO occurrences exist in total after both concurrent attempts resolve (the pre-filled one + the single winner, never three)', (await occurrencesFor(gaH!.id)).length === 2);

    // ============================================================
    // I -- NONE-rhythm behavior unchanged (the legacy finite path)
    // ============================================================
    const { goal: goalI } = await createGoalWithActivities({ userId: user.id, title: `${GOAL_TITLE_PREFIX}I`, targetDate: null, activities: [] });
    createdGoalIds.push(goalI.id);
    const gaI = await addGoalActivity(user.id, goalI.id, { title: 'Write project proposal', activityId: null }); // rhythm omitted -> NONE
    const reqI1: AcceptConstructedDayRequest = { clientRequestId: `pr2-i1-${Date.now()}`, constructionWindow: window('2026-10-06', '2026-10-06T06:00:00Z', '2026-10-06T20:00:00Z'), proposedItems: [item({ intentId: 'intent-i1', title: 'Write project proposal', start: iso('2026-10-06T16:00:00Z'), end: iso('2026-10-06T17:00:00Z') })] };
    const decisionI1 = await persistAcceptedConstructedDay(user.id, reqI1, iso('2026-10-06T08:00:00Z'), new Map([['intent-i1', gaI!.id]]));
    check('I setup: finite activity accepted once', decisionI1.status === 'SAVED');
    const planI1 = (decisionI1 as any).plans[0];
    // A second attempt WHILE the first is still UPCOMING must still be
    // refused for a finite (NONE) activity -- this is the EXISTING
    // linkGoalActivityToPlannedActivity behavior, completely untouched by
    // PR 2 (which only relaxed the N_PER_WEEK gate).
    const reqI2: AcceptConstructedDayRequest = { clientRequestId: `pr2-i2-${Date.now()}`, constructionWindow: window('2026-10-07', '2026-10-07T06:00:00Z', '2026-10-07T20:00:00Z'), proposedItems: [item({ intentId: 'intent-i2', title: 'Write project proposal', start: iso('2026-10-07T16:00:00Z'), end: iso('2026-10-07T17:00:00Z') })] };
    const decisionI2 = await persistAcceptedConstructedDay(user.id, reqI2, iso('2026-10-07T08:00:00Z'), new Map([['intent-i2', gaI!.id]]));
    check('I. a NONE-rhythm GoalActivity still refuses a second link while the first is UPCOMING (legacy behavior, unchanged by PR 2)', decisionI2.status === 'SAVE_FAILED');
    check('I. zero GoalActivityOccurrence rows exist for a NONE-rhythm activity (R3\'s occurrence ledger is Rhythm-only, as always)', (await occurrencesFor(gaI!.id)).length === 0);
    // Pre-existing, documented legacy rule (linkGoalActivityToPlannedActivity):
    // a finite link is eligible for RE-linking only when CANCELLED or
    // SKIPPED -- LOGGED is terminal (a one-off task, once done, is not
    // offered again). Confirms LOGGED still refuses, and only CANCELLED
    // frees it, exactly as before PR 2 (which touches only the N_PER_WEEK
    // gate, never this legacy finite path).
    await logPlannedActivity(user.id, planI1.id);
    const decisionI3 = await persistAcceptedConstructedDay(user.id, reqI2, iso('2026-10-07T08:10:00Z'), new Map([['intent-i2', gaI!.id]]));
    check('I. LOGGED is still terminal for a finite activity -- a new attempt is still refused (unchanged by PR 2)', decisionI3.status === 'SAVE_FAILED');
    const gaI2 = await addGoalActivity(user.id, goalI.id, { title: 'Write project proposal 2', activityId: null });
    const reqI4a: AcceptConstructedDayRequest = { clientRequestId: `pr2-i4a-${Date.now()}`, constructionWindow: window('2026-10-08', '2026-10-08T06:00:00Z', '2026-10-08T20:00:00Z'), proposedItems: [item({ intentId: 'intent-i4a', title: 'Write project proposal 2', start: iso('2026-10-08T16:00:00Z'), end: iso('2026-10-08T17:00:00Z') })] };
    const decisionI4a = await persistAcceptedConstructedDay(user.id, reqI4a, iso('2026-10-08T08:00:00Z'), new Map([['intent-i4a', gaI2!.id]]));
    check('I setup: a second finite activity accepted once', decisionI4a.status === 'SAVED');
    await cancelPlannedActivity(user.id, (decisionI4a as any).plans[0].id);
    const reqI4b: AcceptConstructedDayRequest = { clientRequestId: `pr2-i4b-${Date.now()}`, constructionWindow: window('2026-10-09', '2026-10-09T06:00:00Z', '2026-10-09T20:00:00Z'), proposedItems: [item({ intentId: 'intent-i4b', title: 'Write project proposal 2', start: iso('2026-10-09T16:00:00Z'), end: iso('2026-10-09T17:00:00Z') })] };
    const decisionI4b = await persistAcceptedConstructedDay(user.id, reqI4b, iso('2026-10-09T08:00:00Z'), new Map([['intent-i4b', gaI2!.id]]));
    check('I. after CANCELLING (not completing), the SAME legacy link path accepts a new one (finite re-plan, unchanged by PR 2)', decisionI4b.status === 'SAVED');

    // ============================================================
    // J -- a past-due UPCOMING occurrence is not auto-completed/auto-released
    // ============================================================
    const { goal: goalJ } = await createGoalWithActivities({ userId: user.id, title: `${GOAL_TITLE_PREFIX}J`, targetDate: null, activities: [] });
    createdGoalIds.push(goalJ.id);
    const gaJ = await addGoalActivity(user.id, goalJ.id, { title: 'Strength training', activityId: null, rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 3 } });
    // A construction window and proposed instant genuinely in the PAST
    // relative to the real wall clock -- persistAcceptedConstructedDay
    // takes `now` as an explicit parameter, so this is accepted exactly
    // as if it had been planned that day and never touched since.
    const reqJ: AcceptConstructedDayRequest = { clientRequestId: `pr2-j-${Date.now()}`, constructionWindow: window('2026-01-05', '2026-01-05T06:00:00Z', '2026-01-05T20:00:00Z'), proposedItems: [item({ intentId: 'intent-j', start: iso('2026-01-05T10:00:00Z'), end: iso('2026-01-05T10:30:00Z') })] };
    const decisionJ = await persistAcceptedConstructedDay(user.id, reqJ, iso('2026-01-05T08:00:00Z'), new Map([['intent-j', gaJ!.id]]));
    check('J setup: a past-dated occurrence was accepted', decisionJ.status === 'SAVED');
    const planJ = (decisionJ as any).plans[0];
    check('J. the plan remains UPCOMING, long after its own window has elapsed -- no process has silently touched it', (await planStatus(planJ.id)) === 'UPCOMING');
    // Re-reading eligibility TODAY (a real, current planning date) must
    // still count this long-past-due occurrence as a live COMMITMENT in
    // ITS OWN week (2026-01-05's week) -- not silently dropped, not
    // reinterpreted as completed.
    const demandForJsWeek = await loadEligibleGoalDemand(realDeps, user.id, '2026-01-06', TZ); // Tuesday of the same Monday-start week as 2026-01-05
    const candidateJ = demandForJsWeek.status === 'OK' ? demandForJsWeek.candidates.find((c) => c.goalActivityId === gaJ!.id) : undefined;
    check('J. the past-due-but-still-UPCOMING occurrence still counts as a live commitment in its own week (committedThisWeek=1), preserved until the user explicitly acts', !!candidateJ && candidateJ.rhythm.committedThisWeek === 1 && candidateJ.rhythm.completedThisWeek === 0);

    // ============================================================
    // K -- an existing legacy single-occurrence record continues to work
    // (a GoalActivity with exactly one occurrence ever, exercised through
    // every lifecycle action, behaves identically to before PR 2).
    // ============================================================
    const { goal: goalK } = await createGoalWithActivities({ userId: user.id, title: `${GOAL_TITLE_PREFIX}K`, targetDate: null, activities: [] });
    createdGoalIds.push(goalK.id);
    const gaK = await addGoalActivity(user.id, goalK.id, { title: 'Strength training', activityId: null, rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 3 } });
    const reqK: AcceptConstructedDayRequest = { clientRequestId: `pr2-k-${Date.now()}`, constructionWindow: window('2026-10-06', '2026-10-06T06:00:00Z', '2026-10-06T20:00:00Z'), proposedItems: [item({ intentId: 'intent-k', start: iso('2026-10-06T18:00:00Z'), end: iso('2026-10-06T18:30:00Z') })] };
    const decisionK = await persistAcceptedConstructedDay(user.id, reqK, iso('2026-10-06T08:00:00Z'), new Map([['intent-k', gaK!.id]]));
    check('K setup: the legacy single occurrence SAVES exactly as before', decisionK.status === 'SAVED' && (await occurrencesFor(gaK!.id)).length === 1);
    const planK = (decisionK as any).plans[0];
    const moveResultK = await movePlannedActivity(user.id, planK.id, { newStartAt: new Date(Math.ceil((Date.now() + 3 * 3600000) / MIN) * MIN) });
    check('K. Move still repoints the SAME single occurrence to its successor, never creating a second', (await occurrencesFor(gaK!.id)).length === 1 && (await occurrencesFor(gaK!.id))[0].plannedActivityId === moveResultK.to.id);
    await logPlannedActivity(user.id, moveResultK.to.id);
    check('K. logging it still completes the GoalActivity\'s one-and-only occurrence exactly as before', (await planStatus(moveResultK.to.id)) === 'LOGGED');

    // ============================================================
    // L -- one request with two intents for the SAME GoalActivity is
    // rejected (the new explicit guard replacing the incidental
    // protection HAS_LIVE_COMMITMENT used to provide).
    // ============================================================
    const { goal: goalL } = await createGoalWithActivities({ userId: user.id, title: `${GOAL_TITLE_PREFIX}L`, targetDate: null, activities: [] });
    createdGoalIds.push(goalL.id);
    const gaL = await addGoalActivity(user.id, goalL.id, { title: 'Strength training', activityId: null, rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 5 } });
    const reqL: AcceptConstructedDayRequest = {
      clientRequestId: `pr2-l-${Date.now()}`,
      constructionWindow: window('2026-10-06', '2026-10-06T06:00:00Z', '2026-10-06T20:00:00Z'),
      proposedItems: [
        item({ intentId: 'intent-l1', start: iso('2026-10-06T19:00:00Z'), end: iso('2026-10-06T19:30:00Z') }),
        item({ intentId: 'intent-l2', start: iso('2026-10-06T20:00:00Z'), end: iso('2026-10-06T20:30:00Z') }),
      ],
    };
    const decisionL = await persistAcceptedConstructedDay(user.id, reqL, iso('2026-10-06T08:00:00Z'), new Map([['intent-l1', gaL!.id], ['intent-l2', gaL!.id]]));
    check('L. a single request with TWO intents resolving to the SAME GoalActivity is rejected (one canonical Goal-demand row per draft)', decisionL.status === 'REJECTED' && (decisionL as any).reason === 'INVALID_REQUEST');
    check('L. zero writes result from the rejected request (ample capacity notwithstanding -- this is a per-request rule, not a capacity decision)', (await occurrencesFor(gaL!.id)).length === 0 && (await sql(`SELECT count(*)::int n FROM "PlannedActivity" WHERE "userId" = $1 AND "plannedStartAt" >= $2 AND "plannedStartAt" < $3`, [user.id, iso('2026-10-06T19:00:00Z'), iso('2026-10-06T21:00:00Z')]))[0].n === 0);
  } finally {
    await cleanup();
  }

  if (!allPassed) {
    console.error('SOME MULTI-OCCURRENCE RHYTHM ACTIVATION DB CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL MULTI-OCCURRENCE RHYTHM ACTIVATION DB CHECKS PASSED');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
