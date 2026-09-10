/**
 * Daily Guidance Composer V1 -- within-stage ordering.
 *
 * NO NUMERIC COMPOSITE (merge-critical): `compareCandidates` below never
 * adds, multiplies, or otherwise blends `RELEVANCE_TIER_ORDER` and
 * `TIMING_LABEL_TIER_ORDER` into one number. Each tuple key is compared
 * independently, in a fixed sequence, and the first non-zero comparison
 * wins -- classic lexicographic ordering, not a weighted score. The tuple
 * (in order): personal relevance tier, timing label tier, timing score
 * (descending, verbatim upstream presentation score, never recomputed),
 * start time (ascending), canonical family order (final tie-break).
 */
import { RELEVANCE_TIER_ORDER, TIMING_LABEL_TIER_ORDER, CANONICAL_ACTIVITY_FAMILIES } from './constants';
import type { DailyGuidanceCandidate } from './types';

const CANONICAL_FAMILY_INDEX = new Map(CANONICAL_ACTIVITY_FAMILIES.map((family, index) => [family, index]));

export function compareCandidates(a: DailyGuidanceCandidate, b: DailyGuidanceCandidate): number {
  const relevanceDiff = RELEVANCE_TIER_ORDER[a.personalRelevance] - RELEVANCE_TIER_ORDER[b.personalRelevance];
  if (relevanceDiff !== 0) return relevanceDiff;

  const timingDiff = TIMING_LABEL_TIER_ORDER[a.window.label] - TIMING_LABEL_TIER_ORDER[b.window.label];
  if (timingDiff !== 0) return timingDiff;

  const scoreDiff = b.window.score - a.window.score; // higher score wins -> descending
  if (scoreDiff !== 0) return scoreDiff;

  const startDiff = new Date(a.window.start).getTime() - new Date(b.window.start).getTime(); // earlier start wins -> ascending
  if (startDiff !== 0) return startDiff;

  return (CANONICAL_FAMILY_INDEX.get(a.family) ?? 0) - (CANONICAL_FAMILY_INDEX.get(b.family) ?? 0);
}

/** Returns a NEW, sorted array -- never mutates `candidates` (see engine.ts's own immutability guarantee). */
export function sortCandidates(candidates: readonly DailyGuidanceCandidate[]): DailyGuidanceCandidate[] {
  return [...candidates].sort(compareCandidates);
}
