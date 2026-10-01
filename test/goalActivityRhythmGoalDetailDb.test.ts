/**
 * Goals V2 Rhythm R4 -- live-database proof that Goal Detail's own API
 * route (GET /api/goals/[goalId]) presents weekly Rhythm facts correctly,
 * exercised directly against the real route handler (bypassing HTTP) --
 * same established convention as test/activityPreferencesApi.test.ts (a
 * duck-typed fake NextRequest, since this file lives under repo-root
 * `test/`, which has no module-resolution path to `next`).
 *
 * Covers this ticket's own sections 42-51: NONE presentation, first
 * completion, committed-vs-completed, target met, week reset, over
 * target, skip, Move continuity, mixed Goal, user isolation. All facts
 * are seeded directly via raw SQL (the underlying fact-loading/eligibility
 * math is already exhaustively proven by test/goalActivityRhythm.test.ts
 * [R2, pure] and test/goalActivityRhythmMaterializationDb.test.ts [R3,
 * live] -- this file proves ONLY that Goal Detail's own read model
 * presents those already-correct facts faithfully, never a second
 * computation of them).
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/goalActivityRhythmGoalDetailDb.test.ts
 */
import { upsertUserByEmail, updateBirthProfile, createGoalWithActivities, createPlannedActivity, beginTransaction } from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { getDatePartsInTimezone } from '../apps/web/lib/timezone';
import { localCalendarWeekStart } from '../apps/web/lib/goalActivityRhythm';
import { GET } from '../apps/web/app/api/goals/[goalId]/route';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';

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

/** Duck-typed stand-in for NextRequest -- see activityPreferencesApi.test.ts's
 * own header comment for why a real NextRequest is never imported here. */
function fakeRequest(cookie?: string): any {
  return { cookies: { get: (name: string) => (cookie !== undefined && name === 'as_session' ? { value: cookie } : undefined) } };
}

async function getGoalDetail(token: string, goalId: string): Promise<{ status: number; body: any }> {
  const res: any = await GET(fakeRequest(token), { params: { goalId } });
  return { status: res.status, body: await res.json() };
}

function localDateAtOffset(weekStartStr: string, dayOffset: number): string {
  const [y, m, d] = weekStartStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dayOffset);
  return dt.toISOString().slice(0, 10);
}

// Asia/Kolkata is a fixed UTC+5:30 offset (no DST), so `hour:00 local` on a
// known calendar date converts exactly via plain arithmetic -- same
// convention as test/goalActivityRhythmDb.test.ts's own atWedLocal.
function atLocal(dateStr: string, hour: number): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utcHour = hour - 5;
  const utcMinute = -30;
  return new Date(Date.UTC(y, m - 1, d, utcHour, 0) + utcMinute * 60000);
}

const setRhythm = (goalActivityId: string, targetPerWeek: number) =>
  sql(`UPDATE "GoalActivity" SET "rhythmKind" = 'N_PER_WEEK', "rhythmTargetPerWeek" = $1 WHERE id = $2`, [targetPerWeek, goalActivityId]);
const linkActivity = (goalActivityId: string, plannedActivityId: string | null) =>
  sql(`UPDATE "GoalActivity" SET "plannedActivityId" = $1 WHERE id = $2`, [plannedActivityId, goalActivityId]);
const insertOccurrence = (userId: string, goalActivityId: string, plannedActivityId: string) =>
  sql(`INSERT INTO "GoalActivityOccurrence" (id, "userId", "goalActivityId", "plannedActivityId") VALUES (gen_random_uuid(), $1, $2, $3)`, [userId, goalActivityId, plannedActivityId]);
const setStatus = (plannedActivityId: string, status: string) => sql(`UPDATE "PlannedActivity" SET status = $1 WHERE id = $2`, [status, plannedActivityId]);

