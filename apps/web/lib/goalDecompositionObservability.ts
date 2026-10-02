/**
 * Goals V2 Candidate B4 -- the transient, client-only telemetry summary
 * for the Goal decomposition review experience (B1 match -> B2 review ->
 * B3 create). Pure/React-independent/DB-independent (same convention as
 * goalActivityProposal.ts, which this module reads but never duplicates
 * the logic of) so the summary-derivation is directly testable without a
 * rendering harness.
 *
 * PRIVACY (this ticket's own sections 3/4/16/17): every exported shape
 * here is built ONLY from bounded categorical/count/boolean data --
 * never a Goal title, activity title, freeform text, or
 * completion/Rhythm VALUE (only whether Rhythm was touched at all).
 * There is structurally no field anywhere in this module typed to hold
 * free text -- every value is a closed enum, a bounded count, or a
 * boolean, matching lib/productEvents.ts's own FieldSchema union (which
 * itself has no 'string'/free-text field type at all).
 */
import { GOAL_TEMPLATE_CATEGORIES, type GoalTemplateCategory } from './goals';
import type { GoalActivityProposalState } from './goalActivityProposal';

export type GoalDecompositionMatchSource = 'AUTO_MATCH' | 'MANUAL_TEMPLATE' | 'SCRATCH' | 'NO_MATCH';

export { GOAL_TEMPLATE_CATEGORIES };
export type { GoalTemplateCategory };

/**
 * Session-scoped (one per CreateGoalModal mount, same lifecycle as
 * Candidate B3.1's own clientRequestId) observability bookkeeping,
 * maintained ALONGSIDE (never instead of, never influencing)
 * GoalActivityProposalState -- this ticket's own section 21: no new
 * domain state, and section 10: "the existing B2 proposal state must
 * remain the behavioral source of truth; observability must not alter
 * it."
 *
 * Two different reset disciplines, deliberately:
 *  - `initialActivityCount`/`removedCount`/`renamedRowIds`/`addedCount`/
 *    `rhythmChanged` describe edits to the CURRENT baseline -- they reset
 *    together, at the exact same 4 points GoalActivityProposalState's own
 *    `edited` flag resets (a fresh auto-match, an explicit manual
 *    category choice, "Use Aura's suggestion", "Refresh suggestions").
 *    This keeps them answering "what happened to the proposal that is
 *    actually about to be submitted", not a confusing blend across an
 *    earlier, now-abandoned baseline (e.g. the user first considered
 *    GET_FITTER, edited it, then pivoted the Goal title entirely to
 *    "Meditate regularly" -- comparing the NEW baseline's edits against
 *    the OLD baseline's row count would be meaningless).
 *  - `refreshUsed`/`manualOverrideUsed`/`scratchUsed` are STICKY for the
 *    whole session (never reset) -- these answer "did this behavior ever
 *    occur during the user's review", a journey-level fact independent
 *    of which baseline was ultimately submitted (this ticket's own
 *    questions 5/6/8 are phrased this way: "how often do users manually
 *    choose a different template", not "was the FINAL submission
 *    manual").
 */
export interface GoalDecompositionObservabilityState {
  initialActivityCount: number;
  removedCount: number;
  renamedRowIds: ReadonlySet<string>;
  addedCount: number;
  rhythmChanged: boolean;
  refreshUsed: boolean;
  manualOverrideUsed: boolean;
  scratchUsed: boolean;
}

export function createInitialObservabilityState(): GoalDecompositionObservabilityState {
  return { initialActivityCount: 0, removedCount: 0, renamedRowIds: new Set(), addedCount: 0, rhythmChanged: false, refreshUsed: false, manualOverrideUsed: false, scratchUsed: false };
}

/** Call whenever a fresh PRISTINE baseline is (re)generated (the same 4
 * moments GoalActivityProposalState's own `edited` resets to false) --
 * resets the current-baseline edit bookkeeping, records the new
 * baseline's row count, and marks the sticky flags as appropriate for
 * HOW this baseline was reached. */
export function recordNewBaseline(state: GoalDecompositionObservabilityState, input: { activityCount: number; isManualOverride: boolean; isScratch: boolean; isRefresh: boolean }): GoalDecompositionObservabilityState {
  return {
    initialActivityCount: input.activityCount,
    removedCount: 0,
    renamedRowIds: new Set(),
    addedCount: 0,
    rhythmChanged: false,
    refreshUsed: state.refreshUsed || input.isRefresh,
    manualOverrideUsed: state.manualOverrideUsed || input.isManualOverride,
    scratchUsed: state.scratchUsed || input.isScratch,
  };
}

export function recordRowRemoved(state: GoalDecompositionObservabilityState): GoalDecompositionObservabilityState {
  return { ...state, removedCount: state.removedCount + 1 };
}

/** De-duplicated by row identity (never by call count) -- this is what
 * keeps `renamedCount` from ever counting KEYSTROKES (the real call site
 * fires on every onChange while a user types a new title): renaming the
 * SAME row five times in a row still counts once. */
export function recordRowRenamed(state: GoalDecompositionObservabilityState, localId: string): GoalDecompositionObservabilityState {
  if (state.renamedRowIds.has(localId)) return state;
  return { ...state, renamedRowIds: new Set([...state.renamedRowIds, localId]) };
}

