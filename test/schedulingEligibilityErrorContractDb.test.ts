// HPG3-A3a -- live-database proof of the consistent, typed scheduling
// eligibility error contract across all three Goal-linked write paths:
// POST /api/plans, Day Constructor acceptance, and Move. Uses fixed,
// explicit UTC instants anchored to 2026-12-15 (a safe, uncollided future
// date), same convention as test/goalActivityDailyOccurrenceEligibilityDb.test.ts.
// Run with: npx ts-node test/schedulingEligibilityErrorContractDb.test.ts
import { POST as plansRoute } from '../apps/web/app/api/plans/route';
import { POST as acceptRoute } from '../apps/web/app/api/day-constructor/accept/route';
import {
  upsertUserByEmail,
  createGoalWithActivities,
  addGoalActivity,
  archiveGoal,
  beginTransaction,
  logPlannedActivity,
  deletePlannedActivity,
} from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { movePlannedActivity, MovePlanError } from '../apps/web/lib/planMove';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import type { AcceptConstructedDayRequest } from '../apps/web/lib/dayConstructorAcceptance';
import { signPreviewItem } from '../apps/web/lib/dayConstructorPreviewIntegrity';
import { parseAcceptResponseBody } from '../apps/web/lib/acceptConstructedDay';
import { classifyAcceptanceUiState } from '../apps/web/lib/dayPlanAcceptancePresentation';

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

// 2026-12-15T06:30:00Z = 2026-12-15 12:00 IST (mid-day, no midnight-adjacent ambiguity).
const ANCHOR_MS = Date.parse('2026-12-15T06:30:00Z');
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
  const email = `hpg3-a3a-${emailTag}@example.com`;
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