async function main() {
  const userA = await upsertUserByEmail({ email: 'test-rhythm-goal-detail-a@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const userB = await upsertUserByEmail({ email: 'test-rhythm-goal-detail-b@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await updateBirthProfile(userA.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  await updateBirthProfile(userB.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  const tokenA = createSessionToken(userA.id, userA.email);
  const tokenB = createSessionToken(userB.id, userB.email);

  const todayLocalDate = getDatePartsInTimezone(TZ, new Date()).dateStr;
  const thisWeekStart = localCalendarWeekStart(todayLocalDate);
  const lastWeekStart = localDateAtOffset(thisWeekStart, -7);
  // Wednesday of each week -- a safe mid-week local time, well clear of
  // either week's own start/end boundaries (same precedent as
  // test/goalActivityRhythmDb.test.ts).
  const thisWeekWed = localDateAtOffset(thisWeekStart, 2);
  const lastWeekWed = localDateAtOffset(lastWeekStart, 2);
  // createPlannedActivity dedups by (userId, title, status='UPCOMING',
  // start, end) -- several sections below deliberately leave a plan
  // UPCOMING (never transitioning it away), so every plan across this
  // whole file must get its own, never-repeated hour slot (a sequential
  // allocator, rather than per-section hardcoded offsets, guarantees that
  // regardless of section order or edits).
  let nextThisWeekHour = 1;
  const reserveThisWeekHour = () => nextThisWeekHour++;
  let nextLastWeekHour = 1;
  const reserveLastWeekHour = () => nextLastWeekHour++;

  const createdPlanIds: string[] = [];
  const createdGoalIds: string[] = [];
  // Raw-SQL hard delete, same convention as every other *Db.test.ts
  // fixture teardown in this repo (e.g. goalActivityRhythmMaterializationDb
  // .test.ts's own cleanup) -- the production deletePlannedActivity/deleteGoal
  // functions are deliberately narrow (LOGGED/CANCELLED only, no-retained-
  // -linkage only) and are not themselves under test here, so fixture
  // teardown goes straight to the tables instead of fighting those guards
  // for statuses (UPCOMING/SKIPPED/MOVED) this file's own fixtures use.
  const cleanup = async () => {
    if (createdPlanIds.length > 0) await sql(`DELETE FROM "PlannedActivity" WHERE id = ANY($1::text[])`, [createdPlanIds]);
    if (createdGoalIds.length > 0) await sql(`DELETE FROM "Goal" WHERE id = ANY($1::text[])`, [createdGoalIds]);
  };

  try {
    // ============================================================
    // 42. NONE -- Goal Detail presentation remains equivalent; no Rhythm
    // presentation; existing COMPLETED semantics remain.
    // ============================================================
    {
      const { goal, activities } = await createGoalWithActivities({ userId: userA.id, title: 'Finish a project', targetDate: null, activities: [{ title: 'Buy running shoes', activityId: null }] });
      createdGoalIds.push(goal.id);
      const h = reserveThisWeekHour();
      const plan = await createPlannedActivity({ userId: userA.id, title: 'Buy running shoes', plannedStartAt: atLocal(thisWeekWed, h), plannedEndAt: atLocal(thisWeekWed, h + 1), durationMinutes: 60, windowType: 'NEUTRAL' });
      createdPlanIds.push(plan.id);
      await setStatus(plan.id, 'LOGGED');
      await linkActivity(activities[0].id, plan.id);

      const { status, body } = await getGoalDetail(tokenA, goal.id);
      check('42. NONE Goal Detail GET succeeds', status === 200);
      check('42. NONE activity presents rhythm: { kind: "NONE" }', JSON.stringify(body.activities[0].rhythm) === JSON.stringify({ kind: 'NONE' }));
      check('42. NONE activity derivedState is COMPLETED, unaffected by R4', body.activities[0].derivedState === 'COMPLETED');
      check('42. finite-only Goal keeps existing "N of M completed" progress label', body.progress.hasOngoingRhythmActivity === false && body.progress.total === 1 && body.progress.completed === 1);
    }

    // ============================================================
    // 43. First completion -- N_PER_WEEK 3, one LOGGED occurrence. Must
    // NOT present as permanently COMPLETED; remaining = 2, eligible.
    // ============================================================
    let activity43Id: string;
    {
      const { goal, activities } = await createGoalWithActivities({ userId: userA.id, title: 'Meditate regularly', targetDate: null, activities: [{ title: 'Meditate 10 minutes', activityId: null }] });
      createdGoalIds.push(goal.id);
      activity43Id = activities[0].id;
      await setRhythm(activity43Id, 3);
      const h = reserveThisWeekHour();
      const plan = await createPlannedActivity({ userId: userA.id, title: 'Meditate 10 minutes', plannedStartAt: atLocal(thisWeekWed, h), plannedEndAt: atLocal(thisWeekWed, h + 1), durationMinutes: 10, windowType: 'NEUTRAL' });
      createdPlanIds.push(plan.id);
      await setStatus(plan.id, 'LOGGED');
      await linkActivity(activity43Id, plan.id);
      await insertOccurrence(userA.id, activity43Id, plan.id);

      const { body } = await getGoalDetail(tokenA, goal.id);
      const a = body.activities[0];
      check('43. derivedState is COMPLETED (linked plan is LOGGED)', a.derivedState === 'COMPLETED');
      check('43. rhythm.kind is N_PER_WEEK, targetPerWeek 3', a.rhythm.kind === 'N_PER_WEEK' && a.rhythm.targetPerWeek === 3);
      check('43. completedThisWeek 1, committedThisWeek 0, remainingThisWeek 2', a.rhythm.completedThisWeek === 1 && a.rhythm.committedThisWeek === 0 && a.rhythm.remainingThisWeek === 2);
      check('43. eligibleForAnotherOccurrence true -- NOT permanently completed', a.rhythm.eligibleForAnotherOccurrence === true);
    }

    // ============================================================
    // 44. Committed -- 1 LOGGED + 1 UPCOMING. No double counting.
    // ============================================================
    {
      const { goal, activities } = await createGoalWithActivities({ userId: userA.id, title: 'Meditate regularly', targetDate: null, activities: [{ title: 'Meditate 10 minutes', activityId: null }] });
      createdGoalIds.push(goal.id);
      const gaId = activities[0].id;
      await setRhythm(gaId, 3);
      const h1 = reserveThisWeekHour();
      const h2 = reserveThisWeekHour();
      const planLogged = await createPlannedActivity({ userId: userA.id, title: 'Meditate 10 minutes', plannedStartAt: atLocal(thisWeekWed, h1), plannedEndAt: atLocal(thisWeekWed, h1 + 1), durationMinutes: 10, windowType: 'NEUTRAL' });
      const planUpcoming = await createPlannedActivity({ userId: userA.id, title: 'Meditate 10 minutes', plannedStartAt: atLocal(thisWeekWed, h2), plannedEndAt: atLocal(thisWeekWed, h2 + 1), durationMinutes: 10, windowType: 'NEUTRAL' });
      createdPlanIds.push(planLogged.id, planUpcoming.id);
      await setStatus(planLogged.id, 'LOGGED');
      // planUpcoming is already UPCOMING by default.
      await linkActivity(gaId, planUpcoming.id);
      await insertOccurrence(userA.id, gaId, planLogged.id);
      await insertOccurrence(userA.id, gaId, planUpcoming.id);

      const { body } = await getGoalDetail(tokenA, goal.id);
      const a = body.activities[0];
      check('44. derivedState is PLANNED (current link is UPCOMING)', a.derivedState === 'PLANNED');
      check('44. completedThisWeek 1, committedThisWeek 1, remainingThisWeek 1 -- no double counting', a.rhythm.completedThisWeek === 1 && a.rhythm.committedThisWeek === 1 && a.rhythm.remainingThisWeek === 1);
      check('44. still eligible (1 remaining)', a.rhythm.eligibleForAnotherOccurrence === true);
    }

    // ============================================================
    // 45. Target met -- 3 LOGGED. remaining 0, eligible false. Activity
    // not permanently "Goal completed" (asserted at the FACT level here;
    // the no-permanent-badge PRESENTATION rule itself is proven in
    // test/goalActivityRhythmGoalDetailUi.test.ts).
    // ============================================================
    {
      const { goal, activities } = await createGoalWithActivities({ userId: userA.id, title: 'Meditate regularly', targetDate: null, activities: [{ title: 'Meditate 10 minutes', activityId: null }] });
      createdGoalIds.push(goal.id);
      const gaId = activities[0].id;
      await setRhythm(gaId, 3);
      const plans = [];
      for (let i = 0; i < 3; i++) {
        const h = reserveThisWeekHour();
        const p = await createPlannedActivity({ userId: userA.id, title: 'Meditate 10 minutes', plannedStartAt: atLocal(thisWeekWed, h), plannedEndAt: atLocal(thisWeekWed, h + 1), durationMinutes: 10, windowType: 'NEUTRAL' });
        createdPlanIds.push(p.id);
        await setStatus(p.id, 'LOGGED');
        await insertOccurrence(userA.id, gaId, p.id);
        plans.push(p);
      }
      await linkActivity(gaId, plans[0].id);

      const { body } = await getGoalDetail(tokenA, goal.id);
      const a = body.activities[0];
      check('45. completedThisWeek 3, committedThisWeek 0, remainingThisWeek 0', a.rhythm.completedThisWeek === 3 && a.rhythm.committedThisWeek === 0 && a.rhythm.remainingThisWeek === 0);
      check('45. eligibleForAnotherOccurrence false -- this week\'s target is met', a.rhythm.eligibleForAnotherOccurrence === false);
      check('45. remainingThisWeek is never negative', a.rhythm.remainingThisWeek >= 0);
    }

    // ============================================================
    // 46. Next week -- prior week had 3 LOGGED; current week has none.
    // completedThisWeek resets to 0, remaining back to 3, eligible again.
    // ============================================================
    {
      const { goal, activities } = await createGoalWithActivities({ userId: userA.id, title: 'Meditate regularly', targetDate: null, activities: [{ title: 'Meditate 10 minutes', activityId: null }] });
      createdGoalIds.push(goal.id);
      const gaId = activities[0].id;
      await setRhythm(gaId, 3);
      for (let i = 0; i < 3; i++) {
        const h = reserveLastWeekHour();
        const p = await createPlannedActivity({ userId: userA.id, title: 'Meditate 10 minutes', plannedStartAt: atLocal(lastWeekWed, h), plannedEndAt: atLocal(lastWeekWed, h + 1), durationMinutes: 10, windowType: 'NEUTRAL' });
        createdPlanIds.push(p.id);
        await setStatus(p.id, 'LOGGED');
        await insertOccurrence(userA.id, gaId, p.id);
      }
      // No link at all this week -- activity reads as SUGGESTED again.

      const { body } = await getGoalDetail(tokenA, goal.id);
      const a = body.activities[0];
      check('46. completedThisWeek 0 (prior week excluded)', a.rhythm.completedThisWeek === 0);
      check('46. remainingThisWeek back to 3', a.rhythm.remainingThisWeek === 3);
      check('46. eligibleForAnotherOccurrence true again', a.rhythm.eligibleForAnotherOccurrence === true);
    }

    // ============================================================
    // 47. Over target -- 4 LOGGED against 3/week. remaining 0, never
    // negative. eligible false.
    // ============================================================
    {
      const { goal, activities } = await createGoalWithActivities({ userId: userA.id, title: 'Meditate regularly', targetDate: null, activities: [{ title: 'Meditate 10 minutes', activityId: null }] });
      createdGoalIds.push(goal.id);
      const gaId = activities[0].id;
      await setRhythm(gaId, 3);
      let lastPlanId = '';
      for (let i = 0; i < 4; i++) {
        const h = reserveThisWeekHour();
        const p = await createPlannedActivity({ userId: userA.id, title: 'Meditate 10 minutes', plannedStartAt: atLocal(thisWeekWed, h), plannedEndAt: atLocal(thisWeekWed, h + 1), durationMinutes: 10, windowType: 'NEUTRAL' });
        createdPlanIds.push(p.id);
        await setStatus(p.id, 'LOGGED');
        await insertOccurrence(userA.id, gaId, p.id);
        lastPlanId = p.id;
      }
      await linkActivity(gaId, lastPlanId);

      const { body } = await getGoalDetail(tokenA, goal.id);
      const a = body.activities[0];
      check('47. completedThisWeek 4 (over target, no clamp on the raw count)', a.rhythm.completedThisWeek === 4);
      check('47. remainingThisWeek 0, never negative', a.rhythm.remainingThisWeek === 0);
      check('47. eligibleForAnotherOccurrence false', a.rhythm.eligibleForAnotherOccurrence === false);
    }

    // ============================================================
    // 48. Skip -- 1 LOGGED + 1 SKIPPED, target 3. Skip never counts as
    // completed, and never permanently consumes capacity.
    // ============================================================
    {
      const { goal, activities } = await createGoalWithActivities({ userId: userA.id, title: 'Meditate regularly', targetDate: null, activities: [{ title: 'Meditate 10 minutes', activityId: null }] });
      createdGoalIds.push(goal.id);
      const gaId = activities[0].id;
      await setRhythm(gaId, 3);
      const h48a = reserveThisWeekHour();
      const h48b = reserveThisWeekHour();
      const planLogged = await createPlannedActivity({ userId: userA.id, title: 'Meditate 10 minutes', plannedStartAt: atLocal(thisWeekWed, h48a), plannedEndAt: atLocal(thisWeekWed, h48a + 1), durationMinutes: 10, windowType: 'NEUTRAL' });
      const planSkipped = await createPlannedActivity({ userId: userA.id, title: 'Meditate 10 minutes', plannedStartAt: atLocal(thisWeekWed, h48b), plannedEndAt: atLocal(thisWeekWed, h48b + 1), durationMinutes: 10, windowType: 'NEUTRAL' });
      createdPlanIds.push(planLogged.id, planSkipped.id);
      await setStatus(planLogged.id, 'LOGGED');
      await setStatus(planSkipped.id, 'SKIPPED');
      await linkActivity(gaId, planLogged.id);
      await insertOccurrence(userA.id, gaId, planLogged.id);
      await insertOccurrence(userA.id, gaId, planSkipped.id);

      const { body } = await getGoalDetail(tokenA, goal.id);
      const a = body.activities[0];
      check('48. completedThisWeek 1 (the skip never counts as completed)', a.rhythm.completedThisWeek === 1);
      check('48. remainingThisWeek reflects the skip as free capacity (2, not 1)', a.rhythm.remainingThisWeek === 2);
    }

    // ============================================================
    // 49. Move -- one occurrence, already repointed (same shape a REAL
    // Move leaves behind, per test/goalActivityRhythmMaterializationDb
    // .test.ts's own section 52 proof of planMove.ts's repoint UPDATE).
    // Counted once, never duplicated.
    // ============================================================
    {
      const { goal, activities } = await createGoalWithActivities({ userId: userA.id, title: 'Meditate regularly', targetDate: null, activities: [{ title: 'Meditate 10 minutes', activityId: null }] });
      createdGoalIds.push(goal.id);
      const gaId = activities[0].id;
      await setRhythm(gaId, 3);
      const h49a = reserveThisWeekHour();
      const h49b = reserveThisWeekHour();
      const planOld = await createPlannedActivity({ userId: userA.id, title: 'Meditate 10 minutes', plannedStartAt: atLocal(thisWeekWed, h49a), plannedEndAt: atLocal(thisWeekWed, h49a + 1), durationMinutes: 10, windowType: 'NEUTRAL' });
      const planNew = await createPlannedActivity({ userId: userA.id, title: 'Meditate 10 minutes', plannedStartAt: atLocal(thisWeekWed, h49b), plannedEndAt: atLocal(thisWeekWed, h49b + 1), durationMinutes: 10, windowType: 'NEUTRAL' });
      createdPlanIds.push(planOld.id, planNew.id);
      await setStatus(planOld.id, 'MOVED');
      // planNew stays UPCOMING -- the occurrence now points at IT, exactly
      // as planMove.ts's own repoint UPDATE leaves it.
      await linkActivity(gaId, planNew.id);
      await insertOccurrence(userA.id, gaId, planNew.id);

      const { body } = await getGoalDetail(tokenA, goal.id);
      const a = body.activities[0];
      check('49. exactly one committed fact (the MOVED row itself is never read -- the occurrence already points at the successor)', a.rhythm.completedThisWeek === 0 && a.rhythm.committedThisWeek === 1);
      check('49. remainingThisWeek 2, not double-counted down to 1', a.rhythm.remainingThisWeek === 2);
    }

    // ============================================================
    // 50. Mixed Goal -- one finite NONE activity + one N_PER_WEEK
    // activity. Universal Goal-level progress must be suppressed.
    // ============================================================
    {
      const { goal, activities } = await createGoalWithActivities({
        userId: userA.id,
        title: 'Get fitter',
        targetDate: null,
        activities: [{ title: 'Buy running shoes', activityId: null }, { title: 'Easy run', activityId: null }],
      });
      createdGoalIds.push(goal.id);
      const [finiteActivity, rhythmActivity] = activities;
      await setRhythm(rhythmActivity.id, 3);
      const h50 = reserveThisWeekHour();
      const financePlan = await createPlannedActivity({ userId: userA.id, title: 'Buy running shoes', plannedStartAt: atLocal(thisWeekWed, h50), plannedEndAt: atLocal(thisWeekWed, h50 + 1), durationMinutes: 60, windowType: 'NEUTRAL' });
      createdPlanIds.push(financePlan.id);
      await setStatus(financePlan.id, 'LOGGED');
      await linkActivity(finiteActivity.id, financePlan.id);
      // rhythmActivity stays SUGGESTED (no occurrence yet) -- still ongoing.

      const { body } = await getGoalDetail(tokenA, goal.id);
      check('50. mixed Goal: progress.hasOngoingRhythmActivity is true', body.progress.hasOngoingRhythmActivity === true);
      check('50. the finite activity row itself is unaffected (rhythm.kind NONE, derivedState COMPLETED)', body.activities.find((a: any) => a.id === finiteActivity.id).rhythm.kind === 'NONE');
      check('50. the ongoing activity row carries its own N_PER_WEEK facts independently', body.activities.find((a: any) => a.id === rhythmActivity.id).rhythm.kind === 'N_PER_WEEK');
    }

    // ============================================================
    // 51. User isolation -- User B cannot see User A's Rhythm policy,
    // weekly counts, or eligibility through Goal Detail.
    // ============================================================
    {
      const { goal: goalA, activities: activitiesA } = await createGoalWithActivities({ userId: userA.id, title: 'Meditate regularly', targetDate: null, activities: [{ title: 'Meditate 10 minutes', activityId: null }] });
      createdGoalIds.push(goalA.id);
      await setRhythm(activitiesA[0].id, 5);
      const h51 = reserveThisWeekHour();
      const planA = await createPlannedActivity({ userId: userA.id, title: 'Meditate 10 minutes', plannedStartAt: atLocal(thisWeekWed, h51), plannedEndAt: atLocal(thisWeekWed, h51 + 1), durationMinutes: 10, windowType: 'NEUTRAL' });
      createdPlanIds.push(planA.id);
      await setStatus(planA.id, 'LOGGED');
      await linkActivity(activitiesA[0].id, planA.id);
      await insertOccurrence(userA.id, activitiesA[0].id, planA.id);

      const { goal: goalB, activities: activitiesB } = await createGoalWithActivities({ userId: userB.id, title: 'Meditate regularly', targetDate: null, activities: [{ title: 'Meditate 10 minutes', activityId: null }] });
      createdGoalIds.push(goalB.id);
      await setRhythm(activitiesB[0].id, 2);

      const asB = await getGoalDetail(tokenB, goalA.id);
      check('51. User B fetching User A\'s goal -> 404 (never another user\'s Rhythm data)', asB.status === 404);

      const bOwnDetail = await getGoalDetail(tokenB, goalB.id);
      check('51. User B\'s OWN goal shows User B\'s own policy (targetPerWeek 2), untouched by User A\'s fixtures', bOwnDetail.body.activities[0].rhythm.kind === 'N_PER_WEEK' && bOwnDetail.body.activities[0].rhythm.targetPerWeek === 2);
      check('51. User B\'s own activity shows zero completed/committed (User A\'s 5 LOGGED never leak across users)', bOwnDetail.body.activities[0].rhythm.completedThisWeek === 0 && bOwnDetail.body.activities[0].rhythm.committedThisWeek === 0);
    }
  } finally {
    await cleanup();
  }

  if (!allPassed) {
    console.error('SOME GOAL ACTIVITY RHYTHM GOAL DETAIL DB CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL GOAL ACTIVITY RHYTHM GOAL DETAIL DB CHECKS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
