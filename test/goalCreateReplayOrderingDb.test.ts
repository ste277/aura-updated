/**
 * CI reliability -- Goal-create idempotent replay ordering (live database, through the REAL `POST /api/goals` route).
 *
 * THE FLAKE. An identical replay of an explicit-review Goal create could answer 409 IDEMPOTENCY_CONFLICT. The route
 * compares the request's activities with the persisted ones INDEX BY INDEX (the order is meaningful: it is the order the
 * user reviewed and sees), but the activities created in one transaction all got the SAME `createdAt` (`now()` is the
 * transaction instant) and random ids, and the load was `ORDER BY "createdAt"` alone. Tied rows come back in whatever order
 * the plan emits; once tables are large enough that the planner hashes `GoalActivity` (a Hash Right Join), the tied rows come
 * back in REVERSE, the comparison fails, and a byte-identical replay conflicts.
 *
 * THE FIX UNDER TEST. Each activity is persisted with its own strictly increasing `createdAt` (creation order is now durable)
 * and the load is `ORDER BY "createdAt", id` (a total order, deterministic under any remaining tie).
 *
 * This suite does not depend on the timing luck that exposed the bug: it loads ballast so the planner picks the reversing
 * plan, deliberately perturbs the physical row order, builds exact-timestamp ties directly, and asserts the outcome that
 * must hold under ANY plan. Idempotency semantics are unchanged: an identical replay succeeds, a materially different or
 * reordered one is still a conflict. Requires DATABASE_URL (fresh, 43 migrations).
 */
import { upsertUserByEmail, beginTransaction, listGoalActivitiesWithLinkedPlanStatus } from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { POST as createGoal } from '../apps/web/app/api/goals/route';
import { randomUUID } from 'crypto';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
async function sql(text: string, params: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(text, params); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}
const fakeRequest = (cookie: string | undefined, jsonBody: unknown): any => ({ cookies: { get: (name: string) => (cookie !== undefined && name === 'as_session' ? { value: cookie } : undefined) }, json: async () => jsonBody });
async function post(token: string, body: unknown): Promise<{ status: number; body: any }> {
  const res: any = await createGoal(fakeRequest(token, body));
  return { status: res.status, body: await res.json() };
}

type Activity = { title: string; activityId: string | null; completionRequirement?: unknown; rhythm?: unknown };
const A = (title: string, activityId: string | null, extra: Partial<Activity> = {}): Activity => ({ title, activityId, ...extra });
const norm = (activities: Activity[]) => JSON.stringify(activities);

