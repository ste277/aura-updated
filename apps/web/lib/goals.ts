/**
 * Goals -> Planning Integration V1 PR A -- pure domain logic for the Goal /
 * GoalActivity persistence layer (apps/web/prisma/schema.prisma, migration
 * 0035). No DB access here -- see db.ts for CRUD, route.ts files under
 * app/api/goals/** for the HTTP boundary. Mirrors dayIntent.ts's own
 * convention of keeping domain rules pure and separately testable from
 * persistence.
 */

import { findActivityIntent } from '../../../packages/recommendation/src/personalizedTasks';
import type { CompletionRequirement } from './goalCompletion';

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
export type PlannedActivityStatus = 'UPCOMING' | 'LOGGED' | 'CANCELLED' | 'SKIPPED' | 'MOVED';

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
  // available to plan again (replanning relinks the same row -- see db.ts).
  // A SKIPPED link is a deliberate non-execution: never PLANNED/COMPLETED.
  // A link still on a MOVED plan is malformed (Move repoints to the successor
  // atomically): displayed as SUGGESTED, never PLANNED-forever or COMPLETED.
  // DISPLAY-only: linkGoalActivityToPlannedActivity fails closed for a MOVED link.
  if (input.linkedPlanStatus === 'CANCELLED' || input.linkedPlanStatus === 'SKIPPED' || input.linkedPlanStatus === 'MOVED') return 'SUGGESTED';
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
 * One template-defined activity: a static title plus an OPTIONAL canonical
 * CompletionRequirement (Goals V2 G3.4). Omitted means DONE, identically to
 * every other omitted-completionRequirement call site in this codebase
 * (createGoalWithActivities/addGoalActivity's own convention) -- there is
 * no separate "unset" template-only state to track.
 *
 * completionRequirement is assigned ONLY where the deterministic template
 * text itself, as already authored by this static table, unambiguously
 * states a quantity ("Meditate 10 minutes" literally contains "10
 * minutes") -- never inferred from the activity's catalog entry (a
 * catalog's defaultDurationMinutes is SCHEDULING metadata, not a
 * completion target -- see findActivityIntent's own ActivityProfile;
 * 'meditation' carries defaultDurationMinutes: 15, deliberately DIFFERENT
 * from this template's own DURATION target of 10, proving the two are
 * unrelated fields that must never be conflated), and never guessed to
 * make the feature look richer. G3.4's own audit (see its ticket section
 * 7) found exactly one such case across all four categories; every other
 * template activity stays DONE because its title carries no explicit,
 * deterministic quantity to safely encode.
 */
export interface GoalTemplateActivityDefinition {
  title: string;
  completionRequirement?: CompletionRequirement;
}

/**
 * Suggested GoalActivity titles (Goals V2 G3.4: plus an optional canonical
 * completionRequirement per activity) per template category. Deliberately
 * just titles, not pre-baked activityId values: db.ts's
 * createGoalWithTemplate resolves each title against the LIVE catalog via
 * findActivityIntent at generation time (implementation design section
 * 11/19 of this ticket -- "do not invent activity IDs", "do not persist a
 * fallback activityId unless the existing catalog semantics genuinely
 * support that mapping"). Verified directly against the real catalog
 * (packages/recommendation/src/personalizedTasks.ts) before choosing these
 * exact titles: "Go for a run"/"Strength training session" both resolve to
 * 'workout' (aliases include 'run'/'training'), "Stretch / mobility"
 * resolves to 'task-7' ("Light Stretch & Mobility", aliases include
 * 'stretch'/'mobility'), "Meditate 10 minutes" resolves to 'meditation',
 * "Study session" resolves to 'learning' -- but "Block focus time"/"Review
 * progress"/"Final push session" resolve to NO catalog entry (deep-work's
 * aliases are 'deep work'/'focus work'/'focus session', none of which is a
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
 *
 * G3.4 EXACT mapping (see its ticket section 7 for the full audit): every
 * activity below stays DONE (no completionRequirement field at all)
 * EXCEPT MEDITATE_REGULARLY's own "Meditate 10 minutes", which carries the
 * one deterministic, EXPLICIT quantity found anywhere in this table.
 * GET_FITTER's three activities ("Go for a run" etc.), FINISH_PROJECT's
 * three, and STUDY_CONSISTENTLY's one all carry no explicit numeric target
 * in their own static title text -- inventing one (e.g. "Study session" ->
 * 30 min) would be exactly the subjective guessing this slice forbids, so
 * they remain DONE and stay that way until a future ticket deterministically
 * justifies otherwise.
 */
