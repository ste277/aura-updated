import type { SolarWindowType } from '../../panchang/src/windows';
import { evaluateMuhurta, MuhurtaActivityFamily } from '../../muhurta/src/muhurtaEngine';
import type { MuhurtaReason, MuhurtaClassification } from '../../muhurta/src/activityOntology';
import { formatPersonalReasons } from '../../muhurta/src/muhurtaReasonFormat';
import { computeMuhurtaSupportLevel, evaluateMuhurtaWithRulePack, resolveMuhurtaRulePack } from '../../muhurta/src/muhurtaRulePacks';
import { getTaraBala } from '../../vedic/src/natalChart';
import type { ActivityProfile } from './personalizedTasks';

/** Score cap applied when a CEREMONIAL activity's rule pack hasn't reached
 * SUPPORTED (dedicated Tithi+Nakshatra evidence) -- brief section 8: "Do not
 * let a generic good solar window alone produce EXCELLENT... A CEREMONIAL
 * result should require sufficient Panchanga evidence." 89 sits just below
 * the EXCEPTIONAL label threshold (90), so an incomplete ceremonial rule
 * pack can still reach BEST/GOOD but never the top label. Only ever applies
 * when `classification` is supplied AND evaluationDepth is CEREMONIAL AND
 * support level is not SUPPORTED -- today that's Engagement and Griha
 * Pravesh; no existing (pre-this-PR) activity uses CEREMONIAL depth, so this
 * cannot change any existing activity's score. */
const CEREMONIAL_INCOMPLETE_SCORE_CAP = 89;

/** Methodology identifier for the personal-fit layer (Tara Bala + element
 * affinity), kept conceptually separate from AURA_MUHURTA_V1
 * (packages/muhurta/src/muhurtaRulePacks.ts) -- personal factors are not
 * traditional Muhurta rules and must not be silently folded into that
 * methodology's provenance. See evaluatePersonalMuhurtaFit() below for what
 * this covers today (Tara Bala + a moon-element-affinity heuristic) and the
 * Personal Muhurtham completion report for the full factor audit. */
export const AURA_PERSONAL_FIT_METHODOLOGY_ID = 'AURA_PERSONAL_FIT_V1' as const;

export type AuraFitLabel = 'EXCEPTIONAL' | 'BEST' | 'GOOD' | 'SUITABLE' | 'USE_LIGHTLY' | 'AVOID';

export interface MuhurtaCapabilities {
  initiation: number;
  focus: number;
  routine: number;
  social: number;
  restoration: number;
  performance: number;
  nourishment: number;
  friction: number;
}

export interface AuraFitEvaluation {
  score: number;
  label: AuraFitLabel;
  labelText: string;
  summary: string;
  capabilities: MuhurtaCapabilities;
  muhurtaSummary: string;
  personalSummary?: string;
  /** Structured reasons behind this evaluation — Muhurta panchanga/solar-window
   * reasons, the activity's own recommended/avoid-window rule, and (when a
   * personal context is supplied) Tara Bala reasons. Additive: does not
   * change score/summary/label, which are computed exactly as before. */
  reasons: MuhurtaReason[];
}

export interface PersonalMuhurtaContext {
  natalNakshatraIndex?: number; // 1-27, matching getNakshatra()
  janmaNakshatra?: string;
  janmaRashi?: string;
  moonElement?: 'FIRE' | 'WATER' | 'AIR' | 'EARTH';
}

const CATEGORY_FAMILY: Record<ActivityProfile['category'], MuhurtaActivityFamily> = {
  WORK: 'FOCUSED_WORK',
  FOCUS: 'DEEP_WORK',
  WORKOUT: 'WORKOUT',
  TRAVEL: 'JOURNEY_START',
  RELATIONSHIP: 'RELATIONSHIP',
  SOCIAL: 'SOCIAL',
  LEARNING: 'LEARNING',
  FINANCE: 'FINANCE',
  SPIRITUAL: 'MEDITATION',
  HOME: 'ADMIN',
  MEAL: 'MEAL',
  MICRO_BREAK: 'WELLBEING',
  REST: 'WELLBEING',
  ROUTINE: 'ADMIN',
  NEW_BEGINNING: 'NEW_BEGINNING',
};

export function familyForActivityProfile(activity: ActivityProfile): MuhurtaActivityFamily {
  return CATEGORY_FAMILY[activity.category] ?? 'FOCUSED_WORK';
}

