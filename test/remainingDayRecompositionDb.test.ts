/**
 * Remaining-Day Recomposition V1 PR F2 -- the REAL read path against a live DB: real PlannedActivity /
 * scheduling-mode / AuraMoment reads, the real Day Constructor orchestrator with real availability and timing
 * search, and the real route boundary. Proves protection from persisted state, ownership, determinism and --
 * above all -- that generating a proposal writes NOTHING. Requires DATABASE_URL (fresh, 39 migrations).
 */
import {
  upsertUserByEmail, updateBirthProfile, getUserById, createPlannedActivity, createCapture, beginTransaction,
} from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { createRealRecompositionDeps, handleRemainingDayRecompositionRequest } from '../apps/web/lib/remainingDayRecompositionServer';
import { POST as recomposeRoute } from '../apps/web/app/api/day/recompose/route';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const HOUR = 3600000; const MIN = 60000;
async function sql(t: string, p: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(t, p); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}
const localDateOf = (tz: string) => (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
/** A zone whose local clock is early in its day, so today has hours left whenever this runs. */
function earlyDayZone(now: Date): string {
  for (const tz of ['Pacific/Kiritimati', 'Pacific/Auckland', 'Australia/Sydney', 'Asia/Tokyo', 'Asia/Kolkata', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Pacific/Honolulu', 'Etc/GMT+12', 'Pacific/Pago_Pago']) {
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now));
    if (hour >= 1 && hour <= 7) return tz;
  }
  return 'Etc/GMT+12';
}

