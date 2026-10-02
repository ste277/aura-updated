/**
 * Goals V2 Candidate B4 -- pure tests for the Goal decomposition
 * observability helpers (apps/web/lib/goalDecompositionObservability.ts).
 * No DB, no network, no React rendering harness -- same convention as
 * goalActivityProposal.test.ts (testing the pure logic a component wires
 * up, not a DOM simulation). GoalsListClient.tsx is the one consumer;
 * structural proof that it actually wires these correctly lives in
 * test/goalsUiWiring.test.ts.
 */
import {
  createInitialObservabilityState,
  recordNewBaseline,
  recordRowRemoved,
  recordRowRenamed,
  recordFreeformRowAdded,
  recordRhythmChanged,
  buildDecompositionShownMetadata,
  buildGoalDecompositionSummaryMetadata,
  classifyGoalCreateError,
} from '../apps/web/lib/goalDecompositionObservability';
import { createInitialProposalState, reconcileProposalForTitleChange, selectManualCategory, refreshProposalFromEffectiveCategory, removeProposalRow, renameProposalRow, addFreeformProposalRow, updateProposalRowRhythm } from '../apps/web/lib/goalActivityProposal';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// PRIVACY (this ticket's own section 25 -- mandatory). Structural proof
// that none of these shapes can carry free text, independent of code
// review: every value TypeScript allows through is a closed string
// literal, a number, or a boolean -- there is no field anywhere typed to
// accept arbitrary text.
// ============================================================
{
  const shown = buildDecompositionShownMetadata('AUTO_MATCH', 'GET_FITTER', 3);
  const allowedKeys = new Set(['source', 'templateCategory', 'activityCount']);
  check('privacy: GOAL_DECOMPOSITION_SHOWN metadata has exactly the allowed keys, nothing else', Object.keys(shown).every((k) => allowedKeys.has(k)) && Object.keys(shown).length === 3);
  check('privacy: no key or value resembles a Goal/activity title', !Object.values(shown).some((v) => typeof v === 'string' && v.length > 20));
}
{
  let proposal = createInitialProposalState();
  proposal = reconcileProposalForTitleChange(proposal, 'Get fitter');
  const observability = recordNewBaseline(createInitialObservabilityState(), { activityCount: proposal.rows.length, isManualOverride: false, isScratch: false, isRefresh: false });
  const confirmed = buildGoalDecompositionSummaryMetadata(proposal, observability);
  const allowedKeys = new Set(['matchSource', 'templateCategory', 'initialActivityCount', 'finalActivityCount', 'templateBackedCount', 'freeformCount', 'wasEdited', 'removedCount', 'renamedCount', 'addedCount', 'rhythmChanged', 'manualOverrideUsed', 'scratchUsed', 'refreshUsed']);
  check('privacy: GOAL_DECOMPOSITION_CONFIRMED metadata has only allowed keys', Object.keys(confirmed).every((k) => allowedKeys.has(k)));
  check('privacy: no activity title ("Go for a run" etc.) appears anywhere in the confirmed metadata', !Object.values(confirmed).some((v) => typeof v === 'string' && (v === 'Go for a run' || v === 'Strength training session' || v === 'Stretch / mobility')));
  check('privacy: no clientRequestId-shaped value (a UUID) appears anywhere in the confirmed metadata', !Object.values(confirmed).some((v) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)));
  check('privacy: every value is a string enum, a number, or a boolean -- never a free-text-shaped string (no spaces)', Object.values(confirmed).every((v) => typeof v !== 'string' || !v.includes(' ')));
}
{
  const category = classifyGoalCreateError(400, null);
  check('privacy: classifyGoalCreateError returns a bounded category, never an error message', ['VALIDATION', 'IDEMPOTENCY_CONFLICT', 'SERVER_ERROR', 'NETWORK_ERROR'].includes(category));
}

// ============================================================
// classifyGoalCreateError branch coverage -- each of the 4 distinct
// outcomes exercised with the exact expected category, not merely
// "is a member of the bounded set" (review follow-up: the privacy check
// above never confirmed the mapping itself is correct per-branch).
// ============================================================
{
  check('classifyGoalCreateError: null status (thrown/network exception) -> NETWORK_ERROR', classifyGoalCreateError(null, null) === 'NETWORK_ERROR');
  check('classifyGoalCreateError: 409 with IDEMPOTENCY_CONFLICT code -> IDEMPOTENCY_CONFLICT (checked before the 4xx/5xx range split)', classifyGoalCreateError(409, 'IDEMPOTENCY_CONFLICT') === 'IDEMPOTENCY_CONFLICT');
  check('classifyGoalCreateError: 400 with no special code -> VALIDATION', classifyGoalCreateError(400, null) === 'VALIDATION');
  check('classifyGoalCreateError: 499 (top of 4xx range) -> VALIDATION', classifyGoalCreateError(499, null) === 'VALIDATION');
  check('classifyGoalCreateError: 500 -> SERVER_ERROR', classifyGoalCreateError(500, null) === 'SERVER_ERROR');
  check('classifyGoalCreateError: 503 with an unrecognized code -> SERVER_ERROR (unknown codes never get special treatment)', classifyGoalCreateError(503, 'SOME_OTHER_CODE') === 'SERVER_ERROR');
}

