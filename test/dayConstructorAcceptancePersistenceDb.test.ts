/**
 * Live-database tests for Day Constructor V1 PR E2 -- the real atomic
 * acceptance-persistence transaction (`persistAcceptedConstructedDay`),
 * exercised end-to-end against a real Postgres connection: transaction
 * commit/rollback, the per-user advisory lock, real idempotency claim
 * rows, and real Plan inserts. Requires a real, reachable DATABASE_URL,
 * same convention as `test/dailyGuidanceOrchestratorDb.test.ts` /
 * `test/forwardPlannerOrchestrator.test.ts` -- NOT part of ci.yml's
 * math-core-tests job (no Postgres service provisioned there).
 *
 * Run locally with a real DATABASE_URL set:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/dayConstructorAcceptancePersistenceDb.test.ts
 *
 * Reuses the SAME throwaway test user every other Daily Guidance / Day
 * Constructor live-DB test already uses (idempotent via email upsert),
 * and deletes every Plan it creates in a finally block -- same
 * convention as forwardPlannerOrchestrator.test.ts.
 */
import { upsertUserByEmail, updateBirthProfile, deletePlannedActivity, listPlannedActivitiesForDay, claimPlanCreation } from '../apps/web/lib/db';
import { persistAcceptedConstructedDay, deriveAcceptanceIdempotencyKey } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import type { AcceptConstructedDayRequest, AcceptedProposedItem } from '../apps/web/lib/dayConstructorAcceptance';
import { FULL_ACTIVITY_CATALOG } from '../packages/recommendation/src/personalizedTasks';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const REAL_ACTIVITY_ID = FULL_ACTIVITY_CATALOG[0].id;

function iso(s: string): Date {
  return new Date(s);
}

function window(start: string, end: string) {
  return { date: '2026-09-16', start: iso(start), end: iso(end), timezone: TZ, source: 'EXPLICIT_RANGE' as const };
}

function item(overrides: Partial<AcceptedProposedItem> & { intentId: string; start: Date; end: Date }): AcceptedProposedItem {
  return { title: 'Untitled', placementSource: 'SELECTED_CANDIDATE', ...overrides };
}