async function main() {
  // ============================================================
  // GROUP 1 -- POST /api/plans
  // ============================================================
  {
    const { email, user, tok, ga } = await freshUserAndGoal('g1-weekly', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 1 });
    const res1 = await plansRoute(req(tok, { ...plan('Strength training', 0), goalActivityId: ga.id }));
    check('1a. setup: first occurrence saves (weekly target 1)', res1.status === 200);
    const before = await planCount(user.id);
    const res2 = await plansRoute(req(tok, { ...plan('Strength training', DAY), goalActivityId: ga.id }));
    const body2 = await res2.json();
    check('1a. weekly capacity exceeded -> 409, code CAPACITY_EXCEEDED', res2.status === 409 && body2.code === 'CAPACITY_EXCEEDED');
    check('1a. rejected transaction leaves no partial write (PlannedActivity count unchanged)', (await planCount(user.id)) === before);
    await wipe(email, user.id);
  }
  {
    const { email, user, tok, ga } = await freshUserAndGoal('g1-daily', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    const res1 = await plansRoute(req(tok, { ...plan('Strength training', 0), goalActivityId: ga.id }));
    check('1b. setup: first occurrence saves (daily cap default ONCE_PER_DAY)', res1.status === 200);
    const before = await planCount(user.id);
    const res2 = await plansRoute(req(tok, { ...plan('Strength training', 2 * HOUR), goalActivityId: ga.id }));
    const body2 = await res2.json();
    check('1b. daily capacity exceeded -> 409, code DAILY_CAPACITY_EXCEEDED', res2.status === 409 && body2.code === 'DAILY_CAPACITY_EXCEEDED');
    check('1b. rejected transaction leaves no partial write', (await planCount(user.id)) === before);
    await wipe(email, user.id);
  }
  {
    const { email, user, tok, ga } = await freshUserAndGoal('g1-unresolved', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    const res1 = await plansRoute(req(tok, { ...plan('Strength training', 0), goalActivityId: ga.id }));
    const body1 = await res1.json();
    check('1c. setup: first occurrence saves', res1.status === 200);
    // Real completion (creates the durable GoalActivityExecution via the
    // production writer), then simulate a pre-A2 legacy row (no snapshot)
    // and hard-delete the plan -- the exact same technique
    // test/goalActivityDailyOccurrenceEligibilityDb.test.ts's own
    // scenario 12b already established.
    await logPlannedActivity(user.id, body1.id);
    await sql(`UPDATE "GoalActivityOccurrence" SET "scheduledLocalDate" = NULL, "scheduledLocalTimezone" = NULL WHERE "goalActivityId" = $1`, [ga.id]);
    await deletePlannedActivity(user.id, body1.id);
    const before = await planCount(user.id);
    const res2 = await plansRoute(req(tok, { ...plan('Strength training', 3 * DAY), goalActivityId: ga.id }));
    const body2 = await res2.json();
    check('1c. unresolved legacy attribution -> 409, code DAILY_ATTRIBUTION_UNRESOLVED', res2.status === 409 && body2.code === 'DAILY_ATTRIBUTION_UNRESOLVED');
    check('1c. rejected transaction leaves no partial write', (await planCount(user.id)) === before);
    await wipe(email, user.id);
  }
  {
    const { email, user, tok, goal, ga } = await freshUserAndGoal('g1-archived', 'Strength training');
    await archiveGoal(user.id, goal.id);
    const before = await planCount(user.id);
    const res = await plansRoute(req(tok, { ...plan('Strength training', 0), goalActivityId: ga.id }));
    const body = await res.json();
    check('1d. archived Goal -> 400 (unchanged status), code GOAL_NOT_ACTIVE', res.status === 400 && body.code === 'GOAL_NOT_ACTIVE');
    check('1d. message text unchanged from pre-A3a', body.error === 'That goal is no longer active, so a new plan cannot be linked to it.');
    check('1d. rejected transaction leaves no partial write', (await planCount(user.id)) === before);
    await wipe(email, user.id);
  }
  {
    const owner = await freshUserAndGoal('g1-owner', 'Strength training');
    const other = await freshUserAndGoal('g1-other', 'Strength training');
    const before = await planCount(other.user.id);
    // other user's token, OWNER's goalActivityId.
    const res = await plansRoute(req(other.tok, { ...plan('Strength training', 0), goalActivityId: owner.ga.id }));
    const body = await res.json();
    check('1e. cross-user link attempt -> 400 (unchanged status), code GOAL_ACTIVITY_NOT_AVAILABLE', res.status === 400 && body.code === 'GOAL_ACTIVITY_NOT_AVAILABLE');
    check('1e. message text unchanged from pre-A3a', body.error === 'That goal activity is not available to link right now.');
    check('1e. rejected transaction leaves no partial write', (await planCount(other.user.id)) === before);
    await wipe(owner.email, owner.user.id);
    await wipe(other.email, other.user.id);
  }
  {
    const { email, user, tok, ga } = await freshUserAndGoal('g1-success', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 3 });
    const res = await plansRoute(req(tok, { ...plan('Strength training', 0), goalActivityId: ga.id }));
    const body = await res.json();
    check('1f. successful scheduling unchanged: 200, no code field, real plan body', res.status === 200 && body.code === undefined && typeof body.id === 'string');
    await wipe(email, user.id);
  }
  {
    // Existing authorization error (401) unchanged -- no session.
    const res = await plansRoute(req(null, { ...plan('Strength training', 0) }));
    check('1g. existing 401 unauthenticated behavior unchanged', res.status === 401);
  }

  // ============================================================
  // GROUP 2 -- Day Constructor acceptance (persistAcceptedConstructedDay)
  // ============================================================
  async function acceptOne(userId: string, tz: string, ga: { id: string }, offsetMs: number, intentId: string) {
    const startIso = new Date(ANCHOR_MS + offsetMs).toISOString();
    const endIso = new Date(ANCHOR_MS + offsetMs + 20 * 60_000).toISOString();
    const req: AcceptConstructedDayRequest = {
      clientRequestId: `a3a-${intentId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      constructionWindow: window(isoDateOf(offsetMs), new Date(ANCHOR_MS + offsetMs - HOUR).toISOString(), new Date(ANCHOR_MS + offsetMs + 23 * HOUR).toISOString()),
      proposedItems: [item(intentId, startIso, endIso)],
    };
    const links = new Map([[intentId, ga.id]]);
    return persistAcceptedConstructedDay(userId, req, new Date(ANCHOR_MS + offsetMs - 1800_000), links);
  }
  {
    const { email, user, ga } = await freshUserAndGoal('g2-weekly', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 1 });
    const r1 = await acceptOne(user.id, TZ, ga, 0, 'i1');
    check('2a. setup: first occurrence SAVED', r1.status === 'SAVED');
    const before = await planCount(user.id);
    const r2: any = await acceptOne(user.id, TZ, ga, DAY, 'i2');
    check('2a. weekly capacity exceeded -> SAVE_FAILED, code CAPACITY_EXCEEDED', r2.status === 'SAVE_FAILED' && r2.code === 'CAPACITY_EXCEEDED');
    check('2a. rejected transaction leaves no partial write', (await planCount(user.id)) === before);
    await wipe(email, user.id);
  }
  {
    const { email, user, ga } = await freshUserAndGoal('g2-daily', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    const r1 = await acceptOne(user.id, TZ, ga, 0, 'i1');
    check('2b. setup: first occurrence SAVED', r1.status === 'SAVED');
    const before = await planCount(user.id);
    const r2: any = await acceptOne(user.id, TZ, ga, 2 * HOUR, 'i2');
    check('2b. daily capacity exceeded -> SAVE_FAILED, code DAILY_CAPACITY_EXCEEDED', r2.status === 'SAVE_FAILED' && r2.code === 'DAILY_CAPACITY_EXCEEDED');
    check('2b. rejected transaction leaves no partial write', (await planCount(user.id)) === before);
    await wipe(email, user.id);
  }
  {
    const { email, user, ga } = await freshUserAndGoal('g2-unresolved', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    const r1: any = await acceptOne(user.id, TZ, ga, 0, 'i1');
    check('2c. setup: first occurrence SAVED', r1.status === 'SAVED');
    await logPlannedActivity(user.id, r1.plans[0].id);
    await sql(`UPDATE "GoalActivityOccurrence" SET "scheduledLocalDate" = NULL, "scheduledLocalTimezone" = NULL WHERE "goalActivityId" = $1`, [ga.id]);
    await deletePlannedActivity(user.id, r1.plans[0].id);
    const before = await planCount(user.id);
    const r2: any = await acceptOne(user.id, TZ, ga, 3 * DAY, 'i2');
    check('2c. unresolved legacy attribution -> SAVE_FAILED, code DAILY_ATTRIBUTION_UNRESOLVED', r2.status === 'SAVE_FAILED' && r2.code === 'DAILY_ATTRIBUTION_UNRESOLVED');
    check('2c. rejected transaction leaves no partial write', (await planCount(user.id)) === before);
    await wipe(email, user.id);
  }
  {
    const owner = await freshUserAndGoal('g2-owner', 'Strength training');
    const other = await freshUserAndGoal('g2-other', 'Strength training');
    const before = await planCount(other.user.id);
    const r: any = await acceptOne(other.user.id, TZ, owner.ga, 0, 'i1');
    check('2d. cross-user link attempt -> SAVE_FAILED, code GOAL_ACTIVITY_NOT_AVAILABLE', r.status === 'SAVE_FAILED' && r.code === 'GOAL_ACTIVITY_NOT_AVAILABLE');
    check('2d. rejected transaction leaves no partial write', (await planCount(other.user.id)) === before);
    await wipe(owner.email, owner.user.id);
    await wipe(other.email, other.user.id);
  }
  {
    const { email, user, ga } = await freshUserAndGoal('g2-success', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 3 });
    const r: any = await acceptOne(user.id, TZ, ga, 0, 'i1');
    check('2e. successful scheduling unchanged: SAVED, one plan, no code field', r.status === 'SAVED' && r.plans.length === 1 && r.code === undefined);
    await wipe(email, user.id);
  }

  // ============================================================
  // GROUP 3 -- Day Constructor accept ROUTE (HTTP layer): confirms the
  // thin status/code mapping wrapper itself, using a directly-signed
  // single-item token (bypassing the full preview pipeline, same
  // technique dayConstructorPreviewIntegrity.ts's own signPreviewItem
  // exposes for exactly this purpose).
  // ============================================================
  {
    const { email, user, ga } = await freshUserAndGoal('g3-daily', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    const mkBody = (offsetMs: number, intentId: string) => {
      const win = window(isoDateOf(offsetMs), new Date(ANCHOR_MS + offsetMs - HOUR).toISOString(), new Date(ANCHOR_MS + offsetMs + 23 * HOUR).toISOString());
      const start = new Date(ANCHOR_MS + offsetMs);
      const end = new Date(start.getTime() + 20 * 60_000);
      const token = signPreviewItem({ userId: user.id, window: win, item: { intentId, activityId: undefined, title: 'Strength training', start, end, placementSource: 'SELECTED_CANDIDATE' } });
      return {
        clientRequestId: `a3a-route-${intentId}-${Date.now()}`,
        constructionWindow: { date: win.date, start: win.start.toISOString(), end: win.end.toISOString(), timezone: win.timezone, source: win.source },
        proposedItems: [{ intentId, title: 'Strength training', start: start.toISOString(), end: end.toISOString(), placementSource: 'SELECTED_CANDIDATE', acceptanceToken: token }],
        goalActivityLinks: [{ intentId, goalActivityId: ga.id }],
      };
    };
    const fakeReq = (body: unknown): any => ({ cookies: { get: () => ({ value: createSessionToken(user.id, user.email) }) }, json: async () => body, headers: new Headers() });
    const res1 = await acceptRoute(fakeReq(mkBody(0, 'i1')));
    const body1 = await res1.json();
    check('3a. route success unchanged: 200, SAVED, no code field', res1.status === 200 && body1.status === 'SAVED' && body1.code === undefined);
    const res2 = await acceptRoute(fakeReq(mkBody(2 * HOUR, 'i2')));
    const body2 = await res2.json();
    check('3a. route daily capacity exceeded -> HTTP 409, status SAVE_FAILED, code DAILY_CAPACITY_EXCEEDED', res2.status === 409 && body2.status === 'SAVE_FAILED' && body2.code === 'DAILY_CAPACITY_EXCEEDED');
    await wipe(email, user.id);
  }

  // ============================================================
  // GROUP 4 -- Move (planMove.ts, UNCHANGED by this PR): regression-only
  // proof that Move's own, pre-existing typed codes still work exactly
  // as before -- this PR reuses their string values, never redefines them.
  // ============================================================
  {
    const { email, user, ga } = await freshUserAndGoal('g4-weekly', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 1 });
    const r1: any = await acceptOne(user.id, TZ, ga, 0, 'i1');
    check('4a. setup: first occurrence SAVED', r1.status === 'SAVED');
    const planId = r1.plans[0].id;
    // Fill week capacity with a second occurrence on a DIFFERENT GoalActivity-free day isn't needed: directly attempt
    // a Move INTO a day that would, combined with the existing occurrence, exceed the weekly target of 1.
    const moveCode = await (async () => {
      try { await movePlannedActivity(user.id, planId, { newStartAt: new Date(ANCHOR_MS + 2 * HOUR) }); return 'OK'; }
      catch (e) { return e instanceof MovePlanError ? e.code : 'OTHER'; }
    })();
    // Moving within the SAME week to a different day/time keeps weekly capacity satisfied (still exactly one
    // occurrence) -- this call should succeed, proving Move's own logic is untouched, not exercising a rejection.
    check('4a. Move regression smoke test: ordinary same-week Move still succeeds (code path untouched)', moveCode === 'OK');
    await wipe(email, user.id);
  }
  {
    const { email, user, ga } = await freshUserAndGoal('g4-daily', 'Strength training', { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    const r1: any = await acceptOne(user.id, TZ, ga, 0, 'i1');
    const r2: any = await acceptOne(user.id, TZ, ga, DAY, 'i2');
    check('4b. setup: two occurrences on different days SAVED', r1.status === 'SAVED' && r2.status === 'SAVED');
    const planId2 = r2.plans[0].id;
    const moveCode = await (async () => {
      try { await movePlannedActivity(user.id, planId2, { newStartAt: new Date(ANCHOR_MS + 2 * HOUR) }); return 'OK'; }
      catch (e) { return e instanceof MovePlanError ? e.code : 'OTHER'; }
    })();
    check('4b. Move into an already-occupied day -> DAILY_CAPACITY_EXCEEDED (unchanged, pre-existing Move behavior)', moveCode === 'DAILY_CAPACITY_EXCEEDED');
    await wipe(email, user.id);
  }

  // ============================================================
  // GROUP 5 -- Existing UI consumer non-regression (pure, no DB).
  // ============================================================
  {
    const plain = parseAcceptResponseBody({ status: 'SAVE_FAILED' });
    check('5a. parseAcceptResponseBody: a bare SAVE_FAILED body (pre-A3a shape) still parses with no code', plain.status === 'SAVE_FAILED' && (plain as any).code === undefined);
    const withCode = parseAcceptResponseBody({ status: 'SAVE_FAILED', code: 'DAILY_CAPACITY_EXCEEDED' });
    check('5b. parseAcceptResponseBody: a known code is parsed through additively', withCode.status === 'SAVE_FAILED' && (withCode as any).code === 'DAILY_CAPACITY_EXCEEDED');
    const unknownCode = parseAcceptResponseBody({ status: 'SAVE_FAILED', code: 'NOT_A_REAL_CODE' });
    check('5c. parseAcceptResponseBody: an unrecognized code is dropped, never trusted blindly', unknownCode.status === 'SAVE_FAILED' && (unknownCode as any).code === undefined);

    const stateNoCode = classifyAcceptanceUiState(plain);
    const stateWithCode = classifyAcceptanceUiState(withCode);
    check('5d. classifyAcceptanceUiState: SAVE_FAILED with or without a code renders the IDENTICAL UI state/message (no UI redesign)', JSON.stringify(stateNoCode) === JSON.stringify(stateWithCode) && stateNoCode.kind === 'FAILED' && (stateNoCode as any).message === "We couldn't save your plan. Try again.");
  }

  if (!allPassed) { console.error('SOME SCHEDULING ELIGIBILITY ERROR CONTRACT CHECKS FAILED'); process.exit(1); }
  console.log('ALL SCHEDULING ELIGIBILITY ERROR CONTRACT CHECKS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
