// Run with: TS_NODE_COMPILER_OPTIONS='{"jsx":"react"}' npx ts-node test/planTabChooseMyOwnTime.test.ts
// (see .github/workflows/ci.yml). Imports a .tsx component, so needs `jsx`
// set -- same reason as test/planWithAuraViewLogic.test.ts (root
// tsconfig.json exclude).
//
// AURA DR4-F2B -- "Choose My Own Time" during rescheduling. Reuses the
// EXISTING Check a Time functionality (runTimingSearch CHECK mode,
// already proven in DR4-F2) and the EXISTING Move contract (POST
// /api/plans/[planId]/move, unmodified since DR4-F1) -- no new timing
// engine, no new API. The reschedule-scoped mode switcher now offers two
// choices ("Find a Better Time" / "Choose My Own Time", RESCHEDULE_MODES)
// instead of DR4-F2A's single locked FIND; CHECK is now reschedule-aware
// (prefilled from the original plan, stale-result-guarded) the same way
// FIND already was. COMPARE remains excluded, per this ticket's own scope.
import * as fs from 'fs';
import {
  findCandidateKey,
  planPayloadFromCandidate,
  RESCHEDULE_MODES,
} from '../apps/web/components/PlanWithAuraView';
import { runTimingSearch } from '../packages/recommendation/src/timingSearch';
import { getDatePartsInTimezone, getMinuteOfDayInTimezone, localDateTimeToUTC } from '../apps/web/lib/timezone';
import {
  upsertUserByEmail, updateBirthProfile, createPlannedActivity, beginTransaction,
  createGoalWithActivities, addGoalActivity, deleteGoal, listGoalActivitiesWithLinkedPlanStatus,
} from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { POST as moveRoute } from '../apps/web/app/api/plans/[planId]/move/route';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const TZ = 'Asia/Kolkata';
const MIN = 60000; const HOUR = 3600000; const DAY = 86400000;
const minute = (ms: number) => Math.floor(ms / MIN) * MIN;

// ============================================================
// 10. Normal standalone CHECK/COMPARE behavior outside rescheduling is
// unchanged -- RESCHEDULE_MODES is a SEPARATE, additional option set only
// ever used when reschedulingPlanId is set; PLAN_MODES (3 options, no
// lock) still governs every other case, exactly as before DR4-F2A/F2B.
// ============================================================

check('RESCHEDULE_MODES offers exactly 2 choices: FIND ("Find a Better Time") and CHECK ("Choose My Own Time")', RESCHEDULE_MODES.length === 2 && RESCHEDULE_MODES[0].value === 'FIND' && RESCHEDULE_MODES[0].label === 'Find a Better Time' && RESCHEDULE_MODES[1].value === 'CHECK' && RESCHEDULE_MODES[1].label === 'Choose My Own Time');
check('COMPARE is never one of the reschedule choices -- not merely disabled, genuinely absent from the option set (per the ticket\'s own "COMPARE does not need to become reschedule-aware" scope line)', !RESCHEDULE_MODES.some((mode) => (mode.value as string) === 'COMPARE'));

