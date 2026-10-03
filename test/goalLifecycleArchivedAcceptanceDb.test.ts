/**
 * Goal lifecycle authorization -- archived-Goal acceptance guard, live
 * database proof.
 *
 * INVARIANT: a Goal-derived planning acceptance may create or associate
 * Goal provenance (GoalActivityOccurrence, the GoalActivity -> PlannedActivity
 * link) ONLY while the parent Goal is ACTIVE *at acceptance time*, whatever
 * entry path produced the Goal link: automatic canonical intent, manual
 * canonical intent, a forged canonical id, or a legacy `plan-day-goal-*`
 * link.
 *
 * REAL chain (no mocks): real user/Goal/GoalActivity/Rhythm/availability ->
 * real handoff + bootstrap -> real preview boundary (provider + O4) -> real
 * signing -> real accept route -> real authorization -> real persistence;
 * the Goal is archived with the real `archiveGoal`.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/goalLifecycleArchivedAcceptanceDb.test.ts
 */
import {
  upsertUserByEmail,
  updateBirthProfile,
  createGoalWithActivities,
  addGoalActivity,
  archiveGoal,
  beginTransaction,
  replaceUserAvailabilityConfiguration,
  getUserById,
  listGoalActivitiesWithLinkedPlanStatus,
  loadGoalActivityRhythmFacts,
  createPlannedActivity,
  logPlannedActivity,
} from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { createRealDayConstructorOrchestratorDeps } from '../apps/web/lib/dayConstructorOrchestrator';
import { handleDayConstructorPreviewRequest } from '../apps/web/lib/dayConstructorPreviewRequest';
import { loadGoalDecisionFacts } from '../apps/web/lib/goalDecisionFactsProvider';
import { createRealOpportunityRangeDeps } from '../apps/web/lib/opportunityRangeRealDeps';
import { createRealGoalDemandCandidatesDeps } from '../apps/web/lib/goalDemandCandidates';
import { resolveGoalActivityHandoff, resolveAutomaticGoalDemand, markCanonicalGoalDemandHandoff } from '../apps/web/lib/planDayBootstrap';
import { createIntentRowFromGoalHandoffItem, createIntentRowFromAutoGoalSuggestion, createIntentRowFromGoalActivity, createInitialIntentRow, buildRequestedIntentsForSubmission, buildGoalActivityLinksForAccept, type PlanDayIntentRow } from '../apps/web/lib/planDayEntry';
import { encodeGoalDemandIntentId } from '../apps/web/lib/goalDemandIntentId';
import { buildAcceptRequestBody } from '../apps/web/lib/acceptConstructedDay';
import { POST as acceptRoute } from '../apps/web/app/api/day-constructor/accept/route';
import { localDateTimeToUTC } from '../apps/web/lib/timezone';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const TZ = 'Asia/Kolkata';
const DATE = '2026-10-07'; // Wednesday
const NOW = localDateTimeToUTC(DATE, '09:00', TZ);

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

