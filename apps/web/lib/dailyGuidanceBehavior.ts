/**
 * Behavioral Integration V1 / Preferred Daypart Personalization V1 --
 * Daily Guidance's own behavior-derivation module, sibling to
 * dailyGuidancePipeline.ts/dailyGuidanceCandidates.ts/
 * dailyGuidanceSameFamily.ts (matching this directory's own established
 * one-file-per-concern convention).
 *
 * Responsibility: fetch this user's recent HabitLog history and derive
 * #110's (behavioralAffinity.ts) full `BehavioralProfileContext` from it
 * EXACTLY ONCE per request, then expose two independent, PURE, synchronous
 * projections of that single profile -- an affinity-tier map (Behavioral
 * Integration V1) and a preferred-daypart-match map (Preferred Daypart
 * Personalization V1) -- so the orchestrator never needs a second HabitLog
 * query or a second `deriveBehavioralProfile` call to get both signals.
 *
 * `packages/daily-guidance` must never import apps/web (dependency
 * direction is app -> package only) -- see
 * packages/daily-guidance/src/types.ts's own `BehavioralAffinityTier` doc
 * comment for the precedent this mirrors. Both projections below hand the
 * package only a bare package-local type (`BehavioralAffinityTier`) or a
 * bare `boolean` -- never `InsightsDayPart`, never `BehavioralProfileContext`
 * itself, never a timezone.
 *
 * Does NOT duplicate #110's own aggregation/classification logic
 * (thresholds, recency window, daypart-consistency ratio all stay exactly
 * as #110 defines them) and does NOT query PlannedActivity -- see
 * behavioralAffinity.ts's own module doc comment for why HabitLog alone
 * is already complete, non-double-counting evidence.
 *
 * Behavior-aware Day Builder Duration V1 -- the actual fetch+derive
 * implementation of `buildBehavioralProfileForUser` now lives in
 * behavioralProfileFetch.ts (a feature-agnostic shared helper, reused by
 * GET /api/my-day/suggestions without that route importing this
 * Daily-Guidance-specific module). This file keeps its OWN thin wrapper
 * of the same name -- a real function, not a re-export -- purely so
 * existing call sites/tests (including
 * test/dailyGuidanceBehaviorIntegration.test.ts's own runtime
 * query-count spy, which patches this exact module's own
 * `buildBehavioralProfileForUser` property) continue to work completely
 * unmodified.
 */
import { toInsightsObservation } from './insightsTimezone';
import { buildBehavioralProfileForUser as buildBehavioralProfileForUserShared } from './behavioralProfileFetch';
import type { User } from './db';
import type { BehavioralProfileContext } from './behavioralAffinity';
import type { ConcreteGuidanceCandidate } from './dailyGuidanceTypes';
import type { MuhurtaActivityFamily } from '../../../packages/muhurta/src/muhurtaEngine';
import type { BehavioralAffinityTier } from '../../../packages/daily-guidance/src/types';

export async function buildBehavioralProfileForUser(user: User, now: Date): Promise<BehavioralProfileContext> {
  return buildBehavioralProfileForUserShared(user, now);
}

/**
 * Pure projection: the affinity tier per family, from an already-derived
 * profile. Returns a `Partial<Record<...>>` (only families with evidence
 * are populated) rather than the full 13-entry vector #110 itself returns
 * -- `packages/daily-guidance`'s own `buildCandidates` already treats a
 * missing family as `NEUTRAL` (see that function's doc comment), so a
 * `NEUTRAL` entry here would be a redundant, not-incorrect no-op.
 */
export function affinityByFamily(profile: BehavioralProfileContext): Partial<Record<MuhurtaActivityFamily, BehavioralAffinityTier>> {
  const byFamily: Partial<Record<MuhurtaActivityFamily, BehavioralAffinityTier>> = {};
  for (const activity of profile.activities) {
    if (activity.affinity === 'NEUTRAL') continue;
    byFamily[activity.activityFamily] = activity.affinity;
  }
  return byFamily;
}

