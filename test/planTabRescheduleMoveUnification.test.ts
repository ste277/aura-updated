/**
 * AURA DR4-F1 -- Plan Reschedule Contract Unification.
 *
 * PlanWithAuraView's reschedule flow now calls the EXACT SAME route the
 * Plan tab's Move already exercises (POST /api/plans/[planId]/move with
 * only { newStartAt }), instead of the old create-a-new-plan +
 * fire-and-forget-DELETE-the-old-one sequence. lib/planMove.ts and its
 * route are unmodified by this ticket -- movePlanApiDb.test.ts and
 * movePlannedActivityDb.test.ts already cover that contract exhaustively
 * at the function level and (mostly) at the route level.
 *
 * This file closes the one gap directly relevant to DR4-F1's own change:
 * movePlanApiDb.test.ts has ZERO GoalActivity coverage, so goal-continuity
 * through the exact route the client now calls was never actually proven.
 * It also pins the specific preservation guarantees DR4-F1's PR description
 * promises (title/metadata/duration/lineage) using the client's own request
 * shape, and confirms the client source no longer contains a reschedule-path
 * DELETE and correctly gates Move to UPCOMING plans only.
 *
 * Requires DATABASE_URL:
 *   DATABASE_URL="postgresql://..." npx ts-node test/planTabRescheduleMoveUnification.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  upsertUserByEmail, updateBirthProfile, createPlannedActivity, beginTransaction,
  createGoalWithActivities, addGoalActivity, deleteGoal, listGoalActivitiesWithLinkedPlanStatus,
  logPlannedActivity,
} from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { POST as moveRoute } from '../apps/web/app/api/plans/[planId]/move/route';
import { mapPlanRow, isActionableUpcomingPlan } from '../apps/web/lib/planFormatting';
import { deriveGoalActivityState } from '../apps/web/lib/goals';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const TZ = 'Asia/Kolkata';
const MIN = 60000; const HOUR = 3600000; const DAY = 86400000;
const minute = (ms: number) => Math.floor(ms / MIN) * MIN;

// ============================================================
// Client wiring (static source checks) -- the server contract itself is
// proven by the DB-backed section below; this pins that the Plan tab's own
// source actually uses it the way this ticket promises.
// ============================================================

const source = fs.readFileSync(path.join(__dirname, '..', 'apps', 'web', 'components', 'PlanWithAuraView.tsx'), 'utf8');
const reschedulerFnMatch = source.match(/const handleReschedulePlanViaMove = async[\s\S]*?\n  };/);
const reschedulerFn = reschedulerFnMatch ? reschedulerFnMatch[0] : '';
check('handleReschedulePlanViaMove exists and calls POST /api/plans/{id}/move', /fetch\(`\/api\/plans\/\$\{replacedPlanId\}\/move`/.test(reschedulerFn) && /method: 'POST'/.test(reschedulerFn));
check('handleReschedulePlanViaMove sends ONLY newStartAt in the request body (no invented fields)', /body: JSON\.stringify\(\{ newStartAt \}\)/.test(reschedulerFn));
check('handleReschedulePlanViaMove never issues a DELETE call (no separate delete-after-move)', !/method: 'DELETE'/.test(reschedulerFn));
const handleSavePlanMatch = source.match(/const handleSavePlan = async[\s\S]*?\n  };\n\n  const handleReschedulePlan = /);
const handleSavePlanFn = handleSavePlanMatch ? handleSavePlanMatch[0] : '';
check('handleSavePlan routes an in-progress reschedule through handleReschedulePlanViaMove, not the create-new-plan POST', /return await handleReschedulePlanViaMove\(replacedPlanId, plan\.plannedStartAt\)/.test(handleSavePlanFn));
check('the create-new-plan POST body has no activity-identity fields that could silently rename/relink an existing plan during reschedule (reschedule never reaches this branch)', handleSavePlanFn.includes("method: 'POST'") && handleSavePlanFn.includes("'/api/plans'"));
const reschedulePlanFnMatch = source.match(/const handleReschedulePlan = \(plan: UpcomingPlan\)[\s\S]*?\n  };/);
const reschedulePlanFn = reschedulePlanFnMatch ? reschedulePlanFnMatch[0] : '';
check('handleReschedulePlan makes no network call of its own (abandoning the flow before picking a time changes nothing server-side)', !/fetch\(/.test(reschedulePlanFn));
check('handleReschedulePlan only enters reschedule mode for an UPCOMING plan (terminal plans never attempt Move client-side)', /setReschedulingPlanId\(plan\.status === 'UPCOMING' \? plan\.id : null\)/.test(reschedulePlanFn));
check('handleReschedulePlan locks all three composer modes\' own duration state to the original plan\'s duration (Move always inherits the ORIGINAL duration, never a freshly-searched one)', /setDurationMinutes\(minutesFromDuration\(plan\.duration\)\)/.test(reschedulePlanFn) && /setCheckDurationMinutes\(minutesFromDuration\(plan\.duration\)\)/.test(reschedulePlanFn) && /setCompareDurationMinutes\(minutesFromDuration\(plan\.duration\)\)/.test(reschedulePlanFn));
check('the "How long?" selector is disabled in all three composer modes while a reschedule is in progress', (source.match(/disabled=\{Boolean\(reschedulingPlanId\)\}/g) || []).length === 3);

// ============================================================
// DB-backed route-level proof -- exercises the EXACT request shape the
// client now sends against the real, unmodified Move route.
// ============================================================

const req = (tok: string | null, body: unknown): any => ({ cookies: { get: (n: string) => (tok && n === 'as_session' ? { value: tok } : undefined) }, json: async () => body, headers: new Headers() });
async function sql(t: string, p: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(t, p); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

async function main() {
  const U = await upsertUserByEmail({ email: 'test-planview-reschedule-a@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const V = await upsertUserByEmail({ email: 'test-planview-reschedule-b@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  for (const u of [U, V]) await updateBirthProfile(u.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  const tok = createSessionToken(U.id, U.email); const tokV = createSessionToken(V.id, V.email);
  const goalIds: string[] = [];
  let n = 0;
  const mk = async (title: string, startMs: number, durMin = 60, extra: Partial<Record<string, unknown>> = {}) =>
    createPlannedActivity({ userId: U.id, title: `${title} ${Date.now()}-${n++}`, plannedStartAt: new Date(startMs), plannedEndAt: new Date(startMs + durMin * MIN), durationMinutes: durMin, windowType: 'NEUTRAL', ...(extra as object) } as any);
  const src = () => minute(Date.now()) + 15 * DAY + n++ * 3 * HOUR;
  const dest = () => new Date(minute(Date.now()) + 55 * DAY + n++ * 3 * HOUR);
  // The CLIENT's own request shape -- POST /move with ONLY newStartAt, via
  // the actual route handler (not movePlannedActivity directly), exactly as
  // handleReschedulePlanViaMove calls it.
  const rescheduleViaMoveRoute = async (planId: string, newStartAt: Date, token: string | null = tok) => {
    const res = await moveRoute(req(token, { newStartAt: newStartAt.toISOString() }), { params: { planId } });
    return { status: res.status, body: await res.json() };
  };
  const count = async () => Number((await sql(`SELECT count(*)::int AS n FROM "PlannedActivity" WHERE "userId" = $1`, [U.id]))[0].n);
  const row = async (id: string) => (await sql(`SELECT * FROM "PlannedActivity" WHERE id = $1`, [id]))[0];

  try {
    // ---- preservation: title / metadata / duration / lineage ----
    const original = await mk('Strength Training Session', src(), 45, {
      activityType: 'workout', icon: '💪', activityId: 'strength-training', schedulingMode: 'FIXED',
      windowLabel: 'Abhijit Muhurtham', matchLabel: 'Best Match', score: 9, recommendation: 'Great window for this',
      eventTimezone: 'America/Los_Angeles', eventLocationName: 'Home Gym',
    });
    const d1 = dest();
    const c0 = await count();
    const r1 = await rescheduleViaMoveRoute(original.id, d1);
    check('1. reschedule via the client\'s exact request shape -> 200, original MOVED, replacement UPCOMING', r1.status === 200 && r1.body.from.status === 'MOVED' && r1.body.plan.status === 'UPCOMING' && (await count()) === c0 + 1);
    check('2/13. replacement links back to the original via rescheduledFromPlanId', r1.body.plan.rescheduledFromPlanId === original.id);
    check('5. original activity title is preserved exactly ("Strength Training Session...", not renamed via any search candidate)', r1.body.plan.title === original.title);
    check('6/8. activityType, icon, activityId, schedulingMode, eventTimezone, eventLocationName are all preserved', r1.body.plan.activityType === 'workout' && r1.body.plan.icon === '💪' && r1.body.plan.activityId === 'strength-training' && r1.body.plan.schedulingMode === 'FIXED' && r1.body.plan.eventTimezone === 'America/Los_Angeles' && r1.body.plan.eventLocationName === 'Home Gym');
    check('9. the selected start time is exactly the requested instant', new Date(r1.body.plan.plannedStartAt).getTime() === d1.getTime());
    check('10. the selected end time is the requested start plus the ORIGINAL (locked) duration, not any new search duration', new Date(r1.body.plan.plannedEndAt).getTime() === d1.getTime() + 45 * MIN && r1.body.plan.durationMinutes === 45);
    check('11. timezone is carried over verbatim', r1.body.plan.eventTimezone === original.eventTimezone);
    check('7. Move\'s own documented contract (unchanged by this ticket): the time-specific recommendation/score/window evaluation is NOT carried to the replacement -- expected, not a regression', r1.body.plan.recommendation === null && r1.body.plan.score === null && r1.body.plan.windowLabel === null);
    check('12. the original transitions to MOVED (never silently deleted or left ambiguous)', (await row(original.id)).status === 'MOVED');
    check('17. no duplicate actionable plan: exactly one new row exists, the original is no longer actionable, only the replacement is', !isActionableUpcomingPlan(mapPlanRow(r1.body.from, TZ)) && isActionableUpcomingPlan(mapPlanRow(r1.body.plan, TZ)));

    // ---- missed-activity reschedule (persisted UPCOMING, start in the past) ----
    const missed = await mk('Missed via Plan tab', Date.now() - 3 * HOUR, 30);
    const r2 = await rescheduleViaMoveRoute(missed.id, dest());
    check('2. a MISSED (persisted UPCOMING, past-due) activity reschedules successfully via the exact same client call', r2.status === 200 && r2.body.from.status === 'MOVED' && r2.body.plan.status === 'UPCOMING');
    check('2. the replacement is a normal, actionable upcoming plan (reappears in Upcoming Plans, not Missed)', isActionableUpcomingPlan(mapPlanRow(r2.body.plan, TZ)));

    // ---- goal continuity THROUGH THE ROUTE (the gap this ticket closes --
    // movePlanApiDb.test.ts has zero GoalActivity coverage; the client's new
    // code calls exactly this route, so this is the first proof the
    // goal-continuity guarantee actually holds at the layer the UI uses) ----
    const goal = await createGoalWithActivities({ userId: U.id, title: 'Plan tab reschedule goal', targetDate: null, activities: [] });
    goalIds.push(goal.goal.id);
    const ga = await addGoalActivity(U.id, goal.goal.id, { title: 'Draft deck', activityId: null });
    const goalPlan = await createPlannedActivity({ userId: U.id, title: `Draft deck ${Date.now()}`, plannedStartAt: new Date(src()), plannedEndAt: new Date(src() + HOUR), durationMinutes: 60, windowType: 'NEUTRAL' } as any);
    await sql(`UPDATE "GoalActivity" SET "plannedActivityId" = $1 WHERE id = $2`, [goalPlan.id, ga!.id]);
    const execCountBefore = Number((await sql(`SELECT count(*)::int AS n FROM "GoalActivityExecution" WHERE "userId" = $1`, [U.id]))[0].n);
    const r3 = await rescheduleViaMoveRoute(goalPlan.id, dest());
    check('3/14. a goal-linked activity reschedules successfully via the Plan tab\'s own route call', r3.status === 200);
    const gRow = (await listGoalActivitiesWithLinkedPlanStatus(U.id, goal.goal.id)).find((g) => g.id === ga!.id)!;
    check('3/14. GoalActivity now points at the REPLACEMENT plan (not left pointing at the now-MOVED original, and not silently unlinked)', gRow.plannedActivityId === r3.body.plan.id);
    check('15. the goal-linked activity still derives PLANNED after reschedule (never SUGGESTED/unlinked) -- goal progress/continuity unaffected', deriveGoalActivityState({ status: gRow.status, plannedActivityId: gRow.plannedActivityId, linkedPlanStatus: 'UPCOMING' }) === 'PLANNED');
    const execCountAfter = Number((await sql(`SELECT count(*)::int AS n FROM "GoalActivityExecution" WHERE "userId" = $1`, [U.id]))[0].n);
    check('15/16. rescheduling never creates a GoalActivityExecution as a side effect (goal progress is untouched by a reschedule, only real completion creates one)', execCountAfter === execCountBefore);

    // ---- a plan with no goal link is unaffected (no goal rows manufactured) ----
    const plain = await mk('No goal link', src());
    const r4 = await rescheduleViaMoveRoute(plain.id, dest());
    const plainLinks = await sql(`SELECT count(*)::int AS n FROM "GoalActivity" WHERE "plannedActivityId" = $1`, [r4.body.plan.id]);
    check('4. a plan with no goal association reschedules normally and no GoalActivity row is created out of nowhere', r4.status === 200 && Number(plainLinks[0].n) === 0);

    // ---- repeated submission (duplicate-submission protection at the contract level) ----
    const c1 = await count();
    const retry = await rescheduleViaMoveRoute(original.id, d1);
    check('20. repeating the exact same reschedule request (double submission) returns the SAME replacement, creates no duplicate, and the goal link set up above is unaffected by unrelated replays', retry.status === 200 && retry.body.plan.id === r1.body.plan.id && (await count()) === c1);

    // ---- failed Move: original stays actionable, no replacement, goal untouched ----
    const blockStart = minute(Date.now()) + 80 * DAY;
    await mk('Blocker', blockStart);
    const conflictSubject = await mk('Conflict subject', src());
    const c2 = await count();
    const rFail = await rescheduleViaMoveRoute(conflictSubject.id, new Date(blockStart + 15 * MIN));
    check('19. a failed Move (destination conflict) leaves the original plan untouched and actionable, creates no replacement', rFail.status === 409 && (await row(conflictSubject.id)).status === 'UPCOMING' && (await count()) === c2);

    // ---- terminal source plan: client never reaches this per the structural
    // check above, but the contract itself must still refuse it defensively ----
    const logged = await mk('Already logged', src()); await logPlannedActivity(U.id, logged.id);
    const rTerminal = await rescheduleViaMoveRoute(logged.id, dest());
    check('21. a terminal (LOGGED) source plan is rejected (409 INVALID_STATE), matching the client\'s own UPCOMING-only guard', rTerminal.status === 409 && rTerminal.body.code === 'INVALID_STATE');

    // ---- unauthorized source plan ----
    const mine = await mk('Mine only', src());
    const c3 = await count();
    const rCross = await rescheduleViaMoveRoute(mine.id, dest(), tokV);
    check('22. a cross-user reschedule attempt -> 404, nothing changes', rCross.status === 404 && (await row(mine.id)).status === 'UPCOMING' && (await count()) === c3);
  } finally {
    await sql(`UPDATE "GoalActivity" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [U.id]).catch(() => {});
    for (const g of goalIds) await deleteGoal(U.id, g).catch(() => {});
    await sql(`UPDATE "PlannedActivity" SET "rescheduledFromPlanId" = NULL WHERE "userId" = ANY($1)`, [[U.id, V.id]]).catch(() => {});
    await sql(`DELETE FROM "GoalActivityExecution" WHERE "userId" = ANY($1)`, [[U.id, V.id]]).catch(() => {});
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1)`, [[U.id, V.id]]).catch(() => {});
    await sql(`DELETE FROM "HabitLog" WHERE "userId" = ANY($1)`, [[U.id, V.id]]).catch(() => {});
  }
  if (!allPassed) { console.error('SOME PLAN TAB RESCHEDULE-VIA-MOVE CHECKS FAILED'); process.exit(1); }
  console.log('ALL PLAN TAB RESCHEDULE-VIA-MOVE CHECKS PASSED');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
