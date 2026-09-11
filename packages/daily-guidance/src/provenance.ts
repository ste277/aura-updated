/**
 * Daily Guidance Composer V1 -- provenance/versioning.
 *
 * Two distinct version concepts, kept separate (matching every prior
 * engine's own precedent in this roadmap):
 * - DAILY_GUIDANCE_ENGINE_VERSION: this engine's own version, stamped on
 *   every DailyGuidanceContext.engineVersion. Describes the CONTRACT and
 *   plumbing (what fields exist, what they mean structurally).
 * - DAILY_GUIDANCE_SELECTION_POLICY_VERSION: the version of the staged
 *   eligibility + ordinal-tuple cross-family selection POLICY (eligibility.ts/
 *   ordering.ts) this engine currently applies -- kept as its own constant,
 *   independent of the engine version, because the selection policy is
 *   Aura PRODUCT semantics (which stage floors apply, what order the tuple
 *   keys are consulted in) that may reasonably evolve on its own without
 *   the contract SHAPE itself changing. See README.md's "Two version
 *   constants" section.
 *
 * Behavioral Integration V1 bumped SELECTION_POLICY to V2 (ordering.ts's
 * own tuple gained a new key, behavioral affinity tier) while
 * ENGINE_VERSION stays V1 -- the public DailyGuidanceContext/
 * DailyGuidanceRecommendation contract shape is byte-for-byte unchanged
 * (behavioral affinity is an input-only ordering signal, never a new
 * output field; see types.ts's own DailyGuidanceInput doc comment).
 *
 * Preferred Daypart Personalization V1 bumped SELECTION_POLICY again to
 * V3 for the identical reason -- ordering.ts's own tuple gained one more
 * key (preferred-daypart match, positioned after behavioral affinity and
 * before start/family) -- while ENGINE_VERSION stays V1 once more: the
 * new field is input-only (`DailyGuidanceInput.preferredDaypartMatchByFamily`),
 * never a new output field.
 *
 * Every rule id below is this engine's OWN synthesis fact (a selection
 * decision) -- never a traditional astrology calculation, never a Muhurta/
 * Aura Fit calculation, and never copied verbatim from an upstream
 * engine's own evidence (forwarded Muhurta reasons/conflicts are tagged
 * 'MUHURTA', not 'DAILY_GUIDANCE' -- see evidence.ts's own doc comment).
 * See README.md's "Traditional vs Aura" section for the full boundary
 * these rule ids exist to keep visible.
 */
export const DAILY_GUIDANCE_ENGINE_VERSION = 'DAILY_GUIDANCE_V1' as const;
export const DAILY_GUIDANCE_SELECTION_POLICY_VERSION = 'DAILY_GUIDANCE_SELECTION_POLICY_V3' as const;

/** One recommendation's own selection-rule fact (which stage selected it, and the tuple values that stage compared). */
export const DAILY_GUIDANCE_SELECTION_V1 = 'DAILY_GUIDANCE_SELECTION_V1';
/** One top-level summary evidence entry per result -- requested limit, selected count, engine/policy version (mirrors every prior engine's own summary-evidence precedent, e.g. Daily Personal Fit's own DAILY_PERSONAL_FIT_SUMMARY_V1). */
export const DAILY_GUIDANCE_SUMMARY_V1 = 'DAILY_GUIDANCE_SUMMARY_V1';
