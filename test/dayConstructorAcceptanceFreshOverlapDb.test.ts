/**
 * Schedule write consistency -- S1: acceptance's AUTHORITATIVE OVERLAP READ
 * (live database).
 *
 * THE DEFECT THIS PINS: Constructor acceptance validates a proposal against
 * a "fresh blocker" read taken inside its own transaction, after its
 * per-user advisory lock. That read used `listPlannedActivitiesForDay`,
 * which selects plans by `"plannedStartAt"` within the signed construction
 * window, so a current active plan that STARTED BEFORE the window but runs
 * into it (an in-progress plan, an overnight plan, a plan spanning the whole
 * window) was never loaded and a stale proposal could be persisted on top of
 * it.
 *
 * WHAT S1 GUARANTEES: after acceptance acquires its existing user lock, the
 * blocker snapshot it validates against includes every current active plan
 * interval that overlaps the signed window (half-open [start, end)),
 * whenever that plan started. Item-vs-blocker overlap stays the authority for
 * rejection; the lifecycle rules are unchanged.
 *
 * WHAT S1 DOES NOT CLAIM: it does not serialize writers that do not take the
 * lock (an ordinary plan creation). One test below records that known
 * non-guarantee on purpose -- it is the prerequisite for the next slice and
 * must be updated deliberately when that slice lands.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/dayConstructorAcceptanceFreshOverlapDb.test.ts
 */
import {
  upsertUserByEmail,
  updateBirthProfile,
  beginTransaction,
  createPlannedActivity,
  createGoalWithActivities,
  addGoalActivity,
  getUserById,
} from '../apps/web/lib/db';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import { createRealDayConstructorOrchestratorDeps } from '../apps/web/lib/dayConstructorOrchestrator';
import { handleDayConstructorPreviewRequest } from '../apps/web/lib/dayConstructorPreviewRequest';
import { verifyAcceptanceItems } from '../apps/web/lib/dayConstructorPreviewIntegrity';
import { localDateTimeToUTC } from '../apps/web/lib/timezone';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const KOLKATA = 'Asia/Kolkata';
const NEW_YORK = 'America/New_York';
const DATE = '2026-10-07';
const PREV = '2026-10-06';
const NEXT = '2026-10-08';
const MIN = 60000;

// Captured at load time, BEFORE the instrumentation below patches the module's export: test helpers must never go through the wrapper.
const rawBeginTransaction: typeof beginTransaction = require('../apps/web/lib/db').beginTransaction;

