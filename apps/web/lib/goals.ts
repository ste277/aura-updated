/**
 * Goals -> Planning Integration V1 PR A -- pure domain logic for the Goal /
 * GoalActivity persistence layer (apps/web/prisma/schema.prisma, migration
 * 0035). No DB access here -- see db.ts for CRUD, route.ts files under
 * app/api/goals/** for the HTTP boundary. Mirrors dayIntent.ts's own
 * convention of keeping domain rules pure and separately testable from
 * persistence.
 */

import { findActivityIntent } from '../../../packages/recommendation/src/personalizedTasks';

// ============================================================
// Persisted lifecycle (implementation design section 2/3) -- GoalActivity
// stores ONLY these two states. SELECTED (a mid Plan-My-Day-session
// choice) is deliberately never persisted here at all -- it lives purely
// in client state during a Plan My Day session (see the later handoff
// PR). PLANNED/COMPLETED are deliberately never persisted either: both
// are DERIVED below, by joining plannedActivityId's linked
// PlannedActivity.status, so they can never drift from what actually
// happened.
// ============================================================

export type GoalStatus = 'ACTIVE' | 'ARCHIVED';
export type GoalActivityStatus = 'SUGGESTED' | 'DISMISSED';
export type PlannedActivityStatus = 'UPCOMING' | 'LOGGED' | 'CANCELLED';

/** The full set of states a GoalActivity can be shown in, once persisted
 * state is combined with its linked PlannedActivity's real status. Never
 * persisted directly -- always computed by deriveGoalActivityState. */
export type DerivedGoalActivityState = 'SUGGESTED' | 'DISMISSED' | 'PLANNED' | 'COMPLETED';

export interface GoalActivityLifecycleInput {
  status: GoalActivityStatus;
  plannedActivityId: string | null;
  /** The linked PlannedActivity's own status, or null when
   * plannedActivityId is null, or when the referenced row could not be
   * loaded (e.g. hard-deleted -- see the plannedActivityId FK's own
   * ON DELETE SET NULL, which already handles that case by clearing
   * plannedActivityId itself, so `null` here should be rare in practice
   * but is handled identically to "never linked"). */
  linkedPlanStatus: PlannedActivityStatus | null;
}

/**
 * The smallest lifecycle that cannot lie (implementation design section
 * 3/7): PLANNED/COMPLETED/"available to plan again after cancellation"
 * are never separately stored, so they can never disagree with the real
 * PlannedActivity they're derived from.
 */
export function deriveGoalActivityState(input: GoalActivityLifecycleInput): DerivedGoalActivityState {
  if (input.status === 'DISMISSED') return 'DISMISSED';
  if (!input.plannedActivityId || !input.linkedPlanStatus) return 'SUGGESTED';
  if (input.linkedPlanStatus === 'CANCELLED') return 'SUGGESTED'; // available to plan again (replanning relinks the same row -- see db.ts)
  if (input.linkedPlanStatus === 'LOGGED') return 'COMPLETED';
  return 'PLANNED'; // linkedPlanStatus === 'UPCOMING'
}

// ============================================================
// Progress (implementation design section 15/25/26) -- a plain derived
// count, never a score, never persisted onto Goal.
// ============================================================

export interface GoalProgress {
  total: number;
  completed: number;
}

/**
 * total/completed exclude DISMISSED activities entirely (a dismissed
 * suggestion was never a commitment, so it should count in neither the
 * numerator nor the denominator). A CANCELLED plan's GoalActivity derives
 * back to SUGGESTED (see deriveGoalActivityState) and so is counted as
 * not-yet-done, same as any other unplanned activity -- no separate
 * cancellation bucket.
 */
export function computeGoalProgress(derivedStates: readonly DerivedGoalActivityState[]): GoalProgress {
  const nonDismissed = derivedStates.filter((state) => state !== 'DISMISSED');
  const completed = nonDismissed.filter((state) => state === 'COMPLETED').length;
  return { total: nonDismissed.length, completed };
}

// ============================================================
// Deterministic template taxonomy (implementation design section 16/27/28)
// -- a deliberately small, static, in-code decomposition table. No LLM, no
// probabilistic decomposition, no free-text inference.
//
// A NEW taxonomy, not a reuse of UserPriorityGroup (dayBuilder.ts,
// RELATIONSHIPS/WORK/WELLBEING/PERSONAL_GROWTH/ENJOYMENT/ROUTINE) or
// DailyIntentionGroupId (dailyIntentions.ts, RELATIONSHIPS/FAMILY/SOCIAL/
// WORK/SELF/ENJOYMENT/LIFE) -- both existing taxonomies describe WHAT LIFE
// DOMAIN a suggestion belongs to (used only for candidate ordering/
// grouping); GoalTemplateCategory instead describes WHAT DECOMPOSITION
// BEHAVIOR applies to free text a user typed. Reusing either would corrupt
// its existing, narrower meaning (e.g. "WORK" would have to mean both "an
// existing suggestion's life domain" and "expand this into project-review
// activities") even where a label happens to overlap.
// ============================================================

