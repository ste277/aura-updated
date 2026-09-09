/**
 * Life Weather Engine V1 -- input validation.
 *
 * Validates just enough to protect deterministic behavior -- never a full
 * re-validation of every upstream contract's own internal invariants
 * (those are each upstream engine's own responsibility). Malformed domain
 * records are rejected, never silently ignored (see this file's own
 * per-section doc comments for exactly what "malformed" means here).
 */
import { PERSONAL_THEMES } from '../../personal-intelligence/src/themes';
import { isNormalizedScore, isPersonalTheme, isPersonalTransitRelationship } from '../../personal-intelligence/src/validation';
import { isRecognizedMappedPlanet } from './mapping';
import { LifeWeatherValidationError } from './types';
import type { LifeWeatherInput } from './types';

/**
 * Strict ISO-8601 instant validation -- reuses the exact STYLE established
 * in packages/transit-activation/src/validation.ts (a strict zone-designator
 * pattern plus manual leap-year-aware calendar-component validation, since
 * JavaScript's native `Date` constructor silently rolls over impossible
 * calendar values like '2026-02-30T00:00:00Z' instead of rejecting them).
 * Kept as this package's own local copy rather than an import, matching
 * this repo's own established convention (every package re-implements its
 * own small validators/evidence-dedupers rather than sharing a utils
 * import -- see e.g. dedupeEvidenceRefs, reimplemented per-package
 * throughout this roadmap).
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
    throw new LifeWeatherValidationError(`evaluationTime must be a non-empty ISO-8601 string, got: ${String(evaluationTime)}.`);
  }

  const match = STRICT_ISO_INSTANT_PATTERN.exec(evaluationTime);
  if (!match) {
    throw new LifeWeatherValidationError(`evaluationTime must be a strict ISO-8601 instant with an explicit zone designator (Z or +/-HH:MM), got: ${evaluationTime}.`);
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
    throw new LifeWeatherValidationError(`evaluationTime is syntactically ISO-shaped but not a real calendar instant, got: ${evaluationTime}.`);
  }
  if (!Number.isFinite(new Date(evaluationTime).getTime())) {
    throw new LifeWeatherValidationError(`evaluationTime must be a valid, parseable instant, got: ${evaluationTime}.`);
  }
}

const VALID_DIRECTIONS = new Set(['SUPPORTIVE', 'NEUTRAL', 'CHALLENGING']);

/** Exactly all 10 canonical themes, no duplicates, every signal's own strength/direction valid. */
function assertValidNatalThemes(natalThemes: LifeWeatherInput['natalThemes']): void {
  if (natalThemes == null || !Array.isArray(natalThemes.signals)) {
    throw new LifeWeatherValidationError('natalThemes must be an object with a signals array.');
  }
  if (natalThemes.signals.length !== PERSONAL_THEMES.length) {
    throw new LifeWeatherValidationError(`natalThemes.signals must contain exactly ${PERSONAL_THEMES.length} entries (one per canonical PersonalTheme), got ${natalThemes.signals.length}.`);
  }
  const seen = new Set<string>();
  for (const signal of natalThemes.signals) {
    if (!isPersonalTheme(signal.theme)) {
      throw new LifeWeatherValidationError(`natalThemes.signals contains an unrecognized theme: ${String(signal.theme)}.`);
    }
    if (seen.has(signal.theme)) {
      throw new LifeWeatherValidationError(`natalThemes.signals contains a duplicate theme: ${signal.theme}.`);
    }
    seen.add(signal.theme);
    if (!isNormalizedScore(signal.strength)) {
      throw new LifeWeatherValidationError(`natalThemes.signals[${signal.theme}].strength must be a finite number in [0, 1], got: ${signal.strength}.`);
    }
    if (!VALID_DIRECTIONS.has(signal.direction)) {
      throw new LifeWeatherValidationError(`natalThemes.signals[${signal.theme}].direction must be one of SUPPORTIVE/NEUTRAL/CHALLENGING, got: ${String(signal.direction)}.`);
    }
  }
  if (seen.size !== PERSONAL_THEMES.length) {
    throw new LifeWeatherValidationError(`natalThemes.signals must cover all ${PERSONAL_THEMES.length} canonical themes, got ${seen.size} distinct themes.`);
  }
}

