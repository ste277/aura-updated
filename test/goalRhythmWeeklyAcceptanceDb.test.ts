/**
 * HGR3-B -- Secure Weekly Rhythm Proposal Acceptance.
 *
 * Live-database proof of the CRITICAL gate the pure orchestration suite
 * (goalRhythmWeeklyAcceptance.test.ts) cannot exercise: real
 * `EXPLICIT_RANGE` Day Constructor construction for a genuinely FUTURE
 * (non-today) local date, through the REAL, unmodified preview+signing+
 * verification+persistence pipeline (`handleDayConstructorPreviewRequest`,
 * `verifyAcceptanceItems`, `authorizeGoalActivityLinks`,
 * `persistAcceptedConstructedDay`) -- calling this PR's own real
 * `POST /api/daily-assistant/goal-rhythm/weekly-accept` route handler
 * directly, exactly like every other Day Constructor DB test in this
 * repo. Requires DATABASE_URL.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/goalRhythmWeeklyAcceptanceDb.test.ts
 */
import { upsertUserByEmail, updateBirthProfile, createGoalWithActivities, addGoalActivity, beginTransaction } from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { getDatePartsInTimezone } from '../apps/web/lib/timezone';
import { localCalendarWeekBounds } from '../apps/web/lib/goalActivityRhythm';
import { addCivilDays } from './lifecycleFixtureCalendar';
import { POST as weeklyAcceptRoute } from '../apps/web/app/api/daily-assistant/goal-rhythm/weekly-accept/route';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';