export function evaluateActivityFit(params: {
  activity: ActivityProfile;
  date: Date;
  windowType: SolarWindowType;
  timePreferenceScore?: number;
  personalPatternScore?: number;
  userPreferenceScore?: number;
  personalContext?: PersonalMuhurtaContext;
  /** Optional newer-ontology classification (activityDefinitions.ts's
   * ActivityDefinition.muhurta) for the activity being scored. When
   * supplied AND its resolved rule pack has data the legacy family-keyed
   * path cannot see -- i.e. coverage is NOT simply "both Tithi and
   * Nakshatra REUSABLE_BASE_RULE" (the case where the legacy path is
   * equally correct and already trusted/tested) -- the generic rule-pack
   * evaluator (muhurtaRulePacks.ts) is used INSTEAD of the legacy
   * family-keyed evaluateMuhurta() call below. That covers both a MISSING
   * family (no legitimate legacy proxy at all) and, as of the Muhurta
   * Knowledge Pack V1 PR, an IMPLEMENTED (genuinely dedicated,
   * intent-specific) pack, which is strictly better data than any legacy
   * family could offer. Every activity whose classification resolves to
   * REUSABLE_BASE_RULE for both factors (every pre-existing activity, plus
   * business-start/property-purchase/engagement) is completely unaffected
   * by this parameter -- see muhurtaRulePacks.ts's module doc comment for
   * the full reasoning. */
  classification?: MuhurtaClassification;
}): AuraFitEvaluation {
  const family = familyForActivityProfile(params.activity);
  const rulePack = params.classification ? resolveMuhurtaRulePack(params.classification) : undefined;
  const supportLevel = params.classification && rulePack ? computeMuhurtaSupportLevel(params.classification, rulePack) : undefined;
  const usesGenericRulePack = rulePack !== undefined && !(rulePack.coverage.tithi === 'REUSABLE_BASE_RULE' && rulePack.coverage.nakshatra === 'REUSABLE_BASE_RULE');
  const muhurta = usesGenericRulePack
    ? evaluateMuhurtaWithRulePack({ classification: params.classification!, date: params.date, windowType: params.windowType })
    : evaluateMuhurta({
        taskTitle: params.activity.title,
        date: params.date,
        windowType: params.windowType,
        family,
      });
  const capabilities = capabilitiesForWindow(params.windowType, muhurta.modifier);
  const activityScore = scoreActivityAgainstCapabilities(params.activity, capabilities);
  const muhurtaScore = clamp(68 + muhurta.modifier * 1.8 - capabilities.friction * 0.24);
  const solarScore = scoreSolarWindow(params.activity, params.windowType);
  const natureScore = scoreNature(params.activity, capabilities);
  const timePreferenceScore = params.timePreferenceScore ?? 70;
  const personalFit = evaluatePersonalMuhurtaFit(params.activity, params.date, params.personalContext);
  const personalPatternScore = params.personalPatternScore ?? personalFit.score;
  const userPreferenceScore = params.userPreferenceScore ?? 65;
  const startSensitivityPenalty = params.activity.requiresFreshStart && params.windowType === 'NEUTRAL' ? 10 : 0;
  const neutralContextAdjustment = params.windowType === 'NEUTRAL'
    ? params.activity.category === 'ROUTINE' || params.activity.category === 'HOME'
      ? 4
      : params.activity.category === 'RELATIONSHIP' || params.activity.category === 'SOCIAL'
      ? -12
      : params.activity.category === 'WORKOUT' || params.activity.category === 'MICRO_BREAK'
      ? -10
      : 0
    : 0;
  const uncappedScore = clamp(
    muhurtaScore * 0.45 +
    solarScore * 0.20 +
    timePreferenceScore * 0.10 +
    natureScore * 0.10 +
    personalPatternScore * 0.10 +
    userPreferenceScore * 0.05 -
    startSensitivityPenalty +
    neutralContextAdjustment
  );
  const ceremonialIncomplete = params.classification?.evaluationDepth === 'CEREMONIAL' && supportLevel !== 'SUPPORTED';
  const score = ceremonialIncomplete ? Math.min(uncappedScore, CEREMONIAL_INCOMPLETE_SCORE_CAP) : uncappedScore;
  const label = labelForScore(score);
  const ruleReason = activityRuleReason(params.activity, params.windowType);
  return {
    score: Math.round(score),
    label,
    labelText: labelText(label),
    summary: buildFitSummary(params.activity, capabilities, muhurta.summary, score),
    capabilities,
    muhurtaSummary: muhurta.summary,
    personalSummary: personalFit.summary,
    reasons: [...muhurta.reasons, ...(ruleReason ? [ruleReason] : []), ...(personalFit.reasons ?? [])],
  };
}

