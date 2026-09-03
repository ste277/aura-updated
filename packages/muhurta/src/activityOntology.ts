/**
 * Canonical activity ontology for Aura's Muhurta domain.
 *
 * This is an ADDITIVE layer, not a replacement for the existing engine:
 *   - `MuhurtaActivityFamily` (in muhurtaEngine.ts) remains the exact key the
 *     scoring RULES table and evaluateMuhurta() are keyed on. Nothing here
 *     changes what that function returns for any existing caller.
 *   - `MuhurtaFamily` / `MuhurtaIntent` below are a broader, more expressive
 *     classification meant for future features (structured reasons,
 *     localization, richer activity browsing) that sits *alongside* the
 *     legacy family, not instead of it.
 *
 * See packages/recommendation/src/activityDefinitions.ts for how this is
 * wired up to the actual activity catalog.
 */

import type { MuhurtaActivityFamily } from './muhurtaEngine';

/**
 * Broad activity families. Intentionally coarser than MuhurtaActivityFamily —
 * these are meant to group many specific intents (e.g. WORK contains
 * DEEP_WORK, MEETING, PRESENTATION, ...), matching how a person actually
 * thinks about "what kind of thing is this," independent of language.
 *
 * ROUTINE is not in the original brief's example list, but is needed to
 * house existing low-stakes catalog activities (admin, short breaks) that
 * don't fit any of the other buckets — added here rather than forcing them
 * into HOME or WORK, which would be misleading.
 */
export type MuhurtaFamily =
  | 'WORK'
  | 'BUSINESS'
  | 'FINANCE'
  | 'TRAVEL'
  | 'RELATIONSHIP'
  | 'HOME'
  | 'EDUCATION'
  | 'HEALTH'
  | 'SOCIAL'
  | 'ROUTINE';

/**
 * Specific intents within a family. Only the intents actually needed by
 * today's activity catalog are declared here (see ACTIVITY_DEFINITIONS in
 * packages/recommendation/src/activityDefinitions.ts for the mapping) — per
 * the brief, this is deliberately not pre-populated with every intent named
 * in the target taxonomy sketch. Add more here as new catalog activities are
 * mapped in future PRs; each addition should also update INTENT_FAMILY below.
 *
 * PITCH and STRATEGIC_PLANNING are declared but not yet assigned to any
 * catalog activity — they're reserved for splitting "High-Stakes Decision or
 * Pitch" and "Breathwork & Strategic Visioning" into narrower activities
 * later (see ACTIVITY_METADATA notes in activityDefinitions.ts). Until that
 * split happens, IMPORTANT_DECISION and MEDITATION stand in for them.
 */
export type MuhurtaIntent =
  // WORK
  | 'DEEP_WORK'
  | 'IMPORTANT_DECISION'
  | 'PITCH' // reserved: not yet assigned, see comment above
  | 'PROJECT_START'
  | 'STRATEGIC_PLANNING' // reserved: not yet assigned, see comment above
  // BUSINESS
  | 'BUSINESS_START'
  // FINANCE
  | 'IMPORTANT_FINANCIAL_DECISION'
  | 'PROPERTY_PURCHASE'
  // TRAVEL
  | 'JOURNEY_START'
  // RELATIONSHIP
  | 'DATE'
  | 'ENGAGEMENT'
  // Marriage Muhurtham Foundation V1: a dedicated intent, deliberately NOT
  // folded into ENGAGEMENT (a distinct, earlier ceremony) or NEW_BEGINNING/
  // PROJECT_START (too generic to carry Marriage-specific Panchanga rules --
  // see muhurtaRulePacks.ts's MARRIAGE rule pack). The activity this intent
  // is assigned to (packages/recommendation/src/activityDefinitions.ts's
  // `marriage`) remains gated out of Muhurtham Finder until its rule pack's
  // requiresPeriodExclusion/requiresPlanetaryCombustion needs are met --
  // see computeMuhurtaSupportLevel() in muhurtaRulePacks.ts.
  | 'MARRIAGE'
  // HOME
  | 'GRIHA_PRAVESH'
  // EDUCATION
  | 'STUDY'
  // HEALTH
  | 'WORKOUT'
  | 'MEDITATION'
  | 'RECOVERY'
  // SOCIAL
  | 'PARTY'
  // Product Structure V2's everyday-moment catalog (see
  // packages/recommendation/src/personalizedTasks.ts) -- four genuinely new
  // intents, added only because nothing existing captures them: a family
  // get-together is not a PARTY (no celebratory occasion), a casual
  // friend/coffee/movie hangout is not a DATE (no romantic framing) and not
  // a PARTY (no group-celebration framing), a birthday/anniversary is more
  // specific than a generic PARTY (marking an occasion, not just socializing),
  // and a day trip/picnic/shopping outing is not a JOURNEY_START (no
  // significant "departure" moment, LIGHT/STANDARD not DEEP).
  | 'FAMILY_GATHERING'
  | 'CASUAL_HANGOUT'
  | 'CELEBRATION'
  | 'OUTING'
  // ROUTINE
  | 'ADMIN'
  // Used only by the free-text fallback path (see legacyFamilyToIntent below)
  // when no catalog activity or specific intent applies.
  | 'GENERAL';