async function main() {
  const boot = new Date();
  const TZ = earlyDayZone(boot);
  const mk = async (label: string) => {
    const U = await upsertUserByEmail({ email: `test-recompose-${label}@example.com`, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
    await updateBirthProfile(U.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
    return { U, tok: createSessionToken(U.id, U.email) };
  };
  const A = await mk('a');
  const B = await mk('b');
  const both = [A.U.id, B.U.id];
  const localDate = localDateOf(TZ);
  const now = new Date();
  const minute = (ms: number) => Math.ceil(ms / MIN) * MIN;
  const plan = async (userId: string, title: string, startOffsetMin: number, durMin: number, mode: 'FIXED' | 'FLEXIBLE' | null) => createPlannedActivity({ userId, title, plannedStartAt: new Date(minute(now.getTime()) + startOffsetMin * MIN), plannedEndAt: new Date(minute(now.getTime()) + (startOffsetMin + durMin) * MIN), durationMinutes: durMin, windowType: 'NEUTRAL', schedulingMode: mode });

  try {
    const flexA = await plan(A.U.id, 'Focus block one', 150, 60, 'FLEXIBLE');
    const flexB = await plan(A.U.id, 'Focus block two', 300, 45, 'FLEXIBLE');
    const fixed = await plan(A.U.id, 'Board meeting', 100, 30, 'FIXED');
    const unknown = await plan(A.U.id, 'Legacy appointment', 200, 30, null);
    const withMoment = await plan(A.U.id, 'Shared dinner prep', 240, 30, 'FLEXIBLE');
    const active = await plan(A.U.id, 'Already started', -10, 60, 'FLEXIBLE');
    const missed = await plan(A.U.id, 'Long gone', -180, 30, 'FLEXIBLE');
    const logged = await plan(A.U.id, 'Done early', 360, 30, 'FLEXIBLE');
    const cancelled = await plan(A.U.id, 'Cancelled thing', 330, 30, 'FLEXIBLE');
    const strangers = await plan(B.U.id, 'Someone else flexible', 150, 60, 'FLEXIBLE');
    await sql(`UPDATE "PlannedActivity" SET status = 'LOGGED', "loggedAt" = now() WHERE id = $1`, [logged.id]);
    await sql(`UPDATE "PlannedActivity" SET status = 'CANCELLED' WHERE id = $1`, [cancelled.id]);
    await sql(`INSERT INTO "AuraMoment" (id, "ownerUserId", "publicToken", scope, source, "activityId", "activityTitle", "startAt", "endAt", timezone, "plannedActivityId") VALUES ($1, $2, $3, 'SHARED', 'PLAN', 'date-night', 'x', $4, $5, $6, $7)`, [`rc-${Date.now()}`, A.U.id, `rc-t-${Date.now()}`, withMoment.plannedStartAt, withMoment.plannedEndAt, TZ, withMoment.id]);
    const cap = await createCapture(A.U.id, 'A capture that must not change');

    const snapshot = async () => JSON.stringify({
      plans: await sql(`SELECT * FROM "PlannedActivity" WHERE "userId" = ANY($1) ORDER BY id`, [both]),
      captures: await sql(`SELECT * FROM "Capture" WHERE "userId" = ANY($1) ORDER BY id`, [both]),
      goals: await sql(`SELECT * FROM "GoalActivity" WHERE "userId" = ANY($1) ORDER BY id`, [both]),
      habits: await sql(`SELECT * FROM "HabitLog" WHERE "userId" = ANY($1) ORDER BY id`, [both]),
      moments: await sql(`SELECT * FROM "AuraMoment" WHERE "ownerUserId" = ANY($1) ORDER BY id`, [both]),
      claims: await sql(`SELECT * FROM "PlanCreationIdempotency" WHERE "userId" = ANY($1) ORDER BY 1, 2`, [both]),
      totals: await sql(`SELECT (SELECT count(*) FROM "PlannedActivity") AS plans, (SELECT count(*) FROM "AuraMoment") AS moments, (SELECT count(*) FROM "HabitLog") AS habits`),
    });
    const post = async (user: typeof A | null, body: unknown = {}) => {
      const req: any = { cookies: { get: (n: string) => (user && n === 'as_session' ? { value: user.tok } : undefined) }, json: async () => { throw new Error('the request body must never be read'); }, headers: new Headers() };
      void body;
      const res = await recomposeRoute(req);
      return { status: res.status, json: await res.json() };
    };

    const before = await snapshot();
    const r1 = await post(A);
    const r2 = await post(A);
    const after = await snapshot();
    check('56/79. READ-ONLY: PlannedActivity, Capture, GoalActivity, HabitLog, AuraMoment and idempotency state (every field, both users, plus table totals) are byte-identical before and after generating proposals', before === after && r1.status === 200 && r2.status === 200);

    const proposal = r1.json.proposal;
    check('precondition: the real orchestrator produced a READY proposal from the real DB', r1.json.status === 'READY' && !!proposal && Array.isArray(proposal.decisions));
    const decided = new Set(proposal.decisions.map((d: any) => d.planId));
    check('6/7/8/10/11/12. ONLY the two genuinely reconsiderable plans (future, UPCOMING, explicit FLEXIBLE, no moment) are decided -- never FIXED, NULL, ACTIVE, MISSED, LOGGED, CANCELLED, moment-linked or another user\'s plan', decided.size === 2 && decided.has(flexA.id) && decided.has(flexB.id) && [fixed, unknown, withMoment, active, missed, logged, cancelled, strangers].every((p) => !decided.has(p.id)));
    const reasons = new Map(proposal.protectedPlans.map((p: any) => [p.planId, p.reason]));
    check('7/9/10/11/24. protected plans are reported with the right persisted-state reasons (FIXED and NULL -> SCHEDULING_MODE_NOT_FLEXIBLE, ACTIVE, MISSED, HAS_ACTIVE_MOMENT); history is not listed', reasons.get(fixed.id) === 'SCHEDULING_MODE_NOT_FLEXIBLE' && reasons.get(unknown.id) === 'SCHEDULING_MODE_NOT_FLEXIBLE' && reasons.get(active.id) === 'ACTIVE' && reasons.get(missed.id) === 'MISSED' && reasons.get(withMoment.id) === 'HAS_ACTIVE_MOMENT' && !reasons.has(logged.id) && !reasons.has(cancelled.id));
    const slotOverlap = (a: any, b: { start: string; end: string }) => new Date(a.start).getTime() < new Date(b.end).getTime() && new Date(b.start).getTime() < new Date(a.end).getTime();
    const protectedSlots = [fixed, unknown, withMoment, active, logged].map((p) => ({ start: new Date(p.plannedStartAt).toISOString(), end: new Date(p.plannedEndAt).toISOString() }));
    check('13/37. no MOVE lands on a protected commitment (FIXED, NULL, moment-linked, ACTIVE, LOGGED) or on the other decided plan, and every MOVE is in the future', proposal.decisions.every((d: any) => d.decision !== 'MOVE' || (protectedSlots.every((s) => !slotOverlap(d.to, s)) && new Date(d.to.start).getTime() > now.getTime() && proposal.decisions.filter((o: any) => o.planId !== d.planId).every((o: any) => !slotOverlap(d.to, o.decision === 'MOVE' ? o.to : o.current)))));
    check('22/23/26/29/30/34. every decision is KEEP / MOVE / UNRESOLVED with its structured reason; MOVE is a strict tier improvement or CURRENT_SLOT_INVALID; nothing is silently dropped', proposal.decisions.every((d: any) => ['KEEP', 'MOVE', 'UNRESOLVED'].includes(d.decision) && (d.decision !== 'MOVE' || d.reason === 'CURRENT_SLOT_INVALID' || d.reason === 'BETTER_TIMING_TIER')) && proposal.summary.state === (proposal.summary.moveCount > 0 ? 'CHANGES_PROPOSED' : proposal.summary.unresolvedCount > 0 ? 'NEEDS_ATTENTION' : 'NO_CHANGES') && proposal.summary.moveCount + proposal.summary.keepCount + proposal.summary.unresolvedCount === 2 && proposal.summary.placementRuns <= 2);
    check('41/78. deterministic: two runs over the same DB state produce the identical proposal', JSON.stringify(r1.json.proposal.decisions) === JSON.stringify(r2.json.proposal.decisions) && r1.json.proposal.summary.state === r2.json.proposal.summary.state);
    check('61. today only: every decided slot is within the user\'s local today; the proposal names the local target date', proposal.targetDate === localDate(now) && proposal.decisions.every((d: any) => localDate(new Date(d.current.start)) === proposal.targetDate && (d.decision !== 'MOVE' || (localDate(new Date(d.to.start)) === proposal.targetDate && localDate(new Date(d.to.end)) === proposal.targetDate))));

    // ---- ownership / authority ----
    const other = await post(B);
    const otherIds = new Set((other.json.proposal?.decisions ?? []).map((d: any) => d.planId));
    check('53/54. ownership: user B\'s proposal contains only B\'s own plans and none of A\'s (nothing crosses users)', other.status === 200 && otherIds.has(strangers.id) && ![flexA, flexB, fixed, unknown].some((p) => otherIds.has(p.id)));
    check('54. unauthenticated -> 401', (await post(null)).status === 401);
    check('53. the request body is never read (the route reads no client-supplied plan list, protection or scheduling mode)', r1.status === 200);

    // ---- the service is callable directly with the same real deps, and is deterministic against them ----
    const user = (await getUserById(A.U.id))!;
    const direct = await handleRemainingDayRecompositionRequest({ getSession: () => ({ userId: A.U.id }), getUser: getUserById, now: () => now, createDeps: createRealRecompositionDeps });
    const direct2 = await handleRemainingDayRecompositionRequest({ getSession: () => ({ userId: A.U.id }), getUser: getUserById, now: () => now, createDeps: createRealRecompositionDeps });
    check('41/51. callable for future triggers with an explicit clock: identical inputs give an identical proposal, and the user timezone comes from the stored user', JSON.stringify(direct.body) === JSON.stringify(direct2.body) && (direct.body as any).proposal.timezone === user.timezone);
    const capRow = (await sql(`SELECT "plannedActivityId" FROM "Capture" WHERE id = $1`, [cap.id]))[0];
    check('57/58. no source repoint and no lineage: the Capture is untouched and no plan has a rescheduledFromPlanId or MOVED status', capRow.plannedActivityId === null && (await sql(`SELECT count(*)::int n FROM "PlannedActivity" WHERE "userId" = ANY($1) AND ("rescheduledFromPlanId" IS NOT NULL OR status = 'MOVED')`, [both]))[0].n === 0);
  } finally {
    for (const id of both) {
      await sql(`UPDATE "Capture" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [id]).catch(() => {});
      await sql(`DELETE FROM "AuraMoment" WHERE "ownerUserId" = $1`, [id]).catch(() => {});
      await sql(`UPDATE "PlannedActivity" SET "rescheduledFromPlanId" = NULL WHERE "userId" = $1`, [id]).catch(() => {});
      await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [id]).catch(() => {});
      await sql(`DELETE FROM "Capture" WHERE "userId" = $1`, [id]).catch(() => {});
    }
  }
  if (!allPassed) { console.error('SOME RECOMPOSITION DB CHECKS FAILED'); process.exit(1); }
  console.log('ALL RECOMPOSITION DB CHECKS PASSED');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
