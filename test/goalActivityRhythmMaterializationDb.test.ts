/**
 * Goals V2 Rhythm R3 -- live-database proof of occurrence materialization
 * through the REAL Plan with Aura acceptance path
 * (`persistAcceptedConstructedDay`), covering first/second occurrence
 * creation, capacity exhaustion, week reset, skip, Move, Recomposition
 * Move, concurrency, retry/idempotency, user isolation and mixed
 * NONE/Rhythm requests. Exercised directly against
 * `persistAcceptedConstructedDay` (bypassing HTTP) -- same established
 * convention as goalPlanningHandoffDb.test.ts and
 * dayConstructorAcceptancePersistenceDb.test.ts, both of which already
 * prove this exact level is the right one for forcing every
 * ROLLBACK/ownership/eligibility path deterministically.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/goalActivityRhythmMaterializationDb.test.ts
 */
import {
  upsertUserByEmail,
  updateBirthProfile,
  createGoalWithActivities,
  addGoalActivity,
  deleteGoal,
  listGoalActivitiesWithLinkedPlanStatus,
  logPlannedActivity,
  skipPlannedActivity,
  cancelPlannedActivity,
  deletePlannedActivity,
  beginTransaction,
} from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import type { AcceptConstructedDayRequest, AcceptedProposedItem } from '../apps/web/lib/dayConstructorAcceptance';
import { movePlannedActivity } from '../apps/web/lib/planMove';
import { signRecompositionProposal } from '../apps/web/lib/remainingDayRecompositionIntegrity';
import { acceptRemainingDayRecomposition, realRecompositionAcceptanceDeps } from '../apps/web/lib/remainingDayRecompositionAcceptance';
import { deriveGoalActivityState } from '../apps/web/lib/goals';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const MIN = 60000;

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

const occurrencesFor = (goalActivityId: string) => sql(`SELECT id, "plannedActivityId" FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1 ORDER BY "createdAt"`, [goalActivityId]);
const currentPlanIdOf = async (userId: string, goalId: string, goalActivityId: string): Promise<string | null> => {
  const rows = await listGoalActivitiesWithLinkedPlanStatus(userId, goalId);
  return rows.find((r) => r.id === goalActivityId)?.plannedActivityId ?? null;
};
const planStatus = async (planId: string): Promise<string> => (await sql(`SELECT status FROM "PlannedActivity" WHERE id = $1`, [planId]))[0].status;

