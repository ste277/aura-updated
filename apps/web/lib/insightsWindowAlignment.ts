/**
 * Insights Window-Alignment Semantic Correction V1 -- the single, shared
 * classification for Insights' WINDOW-ONLY behavioral analytics (the
 * lifetime/month/7-day/reflection-grouping/distribution calculations in
 * apps/web/components/InsightsView.tsx and apps/web/app/api/daily-assistant/
 * insights/route.ts). Every one of those calculations previously
 * duplicated its own local `windowName.includes('RAHU')`-style string
 * match -- this module replaces all of them with one definition, so there
 * is exactly one place that decides what a Panchang window "means" for
 * Insights' analytics purposes.
 *
 * This is deliberately NOT canonical Aura Fit, NOT ceremonial eligibility,
 * NOT activity-specific timing, and NOT personalization. The prior audit
 * (AUDIT: INSIGHTS CANONICAL AURA FIT + ALIGNMENT CONSOLIDATION V1)
 * confirmed that GULIKA's true value is activity-dependent -- sometimes
 * genuinely recommended, sometimes merely acceptable, per the real
 * canonical activity catalog (packages/recommendation/src/personalizedTasks.ts)
 * -- and that current HabitLog history generally carries no trustworthy
 * canonical activity identity to determine which way it should lean for
 * any specific logged activity. Rather than guess, this module treats
 * GULIKA as NEUTRAL: the same conservative default it already gets
 * everywhere else in the app for ordinary (non-ceremonial-commencement)
 * activities per packages/panchang/src/windows.ts's own
 * isInauspiciousCommencementWindow() doc comment ("an everyday activity
 * during Gulika stays rankable/usable, never hard-blocked"). GULIKA is
 * NOT reclassified as friction -- that would just trade one incorrect
 * blanket rule for another.
 *
 * This taxonomy is an ANALYTICS FALLBACK for logs that carry only a
 * window classification and no canonical activity identity. A future PR
 * (canonical activity-aware Aura Fit integration) may add a separate,
 * additional metric for the subset of logs that DO carry a trustworthy
 * activity id -- this module is not meant to be extended into that; it
 * stays a plain, honest window-only proxy.
 */

export type InsightsWindowBand = 'SUPPORTIVE' | 'NEUTRAL' | 'FRICTION';

/**
 * Classifies a persisted `HabitLog.activeWindow` string (or any other
 * window-type string Insights encounters) into one of three bands.
 *
 * BRAHMA, ABHIJIT       -> SUPPORTIVE
 * GULIKA, NEUTRAL        -> NEUTRAL
 * RAHU_KALAM, YAMA       -> FRICTION
 * anything unrecognized  -> NEUTRAL (fails safely, never throws, never
 *                           silently counts as either SUPPORTIVE or
 *                           FRICTION for a value this module doesn't
 *                           recognize)
 *
 * Matches on an uppercased substring check (not a strict enum-equality
 * check) so both the underscore form ("RAHU_KALAM") and the
 * space-separated display form ("RAHU KALAM") this codebase already uses
 * in different places classify identically.
 */
export function classifyInsightsWindow(windowType: string | null | undefined): InsightsWindowBand {
  const normalized = String(windowType || '').toUpperCase();
  if (normalized.includes('BRAHMA') || normalized.includes('ABHIJIT')) return 'SUPPORTIVE';
  if (normalized.includes('RAHU') || normalized.includes('YAMA')) return 'FRICTION';
  return 'NEUTRAL';
}

/**
 * A transparent, ordinal DISPLAY/AGGREGATION weight for each band --
 * explicitly an Insights presentation convenience, never a canonical
 * astrology score and never presented to the user as "Aura Fit" or
 * "personal fit" anywhere. 0.7 for NEUTRAL is retained only because it
 * was the pre-existing neutral display weight already shown to users in
 * the 7-day trend and lifetime/month alignment percentages; SUPPORTIVE/
 * FRICTION are the natural 1.0/0.0 endpoints.
 */
export const INSIGHTS_WINDOW_BAND_WEIGHT: Record<InsightsWindowBand, number> = {
  SUPPORTIVE: 1.0,
  NEUTRAL: 0.7,
  FRICTION: 0.0,
};

/** classifyInsightsWindow() + INSIGHTS_WINDOW_BAND_WEIGHT lookup, in one call. */
export function insightsWindowWeight(windowType: string | null | undefined): number {
  return INSIGHTS_WINDOW_BAND_WEIGHT[classifyInsightsWindow(windowType)];
}
