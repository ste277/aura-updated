/**
 * Daily Guidance Composer V1 -- shared internal types.
 *
 * This engine joins an already-computed DailyPersonalFitContext (the
 * personal-relevance axis) with already-ranked, per-family
 * WindowRankingContext results (the timing axis) to select up to `limit`
 * cross-family recommendations -- it never recomputes either axis. See
 * engine.ts's own doc comment for the full pure-composition guarantee.
 */
import type { DailyPersonalFitContext } from '../../personal-intelligence/src/context';
import type { WindowRankingContext, RankedTimingWindow } from '../../window-ranking/src/types';
import type { MuhurtaActivityFamily } from '../../muhurta/src/muhurtaEngine';

/**
 * The core engine's own input. `windowRankings` need NOT cover all 13
 * canonical families -- a family with no supplied WindowRankingContext
 * simply cannot become a recommendation (no timing data to join against).
 * `limit` defaults to 3 (constants.ts's own DEFAULT_LIMIT) when omitted.
 */
export interface DailyGuidanceInput {
  dailyPersonalFit: DailyPersonalFitContext;
  windowRankings: WindowRankingContext[];
  limit?: number;
}

/** Thrown by engine.ts/validation.ts on malformed input -- see validation.ts's own doc comment for exactly which conditions reject. */
export class DailyGuidanceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DailyGuidanceValidationError';
  }
}

/**
 * One family's own already-joined candidate for cross-family selection --
 * an internal shape, never exposed on the public API. `family` is
 * narrowed to the typed `MuhurtaActivityFamily` (validation.ts has
 * already confirmed it's one of the 13 canonical values by this point);
 * `window` is always the family's own rank-1 window (see eligibility.ts's
 * own "best window only" doc comment -- rank 2/3 are never read).
 */
export interface DailyGuidanceCandidate {
  family: MuhurtaActivityFamily;
  personalRelevance: 'HIGHLY_RELEVANT' | 'RELEVANT' | 'BASELINE';
  relevantThemes: DailyPersonalFitContext['activities'][number]['relevantThemes'];
  window: RankedTimingWindow;
}
