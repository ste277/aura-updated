/**
 * Daily Experience V1 PR D3 -- Home-facing integration: the real Home executor
 * pointed at the real POST /api/plans/[planId]/move route. Proves Home request
 * -> existing Move API -> A MOVED / B UPCOMING, that D2's source continuity and
 * HabitLog rules still hold through Home, and the failure paths Home must
 * handle (conflict, linked Moment, lost response, another client winning).
 * Not a copy of D2's API suite. Requires DATABASE_URL.
 */
import {
  upsertUserByEmail, updateBirthProfile, createPlannedActivity, createCapture, getCaptureWithLinkedPlanStatus, createGoalWithActivities, addGoalActivity, deleteGoal,
  listGoalActivitiesWithLinkedPlanStatus, listPlannedActivitiesForDay, beginTransaction,
} from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import type { AcceptConstructedDayRequest, AcceptedProposedItem } from '../apps/web/lib/dayConstructorAcceptance';
import { deriveCaptureState } from '../apps/web/lib/captures';
import { deriveGoalActivityState } from '../apps/web/lib/goals';
import { createPlanExecutor, moveablePlanId, overlayExecutionFacts, type ExecutionOutcome } from '../apps/web/lib/homeCompletion';
import { applyConfirmedSuccessors, hideMovedTimelineItems, resolveMoveDestination, formatMoveTime } from '../apps/web/lib/homeMove';
import { buildDailyAgenda } from '../apps/web/lib/dailyAgenda';
import { buildHomeTimeline } from '../apps/web/lib/homeTimelineComposer';
import { selectRightNowState } from '../apps/web/lib/rightNowSelection';
import { POST as moveRoute } from '../apps/web/app/api/plans/[planId]/move/route';
import { POST as logRoute } from '../apps/web/app/api/plans/[planId]/log/route';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const TZ = 'Asia/Kolkata';
const MIN = 60000; const HOUR = 3600000; const DAY = 86400000;
const minute = (ms: number) => Math.floor(ms / MIN) * MIN;
const fakeReq = (cookie: string | undefined, body: unknown): any => ({ cookies: { get: (n: string) => (cookie !== undefined && n === 'as_session' ? { value: cookie } : undefined) }, json: async () => body, headers: new Headers() });
async function sql(t: string, p: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(t, p); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}
const item = (day: string, id: string, title: string, h: number): AcceptedProposedItem => ({ intentId: id, title, start: new Date(`${day}T${String(h).padStart(2, '0')}:00:00Z`), end: new Date(`${day}T${String(h).padStart(2, '0')}:30:00Z`), placementSource: 'SELECTED_CANDIDATE' });
let reqN = 0;
const request = (day: string, items: AcceptedProposedItem[]): AcceptConstructedDayRequest => ({ clientRequestId: `home-move-${Date.now()}-${reqN++}`, constructionWindow: { date: day, start: new Date(`${day}T09:00:00Z`), end: new Date(`${day}T17:00:00Z`), timezone: TZ, source: 'EXPLICIT_RANGE' }, proposedItems: items });

