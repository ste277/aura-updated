/**
 * Lunar Intelligence V1 — L3: the first BEHAVIORAL layer.
 *
 * This module owns TRADITIONAL INTERPRETATION of a Tithi family (which
 * lunarTithiContext.ts explicitly does not -- that module is classification
 * only). It performs no astronomy, no new calculation: it consumes an
 * already-built LunarTithiContext (packages/muhurta/src/lunarTithiContext.ts)
 * plus an activity's MuhurtaClassification and an explicit ActionPhase, and
 * decides whether a traditional Tithi-family rule applies.
 *
 * SCOPE (Lunar Intelligence V1 L3, first slice): exactly one rule --
 *   RIKTA family + an explicit START phase + a narrow, source-confirmed set
 *   of important/new-beginning MuhurtaIntent values -> a TITHI CAUTION.
 * No support-side rule, no exact-Tithi rule, no other family, no other
 * phase. See this module's own RIKTA_START_CAUTION_RULE for the exact,
 * narrow set of applicable intents and why each was included (and why
 * NEW_BEGINNING, which sounded plausible, is NOT one of them -- it is a
 * legacy MuhurtaActivityFamily, not a MuhurtaIntent; see activityOntology.ts).
 *
 * PRECEDENCE, as of Lunar Intelligence V1 L4 (enforced by this module's own
 * applyLunarTithiOverlay, the ONE shared entry point both evaluation paths
 * call -- see that function's own doc comment below):
 *
 *   dedicated intent Tithi (coverage.tithi === 'IMPLEMENTED')
 *   > exact-Tithi special case (lunarExactTithiRules.ts, e.g. Amavasya)
 *   > Tithi-family rule (this module's own RIKTA_START_CAUTION_RULE)
 *   > reusable legacy/family-base Tithi
 *
 * A dedicated intent-specific rule pack (Griha Pravesh, Marriage) always
 * owns the Tithi factor for its own intent outright -- neither this
 * module's resolver nor lunarExactTithiRules.ts's is even invoked when
 * that's true. Below that, an exact-Tithi match always wins over a
 * family-level match when both could in principle apply (see
 * applyLunarTithiOverlay: it tries the exact resolver first).
 *
 * EXTENSIBILITY WITHOUT REWRITING THE EVALUATOR: `resolveLunarFamilyReason`
 * returns the FIRST rule in `LUNAR_FAMILY_RULES` that matches. A future,
 * more specific family-level rule (e.g. a Rikta FINISH/removal-support rule
 * once the activity ontology can identify that reliably) only needs to be
 * placed earlier in that array -- the "most specific match wins" precedence
 * this module's own design audit called for falls out of ordinary list
 * order, with no change to the resolver's control flow and no change to any
 * caller. A future EXACT-Tithi rule, by contrast, belongs in
 * lunarExactTithiRules.ts, not here -- see this module's own applyLunarTithiOverlay for why that module is deliberately kept separate.
 */

import type { LunarTithiContext, TithiFamily } from './lunarTithiContext';
import type { ActionPhase } from './actionPhase';
import type { MuhurtaClassification, MuhurtaIntent, MuhurtaReason } from './activityOntology';
import type { MuhurtaRuleSource, MuhurtaRuleConfidence, MuhurtaRuleScope } from './muhurtaRulePacks';
import { resolveLunarExactTithiReason } from './lunarExactTithiRules';

/**
 * Provenance for a lunar-family rule -- deliberately reuses the exact same
 * field types every existing MuhurtaRulePack already uses (MuhurtaRuleSource/
 * MuhurtaRuleConfidence/MuhurtaRuleScope, packages/muhurta/src/muhurtaRulePacks.ts),
 * rather than a second, incompatible provenance vocabulary. This is a
 * type-only import specifically so this module never creates a runtime
 * circular dependency with muhurtaRulePacks.ts, which imports a VALUE
 * (resolveLunarFamilyReason) from this module.
 */
