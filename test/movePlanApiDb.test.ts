/**
 * Daily Experience V1 PR D2 -- POST /api/plans/[planId]/move: status codes,
 * stable error codes, idempotent retry, and status-preserving serialization
 * (the C1 mapper bug must not repeat for MOVED). Requires DATABASE_URL.
 */
import { upsertUserByEmail, updateBirthProfile, createPlannedActivity, beginTransaction, logPlannedActivity, skipPlannedActivity, cancelPlannedActivity } from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { POST as moveRoute } from '../apps/web/app/api/plans/[planId]/move/route';
import { mapPlanRow, isActionableUpcomingPlan } from '../apps/web/lib/planFormatting';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const TZ = 'Asia/Kolkata';
const MIN = 60000; const HOUR = 3600000; const DAY = 86400000;
const minute = (ms: number) => Math.floor(ms / MIN) * MIN;
const req = (tok: string | null, body: unknown): any => ({ cookies: { get: (n: string) => (tok && n === 'as_session' ? { value: tok } : undefined) }, json: async () => { if (body === '__malformed__') throw new SyntaxError('bad json'); return body; }, headers: new Headers() });
async function sql(t: string, p: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(t, p); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

async function main() {
  const U = await upsertUserByEmail({ email: 'test-move-api-a@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const V = await upsertUserByEmail({ email: 'test-move-api-b@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  for (const u of [U, V]) await updateBirthProfile(u.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  const tok = createSessionToken(U.id, U.email); const tokV = createSessionToken(V.id, V.email);
  let n = 0;
  const mk = async (title: string, startMs?: number) => { const s = startMs ?? minute(Date.now()) + 10 * DAY + n++ * 3 * HOUR; return createPlannedActivity({ userId: U.id, title: `${title} ${Date.now()}-${n}`, plannedStartAt: new Date(s), plannedEndAt: new Date(s + HOUR), durationMinutes: 60, windowType: 'NEUTRAL' }); };
  const dest = () => new Date(minute(Date.now()) + 50 * DAY + n++ * 3 * HOUR);
  const call = async (planId: string, body: unknown, token: string | null = tok) => { const res = await moveRoute(req(token, body), { params: { planId } }); return { status: res.status, body: await res.json() }; };
  const count = async () => Number((await sql(`SELECT count(*)::int AS n FROM "PlannedActivity" WHERE "userId" = $1`, [U.id]))[0].n);

  try {
    const a = await mk('API move'); const d = dest();
    const c0 = await count();
    const ok = await call(a.id, { newStartAt: d.toISOString() });
    check('26/28. valid Move -> 200 { from, plan }; from is the original A, plan is a NEW successor B', ok.status === 200 && ok.body.from.id === a.id && ok.body.plan.id !== a.id && ok.body.plan.rescheduledFromPlanId === a.id && (await count()) === c0 + 1);
    check('26/58. the response preserves lifecycle truth: from.status MOVED, plan.status UPCOMING', ok.body.from.status === 'MOVED' && ok.body.plan.status === 'UPCOMING');
    const mFrom = mapPlanRow(ok.body.from, TZ); const mTo = mapPlanRow(ok.body.plan, TZ);
    check('58. the client mapper keeps A as MOVED (never UPCOMING) and B as UPCOMING; only B is actionable Plan-tab work', mFrom.status === 'MOVED' && mTo.status === 'UPCOMING' && !isActionableUpcomingPlan(mFrom) && isActionableUpcomingPlan(mTo));
    check('26. the serialized B carries the derived end (start + duration) and NEUTRAL timing', new Date(ok.body.plan.plannedStartAt).getTime() === d.getTime() && new Date(ok.body.plan.plannedEndAt).getTime() === d.getTime() + HOUR && ok.body.plan.windowType === 'NEUTRAL' && ok.body.plan.recommendation === null);
    const retry = await call(a.id, { newStartAt: d.toISOString() });
    check('28. retrying the successful request -> 200 with the same A, the same B.id, the same destination, and no duplicate plan', retry.status === 200 && retry.body.plan.id === ok.body.plan.id && retry.body.from.status === 'MOVED' && new Date(retry.body.plan.plannedStartAt).getTime() === d.getTime() && (await count()) === c0 + 1);

    check('27. unauthenticated -> 401', (await call(a.id, { newStartAt: d.toISOString() }, null)).status === 401);
    const mine = await mk('Cross user');
    const cross = await call(mine.id, { newStartAt: dest().toISOString() }, tokV);
    check('27/57. cross-user -> 404 with no plan data leaked, and nothing changes', cross.status === 404 && cross.body.plan === undefined && cross.body.from === undefined && cross.body.code === 'NOT_FOUND' && (await sql(`SELECT status FROM "PlannedActivity" WHERE id = $1`, [mine.id]))[0].status === 'UPCOMING');
    check('27. unknown plan -> 404', (await call('no-such-plan', { newStartAt: dest().toISOString() })).status === 404);
    const bad: Array<[string, unknown]> = [['malformed JSON', '__malformed__'], ['missing newStartAt', {}], ['non-string newStartAt', { newStartAt: 12345 }], ['invalid ISO', { newStartAt: 'not a date' }], ['past', { newStartAt: new Date(minute(Date.now()) - HOUR).toISOString() }], ['non-whole-minute', { newStartAt: new Date(minute(Date.now()) + 5 * DAY + 1500).toISOString() }]];
    for (const [label, body] of bad) {
      const r = await call(mine.id, body);
      check(`27. ${label} -> 400 INVALID_DESTINATION, no partial write`, r.status === 400 && r.body.code === 'INVALID_DESTINATION' && (await sql(`SELECT status FROM "PlannedActivity" WHERE id = $1`, [mine.id]))[0].status === 'UPCOMING');
    }
    const lg = await mk('API logged'); await logPlannedActivity(U.id, lg.id);
    const sk = await mk('API skipped'); await skipPlannedActivity(U.id, sk.id);
    const cn = await mk('API cancelled'); await cancelPlannedActivity(U.id, cn.id);
    for (const [label, p] of [['LOGGED', lg], ['SKIPPED', sk], ['CANCELLED', cn]] as const) {
      const r = await call(p.id, { newStartAt: dest().toISOString() });
      check(`27/48. ${label} -> 409 INVALID_STATE`, r.status === 409 && r.body.code === 'INVALID_STATE');
    }
    const c1 = await count();
    const again = await call(a.id, { newStartAt: dest().toISOString() });
    check('27/48. MOVED with a different destination -> 409 ALREADY_MOVED (no third plan)', again.status === 409 && again.body.code === 'ALREADY_MOVED' && (await count()) === c1);
    const blockStart = minute(Date.now()) + 70 * DAY;
    await mk('API blocker', blockStart);
    const conflict = await call(mine.id, { newStartAt: new Date(blockStart + 15 * MIN).toISOString() });
    check('27/53. destination conflict -> 409 CONFLICT, A unchanged', conflict.status === 409 && conflict.body.code === 'CONFLICT' && (await sql(`SELECT status FROM "PlannedActivity" WHERE id = $1`, [mine.id]))[0].status === 'UPCOMING');
    const shared = await mk('API shared');
    await sql(`INSERT INTO "AuraMoment" (id, "ownerUserId", "publicToken", scope, source, "activityId", "activityTitle", "startAt", "endAt", timezone, "plannedActivityId") VALUES ($1, $2, $3, 'SHARED', 'PLAN', 'date-night', 'x', $4, $5, $6, $7)`, [`am-${Date.now()}`, U.id, `t-${Date.now()}`, new Date(shared.plannedStartAt), new Date(shared.plannedEndAt), TZ, shared.id]);
    const linked = await call(shared.id, { newStartAt: dest().toISOString() });
    check('27/56. active linked AuraMoment -> 409 HAS_LINKED_MOMENT, A unchanged', linked.status === 409 && linked.body.code === 'HAS_LINKED_MOMENT' && (await sql(`SELECT status FROM "PlannedActivity" WHERE id = $1`, [shared.id]))[0].status === 'UPCOMING');
  } finally {
    await sql(`DELETE FROM "AuraMoment" WHERE "ownerUserId" = $1`, [U.id]).catch(() => {});
    await sql(`UPDATE "PlannedActivity" SET "rescheduledFromPlanId" = NULL WHERE "userId" = ANY($1)`, [[U.id, V.id]]).catch(() => {});
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1)`, [[U.id, V.id]]).catch(() => {});
    await sql(`DELETE FROM "HabitLog" WHERE "userId" = ANY($1)`, [[U.id, V.id]]).catch(() => {});
  }
  if (!allPassed) { console.error('SOME MOVE API CHECKS FAILED'); process.exit(1); }
  console.log('ALL MOVE API CHECKS PASSED');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
