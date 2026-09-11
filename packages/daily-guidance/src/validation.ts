/**
 * Daily Guidance Composer V1 -- input validation.
 *
 * Validates only structural shape and the cross-contract join invariants
 * this engine itself depends on -- never astrology, never Muhurta/Aura
 * Fit correctness, and never a full re-validation of #102's or #103's own
 * internal invariants (each package's own responsibility). Every
 * `DailyActivityFit`/`RankedTimingWindow` is trusted as already-correct
 * upstream output; this only rejects a genuinely malformed input shape or
 * a structurally ambiguous join before the pure core runs.
 */
import { CANONICAL_ACTIVITY_FAMILIES } from './constants';
import { DailyGuidanceValidationError } from './types';
import type { DailyGuidanceInput } from './types';

const VALID_RELEVANCE = new Set(['BASELINE', 'RELEVANT', 'HIGHLY_RELEVANT']);
const CANONICAL_FAMILY_SET = new Set<string>(CANONICAL_ACTIVITY_FAMILIES);

/**
 * Require ALL 13 canonical families in `dailyPersonalFit.activities` --
 * this is not a new restriction invented by this package, it is simply
 * enforcing a structural guarantee `DailyPersonalFitContext` ALREADY
 * makes for every valid instance (see packages/personal-intelligence's
 * own context.ts doc comment on DailyPersonalFitContext: "always one
 * entry per canonical activity family ... never sparse"). Rejecting a
 * malformed/partial DPF vector here is defense-in-depth, not a new
 * product rule -- see README.md's "Validation" section.
 */
function assertValidDailyPersonalFit(dailyPersonalFit: DailyGuidanceInput['dailyPersonalFit']): void {
  if (dailyPersonalFit == null || typeof dailyPersonalFit !== 'object') {
    throw new DailyGuidanceValidationError('DailyGuidanceInput.dailyPersonalFit must be an object.');
  }
  if (typeof dailyPersonalFit.evaluationTime !== 'string' || dailyPersonalFit.evaluationTime.length === 0) {
    throw new DailyGuidanceValidationError(`dailyPersonalFit.evaluationTime must be a non-empty string, got: ${String(dailyPersonalFit.evaluationTime)}.`);
  }
  if (!Array.isArray(dailyPersonalFit.activities)) {
    throw new DailyGuidanceValidationError('dailyPersonalFit.activities must be an array.');
  }

  const seen = new Set<string>();
  for (const activity of dailyPersonalFit.activities) {
    if (activity == null || typeof activity !== 'object') {
      throw new DailyGuidanceValidationError('dailyPersonalFit.activities entries must be objects.');
    }
    if (!CANONICAL_FAMILY_SET.has(activity.activityFamily)) {
      throw new DailyGuidanceValidationError(`dailyPersonalFit.activities contains a non-canonical activityFamily: ${String(activity.activityFamily)}.`);
    }
    if (seen.has(activity.activityFamily)) {
      throw new DailyGuidanceValidationError(`dailyPersonalFit.activities contains a duplicate activityFamily: ${activity.activityFamily}.`);
    }
    seen.add(activity.activityFamily);
    if (!VALID_RELEVANCE.has(activity.personalRelevance)) {
      throw new DailyGuidanceValidationError(`dailyPersonalFit.activities[${activity.activityFamily}].personalRelevance must be one of BASELINE/RELEVANT/HIGHLY_RELEVANT, got: ${String(activity.personalRelevance)}.`);
    }
    if (!Array.isArray(activity.relevantThemes)) {
      throw new DailyGuidanceValidationError(`dailyPersonalFit.activities[${activity.activityFamily}].relevantThemes must be an array.`);
    }
  }
  if (seen.size !== CANONICAL_ACTIVITY_FAMILIES.length) {
    throw new DailyGuidanceValidationError(`dailyPersonalFit.activities must cover all ${CANONICAL_ACTIVITY_FAMILIES.length} canonical activity families, got ${seen.size} distinct families.`);
  }

  return undefined;
}

