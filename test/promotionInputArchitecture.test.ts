/**
 * Constructor Decision Intelligence -- O5 P4a: the TYPED PROMOTION INPUT (architecture guard, pure).
 *
 * A PromotionInput is the ONE typed boundary a future promotion policy (P4b, not implemented) may consume to learn which
 * finally-Deferred, pressured candidates and which of their final contention owners may ENTER a policy evaluation. It is
 * permission to evaluate, never a promotion. This guard pins that it:
 *
 *   - is assembled by one PURE module from reviewed typed authorities only -- already-derived pressure, the P3a trace, the
 *     final result and the normalised above-pressure facts -- through the one reviewed comparator primitive, never from raw
 *     recurrence / opportunity facts, DecisionFacts, DecisionEvidence, the scheduling context, a database or the P3b
 *     aggregate classification
 *   - carries only stable intent ids (a candidate and its 1..N FINAL owners) in a deeply frozen, detached, Date / Map /
 *     Set / callback-free record, with no pressure copy, no precedence value, no round, no interval, no count
 *   - is prepared by one internal boundary that derives pressure itself, after construction, from the evidence the run
 *     prepared (never from a caller), fails closed, and reads no database / snapshot / clock
 *   - has ZERO production consumers: not the Constructor, comparator, placement, replenishment, capacity, preview,
 *     signing, acceptance, persistence, Recomposition, Move, any route, any schema or migration, the P3b shadow stage, or
 *     the P2d scheduling context
 *   - implements no P4b / P5 concept: no promotion decision, counterfactual, second pass, replacement or policy
 *
 * Every rule is a PURE FUNCTION over a set of source files: it runs on the real tree (zero violations expected) AND on the
 * real tree with a synthetic violation injected, proving each rule fires. P4a does not start P4b, P5, R3 or S5.
 */
import fs from 'fs';
import path from 'path';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const root = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const count = (re: RegExp, s: string) => (s.match(re) ?? []).length;

interface SrcFile { f: string; src: string }
function productionFiles(): SrcFile[] {
  const out: SrcFile[] = [];
  const walk = (dir: string) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).forEach((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.')) walk(rel); } else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push({ f: rel, src: stripComments(read(rel)) });
  });
  ['apps/web/lib', 'apps/web/app', 'apps/web/components'].forEach(walk);
  fs.readdirSync(path.join(root, 'packages'), { withFileTypes: true }).forEach((p) => { if (p.isDirectory() && fs.existsSync(path.join(root, 'packages', p.name, 'src'))) walk(path.join('packages', p.name, 'src')); });
  return out.sort((a, b) => (a.f < b.f ? -1 : 1));
}

// ============================================================
// The pinned model.
// ============================================================
const ASM = 'apps/web/lib/promotionInput.ts';
const PREP = 'apps/web/lib/promotionInputPreparation.ts';
/** O5 P4b2a -- the pure promotion contention authority consumes a PromotionInput (type only) to project the matching contention; pinned by promotionContentionAuthorityArchitecture.test.ts. */
const CONTENTION_AUTH = 'apps/web/lib/promotionContentionAuthority.ts';
/** O5 P4b2 -- the pure local counterfactual generator consumes a PromotionInput (type only); it is the ONLY file allowed the word `counterfactual` (every other P4b/P5 term stays banned there too). Pinned by localCounterfactualArchitecture.test.ts. */
const LOCAL = 'apps/web/lib/localCounterfactual.ts';
const P4B_CONCEPT = /applyPromotion|promoteCandidate|PromotionPolicy|PromotionDecision|WinnerReplacement|GoalPromotionInput|AuraPromotionDecision|counterfactual|secondPass|SecondPass|shouldReplace|replaceOwner|displaceOwner|activePressurePolicy|PressurePolicy/i;
const P4B_CONCEPT_NO_COUNTERFACTUAL = /applyPromotion|promoteCandidate|PromotionPolicy|PromotionDecision|WinnerReplacement|GoalPromotionInput|AuraPromotionDecision|secondPass|SecondPass|shouldReplace|replaceOwner|displaceOwner|activePressurePolicy|PressurePolicy/i;
/** O5 P4b3 -- the pure acceptance predicate consumes a PromotionInput (type only) for the authorized owner scope; it may ALSO name `counterfactual` (it judges one). Pinned by counterfactualAcceptanceArchitecture.test.ts. */
const ACCEPTANCE = 'apps/web/lib/counterfactualAcceptance.ts';
/** O5 P4b4 -- the same-run shadow policy composition: the ONLY production consumer of the preparation boundary (it runs ONE orchestration through it; nothing consumes the composition). */
const SHADOW_POLICY = 'apps/web/lib/shadowPolicyObservation.ts';
const PROMO_FILES = [ASM, PREP, CONTENTION_AUTH, LOCAL, ACCEPTANCE, SHADOW_POLICY];
const ORCH = 'apps/web/lib/dayConstructorOrchestrator.ts';
const OBS = 'apps/web/lib/shadowPressureObservation.ts';
const EVAL = 'apps/web/lib/shadowPressureEvaluation.ts';
const ABOVE = 'apps/web/lib/abovePressurePrecedence.ts';
const CTXM = 'apps/web/lib/decisionSchedulingContext.ts';

