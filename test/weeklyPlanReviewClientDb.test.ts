/**
 * HGR3-C2 -- Home Weekly Planning UI, live-database proof.
 *
 * Proves the CLIENT-SIDE pure functions (weeklyPlanReviewClient.ts) genuinely
 * compose with the REAL `weekly-proposal`/`weekly-accept` route handlers
 * end to end -- calling those two real routes directly (exactly like
 * every other Day Constructor DB test in this repo), feeding their real
 * response bodies through `buildSessionDraftsFromProposal` /
 * `selectSessionsPendingSubmission` / `buildWeeklyAcceptanceRequestBody` /
 * `applyAcceptanceSummaryToDrafts`, and inspecting the ACTUAL database rows
 * afterward -- never a mocked success response standing in for the real
 * backend's own decision.
 *
 * Specifically exercises the HGR3-C-R1 cancellation/rebooking journey this
 * ticket's own section 10 names, end to end, through the UI's OWN request-
 * building logic (not hand-written fixtures that happen to look similar):
 * accept -> cancel -> a FRESH real weekly-proposal re-offers the identical
 * slot -> the UI mints a fresh acceptanceId and accepts it -> a genuinely
 * new live commitment is created -> the stale original acceptanceId, if
 * retried through the same UI functions, still correctly fails closed.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/weeklyPlanReviewClientDb.test.ts
 */
