/**
 * Behavioral Personalization Foundation V1 (#110) -- a pure, deterministic
 * "what does this user's actual completed behavior suggest" signal per
 * canonical MuhurtaActivityFamily. FOUNDATION ONLY: this module has no
 * consumer yet -- it is not wired into Daily Guidance, Best For You,
 * Forward Planner, Ask Aura, Why Aura, Timing Search, GOOD_RIGHT_NOW,
 * Muhurtham Finder, Aura Fit, Window Ranking, Life Weather, or Daily
 * Personal Fit. Recommendation-ranking integration is explicitly deferred
 * to a future PR (per the architecture audit's own Option A verdict).
 *
 * PURE: no DB import, no fetch, no Date.now(), no request/session access,
 * no mutation, no LLM. `habitLogs`/`timezone`/`now` are all explicit
 * caller-supplied inputs (the same discipline
 * packages/daily-guidance/src/engine.ts and every other pure engine in
 * this repo already follows). `HabitLogRow` is imported `import type`
 * only (erased at compile time, zero runtime DB dependency) -- the exact
 * same precedent apps/web/lib/insightsAuraFit.ts and
 * apps/web/lib/insightsEvidence.ts already establish for a "pure" module
 * that still types against a DB row shape.
 *
 * DEDUPLICATION (merge-critical, see this module's own architecture audit
 * item 12/37): `HabitLog` is the ONLY evidence source this module reads.
 * `PlannedActivity` is deliberately NOT a second input. Tracing
 * `logPlannedActivity()` (apps/web/lib/db.ts) shows every Plan completion
 * creates EXACTLY ONE HabitLog row (logSource: 'AURA_PLANNED') and stamps
 * that same id onto `PlannedActivity.habitLogId` -- so a completed Plan is
 * already fully represented, with its real completion instant/duration/
 * activityId, by the ONE HabitLog row it produced. Also reading
 * `listPlannedActivitiesForDay()` and counting every LOGGED Plan as a
 * SECOND observation would double-count that exact same real-world
 * completion. The two sources are provably mutually exclusive as long as
 * only HabitLog is used for completed evidence -- see
 * test/behavioralAffinityDb.test.ts's own "one completion -> one
 * observation" proof, which creates a Plan, completes it, and confirms
 * feeding only the resulting HabitLog row yields evidenceCount 1, never 2.
 * `PlannedActivity.status` also has no persisted MISSED value (see
 * apps/web/lib/dailyAgenda.ts's own timeBasedStatus doc comment) -- missed/
 * upcoming Plans are excluded from V1's evidence entirely by design (brief:
 * "No negative behavioral inference"), so there is no other fact
 * PlannedActivity could contribute to this module that HabitLog doesn't
 * already carry.
 *
 * ACTIVITY NORMALIZATION: only HabitLog rows with a genuinely known,
 * currently-valid canonical activityId are eligible -- the SAME
 * MISSING_ACTIVITY_ID / UNKNOWN_ACTIVITY_ID fail-closed pattern
 * insightsAuraFit.ts's evaluateHabitLogAuraFit() already established.
 * Never inferred from activityTitle/Habit.category/free text.
 */
import type { HabitLogRow } from './db';
import { classifyDayPart, toInsightsObservation, InsightsDayPart } from './insightsTimezone';
import { getActivityProfileById } from '../../../packages/recommendation/src/personalizedTasks';
import { familyForActivityProfile } from '../../../packages/recommendation/src/auraFitEngine';
import { CANONICAL_ACTIVITY_FAMILIES } from '../../../packages/daily-personal-fit/src/constants';
import type { MuhurtaActivityFamily } from '../../../packages/muhurta/src/muhurtaEngine';

// ============================================================
// Version stamps -- same naming convention as
// packages/daily-guidance/src/provenance.ts's own
// DAILY_GUIDANCE_ENGINE_VERSION / DAILY_GUIDANCE_SELECTION_POLICY_VERSION.
// ============================================================

export const BEHAVIORAL_AFFINITY_ENGINE_VERSION = 'BEHAVIORAL_AFFINITY_V1' as const;
export const BEHAVIORAL_AFFINITY_POLICY_VERSION = 'BEHAVIORAL_AFFINITY_POLICY_V1' as const;

// ============================================================
// V1 policy constants -- EXPLICIT PRODUCT PLACEHOLDERS, not statistically
// calibrated, not learned, not validated from production data. The
// architecture audit found no real usage-frequency distribution to derive
// these from; they are a deliberate, conservative starting point that a
// future PR can recalibrate under a new BEHAVIORAL_AFFINITY_POLICY_VERSION
// once real usage data exists. Never describe these as data-derived.
// ============================================================

