import { getKarana, getNakshatra, getTithi, getYoga } from '../../vedic/src/panchangElements';
import type { SolarWindowType } from '../../panchang/src/windows';
import type { MuhurtaReason } from './activityOntology';
import { deriveLegacyMuhurtaText } from './muhurtaReasonFormat';

export type MuhurtaActivityFamily =
  | 'DEEP_WORK'
  | 'WORKOUT'
  | 'LEARNING'
  | 'MEDITATION'
  | 'RELATIONSHIP'
  | 'JOURNEY_START'
  | 'SOCIAL'
  | 'MEAL'
  | 'FINANCE'
  | 'NEW_BEGINNING'
  | 'ADMIN'
  | 'WELLBEING'
  | 'FOCUSED_WORK';

export interface PanchangaSnapshot {
  tithi: string;
  nakshatra: string;
  yoga: string;
  karana: string;
}

export interface MuhurtaEvaluation {
  family: MuhurtaActivityFamily;
  panchanga: PanchangaSnapshot;
  modifier: number;
  /** Canonical source of truth — see activityOntology.ts. blockers/supports/
   * summary below are derived from this via muhurtaReasonFormat.ts purely
   * for backward compatibility with existing consumers. */
  reasons: MuhurtaReason[];
  blockers: string[];
  supports: string[];
  summary: string;
  /** Which Aura Muhurta methodology (and, when applicable, which specific
   * rule pack) produced this evaluation — for a future "how Aura calculated
   * this" audit view, never consumed by scoring itself. Only set by
   * muhurtaRulePacks.ts's evaluateMuhurtaWithRulePack(); this file's own
   * legacy evaluateMuhurta() below leaves it undefined (unchanged
   * behavior — see muhurtaRulePacks.ts's module doc comment). */
  provenance?: {
    methodology: string;
    rulePackId?: string;
  };
}

const FAVORABLE_YOGAS = new Set(['Priti', 'Ayushman', 'Saubhagya', 'Shobhana', 'Sukarma', 'Dhriti', 'Harshana', 'Siddhi', 'Shiva', 'Siddha', 'Sadhya', 'Shubha', 'Shukla', 'Brahma', 'Indra']);
const DIFFICULT_YOGAS = new Set(['Atiganda', 'Shula', 'Ganda', 'Vyaghapata', 'Vyatipata', 'Vajra', 'Parigha', 'Vaidhriti']);
const FAVORABLE_KARANAS = new Set(['Bava', 'Balava', 'Kaulava', 'Taitila', 'Garaja', 'Vanija']);

export interface MuhurtaFamilyRuleData {
  preferredNakshatras: string[];
  avoidNakshatras: string[];
  preferredTithiPatterns: RegExp[];
  avoidTithiPatterns: RegExp[];
  note: string;
}

