/**
 * Muhurta Rule Packs: family-level base rules + intent-specific overrides,
 * merged into an "effective rule set" (a MuhurtaRulePack) that a generic
 * evaluator can consume -- replacing the pattern of adding a new
 * `if (intent === 'X') { ... }` branch to muhurtaEngine.ts every time a new
 * occasion is added.
 *
 * ## What already exists vs. what's new here
 *
 * The ONLY traditional rule data in this codebase is muhurtaEngine.ts's
 * `RULES` table (getFamilyRuleData()) -- Tithi/Nakshatra preference lists
 * keyed by the legacy MuhurtaActivityFamily (13 buckets), plus a handful of
 * GLOBAL, family-independent constants (FAVORABLE_YOGAS/DIFFICULT_YOGAS/
 * FAVORABLE_KARANAS, and the ABHIJIT/RAHU_KALAM/YAMA solar-window rules).
 * There has never been an intent-specific layer (e.g. dedicated Griha
 * Pravesh Nakshatra data) -- this file does not invent one. `INTENT_RULE_PACKS`
 * below is intentionally empty: the override layer exists and is wired end
 * to end, but has nothing in it yet, honestly reflecting that no such data
 * has been researched/entered into this codebase. A future PR that adds
 * genuine, sourced intent-specific Panchanga data (e.g. traditionally-cited
 * Griha Pravesh nakshatras) should populate it there -- see the completion
 * report's rule coverage matrix for exactly what's missing today.
 *
 * ## Family base reuse
 *
 * FAMILY_BASE_SOURCE below maps each newer MuhurtaFamily to the *legacy*
 * MuhurtaActivityFamily whose existing RULES entry is a legitimate,
 * documented proxy for it -- e.g. BUSINESS reuses NEW_BEGINNING's data
 * because activityDefinitions.ts's own 'new-beginning' notes already name
 * "BUSINESS_START... HOME/CONSTRUCTION_START" as narrower intents that
 * entry was standing in for. This is REUSABLE_BASE_RULE coverage, not
 * invented data -- see resolveMuhurtaRulePack()'s coverage classification.
 *
 * HOME has NO entry: no existing family's data was written for a
 * home/property-ceremony context, and the only structurally "close" legacy
 * family (ADMIN, "supports routine cleanup") would actively misrepresent a
 * Griha Pravesh ceremony's Panchanga needs if silently reused. Per the
 * brief: "If reliable intent-specific rule data is NOT present... do not
 * manufacture... mark the rule pack incomplete." HOME's coverage is
 * therefore honestly MISSING rather than borrowed.
 */

import { getFamilyRuleData, evaluatePanchangaNakshatraTithiReasons, evaluatePanchangaYogaKaranaReasons, evaluateSolarWindowReason, getPanchangaSnapshot, MuhurtaActivityFamily, MuhurtaEvaluation } from './muhurtaEngine';
import { deriveLegacyMuhurtaText } from './muhurtaReasonFormat';
import type { SolarWindowType } from '../../panchang/src/windows';
import type { MuhurtaClassification, MuhurtaFamily, MuhurtaIntent, MuhurtaReason } from './activityOntology';

export type RuleCoverageStatus = 'IMPLEMENTED' | 'REUSABLE_BASE_RULE' | 'MISSING';

export interface MuhurtaRulePackCoverage {
  tithi: RuleCoverageStatus;
  nakshatra: RuleCoverageStatus;
  /** Global, family/intent-independent (FAVORABLE_YOGAS/DIFFICULT_YOGAS) --
   * always IMPLEMENTED for every activity today. */
  yoga: RuleCoverageStatus;
  /** Global, family/intent-independent (FAVORABLE_KARANAS + Vishti check) --
   * always IMPLEMENTED for every activity today. */
  karana: RuleCoverageStatus;
  /** ABHIJIT support + RAHU_KALAM/YAMA caution are global baselines that
   * always apply -- always IMPLEMENTED. BRAHMA/GULIKA bonus windows are
   * family-conditional extras layered on top when the legacy family
   * qualifies; their absence does not downgrade this to MISSING. */
  windows: RuleCoverageStatus;
}

