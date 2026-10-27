// AURA HPG2 P0 fix -- live-database proof that POST /api/plans's direct
// Goal-link path now enforces the SAME archived-Goal lifecycle
// authorization Day Constructor acceptance already enforces
// (lockGoalParentLifecycleForPlanning, db.ts), including under real
// concurrency against a competing archiveGoal(). Pairs with the structural
// proof in test/goalLifecycleAuthorizationArchitecture.test.ts and the
// existing Day-Constructor-side live proof in
// test/goalLifecycleArchivedAcceptanceDb.test.ts (left unmodified -- its
// own entry path is untouched by this fix).
// Run with: npx ts-node test/planGoalActivityArchivedLifecycleDb.test.ts
import { POST as plansRoute } from '../apps/web/app/api/plans/route';
import { upsertUserByEmail, createGoalWithActivities, archiveGoal, beginTransaction, lockGoalParentLifecycleForPlanning } from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

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

function futurePlan(title: string, hoursFromNow = 24) {
  const start = new Date(Date.now() + hoursFromNow * 3600_000);
  const end = new Date(start.getTime() + 30 * 60_000);
  return { title, plannedStartAt: start.toISOString(), plannedEndAt: end.toISOString(), durationMinutes: 30, windowType: 'NEUTRAL' };
}

async function wipe(email: string) {
  await sql(`DELETE FROM "GoalActivityExecution" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`, [email]).catch(() => {});
  await sql(`DELETE FROM "GoalActivity" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`, [email]).catch(() => {});
  await sql(`DELETE FROM "PlannedActivity" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`, [email]).catch(() => {});
  await sql(`DELETE FROM "Goal" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`, [email]).catch(() => {});
  await sql(`DELETE FROM "User" WHERE email = $1`, [email]).catch(() => {});
}