/** Validates each supplied WindowRankingContext's own shape and rejects duplicate family contexts -- never re-validates #103's own internal candidate/reason/conflict shapes beyond what composition itself needs (see assertValidSelectedWindow below for the minimal per-candidate checks that DO matter to composition). */
function assertValidWindowRankings(windowRankings: DailyGuidanceInput['windowRankings']): void {
  if (!Array.isArray(windowRankings)) {
    throw new DailyGuidanceValidationError('DailyGuidanceInput.windowRankings must be an array (partial coverage -- fewer than 13 entries -- is valid).');
  }

  const seen = new Set<string>();
  for (const ranking of windowRankings) {
    if (ranking == null || typeof ranking !== 'object') {
      throw new DailyGuidanceValidationError('windowRankings entries must be objects.');
    }
    if (!CANONICAL_FAMILY_SET.has(ranking.activityFamily)) {
      throw new DailyGuidanceValidationError(`windowRankings contains a non-canonical activityFamily: ${String(ranking.activityFamily)}.`);
    }
    if (seen.has(ranking.activityFamily)) {
      throw new DailyGuidanceValidationError(`windowRankings contains a duplicate WindowRankingContext for activityFamily: ${ranking.activityFamily}. Structurally ambiguous -- this engine never picks "first wins"/"last wins"/"best wins".`);
    }
    seen.add(ranking.activityFamily);
    if (!Array.isArray(ranking.windows)) {
      throw new DailyGuidanceValidationError(`windowRankings[${ranking.activityFamily}].windows must be an array (an empty array is valid).`);
    }
    if (ranking.windows.length > 0) {
      const best = ranking.windows[0];
      if (best == null || typeof best !== 'object') {
        throw new DailyGuidanceValidationError(`windowRankings[${ranking.activityFamily}].windows[0] must be an object.`);
      }
      if (best.rank !== 1) {
        throw new DailyGuidanceValidationError(`windowRankings[${ranking.activityFamily}].windows[0].rank must be 1 (this engine trusts #103's own rank-1-best guarantee and never inspects rank 2/3), got: ${String(best.rank)}.`);
      }
      if (typeof best.start !== 'string' || best.start.length === 0) {
        throw new DailyGuidanceValidationError(`windowRankings[${ranking.activityFamily}].windows[0].start must be a non-empty string.`);
      }
      if (typeof best.end !== 'string' || best.end.length === 0) {
        throw new DailyGuidanceValidationError(`windowRankings[${ranking.activityFamily}].windows[0].end must be a non-empty string.`);
      }
      if (typeof best.score !== 'number' || !Number.isFinite(best.score)) {
        throw new DailyGuidanceValidationError(`windowRankings[${ranking.activityFamily}].windows[0].score must be a finite number.`);
      }
      if (typeof best.label !== 'string' || best.label.length === 0) {
        throw new DailyGuidanceValidationError(`windowRankings[${ranking.activityFamily}].windows[0].label must be a non-empty string.`);
      }
    }
  }
}

/** Rejects a WindowRankingContext family with no matching DailyActivityFit entry -- structurally near-unreachable once dailyPersonalFit's own "all 13" invariant already held above, but validated anyway (defense-in-depth against a malformed/hand-built input, matching this repo's general practice of validating structural invariants explicitly rather than assuming them). */
function assertJoinCompleteness(input: DailyGuidanceInput): void {
  const fitFamilies = new Set(input.dailyPersonalFit.activities.map((a) => a.activityFamily));
  for (const ranking of input.windowRankings) {
    if (!fitFamilies.has(ranking.activityFamily)) {
      throw new DailyGuidanceValidationError(`windowRankings references activityFamily "${ranking.activityFamily}" which has no matching entry in dailyPersonalFit.activities -- contract mismatch.`);
    }
  }
}