export const GOAL_TEMPLATES: Readonly<Record<GoalTemplateCategory, readonly GoalTemplateActivityDefinition[]>> = {
  GET_FITTER: [{ title: 'Go for a run' }, { title: 'Strength training session' }, { title: 'Stretch / mobility' }],
  MEDITATE_REGULARLY: [{ title: 'Meditate 10 minutes', completionRequirement: { kind: 'DURATION', targetValue: 10 } }],
  FINISH_PROJECT: [{ title: 'Block focus time' }, { title: 'Review progress' }, { title: 'Final push session' }],
  STUDY_CONSISTENTLY: [{ title: 'Study session' }],
};

/**
 * Goals V2 Rhythm R5 -- this ticket's own section 10/11 audit. Purely
 * ADVISORY: it decides only whether Create Goal's own template step shows
 * a "how often would these help?" frequency section at all -- it never
 * chooses an exact N, never persists a default, and is not consulted by
 * any server-side write path (createGoalWithActivities/addGoalActivity
 * accept an explicit, user-chosen rhythm per activity or default to NONE
 * regardless of this table). GET_FITTER/MEDITATE_REGULARLY/
 * STUDY_CONSISTENTLY are activities a user plausibly repeats week over
 * week; FINISH_PROJECT's three activities ("Block focus time"/"Review
 * progress"/"Final push session") describe a bounded, one-time push
 * toward a deadline, so FINISH_PROJECT is classified finite and its own
 * Create Goal step never asks the frequency question at all (this
 * ticket's own section 34 -- FINISH_PROJECT activities persist NONE
 * unless the user later, explicitly, opts one into a weekly frequency
 * through Goal Detail's own per-row edit affordance, same as any other
 * activity).
 */
export const GOAL_TEMPLATE_LIKELY_ONGOING: Readonly<Record<GoalTemplateCategory, boolean>> = {
  GET_FITTER: true,
  MEDITATE_REGULARLY: true,
  FINISH_PROJECT: false,
  STUDY_CONSISTENTLY: true,
};

export interface ResolvedGoalTemplateActivity {
  title: string;
  activityId: string | null;
  completionRequirement?: CompletionRequirement;
}

/**
 * Resolves a template category's static titles against the LIVE catalog
 * (findActivityIntent) right now, rather than baking ids into
 * GOAL_TEMPLATES -- a catalog change is reflected immediately, never
 * stale. Kept in this pure domain module (not db.ts) so db.ts's
 * createGoalWithActivities stays catalog-unaware, same convention as
 * createPlannedActivity's own "no catalog lookup" rule.
 *
 * completionRequirement (Goals V2 G3.4) passes straight through from the
 * static table -- never derived from the resolved catalog entry (see
 * GOAL_TEMPLATES's own doc comment on why scheduling-duration metadata
 * must never become a completion target).
 */
export function resolveGoalTemplateActivities(category: GoalTemplateCategory): ResolvedGoalTemplateActivity[] {
  return GOAL_TEMPLATES[category].map((entry) => ({
    title: entry.title,
    activityId: findActivityIntent(entry.title)?.id ?? null,
    completionRequirement: entry.completionRequirement,
  }));
}

