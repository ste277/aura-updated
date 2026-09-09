/**
 * Life Weather Engine V1 -- structural state derivation.
 *
 * Deliberately NOT threshold-based: no natalStrength cutoff, no transit
 * strength cutoff, no count of individual transits, no MD/AD count. State
 * counts only DISTINCT CURRENT SYSTEMS (Dasha, Transit) reinforcing a
 * theme -- a theme with 5 weak transits and no Dasha contributor is
 * exactly as ACTIVE as a theme with 1 strong transit and no Dasha
 * contributor, by design (see README.md's "State is structural, not
 * numeric" section for why: any numeric threshold here would be an
 * invented policy this contract has no basis for, exactly the "giant
 * weighted astrology score" failure mode this whole roadmap has avoided
 * since Transit Activation V1).
 */
import type { LifeWeatherState } from '../../personal-intelligence/src/context';

/**
 * `hasDasha`: at least one of DASHA_MAHADASHA/DASHA_ANTARDASHA contributed
 * (even if both did -- see engine.ts's own "MD == AD" handling: two
 * contributors from the SAME system still count as ONE system here).
 * `hasTransit`: at least one TRANSIT contributor exists, regardless of how
 * many.
 */
export function deriveLifeWeatherState(hasDasha: boolean, hasTransit: boolean): LifeWeatherState {
  if (hasDasha && hasTransit) return 'STRONGLY_ACTIVE';
  if (hasDasha || hasTransit) return 'ACTIVE';
  return 'QUIET';
}
