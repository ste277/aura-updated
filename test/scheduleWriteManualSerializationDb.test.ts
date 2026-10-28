/**
 * Schedule write consistency -- S2: manual plan writer SERIALIZATION
 * (live database, the REAL `POST /api/plans` route).
 *
 * WHAT S2 DOES: the ordinary/manual plan writer takes the SAME per-user,
 * transaction-scoped advisory lock Constructor acceptance, Move and
 * Recomposition acceptance already take, and performs its insert in that
 * transaction. A manual write and an Aura automatic write for one user can
 * therefore no longer make their write decisions concurrently.
 *
 * WHAT S2 DOES NOT DO: the lock only ORDERS writers. It adds no overlap check
 * to manual creation, so an explicit manual overlap stays allowed (including
 * manual-manual), and a manual write that follows an automatic commit may
 * legitimately overlap it. It is not a global schedule invariant.
 *
 * Interleavings are forced deterministically with real Postgres: test-only
 * wrappers around the modules' own exports (no production hooks) pause a
 * writer inside its critical section.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/scheduleWriteManualSerializationDb.test.ts
 */
import { upsertUserByEmail, updateBirthProfile, beginTransaction, createPlannedActivity, getUserById } from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import { movePlannedActivity } from '../apps/web/lib/planMove';
import { localDateTimeToUTC } from '../apps/web/lib/timezone';
import { POST as plansRoute } from '../apps/web/app/api/plans/route';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const TZ = 'Asia/Kolkata';
const DATE = '2026-10-07';
const MIN = 60000;
const HOUR = 3600000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const T0 = process.hrtime.bigint();
const now_ = () => Number(process.hrtime.bigint() - T0) / 1e6;
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
const fakeReq = (cookie: string | undefined, body: unknown): any => ({ cookies: { get: (n: string) => (cookie !== undefined && n === 'as_session' ? { value: cookie } : undefined) }, json: async () => body, headers: new Headers() });

type Ev = { t: number; ev: string; pid?: number; title?: string; tx?: boolean };

