/**
 * Constructor Decision Intelligence -- O5 P4c3: the pure active materializer over REAL Goal-occurrence data (DB-backed probe).
 *
 * The materializer is proven against fakes in activeResultMaterializer.test.ts. This probe runs the real stack -- the real preview boundary (session -> user -> body
 * -> clock -> real orchestrator deps), the real REPEATABLE READ decision scheduling snapshot, the real Goal / Rhythm / availability persistence and the real
 * recurrence facts (so DecisionPressure comes from real Goal occurrences) -- through the SHADOW composition, then applies the TEST-ONLY pure pipeline
 * (observations -> selector -> gate -> materializer) to the very run the boundary produced, over many seeded Goal / duration shapes. It proves, on real data:
 *
 *   - the pipeline's output is the BASELINE object or exactly ONE materialized result, and every materialized result satisfies the full property oracle
 *   - the selector and the materializer send ZERO SQL statements and perform no write (they are pure over the run)
 *   - the baseline response is unchanged by the observation (parity with the plain preview)
 *   - incidence of ACCEPT / APPLY / materialized / unavailable reasons on real data (reported)
 *
 * Requires DATABASE_URL (fresh, 43 migrations).
 */
import path from 'path';
import { seededRandom, seededShuffle } from './fixtureSupport';
import { fixtureAnchorMonday, addCivilDays, realClockReferenceForFixture } from './lifecycleFixtureCalendar';
import { activeViolations, snap } from './activeMaterializerOracle';
import { upsertUserByEmail, updateBirthProfile, createGoalWithActivities, addGoalActivity, beginTransaction, replaceUserAvailabilityConfiguration, getUserById } from '../apps/web/lib/db';
import { createRealDayConstructorOrchestratorDeps, type ConstructDayRequest, type OrchestrateConstructDayResult } from '../apps/web/lib/dayConstructorOrchestrator';
import { handleDayConstructorPreviewRequest, type DayConstructorPreviewBoundaryDeps } from '../apps/web/lib/dayConstructorPreviewRequest';
import { loadGoalDecisionFacts, createGoalDemandDepsFromSchedulingContext } from '../apps/web/lib/goalDecisionFactsProvider';
import { createRealGoalDemandCandidatesDeps, loadEligibleGoalDemand } from '../apps/web/lib/goalDemandCandidates';
import { createIntentRowFromAutoGoalSuggestion, buildRequestedIntentsForSubmission, type PlanDayIntentRow } from '../apps/web/lib/planDayEntry';
import { encodeGoalDemandIntentId } from '../apps/web/lib/goalDemandIntentId';
import { loadDecisionSchedulingContext } from '../apps/web/lib/decisionSchedulingContextLoader';
import { observeShadowPolicy } from '../apps/web/lib/shadowPolicyObservation';
import { selectActiveCounterfactual } from '../apps/web/lib/activeSelector';
import { materializeActiveResult } from '../apps/web/lib/activeResultMaterializer';
import { evaluateMaterializability } from '../apps/web/lib/activeMaterializability';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import { authorizeGoalActivityLinks } from '../apps/web/lib/goalDemandProvenanceAuthorization';
import { sortByOverloadPrecedence, type DayIntent } from '../apps/web/lib/dayIntent';
import { signPreviewResultBody, verifyAcceptanceItems } from '../apps/web/lib/dayConstructorPreviewIntegrity';
import { evaluateAcceptance } from '../apps/web/lib/dayConstructorAcceptance';
import { localDateTimeToUTC } from '../apps/web/lib/timezone';
import { FULL_ACTIVITY_CATALOG } from '../packages/recommendation/src/personalizedTasks';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pg = require(require.resolve('pg', { paths: [path.join(__dirname, '..', 'apps', 'web')] })) as { Client: { prototype: { query: (...args: any[]) => any } } };

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const TZ = 'Asia/Kolkata';
// The planning day is ANCHORED (test/lifecycleFixtureCalendar.ts), not hard-coded: the Friday of a Monday-start week at least 28 local days ahead. The probe itself reads no real clock
// (the preview takes an explicit `now`), but a fixed calendar would silently freeze the Goal Rhythm week the real facts are derived from.
const ANCHOR_MONDAY = fixtureAnchorMonday(realClockReferenceForFixture(), TZ);
const FRIDAY = addCivilDays(ANCHOR_MONDAY, 4);
const EMAIL = 'test-p4c3-active-materializer@example.com';
// The CI-vs-LOCAL divergence this probe once had was `updateBirthProfile` handing PostgreSQL the bare string '1990-06-15', which the server resolved in its SESSION TimeZone (UTC in
// CI -> natal nakshatra Shatabhisha; Asia/Kolkata locally -> Dhanishta), so the real timing search and whether a promotion was ACCEPTed depended on the database server's timezone.
// Birth Data B2 fixed the writer at its source (it now stores the explicit UTC-midnight surrogate, see apps/web/lib/birthDate.ts), so the probe passes the plain CIVIL date like
// every production caller and no longer needs to pin an instant itself. birthDateWritersDb.test.ts proves the invariance across database timezones.
const BIRTH_CIVIL_DATE = '1990-06-15';

