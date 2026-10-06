/**
 * Constructor Decision Intelligence -- O5 P4b3: the PURE COUNTERFACTUAL ACCEPTANCE PREDICATE (architecture guard, pure).
 *
 * P4b2 answers "what mechanically happens?"; P4b3 answers "may Aura prefer that counterfactual over the baseline under the V1 safety policy?" for ONE
 * immutable pair. This guard pins that it:
 *
 *   - is the FIRST and ONLY module that owns the acceptance vocabulary (OWNER_WOULD_BE_UNPLACED, OWNER_TIMING_DEGRADED, FIXED_PLACEMENT_CHANGED,
 *     NON_OWNER_CHANGED, UNNECESSARY_OWNER_CHANGE, PRECEDENCE_NOT_TIE, NET_PROPOSED_LOSS): none of it may leak backward into the generator, the
 *     promotion modules, the trace or any surface
 *   - JUDGES, never produces: type-only import of the generator's output, no generator / Constructor / orchestrator / preparation / projection call,
 *     no timing search, no candidate list, no scheduling attempt, no contention authority, no raw trace -- it cannot regenerate or re-rank
 *   - never reads pressure and never equates `NONE` with "safe": owners are read by id only, there is no pressure branch, helper or SAFE_TO_DEFER notion;
 *     the above-pressure tie is the ESTABLISHED `compareAbovePressure` over `projectAbovePressureFacts` (originalOrder / timing fit / pressure excluded),
 *     the timing floor is the Constructor's own comparator, and there is no value score, utility or "better schedule" requirement
 *   - keeps the policy rules in the pinned deterministic precedence, with every structural (UNAVAILABLE) check BEFORE any policy (REJECT) check, the
 *     unplaced-owner rule unconditional, and ACCEPT reachable only at the very end
 *   - is pure, synchronous and frozen: no database, clock, snapshot, async, logging, environment or mutation; it never throws
 *   - has ZERO production consumers and appears in no preview / signing / acceptance-persistence / route / schema surface (no active, shadow or UI wiring)
 *
 * Every rule is a PURE FUNCTION over source files: it runs on the real tree (zero violations) AND on the tree with a synthetic violation injected.
 * P4b3 does not implement P4b4+, P5, R3 or S5.
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

const ACC = 'apps/web/lib/counterfactualAcceptance.ts';
const GEN = 'apps/web/lib/localCounterfactual.ts';
/** O5 P4b4 -- the inert same-run shadow composition is the ONLY production consumer of the predicate (one call, at most, per READY generation; nothing consumes the composition). */
const SHADOW_POLICY = 'apps/web/lib/shadowPolicyObservation.ts';
/** O5 P4c3 -- the typed accepted-counterfactual authority is the ONLY production CALLER of the predicate (it mints the authority only when the predicate itself returns ACCEPT); the P4b4 composition keeps a TYPE-only import and calls the mint. */
const ACCEPTED_MOD = 'apps/web/lib/acceptedCounterfactual.ts';
const CONSTRUCTOR = 'apps/web/lib/dayConstructor.ts';
const INTENT = 'apps/web/lib/dayIntent.ts';
const CAPACITY = 'apps/web/lib/dayCapacity.ts';
const ORCH = 'apps/web/lib/dayConstructorOrchestrator.ts';
const PREP = 'apps/web/lib/promotionInputPreparation.ts';
const SEARCH = 'packages/recommendation/src/timingSearch.ts';
const VOCAB = /\b(evaluateCounterfactualAcceptance|CounterfactualAcceptance[A-Za-z]*|CounterfactualRejectionReason)\b|counterfactualAcceptance['"]/;
/** The acceptance vocabulary this module OWNS -- it must not exist anywhere else. */
const OWNED_TERMS = /OWNER_WOULD_BE_UNPLACED|OWNER_TIMING_DEGRADED|FIXED_PLACEMENT_CHANGED|NON_OWNER_CHANGED|UNNECESSARY_OWNER_CHANGE|PRECEDENCE_NOT_TIE|NET_PROPOSED_LOSS|BASELINE_TIMING_UNKNOWN|COUNTERFACTUAL_INVALID/;
const ACC_IMPORTS = [
  `import { compareCandidatesForPlacement, type PlacementCandidate, type PlacementTimingFit } from './dayConstructor';`,
  `import { compareAbovePressure, projectAbovePressureFacts } from './abovePressurePrecedence';`,
  `import type { PromotionInput } from './promotionInput';`,
  `import type { ConstructionBasis, ConstructionBasisOutcome } from './constructionBasis';`,
  `import type { BaselinePlacementsOutcome } from './baselinePlacements';`,
  `import type { LocalCounterfactual } from './localCounterfactual';`,
];
const DB_VOCAB = /from '\.\/db'|\bpool\b|\.query\(|beginTransaction|withRepeatableReadSnapshot|prisma|INSERT|UPDATE|DELETE|loadDecisionSchedulingContext|schedulingContext/i;
const CLOCK_VOCAB = /Date\.now|new Date\(\)|performance\.now|hrtime/;
const SEARCH_VOCAB = /searchTiming|runTimingSearch|timingSearch|excludedIntervals|replenish/i;
/** Regeneration: the predicate may never produce, re-rank or re-place anything. */
const EXECUTION_VOCAB = /\bgenerateLocalCounterfactual\b|\bevaluateLocalPlacementGate\b|\bconstructDay\w*\(|orchestrate\w*\(|\bpreparePromotionInputs\b|\bprojectContentionAuthority\b|\bprojectSchedulingAttempts\b|\bnormalizeSchedulingAttempts\b|\bcaptureBaselinePlacements\b|\bassembleConstructionBasis\b|\bsortByOverloadPrecedence\b|\bcompareByOverloadPrecedence\b/;
const ASYNC_VOCAB = /\basync\b|\bawait\b|Promise|setTimeout|setInterval|console\.|logger|telemetry|fetch\(|require\(|process\.|\benv\b|featureFlag|isFeatureEnabled/;
const CLONE_SHORTCUT = /JSON\.(parse|stringify)|structuredClone|Object\.assign|deepFreeze|lodash/;
const RAW_TRACE_VOCAB = /ContentionEvent|ContentionTrace|ContentionAttempt|contentionTrace|from '\.\/contentionTrace'|\.events\b/;
const FACTS_VOCAB = /DecisionFacts|decisionFacts|DecisionEvidence|decisionEvidence|recurrence|opportunity|scarcity|shadowPressure|ShadowPressure/i;
/** Inputs of the generator / authorities this predicate must never need. */
const AUTHORITY_ESCAPE = /schedulingAttempts|SchedulingAttempt|PromotionContention|initialCandidates|finalCandidates|\.contention\b|candidatesByIntentId|fixedConstraints/;
/** NONE must never become "safe": no pressure value, no safe-to-defer notion, no helper that equates them. */
const PRESSURE_VOCAB = /\.pressure\b|DecisionPressure|LAST_KNOWN|\bNONE\b|SAFE_TO_DEFER|safeToDefer|isUnpressured|unpressured|affirmative|isSafe|isSafeToDefer|canDefer|deferrable/i;
/** Value scoring, utility, "better schedule" and global-comparator vocabulary are forbidden. */
const SCORE_VOCAB = /\bscore\b|utility|weight|boost|priorit|urgen|\bbetter\b|\bbest\b|sumFit|originalOrder|importance|deadline|\bgoal\b/i;
const ORDER = ['FIXED_PLACEMENT_CHANGED', 'NON_OWNER_CHANGED', 'UNNECESSARY_OWNER_CHANGE', 'PRECEDENCE_NOT_TIE', 'OWNER_WOULD_BE_UNPLACED', 'OWNER_TIMING_DEGRADED', 'NET_PROPOSED_LOSS'];
const NEVER = [
  CONSTRUCTOR, INTENT, CAPACITY, GEN, PREP, ORCH, 'apps/web/lib/contentionTrace.ts', 'apps/web/lib/constructionBasis.ts', 'apps/web/lib/baselinePlacements.ts', 'apps/web/lib/promotionInput.ts', 'apps/web/lib/promotionContentionAuthority.ts',
  'apps/web/lib/schedulingAttemptAuthority.ts', 'apps/web/lib/abovePressurePrecedence.ts', 'apps/web/lib/decisionPressure.ts', 'apps/web/lib/decisionEvidence.ts', 'apps/web/lib/decisionFacts.ts', 'apps/web/lib/decisionFactPreparation.ts',
  'apps/web/lib/dayConstructorPreviewRequest.ts', 'apps/web/lib/dayConstructorPreviewIntegrity.ts', 'apps/web/lib/dayConstructorPreviewClient.ts', 'apps/web/lib/dayConstructorAcceptance.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts',
  'apps/web/lib/remainingDayRecomposition.ts', 'apps/web/lib/remainingDayRecompositionAcceptance.ts', 'apps/web/lib/remainingDayRecompositionIntegrity.ts', 'apps/web/lib/remainingDayRecompositionServer.ts', 'apps/web/lib/homeRecomposition.ts',
  'apps/web/lib/planMove.ts', 'apps/web/lib/homeMove.ts', 'apps/web/lib/dayPlanPreviewPresentation.ts', 'apps/web/lib/dayPlanAcceptancePresentation.ts', 'apps/web/lib/db.ts', 'apps/web/lib/shadowPressureEvaluation.ts',
  'apps/web/lib/shadowPressureObservation.ts', 'apps/web/lib/decisionSchedulingContext.ts', 'apps/web/lib/decisionSchedulingContextLoader.ts', SEARCH,
  'apps/web/app/api/day-constructor/preview/route.ts', 'apps/web/app/api/day-constructor/accept/route.ts', 'apps/web/app/api/day/recompose/route.ts', 'apps/web/app/api/plans/[planId]/move/route.ts', 'apps/web/app/api/plans/route.ts',
];

function audit(files: SrcFile[]): string[] {
  const v: string[] = [];
  const get = (f: string) => files.find((x) => x.f === f);
  const by = (re: RegExp) => files.filter((x) => re.test(x.src)).map((x) => x.f);
  const notIn = (list: string[], allow: string[]) => list.filter((f) => !allow.includes(f));
  // A1 -- confinement, vocabulary ownership, ZERO consumers
  notIn(by(VOCAB), [ACC, ACCEPTED_MOD, SHADOW_POLICY]).forEach((f) => v.push(`A1:names-the-acceptance-predicate:${f}`));
  by(/from '\.\/counterfactualAcceptance'/).filter((f) => f !== SHADOW_POLICY && f !== ACCEPTED_MOD).forEach((f) => v.push(`A1:production-consumer-of-the-predicate:${f}`));
  by(/\bevaluateCounterfactualAcceptance\(/).filter((f) => f !== ACC && f !== ACCEPTED_MOD).forEach((f) => v.push(`A1:calls-the-predicate:${f}`));
  notIn(by(OWNED_TERMS), [ACC]).forEach((f) => v.push(`A1:acceptance-vocabulary-leaked-backward:${f}`));
  for (const f of NEVER) { const x = get(f); if (x && VOCAB.test(x.src)) v.push(`A1:surface-names-the-predicate:${f}`); }
  // A2 -- the module
  const m = get(ACC);
  if (m) {
    if (JSON.stringify(Array.from(m.src.matchAll(/^import [^\n]*;$/gm)).map((x) => x[0])) !== JSON.stringify(ACC_IMPORTS) || count(/^import (?!type )/gm, m.src) !== 2) v.push(`A2:imports-are-not-the-reviewed-six:${ACC}`);
    if (!/^import type \{ LocalCounterfactual \} from '\.\/localCounterfactual';$/m.test(m.src)) v.push(`A2:generator-output-is-not-a-type-only-import:${ACC}`);
    if (DB_VOCAB.test(m.src)) v.push(`A2:database-or-snapshot:${ACC}`);
    if (CLOCK_VOCAB.test(m.src)) v.push(`A2:clock-read:${ACC}`);
    if (SEARCH_VOCAB.test(m.src)) v.push(`A2:timing-search:${ACC}`);
    if (EXECUTION_VOCAB.test(m.src)) v.push(`A2:regeneration-or-execution:${ACC}`);
    if (ASYNC_VOCAB.test(m.src)) v.push(`A2:async-log-env-or-require:${ACC}`);
    if (CLONE_SHORTCUT.test(m.src)) v.push(`A2:json-structuredclone-or-generic-clone:${ACC}`);
    if (/\bany\b/.test(m.src)) v.push(`A2:any-escape:${ACC}`);
    if (RAW_TRACE_VOCAB.test(m.src)) v.push(`A2:raw-trace:${ACC}`);
    if (FACTS_VOCAB.test(m.src)) v.push(`A2:facts-evidence-or-shadow-vocabulary:${ACC}`);
    if (AUTHORITY_ESCAPE.test(m.src)) v.push(`A2:needs-historical-authority-it-must-not-have:${ACC}`);
    if (PRESSURE_VOCAB.test(m.src)) v.push(`A2:pressure-read-or-none-as-safe:${ACC}`);
    if (SCORE_VOCAB.test(m.src)) v.push(`A2:scoring-original-order-or-value-vocabulary:${ACC}`);
    if (/^(let|var) |^const \w+ = (new |\[|\{)/m.test(m.src)) v.push(`A2:module-level-state:${ACC}`);
    if (/\.sort\(|\.reverse\(|\.toSorted\(|\.splice\(|\.push\(/.test(m.src.replace(/baseline\.push\(\{ id: p\.intentId[^\n]*\n/, ''))) v.push(`A2:reordering-or-mutation:${ACC}`);
    if (count(/baseline\.push\(/g, m.src) !== 1) v.push(`A2:unexpected-mutation:${ACC}`);
    // owners are read by id only
    if (!/const ownerIds = input\.promotionInput\.owners\.map\(\(owner\) => owner\.intentId\);/.test(m.src) || count(/\.owners\b/g, m.src) !== 1) v.push(`A2:owners-are-not-only-the-promotion-input-ids:${ACC}`);
    // the established tie primitive and the Constructor's own timing ranking -- nothing else
    if (count(/compareAbovePressure\(/g, m.src) !== 1 || count(/projectAbovePressureFacts\(/g, m.src) !== 2) v.push(`A2:above-pressure-tie-is-not-the-established-primitive:${ACC}`);
    if (!/if \(displacedRows\.some\(\(row\) => compareAbovePressure\(candidateFacts, projectAbovePressureFacts\(intentOf\(row\.id\)!\), basis\.planningDate\) !== 'TIE'\)\) return reject\('PRECEDENCE_NOT_TIE'\);/.test(m.src) || !/const candidateFacts = projectAbovePressureFacts\(candidate\);/.test(m.src)) v.push(`A2:tie-is-not-required-for-every-displaced-owner-in-both-directions:${ACC}`);
    if (count(/compareCandidatesForPlacement\(/g, m.src) !== 1 || !/return compareCandidatesForPlacement\(shell\(baseline\), shell\(relocated\)\) < 0;/.test(m.src)) v.push(`A2:timing-floor-is-not-the-constructor-ranking:${ACC}`);
    if (!/function shell\(timingFit|const shell = \(timingFit: PlacementTimingFit \| undefined\): PlacementCandidate => \(\{ intentId: 'x', start: new Date\(0\), end: new Date\(1\), timingFit, candidateOrder: 0 \}\);/.test(m.src) || count(/new Date\(/g, m.src) !== 2) v.push(`A2:timing-floor-candidate-shell-changed:${ACC}`);
    // the V1 POLICY, in the pinned precedence
    const body = (m.src.match(/export function evaluateCounterfactualAcceptance\([\s\S]*?\n\}\n/) ?? [''])[0];
    const rules = ORDER.map((r) => body.indexOf(`return reject('${r}')`));
    if (rules.some((i) => i < 0) || rules.some((i, k) => k > 0 && i <= rules[k - 1])) v.push(`A2:reason-precedence-changed:${ACC}`);
    if (count(/return reject\(/g, body) !== 7) v.push(`A2:reject-sites-changed:${ACC}`);
    if (!/if \(displacedRows\.some\(\(row\) => row\.fixed\)\) return reject\('FIXED_PLACEMENT_CHANGED'\);/.test(body) || !/if \(displacedRows\.some\(\(row\) => !ownerIds\.includes\(row\.id\)\)\) return reject\('NON_OWNER_CHANGED'\);/.test(body)) v.push(`A2:fixed-or-scope-rule-changed:${ACC}`);
    if (!/if \(displacedRows\.some\(\(row\) => !overlapsMs\(row\.start, row\.end, promoted\.start\.getTime\(\), promoted\.end\.getTime\(\)\)\)\) return reject\('UNNECESSARY_OWNER_CHANGE'\);/.test(body)) v.push(`A2:minimum-change-rule-changed:${ACC}`);
    if (!/    if \(unplacedIds\.length > 0\) return reject\('OWNER_WOULD_BE_UNPLACED'\);/.test(body)) v.push(`A2:owner-loss-rule-is-not-unconditional:${ACC}`);
    if (!/if \(cf\.relocatedPlacements\.some\(\(r\) => isWorseFit\(baseline\.find\(\(row\) => row\.id === r\.intentId\)!\.fit, r\.timingFit\)\)\) return reject\('OWNER_TIMING_DEGRADED'\);/.test(body)) v.push(`A2:timing-floor-rule-changed:${ACC}`);
    if (!/if \(rows\.length < baseline\.length \+ 1\) return reject\('NET_PROPOSED_LOSS'\);/.test(body)) v.push(`A2:net-count-backstop-changed:${ACC}`);
    // structure before policy; ACCEPT only at the very end
    const firstReject = body.indexOf('return reject(');
    const lastStructural = Math.max(...Array.from(body.matchAll(/return unavailable\('(?!EVALUATION_FAILED)/g)).map((x) => x.index ?? -1));
    if (!(lastStructural >= 0 && firstReject > lastStructural)) v.push(`A2:policy-before-structure:${ACC}`);
    if (count(/status: 'ACCEPT'/g, body) !== 1 || body.indexOf("status: 'ACCEPT'") < body.lastIndexOf('return reject(')) v.push(`A2:accept-is-not-only-at-the-end:${ACC}`);
    // fail-closed structure
    if (!/input\.constructionBasis\.status !== 'READY' \|\| input\.baselinePlacements\.status !== 'READY'\) return unavailable\('RUN_NOT_READY'\)/.test(body) || !/if \(cf\.candidateIntentId !== candidateId\) return unavailable\('INCONSISTENT_AUTHORITY'\);/.test(body)) v.push(`A2:readiness-or-pair-check-missing:${ACC}`);
    if (!/if \(displaced\.length === 0\) return unavailable\('COUNTERFACTUAL_INVALID'\);/.test(body) || !/if \(rowIds\.some\(\(id\) => id !== candidateId && !baseline\.some\(\(row\) => row\.id === id\)\)\) return unavailable\('COUNTERFACTUAL_INVALID'\);/.test(body)) v.push(`A2:structural-contradiction-checks-missing:${ACC}`);
    if (!/if \(!row \|\| row\.placementSource !== 'BASELINE_UNCHANGED' \|\| row\.start\.getTime\(\) !== base\.start \|\| row\.end\.getTime\(\) !== base\.end \|\| row\.timingFit !== base\.fit\) return unavailable\('COUNTERFACTUAL_INVALID'\);/.test(body)) v.push(`A2:silent-change-check-missing:${ACC}`);
    if (!/return !base\.fixed && base\.fit === undefined;/.test(body) || !/return unavailable\('BASELINE_TIMING_UNKNOWN'\)/.test(body)) v.push(`A2:unknown-baseline-fit-is-not-unavailable:${ACC}`);
    if (!/function overlapsMs\(aStart: number, aEnd: number, bStart: number, bEnd: number\): boolean \{\s*return aStart < bEnd && bStart < aEnd;\s*\}/.test(m.src)) v.push(`A2:overlap-is-not-half-open:${ACC}`);
    if (!/blockers = basis\.blockedIntervals\.map\([^\n]*\)\.filter\(\(blocker\) => blocker\.start < blocker\.end\);/.test(body)) v.push(`A2:non-positive-blockers-not-ignored:${ACC}`);
    if (!/export function evaluateCounterfactualAcceptance\(input: CounterfactualAcceptanceInput\): CounterfactualAcceptance \{\s*try \{[\s\S]*\} catch \{\s*return unavailable\('EVALUATION_FAILED'\);\s*\}\s*\}/.test(m.src)) v.push(`A2:evaluation-can-throw-or-has-a-different-signature:${ACC}`);
    // output: frozen, strings only
    if (!/function unavailable\([^)]*\): CounterfactualAcceptance \{\s*return Object\.freeze\(\{ status: 'UNAVAILABLE', reason \}\);\s*\}/.test(m.src) || !/function reject\([^)]*\): CounterfactualAcceptance \{\s*return Object\.freeze\(\{ status: 'REJECT', reason \}\);\s*\}/.test(m.src) || !/return Object\.freeze\(\{ status: 'ACCEPT' \}\);/.test(m.src)) v.push(`A2:decision-is-not-frozen:${ACC}`);
    if (/\b(?:input|cf|basis)\.[A-Za-z.]+\s*=[^=]/.test(m.src) || /\bdelete \b|Object\.defineProperty/.test(m.src)) v.push(`A2:mutates-an-input:${ACC}`);
    // CONTRACT
    const exportsList = Array.from(m.src.matchAll(/^export (?:async )?(?:function|interface|type|const|class) (\w+)/gm)).map((x) => x[1]);
    if (JSON.stringify(exportsList) !== JSON.stringify(['CounterfactualAcceptanceInput', 'CounterfactualRejectionReason', 'CounterfactualAcceptanceUnavailableReason', 'CounterfactualAcceptance', 'evaluateCounterfactualAcceptance'])) v.push(`A2:exports-changed:${ACC}`);
    const inputFields = Array.from(((m.src.match(/export interface CounterfactualAcceptanceInput \{[\s\S]*?\n\}/) ?? [''])[0]).matchAll(/readonly (\w+)\??:/g)).map((x) => x[1]);
    if (JSON.stringify(inputFields) !== JSON.stringify(['constructionBasis', 'baselinePlacements', 'promotionInput', 'counterfactual'])) v.push(`A2:input-contract-is-not-basis-baseline-promotion-counterfactual:${ACC}`);
    const rejections = (m.src.match(/export type CounterfactualRejectionReason =([\s\S]*?);\n/) ?? ['', ''])[1].replace(/[\s|]/g, '');
    if (rejections !== ORDER.map((r) => `'${r}'`).join('')) v.push(`A2:rejection-reasons-changed:${ACC}`);
    const unavailables = (m.src.match(/export type CounterfactualAcceptanceUnavailableReason = ([^;]+);/) ?? ['', ''])[1].replace(/[\s|]/g, '');
    if (unavailables !== "'RUN_NOT_READY''INCONSISTENT_AUTHORITY''INVALID_INTERVAL''COUNTERFACTUAL_INVALID''BASELINE_TIMING_UNKNOWN''EVALUATION_FAILED'") v.push(`A2:unavailable-reasons-changed:${ACC}`);
    const outcome = (m.src.match(/export type CounterfactualAcceptance =[\s\S]*?;\n/) ?? [''])[0];
    if (!/status: 'ACCEPT' \}/.test(outcome) || !/status: 'REJECT'; readonly reason: CounterfactualRejectionReason/.test(outcome) || !/status: 'UNAVAILABLE'; readonly reason: CounterfactualAcceptanceUnavailableReason/.test(outcome)) v.push(`A2:decision-contract-changed:${ACC}`);
  }
  // A3 -- the P4b2 generator and the Constructor are untouched by (and never call) the predicate
  const g = get(GEN);
  if (g && /counterfactualAcceptance|evaluateCounterfactualAcceptance/.test(g.src)) v.push(`A3:generator-names-the-predicate:${GEN}`);
  const c = get(CONSTRUCTOR);
  if (c && JSON.stringify(Array.from(c.src.matchAll(/^export function (\w+)/gm)).map((x) => x[1])) !== JSON.stringify(['compareCandidatesForPlacement', 'constructDay', 'constructDayWithTrace'])) v.push(`A3:constructor-exports-changed:${CONSTRUCTOR}`);
  return v;
}
const real = productionFiles();
const src = (f: string) => real.find((x) => x.f === f)!.src;
const mutateFile = (files: SrcFile[], f: string, fn: (s: string) => string): SrcFile[] => files.map((x) => (x.f === f ? { f, src: fn(x.src) } : x));
const addFile = (files: SrcFile[], f: string, s: string): SrcFile[] => [...files, { f, src: s }];
const flags = (violations: string[], prefix: string, file?: string) => violations.some((x) => x.startsWith(prefix) && (file === undefined || x.endsWith(`:${file}`)));
const names = (re: RegExp) => real.filter((x) => re.test(x.src)).map((x) => x.f);
const auditM = (f: string, fn: (s: string) => string) => audit(mutateFile(real, f, fn));
const rep = (from: string, to: string) => (s: string) => { if (!s.includes(from)) throw new Error(`mutation target missing: ${from.slice(0, 70)}`); return s.replace(from, to); };

console.log('=== the real tree conforms ===');
const baseline = audit(real);
check(`THE REAL PRODUCTION TREE HAS ZERO ACCEPTANCE-PREDICATE ARCHITECTURE VIOLATIONS (${real.length} production files scanned)${baseline.length ? ': ' + baseline.join(', ') : ''}`, baseline.length === 0);

console.log('=== ownership, zero consumers, untouched scheduling code ===');
check('NO ACTIVE CONSUMERS: the predicate vocabulary exists in exactly THREE production files (itself, the O5 P4c3 typed accepted-counterfactual authority -- its only VALUE importer and CALLER -- and the inert O5 P4b4 same-run shadow composition, which imports only its TYPES); nothing else imports or calls it, and nothing consumes the composition -- no active, UI, API or persistence wiring', JSON.stringify(names(VOCAB)) === JSON.stringify([ACC, ACCEPTED_MOD, SHADOW_POLICY].sort()) && JSON.stringify(names(/from '\.\/counterfactualAcceptance'/)) === JSON.stringify([ACCEPTED_MOD, SHADOW_POLICY].sort()) && JSON.stringify(names(/\bevaluateCounterfactualAcceptance\(/)) === JSON.stringify([ACC, ACCEPTED_MOD].sort()) && !/^import (?!type )[^\n]*from '\.\/counterfactualAcceptance'/m.test(src(SHADOW_POLICY)));
check('VOCABULARY OWNERSHIP: P4b3 is the FIRST and ONLY module that owns OWNER_WOULD_BE_UNPLACED, OWNER_TIMING_DEGRADED, FIXED_PLACEMENT_CHANGED, NON_OWNER_CHANGED, UNNECESSARY_OWNER_CHANGE, PRECEDENCE_NOT_TIE, NET_PROPOSED_LOSS and its unavailable reasons; none leaked backward into the generator, the promotion modules, the trace, P3 or any surface', JSON.stringify(names(OWNED_TERMS)) === JSON.stringify([ACC]));
check('NOT PUBLIC / SIGNED / PERSISTED / ACCEPTED: no preview, signing, acceptance, persistence, Recomposition, Move, presentation, route, scheduling-context, trace, basis, placements, input, contention, attempts, generator, preparation or orchestration module names the predicate', NEVER.every((f) => !VOCAB.test(src(f))));
const migrationSql = fs.readdirSync(path.join(root, 'apps/web/prisma/migrations'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => fs.readFileSync(path.join(root, 'apps/web/prisma/migrations', e.name, 'migration.sql'), 'utf8'));
check('NO PERSISTENCE, NO SCHEMA: the Prisma schema and all 43 migration directories mention no counterfactual acceptance; no migration was added', !/counterfactualAcceptance|CounterfactualAcceptance/.test(read('apps/web/prisma/schema.prisma')) && migrationSql.length === 43 && migrationSql.every((s) => !/CounterfactualAcceptance/.test(s)));
check('THE GENERATOR AND THE CONSTRUCTOR ARE UNTOUCHED: the generator never names the predicate and dayConstructor.ts still exports exactly the comparator, `constructDay` and `constructDayWithTrace`', !flags(audit(real), 'A3:'));
const dateGuard = read('test/schedulingDateMutatorArchitecture.test.ts');
check('#208 SCOPE: the predicate (which READS Dates and emits none) is on the protected Date-mutator list with zero exceptions; the regex-literal scanner debt is carried unchanged', dateGuard.includes(`file: '${ACC}'`) && /ZERO EXCEPTIONS in the protected modules/.test(dateGuard));
const ci = read('.github/workflows/ci.yml');
check('REQUIRED CI: the behavior and architecture suites are mandatory steps in the pure job', ['counterfactualAcceptance.test.ts', 'counterfactualAcceptanceArchitecture.test.ts'].every((t) => ci.includes(`npx ts-node test/${t}`)));

console.log('=== the predicate JUDGES; it cannot regenerate, re-rank, search or read pressure ===');
const mod = src(ACC);
check('IMPORTS: exactly six -- the Constructor\'s timing comparator and the established above-pressure tie primitive as values, the PromotionInput / basis / baseline / LocalCounterfactual contracts as TYPES (the generator is imported as a TYPE only)', JSON.stringify(Array.from(mod.matchAll(/^import [^\n]*;$/gm)).map((x) => x[0])) === JSON.stringify(ACC_IMPORTS) && count(/^import (?!type )/gm, mod) === 2 && !flags(audit(real), 'A2:generator-output'));
check('NO REGENERATION: no generator, Constructor, orchestrator, preparation, projection or precedence-comparator call; no timing search; no candidate list, scheduling attempt, contention authority or raw trace -- it judges P4b2\'s OUTPUT, never the historical search evidence', !EXECUTION_VOCAB.test(mod) && !SEARCH_VOCAB.test(mod) && !AUTHORITY_ESCAPE.test(mod) && !RAW_TRACE_VOCAB.test(mod));
check('NO DATABASE, SNAPSHOT, CLOCK, ASYNC, LOGGING, ENVIRONMENT, FLAG, GENERIC CLONE, `any` or facts / evidence', !DB_VOCAB.test(mod) && !CLOCK_VOCAB.test(mod) && !ASYNC_VOCAB.test(mod) && !CLONE_SHORTCUT.test(mod) && !/\bany\b/.test(mod) && !FACTS_VOCAB.test(mod));
check('NONE IS NEVER "SAFE": the module reads no pressure value, names no DecisionPressure / NONE / LAST_KNOWN / SAFE_TO_DEFER / isUnpressured notion, and reads owners by id only -- the unplaced-owner rule is unconditional, so no renaming of NONE can license an owner loss', !PRESSURE_VOCAB.test(mod) && !flags(audit(real), 'A2:owners-are-not-only') && !flags(audit(real), 'A2:owner-loss-rule'));
check('NO VALUE, NO GLOBAL COMPARATOR: no score, utility, weight, "better schedule", importance / deadline / originalOrder read or goal term; the tie is the ESTABLISHED `compareAbovePressure` over `projectAbovePressureFacts` required for EVERY displaced owner, and the timing floor is the Constructor\'s own comparator', !SCORE_VOCAB.test(mod) && !flags(audit(real), 'A2:above-pressure') && !flags(audit(real), 'A2:tie-is-not') && !flags(audit(real), 'A2:timing-floor'));
check('THE V1 POLICY AND ITS PRECEDENCE ARE PINNED: seven reject sites in the order FIXED, NON_OWNER, UNNECESSARY_OWNER_CHANGE, PRECEDENCE, UNPLACED, TIMING, COUNT; every structural (UNAVAILABLE) check precedes every policy (REJECT) check; ACCEPT only at the very end; unknown baseline fit and silent changes are UNAVAILABLE', !flags(audit(real), 'A2:reason-precedence') && !flags(audit(real), 'A2:reject-sites') && !flags(audit(real), 'A2:fixed-or-scope') && !flags(audit(real), 'A2:minimum-change') && !flags(audit(real), 'A2:net-count') && !flags(audit(real), 'A2:policy-before-structure') && !flags(audit(real), 'A2:accept-is-not-only') && !flags(audit(real), 'A2:silent-change') && !flags(audit(real), 'A2:unknown-baseline-fit') && !flags(audit(real), 'A2:structural-contradiction') && !flags(audit(real), 'A2:readiness-or-pair'));
check('PURE, IMMUTABLE, NEVER THROWS: no mutation, reordering or module state; every decision is a frozen record of strings; `evaluateCounterfactualAcceptance` is wrapped (EVALUATION_FAILED); half-open overlap and non-positive blockers match the Constructor', !flags(audit(real), 'A2:reordering') && !flags(audit(real), 'A2:unexpected-mutation') && !flags(audit(real), 'A2:mutates-an-input') && !flags(audit(real), 'A2:module-level-state') && !flags(audit(real), 'A2:decision-is-not-frozen') && !flags(audit(real), 'A2:evaluation-can-throw') && !flags(audit(real), 'A2:overlap') && !flags(audit(real), 'A2:non-positive-blockers'));
check('CONTRACT: input is exactly { constructionBasis, baselinePlacements, promotionInput, counterfactual }; the decision is ACCEPT | REJECT { reason } | UNAVAILABLE { reason }; the seven rejection and six unavailable reasons are exactly the reviewed ones; exports are the five reviewed names', !flags(audit(real), 'A2:exports-changed') && !flags(audit(real), 'A2:input-contract') && !flags(audit(real), 'A2:rejection-reasons') && !flags(audit(real), 'A2:unavailable-reasons') && !flags(audit(real), 'A2:decision-contract'));

console.log('=== MUTATIONS: each violation, injected into an in-memory copy, is detected ===');
check('MUTATION: NONE is renamed into "safe to drop" (a pressure read, an `isUnpressured` / SAFE_TO_DEFER helper, an owner loss conditional on NONE) -> detected', flags(auditM(ACC, rep("    if (unplacedIds.length > 0) return reject('OWNER_WOULD_BE_UNPLACED');", "    if (unplacedIds.length > 0 && input.promotionInput.owners.some((o) => o.pressure !== 'NONE')) return reject('OWNER_WOULD_BE_UNPLACED');")), 'A2:', ACC) && flags(auditM(ACC, (s) => `${s}\nconst isUnpressured = (p: string) => p === 'NONE';`), 'A2:pressure-read-or-none-as-safe', ACC) && flags(auditM(ACC, (s) => `${s}\nexport const SAFE_TO_DEFER = true;`), 'A2:pressure-read-or-none-as-safe', ACC));
check('MUTATION: the unplaced-owner rule is removed or made conditional; the net COUNT replaces owner safety -> detected', flags(auditM(ACC, rep("    if (unplacedIds.length > 0) return reject('OWNER_WOULD_BE_UNPLACED');\n", '')), 'A2:', ACC) && flags(auditM(ACC, rep("    if (unplacedIds.length > 0) return reject('OWNER_WOULD_BE_UNPLACED');", "    if (unplacedIds.length > 99) return reject('OWNER_WOULD_BE_UNPLACED');")), 'A2:owner-loss-rule-is-not-unconditional', ACC));
check('MUTATION: a WORSE timing fit is allowed (the floor removed, reversed or ranked by a local table) -> detected', flags(auditM(ACC, rep("    if (cf.relocatedPlacements.some((r) => isWorseFit(baseline.find((row) => row.id === r.intentId)!.fit, r.timingFit))) return reject('OWNER_TIMING_DEGRADED');\n", '')), 'A2:', ACC) && flags(auditM(ACC, rep('compareCandidatesForPlacement(shell(baseline), shell(relocated)) < 0', 'compareCandidatesForPlacement(shell(baseline), shell(relocated)) > 0')), 'A2:timing-floor-is-not-the-constructor-ranking', ACC) && flags(auditM(ACC, (s) => `${s}\nconst RANK = { BEST: 0, GOOD: 1 };`), 'A2:module-level-state', ACC));
check('MUTATION: originalOrder / importance / deadline enters the tie, the global comparator is used, pressure becomes a precedence dimension, the tie is required for only ONE direction or ONE owner -> detected', flags(auditM(ACC, (s) => `${s}\nexport const o = (a: { originalOrder: number }, b: { originalOrder: number }) => a.originalOrder === b.originalOrder;`), 'A2:scoring-original-order-or-value-vocabulary', ACC) && flags(auditM(ACC, (s) => `import { compareByOverloadPrecedence } from './dayIntent';\n${s}`), 'A2:', ACC) && flags(auditM(ACC, rep("!== 'TIE'", "=== 'B_STRONGER'")), 'A2:tie-is-not-required', ACC) && flags(auditM(ACC, rep('displacedRows.some((row) => compareAbovePressure(', 'displacedRows.slice(0, 1).some((row) => compareAbovePressure(')), 'A2:tie-is-not-required', ACC) && flags(auditM(ACC, (s) => `${s}\nexport const p = (x: { pressure: string }) => x.pressure;`), 'A2:pressure-read-or-none-as-safe', ACC));
check('MUTATION: a NON-OWNER may be moved, a FIXED placement may change, an undisturbed authorized owner may be moved -> detected', flags(auditM(ACC, rep("    if (displacedRows.some((row) => row.fixed)) return reject('FIXED_PLACEMENT_CHANGED');\n", '')), 'A2:', ACC) && flags(auditM(ACC, rep("    if (displacedRows.some((row) => !ownerIds.includes(row.id))) return reject('NON_OWNER_CHANGED');\n", '')), 'A2:', ACC) && flags(auditM(ACC, rep("return reject('UNNECESSARY_OWNER_CHANGE');", "return reject('NON_OWNER_CHANGED');")), 'A2:', ACC));
check('MUTATION: REGENERATION (a call or import of the generator, the Constructor, a timing search, a candidate list, a contention authority) -> detected', flags(auditM(ACC, (s) => `import { generateLocalCounterfactual } from './localCounterfactual';\n${s}`), 'A2:', ACC) && flags(auditM(ACC, (s) => `${s}\nexport const g = () => generateLocalCounterfactual({} as never);`), 'A2:regeneration-or-execution', ACC) && flags(auditM(ACC, (s) => `${s}\nexport const c = () => constructDay({} as never);`), 'A2:regeneration-or-execution', ACC) && flags(auditM(ACC, (s) => `${s}\nexport const x = () => searchTiming();`), 'A2:timing-search', ACC) && flags(auditM(ACC, (s) => `${s}\nexport const l = (b: { initialCandidates: unknown }) => b.initialCandidates;`), 'A2:needs-historical-authority', ACC));
check('MUTATION: a database query, a clock read, async, logging, an environment / flag read -> detected', flags(auditM(ACC, (s) => `${s}\nexport const q = () => pool.query('SELECT 1');`), 'A2:database', ACC) && flags(auditM(ACC, (s) => `${s}\nexport const t = () => Date.now();`), 'A2:clock-read', ACC) && flags(auditM(ACC, (s) => `${s}\nexport const a = async () => 1;`), 'A2:async', ACC) && flags(auditM(ACC, (s) => `${s}\nexport const e = process.env.X;`), 'A2:async-log-env', ACC));
check('MUTATION: an input is MUTATED, a decision is UNFROZEN, the reasons are re-ordered, a second ACCEPT site appears -> detected', flags(auditM(ACC, (s) => `${s}\nexport const m = (cf: { candidateIntentId: string }) => { cf.candidateIntentId = 'x'; };`), 'A2:mutates-an-input', ACC) && flags(auditM(ACC, rep("return Object.freeze({ status: 'REJECT', reason });", "return { status: 'REJECT', reason };")), 'A2:decision-is-not-frozen', ACC) && flags(auditM(ACC, (s) => s.replace("return reject('OWNER_WOULD_BE_UNPLACED');", "return reject('OWNER_TIMING_DEGRADED');").replace("return reject('OWNER_TIMING_DEGRADED');\n    if (rows.length", "return reject('OWNER_WOULD_BE_UNPLACED');\n    if (rows.length")), 'A2:', ACC) && flags(auditM(ACC, rep("    if (rows.length < baseline.length + 1) return reject('NET_PROPOSED_LOSS');\n    return Object.freeze({ status: 'ACCEPT' });", "    if (rows.length < baseline.length + 1) return reject('NET_PROPOSED_LOSS');\n    return Object.freeze({ status: 'ACCEPT' });\n    return Object.freeze({ status: 'ACCEPT' });")), 'A2:accept-is-not-only-at-the-end', ACC));
check('MUTATION: a policy check runs BEFORE the structural checks, a silent change / unknown baseline fit stops being UNAVAILABLE -> detected', flags(auditM(ACC, rep("    const ownerIds = input.promotionInput.owners.map((owner) => owner.intentId);\n", "    const ownerIds = input.promotionInput.owners.map((owner) => owner.intentId);\n    if (input.counterfactual.unplacedOwnerIds.length > 0) return reject('OWNER_WOULD_BE_UNPLACED');\n")), 'A2:policy-before-structure', ACC) && flags(auditM(ACC, rep("row.timingFit !== base.fit) return unavailable('COUNTERFACTUAL_INVALID');", "row.timingFit !== base.fit) return reject('NON_OWNER_CHANGED');")), 'A2:', ACC) && flags(auditM(ACC, rep("return unavailable('BASELINE_TIMING_UNKNOWN')", "return reject('OWNER_TIMING_DEGRADED')")), 'A2:', ACC));
check('MUTATION: acceptance vocabulary leaks backward (the generator, the promotion modules or the trace name a reason), or a production consumer / public wiring appears -> detected', flags(auditM(GEN, (s) => `${s}\nexport const r = 'OWNER_WOULD_BE_UNPLACED';`), 'A1:acceptance-vocabulary-leaked-backward', GEN) && flags(auditM('apps/web/lib/promotionInput.ts', (s) => `${s}\nexport const r = 'NON_OWNER_CHANGED';`), 'A1:acceptance-vocabulary-leaked-backward', 'apps/web/lib/promotionInput.ts') && ['apps/web/lib/dayConstructorPreviewRequest.ts', 'apps/web/lib/dayConstructorPreviewIntegrity.ts', 'apps/web/lib/dayConstructorAcceptance.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts', 'apps/web/app/api/day-constructor/preview/route.ts', 'apps/web/app/api/day-constructor/accept/route.ts', 'apps/web/lib/db.ts', GEN, PREP, ORCH, CONSTRUCTOR].every((f) => flags(auditM(f, (s) => `${s}\nexport const p = 'CounterfactualAcceptance';`), 'A1:', f)) && flags(audit(addFile(real, 'apps/web/lib/rogueConsumer.ts', "import { evaluateCounterfactualAcceptance } from './counterfactualAcceptance';\nexport const e = evaluateCounterfactualAcceptance;")), 'A1:production-consumer-of-the-predicate', 'apps/web/lib/rogueConsumer.ts'));
check('MUTATION: the contract changes (an extra input authority, an extra decision field, a new rejection reason such as OWNER_PRESSURED) -> detected', flags(auditM(ACC, rep('readonly counterfactual: LocalCounterfactual;', 'readonly counterfactual: LocalCounterfactual;\n  readonly contention: unknown;')), 'A2:input-contract', ACC) && flags(auditM(ACC, rep("  | 'NET_PROPOSED_LOSS';", "  | 'NET_PROPOSED_LOSS'\n  | 'OWNER_PRESSURED';")), 'A2:rejection-reasons-changed', ACC) && flags(auditM(ACC, rep("{ readonly status: 'REJECT'; readonly reason: CounterfactualRejectionReason }", "{ readonly status: 'REJECT'; readonly reason: CounterfactualRejectionReason; readonly score: number }")), 'A2:', ACC));
check('the mutations were applied to in-memory copies only: the real tree still has zero violations afterwards', audit(productionFiles()).length === 0);

if (!allPassed) {
  console.error('SOME ACCEPTANCE PREDICATE ARCHITECTURE CHECKS FAILED');
  process.exit(1);
}
console.log('ALL ACCEPTANCE PREDICATE ARCHITECTURE CHECKS PASSED');
