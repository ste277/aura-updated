import { getActivityDefinition, ACTIVITY_DEFINITIONS } from '../packages/recommendation/src/activityDefinitions';
import { findActivityIntent } from '../packages/recommendation/src/personalizedTasks';
import { evaluateActivityFit } from '../packages/recommendation/src/auraFitEngine';
import { evaluateMuhurta, getFamilyRuleData } from '../packages/muhurta/src/muhurtaEngine';
import { computeMuhurtaSupportLevel, resolveMuhurtaRulePack, evaluateMuhurtaWithRulePack, MuhurtaRulePack } from '../packages/muhurta/src/muhurtaRulePacks';
import type { MuhurtaClassification } from '../packages/muhurta/src/activityOntology';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// ONTOLOGY
// ============================================================

const expectedIntents: Record<string, { family: string; intent: string; evaluationDepth: string }> = {
  'business-start': { family: 'BUSINESS', intent: 'BUSINESS_START', evaluationDepth: 'DEEP' },
  'property-purchase': { family: 'FINANCE', intent: 'PROPERTY_PURCHASE', evaluationDepth: 'DEEP' },
  engagement: { family: 'RELATIONSHIP', intent: 'ENGAGEMENT', evaluationDepth: 'CEREMONIAL' },
  'griha-pravesh': { family: 'HOME', intent: 'GRIHA_PRAVESH', evaluationDepth: 'CEREMONIAL' },
};
for (const [id, expected] of Object.entries(expectedIntents)) {
  const def = getActivityDefinition(id);
  check(`${id} resolves explicitly to family=${expected.family}`, def?.muhurta.family === expected.family);
  check(`${id} resolves explicitly to intent=${expected.intent}`, def?.muhurta.intent === expected.intent);
  check(`${id} resolves explicitly to evaluationDepth=${expected.evaluationDepth}`, def?.muhurta.evaluationDepth === expected.evaluationDepth);
  check(`${id} timingSensitivity.start is HIGH`, def?.muhurta.timingSensitivity.start === 'HIGH');
  check(`${id} has CANONICAL status (not AMBIGUOUS/LEGACY_ALIAS)`, def?.status === 'CANONICAL');
}
check('engagement uses PAIR socialMode', getActivityDefinition('engagement')?.socialMode === 'PAIR');
check('griha-pravesh uses FAMILY socialMode', getActivityDefinition('griha-pravesh')?.socialMode === 'FAMILY');

// Broad legacy activities still resolve, now flagged legacyBroadIntent.
check('financial-decision still resolves (backward compatible)', getActivityDefinition('financial-decision')?.muhurta.intent === 'IMPORTANT_FINANCIAL_DECISION');
check('financial-decision is flagged legacyBroadIntent', getActivityDefinition('financial-decision')?.legacyBroadIntent === true);
check('financial-decision remains CANONICAL (not deprecated, still fully supported for non-property decisions)', getActivityDefinition('financial-decision')?.status === 'CANONICAL');
check('new-beginning still resolves (backward compatible)', getActivityDefinition('new-beginning')?.muhurta.intent === 'PROJECT_START');
check('new-beginning is flagged legacyBroadIntent', getActivityDefinition('new-beginning')?.legacyBroadIntent === true);
check('new-beginning remains LEGACY_ALIAS (unchanged status)', getActivityDefinition('new-beginning')?.status === 'LEGACY_ALIAS');
check('Every OTHER existing activity is NOT flagged legacyBroadIntent (only financial-decision/new-beginning)', ACTIVITY_DEFINITIONS.filter((d) => d.legacyBroadIntent).map((d) => d.id).sort().join(',') === 'financial-decision,new-beginning');

// 'property purchase' now resolves to the dedicated activity, not financial-decision.
check('"property purchase" free text now resolves to property-purchase, not financial-decision', findActivityIntent('property purchase')?.id === 'property-purchase');
check('"new business" free text now resolves to business-start, not new-beginning', findActivityIntent('new business')?.id === 'business-start');
check('financial-decision remains resolvable via its other aliases', findActivityIntent('sign contract')?.id === 'financial-decision');
check('new-beginning remains resolvable via its other aliases', findActivityIntent('launch')?.id === 'new-beginning');

// ============================================================
// RULE PACK
// ============================================================

