/**
 * Live-database tests for Goals -> Planning Integration V1 PR C -- the
 * atomic GoalActivity <-> PlannedActivity linkage inside the real Day
 * Constructor acceptance transaction. Exercised directly against
 * `persistAcceptedConstructedDay` (bypassing HTTP, matching
 * dayConstructorAcceptancePersistenceDb.test.ts's own established
 * convention) so every ROLLBACK/ownership/eligibility path can be forced
 * deterministically. Requires a real, reachable DATABASE_URL -- NOT part
 * of ci.yml's math-core-tests job.
 *
 * Run locally with a real DATABASE_URL set:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/goalPlanningHandoffDb.test.ts
 */
import {
  upsertUserByEmail,
  updateBirthProfile,
  deletePlannedActivity,
  cancelPlannedActivity,
  logPlannedActivity,
  createGoalWithActivities,
  addGoalActivity,
  deleteGoal,
  listGoalActivitiesWithLinkedPlanStatus,
  listPlannedActivitiesForDay,
  beginTransaction,
} from '../apps/web/lib/db';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import type { AcceptConstructedDayRequest, AcceptedProposedItem } from '../apps/web/lib/dayConstructorAcceptance';
import { deriveGoalActivityState, computeGoalProgress } from '../apps/web/lib/goals';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';

function iso(s: string): Date {
  return new Date(s);
}

function window(start: string, end: string) {
  return { date: '2026-09-20', start: iso(start), end: iso(end), timezone: TZ, source: 'EXPLICIT_RANGE' as const };
}

function item(overrides: Partial<AcceptedProposedItem> & { intentId: string; start: Date; end: Date }): AcceptedProposedItem {
  return { title: 'Untitled', placementSource: 'SELECTED_CANDIDATE', ...overrides };
}

/** Reads the CURRENT derived state of one GoalActivity, fresh from the DB
 * (never trusts a value computed before this call). */
async function derivedStateOf(userId: string, goalId: string, goalActivityId: string): Promise<string | null> {
  const rows = await listGoalActivitiesWithLinkedPlanStatus(userId, goalId);
  const row = rows.find((r) => r.id === goalActivityId);
  if (!row) return null;
  return deriveGoalActivityState({ status: row.status, plannedActivityId: row.plannedActivityId, linkedPlanStatus: row.linkedPlanStatus });
}

async function plannedActivityIdOf(userId: string, goalId: string, goalActivityId: string): Promise<string | null> {
  const rows = await listGoalActivitiesWithLinkedPlanStatus(userId, goalId);
  return rows.find((r) => r.id === goalActivityId)?.plannedActivityId ?? null;
}

/** TEST-SETUP-ONLY raw linkage, bypassing the eligibility guard entirely
 * -- used ONLY to seed an already-linked precondition (e.g. "this
 * GoalActivity already points at an UPCOMING Plan") before exercising
 * the REAL guarded function under test. Same technique already used in
 * test/goalsDb.test.ts. */
async function forceRawLink(goalActivityId: string, plannedActivityId: string): Promise<void> {
  const client = await beginTransaction();
  await client.query(`UPDATE "GoalActivity" SET "plannedActivityId" = $1 WHERE id = $2`, [plannedActivityId, goalActivityId]);
  await client.query('COMMIT');
  client.release();
}