const PROMO_IDENT = /\b(PromotionInput[A-Za-z]*|PromotionOwner|assemblePromotionInputs|preparePromotionInputs)\b|promotionInput(?:Preparation)?['"]/;
const PROMO_WORD = /promotionInput/i;
/** The raw facts / evidence chain: an input is built from DERIVED pressure only. */
const PRESSURE_CHAIN = /DecisionFacts|decisionFacts|DecisionEvidence|decisionEvidence|OpportunityDecisionFacts|recurrence|\bopportunity\b|remainingInPeriod|afterStart\w*|durationBasis|startDateState|viableDays|unknownDays|evaluatedDays|completedInPeriod|committedInPeriod|targetPerPeriod|coverage/;
/** Value signals / placement quality: the assembler never names them (the shared comparator primitive does, once). */
const VALUE_VOCAB = /importance|deadline|originalOrder|targetDate|timingFit|candidateOrder|capacity|\bwindow\b|durationMinutes/i;
const SOURCE_VOCAB = /goal|manual|automatic|demand|provenance|handoff|hand-off|rhythm|plan-day|\btitle\b|activityId|startsWith|decodeGoal|encodeGoal|\bUI\b/i;
const IO_VOCAB = /\basync\b|\bawait\b|Promise|setTimeout|setInterval|\bpool\b|\.query\(|beginTransaction|INSERT|UPDATE|DELETE|fetch\(|Date\.now|new Date\(|\bDate\b|process\.|\benv\b|console\.|logger|\.warn\(|\.error\(|telemetry|trackEvent|Math\.random|require\(/;
/** The P3b aggregate enum: P4a must not branch on (or even name) the diagnostics classification. */
const P3B_AGGREGATE = /shadowPressure|ShadowPressure|evaluateShadowPressure|PRESSURE_ELIGIBLE|BLOCKED_BY_STRONGER|PRECEDENCE_ANOMALY|NO_FINAL_CONTENTION_OWNER|INCOMPLETE_INPUT|NOT_PRESSURED|NO_CONTENTION|NOT_FINAL_DEFERRED|\.classification/;
/** P4b / P5 concepts: nothing in production implements or names them. */
const P4B_VOCAB = /applyPromotion|promoteCandidate|PromotionPolicy|PromotionDecision|WinnerReplacement|GoalPromotionInput|AuraPromotionDecision|counterfactual|secondPass|SecondPass|wouldWin|shouldWin|shouldReplace|WOULD_WIN|SHOULD_|replaceOwner|displaceOwner|activePressurePolicy|PressurePolicy|\bscore\b|weight|\brank|boost|priorit|urgen|INCORRECT|MISSED/i;
const CONTEXT_IDENT = /DecisionSchedulingContext|decisionSchedulingContext|SchedulingContext|schedulingContext|schedulingBinding/;
/** Every surface that must never carry or read a promotion input. */
const NEVER_PROMO = [
  'apps/web/lib/dayConstructor.ts', 'apps/web/lib/dayIntent.ts', 'apps/web/lib/dayCapacity.ts', ORCH, 'apps/web/lib/dayConstructorPreviewRequest.ts',
  'apps/web/lib/dayConstructorPreviewIntegrity.ts', 'apps/web/lib/dayConstructorPreviewClient.ts', 'apps/web/lib/dayConstructorAcceptance.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts',
  'apps/web/lib/remainingDayRecomposition.ts', 'apps/web/lib/remainingDayRecompositionAcceptance.ts', 'apps/web/lib/remainingDayRecompositionIntegrity.ts', 'apps/web/lib/remainingDayRecompositionServer.ts',
  'apps/web/lib/homeRecomposition.ts', 'apps/web/lib/planMove.ts', 'apps/web/lib/homeMove.ts', 'apps/web/lib/dayPlanPreviewPresentation.ts', 'apps/web/lib/dayPlanAcceptancePresentation.ts', 'apps/web/lib/db.ts',
  'apps/web/lib/contentionTrace.ts', 'apps/web/lib/decisionPressure.ts', 'apps/web/lib/decisionEvidence.ts', 'apps/web/lib/decisionFacts.ts', 'apps/web/lib/decisionFactPreparation.ts', 'apps/web/lib/goalDecisionFactsProvider.ts',
  CTXM, 'apps/web/lib/decisionSchedulingContextLoader.ts', ABOVE, EVAL, OBS,
  'apps/web/app/api/day-constructor/preview/route.ts', 'apps/web/app/api/day-constructor/accept/route.ts', 'apps/web/app/api/day/recompose/route.ts', 'apps/web/app/api/plans/[planId]/move/route.ts', 'apps/web/app/api/plans/route.ts',
];
const ASM_IMPORTS = [`import type { ConstructedDay } from './dayConstructor';`, `import type { ContentionTrace } from './contentionTrace';`, `import type { DecisionPressure } from './decisionPressure';`, `import { compareAbovePressure, type AbovePressureFacts } from './abovePressurePrecedence';`];
const PREP_IMPORTS = [`from './dayConstructorOrchestrator'`, `from './decisionPressure'`, `from './abovePressurePrecedence'`, `from './promotionInput'`, `from './promotionContentionAuthority'`, `from './schedulingAttemptAuthority'`];

function interfaceBody(src: string, name: string): string {
  const m = src.match(new RegExp(`export interface ${name} \\{[\\s\\S]*?\\n\\}`));
  return m ? m[0] : '';
}
function importLines(src: string): string[] { return Array.from(src.matchAll(/^import [^\n]*;$/gm)).map((m) => m[0]); }

function audit(files: SrcFile[]): string[] {
  const v: string[] = [];
  const by = (re: RegExp) => files.filter((x) => re.test(x.src)).map((x) => x.f);
  const get = (f: string) => files.find((x) => x.f === f);
  const notIn = (list: string[], allow: string[]) => list.filter((f) => !allow.includes(f));
  // Q1 -- vocabulary confinement and zero production consumers
  notIn(by(PROMO_IDENT), PROMO_FILES).forEach((f) => v.push(`Q1:names-promotion-input:${f}`));
  notIn(by(PROMO_WORD), PROMO_FILES).forEach((f) => v.push(`Q1:promotion-input-vocabulary:${f}`));
  notIn(by(/from '\.\/promotionInput'/), [PREP, CONTENTION_AUTH, LOCAL, ACCEPTANCE]).forEach((f) => v.push(`Q1:imports-the-assembler:${f}`));
  by(/from '\.\/promotionInputPreparation'/).filter((f) => f !== SHADOW_POLICY).forEach((f) => v.push(`Q1:production-consumer-of-promotion-boundary:${f}`));
  notIn(by(/\bpreparePromotionInputs\(/), [PREP, SHADOW_POLICY]).forEach((f) => v.push(`Q1:calls-promotion-boundary:${f}`));
  notIn(by(/\bassemblePromotionInputs\(/), [ASM, PREP]).forEach((f) => v.push(`Q1:calls-assembler:${f}`));
  notIn(by(/\borchestrateConstructDayWithDiagnostics\(/), [ORCH, OBS, PREP]).forEach((f) => v.push(`Q1:calls-diagnostics-entry-point:${f}`));
  files.filter((x) => (x.f === LOCAL || x.f === ACCEPTANCE || x.f === SHADOW_POLICY ? P4B_CONCEPT_NO_COUNTERFACTUAL : P4B_CONCEPT).test(x.src)).map((x) => x.f).forEach((f) => v.push(`Q1:p4b-or-p5-concept:${f}`));
  { const x = get(LOCAL); if (x && /^import (?!type )[^\n]*from '\.\/promotionInput'/m.test(x.src)) v.push(`Q1:generator-imports-the-assembler-as-a-value:${LOCAL}`); }
  // Q2 -- the pure assembler
  const a = get(ASM);
  if (a) {
    const imports = importLines(a.src);
    if (JSON.stringify(imports) !== JSON.stringify(ASM_IMPORTS)) v.push(`Q2:assembler-imports-are-not-the-reviewed-four:${ASM}`);
    if (PRESSURE_CHAIN.test(a.src)) v.push(`Q2:assembler-reads-raw-facts-or-evidence:${ASM}`);
    if (/deriveDecisionPressure/.test(a.src)) v.push(`Q2:assembler-derives-pressure:${ASM}`);
    if (VALUE_VOCAB.test(a.src)) v.push(`Q2:assembler-names-value-or-timing:${ASM}`);
    if (SOURCE_VOCAB.test(a.src)) v.push(`Q2:assembler-source-vocabulary:${ASM}`);
    if (IO_VOCAB.test(a.src)) v.push(`Q2:assembler-io-clock-env-log:${ASM}`);
    if (P3B_AGGREGATE.test(a.src)) v.push(`Q2:assembler-uses-p3b-aggregate:${ASM}`);
    if (CONTEXT_IDENT.test(a.src)) v.push(`Q2:assembler-names-the-scheduling-context:${ASM}`);
    if (/\bconstructDay\w*\(|orchestrate\w*\(|\.attempted\w*|\.winnerStart|\.winnerEnd|\.round\b|intervalsOverlap|contentionEventCount|\.reason\b|primaryReason|capacityState/.test(a.src)) v.push(`Q2:assembler-constructs-or-reads-geometry-round-count-reason:${ASM}`);
    if (P4B_VOCAB.test(a.src)) v.push(`Q2:assembler-policy-or-score-vocabulary:${ASM}`);
    if (count(/compareAbovePressure\(/g, a.src) !== 1 || /compareByOverloadPrecedence|IMPORTANCE_RANK|sortByOverloadPrecedence/.test(a.src)) v.push(`Q2:assembler-reimplements-comparison:${ASM}`);
    if (/\bDate\b|=>|Function/.test(interfaceBody(a.src, 'PromotionInput') + interfaceBody(a.src, 'PromotionOwner'))) v.push(`Q2:output-type-holds-date-or-callback:${ASM}`);
    if (!/readonly candidateIntentId: string;\s*\/\*\*[^*]*\*\/\s*readonly owners: readonly PromotionOwner\[\];|readonly candidateIntentId: string;\s*readonly owners: readonly PromotionOwner\[\];/.test(a.src.replace(/\/\*\*[\s\S]*?\*\//g, ''))) v.push(`Q2:input-shape-changed:${ASM}`);
    if (JSON.stringify(Array.from(interfaceBody(a.src, 'PromotionOwner').matchAll(/readonly (\w+):/g)).map((m) => m[1])) !== JSON.stringify(['intentId', 'pressure']) || JSON.stringify(Array.from(interfaceBody(a.src, 'PromotionInput').matchAll(/readonly (\w+):/g)).map((m) => m[1])) !== JSON.stringify(['candidateIntentId', 'owners'])) v.push(`Q2:output-fields-are-not-exactly-the-minimum:${ASM}`);
    if (/\b(Map|Set)<[^>]*>/.test(interfaceBody(a.src, 'PromotionInput') + interfaceBody(a.src, 'PromotionOwner'))) v.push(`Q2:output-type-holds-map-or-set:${ASM}`);
    if (count(/Object\.freeze\(/g, a.src) < 4) v.push(`Q2:output-not-frozen:${ASM}`);
    if (/\.find\(|\[0\]|\.slice\(|\.shift\(|\.pop\(|\bmax\b|\bmin\b|\.reduce\(/.test(a.src) || !/Object\.freeze\(finalOwnerIds\.map\(\(ownerId, index\) => Object\.freeze\(\{ intentId: ownerId, pressure: ownerPressures\[index\] as DecisionPressure \}\)\)\)/.test(a.src)) v.push(`Q2:owners-collapsed-or-selected:${ASM}`);
    // O5 P4a2 -- owner pressure: each owner's OWN value from the one pressure authority; completeness gate only (never an eligibility rule); no aggregate, no reorder, no candidate-pressure reuse
    if (!/const ownerPressures = finalOwnerIds\.map\(\(ownerId\) => authority\.pressureByIntentId\.get\(ownerId\)\);/.test(a.src)) v.push(`Q2:owner-pressure-not-read-per-owner-from-the-authority:${ASM}`);
    if (!/if \(ownerPressures\.some\(\(pressure\) => pressure !== 'NONE' && pressure !== 'LAST_KNOWN_OPPORTUNITY'\)\) continue;/.test(a.src) || count(/ownerPressures/g, a.src) !== 3) v.push(`Q2:owner-pressure-completeness-gate-changed-or-used-as-a-policy:${ASM}`);
    if (/hasPressuredOwner|allOwnersUnpressured|ownerPressureCount|anyOwnerPressured|pressuredOwner|unpressuredOwner|\.sort\(|\.reverse\(/.test(a.src)) v.push(`Q2:owner-pressure-aggregated-or-owners-reordered:${ASM}`);
    if (count(/pressureByIntentId\.get\(/g, a.src) !== 2) v.push(`Q2:pressure-read-count-changed:${ASM}`);
    if (!/export function assemblePromotionInputs\(authority: PromotionInputAuthority\): readonly PromotionInput\[\]/.test(a.src)) v.push(`Q2:assembler-signature-changed:${ASM}`);
    if (!/tiesEveryFinalOwner = finalOwnerIds\.every\(/.test(a.src)) v.push(`Q2:all-owner-rule-missing:${ASM}`);
    if (!/=== 'TIE'/.test(a.src) || /A_STRONGER|B_STRONGER/.test(a.src)) v.push(`Q2:eligibility-is-not-tie-only:${ASM}`);
    if (!/!== 'LAST_KNOWN_OPPORTUNITY'\) continue/.test(a.src)) v.push(`Q2:pressure-gate-missing:${ASM}`);
    if (!/authority\.contentionTrace\.events/.test(a.src) || !/authority\.finalDay\.deferredItems/.test(a.src)) v.push(`Q2:contention-or-final-state-authority-missing:${ASM}`);
    if (!/isAmbiguous\(candidateId\)\) continue/.test(a.src) || !/historicalOwners\.some\(isAmbiguous\)/.test(a.src)) v.push(`Q2:duplicate-id-fail-closed-missing:${ASM}`);
    if (!/filter\(\(ownerId\) => proposedSet\.has\(ownerId\)\)/.test(a.src)) v.push(`Q2:final-owner-filter-missing:${ASM}`);
  }
  // Q3 -- the preparation boundary
  const p = get(PREP);
  if (p) {
    const froms = Array.from(read(PREP).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/^import [^\n]*(from '[^']+');$/gm)).map((m) => m[1]);
    if (JSON.stringify(froms) !== JSON.stringify(PREP_IMPORTS)) v.push(`Q3:boundary-imports-are-not-the-reviewed-six:${PREP}`);
    if (PRESSURE_CHAIN.test(p.src)) v.push(`Q3:boundary-reads-raw-facts-or-evidence:${PREP}`);
    if (VALUE_VOCAB.test(p.src)) v.push(`Q3:boundary-names-value-or-timing:${PREP}`);
    if (SOURCE_VOCAB.test(p.src)) v.push(`Q3:boundary-source-vocabulary:${PREP}`);
    if (P3B_AGGREGATE.test(p.src)) v.push(`Q3:boundary-uses-p3b:${PREP}`);
    if (CONTEXT_IDENT.test(p.src)) v.push(`Q3:boundary-names-the-scheduling-context:${PREP}`);
    if (/\bconsole\.|logger|\.warn\(|\.error\(|telemetry|trackEvent|\bpool\b|\.query\(|from '\.\/db'|INSERT|UPDATE|DELETE|fetch\(|process\.|Date\.now|new Date\(|Math\.random|beginTransaction|withRepeatableReadSnapshot|loadDecisionSchedulingContext/.test(p.src)) v.push(`Q3:boundary-io-log-db-snapshot-clock:${PREP}`);
    if (count(/\bawait\b/g, p.src) !== 1 || /\bconstructDay\(|constructDayWithTrace\(|orchestrateConstructDay\(|orchestrateConstructDayWithTrace\(/.test(p.src) || count(/orchestrateConstructDayWithDiagnostics\(/g, p.src) !== 1) v.push(`Q3:boundary-runs-a-second-construction:${PREP}`);
    if (count(/deriveDecisionPressure\(/g, p.src) !== 1 || !/deriveDecisionPressure\(\{ evidence: diagnostics\.evidenceByIntentId\.get\(id\), planningDate: diagnostics\.planningDate, flexibility: resolved\.dayIntent\.flexibility \}\)/.test(p.src)) v.push(`Q3:boundary-pressure-authority-changed:${PREP}`);
    if (!/export async function preparePromotionInputs\(request: ConstructDayRequest, deps: DayConstructorOrchestratorDeps\)/.test(p.src)) v.push(`Q3:boundary-accepts-caller-authority:${PREP}`);
    if (!/catch \{\s*return \{ result, promotion: Object\.freeze\(\{ status: 'UNAVAILABLE', reason: 'PREPARATION_FAILED' \}\), run: RUN_PREPARATION_FAILED \};/.test(p.src) || !/status !== 'READY'\) return \{ result, promotion: Object\.freeze\(\{ status: 'UNAVAILABLE', reason: 'RUN_NOT_READY' \}\), run: RUN_NOT_READY \}/.test(p.src)) v.push(`Q3:boundary-not-fail-closed:${PREP}`);
    if (p.src.indexOf('assemblePromotionInputs(') < p.src.indexOf('const result = diagnostics.result')) v.push(`Q3:assembly-before-construction:${PREP}`);
    if (!/if \(pressureByIntentId\.has\(id\)\) throw new Error\(/.test(p.src) || p.src.indexOf('pressureByIntentId.has(id)') < p.src.indexOf('try {')) v.push(`Q3:duplicate-resolved-id-guard-missing-or-outside-the-try:${PREP}`);
    if (P4B_VOCAB.test(p.src)) v.push(`Q3:boundary-policy-or-score-vocabulary:${PREP}`);
  }
  // Q4 -- nothing that decides, places, persists, presents, reads the context or shadows knows a promotion input
  for (const f of NEVER_PROMO) { const x = get(f); if (x && (PROMO_IDENT.test(x.src) || PROMO_WORD.test(x.src))) v.push(`Q4:surface-names-promotion-input:${f}`); }
  // Q5 -- the P3b shadow stage and the P4a assembler stay independent in BOTH directions; P4a reuses the one comparator helper
  const sh = [get(EVAL), get(OBS)];
  for (const x of sh) if (x && /promotion/i.test(x.src)) v.push(`Q5:shadow-stage-names-promotion:${x.f}`);
  notIn(by(/from '\.\/abovePressurePrecedence'/), [EVAL, OBS, ASM, PREP, ACCEPTANCE]).forEach((f) => v.push(`Q5:imports-above-pressure-helper:${f}`));
  notIn(by(/from '\.\/shadowPressureEvaluation'|from '\.\/shadowPressureObservation'/), [OBS]).forEach((f) => v.push(`Q5:imports-shadow-stage:${f}`));
  return v;
}
const real = productionFiles();
const src = (f: string) => real.find((x) => x.f === f)!.src;
const mutateFile = (files: SrcFile[], f: string, fn: (s: string) => string): SrcFile[] => files.map((x) => (x.f === f ? { f, src: fn(x.src) } : x));
const addFile = (files: SrcFile[], f: string, s: string): SrcFile[] => [...files, { f, src: s }];
const flags = (violations: string[], prefix: string, file?: string) => violations.some((x) => x.startsWith(prefix) && (file === undefined || x.endsWith(`:${file}`)));
const names = (re: RegExp) => real.filter((x) => re.test(x.src)).map((x) => x.f);

// ============================================================
console.log('=== the real tree conforms ===');
const baseline = audit(real);
check(`THE REAL PRODUCTION TREE HAS ZERO PROMOTION-INPUT ARCHITECTURE VIOLATIONS (${real.length} production files scanned)${baseline.length ? ': ' + baseline.join(', ') : ''}`, baseline.length === 0);

console.log('=== allowlists: producers, consumers, reachability ===');
const asm = src(ASM);
const prep = src(PREP);
check('THE PROMOTION VOCABULARY EXISTS IN EXACTLY SIX PRODUCTION FILES: the pure assembler, its internal preparation boundary and the four consumers (O5 P4b2a the pure promotion contention authority, O5 P4b2 the pure local counterfactual generator, O5 P4b3 the pure counterfactual acceptance predicate, O5 P4b4 the same-run shadow policy composition)', JSON.stringify(names(PROMO_IDENT)) === JSON.stringify([...PROMO_FILES].sort()) && JSON.stringify(names(PROMO_WORD)) === JSON.stringify([...PROMO_FILES].sort()));
check('NO ACTIVE CONSUMERS (no promotion is applied): the preparation boundary is imported and called only by the inert O5 P4b4 shadow policy composition (which nothing consumes); the assembler is imported and called only by the boundary', JSON.stringify(names(/from '\.\/promotionInputPreparation'/)) === JSON.stringify([SHADOW_POLICY]) && JSON.stringify(names(/\bpreparePromotionInputs\(/)) === JSON.stringify([PREP, SHADOW_POLICY].sort()) && JSON.stringify(names(/from '\.\/promotionInput'/)) === JSON.stringify([PREP, CONTENTION_AUTH, LOCAL, ACCEPTANCE].sort()) && JSON.stringify(names(/\bassemblePromotionInputs\(/)) === JSON.stringify([ASM, PREP].sort()));
check('the orchestrator\'s diagnostics entry point is called by exactly the shadow boundary and the promotion boundary (each read-only, after construction)', JSON.stringify(names(/\borchestrateConstructDayWithDiagnostics\(/)) === JSON.stringify([ORCH, OBS, PREP].sort()));
check('THE ONLY NEW TYPED BOUNDARY FOR PRESSURE PROMOTION ELIGIBILITY: the above-pressure helper is imported by the P3b stage, by the two P4a modules and (O5 P4b3, to RE-CHECK the tie through the same primitive) by the pure acceptance predicate, and nowhere else; the P3b stage never names promotion and P4a never imports the P3b stage', JSON.stringify(names(/from '\.\/abovePressurePrecedence'/)) === JSON.stringify([EVAL, OBS, ASM, PREP, ACCEPTANCE].sort()) && !/promotion/i.test(src(EVAL) + src(OBS)) && JSON.stringify(names(/from '\.\/shadowPressure(?:Evaluation|Observation)'/)) === JSON.stringify([OBS]));
check('NOT A POLICY CONSUMER: no Constructor, comparator, placement, capacity, replenishment, preview, signing, acceptance, persistence, Recomposition, Move, route, scheduling context, P2 evidence / pressure code or P3 stage mentions a promotion input', NEVER_PROMO.every((f) => !PROMO_IDENT.test(src(f)) && !PROMO_WORD.test(src(f))));
const migrationSql = fs.readdirSync(path.join(root, 'apps/web/prisma/migrations'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => fs.readFileSync(path.join(root, 'apps/web/prisma/migrations', e.name, 'migration.sql'), 'utf8'));
check('NO PERSISTENCE, NO SCHEMA: the Prisma schema and all 43 migration directories mention no promotion input; no migration was added', !/promotionInput/i.test(read('apps/web/prisma/schema.prisma')) && migrationSql.length === 43 && migrationSql.every((s) => !/promotionInput/i.test(s)));
check('NO PUBLIC CONTRACT: the preview request / client / integrity modules, the acceptance modules and every route carry no promotion vocabulary (no preview field, no signed token member, no client-supplied input)', ['apps/web/lib/dayConstructorPreviewRequest.ts', 'apps/web/lib/dayConstructorPreviewClient.ts', 'apps/web/lib/dayConstructorPreviewIntegrity.ts', 'apps/web/lib/dayConstructorAcceptance.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts', 'apps/web/app/api/day-constructor/preview/route.ts', 'apps/web/app/api/day-constructor/accept/route.ts'].every((f) => !/promotion/i.test(src(f))));
check('NO P4b / P5 CONCEPT: no production identifier for a promotion decision, policy, counterfactual, second pass, owner replacement or "would / should win" exists; the Constructor / comparator / placement code is untouched and unread', real.filter((x) => (x.f === LOCAL || x.f === ACCEPTANCE || x.f === SHADOW_POLICY ? P4B_CONCEPT_NO_COUNTERFACTUAL : P4B_CONCEPT).test(x.src)).length === 0 && !/promotion|pressure/i.test(src('apps/web/lib/dayConstructor.ts') + src('apps/web/lib/dayIntent.ts').replace(/\/\/.*$/gm, '')));

console.log('=== the assembler: reviewed typed authorities only, one comparator primitive, pure ===');
check('IMPORTS: exactly four -- the Constructor result type, the P3a trace type, the pressure type, and the shared above-pressure primitive; no database, no evidence, no facts, no context, no P3b stage, no Constructor value', JSON.stringify(importLines(asm)) === JSON.stringify(ASM_IMPORTS));
check('PRESSURE AUTHORITY: it accepts ALREADY-DERIVED pressure (`pressureByIntentId: ReadonlyMap<string, DecisionPressure>`); it never derives pressure and names no DecisionFacts, DecisionEvidence or raw recurrence / opportunity field', /readonly pressureByIntentId: ReadonlyMap<string, DecisionPressure>;/.test(asm) && !/deriveDecisionPressure/.test(asm) && !PRESSURE_CHAIN.test(asm));
check('CONTENTION AUTHORITY: contention and owners come only from the P3a trace events (loser and owner ids); there is no overlap algorithm, no interval, no round, no event count and no Deferred-reason inference', /authority\.contentionTrace\.events/.test(asm) && !/\.attempted\w*|\.winnerStart|\.winnerEnd|\.round\b|contentionEventCount|primaryReason|\.reason\b|intervalsOverlap/.test(asm) && count(/authority\.contentionTrace\./g, asm) === 1);
check('FINAL-STATE AUTHORITY: only which intents are finally Proposed or Deferred is read (`proposedItems` / `deferredItems` intent ids)', count(/authority\.finalDay\.(\w+)/g, asm) === count(/authority\.finalDay\.(proposedItems|deferredItems)/g, asm) && /\.proposedItems\.map\(\(item\) => item\.intentId\)/.test(asm) && /\.deferredItems\.map\(\(item\) => item\.intentId\)/.test(asm));
check('PRECEDENCE: eligibility against an owner is `compareAbovePressure(...) === \'TIE\'` through the ONE shared primitive (exactly one call, no copy of importance / deadline logic, no direction handling), required of EVERY final owner (`.every`)', count(/compareAbovePressure\(/g, asm) === 1 && /=== 'TIE'/.test(asm) && !/A_STRONGER|B_STRONGER|compareByOverloadPrecedence|IMPORTANCE_RANK/.test(asm) && /tiesEveryFinalOwner = finalOwnerIds\.every\(/.test(asm));
check('originalOrder, timing fit, capacity, durations, the Deferred reason, rounds, intervals and counts are NEVER eligibility dimensions: the assembler names none of them (originalOrder is neutralised inside the shared primitive and is therefore not a blocking dimension)', !VALUE_VOCAB.test(asm) && !/\.round\b|\.attempted|contentionEventCount|primaryReason/.test(asm));
check('DOES NOT USE THE P3b AGGREGATE: no import of the shadow stage and no classification enum, `.classification` read or shadow vocabulary -- P3b stays the diagnostic semantic proof and the exhaustive equivalence suite proves the two agree', !P3B_AGGREGATE.test(asm) && !P3B_AGGREGATE.test(prep));
check('GATES: pressure must be exactly LAST_KNOWN_OPPORTUNITY; the candidate must be finally Deferred; duplicate ids (candidate or any historical owner) fail closed; owners are the DISTINCT historical owners of the candidate\'s OWN trace events filtered to final Proposed; at least one must remain; precedence facts must exist for the candidate and every final owner', /!== 'LAST_KNOWN_OPPORTUNITY'\) continue/.test(asm) && /for \(const candidateId of deferredIds\)/.test(asm) && /isAmbiguous\(candidateId\)\) continue/.test(asm) && /historicalOwners\.some\(isAmbiguous\)/.test(asm) && /!owners\.includes\(event\.winnerIntentId\)/.test(asm) && /filter\(\(ownerId\) => proposedSet\.has\(ownerId\)\)/.test(asm) && /finalOwnerIds\.length === 0\) continue/.test(asm) && /ownerFacts !== undefined &&/.test(asm) && /if \(!candidateFacts\) continue;/.test(asm));
check('OWNERS ARE 1..N AND NEVER COLLAPSED OR GLOBALLY DEDUPLICATED: the owner list is built per candidate from its own events; there is no cross-candidate owner set, no `.find` / `[0]` winner selection', !/\.find\(|\[0\]|owners\.slice|\.shift\(\)|\.pop\(\)|\bmax\b|\bmin\b/.test(asm) && /ownersByLoser = new Map<string, string\[\]>\(\)/.test(asm));
check('PURE: no async, await, Promise, timer, database, clock, Date, randomness, environment, console, logging or telemetry', !IO_VOCAB.test(asm));
check('SOURCE-NEUTRAL: no Goal, GoalActivity, manual, automatic, provenance, hand-off, UI, title or activity concept', !SOURCE_VOCAB.test(asm) && !SOURCE_VOCAB.test(prep));
check('NO CONSTRUCTION, NO COUNTERFACTUAL, NO SECOND PASS, NO POLICY: no Constructor / orchestrator call, no schedule built, nothing promoted / replaced / ranked, no score and no "would / should win" vocabulary', !/\bconstructDay\w*\(|orchestrate\w*\(/.test(asm) && !P4B_VOCAB.test(asm));
check('NO SCHEDULING CONTEXT, NO SNAPSHOT, NO DATABASE: the assembler never names the P2d context, a snapshot or a query; it reuses P2d authority only through the already-derived pressure it is handed (P4a opens no transaction and acquires no snapshot)', !CONTEXT_IDENT.test(asm + prep) && !/withRepeatableReadSnapshot|beginTransaction|\.query\(|from '\.\/db'/.test(asm + prep));

console.log('=== the contract: the smallest sufficient immutable record ===');
check('SHAPE: `PromotionInput` has exactly `candidateIntentId: string` and `owners: readonly PromotionOwner[]`; `PromotionOwner` has exactly `intentId: string` and the owner\'s OWN `pressure: DecisionPressure` (categorical) -- no candidate pressure copy, no precedence value, no originalOrder, round, interval, count, reason, title, source or Date', JSON.stringify(Array.from(interfaceBody(asm, 'PromotionInput').matchAll(/readonly (\w+): ([^;]+);/g)).map((m) => [m[1], m[2]])) === JSON.stringify([['candidateIntentId', 'string'], ['owners', 'readonly PromotionOwner[]']]) && JSON.stringify(Array.from(interfaceBody(asm, 'PromotionOwner').matchAll(/readonly (\w+): ([^;]+);/g)).map((m) => [m[1], m[2]])) === JSON.stringify([['intentId', 'string'], ['pressure', 'DecisionPressure']]));
check('NO MUTABLE OUTPUT TYPE: every member is `readonly`; no Map, Set, Date, function, callback, observer or executor appears in either record', !/\b(Map|Set|Date)\b|=>|Function|Promise/.test(interfaceBody(asm, 'PromotionInput') + interfaceBody(asm, 'PromotionOwner')) && count(/readonly \w+:/g, interfaceBody(asm, 'PromotionInput')) === 2);
check('OUTPUT IS DETACHED AND FROZEN: each owner, each owner list, each input and the collection are `Object.freeze`d at creation and built from fresh strings; no input object is returned or referenced', count(/Object\.freeze\(/g, asm) >= 4 && /Object\.freeze\(\{ intentId: ownerId, pressure: ownerPressures\[index\] as DecisionPressure \}\)/.test(asm) && /return Object\.freeze\(inputs\);/.test(asm));
check('the module exports exactly the assembler and the four contract types (PromotionOwner, PromotionInput, PromotionInputAuthority) -- nothing else is reachable', JSON.stringify(Array.from(asm.matchAll(/^export (?:async )?(?:function|interface|type|const|class) (\w+)/gm)).map((m) => m[1])) === JSON.stringify(['PromotionOwner', 'PromotionInput', 'PromotionInputAuthority', 'assemblePromotionInputs']));

console.log('=== the preparation boundary: derive after construction, fail closed, nothing back into construction ===');
check('IT DERIVES PRESSURE IN EXACTLY ONE PLACE, over the immutable evidence handed out by THIS run\'s orchestration, strictly AFTER the Constructor result exists (the only `await` is the orchestration; derivation, projection and assembly follow it)', count(/deriveDecisionPressure\(/g, prep) === 1 && count(/\bawait\b/g, prep) === 1 && prep.indexOf('deriveDecisionPressure(') > prep.indexOf('await orchestrateConstructDayWithDiagnostics(') && prep.indexOf('assemblePromotionInputs(') > prep.indexOf('deriveDecisionPressure('));
check('NO CALLER-INJECTED AUTHORITY (coherence provenance): the boundary\'s signature is exactly `(request, deps)` -- the orchestrator\'s own types; there is no parameter that could carry pressure, a PromotionInput, owner ids or an eligibility flag, and pressure is derived from `diagnostics.evidenceByIntentId` produced by the same run (which, with the production preview binding, was built from the single P2d context)', /export async function preparePromotionInputs\(request: ConstructDayRequest, deps: DayConstructorOrchestratorDeps\)/.test(prep) && /deriveDecisionPressure\(\{ evidence: diagnostics\.evidenceByIntentId\.get\(id\)/.test(prep) && !/pressureByIntentId\s*[:=]\s*(request|deps|input|options)/.test(prep));
check('FAIL CLOSED: the derivation, projection and assembly run inside a try whose catch returns the SAME Constructor result with outcome `UNAVAILABLE / PREPARATION_FAILED` and no inputs; a not-READY run returns `UNAVAILABLE / RUN_NOT_READY`; nothing is logged or rethrown (the single `throw` is the duplicate-id fail-closed guard INSIDE the try, caught by it)', /try \{/.test(prep) && /catch \{\s*return \{ result, promotion: Object\.freeze\(\{ status: 'UNAVAILABLE', reason: 'PREPARATION_FAILED' \}\), run: RUN_PREPARATION_FAILED \};/.test(prep) && /status !== 'READY'\) return \{ result, promotion: Object\.freeze\(\{ status: 'UNAVAILABLE', reason: 'RUN_NOT_READY' \}\), run: RUN_NOT_READY \}/.test(prep) && !/\bconsole\.|\.warn\(|\.error\(/.test(prep) && count(/\bthrow\b/g, prep) === 1 && prep.indexOf('throw new Error') > prep.indexOf('try {') && prep.indexOf('throw new Error') < prep.indexOf('} catch {'));
check('NO NEW QUERY, NO WRITE, NO SNAPSHOT, NO TELEMETRY, NO CLOCK: the boundary imports no database module, opens no transaction, writes nothing, logs nothing and reads no clock (real shadow / promotion incidence therefore remains UNKNOWN)', JSON.stringify(Array.from(read(PREP).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/^import [^\n]*(from '[^']+');$/gm)).map((m) => m[1])) === JSON.stringify(PREP_IMPORTS) && !/\bconsole\.|logger|\.warn\(|\.error\(|telemetry|\bpool\b|\.query\(|INSERT|UPDATE|DELETE|fetch\(|process\.|Date\.now|new Date\(|Math\.random/.test(prep));
check('ONE RUN, NO SECOND CONSTRUCTION: exactly one orchestration call and no direct Constructor / orchestrator call; the returned result is the orchestration\'s own result object, untouched', count(/orchestrateConstructDayWithDiagnostics\(/g, prep) === 1 && !/\bconstructDay\(|constructDayWithTrace\(|orchestrateConstructDay\(|orchestrateConstructDayWithTrace\(/.test(prep) && /const result = diagnostics\.result;/.test(prep) && count(/return \{ result,/g, prep) === 3);
check('the preview boundary is unchanged and still calls `orchestrateConstructDay`, never a diagnostics entry point or a promotion function; the orchestrator names neither pressure nor promotion', /orchestrateConstructDay\b/.test(src('apps/web/lib/dayConstructorPreviewRequest.ts')) && !/WithDiagnostics|promotion/i.test(src('apps/web/lib/dayConstructorPreviewRequest.ts')) && !/promotion|shadow/i.test(src(ORCH)) && !/ressure/.test(src(ORCH)));

console.log('=== MUTATIONS OF THE GUARD: each violation class, injected into the real tree, is detected ===');
const auditM = (f: string, fn: (s: string) => string) => audit(mutateFile(real, f, fn));
check('MUTATION: the assembler trusts the P3b aggregate (imports the shadow evaluator / branches on a classification) -> detected', flags(auditM(ASM, (s) => `import { evaluateShadowPressure } from './shadowPressureEvaluation';\n${s}\nexport const t = (i: never) => evaluateShadowPressure(i).observations.filter((o) => o.classification === 'PRESSURE_ELIGIBLE_AGAINST_ALL_FINAL_OWNERS');`), 'Q2:assembler-uses-p3b-aggregate', ASM) && flags(auditM(ASM, (s) => `${s}\nexport const t = 'PRESSURE_ELIGIBLE_AGAINST_ALL_FINAL_OWNERS';`), 'Q2:assembler-uses-p3b-aggregate', ASM));
check('MUTATION: the assembler accepts NONE / drops the pressure gate -> detected', flags(auditM(ASM, (s) => s.replace("!== 'LAST_KNOWN_OPPORTUNITY') continue", "=== 'x') continue")), 'Q2:pressure-gate-missing', ASM));
check('MUTATION: the assembler stops requiring a final Deferred state / infers contention from the Deferred state instead of the trace -> detected', flags(auditM(ASM, (s) => s.replace('authority.contentionTrace.events', 'authority.finalDay.deferredItems')), 'Q2:contention-or-final-state-authority-missing', ASM) || flags(auditM(ASM, (s) => s.replace('authority.contentionTrace.events', '[]')), 'Q2:contention-or-final-state-authority-missing', ASM));
check('MUTATION: the all-owner rule is weakened to `.some` -> detected; owners collapsed to a single winner -> detected', flags(auditM(ASM, (s) => s.replace('finalOwnerIds.every(', 'finalOwnerIds.some(')), 'Q2:all-owner-rule-missing', ASM) && flags(auditM(ASM, (s) => s.replace('finalOwnerIds.map((ownerId)', 'finalOwnerIds.slice(0, 1).map((ownerId)')), 'Q2:', ASM) && flags(auditM(ASM, (s) => s.replace('finalOwnerIds.map((ownerId)', '[finalOwnerIds[0]].map((ownerId)')), 'Q2:', ASM));
check('MUTATION: a stronger / weaker owner stops blocking (eligibility no longer tie-only) -> detected', flags(auditM(ASM, (s) => s.replace("=== 'TIE'", "!== 'B_STRONGER'")), 'Q2:eligibility-is-not-tie-only', ASM));
check('MUTATION: originalOrder / timingFit / capacity / duration blocks -> detected', ['originalOrder', 'timingFit', 'capacityState', 'durationMinutes'].every((w) => flags(auditM(ASM, (s) => `${s}\nexport const w = (o: { ${w}: number }) => o.${w};`), 'Q2:', ASM)));
check('MUTATION: raw recurrence / opportunity fields, DecisionFacts or DecisionEvidence are read -> detected', flags(auditM(ASM, (s) => `${s}\nexport const r = (o: { opportunity?: { afterStartViableDays: number } }) => o.opportunity?.afterStartViableDays;`), 'Q2:assembler-reads-raw-facts-or-evidence', ASM) && flags(auditM(ASM, (s) => `import type { DecisionFacts } from './decisionFacts';\n${s}`), 'Q2:', ASM) && flags(auditM(ASM, (s) => `import type { DecisionEvidence } from './decisionEvidence';\n${s}`), 'Q2:', ASM));
check('MUTATION: a Goal / manual / automatic source branch -> detected', flags(auditM(ASM, (s) => `${s}\nexport const s = (id: string) => id.startsWith('goal-demand');`), 'Q2:assembler-source-vocabulary', ASM));
check('MUTATION: a database query / second snapshot / clock / async in the assembler or the boundary -> detected', flags(auditM(ASM, (s) => `${s}\nexport const q = async () => pool.query('SELECT 1');`), 'Q2:assembler-io-clock-env-log', ASM) && flags(auditM(PREP, (s) => `import { withRepeatableReadSnapshot } from './db';\n${s}`), 'Q3:', PREP) && flags(auditM(PREP, (s) => `${s}\nexport const c = () => new Date();`), 'Q3:boundary-io-log-db-snapshot-clock', PREP) && flags(auditM(PREP, (s) => `${s}\nexport const l = (i: never) => loadDecisionSchedulingContext(i);`), 'Q3:boundary-names-the-scheduling-context', PREP));
check('MUTATION: the output becomes mutable (no freeze), exposes a Map / Set / Date / callback, or gains a Date field -> detected', flags(auditM(ASM, (s) => s.split('Object.freeze(').join('(')), 'Q2:output-not-frozen', ASM) && flags(auditM(ASM, (s) => s.replace('readonly intentId: string;', 'readonly intentId: string;\n  readonly at: Date;')), 'Q2:', ASM) && flags(auditM(ASM, (s) => s.replace('readonly owners: readonly PromotionOwner[];', 'readonly owners: readonly PromotionOwner[];\n  readonly byId: Map<string, PromotionOwner>;')), 'Q2:', ASM) && flags(auditM(ASM, (s) => s.replace('readonly owners: readonly PromotionOwner[];', 'readonly owners: readonly PromotionOwner[];\n  readonly onDone: () => void;')), 'Q2:', ASM));
check('MUTATION: the owner object is shared with the Constructor / trace (a shared reference instead of a fresh frozen record) -> detected', flags(auditM(ASM, (s) => s.replace('Object.freeze({ intentId: ownerId, pressure: ownerPressures[index] as DecisionPressure })', 'ownerId as unknown as PromotionOwner')), 'Q2:output-not-frozen', ASM));
check('MUTATION: a Date / interval / round / event count / reason is added to the contract or read -> detected', flags(auditM(ASM, (s) => s.replace('readonly intentId: string;', 'readonly intentId: string;\n  readonly round: number;')), 'Q2:output-fields-are-not-exactly-the-minimum', ASM) && flags(auditM(ASM, (s) => `${s}\nexport const e = (x: { round: number }) => x.round;`), 'Q2:assembler-constructs-or-reads-geometry-round-count-reason', ASM));
check('MUTATION: a CANDIDATE pressure copy / precedence value / importance is added to the contract -> detected', flags(auditM(ASM, (s) => s.replace('readonly candidateIntentId: string;', 'readonly candidateIntentId: string;\n  readonly pressure: DecisionPressure;')), 'Q2:output-fields-are-not-exactly-the-minimum', ASM) && flags(auditM(ASM, (s) => s.replace('readonly candidateIntentId: string;', 'readonly candidateIntentId: string;\n  readonly importance: string;')), 'Q2:', ASM));
check('MUTATION: the public preview / signing / acceptance / persistence / route / schema surfaces name a promotion input -> detected', ['apps/web/lib/dayConstructorPreviewRequest.ts', 'apps/web/lib/dayConstructorPreviewIntegrity.ts', 'apps/web/lib/dayConstructorAcceptance.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts', 'apps/web/app/api/day-constructor/preview/route.ts', 'apps/web/app/api/day-constructor/accept/route.ts', 'apps/web/lib/db.ts'].every((f) => flags(auditM(f, (s) => `${s}\nexport const p = 'PromotionInput';`), 'Q4:surface-names-promotion-input', f)));
check('MUTATION: an active comparator / Constructor / placement / capacity / replenishment reads a promotion input -> detected', ['apps/web/lib/dayIntent.ts', 'apps/web/lib/dayConstructor.ts', 'apps/web/lib/dayCapacity.ts', ORCH].every((f) => flags(auditM(f, (s) => `${s}\nconst probe = 'assemblePromotionInputs';`), 'Q4:surface-names-promotion-input', f) || flags(auditM(f, (s) => `${s}\nconst probe = 'assemblePromotionInputs';`), 'Q1:', f)));
const rogue = (f: string, body: string) => audit(addFile(real, f, body));
check('MUTATION: a second construction in the boundary -> detected; a production consumer of the boundary appears -> detected', flags(auditM(PREP, (s) => `${s}\nexport const x = (r: never, d: never) => orchestrateConstructDay(r, d);`), 'Q3:boundary-runs-a-second-construction', PREP) && flags(rogue('apps/web/lib/rogueConsumer.ts', "import { preparePromotionInputs } from './promotionInputPreparation';\nexport const r = preparePromotionInputs;"), 'Q1:production-consumer-of-promotion-boundary', 'apps/web/lib/rogueConsumer.ts') && flags(rogue('apps/web/lib/rogueCaller.ts', "import { assemblePromotionInputs } from './promotionInput';\nexport const r = assemblePromotionInputs;"), 'Q1:imports-the-assembler', 'apps/web/lib/rogueCaller.ts'));
check('MUTATION: the boundary accepts caller-supplied pressure / a PromotionInput, or derives pressure a second time -> detected', flags(auditM(PREP, (s) => s.replace('(request: ConstructDayRequest, deps: DayConstructorOrchestratorDeps)', '(request: ConstructDayRequest, deps: DayConstructorOrchestratorDeps, pressure?: Map<string, DecisionPressure>)')), 'Q3:boundary-accepts-caller-authority', PREP) && flags(auditM(PREP, (s) => `${s}\nexport const d = () => deriveDecisionPressure;`.replace('deriveDecisionPressure;', 'deriveDecisionPressure({} as never);')), 'Q3:boundary-pressure-authority-changed', PREP));
check('MUTATION: the boundary loses fail-closed handling (no catch) or assembles before construction -> detected', flags(auditM(PREP, (s) => s.replace("catch {\n    return { result, promotion: Object.freeze({ status: 'UNAVAILABLE', reason: 'PREPARATION_FAILED' }), run: RUN_PREPARATION_FAILED };", "catch (e) {\n    throw e;")), 'Q3:boundary-not-fail-closed', PREP));
check('MUTATION: the P3b shadow stage starts naming promotion, or P4a imports the shadow stage -> detected', flags(auditM(EVAL, (s) => `${s}\nexport const n = 'promotion';`), 'Q5:shadow-stage-names-promotion', EVAL) && flags(auditM(ASM, (s) => `import { evaluateShadowPressure } from './shadowPressureEvaluation';\n${s}`), 'Q5:imports-shadow-stage', ASM));
check('MUTATION: a P4b / P5 concept (a promotion decision, counterfactual, second pass, owner replacement, "would win") appears anywhere -> detected', flags(rogue('apps/web/lib/rogueP4b.ts', 'export const applyPromotion = () => 1;'), 'Q1:p4b-or-p5-concept', 'apps/web/lib/rogueP4b.ts') && flags(auditM(ASM, (s) => `${s}\nexport const c = 'counterfactual';`), 'Q2:assembler-policy-or-score-vocabulary', ASM));
check('MUTATION: the scheduling context is exposed to / named by the contract -> detected', flags(auditM(ASM, (s) => `${s}\nexport type X = DecisionSchedulingContext;`), 'Q2:assembler-names-the-scheduling-context', ASM));
check('MUTATION (P4a2): the owner pressure is dropped from the owner record / the owner record loses its pressure field -> detected', flags(auditM(ASM, (s) => s.replace('readonly pressure: DecisionPressure;', '')), 'Q2:output-fields-are-not-exactly-the-minimum', ASM) && flags(auditM(ASM, (s) => s.replace('Object.freeze({ intentId: ownerId, pressure: ownerPressures[index] as DecisionPressure })', 'Object.freeze({ intentId: ownerId })')), 'Q2:owners-collapsed-or-selected', ASM));
check('MUTATION (P4a2): the owner pressure is hard-coded, or taken from the CANDIDATE\'s pressure, instead of read per owner from the one authority -> detected', flags(auditM(ASM, (s) => s.replace('pressure: ownerPressures[index] as DecisionPressure', "pressure: 'NONE' as DecisionPressure")), 'Q2:owners-collapsed-or-selected', ASM) && flags(auditM(ASM, (s) => s.replace('const ownerPressures = finalOwnerIds.map((ownerId) => authority.pressureByIntentId.get(ownerId));', 'const ownerPressures = finalOwnerIds.map(() => authority.pressureByIntentId.get(candidateId));')), 'Q2:owner-pressure-not-read-per-owner-from-the-authority', ASM));
check('MUTATION (P4a2): owner pressure is aggregated (a summary field / helper), owners are reordered by pressure, or a pressured owner suppresses the input (an active-policy rule belongs to P4b) -> detected', flags(auditM(ASM, (s) => `${s}\nexport const hasPressuredOwner = (i: { owners: readonly { pressure: string }[] }) => i.owners.some((o) => o.pressure === 'LAST_KNOWN_OPPORTUNITY');`), 'Q2:owner-pressure-aggregated-or-owners-reordered', ASM) && flags(auditM(ASM, (s) => s.replace('finalOwnerIds.map((ownerId, index)', 'finalOwnerIds.sort().map((ownerId, index)')), 'Q2:', ASM) && flags(auditM(ASM, (s) => s.replace("pressure !== 'NONE' && pressure !== 'LAST_KNOWN_OPPORTUNITY'", "pressure !== 'NONE'")), 'Q2:owner-pressure-completeness-gate-changed-or-used-as-a-policy', ASM));
check('MUTATION (P4a2): a missing owner pressure is allowed (the completeness gate removed), or a second pressure read / raw evidence / live read appears -> detected', flags(auditM(ASM, (s) => s.replace("if (ownerPressures.some((pressure) => pressure !== 'NONE' && pressure !== 'LAST_KNOWN_OPPORTUNITY')) continue;", '')), 'Q2:owner-pressure-completeness-gate-changed-or-used-as-a-policy', ASM) && flags(auditM(ASM, (s) => `${s}\nexport const second = (a: PromotionInputAuthority) => a.pressureByIntentId.get('x');`), 'Q2:pressure-read-count-changed', ASM) && flags(auditM(ASM, (s) => `${s}\nexport const q = async () => pool.query('SELECT 1');`), 'Q2:assembler-io-clock-env-log', ASM) && flags(auditM(PREP, (s) => s.replace("if (pressureByIntentId.has(id)) throw new Error('duplicate resolved intent id: one intent cannot carry two pressures');", '')), 'Q3:duplicate-resolved-id-guard-missing-or-outside-the-try', PREP));
check('the mutations were applied to in-memory copies only: the real tree still has zero violations afterwards', audit(real).length === 0);

console.log('=== wiring and honest scope ===');
const workflow = read('.github/workflows/ci.yml').split('\n');
let currentJob = ''; let inJobs = false;
const stepJob = new Map<string, string>();
for (const line of workflow) {
  if (/^jobs:\s*$/.test(line)) { inJobs = true; continue; }
  const job = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
  if (inJobs && job) currentJob = job[1];
  const run = line.match(/^\s+run: npx ts-node (test\/[A-Za-z0-9_]+\.test\.ts)\s*$/);
  if (run && currentJob) stepJob.set(run[1], currentJob);
}
check('both P4a suites (behavior and architecture) run in the required PURE job', stepJob.get('test/promotionInput.test.ts') === 'math-core-tests' && stepJob.get('test/promotionInputArchitecture.test.ts') === 'math-core-tests');
const FLAKY = /\bctid\b|VACUUM|ANALYZE|EXPLAIN\b|Math\.random|setTimeout|setInterval|pg_sleep|Date\.now\(|new Date\(\)|\bsleep\b/;
check('the behavior suite asserts invariants only: no sleeps, timers, randomness, wall-clock reads, heap layout or query-plan mechanics', !FLAKY.test(stripComments(read('test/promotionInput.test.ts'))));
const FALSE_CLAIM = /pressure is (active|enabled)|P4b (is )?ready|ready for P4b|activates? (decision )?pressure|promote(s|d)? the candidate|should (win|be promoted)/i;
check('no assertion label claims pressure is active, that P4b is ready, or that this slice promotes or schedules anything', ['test/promotionInput.test.ts'].every((f) => !(read(f).match(/check\(`?'?[^\n]*/g) ?? []).some((l) => FALSE_CLAIM.test(l))));

if (!allPassed) {
  console.error('SOME PROMOTION INPUT ARCHITECTURE CHECKS FAILED');
  process.exit(1);
}
console.log('ALL PROMOTION INPUT ARCHITECTURE CHECKS PASSED');
