/**
 * Constructor Decision Intelligence -- Decision Facts V1, live-DB
 * integration proof.
 *
 * Proves the real pipeline: a real recurring GoalActivity -> canonical
 * Rhythm facts (goalActivityRhythm.ts, reused verbatim) -> real
 * automatic Goal demand (loadEligibleGoalDemand) -> a real Goal-demand
 * intent id (encodeGoalDemandIntentId) -> the real orchestrator
 * (orchestrateConstructDay, createRealDayConstructorOrchestratorDeps) ->
 * `DecisionFacts` genuinely visible on the resolved `DayIntent` at the
 * Decision Policy boundary (`ConstructDayPreview.resolvedIntents`) --
 * while `dayConstructor.ts`'s own placement/precedence behavior stays
 * byte-for-byte unchanged (this ticket's own sections 8/21/22).
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/decisionFactsThreadingDb.test.ts
 */
import { upsertUserByEmail, updateBirthProfile, createGoalWithActivities, addGoalActivity, beginTransaction, logPlannedActivity, getUserById } from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { encodeGoalDemandIntentId } from '../apps/web/lib/goalDemandIntentId';
import { loadEligibleGoalDemand, createRealGoalDemandCandidatesDeps } from '../apps/web/lib/goalDemandCandidates';
import { orchestrateConstructDay, createRealDayConstructorOrchestratorDeps, type RequestedDayIntent, type ConstructDayRequest } from '../apps/web/lib/dayConstructorOrchestrator';
import { constructDay } from '../apps/web/lib/dayConstructor';
import { buildDayIntent, type DayIntent } from '../apps/web/lib/dayIntent';
import { handleDayConstructorPreviewRequest } from '../apps/web/lib/dayConstructorPreviewRequest';
import { parsePreviewResponseBody } from '../apps/web/lib/dayConstructorPreviewClient';
import { buildAcceptRequestBody } from '../apps/web/lib/acceptConstructedDay';
import { POST as acceptRoute } from '../apps/web/app/api/day-constructor/accept/route';

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

function iso(s: string): Date {
  return new Date(s);
}

