/**
 * Constructor Decision Intelligence -- Decision Facts V1 (architecture-
 * foundation slice, per the architecture audit at main@4693891).
 *
 * The one generic, source-neutral contract a candidate source may attach
 * to a `DayIntent` so a FUTURE Decision Policy layer can reason about it
 * -- never consumed by `dayConstructor.ts`'s own placement/precedence
 * logic in V1 (see that file's own callers for why: this ticket's own
 * section 8/21, "raw remainingOccurrences is not equivalent to deferral
 * pressure"). Carried purely as inert metadata for now.
 *
 * FACTS, NOT POLICY (this ticket's own section 5): every field here is a
 * plain, already-canonically-computed factual input. There is
 * deliberately no `priority`/`priorityScore`/`urgencyScore`/`rank`/
 * `weight`/`boost`/`penalty` field, and never will be on THIS type --
 * any such derived value belongs to a future Decision Policy layer that
 * CONSUMES these facts, never to the facts themselves.
 *
 * SOURCE-NEUTRAL (this ticket's own section 6): no `goalId`/
 * `goalActivityId`/`source`/`templateCategory` field exists here. A
 * future non-Goal source (a deadline task, a wellbeing engine, an MCP
 * connector) populates the exact same shape; nothing here can be read as
 * "this came from a Goal."
 */

import { classifyGoalDemandIntentId } from './goalDemandIntentId';

/**
 * The four values `computeGoalActivityRhythmEligibility`
 * (goalActivityRhythm.ts) already computes for an eligible recurring
 * GoalActivity -- reused verbatim, never re-derived here. Despite the
 * name, this shape is not Goal-specific: it describes "how many times
 * per week must this recur, and where does this week's count currently
 * stand" for ANY source that has a weekly-recurrence concept. Goals are
 * simply the only source that has one today.
 */
export interface RhythmDecisionFacts {
  targetPerWeek: number;
  completedThisWeek: number;
  committedThisWeek: number;
  /** The exact `remainingOccurrences` the Rhythm engine computes --
   * never negative, never re-derived. A bare count only: this ticket's
   * own section 8 explicitly forbids treating it as deferral pressure by
   * itself (it cannot distinguish "two remaining, many viable windows
   * left" from "two remaining, this is the last viable window" -- see
   * the architecture audit's own section 19/20). */
  remainingOccurrences: number;
}

/**
 * The full generic fact set a `DayIntent` may carry. V1 defines exactly
 * one fact group (`rhythm`); future slices may add others (e.g. a
 * deadline-proximity fact, a wellbeing-scarcity fact) without touching
 * any existing field or any existing source's wiring.
 */
export interface DecisionFacts {
  rhythm?: RhythmDecisionFacts;
}

/**
 * THE Decision Policy boundary for V1 (architecture audit section 34/43,
 * this ticket's own section 14) -- the one pure function standing
 * between a real-data fetch (the orchestrator's own job, never this
 * function's) and `dayConstructor.ts` (which never sees this function or
 * any Goal concept at all). Receives a normalized intent id plus
 * already-fetched factual metadata; returns generic decision-ready
 * facts, or `undefined` for an intent with none to offer. No DB, no
 * Goal-service calls, no ranking/placement decision, no LLM -- a plain,
 * synchronous lookup+decode, fully deterministic and directly testable
 * without any I/O.
 *
 * Deliberately narrow in V1: it only ever recognizes the one reserved
 * `goal-demand:` intent-id namespace (`goalDemandIntentId.ts`, read-only
 * reuse of the SAME format `authorizeGoalActivityLinks` already decodes
 * for provenance -- this is not a new trust boundary, and the facts
 * returned here are never treated as one: they are inert metadata,
 * never consulted by any placement/eligibility/acceptance decision). A
 * future source (a deadline task, a wellbeing engine) extends this
 * function with its own id-namespace branch, never a per-source
 * reimplementation of the policy boundary itself.
 */
export function resolveDecisionFactsForIntent(requestedIntentId: string, rhythmFactsByGoalActivityId: ReadonlyMap<string, RhythmDecisionFacts>): DecisionFacts | undefined {
  const classified = classifyGoalDemandIntentId(requestedIntentId);
  if (classified.kind !== 'VALID_GOAL_DEMAND') return undefined;
  const rhythm = rhythmFactsByGoalActivityId.get(classified.goalActivityId);
  return rhythm ? { rhythm } : undefined;
}
