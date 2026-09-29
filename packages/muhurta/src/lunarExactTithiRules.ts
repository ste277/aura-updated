/**
 * Lunar Intelligence V1 — L4: the first EXACT-TITHI behavioral layer.
 *
 * This module owns traditional interpretation of a SPECIFIC named Tithi
 * (e.g. Amavasya), distinct from lunarFamilyRules.ts's TithiFamily-level
 * rules (Nanda/Bhadra/Jaya/Rikta/Purna). Amavasya cannot be expressed
 * honestly as a TithiFamily rule: buildLunarTithiContext('Amavasya') lands
 * in the PURNA family (ordinal 15 of Krishna Paksha, per lunarTithiContext.ts's
 * own ordinal-mod-5 arithmetic) — the SAME family as an ordinary Panchami or
 * Dashami — purely as an artifact of that arithmetic, not a deliberate
 * traditional claim that Amavasya belongs with them. A rule keyed on
 * TithiFamily would either miss Amavasya's own distinct significance or
 * (worse) accidentally also fire on Panchami/Dashami. This module matches
 * the canonical Tithi NAME directly instead (LunarTithiContext.tithiName),
 * never the family or ordinal.
 *
 * SCOPE (Lunar Intelligence V1 L4, first slice): exactly one rule --
 *   Amavasya + an explicit START phase + a narrow, evidence-confirmed set of
 *   important/new-beginning MuhurtaIntent values -> a TITHI CAUTION.
 * See AMAVASYA_START_CAUTION_RULE's own comment for the evidence trail (the
 * L4.1 Amavasya Behavioral Evidence Audit) and why the rule is START-only:
 * every source found frames the restriction in Muhurta/commencement-timing
 * terms ("excluded from Good Muhurat timings", "avoided for celebratory
 * beginnings") -- none addressed continuing, finishing, preparing for, or
 * reviewing an activity already underway, so none of those phases are
 * inferred or extrapolated to.
 *
 * PRECEDENCE (enforced by the CALLER, packages/muhurta/src/lunarFamilyRules.ts's
 * applyLunarTithiOverlay, not by this module): a dedicated intent-specific
 * rule pack (Griha Pravesh, Marriage) always owns the Tithi factor for its
 * own intent outright, and an exact-Tithi match here always takes
 * precedence over a TithiFamily-level match (lunarFamilyRules.ts) when both
 * could apply -- this module is never even asked to resolve a reason when
 * dedicated coverage exists.
 *
 * Deliberately NOT merged into lunarFamilyRules.ts's LunarFamilyRule shape:
 * an exact-Tithi rule keys on a Tithi NAME, a family rule keys on a
 * TithiFamily -- conflating the two into one generic "either a name or a
 * family" rule shape would be exactly the kind of speculative mega-abstraction
 * this program's design audits have repeatedly avoided. Two small, honest
 * rule shapes, one resolver each, one shared overlay that tries the more
 * specific one first.
 */

import type { LunarTithiContext } from './lunarTithiContext';
import type { ActionPhase } from './actionPhase';
import type { MuhurtaClassification, MuhurtaIntent, MuhurtaReason } from './activityOntology';
import type { MuhurtaRuleSource, MuhurtaRuleConfidence, MuhurtaRuleScope } from './muhurtaRulePacks';

/**
 * Provenance for an exact-Tithi rule -- structurally identical to
 * lunarFamilyRules.ts's own LunarFamilyRuleMetadata (same underlying
 * MuhurtaRuleSource/MuhurtaRuleConfidence/MuhurtaRuleScope vocabulary), but
 * declared locally rather than imported from that sibling module, so this
 * file has no dependency on lunarFamilyRules.ts in either direction (it is
 * lunarFamilyRules.ts that will import FROM this module, not the reverse --
 * see applyLunarTithiOverlay there). Type-only imports of the shared
 * provenance vocabulary from muhurtaRulePacks.ts only, matching that
 * module's own "never a runtime circular dependency" discipline.
 */
export interface LunarExactTithiRuleMetadata {
  sources: MuhurtaRuleSource[];
  confidence: MuhurtaRuleConfidence;
  scope: MuhurtaRuleScope;
  lastReviewed: string;
  note: string;
}

/**
 * The smallest exact-Tithi rule representation this slice needs. Keys on
 * the canonical Tithi NAME (LunarTithiContext.tithiName) directly -- never
 * on TithiFamily, ordinal, or Paksha alone -- so a rule here can never
 * accidentally also match a different Tithi that happens to share a family
 * or ordinal (see this module's own doc comment on the Amavasya/PURNA
 * collision this exists to avoid).
 */