async function main() {
  const mkUser = async (key: string) => upsertUserByEmail({ email: `test-gcro-${key}@example.com`, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
  const U = await mkUser('a');
  const V = await mkUser('b');
  const ids = [U.id, V.id];
  const tokenU = createSessionToken(U.id, U.email);
  const tokenV = createSessionToken(V.id, V.email);
  const cleanup = async () => {
    await sql(`DELETE FROM "Goal" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "User" WHERE id = 'gcro-ballast-user'`).catch(() => {});
  };
  await cleanup();

  // ---- ballast: enough GoalActivity / PlannedActivity rows (+ANALYZE) that the planner hashes GoalActivity, the plan that reversed tied rows ----
  await sql(`INSERT INTO "User"(id, email, "cityName", latitude, longitude) VALUES ('gcro-ballast-user', 'gcro-ballast@example.com', 'X', 1, 1) ON CONFLICT DO NOTHING`);
  await sql(`INSERT INTO "Goal"(id, "userId", title) VALUES ('gcro-ballast-goal', 'gcro-ballast-user', 'ballast') ON CONFLICT DO NOTHING`);
  await sql(`INSERT INTO "GoalActivity"(id, "userId", "goalId", title) SELECT 'gcro-ballast-ga-' || g, 'gcro-ballast-user', 'gcro-ballast-goal', 'x' FROM generate_series(1, 25000) g`);
  await sql(`INSERT INTO "PlannedActivity"(id, "userId", title, "plannedStartAt", "plannedEndAt", "durationMinutes", "windowType") SELECT 'gcro-ballast-pa-' || g, 'gcro-ballast-user', 'x', now(), now() + interval '1 hour', 60, 'NEUTRAL' FROM generate_series(1, 25000) g`);
  await sql(`ANALYZE "GoalActivity"`);
  await sql(`ANALYZE "PlannedActivity"`);
  const plan = (await sql(`EXPLAIN SELECT ga.* FROM "GoalActivity" ga LEFT JOIN "PlannedActivity" pa ON pa.id = ga."plannedActivityId" LEFT JOIN "GoalActivityExecution" gae ON gae."plannedActivityId" = ga."plannedActivityId" WHERE ga."userId" = 'x' AND ga."goalId" = 'y' ORDER BY ga."createdAt"`)).map((r) => r['QUERY PLAN'] as string).join(' | ');
  console.log(`   [info] replay-load plan under ballast: ${/Hash Right Join/.test(plan) ? 'Hash Right Join (GoalActivity is the hashed side -- the plan that reverses tied rows)' : 'no Hash Right Join on this server; the order-independent assertions below still hold'}`);

  const persistedOrder = async (goalId: string) => (await sql(`SELECT title, "activityId", "createdAt" FROM "GoalActivity" WHERE "goalId" = $1 ORDER BY "createdAt", id`, [goalId]));
  const names = (rows: any[]) => rows.map((r) => r.title).join('|');
  const scenario = async (label: string, token: string, activities: Activity[], opts: { title?: string; targetDate?: string } = {}) => {
    const clientRequestId = randomUUID();
    const body = { title: opts.title ?? `Goal ${label}`, activities, clientRequestId, ...(opts.targetDate ? { targetDate: opts.targetDate } : {}) };
    const created = await post(token, body);
    const goalId = created.body?.goal?.id as string;
    return { body, created, goalId, clientRequestId };
  };

  try {
    console.log('=== creation order is durable: strictly increasing createdAt, and every read returns request order ===');
    const sizes: Array<[string, Activity[]]> = [
      ['2 activities (canonical + canonical)', [A('Morning cardio', 'workout', { rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 3 } }), A('Stretch / mobility', 'task-7', { rhythm: { kind: 'NONE' } })]],
      ['3 activities (mixed canonical + freeform)', [A('Read a chapter', null), A('Walk', 'walk-together'), A('Plan the week', null, { rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 1 } })]],
      ['5 activities (freeform only)', ['One', 'Two', 'Three', 'Four', 'Five'].map((t) => A(t, null))],
      ['5 activities (canonical + completion requirements + rhythm)', [A('Cardio', 'workout', { completionRequirement: { kind: 'DURATION', targetValue: 30 } }), A('Meditate', 'meditation'), A('Study', null, { completionRequirement: { kind: 'MEASURED_TARGET', targetValue: 20, unit: 'pages' } }), A('Tea', 'tea-break'), A('Walk', 'walk-together', { rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 2 } })]],
    ];
    for (const [label, activities] of sizes) {
      const s = await scenario(label, tokenU, activities);
      const titles = activities.map((a) => a.title).join('|');
      check(`[${label}] created (200) and the response lists the activities in request order`, s.created.status === 200 && s.created.body.activities.map((a: any) => a.title).join('|') === titles);
      const rows = await persistedOrder(s.goalId);
      const distinct = new Set(rows.map((r) => new Date(r.createdAt).getTime())).size;
      const strictlyIncreasing = rows.every((r, i) => i === 0 || new Date(r.createdAt).getTime() > new Date(rows[i - 1].createdAt).getTime());
      check(`[${label}] DURABLE ORDER: ${rows.length} persisted activities carry ${distinct} distinct strictly increasing createdAt values, in request order`, rows.length === activities.length && distinct === activities.length && strictlyIncreasing && names(rows) === titles);
      const maxSpread = new Date(rows[rows.length - 1].createdAt).getTime() - new Date(rows[0].createdAt).getTime();
      check(`[${label}] no createdAt is in the future and the spread is at most ${activities.length - 1} ms (the last activity keeps the transaction instant)`, maxSpread === activities.length - 1 && new Date(rows[rows.length - 1].createdAt).getTime() <= Date.now());
      const listed = await listGoalActivitiesWithLinkedPlanStatus(U.id, s.goalId);
      check(`[${label}] the replay-load query returns request order (under the ballast plan)`, listed.map((r) => r.title).join('|') === titles);
      const replay = await post(tokenU, s.body);
      check(`[${label}] IDENTICAL REPLAY succeeds: 200, the same Goal id, the same ${activities.length} activities, no duplicates`, replay.status === 200 && replay.body.goal.id === s.goalId && replay.body.activities.length === activities.length && (await sql(`SELECT count(*)::int n FROM "GoalActivity" WHERE "goalId" = $1`, [s.goalId]))[0].n === activities.length);
      const swapped = [...activities]; [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
      const reordered = await post(tokenU, { ...s.body, activities: swapped });
      check(`[${label}] a REORDERED replay is still a conflict (order stays meaningful and fail-closed): 409 IDEMPOTENCY_CONFLICT`, reordered.status === 409 && reordered.body.code === 'IDEMPOTENCY_CONFLICT');
    }

    console.log('=== order perturbation: reversing the PHYSICAL row order must not change the answer ===');
    const pert = await scenario('perturbed', tokenU, [A('First', 'workout'), A('Second', null), A('Third', 'meditation'), A('Fourth', null)]);
    const physical = async () => (await sql(`SELECT title FROM "GoalActivity" WHERE "goalId" = $1 ORDER BY ctid`, [pert.goalId])).map((r) => r.title).join('|');
    const before = await physical();
    for (const title of ['First', 'Second', 'Third', 'Fourth']) await sql(`UPDATE "GoalActivity" SET title = title WHERE "goalId" = $1 AND title = $2`, [pert.goalId, title]); // rewrites each tuple, moving it
    for (const title of ['Fourth', 'Third', 'Second', 'First']) await sql(`UPDATE "GoalActivity" SET title = title WHERE "goalId" = $1 AND title = $2`, [pert.goalId, title]);
    const after = await physical();
    console.log(`   [info] physical (ctid) order before the perturbation: ${before}; after: ${after}`);
    check('the PHYSICAL order was changed by the perturbation (the test really moved the rows)', before !== after);
    const listedAfter = await listGoalActivitiesWithLinkedPlanStatus(U.id, pert.goalId);
    check('after the perturbation the load still returns request order (it does not depend on physical order)', listedAfter.map((r) => r.title).join('|') === 'First|Second|Third|Fourth');
    const replayAfter = await post(tokenU, pert.body);
    check('after the perturbation the identical replay still succeeds', replayAfter.status === 200 && replayAfter.body.goal.id === pert.goalId);

    console.log('=== duplicate-looking activities are not collapsed ===');
    const dup = await scenario('duplicates', tokenU, [A('Same', 'workout', { rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 2 } }), A('Same', 'workout', { rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 2 } }), A('Same', 'workout', { rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 2 } })]);
    check('three identical activities persist as three rows with three distinct creation instants (nothing collapsed)', dup.created.status === 200 && (await persistedOrder(dup.goalId)).length === 3 && new Set((await persistedOrder(dup.goalId)).map((r) => new Date(r.createdAt).getTime())).size === 3);
    const dupReplay = await post(tokenU, dup.body);
    check('their identical replay succeeds (same Goal, still 3 rows)', dupReplay.status === 200 && dupReplay.body.goal.id === dup.goalId && dupReplay.body.activities.length === 3);
    const dupFewer = await post(tokenU, { ...dup.body, activities: dup.body.activities.slice(0, 2) });
    check('a replay with one duplicate fewer is a conflict', dupFewer.status === 409 && dupFewer.body.code === 'IDEMPOTENCY_CONFLICT');

    console.log('=== real differences still conflict (idempotency semantics unchanged) ===');
    const base: Activity[] = [A('Cardio', 'workout', { completionRequirement: { kind: 'DURATION', targetValue: 30 }, rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 3 } }), A('Reading', null), A('Tea', 'tea-break')];
    const s = await scenario('semantics', tokenU, base, { title: 'Semantics goal' });
    const differs = async (label: string, body: unknown) => { const r = await post(tokenU, body); check(`${label} -> 409 IDEMPOTENCY_CONFLICT`, r.status === 409 && r.body.code === 'IDEMPOTENCY_CONFLICT'); };
    const withActivity = (i: number, patch: Partial<Activity>) => base.map((a, idx) => (idx === i ? { ...a, ...patch } : a));
    await differs('a different activity TITLE', { ...s.body, activities: withActivity(1, { title: 'Reading!' }) });
    await differs('a different activityId (canonical vs freeform)', { ...s.body, activities: withActivity(1, { activityId: 'meditation' }) });
    await differs('a different activityId (canonical vs another canonical)', { ...s.body, activities: withActivity(2, { activityId: 'walk-together' }) });
    await differs('a different COMPLETION requirement (value)', { ...s.body, activities: withActivity(0, { completionRequirement: { kind: 'DURATION', targetValue: 45 } }) });
    await differs('a different COMPLETION requirement (kind)', { ...s.body, activities: withActivity(0, { completionRequirement: { kind: 'DONE' } }) });
    await differs('a different RHYTHM (target)', { ...s.body, activities: withActivity(0, { rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 4 } }) });
    await differs('a different RHYTHM (kind)', { ...s.body, activities: withActivity(0, { rhythm: { kind: 'NONE' } }) });
    await differs('an extra activity', { ...s.body, activities: [...base, A('Extra', null)] });
    await differs('a missing activity', { ...s.body, activities: base.slice(0, 2) });
    await differs('a different Goal TITLE', { ...s.body, title: 'Another title' });
    await differs('a different targetDate', { ...s.body, targetDate: '2027-01-01' });
    check('the identical request is still an idempotent replay after all those conflicts (nothing was written by them)', (await post(tokenU, s.body)).status === 200 && (await sql(`SELECT count(*)::int n FROM "Goal" WHERE id = $1`, [s.goalId]))[0].n === 1 && (await sql(`SELECT count(*)::int n FROM "GoalActivity" WHERE "goalId" = $1`, [s.goalId]))[0].n === 3);

    console.log('=== single activity, zero activities, user isolation ===');
    const one = await scenario('one', tokenU, [A('Solo', 'workout')]);
    check('ONE activity: created, identical replay succeeds, reordering is moot', one.created.status === 200 && (await post(tokenU, one.body)).status === 200 && new Set((await persistedOrder(one.goalId)).map((r) => new Date(r.createdAt).getTime())).size === 1);
    const zero = await scenario('zero', tokenU, []);
    check('ZERO activities: created, identical replay succeeds', zero.created.status === 200 && zero.created.body.activities.length === 0 && (await post(tokenU, zero.body)).status === 200);
    const iso = { title: 'Isolation', activities: [A('A', null), A('B', null)], clientRequestId: randomUUID() };
    const forU = await post(tokenU, iso);
    const forV = await post(tokenV, iso);
    check('USER ISOLATION: the same clientRequestId for another user creates that user\'s own Goal (no conflict, no cross-user replay)', forU.status === 200 && forV.status === 200 && forU.body.goal.id !== forV.body.goal.id && (await post(tokenV, iso)).body.goal.id === forV.body.goal.id);

    console.log('=== exact-timestamp ties (rows that predate the fix) get a deterministic total order ===');
    await sql(`INSERT INTO "Goal"(id, "userId", title) VALUES ('gcro-tie-goal', $1, 'tie')`, [U.id]);
    const tieAt = '2026-01-01T00:00:00.000Z';
    // physical insertion order c, a, b -- the order a plan could hand back -- with EXACTLY the same createdAt
    for (const id of ['gcro-tie-c', 'gcro-tie-a', 'gcro-tie-b']) await sql(`INSERT INTO "GoalActivity"(id, "userId", "goalId", title, "createdAt") VALUES ($1, $2, 'gcro-tie-goal', $1, $3)`, [id, U.id, tieAt]);
    const tied = await sql(`SELECT count(DISTINCT "createdAt")::int n FROM "GoalActivity" WHERE "goalId" = 'gcro-tie-goal'`);
    check('the fixture really has three rows with the exact same createdAt', tied[0].n === 1);
    const orders = new Set<string>();
    for (let i = 0; i < 10; i += 1) orders.add((await listGoalActivitiesWithLinkedPlanStatus(U.id, 'gcro-tie-goal')).map((r) => r.id).join('|'));
    check('TOTAL ORDER: the load returns the tied rows ordered by id, identically on 10 reads, regardless of their physical (insertion) order', orders.size === 1 && [...orders][0] === 'gcro-tie-a|gcro-tie-b|gcro-tie-c');

    if (!allPassed) { console.error('SOME GOAL CREATE REPLAY ORDERING DB CHECKS FAILED'); process.exitCode = 1; return; }
    console.log('ALL GOAL CREATE REPLAY ORDERING DB CHECKS PASSED');
  } finally {
    await cleanup();
  }
}

main().then(() => process.exit(), (err) => { console.error(err); process.exit(1); });
