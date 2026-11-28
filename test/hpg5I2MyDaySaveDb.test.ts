/**
 * AURA-HPG5-V2-I2 (R1-05) -- the My Day story card's recommended-time save,
 * end to end against a REAL disposable database: the real client save
 * function (saveUpcomingPlanFromCandidate, the one MyDayStoryCard calls)
 * talking to the REAL POST /api/plans and POST /api/timing-search handlers
 * through an in-process fetch shim (no network, no dev server).
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/hpg5I2MyDaySaveDb.test.ts
 *
 * Disposable database only: synthetic `@e2e.aura.local` users, everything
 * written is deleted on exit. Searches TOMORROW (Asia/Kolkata) so today-
 * clipping never interferes; the route treats TODAY and TOMORROW identically
 * apart from the date (the My Day FIND body itself is pinned by the jsdom suite).
 */
import { upsertUserByEmail, beginTransaction } from '../apps/web/lib/db';

import { localDateTimeToUTC, getDatePartsInTimezone, addDaysToDateStr } from '../apps/web/lib/timezone';
import { POST as plansRoute } from '../apps/web/app/api/plans/route';
import { POST as timingSearchRoute } from '../apps/web/app/api/timing-search/route';
import { createTestSessionToken, TEST_SESSION_COOKIE } from './authSessionTestSupport';

const { saveUpcomingPlanFromCandidate, PlanOverlapSaveError } = require('../apps/web/components/PlanWithAuraView');

