/**
 * Life Weather Engine V1 -- shared internal types.
 *
 * This engine composes packages/personal-intelligence's own already-computed
 * PersonalThemeContext, LifePeriodContext, and TransitActivationContext into
 * a LifeWeatherContext -- it never recomputes any of them (no Bhrigu graph
 * traversal, no Vimshottari period calculation, no transit geometry
 * evaluation). See README.md's "Architecture" section.
 */
import type { PersonalThemeContext, LifePeriodContext, TransitActivationContext } from '../../personal-intelligence/src/context';

/**
 * The minimal, already-normalized input this engine's core function needs.
 * No birth details, no astronomy, no database -- every upstream
 * calculation is already complete by the time this engine runs (see
 * engine.ts's own doc comment for the exact pure-composition guarantee).
 *
 * Caller invariant (not runtime-enforced, since this engine never
 * recomputes any of the three contexts to cross-check them): `lifePeriod`
 * and `transitActivations` must both have been computed AT `evaluationTime`
 * -- `natalThemes` is time-independent by construction (Personal Themes
 * V1 has no time dimension at all) and needs no such correspondence.
 */
export interface LifeWeatherInput {
  natalThemes: PersonalThemeContext;
  lifePeriod: LifePeriodContext;
  transitActivations: TransitActivationContext;
  /** ISO-8601 UTC instant string, caller-supplied, echoed into the result -- never computed via Date.now(). Records the instant of SYNTHESIS; never used to recompute any upstream context. */
  evaluationTime: string;
}

/** Thrown by engine.ts/validation.ts on malformed input -- see validation.ts's own doc comment for exactly which conditions reject. */
export class LifeWeatherValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LifeWeatherValidationError';
  }
}
