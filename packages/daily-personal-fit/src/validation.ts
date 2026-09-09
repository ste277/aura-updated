/**
 * Daily Personal Fit Engine V1 -- input validation.
 *
 * Validates just enough of the supplied LifeWeatherContext to protect
 * deterministic behavior -- never a full re-validation of Life Weather's
 * own internal invariants (that engine's own responsibility). Does NOT
 * require `natalStrength > 0`, `contributors`, Dasha, or Transit data to
 * be present/non-empty -- a Life Weather snapshot where every theme is
 * QUIET (no current Dasha/Transit reinforcement at all) is a perfectly
 * valid input, and must produce an all-BASELINE result, never a
 * rejection.
 */
import { PERSONAL_THEMES } from '../../personal-intelligence/src/themes';
import { isNormalizedScore, isPersonalTheme } from '../../personal-intelligence/src/validation';
import { DailyPersonalFitValidationError } from './types';
import type { DailyPersonalFitInput } from './types';

const VALID_LIFE_WEATHER_STATES = new Set(['QUIET', 'ACTIVE', 'STRONGLY_ACTIVE']);
const VALID_DIRECTIONS = new Set(['SUPPORTIVE', 'NEUTRAL', 'CHALLENGING']);

/**
 * Strict ISO-8601 instant validation -- reuses the exact STYLE already
 * established in packages/transit-activation/src/validation.ts and
 * packages/life-weather/src/validation.ts (a strict zone-designator
 * pattern plus manual leap-year-aware calendar-component validation,
 * since JavaScript's native `Date` constructor silently rolls over
 * impossible calendar values instead of rejecting them). Kept as this
 * package's own local copy, matching this repo's own established
 * per-package convention.
 */
const STRICT_ISO_INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  const DAYS = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return DAYS[month - 1];
}

function assertValidEvaluationTime(evaluationTime: unknown): void {
  if (typeof evaluationTime !== 'string' || evaluationTime.length === 0) {
    throw new DailyPersonalFitValidationError(`lifeWeather.evaluationTime must be a non-empty ISO-8601 string, got: ${String(evaluationTime)}.`);
  }

  const match = STRICT_ISO_INSTANT_PATTERN.exec(evaluationTime);
  if (!match) {
    throw new DailyPersonalFitValidationError(`lifeWeather.evaluationTime must be a strict ISO-8601 instant with an explicit zone designator (Z or +/-HH:MM), got: ${evaluationTime}.`);
  }

  const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const second = Number(secondStr);

  const calendarValid = month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month) && hour <= 23 && minute <= 59 && second <= 59;
  if (!calendarValid) {
    throw new DailyPersonalFitValidationError(`lifeWeather.evaluationTime is syntactically ISO-shaped but not a real calendar instant, got: ${evaluationTime}.`);
  }
  if (!Number.isFinite(new Date(evaluationTime).getTime())) {
    throw new DailyPersonalFitValidationError(`lifeWeather.evaluationTime must be a valid, parseable instant, got: ${evaluationTime}.`);
  }
}

export function assertValidDailyPersonalFitInput(input: DailyPersonalFitInput): void {
  if (input == null || typeof input !== 'object' || input.lifeWeather == null || typeof input.lifeWeather !== 'object') {
    throw new DailyPersonalFitValidationError('DailyPersonalFitInput must be an object with a lifeWeather property.');
  }

  const { lifeWeather } = input;

  if (typeof lifeWeather.engineVersion !== 'string' || lifeWeather.engineVersion.length === 0) {
    throw new DailyPersonalFitValidationError(`lifeWeather.engineVersion must be a non-empty string, got: ${String(lifeWeather.engineVersion)}.`);
  }

  assertValidEvaluationTime(lifeWeather.evaluationTime);

  if (!Array.isArray(lifeWeather.themes)) {
    throw new DailyPersonalFitValidationError('lifeWeather.themes must be an array.');
  }
  if (lifeWeather.themes.length !== PERSONAL_THEMES.length) {
    throw new DailyPersonalFitValidationError(`lifeWeather.themes must contain exactly ${PERSONAL_THEMES.length} entries (one per canonical PersonalTheme), got ${lifeWeather.themes.length}.`);
  }

  const seen = new Set<string>();
  for (const theme of lifeWeather.themes) {
    if (!isPersonalTheme(theme.theme)) {
      throw new DailyPersonalFitValidationError(`lifeWeather.themes contains an unrecognized theme: ${String(theme.theme)}.`);
    }
    if (seen.has(theme.theme)) {
      throw new DailyPersonalFitValidationError(`lifeWeather.themes contains a duplicate theme: ${theme.theme}.`);
    }
    seen.add(theme.theme);
    if (!VALID_LIFE_WEATHER_STATES.has(theme.state)) {
      throw new DailyPersonalFitValidationError(`lifeWeather.themes[${theme.theme}].state must be one of QUIET/ACTIVE/STRONGLY_ACTIVE, got: ${String(theme.state)}.`);
    }
    // natalStrength/natalDirection are validated for SHAPE only (this
    // engine never reads their VALUES to derive relevance -- see
    // relevance.ts's own doc comment) -- still worth rejecting a
    // structurally malformed upstream context rather than silently
    // proceeding.
    if (!isNormalizedScore(theme.natalStrength)) {
      throw new DailyPersonalFitValidationError(`lifeWeather.themes[${theme.theme}].natalStrength must be a finite number in [0, 1], got: ${theme.natalStrength}.`);
    }
    if (!VALID_DIRECTIONS.has(theme.natalDirection)) {
      throw new DailyPersonalFitValidationError(`lifeWeather.themes[${theme.theme}].natalDirection must be one of SUPPORTIVE/NEUTRAL/CHALLENGING, got: ${String(theme.natalDirection)}.`);
    }
  }
  if (seen.size !== PERSONAL_THEMES.length) {
    throw new DailyPersonalFitValidationError(`lifeWeather.themes must cover all ${PERSONAL_THEMES.length} canonical themes, got ${seen.size} distinct themes.`);
  }
}
