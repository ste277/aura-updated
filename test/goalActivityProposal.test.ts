/**
 * Goals V2 Candidate B2 (resumed) -- pure tests for the transient Goal
 * activity proposal review state machine (apps/web/lib/goalActivityProposal.ts).
 * No DB, no React rendering harness -- same convention as
 * autoGoalSuggestionInclusion.test.ts/planWithAuraViewLogic.test.ts
 * (testing the pure logic a component wires up, not a DOM simulation).
 * GoalsListClient.tsx is the one consumer; this file is the primary proof
 * of its own title-change/category-precedence/review behavior.
 */
import {
  createInitialProposalState,
  reconcileProposalForTitleChange,
  deriveEffectiveGoalTemplateCategory,
  selectManualCategory,
  useAutomaticSuggestion,
  refreshProposalFromEffectiveCategory,
  removeProposalRow,
  renameProposalRow,
  updateProposalRowRhythm,
  addFreeformProposalRow,
  isProposalReadyToSubmit,
  buildReviewedActivitiesForSubmission,
  createProposalRowsFromTemplate,
  createFreeformProposalRow,
  type GoalActivityProposalState,
} from '../apps/web/lib/goalActivityProposal';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const titlesFor = (state: GoalActivityProposalState) => state.rows.map((r) => r.title);

// ============================================================
// B1 integration (this ticket's own section 34) -- reuses
// matchGoalTemplateCategory + resolveGoalTemplateActivities, never
// duplicated.
// ============================================================
{
  let state = createInitialProposalState();
  state = reconcileProposalForTitleChange(state, 'Get fitter');
  check('B1 integration: "Get fitter" -> GET_FITTER -> canonical 3-activity template', titlesFor(state).join(',') === 'Go for a run,Strength training session,Stretch / mobility');
  check('B1 integration: resolved rows carry real catalog activityId where the catalog supports it', state.rows.every((r) => r.activityId !== null));
  check('B1 integration: resolved rows are TEMPLATE-sourced', state.rows.every((r) => r.source === 'TEMPLATE'));

  let unmatched = createInitialProposalState();
  unmatched = reconcileProposalForTitleChange(unmatched, 'Learn Spanish');
  check('B1 integration: "Learn Spanish" -> no match -> no automatic proposal (never forced into an unrelated template)', unmatched.rows.length === 0 && unmatched.pristineAutoCategory === null);
}

// ============================================================
// Auto title-change test (section 35) -- PRISTINE regenerates on every
// real category change; no stale proposal ever lingers.
// ============================================================
{
  let state = createInitialProposalState();
  state = reconcileProposalForTitleChange(state, 'Get fitter');
  check('auto title-change: fitness proposal present', titlesFor(state).includes('Go for a run'));

  state = reconcileProposalForTitleChange(state, 'Meditate regularly');
  check('auto title-change: switching to a meditation title replaces the proposal with the meditation template', titlesFor(state).join(',') === 'Meditate 10 minutes');
  check('auto title-change: no stale fitness activity remains', !titlesFor(state).includes('Go for a run'));

  state = reconcileProposalForTitleChange(state, 'Learn Spanish');
  check('auto title-change: an unmatched title clears the proposal entirely (no stale meditation activity)', state.rows.length === 0);

  // Reconciling with a title that resolves to the SAME category returns
  // the identical state reference -- no redundant regeneration/row-id churn.
  let stable = createInitialProposalState();
  stable = reconcileProposalForTitleChange(stable, 'Get fitter');
  const stableAgain = reconcileProposalForTitleChange(stable, 'I really want to get fitter this year');
  check('auto title-change: a title edit that resolves to the SAME category does not regenerate rows (identical row localIds)', stable.rows.map((r) => r.localId).join(',') === stableAgain.rows.map((r) => r.localId).join(','));
}

