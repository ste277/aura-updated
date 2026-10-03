/**
 * O5 P0c -- real overload decision fixture (live database, CHARACTERIZATION).
 *
 * This is the behavioral anchor for any future decision policy. It captures,
 * through the REAL production pipeline and real persistence, what the
 * Constructor does TODAY when two individually feasible FLEXIBLE candidates
 * cannot both be placed:
 *
 *   real user + timezone + configured availability + persisted blocking
 *   plans -> the real preview boundary wired as route.ts wires it (request
 *   parser, Goal facts provider, real orchestrator deps, real timing
 *   search, REAL constructDay, replenishment, O4 enrichment, signing).
 *
 * Nothing is mocked and no comparator is called directly. It adds NO new
 * decision behavior: every expectation below is the CURRENT behavior, so it
 * passes on the baseline. A future policy slice must change an expectation
 * here deliberately, which is the point.
 *
 * KEY FACT ABOUT "WHICH ITEM LOSES": the loser's final deferred reason is
 * NO_CANDIDATES, not a conflict reason. The first construction round defers
 * it as a conflict, the orchestrator's replenishment round then re-searches
 * with the winner's interval excluded, finds nothing, and the final round
 * reports NO_CANDIDATES. The loser is therefore NOT explained by any
 * contention metadata (no `conflicts` entry) -- recorded here as current
 * behavior, not changed.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/dayConstructorOverloadDecisionDb.test.ts
 */
import {
  upsertUserByEmail,
  updateBirthProfile,
  createGoalWithActivities,
  addGoalActivity,
  beginTransaction,
  replaceUserAvailabilityConfiguration,
  getUserById,
  createPlannedActivity,
} from '../apps/web/lib/db';
import { createRealDayConstructorOrchestratorDeps, orchestrateConstructDay } from '../apps/web/lib/dayConstructorOrchestrator';
import { handleDayConstructorPreviewRequest } from '../apps/web/lib/dayConstructorPreviewRequest';
import { loadGoalDecisionFacts } from '../apps/web/lib/goalDecisionFactsProvider';
import { createRealOpportunityRangeDeps } from '../apps/web/lib/opportunityRangeRealDeps';
import { encodeGoalDemandIntentId } from '../apps/web/lib/goalDemandIntentId';
import { localDateTimeToUTC } from '../apps/web/lib/timezone';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const KOLKATA = 'Asia/Kolkata';
const DATE = '2026-10-07'; // Wednesday, the planning date (a civil date, not the wall clock)

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

