/**
 * Constructor scheduling correctness -- target-day OVERLAPPING plan
 * blockers (live database).
 *
 * THE DEFECT THIS PINS: the Constructor's real blocker loader used
 * `listPlannedActivitiesForDay`, which selects plans by `plannedStartAt`
 * within the civil day. A persisted active plan that STARTS before the day
 * but runs into it (overnight / multi-day) was never loaded, so the
 * Constructor could propose a new activity INSIDE an occupied interval.
 *
 * REQUIRED INVARIANT: any active plan interval that overlaps the
 * construction day/window blocks the overlapping portion, whichever civil
 * date the plan started on. Intervals are half-open [start, end).
 *
 * Everything below runs through the REAL production chain: real users,
 * persisted plans, the real blocker loader, the real orchestrator, real
 * timing search and the real constructDay, via the preview boundary wired as
 * route.ts wires it. The decisive assertions are mathematical (no proposed
 * interval overlaps any active blocker), not "the old slot disappeared".
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/dayConstructorOverlappingBlockerDb.test.ts
 */
import { upsertUserByEmail, updateBirthProfile, beginTransaction, replaceUserAvailabilityConfiguration, getUserById, createPlannedActivity } from '../apps/web/lib/db';
import { createRealDayConstructorOrchestratorDeps } from '../apps/web/lib/dayConstructorOrchestrator';
import { handleDayConstructorPreviewRequest } from '../apps/web/lib/dayConstructorPreviewRequest';
import { createRealOpportunityRangeDeps } from '../apps/web/lib/opportunityRangeRealDeps';
import { localDayBoundsUTC } from '../apps/web/lib/myDayOrchestrator';
import { localDateTimeToUTC } from '../apps/web/lib/timezone';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const KOLKATA = 'Asia/Kolkata';
const NEW_YORK = 'America/New_York';
const DATE = '2026-10-07'; // Wednesday
const MIN = 60000;

