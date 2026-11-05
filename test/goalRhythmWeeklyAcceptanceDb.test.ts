/**
 * HGR3-B / HGR3-BH -- Secure Weekly Rhythm Proposal Acceptance, hardened.
 *
 * Live-database proof of the CRITICAL gates the pure orchestration suite
 * (goalRhythmWeeklyAcceptance.test.ts) cannot exercise: real
 * `EXPLICIT_RANGE` Day Constructor construction, PINNED to the exact
 * approved instant via a real FIXED intent, for a genuinely FUTURE
 * (non-today) local date, through the REAL, unmodified preview+signing+
 * verification+persistence pipeline (`handleDayConstructorPreviewRequest`,
 * `verifyAcceptanceItems`, `authorizeGoalActivityLinks`,
 * `persistAcceptedConstructedDay`) -- calling this PR's own real
 * `POST /api/daily-assistant/goal-rhythm/weekly-accept` route handler
 * directly, exactly like every other Day Constructor DB test in this
 * repo. Requires DATABASE_URL.
 *
 * HGR3-BH adds: proof that the EXACT approved start/end is what actually
 * lands in the database (not merely "some time that day"), and proof
 * that a retry of an already-accepted session now correctly and
 * DETERMINISTICALLY resolves ALREADY_ACCEPTED with the real original
 * identity -- never the IDEMPOTENCY_CONFLICT coin-flip the original
 * HGR3-B's own independent review found (the FIXED instant's own prior
 * commitment no longer collides with itself, because the reconciliation
 * short-circuit resolves the retry before any fresh preview is ever
 * generated).
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

const TZ = 'Asia/Kolkata'; // UTC+5:30

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

/** A session on `localDate` at 18:00-18:30 IST -- an ordinary, well-inside-the-day,
 * not-yet-elapsed-for-a-future-date instant. */