function assertValidLimit(limit: unknown): void {
  if (limit === undefined) return;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit <= 0) {
    throw new DailyGuidanceValidationError(`limit must be a positive integer when supplied, got: ${String(limit)}.`);
  }
}

const VALID_BEHAVIORAL_AFFINITY_TIERS = new Set(['STRONG', 'MODERATE', 'NEUTRAL']);

/**
 * Behavioral Integration V1 -- OPTIONAL, matching assertValidLimit's own
 * "undefined is always valid" discipline: an omitted map (every caller
 * before Behavioral Integration V1) is valid and resolves every candidate to NEUTRAL in
 * eligibility.ts's own buildCandidates (see that function's doc comment).
 * When supplied, only rejects a genuinely malformed shape -- a
 * non-canonical family key or a non-tier value -- never re-validates
 * anything #110 itself already guarantees.
 */
function assertValidBehavioralAffinityByFamily(behavioralAffinityByFamily: unknown): void {
  if (behavioralAffinityByFamily === undefined) return;
  if (behavioralAffinityByFamily == null || typeof behavioralAffinityByFamily !== 'object' || Array.isArray(behavioralAffinityByFamily)) {
    throw new DailyGuidanceValidationError('behavioralAffinityByFamily must be an object when supplied.');
  }
  for (const [family, tier] of Object.entries(behavioralAffinityByFamily)) {
    if (!CANONICAL_FAMILY_SET.has(family)) {
      throw new DailyGuidanceValidationError(`behavioralAffinityByFamily contains a non-canonical activityFamily: ${family}.`);
    }
    if (!VALID_BEHAVIORAL_AFFINITY_TIERS.has(tier as string)) {
      throw new DailyGuidanceValidationError(`behavioralAffinityByFamily[${family}] must be one of STRONG/MODERATE/NEUTRAL, got: ${String(tier)}.`);
    }
  }
}

/**
 * Preferred Daypart Personalization V1 -- OPTIONAL, matching
 * assertValidBehavioralAffinityByFamily's own discipline exactly: an
 * omitted map (every caller before this feature) is valid and resolves
 * every candidate to `false` in eligibility.ts's own buildCandidates.
 * When supplied, only rejects a genuinely malformed shape -- a
 * non-canonical family key or a non-boolean value -- never re-validates
 * anything #110's own daypart derivation already guarantees.
 */
function assertValidPreferredDaypartMatchByFamily(preferredDaypartMatchByFamily: unknown): void {
  if (preferredDaypartMatchByFamily === undefined) return;
  if (preferredDaypartMatchByFamily == null || typeof preferredDaypartMatchByFamily !== 'object' || Array.isArray(preferredDaypartMatchByFamily)) {
    throw new DailyGuidanceValidationError('preferredDaypartMatchByFamily must be an object when supplied.');
  }
  for (const [family, match] of Object.entries(preferredDaypartMatchByFamily)) {
    if (!CANONICAL_FAMILY_SET.has(family)) {
      throw new DailyGuidanceValidationError(`preferredDaypartMatchByFamily contains a non-canonical activityFamily: ${family}.`);
    }
    if (typeof match !== 'boolean') {
      throw new DailyGuidanceValidationError(`preferredDaypartMatchByFamily[${family}] must be a boolean, got: ${String(match)}.`);
    }
  }
}

export function assertValidDailyGuidanceInput(input: DailyGuidanceInput): void {
  if (input == null || typeof input !== 'object') {
    throw new DailyGuidanceValidationError('DailyGuidanceInput must be an object with dailyPersonalFit and windowRankings properties.');
  }
  assertValidDailyPersonalFit(input.dailyPersonalFit);
  assertValidWindowRankings(input.windowRankings);
  assertJoinCompleteness(input);
  assertValidLimit(input.limit);
  assertValidBehavioralAffinityByFamily(input.behavioralAffinityByFamily);
  assertValidPreferredDaypartMatchByFamily(input.preferredDaypartMatchByFamily);
}
