/**
 * Remaining-Day Recomposition V1 PR F3 -- atomic acceptance against a REAL database: the real accept route, the real
 * transaction and locks, the real Move internals, real source continuity, real concurrency and a real rollback.
 * Proposals are signed with the server helper (F2's timing output is not the subject here); one end-to-end case runs
 * the real F2 route into the real accept route. Requires DATABASE_URL (fresh, 39 migrations).
 */
import {
  upsertUserByEmail, updateBirthProfile, createPlannedActivity, createCapture, getCaptureWithLinkedPlanStatus, createGoalWithActivities, addGoalActivity, deleteGoal,
  listGoalActivitiesWithLinkedPlanStatus, getUserById, beginTransaction, logPlannedActivity,
} from '../apps/web/lib/db';
import { createSessionToken, sign } from '../apps/web/lib/auth';
import { signRecompositionProposal } from '../apps/web/lib/remainingDayRecompositionIntegrity';
import { acceptRemainingDayRecomposition, realRecompositionAcceptanceDeps, type RecompositionAcceptanceDeps } from '../apps/web/lib/remainingDayRecompositionAcceptance';
import { movePlannedActivity } from '../apps/web/lib/planMove';
import { getWeekdayForDateStr } from '../apps/web/lib/availabilityContext';
import { deriveCaptureState } from '../apps/web/lib/captures';
import { deriveGoalActivityState } from '../apps/web/lib/goals';
import { getDatePartsInTimezone } from '../apps/web/lib/timezone';
import { POST as acceptRoute } from '../apps/web/app/api/day/recompose/accept/route';
import { POST as recomposeRoute } from '../apps/web/app/api/day/recompose/route';
import { POST as skipRoute } from '../apps/web/app/api/plans/[planId]/skip/route';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const MIN = 60000; const HOUR = 3600000;
async function sql(t: string, p: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(t, p); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}
const fakeReq = (cookie: string | undefined, body: unknown): any => ({ cookies: { get: (n: string) => (cookie !== undefined && n === 'as_session' ? { value: cookie } : undefined) }, json: async () => { if (body === '__BAD_JSON__') throw new Error('bad'); return body; }, headers: new Headers() });
function earlyDayZone(now: Date): string {
  for (const tz of ['Pacific/Kiritimati', 'Pacific/Auckland', 'Australia/Sydney', 'Asia/Tokyo', 'Asia/Kolkata', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Pacific/Honolulu', 'Etc/GMT+12', 'Pacific/Pago_Pago']) {
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now));
    if (hour >= 1 && hour <= 6) return tz;
  }
  return 'Etc/GMT+12';
}

