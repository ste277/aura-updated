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
 *   collectPlanCandidates + discoverDayBuilderCandidates (dailyGuidanceCandidates.ts,
 *     run in parallel) -> Plan candidates + cheap raw Day-Builder-intent signal,
 *     NEITHER of which needs a behavioral profile
 *   if neither exists -> NO_ACTIVITY_INTENT, still zero behavioral queries
 *   buildBehavioralProfileForUser (dailyGuidanceBehavior.ts, ONE HabitLog
 *     query + ONE #110 derivation) -> BehavioralProfileContext, run in
 *     parallel with listUserActivityPreferences (activityPreferences.ts,
 *     Explicit Duration Preferences Controls + Consumption V1 -- gated
 *     behind raw Day Builder intent specifically, narrower than the
 *     behavioral fetch, since only Day Builder intention candidates ever
 *     consult a stored preference)
 *   activityDurationByActivityId (behavioralAffinity.ts, PURE projection of
 *     that SAME profile, Behavior-aware Day Builder Duration V1) +
 *     preferredDurationByActivityId (activityPreferences.ts, PURE
 *     projection of the preference rows above)
 *   resolveDayBuilderCandidates (dailyGuidanceCandidates.ts, only when raw
 *     Day Builder intent exists) -> Day Builder candidates, FIND now
 *     resolved using the stored preference map (wins) then the behavioral
 *     duration map (fallback) above
 *   dedupeCandidates -> ConcreteGuidanceCandidate[]
 *   selectOneCandidatePerFamily + buildWindowRankingContexts
 *     (dailyGuidanceSameFamily.ts) -> WindowRankingContext[]
 *   affinityByFamily + buildPreferredDaypartMatchByFamily
 *     (dailyGuidanceBehavior.ts, both PURE projections of the SAME already-
 *     fetched profile, Behavioral Integration V1 / Preferred Daypart
 *     Personalization V1) -- no second HabitLog query
 *   deriveDailyGuidance (packages/daily-guidance)
 *     -> DailyGuidanceContext
 *   -> PersonalDailyGuidanceResult (this file's own assembly)
 *
 * NO UI CONSUMER YET: this PR does not call this function from
 * page.tsx/HomeDashboard.tsx -- that belongs to the New Aura Home PR.
 */
import { buildDailyPersonalFitForUser } from './dailyGuidancePipeline';
import { collectPlanCandidates, discoverDayBuilderCandidates, resolveDayBuilderCandidates, dedupeCandidates } from './dailyGuidanceCandidates';
import { selectOneCandidatePerFamily, buildWindowRankingContexts } from './dailyGuidanceSameFamily';
import { buildBehavioralProfileForUser, affinityByFamily, buildPreferredDaypartMatchByFamily } from './dailyGuidanceBehavior';
import { activityDurationByActivityId } from './behavioralAffinity';
import { listUserActivityPreferences, preferredDurationByActivityId } from './activityPreferences';
import { deriveDailyGuidance } from '../../../packages/daily-guidance/src/engine';
import type { User } from './db';
import type { PersonalDailyGuidanceResult, SelectedActivityMetadata } from './dailyGuidanceTypes';
import type { MuhurtaActivityFamily } from '../../../packages/muhurta/src/muhurtaEngine';

/**
 * The single public entry point. `now` must be captured ONCE by the
 * caller (e.g. via resolveRequestNow(req) at the API route boundary) and
 * passed in explicitly -- this function and everything it calls never
 * reads `Date.now()`/`new Date()` for "the current time" itself.
 *
 * Order of checks (cheapest, most-blocking first): birth-profile
 * completeness is checked before any Plan/Day Builder DB read happens
 * (buildDailyPersonalFitForUser's own early `undefined` return, mirroring
 * buildPersonalMuhurtaContextForUser's existing contract); declared-intent
 * DISCOVERY runs next (collectPlanCandidates + discoverDayBuilderCandidates,
 * in parallel) -- neither needs a behavioral profile, so a genuine
 * NO_ACTIVITY_INTENT (no Plan candidates AND no raw Day Builder intent)
 * returns here with ZERO behavioral queries, unchanged from before
 * Behavior-aware Day Builder Duration V1. Only once real intent is
 * confirmed to exist does the behavioral HabitLog fetch run
 * (buildBehavioralProfileForUser) -- never for BIRTH_PROFILE_REQUIRED or
 * this first NO_ACTIVITY_INTENT check. Exactly ONE such fetch happens on
 * the READY path, feeding `activityDurationByActivityId` (Behavior-aware
 * Day Builder Duration V1, used to RESOLVE Day Builder candidates below --
 * shaping FIND input only, never a ranking signal), `affinityByFamily`,
 * and `buildPreferredDaypartMatchByFamily` (Behavioral Integration V1 /
 * Preferred Daypart Personalization V1) -- never a second HabitLog query.
 * A second NO_ACTIVITY_INTENT is still possible after RESOLUTION (raw
 * intent existed but FIND/CHECK produced zero valid candidates) -- that is
 * expected and does NOT indicate a query-count regression: behavior was
 * already legitimately fetched because raw intent existed.
 * A genuine failure of the behavioral fetch propagates like every other DB
 * call in this pipeline -- never silently converted to an all-NEUTRAL/no-
 * match/static-default fallback (see behavioralProfileFetch.ts's own doc
 * comment).
 */
export async function buildPersonalDailyGuidance(user: User, now: Date): Promise<PersonalDailyGuidanceResult> {
  const dailyPersonalFit = buildDailyPersonalFitForUser(user, now);
  if (!dailyPersonalFit) return { status: 'BIRTH_PROFILE_REQUIRED' };

  const [planCandidates, dayBuilderDiscovery] = await Promise.all([collectPlanCandidates(user, now), discoverDayBuilderCandidates(user, now)]);
  if (planCandidates.length === 0 && !dayBuilderDiscovery.hasIntent) return { status: 'NO_ACTIVITY_INTENT' };

  const [behavioralProfile, preferenceRows] = await Promise.all([
    buildBehavioralProfileForUser(user, now),
    // Explicit Duration Preferences Controls + Consumption V1 -- gated
    // narrower than the behavioral fetch above: preferences are only ever
    // consumed by durationMinutesFor for a Day Builder INTENTION candidate
    // (Plan candidates always use their own stored plan.durationMinutes),
    // so a Plan-only READY path (real intent, but zero raw Day Builder
    // intent specifically) costs zero preference queries, even though the
    // behavioral fetch above still runs (it also feeds affinity/daypart
    // signals used by Plan-sourced candidates too).
    dayBuilderDiscovery.hasIntent ? listUserActivityPreferences(user.id) : Promise.resolve([]),
  ]);
  const behavioralDurationByActivityId = activityDurationByActivityId(behavioralProfile);
  const preferredDurationMap = preferredDurationByActivityId(preferenceRows);
  const dayBuilderCandidates = dayBuilderDiscovery.hasIntent
    ? await resolveDayBuilderCandidates(user, now, dayBuilderDiscovery, preferredDurationMap, behavioralDurationByActivityId)
    : [];

  const candidates = dedupeCandidates([...planCandidates, ...dayBuilderCandidates]);
  if (candidates.length === 0) return { status: 'NO_ACTIVITY_INTENT' }; // raw intent existed but nothing resolved into a valid candidate

  const selected = selectOneCandidatePerFamily(candidates);
  if (selected.size === 0) return { status: 'NO_ACTIVITY_INTENT' }; // every candidate had zero timing windows -- nothing to represent any family with

  const windowRankings = buildWindowRankingContexts(selected);
  const behavioralAffinityByFamily = affinityByFamily(behavioralProfile);
  const preferredDaypartMatchByFamily = buildPreferredDaypartMatchByFamily(behavioralProfile, selected, user.timezone);
  const guidance = deriveDailyGuidance({ dailyPersonalFit, windowRankings, behavioralAffinityByFamily, preferredDaypartMatchByFamily });

  // Recommendation-only metadata (brief section 42/92): only families
  // #104 actually selected into `recommendations` get a selectedActivities
  // entry -- a family that was searched/consolidated but not chosen by
  // #104's own staged policy is simply absent, keeping the payload
  // minimal (matches #104's own "compact evidence, never a full copy"
  // discipline). `behavioralAffinity` (Behavioral Integration V1) is
  // forward-compat metadata only -- #104's own output carries no such
  // field (see packages/daily-guidance/src/types.ts's own
  // DailyGuidanceInput doc comment); this is app-level glue re-attaching
  // the SAME map already computed above, never a second derivation, so a
  // future Why Aura explanation PR can consume it without re-deriving
  // behavior. Defaults to 'NEUTRAL' when the family carries no evidence,
  // matching buildCandidates' own default exactly.
  const selectedActivities: Record<string, SelectedActivityMetadata> = {};
  for (const recommendation of guidance.recommendations) {
    const candidate = selected.get(recommendation.activityFamily);
    if (!candidate) continue; // structurally unreachable -- every family in guidance.recommendations came from `selected` itself
    selectedActivities[recommendation.activityFamily] = {
      activityId: candidate.activityId,
      title: candidate.title,
      source: candidate.source,
      sourceEntityId: candidate.sourceEntityId,
      behavioralAffinity: behavioralAffinityByFamily[recommendation.activityFamily as MuhurtaActivityFamily] ?? 'NEUTRAL',
    };
  }

  return { status: 'READY', guidance, selectedActivities };
}
