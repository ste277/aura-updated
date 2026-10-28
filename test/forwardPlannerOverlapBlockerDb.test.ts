/**
 * Scheduling read authority R2 -- Forward Planner persisted-plan conflict input, against a live DB and the REAL
 * `buildForwardPlannerResult` (the single function behind POST /api/forward-planner AND Ask Aura's forward-plan
 * answer). Requires DATABASE_URL (fresh, 43 migrations).
 *
 * THE DEFECT. Forward Planner loaded persisted plans with `listPlannedActivitiesForDay` (`plannedStartAt BETWEEN
 * rangeStart AND rangeEnd`). An UPCOMING plan that started BEFORE the requested range but was still running into it
 * was never loaded, so a candidate inside the user's own running commitment was still recommended.
 *
 * THE FIX UNDER TEST. The blocker load is the canonical half-open overlap loader over the UNION of the requested
 * civil-date range and the actual candidate extent (earliest candidate start .. latest candidate end), once per
 * request, and not at all when no candidate survives to be filtered. Policy is unchanged: only UPCOMING plans block.
 *
 * Every scenario uses an explicit clock (no wall clock). Test-only seams: the two db loaders are wrapped to record
 * their calls, and -- for the candidate-extent scenarios, which the current timing engine cannot produce -- the
 * package's `runTimingSearch` is wrapped so FIND can return a hand-built candidate. Nothing in production has a hook.
 */
import { upsertUserByEmail, updateBirthProfile, getUserById, createPlannedActivity, beginTransaction } from '../apps/web/lib/db';
import * as db from '../apps/web/lib/db';
import * as timing from '../packages/recommendation/src/timingSearch';
import { buildForwardPlannerRequest, buildForwardPlannerResult } from '../apps/web/lib/forwardPlannerOrchestrator';
import { localDayBoundsUTC } from '../apps/web/lib/myDayOrchestrator';
import { localDateTimeToUTC, addDaysToDateStr } from '../apps/web/lib/timezone';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
async function sql(t: string, p: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(t, p); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

interface Zone { name: string; tz: string }
const IST: Zone = { name: 'ist', tz: 'Asia/Kolkata' };
const LA: Zone = { name: 'la', tz: 'America/Los_Angeles' };
const NZ: Zone = { name: 'nz', tz: 'Pacific/Auckland' };
const at = (z: Zone, date: string, hhmm: string) => localDateTimeToUTC(date, hhmm, z.tz);
const loc = (z: Zone, d: Date | string) => new Intl.DateTimeFormat('en-GB', { timeZone: z.tz, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d));
const minutes = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60000);

