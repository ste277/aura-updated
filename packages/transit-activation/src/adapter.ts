/**
 * Transit Activation Engine V1 -- real-position adapter.
 *
 * This file bridges from real Aura natal/transit GrahaPosition[] results
 * to the pure engine. This package is NOT responsible for calculating
 * any natal chart or transit position itself -- it never calls
 * getNatalChart() internally, only accepts already-computed
 * GrahaPosition[] results here.
 *
 * CANONICAL TRANSIT-POSITION SOURCE (Phase 0 audit, see README.md's
 * "Canonical sources" section for the full trace): packages/vedic/src/
 * natalChart.ts's own `getNatalChart(instant): GrahaPosition[]` is
 * ALREADY the canonical way to obtain sidereal planetary positions for
 * an ARBITRARY instant, not only a birth moment -- confirmed directly
 * from existing production code: packages/vedic/src/transits.ts's own
 * `calculateDailyTransits` already calls `getNatalChart(currentDate)` to
 * obtain "transit" positions for exactly this reason. This package
 * reuses `getNatalChart` itself for both the natal instant and the
 * evaluation instant; it does NOT import or extend transits.ts's own
 * `calculateDailyTransits` (a different, interpretive, house-from-Moon
 * heuristic with hardcoded favorable/cautionary prose -- see
 * constants.ts's own module doc comment for why that file is
 * deliberately not reused).
 *
 * NO PERSONAL INTELLIGENCE ADAPTER IN V1 -- deliberately deferred, see
 * README.md's own "Personal Intelligence adapter" section for the full
 * audit trace. Summary: packages/personal-intelligence's existing
 * `TransitActivation` contract (`{ transitingPlanet: string;
 * activatedThemes: PersonalThemeSignal[]; natalTargets:
 * PersonalEvidenceRef[]; strength: number; evidence:
 * PersonalEvidenceRef[] }`) has NO typed field for the activated natal
 * planet's own identity, and NO typed field for the relationship
 * category -- both would have to be smuggled into an untyped
 * `PersonalEvidenceRef.data` bag, which is evidence metadata, not a
 * typed domain field a downstream engine (Life Weather, PR #101) could
 * safely rely on without parsing arbitrary evidence content as if it
 * were structured domain state. The contract's own single `strength:
 * number` scalar per transiting planet also cannot represent multiple
 * simultaneously-activated natal targets without SOME aggregation
 * policy (e.g. max), and no such policy is specified anywhere in the
 * existing contract -- inventing one here would silently bake a
 * Transit-Activation-specific product decision into what is supposed to
 * be a pure geometry-detection engine, exactly the kind of premature
 * synthesis this PR's own brief prohibits. `packages/personal-intelligence`
 * is not modified in this PR (protected scope); this package therefore
 * exposes only the pure engine and this real-position adapter until the
 * contract is intentionally evolved (a future, explicit decision, not
 * smuggled in here).
 */
import { TRANSIT_ACTIVATION_PLANETS } from './constants';
import { calculateTransitActivation } from './engine';
import { TransitActivationValidationError } from './types';
import type { TransitActivationInput, TransitActivationPlanet, TransitActivationResult, ZodiacSign } from './types';
import type { GrahaPosition } from '../../vedic/src/natalChart';

/** Extracts each of the 9 canonical planets' own sidereal `rashiIndex` from a real GrahaPosition[] -- rejects a chart missing any required planet, or containing a duplicate of one (never silently takes first/last). */
function extractSigns(positions: GrahaPosition[], label: string): Record<TransitActivationPlanet, ZodiacSign> {
  const signs = {} as Record<TransitActivationPlanet, ZodiacSign>;

  for (const planet of TRANSIT_ACTIVATION_PLANETS) {
    const matches = positions.filter((p) => p.graha === planet);
    if (matches.length !== 1) {
      throw new TransitActivationValidationError(`Expected exactly one ${planet} position in the supplied ${label} chart, got ${matches.length}.`);
    }
    signs[planet] = matches[0].rashiIndex;
  }

  return signs;
}

/**
 * Convenience adapter for a caller that already has a real natal chart
 * and a real transit chart (both packages/vedic's own GrahaPosition[],
 * e.g. `getNatalChart(birthMomentUTC)` and `getNatalChart(evaluationInstant)`)
 * plus the explicit evaluation instant used to compute the transit
 * chart -- extracts both charts' own `rashiIndex` values and delegates
 * to calculateTransitActivation above. Both sources already use this
 * repository's own Lahiri sidereal convention; this function applies no
 * ayanamsa of its own and performs no astronomy.
 */
export function calculateTransitActivationFromPositions(natalPositions: GrahaPosition[], transitPositions: GrahaPosition[], evaluationTimeUTC: Date): TransitActivationResult {
  if (!(evaluationTimeUTC instanceof Date) || !Number.isFinite(evaluationTimeUTC.getTime())) {
    throw new TransitActivationValidationError(`evaluationTimeUTC must be a valid, finite Date, got: ${String(evaluationTimeUTC)}.`);
  }

  const natalSigns = extractSigns(natalPositions, 'natal');
  const transitSigns = extractSigns(transitPositions, 'transit');
  const input: TransitActivationInput = { natalSigns, transitSigns, evaluationTime: evaluationTimeUTC.toISOString() };
  return calculateTransitActivation(input);
}
