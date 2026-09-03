/**
 * Canonical ActivityDefinition model.
 *
 * This maps every activity already in FULL_ACTIVITY_CATALOG (personalizedTasks.ts)
 * to explicit Muhurta metadata (family, intent, evaluation depth, timing
 * sensitivity, social mode), so known activities no longer need to go
 * through title-regex classification to get a Muhurta family — see
 * resolveActivityDefinition() below for the full known-vs-fallback flow.
 *
 * This file is purely additive: nothing here is imported by the existing
 * planner/daily-assistant/Ask Aura code paths yet, so it changes no current
 * behavior. It's the foundation described in the brief for future PRs to
 * build on incrementally.
 */

import {
  familyForIntent,
  legacyFamilyToIntent,
  MuhurtaClassification,
  MuhurtaFamily,
  MuhurtaIntent,
  SocialMode,
  TimingSensitivity,
} from '../../muhurta/src/activityOntology';
import { classifyMuhurtaActivity, MuhurtaActivityFamily } from '../../muhurta/src/muhurtaEngine';
import { familyForActivityProfile } from './auraFitEngine';
import {
  ActivityCategory,
  ActivityProfile,
  FULL_ACTIVITY_CATALOG,
  findActivityIntent,
} from './personalizedTasks';

/**
 * CANONICAL: a stable, single-purpose mapping — safe to offer as a primary
 * user-facing activity and to build future features on directly.
 * AMBIGUOUS: the mapping is a reasonable interim choice, but the underlying
 * activity genuinely spans more than one intent (see `notes`) and is a
 * candidate to be split into narrower activities later.
 * LEGACY_ALIAS: kept only for backward compatibility with the existing
 * catalog entry. Should not be offered as a primary/generic activity once
 * more specific options exist for whatever the user actually means.
 */
export type ActivityStatus = 'CANONICAL' | 'AMBIGUOUS' | 'LEGACY_ALIAS';

/**
 * Product Structure V2 -- the small "what can the PRODUCT do with this
 * activity" layer the brief asks for, kept deliberately separate from
 * `muhurta` (MuhurtaClassification is a Muhurta-domain/engine concept;
 * `experience` is a Plan/Moment/UI concept that happens to be derivable
 * from it). Every field here is computed from existing metadata in
 * buildActivityDefinition() below -- nothing here is a second source of
 * truth for family/intent/socialMode/significance/evaluationDepth.
 */
export type PlanningMode = 'EVERYDAY' | 'IMPORTANT' | 'CEREMONIAL';

/**
 * Good Right Now Actions V1 -- the canonical "what does tapping this
 * activity actually do right now" behavior (brief section 2/3), replacing
 * Home's previous "every card routes to Plan" behavior with intentional
 * per-activity semantics:
 *   LOG_NOW   -- effectively instantaneous (hydration, tea/coffee, a quick
 *                check-in). One tap, immediately logged, no duration choice.
 *   START_NOW -- has real duration but can be done immediately (Deep Work,
 *                Workout, a short walk). Logs a start-now entry using the
 *                activity's own default/suggested duration -- see
 *                HomeDashboard's GoodRightNowCard for why this app has no
 *                running-session/timer model to log an *actual* duration.
 *   PLAN      -- future-oriented or occasion-like (Date Night, Griha
 *                Pravesh); routes into the existing Plan flow, unchanged.
 *   BOTH      -- can be started immediately OR planned for later (Deep
 *                Work, Workout, Learning) -- the UI offers START_NOW as the
 *                primary action with a small "Plan for later" secondary.
 */
export type ImmediateAction = 'LOG_NOW' | 'START_NOW' | 'PLAN' | 'BOTH';

/**
 * Good Right Now Action Semantics V1 -- HOW an immediate log's duration is
 * determined, orthogonal to ImmediateAction (WHICH action is offered):
 *   INSTANT       -- effectively zero elapsed time (a hydration check). Logs
 *                    durationMinutes = 0, never a manufactured placeholder.
 *   FIXED         -- a real but non-negotiable duration, read from the
 *                    catalog's own defaultDurationMinutes (Tea Break, a
 *                    light stretch) -- never hardcoded in the UI layer.
 *   USER_SELECTED -- has real, meaningfully-variable duration (Deep Work,
 *                    Workout, Learning). Home shows a lightweight duration
 *                    picker built from the catalog's own suggestedDurations
 *                    before logging -- still no timer, just a choice made
 *                    up front and logged immediately.
 *   SESSION       -- architecture-only in this PR (brief section 7): the
 *                    eventual "Start -> running -> Done -> actual elapsed
 *                    duration logged" flow this app has no timer model for
 *                    yet. Not selected by any current activity's mapping;
 *                    exists so a future PR has a real value to switch on
 *                    instead of inventing a new field then.
 * Only meaningful when immediateAction is LOG_NOW/START_NOW/BOTH -- a PLAN-
 * only activity's durationMode is never read by anything (brief section 3:
 * "durationMode should not alter planning behavior").
 */
export type ActivityDurationMode = 'INSTANT' | 'FIXED' | 'USER_SELECTED' | 'SESSION';

/**
 * A real-world clock-time-of-day convention, entirely independent of the
 * Panchang solar windows (BRAHMA/ABHIJIT/GULIKA/NEUTRAL/RAHU_KALAM/YAMA)
 * used for astrological favorability. Those solar windows are NOT tied to
 * a fixed time of day -- GULIKA/RAHU_KALAM/YAMA each rotate to a different
 * eighth of daylight depending on the weekday (see
 * packages/panchang/src/windows.ts's own segment tables), and NEUTRAL
 * covers whatever's left, which is most of any day. So an activity whose
 * only constraint is "GULIKA or NEUTRAL" (e.g. Date Night) is astrologically
 * satisfied just as often at 10am as at 8pm -- there was previously no
 * signal anywhere that a date night, family dinner, or dinner with friends
 * should actually happen in the evening. This is that signal: an optional,
 * hand-authored real-world convention consumed by runTimingSearch's FIND
 * mode (timingSearch.ts) as the default `timePreference` when the caller
 * doesn't explicitly ask for a different time of day. Only set where a
 * mismatched time would be genuinely wrong by social convention, never for
 * an activity where "any time" is honestly fine (e.g. Coffee/Tea, Catch Up).
 */