/**
 * Backward-compatible wrapper preserving the exact pre-Preferred-Daypart-
 * Personalization-V1 signature/behavior of this module's own original
 * public entry point -- fetches once, derives once, returns only the
 * affinity projection. Kept (rather than removed) so existing call sites/
 * tests written against this exact name continue to work unmodified; the
 * orchestrator itself now calls `buildBehavioralProfileForUser` directly
 * so it can also derive `preferredDaypartMatchByFamily` from the SAME
 * profile without a second fetch.
 */
export async function buildBehavioralAffinityByFamily(user: User, now: Date): Promise<Partial<Record<MuhurtaActivityFamily, BehavioralAffinityTier>>> {
  const profile = await buildBehavioralProfileForUser(user, now);
  return affinityByFamily(profile);
}

/**
 * Pure projection: whether each family's own already-selected rank-1
 * timing window (Preferred Daypart Personalization V1) falls inside that
 * family's established `preferredDaypart` -- computed entirely from an
 * already-derived `profile` plus the orchestrator's own already-resolved
 * `selected` map (one `ConcreteGuidanceCandidate` per family, from
 * `selectOneCandidatePerFamily`), never a second HabitLog query.
 *
 * POSITIVE-ONLY, ONLY EVER SETS `true` (merge-critical): a family is
 * simply absent from the returned map -- never explicitly `false` -- for
 * every one of: no established `preferredDaypart` (below #110's own
 * evidence/consistency floor), a genuine daypart mismatch, or a `source
 * === 'PLAN'` candidate. An explicit Plan time is never second-guessed by
 * behavior -- the user already chose it -- so Plan candidates are
 * skipped entirely, never boosted and never penalized, matching exactly
 * how a genuine mismatch or missing history is also never penalized (see
 * packages/daily-guidance/src/types.ts's own
 * `preferredDaypartMatchByFamily` doc comment for why all three
 * collapse to the identical downstream "no boost").
 *
 * MIDPOINT, NOT START (merge-critical): classifies the window's midpoint
 * instant, not its start, via #110's own `toInsightsObservation` (the
 * SAME entry point behavioralAffinity.ts itself uses for every real
 * observation) -- never a second, duplicate daypart-classification
 * system. A window that straddles a daypart boundary is judged by where
 * most of it actually falls, not merely where it begins.
 *
 * RANK-1 ONLY: reads only `candidate.timingCandidates[0]` -- the exact
 * same window `buildWindowRankingContexts` already turns into the
 * family's own rank-1 `RankedTimingWindow` (see dailyGuidanceSameFamily.ts's
 * own "never re-sorts/re-scores" doc comment) -- never rank 2/3, and
 * never a substitution.
 */
export function buildPreferredDaypartMatchByFamily(
  profile: BehavioralProfileContext,
  selected: ReadonlyMap<string, ConcreteGuidanceCandidate>,
  timezone: string
): Partial<Record<MuhurtaActivityFamily, boolean>> {
  const preferredDaypartByFamily = new Map(profile.activities.map((activity) => [activity.activityFamily, activity.preferredDaypart]));

  const byFamily: Partial<Record<MuhurtaActivityFamily, boolean>> = {};
  for (const [family, candidate] of selected) {
    if (candidate.source !== 'DAY_BUILDER_INTENTION') continue; // PLAN candidates: never boosted, never penalized
    const preferredDaypart = preferredDaypartByFamily.get(family as MuhurtaActivityFamily);
    if (!preferredDaypart) continue; // no established behavioral daypart pattern for this family -- neutral (Behavioral Semantics Correction V1: preferredDaypart is a dominant-logged-daypart signal, not a proven preference -- see behavioralAffinity.ts's own doc comment)
    const window = candidate.timingCandidates[0];
    if (!window) continue; // structurally unreachable -- selectOneCandidatePerFamily only ever selects a candidate with >=1 timing window
    const midpoint = new Date((new Date(window.start).getTime() + new Date(window.end).getTime()) / 2);
    const candidateDaypart = toInsightsObservation(midpoint, timezone).dayPart;
    if (candidateDaypart === preferredDaypart) byFamily[family as MuhurtaActivityFamily] = true;
  }
  return byFamily;
}