function approvedSession(localDate: string) {
  return { localDate, start: `${localDate}T12:30:00.000Z`, end: `${localDate}T13:00:00.000Z` };
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
    const U = await upsertUserByEmail({ email: `hgr3bh-weekly-accept-${label}-${Date.now()}@example.com`, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
    await updateBirthProfile(U.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
    return { U, tok: createSessionToken(U.id, U.email) };
  };

  const plansOf = async (userId: string) => sql(`SELECT id, title, "plannedStartAt", "plannedEndAt", "activityId" FROM "PlannedActivity" WHERE "userId" = $1 ORDER BY "plannedStartAt"`, [userId]);
  const occurrencesOf = async (goalActivityId: string) => sql(`SELECT id, "plannedActivityId" FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [goalActivityId]);

  const accept = async (tok: string, goalActivityId: string, sessions: { localDate: string; start: string; end: string }[]) => {
    const res = await weeklyAcceptRoute(fakeReq(tok, { goalActivityId, sessions }));
    return { status: res.status, body: await res.json() };
  };

  try {
    if (futureDatesThisWeek.length === 0) {
      check('precondition: at least one genuinely future date remains in the current local week (today is not Sunday)', false);
      throw new Error('today is the last day of its local week -- this run cannot exercise the future-date gate; re-run on a non-Sunday.');
    }

    const A = await mkUser('a');
    const B = await mkUser('b');
    const { goal } = await createGoalWithActivities({ userId: A.U.id, title: 'Get fit (HGR3-BH fixture)', targetDate: null, activities: [] });
    const activity = await addGoalActivity(A.U.id, goal.id, { title: 'Run', activityId: 'workout', rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 1 } }); // 'workout' is a real activity-catalog id (personalizedTasks.ts) -- 'running' is only an alias, not a real id.
    if (!activity) throw new Error('fixture setup failed: addGoalActivity returned null');

    const futureDate = futureDatesThisWeek[0];
    const approved = approvedSession(futureDate);
    check('precondition: zero PlannedActivity rows exist before any acceptance', (await plansOf(A.U.id)).length === 0);

    // ---------- 1/3/4. the critical gate: a genuine future (non-today) EXPLICIT_RANGE acceptance, PINNED to the exact approved instant ----------
    const first = await accept(A.tok, activity.id, [approved]);
    check('1/3/4/6. a genuinely future date, at the EXACT approved time, is accepted end-to-end through the real EXPLICIT_RANGE preview -> FIXED placement -> sign -> verify -> authorize -> persist pipeline', first.status === 200 && first.body.acceptedCount === 1 && first.body.sessions[0].outcome === 'ACCEPTED');
    const plansAfterFirst = await plansOf(A.U.id);
    check('1. exactly one real PlannedActivity row was created, dated on the SELECTED future date (never today, never a different day)', plansAfterFirst.length === 1 && getDatePartsInTimezone(TZ, new Date(plansAfterFirst[0].plannedStartAt)).dateStr === futureDate);
    check('HGR3-BH P1-1: the persisted Plan carries the EXACT approved start/end -- never a Constructor-re-ranked, different instant of its own choosing', new Date(plansAfterFirst[0].plannedStartAt).getTime() === new Date(approved.start).getTime() && new Date(plansAfterFirst[0].plannedEndAt).getTime() === new Date(approved.end).getTime());
    check('1. the persisted Plan carries the real GoalActivity\'s own title/activityId, never a client-supplied value', plansAfterFirst[0].title === 'Run' && plansAfterFirst[0].activityId === 'workout');
    const occsAfterFirst = await occurrencesOf(activity.id);
    check('1. a real GoalActivityOccurrence was materialized and linked to the new Plan (the SAME write path the automatic Goal-demand flow already uses for today)', occsAfterFirst.length === 1 && occsAfterFirst[0].plannedActivityId === plansAfterFirst[0].id);
    check('1. the response itself reports the exact approved start/end back to the caller', first.body.sessions[0].start === new Date(approved.start).toISOString() && first.body.sessions[0].end === new Date(approved.end).toISOString());

    // ---------- HGR3-BH P1-1: a time the real pipeline cannot place is rejected, NEVER silently relocated ----------
    {
      const { goal: goal2 } = await createGoalWithActivities({ userId: A.U.id, title: 'Reading (HGR3-BH conflict fixture)', targetDate: null, activities: [] });
      const activity2 = await addGoalActivity(A.U.id, goal2.id, { title: 'Read', activityId: 'reading', rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 1 } });
      if (!activity2) throw new Error('fixture setup failed: addGoalActivity (activity2) returned null');
      // Request the EXACT same instant as the first activity's own
      // already-committed Plan -- a real, genuine scheduling conflict.
      const conflicting = await accept(A.tok, activity2.id, [approved]);
      check('HGR3-BH P1-1: a FIXED instant that collides with an existing real commitment is rejected (TIME_NO_LONGER_AVAILABLE), never silently placed at a different, available time instead', conflicting.status === 200 && conflicting.body.failedCount === 1 && conflicting.body.sessions[0].reason === 'TIME_NO_LONGER_AVAILABLE');
      check('HGR3-BH P1-1: the rejected conflicting request created no Plan at all for the second activity', (await plansOf(A.U.id)).length === 1);
    }

    // ---------- HGR3-BH P1-2: idempotent retry now DETERMINISTICALLY resolves ALREADY_ACCEPTED, never the old coin-flip ----------
    const retry = await accept(A.tok, activity.id, [approved]);
    check('HGR3-BH P1-2: retrying the IDENTICAL (goalActivityId, localDate, start, end) session resolves ALREADY_ACCEPTED -- deterministically, never a fresh ACCEPTED and never the old IDEMPOTENCY_CONFLICT coin-flip the original review found', retry.status === 200 && retry.body.acceptedCount === 0 && retry.body.alreadyAcceptedCount === 1 && retry.body.sessions[0].outcome === 'ALREADY_ACCEPTED');
    check('HGR3-BH P1-2: the replay response carries the SAME real plannedActivityId as the original acceptance', retry.body.sessions[0].plannedActivityId === first.body.sessions[0].plannedActivityId);
    check('HGR3-BH P1-2: the replay response carries the SAME real committed start/end', retry.body.sessions[0].start === first.body.sessions[0].start && retry.body.sessions[0].end === first.body.sessions[0].end);
    check('9/10. the retry created NO duplicate PlannedActivity row', (await plansOf(A.U.id)).length === 1);

    // ---------- a second, genuinely DIFFERENT approved time for the SAME activity/date is never misclassified as a replay ----------
    {
      const differentTime = { localDate: futureDate, start: `${futureDate}T14:30:00.000Z`, end: `${futureDate}T15:00:00.000Z` }; // 20:00-20:30 IST, a different instant than the one already committed
      const differentAttempt = await accept(A.tok, activity.id, [differentTime]);
      // This is expected to fail -- the weekly target (1) is already
      // fully met by the first real acceptance -- but it must be
      // attempted as its OWN, genuinely new session (reaching the real
      // capacity check), never silently short-circuited as if it were a
      // replay of the original, differently-timed acceptance.
      check('a DIFFERENT approved time for the same activity/date is never misclassified as a replay of the original -- it is independently revalidated and correctly rejected by the real, authoritative capacity check (NOT_ELIGIBLE), not silently treated as ALREADY_ACCEPTED for the WRONG time', differentAttempt.status === 200 && differentAttempt.body.sessions[0].outcome === 'FAILED' && differentAttempt.body.sessions[0].reason === 'NOT_ELIGIBLE');
      check('the mis-time attempt created no second Plan', (await plansOf(A.U.id)).length === 1);
    }

    // ---------- 6/18. weekly target already fully met (real capacity enforcement, after a real write) ----------
    if (futureDatesThisWeek.length >= 2) {
      const secondDate = futureDatesThisWeek[1];
      const second = await accept(A.tok, activity.id, [approvedSession(secondDate)]);
      check('6/18. with target 1 already fully satisfied by the FIRST real acceptance, a second DISTINCT future date is rejected NOT_ELIGIBLE by fresh, authoritative capacity enforcement -- never a second commitment', second.status === 200 && second.body.failedCount === 1 && second.body.sessions[0].reason === 'NOT_ELIGIBLE');
      check('6/18. the rejected second session created no Plan at all', (await plansOf(A.U.id)).length === 1);
    } else {
      console.log('SKIP  6/18. only one future date remains in the current local week on this run date -- capacity-after-a-real-write check needs a second distinct date (covered deterministically every run by goalRhythmWeeklyAcceptance.test.ts\'s own check 14 regardless)');
    }

    // ---------- 5/18. cross-user GoalActivity is rejected, non-disclosing ----------
    const crossUser = await accept(B.tok, activity.id, [approvedSession(futureDate)]);
    check('5/18. a GoalActivity owned by a DIFFERENT user is rejected NOT_ELIGIBLE for that other user, never disclosed as existing', crossUser.status === 200 && crossUser.body.failedCount === 1 && crossUser.body.sessions[0].reason === 'NOT_ELIGIBLE');
    check('5/18. the cross-user attempt created no Plan for either user', (await plansOf(B.U.id)).length === 0);

    // ---------- malformed request ----------
    const badDate = await weeklyAcceptRoute(fakeReq(A.tok, { goalActivityId: activity.id, sessions: [{ localDate: 'not-a-date', start: approved.start, end: approved.end }] }));
    check('13. a malformed localDate is rejected 400, never reaches eligibility/preview/persist', badDate.status === 400);
    const badTime = await weeklyAcceptRoute(fakeReq(A.tok, { goalActivityId: activity.id, sessions: [{ localDate: futureDate, start: 123, end: approved.end }] }));
    check('HGR3-BH: a non-string start is rejected 400', badTime.status === 400);
    const tooMany = await weeklyAcceptRoute(fakeReq(A.tok, { goalActivityId: activity.id, sessions: [approved, approvedSession(futureDate), approvedSession(futureDate), approvedSession(futureDate)] }));
    check('[STRUCTURAL-adjacent] a request with more than MAX_WEEKLY_ACCEPTANCE_SESSIONS entries is rejected 400 before any session is attempted', tooMany.status === 400);
    const dupe = await weeklyAcceptRoute(fakeReq(A.tok, { goalActivityId: activity.id, sessions: [approved, approved] }));
    check('a request with a duplicate (localDate, start, end) entry is rejected 400 before any session is attempted', dupe.status === 400 && (await plansOf(A.U.id)).length === 1);
  } finally {
    console.log(allPassed ? '\nALL GOAL RHYTHM WEEKLY ACCEPTANCE DB CHECKS PASSED' : '\nSOME GOAL RHYTHM WEEKLY ACCEPTANCE DB CHECKS FAILED');
  }
  if (!allPassed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
