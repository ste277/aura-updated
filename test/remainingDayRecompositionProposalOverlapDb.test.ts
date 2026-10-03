/**
 * Schedule write consistency S4 -- Recomposition PROPOSAL-side blocker read, against a live DB and the REAL proposal
 * path (`handleRemainingDayRecompositionRequest` + `createRealRecompositionDeps` + the real Day Constructor
 * orchestrator, real availability/timing search). Requires DATABASE_URL (fresh, 43 migrations).
 *
 * THE DEFECT. The proposal loaded the user's plans with `listPlannedActivitiesForDay` (`plannedStartAt BETWEEN
 * dayStart AND dayEnd`) and used that same row set both to classify plans and as the Constructor's blockers. A plan
 * that STARTED BEFORE the target civil day but is still running into it (an overnight plan, a multi-day plan) was
 * neither a blocker nor listed as protected, so the proposal could pick, keep or judge feasible a slot inside it.
 *
 * THE RANGE. Recomposition asks about exactly one range: the target local civil day `[localDayBoundsUTC.from,
 * .to)`. The remaining-today construction window is always inside that day, so the orchestrator's own blocker bounds
 * (`resolveBlockerLoadBounds(dayBounds, window)`) equal it too. The fix loads plans with the canonical half-open
 * overlap loader over that range.
 *
 * Determinism: every scenario uses an explicit `now` (08:00 local on a fixed civil date) -- no wall clock. The real
 * route reads `new Date()`; this suite drives the handler the route is a one-line wrapper around, with the same real
 * dependencies, so the clock is the only difference.
 */
import {
  upsertUserByEmail, updateBirthProfile, getUserById, createPlannedActivity, beginTransaction, loadGoalContextsForPlanIds,
} from '../apps/web/lib/db';
import * as db from '../apps/web/lib/db';
import { createRealRecompositionDeps, handleRemainingDayRecompositionRequest } from '../apps/web/lib/remainingDayRecompositionServer';
import { acceptRemainingDayRecomposition, realRecompositionAcceptanceDeps } from '../apps/web/lib/remainingDayRecompositionAcceptance';
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

type Mode = 'FIXED' | 'FLEXIBLE';
type Status = 'UPCOMING' | 'LOGGED' | 'CANCELLED' | 'SKIPPED' | 'MOVED';
interface Zone { name: string; tz: string; date: string; label: string }
const IST: Zone = { name: 'ist', tz: 'Asia/Kolkata', date: '2026-10-14', label: 'Asia/Kolkata (no DST)' };
const LA_SPRING: Zone = { name: 'la-spring', tz: 'America/Los_Angeles', date: '2026-03-08', label: 'America/Los_Angeles spring-forward day (23h)' };
const LA_FALL: Zone = { name: 'la-fall', tz: 'America/Los_Angeles', date: '2026-11-01', label: 'America/Los_Angeles fall-back day (25h)' };
const NZ: Zone = { name: 'nz', tz: 'Pacific/Auckland', date: '2026-10-14', label: 'Pacific/Auckland (+13 DST)' };

const at = (z: Zone, date: string, hhmm: string) => localDateTimeToUTC(date, hhmm, z.tz);
const minutesBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60000);

async function makeUser(label: string, tz: string) {
  const U = await upsertUserByEmail({ email: `test-s4-${label}@example.com`, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: tz });
  await updateBirthProfile(U.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: tz });
  return U;
}

