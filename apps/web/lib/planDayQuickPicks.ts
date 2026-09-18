/**
 * Plan My Day UX V2 -- PR U1: the curated Quick Picks list.
 *
 * LOCKED SET (this ticket's own section 3/4) -- six entries, static,
 * deterministic, never reordered by behavior/history/preference/time of
 * day/Panchang/Muhurta (this ticket's own section 42: "Future
 * enhancement," not U1 scope).
 *
 * `activityId`, where present, is a REAL, current `ActivityProfile.id`
 * from the existing catalog (`packages/recommendation/src/
 * personalizedTasks.ts`) -- never fabricated (this ticket's own section
 * 41: "Do not edit personalizedTasks.ts... Do not add Errands merely to
 * make all six picks symmetrical"). `icon` is looked up from that SAME
 * catalog entry, never duplicated here as a second literal -- Errands
 * has no catalog entry, so it has no icon (this ticket's own section 43:
 * "Errands may be iconless if no canonical source exists").
 *
 * The `activityId` a pick carries is UNTRUSTED input once it reaches the
 * server, exactly like any other client-supplied value -- F1's own
 * request parser (dayConstructorPreviewRequest.ts) and the orchestrator's
 * own `resolveActivity` (dayConstructorOrchestrator.ts) already
 * re-validate any supplied `activityId` via `getActivityProfileById`
 * before trusting it, falling through to ordinary title-based resolution
 * for anything that doesn't resolve -- this file adds no new trust
 * boundary, it only supplies a value that existing validation already
 * defends against being wrong.
 */

import { getActivityProfileById } from '../../../packages/recommendation/src/personalizedTasks';

export interface PlanDayQuickPick {
  /** The exact row title a tap produces -- also the display label. */
  label: string;
  /** A real, current catalog id, or omitted when no single catalog
   * activity represents this pick (Errands: no schedulable catalog
   * activity exists for it -- the existing title-based resolver/
   * classifier owns its downstream handling, exactly as it already does
   * for any free-text "errand..." intent). */
  activityId?: string;
}

export const PLAN_DAY_QUICK_PICKS: readonly PlanDayQuickPick[] = [
  { label: 'Focus', activityId: 'deep-work' },
  { label: 'Workout', activityId: 'workout' },
  { label: 'Learn', activityId: 'learning' },
  { label: 'Errands' },
  { label: 'Meditate', activityId: 'meditation' },
  { label: 'Quiet time', activityId: 'quiet-time' },
] as const;

/** `undefined` for Errands (no catalog id) or if a referenced id were
 * ever removed from the catalog -- never a guessed/fallback icon. */
export function quickPickIcon(pick: PlanDayQuickPick): string | undefined {
  if (!pick.activityId) return undefined;
  return getActivityProfileById(pick.activityId)?.icon;
}
