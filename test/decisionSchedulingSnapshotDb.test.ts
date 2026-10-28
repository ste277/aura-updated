/**
 * Constructor Decision Intelligence -- O5 P2d: live-database proof that the decision evidence's database-derived inputs come
 * from ONE coherent REPEATABLE READ snapshot (DB-backed).
 *
 * THE DEFECT, REPRODUCED DETERMINISTICALLY. Before P2d, one preview assembled its evidence from independent reads (the Rhythm
 * recurrence read, then, later and separately, the availability and the persisted plans). A concurrent commit between those
 * reads makes immutable evidence freeze a state that never existed in the database. Here the concurrent commit is a real
 * scheduling write -- an UPCOMING plan covering the whole planning day PLUS the Rhythm occurrence linked to it -- committed by
 * a SEPARATE connection at an exactly chosen point (no sleeps, no races: an awaited hook between two reads):
 *
 *   state S0 (before the commit): 3 occurrences remain, the day is KNOWN_FEASIBLE            -> LAST_KNOWN_OPPORTUNITY
 *   state S1 (after the commit):  2 occurrences remain, the day is KNOWN_INFEASIBLE          -> NONE
 *   LEGACY composition (independent reads): 3 remain AND the day is KNOWN_INFEASIBLE -- a pair that is NEITHER S0 NOR S1
 *   P2d: S0 for every commit point after the snapshot starts, S1 only if the commit lands before it
 *
 * The same hook runs through the REAL snapshot: the runner under test wraps the real `withRepeatableReadSnapshot` (so real
 * PostgreSQL REPEATABLE READ semantics apply) and only runs an awaited commit after the k-th statement returns, for EVERY k.
 *
 * Also proven: the emitted isolation level is REPEATABLE READ (and READ COMMITTED would see the change -- the test
 * discriminates); a later evaluation sees the committed change (no stale cache); both candidates of one evaluation share the
 * one snapshot; the snapshot executor is read-only and dies with the snapshot; the preview body and signed tokens are
 * identical to the legacy composition when nothing is concurrent; the query count is constant in the number of candidates;
 * partial failure yields no context and never falls back to live reads; non-UTC and DST-week fixtures, an overnight blocker,
 * half-open boundaries and lifecycle filters read exactly as before.
 * Requires DATABASE_URL (fresh, 43 migrations).
 */
import { upsertUserByEmail, updateBirthProfile, createGoalWithActivities, addGoalActivity, beginTransaction, replaceUserAvailabilityConfiguration, getUserById, createPlannedActivity, withRepeatableReadSnapshot, type User, type ReadQueryExecutor } from '../apps/web/lib/db';
import { createRealDayConstructorOrchestratorDeps } from '../apps/web/lib/dayConstructorOrchestrator';
import { handleDayConstructorPreviewRequest } from '../apps/web/lib/dayConstructorPreviewRequest';
import { loadGoalDecisionFacts, createGoalDemandDepsFromSchedulingContext } from '../apps/web/lib/goalDecisionFactsProvider';
import { createRealOpportunityRangeDeps } from '../apps/web/lib/opportunityRangeRealDeps';
import { createRealGoalDemandCandidatesDeps, loadEligibleGoalDemand, type GoalDemandCandidatesDeps } from '../apps/web/lib/goalDemandCandidates';
import { createIntentRowFromAutoGoalSuggestion, buildRequestedIntentsForSubmission, type PlanDayIntentRow } from '../apps/web/lib/planDayEntry';
import { encodeGoalDemandIntentId } from '../apps/web/lib/goalDemandIntentId';
import { loadDecisionSchedulingContext, type SnapshotRunner } from '../apps/web/lib/decisionSchedulingContextLoader';
import type { DecisionSchedulingContext } from '../apps/web/lib/decisionSchedulingContext';
import * as preparationModule from '../apps/web/lib/decisionFactPreparation';
import { deriveDecisionPressure, type DecisionPressure } from '../apps/web/lib/decisionPressure';
import type { DecisionEvidence, DecisionEvidenceByIntentId } from '../apps/web/lib/decisionEvidence';
import { localDateTimeToUTC } from '../apps/web/lib/timezone';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const TZ = 'Asia/Kolkata';
const FRIDAY = '2026-10-09';
const EMAIL = 'test-p2d-snapshot@example.com';
const EMAIL_LA = 'test-p2d-snapshot-la@example.com';

