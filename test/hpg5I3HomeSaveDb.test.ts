/**
 * AURA-HPG5-V2-I3 (I3-B) -- the live Home save paths (Home timeline / Right
 * Now "Plan" and Day Builder "Add") end to end against a REAL disposable
 * database: the real client save function both components call
 * (saveUpcomingPlanFromCandidate, with each component's exact options --
 * including its deterministic clientRequestId) talking to the REAL
 * POST /api/plans and POST /api/timing-search handlers via an in-process
 * fetch shim.
 *
 *   DATABASE_URL="postgresql://..." TS_NODE_COMPILER_OPTIONS='{"jsx":"react"}' npx ts-node test/hpg5I3HomeSaveDb.test.ts
 */
import { upsertUserByEmail, beginTransaction } from '../apps/web/lib/db';
import { boundHeaders, bindTestAccount } from './rel04BoundTestHeaders';
import { createSessionToken } from '../apps/web/lib/auth';
import { localDateTimeToUTC, getDatePartsInTimezone, addDaysToDateStr } from '../apps/web/lib/timezone';
import { POST as plansRoute } from '../apps/web/app/api/plans/route';
import { POST as timingSearchRoute } from '../apps/web/app/api/timing-search/route';

const { saveUpcomingPlanFromCandidate, PlanOverlapSaveError } = require('../apps/web/components/PlanWithAuraView');