/** Which broad family each declared intent belongs to. Kept as an explicit
 * map (rather than inferring from naming) so it stays correct as intents are
 * added, and so it can be validated by tests. */
export const INTENT_FAMILY: Record<MuhurtaIntent, MuhurtaFamily> = {
  DEEP_WORK: 'WORK',
  IMPORTANT_DECISION: 'WORK',
  PITCH: 'WORK',
  PROJECT_START: 'WORK',
  STRATEGIC_PLANNING: 'WORK',
  BUSINESS_START: 'BUSINESS',
  IMPORTANT_FINANCIAL_DECISION: 'FINANCE',
  PROPERTY_PURCHASE: 'FINANCE',
  JOURNEY_START: 'TRAVEL',
  DATE: 'RELATIONSHIP',
  ENGAGEMENT: 'RELATIONSHIP',
  MARRIAGE: 'RELATIONSHIP',
  GRIHA_PRAVESH: 'HOME',
  STUDY: 'EDUCATION',
  WORKOUT: 'HEALTH',
  MEDITATION: 'HEALTH',
  RECOVERY: 'HEALTH',
  PARTY: 'SOCIAL',
  FAMILY_GATHERING: 'SOCIAL',
  CASUAL_HANGOUT: 'SOCIAL',
  CELEBRATION: 'SOCIAL',
  OUTING: 'TRAVEL',
  ADMIN: 'ROUTINE',
  GENERAL: 'ROUTINE',
};

export type SensitivityLevel = 'LOW' | 'MEDIUM' | 'HIGH';

/** How much precision the engine's evaluation should apply. Foundation for
 * future features (e.g. CEREMONIAL activities pulling in additional
 * Panchanga factors) — evaluateMuhurta() does not yet branch on this. */
export type MuhurtaEvaluationDepth = 'LIGHT' | 'STANDARD' | 'DEEP' | 'CEREMONIAL';

/** How much the exact start/duration/end timing matters for this activity,
 * independent of significance — e.g. a journey has a HIGH-sensitivity start
 * but a LOW-sensitivity end, while a meeting is sensitive on both. */
export interface TimingSensitivity {
  start: SensitivityLevel;
  duration: SensitivityLevel;
  end: SensitivityLevel;
}

export type SocialMode = 'SOLO' | 'PAIR' | 'GROUP' | 'FAMILY' | 'ANY';

/** The Muhurta-specific portion of an ActivityDefinition (see
 * packages/recommendation/src/activityDefinitions.ts for the full shape,
 * which adds category/aliases/id from the existing activity catalog).
 *
 * Deliberately does NOT carry a legacy-engine family. The legacy
 * MuhurtaActivityFamily is a migration detail, not part of the canonical
 * model — encoding it here would let it quietly become "part of the
 * ontology" and complicate ever deleting it. Use
 * toLegacyMuhurtaFamily(activity) in activityDefinitions.ts when the
 * existing engine needs it. */
export interface MuhurtaClassification {
  family: MuhurtaFamily;
  intent: MuhurtaIntent;
  significance: 'LOW' | 'MEDIUM' | 'HIGH';
  evaluationDepth: MuhurtaEvaluationDepth;
  timingSensitivity: TimingSensitivity;
}

