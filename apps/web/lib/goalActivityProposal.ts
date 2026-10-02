/**
 * Goals V2 Candidate B2 (resumed after B3) -- the transient, client-only
 * Goal-activity proposal review model. Pure/React-independent/
 * DB-independent (same convention as planDayEntry.ts's own row-creation
 * helpers) so the full title-change/category-precedence state machine is
 * directly testable without a rendering harness -- GoalsListClient.tsx
 * (the one consumer) is a thin layer that holds one
 * GoalActivityProposalState value and calls these pure transition
 * functions from its event handlers.
 *
 * Nothing here writes anywhere -- no fetch, no db.ts, no persistence.
 * Only the caller's own explicit "Create goal" submit (POST /api/goals,
 * Candidate B3's explicit-review mode) ever persists anything.
 */

import { matchGoalTemplateCategory, resolveGoalTemplateActivities, type GoalTemplateCategory } from './goals';
import type { CompletionRequirement } from './goalCompletion';
import type { GoalActivityRhythm } from './goalActivityRhythm';
// Type-only -- erased entirely at compile time, so this module stays
// fully pure/React-independent at runtime despite the source file being
// a 'use client' component (see that file's own RhythmPickerValue for why
// its shape, a discriminated union, is kept distinct from
// GoalActivityRhythm's single-interface-with-optional-field shape).
import type { RhythmPickerValue } from '../components/RhythmPicker';

/**
 * One proposal row. `rhythm` is nullable to carry the RhythmPicker's own
 * transient "Custom selected, no valid number typed yet" state (same
 * convention as the pre-B2 CreateGoalModal's own
 * `ReadonlyArray<RhythmPickerValue | null>`) -- a caller must treat a
 * null-rhythm row as not yet submittable. `localId`/`source` are UI
 * identity only and are never part of the B3 submission payload (see
 * buildReviewedActivitiesForSubmission below).
 */
export interface GoalActivityProposalRow {
  localId: string;
  title: string;
  activityId: string | null;
  completionRequirement?: CompletionRequirement;
  rhythm: RhythmPickerValue | null;
  source: 'TEMPLATE' | 'FREEFORM';
}

let proposalRowIdCounter = 0;
function nextProposalRowId(): string {
  proposalRowIdCounter += 1;
  return `goal-activity-proposal-${proposalRowIdCounter}`;
}

/** Resolves a template category's activities through the one canonical
 * resolver (never duplicated here) and wraps each as a fresh TEMPLATE
 * proposal row, defaulting every row's Rhythm to NONE -- same default
 * the pre-B2 CreateGoalModal already applied, never an invented
 * frequency recommendation. */
export function createProposalRowsFromTemplate(category: GoalTemplateCategory): GoalActivityProposalRow[] {
  return resolveGoalTemplateActivities(category).map((activity) => ({
    localId: nextProposalRowId(),
    title: activity.title,
    activityId: activity.activityId,
    completionRequirement: activity.completionRequirement,
    rhythm: { kind: 'NONE' },
    source: 'TEMPLATE',
  }));
}

/** A blank FREEFORM row -- activityId null (never inferred from title,
 * never calls findActivityIntent), completionRequirement omitted
 * (server-side default DONE), Rhythm defaults NONE. */
export function createFreeformProposalRow(): GoalActivityProposalRow {
  return { localId: nextProposalRowId(), title: '', activityId: null, rhythm: { kind: 'NONE' }, source: 'FREEFORM' };
}

// ============================================================
// The proposal state machine (this ticket's own sections 6-26) -- one
// plain object, a handful of pure transition functions, never a
// Redux/state-machine framework.
// ============================================================

export interface GoalActivityProposalState {
  /** false (AUTO, the default): the effective category is derived live
   * from the Goal title via matchGoalTemplateCategory. true (MANUAL): an
   * explicit user category choice (including "Start from scratch", a
   * real manual choice of `null`) is authoritative and stays authoritative
   * across subsequent title edits -- this ticket's own central
   * "explicit user selection wins until deliberately reset" rule. */
  isManualCategory: boolean;
  /** Meaningful only while isManualCategory is true. */
  manualCategory: GoalTemplateCategory | null;
  /** The category the CURRENT pristine (never-edited) auto-proposal was
   * generated from -- lets reconcileProposalForTitleChange detect "the
   * auto-match actually changed" without regenerating on every keystroke
   * that doesn't change the resolved category. */
  pristineAutoCategory: GoalTemplateCategory | null;
  rows: readonly GoalActivityProposalRow[];
  /** false (PRISTINE): `rows` is exactly what automatic matching or the
   * last explicit category choice produced, untouched. true
   * (USER_EDITED): the user has renamed/removed/added/changed Rhythm on
   * at least one row since the last (re)generation -- title changes must
   * never silently regenerate/destroy this state (sections 20-22). */
  edited: boolean;
}

export function createInitialProposalState(): GoalActivityProposalState {
  return { isManualCategory: false, manualCategory: null, pristineAutoCategory: null, rows: [], edited: false };
}

/** The category currently in effect: the explicit manual choice while in
 * MANUAL mode, otherwise whatever the current Goal title automatically
 * matches (this ticket's own section 6 precedence rule). */
export function deriveEffectiveGoalTemplateCategory(state: GoalActivityProposalState, title: string): GoalTemplateCategory | null {
  return state.isManualCategory ? state.manualCategory : matchGoalTemplateCategory(title);
}