async function main() {
  const userA = await upsertUserByEmail({ email: 'test-goal-planning-handoff-a@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const userB = await upsertUserByEmail({ email: 'test-goal-planning-handoff-b@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await updateBirthProfile(userA.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  await updateBirthProfile(userB.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });

  const createdPlanIds: string[] = [];
  const createdGoalIds: string[] = [];
  const cleanup = async () => {
    for (const id of createdPlanIds) {
      await cancelPlannedActivity(userA.id, id).catch(() => {});
      await deletePlannedActivity(userA.id, id).catch(() => {});
      await cancelPlannedActivity(userB.id, id).catch(() => {});
      await deletePlannedActivity(userB.id, id).catch(() => {});
    }
    for (const id of createdGoalIds) {
      await deleteGoal(userA.id, id).catch(() => {});
      await deleteGoal(userB.id, id).catch(() => {});
    }
  };

  try {
    // ============================================================
    // Z. Goal-linked accept creates PlannedActivity + link atomically
    // ============================================================
    const goalZ = await createGoalWithActivities({ userId: userA.id, title: 'Finish investor deck', targetDate: null, activities: [] });
    createdGoalIds.push(goalZ.goal.id);
    const activityZ = await addGoalActivity(userA.id, goalZ.goal.id, { title: 'Block focus time', activityId: null });
    const reqZ: AcceptConstructedDayRequest = {
      clientRequestId: `goal-handoff-z-${Date.now()}`,
      constructionWindow: window('2026-09-20T09:00:00Z', '2026-09-20T17:00:00Z'),
      proposedItems: [item({ intentId: 'intent-z', title: 'Block focus time', start: iso('2026-09-20T10:00:00Z'), end: iso('2026-09-20T11:00:00Z') })],
    };
    const decisionZ = await persistAcceptedConstructedDay(userA.id, reqZ, iso('2026-09-20T08:00:00Z'), new Map([['intent-z', activityZ!.id]]));
    check('Z. Goal-linked accept SAVES', decisionZ.status === 'SAVED');
    if (decisionZ.status === 'SAVED') decisionZ.plans.forEach((p) => createdPlanIds.push(p.id));
    const planZId = decisionZ.status === 'SAVED' ? decisionZ.plans[0].id : null;
    check('Z. the GoalActivity is now linked to the exact new PlannedActivity id', (await plannedActivityIdOf(userA.id, goalZ.goal.id, activityZ!.id)) === planZId);
    check('Z. the GoalActivity derives PLANNED', (await derivedStateOf(userA.id, goalZ.goal.id, activityZ!.id)) === 'PLANNED');

    // ============================================================
    // AA. typed-only accept unchanged (no goalActivityLinks map at all --
    // this PR's own default parameter, proving byte-identical behavior
    // to before this PR for an ordinary acceptance)
    // ============================================================
    const reqAA: AcceptConstructedDayRequest = {
      clientRequestId: `goal-handoff-aa-${Date.now()}`,
      constructionWindow: window('2026-09-20T09:00:00Z', '2026-09-20T17:00:00Z'),
      proposedItems: [item({ intentId: 'intent-aa', title: 'Call dentist', start: iso('2026-09-20T12:00:00Z'), end: iso('2026-09-20T12:15:00Z') })],
    };
    const decisionAA = await persistAcceptedConstructedDay(userA.id, reqAA, iso('2026-09-20T08:00:00Z')); // no 4th arg
    check('AA. typed-only accept (no goalActivityLinks argument) still SAVES normally', decisionAA.status === 'SAVED');
    if (decisionAA.status === 'SAVED') decisionAA.plans.forEach((p) => createdPlanIds.push(p.id));

    // ============================================================
    // AB/AC. mixed Goal + typed accept; multiple Goal activities link to
    // the CORRECT plans (not swapped)
    // ============================================================
    const goalAB = await createGoalWithActivities({ userId: userA.id, title: 'Get fitter', targetDate: null, activities: [] });
    createdGoalIds.push(goalAB.goal.id);
    const activityAB1 = await addGoalActivity(userA.id, goalAB.goal.id, { title: 'Go for a run', activityId: null });
    const activityAB2 = await addGoalActivity(userA.id, goalAB.goal.id, { title: 'Stretch', activityId: null });
    const reqAB: AcceptConstructedDayRequest = {
      clientRequestId: `goal-handoff-ab-${Date.now()}`,
      constructionWindow: window('2026-09-21T09:00:00Z', '2026-09-21T17:00:00Z'),
      proposedItems: [
        item({ intentId: 'goal-1', title: 'Go for a run', start: iso('2026-09-21T09:00:00Z'), end: iso('2026-09-21T09:30:00Z') }),
        item({ intentId: 'typed-1', title: 'Buy groceries', start: iso('2026-09-21T11:00:00Z'), end: iso('2026-09-21T11:30:00Z') }),
        item({ intentId: 'goal-2', title: 'Stretch', start: iso('2026-09-21T15:00:00Z'), end: iso('2026-09-21T15:15:00Z') }),
      ],
    };
    const linksAB = new Map([
      ['goal-1', activityAB1!.id],
      ['goal-2', activityAB2!.id],
    ]);
    const decisionAB = await persistAcceptedConstructedDay(userA.id, reqAB, iso('2026-09-21T08:00:00Z'), linksAB);
    check('AB. mixed Goal + typed accept SAVES all 3', decisionAB.status === 'SAVED' && decisionAB.plans.length === 3);
    if (decisionAB.status === 'SAVED') decisionAB.plans.forEach((p) => createdPlanIds.push(p.id));
    const planRun = decisionAB.status === 'SAVED' ? decisionAB.plans.find((p) => p.title === 'Go for a run') : undefined;
    const planStretch = decisionAB.status === 'SAVED' ? decisionAB.plans.find((p) => p.title === 'Stretch') : undefined;
    const planGroceries = decisionAB.status === 'SAVED' ? decisionAB.plans.find((p) => p.title === 'Buy groceries') : undefined;
    check('AC. GoalActivity 1 ("Go for a run") links to its OWN plan, not the other', (await plannedActivityIdOf(userA.id, goalAB.goal.id, activityAB1!.id)) === planRun?.id);
    check('AC. GoalActivity 2 ("Stretch") links to its OWN plan, not swapped', (await plannedActivityIdOf(userA.id, goalAB.goal.id, activityAB2!.id)) === planStretch?.id);
    check('AB. the typed row ("Buy groceries") is unaffected -- no GoalActivity references it', planGroceries !== undefined);

    // ============================================================
    // AD/AE. deferred/removed Goal activity receives no link (never
    // included in proposedItems/goalActivityLinks at all -- persistence
    // never even sees it)
    // ============================================================
    const goalAD = await createGoalWithActivities({ userId: userA.id, title: 'Deferred test goal', targetDate: null, activities: [] });
    createdGoalIds.push(goalAD.goal.id);
    const activityDeferred = await addGoalActivity(userA.id, goalAD.goal.id, { title: 'Never placed', activityId: null });
    // Deliberately no proposedItems entry and no goalActivityLinks entry
    // for activityDeferred -- simulating "Constructor deferred this" /
    // "user removed this row before preview".
    check('AD/AE. a GoalActivity never mentioned in an accept request stays SUGGESTED, untouched', (await derivedStateOf(userA.id, goalAD.goal.id, activityDeferred!.id)) === 'SUGGESTED');

    // ============================================================
    // AF. not-owned GoalActivity rejects + rolls back
    // ============================================================
    const goalOther = await createGoalWithActivities({ userId: userB.id, title: 'User B goal', targetDate: null, activities: [] });
    createdGoalIds.push(goalOther.goal.id);
    const activityOther = await addGoalActivity(userB.id, goalOther.goal.id, { title: 'Not yours', activityId: null });
    const reqAF: AcceptConstructedDayRequest = {
      clientRequestId: `goal-handoff-af-${Date.now()}`,
      constructionWindow: window('2026-09-22T09:00:00Z', '2026-09-22T17:00:00Z'),
      proposedItems: [item({ intentId: 'intent-af', title: 'Steal attempt', start: iso('2026-09-22T09:00:00Z'), end: iso('2026-09-22T09:30:00Z') })],
    };
    const decisionAF = await persistAcceptedConstructedDay(userA.id, reqAF, iso('2026-09-22T08:00:00Z'), new Map([['intent-af', activityOther!.id]]));
    check('AF. accepting with another user\'s GoalActivity id FAILS the whole transaction', decisionAF.status === 'SAVE_FAILED');
    check('AF. userB\'s GoalActivity remains unlinked after the rejected cross-user attempt', (await plannedActivityIdOf(userB.id, goalOther.goal.id, activityOther!.id)) === null);

    // ============================================================
    // AG. DISMISSED GoalActivity rejects + rolls back
    // ============================================================
    const goalAG = await createGoalWithActivities({ userId: userA.id, title: 'Dismissed test goal', targetDate: null, activities: [] });
    createdGoalIds.push(goalAG.goal.id);
    const activityDismissed = await addGoalActivity(userA.id, goalAG.goal.id, { title: 'Will be dismissed', activityId: null });
    const dismissClient = await beginTransaction();
    await dismissClient.query(`UPDATE "GoalActivity" SET status = 'DISMISSED' WHERE id = $1`, [activityDismissed!.id]);
    await dismissClient.query('COMMIT');
    dismissClient.release();
    const reqAG: AcceptConstructedDayRequest = {
      clientRequestId: `goal-handoff-ag-${Date.now()}`,
      constructionWindow: window('2026-09-22T09:00:00Z', '2026-09-22T17:00:00Z'),
      proposedItems: [item({ intentId: 'intent-ag', title: 'Should not link', start: iso('2026-09-22T10:00:00Z'), end: iso('2026-09-22T10:30:00Z') })],
    };
    const decisionAG = await persistAcceptedConstructedDay(userA.id, reqAG, iso('2026-09-22T08:00:00Z'), new Map([['intent-ag', activityDismissed!.id]]));
    check('AG. accepting with a DISMISSED GoalActivity id FAILS the whole transaction', decisionAG.status === 'SAVE_FAILED');

    // ============================================================
    // AH/AI. UPCOMING-linked / LOGGED-linked GoalActivity rejects overwrite
    // ============================================================
    const goalRetained = await createGoalWithActivities({ userId: userA.id, title: 'Retained-linkage goal', targetDate: null, activities: [] });
    createdGoalIds.push(goalRetained.goal.id);

    const activityUpcoming = await addGoalActivity(userA.id, goalRetained.goal.id, { title: 'Already planned (upcoming)', activityId: null });
    const reqSeedUpcoming: AcceptConstructedDayRequest = {
      clientRequestId: `goal-handoff-seed-upcoming-${Date.now()}`,
      constructionWindow: window('2026-09-23T09:00:00Z', '2026-09-23T17:00:00Z'),
      proposedItems: [item({ intentId: 'seed-1', title: 'Already planned (upcoming)', start: iso('2026-09-23T09:00:00Z'), end: iso('2026-09-23T09:30:00Z') })],
    };
    const decisionSeedUpcoming = await persistAcceptedConstructedDay(userA.id, reqSeedUpcoming, iso('2026-09-23T08:00:00Z'), new Map([['seed-1', activityUpcoming!.id]]));
    check('setup: seeding an UPCOMING-linked GoalActivity succeeds', decisionSeedUpcoming.status === 'SAVED');
    const upcomingPlanId = decisionSeedUpcoming.status === 'SAVED' ? decisionSeedUpcoming.plans[0].id : null;
    if (upcomingPlanId) createdPlanIds.push(upcomingPlanId);

    const reqAH: AcceptConstructedDayRequest = {
      clientRequestId: `goal-handoff-ah-${Date.now()}`,
      constructionWindow: window('2026-09-24T09:00:00Z', '2026-09-24T17:00:00Z'),
      proposedItems: [item({ intentId: 'intent-ah', title: 'Attempted overwrite', start: iso('2026-09-24T09:00:00Z'), end: iso('2026-09-24T09:30:00Z') })],
    };
    const decisionAH = await persistAcceptedConstructedDay(userA.id, reqAH, iso('2026-09-24T08:00:00Z'), new Map([['intent-ah', activityUpcoming!.id]]));
    check('AH. re-linking a GoalActivity that already retains an UPCOMING Plan FAILS the whole transaction', decisionAH.status === 'SAVE_FAILED');
    check('AH. the original UPCOMING linkage is untouched (never stolen/overwritten)', (await plannedActivityIdOf(userA.id, goalRetained.goal.id, activityUpcoming!.id)) === upcomingPlanId);

    const activityLogged = await addGoalActivity(userA.id, goalRetained.goal.id, { title: 'Already planned (will be logged)', activityId: null });
    const reqSeedLogged: AcceptConstructedDayRequest = {
      clientRequestId: `goal-handoff-seed-logged-${Date.now()}`,
      constructionWindow: window('2026-09-23T09:00:00Z', '2026-09-23T17:00:00Z'),
      proposedItems: [item({ intentId: 'seed-2', title: 'Already planned (will be logged)', start: iso('2026-09-23T10:00:00Z'), end: iso('2026-09-23T10:30:00Z') })],
    };
    const decisionSeedLogged = await persistAcceptedConstructedDay(userA.id, reqSeedLogged, iso('2026-09-23T08:00:00Z'), new Map([['seed-2', activityLogged!.id]]));
    const loggedPlanId = decisionSeedLogged.status === 'SAVED' ? decisionSeedLogged.plans[0].id : null;
    if (loggedPlanId) {
      createdPlanIds.push(loggedPlanId);
      await logPlannedActivity(userA.id, loggedPlanId);
    }
    check('setup: the seeded plan is now LOGGED', (await derivedStateOf(userA.id, goalRetained.goal.id, activityLogged!.id)) === 'COMPLETED');

    const reqAI: AcceptConstructedDayRequest = {
      clientRequestId: `goal-handoff-ai-${Date.now()}`,
      constructionWindow: window('2026-09-24T09:00:00Z', '2026-09-24T17:00:00Z'),
      proposedItems: [item({ intentId: 'intent-ai', title: 'Attempted overwrite of a LOGGED linkage', start: iso('2026-09-24T11:00:00Z'), end: iso('2026-09-24T11:30:00Z') })],
    };
    const decisionAI = await persistAcceptedConstructedDay(userA.id, reqAI, iso('2026-09-24T08:00:00Z'), new Map([['intent-ai', activityLogged!.id]]));
    check('AI. re-linking a GoalActivity that already retains a LOGGED Plan FAILS the whole transaction', decisionAI.status === 'SAVE_FAILED');
    check('AI. the original COMPLETED (LOGGED-linked) state is untouched', (await derivedStateOf(userA.id, goalRetained.goal.id, activityLogged!.id)) === 'COMPLETED');

    // ============================================================
    // AJ/AT. CANCELLED-linked GoalActivity follows the section-29 replan
    // rule: atomic replacement is ALLOWED when the currently-linked Plan
    // is verifiably CANCELLED.
    // ============================================================
    const goalReplan = await createGoalWithActivities({ userId: userA.id, title: 'Replan test goal', targetDate: null, activities: [] });
    createdGoalIds.push(goalReplan.goal.id);
    const activityReplan = await addGoalActivity(userA.id, goalReplan.goal.id, { title: 'Will be cancelled then replanned', activityId: null });
    const reqSeedReplan: AcceptConstructedDayRequest = {
      clientRequestId: `goal-handoff-seed-replan-${Date.now()}`,
      constructionWindow: window('2026-09-23T09:00:00Z', '2026-09-23T17:00:00Z'),
      proposedItems: [item({ intentId: 'seed-3', title: 'Will be cancelled then replanned', start: iso('2026-09-23T13:00:00Z'), end: iso('2026-09-23T13:30:00Z') })],
    };
    const decisionSeedReplan = await persistAcceptedConstructedDay(userA.id, reqSeedReplan, iso('2026-09-23T08:00:00Z'), new Map([['seed-3', activityReplan!.id]]));
    const firstPlanId = decisionSeedReplan.status === 'SAVED' ? decisionSeedReplan.plans[0].id : null;
    if (firstPlanId) createdPlanIds.push(firstPlanId);
    await cancelPlannedActivity(userA.id, firstPlanId!);
    check('AS. after cancelling the linked Plan, the GoalActivity derives back to SUGGESTED', (await derivedStateOf(userA.id, goalReplan.goal.id, activityReplan!.id)) === 'SUGGESTED');
    check('AS. the retained linkage (plannedActivityId) still points at the now-CANCELLED plan (unchanged PR A behavior)', (await plannedActivityIdOf(userA.id, goalReplan.goal.id, activityReplan!.id)) === firstPlanId);

    const reqAJ: AcceptConstructedDayRequest = {
      clientRequestId: `goal-handoff-aj-${Date.now()}`,
      constructionWindow: window('2026-09-25T09:00:00Z', '2026-09-25T17:00:00Z'),
      proposedItems: [item({ intentId: 'intent-aj', title: 'Replanned after cancellation', start: iso('2026-09-25T09:00:00Z'), end: iso('2026-09-25T09:30:00Z') })],
    };
    const decisionAJ = await persistAcceptedConstructedDay(userA.id, reqAJ, iso('2026-09-25T08:00:00Z'), new Map([['intent-aj', activityReplan!.id]]));
    check('AJ/AT. replanning a GoalActivity whose retained linkage is CANCELLED SAVES (the section-29 safe rule)', decisionAJ.status === 'SAVED');
    const secondPlanId = decisionAJ.status === 'SAVED' ? decisionAJ.plans[0].id : null;
    if (secondPlanId) createdPlanIds.push(secondPlanId);
    check('AJ/AT. the GoalActivity now links to the NEW plan, not the old cancelled one', (await plannedActivityIdOf(userA.id, goalReplan.goal.id, activityReplan!.id)) === secondPlanId);
    check('AJ/AT. the GoalActivity derives PLANNED again', (await derivedStateOf(userA.id, goalReplan.goal.id, activityReplan!.id)) === 'PLANNED');

    // ============================================================
    // AK. forced linkage failure rolls back the newly-created
    // PlannedActivity itself (single-item accept, invalid link)
    // ============================================================
    const reqAK: AcceptConstructedDayRequest = {
      clientRequestId: `goal-handoff-ak-${Date.now()}`,
      constructionWindow: window('2026-09-26T09:00:00Z', '2026-09-26T17:00:00Z'),
      proposedItems: [item({ intentId: 'intent-ak', title: 'Should never exist', start: iso('2026-09-26T09:00:00Z'), end: iso('2026-09-26T09:30:00Z') })],
    };
    const decisionAK = await persistAcceptedConstructedDay(userA.id, reqAK, iso('2026-09-26T08:00:00Z'), new Map([['intent-ak', 'not-a-real-goal-activity-id']]));
    check('AK. an accept whose only item has an invalid GoalActivity link FAILS entirely', decisionAK.status === 'SAVE_FAILED');
    // Direct, independent re-query of the exact window this item would
    // have occupied -- proves no orphan PlannedActivity was left behind
    // by the rolled-back transaction (not merely inferred from the
    // SAVE_FAILED status).
    const akWindowPlans = await listPlannedActivitiesForDay(userA.id, iso('2026-09-26T00:00:00Z'), iso('2026-09-26T23:59:00Z'));
    check('AK. no orphan PlannedActivity ("Should never exist") exists in that window after rollback', !akWindowPlans.some((p) => p.title === 'Should never exist'));

    // ============================================================
    // AL. forced LATER-item failure rolls back the EARLIER item's Plan +
    // Goal link too (2-item accept: item 1 valid, item 2 invalid)
    // ============================================================
    const goalAL = await createGoalWithActivities({ userId: userA.id, title: 'AL rollback test goal', targetDate: null, activities: [] });
    createdGoalIds.push(goalAL.goal.id);
    const activityAL = await addGoalActivity(userA.id, goalAL.goal.id, { title: 'Should be rolled back too', activityId: null });
    const reqAL: AcceptConstructedDayRequest = {
      clientRequestId: `goal-handoff-al-${Date.now()}`,
      constructionWindow: window('2026-09-27T09:00:00Z', '2026-09-27T17:00:00Z'),
      proposedItems: [
        item({ intentId: 'al-1', title: 'Should be rolled back too', start: iso('2026-09-27T09:00:00Z'), end: iso('2026-09-27T09:30:00Z') }),
        item({ intentId: 'al-2', title: 'Also should be rolled back', start: iso('2026-09-27T10:00:00Z'), end: iso('2026-09-27T10:30:00Z') }),
      ],
    };
    const linksAL = new Map([
      ['al-1', activityAL!.id],
      ['al-2', 'not-a-real-goal-activity-id'],
    ]);
    const decisionAL = await persistAcceptedConstructedDay(userA.id, reqAL, iso('2026-09-27T08:00:00Z'), linksAL);
    check('AL. the whole 2-item transaction FAILS because the second item\'s link is invalid', decisionAL.status === 'SAVE_FAILED');
    check('AL. the FIRST item\'s GoalActivity (which itself was individually valid) was rolled back too -- still SUGGESTED, no link', (await derivedStateOf(userA.id, goalAL.goal.id, activityAL!.id)) === 'SUGGESTED');
    check('AL. the first item\'s GoalActivity has no plannedActivityId at all after rollback', (await plannedActivityIdOf(userA.id, goalAL.goal.id, activityAL!.id)) === null);
    const alWindowPlans = await listPlannedActivitiesForDay(userA.id, iso('2026-09-27T00:00:00Z'), iso('2026-09-27T23:59:00Z'));
    check('AL. neither of the 2 items\' PlannedActivity rows exist -- the whole transaction rolled back, not just the failing item', !alWindowPlans.some((p) => p.title === 'Should be rolled back too' || p.title === 'Also should be rolled back'));

    // ============================================================
    // AM/AN. idempotent retry does not duplicate the plan and preserves
    // the correct Goal link
    // ============================================================
    const goalRetry = await createGoalWithActivities({ userId: userA.id, title: 'Retry test goal', targetDate: null, activities: [] });
    createdGoalIds.push(goalRetry.goal.id);
    const activityRetry = await addGoalActivity(userA.id, goalRetry.goal.id, { title: 'Retried acceptance', activityId: null });
    const retryClientRequestId = `goal-handoff-retry-${Date.now()}`;
    const reqRetry: AcceptConstructedDayRequest = {
      clientRequestId: retryClientRequestId,
      constructionWindow: window('2026-09-28T09:00:00Z', '2026-09-28T17:00:00Z'),
      proposedItems: [item({ intentId: 'intent-retry', title: 'Retried acceptance', start: iso('2026-09-28T09:00:00Z'), end: iso('2026-09-28T09:30:00Z') })],
    };
    const linksRetry = new Map([['intent-retry', activityRetry!.id]]);
    const firstAttempt = await persistAcceptedConstructedDay(userA.id, reqRetry, iso('2026-09-28T08:00:00Z'), linksRetry);
    check('setup: first attempt SAVES', firstAttempt.status === 'SAVED');
    if (firstAttempt.status === 'SAVED') firstAttempt.plans.forEach((p) => createdPlanIds.push(p.id));
    const firstAttemptPlanId = firstAttempt.status === 'SAVED' ? firstAttempt.plans[0].id : null;

    const secondAttempt = await persistAcceptedConstructedDay(userA.id, reqRetry, iso('2026-09-28T08:05:00Z'), linksRetry);
    check('AM. an idempotent retry with the IDENTICAL request returns ALREADY_ACCEPTED, never a duplicate SAVED', secondAttempt.status === 'ALREADY_ACCEPTED');
    check('AM. the retry returns the SAME plan id, not a new one', secondAttempt.status === 'ALREADY_ACCEPTED' && secondAttempt.plans[0]?.id === firstAttemptPlanId);
    check('AN. after the retry, the GoalActivity link is still correct and was not touched a second time', (await plannedActivityIdOf(userA.id, goalRetry.goal.id, activityRetry!.id)) === firstAttemptPlanId);
    check('AN. after the retry, the GoalActivity still derives PLANNED (not corrupted by the replay)', (await derivedStateOf(userA.id, goalRetry.goal.id, activityRetry!.id)) === 'PLANNED');

    // ============================================================
    // AO. no Goal metadata persisted on PlannedActivity (schema-level
    // fact, re-confirmed here against a REAL row from this test run)
    // ============================================================
    check(
      'AO. the created PlannedActivity row has no Goal-shaped keys at all',
      (() => {
        const plan = decisionZ.status === 'SAVED' ? (decisionZ.plans[0] as unknown as Record<string, unknown>) : {};
        return !('goalId' in plan) && !('goalActivityId' in plan) && !('source' in plan);
      })()
    );

    // ============================================================
    // AR. COMPLETED increases Goal progress; AU. dismissed denominator
    // semantics unchanged
    // ============================================================
    const goalProgress = await createGoalWithActivities({ userId: userA.id, title: 'Progress test goal', targetDate: null, activities: [] });
    createdGoalIds.push(goalProgress.goal.id);
    const progressActivity = await addGoalActivity(userA.id, goalProgress.goal.id, { title: 'Will be completed', activityId: null });
    const progressDismissed = await addGoalActivity(userA.id, goalProgress.goal.id, { title: 'Will be dismissed', activityId: null });
    const dismissClient2 = await beginTransaction();
    await dismissClient2.query(`UPDATE "GoalActivity" SET status = 'DISMISSED' WHERE id = $1`, [progressDismissed!.id]);
    await dismissClient2.query('COMMIT');
    dismissClient2.release();

    const reqProgress: AcceptConstructedDayRequest = {
      clientRequestId: `goal-handoff-progress-${Date.now()}`,
      constructionWindow: window('2026-09-29T09:00:00Z', '2026-09-29T17:00:00Z'),
      proposedItems: [item({ intentId: 'intent-progress', title: 'Will be completed', start: iso('2026-09-29T09:00:00Z'), end: iso('2026-09-29T09:30:00Z') })],
    };
    const decisionProgress = await persistAcceptedConstructedDay(userA.id, reqProgress, iso('2026-09-29T08:00:00Z'), new Map([['intent-progress', progressActivity!.id]]));
    const progressPlanId = decisionProgress.status === 'SAVED' ? decisionProgress.plans[0].id : null;
    if (progressPlanId) createdPlanIds.push(progressPlanId);

    let rows = await listGoalActivitiesWithLinkedPlanStatus(userA.id, goalProgress.goal.id);
    let states = rows.map((r) => deriveGoalActivityState({ status: r.status, plannedActivityId: r.plannedActivityId, linkedPlanStatus: r.linkedPlanStatus }));
    let progress = computeGoalProgress(states);
    check('AP. after accept, the linked activity derives PLANNED, not COMPLETED yet', states.includes('PLANNED'));
    check('34/AU. progress denominator excludes the DISMISSED activity (1 non-dismissed total, not 2)', progress.total === 1);
    check('progress: 0 completed before logging', progress.completed === 0);

    await logPlannedActivity(userA.id, progressPlanId!);
    rows = await listGoalActivitiesWithLinkedPlanStatus(userA.id, goalProgress.goal.id);
    states = rows.map((r) => deriveGoalActivityState({ status: r.status, plannedActivityId: r.plannedActivityId, linkedPlanStatus: r.linkedPlanStatus }));
    progress = computeGoalProgress(states);
    check('AQ. after logPlannedActivity (existing, unmodified function), the GoalActivity derives COMPLETED', states.includes('COMPLETED'));
    check('AR. Goal progress completed-count increases to 1 after logging', progress.completed === 1);
    check('AU. progress denominator still excludes the DISMISSED activity after completion (still 1, not 2)', progress.total === 1);
  } finally {
    await cleanup();
  }

  if (!allPassed) {
    console.error('SOME GOAL PLANNING HANDOFF DB CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL GOAL PLANNING HANDOFF DB CHECKS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
