// HPG3-A2 -- live-database proof of transactional daily occurrence
// eligibility enforcement across POST /api/plans, Day Constructor
// acceptance, and Move. Uses fixed, explicit UTC instants anchored to
// 2026-12-01 (a safe, uncollided future date) rather than Date.now()
// arithmetic, so every scenario's local-day boundary (Asia/Kolkata,
// UTC+5:30) is deterministic and easy to reason about.
// Run with: npx ts-node test/goalActivityDailyOccurrenceEligibilityDb.test.ts
import { POST as plansRoute } from '../apps/web/app/api/plans/route';
import {
  upsertUserByEmail,
  createGoalWithActivities,
  archiveGoal,
  beginTransaction,
  checkDailyOccurrenceEligibility,
  materializeGoalActivityRhythmOccurrence,
  logPlannedActivity,
  cancelPlannedActivity,
  deletePlannedActivity,
} from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { movePlannedActivity, MovePlanError } from '../apps/web/lib/planMove';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import type { AcceptConstructedDayRequest } from '../apps/web/lib/dayConstructorAcceptance';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';

function req(tok: string, body: Record<string, unknown>): any {
  return {
    cookies: { get: (n: string) => (n === 'as_session' ? { value: tok } : undefined) },
    headers: new Headers(),
    nextUrl: new URL('http://localhost/api/plans'),
    json: async () => body,
  };
}