async function main() {
  // ---- 1. ACTIVE Goal: plan creation and linking succeed ----
  {
    const email = 'hpg2-fix-active@example.com';
    await wipe(email);
    const user = await upsertUserByEmail({ email, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
    const tok = createSessionToken(user.id, user.email);
    const { activities } = await createGoalWithActivities({ userId: user.id, title: 'Fitness', targetDate: null, activities: [{ title: 'Strength training', activityId: null }] });
    const ga = activities[0];

    const res = await plansRoute(req(tok, { ...futurePlan('Strength training'), goalActivityId: ga.id }));
    const body = await res.json();
    check('1. ACTIVE Goal: plan creation succeeds (200)', res.status === 200 && !!body.id);
    const link = (await sql(`SELECT "plannedActivityId" FROM "GoalActivity" WHERE id = $1`, [ga.id]))[0];
    check('1. ACTIVE Goal: the GoalActivity is linked to the new plan', link?.plannedActivityId === body.id);
    await wipe(email);
  }

  // ---- 2. ARCHIVED Goal: 400, no plan, no link (the P0 itself) ----
  {
    const email = 'hpg2-fix-archived@example.com';
    await wipe(email);
    const user = await upsertUserByEmail({ email, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
    const tok = createSessionToken(user.id, user.email);
    const { goal, activities } = await createGoalWithActivities({ userId: user.id, title: 'Reading', targetDate: null, activities: [{ title: 'Read 20 pages', activityId: null }] });
    const ga = activities[0];
    await archiveGoal(user.id, goal.id);

    const planCountBefore = (await sql(`SELECT count(*)::int AS n FROM "PlannedActivity" WHERE "userId" = $1`, [user.id]))[0].n;
    const res = await plansRoute(req(tok, { ...futurePlan('Read 20 pages'), goalActivityId: ga.id }));
    const body = await res.json();
    check('2. ARCHIVED Goal: request rejected with 400', res.status === 400);
    check('2. ARCHIVED Goal: error names the real reason (GOAL_NOT_ACTIVE-style, not the generic link-failed message)', /no longer active/i.test(body?.error ?? ''));
    const planCountAfter = (await sql(`SELECT count(*)::int AS n FROM "PlannedActivity" WHERE "userId" = $1`, [user.id]))[0].n;
    check('2. ARCHIVED Goal: no new PlannedActivity row was committed (the insert that happened before the check was rolled back)', planCountAfter === planCountBefore);
    const link = (await sql(`SELECT "plannedActivityId" FROM "GoalActivity" WHERE id = $1`, [ga.id]))[0];
    check('2. ARCHIVED Goal: the GoalActivity remains unlinked', link?.plannedActivityId == null);
    await wipe(email);
  }

  // ---- 3. Archived AFTER picker selection, before save (the real-world race, simplest form) ----
  {
    const email = 'hpg2-fix-race-simple@example.com';
    await wipe(email);
    const user = await upsertUserByEmail({ email, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
    const tok = createSessionToken(user.id, user.email);
    const { goal, activities } = await createGoalWithActivities({ userId: user.id, title: 'Writing', targetDate: null, activities: [{ title: 'Journal', activityId: null }] });
    const ga = activities[0];
    // "Selection" happens while the Goal is still ACTIVE (the picker only
    // ever lists ACTIVE goals) -- then the Goal is archived in another
    // tab/session before the user hits Save.
    await archiveGoal(user.id, goal.id);
    const res = await plansRoute(req(tok, { ...futurePlan('Journal'), goalActivityId: ga.id }));
    check('3. Goal archived between selection and save: rejected, not silently linked', res.status === 400);
    const link = (await sql(`SELECT "plannedActivityId" FROM "GoalActivity" WHERE id = $1`, [ga.id]))[0];
    check('3. Goal archived between selection and save: the GoalActivity remains unlinked', link?.plannedActivityId == null);
    await wipe(email);
  }

  // ---- 4. TRUE concurrency: archive vs. plan creation racing on the same GoalActivity ----
  {
    const email = 'hpg2-fix-race-concurrent@example.com';
    await wipe(email);
    const user = await upsertUserByEmail({ email, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
    const tok = createSessionToken(user.id, user.email);
    const { goal, activities } = await createGoalWithActivities({ userId: user.id, title: 'Meditation', targetDate: null, activities: [{ title: 'Sit quietly', activityId: null }] });
    const ga = activities[0];

    const [planRes, archivedGoal] = await Promise.all([
      plansRoute(req(tok, { ...futurePlan('Sit quietly'), goalActivityId: ga.id })),
      archiveGoal(user.id, goal.id),
    ]);
    check('4. concurrent archive: archiveGoal itself succeeds', archivedGoal?.status === 'ARCHIVED');

    const link = (await sql(`SELECT "plannedActivityId" FROM "GoalActivity" WHERE id = $1`, [ga.id]))[0];
    const plannedCount = (await sql(`SELECT count(*)::int AS n FROM "PlannedActivity" WHERE "userId" = $1 AND "activityType" = 'Sit quietly'`, [user.id]))[0].n;
    // The row lock (FOR SHARE OF g) serializes the two writers -- there is
    // no window where BOTH "the Goal is ARCHIVED" AND "the GoalActivity is
    // newly linked" are true at once. Either the plan request's
    // transaction committed its SHARE lock read first (Goal still ACTIVE
    // at that instant, link legitimately succeeds, archiveGoal's UPDATE
    // then waits and applies after), or archiveGoal's row lock won first
    // (plan request sees ARCHIVED, 400, no link). Both are valid,
    // serialized outcomes; what must NEVER happen is a linked
    // GoalActivity coexisting with no legitimate ACTIVE-at-link-time
    // history, which the per-branch checks below rule out directly.
    if (planRes.status === 200) {
      check('4. concurrent archive: when the plan request wins the race, the link legitimately succeeded (it was serialized BEFORE the archive)', link?.plannedActivityId != null && plannedCount === 1);
    } else {
      check('4. concurrent archive: when the archive wins the race, the request is rejected and no Goal-derived planning state is committed', planRes.status === 400 && link?.plannedActivityId == null && plannedCount === 0);
    }
    await wipe(email);
  }

  // ---- 4b. Same race, but give the plan request's transaction a head start
  // so it reaches (and holds) the SHARE lock first -- proving the OTHER
  // serialized outcome (plan wins) is also safe, not just assumed from the
  // "archive wins" branch above always winning in practice. ----
  {
    const email = 'hpg2-fix-race-plan-wins@example.com';
    await wipe(email);
    const user = await upsertUserByEmail({ email, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
    const tok = createSessionToken(user.id, user.email);
    const { goal, activities } = await createGoalWithActivities({ userId: user.id, title: 'Focus', targetDate: null, activities: [{ title: 'Deep work block', activityId: null }] });
    const ga = activities[0];

    const delayedArchive = new Promise((resolve) => setTimeout(resolve, 50)).then(() => archiveGoal(user.id, goal.id));
    const [planRes] = await Promise.all([
      plansRoute(req(tok, { ...futurePlan('Deep work block'), goalActivityId: ga.id })),
      delayedArchive,
    ]);
    const link = (await sql(`SELECT "plannedActivityId" FROM "GoalActivity" WHERE id = $1`, [ga.id]))[0];
    const plannedCount = (await sql(`SELECT count(*)::int AS n FROM "PlannedActivity" WHERE "userId" = $1 AND "activityType" = 'Deep work block'`, [user.id]))[0].n;
    check('4b. with a head start, the plan request wins the race: link legitimately succeeds (serialized before the archive)', planRes.status === 200 && link?.plannedActivityId != null && plannedCount === 1);
    await wipe(email);
  }

  // ---- 5. Cross-user GoalActivity id: rejected (ownership check untouched by this fix) ----
  {
    const emailA = 'hpg2-fix-ownerA@example.com';
    const emailB = 'hpg2-fix-ownerB@example.com';
    await wipe(emailA);
    await wipe(emailB);
    const userA = await upsertUserByEmail({ email: emailA, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
    const userB = await upsertUserByEmail({ email: emailB, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
    const tokB = createSessionToken(userB.id, userB.email);
    const { activities } = await createGoalWithActivities({ userId: userA.id, title: 'Fitness', targetDate: null, activities: [{ title: 'Strength training', activityId: null }] });
    const gaOwnedByA = activities[0];

    const res = await plansRoute(req(tokB, { ...futurePlan('Strength training'), goalActivityId: gaOwnedByA.id }));
    check('5. cross-user GoalActivity id: rejected with 400 (not GOAL_NOT_ACTIVE -- still the generic link-failed/ownership path)', res.status === 400);
    const link = (await sql(`SELECT "plannedActivityId" FROM "GoalActivity" WHERE id = $1`, [gaOwnedByA.id]))[0];
    check('5. cross-user GoalActivity id: the real owner\'s GoalActivity remains unlinked', link?.plannedActivityId == null);
    await wipe(emailA);
    await wipe(emailB);
  }

  // ---- 6. Invalid/nonexistent GoalActivity id: rejected ----
  {
    const email = 'hpg2-fix-invalid-id@example.com';
    await wipe(email);
    const user = await upsertUserByEmail({ email, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
    const tok = createSessionToken(user.id, user.email);
    const res = await plansRoute(req(tok, { ...futurePlan('Whatever'), goalActivityId: 'not-a-real-id' }));
    check('6. invalid GoalActivity id: rejected with 400', res.status === 400);
    await wipe(email);
  }

  // ---- 7/8. Failed link rolls back completely; an UNRELATED existing valid link is untouched ----
  {
    const email = 'hpg2-fix-rollback-isolation@example.com';
    await wipe(email);
    const user = await upsertUserByEmail({ email, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
    const tok = createSessionToken(user.id, user.email);
    const { activities: fitnessActivities } = await createGoalWithActivities({ userId: user.id, title: 'Fitness', targetDate: null, activities: [{ title: 'Go for a run', activityId: null }] });
    const liveGa = fitnessActivities[0];
    const liveRes = await plansRoute(req(tok, { ...futurePlan('Go for a run'), goalActivityId: liveGa.id }));
    const livePlan = await liveRes.json();
    check('setup: an unrelated, valid Goal-linked plan exists before the failing attempt', liveRes.status === 200);

    const { goal: deadGoal, activities: deadActivities } = await createGoalWithActivities({ userId: user.id, title: 'Reading', targetDate: null, activities: [{ title: 'Read 20 pages', activityId: null }] });
    const deadGa = deadActivities[0];
    await archiveGoal(user.id, deadGoal.id);
    const planCountBefore = (await sql(`SELECT count(*)::int AS n FROM "PlannedActivity" WHERE "userId" = $1`, [user.id]))[0].n;
    const failRes = await plansRoute(req(tok, { ...futurePlan('Read 20 pages'), goalActivityId: deadGa.id }));
    check('7. failed link (archived Goal) rolls back: request rejected', failRes.status === 400);
    const planCountAfter = (await sql(`SELECT count(*)::int AS n FROM "PlannedActivity" WHERE "userId" = $1`, [user.id]))[0].n;
    check('7. failed link rolls back completely: no new PlannedActivity row persisted', planCountAfter === planCountBefore);

    const liveLinkAfter = (await sql(`SELECT "plannedActivityId" FROM "GoalActivity" WHERE id = $1`, [liveGa.id]))[0];
    check('8. the EARLIER, unrelated, already-valid GoalActivity link is completely untouched by the later failed attempt', liveLinkAfter?.plannedActivityId === livePlan.id);
    await wipe(email);
  }

  // ---- 9. Ordinary plans without goalActivityId keep working ----
  {
    const email = 'hpg2-fix-ordinary-plan@example.com';
    await wipe(email);
    const user = await upsertUserByEmail({ email, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
    const tok = createSessionToken(user.id, user.email);
    const res = await plansRoute(req(tok, futurePlan('Deep work')));
    const body = await res.json();
    check('9. an ordinary plan (no goalActivityId at all) is created normally', res.status === 200 && !!body.id);
    await wipe(email);
  }

  // ---- 10. The underlying lockGoalParentLifecycleForPlanning contract itself is untouched by this fix ----
  {
    const email = 'hpg2-fix-lockfn-contract@example.com';
    await wipe(email);
    const user = await upsertUserByEmail({ email, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
    const { goal, activities } = await createGoalWithActivities({ userId: user.id, title: 'Fitness', targetDate: null, activities: [{ title: 'Strength training', activityId: null }] });
    const ga = activities[0];
    const c = await beginTransaction();
    const beforeArchive = await lockGoalParentLifecycleForPlanning(user.id, [ga.id], c);
    await c.query('COMMIT');
    c.release();
    check('10. lockGoalParentLifecycleForPlanning: an ACTIVE Goal reports its GoalActivity as owned AND active', beforeArchive.owned.has(ga.id) && beforeArchive.active.has(ga.id));
    await archiveGoal(user.id, goal.id);
    const c2 = await beginTransaction();
    const afterArchive = await lockGoalParentLifecycleForPlanning(user.id, [ga.id], c2);
    await c2.query('COMMIT');
    c2.release();
    check('10. lockGoalParentLifecycleForPlanning: after archiving, the SAME GoalActivity is owned but no longer active -- the exact Day-Constructor contract this fix reuses, unmodified', afterArchive.owned.has(ga.id) && !afterArchive.active.has(ga.id));
    await wipe(email);
  }

  if (!allPassed) { console.error('SOME HPG2 ARCHIVED-GOAL LIFECYCLE FIX CHECKS FAILED'); process.exit(1); }
  console.log('ALL HPG2 ARCHIVED-GOAL LIFECYCLE FIX CHECKS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
