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
 *
 * Still V2 (PR #102 / Daily Personal Fit): `DailyPersonalFitContext`/
 * `PersonalGuidanceContext.dailyFit` were added -- purely additive (a new
 * optional field), so no version bump was needed for this change alone.
 * The pre-existing `PersonalActivityFit` (guidance.ts) is a DIFFERENT,
 * older, still-unpopulated placeholder type -- left untouched by this
 * change, see guidance.ts's own doc comment.
 *
 * Still V2 (PR #104 / Daily Guidance): `DailyGuidanceSelectionReason`/
 * `DailyGuidanceTiming`/`DailyGuidanceRecommendation`/`DailyGuidanceContext`/
 * `PersonalGuidanceContext.dailyGuidance` were added -- purely additive.
 * The pre-existing `DailyPersonalGuidance` (guidance.ts) is a DIFFERENT,
 * older, still-unpopulated placeholder type -- semantically incompatible
 * with this PR's own output (a single collapsed `NormalizedScore`,
 * pre-rendered `headline`/`summary` prose, and `date`/`timezone`
 * ownership, none of which #104 produces) -- left untouched, see
 * guidance.ts's own doc comment.
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
// Daily Personal Fit (synthesis layer -- projects an already-computed
// LifeWeatherContext onto Aura's canonical Muhurta activity-family
// vocabulary to determine personal relevance). Purely additive to
// CONTRACT_V2 -- see provenance.ts's own doc comment.
//
// `activityFamily` stays a plain `string` (not importing
// packages/muhurta's own `MuhurtaActivityFamily`) for the identical
// dependency-direction reason `PersonalMuhurtaWindow.activityFamilies`
// already does above -- this package still has zero cross-package
// imports. A real DailyPersonalFitContext's own `activityFamily` values
// are expected to align with MuhurtaActivityFamily's 13 values BY
// CONVENTION (packages/daily-personal-fit's own adapter), never enforced
// via a type import here.
// ============================================================

/** Purely structural -- no favorable/unfavorable polarity, and NOT the same vocabulary as LifeWeatherState (a DailyActivityFit can be reinforced by multiple themes at different states; see DailyActivityFit's own doc comment for the derivation rule). */
export type PersonalRelevance = 'BASELINE' | 'RELEVANT' | 'HIGHLY_RELEVANT';

/** One theme this activity family is semantically mapped to, and that theme's own current LifeWeatherState -- included even when QUIET (see DailyActivityFit's own doc comment: the mapping is lossless, never filtered to "active themes only"). */
export interface DailyPersonalFitRelevantTheme {
  theme: PersonalTheme;
  state: LifeWeatherState;
}

/**
 * One activity family's personal-relevance picture. `personalRelevance`
 * is derived from the MAXIMUM state among `relevantThemes` only
 * (STRONGLY_ACTIVE present anywhere -> HIGHLY_RELEVANT; else ACTIVE
 * present anywhere -> RELEVANT; else BASELINE) -- never a count, never a
 * weighted/summed score, and never a function of `natalStrength` or
 * `natalDirection` (both deliberately absent from `relevantThemes`
 * itself -- see packages/daily-personal-fit/README.md's own "Natal
 * strength/direction do not drive fit" section). `relevantThemes`
 * ALWAYS lists every theme this activity family is semantically mapped
 * to, regardless of state -- a QUIET mapped theme is not dropped, so the
 * mapping itself stays fully inspectable/explainable.
 */
export interface DailyActivityFit {
  activityFamily: string;
  personalRelevance: PersonalRelevance;
  relevantThemes: DailyPersonalFitRelevantTheme[];
  evidence: PersonalEvidenceRef[];
}

/** The complete V1 Daily Personal Fit result -- always one entry per canonical activity family (packages/daily-personal-fit's own canonical order), never sparse, never sorted by relevance (ranking is explicitly out of scope -- see #103). */
export interface DailyPersonalFitContext {
  engineVersion: string;
  evaluationTime: string;
  activities: DailyActivityFit[];
  evidence: PersonalEvidenceRef[];
}

// ============================================================
// Daily Guidance (synthesis layer -- joins DailyPersonalFitContext's own
// personal-relevance axis with an already-ranked, per-family
// WindowRankingContext's own timing axis to select up to N cross-family
// recommendations). Purely additive to CONTRACT_V2 -- see provenance.ts's
// own doc comment.
//
// ZERO-COUPLING BOUNDARY (merge-critical, see ../README.md's "Dependency
// direction" section): `activityFamily` stays a plain `string` (not
// importing packages/muhurta's own `MuhurtaActivityFamily`, matching
// DailyActivityFit's own precedent above), and `DailyGuidanceTiming.label`
// stays a plain `string` (not importing packages/recommendation's own
// `TimingCandidateLabel`) -- both are expected to align with their real
// upstream unions BY CONVENTION, never enforced via a type import here.
// packages/daily-guidance (the engine that actually PRODUCES a
// DailyGuidanceContext) is allowed to import both of those packages --
// this file only describes the SHAPE, never the calculation.
// ============================================================

/**
 * Which of #104's three staged eligibility passes selected this
 * recommendation (see packages/daily-guidance/README.md's "Selection
 * policy" section for the full rule). Ordinal by construction --
 * PRIMARY_FLOOR_MET is always considered, in full, before
 * RELAXED_TIMING_FLOOR ever runs, which is in turn always considered, in
 * full, before RELAXED_RELEVANCE_FLOOR ever runs -- this is what makes
 * `RELEVANT + EXCELLENT` beat `HIGHLY_RELEVANT + USABLE` (the former is
 * PRIMARY_FLOOR_MET, the latter is RELAXED_TIMING_FLOOR, and Stage 1 fills
 * every available slot before Stage 2 is ever consulted). There is no
 * fourth value: CAUTION-labeled timing is never eligible for a
 * DailyGuidanceRecommendation at all, in any stage.
 */
export type DailyGuidanceSelectionReason = 'PRIMARY_FLOOR_MET' | 'RELAXED_TIMING_FLOOR' | 'RELAXED_RELEVANCE_FLOOR';

/**
 * The timing axis of one recommendation, copied verbatim from the
 * selected family's own `WindowRankingContext.windows[0]` -- never
 * recomputed, rescaled, or relabeled. `label` mirrors
 * `TimingCandidateLabel`'s 5 values (`EXCELLENT`/`VERY_GOOD`/`GOOD`/
 * `USABLE`/`CAUTION`) BY CONVENTION (see this section's own module doc
 * comment on the zero-coupling boundary) -- a `DailyGuidanceRecommendation`
 * never carries a CAUTION `label`, since CAUTION is never eligible (see
 * `DailyGuidanceSelectionReason`'s own doc comment). `windowRank` is
 * always `1` in V1 (only a family's own best window is ever selected --
 * see packages/daily-guidance/README.md's "Best window only" section) --
 * kept as an explicit field, rather than an assumed constant, so a future
 * V2 that legitimately needs a different rank has somewhere to put it
 * without a shape change here.
 */
export interface DailyGuidanceTiming {
  start: string;
  end: string;
  score: number;
  label: string;
  windowRank: number;
}

/**
 * One cross-family recommendation. `rank` is #104's OWN cross-family
 * rank (1-based, in final selection order) -- distinct from
 * `timing.windowRank`, which belongs to #103 (see DailyGuidanceTiming's
 * own doc comment). `personalRelevance`/`relevantThemes` are copied
 * verbatim from the selected family's own `DailyActivityFit` -- never
 * recomputed, never filtered. `evidence` is a small, composer-owned set
 * of `PersonalEvidenceRef` entries (the selection-rule fact itself, plus
 * compact forwarded timing reasons/conflicts) -- never a full copy of any
 * upstream engine's own evidence tree (see
 * packages/daily-guidance/README.md's "Evidence strategy" section).
 */
export interface DailyGuidanceRecommendation {
  rank: number;
  activityFamily: string;
  personalRelevance: PersonalRelevance;
  relevantThemes: DailyPersonalFitRelevantTheme[];
  timing: DailyGuidanceTiming;
  selectionReason: DailyGuidanceSelectionReason;
  evidence: PersonalEvidenceRef[];
}

/**
 * The complete V1 Daily Guidance result. `recommendations` may legitimately
 * contain FEWER than the requested `limit` entries (quality over padding
 * -- see packages/daily-guidance/README.md's "Up to N, never exactly N"
 * section) and may legitimately be `[]` (no family cleared any stage's
 * eligibility bar today) -- both are valid, non-error results, never
 * fabricated guidance. `evaluationTime` is read verbatim from the input
 * `DailyPersonalFitContext.evaluationTime` -- this layer introduces no
 * date/timezone concept of its own. `omittedActivities`/reason-coded
 * omission reporting was deliberately NOT added in V1 -- see
 * packages/daily-guidance/README.md's "No omittedActivities in V1"
 * section for why that is future (#106-adjacent) scope, not an oversight.
 */
export interface DailyGuidanceContext {
  engineVersion: string;
  selectionPolicyVersion: string;
  evaluationTime: string;
  recommendations: DailyGuidanceRecommendation[];
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
  /** The synthesis layer built from `lifeWeather` alone, projected onto Aura's canonical Muhurta activity families -- see DailyPersonalFitContext's own doc comment. Additive alongside `lifeWeather`/`muhurta`, never nested inside either. */
  dailyFit?: DailyPersonalFitContext;
  /** The cross-family synthesis layer built from `dailyFit` plus an already-ranked, per-family timing source -- see DailyGuidanceContext's own doc comment. Additive alongside `dailyFit`, never a replacement for it. */
  dailyGuidance?: DailyGuidanceContext;
}
