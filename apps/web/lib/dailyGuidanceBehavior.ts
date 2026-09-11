/**
 * Behavioral Integration V1 -- Daily Guidance's own behavior-derivation
 * module, sibling to dailyGuidancePipeline.ts/dailyGuidanceCandidates.ts/
 * dailyGuidanceSameFamily.ts (matching this directory's own established
 * one-file-per-concern convention).
 *
 * Responsibility: fetch this user's recent HabitLog history, derive #110's
 * (behavioralAffinity.ts) BehavioralProfileContext from it, and map that
 * onto packages/daily-guidance's own LOCAL BehavioralAffinityTier map --
 * never the other way around. `packages/daily-guidance` must never import
 * apps/web (dependency direction is app -> package only) -- see
 * packages/daily-guidance/src/types.ts's own BehavioralAffinityTier doc
 * comment for the precedent this mirrors.
 *
 * Does NOT duplicate #110's own aggregation logic (thresholds, recency
 * window, daypart/duration derivation all stay exactly as #110 defines
 * them) and does NOT query PlannedActivity -- see behavioralAffinity.ts's
 * own module doc comment for why HabitLog alone is already complete,
 * non-double-counting evidence.
 */
import { listHabitLogsForInsights } from './db';
import { deriveBehavioralProfile, BEHAVIORAL_AFFINITY_RECENCY_DAYS } from './behavioralAffinity';
import type { User } from './db';
import type { MuhurtaActivityFamily } from '../../../packages/muhurta/src/muhurtaEngine';
import type { BehavioralAffinityTier } from '../../../packages/daily-guidance/src/types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The single public entry point. `now` must be the SAME explicit instant
 * already threaded through `buildPersonalDailyGuidance(user, now)` --
 * this function never reads `Date.now()`/`new Date()` itself, and derives
 * `sinceDate` from that same `now` (never a second captured time).
 *
 * `user.timezone` (current location), never `user.birthTimezone` -- #110's
 * own daypart classification is about when the user actually acts today,
 * not their birth circumstances.
 *
 * Returns a `Partial<Record<...>>` (only families with evidence are
 * populated) rather than the full 13-entry vector #110 itself returns --
 * `packages/daily-guidance`'s own `buildCandidates` already treats a
 * missing family as NEUTRAL (see that function's doc comment), so a
 * NEUTRAL entry here would be a redundant, not-incorrect no-op. Never
 * throws for a HabitLog query failure -- a genuine infrastructure error
 * propagates to the caller exactly like every other DB call in this
 * pipeline (dailyGuidanceCandidates.ts's own listPlannedActivitiesForDay
 * call included), never silently degraded to an all-NEUTRAL fallback.
 */
export async function buildBehavioralAffinityByFamily(user: User, now: Date): Promise<Partial<Record<MuhurtaActivityFamily, BehavioralAffinityTier>>> {
  const sinceDate = new Date(now.getTime() - BEHAVIORAL_AFFINITY_RECENCY_DAYS * MS_PER_DAY);
  const habitLogs = await listHabitLogsForInsights(user.id, sinceDate);
  const profile = deriveBehavioralProfile(habitLogs, user.timezone, now);

  const byFamily: Partial<Record<MuhurtaActivityFamily, BehavioralAffinityTier>> = {};
  for (const activity of profile.activities) {
    if (activity.affinity === 'NEUTRAL') continue; // redundant -- buildCandidates already defaults a missing family to NEUTRAL
    byFamily[activity.activityFamily] = activity.affinity;
  }
  return byFamily;
}