export function recordFreeformRowAdded(state: GoalDecompositionObservabilityState): GoalDecompositionObservabilityState {
  return { ...state, addedCount: state.addedCount + 1 };
}

/** Boolean, not a count -- the real call site can fire once per
 * KEYSTROKE while a Custom Rhythm number is being typed; "was Rhythm
 * touched at all" is the only safely-countable signal here. */
export function recordRhythmChanged(state: GoalDecompositionObservabilityState): GoalDecompositionObservabilityState {
  return state.rhythmChanged ? state : { ...state, rhythmChanged: true };
}

// ============================================================
// Event metadata shapes -- flat, ProductEventMetadata-compatible
// (string | number | boolean values only), matching
// lib/productEvents.ts's own FieldSchema union exactly.
// ============================================================

export interface GoalDecompositionShownMetadata {
  source: 'AUTO_MATCH' | 'MANUAL_TEMPLATE';
  templateCategory: GoalTemplateCategory;
  activityCount: number;
}

/** This ticket's own section 8 -- fire ONLY for an actual template-backed
 * decomposition becoming visible (AUTO_MATCH or an explicit MANUAL
 * template choice). Deliberately excludes SCRATCH/NO_MATCH -- "Start
 * from scratch" is the absence of a decomposition, not one being shown,
 * and an unmatched title is captured later, as part of the confirmation
 * funnel (section 9), never as its own noisy per-keystroke event. */
export function buildDecompositionShownMetadata(source: 'AUTO_MATCH' | 'MANUAL_TEMPLATE', templateCategory: GoalTemplateCategory, activityCount: number): GoalDecompositionShownMetadata {
  return { source, templateCategory, activityCount };
}

export interface GoalDecompositionConfirmedMetadata {
  matchSource: GoalDecompositionMatchSource;
  templateCategory?: GoalTemplateCategory;
  initialActivityCount: number;
  finalActivityCount: number;
  templateBackedCount: number;
  freeformCount: number;
  wasEdited: boolean;
  removedCount: number;
  renamedCount: number;
  addedCount: number;
  rhythmChanged: boolean;
  manualOverrideUsed: boolean;
  scratchUsed: boolean;
  refreshUsed: boolean;
}

function deriveMatchSource(proposal: GoalActivityProposalState): { matchSource: GoalDecompositionMatchSource; templateCategory: GoalTemplateCategory | null } {
  if (proposal.isManualCategory) {
    return proposal.manualCategory ? { matchSource: 'MANUAL_TEMPLATE', templateCategory: proposal.manualCategory } : { matchSource: 'SCRATCH', templateCategory: null };
  }
  return proposal.pristineAutoCategory ? { matchSource: 'AUTO_MATCH', templateCategory: proposal.pristineAutoCategory } : { matchSource: 'NO_MATCH', templateCategory: null };
}

/**
 * The confirmation/failure event metadata -- derived entirely from the
 * real B2 proposal state (never duplicated/reimplemented) plus this
 * module's own session-level observability bookkeeping. `wasEdited` is
 * exactly `proposal.edited` (this ticket's own section 15/31: "accepted
 * unchanged" means the ACTUALLY SUBMITTED baseline, whatever it is --
 * including a refreshed one -- was not touched afterward; reusing the
 * already-correct, already-tested B2 flag directly rather than a second,
 * parallel "accepted" computation).
 */
export function buildGoalDecompositionSummaryMetadata(proposal: GoalActivityProposalState, observability: GoalDecompositionObservabilityState): GoalDecompositionConfirmedMetadata {
  const { matchSource, templateCategory } = deriveMatchSource(proposal);
  const templateBackedCount = proposal.rows.filter((row) => row.source === 'TEMPLATE').length;
  const freeformCount = proposal.rows.length - templateBackedCount;
  return {
    matchSource,
    ...(templateCategory ? { templateCategory } : {}),
    initialActivityCount: observability.initialActivityCount,
    finalActivityCount: proposal.rows.length,
    templateBackedCount,
    freeformCount,
    wasEdited: proposal.edited,
    removedCount: observability.removedCount,
    renamedCount: observability.renamedRowIds.size,
    addedCount: observability.addedCount,
    rhythmChanged: observability.rhythmChanged,
    manualOverrideUsed: observability.manualOverrideUsed,
    scratchUsed: observability.scratchUsed,
    refreshUsed: observability.refreshUsed,
  };
}

export type GoalCreateErrorCategory = 'VALIDATION' | 'IDEMPOTENCY_CONFLICT' | 'SERVER_ERROR' | 'NETWORK_ERROR';

/** Bounded HTTP-status/response-code -> error category mapping -- never
 * the raw error message/response body (this ticket's own section 18). */
export function classifyGoalCreateError(status: number | null, code: string | null | undefined): GoalCreateErrorCategory {
  if (status === null) return 'NETWORK_ERROR';
  if (code === 'IDEMPOTENCY_CONFLICT') return 'IDEMPOTENCY_CONFLICT';
  if (status >= 400 && status < 500) return 'VALIDATION';
  return 'SERVER_ERROR';
}
