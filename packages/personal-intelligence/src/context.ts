/**
 * Personal Intelligence Contract V1 -- context contracts.
 *
 * Every future personalization "layer" (natal themes, life period,
 * transit activation, personal support, Panchang, Muhurta) gets a small
 * contract here describing the SHAPE of what that layer would eventually
 * contribute -- never the calculation itself. See ../README.md's
 * "Partial-context principle": every section of PersonalGuidanceContext
 * is optional by design, because Aura may legitimately operate with an
 * incomplete personalization context (no birth profile yet, Dasha not
 * implemented yet, etc.) -- that is intentional, not an invalid state.
 */
import type { PersonalTheme, PersonalThemeSignal } from './types';
import type { PersonalEvidenceRef } from './evidence';

// ============================================================
// Life period (future Vimshottari Dasha).
// ============================================================

/**
 * One Dasha segment. No date math happens here -- startAt/endAt are
 * plain ISO-8601 instant strings, matching this repo's own established
 * convention for a serializable time boundary (see
 * packages/panchang/src/panchangDay.ts's PanchangWindowSpan.start/end,
 * which use the identical ISO-string-not-Date convention at its own
 * package boundary) -- never a `Date` object, which does not survive
 * JSON.stringify/parse as itself. `level` is a plain union, not
 * implemented further: V1 recognizes Mahadasha/Antardasha only, without
 * Pratyantardasha, but the field itself is generic enough that a future
 * V2 contract could add a third level value without breaking this shape.
 */
export interface LifePeriodSegment {
  ruler: string;
  startAt: string;
  endAt: string;
  level: 'MAHADASHA' | 'ANTARDASHA';
}

export interface LifePeriodContext {
  system: 'VIMSHOTTARI_DASHA';
  majorPeriod?: LifePeriodSegment;
  subPeriod?: LifePeriodSegment;
  themes: PersonalThemeSignal[];
  evidence: PersonalEvidenceRef[];
}

// ============================================================
// Transit activation (future current-transit engine).
// ============================================================

/**
 * One transiting planet's activation of natal placements. `transitingPlanet`
 * is a plain `string`, not hard-restricted to Jupiter/Saturn/Rahu/Ketu --
 * those four are the initially expected values, but the contract itself
 * stays open so a future engine can activate any planet without a
 * contract-level change. (packages/vedic's own GrahaName --
 * packages/vedic/src/natalChart.ts -- is NOT imported here: doing so
 * would create a cross-package dependency this contract package
 * deliberately avoids, see this file's own module doc comment and
 * ../README.md's "Dependency direction" section. A future adapter can
 * freely assign a GrahaName value into this field, since GrahaName is
 * itself a string-literal union and therefore assignable to `string`.)
 */
export interface TransitActivation {
  transitingPlanet: string;
  activatedThemes: PersonalThemeSignal[];
  natalTargets: PersonalEvidenceRef[];
  strength: number;
  evidence: PersonalEvidenceRef[];
}

export interface TransitActivationContext {
  activations: TransitActivation[];
  evidence: PersonalEvidenceRef[];
}

// ============================================================
// Personal support (future Ashtakavarga-derived support).
// ============================================================

/**
 * A generic "supportiveness" contract, deliberately NOT named after raw
 * Ashtakavarga concepts (bindus, rekhas, sarvashtakavarga) as if they
 * were universal product concepts -- `system` stays a plain `string` (not
 * a closed union) so a future, different support-deriving system could
 * populate this same contract without a type change here.
 * 'ASHTAKAVARGA' is the expected V1 value.
 */
export interface PersonalSupportContext {
  system: string;
  overallSupport?: number;
  themeSupport?: Partial<Record<PersonalTheme, number>>;
  evidence: PersonalEvidenceRef[];
}

// ============================================================
// Panchang (adapter contract -- never a second Panchang model).
// ============================================================

/**
 * The narrow subset of Panchang output this personalization layer
 * actually needs -- never a copy of packages/panchang/src/panchangDay.ts's
 * own full PanchangDay result (vara/tithi/nakshatra/yoga/karana/solar/
 * windows). `date`/`timezone` mirror that result's own `date` and
 * `location.timezone` field naming (not imported -- see this file's own
 * module doc comment on dependency direction); `qualities` carries
 * whatever Panchang-derived evidence a future engine decides is
 * personalization-relevant, as generic PersonalEvidenceRef entries rather
 * than a second copy of PanchangDay's own typed element shapes.
 */
export interface PersonalPanchangContext {
  date: string;
  timezone: string;
  qualities: PersonalEvidenceRef[];
  sourceVersion?: string;
}

