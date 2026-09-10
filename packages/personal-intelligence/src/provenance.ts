/**
 * Personal Intelligence Contract V2 -- provenance/versioning.
 *
 * Two distinct version concepts, deliberately kept separate:
 * - CONTRACT_VERSION: the shape/vocabulary version of THIS package. It
 *   changes only when the contract's own types change in a way that
 *   matters to a consumer (a field added/removed/retyped).
 * - A source engine's own engineVersion (e.g. Bhrigu's own
 *   'BHRIGU_NATAL_V1', packages/bhrigu/src/constants.ts) -- carried
 *   verbatim wherever a contract references that engine's output
 *   (PersonalNatalContext.engineVersion, etc.), never conflated with
 *   CONTRACT_VERSION itself.
 *
 * V1 -> V2 changelog (Life Weather V1 / PR #101):
 * - `TransitActivation` changed shape from a lossy, grouped-by-
 *   transiting-planet record (`activatedThemes`/`natalTargets`/an
 *   invented `Math.max` aggregate `strength`) to a lossless, pair-level
 *   record (`transitingPlanet`, `natalPlanet`, `relationship`, `strength`
 *   all first-class -- one record per directed pair, never grouped).
 *   Retyping an already-published field is exactly the kind of change
 *   this file's own CONTRACT_VERSION policy requires bumping for -- see
 *   the Personal Intelligence transit-adapter audit (PR #100's own
 *   follow-up review) for why V1's shape was lossy and could not losslessly
 *   represent directed transit->natal activation identity in the first
 *   place. At the time of this bump, repo-wide search confirmed ZERO
 *   production consumers of the old shape (`toTransitActivationContext`
 *   itself was never built against V1 -- it was deliberately deferred in
 *   PR #100 for exactly this reason), so this migration's blast radius is
 *   limited to this package's own contract tests and the new adapter.
 * - Added `PersonalTransitRelationship` (contract-local, see context.ts's
 *   own doc comment on why this is not a Bhrigu type import).
 * - Added `LifeWeatherContext` and `PersonalGuidanceContext.lifeWeather`
 *   (purely additive -- would not by itself have required a version bump).
 * - Added `'LIFE_WEATHER'` to `PersonalEvidenceSource` (evidence.ts;
 *   purely additive).
 *
 * Still V2 (Daily Personal Fit V1 / PR #102) -- purely additive, no bump:
 * - Added `PersonalRelevance`, `DailyPersonalFitRelevantTheme`,
 *   `DailyActivityFit`, `DailyPersonalFitContext`, and
 *   `PersonalGuidanceContext.dailyFit` (context.ts). The pre-existing
 *   `PersonalActivityFit` (guidance.ts) is untouched -- a different,
 *   older, still-unpopulated placeholder type, not this engine's output.
 * - Added `'DAILY_PERSONAL_FIT'` to `PersonalEvidenceSource` (evidence.ts).
 *
 * Still V2 (Daily Guidance V1 / PR #104) -- purely additive, no bump:
 * - Added `DailyGuidanceSelectionReason`, `DailyGuidanceTiming`,
 *   `DailyGuidanceRecommendation`, `DailyGuidanceContext`, and
 *   `PersonalGuidanceContext.dailyGuidance` (context.ts). The pre-existing
 *   `DailyPersonalGuidance`/`PersonalRecommendation` (guidance.ts) are
 *   untouched -- semantically incompatible older placeholder types (a
 *   single collapsed `NormalizedScore`, pre-rendered prose, `date`/
 *   `timezone` ownership), not this engine's output.
 * - Added `'DAILY_GUIDANCE'` to `PersonalEvidenceSource` (evidence.ts).
 */
export const CONTRACT_VERSION = 'PERSONAL_INTELLIGENCE_CONTRACT_V2';
