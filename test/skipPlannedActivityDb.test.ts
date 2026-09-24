/**
 * Daily Experience V1 PR C1 -- live-DB proof of Skip as a durable execution
 * outcome, exercised through the real route handlers
 * (POST /api/plans/[planId]/skip, .../log) and the real DB functions.
 * Requires DATABASE_URL:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/skipPlannedActivityDb.test.ts
 */
import {
  upsertUserByEmail, updateBirthProfile, createCapture, getCaptureWithLinkedPlanStatus, createGoalWithActivities, addGoalActivity, deleteGoal,
  listGoalActivitiesWithLinkedPlanStatus, cancelPlannedActivity, deletePlannedActivity, createPlannedActivity, beginTransaction,
  listPlannedActivities, listPlannedActivitiesForDay, listPlannedActivitiesForReminders, skipPlannedActivity, logPlannedActivity,
  type PlannedActivity,
} from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import type { AcceptConstructedDayRequest, AcceptedProposedItem } from '../apps/web/lib/dayConstructorAcceptance';
import { deriveCaptureState } from '../apps/web/lib/captures';
import { deriveGoalActivityState } from '../apps/web/lib/goals';
import { buildDailyAgenda } from '../apps/web/lib/dailyAgenda';
import { buildHomeTimeline } from '../apps/web/lib/homeTimelineComposer';
import { selectRightNowState } from '../apps/web/lib/rightNowSelection';
import { isActivePlanBlocker } from '../apps/web/lib/dayConstructorOrchestrator';
import { buildDailyStory } from '../apps/web/lib/dailyStory';
import { buildDailyReflection } from '../apps/web/lib/dailyReflection';
import { deriveAuraReminders } from '../apps/web/lib/auraReminders';
import { POST as skipRoute } from '../apps/web/app/api/plans/[planId]/skip/route';
import { POST as logRoute } from '../apps/web/app/api/plans/[planId]/log/route';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const TZ = 'Asia/Kolkata';
const iso = (s: string) => new Date(s);
const fakeReq = (cookie?: string): any => ({ cookies: { get: (n: string) => (cookie !== undefined && n === 'as_session' ? { value: cookie } : undefined) }, json: async () => ({}) });
async function sql(t: string, p: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(t, p); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}
const item = (day: string, id: string, title: string, h: number): AcceptedProposedItem => ({ intentId: id, title, start: iso(`${day}T${String(h).padStart(2, '0')}:00:00Z`), end: iso(`${day}T${String(h).padStart(2, '0')}:30:00Z`), placementSource: 'SELECTED_CANDIDATE' });
let n = 0;
const request = (day: string, items: AcceptedProposedItem[]): AcceptConstructedDayRequest => ({ clientRequestId: `skip-${Date.now()}-${n++}`, constructionWindow: { date: day, start: iso(`${day}T09:00:00Z`), end: iso(`${day}T17:00:00Z`), timezone: TZ, source: 'EXPLICIT_RANGE' }, proposedItems: items });
const inMs = (ms: number) => new Date(Date.now() + ms);
const HOUR = 3600000;

