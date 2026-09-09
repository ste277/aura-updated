/**
 * Window Ranking Engine V1 -- provenance/versioning.
 *
 * WINDOW_RANKING_ENGINE_VERSION represents the FORMALIZED RANKING CONTRACT
 * (rank assignment + order-preservation semantics) this package applies --
 * it does NOT represent a new astrological scoring methodology. The
 * underlying timing score itself remains owned entirely by
 * packages/recommendation (Aura Fit, `AURA_PERSONAL_FIT_V1`) and
 * packages/muhurta (`AURA_MUHURTA_V1`) -- this package introduces no new
 * Muhurta rule, no new Aura Fit weight, and no new label threshold. See
 * README.md's "No new astrology" section.
 */
export const WINDOW_RANKING_ENGINE_VERSION = 'WINDOW_RANKING_V1' as const;
