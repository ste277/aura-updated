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
 * Behavioral Integration V1 -- this package's own LOCAL copy of #110's
 * (apps/web/lib/behavioralAffinity.ts) `BehavioralAffinity` tier, never
 * imported from apps/web (packages must never depend on app-layer code --
 * see constants.ts's own CANONICAL_ACTIVITY_FAMILIES doc comment for the
 * identical "independently re-declared, not a new shared dependency"
 * precedent this mirrors). The app-level orchestrator maps #110's real
 * output onto this structurally-equivalent local type before calling
 * `deriveDailyGuidance`.
 */
export type BehavioralAffinityTier = 'STRONG' | 'MODERATE' | 'NEUTRAL';

/**
 * The core engine's own input. `windowRankings` need NOT cover all 13
 * canonical families -- a family with no supplied WindowRankingContext
 * simply cannot become a recommendation (no timing data to join against).
 * `limit` defaults to 3 (constants.ts's own DEFAULT_LIMIT) when omitted.
 *
 * `behavioralAffinityByFamily` (Behavioral Integration V1) is entirely
 * OPTIONAL -- omitted entirely (every pre-existing caller/test) or a
 * family missing from the map both resolve to `NEUTRAL` in
 * eligibility.ts's own `buildCandidates` (never thrown), reproducing V1's
 * pre-integration ranking output exactly. This is an ORDERING signal only
 * -- see ordering.ts's own doc comment for where it sits in the tuple; it
 * is never consulted by eligibility.ts (stage membership is unaffected).
 *
 * `preferredDaypartMatchByFamily` (Preferred Daypart Personalization V1)
 * is likewise entirely OPTIONAL, and deliberately a bare `boolean` --
 * never a daypart enum, never a timezone, never a raw preference value.
 * The app layer already resolved the family's own rank-1 window against
 * its own local-timezone midpoint and its own behavioral preference
 * before this input is ever built; this package only ever receives the
 * already-resolved yes/no fact ("does this family's own selected window
 * match"), keeping this package fully timezone-agnostic and behavioral-
 * engine-agnostic (never importing `InsightsDayPart`,
 * `BehavioralProfileContext`, or any apps/web/lib module -- see
 * dailyGuidanceBehavior.ts's own doc comment for the app-side computation
 * this mirrors). ONLY `true` should ever be present in a well-formed map
 * (see eligibility.ts's own doc comment) -- an absent entry, an omitted
 * map entirely, and an explicit `false` all collapse to the identical
 * "no boost" outcome in ordering.ts, by design: a genuine mismatch, no
 * behavioral history, and an excluded Plan candidate must never be
 * distinguishable from each other downstream (see ordering.ts's own
 * doc comment on why this is a positive-only signal).
 */
export interface DailyGuidanceInput {
  dailyPersonalFit: DailyPersonalFitContext;
  windowRankings: WindowRankingContext[];
  limit?: number;
  behavioralAffinityByFamily?: Partial<Record<MuhurtaActivityFamily, BehavioralAffinityTier>>;
  preferredDaypartMatchByFamily?: Partial<Record<MuhurtaActivityFamily, boolean>>;
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
  /** Behavioral Integration V1 -- always resolved to a concrete tier by
   * eligibility.ts's own `buildCandidates` (missing input/family both
   * default to `NEUTRAL`), never left undefined -- see ordering.ts for
   * where this is consulted. */
  behavioralAffinity: BehavioralAffinityTier;
  /** Preferred Daypart Personalization V1 -- always resolved to a concrete
   * boolean by eligibility.ts's own `buildCandidates` (missing input/
   * family/explicit `false` all default to `false`), never left
   * undefined -- see ordering.ts for where this is consulted. */
  preferredDaypartMatch: boolean;
}
