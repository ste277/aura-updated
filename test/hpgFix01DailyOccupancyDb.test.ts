// AURA-HPG-FIX-01 -- real-Postgres test for the read-only daily-occupancy
// loader (listGoalActivityDailyOccupancyForActivities) that feeds V1-05
// (Home / Plan My Day "already scheduled today") and the weekly-proposal fix.
//
// Contract: for every GoalActivity and day it must agree with the
// acceptance-time guard checkDailyOccurrenceEligibility (OCCUPIED <=> day
// present), across UPCOMING, LOGGED, SKIPPED, CANCELLED and MOVED plans,
// and it must be user-scoped. Also pins the weekly-proposal root cause:
// the rhythm FACTS' localDate is the scheduled WEEK start, not the day.
//
// Requires DATABASE_URL (CI: day-constructor-acceptance-db-tests job).
import {
  upsertUserByEmail,
  createGoalWithActivities,
  addGoalActivity,
  logPlannedActivity,
  skipPlannedActivity,
  cancelPlannedActivity,
  beginTransaction,
  checkDailyOccurrenceEligibility,
  listGoalActivityDailyOccupancyForActivities,
  loadGoalActivityRhythmFactsForActivities,
} from '../apps/web/lib/db';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import type { AcceptConstructedDayRequest } from '../apps/web/lib/dayConstructorAcceptance';
import { movePlannedActivity } from '../apps/web/lib/planMove';
import { loadEligibleGoalDemand, createRealGoalDemandCandidatesDeps } from '../apps/web/lib/goalDemandCandidates';
import { fixtureAnchorMonday, addCivilDays, realClockReferenceForFixture } from './lifecycleFixtureCalendar';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const ANCHOR_MONDAY = fixtureAnchorMonday(realClockReferenceForFixture(), TZ);
const TUE = addCivilDays(ANCHOR_MONDAY, 1);
const WED = addCivilDays(ANCHOR_MONDAY, 2);
const THU = addCivilDays(ANCHOR_MONDAY, 3);

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

async function guardSays(userId: string, goalActivityId: string, day: string): Promise<string> {
  const c = await beginTransaction();
  try {
    return (await checkDailyOccurrenceEligibility(userId, goalActivityId, day, TZ, null, c)).status;
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    c.release();
  }
}

const setRhythm = (goalActivityId: string, targetPerWeek: number) =>
  sql(`UPDATE "GoalActivity" SET "rhythmKind" = 'N_PER_WEEK', "rhythmTargetPerWeek" = $1 WHERE id = $2`, [targetPerWeek, goalActivityId]);

