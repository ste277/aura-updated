/**
 * Goals V2 G2.1 -- the canonical, pure domain representation of "what
 * counts as completing one occurrence of this GoalActivity?" (G1
 * architecture audit, accepted decisions 1/2/5). No DB access here -- same
 * convention as lib/goals.ts. This slice establishes the definition only;
 * it does not implement occurrence progress, inference, checklists, or
 * recurrence (all deferred, see the G1 audit).
 *
 * GoalActivity owns this requirement (G1 decision 2) -- Goal and
 * PlannedActivity never gain a completion-requirement field of their own.
 */

export type CompletionKind = 'DONE' | 'DURATION' | 'MEASURED_TARGET';

export const COMPLETION_KINDS: readonly CompletionKind[] = ['DONE', 'DURATION', 'MEASURED_TARGET'];

export function isCompletionKind(value: unknown): value is CompletionKind {
  return typeof value === 'string' && (COMPLETION_KINDS as readonly string[]).includes(value);
}

/**
 * COUNT and QUANTITY are deliberately not separate kinds (G1 decision 5):
 * "8 glasses", "20 pages", "5 km", "6000 steps" are all the same shape,
 * targetValue + a free-form display unit -- collapsed into MEASURED_TARGET.
 *
 * targetValue is a plain number, never rounded/floored/clamped -- a
 * fractional target ("2.5 km") must round-trip exactly.
 *
 * The DURATION kind's implicit unit is minutes; `unit` must stay absent for
 * it (a second, redundant unit field for DURATION would just invite it to
 * disagree with "minutes").
 */
export interface CompletionRequirement {
  kind: CompletionKind;
  targetValue?: number;
  unit?: string;
}

/** The canonical, singleton DONE requirement -- what every existing
 * GoalActivity means today, and what a legacy/unset row normalizes to
 * (see normalizeGoalActivityCompletionRequirement below). */
export const DONE_COMPLETION_REQUIREMENT: CompletionRequirement = { kind: 'DONE' };

export type CompletionRequirementValidationResult =
  | { ok: true; requirement: CompletionRequirement }
  | { ok: false; error: string };

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Pure validation of a candidate CompletionRequirement, covering exactly
 * the G2.1 invariants (no unit registry, no unit conversion, no clamping):
 *
 *   DONE             -> targetValue/unit must both be absent
 *   DURATION         -> targetValue required, > 0; unit must be absent
 *                        (implicit unit is minutes)
 *   MEASURED_TARGET   -> targetValue required, > 0; unit required,
 *                        non-blank
 *
 * Never throws -- callers decide what an invalid result means for them.
 */
export function validateCompletionRequirement(input: {
  kind: unknown;
  targetValue?: unknown;
  unit?: unknown;
}): CompletionRequirementValidationResult {
  if (!isCompletionKind(input.kind)) {
    return { ok: false, error: `Unknown completion kind: ${String(input.kind)}.` };
  }

  const hasTargetValue = input.targetValue !== undefined && input.targetValue !== null;
  const hasUnit = input.unit !== undefined && input.unit !== null;

  if (input.kind === 'DONE') {
    if (hasTargetValue) return { ok: false, error: 'DONE must not carry a targetValue.' };
    if (hasUnit) return { ok: false, error: 'DONE must not carry a unit.' };
    return { ok: true, requirement: { kind: 'DONE' } };
  }

  if (input.kind === 'DURATION') {
    if (!hasTargetValue || !isPositiveFiniteNumber(input.targetValue)) {
      return { ok: false, error: 'DURATION requires a targetValue greater than 0.' };
    }
    if (hasUnit) return { ok: false, error: 'DURATION must not carry a unit (the implicit unit is minutes).' };
    return { ok: true, requirement: { kind: 'DURATION', targetValue: input.targetValue } };
  }

  // MEASURED_TARGET
  if (!hasTargetValue || !isPositiveFiniteNumber(input.targetValue)) {
    return { ok: false, error: 'MEASURED_TARGET requires a targetValue greater than 0.' };
  }
  if (!hasUnit || typeof input.unit !== 'string' || input.unit.trim().length === 0) {
    return { ok: false, error: 'MEASURED_TARGET requires a non-blank unit.' };
  }
  return { ok: true, requirement: { kind: 'MEASURED_TARGET', targetValue: input.targetValue, unit: input.unit } };
}

/** The exact nullable shape GoalActivity persists (three independent
 * nullable columns, no default -- see migration 0040's own doc comment). */
export interface PersistedCompletionRequirement {
  completionKind: string | null;
  completionTargetValue: number | null;
  completionUnit: string | null;
}

/**
 * Canonical -> persisted. DONE always persists as all-null (indistinguishable
 * from a legacy/never-set row -- deliberately: there is no behavioral
 * difference between "explicitly DONE" and "never specified", so there is
 * nothing to gain from encoding them differently, and every reader already
 * normalizes null the same way).
 */
export function toPersistedCompletionRequirement(requirement: CompletionRequirement): PersistedCompletionRequirement {
  if (requirement.kind === 'DONE') {
    return { completionKind: null, completionTargetValue: null, completionUnit: null };
  }
  return {
    completionKind: requirement.kind,
    completionTargetValue: requirement.targetValue ?? null,
    completionUnit: requirement.unit ?? null,
  };
}

/**
 * Persisted (possibly legacy/null) -> canonical. A null/unrecognized
 * completionKind ALWAYS normalizes to DONE (G2.1's critical backward-
 * compatibility rule) -- this covers both a genuinely legacy pre-G2.1 row
 * and a new row created without an explicit requirement, identically, on
 * purpose: there is no "when" distinction worth making, only "was one ever
 * specified". A persisted row that fails validation (should not happen via
 * the writers in this module, but never trusted blindly) also falls back to
 * DONE rather than surfacing a domain error at read time.
 */
export function normalizeGoalActivityCompletionRequirement(persisted: PersistedCompletionRequirement): CompletionRequirement {
  if (persisted.completionKind === null) return DONE_COMPLETION_REQUIREMENT;
  const result = validateCompletionRequirement({
    kind: persisted.completionKind,
    targetValue: persisted.completionTargetValue,
    unit: persisted.completionUnit,
  });
  return result.ok ? result.requirement : DONE_COMPLETION_REQUIREMENT;
}
