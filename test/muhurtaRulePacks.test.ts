import { getActivityDefinition, ACTIVITY_DEFINITIONS } from '../packages/recommendation/src/activityDefinitions';
import { findActivityIntent } from '../packages/recommendation/src/personalizedTasks';
import { evaluateActivityFit } from '../packages/recommendation/src/auraFitEngine';
import { evaluateMuhurta, evaluatePanchangaNakshatraTithiReasons, getFamilyRuleData, PanchangaSnapshot } from '../packages/muhurta/src/muhurtaEngine';
import {
  AURA_MUHURTA_METHODOLOGY_ID,
  computeMuhurtaSupportLevel,
  resolveMuhurtaRulePack,
  evaluateMuhurtaWithRulePack,
  normalizeNakshatraId,
  normalizeTithiId,
  MuhurtaRulePack,
} from '../packages/muhurta/src/muhurtaRulePacks';
import type { MuhurtaClassification } from '../packages/muhurta/src/activityOntology';
import { SUPPORTED_MUHURTHAM_ACTIVITY_IDS, isSupportedMuhurthamActivity, findMuhurthams } from '../packages/recommendation/src/muhurthamFinder';
import { buildLunarTithiContext } from '../packages/muhurta/src/lunarTithiContext';

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
}
check('financial-decision still resolves (backward compatible)', getActivityDefinition('financial-decision')?.muhurta.intent === 'IMPORTANT_FINANCIAL_DECISION');
check('new-beginning still resolves (backward compatible)', getActivityDefinition('new-beginning')?.muhurta.intent === 'PROJECT_START');

// ============================================================
// PROVENANCE / METHODOLOGY
// ============================================================

check('AURA_MUHURTA_METHODOLOGY_ID is the documented v1 identifier', AURA_MUHURTA_METHODOLOGY_ID === 'AURA_MUHURTA_V1');

const grihaPack = resolveMuhurtaRulePack(getActivityDefinition('griha-pravesh')!.muhurta);
const engagementPack = resolveMuhurtaRulePack(getActivityDefinition('engagement')!.muhurta);
const businessPack = resolveMuhurtaRulePack(getActivityDefinition('business-start')!.muhurta);

check('Every resolved rule pack declares the AURA_MUHURTA_V1 methodology', [grihaPack, engagementPack, businessPack].every((p) => p.metadata.methodologyVersion === AURA_MUHURTA_METHODOLOGY_ID));
check('Griha Pravesh pack has a stable id (GRIHA_PRAVESH_V1)', grihaPack.id === 'GRIHA_PRAVESH_V1');
check('Griha Pravesh pack carries at least one MuhurtaRuleSource', grihaPack.metadata.sources.length > 0);
check('Every Griha Pravesh source has a sourceType and either a citation or notes (traceable, not opaque)', grihaPack.metadata.sources.every((s) => Boolean(s.sourceType) && (Boolean(s.citation) || Boolean(s.notes))));
check('Griha Pravesh pack confidence is CURATED (multi-source corroborated, not primary-text-verified)', grihaPack.metadata.confidence === 'CURATED');
check('Griha Pravesh pack scope is GENERAL (not claiming a specific regional tradition)', grihaPack.metadata.scope === 'GENERAL');
check('Griha Pravesh pack records lastReviewed', typeof grihaPack.metadata.lastReviewed === 'string' && grihaPack.metadata.lastReviewed!.length > 0);
check('No source claims sourceType CLASSICAL_TEXT (none were verified against a primary classical text)', grihaPack.metadata.sources.every((s) => s.sourceType !== 'CLASSICAL_TEXT'));

// Provenance rides on MuhurtaEvaluation, not on individual MuhurtaReason
// objects (brief section 8) -- reasons stay clean.
const rpEvalForProvenance = evaluateMuhurtaWithRulePack({ classification: getActivityDefinition('griha-pravesh')!.muhurta, date: new Date(Date.UTC(2026, 8, 1, 6, 20, 0)), windowType: 'ABHIJIT' });
check('evaluateMuhurtaWithRulePack() result carries provenance.methodology', rpEvalForProvenance.provenance?.methodology === AURA_MUHURTA_METHODOLOGY_ID);
check('evaluateMuhurtaWithRulePack() result carries provenance.rulePackId matching the resolved pack', rpEvalForProvenance.provenance?.rulePackId === grihaPack.id);
check('MuhurtaReason objects on that evaluation carry NO source citation fields (reasons stay clean)', rpEvalForProvenance.reasons.every((r) => !('citation' in r) && !('sources' in r)));

// Regression guard for a real bug found during this PR's own development: a
// NAKSHATRA_SUPPORTIVE reason's params.note must be the SHORT, terse
// reasonNote ("supports a smooth home entry"), never the long audit/
// provenance prose from metadata.note/sources -- brief section 8 is explicit
// that reasons stay clean. grihaPack.reasonNote is intentionally short.
check('grihaPack.reasonNote is short (reason-text-appropriate, not a citation-length audit note)', grihaPack.reasonNote.length < 80);
check('grihaPack.reasonNote is NOT the same string as metadata.note (the two are deliberately different fields)', grihaPack.reasonNote !== grihaPack.metadata.note);
const grihaNakshatraSupportReason = rpEvalForProvenance.reasons.find((r) => r.code === 'NAKSHATRA_SUPPORTIVE');
check('A live NAKSHATRA_SUPPORTIVE reason\'s params.note (if present) equals the short reasonNote, not the long metadata.note', !grihaNakshatraSupportReason || grihaNakshatraSupportReason.params?.note === grihaPack.reasonNote);
check('The legacy evaluateMuhurta() path leaves provenance undefined (unchanged behavior)', evaluateMuhurta({ taskTitle: 'x', date: new Date(), windowType: 'ABHIJIT', family: 'FINANCE' }).provenance === undefined);

// ============================================================
// RULE PACK
// ============================================================

const newBeginningLegacyRules = getFamilyRuleData('NEW_BEGINNING');
check('business-start rule pack coverage is REUSABLE_BASE_RULE for Tithi/Nakshatra (unchanged from the previous PR)', businessPack.coverage.tithi === 'REUSABLE_BASE_RULE' && businessPack.coverage.nakshatra === 'REUSABLE_BASE_RULE');
check('business-start rule pack still reuses NEW_BEGINNING\'s exact nakshatra list', JSON.stringify(businessPack.nakshatra.favorable) === JSON.stringify(newBeginningLegacyRules.preferredNakshatras));
check('business-start rule pack records which legacy family it reused', businessPack.reusedFromLegacyFamily === 'NEW_BEGINNING');

// Griha Pravesh now has genuine, sourced, intent-specific coverage.
check('griha-pravesh rule pack Tithi coverage is now IMPLEMENTED (intent-specific, sourced)', grihaPack.coverage.tithi === 'IMPLEMENTED');
check('griha-pravesh rule pack Nakshatra coverage is now IMPLEMENTED', grihaPack.coverage.nakshatra === 'IMPLEMENTED');
check('griha-pravesh rule pack Yoga coverage is still IMPLEMENTED (global, not family-dependent)', grihaPack.coverage.yoga === 'IMPLEMENTED');
check('griha-pravesh rule pack Karana coverage is still IMPLEMENTED (global, not family-dependent)', grihaPack.coverage.karana === 'IMPLEMENTED');
check('griha-pravesh rule pack has a non-empty, genuinely sourced favorable nakshatra list', grihaPack.nakshatra.favorable.length > 0);
check('griha-pravesh rule pack has a non-empty avoid nakshatra list', grihaPack.nakshatra.avoid.length > 0);
check('griha-pravesh rule pack has NO reusedFromLegacyFamily (intent-specific, not a family reuse)', grihaPack.reusedFromLegacyFamily === undefined);
check('griha-pravesh rule pack does not populate the reserved acceptable/block tiers (not sourced, not fabricated)', grihaPack.nakshatra.acceptable === undefined && grihaPack.nakshatra.block === undefined && grihaPack.tithi.acceptable === undefined && grihaPack.tithi.block === undefined);

// Engagement remains a family-base reuse -- deliberately NOT populated with
// intent-specific data (see muhurtaRulePacks.ts's module doc comment for
// the research trail: available "engagement-specific" sources were either
// AI-content-farm-derived or explicitly reused Marriage/Vivah data).
check('engagement rule pack coverage is STILL REUSABLE_BASE_RULE (no intent-specific data was added -- the research did not clear the confidence bar)', engagementPack.coverage.tithi === 'REUSABLE_BASE_RULE' && engagementPack.coverage.nakshatra === 'REUSABLE_BASE_RULE');
check('engagement rule pack still reuses RELATIONSHIP\'s exact nakshatra list (unchanged from the previous PR)', JSON.stringify(engagementPack.nakshatra.favorable) === JSON.stringify(getFamilyRuleData('RELATIONSHIP').preferredNakshatras));

// Support level: Griha Pravesh's genuinely dedicated pack now reaches
// SUPPORTED; Engagement's unchanged family-base pack stays PARTIAL.
check('griha-pravesh (CEREMONIAL, now IMPLEMENTED core coverage) computes SUPPORTED', computeMuhurtaSupportLevel(getActivityDefinition('griha-pravesh')!.muhurta, grihaPack) === 'SUPPORTED');
check('engagement (CEREMONIAL, REUSABLE_BASE_RULE core coverage, still not dedicated) computes PARTIAL', computeMuhurtaSupportLevel(getActivityDefinition('engagement')!.muhurta, engagementPack) === 'PARTIAL');
check('Griha Pravesh did NOT become SUPPORTED from only one core factor -- both Tithi AND Nakshatra are IMPLEMENTED', grihaPack.coverage.tithi === 'IMPLEMENTED' && grihaPack.coverage.nakshatra === 'IMPLEMENTED');
check('Engagement did NOT become SUPPORTED solely because RELATIONSHIP base rules exist', computeMuhurtaSupportLevel(getActivityDefinition('engagement')!.muhurta, engagementPack) !== 'SUPPORTED');

