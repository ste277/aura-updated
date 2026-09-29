/**
 * Lunar Intelligence V1 L4 -- unit tests for the exact-Tithi rule module
 * itself (packages/muhurta/src/lunarExactTithiRules.ts), tested directly
 * against the resolver, independent of the Muhurta evaluation pipeline (see
 * test/muhurtaRulePacks.test.ts for the integration/precedence proof).
 */
import fs from 'fs';
import path from 'path';
import { buildLunarTithiContext } from '../packages/muhurta/src/lunarTithiContext';
import { resolveLunarExactTithiReason, AMAVASYA_START_CAUTION_RULE } from '../packages/muhurta/src/lunarExactTithiRules';
import type { MuhurtaClassification } from '../packages/muhurta/src/activityOntology';
import type { ActionPhase } from '../packages/muhurta/src/actionPhase';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const classification = (intent: MuhurtaClassification['intent']): MuhurtaClassification => ({
  family: 'WORK', // deliberately arbitrary -- the resolver keys on intent, not family
  intent,
  significance: 'HIGH',
  evaluationDepth: 'DEEP',
  timingSensitivity: { start: 'HIGH', duration: 'MEDIUM', end: 'LOW' },
});

async function main() {
  const amavasyaCtx = buildLunarTithiContext('Amavasya');
  check('fixture sanity: "Amavasya" resolves to tithiName "Amavasya" (L1, unmodified)', amavasyaCtx.tithiName === 'Amavasya');
  check('fixture sanity: Amavasya lands in the PURNA family (L1\'s own ordinal-mod-5 arithmetic -- this rule must not key on that)', amavasyaCtx.family === 'PURNA');

  // ============================ 1-3. supported intents + Amavasya + START -> CAUTION ============================
  const supportedIntents: MuhurtaClassification['intent'][] = ['PROJECT_START', 'BUSINESS_START', 'JOURNEY_START'];
  for (const intent of supportedIntents) {
    const reason = resolveLunarExactTithiReason(amavasyaCtx, classification(intent), 'START');
    check(`1-3. Amavasya + ${intent} + START -> match`, reason !== null);
    check(`1-3. Amavasya + ${intent} + START -> code TITHI_EXACT_CAUTION`, reason?.code === 'TITHI_EXACT_CAUTION');
    check(`1-3. Amavasya + ${intent} + START -> factor TITHI`, reason?.factor === 'TITHI');
    check(`1-3. Amavasya + ${intent} + START -> polarity CAUTION`, reason?.polarity === 'CAUTION');
    check(`1-3. Amavasya + ${intent} + START -> impact -8`, reason?.impact === -8);
    check(`1-3. Amavasya + ${intent} + START -> value "Amavasya"`, reason?.value === 'Amavasya');
    check(`1-3. Amavasya + ${intent} + START -> params carries actionPhase/intent, no display prose beyond a short note`, reason?.params?.actionPhase === 'START' && reason?.params?.intent === intent && typeof reason?.params?.note === 'string' && (reason!.params!.note as string).length < 200);
  }
  check('metadata present on the rule definition', !!AMAVASYA_START_CAUTION_RULE.metadata && AMAVASYA_START_CAUTION_RULE.metadata.sources.length > 0);

  // ============================ 4-8. every other/absent phase -> no match ============================
  const otherPhases: Array<ActionPhase | undefined> = ['CONTINUE', 'FINISH', 'PREPARE', 'REVIEW', undefined];
  for (const phase of otherPhases) {
    const reason = resolveLunarExactTithiReason(amavasyaCtx, classification('PROJECT_START'), phase);
    check(`4-8. Amavasya + PROJECT_START + ${phase === undefined ? 'undefined' : phase} -> no match`, reason === null);
  }
  // Same proof repeated for every supported intent, not just PROJECT_START.
  for (const intent of supportedIntents) {
    for (const phase of otherPhases) {
      const reason = resolveLunarExactTithiReason(amavasyaCtx, classification(intent), phase);
      check(`4-8. Amavasya + ${intent} + ${phase === undefined ? 'undefined' : phase} -> no match`, reason === null);
    }
  }
  check('undefined actionPhase is explicitly distinct from the string "undefined" and from START -- never coerced', resolveLunarExactTithiReason(amavasyaCtx, classification('PROJECT_START'), undefined) === null);

  // ============================ 9. unsupported intents -> no match ============================
  const unrelatedIntents: MuhurtaClassification['intent'][] = ['ADMIN', 'GRIHA_PRAVESH', 'MARRIAGE', 'IMPORTANT_FINANCIAL_DECISION', 'PROPERTY_PURCHASE', 'MEDITATION', 'WORKOUT', 'GENERAL'];
  for (const intent of unrelatedIntents) {
    const reason = resolveLunarExactTithiReason(amavasyaCtx, classification(intent), 'START');
    check(`9. unsupported intent ${intent} + Amavasya + START -> no match (this module's resolver alone; GRIHA_PRAVESH/MARRIAGE also stay unreachable via the caller's coverage gate, see the integration suite)`, reason === null);
  }

  // ============================ 10. exact-identity proof: Purnima/Panchami/Dashami must NOT match ============================
  // This is the entire point of matching on tithiName rather than family/ordinal/paksha: Purnima and Amavasya are
  // both PURNA (ordinal 15), and Panchami/Dashami share the same family too -- none of them are Amavasya itself.
  const nonAmavasyaNames = ['Purnima', 'Shukla Panchami', 'Krishna Panchami', 'Shukla Dashami', 'Krishna Dashami'];
  for (const name of nonAmavasyaNames) {
    const ctx = buildLunarTithiContext(name);
    for (const intent of supportedIntents) {
      const reason = resolveLunarExactTithiReason(ctx, classification(intent), 'START');
      check(`10. "${name}" (family ${ctx.family}) + ${intent} + START -> no match (PURNA-family membership alone does not trigger the exact rule)`, reason === null);
    }
  }

  // ============================ 11. provenance ============================
  check('11. the rule definition carries provenance: sources[], confidence, scope, lastReviewed, note', AMAVASYA_START_CAUTION_RULE.metadata.sources.length > 0 && AMAVASYA_START_CAUTION_RULE.metadata.sources.every((s) => Boolean(s.sourceType) && Boolean(s.title) && (Boolean(s.citation) || Boolean(s.notes))) && !!AMAVASYA_START_CAUTION_RULE.metadata.confidence && !!AMAVASYA_START_CAUTION_RULE.metadata.scope && !!AMAVASYA_START_CAUTION_RULE.metadata.lastReviewed && !!AMAVASYA_START_CAUTION_RULE.metadata.note);
  check('11. provenance reuses the existing MuhurtaRuleSource/Confidence/Scope vocabulary values (no invented second vocabulary)', ['ESTABLISHED', 'CURATED', 'PROVISIONAL'].includes(AMAVASYA_START_CAUTION_RULE.metadata.confidence) && ['GENERAL', 'REGIONAL'].includes(AMAVASYA_START_CAUTION_RULE.metadata.scope) && AMAVASYA_START_CAUTION_RULE.metadata.sources.every((s) => ['CLASSICAL_TEXT', 'TRADITIONAL_REFERENCE', 'CURATED_METHODOLOGY'].includes(s.sourceType)));
  check('11. classification matches the L4.1 evidence audit exactly: TRADITIONAL_REFERENCE / CURATED (not CLASSICAL_TEXT / ESTABLISHED -- no verified primary-text quotation)', AMAVASYA_START_CAUTION_RULE.metadata.confidence === 'CURATED' && AMAVASYA_START_CAUTION_RULE.metadata.sources.every((s) => s.sourceType === 'TRADITIONAL_REFERENCE') && AMAVASYA_START_CAUTION_RULE.metadata.scope === 'GENERAL');

  // ============================ structural: minimal, non-speculative surface ============================
  const src = strip(read('../packages/muhurta/src/lunarExactTithiRules.ts'));
  check('structural: no astronomy import (no astronomy-engine, no getTithi/getSiderealLongitude reference)', !/astronomy-engine|getTithi\(|getSiderealLongitude/.test(src));
  check('structural: lunarTithiContext.ts is imported type-only (this module never recalculates or duplicates it)', /import type \{[^}]*\} from '\.\/lunarTithiContext'/.test(src));
  check('structural: no recomputation of Panchang/Tithi anywhere (no getPanchangaSnapshot/getPanchangForDate reference)', !/getPanchangaSnapshot|getPanchangForDate/.test(src));
  check('structural: does not branch on `.family`, `.ordinal`, or `.paksha` (must match on tithiName alone, never infer from PURNA/ordinal 15/Krishna Paksha)', !/\.family\b|\.ordinal\b|\.paksha\b/.test(src));
  check('structural: no TITHI_EXACT_SUPPORT anywhere (L4 implements only the caution side)', !/TITHI_EXACT_SUPPORT/.test(src));
  check('structural: exactly one rule is exported/defined for this slice', (src.match(/^export const \w+_RULE: LunarExactTithiRule/m) ?? []).length === 1);
  check('structural: LUNAR_EXACT_TITHI_RULES has exactly one entry', (() => { const m = src.match(/LUNAR_EXACT_TITHI_RULES: LunarExactTithiRule\[\] = \[([^\]]*)\]/); return !!m && m[1].split(',').filter(Boolean).length === 1; })());
  check('structural: no second scoring subsystem (no AMAVASYA_SCORE/LUNAR_SCORE/EXACT_TITHI_SCORE)', !/AMAVASYA_SCORE|LUNAR_SCORE|EXACT_TITHI_SCORE/.test(src));
  check('structural: this module does not import from lunarFamilyRules.ts (one-directional dependency: lunarFamilyRules.ts imports FROM here, never the reverse)', !/from '\.\/lunarFamilyRules'/.test(src));
  check('structural: rule matches on tithiName, not on family/ordinal comparisons in resolveLunarExactTithiReason', /rule\.tithiName\s*!==\s*lunarContext\.tithiName/.test(src));

  if (!allPassed) { console.error('SOME LUNAR EXACT TITHI RULES CHECKS FAILED'); process.exit(1); }
  console.log('ALL LUNAR EXACT TITHI RULES CHECKS PASSED');
}
main();
