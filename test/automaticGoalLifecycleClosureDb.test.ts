/**
 * Goals V2 Candidate A3.5 -- END-TO-END LIFECYCLE CLOSURE.
 *
 * This is NOT a feature test. It proves the already-implemented A1-A3.4
 * layers COMPOSE into one real product lifecycle, exercised entirely
 * through real production boundaries (never mocked):
 *
 *   A1 loadEligibleGoalDemand (goalDemandCandidates.ts)
 *   -> A3.2 resolveAutomaticGoalDemand (planDayBootstrap.ts)
 *   -> A3.3 deriveAvailableAutoGoalSuggestions / createIntentRowFromAutoGoalSuggestion
 *      / encodeGoalDemandIntentId (planDayEntry.ts / goalDemandIntentId.ts)
 *   -> real Preview boundary (handleDayConstructorPreviewRequest,
 *      dayConstructorPreviewRequest.ts) -> real Constructor (dayConstructor.ts,
 *      Goal-blind) -> real signing (signPreviewResultBody, dayConstructorPreviewIntegrity.ts)
 *   -> real Accept route (POST, accept/route.ts) -> real verifyAcceptanceItems
 *      -> A3.4 authorizeGoalActivityLinks (goalDemandProvenanceAuthorization.ts)
 *      -> real persistAcceptedConstructedDay (dayConstructorAcceptancePersistence.ts)
 *      -> real materializeGoalActivityRhythmOccurrence (db.ts)
 *   -> real logPlannedActivity completion (db.ts, writes GoalActivityExecution)
 *   -> A1's own eligibility recomputation, fresh, for the NEXT planning date.
 *
 * Mirrors dayConstructorPreviewIntegrityDb.test.ts's own established
 * technique (the real preview boundary + the real accept route invoked
 * directly via a fake NextRequest) -- the ONE difference, deliberate per
 * this ticket's own section 29, is a FIXED `now` threaded through the
 * preview boundary instead of the real wall clock, so the entire
 * lifecycle is fully deterministic.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/automaticGoalLifecycleClosureDb.test.ts
 */
import { fixtureAnchorMonday, addCivilDays, realClockReferenceForFixture } from './lifecycleFixtureCalendar';
import {
  upsertUserByEmail,
  updateBirthProfile,
  createGoalWithActivities,
  addGoalActivity,
  beginTransaction,
  logPlannedActivity,
  listGoalActivitiesWithLinkedPlanStatus,
  loadGoalActivityRhythmFacts,
} from '../apps/web/lib/db';
import { getUserById } from '../apps/web/lib/db';
import { computeGoalActivityRhythmEligibility } from '../apps/web/lib/goalActivityRhythm';
import { createSessionToken } from '../apps/web/lib/auth';
import { handleDayConstructorPreviewRequest } from '../apps/web/lib/dayConstructorPreviewRequest';
import { createRealDayConstructorOrchestratorDeps } from '../apps/web/lib/dayConstructorOrchestrator';
import { parsePreviewResponseBody } from '../apps/web/lib/dayConstructorPreviewClient';
import type { ConstructDayPreview } from '../apps/web/lib/dayConstructorOrchestrator';
import { buildAcceptRequestBody, type GoalActivityLink } from '../apps/web/lib/acceptConstructedDay';
import { POST as acceptRoute } from '../apps/web/app/api/day-constructor/accept/route';
import { loadEligibleGoalDemand, createRealGoalDemandCandidatesDeps } from '../apps/web/lib/goalDemandCandidates';
import { resolveAutomaticGoalDemand, resolveGoalActivityHandoff } from '../apps/web/lib/planDayBootstrap';
import { deriveAvailableAutoGoalSuggestions, createIntentRowFromAutoGoalSuggestion, createIntentRowFromGoalActivity, type PlanDayIntentRow } from '../apps/web/lib/planDayEntry';
import { encodeGoalDemandIntentId } from '../apps/web/lib/goalDemandIntentId';
import { movePlannedActivity } from '../apps/web/lib/planMove';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
// The fixture week is ANCHORED to a Monday at least 28 days ahead of the run date (test/lifecycleFixtureCalendar.ts): production refuses past plans against the real
// clocks, so a hard-coded calendar rots the day it becomes the present. Weekday structure (Monday-start Rhythm week) is identical on every run date.
const ANCHOR_MONDAY = fixtureAnchorMonday(realClockReferenceForFixture(), TZ);
const TUE = addCivilDays(ANCHOR_MONDAY, 1);
const WED = addCivilDays(ANCHOR_MONDAY, 2);
const THU = addCivilDays(ANCHOR_MONDAY, 3);
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