export type ActivityTimeOfDayPreference = 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NIGHT';

export interface ActivityExperience {
  /** Whether this activity is offered as a Plan/Muhurtham RESULT the user
   * can turn into an AuraMoment (brief section 3: "An Aura Moment is a
   * selected time the user intends to do/share"). False for the original
   * task-1..7 daily-assistant playbook cards (Home's contextual "what to do
   * with this window" suggestions, never searched for or shared as an
   * occasion) -- true for everything in the actual activity catalog
   * (EXTENDED_ACTIVITY_CATALOG), including every new everyday activity. */
  momentEligible: boolean;
  /** CEREMONIAL when evaluationDepth is CEREMONIAL; IMPORTANT when DEEP;
   * EVERYDAY when LIGHT or STANDARD -- exactly the depth tiers Muhurtham
   * Finder eligibility (muhurthamFinder.ts's isMuhurthamEligible) already
   * keys off, so this can never drift from what Finder actually exposes. */
  planningMode: PlanningMode;
  defaultDurationMinutes?: number;
  suggestedDurations?: number[];
  /** See ImmediateAction's own doc comment above for the four values.
   * Hand-authored per activity in ACTIVITY_METADATA below (or computed by
   * defaultImmediateActionFor() for any future catalog entry with no
   * explicit override) -- never inferred from title text at render time. */
  immediateAction: ImmediateAction;
  /** See ActivityDurationMode's own doc comment above. Hand-authored per
   * activity in ACTIVITY_METADATA below (or computed by
   * defaultDurationModeFor() for any future catalog entry with no explicit
   * override) -- never inferred from title text at render time. */
  durationMode: ActivityDurationMode;
  /** See ActivityTimeOfDayPreference's own doc comment above. Undefined
   * (the overwhelming majority of activities) means no real-world
   * time-of-day convention -- purely astrological/opening-based timing,
   * unchanged from before this field existed. */
  timeOfDayPreference?: ActivityTimeOfDayPreference;
}

export interface ActivityDefinition {
  id: string;
  category: ActivityCategory;
  muhurta: MuhurtaClassification;
  socialMode: SocialMode;
  experience: ActivityExperience;
  aliases: string[];
  status: ActivityStatus;
  /** Present when status is not CANONICAL — explains the ambiguity or why
   * this is a legacy alias, for anyone building on top of this model. */
  notes?: string;
  /** True for a broad, historically-generic activity (financial-decision,
   * new-beginning) that now has one or more narrower, more specific sibling
   * activities (property-purchase, business-start, ...). Not the same as
   * LEGACY_ALIAS status: these activities remain CANONICAL and fully
   * supported for the cases their narrower siblings don't cover — this flag
   * only signals "prefer a narrower activity when one resolves" (brief
   * section 11), it does not deprecate the broad activity itself. */
  legacyBroadIntent?: boolean;
}

/**
 * Hand-authored metadata per catalog activity id. Deliberately does NOT
 * include `legacyFamily` — that's always derived live from
 * familyForActivityProfile(activity) below, so it's impossible for this
 * table to drift out of sync with the family the existing scoring engine
 * actually uses today.
 *
 * `significance` is likewise not repeated here — it's read directly from
 * the activity's own `significance` field (reusing existing metadata rather
 * than duplicating it, and guaranteeing no behavior change).
 *
 * See the completion report for activities whose family/intent mapping is
 * genuinely ambiguous (New Beginning, Financial Decision, High-Stakes
 * Decision or Pitch).
 *
 * Good Right Now Actions V1 also added `immediateAction` here for every
 * entry -- see the completion report for the handful genuinely ambiguous
 * between BOTH and PLAN (Walk Together, Catch Up).
 */
type ActivityMetadataInput = {
  family: MuhurtaFamily;
  intent: MuhurtaIntent;
  evaluationDepth: MuhurtaClassification['evaluationDepth'];
  timingSensitivity: TimingSensitivity;
  socialMode: SocialMode;
  immediateAction?: ImmediateAction;
  durationMode?: ActivityDurationMode;
  /** Overrides activity.significance when the catalog's existing value is a
   * poor proxy for genuine Muhurta significance (see 'workout' below for
   * why this exists). Omit to reuse activity.significance as-is. */
  significance?: 'LOW' | 'MEDIUM' | 'HIGH';
  status?: ActivityStatus;
  notes?: string;
  legacyBroadIntent?: boolean;
  /** A curated set of durations this activity is commonly done in, offered
   * as quick-pick chips in Plan instead of a bare duration input. Omit to
   * fall back to a single defaultDurationMinutes (or the generic default). */
  suggestedDurations?: number[];
  /** See ActivityTimeOfDayPreference's own doc comment. Omit for anything
   * where any time of day is genuinely fine. */
  timeOfDayPreference?: ActivityTimeOfDayPreference;
};

/** planningMode is entirely a function of evaluationDepth -- see
 * ActivityExperience's own doc comment for why these three tiers exactly
 * mirror the depth tiers Muhurtham Finder eligibility already keys off. */
function planningModeForDepth(evaluationDepth: MuhurtaClassification['evaluationDepth']): PlanningMode {
  if (evaluationDepth === 'CEREMONIAL') return 'CEREMONIAL';
  if (evaluationDepth === 'DEEP') return 'IMPORTANT';
  return 'EVERYDAY';
}

/** task-1..7 are Home's daily-assistant playbook cards (see
 * getPersonalizedTasks() in personalizedTasks.ts) -- contextual "what to do
 * with this window" nudges, never searched for via Plan's activity picker
 * or turned into a shareable occasion. Everything else in the catalog
 * (EXTENDED_ACTIVITY_CATALOG) is momentEligible. */