/**
 * Call whenever the Goal title changes. Only ever regenerates `rows`
 * while in AUTO mode AND the proposal is still PRISTINE (this ticket's
 * own sections 20-22, the "title-change problem"): a MANUAL choice or any
 * USER_EDITED proposal is never touched by a title edit alone. Returns
 * the SAME state reference when nothing needs to change (directly
 * testable, and lets a caller skip a redundant re-render).
 */
export function reconcileProposalForTitleChange(state: GoalActivityProposalState, title: string): GoalActivityProposalState {
  if (state.isManualCategory || state.edited) return state;
  const matched = matchGoalTemplateCategory(title);
  if (matched === state.pristineAutoCategory) return state;
  return { ...state, pristineAutoCategory: matched, rows: matched ? createProposalRowsFromTemplate(matched) : [] };
}

/** An explicit manual category choice (including "Start from scratch",
 * `category === null`) -- this ticket's own section 24/25: always wins,
 * always replaces the current proposal with that category's canonical
 * one (or clears it for scratch), always resets to PRISTINE. May discard
 * prior edits -- the user has intentionally asked for a different
 * template, so that is the correct, documented behavior. */
export function selectManualCategory(state: GoalActivityProposalState, category: GoalTemplateCategory | null): GoalActivityProposalState {
  return { isManualCategory: true, manualCategory: category, pristineAutoCategory: state.pristineAutoCategory, rows: category ? createProposalRowsFromTemplate(category) : [], edited: false };
}

/** Explicit escape from MANUAL mode back to AUTO (this ticket's own
 * section 26) -- re-resolves the CURRENT title fresh and resets to
 * PRISTINE. */
export function useAutomaticSuggestion(title: string): GoalActivityProposalState {
  const matched = matchGoalTemplateCategory(title);
  return { isManualCategory: false, manualCategory: null, pristineAutoCategory: matched, rows: matched ? createProposalRowsFromTemplate(matched) : [], edited: false };
}

/** Explicit "Refresh suggestions" action (this ticket's own section 23) --
 * discards the current (USER_EDITED) rows and regenerates fresh from
 * whichever category is currently effective (auto-matched or manually
 * chosen), resetting to PRISTINE. */
export function refreshProposalFromEffectiveCategory(state: GoalActivityProposalState, title: string): GoalActivityProposalState {
  const effective = deriveEffectiveGoalTemplateCategory(state, title);
  return { ...state, pristineAutoCategory: state.isManualCategory ? state.pristineAutoCategory : effective, rows: effective ? createProposalRowsFromTemplate(effective) : [], edited: false };
}

export function removeProposalRow(state: GoalActivityProposalState, localId: string): GoalActivityProposalState {
  return { ...state, rows: state.rows.filter((row) => row.localId !== localId), edited: true };
}

export function renameProposalRow(state: GoalActivityProposalState, localId: string, title: string): GoalActivityProposalState {
  return { ...state, rows: state.rows.map((row) => (row.localId === localId ? { ...row, title } : row)), edited: true };
}

export function updateProposalRowRhythm(state: GoalActivityProposalState, localId: string, rhythm: RhythmPickerValue | null): GoalActivityProposalState {
  return { ...state, rows: state.rows.map((row) => (row.localId === localId ? { ...row, rhythm } : row)), edited: true };
}

export function addFreeformProposalRow(state: GoalActivityProposalState): GoalActivityProposalState {
  return { ...state, rows: [...state.rows, createFreeformProposalRow()], edited: true };
}

/** True once every row has a non-blank, length-valid title AND a
 * resolved (non-null) Rhythm -- gates the Create Goal submit button,
 * same spirit as the pre-B2 CreateGoalModal's own `rhythmsValid` check. */
export function isProposalReadyToSubmit(state: GoalActivityProposalState, maxTitleLength: number): boolean {
  return state.rows.every((row) => row.title.trim().length > 0 && row.title.trim().length <= maxTitleLength && row.rhythm !== null);
}

// ============================================================
// Submission mapping (this ticket's own sections 17/18) -- B3's
// explicit-review wire shape.
// ============================================================

export interface ReviewedGoalActivitySubmission {
  title: string;
  activityId: string | null;
  completionRequirement?: CompletionRequirement;
  rhythm: GoalActivityRhythm;
}

/**
 * Maps the FINAL reviewed rows to B3's `activities[]` wire shape.
 * Deliberately drops `localId`/`source` (UI-only, never submitted) and
 * passes `activityId` through VERBATIM -- never re-derived/rematched
 * from the (possibly user-renamed) title. A null row.rhythm defaults to
 * NONE defensively (never blocks submission on a stray null -- callers
 * are expected to have already gated on isProposalReadyToSubmit, same
 * fail-safe convention as normalizeGoalActivityRhythm elsewhere in this
 * codebase).
 */
export function buildReviewedActivitiesForSubmission(rows: readonly GoalActivityProposalRow[]): ReviewedGoalActivitySubmission[] {
  return rows.map((row) => ({
    title: row.title.trim(),
    activityId: row.activityId,
    ...(row.completionRequirement ? { completionRequirement: row.completionRequirement } : {}),
    rhythm: row.rhythm ?? { kind: 'NONE' },
  }));
}
