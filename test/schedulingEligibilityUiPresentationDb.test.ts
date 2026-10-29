// HPG3-A3b -- live-database proof that the new UI-presentation layer
// (schedulingEligibilityPresentation.ts, the dayPlanAcceptancePresentation.ts
// SAVE_FAILED branch, and the reschedule-via-Move path in
// PlanWithAuraView.tsx) sits on top of REAL server responses without
// changing any scheduling decision: every rejection scenario produces the
// exact same persisted state (PlannedActivity count AND GoalActivityOccurrence
// count both unchanged) as HPG3-A3a's own schedulingEligibilityErrorContractDb.test.ts
// already proved for the raw contract, now additionally verified through the
// UI's own parsing/classification functions. Same scaffolding/fixture
// convention as that file and goalActivityDailyOccurrenceEligibilityDb.test.ts.
// Run with: npx ts-node test/schedulingEligibilityUiPresentationDb.test.ts
import { POST as plansRoute } from '../apps/web/app/api/plans/route';
import {
  upsertUserByEmail,
  createGoalWithActivities,
  beginTransaction,
  logPlannedActivity,
  deletePlannedActivity,
} from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { movePlannedActivity, MovePlanError } from '../apps/web/lib/planMove';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import type { AcceptConstructedDayRequest } from '../apps/web/lib/dayConstructorAcceptance';
import { parseAcceptResponseBody } from '../apps/web/lib/acceptConstructedDay';
import { classifyAcceptanceUiState } from '../apps/web/lib/dayPlanAcceptancePresentation';
import { isKnownSchedulingEligibilityCode, presentSchedulingEligibilityError } from '../apps/web/lib/schedulingEligibilityPresentation';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';

function req(tok: string | null, body: Record<string, unknown>): any {
  return {
    cookies: { get: (n: string) => (tok && n === 'as_session' ? { value: tok } : undefined) },
    headers: new Headers(),
    nextUrl: new URL('http://localhost/api/plans'),
    json: async () => body,
  };
}

