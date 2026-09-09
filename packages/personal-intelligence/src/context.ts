/**
 * Personal Intelligence Contract V2 -- context contracts.
 *
 * Every personalization "layer" (natal themes, life period, transit
 * activation, personal support, Panchang, Muhurta, and now the Life
 * Weather synthesis layer) gets a small contract here describing the
 * SHAPE of what that layer contributes -- never the calculation itself.
 * See ../README.md's "Partial-context principle": every section of
 * PersonalGuidanceContext is optional by design, because Aura may
 * legitimately operate with an incomplete personalization context -- that
 * is intentional, not an invalid state.
 *
 * V1 -> V2: `TransitActivation` changed shape (grouped-by-transiting-planet
 * -> lossless pair-level), and `LifeWeatherContext`/`PersonalGuidanceContext.lifeWeather`
 * were added. See provenance.ts's own doc comment and
 * packages/life-weather/README.md's "Personal Intelligence contract V1 -> V2"
 * section for the full history and rationale.
 */
import type { NormalizedScore, PersonalTheme, PersonalThemeSignal } from './types';
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
 * The sign-relationship category a directed transit activation can carry --
 * a CONTRACT-LOCAL vocabulary, deliberately NOT a type import of
 * packages/bhrigu's own `BhriguRelationshipType` (see this file's own
 * module doc comment and ../README.md's "Dependency direction" section:
 * zero cross-package imports anywhere in this package). The 5 string
 * literals below are expected to align with Bhrigu's own relationship
 * categories BY CONVENTION (documented here, never enforced via a type
 * import) -- `'NONE'` is deliberately excluded, since only a genuine
 * (non-NONE) activation is ever represented as a `TransitActivation`
 * record at all; there is nothing to report for a NONE pair.
 */
export type PersonalTransitRelationship = 'SAME_SIGN' | 'TRINE' | 'OPPOSITION' | 'THREE_ELEVEN' | 'TWO_TWELVE';

/**
 * CONTRACT_V2 (see provenance.ts): one directed, pair-level
 * `transitingPlanet -> natalPlanet` activation -- the lossless replacement
 * for the previous, lossy grouped-by-transiting-planet shape. `transitingPlanet`
 * and `natalPlanet` are both plain `string` (not hard-restricted to a closed
 * planet union), for the identical reason `transitingPlanet` was already a
 * plain string in V1 -- see this file's own module doc comment on
 * dependency direction; a future adapter can freely assign any planet-name
 * string, including packages/vedic's own GrahaName values (itself a
 * string-literal union, therefore assignable to `string`).
 *
 * V1's own `activatedThemes`/`natalTargets`/aggregate `strength` are
 * deliberately NOT carried into V2: those fields either required lossy
 * grouping (`natalTargets` held natal-planet identity only as untyped
 * evidence-shaped data, never a typed field) or an invented aggregation
 * policy (`strength` was a `Math.max(...)` over every natal target a
 * transiting planet activated, a policy this contract itself never
 * specified). See packages/life-weather/README.md's "Personal Intelligence
 * contract V1 -> V2" section for the full audit trail behind this change.
 * Theme projection is now Life Weather's own job (LifeWeatherContext below),
 * never this raw-fact contract's.
 */
export interface TransitActivation {
  transitingPlanet: string;
  natalPlanet: string;
  relationship: PersonalTransitRelationship;
  strength: NormalizedScore;
  evidence: PersonalEvidenceRef[];
}

/** One record per directed pair (see TransitActivation's own doc comment) -- never grouped, never aggregated. */
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
// Life Weather (synthesis layer -- current personal theme activation).
//
// Distinct from every context above it: `themes`/`lifePeriod`/`transits`
// each carry one upstream engine's own RAW output; LifeWeatherContext is
// the first SYNTHESIS layer that reads several of them together and
// produces a genuinely new kind of fact (which themes are CURRENTLY
// active, and which independent systems are reinforcing them) -- never a
// replacement for the raw sections, always additive alongside them (see
// PersonalGuidanceContext.lifeWeather below).
// ============================================================

/** Purely structural -- no favorable/unfavorable polarity. See LifeWeatherTheme's own doc comment for the exact derivation rule. */
export type LifeWeatherState = 'QUIET' | 'ACTIVE' | 'STRONGLY_ACTIVE';