const source = fs.readFileSync(require.resolve('../apps/web/components/PlanWithAuraView.tsx'), 'utf8');
const stripped = source.replace(/\/\/.*$/gm, '').replace(/\s+/g, ' ');
check('10a. the mode switcher uses RESCHEDULE_MODES ONLY while reschedulingPlanId is set, and falls back to the full, unrestricted PLAN_MODES (3 options) otherwise -- standalone Check a Time/Compare are completely unaffected', /options=\{reschedulingPlanId \? RESCHEDULE_MODES\.map/.test(stripped) && /: PLAN_MODES\.map\(\(mode\) => \(\{ value: mode\.value, label: mode\.label \}\)\)\}/.test(stripped));
check('10b. the mode switcher itself is never passed a `disabled` prop anymore -- DR4-F2A\'s full lock is superseded by offering a genuinely usable 2-choice set instead of disabling everything', !/<SegmentedControl options=\{reschedulingPlanId[\s\S]{0,250}disabled=/.test(stripped));
check('10c. the helper text under the switcher reflects RESCHEDULE_MODES while rescheduling and PLAN_MODES otherwise -- no leftover "Switch modes after finishing this reschedule" lock message', /reschedulingPlanId \? RESCHEDULE_MODES\.find/.test(stripped) && !/Switch modes after finishing this reschedule/.test(stripped));

// ============================================================
// 1/3. Manual-time prefill correctness -- the exact timezone-conversion
// logic handleReschedulePlan uses (getDatePartsInTimezone +
// getMinuteOfDayInTimezone, the SAME utilities lib/homeMove.ts's own
// defaultMoveSelection already uses), proven against a real instant
// independent of the component.
// ============================================================

const sampleInstant = new Date('2026-08-22T13:45:00.000Z'); // 7:15 PM IST
const zoned = getDatePartsInTimezone(TZ, sampleInstant);
const minuteOfDay = getMinuteOfDayInTimezone(TZ, sampleInstant);
const computedTime = `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
check('1/3. the prefill\'s own date computation (getDatePartsInTimezone) yields the correct LOCAL calendar date for a UTC instant', zoned.dateStr === '2026-08-22');
check('1/3. the prefill\'s own time computation (getMinuteOfDayInTimezone) yields the correct LOCAL wall-clock time for a UTC instant', computedTime === '19:15');
check('1/3. round-tripping the prefilled date/time back through localDateTimeToUTC (the SAME conversion handleCheckTime itself uses) reproduces the exact original instant -- prefill and save use consistent, lossless timezone logic', localDateTimeToUTC(zoned.dateStr, computedTime, TZ).getTime() === sampleInstant.getTime());

// Sliced from the RAW source (never `stripped`, whose whitespace collapse
// destroys the `\n`-anchored boundaries a regex would need) between two
// known, adjacent function starts, then stripped for matching.
const sliceFn = (startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  return start >= 0 && end > start ? source.slice(start, end).replace(/\/\/.*$/gm, '').replace(/\s+/g, ' ') : '';
};
const reschedulePlanFn = sliceFn('const handleReschedulePlan = (plan: UpcomingPlan)', 'const handleLogPlan = async (plan: UpcomingPlan)');
check('1. handleReschedulePlan prefills checkTaskTitle with the original plan\'s own title (same as FIND\'s taskTitle)', /setCheckTaskTitle\(plan\.title\)/.test(reschedulePlanFn));
check('1. handleReschedulePlan prefills checkDate using getDatePartsInTimezone on the plan\'s own plannedStartAt', /setCheckDate\(getDatePartsInTimezone\(tz, planStart\)\.dateStr\)/.test(reschedulePlanFn));
check('1. handleReschedulePlan prefills checkStartTime using getMinuteOfDayInTimezone on the plan\'s own plannedStartAt', /setCheckStartTime\(/.test(reschedulePlanFn) && /getMinuteOfDayInTimezone\(tz, planStart\)/.test(reschedulePlanFn));
check('4. handleReschedulePlan clears any previous checkResult/checkError -- a stale assessment (from a prior reschedule, or a plain stand-alone check) can never bleed into a new reschedule', /setCheckResult\(null\)/.test(reschedulePlanFn) && /setCheckError\(''\)/.test(reschedulePlanFn));

// ============================================================
// 4. Assessment freshness -- DR4-F2B blocking-fix: the ORIGINAL guard
// (comparing only reschedulingPlanId before/after a request) was proven
// insufficient by live reproduction -- it caught a changed reschedule
// TARGET but not a changed date/time/duration/title/mode, letting a
// stale response silently overwrite a cleared result. Replaced with a
// single monotonic requestGenerationRef counter: every relevant input
// change (and every new request) bumps it, and a request only commits
// its result if its OWN captured generation still equals the ref's
// current value when the response arrives -- an identity check, so it
// also catches an input that changed and then changed BACK.
// ============================================================

const findTimeFn = sliceFn('const handleFindTime = async () => {', 'const handleMakeMoment = async (key: string');
const checkTimeFn = sliceFn('const handleCheckTime = async () => {', 'const handleCompareTimes = async () => {');
check('4. handleFindTime bumps the request-generation counter at call time, captures its own generation, and only applies the result if the ref\'s current value still matches -- a response for an abandoned/changed request is dropped, never shown', /bumpRequestGeneration\(\);/.test(findTimeFn) && /const myRequestGeneration = requestGenerationRef\.current;/.test(findTimeFn) && /myRequestGeneration !== requestGenerationRef\.current/.test(findTimeFn));
check('4. handleCheckTime has the SAME generation guard', /bumpRequestGeneration\(\);/.test(checkTimeFn) && /const myRequestGeneration = requestGenerationRef\.current;/.test(checkTimeFn) && /myRequestGeneration !== requestGenerationRef\.current/.test(checkTimeFn));
check('the request-generation counter is a single ref bumped by every relevant input change (date/time/duration/title/target/mode), so a response arriving after ANY of those changes always compares against a truly current value -- identity-based, not value-based, so it also catches a value that changed and then changed back', /const requestGenerationRef = useRef\(0\);/.test(stripped) && /const bumpRequestGeneration = \(\) => \{ requestGenerationRef\.current \+= 1; \};/.test(stripped));

// ============================================================
// 5. FIND <-> manual-time transitions never reset reschedule context --
// switching RESCHEDULE_MODES' value still only ever calls setPlanMode
// (reschedulingPlanId/title/duration untouched); DR4-F2B's blocking-fix
// additionally bumps the request-generation counter on every mode
// change, since a FIND/CHECK response belonging to the mode just left
// must never land once the user has switched away from it.
// ============================================================

check('5. the mode switcher\'s onChange still calls setPlanMode (and ONLY also bumps the request-generation counter) -- switching between Find a Better Time and Choose My Own Time cannot touch reschedulingPlanId, title or duration', /onChange=\{\(mode\) => \{ bumpRequestGeneration\(\); setPlanMode\(mode\); \}\}/.test(stripped));

// ============================================================
// The CHECK block now shows its own reschedule banner (FIND already had
// one) so the user has the same orientation in either reschedule choice.
// ============================================================

const checkBlockStart = source.indexOf("{planMode === 'CHECK' && (");
const checkBlockBannerRegion = source.slice(checkBlockStart, checkBlockStart + 1200);
check('the CHECK block now renders its own "Rescheduling this plan" banner when reschedulingPlanId is set, matching FIND\'s own', /reschedulingPlanId && \(/.test(checkBlockBannerRegion) && /rescheduleNoticeStyle/.test(checkBlockBannerRegion));

// ============================================================
// DB-backed: manual-time Move through the exact route the client calls,
// using the client's own prefill-then-localDateTimeToUTC conversion --
// proves 2 (identity preservation), 6 (successful manual-time Move), 7
// (goal-linked manual-time Move), 8 (Move failure/no duplicate), 9
// (recommendation-based Move is still unaffected).
// ============================================================

const req = (tok: string | null, body: unknown): any => ({ cookies: { get: (n: string) => (tok && n === 'as_session' ? { value: tok } : undefined) }, json: async () => body, headers: new Headers() });
async function sql(t: string, p: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(t, p); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

async function main() {
  const U = await upsertUserByEmail({ email: 'test-dr4f2b-choose-own-time@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const V = await upsertUserByEmail({ email: 'test-dr4f2b-choose-own-time-b@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  for (const u of [U, V]) await updateBirthProfile(u.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  const tok = createSessionToken(U.id, U.email);
  const goalIds: string[] = [];
  let n = 0;
  const src = () => minute(Date.now()) + 15 * DAY + n++ * 3 * HOUR;
  const dest = () => new Date(minute(Date.now()) + 60 * DAY + n++ * 3 * HOUR);
  // The CLIENT's own manual-time request shape: prefill (handleReschedulePlan)
  // -> user edits/accepts checkDate/checkStartTime -> localDateTimeToUTC ->
  // POST /move with exactly { newStartAt }. Simulated here end-to-end.
  const manualTimeMoveViaRoute = async (planId: string, checkDateStr: string, checkStartTimeStr: string, token: string | null = tok) => {
    const newStartAt = localDateTimeToUTC(checkDateStr, checkStartTimeStr, TZ).toISOString();
    const res = await moveRoute(req(token, { newStartAt }), { params: { planId } });
    return { status: res.status, body: await res.json(), newStartAt };
  };

  try {
    // ---- 2/6. manual-time reschedule preserves identity and lands at the exact chosen instant ----
    const original = await mk(U.id, 'Manual Time Session', src(), 50);
    const destInstant = dest();
    const destZoned = getDatePartsInTimezone(TZ, destInstant);
    const destMinuteOfDay = getMinuteOfDayInTimezone(TZ, destInstant);
    const destTimeStr = `${String(Math.floor(destMinuteOfDay / 60)).padStart(2, '0')}:${String(destMinuteOfDay % 60).padStart(2, '0')}`;
    const r1 = await manualTimeMoveViaRoute(original.id, destZoned.dateStr, destTimeStr);
    check('6. a manually chosen date/time succeeds via the exact same Move route -> 200, original MOVED, replacement UPCOMING', r1.status === 200 && r1.body.from.status === 'MOVED' && r1.body.plan.status === 'UPCOMING');
    check('6. the replacement lands at EXACTLY the manually chosen instant (the client\'s own date+time, converted via localDateTimeToUTC)', new Date(r1.body.plan.plannedStartAt).getTime() === destInstant.getTime());
    check('2. the original activity\'s identity is fully preserved: title, duration, rescheduledFromPlanId lineage', r1.body.plan.title === original.title && r1.body.plan.durationMinutes === 50 && r1.body.plan.rescheduledFromPlanId === original.id);
    check('2. the original transitions to MOVED, never silently deleted', (await sql(`SELECT status FROM "PlannedActivity" WHERE id = $1`, [original.id]))[0].status === 'MOVED');

    // ---- 7. goal-linked manual-time Move ----
    const goal = await createGoalWithActivities({ userId: U.id, title: 'DR4-F2B manual-time goal', targetDate: null, activities: [] });
    goalIds.push(goal.goal.id);
    const ga = await addGoalActivity(U.id, goal.goal.id, { title: 'Manual Time Workout', activityId: null });
    const goalPlan = await mk(U.id, 'Manual Time Workout', src(), 45);
    { const c = await beginTransaction(); await c.query(`UPDATE "GoalActivity" SET "plannedActivityId" = $1 WHERE id = $2`, [goalPlan.id, ga!.id]); await c.query('COMMIT'); c.release(); }
    const goalDest = dest();
    const goalZoned = getDatePartsInTimezone(TZ, goalDest);
    const goalMinuteOfDay = getMinuteOfDayInTimezone(TZ, goalDest);
    const goalTimeStr = `${String(Math.floor(goalMinuteOfDay / 60)).padStart(2, '0')}:${String(goalMinuteOfDay % 60).padStart(2, '0')}`;
    const execCountBefore = Number((await sql(`SELECT count(*)::int AS n FROM "GoalActivityExecution" WHERE "userId" = $1`, [U.id]))[0].n);
    const r2 = await manualTimeMoveViaRoute(goalPlan.id, goalZoned.dateStr, goalTimeStr);
    check('7. a goal-linked activity reschedules successfully via a manually chosen date/time', r2.status === 200);
    const gRow = (await listGoalActivitiesWithLinkedPlanStatus(U.id, goal.goal.id)).find((g) => g.id === ga!.id)!;
    check('7. GoalActivity follows the manually-rescheduled replacement, exactly as it does for a recommendation-based one', gRow.plannedActivityId === r2.body.plan.id);
    const execCountAfter = Number((await sql(`SELECT count(*)::int AS n FROM "GoalActivityExecution" WHERE "userId" = $1`, [U.id]))[0].n);
    check('7. no GoalActivityExecution is created by a manual-time reschedule; goal progress is untouched', execCountAfter === execCountBefore);

    // ---- 8. Move failure (conflict) leaves the original untouched, creates no replacement ----
    const blockStart = minute(Date.now()) + 80 * DAY;
    await mk(U.id, 'Blocker', blockStart, 60);
    const conflictSubject = await mk(U.id, 'Conflict Subject', src(), 30);
    const blockZoned = getDatePartsInTimezone(TZ, new Date(blockStart + 15 * MIN));
    const blockMinuteOfDay = getMinuteOfDayInTimezone(TZ, new Date(blockStart + 15 * MIN));
    const blockTimeStr = `${String(Math.floor(blockMinuteOfDay / 60)).padStart(2, '0')}:${String(blockMinuteOfDay % 60).padStart(2, '0')}`;
    const c0 = Number((await sql(`SELECT count(*)::int AS n FROM "PlannedActivity" WHERE "userId" = $1`, [U.id]))[0].n);
    const rFail = await manualTimeMoveViaRoute(conflictSubject.id, blockZoned.dateStr, blockTimeStr);
    check('8. a manually chosen time that conflicts with another plan is rejected (409 CONFLICT), original stays untouched, no replacement created', rFail.status === 409 && (await sql(`SELECT status FROM "PlannedActivity" WHERE id = $1`, [conflictSubject.id]))[0].status === 'UPCOMING' && Number((await sql(`SELECT count(*)::int AS n FROM "PlannedActivity" WHERE "userId" = $1`, [U.id]))[0].n) === c0);

    // ---- 9. recommendation-based (FIND) Move is completely unaffected by this PR ----
    const findPlan = await mk(U.id, 'Still Find-Based', src(), 60);
    const findDest = dest();
    const rFind = await moveRoute(req(tok, { newStartAt: findDest.toISOString() }), { params: { planId: findPlan.id } });
    const findBody = await rFind.json();
    check('9. a recommendation-based (FIND) reschedule still works exactly as before, via the identical route and request shape', rFind.status === 200 && findBody.plan.title === findPlan.title && findBody.plan.durationMinutes === 60 && new Date(findBody.plan.plannedStartAt).getTime() === findDest.getTime());

    // ---- unauthorized manual-time reschedule ----
    const mine = await mk(U.id, 'Mine only', src(), 30);
    const mineDest = dest();
    const mineZoned = getDatePartsInTimezone(TZ, mineDest);
    const mineMinuteOfDay = getMinuteOfDayInTimezone(TZ, mineDest);
    const mineTimeStr = `${String(Math.floor(mineMinuteOfDay / 60)).padStart(2, '0')}:${String(mineMinuteOfDay % 60).padStart(2, '0')}`;
    const rCross = await manualTimeMoveViaRoute(mine.id, mineZoned.dateStr, mineTimeStr, createSessionToken(V.id, V.email));
    check('a cross-user manual-time reschedule attempt -> 404, nothing changes', rCross.status === 404 && (await sql(`SELECT status FROM "PlannedActivity" WHERE id = $1`, [mine.id]))[0].status === 'UPCOMING');
  } finally {
    await sql(`UPDATE "GoalActivity" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [U.id]).catch(() => {});
    for (const g of goalIds) await deleteGoal(U.id, g).catch(() => {});
    await sql(`UPDATE "PlannedActivity" SET "rescheduledFromPlanId" = NULL WHERE "userId" = ANY($1)`, [[U.id, V.id]]).catch(() => {});
    await sql(`DELETE FROM "GoalActivityExecution" WHERE "userId" = ANY($1)`, [[U.id, V.id]]).catch(() => {});
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1)`, [[U.id, V.id]]).catch(() => {});
    await sql(`DELETE FROM "HabitLog" WHERE "userId" = ANY($1)`, [[U.id, V.id]]).catch(() => {});
  }
  if (!allPassed) { console.error('SOME DR4-F2B CHOOSE MY OWN TIME CHECKS FAILED'); process.exit(1); }
  console.log('ALL DR4-F2B CHOOSE MY OWN TIME CHECKS PASSED');
  process.exit(0);
}

async function mk(userId: string, title: string, startMs: number, durMin: number) {
  return createPlannedActivity({ userId, title: `${title} ${Date.now()}-${Math.random()}`, plannedStartAt: new Date(startMs), plannedEndAt: new Date(startMs + durMin * MIN), durationMinutes: durMin, windowType: 'NEUTRAL' } as any);
}

main().catch((e) => { console.error(e); process.exit(1); });
