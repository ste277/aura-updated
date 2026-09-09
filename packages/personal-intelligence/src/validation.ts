/**
 * Personal Intelligence Contract V2 -- lightweight structural validation.
 *
 * Small, pure guard/assert functions only -- no runtime schema framework,
 * no new dependency (matching this repo's own existing convention: every
 * other packages/* module validates the same way, e.g.
 * packages/bhrigu/src/normalize.ts's own hand-written checks). These
 * exist to catch genuinely malformed contract values (a score outside its
 * documented scale, an unsupported theme string) at a boundary -- they do
 * not deeply validate every nested field of a large object.
 */
import { PERSONAL_THEMES } from './themes';
import type { NormalizedScore, PersonalTheme } from './types';
import type { PersonalGuidanceContext, PersonalTransitRelationship } from './context';

/** The exact, closed set of PersonalTransitRelationship values (context.ts's own doc comment) -- deliberately excludes 'NONE', matching the type itself. */
const PERSONAL_TRANSIT_RELATIONSHIPS: readonly PersonalTransitRelationship[] = ['SAME_SIGN', 'TRINE', 'OPPOSITION', 'THREE_ELEVEN', 'TWO_TWELVE'];

/** True only for one of the exact 5 supported PersonalTransitRelationship strings -- see context.ts's own doc comment for why 'NONE' is not one of them. */
export function isPersonalTransitRelationship(value: unknown): value is PersonalTransitRelationship {
  return typeof value === 'string' && (PERSONAL_TRANSIT_RELATIONSHIPS as readonly string[]).includes(value);
}

/**
 * True only for a finite number in [0, 1] -- the exact NormalizedScore
 * domain (types.ts's own doc comment). Rejects NaN, +/-Infinity, and any
 * value outside [0, 1], including a value on the existing 0-100 scale
 * (e.g. 85) that was mistakenly passed in unconverted -- that mismatch is
 * exactly the "silently mix 0-1 and 0-100" failure mode this function
 * exists to catch early.
 */
export function isNormalizedScore(value: unknown): value is NormalizedScore {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Throws if `value` is not a valid NormalizedScore -- see isNormalizedScore's own doc comment for the exact domain. */
export function assertNormalizedScore(value: unknown, label = 'value'): asserts value is NormalizedScore {
  if (!isNormalizedScore(value)) {
    throw new Error(`${label} must be a finite number in [0, 1], got: ${value}`);
  }
}

/** True only for one of the exact 10 supported PersonalTheme strings (themes.ts's own PERSONAL_THEMES). */
export function isPersonalTheme(value: unknown): value is PersonalTheme {
  return typeof value === 'string' && (PERSONAL_THEMES as readonly string[]).includes(value);
}

/**
 * A shallow structural check: `value` is a non-null object with a string
 * `version`, and every PRESENT optional section (natal/themes/lifePeriod/
 * transits/personalSupport/panchang/muhurta) is itself a non-null object
 * -- this deliberately does NOT deep-validate every nested field (that
 * would require a full schema for every contract in this package, which
 * this PR's own brief explicitly says to avoid). A context with every
 * optional section absent is still valid -- see context.ts's own
 * "Partial-context principle" doc comment.
 */
export function isPersonalGuidanceContext(value: unknown): value is PersonalGuidanceContext {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.version !== 'string') return false;

  const optionalObjectSections = ['natal', 'themes', 'lifePeriod', 'transits', 'personalSupport', 'panchang', 'muhurta', 'lifeWeather'] as const;
  return optionalObjectSections.every((key) => {
    const section = candidate[key];
    return section === undefined || (typeof section === 'object' && section !== null);
  });
}