const RULES: Record<MuhurtaActivityFamily, MuhurtaFamilyRuleData> = {
  DEEP_WORK: {
    preferredNakshatras: ['Rohini', 'Mrigashira', 'Hasta', 'Chitra', 'Anuradha', 'Shravana', 'Revati'],
    avoidNakshatras: ['Ardra', 'Ashlesha', 'Jyeshtha', 'Mula'],
    preferredTithiPatterns: [/Panchami/, /Saptami/, /Dashami/, /Ekadashi/, /Trayodashi/],
    avoidTithiPatterns: [/Amavasya/, /Chaturdashi/],
    note: 'supports sustained focus',
  },
  WORKOUT: {
    preferredNakshatras: ['Krittika', 'Mrigashira', 'Chitra', 'Dhanishta', 'Shatabhisha'],
    avoidNakshatras: ['Ashlesha', 'Jyeshtha', 'Revati'],
    preferredTithiPatterns: [/Tritiya/, /Panchami/, /Saptami/, /Dashami/],
    avoidTithiPatterns: [/Amavasya/, /Chaturdashi/],
    note: 'supports physical output',
  },
  LEARNING: {
    preferredNakshatras: ['Rohini', 'Mrigashira', 'Punarvasu', 'Pushya', 'Hasta', 'Anuradha', 'Shravana', 'Revati'],
    avoidNakshatras: ['Ardra', 'Ashlesha', 'Mula'],
    preferredTithiPatterns: [/Panchami/, /Saptami/, /Ekadashi/, /Trayodashi/],
    avoidTithiPatterns: [/Amavasya/],
    note: 'supports study and retention',
  },
  MEDITATION: {
    preferredNakshatras: ['Punarvasu', 'Pushya', 'Hasta', 'Anuradha', 'Shravana', 'Revati'],
    avoidNakshatras: ['Bharani', 'Krittika', 'Ardra'],
    preferredTithiPatterns: [/Ekadashi/, /Purnima/, /Pratipada/],
    avoidTithiPatterns: [],
    note: 'supports quiet inward work',
  },
  RELATIONSHIP: {
    preferredNakshatras: ['Rohini', 'Mrigashira', 'Uttara Phalguni', 'Hasta', 'Swati', 'Anuradha', 'Revati'],
    avoidNakshatras: ['Bharani', 'Ardra', 'Ashlesha', 'Jyeshtha', 'Mula'],
    preferredTithiPatterns: [/Dvitiya/, /Tritiya/, /Panchami/, /Saptami/, /Dashami/, /Trayodashi/],
    avoidTithiPatterns: [/Amavasya/, /Chaturdashi/],
    note: 'supports ease and connection',
  },
  JOURNEY_START: {
    preferredNakshatras: ['Ashwini', 'Mrigashira', 'Punarvasu', 'Hasta', 'Anuradha', 'Shravana', 'Dhanishta', 'Revati'],
    avoidNakshatras: ['Bharani', 'Krittika', 'Ashlesha', 'Jyeshtha', 'Mula'],
    preferredTithiPatterns: [/Dvitiya/, /Tritiya/, /Panchami/, /Saptami/, /Dashami/, /Ekadashi/],
    avoidTithiPatterns: [/Amavasya/, /Chaturdashi/],
    note: 'supports a smoother start',
  },
  SOCIAL: {
    preferredNakshatras: ['Rohini', 'Mrigashira', 'Uttara Phalguni', 'Hasta', 'Swati', 'Anuradha', 'Revati'],
    avoidNakshatras: ['Ashlesha', 'Jyeshtha'],
    preferredTithiPatterns: [/Dvitiya/, /Tritiya/, /Panchami/, /Saptami/, /Dashami/],
    avoidTithiPatterns: [],
    note: 'supports enjoyment and social flow',
  },
  MEAL: {
    preferredNakshatras: ['Rohini', 'Mrigashira', 'Pushya', 'Hasta', 'Anuradha', 'Revati'],
    avoidNakshatras: [],
    preferredTithiPatterns: [/Dvitiya/, /Tritiya/, /Panchami/, /Saptami/, /Dashami/],
    avoidTithiPatterns: [],
    note: 'supports comfort and nourishment',
  },
  FINANCE: {
    preferredNakshatras: ['Rohini', 'Pushya', 'Uttara Phalguni', 'Hasta', 'Anuradha', 'Uttara Ashadha', 'Shravana', 'Revati'],
    avoidNakshatras: ['Bharani', 'Ardra', 'Ashlesha', 'Jyeshtha', 'Mula'],
    preferredTithiPatterns: [/Dvitiya/, /Tritiya/, /Panchami/, /Saptami/, /Dashami/, /Ekadashi/, /Trayodashi/],
    avoidTithiPatterns: [/Amavasya/, /Chaturdashi/],
    note: 'supports clear commitments',
  },
  NEW_BEGINNING: {
    preferredNakshatras: ['Ashwini', 'Rohini', 'Mrigashira', 'Pushya', 'Hasta', 'Anuradha', 'Uttara Ashadha', 'Shravana', 'Revati'],
    avoidNakshatras: ['Bharani', 'Ardra', 'Ashlesha', 'Jyeshtha', 'Mula'],
    preferredTithiPatterns: [/Dvitiya/, /Tritiya/, /Panchami/, /Saptami/, /Dashami/, /Ekadashi/, /Trayodashi/],
    avoidTithiPatterns: [/Amavasya/, /Chaturdashi/],
    note: 'supports auspicious starts',
  },
  ADMIN: {
    preferredNakshatras: ['Hasta', 'Chitra', 'Swati', 'Shravana', 'Dhanishta'],
    avoidNakshatras: [],
    preferredTithiPatterns: [/Chaturthi/, /Shasthi/, /Dashami/],
    avoidTithiPatterns: [],
    note: 'supports routine cleanup',
  },
  WELLBEING: {
    preferredNakshatras: ['Rohini', 'Punarvasu', 'Pushya', 'Hasta', 'Anuradha', 'Revati'],
    avoidNakshatras: ['Ardra', 'Ashlesha'],
    preferredTithiPatterns: [/Dvitiya/, /Panchami/, /Ekadashi/, /Purnima/],
    avoidTithiPatterns: [],
    note: 'supports recovery and steadiness',
  },
  FOCUSED_WORK: {
    preferredNakshatras: ['Rohini', 'Mrigashira', 'Hasta', 'Chitra', 'Anuradha', 'Shravana', 'Revati'],
    avoidNakshatras: ['Ardra', 'Ashlesha', 'Jyeshtha', 'Mula'],
    preferredTithiPatterns: [/Panchami/, /Saptami/, /Dashami/, /Ekadashi/, /Trayodashi/],
    avoidTithiPatterns: [/Amavasya/, /Chaturdashi/],
    note: 'supports focused execution',
  },
};

