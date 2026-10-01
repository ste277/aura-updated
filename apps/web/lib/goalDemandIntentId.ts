/**
 * Goals V2 Candidate A2/A3.3 -- the canonical automatic Goal-demand
 * intent-id encoding, deliberately split into its own zero-dependency
 * module.
 *
 * `goalPlanningSourceAdapter.ts` (A2, server-only) originally defined this
 * inline, but that file also imports `dayConstructorPreviewRequest.ts`
 * (for `MAX_INTENTS_PER_REQUEST`), which transitively imports `db.ts` and
 * therefore `pg` -- safe for A2's own server-only callers, but exactly
 * the kind of module a 'use client' component (PlanDayClient.tsx, this
 * ticket's own section 6/26) must never import, since bundling `pg` into
 * client JS breaks the build. This module has NO other import of any
 * kind, so both the server-side adapter and the client component can
 * depend on the ONE real implementation without either pulling in the
 * other's own unrelated dependencies -- "do not duplicate the string
 * format" (this ticket's own section 6) is satisfied by having exactly
 * one implementation, not by which file happens to export it.
 */

const GOAL_DEMAND_INTENT_ID_PREFIX = 'goal-demand';

export function encodeGoalDemandIntentId(planningLocalDate: string, goalActivityId: string): string {
  return `${GOAL_DEMAND_INTENT_ID_PREFIX}:${planningLocalDate}:${goalActivityId}`;
}