function isMomentEligible(activityId: string): boolean {
  return !activityId.startsWith('task-');
}

const ACTIVITY_METADATA: Record<string, ActivityMetadataInput> = {
  // -- ACTIVITY_CATALOG (task-1..task-7) --
  'task-1': {
    // "High-Stakes Decision or Pitch" spans decision-making AND pitching —
    // PRESENTATION alone misclassified half the title. IMPORTANT_DECISION is
    // the broader interim intent; PITCH is reserved for when this activity
    // is split into two.
    family: 'WORK',
    intent: 'IMPORTANT_DECISION',
    evaluationDepth: 'DEEP',
    timingSensitivity: { start: 'HIGH', duration: 'MEDIUM', end: 'LOW' },
    socialMode: 'GROUP',
    status: 'AMBIGUOUS',
    notes: 'Spans decision-making and pitching. Candidate to split into IMPORTANT_DECISION and PITCH activities; IMPORTANT_DECISION used as the interim broader intent.',
    immediateAction: 'PLAN',
  },
  'task-2': {
    // "Sprint Backlog Execution"
    family: 'WORK',
    intent: 'DEEP_WORK',
    evaluationDepth: 'STANDARD',
    timingSensitivity: { start: 'MEDIUM', duration: 'MEDIUM', end: 'LOW' },
    socialMode: 'SOLO',
    immediateAction: 'BOTH',
  },
  'task-3': {
    // "Breathwork & Strategic Visioning" — MEDITATION captures the
    // breathwork half but not the strategic-visioning half. Acceptable
    // interim mapping only because the primary recommendation purpose
    // (per its description) is the breathwork/intention-setting, not
    // planning. Candidate to split later.
    family: 'HEALTH',
    intent: 'MEDITATION',
    evaluationDepth: 'LIGHT',
    timingSensitivity: { start: 'LOW', duration: 'LOW', end: 'LOW' },
    socialMode: 'SOLO',
    status: 'AMBIGUOUS',
    notes: 'Spans breathwork (MEDITATION) and strategic visioning (reserved STRATEGIC_PLANNING intent). Candidate to split into two activities later.',
    immediateAction: 'START_NOW',
    // FIXED, not USER_SELECTED: a quick grounding/breathwork moment, not a
    // meaningfully variable-length session -- see personalizedTasks.ts's
    // defaultDurationMinutes: 10 on this same catalog entry.
    durationMode: 'FIXED',
  },
  'task-4': {
    // "Deep Architecture & Writing"
    family: 'WORK',
    intent: 'DEEP_WORK',
    evaluationDepth: 'STANDARD',
    timingSensitivity: { start: 'MEDIUM', duration: 'MEDIUM', end: 'LOW' },
    socialMode: 'SOLO',
    immediateAction: 'BOTH',
  },
  'task-5': {
    // "Process Optimization & Docs"
    family: 'ROUTINE',
    intent: 'ADMIN',
    evaluationDepth: 'LIGHT',
    timingSensitivity: { start: 'LOW', duration: 'LOW', end: 'LOW' },
    socialMode: 'SOLO',
    immediateAction: 'START_NOW',
  },
  'task-6': {
    // "Active Rest & Hydration Check" -- Good Right Now Actions V1 reuses
    // this EXISTING id for Home's "Hydration check" card (see
    // actionCards.ts) rather than adding a new catalog entry for the same
    // concept.
    family: 'HEALTH',
    intent: 'RECOVERY',
    evaluationDepth: 'LIGHT',
    timingSensitivity: { start: 'LOW', duration: 'LOW', end: 'LOW' },
    socialMode: 'SOLO',
    immediateAction: 'LOG_NOW',
    // INSTANT: a hydration/posture check is effectively zero elapsed time --
    // never a manufactured placeholder duration (brief section 4).
    durationMode: 'INSTANT',
  },
  'task-7': {
    // "Light Stretch & Mobility" -- reused by Good Right Now Actions V1 for
    // Home's "Short walk or stretch" card (see actionCards.ts).
    family: 'HEALTH',
    intent: 'RECOVERY',
    evaluationDepth: 'LIGHT',
    timingSensitivity: { start: 'LOW', duration: 'LOW', end: 'LOW' },
    socialMode: 'SOLO',
    immediateAction: 'START_NOW',
    // FIXED -- see personalizedTasks.ts's defaultDurationMinutes: 10 on
    // this same catalog entry.
    durationMode: 'FIXED',
  },

  // -- EXTENDED_ACTIVITY_CATALOG --
  'start-journey': {
    family: 'TRAVEL',
    intent: 'JOURNEY_START',
    evaluationDepth: 'DEEP',
    timingSensitivity: { start: 'HIGH', duration: 'MEDIUM', end: 'LOW' },
    socialMode: 'ANY',
    immediateAction: 'PLAN',
  },
  'deep-work': {
    family: 'WORK',
    intent: 'DEEP_WORK',
    evaluationDepth: 'STANDARD',
    timingSensitivity: { start: 'MEDIUM', duration: 'MEDIUM', end: 'LOW' },
    socialMode: 'SOLO',
    immediateAction: 'BOTH',
    // USER_SELECTED: real, meaningfully-variable duration -- Home shows a
    // lightweight picker built from these exact values before logging
    // (brief section 6), never a timer.
    durationMode: 'USER_SELECTED',
    suggestedDurations: [30, 60, 90],
  },
  workout: {
    // The catalog's own `significance: 'HIGH'` reflects planner priority,
    // not Muhurta importance — a routine workout doesn't deserve the same
    // timing-importance class as a journey, investment, or project start.
    // Overridden to MEDIUM here, decoupled from the catalog field.
    family: 'HEALTH',
    intent: 'WORKOUT',
    evaluationDepth: 'STANDARD',
    timingSensitivity: { start: 'LOW', duration: 'MEDIUM', end: 'LOW' },
    socialMode: 'SOLO',
    significance: 'MEDIUM',
    immediateAction: 'BOTH',
    durationMode: 'USER_SELECTED',
    suggestedDurations: [30, 45, 60],
  },
  'tea-break': {
    // Kept under HEALTH/RECOVERY for now; candidate to move to a future
    // ROUTINE/BREAK-style concept. Should not invoke meaningful Muhurta
    // logic either way, hence LIGHT depth and all-LOW timing sensitivity.
    family: 'HEALTH',
    intent: 'RECOVERY',
    evaluationDepth: 'LIGHT',
    timingSensitivity: { start: 'LOW', duration: 'LOW', end: 'LOW' },
    socialMode: 'ANY',
    notes: 'Candidate to move to a future REST_ROUTINE / BREAK concept distinct from HEALTH.',
    immediateAction: 'LOG_NOW',
    // FIXED -- see personalizedTasks.ts's defaultDurationMinutes: 10 on
    // this same catalog entry (brief section 5's own worked example).
    durationMode: 'FIXED',
  },
  dating: {
    family: 'RELATIONSHIP',
    intent: 'DATE',
    evaluationDepth: 'STANDARD',
    timingSensitivity: { start: 'MEDIUM', duration: 'LOW', end: 'LOW' },
    socialMode: 'PAIR',
    immediateAction: 'PLAN',
  },
  party: {
    family: 'SOCIAL',
    intent: 'PARTY',
    evaluationDepth: 'LIGHT',
    timingSensitivity: { start: 'LOW', duration: 'LOW', end: 'LOW' },
    socialMode: 'GROUP',
    immediateAction: 'PLAN',
  },
  'financial-decision': {
    // Aliases span investment, contract signing, and loans (property
    // purchase now has its own dedicated activity — see property-purchase
    // below). INVESTMENT was too specific — IMPORTANT_FINANCIAL_DECISION is
    // the broader intent that actually covers what this catalog entry means.
    family: 'FINANCE',
    intent: 'IMPORTANT_FINANCIAL_DECISION',
    evaluationDepth: 'DEEP',
    timingSensitivity: { start: 'HIGH', duration: 'LOW', end: 'LOW' },
    socialMode: 'ANY',
    legacyBroadIntent: true,
    notes: 'Remains CANONICAL and fully supported for financial decisions generally (investment, contract signing, loans). Prefer property-purchase when the more specific PROPERTY_PURCHASE intent resolves (brief section 11).',
    immediateAction: 'PLAN',
  },
  'new-beginning': {
    // Deliberately generic in the existing catalog (new project, habit,
    // role, or chapter). WORK/PROJECT_START is a reasonable
    // backward-compatible mapping, but this is too broad to be a canonical
    // activity — marked LEGACY_ALIAS so it's not offered as a primary
    // generic activity once more specific options (business-start,
    // griha-pravesh, engagement, etc.) exist.
    family: 'WORK',
    intent: 'PROJECT_START',
    evaluationDepth: 'DEEP',
    timingSensitivity: { start: 'HIGH', duration: 'LOW', end: 'LOW' },
    socialMode: 'ANY',
    status: 'LEGACY_ALIAS',
    legacyBroadIntent: true,
    notes: 'Too broad for a canonical activity (could mean a business, home, relationship, or generic project start). Kept as a backward-compatible alias to WORK/PROJECT_START; prefer business-start/griha-pravesh/engagement when one of those more specific intents resolves (brief section 11).',
    immediateAction: 'PLAN',
  },
  learning: {
    family: 'EDUCATION',
    intent: 'STUDY',
    evaluationDepth: 'STANDARD',
    timingSensitivity: { start: 'LOW', duration: 'MEDIUM', end: 'LOW' },
    socialMode: 'SOLO',
    immediateAction: 'BOTH',
    durationMode: 'USER_SELECTED',
    suggestedDurations: [20, 30, 60],
  },

  // -- New explicit occasion activities (see personalizedTasks.ts and the
  // completion report's rule coverage matrix for the audit these are based
  // on) --
  'business-start': {
    family: 'BUSINESS',
    intent: 'BUSINESS_START',
    evaluationDepth: 'DEEP',
    timingSensitivity: { start: 'HIGH', duration: 'MEDIUM', end: 'LOW' },
    socialMode: 'ANY',
    notes: 'Tithi/Nakshatra reuse NEW_BEGINNING\'s existing family-level rule data as a base (see muhurtaRulePacks.ts FAMILY_BASE_SOURCE) -- new-beginning\'s own notes already name BUSINESS_START as one of the narrower intents that data was standing in for. REUSABLE_BASE_RULE, not invented.',
    immediateAction: 'PLAN',
  },
  'property-purchase': {
    family: 'FINANCE',
    intent: 'PROPERTY_PURCHASE',
    evaluationDepth: 'DEEP',
    timingSensitivity: { start: 'HIGH', duration: 'LOW', end: 'LOW' },
    socialMode: 'ANY',
    notes: 'Tithi/Nakshatra reuse FINANCE\'s existing family-level rule data as a base -- financial-decision\'s own aliases already included "property purchase" before this PR split it out. REUSABLE_BASE_RULE, a strong-fit reuse.',
    immediateAction: 'PLAN',
  },
  engagement: {
    family: 'RELATIONSHIP',
    intent: 'ENGAGEMENT',
    evaluationDepth: 'CEREMONIAL',
    timingSensitivity: { start: 'HIGH', duration: 'MEDIUM', end: 'LOW' },
    socialMode: 'PAIR',
    notes: 'CEREMONIAL depth requires dedicated (IMPLEMENTED) Tithi/Nakshatra coverage to reach SUPPORTED (brief section 8). Currently only has RELATIONSHIP\'s family-level base (authored for casual dating, not a ceremonial engagement) -- REUSABLE_BASE_RULE, not sufficient evidence on its own, so this resolves to PARTIAL support and is hidden from Muhurtham Finder until dedicated data is added.',
    immediateAction: 'PLAN',
  },
  'griha-pravesh': {
    family: 'HOME',
    intent: 'GRIHA_PRAVESH',
    evaluationDepth: 'CEREMONIAL',
    timingSensitivity: { start: 'HIGH', duration: 'MEDIUM', end: 'LOW' },
    socialMode: 'FAMILY',
    notes: 'Has its own dedicated (IMPLEMENTED) Tithi/Nakshatra rule pack -- see GRIHA_PRAVESH in muhurtaRulePacks.ts, sourced from multi-source web research (August 2026) -- rather than a borrowed family base (HOME has no generic MuhurtaRulePack base). Resolves to SUPPORTED and is exposed in Muhurtham Finder.',
    immediateAction: 'PLAN',
  },
  // Marriage Muhurtham Foundation V1 (PR A): has its own dedicated
  // (IMPLEMENTED) Tithi/Nakshatra/Yoga/Karana rule pack -- see MARRIAGE in
  // muhurtaRulePacks.ts, sourced independently from Griha Pravesh. Despite
  // that dedicated coverage, computeMuhurtaSupportLevel() still resolves
  // this to PARTIAL (not SUPPORTED) because the pack declares
  // requiresPeriodExclusion/requiresPlanetaryCombustion, and neither
  // whole-month exclusion (Chaturmas/Kharmas/Adhika Masa) nor planetary
  // combustion (Guru/Shukra Asta) eligibility exists anywhere in this
  // engine yet -- that is PR B's job. Marriage is therefore intentionally
  // NOT exposed in Muhurtham Finder (SUPPORTED_MUHURTHAM_ACTIVITY_IDS) by
  // this same canonical mechanism, not a UI-level check -- see
  // test/marriageMuhurthamFoundation.test.ts's own gating regression.
  marriage: {
    family: 'RELATIONSHIP',
    intent: 'MARRIAGE',
    evaluationDepth: 'CEREMONIAL',
    timingSensitivity: { start: 'HIGH', duration: 'MEDIUM', end: 'LOW' },
    socialMode: 'PAIR',
    notes: 'Has its own dedicated (IMPLEMENTED) Tithi/Nakshatra/Yoga/Karana rule pack (see MARRIAGE in muhurtaRulePacks.ts), but remains PARTIAL/hidden from Muhurtham Finder until whole-month/period exclusion and planetary-combustion (Guru/Shukra Asta) eligibility are added -- see requiresPeriodExclusion/requiresPlanetaryCombustion on that rule pack and computeMuhurtaSupportLevel(). Deliberately not yet reachable via Ask Aura free-text routing either -- see personalizedTasks.ts\'s catalog entry for why its aliases list is empty in this PR.',
    immediateAction: 'PLAN',
  },

  // -- Product Structure V2: everyday moments -- every entry below is
  // LIGHT or STANDARD depth, NEVER DEEP/CEREMONIAL, which is what actually
  // keeps them out of Muhurtham Finder's SUPPORTED_MUHURTHAM_ACTIVITY_IDS
  // (isMuhurthamEligible requires DEEP/CEREMONIAL -- see
  // test/activityCatalogEveryday.test.ts). timingSensitivity.start is
  // MEDIUM (not HIGH) for the STANDARD social/family/celebration entries --
  // catching people at a good time matters somewhat, but not with a
  // ceremonial occasion's commencement-instant precision -- and HIGH only
  // for road-trip/day-trip, which (like start-journey) genuinely have a
  // "departure moment."
  //
  // Good Right Now Actions V1: every entry below is immediateAction PLAN --
  // each one is inherently CONNECT-natured (needs another person's time
  // coordinated, or is a dedicated outing) rather than an instantaneous
  // solo action. walk-together and catch-up have their immediateAction
  // choice flagged as genuinely debatable in the completion report (see
  // their own inline comments below) -- NOT the same thing as this file's
  // `status: 'AMBIGUOUS'` (that axis is reserved for family/intent
  // classification ambiguity): both are LIGHT/short enough that
  // START_NOW/BOTH reads plausibly if the other person is already present,
  // but PLAN was kept as the safer default since neither can assume that.
  // Home Compactness follow-up ("evening slots showing up in the
  // morning/afternoon") -- these activities are evening/dinner/night
  // occasions by real-world convention, but their recommendedWindowTypes
  // (personalizedTasks.ts) is only GULIKA/NEUTRAL -- Panchang solar
  // windows that rotate to a different eighth of daylight per weekday
  // (GULIKA) or cover most of the day outright (NEUTRAL), so nothing
  // previously kept these off a 10am slot. timeOfDayPreference is the
  // real-world-clock-time signal that was missing; runTimingSearch's FIND
  // mode (timingSearch.ts) now uses it as the default `timePreference`
  // whenever the caller doesn't explicitly ask for a different time of
  // day. `walk-together` is deliberately NOT given one here even though
  // it's used for an "evening walk" in these same RELATIONSHIPS/SOCIAL
  // contexts -- this same catalog entry also serves the SELF taxonomy
  // group's daytime/workout-adjacent "Walk" (dailyIntentions.ts), so a
  // blanket EVENING default here would wrongly constrain that morning
  // use too. It's instead resolved per-suggestion in
  // dayBuilderOrchestrator.ts, keyed on which taxonomy group the
  // suggestion actually came from.
  'date-night': { family: 'RELATIONSHIP', intent: 'DATE', evaluationDepth: 'STANDARD', timingSensitivity: { start: 'MEDIUM', duration: 'LOW', end: 'LOW' }, socialMode: 'PAIR', suggestedDurations: [90, 120, 150], immediateAction: 'PLAN', timeOfDayPreference: 'EVENING' },
  'dinner-date': { family: 'RELATIONSHIP', intent: 'DATE', evaluationDepth: 'STANDARD', timingSensitivity: { start: 'MEDIUM', duration: 'LOW', end: 'LOW' }, socialMode: 'PAIR', suggestedDurations: [60, 90, 120], immediateAction: 'PLAN', timeOfDayPreference: 'EVENING' },
  'coffee-tea': { family: 'SOCIAL', intent: 'CASUAL_HANGOUT', evaluationDepth: 'LIGHT', timingSensitivity: { start: 'LOW', duration: 'LOW', end: 'LOW' }, socialMode: 'ANY', suggestedDurations: [30, 45, 60], immediateAction: 'PLAN' },
  'movie-night': { family: 'SOCIAL', intent: 'CASUAL_HANGOUT', evaluationDepth: 'LIGHT', timingSensitivity: { start: 'LOW', duration: 'LOW', end: 'LOW' }, socialMode: 'ANY', suggestedDurations: [120, 150, 180], immediateAction: 'PLAN', timeOfDayPreference: 'EVENING' },
  'walk-together': { family: 'SOCIAL', intent: 'CASUAL_HANGOUT', evaluationDepth: 'LIGHT', timingSensitivity: { start: 'LOW', duration: 'LOW', end: 'LOW' }, socialMode: 'ANY', suggestedDurations: [30, 45, 60], immediateAction: 'PLAN' }, // immediateAction ambiguous (not a MuhurtaClassification/status-level ambiguity): PLAN was chosen as the safer default, but a walk together is short enough that START_NOW/BOTH is plausible when the other person is already present -- flagged in the Good Right Now Actions V1 completion report, not promoted to `status: AMBIGUOUS` (that axis is reserved for family/intent classification ambiguity, a different concern). No timeOfDayPreference here -- see the block comment above.
  'family-dinner': { family: 'SOCIAL', intent: 'FAMILY_GATHERING', evaluationDepth: 'STANDARD', timingSensitivity: { start: 'MEDIUM', duration: 'LOW', end: 'LOW' }, socialMode: 'FAMILY', suggestedDurations: [60, 90, 120], immediateAction: 'PLAN', timeOfDayPreference: 'EVENING' },
  'family-outing': { family: 'SOCIAL', intent: 'FAMILY_GATHERING', evaluationDepth: 'STANDARD', timingSensitivity: { start: 'MEDIUM', duration: 'LOW', end: 'LOW' }, socialMode: 'FAMILY', suggestedDurations: [120, 180, 240], immediateAction: 'PLAN' },
  'visit-family': { family: 'SOCIAL', intent: 'FAMILY_GATHERING', evaluationDepth: 'STANDARD', timingSensitivity: { start: 'MEDIUM', duration: 'LOW', end: 'LOW' }, socialMode: 'FAMILY', suggestedDurations: [60, 90, 120], immediateAction: 'PLAN' },
  'family-movie-night': { family: 'SOCIAL', intent: 'FAMILY_GATHERING', evaluationDepth: 'LIGHT', timingSensitivity: { start: 'LOW', duration: 'LOW', end: 'LOW' }, socialMode: 'FAMILY', suggestedDurations: [120, 150, 180], immediateAction: 'PLAN', timeOfDayPreference: 'EVENING' },
  'dinner-with-friends': { family: 'SOCIAL', intent: 'CASUAL_HANGOUT', evaluationDepth: 'STANDARD', timingSensitivity: { start: 'MEDIUM', duration: 'LOW', end: 'LOW' }, socialMode: 'GROUP', suggestedDurations: [90, 120, 150], immediateAction: 'PLAN', timeOfDayPreference: 'EVENING' },
  'catch-up': { family: 'SOCIAL', intent: 'CASUAL_HANGOUT', evaluationDepth: 'LIGHT', timingSensitivity: { start: 'LOW', duration: 'LOW', end: 'LOW' }, socialMode: 'PAIR', suggestedDurations: [45, 60, 90], immediateAction: 'PLAN' }, // immediateAction ambiguous: PLAN was chosen as the safer default, but a spontaneous catch-up is short enough that START_NOW/BOTH is plausible -- flagged in the Good Right Now Actions V1 completion report, not promoted to `status: AMBIGUOUS`.
  'game-night': { family: 'SOCIAL', intent: 'CASUAL_HANGOUT', evaluationDepth: 'LIGHT', timingSensitivity: { start: 'LOW', duration: 'LOW', end: 'LOW' }, socialMode: 'GROUP', suggestedDurations: [120, 150, 180], immediateAction: 'PLAN', timeOfDayPreference: 'EVENING' },
  'birthday-party': { family: 'SOCIAL', intent: 'CELEBRATION', evaluationDepth: 'STANDARD', timingSensitivity: { start: 'MEDIUM', duration: 'LOW', end: 'LOW' }, socialMode: 'GROUP', suggestedDurations: [120, 180, 240], immediateAction: 'PLAN' },
  'anniversary-dinner': { family: 'RELATIONSHIP', intent: 'DATE', evaluationDepth: 'STANDARD', timingSensitivity: { start: 'MEDIUM', duration: 'LOW', end: 'LOW' }, socialMode: 'PAIR', suggestedDurations: [90, 120, 150], immediateAction: 'PLAN', timeOfDayPreference: 'EVENING' },
  'celebration-dinner': { family: 'SOCIAL', intent: 'CELEBRATION', evaluationDepth: 'STANDARD', timingSensitivity: { start: 'MEDIUM', duration: 'LOW', end: 'LOW' }, socialMode: 'GROUP', suggestedDurations: [90, 120, 150], immediateAction: 'PLAN', timeOfDayPreference: 'EVENING' },
  'road-trip': { family: 'TRAVEL', intent: 'OUTING', evaluationDepth: 'STANDARD', timingSensitivity: { start: 'HIGH', duration: 'MEDIUM', end: 'LOW' }, socialMode: 'ANY', suggestedDurations: [240, 360, 480], notes: 'Distinct from start-journey (IMPORTANT/DEEP): a casual weekend road trip, not an important journey or relocation.', immediateAction: 'PLAN' },
  'day-trip': { family: 'TRAVEL', intent: 'OUTING', evaluationDepth: 'STANDARD', timingSensitivity: { start: 'HIGH', duration: 'MEDIUM', end: 'LOW' }, socialMode: 'ANY', suggestedDurations: [240, 300, 360], immediateAction: 'PLAN' },
  picnic: { family: 'TRAVEL', intent: 'OUTING', evaluationDepth: 'LIGHT', timingSensitivity: { start: 'LOW', duration: 'LOW', end: 'LOW' }, socialMode: 'ANY', suggestedDurations: [90, 120, 150], immediateAction: 'PLAN' },
  'shopping-trip': { family: 'TRAVEL', intent: 'OUTING', evaluationDepth: 'LIGHT', timingSensitivity: { start: 'LOW', duration: 'LOW', end: 'LOW' }, socialMode: 'ANY', suggestedDurations: [60, 90, 120], immediateAction: 'PLAN' },
  // My Day V1 -- MEDITATION already existed as a reserved MuhurtaIntent
  // (stood in for task-3's classification, see the comment on MuhurtaIntent
  // itself) but had no real, shareable catalog activity using it; this is
  // the first one. socialMode ANY: solo meditation and a shared quiet
  // session are both plausible, no reason to force one.
  meditation: { family: 'HEALTH', intent: 'MEDITATION', evaluationDepth: 'LIGHT', timingSensitivity: { start: 'LOW', duration: 'LOW', end: 'LOW' }, socialMode: 'ANY', immediateAction: 'BOTH', durationMode: 'USER_SELECTED', suggestedDurations: [10, 20, 30] },
  'quiet-time': { family: 'SOCIAL', intent: 'CASUAL_HANGOUT', evaluationDepth: 'LIGHT', timingSensitivity: { start: 'LOW', duration: 'LOW', end: 'LOW' }, socialMode: 'ANY', immediateAction: 'PLAN', durationMode: 'USER_SELECTED', suggestedDurations: [30, 45, 60] },
};