export function classifyMuhurtaActivity(taskTitle: string): MuhurtaActivityFamily {
  const title = taskTitle.toLowerCase();
  if (/(journey|travel|trip|flight|train|vacation|relocat|move to a new home)/.test(title)) return 'JOURNEY_START';
  if (/(date|dating|romantic|relationship|partner|proposal|anniversary)/.test(title)) return 'RELATIONSHIP';
  if (/(party|celebration|concert|movie|night out|social|friends)/.test(title)) return 'SOCIAL';
  if (/(meal|dinner|lunch|breakfast|food)/.test(title)) return 'MEAL';
  if (/(financial|finance|investment|invest|loan|property|purchase|contract|transfer money|open account)/.test(title)) return 'FINANCE';
  if (/(start|begin|launch|open|new project|new business|new job|new course|renovation|new habit|marriage|wedding)/.test(title)) return 'NEW_BEGINNING';
  if (/(meditat|breath|mindful|prayer)/.test(title)) return 'MEDITATION';
  if (/(learn|course|read|book|exam|language|practice|certification|study)/.test(title)) return 'LEARNING';
  if (/(workout|training|lift|run|gym|exercise|heavy)/.test(title)) return 'WORKOUT';
  if (/(deep work|focus|coding|code|research|write|writing)/.test(title)) return 'DEEP_WORK';
  if (/(walk|cycling|swim|yoga|stretch|massage|spa|journal|sleep|rest|recover)/.test(title)) return 'WELLBEING';
  if (/(admin|email|inbox|invoice|cleanup|organize|errand|filing|paperwork|docs|document)/.test(title)) return 'ADMIN';
  return 'FOCUSED_WORK';
}

export function getPanchangaSnapshot(date: Date): PanchangaSnapshot {
  return {
    tithi: getTithi(date).name,
    nakshatra: getNakshatra(date).name,
    yoga: getYoga(date).name,
    karana: getKarana(date).name,
  };
}

/**
 * The generic nakshatra/tithi evaluator: given a Panchanga snapshot and ANY
 * rule data shaped like MuhurtaFamilyRuleData (the legacy per-family RULES
 * table below, OR a MuhurtaRulePack's tithi/nakshatra fields -- see
 * muhurtaRulePacks.ts), produces the same SUPPORT/CAUTION reasons. Extracted
 * so the rule-pack evaluator (packages/muhurta/src/muhurtaRulePacks.ts) can
 * reuse this exact logic instead of a second copy -- see that module's own
 * doc comment and brief section 4 ("evaluate rules generically", not
 * `if (intent === ...)` branches sprinkled through this file).
 */
export function evaluatePanchangaNakshatraTithiReasons(panchanga: PanchangaSnapshot, rules: MuhurtaFamilyRuleData): MuhurtaReason[] {
  const reasons: MuhurtaReason[] = [];

  if (rules.preferredNakshatras.includes(panchanga.nakshatra)) {
    reasons.push({ code: 'NAKSHATRA_SUPPORTIVE', factor: 'NAKSHATRA', polarity: 'SUPPORT', impact: 8, value: panchanga.nakshatra, params: { note: rules.note } });
  } else if (rules.avoidNakshatras.includes(panchanga.nakshatra)) {
    reasons.push({ code: 'NAKSHATRA_UNFAVORABLE', factor: 'NAKSHATRA', polarity: 'CAUTION', impact: -10, value: panchanga.nakshatra });
  }

  if (rules.preferredTithiPatterns.some((pattern) => pattern.test(panchanga.tithi))) {
    reasons.push({ code: 'TITHI_SUPPORTIVE', factor: 'TITHI', polarity: 'SUPPORT', impact: 5, value: panchanga.tithi });
  } else if (rules.avoidTithiPatterns.some((pattern) => pattern.test(panchanga.tithi))) {
    reasons.push({ code: 'TITHI_UNFAVORABLE', factor: 'TITHI', polarity: 'CAUTION', impact: -8, value: panchanga.tithi });
  }

  return reasons;
}

/**
 * Yoga/Karana favorability is GLOBAL -- family/intent-independent -- in
 * today's engine (FAVORABLE_YOGAS/DIFFICULT_YOGAS/FAVORABLE_KARANAS above
 * apply identically to every activity). Extracted verbatim so the rule-pack
 * evaluator reuses it rather than re-declaring the same favorability sets.
 */