export interface MuhurtaRulePack {
  family: MuhurtaFamily;
  intent: MuhurtaIntent;
  tithi: { preferredPatterns: RegExp[]; avoidPatterns: RegExp[] };
  nakshatra: { preferred: string[]; avoid: string[] };
  coverage: MuhurtaRulePackCoverage;
  /** The legacy family this pack's tithi/nakshatra data was sourced from, if
   * any (undefined when coverage is MISSING). Exposed for audit/debugging,
   * not consumed by scoring. */
  reusedFromLegacyFamily?: MuhurtaActivityFamily;
  metadata: {
    methodologyVersion: 1;
    note: string;
  };
}

export type MuhurtaSupportLevel = 'SUPPORTED' | 'PARTIAL' | 'NOT_YET_SUPPORTED';

/**
 * Which legacy MuhurtaActivityFamily's RULES entry each newer MuhurtaFamily
 * may reuse as its rule-pack base. See this module's doc comment for the
 * reasoning per family. Deliberately a Partial map -- HOME has no entry.
 */
const FAMILY_BASE_SOURCE: Partial<Record<MuhurtaFamily, MuhurtaActivityFamily>> = {
  WORK: 'FOCUSED_WORK',
  BUSINESS: 'NEW_BEGINNING',
  FINANCE: 'FINANCE',
  TRAVEL: 'JOURNEY_START',
  RELATIONSHIP: 'RELATIONSHIP',
  EDUCATION: 'LEARNING',
  HEALTH: 'WELLBEING',
  SOCIAL: 'SOCIAL',
  ROUTINE: 'ADMIN',
  // HOME: intentionally absent -- see module doc comment.
};

/**
 * Intent-specific overrides, layered on top of the family base. EMPTY today
 * -- see module doc comment. Only tithi/nakshatra are overridable here
 * (yoga/karana are global; solar-window bonuses are legacy-family-keyed
 * plumbing, not part of the newer intent model).
 */
const INTENT_RULE_PACKS: Partial<Record<MuhurtaIntent, { tithi: MuhurtaRulePack['tithi']; nakshatra: MuhurtaRulePack['nakshatra']; note: string }>> = {};

function emptyRulePack(family: MuhurtaFamily, intent: MuhurtaIntent, note: string): MuhurtaRulePack {
  return {
    family,
    intent,
    tithi: { preferredPatterns: [], avoidPatterns: [] },
    nakshatra: { preferred: [], avoid: [] },
    coverage: { tithi: 'MISSING', nakshatra: 'MISSING', yoga: 'IMPLEMENTED', karana: 'IMPLEMENTED', windows: 'IMPLEMENTED' },
    metadata: { methodologyVersion: 1, note },
  };
}

/**
 * Resolves the effective rule pack for a classification: intent-specific
 * override (if one exists in INTENT_RULE_PACKS) wins; otherwise falls back
 * to the family base (FAMILY_BASE_SOURCE); otherwise an honestly-empty pack.
 * This is the ONLY place that decides "where does this activity's
 * Tithi/Nakshatra data come from" -- callers never branch on intent
 * themselves (brief section 4).
 */
export function resolveMuhurtaRulePack(classification: MuhurtaClassification): MuhurtaRulePack {
  const intentOverride = INTENT_RULE_PACKS[classification.intent];
  if (intentOverride) {
    return {
      family: classification.family,
      intent: classification.intent,
      tithi: intentOverride.tithi,
      nakshatra: intentOverride.nakshatra,
      coverage: { tithi: 'IMPLEMENTED', nakshatra: 'IMPLEMENTED', yoga: 'IMPLEMENTED', karana: 'IMPLEMENTED', windows: 'IMPLEMENTED' },
      metadata: { methodologyVersion: 1, note: intentOverride.note },
    };
  }

  const legacyFamily = FAMILY_BASE_SOURCE[classification.family];
  if (!legacyFamily) {
    return emptyRulePack(classification.family, classification.intent, `No traditional rule data (family or intent level) is present in this codebase for ${classification.family}/${classification.intent} yet.`);
  }

  const legacyRules = getFamilyRuleData(legacyFamily);
  return {
    family: classification.family,
    intent: classification.intent,
    tithi: { preferredPatterns: legacyRules.preferredTithiPatterns, avoidPatterns: legacyRules.avoidTithiPatterns },
    nakshatra: { preferred: legacyRules.preferredNakshatras, avoid: legacyRules.avoidNakshatras },
    coverage: { tithi: 'REUSABLE_BASE_RULE', nakshatra: 'REUSABLE_BASE_RULE', yoga: 'IMPLEMENTED', karana: 'IMPLEMENTED', windows: 'IMPLEMENTED' },
    reusedFromLegacyFamily: legacyFamily,
    metadata: { methodologyVersion: 1, note: `Reuses ${legacyFamily}'s existing rule data (${legacyRules.note}) as a family-level base -- no ${classification.intent}-specific Tithi/Nakshatra data exists yet.` },
  };
}

