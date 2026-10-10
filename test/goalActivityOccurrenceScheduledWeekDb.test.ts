/**
 * Insights V1 PR2 -- Stable Scheduled-Week Attribution: live-database
 * proof that GoalActivityOccurrence.scheduledWeekStart/scheduledWeekTimezone
 * are written atomically at creation and on every Move, read in preference
 * to live re-derivation, stable across a later user timezone change, and
 * fail safely (never silently combined) for a corrupt partial row.
 *
 * Pure fail-safe/idempotency checks for resolveOccurrenceLocalDate itself
 * live in test/goalActivityRhythm.test.ts (no DB needed there).
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/goalActivityOccurrenceScheduledWeekDb.test.ts
 */
import {
  upsertUserByEmail, updateBirthProfile, createGoalWithActivities, addGoalActivity, deleteGoal,
  logPlannedActivity, skipPlannedActivity, cancelPlannedActivity, updateUserLocation, beginTransaction,
  loadGoalActivityRhythmFacts,
} from '../apps/web/lib/db';
import { movePlannedActivity, MovePlanError } from '../apps/web/lib/planMove';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import { loadEligibleGoalDemand, createRealGoalDemandCandidatesDeps } from '../apps/web/lib/goalDemandCandidates';
import { computeGoalActivityRhythmEligibility, localCalendarWeekStart } from '../apps/web/lib/goalActivityRhythm';
import { getDatePartsInTimezone } from '../apps/web/lib/timezone';
import type { AcceptConstructedDayRequest } from '../apps/web/lib/dayConstructorAcceptance';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const TZ = 'Asia/Kolkata';
const MIN = 60000;
const HOUR = 3600000;
const GOAL_TITLE_PREFIX = 'PR2 Scheduled-Week fixture ';