/**
 * Structured counterpart to scoreSolarWindow() below — same
 * recommended/acceptable/avoid classification, but as a MuhurtaReason
 * instead of a number. Additive only: never consulted by scoreSolarWindow()
 * or the score formula in evaluateActivityFit(), so it cannot change scores.
 */
function activityRuleReason(activity: ActivityProfile, windowType: SolarWindowType): MuhurtaReason | undefined {
  if (activity.avoidWindowTypes.includes(windowType)) {
    return { code: 'ACTIVITY_RULE_BLOCK', factor: 'ACTIVITY', polarity: activity.allowDuringAvoidWindow ? 'CAUTION' : 'BLOCK', value: windowType };
  }
  if (activity.recommendedWindowTypes.includes(windowType)) {
    return { code: 'ACTIVITY_RULE_SUPPORT', factor: 'ACTIVITY', polarity: 'SUPPORT', value: windowType };
  }
  return undefined;
}

export function evaluatePersonalMuhurtaFit(activity: ActivityProfile, date: Date, context?: PersonalMuhurtaContext): { score: number; summary?: string; reasons?: MuhurtaReason[] } {
  if (!context || context.natalNakshatraIndex === undefined) return { score: 65 };
  const taraBala = getTaraBala(context.natalNakshatraIndex, date);
  let score = taraBala.favorable ? 76 : 48;
  const reasons: MuhurtaReason[] = [
    { code: taraBala.favorable ? 'PERSONAL_TARA_SUPPORT' : 'PERSONAL_TARA_CAUTION', factor: 'PERSONAL', polarity: taraBala.favorable ? 'SUPPORT' : 'CAUTION', impact: taraBala.favorable ? 11 : -17, value: taraBala.name },
  ];
  if (context.moonElement && activity.elementAffinity === context.moonElement) {
    score += 8;
    reasons.push({ code: 'OTHER', factor: 'PERSONAL', polarity: 'SUPPORT', impact: 8, value: context.moonElement, params: { kind: 'ELEMENT_AFFINITY' } });
  }
  if (!taraBala.favorable && (activity.significance === 'HIGH' || activity.requiresFreshStart)) {
    score -= 8;
    reasons.push({ code: 'OTHER', factor: 'PERSONAL', polarity: 'CAUTION', impact: -8, params: { kind: 'HIGH_IMPORTANCE_CAUTION' } });
  }
  return { score: clamp(score), summary: formatPersonalReasons(reasons), reasons };
}

function capabilitiesForWindow(windowType: SolarWindowType, muhurtaModifier: number): MuhurtaCapabilities {
  const base: MuhurtaCapabilities = {
    initiation: 55,
    focus: 55,
    routine: 60,
    social: 55,
    restoration: 50,
    performance: 55,
    nourishment: 55,
    friction: 20,
  };
  if (windowType === 'ABHIJIT') {
    Object.assign(base, { initiation: 94, focus: 88, performance: 90, routine: 68, social: 58, restoration: 40, friction: 6 });
  } else if (windowType === 'BRAHMA') {
    Object.assign(base, { initiation: 72, focus: 88, routine: 62, social: 35, restoration: 82, performance: 45, nourishment: 50, friction: 8 });
  } else if (windowType === 'GULIKA') {
    Object.assign(base, { initiation: 62, focus: 70, routine: 90, social: 72, restoration: 65, performance: 66, nourishment: 62, friction: 16 });
  } else if (windowType === 'RAHU_KALAM' || windowType === 'YAMA') {
    Object.assign(base, { initiation: 18, focus: 42, routine: 78, social: 45, restoration: 82, performance: 38, nourishment: 55, friction: 78 });
  } else {
    Object.assign(base, { initiation: 48, focus: 64, routine: 82, social: 52, restoration: 62, performance: 52, nourishment: 65, friction: 18 });
  }
  const boost = muhurtaModifier * 1.2;
  return {
    initiation: clamp(base.initiation + boost),
    focus: clamp(base.focus + boost),
    routine: clamp(base.routine + boost * 0.6),
    social: clamp(base.social + boost * 0.8),
    restoration: clamp(base.restoration + boost * 0.5),
    performance: clamp(base.performance + boost),
    nourishment: clamp(base.nourishment + boost * 0.5),
    friction: clamp(base.friction - boost * 0.5),
  };
}