/** Best-effort metadata for a catalog activity with no explicit entry above
 * (future-proofing only — every activity in today's catalog has an explicit
 * entry). Derives family/intent from the existing legacy family so it never
 * throws and never silently invents a family the engine doesn't score. */
function fallbackMetadataFor(activity: ActivityProfile): ActivityMetadataInput {
  const legacyFamily = familyForActivityProfile(activity);
  const intent = legacyFamilyToIntent(legacyFamily);
  return {
    family: familyForIntent(intent),
    intent,
    evaluationDepth: activity.significance === 'HIGH' ? 'DEEP' : activity.significance === 'MEDIUM' ? 'STANDARD' : 'LIGHT',
    timingSensitivity: activity.requiresFreshStart
      ? { start: 'HIGH', duration: 'MEDIUM', end: 'LOW' }
      : { start: 'LOW', duration: 'LOW', end: 'LOW' },
    socialMode: 'ANY',
  };
}

/** Good Right Now Actions V1: only reached for a future catalog activity
 * with no explicit ACTIVITY_METADATA entry above (every activity in
 * today's catalog has one) -- a conservative default, not a classifier.
 * DEEP/CEREMONIAL depth (IMPORTANT/CEREMONIAL planningMode) is inherently
 * future-oriented, so it defaults to PLAN; anything lighter defaults to
 * BOTH (safe since Plan already remains available as the secondary
 * action -- never LOG_NOW/START_NOW-only, which would hide Plan for an
 * activity nobody has actually classified yet). */