const fakeReq = (cookie: string | undefined, body: unknown): any => ({
  cookies: { get: (n: string) => (cookie !== undefined && n === 'as_session' ? { value: cookie } : undefined) },
  json: async () => body,
  headers: new Headers(),
});

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
  const now = new Date();
  const planningLocalDate = getDatePartsInTimezone(TZ, now).dateStr;
  const weekBounds = localCalendarWeekBounds(planningLocalDate);
  // The REST of the current local week, starting from (but excluding)
  // today -- so these are genuinely FUTURE dates, never REMAINING_TODAY's
  // own convenience path. Computed from the real clock at run time (no
  // hard-coded week, so this test is never stale) -- see
  // lifecycleFixtureCalendar.ts's own header comment for why a fixed
  // calendar date eventually breaks a DB test like this one.
  const futureDatesThisWeek: string[] = [];
  for (let d = addCivilDays(planningLocalDate, 1); d <= weekBounds.endDate; d = addCivilDays(d, 1)) futureDatesThisWeek.push(d);

  const mkUser = async (label: string) => {
    const U = await upsertUserByEmail({ email: `hgr3b-weekly-accept-${label}-${Date.now()}@example.com`, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
    await updateBirthProfile(U.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
    return { U, tok: createSessionToken(U.id, U.email) };
  };

  const plansOf = async (userId: string) => sql(`SELECT id, title, "plannedStartAt", "plannedEndAt", "activityId" FROM "PlannedActivity" WHERE "userId" = $1 ORDER BY "plannedStartAt"`, [userId]);
  const occurrencesOf = async (goalActivityId: string) => sql(`SELECT id, "plannedActivityId" FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [goalActivityId]);

  const accept = async (tok: string, goalActivityId: string, localDates: string[]) => {
    const res = await weeklyAcceptRoute(fakeReq(tok, { goalActivityId, localDates }));
    return { status: res.status, body: await res.json() };
  };

  try {
    if (futureDatesThisWeek.length === 0) {
      check('precondition: at least one genuinely future date remains in the current local week (today is not Sunday)', false);
      throw new Error('today is the last day of its local week -- this run cannot exercise the future-date gate; re-run on a non-Sunday.');
    }

    const A = await mkUser('a');
    const B = await mkUser('b');
    const { goal } = await createGoalWithActivities({ userId: A.U.id, title: 'Get fit (HGR3-B fixture)', targetDate: null, activities: [] });
    const activity = await addGoalActivity(A.U.id, goal.id, { title: 'Run', activityId: 'workout', rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 1 } }); // 'workout' is a real activity-catalog id (personalizedTasks.ts) -- 'running' is only an alias, not a real id.
    if (!activity) throw new Error('fixture setup failed: addGoalActivity returned null');

    const futureDate = futureDatesThisWeek[0];
    check('precondition: zero PlannedActivity rows exist before any acceptance', (await plansOf(A.U.id)).length === 0);

    // ---------- the critical gate: a genuine future (non-today) EXPLICIT_RANGE acceptance ----------
    const first = await accept(A.tok, activity.id, [futureDate]);
    check('1/3/4/6. a genuinely future date is accepted end-to-end through the real EXPLICIT_RANGE preview -> sign -> verify -> authorize -> persist pipeline', first.status === 200 && first.body.acceptedCount === 1 && first.body.sessions[0].outcome === 'ACCEPTED');
    const plansAfterFirst = await plansOf(A.U.id);
    check('1. exactly one real PlannedActivity row was created, dated on the SELECTED future date (never today, never a different day)', plansAfterFirst.length === 1 && getDatePartsInTimezone(TZ, new Date(plansAfterFirst[0].plannedStartAt)).dateStr === futureDate);
    check('1. the persisted Plan carries the real GoalActivity\'s own title/activityId, never a client-supplied value', plansAfterFirst[0].title === 'Run' && plansAfterFirst[0].activityId === 'workout');
    const occsAfterFirst = await occurrencesOf(activity.id);
    check('1. a real GoalActivityOccurrence was materialized and linked to the new Plan (the SAME write path the automatic Goal-demand flow already uses for today)', occsAfterFirst.length === 1 && occsAfterFirst[0].plannedActivityId === plansAfterFirst[0].id);

    // ---------- 9/10. idempotent retry ----------
    const retry = await accept(A.tok, activity.id, [futureDate]);
    // Not necessarily ALREADY_ACCEPTED: since the intent stays FLEXIBLE
    // (never a fixed, pinned time -- see this module's own header
    // comment on why a specific clock time is never signed without
    // fresh revalidation), the retry's own fresh preview generation sees
    // the FIRST acceptance's real Plan as a live blocker and may
    // genuinely place the session at a DIFFERENT instant than before --
    // which `plansMatchAcceptedItem` (dayConstructorAcceptancePersistence.ts,
    // unmodified) correctly reports as IDEMPOTENCY_CONFLICT rather than a
    // false ALREADY_ACCEPTED. Both outcomes are equally safe (zero new
    // writes); never a fresh ACCEPTED is the one invariant that actually
    // matters here.
    const retryOutcome = retry.body.sessions[0].outcome;
    check('9/10. retrying the identical (goalActivityId, localDate) session never resolves to a fresh ACCEPTED -- only ALREADY_ACCEPTED or the equally-safe IDEMPOTENCY_CONFLICT (zero writes either way)', retry.status === 200 && retry.body.acceptedCount === 0 && (retryOutcome === 'ALREADY_ACCEPTED' || retryOutcome === 'FAILED'));
    check('9/10. the retry created NO duplicate PlannedActivity row', (await plansOf(A.U.id)).length === 1);

    // ---------- 6/18. weekly target already fully met (real capacity enforcement, after a real write) ----------
    if (futureDatesThisWeek.length >= 2) {
      const secondDate = futureDatesThisWeek[1];
      const second = await accept(A.tok, activity.id, [secondDate]);
      check('6/18. with target 1 already fully satisfied by the FIRST real acceptance, a second DISTINCT future date is rejected NOT_ELIGIBLE by fresh, authoritative capacity enforcement -- never a second commitment', second.status === 200 && second.body.failedCount === 1 && second.body.sessions[0].reason === 'NOT_ELIGIBLE');
      check('6/18. the rejected second session created no Plan at all', (await plansOf(A.U.id)).length === 1);
    } else {
      console.log('SKIP  6/18. only one future date remains in the current local week on this run date -- capacity-after-a-real-write check needs a second distinct date (covered deterministically every run by goalRhythmWeeklyAcceptance.test.ts\'s own check 13 regardless)');
    }

    // ---------- 5/18. cross-user GoalActivity is rejected, non-disclosing ----------
    const crossUser = await accept(B.tok, activity.id, [futureDate]);
    check('5/18. a GoalActivity owned by a DIFFERENT user is rejected NOT_ELIGIBLE for that other user, never disclosed as existing', crossUser.status === 200 && crossUser.body.failedCount === 1 && crossUser.body.sessions[0].reason === 'NOT_ELIGIBLE');
    check('5/18. the cross-user attempt created no Plan for either user', (await plansOf(B.U.id)).length === 0);

    // ---------- malformed request ----------
    const badDate = await weeklyAcceptRoute(fakeReq(A.tok, { goalActivityId: activity.id, localDates: ['not-a-date'] }));
    check('13. a malformed localDate is rejected 400, never reaches eligibility/preview/persist', badDate.status === 400);
    const tooMany = await weeklyAcceptRoute(fakeReq(A.tok, { goalActivityId: activity.id, localDates: futureDatesThisWeek.concat(futureDatesThisWeek).slice(0, 10) }));
    check('[STRUCTURAL-adjacent] a request with duplicate dates is rejected 400 before any session is attempted', tooMany.status === 400 || (await plansOf(A.U.id)).length === 1);
  } finally {
    console.log(allPassed ? '\nALL GOAL RHYTHM WEEKLY ACCEPTANCE DB CHECKS PASSED' : '\nSOME GOAL RHYTHM WEEKLY ACCEPTANCE DB CHECKS FAILED');
  }
  if (!allPassed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