async function main() {
  const A = await upsertUserByEmail({ email: 'test-skip-a@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const B = await upsertUserByEmail({ email: 'test-skip-b@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  for (const u of [A, B]) await updateBirthProfile(u.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  const tokA = createSessionToken(A.id, A.email);
  const tokB = createSessionToken(B.id, B.email);
  const planIds: string[] = []; const goalIds: string[] = [];
  const habitCount = async () => Number((await sql(`SELECT count(*)::int AS n FROM "HabitLog" WHERE "userId" = $1`, [A.id]))[0].n);
  const skip = async (planId: string, token: string | null = tokA) => { const res = await skipRoute(fakeReq(token ?? undefined), { params: { planId } }); return { status: res.status, body: await res.json() }; };
  const log = async (planId: string) => { const res = await logRoute(fakeReq(tokA), { params: { planId } }); return { status: res.status, body: await res.json() }; };
  const row = async (id: string) => (await sql(`SELECT status, "loggedAt", "skippedAt", "habitLogId" FROM "PlannedActivity" WHERE id = $1`, [id]))[0];
  let seq = 0;
  const mkPlan = async (title: string, startMs: number, endMs: number, user = A.id) => {
    const p = await createPlannedActivity({ userId: user, title: `${title} ${Date.now()}-${seq++}`, plannedStartAt: inMs(startMs), plannedEndAt: inMs(endMs), durationMinutes: Math.max(15, Math.round((endMs - startMs) / 60000)), windowType: 'NEUTRAL' });
    planIds.push(p.id);
    return p;
  };
  const save = async (r: AcceptConstructedDayRequest, day: string, cap = new Map<string, string>(), goal = new Map<string, string>()) => {
    const d = await persistAcceptedConstructedDay(A.id, r, iso(`${day}T08:00:00Z`), goal, cap);
    if (d.status === 'SAVED') for (const p of d.plans) planIds.push(p.id);
    return d as any;
  };
  /** The mandatory invariant table (ticket section 8), checked on any persisted row. */
  const invariantOk = (r: { status: string; loggedAt: Date | null; skippedAt: Date | null }) =>
    (r.status === 'UPCOMING' && !r.loggedAt && !r.skippedAt) ||
    (r.status === 'LOGGED' && !!r.loggedAt && !r.skippedAt) ||
    (r.status === 'SKIPPED' && !r.loggedAt && !!r.skippedAt) ||
    (r.status === 'CANCELLED' && !r.skippedAt);

  try {
    // ---- 30. ordinary ----
    const p1 = await mkPlan('Ordinary', 2 * HOUR, 3 * HOUR);
    const h0 = await habitCount();
    const r1 = await skip(p1.id);
    const s1 = await row(p1.id);
    check('30/9/29. Skip returns 200 with { plan } that is unambiguously SKIPPED with skippedAt and no loggedAt/habitLogId', r1.status === 200 && r1.body.plan.status === 'SKIPPED' && !!r1.body.plan.skippedAt && !r1.body.plan.loggedAt && !r1.body.plan.habitLogId && r1.body.habitLog === undefined);
    check('30. persisted: SKIPPED, skippedAt set, loggedAt null, habitLogId null', s1.status === 'SKIPPED' && !!s1.skippedAt && s1.loggedAt === null && s1.habitLogId === null);
    check('10/30. Skip creates ZERO HabitLogs', (await habitCount()) === h0);
    check('28. skippedAt is a server instant near now (not client-supplied) and equals the response value', Math.abs(s1.skippedAt.getTime() - Date.now()) < 60000 && new Date(r1.body.plan.skippedAt).getTime() === s1.skippedAt.getTime());
    check('8. invariants hold for the skipped row', invariantOk(s1));

    // ---- 36. idempotent ----
    await new Promise((r) => setTimeout(r, 25));
    const again = await skip(p1.id);
    const s1b = await row(p1.id);
    check('36/5. retry returns 200, still SKIPPED, with the ORIGINAL skippedAt (not a retry timestamp)', again.status === 200 && again.body.plan.status === 'SKIPPED' && s1b.skippedAt.getTime() === s1.skippedAt.getTime() && new Date(again.body.plan.skippedAt).getTime() === s1.skippedAt.getTime());
    check('36. retry created no HabitLog', (await habitCount()) === h0);

    // ---- 33/26. missed -> skip ----
    const missed = await mkPlan('Missed', -3 * HOUR, -2 * HOUR);
    const missedAgendaBefore = buildDailyAgenda({ now: new Date(), localDate: '2026-01-01', timezone: TZ, plans: [missed], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
    check('33/26. precondition: the elapsed UPCOMING plan derives MISSED', missedAgendaBefore.items[0].status === 'MISSED');
    const rm = await skip(missed.id);
    const sm = await row(missed.id);
    check('33/26. Missed -> POST skip persists SKIPPED + skippedAt', rm.status === 200 && sm.status === 'SKIPPED' && !!sm.skippedAt && sm.loggedAt === null);
    const missedAgendaAfter = buildDailyAgenda({ now: new Date(), localDate: '2026-01-01', timezone: TZ, plans: [{ ...missed, status: 'SKIPPED', skippedAt: sm.skippedAt }], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
    check('26/11. that plan now derives agenda SKIPPED (not MISSED)', missedAgendaAfter.items[0].status === 'SKIPPED');

    // ---- 34/35. terminal rejections ----
    const logged = await mkPlan('Logged', 4 * HOUR, 5 * HOUR);
    const lr = await log(logged.id);
    const beforeLogged = await row(logged.id);
    const hb = await habitCount();
    const rl = await skip(logged.id);
    const afterLogged = await row(logged.id);
    check('34/6. LOGGED -> Skip is rejected (409)', rl.status === 409);
    check('34. the LOGGED plan, loggedAt, habitLogId and HabitLog are unchanged; no skippedAt', afterLogged.status === 'LOGGED' && afterLogged.loggedAt.getTime() === beforeLogged.loggedAt.getTime() && afterLogged.habitLogId === beforeLogged.habitLogId && afterLogged.skippedAt === null && (await habitCount()) === hb && lr.status === 200);
    const cancelled = await mkPlan('Cancelled', 6 * HOUR, 7 * HOUR);
    await cancelPlannedActivity(A.id, cancelled.id);
    const rc = await skip(cancelled.id);
    const sc = await row(cancelled.id);
    check('35/6. CANCELLED -> Skip is rejected (409), still CANCELLED, no skippedAt', rc.status === 409 && sc.status === 'CANCELLED' && sc.skippedAt === null);
    const skippedThenLog = await log(p1.id);
    const sAfter = await row(p1.id);
    check('6/9. SKIPPED -> Log and SKIPPED -> Cancel are rejected; the row stays SKIPPED with no HabitLog', skippedThenLog.status === 400 && sAfter.status === 'SKIPPED' && sAfter.habitLogId === null && (await cancelPlannedActivity(A.id, p1.id).then(() => false, () => true)) && (await habitCount()) === hb);

    // ---- 40. auth ----
    const other = await mkPlan('Not yours', 8 * HOUR, 9 * HOUR);
    const rx = await skip(other.id, tokB);
    check('40/6. cross-user Skip -> 404 and the plan stays UPCOMING', rx.status === 404 && (await row(other.id)).status === 'UPCOMING');
    const rnone = await skip(other.id, null);
    check('40. unauthenticated -> 401 and nothing changes', rnone.status === 401 && (await row(other.id)).status === 'UPCOMING');
    check('40. unknown plan id -> 404', (await skip('no-such-plan')).status === 404);

    // ---- 37/38/39. races (repeated: the outcome must never be mixed) ----
    let ssOk = true; let slOk = true; let scOk = true; let logWins = 0; let skipWinsL = 0; let cancelWins = 0; let skipWinsC = 0;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 16; i++) {
      const a = await mkPlan(`RaceSS${i}`, 10 * HOUR, 11 * HOUR);
      const hbBefore = await habitCount();
      const [x, y] = await Promise.all([skip(a.id), skip(a.id)]);
      const ra = await row(a.id);
      if (!(x.status === 200 && y.status === 200 && ra.status === 'SKIPPED' && invariantOk(ra) && new Date(x.body.plan.skippedAt).getTime() === ra.skippedAt.getTime() && new Date(y.body.plan.skippedAt).getTime() === ra.skippedAt.getTime() && (await habitCount()) === hbBefore)) ssOk = false;

      const b = await mkPlan(`RaceSL${i}`, 12 * HOUR, 13 * HOUR);
      const hbB = await habitCount();
      // even runs fire Skip first, odd runs delay it, so both orderings (Skip wins / Log wins) are actually exercised
      const [sk, lg] = await Promise.all([(i % 2 === 0 ? skip(b.id) : wait(8 + i).then(() => skip(b.id))), log(b.id)]);
      const rb = await row(b.id);
      const hbAfter = await habitCount();
      if (rb.status === 'SKIPPED') {
        skipWinsL++;
        if (!(sk.status === 200 && lg.status === 400 && rb.loggedAt === null && !!rb.skippedAt && rb.habitLogId === null && hbAfter === hbB)) slOk = false;
      } else if (rb.status === 'LOGGED') {
        logWins++;
        if (!(lg.status === 200 && sk.status === 409 && !!rb.loggedAt && rb.skippedAt === null && !!rb.habitLogId && hbAfter === hbB + 1)) slOk = false;
      } else slOk = false;
      if (!invariantOk(rb)) slOk = false;

      const c = await mkPlan(`RaceSC${i}`, 14 * HOUR, 15 * HOUR);
      const [sk2, cn] = await Promise.all([i % 2 === 0 ? skip(c.id) : wait(6).then(() => skip(c.id)), (i % 2 === 0 ? wait(6).then(() => cancelPlannedActivity(A.id, c.id)) : cancelPlannedActivity(A.id, c.id)).then(() => 'OK', () => 'REJECTED')]);
      const rc2 = await row(c.id);
      if (rc2.status === 'SKIPPED') { skipWinsC++; if (!(sk2.status === 200 && cn === 'REJECTED' && !!rc2.skippedAt)) scOk = false; }
      else if (rc2.status === 'CANCELLED') { cancelWins++; if (!(cn === 'OK' && sk2.status === 409 && rc2.skippedAt === null)) scOk = false; }
      else scOk = false;
      if (!invariantOk(rc2)) scOk = false;
    }
    check('37. Skip/Skip race (x16): one durable SKIPPED outcome, stable skippedAt, both callers see it, zero HabitLogs', ssOk);
    check(`38. Skip/Log race (x16): exactly one terminal outcome, never mixed (skip won ${skipWinsL}, log won ${logWins}); Log winner => exactly one HabitLog, Skip winner => zero`, slOk);
    check(`39. Skip/Cancel race (x16): exactly one terminal outcome, never a hybrid (skip won ${skipWinsC}, cancel won ${cancelWins})`, scOk);
    const bad = await sql(`SELECT count(*)::int AS n FROM "PlannedActivity" WHERE "userId" = $1 AND ((status = 'LOGGED' AND "skippedAt" IS NOT NULL) OR (status = 'SKIPPED' AND ("loggedAt" IS NOT NULL OR "skippedAt" IS NULL)) OR (status = 'UPCOMING' AND ("loggedAt" IS NOT NULL OR "skippedAt" IS NOT NULL)) OR (status = 'CANCELLED' AND "skippedAt" IS NOT NULL))`, [A.id]);
    const orphanLogs = await sql(`SELECT count(*)::int AS n FROM "PlannedActivity" WHERE "userId" = $1 AND status = 'SKIPPED' AND "habitLogId" IS NOT NULL`, [A.id]);
    check('7/8. after every scenario no row violates the invariant table and no SKIPPED plan has a HabitLog', Number(bad[0].n) === 0 && Number(orphanLogs[0].n) === 0);

    // ---- 31/46. capture + replan ----
    const cap = await createCapture(A.id, 'Call John');
    const d3 = await save(request('2026-12-04', [item('2026-12-04', 'c1', 'Call John', 10)]), '2026-12-04', new Map([['c1', cap.id]]));
    const p3 = d3.plans[0].id as string;
    const capBefore = (await getCaptureWithLinkedPlanStatus(A.id, cap.id))!;
    check('31. precondition: Capture derives PLANNED', deriveCaptureState({ status: capBefore.status, completedAt: capBefore.completedAt, linkedPlanStatus: capBefore.linkedPlanStatus }) === 'PLANNED');
    const habitsBeforeCap = await habitCount();
    const r3 = await skip(p3);
    const capRow = (await getCaptureWithLinkedPlanStatus(A.id, cap.id))!;
    check('31/13. Capture-linked plan: plan SKIPPED, Capture OPEN, completedAt null, link retained, no HabitLog', r3.status === 200 && capRow.completedAt === null && capRow.plannedActivityId === p3 && capRow.linkedPlanStatus === 'SKIPPED' && deriveCaptureState({ status: capRow.status, completedAt: capRow.completedAt, linkedPlanStatus: capRow.linkedPlanStatus }) === 'OPEN' && (await habitCount()) === habitsBeforeCap);
    const d3b = await save(request('2026-12-05', [item('2026-12-05', 'c2', 'Call John', 10)]), '2026-12-05', new Map([['c2', cap.id]]));
    const capAfter = (await getCaptureWithLinkedPlanStatus(A.id, cap.id))!;
    check('15/18/31/46. replan after Skip: acceptance succeeds and the Capture link moves to the new plan', d3b.status === 'SAVED' && capAfter.plannedActivityId === d3b.plans[0].id && capAfter.linkedPlanStatus === 'UPCOMING');
    const oldCap = await row(p3);
    check('46. the old plan remains historical SKIPPED with its skippedAt', oldCap.status === 'SKIPPED' && !!oldCap.skippedAt);

    // ---- 32/46. goal + replan ----
    const goal = await createGoalWithActivities({ userId: A.id, title: 'Skip goal', targetDate: null, activities: [] });
    goalIds.push(goal.goal.id);
    const ga = await addGoalActivity(A.id, goal.goal.id, { title: 'Draft deck', activityId: null });
    const d4 = await save(request('2026-12-06', [item('2026-12-06', 'g1', 'Draft deck', 10)]), '2026-12-06', new Map(), new Map([['g1', ga!.id]]));
    const p4 = d4.plans[0].id as string;
    const r4 = await skip(p4);
    const gaState = async () => { const g = (await listGoalActivitiesWithLinkedPlanStatus(A.id, goal.goal.id)).find((r) => r.id === ga!.id)!; return { g, state: deriveGoalActivityState({ status: g.status, plannedActivityId: g.plannedActivityId, linkedPlanStatus: g.linkedPlanStatus }) }; };
    const gs = await gaState();
    check('32/14. GoalActivity-linked plan: plan SKIPPED, GoalActivity SUGGESTED (never PLANNED/COMPLETED), link retained', r4.status === 200 && gs.state === 'SUGGESTED' && gs.g.plannedActivityId === p4 && gs.g.linkedPlanStatus === 'SKIPPED');
    const d4b = await save(request('2026-12-07', [item('2026-12-07', 'g2', 'Draft deck', 10)]), '2026-12-07', new Map(), new Map([['g2', ga!.id]]));
    const gs2 = await gaState();
    check('15/19/32/46. Goal replan after Skip succeeds: link moves to the new plan and derives PLANNED; the old plan stays SKIPPED', d4b.status === 'SAVED' && gs2.g.plannedActivityId === d4b.plans[0].id && gs2.state === 'PLANNED' && (await row(p4)).status === 'SKIPPED');

    // ---- 27. direct plan ----
    const direct = await mkPlan('Direct plan', 16 * HOUR, 17 * HOUR);
    await skip(direct.id);
    const linkedRefs = await sql(`SELECT (SELECT count(*) FROM "Capture" WHERE "plannedActivityId" = $1)::int AS c, (SELECT count(*) FROM "GoalActivity" WHERE "plannedActivityId" = $1)::int AS g`, [direct.id]);
    check('27. direct plan: retained as historical SKIPPED; no source object exists or was created', (await row(direct.id)).status === 'SKIPPED' && Number(linkedRefs[0].c) === 0 && Number(linkedRefs[0].g) === 0);

    // ---- 41. constructor ----
    const day = new Date();
    const busy = await mkPlan('Constructor slot', HOUR, 2 * HOUR);
    const from = new Date(Date.now() - 24 * HOUR); const to = new Date(Date.now() + 48 * HOUR);
    const toCandidate = (p: PlannedActivity) => ({ start: p.plannedStartAt, end: p.plannedEndAt, status: p.status as any });
    const pre = (await listPlannedActivitiesForDay(A.id, from, to)).find((p) => p.id === busy.id)!;
    check('41. before Skip: the UPCOMING plan blocks its interval', isActivePlanBlocker(toCandidate(pre), day) === true);
    await skip(busy.id);
    const post = (await listPlannedActivitiesForDay(A.id, from, to)).find((p) => p.id === busy.id)!;
    check('41/12. after Skip: the same interval no longer blocks (even though the row is returned by the day query)', post.status === 'SKIPPED' && isActivePlanBlocker(toCandidate(post), day) === false);

    // ---- 42/11. right now + agenda + composer ----
    const now = new Date();
    const activeNow = await mkPlan('Active now', -10 * 60000, 40 * 60000);
    const imminent = await mkPlan('Imminent', 10 * 60000, 50 * 60000);
    const pipeline = async () => {
      const plans = (await listPlannedActivitiesForDay(A.id, new Date(now.getTime() - 6 * HOUR), new Date(now.getTime() + 6 * HOUR))).filter((p) => p.id === activeNow.id || p.id === imminent.id);
      const agenda = buildDailyAgenda({ now, localDate: '2026-01-01', timezone: TZ, plans, moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
      const tl = buildHomeTimeline({ agenda, guidance: null, timelineWindows: [], currentMinuteOfDay: 600, timezone: TZ, localDate: '2026-01-01' });
      return { agenda, tl, rn: selectRightNowState(tl, now) };
    };
    const before = await pipeline();
    check('42. precondition: an active plan is ACTIVE_PLAN in Right Now', before.rn.kind === 'ACTIVE_PLAN' && (before.rn as any).item.title.startsWith('Active now'));
    await skip(activeNow.id);
    const mid = await pipeline();
    check('42/17. a SKIPPED active plan can never be ACTIVE_PLAN; Right Now moves to the imminent plan', mid.rn.kind === 'IMMINENT_PLAN' && (mid.rn as any).item.title.startsWith('Imminent'));
    check('11. agenda derives SKIPPED for it regardless of the current time window, and it is neither currentItem nor nextItem', mid.agenda.items.find((i) => i.title.startsWith('Active now'))!.status === 'SKIPPED' && mid.agenda.currentItem === undefined && !mid.agenda.nextItem?.title.startsWith('Active now'));
    await skip(imminent.id);
    const after = await pipeline();
    check('42/17. with both skipped, neither can win ACTIVE_PLAN or IMMINENT_PLAN', after.rn.kind !== 'ACTIVE_PLAN' && after.rn.kind !== 'IMMINENT_PLAN');
    const tlItem = after.tl.find((i) => i.title.startsWith('Active now'))!;
    check('18. the Composer projects SKIPPED as resolved history (isPast, not current, not completed)', tlItem.metadata?.agendaStatus === 'SKIPPED' && tlItem.metadata?.isCurrent === false && tlItem.metadata?.isPast === true && tlItem.metadata?.isCompleted === false);

    // ---- 43. plan tab source ----
    const listed = await listPlannedActivities(A.id);
    check('16/43. the Plan tab list never returns SKIPPED plans as upcoming/actionable work', listed.every((p) => p.status !== 'SKIPPED') && listed.some((p) => p.status === 'UPCOMING'));

    // ---- 44. story / reflection ----
    const agendaAll = buildDailyAgenda({ now, localDate: '2026-01-01', timezone: TZ, plans: await listPlannedActivitiesForDay(A.id, new Date(now.getTime() - 6 * HOUR), new Date(now.getTime() + 6 * HOUR)), moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
    const skippedIds = new Set(agendaAll.items.filter((i) => i.status === 'SKIPPED').map((i) => i.id));
    const refl = buildDailyReflection(agendaAll);
    const inRefl = [...refl.completed, ...refl.missed, ...refl.upcoming].some((i) => skippedIds.has(i.id));
    check('19/44. DailyReflection: a skipped plan is not completed, missed or upcoming', skippedIds.size > 0 && !inRefl);
    const story = buildDailyStory(agendaAll, 600);
    check('19/44. DailyStory: a skipped plan is never counted or named as pending/completed work', skippedIds.size > 0 && ![story.headline, story.narrative].join(' ').includes('Active now') && agendaAll.plannedCount === agendaAll.items.filter((i) => i.type !== 'COMPLETED_ACTIVITY' && i.status !== 'SKIPPED').length);

    // ---- 45/20. reminders ----
    const remPlan = await mkPlan('Reminder plan', 20 * 60000, 80 * 60000);
    const remBefore = await listPlannedActivitiesForReminders(A.id, new Date(Date.now() - HOUR), new Date(Date.now() + 2 * HOUR));
    check('45. precondition: the UPCOMING plan is a reminder candidate', remBefore.some((p) => p.id === remPlan.id));
    await skip(remPlan.id);
    const remAfter = await listPlannedActivitiesForReminders(A.id, new Date(Date.now() - HOUR), new Date(Date.now() + 2 * HOUR));
    const derived = deriveAuraReminders({ now: new Date(), leadMinutes: 60, ownerTimezone: TZ, plans: [(await listPlannedActivitiesForDay(A.id, from, to)).find((p) => p.id === remPlan.id)!], moments: [], momentIdsWithSuccessor: new Set() });
    check('20/45. a SKIPPED plan is excluded from the reminder query and derives no reminder', !remAfter.some((p) => p.id === remPlan.id) && derived.length === 0);

    // ---- 24. create dedupe ----
    const dupStart = inMs(30 * HOUR); const dupEnd = inMs(31 * HOUR);
    const dupA = await createPlannedActivity({ userId: A.id, title: 'Dedupe subject', plannedStartAt: dupStart, plannedEndAt: dupEnd, durationMinutes: 60, windowType: 'NEUTRAL' }); planIds.push(dupA.id);
    await skip(dupA.id);
    const dupB = await createPlannedActivity({ userId: A.id, title: 'Dedupe subject', plannedStartAt: dupStart, plannedEndAt: dupEnd, durationMinutes: 60, windowType: 'NEUTRAL' }); planIds.push(dupB.id);
    check('24. skipped history does not block legitimately re-planning the same title/time (a NEW UPCOMING plan is created)', dupB.id !== dupA.id && (await row(dupB.id)).status === 'UPCOMING');

    // ---- 25. DELETE ----
    const { DELETE: delRoute } = await import('../apps/web/app/api/plans/[planId]/route');
    const delRes = await delRoute(fakeReq(tokA), { params: { planId: p1.id } });
    check('25. the current DELETE route does not remove or alter a SKIPPED plan (400), documented V1 behavior', delRes.status === 400 && (await row(p1.id)).status === 'SKIPPED');

    // ---- direct function contract ----
    const direct2 = await mkPlan('Direct fn', 40 * HOUR, 41 * HOUR);
    const fnRes = await skipPlannedActivity(A.id, direct2.id);
    check('4. skipPlannedActivity(userId, planId) returns the SKIPPED row', fnRes.status === 'SKIPPED' && !!fnRes.skippedAt);
    const logAfterSkip = await logPlannedActivity(A.id, direct2.id).then(() => 'OK', () => 'REJECTED');
    check('4/6. logPlannedActivity on a SKIPPED plan throws and writes nothing', logAfterSkip === 'REJECTED' && (await row(direct2.id)).habitLogId === null);
  } finally {
    for (const id of planIds) {
      await sql(`UPDATE "Capture" SET "plannedActivityId" = NULL WHERE "plannedActivityId" = $1`, [id]).catch(() => {});
      await sql(`DELETE FROM "PlannedActivity" WHERE id = $1`, [id]).catch(() => {});
    }
    await sql(`DELETE FROM "Capture" WHERE "userId" = ANY($1)`, [[A.id, B.id]]).catch(() => {});
    for (const g of goalIds) await deleteGoal(A.id, g).catch(() => {});
    await sql(`DELETE FROM "HabitLog" WHERE "userId" = ANY($1)`, [[A.id, B.id]]).catch(() => {});
  }
  if (!allPassed) { console.error('SOME SKIP DB CHECKS FAILED'); process.exit(1); }
  console.log('ALL SKIP DB CHECKS PASSED');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
