/**
 * Goals V2 Candidate A3.2 -- live-database proof for the automatic
 * Goal-demand bootstrap resolver (planDayBootstrap.ts's own
 * `resolveAutomaticGoalDemand`): real ownership scoping, zero writes on
 * repeated reads, exactly A1's own 2-query read path, and genuine
 * end-to-end interplay with the REAL `resolveGoalActivityHandoff` (the
 * manual Goal handoff) for dedup -- including the invalid/not-owned
 * manual-id edge case (this ticket's own section 19). Pure DI-only
 * resolver-logic coverage (eligibility/dedup/date handling) lives in
 * automaticGoalDemandBootstrap.test.ts.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/automaticGoalDemandBootstrapDb.test.ts
 */
import { upsertUserByEmail, updateBirthProfile, createGoalWithActivities, addGoalActivity, beginTransaction, listGoalActivitiesWithLinkedPlanStatus } from '../apps/web/lib/db';
import { resolveAutomaticGoalDemand, resolveGoalActivityHandoff, type AutomaticGoalDemandBootstrapDeps } from '../apps/web/lib/planDayBootstrap';
import { createRealGoalDemandCandidatesDeps } from '../apps/web/lib/goalDemandCandidates';

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

const setRhythm = (goalActivityId: string, targetPerWeek: number) =>
  sql(`UPDATE "GoalActivity" SET "rhythmKind" = 'N_PER_WEEK', "rhythmTargetPerWeek" = $1 WHERE id = $2`, [targetPerWeek, goalActivityId]);

function depsFor(userId: string): AutomaticGoalDemandBootstrapDeps {
  return {
    getSessionToken: () => 'tok',
    verifySession: () => ({ userId }),
    ...createRealGoalDemandCandidatesDeps(),
  };
}