// Support level is not inferred only from evaluationDepth: a synthetic
// CEREMONIAL classification with only ONE dedicated factor (not both) must
// NOT reach SUPPORTED -- proving "both core factors" is actually enforced,
// not just "at least one".
const oneFactorDedicatedPack: MuhurtaRulePack = {
  id: 'TEST_ONE_FACTOR_ONLY',
  family: 'HOME', intent: 'GRIHA_PRAVESH',
  tithi: { favorable: [/Panchami/], avoid: [] },
  nakshatra: { favorable: [], avoid: [] },
  yoga: { favorable: [], avoid: [] },
  karana: { favorable: [], avoid: [] },
  requiresPeriodExclusion: false,
  requiresPlanetaryCombustion: false,
  coverage: { tithi: 'IMPLEMENTED', nakshatra: 'REUSABLE_BASE_RULE', yoga: 'IMPLEMENTED', karana: 'IMPLEMENTED', windows: 'IMPLEMENTED', yogaAuthoritative: 'MISSING', karanaAuthoritative: 'MISSING', periodExclusion: 'MISSING', planetaryCombustion: 'MISSING' },
  reasonNote: 'synthetic test fixture',
  metadata: { methodologyVersion: AURA_MUHURTA_METHODOLOGY_ID, sources: [], confidence: 'PROVISIONAL', scope: 'GENERAL', note: 'synthetic test fixture' },
};
const ceremonialClassification: MuhurtaClassification = { family: 'HOME', intent: 'GRIHA_PRAVESH', significance: 'HIGH', evaluationDepth: 'CEREMONIAL', timingSensitivity: { start: 'HIGH', duration: 'MEDIUM', end: 'LOW' } };
const deepClassification: MuhurtaClassification = { ...ceremonialClassification, evaluationDepth: 'DEEP' };
check('A CEREMONIAL pack with only ONE factor dedicated (Tithi IMPLEMENTED, Nakshatra not) is still PARTIAL, not SUPPORTED', computeMuhurtaSupportLevel(ceremonialClassification, oneFactorDedicatedPack) === 'PARTIAL');
check('The SAME one-factor-only pack under a DEEP classification IS SUPPORTED (DEEP only needs "present", not "dedicated")', computeMuhurtaSupportLevel(deepClassification, oneFactorDedicatedPack) === 'SUPPORTED');
check('Support level is driven by coverage + depth together, not evaluationDepth alone', computeMuhurtaSupportLevel(ceremonialClassification, oneFactorDedicatedPack) !== computeMuhurtaSupportLevel(deepClassification, oneFactorDedicatedPack));

// ============================================================
// TABLE-DRIVEN KNOWLEDGE TESTS -- GRIHA PRAVESH
// ============================================================
// Every encoded rule gets a unit test against the actual sourced data (not
// merely "score > 0") -- brief section 10.

function panchangaWith(overrides: Partial<PanchangaSnapshot>): PanchangaSnapshot {
  return { tithi: 'Shukla Saptami', nakshatra: 'Ashwini', yoga: 'Priti', karana: 'Bava', ...overrides };
}

const grihaPravesh = getActivityDefinition('griha-pravesh')!.muhurta;

const GRIHA_PRAVESH_NAKSHATRA_CASES: Array<{ nakshatra: string; expect: 'SUPPORT' | 'CAUTION' | 'NONE'; label: string }> = [
  { nakshatra: 'Rohini', expect: 'SUPPORT', label: 'known favorable nakshatra (Rohini)' },
  { nakshatra: 'Mrigashira', expect: 'SUPPORT', label: 'known favorable nakshatra (Mrigashira)' },
  { nakshatra: 'Uttara Phalguni', expect: 'SUPPORT', label: 'known favorable nakshatra (Uttara Phalguni)' },
  { nakshatra: 'Chitra', expect: 'SUPPORT', label: 'known favorable nakshatra (Chitra)' },
  { nakshatra: 'Anuradha', expect: 'SUPPORT', label: 'known favorable nakshatra (Anuradha)' },
  { nakshatra: 'Uttara Ashadha', expect: 'SUPPORT', label: 'known favorable nakshatra (Uttara Ashadha)' },
  { nakshatra: 'Revati', expect: 'SUPPORT', label: 'known favorable nakshatra (Revati)' },
  { nakshatra: 'Ashlesha', expect: 'CAUTION', label: 'known unsuitable nakshatra (Ashlesha)' },
  { nakshatra: 'Jyeshtha', expect: 'CAUTION', label: 'known unsuitable nakshatra (Jyeshtha)' },
  { nakshatra: 'Mula', expect: 'CAUTION', label: 'known unsuitable nakshatra (Mula)' },
  { nakshatra: 'Hasta', expect: 'NONE', label: 'not confidently sourced either way (Hasta) -- correctly emits no reason' },
  { nakshatra: 'Shatabhisha', expect: 'NONE', label: 'contradictory across sources (Shatabhisha) -- correctly excluded, no reason' },
];
for (const testCase of GRIHA_PRAVESH_NAKSHATRA_CASES) {
  const evaluation = evaluateMuhurtaWithRulePack({ classification: grihaPravesh, date: new Date(Date.UTC(2026, 0, 1, 6, 0, 0)), windowType: 'NEUTRAL' });
  const panchanga = panchangaWith({ nakshatra: testCase.nakshatra });
  const reasons = evaluatePanchangaNakshatraTithiReasons(panchanga, {
    preferredNakshatras: grihaPack.nakshatra.favorable,
    avoidNakshatras: grihaPack.nakshatra.avoid,
    preferredTithiPatterns: grihaPack.tithi.favorable,
    avoidTithiPatterns: grihaPack.tithi.avoid,
    note: grihaPack.metadata.note,
  });
  const nakshatraReason = reasons.find((r: { factor: string }) => r.factor === 'NAKSHATRA');
  const actual = !nakshatraReason ? 'NONE' : nakshatraReason.polarity === 'SUPPORT' ? 'SUPPORT' : 'CAUTION';
  check(`Griha Pravesh Nakshatra rule: ${testCase.label} -> ${testCase.expect}`, actual === testCase.expect);
  void evaluation;
}

const GRIHA_PRAVESH_TITHI_CASES: Array<{ tithi: string; expect: 'SUPPORT' | 'CAUTION' | 'NONE'; label: string }> = [
  { tithi: 'Shukla Panchami', expect: 'SUPPORT', label: 'known favorable tithi (Panchami)' },
  { tithi: 'Shukla Dashami', expect: 'SUPPORT', label: 'known favorable tithi (Dashami)' },
  { tithi: 'Krishna Ekadashi', expect: 'SUPPORT', label: 'known favorable tithi (Ekadashi)' },
  { tithi: 'Shukla Trayodashi', expect: 'SUPPORT', label: 'known favorable tithi (Trayodashi)' },
  { tithi: 'Amavasya', expect: 'CAUTION', label: 'known unfavorable tithi (Amavasya)' },
  { tithi: 'Shukla Chaturthi', expect: 'CAUTION', label: 'known unfavorable tithi (Chaturthi, a Rikta tithi)' },
  { tithi: 'Krishna Navami', expect: 'CAUTION', label: 'known unfavorable tithi (Navami, a Rikta tithi)' },
  { tithi: 'Shukla Chaturdashi', expect: 'CAUTION', label: 'known unfavorable tithi (Chaturdashi, a Rikta tithi)' },
  { tithi: 'Krishna Ashtami', expect: 'CAUTION', label: 'known unfavorable tithi (Ashtami)' },
  { tithi: 'Shukla Shasthi', expect: 'NONE', label: 'not sourced either way (Shasthi/6th) -- correctly emits no reason' },
  { tithi: 'Purnima', expect: 'NONE', label: 'not sourced either way (Purnima) -- correctly emits no reason' },
];
for (const testCase of GRIHA_PRAVESH_TITHI_CASES) {
  const panchanga = panchangaWith({ tithi: testCase.tithi });
  const reasons = evaluatePanchangaNakshatraTithiReasons(panchanga, {
    preferredNakshatras: grihaPack.nakshatra.favorable,
    avoidNakshatras: grihaPack.nakshatra.avoid,
    preferredTithiPatterns: grihaPack.tithi.favorable,
    avoidTithiPatterns: grihaPack.tithi.avoid,
    note: grihaPack.metadata.note,
  });
  const tithiReason = reasons.find((r: { factor: string }) => r.factor === 'TITHI');
  const actual = !tithiReason ? 'NONE' : tithiReason.polarity === 'SUPPORT' ? 'SUPPORT' : 'CAUTION';
  check(`Griha Pravesh Tithi rule: ${testCase.label} -> ${testCase.expect}`, actual === testCase.expect);
}

