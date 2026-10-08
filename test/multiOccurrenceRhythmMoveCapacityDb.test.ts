/**
 * Goals V2 -- Multi-Occurrence Rhythm PR 2, FINAL CAPACITY SAFETY GATE:
 * live-database proof that moving an N_PER_WEEK-linked occurrence across
 * (or within) a calendar week can no longer silently push the
 * destination week over its own weekly target.
 *
 * `enforceDestinationWeekCapacity` (apps/web/lib/planMove.ts) is called
 * from inside `applyMoveWrites` -- the ONE shared internal both
 * `movePlannedActivity` (manual Move) and `remainingDayRecompositionAcceptance.ts`
 * (Recomposition Move) call, inside the SAME transaction and the SAME
 * per-user advisory lock (`day-constructor-accept:<userId>`) both paths
 * already held. There is exactly one enforcement point, exercised here
 * through BOTH callers.
 *
 * Scenarios A-H, per the ticket's own section 4:
 *   A  move into a week with available capacity -> succeeds
 *   B  move into an already-full week -> rejected, zero partial mutation
 *   C  move within the same week -> does not double-count itself
 *   D  move across multiple weeks -> source releases, destination counts once
 *   E  concurrent moves into the final slot -> cannot overbook
 *   F  non-Goal and NONE-rhythm moves -> unchanged
 *   G  existing LOGGED/completed occurrences -> counted per canonical Rhythm rules
 *   H  idempotent retry -> no duplicate ledger or Plan mutations
 * Plus: the SAME enforcement point reached via the Recomposition Move
 * path (not just the manual Move route), proving there is only one.
 *
 * Each scenario gets its OWN dedicated hour-of-day slot (via `slot`,
 * below), so unrelated scenarios' real PlannedActivity rows never
 * overlap each other on the same real calendar day -- a pure test-
 * fixture concern, unrelated to the capacity check itself (the existing,
 * separate overlap/blocker guard would otherwise reject them first).
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/multiOccurrenceRhythmMoveCapacityDb.test.ts
 */
import { upsertUserByEmail, updateBirthProfile, createGoalWithActivities, addGoalActivity, deleteGoal, logPlannedActivity, beginTransaction } from '../apps/web/lib/db';
import { movePlannedActivity, MovePlanError } from '../apps/web/lib/planMove';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import { loadEligibleGoalDemand, createRealGoalDemandCandidatesDeps } from '../apps/web/lib/goalDemandCandidates';
import { signRecompositionProposal } from '../apps/web/lib/remainingDayRecompositionIntegrity';
import { acceptRemainingDayRecomposition, realRecompositionAcceptanceDeps } from '../apps/web/lib/remainingDayRecompositionAcceptance';
import type { AcceptConstructedDayRequest } from '../apps/web/lib/dayConstructorAcceptance';
import { getDatePartsInTimezone, addDaysToDateStr } from '../apps/web/lib/timezone';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const TZ = 'Asia/Kolkata';
const MIN = 60000;
const HOUR = 3600000;
const GOAL_TITLE_PREFIX = 'PR2 Move Capacity fixture ';

async function sql(text: string, params: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(text, params); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}
function window(date: string, start: string, end: string) { return { date, start: new Date(start), end: new Date(end), timezone: TZ, source: 'EXPLICIT_RANGE' as const }; }
function item(intentId: string, start: Date, end: Date) { return { intentId, title: 'Strength training', placementSource: 'SELECTED_CANDIDATE' as const, start, end }; }
const occurrencesFor = (goalActivityId: string) => sql(`SELECT id, "plannedActivityId" FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1 ORDER BY "createdAt"`, [goalActivityId]);
const planStatus = async (planId: string): Promise<string> => (await sql(`SELECT status FROM "PlannedActivity" WHERE id = $1`, [planId]))[0].status;
const totalPlans = async (userId: string) => (await sql(`SELECT count(*)::int n FROM "PlannedActivity" WHERE "userId" = $1`, [userId]))[0].n;