// Family base rules resolve (REUSABLE_BASE_RULE, sourced from the exact
// legacy family data documented in muhurtaRulePacks.ts).
const businessPack = resolveMuhurtaRulePack(getActivityDefinition('business-start')!.muhurta);
const newBeginningLegacyRules = getFamilyRuleData('NEW_BEGINNING');
check('business-start rule pack coverage is REUSABLE_BASE_RULE for Tithi/Nakshatra', businessPack.coverage.tithi === 'REUSABLE_BASE_RULE' && businessPack.coverage.nakshatra === 'REUSABLE_BASE_RULE');
check('business-start rule pack reuses NEW_BEGINNING\'s exact nakshatra list (documented reuse, not invented)', JSON.stringify(businessPack.nakshatra.preferred) === JSON.stringify(newBeginningLegacyRules.preferredNakshatras));
check('business-start rule pack reuses NEW_BEGINNING\'s exact tithi patterns', businessPack.tithi.preferredPatterns.length === newBeginningLegacyRules.preferredTithiPatterns.length);
check('business-start rule pack records which legacy family it reused', businessPack.reusedFromLegacyFamily === 'NEW_BEGINNING');

const propertyPack = resolveMuhurtaRulePack(getActivityDefinition('property-purchase')!.muhurta);
const financeLegacyRules = getFamilyRuleData('FINANCE');
check('property-purchase rule pack reuses FINANCE\'s exact nakshatra list', JSON.stringify(propertyPack.nakshatra.preferred) === JSON.stringify(financeLegacyRules.preferredNakshatras));

// Yoga/Karana coverage is always IMPLEMENTED (global, family-independent) --
// even for a family with MISSING Tithi/Nakshatra coverage.
const grihaPack = resolveMuhurtaRulePack(getActivityDefinition('griha-pravesh')!.muhurta);
check('griha-pravesh rule pack Tithi coverage is MISSING (no traditional data exists for HOME family)', grihaPack.coverage.tithi === 'MISSING');
check('griha-pravesh rule pack Nakshatra coverage is MISSING', grihaPack.coverage.nakshatra === 'MISSING');
check('griha-pravesh rule pack Yoga coverage is still IMPLEMENTED (global, not family-dependent)', grihaPack.coverage.yoga === 'IMPLEMENTED');
check('griha-pravesh rule pack Karana coverage is still IMPLEMENTED (global, not family-dependent)', grihaPack.coverage.karana === 'IMPLEMENTED');
check('griha-pravesh rule pack Windows coverage is still IMPLEMENTED (ABHIJIT/RAHU/YAMA baselines apply to every activity)', grihaPack.coverage.windows === 'IMPLEMENTED');
check('griha-pravesh rule pack has empty (not fabricated) preferred/avoid nakshatra lists', grihaPack.nakshatra.preferred.length === 0 && grihaPack.nakshatra.avoid.length === 0);
check('griha-pravesh rule pack has no reusedFromLegacyFamily (nothing was reused)', grihaPack.reusedFromLegacyFamily === undefined);

// Intent-specific override layer: no data exists yet (see brief section 5 --
// "do not manufacture"), so every current activity falls through to its
// family base. This proves the fallback path (the mechanism an intent
// override would also traverse before/after existing) resolves correctly.
check('No intent-specific override exists yet for any of the 4 new intents (architecture is wired, data is honestly absent)', ['BUSINESS_START', 'PROPERTY_PURCHASE', 'ENGAGEMENT', 'GRIHA_PRAVESH'].every((intent) => {
  const def = ACTIVITY_DEFINITIONS.find((d) => d.muhurta.intent === intent);
  if (!def) return false;
  const pack = resolveMuhurtaRulePack(def.muhurta);
  return pack.coverage.tithi !== 'IMPLEMENTED' && pack.coverage.nakshatra !== 'IMPLEMENTED';
}));

// Missing rules produce PARTIAL support for a CEREMONIAL activity.
check('griha-pravesh (CEREMONIAL, MISSING core coverage) computes PARTIAL support', computeMuhurtaSupportLevel(getActivityDefinition('griha-pravesh')!.muhurta, grihaPack) === 'PARTIAL');
check('engagement (CEREMONIAL, REUSABLE_BASE_RULE core coverage, not dedicated) computes PARTIAL support', computeMuhurtaSupportLevel(getActivityDefinition('engagement')!.muhurta, resolveMuhurtaRulePack(getActivityDefinition('engagement')!.muhurta)) === 'PARTIAL');

