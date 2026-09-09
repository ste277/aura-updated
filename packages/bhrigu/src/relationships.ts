/**
 * Bhrigu Natal Foundation V1 -- deterministic planet-to-planet relationship
 * detection, based purely on relative sign (rashi) position. See
 * README.md's "Relationship definitions" section for the traditional
 * naming this mirrors.
 */
import type { BhriguRelationshipType, BhriguRelationshipWeights, ZodiacSign } from './types';

/**
 * Directional sign distance A -> B: how many signs forward from A's own
 * sign you must count (0-indexed, wrapping through Pisces/Aries) to reach
 * B's sign. 0 means the same sign. This is the exact same mod-12 pattern
 * packages/vedic/src/transits.ts already uses for "house from Moon"
 * (`((tGraha.rashiIndex - natalMoon.rashiIndex + 12) % 12)`, before that
 * file's own +1 to present it as a 1-indexed house number) -- reused here
 * unmodified, just without the +1, since this package classifies by raw
 * distance rather than presenting a house number.
 *
 * Not symmetric on its own: signDistance(A, B) !== signDistance(B, A) in
 * general (e.g. distance 4 one way is distance 8 the other). Symmetry is
 * restored one level up, in classifyRelationship below, by construction:
 * every relationship bucket (other than SAME_SIGN/OPPOSITION, which are
 * already self-paired) groups exactly the two distances that are each
 * other's complement (d and 12 - d), so classifyRelationship(A, B) always
 * equals classifyRelationship(B, A) even though the two raw distances
 * differ.
 */
export function signDistance(from: ZodiacSign, to: ZodiacSign): number {
  return ((to - from) % 12 + 12) % 12;
}

/**
 * Classifies the relationship between two signs from their directional
 * distance A -> B (see signDistance's own doc comment for exactly how
 * that distance is computed and why grouping by complementary pairs makes
 * this symmetric):
 *
 * distance  0            -> SAME_SIGN     (conjunction: A and B share a sign)
 * distance  1 or 11       -> TWO_TWELVE    (2nd/12th from each other)
 * distance  2 or 10       -> THREE_ELEVEN  (3rd/11th from each other)
 * distance  3, 5, 7, or 9 -> NONE          (no V1-recognized relationship)
 * distance  4 or 8        -> TRINE         (5th/9th from each other)
 * distance  6             -> OPPOSITION    (7th from each other, self-paired)
 */
export function classifyRelationship(signA: ZodiacSign, signB: ZodiacSign): BhriguRelationshipType {
  const distance = signDistance(signA, signB);
  switch (distance) {
    case 0:
      return 'SAME_SIGN';
    case 1:
    case 11:
      return 'TWO_TWELVE';
    case 2:
    case 10:
      return 'THREE_ELEVEN';
    case 4:
    case 8:
      return 'TRINE';
    case 6:
      return 'OPPOSITION';
    default:
      return 'NONE';
  }
}

/** Looks up the configured strength for a relationship type -- pure lookup, no computation. */
export function getRelationshipStrength(
  relationship: BhriguRelationshipType,
  weights: BhriguRelationshipWeights
): number {
  switch (relationship) {
    case 'SAME_SIGN':
      return weights.sameSign;
    case 'TRINE':
      return weights.trine;
    case 'OPPOSITION':
      return weights.opposition;
    case 'THREE_ELEVEN':
      return weights.threeEleven;
    case 'TWO_TWELVE':
      return weights.twoTwelve;
    case 'NONE':
      return weights.none;
  }
}

/** Stable rule id per relationship type -- see provenance.ts. */
export function relationshipSourceRuleId(relationship: BhriguRelationshipType): string {
  const RULE_IDS: Record<BhriguRelationshipType, string> = {
    SAME_SIGN: 'BHRIGU_REL_SAME_SIGN_V1',
    TRINE: 'BHRIGU_REL_TRINE_V1',
    OPPOSITION: 'BHRIGU_REL_OPPOSITION_V1',
    THREE_ELEVEN: 'BHRIGU_REL_THREE_ELEVEN_V1',
    TWO_TWELVE: 'BHRIGU_REL_TWO_TWELVE_V1',
    NONE: 'BHRIGU_REL_NONE_V1',
  };
  return RULE_IDS[relationship];
}