// ============================================================
// Goals V2 Candidate B1 -- deterministic outcome text -> existing
// GoalTemplateCategory matching. The smallest missing bridge between a
// free-text Goal outcome ("I want to get fitter") and the already-shipped
// GOAL_TEMPLATES table above. Matching ONLY -- never activity resolution
// (resolveGoalTemplateActivities above still owns that, unchanged, once a
// category is chosen), never persistence, never UI.
//
// Deliberately NOT findActivityIntent's own longest-alias-wins substring
// semantics (personalizedTasks.ts): an activity-alias false positive just
// mislabels one suggested task, but a Goal-category false positive would
// silently decompose the wrong Goal into the wrong set of activities --
// so this match is intentionally stricter (whole-phrase, word-boundary
// matching only) and intentionally conservative (an ambiguous match
// across more than one category returns null rather than guessing; a
// false negative just falls back to the existing manual "Start from
// scratch" flow, which is always the safe outcome).
// ============================================================

/**
 * One small, explicit set of matching phrases per category -- a `satisfies
 * Record<GoalTemplateCategory, ...>` contract (not a separate taxonomy)
 * so that adding a new GoalTemplateCategory without adding its matching
 * vocabulary here is a TypeScript compile error, never silent drift.
 * Phrases only -- never GoalActivity titles, activityId, completion
 * requirements, Rhythm, or durations, all of which stay owned entirely by
 * GOAL_TEMPLATES above.
 */
export const GOAL_TEMPLATE_CATEGORY_MATCH_PHRASES = {
  GET_FITTER: ['get fitter', 'get fit', 'improve fitness', 'improve my fitness', 'exercise regularly', 'work out regularly', 'workout regularly'],
  MEDITATE_REGULARLY: ['meditate regularly', 'start meditating', 'meditate more', 'build a meditation habit'],
  FINISH_PROJECT: ['finish my project', 'complete my project', 'finish a project', 'finish the project'],
  STUDY_CONSISTENTLY: ['study consistently', 'study regularly', 'build a study habit'],
} satisfies Record<GoalTemplateCategory, readonly string[]>;

/** trim + lowercase + collapse whitespace + turn harmless punctuation into
 * a word separator. Deliberately NOT stemming, fuzzy/edit-distance
 * matching, embeddings, semantic similarity, scoring, locale-sensitive
 * inference, or an LLM -- see this function's own callers for why. */
function normalizeGoalOutcomeText(outcome: string): string {
  return outcome
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Whole-phrase, word-boundary matching only (never unrestricted substring
 * containment) -- "get fitter" matches inside "my goal is to get fitter
 * this year" but "get fitterish" (a longer, unrelated word) does not,
 * because \b requires a real word boundary immediately after "fitter". */
function phraseMatchesNormalizedOutcome(normalizedOutcome: string, phrase: string): boolean {
  const escapedPhrase = phrase
    .split(' ')
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  return new RegExp(`\\b${escapedPhrase}\\b`).test(normalizedOutcome);
}

/**
 * Goal outcome free text -> an existing GoalTemplateCategory, or null when
 * no category matches confidently, OR more than one distinct category
 * matches (a multi-intent outcome like "get fitter and study
 * consistently" is never resolved by silently picking one). Receives
 * ONLY the outcome text -- no Goal id, user id, target date, calendar
 * context, history, Panchang, location, Rhythm, or completion state --
 * so it is usable before any Goal exists. Never calls findActivityIntent:
 * Goal-category classification and activity-catalog resolution are
 * different responsibilities.
 */
export function matchGoalTemplateCategory(outcome: string): GoalTemplateCategory | null {
  const normalized = normalizeGoalOutcomeText(outcome);
  if (normalized.length === 0) return null;
  const matchedCategories = GOAL_TEMPLATE_CATEGORIES.filter((category) =>
    GOAL_TEMPLATE_CATEGORY_MATCH_PHRASES[category].some((phrase) => phraseMatchesNormalizedOutcome(normalized, phrase))
  );
  return matchedCategories.length === 1 ? matchedCategories[0] : null;
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