// ============================================================
// AUTO-ACCEPT test (section 26) -- "Get fitter" -> automatic proposal ->
// no edits -> submit.
// ============================================================
{
  let proposal = createInitialProposalState();
  proposal = reconcileProposalForTitleChange(proposal, 'Get fitter');
  const shown = buildDecompositionShownMetadata('AUTO_MATCH', proposal.pristineAutoCategory!, proposal.rows.length);
  check('auto-accept: SHOWN identifies AUTO_MATCH/GET_FITTER with the correct activity count', shown.source === 'AUTO_MATCH' && shown.templateCategory === 'GET_FITTER' && shown.activityCount === 3);

  const observability = recordNewBaseline(createInitialObservabilityState(), { activityCount: proposal.rows.length, isManualOverride: false, isScratch: false, isRefresh: false });
  const confirmed = buildGoalDecompositionSummaryMetadata(proposal, observability);
  check('auto-accept: confirmed metadata identifies AUTO_MATCH/GET_FITTER', confirmed.matchSource === 'AUTO_MATCH' && confirmed.templateCategory === 'GET_FITTER');
  check('auto-accept: accepted unchanged (wasEdited=false)', confirmed.wasEdited === false);
  check('auto-accept: initial and final activity counts match (3, untouched)', confirmed.initialActivityCount === 3 && confirmed.finalActivityCount === 3);
  check('auto-accept: no text (title) present anywhere in either event', !('title' in shown) && !('title' in confirmed));
}

// ============================================================
// EDITED AUTO PROPOSAL test (section 27) -- rename one, remove one, add
// one freeform, change Rhythm.
// ============================================================
{
  let proposal = createInitialProposalState();
  proposal = reconcileProposalForTitleChange(proposal, 'Get fitter');
  let observability = recordNewBaseline(createInitialObservabilityState(), { activityCount: proposal.rows.length, isManualOverride: false, isScratch: false, isRefresh: false });

  const runRow = proposal.rows.find((r) => r.title === 'Go for a run')!;
  proposal = renameProposalRow(proposal, runRow.localId, 'Morning cardio');
  observability = recordRowRenamed(observability, runRow.localId);

  const stretchRow = proposal.rows.find((r) => r.title === 'Stretch / mobility')!;
  proposal = removeProposalRow(proposal, stretchRow.localId);
  observability = recordRowRemoved(observability);

  proposal = addFreeformProposalRow(proposal);
  observability = recordFreeformRowAdded(observability);

  const freeformRow = proposal.rows[proposal.rows.length - 1];
  proposal = updateProposalRowRhythm(proposal, freeformRow.localId, { kind: 'N_PER_WEEK', targetPerWeek: 2 });
  observability = recordRhythmChanged(observability);

  const confirmed = buildGoalDecompositionSummaryMetadata(proposal, observability);
  check('edited-auto: wasEdited true', confirmed.wasEdited === true);
  check('edited-auto: removedCount=1, renamedCount=1, addedCount=1', confirmed.removedCount === 1 && confirmed.renamedCount === 1 && confirmed.addedCount === 1);
  check('edited-auto: rhythmChanged=true', confirmed.rhythmChanged === true);
  check('edited-auto: finalActivityCount reflects 2 kept template rows + 1 freeform = 3', confirmed.finalActivityCount === 3 && confirmed.templateBackedCount === 2 && confirmed.freeformCount === 1);
  check('edited-auto: matchSource remains AUTO_MATCH (editing rows never changes the match source)', confirmed.matchSource === 'AUTO_MATCH');
  check('edited-auto: no activity title present anywhere in the metadata', !Object.values(confirmed).includes('Morning cardio') && !Object.values(confirmed).includes('Stretch / mobility'));

  // renaming the SAME row repeatedly (simulating keystroke-by-keystroke
  // onChange firing) must not inflate renamedCount -- this is the direct
  // proof that section 6's "do not track every keystroke" is honored.
  let keystrokeObservability = recordRowRenamed(observability, runRow.localId);
  keystrokeObservability = recordRowRenamed(keystrokeObservability, runRow.localId);
  keystrokeObservability = recordRowRenamed(keystrokeObservability, runRow.localId);
  check('edited-auto: renaming the same row multiple times (keystrokes) never inflates renamedCount beyond the distinct-row count', keystrokeObservability.renamedRowIds.size === 1);
}

