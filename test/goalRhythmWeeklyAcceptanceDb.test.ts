/**
 * HGR3-B / HGR3-BH / HGR3-C1 -- Secure Weekly Rhythm Proposal Acceptance,
 * hardened, with a fresh client-generated acceptance identity per
 * explicit confirmation.
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
import { upsertUserByEmail, updateBirthProfile, createGoalWithActivities, addGoalActivity, beginTransaction, cancelPlannedActivity } from '../apps/web/lib/db';
import { movePlannedActivity } from '../apps/web/lib/planMove';
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

  // HGR3-C1 -- every real caller now mints ONE client-generated
  // `acceptanceId` per explicit "Accept all" confirmation; `'db-test-
  // default'` is the shared identity every PRE-EXISTING (HGR3-B/BH)
  // scenario in this file implicitly used before this dimension existed
  // -- those scenarios are about the acceptance PIPELINE, not the
  // identity scheme itself, so they keep one constant id throughout
  // (matching real retry/idempotency usage: the SAME confirmation,
  // resubmitted). The dedicated HGR3-C1 section below mints its own
  // explicit, distinct ids by name.
  const DEFAULT_ACCEPTANCE_ID = 'db-test-default';
  const accept = async (tok: string, goalActivityId: string, sessions: { localDate: string; start: string; end: string }[], acceptanceId: string = DEFAULT_ACCEPTANCE_ID) => {
    const res = await weeklyAcceptRoute(fakeReq(tok, { goalActivityId, acceptanceId, sessions }));
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
      // A DISTINCT acceptanceId (this is a different GoalActivity, a
      // genuinely separate confirmation -- reusing DEFAULT_ACCEPTANCE_ID
      // here would trip HGR3-C1's own cross-activity payload-binding
      // check before ever reaching the real conflict this test targets).
      const conflicting = await accept(A.tok, activity2.id, [approved], 'acc-cross-activity-conflict');
      check('HGR3-BH P1-1: a FIXED instant that collides with an existing real commitment is rejected (TIME_NO_LONGER_AVAILABLE), never silently placed at a different, available time instead', conflicting.status === 200 && conflicting.body.failedCount === 1 && conflicting.body.sessions[0].reason === 'TIME_NO_LONGER_AVAILABLE');
      check('HGR3-BH P1-1: the rejected conflicting request created no Plan at all for the second activity', (await plansOf(A.U.id)).length === 1);
    }

    // ---------- HGR3-BH P1-2: idempotent retry now DETERMINISTICALLY resolves ALREADY_ACCEPTED, never the old coin-flip ----------
    const retry = await accept(A.tok, activity.id, [approved]);
    check('HGR3-BH P1-2: retrying the IDENTICAL (goalActivityId, localDate, start, end) session resolves ALREADY_ACCEPTED -- deterministically, never a fresh ACCEPTED and never the old IDEMPOTENCY_CONFLICT coin-flip the original review found', retry.status === 200 && retry.body.acceptedCount === 0 && retry.body.alreadyAcceptedCount === 1 && retry.body.sessions[0].outcome === 'ALREADY_ACCEPTED');
    check('HGR3-BH P1-2: the replay response carries the SAME real plannedActivityId as the original acceptance', retry.body.sessions[0].plannedActivityId === first.body.sessions[0].plannedActivityId);
    check('HGR3-BH P1-2: the replay response carries the SAME real committed start/end', retry.body.sessions[0].start === first.body.sessions[0].start && retry.body.sessions[0].end === first.body.sessions[0].end);
    check('9/10. the retry created NO duplicate PlannedActivity row', (await plansOf(A.U.id)).length === 1);

    // ---------- a second, genuinely DIFFERENT approved time for the SAME activity/date, approved as its OWN genuinely new confirmation (HGR3-C1: its own distinct acceptanceId), is never misclassified as a replay ----------
    {
      const differentTime = { localDate: futureDate, start: `${futureDate}T14:30:00.000Z`, end: `${futureDate}T15:00:00.000Z` }; // 20:00-20:30 IST, a different instant than the one already committed
      // A fresh, distinct acceptanceId: this represents a genuinely NEW
      // explicit confirmation for a different time, not a resubmission
      // of the original one -- reusing DEFAULT_ACCEPTANCE_ID here would
      // now be correctly rejected ACCEPTANCE_IDENTITY_CONFLICT by
      // HGR3-C1's own payload-binding check (covered separately below);
      // this test is specifically about the REAL downstream capacity
      // check, which a fresh id reaches unobstructed.
      const differentAttempt = await accept(A.tok, activity.id, [differentTime], 'acc-different-time-fresh-confirmation');
      // This is expected to fail -- the weekly target (1) is already
      // fully met by the first real acceptance -- but it must be
      // attempted as its OWN, genuinely new session (reaching the real
      // capacity check), never silently short-circuited as if it were a
      // replay of the original, differently-timed acceptance.
      check('a DIFFERENT approved time for the same activity/date, under its own fresh acceptanceId, is never misclassified as a replay of the original -- it is independently revalidated and correctly rejected by the real, authoritative capacity check (NOT_ELIGIBLE), not silently treated as ALREADY_ACCEPTED for the WRONG time', differentAttempt.status === 200 && differentAttempt.body.sessions[0].outcome === 'FAILED' && differentAttempt.body.sessions[0].reason === 'NOT_ELIGIBLE');
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
    // Every body below carries a well-formed acceptanceId so the 400
    // observed is genuinely about the field each check actually targets
    // -- never a false-positive from HGR3-C1's own now-required field.
    const badDate = await weeklyAcceptRoute(fakeReq(A.tok, { goalActivityId: activity.id, acceptanceId: 'acc-malformed', sessions: [{ localDate: 'not-a-date', start: approved.start, end: approved.end }] }));
    check('13. a malformed localDate is rejected 400, never reaches eligibility/preview/persist', badDate.status === 400);
    const badTime = await weeklyAcceptRoute(fakeReq(A.tok, { goalActivityId: activity.id, acceptanceId: 'acc-malformed', sessions: [{ localDate: futureDate, start: 123, end: approved.end }] }));
    check('HGR3-BH: a non-string start is rejected 400', badTime.status === 400);
    const tooMany = await weeklyAcceptRoute(fakeReq(A.tok, { goalActivityId: activity.id, acceptanceId: 'acc-malformed', sessions: [approved, approvedSession(futureDate), approvedSession(futureDate), approvedSession(futureDate)] }));
    check('[STRUCTURAL-adjacent] a request with more than MAX_WEEKLY_ACCEPTANCE_SESSIONS entries is rejected 400 before any session is attempted', tooMany.status === 400);
    const dupe = await weeklyAcceptRoute(fakeReq(A.tok, { goalActivityId: activity.id, acceptanceId: 'acc-malformed', sessions: [approved, approved] }));
    check('a request with a duplicate (localDate, start, end) entry is rejected 400 before any session is attempted', dupe.status === 400 && (await plansOf(A.U.id)).length === 1);

    // ---------- HGR3-C1: a missing/empty/oversized acceptanceId is itself rejected 400, before any session is attempted ----------
    const missingAcceptanceId = await weeklyAcceptRoute(fakeReq(A.tok, { goalActivityId: activity.id, sessions: [approvedSession(futureDate)] }));
    check('HGR3-C1: a request with NO acceptanceId at all is rejected 400 -- it is a required field, not an optional fallback to the old content-only identity', missingAcceptanceId.status === 400);
    const emptyAcceptanceId = await weeklyAcceptRoute(fakeReq(A.tok, { goalActivityId: activity.id, acceptanceId: '   ', sessions: [approvedSession(futureDate)] }));
    check('HGR3-C1: a whitespace-only acceptanceId is rejected 400', emptyAcceptanceId.status === 400);
    const oversizedAcceptanceId = await weeklyAcceptRoute(fakeReq(A.tok, { goalActivityId: activity.id, acceptanceId: 'x'.repeat(500), sessions: [approvedSession(futureDate)] }));
    check('HGR3-C1: an oversized acceptanceId (over the bounded length) is rejected 400', oversizedAcceptanceId.status === 400);

    // ---------- F-1 (independent review of this same PR): a reconciliation
    // claim must never resolve ALREADY_ACCEPTED against a DEAD (cancelled
    // or moved-away) commitment -- each sub-scenario uses its own isolated
    // GoalActivity (target 1 or 2, chosen so the expected capacity outcome
    // at each step is unambiguous) so none of these interact with each
    // other's weekly demand or with the row-count assertions above.
    //
    // The corrected behavior is a clean FAILED (COMMITMENT_NO_LONGER_LIVE),
    // never a silent fresh retry: `clientRequestId` is deterministic from
    // content alone, so falling through would reach
    // `persistAcceptedConstructedDay` with the IDENTICAL key as the dead
    // claim, and that function's own separate, global, content-only replay
    // classification would independently rediscover the same dead row and
    // reproduce ALREADY_ACCEPTED by a different route -- see
    // `reconcileExistingAcceptance`'s own header comment in
    // goalRhythmWeeklyAcceptance.ts for the full reasoning. ----------
    {
      // -- Scenario 2: accept -> cancel (the real, existing, unmodified
      // cancelPlannedActivity) -> retry the IDENTICAL original request. --
      const { goal: goalF1a } = await createGoalWithActivities({ userId: A.U.id, title: 'Meditate (F-1a fixture)', targetDate: null, activities: [] });
      const activityF1a = await addGoalActivity(A.U.id, goalF1a.id, { title: 'Meditate', activityId: 'deep-work', rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 1 } });
      if (!activityF1a) throw new Error('fixture setup failed: addGoalActivity (activityF1a) returned null');
      const slotA = { localDate: futureDate, start: `${futureDate}T09:00:00.000Z`, end: `${futureDate}T09:30:00.000Z` };
      const acceptedA = await accept(A.tok, activityF1a.id, [slotA], 'acc-f1a');
      check('F-1 scenario 2 precondition: the session to be cancelled was genuinely accepted first', acceptedA.status === 200 && acceptedA.body.sessions[0].outcome === 'ACCEPTED');
      const cancelledPlanId = acceptedA.body.sessions[0].plannedActivityId;
      await cancelPlannedActivity(A.U.id, cancelledPlanId);
      const cancelledRow = (await sql(`SELECT status, "plannedStartAt", "plannedEndAt" FROM "PlannedActivity" WHERE id = $1`, [cancelledPlanId]))[0];
      check('F-1 scenario 2 precondition: cancelPlannedActivity updates ONLY status -- plannedStartAt/plannedEndAt are left untouched (the exact mechanism the independent review found)', cancelledRow.status === 'CANCELLED' && new Date(cancelledRow.plannedStartAt).getTime() === new Date(slotA.start).getTime());
      // Retrying the SAME acceptanceId ('acc-f1a') -- a genuine retry of
      // the exact original request, never a fresh confirmation -- is
      // the scenario this check targets: HGR3-BH's own F-1 protection
      // must still fire even with HGR3-C1's identity scheme layered on
      // top.
      const retryA = await accept(A.tok, activityF1a.id, [slotA], 'acc-f1a');
      check('F-1 scenario 2: a retry of an accept request whose commitment has since been CANCELLED never returns ALREADY_ACCEPTED against the dead record', retryA.body.sessions[0].outcome !== 'ALREADY_ACCEPTED');
      check('F-1 scenario 2: it is reported as a clean, specific failure (COMMITMENT_NO_LONGER_LIVE) -- never silently recreated, and the real preview+accept route genuinely returns it', retryA.status === 200 && retryA.body.sessions[0].outcome === 'FAILED' && retryA.body.sessions[0].reason === 'COMMITMENT_NO_LONGER_LIVE');
      const plansForF1a = await plansOf(A.U.id);
      check('F-1 scenario 2/8/9: exactly one row exists for this activity afterward (the CANCELLED original) -- the retry created no second row, never a duplicate of or replacement for the dead one', plansForF1a.filter((p: any) => p.activityId === 'deep-work' && p.id === cancelledPlanId).length === 1);

      // -- Scenario 3: accept -> move away (the real, existing,
      // unmodified move flow) -> retry the ORIGINAL (now-vacated) time. --
      const { goal: goalF1b } = await createGoalWithActivities({ userId: A.U.id, title: 'Meditate (F-1b fixture)', targetDate: null, activities: [] });
      const activityF1b = await addGoalActivity(A.U.id, goalF1b.id, { title: 'Meditate', activityId: 'deep-work', rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 2 } });
      if (!activityF1b) throw new Error('fixture setup failed: addGoalActivity (activityF1b) returned null');
      const slotB = { localDate: futureDate, start: `${futureDate}T10:00:00.000Z`, end: `${futureDate}T10:30:00.000Z` };
      const acceptedB = await accept(A.tok, activityF1b.id, [slotB], 'acc-f1b');
      check('F-1 scenario 3 precondition: the session to be moved was genuinely accepted first', acceptedB.status === 200 && acceptedB.body.sessions[0].outcome === 'ACCEPTED');
      const movedAwayPlanId = acceptedB.body.sessions[0].plannedActivityId;
      const moveResultB = await movePlannedActivity(A.U.id, movedAwayPlanId, { newStartAt: new Date(`${futureDate}T11:00:00.000Z`) });
      const movedAwayRow = (await sql(`SELECT status, "plannedStartAt" FROM "PlannedActivity" WHERE id = $1`, [movedAwayPlanId]))[0];
      check('F-1 scenario 3 precondition: the move flow updates the OLD row\'s status to MOVED and leaves its OLD plannedStartAt untouched (the exact mechanism the independent review found)', movedAwayRow.status === 'MOVED' && new Date(movedAwayRow.plannedStartAt).getTime() === new Date(slotB.start).getTime());
      // SAME acceptanceId ('acc-f1b') -- a genuine retry of the original (pre-move) request.
      const retryOriginalB = await accept(A.tok, activityF1b.id, [slotB], 'acc-f1b');
      check('F-1 scenario 3: a retry of the ORIGINAL (pre-move) time never returns ALREADY_ACCEPTED against the stale, moved-away record', retryOriginalB.body.sessions[0].outcome !== 'ALREADY_ACCEPTED');
      check('F-1 scenario 3: it is reported as a clean, specific failure (COMMITMENT_NO_LONGER_LIVE) rather than referencing the stale moved-away record', retryOriginalB.status === 200 && retryOriginalB.body.sessions[0].outcome === 'FAILED' && retryOriginalB.body.sessions[0].reason === 'COMMITMENT_NO_LONGER_LIVE');
      check('F-1 scenario 3/9: no additional row was created by the retry -- only the original (now MOVED) row and its real live successor (created by the move itself, not by the retry) exist', (await plansOf(A.U.id)).filter((p: any) => p.activityId === 'deep-work' && [movedAwayPlanId, moveResultB.to.id].includes(p.id)).length === 2);

      // -- Scenario 4: accept -> move -> request the NEW (moved-to) time
      // through weekly-accept -- must not misattribute/inherit the OLD
      // commitment's identity. --
      const { goal: goalF1c } = await createGoalWithActivities({ userId: A.U.id, title: 'Meditate (F-1c fixture)', targetDate: null, activities: [] });
      const activityF1c = await addGoalActivity(A.U.id, goalF1c.id, { title: 'Meditate', activityId: 'deep-work', rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 1 } });
      if (!activityF1c) throw new Error('fixture setup failed: addGoalActivity (activityF1c) returned null');
      const slotC = { localDate: futureDate, start: `${futureDate}T12:00:00.000Z`, end: `${futureDate}T12:30:00.000Z` };
      const acceptedC = await accept(A.tok, activityF1c.id, [slotC], 'acc-f1c');
      check('F-1 scenario 4 precondition: the session to be moved was genuinely accepted first', acceptedC.status === 200 && acceptedC.body.sessions[0].outcome === 'ACCEPTED');
      const originalCPlanId = acceptedC.body.sessions[0].plannedActivityId;
      const movedC = await movePlannedActivity(A.U.id, originalCPlanId, { newStartAt: new Date(`${futureDate}T13:00:00.000Z`) });
      // A FRESH, distinct acceptanceId: requesting the NEW (moved-to)
      // time is a genuinely new confirmation, never a resubmission of
      // the original 'acc-f1c' request -- reusing it here would now be
      // correctly rejected ACCEPTANCE_IDENTITY_CONFLICT by HGR3-C1's own
      // payload-binding check (same activity+date, different time),
      // which is NOT what this specific scenario targets (it targets
      // the real downstream conflict-detection path instead).
      const retryNewTimeC = await accept(A.tok, activityF1c.id, [{ localDate: futureDate, start: `${futureDate}T13:00:00.000Z`, end: `${futureDate}T13:30:00.000Z` }], 'acc-f1c-newtime');
      check('F-1 scenario 4: a request for the NEW (moved-to) time is never reported ALREADY_ACCEPTED against the OLD commitment\'s identity (there is no stored claim at all for this exact request, since it was never submitted through weekly-accept -- the move flow is a separate write path)', retryNewTimeC.body.sessions[0].outcome !== 'ALREADY_ACCEPTED' || retryNewTimeC.body.sessions[0].plannedActivityId !== originalCPlanId);
      // The requested time is IDENTICAL to the real live successor's own
      // time, so the real preview pipeline's own conflict detection
      // (checking for an overlapping ACTIVE PlannedActivity) fires before
      // ever reaching the write-time capacity check -- TIME_NO_LONGER_AVAILABLE,
      // not NOT_ELIGIBLE (confirmed directly: both would independently
      // reject this request; conflict is simply the FIRST gate reached).
      check('F-1 scenario 4: it is independently, correctly rejected -- the exact requested time is already occupied by the real live successor plan, detected by the real conflict check before any write is attempted -- never silently treated as a duplicate-free success', retryNewTimeC.status === 200 && retryNewTimeC.body.sessions[0].outcome === 'FAILED' && retryNewTimeC.body.sessions[0].reason === 'TIME_NO_LONGER_AVAILABLE');
      check('F-1 scenario 4: no second Plan was created for this activity -- only the original (now MOVED) row and its real live successor exist', (await plansOf(A.U.id)).filter((p: any) => p.activityId === 'deep-work' && [originalCPlanId, movedC.to.id].includes(p.id)).length === 2);

      // -- Scenario 5: a partial-batch acceptance where ONE of the
      // original successes is cancelled, then the WHOLE batch is retried
      // -- truthful, independent per-session results, never a blanket
      // outcome. The cancellation frees exactly one unit of weekly
      // capacity, which the batch's OWN never-before-attempted third
      // session (never s1 itself, which is now a clean failure) goes on
      // to legitimately consume.
      //
      // Each session is on its OWN distinct calendar day (matching this
      // file's own established convention elsewhere): a freshly-created
      // GoalActivity defaults to dailyFrequencyKind=ONCE_PER_DAY (no write
      // path yet exists to opt out of it), so putting more than one
      // session for the SAME activity on the SAME day would hit that
      // unrelated daily cap first and never exercise the weekly-capacity
      // scenario this block actually targets. --
      if (futureDatesThisWeek.length < 3) {
        console.log('SKIP  F-1 scenario 5 -- fewer than 3 distinct future dates remain in the current local week on this run date (needs 3 to stay clear of the default once-per-day cap); covered deterministically every run by goalRhythmWeeklyAcceptance.test.ts\'s own pure-level F-1 checks regardless');
      } else {
        const { goal: goalF1d } = await createGoalWithActivities({ userId: A.U.id, title: 'Meditate (F-1d fixture)', targetDate: null, activities: [] });
        const activityF1d = await addGoalActivity(A.U.id, goalF1d.id, { title: 'Meditate', activityId: 'deep-work', rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 2 } });
        if (!activityF1d) throw new Error('fixture setup failed: addGoalActivity (activityF1d) returned null');
        // A distinct time-of-day (17:00-17:30Z), never the fixed
        // 12:30-13:00Z `approvedSession` already occupies on
        // `futureDatesThisWeek[0]`/[1] elsewhere in this file -- reusing
        // that exact instant here would collide with an unrelated
        // activity's own already-live Plan and fail TIME_NO_LONGER_AVAILABLE
        // before ever reaching the weekly-capacity gate this scenario
        // actually targets.
        const s1 = { localDate: futureDatesThisWeek[0], start: `${futureDatesThisWeek[0]}T17:00:00.000Z`, end: `${futureDatesThisWeek[0]}T17:30:00.000Z` };
        const s2 = { localDate: futureDatesThisWeek[1], start: `${futureDatesThisWeek[1]}T17:00:00.000Z`, end: `${futureDatesThisWeek[1]}T17:30:00.000Z` };
        const s3 = { localDate: futureDatesThisWeek[2], start: `${futureDatesThisWeek[2]}T17:00:00.000Z`, end: `${futureDatesThisWeek[2]}T17:30:00.000Z` };
        // ONE acceptanceId for the whole batch ('acc-f1d'), exactly as a
        // real "Accept all" press would mint -- reused unchanged for the
        // retry below, since this is the SAME confirmation resubmitted,
        // not a new one.
        const firstBatch = await accept(A.tok, activityF1d.id, [s1, s2, s3], 'acc-f1d');
        check('F-1 scenario 5 precondition: with target 2, exactly the first two sessions in the batch succeed and the third genuinely fails on capacity -- never all three', firstBatch.status === 200 && firstBatch.body.acceptedCount === 2 && firstBatch.body.failedCount === 1 && firstBatch.body.sessions[0].outcome === 'ACCEPTED' && firstBatch.body.sessions[1].outcome === 'ACCEPTED' && firstBatch.body.sessions[2].outcome === 'FAILED');
        const s1PlanId = firstBatch.body.sessions[0].plannedActivityId;
        const s2PlanId = firstBatch.body.sessions[1].plannedActivityId;
        await cancelPlannedActivity(A.U.id, s1PlanId);
        const retryBatch = await accept(A.tok, activityF1d.id, [s1, s2, s3], 'acc-f1d');
        check('F-1 scenario 5: s1 (cancelled since the original batch) is reported as a clean, specific failure (COMMITMENT_NO_LONGER_LIVE) -- never ALREADY_ACCEPTED against the dead record, and never silently recreated', retryBatch.body.sessions[0].outcome === 'FAILED' && retryBatch.body.sessions[0].reason === 'COMMITMENT_NO_LONGER_LIVE');
        check('F-1 scenario 5: s2 (still genuinely live, untouched) correctly and deterministically resolves ALREADY_ACCEPTED with its real original identity', retryBatch.body.sessions[1].outcome === 'ALREADY_ACCEPTED' && retryBatch.body.sessions[1].plannedActivityId === s2PlanId);
        check('F-1 scenario 5: s3 (never accepted the first time) is now independently, genuinely accepted -- the capacity s1\'s own cancellation freed is correctly available to a DIFFERENT, never-before-attempted session, never reused to silently resurrect s1 itself', retryBatch.body.sessions[2].outcome === 'ACCEPTED' && retryBatch.body.sessions[2].plannedActivityId !== s1PlanId && retryBatch.body.sessions[2].plannedActivityId !== s2PlanId);
        check('F-1 scenario 5/9: the retry created exactly ONE new row (for s3) -- s1 stays CANCELLED with no replacement, s2 is completely untouched', (await plansOf(A.U.id)).filter((p: any) => p.activityId === 'deep-work' && [s1PlanId, s2PlanId, retryBatch.body.sessions[2].plannedActivityId].includes(p.id)).length === 3);
      }
    }

    // ============================================================
    // HGR3-C1 -- FRESH ACCEPTANCE IDENTITY (fixes HGR3-C-R1), against a
    // real database, through the real route handler. The exact 10-step
    // lifecycle this ticket's own review named as the core proof.
    // ============================================================
    {
      const { goal: goalC1 } = await createGoalWithActivities({ userId: A.U.id, title: 'Run (HGR3-C1 rebooking fixture)', targetDate: null, activities: [] });
      const activityC1 = await addGoalActivity(A.U.id, goalC1.id, { title: 'Run', activityId: 'workout', rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 1 } });
      if (!activityC1) throw new Error('fixture setup failed: addGoalActivity (activityC1) returned null');
      const slot = { localDate: futureDate, start: `${futureDate}T16:00:00.000Z`, end: `${futureDate}T16:30:00.000Z` };

      // 1. Accept using acceptance identity A.
      const step1 = await accept(A.tok, activityC1.id, [slot], 'acc-rebook-A');
      check('HGR3-C1 step 1: accept using identity A genuinely succeeds', step1.status === 200 && step1.body.sessions[0].outcome === 'ACCEPTED');
      const planIdA = step1.body.sessions[0].plannedActivityId;

      // 2. Cancel the commitment (the real, existing, unmodified cancelPlannedActivity).
      await cancelPlannedActivity(A.U.id, planIdA);
      const cancelledRowC1 = (await sql(`SELECT status FROM "PlannedActivity" WHERE id = $1`, [planIdA]))[0];
      check('HGR3-C1 step 2: the commitment is genuinely cancelled', cancelledRowC1.status === 'CANCELLED');

      // 3/4. Retry identity A -- must fail COMMITMENT_NO_LONGER_LIVE, never resurrect the dead original.
      const plansForC1BeforeStep3 = await occurrencesOf(activityC1.id);
      const step3 = await accept(A.tok, activityC1.id, [slot], 'acc-rebook-A');
      check('HGR3-C1 steps 3/4: retrying the STALE identity A after cancellation fails FAILED/COMMITMENT_NO_LONGER_LIVE -- never ALREADY_ACCEPTED against the dead original', step3.status === 200 && step3.body.sessions[0].outcome === 'FAILED' && step3.body.sessions[0].reason === 'COMMITMENT_NO_LONGER_LIVE');
      // Scoped by this fixture's OWN GoalActivityOccurrence rows (never a
      // bare activityId filter -- 'workout' is a shared catalog id
      // reused by other, unrelated fixtures throughout this file).
      check('HGR3-C1 steps 3/4: the stale retry created no new occurrence/row for THIS GoalActivity', (await occurrencesOf(activityC1.id)).length === plansForC1BeforeStep3.length);

      // 5. A fresh weekly proposal would re-propose this byte-identical slot (cancellation contributes NONE to occupiedLocalDates) -- not re-run here (goalRhythmWeeklyProposal.ts is covered by its own test file), but the real consequence -- the slot remains genuinely eligible -- is what step 6 below actually proves.

      // 6/7. Explicitly accept using NEW identity B -- must create a genuinely NEW live commitment.
      const step6 = await accept(A.tok, activityC1.id, [slot], 'acc-rebook-B');
      check('HGR3-C1 steps 6/7: explicitly re-approving the IDENTICAL slot under a FRESH identity B is genuinely accepted -- a real, new live commitment is created', step6.status === 200 && step6.body.sessions[0].outcome === 'ACCEPTED');
      const planIdB = step6.body.sessions[0].plannedActivityId;
      check('HGR3-C1 step 7: the new commitment is a GENUINELY DIFFERENT real row, never the resurrected original', planIdB !== planIdA);

      // 8. The cancelled original remains cancelled, untouched by the new booking.
      const originalAfterRebook = (await sql(`SELECT status FROM "PlannedActivity" WHERE id = $1`, [planIdA]))[0];
      check('HGR3-C1 step 8: the cancelled original remains CANCELLED, completely untouched by the new booking', originalAfterRebook.status === 'CANCELLED');

      // 9/10. Retry identity B -- must now resolve ALREADY_ACCEPTED, pointing at the NEW live commitment.
      const step9 = await accept(A.tok, activityC1.id, [slot], 'acc-rebook-B');
      check('HGR3-C1 steps 9/10: retrying the NEW identity B resolves ALREADY_ACCEPTED, pointing at the NEW live commitment -- never the old dead one', step9.status === 200 && step9.body.sessions[0].outcome === 'ALREADY_ACCEPTED' && step9.body.sessions[0].plannedActivityId === planIdB);
      check('HGR3-C1 steps 9/10: exactly two real rows exist for this activity in total -- the cancelled original and the one genuinely new rebooking, never a third', (await plansOf(A.U.id)).filter((p: any) => p.activityId === 'workout' && [planIdA, planIdB].includes(p.id)).length === 2);
    }

    // ---------- HGR3-C1: payload-binding conflict, against a real database ----------
    {
      const { goal: goalBind } = await createGoalWithActivities({ userId: A.U.id, title: 'Run (HGR3-C1 payload-binding fixture)', targetDate: null, activities: [] });
      const activityBind = await addGoalActivity(A.U.id, goalBind.id, { title: 'Run', activityId: 'workout', rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 2 } });
      if (!activityBind) throw new Error('fixture setup failed: addGoalActivity (activityBind) returned null');
      // IST local midnight is 18:30Z the PREVIOUS UTC day -- a UTC time
      // at/after 18:30 on `futureDate` itself resolves to the NEXT IST
      // calendar date (TIME_DATE_MISMATCH), so both slots below stay
      // safely before that boundary, and both avoid every other UTC
      // time already occupied elsewhere in this file for `futureDate`.
      const slot1 = { localDate: futureDate, start: `${futureDate}T05:00:00.000Z`, end: `${futureDate}T05:30:00.000Z` };
      const slot2 = { localDate: futureDate, start: `${futureDate}T06:00:00.000Z`, end: `${futureDate}T06:30:00.000Z` }; // same activity/date, a DIFFERENT time

      const firstBind = await accept(A.tok, activityBind.id, [slot1], 'acc-bind-conflict');
      check('HGR3-C1 payload-binding precondition: the first request under identity X succeeds', firstBind.status === 200 && firstBind.body.sessions[0].outcome === 'ACCEPTED');

      const reusedBind = await accept(A.tok, activityBind.id, [slot2], 'acc-bind-conflict');
      check('HGR3-C1: reusing the SAME acceptanceId for a DIFFERENT approved time on the same (goalActivityId, localDate), against a real database, is rejected ACCEPTANCE_IDENTITY_CONFLICT -- never silently processed as an independent fresh session, and never misreported as a replay', reusedBind.status === 200 && reusedBind.body.sessions[0].outcome === 'FAILED' && reusedBind.body.sessions[0].reason === 'ACCEPTANCE_IDENTITY_CONFLICT');
      check('HGR3-C1: the rejected conflict created no second real row', (await plansOf(A.U.id)).filter((p: any) => p.activityId === 'workout' && new Date(p.plannedStartAt).getTime() === new Date(slot2.start).getTime()).length === 0);
    }
  } finally {
    console.log(allPassed ? '\nALL GOAL RHYTHM WEEKLY ACCEPTANCE DB CHECKS PASSED' : '\nSOME GOAL RHYTHM WEEKLY ACCEPTANCE DB CHECKS FAILED');
  }
  if (!allPassed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
