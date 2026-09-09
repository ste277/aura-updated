/**
 * Personal Intelligence Contract V2 -- foundational shared vocabulary.
 *
 * This whole package defines CONTRACTS ONLY: what personalization
 * evidence means structurally, never what is good for the user. It
 * contains no scoring engine, no prediction engine, no recommendation
 * engine, and no UI composition -- see ../README.md for the full product
 * boundary this package deliberately stays inside of.
 *
 * Zero cross-package imports anywhere in this package's own source (see
 * README.md's "Dependency direction" section) -- every type here is
 * self-contained by design, even where an existing package already has a
 * semantically close concept, so this package can be adopted by a future
 * engine without that engine's package needing to depend on this one's
 * upstream dependencies, and so this package never risks a circular
 * import back into anything it might describe (e.g. packages/bhrigu).
 * Where a field's VALUES are expected to align with an existing type
 * elsewhere (e.g. ActivityIdentifier with ActivityProfile.id), that is
 * documented in prose, never enforced via a type import.
 */
import type { PersonalEvidenceRef } from './evidence';

/**
 * A normalized score in [0, 1] -- the scale every future score in this
 * contract uses (PersonalThemeSignal.strength, TransitActivation.strength,
 * PersonalSupportContext's support numbers, PersonalActivityFit.score,
 * PersonalRecommendation.score). Deliberately 0-1, not 0-100: this is a
 * new convention for this contract layer, chosen for consistency with
 * packages/bhrigu's own existing 0-1 relationship-strength scale (see
 * packages/bhrigu/src/constants.ts's DEFAULT_RELATIONSHIP_WEIGHTS).
 *
 * This differs from the EXISTING packages/recommendation engine's own
 * 0-100 scale (AuraFitEvaluation.score, ActionCard.fitScore --
 * packages/recommendation/src/auraFitEngine.ts /
 * packages/recommendation/src/actionCards.ts). A future engine that
 * bridges the two (e.g. a PersonalActivityFit populated partly from an
 * AuraFitEvaluation) will need to divide that score by 100 -- this
 * contract does not perform that conversion itself, it only documents
 * which scale IT uses. Never mix the two scales within a single contract
 * value.
 */
export type NormalizedScore = number;

/**
 * A stable activity identity. Matches the existing convention already in
 * use across packages/recommendation (ActivityProfile.id,
 * packages/recommendation/src/personalizedTasks.ts) and apps/web
 * (ActionCard.activityId, HabitLog.activityId) -- all plain strings, all
 * treated as stable/persistence-safe identity once referenced. Kept as a
 * bare `string` alias rather than importing ActivityProfile itself: the
 * identifier IS just a string at every one of those call sites, so no
 * cross-package import is needed to reuse it, and this avoids coupling
 * this package to packages/recommendation's own evolving catalog shape.
 */
export type ActivityIdentifier = string;

/**
 * Aura's V1 personal theme taxonomy -- a user's longer-term tendency /
 * domain of life, DISTINCT from an Activity (a concrete thing the user
 * may do). Deliberately NOT reused from either existing, semantically
 * different classification already in the repo:
 * - ActivityCategory (packages/recommendation/src/personalizedTasks.ts,
 *   15 values: WORK, FOCUS, WORKOUT, TRAVEL, RELATIONSHIP, SOCIAL,
 *   LEARNING, FINANCE, SPIRITUAL, HOME, MEAL, MICRO_BREAK, REST, ROUTINE,
 *   NEW_BEGINNING) -- classifies an ACTIVITY, not a person's tendency.
 * - MuhurtaFamily (packages/muhurta/src/activityOntology.ts, 10 values:
 *   WORK, BUSINESS, FINANCE, TRAVEL, RELATIONSHIP, HOME, EDUCATION,
 *   HEALTH, SOCIAL, ROUTINE) -- classifies a MUHURTA evaluation's own
 *   domain, not a personal theme either.
 * Both are real, existing, and neither is a personal-theme taxonomy --
 * this is a genuinely new vocabulary layer, per this PR's own brief.
 */
export type PersonalTheme =
  | 'FOCUS'
  | 'LEARNING'
  | 'CAREER'
  | 'FINANCE'
  | 'RELATIONSHIPS'
  | 'CREATIVITY'
  | 'SOCIAL'
  | 'WELLBEING'
  | 'EXPLORATION'
  | 'SPIRITUALITY';

/**
 * A future engine's contribution toward one personal theme. This PR does
 * NOT calculate `strength` or `direction` for any real chart -- it only
 * defines the shape a future Themes engine (not implemented here) would
 * produce.
 */
export interface PersonalThemeSignal {
  theme: PersonalTheme;
  /** [0, 1] -- see NormalizedScore's own doc comment. */
  strength: NormalizedScore;
  direction: 'SUPPORTIVE' | 'NEUTRAL' | 'CHALLENGING';
  reasons: PersonalEvidenceRef[];
}

/**
 * A small, deliberately non-exhaustive set of canonical reason codes --
 * "foundational structure plus a small canonical set," not an attempt to
 * enumerate every future reason. `PersonalReason.code` stays a plain
 * `string` (not a closed union of just these) so a future engine can
 * introduce a new code without this contract package needing a release
 * for every one -- these are convenience constants for the codes already
 * anticipated by this PR's own brief, not a required set.
 */
export const PERSONAL_REASON_CODES = {
  NATAL_THEME_SUPPORT: 'NATAL_THEME_SUPPORT',
  LIFE_PERIOD_ALIGNMENT: 'LIFE_PERIOD_ALIGNMENT',
  TRANSIT_ACTIVATION: 'TRANSIT_ACTIVATION',
  PANCHANG_SUPPORT: 'PANCHANG_SUPPORT',
  MUHURTA_WINDOW_SUPPORT: 'MUHURTA_WINDOW_SUPPORT',
  RAHU_CONFLICT: 'RAHU_CONFLICT',
} as const;

export type PersonalReasonCode = (typeof PERSONAL_REASON_CODES)[keyof typeof PERSONAL_REASON_CODES];

/**
 * A single explainable factor behind a future score/recommendation.
 * `code` supports deterministic future templates (a fixed code always
 * maps to the same downstream copy); `message` is a short, already-
 * rendered explanation (never horoscope/prediction prose -- see
 * README.md's evidence-first principle); `evidence` grounds it in the
 * structured facts that produced it.
 */
export interface PersonalReason {
  code: string;
  message: string;
  evidence: PersonalEvidenceRef[];
}
