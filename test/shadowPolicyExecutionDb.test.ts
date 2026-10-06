/**
 * Constructor Decision Intelligence -- O5 P4b5: live-database OFF vs SHADOW PARITY through the PRODUCTION snapshot wiring (DB-backed).
 *
 * The shadow execution boundary is the first production consumer of the shadow composition, so its safety is proven against the real stack, not only
 * against fakes: the real preview boundary (session -> user -> body -> clock -> real orchestrator deps), the real REPEATABLE READ decision scheduling
 * snapshot (`loadDecisionSchedulingContext`), the real Goal / Rhythm / availability persistence and the real signing -- exactly the closures the preview
 * route passes -- run for the SAME request and data under
 *
 *   OFF     (no settings, and the default server settings with the variable unset)
 *   SHADOW  (the server settings with AURA_SHADOW_POLICY_MODE=SHADOW)
 *
 * and compared on: HTTP status, the preview body (items, signed tokens), the exact SEQUENCE of SQL statements the process sent (so no additional query, no
 * second snapshot, no write, no transaction), the snapshot loads, the domain row counts, and the Constructor result. A shadow observation is also produced
 * (the run reaches READY evaluation over real pressure / contention), proving the parity covers an EXECUTED shadow, not a skipped one.
 * Requires DATABASE_URL (fresh, 43 migrations).
 */
import path from 'path';
import { upsertUserByEmail, updateBirthProfile, createGoalWithActivities, addGoalActivity, beginTransaction, replaceUserAvailabilityConfiguration, getUserById } from '../apps/web/lib/db';
import { createRealDayConstructorOrchestratorDeps } from '../apps/web/lib/dayConstructorOrchestrator';
import { handleDayConstructorPreviewRequest, type DayConstructorPreviewBoundaryDeps } from '../apps/web/lib/dayConstructorPreviewRequest';
import { loadGoalDecisionFacts, createGoalDemandDepsFromSchedulingContext } from '../apps/web/lib/goalDecisionFactsProvider';
import { createRealGoalDemandCandidatesDeps, loadEligibleGoalDemand } from '../apps/web/lib/goalDemandCandidates';
import { createIntentRowFromAutoGoalSuggestion, buildRequestedIntentsForSubmission, type PlanDayIntentRow } from '../apps/web/lib/planDayEntry';
import { encodeGoalDemandIntentId } from '../apps/web/lib/goalDemandIntentId';
import { loadDecisionSchedulingContext } from '../apps/web/lib/decisionSchedulingContextLoader';
import { createServerShadowPolicyExecution, SHADOW_POLICY_MODE_ENV, type ShadowPolicyMetrics } from '../apps/web/lib/shadowPolicyExecution';
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
const EMAIL = 'test-p4b5-shadow-parity@example.com';

