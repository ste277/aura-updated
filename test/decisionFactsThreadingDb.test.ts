/**
 * Constructor Decision Intelligence -- Decision Facts V1, live-DB
 * integration proof of the CORRECTED architecture:
 *
 *   real GoalActivity + canonical Rhythm persistence
 *   -> Candidate A1 (loadEligibleGoalDemand, via the Goal-aware provider
 *      goalDecisionFactsProvider.ts -- the one source-specific boundary)
 *   -> generic DecisionFacts keyed by the canonical automatic intent id
 *   -> the real preview boundary (handleDayConstructorPreviewRequest ->
 *      Goal-blind orchestrator)
 *   -> facts visible on the resolved DayIntent (and, therefore, in the
 *      preview response -- visible to the client, never authoritative).
 *
 * No test-local fact injection anywhere in this file: every fact comes
 * from the real provider reading the real database.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/decisionFactsThreadingDb.test.ts
 */
import { upsertUserByEmail, updateBirthProfile, createGoalWithActivities, addGoalActivity, beginTransaction, logPlannedActivity, getUserById } from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { encodeGoalDemandIntentId } from '../apps/web/lib/goalDemandIntentId';
import { loadEligibleGoalDemand, createRealGoalDemandCandidatesDeps } from '../apps/web/lib/goalDemandCandidates';
import { createRealDayConstructorOrchestratorDeps } from '../apps/web/lib/dayConstructorOrchestrator';
import { handleDayConstructorPreviewRequest } from '../apps/web/lib/dayConstructorPreviewRequest';
import { loadGoalDecisionFacts } from '../apps/web/lib/goalDecisionFactsProvider';
import { parsePreviewResponseBody } from '../apps/web/lib/dayConstructorPreviewClient';
import { buildAcceptRequestBody } from '../apps/web/lib/acceptConstructedDay';
import { POST as acceptRoute } from '../apps/web/app/api/day-constructor/accept/route';

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

const iso = (s: string) => new Date(s);