/** 0-2 completed observations -> NEUTRAL (reuses the exact 0/1-2/3+
 * boundary apps/web/lib/insightsEvidence.ts's deriveInsightsEvidenceState
 * already ships and a prior audit already validated as correctly
 * calibrated for "is there enough evidence to say something"). */
const MODERATE_MIN_EVIDENCE = 3;
/** V1 policy placeholder -- see module doc comment. */
const STRONG_MIN_EVIDENCE = 5;

/** V1 policy placeholder, not statistically calibrated -- see module doc
 * comment. Rolling window, not a calendar-day boundary (unlike Insights'
 * own "This Month"/streak concepts), so plain millisecond arithmetic
 * against an explicit `now` is the correct tool here, matching
 * listHabitLogsForInsights()'s own `sinceDate` DB parameter shape. */
export const BEHAVIORAL_AFFINITY_RECENCY_DAYS = 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** V1 policy placeholder -- a preferredDaypart is only populated when one
 * daypart accounts for at least 2/3 of a family's eligible observations
 * (checked via integer cross-multiplication, never floating-point
 * division, so the boundary is exact). A tie at the maximum count is
 * always ambiguous -> undefined, never resolved by enum declaration
 * order. */
const DAYPART_CONSISTENCY_NUMERATOR = 2;
const DAYPART_CONSISTENCY_DENOMINATOR = 3;

/** V1 policy placeholder -- typicalDurationMinutes is only populated when
 * at least 3 valid (finite, positive) durations exist for a family AND
 * they cluster within this many minutes of each other (max - min). Below
 * this bar the value is left undefined rather than reporting a
 * false-precision average. */
const DURATION_CONSISTENCY_WINDOW_MINUTES = 30;

// ============================================================
// Public contract.
// ============================================================

export type BehavioralAffinity = 'STRONG' | 'MODERATE' | 'NEUTRAL';

/** Deliberately minimal (brief: PRIVACY CONTRACT) -- no activity titles,
 * no individual timestamps, no raw log/Plan ids, no notes, no raw event
 * arrays. Aggregate facts only. */
export interface BehavioralActivityAffinity {
  activityFamily: MuhurtaActivityFamily;
  affinity: BehavioralAffinity;
  evidenceCount: number;
  preferredDaypart?: InsightsDayPart;
  typicalDurationMinutes?: number;
}

/**
 * COLD-START CONTRACT (architecture audit item 8, resolved): `activities`
 * always contains exactly `CANONICAL_ACTIVITY_FAMILIES.length` (13)
 * entries, one per canonical family, in that fixed order -- never sparse,
 * never re-sorted by evidence/relevance. This is the SAME established
 * Personal Intelligence convention packages/daily-personal-fit/src/
 * engine.ts already uses for DailyPersonalFitContext.activities ("always
 * exactly 13 entries, in CANONICAL_ACTIVITY_FAMILIES' own fixed order").
 * A family with zero evidence is present with `affinity: 'NEUTRAL'`,
 * `evidenceCount: 0` -- explicit, never ambiguous with "this family
 * doesn't exist" or "data failed to load", and never inferred as dislike.
 */
export interface BehavioralProfileContext {
  engineVersion: typeof BEHAVIORAL_AFFINITY_ENGINE_VERSION;
  policyVersion: typeof BEHAVIORAL_AFFINITY_POLICY_VERSION;
  /** ISO instant this profile was derived at -- the caller-supplied `now`,
   * never a fresh Date.now() read inside this module. */
  evaluationTime: string;
  activities: BehavioralActivityAffinity[];
}

// ============================================================
// Eligibility (brief: ACTIVITY NORMALIZATION, COMPLETED EVIDENCE ONLY).
// ============================================================

interface EligibleObservation {
  family: MuhurtaActivityFamily;
  instant: Date;
  durationMinutes: number;
}

/**
 * Fail-closed canonical-identity resolution, then family mapping via the
 * EXISTING familyForActivityProfile() (never a second family-mapping
 * table). A HabitLog with no activityId, or an activityId that no longer
 * resolves to a real catalog entry, is excluded -- never guessed from
 * activityTitle/Habit.category/free text, matching
 * insightsAuraFit.ts's evaluateHabitLogAuraFit() precedent exactly.
 */
function resolveEligibleObservations(habitLogs: readonly HabitLogRow[]): EligibleObservation[] {
  const eligible: EligibleObservation[] = [];
  for (const log of habitLogs) {
    if (!log.activityId) continue; // MISSING_ACTIVITY_ID
    const activity = getActivityProfileById(log.activityId);
    if (!activity) continue; // UNKNOWN_ACTIVITY_ID (catalog drift)
    eligible.push({ family: familyForActivityProfile(activity), instant: log.logTimestamp, durationMinutes: log.durationMinutes });
  }
  return eligible;
}

