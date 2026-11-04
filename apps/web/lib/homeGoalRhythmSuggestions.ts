/**
 * HGR1 -- Home Goal-Rhythm Integration.
 *
 * Pure presentation projection ONLY: turns the already-eligible,
 * already-computed `GoalDemandCandidate[]` (goalDemandCandidates.ts's own
 * `loadEligibleGoalDemand`, the exact same read model Plan My Day's
 * `resolveAutomaticGoalDemand` already consumes) into the small shape
 * Home's own suggestion card needs. This file performs NO eligibility
 * computation, NO week-boundary math, and NO duplicate-suppression of its
 * own -- every one of those is already decided by `loadEligibleGoalDemand`
 * before a candidate ever reaches this file. `remainingThisWeek`/
 * `targetPerWeek` are carried through unchanged from the candidate's own
 * `rhythm` fact, never re-derived or estimated (this ticket's own
 * instruction: "do not invent progress, completion or urgency").
 *
 * The planning handoff is the SAME `?fromGoal=<goalId>&activities=<id>`
 * query-string contract `GoalDetailClient.tsx`'s own `handlePlanWithAura`
 * already uses to hand a manual GoalActivity selection to Plan My Day
 * (`planDayBootstrap.ts`'s `resolveGoalActivityHandoff`) -- this file
 * builds the same two params, never a new scheduling/acceptance path.
 */
import type { GoalDemandCandidate } from './goalDemandCandidates';

export interface HomeGoalRhythmSuggestion {
  goalActivityId: string;
  goalId: string;
  goalTitle: string;
  title: string;
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
 */
export function mapGoalDemandToHomeRhythmSuggestions(candidates: readonly GoalDemandCandidate[]): HomeGoalRhythmSuggestion[] {
  return candidates.map((candidate) => ({
    goalActivityId: candidate.goalActivityId,
    goalId: candidate.goalId,
    goalTitle: candidate.goalTitle,
    title: candidate.title,
    remainingThisWeek: candidate.remainingThisWeek,
    targetPerWeek: candidate.rhythm.targetPerWeek,
    progressLabel: formatRhythmRemainingLabel(candidate.remainingThisWeek, candidate.rhythm.targetPerWeek),
    planHandoff: { fromGoal: candidate.goalId, activities: candidate.goalActivityId },
  }));
}