async function main() {
  const user = await upsertUserByEmail({ email: 'test-hpg-fix-01-occupancy@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const other = await upsertUserByEmail({ email: 'test-hpg-fix-01-occupancy-other@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const ids = [user.id, other.id];
  const cleanup = async () => {
    await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = NULL WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`UPDATE "PlannedActivity" SET "rescheduledFromPlanId" = NULL WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "PlanCreationIdempotency" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "GoalActivity" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "Goal" WHERE "userId" = ANY($1::text[])`, [ids]);
  };
  await cleanup();

  async function occurrence(ownerId: string, goalActivityId: string, intentId: string, day: string, hourUtc: string) {
    const req: AcceptConstructedDayRequest = {
      clientRequestId: `hpg-fix-01-${ANCHOR_MONDAY}-${intentId}`,
      constructionWindow: { date: day, start: new Date(`${day}T00:30:00Z`), end: new Date(`${day}T17:30:00Z`), timezone: TZ, source: 'EXPLICIT_RANGE' as const },
      proposedItems: [{ intentId, title: 'Run', placementSource: 'SELECTED_CANDIDATE', start: new Date(`${day}T${hourUtc}:00Z`), end: new Date(`${day}T${hourUtc.slice(0, 2)}:30:00Z`) }],
    };
    const out = await persistAcceptedConstructedDay(ownerId, req, new Date(`${day}T00:00:00Z`), new Map([[intentId, goalActivityId]]));
    if (out.status !== 'SAVED') throw new Error(`fixture save failed: ${JSON.stringify(out)}`);
    return (out as any).plans[0].id as string;
  }

  try {
    const { goal } = await createGoalWithActivities({ userId: user.id, title: 'Run (HPG-FIX-01 fixture)', targetDate: null, activities: [] });
    const { goal: otherGoal } = await createGoalWithActivities({ userId: other.id, title: 'Other user goal', targetDate: null, activities: [] });

    const gaUpcoming = (await addGoalActivity(user.id, goal.id, { title: 'Run A', activityId: null }))!.id;
    const gaLogged = (await addGoalActivity(user.id, goal.id, { title: 'Run B', activityId: null }))!.id;
    const gaSkipped = (await addGoalActivity(user.id, goal.id, { title: 'Run C', activityId: null }))!.id;
    const gaCancelled = (await addGoalActivity(user.id, goal.id, { title: 'Run D', activityId: null }))!.id;
    const gaMoved = (await addGoalActivity(user.id, goal.id, { title: 'Run E', activityId: null }))!.id;
    const gaOther = (await addGoalActivity(other.id, otherGoal.id, { title: 'Other run', activityId: null }))!.id;
    for (const id of [gaUpcoming, gaLogged, gaSkipped, gaCancelled, gaMoved, gaOther]) await setRhythm(id, 3);

    await occurrence(user.id, gaUpcoming, 'i-up', TUE, '04');
    await logPlannedActivity(user.id, await occurrence(user.id, gaLogged, 'i-log', TUE, '05'));
    await skipPlannedActivity(user.id, await occurrence(user.id, gaSkipped, 'i-skip', TUE, '06'));
    await cancelPlannedActivity(user.id, await occurrence(user.id, gaCancelled, 'i-cancel', TUE, '07'));
    const movedPlan = await occurrence(user.id, gaMoved, 'i-move', TUE, '08');
    const moved = await movePlannedActivity(user.id, movedPlan, { newStartAt: new Date(`${WED}T08:00:00Z`) });
    check('setup: move to Wednesday succeeded (origin MOVED, successor UPCOMING on Wednesday)', moved.from.status === 'MOVED' && moved.to.status === 'UPCOMING' && new Date(moved.to.plannedStartAt).toISOString() === `${WED}T08:00:00.000Z`);
    await occurrence(other.id, gaOther, 'i-other', TUE, '04');

    const all = [gaUpcoming, gaLogged, gaSkipped, gaCancelled, gaMoved];
    const occ = await listGoalActivityDailyOccupancyForActivities(user.id, all, TZ);
    check('1. UPCOMING occupies its day', occ.get(gaUpcoming)?.days.has(TUE) === true);
    check('1. LOGGED (completed) occupies its day', occ.get(gaLogged)?.days.has(TUE) === true);
    check('1. SKIPPED does not occupy', !occ.get(gaSkipped)?.days.has(TUE));
    check('1. CANCELLED does not occupy', !occ.get(gaCancelled)?.days.has(TUE));
    check('1. MOVED: destination day occupied, origin day freed', occ.get(gaMoved)?.days.has(WED) === true && !occ.get(gaMoved)?.days.has(TUE));

    // Agreement with the acceptance-time guard, every activity x day.
    let agree = true;
    for (const id of all) {
      for (const day of [TUE, WED, THU]) {
        const guard = await guardSays(user.id, id, day);
        const hint = occ.get(id)?.days.has(day) === true;
        if ((guard === 'OCCUPIED') !== hint) {
          agree = false;
          console.log(`   mismatch ${id} ${day}: guard=${guard} hint=${hint}`);
        }
      }
    }
    check('2. occupancy hint agrees with checkDailyOccurrenceEligibility for every activity x day', agree);

    const cross = await listGoalActivityDailyOccupancyForActivities(user.id, [gaOther], TZ);
    check('3. user-scoped: another user\'s activity/occurrence is never reported', cross.size === 0);

    const demandTue = await loadEligibleGoalDemand(createRealGoalDemandCandidatesDeps(), user.id, TUE, TZ);
    const flag = (id: string) => (demandTue.status === 'OK' ? demandTue.candidates.find((c) => c.goalActivityId === id)?.scheduledOnPlanningDate : undefined);
    check('4. read model (real deps): Tuesday flagged for UPCOMING and LOGGED activities', flag(gaUpcoming) === true && flag(gaLogged) === true);
    check('4. read model (real deps): Tuesday not flagged for SKIPPED / CANCELLED / MOVED-away', flag(gaSkipped) === false && flag(gaCancelled) === false && flag(gaMoved) === false);

    const facts = await loadGoalActivityRhythmFactsForActivities(user.id, [gaUpcoming], TZ);
    const factDates = (facts.get(gaUpcoming) ?? []).map((f) => f.localDate);
    check('5. root-cause pin: rhythm facts carry the WEEK start, not the session day (so they cannot answer "which day")', factDates.length === 1 && factDates[0] === ANCHOR_MONDAY && factDates[0] !== TUE);
  } finally {
    await cleanup();
  }

  if (!allPassed) {
    console.error('\nhpgFix01DailyOccupancyDb: FAILED');
    process.exit(1);
  }
  console.log('\nhpgFix01DailyOccupancyDb: all checks passed');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