async function sql(text: string, params: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
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

async function main() {
  const mk = async (key: string, tz: string, lat: number, lon: number) => {
    const u = await upsertUserByEmail({ email: `test-ovl-${key}@example.com`, cityName: 'City', latitude: lat, longitude: lon, timezone: tz });
    await sql(`UPDATE "User" SET timezone = $1 WHERE id = $2`, [tz, u.id]);
    await updateBirthProfile(u.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'City', birthLatitude: lat, birthLongitude: lon, birthTimezone: tz });
    return u;
  };
  const K = await mk('kolkata', KOLKATA, 13.0827, 80.2707);
  const O = await mk('other', KOLKATA, 13.0827, 80.2707);
  const N = await mk('newyork', NEW_YORK, 40.7128, -74.006);
  const ids = [K.id, O.id, N.id];
  const workWeek = Array.from({ length: 7 }, (_, weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' }));
  const cleanup = async () => {
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "UserAvailabilityPeriod" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`UPDATE "User" SET "availabilityConfigured" = false WHERE id = ANY($1::text[])`, [ids]);
  };
  await cleanup();
  for (const u of [K, O, N]) await replaceUserAvailabilityConfiguration(u.id, workWeek);

  const at = (date: string, hhmm: string, tz: string) => localDateTimeToUTC(date, hhmm, tz);
  const kAt = (date: string, hhmm: string) => at(date, hhmm, KOLKATA);
  let seq = 0;
  /** A real persisted plan over an exact absolute interval. */
  const plan = async (user: U, start: Date, end: Date, status = 'UPCOMING') => {
    const p = await createPlannedActivity({ userId: user.id, title: `ovl-${seq++}`, plannedStartAt: start, plannedEndAt: end, durationMinutes: Math.max(1, Math.round((end.getTime() - start.getTime()) / MIN)), windowType: 'NEUTRAL' });
    if (status !== 'UPCOMING') await sql(`UPDATE "PlannedActivity" SET status = $2 WHERE id = $1`, [p.id, status]);
    return p;
  };
  const clear = (user: U) => sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [user.id]);
  const planCount = async () => (await sql(`SELECT count(*)::int n FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])`, [ids]))[0].n as number;

  /** The real production preview boundary, wired as route.ts wires it; counts blocker loads. */
  const counters = { blockerLoads: 0, lastBounds: undefined as undefined | { from: Date; to: Date } };
  const preview = async (user: U, now: Date, intents: unknown[], extraBody: Record<string, unknown> = {}) => {
    const r = await handleDayConstructorPreviewRequest({
      getSession: () => ({ userId: user.id }),
      getUser: (id) => getUserById(id),
      getBody: async () => ({ intents, ...extraBody }),
      now: () => now,
      createOrchestratorDeps: (u, n) => {
        const real = createRealDayConstructorOrchestratorDeps(u, n);
        return {
          ...real,
          loadBlockingPlans: async (bounds) => {
            counters.blockerLoads += 1;
            counters.lastBounds = bounds;
            return real.loadBlockingPlans(bounds);
          },
        };
      },
      createOpportunityRangeDeps: (u: any) => createRealOpportunityRangeDeps(u),
    });
    return { httpStatus: r.httpStatus, body: JSON.parse(JSON.stringify(r.body)) };
  };
  const intent = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: `Task ${id}`, activityId: 'workout', durationMinutes: 60, flexibility: 'FLEXIBLE', ...extra });
  const dayOf = (body: any) => body.preview.constructedDay;
  const proposed = (body: any): Array<{ start: Date; end: Date }> => dayOf(body).proposedItems.map((p: any) => ({ start: new Date(p.start), end: new Date(p.end) }));
  const blocked = (body: any): number => dayOf(body).requestedCapacity.blockedMinutes;
  /** Mathematical non-overlap: for every proposed interval and every blocker, proposed.start >= blocker.end OR proposed.end <= blocker.start. */
  const noOverlap = (props: Array<{ start: Date; end: Date }>, blockers: Array<{ start: Date; end: Date }>) => props.every((p) => blockers.every((b) => p.start.getTime() >= b.end.getTime() || p.end.getTime() <= b.start.getTime()));
  /** The real target-day loader, the real way the orchestrator calls it. */
  const loader = (user: U, now: Date) => createRealDayConstructorOrchestratorDeps(user as any, now);
  const loadDay = async (user: U, date: string, now: Date) => (await loader(user, now).loadBlockingPlans(localDayBoundsUTC(date, user.timezone))).map((p) => `${p.start.getTime()}-${p.end.getTime()}:${p.status}`);
  const key = (s: Date, e: Date, status = 'UPCOMING') => `${s.getTime()}-${e.getTime()}:${status}`;

  const NOW = kAt(DATE, '09:00'); // Wednesday 09:00 IST: no now-clipping of the contested hours
  const dayFrom = kAt(DATE, '00:00');
  const dayTo = kAt('2026-10-08', '00:00');

  try {
    // ============================================================
    console.log('=== PRIMARY: persisted overnight plan 2026-10-06 20:00 IST -> 2026-10-07 12:00 IST ===');
    const ovStart = kAt('2026-10-06', '20:00');
    const ovEnd = kAt(DATE, '12:00');
    await plan(K, ovStart, ovEnd);
    const rowsBefore = await planCount();
    const loaded = await loadDay(K, DATE, NOW);
    check('TARGET-DAY LOADER returns the overnight plan although it STARTED the previous civil day', loaded.includes(key(ovStart, ovEnd)));
    const pr = await preview(K, NOW, [intent('A')]);
    const props = proposed(pr.body);
    check('the real preview is READY and proposes something to place (the assertion below is not vacuous)', pr.httpStatus === 200 && pr.body.status === 'READY' && props.length >= 1);
    check('NO proposed interval overlaps the overnight blocker: for every proposal, start >= blocker end OR end <= blocker start', noOverlap(props, [{ start: ovStart, end: ovEnd }]));
    check('the overnight plan reduces usable capacity by exactly the overlapping part (09:00-12:00 = 180 of 480 window minutes)', blocked(pr.body) === 180 && dayOf(pr.body).requestedCapacity.constructionWindowMinutes === 480);
    check('a proposal can only start at or after the blocker end (12:00 IST)', props.every((p) => p.start.getTime() >= ovEnd.getTime()));
    check('the Constructor consults the blocker loader exactly ONCE per preview (no N+1, query count unchanged)', await (async () => { counters.blockerLoads = 0; await preview(K, NOW, [intent('A'), intent('B', { importance: 'LOW' }), intent('C')]); return counters.blockerLoads === 1; })());
    check('the orchestrator hands the loader the USER\'S civil-day bounds (00:00 IST to next 00:00 IST), whatever the process timezone is', await (async () => { counters.lastBounds = undefined; await preview(K, NOW, [intent('A')]); const b = counters.lastBounds as { from: Date; to: Date } | undefined; return !!b && b.from.getTime() === dayFrom.getTime() && b.to.getTime() === dayTo.getTime(); })());
    check('preview writes nothing: the plan row count is unchanged', (await planCount()) === rowsBefore);
    await clear(K);

    // ============================================================
    console.log('=== boundary semantics: half-open [start, end), at millisecond precision ===');
    {
      const cases: Array<[string, Date, Date, boolean]> = [
        ['prior-day plan ending midday', kAt('2026-10-06', '22:00'), kAt(DATE, '12:00'), true],
        ['multi-day plan starting 3 days earlier and ending after the day starts', kAt('2026-10-04', '20:00'), kAt(DATE, '11:00'), true],
        ['plan spanning the WHOLE day (starts before, ends after)', kAt('2026-10-06', '12:00'), kAt('2026-10-08', '12:00'), true],
        ['plan EXACTLY matching the day [00:00, 24:00)', dayFrom, dayTo, true],
        ['ordinary same-day plan (starts inside, ends inside)', kAt(DATE, '10:00'), kAt(DATE, '11:00'), true],
        ['plan starting inside and running past the day end', kAt(DATE, '22:00'), kAt('2026-10-08', '02:00'), true],
        ['plan ending EXACTLY at the day start does NOT overlap', kAt('2026-10-06', '20:00'), dayFrom, false],
        ['plan starting EXACTLY at the day end does NOT overlap (the old BETWEEN query returned it)', dayTo, kAt('2026-10-08', '03:00'), false],
        ['plan ending ONE millisecond after the day start overlaps', kAt('2026-10-06', '20:00'), new Date(dayFrom.getTime() + 1), true],
        ['plan starting ONE millisecond before the day end overlaps', new Date(dayTo.getTime() - 1), kAt('2026-10-08', '03:00'), true],
        ['plan entirely BEFORE the day is not returned', kAt('2026-10-05', '10:00'), kAt('2026-10-05', '12:00'), false],
        ['plan entirely AFTER the day is not returned', kAt('2026-10-09', '10:00'), kAt('2026-10-09', '12:00'), false],
      ];
      for (const [label, s, e, expected] of cases) {
        await clear(K);
        await plan(K, s, e);
        check(`${label}: ${expected ? 'returned' : 'NOT returned'}`, (await loadDay(K, DATE, NOW)).includes(key(s, e)) === expected);
      }
      await clear(K);
      const z = kAt(DATE, '14:00');
      await plan(K, z, z); // a zero-length row is representable at the storage level (the plans API rejects it)
      const zr = await preview(K, NOW, [intent('A')]);
      check('a ZERO-LENGTH plan never creates blocking: capacity is untouched and the day still builds', blocked(zr.body) === 0 && proposed(zr.body).length >= 1);
      await clear(K);
      await plan(K, kAt('2026-10-06', '20:00'), kAt(DATE, '10:00'));
      await plan(K, kAt(DATE, '10:00'), kAt(DATE, '12:00')); // touches the first at exactly 10:00
      const adj = await preview(K, NOW, [intent('A')]);
      check('ADJACENT plans touching at a boundary merge into one stretch: blocked is exactly 180 minutes (no phantom gap, no double count)', blocked(adj.body) === 180 && noOverlap(proposed(adj.body), [{ start: kAt('2026-10-06', '20:00'), end: kAt(DATE, '12:00') }]));
      await clear(K);
      const o1s = kAt('2026-10-06', '20:00');
      const o2s = kAt('2026-10-06', '23:00');
      await plan(K, o1s, kAt(DATE, '10:00'));
      await plan(K, o2s, kAt(DATE, '12:00'));
      await plan(K, kAt('2026-10-06', '21:00'), kAt(DATE, '09:30'));
      const multi = await loadDay(K, DATE, NOW);
      check('MULTIPLE overnight blockers are ALL returned (no first-row behaviour)', multi.length === 3);
      const mr = await preview(K, NOW, [intent('A')]);
      check('and together they block exactly 09:00-12:00 (180 minutes), proposals clear of all of them', blocked(mr.body) === 180 && noOverlap(proposed(mr.body), [{ start: o1s, end: kAt(DATE, '12:00') }]));
    }

    // ============================================================
    console.log('=== isolation: other users, lifecycle ===');
    await clear(K);
    await plan(O, ovStart, ovEnd);
    check('another USER\'s overnight plan never blocks (not returned, no capacity effect)', (await loadDay(K, DATE, NOW)).length === 0 && blocked((await preview(K, NOW, [intent('A')])).body) === 0);
    await clear(O);
    for (const [status, expectBlocks] of [['UPCOMING', true], ['LOGGED', true], ['CANCELLED', false], ['SKIPPED', false], ['MOVED', false]] as const) {
      await clear(K);
      await plan(K, ovStart, ovEnd, status);
      const r = await preview(K, NOW, [intent('A')]);
      check(`${status} overnight plan: ${expectBlocks ? 'BLOCKS (180 minutes)' : 'does NOT block'} -- current lifecycle preserved`, blocked(r.body) === (expectBlocks ? 180 : 0) && noOverlap(proposed(r.body), expectBlocks ? [{ start: ovStart, end: ovEnd }] : []));
    }
    await clear(K);
    await plan(K, ovStart, ovEnd, 'CANCELLED');
    check('a CANCELLED plan is excluded at the query level too (not even returned)', !(await loadDay(K, DATE, NOW)).some((k) => k.startsWith(`${ovStart.getTime()}-`)));

    // ============================================================
    console.log('=== availability modes ===');
    await clear(K);
    await plan(K, ovStart, ovEnd);
    await replaceUserAvailabilityConfiguration(K.id, []);
    const empty = await preview(K, NOW, [intent('A')]);
    check('CONFIGURED EMPTY availability: still no new placement', empty.body.status === 'NO_USABLE_CAPACITY' || proposed(empty.body).length === 0);
    await sql(`UPDATE "User" SET "availabilityConfigured" = false WHERE id = $1`, [K.id]);
    const unconf = await preview(K, NOW, [intent('A')]);
    check('UNCONFIGURED availability keeps its existing today semantics (window now -> end of day) and the overnight plan still blocks 09:00-12:00', unconf.body.status === 'READY' && noOverlap(proposed(unconf.body), [{ start: ovStart, end: ovEnd }]) && blocked(unconf.body) === 180);
    await replaceUserAvailabilityConfiguration(K.id, workWeek);

    // ============================================================
    console.log('=== explicit construction window ===');
    const evening = { constructionWindowSource: 'EXPLICIT_RANGE', explicitStart: kAt(DATE, '18:00').toISOString(), explicitEnd: kAt(DATE, '22:00').toISOString() };
    const er = await preview(K, NOW, [intent('A')], evening);
    check('a plan overlapping the civil day but NOT the actual window does not reduce usable capacity (clipped away): blocked 0 of 240', er.body.status === 'READY' && blocked(er.body) === 0 && dayOf(er.body).requestedCapacity.constructionWindowMinutes === 240);
    await clear(K);
    const nightPlanStart = kAt('2026-10-08', '01:00');
    const nightPlanEnd = kAt('2026-10-08', '02:30');
    await plan(K, nightPlanStart, nightPlanEnd);
    const cross = { constructionWindowSource: 'EXPLICIT_RANGE', explicitStart: kAt(DATE, '22:00').toISOString(), explicitEnd: kAt('2026-10-08', '03:00').toISOString() };
    const cr = await preview(K, NOW, [intent('A')], cross);
    check('a window that CROSSES midnight sees a plan that starts on the NEXT civil day inside the window: blocked exactly 90 of 300 minutes', cr.body.status === 'READY' && blocked(cr.body) === 90 && dayOf(cr.body).requestedCapacity.constructionWindowMinutes === 300);
    check('and no proposal overlaps it', noOverlap(proposed(cr.body), [{ start: nightPlanStart, end: nightPlanEnd }]));
    await clear(K);

    // ============================================================
    console.log('=== row volume: only overlapping rows are returned ===');
    for (let i = 1; i <= 80; i++) {
      await plan(K, kAt(addDays(DATE, -i - 1), '10:00'), kAt(addDays(DATE, -i - 1), '11:00'));
      await plan(K, kAt(addDays(DATE, i + 1), '10:00'), kAt(addDays(DATE, i + 1), '11:00'));
    }
    await plan(K, ovStart, ovEnd);
    const vol = await loadDay(K, DATE, NOW);
    check('160 historical/future plans plus one overnight plan: the target-day loader returns exactly the 1 overlapping row', vol.length === 1 && vol[0] === key(ovStart, ovEnd));
    await clear(K);

    // ============================================================
    console.log('=== parity with the O2 range loader: one overlap definition ===');
    await plan(K, ovStart, ovEnd);
    await plan(K, kAt(DATE, '13:00'), kAt(DATE, '14:00'));
    await plan(K, kAt(DATE, '23:00'), kAt('2026-10-08', '01:00'));
    const bounds = localDayBoundsUTC(DATE, KOLKATA);
    const range = (await createRealOpportunityRangeDeps((await getUserById(K.id))!).loadPlansOverlappingRange(bounds)).map((p) => `${p.start.getTime()}-${p.end.getTime()}:${p.status}`).sort();
    const target = (await loadDay(K, DATE, NOW)).sort();
    check('for the same bounds the Constructor target-day loader and the O2 range loader return the same plans', range.length === 3 && JSON.stringify(range) === JSON.stringify(target));
    await clear(K);

    // ============================================================
    console.log('=== DST: a New York civil day that is not 24 hours long ===');
    for (const [label, date, prevDate, expectHours] of [
      ['SPRING FORWARD (2027-03-14, 23-hour day)', '2027-03-14', '2027-03-13', 23],
      ['FALL BACK (2026-11-01, 25-hour day)', '2026-11-01', '2026-10-31', 25],
    ] as const) {
      const b = localDayBoundsUTC(date, NEW_YORK);
      check(`${label}: the civil day is ${expectHours} hours (no 24h arithmetic)`, (b.to.getTime() - b.from.getTime()) / (60 * MIN) === expectHours);
      await clear(N);
      const s = at(prevDate, '22:00', NEW_YORK);
      const e = at(date, '11:00', NEW_YORK);
      await plan(N, s, e);
      const nNow = at(date, '08:00', NEW_YORK);
      const window = { constructionWindowSource: 'EXPLICIT_RANGE', explicitStart: at(date, '09:00', NEW_YORK).toISOString(), explicitEnd: at(date, '17:00', NEW_YORK).toISOString() };
      check(`${label}: the overnight plan is returned by the target-day loader`, (await loadDay(N, date, nNow)).includes(key(s, e)));
      const r = await preview(N, nNow, [intent('A')], window);
      check(`${label}: it blocks exactly the overlapping 09:00-11:00 (120 of 480 minutes) and no proposal overlaps it`, r.body.status === 'READY' && blocked(r.body) === 120 && proposed(r.body).length >= 1 && noOverlap(proposed(r.body), [{ start: s, end: e }]));
    }
    await clear(N);

    if (!allPassed) {
      console.error('SOME OVERLAPPING BLOCKER DB CHECKS FAILED');
      process.exit(1);
    }
    console.log('ALL OVERLAPPING BLOCKER DB CHECKS PASSED');
  } finally {
    await cleanup();
  }
}

function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
