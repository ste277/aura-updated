/**
 * O5 SHADOW EVIDENCE OBSERVABILITY -- architecture guard (pure source inspection, real tree + in-memory mutations).
 *
 * The SHADOW boundary may now also report what the REAL P4c1 selector, P4c2a gate, P4c3 materializer and an invariant verifier WOULD have done on the very same run.
 * This guard pins that this is observability only:
 *
 *   - ACTIVE is absent: the mode is exactly 'OFF' | 'SHADOW'; no ACTIVE word exists in the boundary, the evidence modules or the metrics
 *   - SHADOW returns the BASELINE in every outcome: `return observed.result;` is the only success return, the evidence never reaches a return value, and the
 *     materialized result never leaves `deriveShadowEvidence` (it is a local value handed ONLY to the invariant check)
 *   - OFF does no evidence work: the OFF return is the first statement and precedes every evidence reference
 *   - the evidence derivation is the real pieces in order (selector -> gate on APPLY -> materializer on MATERIALIZABLE -> invariants on READY), each isolated in
 *     its own try / catch, a single pass (no loop, no async), over the SAME baseline result and the SAME authority the run's own selector returned
 *   - there is no second Constructor / search / Decision Facts query / mint / generation / acceptance predicate / preparation anywhere in the evidence modules
 *   - the funnel counts are numbers only, taken from the pressure map and the trace the SAME preparation already derived
 *   - no database, clock, randomness, environment, logging, persistence or telemetry store in the pure evidence modules; no raw / private field in any evidence output
 *   - confinement: the evidence derivation is imported only by the boundary, the invariant verifier only by the derivation
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

const EXEC = 'apps/web/lib/shadowPolicyExecution.ts';
const EVID = 'apps/web/lib/shadowEvidence.ts';
const INV = 'apps/web/lib/materializationInvariants.ts';
const PREP = 'apps/web/lib/promotionInputPreparation.ts';
const COMPOSE = 'apps/web/lib/shadowPolicyObservation.ts';
const CI = '.github/workflows/ci.yml';

const DB_VOCAB = /from '\.\/db'|\bpool\b|\.query\(|beginTransaction|prisma|INSERT|UPDATE|DELETE|productEvents|createProductEvent|loadDecisionSchedulingContext|loadBlockingPlans|loadDurationContext|loadAvailabilityConfiguration|prepareDecisionFacts|writeFile|appendFile|localStorage|\bfs\b/i;
const SECOND_RUN_VOCAB = /\bpreparePromotionInputs\b|\borchestrateConstructDay\w*|\bconstructDay\w*\(|\bobserveShadowPolicy\b|\bgenerateLocalCounterfactual\b|\bevaluateCounterfactualAcceptance\b|\bmintAcceptedCounterfactual\b|\brecordAcceptedObservation\b|\bsignPreviewResultBody\b|\bsearchTiming\b|runTimingSearch|excludedIntervals|\bderiveDecisionPressure\b|DecisionFacts|\bcompareCandidatesForPlacement\b/;
const IMPURE_VOCAB = /Date\.now|new Date\(|performance\.|hrtime|Math\.random|crypto|process\.|\benv\b|console\.|logger|telemetry|setTimeout|setInterval|\bawait\b|\basync\b|Promise|fetch\(|require\(/;
const PRIVATE_VOCAB = /userId|\buser\b|email|birth|\btitle\b|goalId|activityId|planId|occurrenceId|\bnotes?\b|latitude|longitude|timezone|\.start\b|\.end\b|placements?\b|attempts?\b|blocker|toISOString|getTime/i;
const ACTIVE_WORD = /\bACTIVE\b/;

function audit(files: SrcFile[]): string[] {
  const v: string[] = [];
  const get = (f: string) => files.find((x) => x.f === f);
  const by = (re: RegExp) => files.filter((x) => re.test(x.src)).map((x) => x.f);
  const exportsOf = (s: string) => Array.from(s.matchAll(/^export (?:async )?(?:function|interface|type|const|class) (\w+)/gm)).map((x) => x[1]);

  // V1 -- confinement
  by(/from '\.\/shadowEvidence'/).filter((f) => f !== EXEC).forEach((f) => v.push(`V1:another-importer-of-the-evidence-derivation:${f}`));
  by(/from '\.\/materializationInvariants'/).filter((f) => f !== EVID).forEach((f) => v.push(`V1:another-importer-of-the-invariant-check:${f}`));
  by(/\bderiveShadowEvidence\b/).filter((f) => f !== EXEC && f !== EVID).forEach((f) => v.push(`V1:another-caller-of-the-evidence-derivation:${f}`));
  by(/\bcheckMaterializationInvariants\b/).filter((f) => f !== EVID && f !== INV).forEach((f) => v.push(`V1:another-caller-of-the-invariant-check:${f}`));

  // V2 -- ACTIVE is absent
  for (const f of [EXEC, EVID, INV, PREP, COMPOSE]) { const x = get(f); if (x && ACTIVE_WORD.test(x.src)) v.push(`V2:active-word:${f}`); }
  { const x = get(EXEC); if (x && !/export type ShadowPolicyMode = 'OFF' \| 'SHADOW';/.test(x.src)) v.push(`V2:mode-type-is-not-exactly-off-or-shadow:${EXEC}`); if (x && !/return typeof raw === 'string' && raw\.trim\(\) === 'SHADOW' \? 'SHADOW' : 'OFF';/.test(x.src)) v.push(`V2:mode-parse-is-not-fail-closed:${EXEC}`); }

  // V3 -- the evidence derivation: the real pieces, in order, single pass, isolated, over the SAME baseline and authority
  const e = get(EVID);
  if (e) {
    const s = e.src;
    if (JSON.stringify(exportsOf(s)) !== JSON.stringify(['ShadowCountBucket', 'bucketOfCount', 'ShadowSelectorOutcome', 'ShadowGateOutcome', 'ShadowMaterializerOutcome', 'ShadowInvariantOutcome', 'ShadowEvidenceFailure', 'ShadowEvidence', 'NOT_EVALUATED_EVIDENCE', 'ShadowEvidenceDeps', 'deriveShadowEvidence'])) v.push(`V3:exports-changed:${EVID}`);
    if (JSON.stringify(Array.from(s.matchAll(/^import [^\n]*;$/gm)).map((x) => x[0])) !== JSON.stringify([
      `import { selectActiveCounterfactual } from './activeSelector';`,
      `import { evaluateMaterializability, type MaterializabilityUnavailableReason } from './activeMaterializability';`,
      `import { materializeActiveResult, type MaterializerUnavailableReason } from './activeResultMaterializer';`,
      `import { checkMaterializationInvariants, type MaterializationInvariantFailure } from './materializationInvariants';`,
      `import type { OrchestrateConstructDayResult } from './dayConstructorOrchestrator';`,
      `import type { ShadowPolicyRun } from './shadowPolicyObservation';`,
    ])) v.push(`V3:imports-are-not-the-reviewed-six:${EVID}`);
    if (count(/\bselectActiveCounterfactual\(/g, s) !== 1 || count(/\bevaluateMaterializability\(/g, s) !== 1 || count(/\bmaterializeActiveResult\b/g, s) !== 4 || count(/\bcheckMaterializationInvariants\(/g, s) !== 1) v.push(`V3:not-exactly-one-pass-of-each-real-piece:${EVID}`);
    if (/\b(for|while|do)\b\s*[({]|\.map\(|\.forEach\(|\.filter\(|\.reduce\(|\.sort\(|\.some\(|\.every\(/.test(s)) v.push(`V3:loop-or-iteration-in-the-derivation:${EVID}`);
    if (!/selection = selectActiveCounterfactual\(run\);/.test(s) || !/if \(selection\.status !== 'APPLY'\) return frozen\(\{ \.\.\.NOT_EVALUATED_EVIDENCE, selector: selection\.reason \}\);/.test(s)) v.push(`V3:selector-is-not-the-real-selector-over-the-runs-own-observations:${EVID}`);
    if (!/gate = evaluateMaterializability\(baselineResult\.preview\.constructedDay, selection\.candidateIntentId\);/.test(s) || !/if \(gate\.status !== 'MATERIALIZABLE'\) return frozen\(\{ \.\.\.applied, gate: gate\.reason \}\);/.test(s)) v.push(`V3:gate-is-not-the-real-gate-on-apply-only:${EVID}`);
    if (!/\(deps\.materialize \?\? materializeActiveResult\)\(\{ baselineResult, constructionBasis: selection\.acceptedCounterfactual\.constructionBasis, accepted: selection\.acceptedCounterfactual \}\)/.test(s) || !/if \(materialized\.status !== 'READY'\) return frozen\(\{ \.\.\.gated, materializer: materialized\.reason \}\);/.test(s)) v.push(`V3:materializer-is-not-the-real-materializer-over-the-same-run-authority:${EVID}`);
    if (!/invariant: checkMaterializationInvariants\(baselineResult, materialized\.result, selection\.acceptedCounterfactual\)/.test(s) || count(/materialized\.result/g, s) !== 1) v.push(`V3:the-materialized-result-escapes-or-the-invariants-are-not-checked-against-the-same-baseline:${EVID}`);
    if (count(/\btry \{/g, s) !== 4 || count(/\} catch \{/g, s) !== 4) v.push(`V3:stages-are-not-each-isolated:${EVID}`);
    if (!/failure: 'SELECTOR_FAILED'/.test(s) || !/failure: 'GATE_FAILED'/.test(s) || !/failure: 'MATERIALIZER_FAILED'/.test(s) || !/failure: 'INVARIANT_CHECK_FAILED'/.test(s)) v.push(`V3:a-stage-failure-has-no-bounded-category:${EVID}`);
    if (!/if \(run\.status !== 'READY'\) return NOT_EVALUATED_EVIDENCE;/.test(s)) v.push(`V3:ineligible-run-is-not-not-evaluated:${EVID}`);
    // output: a closed five-field record of categories; never a result, identifier or payload
    const iface = (s.match(/export interface ShadowEvidence \{[\s\S]*?\n\}/) ?? [''])[0];
    if (JSON.stringify(Array.from(iface.matchAll(/readonly (\w+):/g)).map((x) => x[1])) !== JSON.stringify(['selector', 'gate', 'materializer', 'invariant', 'failure'])) v.push(`V3:evidence-schema-changed:${EVID}`);
    if (PRIVATE_VOCAB.test(s) || /intentId|IntentId/.test(s.replace(/selection\.candidateIntentId/g, ''))) v.push(`V3:private-or-high-cardinality-vocabulary:${EVID}`);
    if (SECOND_RUN_VOCAB.test(s.replace(/\bselectActiveCounterfactual\b/g, ''))) v.push(`V3:second-run-vocabulary:${EVID}`);
    if (DB_VOCAB.test(s) || IMPURE_VOCAB.test(s)) v.push(`V3:impure:${EVID}`);
    if (/\breturn\s+\(?materialized\b|\bmaterialized as\b/.test(s)) v.push(`V3:the-materialized-result-is-returned:${EVID}`);
  }

  // V4 -- the invariant verifier: pure, provenance first, bounded categories, a verifier and not a policy
  const i = get(INV);
  if (i) {
    const s = i.src;
    if (JSON.stringify(exportsOf(s)) !== JSON.stringify(['MaterializationInvariantFailure', 'MaterializationInvariantOutcome', 'checkMaterializationInvariants'])) v.push(`V4:exports-changed:${INV}`);
    if (JSON.stringify(Array.from(s.matchAll(/^import [^\n]*;$/gm)).map((x) => x[0])) !== JSON.stringify([
      `import { isBaselineOfAcceptedCounterfactual, type AcceptedCounterfactual } from './acceptedCounterfactual';`,
      `import type { OrchestrateConstructDayResult } from './dayConstructorOrchestrator';`,
      `import type { ProposedItem } from './dayConstructor';`,
    ])) v.push(`V4:imports-are-not-the-reviewed-three:${INV}`);
    if (!/try \{\n    if \(!isBaselineOfAcceptedCounterfactual\(accepted, baselineResult\)\) return 'BASELINE_PROVENANCE_INVALID';/.test(s)) v.push(`V4:provenance-is-not-checked-first:${INV}`);
    for (const c of ['BASELINE_PROVENANCE_INVALID', 'PROPOSED_COUNT_REDUCED', 'OWNER_MISSING', 'FIXED_ITEM_MOVED', 'UNRELATED_ITEM_MOVED', 'UNAUTHORIZED_DISPLACEMENT', 'CHECK_FAILED']) if (count(new RegExp(`'${c}'`, 'g'), s) < 2) v.push(`V4:category-missing:${c}:${INV}`);
    if (!/return 'PASS';\n  \} catch \{\n    return 'CHECK_FAILED';\n  \}/.test(s)) v.push(`V4:a-failure-could-pass:${INV}`);
    if (count(/return 'PASS'/g, s) !== 1) v.push(`V4:more-than-one-pass-path:${INV}`);
    if (DB_VOCAB.test(s) || IMPURE_VOCAB.test(s) || SECOND_RUN_VOCAB.test(s) || /\.sort\(|\.splice\(|\.push\(|\.pop\(|\.reverse\(|\bdelete\b|Object\.assign/.test(s)) v.push(`V4:impure-or-mutating:${INV}`);
    if (/\b(pressure|importance|deadline|timingFit|score|rank|priority|urgen)/i.test(s)) v.push(`V4:policy-vocabulary:${INV}`);
  }

  // V5 -- the boundary: OFF first and untouched, SHADOW returns the baseline, evidence only after the baseline exists, isolated, bounded
  const m = get(EXEC);
  if (m) {
    const s = m.src;
    const fn = (s.match(/export async function orchestrateConstructDayWithShadowPolicy[\s\S]*?\n\}\n/) ?? [''])[0];
    if (!/^export async function orchestrateConstructDayWithShadowPolicy\([^\n]*\n  if \(!execution \|\| execution\.mode !== 'SHADOW'\) return orchestrateConstructDay\(request, deps\);\n/.test(fn)) v.push(`V5:off-is-not-the-first-statement:${EXEC}`);
    const afterOff = fn.slice(fn.indexOf("return orchestrateConstructDay(request, deps);"));
    if (/deriveEvidence|deriveShadowEvidence|evidenceFor|evidenceDeps/.test(fn.slice(0, fn.indexOf("return orchestrateConstructDay(request, deps);")))) v.push(`V5:evidence-before-the-off-return:${EXEC}`);
    if (count(/\breturn observed\.result;/g, afterOff) !== 1 || count(/\breturn\b/g, afterOff) !== 3) v.push(`V5:shadow-return-is-not-the-baseline-only:${EXEC}`);
    if (/observed\.shadowPolicy[^\n]*\breturn\b|\breturn\b[^\n]*(evidence|shadowPolicy|materializ)/i.test(afterOff.replace(/return held\.result;/, ''))) v.push(`V5:evidence-escapes-into-a-return:${EXEC}`);
    if (count(/\bderiveShadowEvidence\b/g, s) !== 3 || count(/\bevidenceFor\(/g, s) !== 2) v.push(`V5:evidence-call-sites-changed:${EXEC}`);
    if (!/function evidenceFor\([^)]*\): ShadowEvidence \{\n  try \{\n    return \(execution\.deriveEvidence \?\? deriveShadowEvidence\)\(baseline, run, execution\.evidenceDeps\);\n  \} catch \{\n    return Object\.freeze\(\{ \.\.\.NOT_EVALUATED_EVIDENCE, failure: 'EVIDENCE_FAILED' \}\);\n  \}\n\}/.test(s)) v.push(`V5:evidence-is-not-isolated:${EXEC}`);
    if (!/const evidence = evidenceFor\(execution, baseline, run\);/.test(s) || count(/\bemitRun\(/g, s) !== 2) v.push(`V5:evidence-is-not-derived-only-in-the-shadow-emit-path:${EXEC}`);
    if (!/baselineAt = startTimer\(execution\);/.test(s) || !/const latency: ShadowPolicyLatencyBucket = started === undefined \? 'UNKNOWN' : elapsedBucket\(execution, started\);[^\n]*\n    const evidence = evidenceFor/.test(s)) v.push(`V5:existing-latency-is-not-measured-before-the-evidence-work:${EXEC}`);
    if (/\bawait\b/.test(s.replace(/observed = await observe\(/, '')) ) v.push(`V5:second-await-or-background-work:${EXEC}`);
    if (DB_VOCAB.test(s) || /\bwriteFile|appendFile|localStorage|\bfs\b/.test(s)) v.push(`V5:telemetry-persistence:${EXEC}`);
    if (ACTIVE_WORD.test(s)) v.push(`V5:active-word:${EXEC}`);
    // the metrics: closed categories / count buckets only
    const iface = (s.match(/export interface ShadowPolicyMetrics \{[\s\S]*?\n\}/) ?? [''])[0];
    if (!/readonly pressured: ShadowCountBucket;/.test(iface) || !/readonly pressuredContested: ShadowCountBucket;/.test(iface) || !/readonly evidence: ShadowEvidence;/.test(iface) || !/readonly shadowOverheadLatency: ShadowPolicyLatencyBucket;/.test(iface)) v.push(`V5:metrics-fields-are-not-the-reviewed-evidence-fields:${EXEC}`);
    if (/: (string|number\[\]|unknown|any|object|Date|Record<string, (?!number))\b/.test(iface.replace(/Readonly<Partial<Record<[^;]*;/g, ''))) v.push(`V5:an-open-valued-metric-field:${EXEC}`);
  }

  // V6 -- the funnel counts: numbers only, from the SAME preparation's pressure map and trace; one orchestration
  const p = get(PREP);
  if (p) {
    const s = p.src;
    const iface = (s.match(/export interface PromotionFunnelCounts \{[\s\S]*?\n\}/) ?? [''])[0];
    if (JSON.stringify(Array.from(iface.matchAll(/readonly (\w+): (\w+);/g)).map((x) => `${x[1]}:${x[2]}`)) !== JSON.stringify(['pressuredIntents:number', 'pressuredContendedIntents:number']) || count(/readonly/g, iface) !== 2) v.push(`V6:funnel-is-not-two-counts:${PREP}`);
    if (!/const pressured = \[\.\.\.pressureByIntentId\]\.filter\(\(\[, pressure\]\) => pressure === 'LAST_KNOWN_OPPORTUNITY'\)\.map\(\(\[id\]\) => id\);/.test(s) || !/const losers = new Set\(diagnostics\.contentionTrace\.events\.map\(\(event\) => event\.loserIntentId\)\);/.test(s) || !/pressuredIntents: pressured\.length, pressuredContendedIntents: pressured\.filter\(\(id\) => losers\.has\(id\)\)\.length/.test(s)) v.push(`V6:funnel-is-not-counted-from-the-same-pressure-map-and-trace:${PREP}`);
    if (count(/orchestrateConstructDayWithDiagnostics\(/g, s) !== 1) v.push(`V6:second-orchestration:${PREP}`);
    if (!/funnel \}\);/.test(s)) v.push(`V6:funnel-is-not-in-the-run:${PREP}`);
  }
  const c = get(COMPOSE);
  if (c && (!/funnel: run\.funnel \}\);/.test(c.src) || count(/\bfunnel\b/g, c.src) < 2)) v.push(`V6:composition-does-not-carry-the-funnel:${COMPOSE}`);

  // V7 -- CI runs the suites
  const ci = files.find((x) => x.f === CI);
  if (ci && (!/test\/shadowEvidence\.test\.ts/.test(ci.src) || !/test\/shadowEvidenceArchitecture\.test\.ts/.test(ci.src))) v.push(`V7:ci-does-not-run-the-evidence-suites:${CI}`);
  return v;
}
const real = [...productionFiles(), { f: CI, src: read(CI) }];
const mutateFile = (files: SrcFile[], f: string, fn: (s: string) => string): SrcFile[] => files.map((x) => (x.f === f ? { f, src: fn(x.src) } : x));
const addFile = (files: SrcFile[], f: string, s: string): SrcFile[] => [...files, { f, src: s }];
const flags = (violations: string[], prefix: string, file?: string) => violations.some((x) => x.startsWith(prefix) && (file === undefined || x.endsWith(`:${file}`)));
const auditM = (f: string, fn: (s: string) => string) => audit(mutateFile(real, f, fn));
const rep = (from: string, to: string) => (s: string) => {
  const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\n/g, '[ \\t]*\n'));
  if (!re.test(s)) throw new Error(`mutation target missing: ${from.slice(0, 80)}`);
  return s.replace(re, () => to);
};
const names = (re: RegExp) => real.filter((x) => re.test(x.src)).map((x) => x.f);

console.log('=== the real tree conforms ===');
const base = audit(real);
check(`THE REAL PRODUCTION TREE HAS ZERO SHADOW-EVIDENCE ARCHITECTURE VIOLATIONS (${real.length} files scanned)${base.length ? ': ' + base.join(', ') : ''}`, base.length === 0);

console.log('=== the rules ===');
check('CONFINEMENT: the evidence derivation is imported only by the boundary and called only there; the invariant check is imported and called only by the derivation', JSON.stringify(names(/from '\.\/shadowEvidence'/)) === JSON.stringify([EXEC]) && JSON.stringify(names(/from '\.\/materializationInvariants'/)) === JSON.stringify([EVID]) && JSON.stringify(names(/\bcheckMaterializationInvariants\b/)) === JSON.stringify([EVID, INV].sort()));
check('ACTIVE IS ABSENT: the mode is exactly OFF | SHADOW (fail-closed parse), no ACTIVE word in the boundary, the evidence modules, the preparation boundary or the composition', !flags(base, 'V2:'));
check('SHADOW RETURNS THE BASELINE: the only success return is `observed.result`, the evidence is never part of a return value, and the materialized result never leaves `deriveShadowEvidence` (it reaches only the invariant check)', !flags(base, 'V5:shadow-return') && !flags(base, 'V5:evidence-escapes') && !flags(base, 'V3:the-materialized-result'));
check('OFF DOES NO EVIDENCE WORK: the OFF return is the first statement and no evidence reference precedes it', !flags(base, 'V5:off-is-not') && !flags(base, 'V5:evidence-before-the-off-return'));
check('THE REAL PIECES, IN ORDER, ONE PASS: the real selector over the run\'s own observations, the real gate on APPLY, the real materializer on MATERIALIZABLE with the same baseline and the authority\'s own basis, the invariant check on READY; no loop, no async, each stage isolated with a bounded failure category', !flags(base, 'V3:selector') && !flags(base, 'V3:gate') && !flags(base, 'V3:materializer') && !flags(base, 'V3:not-exactly') && !flags(base, 'V3:loop') && !flags(base, 'V3:stages') && !flags(base, 'V3:a-stage'));
check('NO SECOND CONSTRUCTOR / SEARCH / QUERY / MINT / GENERATION / PREDICATE / PREPARATION / SIGNING, no database, clock, randomness, environment, logging or persistence in the evidence modules or the boundary', !flags(base, 'V3:second-run') && !flags(base, 'V3:impure') && !flags(base, 'V4:impure') && !flags(base, 'V5:telemetry-persistence') && !flags(base, 'V5:second-await'));
check('NO PRIVATE OR HIGH-CARDINALITY FIELD: the evidence is a closed five-field record of categories; the metrics add only count buckets, that record and a latency bucket; no open-valued metric field', !flags(base, 'V3:evidence-schema') && !flags(base, 'V3:private') && !flags(base, 'V5:metrics-fields') && !flags(base, 'V5:an-open-valued'));
check('THE INVARIANT CHECK IS A VERIFIER: provenance first, the bounded categories, PASS only at the end of the full try, any failure of the check itself is CHECK_FAILED (never a pass), no policy vocabulary', !flags(base, 'V4:'));
check('THE FUNNEL IS COUNTS FROM THE SAME RUN: two numbers taken from the pressure map and the trace the same preparation derived (one orchestration), carried through the composition unchanged', !flags(base, 'V6:'));
check('EVIDENCE IS DERIVED AFTER THE EXISTING LATENCY IS READ and only on the SHADOW emit path, isolated (a failure is EVIDENCE_FAILED and the baseline is still returned)', !flags(base, 'V5:existing-latency') && !flags(base, 'V5:evidence-is-not'));
check('CI RUNS BOTH EVIDENCE SUITES', !flags(base, 'V7:'));

console.log('=== mutations (in-memory; the real tree is untouched) ===');
const hitEvid = (re: string, to: string, prefix: string) => flags(auditM(EVID, rep(re, to)), prefix, EVID);
check('MUTATION: SHADOW STOPS RETURNING THE BASELINE (the evidence, or a substituted result, is returned instead) -> detected', flags(auditM(EXEC, rep('  return observed.result;', '  return evidenceFor(execution, observed.result, observed.shadowPolicy) as never;')), 'V5:', EXEC) && flags(auditM(EXEC, rep('  return observed.result;', "  return ({ status: 'APPLIED' } as never);")), 'V5:', EXEC) && flags(auditM(EXEC, rep('  return observed.result;', '  return observed.shadowPolicy as never;')), 'V5:', EXEC));
check('MUTATION: the materialized result is returned from the derivation -> detected', hitEvid('  return frozen({ ...built, invariant:', '  return materialized as never; return frozen({ ...built, invariant:', 'V3:'));
check('MUTATION: SKIP THE SELECTOR (selector forced to APPLY) -> detected', hitEvid("if (selection.status !== 'APPLY') return frozen({ ...NOT_EVALUATED_EVIDENCE, selector: selection.reason });", "if (false as boolean) return frozen({ ...NOT_EVALUATED_EVIDENCE, selector: 'APPLY' });", 'V3:selector'));
check('MUTATION: COLLAPSE MULTIPLE_ACCEPTS INTO APPLY (the selector reason is overwritten) -> detected', hitEvid("selector: selection.reason", "selector: 'APPLY'", 'V3:selector'));
check('MUTATION: SKIP THE GATE (materializer reached without the real gate) -> detected', hitEvid("gate = evaluateMaterializability(baselineResult.preview.constructedDay, selection.candidateIntentId);", "gate = { status: 'MATERIALIZABLE' } as never;", 'V3:'));
check('MUTATION: SKIP THE MATERIALIZER PROVENANCE CHECK (a baseline other than the run\'s own is handed to the materializer) -> detected', hitEvid("(deps.materialize ?? materializeActiveResult)({ baselineResult, constructionBasis", "(deps.materialize ?? materializeActiveResult)({ baselineResult: {} as never, constructionBasis", 'V3:materializer'));
check('MUTATION: SKIP THE INVARIANT VERIFIER\'S PROVENANCE CHECK -> detected', flags(auditM(INV, rep("if (!isBaselineOfAcceptedCounterfactual(accepted, baselineResult)) return 'BASELINE_PROVENANCE_INVALID';", "")), 'V4:', INV));
check('MUTATION: SUPPRESS AN INVARIANT FAILURE (the check is replaced by PASS) -> detected', hitEvid("invariant: checkMaterializationInvariants(baselineResult, materialized.result, selection.acceptedCounterfactual)", "invariant: 'PASS'", 'V3:'));
check('MUTATION: AN INVARIANT FAILURE BECOMES A PASS (the catch of the check) -> detected', flags(auditM(INV, rep("  } catch {\n    return 'CHECK_FAILED';", "  } catch {\n    return 'PASS';")), 'V4:', INV));
check('MUTATION: A SECOND PASS OF A REAL PIECE / a loop over observations -> detected', hitEvid("  const applied =", "  for (const o of []) { selectActiveCounterfactual(run); }\n  const applied =", 'V3:') && hitEvid("  const applied =", "  selectActiveCounterfactual(run);\n  const applied =", 'V3:'));
check('MUTATION: EVIDENCE IN OFF (the derivation is reached before the OFF return) -> detected', flags(auditM(EXEC, rep("  if (!execution || execution.mode !== 'SHADOW') return orchestrateConstructDay(request, deps);", "  if (execution) evidenceFor(execution, undefined as never, undefined as never);\n  if (!execution || execution.mode !== 'SHADOW') return orchestrateConstructDay(request, deps);")), 'V5:', EXEC));
check('MUTATION: A RAW / PRIVATE FIELD LEAKS INTO THE EVIDENCE OR THE METRICS (an intent id, a title) -> detected', hitEvid("  readonly failure: ShadowEvidenceFailure;\n}", "  readonly failure: ShadowEvidenceFailure;\n  readonly candidateIntentId: string;\n}", 'V3:') && flags(auditM(EXEC, rep("  readonly shadowOverheadLatency: ShadowPolicyLatencyBucket;\n}", "  readonly shadowOverheadLatency: ShadowPolicyLatencyBucket;\n  readonly title: string;\n}")), 'V5:', EXEC) && flags(auditM(EXEC, rep("  readonly shadowOverheadLatency: ShadowPolicyLatencyBucket;\n}", "  readonly shadowOverheadLatency: ShadowPolicyLatencyBucket;\n  readonly candidates: unknown;\n}")), 'V5:', EXEC));
check('MUTATION: ACTIVE appears (mode type, env parse, a metrics word, the evidence modules) -> detected', flags(auditM(EXEC, rep("export type ShadowPolicyMode = 'OFF' | 'SHADOW';", "export type ShadowPolicyMode = 'OFF' | 'SHADOW' | 'ACTIVE';")), 'V2:', EXEC) && flags(auditM(EVID, (s) => `${s}\nexport const x = 'ACTIVE';`), 'V2:', EVID) && flags(auditM(INV, (s) => `${s}\nexport const x = 'ACTIVE';`), 'V2:', INV));
check('MUTATION: A SECOND CONSTRUCTOR / SEARCH / MINT / GENERATION / DATABASE / CLOCK / LOG / PERSISTENCE in the evidence modules or the boundary -> detected', hitEvid("  return Object.freeze(evidence);", "  void orchestrateConstructDay({} as never, {} as never);\n  return Object.freeze(evidence);", 'V3:second-run') && hitEvid("  return Object.freeze(evidence);", "  void searchTiming({});\n  return Object.freeze(evidence);", 'V3:second-run') && hitEvid("  return Object.freeze(evidence);", "  void generateLocalCounterfactual({});\n  return Object.freeze(evidence);", 'V3:second-run') && hitEvid("  return Object.freeze(evidence);", "  void new Date();\n  return Object.freeze(evidence);", 'V3:impure') && hitEvid("  return Object.freeze(evidence);", "  console.log('x');\n  return Object.freeze(evidence);", 'V3:impure') && flags(auditM(EXEC, (s) => `${s}\nconst w = () => pool.query('INSERT INTO "ShadowEvidence" VALUES (1)');`), 'V5:telemetry-persistence', EXEC) && flags(auditM(INV, (s) => `${s}\nconst q = () => prisma.plan.create({});`), 'V4:impure', INV));
check('MUTATION: ANOTHER MODULE CALLS THE EVIDENCE DERIVATION OR THE INVARIANT CHECK / imports them -> detected', flags(audit(addFile(real, 'apps/web/lib/rogueEvidence.ts', "import { deriveShadowEvidence } from './shadowEvidence';\nexport const e = deriveShadowEvidence;")), 'V1:another-importer-of-the-evidence-derivation', 'apps/web/lib/rogueEvidence.ts') && flags(audit(addFile(real, 'apps/web/lib/rogueInvariants.ts', "import { checkMaterializationInvariants } from './materializationInvariants';\nexport const e = checkMaterializationInvariants;")), 'V1:another-importer-of-the-invariant-check', 'apps/web/lib/rogueInvariants.ts'));
check('MUTATION: THE FUNNEL STOPS BEING COUNTS FROM THE SAME RUN (an id list, a second orchestration, the trace dropped) -> detected', flags(auditM(PREP, rep("  readonly pressuredContendedIntents: number;\n}", "  readonly pressuredContendedIntents: number;\n  readonly ids: readonly string[];\n}")), 'V6:', PREP) && flags(auditM(PREP, rep("const losers = new Set(diagnostics.contentionTrace.events.map((event) => event.loserIntentId));", "const losers = new Set<string>();")), 'V6:', PREP) && flags(auditM(PREP, (s) => `${s}\nconst again = () => orchestrateConstructDayWithDiagnostics({} as never, {} as never);`), 'V6:second-orchestration', PREP));
check('MUTATION: THE EVIDENCE IS NOT ISOLATED / not measured after the existing latency / an extra await -> detected', flags(auditM(EXEC, rep("  } catch {\n    return Object.freeze({ ...NOT_EVALUATED_EVIDENCE, failure: 'EVIDENCE_FAILED' });\n  }", "  } finally {\n    // none\n  }")), 'V5:evidence-is-not-isolated', EXEC) && flags(auditM(EXEC, rep("const evidence = evidenceFor(execution, baseline, run);", "const evidence = evidenceFor(execution, baseline, run);\n    await Promise.resolve(evidence);")), 'V5:second-await', EXEC));
check('MUTATION: CI STOPS RUNNING THE EVIDENCE SUITES -> detected', flags(auditM(CI, (s) => s.replace(/test\/shadowEvidenceArchitecture\.test\.ts/g, 'test/other.test.ts')), 'V7:', CI));
check('the mutations were applied to in-memory copies only: the real tree still has zero violations afterwards', audit(real).length === 0);

if (!allPassed) { console.error('SOME SHADOW EVIDENCE ARCHITECTURE CHECKS FAILED'); process.exit(1); }
console.log('ALL SHADOW EVIDENCE ARCHITECTURE CHECKS PASSED');