function defaultImmediateActionFor(evaluationDepth: MuhurtaClassification['evaluationDepth']): ImmediateAction {
  return evaluationDepth === 'DEEP' || evaluationDepth === 'CEREMONIAL' ? 'PLAN' : 'BOTH';
}

/** Good Right Now Action Semantics V1: only reached for an activity with no
 * explicit durationMode override above -- almost always a PLAN-only
 * activity, for which durationMode is never actually read (brief section
 * 3). Never defaults to INSTANT (that must always be a deliberate,
 * explicit choice -- brief section 4's "do not silently use 5 minutes"
 * extends to "do not silently assume instant" too): a real
 * suggestedDurations list with more than one option means a genuine choice
 * exists (USER_SELECTED); a single defaultDurationMinutes with no options
 * means one fixed value (FIXED); otherwise USER_SELECTED is the safe
 * default, since it never invents a number nobody chose. */
function defaultDurationModeFor(activity: ActivityProfile, metadata: ActivityMetadataInput): ActivityDurationMode {
  if (metadata.suggestedDurations && metadata.suggestedDurations.length > 1) return 'USER_SELECTED';
  if (activity.defaultDurationMinutes) return 'FIXED';
  return 'USER_SELECTED';
}

/**
 * Legacy engine family per definition id — intentionally kept OUT of
 * ActivityDefinition/MuhurtaClassification (see the comment on
 * MuhurtaClassification in activityOntology.ts). This is migration
 * plumbing, not part of the canonical model, so it lives in a private map
 * reachable only through toLegacyMuhurtaFamily() below and can be deleted
 * later without touching the ontology types at all.
 */