async function main() {
  const boot = new Date();
  const TZ = earlyDayZone(boot);
  const mkUser = async (label: string) => {
    const U = await upsertUserByEmail({ email: `test-recompose-accept-${label}@example.com`, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
    await updateBirthProfile(U.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
    return { U, tok: createSessionToken(U.id, U.email) };
  };
  const A = await mkUser('a');
  const B = await mkUser('b');
  const goalIds: string[] = [];
  const targetDate = getDatePartsInTimezone(TZ, boot).dateStr;
  const base = Math.ceil(boot.getTime() / MIN) * MIN;
  /** Slot k: starts (60 + 60k) minutes from now, one hour long. Early-day zone => all of k in 0..9 stay inside today. */
  const startOf = (k: number) => new Date(base + (60 + 60 * k) * MIN);
  let n = 0;
  const mk = async (user: typeof A, k: number, mode: 'FIXED' | 'FLEXIBLE' | null, dur = 60, title?: string) =>
    createPlannedActivity({ userId: user.U.id, title: title ?? `Plan ${++n}-${Date.now()}`, plannedStartAt: startOf(k), plannedEndAt: new Date(startOf(k).getTime() + dur * MIN), durationMinutes: dur, windowType: 'NEUTRAL', schedulingMode: mode });
  const slotOfPlan = (p: any) => ({ start: new Date(p.plannedStartAt), end: new Date(p.plannedEndAt) });
  const MOVE = (p: any, toK: number, toDur?: number) => ({ decision: 'MOVE', planId: p.id, title: p.title, current: slotOfPlan(p), to: { start: startOf(toK), end: new Date(startOf(toK).getTime() + (toDur ?? p.durationMinutes) * MIN) } });
  const MOVE_TO = (p: any, start: Date, end: Date) => ({ decision: 'MOVE', planId: p.id, title: p.title, current: slotOfPlan(p), to: { start, end } });
  const KEEP = (p: any) => ({ decision: 'KEEP', planId: p.id, title: p.title, current: slotOfPlan(p) });
  const UNRES = (p: any) => ({ decision: 'UNRESOLVED', planId: p.id, title: p.title, current: slotOfPlan(p) });
  const token = (user: typeof A, decisions: any[], state = 'CHANGES_PROPOSED') => signRecompositionProposal(user.U.id, { generatedAt: boot, targetDate, timezone: TZ, summary: { state }, decisions } as any)!;
  /** `now` (when given) is the post-lock acceptance clock supplied through the explicit TEST SEAM (deps.readClock); production never passes one. */
  const accept = (user: typeof A, tk: string, now?: Date, deps?: Partial<RecompositionAcceptanceDeps>) => acceptRemainingDayRecomposition(user.U.id, tk, { ...realRecompositionAcceptanceDeps, ...(deps ?? {}), ...(now ? { readClock: async () => now } : {}) });
  const viaRoute = async (user: typeof A | null, body: unknown) => { const res = await acceptRoute(fakeReq(user?.tok, body)); return { status: res.status, json: await res.json() }; };
  const row = async (id: string) => (await sql(`SELECT * FROM "PlannedActivity" WHERE id = $1`, [id]))[0];
  const successors = async (id: string) => sql(`SELECT * FROM "PlannedActivity" WHERE "rescheduledFromPlanId" = $1`, [id]);
  const totalPlans = async () => Number((await sql(`SELECT count(*)::int n FROM "PlannedActivity" WHERE "userId" = ANY($1)`, [[A.U.id, B.U.id]]))[0].n);
  const reset = async () => {
    for (const u of [A, B]) {
      await sql(`UPDATE "Capture" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [u.U.id]);
      await sql(`UPDATE "GoalActivity" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [u.U.id]);
      await sql(`DELETE FROM "AuraMoment" WHERE "ownerUserId" = $1`, [u.U.id]);
      await sql(`UPDATE "PlannedActivity" SET "rescheduledFromPlanId" = NULL WHERE "userId" = $1`, [u.U.id]);
      await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [u.U.id]);
      await sql(`DELETE FROM "HabitLog" WHERE "userId" = $1`, [u.U.id]);
    }
    await sql(`UPDATE "User" SET timezone = $1 WHERE id = ANY($2)`, [TZ, [A.U.id, B.U.id]]);
  };
  const untouched = async (...plans: any[]) => { for (const p of plans) { const r = await row(p.id); if (r.status !== 'UPCOMING' || (await successors(p.id)).length !== 0 || new Date(r.plannedStartAt).getTime() !== new Date(p.plannedStartAt).getTime()) return false; } return true; };
  const rejected = (r: any, reason: string) => r.status === 'STALE' && r.reason === reason;

  try {
    // ================= final-state validation: swap, rotation, touching =================
    await reset();
    let a = await mk(A, 1, 'FLEXIBLE'); let b = await mk(A, 2, 'FLEXIBLE');
    const swap = await accept(A, token(A, [MOVE(a, 2), MOVE(b, 1)]));
    const ra = await row(a.id); const rb = await row(b.id);
    const sa = (await successors(a.id))[0]; const sb = (await successors(b.id))[0];
    check('26/56. SWAP: A 1->2 and B 2->1 succeeds ATOMICALLY (validation is on the FINAL schedule, not sequential): both sources MOVED, both successors UPCOMING at the swapped slots', swap.status === 'ACCEPTED' && ra.status === 'MOVED' && rb.status === 'MOVED' && new Date(sa.plannedStartAt).getTime() === startOf(2).getTime() && new Date(sb.plannedStartAt).getTime() === startOf(1).getTime() && sa.status === 'UPCOMING' && sb.status === 'UPCOMING');
    check('33/53. successor semantics: rescheduledFromPlanId = source, schedulingMode inherited, duration preserved, time-specific evaluation reset (NEUTRAL, no window/match/score/recommendation), the response maps source -> successor with the resulting slots', sa.rescheduledFromPlanId === a.id && sa.schedulingMode === 'FLEXIBLE' && sa.durationMinutes === 60 && sa.windowType === 'NEUTRAL' && sa.windowLabel === null && sa.score === null && sa.recommendation === null && (swap as any).moves.length === 2 && (swap as any).moves.every((m: any) => m.successorPlanId === (m.sourcePlanId === a.id ? sa.id : sb.id) && m.successor.status === 'UPCOMING'));

    await reset();
    a = await mk(A, 1, 'FLEXIBLE'); b = await mk(A, 2, 'FLEXIBLE'); const c = await mk(A, 3, 'FLEXIBLE');
    const rot = await accept(A, token(A, [MOVE(a, 2), MOVE(b, 3), MOVE(c, 1)]));
    const slots = await Promise.all([a, b, c].map(async (p) => new Date((await successors(p.id))[0].plannedStartAt).getTime()));
    check('57. THREE-WAY ROTATION (A 1->2, B 2->3, C 3->1) succeeds atomically', rot.status === 'ACCEPTED' && slots.join() === [startOf(2), startOf(3), startOf(1)].map((d) => d.getTime()).join());

    await reset();
    a = await mk(A, 1, 'FLEXIBLE'); const fixed3 = await mk(A, 4, 'FIXED');
    const touching = await accept(A, token(A, [MOVE(a, 3)])); // [k3, k3+1h) ends exactly when the FIXED plan at k4 starts
    check('27. touching intervals are allowed: a destination ending exactly where a FIXED plan begins is accepted', touching.status === 'ACCEPTED' && (await row(fixed3.id)).status === 'UPCOMING');

    // ================= source continuity =================
    await reset();
    const cap = await createCapture(A.U.id, 'Renew passport');
    const goal = await createGoalWithActivities({ userId: A.U.id, title: 'Recompose goal', targetDate: null, activities: [] });
    goalIds.push(goal.goal.id);
    const ga = await addGoalActivity(A.U.id, goal.goal.id, { title: 'Draft deck', activityId: null });
    a = await mk(A, 1, 'FLEXIBLE'); b = await mk(A, 2, 'FLEXIBLE'); const cc = await mk(A, 3, 'FLEXIBLE');
    await sql(`UPDATE "Capture" SET "plannedActivityId" = $1 WHERE id = $2`, [a.id, cap.id]);
    await sql(`UPDATE "GoalActivity" SET "plannedActivityId" = $1 WHERE id = $2`, [b.id, ga!.id]);
    const cont = await accept(A, token(A, [MOVE(a, 5), MOVE(b, 6), MOVE(cc, 7)]));
    const capRow = (await getCaptureWithLinkedPlanStatus(A.U.id, cap.id))!;
    const gaRow = (await listGoalActivitiesWithLinkedPlanStatus(A.U.id, goal.goal.id)).find((r) => r.id === ga!.id)!;
    const [sA, sB, sC] = await Promise.all([a, b, cc].map(async (p) => (await successors(p.id))[0]));
    check('35/36/37. MULTI-SOURCE CONTINUITY in one transaction: Capture-linked A, Goal-linked B and source-less C all move; the Capture and the GoalActivity follow to their successors and stay PLANNED', cont.status === 'ACCEPTED' && capRow.plannedActivityId === sA.id && deriveCaptureState({ status: capRow.status, completedAt: capRow.completedAt, linkedPlanStatus: capRow.linkedPlanStatus }) === 'PLANNED' && gaRow.plannedActivityId === sB.id && deriveGoalActivityState({ status: gaRow.status, plannedActivityId: gaRow.plannedActivityId, linkedPlanStatus: gaRow.linkedPlanStatus }) === 'PLANNED' && !!sC);

    // ================= move chains =================
    await reset();
    a = await mk(A, 1, 'FLEXIBLE');
    const first = await movePlannedActivity(A.U.id, a.id, { newStartAt: startOf(3) }); // manual A -> B
    const chain = await accept(A, token(A, [MOVE(first.to, 6)])); // proposal moves the LIVE occurrence B -> C
    const rA = await row(a.id); const rB = await row(first.to.id); const cSucc = (await successors(first.to.id))[0];
    check('38. MOVE CHAIN: manual A -> B, then a proposal moves B -> C gives A MOVED -> B MOVED -> C UPCOMING with intact lineage; A is not rewritten', chain.status === 'ACCEPTED' && rA.status === 'MOVED' && rB.status === 'MOVED' && cSucc.status === 'UPCOMING' && cSucc.rescheduledFromPlanId === first.to.id && rB.rescheduledFromPlanId === a.id && rA.rescheduledFromPlanId === null && cSucc.schedulingMode === 'FLEXIBLE');

    // ================= KEEP / UNRESOLVED are unchanged occurrences =================
    await reset();
    a = await mk(A, 1, 'FLEXIBLE'); const k = await mk(A, 2, 'FLEXIBLE'); const u = await mk(A, 3, 'FLEXIBLE');
    const beforeK = await row(k.id); const beforeU = await row(u.id);
    const ku = await accept(A, token(A, [MOVE(a, 6), KEEP(k), UNRES(u)]));
    const afterK = await row(k.id); const afterU = await row(u.id);
    check('14/72/73. KEEP and UNRESOLVED plans are NOT mutated (same row, same updatedAt, no successor) and only the signed MOVE moved', ku.status === 'ACCEPTED' && (ku as any).moves.length === 1 && JSON.stringify(beforeK) === JSON.stringify(afterK) && JSON.stringify(beforeU) === JSON.stringify(afterU) && (await successors(k.id)).length === 0 && (await successors(u.id)).length === 0);
    await reset();
    a = await mk(A, 1, 'FLEXIBLE'); const k2 = await mk(A, 2, 'FLEXIBLE'); const u2 = await mk(A, 3, 'FLEXIBLE');
    check('71/72. a destination overlapping a KEEP plan, or an UNRESOLVED plan, is a CONFLICT (they keep BLOCKING); nothing changes', rejected(await accept(A, token(A, [MOVE_TO(a, startOf(2), new Date(startOf(2).getTime() + HOUR)), KEEP(k2)])), 'CONFLICT') && rejected(await accept(A, token(A, [MOVE(a, 3), UNRES(u2)])), 'CONFLICT') && (await untouched(a, k2, u2)));

    // ================= idempotency + concurrency =================
    await reset();
    a = await mk(A, 1, 'FLEXIBLE'); b = await mk(A, 2, 'FLEXIBLE');
    const proposal1 = token(A, [MOVE(a, 5), MOVE(b, 6)]);
    const before1 = await totalPlans();
    const [r1, r2] = await Promise.all([accept(A, proposal1), accept(A, proposal1)]);
    const statuses = [r1.status, r2.status].sort().join();
    check('43/50. CONCURRENT identical requests: exactly ONE performs the moves and the other returns ALREADY_ACCEPTED -- no duplicate successors', statuses === 'ACCEPTED,ALREADY_ACCEPTED' && (await totalPlans()) === before1 + 2 && (await successors(a.id)).length === 1 && (await successors(b.id)).length === 1);
    const replay = await accept(A, proposal1);
    const replayRoute = await viaRoute(A, { proposalToken: proposal1 });
    check('39/41/48. identical REPLAY (double click / retry after timeout) returns ALREADY_ACCEPTED with the ORIGINAL mapping and writes nothing', replay.status === 'ALREADY_ACCEPTED' && (replay as any).moves.every((m: any) => m.successorPlanId === (r1.status === 'ACCEPTED' ? r1 : r2 as any).moves.find((x: any) => x.sourcePlanId === m.sourcePlanId).successorPlanId) && replayRoute.status === 200 && replayRoute.json.status === 'ALREADY_ACCEPTED' && (await totalPlans()) === before1 + 2);

    await reset();
    a = await mk(A, 1, 'FLEXIBLE'); b = await mk(A, 2, 'FLEXIBLE'); const c3 = await mk(A, 3, 'FLEXIBLE');
    const [p1, p2] = [token(A, [MOVE(a, 5), MOVE(b, 6)]), token(A, [MOVE(a, 7), MOVE(c3, 8)])]; // share source A
    const [x1, x2] = await Promise.all([accept(A, p1), accept(A, p2)]);
    const outcomes = [x1, x2].map((x) => x.status).sort().join();
    const loser = x1.status === 'ACCEPTED' ? x2 : x1;
    check('44. TWO PROPOSALS sharing a source: only one commits; the other is STALE (its shared source is no longer UPCOMING) and its other plan is untouched -- one successor for the shared source', outcomes === 'ACCEPTED,STALE' && (loser as any).reason === 'LIFECYCLE_CHANGED' && (await successors(a.id)).length === 1 && ((x1.status === 'ACCEPTED') ? (await successors(c3.id)).length === 0 : (await successors(b.id)).length === 0));

    await reset();
    a = await mk(A, 1, 'FLEXIBLE'); b = await mk(A, 2, 'FLEXIBLE');
    const raceToken = token(A, [MOVE(a, 5), MOVE(b, 6)]);
    const manual = movePlannedActivity(A.U.id, a.id, { newStartAt: startOf(8) }).then(() => 'MANUAL_OK', (e: any) => `MANUAL_${e.code}`);
    const [ra2, man] = await Promise.all([accept(A, raceToken), manual]);
    const aSucc = await successors(a.id); const bSucc = await successors(b.id);
    check('45. ACCEPTANCE vs MANUAL MOVE of a source: one coherent winner. Accepted -> both sources moved once and the manual Move was refused; manual won -> the whole proposal is STALE and the OTHER source (B) is untouched', aSucc.length === 1 && ((ra2.status === 'ACCEPTED' && bSucc.length === 1 && man !== 'MANUAL_OK') || (ra2.status === 'STALE' && man === 'MANUAL_OK' && bSucc.length === 0 && (await row(b.id)).status === 'UPCOMING')));

    await reset();
    a = await mk(A, 1, 'FLEXIBLE'); b = await mk(A, 2, 'FLEXIBLE');
    const doneToken = token(A, [MOVE(a, 5), MOVE(b, 6)]);
    const skip = skipRoute(fakeReq(A.tok, {}), { params: { planId: a.id } }).then((r: any) => r.status);
    const [rd, skipStatus] = await Promise.all([accept(A, doneToken), skip]);
    const bS = await successors(b.id);
    check('46. ACCEPTANCE vs SKIP of a source: either the skip wins (whole proposal STALE, B untouched) or the acceptance wins (skip refused) -- never a half-recomposed day', (rd.status === 'STALE' && bS.length === 0 && (await row(a.id)).status === 'SKIPPED') || (rd.status === 'ACCEPTED' && bS.length === 1 && (await row(a.id)).status === 'MOVED' && skipStatus !== 200));

    // ================= staleness matrix: whole proposal rejects, nothing partial =================
    const scenario = async (label: string, reason: string, mutate: (m: { a: any; b: any; k: any }) => Promise<void> | void, opts: { now?: (m: { a: any; b: any }) => Date; deps?: Partial<RecompositionAcceptanceDeps>; decisions?: (m: { a: any; b: any; k: any }) => any[] } = {}) => {
      await reset();
      const sa2 = await mk(A, 1, 'FLEXIBLE'); const sb2 = await mk(A, 2, 'FLEXIBLE'); const sk2 = await mk(A, 3, 'FLEXIBLE');
      const m = { a: sa2, b: sb2, k: sk2 };
      const tk = token(A, opts.decisions ? opts.decisions(m) : [MOVE(sa2, 5), MOVE(sb2, 6), KEEP(sk2)]);
      await mutate(m);
      const plansBefore = await totalPlans();
      const succBefore = (await successors(sa2.id)).length + (await successors(sb2.id)).length;
      const r = await accept(A, tk, opts.now?.(m), opts.deps);
      const okStale = rejected(r, reason);
      const bUntouched = (await totalPlans()) === plansBefore && (await successors(sa2.id)).length + (await successors(sb2.id)).length === succBefore && (await row(sb2.id)).status === 'UPCOMING';
      check(`61-69. ${label}: STALE / ${reason}, the whole proposal is rejected and NOTHING is written (the sibling MOVE is untouched)`, okStale && bUntouched);
    };
    await scenario('a source was manually moved by someone else (slot changed)', 'SOURCE_SLOT_CHANGED', async (m) => { await sql(`UPDATE "PlannedActivity" SET "plannedStartAt" = $2, "plannedEndAt" = $3 WHERE id = $1`, [m.a.id, startOf(8), new Date(startOf(8).getTime() + HOUR)]); });
    await scenario('a source was LOGGED (Done)', 'LIFECYCLE_CHANGED', async (m) => { await sql(`UPDATE "PlannedActivity" SET status = 'LOGGED', "loggedAt" = now() WHERE id = $1`, [m.a.id]); });
    await scenario('a source was SKIPPED', 'LIFECYCLE_CHANGED', async (m) => { await sql(`UPDATE "PlannedActivity" SET status = 'SKIPPED', "skippedAt" = now() WHERE id = $1`, [m.a.id]); });
    await scenario('a source was CANCELLED', 'LIFECYCLE_CHANGED', async (m) => { await sql(`UPDATE "PlannedActivity" SET status = 'CANCELLED' WHERE id = $1`, [m.a.id]); });
    await scenario('a source was MOVED manually (one of two signed MOVEs already applied)', 'LIFECYCLE_CHANGED', async (m) => { await movePlannedActivity(A.U.id, m.a.id, { newStartAt: startOf(8) }); });
    await scenario('a source became FIXED', 'SCHEDULING_MODE_CHANGED', async (m) => { await sql(`UPDATE "PlannedActivity" SET "schedulingMode" = 'FIXED' WHERE id = $1`, [m.a.id]); });
    await scenario('a source lost its scheduling mode (NULL/unknown)', 'SCHEDULING_MODE_CHANGED', async (m) => { await sql(`UPDATE "PlannedActivity" SET "schedulingMode" = NULL WHERE id = $1`, [m.a.id]); });
    await scenario('an active AuraMoment appeared on a source', 'MOMENT_ACTIVE', async (m) => { await sql(`INSERT INTO "AuraMoment" (id, "ownerUserId", "publicToken", scope, source, "activityId", "activityTitle", "startAt", "endAt", timezone, "plannedActivityId") VALUES ($1, $2, $3, 'SHARED', 'PLAN', 'date-night', 'x', $4, $5, $6, $7)`, [`am-${Date.now()}`, A.U.id, `am-t-${Date.now()}`, m.a.plannedStartAt, m.a.plannedEndAt, TZ, m.a.id]); });
    await scenario('a source is ACTIVE at acceptance (its start has passed while the user viewed the proposal)', 'ACTIVE_OR_MISSED', () => {}, { now: (m) => new Date(new Date(m.a.plannedStartAt).getTime() + MIN) });
    await scenario('a source is MISSED at acceptance (its end has passed)', 'ACTIVE_OR_MISSED', () => {}, { now: (m) => new Date(new Date(m.a.plannedEndAt).getTime() + MIN) });
    await scenario('a destination has entered the past (clock advanced beyond it)', 'DESTINATION_PAST', () => {}, { decisions: (m) => [MOVE_TO(m.b, startOf(0), new Date(startOf(0).getTime() + HOUR)), MOVE(m.a, 6), KEEP(m.k)], now: (m) => new Date(startOf(0).getTime() + 30 * MIN + 0 * (m.a ? 1 : 0)) });
    await scenario('the local day changed (the request began on day D; the post-lock acceptance clock is already D+1)', 'DAY_CHANGED', () => {}, { now: () => new Date(base + 26 * HOUR) });
    await scenario('the user\'s timezone changed after the proposal', 'TIMEZONE_CHANGED', async () => { await sql(`UPDATE "User" SET timezone = $1 WHERE id = $2`, [TZ === 'Asia/Tokyo' ? 'Asia/Kolkata' : 'Asia/Tokyo', A.U.id]); });
    const availDeps = (periods: { weekday: number; startTime: string; endTime: string }[] | null): Partial<RecompositionAcceptanceDeps> => ({ loadAvailabilityConfiguration: async () => ({ configured: periods !== null, periods: periods ?? [] }) as any });
    const weekday = getWeekdayForDateStr(targetDate);
    await scenario('availability changed: destinations fall outside the configured windows', 'AVAILABILITY_CHANGED', () => {}, { deps: availDeps([{ weekday, startTime: '00:00', endTime: '00:30' }]) });
    await scenario('availability changed to CONFIGURED-EMPTY (never becomes "the whole day")', 'AVAILABILITY_CHANGED', () => {}, { deps: availDeps([]) });
    await scenario('a new FIXED plan now overlaps a destination (protected collision)', 'CONFLICT', async (m) => { await mk(A, 5, 'FIXED', 60, 'Newly fixed'); void m; });
    await scenario('a plan that was NOT in the proposal (e.g. one held back by the 12-plan cap) now sits on a destination -- it still blocks', 'CONFLICT', async () => { await mk(A, 6, 'FLEXIBLE', 30, 'Overflow plan'); });
    await scenario('a KEEP plan\'s slot changed (the proposal was one coherent final schedule)', 'KEEP_CHANGED', async (m) => { await sql(`UPDATE "PlannedActivity" SET "plannedStartAt" = $2, "plannedEndAt" = $3 WHERE id = $1`, [m.k.id, startOf(9), new Date(startOf(9).getTime() + HOUR)]); });
    await scenario('a KEEP plan was completed', 'LIFECYCLE_CHANGED', async (m) => { await sql(`UPDATE "PlannedActivity" SET status = 'LOGGED', "loggedAt" = now() WHERE id = $1`, [m.k.id]); });
    await scenario('two signed destinations overlap each other (destination collision)', 'CONFLICT', () => {}, { decisions: (m) => [MOVE_TO(m.a, startOf(5), new Date(startOf(5).getTime() + HOUR)), MOVE_TO(m.b, new Date(startOf(5).getTime() + 30 * MIN), new Date(startOf(5).getTime() + 90 * MIN)), KEEP(m.k)] });
    await scenario('the signed destination duration disagrees with the persisted plan (60 -> 30 minutes)', 'DURATION_MISMATCH', () => {}, { decisions: (m) => [MOVE(m.a, 5, 30), MOVE(m.b, 6), KEEP(m.k)] });
    await scenario('a signed plan does not exist for this user', 'SOURCE_NOT_FOUND', async (m) => { await sql(`DELETE FROM "PlannedActivity" WHERE id = $1`, [m.k.id]); });
    await reset();
    const strangers = await mk(B, 1, 'FLEXIBLE');
    const crossUser = await accept(A, token(A, [MOVE(strangers, 5)]));
    check('51. cross-user: user A\'s (genuinely signed) proposal naming user B\'s plan cannot touch it (SOURCE_NOT_FOUND), B\'s plan is unchanged', rejected(crossUser, 'SOURCE_NOT_FOUND') && (await untouched(strangers)));

    // ================= availability, positive path =================
    await reset();
    a = await mk(A, 1, 'FLEXIBLE');
    const okAvail = await accept(A, token(A, [MOVE(a, 5)]), undefined, availDeps([{ weekday, startTime: '00:00', endTime: '23:59' }]));
    check('24/47. availability, positive: a configured full-day availability accepts a valid destination (availability semantics reused)', okAvail.status === 'ACCEPTED');

    // ================= ACCEPTANCE CLOCK: lock-wait time counts (F3 final-review correction) =================
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const holdAdvisoryLock = async (userId: string) => {
      const holder = await beginTransaction();
      await holder.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`day-constructor-accept:${userId}`]);
      return { release: async () => { await holder.query('COMMIT'); holder.release(); } };
    };
    await reset();
    const lwCap = await createCapture(A.U.id, 'Lock-wait capture');
    const lwGoal = await createGoalWithActivities({ userId: A.U.id, title: 'Lock-wait goal', targetDate: null, activities: [] });
    goalIds.push(lwGoal.goal.id);
    const lwGa = await addGoalActivity(A.U.id, lwGoal.goal.id, { title: 'Lock-wait step', activityId: null });
    a = await mk(A, 1, 'FLEXIBLE'); b = await mk(A, 2, 'FLEXIBLE');
    await sql(`UPDATE "Capture" SET "plannedActivityId" = $1 WHERE id = $2`, [a.id, lwCap.id]);
    await sql(`UPDATE "GoalActivity" SET "plannedActivityId" = $1 WHERE id = $2`, [b.id, lwGa!.id]);
    const soon = new Date(Date.now() + 3000);
    const lwToken = token(A, [MOVE_TO(a, soon, new Date(soon.getTime() + HOUR)), MOVE(b, 6)]); // A's destination starts 3 seconds from now
    const held = await holdAdvisoryLock(A.U.id);
    const lwStarted = Date.now();
    const lwPending = viaRoute(A, { proposalToken: lwToken }); // the REAL route: it must not capture a clock before waiting for the lock
    await sleep(5000); // the signed destination start is now in the past while the request still waits
    await held.release();
    const lwRes = await lwPending;
    const capAfterLw = (await sql(`SELECT "plannedActivityId" FROM "Capture" WHERE id = $1`, [lwCap.id]))[0];
    const gaAfterLw = (await sql(`SELECT "plannedActivityId" FROM "GoalActivity" WHERE id = $1`, [lwGa!.id]))[0];
    check('2/17. LOCK-WAIT REGRESSION (the review probe): a destination that was future when the request arrived but passed while it waited for the advisory lock is rejected -- 409 STALE / DESTINATION_PAST on the source; no successor, both sources still UPCOMING, no Capture or Goal repoint, no partial sibling Move', Date.now() - lwStarted >= 4500 && lwRes.status === 409 && lwRes.json.status === 'STALE' && lwRes.json.reason === 'DESTINATION_PAST' && lwRes.json.planId === a.id && (await untouched(a, b)) && capAfterLw.plannedActivityId === a.id && gaAfterLw.plannedActivityId === b.id);

    await reset();
    const nowMs = Date.now();
    const soonSrc = await createPlannedActivity({ userId: A.U.id, title: `Starts soon ${nowMs}`, plannedStartAt: new Date(nowMs + 4000), plannedEndAt: new Date(nowMs + 4000 + HOUR), durationMinutes: 60, windowType: 'NEUTRAL', schedulingMode: 'FLEXIBLE' });
    b = await mk(A, 2, 'FLEXIBLE');
    const activeToken = token(A, [MOVE(soonSrc, 6), MOVE(b, 7)]);
    const held2 = await holdAdvisoryLock(A.U.id);
    const activePending = viaRoute(A, { proposalToken: activeToken });
    await sleep(6000); // the source was future at request entry and has STARTED (ACTIVE) while waiting
    await held2.release();
    const activeRes = await activePending;
    check('10/18. ACTIVE-WHILE-WAITING: a source that was future at request entry and became ACTIVE while the request waited for the lock is rejected after the lock (409 ACTIVE_OR_MISSED) with zero writes', activeRes.status === 409 && activeRes.json.reason === 'ACTIVE_OR_MISSED' && (await untouched(soonSrc, b)));

    // one clock, read once, after the locks, on the transaction connection; failure fails closed
    await reset();
    a = await mk(A, 1, 'FLEXIBLE'); b = await mk(A, 2, 'FLEXIBLE');
    let clockReads = 0; const seenAfterLock: number[] = [];
    const countingClock = async (client: any) => { clockReads += 1; const lockRows = await client.query(`SELECT count(*)::int n FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()`); seenAfterLock.push(Number(lockRows.rows[0].n)); return new Date(); };
    const oneClock = await accept(A, token(A, [MOVE(a, 5), MOVE(b, 6)]), undefined, { readClock: countingClock });
    check('5/7/20. ONE authoritative clock: read exactly once per acceptance, on the transaction connection, AFTER the advisory lock was taken (the same backend already holds it), and reused for every time-sensitive decision', oneClock.status === 'ACCEPTED' && clockReads === 1 && seenAfterLock[0] >= 1);
    const replayClock = await accept(A, token(A, [MOVE(a, 5), MOVE(b, 6)]), undefined, { readClock: countingClock });
    check('27. REPLAY ORDER: an identical replay is recognised BEFORE the clock is even read -- it cannot be turned into DESTINATION_PAST or DAY_CHANGED by time passing', replayClock.status === 'ALREADY_ACCEPTED' && clockReads === 1);
    const laterToken = token(A, [MOVE(a, 5), MOVE(b, 6)]);
    const replayAfterDestinations = await accept(A, laterToken, new Date(startOf(9).getTime()));
    const replayNextDay = await accept(A, laterToken, new Date(base + 30 * HOUR));
    check('26/27. an ALREADY-ACCEPTED proposal replays as ALREADY_ACCEPTED even after its destinations have passed and even after local midnight (retry safety), with the original mapping', replayAfterDestinations.status === 'ALREADY_ACCEPTED' && replayNextDay.status === 'ALREADY_ACCEPTED' && (await successors(a.id)).length === 1 && (await successors(b.id)).length === 1);
    await reset();
    a = await mk(A, 1, 'FLEXIBLE'); b = await mk(A, 2, 'FLEXIBLE');
    const failingClock = await accept(A, token(A, [MOVE(a, 5), MOVE(b, 6)]), undefined, { readClock: async () => { throw new Error('clock unavailable'); } });
    check('8. CLOCK FAILURE fails closed: SAVE_FAILED, rolled back, no fallback to a route/pre-lock clock, nothing written', failingClock.status === 'SAVE_FAILED' && (await untouched(a, b)));

    // Done vs acceptance: real concurrency with several relative start offsets; every round must end coherent
    let doneWon = 0; let acceptWon = 0; let incoherent = 0;
    for (const delay of [0, 2, 5, 10, 20, 40]) {
      await reset();
      const da = await mk(A, 1, 'FLEXIBLE'); const db = await mk(A, 2, 'FLEXIBLE');
      const dtk = token(A, [MOVE(da, 5), MOVE(db, 6)]);
      const [res, done] = await Promise.all([accept(A, dtk), sleep(delay).then(() => logPlannedActivity(A.U.id, da.id).then(() => 'DONE_OK', () => 'DONE_FAILED'))]);
      const rowA = await row(da.id); const rowB = await row(db.id);
      const succ = (await successors(da.id)).length + (await successors(db.id)).length;
      const coherent = (res.status === 'ACCEPTED' && done === 'DONE_FAILED' && rowA.status === 'MOVED' && rowB.status === 'MOVED' && succ === 2) || (res.status === 'STALE' && done === 'DONE_OK' && rowA.status === 'LOGGED' && rowB.status === 'UPCOMING' && succ === 0);
      if (!coherent) incoherent += 1; else if (res.status === 'ACCEPTED') acceptWon += 1; else doneWon += 1;
    }
    check(`24/30. DONE vs ACCEPTANCE (6 real concurrent rounds at different offsets; ${acceptWon} won by acceptance, ${doneWon} by Done): every round is coherent -- either the whole proposal applied and Done was refused, or Done won and the whole proposal is STALE with the sibling untouched; no duplicate successor, no lifecycle corruption`, incoherent === 0 && acceptWon + doneWon === 6);

    // ================= tokens through the real route =================
    await reset();
    a = await mk(A, 1, 'FLEXIBLE'); b = await mk(A, 2, 'FLEXIBLE');
    const good = token(A, [MOVE(a, 5), MOVE(b, 6)]);
    const wrong = await viaRoute(B, { proposalToken: good });
    const [gb, gs] = good.split('.');
    const tampered = await viaRoute(A, { proposalToken: `${gb}.${gs.slice(0, -2)}${gs.endsWith('AA') ? 'BB' : 'AA'}` });
    const wrongPurpose = await viaRoute(A, { proposalToken: sign({ k: 'dc-preview-item', v: 1, f: [] }) });
    const badVersion = await viaRoute(A, { proposalToken: sign({ k: 'rdr-proposal', v: 9, f: [] }) });
    const missing = await viaRoute(A, {});
    const nonString = await viaRoute(A, { proposalToken: { x: 1 } });
    const badJson = await viaRoute(A, '__BAD_JSON__');
    const unauth = await viaRoute(null, { proposalToken: good });
    check('48/49/50/55. TOKEN handling through the real route: another user, a mutated signature, the F1 preview purpose, an unknown version, a missing/non-string token and an unparseable body are all 400 INVALID_TOKEN (never 500); unauthenticated is 401 -- and nothing was written', [wrong, tampered, wrongPurpose, badVersion, missing, nonString, badJson].every((r) => r.status === 400 && r.json.status === 'INVALID_TOKEN') && unauth.status === 401 && (await untouched(a, b)));
    const stalePost = await viaRoute(A, { proposalToken: token(A, [MOVE(a, 5), MOVE({ ...b, plannedStartAt: startOf(9), plannedEndAt: new Date(startOf(9).getTime() + HOUR) }, 6)]) });
    check('54/55. a genuine but stale proposal is HTTP 409 STALE with a machine-readable reason (distinct from 400 INVALID_TOKEN)', stalePost.status === 409 && stalePost.json.status === 'STALE' && stalePost.json.reason === 'SOURCE_SLOT_CHANGED' && (await untouched(a, b)));
    const extras = await viaRoute(A, { proposalToken: good, decisions: [{ planId: 'x', decision: 'MOVE' }], schedulingMode: 'FLEXIBLE', timezone: 'UTC', targetDate: '2000-01-01', moves: [] });
    check('11/52/53. the body is only { proposalToken }: extra client fields have NO authority (the verified token alone decides), and the response carries the source -> successor mappings with the resulting slots', extras.status === 200 && extras.json.status === 'ACCEPTED' && extras.json.moves.length === 2 && extras.json.moves.every((m: any) => m.sourcePlanId && m.successorPlanId && m.from && m.to && m.successor.status === 'UPCOMING') && extras.json.targetDate === targetDate);

    // ================= rollback =================
    await reset();
    const capRb = await createCapture(A.U.id, 'Rollback capture');
    a = await mk(A, 1, 'FLEXIBLE'); b = await mk(A, 2, 'FLEXIBLE');
    const [firstId, secondId] = [a.id, b.id].sort();
    const [firstPlan, secondPlan] = [a, b].sort((x, y) => (x.id < y.id ? -1 : 1));
    await sql(`UPDATE "Capture" SET "plannedActivityId" = $1 WHERE id = $2`, [firstId, capRb.id]);
    // A rogue row already claims to be the successor of the SECOND source, so the second insert violates the unique lineage index AFTER the first successor was created inside the transaction.
    await sql(`INSERT INTO "PlannedActivity" (id, "userId", title, "plannedStartAt", "plannedEndAt", "durationMinutes", "windowType", "rescheduledFromPlanId") VALUES ($1, $2, 'rogue', $3, $4, 60, 'NEUTRAL', $5)`, [`rogue-${Date.now()}`, A.U.id, startOf(30), new Date(startOf(30).getTime() + HOUR), secondId]);
    const plansBefore = await totalPlans();
    const rb1 = await accept(A, token(A, [MOVE(firstPlan, 5), MOVE(secondPlan, 6)]));
    const capAfter = (await sql(`SELECT "plannedActivityId" FROM "Capture" WHERE id = $1`, [capRb.id]))[0];
    check('85/86. ROLLBACK: a failure AFTER the first successor was inserted inside the transaction leaves NOTHING: SAVE_FAILED (no internals leaked), no new plan, no source MOVED, the Capture still points at its original', rb1.status === 'SAVE_FAILED' && JSON.stringify(rb1).indexOf('unique') === -1 && (await totalPlans()) === plansBefore && (await row(firstId)).status === 'UPCOMING' && (await row(secondId)).status === 'UPCOMING' && (await successors(firstId)).length === 0 && capAfter.plannedActivityId === firstId);

    // ================= real F2 -> F3 end to end, and F2 stays read-only =================
    await reset();
    const flex = await mk(A, 1, 'FLEXIBLE', 60, 'Zork quiet reading');
    await mk(A, 1, 'FIXED', 60, 'Board meeting overlapping');
    const snapshot = async () => JSON.stringify(await sql(`SELECT * FROM "PlannedActivity" WHERE "userId" = $1 ORDER BY id`, [A.U.id]));
    const s0 = await snapshot();
    const f2 = await (await recomposeRoute(fakeReq(A.tok, {}))).json();
    check('74/83. the F2 route stays READ-ONLY even though it now signs: the schedule is byte-identical before and after, and only a CHANGES_PROPOSED proposal carries a proposalToken', (await snapshot()) === s0 && f2.status === 'READY' && (f2.proposal.summary.state === 'CHANGES_PROPOSED') === (typeof f2.proposalToken === 'string'));
    check('precondition: the real F2 proposal MOVEs the flexible plan out of its invalid (overlapped) slot', f2.proposal.summary.state === 'CHANGES_PROPOSED' && f2.proposal.decisions.some((d: any) => d.decision === 'MOVE' && d.planId === flex.id));
    const e2e = await viaRoute(A, { proposalToken: f2.proposalToken });
    const e2eSucc = (await successors(flex.id))[0];
    const again = await viaRoute(A, { proposalToken: f2.proposalToken });
    check('E2E. real F2 proposal -> real accept route: the flexible plan is moved exactly as proposed (successor at the proposed slot, source MOVED); accepting again is ALREADY_ACCEPTED with no further writes', e2e.status === 200 && e2e.json.status === 'ACCEPTED' && !!e2eSucc && new Date(e2eSucc.plannedStartAt).toISOString() === new Date(f2.proposal.decisions.find((d: any) => d.planId === flex.id).to.start).toISOString() && (await row(flex.id)).status === 'MOVED' && again.json.status === 'ALREADY_ACCEPTED' && (await successors(flex.id)).length === 1);
    await reset();
    await mk(A, 1, 'FIXED');
    const quiet = await (await recomposeRoute(fakeReq(A.tok, {}))).json();
    check('13. NO_CHANGES carries NO token (nothing to accept), and a NO_CHANGES-only day cannot be accepted', quiet.status === 'READY' && quiet.proposal.summary.state === 'NO_CHANGES' && quiet.proposalToken === undefined);
  } finally {
    for (const u of [A, B]) {
      await sql(`UPDATE "Capture" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [u.U.id]).catch(() => {});
      await sql(`UPDATE "GoalActivity" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [u.U.id]).catch(() => {});
      await sql(`DELETE FROM "AuraMoment" WHERE "ownerUserId" = $1`, [u.U.id]).catch(() => {});
      await sql(`UPDATE "PlannedActivity" SET "rescheduledFromPlanId" = NULL WHERE "userId" = $1`, [u.U.id]).catch(() => {});
      await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [u.U.id]).catch(() => {});
      await sql(`DELETE FROM "Capture" WHERE "userId" = $1`, [u.U.id]).catch(() => {});
      await sql(`DELETE FROM "HabitLog" WHERE "userId" = $1`, [u.U.id]).catch(() => {});
    }
    for (const g of goalIds) await deleteGoal(A.U.id, g).catch(() => {});
  }
  if (!allPassed) { console.error('SOME RECOMPOSITION ACCEPTANCE DB CHECKS FAILED'); process.exit(1); }
  console.log('ALL RECOMPOSITION ACCEPTANCE DB CHECKS PASSED');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
