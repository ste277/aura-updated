/**
 * Window Ranking Engine V1 -- rank assignment.
 *
 * MERGE-CRITICAL: `output rank = input array position + 1`. This function
 * NEVER sorts, re-scores, or reinterprets `candidates` -- the array order
 * it receives is treated as authoritatively, already canonically ranked
 * by the upstream production timing-search system (see README.md's
 * "Important -- order semantics" section for the full reasoning: the
 * exposed `TimingCandidate.score` is a presentation score, and re-sorting
 * from it here could collapse distinctions the production system's own
 * internal raw scoring + deterministic tie-breaking already resolved).
 *
 * Every field on each input candidate is preserved verbatim via a
 * shallow copy (`{ ...candidate, rank }`) -- the original `candidates`
 * array and every candidate object within it are never mutated.
 */
import type { TimingCandidate } from '../../recommendation/src/timingSearch';
import type { RankedTimingWindow } from './types';

export function normalizeRankedWindows(candidates: readonly TimingCandidate[]): RankedTimingWindow[] {
  return candidates.map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}