export interface LunarExactTithiRule {
  /** Stable identifier for provenance/audit purposes, mirroring LunarFamilyRule.id's convention. */
  id: string;
  /** The exact canonical Tithi name this rule matches (must be one of TITHI_NAMES, packages/vedic/src/panchangElements.ts). */
  tithiName: string;
  /** The exact MuhurtaIntent values this rule may apply to -- never inferred, never "anything important-sounding". */
  applicableIntents: MuhurtaIntent[];
  /** The ActionPhase values this rule applies to. A rule with this set never matches an undefined actionPhase (see
   * resolveLunarExactTithiReason below) -- there is no phase-agnostic rule in this slice, so this is always
   * populated for the one rule that exists, but the field stays optional to match LunarFamilyRule's own shape. */
  actionPhases?: ActionPhase[];
  factor: 'TITHI';
  /** Only CAUTION exists in this slice -- no TITHI_EXACT_SUPPORT counterpart yet (see activityOntology.ts's own
   * comment on MuhurtaReasonCode's 'TITHI_EXACT_CAUTION' value). */
  polarity: 'CAUTION';
  /** A product/scoring-consistency choice (the L4.1 evidence audit found no quantitative weighting in any source),
   * not a traditional or textual numeric value -- placed in the same existing caution weight class as L3's Rikta
   * START caution (lunarFamilyRules.ts's RIKTA_START_CAUTION_RULE) purely for consistency. */
  impact: number;
  /** Short phrase threaded into the reason's params, matching LunarFamilyRule.reasonNote's terse style -- formatting
   * itself lives in muhurtaReasonFormat.ts. */
  reasonNote: string;
  metadata: LunarExactTithiRuleMetadata;
}

/**
 * Lunar Intelligence V1 L4's one rule.
 *
 * Evidence trail (AURA — LUNAR INTELLIGENCE V1 — L4.1 AMAVASYA BEHAVIORAL
 * EVIDENCE AUDIT, verdict: L4 AMAVASYA RULE EVIDENCE READY):
 *
 *   - DrikPanchang (Tier 2, an established Panchang reference this codebase
 *     already treats as its most textually rigorous source for Marriage):
 *     "Krishna Amavasya, being Pitra Tithi, is not considered good for most
 *     auspicious activities. Hence it is excluded from Good Muhurat
 *     timings." -- explicitly a Muhurat/commencement-timing-selection claim,
 *     never a whole-day/ongoing-activity claim.
 *   - Multiple Tier 3-4 contemporary Panchang/Muhurta reference sources
 *     independently corroborate the same commencement-only framing for new
 *     ventures, business launches and journey departures specifically (not
 *     routine/ongoing work, which no source addressed).
 *   - No source, at any tier, discussed continuing, finishing, preparing
 *     for, or reviewing an activity already underway -- total silence, not
 *     evidence of neutrality, hence the rule matches ONLY actionPhase ===
 *     'START' and never infers a broader scope.
 *
 * Applicable intents -- the same narrow set L3's RIKTA_START_CAUTION_RULE
 * uses, independently re-derived here from Amavasya-specific evidence
 * (the L4.1 audit's own intent-by-intent table) rather than copied:
 *
 *   PROJECT_START  -- directly evidenced ("new ventures", "auspicious work").
 *   BUSINESS_START -- directly evidenced ("launching a business", excluded
 *                     from Good Muhurat).
 *   JOURNEY_START  -- directly and specifically evidenced (a dedicated
 *                     journey-Tithi source names Amavasya explicitly).
 *
 * GRIHA_PRAVESH and MARRIAGE are deliberately NOT included: both already
 * carry their own dedicated, provenance-backed Tithi rule packs
 * (INTENT_RULE_PACKS, muhurtaRulePacks.ts) whose coverage.tithi is
 * IMPLEMENTED, so the caller (applyLunarTithiOverlay) never even invokes
 * this module's resolver for them. Marriage's own dedicated pack
 * deliberately does NOT avoid Amavasya (its own Marriage-specific
 * DrikPanchang sourcing found only the three Rikta tithis prohibited) --
 * the L4.1 audit found this in tension with more generic wedding-avoidance
 * guidance but explicitly did not resolve that tension or touch Marriage's
 * data; this rule must not and does not touch it either.
 *
 * IMPORTANT_FINANCIAL_DECISION and PROPERTY_PURCHASE were found evidenced
 * too ("big investments", "large purchases" both directly named) but
 * deliberately left OUT of this first slice -- the L4.1 audit treated that
 * as a narrower-vs-wider judgment call for implementation to make
 * explicitly, not something the research alone settles, and this slice
 * takes the narrowest option (the 3-intent core set already established by
 * L3) rather than presupposing the wider one.
 */
