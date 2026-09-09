/**
 * Ashtakavarga Engine V1 -- provenance/versioning.
 *
 * Two distinct version concepts, kept explicit and never conflated (see
 * README.md's "Rule source" section):
 *
 * ASHTAKAVARGA_ENGINE_VERSION  = this package's own calculation-engine version
 * ASHTAKAVARGA_RULESET_VERSION = the specific classical contribution table this
 *                                 engine implements (a different textual
 *                                 tradition/recension would be a different
 *                                 ruleset version, not a different engine)
 */
export const ASHTAKAVARGA_ENGINE_VERSION = 'ASHTAKAVARGA_V1' as const;

/**
 * The classical rule table implemented (see README.md's "Rule source"
 * section for the full source/recension audit): the standard Parashara
 * Bhinnashtakavarga table, cross-validated during this PR's own Phase 0
 * against two independent references and confirmed exact-match at the
 * house-number level for 4 of 7 targets and exact-match at the row-count
 * level for all 7 targets (all totals: 48/49/39/54/56/52/39/337).
 */
export const ASHTAKAVARGA_RULESET_VERSION = 'ASHTAKAVARGA_PARASHARA_V1' as const;

/** Shared rule-version string for every evidence entry this engine emits. */
export const ASHTAKAVARGA_RULE_VERSION = '1.0.0';

export const ASHTAKAVARGA_BAV_SIGN_SUM_V1 = 'ASHTAKAVARGA_BAV_SIGN_SUM_V1';
export const ASHTAKAVARGA_BAV_TOTAL_V1 = 'ASHTAKAVARGA_BAV_TOTAL_V1';
export const ASHTAKAVARGA_SAV_SIGN_SUM_V1 = 'ASHTAKAVARGA_SAV_SIGN_SUM_V1';
export const ASHTAKAVARGA_SAV_TOTAL_V1 = 'ASHTAKAVARGA_SAV_TOTAL_V1';
