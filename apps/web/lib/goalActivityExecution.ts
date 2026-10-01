/**
 * Goals V2 G2.2.1/G2.2.2 -- pure domain representation of a
 * GoalActivityExecution snapshot: "what counted as completion, and what was
 * actually recorded, for one GoalActivity occurrence." No DB access here --
 * same convention as lib/goalCompletion.ts, which this module builds
 * directly on (reuses CompletionKind/CompletionRequirement/
 * validateCompletionRequirement rather than defining a second, competing
 * vocabulary).
 *
 * G2.2.1 added the schema/domain foundation with no production write path.
 * G2.2.2 connects resolveCompletionActualValue (below) to the EXISTING
 * completion transaction (apps/web/lib/db.ts's logPlannedActivity). G3.2/
 * G3.3 add formatGoalActivityCompletion (below), a pure presentation
 * helper deliberately placed HERE rather than in goalsPresentation.ts (a
 * Goal-UI-specific module) -- both Goal Detail and Right Now (Home) import
 * it from this single, neutral Goal-domain module, so there is exactly one
 * canonical formatting rule, never a Home->Goal-UI dependency.
 */

import { validateCompletionRequirement, type CompletionRequirement } from './goalCompletion';

/** The canonical, in-memory shape -- "what completion meant when this
 * execution began" plus "what was actually recorded". currentValue is null
 * for DONE (nothing to measure) and also legitimately null for
 * DURATION/MEASURED_TARGET before any progress has been written yet
 * (an execution record may exist before its first measured value does). */
export interface GoalActivityExecutionSnapshot {
  completionRequirement: CompletionRequirement;
  currentValue: number | null;
}

export type GoalActivityExecutionSnapshotValidationResult =
  | { ok: true; snapshot: GoalActivityExecutionSnapshot }
  | { ok: false; error: string };

/** 0 is valid progress (a real, observed "nothing yet" fact). Negative is
 * never valid -- there is no product meaning for negative progress. Must be
 * finite (rejects NaN/Infinity, same discipline as validateCompletionRequirement's
 * own isPositiveFiniteNumber). */
function isValidCurrentValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Pure validation of a candidate execution snapshot. Reuses
 * validateCompletionRequirement for the completion-requirement half (never
 * duplicates its rules), then applies the currentValue invariants:
 *
 *   DONE             -> currentValue must be absent/null
 *   DURATION         -> currentValue absent/null (not started), or a
 *                        finite number >= 0 (may exceed the snapshotted
 *                        target -- never clamped)
 *   MEASURED_TARGET   -> identical currentValue rule to DURATION
 *
 * Never throws.
 */
export function validateGoalActivityExecutionSnapshot(input: {
  completionRequirement: { kind: unknown; targetValue?: unknown; unit?: unknown };
  currentValue?: unknown;
}): GoalActivityExecutionSnapshotValidationResult {
  const crResult = validateCompletionRequirement(input.completionRequirement);
  if (!crResult.ok) return { ok: false, error: crResult.error };
  const requirement = crResult.requirement;

  const hasCurrentValue = input.currentValue !== undefined && input.currentValue !== null;

  if (requirement.kind === 'DONE') {
    if (hasCurrentValue) return { ok: false, error: 'DONE must not carry a numeric currentValue.' };
    return { ok: true, snapshot: { completionRequirement: requirement, currentValue: null } };
  }

  if (!hasCurrentValue) return { ok: true, snapshot: { completionRequirement: requirement, currentValue: null } };
  if (!isValidCurrentValue(input.currentValue)) return { ok: false, error: 'currentValue must be a finite number greater than or equal to 0.' };
  // Deliberately no upper bound against targetValue -- an actual value may
  // legitimately exceed the target (G2.2 audit's own established invariant).
  return { ok: true, snapshot: { completionRequirement: requirement, currentValue: input.currentValue } };
}

/** The exact shape GoalActivityExecution persists. Unlike GoalActivity's
 * own nullable completionKind (where NULL means "legacy/never specified" --
 * see goalCompletion.ts), completionKindSnapshot is NOT NULL: this table
 * has no legacy rows (it never existed before this validator did), so every
 * row must explicitly record what completion meant at creation time. */
export interface PersistedGoalActivityExecutionSnapshot {
  completionKindSnapshot: string;
  completionTargetValueSnapshot: number | null;
  completionUnitSnapshot: string | null;
  currentValue: number | null;
}

/** Canonical -> persisted. Straightforward field-for-field mapping -- no
 * DONE-to-null collapsing the way GoalCompletion's toPersistedCompletionRequirement
 * does, because there is nothing ambiguous to collapse here. */
export function toPersistedGoalActivityExecutionSnapshot(snapshot: GoalActivityExecutionSnapshot): PersistedGoalActivityExecutionSnapshot {
  return {
    completionKindSnapshot: snapshot.completionRequirement.kind,
    completionTargetValueSnapshot: snapshot.completionRequirement.targetValue ?? null,
    completionUnitSnapshot: snapshot.completionRequirement.unit ?? null,
    currentValue: snapshot.currentValue,
  };
}

