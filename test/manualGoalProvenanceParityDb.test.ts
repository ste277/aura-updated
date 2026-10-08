/**
 * O5 P0a -- manual Goal provenance parity, live-database lifecycle proof.
 *
 * REAL chain, no mocked facts:
 *   real user + Goal + recurring GoalActivity + Rhythm + availability
 *   -> real manual handoff (resolveGoalActivityHandoff) and real automatic
 *      bootstrap (resolveAutomaticGoalDemand) -> server marking
 *   -> real client row factories -> real request builder
 *   -> the real preview boundary wired as route.ts wires it (Goal facts
 *      provider + O4 opportunity enrichment) -> real signing
 *   -> real accept route -> real provenance authorization -> real
 *      occurrence materialization and PlannedActivity persistence.
 *
 * Proves: manual and automatic entry yield IDENTICAL provenance facts;
 * acceptance is correct and idempotent for the canonical manual row; no
 * duplicate occurrence in either order; cross-user/exhausted/finite/
 * archived/freeform/forged inputs never gain Goal facts.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/manualGoalProvenanceParityDb.test.ts
 */
import {
  upsertUserByEmail,
  updateBirthProfile,
  createGoalWithActivities,
  addGoalActivity,
  beginTransaction,
  replaceUserAvailabilityConfiguration,
  getUserById,
  listGoalActivitiesWithLinkedPlanStatus,
  loadGoalActivityRhythmFacts,
  createPlannedActivity,
} from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { createRealDayConstructorOrchestratorDeps } from '../apps/web/lib/dayConstructorOrchestrator';
import { handleDayConstructorPreviewRequest } from '../apps/web/lib/dayConstructorPreviewRequest';
import { loadGoalDecisionFacts } from '../apps/web/lib/goalDecisionFactsProvider';
import { createRealOpportunityRangeDeps } from '../apps/web/lib/opportunityRangeRealDeps';
import { createRealGoalDemandCandidatesDeps, loadEligibleGoalDemand, type GoalDemandCandidatesDeps } from '../apps/web/lib/goalDemandCandidates';
import { resolveGoalActivityHandoff, resolveAutomaticGoalDemand, markCanonicalGoalDemandHandoff } from '../apps/web/lib/planDayBootstrap';
import { createIntentRowFromGoalHandoffItem, createIntentRowFromAutoGoalSuggestion, createInitialIntentRow, buildRequestedIntentsForSubmission, buildGoalActivityLinksForAccept, type PlanDayIntentRow } from '../apps/web/lib/planDayEntry';
import { encodeGoalDemandIntentId } from '../apps/web/lib/goalDemandIntentId';
import { buildAcceptRequestBody } from '../apps/web/lib/acceptConstructedDay';
import { POST as acceptRoute } from '../apps/web/app/api/day-constructor/accept/route';
import { localDateTimeToUTC } from '../apps/web/lib/timezone';
import { fixtureAnchorMonday, addCivilDays, realClockReferenceForFixture } from './lifecycleFixtureCalendar';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const TZ = 'Asia/Kolkata';
// CI reliability -- the fixture week is ANCHORED in the future (test/lifecycleFixtureCalendar.ts), not hard-coded. The REAL accept route reads the wall clock for its stale-preview
// check ("the proposed start has elapsed"), so a calendar frozen at the day this test was written began failing on every run once that day arrived -- on clean main, with no code change.
// Production is right to refuse a past plan. Every date below is an offset from a Monday at least 28 local days ahead, so the Monday-start Rhythm week, the day before the planning
// date and the Sunday that ends the week keep the same relationships on every run date.
const ANCHOR_MONDAY = fixtureAnchorMonday(realClockReferenceForFixture(), TZ);
const TUE = addCivilDays(ANCHOR_MONDAY, 1);
const DATE = addCivilDays(ANCHOR_MONDAY, 2); // Wednesday
const SUN = addCivilDays(ANCHOR_MONDAY, 6);
const NOW = localDateTimeToUTC(DATE, '09:00', TZ);

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
const setRhythm = (goalActivityId: string, target: number) => sql(`UPDATE "GoalActivity" SET "rhythmKind" = 'N_PER_WEEK', "rhythmTargetPerWeek" = $1 WHERE id = $2`, [target, goalActivityId]);