/** system must be VIMSHOTTARI_DASHA; any present segment's own ruler must resolve through the canonical Personal Themes mapping (see mapping.ts's own isRecognizedMappedPlanet). */
function assertValidLifePeriod(lifePeriod: LifeWeatherInput['lifePeriod']): void {
  if (lifePeriod == null || typeof lifePeriod !== 'object') {
    throw new LifeWeatherValidationError('lifePeriod must be an object.');
  }
  if (lifePeriod.system !== 'VIMSHOTTARI_DASHA') {
    throw new LifeWeatherValidationError(`lifePeriod.system must be 'VIMSHOTTARI_DASHA', got: ${String(lifePeriod.system)}.`);
  }
  for (const [label, segment] of [
    ['majorPeriod', lifePeriod.majorPeriod],
    ['subPeriod', lifePeriod.subPeriod],
  ] as const) {
    if (segment === undefined) continue;
    if (typeof segment.ruler !== 'string' || segment.ruler.length === 0) {
      throw new LifeWeatherValidationError(`lifePeriod.${label}.ruler must be a non-empty string, got: ${String(segment.ruler)}.`);
    }
    if (!isRecognizedMappedPlanet(segment.ruler)) {
      throw new LifeWeatherValidationError(`lifePeriod.${label}.ruler ("${segment.ruler}") does not resolve through the canonical Personal Themes planet-to-theme mapping.`);
    }
  }
}

/** No duplicate directed (transitingPlanet, natalPlanet) pair; every activation's own strength/relationship/natalPlanet valid. */
function assertValidTransitActivations(transitActivations: LifeWeatherInput['transitActivations']): void {
  if (transitActivations == null || !Array.isArray(transitActivations.activations)) {
    throw new LifeWeatherValidationError('transitActivations must be an object with an activations array.');
  }
  const seenPairs = new Set<string>();
  for (const activation of transitActivations.activations) {
    if (typeof activation.transitingPlanet !== 'string' || activation.transitingPlanet.length === 0) {
      throw new LifeWeatherValidationError(`transitActivations contains an activation with an invalid transitingPlanet: ${String(activation.transitingPlanet)}.`);
    }
    if (typeof activation.natalPlanet !== 'string' || activation.natalPlanet.length === 0) {
      throw new LifeWeatherValidationError(`transitActivations contains an activation with an invalid natalPlanet: ${String(activation.natalPlanet)}.`);
    }
    const pairKey = `${activation.transitingPlanet}|${activation.natalPlanet}`;
    if (seenPairs.has(pairKey)) {
      throw new LifeWeatherValidationError(`transitActivations contains a duplicate directed pair: ${activation.transitingPlanet} -> ${activation.natalPlanet}.`);
    }
    seenPairs.add(pairKey);
    if (!isPersonalTransitRelationship(activation.relationship)) {
      throw new LifeWeatherValidationError(`transitActivations contains an activation with an invalid relationship: ${String(activation.relationship)}.`);
    }
    if (!isNormalizedScore(activation.strength)) {
      throw new LifeWeatherValidationError(`transitActivations contains an activation with an invalid strength: ${activation.strength}.`);
    }
    if (!isRecognizedMappedPlanet(activation.natalPlanet)) {
      throw new LifeWeatherValidationError(`transitActivations contains an activation whose natalPlanet ("${activation.natalPlanet}") does not resolve through the canonical Personal Themes planet-to-theme mapping.`);
    }
  }
}

export function assertValidLifeWeatherInput(input: LifeWeatherInput): void {
  if (input == null || typeof input !== 'object') {
    throw new LifeWeatherValidationError('LifeWeatherInput must be an object with natalThemes, lifePeriod, transitActivations, and evaluationTime.');
  }
  assertValidEvaluationTime(input.evaluationTime);
  assertValidNatalThemes(input.natalThemes);
  assertValidLifePeriod(input.lifePeriod);
  assertValidTransitActivations(input.transitActivations);
}
