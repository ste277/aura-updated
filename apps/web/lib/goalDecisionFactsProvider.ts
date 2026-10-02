/**
 * Constructor Decision Intelligence -- Decision Facts V1: the
 * SOURCE-SPECIFIC fact extraction boundary for automatic Goal demand.
 *
 * This is the one Goal-aware place in the decision-facts path. It sits
 * upstream of the (Goal-blind) Constructor/orchestrator stack, reuses
 * Candidate A1's own read model verbatim (`loadEligibleGoalDemand` --
 * the SAME function, hence the same eligibility rules and the same
 * canonical Rhythm arithmetic; no formula lives here), and translates
 * its factual output into the generic `DecisionFacts` shape keyed by the
 * canonical automatic intent id. Downstream code sees only
 * intentId -> DecisionFacts.
 *
 * TRUST: facts are always derived server-side for the AUTHENTICATED user
 * from the database. The client request supplies, at most, an intent id
 * string that is matched against ids this module itself computes; no fact
 * value ever comes from the request body.
 *
 * NO DECODING: this module deliberately does not parse `goal-demand:`
 * ids (that decoder is reserved to the acceptance authorization layer).
 * It uses the existing ENCODER to compute the canonical id of each
 * eligible candidate and matches requested ids against that set.
 *
 * COST: one `loadEligibleGoalDemand` call per preview request -- at most
 * two queries (candidate GoalActivities, then one batched facts query
 * only when candidates exist), independent of how many intents the
 * request carries. No per-intent query.
 *
 * Eligibility stays upstream: an exhausted/ineligible GoalActivity is
 * never returned by `loadEligibleGoalDemand`, so no fact is produced for
 * it; this module never decides to suppress anything.
 */

import type { User } from './db';
import type { ConstructDayRequest } from './dayConstructorOrchestrator';
import type { DecisionFacts, DecisionFactsByIntentId } from './decisionFacts';
import { encodeGoalDemandIntentId } from './goalDemandIntentId';
import { localCalendarWeekBounds } from './goalActivityRhythm';
import { loadEligibleGoalDemand, createRealGoalDemandCandidatesDeps, type GoalDemandCandidate, type GoalDemandCandidatesDeps } from './goalDemandCandidates';

/** Pure translation of already-canonical Goal demand into generic facts,
 * restricted to the intent ids actually present in the request. */
export function translateGoalDemandToDecisionFacts(
  candidates: readonly GoalDemandCandidate[],
  planningLocalDate: string,
  requestedIntentIds: ReadonlySet<string>
): Map<string, DecisionFacts> {
  const factsByIntentId = new Map<string, DecisionFacts>();
  // The extent of the very week the candidates' counts were taken over:
  // the Rhythm module's own helper applied to the same planning date it
  // was given. Pure civil-date arithmetic -- no query, no clock.
  const period = candidates.length === 0 ? undefined : localCalendarWeekBounds(planningLocalDate);
  for (const candidate of candidates) {
    const intentId = encodeGoalDemandIntentId(planningLocalDate, candidate.goalActivityId);
    if (!requestedIntentIds.has(intentId) || !period) continue;
    factsByIntentId.set(intentId, {
      recurrence: {
        period: 'LOCAL_CALENDAR_WEEK',
        periodStartDate: period.startDate,
        periodEndDate: period.endDate,
        targetPerPeriod: candidate.rhythm.targetPerWeek,
        completedInPeriod: candidate.rhythm.completedThisWeek,
        committedInPeriod: candidate.rhythm.committedThisWeek,
        remainingInPeriod: candidate.rhythm.remainingOccurrences,
      },
    });
  }
  return factsByIntentId;
}

/**
 * Production provider, matching `DayConstructorPreviewBoundaryDeps.
 * loadDecisionFacts`. A failed load yields NO facts (never a failed
 * preview): facts are inert in V1 and eligibility is enforced
 * independently upstream and again at acceptance.
 */
export async function loadGoalDecisionFacts(user: User, request: ConstructDayRequest, deps: GoalDemandCandidatesDeps = createRealGoalDemandCandidatesDeps()): Promise<DecisionFactsByIntentId> {
  if (request.intents.length === 0) return new Map();
  const result = await loadEligibleGoalDemand(deps, user.id, request.targetDate, request.timezone);
  if (result.status !== 'OK') return new Map();
  return translateGoalDemandToDecisionFacts(result.candidates, request.targetDate, new Set(request.intents.map((intent) => intent.id)));
}
