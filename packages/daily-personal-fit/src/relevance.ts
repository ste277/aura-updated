/**
 * Daily Personal Fit Engine V1 -- personal relevance derivation.
 *
 * Deliberately NOT threshold-based, NOT count-based, NOT a weighted/
 * summed score, and NEVER a function of `natalStrength`/`natalDirection`
 * (both are absent from the input this function even receives -- see
 * engine.ts's own doc comment). Relevance is the STRUCTURAL MAXIMUM
 * LifeWeatherState among an activity family's own mapped themes only --
 * three ACTIVE themes are exactly as RELEVANT as one ACTIVE theme; only
 * the presence of at least one STRONGLY_ACTIVE theme elevates the result
 * to HIGHLY_RELEVANT. This mirrors the exact "max, never sum/count"
 * discipline packages/life-weather already established for its own
 * analogous state derivation (see that package's own state.ts).
 */
import type { LifeWeatherState } from '../../personal-intelligence/src/context';
import type { PersonalRelevance } from '../../personal-intelligence/src/context';

export function deriveActivityRelevance(mappedThemeStates: readonly LifeWeatherState[]): PersonalRelevance {
  if (mappedThemeStates.includes('STRONGLY_ACTIVE')) return 'HIGHLY_RELEVANT';
  if (mappedThemeStates.includes('ACTIVE')) return 'RELEVANT';
  return 'BASELINE';
}