let allPassed = true;
let count = 0;
function check(label: string, condition: boolean) {
  count++;
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const TZ = 'Asia/Kolkata';
const rawBegin: typeof beginTransaction = require('../apps/web/lib/db').beginTransaction;
async function sql(text: string, params: unknown[] = []): Promise<any[]> {
  const c = await rawBegin();
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

// ---- in-process fetch shim: the browser client -> the real route handlers ----
let currentToken: string | undefined;
const routes: Record<string, (req: any) => Promise<Response>> = { '/api/plans': plansRoute as any, '/api/timing-search': timingSearchRoute as any };
(global as any).fetch = async (url: string, opts?: any) => {
  const route = routes[url];
  if (!route || (opts?.method ?? 'GET').toUpperCase() !== 'POST') throw new Error(`unrouted ${url}`);
  const body = JSON.parse(opts.body);
  const token = currentToken;
  return route({ cookies: { get: (n: string) => (token !== undefined && n === TEST_SESSION_COOKIE ? { value: token } : undefined) }, json: async () => body, headers: new Headers() });
};

const today = getDatePartsInTimezone(TZ, new Date()).dateStr;
const D1 = addDaysToDateStr(today, 1);
const at = (d: string, hhmm: string) => localDateTimeToUTC(d, hhmm, TZ);
const overlaps = (s: string, e: string, a: string, b: string) => new Date(s).getTime() < new Date(b).getTime() && new Date(a).getTime() < new Date(e).getTime();

async function main() {
  const tag = `i2-${Date.now()}`;
  const mk = async (k: string) => {
    const u = await upsertUserByEmail({ email: `hpg5i2-${k}-${tag}@e2e.aura.local`, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
    await sql(`UPDATE "User" SET timezone = $1 WHERE id = $2`, [TZ, u.id]);
    return { ...u, token: await createTestSessionToken(u.id, u.email) };
  };
  const A = await mk('a');
  const B = await mk('b');
  const C = await mk('c');
  const ids = [A.id, B.id, C.id];
  const rows = async (id: string) => sql(`SELECT id, title, "plannedStartAt", "plannedEndAt", "activityId" FROM "PlannedActivity" WHERE "userId" = $1 ORDER BY "createdAt"`, [id]);
  const competitor = async (token: string, title: string, start: string, end: string) => {
    currentToken = token;
    const r = await (global as any).fetch('/api/plans', { method: 'POST', body: JSON.stringify({ title, activityType: title, plannedStartAt: start, plannedEndAt: end, durationMinutes: Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000), windowType: 'NEUTRAL' }) });
    return r.status;
  };
  const myDayFind = async (token: string) => {
    currentToken = token;
    const r = await (global as any).fetch('/api/timing-search', { method: 'POST', body: JSON.stringify({ mode: 'FIND', activityId: 'workout', durationMinutes: 45, horizon: 'TOMORROW', limit: 3 }) });
    return r.json();
  };
  try {
    // ---- 1. valid recommendation, then a competing plan, then the stale save ----
    const rec = await myDayFind(A.token);
    const pick = rec.candidates?.[0];
    check('setup: My Day FIND returns a recommendation', !!pick);
    check('recommendation is valid when made: overlaps no existing plan', (await rows(A.id)).length === 0);
    check('competing plan created after the recommendation (another tab/device)', (await competitor(A.token, 'Dentist', pick.start, pick.end)) === 200);
    const beforeStale = (await rows(A.id)).length;
    currentToken = A.token;
    let caught: any = null;
    try {
      await saveUpcomingPlanFromCandidate(pick, 45, { overlapPolicy: 'REJECT_ACTIVE_OVERLAP' });
    } catch (e) {
      caught = e;
    }
    check('stale My Day save is rejected with a typed PLAN_OVERLAP error', caught instanceof PlanOverlapSaveError);
    check('the error names the competing plan and its exact time', caught?.conflict?.title === 'Dentist' && caught?.conflict?.plannedStartAt === new Date(pick.start).toISOString());
    check('the error carries the exact refused proposal (same instants as the recommendation)', caught?.proposed?.plannedStartAt === pick.start && caught?.proposed?.plannedEndAt === pick.end);
    check('NO database write on rejection', (await rows(A.id)).length === beforeStale);

    // ---- 2. the fresh search no longer offers the conflicting slot ----
    const rec2 = await myDayFind(A.token);
    check('Choose another time: a fresh FIND excludes the competing plan', rec2.candidates.length > 0 && rec2.candidates.every((c: any) => !overlaps(c.start, c.end, pick.start, pick.end)));

    // ---- 3. explicit Save anyway: same payload, ALLOW -> exactly one row ----
    currentToken = A.token;
    const saved = await saveUpcomingPlanFromCandidate(pick, 45, { overlapPolicy: 'ALLOW' });
    const afterAnyway = await rows(A.id);
    check('Save anyway (ALLOW) writes exactly one plan at the refused time', afterAnyway.length === beforeStale + 1 && saved.plannedStartAt === pick.start);
    check('identity unchanged vs. the legacy My Day save: no goal occurrence created', Number((await sql(`SELECT count(*)::int n FROM "GoalActivityOccurrence" WHERE "userId" = $1`, [A.id]))[0].n) === 0);

    // ---- 4. legacy (no option) callers unchanged ----
    currentToken = A.token;
    const legacyStart = at(D1, '21:00').toISOString();
    const legacyEnd = at(D1, '21:45').toISOString();
    await competitor(A.token, 'Call', legacyStart, legacyEnd);
    let legacyErr: any = null;
    try {
      await saveUpcomingPlanFromCandidate({ ...pick, start: legacyStart, end: legacyEnd }, 45);
    } catch (e) {
      legacyErr = e;
    }
    check('a caller that omits overlapPolicy still saves an explicit overlap (S2 contract)', legacyErr === null);

    // ---- 5. concurrency: two tabs, both REJECT, same slot ----
    const raceStart = at(D1, '06:00').toISOString();
    const raceEnd = at(D1, '06:45').toISOString();
    currentToken = B.token;
    const results = await Promise.allSettled([
      saveUpcomingPlanFromCandidate({ ...pick, start: raceStart, end: raceEnd }, 45, { overlapPolicy: 'REJECT_ACTIVE_OVERLAP' }),
      saveUpcomingPlanFromCandidate({ ...pick, start: raceStart, end: raceEnd }, 45, { overlapPolicy: 'REJECT_ACTIVE_OVERLAP' }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const refused = results.filter((r) => r.status === 'rejected' && (r as PromiseRejectedResult).reason instanceof PlanOverlapSaveError).length;
    check('two simultaneous My Day saves for one slot -> exactly one saved, one PLAN_OVERLAP', ok === 1 && refused === 1);
    check('exactly one row written by the race', (await rows(B.id)).length === 1);

    // ---- 6. plan changed between recommendation and save ----
    const moveTarget = (await rows(B.id))[0];
    await sql(`UPDATE "PlannedActivity" SET status = 'CANCELLED' WHERE id = $1`, [moveTarget.id]);
    currentToken = B.token;
    const intoFreed = await saveUpcomingPlanFromCandidate({ ...pick, start: raceStart, end: raceEnd }, 45, { overlapPolicy: 'REJECT_ACTIVE_OVERLAP' });
    check('blocking plan cancelled after the recommendation -> REJECT save succeeds', !!intoFreed?.id);

    // ---- 7. cross-user isolation ----
    currentToken = C.token;
    const cSaved = await saveUpcomingPlanFromCandidate(pick, 45, { overlapPolicy: 'REJECT_ACTIVE_OVERLAP' });
    check("another user's plans never block or appear in a My Day save", !!cSaved?.id && (await rows(C.id)).length === 1);

    // ---- 8. expired / invalid session ----
    currentToken = 'not-a-real-session';
    let authErr: any = null;
    try {
      await saveUpcomingPlanFromCandidate({ ...pick, start: at(D1, '12:00').toISOString(), end: at(D1, '12:45').toISOString() }, 45, { overlapPolicy: 'REJECT_ACTIVE_OVERLAP' });
    } catch (e) {
      authErr = e;
    }
    check('invalid session: generic failure (not a conflict), nothing written for anyone', authErr instanceof Error && !(authErr instanceof PlanOverlapSaveError) && (await rows(C.id)).length === 1);

    // ---- 9. malformed overlapPolicy reaching the server ----
    currentToken = C.token;
    let badErr: any = null;
    try {
      await saveUpcomingPlanFromCandidate({ ...pick, start: at(D1, '13:00').toISOString(), end: at(D1, '13:45').toISOString() }, 45, { overlapPolicy: 'reject' as any });
    } catch (e) {
      badErr = e;
    }
    check('malformed overlapPolicy -> 400 generic failure, nothing written', badErr instanceof Error && !(badErr instanceof PlanOverlapSaveError) && (await rows(C.id)).length === 1);
  } finally {
    await sql(`DELETE FROM "GoalActivityOccurrence" WHERE "userId" = ANY($1::text[])`, [ids]).catch(() => {});
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "User" WHERE id = ANY($1::text[])`, [ids]).catch(() => {});
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
