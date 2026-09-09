/**
 * Window Ranking Engine V1 -- public API.
 *
 * See ../README.md for what this package does (formalizes the ALREADY-LIVE
 * packages/recommendation timing-search ranking as an explicit,
 * per-activity-family contract -- order-preserving, no new scoring, no
 * personal relevance), what it does not do (candidate generation, Aura
 * Fit/Muhurta calculation, conflict resolution algorithms, cross-activity
 * ranking, natural-language guidance), and the exact order-authority rule
 * (input array position + 1 = rank, never a re-sort).
 */
export { deriveWindowRanking } from './engine';
export { rankActivityWindowsFromTimingSearch } from './adapter';
export { normalizeRankedWindows } from './normalize';
export { assertValidWindowRankingInput } from './validation';

export { WINDOW_RANKING_ENGINE_VERSION } from './provenance';
export { CANONICAL_ACTIVITY_FAMILIES } from './constants';

export type { WindowRankingInput, WindowRankingContext, RankedTimingWindow } from './types';
export { WindowRankingValidationError } from './types';

export type { WindowRankingFromTimingSearchInput } from './adapter';
