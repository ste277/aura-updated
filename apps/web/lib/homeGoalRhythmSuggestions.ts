/**
 * HGR1 -- Home Goal-Rhythm Integration.
 * HGR2 -- Home Goal-Rhythm Prioritization and Overflow (this file's
 * `prioritizeGoalRhythmSuggestions`/`splitVisibleAndOverflowGoalRhythmSuggestions`/
 * `computeGoalRhythmHomeView`/`excludeGoalRhythmSuggestionsDuplicatingActivities`).
 *
 * Pure presentation projection ONLY: turns the already-eligible,
 * already-computed `GoalDemandCandidate[]` (goalDemandCandidates.ts's own
 * `loadEligibleGoalDemand`, the exact same read model Plan My Day's
 * `resolveAutomaticGoalDemand` already consumes) into the small shape
 * Home's own suggestion card needs. This file performs NO eligibility
 * computation, NO week-boundary math, and NO duplicate-suppression of its
 * own eligibility sense -- every one of those is already decided by
 * `loadEligibleGoalDemand` before a candidate ever reaches this file.
 * `remainingThisWeek`/`targetPerWeek` are carried through unchanged from
 * the candidate's own `rhythm` fact, never re-derived or estimated (this
 * ticket's own instruction: "do not invent progress, completion or
 * urgency").
 *
 * The planning handoff is the SAME `?fromGoal=<goalId>&activities=<id>`
 * query-string contract `GoalDetailClient.tsx`'s own `handlePlanWithAura`
 * already uses to hand a manual GoalActivity selection to Plan My Day
 * (`planDayBootstrap.ts`'s `resolveGoalActivityHandoff`) -- this file
 * builds the same two params, never a new scheduling/acceptance path.
 *
 * HGR2 PRIORITIZATION RULE (this ticket's own section 3): `dailyGuidance*.ts`
 * (Home's existing astrology-ranked recommendation pipeline) has no
 * cross-candidate priority score at all -- its own "ranking" is entirely
 * about choosing the best TIMING WINDOW for one already-selected concrete
 * activity (dailyGuidanceSameFamily.ts's own "never re-sorts/re-scores
 * rank 1" doc comment), never about ordering multiple different
 * activities against each other. A Goal-Rhythm candidate has no timing
 * window at all yet (it is unplaced weekly-aggregate demand, not a single
 * scheduled/searched instant), so there is no safe, meaningful way to
 * reuse that pipeline's signals here -- forcing one would mean running a
 * new per-candidate timing search, which is exactly the "new timing
 * recommendation engine" this ticket forbids building. The deterministic
 * fallback below instead reuses ONE signal this ticket's own section 3
 * explicitly names as acceptable -- "remaining weekly demand" -- applied
 * directly from the already-computed, never-re-derived `remainingThisWeek`
 * fact, descending; ties break on the SAME stable, non-semantic
 * `goalActivityId` key `loadEligibleGoalDemand`'s own sort already uses,
 * so ordering is 100% deterministic across repeated loads of identical
 * underlying state. This is not a new/invented urgency score: it never
 * amplifies, weights, or combines signals, and it never labels any
 * candidate as time-critical -- a candidate with more remaining demand
 * simply sorts first, exactly mirroring the fact already shown in its own
 * `progressLabel`.
 */
import type { GoalDemandCandidate } from './goalDemandCandidates';

export interface HomeGoalRhythmSuggestion {
  goalActivityId: string;
  goalId: string;
  goalTitle: string;
  title: string;
  /** Carried verbatim from GoalDemandCandidate.activityId -- the same
   * ActivityProfile-catalog id convention as PlannedActivity.activityId/
   * HabitLog.activityId/dailyGuidanceTypes.ts's own SelectedActivityMetadata.activityId.
   * Used ONLY for cross-surface duplicate detection (HGR2 section 6),
   * never rendered, never used for eligibility. */
  activityId: string | null;
  /** Carried verbatim from GoalDemandCandidate.remainingThisWeek -- never re-derived. */
  remainingThisWeek: number;
  /** Carried verbatim from GoalDemandCandidate.rhythm.targetPerWeek -- never re-derived. */
  targetPerWeek: number;
  /** Factual-only progress copy, e.g. "2 sessions remaining this week" -- built
   * exclusively from the two fields above, never from a guessed/estimated count. */
  progressLabel: string;
  /** The exact `?fromGoal=&activities=` pair for the existing Plan My Day
   * handoff -- a component builds its own URLSearchParams/href from this,
   * mirroring GoalDetailClient.tsx's own handlePlanWithAura convention. */
  planHandoff: { fromGoal: string; activities: string };
}

/** Pure, no DB, no Date.now() -- exported so a test can exercise the exact
 * singular/plural boundary without constructing a full candidate. */
export function formatRhythmRemainingLabel(remainingThisWeek: number, targetPerWeek: number): string {
  const sessionWord = remainingThisWeek === 1 ? 'session' : 'sessions';
  return `${remainingThisWeek} ${sessionWord} remaining this week (of ${targetPerWeek})`;
}

