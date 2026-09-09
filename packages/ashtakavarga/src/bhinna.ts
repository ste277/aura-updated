/**
 * Ashtakavarga Engine V1 -- Bhinnashtakavarga (one target planet's full
 * 12-sign table).
 */
import { ZODIAC_SIGN_COUNT } from './constants';
import { calculateSignResult } from './prastara';
import { dedupeEvidenceRefs, buildBavSignSumEvidence, buildBavTotalEvidence } from './evidence';
import type { AshtakavargaContributorSigns } from './prastara';
import type { AshtakavargaTargetPlanet, BhinnaAshtakavarga, AshtakavargaEvidenceRef } from './types';

/**
 * One target planet's complete Bhinna Ashtakavarga: 12 signs, always in
 * canonical 0->11 order (never sorted by score, never Map/Set iteration
 * order). `total` is the sum across all 12 signs -- for a valid chart,
 * always the fixed classical value for `target` (constants.ts's own
 * ASHTAKAVARGA_FIXED_TOTALS), since the natal chart only changes WHERE
 * each contributor's allowed houses land in the zodiac, never HOW MANY
 * allowed houses exist in the rule table (see README.md's "Why fixed
 * totals must hold" section).
 */
export function calculateBhinnaAshtakavarga(target: AshtakavargaTargetPlanet, contributorSigns: AshtakavargaContributorSigns): BhinnaAshtakavarga {
  const signs = [];
  const evidence: AshtakavargaEvidenceRef[] = [];

  for (let sign = 0; sign < ZODIAC_SIGN_COUNT; sign++) {
    const { signResult, evidence: signEvidence } = calculateSignResult(target, contributorSigns, sign);
    signs.push(signResult);
    evidence.push(...signEvidence, buildBavSignSumEvidence({ target, sign, total: signResult.total }));
  }

  const total = signs.reduce((sum, s) => sum + s.total, 0);
  evidence.push(buildBavTotalEvidence({ target, total }));

  return { planet: target, signs, total, evidence: dedupeEvidenceRefs(evidence) };
}
