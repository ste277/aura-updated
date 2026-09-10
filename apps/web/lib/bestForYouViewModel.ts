/**
 * New Aura Home V1 -- "Best For You" view model.
 *
 * Pure presentation-layer glue only: this file performs no ranking, no
 * scoring, no filtering, and no timing/astrology computation of its own.
 * It only maps an already-final `DailyGuidanceContext.recommendations[]`
 * (produced entirely by the already-merged #104/#105 pipeline) into the
 * minimal shape `BestForYouSection.tsx` needs to render, joining each
 * recommendation's `activityFamily` to its already-resolved concrete
 * activity metadata (`selectedActivities[activityFamily]`).
 *
 * ORDER OWNERSHIP (merge-critical): `mapGuidanceToBestForYouItems` never
 * sorts, reorders, or filters `recommendations` -- it returns exactly one
 * `BestForYouItem` per input recommendation, in the exact same array
 * order, mapping `rank` straight through. #104 owns cross-family order;
 * #103 owns within-family timing order; this file owns neither.
 *
 * NO ENGINE CALLS: this file never imports/calls
 * runTimingSearch/evaluateActivityFit/deriveWindowRanking/
 * deriveDailyGuidance/deriveDailyPersonalFit/deriveLifeWeather -- it only
 * consumes the already-computed `DailyGuidanceContext` type (a type-only
 * import) and the app-level `SelectedActivityMetadata` type.
 */
import type { DailyGuidanceContext } from '../../../packages/personal-intelligence/src/context';
import type { PersonalDailyGuidanceResult, SelectedActivityMetadata } from './dailyGuidanceTypes';

/**
 * Home's own UI-local presentation state for the guidance fetch --
 * reuses `PersonalDailyGuidanceResult` verbatim for its three real
 * domain statuses (`READY`/`BIRTH_PROFILE_REQUIRED`/`NO_ACTIVITY_INTENT`)
 * rather than declaring lowercase duplicates of them; `'loading'`/`'error'`
 * are the only genuinely new, UI-only states added on top.
 */
export type GuidanceUiState = { status: 'loading' } | { status: 'error' } | PersonalDailyGuidanceResult;

/**
 * The minimal fields `BestForYouSection.tsx` renders. Deliberately
 * excludes `personalRelevance`/`selectionReason`/`relevantThemes`/
 * `engineVersion`/`selectionPolicyVersion`/`source`/`activityFamily` --
 * all internal provenance, never customer-facing in V1 (see
 * BestForYouSection.tsx's own doc comment on why `source` stays metadata
 * only, and #107's own future ownership of theme/reason explainability).
 * `sourceEntityId` is retained even though V1 renders no click affordance
 * for it -- see this file's own module doc comment section on why
 * navigation was deliberately deferred, not because the field is unused
 * here.
 */
export interface BestForYouItem {
  rank: number;
  title: string;
  start: string;
  end: string;
  source: SelectedActivityMetadata['source'];
  sourceEntityId: string;
}

/**
 * Mechanical, purely typographic fallback -- NEVER a semantic remap
 * (e.g. `RELATIONSHIP -> 'Important conversation'` invents meaning this
 * function must not invent). Used ONLY when `selectedActivities` is
 * missing an entry for a family #104 itself returned in
 * `recommendations` -- a structurally-unreachable case given #105's own
 * "recommendation-only metadata" guarantee, defended against here purely
 * so a genuine contract mismatch degrades to readable text instead of
 * crashing or leaking a raw enum.
 */
export function formatFamilyFallbackTitle(activityFamily: string): string {
  const words = activityFamily.toLowerCase().split('_');
  return words.map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(' ');
}

/**
 * Maps `guidance.recommendations` (already in final, #104-owned order)
 * into `BestForYouItem[]`, joining each entry to its concrete activity
 * via `selectedActivities[activityFamily]`. Never mutates either input
 * argument. When a join misses (should not happen for any real
 * `DailyGuidanceContext`/`selectedActivities` pair produced by
 * `buildPersonalDailyGuidance`), logs the mismatch as an unexpected
 * contract violation and falls back to `formatFamilyFallbackTitle`
 * rather than throwing or rendering a raw family string.
 */
export function mapGuidanceToBestForYouItems(guidance: DailyGuidanceContext, selectedActivities: Record<string, SelectedActivityMetadata>): BestForYouItem[] {
  return guidance.recommendations.map((recommendation) => {
    const metadata = selectedActivities[recommendation.activityFamily];
    if (!metadata) {
      console.error(
        `Best For You: no selectedActivities entry for activityFamily "${recommendation.activityFamily}" -- this should be unreachable (recommendation-only metadata contract), falling back to a formatted family label.`
      );
    }
    return {
      rank: recommendation.rank,
      title: metadata?.title ?? formatFamilyFallbackTitle(recommendation.activityFamily),
      start: recommendation.timing.start,
      end: recommendation.timing.end,
      source: metadata?.source ?? 'PLAN',
      sourceEntityId: metadata?.sourceEntityId ?? '',
    };
  });
}