const LEGACY_FAMILY_BY_DEFINITION_ID: Record<string, MuhurtaActivityFamily> = {};

function buildActivityDefinition(activity: ActivityProfile): ActivityDefinition {
  const metadata = ACTIVITY_METADATA[activity.id] ?? fallbackMetadataFor(activity);
  // Computed live, not hand-entered — guaranteed to match exactly what
  // evaluateActivityFit()/dailyAssistant already pass into evaluateMuhurta()
  // today, so this introduces zero scoring change.
  LEGACY_FAMILY_BY_DEFINITION_ID[activity.id] = familyForActivityProfile(activity);
  return {
    id: activity.id,
    category: activity.category,
    aliases: activity.aliases,
    socialMode: metadata.socialMode,
    status: metadata.status ?? 'CANONICAL',
    notes: metadata.notes,
    legacyBroadIntent: metadata.legacyBroadIntent,
    muhurta: {
      family: metadata.family,
      intent: metadata.intent,
      significance: metadata.significance ?? activity.significance,
      evaluationDepth: metadata.evaluationDepth,
      timingSensitivity: metadata.timingSensitivity,
    },
    experience: {
      momentEligible: isMomentEligible(activity.id),
      planningMode: planningModeForDepth(metadata.evaluationDepth),
      defaultDurationMinutes: activity.defaultDurationMinutes,
      suggestedDurations: metadata.suggestedDurations,
      immediateAction: metadata.immediateAction ?? defaultImmediateActionFor(metadata.evaluationDepth),
      durationMode: metadata.durationMode ?? defaultDurationModeFor(activity, metadata),
      timeOfDayPreference: metadata.timeOfDayPreference,
    },
  };
}