// ============================================================
// User-edited title-change test (section 36) -- edits are never silently
// destroyed by a later title change.
// ============================================================
{
  let state = createInitialProposalState();
  state = reconcileProposalForTitleChange(state, 'Get fitter');
  const removedLocalId = state.rows[1].localId;
  state = removeProposalRow(state, removedLocalId);
  check('user-edited: row removed, edited=true', state.rows.length === 2 && state.edited === true);

  const afterTitleChange = reconcileProposalForTitleChange(state, 'Meditate regularly');
  check('user-edited: a later title change does NOT regenerate/destroy the edited rows', afterTitleChange.rows.map((r) => r.localId).join(',') === state.rows.map((r) => r.localId).join(','));
  check('user-edited: still marked edited (UI must not claim this is a fresh automatic suggestion)', afterTitleChange.edited === true);
  check('user-edited: pristineAutoCategory is left untouched (never silently advanced past what the user is looking at)', afterTitleChange.pristineAutoCategory === 'GET_FITTER');
}

// ============================================================
// Manual override test (section 37) -- explicit choice wins and survives
// subsequent title edits.
// ============================================================
{
  let state = createInitialProposalState();
  state = reconcileProposalForTitleChange(state, 'Get fitter');
  check('manual override: AUTO resolves GET_FITTER first', deriveEffectiveGoalTemplateCategory(state, 'Get fitter') === 'GET_FITTER');

  state = selectManualCategory(state, 'STUDY_CONSISTENTLY');
  check('manual override: explicit manual selection replaces the proposal with STUDY_CONSISTENTLY', titlesFor(state).join(',') === 'Study session');
  check('manual override: isManualCategory true, PRISTINE (edited=false)', state.isManualCategory === true && state.edited === false);

  const afterTitleChange = reconcileProposalForTitleChange(state, 'Something else entirely');
  check('manual override: a Goal title change afterward does NOT override the manual choice', titlesFor(afterTitleChange).join(',') === 'Study session');
  check('manual override: manual mode persists across the title change', afterTitleChange.isManualCategory === true);
}

// ============================================================
// Start-from-scratch test (section 38) -- an explicit manual null choice
// stays scratch regardless of later title edits.
// ============================================================
{
  let state = createInitialProposalState();
  state = reconcileProposalForTitleChange(state, 'Get fitter');
  state = selectManualCategory(state, null);
  check('start from scratch: explicit null choice clears the proposal', state.rows.length === 0 && state.isManualCategory === true && state.manualCategory === null);

  const afterTitleChange = reconcileProposalForTitleChange(state, 'Get fitter');
  check('start from scratch: a subsequent "Get fitter" title does NOT auto-repopulate the template', afterTitleChange.rows.length === 0 && afterTitleChange.isManualCategory === true);
}

// ============================================================
// Remove / submission test (section 39).
// ============================================================
{
  let state = createInitialProposalState();
  state = reconcileProposalForTitleChange(state, 'Get fitter');
  const middleId = state.rows[1].localId;
  state = removeProposalRow(state, middleId);
  const submission = buildReviewedActivitiesForSubmission(state.rows);
  check('remove/submission: exactly the remaining 2 activities are submitted', submission.length === 2 && submission.map((a) => a.title).join(',') === 'Go for a run,Stretch / mobility');
  check('remove/submission: the removed activity never reappears', !submission.some((a) => a.title === 'Strength training session'));
}

// ============================================================
// Rename / submission test (section 40) -- edited title persists, ORIGINAL
// template activityId is preserved verbatim (never rematched).
// ============================================================
{
  let state = createInitialProposalState();
  state = reconcileProposalForTitleChange(state, 'Get fitter');
  const runRow = state.rows.find((r) => r.title === 'Go for a run')!;
  const originalActivityId = runRow.activityId;
  state = renameProposalRow(state, runRow.localId, 'Morning cardio');
  const submission = buildReviewedActivitiesForSubmission(state.rows);
  const renamed = submission.find((a) => a.title === 'Morning cardio')!;
  check('rename/submission: edited title is submitted verbatim', !!renamed);
  check('rename/submission: the ORIGINAL template-resolved activityId is preserved (never rematched from the new title)', renamed.activityId === originalActivityId && originalActivityId !== null);
}