function affinityForEvidenceCount(count: number): BehavioralAffinity {
  if (count >= STRONG_MIN_EVIDENCE) return 'STRONG';
  if (count >= MODERATE_MIN_EVIDENCE) return 'MODERATE';
  return 'NEUTRAL';
}

/**
 * V1 daypart consistency policy (brief item 16): populated only when the
 * family has enough evidence AND one daypart is not merely the plurality
 * but at least 2/3 of observations. A tie at the maximum observed count
 * is always ambiguous, regardless of which daypart the tie involves.
 */
function derivePreferredDaypart(observations: readonly EligibleObservation[], timezone: string): InsightsDayPart | undefined {
  if (observations.length < MODERATE_MIN_EVIDENCE) return undefined;

  const counts = new Map<InsightsDayPart, number>();
  for (const obs of observations) {
    const { dayPart } = toInsightsObservation(obs.instant, timezone);
    counts.set(dayPart, (counts.get(dayPart) ?? 0) + 1);
  }

  let maxCount = 0;
  let maxDayParts: InsightsDayPart[] = [];
  for (const [dayPart, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      maxDayParts = [dayPart];
    } else if (count === maxCount) {
      maxDayParts.push(dayPart);
    }
  }

  if (maxDayParts.length !== 1) return undefined; // tie at the max -- ambiguous
  if (maxCount * DAYPART_CONSISTENCY_DENOMINATOR < observations.length * DAYPART_CONSISTENCY_NUMERATOR) return undefined;
  return maxDayParts[0];
}

function median(sortedAscending: readonly number[]): number {
  const n = sortedAscending.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sortedAscending[mid - 1] + sortedAscending[mid]) / 2 : sortedAscending[mid];
}

/**
 * V1 typical-duration policy (brief item 18): only valid (finite,
 * positive) durations count; requires at least 3 of them; the result is
 * the median, but ONLY when the durations cluster within
 * DURATION_CONSISTENCY_WINDOW_MINUTES of each other -- otherwise
 * undefined, never a false-precision average across genuinely
 * inconsistent durations.
 */
function deriveTypicalDuration(observations: readonly EligibleObservation[]): number | undefined {
  const durations = observations
    .map((o) => o.durationMinutes)
    .filter((d) => Number.isFinite(d) && d > 0)
    .sort((a, b) => a - b);

  if (durations.length < MODERATE_MIN_EVIDENCE) return undefined;

  const min = durations[0];
  const max = durations[durations.length - 1];
  if (max - min > DURATION_CONSISTENCY_WINDOW_MINUTES) return undefined;

  return Math.round(median(durations));
}

// ============================================================
// Public entry point.
// ============================================================

/**
 * The single public entry point. `habitLogs` may be in any order and is
 * never mutated (a fresh EligibleObservation[]/Map/sorted array is built
 * internally for every derivation). `now` must be the caller's own single
 * captured instant (the same "resolveRequestNow(req), never a hidden
 * Date.now()" discipline every other engine in this repo already follows)
 * -- this function reads it, never generates it.
 *
 * Determinism: identical (habitLogs as a set, timezone, now) always
 * produces an identical result, regardless of habitLogs' input array
 * order -- every aggregation step below groups by value, never depends on
 * first-occurrence/insertion order for its OWN output (see
 * derivePreferredDaypart's tie-handling and deriveTypicalDuration's sort).
 * `activities` is always ordered by CANONICAL_ACTIVITY_FAMILIES, never by
 * input row order.
 */
export function deriveBehavioralProfile(habitLogs: readonly HabitLogRow[], timezone: string, now: Date): BehavioralProfileContext {
  const cutoff = now.getTime() - BEHAVIORAL_AFFINITY_RECENCY_DAYS * MS_PER_DAY;
  const eligible = resolveEligibleObservations(habitLogs).filter((o) => o.instant.getTime() >= cutoff);

  const byFamily = new Map<MuhurtaActivityFamily, EligibleObservation[]>();
  for (const obs of eligible) {
    const list = byFamily.get(obs.family);
    if (list) list.push(obs);
    else byFamily.set(obs.family, [obs]);
  }

  const activities: BehavioralActivityAffinity[] = CANONICAL_ACTIVITY_FAMILIES.map((family) => {
    const observations = byFamily.get(family) ?? [];
    return {
      activityFamily: family,
      affinity: affinityForEvidenceCount(observations.length),
      evidenceCount: observations.length,
      preferredDaypart: derivePreferredDaypart(observations, timezone),
      typicalDurationMinutes: deriveTypicalDuration(observations),
    };
  });

  return {
    engineVersion: BEHAVIORAL_AFFINITY_ENGINE_VERSION,
    policyVersion: BEHAVIORAL_AFFINITY_POLICY_VERSION,
    evaluationTime: now.toISOString(),
    activities,
  };
}