export interface LunarFamilyRuleMetadata {
  sources: MuhurtaRuleSource[];
  confidence: MuhurtaRuleConfidence;
  scope: MuhurtaRuleScope;
  lastReviewed: string;
  note: string;
}

/**
 * The smallest rule representation this slice needs. Deliberately NOT a
 * generic rule-engine shape: no PakshaBand dimension (the research does not
 * support treating band as a rule key -- see the L3 design audit), no
 * exact-Tithi field yet (see this module's own doc comment on extensibility
 * above), no MuhurtaFamily dimension (a lunar rule keys on the precise
 * MuhurtaIntent it applies to, not the broad activity family -- see
 * RIKTA_START_CAUTION_RULE's own comment for why).
 */
export interface LunarFamilyRule {
  /** Stable identifier for provenance/audit purposes, mirroring MuhurtaRulePack.id's convention. */
  id: string;
  tithiFamily: TithiFamily;
  /** The exact MuhurtaIntent values this rule may apply to -- never inferred, never "anything important-sounding". */
  applicableIntents: MuhurtaIntent[];
  /** The ActionPhase values this rule applies to. A rule with this set never matches an undefined actionPhase (see
   * resolveLunarFamilyReason below) -- there is no phase-agnostic rule in this slice, so this is always populated,
   * but the field stays optional in the type to match the L3 design audit's own recommended shape for a future
   * phase-agnostic rule (absent = applies regardless of phase, including when actionPhase is undefined). */
  actionPhases?: ActionPhase[];
  factor: 'TITHI';
  /** Only CAUTION exists in this slice -- typed narrowly rather than as a wider polarity union, since nothing here
   * produces SUPPORT yet (no speculative API surface: see MuhurtaReasonCode's own new 'TITHI_FAMILY_CAUTION' value,
   * added without a matching 'TITHI_FAMILY_SUPPORT'). */
  polarity: 'CAUTION';
  /** Reuses the existing standard Tithi-caution magnitude (TITHI_UNFAVORABLE's own impact, muhurtaEngine.ts) --
   * this rule contributes to the SAME existing Muhurta modifier, never a second lunar-specific score. */
  impact: number;
  /** Short phrase threaded into the reason's params, matching the terse style of MuhurtaRulePack.reasonNote --
   * never long enough to be display prose on its own (formatting lives in muhurtaReasonFormat.ts). */
  reasonNote: string;
  metadata: LunarFamilyRuleMetadata;
}

/**
 * Lunar Intelligence V1 L3's one rule.
 *
 * Applicable intents -- the narrow, source-confirmed set from the L3 design
 * audit, re-verified directly against the CURRENT MuhurtaIntent union
 * (packages/muhurta/src/activityOntology.ts) before this file was written:
 *
 *   PROJECT_START  -- WORK family, an important project's own commencement.
 *   BUSINESS_START -- BUSINESS family, a business's own commencement.
 *   JOURNEY_START  -- TRAVEL family, a significant journey's own commencement.
 *
 * NEW_BEGINNING was a candidate in the design audit but does NOT exist as a
 * MuhurtaIntent -- it is a legacy MuhurtaActivityFamily (muhurtaEngine.ts)
 * that free-text classification maps, via legacyFamilyToIntent(), to the
 * MuhurtaIntent 'PROJECT_START' (already included above). Including a
 * non-existent intent name would silently never match anything, so it is
 * correctly omitted rather than invented.
 *
 * GRIHA_PRAVESH and MARRIAGE are deliberately NOT included here even though
 * they are important/new-beginning-shaped: both already carry their own
 * dedicated, provenance-backed Tithi rule packs (INTENT_RULE_PACKS,
 * muhurtaRulePacks.ts) whose coverage.tithi is IMPLEMENTED, so the caller
 * (evaluateMuhurtaWithRulePack) never even invokes this module's resolver
 * for them -- their dedicated coverage makes this generic rule structurally
 * unreachable for those two intents regardless of whether they were listed.
 * They are excellent test fixtures for exactly that reason (see
 * test/lunarFamilyRules.test.ts and the integration tests), not because
 * they were considered and excluded on their own traditional merits.
 *
 * ADMIN, IMPORTANT_FINANCIAL_DECISION, INVESTMENT and PROPERTY_PURCHASE are
 * deliberately excluded per the design audit: ADMIN's own legacy rule
 * already treats Chaturthi (a Rikta tithi) as FAVORABLE for routine cleanup
 * (muhurtaEngine.ts's RULES.ADMIN), a live, intentional divergence this
 * rule must not contradict; IMPORTANT_FINANCIAL_DECISION collapses several
 * semantically different activities (investment, loan, contract-signing)
 * with no way to isolate "an important new financial commitment" from the
 * others; PROPERTY_PURCHASE was not confirmed by the audit as carrying the
 * same "important new beginning" traditional framing as a project/business/
 * journey commencement, so it is left for a deliberate future decision
 * rather than included by resemblance.
 */
