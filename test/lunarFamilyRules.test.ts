/**
 * Lunar Intelligence V1 L3 -- unit tests for the rule module itself
 * (packages/muhurta/src/lunarFamilyRules.ts), tested directly against the
 * resolver, independent of the Muhurta evaluation pipeline (see
 * test/muhurtaRulePacks.test.ts for the integration/precedence proof).
 */
import fs from 'fs';
import path from 'path';
import { buildLunarTithiContext } from '../packages/muhurta/src/lunarTithiContext';
import { resolveLunarFamilyReason, applyLunarFamilyOverlay, RIKTA_START_CAUTION_RULE } from '../packages/muhurta/src/lunarFamilyRules';
import type { MuhurtaClassification, MuhurtaReason } from '../packages/muhurta/src/activityOntology';
import type { ActionPhase } from '../packages/muhurta/src/actionPhase';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const classification = (intent: MuhurtaClassification['intent']): MuhurtaClassification => ({
  family: 'WORK', // deliberately arbitrary -- the resolver keys on intent, not family (see the rule's own doc comment)
  intent,
  significance: 'HIGH',
  evaluationDepth: 'DEEP',
  timingSensitivity: { start: 'HIGH', duration: 'MEDIUM', end: 'LOW' },
});

// All six Rikta positions across both Pakshas (ordinal 4, 9, 14 x Shukla/Krishna).
const RIKTA_TITHI_NAMES = ['Shukla Chaturthi', 'Krishna Chaturthi', 'Shukla Navami', 'Krishna Navami', 'Shukla Chaturdashi', 'Krishna Chaturdashi'];
const NON_RIKTA_TITHI_NAMES = ['Shukla Panchami', 'Purnima', 'Amavasya', 'Krishna Ekadashi']; // PURNA, PURNA, PURNA, NANDA -- none RIKTA

