/**
 * Transit Activation Engine V1 -- sign-relationship classification and
 * strength, reusing packages/bhrigu's own logic verbatim.
 *
 * REUSE DECISION (Phase 0 audit, see README.md's "Relationship model"
 * section for the full trace): packages/bhrigu/src/relationships.ts
 * already implements exactly the generic, stateless, sign-only
 * relationship classification this package needs --
 * `classifyRelationship(signA, signB)`, `getRelationshipStrength(
 * relationship, weights)`, `signDistance(from, to)` -- and
 * packages/bhrigu/src/constants.ts's own `DEFAULT_RELATIONSHIP_WEIGHTS`
 * is already the exact weight table this PR's own brief specifies
 * (SAME_SIGN 1.00, TRINE 0.75, OPPOSITION 0.50, THREE_ELEVEN 0.25,
 * TWO_TWELVE 0.15, NONE 0.00). All of these are PUBLICLY exported from
 * packages/bhrigu/src/index.ts, take no graph/chain state, and produce
 * no side effects -- so this package imports and reuses them directly
 * rather than duplicating or "mirroring" a second, potentially-drifting
 * copy. packages/bhrigu is imported from, never modified (protected
 * scope).
 *
 * This package does NOT reuse `relationshipSourceRuleId` -- that
 * function returns Bhrigu's OWN rule IDs (`BHRIGU_REL_TRINE_V1`, etc.),
 * which would misattribute a fact produced by THIS engine (Transit
 * Activation) as if it were a Bhrigu-natal-chain-graph fact. This
 * package mints its own parallel rule IDs (provenance.ts) that name the
 * same underlying classification for THIS engine's own evidence.
 */
import { classifyRelationship, getRelationshipStrength } from '../../bhrigu/src/relationships';
import { DEFAULT_RELATIONSHIP_WEIGHTS } from '../../bhrigu/src/constants';
import {
  TRANSIT_ACTIVATION_SAME_SIGN_V1,
  TRANSIT_ACTIVATION_TRINE_V1,
  TRANSIT_ACTIVATION_OPPOSITION_V1,
  TRANSIT_ACTIVATION_THREE_ELEVEN_V1,
  TRANSIT_ACTIVATION_TWO_TWELVE_V1,
  TRANSIT_ACTIVATION_NONE_V1,
} from './provenance';
import type { ZodiacSign, TransitRelationship } from './types';

const RULE_IDS: Record<TransitRelationship, string> = {
  SAME_SIGN: TRANSIT_ACTIVATION_SAME_SIGN_V1,
  TRINE: TRANSIT_ACTIVATION_TRINE_V1,
  OPPOSITION: TRANSIT_ACTIVATION_OPPOSITION_V1,
  THREE_ELEVEN: TRANSIT_ACTIVATION_THREE_ELEVEN_V1,
  TWO_TWELVE: TRANSIT_ACTIVATION_TWO_TWELVE_V1,
  NONE: TRANSIT_ACTIVATION_NONE_V1,
};

/**
 * Classifies the relationship between a natal sign and a transiting
 * sign -- a direct pass-through to Bhrigu's own `classifyRelationship`
 * (symmetric by construction: argument order does not change the
 * result -- see packages/bhrigu/src/relationships.ts's own doc
 * comment). Directionality of the ACTIVATION itself (which planet is
 * transiting, which is natal) is preserved one level up, in
 * activation.ts, never here.
 */
export function classifyTransitRelationship(natalSign: ZodiacSign, transitSign: ZodiacSign): TransitRelationship {
  return classifyRelationship(natalSign, transitSign);
}

/** The configured V1 strength for a relationship category -- packages/bhrigu's own DEFAULT_RELATIONSHIP_WEIGHTS, applied via Bhrigu's own getRelationshipStrength. */
export function transitRelationshipStrength(relationship: TransitRelationship): number {
  return getRelationshipStrength(relationship, DEFAULT_RELATIONSHIP_WEIGHTS);
}

/** This engine's own stable rule ID for a given relationship category -- see this file's own module doc comment for why these are minted separately from Bhrigu's own BHRIGU_REL_*_V1 IDs. */
export function transitRelationshipRuleId(relationship: TransitRelationship): string {
  return RULE_IDS[relationship];
}