async function sql(t: string, p: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(t, p); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

// 2026-12-01T06:30:00Z = 2026-12-01 12:00 IST (safely mid-day, no midnight-adjacent ambiguity).
const ANCHOR_MS = Date.parse('2026-12-01T06:30:00Z');
const HOUR = 3600_000;
const DAY = 24 * HOUR;
function plan(title: string, offsetMs: number, durationMin = 30) {
  const start = new Date(ANCHOR_MS + offsetMs);
  const end = new Date(start.getTime() + durationMin * 60_000);
  return { title, plannedStartAt: start.toISOString(), plannedEndAt: end.toISOString(), durationMinutes: durationMin, windowType: 'NEUTRAL' };
}
function window(dateStr: string, fromIso: string, toIso: string) {
  return { date: dateStr, start: new Date(fromIso), end: new Date(toIso), timezone: TZ, source: 'EXPLICIT_RANGE' as const };
}
function item(intentId: string, startIso: string, endIso: string) {
  return { intentId, title: 'Strength training', placementSource: 'SELECTED_CANDIDATE' as const, start: new Date(startIso), end: new Date(endIso) };
}
function isoDateOf(offsetMs: number): string {
  return new Date(ANCHOR_MS + offsetMs).toISOString().slice(0, 10);
}

async function freshUserAndGoal(emailTag: string, activityTitle: string, rhythm?: { kind: 'N_PER_WEEK'; targetPerWeek: number }, dailyFrequencyKind?: string) {
  const email = `hpg3-a2-${emailTag}@example.com`;
  await sql(`DELETE FROM "GoalActivityExecution" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`, [email]).catch(() => {});
  await sql(`DELETE FROM "GoalActivityOccurrence" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`, [email]).catch(() => {});
  await sql(`DELETE FROM "GoalActivity" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`, [email]).catch(() => {});
  await sql(`DELETE FROM "PlannedActivity" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`, [email]).catch(() => {});
  await sql(`DELETE FROM "Goal" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`, [email]).catch(() => {});
  await sql(`DELETE FROM "User" WHERE email = $1`, [email]).catch(() => {});
  const user = await upsertUserByEmail({ email, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const tok = createSessionToken(user.id, user.email);
  const { goal, activities } = await createGoalWithActivities({ userId: user.id, title: `Goal ${emailTag}`, targetDate: null, activities: [{ title: activityTitle, activityId: null, rhythm }] });
  const ga = activities[0];
  if (dailyFrequencyKind) {
    await sql(`UPDATE "GoalActivity" SET "dailyFrequencyKind" = $1 WHERE id = $2`, [dailyFrequencyKind, ga.id]);
  }
  return { email, user, tok, goal, ga };
}

async function wipe(email: string, userId: string) {
  await sql(`DELETE FROM "GoalActivityExecution" WHERE "userId" = $1`, [userId]).catch(() => {});
  await sql(`DELETE FROM "GoalActivityOccurrence" WHERE "userId" = $1`, [userId]).catch(() => {});
  await sql(`DELETE FROM "GoalActivity" WHERE "userId" = $1`, [userId]).catch(() => {});
  await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [userId]).catch(() => {});
  await sql(`DELETE FROM "Goal" WHERE "userId" = $1`, [userId]).catch(() => {});
  await sql(`DELETE FROM "User" WHERE email = $1`, [email]).catch(() => {});
}

async function main() {
  // ============================================================
  // 1. Two same-day creation attempts: second REJECTED.
  // ============================================================
  {
    const { email, user, tok, ga } = await freshUserAndGoal('s1', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    const res1 = await plansRoute(req(tok, { ...plan('Strength training', 0), goalActivityId: ga.id }));
    check('1. first same-day creation SAVES', res1.status === 200);
    const res2 = await plansRoute(req(tok, { ...plan('Strength training', 2 * HOUR), goalActivityId: ga.id }));
    check('1. second same-day creation REJECTED (daily cap)', res2.status === 400);
    const occRows = await sql(`SELECT count(*)::int AS n FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [ga.id]);
    check('1. exactly ONE occurrence row exists (no orphan from the rejected second attempt)', occRows[0].n === 1);
    await wipe(email, user.id);
  }

  // ============================================================
  // 2. Same GoalActivity, different-day scheduling: both SUCCEED.
  // ============================================================
  {
    const { email, user, tok, ga } = await freshUserAndGoal('s2', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    const res1 = await plansRoute(req(tok, { ...plan('Strength training', 0), goalActivityId: ga.id }));
    check('2. day 1 creation SAVES', res1.status === 200);
    const res2 = await plansRoute(req(tok, { ...plan('Strength training', DAY), goalActivityId: ga.id }));
    check('2. day 2 (different local day) creation ALSO SAVES', res2.status === 200);
    const occRows = await sql(`SELECT count(*)::int AS n FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [ga.id]);
    check('2. exactly TWO occurrence rows exist', occRows[0].n === 2);
    await wipe(email, user.id);
  }

  // ============================================================
  // 3. Weekly Rhythm WITH daily cap: both axes enforced independently.
  // ============================================================
  {
    const { email, user, tok, ga } = await freshUserAndGoal('s3', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 2 });
    const res1 = await plansRoute(req(tok, { ...plan('Strength training', 0), goalActivityId: ga.id }));
    check('3. occurrence 1 of 2 (day 1) SAVES', res1.status === 200);
    const resSameDay = await plansRoute(req(tok, { ...plan('Strength training', 3 * HOUR), goalActivityId: ga.id }));
    check('3. a SAME-DAY second attempt is rejected by the DAILY cap, even though weekly capacity remains (1 of 2 used)', resSameDay.status === 400);
    const res2 = await plansRoute(req(tok, { ...plan('Strength training', DAY), goalActivityId: ga.id }));
    check('3. occurrence 2 of 2 (day 2, different day) SAVES -- weekly capacity still correctly tracked', res2.status === 200);
    const res3 = await plansRoute(req(tok, { ...plan('Strength training', 2 * DAY), goalActivityId: ga.id }));
    check('3. a THIRD attempt (day 3, a different day, weekly capacity now exhausted) is rejected by the WEEKLY cap', res3.status === 400);
    await wipe(email, user.id);
  }

  // ============================================================
  // 4. Explicit MULTIPLE_PER_DAY: daily cap bypassed, weekly still applies.
  // ============================================================
  {
    const { email, user, tok, ga } = await freshUserAndGoal('s4', 'Drink water', { kind: 'N_PER_WEEK', targetPerWeek: 2 }, 'MULTIPLE_PER_DAY');
    const res1 = await plansRoute(req(tok, { ...plan('Drink water', 0), goalActivityId: ga.id }));
    check('4. occurrence 1 (day 1) SAVES', res1.status === 200);
    const res2 = await plansRoute(req(tok, { ...plan('Drink water', 2 * HOUR), goalActivityId: ga.id }));
    check('4. a SAME-DAY second occurrence SAVES (MULTIPLE_PER_DAY bypasses the daily cap)', res2.status === 200);
    const res3 = await plansRoute(req(tok, { ...plan('Drink water', 4 * HOUR), goalActivityId: ga.id }));
    check('4. a THIRD same-day attempt is rejected -- weekly capacity (2/week) still applies independently of the daily bypass', res3.status === 400);
    await wipe(email, user.id);
  }

  // ============================================================
  // 5. Concurrent creation race: exactly one serialized winner.
  // ============================================================
  {
    const { email, user, tok, ga } = await freshUserAndGoal('s5', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    const [r1, r2] = await Promise.all([
      plansRoute(req(tok, { ...plan('Strength training', 0), goalActivityId: ga.id })),
      plansRoute(req(tok, { ...plan('Strength training', 1 * HOUR), goalActivityId: ga.id })),
    ]);
    const successes = [r1, r2].filter((r) => r.status === 200).length;
    check('5. exactly ONE of two true-concurrent same-day creation attempts succeeds', successes === 1);
    const occRows = await sql(`SELECT count(*)::int AS n FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [ga.id]);
    check('5. exactly ONE occurrence row exists after the race resolves', occRows[0].n === 1);
    await wipe(email, user.id);
  }

  // ============================================================
  // 6. Concurrent creation versus Move (into the same day): serialized, no double-booking.
  // ============================================================
  {
    const { email, user, tok, ga } = await freshUserAndGoal('s6', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    const setupRes = await plansRoute(req(tok, { ...plan('Strength training', -DAY), goalActivityId: ga.id }));
    const setupPlan = await setupRes.json();
    check('6. setup: an occurrence exists on day -1', setupRes.status === 200);
    const [moveResult, createResult] = await Promise.all([
      movePlannedActivity(user.id, setupPlan.id, { newStartAt: new Date(ANCHOR_MS + HOUR) }).then((r) => ({ ok: true as const, r })).catch((e) => ({ ok: false as const, e })),
      plansRoute(req(tok, { ...plan('Strength training', 3 * HOUR), goalActivityId: ga.id })),
    ]);
    const moveSucceeded = moveResult.ok;
    const createSucceeded = createResult.status === 200;
    check('6. Move-into-day-0 and create-on-day-0 cannot BOTH succeed (serialized, never double-booked)', !(moveSucceeded && createSucceeded));
    const occRows = await sql(`SELECT count(*)::int AS n FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1 AND "plannedActivityId" IN (SELECT id FROM "PlannedActivity" WHERE status = 'UPCOMING')`, [ga.id]);
    check('6. at most ONE live occurrence exists on the contested day afterward', occRows[0].n === 1);
    await wipe(email, user.id);
  }

  // ============================================================
  // 7. Move across midnight: slot transfers, source day freed.
  // ============================================================
  {
    const { email, user, tok, ga } = await freshUserAndGoal('s7', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    const setupRes = await plansRoute(req(tok, { ...plan('Strength training', 0), goalActivityId: ga.id }));
    const setupPlan = await setupRes.json();
    const moved = await movePlannedActivity(user.id, setupPlan.id, { newStartAt: new Date(ANCHOR_MS + DAY + HOUR) });
    check('7. Move across midnight succeeds', moved.to.id !== setupPlan.id);
    const occRow = (await sql(`SELECT "scheduledLocalDate" FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [ga.id]))[0];
    check('7. the occurrence\'s scheduledLocalDate transferred to the NEW day', occRow.scheduledLocalDate === isoDateOf(DAY));
    const resSourceDayAgain = await plansRoute(req(tok, { ...plan('Strength training', 2 * HOUR), goalActivityId: ga.id }));
    check('7. the SOURCE day is now free (a new occurrence there succeeds)', resSourceDayAgain.status === 200);
    await wipe(email, user.id);
  }

  // ============================================================
  // 8. Move into an occupied day: REJECTED, predecessor unchanged.
  // ============================================================
  {
    const { email, user, tok, ga } = await freshUserAndGoal('s8', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    const resA = await plansRoute(req(tok, { ...plan('Strength training', 0), goalActivityId: ga.id }));
    const planA = await resA.json();
    const resB = await plansRoute(req(tok, { ...plan('Strength training', DAY), goalActivityId: ga.id }));
    const planB = await resB.json();
    check('8. setup: two occurrences on two different days', resA.status === 200 && resB.status === 200);
    let moveErr: MovePlanError | null = null;
    try {
      await movePlannedActivity(user.id, planA.id, { newStartAt: new Date(ANCHOR_MS + DAY + 2 * HOUR) });
    } catch (e) {
      moveErr = e as MovePlanError;
    }
    check('8. Move of A into B\'s already-occupied day is REJECTED with DAILY_CAPACITY_EXCEEDED', moveErr instanceof MovePlanError && moveErr.code === 'DAILY_CAPACITY_EXCEEDED');
    const planAAfter = (await sql(`SELECT status FROM "PlannedActivity" WHERE id = $1`, [planA.id]))[0];
    check('8. A remains UPCOMING, untouched by the rejected Move', planAAfter.status === 'UPCOMING');
    await wipe(email, user.id);
  }

  // ============================================================
  // 9. Move across week boundaries: week AND day snapshots both re-stamp atomically.
  // ============================================================
  {
    const { email, user, tok, ga } = await freshUserAndGoal('s9', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    const setupRes = await plansRoute(req(tok, { ...plan('Strength training', 0), goalActivityId: ga.id }));
    const setupPlan = await setupRes.json();
    const moved = await movePlannedActivity(user.id, setupPlan.id, { newStartAt: new Date(ANCHOR_MS + 9 * DAY) });
    const occRow = (await sql(`SELECT "scheduledLocalDate", "scheduledWeekStart" FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [ga.id]))[0];
    check('9. Move across a week boundary succeeds and both snapshots are non-null', moved.to.id !== setupPlan.id && occRow.scheduledLocalDate !== null && occRow.scheduledWeekStart !== null);
    check('9. scheduledLocalDate matches the NEW instant\'s own day', occRow.scheduledLocalDate === isoDateOf(9 * DAY));
    await wipe(email, user.id);
  }

  // ============================================================
  // 10. Cancelled/skipped replacement: frees the day for a new occurrence.
  // ============================================================
  {
    const { email, user, tok, ga } = await freshUserAndGoal('s10', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    const res1 = await plansRoute(req(tok, { ...plan('Strength training', 0), goalActivityId: ga.id }));
    const p1 = await res1.json();
    const resBlocked = await plansRoute(req(tok, { ...plan('Strength training', 2 * HOUR), goalActivityId: ga.id }));
    check('10. a same-day second attempt is blocked while the first is still UPCOMING', resBlocked.status === 400);
    await cancelPlannedActivity(user.id, p1.id);
    const resAfterCancel = await plansRoute(req(tok, { ...plan('Strength training', 4 * HOUR), goalActivityId: ga.id }));
    check('10. after cancelling the first, a new same-day occurrence SUCCEEDS (cancelled never blocks)', resAfterCancel.status === 200);
    await wipe(email, user.id);
  }

  // ============================================================
  // 11. Completed (LOGGED) occurrence blocks another same-day occurrence.
  // ============================================================
  {
    const { email, user, tok, ga } = await freshUserAndGoal('s11', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    const res1 = await plansRoute(req(tok, { ...plan('Strength training', 0), goalActivityId: ga.id }));
    const p1 = await res1.json();
    await logPlannedActivity(user.id, p1.id);
    const resAfterLog = await plansRoute(req(tok, { ...plan('Strength training', 4 * HOUR), goalActivityId: ga.id }));
    check('11. a same-day second attempt is STILL blocked once the first is LOGGED (completed, not just upcoming)', resAfterLog.status === 400);
    await wipe(email, user.id);
  }

  // ============================================================
  // 12. Hard-deleted completed-plan legacy case: snapshot survives, still blocks.
  // ============================================================
  {
    const { email, user, tok, ga } = await freshUserAndGoal('s12', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    const res1 = await plansRoute(req(tok, { ...plan('Strength training', 0), goalActivityId: ga.id }));
    const p1 = await res1.json();
    await logPlannedActivity(user.id, p1.id);
    await deletePlannedActivity(user.id, p1.id);
    const planGone = (await sql(`SELECT id FROM "PlannedActivity" WHERE id = $1`, [p1.id]))[0];
    check('12. setup: the LOGGED plan was genuinely hard-deleted', planGone === undefined);
    const occRow = (await sql(`SELECT "scheduledLocalDate", "plannedActivityId" FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [ga.id]))[0];
    check('12. the occurrence row survives with plannedActivityId cleared but scheduledLocalDate INTACT', occRow.plannedActivityId === null && occRow.scheduledLocalDate === isoDateOf(0));
    const resAfterDelete = await plansRoute(req(tok, { ...plan('Strength training', 4 * HOUR), goalActivityId: ga.id }));
    check('12. a same-day second attempt is STILL blocked after hard-deletion -- the snapshot alone is sufficient, no execution-row ambiguity needed', resAfterDelete.status === 400);
    await wipe(email, user.id);
  }

  // ============================================================
  // 12b. Hard-deleted legacy row with NO snapshot and a surviving execution: UNRESOLVED, never silently free.
  // ============================================================
  {
    const { email, user, tok, ga } = await freshUserAndGoal('s12b', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    const res1 = await plansRoute(req(tok, { ...plan('Strength training', 0), goalActivityId: ga.id }));
    const p1 = await res1.json();
    await logPlannedActivity(user.id, p1.id);
    // Simulate a PRE-A2 legacy occurrence: clear the snapshot directly (A2's own writer always populates it; this
    // reproduces a row created before A2 existed).
    await sql(`UPDATE "GoalActivityOccurrence" SET "scheduledLocalDate" = NULL, "scheduledLocalTimezone" = NULL WHERE "goalActivityId" = $1`, [ga.id]);
    await deletePlannedActivity(user.id, p1.id);
    const execRow = (await sql(`SELECT id FROM "GoalActivityExecution" WHERE "goalActivityId" = $1`, [ga.id]))[0];
    check('12b. setup: a surviving GoalActivityExecution confirms the completion really happened', execRow !== undefined);
    const eligibility = await (async () => {
      const c = await beginTransaction();
      try { const r = await checkDailyOccurrenceEligibility(user.id, ga.id, isoDateOf(2 * DAY), TZ, null, c); await c.query('COMMIT'); return r; } finally { c.release(); }
    })();
    check('12b. the daily check returns UNRESOLVED for an UNRELATED future day, never silently ELIGIBLE (an unattributable historical completion is not proof any given day is free)', eligibility.status === 'UNRESOLVED');
    const resAttempt = await plansRoute(req(tok, { ...plan('Strength training', 2 * DAY), goalActivityId: ga.id }));
    check('12b. a creation attempt on an unrelated future day is REJECTED (fail-closed on the unresolved conflict), never silently allowed', resAttempt.status === 400);
    await wipe(email, user.id);
  }

  // ============================================================
  // 13. Invalid timezone / malformed snapshot: fails closed, never silently guesses.
  // ============================================================
  {
    const { email, user, tok, ga } = await freshUserAndGoal('s13', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    const res1 = await plansRoute(req(tok, { ...plan('Strength training', 0), goalActivityId: ga.id }));
    check('13. setup: a normal occurrence is created', res1.status === 200);
    // Malformed snapshot: scheduledLocalDate set, scheduledLocalTimezone NULL (the "impossible, corrupt state" resolveOccurrenceLocalDay refuses to guess at).
    await sql(`UPDATE "GoalActivityOccurrence" SET "scheduledLocalTimezone" = NULL WHERE "goalActivityId" = $1`, [ga.id]);
    let threw = false;
    try {
      const c = await beginTransaction();
      try { await checkDailyOccurrenceEligibility(user.id, ga.id, isoDateOf(0), TZ, null, c); await c.query('COMMIT'); } finally { c.release(); }
    } catch {
      threw = true;
    }
    check('13. a partially-populated snapshot (date present, timezone null) throws rather than silently guessing', threw);
    await wipe(email, user.id);
  }

  // ============================================================
  // 14. Archived-Goal rejection: HPG2's own lifecycle guard still fires FIRST, unweakened by A2.
  // ============================================================
  {
    const { email, user, tok, goal, ga } = await freshUserAndGoal('s14', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    await archiveGoal(user.id, goal.id);
    const res = await plansRoute(req(tok, { ...plan('Strength training', 0), goalActivityId: ga.id }));
    check('14. an archived Goal\'s activity is rejected (GOAL_NOT_ACTIVE, the HPG2 P0 guard -- still runs BEFORE the new daily check, unweakened)', res.status === 400);
    const body = await res.json();
    check('14. the error is the archived-Goal message specifically, not a generic/daily one', /no longer active/i.test(body?.error ?? ''));
    const occRows = await sql(`SELECT count(*)::int AS n FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [ga.id]);
    check('14. no occurrence was created for the archived Goal\'s activity', occRows[0].n === 0);
    await wipe(email, user.id);
  }

  // ============================================================
  // 15. Idempotent request replay: a retry of the SAME request returns the original result, never a new daily-check failure.
  // ============================================================
  {
    const { email, user, tok, ga } = await freshUserAndGoal('s15', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    const clientRequestId = 'hpg3-a2-idempotent-retry-15';
    const res1 = await plansRoute(req(tok, { ...plan('Strength training', 0), goalActivityId: ga.id, clientRequestId }));
    const body1 = await res1.json();
    check('15. first request SAVES', res1.status === 200);
    const res2 = await plansRoute(req(tok, { ...plan('Strength training', 0), goalActivityId: ga.id, clientRequestId }));
    const body2 = await res2.json();
    check('15. an identical retry (same clientRequestId) returns the SAME plan, 200, never a daily-cap rejection', res2.status === 200 && body2.id === body1.id);
    const occRows = await sql(`SELECT count(*)::int AS n FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [ga.id]);
    check('15. exactly ONE occurrence row exists after the retry (idempotency, not a second materialization)', occRows[0].n === 1);
    await wipe(email, user.id);
  }

  // ============================================================
  // 16. No orphan Plan or occurrence records after a rejected transaction.
  // ============================================================
  {
    const { email, user, tok, ga } = await freshUserAndGoal('s16', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    const res1 = await plansRoute(req(tok, { ...plan('Strength training', 0), goalActivityId: ga.id }));
    check('16. setup: first occurrence SAVES', res1.status === 200);
    const planCountBefore = (await sql(`SELECT count(*)::int AS n FROM "PlannedActivity" WHERE "userId" = $1`, [user.id]))[0].n;
    const occCountBefore = (await sql(`SELECT count(*)::int AS n FROM "GoalActivityOccurrence" WHERE "userId" = $1`, [user.id]))[0].n;
    const resRejected = await plansRoute(req(tok, { ...plan('Strength training', 1 * HOUR), goalActivityId: ga.id }));
    check('16. the same-day second attempt is rejected', resRejected.status === 400);
    const planCountAfter = (await sql(`SELECT count(*)::int AS n FROM "PlannedActivity" WHERE "userId" = $1`, [user.id]))[0].n;
    const occCountAfter = (await sql(`SELECT count(*)::int AS n FROM "GoalActivityOccurrence" WHERE "userId" = $1`, [user.id]))[0].n;
    check('16. no orphan PlannedActivity row was committed by the rejected attempt', planCountAfter === planCountBefore);
    check('16. no orphan GoalActivityOccurrence row was committed by the rejected attempt', occCountAfter === occCountBefore);
    await wipe(email, user.id);
  }

  // ============================================================
  // Day Constructor acceptance path: same enforcement, same ordering.
  // ============================================================
  {
    const { email, user, ga } = await freshUserAndGoal('s17', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    const req1: AcceptConstructedDayRequest = { clientRequestId: 'hpg3-a2-dc-1', constructionWindow: window(isoDateOf(0), new Date(ANCHOR_MS - HOUR).toISOString(), new Date(ANCHOR_MS + 20 * HOUR).toISOString()), proposedItems: [item('intent-dc1', new Date(ANCHOR_MS).toISOString(), new Date(ANCHOR_MS + 30 * 60_000).toISOString())] };
    const d1 = await persistAcceptedConstructedDay(user.id, req1, new Date(ANCHOR_MS - 1800000), new Map([['intent-dc1', ga.id]]));
    check('DC. first Day Constructor acceptance SAVES', d1.status === 'SAVED');
    const req2: AcceptConstructedDayRequest = { clientRequestId: 'hpg3-a2-dc-2', constructionWindow: window(isoDateOf(0), new Date(ANCHOR_MS - HOUR).toISOString(), new Date(ANCHOR_MS + 20 * HOUR).toISOString()), proposedItems: [item('intent-dc2', new Date(ANCHOR_MS + 2 * HOUR).toISOString(), new Date(ANCHOR_MS + 2 * HOUR + 30 * 60_000).toISOString())] };
    const d2 = await persistAcceptedConstructedDay(user.id, req2, new Date(ANCHOR_MS + 2 * HOUR - 1800000), new Map([['intent-dc2', ga.id]]));
    check('DC. a second, SAME-DAY Day Constructor acceptance is REJECTED (SAVE_FAILED) by the same daily cap', d2.status === 'SAVE_FAILED');
    await wipe(email, user.id);
  }

  if (!allPassed) { console.error('SOME HPG3-A2 DAILY OCCURRENCE ELIGIBILITY CHECKS FAILED'); process.exit(1); }
  console.log('ALL HPG3-A2 DAILY OCCURRENCE ELIGIBILITY CHECKS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