async function main() {
  const user = await upsertUserByEmail({ email: 'test-day-constructor-acceptance@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await updateBirthProfile(user.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });

  const createdPlanIds: string[] = [];
  const cleanup = async () => {
    for (const id of createdPlanIds) {
      await deletePlannedActivity(user.id, id).catch(() => {});
    }
  };

  try {
    // ============================================================
    // 1. Atomic multi-item save
    // ============================================================
    const req1: AcceptConstructedDayRequest = {
      clientRequestId: `e2-test-atomic-${Date.now()}`,
      constructionWindow: window('2026-09-16T09:00:00Z', '2026-09-16T17:00:00Z'),
      proposedItems: [
        item({ intentId: 'a', title: 'Deep work block', start: iso('2026-09-16T10:00:00Z'), end: iso('2026-09-16T11:00:00Z'), placementSource: 'SELECTED_CANDIDATE', activityId: REAL_ACTIVITY_ID }),
        item({ intentId: 'b', title: 'Team sync', start: iso('2026-09-16T13:00:00Z'), end: iso('2026-09-16T13:30:00Z'), placementSource: 'FIXED_CONSTRAINT' }),
      ],
    };
    const decision1 = await persistAcceptedConstructedDay(user.id, req1, iso('2026-09-16T08:00:00Z'));
    check('1. multi-item acceptance SAVES', decision1.status === 'SAVED');
    if (decision1.status === 'SAVED') {
      decision1.plans.forEach((p) => createdPlanIds.push(p.id));
      check('2. exactly 2 Plans created for 2 proposed items', decision1.plans.length === 2);
      const deepWork = decision1.plans.find((p) => p.title === 'Deep work block');
      const sync = decision1.plans.find((p) => p.title === 'Team sync');
      check('3. reviewed start preserved exactly', deepWork?.plannedStartAt.getTime() === iso('2026-09-16T10:00:00Z').getTime());
      check('4. reviewed end preserved exactly', deepWork?.plannedEndAt.getTime() === iso('2026-09-16T11:00:00Z').getTime());
      check('5. reviewed duration preserved exactly (60 min)', deepWork?.durationMinutes === 60);
      check('6. reviewed activityId preserved', deepWork?.activityId === REAL_ACTIVITY_ID);
      check('7. absent activityId persists as null (never fabricated)', sync?.activityId === null || sync?.activityId === undefined);
      check('8. status written is UPCOMING for every new Plan', decision1.plans.every((p) => p.status === 'UPCOMING'));
      check('9. Plans are scoped to the authenticated user', decision1.plans.every((p) => p.userId === user.id));
    }

    // ============================================================
    // 2. Identical replay (and lost-response-equivalent replay -- the
    //    same code path from the DB's perspective: a retry of an
    //    identical request after the original response was never seen).
    // ============================================================
    const decision2 = await persistAcceptedConstructedDay(user.id, req1, iso('2026-09-16T08:05:00Z'));
    check('10. identical replay returns ALREADY_ACCEPTED', decision2.status === 'ALREADY_ACCEPTED');
    if (decision2.status === 'ALREADY_ACCEPTED' && decision1.status === 'SAVED') {
      check('11. replay returns the SAME Plan ids (no duplicates created)', decision2.plans.map((p) => p.id).sort().join(',') === decision1.plans.map((p) => p.id).sort().join(','));
    }
    const rowsAfterReplay = await listPlannedActivitiesForDay(user.id, iso('2026-09-16T00:00:00Z'), iso('2026-09-17T00:00:00Z'));
    check('12. replay created zero additional rows (still exactly 2 for this window)', rowsAfterReplay.filter((p) => createdPlanIds.includes(p.id)).length === 2);

    // ============================================================
    // 3. Concurrent identical acceptance -- fired truly concurrently.
    // ============================================================
    const reqConcurrent: AcceptConstructedDayRequest = {
      clientRequestId: `e2-test-concurrent-${Date.now()}`,
      constructionWindow: window('2026-09-16T18:00:00Z', '2026-09-16T23:00:00Z'),
      proposedItems: [item({ intentId: 'c', title: 'Evening read', start: iso('2026-09-16T20:00:00Z'), end: iso('2026-09-16T20:30:00Z'), placementSource: 'FIXED_CONSTRAINT' })],
    };
    const [concurrentA, concurrentB] = await Promise.all([
      persistAcceptedConstructedDay(user.id, reqConcurrent, iso('2026-09-16T08:00:00Z')),
      persistAcceptedConstructedDay(user.id, reqConcurrent, iso('2026-09-16T08:00:00Z')),
    ]);
    const statuses = [concurrentA.status, concurrentB.status].sort();
    check('13. exactly one of two concurrent identical requests SAVES, the other sees ALREADY_ACCEPTED', statuses[0] === 'ALREADY_ACCEPTED' && statuses[1] === 'SAVED');
    if (concurrentA.status === 'SAVED') concurrentA.plans.forEach((p) => createdPlanIds.push(p.id));
    if (concurrentB.status === 'SAVED') concurrentB.plans.forEach((p) => createdPlanIds.push(p.id));
    const rowsAfterConcurrent = await listPlannedActivitiesForDay(user.id, iso('2026-09-16T18:00:00Z'), iso('2026-09-16T23:00:00Z'));
    check('14. concurrent identical acceptance created exactly one Plan, never two', rowsAfterConcurrent.filter((p) => p.title === 'Evening read').length === 1);

    // ============================================================
    // 4. Required proposal-set-identity collision cases (pre-commit
    //    review fix -- the exact scenarios A-F). req1 above is the
    //    original [A,B] acceptance; case E (identical retry) is already
    //    covered by tests 10-12 above, reusing req1 itself.
    // ============================================================

    // Case A: original [A,B], retry [A] alone (SAME content for A) -- the
    // exact bug this review fixes: a pure strict-subset retry must NOT be
    // mistaken for a complete, valid replay merely because A's own claim
    // is filled and matches.
    const caseA: AcceptConstructedDayRequest = {
      clientRequestId: req1.clientRequestId,
      constructionWindow: window('2026-09-16T09:00:00Z', '2026-09-16T17:00:00Z'),
      proposedItems: [item({ intentId: 'a', title: 'Deep work block', start: iso('2026-09-16T10:00:00Z'), end: iso('2026-09-16T11:00:00Z'), placementSource: 'SELECTED_CANDIDATE', activityId: REAL_ACTIVITY_ID })],
    };
    const decisionA = await persistAcceptedConstructedDay(user.id, caseA, iso('2026-09-16T08:10:00Z'));
    check('Case A: original [A,B], retry [A] alone (identical content) rejects as IDEMPOTENCY_CONFLICT', decisionA.status === 'IDEMPOTENCY_CONFLICT');

    // Case B: original [A,B], retry [B] alone (SAME content for B) --
    // the symmetric strict-subset case.
    const caseB: AcceptConstructedDayRequest = {
      clientRequestId: req1.clientRequestId,
      constructionWindow: window('2026-09-16T09:00:00Z', '2026-09-16T17:00:00Z'),
      proposedItems: [item({ intentId: 'b', title: 'Team sync', start: iso('2026-09-16T13:00:00Z'), end: iso('2026-09-16T13:30:00Z'), placementSource: 'FIXED_CONSTRAINT' })],
    };
    const decisionB = await persistAcceptedConstructedDay(user.id, caseB, iso('2026-09-16T08:11:00Z'));
    check('Case B: original [A,B], retry [B] alone (identical content) rejects as IDEMPOTENCY_CONFLICT', decisionB.status === 'IDEMPOTENCY_CONFLICT');

    // Case C: original [A,B,C] (its own fresh clientRequestId), retry
    // [A,C] (dropping the middle item, identical content for A and C).
    const reqABC: AcceptConstructedDayRequest = {
      clientRequestId: `e2-test-case-c-${Date.now()}`,
      constructionWindow: window('2026-09-16T09:00:00Z', '2026-09-16T17:00:00Z'),
      proposedItems: [
        item({ intentId: 'a2', title: 'Case C item A', start: iso('2026-09-16T09:30:00Z'), end: iso('2026-09-16T10:00:00Z'), placementSource: 'FIXED_CONSTRAINT' }),
        item({ intentId: 'b2', title: 'Case C item B', start: iso('2026-09-16T11:00:00Z'), end: iso('2026-09-16T11:30:00Z'), placementSource: 'FIXED_CONSTRAINT' }),
        item({ intentId: 'c2', title: 'Case C item C', start: iso('2026-09-16T15:30:00Z'), end: iso('2026-09-16T16:00:00Z'), placementSource: 'FIXED_CONSTRAINT' }),
      ],
    };
    const decisionABC = await persistAcceptedConstructedDay(user.id, reqABC, iso('2026-09-16T08:12:00Z'));
    check('Case C setup: original [A,B,C] SAVES', decisionABC.status === 'SAVED');
    if (decisionABC.status === 'SAVED') decisionABC.plans.forEach((p) => createdPlanIds.push(p.id));
    const caseC: AcceptConstructedDayRequest = {
      clientRequestId: reqABC.clientRequestId,
      constructionWindow: reqABC.constructionWindow,
      proposedItems: [reqABC.proposedItems[0], reqABC.proposedItems[2]], // A and C only, dropping B.
    };
    const decisionC = await persistAcceptedConstructedDay(user.id, caseC, iso('2026-09-16T08:13:00Z'));
    check('Case C: original [A,B,C], retry [A,C] (dropping B) rejects as IDEMPOTENCY_CONFLICT', decisionC.status === 'IDEMPOTENCY_CONFLICT');

    // Case D: original [A] alone (its own fresh clientRequestId), retry
    // [A,B] -- A identical, B brand new. The superset case.
    const reqD: AcceptConstructedDayRequest = {
      clientRequestId: `e2-test-case-d-${Date.now()}`,
      constructionWindow: window('2026-09-16T09:00:00Z', '2026-09-16T17:00:00Z'),
      proposedItems: [item({ intentId: 'd1', title: 'Case D item A', start: iso('2026-09-16T09:30:00Z'), end: iso('2026-09-16T10:00:00Z'), placementSource: 'FIXED_CONSTRAINT' })],
    };
    const decisionD1 = await persistAcceptedConstructedDay(user.id, reqD, iso('2026-09-16T08:14:00Z'));
    check('Case D setup: original [A] alone SAVES', decisionD1.status === 'SAVED');
    if (decisionD1.status === 'SAVED') decisionD1.plans.forEach((p) => createdPlanIds.push(p.id));
    const caseD: AcceptConstructedDayRequest = {
      clientRequestId: reqD.clientRequestId,
      constructionWindow: reqD.constructionWindow,
      proposedItems: [...reqD.proposedItems, item({ intentId: 'd2', title: 'Case D item B (new)', start: iso('2026-09-16T15:00:00Z'), end: iso('2026-09-16T15:30:00Z'), placementSource: 'FIXED_CONSTRAINT' })],
    };
    const decisionD2 = await persistAcceptedConstructedDay(user.id, caseD, iso('2026-09-16T08:15:00Z'));
    check('Case D: original [A], retry [A,B] (adding a never-seen item) rejects as IDEMPOTENCY_CONFLICT', decisionD2.status === 'IDEMPOTENCY_CONFLICT');
    const rowsAfterD = await listPlannedActivitiesForDay(user.id, iso('2026-09-16T00:00:00Z'), iso('2026-09-17T00:00:00Z'));
    check('Case D: the never-seen item is never created', rowsAfterD.filter((p) => p.title === 'Case D item B (new)').length === 0);

    // Case F: original [A,B] (req1), retry the SAME item-ID set [A,B] but
    // with changed content for B (a set-identity match that must still
    // fail on content comparison).
    const caseF: AcceptConstructedDayRequest = {
      clientRequestId: req1.clientRequestId,
      constructionWindow: window('2026-09-16T09:00:00Z', '2026-09-16T17:00:00Z'),
      proposedItems: [
        item({ intentId: 'a', title: 'Deep work block', start: iso('2026-09-16T10:00:00Z'), end: iso('2026-09-16T11:00:00Z'), placementSource: 'SELECTED_CANDIDATE', activityId: REAL_ACTIVITY_ID }),
        item({ intentId: 'b', title: 'Team sync -- RESCHEDULED', start: iso('2026-09-16T13:00:00Z'), end: iso('2026-09-16T13:30:00Z'), placementSource: 'FIXED_CONSTRAINT' }),
      ],
    };
    const decisionF = await persistAcceptedConstructedDay(user.id, caseF, iso('2026-09-16T08:16:00Z'));
    check('Case F: same item-ID set [A,B], changed content for B rejects as IDEMPOTENCY_CONFLICT', decisionF.status === 'IDEMPOTENCY_CONFLICT');
    const rowsAfterF = await listPlannedActivitiesForDay(user.id, iso('2026-09-16T00:00:00Z'), iso('2026-09-17T00:00:00Z'));
    check('Case F: zero new rows created (no "RESCHEDULED" title persisted)', rowsAfterF.filter((p) => p.title === 'Team sync -- RESCHEDULED').length === 0);

    // ============================================================
    // Prefix query wildcard safety (section 6) -- a clientRequestId
    // containing a literal '%' must never let the prefix lookup for ONE
    // acceptance accidentally match a DIFFERENT acceptance whose own
    // clientRequestId would satisfy that value AS A SQL LIKE PATTERN (if
    // the query were, incorrectly, using LIKE instead of exact `left()`
    // equality). 'req-with-%-percent' as a naive LIKE pattern would match
    // 'req-with-XXXXX-percent'; findPlanCreationClaimsByPrefix's own
    // exact-equality semantics must keep them completely unrelated.
    // ============================================================
    const percentId = `req-with-%-percent-${Date.now()}`;
    const reqPercent: AcceptConstructedDayRequest = {
      clientRequestId: percentId,
      constructionWindow: window('2026-09-16T09:00:00Z', '2026-09-16T17:00:00Z'),
      proposedItems: [item({ intentId: 'p1', title: 'Percent-id item', start: iso('2026-09-16T09:30:00Z'), end: iso('2026-09-16T10:00:00Z'), placementSource: 'FIXED_CONSTRAINT' })],
    };
    const decisionPercent = await persistAcceptedConstructedDay(user.id, reqPercent, iso('2026-09-16T08:17:00Z'));
    check("Wildcard safety: a clientRequestId containing a literal '%' SAVES normally", decisionPercent.status === 'SAVED');
    if (decisionPercent.status === 'SAVED') decisionPercent.plans.forEach((p) => createdPlanIds.push(p.id));

    const wouldBeLikeMatchId = percentId.replace('%', 'XXXXXXXXXX'); // what 'req-with-%-percent-...' would LIKE-match as a pattern.
    const reqWouldBeLikeMatch: AcceptConstructedDayRequest = {
      clientRequestId: wouldBeLikeMatchId,
      constructionWindow: window('2026-09-16T09:00:00Z', '2026-09-16T17:00:00Z'),
      proposedItems: [item({ intentId: 'p1', title: 'A wholly unrelated acceptance', start: iso('2026-09-16T11:00:00Z'), end: iso('2026-09-16T11:30:00Z'), placementSource: 'FIXED_CONSTRAINT' })],
    };
    const decisionUnrelated = await persistAcceptedConstructedDay(user.id, reqWouldBeLikeMatch, iso('2026-09-16T08:18:00Z'));
    check('Wildcard safety: the would-be LIKE-match id is treated as a genuinely SEPARATE, unrelated acceptance (SAVES, not confused with the percent-id one)', decisionUnrelated.status === 'SAVED');
    if (decisionUnrelated.status === 'SAVED') decisionUnrelated.plans.forEach((p) => createdPlanIds.push(p.id));

    // Re-submitting the ORIGINAL percent-id request must still resolve
    // as its own clean replay, never contaminated by the unrelated one.
    const decisionPercentReplay = await persistAcceptedConstructedDay(user.id, reqPercent, iso('2026-09-16T08:19:00Z'));
    check(
      "Wildcard safety: replaying the original '%'-containing request returns ALREADY_ACCEPTED for exactly its own single item",
      decisionPercentReplay.status === 'ALREADY_ACCEPTED' && decisionPercentReplay.plans.length === 1
    );

    // ============================================================
    // 5. Rollback on forced failure -- pre-claim one item's own
    //    deterministic key directly (simulating another in-flight
    //    holder), forcing persistAcceptedConstructedDay's own claim loop
    //    to lose a claim it should be the sole writer for.
    // ============================================================
    const reqForcedFailure: AcceptConstructedDayRequest = {
      clientRequestId: `e2-test-forced-failure-${Date.now()}`,
      constructionWindow: window('2026-09-16T09:00:00Z', '2026-09-16T17:00:00Z'),
      proposedItems: [
        item({ intentId: 'e', title: 'Should roll back', start: iso('2026-09-16T09:30:00Z'), end: iso('2026-09-16T10:00:00Z'), placementSource: 'FIXED_CONSTRAINT' }),
        item({ intentId: 'f', title: 'Also should roll back', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T14:30:00Z'), placementSource: 'FIXED_CONSTRAINT' }),
      ],
    };
    const secondItemKey = deriveAcceptanceIdempotencyKey(reqForcedFailure.clientRequestId, 'f');
    await claimPlanCreation(user.id, secondItemKey); // simulates another holder already claiming item 'f''s own key.
    const decisionForcedFailure = await persistAcceptedConstructedDay(user.id, reqForcedFailure, iso('2026-09-16T08:20:00Z'));
    check('19. losing a claim mid-transaction fails the whole acceptance (SAVE_FAILED)', decisionForcedFailure.status === 'SAVE_FAILED');
    const rowsAfterForcedFailure = await listPlannedActivitiesForDay(user.id, iso('2026-09-16T00:00:00Z'), iso('2026-09-17T00:00:00Z'));
    check('20. a forced mid-transaction failure rolls back the FIRST item too (zero Plans for either item)', rowsAfterForcedFailure.filter((p) => p.title === 'Should roll back' || p.title === 'Also should roll back').length === 0);
  } finally {
    await cleanup();
  }

  if (!allPassed) {
    console.error('SOME DAY CONSTRUCTOR ACCEPTANCE PERSISTENCE DB CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL DAY CONSTRUCTOR ACCEPTANCE PERSISTENCE DB CHECKS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