let allPassed = true;
let count = 0;
function check(label: string, condition: boolean) {
  count++;
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const TZ = 'Asia/Kolkata';
const rawBegin: typeof beginTransaction = require('../apps/web/lib/db').beginTransaction;
async function sql(text: string, params: unknown[] = []): Promise<any[]> {
  const c = await rawBegin();
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
let currentToken: string | undefined;
const routes: Record<string, (r: any) => Promise<Response>> = { '/api/plans': plansRoute as any, '/api/timing-search': timingSearchRoute as any };
(global as any).fetch = async (url: string, opts?: any) => {
  const route = routes[url];
  if (!route || (opts?.method ?? 'GET').toUpperCase() !== 'POST') throw new Error(`unrouted ${url}`);
  const body = JSON.parse(opts.body);
  const token = currentToken;
  return route({ cookies: { get: (n: string) => (token !== undefined && n === 'as_session' ? { value: token } : undefined) }, json: async () => body, headers: boundHeaders(token) });
};
const D1 = addDaysToDateStr(getDatePartsInTimezone(TZ, new Date()).dateStr, 1);
const at = (hhmm: string) => localDateTimeToUTC(D1, hhmm, TZ).toISOString();

async function checkCandidate(token: string, activityId: string, start: string, durationMinutes: number) {
  currentToken = token; bindTestAccount(currentToken);
  const r = await (global as any).fetch('/api/timing-search', { method: 'POST', body: JSON.stringify({ mode: 'CHECK', activityId, durationMinutes, candidateStart: start }) });
  const b = await r.json();
  return b.requestedCandidate ?? b.candidates[0];
}
async function tryOverlap(fn: () => Promise<unknown>): Promise<{ ok: any; err: any }> {
  try { return { ok: await fn(), err: null }; } catch (e) { return { ok: null, err: e }; }
}

async function main() {
  const tag = `i3h-${Date.now()}`;
  const mk = async (k: string) => {
    const u = await upsertUserByEmail({ email: `hpg5i3-home-${k}-${tag}@e2e.aura.local`, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
    await sql(`UPDATE "User" SET timezone = $1 WHERE id = $2`, [TZ, u.id]);
    return { ...u, token: createSessionToken(u.id, u.email) };
  };
  const A = await mk('a');
  const B = await mk('b');
  const C = await mk('c');
  const ids = [A.id, B.id, C.id];
  const rows = async (id: string) => sql(`SELECT id, title, "plannedStartAt", "activityId", status FROM "PlannedActivity" WHERE "userId" = $1 ORDER BY "createdAt"`, [id]);
  const claim = async (id: string, key: string) => (await sql(`SELECT "plannedActivityId" FROM "PlanCreationIdempotency" WHERE "userId" = $1 AND "clientRequestId" = $2`, [id, key]))[0];
  const legacy = async (token: string, title: string, s: string, e: string) => {
    currentToken = token; bindTestAccount(currentToken);
    const r = await (global as any).fetch('/api/plans', { method: 'POST', body: JSON.stringify({ title, activityType: title, plannedStartAt: s, plannedEndAt: e, durationMinutes: Math.round((new Date(e).getTime() - new Date(s).getTime()) / 60000), windowType: 'NEUTRAL' }) });
    return r.status;
  };
  try {
    // ================= Home timeline "Plan" =================
    const homeKey = 'home-opportunity:guidance:s1';
    const homeOpts = { activityId: 'meditation', clientRequestId: homeKey };
    const opp = await checkCandidate(A.token, 'meditation', at('10:00'), 45);
    check('HOME setup: CHECK returns the exact opportunity instant', opp?.start === at('10:00'));
    check('HOME recommendation valid when made (no plans yet)', (await rows(A.id)).length === 0);
    check('HOME a competing plan is created after the recommendation (second tab)', (await legacy(A.token, 'Dentist', at('10:15'), at('11:00'))) === 200);
    currentToken = A.token; bindTestAccount(currentToken);
    const r1 = await tryOverlap(() => saveUpcomingPlanFromCandidate(opp, 45, { ...homeOpts, overlapPolicy: 'REJECT_ACTIVE_OVERLAP' }));
    check('HOME stale save refused with typed PLAN_OVERLAP naming the competing plan', r1.err instanceof PlanOverlapSaveError && r1.err.conflict?.title === 'Dentist');
    check('HOME refusal keeps the exact proposal', r1.err?.proposed?.plannedStartAt === opp.start && r1.err?.proposed?.plannedEndAt === opp.end);
    check('HOME no plan written on refusal (only the competitor exists)', (await rows(A.id)).length === 1);
    check('HOME the idempotency claim exists but is unfilled (no plan id) after the rollback', (await claim(A.id, homeKey))?.plannedActivityId == null);
    const tSA = Date.now();
    const anyway = await saveUpcomingPlanFromCandidate(opp, 45, { ...homeOpts, overlapPolicy: 'ALLOW' });
    const saMs = Date.now() - tSA;
    check(`HOME Save anyway with the SAME clientRequestId succeeds despite the unfilled claim (${saMs} ms)`, !!anyway?.id && (await rows(A.id)).length === 2);
    check('HOME claim now points at the saved plan', (await claim(A.id, homeKey))?.plannedActivityId === anyway.id);
    check('HOME activity identity preserved on the saved row', (await rows(A.id)).find((r) => r.id === anyway.id)?.activityId === 'meditation');
    const retry = await tryOverlap(() => saveUpcomingPlanFromCandidate(opp, 45, { ...homeOpts, overlapPolicy: 'REJECT_ACTIVE_OVERLAP' }));
    check('HOME a lost-response retry (REJECT, same key) returns the SAME plan -- no duplicate, no self-conflict', retry.err === null && retry.ok?.id === anyway.id && (await rows(A.id)).length === 2);
    check('HOME no goal occurrence created (identity unchanged vs. before I3)', Number((await sql(`SELECT count(*)::int n FROM "GoalActivityOccurrence" WHERE "userId" = $1`, [A.id]))[0].n) === 0);

    // ================= Day Builder "Add" =================
    const dbKey = `daybuilder:sugg-1:${D1}`;
    const chipA = await checkCandidate(A.token, 'workout', at('15:00'), 45);
    const chipB = await checkCandidate(A.token, 'workout', at('17:00'), 45);
    await legacy(A.token, 'Team call', at('15:30'), at('16:00'));
    currentToken = A.token; bindTestAccount(currentToken);
    const before = (await rows(A.id)).length;
    const d1 = await tryOverlap(() => saveUpcomingPlanFromCandidate(chipA, 45, { clientRequestId: dbKey, activityId: 'workout', overlapPolicy: 'REJECT_ACTIVE_OVERLAP' }));
    check('DB stale chip A refused with PLAN_OVERLAP, nothing written', d1.err instanceof PlanOverlapSaveError && d1.err.conflict?.title === 'Team call' && (await rows(A.id)).length === before);
    const d2 = await tryOverlap(() => saveUpcomingPlanFromCandidate(chipB, 45, { clientRequestId: dbKey, activityId: 'workout', overlapPolicy: 'REJECT_ACTIVE_OVERLAP' }));
    check('DB choosing chip B (same suggestion key) then Add succeeds', d2.err === null && !!d2.ok?.id && (await rows(A.id)).length === before + 1);
    check('DB the saved plan is chip B (the user\'s new choice), with activityId', (await rows(A.id)).find((r) => r.id === d2.ok.id)?.plannedStartAt.toISOString() === chipB.start && (await rows(A.id)).find((r) => r.id === d2.ok.id)?.activityId === 'workout');
    const d3 = await tryOverlap(() => saveUpcomingPlanFromCandidate(chipB, 45, { clientRequestId: dbKey, activityId: 'workout', overlapPolicy: 'REJECT_ACTIVE_OVERLAP' }));
    check('DB a duplicate Add (same key) returns the same plan, no second row', d3.ok?.id === d2.ok.id && (await rows(A.id)).length === before + 1);

    // ================= concurrency =================
    const raceOpp = await checkCandidate(B.token, 'meditation', at('08:00'), 45);
    currentToken = B.token; bindTestAccount(currentToken);
    const sameKey = await Promise.allSettled([
      saveUpcomingPlanFromCandidate(raceOpp, 45, { activityId: 'meditation', clientRequestId: 'home-opportunity:guidance:race', overlapPolicy: 'REJECT_ACTIVE_OVERLAP' }),
      saveUpcomingPlanFromCandidate(raceOpp, 45, { activityId: 'meditation', clientRequestId: 'home-opportunity:guidance:race', overlapPolicy: 'REJECT_ACTIVE_OVERLAP' }),
    ]);
    check('RACE two tabs, same opportunity, same key -> exactly one plan row', (await rows(B.id)).length === 1 && sameKey.some((r) => r.status === 'fulfilled'));
    const raceB = await checkCandidate(B.token, 'workout', at('12:00'), 45);
    currentToken = B.token; bindTestAccount(currentToken);
    const diffKey = await Promise.allSettled([
      saveUpcomingPlanFromCandidate(raceB, 45, { activityId: 'workout', clientRequestId: 'home-opportunity:guidance:x1', overlapPolicy: 'REJECT_ACTIVE_OVERLAP' }),
      saveUpcomingPlanFromCandidate(raceB, 45, { activityId: 'workout', clientRequestId: `daybuilder:sugg-9:${D1}`, overlapPolicy: 'REJECT_ACTIVE_OVERLAP' }),
    ]);
    const okN = diffKey.filter((r) => r.status === 'fulfilled').length;
    const refN = diffKey.filter((r) => r.status === 'rejected' && (r as PromiseRejectedResult).reason instanceof PlanOverlapSaveError).length;
    check('RACE Home Plan and Day Builder Add for one slot at once -> one saved, one PLAN_OVERLAP', okN === 1 && refN === 1 && (await rows(B.id)).length === 2);

    // ================= stale states / privacy =================
    const freed = await checkCandidate(C.token, 'meditation', at('09:00'), 45);
    await legacy(C.token, 'Will cancel', at('09:00'), at('09:45'));
    const toCancel = (await rows(C.id))[0];
    await sql(`UPDATE "PlannedActivity" SET status = 'CANCELLED' WHERE id = $1`, [toCancel.id]);
    currentToken = C.token; bindTestAccount(currentToken);
    const intoFreed = await tryOverlap(() => saveUpcomingPlanFromCandidate(freed, 45, { activityId: 'meditation', clientRequestId: 'home-opportunity:guidance:c1', overlapPolicy: 'REJECT_ACTIVE_OVERLAP' }));
    check('STALE blocker cancelled after the recommendation -> the Home save succeeds', intoFreed.err === null);
    // A's plans at 10:00-11:00 must never block or leak into C's save at the same time
    const cSame = await checkCandidate(C.token, 'meditation', at('10:00'), 45);
    currentToken = C.token; bindTestAccount(currentToken);
    const cRes = await tryOverlap(() => saveUpcomingPlanFromCandidate(cSame, 45, { activityId: 'meditation', clientRequestId: 'home-opportunity:guidance:c2', overlapPolicy: 'REJECT_ACTIVE_OVERLAP' }));
    check("PRIVACY another user's overlapping plans never block or appear in this user's Home save", cRes.err === null && !!cRes.ok?.id);
    // legacy callers without the option are unchanged
    currentToken = C.token; bindTestAccount(currentToken);
    const leg = await tryOverlap(() => saveUpcomingPlanFromCandidate(cSame, 45, { activityId: 'meditation' }));
    check('LEGACY a caller without overlapPolicy is unchanged (soft-dedupe returns the existing identical plan)', leg.err === null && leg.ok?.id === cRes.ok.id);
  } finally {
    await sql(`DELETE FROM "PlanCreationIdempotency" WHERE "userId" = ANY($1::text[])`, [ids]).catch(() => {});
    await sql(`DELETE FROM "GoalActivityOccurrence" WHERE "userId" = ANY($1::text[])`, [ids]).catch(() => {});
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "User" WHERE id = ANY($1::text[])`, [ids]).catch(() => {});
  }
  console.log(`\n${count} checks`);
  if (!allPassed) {
    console.log('SOME CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL CHECKS PASSED');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