async function sql(text: string, params: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(text, params); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

/** Every SQL statement any connection sends while `fn` runs (the process-wide `pg` client; the pool's queries and the snapshot transaction both go through it). */
async function capturing<T>(fn: () => Promise<T>): Promise<{ value: T; statements: string[] }> {
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
  const savedMode = process.env[SHADOW_POLICY_MODE_ENV];
  try {
    await replaceUserAvailabilityConfiguration(u.id, [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })));
    const goal = (await createGoalWithActivities({ userId: u.id, title: 'Shadow parity goal', targetDate: null, activities: [] })).goal;
    const rhythm = { kind: 'N_PER_WEEK' as const, targetPerWeek: 3 };
    const activities: Array<{ id: string }> = [];
    for (const catalog of FULL_ACTIVITY_CATALOG.slice(0, 11)) activities.push((await addGoalActivity(u.id, goal.id, { title: `GA ${catalog.id}`, activityId: catalog.id, rhythm }))!);
    const eligible = await loadEligibleGoalDemand(createRealGoalDemandCandidatesDeps(), u.id, FRIDAY, TZ);
    const rows: PlanDayIntentRow[] = activities.map((ga) => {
      const c = (eligible as any).candidates.find((x: any) => x.goalActivityId === ga.id);
      // 120 minutes each: 11 x 2 h cannot fit an 8 h day, so real candidates are Deferred on the scarce last day (pressure) and real contention exists
      return { ...createIntentRowFromAutoGoalSuggestion({ title: c.title, activityId: c.activityId, goalActivityId: c.goalActivityId }, encodeGoalDemandIntentId(FRIDAY, ga.id)), durationMinutes: 120 };
    });
    const now = localDateTimeToUTC(FRIDAY, '09:00', TZ);
    let snapshotLoads = 0;
    /** The EXACT closures the preview route passes (session, user, body, clock, real deps, the REPEATABLE READ snapshot, facts from the snapshot), plus the settings under test. */
    const boundary = (shadowPolicy?: DayConstructorPreviewBoundaryDeps['shadowPolicy']): DayConstructorPreviewBoundaryDeps => ({
      getSession: () => ({ userId: u.id }), getUser: (id) => getUserById(id), getBody: async () => ({ intents: buildRequestedIntentsForSubmission(rows, TZ, FRIDAY) }), now: () => now,
      createOrchestratorDeps: createRealDayConstructorOrchestratorDeps,
      loadSchedulingContext: (usr, request) => { snapshotLoads += 1; return loadDecisionSchedulingContext({ userId: usr.id, planningDate: request.targetDate, timezone: request.timezone }); },
      loadDecisionFactsFromContext: (usr, request, context) => loadGoalDecisionFacts(usr, request, createGoalDemandDepsFromSchedulingContext(context)),
      ...(shadowPolicy ? { shadowPolicy } : {}),
    });
    const counts = async () => JSON.stringify((await sql(`SELECT (SELECT count(*)::int FROM "PlannedActivity" WHERE "userId" = $1) AS plans, (SELECT count(*)::int FROM "GoalActivityOccurrence" WHERE "userId" = $1) AS occ, (SELECT count(*)::int FROM "GoalActivity" WHERE "userId" = $1) AS ga, (SELECT count(*)::int FROM "HabitLog" WHERE "userId" = $1) AS habit, (SELECT count(*)::int FROM "ProductEvent" WHERE "userId" = $1) AS events`, [u.id]))[0]);
    const runOnce = async (shadowPolicy?: DayConstructorPreviewBoundaryDeps['shadowPolicy']) => {
      snapshotLoads = 0;
      const before = await counts();
      const { value, statements } = await capturing(() => handleDayConstructorPreviewRequest(boundary(shadowPolicy)));
      const after = await counts();
      return { status: value.httpStatus, body: JSON.stringify(value.body), statements, snapshotLoads, before, after };
    };
    const seen: ShadowPolicyMetrics[] = [];
    const SHADOW = () => ({ mode: 'SHADOW' as const, sink: { record: (m: ShadowPolicyMetrics) => { seen.push(m); } } });
    const lines: string[] = []; const realInfo = console.info;

    // ============================================================
    console.log('=== the same request and data: OFF (no settings), OFF (default server settings, variable unset), SHADOW ===');
    delete process.env[SHADOW_POLICY_MODE_ENV];
    const off = await runOnce();
    const offDefault = await runOnce(createServerShadowPolicyExecution);
    console.log(`     baseline preview: HTTP ${off.status}, status ${JSON.parse(off.body).status}, ${off.statements.length} SQL statements`);
    check('the baseline preview is real: HTTP 200, READY, signed tokens present, SQL actually sent (captured)', off.status === 200 && JSON.parse(off.body).status === 'READY' && /acceptanceToken/.test(off.body) && off.statements.length > 0);
    const shadow = await runOnce(SHADOW);
    check('SHADOW REACHED READY EVALUATION over the real pipeline (the parity below covers an EXECUTED shadow): one metrics record, run READY with real observations (PromotionInputs from real pressure and contention, every generation READY and evaluated by the real predicate)', seen.length === 1 && seen[0].run === 'READY' && seen[0].observations > 0 && seen[0].generationReady > 0);
    console.log(`     shadow observation (real data): ${JSON.stringify(seen[0])}`);
    check('STATUS, BODY AND SIGNATURES: the SHADOW response equals the OFF response byte for byte (preview items and every signed token); the default server settings with the variable unset equal OFF too', shadow.status === off.status && shadow.body === off.body && offDefault.status === off.status && offDefault.body === off.body);
    check(`QUERY PARITY: the exact sequence of ${off.statements.length} SQL statements sent (one REPEATABLE READ snapshot, its reads and the baseline's own reads) is IDENTICAL for OFF and SHADOW -- no additional query, no second snapshot, no extra transaction`, JSON.stringify(shadow.statements) === JSON.stringify(off.statements) && JSON.stringify(offDefault.statements) === JSON.stringify(off.statements));
    const writes = (x: string[]) => x.filter((t) => /^(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|CREATE|ALTER|DROP)\b/i.test(t));
    const txControl = (x: string[]) => x.filter((t) => /^(BEGIN|START TRANSACTION|COMMIT|ROLLBACK|SAVEPOINT)\b/i.test(t) || /ISOLATION LEVEL/i.test(t));
    check(`WRITE AND TRANSACTION PARITY: zero write statements under both modes; the transaction-control statements are identical (${txControl(off.statements).length}: the baseline's own snapshot only); the domain row counts are unchanged by either run`, writes(off.statements).length === 0 && writes(shadow.statements).length === 0 && JSON.stringify(txControl(shadow.statements)) === JSON.stringify(txControl(off.statements)) && off.before === off.after && shadow.before === shadow.after && shadow.after === off.after);
    check('SNAPSHOT NOT RELOADED: the decision scheduling snapshot is loaded exactly once per request under OFF and under SHADOW', off.snapshotLoads === 1 && shadow.snapshotLoads === 1 && offDefault.snapshotLoads === 1);

    // ============================================================
    console.log('=== the default server settings with SHADOW from the environment, and failure parity on the real stack ===');
    process.env[SHADOW_POLICY_MODE_ENV] = 'SHADOW';
    console.info = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
    let envShadow: Awaited<ReturnType<typeof runOnce>>;
    try { envShadow = await runOnce(createServerShadowPolicyExecution); } finally { console.info = realInfo; }
    const logged = lines.length === 1 ? JSON.parse(lines[0]) : undefined;
    check('SERVER-ENVIRONMENT SHADOW (the production settings path): the response and the SQL sequence equal OFF, and exactly ONE aggregate log line was written with the minimal schema (no identifiers, no instants)', envShadow.body === off.body && JSON.stringify(envShadow.statements) === JSON.stringify(off.statements) && lines.length === 1 && logged?.event === 'DAY_CONSTRUCTOR_SHADOW_POLICY' && logged.mode === 'SHADOW' && !new RegExp(u.id).test(lines[0]) && !/\d{4}-\d{2}-\d{2}/.test(lines[0]));
    delete process.env[SHADOW_POLICY_MODE_ENV];
    const reOff = await runOnce(createServerShadowPolicyExecution);
    check('after the variable is unset again the very next request is OFF: identical to the first OFF run and no further log line', reOff.body === off.body && lines.length === 1);
    const sinkThrow = await runOnce(() => ({ mode: 'SHADOW', sink: { record: () => { throw new Error('sink down'); } } }));
    check('SINK FAILURE on the real stack: the response, SQL sequence and row counts are unchanged', sinkThrow.body === off.body && JSON.stringify(sinkThrow.statements) === JSON.stringify(off.statements) && sinkThrow.after === off.after);
    const composerThrow = await runOnce(() => ({ mode: 'SHADOW', observe: async () => { throw new Error('composer failed before any baseline existed'); } }));
    check('A COMPOSER THAT FAILS BEFORE A BASELINE EXISTS is a baseline failure on the real stack: the generic HTTP 500 and NOTHING re-run (only the pre-orchestration snapshot reads were sent -- a strict PREFIX of the OFF sequence; the stand-in never started the baseline and the boundary did not start one)', composerThrow.status === 500 && composerThrow.statements.length < off.statements.length && JSON.stringify(off.statements.slice(0, composerThrow.statements.length)) === JSON.stringify(composerThrow.statements));
  } finally {
    if (savedMode === undefined) delete process.env[SHADOW_POLICY_MODE_ENV]; else process.env[SHADOW_POLICY_MODE_ENV] = savedMode;
    await cleanup();
    await sql(`DELETE FROM "User" WHERE email = $1`, [EMAIL]).catch(() => {});
  }
  if (!allPassed) { console.error('SOME SHADOW EXECUTION DB CHECKS FAILED'); process.exitCode = 1; return; }
  console.log('ALL SHADOW EXECUTION DB CHECKS PASSED');
}
main().then(() => process.exit(), (err) => { console.error(err); process.exit(1); });