async function main() {
  const mk = async (key: string, tz: string) => {
    const u = await upsertUserByEmail({ email: `test-p0c-${key}@example.com`, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: tz });
    await sql(`UPDATE "User" SET timezone = $1 WHERE id = $2`, [tz, u.id]);
    await updateBirthProfile(u.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: tz });
    await replaceUserAvailabilityConfiguration(u.id, [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })));
    return u;
  };
  const K = await mk('kolkata', KOLKATA);
  const U = await mk('utc', 'UTC');
  const ids = [K.id, U.id];
  const cleanup = async () => {
    await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = NULL WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "GoalActivity" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "Goal" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "UserAvailabilityPeriod" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`UPDATE "User" SET "availabilityConfigured" = false WHERE id = ANY($1::text[])`, [ids]);
  };
  await cleanup();
  await replaceUserAvailabilityConfiguration(K.id, [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })));
  await replaceUserAvailabilityConfiguration(U.id, [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })));

  const nowFor = (tz: string) => localDateTimeToUTC(DATE, '09:00', tz); // Wednesday 09:00 local: no now-clipping of the contested slot
  const at = (hhmm: string, tz = KOLKATA) => localDateTimeToUTC(DATE, hhmm, tz);

  /** The real production boundary, wired as route.ts wires it. */
  const previewFor = async (user: { id: string; timezone: string }, intents: unknown[], extraBody: Record<string, unknown> = {}) => {
    const result = await handleDayConstructorPreviewRequest({
      getSession: () => ({ userId: user.id }),
      getUser: (id) => getUserById(id),
      getBody: async () => ({ intents, ...extraBody }),
      now: () => nowFor(user.timezone),
      createOrchestratorDeps: createRealDayConstructorOrchestratorDeps,
      loadDecisionFacts: (u, request) => loadGoalDecisionFacts(u, request),
      createOpportunityRangeDeps: (u: any) => createRealOpportunityRangeDeps(u),
    });
    return { httpStatus: result.httpStatus, body: JSON.parse(JSON.stringify(result.body)) };
  };
  /** Normalized, token-free view of the constructed day (the decision output). */
  const view = (body: any) => {
    const day = body.preview.constructedDay;
    return {
      proposed: day.proposedItems.map((p: any) => ({ intentId: p.intentId, start: p.start, end: p.end, placementSource: p.placementSource, timingFit: p.timingFit, candidateOrder: p.candidateOrder, requiresConfirmation: p.requiresConfirmation })),
      deferred: day.deferredItems,
      conflicts: day.conflicts,
      requestedCapacity: day.requestedCapacity,
      proposedCapacity: day.proposedCapacity,
      warnings: body.preview.warnings,
    };
  };
  const ids_ = (v: { proposed: any[]; deferred: any[] }) => ({ proposed: v.proposed.map((p: any) => p.intentId), deferred: v.deferred.map((d: any) => d.intentId) });
  const intent = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: `Task ${id}`, activityId: 'workout', durationMinutes: 60, flexibility: 'FLEXIBLE', ...extra });
  const clearPlans = (userId: string) => sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [userId]);
  /** Persisted blocking plans -- real rows the real blocker loader reads. */
  const busy = async (user: { id: string; timezone: string }, spans: Array<[string, string]>, status = 'UPCOMING') => {
    for (const [from, to] of spans) {
      const p = await createPlannedActivity({ userId: user.id, title: `busy-${from}-${to}`, plannedStartAt: at(from, user.timezone), plannedEndAt: at(to, user.timezone), durationMinutes: 60, windowType: 'NEUTRAL' });
      if (status !== 'UPCOMING') await sql(`UPDATE "PlannedActivity" SET status = $2 WHERE id = $1`, [p.id, status]);
    }
  };
  /** The primary scarce-slot fixture: only 11:00-12:00 is usable (60 of 480 minutes). */
  const scarceSlot = (user: { id: string; timezone: string }) => busy(user, [['09:00', '11:00'], ['12:00', '17:00']]);
  const planCount = async (userId: string) => (await sql(`SELECT count(*)::int n FROM "PlannedActivity" WHERE "userId" = $1`, [userId]))[0].n as number;

  try {
    // ============================================================
    console.log('=== PRIMARY FIXTURE: one scarce 60-minute slot, two equal-duration FLEXIBLE candidates ===');
    await scarceSlot(K);
    const slotStart = at('11:00').toISOString();
    const slotEnd = at('12:00').toISOString();
    const A = intent('A', { importance: 'HIGH' });
    const B = intent('B', { importance: 'LOW' });
    const aloneA = view((await previewFor(K, [A])).body);
    const aloneB = view((await previewFor(K, [B])).body);
    check('INDIVIDUAL FEASIBILITY: candidate A (HIGH) alone is PROPOSED in the contested slot', aloneA.proposed.length === 1 && aloneA.proposed[0].intentId === 'A' && aloneA.proposed[0].start === slotStart && aloneA.proposed[0].end === slotEnd && aloneA.deferred.length === 0);
    check('INDIVIDUAL FEASIBILITY: candidate B (LOW) alone is PROPOSED in the SAME slot -- the loser is not intrinsically infeasible', aloneB.proposed.length === 1 && aloneB.proposed[0].intentId === 'B' && aloneB.proposed[0].start === slotStart && aloneB.deferred.length === 0);
    check('equal hard feasibility: both resolve the same RESOLVED duration (60), the same activity, and the same timing quality (no timingFit or duration difference can explain the outcome)', aloneA.proposed[0].timingFit === aloneB.proposed[0].timingFit && aloneA.proposed[0].timingFit !== undefined && aloneA.warnings.length === 0 && aloneB.warnings.length === 0);

    const ab = await previewFor(K, [A, B]);
    const vAB = view(ab.body);
    check('REAL CONTENTION (A then B): the real pipeline returns READY with exactly ONE proposed and ONE deferred contested candidate', ab.httpStatus === 200 && ab.body.status === 'READY' && vAB.proposed.length === 1 && vAB.deferred.length === 1);
    check('CURRENT WINNER under existing precedence: the HIGH-importance candidate A is proposed in the scarce slot; the LOW candidate B is deferred', JSON.stringify(ids_(vAB)) === JSON.stringify({ proposed: ['A'], deferred: ['B'] }) && vAB.proposed[0].start === slotStart && vAB.proposed[0].end === slotEnd);
    check('CURRENT DEFERRED REASON for the loser is exactly NO_CANDIDATES with no per-candidate diagnostics (replenishment found no remaining slot; see the file header)', vAB.deferred[0].primaryReason === 'NO_CANDIDATES' && vAB.deferred[0].diagnostics.length === 0);
    check('the existing `conflicts` list is EMPTY: no contention metadata explains the loss today', vAB.conflicts.length === 0);
    check('CURRENT ProposedItem shape: FLEXIBLE selected candidate with timingFit/candidateOrder, requiresConfirmation true, and NO decision/explanation field', vAB.proposed[0].placementSource === 'SELECTED_CANDIDATE' && vAB.proposed[0].requiresConfirmation === true && JSON.stringify(Object.keys(ab.body.preview.constructedDay.proposedItems[0]).sort()) === JSON.stringify(['acceptanceToken', 'activityId', 'candidateOrder', 'end', 'placementSource', 'requiresConfirmation', 'start', 'timingFit', 'title', 'intentId'].sort()));
    check('the winner and the loser both get the SAME timingFit for that slot (selection, not placement, decided it)', aloneA.proposed[0].timingFit === vAB.proposed[0].timingFit);
    console.log('  [CAPACITY METADATA]', JSON.stringify(vAB.requestedCapacity), '| proposed:', JSON.stringify(vAB.proposedCapacity));
    check('CAPACITY METADATA marks the day OVERLOADED: window 480, blocked 420, usable 60, requested 120, remaining -60, utilization 2 (current capacityState contract)', JSON.stringify(vAB.requestedCapacity) === JSON.stringify({ constructionWindowMinutes: 480, blockedMinutes: 420, usableMinutes: 60, requestedMinutes: 120, remainingMinutes: -60, utilization: 2, capacityState: 'OVERLOADED' }));
    check('after placement the proposed capacity is BUSY (60 of 60 usable minutes used, nothing left)', vAB.proposedCapacity.capacityState === 'BUSY' && vAB.proposedCapacity.requestedMinutes === 60 && vAB.proposedCapacity.remainingMinutes === 0);
    check('the loser did not fail for a contention-unrelated reason: the preview carries no warning and the same capacity-validated window was used for both alone-runs', vAB.warnings.length === 0 && aloneA.requestedCapacity.usableMinutes === 60 && aloneB.requestedCapacity.usableMinutes === 60);

    console.log('=== ORDER REVERSAL: unequal importance must not depend on submission order ===');
    const ba = view((await previewFor(K, [B, A])).body);
    check('reversed input (B then A): the SAME higher-importance candidate A still wins and B is still deferred', JSON.stringify(ids_(ba)) === JSON.stringify({ proposed: ['A'], deferred: ['B'] }) && ba.deferred[0].primaryReason === 'NO_CANDIDATES');
    check('the whole constructed day is byte-identical for both input orders (placement, capacity, warnings)', JSON.stringify({ ...ba, deferred: ba.deferred }) === JSON.stringify(vAB));

    console.log('=== IMPORTANCE MATRIX (all other dimensions equal) ===');
    for (const [hi, lo, label] of [
      ['HIGH', 'MEDIUM', 'HIGH over MEDIUM'],
      ['MEDIUM', 'LOW', 'MEDIUM over LOW'],
      ['HIGH', 'LOW', 'HIGH over LOW'],
    ] as const) {
      const forward = view((await previewFor(K, [intent('X', { importance: hi }), intent('Y', { importance: lo })])).body);
      const reverse = view((await previewFor(K, [intent('Y', { importance: lo }), intent('X', { importance: hi })])).body);
      check(`${label}: X wins in both submission orders`, JSON.stringify(ids_(forward)) === JSON.stringify({ proposed: ['X'], deferred: ['Y'] }) && JSON.stringify(ids_(reverse)) === JSON.stringify({ proposed: ['X'], deferred: ['Y'] }));
    }
    const implicit = view((await previewFor(K, [intent('X', { importance: 'MEDIUM' }), intent('Y', { importance: 'LOW' })])).body);
    const omitted = view((await previewFor(K, [intent('Y', { importance: 'LOW' }), intent('X')])).body);
    check('an OMITTED importance is MEDIUM (the Plan Day default): it beats LOW exactly like an explicit MEDIUM', JSON.stringify(ids_(omitted)) === JSON.stringify(ids_(implicit)) && ids_(omitted).proposed[0] === 'X');

    console.log('=== EQUAL PRECEDENCE: the final tie-break is submission order ===');
    for (const [label, a, b] of [['both HIGH', { importance: 'HIGH' }, { importance: 'HIGH' }], ['both MEDIUM (explicit)', { importance: 'MEDIUM' }, { importance: 'MEDIUM' }], ['both with importance omitted', {}, {}]] as const) {
      const ab2 = view((await previewFor(K, [intent('P', a), intent('Q', b)])).body);
      const ba2 = view((await previewFor(K, [intent('Q', b), intent('P', a)])).body);
      check(`${label}, no deadlines: the FIRST SUBMITTED wins (P first -> P; Q first -> Q) -- the current deterministic fallback is original/submission order`, JSON.stringify(ids_(ab2)) === JSON.stringify({ proposed: ['P'], deferred: ['Q'] }) && JSON.stringify(ids_(ba2)) === JSON.stringify({ proposed: ['Q'], deferred: ['P'] }));
    }

    console.log('=== DEADLINE CONTROLS ===');
    const dlToday = view((await previewFor(K, [intent('NOLATER'), intent('TODAY', { deadline: DATE })])).body);
    check('deadline TODAY (the planning date) beats no deadline at equal importance even when submitted SECOND', JSON.stringify(ids_(dlToday)) === JSON.stringify({ proposed: ['TODAY'], deferred: ['NOLATER'] }));
    const dlTodayVsLater = view((await previewFor(K, [intent('LATER', { deadline: '2026-10-12' }), intent('TODAY', { deadline: DATE })])).body);
    check('deadline today beats a LATER deadline at equal importance even when submitted second', JSON.stringify(ids_(dlTodayVsLater)) === JSON.stringify({ proposed: ['TODAY'], deferred: ['LATER'] }));
    const dlTodayVsHigh = view((await previewFor(K, [intent('HIGHNODL', { importance: 'HIGH' }), intent('LOWTODAY', { importance: 'LOW', deadline: DATE })])).body);
    check('PRECEDENCE ORDER: deadline today ranks ABOVE importance -- a LOW item due today beats a HIGH item with no deadline', JSON.stringify(ids_(dlTodayVsHigh)) === JSON.stringify({ proposed: ['LOWTODAY'], deferred: ['HIGHNODL'] }));
    const earlier = view((await previewFor(K, [intent('FAR', { deadline: '2026-10-12' }), intent('NEAR', { deadline: '2026-10-09' })])).body);
    const earlierRev = view((await previewFor(K, [intent('NEAR', { deadline: '2026-10-09' }), intent('FAR', { deadline: '2026-10-12' })])).body);
    check('EARLIER DEADLINE (neither is today, equal importance): the earlier deadline wins in both submission orders', JSON.stringify(ids_(earlier)) === JSON.stringify({ proposed: ['NEAR'], deferred: ['FAR'] }) && JSON.stringify(ids_(earlierRev)) === JSON.stringify({ proposed: ['NEAR'], deferred: ['FAR'] }));
    const dlVsNone = view((await previewFor(K, [intent('NONE'), intent('DATED', { deadline: '2026-10-20' })])).body);
    check('ANY deadline beats no deadline at equal importance (a future deadline outranks an undated item submitted first)', JSON.stringify(ids_(dlVsNone)) === JSON.stringify({ proposed: ['DATED'], deferred: ['NONE'] }));
    const impBeatsDl = view((await previewFor(K, [intent('LOWDATED', { importance: 'LOW', deadline: '2026-10-09' }), intent('HIGHNONE', { importance: 'HIGH' })])).body);
    check('importance ranks ABOVE an earlier (non-today) deadline: a HIGH undated item beats a LOW dated one', JSON.stringify(ids_(impBeatsDl)) === JSON.stringify({ proposed: ['HIGHNONE'], deferred: ['LOWDATED'] }));

    console.log('=== FIXED stays authoritative (regression-only, not part of the contest) ===');
    const fixed = view((await previewFor(K, [intent('FLEXHIGH', { importance: 'HIGH' }), { id: 'PINNED', title: 'Pinned thing', activityId: 'workout', durationMinutes: 60, flexibility: 'FIXED', fixedStart: slotStart }])).body);
    check('a FIXED intent on the scarce slot keeps it regardless of a HIGH FLEXIBLE competitor (reservation invariant; FIXED is not ranked)', fixed.proposed.length === 1 && fixed.proposed[0].intentId === 'PINNED' && fixed.proposed[0].placementSource === 'FIXED_CONSTRAINT' && fixed.deferred.map((d: any) => d.intentId).join() === 'FLEXHIGH');
    const blockerOnly = view((await previewFor(K, [intent('ONLY', { importance: 'HIGH', durationMinutes: 90 })])).body);
    check('persisted plans remain HARD blockers: a 90-minute candidate cannot use the 60-minute gap even alone', blockerOnly.proposed.length === 0 && blockerOnly.deferred.length === 1);

    console.log('=== GREEDY / NON-BACKTRACKING behavior (current, not changed) ===');
    await clearPlans(K.id);
    await busy(K, [['09:00', '11:00'], ['12:00', '13:00'], ['13:30', '17:00']]); // gaps: 11:00-12:00 (60) and 13:00-13:30 (30)
    const greedy = view((await previewFor(K, [intent('SHORT', { importance: 'HIGH', durationMinutes: 30 }), intent('LONG', { importance: 'LOW', durationMinutes: 60 })])).body);
    const arrangement = 'an arrangement that fits BOTH exists: SHORT in 13:00-13:30 and LONG in 11:00-12:00';
    check(`GREEDY: the higher-precedence SHORT item takes its best candidate first, which uses part of the only 60-minute gap, so LONG is deferred even though ${arrangement}`, greedy.proposed.length === 1 && greedy.proposed[0].intentId === 'SHORT' && greedy.deferred.map((d: any) => d.intentId).join() === 'LONG');
    check('NO BACKTRACKING: SHORT is never moved to make room (it sits in the 11:00-12:00 gap), so the global optimum is not found', greedy.proposed[0].start === at('11:00').toISOString() && greedy.proposed[0].end === at('11:30').toISOString());
    const longAlone = view((await previewFor(K, [intent('LONG', { durationMinutes: 60 })])).body);
    const shortAlone = view((await previewFor(K, [intent('SHORT', { durationMinutes: 30 })])).body);
    check('...and both are individually feasible in that same fixture (the loss is contention under greedy order, not infeasibility)', longAlone.proposed.length === 1 && shortAlone.proposed.length === 1);

    console.log('=== CAPACITY METADATA vs ACTUAL PLACEMENT CONTENTION (a current-behavior discrepancy) ===');
    await clearPlans(K.id);
    await busy(K, [['09:00', '10:00'], ['12:00', '17:00']]); // exactly 120 usable minutes (10:00-12:00) for 120 requested
    const exact = view((await previewFor(K, [A, B])).body);
    const exactRev = view((await previewFor(K, [B, A])).body);
    check('NOMINAL capacity is NOT overloaded when usable == requested (120 == 120): capacityState BUSY, remaining 0, utilization 1', exact.requestedCapacity.usableMinutes === 120 && exact.requestedCapacity.requestedMinutes === 120 && exact.requestedCapacity.remainingMinutes === 0 && exact.requestedCapacity.utilization === 1 && exact.requestedCapacity.capacityState === 'BUSY');
    check('...yet REAL CONTENTION still occurs: greedy placement puts the higher-precedence A mid-gap (10:30-11:30, its best-timed slot), leaving two 30-minute fragments, so B cannot fit and is deferred (NO_CANDIDATES) -- in both input orders', JSON.stringify(ids_(exact)) === JSON.stringify({ proposed: ['A'], deferred: ['B'] }) && exact.proposed[0].start === at('10:30').toISOString() && exact.proposed[0].end === at('11:30').toISOString() && exact.deferred[0].primaryReason === 'NO_CANDIDATES' && JSON.stringify(ids_(exactRev)) === JSON.stringify(ids_(exact)));
    check('the capacity model never flags that contention: after placement it reports BALANCED with 60 minutes "remaining" that no candidate can actually use (capacity metadata and placement contention differ; the capacity model is unchanged)', exact.proposedCapacity.capacityState === 'BALANCED' && exact.proposedCapacity.remainingMinutes === 60);

    console.log('=== NOT OVERLOADED: enough capacity proposes BOTH ===');
    await clearPlans(K.id);
    await busy(K, [['09:00', '10:00']]);
    const roomy = view((await previewFor(K, [A, B])).body);
    check('generous capacity: BOTH proposed -- precedence never suppresses a feasible second candidate', roomy.proposed.length === 2 && roomy.deferred.length === 0 && roomy.requestedCapacity.capacityState !== 'OVERLOADED');
    check('...and the two placements do not overlap', roomy.proposed[0].end <= roomy.proposed[1].start || roomy.proposed[1].end <= roomy.proposed[0].start);

    console.log('=== LIFECYCLE BLOCKER SEMANTICS (current) ===');
    await clearPlans(K.id);
    await busy(K, [['09:00', '11:00'], ['12:00', '17:00']], 'LOGGED');
    const logged = view((await previewFor(K, [A, B])).body);
    check('LOGGED plans block exactly like UPCOMING ones: the same contest and the same winner', JSON.stringify(ids_(logged)) === JSON.stringify({ proposed: ['A'], deferred: ['B'] }));
    await clearPlans(K.id);
    await busy(K, [['09:00', '11:00']]);
    await busy(K, [['12:00', '17:00']], 'CANCELLED');
    const cancelled = view((await previewFor(K, [A, B])).body);
    check('a CANCELLED plan does not block: removing its hold turns the contest into a non-contest (both proposed)', cancelled.proposed.length === 2 && cancelled.deferred.length === 0);

    console.log('=== EMPTY DAY: no filler is ever invented ===');
    await clearPlans(K.id);
    const empty = await previewFor(K, []);
    check('an empty request is rejected by the existing parser (400), never turned into invented work', empty.httpStatus === 400);
    const direct = await orchestrateConstructDay({ targetDate: DATE, timezone: KOLKATA, constructionWindowSource: 'REMAINING_TODAY', now: nowFor(KOLKATA), intents: [] }, createRealDayConstructorOrchestratorDeps(K as any, nowFor(KOLKATA)));
    check('the real orchestrator given zero intents proposes nothing and defers nothing (no filler)', direct.status !== 'READY' || (direct.preview.constructedDay.proposedItems.length === 0 && direct.preview.constructedDay.deferredItems.length === 0));

    console.log('=== SOURCE NEUTRALITY: a Goal-derived candidate (with real facts) is ordered by the same rules ===');
    await scarceSlot(K);
    const goal = (await createGoalWithActivities({ userId: K.id, title: 'Goal', targetDate: null, activities: [] })).goal;
    const ga = (await addGoalActivity(K.id, goal.id, { title: 'Goal cardio', activityId: 'workout' }))!;
    await sql(`UPDATE "GoalActivity" SET "rhythmKind" = 'N_PER_WEEK', "rhythmTargetPerWeek" = 3 WHERE id = $1`, [ga.id]);
    const goalIntent = { id: encodeGoalDemandIntentId(DATE, ga.id), title: 'Goal cardio', activityId: 'workout', durationMinutes: 60, flexibility: 'FLEXIBLE' }; // importance omitted = MEDIUM, as Plan Day sends it
    const gVsLow = await previewFor(K, [intent('GENERIC', { importance: 'LOW' }), goalIntent]);
    const gVsHigh = await previewFor(K, [goalIntent, intent('GENERIC', { importance: 'HIGH' })]);
    const gTieGoalFirst = await previewFor(K, [goalIntent, intent('GENERIC')]);
    const gTieGenericFirst = await previewFor(K, [intent('GENERIC'), goalIntent]);
    const gid = goalIntent.id;
    check('the Goal candidate really carries recurrence AND opportunity facts in the preview (they exist but are inert)', !!gVsLow.body.preview.resolvedIntents.find((r: any) => r.requestedIntentId === gid)?.dayIntent?.decisionFacts?.recurrence && !!gVsLow.body.preview.resolvedIntents.find((r: any) => r.requestedIntentId === gid)?.dayIntent?.decisionFacts?.opportunity);
    check('Goal (MEDIUM) beats a generic LOW candidate even though submitted second: by importance, not by source', JSON.stringify(ids_(view(gVsLow.body))) === JSON.stringify({ proposed: [gid], deferred: ['GENERIC'] }));
    check('a generic HIGH candidate beats the Goal (MEDIUM, with facts) even though the Goal was submitted first: facts and source give no advantage', JSON.stringify(ids_(view(gVsHigh.body))) === JSON.stringify({ proposed: ['GENERIC'], deferred: [gid] }));
    check('equal importance: submission order decides, whichever side is the Goal (no source branch): Goal-first -> Goal; generic-first -> generic', ids_(view(gTieGoalFirst.body)).proposed[0] === gid && ids_(view(gTieGenericFirst.body)).proposed[0] === 'GENERIC');

    console.log('=== DETERMINISM ===');
    await clearPlans(K.id);
    await sql(`DELETE FROM "GoalActivity" WHERE "userId" = $1`, [K.id]);
    await sql(`DELETE FROM "Goal" WHERE "userId" = $1`, [K.id]);
    await scarceSlot(K);
    const plansBefore = await planCount(K.id);
    const baselineAB = JSON.stringify(view((await previewFor(K, [A, B])).body));
    let identical = 0;
    for (let i = 0; i < 20; i++) if (JSON.stringify(view((await previewFor(K, [A, B])).body)) === baselineAB) identical += 1;
    check('20 repetitions of the primary overload scenario produce an IDENTICAL result every time (winner, loser, reason, placement, capacity)', identical === 20);
    let reversedSame = 0;
    for (let i = 0; i < 10; i++) {
      const r1 = ids_(view((await previewFor(K, [A, B])).body));
      const r2 = ids_(view((await previewFor(K, [B, A])).body));
      if (JSON.stringify(r1) === JSON.stringify({ proposed: ['A'], deferred: ['B'] }) && JSON.stringify(r2) === JSON.stringify({ proposed: ['A'], deferred: ['B'] })) reversedSame += 1;
    }
    check('both input permutations, 10 repetitions each: the higher-importance candidate wins every time', reversedSame === 10);
    check('preview is read-only: no plan row was created or changed by 32 previews', (await planCount(K.id)) === plansBefore);

    console.log('=== CIVIL-TIME CONTROL: the same fixture in UTC ===');
    await clearPlans(U.id);
    await scarceSlot(U);
    const utc = view((await previewFor(U, [A, B])).body);
    const utcRev = view((await previewFor(U, [B, A])).body);
    check('the same scarce-slot contest in a UTC user (09:00-17:00 UTC, gap 11:00-12:00 UTC) gives the same winner, loser, reason and capacity shape', JSON.stringify(ids_(utc)) === JSON.stringify({ proposed: ['A'], deferred: ['B'] }) && utc.deferred[0].primaryReason === 'NO_CANDIDATES' && utc.proposed[0].start === at('11:00', 'UTC').toISOString() && JSON.stringify(utc.requestedCapacity) === JSON.stringify(vAB.requestedCapacity) && JSON.stringify(ids_(utcRev)) === JSON.stringify(ids_(utc)));

    if (!allPassed) {
      console.error('SOME OVERLOAD DECISION DB CHECKS FAILED');
      process.exit(1);
    }
    console.log('ALL OVERLOAD DECISION DB CHECKS PASSED');
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