interface PlanSpec { title: string; start: Date; end: Date; mode: Mode | null; status?: Status }
async function insertPlans(userId: string, specs: PlanSpec[]) {
  const out: Record<string, any> = {};
  for (const s of specs) {
    const row = await createPlannedActivity({ userId, title: s.title, plannedStartAt: s.start, plannedEndAt: s.end, durationMinutes: minutesBetween(s.start, s.end), windowType: 'NEUTRAL', schedulingMode: s.mode } as any);
    if (s.status && s.status !== 'UPCOMING') {
      if (s.status === 'LOGGED') await sql(`UPDATE "PlannedActivity" SET status = 'LOGGED', "loggedAt" = $2 WHERE id = $1`, [row.id, s.start]);
      else if (s.status === 'SKIPPED') await sql(`UPDATE "PlannedActivity" SET status = 'SKIPPED', "skippedAt" = $2 WHERE id = $1`, [row.id, s.start]);
      else await sql(`UPDATE "PlannedActivity" SET status = $2 WHERE id = $1`, [row.id, s.status]);
    }
    out[s.title] = row;
  }
  return out;
}
const reset = (ids: string[]) => sql(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1)`, [ids]);

/** Calls recorded on the two loaders, so the suite can assert WHICH loader the proposal used and with WHAT range. */
const calls = { overlapping: [] as Array<{ userId: string; from: Date; to: Date; rows: number }>, forDay: 0 };
const realOverlapping = db.listPlannedActivitiesOverlappingRange;
const realForDay = db.listPlannedActivitiesForDay;
(db as any).listPlannedActivitiesOverlappingRange = async (userId: string, from: Date, to: Date, executor?: any) => {
  const rows = await realOverlapping(userId, from, to, executor);
  calls.overlapping.push({ userId, from, to, rows: rows.length });
  return rows;
};
(db as any).listPlannedActivitiesForDay = async (...args: Parameters<typeof realForDay>) => { calls.forDay += 1; return realForDay(...args); };

async function propose(userId: string, now: Date) {
  calls.overlapping.length = 0; calls.forDay = 0;
  const res = await handleRemainingDayRecompositionRequest({
    getSession: () => ({ userId }),
    getUser: (id) => getUserById(id),
    now: () => now,
    createDeps: createRealRecompositionDeps,
    loadGoalContexts: (id, planIds) => loadGoalContextsForPlanIds(id, planIds),
  });
  return { status: res.httpStatus, body: res.body as any, proposal: (res.body as any).proposal as any };
}
const protectedReason = (p: any, planId: string) => (p?.protectedPlans ?? []).find((x: any) => x.planId === planId)?.reason as string | undefined;
const decisionFor = (p: any, planId: string) => (p?.decisions ?? []).find((d: any) => d.planId === planId);
const overlapsRange = (a: { start: Date; end: Date }, b: { start: Date; end: Date }) => a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();

async function main() {
  try {
    const users: Record<string, any> = {};
    for (const z of [IST, LA_SPRING, LA_FALL, NZ]) users[z.name] = await makeUser(z.name, z.tz);
    const other = await makeUser('other', IST.tz);
    const allIds = [...Object.values(users).map((u: any) => u.id), other.id];
    await reset(allIds);

    const ctx = (z: Zone) => {
      const D = z.date; const P = addDaysToDateStr(D, -1); const N = addDaysToDateStr(D, 1);
      const bounds = localDayBoundsUTC(D, z.tz);
      return { D, P, N, bounds, now: at(z, D, '08:00'), user: users[z.name] as any };
    };
    /** The plan every scenario reconsiders: flexible, wholly inside today, after `now`. */
    const candidate = (z: Zone, hhmm = '12:00', endHhmm = '13:00'): PlanSpec => ({ title: 'Focus block', start: at(z, ctx(z).D, hhmm), end: at(z, ctx(z).D, endHhmm), mode: 'FLEXIBLE' });

    // ==================================================================================================
    console.log('=== CONTROL: no plan reaches into the day from outside -- the proposal is the reference for "unchanged" ===');
    {
      const c = ctx(IST);
      await reset(allIds);
      const rows = await insertPlans(c.user.id, [candidate(IST), { title: 'Board meeting', start: at(IST, c.D, '15:00'), end: at(IST, c.D, '16:00'), mode: 'FIXED' }]);
      const r = await propose(c.user.id, c.now);
      check('control: READY proposal from the real path with the real timing search', r.status === 200 && r.body.status === 'READY' && !!r.proposal);
      check('control: the candidate is decided and its current slot is feasible (no conflict-driven invalidity)', !!decisionFor(r.proposal, rows['Focus block'].id) && decisionFor(r.proposal, rows['Focus block'].id).evidence.currentSlotInvalid === undefined);
      check('control: the fixed plan is protected as SCHEDULING_MODE_NOT_FLEXIBLE', protectedReason(r.proposal, rows['Board meeting'].id) === 'SCHEDULING_MODE_NOT_FLEXIBLE');
      const again = await propose(c.user.id, c.now);
      check('control: the proposal is deterministic for a fixed clock (identical JSON apart from the signed token)', JSON.stringify({ ...r.body, proposalToken: undefined }) === JSON.stringify({ ...again.body, proposalToken: undefined }));
    }

    // ==================================================================================================
    console.log('=== PRIMARY DEFECT: an overnight blocker that started the PREVIOUS civil day ===');
    for (const z of [IST, LA_SPRING, LA_FALL, NZ]) {
      const c = ctx(z);
      await reset(allIds);
      const rows = await insertPlans(c.user.id, [
        { title: 'Overnight shift', start: at(z, c.P, '20:00'), end: at(z, c.D, '14:00'), mode: 'FIXED' },
        candidate(z),
      ]);
      const r = await propose(c.user.id, c.now);
      const o = rows['Overnight shift']; const f = rows['Focus block'];
      const d = decisionFor(r.proposal, f.id);
      const blocker = { start: new Date(o.plannedStartAt), end: new Date(o.plannedEndAt) };
      console.log(`   [diag] ${z.label}: protected=${JSON.stringify((r.proposal?.protectedPlans ?? []).map((p: any) => [p.title, p.reason]))} decision=${d?.decision} reason=${d?.reason} invalid=${d?.evidence?.currentSlotInvalid} to=${d?.to ? `${d.to.start}..${d.to.end}` : '-'}`);
      check(`[${z.label}] overnight UPCOMING blocker is protected as ACTIVE (it is running now) -- previously not even listed`, protectedReason(r.proposal, o.id) === 'ACTIVE');
      check(`[${z.label}] the candidate whose current slot lies INSIDE the overnight blocker is reported CURRENT_SLOT_INVALID / BLOCKED_OR_UNAVAILABLE`, !!d && d.evidence.currentSlotInvalid === 'BLOCKED_OR_UNAVAILABLE');
      check(`[${z.label}] no proposed destination overlaps the overnight blocker`, (r.proposal?.decisions ?? []).every((x: any) => x.decision !== 'MOVE' || !overlapsRange({ start: new Date(x.to.start), end: new Date(x.to.end) }, blocker)));
      check(`[${z.label}] the proposal used the canonical overlap loader exactly once, for the civil day [from,to), and never the start-scoped loader`, calls.overlapping.length === 1 && calls.overlapping[0].userId === c.user.id && calls.overlapping[0].from.getTime() === c.bounds.from.getTime() && calls.overlapping[0].to.getTime() === c.bounds.to.getTime() && calls.forDay === 0);
    }

    // ==================================================================================================
    console.log('=== SAME-DAY EARLY START: starts earlier on the SAME civil date, before `now`, and continues into the remaining window ===');
    {
      const c = ctx(IST);
      await reset(allIds);
      const rows = await insertPlans(c.user.id, [{ title: 'Early session', start: at(IST, c.D, '06:00'), end: at(IST, c.D, '12:30'), mode: 'FIXED' }, candidate(IST)]);
      const r = await propose(c.user.id, c.now);
      const d = decisionFor(r.proposal, rows['Focus block'].id);
      check('same-day early-start blocker (06:00-12:30, now 08:00) is protected ACTIVE and blocks the candidate at 12:00 (this was already correct: the civil-day loader reaches it; pinned as a regression guard)', protectedReason(r.proposal, rows['Early session'].id) === 'ACTIVE' && d?.evidence?.currentSlotInvalid === 'BLOCKED_OR_UNAVAILABLE');
    }

    // ==================================================================================================
    console.log('=== LIFECYCLE of an overlapping overnight row (reference instant = the request `now`) ===');
    {
      const c = ctx(IST);
      const base = { start: at(IST, c.P, '20:00'), end: at(IST, c.D, '14:00'), mode: 'FIXED' as Mode };
      const blocksCases: Array<[string, PlanSpec, boolean, string | undefined]> = [
        ['UPCOMING, still running (end 14:00 >= now 08:00)', { title: 'Lifecycle row', ...base }, true, 'ACTIVE'],
        ['LOGGED (always blocks; history is never listed as protected)', { title: 'Lifecycle row', ...base, end: at(IST, c.D, '13:30'), status: 'LOGGED' }, true, undefined],
        ['CANCELLED never blocks', { title: 'Lifecycle row', ...base, status: 'CANCELLED' }, false, undefined],
        ['SKIPPED never blocks', { title: 'Lifecycle row', ...base, status: 'SKIPPED' }, false, undefined],
        ['MOVED never blocks', { title: 'Lifecycle row', ...base, status: 'MOVED' }, false, undefined],
        ['UPCOMING already elapsed at `now` (end 06:00 < 08:00) does NOT block (MISSED; the overlap query can retrieve it, the lifecycle rule still decides)', { title: 'Lifecycle row', ...base, end: at(IST, c.D, '06:00') }, false, 'MISSED'],
      ];
      for (const [label, spec, blocks, expectedProtected] of blocksCases) {
        await reset(allIds);
        const rows = await insertPlans(c.user.id, [spec, candidate(IST)]);
        const r = await propose(c.user.id, c.now);
        const d = decisionFor(r.proposal, rows['Focus block'].id);
        const invalid = d?.evidence?.currentSlotInvalid === 'BLOCKED_OR_UNAVAILABLE';
        if (spec.status === 'LOGGED') { /* the LOGGED row ends at 13:30: the 12:00-13:00 candidate is inside it */ }
        check(`overnight ${label}: ${blocks ? 'BLOCKS the candidate' : 'does NOT block'}`, invalid === blocks);
        check(`overnight ${label}: protected-list entry is ${expectedProtected ?? 'none'}`, protectedReason(r.proposal, rows['Lifecycle row'].id) === expectedProtected);
      }
    }

    // ==================================================================================================
    console.log('=== CROSS-USER: another user\'s overlapping plan neither loads nor blocks ===');
    {
      const c = ctx(IST);
      await reset(allIds);
      const rows = await insertPlans(c.user.id, [candidate(IST)]);
      const theirs = await insertPlans(other.id, [{ title: 'Their overnight', start: at(IST, c.P, '20:00'), end: at(IST, c.D, '14:00'), mode: 'FIXED' }]);
      const r = await propose(c.user.id, c.now);
      check('cross-user: the other user\'s overnight plan neither blocks the candidate nor appears in the proposal', decisionFor(r.proposal, rows['Focus block'].id)?.evidence?.currentSlotInvalid === undefined && protectedReason(r.proposal, theirs['Their overnight'].id) === undefined);
    }

    // ==================================================================================================
    console.log('=== CIVIL-DAY BOUNDARIES (half-open [from, to)) ===');
    {
      const c = ctx(IST);
      const { from, to } = c.bounds;
      const cases: Array<[string, PlanSpec, string | undefined]> = [
        ['ends EXACTLY at the day start: does not overlap, not loaded', { title: 'b-left-exact', start: at(IST, c.P, '20:00'), end: from, mode: 'FIXED' }, undefined],
        ['ends ONE ms after the day start: overlaps, loaded (elapsed UPCOMING -> MISSED)', { title: 'b-left-plus1', start: at(IST, c.P, '20:00'), end: new Date(from.getTime() + 1), mode: 'FIXED' }, 'MISSED'],
        ['starts EXACTLY at the day end: does not overlap, not loaded', { title: 'b-right-exact', start: to, end: new Date(to.getTime() + 3600000), mode: 'FLEXIBLE' }, undefined],
        ['starts ONE ms before the day end and extends beyond: overlaps, loaded (OUTSIDE_TODAY)', { title: 'b-right-minus1', start: new Date(to.getTime() - 1), end: new Date(to.getTime() + 3600000), mode: 'FLEXIBLE' }, 'OUTSIDE_TODAY'],
        ['ENTIRELY BEFORE the day: not loaded', { title: 'b-before', start: at(IST, c.P, '10:00'), end: at(IST, c.P, '11:00'), mode: 'FIXED' }, undefined],
        ['ENTIRELY AFTER the day: not loaded', { title: 'b-after', start: at(IST, c.N, '10:00'), end: at(IST, c.N, '11:00'), mode: 'FIXED' }, undefined],
      ];
      for (const [label, spec, expected] of cases) {
        await reset(allIds);
        const rows = await insertPlans(c.user.id, [spec, candidate(IST)]);
        const r = await propose(c.user.id, c.now);
        check(`${label}: protected-list entry is ${expected ?? 'none'}`, protectedReason(r.proposal, rows[spec.title].id) === expected);
      }
      // FULL SPAN: starts the previous day and ends the next day -- it occupies the entire remaining day. Before S4 it was not
      // loaded at all, so the proposal behaved as if the day were free and proposed moves inside it.
      await reset(allIds);
      await insertPlans(c.user.id, [{ title: 'b-full-span', start: at(IST, c.P, '12:00'), end: at(IST, c.N, '12:00'), mode: 'FIXED' }, candidate(IST)]);
      const full = await propose(c.user.id, c.now);
      check('FULL SPAN blocker (starts before the day, ends after it) is loaded and consumes the whole remaining day: NO_USABLE_CAPACITY, no proposal, no token', full.status === 200 && full.body.status === 'NO_USABLE_CAPACITY' && full.proposal === undefined && full.body.proposalToken === undefined);
    }

    // ==================================================================================================
    console.log('=== MULTIPLE BLOCKERS, independent of row order; protected/candidate sets never duplicated ===');
    {
      const c = ctx(IST);
      const specs: PlanSpec[] = [
        { title: 'm-overnight', start: at(IST, c.P, '20:00'), end: at(IST, c.D, '10:00'), mode: 'FIXED' },
        { title: 'm-fixed-today', start: at(IST, c.D, '15:00'), end: at(IST, c.D, '16:00'), mode: 'FIXED' },
        { title: 'm-early', start: at(IST, c.D, '06:00'), end: at(IST, c.D, '09:00'), mode: 'FIXED' },
        { title: 'm-logged-overnight', start: at(IST, c.P, '22:00'), end: at(IST, c.D, '11:00'), mode: 'FIXED', status: 'LOGGED' },
        candidate(IST, '12:00', '13:00'),
        { title: 'Second flexible', start: at(IST, c.D, '17:00'), end: at(IST, c.D, '18:00'), mode: 'FLEXIBLE' },
        { title: 'm-straddles-midnight', start: at(IST, c.D, '23:00'), end: at(IST, c.N, '00:30'), mode: 'FLEXIBLE' },
      ];
      const results: string[] = [];
      for (const order of [specs, [...specs].reverse()]) {
        await reset(allIds);
        const rows = await insertPlans(c.user.id, order);
        const r = await propose(c.user.id, c.now);
        const norm = JSON.stringify({ ...r.body, proposalToken: undefined }, (k, v) => (v && typeof v === 'string' ? v.replace(new RegExp(Object.values(rows).map((x: any) => x.id).join('|'), 'g'), (m) => Object.keys(rows).find((t) => rows[t].id === m)!) : v));
        results.push(norm);
        const ids = (r.proposal.protectedPlans as any[]).map((p) => p.planId);
        check('protected plans are listed once each (no row appears twice)', new Set(ids).size === ids.length);
        check('a reconsidered plan is never also listed as protected', (r.proposal.decisions as any[]).every((d) => !ids.includes(d.planId)));
        check('the plan straddling the next midnight stays protected OUTSIDE_TODAY and the overnight plan ACTIVE', protectedReason(r.proposal, rows['m-straddles-midnight'].id) === 'OUTSIDE_TODAY' && protectedReason(r.proposal, rows['m-overnight'].id) === 'ACTIVE');
      }
      check('MULTIPLE blockers: the proposal is identical whichever order the rows were inserted (titles substituted for ids)', results[0] === results[1]);
    }

    // ==================================================================================================
    console.log('=== SELF-BLOCKING: a reconsidered plan never blocks itself, however it is loaded ===');
    {
      const c = ctx(IST);
      await reset(allIds);
      const rows = await insertPlans(c.user.id, [candidate(IST), { title: 'Second flexible', start: at(IST, c.D, '17:00'), end: at(IST, c.D, '18:00'), mode: 'FLEXIBLE' }]);
      const r = await propose(c.user.id, c.now);
      const d1 = decisionFor(r.proposal, rows['Focus block'].id); const d2 = decisionFor(r.proposal, rows['Second flexible'].id);
      check('with nothing else in the way, neither reconsidered plan is reported BLOCKED by its own (or the other\'s) current slot', d1?.evidence?.currentSlotInvalid === undefined && d2?.evidence?.currentSlotInvalid === undefined);
      check('each reconsidered plan has exactly one decision', r.proposal.decisions.length === 2 && new Set(r.proposal.decisions.map((d: any) => d.planId)).size === 2);
    }

    // ==================================================================================================
    console.log('=== ROW VOLUME, QUERY COUNT, READ-ONLY ===');
    {
      const c = ctx(IST);
      await reset(allIds);
      const history: PlanSpec[] = [];
      for (let i = 2; i < 160; i += 1) {
        const date = addDaysToDateStr(c.D, -i);
        history.push({ title: `history-${i}`, start: at(IST, date, '10:00'), end: at(IST, date, '11:00'), mode: 'FLEXIBLE', status: i % 3 === 0 ? 'LOGGED' : 'UPCOMING' });
      }
      const rows = await insertPlans(c.user.id, [...history, { title: 'Overnight shift', start: at(IST, c.P, '20:00'), end: at(IST, c.D, '14:00'), mode: 'FIXED' }, candidate(IST)]);
      const snapshot = async () => JSON.stringify(await sql(`SELECT * FROM "PlannedActivity" WHERE "userId" = $1 ORDER BY id`, [c.user.id]));
      const before = await snapshot();
      const t0 = process.hrtime.bigint();
      const r = await propose(c.user.id, c.now);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      const after = await snapshot();
      console.log(`   [info] 158 historical plans + 1 overnight + 1 candidate: overlap loader returned ${calls.overlapping[0]?.rows} rows; whole proposal ${ms.toFixed(0)} ms (informational, not an assertion)`);
      check('ROW VOLUME: with 158 historical plans, the overlap query returns ONLY the rows overlapping the day (the overnight plan and the candidate = 2), not the history', calls.overlapping.length === 1 && calls.overlapping[0].rows === 2);
      check('QUERY COUNT / no N+1: exactly ONE plan-blocker load for the whole proposal (every placement run reuses it)', calls.overlapping.length === 1 && calls.forDay === 0);
      check('the overnight blocker is still honored with 158 rows of history', protectedReason(r.proposal, rows['Overnight shift'].id) === 'ACTIVE');
      check('ZERO WRITES: every PlannedActivity column of every row is byte-identical after proposing', before === after);
    }

    // ==================================================================================================
    console.log('=== ACCEPTANCE STILL REVALIDATES INDEPENDENTLY ===');
    {
      const c = ctx(IST);
      await reset(allIds);
      const rows = await insertPlans(c.user.id, [{ title: 'Overnight shift', start: at(IST, c.P, '20:00'), end: at(IST, c.D, '10:00'), mode: 'FIXED' }, candidate(IST, '09:00', '10:00')]);
      const r = await propose(c.user.id, c.now);
      const d = decisionFor(r.proposal, rows['Focus block'].id);
      check('precondition: the overnight blocker makes the 09:00 candidate a CURRENT_SLOT_INVALID MOVE with a signed token', d?.decision === 'MOVE' && d.reason === 'CURRENT_SLOT_INVALID' && typeof r.body.proposalToken === 'string');
      if (d?.decision === 'MOVE') {
        const dest = { start: new Date(d.to.start), end: new Date(d.to.end) };
        await insertPlans(c.user.id, [{ title: 'Appeared after proposal', start: dest.start, end: dest.end, mode: 'FIXED' }]);
        const acc = await acceptRemainingDayRecomposition(c.user.id, r.body.proposalToken, { ...realRecompositionAcceptanceDeps, readClock: async () => c.now });
        const after = (await sql(`SELECT status FROM "PlannedActivity" WHERE id = $1`, [rows['Focus block'].id]))[0];
        check('acceptance re-reads persisted blockers at write time: a plan that appeared on the destination after the proposal makes it STALE (CONFLICT) and nothing moves', acc.status === 'STALE' && (acc as any).reason === 'CONFLICT' && after.status === 'UPCOMING');
      }
    }

    console.log(allPassed ? '\nALL RECOMPOSITION PROPOSAL OVERLAP DB CHECKS PASSED' : '\nSOME RECOMPOSITION PROPOSAL OVERLAP DB CHECKS FAILED');
    process.exitCode = allPassed ? 0 : 1;
  } finally {
    (db as any).listPlannedActivitiesOverlappingRange = realOverlapping;
    (db as any).listPlannedActivitiesForDay = realForDay;
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" IN (SELECT id FROM "User" WHERE email LIKE 'test-s4-%@example.com')`).catch(() => {});
    process.exit();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
