/**
 * Daily Experience V1 PR D2 -- live-DB proof of the Move lifecycle:
 * A (UPCOMING) -> A (MOVED) + B (UPCOMING, rescheduledFromPlanId = A).
 * Requires DATABASE_URL (a fresh database with all 38 migrations):
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/movePlannedActivityDb.test.ts
 */
import {
  upsertUserByEmail, updateBirthProfile, createPlannedActivity, createCapture, getCaptureWithLinkedPlanStatus, createGoalWithActivities, addGoalActivity,
  deleteGoal, listGoalActivitiesWithLinkedPlanStatus, beginTransaction, logPlannedActivity, cancelPlannedActivity, skipPlannedActivity, listPlannedActivitiesForDay,
  type PlannedActivity,
} from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { movePlannedActivity, MovePlanError, type MovePlanErrorCode } from '../apps/web/lib/planMove';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import type { AcceptConstructedDayRequest, AcceptedProposedItem } from '../apps/web/lib/dayConstructorAcceptance';
import { deriveCaptureState } from '../apps/web/lib/captures';
import { deriveGoalActivityState } from '../apps/web/lib/goals';
import { buildDailyAgenda } from '../apps/web/lib/dailyAgenda';
import { DELETE as deleteRoute } from '../apps/web/app/api/plans/[planId]/route';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const TZ = 'Asia/Kolkata';
const MIN = 60000; const HOUR = 3600000; const DAY = 86400000;
const minute = (ms: number) => Math.floor(ms / MIN) * MIN;
const fakeReq = (cookie?: string): any => ({ cookies: { get: (n: string) => (cookie !== undefined && n === 'as_session' ? { value: cookie } : undefined) }, json: async () => ({}) });
async function sql(t: string, p: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(t, p); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}
const item = (day: string, id: string, title: string, h: number): AcceptedProposedItem => ({ intentId: id, title, start: new Date(`${day}T${String(h).padStart(2, '0')}:00:00Z`), end: new Date(`${day}T${String(h).padStart(2, '0')}:30:00Z`), placementSource: 'SELECTED_CANDIDATE' });
let reqN = 0;
const request = (day: string, items: AcceptedProposedItem[]): AcceptConstructedDayRequest => ({ clientRequestId: `move-${Date.now()}-${reqN++}`, constructionWindow: { date: day, start: new Date(`${day}T09:00:00Z`), end: new Date(`${day}T17:00:00Z`), timezone: TZ, source: 'EXPLICIT_RANGE' }, proposedItems: items });

