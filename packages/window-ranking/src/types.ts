/**
 * Window Ranking Engine V1 -- shared types.
 *
 * This package formalizes the ALREADY-LIVE, already-ranked output of
 * packages/recommendation's own timing-search system
 * (packages/recommendation/src/timingSearch.ts's `runTimingSearch`) into a
 * clean, explicit, per-activity-family contract -- it does not recompute
 * or reinterpret any of that scoring. See engine.ts's own doc comment for
 * the full pure-composition guarantee.
 *
 * PERSONAL RELEVANCE IS ABSENT BY DESIGN: this package has zero
 * dependency on packages/daily-personal-fit / packages/personal-intelligence
 * / packages/life-weather. Personal relevance (#102) is constant across
 * every timing candidate for one activity family, so it cannot affect
 * within-family window order -- see README.md's "Personal relevance
 * absent" section for the full architectural reasoning. #104 is the
 * layer that will combine the two axes.
 */
import type { MuhurtaActivityFamily } from '../../muhurta/src/muhurtaEngine';
import type { TimingCandidate } from '../../recommendation/src/timingSearch';

/**
 * One already-evaluated timing candidate, with an explicit 1-based `rank`
 * attached. Every other field is preserved VERBATIM from the upstream
 * `TimingCandidate` -- `start`/`end` are kept as-is (not renamed to
 * `startAt`/`endAt`) specifically to avoid an unnecessary timestamp
 * transformation; `score`/`label`/`muhurtaScore`/`auraFitScore`/`reasons`/
 * `conflicts`/`metadata` are never recomputed, renormalized, or relabeled
 * here. See normalize.ts's own doc comment for the exact rank-assignment
 * rule (input array position + 1 -- never a re-sort).
 */
export type RankedTimingWindow = TimingCandidate & { rank: number };

/**
 * The core engine's own input. `candidates` MUST already be in the exact
 * order the upstream timing-search system itself considers canonical
 * (`runTimingSearch`'s own FIND/COMPARE output, or an equivalent
 * already-ranked source) -- this package never re-sorts them. See
 * engine.ts's own "Important -- input candidates are already ranked"
 * doc comment.
 */
export interface WindowRankingInput {
  activityFamily: MuhurtaActivityFamily;
  candidates: TimingCandidate[];
}

/** The complete V1 result -- exactly one activity family's own ranked window list. Never a cross-family/global structure -- see README.md's "No global ranking" section. `windows` may legitimately be `[]` when the upstream search found no eligible candidate at all -- this is a valid, non-error result. */
export interface WindowRankingContext {
  engineVersion: string;
  activityFamily: MuhurtaActivityFamily;
  windows: RankedTimingWindow[];
}

/** Thrown by engine.ts/validation.ts on malformed input -- see validation.ts's own doc comment for exactly which conditions reject. */
export class WindowRankingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WindowRankingValidationError';
  }
}