async function sql(text: string, params: unknown[] = []): Promise<any[]> {
  const c = await rawBeginTransaction();
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

type U = { id: string; timezone: string };
type Item = { intentId: string; title: string; start: Date; end: Date; placementSource: 'SELECTED_CANDIDATE'; activityId: string };

async function main() {
  const mk = async (key: string, tz: string, lat: number, lon: number) => {
    const u = await upsertUserByEmail({ email: `test-s1-${key}@example.com`, cityName: 'City', latitude: lat, longitude: lon, timezone: tz });
    await sql(`UPDATE "User" SET timezone = $1 WHERE id = $2`, [tz, u.id]);
    await updateBirthProfile(u.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'City', birthLatitude: lat, birthLongitude: lon, birthTimezone: tz });
    return u;
  };
  const K = await mk('kolkata', KOLKATA, 13.0827, 80.2707);
  const O = await mk('other', KOLKATA, 13.0827, 80.2707);
  const N = await mk('newyork', NEW_YORK, 40.7128, -74.006);
  const users = [K.id, O.id, N.id];
  const cleanup = async () => {
    await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = NULL WHERE "userId" = ANY($1::text[])`, [users]);
    await sql(`DELETE FROM "PlanCreationIdempotency" WHERE "userId" = ANY($1::text[])`, [users]).catch(() => {});
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])`, [users]);
    await sql(`DELETE FROM "GoalActivityOccurrence" WHERE "userId" = ANY($1::text[])`, [users]);
    await sql(`DELETE FROM "GoalActivity" WHERE "userId" = ANY($1::text[])`, [users]);
    await sql(`DELETE FROM "Goal" WHERE "userId" = ANY($1::text[])`, [users]);
  };
  await cleanup();

  const at = (date: string, hhmm: string, tz: string) => localDateTimeToUTC(date, hhmm, tz);
  const kAt = (date: string, hhmm: string) => at(date, hhmm, KOLKATA);
  let seq = 0;
  const plan = async (user: U, start: Date, end: Date, status = 'UPCOMING') => {
    const p = await createPlannedActivity({ userId: user.id, title: `s1-${seq++}`, plannedStartAt: start, plannedEndAt: end, durationMinutes: Math.max(1, Math.round((end.getTime() - start.getTime()) / MIN)), windowType: 'NEUTRAL' });
    if (status !== 'UPCOMING') await sql(`UPDATE "PlannedActivity" SET status = $2 WHERE id = $1`, [p.id, status]);
    return p;
  };
  const clearPlans = () => sql(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])`, [users]);
  const rowCount = async (user: U) => (await sql(`SELECT count(*)::int n FROM "PlannedActivity" WHERE "userId" = $1`, [user.id]))[0].n as number;
  const win = (user: U, date: string, from: Date, to: Date) => ({ date, start: from, end: to, timezone: user.timezone, source: 'EXPLICIT_RANGE' as const });
  const item = (intentId: string, start: Date, end: Date): Item => ({ intentId, title: `Task ${intentId}`, start, end, placementSource: 'SELECTED_CANDIDATE', activityId: 'workout' });

  // ---- instrumentation (test-only: wraps the module's own exports, no production hook) ----
  const db = require('../apps/web/lib/db');
  const realBegin = db.beginTransaction;
  const realOverlap = db.listPlannedActivitiesOverlappingRange;
  const realDay = db.listPlannedActivitiesForDay;
  const realInsert = db.createPlannedActivityWithClient;
  let events: string[] = [];
  let capture = false; // events are recorded only while the acceptance under test is running (helpers share pooled clients)
  let reads: Array<{ loader: string; rows: number; transactional: boolean; from: Date; to: Date }> = [];
  let afterRead: (() => Promise<void>) | undefined;
  const isTxClient = (x: any) => !!x && typeof x.query === 'function' && typeof x.release === 'function';
  db.beginTransaction = async () => {
    const c = await realBegin();
    const q = (c as any).__rawQuery ?? ((c as any).__rawQuery = c.query.bind(c));
    (c as any).query = (text: any, ...rest: any[]) => {
      // Callback-style calls (pg-pool's own pool.query) and wrapper-free runs pass straight through.
      if (typeof rest[rest.length - 1] === 'function') return q(text, ...rest);
      const t = typeof text === 'string' ? text : text?.text ?? '';
      if (capture && /pg_advisory_xact_lock/.test(t)) events.push('LOCK');
      return q(text, ...rest).then((r: any) => {
        if (capture && /^COMMIT$/.test(t)) events.push('COMMIT');
        if (capture && /^ROLLBACK$/.test(t)) events.push('ROLLBACK');
        return r;
      });
    };
    return c;
  };
  const wrapLoader = (name: string, real: Function) => async (...args: any[]) => {
    events.push(`READ:${name}`);
    const rows = await real(...args);
    reads.push({ loader: name, rows: rows.length, transactional: isTxClient(args[3]), from: args[1], to: args[2] });
    if (afterRead) {
      const hook = afterRead;
      afterRead = undefined;
      await hook();
    }
    return rows;
  };
  db.listPlannedActivitiesOverlappingRange = wrapLoader('overlap', realOverlap);
  db.listPlannedActivitiesForDay = wrapLoader('day', realDay);
  db.createPlannedActivityWithClient = async (...args: any[]) => {
    events.push('INSERT');
    return realInsert(...args);
  };
  const restore = () => {
    db.beginTransaction = realBegin;
    db.listPlannedActivitiesOverlappingRange = realOverlap;
    db.listPlannedActivitiesForDay = realDay;
    db.createPlannedActivityWithClient = realInsert;
  };
  let reqSeq = 0;
  /** The real persistence entry point, after the route's integrity gate (S1 touches only this layer). */
  const accept = async (user: U, window: ReturnType<typeof win>, items: Item[], opts: { now?: Date; clientRequestId?: string; goalLinks?: Map<string, string> } = {}) => {
    events = [];
    reads = [];
    const before = await rowCount(user);
    capture = true;
    const res: any = await persistAcceptedConstructedDay(user.id, { clientRequestId: opts.clientRequestId ?? `s1-${Date.now()}-${reqSeq++}`, constructionWindow: window, proposedItems: items } as any, opts.now ?? kAt(DATE, '09:00'), opts.goalLinks ?? new Map());
    capture = false;
    const after = await rowCount(user);
    return { res, status: res.status as string, reason: res.reason as string | undefined, intents: ((res.diagnostics ?? []) as any[]).map((d) => d.intentId).sort(), before, after, events: [...events], reads: [...reads] };
  };
  const rejected = (a: { status: string; reason?: string; before: number; after: number }) => a.status === 'REJECTED' && a.reason === 'CONFLICT' && a.after === a.before;
  const saved = (a: { status: string; before: number; after: number }, n = 1) => a.status === 'SAVED' && a.after === a.before + n;

  const W = (d = DATE) => win(K, d, kAt(d, '09:00'), kAt(d, '17:00'));
  const NOW = kAt(DATE, '09:00');

  try {
    // ==========================================================
    console.log('=== real preview, then a conflicting plan is persisted, then acceptance ===');
    const preview = async (user: U, now: Date, window: { start: Date; end: Date }) => {
      const r = await handleDayConstructorPreviewRequest({
        getSession: () => ({ userId: user.id }),
        getUser: (id) => getUserById(id),
        getBody: async () => ({ constructionWindowSource: 'EXPLICIT_RANGE', explicitStart: window.start.toISOString(), explicitEnd: window.end.toISOString(), intents: [{ id: 'A', title: 'Task A', flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 60 }] }),
        now: () => now,
        createOrchestratorDeps: createRealDayConstructorOrchestratorDeps,
      });
      const body: any = JSON.parse(JSON.stringify(r.body));
      const it = body.preview.constructedDay.proposedItems[0];
      return { P: { start: new Date(it.start), end: new Date(it.end) }, token: it.acceptanceToken, activityId: it.activityId, title: it.title, window: { start: new Date(body.preview.constructionWindow.start), end: new Date(body.preview.constructionWindow.end) } };
    };
    // The real preview chooses WHERE inside the window the proposal lands (the timing engine ranks candidates, and that
    // ranking is environment-dependent: it may be 10:30 on one machine and exactly the window start on another). These
    // scenarios test blocker-overlap correctness, not stale-preview handling, so their clock is a fixed instant strictly
    // BEFORE the construction window: any valid in-window proposal is then future work (start >= window start > clock) and can
    // never be rejected as STALE_PREVIEW, whatever slot the engine picks.
    const SCENARIO_NOW = kAt(DATE, '08:00');
    const lateScenarios: Array<[string, (P: { start: Date; end: Date }, w: { start: Date; end: Date }) => [Date, Date], boolean]> = [
      ['A. SAME-DAY IN-PROGRESS plan (starts 08:30, before the 09:00 window start, ends after the proposal)', (P, w) => [new Date(w.start.getTime() - 30 * MIN), new Date(P.end.getTime() + 15 * MIN)], true],
      ['B. OVERNIGHT plan (starts the previous evening 20:00, ends after the proposal)', (P) => [kAt(PREV, '20:00'), new Date(P.end.getTime() + 15 * MIN)], true],
      ['C. control: plan that STARTS INSIDE the window', (P) => [new Date(P.start.getTime() - 10 * MIN), new Date(P.end.getTime() + 10 * MIN)], true],
    ];
    for (const [label, mkPlan, expectReject] of lateScenarios) {
      await clearPlans();
      const pv = await preview(K, SCENARIO_NOW, { start: kAt(DATE, '09:00'), end: kAt(DATE, '17:00') });
      const [s, e] = mkPlan(pv.P, pv.window);
      await plan(K, s, e); // appears AFTER the preview was produced
      const items = [{ ...item('A', pv.P.start, pv.P.end), title: pv.title, activityId: pv.activityId }];
      const integrity = verifyAcceptanceItems(K.id, W() as any, items as any, new Map([['A', pv.token]]) as any);
      const a = await accept(K, W(), items, { now: SCENARIO_NOW });
      const fmt = (d: Date) => `${d.toISOString()} (${d.toLocaleTimeString('en-GB', { timeZone: KOLKATA, hour: '2-digit', minute: '2-digit' })} IST)`;
      console.log(`   [diag] ${label.slice(0, 2)} planning date ${DATE}; window ${fmt(W().start)} .. ${fmt(W().end)}; preview proposal ${fmt(pv.P.start)} .. ${fmt(pv.P.end)}; acceptance now ${fmt(SCENARIO_NOW)}; late plan ${fmt(s)} .. ${fmt(e)}; result ${a.status}/${a.reason ?? '-'} details=${JSON.stringify(((a.res.diagnostics ?? []) as any[]).map((d) => d.detail ?? d.reason))}; proposalStart<=now: ${pv.P.start.getTime() <= SCENARIO_NOW.getTime()}`);
      check(`${label}: determinism guard -- the scenario clock precedes the construction window, so the preview-chosen proposal (start ${fmt(pv.P.start)}) cannot be stale`, SCENARIO_NOW.getTime() < W().start.getTime() && pv.P.start.getTime() >= W().start.getTime());
      check(`${label}: the preview was valid (signed token verifies) and the proposal really overlaps the late plan`, integrity.length === 0 && pv.P.start.getTime() < e.getTime() && s.getTime() < pv.P.end.getTime());
      check(`${label}: acceptance is ${expectReject ? 'REJECTED as CONFLICT with zero new rows' : 'SAVED'}`, expectReject ? rejected(a) : saved(a));
    }

    // ==========================================================
    console.log('=== boundary semantics: half-open [start, end), at millisecond precision ===');
    const first = item('A', kAt(DATE, '09:00'), kAt(DATE, '10:00')); // starts exactly at the window start
    const last = item('A', kAt(DATE, '16:00'), kAt(DATE, '17:00')); // ends exactly at the window end
    const mid = item('A', kAt(DATE, '10:30'), kAt(DATE, '11:30'));
    const ws = kAt(DATE, '09:00');
    const we = kAt(DATE, '17:00');
    const boundaryCases: Array<[string, Item, Date, Date, boolean, number]> = [
      ['blocker ending EXACTLY at the window start does not conflict (and is not even loaded)', first, kAt(PREV, '20:00'), ws, false, 0],
      ['blocker ending ONE ms after the window start overlaps the first minute (loaded and conflicting)', first, kAt(PREV, '20:00'), new Date(ws.getTime() + 1), true, 1],
      ['blocker starting EXACTLY at the window end does not conflict (and is not even loaded)', last, we, kAt(NEXT, '02:00'), false, 0],
      ['blocker starting ONE ms before the window end overlaps the last minute (loaded and conflicting)', last, new Date(we.getTime() - 1), kAt(NEXT, '02:00'), true, 1],
      ['FULL-SPAN blocker (starts before and ends after the window) is loaded and conflicts', mid, kAt(PREV, '12:00'), kAt(NEXT, '12:00'), true, 1],
      ['blocker ENTIRELY BEFORE the window: not loaded, no rejection', mid, kAt(PREV, '10:00'), kAt(PREV, '12:00'), false, 0],
      ['blocker ENTIRELY AFTER the window: not loaded, no rejection', mid, kAt('2026-10-09', '10:00'), kAt('2026-10-09', '12:00'), false, 0],
      ['in-window blocker that does NOT touch the accepted item (13:00-14:00 vs item 10:30-11:30): loaded, NO false rejection', mid, kAt(DATE, '13:00'), kAt(DATE, '14:00'), false, 1],
      ['an in-progress blocker overlapping the WINDOW but not the item (08:30-09:45 vs item 10:30-11:30): loaded, NO false rejection', mid, kAt(DATE, '08:30'), kAt(DATE, '09:45'), false, 1],
      ['an in-window blocker ending EXACTLY where the item starts (10:30) does not conflict: acceptance compares half-open item and blocker intervals', mid, kAt(DATE, '09:30'), kAt(DATE, '10:30'), false, 1],
      ['an in-window blocker starting EXACTLY where the item ends (11:30) does not conflict', mid, kAt(DATE, '11:30'), kAt(DATE, '12:30'), false, 1],
      ['same-window blocker overlapping the item (existing behavior)', mid, kAt(DATE, '11:00'), kAt(DATE, '12:00'), true, 1],
    ];
    for (const [label, it, s, e, expectReject, expectLoaded] of boundaryCases) {
      await clearPlans();
      await plan(K, s, e);
      const a = await accept(K, W(), [it], { now: kAt(DATE, '08:00') }); // earlier instant: an item starting exactly at the window start must not be stale
      check(`${label}: ${expectReject ? 'REJECTED' : 'SAVED'}, blocker rows loaded = ${expectLoaded}`, (expectReject ? rejected(a) : saved(a)) && a.reads.length === 1 && a.reads[0].rows === expectLoaded);
    }

    // ==========================================================
    console.log('=== lifecycle is unchanged ===');
    for (const [status, blocks] of [['UPCOMING', true], ['LOGGED', true], ['CANCELLED', false], ['SKIPPED', false], ['MOVED', false]] as const) {
      await clearPlans();
      await plan(K, kAt(PREV, '20:00'), kAt(DATE, '11:45'), status);
      const a = await accept(K, W(), [mid]);
      check(`overnight ${status} plan: ${blocks ? 'blocks (REJECTED)' : 'does not block (SAVED)'}`, blocks ? rejected(a) : saved(a));
    }
    // (An UPCOMING plan that has already elapsed at the acceptance instant cannot overlap a still-future proposed item, so
    // the server-clock rule is not reachable through acceptance; it stays covered by the Constructor/lifecycle suites.)

    // ==========================================================
    console.log('=== isolation, multiplicity, atomicity ===');
    await clearPlans();
    await plan(O, kAt(PREV, '20:00'), kAt(DATE, '11:45')); // another user's overnight plan
    const cross = await accept(K, W(), [mid]);
    check('another USER\'s overlapping plan never rejects (and is not loaded)', saved(cross) && cross.reads[0].rows === 0);
    await clearPlans();
    const A = item('A', kAt(DATE, '10:30'), kAt(DATE, '11:30'));
    const B = item('B', kAt(DATE, '13:00'), kAt(DATE, '14:00'));
    await plan(K, kAt(DATE, '08:30'), kAt(DATE, '09:45')); // in-progress, overlaps the window, touches neither item
    await plan(K, kAt(PREV, '21:00'), kAt(DATE, '10:45')); // overnight, overlaps ONLY item A
    await plan(K, kAt(DATE, '15:00'), kAt(DATE, '16:00')); // later in the window, touches neither
    const multi = await accept(K, W(), [A, B]);
    check('MULTIPLE blockers are all loaded (3) and the right one decides: REJECTED naming only item A', rejected(multi) && multi.reads[0].rows === 3 && JSON.stringify(multi.intents) === JSON.stringify(['A']));
    check('MULTIPLE items: one conflicting item rejects the WHOLE request atomically -- the clean item B was not written either (0 new rows)', multi.after === multi.before);
    check('and no accepted-plan INSERT was even attempted on the conflict path', !multi.events.includes('INSERT') && multi.events[multi.events.length - 1] === 'ROLLBACK');

    // ==========================================================
    console.log('=== transaction, lock order, query count, row volume ===');
    await clearPlans();
    const ok = await accept(K, W(), [mid]);
    check('the fresh blocker read happens AFTER the advisory lock, BEFORE the accepted-plan INSERT, and the transaction then commits', ok.events.join(',') === 'LOCK,READ:overlap,INSERT,COMMIT');
    check('the fresh blocker read goes through the canonical OVERLAP loader, not the start-scoped day loader', ok.reads.length === 1 && ok.reads[0].loader === 'overlap');
    check('the loader receives the acceptance TRANSACTION client (not the global pool)', ok.reads[0].transactional);
    check('the loader is asked for exactly the SIGNED window (not the civil day)', ok.reads[0].from.getTime() === ws.getTime() && ok.reads[0].to.getTime() === we.getTime());
    check('ONE fresh-blocker query per acceptance (no N+1) even with several items', (await accept(K, W(), [item('A', kAt(DATE, '12:00'), kAt(DATE, '12:30')), item('B', kAt(DATE, '13:00'), kAt(DATE, '13:30')), item('C', kAt(DATE, '14:00'), kAt(DATE, '14:30'))])).reads.length === 1);
    await clearPlans();
    const day = (n: number) => { const d = new Date(Date.UTC(2026, 9, 7 + n)); return d.toISOString().slice(0, 10); };
    for (let i = 1; i <= 80; i++) {
      await plan(K, kAt(day(-i - 1), '10:00'), kAt(day(-i - 1), '11:00'));
      await plan(K, kAt(day(i + 1), '10:00'), kAt(day(i + 1), '11:00'));
    }
    await plan(K, kAt(PREV, '20:00'), kAt(DATE, '11:45'));
    const vol = await accept(K, W(), [mid]);
    check('160 historical/future plans plus one overnight plan: the fresh read returns ONLY the 1 overlapping row, and acceptance rejects', rejected(vol) && vol.reads[0].rows === 1);

    // ==========================================================
    console.log('=== claim rollback, retry, replay ===');
    await clearPlans();
    const blocker = await plan(K, kAt(PREV, '20:00'), kAt(DATE, '11:45'));
    const retryId = `s1-retry-${Date.now()}`;
    const first1 = await accept(K, W(), [mid], { clientRequestId: retryId });
    await sql(`DELETE FROM "PlannedActivity" WHERE id = $1`, [blocker.id]);
    const retry = await accept(K, W(), [mid], { clientRequestId: retryId });
    check('a REJECTED acceptance rolls back its idempotency claim: the SAME request id is retryable once the blocker is gone (SAVED)', rejected(first1) && saved(retry));
    const replay = await accept(K, W(), [mid], { clientRequestId: retryId });
    check('REPLAY of a successful acceptance is classified before fresh validation (ALREADY_ACCEPTED, no new row)', replay.status === 'ALREADY_ACCEPTED' && replay.after === replay.before && replay.reads.length === 0);
    await plan(K, kAt(PREV, '20:00'), kAt(DATE, '11:45')); // an overlapping plan appears AFTER the acceptance
    const replay2 = await accept(K, W(), [mid], { clientRequestId: retryId });
    check('a replay stays ALREADY_ACCEPTED even though a plan overlapping it now exists (replay is not a new authorization attempt)', replay2.status === 'ALREADY_ACCEPTED');

    // ==========================================================
    console.log('=== Goal side effects: a conflict leaves no Goal write behind ===');
    await clearPlans();
    const goal = (await createGoalWithActivities({ userId: K.id, title: 'S1 goal', targetDate: null, activities: [] })).goal;
    const ga = await addGoalActivity(K.id, goal.id, { title: 'S1 workout', activityId: 'workout' });
    await sql(`UPDATE "GoalActivity" SET "rhythmKind" = 'N_PER_WEEK', "rhythmTargetPerWeek" = 3 WHERE id = $1`, [ga!.id]);
    await plan(K, kAt(PREV, '20:00'), kAt(DATE, '11:45'));
    const occBefore = (await sql(`SELECT count(*)::int n FROM "GoalActivityOccurrence" WHERE "userId" = $1`, [K.id]))[0].n;
    const goalRejected = await accept(K, W(), [mid], { goalLinks: new Map([['A', ga!.id]]) });
    const occAfter = (await sql(`SELECT count(*)::int n FROM "GoalActivityOccurrence" WHERE "userId" = $1`, [K.id]))[0].n;
    const link = (await sql(`SELECT "plannedActivityId" FROM "GoalActivity" WHERE id = $1`, [ga!.id]))[0].plannedActivityId;
    check('a Goal-linked proposal blocked by an overnight plan is REJECTED with no occurrence, no GoalActivity link and no new plan', rejected(goalRejected) && occAfter === occBefore && link === null);
    await clearPlans();
    await sql(`DELETE FROM "GoalActivityOccurrence" WHERE "userId" = $1`, [K.id]); // independent control: reset any link a defective baseline may have created
    await sql(`UPDATE "GoalActivity" SET "plannedActivityId" = NULL WHERE id = $1`, [ga!.id]);
    const occBefore2 = (await sql(`SELECT count(*)::int n FROM "GoalActivityOccurrence" WHERE "userId" = $1`, [K.id]))[0].n;
    const goalSaved = await accept(K, W(), [mid], { goalLinks: new Map([['A', ga!.id]]) });
    const occSaved = (await sql(`SELECT count(*)::int n FROM "GoalActivityOccurrence" WHERE "userId" = $1`, [K.id]))[0].n;
    check('control: the same Goal-linked proposal with no blocker is SAVED and materializes its occurrence (Goal handling unchanged, no Goal-specific branch)', saved(goalSaved) && occSaved === occBefore2 + 1);
    await clearPlans();
    await sql(`DELETE FROM "GoalActivityOccurrence" WHERE "userId" = $1`, [K.id]);

    // ==========================================================
    console.log('=== cross-midnight window and DST (absolute instants, no civil-day assumption) ===');
    {
      const cwin = win(K, DATE, kAt(DATE, '22:00'), kAt(NEXT, '03:00'));
      const late = item('A', kAt(DATE, '22:30'), kAt(DATE, '23:30'));
      await clearPlans();
      await plan(K, kAt(DATE, '20:00'), kAt(NEXT, '01:30')); // starts before the window, crosses midnight, overlaps the item
      const c1 = await accept(K, cwin, [late]);
      check('a window CROSSING midnight: a plan that started before the window and runs past midnight is loaded and rejects the overlapping item', rejected(c1));
      await clearPlans();
      await plan(K, kAt(NEXT, '01:00'), kAt(NEXT, '02:00')); // starts on the NEXT civil date, inside the window
      const c2 = await accept(K, cwin, [item('A', kAt(NEXT, '01:15'), kAt(NEXT, '02:00'))]);
      check('a blocker beginning on the next civil date but inside the absolute window rejects an overlapping item', rejected(c2) && c2.reads[0].rows === 1);
      await clearPlans();
      await plan(K, kAt(NEXT, '01:00'), kAt(NEXT, '02:00'));
      const c3 = await accept(K, cwin, [late]);
      check('and the same blocker does not reject a disjoint item in that window', saved(c3));
    }
    for (const [label, date, prev] of [['SPRING FORWARD (2027-03-14, 23-hour day)', '2027-03-14', '2027-03-13'], ['FALL BACK (2026-11-01, 25-hour day)', '2026-11-01', '2026-10-31']] as const) {
      await clearPlans();
      const s = at(prev, '22:00', NEW_YORK);
      const e = at(date, '11:00', NEW_YORK);
      await plan(N, s, e);
      const nwin = win(N, date, at(date, '09:00', NEW_YORK), at(date, '17:00', NEW_YORK));
      const rej = await accept(N, nwin, [item('A', at(date, '10:00', NEW_YORK), at(date, '11:30', NEW_YORK))], { now: at(date, '08:00', NEW_YORK) });
      const adj = await accept(N, nwin, [item('B', at(date, '11:00', NEW_YORK), at(date, '12:00', NEW_YORK))], { now: at(date, '08:00', NEW_YORK) });
      check(`${label}: an overnight plan ending 11:00 rejects an overlapping item, and an item starting exactly at 11:00 is accepted`, rejected(rej) && saved(adj));
    }

    // ==========================================================
    console.log('=== unchanged known debt (documented, not solved here) ===');
    await clearPlans();
    const z = kAt(DATE, '11:00');
    await plan(K, z, z); // a zero-length row (the plans API rejects these; the storage layer can hold one)
    const zero = await accept(K, W(), [mid]);
    check('ZERO-LENGTH debt unchanged: acceptance\'s in-memory overlap treats a zero-length plan strictly inside an item as a conflict (same as before S1; not aligned with the Constructor\'s clipping here)', rejected(zero));

    console.log('=== known LIMIT: a writer that bypasses the schedule lock is not serialized (the ordinary POST /api/plans route takes the lock since schedule-write S2; see scheduleWriteManualSerializationDb) ===');
    await clearPlans();
    afterRead = async () => {
      await createPlannedActivity({ userId: K.id, title: 's1-unlocked-manual', plannedStartAt: kAt(DATE, '11:00'), plannedEndAt: kAt(DATE, '12:00'), durationMinutes: 60, windowType: 'NEUTRAL' } as any);
    };
    const knownRace = await accept(K, W(), [mid]);
    afterRead = undefined;
    const overlapping = (await sql(`SELECT count(*)::int n FROM "PlannedActivity" WHERE "userId" = $1 AND "plannedStartAt" < $3 AND "plannedEndAt" > $2`, [K.id, mid.start, mid.end]))[0].n as number;
    check('KNOWN LIMIT: a plan written by a writer that BYPASSES the schedule lock (a direct createPlannedActivity call outside the serialized route) after acceptance\'s read and before its commit is not seen -- acceptance saves and both rows overlap; the ordinary manual route no longer behaves this way since S2, and this characterization is about the lock being the only protection', knownRace.status === 'SAVED' && overlapping === 2);
    await clearPlans();

    restore();
    if (!allPassed) {
      console.error('SOME ACCEPTANCE FRESH-OVERLAP DB CHECKS FAILED');
      process.exit(1);
    }
    console.log('ALL ACCEPTANCE FRESH-OVERLAP DB CHECKS PASSED');
  } finally {
    restore();
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