// ============================================================
// MANUAL OVERRIDE test (section 28).
// ============================================================
{
  let proposal = createInitialProposalState();
  proposal = reconcileProposalForTitleChange(proposal, 'Get fitter');
  let observability = recordNewBaseline(createInitialObservabilityState(), { activityCount: proposal.rows.length, isManualOverride: false, isScratch: false, isRefresh: false });

  proposal = selectManualCategory(proposal, 'STUDY_CONSISTENTLY');
  observability = recordNewBaseline(observability, { activityCount: proposal.rows.length, isManualOverride: true, isScratch: false, isRefresh: false });

  const confirmed = buildGoalDecompositionSummaryMetadata(proposal, observability);
  check('manual override: matchSource MANUAL_TEMPLATE, final category STUDY_CONSISTENTLY', confirmed.matchSource === 'MANUAL_TEMPLATE' && confirmed.templateCategory === 'STUDY_CONSISTENTLY');
  check('manual override: manualOverrideUsed sticky true', confirmed.manualOverrideUsed === true);
}

// ============================================================
// START FROM SCRATCH test (section 29) -- matching title, user selects
// scratch, adds freeform, submits.
// ============================================================
{
  let proposal = createInitialProposalState();
  proposal = reconcileProposalForTitleChange(proposal, 'Get fitter');
  let observability = recordNewBaseline(createInitialObservabilityState(), { activityCount: proposal.rows.length, isManualOverride: false, isScratch: false, isRefresh: false });

  proposal = selectManualCategory(proposal, null);
  observability = recordNewBaseline(observability, { activityCount: proposal.rows.length, isManualOverride: false, isScratch: true, isRefresh: false });

  proposal = addFreeformProposalRow(proposal);
  observability = recordFreeformRowAdded(observability);

  const confirmed = buildGoalDecompositionSummaryMetadata(proposal, observability);
  check('scratch: scratchUsed true', confirmed.scratchUsed === true);
  check('scratch: matchSource SCRATCH, no templateCategory', confirmed.matchSource === 'SCRATCH' && !('templateCategory' in confirmed));
  check('scratch: freeformCount = 1', confirmed.freeformCount === 1);
  check('scratch: no Goal/activity text present anywhere', !Object.values(confirmed).some((v) => typeof v === 'string' && v.includes(' ')));
}

// ============================================================
// UNKNOWN GOAL test (section 30) -- "Learn Spanish" -> NO_MATCH -> add
// freeform -> submit.
// ============================================================
{
  let proposal = createInitialProposalState();
  proposal = reconcileProposalForTitleChange(proposal, 'Learn Spanish');
  let observability = recordNewBaseline(createInitialObservabilityState(), { activityCount: proposal.rows.length, isManualOverride: false, isScratch: false, isRefresh: false });

  check('unknown goal: no automatic proposal (zero rows, no SHOWN-worthy state)', proposal.rows.length === 0 && proposal.pristineAutoCategory === null);

  proposal = addFreeformProposalRow(proposal);
  observability = recordFreeformRowAdded(observability);

  const confirmed = buildGoalDecompositionSummaryMetadata(proposal, observability);
  check('unknown goal: matchSource NO_MATCH, identifiable without storing "Learn Spanish" anywhere', confirmed.matchSource === 'NO_MATCH' && !('templateCategory' in confirmed));
  check('unknown goal: the literal title text never appears in the metadata', !Object.values(confirmed).includes('Learn Spanish'));
  check('unknown goal: freeformCount = 1', confirmed.freeformCount === 1);
}

// ============================================================
// REFRESH test (section 31) -- auto proposal -> edit -> Refresh
// suggestions -> submit. "Accepted unchanged" refers to the REFRESHED
// proposal (wasEdited correctly reflects the post-refresh state, not the
// pre-refresh edit history), documented explicitly here.
// ============================================================
{
  let proposal = createInitialProposalState();
  proposal = reconcileProposalForTitleChange(proposal, 'Get fitter');
  let observability = recordNewBaseline(createInitialObservabilityState(), { activityCount: proposal.rows.length, isManualOverride: false, isScratch: false, isRefresh: false });

  const runRow = proposal.rows.find((r) => r.title === 'Go for a run')!;
  proposal = removeProposalRow(proposal, runRow.localId);
  observability = recordRowRemoved(observability);
  check('refresh: edited before refresh', proposal.edited === true);

  // Refresh suggestions -- discards the edit, regenerates fresh, resets to PRISTINE.
  proposal = refreshProposalFromEffectiveCategory(proposal, 'Get fitter');
  observability = recordNewBaseline(observability, { activityCount: proposal.rows.length, isManualOverride: false, isScratch: false, isRefresh: true });

  const confirmed = buildGoalDecompositionSummaryMetadata(proposal, observability);
  check('refresh: refreshUsed sticky true', confirmed.refreshUsed === true);
  check('refresh: "accepted unchanged" (wasEdited) refers to the REFRESHED proposal, which is untouched again -- wasEdited=false', confirmed.wasEdited === false);
  check('refresh: finalActivityCount reflects the fresh, full 3-activity template again (the pre-refresh removal is gone)', confirmed.finalActivityCount === 3);
}

if (!allPassed) {
  console.error('SOME GOAL DECOMPOSITION OBSERVABILITY CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOAL DECOMPOSITION OBSERVABILITY CHECKS PASSED');
