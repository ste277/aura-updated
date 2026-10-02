/**
 * Goals V2 Candidate B5 -- COMPOSED LIFECYCLE CLOSURE.
 *
 * Not a feature test. Proves the already-shipped B1->B2->B3->B3.1->Rhythm
 * ->Candidate A chain composes as ONE real system, end to end, through
 * real production boundaries (never reimplemented/mocked):
 *
 *   B1   matchGoalTemplateCategory (goals.ts)
 *   ->   resolveGoalTemplateActivities (goals.ts)
 *   B2   createInitialProposalState / reconcileProposalForTitleChange /
 *        removeProposalRow / renameProposalRow / updateProposalRowRhythm /
 *        addFreeformProposalRow / selectManualCategory (goalActivityProposal.ts)
 *   ->   buildReviewedActivitiesForSubmission (goalActivityProposal.ts)
 *   B3   real POST /api/goals route handler (route.ts) -> createGoalWithActivities (db.ts)
 *   B3.1 clientRequestId -> deriveIdempotentGoalId (goalCreateIdempotency.ts)
 *   A1   loadEligibleGoalDemand (goalDemandCandidates.ts)
 *   A3.2 resolveAutomaticGoalDemand (planDayBootstrap.ts)
 *   A3.3 createIntentRowFromAutoGoalSuggestion / encodeGoalDemandIntentId
 *   ->   real Preview (handleDayConstructorPreviewRequest) -> real Accept
 *        route (accept/route.ts) -> A3.4 authorizeGoalActivityLinks
 *        -> materializeGoalActivityRhythmOccurrence (db.ts)
 *   ->   real logPlannedActivity completion (db.ts, writes GoalActivityExecution)
 *   ->   A1's own eligibility recomputation for resurfacing/exhaustion/reset.
 *
 * Reuses test/automaticGoalLifecycleClosureDb.test.ts's own established
 * preview/accept helper pattern verbatim for the acceptance->completion->
 * resurfacing->exhaustion->reset leg (this ticket's own section 34: do not
 * duplicate A3.5, compose with it). The NOVEL B5 proof is everything
 * upstream of that: a GoalActivity that B1/B2/B3/B3.1 actually produced
 * (reviewed, renamed, partially removed, Rhythm-configured) can enter
 * that existing lifecycle at all, and that the discarded/renamed/freeform
 * review decisions survive intact all the way through Candidate A
 * discovery and automatic bootstrap.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/goalDecompositionPlanningHandoffDb.test.ts
 */
import { randomUUID } from 'crypto';
import {
  upsertUserByEmail,
  updateBirthProfile,
  beginTransaction,
  logPlannedActivity,
  getUserById,
  loadGoalActivityRhythmFacts,
} from '../apps/web/lib/db';
import { computeGoalActivityRhythmEligibility } from '../apps/web/lib/goalActivityRhythm';
import { createSessionToken } from '../apps/web/lib/auth';
import { matchGoalTemplateCategory, resolveGoalTemplateActivities } from '../apps/web/lib/goals';
import {
  createInitialProposalState,
  reconcileProposalForTitleChange,
  removeProposalRow,
  renameProposalRow,
  updateProposalRowRhythm,
  addFreeformProposalRow,
  selectManualCategory,
  buildReviewedActivitiesForSubmission,
} from '../apps/web/lib/goalActivityProposal';
import { buildGoalDecompositionSummaryMetadata, createInitialObservabilityState, recordNewBaseline } from '../apps/web/lib/goalDecompositionObservability';
import { POST as createGoal } from '../apps/web/app/api/goals/route';
import { loadEligibleGoalDemand, createRealGoalDemandCandidatesDeps } from '../apps/web/lib/goalDemandCandidates';
import { resolveAutomaticGoalDemand } from '../apps/web/lib/planDayBootstrap';
import { createIntentRowFromAutoGoalSuggestion } from '../apps/web/lib/planDayEntry';
import { encodeGoalDemandIntentId } from '../apps/web/lib/goalDemandIntentId';
import { handleDayConstructorPreviewRequest } from '../apps/web/lib/dayConstructorPreviewRequest';
import { createRealDayConstructorOrchestratorDeps } from '../apps/web/lib/dayConstructorOrchestrator';
import { parsePreviewResponseBody } from '../apps/web/lib/dayConstructorPreviewClient';
import type { ConstructDayPreview } from '../apps/web/lib/dayConstructorOrchestrator';
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