async function main() {
  for (const name of RIKTA_TITHI_NAMES) {
    check(`fixture sanity: "${name}" resolves to TithiFamily.RIKTA (L1, unmodified)`, buildLunarTithiContext(name).family === 'RIKTA');
  }

  // ============================ 1-4. supported intents x RIKTA x START -> CAUTION ============================
  const supportedIntents: MuhurtaClassification['intent'][] = ['PROJECT_START', 'BUSINESS_START', 'JOURNEY_START'];
  for (const intent of supportedIntents) {
    for (const tithiName of RIKTA_TITHI_NAMES) {
      const reason = resolveLunarFamilyReason(buildLunarTithiContext(tithiName), classification(intent), 'START');
      check(`1-4. RIKTA (${tithiName}) + ${intent} + START -> CAUTION reason produced`, reason !== null);
    }
  }

  // ============================ 5-9. every other/absent phase -> no rule ============================
  const otherPhases: Array<ActionPhase | undefined> = ['CONTINUE', 'FINISH', 'PREPARE', 'REVIEW', undefined];
  for (const phase of otherPhases) {
    const reason = resolveLunarFamilyReason(buildLunarTithiContext('Shukla Chaturthi'), classification('PROJECT_START'), phase);
    check(`5-9. RIKTA + PROJECT_START + ${phase === undefined ? 'undefined' : phase} -> no rule`, reason === null);
  }
  // Same proof repeated for every supported intent, not just PROJECT_START.
  for (const intent of supportedIntents) {
    for (const phase of otherPhases) {
      const reason = resolveLunarFamilyReason(buildLunarTithiContext('Krishna Navami'), classification(intent), phase);
      check(`5-9. RIKTA + ${intent} + ${phase === undefined ? 'undefined' : phase} -> no rule`, reason === null);
    }
  }
  check('undefined actionPhase is explicitly distinct from the string "undefined" and from START -- never coerced', resolveLunarFamilyReason(buildLunarTithiContext('Shukla Chaturthi'), classification('PROJECT_START'), undefined) === null);

  // ============================ 10. non-Rikta + START -> no rule ============================
  for (const tithiName of NON_RIKTA_TITHI_NAMES) {
    const reason = resolveLunarFamilyReason(buildLunarTithiContext(tithiName), classification('PROJECT_START'), 'START');
    check(`10. non-RIKTA (${tithiName}) + PROJECT_START + START -> no rule`, reason === null);
  }

  // ============================ 11. unrelated intent + RIKTA + START -> no rule ============================
  const unrelatedIntents: MuhurtaClassification['intent'][] = ['ADMIN', 'GRIHA_PRAVESH', 'MARRIAGE', 'IMPORTANT_FINANCIAL_DECISION', 'PROPERTY_PURCHASE', 'MEDITATION', 'WORKOUT', 'GENERAL'];
  for (const intent of unrelatedIntents) {
    const reason = resolveLunarFamilyReason(buildLunarTithiContext('Shukla Chaturthi'), classification(intent), 'START');
    check(`11. unrelated intent ${intent} + RIKTA + START -> no rule (this module's resolver alone; GRIHA_PRAVESH/MARRIAGE also stay unreachable via the caller's coverage gate, see the integration suite)`, reason === null);
  }

  // ============================ 12. reason shape ============================
  const matched = resolveLunarFamilyReason(buildLunarTithiContext('Shukla Chaturthi'), classification('PROJECT_START'), 'START')!;
  check('12. code === TITHI_FAMILY_CAUTION', matched.code === 'TITHI_FAMILY_CAUTION');
  check('12. factor === TITHI', matched.factor === 'TITHI');
  check('12. polarity === CAUTION', matched.polarity === 'CAUTION');
  check('12. impact === -8 (reuses the existing standard Tithi-caution magnitude, muhurtaEngine.ts TITHI_UNFAVORABLE)', matched.impact === -8);
  check('12. value === RIKTA', matched.value === 'RIKTA');
  check('12. params carries the matched actionPhase and intent, no display prose beyond a short note', matched.params?.actionPhase === 'START' && matched.params?.intent === 'PROJECT_START' && typeof matched.params?.note === 'string' && (matched.params!.note as string).length < 200);

  // ============================ 13. provenance ============================
  check('13. the rule definition carries provenance: sources[], confidence, scope, lastReviewed, note', RIKTA_START_CAUTION_RULE.metadata.sources.length > 0 && RIKTA_START_CAUTION_RULE.metadata.sources.every((s) => Boolean(s.sourceType) && Boolean(s.title) && (Boolean(s.citation) || Boolean(s.notes))) && !!RIKTA_START_CAUTION_RULE.metadata.confidence && !!RIKTA_START_CAUTION_RULE.metadata.scope && !!RIKTA_START_CAUTION_RULE.metadata.lastReviewed && !!RIKTA_START_CAUTION_RULE.metadata.note);
  check('13. provenance reuses the existing MuhurtaRuleSource/Confidence/Scope vocabulary values (no invented second vocabulary)', ['ESTABLISHED', 'CURATED', 'PROVISIONAL'].includes(RIKTA_START_CAUTION_RULE.metadata.confidence) && ['GENERAL', 'REGIONAL'].includes(RIKTA_START_CAUTION_RULE.metadata.scope) && RIKTA_START_CAUTION_RULE.metadata.sources.every((s) => ['CLASSICAL_TEXT', 'TRADITIONAL_REFERENCE', 'CURATED_METHODOLOGY'].includes(s.sourceType)));

  // ============================ 14. PakshaBand does not alter the result ============================
  {
    const weak = buildLunarTithiContext('Shukla Chaturthi'); // ordinal 4 -> WEAK band
    const strong = buildLunarTithiContext('Krishna Chaturthi'); // ordinal 4 in Krishna -> STRONG band
    check('14. fixture sanity: the two contexts genuinely differ in pakshaBand', weak.pakshaBand === 'WEAK' && strong.pakshaBand === 'STRONG' && weak.family === strong.family);
    const a = resolveLunarFamilyReason(weak, classification('PROJECT_START'), 'START');
    const b = resolveLunarFamilyReason(strong, classification('PROJECT_START'), 'START');
    check('14. PakshaBand does not alter the resolved reason (identical polarity/impact/code regardless of WEAK vs STRONG)', JSON.stringify({ ...a, value: null }) === JSON.stringify({ ...b, value: null }) && a?.value === 'RIKTA' && b?.value === 'RIKTA');
  }

  // ============================ 15. applyLunarFamilyOverlay -- shared, evaluator-independent overlay ============================
  const nakshatraReason: MuhurtaReason = { code: 'NAKSHATRA_SUPPORTIVE', factor: 'NAKSHATRA', polarity: 'SUPPORT', impact: 8, value: 'Rohini' };
  const yogaReason: MuhurtaReason = { code: 'YOGA_SUPPORTIVE', factor: 'YOGA', polarity: 'SUPPORT', impact: 4, value: 'Siddhi' };
  const existingTithiSupportive: MuhurtaReason = { code: 'TITHI_SUPPORTIVE', factor: 'TITHI', polarity: 'SUPPORT', impact: 5, value: 'Shukla Chaturthi' };
  const existingTithiUnfavorable: MuhurtaReason = { code: 'TITHI_UNFAVORABLE', factor: 'TITHI', polarity: 'CAUTION', impact: -8, value: 'Shukla Chaturthi' };
  const noTithiReasons: MuhurtaReason[] = [nakshatraReason, yogaReason];
  const withSupportiveTithi: MuhurtaReason[] = [nakshatraReason, existingTithiSupportive, yogaReason];
  const withUnfavorableTithi: MuhurtaReason[] = [nakshatraReason, existingTithiUnfavorable, yogaReason];
  const riktaCtx = buildLunarTithiContext('Shukla Chaturthi');
  const nonRiktaCtx = buildLunarTithiContext('Shukla Panchami');
  const projectStart = classification('PROJECT_START');

  // ---- identity: actionPhase absent/wrong ----
  check('15. identity: actionPhase undefined -> reasons returned UNCHANGED (same array reference)', applyLunarFamilyOverlay(withSupportiveTithi, 'REUSABLE_BASE_RULE', riktaCtx, projectStart, undefined) === withSupportiveTithi);
  for (const phase of ['CONTINUE', 'FINISH', 'PREPARE', 'REVIEW'] as ActionPhase[]) {
    check(`15. identity: actionPhase ${phase} -> reasons returned UNCHANGED (same array reference)`, applyLunarFamilyOverlay(withSupportiveTithi, 'REUSABLE_BASE_RULE', riktaCtx, projectStart, phase) === withSupportiveTithi);
  }
  // ---- identity: lunar context is not RIKTA ----
  check('15. identity: lunar context is non-Rikta (Shukla Panchami) -> reasons returned UNCHANGED', applyLunarFamilyOverlay(withSupportiveTithi, 'REUSABLE_BASE_RULE', nonRiktaCtx, projectStart, 'START') === withSupportiveTithi);
  // ---- identity: unsupported intent ----
  check('15. identity: unsupported intent (WORKOUT) -> reasons returned UNCHANGED', applyLunarFamilyOverlay(withSupportiveTithi, 'REUSABLE_BASE_RULE', riktaCtx, classification('WORKOUT'), 'START') === withSupportiveTithi);
  // ---- identity: Tithi coverage IMPLEMENTED (dedicated pack owns Tithi outright -- Griha Pravesh/Marriage) ----
  check('15. identity: tithiCoverage IMPLEMENTED -> reasons returned UNCHANGED regardless of phase/context (dedicated-pack precedence)', applyLunarFamilyOverlay(withUnfavorableTithi, 'IMPLEMENTED', riktaCtx, classification('GRIHA_PRAVESH'), 'START') === withUnfavorableTithi);
  check('15. identity: tithiCoverage MISSING with no match still returns the SAME reference when nothing applies', applyLunarFamilyOverlay(noTithiReasons, 'MISSING', riktaCtx, classification('WORKOUT'), 'START') === noTithiReasons);

  // ---- matching: replaces an existing TITHI_SUPPORTIVE reason ----
  {
    const result = applyLunarFamilyOverlay(withSupportiveTithi, 'REUSABLE_BASE_RULE', riktaCtx, projectStart, 'START');
    const tithiReasons = result.filter((r) => r.factor === 'TITHI');
    check('15. match: existing TITHI_SUPPORTIVE is replaced -- exactly one TITHI reason remains, and it is TITHI_FAMILY_CAUTION', tithiReasons.length === 1 && tithiReasons[0].code === 'TITHI_FAMILY_CAUTION');
    check('15. match: non-TITHI reasons (Nakshatra, Yoga) are preserved exactly, same objects, same relative order', result.includes(nakshatraReason) && result.includes(yogaReason) && result.indexOf(nakshatraReason) < result.indexOf(yogaReason));
  }
  // ---- matching: replaces an existing TITHI_UNFAVORABLE reason ----
  {
    const result = applyLunarFamilyOverlay(withUnfavorableTithi, 'REUSABLE_BASE_RULE', riktaCtx, projectStart, 'START');
    const tithiReasons = result.filter((r) => r.factor === 'TITHI');
    check('15. match: existing TITHI_UNFAVORABLE is replaced -- exactly one TITHI reason remains, and it is TITHI_FAMILY_CAUTION', tithiReasons.length === 1 && tithiReasons[0].code === 'TITHI_FAMILY_CAUTION');
    check('15. match: non-TITHI reasons preserved exactly here too', result.includes(nakshatraReason) && result.includes(yogaReason));
  }
  // ---- matching: no existing Tithi reason at all -- still adds exactly one ----
  {
    const result = applyLunarFamilyOverlay(noTithiReasons, 'REUSABLE_BASE_RULE', riktaCtx, projectStart, 'START');
    const tithiReasons = result.filter((r) => r.factor === 'TITHI');
    check('15. match: no prior Tithi reason -- overlay still adds exactly one TITHI_FAMILY_CAUTION', tithiReasons.length === 1 && tithiReasons[0].code === 'TITHI_FAMILY_CAUTION');
    check('15. match: non-TITHI reasons preserved exactly when there was no prior Tithi reason', result.includes(nakshatraReason) && result.includes(yogaReason));
  }
  // ---- shape of the added reason ----
  {
    const result = applyLunarFamilyOverlay(withSupportiveTithi, 'REUSABLE_BASE_RULE', riktaCtx, projectStart, 'START');
    const added = result.find((r) => r.code === 'TITHI_FAMILY_CAUTION')!;
    check('15. added reason shape: factor TITHI, polarity CAUTION, impact -8, value RIKTA', added.factor === 'TITHI' && added.polarity === 'CAUTION' && added.impact === -8 && added.value === 'RIKTA');
  }
  // ---- REUSABLE_BASE_RULE vs MISSING both count as "not dedicated" for precedence purposes ----
  check('15. tithiCoverage MISSING (no legacy proxy at all) still allows a match, same as REUSABLE_BASE_RULE', applyLunarFamilyOverlay(noTithiReasons, 'MISSING', riktaCtx, projectStart, 'START').some((r) => r.code === 'TITHI_FAMILY_CAUTION'));

  // ============================ structural: minimal, non-speculative surface ============================
  const src = strip(read('../packages/muhurta/src/lunarFamilyRules.ts'));
  check('structural: no astronomy import (no astronomy-engine, no getTithi/getSiderealLongitude reference)', !/astronomy-engine|getTithi\(|getSiderealLongitude/.test(src));
  check('structural: lunarTithiContext.ts is imported type-only (this module never recalculates or duplicates it)', /import type \{[^}]*\} from '\.\/lunarTithiContext'/.test(src));
  check('structural: no TITHI_FAMILY_SUPPORT anywhere (L3 implements only the caution side)', !/TITHI_FAMILY_SUPPORT/.test(src));
  check('structural: no PakshaBand-based branching (band is never read as a condition)', !/pakshaBand/i.test(src) || !/if[^{]*pakshaBand|pakshaBand[^;]*===/.test(src));
  check('structural: no exact-Tithi field on the rule shape yet (tithiName/exactTithi absent)', !/exactTithi|tithiName:\s*string/.test(src));
  check('structural: exactly one rule is exported/defined for this slice', (src.match(/^export const \w+_RULE: LunarFamilyRule/m) ?? []).length === 1);
  check('structural: no second scoring subsystem (no RIKTA_SCORE/LUNAR_SCORE/PAKSHA_SCORE)', !/RIKTA_SCORE|LUNAR_SCORE|PAKSHA_SCORE/.test(src));

  if (!allPassed) { console.error('SOME LUNAR FAMILY RULES CHECKS FAILED'); process.exit(1); }
  console.log('ALL LUNAR FAMILY RULES CHECKS PASSED');
}
main();
