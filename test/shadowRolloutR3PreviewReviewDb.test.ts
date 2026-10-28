/**
 * O5 SHADOW ROLLOUT R3 -- the Preview-only manual review harness, over REAL Goal-occurrence data (DB-backed proof).
 *
 * Reuses the SAME directed real-ACCEPT fixture as activeResultMaterializerDb.test.ts (real Goal/GoalActivity/Rhythm persistence,
 * real REPEATABLE READ snapshot, real orchestrator, real astronomical timing search, the ordered combination family that
 * reaches a real P4b3 ACCEPT), then proves on the real stack:
 *
 *   - Preview-eligible + SHADOW: the response carries `shadowReview`, describing the actual materialized delta, with
 *     ZERO additional SQL/writes and the IDENTICAL statement sequence to the plain preview
 *   - Production (reviewEligible=false) + the SAME SHADOW run: NO `shadowReview` field at all
 *   - the review alternative has no token and is rejected by the REAL route-level verification gate, using this run's
 *     OWN real userId and construction window
 *   - normal baseline acceptance (the existing owner Plan) still SAVES through the real persistence path, unaffected
 *
 * Requires DATABASE_URL (fresh, 43 migrations).
 */
import path from 'path';
import { upsertUserByEmail, updateBirthProfile, createGoalWithActivities, addGoalActivity, beginTransaction, replaceUserAvailabilityConfiguration, getUserById } from '../apps/web/lib/db';
import { createRealDayConstructorOrchestratorDeps, type OrchestrateConstructDayResult } from '../apps/web/lib/dayConstructorOrchestrator';
import { handleDayConstructorPreviewRequest, type DayConstructorPreviewBoundaryDeps } from '../apps/web/lib/dayConstructorPreviewRequest';
import { loadGoalDecisionFacts, createGoalDemandDepsFromSchedulingContext } from '../apps/web/lib/goalDecisionFactsProvider';
import { createRealGoalDemandCandidatesDeps, loadEligibleGoalDemand } from '../apps/web/lib/goalDemandCandidates';
import { createIntentRowFromAutoGoalSuggestion, buildRequestedIntentsForSubmission, type PlanDayIntentRow } from '../apps/web/lib/planDayEntry';
import { encodeGoalDemandIntentId } from '../apps/web/lib/goalDemandIntentId';
import { loadDecisionSchedulingContext } from '../apps/web/lib/decisionSchedulingContextLoader';
import { observeShadowPolicy } from '../apps/web/lib/shadowPolicyObservation';
import type { ShadowPolicyExecution, ShadowPolicyMetrics } from '../apps/web/lib/shadowPolicyExecution';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import { authorizeGoalActivityLinks } from '../apps/web/lib/goalDemandProvenanceAuthorization';
import { verifyAcceptanceItems, verifyPreviewItem } from '../apps/web/lib/dayConstructorPreviewIntegrity';
import { localDateTimeToUTC } from '../apps/web/lib/timezone';
import { FULL_ACTIVITY_CATALOG } from '../packages/recommendation/src/personalizedTasks';
import type { ShadowReviewPayload } from '../apps/web/lib/shadowReviewDelta';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pg = require(require.resolve('pg', { paths: [path.join(__dirname, '..', 'apps', 'web')] })) as { Client: { prototype: { query: (...args: any[]) => any } } };

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const TZ = 'Asia/Kolkata';
const FRIDAY = '2026-10-09';
const EMAIL = 'test-r3-preview-review@example.com';
const BIRTH_CIVIL_DATE = '1990-06-15';

