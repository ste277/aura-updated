/**
 * Personal Intelligence Contract V1 -- provenance/versioning.
 *
 * Two distinct version concepts, deliberately kept separate:
 * - CONTRACT_VERSION: the shape/vocabulary version of THIS package. It
 *   changes only when the contract's own types change in a way that
 *   matters to a consumer (a field added/removed/retyped).
 * - A source engine's own engineVersion (e.g. Bhrigu's own
 *   'BHRIGU_NATAL_V1', packages/bhrigu/src/constants.ts) -- carried
 *   verbatim wherever a contract references that engine's output
 *   (PersonalNatalContext.engineVersion, etc.), never conflated with
 *   CONTRACT_VERSION itself.
 */
export const CONTRACT_VERSION = 'PERSONAL_INTELLIGENCE_CONTRACT_V1';
