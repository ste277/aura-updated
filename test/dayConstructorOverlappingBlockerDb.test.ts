/**
 * Regression -- a Plan that STARTS before the planning window but runs into it
 * (an overnight / multi-day Plan) must block the Constructor (live database).
 *
 * The real blocker loaders used `listPlannedActivitiesForDay`, which selects by
 * `plannedStartAt` alone, so such a Plan was invisible: the real preview
 * proposed an item INSIDE the existing Plan, and the real acceptance guard
 * would have saved it. Both loaders now use the half-open overlap query
 * (`listPlannedActivitiesOverlappingRange`). Lifecycle filtering
 * (`isActivePlanBlocker`) is unchanged and still decides which statuses block.
 *
 *   real user (Asia/Kolkata) + configured availability Mon-Fri 09:00-17:00 +
 *   persisted Plan 2026-10-06 20:00 -> 2026-10-07 12:00 IST, planning date
 *   2026-10-07 (now 09:00 IST):
 *     - the real preview boundary (as route.ts wires it) must not propose
 *       anything before 12:00 IST;
 *     - the real acceptance transaction must REJECT an item at 10:30-11:30 IST
 *       as a CONFLICT with a fresh blocker.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/dayConstructorOverlappingBlockerDb.test.ts
 */
import {
  upsertUserByEmail,
  updateBirthProfile,
  beginTransaction,
  replaceUserAvailabilityConfiguration,
  getUserById,
  createPlannedActivity,
} from '../apps/web/lib/db';
import { createRealDayConstructorOrchestratorDeps } from '../apps/web/lib/dayConstructorOrchestrator';
import { handleDayConstructorPreviewRequest } from '../apps/web/lib/dayConstructorPreviewRequest';
import { loadGoalDecisionFacts } from '../apps/web/lib/goalDecisionFactsProvider';
import { createRealOpportunityRangeDeps } from '../apps/web/lib/opportunityRangeRealDeps';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import { localDateTimeToUTC } from '../apps/web/lib/timezone';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const TZ = 'Asia/Kolkata';
const DATE = '2026-10-07'; // Wednesday
const PREV = '2026-10-06'; // Tuesday

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
  const user = await upsertUserByEmail({ email: 'test-overlapping-blocker@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await sql(`UPDATE "User" SET timezone = $1 WHERE id = $2`, [TZ, user.id]);
  await updateBirthProfile(user.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  const availability = () => replaceUserAvailabilityConfiguration(user.id, [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })));
  const clearPlans = () => sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [user.id]);
  const cleanup = async () => {
    await sql(`DELETE FROM "PlanCreationClaim" WHERE "userId" = $1`, [user.id]).catch(() => {});
    await clearPlans();
    await sql(`DELETE FROM "UserAvailabilityPeriod" WHERE "userId" = $1`, [user.id]);
    await sql(`UPDATE "User" SET "availabilityConfigured" = false WHERE id = $1`, [user.id]);
  };
  await cleanup();
  await availability();

  const now = localDateTimeToUTC(DATE, '09:00', TZ);
  const iso = (date: string, hhmm: string) => localDateTimeToUTC(date, hhmm, TZ);
  const plan = async (from: [string, string], to: [string, string], status = 'UPCOMING') => {
    const p = await createPlannedActivity({ userId: user.id, title: `busy-${from.join('T')}`, plannedStartAt: iso(...from), plannedEndAt: iso(...to), durationMinutes: 60, windowType: 'NEUTRAL' });
    if (status !== 'UPCOMING') await sql(`UPDATE "PlannedActivity" SET status = $2 WHERE id = $1`, [p.id, status]);
    return p;
  };
  const planCount = async () => (await sql(`SELECT count(*)::int n FROM "PlannedActivity" WHERE "userId" = $1`, [user.id]))[0].n as number;

  /** The real production preview boundary, wired as route.ts wires it. */
  const preview = async (durationMinutes = 60) => {
    const result = await handleDayConstructorPreviewRequest({
      getSession: () => ({ userId: user.id }),
      getUser: (id) => getUserById(id),
      getBody: async () => ({ intents: [{ id: 'A', title: 'Task A', activityId: 'workout', durationMinutes, flexibility: 'FLEXIBLE' }] }),
      now: () => now,
      createOrchestratorDeps: createRealDayConstructorOrchestratorDeps,
      loadDecisionFacts: (u, request) => loadGoalDecisionFacts(u, request),
      createOpportunityRangeDeps: (u: any) => createRealOpportunityRangeDeps(u),
    });
    const body = JSON.parse(JSON.stringify(result.body));
    return { httpStatus: result.httpStatus as number, body, proposed: (body.preview?.constructedDay?.proposedItems ?? []) as Array<{ start: string; end: string }> };
  };
  const accept = (start: Date, end: Date) =>
    persistAcceptedConstructedDay(
      user.id,
      {
        clientRequestId: `overlap-blocker-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        constructionWindow: { date: DATE, start: iso(DATE, '09:00'), end: iso(DATE, '17:00'), timezone: TZ, source: 'EXPLICIT_RANGE' as const },
        proposedItems: [{ intentId: 'A', title: 'Task A', start, end, placementSource: 'SELECTED_CANDIDATE' as const, activityId: 'workout' }],
      },
      now
    );

  try {
    console.log('=== PREVIEW: an overnight Plan that started the evening before blocks the morning ===');
    await plan([PREV, '20:00'], [DATE, '12:00']);
    const overnight = await preview();
    check('preview is READY', overnight.httpStatus === 200 && overnight.body.status === 'READY');
    check('the 60-minute item is still proposed (the afternoon is free)', overnight.proposed.length === 1);
    check('no proposed item overlaps the overnight Plan (nothing starts before 12:00 IST)', overnight.proposed.every((p) => new Date(p.start).getTime() >= iso(DATE, '12:00').getTime()));
    const cap = overnight.body.preview?.constructedDay?.requestedCapacity;
    check('capacity counts the overnight Plan as blocked time (09:00-12:00 = 180 of 480 minutes)', cap?.blockedMinutes === 180 && cap?.usableMinutes === 300);

    console.log('=== PREVIEW: a Plan ending exactly at the window start does not block (half-open) ===');
    await clearPlans();
    await plan([PREV, '20:00'], [DATE, '09:00']);
    const touching = await preview();
    check('a Plan ending 09:00 leaves the whole day usable (blocked 0)', touching.body.preview?.constructedDay?.requestedCapacity?.blockedMinutes === 0);

    console.log('=== PREVIEW: lifecycle filtering is unchanged ===');
    await clearPlans();
    await plan([PREV, '20:00'], [DATE, '12:00'], 'CANCELLED');
    const cancelled = await preview();
    check('a CANCELLED overnight Plan does not block', cancelled.body.preview?.constructedDay?.requestedCapacity?.blockedMinutes === 0);
    await clearPlans();
    await plan([PREV, '20:00'], [DATE, '12:00'], 'LOGGED');
    const logged = await preview();
    check('a LOGGED overnight Plan blocks like UPCOMING (same as in-day LOGGED plans)', logged.body.preview?.constructedDay?.requestedCapacity?.blockedMinutes === 180);

    console.log('=== PREVIEW: a Plan starting inside the day still blocks (no regression) ===');
    await clearPlans();
    await plan([DATE, '10:00'], [DATE, '12:00']);
    const inDay = await preview();
    check('an in-day Plan 10:00-12:00 blocks 120 minutes and nothing is proposed inside it', inDay.body.preview?.constructedDay?.requestedCapacity?.blockedMinutes === 120 && inDay.proposed.every((p) => new Date(p.end).getTime() <= iso(DATE, '10:00').getTime() || new Date(p.start).getTime() >= iso(DATE, '12:00').getTime()));

    console.log('=== ACCEPTANCE: the fresh-blocker guard sees the overnight Plan too ===');
    await clearPlans();
    await plan([PREV, '20:00'], [DATE, '12:00']);
    const before = await planCount();
    const rejected = await accept(iso(DATE, '10:30'), iso(DATE, '11:30'));
    check('accepting an item at 10:30-11:30 IST inside the overnight Plan is REJECTED as a CONFLICT', rejected.status === 'REJECTED' && rejected.reason === 'CONFLICT');
    check('...and nothing was written', (await planCount()) === before);
    const free = await accept(iso(DATE, '13:00'), iso(DATE, '14:00'));
    check('control: an item after the overnight Plan ends (13:00-14:00) is SAVED', free.status === 'SAVED');

    if (!allPassed) {
      console.error('SOME OVERLAPPING-BLOCKER DB CHECKS FAILED');
      process.exit(1);
    }
    console.log('ALL OVERLAPPING-BLOCKER DB CHECKS PASSED');
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