/** The person's own natal Personal Themes baseline, carried through unmodified -- never recomputed, never incremented by current activity. */
export interface LifeWeatherNatalContributor {
  source: 'NATAL';
  strength: NormalizedScore;
  evidence: PersonalEvidenceRef[];
}

/** Categorical only -- no numeric strength. A Mahadasha lord's mere presence is not a magnitude; see this field's own absence as a deliberate choice, not an oversight. */
export interface LifeWeatherMahadashaContributor {
  source: 'DASHA_MAHADASHA';
  natalPlanet: string;
  evidence: PersonalEvidenceRef[];
}

/** Categorical only -- see LifeWeatherMahadashaContributor's own doc comment; kept as a fully separate contributor kind from DASHA_MAHADASHA even when both lords are the same planet (see README.md's "Mahadasha == Antardasha" section). */
export interface LifeWeatherAntardashaContributor {
  source: 'DASHA_ANTARDASHA';
  natalPlanet: string;
  evidence: PersonalEvidenceRef[];
}

/** `strength` is copied verbatim from the source TransitActivation pair -- never rescaled, summed, or maxed against any other contributor. */
export interface LifeWeatherTransitContributor {
  source: 'TRANSIT';
  transitingPlanet: string;
  natalPlanet: string;
  relationship: PersonalTransitRelationship;
  strength: NormalizedScore;
  evidence: PersonalEvidenceRef[];
}

/** A discriminated union on `source` -- a consumer can narrow by `source` to access each kind's own fields, never needing to parse `evidence.data` to recover contributor identity. */
export type LifeWeatherContributor = LifeWeatherNatalContributor | LifeWeatherMahadashaContributor | LifeWeatherAntardashaContributor | LifeWeatherTransitContributor;

/**
 * One theme's full current-activation picture. `natalStrength`/`natalDirection`
 * are copied verbatim from the input PersonalThemeContext (immutable baseline
 * -- never recomputed as a function of current contributors, see
 * LifeWeatherNatalContributor's own doc comment). `reinforcementSources`
 * deliberately excludes `'NATAL'`: natal is the baseline every theme already
 * has, not a CURRENT activation source -- only `'DASHA'`/`'TRANSIT'` describe
 * something happening right now, at `evaluationTime`. A theme with
 * `natalStrength === 0` (e.g. SOCIAL/FINANCE, structurally always 0 in
 * Personal Themes V1) can still legitimately reach `ACTIVE`/`STRONGLY_ACTIVE`
 * -- eligibility for a current contributor comes from the canonical
 * planet-to-theme mapping, never from `natalStrength` itself (see
 * packages/life-weather/README.md's "Zero natal strength" section).
 */
export interface LifeWeatherTheme {
  theme: PersonalTheme;
  /** Immutable natal Personal Themes strength -- see this interface's own doc comment. */
  natalStrength: NormalizedScore;
  /** Natal-only direction, copied verbatim from PersonalThemeContext -- never a current/dynamic polarity (see LifeWeatherState's own doc comment: Life Weather itself never emits a current polarity). */
  natalDirection: 'SUPPORTIVE' | 'NEUTRAL' | 'CHALLENGING';
  state: LifeWeatherState;
  /** Distinct CURRENT systems reinforcing this theme, in fixed ['DASHA', 'TRANSIT'] canonical order when both are present -- never includes 'NATAL' (see this interface's own doc comment). */
  reinforcementSources: ('DASHA' | 'TRANSIT')[];
  contributors: LifeWeatherContributor[];
  evidence: PersonalEvidenceRef[];
}

/** The complete V1 Life Weather result -- always all 10 PersonalTheme entries, PERSONAL_THEMES canonical order, never sparse (a QUIET theme with zero current contributors still appears, carrying only its NATAL contributor). */
export interface LifeWeatherContext {
  engineVersion: string;
  evaluationTime: string;
  themes: LifeWeatherTheme[];
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
  /** The synthesis layer built from `themes`+`lifePeriod`+`transits` -- see LifeWeatherContext's own doc comment. Additive alongside those raw sections, never a replacement for them. */
  lifeWeather?: LifeWeatherContext;
}
