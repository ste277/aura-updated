/**
 * Window Ranking Engine V1 -- public pure engine.
 *
 * PURE COMPOSITION. This function never calls `runTimingSearch`,
 * `evaluateActivityFit`, `evaluateMuhurta`, or `getPanchangForDate` -- it
 * consumes an already-computed `TimingCandidate[]` only (typically
 * produced by `runTimingSearch`'s own FIND/COMPARE modes, or the
 * `rankActivityWindowsFromTimingSearch` convenience adapter in
 * adapter.ts). See README.md's "Critical finding" section for why this
 * package does not, and must not, reimplement candidate generation,
 * 15-minute search stepping, atomic window segmentation, overlap
 * handling, hard-block dominance, or Aura Fit/Muhurta scoring -- all of
 * that already exists, live, in packages/recommendation.
 *
 * IMPORTANT -- INPUT CANDIDATES ARE ALREADY RANKED (merge-critical): see
 * normalize.ts's own doc comment. This engine assigns `rank` from array
 * position alone and never sorts.
 *
 * NO PERSONAL RELEVANCE: this engine's own input/output has zero
 * reference to `DailyPersonalFitContext`/`PersonalRelevance` -- see
 * types.ts's own doc comment for why personal relevance cannot affect
 * within-family window order.
 */
import { normalizeRankedWindows } from './normalize';
import { assertValidWindowRankingInput } from './validation';
import { WINDOW_RANKING_ENGINE_VERSION } from './provenance';
import type { WindowRankingInput, WindowRankingContext } from './types';

/**
 * The core public entry point. Given one activity family and its own
 * already-evaluated, already-ranked `TimingCandidate[]`, deterministically
 * attaches an explicit 1-based `rank` to each candidate (never re-sorting)
 * and wraps the result in a `WindowRankingContext` scoped to exactly that
 * one activity family. `candidates: []` is a valid input, producing
 * `windows: []` -- never an error (see validation.ts's own doc comment:
 * an empty result means the upstream search found no eligible candidate,
 * which #104 can decide how to present).
 *
 * No `Date.now()`, no randomness, no network/DB/LLM call anywhere in
 * this function or anything it calls.
 */
export function deriveWindowRanking(input: WindowRankingInput): WindowRankingContext {
  assertValidWindowRankingInput(input);

  return {
    engineVersion: WINDOW_RANKING_ENGINE_VERSION,
    activityFamily: input.activityFamily,
    windows: normalizeRankedWindows(input.candidates),
  };
}