async function sql(t: string, p: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(t, p); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

// 2026-12-16T06:30:00Z = 2026-12-16 12:00 IST -- a distinct anchor from
// HPG3-A3a's own test file so the two can run against the same disposable
// DB without colliding on (user, date).
const ANCHOR_MS = Date.parse('2026-12-16T06:30:00Z');
const HOUR = 3600_000;
const DAY = 24 * HOUR;
function plan(title: string, offsetMs: number, durationMin = 30) {
  const start = new Date(ANCHOR_MS + offsetMs);
  const end = new Date(start.getTime() + durationMin * 60_000);
  return { title, plannedStartAt: start.toISOString(), plannedEndAt: end.toISOString(), durationMinutes: durationMin, windowType: 'NEUTRAL' };
}
function isoDateOf(offsetMs: number): string {
  return new Date(ANCHOR_MS + offsetMs).toISOString().slice(0, 10);
}
function window(dateStr: string, fromIso: string, toIso: string) {
  return { date: dateStr, start: new Date(fromIso), end: new Date(toIso), timezone: TZ, source: 'EXPLICIT_RANGE' as const };
}
function item(intentId: string, startIso: string, endIso: string) {
  return { intentId, title: 'Strength training', placementSource: 'SELECTED_CANDIDATE' as const, start: new Date(startIso), end: new Date(endIso) };
}

async function freshUserAndGoal(emailTag: string, activityTitle: string, rhythm?: { kind: 'N_PER_WEEK'; targetPerWeek: number }) {
  const email = `hpg3-a3b-${emailTag}@example.com`;
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

const planCount = async (userId: string) => (await sql(`SELECT count(*)::int n FROM "PlannedActivity" WHERE "userId" = $1`, [userId]))[0].n as number;
const occurrenceCount = async (userId: string) => (await sql(`SELECT count(*)::int n FROM "GoalActivityOccurrence" WHERE "userId" = $1`, [userId]))[0].n as number;

async function main() {
  // ============================================================
  // GROUP 1 -- POST /api/plans -> real {error, code} response fed through
  // the new presentation layer, with BOTH PlannedActivity AND
  // GoalActivityOccurrence counts proven unchanged by the rejection.
  // ============================================================
  for (const [tag, rhythm, offsetMs] of [
    ['weekly', { kind: 'N_PER_WEEK' as const, targetPerWeek: 1 }, DAY],
    ['daily', { kind: 'N_PER_WEEK' as const, targetPerWeek: 5 }, 2 * HOUR],
  ] as const) {
    const { email, user, tok, ga } = await freshUserAndGoal(`g1-${tag}`, 'Strength training', rhythm);
    const res1 = await plansRoute(req(tok, { ...plan('Strength training', 0), goalActivityId: ga.id }));
    check(`1-${tag}. setup: first occurrence saves`, res1.status === 200);
    const plansBefore = await planCount(user.id);
    const occBefore = await occurrenceCount(user.id);
    const res2 = await plansRoute(req(tok, { ...plan('Strength training', offsetMs), goalActivityId: ga.id }));
    const body2 = await res2.json();
    check(`1-${tag}. real response code is known to the UI presentation layer`, isKnownSchedulingEligibilityCode(body2.code));
    const presentation = isKnownSchedulingEligibilityCode(body2.code) ? presentSchedulingEligibilityError(body2.code) : null;
    check(`1-${tag}. presentation severity is "conflict" (genuine scheduling conflict, not a validation failure)`, presentation?.severity === 'conflict');
    check(`1-${tag}. presentation headline/detail are non-empty and distinct from the raw server message`, !!presentation && presentation.headline.length > 0 && presentation.detail !== body2.error);
    check(`1-${tag}. rejection leaves PlannedActivity count unchanged`, (await planCount(user.id)) === plansBefore);
    check(`1-${tag}. rejection leaves GoalActivityOccurrence count unchanged (no occurrence materialized on a rejected write)`, (await occurrenceCount(user.id)) === occBefore);
    await wipe(email, user.id);
  }

  // Unresolved legacy attribution -- its own scenario (needs the logPlannedActivity/deletePlannedActivity technique).
  {
    const { email, user, tok, ga } = await freshUserAndGoal('g1-unresolved', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    const res1 = await plansRoute(req(tok, { ...plan('Strength training', 0), goalActivityId: ga.id }));
    const body1 = await res1.json();
    check('1-unresolved. setup: first occurrence saves', res1.status === 200);
    await logPlannedActivity(user.id, body1.id);
    await sql(`UPDATE "GoalActivityOccurrence" SET "scheduledLocalDate" = NULL, "scheduledLocalTimezone" = NULL WHERE "goalActivityId" = $1`, [ga.id]);
    await deletePlannedActivity(user.id, body1.id);
    const plansBefore = await planCount(user.id);
    const occBefore = await occurrenceCount(user.id);
    const res2 = await plansRoute(req(tok, { ...plan('Strength training', 3 * DAY), goalActivityId: ga.id }));
    const body2 = await res2.json();
    check('1-unresolved. real response code is DAILY_ATTRIBUTION_UNRESOLVED', body2.code === 'DAILY_ATTRIBUTION_UNRESOLVED');
    const presentation = isKnownSchedulingEligibilityCode(body2.code) ? presentSchedulingEligibilityError(body2.code) : null;
    check('1-unresolved. presentation never claims to auto-retry or bypass the check (this ticket\'s own section 4)', !!presentation && !/retry|bypass/i.test(presentation.detail));
    check('1-unresolved. presentation severity is "conflict", distinct from an ordinary daily-capacity message', presentation?.severity === 'conflict' && presentation.headline !== presentSchedulingEligibilityError('DAILY_CAPACITY_EXCEEDED').headline);
    check('1-unresolved. rejection leaves PlannedActivity count unchanged', (await planCount(user.id)) === plansBefore);
    check('1-unresolved. rejection leaves GoalActivityOccurrence count unchanged', (await occurrenceCount(user.id)) === occBefore);
    await wipe(email, user.id);
  }

  // The 2 pre-A3a "blocked" codes: unaffected by A3b, no "conflict" severity, no existing-session concept.
  {
    const { email, user, tok, goal, ga } = await freshUserAndGoal('g1-archived', 'Strength training');
    const { archiveGoal } = await import('../apps/web/lib/db');
    await archiveGoal(user.id, goal.id);
    const plansBefore = await planCount(user.id);
    const res = await plansRoute(req(tok, { ...plan('Strength training', 0), goalActivityId: ga.id }));
    const body = await res.json();
    check('1-archived. code is GOAL_NOT_ACTIVE, severity "blocked"', body.code === 'GOAL_NOT_ACTIVE' && presentSchedulingEligibilityError('GOAL_NOT_ACTIVE').severity === 'blocked');
    check('1-archived. rejection leaves PlannedActivity count unchanged', (await planCount(user.id)) === plansBefore);
    await wipe(email, user.id);
  }

  // ============================================================
  // GROUP 2 -- Day Constructor acceptance: real persistAcceptedConstructedDay
  // result fed through parseAcceptResponseBody + classifyAcceptanceUiState,
  // proving the FAILED UI state carries the right code and non-generic
  // message, with zero persisted-state change.
  // ============================================================
  async function acceptOne(userId: string, ga: { id: string }, offsetMs: number, intentId: string) {
    const startIso = new Date(ANCHOR_MS + offsetMs).toISOString();
    const endIso = new Date(ANCHOR_MS + offsetMs + 20 * 60_000).toISOString();
    const acceptReq: AcceptConstructedDayRequest = {
      clientRequestId: `a3b-${intentId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      constructionWindow: window(isoDateOf(offsetMs), new Date(ANCHOR_MS + offsetMs - HOUR).toISOString(), new Date(ANCHOR_MS + offsetMs + 23 * HOUR).toISOString()),
      proposedItems: [item(intentId, startIso, endIso)],
    };
    const links = new Map([[intentId, ga.id]]);
    return persistAcceptedConstructedDay(userId, acceptReq, new Date(ANCHOR_MS + offsetMs - 1800_000), links);
  }
  {
    const { email, user, ga } = await freshUserAndGoal('g2-daily', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    const r1: any = await acceptOne(user.id, ga, 0, 'i1');
    check('2-daily. setup: first occurrence SAVED', r1.status === 'SAVED');
    const plansBefore = await planCount(user.id);
    const occBefore = await occurrenceCount(user.id);
    const r2: any = await acceptOne(user.id, ga, 2 * HOUR, 'i2');
    check('2-daily. server result carries code DAILY_CAPACITY_EXCEEDED', r2.status === 'SAVE_FAILED' && r2.code === 'DAILY_CAPACITY_EXCEEDED');
    // Simulate the exact client-side round trip: server JSON -> parseAcceptResponseBody -> classifyAcceptanceUiState.
    const clientResult = parseAcceptResponseBody({ status: r2.status, code: r2.code });
    const uiState = classifyAcceptanceUiState(clientResult);
    check('2-daily. UI state classifies as FAILED carrying the code', uiState.kind === 'FAILED' && (uiState as any).code === 'DAILY_CAPACITY_EXCEEDED');
    check('2-daily. UI message is NOT the generic pre-A3b fallback', uiState.kind === 'FAILED' && uiState.message !== "We couldn't save your plan. Try again.");
    check('2-daily. rejection leaves PlannedActivity count unchanged', (await planCount(user.id)) === plansBefore);
    check('2-daily. rejection leaves GoalActivityOccurrence count unchanged', (await occurrenceCount(user.id)) === occBefore);
    await wipe(email, user.id);
  }
  {
    const { email, user, ga } = await freshUserAndGoal('g2-weekly', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 1 });
    const r1: any = await acceptOne(user.id, ga, 0, 'i1');
    check('2-weekly. setup: first occurrence SAVED', r1.status === 'SAVED');
    const plansBefore = await planCount(user.id);
    const r2: any = await acceptOne(user.id, ga, DAY, 'i2');
    const clientResult = parseAcceptResponseBody({ status: r2.status, code: r2.code });
    const uiState = classifyAcceptanceUiState(clientResult);
    check('2-weekly. UI state carries CAPACITY_EXCEEDED and never suggests a different time would help (this ticket\'s own section 3)', uiState.kind === 'FAILED' && (uiState as any).code === 'CAPACITY_EXCEEDED' && !/try a different time/i.test(uiState.message));
    check('2-weekly. rejection leaves PlannedActivity count unchanged', (await planCount(user.id)) === plansBefore);
    await wipe(email, user.id);
  }
  // A codeless SAVE_FAILED path (duplicate Goal link in one request -- REJECTED, not SAVE_FAILED, so use the
  // existing IDEMPOTENCY_CONFLICT-free codeless case directly against the pure functions instead of a new DB scenario,
  // since every codeless-producing failure mode here is already covered live by HPG3-A3a's own suite).
  check('2-codeless. classifyAcceptanceUiState({status:"SAVE_FAILED"}) (no code) is byte-identical to pre-A3b behavior', (() => {
    const s = classifyAcceptanceUiState({ status: 'SAVE_FAILED' });
    return s.kind === 'FAILED' && s.message === "We couldn't save your plan. Try again." && (s as any).code === undefined;
  })());

  // ============================================================
  // GROUP 3 -- Move's own reschedule path shares 3 code strings with
  // schedulingEligibilityError.ts verbatim; proves a REAL MovePlanError
  // carrying DAILY_CAPACITY_EXCEEDED is recognized by the SAME
  // isKnownSchedulingEligibilityCode/presentSchedulingEligibilityError
  // PlanWithAuraView.tsx's reschedule-via-Move catch block now uses, with
  // zero change to Move's own eligibility decision or persisted state.
  // ============================================================
  {
    const { email, user, ga } = await freshUserAndGoal('g3-move-daily', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    const r1: any = await acceptOne(user.id, ga, 0, 'i1');
    check('3-move. setup: first occurrence SAVED', r1.status === 'SAVED');
    const r2: any = await acceptOne(user.id, ga, DAY, 'i2');
    check('3-move. setup: second occurrence (different day) SAVED', r2.status === 'SAVED');
    const plansBefore = await planCount(user.id);
    const occBefore = await occurrenceCount(user.id);
    let moveErrorCode: string | undefined;
    try {
      // Moving the SECOND occurrence onto the SAME day as the first collides with the daily cap.
      await movePlannedActivity(user.id, r2.plans[0].id, { newStartAt: new Date(ANCHOR_MS + 4 * HOUR) });
      check('3-move. Move was expected to reject (daily cap) but did not', false);
    } catch (err) {
      moveErrorCode = err instanceof MovePlanError ? err.code : undefined;
    }
    check('3-move. Move rejects with DAILY_CAPACITY_EXCEEDED (Move\'s own, pre-existing decision -- unchanged by A3b)', moveErrorCode === 'DAILY_CAPACITY_EXCEEDED');
    check('3-move. that exact code is recognized by the shared UI presentation layer', isKnownSchedulingEligibilityCode(moveErrorCode));
    const presentation = isKnownSchedulingEligibilityCode(moveErrorCode) ? presentSchedulingEligibilityError(moveErrorCode) : null;
    check('3-move. presentation severity is "conflict"', presentation?.severity === 'conflict');
    check('3-move. a REJECTED Move leaves PlannedActivity count unchanged (no partial Move, this ticket touches zero Move transaction code)', (await planCount(user.id)) === plansBefore);
    check('3-move. a REJECTED Move leaves GoalActivityOccurrence count unchanged', (await occurrenceCount(user.id)) === occBefore);
    await wipe(email, user.id);
  }

  // ============================================================
  // GROUP 4 -- repeatable-session verification (this ticket's own section
  // 5): MULTIPLE_PER_DAY + weekly Rhythm never produces a daily-capacity
  // code at all -- confirming the new UI code has no stale-copy case to
  // even reach for this combination. Not a new rule; a verification that
  // the backend behavior A2 already shipped is what the UI still sees.
  // ============================================================
  {
    const { email, user, tok, ga } = await freshUserAndGoal('g4-multi', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    await sql(`UPDATE "GoalActivity" SET "dailyFrequencyKind" = 'MULTIPLE_PER_DAY' WHERE id = $1`, [ga.id]);
    const res1 = await plansRoute(req(tok, { ...plan('Strength training', 0), goalActivityId: ga.id }));
    check('4-multi. setup: first same-day occurrence saves', res1.status === 200);
    const res2 = await plansRoute(req(tok, { ...plan('Strength training', 2 * HOUR), goalActivityId: ga.id }));
    const body2 = await res2.json();
    check('4-multi. a SECOND same-day occurrence for MULTIPLE_PER_DAY succeeds (no daily-capacity code reaches the UI at all)', res2.status === 200 && body2.code === undefined);
    // Fill the weekly target (5) entirely with same-day occurrences --
    // only possible because dailyFrequencyKind is MULTIPLE_PER_DAY; a
    // ONCE_PER_DAY activity would have hit DAILY_CAPACITY_EXCEEDED long
    // before this.
    for (const offset of [4 * HOUR, 6 * HOUR, 8 * HOUR]) {
      const r = await plansRoute(req(tok, { ...plan('Strength training', offset), goalActivityId: ga.id }));
      const b = await r.json();
      check(`4-multi. occurrence at +${offset / HOUR}h (still within weekly target 5) succeeds with no code`, r.status === 200 && b.code === undefined);
    }
    const res6 = await plansRoute(req(tok, { ...plan('Strength training', 10 * HOUR), goalActivityId: ga.id }));
    const body6 = await res6.json();
    check('4-multi. the 6th occurrence against a weekly target of 5 correctly hits CAPACITY_EXCEEDED (weekly limit still enforced), never a daily code', body6.code === 'CAPACITY_EXCEEDED');
    const presentation = isKnownSchedulingEligibilityCode(body6.code) ? presentSchedulingEligibilityError(body6.code) : null;
    check('4-multi. the UI presentation for that rejection is the weekly-limit copy, not the daily one', presentation?.headline === presentSchedulingEligibilityError('CAPACITY_EXCEEDED').headline);
    await wipe(email, user.id);
  }

  if (!allPassed) {
    console.error('SOME SCHEDULING ELIGIBILITY UI PRESENTATION DB CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL SCHEDULING ELIGIBILITY UI PRESENTATION DB CHECKS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