function fakeRequest(cookie: string | undefined, jsonBody: unknown): any {
  return { cookies: { get: (name: string) => (cookie !== undefined && name === 'as_session' ? { value: cookie } : undefined) }, json: async () => jsonBody };
}
async function callCreateGoal(token: string | undefined, body: unknown): Promise<{ status: number; body: any }> {
  const res: any = await createGoal(fakeRequest(token, body));
  return { status: res.status, body: await res.json() };
}

function iso(s: string): Date {
  return new Date(s);
}

async function main() {
  const user = await upsertUserByEmail({ email: 'test-b5-composed-lifecycle@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await updateBirthProfile(user.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  const token = createSessionToken(user.id, user.email);

  const cleanup = async () => {
    await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [user.id]);
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [user.id]);
    await sql(`DELETE FROM "GoalActivity" WHERE "userId" = $1`, [user.id]);
    await sql(`DELETE FROM "Goal" WHERE "userId" = $1`, [user.id]);
  };
  await cleanup();

  // Real production helpers -- verbatim reuse of
  // automaticGoalLifecycleClosureDb.test.ts's own established pattern.
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
  const fakeAcceptReq = (body: unknown): any => ({ cookies: { get: () => ({ value: token }) }, json: async () => body, headers: new Headers() });
  const accept = async (body: unknown) => (await acceptRoute(fakeAcceptReq(body))).json();
  const eligibility = async (planningLocalDate: string) => loadEligibleGoalDemand(createRealGoalDemandCandidatesDeps(), user.id, planningLocalDate, TZ);
  const autoSuggestions = async (planningLocalDate: string) =>
    resolveAutomaticGoalDemand({ getSessionToken: () => 'tok', verifySession: () => ({ userId: user.id }), ...createRealGoalDemandCandidatesDeps() }, planningLocalDate, TZ, []);
  /** The canonical Rhythm eligibility arithmetic fed with real DB facts,
   * independent of loadEligibleGoalDemand's own SEPARATE structural
   * discovery-boundary filter -- which excludes a GoalActivity entirely
   * once remainingOccurrences reaches 0 (same A1 exclusion rule already
   * established in automaticGoalLifecycleClosureDb.test.ts), so the exact
   * remaining NUMBER at exhaustion must be read through this helper, not
   * through discovery's own candidate array. */
  const rhythmRemaining = async (goalActivityId: string, targetPerWeek: number, planningLocalDate: string) => {
    const facts = await loadGoalActivityRhythmFacts(user.id, goalActivityId, TZ);
    return computeGoalActivityRhythmEligibility({ rhythm: { kind: 'N_PER_WEEK', targetPerWeek }, planningLocalDate, occurrences: facts }).remainingOccurrences;
  };

  try {
    // ============================================================
    // PRIMARY SCENARIO: "Get fitter" -> B1 match -> B2 review (retain one
    // renamed+rhythmed, retain one untouched, REMOVE one) -> B3 create ->
    // B3.1 idempotent replay -> Candidate A discovery -> automatic
    // bootstrap -> planning preview -> no-auto-commit -> accept ->
    // complete -> weekly accounting -> resurfacing -> exhaustion ->
    // next-week reset.
    // ============================================================
    console.log('=== B1: MATCH ===');
    const category = matchGoalTemplateCategory('Get fitter');
    check('B1: "Get fitter" matches GET_FITTER via the real matcher', category === 'GET_FITTER');

    console.log('=== TEMPLATE RESOLUTION ===');
    const resolved = resolveGoalTemplateActivities(category!);
    check('template: resolves the canonical 3 GET_FITTER activities', resolved.length === 3 && resolved.some((a) => a.title === 'Go for a run') && resolved.some((a) => a.title === 'Strength training session') && resolved.some((a) => a.title === 'Stretch / mobility'));
    const originalRun = resolved.find((a) => a.title === 'Go for a run')!;

    console.log('=== B2: PROPOSAL + REVIEW ===');
    let proposal = createInitialProposalState();
    proposal = reconcileProposalForTitleChange(proposal, 'Get fitter');
    check('B2: reconciling the title produces the real template rows (never hardcoded)', proposal.rows.length === 3 && proposal.pristineAutoCategory === 'GET_FITTER');

    const strengthRow = proposal.rows.find((r) => r.title === 'Strength training session')!;
    const runRow = proposal.rows.find((r) => r.title === 'Go for a run')!;
    const stretchRow = proposal.rows.find((r) => r.title === 'Stretch / mobility')!;

    // Remove "Strength training session" entirely -- this is the row that
    // must NEVER reappear anywhere downstream (section 21/34).
    proposal = removeProposalRow(proposal, strengthRow.localId);
    // Rename "Go for a run" -> "Morning cardio", keeping its activityId.
    proposal = renameProposalRow(proposal, runRow.localId, 'Morning cardio');
    // Configure a recurring Rhythm on the renamed, retained row.
    proposal = updateProposalRowRhythm(proposal, runRow.localId, { kind: 'N_PER_WEEK', targetPerWeek: 3 });
    // Leave "Stretch / mobility" untouched (default Rhythm NONE).
    check('B2 review: exactly 2 rows remain (one removed)', proposal.rows.length === 2);
    check('B2 review: renamed row keeps the ORIGINAL activityId (never rematched from the new title)', proposal.rows.find((r) => r.title === 'Morning cardio')?.activityId === originalRun.activityId);

    console.log('=== B2 SUBMISSION MAPPING ===');
    const reviewedActivities = buildReviewedActivitiesForSubmission(proposal.rows);
    check('B2 mapping: exactly 2 submission rows, "Strength training session" absent', reviewedActivities.length === 2 && !reviewedActivities.some((a) => a.title === 'Strength training session'));
    check('B2 mapping: renamed+rhythmed row carries the exact reviewed shape', reviewedActivities.some((a) => a.title === 'Morning cardio' && a.activityId === originalRun.activityId && a.rhythm.kind === 'N_PER_WEEK' && a.rhythm.targetPerWeek === 3));
    check('B2 mapping: untouched row defaults to Rhythm NONE', reviewedActivities.find((a) => a.title === 'Stretch / mobility')?.rhythm.kind === 'NONE');

    console.log('=== B3 + B3.1: REAL GOAL CREATION (idempotent) ===');
    const clientRequestId = randomUUID();
    const createResult = await callCreateGoal(token, { title: 'Get fitter', activities: reviewedActivities, clientRequestId });
    check('B3: Goal created via the real route handler', !!createResult.body?.goal?.id);
    check('B3: exactly the 2 reviewed activities persisted', createResult.body.activities.length === 2);
    check('B3: removed row never persisted', !createResult.body.activities.some((a: any) => a.title === 'Strength training session'));
    const cardioRow = createResult.body.activities.find((a: any) => a.title === 'Morning cardio');
    check('B3: renamed title persisted verbatim', !!cardioRow);
    check('B3: original activityId preserved through persistence', cardioRow.activityId === originalRun.activityId);
    check('B3: completionRequirement preserved (GET_FITTER rows carry none -> DONE)', cardioRow.completionKind === null);
    check('B3: Rhythm preserved through persistence', cardioRow.rhythmKind === 'N_PER_WEEK' && cardioRow.rhythmTargetPerWeek === 3);
    const goalId = createResult.body.goal.id as string;
    const cardioActivityId = cardioRow.id as string;

    console.log('=== B3.1: IDEMPOTENT REPLAY OF THE SAME COMPOSED PAYLOAD ===');
    const replayResult = await callCreateGoal(token, { title: 'Get fitter', activities: buildReviewedActivitiesForSubmission(proposal.rows), clientRequestId });
    check('B3.1: replay returns the SAME Goal id', replayResult.body.goal.id === goalId);
    check('B3.1: replay returns the same 2 activities (no duplicates)', replayResult.body.activities.length === 2);
    const totalGoalsAfterReplay = (await sql(`SELECT count(*)::int n FROM "Goal" WHERE "userId" = $1`, [user.id]))[0].n;
    check('B3.1: exactly one Goal exists after the replay', totalGoalsAfterReplay === 1);
    const totalActivitiesAfterReplay = (await sql(`SELECT count(*)::int n FROM "GoalActivity" WHERE "goalId" = $1`, [goalId]))[0].n;
    check('B3.1: exactly 2 GoalActivity rows exist after the replay (no duplicates)', totalActivitiesAfterReplay === 2);

    console.log('=== IDEMPOTENCY CONFLICT (same clientRequestId, different payload) ===');
    const conflictResult = await callCreateGoal(token, { title: 'Get fitter', activities: [{ title: 'Something else entirely', activityId: null, rhythm: { kind: 'NONE' } }], clientRequestId });
    check('idempotency conflict: 409 IDEMPOTENCY_CONFLICT for a mismatched replay', conflictResult.status === 409 && conflictResult.body?.code === 'IDEMPOTENCY_CONFLICT');
    const goalAfterConflict = (await sql(`SELECT title FROM "Goal" WHERE id = $1`, [goalId]))[0];
    check('idempotency conflict: the original Goal is unchanged', goalAfterConflict.title === 'Get fitter');
    const eligAfterConflict = await eligibility('2026-10-06');
    check(
      'idempotency conflict: Candidate A still only sees the original approved activities (never "Something else entirely")',
      eligAfterConflict.status === 'OK' && eligAfterConflict.candidates.some((c) => c.goalActivityId === cardioActivityId) && !eligAfterConflict.candidates.some((c) => c.title === 'Something else entirely')
    );

    console.log('=== CANDIDATE A: DISCOVERY + PROVENANCE ===');
    const elig1 = await eligibility('2026-10-06');
    const elig1Candidates = elig1.status === 'OK' ? elig1.candidates : [];
    check('Candidate A: the recurring reviewed GoalActivity is discovered eligible', elig1Candidates.some((c) => c.goalActivityId === cardioActivityId && c.remainingThisWeek === 3));
    const cardioCandidate = elig1Candidates.find((c) => c.goalActivityId === cardioActivityId);
    check('provenance: discovered candidate carries the real goalId linkage', cardioCandidate?.goalId === goalId);
    check('provenance: discovered candidate carries the renamed title, not the original template title', cardioCandidate?.title === 'Morning cardio');
    check('provenance: discovered candidate carries the ORIGINAL canonical activityId (renaming the title did not destroy semantic provenance)', cardioCandidate?.activityId === originalRun.activityId);
    check('Rhythm semantics: the untouched Stretch/mobility row (Rhythm NONE) never becomes eligible demand', !elig1Candidates.some((c) => c.title === 'Stretch / mobility'));
    check('approved-vs-discarded: the removed "Strength training session" suggestion is never discovered (it was never persisted)', !elig1Candidates.some((c) => c.title === 'Strength training session'));

    console.log('=== AUTOMATIC BOOTSTRAP (no manual Goal Detail round-trip) ===');
    const boot1 = await autoSuggestions('2026-10-06');
    check('bootstrap: the GoalActivity enters the planning candidate flow automatically', boot1.status === 'OK' && boot1.suggestions.some((s) => s.goalActivityId === cardioActivityId));
    check('bootstrap: discarded/removed template row never surfaces', !(boot1.status === 'OK' && boot1.suggestions.some((s) => s.title === 'Strength training session')));

    console.log('=== NO AUTO-COMMIT ===');
    const preAccept = await sql(
      `SELECT (SELECT count(*)::int FROM "PlannedActivity" WHERE "userId" = $1) AS plans, (SELECT count(*)::int FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $2) AS occ, (SELECT count(*)::int FROM "GoalActivityExecution" WHERE "goalActivityId" = $2) AS exec`,
      [user.id, cardioActivityId]
    );
    check('no-auto-commit: zero PlannedActivity/GoalActivityOccurrence/GoalActivityExecution exist merely from discovery+bootstrap', preAccept[0].plans === 0 && preAccept[0].occ === 0 && preAccept[0].exec === 0);

    console.log('=== PLANNING SURFACE: PREVIEW ===');
    const intentId1 = encodeGoalDemandIntentId('2026-10-06', cardioActivityId);
    const row1 = createIntentRowFromAutoGoalSuggestion({ title: cardioCandidate!.title, activityId: cardioCandidate!.activityId, goalActivityId: cardioActivityId }, intentId1);
    const nowP1 = iso('2026-10-06T02:00:00Z');
    const pv1 = await preview(nowP1, '2026-10-06', [{ id: row1.id, title: row1.title, flexibility: row1.timeMode, activityId: row1.activityId }]);
    check('planning surface: the Goal-derived candidate is proposed by the real Constructor', !!pv1 && pv1.constructedDay.proposedItems.some((item: { intentId: string }) => item.intentId === intentId1));

    console.log('=== ACCEPTANCE ===');
    const acceptBody1 = JSON.parse(JSON.stringify(buildAcceptRequestBody(pv1!, `b5-${Date.now()}-${n++}`)));
    const accepted1 = await accept(acceptBody1);
    check('acceptance: succeeds via verified server-derived provenance', accepted1.status === 'SAVED');
    const postAccept = await sql(`SELECT count(*)::int n FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [cardioActivityId]);
    check('acceptance: exactly one GoalActivityOccurrence created', postAccept[0].n === 1);

    console.log('=== COMPLETION ===');
    await logPlannedActivity(user.id, accepted1.plans[0].id);
    const execRows = await sql(`SELECT count(*)::int n FROM "GoalActivityExecution" WHERE "goalActivityId" = $1`, [cardioActivityId]);
    check('completion: GoalActivityExecution becomes the durable completion truth', execRows[0].n === 1);
    const planStatus = (await sql(`SELECT status FROM "PlannedActivity" WHERE id = $1`, [accepted1.plans[0].id]))[0];
    check('completion: PlannedActivity transitions to LOGGED', planStatus.status === 'LOGGED');

    console.log('=== WEEKLY ACCOUNTING + RESURFACING ===');
    const elig2 = await eligibility('2026-10-06');
    check('weekly accounting: remainingThisWeek decreases 3 -> 2 after one completion', elig2.status === 'OK' && elig2.candidates.find((c) => c.goalActivityId === cardioActivityId)?.remainingThisWeek === 2);
    check('resurfacing: the activity is eligible again immediately (not terminated by completion)', elig2.status === 'OK' && elig2.candidates.some((c) => c.goalActivityId === cardioActivityId));

    console.log('=== WEEKLY EXHAUSTION (2 more cycles within the same week) ===');
    for (const [targetDate, now] of [['2026-10-07', '2026-10-06T20:00:00Z'], ['2026-10-08', '2026-10-08T02:00:00Z']] as const) {
      const intentId = encodeGoalDemandIntentId(targetDate, cardioActivityId);
      const pv = await preview(iso(now), targetDate, [{ id: intentId, title: 'Morning cardio', flexibility: 'FLEXIBLE', activityId: cardioCandidate!.activityId }]);
      const acceptBody = JSON.parse(JSON.stringify(buildAcceptRequestBody(pv!, `b5-${Date.now()}-${n++}`)));
      const accepted = await accept(acceptBody);
      check(`exhaustion cycle (${targetDate}): accepted`, accepted.status === 'SAVED');
      await logPlannedActivity(user.id, accepted.plans[0].id);
    }
    check('exhaustion: canonical Rhythm eligibility remainingThisWeek = 0 after all 3 target occurrences are completed', (await rhythmRemaining(cardioActivityId, 3, '2026-10-06')) === 0);
    const elig3 = await eligibility('2026-10-06');
    check('exhaustion: discovery no longer surfaces the exhausted activity (A1\'s own zero-remaining structural exclusion)', elig3.status === 'OK' && !elig3.candidates.some((c) => c.goalActivityId === cardioActivityId));
    const boot3 = await autoSuggestions('2026-10-06');
    check('exhaustion: automatic bootstrap no longer surfaces the exhausted activity', boot3.status === 'OK' && !boot3.suggestions.some((s) => s.goalActivityId === cardioActivityId));

    console.log('=== NEXT-WEEK RESET ===');
    const elig4 = await eligibility('2026-10-12'); // following Monday-start week, no clock advance -- only the planning date argument changes
    check('next-week reset: remainingThisWeek resets to the full target (3) with no recurrence rows pre-generated', elig4.status === 'OK' && elig4.candidates.find((c) => c.goalActivityId === cardioActivityId)?.remainingThisWeek === 3);
    const boot4 = await autoSuggestions('2026-10-12');
    check('next-week reset: automatic bootstrap can surface it again next week', boot4.status === 'OK' && boot4.suggestions.some((s) => s.goalActivityId === cardioActivityId));

    console.log('=== B4 OBSERVATIONAL INDEPENDENCE ===');
    const finalGoalCountBeforeObs = (await sql(`SELECT count(*)::int n FROM "Goal" WHERE "userId" = $1`, [user.id]))[0].n;
    const obsState = recordNewBaseline(createInitialObservabilityState(), { activityCount: 3, isManualOverride: false, isScratch: false, isRefresh: false });
    const obsMetadata = buildGoalDecompositionSummaryMetadata(proposal, obsState);
    check('B4: the observability summary builder is callable on the real final proposal state and returns the expected matchSource', obsMetadata.matchSource === 'AUTO_MATCH' && obsMetadata.templateCategory === 'GET_FITTER');
    const finalGoalCountAfterObs = (await sql(`SELECT count(*)::int n FROM "Goal" WHERE "userId" = $1`, [user.id]))[0].n;
    check('B4: calling the observability builder is side-effect-free (Goal count unchanged, pure function)', finalGoalCountAfterObs === finalGoalCountBeforeObs);

    // ============================================================
    // SECONDARY SCENARIO 1: "Learn Spanish" -- no template match ->
    // freeform activity -> Candidate A fallback path is not a dead end.
    // ============================================================
    console.log('=== SECONDARY: UNKNOWN GOAL ("Learn Spanish") + FREEFORM ===');
    const unknownCategory = matchGoalTemplateCategory('Learn Spanish');
    check('B1: "Learn Spanish" has no deterministic match (never forced into an unrelated template)', unknownCategory === null);
    let spanishProposal = createInitialProposalState();
    spanishProposal = reconcileProposalForTitleChange(spanishProposal, 'Learn Spanish');
    check('B2: no automatic proposal was invented for an unmatched title', spanishProposal.rows.length === 0 && spanishProposal.pristineAutoCategory === null);
    spanishProposal = addFreeformProposalRow(spanishProposal);
    spanishProposal = renameProposalRow(spanishProposal, spanishProposal.rows[0].localId, 'Practice conversation daily');
    spanishProposal = updateProposalRowRhythm(spanishProposal, spanishProposal.rows[0].localId, { kind: 'N_PER_WEEK', targetPerWeek: 2 });
    const spanishActivities = buildReviewedActivitiesForSubmission(spanishProposal.rows);
    check('freeform: activityId is null (never inferred from the freeform title)', spanishActivities[0].activityId === null);
    const spanishCreate = await callCreateGoal(token, { title: 'Learn Spanish', activities: spanishActivities, clientRequestId: randomUUID() });
    check('B3: Learn Spanish Goal created with exactly one freeform GoalActivity', spanishCreate.body.activities.length === 1 && spanishCreate.body.activities[0].activityId === null);
    const spanishActivityId = spanishCreate.body.activities[0].id as string;
    const eligSpanish = await eligibility('2026-10-06');
    check('Candidate A: an eligible recurring FREEFORM GoalActivity participates in discovery exactly like a template-backed one', eligSpanish.status === 'OK' && eligSpanish.candidates.some((c) => c.goalActivityId === spanishActivityId && c.remainingThisWeek === 2 && c.activityId === null));

    // ============================================================
    // SECONDARY SCENARIO 2: matching title -> explicit "Start from
    // scratch" -> the discarded automatic template never reappears.
    // ============================================================
    console.log('=== SECONDARY: START FROM SCRATCH ===');
    let scratchProposal = createInitialProposalState();
    scratchProposal = reconcileProposalForTitleChange(scratchProposal, 'Get fitter');
    check('scratch setup: the title still auto-matches GET_FITTER before the user overrides it', scratchProposal.pristineAutoCategory === 'GET_FITTER' && scratchProposal.rows.length === 3);
    scratchProposal = selectManualCategory(scratchProposal, null); // explicit "Start from scratch"
    check('scratch: explicit null choice clears the proposal entirely', scratchProposal.isManualCategory === true && scratchProposal.rows.length === 0);
    scratchProposal = addFreeformProposalRow(scratchProposal);
    scratchProposal = renameProposalRow(scratchProposal, scratchProposal.rows[0].localId, 'Walk the dog daily');
    scratchProposal = updateProposalRowRhythm(scratchProposal, scratchProposal.rows[0].localId, { kind: 'N_PER_WEEK', targetPerWeek: 5 });
    const scratchActivities = buildReviewedActivitiesForSubmission(scratchProposal.rows);
    const scratchCreate = await callCreateGoal(token, { title: 'Get fitter (take two)', activities: scratchActivities, clientRequestId: randomUUID() });
    const scratchGoalId = scratchCreate.body.goal.id as string;
    check('B3: scratch Goal created with exactly the one approved freeform activity', scratchCreate.body.activities.length === 1 && scratchCreate.body.activities[0].title === 'Walk the dog daily');
    const scratchDiscardedRows = (await sql(`SELECT count(*)::int n FROM "GoalActivity" WHERE "goalId" = $1 AND title IN ('Go for a run', 'Strength training session', 'Stretch / mobility')`, [scratchGoalId]))[0].n;
    check('scratch: the auto-matched template rows the user discarded were never persisted for this Goal', scratchDiscardedRows === 0);

    // ============================================================
    // MULTIPLE GOALS -- all 3 Goals created above are discoverable
    // together, without interference.
    // ============================================================
    console.log('=== MULTIPLE GOALS ===');
    const eligAll = await eligibility('2026-10-06');
    const eligAllCandidates = eligAll.status === 'OK' ? eligAll.candidates : [];
    const distinctGoalIds = new Set(eligAllCandidates.map((c) => c.goalId));
    check('multiple goals: discovery surfaces eligible activities from more than one Goal at once, without interference', eligAll.status === 'OK' && distinctGoalIds.size >= 2 && eligAllCandidates.some((c) => c.goalActivityId === spanishActivityId));

    if (!allPassed) {
      console.error('SOME GOAL DECOMPOSITION PLANNING HANDOFF CHECKS FAILED');
      process.exit(1);
    }
    console.log('ALL GOAL DECOMPOSITION PLANNING HANDOFF CHECKS PASSED');
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
