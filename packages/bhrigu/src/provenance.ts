/**
 * Bhrigu Natal Foundation V1 -- provenance/versioning constants.
 *
 * Rule ids follow a stable BHRIGU_<CATEGORY>_<NAME>_V1 pattern so a future
 * rule revision can be introduced as BHRIGU_<CATEGORY>_<NAME>_V2 alongside
 * V1, rather than silently changing what V1 itself already produced for
 * existing callers. relationshipSourceRuleId (relationships.ts) and each
 * PLANET_KARAKAS entry's own sourceRuleId (karakas.ts) are this package's
 * other two rule-id sources; this file holds the ones that don't belong to
 * either of those (chain rules, and the top-level engine version).
 */
export { ENGINE_VERSION } from './constants';

export const CHAIN_CONNECTED_COMPONENT_RULE_ID = 'BHRIGU_CHAIN_CONNECTED_COMPONENT_V1';