async function main() {
  const user = await upsertUserByEmail({ email: 'test-automatic-goal-demand-bootstrap@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const other = await upsertUserByEmail({ email: 'test-automatic-goal-demand-bootstrap-other@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await updateBirthProfile(user.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  await updateBirthProfile(other.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });

  const cleanup = async () => {
    await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = NULL WHERE "userId" = ANY($1::text[])`, [[user.id, other.id]]);
    await sql(`UPDATE "PlannedActivity" SET "rescheduledFromPlanId" = NULL WHERE "userId" = ANY($1::text[])`, [[user.id, other.id]]);
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])`, [[user.id, other.id]]);
    await sql(`DELETE FROM "GoalActivity" WHERE "userId" = ANY($1::text[])`, [[user.id, other.id]]);
    await sql(`DELETE FROM "Goal" WHERE "userId" = ANY($1::text[])`, [[user.id, other.id]]);
  };
  await cleanup();

  try {
    const { goal } = await createGoalWithActivities({ userId: user.id, title: 'Get fit (A3.2 fixture)', targetDate: null, activities: [] });
    const { goal: otherGoal } = await createGoalWithActivities({ userId: other.id, title: 'Get fit (A3.2 fixture, other user)', targetDate: null, activities: [] });

    // ============================================================
    // Ownership scoping -- end-to-end through the real resolver.
    // ============================================================
    const gaOther = await addGoalActivity(other.id, otherGoal.id, { title: 'Other user workout', activityId: null });
    await setRhythm(gaOther!.id, 3);
    const gaMine = await addGoalActivity(user.id, goal.id, { title: 'My workout', activityId: null });
    await setRhythm(gaMine!.id, 3);

    const forUser = await resolveAutomaticGoalDemand(depsFor(user.id), '2026-10-06', TZ, []);
    const forOther = await resolveAutomaticGoalDemand(depsFor(other.id), '2026-10-06', TZ, []);
    check('ownership: User A never receives User B\'s GoalActivity', forUser.status === 'OK' && !forUser.suggestions.some((s) => s.goalActivityId === gaOther!.id));
    check('ownership: User A does receive their OWN eligible GoalActivity', forUser.status === 'OK' && forUser.suggestions.some((s) => s.goalActivityId === gaMine!.id));
    check('ownership: User B correctly receives their OWN GoalActivity', forOther.status === 'OK' && forOther.suggestions.some((s) => s.goalActivityId === gaOther!.id));

    // ============================================================
    // End-to-end manual dedup -- using the REAL resolveGoalActivityHandoff
    // (not a fake), proving genuine interplay between the two resolvers
    // exactly as page.tsx wires them.
    // ============================================================
    const gaManual = await addGoalActivity(user.id, goal.id, { title: 'Manually planned activity', activityId: null });
    await setRhythm(gaManual!.id, 2);
    const gaAutomatic = await addGoalActivity(user.id, goal.id, { title: 'Automatically eligible activity', activityId: null });
    await setRhythm(gaAutomatic!.id, 2);

    const manualHandoff = await resolveGoalActivityHandoff(
      {
        getSessionToken: () => 'tok',
        verifySession: () => ({ userId: user.id }),
        listGoalActivities: (userId, goalId) => listGoalActivitiesWithLinkedPlanStatus(userId, goalId),
      },
      goal.id,
      gaManual!.id
    );
    check('end-to-end setup: the real manual handoff resolved exactly the requested GoalActivity', manualHandoff.length === 1 && manualHandoff[0].id === gaManual!.id);

    const automatic = await resolveAutomaticGoalDemand(
      depsFor(user.id),
      '2026-10-06',
      TZ,
      manualHandoff.map((item) => item.id)
    );
    check(
      'end-to-end dedup: the manually-handed-off GoalActivity is excluded from automatic demand, the sibling GoalActivity remains',
      automatic.status === 'OK' && !automatic.suggestions.some((s) => s.goalActivityId === gaManual!.id) && automatic.suggestions.some((s) => s.goalActivityId === gaAutomatic!.id)
    );

    // ============================================================
    // Invalid/not-owned manual query id -- this ticket's own section 19.
    // The real manual handoff resolves to [] for a bogus id; the
    // resulting EMPTY exclude list must never suppress a genuinely
    // eligible, unrelated automatic suggestion.
    // ============================================================
    const bogusHandoff = await resolveGoalActivityHandoff(
      {
        getSessionToken: () => 'tok',
        verifySession: () => ({ userId: user.id }),
        listGoalActivities: (userId, goalId) => listGoalActivitiesWithLinkedPlanStatus(userId, goalId),
      },
      goal.id,
      'ga-does-not-exist'
    );
    check('setup: an invalid/not-owned raw query id resolves to an empty manual handoff', bogusHandoff.length === 0);
    const afterBogus = await resolveAutomaticGoalDemand(
      depsFor(user.id),
      '2026-10-06',
      TZ,
      bogusHandoff.map((item) => item.id)
    );
    check(
      'an invalid/not-owned raw manual query id can never suppress a genuinely eligible automatic suggestion',
      afterBogus.status === 'OK' && afterBogus.suggestions.some((s) => s.goalActivityId === gaManual!.id) && afterBogus.suggestions.some((s) => s.goalActivityId === gaAutomatic!.id)
    );

    // ============================================================
    // Zero writes on repeated reads.
    // ============================================================
    const before = await sql(
      `SELECT (SELECT count(*)::int FROM "GoalActivityOccurrence" WHERE "userId" = $1) AS occ,
              (SELECT count(*)::int FROM "PlannedActivity" WHERE "userId" = $1) AS plan,
              (SELECT count(*)::int FROM "GoalActivityExecution" WHERE "goalActivityId" IN (SELECT id FROM "GoalActivity" WHERE "userId" = $1)) AS exec`,
      [user.id]
    );
    await resolveAutomaticGoalDemand(depsFor(user.id), '2026-10-06', TZ, []);
    await resolveAutomaticGoalDemand(depsFor(user.id), '2026-10-06', TZ, []);
    await resolveAutomaticGoalDemand(depsFor(user.id), '2026-10-06', TZ, []);
    const after = await sql(
      `SELECT (SELECT count(*)::int FROM "GoalActivityOccurrence" WHERE "userId" = $1) AS occ,
              (SELECT count(*)::int FROM "PlannedActivity" WHERE "userId" = $1) AS plan,
              (SELECT count(*)::int FROM "GoalActivityExecution" WHERE "goalActivityId" IN (SELECT id FROM "GoalActivity" WHERE "userId" = $1)) AS exec`,
      [user.id]
    );
    check(
      'three repeated bootstrap reads create ZERO new GoalActivityOccurrence/PlannedActivity/GoalActivityExecution rows',
      before[0].occ === after[0].occ && before[0].plan === after[0].plan && before[0].exec === after[0].exec
    );

    // ============================================================
    // Exactly A1's established 2-query read path -- the bootstrap
    // resolver adds no query of its own beyond what loadEligibleGoalDemand
    // already performs.
    // ============================================================
    let discoveryCalls = 0;
    let factsCalls = 0;
    const real = createRealGoalDemandCandidatesDeps();
    const countingDeps: AutomaticGoalDemandBootstrapDeps = {
      getSessionToken: () => 'tok',
      verifySession: () => ({ userId: user.id }),
      loadCandidateGoalActivities: async (userId) => {
        discoveryCalls += 1;
        return real.loadCandidateGoalActivities(userId);
      },
      loadRhythmFacts: async (userId, ids, timezone) => {
        factsCalls += 1;
        return real.loadRhythmFacts(userId, ids, timezone);
      },
    };
    await resolveAutomaticGoalDemand(countingDeps, '2026-10-06', TZ, []);
    check('exactly ONE discovery query call for the whole bootstrap resolution', discoveryCalls === 1);
    check('exactly ONE batched facts query call for the whole bootstrap resolution', factsCalls === 1);
  } finally {
    await cleanup();
  }

  if (!allPassed) {
    console.error('SOME AUTOMATIC GOAL DEMAND BOOTSTRAP DB CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL AUTOMATIC GOAL DEMAND BOOTSTRAP DB CHECKS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