/**
 * Structured-reason model: the canonical output of evaluateMuhurta() and the
 * Muhurta-derived parts of evaluateActivityFit(). English strings (supports/
 * blockers/summary arrays, muhurtaSummary, personalSummary) are now derived
 * FROM these via packages/muhurta/src/muhurtaReasonFormat.ts, not the other
 * way around — the engine's own modifier/score math only ever sums
 * `impact`, never inspects formatted text.
 *
 * NEUTRAL_WINDOW, ACTIVITY_RULE_SUPPORT, and ACTIVITY_RULE_BLOCK are
 * reserved codes: NEUTRAL_WINDOW is declared for a future PR that wants an
 * explicit "no solar-window signal" reason (today a neutral window simply
 * emits no SOLAR_WINDOW reason, matching pre-refactor behavior); the
 * ACTIVITY_RULE_* codes are emitted by evaluateActivityFit()'s
 * recommended/acceptable/avoid-window check (see auraFitEngine.ts).
 */
export type MuhurtaReasonCode =
  | 'TITHI_SUPPORTIVE'
  | 'TITHI_UNFAVORABLE'
  | 'NAKSHATRA_SUPPORTIVE'
  | 'NAKSHATRA_UNFAVORABLE'
  | 'YOGA_SUPPORTIVE'
  | 'YOGA_UNFAVORABLE'
  | 'KARANA_SUPPORTIVE'
  | 'KARANA_UNFAVORABLE'
  | 'ABHIJIT_SUPPORT'
  | 'RAHU_CAUTION'
  | 'YAMA_CAUTION'
  | 'GULIKA_SUPPORT'
  | 'BRAHMA_SUPPORT'
  | 'NEUTRAL_WINDOW'
  | 'ACTIVITY_RULE_SUPPORT'
  | 'ACTIVITY_RULE_BLOCK'
  | 'PERSONAL_TARA_SUPPORT'
  | 'PERSONAL_TARA_CAUTION'
  | 'OTHER';

export interface MuhurtaReason {
  code: MuhurtaReasonCode;
  factor: 'TITHI' | 'NAKSHATRA' | 'YOGA' | 'KARANA' | 'SOLAR_WINDOW' | 'PERSONAL' | 'ACTIVITY';
  polarity: 'SUPPORT' | 'CAUTION' | 'BLOCK';
  impact?: number;
  /** Canonical-ish value the reason is about (a nakshatra/tithi/yoga/karana
   * name, a SolarWindowType, an element, etc.) — see muhurtaReasonFormat.ts
   * for which raw Panchang strings are not yet true canonical IDs. */
  value?: string;
  params?: Record<string, string | number | boolean>;
}

/**
 * Reverse adapter for the free-text fallback path: when a task doesn't match
 * any catalog activity, the existing title-regex classifier
 * (classifyMuhurtaActivity) still runs unchanged and returns a
 * MuhurtaActivityFamily. This maps that legacy family back to a
 * (family, intent) pair so the fallback path can still produce a
 * MuhurtaClassification-shaped result for anything that wants one — without
 * touching the classifier itself or its callers.
 */
const LEGACY_FAMILY_TO_INTENT: Record<MuhurtaActivityFamily, MuhurtaIntent> = {
  DEEP_WORK: 'DEEP_WORK',
  FOCUSED_WORK: 'DEEP_WORK',
  WORKOUT: 'WORKOUT',
  LEARNING: 'STUDY',
  MEDITATION: 'MEDITATION',
  RELATIONSHIP: 'DATE',
  JOURNEY_START: 'JOURNEY_START',
  SOCIAL: 'PARTY',
  MEAL: 'GENERAL',
  FINANCE: 'IMPORTANT_FINANCIAL_DECISION',
  NEW_BEGINNING: 'PROJECT_START',
  ADMIN: 'ADMIN',
  WELLBEING: 'RECOVERY',
};

export function legacyFamilyToIntent(family: MuhurtaActivityFamily): MuhurtaIntent {
  return LEGACY_FAMILY_TO_INTENT[family] ?? 'GENERAL';
}

export function familyForIntent(intent: MuhurtaIntent): MuhurtaFamily {
  return INTENT_FAMILY[intent] ?? 'ROUTINE';
}