/** Every catalog activity resolved to its ActivityDefinition, in catalog order. */
export const ACTIVITY_DEFINITIONS: ActivityDefinition[] = FULL_ACTIVITY_CATALOG.map(buildActivityDefinition);

export const ACTIVITY_DEFINITIONS_BY_ID: Record<string, ActivityDefinition> = Object.fromEntries(
  ACTIVITY_DEFINITIONS.map((definition) => [definition.id, definition])
);

/**
 * The backward-compatibility adapter: get the exact MuhurtaActivityFamily
 * the existing engine (evaluateMuhurta/evaluateActivityFit) uses for this
 * activity. This is the ONLY place legacy family should be read from — keep
 * it out of the canonical ActivityDefinition/MuhurtaClassification shape so
 * it can be deleted once every caller has migrated off the legacy engine
 * key, without touching the ontology types themselves.
 */
export function toLegacyMuhurtaFamily(activity: ActivityDefinition): MuhurtaActivityFamily {
  const known = LEGACY_FAMILY_BY_DEFINITION_ID[activity.id];
  if (known) return known;
  // Should not normally happen — every ActivityDefinition this module
  // produces (catalog or fallback) registers itself above. Defensive
  // fallback derives a plausible legacy family from the new family/intent
  // rather than throwing.
  return FAMILY_TO_DEFAULT_LEGACY_FAMILY[activity.muhurta.family] ?? 'FOCUSED_WORK';
}