// ============================================================
// Freeform / submission test (section 41).
// ============================================================
{
  let state = createInitialProposalState();
  state = addFreeformProposalRow(state);
  state = renameProposalRow(state, state.rows[0].localId, 'Practice pronunciation with a partner');
  check('freeform: source is FREEFORM, activityId null before edit', createFreeformProposalRow().source === 'FREEFORM' && createFreeformProposalRow().activityId === null);
  const submission = buildReviewedActivitiesForSubmission(state.rows);
  check('freeform/submission: custom title submitted', submission[0].title === 'Practice pronunciation with a partner');
  check('freeform/submission: activityId null (never inferred from the typed title)', submission[0].activityId === null);
  check('freeform/submission: no completionRequirement key (server-side DONE default applies)', !('completionRequirement' in submission[0]));
  check('freeform/submission: default Rhythm NONE', submission[0].rhythm.kind === 'NONE');
}

// ============================================================
// Completion-preservation test (section 42) -- a template with real
// DURATION completion semantics (MEDITATE_REGULARLY) is preserved through
// submission without editing it.
// ============================================================
{
  let state = createInitialProposalState();
  state = reconcileProposalForTitleChange(state, 'Meditate regularly');
  const submission = buildReviewedActivitiesForSubmission(state.rows);
  check('completion preservation: MEDITATE_REGULARLY keeps DURATION/10 through submission mapping, never flattened to DONE', submission[0].completionRequirement?.kind === 'DURATION' && submission[0].completionRequirement?.targetValue === 10);
}

// ============================================================
// Rhythm-submission test (section 43) -- exact selected Rhythm appears,
// no parallel activityRhythms array exists anywhere in this module.
// ============================================================
{
  let state = createInitialProposalState();
  state = reconcileProposalForTitleChange(state, 'Get fitter');
  const rowId = state.rows[0].localId;
  state = updateProposalRowRhythm(state, rowId, { kind: 'N_PER_WEEK', targetPerWeek: 5 });
  const submission = buildReviewedActivitiesForSubmission(state.rows);
  check('Rhythm submission: the exact selected Rhythm is present on the correct row', submission[0].rhythm.kind === 'N_PER_WEEK' && (submission[0].rhythm as { targetPerWeek: number }).targetPerWeek === 5);
  check('Rhythm submission: untouched sibling rows keep their own default Rhythm (no cross-row leakage)', submission[1].rhythm.kind === 'NONE');
}

// ============================================================
// Zero-activity submission test (section 44).
// ============================================================
{
  let state = createInitialProposalState();
  state = reconcileProposalForTitleChange(state, 'Get fitter');
  for (const row of [...state.rows]) state = removeProposalRow(state, row.localId);
  const submission = buildReviewedActivitiesForSubmission(state.rows);
  check('zero-activity: removing every row submits an empty activities[] array', Array.isArray(submission) && submission.length === 0);
  check('zero-activity: isProposalReadyToSubmit is true for an empty, fully-valid proposal', isProposalReadyToSubmit(state, 200) === true);
}