export type GoalTemplateCategory = 'GET_FITTER' | 'MEDITATE_REGULARLY' | 'FINISH_PROJECT' | 'STUDY_CONSISTENTLY';

export const GOAL_TEMPLATE_CATEGORIES: readonly GoalTemplateCategory[] = ['GET_FITTER', 'MEDITATE_REGULARLY', 'FINISH_PROJECT', 'STUDY_CONSISTENTLY'];

export function isGoalTemplateCategory(value: unknown): value is GoalTemplateCategory {
  return typeof value === 'string' && (GOAL_TEMPLATE_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Suggested GoalActivity titles per template category. Deliberately just
 * titles, not pre-baked activityId values: db.ts's createGoalWithTemplate
 * resolves each title against the LIVE catalog via findActivityIntent at
 * generation time (implementation design section 11/19 of this ticket --
 * "do not invent activity IDs", "do not persist a fallback activityId
 * unless the existing catalog semantics genuinely support that mapping").
 * Verified directly against the real catalog (packages/recommendation/src/
 * personalizedTasks.ts) before choosing these exact titles: "Go for a
 * run"/"Strength training session" both resolve to 'workout' (aliases
 * include 'run'/'training'), "Stretch / mobility" resolves to 'task-7'
 * ("Light Stretch & Mobility", aliases include 'stretch'/'mobility'),
 * "Meditate 10 minutes" resolves to 'meditation', "Study session"
 * resolves to 'learning' -- but "Block focus time"/"Review progress"/
 * "Final push session" resolve to NO catalog entry (deep-work's aliases
 * are 'deep work'/'focus work'/'focus session', none of which is a
 * substring of any of those three titles), so FINISH_PROJECT's
 * activities are correctly persisted with activityId = null, never
 * forced onto 'deep-work'.
 *
 * No recurring Habit creation in V1 for any category (implementation
 * design section 28: Habit stays a separate, later, optional linkage --
 * out of this PR's scope).
 *
 * targetDate relevance: only FINISH_PROJECT genuinely uses Goal.targetDate
 * as a per-activity deadline hint -- and even there, PR A does NOT add a
 * deadline column to GoalActivity (implementation design section 12); any
 * such propagation happens later, in the Plan My Day handoff PR, derived
 * from Goal.targetDate at handoff time, never duplicated here.
 */
export const GOAL_TEMPLATES: Readonly<Record<GoalTemplateCategory, readonly string[]>> = {
  GET_FITTER: ['Go for a run', 'Strength training session', 'Stretch / mobility'],
  MEDITATE_REGULARLY: ['Meditate 10 minutes'],
  FINISH_PROJECT: ['Block focus time', 'Review progress', 'Final push session'],
  STUDY_CONSISTENTLY: ['Study session'],
};

export interface ResolvedGoalTemplateActivity {
  title: string;
  activityId: string | null;
}

/**
 * Resolves a template category's static titles against the LIVE catalog
 * (findActivityIntent) right now, rather than baking ids into
 * GOAL_TEMPLATES -- a catalog change is reflected immediately, never
 * stale. Kept in this pure domain module (not db.ts) so db.ts's
 * createGoalWithActivities stays catalog-unaware, same convention as
 * createPlannedActivity's own "no catalog lookup" rule.
 */
export function resolveGoalTemplateActivities(category: GoalTemplateCategory): ResolvedGoalTemplateActivity[] {
  return GOAL_TEMPLATES[category].map((title) => ({ title, activityId: findActivityIntent(title)?.id ?? null }));
}

// ============================================================
// Civil-date encoding for Goal.targetDate (implementation design section
// 4) -- same convention as apps/web/app/api/daily-assistant/reflection/
// route.ts's own getReflectionDate: a "YYYY-MM-DD" string is encoded as
// literal UTC midnight ONLY as a storage mechanism for the @db.Date
// column, then read back via toGoalTargetDateString (below) rather than
// ever re-interpreted through any timezone. This is what stops a civil
// date from silently moving across a day boundary depending on server/
// viewer timezone.
// ============================================================

const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidCivilDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !CIVIL_DATE_PATTERN.test(value)) return false;
  // Reject a syntactically-shaped but calendrically-invalid date (e.g.
  // "2026-02-30") -- Date's own UTC constructor silently rolls invalid
  // day-of-month values forward rather than rejecting them, so the
  // round-trip through toGoalTargetDateString is what actually catches it.
  return toGoalTargetDateString(parseGoalTargetDate(value)) === value;
}

export function parseGoalTargetDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

export function toGoalTargetDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}
