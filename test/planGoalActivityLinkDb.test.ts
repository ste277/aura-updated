// AURA HPG2 -- Goal-Linked Plan Creation. DB-backed tests for the new
// goalActivityId handling in POST /api/plans (apps/web/app/api/plans/route.ts).
// Run with: npx ts-node test/planGoalActivityLinkDb.test.ts (needs
// DATABASE_URL pointed at a disposable local Postgres with migrations
// applied).
import { POST as plansRoute } from '../apps/web/app/api/plans/route';
import { upsertUserByEmail, createGoalWithActivities, beginTransaction } from '../apps/web/lib/db';
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
  return {
    title,
    plannedStartAt: start.toISOString(),
    plannedEndAt: end.toISOString(),
    durationMinutes: 30,
    windowType: 'NEUTRAL',
  };
}

async function main() {
  const emailA = 'hpg2-review-usera@example.com';
  const emailB = 'hpg2-review-userb@example.com';
  await sql(`DELETE FROM "GoalActivity" WHERE "userId" IN (SELECT id FROM "User" WHERE email = ANY($1))`, [[emailA, emailB]]).catch(() => {});
  await sql(`DELETE FROM "PlannedActivity" WHERE "userId" IN (SELECT id FROM "User" WHERE email = ANY($1))`, [[emailA, emailB]]).catch(() => {});
  await sql(`DELETE FROM "Goal" WHERE "userId" IN (SELECT id FROM "User" WHERE email = ANY($1))`, [[emailA, emailB]]).catch(() => {});
  await sql(`DELETE FROM "User" WHERE email = ANY($1)`, [[emailA, emailB]]).catch(() => {});

  const userA = await upsertUserByEmail({ email: emailA, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
  const tokA = createSessionToken(userA.id, userA.email);
  const userB = await upsertUserByEmail({ email: emailB, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
  const tokB = createSessionToken(userB.id, userB.email);

  const { goal: goalA, activities: activitiesA } = await createGoalWithActivities({
    userId: userA.id,
    title: 'Learn Spanish',
    targetDate: null,
    activities: [
      { title: 'Practice vocabulary', activityId: null, rhythm: { kind: 'NONE' } },
      { title: 'Duplicate Title', activityId: null, rhythm: { kind: 'NONE' } },
    ],
  });
  const { goal: goalA2, activities: activitiesA2 } = await createGoalWithActivities({
    userId: userA.id,
    title: 'Read more',
    targetDate: null,
    activities: [{ title: 'Duplicate Title', activityId: null, rhythm: { kind: 'NONE' } }],
  });
  const practiceVocab = activitiesA.find((a) => a.title === 'Practice vocabulary')!;
  const dupInGoalA = activitiesA.find((a) => a.title === 'Duplicate Title')!;
  const dupInGoalA2 = activitiesA2.find((a) => a.title === 'Duplicate Title')!;

  try {
    // ---- 1. Explicit GoalActivity selection links correctly ----
    const r1 = await plansRoute(req(tokA, { ...futurePlan('Practice Spanish vocab'), goalActivityId: practiceVocab.id }));
    const b1 = await r1.json();
    check('1. valid, owned, SUGGESTED goalActivityId -> 200 OK, plan created', r1.status === 200 && b1.id);
    const linked1 = await sql(`SELECT "plannedActivityId" FROM "GoalActivity" WHERE id = $1`, [practiceVocab.id]);
    check('1. GoalActivity.plannedActivityId now points at the new plan', linked1[0]?.plannedActivityId === b1.id);

    // ---- 2. Ordinary title-only plan (no goalActivityId at all) is unaffected ----
    const r2 = await plansRoute(req(tokA, futurePlan('Just a normal plan')));
    const b2 = await r2.json();
    check('2. ordinary plan creation (no goalActivityId) still works exactly as before', r2.status === 200 && b2.id);

    // ---- 3. Ordinary catalog-activity plan (activityId present, no goalActivityId) is unaffected ----
    const r3 = await plansRoute(req(tokA, { ...futurePlan('Workout'), activityId: 'workout' }));
    const b3 = await r3.json();
    check('3. a plain catalog-activity plan (HPG1 identity, no Goal) still works unchanged', r3.status === 200 && b3.activityId === 'workout');

    // ---- 4. Duplicate titles belonging to DIFFERENT Goals -- the explicit id wins, never title-matched ----
    const r4 = await plansRoute(req(tokA, { ...futurePlan('Duplicate Title'), goalActivityId: dupInGoalA2.id }));
    const b4 = await r4.json();
    check('4. linking succeeds for the SPECIFIC goalActivityId requested (goalA2\'s own "Duplicate Title")', r4.status === 200 && b4.id);
    const dupLink1 = await sql(`SELECT "plannedActivityId" FROM "GoalActivity" WHERE id = $1`, [dupInGoalA2.id]);
    const dupLink2 = await sql(`SELECT "plannedActivityId" FROM "GoalActivity" WHERE id = $1`, [dupInGoalA.id]);
    check('4. the OTHER goal activity sharing the same title (goalA\'s own) was NOT linked -- no title-based cross-resolution', dupLink1[0]?.plannedActivityId === b4.id && dupLink2[0]?.plannedActivityId === null);

    // ---- 5. Missing goalActivityId field entirely is identical to null (no-op) ----
    const r5 = await plansRoute(req(tokA, { ...futurePlan('No goal field at all') }));
    check('5. omitting goalActivityId entirely behaves exactly like passing none', r5.status === 200);

    // ---- 6. Empty-string goalActivityId is treated as absent ----
    const r6 = await plansRoute(req(tokA, { ...futurePlan('Empty goal id'), goalActivityId: '' }));
    const b6 = await r6.json();
    check('6. empty-string goalActivityId -> treated as no Goal link, plan still created', r6.status === 200 && b6.id);

    // ---- 7. Stale/malformed/nonexistent goalActivityId rejects the WHOLE request -- no orphan plan ----
    const countBefore7 = (await sql(`SELECT COUNT(*)::int AS c FROM "PlannedActivity" WHERE "userId" = $1`, [userA.id]))[0].c;
    const r7 = await plansRoute(req(tokA, { ...futurePlan('Should not be created'), goalActivityId: 'not-a-real-goal-activity-id-at-all' }));
    const countAfter7 = (await sql(`SELECT COUNT(*)::int AS c FROM "PlannedActivity" WHERE "userId" = $1`, [userA.id]))[0].c;
    check('7. a nonexistent/malformed goalActivityId -> 400, request rejected', r7.status === 400);
    check('7. no orphan PlannedActivity was created when the Goal link failed', countAfter7 === countBefore7);

    // ---- 8. Cross-user goalActivityId: userB cannot link to userA's GoalActivity ----
    const countBefore8 = (await sql(`SELECT COUNT(*)::int AS c FROM "PlannedActivity" WHERE "userId" = $1`, [userB.id]))[0].c;
    const r8 = await plansRoute(req(tokB, { ...futurePlan('Cross-user attempt'), goalActivityId: practiceVocab.id }));
    const countAfter8 = (await sql(`SELECT COUNT(*)::int AS c FROM "PlannedActivity" WHERE "userId" = $1`, [userB.id]))[0].c;
    check('8. userB referencing userA\'s own GoalActivity id -> 400, rejected (ownership enforced server-side)', r8.status === 400);
    check('8. no PlannedActivity row was created for userB from this rejected attempt', countAfter8 === countBefore8);
    const stillLinkedToA = await sql(`SELECT "plannedActivityId" FROM "GoalActivity" WHERE id = $1`, [practiceVocab.id]);
    check('8. userA\'s own GoalActivity linkage from check 1 is untouched by userB\'s rejected attempt', stillLinkedToA[0]?.plannedActivityId === b1.id);

    // ---- 9. An already-actively-linked GoalActivity cannot be stolen by a second plan ----
    const r9 = await plansRoute(req(tokA, { ...futurePlan('Trying to relink'), goalActivityId: practiceVocab.id }));
    check('9. a GoalActivity already linked to a LIVE (UPCOMING) plan cannot be relinked to a different new plan', r9.status === 400);

    // ---- 10. Re-linking a CANCELLED plan's GoalActivity IS allowed (established eligibility rule, reused unmodified) ----
    await sql(`UPDATE "PlannedActivity" SET status = 'CANCELLED' WHERE id = $1`, [b2.id]);
    const { activities: freshActivities } = await createGoalWithActivities({ userId: userA.id, title: 'Relink test', targetDate: null, activities: [{ title: 'Relinkable', activityId: null, rhythm: { kind: 'NONE' } }] });
    const relinkable = freshActivities[0];
    await sql(`UPDATE "GoalActivity" SET "plannedActivityId" = $1 WHERE id = $2`, [b2.id, relinkable.id]);
    await sql(`UPDATE "PlannedActivity" SET status = 'CANCELLED' WHERE id = $1`, [b2.id]);
    const r10 = await plansRoute(req(tokA, { ...futurePlan('Replacement plan'), goalActivityId: relinkable.id }));
    const b10 = await r10.json();
    check('10. a GoalActivity linked only to a CANCELLED plan CAN be relinked to a fresh plan (same rule Day Constructor already relies on)', r10.status === 200 && b10.id);

    // ---- 11. goalActivityId is a separate identity space from activityId -- never conflated ----
    const r11 = await plansRoute(req(tokA, { ...futurePlan('Both identities at once'), activityId: 'deep-work', goalActivityId: dupInGoalA.id }));
    const b11 = await r11.json();
    check('11. activityId (catalog) and goalActivityId (Goal) can both be supplied together, independently, without collision', r11.status === 200 && b11.activityId === 'deep-work');
    const bothLinked = await sql(`SELECT "plannedActivityId" FROM "GoalActivity" WHERE id = $1`, [dupInGoalA.id]);
    check('11. the Goal link was ALSO correctly established alongside the independent catalog activityId', bothLinked[0]?.plannedActivityId === b11.id);

    // ---- 12. A catalog activityId (HPG1 identity) is never accepted as if it were a GoalActivity id ----
    const r12 = await plansRoute(req(tokA, { ...futurePlan('Catalog id as goal id'), goalActivityId: 'deep-work' }));
    check('12. a real CATALOG activityId string, passed as goalActivityId, does not resolve to any GoalActivity row -- rejected, not silently accepted as if interchangeable', r12.status === 400);
  } finally {
    await sql(`DELETE FROM "GoalActivity" WHERE "userId" IN ($1, $2)`, [userA.id, userB.id]).catch(() => {});
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" IN ($1, $2)`, [userA.id, userB.id]).catch(() => {});
    await sql(`DELETE FROM "Goal" WHERE "userId" IN ($1, $2)`, [userA.id, userB.id]).catch(() => {});
    await sql(`DELETE FROM "User" WHERE email = ANY($1)`, [[emailA, emailB]]).catch(() => {});
  }

  if (!allPassed) { console.error('SOME HPG2 GOAL-ACTIVITY LINK CHECKS FAILED'); process.exit(1); }
  console.log('ALL HPG2 GOAL-ACTIVITY LINK CHECKS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
