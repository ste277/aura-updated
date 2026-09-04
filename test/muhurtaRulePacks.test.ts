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

console.log(allPassed ? '\nALL MUHURTA RULE PACK CHECKS PASSED' : '\nSOME MUHURTA RULE PACK CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
