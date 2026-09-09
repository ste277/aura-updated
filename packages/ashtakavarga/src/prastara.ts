/**
 * Ashtakavarga Engine V1 -- Prastara (contributor-level point
 * calculation).
 *
 * For one target planet and one candidate zodiac sign, evaluates all 8
 * contributors deterministically (canonical order, ASHTAKAVARGA_CONTRIBUTORS)
 * and builds the full, explainable AshtakavargaSignResult -- never just
 * the final 0-8 count. This is what makes the engine auditable: "why
 * does Saturn have 5 points in this sign?" is answerable from
 * `signResult.contributions`, not only from `signResult.total`.
 */
import { ASHTAKAVARGA_CONTRIBUTORS } from './constants';
import { relativeHouse } from './relativeHouse';
import { findRule } from './rules';
import { buildContributionEvidence } from './evidence';
import type { AshtakavargaTargetPlanet, AshtakavargaContributor, ZodiacSign, AshtakavargaSignResult, AshtakavargaContribution } from './types';
import type { AshtakavargaEvidenceRef } from './types';

/**
 * The natal sign of each of the 8 contributors -- the 7 target planets'
 * own signs plus Lagna's sign. Every target planet is ALSO a
 * contributor to every other target's (and its own) BAV -- see
 * README.md's "Contributors" section.
 */
export type AshtakavargaContributorSigns = Record<AshtakavargaContributor, ZodiacSign>;

function evaluateContribution(target: AshtakavargaTargetPlanet, contributor: AshtakavargaContributor, contributorSign: ZodiacSign, destinationSign: ZodiacSign): { contribution: AshtakavargaContribution; evidence: AshtakavargaEvidenceRef } {
  const house = relativeHouse(contributorSign, destinationSign);
  const contributionRule = findRule(target, contributor);
  const point = contributionRule.houses.includes(house) ? 1 : 0;

  return {
    contribution: { contributor, contributorSign, destinationSign, relativeHouse: house, point, ruleId: contributionRule.ruleId },
    evidence: buildContributionEvidence({ target, contributor, contributorSign, destinationSign, relativeHouse: house, point, ruleId: contributionRule.ruleId }),
  };
}

/**
 * The full contributor-level breakdown for one target planet in one
 * candidate zodiac sign -- always exactly 8 contributions, in canonical
 * ASHTAKAVARGA_CONTRIBUTORS order; `total = sum(point)`, always in
 * [0, 8].
 */
export function calculateSignResult(target: AshtakavargaTargetPlanet, contributorSigns: AshtakavargaContributorSigns, destinationSign: ZodiacSign): { signResult: AshtakavargaSignResult; evidence: AshtakavargaEvidenceRef[] } {
  const contributions: AshtakavargaContribution[] = [];
  const evidence: AshtakavargaEvidenceRef[] = [];

  for (const contributor of ASHTAKAVARGA_CONTRIBUTORS) {
    const { contribution, evidence: contributionEvidence } = evaluateContribution(target, contributor, contributorSigns[contributor], destinationSign);
    contributions.push(contribution);
    evidence.push(contributionEvidence);
  }

  const total = contributions.reduce((sum, c) => sum + c.point, 0);

  return { signResult: { sign: destinationSign, contributions, total }, evidence };
}