const setRhythm = (goalActivityId: string, targetPerWeek: number) =>
  sql(`UPDATE "GoalActivity" SET "rhythmKind" = 'N_PER_WEEK', "rhythmTargetPerWeek" = $1 WHERE id = $2`, [targetPerWeek, goalActivityId]);

function iso(s: string): Date {
  return new Date(s);
}

async function main() {
  const user = await upsertUserByEmail({ email: 'test-a35-lifecycle@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const other = await upsertUserByEmail({ email: 'test-a35-lifecycle-other@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
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

  // ============================================================
  // Real production helpers -- no mocking of core truth (this ticket's
  // own section 28). `now` is always an explicit, fixed instant -- never
  // the real wall clock (section 29).
  // ============================================================
  let n = 0;
  const preview = async (now: Date, targetDate: string, intents: unknown[]): Promise<ConstructDayPreview | null> => {
    const result = await handleDayConstructorPreviewRequest({
      getSession: () => ({ userId: user.id }),
      getUser: (id) => getUserById(id),
      getBody: async () => ({ targetDate, intents }),
      now: () => now,
      createOrchestratorDeps: createRealDayConstructorOrchestratorDeps,
    });
    const parsed = parsePreviewResponseBody(JSON.parse(JSON.stringify(result.body)), result.httpStatus);
    return parsed.status === 'READY' ? parsed.preview : null;
  };
  const fakeReq = (userId: string, body: unknown): any => ({
    cookies: { get: () => ({ value: createSessionToken(userId, 'ignored@example.com') }) },
    json: async () => body,
    headers: new Headers(),
  });
  const accept = async (body: unknown) => {
    const res = await acceptRoute(fakeReq(user.id, body));
    return res.json();
  };
  const eligibility = async (planningLocalDate: string) => loadEligibleGoalDemand(createRealGoalDemandCandidatesDeps(), user.id, planningLocalDate, TZ);
  const autoSuggestions = async (planningLocalDate: string, excludeIds: readonly string[] = []) => resolveAutomaticGoalDemand({ getSessionToken: () => 'tok', verifySession: () => ({ userId: user.id }), ...createRealGoalDemandCandidatesDeps() }, planningLocalDate, TZ, excludeIds);
  /**
   * The CANONICAL Rhythm eligibility arithmetic (computeGoalActivityRhythmEligibility,
   * A1's own pure engine), fed with REAL facts loaded straight from the DB --
   * independent of `loadEligibleGoalDemand`'s own SEPARATE structural
   * discovery-boundary filter (which ALSO excludes a GoalActivity entirely
   * while it has a live UPCOMING commitment or zero remaining capacity, this
   * ticket's own section 12). This lets the test assert the exact
   * remainingThisWeek NUMBER at moments where the GoalActivity is correctly
   * absent from `eligibility(...).candidates` for one of those two reasons --
   * the discovery-absence itself is separately and already asserted
   * alongside every use of this helper below (11b/16b/20c).
   */
  const rhythmRemaining = async (goalActivityId: string, targetPerWeek: number, planningLocalDate: string) => {
    const facts = await loadGoalActivityRhythmFacts(user.id, goalActivityId, TZ);
    return computeGoalActivityRhythmEligibility({ rhythm: { kind: 'N_PER_WEEK', targetPerWeek }, planningLocalDate, occurrences: facts }).remainingOccurrences;
  };

  /** Durable-state evidence (this ticket's own section 30). */
  const durableState = async (label: string, goalActivityId: string) => {
    const occ = (await sql(`SELECT count(*)::int n FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [goalActivityId]))[0].n;
    const exec = (await sql(`SELECT count(*)::int n FROM "GoalActivityExecution" WHERE "goalActivityId" = $1`, [goalActivityId]))[0].n;
    const linkedPlans = (await sql(`SELECT count(*)::int n FROM "PlannedActivity" pa JOIN "GoalActivityOccurrence" gao ON gao."plannedActivityId" = pa.id WHERE gao."goalActivityId" = $1`, [goalActivityId]))[0].n;
    const elig = await eligibility(TUE);
    const remaining = elig.status === 'OK' ? elig.candidates.find((c) => c.goalActivityId === goalActivityId)?.remainingThisWeek ?? null : 'LOAD_FAILED';
    console.log(`  [EVIDENCE ${label}] occurrences=${occ} executions=${exec} linkedPlans=${linkedPlans} remainingThisWeek(${TUE})=${remaining}`);
    return { occ, exec, linkedPlans };
  };

  try {
    const { goal } = await createGoalWithActivities({ userId: user.id, title: 'Reduce stress', targetDate: null, activities: [] });
    const ga = await addGoalActivity(user.id, goal.id, { title: 'Meditate 10 minutes', activityId: 'meditation' });
    await setRhythm(ga!.id, 3);

    console.log('=== PHASE 1: ELIGIBLE ===');
    const phase1 = await eligibility(TUE);
    check('5a. canonical eligibility reports remainingThisWeek = 3 (0 completed, 0 committed, target 3)', phase1.status === 'OK' && phase1.candidates.find((c) => c.goalActivityId === ga!.id)?.remainingThisWeek === 3);
    const discovery1 = await eligibility(TUE);
    check('5b. automatic Goal-demand discovery returns the GoalActivity exactly once', discovery1.status === 'OK' && discovery1.candidates.filter((c) => c.goalActivityId === ga!.id).length === 1);
    await durableState('PHASE 1 INITIAL', ga!.id);

    console.log('=== PHASE 2: SURFACED (bootstrap) ===');
    const suggestions2 = await autoSuggestions(TUE, []);
    check('6a. Plan Day bootstrap surfaces the candidate for this user/date', suggestions2.status === 'OK' && suggestions2.suggestions.some((s) => s.goalActivityId === ga!.id));
    const s2 = suggestions2.status === 'OK' ? suggestions2.suggestions.find((s) => s.goalActivityId === ga!.id) : undefined;
    check(
      '6b. the surfaced candidate carries the exact correct fields',
      !!s2 && s2.goalActivityId === ga!.id && s2.goalId === goal.id && s2.goalTitle === 'Reduce stress' && s2.title === 'Meditate 10 minutes' && s2.activityId === 'meditation' && s2.remainingThisWeek === 3
    );
    await durableState('PHASE 2 AFTER BOOTSTRAP', ga!.id);
    check('6c. bootstrap itself created zero PlannedActivity/GoalActivityOccurrence rows', (await durableState('PHASE 2 recheck', ga!.id)).occ === 0 && (await sql(`SELECT count(*)::int n FROM "PlannedActivity" WHERE "userId" = $1`, [user.id]))[0].n === 0);

    console.log('=== PHASE 3: EXPLICIT INCLUDE ===');
    const intentId1 = encodeGoalDemandIntentId(TUE, ga!.id);
    check('7a. canonical intent identity format', intentId1 === `goal-demand:${TUE}:${ga!.id}`);
    const row1 = createIntentRowFromAutoGoalSuggestion({ title: s2!.title, activityId: s2!.activityId, goalActivityId: s2!.goalActivityId }, intentId1);
    check('7b. FLEXIBLE behavior preserved on the included row', row1.timeMode === 'FLEXIBLE');
    check('7c. goalActivityId carried by the client row', row1.goalActivityId === ga!.id);
    const availableAfterInclude = deriveAvailableAutoGoalSuggestions(suggestions2.status === 'OK' ? suggestions2.suggestions : [], [row1]);
    check('7d. the suggestion is no longer available while the row is included', !availableAfterInclude.some((s) => s.goalActivityId === ga!.id));
    await durableState('PHASE 3 AFTER INCLUDE', ga!.id);

    console.log('=== PHASE 4: PREVIEW / CONSTRUCTION ===');
    const rows1: PlanDayIntentRow[] = [row1];
    const nowP1 = iso(`${TUE}T02:00:00Z`); // early local morning in Asia/Kolkata (07:30 IST) -- hours remain in "remaining today"
    const pv1 = await preview(nowP1, TUE, rows1.map((r) => ({ id: r.id, title: r.title, flexibility: r.timeMode, activityId: r.activityId })));
    check('8a. the automatic intent reaches Preview and the Constructor proposes it', !!pv1 && pv1.constructedDay.proposedItems.some((item: { intentId: string }) => item.intentId === intentId1));
    const proposed1 = pv1!.constructedDay.proposedItems.find((item: { intentId: string }) => item.intentId === intentId1)!;
    check('8b. the proposed item is ordinary scheduling output -- no Goal field leaked onto it', !('goalActivityId' in proposed1) && !('goalTitle' in proposed1));
    const occBeforePreview = await durableState('PHASE 4 AFTER PREVIEW', ga!.id);
    check('8c. Preview creates zero Goal occurrence writes and consumes zero capacity', occBeforePreview.occ === 0 && (await eligibility(TUE)).status === 'OK' && (await eligibility(TUE) as any).candidates.find((c: any) => c.goalActivityId === ga!.id)?.remainingThisWeek === 3);

    console.log('=== PHASE 5/10: ACCEPT WITH SERVER-DERIVED PROVENANCE ===');
    // Section 10: deliberately call buildAcceptRequestBody WITHOUT any
    // goalActivityLinks argument -- the canonical "browser never sent an
    // entry" representation (the real client itself produces exactly
    // this body shape whenever buildGoalActivityLinksForAccept returns
    // []). This proves acceptance actually exercises A3.4's own
    // server-derivation, not the old client-trust path.
    const acceptBody1 = JSON.parse(JSON.stringify(buildAcceptRequestBody(pv1!, `a35-fixed-${n++}`)));
    check('10a. the accept body genuinely carries no goalActivityLinks entry for this item', !acceptBody1.goalActivityLinks);
    const accepted1 = await accept(acceptBody1);
    check('9a. acceptance succeeds (verified signed automatic intent -> provenance authorization -> persistence)', accepted1.status === 'SAVED');
    const stateAfterAccept1 = await durableState('PHASE 5 AFTER ACCEPT', ga!.id);
    check('9b. exactly one GoalActivityOccurrence created', stateAfterAccept1.occ === 1);
    check('9c. exactly one accepted PlannedActivity associated via the occurrence', stateAfterAccept1.linkedPlans === 1);
    const occRow1 = (await sql(`SELECT * FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [ga!.id]))[0];
    check('9d. occurrence points to the correct GoalActivity and the accepted plan (R3 model)', occRow1.goalActivityId === ga!.id && occRow1.plannedActivityId === accepted1.plans[0].id);
    const gaRowAfterAccept = (await listGoalActivitiesWithLinkedPlanStatus(user.id, goal.id)).find((r) => r.id === ga!.id)!;
    check('10b. GoalActivity.plannedActivityId correctly reflects the SERVER-DERIVED (not client-supplied) association', gaRowAfterAccept.plannedActivityId === accepted1.plans[0].id);

    console.log('=== PHASE 6/11: POST-ACCEPT ELIGIBILITY / LIVE-UPCOMING ===');
    check('11a. canonical Rhythm eligibility: remainingThisWeek = 2 (1 UPCOMING committed, target 3)', (await rhythmRemaining(ga!.id, 3, TUE)) === 2);
    const discovery6 = await eligibility(TUE);
    // Multi-Occurrence Rhythm PR 2: the former one-live-occurrence
    // exclusion is removed -- a GoalActivity with a live UPCOMING link
    // AND remaining weekly capacity now DOES appear in automatic
    // discovery again, with remainingThisWeek correctly reduced (2 of 3).
    const discoveredGa6 = discovery6.status === 'OK' ? discovery6.candidates.find((c) => c.goalActivityId === ga!.id) : undefined;
    check(
      "11b. Multi-Occurrence Rhythm PR 2: the GoalActivity DOES appear in automatic discovery while its current link is UPCOMING, now that weekly capacity (not a single live link) is the only gate -- remainingThisWeek correctly reflects the live commitment (2 of 3)",
      !!discoveredGa6 && discoveredGa6.remainingThisWeek === 2
    );
    await durableState('PHASE 6 POST-ACCEPT', ga!.id);

    console.log('=== PHASE 7: COMPLETE ===');
    const beforeComplete = await sql(`SELECT count(*)::int n FROM "GoalActivity" WHERE id = $1`, [ga!.id]);
    await logPlannedActivity(user.id, accepted1.plans[0].id);
    const afterComplete = await sql(`SELECT count(*)::int n FROM "GoalActivity" WHERE id = $1`, [ga!.id]);
    check('13a. no new GoalActivity was created by completion', beforeComplete[0].n === 1 && afterComplete[0].n === 1);
    const execRows = await sql(`SELECT * FROM "GoalActivityExecution" WHERE "goalActivityId" = $1`, [ga!.id]);
    check('13b. GoalActivityExecution records the durable completion truth', execRows.length === 1);
    const planAfterComplete = (await sql(`SELECT status FROM "PlannedActivity" WHERE id = $1`, [accepted1.plans[0].id]))[0];
    check('13c. PlannedActivity transitions to LOGGED (existing lifecycle semantics)', planAfterComplete.status === 'LOGGED');
    const occAfterComplete = (await sql(`SELECT id FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [ga!.id]))[0];
    check('13d. GoalActivityOccurrence identity remains durable (same row, unchanged id)', occAfterComplete.id === occRow1.id);
    await durableState('PHASE 7 AFTER COMPLETE', ga!.id);

    console.log('=== PHASE 8/14: RECONSIDER ===');
    const elig8 = await eligibility(TUE);
    check('14a. remainingThisWeek = 2 after first completion (1 completed, 0 committed, target 3)', elig8.status === 'OK' && elig8.candidates.find((c) => c.goalActivityId === ga!.id)?.remainingThisWeek === 2);
    const discovery8 = await eligibility(TUE);
    check('14b. CENTRAL CLOSURE INVARIANT: completion of one occurrence does NOT terminate the ongoing GoalActivity -- it becomes eligible again', discovery8.status === 'OK' && discovery8.candidates.some((c) => c.goalActivityId === ga!.id));
    const suggestions8 = await autoSuggestions(TUE, []);
    check('14c. Plan Day bootstrap can surface it again', suggestions8.status === 'OK' && suggestions8.suggestions.some((s) => s.goalActivityId === ga!.id));

    console.log('=== PHASE 15: SECOND OCCURRENCE IDENTITY (next planning date) ===');
    const intentId2 = encodeGoalDemandIntentId(WED, ga!.id);
    check('15a. second planning-date intent id differs from the first', intentId2 !== intentId1);
    check('15b. both map to the same GoalActivity definition (same goalActivityId component)', intentId1.endsWith(ga!.id) && intentId2.endsWith(ga!.id));
    const row2 = createIntentRowFromAutoGoalSuggestion({ title: 'Meditate 10 minutes', activityId: 'meditation', goalActivityId: ga!.id }, intentId2);
    const nowP2 = iso(`${TUE}T20:00:00Z`); // late on the 6th local, planning for the 7th (Tomorrow) -- still no wall-clock dependency
    const pv2 = await preview(nowP2, WED, [{ id: row2.id, title: row2.title, flexibility: row2.timeMode, activityId: row2.activityId }]);
    check('23a. Tomorrow (the next fixture day) preview succeeds using the supplied canonical planning date, never the wall clock', !!pv2 && pv2.constructedDay.proposedItems.some((item: { intentId: string }) => item.intentId === intentId2));
    const acceptBody2 = JSON.parse(JSON.stringify(buildAcceptRequestBody(pv2!, `a35-fixed-${n++}`)));
    const accepted2 = await accept(acceptBody2);
    check('9e. second occurrence (Tomorrow) accepted successfully', accepted2.status === 'SAVED');
    const occCountAfter2 = (await sql(`SELECT count(*)::int n FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [ga!.id]))[0].n;
    check('37/38. no duplicate occurrence path: exactly TWO occurrences now exist (one per real completed+committed cycle), never more', occCountAfter2 === 2);
    await logPlannedActivity(user.id, accepted2.plans[0].id);
    await durableState('PHASE 8 SECOND OCCURRENCE COMPLETE', ga!.id);

    console.log('=== PHASE 16: WEEKLY CAPACITY EXHAUSTION ===');
    // A THIRD distinct day within the SAME Monday-start week (anchor Monday
    // .. anchor Sunday) -- deliberately NOT the Wednesday again, which would
    // collide with Phase 15's own intentId for the identical
    // (planningLocalDate, goalActivityId) pair and conflate two separate
    // planning sessions under one identity.
    const nowP3 = iso(`${THU}T02:00:00Z`);
    const intentId3 = encodeGoalDemandIntentId(THU, ga!.id);
    const pv3 = await preview(nowP3, THU, [{ id: intentId3, title: 'Meditate 10 minutes', flexibility: 'FLEXIBLE', activityId: 'meditation' }]);
    const acceptBody3 = JSON.parse(JSON.stringify(buildAcceptRequestBody(pv3!, `a35-fixed-${n++}`)));
    const accepted3 = await accept(acceptBody3);
    check('9f. third occurrence (completing the week\'s full target of 3) accepted successfully', accepted3.status === 'SAVED');
    await logPlannedActivity(user.id, accepted3.plans[0].id);
    check('16a. remainingThisWeek = 0 after all 3 target occurrences are completed', (await rhythmRemaining(ga!.id, 3, TUE)) === 0);
    const discovery16 = await eligibility(TUE);
    check('16b. automatic Goal-demand discovery does NOT return the exhausted activity', discovery16.status === 'OK' && !discovery16.candidates.some((c) => c.goalActivityId === ga!.id));
    const suggestions16 = await autoSuggestions(TUE, []);
    check('16c. Plan Day bootstrap does NOT surface the exhausted activity', suggestions16.status === 'OK' && !suggestions16.suggestions.some((s) => s.goalActivityId === ga!.id));
    await durableState('PHASE CAPACITY EXHAUSTION', ga!.id);

    console.log('=== PHASE 17: NEXT-WEEK RESET ===');
    // The fixture Tuesday / Wednesday / Thursday fall in the Monday-start week anchored at ANCHOR_MONDAY;
    // the following Monday is a genuinely new Rhythm week,
    // reached purely by supplying a different planningLocalDate, never by
    // advancing any clock.
    const elig17 = await loadEligibleGoalDemand(createRealGoalDemandCandidatesDeps(), user.id, NEXT_MON, TZ);
    check('17a. prior-week completions create no debt -- remainingThisWeek resets to the full target (3) next week', elig17.status === 'OK' && elig17.candidates.find((c) => c.goalActivityId === ga!.id)?.remainingThisWeek === 3);
    const suggestions17 = await resolveAutomaticGoalDemand({ getSessionToken: () => 'tok', verifySession: () => ({ userId: user.id }), ...createRealGoalDemandCandidatesDeps() }, NEXT_MON, TZ, []);
    check('17b. automatic Goal-demand discovery can surface it again next week', suggestions17.status === 'OK' && suggestions17.suggestions.some((s) => s.goalActivityId === ga!.id));
    // The week boundary, immediately BEFORE / AT / AFTER (the AT case is 17a / 17b above: the next Monday): the Sunday of the same Monday-start week is still the exhausted
    // week; the Tuesday of the next week is a fresh week. The anchor guarantees these weekdays on every run date.
    const eligSunday = await eligibility(SUN);
    check('17c. BEFORE the boundary (the Sunday of the same Monday-start week) the target is still exhausted: remainingThisWeek = 0 and the activity is not surfaced', (await rhythmRemaining(ga!.id, 3, SUN)) === 0 && eligSunday.status === 'OK' && !eligSunday.candidates.some((c) => c.goalActivityId === ga!.id));
    const eligNextTue = await eligibility(NEXT_TUE);
    check('17d. AFTER the boundary (the Tuesday of the next week) the full target is available again', (await rhythmRemaining(ga!.id, 3, NEXT_TUE)) === 3 && eligNextTue.status === 'OK' && eligNextTue.candidates.find((c) => c.goalActivityId === ga!.id)?.remainingThisWeek === 3);

    // ============================================================
    // PHASE 18: DECLINE / REMOVE -- a fresh sibling GoalActivity so this
    // scenario is independent of the exhausted one above.
    // ============================================================
    console.log('=== PHASE 18: DECLINE / REMOVE PATH ===');
    const gaDecline = await addGoalActivity(user.id, goal.id, { title: 'Stretch', activityId: null });
    await setRhythm(gaDecline!.id, 2);
    const declineIntentId = encodeGoalDemandIntentId(TUE, gaDecline!.id);
    const declineRow = createIntentRowFromAutoGoalSuggestion({ title: 'Stretch', activityId: null, goalActivityId: gaDecline!.id }, declineIntentId);
    const declineRhythmFacts = { targetPerWeek: 2, completedThisWeek: 0, committedThisWeek: 0, remainingOccurrences: 2 };
    const availableBeforeRemove = deriveAvailableAutoGoalSuggestions([{ goalActivityId: gaDecline!.id, goalId: goal.id, goalTitle: 'Reduce stress', title: 'Stretch', activityId: null, remainingThisWeek: 2, rhythm: declineRhythmFacts }], [declineRow]);
    check('18a. while included, the suggestion is unavailable', availableBeforeRemove.length === 0);
    const availableAfterRemove = deriveAvailableAutoGoalSuggestions([{ goalActivityId: gaDecline!.id, goalId: goal.id, goalTitle: 'Reduce stress', title: 'Stretch', activityId: null, remainingThisWeek: 2, rhythm: declineRhythmFacts }], []); // row removed
    check('18b. removing the row (simulated by omitting it) returns the suggestion to the available list', availableAfterRemove.some((s) => s.goalActivityId === gaDecline!.id));
    const declineState = await sql(
      `SELECT (SELECT count(*)::int FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1) AS occ, (SELECT count(*)::int FROM "GoalActivityExecution" WHERE "goalActivityId" = $1) AS exec`,
      [gaDecline!.id]
    );
    check('18c. decline/remove before Preview/accept causes zero Goal writes', declineState[0].occ === 0 && declineState[0].exec === 0);
    const gaDeclineRow = (await listGoalActivitiesWithLinkedPlanStatus(user.id, goal.id)).find((r) => r.id === gaDecline!.id)!;
    check('18d. no DISMISSED, no SKIPPED -- the GoalActivity remains SUGGESTED', gaDeclineRow.status === 'SUGGESTED');

    // ============================================================
    // PHASE 19: PREVIEW WITHOUT ACCEPT
    // ============================================================
    console.log('=== PHASE 19: PREVIEW WITHOUT ACCEPT ===');
    const gaNoAccept = await addGoalActivity(user.id, goal.id, { title: 'Journal', activityId: null });
    await setRhythm(gaNoAccept!.id, 2);
    const noAcceptIntentId = encodeGoalDemandIntentId(TUE, gaNoAccept!.id);
    const pvNoAccept = await preview(nowP1, TUE, [{ id: noAcceptIntentId, title: 'Journal', flexibility: 'FLEXIBLE' }]);
    check('19 setup: preview succeeds', !!pvNoAccept);
    const stateBeforeNoAccept = await sql(
      `SELECT (SELECT count(*)::int FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1) AS occ, (SELECT count(*)::int FROM "GoalActivityExecution" WHERE "goalActivityId" = $1) AS exec, (SELECT count(*)::int FROM "PlannedActivity" WHERE "userId" = $2) AS plans`,
      [gaNoAccept!.id, user.id]
    );
    const eligNoAccept = await eligibility(TUE);
    check(
      '19a. user never accepting: zero GoalActivityOccurrence/GoalActivityExecution, no committed PlannedActivity, no weekly capacity consumed',
      stateBeforeNoAccept[0].occ === 0 && stateBeforeNoAccept[0].exec === 0 && eligNoAccept.status === 'OK' && eligNoAccept.candidates.find((c) => c.goalActivityId === gaNoAccept!.id)?.remainingThisWeek === 2
    );

    // ============================================================
    // PHASE 20: ACCEPTANCE FAILURE (A3.4 conflicting link)
    // ============================================================
    console.log('=== PHASE 20: ACCEPTANCE FAILURE (conflicting provenance) ===');
    const gaFail = await addGoalActivity(user.id, goal.id, { title: 'Breathing exercise', activityId: null });
    await setRhythm(gaFail!.id, 2);
    const gaFailDecoy = await addGoalActivity(user.id, goal.id, { title: 'Decoy', activityId: null });
    await setRhythm(gaFailDecoy!.id, 2);
    const failIntentId = encodeGoalDemandIntentId(TUE, gaFail!.id);
    const pvFail = await preview(nowP1, TUE, [{ id: failIntentId, title: 'Breathing exercise', flexibility: 'FLEXIBLE' }]);
    const conflictingLink: GoalActivityLink[] = [{ intentId: failIntentId, goalActivityId: gaFailDecoy!.id }];
    const acceptBodyFail = JSON.parse(JSON.stringify(buildAcceptRequestBody(pvFail!, `a35-fixed-${n++}`, conflictingLink)));
    const acceptedFail = await accept(acceptBodyFail);
    check('20a. acceptance with a conflicting client GoalActivity link is rejected', acceptedFail.status === 'REJECTED');
    const stateAfterFail = await sql(`SELECT count(*)::int n FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [gaFail!.id]);
    check('20b. zero Goal persistence from the rejected acceptance', stateAfterFail[0].n === 0);
    const eligAfterFail = await eligibility(TUE);
    check('20c. the original GoalActivity remains eligible -- failed acceptance did not consume recurring demand', eligAfterFail.status === 'OK' && eligAfterFail.candidates.find((c) => c.goalActivityId === gaFail!.id)?.remainingThisWeek === 2);

    // ============================================================
    // PHASE 21: MULTIPLE GOALS
    // ============================================================
    console.log('=== PHASE 21: MULTIPLE GOALS ===');
    const { goal: goal2 } = await createGoalWithActivities({ userId: user.id, title: 'Read more', targetDate: null, activities: [] });
    const ga2 = await addGoalActivity(user.id, goal2.id, { title: 'Read 20 pages', activityId: null });
    await setRhythm(ga2!.id, 2);
    const multiElig = await eligibility(TUE);
    check('21a. both GoalActivities from different Goals are discoverable together', multiElig.status === 'OK' && multiElig.candidates.some((c) => c.goalActivityId === gaFail!.id) && multiElig.candidates.some((c) => c.goalActivityId === ga2!.id));
    const ga2IntentId = encodeGoalDemandIntentId(TUE, ga2!.id);
    const pvGa2 = await preview(nowP1, TUE, [{ id: ga2IntentId, title: 'Read 20 pages', flexibility: 'FLEXIBLE' }]);
    const acceptedGa2 = await accept(JSON.parse(JSON.stringify(buildAcceptRequestBody(pvGa2!, `a35-fixed-${n++}`))));
    check('21b. accepting one GoalActivity succeeds independently', acceptedGa2.status === 'SAVED');
    const eligAfterGa2 = await eligibility(TUE);
    check(
      '21c. accepting ga2 consumed only its OWN Rhythm facts -- the other GoalActivity (gaFail) remains independently eligible at its own prior value',
      (await rhythmRemaining(ga2!.id, 2, TUE)) === 1 && eligAfterGa2.status === 'OK' && eligAfterGa2.candidates.find((c) => c.goalActivityId === gaFail!.id)?.remainingThisWeek === 2
    );

    // ============================================================
    // PHASE 22: MANUAL GOAL REGRESSION
    // ============================================================
    console.log('=== PHASE 22: MANUAL GOAL REGRESSION ===');
    const gaManual = await addGoalActivity(user.id, goal.id, { title: 'Manually planned walk', activityId: null }); // Rhythm NONE -- finite, manual-only
    const manualHandoff = await resolveGoalActivityHandoff(
      { getSessionToken: () => 'tok', verifySession: () => ({ userId: user.id }), listGoalActivities: (uid, gid) => listGoalActivitiesWithLinkedPlanStatus(uid, gid) },
      goal.id,
      gaManual!.id
    );
    check('22a. the manual Goal Detail -> Plan with Aura handoff still resolves the activity', manualHandoff.length === 1 && manualHandoff[0].id === gaManual!.id);
    const manualRow = createIntentRowFromGoalActivity({ id: gaManual!.id, title: gaManual!.title, activityId: gaManual!.activityId });
    check('22b. manual Goal row identity is unchanged (plan-day-goal-<id>)', manualRow.id === `plan-day-goal-${gaManual!.id}`);
    const pvManual = await preview(nowP1, TUE, [{ id: manualRow.id, title: manualRow.title, flexibility: 'FLEXIBLE' }]);
    const manualLink: GoalActivityLink[] = [{ intentId: manualRow.id, goalActivityId: gaManual!.id }];
    const acceptedManual = await accept(JSON.parse(JSON.stringify(buildAcceptRequestBody(pvManual!, `a35-fixed-${n++}`, manualLink))));
    check('22c. manual Goal acceptance still succeeds through its existing, unchanged path', acceptedManual.status === 'SAVED');
    const manualGaRow = (await listGoalActivitiesWithLinkedPlanStatus(user.id, goal.id)).find((r) => r.id === gaManual!.id)!;
    check('22d. manual Goal persistence behavior (legacy link, finite Rhythm NONE) is unchanged', manualGaRow.plannedActivityId === acceptedManual.plans[0].id);

    // ============================================================
    // PHASE 24: MOVE / RECOMPOSITION CONTINUITY
    // ============================================================
    console.log('=== PHASE 24: MOVE/RECOMPOSITION CONTINUITY ===');
    const occBeforeMove = (await sql(`SELECT id FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [ga2!.id]))[0];
    // The destination is derived from the fixture's own state -- the first whole hour at least one hour after the user's LATEST plan -- never a hard-coded clock time:
    // the timing search places plans at date-dependent times, so a fixed destination collides with another plan on some calendar dates.
    const latestEnd = (await sql(`SELECT max("plannedEndAt") AS t FROM "PlannedActivity" WHERE "userId" = $1`, [user.id]))[0].t as Date;
    const moveDestination = new Date(Math.ceil(latestEnd.getTime() / 3600000) * 3600000 + 3600000);
    const moved = await movePlannedActivity(user.id, acceptedGa2.plans[0].id, { newStartAt: moveDestination });
    const occAfterMove = (await sql(`SELECT id, "plannedActivityId" FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [ga2!.id]))[0];
    check('24a. the SAME occurrence id persists across the Move', occAfterMove.id === occBeforeMove.id);
    check('24b. the occurrence now points to the successor (moved) plan', occAfterMove.plannedActivityId === moved.to.id);

    if (!allPassed) {
      console.error('SOME AUTOMATIC GOAL LIFECYCLE CLOSURE CHECKS FAILED');
      process.exit(1);
    }
    console.log('ALL AUTOMATIC GOAL LIFECYCLE CLOSURE CHECKS PASSED');
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