export const RIKTA_START_CAUTION_RULE: LunarFamilyRule = {
  id: 'RIKTA_START_CAUTION_V1',
  tithiFamily: 'RIKTA',
  applicableIntents: ['PROJECT_START', 'BUSINESS_START', 'JOURNEY_START'],
  actionPhases: ['START'],
  factor: 'TITHI',
  polarity: 'CAUTION',
  impact: -8,
  reasonNote: 'a Rikta Tithi is traditionally considered less suitable for starting this kind of important undertaking',
  metadata: {
    sources: [
      {
        id: 'rikta-tithi-removal-orientation',
        title: 'Rikta Tithi (4th/9th/14th) -- traditional removal/corrective orientation, not new-beginning support',
        sourceType: 'TRADITIONAL_REFERENCE',
        citation: 'Contemporary Panchang-methodology reference material on the Nanda/Bhadra/Jaya/Rikta/Purna Tithi classification (the same research model underlying the Lunar Intelligence V1 L1 audit)',
        notes: 'Rikta ("empty") tithis are widely characterized as suited to removal, clearing and corrective action rather than ordinary auspicious new beginnings; this rule encodes only the well-attested caution-for-new-starts side, not the (unimplemented) removal-support side, which the current activity ontology cannot yet identify reliably (see the L3 design audit).',
      },
    ],
    confidence: 'CURATED',
    scope: 'GENERAL',
    lastReviewed: '2026-09-28',
    note: 'First Lunar Intelligence V1 behavioral rule: a narrow, explicitly-scoped START-only caution for Rikta tithis on a small, source-confirmed set of important-new-beginning intents. Deliberately does not claim to represent every activity a Rikta tithi might traditionally caution against.',
  },
};

const LUNAR_FAMILY_RULES: LunarFamilyRule[] = [RIKTA_START_CAUTION_RULE];

/**
 * Resolves at most one traditional lunar-family Tithi reason for a given
 * evaluation, or null if no rule applies.
 *
 * `actionPhase === undefined` NEVER matches a phase-restricted rule (a rule
 * whose `actionPhases` is set) -- there is no default phase and no
 * inference here. A rule with `actionPhases` left unset would apply
 * regardless of phase (including undefined), but no such rule exists in
 * this slice.
 */
export function resolveLunarFamilyReason(
  lunarContext: LunarTithiContext,
  classification: MuhurtaClassification,
  actionPhase: ActionPhase | undefined
): MuhurtaReason | null {
  for (const rule of LUNAR_FAMILY_RULES) {
    if (rule.tithiFamily !== lunarContext.family) continue;
    if (!rule.applicableIntents.includes(classification.intent)) continue;
    if (rule.actionPhases !== undefined && (actionPhase === undefined || !rule.actionPhases.includes(actionPhase))) continue;
    return {
      code: 'TITHI_FAMILY_CAUTION',
      factor: rule.factor,
      polarity: rule.polarity,
      impact: rule.impact,
      value: rule.tithiFamily,
      // actionPhase is only included when defined -- a future phase-agnostic rule (actionPhases left unset) could
      // still match an undefined actionPhase, and params must never carry an `undefined` value (MuhurtaReason.params
      // is Record<string, string | number | boolean>).
      params: { intent: classification.intent, note: rule.reasonNote, ...(actionPhase !== undefined ? { actionPhase } : {}) },
    };
  }
  return null;
}