async function main() {
  const mk = async (key: string) => {
    const u = await upsertUserByEmail({ email: `test-p0a-${key}@example.com`, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
    await updateBirthProfile(u.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
    return u;
  };
  const A = await mk('a');
  const B = await mk('b');
  const ids = [A.id, B.id];
  const cleanup = async () => {
    await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = NULL WHERE "userId" = ANY($1::text[])`, [ids]);
    // Acceptance idempotency claims are keyed by the (now deterministic) clientRequestId; a rerun against the same upserted users must not replay a prior run's claims.
    await sql(`DELETE FROM "PlanCreationIdempotency" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "GoalActivity" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "Goal" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`DELETE FROM "UserAvailabilityPeriod" WHERE "userId" = ANY($1::text[])`, [ids]);
    await sql(`UPDATE "User" SET "availabilityConfigured" = false WHERE id = ANY($1::text[])`, [ids]);
  };
  await cleanup();

  interface Counters {
    discovery: number;
    facts: number;
  }
  const previewAs = async (userId: string, body: Record<string, unknown>, counters?: Counters) => {
    const real = createRealGoalDemandCandidatesDeps();
    const goalDeps: GoalDemandCandidatesDeps = {
      loadCandidateGoalActivities: async (uid) => {
        if (counters) counters.discovery += 1;
        return real.loadCandidateGoalActivities(uid);
      },
      loadRhythmFacts: async (uid, gids, tz) => {
        if (counters) counters.facts += 1;
        return real.loadRhythmFacts(uid, gids, tz);
      },
    };
    const result = await handleDayConstructorPreviewRequest({
      getSession: () => ({ userId }),
      getUser: (id) => getUserById(id),
      getBody: async () => body,
      now: () => NOW,
      createOrchestratorDeps: createRealDayConstructorOrchestratorDeps,
      loadDecisionFacts: (u, request) => loadGoalDecisionFacts(u, request, goalDeps),
      createOpportunityRangeDeps: (u) => createRealOpportunityRangeDeps(u),
    });
    return JSON.parse(JSON.stringify(result.body));
  };
  const rowsToBody = (rows: PlanDayIntentRow[], extra: Record<string, unknown> = {}) => ({ intents: buildRequestedIntentsForSubmission(rows, TZ, DATE), ...extra });
  const facts = (preview: any, id: string) => preview.preview?.resolvedIntents?.find((r: any) => r.requestedIntentId === id)?.dayIntent?.decisionFacts;
  const fakeReq = (userId: string, body: unknown): any => ({ cookies: { get: () => ({ value: createSessionToken(userId, 'ignored@example.com') }) }, json: async () => body, headers: new Headers() });
  const accept = async (userId: string, body: unknown) => (await acceptRoute(fakeReq(userId, body))).json();
  let n = 0;
  const acceptBodyFor = (preview: any, rows: PlanDayIntentRow[]) => JSON.parse(JSON.stringify(buildAcceptRequestBody(preview.preview, `p0a-${ANCHOR_MONDAY}-${n++}`, buildGoalActivityLinksForAccept(rows, preview.preview.constructedDay.proposedItems))));
  const counts = async (goalActivityId: string) => ({
    occ: (await sql(`SELECT count(*)::int n FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [goalActivityId]))[0].n as number,
    plans: (await sql(`SELECT count(*)::int n FROM "PlannedActivity" pa JOIN "GoalActivityOccurrence" gao ON gao."plannedActivityId" = pa.id WHERE gao."goalActivityId" = $1`, [goalActivityId]))[0].n as number,
  });
  const userPlans = async (userId: string) => (await sql(`SELECT count(*)::int n FROM "PlannedActivity" WHERE "userId" = $1`, [userId]))[0].n as number;

  try {
    await replaceUserAvailabilityConfiguration(A.id, [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })));
    const g1 = (await createGoalWithActivities({ userId: A.id, title: 'Goal one', targetDate: null, activities: [] })).goal;
    const gArch = (await createGoalWithActivities({ userId: A.id, title: 'Archived goal', targetDate: null, activities: [] })).goal;
    const R = (await addGoalActivity(A.id, g1.id, { title: 'Cardio', activityId: 'workout' }))!;
    await setRhythm(R.id, 3);
    const R2 = (await addGoalActivity(A.id, g1.id, { title: 'Strength', activityId: 'workout' }))!;
    await setRhythm(R2.id, 3);
    const F = (await addGoalActivity(A.id, g1.id, { title: 'One-off finite task', activityId: null }))!;
    const E = (await addGoalActivity(A.id, g1.id, { title: 'Exhausted this week', activityId: 'workout' }))!;
    await setRhythm(E.id, 1);
    const donePlan = await createPlannedActivity({ userId: A.id, title: 'done', plannedStartAt: localDateTimeToUTC(TUE, '08:00', TZ), plannedEndAt: localDateTimeToUTC(TUE, '08:30', TZ), durationMinutes: 30, windowType: 'NEUTRAL' });
    await sql(`UPDATE "PlannedActivity" SET status = 'LOGGED' WHERE id = $1`, [donePlan.id]);
    await sql(`INSERT INTO "GoalActivityOccurrence"(id, "userId", "goalActivityId", "plannedActivityId") VALUES ('p0a-occ-e', $1, $2, $3)`, [A.id, E.id, donePlan.id]);
    await sql(`UPDATE "GoalActivity" SET "plannedActivityId" = $1 WHERE id = $2`, [donePlan.id, E.id]);
    const AR = (await addGoalActivity(A.id, gArch.id, { title: 'Archived cardio', activityId: 'workout' }))!;
    await setRhythm(AR.id, 3);
    await sql(`UPDATE "Goal" SET status = 'ARCHIVED' WHERE id = $1`, [gArch.id]);
    const gB = (await createGoalWithActivities({ userId: B.id, title: 'B goal', targetDate: null, activities: [] })).goal;
    const RB = (await addGoalActivity(B.id, gB.id, { title: 'B cardio', activityId: 'workout' }))!;
    await setRhythm(RB.id, 2);

    const idOf = (ga: { id: string }) => encodeGoalDemandIntentId(DATE, ga.id);
    const realBootstrapDeps = (userId: string) => ({ getSessionToken: () => 'tok', verifySession: () => ({ userId }) });

    // ------------------------------------------------------------------
    console.log('=== server marking through the REAL handoff + bootstrap ===');
    const handoff = await resolveGoalActivityHandoff(
      { ...realBootstrapDeps(A.id), listGoalActivities: (uid, gid) => listGoalActivitiesWithLinkedPlanStatus(uid, gid), loadGoalActivityRhythmFacts: (uid, gaId, tz) => loadGoalActivityRhythmFacts(uid, gaId, tz) },
      g1.id,
      [R.id, F.id, E.id].join(','),
      DATE,
      TZ
    );
    check('manual handoff admits the recurring and finite activities and NOT the exhausted one (existing zero-remaining behavior)', handoff.some((h) => h.id === R.id) && handoff.some((h) => h.id === F.id) && !handoff.some((h) => h.id === E.id));
    const auto = await resolveAutomaticGoalDemand({ ...realBootstrapDeps(A.id), ...createRealGoalDemandCandidatesDeps() }, DATE, TZ, handoff.map((h) => h.id));
    check('the single real eligible-demand load recognizes ONLY the recurring handoff activity as canonical demand', auto.status === 'OK' && JSON.stringify(auto.manualCanonicalGoalActivityIds) === JSON.stringify([R.id]));
    const marked = markCanonicalGoalDemandHandoff(handoff, auto.status === 'OK' ? auto.manualCanonicalGoalActivityIds : []);
    check('marking: recurring item canonical; finite item left as the legacy manual item', marked.find((m) => m.id === R.id)?.canonicalDemand === true && marked.find((m) => m.id === F.id)?.canonicalDemand === undefined);
    const handoffArch = await resolveGoalActivityHandoff(
      { ...realBootstrapDeps(A.id), listGoalActivities: (uid, gid) => listGoalActivitiesWithLinkedPlanStatus(uid, gid), loadGoalActivityRhythmFacts: (uid, gaId, tz) => loadGoalActivityRhythmFacts(uid, gaId, tz) },
      gArch.id,
      AR.id,
      DATE,
      TZ
    );
    const autoArch = await resolveAutomaticGoalDemand({ ...realBootstrapDeps(A.id), ...createRealGoalDemandCandidatesDeps() }, DATE, TZ, handoffArch.map((h) => h.id));
    check('an activity of an ARCHIVED Goal is not recognized as canonical demand (manual parity does NOT broaden eligibility): it stays a legacy manual row', autoArch.status === 'OK' && autoArch.manualCanonicalGoalActivityIds.length === 0);
    const cross = await resolveGoalActivityHandoff(
      { ...realBootstrapDeps(B.id), listGoalActivities: (uid, gid) => listGoalActivitiesWithLinkedPlanStatus(uid, gid), loadGoalActivityRhythmFacts: (uid, gaId, tz) => loadGoalActivityRhythmFacts(uid, gaId, tz) },
      g1.id,
      R.id,
      DATE,
      TZ
    );
    check('cross-user: B cannot hand off A\'s activity at all', cross.length === 0);

    // ------------------------------------------------------------------
    console.log('=== SOURCE-PATH PRIVILEGE: identical facts via both entry paths ===');
    const manualRows = marked.filter((m) => m.id === R.id).map((m) => createIntentRowFromGoalHandoffItem(m, encodeGoalDemandIntentId(DATE, m.id)));
    const elig = await loadEligibleGoalDemand(createRealGoalDemandCandidatesDeps(), A.id, DATE, TZ);
    const cand = elig.status === 'OK' ? elig.candidates.find((c) => c.goalActivityId === R.id) : undefined;
    const autoRows = [createIntentRowFromAutoGoalSuggestion({ title: cand!.title, activityId: cand!.activityId, goalActivityId: cand!.goalActivityId }, idOf(R))];
    check('the two entry paths produce the SAME client row (same canonical identity, same provenance field)', JSON.stringify(manualRows) === JSON.stringify(autoRows) && manualRows[0].id === idOf(R));
    const autoCounters = { discovery: 0, facts: 0 };
    const manualCounters = { discovery: 0, facts: 0 };
    const pvAuto = await previewAs(A.id, rowsToBody(autoRows), autoCounters);
    const pvManual = await previewAs(A.id, rowsToBody(manualRows), manualCounters);
    check('both previews are READY through the real boundary', pvAuto.status === 'READY' && pvManual.status === 'READY');
    check('PERMANENT PRIVILEGE GUARD: recurrence AND opportunity decision facts are IDENTICAL for the automatic and manual entry', !!facts(pvAuto, idOf(R))?.recurrence && !!facts(pvAuto, idOf(R))?.opportunity && JSON.stringify(facts(pvAuto, idOf(R))) === JSON.stringify(facts(pvManual, idOf(R))));
    const oa = facts(pvAuto, idOf(R)).opportunity;
    const om = facts(pvManual, idOf(R)).opportunity;
    check('...including horizon, coverage and duration basis', oa.horizonStartDate === om.horizonStartDate && oa.horizonEndDate === om.horizonEndDate && oa.coverage === om.coverage && oa.durationBasis === om.durationBasis && oa.viableDays === om.viableDays);
    check('...and the recurrence period is the planning date\'s own week (Monday .. Sunday of the anchored week)', facts(pvManual, idOf(R)).recurrence.periodStartDate === ANCHOR_MONDAY && facts(pvManual, idOf(R)).recurrence.periodEndDate === SUN);
    check('...and an identical constructed day (facts are inert; entry path changes no Constructor output)', JSON.stringify(pvAuto.preview.constructedDay) === JSON.stringify(pvManual.preview.constructedDay));
    check('query parity: the same Goal queries for the manual and the automatic preview (1 discovery + 1 facts), no per-intent lookup', JSON.stringify(autoCounters) === JSON.stringify(manualCounters) && manualCounters.discovery === 1 && manualCounters.facts === 1);

    console.log('=== other manual rows stay fact-free ===');
    const finiteRow = createIntentRowFromGoalHandoffItem(marked.find((m) => m.id === F.id)!, encodeGoalDemandIntentId(DATE, F.id));
    const freeform = { ...createInitialIntentRow(), title: 'Write report' };
    const exhaustedForged = { ...createIntentRowFromGoalHandoffItem({ id: E.id, title: E.title, activityId: E.activityId, canonicalDemand: true }, idOf(E)) };
    const archivedLegacy = createIntentRowFromGoalHandoffItem({ id: AR.id, title: AR.title, activityId: AR.activityId }, idOf(AR));
    const forgedOther = { ...createIntentRowFromGoalHandoffItem({ id: RB.id, title: 'My cardio', activityId: 'workout', canonicalDemand: true }, idOf(RB)) }; // A forging B's activity id
    const pvMisc = await previewAs(A.id, rowsToBody([finiteRow, freeform, exhaustedForged, archivedLegacy, forgedOther]));
    check('finite manual row: legacy id, NO facts (non-recurrent behavior preserved)', finiteRow.id === `plan-day-goal-${F.id}` && facts(pvMisc, finiteRow.id) === undefined);
    check('freeform row: no facts', facts(pvMisc, freeform.id) === undefined && freeform.goalActivityId === undefined);
    check('exhausted activity with a FORGED canonical id: no facts (zero-remaining exclusion cannot be bypassed)', facts(pvMisc, idOf(E)) === undefined);
    check('archived-goal activity: no facts', facts(pvMisc, archivedLegacy.id) === undefined);
    check('another user\'s canonical id supplied by A: no facts for A', facts(pvMisc, idOf(RB)) === undefined);
    const pvForged = await previewAs(A.id, rowsToBody(manualRows, { timezone: 'Pacific/Kiritimati', decisionFacts: { recurrence: { targetPerPeriod: 99 } }, opportunity: { viableDays: 99 }, periodStartDate: '1999-01-04' }));
    check('forged body facts / period bounds / timezone are ignored: facts equal the server-derived ones', JSON.stringify(facts(pvForged, idOf(R))) === JSON.stringify(facts(pvManual, idOf(R))));
    const titleForged = await previewAs(A.id, rowsToBody([{ ...manualRows[0], title: 'Something else entirely' }]));
    check('a legitimate canonical id with an altered title still resolves to the same facts (identity is the id)', JSON.stringify(facts(titleForged, idOf(R))?.recurrence) === JSON.stringify(facts(pvManual, idOf(R)).recurrence));
    const pvLegacy = await previewAs(A.id, rowsToBody([{ ...manualRows[0], id: `plan-day-goal-${R.id}` }]));
    check('the LEGACY manual id (stale tab / old link) for the SAME recurring activity stays fact-free -- never promoted by title or activity matching', facts(pvLegacy, `plan-day-goal-${R.id}`) === undefined);

    // ------------------------------------------------------------------
    console.log('=== acceptance of the canonical MANUAL row ===');
    const before = await counts(R.id);
    const manualBody = acceptBodyFor(pvManual, manualRows);
    check('the real client accept body links the canonical manual row exactly as it links an automatic row', JSON.stringify(manualBody.goalActivityLinks) === JSON.stringify([{ intentId: idOf(R), goalActivityId: R.id }]));
    const accepted = await accept(A.id, manualBody);
    check('acceptance is SAVED (signed canonical id -> provenance authorization -> persistence)', accepted.status === 'SAVED');
    const afterAccept = await counts(R.id);
    check('exactly ONE occurrence and ONE PlannedActivity created', before.occ === 0 && afterAccept.occ === 1 && afterAccept.plans === 1);
    const occ = (await sql(`SELECT * FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [R.id]))[0];
    const gaRow = (await listGoalActivitiesWithLinkedPlanStatus(A.id, g1.id)).find((r) => r.id === R.id)!;
    check('provenance is correct: the occurrence points at R and the accepted plan; the GoalActivity link follows', occ.plannedActivityId === accepted.plans[0].id && gaRow.plannedActivityId === accepted.plans[0].id);
    const replay = await accept(A.id, { ...manualBody });
    check('idempotency: replaying the same acceptance returns the original plan and creates nothing new', replay.status === 'ALREADY_ACCEPTED' && (await counts(R.id)).occ === 1 && (await counts(R.id)).plans === 1);
    // Multi-Occurrence Rhythm PR 2: R's target is 3 and only 1 occurrence
    // is committed here -- real remaining capacity (2) exists, so R is
    // now correctly STILL offered (the former "exclude while any
    // occurrence is live" rule is gone; weekly capacity is the only gate).
    const autoAfter = await loadEligibleGoalDemand(createRealGoalDemandCandidatesDeps(), A.id, DATE, TZ);
    const candAfter = autoAfter.status === 'OK' ? autoAfter.candidates.find((c) => c.goalActivityId === R.id) : undefined;
    check('automatic discovery STILL offers R while its occurrence is live, with capacity correctly reduced (remainingThisWeek=2) -- Multi-Occurrence Rhythm PR 2', !!candAfter && candAfter.remainingThisWeek === 2);
    const manualAgain = await resolveGoalActivityHandoff(
      { ...realBootstrapDeps(A.id), listGoalActivities: (uid, gid) => listGoalActivitiesWithLinkedPlanStatus(uid, gid), loadGoalActivityRhythmFacts: (uid, gaId, tz) => loadGoalActivityRhythmFacts(uid, gaId, tz) },
      g1.id,
      R.id,
      DATE,
      TZ
    );
    check('...and the manual handoff (resolveGoalActivityHandoff) STILL admits it too -- Multi-Occurrence Rhythm PR 2 parity fix (PLANNED with remaining capacity is now admitted, matching automatic discovery)', manualAgain.length === 1 && manualAgain[0].id === R.id);

    // ------------------------------------------------------------------
    console.log('=== reverse order: automatic first, then a manual attempt ===');
    const autoRows2 = [createIntentRowFromAutoGoalSuggestion({ title: R2.title, activityId: R2.activityId, goalActivityId: R2.id }, idOf(R2))];
    const pv2 = await previewAs(A.id, rowsToBody(autoRows2));
    const acc2 = await accept(A.id, acceptBodyFor(pv2, autoRows2));
    check('automatic acceptance of R2 saves one occurrence', acc2.status === 'SAVED' && (await counts(R2.id)).occ === 1);
    const forcedManual = [createIntentRowFromGoalHandoffItem({ id: R2.id, title: R2.title, activityId: R2.activityId, canonicalDemand: true }, idOf(R2))];
    const pv2b = await previewAs(A.id, rowsToBody(forcedManual));
    const plansBefore = await userPlans(A.id);
    const acc2b = await accept(A.id, acceptBodyFor(pv2b, forcedManual));
    // Multi-Occurrence Rhythm PR 2: R2's target is 3 and only 1 occurrence
    // is committed -- real remaining capacity (2) exists, so a second,
    // genuinely distinct acceptance (here forced through the manual
    // shape) now SUCCEEDS, creating a second, independent occurrence --
    // never a duplicate of the first, never an orphan.
    check('a second acceptance for the same activity (here forced through the manual shape), with real remaining capacity, SUCCEEDS as a distinct second occurrence -- Multi-Occurrence Rhythm PR 2', acc2b.status === 'SAVED' && (await counts(R2.id)).occ === 2 && (await counts(R2.id)).plans === 2 && (await userPlans(A.id)) === plansBefore + 1);

    console.log('=== legacy finite manual path still works exactly as before ===');
    const pvF = await previewAs(A.id, rowsToBody([finiteRow]));
    const accF = await accept(A.id, acceptBodyFor(pvF, [finiteRow]));
    const fRow = (await listGoalActivitiesWithLinkedPlanStatus(A.id, g1.id)).find((r) => r.id === F.id)!;
    check('the legacy finite manual row is accepted and links the GoalActivity (unchanged behavior)', accF.status === 'SAVED' && fRow.plannedActivityId === accF.plans[0].id && (await counts(F.id)).occ === 0);

    console.log('=== cross-user acceptance ===');
    const bRows = [createIntentRowFromGoalHandoffItem({ id: R.id, title: 'Cardio', activityId: 'workout', canonicalDemand: true }, idOf(R))];
    const pvB = await previewAs(B.id, rowsToBody(bRows));
    check('user B carrying user A\'s canonical id gets NO facts from the server', facts(pvB, idOf(R)) === undefined);
    const bPlansBefore = await userPlans(B.id);
    const accB = await accept(B.id, acceptBodyFor(pvB, bRows));
    check('...and B\'s acceptance cannot link or consume A\'s activity: not SAVED, B has no new plan, A\'s counts unchanged', accB.status !== 'SAVED' && (await userPlans(B.id)) === bPlansBefore && (await counts(R.id)).occ === 1);

    if (!allPassed) {
      console.error('SOME MANUAL GOAL PROVENANCE PARITY DB CHECKS FAILED');
      process.exit(1);
    }
    console.log('ALL MANUAL GOAL PROVENANCE PARITY DB CHECKS PASSED');
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
