/**
 * Goals V2 Candidate A1 -- live-database proof of the eligible Goal-demand
 * read model's discovery query and real-wiring composition
 * (loadCandidateGoalActivitiesForRhythmDemand + loadEligibleGoalDemand via
 * createRealGoalDemandCandidatesDeps). Exercises real Goal/GoalActivity/
 * PlannedActivity/GoalActivityOccurrence rows through the REAL acceptance
 * path (persistAcceptedConstructedDay) and the REAL lifecycle mutators
 * (logPlannedActivity/skipPlannedActivity/cancelPlannedActivity/
 * movePlannedActivity/archiveGoal) -- same established convention as
 * goalActivityRhythmMaterializationDb.test.ts. No pure capacity-math
 * re-derivation here -- see test/goalDemandCandidates.test.ts for that.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/goalDemandCandidatesDb.test.ts
 */
import {
  upsertUserByEmail,
  updateBirthProfile,
  createGoalWithActivities,
  addGoalActivity,
  archiveGoal,
  logPlannedActivity,
  skipPlannedActivity,
  cancelPlannedActivity,
  beginTransaction,
  loadCandidateGoalActivitiesForRhythmDemand,
} from '../apps/web/lib/db';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import type { AcceptConstructedDayRequest } from '../apps/web/lib/dayConstructorAcceptance';
import { movePlannedActivity } from '../apps/web/lib/planMove';
import { loadEligibleGoalDemand, createRealGoalDemandCandidatesDeps, type GoalDemandCandidatesDeps } from '../apps/web/lib/goalDemandCandidates';
import { fixtureAnchorMonday, addCivilDays, realClockReferenceForFixture } from './lifecycleFixtureCalendar';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';

// CI reliability -- the fixture week is ANCHORED in the future (see test/lifecycleFixtureCalendar.ts), not hard-coded. `movePlannedActivity` requires a destination in the future
// of the DATABASE clock (clock_timestamp()), so a calendar frozen at the day this test was written began failing on every run once that day passed. Production is right
// to refuse a past destination; the weekday structure this fixture needs (a Monday-start Rhythm week, a Sunday before the boundary, the next Monday and Tuesday) is
// identical on every run date, and the whole week is always in the future of the real clocks production consults.
const ANCHOR_MONDAY = fixtureAnchorMonday(realClockReferenceForFixture(), TZ);
const TUE = addCivilDays(ANCHOR_MONDAY, 1);
const WED = addCivilDays(ANCHOR_MONDAY, 2);
const SUN = addCivilDays(ANCHOR_MONDAY, 6);
const NEXT_MON = addCivilDays(ANCHOR_MONDAY, 7);
const NEXT_TUE = addCivilDays(ANCHOR_MONDAY, 8);

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

function iso(s: string): Date {
  return new Date(s);
}
function window(date: string, start: string, end: string) {
  return { date, start: iso(start), end: iso(end), timezone: TZ, source: 'EXPLICIT_RANGE' as const };
}

const setRhythm = (goalActivityId: string, targetPerWeek: number) =>
  sql(`UPDATE "GoalActivity" SET "rhythmKind" = 'N_PER_WEEK', "rhythmTargetPerWeek" = $1 WHERE id = $2`, [targetPerWeek, goalActivityId]);

