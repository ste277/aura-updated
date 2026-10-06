/**
 * Constructor Decision Intelligence -- O5 P4c3: the pure active materializer over REAL Goal-occurrence data (DB-backed probe).
 *
 * The materializer is proven against fakes in activeResultMaterializer.test.ts. This probe runs the real stack -- the real preview boundary (session -> user -> body
 * -> clock -> real orchestrator deps), the real REPEATABLE READ decision scheduling snapshot, the real Goal / Rhythm / availability persistence and the real
 * recurrence facts (so DecisionPressure comes from real Goal occurrences) -- through the SHADOW composition, then applies the TEST-ONLY pure pipeline
 * (observations -> selector -> gate -> materializer) to the very run the boundary produced, over many seeded Goal / duration shapes. It proves, on real data:
 *
 *   - the pipeline's output is the BASELINE object or exactly ONE materialized result, and every materialized result satisfies the full property oracle
 *   - the selector and the materializer send ZERO SQL statements and perform no write (they are pure over the run)
 *   - the baseline response is unchanged by the observation (parity with the plain preview)
 *   - incidence of ACCEPT / APPLY / materialized / unavailable reasons on real data (reported)
 *
 * Requires DATABASE_URL (fresh, 43 migrations).
 */
import path from 'path';
import { seededRandom, seededShuffle } from './fixtureSupport';
import { activeViolations, snap } from './activeMaterializerOracle';
import { upsertUserByEmail, updateBirthProfile, createGoalWithActivities, addGoalActivity, beginTransaction, replaceUserAvailabilityConfiguration, getUserById } from '../apps/web/lib/db';
import { createRealDayConstructorOrchestratorDeps, type ConstructDayRequest, type OrchestrateConstructDayResult } from '../apps/web/lib/dayConstructorOrchestrator';
import { handleDayConstructorPreviewRequest, type DayConstructorPreviewBoundaryDeps } from '../apps/web/lib/dayConstructorPreviewRequest';
import { loadGoalDecisionFacts, createGoalDemandDepsFromSchedulingContext } from '../apps/web/lib/goalDecisionFactsProvider';
import { createRealGoalDemandCandidatesDeps, loadEligibleGoalDemand } from '../apps/web/lib/goalDemandCandidates';
import { createIntentRowFromAutoGoalSuggestion, buildRequestedIntentsForSubmission, type PlanDayIntentRow } from '../apps/web/lib/planDayEntry';
import { encodeGoalDemandIntentId } from '../apps/web/lib/goalDemandIntentId';
import { loadDecisionSchedulingContext } from '../apps/web/lib/decisionSchedulingContextLoader';
import { observeShadowPolicy } from '../apps/web/lib/shadowPolicyObservation';
import { selectActiveCounterfactual } from '../apps/web/lib/activeSelector';
import { materializeActiveResult } from '../apps/web/lib/activeResultMaterializer';
import { sortByOverloadPrecedence, type DayIntent } from '../apps/web/lib/dayIntent';
import { signPreviewResultBody, verifyAcceptanceItems } from '../apps/web/lib/dayConstructorPreviewIntegrity';
import { evaluateAcceptance } from '../apps/web/lib/dayConstructorAcceptance';
import { localDateTimeToUTC } from '../apps/web/lib/timezone';
import { FULL_ACTIVITY_CATALOG } from '../packages/recommendation/src/personalizedTasks';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pg = require(require.resolve('pg', { paths: [path.join(__dirname, '..', 'apps', 'web')] })) as { Client: { prototype: { query: (...args: any[]) => any } } };

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const TZ = 'Asia/Kolkata';
const FRIDAY = '2026-10-09';
const EMAIL = 'test-p4c3-active-materializer@example.com';

