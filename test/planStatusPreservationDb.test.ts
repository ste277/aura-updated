/**
 * Daily Experience V1 PR C1 correction -- status preservation. POST
 * /api/plans idempotent replay (clientRequestId AND guest-conversion token)
 * returns the CURRENT persisted plan, which may be SKIPPED/CANCELLED/LOGGED;
 * mapPlanRow must preserve that truth and the Plan tab must not present a
 * terminal plan as actionable upcoming work. Requires DATABASE_URL.
 */
import fs from 'fs';
import path from 'path';
import { upsertUserByEmail, cancelPlannedActivity, beginTransaction } from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { createGuestStateToken } from '../apps/web/lib/guestState';
import { POST as plansPost } from '../apps/web/app/api/plans/route';
import { POST as skipRoute } from '../apps/web/app/api/plans/[planId]/skip/route';
import { POST as logRoute } from '../apps/web/app/api/plans/[planId]/log/route';
import { mapPlanRow, mapPersistedPlanStatus, isActionableUpcomingPlan, isCompletedPlan, type PersistedPlanStatus } from '../apps/web/lib/planFormatting';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
async function sql(t: string, p: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(t, p); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}
const req = (tok: string | null, body: any = {}): any => ({ cookies: { get: (n: string) => (tok && n === 'as_session' ? { value: tok } : undefined) }, json: async () => body, headers: new Headers() });

// ---- pure: direct mapper, exhaustive ----
const base = { id: 'x', title: 'T', plannedStartAt: '2026-06-10T17:00:00Z', plannedEndAt: '2026-06-10T18:00:00Z', durationMinutes: 60 };
const all: PersistedPlanStatus[] = ['UPCOMING', 'LOGGED', 'CANCELLED', 'SKIPPED'];
for (const s of all) check(`19. mapPlanRow preserves ${s} -> ${s}`, mapPlanRow({ ...base, status: s } as any, 'UTC').status === s);
check('19/6. an absent status (legacy row/fixture) is UPCOMING', mapPlanRow(base as any, 'UTC').status === 'UPCOMING' && mapPersistedPlanStatus(null) === 'UPCOMING');
check('20. an unknown runtime status fails loudly rather than defaulting to UPCOMING', (() => { try { mapPersistedPlanStatus('MYSTERY' as any); return false; } catch { return true; } })());
const src = strip(read('../apps/web/lib/planFormatting.ts'));
check("20. the mapper has no `=== 'LOGGED' ? 'LOGGED' : 'UPCOMING'` collapse and uses an exhaustive never check", !/=== 'LOGGED' \? 'LOGGED' : 'UPCOMING'/.test(src) && /const unreachable: never = status/.test(src));
check('10. presentation: only UPCOMING is actionable, only LOGGED is completed; CANCELLED/SKIPPED are neither', isActionableUpcomingPlan({ status: 'UPCOMING' }) && isActionableUpcomingPlan({}) && !isActionableUpcomingPlan({ status: 'SKIPPED' }) && !isActionableUpcomingPlan({ status: 'CANCELLED' }) && !isActionableUpcomingPlan({ status: 'LOGGED' }) && isCompletedPlan({ status: 'LOGGED' }) && !isCompletedPlan({ status: 'SKIPPED' }) && !isCompletedPlan({ status: 'CANCELLED' }));
const view = strip(read('../apps/web/components/PlanWithAuraView.tsx'));
check('10/11. the Plan tab lists come from the presentation predicates (correctness does not rely on a pre-mapper filter)', /savedPlans\.filter\(isActionableUpcomingPlan\)/.test(view) && /savedPlans\.filter\(isCompletedPlan\)/.test(view) && !/plan\.status !== 'LOGGED'\)/.test(view) && !/row\.status !== 'SKIPPED'/.test(view));
check('24. handleLogPlan refuses LOGGED/CANCELLED/SKIPPED/MOVED rows', /handleLogPlan[\s\S]{0,200}plan\.status === 'LOGGED' \|\| plan\.status === 'CANCELLED' \|\| plan\.status === 'SKIPPED' \|\| plan\.status === 'MOVED'\) return/.test(view));