async function sql(text: string, params: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(text, params); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

async function capturing<T>(fn: () => Promise<T> | T): Promise<{ value: T; statements: string[] }> {
  const statements: string[] = [];
  const original = pg.Client.prototype.query;
  pg.Client.prototype.query = function (...args: any[]) {
    const first = args[0];
    const text = typeof first === 'string' ? first : typeof first?.text === 'string' ? first.text : undefined;
    if (text !== undefined) statements.push(text.replace(/\s+/g, ' ').trim());
    return original.apply(this, args);
  };
  try { return { value: await fn(), statements }; } finally { pg.Client.prototype.query = original; }
}

async function main() {
  const u = await upsertUserByEmail({ email: EMAIL, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await updateBirthProfile(u.id, { birthDate: BIRTH_CIVIL_DATE, birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  const cleanup = async () => {
    await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [u.id]);
    await sql(`DELETE FROM "GoalActivityOccurrence" WHERE "userId" = $1`, [u.id]);
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [u.id]);
    await sql(`DELETE FROM "GoalActivity" WHERE "userId" = $1`, [u.id]);
    await sql(`DELETE FROM "Goal" WHERE "userId" = $1`, [u.id]);
    await sql(`DELETE FROM "UserAvailabilityPeriod" WHERE "userId" = $1`, [u.id]);
    await sql(`UPDATE "User" SET "availabilityConfigured" = false WHERE id = $1`, [u.id]);
  };
  await cleanup();
  try {
    await replaceUserAvailabilityConfiguration(u.id, [1, 2, 3, 4, 5].flatMap((weekday) => [{ weekday, startTime: '09:00', endTime: '13:00' }, { weekday, startTime: '15:00', endTime: '17:00' }]));
    const goal = (await createGoalWithActivities({ userId: u.id, title: 'R3 review goal', targetDate: null, activities: [] })).goal;
    const rhythm = { kind: 'N_PER_WEEK' as const, targetPerWeek: 3 };
    const activities: Array<{ id: string }> = [];
    for (const catalog of FULL_ACTIVITY_CATALOG.slice(0, 11)) activities.push((await addGoalActivity(u.id, goal.id, { title: `GA ${catalog.id}`, activityId: catalog.id, rhythm }))!);
    const eligible = await loadEligibleGoalDemand(createRealGoalDemandCandidatesDeps(), u.id, FRIDAY, TZ);
    const baseRows: PlanDayIntentRow[] = activities.map((ga) => {
      const c = (eligible as any).candidates.find((x: any) => x.goalActivityId === ga.id);
      return createIntentRowFromAutoGoalSuggestion({ title: c.title, activityId: c.activityId, goalActivityId: c.goalActivityId }, encodeGoalDemandIntentId(FRIDAY, ga.id));
    });
    const now = localDateTimeToUTC(FRIDAY, '09:00', TZ);
    const acceptanceNow = localDateTimeToUTC(FRIDAY, '08:30', TZ);
    const counts = async () => JSON.stringify((await sql(`SELECT (SELECT count(*)::int FROM "PlannedActivity" WHERE "userId" = $1) AS plans, (SELECT count(*)::int FROM "GoalActivityOccurrence" WHERE "userId" = $1) AS occ`, [u.id]))[0]);

    const boundary = (rows: PlanDayIntentRow[], execution?: ShadowPolicyExecution): DayConstructorPreviewBoundaryDeps => ({
      getSession: () => ({ userId: u.id }), getUser: (id) => getUserById(id), getBody: async () => ({ intents: buildRequestedIntentsForSubmission(rows, TZ, FRIDAY) }), now: () => now,
      createOrchestratorDeps: createRealDayConstructorOrchestratorDeps,
      loadSchedulingContext: (usr, request) => loadDecisionSchedulingContext({ userId: usr.id, planningDate: request.targetDate, timezone: request.timezone }),
      loadDecisionFactsFromContext: (usr, request, context) => loadGoalDecisionFacts(usr, request, createGoalDemandDepsFromSchedulingContext(context)),
      ...(execution ? { shadowPolicy: () => execution } : {}),
    });

    // The SAME ordered family as activeResultMaterializerDb.test.ts, which reliably ACCEPTs 5-6-60-240 first on the real astronomical search.
    const CURATED: Array<[number, number, number, number]> = [
      [5, 6, 60, 240], [4, 10, 120, 240], [0, 1, 60, 240], [10, 6, 60, 240], [7, 10, 60, 240], [6, 1, 60, 240], [4, 6, 60, 240], [5, 1, 120, 240],
      [0, 2, 60, 240], [10, 1, 60, 240], [7, 2, 60, 240], [4, 1, 60, 240], [6, 5, 120, 240], [5, 3, 120, 240], [6, 9, 120, 240], [10, 9, 60, 240],
    ];
    const FAMILY: Array<[number, number, number, number]> = [...CURATED];
    for (const dOwner of [60, 120]) for (let i = 0; i < baseRows.length; i += 1) for (let j = 0; j < baseRows.length; j += 1) if (i !== j && !CURATED.some((c) => c[0] === i && c[1] === j && c[2] === dOwner && c[3] === 240)) FAMILY.push([i, j, dOwner, 240]);

    const trace: string[] = [];
    let directed: { rows: PlanDayIntentRow[] } | undefined;
    for (const [i, j, dOwner, dCandidate] of FAMILY) {
      const rows = [baseRows[i], baseRows[j]].map((row, k) => ({ ...row, durationMinutes: k === 0 ? dOwner : dCandidate }));
      const metrics: ShadowPolicyMetrics[] = [];
      const response = await handleDayConstructorPreviewRequest(boundary(rows, { mode: 'SHADOW', reviewEligible: true, sink: { record: (m) => { metrics.push(m); } } }));
      const accepts = metrics[0]?.accepted ?? -1;
      trace.push(`${i}-${j}-${dOwner}-${dCandidate}:${response.httpStatus}:${accepts}`);
      if (response.httpStatus === 200 && accepts === 1 && metrics[0]?.evidence.invariant === 'PASS') { directed = { rows }; break; }
    }
    console.log(`     directed family trace (combo:http:ACCEPTs): ${trace.join(' ')}`);
    check(`A DETERMINISTIC REAL ACCEPT REACHING PASS: found one after ${trace.length} of ${FAMILY.length} combinations`, directed !== undefined);
    if (!directed) throw new Error('no directed combination reached PASS');

    // ======================================================================
    console.log('=== Preview-eligible + SHADOW: review payload present, zero extra writes, identical SQL to plain ===');
    const before = await counts();
    const plain = await capturing(() => handleDayConstructorPreviewRequest(boundary(directed!.rows)));
    const previewMetrics: ShadowPolicyMetrics[] = [];
    const withReview = await capturing(() => handleDayConstructorPreviewRequest(boundary(directed!.rows, { mode: 'SHADOW', reviewEligible: true, sink: { record: (m) => { previewMetrics.push(m); } } })));
    const after = await counts();
    const review = (withReview.value.body as any).shadowReview as ShadowReviewPayload | undefined;
    check('the evidence reaches APPLY / MATERIALIZABLE / READY / PASS on this real run', previewMetrics[0]?.evidence.selector === 'APPLY' && previewMetrics[0]?.evidence.gate === 'MATERIALIZABLE' && previewMetrics[0]?.evidence.materializer === 'READY' && previewMetrics[0]?.evidence.invariant === 'PASS');
    check('the review payload EXISTS and describes a real PROMOTED + MOVED delta', review !== undefined && review.changedItems.some((c) => c.kind === 'PROMOTED') && review.changedItems.some((c) => c.kind === 'MOVED'));
    check('BASELINE UNCHANGED: the response body equals the plain preview body byte for byte, aside from the shadowReview sibling field', JSON.stringify({ ...withReview.value.body, shadowReview: undefined }) === JSON.stringify({ ...plain.value.body, shadowReview: undefined }));
    check('IDENTICAL SQL SEQUENCE and ZERO additional writes: no Plan / GoalActivityOccurrence row changed by generating the review', JSON.stringify(withReview.statements) === JSON.stringify(plain.statements) && before === after && !withReview.statements.some((t) => /^(INSERT|UPDATE|DELETE)\b/i.test(t)));

    // ======================================================================
    console.log('=== Production (reviewEligible=false) with the SAME SHADOW run: no shadowReview at all ===');
    const prodMetrics: ShadowPolicyMetrics[] = [];
    const prod = await handleDayConstructorPreviewRequest(boundary(directed.rows, { mode: 'SHADOW', reviewEligible: false, sink: { record: (m) => { prodMetrics.push(m); } } }));
    check('Production: HTTP 200, no shadowReview key, while the aggregate evidence still reaches PASS internally', prod.httpStatus === 200 && !('shadowReview' in prod.body) && prodMetrics[0]?.evidence.invariant === 'PASS');

    // ======================================================================
    console.log('=== the review alternative is rejected by the REAL route-level gate (this run\'s own user/window) ===');
    const window = (withReview.value.body as any).preview.constructionWindow;
    const realWindow = { ...window, start: new Date(window.start), end: new Date(window.end) };
    const alt = review!.changedItems.find((c) => c.kind === 'PROMOTED')!;
    const fakeSubmission = { intentId: alt.intentId, title: alt.title, start: new Date(alt.alternative.start!), end: new Date(alt.alternative.end!), activityId: undefined };
    const noToken = verifyPreviewItem({ userId: u.id, window: realWindow, item: fakeSubmission as any }, undefined);
    check('the review alternative has no acceptanceToken -> rejected before any write (the real accept route\'s own first gate)', noToken.ok === false);

    // ======================================================================
    console.log('=== normal baseline acceptance still SAVES, unaffected by R3 ===');
    const ownerItem = ((withReview.value.body as any).preview.constructedDay.proposedItems as Array<Record<string, any>>)[0];
    const acceptedItem = { intentId: ownerItem.intentId, activityId: ownerItem.activityId, title: ownerItem.title, start: new Date(ownerItem.start), end: new Date(ownerItem.end), placementSource: ownerItem.placementSource };
    const tokens = new Map([[ownerItem.intentId, ownerItem.acceptanceToken]]);
    check('SIGNING UNCHANGED: the real baseline owner item still carries a valid token', verifyAcceptanceItems(u.id, realWindow, [acceptedItem] as any, tokens).length === 0);
    const rawLinks = new Map([[ownerItem.intentId as string, directed.rows.find((r) => r.id === ownerItem.intentId)!.goalActivityId as string]]);
    const authorization = authorizeGoalActivityLinks([acceptedItem] as any, realWindow.date, rawLinks);
    const saved = authorization.status === 'REJECTED' ? undefined : await persistAcceptedConstructedDay(u.id, { clientRequestId: `r3-baseline-accept-${FRIDAY}`, constructionWindow: realWindow, proposedItems: [acceptedItem] as any }, acceptanceNow, authorization.goalActivityLinks);
    if (saved && saved.status !== 'SAVED') console.log('     persistence result:', JSON.stringify(saved));
    check('REAL ACCEPTANCE PERSISTENCE of the normal baseline item still SAVES exactly as before R3', saved !== undefined && saved.status === 'SAVED');
  } finally {
    await cleanup();
    await sql(`DELETE FROM "User" WHERE email = $1`, [EMAIL]).catch(() => {});
  }
  if (!allPassed) { console.error('SOME SHADOW ROLLOUT R3 PREVIEW REVIEW DB CHECKS FAILED'); process.exitCode = 1; return; }
  console.log('ALL SHADOW ROLLOUT R3 PREVIEW REVIEW DB CHECKS PASSED');
}
main().then(() => process.exit(), (err) => { console.error(err); process.exit(1); });