async function main() {
  const mk = async (key: string) => {
    const u = await upsertUserByEmail({ email: `test-lifecycle-${key}@example.com`, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
    await updateBirthProfile(u.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
    return u;
  };
  const A = await mk('a');
  const B = await mk('b');
  const ids = [A.id, B.id];
  const cleanup = async () => {
    await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = NULL WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "GoalActivityExecution" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "GoalActivity" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "Goal" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "UserAvailabilityPeriod" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`UPDATE "User" SET "availabilityConfigured" = false WHERE id = ANY($1::text[])`, [ids]);
  };
  await cleanup();

  const previewAs = async (userId: string, body: Record<string, unknown>) => {
    const result = await handleDayConstructorPreviewRequest({
      getSession: () => ({ userId }),
      getUser: (id) => getUserById(id),
      getBody: async () => body,
      now: () => NOW,
      createOrchestratorDeps: createRealDayConstructorOrchestratorDeps,
      loadDecisionFacts: (u, request) => loadGoalDecisionFacts(u, request),
      createOpportunityRangeDeps: (u: any) => createRealOpportunityRangeDeps(u),
    });
    return JSON.parse(JSON.stringify(result.body));
  };
  const evening = { constructionWindowSource: 'EXPLICIT_RANGE', explicitStart: localDateTimeToUTC(DATE, '10:00', TZ).toISOString(), explicitEnd: localDateTimeToUTC(DATE, '23:00', TZ).toISOString() };
  const bodyOf = (rows: PlanDayIntentRow[]) => ({ ...evening, intents: buildRequestedIntentsForSubmission(rows, TZ, DATE) });
  const fakeReq = (userId: string, body: unknown): any => ({ cookies: { get: () => ({ value: createSessionToken(userId, 'ignored@example.com') }) }, json: async () => body, headers: new Headers() });
  const accept = async (userId: string, body: unknown) => (await acceptRoute(fakeReq(userId, body))).json();
  let n = 0;
  const acceptBody = (preview: any, rows: PlanDayIntentRow[], clientRequestId = `lc-${Date.now()}-${n++}`) => JSON.parse(JSON.stringify(buildAcceptRequestBody(preview.preview, clientRequestId, buildGoalActivityLinksForAccept(rows, preview.preview.constructedDay.proposedItems))));
  const facts = (preview: any, id: string) => preview.preview?.resolvedIntents?.find((r: any) => r.requestedIntentId === id)?.dayIntent?.decisionFacts;
  const state = async (userId: string, goalActivityIds: string[] = []) => ({
    plans: (await sql(`SELECT count(*)::int n FROM "PlannedActivity" WHERE "userId" = $1`, [userId]))[0].n as number,
    occ: (await sql(`SELECT count(*)::int n FROM "GoalActivityOccurrence" WHERE "userId" = $1`, [userId]))[0].n as number,
    exec: (await sql(`SELECT count(*)::int n FROM "GoalActivityExecution" WHERE "userId" = $1`, [userId]))[0].n as number,
    links: (await sql(`SELECT count(*)::int n FROM "GoalActivity" WHERE "userId" = $1 AND "plannedActivityId" IS NOT NULL AND id = ANY($2::text[])`, [userId, goalActivityIds]))[0].n as number,
  });
  const occOf = async (goalActivityId: string) => (await sql(`SELECT count(*)::int n FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [goalActivityId]))[0].n as number;
  const same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
  const goalOf = async (userId: string, title: string) => (await createGoalWithActivities({ userId, title, targetDate: null, activities: [] })).goal;
  const recurring = async (userId: string, goalId: string, title: string, target = 3) => {
    const ga = (await addGoalActivity(userId, goalId, { title, activityId: 'workout' }))!;
    await sql(`UPDATE "GoalActivity" SET "rhythmKind" = 'N_PER_WEEK', "rhythmTargetPerWeek" = $1 WHERE id = $2`, [target, ga.id]);
    return ga;
  };
  const canonicalRow = (ga: { id: string; title: string }) => createIntentRowFromAutoGoalSuggestion({ title: ga.title, activityId: 'workout', goalActivityId: ga.id }, encodeGoalDemandIntentId(DATE, ga.id));
  const REJECTED_NOT_ACTIVE = (r: any) => r.status === 'REJECTED' && r.reason === 'INVALID_REQUEST' && JSON.stringify(r.diagnostics ?? []).includes('GOAL_NOT_ACTIVE');

  try {
    await replaceUserAvailabilityConfiguration(A.id, [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })));
    await replaceUserAvailabilityConfiguration(B.id, [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })));

    // ------------------------------------------------------------------
    console.log('=== CONTROL: ACTIVE parent Goal, canonical automatic path ===');
    const gC = await goalOf(A.id, 'Control goal');
    const rC = await recurring(A.id, gC.id, 'Control cardio');
    const rowsC = [canonicalRow(rC)];
    const pvC = await previewAs(A.id, bodyOf(rowsC));
    const sC0 = await state(A.id, [rC.id]);
    const accC = await accept(A.id, acceptBody(pvC, rowsC));
    const sC1 = await state(A.id, [rC.id]);
    check('ACTIVE control: acceptance SAVED with exactly one occurrence, one plan and the GoalActivity link', accC.status === 'SAVED' && sC1.occ === sC0.occ + 1 && sC1.plans === sC0.plans + 1 && sC1.links === 1);

    // ------------------------------------------------------------------
    console.log('=== PREVIEW -> ARCHIVE -> ACCEPT (canonical automatic) ===');
    const g1 = await goalOf(A.id, 'Goal one');
    const r1 = await recurring(A.id, g1.id, 'Cardio one');
    const rows1 = [canonicalRow(r1)];
    const pv1 = await previewAs(A.id, bodyOf(rows1));
    check('while ACTIVE, the preview is READY and carries the recurrence facts (legitimate preview unchanged)', pv1.status === 'READY' && !!facts(pv1, rows1[0].id)?.recurrence && !!facts(pv1, rows1[0].id)?.opportunity);
    await archiveGoal(A.id, g1.id);
    const s1a = await state(A.id, [r1.id]);
    const acc1 = await accept(A.id, acceptBody(pv1, rows1));
    const s1b = await state(A.id, [r1.id]);
    check('accepting a still-validly-signed preview AFTER the parent Goal was archived is REJECTED with a typed authorization failure (GOAL_NOT_ACTIVE)', REJECTED_NOT_ACTIVE(acc1));
    check('...and wrote NOTHING: no occurrence, no plan, no execution, no link', same(s1a, s1b) && s1b.links === 0);
    check('the rejection names only the client\'s own intent id: no internal Goal id and no activity id is exposed beyond it', JSON.stringify(acc1.diagnostics ?? []).includes(rows1[0].id) && !JSON.stringify({ ...acc1, diagnostics: (acc1.diagnostics ?? []).map((d: any) => ({ reason: d.reason, detail: d.detail })) }).includes(g1.id));

    // ------------------------------------------------------------------
    console.log('=== MANUAL CANONICAL (P0a identity) -> ARCHIVE -> ACCEPT ===');
    const g2 = await goalOf(A.id, 'Goal two');
    const r2 = await recurring(A.id, g2.id, 'Cardio two');
    const realBoot = { getSessionToken: () => 'tok', verifySession: () => ({ userId: A.id }) };
    const handoff = await resolveGoalActivityHandoff({ ...realBoot, listGoalActivities: (uid, gid) => listGoalActivitiesWithLinkedPlanStatus(uid, gid), loadGoalActivityRhythmFacts: (uid, gaId, tz) => loadGoalActivityRhythmFacts(uid, gaId, tz) }, g2.id, r2.id, DATE, TZ);
    const demand = await resolveAutomaticGoalDemand({ ...realBoot, ...createRealGoalDemandCandidatesDeps() }, DATE, TZ, handoff.map((h) => h.id));
    const marked = markCanonicalGoalDemandHandoff(handoff, demand.status === 'OK' ? demand.manualCanonicalGoalActivityIds : []);
    const rows2 = marked.map((m) => createIntentRowFromGoalHandoffItem(m, encodeGoalDemandIntentId(DATE, m.id)));
    const pv2 = await previewAs(A.id, bodyOf(rows2));
    check('the manual handoff produced the CANONICAL row while ACTIVE, with facts', rows2[0].id === encodeGoalDemandIntentId(DATE, r2.id) && !!facts(pv2, rows2[0].id)?.opportunity);
    await archiveGoal(A.id, g2.id);
    const s2a = await state(A.id, [r2.id]);
    const acc2 = await accept(A.id, acceptBody(pv2, rows2));
    check('manual canonical accepted after archive: REJECTED exactly like the automatic path, zero writes', REJECTED_NOT_ACTIVE(acc2) && same(s2a, await state(A.id, [r2.id])));

    // ------------------------------------------------------------------
    console.log('=== LEGACY plan-day-goal-* handoff (recurring AND finite) ===');
    const g3 = await goalOf(A.id, 'Goal three');
    const r3 = await recurring(A.id, g3.id, 'Cardio three');
    const f3 = (await addGoalActivity(A.id, g3.id, { title: 'Finite task', activityId: null }))!;
    const legacyRec = createIntentRowFromGoalActivity({ id: r3.id, title: 'Cardio three', activityId: 'workout' });
    const legacyFin = createIntentRowFromGoalActivity({ id: f3.id, title: 'Finite task', activityId: null });
    const pvL = await previewAs(A.id, bodyOf([legacyRec, legacyFin]));
    await archiveGoal(A.id, g3.id);
    const sL0 = await state(A.id, [r3.id, f3.id]);
    const accL = await accept(A.id, acceptBody(pvL, [legacyRec, legacyFin]));
    check('legacy ids + valid client goalActivityLinks for an ARCHIVED parent (recurring and finite): REJECTED, zero writes -- the same invariant, no path-specific bypass', REJECTED_NOT_ACTIVE(accL) && same(sL0, await state(A.id, [r3.id, f3.id])) && sL0.links === 0);

    // ------------------------------------------------------------------
    console.log('=== FORGED canonical id for an already-archived parent; archive -> preview ===');
    const g4 = await goalOf(A.id, 'Goal four');
    const r4 = await recurring(A.id, g4.id, 'Cardio four');
    await archiveGoal(A.id, g4.id);
    const rows4 = [canonicalRow(r4)];
    const pv4 = await previewAs(A.id, bodyOf(rows4));
    check('ARCHIVE -> PREVIEW: the provider already yields NO facts for an archived Goal (legitimate preview eligibility is not broadened)', pv4.status === 'READY' && facts(pv4, rows4[0].id) === undefined);
    const s4a = await state(A.id, [r4.id]);
    const acc4 = await accept(A.id, acceptBody(pv4, rows4));
    check('a forged / stale canonical id for an archived parent cannot create Goal provenance: REJECTED, zero writes', REJECTED_NOT_ACTIVE(acc4) && same(s4a, await state(A.id, [r4.id])));
    const acc4b = await accept(A.id, acceptBody(pv4, rows4)); // a different clientRequestId = a NEW acceptance after archive
    check('a different/new acceptance after archive also fails', REJECTED_NOT_ACTIVE(acc4b) && same(s4a, await state(A.id, [r4.id])));

    // ------------------------------------------------------------------
    console.log('=== REPLAY of an acceptance committed while ACTIVE ===');
    const g5 = await goalOf(A.id, 'Goal five');
    const r5 = await recurring(A.id, g5.id, 'Cardio five');
    const rows5 = [canonicalRow(r5)];
    const pv5 = await previewAs(A.id, bodyOf(rows5));
    const body5 = acceptBody(pv5, rows5, 'lc-replay-fixed');
    const acc5 = await accept(A.id, body5);
    await archiveGoal(A.id, g5.id);
    const s5a = await state(A.id, [r5.id]);
    const replay = await accept(A.id, { ...body5 });
    check('replay of the already-committed acceptance after archive stays ALREADY_ACCEPTED (a replay is not a new authorization event) and creates no duplicate', acc5.status === 'SAVED' && replay.status === 'ALREADY_ACCEPTED' && same(s5a, await state(A.id, [r5.id])));
    check('archiving did NOT retroactively touch the accepted plan, its occurrence or its link', (await occOf(r5.id)) === 1 && s5a.links === 1 && (await sql(`SELECT status FROM "PlannedActivity" WHERE id = $1`, [acc5.plans[0].id]))[0].status === 'UPCOMING');
    await logPlannedActivity(A.id, acc5.plans[0].id);
    check('and completing that already-authorized plan after archive still records history (archive is not history deletion)', (await state(A.id, [r5.id])).exec === 1);

    // ------------------------------------------------------------------
    console.log('=== MIXED requests: whole-request atomicity ===');
    const gOk = await goalOf(A.id, 'Active goal');
    const rOk = await recurring(A.id, gOk.id, 'Active cardio');
    const gBad = await goalOf(A.id, 'Soon archived');
    const rBad = await recurring(A.id, gBad.id, 'Doomed cardio');
    const typed = { ...createInitialIntentRow(), title: 'Write report' };
    const mixedRows = [typed, canonicalRow(rOk), canonicalRow(rBad)];
    const pvM = await previewAs(A.id, bodyOf(mixedRows));
    await archiveGoal(A.id, gBad.id);
    const sM0 = await state(A.id, [rOk.id, rBad.id]);
    const accM = await accept(A.id, acceptBody(pvM, mixedRows));
    const sM1 = await state(A.id, [rOk.id, rBad.id]);
    check('non-Goal item + ACTIVE-Goal item + ARCHIVED-Goal item in one request: the WHOLE request is rejected (existing all-or-nothing semantics), the archived Goal cannot sneak through', REJECTED_NOT_ACTIVE(accM) && same(sM0, sM1));
    check('mixed Goals: the ACTIVE Goal gets no occurrence/plan/link and the non-Goal item is not saved either (no cross-contamination, no partial write)', sM1.links === 0 && sM1.occ === sM0.occ && sM1.plans === sM0.plans);
    const onlyOk = [typed, canonicalRow(rOk)];
    const pvM2 = await previewAs(A.id, bodyOf(onlyOk));
    const accM2 = await accept(A.id, acceptBody(pvM2, onlyOk));
    check('the same non-Goal + ACTIVE-Goal request WITHOUT the archived item succeeds (the rejection was caused only by the archived Goal)', accM2.status === 'SAVED' && (await state(A.id, [rOk.id])).links === 1);

    // ------------------------------------------------------------------
    console.log('=== ordinary non-Goal planning is unaffected ===');
    const typedOnly = [{ ...createInitialIntentRow(), title: 'Pay the electricity bill' }];
    const pvT = await previewAs(A.id, bodyOf(typedOnly));
    check('a normal non-Goal intent is still accepted while Goals are archived', (await accept(A.id, acceptBody(pvT, typedOnly))).status === 'SAVED');

    // ------------------------------------------------------------------
    console.log('=== existing rejections unchanged ===');
    const gE = await goalOf(A.id, 'Exhausted goal');
    const rE = await recurring(A.id, gE.id, 'Exhausted cardio', 1);
    const donePlan = await createPlannedActivity({ userId: A.id, title: 'done', plannedStartAt: localDateTimeToUTC('2026-10-06', '08:00', TZ), plannedEndAt: localDateTimeToUTC('2026-10-06', '08:30', TZ), durationMinutes: 30, windowType: 'NEUTRAL' });
    await sql(`UPDATE "PlannedActivity" SET status = 'LOGGED' WHERE id = $1`, [donePlan.id]);
    await sql(`INSERT INTO "GoalActivityOccurrence"(id, "userId", "goalActivityId", "plannedActivityId") VALUES ('lc-occ-e', $1, $2, $3)`, [A.id, rE.id, donePlan.id]);
    await sql(`UPDATE "GoalActivity" SET "plannedActivityId" = $1 WHERE id = $2`, [donePlan.id, rE.id]);
    const rowsE = [canonicalRow(rE)];
    const pvE = await previewAs(A.id, bodyOf(rowsE));
    const sE0 = await state(A.id, [rE.id]);
    const accE = await accept(A.id, acceptBody(pvE, rowsE));
    check('ACTIVE Goal with ZERO remaining Rhythm capacity is still refused exactly as before (SAVE_FAILED, nothing written) -- ACTIVE is necessary, not sufficient', accE.status === 'SAVE_FAILED' && same(sE0, await state(A.id, [rE.id])));
    const gB = await goalOf(B.id, 'B goal');
    const rB = await recurring(B.id, gB.id, 'B cardio');
    const rowsX = [canonicalRow(rB)];
    const pvX = await previewAs(A.id, bodyOf(rowsX));
    const sX0 = await state(A.id);
    const accX = await accept(A.id, acceptBody(pvX, rowsX));
    check('cross-user: user A carrying user B\'s ACTIVE canonical id still cannot link or consume B\'s activity (unchanged)', accX.status !== 'SAVED' && accX.status !== 'ALREADY_ACCEPTED' && (await state(B.id, [rB.id])).occ === 0 && (await state(A.id)).links === sX0.links);
    const rowsMissing = [createIntentRowFromAutoGoalSuggestion({ title: 'ghost', activityId: 'workout', goalActivityId: 'no-such-activity' }, encodeGoalDemandIntentId(DATE, 'no-such-activity'))];
    const pvG = await previewAs(A.id, bodyOf(rowsMissing));
    const sG0 = await state(A.id);
    const accG = await accept(A.id, acceptBody(pvG, rowsMissing));
    check('a nonexistent activity still fails closed with zero writes (never treated as active)', accG.status !== 'SAVED' && same(sG0, await state(A.id)));

    // ------------------------------------------------------------------
    console.log('=== authority is the CURRENT persisted Goal state ===');
    const gS = await goalOf(A.id, 'Status goal');
    const rS = await recurring(A.id, gS.id, 'Status cardio');
    const rowsS = [canonicalRow(rS)];
    const pvS = await previewAs(A.id, bodyOf(rowsS));
    await sql(`UPDATE "Goal" SET status = 'SOMETHING_ELSE' WHERE id = $1`, [gS.id]);
    const sS0 = await state(A.id, [rS.id]);
    const accS = await accept(A.id, acceptBody(pvS, rowsS));
    check('an unrecognized persisted Goal status fails closed (only ACTIVE authorizes)', REJECTED_NOT_ACTIVE(accS) && same(sS0, await state(A.id, [rS.id])));
    await sql(`UPDATE "Goal" SET status = 'ACTIVE' WHERE id = $1`, [gS.id]);
    const accS2 = await accept(A.id, acceptBody(pvS, rowsS));
    check('the decision follows the Goal\'s state at acceptance time, not preview time: once ACTIVE again the same signed preview is authorized (no reactivation feature exists; this only proves the check reads current state)', accS2.status === 'SAVED' && (await state(A.id, [rS.id])).links === 1);

    // ------------------------------------------------------------------
    console.log('=== CONCURRENT archive vs acceptance (TOCTOU) ===');
    const gR = await goalOf(A.id, 'Race goal');
    const rR = await recurring(A.id, gR.id, 'Race cardio');
    const rowsR = [canonicalRow(rR)];
    const pvR = await previewAs(A.id, bodyOf(rowsR));
    const archiver = await beginTransaction();
    await archiver.query(`UPDATE "Goal" SET status = 'ARCHIVED', "archivedAt" = now() WHERE id = $1`, [gR.id]); // archive in flight, NOT yet committed
    let settled = false;
    const pending = accept(A.id, acceptBody(pvR, rowsR)).then((r) => {
      settled = true;
      return r;
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
    check('while the archive transaction is open, the acceptance WAITS on the Goal row instead of reading a stale ACTIVE and writing', settled === false);
    await archiver.query('COMMIT');
    archiver.release();
    const accR = await pending;
    check('once the archive commits, the waiting acceptance sees ARCHIVED and is rejected with zero Goal-derived writes', REJECTED_NOT_ACTIVE(accR) && (await occOf(rR.id)) === 0 && (await state(A.id, [rR.id])).links === 0);

    if (!allPassed) {
      console.error('SOME GOAL LIFECYCLE ARCHIVED ACCEPTANCE DB CHECKS FAILED');
      process.exit(1);
    }
    console.log('ALL GOAL LIFECYCLE ARCHIVED ACCEPTANCE DB CHECKS PASSED');
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
