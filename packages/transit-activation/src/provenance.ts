/**
 * Transit Activation Engine V1 -- provenance/versioning.
 *
 * Two distinct version concepts, kept explicit and never conflated:
 *
 * TRANSIT_ACTIVATION_ENGINE_VERSION = this package's own engine version
 * TRANSIT_RELATIONSHIP_RULESET_V1   = the sign-relationship convention used
 *                                     to classify transit/natal geometry
 *
 * The relationship RULESET itself is not re-derived here -- it is
 * packages/bhrigu's own existing classifyRelationship/getRelationshipStrength/
 * DEFAULT_RELATIONSHIP_WEIGHTS, imported verbatim (see relationships.ts's
 * own module doc comment for the full reuse rationale). This constant
 * exists so evidence can name which RULESET convention produced a given
 * classification, independent of which ENGINE (Bhrigu natal chains vs.
 * this transit engine) is consuming it.
 */
export const TRANSIT_ACTIVATION_ENGINE_VERSION = 'TRANSIT_ACTIVATION_V1' as const;

export const TRANSIT_RELATIONSHIP_RULESET_VERSION = 'TRANSIT_RELATIONSHIP_RULESET_V1' as const;

/** Shared rule-version string for every evidence entry this engine emits. */
export const TRANSIT_ACTIVATION_RULE_VERSION = '1.0.0';

export const TRANSIT_ACTIVATION_SAME_SIGN_V1 = 'TRANSIT_ACTIVATION_SAME_SIGN_V1';
export const TRANSIT_ACTIVATION_TRINE_V1 = 'TRANSIT_ACTIVATION_TRINE_V1';
export const TRANSIT_ACTIVATION_OPPOSITION_V1 = 'TRANSIT_ACTIVATION_OPPOSITION_V1';
export const TRANSIT_ACTIVATION_THREE_ELEVEN_V1 = 'TRANSIT_ACTIVATION_THREE_ELEVEN_V1';
export const TRANSIT_ACTIVATION_TWO_TWELVE_V1 = 'TRANSIT_ACTIVATION_TWO_TWELVE_V1';
export const TRANSIT_ACTIVATION_NONE_V1 = 'TRANSIT_ACTIVATION_NONE_V1';
export const TRANSIT_ACTIVATION_SUMMARY_V1 = 'TRANSIT_ACTIVATION_SUMMARY_V1';