const FAMILY_TO_DEFAULT_LEGACY_FAMILY: Record<MuhurtaFamily, MuhurtaActivityFamily> = {
  WORK: 'FOCUSED_WORK',
  BUSINESS: 'NEW_BEGINNING',
  FINANCE: 'FINANCE',
  TRAVEL: 'JOURNEY_START',
  RELATIONSHIP: 'RELATIONSHIP',
  HOME: 'ADMIN',
  EDUCATION: 'LEARNING',
  HEALTH: 'WELLBEING',
  SOCIAL: 'SOCIAL',
  ROUTINE: 'ADMIN',
};

/** Look up the ActivityDefinition for a known catalog activity (by id or profile). */
export function getActivityDefinition(activity: ActivityProfile | string): ActivityDefinition | undefined {
  const id = typeof activity === 'string' ? activity : activity.id;
  return ACTIVITY_DEFINITIONS_BY_ID[id];
}

export interface ActivityResolution {
  definition: ActivityDefinition;
  /** CATALOG: matched a known activity via the existing alias matcher.
   *  FALLBACK_CLASSIFIER: no catalog match; classified from free text via
   *  the existing title-regex classifier (unchanged, still the source of
   *  truth for anything outside the catalog). */
  source: 'CATALOG' | 'FALLBACK_CLASSIFIER';
  /** Only set for CATALOG resolutions. */
  activity?: ActivityProfile;
}

/**
 * The known-vs-fallback flow described in the brief:
 *
 *   Known catalog activity -> findActivityIntent() -> explicit ActivityDefinition
 *   Unknown/free-text task -> classifyMuhurtaActivity() -> family + intent (synthesized)
 *
 * This does not replace or call into classifyTask()/buildTaskRecommendation()
 * in dailyAssistant.ts — those keep using their own existing logic untouched.
 * This is a separate, additive entry point for future callers that want an
 * ActivityDefinition-shaped result instead of the planner's TaskProfile shape.
 */
export function resolveActivityDefinition(taskTitle: string): ActivityResolution {
  const activity = findActivityIntent(taskTitle);
  if (activity) {
    return { definition: buildActivityDefinition(activity), source: 'CATALOG', activity };
  }

  const legacyFamily = classifyMuhurtaActivity(taskTitle);
  const intent = legacyFamilyToIntent(legacyFamily);
  const family = familyForIntent(intent);
  const id = `fallback:${legacyFamily.toLowerCase().replace(/_/g, '-')}`;
  // Register in the same private lookup toLegacyMuhurtaFamily() reads from,
  // so it works uniformly for CATALOG and FALLBACK_CLASSIFIER results.
  LEGACY_FAMILY_BY_DEFINITION_ID[id] = legacyFamily;

  return {
    source: 'FALLBACK_CLASSIFIER',
    definition: {
      id,
      category: 'FOCUS',
      aliases: [],
      socialMode: 'ANY',
      status: 'CANONICAL',
      experience: {
        // Free-text fallback activities were never resolved from the
        // catalog, so there's no known occasion to turn into an AuraMoment
        // -- momentEligible false, distinct from every real catalog id.
        momentEligible: false,
        planningMode: 'EVERYDAY',
        // Unknown free text has no real basis for LOG_NOW/START_NOW/PLAN --
        // BOTH is the safe default (matches defaultImmediateActionFor for
        // this same STANDARD evaluationDepth): never hides Plan, which
        // remains correct for literally anything.
        immediateAction: 'BOTH',
        // Same reasoning as defaultDurationModeFor's own fallback: never
        // invent a number nobody chose for unknown free text.
        durationMode: 'USER_SELECTED',
      },
      muhurta: {
        family,
        intent,
        significance: 'MEDIUM',
        evaluationDepth: 'STANDARD',
        timingSensitivity: { start: 'MEDIUM', duration: 'LOW', end: 'LOW' },
      },
    },
  };
}