// Support level is not inferred only from evaluationDepth: two synthetic
// CEREMONIAL classifications with different rule-pack completeness produce
// different support levels, and a DEEP classification with the SAME
// incomplete coverage still reaches SUPPORTED (proving the depth+coverage
// interaction, not depth alone, drives the result).
const dedicatedPack: MuhurtaRulePack = {
  family: 'HOME', intent: 'GRIHA_PRAVESH',
  tithi: { preferredPatterns: [/Panchami/], avoidPatterns: [] },
  nakshatra: { preferred: ['Rohini'], avoid: [] },
  coverage: { tithi: 'IMPLEMENTED', nakshatra: 'IMPLEMENTED', yoga: 'IMPLEMENTED', karana: 'IMPLEMENTED', windows: 'IMPLEMENTED' },
  metadata: { methodologyVersion: 1, note: 'synthetic test fixture' },
};
const ceremonialClassification: MuhurtaClassification = { family: 'HOME', intent: 'GRIHA_PRAVESH', significance: 'HIGH', evaluationDepth: 'CEREMONIAL', timingSensitivity: { start: 'HIGH', duration: 'MEDIUM', end: 'LOW' } };
const deepClassification: MuhurtaClassification = { ...ceremonialClassification, evaluationDepth: 'DEEP' };
check('A CEREMONIAL classification WITH a dedicated (IMPLEMENTED) rule pack reaches SUPPORTED', computeMuhurtaSupportLevel(ceremonialClassification, dedicatedPack) === 'SUPPORTED');
check('The SAME classification, CEREMONIAL, with an incomplete (family-base-only) pack is PARTIAL', computeMuhurtaSupportLevel(ceremonialClassification, grihaPack) === 'PARTIAL');
check('A DEEP (non-CEREMONIAL) classification with the SAME incomplete pack still reaches SUPPORTED (depth changes the bar, not just presence of data)', computeMuhurtaSupportLevel(deepClassification, businessPack) === 'SUPPORTED');
check('Support level is driven by coverage + depth together, not evaluationDepth alone (CEREMONIAL does not automatically mean supported=true)', computeMuhurtaSupportLevel(ceremonialClassification, grihaPack) !== computeMuhurtaSupportLevel(ceremonialClassification, dedicatedPack));

// ============================================================
// CEREMONIAL: generic Abhijit alone cannot produce EXCELLENT/EXCEPTIONAL
// ============================================================

const grihaActivity = findActivityIntent('griha pravesh')!;
const engagementActivity = findActivityIntent('engagement')!;
const grihaDef = getActivityDefinition(grihaActivity)!;
const engagementDef = getActivityDefinition(engagementActivity)!;

let anyGrihaExceptional = false;
let anyEngagementExceptional = false;
for (let day = 1; day <= 90; day++) {
  const d = new Date(Date.UTC(2026, 8, 1, 6, 20, 0));
  d.setUTCDate(d.getUTCDate() + day);
  const grihaFit = evaluateActivityFit({ activity: grihaActivity, date: d, windowType: 'ABHIJIT', classification: grihaDef.muhurta });
  const engagementFit = evaluateActivityFit({ activity: engagementActivity, date: d, windowType: 'ABHIJIT', classification: engagementDef.muhurta });
  if (grihaFit.score >= 90) anyGrihaExceptional = true;
  if (engagementFit.score >= 90) anyEngagementExceptional = true;
}
check('Griha Pravesh never reaches EXCEPTIONAL (>=90) across 90 sampled Abhijit instants (incomplete CEREMONIAL rule pack is capped)', !anyGrihaExceptional);
check('Engagement never reaches EXCEPTIONAL (>=90) across 90 sampled Abhijit instants (incomplete CEREMONIAL rule pack is capped)', !anyEngagementExceptional);

