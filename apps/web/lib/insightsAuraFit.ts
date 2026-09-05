import type { SolarWindowType } from '../../../packages/panchang/src/windows';
import { evaluateActivityFit, AuraFitLabel } from '../../../packages/recommendation/src/auraFitEngine';
import { getActivityProfileById } from '../../../packages/recommendation/src/personalizedTasks';
import type { HabitLogRow } from './db';

/**
 * Canonical Aura Fit Insights V1 -- the single server-side boundary that
 * translates a persisted HabitLog into a canonical, activity-aware
 * evaluation via the EXISTING packages/recommendation engine
 * (evaluateActivityFit). This module owns eligibility/aggregation only;
 * it never reimplements, approximates, or duplicates any part of the
 * canonical score formula, label thresholds, or Panchang/Muhurta logic --
 * those all remain exclusively inside packages/recommendation.
 *
 * TIMING PATTERN (apps/web/lib/insightsWindowAlignment.ts, C1) and AURA
 * FIT (this module, C3) are deliberately separate metrics and must never
 * be blended into one score or one aggregate. Timing Pattern is
 * window-only and applies to every historical log regardless of activity
 * identity; Aura Fit is activity-aware and applies ONLY to observations
 * with a genuinely known, currently-valid canonical ActivityProfile.id
 * (packages/recommendation/src/personalizedTasks.ts's FULL_ACTIVITY_CATALOG).
 *
 * Eligibility is a FACT, never a guess: a HabitLog with no activityId, or
 * an activityId that no longer resolves to a real catalog entry, is
 * INELIGIBLE -- not scored as 0, not scored as a neutral default, and
 * never inferred from activityTitle/aliases/logSource/activitySignificance.
 */

const SOLAR_WINDOW_TYPES: ReadonlySet<string> = new Set<SolarWindowType>(['BRAHMA', 'ABHIJIT', 'RAHU_KALAM', 'GULIKA', 'YAMA', 'NEUTRAL']);

function isSolarWindowType(value: string): value is SolarWindowType {
  return SOLAR_WINDOW_TYPES.has(value);
}

export type AuraFitEligibilityFailure = 'MISSING_ACTIVITY_ID' | 'UNKNOWN_ACTIVITY_ID' | 'INVALID_WINDOW' | 'EVALUATION_ERROR';

/** Deliberately minimal -- no activityTitle, no reasons/summary, no user/
 * private data. Score/label only, exactly as the canonical engine
 * computed them, for one already-logged historical activity. */
export interface AuraFitObservation {
  logId: string;
  score: number;
  label: AuraFitLabel;
}

export type HabitLogAuraFitResult =
  | { eligible: true; observation: AuraFitObservation }
  | { eligible: false; reason: AuraFitEligibilityFailure };

/**
 * Evaluates ONE HabitLog against the canonical engine, or reports exactly
 * why it can't be. Historical facts only, passed through unchanged:
 *
 *   activity  <- getActivityProfileById(log.activityId) -- exact-match
 *                catalog lookup, no alias/title/fuzzy inference.
 *   date      <- log.logTimestamp (the real historical instant -- never
 *                "now", never a calendar-range boundary).
 *   windowType <- log.activeWindow (the FROZEN historical solar-window
 *                snapshot from PR #75 -- never recomputed from the
 *                owner's current Timing Location, Birth Location, Event
 *                Location, or browser location; historical coordinates
 *                were never persisted, so there is nothing to recompute
 *                from even if this module wanted to).
 *
 * Deliberately OMITS personalContext/timePreferenceScore/
 * personalPatternScore/userPreferenceScore/classification -- C3 V1 is
 * intentionally non-personalized and never touches ceremonial rule-pack
 * logic. The engine's own existing neutral defaults for the omitted
 * inputs apply unchanged (see auraFitEngine.ts); this module does not,
 * and must not, modify that engine to alter those defaults.
 */
export function evaluateHabitLogAuraFit(log: HabitLogRow): HabitLogAuraFitResult {
  const activityId = log.activityId;
  if (!activityId) {
    return { eligible: false, reason: 'MISSING_ACTIVITY_ID' };
  }
  const activity = getActivityProfileById(activityId);
  if (!activity) {
    return { eligible: false, reason: 'UNKNOWN_ACTIVITY_ID' };
  }
  if (!isSolarWindowType(log.activeWindow)) {
    return { eligible: false, reason: 'INVALID_WINDOW' };
  }
  try {
    const evaluation = evaluateActivityFit({
      activity,
      date: log.logTimestamp,
      windowType: log.activeWindow,
    });
    return { eligible: true, observation: { logId: log.id, score: evaluation.score, label: evaluation.label } };
  } catch (err) {
    // Fail closed for THIS observation only -- one bad evaluation must
    // never fail the whole Insights response, and must never be silently
    // converted into a fabricated neutral score. Logged (server-side
    // only, never surfaced to the client) purely for diagnosis.
    console.error(`evaluateHabitLogAuraFit: canonical evaluation threw for HabitLog ${log.id}`, err);
    return { eligible: false, reason: 'EVALUATION_ERROR' };
  }
}

export type AuraFitState = 'NO_DATA' | 'LIMITED' | 'AVAILABLE';

export interface AuraFitSummary {
  state: AuraFitState;
  eligibleCount: number;
  totalCount: number;
  averageScore: number | null;
}

/**
 * Aggregates an already-scoped (e.g. current-month) set of HabitLogs into
 * one Aura Fit summary. `totalCount` is the size of the INPUT array as
 * given -- callers are responsible for scoping it (e.g. to the current
 * calendar month) before calling this function; this function performs no
 * date filtering of its own.
 *
 * eligibleCount < totalCount is the expected, normal case (most logs will
 * have no canonical activity identity, especially early on) -- ineligible
 * logs are never assigned any numeric value and never enter the mean.
 *
 * Sample-size states, matching the existing `reflections.length < 3`
 * convention already used one route function above in this exact file's
 * caller (apps/web/app/api/daily-assistant/insights/route.ts):
 *   0 eligible    -> NO_DATA,  averageScore = null
 *   1-2 eligible  -> LIMITED,  averageScore = null (a mean of 1-2 points
 *                    is not a meaningful descriptive statistic)
 *   3+ eligible   -> AVAILABLE, averageScore = the rounded arithmetic mean
 *
 * The mean is a SIMPLE, UNWEIGHTED average of eligible scores only -- no
 * weighting by durationMinutes, activitySignificance, logSource, or
 * recency. Each eligible HabitLog counts as exactly one observation.
 */
export function summarizeAuraFit(logs: HabitLogRow[]): AuraFitSummary {
  const totalCount = logs.length;
  const eligibleScores: number[] = [];
  for (const log of logs) {
    const result = evaluateHabitLogAuraFit(log);
    if (result.eligible) eligibleScores.push(result.observation.score);
  }
  const eligibleCount = eligibleScores.length;
  const state: AuraFitState = eligibleCount === 0 ? 'NO_DATA' : eligibleCount < 3 ? 'LIMITED' : 'AVAILABLE';
  const averageScore = state === 'AVAILABLE'
    ? Math.round(eligibleScores.reduce((sum, score) => sum + score, 0) / eligibleCount)
    : null;
  return { state, eligibleCount, totalCount, averageScore };
}