/**
 * 1:1 projection, order-preserving (never re-sorts/re-prioritizes --
 * `loadEligibleGoalDemand`'s own stable, non-semantic sort is the only
 * ordering applied, same as every other consumer of that read model).
 * HGR2's own prioritization/cap/overflow (below) is applied downstream of
 * this function, never inside it -- this stays a pure, order-preserving
 * projection exactly as HGR1 shipped it.
 */
export function mapGoalDemandToHomeRhythmSuggestions(candidates: readonly GoalDemandCandidate[]): HomeGoalRhythmSuggestion[] {
  return candidates.map((candidate) => ({
    goalActivityId: candidate.goalActivityId,
    goalId: candidate.goalId,
    goalTitle: candidate.goalTitle,
    title: candidate.title,
    activityId: candidate.activityId,
    remainingThisWeek: candidate.remainingThisWeek,
    targetPerWeek: candidate.rhythm.targetPerWeek,
    progressLabel: formatRhythmRemainingLabel(candidate.remainingThisWeek, candidate.rhythm.targetPerWeek),
    planHandoff: { fromGoal: candidate.goalId, activities: candidate.goalActivityId },
  }));
}

// ============================================================
// HGR2 -- Home Goal-Rhythm Prioritization and Overflow.
// ============================================================

/** The default number of Goal-Rhythm suggestion cards Home shows before
 * requiring a "View all" tap (this ticket's own section 2: "a maximum of
 * three visible Goal-Rhythm suggestions initially"). */
export const GOAL_RHYTHM_VISIBLE_CAP = 3;

/**
 * Deterministic fallback ordering -- see this file's own module doc
 * comment for why reusing `dailyGuidance*.ts`'s existing ranking signals
 * is not safe/meaningful here, and why this is a reuse of an EXISTING,
 * already-computed signal ("remaining weekly demand") rather than an
 * invented urgency score. Never mutates its input array.
 */
export function prioritizeGoalRhythmSuggestions(suggestions: readonly HomeGoalRhythmSuggestion[]): HomeGoalRhythmSuggestion[] {
  return [...suggestions].sort((a, b) => {
    if (a.remainingThisWeek !== b.remainingThisWeek) return b.remainingThisWeek - a.remainingThisWeek;
    return a.goalActivityId.localeCompare(b.goalActivityId);
  });
}

/**
 * Splits an already-prioritized list at `cap` -- the ONLY place the
 * three-card limit is enforced. This never touches the underlying
 * candidate set `loadEligibleGoalDemand` returned (this ticket's own
 * section 2: "do not truncate the underlying eligible candidate set
 * merely to enforce the UI limit") -- `overflow` below remains the
 * complete, addressable remainder, reachable in full via "View all".
 */
export function splitVisibleAndOverflowGoalRhythmSuggestions(
  prioritized: readonly HomeGoalRhythmSuggestion[],
  cap: number = GOAL_RHYTHM_VISIBLE_CAP
): { visible: HomeGoalRhythmSuggestion[]; overflow: HomeGoalRhythmSuggestion[] } {
  return { visible: prioritized.slice(0, cap), overflow: prioritized.slice(cap) };
}

/**
 * The single real production entry point the Home card calls (this
 * ticket's own section 7 test 8: dismissal promotes the next item).
 * Filtering dismissed ids BEFORE prioritizing/splitting is what makes
 * promotion automatic and correct -- there is no separate "promote"
 * step: once a dismissed id is removed from the input, the
 * previously-4th-ranked (overflow) suggestion naturally becomes the new
 * 3rd visible one on the very next render, with its ordering among the
 * remaining items otherwise unchanged.
 */
export function computeGoalRhythmHomeView(
  suggestions: readonly HomeGoalRhythmSuggestion[],
  dismissedIds: ReadonlySet<string>,
  cap: number = GOAL_RHYTHM_VISIBLE_CAP
): { visible: HomeGoalRhythmSuggestion[]; overflow: HomeGoalRhythmSuggestion[] } {
  const notDismissed = suggestions.filter((s) => !dismissedIds.has(s.goalActivityId));
  const prioritized = prioritizeGoalRhythmSuggestions(notDismissed);
  return splitVisibleAndOverflowGoalRhythmSuggestions(prioritized, cap);
}

/**
 * HGR2 section 6 -- duplicate avoidance against other Home surfaces
 * (today, only `dailyGuidance*.ts`'s "Best For You" feed). Suppresses a
 * suggestion ONLY when its `activityId` is non-null and matches an
 * activityId already shown elsewhere on Home -- the same
 * ActivityProfile-catalog identity `SelectedActivityMetadata.activityId`
 * (dailyGuidanceTypes.ts) carries, never a title-text comparison (this
 * ticket's own section 6: "do not suppress distinct activities merely
 * because their titles match"). A `null` activityId (a GoalActivity with
 * no linked catalog Activity at all) can never collide with anything and
 * is always kept.
 */
export function excludeGoalRhythmSuggestionsDuplicatingActivities(
  suggestions: readonly HomeGoalRhythmSuggestion[],
  activityIdsAlreadyShownOnHome: ReadonlySet<string>
): HomeGoalRhythmSuggestion[] {
  return suggestions.filter((s) => s.activityId === null || !activityIdsAlreadyShownOnHome.has(s.activityId));
}