function scoreActivityAgainstCapabilities(activity: ActivityProfile, capabilities: MuhurtaCapabilities): number {
  switch (activity.category) {
    case 'TRAVEL':
    case 'NEW_BEGINNING':
    case 'FINANCE':
      return activity.requiresFreshStart ? capabilities.initiation : (capabilities.initiation + capabilities.focus) / 2;
    case 'FOCUS':
    case 'WORK':
    case 'LEARNING':
      return (capabilities.focus * 0.7 + capabilities.routine * 0.3);
    case 'WORKOUT':
      return capabilities.performance;
    case 'RELATIONSHIP':
    case 'SOCIAL':
      return capabilities.social;
    case 'SPIRITUAL':
    case 'REST':
      return capabilities.restoration;
    case 'ROUTINE':
    case 'HOME':
      return capabilities.routine;
    case 'MEAL':
    case 'MICRO_BREAK':
      return capabilities.nourishment * 0.55 + capabilities.restoration * 0.45;
    default:
      return capabilities.routine;
  }
}

function scoreSolarWindow(activity: ActivityProfile, windowType: SolarWindowType): number {
  if (activity.avoidWindowTypes.includes(windowType)) return activity.allowDuringAvoidWindow ? 45 : 10;
  if (activity.recommendedWindowTypes.includes(windowType)) return 86;
  if (activity.acceptableWindowTypes.includes(windowType)) return 70;
  return 55;
}

function scoreNature(activity: ActivityProfile, capabilities: MuhurtaCapabilities): number {
  if (activity.nature === 'INITIATE' || activity.requiresFreshStart) return capabilities.initiation;
  if (activity.nature === 'PERFORM') return capabilities.performance;
  if (activity.nature === 'CONNECT') return capabilities.social;
  if (activity.nature === 'RESTORE') return capabilities.restoration;
  if (activity.nature === 'LEARN') return capabilities.focus;
  if (activity.nature === 'NOURISH') return capabilities.nourishment;
  if (activity.nature === 'ROUTINE') return capabilities.routine;
  return scoreActivityAgainstCapabilities(activity, capabilities);
}

export function labelForScore(score: number): AuraFitLabel {
  if (score >= 90) return 'EXCEPTIONAL';
  if (score >= 80) return 'BEST';
  if (score >= 70) return 'GOOD';
  if (score >= 55) return 'SUITABLE';
  if (score >= 40) return 'USE_LIGHTLY';
  return 'AVOID';
}

export function labelText(label: AuraFitLabel): string {
  if (label === 'EXCEPTIONAL') return 'Exceptional fit';
  if (label === 'BEST') return 'Best fit';
  if (label === 'GOOD') return 'Good fit';
  if (label === 'SUITABLE') return 'Suitable';
  if (label === 'USE_LIGHTLY') return 'Use lightly';
  return 'Avoid for now';
}

function buildFitSummary(activity: ActivityProfile, capabilities: MuhurtaCapabilities, muhurtaSummary: string, score: number): string {
  const strength = dominantCapability(activity, capabilities);
  const base = score >= 70
    ? `${strength} suits ${activity.title.toLowerCase()} right now.`
    : score >= 55
    ? `${activity.title} is workable, but not the strongest use of this moment.`
    : `Aura would keep ${activity.title.toLowerCase()} light in this window.`;
  if (!muhurtaSummary || muhurtaSummary === 'Panchanga factors are neutral for this activity.') return base;
  return `${base} ${muhurtaSummary}`;
}

function dominantCapability(activity: ActivityProfile, capabilities: MuhurtaCapabilities): string {
  const score = scoreActivityAgainstCapabilities(activity, capabilities);
  if (activity.requiresFreshStart) return score >= 75 ? 'A clean start' : 'The start quality';
  if (activity.category === 'FOCUS' || activity.category === 'WORK' || activity.category === 'LEARNING') return score >= 75 ? 'Focused momentum' : 'Steady attention';
  if (activity.category === 'ROUTINE' || activity.category === 'HOME') return 'Structured follow-through';
  if (activity.category === 'RELATIONSHIP' || activity.category === 'SOCIAL') return score >= 70 ? 'Social ease' : 'A flexible mood';
  if (activity.category === 'MICRO_BREAK' || activity.category === 'REST') return 'Restorative capacity';
  if (activity.category === 'WORKOUT') return 'Physical output';
  return 'This window';
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}
