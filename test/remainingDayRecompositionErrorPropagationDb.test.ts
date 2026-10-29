/**
 * HPG3-A4b -- Remaining-Day Recomposition acceptance must PRESERVE a genuine
 * scheduling-eligibility conflict's typed code, not collapse it into a bare,
 * codeless SAVE_FAILED. `acceptRemainingDayRecomposition` (remainingDayRecompositionAcceptance.ts)
 * calls the exact same `applyMoveWrites` (planMove.ts) that manual Move and
 * Day Constructor acceptance already call -- so it can throw the exact same
 * `MovePlanError` codes (CAPACITY_EXCEEDED / DAILY_CAPACITY_EXCEEDED /
 * DAILY_ATTRIBUTION_UNRESOLVED). Before this ticket, its flat catch block
 * discarded the code; this suite proves, against a REAL database and the
 * REAL shared enforcement (no mocking of applyMoveWrites), that:
 *   1. a Move that violates weekly capacity is rejected,
 *   2/3. the rejection carries the correct typed code to the function's own
 *        return value,
 *   4/5/6. zero partial writes -- the attempted move did not persist, the
 *        original activity's placement is unchanged, no duplicate occurrence
 *        was created,
 *   7. an UNRELATED failure (not a MovePlanError at all) still returns the
 *      original bare, codeless SAVE_FAILED -- this fix is additive only.
 *
 * Uses the same early-day-zone trick as remainingDayRecompositionAcceptanceDb.test.ts
 * (a timezone where local time is currently 1-6 AM) so the remaining-today
 * window has generous margin for two non-overlapping "today" slots, rather
 * than the tight real-wall-clock budget multiOccurrenceRhythmMoveCapacityDb.test.ts's
 * own single Recomposition scenario accepts.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/remainingDayRecompositionErrorPropagationDb.test.ts
 */
import { upsertUserByEmail, updateBirthProfile, createGoalWithActivities, addGoalActivity, deleteGoal, beginTransaction } from '../apps/web/lib/db';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import type { AcceptConstructedDayRequest } from '../apps/web/lib/dayConstructorAcceptance';
import { signRecompositionProposal } from '../apps/web/lib/remainingDayRecompositionIntegrity';
import { acceptRemainingDayRecomposition, realRecompositionAcceptanceDeps, type RecompositionAcceptanceDeps } from '../apps/web/lib/remainingDayRecompositionAcceptance';
import { getDatePartsInTimezone } from '../apps/web/lib/timezone';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const MIN = 60000;
const HOUR = 3600000;
const GOAL_TITLE_PREFIX = 'HPG3-A4b Recomposition error propagation fixture ';

async function sql(text: string, params: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(text, params); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

/** Same trick as remainingDayRecompositionAcceptanceDb.test.ts: pick a real timezone currently in its early-morning hours, so "remaining today" (now -> local midnight) has many hours of margin for multiple non-overlapping slots. */
function earlyDayZone(now: Date): string {
  for (const tz of ['Pacific/Kiritimati', 'Pacific/Auckland', 'Australia/Sydney', 'Asia/Tokyo', 'Asia/Kolkata', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Pacific/Honolulu', 'Etc/GMT+12', 'Pacific/Pago_Pago']) {
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now));
    if (hour >= 1 && hour <= 6) return tz;
  }
  return 'Etc/GMT+12';
}

