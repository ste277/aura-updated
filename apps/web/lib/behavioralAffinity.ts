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
 * Activity-Level Typical Duration Foundation V1 additionally derives a
 * per-ACTIVITY (not per-family) typical-duration signal
 * (`BehavioralProfileContext.activityDurations`) from the exact same
 * HabitLog input, exactly one fetch, zero new queries. Also FOUNDATION
 * ONLY, per its own architecture audit's Option A verdict ("FOUNDATION
 * READY, CONSUMPTION DEFERRED") -- nothing outside this file and its own
 * tests reads `activityDurations` yet. See that field's own doc comment
 * for why this exists alongside the family-level `typicalDurationMinutes`
 * above (short answer: several families contain multiple activities with
 * substantially different natural durations, so family-level duration is
 * not a safe per-activity default -- Typical Duration Personalization V1
 * was BLOCKED for exactly this reason).
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
 *
 * SEMANTICS (Behavioral Semantics Correction V1, architecture audit
 * "Confidence & Signal Quality"): every field this module derives is a
 * DESCRIPTIVE RECENT-BEHAVIOR AGGREGATE, not a validated preference
 * signal -- read each field's own doc comment below for the exact
 * distinction (`BehavioralAffinity` measures observed completion
 * frequency, never liking/psychological affinity; `preferredDaypart`
 * measures the dominant logged daypart, never a proven or unconstrained
 * time-of-day preference). Both are also OPPORTUNITY-BIASED: a family or
 * daypart a user performs/logs often accumulates evidence faster than a
 * rare one, and some activities are daypart-constrained by their own
 * nature (e.g. a breakfast-labeled activity clusters in the morning for
 * nearly everyone) -- neither effect is preference strength, and no
 * derivation step here corrects for it. `logSource` is intentionally
 * never read by this module (see resolveEligibleObservations below) --
 * every eligible HabitLog counts identically regardless of whether the
 * user chose it entirely themselves or accepted an Aura-originated
 * suggestion verbatim, so these aggregates are source-agnostic as well as
 * unvalidated against real outcomes (see the architecture audit's own
 * "no product telemetry currently joins HabitLog to acceptance/override
 * outcomes" finding). None of this makes the signals unsafe for their
 * CURRENT consumers (see each consumer's own doc comment for why), but it
 * does mean no consumer or future reader should describe a `STRONG`
 * affinity, a `preferredDaypart`, or a `typicalDurationMinutes` as this
 * user's stated or inferred preference -- only as what was recently,
 * repeatedly logged.
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
/** Bumped V1 -> V2 for Activity-Level Typical Duration Foundation V1: a
 * new derivation policy/output capability (activityDurations) was added.
 * ENGINE_VERSION stays V1 -- every existing output field
 * (affinity/evidenceCount/preferredDaypart/family-level
 * typicalDurationMinutes) and its own derivation semantics are byte-for-
 * byte unchanged; activityDurations is purely additive. */
export const BEHAVIORAL_AFFINITY_POLICY_VERSION = 'BEHAVIORAL_AFFINITY_POLICY_V2' as const;

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

/** Behavioral Semantics Correction V1 (architecture audit "Confidence &
 * Signal Quality") -- despite the name, this tier is derived SOLELY from
 * `evidenceCount` (see `affinityForEvidenceCount` below): `STRONG` means
 * "5 or more eligible completions were logged for this family in the
 * trailing BEHAVIORAL_AFFINITY_RECENCY_DAYS window," `MODERATE` means "3
 * or 4," `NEUTRAL` means fewer. It reflects OBSERVED COMPLETION FREQUENCY,
 * never an inferred psychological preference, liking, or intrinsic
 * interest -- and it carries no consistency/stability structure of its
 * own (unlike `preferredDaypart`'s 2/3-dominance gate or
 * `typicalDurationMinutes`'s range gate). Because it is pure frequency,
 * families with naturally higher execution opportunity (e.g. MEAL,
 * WORKOUT) will reach `STRONG` faster than genuinely rare-but-important
 * ones (e.g. JOURNEY_START, NEW_BEGINNING) independent of how strongly
 * the user actually prefers either -- `STRONG` tiers must never be
 * compared across families as if they represented equivalent preference
 * strength. */
export type BehavioralAffinity = 'STRONG' | 'MODERATE' | 'NEUTRAL';

/** Deliberately minimal (brief: PRIVACY CONTRACT) -- no activity titles,
 * no individual timestamps, no raw log/Plan ids, no notes, no raw event
 * arrays. Aggregate facts only.
 *
 * `affinity` -- see `BehavioralAffinity`'s own doc comment for exactly
 * what this tier does and does not represent (recent frequency, not
 * preference).
 *
 * `preferredDaypart` -- see `derivePreferredDaypart`'s own doc comment
 * for its exact semantics (the dominant logged daypart, not a proven
 * time-of-day preference).
 *
 * `typicalDurationMinutes` here is a FAMILY-LEVEL aggregate, not an
 * activity-specific one -- several families contain multiple activities
 * with substantially different natural durations (architecture audit,
 * Typical Duration Personalization V1: BLOCKED), so this value must never
 * be used as a per-activity default. See `BehavioralActivityDuration`
 * below for the activity-level signal this module also derives. */
export interface BehavioralActivityAffinity {
  activityFamily: MuhurtaActivityFamily;
  affinity: BehavioralAffinity;
  evidenceCount: number;
  preferredDaypart?: InsightsDayPart;
  typicalDurationMinutes?: number;
}

/**
 * Activity-Level Typical Duration Foundation V1 -- a per-ACTIVITY sibling
 * to the family-level `typicalDurationMinutes` above, resolving the exact
 * granularity gap that blocked using the family-level aggregate as a
 * per-activity default (architecture audit, Typical Duration
 * Personalization V1). Same privacy discipline as
 * `BehavioralActivityAffinity`: no evidence count, no timestamps, no raw
 * durations, no logSource -- only the derived fact itself. FOUNDATION
 * ONLY: this has no consumer yet (see module doc comment); nothing reads
 * `BehavioralProfileContext.activityDurations` outside this file and its
 * own tests.
 */
export interface BehavioralActivityDuration {
  activityId: string;
  typicalDurationMinutes: number;
}

/**
 * Behavior-aware Day Builder Duration V1 -- the one pure projection this
 * feature's own architecture audit calls for: `profile.activityDurations`
 * (a sparse array) collapsed into a plain, easy-to-look-up map, built
 * SOLELY from that array -- no DB, no date/time logic, no fallback
 * resolution, and no family-level `typicalDurationMinutes` (see that
 * field's own doc comment for why it must never be used as a per-activity
 * default). Consumers (dayBuilderOrchestrator.ts's own duration resolver)
 * decide what to do with a missing key; this function only reshapes
 * already-derived data.
 */
export function activityDurationByActivityId(profile: BehavioralProfileContext): Readonly<Record<string, number>> {
  const byActivityId: Record<string, number> = {};
  for (const entry of profile.activityDurations) {
    byActivityId[entry.activityId] = entry.typicalDurationMinutes;
  }
  return byActivityId;
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
  /** Activity-Level Typical Duration Foundation V1 -- SPARSE (only
   * activityIds that clear the same evidence/consistency policy
   * `typicalDurationMinutes` already uses are present; never a full
   * catalog-sized vector with `undefined` entries -- unlike `activities`
   * above, there is no existing fixed-cardinality contract for this
   * signal to match, and the activity catalog is open-ended). Ordered by
   * `activityId` ascending, never by HabitLog input order -- see
   * deriveBehavioralProfile's own determinism doc comment. */
  activityDurations: BehavioralActivityDuration[];
}

// ============================================================
// Eligibility (brief: ACTIVITY NORMALIZATION, COMPLETED EVIDENCE ONLY).
// ============================================================

interface EligibleObservation {
  family: MuhurtaActivityFamily;
  /** Activity-Level Typical Duration Foundation V1 -- the SAME already-
   * validated canonical id resolveEligibleObservations() below confirms via
   * getActivityProfileById(), carried through rather than discarded. Never
   * a second lookup, never a second normalization path -- this is exactly
   * the id family-level grouping already trusts, just not thrown away
   * before activity-level grouping gets a chance to use it too. */
  activityId: string;
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
 *
 * SOURCE-AGNOSTIC BY DESIGN (Behavioral Semantics Correction V1): `log.logSource`
 * (`'MANUAL' | 'AURA_PLANNED' | 'AURA_DO_NOW' | 'OVERRIDE_CAUTION'`) is
 * intentionally never read here -- every eligible completion counts
 * identically in V1/V2 regardless of how it originated. This is why the
 * signals this module derives are descriptive aggregates of what was
 * logged, not a measure of how independently or deliberately each entry
 * was chosen (see the module's own SEMANTICS doc comment above).
 * `OVERRIDE_CAUTION` specifically is not a distinct higher-intent user
 * action -- apps/web/app/page.tsx's own handleLogActivity retroactively
 * relabels an ordinary `'MANUAL'` log as `OVERRIDE_CAUTION` whenever it
 * happens to fall inside an inauspicious Muhurta window with non-LOW
 * significance; the user never sees or confirms an explicit
 * "continue despite caution" action tied to that label, so it must not be
 * read as stronger evidence of intent than any other MANUAL entry.
 */
function resolveEligibleObservations(habitLogs: readonly HabitLogRow[]): EligibleObservation[] {
  const eligible: EligibleObservation[] = [];
  for (const log of habitLogs) {
    if (!log.activityId) continue; // MISSING_ACTIVITY_ID
    const activity = getActivityProfileById(log.activityId);
    if (!activity) continue; // UNKNOWN_ACTIVITY_ID (catalog drift)
    eligible.push({ family: familyForActivityProfile(activity), activityId: log.activityId, instant: log.logTimestamp, durationMinutes: log.durationMinutes });
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
 *
 * SEMANTICS (Behavioral Semantics Correction V1): despite the field name
 * `preferredDaypart`, this is the DOMINANT LOGGED DAYPART among recent
 * eligible observations -- the daypart this family was most often
 * completed/logged in, not a proven or unconstrained statement of when
 * the user prefers it. Some activities are structurally associated with a
 * time of day regardless of who is doing them (a breakfast-labeled
 * activity clusters in the morning for nearly every user) -- for those,
 * the 2/3-dominance gate below can be satisfied by the activity's own
 * nature rather than by anything specific to this user, and this
 * derivation has no way to distinguish the two cases. Callers should
 * treat this field as "commonly logged at this time," not as a validated
 * preference claim.
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

/**
 * Activity-Level Typical Duration Foundation V1: the SAME duration policy
 * as `deriveTypicalDuration` (identical valid-duration filter, identical
 * MODERATE_MIN_EVIDENCE floor, identical DURATION_CONSISTENCY_WINDOW_MINUTES
 * range guard, identical median+round) applied per canonical `activityId`
 * instead of per `family` -- resolving the exact granularity gap the
 * architecture audit found: several families contain multiple activities
 * with substantially different natural durations, so a family-level
 * median is not a safe stand-in for any one activity's own typical
 * duration. No new threshold, no new statistics, no source weighting.
 *
 * SPARSE, DETERMINISTIC OUTPUT: only activityIds that clear
 * deriveTypicalDuration's own bar are included (never a full-catalog
 * vector with undefined entries -- there is no fixed-cardinality contract
 * for this signal, unlike the 13-entry family vector), and the result is
 * always sorted by `activityId` ascending -- never by HabitLog/Map
 * insertion order -- so output is independent of `eligible`'s own input
 * order, matching deriveBehavioralProfile's own determinism guarantee.
 */
function deriveActivityDurations(eligible: readonly EligibleObservation[]): BehavioralActivityDuration[] {
  const byActivityId = new Map<string, EligibleObservation[]>();
  for (const obs of eligible) {
    const list = byActivityId.get(obs.activityId);
    if (list) list.push(obs);
    else byActivityId.set(obs.activityId, [obs]);
  }

  const activityDurations: BehavioralActivityDuration[] = [];
  for (const [activityId, observations] of byActivityId) {
    const typicalDurationMinutes = deriveTypicalDuration(observations);
    if (typicalDurationMinutes !== undefined) activityDurations.push({ activityId, typicalDurationMinutes });
  }

  return activityDurations.sort((a, b) => (a.activityId < b.activityId ? -1 : a.activityId > b.activityId ? 1 : 0));
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
 * input row order; `activityDurations` (Activity-Level Typical Duration
 * Foundation V1) is always ordered by `activityId` ascending, same
 * discipline, for the same reason.
 *
 * ONE fetch, THREE pure projections of the SAME `eligible` set (Activity-
 * Level Typical Duration Foundation V1): `byFamily`/`activities` and
 * `deriveActivityDurations` both read the identical `eligible` array this
 * function already computed -- never a second HabitLog read, never a
 * second recency filter.
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
    activityDurations: deriveActivityDurations(eligible),
  };
}