import { randomUUID } from 'crypto';
import { upsertUserByEmail, updateBirthProfile, createGoalWithActivities, addGoalActivity, beginTransaction, cancelPlannedActivity } from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { getDatePartsInTimezone } from '../apps/web/lib/timezone';
import { localCalendarWeekBounds } from '../apps/web/lib/goalActivityRhythm';
import { addCivilDays } from './lifecycleFixtureCalendar';
import { POST as weeklyProposalRoute } from '../apps/web/app/api/daily-assistant/goal-rhythm/weekly-proposal/route';
import { POST as weeklyAcceptRoute } from '../apps/web/app/api/daily-assistant/goal-rhythm/weekly-accept/route';
import {
  buildSessionDraftsFromProposal,
  selectSessionsPendingSubmission,
  buildWeeklyAcceptanceRequestBody,
  applyAcceptanceSummaryToDrafts,
  parseWeeklyProposalResponseBody,
  parseWeeklyAcceptanceResponseBody,
  isSessionLocked,
} from '../apps/web/lib/weeklyPlanReviewClient';

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
  const futureDatesThisWeek: string[] = [];
  for (let d = addCivilDays(planningLocalDate, 1); d <= weekBounds.endDate; d = addCivilDays(d, 1)) futureDatesThisWeek.push(d);

  if (futureDatesThisWeek.length === 0) {
    check('precondition: at least one genuinely future date remains in the current local week (today is not Sunday)', false);
    console.log(allPassed ? '\nALL WEEKLY PLAN REVIEW CLIENT DB CHECKS PASSED' : '\nSOME WEEKLY PLAN REVIEW CLIENT DB CHECKS FAILED');
    process.exit(1);
  }

  const user = await upsertUserByEmail({ email: `hgr3c2-weekly-review-client-${Date.now()}@example.com`, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await updateBirthProfile(user.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  const tok = createSessionToken(user.id, user.email);

  const { goal } = await createGoalWithActivities({ userId: user.id, title: 'Get fit (HGR3-C2 fixture)', targetDate: null, activities: [] });
  const activity = await addGoalActivity(user.id, goal.id, { title: 'Run', activityId: 'workout', rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 1 } });
  if (!activity) throw new Error('fixture setup failed: addGoalActivity returned null');

  const plansOf = async () => sql(`SELECT id, status, "plannedStartAt", "plannedEndAt" FROM "PlannedActivity" WHERE "userId" = $1 ORDER BY "plannedStartAt"`, [user.id]);

  const fetchProposal = async () => {
    const res = await weeklyProposalRoute(fakeReq(tok, { goalActivityId: activity.id }));
    return parseWeeklyProposalResponseBody(await res.json(), res.status);
  };
  const submitAcceptance = async (acceptanceId: string, sessions: { localDate: string; start: string; end: string }[]) => {
    const res = await weeklyAcceptRoute(fakeReq(tok, buildWeeklyAcceptanceRequestBody(activity.id, acceptanceId, sessions)));
    return parseWeeklyAcceptanceResponseBody(await res.json(), res.status);
  };

  try {
    check('precondition: zero PlannedActivity rows exist before any acceptance', (await plansOf()).length === 0);

    // ---------- 1. Real proposal, through the UI's own real request/response path ----------
    const proposal1 = await fetchProposal();
    check('1. the real weekly-proposal endpoint, parsed through this UI\'s own real response parser, returns a usable proposal', proposal1.status === 'OK' && proposal1.proposals.length >= 1);
    if (proposal1.status !== 'OK') throw new Error('fixture precondition failed: no proposal returned');
    const drafts1 = buildSessionDraftsFromProposal(proposal1.proposals);
    check('1. every projected draft starts PENDING, ready for the review screen', drafts1.every((d) => d.outcome === 'PENDING'));

    // ---------- 2. Accept under identity A, via the UI's own selection/request-building functions ----------
    const acceptanceIdA = randomUUID();
    const pendingA = selectSessionsPendingSubmission(drafts1);
    check('2. selectSessionsPendingSubmission includes every freshly-proposed (PENDING) session', pendingA.length === drafts1.length);
    const acceptResultA = await submitAcceptance(acceptanceIdA, pendingA);
    check('2. the real weekly-accept endpoint, parsed through this UI\'s own real response parser, reports a genuine ACCEPTED outcome', acceptResultA.status === 'OK' && acceptResultA.summary.acceptedCount === pendingA.length);
    if (acceptResultA.status !== 'OK') throw new Error('fixture precondition failed: initial acceptance did not succeed');
    const draftsAfterA = applyAcceptanceSummaryToDrafts(drafts1, acceptResultA.summary);
    check('2. applyAcceptanceSummaryToDrafts correctly locks the accepted session in the UI\'s own state', draftsAfterA.every((d) => isSessionLocked(d.outcome)));
    const plansAfterA = await plansOf();
    check('2. a REAL PlannedActivity row was created in the database by this exact UI-driven request', plansAfterA.length === 1 && plansAfterA[0].status === 'UPCOMING');
    const originalPlanId = plansAfterA[0].id;
    const acceptedDraft = draftsAfterA.find((d) => d.outcome === 'ACCEPTED');
    check('2. the UI\'s own draft now carries the real, authoritative plannedActivityId from the database', !!acceptedDraft && acceptedDraft.plannedActivityId === originalPlanId);

    // ---------- 3. Cancel the real commitment through the existing, unrelated cancel flow ----------
    await cancelPlannedActivity(user.id, originalPlanId);
    const plansAfterCancel = await plansOf();
    check('3. the real row is now CANCELLED, with its original start/end untouched (the existing cancel flow\'s own, unmodified behavior)', plansAfterCancel.length === 1 && plansAfterCancel[0].status === 'CANCELLED' && new Date(plansAfterCancel[0].plannedStartAt).getTime() === new Date(plansAfterA[0].plannedStartAt).getTime());

    // ---------- 4. A stale retry of the ORIGINAL acceptanceId, through this same UI's own functions, must fail closed ----------
    const staleRetry = await submitAcceptance(acceptanceIdA, pendingA);
    check('4. [HGR3-C-R1] a stale retry of the original acceptanceId correctly fails -- never silently "re-accepted" against the cancelled row', staleRetry.status === 'OK' && staleRetry.summary.acceptedCount === 0 && staleRetry.summary.alreadyAcceptedCount === 0 && staleRetry.summary.failedCount === 1);
    if (staleRetry.status === 'OK') {
      const draftsAfterStaleRetry = applyAcceptanceSummaryToDrafts(drafts1, staleRetry.summary);
      check('4. the UI\'s own reconciliation correctly surfaces this as a FAILED draft (COMMITMENT_NO_LONGER_LIVE), never a false ACCEPTED/ALREADY_ACCEPTED', draftsAfterStaleRetry[0].outcome === 'FAILED' && draftsAfterStaleRetry[0].failureReason === 'COMMITMENT_NO_LONGER_LIVE');
    }
    const plansAfterStaleRetry = await plansOf();
    check('4. the stale retry created ZERO additional rows (still exactly 1, still CANCELLED)', plansAfterStaleRetry.length === 1 && plansAfterStaleRetry[0].status === 'CANCELLED');

    // ---------- 5. A FRESH real proposal, generated AFTER the cancellation, through the same UI path ----------
    const proposal2 = await fetchProposal();
    check('5. [HGR3-C-R1] a fresh weekly-proposal call, generated through the SAME real UI path, is eligible again now that the cancellation freed this week\'s demand', proposal2.status === 'OK' && proposal2.proposals.length >= 1);
    if (proposal2.status !== 'OK') throw new Error('fixture precondition failed: second proposal did not return OK');
    const drafts2 = buildSessionDraftsFromProposal(proposal2.proposals);

    // ---------- 6. Accept the fresh proposal under a genuinely NEW identity B ----------
    const acceptanceIdB = randomUUID();
    check('6. a genuinely new confirmation uses a DIFFERENT acceptanceId than the original (the real lifecycle contract: fresh id per new decision)', acceptanceIdB !== acceptanceIdA);
    const pendingB = selectSessionsPendingSubmission(drafts2);
    const acceptResultB = await submitAcceptance(acceptanceIdB, pendingB);
    check('6. [HGR3-C-R1] the fresh, explicitly-approved re-booking succeeds -- the user CAN rebook the identical slot with a new confirmation', acceptResultB.status === 'OK' && acceptResultB.summary.acceptedCount === pendingB.length);
    if (acceptResultB.status !== 'OK') throw new Error('fixture precondition failed: rebooking did not succeed');
    const draftsAfterB = applyAcceptanceSummaryToDrafts(drafts2, acceptResultB.summary);
    const newAcceptedDraft = draftsAfterB.find((d) => d.outcome === 'ACCEPTED');
    const plansAfterB = await plansOf();
    check('6. a GENUINELY NEW live row now exists, with a DIFFERENT id than the original cancelled row', plansAfterB.length === 2 && !!newAcceptedDraft && newAcceptedDraft.plannedActivityId !== originalPlanId);
    check('6. exactly one of the two rows is UPCOMING (the new booking) and the original remains CANCELLED, untouched', plansAfterB.filter((p) => p.status === 'UPCOMING').length === 1 && plansAfterB.find((p) => p.id === originalPlanId)?.status === 'CANCELLED');

    // ---------- 7. Retrying identity B (the genuinely new, now-live booking) correctly resolves ALREADY_ACCEPTED ----------
    const retryB = await submitAcceptance(acceptanceIdB, pendingB);
    check('7. retrying the NEW identity resolves ALREADY_ACCEPTED, pointing at the real new row -- never a duplicate', retryB.status === 'OK' && retryB.summary.alreadyAcceptedCount === pendingB.length && retryB.summary.acceptedCount === 0);
    if (retryB.status === 'OK') {
      const draftsAfterRetryB = applyAcceptanceSummaryToDrafts(drafts2, retryB.summary);
      check('7. the UI\'s own reconciliation correctly re-locks the session with the SAME real plannedActivityId as before', isSessionLocked(draftsAfterRetryB[0].outcome) && draftsAfterRetryB[0].plannedActivityId === newAcceptedDraft!.plannedActivityId);
    }
    const plansAfterRetryB = await plansOf();
    check('7. retrying the new identity created ZERO additional rows (still exactly 2 total)', plansAfterRetryB.length === 2);
  } finally {
    console.log(allPassed ? '\nALL WEEKLY PLAN REVIEW CLIENT DB CHECKS PASSED' : '\nSOME WEEKLY PLAN REVIEW CLIENT DB CHECKS FAILED');
    if (!allPassed) process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