async function sql(text: string, params: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(text, params); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

// test-only observation of the evidence stage (module-object wrapper; production has no hook)
const realPrepareEvidence = preparationModule.prepareDecisionEvidence;
let lastEvidence: DecisionEvidenceByIntentId | undefined;
const capturedEvidence = (): DecisionEvidenceByIntentId | undefined => lastEvidence;
(preparationModule as any).prepareDecisionEvidence = (...args: Parameters<typeof realPrepareEvidence>) => { lastEvidence = realPrepareEvidence(...args); return lastEvidence; };

const pressureOf = (e: DecisionEvidence | undefined, date: string): DecisionPressure => deriveDecisionPressure({ evidence: e, planningDate: date, flexibility: 'FLEXIBLE' });
/** The consistency-relevant projection of one candidate's evidence: demand and supply as the evidence states them. */
const view = (e: DecisionEvidence | undefined) => (e ? `remaining=${e.recurrence?.remainingInPeriod};start=${e.opportunity?.startDateState};afterStartViable=${e.opportunity?.afterStartViableDays}` : 'no-evidence');

/** A real snapshot with an awaited hook after the k-th statement returns (k = 0: before the first statement). */
function hookedRunner(afterQuery: number, hook: () => Promise<void>, log: string[] = []): SnapshotRunner {
  return (read) => withRepeatableReadSnapshot(async (executor) => {
    let n = 0; let fired = false;
    const fire = async () => { if (!fired) { fired = true; await hook(); } };
    if (afterQuery === 0) await fire();
    const wrapped: ReadQueryExecutor = { query: async (text, params) => { n += 1; log.push(text.replace(/\s+/g, ' ').slice(0, 220)); const r = await executor.query(text, params); if (n === afterQuery) await fire(); return r; } };
    return read(wrapped);
  });
}

async function main() {
  const mkUser = async (email: string, tz: string) => {
    const u = await upsertUserByEmail({ email, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: tz });
    await updateBirthProfile(u.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: tz });
    return u;
  };
  const u = await mkUser(EMAIL, TZ);
  const ula = await mkUser(EMAIL_LA, 'America/Los_Angeles');
  const cleanupUser = async (id: string) => {
    await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [id]);
    await sql(`DELETE FROM "GoalActivityOccurrence" WHERE "userId" = $1`, [id]);
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [id]);
    await sql(`DELETE FROM "HabitLog" WHERE "userId" = $1`, [id]);
    await sql(`DELETE FROM "UserActivityPreference" WHERE "userId" = $1`, [id]);
    await sql(`DELETE FROM "GoalActivity" WHERE "userId" = $1`, [id]);
    await sql(`DELETE FROM "Goal" WHERE "userId" = $1`, [id]);
    await sql(`DELETE FROM "UserAvailabilityPeriod" WHERE "userId" = $1`, [id]);
    await sql(`UPDATE "User" SET "availabilityConfigured" = false WHERE id = $1`, [id]);
  };
  const cleanup = async () => { await cleanupUser(u.id); await cleanupUser(ula.id); };
  await cleanup();
  try {
    const rhythm = { kind: 'N_PER_WEEK' as const, targetPerWeek: 3 };
    const weekdays = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' }));
    await replaceUserAvailabilityConfiguration(u.id, weekdays);
    const g = (await createGoalWithActivities({ userId: u.id, title: 'Snapshot goal', targetDate: null, activities: [] })).goal;
    const R1 = (await addGoalActivity(u.id, g.id, { title: 'R1', activityId: 'meditation', rhythm }))!;
    const R2 = (await addGoalActivity(u.id, g.id, { title: 'R2', activityId: 'quiet-time', rhythm }))!;
    const idOf = (date: string, ga: { id: string }) => encodeGoalDemandIntentId(date, ga.id);

    const rowsFor = async (user: User, date: string, activities: Array<{ id: string }>, tz: string): Promise<PlanDayIntentRow[]> => {
      const eligible = await loadEligibleGoalDemand(createRealGoalDemandCandidatesDeps(), user.id, date, tz);
      return activities.map((ga) => { const c = (eligible as any).candidates.find((x: any) => x.goalActivityId === ga.id); return createIntentRowFromAutoGoalSuggestion({ title: c.title, activityId: c.activityId, goalActivityId: c.goalActivityId }, idOf(date, ga)); });
    };
    const baseDeps = (user: User, date: string, rows: PlanDayIntentRow[]) => ({
      getSession: () => ({ userId: user.id }), getUser: (id: string) => getUserById(id),
      getBody: async () => ({ intents: buildRequestedIntentsForSubmission(rows, user.timezone, date) }),
      now: () => localDateTimeToUTC(date, '09:00', user.timezone), createOrchestratorDeps: createRealDayConstructorOrchestratorDeps,
    });
    /** P2d composition: ONE snapshot (through `runner`), recurrence from it, durations / availability / plans from it. */
    const previewCoherent = async (user: User, date: string, rows: PlanDayIntentRow[], runner?: SnapshotRunner) => {
      lastEvidence = undefined;
      const r = await handleDayConstructorPreviewRequest({
        ...baseDeps(user, date, rows),
        loadSchedulingContext: (usr, request) => loadDecisionSchedulingContext({ userId: usr.id, planningDate: request.targetDate, timezone: request.timezone }, runner),
        loadDecisionFactsFromContext: (usr, request, context) => loadGoalDecisionFacts(usr, request, createGoalDemandDepsFromSchedulingContext(context)),
      });
      return { body: JSON.parse(JSON.stringify(r.body)), evidence: capturedEvidence() };
    };
    /** The LEGACY composition (independent live reads), kept here as the control: the recurrence read, then -- separately -- availability and plans. */
    const previewLegacy = async (user: User, date: string, rows: PlanDayIntentRow[], afterRecurrenceRead?: () => Promise<void>) => {
      lastEvidence = undefined;
      const live = createRealGoalDemandCandidatesDeps();
      let fired = false;
      const hooked: GoalDemandCandidatesDeps = { loadCandidateGoalActivities: live.loadCandidateGoalActivities, loadRhythmFacts: async (...args) => { const out = await live.loadRhythmFacts(...args); if (afterRecurrenceRead && !fired) { fired = true; await afterRecurrenceRead(); } return out; } };
      const r = await handleDayConstructorPreviewRequest({
        ...baseDeps(user, date, rows),
        loadDecisionFacts: (usr, request) => loadGoalDecisionFacts(usr, request, hooked),
        createOpportunityRangeDeps: (usr) => createRealOpportunityRangeDeps(usr),
      });
      return { body: JSON.parse(JSON.stringify(r.body)), evidence: capturedEvidence() };
    };

    /** The real concurrent scheduling write: an UPCOMING plan over the whole planning day AND the Rhythm occurrence linked to it (committed by a separate connection). */
    let concurrentPlanIds: string[] = [];
    const commitConcurrently = async () => {
      const plan = await createPlannedActivity({ userId: u.id, title: 'concurrent commitment', plannedStartAt: localDateTimeToUTC(FRIDAY, '09:00', TZ), plannedEndAt: localDateTimeToUTC(FRIDAY, '17:00', TZ), durationMinutes: 480, windowType: 'NEUTRAL' });
      await sql(`INSERT INTO "GoalActivityOccurrence" (id, "userId", "goalActivityId", "plannedActivityId") VALUES (gen_random_uuid()::text, $1, $2, $3)`, [u.id, R1.id, plan.id]);
      concurrentPlanIds.push(plan.id);
    };
    const resetConcurrent = async () => {
      await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [u.id]);
      await sql(`DELETE FROM "GoalActivityOccurrence" WHERE "userId" = $1`, [u.id]);
      await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [u.id]);
      concurrentPlanIds = [];
    };
    const rows = await rowsFor(u, FRIDAY, [R1, R2], TZ);
    const r1 = idOf(FRIDAY, R1); const r2 = idOf(FRIDAY, R2);

    // ============================================================
    console.log('=== the two real database states, and what each evaluation must say ===');
    const s0 = await previewCoherent(u, FRIDAY, rows);
    check('S0 (nothing committed): both candidates have 3 remaining occurrences, a KNOWN_FEASIBLE planning day and no later viable day -> LAST_KNOWN_OPPORTUNITY', view(s0.evidence?.get(r1)) === 'remaining=3;start=KNOWN_FEASIBLE;afterStartViable=0' && view(s0.evidence?.get(r2)) === 'remaining=3;start=KNOWN_FEASIBLE;afterStartViable=0' && pressureOf(s0.evidence?.get(r1), FRIDAY) === 'LAST_KNOWN_OPPORTUNITY');
    await commitConcurrently();
    const s1 = await previewCoherent(u, FRIDAY, rows);
    check('S1 (the concurrent commit is in): R1 has 2 remaining occurrences and the day is KNOWN_INFEASIBLE for BOTH candidates (the whole day is committed) -> NONE', view(s1.evidence?.get(r1)) === 'remaining=2;start=KNOWN_INFEASIBLE;afterStartViable=0' && view(s1.evidence?.get(r2)) === 'remaining=3;start=KNOWN_INFEASIBLE;afterStartViable=0' && pressureOf(s1.evidence?.get(r1), FRIDAY) === 'NONE');
    await resetConcurrent();

    // ============================================================
    console.log('=== CONTROL: the LEGACY composition (independent reads) observes a state that never existed ===');
    const skew = await previewLegacy(u, FRIDAY, rows, commitConcurrently);
    const skewR1 = view(skew.evidence?.get(r1)); const skewR2 = view(skew.evidence?.get(r2));
    check(`LEGACY SKEW: with a real concurrent commit between the recurrence read and the plan read, R1's evidence says "${skewR1}" -- 3 occurrences remain (S0's demand) beside a fully blocked day (S1's supply)`, skewR1 === 'remaining=3;start=KNOWN_INFEASIBLE;afterStartViable=0');
    check('that evidence matches NEITHER real database state (S0 is remaining=3 + FEASIBLE, S1 is remaining=2 + INFEASIBLE): the immutable evidence faithfully froze an internally inconsistent view, and its pressure is NONE although S0 said LAST_KNOWN_OPPORTUNITY', skewR1 !== view(s0.evidence?.get(r1)) && skewR1 !== view(s1.evidence?.get(r1)) && pressureOf(skew.evidence?.get(r1), FRIDAY) === 'NONE' && skewR2 === 'remaining=3;start=KNOWN_INFEASIBLE;afterStartViable=0');
    await resetConcurrent();

    // ============================================================
    console.log('=== P2d: the SAME concurrent commit, at EVERY point of the snapshot, never produces a mixed view ===');
    const log: string[] = [];
    await previewCoherent(u, FRIDAY, rows, hookedRunner(999, async () => {}, log));
    const statementCount = log.length;
    check('the snapshot issues a fixed, small set of statements (candidates, occurrences, preferences, habit logs, availability flag, availability periods, plans) -- 7 here', statementCount === 7 && /GoalActivity/.test(log[0]) && /GoalActivityOccurrence/.test(log[1]) && /PlannedActivity/.test(log[6]));
    const outcomes: string[] = [];
    let everyCoherent = true; let beforeSnapshotSeesNew = false; let mixed = false;
    for (let k = 0; k <= statementCount; k += 1) {
      await resetConcurrent();
      const run = await previewCoherent(u, FRIDAY, rows, hookedRunner(k, commitConcurrently));
      const a = view(run.evidence?.get(r1)); const b = view(run.evidence?.get(r2));
      outcomes.push(`k=${k}:${a === view(s0.evidence?.get(r1)) ? 'S0' : a === view(s1.evidence?.get(r1)) ? 'S1' : 'MIXED'}`);
      const expect = k === 0 ? s1 : s0;
      if (a !== view(expect.evidence?.get(r1)) || b !== view(expect.evidence?.get(r2)) || JSON.stringify(run.evidence?.get(r1)) !== JSON.stringify(expect.evidence?.get(r1)) || JSON.stringify(run.evidence?.get(r2)) !== JSON.stringify(expect.evidence?.get(r2))) everyCoherent = false;
      if (k === 0 && a === view(s1.evidence?.get(r1))) beforeSnapshotSeesNew = true;
      if ((a === view(s0.evidence?.get(r1))) !== (b === view(s0.evidence?.get(r2)))) mixed = true; // candidate A on one state, candidate B on another
    }
    console.log(`[info] ${outcomes.join(' ')}`);
    check(`COHERENT AT EVERY COMMIT POINT: a concurrent commit after the 1st .. ${statementCount}th statement (after the snapshot exists) is invisible to the WHOLE evaluation -- both candidates' evidence is deeply equal to S0; a commit before the first statement (the snapshot not yet taken) is seen by ALL of it -- deeply equal to S1`, everyCoherent && beforeSnapshotSeesNew);
    check('SAME SNAPSHOT FOR EVERY CANDIDATE: at no commit point does one candidate see the old shared state and another the new one', !mixed);
    await resetConcurrent();

    // ============================================================
    console.log('=== REPEATABLE READ is what is actually emitted, and a later evaluation sees the commit ===');
    {
      const plansCount = (ex: ReadQueryExecutor) => ex.query(`SELECT count(*)::int AS n FROM "PlannedActivity" WHERE "userId" = $1`, [u.id]).then((r) => r.rows[0].n as number);
      let inside: string[] = [];
      await withRepeatableReadSnapshot(async (ex) => {
        const iso = (await ex.query(`SELECT current_setting('transaction_isolation') AS level`)).rows[0].level as string;
        const first = await plansCount(ex);
        await commitConcurrently();
        const second = await plansCount(ex);
        inside = [iso, String(first), String(second)];
      });
      const after = await withRepeatableReadSnapshot(plansCount);
      check('ACTUAL ISOLATION: inside the snapshot `transaction_isolation` is "repeatable read"; a plan committed by another connection AFTER the snapshot exists is NOT visible to the next read of the same transaction (count 0 then 0), and IS visible to a NEW snapshot (1)', inside[0] === 'repeatable read' && inside[1] === '0' && inside[2] === '0' && after === 1);
      await resetConcurrent();
      const c = await beginTransaction(); // CONTROL: PostgreSQL's default READ COMMITTED does see the later commit, so the test above discriminates
      let rc: number[] = [];
      try { const a = (await c.query(`SELECT count(*)::int AS n FROM "PlannedActivity" WHERE "userId" = $1`, [u.id])).rows[0].n; await commitConcurrently(); const b = (await c.query(`SELECT count(*)::int AS n FROM "PlannedActivity" WHERE "userId" = $1`, [u.id])).rows[0].n; rc = [a, b]; await c.query('COMMIT'); } finally { c.release(); }
      check('CONTROL: under the default isolation (READ COMMITTED) the same second read DOES see the concurrent commit (0 then 1) -- the repeatable-read behavior above is real, not an artifact', rc[0] === 0 && rc[1] === 1);
      await resetConcurrent();
      const cOld = await previewCoherent(u, FRIDAY, rows);
      await commitConcurrently();
      const cNew = await previewCoherent(u, FRIDAY, rows);
      check('NEXT EVALUATION SEES THE COMMIT (no stale cross-request cache): an evaluation started before the commit says S0 for both candidates, and the very next evaluation says S1 for both', view(cOld.evidence?.get(r1)) === view(s0.evidence?.get(r1)) && view(cNew.evidence?.get(r1)) === view(s1.evidence?.get(r1)) && view(cNew.evidence?.get(r2)) === view(s1.evidence?.get(r2)));
      await resetConcurrent();
    }

    // ============================================================
    console.log('=== the snapshot executor: read-only, bounded, and it does not outlive the snapshot ===');
    {
      let insertRejected = false; let multiRejected = false; let escaped: ReadQueryExecutor | undefined;
      await withRepeatableReadSnapshot(async (ex) => {
        escaped = ex;
        try { ex.query(`INSERT INTO "UserActivityPreference" (id, "userId", "activityId", "preferredDurationMinutes") VALUES ('x', 'x', 'meditation', 20)`); } catch { insertRejected = true; }
        try { ex.query(`SELECT 1; DELETE FROM "PlannedActivity"`); } catch { multiRejected = true; }
      });
      let afterEndRejected = false;
      try { escaped!.query('SELECT 1'); } catch { afterEndRejected = true; }
      check('READ-ONLY BY CONSTRUCTION: a write statement and a multi-statement text are rejected before reaching the driver, and the executor is unusable once the snapshot has ended (the transaction client never escapes)', insertRejected && multiRejected && afterEndRejected);
    }

    // ============================================================
    console.log('=== query bound: constant in the number of candidates; one snapshot per evaluation ===');
    {
      const extra = [];
      for (let i = 0; i < 4; i += 1) extra.push((await addGoalActivity(u.id, g.id, { title: `X${i}`, activityId: 'tea-break', rhythm }))!);
      const many = [R1, R2, ...extra];
      const manyRows = await rowsFor(u, FRIDAY, many, TZ);
      const countFor = async (rs: PlanDayIntentRow[]) => { const l: string[] = []; let runs = 0; const runner: SnapshotRunner = (read) => { runs += 1; return hookedRunner(999, async () => {}, l)(read); }; await previewCoherent(u, FRIDAY, rs, runner); return { statements: l.length, snapshots: runs }; };
      const few = await countFor(rows); const lots = await countFor(manyRows);
      check(`QUERY BOUND: 2 candidates and 6 candidates cost exactly the same: ${few.statements} statements in ${few.snapshots} snapshot (O(1) in the candidate count -- the occurrence read is one batched query, there is no per-candidate transaction or query)`, few.statements === lots.statements && few.snapshots === 1 && lots.snapshots === 1);
      const evAll = lastEvidence;
      check('all six candidates of the one evaluation have evidence from the same snapshot (identical shared supply view)', many.every((ga) => view(evAll?.get(idOf(FRIDAY, ga))).includes('start=KNOWN_FEASIBLE')));
      await sql(`DELETE FROM "GoalActivity" WHERE id = ANY($1::text[])`, [extra.map((x) => x.id)]);
      const emptyLog: string[] = [];
      await cleanupUser(ula.id);
      await loadDecisionSchedulingContext({ userId: ula.id, planningDate: FRIDAY, timezone: 'America/Los_Angeles' }, hookedRunner(999, async () => {}, emptyLog));
      check('with no recurrence candidate at all the snapshot reads only the candidates, the preferences and the habit logs (3 statements) -- availability and plans are not read when no opportunity evidence can exist', emptyLog.length === 3);
    }

    // ============================================================
    console.log('=== no contract change: the preview body and signed tokens are identical to the legacy composition when nothing is concurrent ===');
    {
      const legacy = await previewLegacy(u, FRIDAY, rows);
      const coherent = await previewCoherent(u, FRIDAY, rows);
      check('PREVIEW AND TOKEN IDENTITY: the full preview body (constructed day, resolved intents, every signed acceptance token) is byte-identical between the legacy and the P2d composition, and so is each candidate\'s evidence', JSON.stringify(legacy.body) === JSON.stringify(coherent.body) && JSON.stringify(legacy.body).includes('acceptanceToken') && [r1, r2].every((id) => JSON.stringify(legacy.evidence?.get(id)) === JSON.stringify(coherent.evidence?.get(id))));
      check('the preview carries no snapshot, context, pressure or shadow field', !/napshot|schedulingContext|ressure|hadow/.test(JSON.stringify(coherent.body)));
    }

    // ============================================================
    console.log('=== the reads mean exactly what they meant: overnight, half-open, lifecycle, duration sources, timezone / DST ===');
    {
      const equalEvidence = async (label: string, user: User, date: string, rs: PlanDayIntentRow[], ids: string[]) => {
        const a = await previewLegacy(user, date, rs); const b = await previewCoherent(user, date, rs);
        return ids.every((id) => !!a.evidence?.get(id) && JSON.stringify(a.evidence?.get(id)) === JSON.stringify(b.evidence?.get(id))) || (console.log(`   ${label}: legacy ${ids.map((id) => view(a.evidence?.get(id)))} vs coherent ${ids.map((id) => view(b.evidence?.get(id)))}`), false);
      };
      const ctxFor = (planningDate: string, tz: string, userId = u.id) => loadDecisionSchedulingContext({ userId, planningDate, timezone: tz });
      // overnight blocker: starts Thursday 23:00 IST, ends Friday 10:00 IST (overlaps the horizon start)
      const overnight = await createPlannedActivity({ userId: u.id, title: 'overnight', plannedStartAt: localDateTimeToUTC('2026-10-08', '23:00', TZ), plannedEndAt: localDateTimeToUTC(FRIDAY, '10:00', TZ), durationMinutes: 660, windowType: 'NEUTRAL' });
      const ctxOvernight: DecisionSchedulingContext = await ctxFor(FRIDAY, TZ);
      check('OVERNIGHT BLOCKER: a plan that STARTS the day before the horizon and runs into it is in the snapshot (canonical overlap read, not a start-scoped one) and the evidence equals the legacy composition', ctxOvernight.opportunity!.plans.length === 1 && await equalEvidence('overnight', u, FRIDAY, rows, [r1, r2]));
      await sql(`DELETE FROM "PlannedActivity" WHERE id = $1`, [overnight.id]);
      // half-open: ends exactly when the horizon starts / starts exactly when it ends
      const endsAtStart = await createPlannedActivity({ userId: u.id, title: 'touch-start', plannedStartAt: localDateTimeToUTC('2026-10-08', '22:00', TZ), plannedEndAt: localDateTimeToUTC(FRIDAY, '00:00', TZ), durationMinutes: 120, windowType: 'NEUTRAL' });
      const startsAtEnd = await createPlannedActivity({ userId: u.id, title: 'touch-end', plannedStartAt: localDateTimeToUTC('2026-10-12', '00:00', TZ), plannedEndAt: localDateTimeToUTC('2026-10-12', '02:00', TZ), durationMinutes: 120, windowType: 'NEUTRAL' });
      check('HALF-OPEN [start, end): a plan ending exactly at the horizon start and one starting exactly at its end are NOT in the snapshot', (await ctxFor(FRIDAY, TZ)).opportunity!.plans.length === 0);
      await sql(`DELETE FROM "PlannedActivity" WHERE id = ANY($1::text[])`, [[endsAtStart.id, startsAtEnd.id]]);
      // lifecycle: CANCELLED is excluded by the read; LOGGED is read and the adapter's lifecycle decides -- evidence equals legacy
      const cancelled = await createPlannedActivity({ userId: u.id, title: 'cancelled', plannedStartAt: localDateTimeToUTC(FRIDAY, '10:00', TZ), plannedEndAt: localDateTimeToUTC(FRIDAY, '12:00', TZ), durationMinutes: 120, windowType: 'NEUTRAL' });
      const logged = await createPlannedActivity({ userId: u.id, title: 'logged', plannedStartAt: localDateTimeToUTC(FRIDAY, '13:00', TZ), plannedEndAt: localDateTimeToUTC(FRIDAY, '14:00', TZ), durationMinutes: 60, windowType: 'NEUTRAL' });
      await sql(`UPDATE "PlannedActivity" SET status = 'CANCELLED' WHERE id = $1`, [cancelled.id]);
      await sql(`UPDATE "PlannedActivity" SET status = 'LOGGED' WHERE id = $1`, [logged.id]);
      const ctxLife = await ctxFor(FRIDAY, TZ);
      check('LIFECYCLE: a CANCELLED plan is not read; a LOGGED plan is read (the lifecycle adapter decides) -- and the evidence equals the legacy composition', ctxLife.opportunity!.plans.map((p) => p.status).join() === 'LOGGED' && await equalEvidence('lifecycle', u, FRIDAY, rows, [r1, r2]));
      await sql(`DELETE FROM "PlannedActivity" WHERE id = ANY($1::text[])`, [[cancelled.id, logged.id]]);
      // duration sources from the snapshot: a stored preference changes RESOLVED minutes; behavioral logs the same way
      await sql(`INSERT INTO "UserActivityPreference" (id, "userId", "activityId", "preferredDurationMinutes") VALUES (gen_random_uuid()::text, $1, 'meditation', 25)`, [u.id]);
      const withPref = await previewCoherent(u, FRIDAY, rows);
      check('DURATION SOURCES FROM THE SNAPSHOT: a stored preference (25) outranks the catalog default (15) for R1 and leaves R2 on its default, exactly as the live duration context resolves it', withPref.evidence?.get(r1)?.opportunity?.durationMinutes === 25 && withPref.evidence?.get(r1)?.opportunity?.durationBasis === 'RESOLVED' && withPref.evidence?.get(r2)?.opportunity?.durationMinutes === 45 && await equalEvidence('preference', u, FRIDAY, rows, [r1, r2]));
      await sql(`DELETE FROM "UserActivityPreference" WHERE "userId" = $1`, [u.id]);
      for (const [d, m] of [['2026-10-02', 40], ['2026-10-03', 45], ['2026-10-04', 50]] as Array<[string, number]>) await sql(`INSERT INTO "HabitLog" (id, "userId", "activityTitle", "activityId", "activeWindow", "logMinuteOfDay", "logTimestamp", "durationMinutes", "logSource", "activitySignificance") VALUES (gen_random_uuid()::text, $1, 'm', 'meditation', 'NEUTRAL', 600, $2, $3, 'MANUAL', 'MEDIUM')`, [u.id, `${d}T05:00:00Z`, m]);
      const withBehavior = await previewCoherent(u, FRIDAY, rows);
      check('behavioral duration FROM THE SNAPSHOT: three consistent logs resolve R1 to the median (45), as the live path does', withBehavior.evidence?.get(r1)?.opportunity?.durationMinutes === 45 && await equalEvidence('behavioral', u, FRIDAY, rows, [r1, r2]));
      await sql(`DELETE FROM "HabitLog" WHERE "userId" = $1`, [u.id]);
      // non-UTC timezone and a DST week (America/Los_Angeles; the week of 2026-10-26 ends on the fall-back day 2026-11-01)
      await replaceUserAvailabilityConfiguration(ula.id, weekdays);
      const gla = (await createGoalWithActivities({ userId: ula.id, title: 'LA goal', targetDate: null, activities: [] })).goal;
      const LA = (await addGoalActivity(ula.id, gla.id, { title: 'LA', activityId: 'meditation', rhythm }))!;
      const laRows = await rowsFor(ula, '2026-10-30', [LA], 'America/Los_Angeles');
      const laId = idOf('2026-10-30', LA);
      check('NON-UTC + DST WEEK (America/Los_Angeles, planning Friday 2026-10-30, horizon through Sunday 2026-11-01 the fall-back day): the evidence is deeply equal to the legacy composition', await equalEvidence('LA/DST', ula, '2026-10-30', laRows, [laId]));
      check('the Asia/Kolkata fixtures above and this America/Los_Angeles one both use the user\'s own timezone for the week, the horizon and the plan range (the snapshot range equals the adapter\'s own bounds)', (await ctxFor('2026-10-30', 'America/Los_Angeles', ula.id)).opportunity!.planRangeFrom === localDateTimeToUTC('2026-10-30', '00:00', 'America/Los_Angeles').toISOString() && (await ctxFor('2026-10-30', 'America/Los_Angeles', ula.id)).opportunity!.planRangeTo === localDateTimeToUTC('2026-11-02', '00:00', 'America/Los_Angeles').toISOString());
    }

    // ============================================================
    console.log('=== failure: no partial context, and never a fallback to the live reads ===');
    {
      let rejected = false;
      const failing: SnapshotRunner = (read) => withRepeatableReadSnapshot(async (ex) => { let n = 0; return read({ query: async (t, p) => { n += 1; if (n === 3) throw new Error('simulated read failure'); return ex.query(t, p); } }); });
      try { await loadDecisionSchedulingContext({ userId: u.id, planningDate: FRIDAY, timezone: TZ }, failing); } catch { rejected = true; }
      check('PARTIAL READ FAILURE: when the 3rd statement fails the whole acquisition rejects (the transaction rolls back); no context holding the first two reads is ever returned', rejected);
      const after = await previewCoherent(u, FRIDAY, rows, failing);
      check('NO MIXED-SNAPSHOT FALLBACK: when the context cannot be acquired the preview still succeeds (READY) but there is NO decision evidence at all -- the old independent live reads are not used as a substitute and nothing is labelled authoritative', after.body.status === 'READY' && (after.evidence === undefined || after.evidence.size === 0));
      const pool1 = await withRepeatableReadSnapshot(async (ex) => (await ex.query('SELECT 1 AS ok')).rows[0].ok as number);
      check('the connection pool is healthy after the rolled-back snapshot (the connection was released)', pool1 === 1);
    }

    if (!allPassed) { console.error('SOME DECISION SCHEDULING SNAPSHOT DB CHECKS FAILED'); process.exitCode = 1; return; }
    console.log('ALL DECISION SCHEDULING SNAPSHOT DB CHECKS PASSED');
  } finally {
    (preparationModule as any).prepareDecisionEvidence = realPrepareEvidence;
    await cleanup();
    await sql(`DELETE FROM "User" WHERE email = ANY($1::text[])`, [[EMAIL, EMAIL_LA]]).catch(() => {});
  }
}
main().then(() => process.exit(), (err) => { console.error(err); process.exit(1); });
