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

export interface ActivityDefinition {
  id: string;
  category: ActivityCategory;
  muhurta: MuhurtaClassification;
  socialMode: SocialMode;
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
 */
type ActivityMetadataInput = {
  family: MuhurtaFamily;
  intent: MuhurtaIntent;
  evaluationDepth: MuhurtaClassification['evaluationDepth'];
  timingSensitivity: TimingSensitivity;
  socialMode: SocialMode;
  /** Overrides activity.significance when the catalog's existing value is a
   * poor proxy for genuine Muhurta significance (see 'workout' below for
   * why this exists). Omit to reuse activity.significance as-is. */
  significance?: 'LOW' | 'MEDIUM' | 'HIGH';
  status?: ActivityStatus;
  notes?: string;
  legacyBroadIntent?: boolean;
};

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
  },
  'task-2': {
    // "Sprint Backlog Execution"
    family: 'WORK',
    intent: 'DEEP_WORK',
    evaluationDepth: 'STANDARD',
    timingSensitivity: { start: 'MEDIUM', duration: 'MEDIUM', end: 'LOW' },
    socialMode: 'SOLO',
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
  },
  'task-4': {
    // "Deep Architecture & Writing"
    family: 'WORK',
    intent: 'DEEP_WORK',
    evaluationDepth: 'STANDARD',
    timingSensitivity: { start: 'MEDIUM', duration: 'MEDIUM', end: 'LOW' },
    socialMode: 'SOLO',
  },
  'task-5': {
    // "Process Optimization & Docs"
    family: 'ROUTINE',
    intent: 'ADMIN',
    evaluationDepth: 'LIGHT',
    timingSensitivity: { start: 'LOW', duration: 'LOW', end: 'LOW' },
    socialMode: 'SOLO',
  },
  'task-6': {
    // "Active Rest & Hydration Check"
    family: 'HEALTH',
    intent: 'RECOVERY',
    evaluationDepth: 'LIGHT',
    timingSensitivity: { start: 'LOW', duration: 'LOW', end: 'LOW' },
    socialMode: 'SOLO',
  },
  'task-7': {
    // "Light Stretch & Mobility"
    family: 'HEALTH',
    intent: 'RECOVERY',
    evaluationDepth: 'LIGHT',
    timingSensitivity: { start: 'LOW', duration: 'LOW', end: 'LOW' },
    socialMode: 'SOLO',
  },

  // -- EXTENDED_ACTIVITY_CATALOG --
  'start-journey': {
    family: 'TRAVEL',
    intent: 'JOURNEY_START',
    evaluationDepth: 'DEEP',
    timingSensitivity: { start: 'HIGH', duration: 'MEDIUM', end: 'LOW' },
    socialMode: 'ANY',
  },
  'deep-work': {
    family: 'WORK',
    intent: 'DEEP_WORK',
    evaluationDepth: 'STANDARD',
    timingSensitivity: { start: 'MEDIUM', duration: 'MEDIUM', end: 'LOW' },
    socialMode: 'SOLO',
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
  },
  dating: {
    family: 'RELATIONSHIP',
    intent: 'DATE',
    evaluationDepth: 'STANDARD',
    timingSensitivity: { start: 'MEDIUM', duration: 'LOW', end: 'LOW' },
    socialMode: 'PAIR',
  },
  party: {
    family: 'SOCIAL',
    intent: 'PARTY',
    evaluationDepth: 'LIGHT',
    timingSensitivity: { start: 'LOW', duration: 'LOW', end: 'LOW' },
    socialMode: 'GROUP',
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
  },
  learning: {
    family: 'EDUCATION',
    intent: 'STUDY',
    evaluationDepth: 'STANDARD',
    timingSensitivity: { start: 'LOW', duration: 'MEDIUM', end: 'LOW' },
    socialMode: 'SOLO',
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
  },
  'property-purchase': {
    family: 'FINANCE',
    intent: 'PROPERTY_PURCHASE',
    evaluationDepth: 'DEEP',
    timingSensitivity: { start: 'HIGH', duration: 'LOW', end: 'LOW' },
    socialMode: 'ANY',
    notes: 'Tithi/Nakshatra reuse FINANCE\'s existing family-level rule data as a base -- financial-decision\'s own aliases already included "property purchase" before this PR split it out. REUSABLE_BASE_RULE, a strong-fit reuse.',
  },
  engagement: {
    family: 'RELATIONSHIP',
    intent: 'ENGAGEMENT',
    evaluationDepth: 'CEREMONIAL',
    timingSensitivity: { start: 'HIGH', duration: 'MEDIUM', end: 'LOW' },
    socialMode: 'PAIR',
    notes: 'CEREMONIAL depth requires dedicated (IMPLEMENTED) Tithi/Nakshatra coverage to reach SUPPORTED (brief section 8). Currently only has RELATIONSHIP\'s family-level base (authored for casual dating, not a ceremonial engagement) -- REUSABLE_BASE_RULE, not sufficient evidence on its own, so this resolves to PARTIAL support and is hidden from Muhurtham Finder until dedicated data is added.',
  },
  'griha-pravesh': {
    family: 'HOME',
    intent: 'GRIHA_PRAVESH',
    evaluationDepth: 'CEREMONIAL',
    timingSensitivity: { start: 'HIGH', duration: 'MEDIUM', end: 'LOW' },
    socialMode: 'FAMILY',
    notes: 'No existing family-level rule data legitimately targets a home-entry ceremony (HOME has no MuhurtaRulePack base -- see muhurtaRulePacks.ts). Tithi/Nakshatra coverage is honestly MISSING rather than borrowed from an unrelated family (e.g. ADMIN); resolves to PARTIAL support and is hidden from Muhurtham Finder until dedicated data is added.',
  },
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