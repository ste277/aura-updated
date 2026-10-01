/**
 * Goals V2 Candidate A3.4 -- live-database, end-to-end proof of verified
 * automatic Goal provenance through the REAL trust chain: real
 * `signPreviewItem`/`verifyAcceptanceItems` (dayConstructorPreviewIntegrity.ts,
 * UNMODIFIED) -> real `authorizeGoalActivityLinks`
 * (goalDemandProvenanceAuthorization.ts) -> real
 * `persistAcceptedConstructedDay` (dayConstructorAcceptancePersistence.ts,
 * UNMODIFIED). `acceptWithProvenance` below mirrors
 * apps/web/app/api/day-constructor/accept/route.ts's own real sequence
 * line-for-line (bypassing HTTP/NextRequest only, the SAME established
 * convention goalActivityRhythmMaterializationDb.test.ts/
 * goalPlanningHandoffDb.test.ts already use for persistAcceptedConstructedDay
 * alone) -- this file is what proves route.ts's own real wiring order,
 * not just the pure authorization function in isolation.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/goalDemandProvenanceAuthorizationDb.test.ts
 */
import { upsertUserByEmail, updateBirthProfile, createGoalWithActivities, addGoalActivity, beginTransaction, listPlannedActivitiesForDay } from '../apps/web/lib/db';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import { verifyAcceptanceItems, signPreviewItem, type PreviewItemFacts } from '../apps/web/lib/dayConstructorPreviewIntegrity';
import { authorizeGoalActivityLinks } from '../apps/web/lib/goalDemandProvenanceAuthorization';
import { encodeGoalDemandIntentId } from '../apps/web/lib/goalDemandIntentId';
import type { AcceptConstructedDayRequest, AcceptedProposedItem } from '../apps/web/lib/dayConstructorAcceptance';
import type { ConstructionWindow } from '../apps/web/lib/dayIntent';

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

const setRhythm = (goalActivityId: string, targetPerWeek: number) =>
  sql(`UPDATE "GoalActivity" SET "rhythmKind" = 'N_PER_WEEK', "rhythmTargetPerWeek" = $1 WHERE id = $2`, [targetPerWeek, goalActivityId]);

function iso(s: string): Date {
  return new Date(s);
}
function window(date: string, start: string, end: string): ConstructionWindow {
  return { date, start: iso(start), end: iso(end), timezone: TZ, source: 'EXPLICIT_RANGE' };
}

/** Mirrors accept/route.ts's own real sequence: verify -> authorize -> persist. */
async function acceptWithProvenance(userId: string, request: AcceptConstructedDayRequest, now: Date, rawGoalActivityLinks: ReadonlyMap<string, string>) {
  const tokens = new Map(request.proposedItems.map((item) => [item.intentId, signPreviewItem({ userId, window: request.constructionWindow, item })]));
  return acceptWithProvenanceUsingTokens(userId, request, now, rawGoalActivityLinks, tokens);
}

async function acceptWithProvenanceUsingTokens(userId: string, request: AcceptConstructedDayRequest, now: Date, rawGoalActivityLinks: ReadonlyMap<string, string>, tokens: ReadonlyMap<string, unknown>) {
  const integrityDiagnostics = verifyAcceptanceItems(userId, request.constructionWindow, request.proposedItems, tokens);
  if (integrityDiagnostics.length > 0) return { status: 'REJECTED' as const, reason: 'INVALID_REQUEST' as const, diagnostics: integrityDiagnostics };
  const authorization = authorizeGoalActivityLinks(request.proposedItems, request.constructionWindow.date, rawGoalActivityLinks);
  if (authorization.status === 'REJECTED') return authorization;
  return persistAcceptedConstructedDay(userId, request, now, authorization.goalActivityLinks, new Map());
}

function item(overrides: Partial<AcceptedProposedItem> & { intentId: string; start: Date; end: Date }): AcceptedProposedItem {
  return { title: 'Workout', placementSource: 'SELECTED_CANDIDATE', ...overrides };
}