async function main() {
  const u = await upsertUserByEmail({ email: 'test-status-preserve@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
  const tok = createSessionToken(u.id, u.email);
  const habits = async () => Number((await sql(`SELECT count(*)::int AS n FROM "HabitLog" WHERE "userId" = $1`, [u.id]))[0].n);
  const plansCount = async () => Number((await sql(`SELECT count(*)::int AS n FROM "PlannedActivity" WHERE "userId" = $1`, [u.id]))[0].n);
  const row = async (id: string) => (await sql(`SELECT status, "loggedAt", "skippedAt", "habitLogId", "updatedAt" FROM "PlannedActivity" WHERE id = $1`, [id]))[0];
  let seq = 0;
  const payload = (extra: any) => {
    const start = new Date(Date.now() + (5 + seq++) * 3600000); const end = new Date(start.getTime() + 3600000);
    return { title: `Replay plan ${Date.now()}-${seq}`, activityType: 'Replay plan', plannedStartAt: start.toISOString(), plannedEndAt: end.toISOString(), durationMinutes: 60, windowType: 'NEUTRAL', ...extra };
  };
  const guestToken = () => createGuestStateToken({ activityId: 'date-night', horizon: 'WEEKEND', timePreference: 'EVENING', durationMinutes: 60, cityName: 'Chennai', candidateStart: '2026-08-29T11:30:00.000Z', candidateEnd: '2026-08-29T12:30:00.000Z', source: 'AURA_MOMENT' });

  try {
    // 26. normal creation
    const normal = await (await plansPost(req(tok, payload({ clientRequestId: `n-${Date.now()}` })))).json();
    check('26/6. normal creation: POST creates UPCOMING -> mapped UPCOMING -> actionable (unchanged behavior)', normal.status === 'UPCOMING' && mapPlanRow(normal, 'Asia/Kolkata').status === 'UPCOMING' && isActionableUpcomingPlan(mapPlanRow(normal, 'Asia/Kolkata')));
    // 27. normal log
    const lg = await (await logRoute(req(tok), { params: { planId: normal.id } })).json();
    check('27/7/13. normal Log: the log result maps LOGGED and is the completed representation', mapPlanRow(lg.plan, 'Asia/Kolkata').status === 'LOGGED' && isCompletedPlan(mapPlanRow(lg.plan, 'Asia/Kolkata')) && !!lg.habitLog);

    for (const mechanism of ['clientRequestId', 'guestToken'] as const) {
      for (const terminal of ['SKIPPED', 'CANCELLED'] as const) {
        const key = mechanism === 'clientRequestId' ? { clientRequestId: `k-${terminal}-${Date.now()}` } : { guestConversionToken: guestToken() };
        const body = payload(key);
        const created = await (await plansPost(req(tok, body))).json();
        if (terminal === 'SKIPPED') await skipRoute(req(tok), { params: { planId: created.id } });
        else await cancelPlannedActivity(u.id, created.id);
        const before = await row(created.id);
        const h0 = await habits(); const n0 = await plansCount();
        const replayRes = await plansPost(req(tok, body));
        const replay = await replayRes.json();
        const after = await row(created.id);
        const label = `${mechanism} + ${terminal}`;
        check(`16-18/14/15. ${label}: replay returns the SAME plan with its current persisted status ${terminal}`, replayRes.status === 200 && replay.id === created.id && replay.status === terminal);
        const mapped = mapPlanRow(replay, 'Asia/Kolkata');
        check(`14/15. ${label}: mapPlanRow (the saveUpcomingPlanFromCandidate / Plan-tab-save mapping) preserves ${terminal}, never UPCOMING`, mapped.status === terminal && !isActionableUpcomingPlan(mapped) && !isCompletedPlan(mapped));
        check(`23. ${label}: replay mutates nothing (status, skippedAt, updatedAt unchanged), creates no HabitLog and no second plan`, after.status === terminal && (after.skippedAt?.getTime() ?? null) === (before.skippedAt?.getTime() ?? null) && after.updatedAt.getTime() === before.updatedAt.getTime() && (await habits()) === h0 && (await plansCount()) === n0 && after.loggedAt === null && after.habitLogId === null);
      }
    }
  } finally {
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [u.id]).catch(() => {});
    await sql(`DELETE FROM "HabitLog" WHERE "userId" = $1`, [u.id]).catch(() => {});
  }
  if (!allPassed) { console.error('SOME STATUS PRESERVATION CHECKS FAILED'); process.exit(1); }
  console.log('ALL STATUS PRESERVATION CHECKS PASSED');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