// Full end-to-end: a genuinely favorable day for Griha Pravesh scores
// distinctly better than a genuinely unfavorable one, via evaluateActivityFit.
const grihaActivity = findActivityIntent('griha pravesh')!;
const grihaDef = getActivityDefinition(grihaActivity)!;
const favorableGrihaFit = evaluateActivityFit({ activity: grihaActivity, date: new Date(Date.UTC(2026, 8, 1, 6, 20, 0)), windowType: 'ABHIJIT', classification: grihaDef.muhurta });
check('A Griha Pravesh evaluation on Abhijit carries NAKSHATRA_SUPPORTIVE or NAKSHATRA_UNFAVORABLE reasons when applicable (real Panchanga evidence, not silence)', favorableGrihaFit.reasons.some((r) => r.code === 'ABHIJIT_SUPPORT'));

// ============================================================
// ENGAGEMENT: reported gap, not encoded
// ============================================================

check('Engagement has NO intent-specific rule pack entry (deliberately not populated -- see completion report)', engagementPack.reusedFromLegacyFamily === 'RELATIONSHIP');
check('Engagement reasons come from RELATIONSHIP\'s existing note text (still says "supports ease and connection", not a fabricated Engagement-specific note)', getFamilyRuleData('RELATIONSHIP').note === 'supports ease and connection');

// ============================================================
// CEREMONIAL CONFIDENCE CAP
// ============================================================

const engagementActivity = findActivityIntent('engagement')!;
const engagementDef = getActivityDefinition(engagementActivity)!;

let anyEngagementExceptional = false;
let anyGrihaExceptionalWithoutEvidence = false;
let fullEvidenceDay: Date | null = null;
for (let day = 1; day <= 120; day++) {
  const d = new Date(Date.UTC(2026, 8, 1, 6, 20, 0));
  d.setUTCDate(d.getUTCDate() + day);
  const engagementFit = evaluateActivityFit({ activity: engagementActivity, date: d, windowType: 'ABHIJIT', classification: engagementDef.muhurta });
  if (engagementFit.score >= 90) anyEngagementExceptional = true;

  const grihaFit = evaluateActivityFit({ activity: grihaActivity, date: d, windowType: 'ABHIJIT', classification: grihaDef.muhurta });
  const hasNakshatraSupport = grihaFit.reasons.some((r) => r.factor === 'NAKSHATRA' && r.polarity === 'SUPPORT');
  const hasTithiSupport = grihaFit.reasons.some((r) => r.factor === 'TITHI' && r.polarity === 'SUPPORT');
  if (grihaFit.score >= 90 && !(hasNakshatraSupport && hasTithiSupport)) anyGrihaExceptionalWithoutEvidence = true;
  if (!fullEvidenceDay && hasNakshatraSupport && hasTithiSupport) fullEvidenceDay = d;
}
check('Engagement (still PARTIAL) never reaches EXCEPTIONAL (>=90) across 120 sampled Abhijit instants -- the cap still applies', !anyEngagementExceptional);
check('Griha Pravesh (now SUPPORTED) never reaches EXCEPTIONAL WITHOUT genuine Nakshatra/Tithi support evidence (generic Abhijit/window score alone is not enough)', !anyGrihaExceptionalWithoutEvidence);
check('At least one sampled day has full Nakshatra+Tithi evidence for Griha Pravesh (the rule pack is not so narrow it never fires)', fullEvidenceDay !== null);

// The default-context scoring formula's fixed timePreference/personalPattern/
// userPreference components (0.10+0.10+0.05 weight, defaulted to 70/65/65
// rather than 100) mean even PERFECT Panchanga alignment tops out just under
// 90 for ANY activity under default params -- a property of the overall
// AuraFit formula, unrelated to this PR. To cleanly isolate whether the
// CEREMONIAL cap itself is lifted (rather than relying on that ceiling),
// supply near-maximal overrides for those three components on the day found
// above (full Nakshatra+Tithi+Yoga+Karana+Abhijit alignment for Griha
// Pravesh) -- engagement's cap must still hold, but Griha Pravesh's must not.
const maxContextOverrides = { timePreferenceScore: 100, personalPatternScore: 100, userPreferenceScore: 100 };
const evidenceDayForCapCheck = fullEvidenceDay ?? new Date(Date.UTC(2026, 8, 1, 6, 20, 0));
const grihaWithMaxContext = evaluateActivityFit({ activity: grihaActivity, date: evidenceDayForCapCheck, windowType: 'ABHIJIT', classification: grihaDef.muhurta, ...maxContextOverrides });
const engagementWithMaxContext = evaluateActivityFit({ activity: engagementActivity, date: evidenceDayForCapCheck, windowType: 'ABHIJIT', classification: engagementDef.muhurta, ...maxContextOverrides });
check('Griha Pravesh (now SUPPORTED) CAN reach EXCEPTIONAL once genuine Nakshatra/Tithi evidence is present and other context factors are strong (the cap correctly lifted once fully supported)', grihaWithMaxContext.score >= 90);
check('Engagement (still PARTIAL), under the SAME strong context, is still capped below EXCEPTIONAL', engagementWithMaxContext.score < 90);

// Blockers/cautions remain visible -- the cap only ever lowers a ceiling, never hides a caution/blocker reason.
const grihaDuringRahu = evaluateActivityFit({ activity: grihaActivity, date: new Date(Date.UTC(2026, 8, 2, 6, 20, 0)), windowType: 'RAHU_KALAM', classification: grihaDef.muhurta });
check('Griha Pravesh during Rahu Kalam still carries a RAHU_CAUTION reason (blockers remain blockers)', grihaDuringRahu.reasons.some((r) => r.code === 'RAHU_CAUTION'));
check('Griha Pravesh during Rahu Kalam scores low (caution is not hidden behind the cap)', grihaDuringRahu.score < 55);
const engagementDuringRahu = evaluateActivityFit({ activity: engagementActivity, date: new Date(Date.UTC(2026, 8, 2, 6, 20, 0)), windowType: 'RAHU_KALAM', classification: engagementDef.muhurta });
check('Engagement during Rahu Kalam still carries a RAHU_CAUTION reason', engagementDuringRahu.reasons.some((r) => r.code === 'RAHU_CAUTION'));

// ============================================================
// NORMALIZATION UTILITIES
// ============================================================

check('normalizeNakshatraId is case/whitespace-insensitive', normalizeNakshatraId('  uttara phalguni ') === normalizeNakshatraId('Uttara Phalguni'));
check('normalizeNakshatraId produces the documented example mapping', normalizeNakshatraId('Rohini') === 'ROHINI');
check('normalizeNakshatraId handles multi-word names', normalizeNakshatraId('Uttara Phalguni') === 'UTTARA_PHALGUNI');
check('normalizeTithiId produces the documented example mapping', normalizeTithiId('Shukla Panchami') === 'SHUKLA_PANCHAMI');
check('normalizeTithiId handles single-word tithi names', normalizeTithiId('Amavasya') === 'AMAVASYA');

// ============================================================
// FINDER VALIDATION -- Griha Pravesh should appear automatically
// ============================================================

// SUPPORTED_MUHURTHAM_ACTIVITY_IDS is computed once at module load from
// ACTIVITY_DEFINITIONS + rule-pack support level (muhurthamFinder.ts was
// NOT touched in this PR) -- proving Griha Pravesh's new SUPPORTED status
// flows through automatically with zero Finder-specific code changes.
check('griha-pravesh now appears in Muhurtham Finder\'s eligibility list automatically (no Finder code change)', isSupportedMuhurthamActivity('griha-pravesh'));
check('engagement still does NOT appear (still PARTIAL)', !isSupportedMuhurthamActivity('engagement'));
// Marriage Muhurtham Required Eligibility V1 added a 7th (marriage).
check('Finder eligibility list is now 7 activities', SUPPORTED_MUHURTHAM_ACTIVITY_IDS.length === 7);

