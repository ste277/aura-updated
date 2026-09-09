/**
 * Ashtakavarga Engine V1 -- public engine.
 *
 * The core calculation (`calculateAshtakavarga`) works entirely from
 * already-normalized sidereal zodiac signs -- it never calculates
 * planetary longitude, Lagna, or any astronomy itself. The adapter
 * (`calculateAshtakavargaFromNatalChart`) bridges from this repository's
 * two existing canonical sources:
 *
 *   packages/vedic's own getNatalChart(birthMomentUTC): GrahaPosition[]
 *   packages/lagna's own calculateNatalAscendant(...): NatalAscendant
 *
 * to the pure AshtakavargaNatalInput shape, using each source's own
 * already-Lahiri-sidereal `rashiIndex` directly -- NO ayanamsa is
 * applied again here (see README.md's "Lahiri consistency" section).
 * This package is NOT responsible for calculating the natal chart or
 * Lagna itself -- it never calls getNatalChart()/calculateNatalAscendant()
 * internally, only accepts already-computed results here.
 */
import { ASHTAKAVARGA_TARGETS } from './constants';
import { calculateBhinnaAshtakavarga } from './bhinna';
import { calculateSarvashtakavarga } from './sarva';
import { dedupeEvidenceRefs } from './evidence';
import { assertValidNatalInput } from './validation';
import { ASHTAKAVARGA_ENGINE_VERSION, ASHTAKAVARGA_RULESET_VERSION } from './provenance';
import { AshtakavargaValidationError } from './types';
import type { AshtakavargaContributorSigns } from './prastara';
import type { AshtakavargaNatalInput, AshtakavargaResult, AshtakavargaTargetPlanet, BhinnaAshtakavarga, AshtakavargaEvidenceRef } from './types';
import type { GrahaPosition } from '../../vedic/src/natalChart';
import type { NatalAscendant } from '../../lagna/src/types';

/**
 * The core public entry point. Given already-normalized sidereal signs
 * for the 7 classical planets plus Lagna, deterministically calculates
 * all 7 Bhinna Ashtakavarga tables and the raw Sarvashtakavarga.
 *
 * Rejects: a missing/invalid/non-integer/out-of-range sign for any
 * required planet or Lagna (see validation.ts). Contains no ambient
 * time/randomness of any kind -- this engine has no time dimension at
 * all (unlike packages/vimshottari or packages/lagna), since it works
 * entirely from already-reduced zodiac signs.
 */
export function calculateAshtakavarga(input: AshtakavargaNatalInput): AshtakavargaResult {
  assertValidNatalInput(input);

  const contributorSigns: AshtakavargaContributorSigns = { ...input.planetarySigns, Lagna: input.lagnaSign };

  const bhinna = {} as Record<AshtakavargaTargetPlanet, BhinnaAshtakavarga>;
  for (const target of ASHTAKAVARGA_TARGETS) {
    bhinna[target] = calculateBhinnaAshtakavarga(target, contributorSigns);
  }

  const sarva = calculateSarvashtakavarga(bhinna);

  const evidence: AshtakavargaEvidenceRef[] = dedupeEvidenceRefs([...ASHTAKAVARGA_TARGETS.flatMap((target) => bhinna[target].evidence), ...sarva.evidence]);

  return {
    engineVersion: ASHTAKAVARGA_ENGINE_VERSION,
    ruleSetVersion: ASHTAKAVARGA_RULESET_VERSION,
    input,
    bhinna: bhinna as AshtakavargaResult['bhinna'],
    sarva,
    evidence,
  };
}

const REQUIRED_GRAHA_TARGETS: readonly AshtakavargaTargetPlanet[] = ASHTAKAVARGA_TARGETS;

/**
 * Extracts the 7 required target planets' own sidereal `rashiIndex`
 * from a real natal chart -- Rahu/Ketu, if present (a normal 9-graha
 * chart always has them), are simply ignored here: they may exist in
 * `positions`, but they are never read into the returned signs, exactly
 * matching this engine's own locked standard contributor set (see
 * README.md's "Rahu/Ketu" section). Rejects a chart missing any
 * required planet, or containing a duplicate of one.
 */
function extractPlanetarySigns(positions: GrahaPosition[]): AshtakavargaNatalInput['planetarySigns'] {
  const signs = {} as AshtakavargaNatalInput['planetarySigns'];

  for (const graha of REQUIRED_GRAHA_TARGETS) {
    const matches = positions.filter((p) => p.graha === graha);
    if (matches.length !== 1) {
      throw new AshtakavargaValidationError(`Expected exactly one ${graha} position in the supplied natal chart, got ${matches.length}.`);
    }
    signs[graha] = matches[0].rashiIndex;
  }

  return signs;
}

/**
 * Convenience adapter for a caller that already has a real natal chart
 * (packages/vedic's own GrahaPosition[]) and a real Lagna result
 * (packages/lagna's own NatalAscendant) -- extracts the 7 required
 * planets' own `rashiIndex` and Lagna's own `rashiIndex`, and delegates
 * to calculateAshtakavarga above. Both sources already use this
 * repository's own Lahiri sidereal convention; this function applies no
 * ayanamsa of its own.
 */
export function calculateAshtakavargaFromNatalChart(positions: GrahaPosition[], lagna: NatalAscendant): AshtakavargaResult {
  const planetarySigns = extractPlanetarySigns(positions);
  return calculateAshtakavarga({ planetarySigns, lagnaSign: lagna.rashiIndex });
}