async function main() {
  const TZ = earlyDayZone(new Date());
  const user = await upsertUserByEmail({ email: 'test-hpg3-a4b-recomp-error-propagation@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
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

  function window(date: string, start: string, end: string) { return { date, start: new Date(start), end: new Date(end), timezone: TZ, source: 'EXPLICIT_RANGE' as const }; }
  function item(intentId: string, start: Date, end: Date) { return { intentId, title: 'Strength training', placementSource: 'SELECTED_CANDIDATE' as const, start, end }; }
  function dateOf(ms: number): string { return new Date(ms).toISOString().slice(0, 10); }
  async function accept(ga: { id: string }, startMs: number, intentId: string, durationMin = 20) {
    const start = new Date(startMs);
    const end = new Date(startMs + durationMin * MIN);
    const req: AcceptConstructedDayRequest = {
      clientRequestId: `a4b-${intentId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      constructionWindow: window(dateOf(startMs), new Date(startMs - HOUR).toISOString(), new Date(startMs + 23 * HOUR).toISOString()),
      proposedItems: [item(intentId, start, end)],
    };
    return persistAcceptedConstructedDay(user.id, req, new Date(startMs - 1800000), new Map([[intentId, ga.id]]));
  }
  const occurrencesFor = (goalActivityId: string) => sql(`SELECT id, "plannedActivityId" FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1 ORDER BY "createdAt"`, [goalActivityId]);
  const planRow = async (planId: string): Promise<any> => (await sql(`SELECT * FROM "PlannedActivity" WHERE id = $1`, [planId]))[0];
  const totalPlans = async () => (await sql(`SELECT count(*)::int n FROM "PlannedActivity" WHERE "userId" = $1`, [user.id]))[0].n;

  try {
    // ============================================================
    // Setup: a GoalActivity whose weekly target (1) is already fully
    // committed THIS week by occurrence #1 (today, early in the
    // generous remaining-day margin). Occurrence #2 is created in a
    // DISTANT, unrelated week (30 days out) -- acceptRemainingDayRecomposition
    // never requires a MOVE's SOURCE slot to be "today", only its
    // DESTINATION (verified by reading the function's own validation
    // order) -- so #2 can legitimately exist far away and still be a
    // valid Recomposition MOVE candidate into today.
    // ============================================================
    const { goal } = await createGoalWithActivities({ userId: user.id, title: `${GOAL_TITLE_PREFIX}RR`, targetDate: null, activities: [] });
    createdGoalIds.push(goal.id);
    const gaRR = (await addGoalActivity(user.id, goal.id, { title: 'Strength training', activityId: null, rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 1 } }))!;

    const now = new Date();
    const today = getDatePartsInTimezone(TZ, now).dateStr;
    const base = Math.ceil((now.getTime() + 2 * HOUR) / MIN) * MIN; // comfortably future, comfortably inside today given the early-day-zone margin
    const fillSlot = base; // occurrence #1: fills this week's only slot
    const destSlot = base + 4 * HOUR; // today, well clear of fillSlot -- the MOVE's destination
    const sourceSlot = base + 30 * 24 * HOUR; // occurrence #2's actual current slot: a distant, unrelated week

    const dFill = await accept(gaRR, fillSlot, 'intent-rr-fill');
    check('setup: occurrence #1 created today, filling the week to its own target (1 of 1)', dFill.status === 'SAVED');
    const dMove = await accept(gaRR, sourceSlot, 'intent-rr-move');
    check('setup: occurrence #2 created in a distant, unrelated week (unaffected by this week already being full)', dMove.status === 'SAVED');
    const planMove = (dMove as any).plans[0];

    const plansBefore = await totalPlans();
    const occsBefore = await occurrencesFor(gaRR.id);
    check('setup: exactly 2 occurrence rows exist before the rejected Move is attempted', occsBefore.length === 2);

    // ============================================================
    // 1/2/3. Attempt a Recomposition MOVE of occurrence #2 into TODAY
    // (already at capacity from occurrence #1) -> rejected, correct code.
    // ============================================================
    const decision = {
      decision: 'MOVE' as const,
      planId: planMove.id,
      title: planMove.title,
      current: { start: new Date(planMove.plannedStartAt), end: new Date(planMove.plannedEndAt) },
      to: { start: new Date(destSlot), end: new Date(destSlot + 20 * MIN) },
    };
    const rejectToken = signRecompositionProposal(user.id, { generatedAt: now, targetDate: today, timezone: TZ, summary: { state: 'CHANGES_PROPOSED' }, decisions: [decision] } as any)!;
    const rejected = await acceptRemainingDayRecomposition(user.id, rejectToken, realRecompositionAcceptanceDeps);
    check('1. a Move that violates the destination week\'s existing capacity is REJECTED (SAVE_FAILED)', rejected.status === 'SAVE_FAILED');
    check('2/3. the rejection carries the CORRECT typed conflict code through to the function\'s own return value (not just "it failed")', rejected.status === 'SAVE_FAILED' && (rejected as any).code === 'CAPACITY_EXCEEDED');

    // ============================================================
    // 4/5/6. Zero partial writes: nothing persisted, original
    // placement unchanged, no duplicate occurrence.
    // ============================================================
    check('4. ZERO partial writes: total PlannedActivity count is unchanged', (await totalPlans()) === plansBefore);
    const planAfter = await planRow(planMove.id);
    check('5. the ORIGINAL activity placement is unchanged: still UPCOMING, still at its original (distant-week) slot', planAfter.status === 'UPCOMING' && new Date(planAfter.plannedStartAt).getTime() === sourceSlot && new Date(planAfter.plannedEndAt).getTime() === sourceSlot + 20 * MIN);
    check('6. NO duplicate GoalActivityOccurrence was created: still exactly 2 rows, both still pointing at their original plans', JSON.stringify(await occurrencesFor(gaRR.id)) === JSON.stringify(occsBefore));

    // ============================================================
    // 7. An UNRELATED failure (not a MovePlanError at all -- the
    // acceptance clock itself cannot be read) keeps the ORIGINAL bare,
    // codeless SAVE_FAILED fallback: this fix is additive only, it
    // never converts an unrelated error into a fabricated eligibility
    // conflict. Same decision/token shape as above (plan #2 is still
    // untouched, confirmed above) -- just a fresh token, and a deps
    // override whose readClock throws before any MovePlanError could
    // ever be reached.
    // ============================================================
    const unrelatedToken = signRecompositionProposal(user.id, { generatedAt: new Date(), targetDate: today, timezone: TZ, summary: { state: 'CHANGES_PROPOSED' }, decisions: [decision] } as any)!;
    const failingDeps: RecompositionAcceptanceDeps = { ...realRecompositionAcceptanceDeps, readClock: async () => { throw new Error('clock unavailable'); } };
    const unrelated = await acceptRemainingDayRecomposition(user.id, unrelatedToken, failingDeps);
    check('7. an UNRELATED failure (the acceptance clock cannot be read -- not a MovePlanError) retains the ORIGINAL bare, codeless SAVE_FAILED fallback', unrelated.status === 'SAVE_FAILED' && (unrelated as any).code === undefined);
  } finally {
    await cleanup();
  }

  if (!allPassed) { console.error('SOME RECOMPOSITION ERROR PROPAGATION DB CHECKS FAILED'); process.exit(1); }
  console.log('ALL RECOMPOSITION ERROR PROPAGATION DB CHECKS PASSED');
}

main().catch((e) => { console.error(e); process.exit(1); });
