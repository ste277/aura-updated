/**
 * Insights Evidence & Sample-Size Integrity V1 -- the one shared, pure
 * boundary that decides "is there enough evidence to say something here?"
 * for every Insights metric that needs it. Reuses the exact 0 / 1-2 / 3+
 * boundary Canonical Aura Fit Insights V1 (apps/web/lib/insightsAuraFit.ts)
 * already shipped and this PR's own audit confirmed is correctly calibrated
 * -- never a new taxonomy, never a statistical model (no confidence
 * intervals, no p-values, no Bayesian inference). This module owns
 * threshold semantics only; it never touches a score formula, a Panchang/
 * Muhurta calculation, or C1's window weights.
 *
 * NO_DATA:    0 observations -- nothing happened, there is nothing to say.
 * LIMITED:    1-2 observations -- something happened, but not enough to
 *             back comparative/behavioral language ("you tend to...",
 *             "X points more aligned...").
 * AVAILABLE:  3+ observations -- enough to state a plain, descriptive
 *             percentage or comparison (still never a causal claim).
 */

export type InsightsEvidenceState = 'NO_DATA' | 'LIMITED' | 'AVAILABLE';

/**
 * `count` is deliberately a plain number, not a specific domain type --
 * callers pass whatever their own "one evidence unit" is (an eligible
 * HabitLog, a reflection, a timed session, a comparison's combined
 * observation count). A negative count is not a real domain value (the
 * audit found no source of one), but is normalized to NO_DATA rather than
 * thrown on, matching this module's own "keep it simple, no fabricated
 * confidence" spirit -- an impossible input should degrade to "nothing to
 * show," never crash a render.
 */
export function deriveInsightsEvidenceState(count: number): InsightsEvidenceState {
  if (count <= 0) return 'NO_DATA';
  if (count < 3) return 'LIMITED';
  return 'AVAILABLE';
}