async function main() {
  const user = await upsertUserByEmail({ email: 'test-decision-facts-v1@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await updateBirthProfile(user.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  const token = createSessionToken(user.id, user.email);

  const cleanup = async () => {
    await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [user.id]);
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [user.id]);
    await sql(`DELETE FROM "GoalActivity" WHERE "userId" = $1`, [user.id]);
    await sql(`DELETE FROM "Goal" WHERE "userId" = $1`, [user.id]);
  };
  await cleanup();

  const requestedGoalIntent = (id: string, title: string, originalOrder: number): RequestedDayIntent => ({ id, title, flexibility: 'FLEXIBLE', durationMinutes: 30, originalOrder });
  const baseRequest = (intents: RequestedDayIntent[], now: Date): ConstructDayRequest => ({
    targetDate: '2026-10-06',
    timezone: TZ,
    constructionWindowSource: 'EXPLICIT_RANGE',
    now,
    explicitStart: iso('2026-10-06T03:30:00Z'), // 09:00 IST
    explicitEnd: iso('2026-10-06T11:30:00Z'), // 17:00 IST
    intents,
  });

  try {
    const liveUser = (await getUserById(user.id))!;
    const deps = createRealDayConstructorOrchestratorDeps(liveUser, iso('2026-10-06T03:00:00Z'));

    const { goal } = await createGoalWithActivities({ userId: user.id, title: 'Get fitter', targetDate: null, activities: [] });
    const ga = await addGoalActivity(user.id, goal.id, { title: 'Morning cardio', activityId: 'workout' });
    await setRhythm(ga!.id, 3);

    console.log('=== REAL RHYTHM FACTS, ZERO COMPLETIONS ===');
    const intentId1 = encodeGoalDemandIntentId('2026-10-06', ga!.id);
    const result1 = await orchestrateConstructDay(baseRequest([requestedGoalIntent(intentId1, 'Morning cardio', 0)], iso('2026-10-06T03:30:00Z')), deps);
    const resolved1 = result1.status === 'READY' ? result1.preview.resolvedIntents.find((r) => r.requestedIntentId === intentId1) : undefined;
    check('decision facts: present at the policy boundary (ConstructDayPreview.resolvedIntents)', !!resolved1?.dayIntent.decisionFacts?.rhythm);
    check('decision facts: targetPerWeek matches the real persisted Rhythm target', resolved1?.dayIntent.decisionFacts?.rhythm?.targetPerWeek === 3);
    check('decision facts: completedThisWeek/committedThisWeek start at 0', resolved1?.dayIntent.decisionFacts?.rhythm?.completedThisWeek === 0 && resolved1?.dayIntent.decisionFacts?.rhythm?.committedThisWeek === 0);
    check('decision facts: remainingOccurrences matches the canonical Rhythm engine', resolved1?.dayIntent.decisionFacts?.rhythm?.remainingOccurrences === 3);

    // Cross-check against the SAME source Candidate A itself uses -- never
    // a second, independently-maintained formula.
    const elig1 = await loadEligibleGoalDemand(createRealGoalDemandCandidatesDeps(), user.id, '2026-10-06', TZ);
    const candidate1 = elig1.status === 'OK' ? elig1.candidates.find((c) => c.goalActivityId === ga!.id) : undefined;
    check('decision facts: identical to Candidate A1 own canonical rhythm fact object', JSON.stringify(resolved1?.dayIntent.decisionFacts?.rhythm) === JSON.stringify(candidate1?.rhythm));

    console.log('=== NO PERSISTENCE BEFORE ACCEPTANCE ===');
    const preAccept = await sql(
      `SELECT (SELECT count(*)::int FROM "PlannedActivity" WHERE "userId" = $1) AS plans, (SELECT count(*)::int FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $2) AS occ, (SELECT count(*)::int FROM "GoalActivityExecution" WHERE "goalActivityId" = $2) AS exec`,
      [user.id, ga!.id]
    );
    check('no persistence: zero PlannedActivity/GoalActivityOccurrence/GoalActivityExecution rows exist from orchestration alone', preAccept[0].plans === 0 && preAccept[0].occ === 0 && preAccept[0].exec === 0);

    console.log('=== GOAL VS NON-GOAL SOURCE NEUTRALITY (no ordering change) ===');
    // Two equivalent FLEXIBLE intents, identical importance/deadline/duration,
    // competing for the SAME single feasible slot derived from the window
    // above (only one 30-minute slot is actually exercised by giving both
    // intents the IDENTICAL fixed candidate via a narrow window -- the
    // existing `originalOrder` tiebreak is what must still decide the
    // winner, exactly as before this ticket).
    const narrowRequest: ConstructDayRequest = {
      targetDate: '2026-10-06',
      timezone: TZ,
      constructionWindowSource: 'EXPLICIT_RANGE',
      now: iso('2026-10-06T03:30:00Z'),
      explicitStart: iso('2026-10-06T03:30:00Z'),
      explicitEnd: iso('2026-10-06T04:00:00Z'), // exactly 30 minutes -- only one of the two can fit
      intents: [requestedGoalIntent(intentId1, 'Morning cardio', 0), requestedGoalIntent('non-goal-1', 'Write report', 1)],
    };
    const resultNeutral = await orchestrateConstructDay(narrowRequest, deps);
    check('neutrality setup: orchestration reaches READY', resultNeutral.status === 'READY');
    const goalIntentResolved = resultNeutral.status === 'READY' ? resultNeutral.preview.resolvedIntents.find((r) => r.requestedIntentId === intentId1) : undefined;
    const nonGoalIntentResolved = resultNeutral.status === 'READY' ? resultNeutral.preview.resolvedIntents.find((r) => r.requestedIntentId === 'non-goal-1') : undefined;
    check('neutrality: the Goal-derived intent carries decisionFacts', !!goalIntentResolved?.dayIntent.decisionFacts?.rhythm);
    check('neutrality: the non-Goal intent carries no decisionFacts', nonGoalIntentResolved?.dayIntent.decisionFacts === undefined);

    // Ordering itself is asserted directly against the PURE `constructDay`
    // (dayConstructor.ts) rather than through real timing search above --
    // real Muhurta/availability candidate generation is deliberately not
    // this property's concern. Two otherwise-identical FLEXIBLE DayIntents
    // (same importance/no deadline/same duration), one carrying
    // `decisionFacts.rhythm`, competing for the exact same single
    // feasible window.
    const rhythmFacts = { targetPerWeek: 3, completedThisWeek: 0, committedThisWeek: 0, remainingOccurrences: 3 };
    const goalIntent: DayIntent = { ...buildDayIntent({ title: 'Morning cardio', targetDate: '2026-10-06', flexibility: 'FLEXIBLE', estimatedDurationMinutes: 30 }, 0), id: 'goal-neutral', decisionFacts: { rhythm: rhythmFacts } };
    const nonGoalIntent: DayIntent = { ...buildDayIntent({ title: 'Write report', targetDate: '2026-10-06', flexibility: 'FLEXIBLE', estimatedDurationMinutes: 30 }, 1), id: 'non-goal-neutral' };
    const pureWindow = { date: '2026-10-06', start: iso('2026-10-06T03:30:00Z'), end: iso('2026-10-06T04:00:00Z'), timezone: TZ, source: 'EXPLICIT_RANGE' as const };
    const candidateFor = (intentId: string) => ({ intentId, start: pureWindow.start, end: pureWindow.end, candidateOrder: 0 });
    const pureResult = constructDay({
      intents: [goalIntent, nonGoalIntent],
      window: pureWindow,
      today: '2026-10-06',
      blockedIntervals: [],
      candidatesByIntentId: { [goalIntent.id]: [candidateFor(goalIntent.id)], [nonGoalIntent.id]: [candidateFor(nonGoalIntent.id)] },
      fixedConstraintsByIntentId: {},
    });
    check(
      'neutrality (pure constructDay): the EARLIER-submitted intent still wins the contested slot regardless of which one carries decisionFacts -- Rhythm facts never change dayConstructor.ts\'s own precedence outcome',
      pureResult.status === 'READY' && pureResult.day.proposedItems.length === 1 && pureResult.day.proposedItems[0].intentId === 'goal-neutral'
    );
    // Swap WHICH SIDE has the earlier originalOrder (not merely array
    // position -- constructDay's own module doc comment is explicit that
    // intents are processed in precedence order, never list order) by
    // rebuilding both with their batchIndex arguments swapped.
    const nonGoalIntentFirst: DayIntent = { ...buildDayIntent({ title: 'Write report', targetDate: '2026-10-06', flexibility: 'FLEXIBLE', estimatedDurationMinutes: 30 }, 0), id: 'non-goal-neutral-2' };
    const goalIntentSecond: DayIntent = { ...buildDayIntent({ title: 'Morning cardio', targetDate: '2026-10-06', flexibility: 'FLEXIBLE', estimatedDurationMinutes: 30 }, 1), id: 'goal-neutral-2', decisionFacts: { rhythm: rhythmFacts } };
    const pureResultReversed = constructDay({
      intents: [nonGoalIntentFirst, goalIntentSecond],
      window: pureWindow,
      today: '2026-10-06',
      blockedIntervals: [],
      candidatesByIntentId: { [nonGoalIntentFirst.id]: [candidateFor(nonGoalIntentFirst.id)], [goalIntentSecond.id]: [candidateFor(goalIntentSecond.id)] },
      fixedConstraintsByIntentId: {},
    });
    check(
      'neutrality (pure constructDay, originalOrder swapped): the now-earlier non-Goal intent wins instead -- outcome follows existing originalOrder precedence, never which side carries decisionFacts',
      pureResultReversed.status === 'READY' && pureResultReversed.day.proposedItems.length === 1 && pureResultReversed.day.proposedItems[0].intentId === 'non-goal-neutral-2'
    );

    console.log('=== WEEKLY EXHAUSTION: DECISION POLICY NEVER RECEIVES AN INELIGIBLE ACTIVITY TO REJECT ===');
    // Drive the Goal activity to exhaustion via the real accept/complete
    // cycle (reusing the established A3.5/B5 pattern), then confirm the
    // orchestrator attaches NO decisionFacts for a (now-stale) client
    // request referencing the same intent id -- eligibility stays
    // upstream (Candidate A), never re-decided by this ticket's own
    // fact-threading step.
    const fakeAcceptReq = (body: unknown): any => ({ cookies: { get: () => ({ value: token }) }, json: async () => body, headers: new Headers() });
    const accept = async (body: unknown) => (await acceptRoute(fakeAcceptReq(body))).json();
    const previewHttp = async (now: Date, targetDate: string, intents: unknown[]) => {
      const r = await handleDayConstructorPreviewRequest({ getSession: () => ({ userId: user.id }), getUser: (id) => getUserById(id), getBody: async () => ({ targetDate, intents }), now: () => now, createOrchestratorDeps: createRealDayConstructorOrchestratorDeps });
      const parsed = parsePreviewResponseBody(JSON.parse(JSON.stringify(r.body)), r.httpStatus);
      return parsed.status === 'READY' ? parsed.preview : null;
    };
    for (const [targetDate, nowStr] of [['2026-10-06', '2026-10-06T03:30:00Z'], ['2026-10-07', '2026-10-06T20:00:00Z'], ['2026-10-08', '2026-10-08T03:30:00Z']] as const) {
      const iid = encodeGoalDemandIntentId(targetDate, ga!.id);
      const pv = await previewHttp(iso(nowStr), targetDate, [{ id: iid, title: 'Morning cardio', flexibility: 'FLEXIBLE', activityId: 'workout' }]);
      const accepted = await accept(JSON.parse(JSON.stringify(buildAcceptRequestBody(pv!, `df-${Date.now()}-${targetDate}`))));
      check(`exhaustion cycle (${targetDate}): accepted`, accepted.status === 'SAVED');
      await logPlannedActivity(user.id, accepted.plans[0].id);
    }
    const eligAfterExhaustion = await loadEligibleGoalDemand(createRealGoalDemandCandidatesDeps(), user.id, '2026-10-06', TZ);
    check('exhaustion: Candidate A no longer reports this activity eligible', eligAfterExhaustion.status === 'OK' && !eligAfterExhaustion.candidates.some((c) => c.goalActivityId === ga!.id));
    const resultExhausted = await orchestrateConstructDay(baseRequest([requestedGoalIntent(intentId1, 'Morning cardio', 0)], iso('2026-10-06T03:30:00Z')), deps);
    const resolvedExhausted = resultExhausted.status === 'READY' ? resultExhausted.preview.resolvedIntents.find((r) => r.requestedIntentId === intentId1) : undefined;
    check('exhaustion: Decision Policy attaches no facts for a now-ineligible GoalActivity (eligibility stays upstream, never re-decided here)', resolvedExhausted?.dayIntent.decisionFacts === undefined);

    console.log('=== WEEK RESET ===');
    const resultNextWeek = await orchestrateConstructDay(
      { targetDate: '2026-10-12', timezone: TZ, constructionWindowSource: 'EXPLICIT_RANGE', now: iso('2026-10-12T03:30:00Z'), explicitStart: iso('2026-10-12T03:30:00Z'), explicitEnd: iso('2026-10-12T11:30:00Z'), intents: [requestedGoalIntent(encodeGoalDemandIntentId('2026-10-12', ga!.id), 'Morning cardio', 0)] },
      deps
    );
    const resolvedNextWeek = resultNextWeek.status === 'READY' ? resultNextWeek.preview.resolvedIntents.find((r) => r.requestedIntentId === encodeGoalDemandIntentId('2026-10-12', ga!.id)) : undefined;
    check('week reset: decisionFacts reset to the full target next week, no debt carried, no recurrence rows pre-generated', resolvedNextWeek?.dayIntent.decisionFacts?.rhythm?.targetPerWeek === 3 && resolvedNextWeek?.dayIntent.decisionFacts?.rhythm?.completedThisWeek === 0 && resolvedNextWeek?.dayIntent.decisionFacts?.rhythm?.remainingOccurrences === 3);

    if (!allPassed) {
      console.error('SOME DECISION FACTS THREADING CHECKS FAILED');
      process.exit(1);
    }
    console.log('ALL DECISION FACTS THREADING CHECKS PASSED');
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