/**
 * Persisted -> canonical. Unlike normalizeGoalActivityCompletionRequirement
 * (GoalActivity), this does NOT fall back to DONE on a validation failure:
 * a persisted GoalActivityExecution row was validated at write time
 * (validateGoalActivityExecutionSnapshot, via the future write path), and
 * this table has no legacy-row scenario to accommodate, so a row that fails
 * validation here indicates real corruption worth surfacing, not silently
 * papering over.
 */
export function fromPersistedGoalActivityExecutionSnapshot(persisted: PersistedGoalActivityExecutionSnapshot): GoalActivityExecutionSnapshot {
  const result = validateCompletionRequirement({
    kind: persisted.completionKindSnapshot,
    targetValue: persisted.completionTargetValueSnapshot,
    unit: persisted.completionUnitSnapshot,
  });
  if (!result.ok) throw new Error(`Corrupt GoalActivityExecution snapshot: ${result.error}`);
  return { completionRequirement: result.requirement, currentValue: persisted.currentValue };
}

export type ResolveCompletionActualValueResult =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

/**
 * Goals V2 G2.2.2 -- what currentValue should be written when a Goal-linked
 * PlannedActivity is completed (tap Done), given an OPTIONAL client-supplied
 * actualValue. Pure decision logic, no DB access; apps/web/lib/db.ts's
 * logPlannedActivity is the sole caller.
 *
 *   DONE             -> actualValue must be absent/null (there is nothing
 *                        to measure); supplied -> invalid, never silently
 *                        dropped.
 *   DURATION         -> absent -> the requirement's OWN target (one-tap
 *                        Done means "I completed the intended duration";
 *                        the user is never forced to re-type it). Supplied
 *                        -> must be finite and >= 0, then used verbatim
 *                        (may exceed target, never clamped).
 *   MEASURED_TARGET   -> identical rule to DURATION.
 *
 * Deliberately takes the ALREADY-RESOLVED requirement as input (the
 * caller's job is to decide whether that requirement came from the live
 * GoalActivity, first-write case, or from an ALREADY-EXISTING execution's
 * own immutable snapshot, existing-execution case -- see logPlannedActivity's
 * own doc comment) -- this function has no opinion on which.
 */
export function resolveCompletionActualValue(requirement: CompletionRequirement, actualValue?: number | null): ResolveCompletionActualValueResult {
  const hasActualValue = actualValue !== undefined && actualValue !== null;

  if (requirement.kind === 'DONE') {
    if (hasActualValue) return { ok: false, error: 'actualValue must not be supplied when completing a DONE-kind Goal activity.' };
    return { ok: true, value: null };
  }

  // DURATION / MEASURED_TARGET
  if (!hasActualValue) return { ok: true, value: requirement.targetValue ?? null };
  if (!isValidCurrentValue(actualValue)) return { ok: false, error: 'actualValue must be a finite number greater than or equal to 0.' };
  return { ok: true, value: actualValue };
}

// ============================================================
// Goals V2 G3.2/G3.3 -- activity-level completion detail ("what counts as
// doing this, and what happened"), the single canonical presentation rule
// shared by Goal Detail and Right Now. Deliberately separate from any
// lifecycle/derivedState label -- this function has NO opinion on
// SUGGESTED/PLANNED/COMPLETED and never receives that input at all,
// structurally incapable of inferring/overriding lifecycle truth from a
// numeric value (G3.2's own section 21/22 invariant).
//
// Plain template-literal number interpolation (never toFixed/
// Intl.NumberFormat) is the whole "fractional formatting" story here:
// `${30}` -> "30", `${12.5}` -> "12.5", `${1.25}` -> "1.25" -- JS's own
// default Number-to-string coercion already avoids both integer rounding
// and trailing zeros, so there is nothing further to implement.
// ============================================================

export function formatGoalActivityCompletion(completionRequirement: CompletionRequirement, currentValue: number | null): string | null {
  const { kind, targetValue, unit } = completionRequirement;
  // DONE carries no numeric progress at all (G2.1's own invariant) --
  // title + lifecycle state is sufficient; rendering "Target: Done" or a
  // fake 1/1 would be the exact over-explaining this slice avoids.
  if (kind === 'DONE') return null;

  // DURATION's unit is always implicitly "min" -- completionRequirement
  // never carries one for DURATION (G2.1's own invariant), and this
  // function never reads/persists a duration unit from anywhere else.
  const unitLabel = kind === 'DURATION' ? 'min' : unit;
  const targetLabel = `${targetValue} ${unitLabel}`;

  // No execution yet: target only. NULL means "nothing recorded", never
  // coerced to "0 <unit>" -- that would misrepresent an activity that
  // hasn't been attempted as one that was attempted and produced nothing.
  if (currentValue === null) return targetLabel;

  // Actual matches target exactly: the compact, non-redundant form --
  // applies identically to DURATION and MEASURED_TARGET, since the
  // underlying reasoning ("the target and actual are identical, repeating
  // both adds no information") is not kind-specific.
  if (currentValue === targetValue) return targetLabel;

  // Actual differs from target (below, above, or exactly zero) -- always
  // shown factually, current-value first, target second. Never clamped to
  // the target, never converted to a percentage, never labeled
  // partial/failed/missed/overachieved -- G2.2's own established
  // "actual is a fact, never judged" invariant.
  return `${currentValue} / ${targetLabel}`;
}