async function main() {
  const U = await upsertUserByEmail({ email: 'test-home-move@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await updateBirthProfile(U.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  const tok = createSessionToken(U.id, U.email);
  const goalIds: string[] = [];
  let n = 0; let day = 0;
  const routeCalls: string[] = [];
  /** The Home executor's fetch, wired to the real route handlers. */
  const homeFetch = (opts: { dropResponseOnce?: boolean; cookie?: string | undefined } = { cookie: tok }) => {
    let dropped = false;
    return (async (url: any, init: any) => {
      const m = String(url).match(/^\/api\/plans\/([^/]+)\/(move|log)$/)!;
      routeCalls.push(`${init?.method} ${m[2]}`);
      const handler = m[2] === 'move' ? moveRoute : logRoute;
      const body = init?.body ? JSON.parse(init.body) : {};
      const res = await handler(fakeReq('cookie' in opts ? opts.cookie : tok, body), { params: { planId: decodeURIComponent(m[1]) } });
      const text = await res.text();
      if (opts.dropResponseOnce && !dropped) { dropped = true; throw new TypeError('Failed to fetch'); }
      return new Response(text, { status: res.status });
    }) as unknown as typeof fetch;
  };
  const mk = async (title: string, startMs: number, durMin = 60) => createPlannedActivity({ userId: U.id, title: `${title} ${Date.now()}-${n++}`, plannedStartAt: new Date(startMs), plannedEndAt: new Date(startMs + durMin * MIN), durationMinutes: durMin, windowType: 'NEUTRAL' });
  const dest = () => new Date(minute(Date.now()) + 60 * DAY + n++ * 3 * HOUR);
  const row = async (id: string) => (await sql(`SELECT * FROM "PlannedActivity" WHERE id = $1`, [id]))[0];
  const habits = async () => Number((await sql(`SELECT count(*)::int AS n FROM "HabitLog" WHERE "userId" = $1`, [U.id]))[0].n);
  const nextDay = () => new Date(Date.UTC(2027, 0, 20 + day++)).toISOString().slice(0, 10);
  const accept = async (map: { cap?: [string, string]; goal?: [string, string] }, title: string) => {
    const d = nextDay();
    return (await persistAcceptedConstructedDay(U.id, request(d, [item(d, 'i1', title, 10)]), new Date(`${d}T08:00:00Z`), new Map(map.goal ? [['i1', map.goal[1]]] : []), new Map(map.cap ? [['i1', map.cap[1]]] : []))) as any;
  };
  const homeView = async (plansOverride: any[] | null, f: ReadonlyMap<string, ExecutionOutcome>, successors: ReadonlyMap<string, any>) => {
    const now = new Date();
    const plans = plansOverride ?? (await listPlannedActivitiesForDay(U.id, new Date(now.getTime() - 6 * HOUR), new Date(now.getTime() + 60 * HOUR)));
    const agenda = applyConfirmedSuccessors(buildDailyAgenda({ now, localDate: new Date(now.getTime()).toISOString().slice(0, 10), timezone: 'UTC', plans, moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] }), successors, now);
    const tl = hideMovedTimelineItems(overlayExecutionFacts(buildHomeTimeline({ agenda, guidance: null, timelineWindows: [], currentMinuteOfDay: 600, timezone: 'UTC', localDate: agenda.localDate }), f));
    return { agenda, tl, rn: selectRightNowState(tl, now) };
  };

  try {
    // ---- Home request -> existing Move API -> A MOVED / B UPCOMING; HabitLog untouched ----
    const a1 = await mk('Active call', Date.now() - 10 * MIN);
    const before = await homeView(null, new Map(), new Map());
    check('precondition: the active plan is ACTIVE_PLAN and movable from Home', before.rn.kind === 'ACTIVE_PLAN' && moveablePlanId(before.rn) === a1.id);
    const h0 = await habits();
    routeCalls.length = 0;
    const d1 = dest();
    const r1 = await createPlanExecutor(homeFetch()).move(a1.id, d1.toISOString());
    const A1 = await row(a1.id);
    check('3/10. Home Move -> existing API: A MOVED, a NEW UPCOMING successor B at exactly the requested instant with the original duration; only the move route was called', r1.status === 'MOVED' && A1.status === 'MOVED' && (r1 as any).successor.status === 'UPCOMING' && new Date((r1 as any).successor.plannedStartAt).getTime() === d1.getTime() && (r1 as any).successor.rescheduledFromPlanId === a1.id && routeCalls.join() === 'POST move');
    check('40. Home Move creates zero HabitLogs and never touches the log route', (await habits()) === h0 && !routeCalls.includes('POST log'));
    const successors = new Map([[a1.id, (r1 as any).successor]]);
    const afterConfirm = await homeView(null, new Map([[a1.id, 'MOVED' as ExecutionOutcome]]), successors);
    check('21. with the confirmed fact, A can no longer be Right Now and is hidden from the live Timeline', !(afterConfirm.rn.kind === 'ACTIVE_PLAN' && (afterConfirm.rn as any).item.id === `plan:${a1.id}`) && !afterConfirm.tl.some((i) => i.id === `plan:${a1.id}`));
    const staleView = await homeView([{ ...A1, status: 'UPCOMING', plannedStartAt: new Date(A1.plannedStartAt), plannedEndAt: new Date(A1.plannedEndAt) }], new Map([[a1.id, 'MOVED' as ExecutionOutcome]]), successors);
    check('47. stale authoritative data (A still UPCOMING/active) + the confirmed Move: A resolved, no A Right Now, A hidden', !(staleView.rn.kind !== 'CONTEXT_OPEN' && (staleView.rn as any).item.id === `plan:${a1.id}`) && !staleView.tl.some((i) => i.id === `plan:${a1.id}`));

    // ---- source continuity still holds through Home (D2 owns it; Home knows nothing) ----
    const cap = await createCapture(U.id, 'Call the bank');
    const capPlan = (await accept({ cap: ['c', cap.id] }, 'Call the bank')).plans[0].id as string;
    const rc = await createPlanExecutor(homeFetch()).move(capPlan, dest().toISOString());
    const capRow = (await getCaptureWithLinkedPlanStatus(U.id, cap.id))!;
    check('39/46. Capture-linked plan moved from Home: A MOVED, B UPCOMING, Capture -> B and still PLANNED (completedAt null)', rc.status === 'MOVED' && (await row(capPlan)).status === 'MOVED' && capRow.plannedActivityId === (rc as any).successor.id && deriveCaptureState({ status: capRow.status, completedAt: capRow.completedAt, linkedPlanStatus: capRow.linkedPlanStatus }) === 'PLANNED' && capRow.completedAt === null);
    const goal = await createGoalWithActivities({ userId: U.id, title: 'Home move goal', targetDate: null, activities: [] });
    goalIds.push(goal.goal.id);
    const ga = await addGoalActivity(U.id, goal.goal.id, { title: 'Draft deck', activityId: null });
    const gPlan = (await accept({ goal: ['g', ga!.id] }, 'Draft deck')).plans[0].id as string;
    const rg = await createPlanExecutor(homeFetch()).move(gPlan, dest().toISOString());
    const gRow = (await listGoalActivitiesWithLinkedPlanStatus(U.id, goal.goal.id)).find((r) => r.id === ga!.id)!;
    check('39/46. GoalActivity-linked plan moved from Home: GoalActivity -> B and still PLANNED', rg.status === 'MOVED' && gRow.plannedActivityId === (rg as any).successor.id && deriveGoalActivityState({ status: gRow.status, plannedActivityId: gRow.plannedActivityId, linkedPlanStatus: gRow.linkedPlanStatus }) === 'PLANNED');
    check('40. neither source move created a HabitLog', (await habits()) === h0);

    // ---- CONFLICT: A stays actionable, no B ----
    const blockStart = dest().getTime();
    await mk('Blocker', blockStart, 60);
    const aC = await mk('Conflict subject', minute(Date.now()) + 30 * DAY);
    const conflict = await createPlanExecutor(homeFetch()).move(aC.id, new Date(blockStart + 30 * MIN).toISOString());
    check('13/49. destination overlapping another plan -> CONFLICT: A still UPCOMING, no successor, nothing confirmed', conflict.status === 'CONFLICT' && (await row(aC.id)).status === 'UPCOMING' && (await sql(`SELECT count(*)::int AS n FROM "PlannedActivity" WHERE "rescheduledFromPlanId" = $1`, [aC.id]))[0].n === 0);
    const touching = await createPlanExecutor(homeFetch()).move(aC.id, new Date(blockStart + 60 * MIN).toISOString());
    check('38. a destination that starts exactly when another plan ends is accepted by the server ([start, end) semantics) and Home does not pre-reject it', touching.status === 'MOVED');

    // ---- linked Moment ----
    const shared = await mk('Shared plan', minute(Date.now()) + 31 * DAY);
    await sql(`INSERT INTO "AuraMoment" (id, "ownerUserId", "publicToken", scope, source, "activityId", "activityTitle", "startAt", "endAt", timezone, "plannedActivityId") VALUES ($1, $2, $3, 'SHARED', 'PLAN', 'date-night', 'x', $4, $5, $6, $7)`, [`hm-${Date.now()}`, U.id, `hm-t-${Date.now()}`, new Date(shared.plannedStartAt), new Date(shared.plannedEndAt), TZ, shared.id]);
    const momentRes = await createPlanExecutor(homeFetch()).move(shared.id, dest().toISOString());
    check('14. active linked AuraMoment -> HAS_LINKED_MOMENT: A unchanged, no fallback mechanism, Moment untouched', momentRes.status === 'HAS_LINKED_MOMENT' && (await row(shared.id)).status === 'UPCOMING' && (await sql(`SELECT status FROM "AuraMoment" WHERE "plannedActivityId" = $1`, [shared.id]))[0].status === 'ACTIVE');

    // ---- 27. unauthenticated ----
    const noAuth = await mk('Auth subject', minute(Date.now()) + 32 * DAY);
    const unauth = await createPlanExecutor(homeFetch({ cookie: undefined })).move(noAuth.id, dest().toISOString());
    check('27. the Move POST itself returns 401: FAILED, no confirmed fact, A unchanged and still actionable', unauth.status === 'FAILED' && (await row(noAuth.id)).status === 'UPCOMING');

    // ---- lost response then retry (idempotent) ----
    const lost = await mk('Lost response', minute(Date.now()) + 33 * DAY);
    const dLost = dest();
    const lossy = createPlanExecutor(homeFetch({ dropResponseOnce: true, cookie: tok }));
    const first = await lossy.move(lost.id, dLost.toISOString());
    const committed = await row(lost.id);
    check('server COMMITTED the Move but the client never saw it: FAILED locally (nothing confirmed, A still looks actionable)', first.status === 'FAILED' && committed.status === 'MOVED');
    const retry = await lossy.move(lost.id, dLost.toISOString());
    const succ = await sql(`SELECT id FROM "PlannedActivity" WHERE "rescheduledFromPlanId" = $1`, [lost.id]);
    check('the retry of the same request returns the SAME successor (idempotent), one successor exists, and Home can now confirm it', retry.status === 'MOVED' && succ.length === 1 && succ[0].id === (retry as any).successor.id);

    // ---- 50. ALREADY_MOVED (another client won) ----
    const won = await mk('Moved elsewhere', minute(Date.now()) + 34 * DAY);
    await createPlanExecutor(homeFetch()).move(won.id, dest().toISOString());
    const other = await createPlanExecutor(homeFetch()).move(won.id, dest().toISOString());
    check('50. another client already moved A: this Move returns ALREADY_MOVED, Home fabricates no successor (it reconciles), and there is still exactly one successor', other.status === 'ALREADY_MOVED' && (await sql(`SELECT count(*)::int AS n FROM "PlannedActivity" WHERE "rescheduledFromPlanId" = $1`, [won.id]))[0].n === 1);

    // ---- Move/Done from one Home session: only the first begins; the server also arbitrates across clients ----
    const race = await mk('Burst subject', minute(Date.now()) + 35 * DAY);
    const exB = createPlanExecutor(homeFetch());
    routeCalls.length = 0;
    const [m, d] = await Promise.all([exB.move(race.id, dest().toISOString()), exB.complete(race.id)]);
    check('17. Move then Done from one Home session: one request (the Move) is issued for that plan; Done is BUSY; A MOVED, zero HabitLogs from it', m.status === 'MOVED' && d === 'BUSY' && routeCalls.join() === 'POST move' && (await row(race.id)).status === 'MOVED' && (await row(race.id)).habitLogId === null);
    const race2 = await mk('Burst subject 2', minute(Date.now()) + 36 * DAY);
    const clientA = createPlanExecutor(homeFetch()); const clientB = createPlanExecutor(homeFetch());
    const [mv, dn] = await Promise.all([clientA.move(race2.id, dest().toISOString()), clientB.complete(race2.id)]);
    const fin = await row(race2.id);
    check('two Home sessions racing Move vs Done: exactly one terminal outcome wins on the server (never a hybrid)', (fin.status === 'MOVED' && mv.status === 'MOVED' && dn === 'FAILED' && fin.habitLogId === null) || (fin.status === 'LOGGED' && dn === 'DONE' && mv.status === 'INVALID_STATE' && !!fin.habitLogId));

    // ---- DST transition day: the wall time the user picks is the time Aura commits (real executor -> real route -> real DB) ----
    const LA = 'America/Los_Angeles';
    const offsetOf = (ms: number) => { const m = new Intl.DateTimeFormat('en-US', { timeZone: LA, timeZoneName: 'shortOffset' }).formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')!.value.match(/GMT([+-])(\d+)/)!; return (m[1] === '-' ? -1 : 1) * Number(m[2]); };
    /** First local date (after ~30 days out) on which LA's offset changes in the requested direction; found by scanning noon-UTC offsets, independent of the code under test. */
    const nextTransition = (kind: 'SPRING' | 'FALL') => { const start = Math.floor((Date.now() + 30 * DAY) / DAY) * DAY; for (let i = 1; i < 500; i++) { const day = start + i * DAY; const prev = offsetOf(day - DAY + 12 * HOUR); const cur = offsetOf(day + 12 * HOUR); if ((kind === 'SPRING' && cur > prev) || (kind === 'FALL' && cur < prev)) return new Date(day).toISOString().slice(0, 10); } throw new Error('no transition found'); };
    const wallOf = (ms: number) => { const p: Record<string, string> = {}; for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: LA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms))) p[x.type] = x.value; return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }; };
    const dayBefore = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
    for (const kind of ['SPRING', 'FALL'] as const) {
      const T = nextTransition(kind);
      const syntheticNow = new Date(`${dayBefore(T)}T20:00:00Z`);
      const aDst = await mk(`DST ${kind} subject`, Date.now() - 10 * MIN);
      const chosen = resolveMoveDestination({ day: 'TOMORROW', time: '09:00' }, aDst.plannedStartAt.toISOString(), syntheticNow, LA);
      check(`18. ${kind} ${T}: picker "Tomorrow 09:00" (Los Angeles) resolves to an instant whose confirm label is "Move to 9:00 AM"`, chosen.ok && formatMoveTime(chosen.newStartAt, LA) === '9:00 AM' && wallOf(Date.parse(chosen.newStartAt)).date === T && wallOf(Date.parse(chosen.newStartAt)).time === '09:00');
      if (!chosen.ok) continue;
      const before = routeCalls.length;
      const moved = await createPlanExecutor(homeFetch()).move(aDst.id, chosen.newStartAt);
      const bRow = moved.status === 'MOVED' ? await row((moved as any).successor.id) : null;
      const bStart = bRow ? new Date(bRow.plannedStartAt).getTime() : 0;
      const bEnd = bRow ? new Date(bRow.plannedEndAt).getTime() : 0;
      check(`27. ${kind} ${T}: the server-created B starts at exactly the requested instant (${chosen.newStartAt}) and rendering B in Los Angeles gives exactly ${T} 09:00 (end 10:00 = the original 60-minute duration)`, moved.status === 'MOVED' && routeCalls.length === before + 1 && bStart === Date.parse(chosen.newStartAt) && wallOf(bStart).date === T && wallOf(bStart).time === '09:00' && wallOf(bEnd).time === '10:00' && (await row(aDst.id)).status === 'MOVED');
      check(`22. ${kind} ${T}: selected wall time, confirm label, request payload, stored B and rendered B all agree (09:00 / "9:00 AM" / ${chosen.newStartAt})`, moved.status === 'MOVED' && formatMoveTime(new Date(bStart).toISOString(), LA) === '9:00 AM');
    }
    const springDay = nextTransition('SPRING');
    const aGap = await mk('DST gap subject', Date.now() - 5 * MIN);
    const callsBeforeGap = routeCalls.length;
    const gapPick = resolveMoveDestination({ day: 'TOMORROW', time: '02:30' }, aGap.plannedStartAt.toISOString(), new Date(`${dayBefore(springDay)}T20:00:00Z`), LA);
    check('7/15. a wall time that does not exist on the spring-forward day (02:30) is refused before any request: no Move POST, A untouched, no successor', !gapPick.ok && (gapPick as any).reason === 'NONEXISTENT' && routeCalls.length === callsBeforeGap && (await row(aGap.id)).status === 'UPCOMING' && (await sql(`SELECT count(*)::int AS n FROM "PlannedActivity" WHERE "rescheduledFromPlanId" = $1`, [aGap.id]))[0].n === 0);
  } finally {
    await sql(`UPDATE "Capture" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [U.id]).catch(() => {});
    await sql(`UPDATE "GoalActivity" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [U.id]).catch(() => {});
    await sql(`DELETE FROM "AuraMoment" WHERE "ownerUserId" = $1`, [U.id]).catch(() => {});
    await sql(`UPDATE "PlannedActivity" SET "rescheduledFromPlanId" = NULL WHERE "userId" = $1`, [U.id]).catch(() => {});
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [U.id]).catch(() => {});
    await sql(`DELETE FROM "Capture" WHERE "userId" = $1`, [U.id]).catch(() => {});
    for (const g of goalIds) await deleteGoal(U.id, g).catch(() => {});
    await sql(`DELETE FROM "HabitLog" WHERE "userId" = $1`, [U.id]).catch(() => {});
  }
  if (!allPassed) { console.error('SOME HOME MOVE DB CHECKS FAILED'); process.exit(1); }
  console.log('ALL HOME MOVE DB CHECKS PASSED');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
