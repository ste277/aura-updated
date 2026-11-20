/**
 * AURA-HPG5-V2-I1 -- Find a Time availability and conflict enforcement:
 * live-database half of the approved T1-T24 matrix, against the REAL
 * `POST /api/timing-search` and `POST /api/plans` route handlers.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/findATimeConstraintsDb.test.ts
 *
 * Disposable database only: creates synthetic `@e2e.aura.local` users and
 * deletes everything it wrote on exit.
 *
 * Dates are relative to the real clock (the timing-search route resolves
 * its own `now`), always searching TOMORROW (or later) in Asia/Kolkata so
 * today-clipping never interferes.
 */
import { upsertUserByEmail, beginTransaction, createGoalWithActivities, createUserAvailabilityPeriod, setDailyWorkPreferences } from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { localDateTimeToUTC, getDatePartsInTimezone, addDaysToDateStr } from '../apps/web/lib/timezone';
import { getWeekdayForDateStr } from '../apps/web/lib/availabilityContext';
import { POST as plansRoute } from '../apps/web/app/api/plans/route';
import { POST as timingSearchRoute } from '../apps/web/app/api/timing-search/route';

let allPassed = true;
let count = 0;
function check(label: string, condition: boolean) {
  count++;
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const TZ = 'Asia/Kolkata';
const MIN = 60000;
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
async function call(route: (req: any) => Promise<Response>, token: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await route(fakeReq(token, body));
  return { status: res.status, body: await res.json() };
}

const today = getDatePartsInTimezone(TZ, new Date()).dateStr;
const D1 = addDaysToDateStr(today, 1);
const D2 = addDaysToDateStr(today, 2);
const at = (date: string, hhmm: string) => localDateTimeToUTC(date, hhmm, TZ);
const planBody = (title: string, start: Date, end: Date, extra: Record<string, unknown> = {}) => ({ title, activityType: title, plannedStartAt: start.toISOString(), plannedEndAt: end.toISOString(), durationMinutes: Math.round((end.getTime() - start.getTime()) / MIN), windowType: 'NEUTRAL', ...extra });
const overlaps = (s: string, e: string, a: Date, b: Date) => new Date(s).getTime() < b.getTime() && a.getTime() < new Date(e).getTime();
const inside = (s: string, e: string, a: Date, b: Date) => new Date(s).getTime() >= a.getTime() && new Date(e).getTime() <= b.getTime();

async function main() {
  const tag = `i1-${Date.now()}`;
  const mk = async (key: string) => {
    const u = await upsertUserByEmail({ email: `hpg5-${key}-${tag}@e2e.aura.local`, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
    await sql(`UPDATE "User" SET timezone = $1 WHERE id = $2`, [TZ, u.id]);
    return { ...u, token: createSessionToken(u.id, u.email) };
  };
  const A = await mk('a'); // configured availability
  const B = await mk('b'); // unconfigured
  const Cu = await mk('c'); // tiny, fully occupied window
  const G = await mk('g'); // goal identity
  const X = await mk('x'); // concurrency / transaction ordering
  const ids = [A.id, B.id, Cu.id, G.id, X.id];
  const cleanup = async () => {
    await sql(`DELETE FROM "PlanCreationIdempotency" WHERE "userId" = ANY($1::text[])`, [ids]).catch(() => {});
    await sql(`DELETE FROM "GoalActivityOccurrence" WHERE "userId" = ANY($1::text[])`, [ids]).catch(() => {});
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "User" WHERE id = ANY($1::text[])`, [ids]).catch(() => {});
  };
  const planCount = async (userId: string) => Number((await sql(`SELECT count(*)::int n FROM "PlannedActivity" WHERE "userId" = $1`, [userId]))[0].n);

  try {
    const wd1 = getWeekdayForDateStr(D1);
    const wd2 = getWeekdayForDateStr(D2);

    // ---- fixtures ----
    await createUserAvailabilityPeriod(A.id, wd1, '06:00', '22:00');
    await sql(`UPDATE "User" SET "availabilityConfigured" = true WHERE id = $1`, [A.id]);
    const learn = await call(plansRoute, A.token, planBody('Learn', at(D1, '07:00'), at(D1, '08:00')));
    const running = await call(plansRoute, A.token, planBody('Running', at(D1, '18:00'), at(D1, '18:45')));
    check('fixture: legacy saves (no overlapPolicy) succeed', learn.status === 200 && running.status === 200);

    // ============================================================
    // Route: /api/timing-search FIND applies the constraints (T1, T6, T8, T9)
    // ============================================================
    const findBody = (extra: Record<string, unknown> = {}) => ({ mode: 'FIND', activityId: 'workout', durationMinutes: 30, horizon: 'TOMORROW', timePreference: 'ANY', limit: 10, clientNow: new Date().toISOString(), ...extra });
    const fa = await call(timingSearchRoute, A.token, findBody());
    check('T1 route: FIND returns candidates', fa.status === 200 && fa.body.candidates.length > 0);
    check('T1 route: every candidate inside saved availability (06:00-22:00)', fa.body.candidates.every((c: any) => inside(c.start, c.end, at(D1, '06:00'), at(D1, '22:00'))));
    check('T6 route: no candidate overlaps Learn or Running', fa.body.candidates.every((c: any) => !overlaps(c.start, c.end, at(D1, '07:00'), at(D1, '08:00')) && !overlaps(c.start, c.end, at(D1, '18:00'), at(D1, '18:45'))));
    check('T9 route: constraintsApplied reports CONFIGURED + 2 blocking plans', JSON.stringify(fa.body.constraintsApplied) === JSON.stringify({ availability: 'CONFIGURED', blockedPlanCount: 2 }));
    check('route: no emptyReason on a non-empty result', fa.body.emptyReason === undefined);
    const faMorning = await call(timingSearchRoute, A.token, findBody({ timePreference: 'MORNING' }));
    check('T8 route: adjacent 06:30 (ends exactly when Learn starts) or 08:00 (starts as it ends) may be offered; nothing overlapping', faMorning.body.candidates.every((c: any) => !overlaps(c.start, c.end, at(D1, '07:00'), at(D1, '08:00'))) && faMorning.body.candidates.length > 0);

    // ============================================================
    // T3 route -- unconfigured availability
    // ============================================================
    await call(plansRoute, B.token, planBody('Existing', at(D1, '20:00'), at(D1, '21:00')));
    const fb = await call(timingSearchRoute, B.token, findBody({ timePreference: 'EVENING' }));
    check('T3 route: UNCONFIGURED reported, existing plan still counted', JSON.stringify(fb.body.constraintsApplied) === JSON.stringify({ availability: 'UNCONFIGURED', blockedPlanCount: 1 }));
    check('T3 route: no candidate overlaps the existing plan', fb.body.candidates.length > 0 && fb.body.candidates.every((c: any) => !overlaps(c.start, c.end, at(D1, '20:00'), at(D1, '21:00'))));
    const fbNight = await call(timingSearchRoute, B.token, findBody({ timePreference: 'NIGHT' }));
    check('T3 route: no new overnight restriction for unconfigured users (NIGHT still returns results)', fbNight.body.candidates.length > 0);

    // ============================================================
    // T11 DB -- a plan that starts the previous day and crosses midnight
    // ============================================================
    await call(plansRoute, B.token, planBody('Overnight', at(D1, '23:30'), at(D2, '00:30')));
    const fbD2 = await call(timingSearchRoute, B.token, findBody({ horizon: undefined, dateRange: { start: D2, end: D2 }, timePreference: 'NIGHT' }));
    check('T11 route: a D2-only search still excludes the overnight plan that started on D1 (load bounds)', fbD2.body.candidates.length > 0 && fbD2.body.candidates.every((c: any) => !overlaps(c.start, c.end, at(D1, '23:30'), at(D2, '00:30'))));
    check('T11 route: overnight plan counted as a blocker for the D2 search', fbD2.body.constraintsApplied.blockedPlanCount >= 1);

    // ============================================================
    // T15 route -- Daily Rhythm unchanged, over eligible slots
    // ============================================================
    await setDailyWorkPreferences(A.id, { workStart: '09:00', workEnd: '17:00', workDays: [0, 1, 2, 3, 4, 5, 6] });
    const fdr = await call(timingSearchRoute, A.token, findBody({ limit: 3 }));
    check('T15 route: Daily Rhythm notes still produced', fdr.body.dailyRhythmNotes && Object.keys(fdr.body.dailyRhythmNotes).length > 0);
    check('T15 route: candidates still inside availability and conflict-free with Daily Rhythm on', fdr.body.candidates.length > 0 && fdr.body.candidates.every((c: any) => inside(c.start, c.end, at(D1, '06:00'), at(D1, '22:00')) && !overlaps(c.start, c.end, at(D1, '07:00'), at(D1, '08:00')) && !overlaps(c.start, c.end, at(D1, '18:00'), at(D1, '18:45'))));
    check('T15 route: outside-work preference kept (all before 09:00 or after 17:00)', fdr.body.candidates.every((c: any) => new Date(c.end).getTime() <= at(D1, '09:00').getTime() || new Date(c.start).getTime() >= at(D1, '17:00').getTime()));

    // ============================================================
    // T16 route -- CHECK keeps explicit-time behaviour
    // ============================================================
    const chkOverlap = await call(timingSearchRoute, A.token, { mode: 'CHECK', activityId: 'workout', durationMinutes: 30, candidateStart: at(D1, '07:15').toISOString(), clientNow: new Date().toISOString() });
    check('T16 route: CHECK of a time overlapping Learn still scores that exact instant', chkOverlap.status === 200 && chkOverlap.body.requestedCandidate?.start === at(D1, '07:15').toISOString());
    const chkOutside = await call(timingSearchRoute, A.token, { mode: 'CHECK', activityId: 'workout', durationMinutes: 30, candidateStart: at(D1, '02:00').toISOString(), clientNow: new Date().toISOString() });
    check('T16 route: CHECK outside availability still scores that exact instant', chkOutside.status === 200 && chkOutside.body.requestedCandidate?.start === at(D1, '02:00').toISOString());
    check('T16 route: CHECK responses carry no constraintsApplied (never filtered)', chkOverlap.body.constraintsApplied === undefined && chkOutside.body.constraintsApplied === undefined);

    // ============================================================
    // T23 route -- empty result with an explicit reason
    // ============================================================
    await createUserAvailabilityPeriod(Cu.id, wd1, '06:00', '07:00');
    await sql(`UPDATE "User" SET "availabilityConfigured" = true WHERE id = $1`, [Cu.id]);
    await call(plansRoute, Cu.token, planBody('Blocker', at(D1, '06:00'), at(D1, '07:00')));
    const fc = await call(timingSearchRoute, Cu.token, findBody());
    check('T23 route: fully occupied availability -> zero candidates, emptyReason NO_ELIGIBLE_TIME', fc.status === 200 && fc.body.candidates.length === 0 && fc.body.emptyReason === 'NO_ELIGIBLE_TIME');
    const fcD2 = await call(timingSearchRoute, Cu.token, findBody({ horizon: undefined, dateRange: { start: D2, end: D2 } }));
    check('T4/T23 route: configured but no period on that weekday -> NO_AVAILABILITY_IN_RANGE', wd2 === wd1 || (fcD2.body.candidates.length === 0 && fcD2.body.emptyReason === 'NO_AVAILABILITY_IN_RANGE'));

    // ============================================================
    // Plans route -- overlapPolicy (T17, T18, T19)
    // ============================================================
    const beforeA = await planCount(A.id);
    const legacy = await call(plansRoute, A.token, planBody('Manual overlap', at(D1, '07:15'), at(D1, '07:45')));
    check('T19 legacy save without overlapPolicy still allows an explicit overlap (S2 contract)', legacy.status === 200 && (await planCount(A.id)) === beforeA + 1);
    const explicitAllow = await call(plansRoute, A.token, planBody('Explicit ALLOW', at(D1, '07:15'), at(D1, '07:45'), { overlapPolicy: 'ALLOW' }));
    check('T19 explicit ALLOW behaves like absent', explicitAllow.status === 200);
    const bad = await call(plansRoute, A.token, planBody('Bad policy', at(D1, '12:00'), at(D1, '12:30'), { overlapPolicy: 'reject' }));
    check('unknown overlapPolicy -> 400, nothing written', bad.status === 400 && (await planCount(A.id)) === beforeA + 2);

    // Stale recommendation: search, then a competing plan appears, then save.
    const fresh = await call(timingSearchRoute, A.token, findBody({ timePreference: 'AFTERNOON', limit: 3 }));
    const pick = fresh.body.candidates[0];
    check('T17 setup: a valid recommendation exists', !!pick);
    const competitor = await call(plansRoute, A.token, planBody('Team call', new Date(pick.start), new Date(new Date(pick.start).getTime() + 60 * MIN)));
    check('T17 setup: competing plan created after the search', competitor.status === 200);
    const beforeStale = await planCount(A.id);
    const stale = await call(plansRoute, A.token, planBody('Workout', new Date(pick.start), new Date(pick.end), { overlapPolicy: 'REJECT_ACTIVE_OVERLAP', activityId: 'workout' }));
    check('T17 stale save with REJECT_ACTIVE_OVERLAP -> 409', stale.status === 409);
    check('T17 code PLAN_OVERLAP', stale.body.code === 'PLAN_OVERLAP');
    check('T17 conflict names the competing plan and its time', stale.body.conflict?.title === 'Team call' && stale.body.conflict?.plannedStartAt === new Date(pick.start).toISOString());
    check('T17 conflict carries only title/start/end (no ids or other fields)', JSON.stringify(Object.keys(stale.body.conflict).sort()) === JSON.stringify(['plannedEndAt', 'plannedStartAt', 'title']));
    check('T17 zero rows written', (await planCount(A.id)) === beforeStale);
    const anyway = await call(plansRoute, A.token, planBody('Workout', new Date(pick.start), new Date(pick.end), { overlapPolicy: 'ALLOW', activityId: 'workout' }));
    check('T18 "Save anyway" (ALLOW) -> 200, overlap now present by explicit choice', anyway.status === 200 && (await planCount(A.id)) === beforeStale + 1);

    const adj = await call(plansRoute, A.token, planBody('Adjacent', at(D1, '08:00'), at(D1, '08:30'), { overlapPolicy: 'REJECT_ACTIVE_OVERLAP' }));
    check('T8 save: adjacent (starts when Learn ends) accepted under REJECT', adj.status === 200);
    const adj2 = await call(plansRoute, A.token, planBody('Adjacent before', at(D1, '06:30'), at(D1, '07:00'), { overlapPolicy: 'REJECT_ACTIVE_OVERLAP' }));
    check('T8 save: adjacent (ends when Learn starts) accepted under REJECT', adj2.status === 200);
    const partial = await call(plansRoute, A.token, planBody('Partial', at(D1, '17:45'), at(D1, '18:15'), { overlapPolicy: 'REJECT_ACTIVE_OVERLAP' }));
    check('T7 save: partial overlap rejected under REJECT', partial.status === 409 && partial.body.conflict?.title === 'Running');

    // Lifecycle at save time: CANCELLED / SKIPPED do not block.
    const doomed = await call(plansRoute, A.token, planBody('Doomed', at(D1, '13:00'), at(D1, '14:00')));
    await sql(`UPDATE "PlannedActivity" SET status = 'CANCELLED' WHERE id = $1`, [doomed.body.id]);
    const overCancelled = await call(plansRoute, A.token, planBody('Over cancelled', at(D1, '13:15'), at(D1, '13:45'), { overlapPolicy: 'REJECT_ACTIVE_OVERLAP' }));
    check('T10 save: a CANCELLED plan does not block under REJECT', overCancelled.status === 200);
    const skipped = await call(plansRoute, A.token, planBody('Skipped one', at(D1, '15:00'), at(D1, '16:00')));
    await sql(`UPDATE "PlannedActivity" SET status = 'SKIPPED' WHERE id = $1`, [skipped.body.id]);
    const overSkipped = await call(plansRoute, A.token, planBody('Over skipped', at(D1, '15:15'), at(D1, '15:45'), { overlapPolicy: 'REJECT_ACTIVE_OVERLAP' }));
    check('T10 save: a SKIPPED plan does not block under REJECT', overSkipped.status === 200);
    const overnightSave = await call(plansRoute, B.token, planBody('After midnight', at(D2, '00:00'), at(D2, '00:15'), { overlapPolicy: 'REJECT_ACTIVE_OVERLAP' }));
    check('T11 save: the D1->D2 overnight plan blocks a D2 00:00 save under REJECT', overnightSave.status === 409 && overnightSave.body.conflict?.title === 'Overnight');

    // ============================================================
    // T21 -- goal-linked identity
    // ============================================================
    const { activities } = await createGoalWithActivities({ userId: G.id, title: 'Move my body', targetDate: null, activities: [{ title: 'Run', activityId: null, rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 3 } }, { title: 'Stretch once', activityId: null, rhythm: { kind: 'NONE' } }] });
    const runGA = activities.find((a: any) => a.title === 'Run')!;
    const onceGA = activities.find((a: any) => a.title === 'Stretch once')!;
    await call(plansRoute, G.token, planBody('Busy', at(D1, '10:00'), at(D1, '11:00')));
    const g409 = await call(plansRoute, G.token, planBody('Run', at(D1, '10:30'), at(D1, '11:00'), { overlapPolicy: 'REJECT_ACTIVE_OVERLAP', goalActivityId: runGA.id }));
    const occAfter409 = await sql(`SELECT count(*)::int n FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [runGA.id]);
    check('T21 N_PER_WEEK goal save rejected with PLAN_OVERLAP', g409.status === 409 && g409.body.code === 'PLAN_OVERLAP');
    check('T21 409 rolls back: no occurrence row, no extra plan', occAfter409[0].n === 0 && (await planCount(G.id)) === 1);
    const gOk = await call(plansRoute, G.token, planBody('Run', at(D1, '10:30'), at(D1, '11:00'), { overlapPolicy: 'ALLOW', goalActivityId: runGA.id }));
    const occ = await sql(`SELECT "plannedActivityId" FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [runGA.id]);
    check('T21 Save anyway links the N_PER_WEEK activity exactly once, to the new plan', gOk.status === 200 && occ.length === 1 && occ[0].plannedActivityId === gOk.body.id);
    const once409 = await call(plansRoute, G.token, planBody('Stretch once', at(D1, '10:15'), at(D1, '10:45'), { overlapPolicy: 'REJECT_ACTIVE_OVERLAP', goalActivityId: onceGA.id }));
    const onceRow = await sql(`SELECT "plannedActivityId" FROM "GoalActivity" WHERE id = $1`, [onceGA.id]);
    check('T21 finite (NONE) goal activity: 409 leaves it unlinked', once409.status === 409 && onceRow[0].plannedActivityId === null);
    const onceOk = await call(plansRoute, G.token, planBody('Stretch once', at(D1, '12:00'), at(D1, '12:30'), { overlapPolicy: 'REJECT_ACTIVE_OVERLAP', goalActivityId: onceGA.id }));
    const onceRow2 = await sql(`SELECT "plannedActivityId" FROM "GoalActivity" WHERE id = $1`, [onceGA.id]);
    check('T21 conflict-free REJECT save links the finite activity to the new plan', onceOk.status === 200 && onceRow2[0].plannedActivityId === onceOk.body.id);

    // ============================================================
    // T20 -- concurrency (advisory lock serializes the decision)
    // ============================================================
    const slot = planBody('Race', at(D1, '09:00'), at(D1, '09:30'), { overlapPolicy: 'REJECT_ACTIVE_OVERLAP' });
    const [r1, r2] = await Promise.all([call(plansRoute, X.token, slot), call(plansRoute, X.token, slot)]);
    const statuses = [r1.status, r2.status].sort();
    check('T20 two simultaneous REJECT saves for one slot -> exactly one 200 and one 409', JSON.stringify(statuses) === JSON.stringify([200, 409]));
    check('T20 exactly one row written', (await planCount(X.id)) === 1);

    // ============================================================
    // Transaction ordering: lock -> overlap check -> insert, one client
    // ============================================================
    const db = require('../apps/web/lib/db');
    const log: Array<{ client: number; sql: string }> = [];
    let clientSeq = 0;
    const original = db.beginTransaction;
    db.beginTransaction = async (...args: any[]) => {
      const client = await original(...args);
      const id = ++clientSeq;
      const q = client.query.bind(client);
      client.query = (text: any, params?: any) => {
        log.push({ client: id, sql: String(typeof text === 'string' ? text : text?.text ?? '').replace(/\s+/g, ' ').trim() });
        return q(text, params);
      };
      return client;
    };
    try {
      const rejected = await call(plansRoute, X.token, planBody('Order-409', at(D1, '09:05'), at(D1, '09:25'), { overlapPolicy: 'REJECT_ACTIVE_OVERLAP' }));
      const seq409 = log.filter((l) => l.client === clientSeq).map((l) => l.sql);
      const iLock = seq409.findIndex((s) => s.includes('pg_advisory_xact_lock'));
      const iCheck = seq409.findIndex((s) => s.includes('FROM "PlannedActivity"') && s.includes('"plannedStartAt" <'));
      const iRollback = seq409.findIndex((s) => s === 'ROLLBACK');
      check('TX 409: overlap check runs on the transaction client, after the advisory lock', rejected.status === 409 && iLock >= 0 && iCheck > iLock);
      check('TX 409: no INSERT, then ROLLBACK, no COMMIT', !seq409.some((s) => s.startsWith('INSERT')) && iRollback > iCheck && !seq409.includes('COMMIT'));
      check('TX 409: BEGIN precedes the lock on the same client', seq409.findIndex((s) => s.startsWith('BEGIN')) <= iLock);
      log.length = 0;
      const accepted = await call(plansRoute, X.token, planBody('Order-200', at(D1, '09:30'), at(D1, '10:00'), { overlapPolicy: 'REJECT_ACTIVE_OVERLAP' }));
      const seq200 = log.filter((l) => l.client === clientSeq).map((l) => l.sql);
      const jLock = seq200.findIndex((s) => s.includes('pg_advisory_xact_lock'));
      const jCheck = seq200.findIndex((s) => s.includes('FROM "PlannedActivity"') && s.includes('"plannedStartAt" <'));
      const jInsert = seq200.findIndex((s) => s.startsWith('INSERT INTO "PlannedActivity"'));
      const jCommit = seq200.indexOf('COMMIT');
      check('TX 200: lock -> overlap check -> INSERT -> COMMIT, all on one client', accepted.status === 200 && jLock >= 0 && jCheck > jLock && jInsert > jCheck && jCommit > jInsert);
      log.length = 0;
      await call(plansRoute, X.token, planBody('Order-legacy', at(D1, '09:30'), at(D1, '10:00')));
      const seqLegacy = log.filter((l) => l.client === clientSeq).map((l) => l.sql);
      check('TX legacy (no policy): no overlap query at all, insert as before', !seqLegacy.some((s) => s.includes('"plannedStartAt" <')) && seqLegacy.some((s) => s.startsWith('INSERT INTO "PlannedActivity"')));
    } finally {
      db.beginTransaction = original;
    }
  } finally {
    await cleanup();
  }

  console.log(`\n${count} checks`);
  if (!allPassed) {
    console.log('SOME CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL CHECKS PASSED');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