async function main() {
  const A = await upsertUserByEmail({ email: 'test-move-a@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const B = await upsertUserByEmail({ email: 'test-move-b@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  for (const u of [A, B]) await updateBirthProfile(u.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  const planIds: string[] = []; const goalIds: string[] = [];
  let slot = 0; let dest = 0;
  const src = () => minute(Date.now()) + 10 * DAY + (slot++) * 3 * HOUR; // where plans are created
  const dst = () => minute(Date.now()) + 40 * DAY + (dest++) * 3 * HOUR; // where they are moved to
  const mk = async (title: string, startMs: number, durMin = 60, extra: Partial<Record<string, unknown>> = {}) => {
    const p = await createPlannedActivity({ userId: A.id, title: `${title} ${Date.now()}-${slot}`, plannedStartAt: new Date(startMs), plannedEndAt: new Date(startMs + durMin * MIN), durationMinutes: durMin, windowType: 'NEUTRAL', ...(extra as object) } as any);
    planIds.push(p.id);
    return p;
  };
  const row = async (id: string) => (await sql(`SELECT * FROM "PlannedActivity" WHERE id = $1`, [id]))[0];
  const successors = async (id: string) => sql(`SELECT * FROM "PlannedActivity" WHERE "rescheduledFromPlanId" = $1`, [id]);
  const habitCount = async () => Number((await sql(`SELECT count(*)::int AS n FROM "HabitLog" WHERE "userId" = $1`, [A.id]))[0].n);
  const move = async (planId: string, startMs: number | Date, user = A.id) => movePlannedActivity(user, planId, { newStartAt: startMs instanceof Date ? startMs : new Date(startMs) });
  const codeOf = async (fn: () => Promise<unknown>): Promise<MovePlanErrorCode | 'OK' | 'OTHER'> => { try { await fn(); return 'OK'; } catch (e) { return e instanceof MovePlanError ? e.code : 'OTHER'; } };
  const track = <T extends { to: PlannedActivity }>(r: T): T => { planIds.push(r.to.id); return r; };
  const save = async (r: AcceptConstructedDayRequest, day: string, cap = new Map<string, string>(), goal = new Map<string, string>()) => {
    const d = await persistAcceptedConstructedDay(A.id, r, new Date(`${day}T08:00:00Z`), goal, cap);
    if (d.status === 'SAVED') for (const p of d.plans) planIds.push(p.id);
    return d as any;
  };

  try {
    // ---- 46/10/11/9/50: future move, field copy, timing truth, duration ----
    const s1 = src();
    const a1 = await mk('Call John', s1, 45, { activityType: 'call', icon: '📞', activityId: 'phone-call', windowLabel: 'Abhijit Muhurtham', matchLabel: 'Best Match', score: 9, recommendation: 'Excellent for calls in this window', calendarUrl: 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=old&dates=OLD/OLD', eventTimezone: 'America/Los_Angeles', eventLocationName: 'San Francisco' });
    await sql(`UPDATE "PlannedActivity" SET "windowType" = 'ABHIJIT' WHERE id = $1`, [a1.id]);
    const d1 = dst();
    const h0 = await habitCount();
    const r1 = track(await move(a1.id, d1));
    const A1 = await row(a1.id); const B1 = await row(r1.to.id);
    check('46/6. future UPCOMING A moves: returns { from, to }; A is MOVED and B is UPCOMING', r1.from.status === 'MOVED' && r1.to.status === 'UPCOMING' && A1.status === 'MOVED' && B1.status === 'UPCOMING');
    check('2/9. lineage: B.rescheduledFromPlanId = A.id, B is a NEW row, A has no pointer of its own', B1.rescheduledFromPlanId === a1.id && B1.id !== a1.id && A1.rescheduledFromPlanId === null);
    check('8/50. duration is preserved exactly: B.durationMinutes = 45 and end = start + 45 min', B1.durationMinutes === 45 && new Date(B1.plannedStartAt).getTime() === d1 && new Date(B1.plannedEndAt).getTime() === d1 + 45 * MIN);
    check('9. B copies title, activityType, icon, activityId, eventTimezone, eventLocationName', B1.title === A1.title && B1.activityType === 'call' && B1.icon === '📞' && B1.activityId === 'phone-call' && B1.eventTimezone === 'America/Los_Angeles' && B1.eventLocationName === 'San Francisco');
    check("10/51. A's time-specific evaluation is NOT inherited: windowType NEUTRAL, windowLabel/matchLabel/score/recommendation cleared", B1.windowType === 'NEUTRAL' && B1.windowLabel === null && B1.matchLabel === null && B1.score === null && B1.recommendation === null && A1.windowType === 'ABHIJIT' && A1.recommendation !== null);
    const compact = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    check("10/51. calendarUrl is recomputed for B's new time (contains B's compact start/end, not A's)", B1.calendarUrl.includes(compact(new Date(d1).toISOString())) && B1.calendarUrl.includes(compact(new Date(d1 + 45 * MIN).toISOString())) && !B1.calendarUrl.includes('OLD'));
    check('10. execution fields are clear on B and A keeps none: loggedAt/skippedAt/habitLogId null', B1.loggedAt === null && B1.skippedAt === null && B1.habitLogId === null && A1.loggedAt === null && A1.skippedAt === null);
    check('42/41. Move creates zero HabitLogs', (await habitCount()) === h0);
    check('21. exactly one successor exists for A', (await successors(a1.id)).length === 1);

    // ---- 47 active, 45 missed ----
    const active = await mk('Active plan', Date.now() - 10 * MIN, 60);
    const ra = track(await move(active.id, dst()));
    check('47. an ACTIVE UPCOMING plan moves (domain supports it; no Home UX yet)', (await row(active.id)).status === 'MOVED' && ra.to.status === 'UPCOMING');
    const missed = await mk('Missed plan', Date.now() - 3 * HOUR, 60);
    const agendaBefore = buildDailyAgenda({ now: new Date(), localDate: '2026-01-01', timezone: TZ, plans: [missed], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
    const rm = track(await move(missed.id, dst()));
    const agendaAfter = buildDailyAgenda({ now: new Date(), localDate: '2026-01-01', timezone: TZ, plans: [{ ...missed, status: 'MOVED' }, rm.to], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
    check('45. Missed -> Move uses the SAME operation: agenda MISSED before; A MOVED + B UPCOMING after; agenda shows MOVED (never MISSED) and the B item normally', agendaBefore.items[0].status === 'MISSED' && (await row(missed.id)).status === 'MOVED' && rm.to.status === 'UPCOMING' && agendaAfter.items.find((i) => i.id === `plan:${missed.id}`)!.status === 'MOVED' && agendaAfter.items.find((i) => i.id === `plan:${rm.to.id}`)!.status === 'UPCOMING');

    // ---- 47/48 terminal rejection ----
    const lg = await mk('Logged plan', src()); await logPlannedActivity(A.id, lg.id);
    const sk = await mk('Skipped plan', src()); await skipPlannedActivity(A.id, sk.id);
    const cn = await mk('Cancelled plan', src()); await cancelPlannedActivity(A.id, cn.id);
    for (const [label, p] of [['LOGGED', lg], ['SKIPPED', sk], ['CANCELLED', cn]] as const) {
      const before = await row(p.id);
      const code = await codeOf(() => move(p.id, dst()));
      const after = await row(p.id);
      check(`7/48. ${label} -> Move is rejected (INVALID_STATE), nothing changes and no successor exists`, code === 'INVALID_STATE' && after.status === before.status && (await successors(p.id)).length === 0);
    }
    check('48. LOGGED rejection leaves loggedAt, habitLogId and the HabitLog intact', (await row(lg.id)).habitLogId !== null && (await habitCount()) === h0 + 1);

    // ---- 21/28/48 MOVED idempotency ----
    const same = await move(a1.id, d1);
    check('21/28. retry of an already-successful Move (MOVED A, same destination) returns the SAME A and B, no new plan', same.to.id === r1.to.id && same.from.status === 'MOVED' && (await successors(a1.id)).length === 1);
    check('21/48. MOVED with a DIFFERENT destination is rejected (ALREADY_MOVED) and creates no C', (await codeOf(() => move(a1.id, dst()))) === 'ALREADY_MOVED' && (await successors(a1.id)).length === 1);

    // ---- 49 destination validation ----
    const s2 = src(); const a2 = await mk('Destination rules', s2, 30);
    const now = Date.now();
    const cases: Array<[string, Date]> = [['invalid instant', new Date('nope')], ['past', new Date(minute(now) - 5 * MIN)], ['now boundary (whole minute at/before now)', new Date(minute(now))], ['non-whole-minute', new Date(minute(now) + 90 * MIN + 1000)], ['same start as A', new Date(s2)]];
    for (const [label, d] of cases) {
      const code = await codeOf(() => move(a2.id, d));
      check(`49. destination "${label}" -> INVALID_DESTINATION, A untouched, no successor`, code === 'INVALID_DESTINATION' && (await row(a2.id)).status === 'UPCOMING' && (await successors(a2.id)).length === 0);
    }
    const okNear = track(await move(a2.id, minute(Date.now()) + 2 * MIN + HOUR * 0 + 5 * DAY));
    check('49. a valid future destination succeeds', okNear.to.status === 'UPCOMING');

    // ---- 17/53/54/55 conflicts ----
    const cs = src(); const aC = await mk('Conflict subject', cs, 60);
    const blockStart = dst();
    const blocker = await mk('Blocker', blockStart, 60);
    const srcBefore = await row(aC.id);
    check('17/53. destination overlapping another UPCOMING plan -> CONFLICT, A unchanged, no B', (await codeOf(() => move(aC.id, blockStart + 30 * MIN))) === 'CONFLICT' && (await row(aC.id)).status === 'UPCOMING' && (await successors(aC.id)).length === 0 && (await row(aC.id)).updatedAt.getTime() === srcBefore.updatedAt.getTime());
    const touching = await codeOf(async () => track(await move(aC.id, blockStart + 60 * MIN)));
    check('17. intervals are [start, end): a destination that merely TOUCHES a blocker (starts exactly at its end) is allowed', touching === 'OK');
    const sSelf = src(); const aSelf = await mk('Self overlap', sSelf, 60);
    const rSelf = await codeOf(async () => track(await move(aSelf.id, sSelf + 30 * MIN)));
    check('54. moving A to an interval that overlaps its OWN old interval does not self-conflict', rSelf === 'OK');
    const tLogged = await mk('Terminal LOGGED', dst(), 60); await logPlannedActivity(A.id, tLogged.id);
    const tSkipped = await mk('Terminal SKIPPED', dst(), 60); await skipPlannedActivity(A.id, tSkipped.id);
    const tCancelled = await mk('Terminal CANCELLED', dst(), 60); await cancelPlannedActivity(A.id, tCancelled.id);
    const mover = async (over: PlannedActivity) => { const p = await mk('Into terminal', src(), 30); return codeOf(async () => track(await move(p.id, new Date(over.plannedStartAt).getTime()))); };
    check('55. destination overlapping a LOGGED plan -> CONFLICT (LOGGED blocks, existing rule)', (await mover(tLogged)) === 'CONFLICT');
    check('55. destination overlapping SKIPPED / CANCELLED plans is allowed (they do not block, existing rule)', (await mover(tSkipped)) === 'OK' && (await mover(tCancelled)) === 'OK');
    const movedOrig = await mk('Overlap a MOVED original', dst(), 60); const movedRes = await move(movedOrig.id, dst()); planIds.push(movedRes.to.id);
    const p55 = await mk('Into a MOVED original slot', src(), 30);
    check('55. destination overlapping the ORIGINAL interval of a MOVED plan is allowed (the successor blocks, not the original)', (await codeOf(async () => track(await move(p55.id, new Date(movedOrig.plannedStartAt).getTime())))) === 'OK');

    // ---- 13/14/15/43/44 sources ----
    const cap = await createCapture(A.id, 'Call the bank');
    const d7 = await save(request('2026-12-11', [item('2026-12-11', 'c1', 'Call the bank', 10)]), '2026-12-11', new Map([['c1', cap.id]]));
    const p7 = d7.plans[0].id as string;
    const capBefore = (await getCaptureWithLinkedPlanStatus(A.id, cap.id))!;
    const r7 = track(await move(p7, dst()));
    const capAfter = (await getCaptureWithLinkedPlanStatus(A.id, cap.id))!;
    check('13/31. Capture: PLANNED via A before; after Move it points at B and still derives PLANNED (completedAt null, never OPEN)', deriveCaptureState({ status: capBefore.status, completedAt: capBefore.completedAt, linkedPlanStatus: capBefore.linkedPlanStatus }) === 'PLANNED' && capAfter.plannedActivityId === r7.to.id && capAfter.linkedPlanStatus === 'UPCOMING' && capAfter.completedAt === null && deriveCaptureState({ status: capAfter.status, completedAt: capAfter.completedAt, linkedPlanStatus: capAfter.linkedPlanStatus }) === 'PLANNED');
    const goal = await createGoalWithActivities({ userId: A.id, title: 'Move goal', targetDate: null, activities: [] });
    goalIds.push(goal.goal.id);
    const ga = await addGoalActivity(A.id, goal.goal.id, { title: 'Draft deck', activityId: null });
    const d8 = await save(request('2026-12-12', [item('2026-12-12', 'g1', 'Draft deck', 10)]), '2026-12-12', new Map(), new Map([['g1', ga!.id]]));
    const p8 = d8.plans[0].id as string;
    const r8 = track(await move(p8, dst()));
    const gRow = (await listGoalActivitiesWithLinkedPlanStatus(A.id, goal.goal.id)).find((r) => r.id === ga!.id)!;
    check('14/32. GoalActivity now points at B and derives PLANNED (never SUGGESTED)', gRow.plannedActivityId === r8.to.id && deriveGoalActivityState({ status: gRow.status, plannedActivityId: gRow.plannedActivityId, linkedPlanStatus: gRow.linkedPlanStatus }) === 'PLANNED');
    const noSrc = await mk('Direct plan', src());
    const linkedRows = await sql(`SELECT (SELECT count(*) FROM "Capture" WHERE "plannedActivityId" = $1)::int AS c, (SELECT count(*) FROM "GoalActivity" WHERE "plannedActivityId" = $1)::int AS g`, [noSrc.id]);
    const rNo = track(await move(noSrc.id, dst()));
    const linkedAfter = await sql(`SELECT (SELECT count(*) FROM "Capture" WHERE "plannedActivityId" = $1)::int AS c, (SELECT count(*) FROM "GoalActivity" WHERE "plannedActivityId" = $1)::int AS g`, [rNo.to.id]);
    check('15. source-less plan moves; both repoints affect zero rows and no source is manufactured', Number(linkedRows[0].c) === 0 && Number(linkedRows[0].g) === 0 && rNo.to.status === 'UPCOMING' && Number(linkedAfter[0].c) === 0 && Number(linkedAfter[0].g) === 0);

    // ---- 43/44 chain A -> B -> C, then complete C ----
    const capC = await createCapture(A.id, 'Chain capture');
    const d9 = await save(request('2026-12-13', [item('2026-12-13', 'ch1', 'Chain capture', 10)]), '2026-12-13', new Map([['ch1', capC.id]]));
    const pa = d9.plans[0].id as string;
    const rB = track(await move(pa, dst()));
    const rC = track(await move(rB.to.id, dst()));
    const cRow = (await getCaptureWithLinkedPlanStatus(A.id, capC.id))!;
    check('43. chain A -> B -> C: A MOVED, B MOVED, C UPCOMING with C.rescheduledFromPlanId = B and B.rescheduledFromPlanId = A', (await row(pa)).status === 'MOVED' && (await row(rB.to.id)).status === 'MOVED' && rC.to.status === 'UPCOMING' && rC.to.rescheduledFromPlanId === rB.to.id && rB.to.rescheduledFromPlanId === pa);
    check('43. the Capture points only at C', cRow.plannedActivityId === rC.to.id && (await sql(`SELECT count(*)::int AS n FROM "Capture" WHERE "plannedActivityId" IN ($1, $2)`, [pa, rB.to.id]))[0].n === 0);
    const hBefore = await habitCount();
    const done = await logPlannedActivity(A.id, rC.to.id);
    const cDone = (await getCaptureWithLinkedPlanStatus(A.id, capC.id))!;
    check('44. completing C: A MOVED, B MOVED, C LOGGED; one HabitLog; no historical row mutates; Capture completes via C', (await row(pa)).status === 'MOVED' && (await row(rB.to.id)).status === 'MOVED' && (await row(rC.to.id)).status === 'LOGGED' && (await habitCount()) === hBefore + 1 && done.plan.status === 'LOGGED' && cDone.completedAt !== null && (await row(pa)).loggedAt === null && (await row(rB.to.id)).loggedAt === null);

    // ---- 16/56 linked AuraMoment ----
    const withMoment = await mk('Shared plan', src(), 60);
    await sql(`INSERT INTO "AuraMoment" (id, "ownerUserId", "publicToken", scope, source, "activityId", "activityTitle", "startAt", "endAt", timezone, "plannedActivityId")
               VALUES ($1, $2, $3, 'SHARED', 'PLAN', 'date-night', 'Shared plan', $4, $5, $6, $7)`, [`m-${Date.now()}`, A.id, `tok-${Date.now()}`, new Date(withMoment.plannedStartAt), new Date(withMoment.plannedEndAt), TZ, withMoment.id]);
    const momentBefore = (await sql(`SELECT status, "startAt", "plannedActivityId" FROM "AuraMoment" WHERE "plannedActivityId" = $1`, [withMoment.id]))[0];
    const codeM = await codeOf(() => move(withMoment.id, dst()));
    const momentAfter = (await sql(`SELECT status, "startAt", "plannedActivityId" FROM "AuraMoment" WHERE "plannedActivityId" = $1`, [withMoment.id]))[0];
    check('16/56. an ACTIVE linked AuraMoment blocks Move (HAS_LINKED_MOMENT); A unchanged, no B, Moment unchanged', codeM === 'HAS_LINKED_MOMENT' && (await row(withMoment.id)).status === 'UPCOMING' && (await successors(withMoment.id)).length === 0 && JSON.stringify(momentBefore) === JSON.stringify(momentAfter));
    await sql(`UPDATE "AuraMoment" SET status = 'REVOKED' WHERE "plannedActivityId" = $1`, [withMoment.id]);
    check('16. once the Moment is REVOKED (no longer active) the plan can be moved', (await codeOf(async () => track(await move(withMoment.id, dst())))) === 'OK');

    // ---- 20/52 rollback when the source repoint fails ----
    const capR = await createCapture(A.id, 'Rollback capture');
    const d10 = await save(request('2026-12-14', [item('2026-12-14', 'rb1', 'Rollback capture', 10)]), '2026-12-14', new Map([['rb1', capR.id]]));
    const pr = d10.plans[0].id as string;
    await sql(`CREATE OR REPLACE FUNCTION move_test_fail() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'forced source repoint failure'; END; $$ LANGUAGE plpgsql`);
    await sql(`CREATE TRIGGER move_test_fail_trg BEFORE UPDATE OF "plannedActivityId" ON "Capture" FOR EACH ROW EXECUTE FUNCTION move_test_fail()`);
    const forced = await codeOf(() => move(pr, dst()));
    await sql(`DROP TRIGGER move_test_fail_trg ON "Capture"`); await sql(`DROP FUNCTION move_test_fail()`);
    const capRb = (await getCaptureWithLinkedPlanStatus(A.id, capR.id))!;
    check('20/52. a forced source-repoint failure rolls EVERYTHING back: A stays UPCOMING, no B, the Capture still points at A, no HabitLog', forced === 'OTHER' && (await row(pr)).status === 'UPCOMING' && (await successors(pr)).length === 0 && capRb.plannedActivityId === pr && capRb.linkedPlanStatus === 'UPCOMING');
    check('20/52. after the failure the same Move can be retried successfully', (await codeOf(async () => track(await move(pr, dst())))) === 'OK');

    // ---- 57 ownership ----
    const mine = await mk('Ownership', src());
    check('57. cross-user Move -> NOT_FOUND, A unchanged, no B', (await codeOf(() => move(mine.id, dst(), B.id))) === 'NOT_FOUND' && (await row(mine.id)).status === 'UPCOMING' && (await successors(mine.id)).length === 0);
    check('57. unknown plan id -> NOT_FOUND', (await codeOf(() => move('no-such-plan', dst()))) === 'NOT_FOUND');

    // ---- 41 DELETE ----
    const tokA = createSessionToken(A.id, A.email);
    const del = await deleteRoute(fakeReq(tokA), { params: { planId: a1.id } });
    check('41. DELETE cannot remove a MOVED plan (rejected 400; row and successor lineage intact)', del.status === 400 && (await row(a1.id)).status === 'MOVED' && (await row(r1.to.id)).rescheduledFromPlanId === a1.id);

    // ---- read-model fallthroughs through the real day query ----
    const nearFrom = new Date(minute(Date.now()) + 39 * DAY); const nearTo = new Date(minute(Date.now()) + 60 * DAY);
    const day = await listPlannedActivitiesForDay(A.id, nearFrom, nearTo);
    const agenda = buildDailyAgenda({ now: new Date(), localDate: '2026-01-01', timezone: TZ, plans: day, moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
    check('29. a real DB day read: MOVED originals derive MOVED and are not counted as planned; successors derive normally', agenda.items.every((i) => i.status !== 'MISSED') && agenda.plannedCount === agenda.items.filter((i) => i.status !== 'MOVED' && i.status !== 'SKIPPED' && i.type !== 'COMPLETED_ACTIVITY').length);
  } finally {
    await sql(`UPDATE "Capture" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [A.id]).catch(() => {});
    await sql(`DELETE FROM "AuraMoment" WHERE "ownerUserId" = $1`, [A.id]).catch(() => {});
    await sql(`UPDATE "PlannedActivity" SET "rescheduledFromPlanId" = NULL WHERE "userId" = $1`, [A.id]).catch(() => {});
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [A.id]).catch(() => {});
    await sql(`DELETE FROM "Capture" WHERE "userId" = $1`, [A.id]).catch(() => {});
    for (const g of goalIds) await deleteGoal(A.id, g).catch(() => {});
    await sql(`DELETE FROM "HabitLog" WHERE "userId" = $1`, [A.id]).catch(() => {});
  }
  if (!allPassed) { console.error('SOME MOVE DB CHECKS FAILED'); process.exit(1); }
  console.log('ALL MOVE DB CHECKS PASSED');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