async function main() {
  const user = await upsertUserByEmail({ email: 'test-goal-demand-provenance-auth@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const other = await upsertUserByEmail({ email: 'test-goal-demand-provenance-auth-other@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await updateBirthProfile(user.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  await updateBirthProfile(other.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });

  const cleanup = async () => {
    await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = NULL WHERE "userId" = ANY($1::text[])`, [[user.id, other.id]]);
    await sql(`UPDATE "PlannedActivity" SET "rescheduledFromPlanId" = NULL WHERE "userId" = ANY($1::text[])`, [[user.id, other.id]]);
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])`, [[user.id, other.id]]);
    await sql(`DELETE FROM "GoalActivity" WHERE "userId" = ANY($1::text[])`, [[user.id, other.id]]);
    await sql(`DELETE FROM "Goal" WHERE "userId" = ANY($1::text[])`, [[user.id, other.id]]);
  };
  await cleanup();

  const occCount = async (userId: string) => (await sql(`SELECT count(*)::int n FROM "GoalActivityOccurrence" WHERE "userId" = $1`, [userId]))[0].n;
  const planCount = async (userId: string) => (await sql(`SELECT count(*)::int n FROM "PlannedActivity" WHERE "userId" = $1`, [userId]))[0].n;

  try {
    const { goal } = await createGoalWithActivities({ userId: user.id, title: 'Get fit (A3.4 fixture)', targetDate: null, activities: [] });
    const { goal: otherGoal } = await createGoalWithActivities({ userId: other.id, title: 'Get fit (A3.4 fixture, other user)', targetDate: null, activities: [] });

    // ============================================================
    // 37/39. End-to-end: verified automatic intent + matching link -> SAVED,
    // exactly the existing expected GoalActivityOccurrence/PlannedActivity
    // association.
    // ============================================================
    const ga1 = await addGoalActivity(user.id, goal.id, { title: 'Workout', activityId: null });
    await setRhythm(ga1!.id, 3);
    const intentId1 = encodeGoalDemandIntentId('2026-10-06', ga1!.id);
    const req1: AcceptConstructedDayRequest = {
      clientRequestId: `a34-${Date.now()}-1`,
      constructionWindow: window('2026-10-06', '2026-10-06T09:00:00Z', '2026-10-06T21:00:00Z'),
      proposedItems: [item({ intentId: intentId1, start: iso('2026-10-06T10:00:00Z'), end: iso('2026-10-06T10:10:00Z') })],
    };
    const d1 = await acceptWithProvenance(user.id, req1, iso('2026-10-06T08:00:00Z'), new Map([[intentId1, ga1!.id]]));
    check('37/39a. verified automatic intent + matching client link -> SAVED', d1.status === 'SAVED');
    const occ1 = d1.status === 'SAVED' ? (await sql(`SELECT * FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [ga1!.id]))[0] : null;
    const plan1Id = d1.status === 'SAVED' ? d1.plans[0]?.id : null;
    check('37. exactly the existing expected GoalActivityOccurrence/PlannedActivity association is created', !!occ1 && !!plan1Id && occ1.plannedActivityId === plan1Id);

    // ============================================================
    // 20 (DB). missing client link -> server derives the correct link.
    // ============================================================
    const ga2 = await addGoalActivity(user.id, goal.id, { title: 'Workout B', activityId: null });
    await setRhythm(ga2!.id, 3);
    const intentId2 = encodeGoalDemandIntentId('2026-10-06', ga2!.id);
    const req2: AcceptConstructedDayRequest = {
      clientRequestId: `a34-${Date.now()}-2`,
      constructionWindow: window('2026-10-06', '2026-10-06T09:00:00Z', '2026-10-06T21:00:00Z'),
      proposedItems: [item({ intentId: intentId2, start: iso('2026-10-06T11:00:00Z'), end: iso('2026-10-06T11:10:00Z') })],
    };
    const d2 = await acceptWithProvenance(user.id, req2, iso('2026-10-06T08:00:00Z'), new Map()); // no client link at all
    check('20. verified automatic intent + missing client link -> server derives the link, SAVED', d2.status === 'SAVED');
    const occ2 = await sql(`SELECT 1 FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [ga2!.id]);
    check('20b. the derived link actually materialized a real occurrence for the correct GoalActivity', occ2.length === 1);

    // ============================================================
    // 21/22 (DB). conflicting client link -> rejected, zero writes.
    // ============================================================
    const ga3 = await addGoalActivity(user.id, goal.id, { title: 'Workout C', activityId: null });
    await setRhythm(ga3!.id, 3);
    const ga3Decoy = await addGoalActivity(user.id, goal.id, { title: 'Workout C decoy', activityId: null });
    await setRhythm(ga3Decoy!.id, 3);
    const intentId3 = encodeGoalDemandIntentId('2026-10-06', ga3!.id);
    const before3occ = await occCount(user.id);
    const before3plan = await planCount(user.id);
    const req3: AcceptConstructedDayRequest = {
      clientRequestId: `a34-${Date.now()}-3`,
      constructionWindow: window('2026-10-06', '2026-10-06T09:00:00Z', '2026-10-06T21:00:00Z'),
      proposedItems: [item({ intentId: intentId3, start: iso('2026-10-06T12:00:00Z'), end: iso('2026-10-06T12:10:00Z') })],
    };
    const d3 = await acceptWithProvenance(user.id, req3, iso('2026-10-06T08:00:00Z'), new Map([[intentId3, ga3Decoy!.id]])); // conflicting
    check('21. verified automatic intent + conflicting client link -> REJECTED', d3.status === 'REJECTED');
    check('22. conflict causes zero GoalActivityOccurrence/PlannedActivity writes', (await occCount(user.id)) === before3occ && (await planCount(user.id)) === before3plan);

    // ============================================================
    // 23/24 (DB). malformed reserved identity -> rejected, zero writes.
    // Must carry a REAL valid signature for the malformed string itself
    // (proving rejection comes from the decoder, not merely from a
    // missing/invalid token) -- signed via the real signPreviewItem for
    // exactly that (malformed) intentId.
    // ============================================================
    {
      const malformedIntentId = 'goal-demand:2026-10-06:'; // missing GoalActivity id
      const before = { occ: await occCount(user.id), plan: await planCount(user.id) };
      const req: AcceptConstructedDayRequest = {
        clientRequestId: `a34-${Date.now()}-4`,
        constructionWindow: window('2026-10-06', '2026-10-06T09:00:00Z', '2026-10-06T21:00:00Z'),
        proposedItems: [item({ intentId: malformedIntentId, start: iso('2026-10-06T13:00:00Z'), end: iso('2026-10-06T13:10:00Z') })],
      };
      const d = await acceptWithProvenance(user.id, req, iso('2026-10-06T08:00:00Z'), new Map());
      check('23. a VALIDLY SIGNED item whose intentId is a malformed reserved identity -> REJECTED', d.status === 'REJECTED');
      check('24. malformed identity causes zero writes', (await occCount(user.id)) === before.occ && (await planCount(user.id)) === before.plan);
    }

    // ============================================================
    // 25/26 (DB). planning-date mismatch -> rejected, zero writes. The
    // intentId's own ENCODED date differs from constructionWindow.date --
    // both are individually real/valid, but they disagree.
    // ============================================================
    {
      const ga = await addGoalActivity(user.id, goal.id, { title: 'Workout D', activityId: null });
      await setRhythm(ga!.id, 3);
      const mismatchedIntentId = encodeGoalDemandIntentId('2026-10-07', ga!.id); // encoded for the 7th
      const before = { occ: await occCount(user.id), plan: await planCount(user.id) };
      const req: AcceptConstructedDayRequest = {
        clientRequestId: `a34-${Date.now()}-5`,
        constructionWindow: window('2026-10-06', '2026-10-06T09:00:00Z', '2026-10-06T21:00:00Z'), // window is the 6th
        proposedItems: [item({ intentId: mismatchedIntentId, start: iso('2026-10-06T14:00:00Z'), end: iso('2026-10-06T14:10:00Z') })],
      };
      const d = await acceptWithProvenance(user.id, req, iso('2026-10-06T08:00:00Z'), new Map());
      check('25. decoded planning date differs from the verified constructionWindow.date -> REJECTED', d.status === 'REJECTED');
      check('26. date mismatch causes zero writes', (await occCount(user.id)) === before.occ && (await planCount(user.id)) === before.plan);
    }

    // ============================================================
    // 27 (DB). An unsigned/unverified goal-demand-looking intentId has
    // ZERO authority -- caught by the EXISTING verifyAcceptanceItems gate
    // itself (before this ticket's own authorization step even runs).
    // ============================================================
    {
      const ga = await addGoalActivity(user.id, goal.id, { title: 'Workout E', activityId: null });
      await setRhythm(ga!.id, 3);
      const forgedIntentId = encodeGoalDemandIntentId('2026-10-06', ga!.id);
      const before = { occ: await occCount(user.id), plan: await planCount(user.id) };
      const req: AcceptConstructedDayRequest = {
        clientRequestId: `a34-${Date.now()}-6`,
        constructionWindow: window('2026-10-06', '2026-10-06T09:00:00Z', '2026-10-06T21:00:00Z'),
        proposedItems: [item({ intentId: forgedIntentId, start: iso('2026-10-06T15:00:00Z'), end: iso('2026-10-06T15:10:00Z') })],
      };
      // No token at all for this intentId -- simulating a client that
      // fabricated a correctly-SHAPED goal-demand id without ever having
      // received it from a real preview response.
      const d = await acceptWithProvenanceUsingTokens(user.id, req, iso('2026-10-06T08:00:00Z'), new Map([[forgedIntentId, ga!.id]]), new Map());
      check('27. an unsigned goal-demand-looking intentId is rejected by signature verification itself, never reaching this ticket\'s own authorization step', d.status === 'REJECTED');
      check('28 (DB). the accompanying (unverified) client link also never persists anything', (await occCount(user.id)) === before.occ && (await planCount(user.id)) === before.plan);
    }

    // ============================================================
    // 40 (DB). Atomicity: one invalid automatic provenance among valid
    // siblings -> the WHOLE batch rejects, zero writes for ANY item,
    // including the otherwise-valid ones.
    // ============================================================
    {
      const gaGood = await addGoalActivity(user.id, goal.id, { title: 'Good sibling', activityId: null });
      await setRhythm(gaGood!.id, 3);
      const gaBad = await addGoalActivity(user.id, goal.id, { title: 'Bad sibling', activityId: null });
      await setRhythm(gaBad!.id, 3);
      const gaDecoy = await addGoalActivity(user.id, goal.id, { title: 'Decoy', activityId: null });
      await setRhythm(gaDecoy!.id, 3);
      const goodIntentId = encodeGoalDemandIntentId('2026-10-06', gaGood!.id);
      const badIntentId = encodeGoalDemandIntentId('2026-10-06', gaBad!.id);
      const before = { occ: await occCount(user.id), plan: await planCount(user.id) };
      const req: AcceptConstructedDayRequest = {
        clientRequestId: `a34-${Date.now()}-7`,
        constructionWindow: window('2026-10-06', '2026-10-06T09:00:00Z', '2026-10-06T21:00:00Z'),
        proposedItems: [
          item({ intentId: goodIntentId, title: 'Good sibling', start: iso('2026-10-06T16:00:00Z'), end: iso('2026-10-06T16:10:00Z') }),
          item({ intentId: badIntentId, title: 'Bad sibling', start: iso('2026-10-06T16:30:00Z'), end: iso('2026-10-06T16:40:00Z') }),
        ],
      };
      const d = await acceptWithProvenance(user.id, req, iso('2026-10-06T08:00:00Z'), new Map([[goodIntentId, gaGood!.id], [badIntentId, gaDecoy!.id]])); // bad sibling's link conflicts
      check('40. one invalid automatic provenance among valid siblings -> the WHOLE accept is rejected', d.status === 'REJECTED');
      check('40b. zero writes for ANY item, including the otherwise-valid sibling (atomicity preserved)', (await occCount(user.id)) === before.occ && (await planCount(user.id)) === before.plan);
    }

    // ============================================================
    // 34/defense-in-depth. A verified item (real signature, real user)
    // whose decoded goalActivityId happens to belong to a DIFFERENT user
    // is still rejected by the EXISTING transactional ownership check
    // (materializeGoalActivityRhythmOccurrence's own `userId` scoping) --
    // provenance authorization answers "who does the client say," never
    // "is it actually owned," which stays this file's own unmodified job.
    // ============================================================
    {
      const otherUsersGa = await addGoalActivity(other.id, otherGoal.id, { title: 'Other users workout', activityId: null });
      await setRhythm(otherUsersGa!.id, 3);
      const intentId = encodeGoalDemandIntentId('2026-10-06', otherUsersGa!.id);
      const before = { occ: await occCount(user.id), plan: await planCount(user.id) };
      const req: AcceptConstructedDayRequest = {
        clientRequestId: `a34-${Date.now()}-8`,
        constructionWindow: window('2026-10-06', '2026-10-06T09:00:00Z', '2026-10-06T21:00:00Z'),
        proposedItems: [item({ intentId, start: iso('2026-10-06T17:10:00Z'), end: iso('2026-10-06T17:20:00Z') })],
      };
      // Signed/verified correctly for `user` (our own acceptWithProvenance
      // always signs with the `userId` argument it's called with) -- the
      // provenance check itself passes (decoded goalActivityId matches, no
      // client-link conflict), but the GoalActivity belongs to `other`.
      const d = await acceptWithProvenance(user.id, req, iso('2026-10-06T08:00:00Z'), new Map([[intentId, otherUsersGa!.id]]));
      check('34. a verified automatic item decoding to a DIFFERENT user\'s GoalActivity still fails at the existing transactional ownership check (defense-in-depth preserved)', d.status === 'SAVE_FAILED');
      check('34b. zero writes result from this cross-user attempt', (await occCount(user.id)) === before.occ && (await planCount(user.id)) === before.plan);
    }

    // ============================================================
    // 35 (DB). Capacity exhausted at accept time -> rejected as before
    // (existing Rhythm eligibility enforcement, completely untouched).
    // ============================================================
    {
      const ga = await addGoalActivity(user.id, goal.id, { title: 'Capacity test', activityId: null });
      await setRhythm(ga!.id, 1);
      const intentIdA = encodeGoalDemandIntentId('2026-10-06', ga!.id);
      const reqA: AcceptConstructedDayRequest = {
        clientRequestId: `a34-${Date.now()}-9a`,
        constructionWindow: window('2026-10-06', '2026-10-06T09:00:00Z', '2026-10-06T21:00:00Z'),
        proposedItems: [item({ intentId: intentIdA, start: iso('2026-10-06T18:00:00Z'), end: iso('2026-10-06T18:10:00Z') })],
      };
      const dA = await acceptWithProvenance(user.id, reqA, iso('2026-10-06T08:00:00Z'), new Map([[intentIdA, ga!.id]]));
      check('35 setup: first 1/week occurrence SAVED', dA.status === 'SAVED');

      // A second automatic suggestion for the SAME GoalActivity, same
      // week -- capacity is now exhausted (the first occurrence is still
      // UPCOMING, so the existing HAS_LIVE_COMMITMENT gate alone already
      // refuses a second materialization regardless of capacity math).
      const intentIdB = encodeGoalDemandIntentId('2026-10-06', ga!.id);
      const reqB: AcceptConstructedDayRequest = {
        clientRequestId: `a34-${Date.now()}-9b`,
        constructionWindow: window('2026-10-06', '2026-10-06T09:00:00Z', '2026-10-06T21:00:00Z'),
        proposedItems: [item({ intentId: intentIdB, start: iso('2026-10-06T18:30:00Z'), end: iso('2026-10-06T18:40:00Z') })],
      };
      const before = { occ: await occCount(user.id), plan: await planCount(user.id) };
      const dB = await acceptWithProvenance(user.id, reqB, iso('2026-10-06T08:00:00Z'), new Map([[intentIdB, ga!.id]]));
      check('35. a second automatic suggestion for an already-committed GoalActivity -> rejected by the existing eligibility gate, exactly as before', dB.status === 'SAVE_FAILED');
      check('35b. zero additional writes from the rejected second attempt', (await occCount(user.id)) === before.occ && (await planCount(user.id)) === before.plan);
    }

    // ============================================================
    // 36 (DB). Concurrency -- two concurrent accepts for the same 1/week
    // GoalActivity: exactly one succeeds, the existing advisory lock +
    // fresh re-read protects capacity exactly as it already does for the
    // manual path.
    // ============================================================
    {
      const ga = await addGoalActivity(user.id, goal.id, { title: 'Concurrency test', activityId: null });
      await setRhythm(ga!.id, 1);
      const intentIdC1 = encodeGoalDemandIntentId('2026-10-06', ga!.id);
      const intentIdC2 = encodeGoalDemandIntentId('2026-10-06', ga!.id);
      const reqC1: AcceptConstructedDayRequest = {
        clientRequestId: `a34-${Date.now()}-10a`,
        constructionWindow: window('2026-10-06', '2026-10-06T09:00:00Z', '2026-10-06T21:00:00Z'),
        proposedItems: [item({ intentId: intentIdC1, start: iso('2026-10-06T19:00:00Z'), end: iso('2026-10-06T19:10:00Z') })],
      };
      const reqC2: AcceptConstructedDayRequest = {
        clientRequestId: `a34-${Date.now()}-10b`,
        constructionWindow: window('2026-10-06', '2026-10-06T09:00:00Z', '2026-10-06T21:00:00Z'),
        proposedItems: [item({ intentId: intentIdC2, start: iso('2026-10-06T19:00:00Z'), end: iso('2026-10-06T19:10:00Z') })],
      };
      const [rC1, rC2] = await Promise.all([
        acceptWithProvenance(user.id, reqC1, iso('2026-10-06T08:00:00Z'), new Map([[intentIdC1, ga!.id]])),
        acceptWithProvenance(user.id, reqC2, iso('2026-10-06T08:00:00Z'), new Map([[intentIdC2, ga!.id]])),
      ]);
      const savedCount = [rC1.status, rC2.status].filter((s) => s === 'SAVED').length;
      check('36. exactly ONE of two concurrent automatic accepts for the same 1/week GoalActivity succeeds', savedCount === 1);
      check('36b. exactly one occurrence exists after both concurrent attempts resolve', (await sql(`SELECT count(*)::int n FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [ga!.id]))[0].n === 1);
    }

    // ============================================================
    // 29/30/31. Non-Goal intents (typed/Quick Pick-equivalent, Capture)
    // completely unchanged -- no goalActivityLinks entry involved at all.
    // ============================================================
    {
      const before = { occ: await occCount(user.id), plan: await planCount(user.id) };
      const req: AcceptConstructedDayRequest = {
        clientRequestId: `a34-${Date.now()}-11`,
        constructionWindow: window('2026-10-06', '2026-10-06T09:00:00Z', '2026-10-06T21:00:00Z'),
        proposedItems: [item({ intentId: 'plan-day-row-1', title: 'Ordinary typed task', start: iso('2026-10-06T20:00:00Z'), end: iso('2026-10-06T20:10:00Z') })],
      };
      const d = await acceptWithProvenance(user.id, req, iso('2026-10-06T08:00:00Z'), new Map());
      check('29/30. an ordinary (typed/Quick-Pick-shaped) intent with no Goal link saves normally, unaffected by this ticket', d.status === 'SAVED');
      check('29b. no GoalActivityOccurrence is created for a non-Goal item', (await occCount(user.id)) === before.occ);
    }
  } finally {
    await cleanup();
  }

  if (!allPassed) {
    console.error('SOME GOAL DEMAND PROVENANCE AUTHORIZATION DB CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL GOAL DEMAND PROVENANCE AUTHORIZATION DB CHECKS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