/** Removes any existing reason whose factor is 'TITHI' and appends `newReason` in its place -- shared by both match
 * branches of applyLunarTithiOverlay below, so the result never carries more than one TITHI-factor reason no matter
 * which layer (exact or family) produced it. Every non-TITHI reason is preserved exactly, in its original order. */
function replaceTithiReason(reasons: MuhurtaReason[], newReason: MuhurtaReason): MuhurtaReason[] {
  return [...reasons.filter((reason) => reason.factor !== 'TITHI'), newReason];
}

/**
 * Lunar Intelligence V1 L3.2/L4 -- the ONE shared, evaluator-independent entry point for applying BOTH the
 * exact-Tithi (lunarExactTithiRules.ts) and Tithi-family (this module) layers to an already-computed set of
 * MuhurtaReasons, as a single deterministic Tithi-precedence operation. Both evaluation paths (the rule-pack path,
 * evaluateMuhurtaWithRulePack, and the legacy path, evaluateActivityFit's own legacy evaluateMuhurta() branch) call
 * this SAME function on their own output -- never a second, separately-maintained copy of the suppression/precedence
 * logic, and never the exact and family layers applied independently (which could otherwise leave a stale/duplicate
 * TITHI reason if both happened to match on the same input). This is a pure function: it does no astronomy, no
 * Panchang read, no classification resolution -- the caller has already done all of that and hands in exactly what's
 * needed.
 *
 * PRECEDENCE, enforced here (matching this module's own top-of-file doc comment):
 *   dedicated intent Tithi (tithiCoverage === 'IMPLEMENTED')
 *   > exact-Tithi special case (resolveLunarExactTithiReason, tried FIRST)
 *   > Tithi-family rule (resolveLunarFamilyReason, tried only if the exact resolver found nothing)
 *   > reusable/legacy Tithi (neither resolver matches -- `reasons` returned unchanged).
 *
 * IDENTITY (returns `reasons` completely unchanged -- same array reference, not a copy) whenever:
 *   - lunarContext is null (nothing to resolve against -- see callers: null exactly when tithiCoverage is
 *     'IMPLEMENTED', since a dedicated pack already owns the Tithi factor and lunarTithiContext is never built)
 *   - tithiCoverage is 'IMPLEMENTED' (dedicated pack owns Tithi outright -- protects Griha Pravesh/Marriage)
 *   - neither the exact resolver nor the family resolver matches (wrong phase, wrong Tithi/family, or an
 *     unsupported intent -- each resolver's own "no inference, ever" contract, unchanged)
 *
 * MATCH behavior: exactly one of the two resolvers' output (whichever matched, exact taking priority) replaces any
 * existing 'TITHI'-factor reason via replaceTithiReason() above -- the result NEVER carries more than one
 * TITHI-factor reason. Every non-TITHI reason (Nakshatra/Yoga/Karana/solar-window/activity/personal) is preserved
 * exactly, in its original order, untouched.
 */
export function applyLunarTithiOverlay(
  reasons: MuhurtaReason[],
  tithiCoverage: 'IMPLEMENTED' | 'REUSABLE_BASE_RULE' | 'MISSING',
  lunarContext: LunarTithiContext | null,
  classification: MuhurtaClassification,
  actionPhase: ActionPhase | undefined
): MuhurtaReason[] {
  if (tithiCoverage === 'IMPLEMENTED' || lunarContext === null) return reasons;
  const exactReason = resolveLunarExactTithiReason(lunarContext, classification, actionPhase);
  if (exactReason !== null) return replaceTithiReason(reasons, exactReason);
  const familyReason = resolveLunarFamilyReason(lunarContext, classification, actionPhase);
  if (familyReason !== null) return replaceTithiReason(reasons, familyReason);
  return reasons;
}
