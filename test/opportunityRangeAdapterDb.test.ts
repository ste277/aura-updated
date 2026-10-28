/**
 * Opportunity Scarcity V1 -- O2 range adapter, live-database proof of the
 * REAL user-scoped wiring (opportunityRangeRealDeps.ts) and the new
 * overlap query (listPlannedActivitiesOverlappingRange): half-open overlap
 * semantics, lifecycle filtering via the canonical rule, cross-user
 * isolation, one query per range regardless of length, and zero writes.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/opportunityRangeAdapterDb.test.ts
 */
import { upsertUserByEmail, beginTransaction, createPlannedActivity, replaceUserAvailabilityConfiguration, getUserById, listPlannedActivitiesOverlappingRange } from '../apps/web/lib/db';
import { loadOpportunityRangeInputs, type OpportunityRangeDeps } from '../apps/web/lib/opportunityRangeAdapter';
import { createRealOpportunityRangeDeps } from '../apps/web/lib/opportunityRangeRealDeps';
import { localDateTimeToUTC } from '../apps/web/lib/timezone';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const iso = (s: string) => new Date(s);
const NOW = iso('2026-10-05T00:00:00Z');

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

async function main() {
  const a = await upsertUserByEmail({ email: 'test-o2-range-a@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const b = await upsertUserByEmail({ email: 'test-o2-range-b@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const c = await upsertUserByEmail({ email: 'test-o2-range-c@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const ids = [a.id, b.id, c.id];
  const cleanup = async () => {
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "UserAvailabilityPeriod" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`UPDATE "User" SET "availabilityConfigured" = false WHERE id = ANY($1::text[])`, [ids]);
  };
  await cleanup();

  try {
    // A: Mon + Wed 09:00-12:00. B: Tue 09:00-17:00 only. C: never configured.
    await replaceUserAvailabilityConfiguration(a.id, [{ weekday: 1, startTime: '09:00', endTime: '12:00' }, { weekday: 3, startTime: '09:00', endTime: '12:00' }]);
    await replaceUserAvailabilityConfiguration(b.id, [{ weekday: 2, startTime: '09:00', endTime: '17:00' }]);

    // Range: IST 2026-10-06 .. 2026-10-07 inclusive = [2026-10-05T18:30Z, 2026-10-07T18:30Z)
    const FROM = localDateTimeToUTC('2026-10-06', '00:00', TZ);
    const TO = localDateTimeToUTC('2026-10-08', '00:00', TZ);
    const off = (base: Date, hours: number) => new Date(base.getTime() + hours * 3600000);
    let seq = 0;
    const addPlan = async (userId: string, title: string, start: Date, end: Date, status?: string) => {
      const p = await createPlannedActivity({ userId, title: `${title}-${seq++}`, plannedStartAt: start, plannedEndAt: end, durationMinutes: Math.round((end.getTime() - start.getTime()) / 60000), windowType: 'NEUTRAL' });
      if (status) await sql(`UPDATE "PlannedActivity" SET status = $2 WHERE id = $1`, [p.id, status]);
      return p;
    };
    const p = {
      startsBefore: await addPlan(a.id, 'starts-before', off(FROM, -1), off(FROM, 1)),
      inside: await addPlan(a.id, 'inside', off(FROM, 10), off(FROM, 11)),
      endsAfter: await addPlan(a.id, 'ends-after', off(TO, -1), off(TO, 1)),
      spans: await addPlan(a.id, 'spans-range', off(FROM, -3), off(TO, 3)),
      endsAtFrom: await addPlan(a.id, 'ends-at-from', off(FROM, -2), FROM),
      startsAtTo: await addPlan(a.id, 'starts-at-to', TO, off(TO, 1)),
      cancelled: await addPlan(a.id, 'cancelled', off(FROM, 20), off(FROM, 21), 'CANCELLED'),
      skipped: await addPlan(a.id, 'skipped', off(FROM, 22), off(FROM, 23), 'SKIPPED'),
      logged: await addPlan(a.id, 'logged', off(FROM, 24), off(FROM, 25), 'LOGGED'),
      moved: await addPlan(a.id, 'moved', off(FROM, 26), off(FROM, 27), 'MOVED'),
      other: await addPlan(b.id, 'other-user-inside', off(FROM, 12), off(FROM, 13)),
    };

    console.log('=== OVERLAP QUERY (half-open, user-scoped) ===');
    const rows = await listPlannedActivitiesOverlappingRange(a.id, FROM, TO);
    const returned = new Set(rows.map((r) => r.id));
    check('plan starting BEFORE the range and ending inside it is returned (the day query would miss it)', returned.has(p.startsBefore.id));
    check('plan inside, plan starting inside and ending after, and a plan spanning the whole range are returned', returned.has(p.inside.id) && returned.has(p.endsAfter.id) && returned.has(p.spans.id));
    check('plans merely TOUCHING the range (end == from, start == to) are not returned (half-open)', !returned.has(p.endsAtFrom.id) && !returned.has(p.startsAtTo.id));
    check('CANCELLED plans are excluded by the query (same SQL filter as the day query)', !returned.has(p.cancelled.id));
    check('SKIPPED/LOGGED/MOVED rows ARE returned by the query -- lifecycle is applied by the canonical rule, not in SQL', returned.has(p.skipped.id) && returned.has(p.logged.id) && returned.has(p.moved.id));
    check('another user\'s plan inside the same range is never returned (user-scoped)', !returned.has(p.other.id));
    check('results are ordered by start', rows.every((r, i) => i === 0 || new Date(rows[i - 1].plannedStartAt).getTime() <= new Date(r.plannedStartAt).getTime()));

    console.log('=== END TO END: REAL DEPS -> ADAPTER ===');
    const userA = (await getUserById(a.id))!;
    const result = await loadOpportunityRangeInputs({ startDate: '2026-10-06', endDate: '2026-10-07', timezone: TZ, now: NOW }, createRealOpportunityRangeDeps(userA));
    check('adapter returns OK for the authenticated user', result.status === 'OK');
    const inputs = result.status === 'OK' ? result.inputs : undefined;
    const blockerKey = (x: { start: Date; end: Date }) => `${x.start.toISOString()}..${x.end.toISOString()}`;
    const blockerSet = new Set((inputs?.blockers ?? []).map(blockerKey));
    const key = (pl: { plannedStartAt: Date; plannedEndAt: Date }) => blockerKey({ start: new Date(pl.plannedStartAt), end: new Date(pl.plannedEndAt) });
    check('active UPCOMING plans block (starts-before, inside, ends-after, spanning)', [p.startsBefore, p.inside, p.endsAfter, p.spans].every((pl) => blockerSet.has(key(pl))));
    check('LOGGED blocks', blockerSet.has(key(p.logged)));
    check('SKIPPED, MOVED and CANCELLED never block (canonical lifecycle)', ![p.skipped, p.moved, p.cancelled].some((pl) => blockerSet.has(key(pl))));
    check('exactly the 5 active overlapping plans are blockers; touching/other-user plans are absent', inputs?.blockers.length === 5 && !blockerSet.has(key(p.other)) && !blockerSet.has(key(p.endsAtFrom)) && !blockerSet.has(key(p.startsAtTo)));
    check('blockers are tagged as fixed plans regardless of any scheduling mode', (inputs?.blockers ?? []).every((x) => x.source === 'FIXED_PLAN'));

    const dayA = (d: string) => inputs?.availabilityByDate.get(d);
    check('user A Tuesday (no window in A\'s template) is KNOWN EMPTY -- B\'s Tuesday template did not leak in', dayA('2026-10-06')?.kind === 'KNOWN' && (dayA('2026-10-06') as any).windows.length === 0);
    check('user A Wednesday has A\'s own 09:00-12:00 IST window', dayA('2026-10-07')?.kind === 'KNOWN' && (dayA('2026-10-07') as any).windows.length === 1 && (dayA('2026-10-07') as any).windows[0].start.toISOString() === localDateTimeToUTC('2026-10-07', '09:00', TZ).toISOString());

    const userB = (await getUserById(b.id))!;
    const resultB = await loadOpportunityRangeInputs({ startDate: '2026-10-06', endDate: '2026-10-07', timezone: TZ, now: NOW }, createRealOpportunityRangeDeps(userB));
    const inB = resultB.status === 'OK' ? resultB.inputs : undefined;
    check('user B sees only B\'s template (Tuesday 09:00-17:00) and only B\'s plan', (inB?.availabilityByDate.get('2026-10-06') as any)?.windows?.length === 1 && inB?.blockers.length === 1 && blockerKey(inB.blockers[0]) === key(p.other));
    check('cross-user: B\'s result contains none of A\'s plans', (inB?.blockers ?? []).every((x) => !blockerSet.has(blockerKey(x)) || blockerKey(x) === key(p.other)));

    const userC = (await getUserById(c.id))!;
    const resultC = await loadOpportunityRangeInputs({ startDate: '2026-10-06', endDate: '2026-10-07', timezone: TZ, now: NOW }, createRealOpportunityRangeDeps(userC));
    check('an unconfigured user (real DB flag false) is UNKNOWN for every date, with no plans', resultC.status === 'OK' && [...resultC.inputs.availabilityByDate.values()].every((d) => d.kind === 'UNKNOWN') && resultC.inputs.blockers.length === 0);

    console.log('=== QUERY COUNT (real deps, counted) ===');
    const counted = async (start: string, end: string) => {
      const real = createRealOpportunityRangeDeps(userA);
      const counts = { availability: 0, plans: 0 };
      const deps: OpportunityRangeDeps = {
        loadAvailabilityConfiguration: () => ((counts.availability += 1), real.loadAvailabilityConfiguration()),
        loadPlansOverlappingRange: (bounds) => ((counts.plans += 1), real.loadPlansOverlappingRange(bounds)),
      };
      const r = await loadOpportunityRangeInputs({ startDate: start, endDate: end, timezone: TZ, now: NOW }, deps);
      return { ...counts, days: r.status === 'OK' ? r.inputs.availabilityByDate.size : -1 };
    };
    const one = await counted('2026-10-06', '2026-10-06');
    const two = await counted('2026-10-06', '2026-10-07');
    const seven = await counted('2026-10-06', '2026-10-12');
    check('1 day: one availability load + one plan query', one.availability === 1 && one.plans === 1 && one.days === 1);
    check('2 days: still one + one', two.availability === 1 && two.plans === 1 && two.days === 2);
    check('7 days: still one + one (query count independent of the number of days)', seven.availability === 1 && seven.plans === 1 && seven.days === 7);

    console.log('=== ZERO WRITES ===');
    const snapshot = async () =>
      JSON.stringify(
        await sql(
          `SELECT (SELECT count(*)::int FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])) AS plans, (SELECT count(*)::int FROM "UserAvailabilityPeriod" WHERE "userId" = ANY($1::text[])) AS periods, (SELECT count(*)::int FROM "GoalActivityOccurrence" WHERE "userId" = ANY($1::text[])) AS occ, (SELECT string_agg(id || status || "updatedAt"::text, ',' ORDER BY id) FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])) AS plan_state, (SELECT string_agg(id::text || "availabilityConfigured"::text, ',' ORDER BY id) FROM "User" WHERE id = ANY($1::text[])) AS user_state`,
          [ids]
        )
      );
    const before = await snapshot();
    for (const [s, e] of [['2026-10-06', '2026-10-06'], ['2026-10-06', '2026-10-12']]) await counted(s, e);
    await loadOpportunityRangeInputs({ startDate: '2026-10-06', endDate: '2026-10-07', timezone: TZ, now: NOW }, createRealOpportunityRangeDeps(userB));
    check('plans, availability periods, availability flags, occurrences and plan rows (incl. updatedAt) are byte-identical after repeated adaptation', (await snapshot()) === before);

    if (!allPassed) {
      console.error('SOME OPPORTUNITY RANGE ADAPTER DB CHECKS FAILED');
      process.exit(1);
    }
    console.log('ALL OPPORTUNITY RANGE ADAPTER DB CHECKS PASSED');
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