async function main() {
  const mk = async (key: string) => {
    const u = await upsertUserByEmail({ email: `test-s2-${key}@example.com`, cityName: 'City', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
    await sql(`UPDATE "User" SET timezone = $1 WHERE id = $2`, [TZ, u.id]);
    await updateBirthProfile(u.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'City', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
    return { ...u, token: createSessionToken(u.id, u.email) };
  };
  const X = await mk('x');
  const Y = await mk('y');
  const ids = [X.id, Y.id];
  const cleanup = async () => {
    await sql(`DELETE FROM "PlanCreationIdempotency" WHERE "userId" = ANY($1::text[])`, [ids]).catch(() => {});
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])`, [ids]);
  };
  await cleanup();
  const at = (date: string, hhmm: string) => localDateTimeToUTC(date, hhmm, TZ);
  const rows = async (user: { id: string }) => (await sql(`SELECT title, "plannedStartAt" s, "plannedEndAt" e, status FROM "PlannedActivity" WHERE "userId" = $1 ORDER BY "plannedStartAt", title`, [user.id])) as Array<{ title: string; s: Date; e: Date; status: string }>;
  const titles = async (user: { id: string }) => (await rows(user)).map((r) => r.title);

  // ---- test-only instrumentation: wraps the modules' own exports; nothing in production is hooked ----
  const db = require('../apps/web/lib/db');
  const realBegin = db.beginTransaction;
  const realCreate = db.createPlannedActivity;
  const realOverlapLoader = db.listPlannedActivitiesOverlappingRange;
  const realDayLoader = db.listPlannedActivitiesForDay;
  let events: Ev[] = [];
  let capture = false;
  let queryHook: ((text: string) => Promise<void>) | undefined;
  const gates = new Map<string, { promise: Promise<void>; release: () => void }>();
  const atGate = new Set<string>();
  const failTitles = new Set<string>();
  let afterRead: (() => Promise<void>) | undefined;
  const isTx = (x: any) => !!x && typeof x.query === 'function' && typeof x.release === 'function';
  const log = (ev: string, extra: Partial<Ev> = {}) => { if (capture) events.push({ t: now_(), ev, ...extra }); };
  db.beginTransaction = async () => {
    const c = await realBegin();
    const q = (c as any).__rawQuery ?? ((c as any).__rawQuery = c.query.bind(c));
    if (!(c as any).__errListener) { (c as any).__errListener = true; c.on('error', () => {}); } // a deliberately terminated backend emits an error on its client
    (c as any).query = (text: any, ...rest: any[]) => {
      if (typeof rest[rest.length - 1] === 'function') return q(text, ...rest);
      const t = typeof text === 'string' ? text : text?.text ?? '';
      if (/pg_advisory_xact_lock/.test(t)) log('LOCK', { pid: (c as any).processID });
      // COMMIT/ROLLBACK are logged when ISSUED: another writer can only be released after the server executes them, so
      // "issued" is a sound lower bound for ordering (logging on completion would race the waiter's own log line).
      if (/^COMMIT$/.test(t)) log('COMMIT', { pid: (c as any).processID });
      if (/^ROLLBACK$/.test(t)) log('ROLLBACK', { pid: (c as any).processID });
      return q(text, ...rest).then(async (r: any) => {
        if (queryHook) {
          const h = queryHook;
          if (/"plannedStartAt" < \$4 AND "plannedEndAt" > \$3/.test(t)) { queryHook = undefined; await h(t); }
        }
        return r;
      });
    };
    return c;
  };
  db.createPlannedActivity = async (input: any, executor?: any) => {
    const title = input.title as string;
    log('INSERT-START', { title, pid: executor?.processID, tx: isTx(executor) });
    const gate = gates.get(title);
    if (gate) {
      atGate.add(title);
      await gate.promise;
    }
    if (failTitles.has(title)) throw new Error('forced insert failure');
    const r = await realCreate(input, executor);
    log('INSERT-DONE', { title, pid: executor?.processID });
    return r;
  };
  const wrapLoader = (name: string, real: Function) => async (...args: any[]) => {
    log(`READ:${name}`);
    const r = await real(...args);
    if (afterRead) {
      const h = afterRead;
      afterRead = undefined;
      await h();
    }
    return r;
  };
  db.listPlannedActivitiesOverlappingRange = wrapLoader('overlap', realOverlapLoader);
  db.listPlannedActivitiesForDay = wrapLoader('day', realDayLoader);
  const restore = () => {
    db.beginTransaction = realBegin;
    db.createPlannedActivity = realCreate;
    db.listPlannedActivitiesOverlappingRange = realOverlapLoader;
    db.listPlannedActivitiesForDay = realDayLoader;
  };
  const gate = (title: string) => {
    let release!: () => void;
    const promise = new Promise<void>((r) => (release = r));
    gates.set(title, { promise, release });
    return { release: () => { gates.get(title)!.release(); gates.delete(title); } };
  };
  const waitUntil = async (cond: () => boolean, ms = 4000) => { const t = Date.now(); while (!cond() && Date.now() - t < ms) await sleep(10); return cond(); };
  const track = <T,>(p: Promise<T>) => { const s = { settled: false, value: undefined as T | undefined, at: 0 }; const out = p.then((v) => { s.settled = true; s.value = v; s.at = now_(); return v; }); return { p: out, s }; };

  const planBody = (title: string, start: Date, end: Date, extra: Record<string, unknown> = {}) => ({ title, activityType: title, plannedStartAt: start.toISOString(), plannedEndAt: end.toISOString(), durationMinutes: Math.round((end.getTime() - start.getTime()) / MIN), windowType: 'NEUTRAL', ...extra });
  const post = async (user: { token: string }, title: string, start: Date, end: Date, extra: Record<string, unknown> = {}) => {
    const res = await plansRoute(fakeReq(user.token, planBody(title, start, end, extra)));
    return { status: res.status as number, json: await res.json() };
  };
  const window = { date: DATE, start: at(DATE, '09:00'), end: at(DATE, '17:00'), timezone: TZ, source: 'EXPLICIT_RANGE' as const };
  const ACC_NOW = at(DATE, '08:00');
  let reqSeq = 0;
  const accept = (user: { id: string }, start = at(DATE, '10:30'), end = at(DATE, '11:30')) =>
    persistAcceptedConstructedDay(user.id, { clientRequestId: `s2-${Date.now()}-${reqSeq++}`, constructionWindow: window, proposedItems: [{ intentId: 'A', title: 'Aura item', start, end, placementSource: 'SELECTED_CANDIDATE', activityId: 'workout' }] } as any, ACC_NOW) as Promise<any>;
  const lockCount = async () => (await sql(`SELECT count(*)::int n FROM pg_locks WHERE locktype = 'advisory' AND granted`))[0].n as number;

  try {
    // ============================================================
    console.log('=== API contract and mechanics are preserved ===');
    await cleanup();
    capture = true;
    events = [];
    const ok = await post(X, 'contract-plan', at(DATE, '10:00'), at(DATE, '11:00'));
    capture = false;
    check('POST /api/plans still returns 200 with the created plan (owner, title, FIXED scheduling mode)', ok.status === 200 && ok.json.userId === X.id && ok.json.title === 'contract-plan' && ok.json.schedulingMode === 'FIXED');
    check('the writer now runs as: advisory LOCK, then the plan INSERT on the transaction client, then COMMIT (one lock, one commit, no rollback)', events.map((e) => e.ev).join(',') === 'LOCK,INSERT-START,INSERT-DONE,COMMIT' && events.find((e) => e.ev === 'INSERT-START')?.tx === true);
    check('the lock and the insert run on the SAME backend connection (same transaction client)', new Set(events.filter((e) => e.pid !== undefined).map((e) => e.pid)).size === 1);
    capture = true;
    events = [];
    const bad = await post(X, 'bad-duration', at(DATE, '10:00'), at(DATE, '10:05'));
    const unauth = await plansRoute(fakeReq(undefined, planBody('nobody', at(DATE, '10:00'), at(DATE, '11:00'))));
    const zero = await post(X, 'zero-length', at(DATE, '12:00'), at(DATE, '12:00'));
    capture = false;
    check('validation (400) and authentication (401) errors are unchanged and take NO lock and open NO transaction', bad.status === 400 && unauth.status === 401 && zero.status === 400 && events.length === 0);
    const idem1 = await post(X, 'idempotent-plan', at(DATE, '14:00'), at(DATE, '15:00'), { clientRequestId: 's2-idem-1' });
    const idem2 = await post(X, 'idempotent-plan', at(DATE, '14:00'), at(DATE, '15:00'), { clientRequestId: 's2-idem-1' });
    check('plan-create IDEMPOTENCY is unchanged: the same clientRequestId returns the same plan and creates one row', idem1.status === 200 && idem2.status === 200 && idem1.json.id === idem2.json.id && (await titles(X)).filter((t) => t === 'idempotent-plan').length === 1);

    // ============================================================
    console.log('=== manual overlap semantics are UNCHANGED (serialization is not validation) ===');
    await cleanup();
    const m1 = await post(X, 'manual-a', at(DATE, '10:00'), at(DATE, '11:00'));
    const m2 = await post(X, 'manual-b', at(DATE, '10:30'), at(DATE, '11:30')).catch(() => ({ status: 0, json: null as any }));
    check('manual-manual overlap is still ALLOWED: both overlapping plans are created with 200 (no new rejection, no 409)', m1.status === 200 && m2.status === 200 && (await titles(X)).join() === 'manual-a,manual-b');

    // ============================================================
    console.log('=== the S1 known race is CLOSED: acceptance holds the lock, a manual write waits ===');
    await cleanup();
    let manualDuring: ReturnType<typeof track<{ status: number; json: any }>> | undefined;
    let pendingDuringCritical = false;
    afterRead = async () => {
      // acceptance has taken the lock and completed its fresh read; an ordinary manual write arrives NOW
      manualDuring = track(post(X, 'manual-during', at(DATE, '11:00'), at(DATE, '12:00')));
      await sleep(600);
      pendingDuringCritical = !manualDuring.s.settled;
    };
    capture = true;
    events = [];
    const accFirst = await accept(X);
    const accDoneAt = now_();
    const manualResult = await manualDuring!.p;
    capture = false;
    console.log('   timeline (ms): ' + events.map((e) => `+${Math.round(e.t - events[0].t)} ${e.ev}${e.title ? `[${e.title}]` : ''}`).join(' | '));
    const insertManual = events.find((e) => e.ev === 'INSERT-START' && e.title === 'manual-during');
    const accCommit = events.find((e) => e.ev === 'COMMIT');
    check('acceptance SAVED its proposal (its fresh read saw no blocker at that moment)', accFirst.status === 'SAVED');
    check('while acceptance was between its fresh read and its COMMIT, the manual write was BLOCKED (pending) -- it could not commit inside that critical section', pendingDuringCritical);
    check('the manual write began its INSERT only AFTER acceptance COMMITTED (lock released at commit)', !!insertManual && !!accCommit && insertManual.t >= accCommit.t);
    check('the manual write then completed normally after acceptance (200)', manualResult.status === 200 && manualDuring!.s.at >= accDoneAt - 50);
    const afterFirst = await rows(X);
    check('ACCEPTANCE-FIRST final state (intentional Model A behavior): both plans exist and they overlap, because a manual overlap that FOLLOWS an automatic commit is allowed', afterFirst.map((r) => r.title).join() === 'Aura item,manual-during' && afterFirst[0].e.getTime() > afterFirst[1].s.getTime());

    // ============================================================
    console.log('=== manual first: acceptance waits, then its authoritative read sees the manual plan ===');
    await cleanup();
    const g1 = gate('manual-first');
    events = [];
    capture = true;
    const manualFirst = track(post(X, 'manual-first', at(DATE, '11:00'), at(DATE, '12:00')));
    const reached = await waitUntil(() => atGate.has('manual-first'));
    const acc2 = track(accept(X));
    await sleep(600);
    const acceptancePendingWhileManualHolds = !acc2.s.settled;
    g1.release();
    atGate.delete('manual-first');
    const manualFirstRes = await manualFirst.p;
    const acc2Res = await acc2.p;
    capture = false;
    const manualCommit = events.filter((e) => e.ev === 'COMMIT')[0];
    const readEvent = events.find((e) => e.ev === 'READ:overlap');
    check('the manual writer held the lock inside its critical section (reached its insert gate)', reached);
    check('while the manual writer held the lock, acceptance for the same user was BLOCKED', acceptancePendingWhileManualHolds);
    check('MANUAL-FIRST final state: the manual write succeeded, acceptance was REJECTED as CONFLICT, and only the manual interval persists', manualFirstRes.status === 200 && acc2Res.status === 'REJECTED' && acc2Res.reason === 'CONFLICT' && (await titles(X)).join() === 'manual-first');
    check('acceptance\'s authoritative blocker read happened AFTER the manual commit (no stale read)', !!manualCommit && !!readEvent && readEvent.t >= manualCommit.t);

    // ============================================================
    console.log('=== two manual writers, same user: serialized; both may succeed ===');
    await cleanup();
    const g2 = gate('mw-1');
    events = [];
    capture = true;
    const w1 = track(post(X, 'mw-1', at(DATE, '10:00'), at(DATE, '11:00')));
    await waitUntil(() => atGate.has('mw-1'));
    const w2 = track(post(X, 'mw-2', at(DATE, '10:30'), at(DATE, '11:30')));
    await sleep(600);
    const w2StartedWhileHeld = events.some((e) => e.ev === 'INSERT-START' && e.title === 'mw-2');
    g2.release();
    atGate.delete('mw-1');
    const [r1, r2] = await Promise.all([w1.p, w2.p]);
    capture = false;
    check('the second manual write for the same user did NOT reach its insert while the first held the lock', !w2StartedWhileHeld);
    check('after the first committed, the second proceeded and both succeeded (manual overlap permitted): two overlapping rows', r1.status === 200 && r2.status === 200 && (await titles(X)).join() === 'mw-1,mw-2');

    // ============================================================
    console.log('=== different users never wait on each other ===');
    await cleanup();
    const g3 = gate('user-x-held');
    const heldX = track(post(X, 'user-x-held', at(DATE, '10:00'), at(DATE, '11:00')));
    await waitUntil(() => atGate.has('user-x-held'));
    const tY = now_();
    const yRes = await post(Y, 'user-y-free', at(DATE, '14:00'), at(DATE, '15:00')); // clear of Y's acceptance item (10:30-11:30)
    // a client-supplied userId in the body can neither choose the lock identity nor the plan owner: Y's request that
    // CLAIMS to be user X must not wait on X's held lock, and the plan is owned by the authenticated session user (Y)
    const spoof: { status: number; json: any } = await Promise.race([post(Y, 'spoofed-owner', at(DATE, '16:00'), at(DATE, '16:30'), { userId: X.id }), sleep(2500).then(() => ({ status: -1, json: {} as any }))]);
    const yAcc = await accept(Y);
    const yElapsed = now_() - tY;
    const xStillHeld = !heldX.s.settled;
    g3.release();
    atGate.delete('user-x-held');
    await heldX.p;
    check('while user X\'s writer holds X\'s lock, user Y\'s manual write AND acceptance complete without waiting (cross-user concurrency)', xStillHeld && yRes.status === 200 && yAcc.status === 'SAVED' && yElapsed < 1500);
    check('user X\'s write then completes normally', (await titles(X)).join() === 'user-x-held');
    check('CLIENT-SUPPLIED identity is ignored: a body userId did not make the request take X\'s lock (it completed while X was held) and did not change the plan owner', spoof.status === 200 && spoof.json.userId === Y.id && (await titles(Y)).includes('spoofed-owner'));

    // ============================================================
    console.log('=== Move for the same user is serialized with a manual write ===');
    await cleanup();
    const base = new Date(); base.setUTCDate(base.getUTCDate() + 5); base.setUTCHours(10, 0, 0, 0);
    const H = (h: number) => new Date(base.getTime() + (h - 10) * HOUR);
    const toMove = await realCreate({ userId: X.id, title: 'to-move', plannedStartAt: H(10), plannedEndAt: H(11), durationMinutes: 60, windowType: 'NEUTRAL' } as any);
    let manualInMove: ReturnType<typeof track<{ status: number; json: any }>> | undefined;
    let movePending = false;
    queryHook = async () => {
      manualInMove = track(post(X, 'manual-during-move', H(16), H(17)));
      await sleep(600);
      movePending = !manualInMove.s.settled;
    };
    events = [];
    capture = true;
    const moved = await movePlannedActivity(X.id, toMove.id, { newStartAt: H(14) });
    const mvCommit = events.find((e) => e.ev === 'COMMIT');
    const mvManualRes = await manualInMove!.p;
    capture = false;
    console.log('   move timeline (ms): ' + events.map((e) => `+${Math.round(e.t - events[0].t)} ${e.ev}${e.title ? `[${e.title}]` : ''}`).join(' | ') + ` | moved.to.status=${moved.to.status} manualStatus=${mvManualRes.status}`);
    const mvInsert = events.find((e) => e.ev === 'INSERT-START' && e.title === 'manual-during-move');
    check('a manual write arriving inside Move\'s critical section (after its overlap check) was BLOCKED', movePending);
    check('Move committed first and the manual write inserted only after Move\'s COMMIT', moved.to.status === 'UPCOMING' && !!mvInsert && !!mvCommit && mvInsert.t >= mvCommit.t && mvManualRes.status === 200);

    // ============================================================
    console.log('=== failure paths release the lock ===');
    await cleanup();
    failTitles.add('will-fail');
    events = [];
    capture = true;
    let threw = false;
    try { await post(X, 'will-fail', at(DATE, '10:00'), at(DATE, '11:00')); } catch { threw = true; }
    capture = false;
    failTitles.delete('will-fail');
    const failSeq = events.map((e) => e.ev).join(',');
    const tNext = now_();
    const nextOk = await post(X, 'after-failure', at(DATE, '12:00'), at(DATE, '13:00'));
    const nextElapsed = now_() - tNext;
    check('a failure AFTER the lock was taken rolls the transaction back (LOCK ... ROLLBACK, no commit) and surfaces as before (the error propagates)', threw && /^LOCK,INSERT-START,ROLLBACK$/.test(failSeq) && (await titles(X)).join() === 'after-failure');
    check('the lock is released: no advisory lock remains and the next writer for the same user proceeds immediately', (await lockCount()) === 0 && nextOk.status === 200 && nextElapsed < 1500);
    const g4 = gate('holder-killed');
    events = [];
    capture = true;
    const holder = track(post(X, 'holder-killed', at(DATE, '14:00'), at(DATE, '15:00')).catch(() => ({ status: 0, json: null })));
    await waitUntil(() => atGate.has('holder-killed'));
    const holderPid = events.find((e) => e.ev === 'INSERT-START' && e.title === 'holder-killed')?.pid;
    const waiter = track(accept(X, at(DATE, '16:00'), at(DATE, '16:30')));
    await sleep(500);
    const waiterBlocked = !waiter.s.settled;
    const tKill = now_();
    await sql(`SELECT pg_terminate_backend($1)`, [holderPid]);
    const waiterRes = await waiter.p;
    capture = false;
    g4.release();
    atGate.delete('holder-killed');
    await holder.p;
    check('CONNECTION loss: terminating the lock holder\'s backend frees the transaction-scoped lock automatically (no manual unlock) and the blocked writer proceeds', waiterBlocked && waiterRes.status === 'SAVED' && waiter.s.at >= tKill && (await lockCount()) === 0);

    // ============================================================
    console.log('=== cost (local, informational) ===');
    await cleanup();
    const timeIt = async (n: number, fn: (i: number) => Promise<unknown>) => { const t: number[] = []; for (let i = 0; i < n; i++) { const s = process.hrtime.bigint(); await fn(i); t.push(Number(process.hrtime.bigint() - s) / 1e6); } t.sort((a, b) => a - b); return `median ${t[Math.floor(n / 2)].toFixed(1)} ms, max ${t[n - 1].toFixed(1)} ms (n=${n})`; };
    console.log('   uncontended manual create through the route:', await timeIt(30, (i) => post(X, `perf-${i}`, new Date(at(DATE, '09:00').getTime() + i * 2 * HOUR), new Date(at(DATE, '09:00').getTime() + i * 2 * HOUR + 30 * MIN))));

    restore();
    if (!allPassed) {
      console.error('SOME MANUAL WRITER SERIALIZATION DB CHECKS FAILED');
      process.exit(1);
    }
    console.log('ALL MANUAL WRITER SERIALIZATION DB CHECKS PASSED');
  } finally {
    restore();
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