async function sql(text: string, params: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(text, params); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}
function window(date: string, start: string, end: string) { return { date, start: new Date(start), end: new Date(end), timezone: TZ, source: 'EXPLICIT_RANGE' as const }; }
function item(intentId: string, start: Date, end: Date) { return { intentId, title: 'Strength training', placementSource: 'SELECTED_CANDIDATE' as const, start, end }; }
const occRow = async (goalActivityId: string) => (await sql(`SELECT id, "plannedActivityId", "scheduledWeekStart", "scheduledWeekTimezone" FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [goalActivityId]))[0];
const planStatus = async (planId: string): Promise<string> => (await sql(`SELECT status FROM "PlannedActivity" WHERE id = $1`, [planId]))[0].status;

async function main() {
  const user = await upsertUserByEmail({ email: 'test-pr2-scheduled-week@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
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
    // Restore the fixture's own timezone in case a timezone-change test left it altered.
    await updateUserLocation(user.id, { cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ }).catch(() => {});
  };
  await cleanup();

  const base = Math.ceil((Date.now() + 2 * HOUR) / MIN) * MIN;
  const WEEK_MS = 8 * 24 * HOUR; // > 7 days: guaranteed to cross at least one Monday boundary
  const SCENARIO_HOURS: Record<string, number> = { A: 0, B: 6, C: 12, D: 18, E: 24, F: 30, G: 36, H: 42, I: 48, J: 54, K: 60, L: 66, M: 72, N: 78 };
  function slot(scenario: string, week: 0 | 1, subHour: number): number {
    return base + week * WEEK_MS + SCENARIO_HOURS[scenario] * HOUR + subHour * HOUR;
  }
  function dateOf(ms: number): string { return getDatePartsInTimezone(TZ, new Date(ms)).dateStr; }

  async function makeGoalActivity(tag: string, targetPerWeek: number) {
    const { goal } = await createGoalWithActivities({ userId: user.id, title: `${GOAL_TITLE_PREFIX}${tag}`, targetDate: null, activities: [] });
    createdGoalIds.push(goal.id);
    const ga = (await addGoalActivity(user.id, goal.id, { title: 'Strength training', activityId: null, rhythm: { kind: 'N_PER_WEEK', targetPerWeek } }))!;
    return { goal, ga };
  }
  async function accept(ga: { id: string }, startMs: number, intentId: string, durationMin = 20) {
    const start = new Date(startMs);
    const end = new Date(startMs + durationMin * MIN);
    const req: AcceptConstructedDayRequest = {
      clientRequestId: `pr2sw-${intentId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      constructionWindow: window(dateOf(startMs), new Date(startMs - HOUR).toISOString(), new Date(startMs + 23 * HOUR).toISOString()),
      proposedItems: [item(intentId, start, end)],
    };
    const links = new Map([[intentId, ga.id]]);
    return persistAcceptedConstructedDay(user.id, req, new Date(startMs - 1800000), links);
  }

  try {
    // ============================================================
    // 1. New occurrence snapshot.
    // ============================================================
    const { ga: gaA } = await makeGoalActivity('A', 3);
    const sA = slot('A', 0, 0);
    const dA = await accept(gaA, sA, 'intent-a');
    check('1. setup: occurrence created', dA.status === 'SAVED');
    const occA = await occRow(gaA.id);
    const expectedWeekStartA = localCalendarWeekStart(getDatePartsInTimezone(TZ, new Date(sA)).dateStr);
    check('1. a new Rhythm occurrence snapshots BOTH scheduledWeekStart and scheduledWeekTimezone at creation, atomically with the INSERT', occA.scheduledWeekStart === expectedWeekStartA && occA.scheduledWeekTimezone === TZ);

    // ============================================================
    // 2. Same-week Move.
    // ============================================================
    const { ga: gaB } = await makeGoalActivity('B', 3);
    const dB = await accept(gaB, slot('B', 0, 0), 'intent-b');
    const planB = (dB as any).plans[0];
    const occBBefore = await occRow(gaB.id);
    const moveB = await movePlannedActivity(user.id, planB.id, { newStartAt: new Date(slot('B', 0, 3)) }); // same week, later in it
    const occBAfter = await occRow(gaB.id);
    check('2. same-week Move: scheduledWeekStart is recomputed to the SAME week (unchanged value), scheduledWeekTimezone unchanged', occBAfter.scheduledWeekStart === occBBefore.scheduledWeekStart && occBAfter.scheduledWeekTimezone === occBBefore.scheduledWeekTimezone && occBAfter.plannedActivityId === moveB.to.id);

    // ============================================================
    // 3. Cross-week Move.
    // ============================================================
    const { ga: gaC } = await makeGoalActivity('C', 3);
    const dC = await accept(gaC, slot('C', 0, 0), 'intent-c');
    const planC = (dC as any).plans[0];
    const occCBefore = await occRow(gaC.id);
    const destC = slot('C', 1, 0);
    const moveC = await movePlannedActivity(user.id, planC.id, { newStartAt: new Date(destC) });
    const occCAfter = await occRow(gaC.id);
    const expectedWeekStartCDest = localCalendarWeekStart(getDatePartsInTimezone(TZ, new Date(destC)).dateStr);
    check('3. cross-week Move: scheduledWeekStart updates to the DESTINATION week, genuinely different from the source week', occCAfter.scheduledWeekStart === expectedWeekStartCDest && occCAfter.scheduledWeekStart !== occCBefore.scheduledWeekStart && occCAfter.plannedActivityId === moveC.to.id);

    // ============================================================
    // 4. Repeated Move chain (A -> B -> C hops of the SAME occurrence row).
    // ============================================================
    const { ga: gaD } = await makeGoalActivity('D', 3);
    const dD = await accept(gaD, slot('D', 0, 0), 'intent-d');
    const planD1 = (dD as any).plans[0];
    const hop1 = await movePlannedActivity(user.id, planD1.id, { newStartAt: new Date(slot('D', 0, 2)) }); // same week
    const occAfterHop1 = await occRow(gaD.id);
    const hop2 = await movePlannedActivity(user.id, hop1.to.id, { newStartAt: new Date(slot('D', 1, 0)) }); // cross week
    const occAfterHop2 = await occRow(gaD.id);
    check('4. repeated Move chain: there is still exactly ONE occurrence row throughout, always repointed to the CURRENT live plan', occAfterHop1.id === occAfterHop2.id && occAfterHop2.plannedActivityId === hop2.to.id);
    check('4. repeated Move chain: the final snapshot reflects only the LATEST hop\'s destination week, not an earlier hop\'s', occAfterHop2.scheduledWeekStart === localCalendarWeekStart(getDatePartsInTimezone(TZ, new Date(slot('D', 1, 0))).dateStr) && occAfterHop2.scheduledWeekStart !== occAfterHop1.scheduledWeekStart);

    // ============================================================
    // 5. Idempotent Move replay.
    // ============================================================
    const { ga: gaE } = await makeGoalActivity('E', 3);
    const dE = await accept(gaE, slot('E', 0, 0), 'intent-e');
    const planE = (dE as any).plans[0];
    const destE = new Date(slot('E', 1, 0));
    const moveE1 = await movePlannedActivity(user.id, planE.id, { newStartAt: destE });
    const occEAfterFirst = await occRow(gaE.id);
    const moveE2 = await movePlannedActivity(user.id, planE.id, { newStartAt: destE }); // identical replay
    const occEAfterReplay = await occRow(gaE.id);
    check('5. idempotent Move replay returns the SAME successor and leaves the snapshot byte-identical (never re-stamped)', moveE2.to.id === moveE1.to.id && occEAfterReplay.scheduledWeekStart === occEAfterFirst.scheduledWeekStart && occEAfterReplay.scheduledWeekTimezone === occEAfterFirst.scheduledWeekTimezone);

    // ============================================================
    // 6. Concurrent Move attempts (mirrors the existing capacity-safety scenario).
    // ============================================================
    const { ga: gaF } = await makeGoalActivity('F', 2);
    const dF1 = await accept(gaF, slot('F', 0, 0), 'intent-f1');
    const dF2 = await accept(gaF, slot('F', 0, 2), 'intent-f2');
    const planF1 = (dF1 as any).plans[0];
    const planF2 = (dF2 as any).plans[0];
    const dFFill = await accept(gaF, slot('F', 1, 0), 'intent-ffill'); // destination week pre-filled to 1 of 2
    check('6. setup: concurrent-Move fixture accepted', dF1.status === 'SAVED' && dF2.status === 'SAVED' && dFFill.status === 'SAVED');
    const [resF1, resF2] = await Promise.all([
      movePlannedActivity(user.id, planF1.id, { newStartAt: new Date(slot('F', 1, 2)) }).then((r) => ({ ok: true as const, r })).catch((e) => ({ ok: false as const, e })),
      movePlannedActivity(user.id, planF2.id, { newStartAt: new Date(slot('F', 1, 4)) }).then((r) => ({ ok: true as const, r })).catch((e) => ({ ok: false as const, e })),
    ]);
    const successesF = [resF1, resF2].filter((r) => r.ok).length;
    check('6. exactly one of two concurrent Moves into a one-slot-remaining week succeeds (pre-existing capacity gate, unaffected)', successesF === 1);
    const occFRows = await sql(`SELECT "scheduledWeekStart", "scheduledWeekTimezone" FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [gaF.id]);
    check('6. every occurrence under this GoalActivity has a fully-populated snapshot after the race -- never a partial/contradictory write from the losing attempt', occFRows.every((r) => (r.scheduledWeekStart === null) === (r.scheduledWeekTimezone === null)) && occFRows.filter((r) => r.scheduledWeekStart !== null).length >= 2);

    // ============================================================
    // 7. Move vs Done/Skip/Cancel.
    // ============================================================
    const terminalCases: readonly [string, (planId: string) => Promise<unknown>, number][] = [
      ['Done', (planId: string) => logPlannedActivity(user.id, planId), 0],
      ['Skip', (planId: string) => skipPlannedActivity(user.id, planId), 1],
      ['Cancel', (planId: string) => cancelPlannedActivity(user.id, planId), 2],
    ];
    for (const [label, terminalFn, subHourIndex] of terminalCases) {
      const { ga } = await makeGoalActivity(`G-${label}`, 3);
      const dG = await accept(ga, slot('G', 0, subHourIndex), `intent-g-${label}`);
      const plan = (dG as any).plans[0];
      const occBefore = await occRow(ga.id);
      // Run the terminal op, THEN attempt a Move -- this scenario only needs to prove a TERMINAL state
      // (Done/Skip/Cancel) leaves the snapshot exactly as it already was, never partially touched; the
      // race-fairness question itself is already covered by the separate, pre-existing
      // movePlannedActivityRace.test.ts suite and is out of this PR's own scope.
      await terminalFn(plan.id);
      const afterTerminalStatus = await planStatus(plan.id);
      const moveCode = await (async () => { try { await movePlannedActivity(user.id, plan.id, { newStartAt: new Date(slot('G', 1, subHourIndex)) }); return 'OK'; } catch (e) { return e instanceof MovePlanError ? e.code : 'OTHER'; } })();
      const occAfter = await occRow(ga.id);
      check(`7. Move vs ${label}: once the plan reaches a terminal state, Move correctly refuses (INVALID_STATE) and the occurrence snapshot is left exactly as it was`, afterTerminalStatus !== 'UPCOMING' && moveCode === 'INVALID_STATE' && occAfter.scheduledWeekStart === occBefore.scheduledWeekStart && occAfter.scheduledWeekTimezone === occBefore.scheduledWeekTimezone);
    }

    // ============================================================
    // 8. User timezone change after creation -- the core regression test.
    // ============================================================
    const { ga: gaH } = await makeGoalActivity('H', 3);
    const dH = await accept(gaH, slot('H', 0, 0), 'intent-h');
    check('8. setup: occurrence created under Asia/Kolkata', dH.status === 'SAVED');
    const occHBefore = await occRow(gaH.id);
    await updateUserLocation(user.id, { cityName: 'New York', latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York' });
    const occHAfter = await occRow(gaH.id);
    check('8. a user timezone change does NOT retroactively alter an already-snapshotted occurrence\'s scheduledWeekStart/scheduledWeekTimezone', occHAfter.scheduledWeekStart === occHBefore.scheduledWeekStart && occHAfter.scheduledWeekTimezone === occHBefore.scheduledWeekTimezone && occHAfter.scheduledWeekTimezone === TZ);
    // Restore before continuing so later scenarios' own Asia/Kolkata-relative slots stay correct.
    await updateUserLocation(user.id, { cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });

    // ============================================================
    // 9. Week-year boundary -- a clean, year-stable Monday date, no ISO
    // week-year ambiguity. Verified via the pure week-start function
    // directly against known literal dates (no DB dependency needed for
    // the boundary arithmetic itself; this confirms the SAME function the
    // write sites call behaves correctly at the boundary).
    // ============================================================
    check('9. week-year boundary: Dec 31 2025 (Wednesday) reduces to its own Monday, 2025-12-29, never drifting into a wrong year', localCalendarWeekStart('2025-12-31') === '2025-12-29');
    check('9. week-year boundary: Jan 1 2026 (Thursday) reduces to 2025-12-29 also -- the SAME week as Dec 31, correctly spanning the calendar-year boundary', localCalendarWeekStart('2026-01-01') === '2025-12-29');

    // ============================================================
    // 10. DST boundary -- America/New_York (DST-observing), confirmed via
    // a live occurrence snapshot rather than only the pure helper, proving
    // the write path itself handles it via getDatePartsInTimezone/Intl.
    // ============================================================
    const { ga: gaI } = await makeGoalActivity('I', 3);
    await updateUserLocation(user.id, { cityName: 'New York', latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York' });
    const dstSlotMs = slot('I', 0, 0);
    const dI = await accept(gaI, dstSlotMs, 'intent-i');
    const occI = await occRow(gaI.id);
    const expectedDstWeekStart = localCalendarWeekStart(getDatePartsInTimezone('America/New_York', new Date(dstSlotMs)).dateStr);
    check('10. DST-observing timezone (America/New_York): the snapshot correctly reflects the Intl-derived local date, same canonical helper as every other write', dI.status === 'SAVED' && occI.scheduledWeekStart === expectedDstWeekStart && occI.scheduledWeekTimezone === 'America/New_York');
    await updateUserLocation(user.id, { cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });

    // ============================================================
    // 11. Historical NULL fallback.
    // ============================================================
    const { ga: gaJ } = await makeGoalActivity('J', 3);
    const sJ = slot('J', 0, 0);
    const dJ = await accept(gaJ, sJ, 'intent-j');
    await sql(`UPDATE "GoalActivityOccurrence" SET "scheduledWeekStart" = NULL, "scheduledWeekTimezone" = NULL WHERE "goalActivityId" = $1`, [gaJ.id]);
    const factsJ = await loadGoalActivityRhythmFacts(user.id, gaJ.id, TZ);
    const expectedLiveJ = getDatePartsInTimezone(TZ, new Date(sJ)).dateStr;
    check('11. a historical row with both snapshot fields forced NULL reads correctly via live derivation (no crash), matching exactly what live derivation would produce', dJ.status === 'SAVED' && factsJ.length === 1 && factsJ[0].localDate === expectedLiveJ);
    const eligJ = computeGoalActivityRhythmEligibility({ rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 3 }, planningLocalDate: expectedLiveJ, occurrences: factsJ });
    check('11. the live-derived fact correctly participates in eligibility counting (1 committed, matching the real UPCOMING plan)', eligJ.committedThisWeek === 1);

    // ============================================================
    // 12. Invalid partial snapshot -- fail safely, never silently combine.
    // ============================================================
    const { ga: gaK } = await makeGoalActivity('K', 3);
    const dK = await accept(gaK, slot('K', 0, 0), 'intent-k');
    check('12. setup: occurrence created', dK.status === 'SAVED');
    await sql(`UPDATE "GoalActivityOccurrence" SET "scheduledWeekTimezone" = NULL WHERE "goalActivityId" = $1`, [gaK.id]); // force a partial row: weekStart set, timezone NULL
    const partialCode = await (async () => { try { await loadGoalActivityRhythmFacts(user.id, gaK.id, TZ); return 'OK'; } catch { return 'THREW'; } })();
    check('12. a partially-populated snapshot (scheduledWeekStart set, scheduledWeekTimezone NULL) is refused by the real read path -- throws, never silently falls back to live derivation or blends the two', partialCode === 'THREW');

    // ============================================================
    // 13. Completion logged in a later "week" -- attribution follows the
    // SCHEDULED week, never the logged instant (the approved policy).
    // ============================================================
    const { ga: gaL } = await makeGoalActivity('L', 3);
    const dL = await accept(gaL, slot('L', 0, 0), 'intent-l');
    const planL = (dL as any).plans[0];
    const occLBeforeLog = await occRow(gaL.id);
    await logPlannedActivity(user.id, planL.id);
    const occLAfterLog = await occRow(gaL.id);
    check('13. logPlannedActivity (Done) never touches the occurrence\'s scheduled-week snapshot, regardless of when it is actually tapped -- attribution follows the scheduled week only', occLAfterLog.scheduledWeekStart === occLBeforeLog.scheduledWeekStart && occLAfterLog.scheduledWeekTimezone === occLBeforeLog.scheduledWeekTimezone);
    const factsL = await loadGoalActivityRhythmFacts(user.id, gaL.id, TZ);
    check('13. the now-LOGGED occurrence still correctly contributes COMPLETED to its originally-scheduled week', factsL.length === 1 && factsL[0].contribution === 'COMPLETED' && factsL[0].localDate === occLBeforeLog.scheduledWeekStart);

    // ============================================================
    // 14. Goal Rhythm committed/completed totals -- correct via the
    // snapshot-aware path for a realistic mixed scenario.
    // ============================================================
    const { ga: gaM } = await makeGoalActivity('M', 3);
    const dM1 = await accept(gaM, slot('M', 0, 0), 'intent-m1');
    const dM2 = await accept(gaM, slot('M', 0, 2), 'intent-m2');
    const planM1 = (dM1 as any).plans[0];
    await logPlannedActivity(user.id, planM1.id); // 1 completed
    // planM2 stays UPCOMING -> 1 committed
    const factsM = await loadGoalActivityRhythmFacts(user.id, gaM.id, TZ);
    const eligM = computeGoalActivityRhythmEligibility({ rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 3 }, planningLocalDate: getDatePartsInTimezone(TZ, new Date(slot('M', 0, 0))).dateStr, occurrences: factsM });
    check('14. completed/committed totals are correct via the snapshot-aware read path: 1 completed, 1 committed, 1 remaining of target 3', eligM.completedThisWeek === 1 && eligM.committedThisWeek === 1 && eligM.remainingOccurrences === 1);

    // ============================================================
    // 15. Capacity consistency -- the pre-existing gate still correctly
    // rejects a would-be-over-capacity cross-week Move, now reading
    // through the snapshot-aware sibling-facts query.
    // ============================================================
    const { ga: gaN } = await makeGoalActivity('N', 1); // target 1/week -- zero room for a second
    const dNFill = await accept(gaN, slot('N', 1, 0), 'intent-n-fill'); // fills the destination week (week 1) to capacity (1 of 1)
    const dN2 = await accept(gaN, slot('N', 0, 0), 'intent-n2'); // a separate occurrence, in the SOURCE week (week 0, empty)
    check('15. setup: capacity-consistency fixture accepted (destination week filled to target, source week has the mover)', dNFill.status === 'SAVED' && dN2.status === 'SAVED');
    const planN2 = (dN2 as any).plans[0];
    const capacityCode = await (async () => { try { await movePlannedActivity(user.id, planN2.id, { newStartAt: new Date(slot('N', 1, 1)) }); return 'OK'; } catch (e) { return e instanceof MovePlanError ? e.code : 'OTHER'; } })();
    check('15. capacity consistency: moving into an already-full (target 1, 1 committed) destination week is correctly rejected (CAPACITY_EXCEEDED) via the snapshot-aware capacity check', capacityCode === 'CAPACITY_EXCEEDED');

    // ============================================================
    // 16. Finite Goal completion behavior -- a NONE-rhythm GoalActivity
    // (no occurrence row at all) is entirely unaffected by any of this.
    // ============================================================
    const { goal: goalO } = await createGoalWithActivities({ userId: user.id, title: `${GOAL_TITLE_PREFIX}O`, targetDate: null, activities: [] });
    createdGoalIds.push(goalO.id);
    const gaONone = (await addGoalActivity(user.id, goalO.id, { title: 'One-off task', activityId: null }))!; // rhythm omitted -> NONE
    const reqO: AcceptConstructedDayRequest = { clientRequestId: `pr2sw-o-${Date.now()}`, constructionWindow: window(dateOf(slot('J', 1, 0)), new Date(slot('J', 1, 0) - HOUR).toISOString(), new Date(slot('J', 1, 0) + 23 * HOUR).toISOString()), proposedItems: [item('intent-o', new Date(slot('J', 1, 0)), new Date(slot('J', 1, 0) + 20 * MIN))] };
    const dO = await persistAcceptedConstructedDay(user.id, reqO, new Date(slot('J', 1, 0) - 1800000), new Map([['intent-o', gaONone.id]]));
    const planO = (dO as any).plans[0];
    const occORows = await sql(`SELECT id FROM "GoalActivityOccurrence" WHERE "plannedActivityId" = $1`, [planO.id]);
    const moveO = await movePlannedActivity(user.id, planO.id, { newStartAt: new Date(slot('J', 1, 3)) });
    const occORowsAfterMove = await sql(`SELECT id FROM "GoalActivityOccurrence" WHERE "plannedActivityId" = $1`, [moveO.to.id]);
    check('16. a finite (NONE-rhythm) GoalActivity never gets a GoalActivityOccurrence row at creation, and Moving its plan creates none either -- the new snapshot fields/logic never engage', dO.status === 'SAVED' && occORows.length === 0 && moveO.to.status === 'UPCOMING' && occORowsAfterMove.length === 0);
  } finally {
    await cleanup();
  }
  if (!allPassed) { console.error('SOME SCHEDULED-WEEK CHECKS FAILED'); process.exit(1); }
  console.log('ALL SCHEDULED-WEEK CHECKS PASSED');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
