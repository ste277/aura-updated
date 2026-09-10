/**
 * Daily Guidance Composer V1 -- public API.
 *
 * See ../README.md for what this engine does (a deterministic,
 * staged-eligibility cross-family selection joining an already-computed
 * DailyPersonalFitContext with already-ranked, per-family
 * WindowRankingContext results into up to N structured recommendations),
 * what it does not do (no astrology, no Muhurta/Aura Fit/timing-search
 * recomputation, no within-family re-ranking, no numeric composite score,
 * no natural-language copy, no Home UI -- see the "Non-goals" section),
 * and the exact staged selection policy (Stage 1 PRIMARY_FLOOR_MET, Stage
 * 2 RELAXED_TIMING_FLOOR, Stage 3 RELAXED_RELEVANCE_FLOOR -- never a
 * fourth stage).
 */
export { deriveDailyGuidance } from './engine';
export { buildCandidates, isEligibleForStage, SELECTION_STAGES } from './eligibility';
export { compareCandidates, sortCandidates } from './ordering';
export { windowsOverlap } from './overlap';
export { buildSelectionEvidence, buildTimingEvidence, buildResultSummaryEvidence } from './evidence';
export { assertValidDailyGuidanceInput } from './validation';

export { DAILY_GUIDANCE_ENGINE_VERSION, DAILY_GUIDANCE_SELECTION_POLICY_VERSION, DAILY_GUIDANCE_SELECTION_V1, DAILY_GUIDANCE_SUMMARY_V1 } from './provenance';

export { CANONICAL_ACTIVITY_FAMILIES, CANONICAL_ACTIVITY_FAMILY_COUNT, RELEVANCE_TIER_ORDER, TIMING_LABEL_TIER_ORDER, DEFAULT_LIMIT } from './constants';

export type { DailyGuidanceInput, DailyGuidanceCandidate } from './types';
export { DailyGuidanceValidationError } from './types';