export const AMAVASYA_START_CAUTION_RULE: LunarExactTithiRule = {
  id: 'AMAVASYA_START_CAUTION_V1',
  tithiName: 'Amavasya',
  applicableIntents: ['PROJECT_START', 'BUSINESS_START', 'JOURNEY_START'],
  actionPhases: ['START'],
  factor: 'TITHI',
  polarity: 'CAUTION',
  impact: -8,
  reasonNote: 'Amavasya is traditionally treated with more care for important new beginnings',
  metadata: {
    sources: [
      {
        id: 'drikpanchang-krishna-amavasya-good-muhurat',
        title: 'Krishna Amavasya Tithi -- Good Muhurat exclusion',
        sourceType: 'TRADITIONAL_REFERENCE',
        citation: 'https://www.drikpanchang.com/panchang/tithi/daily/krishna-amavasya-date-time.html',
        notes: '"Krishna Amavasya, being Pitra Tithi, is not considered good for most auspicious activities. Hence it is excluded from Good Muhurat timings." An established Panchang reference (the same source this codebase already treats as most textually rigorous for the Marriage rule pack); frames the exclusion in Muhurat/commencement-timing-selection terms specifically, not as a whole-day prohibition.',
      },
      {
        id: 'astromedha-tithis-to-avoid-amavasya',
        title: 'Tithis to Avoid for Auspicious Work -- Amavasya vs. Rikta tithis',
        sourceType: 'TRADITIONAL_REFERENCE',
        citation: 'https://astromedha.in/insights/vedic/tithis-to-avoid-for-auspicious-work',
        notes: 'Amavasya "generally avoided for celebratory beginnings"; explicitly distinguishes it from the Rikta tithis (which some traditions use for removal/ending tasks) and names weddings/griha pravesh/business launch/large purchases as commonly rescheduled off Amavasya.',
      },
      {
        id: 'astroshastra-journeys-muhurta-amavasya',
        title: 'Journeys, Travels (Muhurta) -- inauspicious tithi list',
        sourceType: 'TRADITIONAL_REFERENCE',
        citation: 'https://www.astroshastra.com/Muhurta/travelsmuhurta.php',
        notes: 'Amavasya explicitly listed among tithis inauspicious for journeys, alongside the 6th/8th/12th, Pratipada, Purnima and the Rikta tithis -- corroborates JOURNEY_START independently of the general new-beginning framing above.',
      },
    ],
    confidence: 'CURATED',
    scope: 'GENERAL',
    lastReviewed: '2026-09-29',
    note: 'First Lunar Intelligence V1 exact-Tithi behavioral rule: a narrow, explicitly-scoped START-only caution for Amavasya on the same 3-intent core set L3 already established for Rikta, independently re-confirmed by the L4.1 evidence audit. Impact (-8) reuses L3\'s existing caution weight class as a product-consistency decision, not a value derived from any source.',
  },
};

const LUNAR_EXACT_TITHI_RULES: LunarExactTithiRule[] = [AMAVASYA_START_CAUTION_RULE];

/**
 * Resolves at most one exact-Tithi lunar reason for a given evaluation, or
 * null if no rule applies.
 *
 * Matches on `lunarContext.tithiName` directly -- the canonical Tithi
 * identity already present in the context, exactly as built by
 * buildLunarTithiContext() from the already-computed Panchang Tithi name.
 * No astronomy, no Panchang recomputation, no inference from `family`
 * (PURNA), `ordinal` (15) or `paksha` (Krishna) alone -- any of those would
 * also match Purnima (also PURNA, ordinal 15, but Shukla) or an ordinary
 * Panchami/Dashami (also PURNA-adjacent by the same ordinal-mod-5
 * arithmetic), which this rule must never do.
 *
 * `actionPhase === undefined` NEVER matches a phase-restricted rule (a rule
 * whose `actionPhases` is set) -- there is no default phase and no
 * inference here, mirroring resolveLunarFamilyReason's own contract exactly.
 */
export function resolveLunarExactTithiReason(
  lunarContext: LunarTithiContext,
  classification: MuhurtaClassification,
  actionPhase: ActionPhase | undefined
): MuhurtaReason | null {
  for (const rule of LUNAR_EXACT_TITHI_RULES) {
    if (rule.tithiName !== lunarContext.tithiName) continue;
    if (!rule.applicableIntents.includes(classification.intent)) continue;
    if (rule.actionPhases !== undefined && (actionPhase === undefined || !rule.actionPhases.includes(actionPhase))) continue;
    return {
      code: 'TITHI_EXACT_CAUTION',
      factor: rule.factor,
      polarity: rule.polarity,
      impact: rule.impact,
      value: rule.tithiName,
      // actionPhase is only included when defined -- MuhurtaReason.params is Record<string, string | number | boolean>
      // and must never carry an `undefined` value.
      params: { intent: classification.intent, note: rule.reasonNote, ...(actionPhase !== undefined ? { actionPhase } : {}) },
    };
  }
  return null;
}
