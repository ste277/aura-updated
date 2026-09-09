/**
 * Life Weather Engine V1 -- structural constants.
 */

/** Fixed canonical order for LifeWeatherTheme.reinforcementSources when both are present -- 'DASHA' before 'TRANSIT'. See engine.ts's own doc comment for why this is the only ordering this engine ever produces. */
export const REINFORCEMENT_SOURCE_ORDER = ['DASHA', 'TRANSIT'] as const;
