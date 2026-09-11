/**
 * Behavior-aware Day Builder Duration V1 -- the single, feature-agnostic
 * "fetch this user's recent HabitLog history and derive #110's full
 * BehavioralProfileContext" helper, extracted out of dailyGuidanceBehavior.ts
 * (Daily-Guidance-specific glue) so a non-Daily-Guidance consumer --
 * GET /api/my-day/suggestions -- can reuse the EXACT SAME fetch+derive
 * implementation without importing Daily Guidance's own orchestration
 * module (this feature's own architecture audit flagged that as the wrong
 * shared owner). dailyGuidanceBehavior.ts keeps its own
 * `buildBehavioralProfileForUser` export as a thin wrapper around this one
 * -- see that file's own doc comment -- so its existing callers/tests
 * (including the runtime query-count spy in
 * test/dailyGuidanceBehaviorIntegration.test.ts) are unaffected.
 *
 * Not a new derivation surface: this does nothing behavioralAffinity.ts's
 * own deriveBehavioralProfile() doesn't already do. No partial/duration-
 * only derivation shortcut exists here or anywhere else -- reusing the
 * full derivation avoids a second policy surface that could drift out of
 * sync with the family-level signals.
 */
import { listHabitLogsForInsights } from './db';
import { deriveBehavioralProfile, BEHAVIORAL_AFFINITY_RECENCY_DAYS } from './behavioralAffinity';
import type { User } from './db';
import type { BehavioralProfileContext } from './behavioralAffinity';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * `now` must be the caller's own single captured instant (the same
 * "resolveRequestNow(req), never a hidden Date.now()" discipline every
 * other engine in this repo already follows) -- this function reads it,
 * never generates it. `user.timezone` (current location), never
 * `user.birthTimezone` -- #110's own daypart classification is about when
 * the user actually acts today, not their birth circumstances.
 *
 * Never throws for a HabitLog query failure -- a genuine infrastructure
 * error propagates to the caller exactly like every other DB call in this
 * pipeline, never silently degraded to an all-NEUTRAL/no-signal fallback
 * (existing precedent, preserved here unchanged).
 */
export async function buildBehavioralProfileForUser(user: User, now: Date): Promise<BehavioralProfileContext> {
  const sinceDate = new Date(now.getTime() - BEHAVIORAL_AFFINITY_RECENCY_DAYS * MS_PER_DAY);
  const habitLogs = await listHabitLogsForInsights(user.id, sinceDate);
  return deriveBehavioralProfile(habitLogs, user.timezone, now);
}
