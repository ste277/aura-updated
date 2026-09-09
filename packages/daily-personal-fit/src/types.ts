/**
 * Daily Personal Fit Engine V1 -- shared internal types.
 *
 * This engine projects an already-computed LifeWeatherContext onto Aura's
 * canonical Muhurta activity-family vocabulary -- it never recomputes
 * Life Weather, Personal Themes, Vimshottari, Transit Activation, natal
 * astronomy, Panchang, or Muhurta itself. See README.md's "Architecture"
 * section.
 */
import type { LifeWeatherContext } from '../../personal-intelligence/src/context';

/**
 * The minimal, already-computed input this engine's core function needs.
 * No date, no timezone, no location, no birth information, no separate
 * evaluation-instant argument -- `evaluationTime` is read verbatim from
 * `lifeWeather.evaluationTime` (see engine.ts's own doc comment: "Daily"
 * refers to the current Life Weather snapshot, not a Panchang-day
 * calculation).
 */
export interface DailyPersonalFitInput {
  lifeWeather: LifeWeatherContext;
}

/** Thrown by engine.ts/validation.ts on malformed input -- see validation.ts's own doc comment for exactly which conditions reject. */
export class DailyPersonalFitValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DailyPersonalFitValidationError';
  }
}
