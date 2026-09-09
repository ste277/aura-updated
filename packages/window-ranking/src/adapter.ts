/**
 * Window Ranking Engine V1 -- optional orchestration adapter.
 *
 * The pure core (engine.ts) never calls `runTimingSearch`. This adapter
 * is the one place in this package that does -- a thin convenience
 * wrapper, not a second scoring path. It calls `runTimingSearch` in
 * `mode: 'FIND'` ONLY (never CHECK/COMPARE, which have different
 * semantic purposes -- see README.md's "Adapter mode" section for why
 * this is an intentional V1 limitation, not an oversight), takes its own
 * `response.candidates` EXACTLY as returned (no intermediate sort, no
 * score change, no additional filtering beyond what `runTimingSearch`
 * itself already performed), and passes them straight into
 * `deriveWindowRanking`.
 *
 * NO REVERSE FAMILY -> ACTIVITY MAPPING (merge-critical): because no
 * canonical `MuhurtaActivityFamily -> ActivityProfile` mapping exists
 * anywhere in the repo (confirmed by the PR #103 architecture audit --
 * many catalog activities can share one family, each with different
 * timing preferences, so no single "the" activity per family exists),
 * this adapter does NOT attempt to invent one. The caller must supply
 * BOTH `activityFamily` (for the resulting WindowRankingContext's own
 * identity) AND whatever `runTimingSearch` itself already requires to
 * resolve a concrete activity (`activityId` or `taskTitle`) -- exactly
 * the same two inputs a caller of `runTimingSearch` would already need
 * to supply today. This package never maps one to the other.
 */
import { runTimingSearch } from '../../recommendation/src/timingSearch';
import { deriveWindowRanking } from './engine';
import type { DailyAssistantContext, PlanningHorizon } from '../../recommendation/src/dailyAssistant';
import type { TimingSearchDateRange, TimingTimePreference } from '../../recommendation/src/timingSearch';
import type { MuhurtaActivityFamily } from '../../muhurta/src/muhurtaEngine';
import type { WindowRankingContext } from './types';

/**
 * Mirrors `TimingSearchRequest`'s own FIND-relevant fields exactly (see
 * that type's own doc comments in timingSearch.ts) plus the one
 * additional, explicitly-required `activityFamily` this package's own
 * output needs -- never derived, always caller-supplied.
 */
export interface WindowRankingFromTimingSearchInput {
  activityFamily: MuhurtaActivityFamily;

  /** Known catalog activity. Takes precedence over taskTitle when both are given -- matches TimingSearchRequest's own precedence rule exactly. */
  activityId?: string;
  /** Free text, resolved via the exact same catalog-alias-then-regex-fallback flow `runTimingSearch` itself already uses. */
  taskTitle?: string;

  durationMinutes: number;

  dateRange?: TimingSearchDateRange;
  horizon?: PlanningHorizon;
  customStartDate?: string;
  customEndDate?: string;

  timePreference?: TimingTimePreference;

  context: DailyAssistantContext;

  /** Default 3, matching `runTimingSearch`'s own FIND default. */
  limit?: number;
}

/**
 * Convenience adapter: `runTimingSearch({mode: 'FIND', ...}) -> response.candidates -> deriveWindowRanking(...)`.
 * The pure core (engine.ts) remains untouched by this function's own
 * existence -- a caller that already has a `TimingCandidate[]` from
 * elsewhere should call `deriveWindowRanking` directly instead.
 */
export function rankActivityWindowsFromTimingSearch(input: WindowRankingFromTimingSearchInput): WindowRankingContext {
  const response = runTimingSearch({
    mode: 'FIND',
    activityId: input.activityId,
    taskTitle: input.taskTitle,
    durationMinutes: input.durationMinutes,
    dateRange: input.dateRange,
    horizon: input.horizon,
    customStartDate: input.customStartDate,
    customEndDate: input.customEndDate,
    timePreference: input.timePreference,
    context: input.context,
    limit: input.limit,
  });

  return deriveWindowRanking({ activityFamily: input.activityFamily, candidates: response.candidates });
}