async function main() {
  const user = await upsertUserByEmail({ email: 'test-goal-activity-rhythm-materialization@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const other = await upsertUserByEmail({ email: 'test-goal-activity-rhythm-materialization-other@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await updateBirthProfile(user.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });

  const createdGoalIds: string[] = [];
  const cleanup = async () => {
    for (const goalId of createdGoalIds) {
      await deleteGoal(user.id, goalId).catch(() => {});
      await deleteGoal(other.id, goalId).catch(() => {});
    }
    // Disposable test data -- clear whatever remains regardless of status
    // (same convention already established across this session's own
    // Rhythm test files for exactly this reason: cleanup must not be
    // blocked by a SKIPPED/UPCOMING row deletePlannedActivity won't touch).
    await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = NULL WHERE "userId" = ANY($1::text[])`, [[user.id, other.id]]);
    await sql(`UPDATE "PlannedActivity" SET "rescheduledFromPlanId" = NULL WHERE "userId" = ANY($1::text[])`, [[user.id, other.id]]);
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])`, [[user.id, other.id]]);
  };
  await cleanup(); // purge any leftovers from a prior interrupted run against the same upserted users

  try {
    const { goal } = await createGoalWithActivities({ userId: user.id, title: 'Meditate regularly (R3 fixture)', targetDate: null, activities: [] });
    createdGoalIds.push(goal.id);

    // ============================================================
    // 47. FIRST RHYTHM OCCURRENCE -- N_PER_WEEK 3, 0 completed, 0 committed
    // ============================================================
    const ga47 = await addGoalActivity(user.id, goal.id, { title: 'Meditate 10 minutes', activityId: null });
    await setRhythm(ga47!.id, 3);
    const req47: AcceptConstructedDayRequest = {
      clientRequestId: `rhythm-47-${Date.now()}`,
      constructionWindow: window('2026-09-22', '2026-09-22T09:00:00Z', '2026-09-22T17:00:00Z'),
      proposedItems: [item({ intentId: 'intent-47', start: iso('2026-09-22T10:00:00Z'), end: iso('2026-09-22T10:10:00Z') })],
    };
    const decision47 = await persistAcceptedConstructedDay(user.id, req47, iso('2026-09-22T08:00:00Z'), new Map([['intent-47', ga47!.id]]));
    check('47. first Rhythm occurrence: SAVED', decision47.status === 'SAVED');
    const plan47 = decision47.status === 'SAVED' ? decision47.plans[0] : null;
    const occs47 = await occurrencesFor(ga47!.id);
    check('47. exactly ONE GoalActivityOccurrence row exists', occs47.length === 1);
    check('47. the occurrence points to the new plan', occs47[0].plannedActivityId === plan47?.id);
    check('47. GoalActivity.plannedActivityId points to the new plan', (await currentPlanIdOf(user.id, goal.id, ga47!.id)) === plan47?.id);
    check('47. no additional occurrences were created', occs47.length === 1);

    // ============================================================
    // 48. SECOND OCCURRENCE -- same week, after completing the first
    // ============================================================
    await logPlannedActivity(user.id, plan47!.id);
    const req48: AcceptConstructedDayRequest = {
      clientRequestId: `rhythm-48-${Date.now()}`,
      constructionWindow: window('2026-09-23', '2026-09-23T09:00:00Z', '2026-09-23T17:00:00Z'),
      proposedItems: [item({ intentId: 'intent-48', start: iso('2026-09-23T10:00:00Z'), end: iso('2026-09-23T10:10:00Z') })],
    };
    const decision48 = await persistAcceptedConstructedDay(user.id, req48, iso('2026-09-23T08:00:00Z'), new Map([['intent-48', ga47!.id]]));
    check('48. second Rhythm occurrence (completed = 1, committed = 0, remaining = 2): SAVED', decision48.status === 'SAVED');
    const plan48 = decision48.status === 'SAVED' ? decision48.plans[0] : null;
    const occs48 = await occurrencesFor(ga47!.id);
    check('48. exactly TWO occurrences exist total', occs48.length === 2);
    check('48. O1 still points to P1 (now LOGGED)', occs48[0].plannedActivityId === plan47!.id && (await planStatus(plan47!.id)) === 'LOGGED');
    check('48. O2 points to P2 (UPCOMING)', occs48[1].plannedActivityId === plan48?.id && (await planStatus(plan48!.id)) === 'UPCOMING');
    check('48. GoalActivity now points to P2', (await currentPlanIdOf(user.id, goal.id, ga47!.id)) === plan48?.id);

    // ============================================================
    // 49. CAPACITY EXHAUSTION -- N_PER_WEEK 2, attempt a 3rd in the same week
    // ============================================================
    const ga49 = await addGoalActivity(user.id, goal.id, { title: 'Meditate 10 minutes', activityId: null });
    await setRhythm(ga49!.id, 2);
    const d49a = await makeOccurrenceFor(ga49!.id, 'intent-49a', '2026-09-22T10:30:00Z', '2026-09-22T10:40:00Z', '2026-09-22');
    check('49. setup: first of 2/week SAVED', d49a.status === 'SAVED');
    await logPlannedActivity(user.id, (d49a as any).plans[0].id);
    const d49b = await makeOccurrenceFor(ga49!.id, 'intent-49b', '2026-09-23T10:30:00Z', '2026-09-23T10:40:00Z', '2026-09-23');
    check('49. setup: second of 2/week SAVED', d49b.status === 'SAVED');
    await logPlannedActivity(user.id, (d49b as any).plans[0].id);
    const planIdBeforeExhaustion = await currentPlanIdOf(user.id, goal.id, ga49!.id);
    const occsBeforeExhaustion = await occurrencesFor(ga49!.id);
    const d49c = await makeOccurrenceFor(ga49!.id, 'intent-49c', '2026-09-24T10:30:00Z', '2026-09-24T10:40:00Z', '2026-09-24');
    check('49. a THIRD occurrence in the same week FAILS the whole transaction (capacity exhausted)', d49c.status === 'SAVE_FAILED');
    check('49. no third PlannedActivity was created for this intent', (await sql(`SELECT count(*)::int n FROM "PlannedActivity" WHERE "userId" = $1 AND "plannedStartAt" = $2`, [user.id, iso('2026-09-24T10:00:00Z')]))[0].n === 0);
    check('49. no third occurrence was created', (await occurrencesFor(ga49!.id)).length === occsBeforeExhaustion.length);
    check('49. GoalActivity pointer was not mutated by the failed attempt', (await currentPlanIdOf(user.id, goal.id, ga49!.id)) === planIdBeforeExhaustion);

    // ============================================================
    // 50. WEEK RESET -- 2 prior-week completions, plan in the NEW week
    // ============================================================
    const d50new = await makeOccurrenceFor(ga49!.id, 'intent-50new', '2026-09-29T10:00:00Z', '2026-09-29T10:10:00Z', '2026-09-29'); // Tuesday of the NEXT week
    check('50. a new week resets capacity -- one new occurrence allowed with no debt/rollover from the exhausted prior week', d50new.status === 'SAVED');
    check('50. three occurrences total now exist for this GoalActivity (2 prior week + 1 new week)', (await occurrencesFor(ga49!.id)).length === 3);

    // ============================================================
    // 51. SKIP -- a skipped occurrence does not block/revive, a new one is created
    // ============================================================
    const ga51 = await addGoalActivity(user.id, goal.id, { title: 'Meditate 10 minutes', activityId: null });
    await setRhythm(ga51!.id, 3);
    const d51a = await makeOccurrenceFor(ga51!.id, 'intent-51a', '2026-09-22T11:00:00Z', '2026-09-22T11:10:00Z', '2026-09-22');
    const plan51a = (d51a as any).plans[0];
    await skipPlannedActivity(user.id, plan51a.id);
    const d51b = await makeOccurrenceFor(ga51!.id, 'intent-51b', '2026-09-23T11:00:00Z', '2026-09-23T11:10:00Z', '2026-09-23');
    check('51. planning again after a SKIP succeeds (skip does not consume/carry capacity)', d51b.status === 'SAVED');
    const occs51 = await occurrencesFor(ga51!.id);
    check('51. O1/P1 remains historical SKIPPED, untouched', occs51[0].plannedActivityId === plan51a.id && (await planStatus(plan51a.id)) === 'SKIPPED');
    check('51. O2/P2 was created as a genuinely NEW occurrence', occs51.length === 2 && occs51[1].plannedActivityId === (d51b as any).plans[0].id);

    // ============================================================
    // 52. MOVE -- same occurrence repoints A -> B; no new occurrence
    // ============================================================
    const ga52 = await addGoalActivity(user.id, goal.id, { title: 'Meditate 10 minutes', activityId: null });
    await setRhythm(ga52!.id, 5);
    // A REAL near-future instant (movePlannedActivity validates against the
    // real wall clock, independent of any test-injected `now`).
    const moveBase = Math.ceil((Date.now() + 2 * 3600000) / MIN) * MIN;
    const moveWindowDate = new Date(moveBase).toISOString().slice(0, 10);
    const d52 = await (async () => {
      const req: AcceptConstructedDayRequest = {
        clientRequestId: `rhythm-52-${Date.now()}`,
        constructionWindow: window(moveWindowDate, new Date(moveBase - 3600000).toISOString(), new Date(moveBase + 24 * 3600000).toISOString()),
        proposedItems: [item({ intentId: 'intent-52', start: new Date(moveBase), end: new Date(moveBase + 10 * MIN) })],
      };
      return persistAcceptedConstructedDay(user.id, req, new Date(moveBase - 1800000), new Map([['intent-52', ga52!.id]]));
    })();
    check('52. setup: Rhythm occurrence created for the Move test', d52.status === 'SAVED');
    const planA52 = (d52 as any).plans[0];
    const occBefore52 = (await occurrencesFor(ga52!.id))[0];
    const moveResult52 = await movePlannedActivity(user.id, planA52.id, { newStartAt: new Date(moveBase + 3 * 3600000) });
    const occAfter52 = (await occurrencesFor(ga52!.id))[0];
    check('52. the SAME occurrence id persists across the Move', occBefore52.id === occAfter52.id);
    check('52. the occurrence now points to the successor plan B', occAfter52.plannedActivityId === moveResult52.to.id);
    check('52. GoalActivity pointer also moved to B (existing G2.2.3 repoint, unaffected)', (await currentPlanIdOf(user.id, goal.id, ga52!.id)) === moveResult52.to.id);
    check('52. the original plan A remains MOVED (historical, untouched)', (await planStatus(planA52.id)) === 'MOVED');
    check('52. still exactly ONE occurrence row (no O2 created by the Move)', (await occurrencesFor(ga52!.id)).length === 1);

    // ============================================================
    // 53. RECOMPOSITION MOVE -- same occurrence repoints through accepted
    // Remaining-Day Recomposition; no second occurrence; no Rhythm logic
    // enters the recomposition decision itself (a plain, hand-signed MOVE
    // decision is accepted exactly like any other -- this file never
    // imports/consults Rhythm anywhere in that path).
    // ============================================================
    const ga53 = await addGoalActivity(user.id, goal.id, { title: 'Meditate 10 minutes', activityId: null });
    await setRhythm(ga53!.id, 5);
    const rcBase = Math.ceil((Date.now() + 8 * 3600000) / MIN) * MIN; // well clear of section 52's own B successor (moveBase + 3h = now + 5h)
    const rcWindowDate = new Date(rcBase).toISOString().slice(0, 10);
    const d53 = await (async () => {
      const req: AcceptConstructedDayRequest = {
        clientRequestId: `rhythm-53-${Date.now()}`,
        constructionWindow: window(rcWindowDate, new Date(rcBase - 3600000).toISOString(), new Date(rcBase + 24 * 3600000).toISOString()),
        proposedItems: [item({ intentId: 'intent-53', start: new Date(rcBase), end: new Date(rcBase + 10 * MIN) })],
      };
      return persistAcceptedConstructedDay(user.id, req, new Date(rcBase - 1800000), new Map([['intent-53', ga53!.id]]));
    })();
    check('53. setup: Rhythm occurrence created for the Recomposition Move test', d53.status === 'SAVED');
    const planA53 = (d53 as any).plans[0];
    const occBefore53 = (await occurrencesFor(ga53!.id))[0];
    const rcDecision = { decision: 'MOVE' as const, planId: planA53.id, title: planA53.title, current: { start: new Date(planA53.plannedStartAt), end: new Date(planA53.plannedEndAt) }, to: { start: new Date(rcBase + 3 * 3600000), end: new Date(rcBase + 3 * 3600000 + 10 * MIN) } };
    const rcToken = signRecompositionProposal(user.id, { generatedAt: new Date(), targetDate: rcWindowDate, timezone: TZ, summary: { state: 'CHANGES_PROPOSED' }, decisions: [rcDecision] } as any)!;
    const rcResult = await acceptRemainingDayRecomposition(user.id, rcToken, realRecompositionAcceptanceDeps);
    check('53. the Recomposition acceptance itself succeeded', rcResult.status === 'ACCEPTED');
    const occAfter53 = (await occurrencesFor(ga53!.id))[0];
    check('53. the SAME occurrence id persists across the Recomposition Move', occBefore53.id === occAfter53.id);
    const successor53 = rcResult.status === 'ACCEPTED' ? rcResult.moves[0].successorPlanId : null;
    check('53. the occurrence now points to the successor plan', occAfter53.plannedActivityId === successor53);
    check('53. still exactly ONE occurrence row (no second occurrence created)', (await occurrencesFor(ga53!.id)).length === 1);

    // ============================================================
    // 54. USER ISOLATION
    // ============================================================
    const ga54 = await addGoalActivity(user.id, goal.id, { title: 'Meditate 10 minutes', activityId: null });
    await setRhythm(ga54!.id, 3);
    const req54AsOther: AcceptConstructedDayRequest = {
      clientRequestId: `rhythm-54-${Date.now()}`,
      constructionWindow: window('2026-09-22', '2026-09-22T09:00:00Z', '2026-09-22T17:00:00Z'),
      proposedItems: [item({ intentId: 'intent-54', start: iso('2026-09-22T12:00:00Z'), end: iso('2026-09-22T12:10:00Z') })],
    };
    const decision54 = await persistAcceptedConstructedDay(other.id, req54AsOther, iso('2026-09-22T08:00:00Z'), new Map([['intent-54', ga54!.id]]));
    check('54. User B cannot plan User A\'s Rhythm GoalActivity -- the whole transaction FAILS', decision54.status === 'SAVE_FAILED');
    check('54. no occurrence was created for User A\'s GoalActivity by User B\'s attempt', (await occurrencesFor(ga54!.id)).length === 0);
    check('54. User A\'s GoalActivity remains unlinked/SUGGESTED, untouched', (await currentPlanIdOf(user.id, goal.id, ga54!.id)) === null);

    // ============================================================
    // 55. CONCURRENCY -- N_PER_WEEK 1, two concurrent materialization attempts
    // ============================================================
    const ga55 = await addGoalActivity(user.id, goal.id, { title: 'Meditate 10 minutes', activityId: null });
    await setRhythm(ga55!.id, 1);
    const req55a: AcceptConstructedDayRequest = {
      clientRequestId: `rhythm-55a-${Date.now()}`,
      constructionWindow: window('2026-09-22', '2026-09-22T06:00:00Z', '2026-09-22T20:00:00Z'),
      proposedItems: [item({ intentId: 'intent-55a', start: iso('2026-09-22T13:00:00Z'), end: iso('2026-09-22T13:10:00Z') })],
    };
    const req55b: AcceptConstructedDayRequest = {
      clientRequestId: `rhythm-55b-${Date.now()}`,
      constructionWindow: window('2026-09-22', '2026-09-22T06:00:00Z', '2026-09-22T20:00:00Z'),
      proposedItems: [item({ intentId: 'intent-55b', start: iso('2026-09-22T14:00:00Z'), end: iso('2026-09-22T14:10:00Z') })],
    };
    const [res55a, res55b] = await Promise.all([
      persistAcceptedConstructedDay(user.id, req55a, iso('2026-09-22T08:00:00Z'), new Map([['intent-55a', ga55!.id]])),
      persistAcceptedConstructedDay(user.id, req55b, iso('2026-09-22T08:00:00Z'), new Map([['intent-55b', ga55!.id]])),
    ]);
    const successes55 = [res55a, res55b].filter((r) => r.status === 'SAVED').length;
    const failures55 = [res55a, res55b].filter((r) => r.status === 'SAVE_FAILED').length;
    check('55. exactly ONE of the two concurrent requests for 1/week succeeds, the other deterministically fails (never both succeeding)', successes55 === 1 && failures55 === 1);
    check('55. exactly ONE occurrence exists after both concurrent attempts resolve (durable, not a timing-luck artifact)', (await occurrencesFor(ga55!.id)).length === 1);

    // ============================================================
    // 56. RETRY / IDEMPOTENCY -- the SAME logical request retried
    // ============================================================
    const ga56 = await addGoalActivity(user.id, goal.id, { title: 'Meditate 10 minutes', activityId: null });
    await setRhythm(ga56!.id, 2);
    const req56: AcceptConstructedDayRequest = {
      clientRequestId: `rhythm-56-${Date.now()}`,
      constructionWindow: window('2026-09-22', '2026-09-22T06:00:00Z', '2026-09-22T20:00:00Z'),
      proposedItems: [item({ intentId: 'intent-56', start: iso('2026-09-22T15:00:00Z'), end: iso('2026-09-22T15:10:00Z') })],
    };
    const firstAttempt56 = await persistAcceptedConstructedDay(user.id, req56, iso('2026-09-22T08:00:00Z'), new Map([['intent-56', ga56!.id]]));
    const secondAttempt56 = await persistAcceptedConstructedDay(user.id, req56, iso('2026-09-22T08:05:00Z'), new Map([['intent-56', ga56!.id]])); // identical clientRequestId+proposedItems
    check('56. first attempt SAVES', firstAttempt56.status === 'SAVED');
    check('56. an identical retry (same clientRequestId) returns ALREADY_ACCEPTED, never a second materialization', secondAttempt56.status === 'ALREADY_ACCEPTED');
    check('56. exactly ONE occurrence exists after the retry (the EXISTING PlanCreationIdempotency replay check, reused verbatim, prevents a duplicate)', (await occurrencesFor(ga56!.id)).length === 1);

    // ============================================================
    // 57. MIXED REQUEST -- one finite NONE activity + one eligible N_PER_WEEK
    // activity in the SAME acceptance
    // ============================================================
    const ga57Finite = await addGoalActivity(user.id, goal.id, { title: 'Block focus time', activityId: null }); // rhythmKind stays NULL -> NONE
    const ga57Rhythm = await addGoalActivity(user.id, goal.id, { title: 'Meditate 10 minutes', activityId: null });
    await setRhythm(ga57Rhythm!.id, 3);
    const req57: AcceptConstructedDayRequest = {
      clientRequestId: `rhythm-57-${Date.now()}`,
      constructionWindow: window('2026-09-22', '2026-09-22T06:00:00Z', '2026-09-22T20:00:00Z'),
      proposedItems: [
        item({ intentId: 'intent-57-finite', title: 'Block focus time', start: iso('2026-09-22T16:00:00Z'), end: iso('2026-09-22T17:00:00Z') }),
        item({ intentId: 'intent-57-rhythm', start: iso('2026-09-22T17:30:00Z'), end: iso('2026-09-22T17:40:00Z') }),
      ],
    };
    const decision57 = await persistAcceptedConstructedDay(user.id, req57, iso('2026-09-22T08:00:00Z'), new Map([['intent-57-finite', ga57Finite!.id], ['intent-57-rhythm', ga57Rhythm!.id]]));
    check('57. mixed NONE + N_PER_WEEK request SAVES both', decision57.status === 'SAVED' && (decision57 as any).plans.length === 2);
    check('57. the finite activity derives PLANNED, no occurrence row created for it', (await derivedStateOf(user.id, goal.id, ga57Finite!.id)) === 'PLANNED' && (await occurrencesFor(ga57Finite!.id)).length === 0);
    check('57. the Rhythm activity got exactly one occurrence', (await occurrencesFor(ga57Rhythm!.id)).length === 1);
  } finally {
    await cleanup();
  }

  if (!allPassed) {
    console.error('SOME GOAL ACTIVITY RHYTHM MATERIALIZATION DB CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL GOAL ACTIVITY RHYTHM MATERIALIZATION DB CHECKS PASSED');

  async function makeOccurrenceFor(goalActivityId: string, intentId: string, startIso: string, endIso: string, windowDate: string) {
    const req: AcceptConstructedDayRequest = {
      clientRequestId: `rhythm-${intentId}-${Date.now()}`,
      constructionWindow: window(windowDate, `${windowDate}T06:00:00Z`, `${windowDate}T20:00:00Z`),
      proposedItems: [item({ intentId, start: iso(startIso), end: iso(endIso) })],
    };
    return persistAcceptedConstructedDay(user.id, req, iso(`${windowDate}T05:00:00Z`), new Map([[intentId, goalActivityId]]));
  }
  async function derivedStateOf(userId: string, goalId: string, goalActivityId: string): Promise<string | null> {
    const rows = await listGoalActivitiesWithLinkedPlanStatus(userId, goalId);
    const row = rows.find((r) => r.id === goalActivityId);
    if (!row) return null;
    return deriveGoalActivityState({ status: row.status, plannedActivityId: row.plannedActivityId, linkedPlanStatus: row.linkedPlanStatus });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