async function sql(text: string, params: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(text, params); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

/** Every SQL statement any connection sends while `fn` runs. */
async function capturing<T>(fn: () => Promise<T> | T): Promise<{ value: T; statements: string[] }> {
  const statements: string[] = [];
  const original = pg.Client.prototype.query;
  pg.Client.prototype.query = function (...args: any[]) {
    const first = args[0];
    const text = typeof first === 'string' ? first : typeof first?.text === 'string' ? first.text : undefined;
    if (text !== undefined) statements.push(text.replace(/\s+/g, ' ').trim());
    return original.apply(this, args);
  };
  try { return { value: await fn(), statements }; } finally { pg.Client.prototype.query = original; }
}

async function main() {
  const u = await upsertUserByEmail({ email: EMAIL, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await updateBirthProfile(u.id, { birthDate: BIRTH_CIVIL_DATE, birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  const cleanup = async () => {
    await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [u.id]);
    await sql(`DELETE FROM "GoalActivityOccurrence" WHERE "userId" = $1`, [u.id]);
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [u.id]);
    await sql(`DELETE FROM "HabitLog" WHERE "userId" = $1`, [u.id]);
    await sql(`DELETE FROM "UserActivityPreference" WHERE "userId" = $1`, [u.id]);
    await sql(`DELETE FROM "GoalActivity" WHERE "userId" = $1`, [u.id]);
    await sql(`DELETE FROM "Goal" WHERE "userId" = $1`, [u.id]);
    await sql(`DELETE FROM "UserAvailabilityPeriod" WHERE "userId" = $1`, [u.id]);
    await sql(`UPDATE "User" SET "availabilityConfigured" = false WHERE id = $1`, [u.id]);
  };
  await cleanup();
  try {
    await replaceUserAvailabilityConfiguration(u.id, [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })));
    const goal = (await createGoalWithActivities({ userId: u.id, title: 'Active materializer goal', targetDate: null, activities: [] })).goal;
    const rhythm = { kind: 'N_PER_WEEK' as const, targetPerWeek: 3 };
    const activities: Array<{ id: string }> = [];
    for (const catalog of FULL_ACTIVITY_CATALOG.slice(0, 11)) activities.push((await addGoalActivity(u.id, goal.id, { title: `GA ${catalog.id}`, activityId: catalog.id, rhythm }))!);
    const eligible = await loadEligibleGoalDemand(createRealGoalDemandCandidatesDeps(), u.id, FRIDAY, TZ);
    const baseRows: PlanDayIntentRow[] = activities.map((ga) => {
      const c = (eligible as any).candidates.find((x: any) => x.goalActivityId === ga.id);
      return createIntentRowFromAutoGoalSuggestion({ title: c.title, activityId: c.activityId, goalActivityId: c.goalActivityId }, encodeGoalDemandIntentId(FRIDAY, ga.id));
    });
    const now = localDateTimeToUTC(FRIDAY, '09:00', TZ);
    // The acceptance boundary clock for the directed fixture: before the first proposed instant (a candidate may start exactly at the 09:00 window start), on the anchored planning day -- a
    // stated fixture instant, never a wall-clock read. (The real route reads the wall clock once; the planning day is always in its future.)
    const acceptanceNow = localDateTimeToUTC(FRIDAY, '08:30', TZ);
    const counts = async () => JSON.stringify((await sql(`SELECT (SELECT count(*)::int FROM "PlannedActivity" WHERE "userId" = $1) AS plans, (SELECT count(*)::int FROM "GoalActivityOccurrence" WHERE "userId" = $1) AS occ, (SELECT count(*)::int FROM "GoalActivity" WHERE "userId" = $1) AS ga, (SELECT count(*)::int FROM "HabitLog" WHERE "userId" = $1) AS logs`, [u.id]))[0]);
    type Observed = Awaited<ReturnType<typeof observeShadowPolicy>>;
    interface Captured { observed?: Observed; request?: ConstructDayRequest }
    const boundary = (rows: PlanDayIntentRow[], captured?: Captured): DayConstructorPreviewBoundaryDeps => ({
      getSession: () => ({ userId: u.id }), getUser: (id) => getUserById(id), getBody: async () => ({ intents: buildRequestedIntentsForSubmission(rows, TZ, FRIDAY) }), now: () => now,
      createOrchestratorDeps: createRealDayConstructorOrchestratorDeps,
      loadSchedulingContext: (usr, request) => loadDecisionSchedulingContext({ userId: usr.id, planningDate: request.targetDate, timezone: request.timezone }),
      loadDecisionFactsFromContext: (usr, request, context) => loadGoalDecisionFacts(usr, request, createGoalDemandDepsFromSchedulingContext(context)),
      ...(captured ? { shadowPolicy: () => ({ mode: 'SHADOW' as const, observe: async (request: ConstructDayRequest, deps: any, onBaseline?: (r: OrchestrateConstructDayResult) => void) => { captured.request = request; captured.observed = await observeShadowPolicy(request, deps, onBaseline); return captured.observed; } }) } : {}),
    });

    const rnd = seededRandom(20261009);
    const DURATIONS = [60, 90, 120, 150, 180, 240];
    const scenarios: Array<{ n: number; durations: number[]; pick?: number[] }> = [
      { n: 11, durations: Array(11).fill(120) }, { n: 5, durations: Array(5).fill(180) }, { n: 2, durations: [240, 240] }, { n: 2, durations: [300, 180] }, { n: 3, durations: Array(3).fill(180) }, { n: 4, durations: Array(4).fill(150) }, { n: 4, durations: [240, 120, 120, 60] }, { n: 3, durations: [300, 120, 90] }, { n: 6, durations: Array(6).fill(90) },
    ];
    const EXTRA = Number(process.env.P4C3_DB_EXTRA_SCENARIOS ?? 40);
    for (let k = 0; k < EXTRA; k += 1) { const n = 2 + Math.floor(rnd() * 6); scenarios.push({ n, durations: Array.from({ length: n }, () => DURATIONS[Math.floor(rnd() * DURATIONS.length)]), pick: seededShuffle(baseRows.map((_, i) => i), rnd).slice(0, n) }); }

    const outcomes: Record<string, number> = {};
    const tally = { runs: 0, ready: 0, evaluated: 0, withObservations: 0, accepts: 0, apply: 0, materialized: 0, unavailable: {} as Record<string, number>, noChange: {} as Record<string, number>, baselineIdentity: 0, violations: 0, nonZeroSqlPure: 0, bodyMismatch: 0, writes: 0 };
    let firstViolation = '';
    for (const sc of scenarios) {
      const rows = (sc.pick ? sc.pick.map((i) => baseRows[i]) : baseRows.slice(0, sc.n)).map((row, i) => ({ ...row, durationMinutes: sc.durations[i] }));
      const before = await counts();
      const plain = await handleDayConstructorPreviewRequest(boundary(rows));
      const captured: Captured = {};
      const shadow = await handleDayConstructorPreviewRequest(boundary(rows, captured));
      const after = await counts();
      tally.runs += 1;
      if (shadow.httpStatus !== 200 || (shadow.body as { status?: string }).status !== 'READY' || !captured.observed || !captured.request) continue;
      tally.ready += 1;
      if (snap(plain.body) !== snap(shadow.body)) tally.bodyMismatch += 1;
      if (before !== after) tally.writes += 1;
      const observed = captured.observed;
      if (observed.shadowPolicy.status !== 'READY') continue;
      tally.evaluated += 1;
      tally.withObservations += observed.shadowPolicy.observations.length > 0 ? 1 : 0;
      for (const o of observed.shadowPolicy.observations) { const key = o.outcome === 'ACCEPT' ? 'ACCEPT' : `${o.outcome}:${o.reason}`; outcomes[key] = (outcomes[key] ?? 0) + 1; }
      tally.accepts += observed.shadowPolicy.observations.filter((o) => o.outcome === 'ACCEPT').length;
      const piped = await capturing(() => {
        const selection = selectActiveCounterfactual(observed.shadowPolicy);
        if (selection.status !== 'APPLY') return { kind: 'BASELINE' as const, reason: selection.reason };
        const accepted = selection.acceptedCounterfactual;
        const m = materializeActiveResult({ baselineResult: observed.result, constructionBasis: accepted.constructionBasis, accepted });
        return m.status === 'READY' ? { kind: 'ACTIVE' as const, accepted, result: m.result } : { kind: 'BASELINE' as const, reason: m.reason, applied: true };
      });
      if (piped.statements.length > 0) tally.nonZeroSqlPure += 1;
      const out = piped.value;
      if (out.kind === 'BASELINE') {
        tally.baselineIdentity += 1;
        if ('applied' in out) tally.unavailable[out.reason] = (tally.unavailable[out.reason] ?? 0) + 1; else tally.noChange[out.reason] = (tally.noChange[out.reason] ?? 0) + 1;
        if ('applied' in out) tally.apply += 1;
        continue;
      }
      tally.apply += 1; tally.materialized += 1;
      const basis = out.accepted.constructionBasis;
      if (basis.status !== 'READY') { tally.violations += 1; continue; }
      const intentById = new Map(basis.basis.intents.map((i) => [i.id, i]));
      const order = sortByOverloadPrecedence(basis.basis.intents as unknown as readonly DayIntent[], basis.basis.planningDate).map((i) => i.id);
      const vs = activeViolations(observed.result, out.result, out.accepted, { order, titleOf: (id) => intentById.get(id)?.title, durationMinutesOf: (id) => intentById.get(id)?.estimatedDurationMinutes });
      if (vs.length > 0) { tally.violations += 1; if (!firstViolation) firstViolation = vs.join('; '); }
    }
    console.log(`     real-data incidence: ${JSON.stringify(tally)}`);
    console.log(`     real-data observation outcomes: ${JSON.stringify(outcomes)}`);
    if (firstViolation) console.log(`     first violation: ${firstViolation}`);
    check('every broad scenario ran the real preview boundary to a READY 200 with a captured same-run shadow observation (HTTP, snapshot, Goal facts and real orchestrator deps)', tally.ready === tally.runs && tally.runs === scenarios.length);
    check('PARITY: the preview body with the observation in the loop equals the plain preview body for every scenario (the active pieces consume the run, they do not change it)', tally.bodyMismatch === 0);
    check('NO WRITES: the domain row counts are unchanged by every run', tally.writes === 0);
    check('PURE ON REAL DATA: the selector and the materializer sent ZERO SQL statements in every scenario', tally.nonZeroSqlPure === 0);
    check(`the pipeline output is the BASELINE or exactly ONE materialized result in every evaluated scenario: ${tally.baselineIdentity} baseline + ${tally.materialized} materialized = ${tally.evaluated} evaluated`, tally.baselineIdentity + tally.materialized === tally.evaluated && tally.evaluated === tally.ready);
    check(`EVERY MATERIALIZED RESULT ON REAL DATA satisfies the property oracle (${tally.materialized} materialized, ${tally.violations} violations)`, tally.violations === 0);

    // ======================================================================
    // THE DIRECTED REAL-ACCEPT FIXTURE
    //
    // WHAT THIS PROBE PROVES THAT THE FAKE-SEARCH BEHAVIOR SUITE DOES NOT: the behavior suite proves the materializer MECHANICS deterministically over an honest fake timing search.
    // This probe proves the REAL stack can reach an accepted authority and that the materialized result is usable: real Goal / GoalActivity / Rhythm persistence and real recurrence
    // facts (so DecisionPressure is derived from real Goal occurrences), the real REPEATABLE READ snapshot, the real orchestrator and the real astronomical timing search -> P4b3 ACCEPT
    // -> P4c1 selector (exactly one ACCEPT) -> P4c2a gate -> P4c3 READY result with ZERO SQL from the selector / materializer -> the existing signing, the existing acceptance validation
    // and the REAL acceptance persistence (the exact route tail: token gate -> verified Goal provenance -> persistAcceptedConstructedDay) creating real Plans and real
    // GoalActivityOccurrence rows. It does NOT prove materializer mechanics in general (the behavior suite and its corpora do), and it does not prove that ACCEPT is common (incidence is reported).
    //
    // WHY A FAMILY AND NOT ONE HARD-CODED COMBINATION. The contention is made STRUCTURAL by the user's saved availability (two windows: 09:00-13:00 and 15:00-17:00), so a 4 h promotion
    // candidate fits only the first window and a 1-2 h owner fits either. Whether the owner's relocated slot has a timing fit NO WORSE than its baseline slot (the P4b3 owner floor, which
    // the fixture must not and does not bypass) is decided by the REAL timing search, i.e. by the day's astronomy (panchang labels), which is intentionally variable by date. Measured over 64
    // anchored Fridays across 15 months a single combination ACCEPTs on only ~70-90% of dates, but the ordered family below contained an ACCEPT on 64 of 64 (and every date had several).
    // The fixture walks the family IN ORDER (a pure function of the anchored date and the pinned context -- no randomness, no time) and takes the first combination whose run has exactly
    // one ACCEPT. If none does, the probe FAILS with the full trace: no policy is weakened and no assertion is made non-fatal.
    const CURATED: Array<[number, number, number, number]> = [
      [5, 6, 60, 240], [4, 10, 120, 240], [0, 1, 60, 240], [10, 6, 60, 240], [7, 10, 60, 240], [6, 1, 60, 240], [4, 6, 60, 240], [5, 1, 120, 240],
      [0, 2, 60, 240], [10, 1, 60, 240], [7, 2, 60, 240], [4, 1, 60, 240], [6, 5, 120, 240], [5, 3, 120, 240], [6, 9, 120, 240], [10, 9, 60, 240],
    ];
    // The curated prefix ACCEPTed on 64 of 64 measured dates (first hit within the first 3 on 63 of them); the exhaustive tail (every ordered activity pair x owner 60 / 120 min, candidate 240 min)
    // is a deterministic safety margin: on every one of 9 sampled dates at least 40 of its 220 combinations ACCEPT.
    const DIRECTED_FAMILY: Array<[number, number, number, number]> = [...CURATED];
    for (const dOwner of [60, 120]) for (let i = 0; i < baseRows.length; i += 1) for (let j = 0; j < baseRows.length; j += 1) if (i !== j && !CURATED.some((c) => c[0] === i && c[1] === j && c[2] === dOwner && c[3] === 240)) DIRECTED_FAMILY.push([i, j, dOwner, 240]);
    await replaceUserAvailabilityConfiguration(u.id, [1, 2, 3, 4, 5].flatMap((weekday) => [{ weekday, startTime: '09:00', endTime: '13:00' }, { weekday, startTime: '15:00', endTime: '17:00' }]));
    const directedTrace: string[] = [];
    let directed: { rows: PlanDayIntentRow[]; combo: string; captured: Captured } | undefined;
    for (const [i, j, dOwner, dCandidate] of DIRECTED_FAMILY) {
      const rows = [baseRows[i], baseRows[j]].map((row, k) => ({ ...row, durationMinutes: k === 0 ? dOwner : dCandidate }));
      const captured: Captured = {};
      const response = await handleDayConstructorPreviewRequest(boundary(rows, captured));
      const run = captured.observed?.shadowPolicy;
      const accepts = run && run.status === 'READY' ? run.observations.filter((o) => o.outcome === 'ACCEPT').length : -1;
      directedTrace.push(`${i}-${j}-${dOwner}-${dCandidate}:${response.httpStatus}:${accepts}`);
      if (response.httpStatus === 200 && accepts === 1) { directed = { rows, combo: `${i}-${j}-${dOwner}-${dCandidate}`, captured }; break; }
    }
    console.log(`     directed family trace (combo:http:ACCEPTs): ${directedTrace.join(' ')}`);
    check(`A DETERMINISTIC REAL ACCEPT: the directed real-pipeline fixture (availability-constrained contention, ordered family, first combination with exactly one real P4b3 ACCEPT) found one after ${directedTrace.length} of ${DIRECTED_FAMILY.length} combinations${directed ? ` (${directed.combo})` : ''}`, directed !== undefined);
    if (directed) {
      const observed = directed.captured.observed!;
      const baseline = observed.result as Extract<OrchestrateConstructDayResult, { status: 'READY' }>;
      const day = baseline.preview.constructedDay;
      const ownerIntent = directed.rows[0]; const candidateIntent = directed.rows[1];
      const idOf = (row: PlanDayIntentRow) => row.id;
      const regionTwoStart = localDateTimeToUTC(FRIDAY, '15:00', TZ).getTime();
      const regionOneEnd = localDateTimeToUTC(FRIDAY, '13:00', TZ).getTime();
      check('DIRECTED BASELINE: the owner is placed and the pressured candidate is the ONLY Deferred item (NO_CANDIDATES) -- real contention, nothing else to explain', day.proposedItems.length === 1 && day.proposedItems[0].intentId === idOf(ownerIntent) && day.deferredItems.length === 1 && day.deferredItems[0].intentId === idOf(candidateIntent) && day.deferredItems[0].primaryReason === 'NO_CANDIDATES');
      const plainDirected = await handleDayConstructorPreviewRequest(boundary(directed.rows));
      const shadowDirected = await handleDayConstructorPreviewRequest(boundary(directed.rows, {}));
      const beforeCounts = await counts();
      const selected = await capturing(() => {
        const selection = selectActiveCounterfactual(observed.shadowPolicy);
        if (selection.status !== 'APPLY') return { selection, accepted: undefined, gate: undefined, materialized: undefined };
        const accepted = selection.acceptedCounterfactual;
        const gate = evaluateMaterializability(day, accepted.candidateIntentId);
        const materialized = materializeActiveResult({ baselineResult: observed.result, constructionBasis: accepted.constructionBasis, accepted });
        return { selection, accepted, gate, materialized };
      });
      const picked = selected.value;
      check('P4c1: the observation set holds exactly one ACCEPT and the selector APPLYs it for the Deferred candidate', picked.selection.status === 'APPLY' && picked.selection.candidateIntentId === idOf(candidateIntent) && picked.selection.selectionReason === 'LAST_KNOWN_OPPORTUNITY_RESCUED');
      check('P4c2a: the materializability gate reports MATERIALIZABLE (the candidate is the sole Deferred item) and P4c3 returns READY', picked.gate?.status === 'MATERIALIZABLE' && picked.materialized?.status === 'READY');
      check('PURE ON THE DIRECTED RUN: the selector, the gate and the materializer sent ZERO SQL statements', selected.statements.length === 0);
      check('BASELINE UNCHANGED: the preview body with the observation in the loop equals the plain preview body, and the domain rows are unchanged by the selector / materializer', snap(plainDirected.body) === snap(shadowDirected.body) && (await counts()) === beforeCounts);
      if (picked.accepted && picked.materialized?.status === 'READY') {
        const active = picked.materialized.result;
        const basis = picked.accepted.constructionBasis;
        const items = active.preview.constructedDay.proposedItems;
        check('DIRECTED RESULT: both Goal activities are Proposed, nothing is Deferred, the candidate holds the first window and the owner was RELOCATED into the second window with a timing fit no worse than before', items.length === 2 && active.preview.constructedDay.deferredItems.length === 0 && items.every((it: { start: Date }) => it.start.getTime() >= 0) && (() => { const c = items.find((it: { intentId: string }) => it.intentId === idOf(candidateIntent))!; const o = items.find((it: { intentId: string }) => it.intentId === idOf(ownerIntent))!; return c.end.getTime() <= regionOneEnd && o.start.getTime() >= regionTwoStart && o.timingFit === day.proposedItems[0].timingFit; })());
        if (basis.status === 'READY') {
          const intentById = new Map(basis.basis.intents.map((i) => [i.id, i]));
          const order = sortByOverloadPrecedence(basis.basis.intents as unknown as readonly DayIntent[], basis.basis.planningDate).map((i) => i.id);
          const vs = activeViolations(baseline, active, picked.accepted, { order, titleOf: (id) => intentById.get(id)?.title, durationMinutesOf: (id) => intentById.get(id)?.estimatedDurationMinutes });
          check(`PROPERTY ORACLE on the directed real result (conservation, preservation, owner relocation, timing, order, capacity, window, overlap, frozen, detached): ${vs.length} violations`, vs.length === 0);
        }
        const signed = signPreviewResultBody(u.id, active as unknown as Record<string, unknown>) as { preview: { constructionWindow: any; constructedDay: { proposedItems: Array<Record<string, any>> } } };
        const signedItems = signed.preview.constructedDay.proposedItems;
        const acceptedItems = signedItems.map((i) => ({ intentId: i.intentId, activityId: i.activityId, title: i.title, start: i.start, end: i.end, placementSource: i.placementSource }));
        const tokens = new Map(signedItems.map((i) => [i.intentId as string, i.acceptanceToken]));
        check('SIGNING: every item of the directed materialized result carries a token that the acceptance-side gate verifies', signedItems.every((i) => typeof i.acceptanceToken === 'string') && verifyAcceptanceItems(u.id, signed.preview.constructionWindow, acceptedItems as any, tokens).length === 0);
        const fakeAcceptance = await evaluateAcceptance({ clientRequestId: `p4c3-fake-${ANCHOR_MONDAY}`, constructionWindow: signed.preview.constructionWindow, proposedItems: acceptedItems as any }, { loadFreshBlockers: async () => [], validateActivity: () => true, checkTiming: (r) => ({ start: r.candidateStart.toISOString(), end: new Date(r.candidateStart.getTime() + r.durationMinutes * 60000).toISOString(), score: 7, label: 'GOOD', muhurtaScore: 0, reasons: [], metadata: { windowType: 'NEUTRAL' as never, windowLabel: '', activityType: '', dateLabel: '' } }) }, acceptanceNow);
        if (fakeAcceptance.status !== 'ACCEPTABLE') console.log('     acceptance diagnostics:', JSON.stringify(fakeAcceptance));
        check(`EXISTING ACCEPTANCE VALIDATION (pure evaluator, injected dependencies): ACCEPTABLE with ${fakeAcceptance.status === 'ACCEPTABLE' ? fakeAcceptance.writeIntents.length : fakeAcceptance.status} write intents`, fakeAcceptance.status === 'ACCEPTABLE' && fakeAcceptance.writeIntents.length === 2);
        // The REAL acceptance path, exactly the route's tail: token gate -> verified automatic Goal provenance -> persistAcceptedConstructedDay (real blockers, real timing CHECK, one atomic transaction).
        const rawLinks = new Map(acceptedItems.map((i) => [i.intentId as string, directed!.rows.find((r) => idOf(r) === i.intentId)!.goalActivityId as string]));
        const authorization = authorizeGoalActivityLinks(acceptedItems as any, signed.preview.constructionWindow.date, rawLinks);
        const saved = authorization.status === 'REJECTED' ? undefined : await persistAcceptedConstructedDay(u.id, { clientRequestId: `p4c3-accept-${ANCHOR_MONDAY}`, constructionWindow: signed.preview.constructionWindow, proposedItems: acceptedItems as any }, acceptanceNow, authorization.goalActivityLinks);
        if (saved && saved.status !== 'SAVED') console.log('     persistence result:', JSON.stringify(saved));
        check(`REAL ACCEPTANCE PERSISTENCE: the verified Goal provenance is authorized and the REAL persistAcceptedConstructedDay SAVES the materialized day (${saved ? saved.status : authorization.status})`, saved !== undefined && saved.status === 'SAVED');
        const persisted = await sql(`SELECT o."goalActivityId" AS ga, p."plannedStartAt" AS s, p."plannedEndAt" AS e, p.status AS st FROM "GoalActivityOccurrence" o JOIN "PlannedActivity" p ON p.id = o."plannedActivityId" WHERE o."userId" = $1 ORDER BY p."plannedStartAt"`, [u.id]);
        const expectedStarts = items.map((it: { start: Date }) => it.start.getTime()).sort((x, y) => x - y);
        check('GOAL-OCCURRENCE EVIDENCE: exactly two UPCOMING Plans exist, each linked by a real GoalActivityOccurrence to its own Goal activity, at exactly the materialized instants (candidate in the first window, relocated owner in the second)', persisted.length === 2 && persisted.every((r: any) => r.st === 'UPCOMING') && JSON.stringify(persisted.map((r: any) => new Date(r.s).getTime())) === JSON.stringify(expectedStarts) && new Set(persisted.map((r: any) => r.ga)).size === 2 && persisted.every((r: any) => directed!.rows.some((row) => row.goalActivityId === r.ga)));
      }
    }
    console.log(`     real-data ACCEPT incidence: ${tally.accepts} ACCEPT observations across ${tally.runs} runs, ${tally.apply} APPLY, ${tally.materialized} materialized`);
  } finally {
    await cleanup();
    await sql(`DELETE FROM "User" WHERE email = $1`, [EMAIL]).catch(() => {});
  }
  if (!allPassed) { console.error('SOME ACTIVE MATERIALIZER DB CHECKS FAILED'); process.exitCode = 1; return; }
  console.log('ALL ACTIVE MATERIALIZER DB CHECKS PASSED');
}
main().then(() => process.exit(), (err) => { console.error(err); process.exit(1); });