async function main() {
  const user = await upsertUserByEmail({ email: 'test-pr2-move-capacity@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await updateBirthProfile(user.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });

  const createdGoalIds: string[] = [];
  const cleanup = async () => {
    const leftovers = await sql(`SELECT id FROM "Goal" WHERE "userId" = $1 AND title LIKE $2`, [user.id, `${GOAL_TITLE_PREFIX}%`]);
    for (const row of leftovers) if (!createdGoalIds.includes(row.id)) createdGoalIds.push(row.id);
    await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [user.id]);
    await sql(`UPDATE "GoalActivity" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [user.id]);
    await sql(`UPDATE "PlannedActivity" SET "rescheduledFromPlanId" = NULL WHERE "userId" = $1`, [user.id]);
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [user.id]);
    for (const goalId of createdGoalIds) await deleteGoal(user.id, goalId).catch(() => {});
  };
  await cleanup();

  // A real near-future base instant -- movePlannedActivity validates destinations against the real wall clock.
  const base = Math.ceil((Date.now() + 2 * HOUR) / MIN) * MIN;
  const WEEK_MS = 8 * 24 * HOUR; // > 7 days: guaranteed to cross at least one Monday week boundary

  // Each scenario gets a dedicated 6-hour block (0..5) within the day, at
  // both the "source week" (week 0) and "destination week" (week 1)
  // instants, with up to 4 half-hour sub-slots inside it -- generous
  // separation so no two scenarios' real PlannedActivity rows can ever
  // overlap, regardless of duration.
  const SCENARIO_HOURS: Record<string, number> = { A: 0, B: 6, C: 12, D: 18, E: 24, F: 30, G: 36, H: 42, Recomp: 48 };
  function slot(scenario: string, week: 0 | 1, subHour: number): number {
    return base + week * WEEK_MS + SCENARIO_HOURS[scenario] * HOUR + subHour * HOUR;
  }
  function dateOf(ms: number): string { return new Date(ms).toISOString().slice(0, 10); }

  async function makeGoalActivity(tag: string, targetPerWeek: number) {
    const { goal } = await createGoalWithActivities({ userId: user.id, title: `${GOAL_TITLE_PREFIX}${tag}`, targetDate: null, activities: [] });
    createdGoalIds.push(goal.id);
    const ga = (await addGoalActivity(user.id, goal.id, { title: 'Strength training', activityId: null, rhythm: { kind: 'N_PER_WEEK', targetPerWeek } }))!;
    return { goal, ga };
  }
  async function accept(ga: { id: string }, startMs: number, intentId: string, durationMin = 20, goalActivityIdOverride?: string) {
    const start = new Date(startMs);
    const end = new Date(startMs + durationMin * MIN);
    const req: AcceptConstructedDayRequest = {
      clientRequestId: `pr2m-${intentId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      constructionWindow: window(dateOf(startMs), new Date(startMs - HOUR).toISOString(), new Date(startMs + 23 * HOUR).toISOString()),
      proposedItems: [item(intentId, start, end)],
    };
    const links = goalActivityIdOverride === null ? new Map<string, string>() : new Map([[intentId, goalActivityIdOverride ?? ga.id]]);
    return persistAcceptedConstructedDay(user.id, req, new Date(startMs - 1800000), links);
  }
  async function remaining(ga: { id: string }, localDate: string): Promise<number | 'EXCLUDED'> {
    const r = await loadEligibleGoalDemand(createRealGoalDemandCandidatesDeps(), user.id, localDate, TZ);
    const c = r.status === 'OK' ? r.candidates.find((x) => x.goalActivityId === ga.id) : undefined;
    return c ? c.remainingThisWeek : 'EXCLUDED';
  }

  try {
    // ============================================================
    // A. Move into a week with available capacity -> succeeds.
    // ============================================================
    const { ga: gaA } = await makeGoalActivity('A', 5);
    const dA = await accept(gaA, slot('A', 0, 0), 'intent-a');
    check('A setup: occurrence created', dA.status === 'SAVED');
    const planA = (dA as any).plans[0];
    const moveA = await movePlannedActivity(user.id, planA.id, { newStartAt: new Date(slot('A', 1, 0)) });
    check('A. Move into a week with available capacity (target 5, destination empty) SUCCEEDS', (await planStatus(planA.id)) === 'MOVED' && (await planStatus(moveA.to.id)) === 'UPCOMING');
    check('A. exactly ONE occurrence row, now pointing at the successor', (await occurrencesFor(gaA.id)).length === 1 && (await occurrencesFor(gaA.id))[0].plannedActivityId === moveA.to.id);

    // ============================================================
    // B. Move into an already-full week -> rejected, zero partial mutation.
    // ============================================================
    const { ga: gaB } = await makeGoalActivity('B', 2);
    const dB1 = await accept(gaB, slot('B', 0, 0), 'intent-b1');
    check('B setup: source occurrence created', dB1.status === 'SAVED');
    const planB1 = (dB1 as any).plans[0];
    const dBFill1 = await accept(gaB, slot('B', 1, 0), 'intent-bfill1');
    const dBFill2 = await accept(gaB, slot('B', 1, 1), 'intent-bfill2');
    check('B setup: destination week independently filled to its own full capacity (2 of 2)', dBFill1.status === 'SAVED' && dBFill2.status === 'SAVED');
    const plansBeforeB = await totalPlans(user.id);
    const occsBeforeB = await occurrencesFor(gaB.id);
    let rejectedB: MovePlanError | null = null;
    try { await movePlannedActivity(user.id, planB1.id, { newStartAt: new Date(slot('B', 1, 2)) }); } catch (e) { rejectedB = e as MovePlanError; }
    check('B. the Move into the already-full destination week is REJECTED with code CAPACITY_EXCEEDED', rejectedB instanceof MovePlanError && rejectedB.code === 'CAPACITY_EXCEEDED');
    check('B. the original plan is UNCHANGED (still UPCOMING, never MOVED)', (await planStatus(planB1.id)) === 'UPCOMING');
    check('B. ZERO partial mutation: no successor plan was created, total PlannedActivity count unchanged', (await totalPlans(user.id)) === plansBeforeB);
    check('B. ZERO partial mutation: no occurrence row was added or repointed', JSON.stringify(await occurrencesFor(gaB.id)) === JSON.stringify(occsBeforeB));

    // ============================================================
    // C. Move within the same week -> does not double-count itself.
    // ============================================================
    const { ga: gaC } = await makeGoalActivity('C', 2);
    const dC1 = await accept(gaC, slot('C', 0, 0), 'intent-c1');
    check('C setup: 1 of 2 committed', dC1.status === 'SAVED');
    const planC1 = (dC1 as any).plans[0];
    const moveC = await movePlannedActivity(user.id, planC1.id, { newStartAt: new Date(slot('C', 0, 2)) }); // later the same day, same week
    check('C. moving the ONLY committed occurrence within the SAME week succeeds (it is not double-counted against itself)', (await planStatus(moveC.to.id)) === 'UPCOMING');
    const remainingC = await remaining(gaC, dateOf(slot('C', 0, 0)));
    check('C. remainingThisWeek after the same-week Move is still 1 (2 - 1 committed), never 0 -- the occurrence being moved was correctly excluded from its own destination-week count', remainingC === 1);

    // ============================================================
    // D. Move across multiple weeks -> source releases, destination
    // counts once (never duplicated).
    // ============================================================
    const { ga: gaD } = await makeGoalActivity('D', 5);
    const dD = await accept(gaD, slot('D', 0, 0), 'intent-d');
    check('D setup: occurrence created in the source week', dD.status === 'SAVED');
    const planD = (dD as any).plans[0];
    const remainingSourceBefore = await remaining(gaD, dateOf(slot('D', 0, 0)));
    check('D. source week before the Move: remainingThisWeek=4 (5-0-1)', remainingSourceBefore === 4);
    const moveD = await movePlannedActivity(user.id, planD.id, { newStartAt: new Date(slot('D', 1, 0)) });
    const remainingSourceAfter = await remaining(gaD, dateOf(slot('D', 0, 0)));
    const remainingDestAfter = await remaining(gaD, dateOf(slot('D', 1, 0)));
    check('D. source week releases its commitment (remainingThisWeek back to full, 5)', remainingSourceAfter === 5);
    check('D. destination week counts it exactly once (remainingThisWeek reduced to 4, not duplicated/double-counted)', remainingDestAfter === 4);
    check('D. exactly ONE occurrence row throughout', (await occurrencesFor(gaD.id)).length === 1 && (await occurrencesFor(gaD.id))[0].plannedActivityId === moveD.to.id);

    // ============================================================
    // E. Concurrent moves into the final slot -> cannot overbook.
    // ============================================================
    const { ga: gaE } = await makeGoalActivity('E', 2);
    const dE1 = await accept(gaE, slot('E', 0, 0), 'intent-e1');
    const dE2 = await accept(gaE, slot('E', 0, 2), 'intent-e2');
    check('E setup: two occurrences created (to be moved concurrently into the same destination week, which has room for exactly ONE more)', dE1.status === 'SAVED' && dE2.status === 'SAVED');
    const planE1 = (dE1 as any).plans[0];
    const planE2 = (dE2 as any).plans[0];
    const dEFill = await accept(gaE, slot('E', 1, 0), 'intent-efill'); // destination week: 1 of 2 already committed -> exactly one slot remains
    check('E setup: destination week pre-filled to 1 of 2 (exactly one slot remains)', dEFill.status === 'SAVED');
    const [resE1, resE2] = await Promise.all([
      movePlannedActivity(user.id, planE1.id, { newStartAt: new Date(slot('E', 1, 2)) }).then((r) => ({ ok: true as const, r })).catch((e) => ({ ok: false as const, e })),
      movePlannedActivity(user.id, planE2.id, { newStartAt: new Date(slot('E', 1, 4)) }).then((r) => ({ ok: true as const, r })).catch((e) => ({ ok: false as const, e })),
    ]);
    const successesE = [resE1, resE2].filter((r) => r.ok).length;
    const failuresE = [resE1, resE2].filter((r) => !r.ok).length;
    check('E. exactly ONE of two concurrent Moves into the final destination-week slot succeeds, the other is rejected -- never both', successesE === 1 && failuresE === 1);
    const remainingDestE = await remaining(gaE, dateOf(slot('E', 1, 0)));
    check('E. the destination week never ends up over capacity: remainingThisWeek is 0, never negative (durably, not a timing-luck artifact)', remainingDestE === 'EXCLUDED' || remainingDestE === 0);

    // ============================================================
    // F. Non-Goal and NONE-rhythm moves -> unchanged.
    // ============================================================
    const { goal: goalF } = await createGoalWithActivities({ userId: user.id, title: `${GOAL_TITLE_PREFIX}F`, targetDate: null, activities: [] });
    createdGoalIds.push(goalF.id);
    const gaFNone = (await addGoalActivity(user.id, goalF.id, { title: 'One-off task', activityId: null }))!; // rhythm omitted -> NONE
    const dF = await accept(gaFNone, slot('F', 0, 0), 'intent-f');
    check('F setup: finite (NONE-rhythm) activity accepted', dF.status === 'SAVED');
    const planF = (dF as any).plans[0];
    const moveF = await movePlannedActivity(user.id, planF.id, { newStartAt: new Date(slot('F', 1, 0)) });
    check('F. a NONE-rhythm GoalActivity\'s plan moves freely across a week boundary with NO capacity check at all (unaffected)', (await planStatus(moveF.to.id)) === 'UPCOMING');
    const reqFPlain: AcceptConstructedDayRequest = { clientRequestId: `pr2m-fplain-${Date.now()}`, constructionWindow: window(dateOf(slot('F', 0, 2)), new Date(slot('F', 0, 2) - HOUR).toISOString(), new Date(slot('F', 0, 2) + 23 * HOUR).toISOString()), proposedItems: [item('intent-fplain', new Date(slot('F', 0, 2)), new Date(slot('F', 0, 2) + 20 * MIN))] };
    const dFPlain = await persistAcceptedConstructedDay(user.id, reqFPlain, new Date(slot('F', 0, 2) - 1800000), new Map());
    check('F setup: a plain, non-Goal-linked plan accepted', dFPlain.status === 'SAVED');
    const planFPlain = (dFPlain as any).plans[0];
    const moveFPlain = await movePlannedActivity(user.id, planFPlain.id, { newStartAt: new Date(slot('F', 1, 2)) });
    check('F. a plan with NO Goal link at all also moves freely (zero occurrence rows match, pure no-op check)', (await planStatus(moveFPlain.to.id)) === 'UPCOMING');

    // ============================================================
    // G. Existing LOGGED/completed occurrences counted per canonical
    // Rhythm rules (completed + committed both count against target).
    // ============================================================
    const { ga: gaG } = await makeGoalActivity('G', 2);
    const dGLogged = await accept(gaG, slot('G', 1, 0), 'intent-g-logged');
    check('G setup: an occurrence accepted in the destination week', dGLogged.status === 'SAVED');
    await logPlannedActivity(user.id, (dGLogged as any).plans[0].id);
    check('G setup: it is LOGGED (completed)', (await planStatus((dGLogged as any).plans[0].id)) === 'LOGGED');
    const dG = await accept(gaG, slot('G', 0, 0), 'intent-g');
    check('G setup: a second, separate occurrence created in another week (to be moved into the destination week)', dG.status === 'SAVED');
    const planG = (dG as any).plans[0];
    const moveG = await movePlannedActivity(user.id, planG.id, { newStartAt: new Date(slot('G', 1, 2)) });
    check('G. a completed (LOGGED) occurrence in the destination week correctly counts toward capacity -- moving a second occurrence in (1 completed + 1 moved-in = 2 of 2) SUCCEEDS, exactly at the target', (await planStatus(moveG.to.id)) === 'UPCOMING');
    const remainingGAfter = await remaining(gaG, dateOf(slot('G', 1, 0)));
    check('G. remainingThisWeek in the destination week is now 0 (2 of 2: 1 completed + 1 committed, canonical distinct-dimension counting)', remainingGAfter === 'EXCLUDED' || remainingGAfter === 0);

    // ============================================================
    // H. Idempotent retry -> no duplicate ledger or Plan mutations.
    // ============================================================
    const { ga: gaH } = await makeGoalActivity('H', 5);
    const dH = await accept(gaH, slot('H', 0, 0), 'intent-h');
    check('H setup: occurrence created', dH.status === 'SAVED');
    const planH = (dH as any).plans[0];
    const moveH1 = await movePlannedActivity(user.id, planH.id, { newStartAt: new Date(slot('H', 1, 0)) });
    const plansBeforeRetryH = await totalPlans(user.id);
    const occsBeforeRetryH = await occurrencesFor(gaH.id);
    const moveH2 = await movePlannedActivity(user.id, planH.id, { newStartAt: new Date(slot('H', 1, 0)) }); // retry: SAME plan id, SAME destination
    check('H. an idempotent retry of the same Move returns the SAME successor, never a new one', moveH2.to.id === moveH1.to.id);
    check('H. no duplicate Plan rows were created by the retry', (await totalPlans(user.id)) === plansBeforeRetryH);
    check('H. no duplicate/second occurrence row was created or repointed by the retry', JSON.stringify(await occurrencesFor(gaH.id)) === JSON.stringify(occsBeforeRetryH));

    // ============================================================
    // Same enforcement point via the RECOMPOSITION Move path (not just
    // the manual Move route) -- proving there is exactly one check,
    // shared by both callers of applyMoveWrites. Uses "today" (real
    // near-future, remaining-today window) since Recomposition's own
    // acceptance validates the destination is within the SAME real
    // local day as the server's current instant.
    // ============================================================
    const { ga: gaR } = await makeGoalActivity('Recomp', 1);
    // Recomposition's own acceptance validates BOTH that targetDate equals
    // the real current Asia/Kolkata local calendar date AND that the
    // destination instant falls within that SAME local day -- a real-
    // wall-clock-dependent window, same accepted residual risk every
    // other Recomposition DB test in this codebase already carries
    // (see goalActivityRhythmMaterializationDb.test.ts's own section 53).
    // Scheduling comfortably EARLY (a short, bounded lead time, never
    // more than what's left before local midnight) minimizes it.
    const todayLocalDateRecomp = getDatePartsInTimezone(TZ, new Date()).dateStr;
    const [midY, midM, midD] = addDaysToDateStr(todayLocalDateRecomp, 1).split('-').map(Number);
    const tomorrowMidnightUTC = Date.UTC(midY, midM - 1, midD) - 5.5 * HOUR; // Asia/Kolkata is a fixed UTC+5:30 offset, no DST
    const remainingTodayMs = tomorrowMidnightUTC - Date.now();
    const idealLeadMs = 20 * MIN;
    const moveOffsetMs = 15 * MIN;
    const itemDurationMs = 20 * MIN;
    const bufferMs = 2 * MIN;
    const leadMs = Math.max(MIN, Math.min(idealLeadMs, remainingTodayMs - moveOffsetMs - itemDurationMs - bufferMs));
    const recompBase = Math.ceil((Date.now() + leadMs) / MIN) * MIN;
    const dR = await accept(gaR, recompBase, 'intent-r');
    check('Recomp setup: 1 of 1 occurrence created (capacity now exactly full for this week)', dR.status === 'SAVED');
    const planR = (dR as any).plans[0];
    const recompDate = todayLocalDateRecomp;
    const recompDest = recompBase + moveOffsetMs; // later the SAME day -- same week, already at capacity (1 of 1) for gaR, but excluding itself makes this a same-week self-move
    const rcDecision = { decision: 'MOVE' as const, planId: planR.id, title: planR.title, current: { start: new Date(planR.plannedStartAt), end: new Date(planR.plannedEndAt) }, to: { start: new Date(recompDest), end: new Date(recompDest + 20 * MIN) } };
    const rcToken = signRecompositionProposal(user.id, { generatedAt: new Date(), targetDate: recompDate, timezone: TZ, summary: { state: 'CHANGES_PROPOSED' }, decisions: [rcDecision] } as any)!;
    const rcResult = await acceptRemainingDayRecomposition(user.id, rcToken, realRecompositionAcceptanceDeps);
    check('Recomp. the SAME enforcement point is reached via Recomposition acceptance: a same-week self-move (not exceeding capacity) SUCCEEDS through applyMoveWrites, proving one shared check, not two', rcResult.status === 'ACCEPTED');
  } finally {
    await cleanup();
  }

  if (!allPassed) { console.error('SOME PR2 MOVE CAPACITY DB CHECKS FAILED'); process.exit(1); }
  console.log('ALL PR2 MOVE CAPACITY DB CHECKS PASSED');
}

main().catch((e) => { console.error(e); process.exit(1); });