async function main() {
  const user = await upsertUserByEmail({ email: 'test-goal-demand-candidates@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const other = await upsertUserByEmail({ email: 'test-goal-demand-candidates-other@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await updateBirthProfile(user.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  await updateBirthProfile(other.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });

  const cleanup = async () => {
    await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = NULL WHERE "userId" = ANY($1::text[])`, [[user.id, other.id]]);
    await sql(`UPDATE "PlannedActivity" SET "rescheduledFromPlanId" = NULL WHERE "userId" = ANY($1::text[])`, [[user.id, other.id]]);
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])`, [[user.id, other.id]]);
    // The acceptance idempotency claims are keyed by the (now deterministic) clientRequestId; a rerun against the same upserted users must not replay a prior run's claims.
    await sql(`DELETE FROM "PlanCreationIdempotency" WHERE "userId" = ANY($1::text[])`, [[user.id, other.id]]);
    await sql(`DELETE FROM "GoalActivity" WHERE "userId" = ANY($1::text[])`, [[user.id, other.id]]);
    await sql(`DELETE FROM "Goal" WHERE "userId" = ANY($1::text[])`, [[user.id, other.id]]);
  };
  await cleanup(); // purge leftovers from a prior interrupted run against the same upserted users

  const realDeps = createRealGoalDemandCandidatesDeps();

  async function makeOccurrenceFor(goalActivityId: string, intentId: string, startIso: string, endIso: string, windowDate: string) {
    const req: AcceptConstructedDayRequest = {
      clientRequestId: `goal-demand-${ANCHOR_MONDAY}-${intentId}`,
      constructionWindow: window(windowDate, `${windowDate}T06:00:00Z`, `${windowDate}T20:00:00Z`),
      proposedItems: [{ intentId, title: 'Workout', placementSource: 'SELECTED_CANDIDATE', start: iso(startIso), end: iso(endIso) }],
    };
    return persistAcceptedConstructedDay(user.id, req, iso(`${windowDate}T05:00:00Z`), new Map([[intentId, goalActivityId]]));
  }

  try {
    const { goal } = await createGoalWithActivities({ userId: user.id, title: 'Get fit (A1 fixture)', targetDate: null, activities: [] });
    const { goal: otherGoal } = await createGoalWithActivities({ userId: other.id, title: 'Get fit (A1 fixture, other user)', targetDate: null, activities: [] });

    // ============================================================
    // 1. Eligible N_PER_WEEK activity, no prior occurrences -> returned
    // ============================================================
    const ga1 = await addGoalActivity(user.id, goal.id, { title: 'Workout', activityId: null });
    await setRhythm(ga1!.id, 3);
    const r1 = await loadEligibleGoalDemand(realDeps, user.id, TUE, TZ);
    check('1. a SUGGESTED N_PER_WEEK activity with no prior occurrences is returned', r1.status === 'OK' && r1.candidates.some((c) => c.goalActivityId === ga1!.id && c.remainingThisWeek === 3));

    // ============================================================
    // 2/3. Multi-Occurrence Rhythm PR 2 -- a live UPCOMING commitment no
    // longer structurally excludes the activity by itself (the former
    // HAS_LIVE_COMMITMENT/SQL exclusion is removed): with real numeric
    // capacity still remaining (3 - 0 completed - 1 committed = 2), the
    // activity is STILL returned, with remainingThisWeek correctly
    // reduced to 2 -- this is the exact behavior Multi-Occurrence Rhythm
    // exists to deliver (mirrors materializeGoalActivityRhythmOccurrence's
    // own PR 2 gate exactly: weekly capacity is the only remaining check).
    // ============================================================
    const d2 = await makeOccurrenceFor(ga1!.id, 'intent-ga1-a', `${TUE}T10:00:00Z`, `${TUE}T10:10:00Z`, TUE);
    check('2. setup: first occurrence SAVED (now UPCOMING)', d2.status === 'SAVED');
    const r2 = await loadEligibleGoalDemand(realDeps, user.id, TUE, TZ);
    const c2 = r2.status === 'OK' ? r2.candidates.find((c) => c.goalActivityId === ga1!.id) : undefined;
    check('3. an activity with a live UPCOMING commitment and remaining numeric capacity (3-0-1=2) is still offered, with remainingThisWeek correctly reduced to 2', !!c2 && c2.remainingThisWeek === 2);

    // ============================================================
    // 4. LOGGED consumes completed capacity -- resolving the UPCOMING
    // commitment (logging it) re-admits the activity with reduced capacity.
    // ============================================================
    const plan2 = (d2 as any).plans[0];
    await logPlannedActivity(user.id, plan2.id);
    const r4 = await loadEligibleGoalDemand(realDeps, user.id, TUE, TZ);
    const c4 = r4.status === 'OK' ? r4.candidates.find((c) => c.goalActivityId === ga1!.id) : undefined;
    check('4. after LOGGING the commitment, the activity is eligible again with remainingThisWeek reduced to 2 (3 - 1 completed)', !!c4 && c4.remainingThisWeek === 2);

    // ============================================================
    // 5. SKIPPED frees capacity entirely (never consumed, never excluded)
    // ============================================================
    const ga5 = await addGoalActivity(user.id, goal.id, { title: 'Workout', activityId: null });
    await setRhythm(ga5!.id, 2);
    const d5 = await makeOccurrenceFor(ga5!.id, 'intent-ga5', `${TUE}T11:00:00Z`, `${TUE}T11:10:00Z`, TUE);
    await skipPlannedActivity(user.id, (d5 as any).plans[0].id);
    const r5 = await loadEligibleGoalDemand(realDeps, user.id, TUE, TZ);
    const c5 = r5.status === 'OK' ? r5.candidates.find((c) => c.goalActivityId === ga5!.id) : undefined;
    check('5. a SKIPPED occurrence frees its capacity back to full (remainingThisWeek 2, not 1)', !!c5 && c5.remainingThisWeek === 2);

    // ============================================================
    // 6. CANCELLED frees capacity entirely
    // ============================================================
    const ga6 = await addGoalActivity(user.id, goal.id, { title: 'Workout', activityId: null });
    await setRhythm(ga6!.id, 2);
    const d6 = await makeOccurrenceFor(ga6!.id, 'intent-ga6', `${TUE}T12:00:00Z`, `${TUE}T12:10:00Z`, TUE);
    await cancelPlannedActivity(user.id, (d6 as any).plans[0].id);
    const r6 = await loadEligibleGoalDemand(realDeps, user.id, TUE, TZ);
    const c6 = r6.status === 'OK' ? r6.candidates.find((c) => c.goalActivityId === ga6!.id) : undefined;
    check('6. a CANCELLED occurrence frees its capacity back to full (remainingThisWeek 2, not 1)', !!c6 && c6.remainingThisWeek === 2);

    // ============================================================
    // 7. MOVED is not double-counted -- the SAME occurrence persists
    // through a Move; logging the successor counts it exactly once.
    // ============================================================
    const ga7 = await addGoalActivity(user.id, goal.id, { title: 'Workout', activityId: null });
    await setRhythm(ga7!.id, 2);
    const d7 = await makeOccurrenceFor(ga7!.id, 'intent-ga7', `${TUE}T13:00:00Z`, `${TUE}T13:10:00Z`, TUE);
    const moved7 = await movePlannedActivity(user.id, (d7 as any).plans[0].id, { newStartAt: iso(`${TUE}T15:00:00Z`) });
    await logPlannedActivity(user.id, moved7.to.id);
    const r7 = await loadEligibleGoalDemand(realDeps, user.id, TUE, TZ);
    const c7 = r7.status === 'OK' ? r7.candidates.find((c) => c.goalActivityId === ga7!.id) : undefined;
    check('7. a Moved-then-Logged occurrence counts as exactly ONE completion (remainingThisWeek 1 of 2), never two', !!c7 && c7.remainingThisWeek === 1);

    // ============================================================
    // 8. Week reset -- a prior week's exhausted capacity does not carry over
    // ============================================================
    const ga8 = await addGoalActivity(user.id, goal.id, { title: 'Workout', activityId: null });
    await setRhythm(ga8!.id, 1);
    const d8 = await makeOccurrenceFor(ga8!.id, 'intent-ga8', `${TUE}T14:00:00Z`, `${TUE}T14:10:00Z`, TUE);
    await logPlannedActivity(user.id, (d8 as any).plans[0].id);
    const r8sameWeek = await loadEligibleGoalDemand(realDeps, user.id, WED, TZ);
    check('8a. same week as the completion: 1/week exhausted, excluded', r8sameWeek.status === 'OK' && !r8sameWeek.candidates.some((c) => c.goalActivityId === ga8!.id));
    const r8nextWeek = await loadEligibleGoalDemand(realDeps, user.id, NEXT_TUE, TZ); // Tuesday of the NEXT Monday-start week (anchor + 8 days)
    const c8next = r8nextWeek.status === 'OK' ? r8nextWeek.candidates.find((c) => c.goalActivityId === ga8!.id) : undefined;
    check('8b. a new week resets capacity -- eligible again with full remainingThisWeek 1, no debt carried', !!c8next && c8next.remainingThisWeek === 1);

    // ============================================================
    // 9. Sunday -> Monday planning-date boundary
    // ============================================================
    const ga9 = await addGoalActivity(user.id, goal.id, { title: 'Workout', activityId: null });
    await setRhythm(ga9!.id, 1);
    // SUN is the Sunday (the last day) of the anchored Monday-start week that contains TUE.
    const d9 = await makeOccurrenceFor(ga9!.id, 'intent-ga9', `${SUN}T14:00:00Z`, `${SUN}T14:10:00Z`, SUN);
    await logPlannedActivity(user.id, (d9 as any).plans[0].id);
    const r9sunday = await loadEligibleGoalDemand(realDeps, user.id, SUN, TZ);
    check('9a. planning for Sunday itself: the Sunday completion exhausts THIS week -> excluded', r9sunday.status === 'OK' && !r9sunday.candidates.some((c) => c.goalActivityId === ga9!.id));
    const r9monday = await loadEligibleGoalDemand(realDeps, user.id, NEXT_MON, TZ); // the next day, Monday, the NEW week
    const c9monday = r9monday.status === 'OK' ? r9monday.candidates.find((c) => c.goalActivityId === ga9!.id) : undefined;
    check('9b. planning for the very next day (Monday, crossing the week boundary): eligible again, full capacity', !!c9monday && c9monday.remainingThisWeek === 1);

    // ============================================================
    // 10. Multiple active Goals, multiple activities, mixed eligible/ineligible
    // ============================================================
    const { goal: goal2 } = await createGoalWithActivities({ userId: user.id, title: 'Read more (A1 fixture)', targetDate: null, activities: [] });
    const ga10a = await addGoalActivity(user.id, goal.id, { title: 'Workout B', activityId: null });
    await setRhythm(ga10a!.id, 2);
    const ga10b = await addGoalActivity(user.id, goal2.id, { title: 'Read 20 pages', activityId: null });
    await setRhythm(ga10b!.id, 1);
    const ga10c = await addGoalActivity(user.id, goal2.id, { title: 'Read 20 pages (exhausted)', activityId: null });
    await setRhythm(ga10c!.id, 1);
    const d10c = await makeOccurrenceFor(ga10c!.id, 'intent-ga10c', `${TUE}T16:00:00Z`, `${TUE}T16:10:00Z`, TUE);
    await logPlannedActivity(user.id, (d10c as any).plans[0].id);
    const r10 = await loadEligibleGoalDemand(realDeps, user.id, TUE, TZ);
    check(
      '10. multiple Goals -> eligible activities from BOTH Goals are returned together, ineligible one excluded, no cross-Goal grouping',
      r10.status === 'OK' && r10.candidates.some((c) => c.goalActivityId === ga10a!.id) && r10.candidates.some((c) => c.goalActivityId === ga10b!.id) && !r10.candidates.some((c) => c.goalActivityId === ga10c!.id)
    );

    // ============================================================
    // 11. Archived Goal excluded entirely
    // ============================================================
    const { goal: archivedGoal } = await createGoalWithActivities({ userId: user.id, title: 'Old goal (to archive)', targetDate: null, activities: [] });
    const ga11 = await addGoalActivity(user.id, archivedGoal.id, { title: 'Stretch', activityId: null });
    await setRhythm(ga11!.id, 3);
    await archiveGoal(user.id, archivedGoal.id);
    const r11 = await loadEligibleGoalDemand(realDeps, user.id, TUE, TZ);
    check('11. a GoalActivity belonging to an ARCHIVED Goal is excluded', r11.status === 'OK' && !r11.candidates.some((c) => c.goalActivityId === ga11!.id));

    // ============================================================
    // 12. DISMISSED GoalActivity excluded
    // ============================================================
    const ga12 = await addGoalActivity(user.id, goal.id, { title: 'Yoga', activityId: null });
    await setRhythm(ga12!.id, 3);
    await sql(`UPDATE "GoalActivity" SET status = 'DISMISSED' WHERE id = $1`, [ga12!.id]);
    const r12 = await loadEligibleGoalDemand(realDeps, user.id, TUE, TZ);
    check('12. a DISMISSED GoalActivity is excluded', r12.status === 'OK' && !r12.candidates.some((c) => c.goalActivityId === ga12!.id));

    // ============================================================
    // 13. Rhythm NONE excluded
    // ============================================================
    const ga13 = await addGoalActivity(user.id, goal.id, { title: 'One-off errand', activityId: null }); // rhythmKind left NONE
    const r13 = await loadEligibleGoalDemand(realDeps, user.id, TUE, TZ);
    check('13. a Rhythm NONE (finite) GoalActivity is excluded from Goal-demand entirely', r13.status === 'OK' && !r13.candidates.some((c) => c.goalActivityId === ga13!.id));

    // ============================================================
    // 14. Cross-user isolation
    // ============================================================
    const otherGa = await addGoalActivity(other.id, otherGoal.id, { title: 'Other users workout', activityId: null });
    await setRhythm(otherGa!.id, 3);
    const r14ForUser = await loadEligibleGoalDemand(realDeps, user.id, TUE, TZ);
    const r14ForOther = await loadEligibleGoalDemand(realDeps, other.id, TUE, TZ);
    check('14a. User A never receives User B\'s GoalActivity', r14ForUser.status === 'OK' && !r14ForUser.candidates.some((c) => c.goalActivityId === otherGa!.id));
    check('14b. User B correctly receives their OWN GoalActivity', r14ForOther.status === 'OK' && r14ForOther.candidates.some((c) => c.goalActivityId === otherGa!.id));

    // ============================================================
    // 15. Zero eligible -> successful empty result (never LOAD_FAILED)
    // ============================================================
    const freshUser = await upsertUserByEmail({ email: 'test-goal-demand-candidates-fresh@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
    const r15 = await loadEligibleGoalDemand(realDeps, freshUser.id, TUE, TZ);
    check('15. a user with zero GoalActivities at all gets a successful, empty result', r15.status === 'OK' && r15.candidates.length === 0);

    // ============================================================
    // 16. Repeated loader calls create zero rows (read-only, this ticket's
    // own section 15) -- counted directly against the three write tables.
    // ============================================================
    const before16 = await sql(
      `SELECT (SELECT count(*)::int FROM "GoalActivityOccurrence" WHERE "userId" = $1) AS occ,
              (SELECT count(*)::int FROM "PlannedActivity" WHERE "userId" = $1) AS plan,
              (SELECT count(*)::int FROM "GoalActivityExecution" WHERE "goalActivityId" IN (SELECT id FROM "GoalActivity" WHERE "userId" = $1)) AS exec`,
      [user.id]
    );
    await loadEligibleGoalDemand(realDeps, user.id, TUE, TZ);
    await loadEligibleGoalDemand(realDeps, user.id, TUE, TZ);
    await loadEligibleGoalDemand(realDeps, user.id, TUE, TZ);
    const after16 = await sql(
      `SELECT (SELECT count(*)::int FROM "GoalActivityOccurrence" WHERE "userId" = $1) AS occ,
              (SELECT count(*)::int FROM "PlannedActivity" WHERE "userId" = $1) AS plan,
              (SELECT count(*)::int FROM "GoalActivityExecution" WHERE "goalActivityId" IN (SELECT id FROM "GoalActivity" WHERE "userId" = $1)) AS exec`,
      [user.id]
    );
    check(
      '16. three repeated loader calls create ZERO new GoalActivityOccurrence/PlannedActivity/GoalActivityExecution rows',
      before16[0].occ === after16[0].occ && before16[0].plan === after16[0].plan && before16[0].exec === after16[0].exec
    );

    // ============================================================
    // 17. Batched facts / no N+1 -- exactly ONE discovery call and ONE
    // facts call, regardless of candidate count (counted via a DI wrapper
    // around the real deps, never pg-level instrumentation).
    // ============================================================
    const ga17extra: string[] = [];
    for (let i = 0; i < 4; i++) {
      const ga = await addGoalActivity(user.id, goal.id, { title: `Batch activity ${i}`, activityId: null });
      await setRhythm(ga!.id, 2);
      ga17extra.push(ga!.id);
    }
    let discoveryCalls = 0;
    let factsCalls = 0;
    const countingDeps: GoalDemandCandidatesDeps = {
      loadCandidateGoalActivities: async (userId) => {
        discoveryCalls += 1;
        return realDeps.loadCandidateGoalActivities(userId);
      },
      loadRhythmFacts: async (userId, ids, timezone) => {
        factsCalls += 1;
        return realDeps.loadRhythmFacts(userId, ids, timezone);
      },
    };
    const r17 = await loadEligibleGoalDemand(countingDeps, user.id, TUE, TZ);
    check('17a. exactly ONE discovery query call for this whole request, independent of candidate count', discoveryCalls === 1);
    check('17b. exactly ONE batched facts query call for this whole request, independent of candidate count', factsCalls === 1);
    check('17c. every batch-created activity is present in that single result', r17.status === 'OK' && ga17extra.every((id) => r17.candidates.some((c) => c.goalActivityId === id)));

    // ============================================================
    // 18. Deterministic stable output across repeated calls
    // ============================================================
    const rA = await loadEligibleGoalDemand(realDeps, user.id, TUE, TZ);
    const rB = await loadEligibleGoalDemand(realDeps, user.id, TUE, TZ);
    const idsA = rA.status === 'OK' ? rA.candidates.map((c) => c.goalActivityId).join(',') : '';
    const idsB = rB.status === 'OK' ? rB.candidates.map((c) => c.goalActivityId).join(',') : '';
    check('18. repeated calls against unchanged state return candidates in the identical order', idsA.length > 0 && idsA === idsB);

    // ============================================================
    // 19. Raw discovery query, called directly -- proves the SQL filter
    // itself (not just the composed loader) still excludes DISMISSED/
    // ARCHIVED/non-N_PER_WEEK at the query level. Multi-Occurrence Rhythm
    // PR 2: a live UPCOMING commitment is NO LONGER excluded at this
    // layer -- weekly capacity (computed one layer up, never duplicated
    // in SQL) is the only remaining gate.
    // ============================================================
    const ga19 = await addGoalActivity(user.id, goal.id, { title: 'Workout (live commitment)', activityId: null });
    await setRhythm(ga19!.id, 3);
    await makeOccurrenceFor(ga19!.id, 'intent-ga19', `${TUE}T17:00:00Z`, `${TUE}T17:10:00Z`, TUE); // left UPCOMING, never resolved.
    const raw19 = await loadCandidateGoalActivitiesForRhythmDemand(user.id);
    check('19a. the raw discovery query never returns the DISMISSED activity from check 12', !raw19.some((r) => r.goalActivityId === ga12!.id));
    check('19b. the raw discovery query never returns the ARCHIVED-Goal activity from check 11', !raw19.some((r) => r.goalActivityId === ga11!.id));
    check('19c. the raw discovery query never returns the Rhythm NONE activity from check 13', !raw19.some((r) => r.goalActivityId === ga13!.id));
    check('19d. the raw discovery query DOES return an activity with a live UPCOMING commitment (Multi-Occurrence Rhythm PR 2 -- capacity, not this query, now decides)', raw19.some((r) => r.goalActivityId === ga19!.id));
  } finally {
    await cleanup();
  }

  if (!allPassed) {
    console.error('SOME GOAL DEMAND CANDIDATES DB CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL GOAL DEMAND CANDIDATES DB CHECKS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