async function sql(text: string, params: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(text, params); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

/** Every SQL statement any connection sends while `fn` runs. */
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
  await updateBirthProfile(u.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  const cleanup = async () => {
    await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [u.id]);
    await sql(`DELETE FROM "GoalActivityOccurrence" WHERE "userId" = $1`, [u.id]);
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [u.id]);
    await sql(`DELETE FROM "HabitLog" WHERE "userId" = $1`, [u.id]);
    await sql(`DELETE FROM "UserActivityPreference" WHERE "userId" = $1`, [u.id]);
    await sql(`DELETE FROM "GoalActivity" WHERE "userId" = $1`, [u.id]);
    await sql(`DELETE FROM "Goal" WHERE "userId" = $1`, [u.id]);
    await sql(`DELETE FROM "UserAvailabilityPeriod" WHERE "userId" = $1`, [u.id]);
    await sql(`UPDATE "User" SET "availabilityConfigured" = false WHERE id = $1`, [u.id]);
  };
  await cleanup();
  try {
    await replaceUserAvailabilityConfiguration(u.id, [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })));
    const goal = (await createGoalWithActivities({ userId: u.id, title: 'Active materializer goal', targetDate: null, activities: [] })).goal;
    const rhythm = { kind: 'N_PER_WEEK' as const, targetPerWeek: 3 };
    const activities: Array<{ id: string }> = [];
    for (const catalog of FULL_ACTIVITY_CATALOG.slice(0, 11)) activities.push((await addGoalActivity(u.id, goal.id, { title: `GA ${catalog.id}`, activityId: catalog.id, rhythm }))!);
    const eligible = await loadEligibleGoalDemand(createRealGoalDemandCandidatesDeps(), u.id, FRIDAY, TZ);
    const baseRows: PlanDayIntentRow[] = activities.map((ga) => {
      const c = (eligible as any).candidates.find((x: any) => x.goalActivityId === ga.id);
      return createIntentRowFromAutoGoalSuggestion({ title: c.title, activityId: c.activityId, goalActivityId: c.goalActivityId }, encodeGoalDemandIntentId(FRIDAY, ga.id));
    });
    const now = localDateTimeToUTC(FRIDAY, '09:00', TZ);
    const counts = async () => JSON.stringify((await sql(`SELECT (SELECT count(*)::int FROM "PlannedActivity" WHERE "userId" = $1) AS plans, (SELECT count(*)::int FROM "GoalActivityOccurrence" WHERE "userId" = $1) AS occ, (SELECT count(*)::int FROM "GoalActivity" WHERE "userId" = $1) AS ga, (SELECT count(*)::int FROM "HabitLog" WHERE "userId" = $1) AS logs`, [u.id]))[0]);
    type Observed = Awaited<ReturnType<typeof observeShadowPolicy>>;
    interface Captured { observed?: Observed; request?: ConstructDayRequest }
    const boundary = (rows: PlanDayIntentRow[], captured?: Captured): DayConstructorPreviewBoundaryDeps => ({
      getSession: () => ({ userId: u.id }), getUser: (id) => getUserById(id), getBody: async () => ({ intents: buildRequestedIntentsForSubmission(rows, TZ, FRIDAY) }), now: () => now,
      createOrchestratorDeps: createRealDayConstructorOrchestratorDeps,
      loadSchedulingContext: (usr, request) => loadDecisionSchedulingContext({ userId: usr.id, planningDate: request.targetDate, timezone: request.timezone }),
      loadDecisionFactsFromContext: (usr, request, context) => loadGoalDecisionFacts(usr, request, createGoalDemandDepsFromSchedulingContext(context)),
      ...(captured ? { shadowPolicy: () => ({ mode: 'SHADOW' as const, observe: async (request: ConstructDayRequest, deps: any, onBaseline?: (r: OrchestrateConstructDayResult) => void) => { captured.request = request; captured.observed = await observeShadowPolicy(request, deps, onBaseline); return captured.observed; } }) } : {}),
    });

    const rnd = seededRandom(20261009);
    const DURATIONS = [60, 90, 120, 150, 180, 240];
    const scenarios: Array<{ n: number; durations: number[]; pick?: number[] }> = [
      { n: 2, durations: [120, 240], pick: [3, 10] }, { n: 11, durations: Array(11).fill(120) }, { n: 5, durations: Array(5).fill(180) }, { n: 2, durations: [240, 240] }, { n: 2, durations: [300, 180] }, { n: 3, durations: Array(3).fill(180) }, { n: 4, durations: Array(4).fill(150) }, { n: 4, durations: [240, 120, 120, 60] }, { n: 3, durations: [300, 120, 90] }, { n: 6, durations: Array(6).fill(90) },
    ];
    const EXTRA = Number(process.env.P4C3_DB_EXTRA_SCENARIOS ?? 40);
    for (let k = 0; k < EXTRA; k += 1) { const n = 2 + Math.floor(rnd() * 6); scenarios.push({ n, durations: Array.from({ length: n }, () => DURATIONS[Math.floor(rnd() * DURATIONS.length)]), pick: seededShuffle(baseRows.map((_, i) => i), rnd).slice(0, n) }); }

    const outcomes: Record<string, number> = {};
    const tally = { runs: 0, ready: 0, evaluated: 0, withObservations: 0, accepts: 0, apply: 0, materialized: 0, unavailable: {} as Record<string, number>, noChange: {} as Record<string, number>, baselineIdentity: 0, violations: 0, nonZeroSqlPure: 0, bodyMismatch: 0, writes: 0 };
    let firstViolation = '';
    const materializedResults: Array<Extract<OrchestrateConstructDayResult, { status: 'READY' }>> = [];
    for (const sc of scenarios) {
      const rows = (sc.pick ? sc.pick.map((i) => baseRows[i]) : baseRows.slice(0, sc.n)).map((row, i) => ({ ...row, durationMinutes: sc.durations[i] }));
      const before = await counts();
      const plain = await handleDayConstructorPreviewRequest(boundary(rows));
      const captured: Captured = {};
      const shadow = await handleDayConstructorPreviewRequest(boundary(rows, captured));
      const after = await counts();
      tally.runs += 1;
      if (shadow.httpStatus !== 200 || (shadow.body as { status?: string }).status !== 'READY' || !captured.observed || !captured.request) continue;
      tally.ready += 1;
      if (snap(plain.body) !== snap(shadow.body)) tally.bodyMismatch += 1;
      if (before !== after) tally.writes += 1;
      const observed = captured.observed;
      if (observed.shadowPolicy.status !== 'READY') continue;
      tally.evaluated += 1;
      tally.withObservations += observed.shadowPolicy.observations.length > 0 ? 1 : 0;
      for (const o of observed.shadowPolicy.observations) { const key = o.outcome === 'ACCEPT' ? 'ACCEPT' : `${o.outcome}:${o.reason}`; outcomes[key] = (outcomes[key] ?? 0) + 1; }
      tally.accepts += observed.shadowPolicy.observations.filter((o) => o.outcome === 'ACCEPT').length;
      const piped = await capturing(() => {
        const selection = selectActiveCounterfactual(observed.shadowPolicy);
        if (selection.status !== 'APPLY') return { kind: 'BASELINE' as const, reason: selection.reason };
        const accepted = selection.acceptedCounterfactual;
        const m = materializeActiveResult({ baselineResult: observed.result, constructionBasis: accepted.constructionBasis, accepted });
        return m.status === 'READY' ? { kind: 'ACTIVE' as const, accepted, result: m.result } : { kind: 'BASELINE' as const, reason: m.reason, applied: true };
      });
      if (piped.statements.length > 0) tally.nonZeroSqlPure += 1;
      const out = piped.value;
      if (out.kind === 'BASELINE') {
        tally.baselineIdentity += 1;
        if ('applied' in out) tally.unavailable[out.reason] = (tally.unavailable[out.reason] ?? 0) + 1; else tally.noChange[out.reason] = (tally.noChange[out.reason] ?? 0) + 1;
        if ('applied' in out) tally.apply += 1;
        continue;
      }
      tally.apply += 1; tally.materialized += 1;
      materializedResults.push(out.result);
      const basis = out.accepted.constructionBasis;
      if (basis.status !== 'READY') { tally.violations += 1; continue; }
      const intentById = new Map(basis.basis.intents.map((i) => [i.id, i]));
      const order = sortByOverloadPrecedence(basis.basis.intents as unknown as readonly DayIntent[], basis.basis.planningDate).map((i) => i.id);
      const vs = activeViolations(observed.result, out.result, out.accepted, { order, titleOf: (id) => intentById.get(id)?.title, durationMinutesOf: (id) => intentById.get(id)?.estimatedDurationMinutes });
      if (vs.length > 0) { tally.violations += 1; if (!firstViolation) firstViolation = vs.join('; '); }
    }
    console.log(`     real-data incidence: ${JSON.stringify(tally)}`);
    console.log(`     real-data observation outcomes: ${JSON.stringify(outcomes)}`);
    if (firstViolation) console.log(`     first violation: ${firstViolation}`);
    check('every scenario ran the real preview boundary to a READY 200 with a captured same-run shadow observation (HTTP, snapshot, Goal facts and real orchestrator deps)', tally.ready === tally.runs && tally.runs === scenarios.length);
    check('PARITY: the preview body with the observation in the loop equals the plain preview body for every scenario (the active pieces consume the run, they do not change it)', tally.bodyMismatch === 0);
    check('NO WRITES: the domain row counts are unchanged by every run', tally.writes === 0);
    check('PURE ON REAL DATA: the selector and the materializer sent ZERO SQL statements in every scenario', tally.nonZeroSqlPure === 0);
    check(`the pipeline output is the BASELINE or exactly ONE materialized result in every evaluated scenario: ${tally.baselineIdentity} baseline + ${tally.materialized} materialized = ${tally.evaluated} evaluated`, tally.baselineIdentity + tally.materialized === tally.evaluated && tally.evaluated === tally.ready);
    check(`EVERY MATERIALIZED RESULT ON REAL DATA satisfies the property oracle (${tally.materialized} materialized, ${tally.violations} violations)`, tally.violations === 0);
    check('A REAL ACCEPT MATERIALIZES: the pinned real Goal-occurrence scenario (2 Goal activities, 2 h + 4 h, scarce last day) yields a real P4b3 ACCEPT that the pure pipeline materializes', tally.accepts >= 1 && tally.materialized >= 1);
    if (materializedResults.length > 0) {
      const signed = signPreviewResultBody(u.id, materializedResults[0] as unknown as Record<string, unknown>) as { preview: { constructionWindow: any; constructedDay: { proposedItems: Array<Record<string, any>> } } };
      const items = signed.preview.constructedDay.proposedItems;
      const acceptedItems = items.map((i) => ({ intentId: i.intentId, activityId: i.activityId, title: i.title, start: i.start, end: i.end, placementSource: i.placementSource }));
      check('SIGNING ON REAL DATA: every item of the real materialized result carries a token that the acceptance-side gate verifies', items.every((i) => typeof i.acceptanceToken === 'string') && verifyAcceptanceItems(u.id, signed.preview.constructionWindow, acceptedItems as any, new Map(items.map((i) => [i.intentId as string, i.acceptanceToken]))).length === 0);
      const decision = await evaluateAcceptance({ clientRequestId: 'p4c3-db', constructionWindow: signed.preview.constructionWindow, proposedItems: acceptedItems as any }, { loadFreshBlockers: async () => [], validateActivity: () => true, checkTiming: (r) => ({ start: r.candidateStart.toISOString(), end: new Date(r.candidateStart.getTime() + r.durationMinutes * 60000).toISOString(), score: 7, label: 'GOOD', muhurtaScore: 0, reasons: [], metadata: { windowType: 'NEUTRAL' as never, windowLabel: '', activityType: '', dateLabel: '' } }) }, now);
      check(`EXISTING ACCEPTANCE VALIDATION on the real materialized day: ACCEPTABLE with ${decision.status === 'ACCEPTABLE' ? decision.writeIntents.length : decision.status} write intents`, decision.status === 'ACCEPTABLE' && decision.writeIntents.length === items.length);
    }
    console.log(`     real-data ACCEPT incidence: ${tally.accepts} ACCEPT observations across ${tally.runs} runs, ${tally.apply} APPLY, ${tally.materialized} materialized`);
  } finally {
    await cleanup();
    await sql(`DELETE FROM "User" WHERE email = $1`, [EMAIL]).catch(() => {});
  }
  if (!allPassed) { console.error('SOME ACTIVE MATERIALIZER DB CHECKS FAILED'); process.exitCode = 1; return; }
  console.log('ALL ACTIVE MATERIALIZER DB CHECKS PASSED');
}
main().then(() => process.exit(), (err) => { console.error(err); process.exit(1); });
