/**
 * Transit Activation Engine V1 -- input validation.
 */
import { TRANSIT_ACTIVATION_PLANETS } from './constants';
import { TransitActivationValidationError } from './types';
import type { TransitActivationInput, ZodiacSign } from './types';

const ZODIAC_SIGN_COUNT = 12;

function isValidSign(sign: unknown): sign is ZodiacSign {
  return typeof sign === 'number' && Number.isInteger(sign) && sign >= 0 && sign < ZODIAC_SIGN_COUNT;
}

function assertValidSignRecord(signs: unknown, label: string): void {
  if (signs == null || typeof signs !== 'object') {
    throw new TransitActivationValidationError(`${label} must be an object mapping each of the 9 canonical planets to a zodiac sign.`);
  }
  for (const planet of TRANSIT_ACTIVATION_PLANETS) {
    const sign = (signs as Record<string, unknown>)[planet];
    if (sign === undefined) {
      throw new TransitActivationValidationError(`${label} is missing required planet: ${planet}.`);
    }
    if (!isValidSign(sign)) {
      throw new TransitActivationValidationError(`${label}.${planet} must be an integer zodiac sign in [0, ${ZODIAC_SIGN_COUNT - 1}], got: ${sign}.`);
    }
  }
}

/**
 * Strict ISO-8601 instant pattern: 4-digit year, 2-digit month/day/hour/
 * minute/second, optional fractional seconds, and a MANDATORY explicit
 * zone designator (`Z` or a numeric `+HH:MM`/`-HH:MM` offset) -- a bare
 * local-time string with no zone designator at all is rejected as
 * ambiguous (see this function's own doc comment for why "explicit
 * timezone/UTC semantics" is a hard requirement, not merely "parses to
 * some Date").
 */
const STRICT_ISO_INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  const DAYS = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return DAYS[month - 1];
}

/**
 * Rejects a malformed evaluationTime -- must be a syntactically strict
 * ISO-8601 instant string (see STRICT_ISO_INSTANT_PATTERN above) whose
 * individual calendar components (month/day/hour/minute/second) are
 * ALSO genuinely valid, not merely "parseable."
 *
 * This second check exists because JavaScript's native `Date` parser is
 * dangerously lenient about calendar overflow: `new Date('2026-02-30T00:00:00Z')`
 * does NOT return `Invalid Date` -- it silently ROLLS OVER into
 * `2026-03-02T00:00:00.000Z` (empirically confirmed; the same is true of
 * `2026-02-29` in 2026, a non-leap year, which rolls into March 1). A
 * bare `Number.isFinite(new Date(x).getTime())` check -- this file's own
 * PREVIOUS implementation -- would silently accept and mis-record a
 * syntactically-plausible but impossible date rather than rejecting it,
 * exactly the "malformed time metadata survives as if it were valid"
 * failure mode this package must not produce. `evaluationTime` is still
 * never used to COMPUTE anything (see types.ts's own doc comment) --
 * this only validates shape/calendar-validity before echoing it through.
 */
function assertValidEvaluationTime(evaluationTime: unknown): void {
  if (typeof evaluationTime !== 'string' || evaluationTime.length === 0) {
    throw new TransitActivationValidationError(`evaluationTime must be a non-empty ISO-8601 string, got: ${String(evaluationTime)}.`);
  }

  const match = STRICT_ISO_INSTANT_PATTERN.exec(evaluationTime);
  if (!match) {
    throw new TransitActivationValidationError(`evaluationTime must be a strict ISO-8601 instant with an explicit zone designator (Z or +/-HH:MM), got: ${evaluationTime}.`);
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
    throw new TransitActivationValidationError(`evaluationTime is syntactically ISO-shaped but not a real calendar instant (impossible month/day/hour/minute/second), got: ${evaluationTime}.`);
  }

  if (!Number.isFinite(new Date(evaluationTime).getTime())) {
    throw new TransitActivationValidationError(`evaluationTime must be a valid, parseable instant, got: ${evaluationTime}.`);
  }
}

export function assertValidInput(input: TransitActivationInput): void {
  if (input == null || typeof input !== 'object') {
    throw new TransitActivationValidationError('TransitActivationInput must be an object with natalSigns, transitSigns, and evaluationTime.');
  }
  assertValidSignRecord(input.natalSigns, 'natalSigns');
  assertValidSignRecord(input.transitSigns, 'transitSigns');
  assertValidEvaluationTime(input.evaluationTime);
}