export function evaluatePanchangaYogaKaranaReasons(panchanga: PanchangaSnapshot): MuhurtaReason[] {
  const reasons: MuhurtaReason[] = [];

  if (FAVORABLE_YOGAS.has(panchanga.yoga)) {
    reasons.push({ code: 'YOGA_SUPPORTIVE', factor: 'YOGA', polarity: 'SUPPORT', impact: 4, value: panchanga.yoga });
  } else if (DIFFICULT_YOGAS.has(panchanga.yoga)) {
    reasons.push({ code: 'YOGA_UNFAVORABLE', factor: 'YOGA', polarity: 'CAUTION', impact: -6, value: panchanga.yoga });
  }

  if (panchanga.karana === 'Vishti') {
    reasons.push({ code: 'KARANA_UNFAVORABLE', factor: 'KARANA', polarity: 'CAUTION', impact: -8, value: panchanga.karana });
  } else if (FAVORABLE_KARANAS.has(panchanga.karana)) {
    reasons.push({ code: 'KARANA_SUPPORTIVE', factor: 'KARANA', polarity: 'SUPPORT', impact: 3, value: panchanga.karana });
  }

  return reasons;
}

/**
 * Solar-window reason, parameterized on a (possibly undefined) legacy
 * family for the BRAHMA/GULIKA bonus conditions. RAHU_KALAM/YAMA caution and
 * ABHIJIT support are family-independent baselines that always apply.
 * `family` undefined (no legacy-family equivalent exists -- see
 * muhurtaRulePacks.ts's FAMILY_BASE_SOURCE) simply means neither bonus
 * condition can match, which is the correct, honest behavior: no invented
 * bonus for a family with no supporting data.
 */
export function evaluateSolarWindowReason(windowType: SolarWindowType, family: MuhurtaActivityFamily | undefined): MuhurtaReason | undefined {
  if (windowType === 'RAHU_KALAM' || windowType === 'YAMA') {
    const impact = -(family === 'ADMIN' || family === 'SOCIAL' ? 4 : 12);
    return { code: windowType === 'RAHU_KALAM' ? 'RAHU_CAUTION' : 'YAMA_CAUTION', factor: 'SOLAR_WINDOW', polarity: 'CAUTION', impact, value: windowType };
  }
  if (windowType === 'ABHIJIT') {
    return { code: 'ABHIJIT_SUPPORT', factor: 'SOLAR_WINDOW', polarity: 'SUPPORT', impact: 8, value: windowType };
  }
  if (windowType === 'BRAHMA' && (family === 'MEDITATION' || family === 'LEARNING' || family === 'DEEP_WORK')) {
    return { code: 'BRAHMA_SUPPORT', factor: 'SOLAR_WINDOW', polarity: 'SUPPORT', impact: 7, value: windowType };
  }
  if (windowType === 'GULIKA' && (family === 'ADMIN' || family === 'LEARNING' || family === 'SOCIAL')) {
    return { code: 'GULIKA_SUPPORT', factor: 'SOLAR_WINDOW', polarity: 'SUPPORT', impact: 4, value: windowType };
  }
  return undefined;
}

/** Read-only accessor for a legacy family's rule data -- lets
 * muhurtaRulePacks.ts build family-base rule packs from the EXACT same data
 * this file's own evaluateMuhurta() uses, without exposing the whole
 * internal RULES table as a mutable export. */
export function getFamilyRuleData(family: MuhurtaActivityFamily): MuhurtaFamilyRuleData {
  return RULES[family];
}

export function evaluateMuhurta(params: {
  taskTitle: string;
  date: Date;
  windowType: SolarWindowType;
  family?: MuhurtaActivityFamily;
}): MuhurtaEvaluation {
  const family = params.family ?? classifyMuhurtaActivity(params.taskTitle);
  const rules = RULES[family];
  const panchanga = getPanchangaSnapshot(params.date);
  const reasons: MuhurtaReason[] = [
    ...evaluatePanchangaNakshatraTithiReasons(panchanga, rules),
    ...evaluatePanchangaYogaKaranaReasons(panchanga),
  ];

  const windowReason = evaluateSolarWindowReason(params.windowType, family);
  if (windowReason) reasons.push(windowReason);

  const modifier = reasons.reduce((total, reason) => total + (reason.impact ?? 0), 0);
  const legacy = deriveLegacyMuhurtaText(reasons);

  return {
    family,
    panchanga,
    modifier,
    reasons,
    blockers: legacy.blockers,
    supports: legacy.supports,
    summary: legacy.summary,
  };
}