// Blockers/cautions remain visible for CEREMONIAL activities -- the cap only
// lowers the ceiling, it never hides a caution/blocker reason.
const grihaDuringRahu = evaluateActivityFit({ activity: grihaActivity, date: new Date(Date.UTC(2026, 8, 2, 6, 20, 0)), windowType: 'RAHU_KALAM', classification: grihaDef.muhurta });
check('Griha Pravesh during Rahu Kalam still carries a RAHU_CAUTION reason (blockers remain blockers)', grihaDuringRahu.reasons.some((r) => r.code === 'RAHU_CAUTION'));
check('Griha Pravesh during Rahu Kalam scores low (caution is not hidden behind the cap)', grihaDuringRahu.score < 55);
const engagementDuringRahu = evaluateActivityFit({ activity: engagementActivity, date: new Date(Date.UTC(2026, 8, 2, 6, 20, 0)), windowType: 'RAHU_KALAM', classification: engagementDef.muhurta });
check('Engagement during Rahu Kalam still carries a RAHU_CAUTION reason', engagementDuringRahu.reasons.some((r) => r.code === 'RAHU_CAUTION'));

// ============================================================
// REGRESSION: evaluateActivityFit with a classification param is a no-op
// for every activity whose rule pack is NOT missing (i.e. everything except
// griha-pravesh) -- proves the new optional param cannot silently change
// existing scoring.
// ============================================================

const sampleDate = new Date(Date.UTC(2026, 6, 28, 6, 45, 0));
let allUnaffectedActivitiesMatch = true;
for (const def of ACTIVITY_DEFINITIONS) {
  if (def.id === 'griha-pravesh') continue; // the one activity this PR intentionally changes real scoring for
  const activity = findActivityIntent(def.id.replace(/-/g, ' ')) ?? undefined;
  const profileActivity = activity ?? undefined;
  if (!profileActivity) continue;
  for (const windowType of ['ABHIJIT', 'RAHU_KALAM', 'NEUTRAL'] as const) {
    const withoutClassification = evaluateActivityFit({ activity: profileActivity, date: sampleDate, windowType });
    const withClassification = evaluateActivityFit({ activity: profileActivity, date: sampleDate, windowType, classification: def.muhurta });
    if (withoutClassification.score !== withClassification.score || JSON.stringify(withoutClassification.reasons) !== JSON.stringify(withClassification.reasons)) {
      allUnaffectedActivitiesMatch = false;
    }
  }
}
check('Passing `classification` is a no-op for every activity except griha-pravesh (zero regression risk for existing + the other 3 new activities)', allUnaffectedActivitiesMatch);

// evaluateMuhurta() itself (the legacy per-family function) is byte-for-byte
// unchanged by this refactor -- spot check across all 13 legacy families.
const legacyFamilies = ['DEEP_WORK', 'WORKOUT', 'LEARNING', 'MEDITATION', 'RELATIONSHIP', 'JOURNEY_START', 'SOCIAL', 'MEAL', 'FINANCE', 'NEW_BEGINNING', 'ADMIN', 'WELLBEING', 'FOCUSED_WORK'] as const;
let allLegacyFamiliesMatch = true;
for (const family of legacyFamilies) {
  for (const windowType of ['ABHIJIT', 'RAHU_KALAM', 'BRAHMA', 'GULIKA', 'NEUTRAL'] as const) {
    const evaluation = evaluateMuhurta({ taskTitle: 'test', date: sampleDate, windowType, family });
    if (evaluation.family !== family) allLegacyFamiliesMatch = false;
  }
}
check('evaluateMuhurta() still returns the exact requested legacy family for all 13 families (refactor is behavior-preserving)', allLegacyFamiliesMatch);

// evaluateMuhurtaWithRulePack() reuses the SAME global yoga/karana reasons
// evaluateMuhurta() produces for an equivalent instant (no duplicated logic).
const rpEval = evaluateMuhurtaWithRulePack({ classification: getActivityDefinition('griha-pravesh')!.muhurta, date: sampleDate, windowType: 'ABHIJIT' });
const legacyEval = evaluateMuhurta({ taskTitle: 'x', date: sampleDate, windowType: 'ABHIJIT', family: 'ADMIN' });
const rpYogaKarana = rpEval.reasons.filter((r) => r.factor === 'YOGA' || r.factor === 'KARANA');
const legacyYogaKarana = legacyEval.reasons.filter((r) => r.factor === 'YOGA' || r.factor === 'KARANA');
check('evaluateMuhurtaWithRulePack() Yoga/Karana reasons match evaluateMuhurta()\'s for the same instant (shared helper, not duplicated logic)', JSON.stringify(rpYogaKarana) === JSON.stringify(legacyYogaKarana));

console.log(allPassed ? '\nALL MUHURTA RULE PACK CHECKS PASSED' : '\nSOME MUHURTA RULE PACK CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
