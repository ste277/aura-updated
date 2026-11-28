// HPG3-A2 -- live-database proof of transactional daily occurrence
// eligibility enforcement across POST /api/plans, Day Constructor
// acceptance, and Move. Every instant is a fixed offset from one anchor
// (12:00 IST on a Tuesday), so every scenario's local-day boundary
// (Asia/Kolkata, UTC+5:30) is deterministic and easy to reason about.
//
// AURA-CI-07 -- the anchor was the hard-coded 2026-12-01T06:30Z. Move
// rejects a destination that is not in the future, so the Move scenarios
// (6/6a/6b/7/8/9) would have failed on every run from that date. The
// anchor is now the Tuesday of the shared lifecycleFixtureCalendar week
// (always >= 28 days ahead): same weekday layout as before (day -1 is the
// Monday of the same Monday-start week; days 0..+2 share that week; +9
// crosses into the next), always in the future. Set
// LIFECYCLE_FIXTURE_REFERENCE_NOW to simulate a run date.
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

import { movePlannedActivity, MovePlanError } from '../apps/web/lib/planMove';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import type { AcceptConstructedDayRequest } from '../apps/web/lib/dayConstructorAcceptance';
import { fixtureAnchorMonday, addCivilDays, realClockReferenceForFixture } from './lifecycleFixtureCalendar';
import { createTestSessionToken, TEST_SESSION_COOKIE } from './authSessionTestSupport';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';

function req(tok: string, body: Record<string, unknown>): any {
  return {
    cookies: { get: (n: string) => (n === TEST_SESSION_COOKIE ? { value: tok } : undefined) },
    headers: new Headers(),
    nextUrl: new URL('http://localhost/api/plans'),
    json: async () => body,
  };
}

