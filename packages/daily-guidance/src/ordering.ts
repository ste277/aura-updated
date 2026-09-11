/**
 * Daily Guidance Composer V1 -- within-stage ordering.
 *
 * NO NUMERIC COMPOSITE (merge-critical): `compareCandidates` below never
 * adds, multiplies, or otherwise blends `RELEVANCE_TIER_ORDER`,
 * `TIMING_LABEL_TIER_ORDER`, and `BEHAVIORAL_AFFINITY_TIER_ORDER` into one
 * number. Each tuple key is compared independently, in a fixed sequence,
 * and the first non-zero comparison wins -- classic lexicographic
 * ordering, not a weighted score. The tuple (in order): personal relevance
 * tier, timing label tier, timing score (descending, verbatim upstream
 * presentation score, never recomputed), behavioral affinity tier
 * (Behavioral Integration V1), start time (ascending), canonical family
 * order (final tie-break).
 *
 * BEHAVIORAL AFFINITY POSITION (merge-critical, Behavioral Integration
 * V1): deliberately placed AFTER timing score, not before it. Personal
 * relevance and timing label are real, structural product floors; timing
 * score is a genuine, continuous timing-quality signal within a label
 * (see packages/recommendation/src/timingSearch.ts's own
 * `toPresentationScore`) -- a same-label score gap (e.g. GOOD 89 vs GOOD
 * 74) represents a real timing-quality difference that "you've done this
 * before" must never override. Affinity therefore only ever breaks a tie
 * that would otherwise fall through to the already-arbitrary `start`/
 * `canonical family order` tail -- it replaces part of that tie-break
 * chain, never any of the three genuinely meaningful signals ahead of it.
 * `a.behavioralAffinity`/`b.behavioralAffinity` are always resolved,
 * concrete tiers by this point (never undefined) -- see types.ts's own
 * `DailyGuidanceCandidate.behavioralAffinity` doc comment; an omitted
 * `DailyGuidanceInput.behavioralAffinityByFamily` (every pre-Behavioral-Integration-V1 caller)
 * resolves every candidate to `NEUTRAL` in eligibility.ts's own
 * `buildCandidates`, which is a comparison no-op here and reproduces V1's
 * pre-integration ranking output exactly.
 */
import { RELEVANCE_TIER_ORDER, TIMING_LABEL_TIER_ORDER, BEHAVIORAL_AFFINITY_TIER_ORDER, CANONICAL_ACTIVITY_FAMILIES } from './constants';
import type { DailyGuidanceCandidate } from './types';

const CANONICAL_FAMILY_INDEX = new Map(CANONICAL_ACTIVITY_FAMILIES.map((family, index) => [family, index]));

export function compareCandidates(a: DailyGuidanceCandidate, b: DailyGuidanceCandidate): number {
  const relevanceDiff = RELEVANCE_TIER_ORDER[a.personalRelevance] - RELEVANCE_TIER_ORDER[b.personalRelevance];
  if (relevanceDiff !== 0) return relevanceDiff;

  const timingDiff = TIMING_LABEL_TIER_ORDER[a.window.label] - TIMING_LABEL_TIER_ORDER[b.window.label];
  if (timingDiff !== 0) return timingDiff;

  const scoreDiff = b.window.score - a.window.score; // higher score wins -> descending
  if (scoreDiff !== 0) return scoreDiff;

  const affinityDiff = BEHAVIORAL_AFFINITY_TIER_ORDER[a.behavioralAffinity] - BEHAVIORAL_AFFINITY_TIER_ORDER[b.behavioralAffinity];
  if (affinityDiff !== 0) return affinityDiff;

  const startDiff = new Date(a.window.start).getTime() - new Date(b.window.start).getTime(); // earlier start wins -> ascending
  if (startDiff !== 0) return startDiff;

  return (CANONICAL_FAMILY_INDEX.get(a.family) ?? 0) - (CANONICAL_FAMILY_INDEX.get(b.family) ?? 0);
}

/** Returns a NEW, sorted array -- never mutates `candidates` (see engine.ts's own immutability guarantee). */
export function sortCandidates(candidates: readonly DailyGuidanceCandidate[]): DailyGuidanceCandidate[] {
  return [...candidates].sort(compareCandidates);
}
