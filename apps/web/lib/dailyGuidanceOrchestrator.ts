/**
 * Personal Guidance Orchestration V1 -- top-level orchestrator.
 *
 * The missing runtime layer between the already-merged Personal
 * Intelligence engines (#94-#104) and a future New Aura Home consumer.
 * This file (and its sibling modules in this directory) is APP-LEVEL
 * GLUE, never an astrology engine: it contains no ephemeris math, no new
 * Muhurta/Aura Fit scoring, no new timing search logic, and no new
 * numeric composite score of any kind. Every real calculation is
 * delegated to its own already-built, already-tested package.
 *
 * PRODUCT DEFINITION (locked, see this PR's own architecture audit):
 * Intent-Aware Daily Guidance -- "of the things you actually intend to do
 * today, what should you prioritize and when?" -- never "what abstract
 * activity family is generically best for you today?". Concretely: this
 * file NEVER contains anything shaped like
 * `Record<MuhurtaActivityFamily, ActivityProfile>` or a
 * `switch (family) { case 'RELATIONSHIP': return 'date-night'; ... }`.
 * Every family that reaches #104 traces to an actual Plan or Day Builder
 * intention the user already has today -- see dailyGuidanceCandidates.ts.
 *
 * Pipeline:
 *   buildDailyPersonalFitForUser (dailyGuidancePipeline.ts)
 *     -> DailyPersonalFitContext, or `undefined` if birth profile incomplete
 *   collectPlanCandidates + collectDayBuilderCandidates + dedupeCandidates
 *     (dailyGuidanceCandidates.ts) -> ConcreteGuidanceCandidate[]
 *   selectOneCandidatePerFamily + buildWindowRankingContexts
 *     (dailyGuidanceSameFamily.ts) -> WindowRankingContext[]
 *   deriveDailyGuidance (packages/daily-guidance, UNMODIFIED)
 *     -> DailyGuidanceContext
 *   -> PersonalDailyGuidanceResult (this file's own assembly)
 *
 * NO UI CONSUMER YET: this PR does not call this function from
 * page.tsx/HomeDashboard.tsx -- that belongs to the New Aura Home PR.
 */
import { buildDailyPersonalFitForUser } from './dailyGuidancePipeline';
import { collectPlanCandidates, collectDayBuilderCandidates, dedupeCandidates } from './dailyGuidanceCandidates';
import { selectOneCandidatePerFamily, buildWindowRankingContexts } from './dailyGuidanceSameFamily';
import { deriveDailyGuidance } from '../../../packages/daily-guidance/src/engine';
import type { User } from './db';
import type { PersonalDailyGuidanceResult, SelectedActivityMetadata } from './dailyGuidanceTypes';

/**
 * The single public entry point. `now` must be captured ONCE by the
 * caller (e.g. via resolveRequestNow(req) at the API route boundary) and
 * passed in explicitly -- this function and everything it calls never
 * reads `Date.now()`/`new Date()` for "the current time" itself.
 *
 * Order of checks (cheapest, most-blocking first): birth-profile
 * completeness is checked before any Plan/Day Builder DB read happens
 * (buildDailyPersonalFitForUser's own early `undefined` return, mirroring
 * buildPersonalMuhurtaContextForUser's existing contract) -- no wasted
 * work, and no engine invocation after a known prerequisite failure.
 */
export async function buildPersonalDailyGuidance(user: User, now: Date): Promise<PersonalDailyGuidanceResult> {
  const dailyPersonalFit = buildDailyPersonalFitForUser(user, now);
  if (!dailyPersonalFit) return { status: 'BIRTH_PROFILE_REQUIRED' };

  const [planCandidates, dayBuilderCandidates] = await Promise.all([collectPlanCandidates(user, now), collectDayBuilderCandidates(user, now)]);
  const candidates = dedupeCandidates([...planCandidates, ...dayBuilderCandidates]);
  if (candidates.length === 0) return { status: 'NO_ACTIVITY_INTENT' };

  const selected = selectOneCandidatePerFamily(candidates);
  if (selected.size === 0) return { status: 'NO_ACTIVITY_INTENT' }; // every candidate had zero timing windows -- nothing to represent any family with

  const windowRankings = buildWindowRankingContexts(selected);
  const guidance = deriveDailyGuidance({ dailyPersonalFit, windowRankings });

  // Recommendation-only metadata (brief section 42/92): only families
  // #104 actually selected into `recommendations` get a selectedActivities
  // entry -- a family that was searched/consolidated but not chosen by
  // #104's own staged policy is simply absent, keeping the payload
  // minimal (matches #104's own "compact evidence, never a full copy"
  // discipline).
  const selectedActivities: Record<string, SelectedActivityMetadata> = {};
  for (const recommendation of guidance.recommendations) {
    const candidate = selected.get(recommendation.activityFamily);
    if (!candidate) continue; // structurally unreachable -- every family in guidance.recommendations came from `selected` itself
    selectedActivities[recommendation.activityFamily] = {
      activityId: candidate.activityId,
      title: candidate.title,
      source: candidate.source,
      sourceEntityId: candidate.sourceEntityId,
    };
  }

  return { status: 'READY', guidance, selectedActivities };
}