async function main() {
  const user = await upsertUserByEmail({ email: 'test-decision-facts-v1@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const other = await upsertUserByEmail({ email: 'test-decision-facts-v1-other@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  for (const u of [user, other]) {
    await updateBirthProfile(u.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  }
  const token = createSessionToken(user.id, user.email);
  const ids = [user.id, other.id];

  const cleanup = async () => {
    await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = NULL WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "GoalActivity" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "Goal" WHERE "userId" = ANY($1::text[])`, [ids]);
  };
  await cleanup();

  // The real production preview boundary, wired EXACTLY as the route wires it.
  const previewRaw = async (now: Date, targetDate: string, intents: unknown[]) => {
    const result = await handleDayConstructorPreviewRequest({
      getSession: () => ({ userId: user.id }),
      getUser: (id) => getUserById(id),
      getBody: async () => ({ targetDate, intents }),
      now: () => now,
      createOrchestratorDeps: createRealDayConstructorOrchestratorDeps,
      loadDecisionFacts: (u, request) => loadGoalDecisionFacts(u, request),
    });
    return result;
  };
  const resolved = (result: { body: Record<string, unknown> }, id: string) => JSON.parse(JSON.stringify(result.body)).preview?.resolvedIntents?.find((r: any) => r.requestedIntentId === id);
  const fakeAcceptReq = (body: unknown): any => ({ cookies: { get: () => ({ value: token }) }, json: async () => body, headers: new Headers() });
  const accept = async (body: unknown) => (await acceptRoute(fakeAcceptReq(body))).json();

  try {
    const { goal } = await createGoalWithActivities({ userId: user.id, title: 'Get fitter', targetDate: null, activities: [] });
    const ga = await addGoalActivity(user.id, goal.id, { title: 'Morning cardio', activityId: 'workout' });
    await setRhythm(ga!.id, 3);
    const { goal: otherGoal } = await createGoalWithActivities({ userId: other.id, title: 'Other goal', targetDate: null, activities: [] });
    const otherGa = await addGoalActivity(other.id, otherGoal.id, { title: 'Other cardio', activityId: 'workout' });
    await setRhythm(otherGa!.id, 2);

    const DATE = '2026-10-06';
    const goalIntentId = encodeGoalDemandIntentId(DATE, ga!.id);
    const goalIntent = { id: goalIntentId, title: 'Morning cardio', flexibility: 'FLEXIBLE', activityId: 'workout' };
    const typedIntent = { id: 'typed-1', title: 'Write report', flexibility: 'FLEXIBLE' };

    console.log('=== REAL PIPELINE: RHYTHM FACTS -> GENERIC DECISION FACTS ===');
    const r1 = await previewRaw(iso('2026-10-06T02:00:00Z'), DATE, [goalIntent, typedIntent]);
    check('preview is READY through the real boundary with the real provider wired', (r1.body as any).status === 'READY');
    const goalResolved = resolved(r1, goalIntentId);
    const elig1 = await loadEligibleGoalDemand(createRealGoalDemandCandidatesDeps(), user.id, DATE, TZ);
    const candidate1 = elig1.status === 'OK' ? elig1.candidates.find((c) => c.goalActivityId === ga!.id) : undefined;
    const expected = candidate1 && { recurrence: { period: 'LOCAL_CALENDAR_WEEK', targetPerPeriod: candidate1.rhythm.targetPerWeek, completedInPeriod: candidate1.rhythm.completedThisWeek, committedInPeriod: candidate1.rhythm.committedThisWeek, remainingInPeriod: candidate1.rhythm.remainingOccurrences } };
    check('generic facts are present on the resolved intent', !!goalResolved?.dayIntent.decisionFacts?.recurrence);
    check('facts equal the canonical Candidate A1 Rhythm output, translated (target 3, 0 completed, 0 committed, 3 remaining)', JSON.stringify(goalResolved?.dayIntent.decisionFacts) === JSON.stringify(expected) && goalResolved?.dayIntent.decisionFacts?.recurrence?.targetPerPeriod === 3 && goalResolved?.dayIntent.decisionFacts?.recurrence?.remainingInPeriod === 3);
    check('the generic fact carries no Goal identity', !/goal/i.test(JSON.stringify(goalResolved?.dayIntent.decisionFacts)));
    check('a typed (non-Goal) intent in the same request carries no facts', resolved(r1, 'typed-1')?.dayIntent.decisionFacts === undefined);

    console.log('=== SERIALIZATION: VISIBLE TO THE CLIENT, NEVER AUTHORITATIVE ===');
    check('facts cross the preview HTTP body (server -> client visibility)', !!JSON.parse(JSON.stringify(r1.body)).preview.resolvedIntents.find((r: any) => r.requestedIntentId === goalIntentId)?.dayIntent?.decisionFacts);
    const parsed1 = parsePreviewResponseBody(JSON.parse(JSON.stringify(r1.body)), r1.httpStatus);
    const acceptBodyJson = parsed1.status === 'READY' ? JSON.stringify(buildAcceptRequestBody(parsed1.preview, 'x')) : '';
    check('the accept request body never echoes decision facts back (no client authority path)', acceptBodyJson.length > 0 && !/recurrence|remainingInPeriod|decisionFacts/.test(acceptBodyJson));

    console.log('=== TRUST: FACTS ARE SERVER-DERIVED FOR THE AUTHENTICATED USER ONLY ===');
    const otherId = encodeGoalDemandIntentId(DATE, otherGa!.id);
    const manualId = `plan-day-goal-${ga!.id}`;
    const wrongDateId = encodeGoalDemandIntentId('2026-10-07', ga!.id);
    const r2 = await previewRaw(iso('2026-10-06T02:00:00Z'), DATE, [
      { id: otherId, title: 'Other cardio', flexibility: 'FLEXIBLE', activityId: 'workout' },
      { id: manualId, title: 'Morning cardio (manual)', flexibility: 'FLEXIBLE', activityId: 'workout' },
      { id: wrongDateId, title: 'Morning cardio (wrong date id)', flexibility: 'FLEXIBLE', activityId: 'workout' },
    ]);
    check('another user\'s GoalActivity id yields no facts (provider is scoped to the authenticated user)', resolved(r2, otherId)?.dayIntent.decisionFacts === undefined);
    check('MANUAL Goal handoff rows (plan-day-goal-<id>) carry no facts -- Decision Facts V1 covers automatic Goal demand only (classification B)', resolved(r2, manualId)?.dayIntent.decisionFacts === undefined);
    check('an automatic id encoded for a different planning date yields no facts', resolved(r2, wrongDateId)?.dayIntent.decisionFacts === undefined);

    console.log('=== NO PERSISTENCE BEFORE ACCEPTANCE ===');
    const pre = await sql(
      `SELECT (SELECT count(*)::int FROM "PlannedActivity" WHERE "userId" = $1) AS plans, (SELECT count(*)::int FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $2) AS occ, (SELECT count(*)::int FROM "GoalActivityExecution" WHERE "goalActivityId" = $2) AS exec`,
      [user.id, ga!.id]
    );
    check('zero PlannedActivity/GoalActivityOccurrence/GoalActivityExecution rows after fact resolution and previews', pre[0].plans === 0 && pre[0].occ === 0 && pre[0].exec === 0);

    console.log('=== WEEKLY EXHAUSTION: INELIGIBLE ACTIVITY IS NEVER OFFERED (ELIGIBILITY STAYS UPSTREAM) ===');
    for (const [targetDate, nowStr] of [['2026-10-06', '2026-10-06T02:00:00Z'], ['2026-10-07', '2026-10-06T20:00:00Z'], ['2026-10-08', '2026-10-08T02:00:00Z']] as const) {
      const iid = encodeGoalDemandIntentId(targetDate, ga!.id);
      const pr = await previewRaw(iso(nowStr), targetDate, [{ id: iid, title: 'Morning cardio', flexibility: 'FLEXIBLE', activityId: 'workout' }]);
      const parsed = parsePreviewResponseBody(JSON.parse(JSON.stringify(pr.body)), pr.httpStatus);
      if (targetDate === '2026-10-07') {
        const f = resolved(pr, iid)?.dayIntent.decisionFacts?.recurrence;
        check('after one completion the carried facts reflect canonical accounting (1 completed, 2 remaining)', f?.completedInPeriod === 1 && f?.remainingInPeriod === 2);
      }
      const accepted = await accept(JSON.parse(JSON.stringify(buildAcceptRequestBody((parsed as any).preview, `df-${Date.now()}-${targetDate}`))));
      check(`exhaustion cycle (${targetDate}): accepted`, accepted.status === 'SAVED');
      await logPlannedActivity(user.id, accepted.plans[0].id);
    }
    const eligExhausted = await loadEligibleGoalDemand(createRealGoalDemandCandidatesDeps(), user.id, DATE, TZ);
    check('Candidate A no longer reports the exhausted activity eligible', eligExhausted.status === 'OK' && !eligExhausted.candidates.some((c) => c.goalActivityId === ga!.id));
    const r3 = await previewRaw(iso('2026-10-08T03:00:00Z'), '2026-10-08', [{ id: encodeGoalDemandIntentId('2026-10-08', ga!.id), title: 'Morning cardio', flexibility: 'FLEXIBLE', activityId: 'workout' }]);
    check('no facts are produced for the now-ineligible activity (the policy seam never receives it to suppress it)', resolved(r3, encodeGoalDemandIntentId('2026-10-08', ga!.id))?.dayIntent.decisionFacts === undefined);

    console.log('=== WEEK RESET (canonical Rhythm engine, no pre-generated rows) ===');
    const nextId = encodeGoalDemandIntentId('2026-10-12', ga!.id);
    const r4 = await previewRaw(iso('2026-10-12T02:00:00Z'), '2026-10-12', [{ id: nextId, title: 'Morning cardio', flexibility: 'FLEXIBLE', activityId: 'workout' }]);
    const f4 = resolved(r4, nextId)?.dayIntent.decisionFacts?.recurrence;
    check('next week the carried facts reset to the full target', f4?.targetPerPeriod === 3 && f4?.completedInPeriod === 0 && f4?.remainingInPeriod === 3);

    if (!allPassed) {
      console.error('SOME DECISION FACTS THREADING CHECKS FAILED');
      process.exit(1);
    }
    console.log('ALL DECISION FACTS THREADING CHECKS PASSED');
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