async function makeUser(z: Zone, label: string) {
  const U = await upsertUserByEmail({ email: `test-r2-${z.name}-${label}@example.com`, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: z.tz });
  await updateBirthProfile(U.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: z.tz });
  return (await getUserById(U.id))!;
}
type Status = 'UPCOMING' | 'LOGGED' | 'CANCELLED' | 'SKIPPED' | 'MOVED';
async function plan(userId: string, title: string, start: Date, end: Date, status: Status = 'UPCOMING') {
  const row = await createPlannedActivity({ userId, title, plannedStartAt: start, plannedEndAt: end, durationMinutes: minutes(start, end), windowType: 'NEUTRAL', schedulingMode: 'FIXED' } as any);
  if (status === 'LOGGED') await sql(`UPDATE "PlannedActivity" SET status = 'LOGGED', "loggedAt" = $2 WHERE id = $1`, [row.id, start]);
  else if (status === 'SKIPPED') await sql(`UPDATE "PlannedActivity" SET status = 'SKIPPED', "skippedAt" = $2 WHERE id = $1`, [row.id, start]);
  else if (status !== 'UPCOMING') await sql(`UPDATE "PlannedActivity" SET status = $2 WHERE id = $1`, [row.id, status]);
  return row;
}
const reset = (ids: string[]) => sql(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1)`, [ids]);

// ---- test-only recording wrappers ----
const calls = { overlap: [] as Array<{ userId: string; from: Date; to: Date; rows: number }>, forDay: 0, find: 0 };
const realOverlap = db.listPlannedActivitiesOverlappingRange;
const realForDay = db.listPlannedActivitiesForDay;
const realFind = timing.runTimingSearch;
(db as any).listPlannedActivitiesOverlappingRange = async (userId: string, from: Date, to: Date, executor?: any) => {
  const rows = await realOverlap(userId, from, to, executor);
  calls.overlap.push({ userId, from, to, rows: rows.length });
  return rows;
};
(db as any).listPlannedActivitiesForDay = async (...args: Parameters<typeof realForDay>) => { calls.forDay += 1; return realForDay(...args); };
let findStub: ((request: any) => any) | null = null;
(timing as any).runTimingSearch = (request: any) => { calls.find += 1; return findStub && request.mode === 'FIND' ? findStub(request) : realFind(request); };

async function run(user: any, now: Date, body: Record<string, unknown>) {
  calls.overlap.length = 0; calls.forDay = 0; calls.find = 0;
  const v: any = buildForwardPlannerRequest(body, now, user.timezone);
  if (!v.ok) throw new Error(`request rejected: ${v.error}`);
  const result: any = await buildForwardPlannerResult(user, now, v.request);
  return { result, range: v.request.range as { startLocalDate: string; endLocalDate: string } };
}
const offered = (r: any, o: { start: string; end: string }) => (r.options ?? []).some((x: any) => x.start === o.start && x.end === o.end);
const norm = (r: any) => JSON.stringify(r);

async function main() {
  try {
    const U = await makeUser(IST, 'a');
    const V = await makeUser(IST, 'b');
    const LAU = await makeUser(LA, 'a');
    const NZU = await makeUser(NZ, 'a');
    const allIds = [U.id, V.id, LAU.id, NZU.id];
    await reset(allIds);

    const D = '2026-10-14'; const T = addDaysToDateStr(D, 1); const P = D;
    const now = at(IST, D, '08:00');
    const body = { activityId: 'deep-work', horizon: 'TOMORROW' };
    const bounds = localDayBoundsUTC(T, IST.tz);

    // ==================================================================================================
    console.log('=== PRIMARY FIXTURE: UPCOMING plan that STARTS the day before the requested range and overlaps the top option ===');
    const control = await run(U, now, body);
    const top = control.result.options?.[0];
    check('control (no plans): READY, one option on 15 Oct, the top option is 11:45-12:00 IST', control.result.status === 'READY' && control.result.options.length === 1 && loc(IST, top.start) === '15 Oct, 11:45' && loc(IST, top.end) === '15 Oct, 12:00');
    check('control: no candidate survives to need a plan, or the plan load is a single call (never more than one)', calls.overlap.length + calls.forDay <= 1);

    await reset(allIds);
    const overnight = await plan(U.id, 'Overnight prior-start', at(IST, P, '20:00'), at(IST, T, '12:30'));
    const primary = await run(U, now, body);
    console.log(`   [diag] primary: status=${primary.result.status} options=${(primary.result.options ?? []).map((o: any) => `${loc(IST, o.start)}-${loc(IST, o.end)}`).join(',')} overlapCalls=${JSON.stringify(calls.overlap.map((c) => c.rows))} startScopedCalls=${calls.forDay}`);
    check('PRIMARY: the prior-start plan (14 Oct 20:00 -> 15 Oct 12:30) is loaded: exactly one overlap load returning that one row, and the start-scoped loader is never called', calls.overlap.length === 1 && calls.overlap[0]?.rows === 1 && calls.forDay === 0);
    check('PRIMARY: the 11:45-12:00 option inside the user\'s own UPCOMING plan is NOT recommended', !offered(primary.result, top));
    check('PRIMARY: with no other suitable candidate the result is NO_SUITABLE_WINDOW', primary.result.status === 'NO_SUITABLE_WINDOW');
    check('the blocker load range is the requested civil range, derived with the canonical helper (the candidate lies inside it, so no widening)', calls.overlap[0]?.from.getTime() === bounds.from.getTime() && calls.overlap[0]?.to.getTime() === bounds.to.getTime());
    check('the load is scoped to the requesting user', calls.overlap[0]?.userId === U.id);

    console.log('=== SAME-DAY CONTROL, FULL SPAN, ELAPSED ===');
    await reset(allIds); await plan(U.id, 'Same-day', at(IST, T, '00:05'), at(IST, T, '12:30'));
    check('same-day UPCOMING plan covering the top option still excludes it (unchanged behavior)', (await run(U, now, body)).result.status === 'NO_SUITABLE_WINDOW');
    await reset(allIds); await plan(U.id, 'Full span', at(IST, P, '12:00'), at(IST, addDaysToDateStr(T, 1), '12:00'));
    const full = await run(U, now, body);
    check('FULL SPAN: a prior-day -> next-day UPCOMING plan loads once and no conflicting option survives', full.result.status === 'NO_SUITABLE_WINDOW' && calls.overlap.length === 1 && calls.overlap[0]?.rows === 1);
    await reset(allIds); await plan(U.id, 'Elapsed', at(IST, P, '20:00'), at(IST, P, '21:00'));
    const elapsed = await run(U, now, body);
    check('ELAPSED UPCOMING plan (ended before the range): not loaded, does not affect the result', offered(elapsed.result, top) && calls.overlap[0]?.rows === 0);

    console.log('=== LIFECYCLE of a prior-start overlapping row (policy unchanged: only UPCOMING blocks) ===');
    for (const [status, blocks] of [['UPCOMING', true], ['LOGGED', false], ['CANCELLED', false], ['SKIPPED', false], ['MOVED', false]] as const) {
      await reset(allIds); await plan(U.id, 'Lifecycle', at(IST, P, '20:00'), at(IST, T, '12:30'), status);
      const r = await run(U, now, body);
      check(`prior-start ${status} plan covering the option: ${blocks ? 'blocks it (NO_SUITABLE_WINDOW)' : 'does NOT block it (still offered)'}${status === 'LOGGED' ? ' -- existing policy preserved, recorded as separate policy debt' : ''}`, blocks ? !offered(r.result, top) : offered(r.result, top));
    }

    console.log('=== CROSS-USER ===');
    await reset(allIds); await plan(V.id, 'Someone else', at(IST, P, '20:00'), at(IST, T, '12:30'));
    const cross = await run(U, now, body);
    check('another user\'s covering prior-start plan is not loaded and does not affect the result', offered(cross.result, top) && calls.overlap[0]?.rows === 0);

    console.log('=== BOUNDARIES of the load range [requested from, requested to) ===');
    const cases: Array<[string, Date, Date, number]> = [
      ['ends EXACTLY at the range start: does not overlap', at(IST, P, '20:00'), bounds.from, 0],
      ['ends ONE ms after the range start: overlaps, loaded', at(IST, P, '20:00'), new Date(bounds.from.getTime() + 1), 1],
      ['starts EXACTLY at the range end: does not overlap (the old BETWEEN loaded it)', bounds.to, new Date(bounds.to.getTime() + 3600000), 0],
      ['starts ONE ms before the range end and extends beyond: loaded', new Date(bounds.to.getTime() - 1), new Date(bounds.to.getTime() + 3600000), 1],
      ['PRIOR-DAY FULL SPAN: loaded', at(IST, P, '12:00'), at(IST, addDaysToDateStr(T, 1), '12:00'), 1],
      ['ENTIRELY BEFORE the range: not loaded', at(IST, P, '10:00'), at(IST, P, '11:00'), 0],
      ['ENTIRELY AFTER the range: not loaded', at(IST, addDaysToDateStr(T, 1), '10:00'), at(IST, addDaysToDateStr(T, 1), '11:00'), 0],
    ];
    for (const [label, s, e, rows] of cases) {
      await reset(allIds); await plan(U.id, 'Boundary', s, e);
      await run(U, now, body);
      check(`${label}: ${rows} row(s) loaded`, calls.overlap.length === 1 && calls.overlap[0]?.rows === rows);
    }

    console.log('=== MULTIPLE BLOCKERS, MULTIPLE DATES, ONE QUERY ===');
    const weekBody = { activityId: 'deep-work', horizon: 'SEVEN_DAYS' };
    await reset(allIds);
    const weekControl = await run(U, now, weekBody);
    const weekOptions: any[] = weekControl.result.options ?? [];
    check('precondition: the seven-day control offers several dated options', weekControl.result.status === 'READY' && weekOptions.length >= 2);
    const first = weekOptions[0]; const second = weekOptions[1];
    const dateOf = (o: any) => new Intl.DateTimeFormat('en-CA', { timeZone: IST.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(o.start));
    const blockerA = (): [string, Date, Date] => ['Blocker A (prior-start)', at(IST, addDaysToDateStr(dateOf(first), -1), '20:00'), new Date(new Date(first.end).getTime() + 15 * 60000)];
    const blockerB = (): [string, Date, Date] => ['Blocker B (same-day)', new Date(new Date(second.start).getTime() - 15 * 60000), new Date(new Date(second.end).getTime() + 15 * 60000)];
    const outcomes: string[] = [];
    for (const order of [[blockerA, blockerB], [blockerB, blockerA]]) {
      await reset(allIds);
      for (const make of order) await plan(U.id, ...make());
      const r = await run(U, now, weekBody);
      outcomes.push(norm(r.result));
      check('SEVEN_DAYS: the options on both blocked dates (one by a prior-start plan, one by a same-day plan) are removed', !offered(r.result, first) && !offered(r.result, second));
      check('SEVEN_DAYS: ONE plan load covers every candidate date (no per-date query), both blockers returned', calls.overlap.length === 1 && calls.overlap[0]?.rows === 2 && calls.forDay === 0);
    }
    check('MULTIPLE blockers: the result is identical whichever order the rows were inserted', outcomes[0] === outcomes[1]);

    // ==================================================================================================
    console.log('=== CANDIDATE EXTENT: the load range is the union of the requested range and the actual candidate intervals ===');
    const template = (realFind({ mode: 'FIND', activityId: 'deep-work', durationMinutes: 30, dateRange: { start: T, end: T }, context: { now, latitude: U.latitude, longitude: U.longitude, timezone: IST.tz, tzOffsetMinutes: 330 } } as any) as any).candidates[0];
    check('precondition: a real FIND candidate is available as a template for hand-built candidates', !!template && !!template.start);
    const lastDay = T;
    const crossing = (start: Date, end: Date) => () => ({ candidates: [{ ...template, start: start.toISOString(), end: end.toISOString(), label: 'EXCELLENT', score: 99 }] });
    const bnd = localDayBoundsUTC(lastDay, IST.tz);
    // Past the requested END: 23:30 -> 00:30 next day. The engine cannot produce this today (2,856 candidates scanned in the audit never crossed), so it is injected.
    findStub = crossing(at(IST, lastDay, '23:30'), at(IST, addDaysToDateStr(lastDay, 1), '00:30'));
    await reset(allIds);
    const noBlocker = await run(U, now, body);
    check('hand-built candidate crossing the range END (23:30 -> 00:30): with no blocker it is recommended; the load range was widened to its end', noBlocker.result.status === 'READY' && calls.overlap.length === 1 && calls.overlap[0]?.from.getTime() === bnd.from.getTime() && calls.overlap[0]?.to.getTime() === at(IST, addDaysToDateStr(lastDay, 1), '00:30').getTime());
    await reset(allIds); await plan(U.id, 'Only in the extended tail', at(IST, addDaysToDateStr(lastDay, 1), '00:10'), at(IST, addDaysToDateStr(lastDay, 1), '01:00'));
    const tail = await run(U, now, body);
    check('a blocker overlapping ONLY the extended portion (starts at 00:10, after the requested range ends) is still loaded and filters the candidate', tail.result.status === 'NO_SUITABLE_WINDOW' && calls.overlap[0]?.rows === 1);
    await reset(allIds); await plan(U.id, 'Starts exactly at candidate end', at(IST, addDaysToDateStr(lastDay, 1), '00:30'), at(IST, addDaysToDateStr(lastDay, 1), '01:30'));
    const atEnd = await run(U, now, body);
    check('a blocker starting EXACTLY at the extended load end does not overlap: not loaded, candidate kept', atEnd.result.status === 'READY' && calls.overlap[0]?.rows === 0);
    await reset(allIds); await plan(U.id, 'One ms before candidate end', new Date(at(IST, addDaysToDateStr(lastDay, 1), '00:30').getTime() - 1), at(IST, addDaysToDateStr(lastDay, 1), '01:30'));
    check('a blocker starting ONE ms before the extended load end is loaded and filters the candidate', (await run(U, now, body)).result.status === 'NO_SUITABLE_WINDOW' && calls.overlap[0]?.rows === 1);
    // Before the requested START: previous evening -> 00:30 on the first date.
    findStub = crossing(at(IST, P, '23:30'), at(IST, T, '00:30'));
    await reset(allIds); await plan(U.id, 'Only in the head', at(IST, P, '23:00'), at(IST, P, '23:45'));
    const head = await run(U, now, body);
    check('candidate starting BEFORE the requested range: a blocker overlapping only that earlier portion is loaded (range widened at the start) and filters it', head.result.status === 'NO_SUITABLE_WINDOW' && calls.overlap.length === 1 && calls.overlap[0]?.from.getTime() === at(IST, P, '23:30').getTime() && calls.overlap[0]?.to.getTime() === bounds.to.getTime());
    // Inside the range: no widening.
    findStub = crossing(at(IST, T, '10:00'), at(IST, T, '10:30'));
    await reset(allIds);
    await run(U, now, body);
    check('a candidate wholly inside the requested range does NOT widen the load: the range is exactly the requested civil range', calls.overlap.length === 1 && calls.overlap[0]?.from.getTime() === bounds.from.getTime() && calls.overlap[0]?.to.getTime() === bounds.to.getTime());
    // Zero candidates.
    findStub = () => ({ candidates: [] });
    await reset(allIds); await plan(U.id, 'Irrelevant', at(IST, P, '20:00'), at(IST, T, '12:30'));
    const none = await run(U, now, body);
    check('ZERO candidates: NO_SUITABLE_WINDOW exactly as before, and the plan query is skipped (nothing to filter; no invented bounds)', none.result.status === 'NO_SUITABLE_WINDOW' && calls.overlap.length === 0 && calls.forDay === 0);
    findStub = null;

    // ==================================================================================================
    console.log('=== DST AND OTHER TIMEZONES (requested range derived with the canonical civil-date helpers) ===');
    const zoneCases: Array<[string, Zone, any, Date, Record<string, unknown>, string]> = [
      ['LA spring-forward day (23h)', LA, LAU, at(LA, '2026-03-05', '08:00'), { activityId: 'deep-work', horizon: 'CUSTOM', customStartDate: '2026-03-08', customEndDate: '2026-03-08' }, '2026-03-08'],
      ['LA fall-back day (25h)', LA, LAU, at(LA, '2026-10-29', '08:00'), { activityId: 'deep-work', horizon: 'CUSTOM', customStartDate: '2026-11-01', customEndDate: '2026-11-01' }, '2026-11-01'],
      ['Auckland tomorrow (+13 DST)', NZ, NZU, at(NZ, '2026-10-14', '08:00'), { activityId: 'deep-work', horizon: 'TOMORROW' }, '2026-10-15'],
      ['Auckland spring-forward day (23h)', NZ, NZU, at(NZ, '2026-09-24', '08:00'), { activityId: 'deep-work', horizon: 'CUSTOM', customStartDate: '2026-09-27', customEndDate: '2026-09-27' }, '2026-09-27'],
    ];
    for (const [label, z, user, nw, zb, rangeDate] of zoneCases) {
      await reset(allIds);
      const ctrl = await run(user, nw, zb);
      const o = ctrl.result.options?.[0];
      check(`[${label}] control: READY with an option on the requested date`, ctrl.result.status === 'READY' && !!o);
      if (!o) continue;
      await reset(allIds);
      await plan(user.id, 'Overnight prior-start', at(z, addDaysToDateStr(rangeDate, -1), '20:00'), new Date(new Date(o.end).getTime() + 30 * 60000));
      const r = await run(user, nw, zb);
      const b = localDayBoundsUTC(rangeDate, z.tz);
      check(`[${label}] the prior-start plan is loaded and the option inside it is not recommended (${loc(z, o.start)}-${loc(z, o.end)})`, !offered(r.result, o) && r.result.status === 'NO_SUITABLE_WINDOW' && calls.overlap.length === 1 && calls.overlap[0]?.rows === 1);
      check(`[${label}] the load range is the canonical civil day of the requested date (${(b.to.getTime() - b.from.getTime()) / 3600000}h)`, calls.overlap[0]?.from.getTime() === b.from.getTime() && calls.overlap[0]?.to.getTime() === b.to.getTime());
    }

    // ==================================================================================================
    console.log('=== ROW VOLUME, QUERY COUNT, READ-ONLY ===');
    await reset(allIds);
    const history: Promise<any>[] = [];
    for (let i = 2; i < 160; i += 1) { const d = addDaysToDateStr(D, -i); history.push(plan(U.id, `history-${i}`, at(IST, d, '10:00'), at(IST, d, '11:00'), i % 3 === 0 ? 'LOGGED' : 'UPCOMING')); }
    await Promise.all(history);
    await plan(U.id, 'Overnight prior-start', at(IST, P, '20:00'), at(IST, T, '12:30'));
    const snapshot = async () => JSON.stringify(await sql(`SELECT * FROM "PlannedActivity" WHERE "userId" = $1 ORDER BY id`, [U.id]));
    const before = await snapshot();
    const t0 = process.hrtime.bigint();
    const vol = await run(U, now, body);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const after = await snapshot();
    console.log(`   [info] 158 historical plans + 1 prior-start blocker: overlap loader returned ${calls.overlap[0]?.rows} row(s); whole request ${ms.toFixed(0)} ms (local characterization only)`);
    check('ROW VOLUME: with 158 historical plans the overlap query returns only the relevant prior-start blocker (1 row), not the history', calls.overlap.length === 1 && calls.overlap[0]?.rows === 1);
    check('the prior-start blocker is honored with 158 rows of history', vol.result.status === 'NO_SUITABLE_WINDOW');
    check('QUERY COUNT / no N+1: exactly one plan-blocker load for the whole request', calls.overlap.length === 1 && calls.forDay === 0);
    check('ZERO WRITES: every PlannedActivity column of every row is byte-identical after the request', before === after);

    console.log(allPassed ? '\nALL FORWARD PLANNER OVERLAP BLOCKER DB CHECKS PASSED' : '\nSOME FORWARD PLANNER OVERLAP BLOCKER DB CHECKS FAILED');
    process.exitCode = allPassed ? 0 : 1;
  } finally {
    (db as any).listPlannedActivitiesOverlappingRange = realOverlap;
    (db as any).listPlannedActivitiesForDay = realForDay;
    (timing as any).runTimingSearch = realFind;
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" IN (SELECT id FROM "User" WHERE email LIKE 'test-r2-%@example.com')`).catch(() => {});
  }
}

main().then(() => process.exit(), (err) => {
  console.error(err);
  process.exit(1);
});