/**
 * Support-level determination (brief section 6): driven by rule-pack
 * coverage, NOT merely evaluationDepth. A CEREMONIAL activity (Engagement,
 * Griha Pravesh) needs BOTH Tithi and Nakshatra to be genuinely dedicated
 * (IMPLEMENTED, i.e. from an intent-specific override) to reach SUPPORTED --
 * a reused family base or missing data both fall short of the "sufficient
 * Panchanga evidence" bar for a ceremonial result (brief section 8), so both
 * land at PARTIAL. A non-CEREMONIAL activity only needs SOME core signal
 * (not both MISSING) to reach SUPPORTED -- REUSABLE_BASE_RULE is an
 * acceptable bar there, consistent with how start-journey/financial-decision
 * have always worked (family-level data only, no dedicated intent override,
 * and already exposed in Muhurtham Finder before this PR).
 */
export function computeMuhurtaSupportLevel(classification: MuhurtaClassification, pack: MuhurtaRulePack): MuhurtaSupportLevel {
  const tithiOk = pack.coverage.tithi !== 'MISSING';
  const nakshatraOk = pack.coverage.nakshatra !== 'MISSING';
  const bothDedicated = pack.coverage.tithi === 'IMPLEMENTED' && pack.coverage.nakshatra === 'IMPLEMENTED';

  if (classification.evaluationDepth === 'CEREMONIAL') {
    return bothDedicated ? 'SUPPORTED' : 'PARTIAL';
  }
  if (!tithiOk && !nakshatraOk) return 'NOT_YET_SUPPORTED';
  return 'SUPPORTED';
}

/**
 * Generic rule-pack-driven Muhurta evaluator -- the "evaluate rules
 * generically" counterpart to muhurtaEngine.ts's legacy, per-family
 * evaluateMuhurta(). Reuses the exact same yoga/karana/window helper
 * functions (no duplicated scoring logic); only the Tithi/Nakshatra source
 * differs (the resolved rule pack instead of RULES[family]).
 *
 * Used by evaluateActivityFit() (auraFitEngine.ts) ONLY when the legacy
 * family-keyed path would have no legitimate data to fall back on (today:
 * only Griha Pravesh, whose family has no FAMILY_BASE_SOURCE entry) -- see
 * that file's own doc comment for why this is gated rather than applied
 * universally (zero regression risk for every other activity).
 */
export function evaluateMuhurtaWithRulePack(params: {
  classification: MuhurtaClassification;
  date: Date;
  windowType: SolarWindowType;
}): MuhurtaEvaluation {
  const pack = resolveMuhurtaRulePack(params.classification);
  const legacyFamilyForWindowBonus = FAMILY_BASE_SOURCE[params.classification.family];
  const panchanga = getPanchangaSnapshot(params.date);

  const reasons: MuhurtaReason[] = [
    ...evaluatePanchangaNakshatraTithiReasons(panchanga, {
      preferredNakshatras: pack.nakshatra.preferred,
      avoidNakshatras: pack.nakshatra.avoid,
      preferredTithiPatterns: pack.tithi.preferredPatterns,
      avoidTithiPatterns: pack.tithi.avoidPatterns,
      note: pack.metadata.note,
    }),
    ...evaluatePanchangaYogaKaranaReasons(panchanga),
  ];

  const windowReason = evaluateSolarWindowReason(params.windowType, legacyFamilyForWindowBonus);
  if (windowReason) reasons.push(windowReason);

  const modifier = reasons.reduce((total, reason) => total + (reason.impact ?? 0), 0);
  const legacy = deriveLegacyMuhurtaText(reasons);

  return {
    family: legacyFamilyForWindowBonus ?? 'FOCUSED_WORK',
    panchanga,
    modifier,
    reasons,
    blockers: legacy.blockers,
    supports: legacy.supports,
    summary: legacy.summary,
  };
}
