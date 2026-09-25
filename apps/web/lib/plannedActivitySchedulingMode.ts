/**
 * Remaining-Day Recomposition V1 PR F1 -- the persisted scheduling mode of a
 * committed PlannedActivity.
 *
 * SEMANTICS (the one place they are defined):
 *
 *   FIXED     the occurrence's time is a commitment. It is protected from any
 *             Aura-driven recomposition.
 *   FLEXIBLE  Aura may PROPOSE another time for this occurrence. It is
 *             permission to propose, never permission to move: recomposition
 *             always requires the user's explicit acceptance.
 *   null      legacy / unknown scheduling intent. PROTECTED (fail closed).
 *
 * It is NOT acquisition provenance (that stays unpersisted -- migration 0025's
 * house rule): it records the user's scheduling constraint, which the Day
 * Constructor already models as `DayIntent.flexibility`. Persisting it keeps
 * that vocabulary across planning and persistence.
 *
 * An explicit user Move is independent of it (a FIXED plan can still be moved
 * by the user) and a Move successor INHERITS it exactly -- Move neither grants
 * nor removes recomposition permission. The AuraMoment (`HAS_LINKED_MOMENT`)
 * restriction is likewise independent; a future recomposition must satisfy both.
 *
 * FAIL-CLOSED RELEASE INVARIANT: only an explicit persisted `'FLEXIBLE'` may
 * ever make a plan a recomposition candidate. null, undefined, a missing field,
 * an unknown value or a mapper fallback must never become FLEXIBLE -- which is
 * why every reader goes through `hasFlexibleScheduling` / `parseSchedulingMode`.
 *
 * Deliberately NOT here: recomposition eligibility (that later combines this
 * with lifecycle status and time) -- see `hasFlexibleScheduling`.
 */
import type { DayIntentFlexibility } from './dayIntent';

/** The DB enum `PlannedActivitySchedulingMode` (migration 0039). Same vocabulary as `DayIntentFlexibility`, kept as its own persistence-layer type. */
export type PlannedActivitySchedulingMode = 'FIXED' | 'FLEXIBLE';

/** Exact-match parse of an untrusted/unknown value. Anything that is not exactly 'FIXED' or 'FLEXIBLE' (including 'flexible', undefined, numbers) is null = unknown = protected. */
export function parseSchedulingMode(value: unknown): PlannedActivitySchedulingMode | null {
  return value === 'FIXED' || value === 'FLEXIBLE' ? value : null;
}

/**
 * The scheduling-semantics half of "may Aura propose moving this?": true ONLY for an explicit persisted
 * FLEXIBLE. It deliberately does not look at lifecycle status or time; a future recomposition eligibility
 * helper combines it with those. null / undefined / FIXED / anything else is false.
 */
export function hasFlexibleScheduling(plan: { schedulingMode?: unknown } | null | undefined): boolean {
  return plan?.schedulingMode === 'FLEXIBLE';
}

/** A DayIntent's constraint carried through planning and persistence unchanged. */
export function schedulingModeFromFlexibility(flexibility: DayIntentFlexibility): PlannedActivitySchedulingMode {
  return flexibility === 'FIXED' ? 'FIXED' : 'FLEXIBLE';
}

/**
 * Day Constructor acceptance: a proposed item's `placementSource` is exactly its intent's constraint -- the
 * Constructor places a FIXED intent only from its own FixedPlacementConstraint (`FIXED_CONSTRAINT`) and a
 * FLEXIBLE intent only by choosing a candidate (`SELECTED_CANDIDATE`). Accepting Aura's proposed time therefore
 * does NOT turn a FLEXIBLE intent into FIXED. Anything unrecognised is null (protected).
 */
export function schedulingModeFromPlacementSource(placementSource: unknown): PlannedActivitySchedulingMode | null {
  if (placementSource === 'FIXED_CONSTRAINT') return 'FIXED';
  if (placementSource === 'SELECTED_CANDIDATE') return 'FLEXIBLE';
  return null;
}

/**
 * Every DIRECT plan creation (`POST /api/plans`: Timing Search "Use this time", Ask Aura, Forward Planner, Home
 * Opportunity, Day Builder Add, My Day Story, Muhurtham Finder, guest conversion, the Plan tab) means the user
 * explicitly chose an exact time outside the Constructor's flexible-placement workflow, and none of those flows
 * carries durable FLEXIBLE semantics. So they are FIXED: recomposition permission is never granted that the user
 * never gave. Server-side constant, never read from the request.
 */
export const DIRECT_PLAN_SCHEDULING_MODE: PlannedActivitySchedulingMode = 'FIXED';