async function sql(t: string, p: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(t, p); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

// <Tuesday>T06:30:00Z = <Tuesday> 12:00 IST (safely mid-day, no midnight-adjacent ambiguity).
const ANCHOR_TUESDAY = addCivilDays(fixtureAnchorMonday(realClockReferenceForFixture(), TZ), 1);
const ANCHOR_MS = Date.parse(`${ANCHOR_TUESDAY}T06:30:00Z`);
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
  const tok = await createTestSessionToken(user.id, user.email);
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

// AURA-CI-07 -- deterministic ordering for the Move-versus-create race. A third
// transaction holds the per-user advisory lock that both writers take; the first
// writer is started and we wait until Postgres reports it blocked on that lock,
// then the second, then the holder commits. Postgres grants a released lock to
// waiters in queue order, so the first writer always wins. No retries: a writer
// that never blocks fails the barrier and the scenario.
async function advisoryLockWaiters(): Promise<number> {
  return (await sql(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND wait_event = 'advisory' AND query LIKE '%pg_advisory_xact_lock%'`))[0].n;
}
async function waitForAdvisoryLockWaiters(n: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await advisoryLockWaiters()) >= n) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`CI-07 barrier: ${n} writer(s) never blocked on the per-user advisory lock`);
}

async function runMoveVersusCreateRace(label: string, order: 'natural' | 'move-first' | 'create-first', userId: string, tok: string, goalActivityId: string) {
  const setupRes = await plansRoute(req(tok, { ...plan('Strength training', -DAY), goalActivityId }));
  const setupPlan = await setupRes.json();
  check(`${label}. setup: an occurrence exists on day -1`, setupRes.status === 200);
  const original = (await sql(`SELECT id, "scheduledLocalDate" FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [goalActivityId]))[0];

  const doMove = () => movePlannedActivity(userId, setupPlan.id, { newStartAt: new Date(ANCHOR_MS + HOUR) }).then((r) => ({ ok: true as const, r, code: 'OK' })).catch((e) => ({ ok: false as const, r: null, code: String(e?.code ?? e) }));
  const doCreate = () => plansRoute(req(tok, { ...plan('Strength training', 3 * HOUR), goalActivityId }));
  let moveResult: Awaited<ReturnType<typeof doMove>>;
  let createResult: Awaited<ReturnType<typeof doCreate>>;
  if (order === 'natural') {
    [moveResult, createResult] = await Promise.all([doMove(), doCreate()]);
  } else {
    const holder = await beginTransaction();
    try {
      await holder.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`day-constructor-accept:${userId}`]);
      const movePromise = order === 'move-first' ? doMove() : null;
      const createPromise = order === 'create-first' ? doCreate() : null;
      await waitForAdvisoryLockWaiters(1);
      const secondMove = movePromise ?? doMove();
      const secondCreate = createPromise ?? doCreate();
      await waitForAdvisoryLockWaiters(2);
      await holder.query('COMMIT');
      [moveResult, createResult] = await Promise.all([secondMove, secondCreate]);
    } catch (e) {
      await holder.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      holder.release();
    }
  }
  const moveSucceeded = moveResult.ok;
  const createSucceeded = createResult.status === 200;

  const occ = await sql(
    `SELECT o.id, o."scheduledLocalDate" AS day, p.status FROM "GoalActivityOccurrence" o LEFT JOIN "PlannedActivity" p ON p.id = o."plannedActivityId" WHERE o."goalActivityId" = $1`,
    [goalActivityId]
  );
  const plans = await sql(`SELECT id, status, "plannedStartAt", "rescheduledFromPlanId" FROM "PlannedActivity" WHERE "userId" = $1`, [userId]);
  const liveOnContestedDay = occ.filter((o) => o.day === isoDateOf(0) && o.status === 'UPCOMING').length;
  const liveTotal = occ.filter((o) => o.status === 'UPCOMING').length;
  const moveSuccessors = plans.filter((p) => p.rescheduledFromPlanId === setupPlan.id);
  const createdPlans = plans.filter((p) => new Date(p.plannedStartAt).getTime() === ANCHOR_MS + 3 * HOUR);
  const originalPlanAfter = plans.find((p) => p.id === setupPlan.id);
  const originalOccAfter = occ.find((o) => o.id === original.id);
  // Printed on every run so a CI log always shows which writer won.
  console.log(`     ${label}. [${order}] move=${moveResult.code} create=${createResult.status} liveOnContestedDay=${liveOnContestedDay} liveTotal=${liveTotal} occurrences=${occ.length}`);

  check(`${label}. Move-into-day-0 and create-on-day-0 cannot BOTH succeed (serialized, never double-booked)`, !(moveSucceeded && createSucceeded));
  check(`${label}. exactly ONE of Move and create succeeds (the loser is rejected by the daily cap)`, moveSucceeded !== createSucceeded);
  if (order === 'move-first') check(`${label}. the forced ordering held: Move won`, moveSucceeded);
  if (order === 'create-first') check(`${label}. the forced ordering held: create won`, createSucceeded);
  check(`${label}. exactly ONE live occurrence exists on the contested day (day 0) afterward`, liveOnContestedDay === 1);

  if (moveSucceeded) {
    check(`${label}. Move won: create was rejected with 409 and persisted no plan and no occurrence`, createResult.status === 409 && createdPlans.length === 0 && occ.length === 1);
    check(`${label}. Move won: the ORIGINAL occurrence (same id) now sits on day 0 and day -1 is free`, originalOccAfter?.day === isoDateOf(0) && originalOccAfter?.status === 'UPCOMING');
    check(`${label}. Move won: the predecessor plan is MOVED with exactly one successor`, originalPlanAfter?.status === 'MOVED' && moveSuccessors.length === 1);
    check(`${label}. Move won: exactly ONE live occurrence in total`, liveTotal === 1);
  }
  if (createSucceeded) {
    check(`${label}. create won: Move was rejected with DAILY_CAPACITY_EXCEEDED`, moveResult.code === 'DAILY_CAPACITY_EXCEEDED');
    check(`${label}. create won: the rejected Move persisted nothing (no successor plan; predecessor still UPCOMING)`, moveSuccessors.length === 0 && originalPlanAfter?.status === 'UPCOMING');
    check(`${label}. create won: the legitimate day -1 occurrence is preserved, unchanged`, originalOccAfter?.day === isoDateOf(-DAY) && originalOccAfter?.status === 'UPCOMING');
    check(`${label}. create won: exactly one new plan and occurrence on day 0 (two live in total, one per day)`, createdPlans.length === 1 && occ.length === 2 && liveTotal === 2);
  }
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
    // HPG3-A3a -- daily/weekly capacity and unresolved-attribution
    // rejections now return 409 (a genuine scheduling conflict, Move's
    // own established convention), not 400. See
    // schedulingEligibilityErrorContractDb.test.ts for the full contract.
    check('1. second same-day creation REJECTED (daily cap)', res2.status === 409);
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
    check('3. a SAME-DAY second attempt is rejected by the DAILY cap, even though weekly capacity remains (1 of 2 used)', resSameDay.status === 409);
    const res2 = await plansRoute(req(tok, { ...plan('Strength training', DAY), goalActivityId: ga.id }));
    check('3. occurrence 2 of 2 (day 2, different day) SAVES -- weekly capacity still correctly tracked', res2.status === 200);
    const res3 = await plansRoute(req(tok, { ...plan('Strength training', 2 * DAY), goalActivityId: ga.id }));
    check('3. a THIRD attempt (day 3, a different day, weekly capacity now exhausted) is rejected by the WEEKLY cap', res3.status === 409);
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
    check('4. a THIRD same-day attempt is rejected -- weekly capacity (2/week) still applies independently of the daily bypass', res3.status === 409);
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
  //
  // AURA-CI-07 -- Move and POST /plans take the same per-user advisory lock, so
  // whichever acquires it first wins and the other is rejected by the daily cap.
  // Both outcomes are correct, and they leave different live totals:
  //   Move wins   -> 1 live occurrence (moved to day 0; day -1 freed).
  //   Create wins -> 2 live occurrences (original stays on day -1, new one on day 0).
  // The invariant is "exactly one live occurrence on the CONTESTED day", not
  // "one in total". 6 runs the natural race (Move usually wins); 6a and 6b force
  // each ordering deterministically so both are proven on every run.
  // ============================================================
  {
    const { email, user, tok, ga } = await freshUserAndGoal('s6', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    await runMoveVersusCreateRace('6', 'natural', user.id, tok, ga.id);
    await wipe(email, user.id);
  }
  {
    const { email, user, tok, ga } = await freshUserAndGoal('s6a', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    await runMoveVersusCreateRace('6a', 'move-first', user.id, tok, ga.id);
    await wipe(email, user.id);
  }
  {
    const { email, user, tok, ga } = await freshUserAndGoal('s6b', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    await runMoveVersusCreateRace('6b', 'create-first', user.id, tok, ga.id);
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
    check('10. a same-day second attempt is blocked while the first is still UPCOMING', resBlocked.status === 409);
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
    check('11. a same-day second attempt is STILL blocked once the first is LOGGED (completed, not just upcoming)', resAfterLog.status === 409);
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
    check('12. a same-day second attempt is STILL blocked after hard-deletion -- the snapshot alone is sufficient, no execution-row ambiguity needed', resAfterDelete.status === 409);
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
    check('12b. a creation attempt on an unrelated future day is REJECTED (fail-closed on the unresolved conflict), never silently allowed', resAttempt.status === 409);
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
    check('16. the same-day second attempt is rejected', resRejected.status === 409);
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