// ============================================================
// Muhurta (adapter contract -- never a second Muhurta model).
//
// NAMING NOTE: packages/recommendation/src/auraFitEngine.ts already
// exports a DIFFERENT type named `PersonalMuhurtaContext` (natal
// Nakshatra/Rashi/MoonElement inputs FED INTO Muhurta scoring, not a
// personalization-facing VIEW of Muhurta timing windows). This package's
// own type is deliberately named PersonalMuhurtaTimingContext, NOT
// PersonalMuhurtaContext, specifically to avoid that collision -- the two
// concepts are unrelated, live in different packages, and this package
// has zero dependency on packages/recommendation, but reusing the exact
// same exported name for two different meanings was judged worse than a
// slightly longer, unambiguous name. Do not rename this back to
// PersonalMuhurtaContext, and do not rename packages/recommendation's own
// type -- that package is out of scope for this PR.
// ============================================================

/**
 * A single personalization-facing Muhurta timing window. `activityFamilies`
 * stays a plain `string[]` (not importing MuhurtaFamily from
 * packages/muhurta/src/activityOntology.ts) for the same dependency-
 * direction reason as TransitActivation.transitingPlanet above -- values
 * are expected to align with MuhurtaFamily's own 10 values when a future
 * adapter populates this from that package, but the type itself stays
 * open. startAt/endAt are ISO-8601 instant strings, matching
 * PanchangWindowSpan's own convention (see PersonalPanchangContext's doc
 * comment) -- this package never uses raw `Date` objects or bare
 * minute-of-day numbers in a contract meant to cross a package/API
 * boundary, even though packages/panchang's own lower-level WindowSpan
 * type uses minute-of-day internally.
 */
export interface PersonalMuhurtaWindow {
  startAt: string;
  endAt: string;
  activityFamilies: string[];
  qualities: PersonalEvidenceRef[];
  sourceVersion?: string;
}

export interface PersonalMuhurtaTimingContext {
  windows: PersonalMuhurtaWindow[];
  sourceVersion?: string;
}

// ============================================================
// Natal (adapter contract -- never a copy of the Bhrigu graph).
// ============================================================

/**
 * A lightweight reference to natal intelligence, never a duplicate of
 * packages/bhrigu's own BhriguNatalResult (nodes/edges/chains). `engine`
 * is a literal tag identifying WHICH engine produced this context (only
 * 'BHRIGU_NATAL' exists today); `engineVersion` carries that engine's own
 * version string verbatim (e.g. Bhrigu's own ENGINE_VERSION,
 * 'BHRIGU_NATAL_V1' -- packages/bhrigu/src/constants.ts) -- kept
 * deliberately distinct from this package's own CONTRACT_VERSION (see
 * provenance.ts's own doc comment).
 *
 * `themes` is optional and NOT populated by this PR: Bhrigu itself
 * produces karakas/relationships/chains, not product-facing
 * PersonalThemeSignal values -- deriving themes FROM Bhrigu evidence is
 * explicitly the future Personal Themes engine's job (out of scope here,
 * see ../README.md's "Explicitly out of scope" list). Until that engine
 * exists, a real PersonalNatalContext is expected to carry only `engine`,
 * `engineVersion`, and `evidence`.
 */
export interface PersonalNatalContext {
  engine: 'BHRIGU_NATAL';
  engineVersion: string;
  themes?: PersonalThemeSignal[];
  evidence: PersonalEvidenceRef[];
}

// ============================================================
// Personal themes (wrapper context for PersonalGuidanceContext.themes).
// ============================================================

export interface PersonalThemeContext {
  signals: PersonalThemeSignal[];
  evidence: PersonalEvidenceRef[];
}

// ============================================================
// The central, unified context.
// ============================================================

/**
 * The one contract every future personalization consumer reads from.
 * Every section below is OPTIONAL by design -- see this file's own
 * module doc comment and ../README.md's "Partial-context principle": a
 * consumer must be able to handle any subset being present, from
 * `{ version }` alone up through every section populated. `version` is
 * this contract's own CONTRACT_VERSION (provenance.ts), stamped on every
 * instance so a future consumer can detect which contract shape it's
 * reading.
 */
export interface PersonalGuidanceContext {
  version: string;

  natal?: PersonalNatalContext;
  themes?: PersonalThemeContext;
  lifePeriod?: LifePeriodContext;
  transits?: TransitActivationContext;
  personalSupport?: PersonalSupportContext;
  panchang?: PersonalPanchangContext;
  muhurta?: PersonalMuhurtaTimingContext;
}