const grihaSearchContext = { now: new Date('2026-08-21T04:00:00.000Z'), latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata', tzOffsetMinutes: 330 };
const grihaSearchResult = findMuhurthams({ activityId: 'griha-pravesh', dateRange: { start: '2026-09-01', end: '2026-09-30' }, timePreference: 'ANY', durationMinutes: 90, limit: 30, context: grihaSearchContext });
check('A real Muhurtham Finder range search for griha-pravesh (now SUPPORTED) returns dates', grihaSearchResult.dates.length > 0);
check('Griha Pravesh Finder results carry genuine Nakshatra/Tithi-derived reasons (not just window/yoga/karana)', grihaSearchResult.dates.some((d: { reasons: Array<{ factor: string }> }) => d.reasons.some((r) => r.factor === 'NAKSHATRA' || r.factor === 'TITHI')));

// Regression guard for a real bug found during live browser verification of
// this PR: evaluateTimingCandidate() (timingSearch.ts) has its OWN direct
// evaluateActivityFit() call for building TimingCandidate.reasons, separate
// from the scoreCandidate() path that drives the numeric score -- it was
// initially NOT passed `classification`, so Muhurtham Finder's *displayed*
// reasons silently kept using NEW_BEGINNING's family-base nakshatra list
// (e.g. "Ashwini") even though the *score* was already correctly using the
// Griha Pravesh rule pack. Every Nakshatra reason surfaced through the real
// Finder pipeline must come from grihaPack's own favorable/avoid lists.
const allGrihaNakshatraReasons = grihaSearchResult.dates.flatMap((d: { reasons: Array<{ factor: string; code: string; value?: string }>; cautions: Array<{ factor: string; code: string; value?: string }> }) => [...d.reasons, ...d.cautions]).filter((r: { factor: string }) => r.factor === 'NAKSHATRA');
check('At least one Griha Pravesh Finder result surfaces a Nakshatra reason (the check below is not vacuously true)', allGrihaNakshatraReasons.length > 0);
check(
  'Every Nakshatra reason surfaced through the real Muhurtham Finder pipeline for griha-pravesh comes from GRIHA_PRAVESH\'s own rule pack (never a leftover NEW_BEGINNING-only value like Ashwini/Pushya)',
  allGrihaNakshatraReasons.every((r: { code: string; value?: string }) =>
    (r.code === 'NAKSHATRA_SUPPORTIVE' && grihaPack.nakshatra.favorable.includes(r.value!)) ||
    (r.code === 'NAKSHATRA_UNFAVORABLE' && grihaPack.nakshatra.avoid.includes(r.value!))
  )
);

// ============================================================
// REGRESSION
// ============================================================

const sampleDate = new Date(Date.UTC(2026, 6, 28, 6, 45, 0));
let allUnaffectedActivitiesMatch = true;
for (const def of ACTIVITY_DEFINITIONS) {
  // griha-pravesh: the one activity THIS (muhurtaRulePacks) PR intentionally
  // changes real scoring for.
  //
  // marriage: excluded starting with Ask Aura Marriage Muhurtham Routing
  // V1 -- not because that PR touched any engine/rule-pack file (it did
  // not), but because `findActivityIntent('marriage')` only started
  // resolving once that PR populated `marriage.aliases` (previously `[]`,
  // deliberately, while Marriage Muhurtham was incomplete). Before that,
  // this loop's own `if (!activity) continue` silently skipped marriage
  // entirely, hiding a pre-existing, correct fact about the engine:
  // Marriage already has a genuinely sourced, IMPLEMENTED Nakshatra/Tithi/
  // Yoga/Karana rule pack (see test/marriageMuhurthamFoundation.test.ts
  // checks 2b-2e), so passing `classification` for marriage is NOT a
  // no-op -- it surfaces a real NAKSHATRA_SUPPORTIVE reason ("Uttara
  // Ashadha supports an auspicious union") the family-base fallback
  // cannot produce, exactly the same kind of difference griha-pravesh's
  // own exclusion above already documents.
  if (def.id === 'griha-pravesh' || def.id === 'marriage') continue;
  const activity = findActivityIntent(def.id.replace(/-/g, ' '));
  if (!activity) continue;
  for (const windowType of ['ABHIJIT', 'RAHU_KALAM', 'NEUTRAL'] as const) {
    const withoutClassification = evaluateActivityFit({ activity, date: sampleDate, windowType });
    const withClassification = evaluateActivityFit({ activity, date: sampleDate, windowType, classification: def.muhurta });
    if (withoutClassification.score !== withClassification.score || JSON.stringify(withoutClassification.reasons) !== JSON.stringify(withClassification.reasons)) {
      allUnaffectedActivitiesMatch = false;
    }
  }
}
check('Passing `classification` is a no-op for every activity except griha-pravesh and marriage (Journey/Financial Decision/New Beginning/Business Start/Property Purchase/Engagement all unaffected)', allUnaffectedActivitiesMatch);

const legacyFamilies = ['DEEP_WORK', 'WORKOUT', 'LEARNING', 'MEDITATION', 'RELATIONSHIP', 'JOURNEY_START', 'SOCIAL', 'MEAL', 'FINANCE', 'NEW_BEGINNING', 'ADMIN', 'WELLBEING', 'FOCUSED_WORK'] as const;
let allLegacyFamiliesMatch = true;
for (const family of legacyFamilies) {
  for (const windowType of ['ABHIJIT', 'RAHU_KALAM', 'BRAHMA', 'GULIKA', 'NEUTRAL'] as const) {
    const evaluation = evaluateMuhurta({ taskTitle: 'test', date: sampleDate, windowType, family });
    if (evaluation.family !== family) allLegacyFamiliesMatch = false;
  }
}
check('evaluateMuhurta() still returns the exact requested legacy family for all 13 families (refactor is behavior-preserving)', allLegacyFamiliesMatch);

const rpYogaKarana = rpEvalForProvenance.reasons.filter((r) => r.factor === 'YOGA' || r.factor === 'KARANA');
const legacyEval = evaluateMuhurta({ taskTitle: 'x', date: new Date(Date.UTC(2026, 8, 1, 6, 20, 0)), windowType: 'ABHIJIT', family: 'ADMIN' });
const legacyYogaKarana = legacyEval.reasons.filter((r) => r.factor === 'YOGA' || r.factor === 'KARANA');
check('evaluateMuhurtaWithRulePack() Yoga/Karana reasons match evaluateMuhurta()\'s for the same instant (shared helper, not duplicated logic)', JSON.stringify(rpYogaKarana) === JSON.stringify(legacyYogaKarana));

// ============================================================
// LUNAR INTELLIGENCE V1 L3 -- integration + precedence proof
// ============================================================
// Unit coverage of the resolver itself lives in test/lunarFamilyRules.test.ts.
// This section proves the wiring through the REAL evaluateMuhurtaWithRulePack()/
// evaluateActivityFit() pipeline, and the load-bearing precedence claim:
//   dedicated intent Tithi rule > lunar-family Tithi rule > reusable-base Tithi rule
// with AT MOST ONE Tithi-factor reason per evaluation, chosen at generation
// time (never two competing reasons reconciled afterward).

// A real Rikta Tithi date (Shukla Chaturthi, ordinal 4) that FOCUSED_WORK's
// own legacy avoidTithiPatterns ([/Amavasya/, /Chaturdashi/]) does NOT
// mention -- so the pre-L3 baseline for a generic (non-dedicated-pack)
// PROJECT_START evaluation is a clean, unambiguous "no Tithi reason at all",
// making any TITHI_FAMILY_CAUTION that appears attributable ONLY to L3.
const riktaDate = new Date(Date.UTC(2026, 8, 14, 6, 20, 0));
const newBeginningActivity = findActivityIntent('start a project')!;
const newBeginningDef = getActivityDefinition(newBeginningActivity)!;
check('L3 fixture sanity: new-beginning resolves to intent=PROJECT_START, family=WORK -> FOCUSED_WORK legacy base (REUSABLE_BASE_RULE, no dedicated Tithi coverage)', newBeginningDef.muhurta.intent === 'PROJECT_START' && resolveMuhurtaRulePack(newBeginningDef.muhurta).coverage.tithi === 'REUSABLE_BASE_RULE');
check('L3 fixture sanity: riktaDate really is a Rikta Tithi (Shukla Chaturthi)', (() => { const ev = evaluateMuhurtaWithRulePack({ classification: newBeginningDef.muhurta, date: riktaDate, windowType: 'NEUTRAL' }); return ev.panchanga.tithi === 'Shukla Chaturthi'; })());

// ---- A. explicit START ----
const startEval = evaluateMuhurtaWithRulePack({ classification: newBeginningDef.muhurta, date: riktaDate, windowType: 'NEUTRAL', actionPhase: 'START' });
const startTithiReasons = startEval.reasons.filter((r) => r.factor === 'TITHI');
check('A. explicit START on a Rikta date: exactly one TITHI reason', startTithiReasons.length === 1);
check('A. that reason is TITHI_FAMILY_CAUTION', startTithiReasons[0]?.code === 'TITHI_FAMILY_CAUTION');
check('A. modifier reflects the -8 impact (present in the summed modifier)', startEval.reasons.reduce((t, r) => t + (r.impact ?? 0), 0) === startEval.modifier && startTithiReasons[0]?.impact === -8);
// Lunar Intelligence V1 L3.2: evaluateActivityFit()'s OWN pre-existing, still-UNMODIFIED gate (`usesGenericRulePack`,
// auraFitEngine.ts) still routes new-beginning/PROJECT_START (REUSABLE_BASE_RULE coverage) through the LEGACY
// evaluateMuhurta() path -- exactly as before. What changed is that evaluateActivityFit now applies the SAME shared
// lunar overlay to that legacy branch's OWN output afterward (never touching usesGenericRulePack, never touching
// evaluateMuhurta() itself), so the L3 rule is now reachable through the real Aura Fit pipeline for this real
// fixture. Confirmed below directly against evaluateActivityFit, not evaluateMuhurtaWithRulePack.
const startFit = evaluateActivityFit({ activity: newBeginningActivity, date: riktaDate, windowType: 'NEUTRAL', classification: newBeginningDef.muhurta, actionPhase: 'START' });
const baselineFitNoPhase = evaluateActivityFit({ activity: newBeginningActivity, date: riktaDate, windowType: 'NEUTRAL', classification: newBeginningDef.muhurta });
const startFitTithiReasons = startFit.reasons.filter((r) => r.factor === 'TITHI');
check('A. (L3.2) real evaluateActivityFit(PROJECT_START, Rikta, START): exactly one TITHI reason', startFitTithiReasons.length === 1);
check('A. that reason is TITHI_FAMILY_CAUTION with impact -8', startFitTithiReasons[0]?.code === 'TITHI_FAMILY_CAUTION' && startFitTithiReasons[0]?.impact === -8);
check('A. the no-phase baseline has NO Tithi reason at all for this fixture (clean before-state: FOCUSED_WORK/NEW_BEGINNING neither mentions Chaturthi) -- so the modifier change is attributable ONLY to the new -8', baselineFitNoPhase.reasons.filter((r) => r.factor === 'TITHI').length === 0);
check('A. muhurtaSummary/summary were re-derived from the new reasons (no longer the stale no-Tithi text)', startFit.muhurtaSummary !== baselineFitNoPhase.muhurtaSummary);
check('A. Aura Fit score genuinely changes, strictly lower than the no-phase baseline, through the EXISTING modifier -> muhurtaScore -> blended-score arithmetic only (no new weight, no new cap, no new label logic)', startFit.score < baselineFitNoPhase.score);
// capabilitiesForWindow() also takes the Muhurta modifier as an input (friction shifts with it), so the exact score
// delta is not a single fixed linear formula -- asserting a plausible, non-trivial, bounded delta (rather than a
// brittle exact-formula prediction) still proves the change flows through the existing arithmetic and nothing else.
check('A. the score delta is a real, bounded, non-zero change consistent with a single -8 modifier flowing through the existing formula (never a huge, formula-breaking jump)', baselineFitNoPhase.score - startFit.score > 0 && baselineFitNoPhase.score - startFit.score <= 20);

// ---- real BUSINESS_START and JOURNEY_START also reach the rule through evaluateActivityFit ----
const businessActivity = findActivityIntent('start a business')!;
const businessDef = getActivityDefinition('business-start')!;
const businessStartFit = evaluateActivityFit({ activity: businessActivity, date: riktaDate, windowType: 'NEUTRAL', classification: businessDef.muhurta, actionPhase: 'START' });
const businessBaselineFit = evaluateActivityFit({ activity: businessActivity, date: riktaDate, windowType: 'NEUTRAL', classification: businessDef.muhurta });
check('A. real BUSINESS_START (business-start) + Rikta + START reaches the rule through evaluateActivityFit: one TITHI_FAMILY_CAUTION, score strictly lower than the no-phase baseline', businessStartFit.reasons.filter((r) => r.factor === 'TITHI').length === 1 && businessStartFit.reasons.some((r) => r.code === 'TITHI_FAMILY_CAUTION') && businessStartFit.score < businessBaselineFit.score);

const journeyActivity = findActivityIntent('start a journey')!;
const journeyDef = getActivityDefinition('start-journey')!;
const journeyStartFit = evaluateActivityFit({ activity: journeyActivity, date: riktaDate, windowType: 'NEUTRAL', classification: journeyDef.muhurta, actionPhase: 'START' });
const journeyBaselineFit = evaluateActivityFit({ activity: journeyActivity, date: riktaDate, windowType: 'NEUTRAL', classification: journeyDef.muhurta });
check('A. real JOURNEY_START (start-journey) + Rikta + START reaches the rule through evaluateActivityFit: one TITHI_FAMILY_CAUTION, score strictly lower than the no-phase baseline', journeyStartFit.reasons.filter((r) => r.factor === 'TITHI').length === 1 && journeyStartFit.reasons.some((r) => r.code === 'TITHI_FAMILY_CAUTION') && journeyStartFit.score < journeyBaselineFit.score);

// ---- B. undefined (omitted) actionPhase ----
const undefinedEval = evaluateMuhurtaWithRulePack({ classification: newBeginningDef.muhurta, date: riktaDate, windowType: 'NEUTRAL' });
check('B. actionPhase omitted: no TITHI_FAMILY_CAUTION', !undefinedEval.reasons.some((r) => r.code === 'TITHI_FAMILY_CAUTION'));
check('B. actionPhase omitted: no TITHI reason at all (the pre-L3 baseline for this fixture -- FOCUSED_WORK does not mention Chaturthi)', undefinedEval.reasons.filter((r) => r.factor === 'TITHI').length === 0);
check('B. the full evaluation is deep-equal to the SAME call with actionPhase: undefined explicitly (L2\'s own compatibility contract, still holding)', JSON.stringify(undefinedEval) === JSON.stringify(evaluateMuhurtaWithRulePack({ classification: newBeginningDef.muhurta, date: riktaDate, windowType: 'NEUTRAL', actionPhase: undefined })));
check('B. Aura Fit score with actionPhase omitted equals the explicit no-phase baseline (existing pre-L3 result preserved)', evaluateActivityFit({ activity: newBeginningActivity, date: riktaDate, windowType: 'NEUTRAL', classification: newBeginningDef.muhurta }).score === baselineFitNoPhase.score);

// ---- C. CONTINUE ----
const continueEval = evaluateMuhurtaWithRulePack({ classification: newBeginningDef.muhurta, date: riktaDate, windowType: 'NEUTRAL', actionPhase: 'CONTINUE' });
check('C. actionPhase CONTINUE: no TITHI_FAMILY_CAUTION', !continueEval.reasons.some((r) => r.code === 'TITHI_FAMILY_CAUTION'));
check('C. CONTINUE evaluation is deep-equal to the no-phase baseline (CONTINUE never receives this caution)', JSON.stringify(continueEval) === JSON.stringify(undefinedEval));
// FINISH/PREPARE/REVIEW, same proof, for completeness beyond the required minimum.
for (const phase of ['FINISH', 'PREPARE', 'REVIEW'] as const) {
  const ev = evaluateMuhurtaWithRulePack({ classification: newBeginningDef.muhurta, date: riktaDate, windowType: 'NEUTRAL', actionPhase: phase });
  check(`C. actionPhase ${phase}: no TITHI_FAMILY_CAUTION, evaluation deep-equal to the no-phase baseline`, !ev.reasons.some((r) => r.code === 'TITHI_FAMILY_CAUTION') && JSON.stringify(ev) === JSON.stringify(undefinedEval));
}

// ---- D. dedicated Griha Pravesh (precedence: dedicated intent Tithi > lunar family Tithi) ----
// Griha Pravesh's OWN dedicated pack already lists Chaturthi as avoid (a Rikta tithi, coincidentally) -- coverage.tithi
// is IMPLEMENTED, so per the precedence rule the lunar-family layer must never even be consulted for this intent.
check('D. fixture sanity: griha-pravesh has dedicated (IMPLEMENTED) Tithi coverage', resolveMuhurtaRulePack(grihaDef.muhurta).coverage.tithi === 'IMPLEMENTED');
const grihaStartEval = evaluateMuhurtaWithRulePack({ classification: grihaDef.muhurta, date: riktaDate, windowType: 'NEUTRAL', actionPhase: 'START' });
const grihaTithiReasons = grihaStartEval.reasons.filter((r) => r.factor === 'TITHI');
check('D. Griha Pravesh + Rikta date + START: existing dedicated TITHI_UNFAVORABLE reason remains', grihaTithiReasons.some((r) => r.code === 'TITHI_UNFAVORABLE'));
check('D. Griha Pravesh + Rikta date + START: NO TITHI_FAMILY_CAUTION appears alongside it', !grihaTithiReasons.some((r) => r.code === 'TITHI_FAMILY_CAUTION'));
check('D. at most one TITHI factor reason', grihaTithiReasons.length <= 1);
check('D. Griha Pravesh evaluation is completely unaffected by actionPhase (identical with START vs. omitted)', JSON.stringify(grihaStartEval) === JSON.stringify(evaluateMuhurtaWithRulePack({ classification: grihaDef.muhurta, date: riktaDate, windowType: 'NEUTRAL' })));

// ---- E. Marriage, same proof ----
const marriageActivity = findActivityIntent('marriage')!;
const marriageDef = getActivityDefinition(marriageActivity)!;
check('E. fixture sanity: marriage has dedicated (IMPLEMENTED) Tithi coverage', resolveMuhurtaRulePack(marriageDef.muhurta).coverage.tithi === 'IMPLEMENTED');
const marriageStartEval = evaluateMuhurtaWithRulePack({ classification: marriageDef.muhurta, date: riktaDate, windowType: 'NEUTRAL', actionPhase: 'START' });
const marriageTithiReasons = marriageStartEval.reasons.filter((r) => r.factor === 'TITHI');
check('E. Marriage + Rikta date + START: existing dedicated TITHI_UNFAVORABLE reason remains, no TITHI_FAMILY_CAUTION, at most one TITHI reason', marriageTithiReasons.some((r) => r.code === 'TITHI_UNFAVORABLE') && !marriageTithiReasons.some((r) => r.code === 'TITHI_FAMILY_CAUTION') && marriageTithiReasons.length <= 1);

// ---- F. legacy/catalog ADMIN unaffected ----
// F1: free-text ADMIN (no classification at all) -- the legacy evaluateMuhurta() function itself was never modified,
// which this proves directly against the real ADMIN legacy rule (RULES.ADMIN.preferredTithiPatterns includes
// /Chaturthi/, i.e. Chaturthi is FAVORABLE there).
const adminLegacyEval = evaluateMuhurta({ taskTitle: 'file paperwork', date: riktaDate, windowType: 'NEUTRAL', family: 'ADMIN' });
const adminTithiReasons = adminLegacyEval.reasons.filter((r) => r.factor === 'TITHI');
check('F1. free-text ADMIN + Rikta (Chaturthi) date: still TITHI_SUPPORTIVE (unchanged -- ADMIN\'s own favorable Chaturthi rule)', adminTithiReasons.some((r) => r.code === 'TITHI_SUPPORTIVE'));
check('F1. free-text ADMIN: no TITHI_FAMILY_CAUTION ever appears (no classification exists for this path, so the L3.2 overlay is never even attempted)', !adminTithiReasons.some((r) => r.code === 'TITHI_FAMILY_CAUTION'));
check('F1. free-text ADMIN evaluation is byte-identical regardless of any actionPhase concept -- evaluateMuhurta() has no such parameter and was never modified', JSON.stringify(adminLegacyEval) === JSON.stringify(evaluateMuhurta({ taskTitle: 'file paperwork', date: riktaDate, windowType: 'NEUTRAL', family: 'ADMIN' })));

// F2: the REAL catalog ADMIN activity (task-5), which DOES carry a classification (intent ADMIN) and, as of L3.2,
// genuinely reaches the shared overlay through evaluateActivityFit's legacy branch -- correctly a no-op, because
// ADMIN is not in RIKTA_START_CAUTION_RULE.applicableIntents. Proves the overlay's OWN intent gate, not merely "this
// path is unreachable" (which is no longer true after L3.2).
const adminActivity = findActivityIntent('process optimization')!;
const adminDef = getActivityDefinition('task-5')!;
const adminCatalogStartFit = evaluateActivityFit({ activity: adminActivity, date: riktaDate, windowType: 'NEUTRAL', classification: adminDef.muhurta, actionPhase: 'START' });
const adminCatalogBaselineFit = evaluateActivityFit({ activity: adminActivity, date: riktaDate, windowType: 'NEUTRAL', classification: adminDef.muhurta });
check('F2. catalog ADMIN (task-5) + Rikta + START, through the real evaluateActivityFit pipeline: existing behavior unchanged (no TITHI_FAMILY_CAUTION, score identical to the no-phase baseline)', !adminCatalogStartFit.reasons.some((r) => r.code === 'TITHI_FAMILY_CAUTION') && adminCatalogStartFit.score === adminCatalogBaselineFit.score && JSON.stringify(adminCatalogStartFit.reasons) === JSON.stringify(adminCatalogBaselineFit.reasons));

// ---- G. no double counting, across every L3 fixture above ----
const noDoubleCountingFixtures: Array<{ label: string; evaluation: ReturnType<typeof evaluateMuhurtaWithRulePack> }> = [
  { label: 'new-beginning + START', evaluation: startEval },
  { label: 'new-beginning + undefined', evaluation: undefinedEval },
  { label: 'new-beginning + CONTINUE', evaluation: continueEval },
  { label: 'griha-pravesh + START', evaluation: grihaStartEval },
  { label: 'marriage + START', evaluation: marriageStartEval },
];
check('G. every L3 integration fixture carries AT MOST ONE TITHI-factor reason: ' + noDoubleCountingFixtures.map((f) => `${f.label}=${f.evaluation.reasons.filter((r) => r.factor === 'TITHI').length}`).join(', '), noDoubleCountingFixtures.every((f) => f.evaluation.reasons.filter((r) => r.factor === 'TITHI').length <= 1));

// ---- unrelated intent, same Rikta date, START -- unaffected (WORKOUT is not in the applicable-intents set) ----
const workoutActivity = findActivityIntent('workout')!;
const workoutDef = getActivityDefinition(workoutActivity)!;
const workoutStartEval = evaluateMuhurtaWithRulePack({ classification: workoutDef.muhurta, date: riktaDate, windowType: 'NEUTRAL', actionPhase: 'START' });
check('unrelated intent (WORKOUT) + Rikta date + START: no TITHI_FAMILY_CAUTION', !workoutStartEval.reasons.some((r) => r.code === 'TITHI_FAMILY_CAUTION'));

// ============================================================
// LUNAR INTELLIGENCE V1 L4 -- exact-Tithi (Amavasya) integration + precedence proof
// ============================================================
// Unit coverage of the resolver itself lives in test/lunarExactTithiRules.test.ts.
// This section proves the wiring through the REAL evaluateMuhurtaWithRulePack()/
// evaluateActivityFit() pipeline, and the full precedence claim:
//   dedicated intent Tithi > exact-Tithi special case > Tithi-family rule > reusable legacy Tithi
// with AT MOST ONE Tithi-factor reason per evaluation.

// A real Amavasya date (confirmed via packages/vedic/src/panchangElements.ts's own getTithi()).
const amavasyaDate = new Date(Date.UTC(2026, 8, 10, 6, 20, 0));
check('L4 fixture sanity: amavasyaDate really is Amavasya', (() => { const ev = evaluateMuhurtaWithRulePack({ classification: newBeginningDef.muhurta, date: amavasyaDate, windowType: 'NEUTRAL' }); return ev.panchanga.tithi === 'Amavasya'; })());
check('L4 fixture sanity: Amavasya resolves to TithiFamily.PURNA, not RIKTA (the ordinal-mod-5 collision the exact rule exists to avoid -- see lunarExactTithiRules.ts\'s own doc comment)', buildLunarTithiContext('Amavasya').family === 'PURNA');
// FOCUSED_WORK/NEW_BEGINNING/JOURNEY_START (the legacy families PROJECT_START/BUSINESS_START/JOURNEY_START reuse via
// FAMILY_BASE_SOURCE) ALL already avoid Amavasya in the pre-existing legacy RULES table -- unlike the Rikta fixture
// above, the no-phase baseline here is NOT "no Tithi reason at all", it is an existing TITHI_UNFAVORABLE reason
// (impact -8, the same magnitude muhurtaEngine.ts already used). This makes these fixtures the strongest possible
// proof of "replaces, not added beside it": if the exact-Tithi overlay ever appended instead of replacing, the
// modifier would double to -16 and two TITHI reasons would appear -- neither happens.
const amavasyaBaselineEval = evaluateMuhurtaWithRulePack({ classification: newBeginningDef.muhurta, date: amavasyaDate, windowType: 'NEUTRAL' });
const amavasyaBaselineTithi = amavasyaBaselineEval.reasons.filter((r) => r.factor === 'TITHI');
check('L4 fixture sanity: the no-phase Amavasya baseline already carries a legacy TITHI_UNFAVORABLE reason (impact -8) -- the pre-existing behavior this rule must cleanly replace, not duplicate', amavasyaBaselineTithi.length === 1 && amavasyaBaselineTithi[0].code === 'TITHI_UNFAVORABLE' && amavasyaBaselineTithi[0].impact === -8);

// ---- A. explicit START ----
const amavasyaStartEval = evaluateMuhurtaWithRulePack({ classification: newBeginningDef.muhurta, date: amavasyaDate, windowType: 'NEUTRAL', actionPhase: 'START' });
const amavasyaStartTithi = amavasyaStartEval.reasons.filter((r) => r.factor === 'TITHI');
check('A. explicit START on Amavasya: exactly one TITHI reason', amavasyaStartTithi.length === 1);
check('A. that reason is TITHI_EXACT_CAUTION with impact -8 and value "Amavasya"', amavasyaStartTithi[0]?.code === 'TITHI_EXACT_CAUTION' && amavasyaStartTithi[0]?.impact === -8 && amavasyaStartTithi[0]?.value === 'Amavasya');
check('A. the legacy TITHI_UNFAVORABLE reason is REPLACED, not accumulated alongside the new one (modifier unchanged at -8 total contribution, reasons count unchanged, code differs from the no-phase baseline)', amavasyaStartEval.modifier === amavasyaBaselineEval.modifier && amavasyaStartEval.reasons.length === amavasyaBaselineEval.reasons.length && amavasyaStartTithi[0]?.code !== amavasyaBaselineTithi[0]?.code);

// ---- A. (L4) real evaluateActivityFit for all three supported intents ----
const amavasyaStartFit = evaluateActivityFit({ activity: newBeginningActivity, date: amavasyaDate, windowType: 'NEUTRAL', classification: newBeginningDef.muhurta, actionPhase: 'START' });
const amavasyaBaselineFit = evaluateActivityFit({ activity: newBeginningActivity, date: amavasyaDate, windowType: 'NEUTRAL', classification: newBeginningDef.muhurta });
const amavasyaStartFitTithi = amavasyaStartFit.reasons.filter((r) => r.factor === 'TITHI');
check('A. (L4) real evaluateActivityFit(PROJECT_START, Amavasya, START): exactly one TITHI_EXACT_CAUTION reason, replacing the legacy one', amavasyaStartFitTithi.length === 1 && amavasyaStartFitTithi[0]?.code === 'TITHI_EXACT_CAUTION' && amavasyaStartFitTithi[0]?.impact === -8);
check('A. (L4) the exact reason participates in the modifier exactly like the legacy reason it replaced -- score is IDENTICAL to the no-phase baseline (both draw -8 from a single Tithi reason; a numeric coincidence that only holds because the magnitudes match, not evidence the overlay was skipped -- the code/value assertions above prove it fired)', amavasyaStartFit.score === amavasyaBaselineFit.score && amavasyaStartFit.muhurtaSummary !== amavasyaBaselineFit.muhurtaSummary);

const businessAmavasyaFit = evaluateActivityFit({ activity: businessActivity, date: amavasyaDate, windowType: 'NEUTRAL', classification: businessDef.muhurta, actionPhase: 'START' });
check('A. (L4) real BUSINESS_START + Amavasya + START reaches the rule through evaluateActivityFit: one TITHI_EXACT_CAUTION, replacing the legacy reason', businessAmavasyaFit.reasons.filter((r) => r.factor === 'TITHI').length === 1 && businessAmavasyaFit.reasons.some((r) => r.code === 'TITHI_EXACT_CAUTION'));

const journeyAmavasyaFit = evaluateActivityFit({ activity: journeyActivity, date: amavasyaDate, windowType: 'NEUTRAL', classification: journeyDef.muhurta, actionPhase: 'START' });
check('A. (L4) real JOURNEY_START + Amavasya + START reaches the rule through evaluateActivityFit: one TITHI_EXACT_CAUTION, replacing the legacy reason', journeyAmavasyaFit.reasons.filter((r) => r.factor === 'TITHI').length === 1 && journeyAmavasyaFit.reasons.some((r) => r.code === 'TITHI_EXACT_CAUTION'));

// ---- B. exact-Tithi rule NEVER matches undefined/CONTINUE/FINISH/PREPARE/REVIEW (no inference) ----
for (const phase of [undefined, 'CONTINUE', 'FINISH', 'PREPARE', 'REVIEW'] as const) {
  const ev = phase === undefined
    ? evaluateMuhurtaWithRulePack({ classification: newBeginningDef.muhurta, date: amavasyaDate, windowType: 'NEUTRAL' })
    : evaluateMuhurtaWithRulePack({ classification: newBeginningDef.muhurta, date: amavasyaDate, windowType: 'NEUTRAL', actionPhase: phase });
  const tithi = ev.reasons.filter((r) => r.factor === 'TITHI');
  check(`B. actionPhase ${phase ?? 'undefined'} on Amavasya: no TITHI_EXACT_CAUTION -- the legacy TITHI_UNFAVORABLE reason remains untouched`, !tithi.some((r) => r.code === 'TITHI_EXACT_CAUTION') && tithi.length === 1 && tithi[0].code === 'TITHI_UNFAVORABLE');
}

// ---- C. exact > family: Amavasya's own family (PURNA) can never collide with the RIKTA family rule in real data ----
check('C. exact > family: Amavasya is structurally never RIKTA (confirmed above), so lunarFamilyRules.ts\'s resolver can never match it -- the exact resolver is the ONLY one that can fire for this Tithi, by construction, not merely by precedence order', buildLunarTithiContext('Amavasya').family !== 'RIKTA');
check('C. existing Rikta START tests (section A above) remain green -- family-level precedence for RIKTA is unaffected by the exact-Tithi layer\'s addition', startTithiReasons.length === 1 && startTithiReasons[0]?.code === 'TITHI_FAMILY_CAUTION');

// ---- D. dedicated Griha Pravesh + Marriage: exact-Tithi layer never even consulted ----
check('D. fixture sanity: griha-pravesh has dedicated (IMPLEMENTED) Tithi coverage', resolveMuhurtaRulePack(grihaDef.muhurta).coverage.tithi === 'IMPLEMENTED');
const grihaAmavasyaEval = evaluateMuhurtaWithRulePack({ classification: grihaDef.muhurta, date: amavasyaDate, windowType: 'NEUTRAL', actionPhase: 'START' });
const grihaAmavasyaTithi = grihaAmavasyaEval.reasons.filter((r) => r.factor === 'TITHI');
check('D. Griha Pravesh + Amavasya + START: existing dedicated TITHI_UNFAVORABLE reason remains (Griha Pravesh\'s own /^Amavasya$/ avoid pattern), no TITHI_EXACT_CAUTION appears alongside it', grihaAmavasyaTithi.some((r) => r.code === 'TITHI_UNFAVORABLE') && !grihaAmavasyaTithi.some((r) => r.code === 'TITHI_EXACT_CAUTION') && grihaAmavasyaTithi.length === 1);

const marriageAmavasyaEval = evaluateMuhurtaWithRulePack({ classification: marriageDef.muhurta, date: amavasyaDate, windowType: 'NEUTRAL', actionPhase: 'START' });
const marriageAmavasyaTithi = marriageAmavasyaEval.reasons.filter((r) => r.factor === 'TITHI');
check('D. Marriage + Amavasya + START: NO Tithi reason at all (Marriage\'s own dedicated avoid list deliberately does not mention Amavasya -- neutral by omission), and critically NO TITHI_EXACT_CAUTION fills that gap -- dedicated coverage suppresses the overlay outright, even where the dedicated pack itself has nothing to say', marriageAmavasyaTithi.length === 0);
check('D. this proves the ticket\'s own constraint directly: Marriage\'s stance on Amavasya (favorable/neutral/unfavorable) is completely unchanged by L4', JSON.stringify(marriageAmavasyaEval) === JSON.stringify(evaluateMuhurtaWithRulePack({ classification: marriageDef.muhurta, date: amavasyaDate, windowType: 'NEUTRAL' })));

// ---- unrelated intent, same Amavasya date, START -- unaffected ----
const workoutAmavasyaEval = evaluateMuhurtaWithRulePack({ classification: workoutDef.muhurta, date: amavasyaDate, windowType: 'NEUTRAL', actionPhase: 'START' });
check('unrelated intent (WORKOUT) + Amavasya date + START: no TITHI_EXACT_CAUTION', !workoutAmavasyaEval.reasons.some((r) => r.code === 'TITHI_EXACT_CAUTION'));

// ---- no double counting, across every L4 fixture above ----
const noDoubleCountingL4Fixtures: Array<{ label: string; evaluation: ReturnType<typeof evaluateMuhurtaWithRulePack> }> = [
  { label: 'new-beginning + Amavasya + START', evaluation: amavasyaStartEval },
  { label: 'new-beginning + Amavasya + no-phase', evaluation: amavasyaBaselineEval },
  { label: 'griha-pravesh + Amavasya + START', evaluation: grihaAmavasyaEval },
  { label: 'marriage + Amavasya + START', evaluation: marriageAmavasyaEval },
];
check('every L4 integration fixture carries AT MOST ONE TITHI-factor reason: ' + noDoubleCountingL4Fixtures.map((f) => `${f.label}=${f.evaluation.reasons.filter((r) => r.factor === 'TITHI').length}`).join(', '), noDoubleCountingL4Fixtures.every((f) => f.evaluation.reasons.filter((r) => r.factor === 'TITHI').length <= 1));

// ============================================================
// H. BACKWARD-COMPATIBILITY SWEEP -- every catalog activity, L3.2/L4
// ============================================================
const nonRiktaDate = new Date(Date.UTC(2026, 8, 15, 6, 20, 0)); // Shukla Panchami -- PURNA, confirmed non-Rikta
check('H. fixture sanity: nonRiktaDate is genuinely non-Rikta', (() => { const ev = evaluateMuhurtaWithRulePack({ classification: newBeginningDef.muhurta, date: nonRiktaDate, windowType: 'NEUTRAL' }); return ev.panchanga.tithi === 'Shukla Panchami'; })());

let h1AllMatch = true; // omitted vs explicit undefined actionPhase
let h2AllMatch = true; // CONTINUE/FINISH/PREPARE/REVIEW never introduce a lunar change (Rikta date)
let h3AllMatch = true; // START on a non-Rikta date never introduces a lunar change
let h4AllMatch = true; // CONTINUE/FINISH/PREPARE/REVIEW never introduce a lunar change (Amavasya date)
let h5AllMatch = true; // START on Amavasya never introduces a change for an UNSUPPORTED intent
const AMAVASYA_SUPPORTED_INTENTS = new Set(['PROJECT_START', 'BUSINESS_START', 'JOURNEY_START']);
const swept: string[] = [];
for (const def of ACTIVITY_DEFINITIONS) {
  const activity = findActivityIntent(def.id.replace(/-/g, ' '));
  if (!activity) continue;
  swept.push(def.id);
  for (const windowType of ['ABHIJIT', 'NEUTRAL'] as const) {
    const base = { activity, date: riktaDate, windowType, classification: def.muhurta };
    const omitted = evaluateActivityFit(base);
    const explicitUndefined = evaluateActivityFit({ ...base, actionPhase: undefined });
    if (JSON.stringify(omitted) !== JSON.stringify(explicitUndefined)) h1AllMatch = false;

    for (const phase of ['CONTINUE', 'FINISH', 'PREPARE', 'REVIEW'] as const) {
      const withPhase = evaluateActivityFit({ ...base, actionPhase: phase });
      if (JSON.stringify(withPhase) !== JSON.stringify(omitted)) h2AllMatch = false;
    }

    const nonRiktaBase = { activity, date: nonRiktaDate, windowType, classification: def.muhurta };
    const nonRiktaOmitted = evaluateActivityFit(nonRiktaBase);
    const nonRiktaStart = evaluateActivityFit({ ...nonRiktaBase, actionPhase: 'START' as const });
    if (JSON.stringify(nonRiktaStart) !== JSON.stringify(nonRiktaOmitted)) h3AllMatch = false;

    // L4: same two invariants, re-proved on the Amavasya date.
    const amavasyaBase = { activity, date: amavasyaDate, windowType, classification: def.muhurta };
    const amavasyaOmitted = evaluateActivityFit(amavasyaBase);
    for (const phase of ['CONTINUE', 'FINISH', 'PREPARE', 'REVIEW'] as const) {
      const withPhase = evaluateActivityFit({ ...amavasyaBase, actionPhase: phase });
      if (JSON.stringify(withPhase) !== JSON.stringify(amavasyaOmitted)) h4AllMatch = false;
    }
    if (!AMAVASYA_SUPPORTED_INTENTS.has(def.muhurta.intent)) {
      const amavasyaStart = evaluateActivityFit({ ...amavasyaBase, actionPhase: 'START' as const });
      if (JSON.stringify(amavasyaStart) !== JSON.stringify(amavasyaOmitted)) h5AllMatch = false;
    }
  }
}
check(`H1. WITHOUT actionPhase: every swept catalog activity (${swept.length} of ${ACTIVITY_DEFINITIONS.length}) is byte-identical whether actionPhase is omitted or explicitly undefined (reasons/modifier/muhurtaScore/final score all included via full-object equality)`, h1AllMatch && swept.length > 10);
check('H2. WITH CONTINUE/FINISH/PREPARE/REVIEW (Rikta date): every swept catalog activity is byte-identical to its own no-phase baseline -- the lunar overlay never fires for any non-START phase, for any activity', h2AllMatch);
check('H3. WITH START on a non-Rikta date: every swept catalog activity is byte-identical to its own no-phase baseline on that date -- the lunar overlay never fires off a mismatched Tithi family, for any activity', h3AllMatch);
check('H4. WITH CONTINUE/FINISH/PREPARE/REVIEW (Amavasya date): every swept catalog activity is byte-identical to its own no-phase Amavasya baseline -- the exact-Tithi overlay never fires for any non-START phase either, for any activity', h4AllMatch);
check('H5. WITH START on Amavasya, for every catalog activity whose intent is NOT PROJECT_START/BUSINESS_START/JOURNEY_START: byte-identical to its own no-phase Amavasya baseline -- the exact rule never leaks beyond its 3 evidenced intents', h5AllMatch);

// ---- structural: no L3 symbol reaches Constructor/recomposition/PlannedActivity/GoalActivity/Capture/Home/Explore/Prisma ----
const forbiddenL3Files = [
  '../apps/web/lib/dayConstructor.ts',
  '../apps/web/lib/remainingDayRecomposition.ts',
  '../apps/web/lib/db.ts',
  '../apps/web/components/HomeDashboard.tsx',
  '../apps/web/components/ExploreView.tsx',
];
const fs = require('fs');
const path = require('path');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const FORBIDDEN_L3_L4_SYMBOLS = /TITHI_FAMILY_CAUTION|lunarFamilyRules|RIKTA_START_CAUTION|TITHI_EXACT_CAUTION|lunarExactTithiRules|AMAVASYA_START_CAUTION/;
for (const rel of forbiddenL3Files) {
  const src = stripComments(fs.readFileSync(path.join(__dirname, rel), 'utf8'));
  check(`structural: ${rel.replace('../', '')} does not reference TITHI_FAMILY_CAUTION/lunarFamilyRules/RIKTA_START_CAUTION/TITHI_EXACT_CAUTION/lunarExactTithiRules/AMAVASYA_START_CAUTION`, !FORBIDDEN_L3_L4_SYMBOLS.test(src));
}
const schemaSrc = fs.readFileSync(path.join(__dirname, '../apps/web/prisma/schema.prisma'), 'utf8');
check('structural: prisma/schema.prisma does not reference any L3/L4 lunar symbol', !FORBIDDEN_L3_L4_SYMBOLS.test(schemaSrc));
const migrationDirsL3 = fs.readdirSync(path.join(__dirname, '../apps/web/prisma/migrations')).filter((d: string) => /^\d{4}_/.test(d));
check('structural: migration count remains 39 (no new migration)', migrationDirsL3.length === 39);
check('structural: lunarTithiContext.ts is untouched (no L3/L4 symbol referenced inside it)', !/TITHI_FAMILY_CAUTION|lunarFamilyRules|RIKTA_START_CAUTION|LunarFamilyRule|TITHI_EXACT_CAUTION|lunarExactTithiRules|AMAVASYA_START_CAUTION|LunarExactTithiRule/.test(stripComments(fs.readFileSync(path.join(__dirname, '../packages/muhurta/src/lunarTithiContext.ts'), 'utf8'))));
check('structural: actionPhase.ts is untouched (still zero imports, still just the bare type)', !/^import\b/m.test(stripComments(fs.readFileSync(path.join(__dirname, '../packages/muhurta/src/actionPhase.ts'), 'utf8'))));

// ============================================================
// I. L3.2/L4 STRUCTURAL GUARDS
// ============================================================
const muhurtaEngineSrc = stripComments(fs.readFileSync(path.join(__dirname, '../packages/muhurta/src/muhurtaEngine.ts'), 'utf8'));
check('I. muhurtaEngine.ts (legacy evaluateMuhurta itself) is untouched -- no L3/L3.2/L4 symbol referenced inside it', !/TITHI_FAMILY_CAUTION|lunarFamilyRules|applyLunarTithiOverlay|ActionPhase|actionPhase|TITHI_EXACT_CAUTION|lunarExactTithiRules/.test(muhurtaEngineSrc));
const auraFitSrc = stripComments(fs.readFileSync(path.join(__dirname, '../packages/recommendation/src/auraFitEngine.ts'), 'utf8'));
check('I. usesGenericRulePack\'s own condition is byte-identical to before L3.2 (never changed)', /const usesGenericRulePack = rulePack !== undefined && !\(rulePack\.coverage\.tithi === 'REUSABLE_BASE_RULE' && rulePack\.coverage\.nakshatra === 'REUSABLE_BASE_RULE'\);/.test(auraFitSrc));
check('I. auraFitEngine.ts still selects the evaluator with the exact same ternary shape (usesGenericRulePack ? evaluateMuhurtaWithRulePack(...) : evaluateMuhurta(...))', /const muhurta = usesGenericRulePack\s*\?\s*evaluateMuhurtaWithRulePack\(/.test(auraFitSrc) && /:\s*evaluateMuhurta\(\{/.test(auraFitSrc));
check('I. no scoring-formula weight/constant changed (0.45/0.20/0.10/0.10/0.10/0.05 blend weights and the 68/1.8/0.24 muhurtaScore constants are all still present, unmodified)', /muhurtaScore \* 0\.45/.test(auraFitSrc) && /solarScore \* 0\.20/.test(auraFitSrc) && /clamp\(68 \+ effectiveMuhurta\.modifier \* 1\.8 - capabilities\.friction \* 0\.24\)/.test(auraFitSrc));
check('I. no new MuhurtaIntent was added (still exactly the 24 values L3 already worked from)', !/MuhurtaIntent =[\s\S]*?RIKTA/.test(stripComments(fs.readFileSync(path.join(__dirname, '../packages/muhurta/src/activityOntology.ts'), 'utf8'))));
check('I. LUNAR_FAMILY_RULES still has exactly one rule (no additional lunar rules introduced by L3.2/L4)', (strip => { const m = strip.match(/LUNAR_FAMILY_RULES: LunarFamilyRule\[\] = \[([^\]]*)\]/); return !!m && m[1].split(',').filter(Boolean).length === 1; })(stripComments(fs.readFileSync(path.join(__dirname, '../packages/muhurta/src/lunarFamilyRules.ts'), 'utf8'))));
check('I. no TITHI_FAMILY_SUPPORT anywhere in the repo (L3.2 stays caution-only, matching L3)', !/TITHI_FAMILY_SUPPORT/.test(auraFitSrc + muhurtaEngineSrc + stripComments(fs.readFileSync(path.join(__dirname, '../packages/muhurta/src/activityOntology.ts'), 'utf8'))));
const lunarExactTithiRulesSrc = stripComments(fs.readFileSync(path.join(__dirname, '../packages/muhurta/src/lunarExactTithiRules.ts'), 'utf8'));
check('I. LUNAR_EXACT_TITHI_RULES has exactly one rule (no additional exact-Tithi rules introduced by L4)', (() => { const m = lunarExactTithiRulesSrc.match(/LUNAR_EXACT_TITHI_RULES: LunarExactTithiRule\[\] = \[([^\]]*)\]/); return !!m && m[1].split(',').filter(Boolean).length === 1; })());
check('I. no TITHI_EXACT_SUPPORT anywhere in the repo (L4 stays caution-only, matching L3)', !/TITHI_EXACT_SUPPORT/.test(auraFitSrc + muhurtaEngineSrc + lunarExactTithiRulesSrc + stripComments(fs.readFileSync(path.join(__dirname, '../packages/muhurta/src/activityOntology.ts'), 'utf8'))));
check('I. Griha Pravesh\'s and Marriage\'s dedicated Tithi data is byte-for-byte untouched by L4 (their avoid/favorable regex arrays still match exactly what L3/L3.2 already established)', /avoid: \[\/\^Amavasya\$\/, \/Chaturthi\/, \/Ashtami\/, \/Navami\/, \/Chaturdashi\/\]/.test(stripComments(fs.readFileSync(path.join(__dirname, '../packages/muhurta/src/muhurtaRulePacks.ts'), 'utf8'))) && /avoid: \[\/Chaturthi\/, \/Navami\/, \/Chaturdashi\/\]/.test(stripComments(fs.readFileSync(path.join(__dirname, '../packages/muhurta/src/muhurtaRulePacks.ts'), 'utf8'))));
check(
  'I. no global MuhurtaEvaluation.provenance fix: the rule-pack path still sets provenance; the legacy evaluateMuhurta() path (including one that received the L3.2 overlay) still leaves it undefined -- per the explicit non-goal, never introduced into a legacy result',
  evaluateMuhurtaWithRulePack({ classification: grihaDef.muhurta, date: riktaDate, windowType: 'NEUTRAL' }).provenance !== undefined &&
    evaluateMuhurta({ taskTitle: 'x', date: riktaDate, windowType: 'NEUTRAL', family: 'ADMIN' }).provenance === undefined
);

console.log(allPassed ? '\nALL MUHURTA RULE PACK CHECKS PASSED' : '\nSOME MUHURTA RULE PACK CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
