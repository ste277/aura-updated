/**
 * Opportunity Scarcity V1 -- O4: generic opportunity enrichment.
 *
 * Composes the already-merged layers into inert supply facts:
 *
 *   horizon (from the facts an upstream provider already attached)
 *   + the candidate's resolved duration
 *   -> ONE availability/blocker range load (opportunityRangeAdapter.ts, O2)
 *   -> ONE candidate-local projection per candidate (opportunityProjection.ts, O1)
 *   -> `OpportunityDecisionFacts` (decisionFacts.ts)
 *
 * This module owns ORCHESTRATION only. It reproduces none of the
 * projection (past-day handling, today clipping, availability and blocker
 * subtraction, contiguous fit, coverage) and none of the range adaptation
 * (weekly availability, timezone conversion, DST uncertainty, plan
 * loading, blocker lifecycle): O1 and O2 are the only places that
 * knowledge lives.
 *
 * SOURCE-NEUTRAL: it consumes generic `DecisionFacts` and a duration. It
 * does not know what produced a horizon or why one exists. Recurrence is
 * the first producer of a horizon (`deriveOpportunityHorizon`); a future
 * producer adds its own branch there without touching the projection or
 * range layers.
 *
 * INERT: it returns facts and nothing else. It never ranks, classifies,
 * compares supply with any requirement, or influences placement. A
 * candidate that has no horizon, or no duration, simply gets no
 * opportunity facts.
 *
 * COST: at most one range load per call -- one availability-configuration
 * load and one plan query for the WIDEST horizon among the candidates --
 * regardless of how many candidates there are. Projection is in memory
 * and is the only per-candidate work.
 *
 * FAILURE: an invalid range yields no facts. A load failure rejects, and
 * the caller (the preview boundary) decides to continue without facts; no
 * fact is ever fabricated for an unknown supply.
 */

import type { DecisionFacts, OpportunityDecisionFacts, OpportunityDurationBasis } from './decisionFacts';
import { projectOpportunityFacts } from './opportunityProjection';
import { loadOpportunityRangeInputs, type OpportunityRangeDeps } from './opportunityRangeAdapter';

/** An inclusive local civil-date horizon (YYYY-MM-DD). */
export interface OpportunityHorizon {
  startDate: string;
  endDate: string;
}

/** What the enrichment needs to know about one candidate. */
export interface OpportunityCandidateInput {
  intentId: string;
  /** The candidate's resolved duration, if one exists. */
  durationMinutes: number | undefined;
  durationBasis: OpportunityDurationBasis;
  /** The facts an upstream provider already attached, if any. */
  facts: DecisionFacts | undefined;
}

export interface OpportunityEnrichmentContext {
  /** The local civil date the preview was requested for. */
  planningDate: string;
  timezone: string;
  /** The explicit reference instant (no clock is ever read here). */
  now: Date;
}

/**
 * The horizon a candidate's facts define, if any: from the LATER of the
 * planning date and the period start, through the period's inclusive end.
 * The end is taken as given -- no period arithmetic happens here. Days
 * before the planning date are never part of the horizon, so supply is
 * "from the planning date through the end of its period", not "what
 * existed earlier in the period".
 */
export function deriveOpportunityHorizon(facts: DecisionFacts | undefined, planningDate: string): OpportunityHorizon | undefined {
  const recurrence = facts?.recurrence;
  if (!recurrence) return undefined;
  const startDate = recurrence.periodStartDate > planningDate ? recurrence.periodStartDate : planningDate;
  if (startDate > recurrence.periodEndDate) return undefined;
  return { startDate, endDate: recurrence.periodEndDate };
}

/**
 * Computes opportunity facts for every candidate that has both a horizon
 * and a duration. Candidates are projected independently of one another
 * against the same loaded range context; capacity is never allocated
 * among them.
 */
export async function computeOpportunityDecisionFacts(
  candidates: readonly OpportunityCandidateInput[],
  context: OpportunityEnrichmentContext,
  rangeDeps: OpportunityRangeDeps
): Promise<ReadonlyMap<string, OpportunityDecisionFacts>> {
  const result = new Map<string, OpportunityDecisionFacts>();

  const projectable: Array<{ candidate: OpportunityCandidateInput; durationMinutes: number; horizon: OpportunityHorizon }> = [];
  for (const candidate of candidates) {
    const horizon = deriveOpportunityHorizon(candidate.facts, context.planningDate);
    if (!horizon || candidate.durationMinutes === undefined) continue;
    projectable.push({ candidate, durationMinutes: candidate.durationMinutes, horizon });
  }
  if (projectable.length === 0) return result;

  // One load for the widest horizon; every candidate reuses it in memory.
  const startDate = projectable.reduce((min, p) => (p.horizon.startDate < min ? p.horizon.startDate : min), projectable[0].horizon.startDate);
  const endDate = projectable.reduce((max, p) => (p.horizon.endDate > max ? p.horizon.endDate : max), projectable[0].horizon.endDate);
  const range = await loadOpportunityRangeInputs({ startDate, endDate, timezone: context.timezone, now: context.now }, rangeDeps);
  if (range.status !== 'OK') return result;

  for (const { candidate, durationMinutes, horizon } of projectable) {
    const projection = projectOpportunityFacts({
      planningDate: horizon.startDate,
      horizonEndDate: horizon.endDate,
      durationMinutes,
      timezone: context.timezone,
      now: context.now,
      availabilityByDate: range.inputs.availabilityByDate,
      blockers: range.inputs.blockers,
    });
    if (projection.status !== 'OK') continue;
    const facts = projection.facts;
    result.set(candidate.intentId, {
      horizonStartDate: facts.horizonStartDate,
      horizonEndDate: facts.horizonEndDate,
      evaluatedDays: facts.evaluatedDays,
      viableDays: facts.viableDays,
      unknownDays: facts.unknownDays,
      coverage: facts.coverage,
      durationMinutes,
      durationBasis: candidate.durationBasis,
    });
  }
  return result;
}
