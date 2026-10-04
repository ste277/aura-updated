/**
 * O5 P2d -- the ONE pure assembly of the duration-personalization maps `durationMinutesFor` consumes: the user's stored
 * activity-duration preferences and the behavioral typical durations derived from recent habit logs. It performs no I/O.
 *
 * It exists so the two places that need this assembly -- the Day Constructor's live orchestrator dependencies and the
 * decision scheduling context's snapshot-backed dependencies -- cannot drift: a duration resolved from a coherent database
 * snapshot is resolved by exactly the same code as one resolved from live reads.
 */

import { preferredDurationByActivityId, type UserActivityPreference } from './activityPreferences';
import { deriveBehavioralProfile, activityDurationByActivityId, type BehavioralHabitLog } from './behavioralAffinity';

export interface DurationContext {
  preferredDurationByActivityId: Readonly<Record<string, number>>;
  behavioralDurationByActivityId: Readonly<Record<string, number>>;
}

export function buildDurationContext(preferences: readonly UserActivityPreference[], habitLogs: readonly BehavioralHabitLog[], timezone: string, now: Date): DurationContext {
  const behavioralProfile = deriveBehavioralProfile(habitLogs, timezone, now);
  return {
    preferredDurationByActivityId: preferredDurationByActivityId(preferences),
    behavioralDurationByActivityId: activityDurationByActivityId(behavioralProfile),
  };
}