// ============================================================
// Zero-write test (section 45) -- every pure transition here returns a
// new/same plain object; none of these functions perform fetch/DB access
// (confirmed structurally: this whole module has zero fetch/db.ts/pg
// imports -- see the purity guard below).
// ============================================================
{
  const src: string = require('fs').readFileSync(require('path').join(__dirname, '../apps/web/lib/goalActivityProposal.ts'), 'utf8');
  const srcNoComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  check('zero-write: goalActivityProposal.ts never references fetch/db.ts/pg/POST in real code', !/fetch\(|from '\.\/db'|from 'pg'|POST\s*\(/.test(srcNoComments));
  check('zero-write: goalActivityProposal.ts imports only type-only React-adjacent dependencies (no `from \'react\'` value import)', !/from 'react'/.test(srcNoComments));
}

// ============================================================
// Refresh-suggestions behavior (section 23/27) -- discards edited rows
// and regenerates fresh from the currently-effective category, resetting
// to PRISTINE.
// ============================================================
{
  let state = createInitialProposalState();
  state = reconcileProposalForTitleChange(state, 'Get fitter');
  const middleId = state.rows[1].localId;
  state = removeProposalRow(state, middleId);
  check('refresh: proposal is edited (2 of 3 rows) before refresh', state.edited === true && state.rows.length === 2);
  state = refreshProposalFromEffectiveCategory(state, 'Get fitter');
  check('refresh: regenerates the full canonical 3-activity template fresh', titlesFor(state).join(',') === 'Go for a run,Strength training session,Stretch / mobility');
  check('refresh: resets to PRISTINE', state.edited === false);
}

// ============================================================
// Use-automatic-suggestion escape hatch (section 26) -- re-resolves the
// CURRENT title, not whatever category was manually selected before.
// ============================================================
{
  let state = createInitialProposalState();
  state = reconcileProposalForTitleChange(state, 'Get fitter');
  state = selectManualCategory(state, 'STUDY_CONSISTENTLY');
  const escaped = useAutomaticSuggestion('Meditate regularly');
  check('use-automatic-suggestion: escaping manual mode resolves the CURRENT title (meditation), not the old manual choice or the old auto title', titlesFor(escaped).join(',') === 'Meditate 10 minutes');
  check('use-automatic-suggestion: isManualCategory is false again', escaped.isManualCategory === false);
}

// ============================================================
// Stable local identity (this ticket's own section 10) -- never keyed by
// title or array index; identity survives a rename.
// ============================================================
{
  let state = createInitialProposalState();
  state = reconcileProposalForTitleChange(state, 'Get fitter');
  const original = state.rows[0];
  state = renameProposalRow(state, original.localId, 'Totally different title');
  check('stable identity: the SAME localId still identifies the row after a rename (never title-keyed)', state.rows[0].localId === original.localId);
  const ids = state.rows.map((r) => r.localId);
  check('stable identity: every row has a distinct, non-empty localId', new Set(ids).size === ids.length && ids.every((id) => id.length > 0));
}

// ============================================================
// isProposalReadyToSubmit gating (title/Rhythm validity).
// ============================================================
{
  let state = createInitialProposalState();
  state = addFreeformProposalRow(state); // blank title by default
  check('submit gating: a blank freeform row title blocks submission', isProposalReadyToSubmit(state, 200) === false);
  state = renameProposalRow(state, state.rows[0].localId, 'Valid title');
  check('submit gating: a valid title unblocks submission', isProposalReadyToSubmit(state, 200) === true);
  state = updateProposalRowRhythm(state, state.rows[0].localId, null);
  check('submit gating: a null (unresolved Custom) Rhythm blocks submission', isProposalReadyToSubmit(state, 200) === false);
}

// ============================================================
// Template-source-of-truth: createProposalRowsFromTemplate never
// duplicates GOAL_TEMPLATES -- it reuses resolveGoalTemplateActivities
// verbatim (cross-checked against B1/G3.4's own established fixtures).
// ============================================================
check(
  'template source of truth: FINISH_PROJECT activities resolve with activityId null exactly as resolveGoalTemplateActivities itself establishes (no fallback id invented here)',
  createProposalRowsFromTemplate('FINISH_PROJECT').every((row) => row.activityId === null)
);

if (!allPassed) {
  console.error('SOME GOAL ACTIVITY PROPOSAL CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOAL ACTIVITY PROPOSAL CHECKS PASSED');
