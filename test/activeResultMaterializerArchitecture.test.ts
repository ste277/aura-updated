/**
 * Constructor Decision Intelligence -- O5 P4c3: the PURE ACTIVE RESULT MATERIALIZER (architecture guard, pure).
 *
 * Four inert modules: the typed same-run accepted-counterfactual authority, the V1 selector, the materializability gate and the active result materializer.
 * This guard pins that they:
 *
 *   - are CONFINED: the only production importers are the P4b4 composition (the authority's mint and link), the selector (the authority's reader), and the
 *     materializer (the authority's trust check and the gate); no route, preview, orchestrator, signing, acceptance, persistence, UI or schema surface names them
 *   - cannot be FORGED: the brand is a non-exported unique symbol, the only trust registry is module-private, the mint takes the four P4b3 inputs and CALLS the
 *     predicate itself (exactly once, before any brand), and no other production file casts a value to the authority type
 *   - decide nothing hidden: the selector is order-independent with no score, ranking, client fact or provenance; the gate reads result structure and identity only
 *   - never RE-RUN anything: the materializer has no Constructor, orchestrator, timing search, P4b2, P4b3, preparation, database, clock, randomness, logging or environment
 *   - fail CLOSED in the pinned order (authority -> same-run basis -> readiness -> materializability gate -> cross-checks -> build -> conservation), never throw,
 *     never synthesize `candidateOrder`, empty Deferred and conflicts only through the gate, and return a detached, deeply frozen output
 *   - add no ACTIVE mode / flag / environment, no telemetry, no schema or migration
 *
 * Every rule is a PURE FUNCTION over source files: it runs on the real tree (zero violations) AND on the tree with a synthetic violation injected.
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

const AUTH = 'apps/web/lib/acceptedCounterfactual.ts';
const SELECTOR = 'apps/web/lib/activeSelector.ts';
const GATE = 'apps/web/lib/activeMaterializability.ts';
const MAT = 'apps/web/lib/activeResultMaterializer.ts';
const SHADOW = 'apps/web/lib/shadowPolicyObservation.ts';
const PREDICATE = 'apps/web/lib/counterfactualAcceptance.ts';
const NEW_MODULES = [AUTH, SELECTOR, GATE, MAT];
/** Every identifier / specifier the four modules own: no other production file may name any of them, except where an allow-list below says so. */
const VOCAB = /\b(AcceptedCounterfactual|AcceptedPlacement|MintedAcceptance|mintAcceptedCounterfactual|isAcceptedCounterfactual|recordAcceptedObservation|acceptedCounterfactualOf|selectActiveCounterfactual|ActiveSelection|evaluateMaterializability|Materializability[A-Za-z]*|materializeActiveResult|ActiveMaterialization[A-Za-z]*|MaterializerUnavailableReason)\b|(acceptedCounterfactual|activeSelector|activeMaterializability|activeResultMaterializer)['"]/;
const DB_VOCAB = /from '\.\/db'|\bpool\b|\.query\(|beginTransaction|withRepeatableReadSnapshot|prisma|INSERT|UPDATE|DELETE|loadDecisionSchedulingContext|schedulingContext|loadBlockingPlans|loadDurationContext|loadAvailabilityConfiguration|prepareDecisionFacts/i;
const CLOCK_RANDOM_VOCAB = /Date\.now|new Date\(\)|performance\.now|hrtime|Math\.random|crypto|randomUUID/;
const ASYNC_ENV_VOCAB = /\basync\b|\bawait\b|Promise|setTimeout|setInterval|console\.|logger|telemetry|fetch\(|require\(|process\.|\benv\b|featureFlag|isFeatureEnabled/;
const EXECUTION_VOCAB = /\bconstructDay\w*\(|orchestrate\w*\(|\bpreparePromotionInputs\b|\bgenerateLocalCounterfactual\b|\bevaluateCounterfactualAcceptance\b|\bobserveShadowPolicy\b|\bsearchTiming\b|runTimingSearch|excludedIntervals|replenish|\bcaptureBaselinePlacements\b|\bassembleConstructionBasis\b|\bprojectContentionAuthority\b|\bprojectSchedulingAttempts\b|\bevaluateLocalPlacementGate\b/i;
const VALUE_VOCAB = /\bscore\b|utility|weight|boost|priorit|urgen|\bimportance\b|\bdeadline\b|originalOrder|\.pressure\b|DecisionPressure|DecisionFacts|decisionFacts|provenance|\bsource\b/i;
const MUTATION = /\b(?:input|baseline|baselineResult|day|preview|basis|accepted|run|observation)\.[A-Za-z.]+\s*=[^=]|\bdelete \b|Object\.defineProperty|Object\.assign|\.splice\(|\.reverse\(|\.fill\(|\.unshift\(|\.shift\(|\.pop\(/;
const NEVER_NAME = [
  'apps/web/lib/dayConstructor.ts', 'apps/web/lib/dayIntent.ts', 'apps/web/lib/dayCapacity.ts', 'apps/web/lib/dayConstructorOrchestrator.ts', 'apps/web/lib/localCounterfactual.ts', counterfactualPath(), 'apps/web/lib/promotionInputPreparation.ts',
  'apps/web/lib/shadowPolicyExecution.ts', 'apps/web/lib/dayConstructorPreviewRequest.ts', 'apps/web/lib/dayConstructorPreviewIntegrity.ts', 'apps/web/lib/dayConstructorPreviewClient.ts', 'apps/web/lib/dayConstructorAcceptance.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts',
  'apps/web/lib/remainingDayRecomposition.ts', 'apps/web/lib/remainingDayRecompositionAcceptance.ts', 'apps/web/lib/dayPlanPreviewPresentation.ts', 'apps/web/lib/dayPlanAcceptancePresentation.ts', 'apps/web/lib/db.ts',
  'apps/web/app/api/day-constructor/preview/route.ts', 'apps/web/app/api/day-constructor/accept/route.ts', 'apps/web/app/api/day/recompose/route.ts', 'apps/web/app/api/plans/route.ts',
];
function counterfactualPath() { return PREDICATE; }

const AUTH_EXPORTS = ['AcceptedPlacementSource', 'AcceptedPlacement', 'AcceptedCounterfactual', 'MintedAcceptance', 'mintAcceptedCounterfactual', 'isAcceptedCounterfactual', 'recordAcceptedObservation', 'acceptedCounterfactualOf'];
const SELECTOR_EXPORTS = ['ActiveSelectionNoChangeReason', 'ActiveSelection', 'selectActiveCounterfactual'];
const GATE_EXPORTS = ['MaterializabilityUnavailableReason', 'MaterializabilityDecision', 'MaterializabilityDay', 'evaluateMaterializability'];
const MAT_EXPORTS = ['MaterializerUnavailableReason', 'ActiveMaterializationInput', 'ActiveMaterialization', 'materializeActiveResult'];

function audit(files: SrcFile[]): string[] {
  const v: string[] = [];
  const get = (f: string) => files.find((x) => x.f === f);
  const by = (re: RegExp) => files.filter((x) => re.test(x.src)).map((x) => x.f);
  const exportsOf = (src: string) => Array.from(src.matchAll(/^export (?:async )?(?:function|interface|type|const|class) (\w+)/gm)).map((x) => x[1]);
  // C1 -- confinement: only the pinned importers, only the pinned vocabulary, no surface names the modules
  const allowedVocab = [...NEW_MODULES, SHADOW];
  by(VOCAB).filter((f) => !allowedVocab.includes(f)).forEach((f) => v.push(`C1:names-the-p4c3-vocabulary:${f}`));
  by(/from '\.\/acceptedCounterfactual'/).filter((f) => ![SHADOW, SELECTOR, MAT].includes(f)).forEach((f) => v.push(`C1:imports-the-authority:${f}`));
  by(/from '\.\/activeSelector'/).forEach((f) => v.push(`C1:imports-the-selector:${f}`));
  by(/from '\.\/activeMaterializability'/).filter((f) => f !== MAT).forEach((f) => v.push(`C1:imports-the-gate:${f}`));
  by(/from '\.\/activeResultMaterializer'/).forEach((f) => v.push(`C1:imports-the-materializer:${f}`));
  by(/\bmintAcceptedCounterfactual\b/).filter((f) => f !== AUTH && f !== SHADOW).forEach((f) => v.push(`C1:names-the-mint:${f}`));
  by(/\bmintAcceptedCounterfactual\(/).filter((f) => f !== AUTH && f !== SHADOW).forEach((f) => v.push(`C1:calls-the-mint:${f}`));
  by(/\brecordAcceptedObservation\b/).filter((f) => f !== AUTH && f !== SHADOW).forEach((f) => v.push(`C1:names-the-observation-link:${f}`));
  by(/\bisAcceptedCounterfactual\b/).filter((f) => f !== AUTH && f !== MAT).forEach((f) => v.push(`C1:names-the-trust-check:${f}`));
  by(/\bacceptedCounterfactualOf\b/).filter((f) => f !== AUTH && f !== SELECTOR).forEach((f) => v.push(`C1:names-the-reader:${f}`));
  by(/\bselectActiveCounterfactual\b|\bmaterializeActiveResult\b|\bevaluateMaterializability\b/).filter((f) => ![SELECTOR, MAT, GATE].includes(f)).forEach((f) => v.push(`C1:names-a-p4c3-entry-point:${f}`));
  for (const f of NEVER_NAME) { const x = get(f); if (x && VOCAB.test(x.src)) v.push(`C1:surface-names-the-p4c3-vocabulary:${f}`); }
  // no production file may forge the authority type by a cast, and the modules own the only `ActiveSelection` / `ActiveMaterialization` shapes
  by(/\bas (?:unknown as )?AcceptedCounterfactual\b|<AcceptedCounterfactual>/).filter((f) => f !== AUTH).forEach((f) => v.push(`C2:casts-to-the-authority-type:${f}`));
  // C2 -- the authority module
  const auth = get(AUTH);
  if (auth) {
    const s = auth.src;
    if (!/^declare const ACCEPTED_BRAND: unique symbol;$/m.test(s) || /export (?:declare )?const ACCEPTED_BRAND|export \{[^}]*ACCEPTED_BRAND/.test(s)) v.push(`C2:brand-is-not-a-private-unique-symbol:${AUTH}`);
    if (!/^const minted = new WeakSet<object>\(\);$/m.test(s) || /export const minted|export \{[^}]*\bminted\b/.test(s)) v.push(`C2:registry-is-not-module-private:${AUTH}`);
    if (count(/\bminted\.add\(/g, s) !== 1 || count(/\bas unknown as AcceptedCounterfactual\b/g, s) !== 1) v.push(`C2:more-than-one-mint-site:${AUTH}`);
    if (count(/\bevaluateCounterfactualAcceptance\(/g, s) !== 1 || !/const acceptance = evaluateCounterfactualAcceptance\(input\);\s*if \(acceptance\.status !== 'ACCEPT'\) return Object\.freeze\(\{ acceptance \}\);/.test(s)) v.push(`C2:mint-does-not-call-the-predicate-once-and-brand-only-on-accept:${AUTH}`);
    if (s.indexOf('evaluateCounterfactualAcceptance(input)') > s.indexOf('minted.add(') || s.indexOf("acceptance.status !== 'ACCEPT'") > s.indexOf('minted.add(')) v.push(`C2:brand-before-the-predicate:${AUTH}`);
    if (!/export function mintAcceptedCounterfactual\(input: CounterfactualAcceptanceInput\): MintedAcceptance \{/.test(s)) v.push(`C2:mint-takes-anything-but-the-four-p4b3-inputs:${AUTH}`);
    if (/\baccepted\??: boolean|\bisAccepted\b|\bforce\b|\btrusted\b/i.test(s)) v.push(`C2:an-accepted-flag-parameter-exists:${AUTH}`);
    if (!/export function isAcceptedCounterfactual\(value: unknown\): value is AcceptedCounterfactual \{\s*return typeof value === 'object' && value !== null && minted\.has\(value\);\s*\}/.test(s)) v.push(`C2:trust-check-is-not-the-registry:${AUTH}`);
    if (!/catch \{\s*return Object\.freeze\(\{ acceptance \}\);\s*\}/.test(s)) v.push(`C2:mint-failure-after-accept-does-not-fail-closed:${AUTH}`);
    if (!/startMs: p\.start\.getTime\(\)/.test(s) || /startMs: p\.start[,\s}]/.test(s) || /\bstart: Date\b|\bend: Date\b/.test((s.match(/export interface AcceptedPlacement \{[\s\S]*?\n\}/) ?? [''])[0])) v.push(`C2:placements-are-not-epoch-scalars:${AUTH}`);
    if (!/const linkedAuthority = new WeakMap<object, AcceptedCounterfactual>\(\);/.test(s) || !/if \(!isAcceptedCounterfactual\(accepted\) \|\| observation\.outcome !== 'ACCEPT' \|\| observation\.candidateIntentId !== accepted\.candidateIntentId\) return;/.test(s)) v.push(`C2:observation-link-is-not-checked-and-private:${AUTH}`);
    if (JSON.stringify(exportsOf(s)) !== JSON.stringify(AUTH_EXPORTS)) v.push(`C2:authority-exports-changed:${AUTH}`);
    if (JSON.stringify(Array.from(s.matchAll(/^import [^\n]*;$/gm)).map((x) => x[0])) !== JSON.stringify([
      `import { evaluateCounterfactualAcceptance, type CounterfactualAcceptance, type CounterfactualAcceptanceInput } from './counterfactualAcceptance';`,
      `import type { ConstructionBasisOutcome } from './constructionBasis';`,
      `import type { BaselinePlacementsOutcome } from './baselinePlacements';`,
      `import type { PlacementTimingFit } from './dayConstructor';`,
    ])) v.push(`C2:authority-imports-are-not-the-reviewed-four:${AUTH}`);
  }
  // C3 -- the selector
  const sel = get(SELECTOR);
  if (sel) {
    const s = sel.src;
    if (JSON.stringify(Array.from(s.matchAll(/^import [^\n]*;$/gm)).map((x) => x[0])) !== JSON.stringify([
      `import { acceptedCounterfactualOf, type AcceptedCounterfactual } from './acceptedCounterfactual';`,
      `import type { ShadowPolicyObservation, ShadowPolicyRun } from './shadowPolicyObservation';`,
    ])) v.push(`C3:selector-imports-are-not-the-reviewed-two:${SELECTOR}`);
    if (JSON.stringify(exportsOf(s)) !== JSON.stringify(SELECTOR_EXPORTS)) v.push(`C3:selector-exports-changed:${SELECTOR}`);
    if (!/export type ActiveSelectionNoChangeReason = 'NO_ACCEPT' \| 'MULTIPLE_ACCEPTS' \| 'INCOMPLETE_OBSERVATION';/.test(s)) v.push(`C3:no-change-reasons-changed:${SELECTOR}`);
    if (count(/LAST_KNOWN_OPPORTUNITY_RESCUED/g, s) !== 2 || !/selectionReason: 'LAST_KNOWN_OPPORTUNITY_RESCUED'/.test(s)) v.push(`C3:selection-reason-is-not-the-single-v1-reason:${SELECTOR}`);
    if (/\.sort\(|\.toSorted\(|\.reduce\(|Math\.(?:max|min)|\.at\(|\[0\]\.(?:score|rank)|\.findLast\(|\.slice\(/.test(s)) v.push(`C3:ranking-or-order-dependent-operation:${SELECTOR}`);
    if (VALUE_VOCAB.test(s.replace(/LAST_KNOWN_OPPORTUNITY_RESCUED/g, ''))) v.push(`C3:score-client-fact-or-provenance:${SELECTOR}`);
    if (!/if \(run\.status !== 'READY'\) return INCOMPLETE_OBSERVATION;/.test(s) || !/if \(isTechnicalFailure\(observation\)\) return INCOMPLETE_OBSERVATION;/.test(s) || !/\(observation\.outcome === 'GENERATION_UNAVAILABLE' && observation\.reason === 'GENERATION_FAILED'\) \|\| \(observation\.outcome === 'ACCEPTANCE_UNAVAILABLE' && observation\.reason === 'EVALUATION_FAILED'\)/.test(s)) v.push(`C3:technical-failure-does-not-fail-closed:${SELECTOR}`);
    if (!/if \(accepts\.some\(\(observation\) => acceptedCounterfactualOf\(observation\) === undefined\)\) return INCOMPLETE_OBSERVATION;/.test(s) || !/if \(accepts\.length === 0\) return NO_ACCEPT;\s*if \(accepts\.length > 1\) return MULTIPLE_ACCEPTS;/.test(s)) v.push(`C3:accept-count-rules-changed:${SELECTOR}`);
    if (!/\} catch \{\s*return INCOMPLETE_OBSERVATION;\s*\}/.test(s) || !/return Object\.freeze\(\{ status: 'APPLY'/.test(s)) v.push(`C3:selector-can-throw-or-returns-unfrozen:${SELECTOR}`);
    if (count(/status: 'APPLY'/g, s) !== 2) v.push(`C3:more-than-one-apply-site:${SELECTOR}`);
  }
  // C4 -- the gate
  const gate = get(GATE);
  if (gate) {
    const s = gate.src;
    if (/^import /m.test(s)) v.push(`C4:gate-imports-something:${GATE}`);
    if (JSON.stringify(exportsOf(s)) !== JSON.stringify(GATE_EXPORTS)) v.push(`C4:gate-exports-changed:${GATE}`);
    if (!/export type MaterializabilityUnavailableReason = 'INCONSISTENT_AUTHORITY' \| 'DEFERRED_DIAGNOSTIC_UNRESOLVED';/.test(s)) v.push(`C4:gate-reasons-changed:${GATE}`);
    if (!/if \(deferredIds\.filter\(\(id\) => id === candidateIntentId\)\.length !== 1\) return INCONSISTENT;/.test(s) || !/if \(new Set\(deferredIds\)\.size !== deferredIds\.length\) return INCONSISTENT;/.test(s) || !/if \(new Set\(conflictIds\)\.size !== conflictIds\.length\) return INCONSISTENT;/.test(s) || !/if \(conflictIds\.some\(\(id\) => !deferredIds\.includes\(id\)\)\) return INCONSISTENT;/.test(s)) v.push(`C4:structural-rules-changed:${GATE}`);
    if (!/if \(deferredIds\.some\(\(id\) => id !== candidateIntentId\)\) return UNRESOLVED;\s*if \(conflictIds\.some\(\(id\) => id !== candidateIntentId\)\) return UNRESOLVED;\s*return MATERIALIZABLE;/.test(s)) v.push(`C4:unresolved-rules-changed-or-not-after-the-structural-rules:${GATE}`);
    if (s.indexOf('return INCONSISTENT;', s.indexOf('conflictIds.some')) < 0 || s.indexOf('=== 1') > s.indexOf('return UNRESOLVED')) v.push(`C4:structural-checks-are-not-before-unresolved:${GATE}`);
    if (/\.sort\(|\[\d+\]|\.find\(|\.at\(|\.slice\(|\.reduce\(|\.findIndex\(/.test(s)) v.push(`C4:order-dependent-operation:${GATE}`);
    if (!/\} catch \{\s*return INCONSISTENT;\s*\}/.test(s) || VALUE_VOCAB.test(s) || /reason|diagnostic/.test(s.replace(/DEFERRED_DIAGNOSTIC_UNRESOLVED|MaterializabilityUnavailableReason|reason: '[A-Z_]+'|readonly reason: MaterializabilityUnavailableReason/g, ''))) v.push(`C4:gate-can-throw-or-reads-a-deferred-reason:${GATE}`);
  }
  // C5 -- the materializer
  const mat = get(MAT);
  if (mat) {
    const s = mat.src;
    if (JSON.stringify(Array.from(s.matchAll(/^import [^\n]*;$/gm)).map((x) => x[0])) !== JSON.stringify([
      `import { isAcceptedCounterfactual, type AcceptedCounterfactual, type AcceptedPlacement } from './acceptedCounterfactual';`,
      `import { evaluateMaterializability } from './activeMaterializability';`,
      `import { sortByOverloadPrecedence, type ConstructionWindow, type DayIntent } from './dayIntent';`,
      `import { computeCapacitySnapshot, type BlockedInterval } from './dayCapacity';`,
      `import type { ConstructionBasisOutcome } from './constructionBasis';`,
      `import type { ConstructDayPreview, OrchestrateConstructDayResult } from './dayConstructorOrchestrator';`,
      `import type { ProposedItem } from './dayConstructor';`,
    ]) || count(/^import (?!type )/gm, s) !== 4) v.push(`C5:materializer-imports-are-not-the-reviewed-seven:${MAT}`);
    if (JSON.stringify(exportsOf(s)) !== JSON.stringify(MAT_EXPORTS)) v.push(`C5:materializer-exports-changed:${MAT}`);
    if (!/export type MaterializerUnavailableReason = 'RUN_NOT_READY' \| 'INCONSISTENT_AUTHORITY' \| 'DEFERRED_DIAGNOSTIC_UNRESOLVED' \| 'MATERIALIZATION_FAILED';/.test(s)) v.push(`C5:materializer-reasons-changed:${MAT}`);
    if (!/export function materializeActiveResult\(input: ActiveMaterializationInput\): ActiveMaterialization \{\s*try \{/.test(s) || !/\} catch \(error\) \{\s*return unavailable\(error instanceof AuthorityMismatch \? 'INCONSISTENT_AUTHORITY' : 'MATERIALIZATION_FAILED'\);\s*\}/.test(s)) v.push(`C5:materializer-is-not-wrapped-fail-closed:${MAT}`);
    // the pinned fail-closed order
    const order = [
      "if (!isAcceptedCounterfactual(accepted)) return unavailable('INCONSISTENT_AUTHORITY');",
      "if (input.constructionBasis !== accepted.constructionBasis) return unavailable('INCONSISTENT_AUTHORITY');",
      "if (baseline.status !== 'READY' || input.constructionBasis.status !== 'READY') return unavailable('RUN_NOT_READY');",
      'const gate = evaluateMaterializability(day, candidateId);',
      "if (gate.status === 'UNAVAILABLE') return unavailable(gate.reason);",
      'mismatch(new Set(intentIds).size !== intentIds.length);',
      'const changed = new Map<string, AcceptedPlacement>',
      'const precedence = sortByOverloadPrecedence(',
      'const capacity = computeCapacitySnapshot(',
      'const finalIds = materialized.constructedDay.proposedItems.map',
      'return Object.freeze({ status: \'READY\', result: deepFreeze(',
    ];
    const positions = order.map((o) => s.indexOf(o));
    if (positions.some((p) => p < 0) || positions.some((p, i) => i > 0 && p <= positions[i - 1])) v.push(`C5:fail-closed-order-changed:${MAT}`);
    if (count(/\bsortByOverloadPrecedence\(/g, s) !== 1 || count(/\bcomputeCapacitySnapshot\(/g, s) !== 1 || count(/\bevaluateMaterializability\(/g, s) !== 1 || count(/\bisAcceptedCounterfactual\(/g, s) !== 1) v.push(`C5:not-exactly-one-call-of-each-pure-dependency:${MAT}`);
    if (!/sortByOverloadPrecedence\(basis\.intents as unknown as readonly DayIntent\[\], basis\.planningDate\)/.test(s) || !/computeCapacitySnapshot\(detach\(window\) as ConstructionWindow, blockedIntervals, placedMinutes\)/.test(s) || !/const window = preview\.constructionWindow;/.test(s)) v.push(`C5:order-or-capacity-authority-changed:${MAT}`);
    if (!/deferredItems: \[\],\s*conflicts: \[\],/.test(s) || count(/deferredItems:/g, s) !== 1 || count(/conflicts:/g, s) !== 1 || !/mismatch\(materialized\.constructedDay\.deferredItems\.length !== 0 \|\| materialized\.constructedDay\.conflicts\.length !== 0\);/.test(s)) v.push(`C5:deferred-and-conflicts-are-not-empty-only-through-the-gate:${MAT}`);
    if (/\bcandidateOrder\b/.test(s)) v.push(`C5:candidate-order-is-synthesized-or-copied-by-name:${MAT}`);
    if (count(/placementSource: 'SELECTED_CANDIDATE'/g, s) !== 1 || !/requiresConfirmation: true/.test(s)) v.push(`C5:new-item-fields-changed:${MAT}`);
    if (!/requestedCapacity: detach\(day\.requestedCapacity\)/.test(s) || !/proposedCapacity: capacity\.snapshot/.test(s)) v.push(`C5:requested-capacity-is-not-copied-or-proposed-is-not-recomputed:${MAT}`);
    if (!/function detach<T>\(value: T\): T \{/.test(s) || !/function deepFreeze<T>\(value: T\): T \{/.test(s) || !/new Date\(value\.getTime\(\)\)/.test(s)) v.push(`C5:output-is-not-detached-and-frozen:${MAT}`);
    if (count(/\.sort\(/g, s) !== 1 || !/items\.slice\(\)\.sort\(/.test(s)) v.push(`C5:sort-of-anything-but-a-private-copy:${MAT}`);
    if (!/mismatch\(\!?[^;]*overlapsMs/.test(s) || !/return aStart < bEnd && bStart < aEnd;/.test(s) || !/blocker\.start < blocker\.end/.test(s)) v.push(`C5:overlap-or-blocker-semantics-changed:${MAT}`);
    if (!/placement\.endMs - placement\.startMs !== minutes \* 60000/.test(s) || !/placement\.startMs < windowStart \|\| placement\.endMs > windowEnd/.test(s)) v.push(`C5:duration-or-window-defense-removed:${MAT}`);
    if (!/displaced\.includes\(base\.intentId\)\)/.test(s) || !/base\.placementSource === 'FIXED_CONSTRAINT' && displaced\.includes\(base\.intentId\)/.test(s)) v.push(`C5:fixed-or-non-owner-defense-removed:${MAT}`);
  }
  // C6 -- purity of all four modules
  for (const f of NEW_MODULES) {
    const x = get(f);
    if (!x) { v.push(`C6:module-missing:${f}`); continue; }
    if (DB_VOCAB.test(x.src)) v.push(`C6:database:${f}`);
    if (CLOCK_RANDOM_VOCAB.test(x.src)) v.push(`C6:clock-or-randomness:${f}`);
    if (ASYNC_ENV_VOCAB.test(x.src)) v.push(`C6:async-logging-environment:${f}`);
    if (f !== AUTH && EXECUTION_VOCAB.test(x.src)) v.push(`C6:constructor-search-or-earlier-stage-call:${f}`);
    if (MUTATION.test(x.src)) v.push(`C6:mutates-an-input:${f}`);
    if (/\bactive\b.*\b(?:mode|flag|enabled)\b|AURA_[A-Z_]*ACTIVE|'ACTIVE'|"ACTIVE"/i.test(x.src)) v.push(`C6:active-mode-or-flag:${f}`);
    if (f !== MAT && f !== AUTH && /\bthrow\b/.test(x.src)) v.push(`C6:throws:${f}`);
    if (/telemetry|\bmetrics?\b|\bcounter\b|\bsink\b|\bemit\(|\.track\(|analytics/i.test(x.src)) v.push(`C6:telemetry:${f}`);
  }
  if (mat && count(/\bthrow\b/g, mat.src) !== 3) v.push(`C6:materializer-throw-sites-changed:${MAT}`);
  if (auth && (count(/\bthrow\b/g, auth.src) !== 1 || !/throw new Error\('non-finite instant'\)/.test(auth.src))) v.push(`C6:authority-throw-sites-changed:${AUTH}`);
  if (mat && !/class AuthorityMismatch extends Error \{\}/.test(mat.src)) v.push(`C6:materializer-internal-signal-changed:${MAT}`);
  // C7 -- the P4b4 composition's seam is exactly the mint + link, and ACTIVE is nowhere
  const shadow = get(SHADOW);
  if (shadow) {
    if (!/import \{ mintAcceptedCounterfactual, recordAcceptedObservation \} from '\.\/acceptedCounterfactual';/.test(shadow.src) || /^import (?!type )[^\n]*from '\.\/counterfactualAcceptance'/m.test(shadow.src) || /\bevaluateCounterfactualAcceptance\(/.test(shadow.src)) v.push(`C7:composition-calls-the-predicate-directly-or-imports-it-as-a-value:${SHADOW}`);
    if (!/if \(accepted\) recordAcceptedObservation\(observation, accepted\);/.test(shadow.src)) v.push(`C7:composition-does-not-link-the-authority:${SHADOW}`);
    if (/\bselectActiveCounterfactual\b|\bmaterializeActiveResult\b|\bevaluateMaterializability\b/.test(shadow.src)) v.push(`C7:composition-consumes-the-selector-or-materializer:${SHADOW}`);
  }
  for (const f of ['apps/web/lib/shadowPolicyExecution.ts', 'apps/web/lib/dayConstructorPreviewRequest.ts', 'apps/web/app/api/day-constructor/preview/route.ts']) {
    const x = get(f);
    if (x && /'ACTIVE'|"ACTIVE"|AURA_[A-Z_]*ACTIVE|selectActiveCounterfactual|materializeActiveResult/.test(x.src)) v.push(`C7:active-wiring-appeared:${f}`);
  }
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
check(`THE REAL PRODUCTION TREE HAS ZERO P4c3 ARCHITECTURE VIOLATIONS (${real.length} production files scanned)${baseline.length ? ': ' + baseline.join(', ') : ''}`, baseline.length === 0);

console.log('=== confinement, unforgeability, purity ===');
check('CONFINED: the vocabulary of the four modules exists in exactly the four modules and the P4b4 composition; the authority is imported only by the composition, the selector and the materializer; nothing imports the selector or the materializer; only the materializer imports the gate', JSON.stringify(names(VOCAB)) === JSON.stringify([AUTH, SELECTOR, GATE, MAT, SHADOW].sort()) && JSON.stringify(names(/from '\.\/acceptedCounterfactual'/)) === JSON.stringify([SELECTOR, MAT, SHADOW].sort()) && names(/from '\.\/activeSelector'/).length === 0 && names(/from '\.\/activeResultMaterializer'/).length === 0 && JSON.stringify(names(/from '\.\/activeMaterializability'/)) === JSON.stringify([MAT]));
check('NO SURFACE: no route, preview request, orchestrator, Constructor, comparator, capacity, generator, predicate, preparation, execution boundary, signing, acceptance, persistence, recomposition, presentation or database module names the vocabulary', NEVER_NAME.every((f) => !VOCAB.test(src(f))));
check('UNFORGEABLE: a non-exported unique-symbol brand, a module-private WeakSet registry with ONE add site, a mint that CALLS the predicate exactly once before any brand and takes only the four P4b3 inputs (no accepted flag), and no other production file casts to the authority type', !flags(audit(real), 'C2:'));
check('ONLY THE COMPOSITION MINTS: `mintAcceptedCounterfactual` and `recordAcceptedObservation` are named by the authority and the P4b4 composition only; the composition no longer imports or calls the predicate directly', JSON.stringify(names(/\bmintAcceptedCounterfactual\(/)) === JSON.stringify([AUTH, SHADOW].sort()) && JSON.stringify(names(/\brecordAcceptedObservation\b/)) === JSON.stringify([AUTH, SHADOW].sort()) && !flags(audit(real), 'C7:'));
check('THE ONLY PREDICATE CALLER IS THE AUTHORITY (the shadow composition keeps TYPE-only imports of the predicate vocabulary)', JSON.stringify(names(/\bevaluateCounterfactualAcceptance\(/)) === JSON.stringify([AUTH, PREDICATE].sort()));
check('SELECTOR: exactly two imports (the authority reader, type-only run / observation contracts), one APPLY site, the three NO_CHANGE reasons, technical failures fail closed, an authority-less ACCEPT is INCOMPLETE, no sort / rank / score / client fact / provenance, never throws', !flags(audit(real), 'C3:'));
check('GATE: no imports, exactly-once P / unique ids / conflict subset are INCONSISTENT_AUTHORITY, checked BEFORE the two DEFERRED_DIAGNOSTIC_UNRESOLVED rules; no indexing, sorting or reason reading; never throws', !flags(audit(real), 'C4:'));
check('MATERIALIZER: the pinned fail-closed order (authority -> same-run basis -> readiness -> gate -> cross-checks -> build -> conservation), one call each of the existing precedence sort and capacity function, empty Deferred / conflicts, candidateOrder never named, detached and frozen output, half-open overlap, duration / window / FIXED defenses', !flags(audit(real), 'C5:'));
check('PURE: no database, clock, randomness, async, logging, environment, telemetry, ACTIVE flag, Constructor / orchestrator / search / P4b2 / P4b3 call, or input mutation in any of the four modules', !flags(audit(real), 'C6:'));

const migrationSql = fs.readdirSync(path.join(root, 'apps/web/prisma/migrations'), { withFileTypes: true }).filter((e) => e.isDirectory());
check('NO SCHEMA, NO MIGRATION: the Prisma schema mentions none of the vocabulary and the migration count is still 43', !VOCAB.test(read('apps/web/prisma/schema.prisma')) && migrationSql.length === 43);
const ci = read('.github/workflows/ci.yml');
check('CI RUNS THE NEW SUITES: the behavior suite and this architecture suite are steps of the pure job', /npx ts-node test\/activeResultMaterializer\.test\.ts/.test(ci) && /npx ts-node test\/activeResultMaterializerArchitecture\.test\.ts/.test(ci));
const dateGuard = read('test/schedulingDateMutatorArchitecture.test.ts');
check('#208 SCOPE: the authority and the materializer are on the protected Date-mutator list', dateGuard.includes(`file: '${AUTH}'`) && dateGuard.includes(`file: '${MAT}'`));

console.log('=== mutations (in-memory copies only) ===');
check('MUTATION: a production consumer / route / preview / acceptance / orchestrator naming the vocabulary or importing a module -> detected', flags(audit(addFile(real, 'apps/web/lib/rogue1.ts', "import { selectActiveCounterfactual } from './activeSelector';\nexport const a = selectActiveCounterfactual;")), 'C1:imports-the-selector', 'apps/web/lib/rogue1.ts') && flags(audit(addFile(real, 'apps/web/lib/rogue2.ts', "import { materializeActiveResult } from './activeResultMaterializer';\nexport const a = materializeActiveResult;")), 'C1:imports-the-materializer', 'apps/web/lib/rogue2.ts') && flags(audit(addFile(real, 'apps/web/lib/rogue3.ts', "import { evaluateMaterializability } from './activeMaterializability';\nexport const a = evaluateMaterializability;")), 'C1:imports-the-gate', 'apps/web/lib/rogue3.ts') && ['apps/web/app/api/day-constructor/preview/route.ts', 'apps/web/lib/dayConstructorOrchestrator.ts', 'apps/web/lib/dayConstructorAcceptance.ts', 'apps/web/lib/dayConstructorPreviewIntegrity.ts', 'apps/web/lib/shadowPolicyExecution.ts'].every((f) => flags(auditM(f, (s) => `${s}\nconst leaked = 'selectActiveCounterfactual';`), 'C1:surface-names-the-p4c3-vocabulary', f)));
check('MUTATION: another minter / mint caller / trust check / reader -> detected', flags(audit(addFile(real, 'apps/web/lib/rogueMint.ts', "import { mintAcceptedCounterfactual } from './acceptedCounterfactual';\nexport const a = () => mintAcceptedCounterfactual({} as never);")), 'C1:calls-the-mint', 'apps/web/lib/rogueMint.ts') && flags(audit(addFile(real, 'apps/web/lib/rogueTrust.ts', "import { isAcceptedCounterfactual } from './acceptedCounterfactual';\nexport const a = isAcceptedCounterfactual;")), 'C1:names-the-trust-check', 'apps/web/lib/rogueTrust.ts') && flags(audit(addFile(real, 'apps/web/lib/rogueRead.ts', "import { acceptedCounterfactualOf } from './acceptedCounterfactual';\nexport const a = acceptedCounterfactualOf;")), 'C1:names-the-reader', 'apps/web/lib/rogueRead.ts') && flags(audit(addFile(real, 'apps/web/lib/rogueLink.ts', "import { recordAcceptedObservation } from './acceptedCounterfactual';\nexport const a = recordAcceptedObservation;")), 'C1:names-the-observation-link', 'apps/web/lib/rogueLink.ts'));
check('MUTATION: FORGED AUTHORITY -- a cast to the authority type anywhere else, an exported brand or registry, a second mint site, an accepted flag parameter -> detected', flags(audit(addFile(real, 'apps/web/lib/rogueCast.ts', "export const a = {} as unknown as AcceptedCounterfactual;")), 'C2:casts-to-the-authority-type', 'apps/web/lib/rogueCast.ts') && flags(auditM(AUTH, rep('declare const ACCEPTED_BRAND: unique symbol;', 'export declare const ACCEPTED_BRAND: unique symbol;')), 'C2:brand-is-not-a-private', AUTH) && flags(auditM(AUTH, rep('const minted = new WeakSet<object>();', 'export const minted = new WeakSet<object>();')), 'C2:registry-is-not-module-private', AUTH) && flags(auditM(AUTH, (s) => `${s}\nconst again = (o: object) => minted.add(o);`), 'C2:more-than-one-mint-site', AUTH) && flags(auditM(AUTH, rep('export function mintAcceptedCounterfactual(input: CounterfactualAcceptanceInput): MintedAcceptance {', 'export function mintAcceptedCounterfactual(input: CounterfactualAcceptanceInput, accepted: boolean): MintedAcceptance {')), 'C2:mint-takes-anything', AUTH));
check('MUTATION: the brand is applied WITHOUT the predicate deciding (the ACCEPT guard removed, the predicate not called, or called twice) -> detected', flags(auditM(AUTH, rep("if (acceptance.status !== 'ACCEPT') return Object.freeze({ acceptance });", '')), 'C2:mint-does-not-call-the-predicate', AUTH) && flags(auditM(AUTH, rep('const acceptance = evaluateCounterfactualAcceptance(input);', "const acceptance = { status: 'ACCEPT' } as never;")), 'C2:mint-does-not-call-the-predicate', AUTH) && flags(auditM(AUTH, (s) => `${s}\nconst again = (i: CounterfactualAcceptanceInput) => evaluateCounterfactualAcceptance(i);`), 'C2:mint-does-not-call-the-predicate', AUTH) && flags(auditM(AUTH, rep('return typeof value === \'object\' && value !== null && minted.has(value);', 'return typeof value === \'object\' && value !== null;')), 'C2:trust-check-is-not-the-registry', AUTH));
check('MUTATION: the authority holds Dates, loses its fail-closed mint failure, or its observation link is unchecked -> detected', flags(auditM(AUTH, rep('startMs: p.start.getTime(),', 'startMs: p.start,')), 'C2:placements-are-not-epoch-scalars', AUTH) && flags(auditM(AUTH, rep('} catch {\n    return Object.freeze({ acceptance });\n  }', '} catch (error) {\n    throw error;\n  }')), 'C2:mint-failure-after-accept', AUTH) && flags(auditM(AUTH, rep("if (!isAcceptedCounterfactual(accepted) || observation.outcome !== 'ACCEPT' || observation.candidateIntentId !== accepted.candidateIntentId) return;", '')), 'C2:observation-link', AUTH));
check('MUTATION: SELECTOR ranks, scores, reads client facts, picks the first ACCEPT, ignores a technical failure or an authority-less ACCEPT, or applies more than once -> detected', flags(auditM(SELECTOR, rep('accepts.length > 1) return MULTIPLE_ACCEPTS;', 'accepts.length > 1) return Object.freeze({ status: \'APPLY\', candidateIntentId: accepts.sort((a, b) => 0)[0].candidateIntentId } as never);')), 'C3:', SELECTOR) && flags(auditM(SELECTOR, (s) => `${s}\nconst rank = (xs: number[]) => xs.sort();`), 'C3:ranking-or-order-dependent', SELECTOR) && flags(auditM(SELECTOR, (s) => `${s}\nconst k = (x: { importance: string }) => x.importance;`), 'C3:score-client-fact', SELECTOR) && flags(auditM(SELECTOR, rep('if (isTechnicalFailure(observation)) return INCOMPLETE_OBSERVATION;', '')), 'C3:technical-failure', SELECTOR) && flags(auditM(SELECTOR, rep('if (accepts.some((observation) => acceptedCounterfactualOf(observation) === undefined)) return INCOMPLETE_OBSERVATION;', '')), 'C3:accept-count-rules', SELECTOR) && flags(auditM(SELECTOR, (s) => `${s}\nconst second = { status: 'APPLY' };`), 'C3:more-than-one-apply-site', SELECTOR) && flags(auditM(SELECTOR, rep("'NO_ACCEPT' | 'MULTIPLE_ACCEPTS' | 'INCOMPLETE_OBSERVATION'", "'NO_ACCEPT' | 'MULTIPLE_ACCEPTS' | 'INCOMPLETE_OBSERVATION' | 'BEST_OF'")), 'C3:no-change-reasons', SELECTOR));
check('MUTATION: GATE reads a Deferred reason, drops the exactly-once rule, checks UNRESOLVED before the structural rules, sorts or indexes, or throws -> detected', flags(auditM(GATE, (s) => `${s}\nconst r = (d: { reason: string }) => d.reason;`), 'C4:gate-can-throw-or-reads', GATE) && flags(auditM(GATE, rep('if (deferredIds.filter((id) => id === candidateIntentId).length !== 1) return INCONSISTENT;', '')), 'C4:structural-rules-changed', GATE) && flags(auditM(GATE, (s) => `${s}\nconst first = (xs: string[]) => xs[0];`), 'C4:order-dependent', GATE) && flags(auditM(GATE, rep("conflictIds.some((id) => !deferredIds.includes(id))) return INCONSISTENT;", "conflictIds.some((id) => !deferredIds.includes(id))) return UNRESOLVED;")), 'C4:structural-rules-changed', GATE) && flags(auditM(GATE, (s) => `import type { X } from './y';\n${s}`), 'C4:gate-imports-something', GATE));
check('MUTATION: MATERIALIZER re-runs the Constructor / search / P4b2 / P4b3, or reads the clock, randomness, a database -> detected', flags(auditM(MAT, (s) => `${s}\nconst x = () => constructDay({} as never);`), 'C6:constructor-search', MAT) && flags(auditM(MAT, (s) => `${s}\nconst x = () => generateLocalCounterfactual({} as never);`), 'C6:constructor-search', MAT) && flags(auditM(MAT, (s) => `${s}\nconst x = () => evaluateCounterfactualAcceptance({} as never);`), 'C6:constructor-search', MAT) && flags(auditM(MAT, (s) => `${s}\nconst x = () => deps.searchTiming({});`), 'C6:constructor-search', MAT) && flags(auditM(MAT, (s) => `${s}\nconst t = () => Date.now();`), 'C6:clock-or-randomness', MAT) && flags(auditM(MAT, (s) => `${s}\nconst t = () => new Date();`), 'C6:clock-or-randomness', MAT) && flags(auditM(MAT, (s) => `${s}\nconst t = () => Math.random();`), 'C6:clock-or-randomness', MAT) && flags(auditM(MAT, (s) => `${s}\nconst q = () => pool.query('SELECT 1');`), 'C6:database', MAT));
check('MUTATION: the materializer skips a fail-closed step (authority, same-run basis, readiness, gate) or reorders them -> detected', flags(auditM(MAT, rep("if (!isAcceptedCounterfactual(accepted)) return unavailable('INCONSISTENT_AUTHORITY');", '')), 'C5:', MAT) && flags(auditM(MAT, rep("if (input.constructionBasis !== accepted.constructionBasis) return unavailable('INCONSISTENT_AUTHORITY');", '')), 'C5:fail-closed-order', MAT) && flags(auditM(MAT, rep("if (gate.status === 'UNAVAILABLE') return unavailable(gate.reason);", '')), 'C5:fail-closed-order', MAT) && flags(auditM(MAT, rep("if (baseline.status !== 'READY' || input.constructionBasis.status !== 'READY') return unavailable('RUN_NOT_READY');", '')), 'C5:fail-closed-order', MAT) && flags(auditM(MAT, rep("    const gate = evaluateMaterializability(day, candidateId);\n    if (gate.status === 'UNAVAILABLE') return unavailable(gate.reason);\n", '')), 'C5:', MAT));
check('MUTATION: candidateOrder is synthesized, Deferred / conflicts are filled or not empty, requestedCapacity recomputed, proposedCapacity copied, the precedence sort or capacity function bypassed -> detected', flags(auditM(MAT, rep("        placementSource: 'SELECTED_CANDIDATE',", "        placementSource: 'SELECTED_CANDIDATE',\n        candidateOrder: 0,")), 'C5:candidate-order', MAT) && flags(auditM(MAT, rep('deferredItems: [],', 'deferredItems: day.deferredItems,')), 'C5:deferred-and-conflicts', MAT) && flags(auditM(MAT, rep('conflicts: [],', 'conflicts: day.conflicts,')), 'C5:deferred-and-conflicts', MAT) && flags(auditM(MAT, rep('proposedCapacity: capacity.snapshot,', 'proposedCapacity: detach(day.proposedCapacity),')), 'C5:requested-capacity', MAT) && flags(auditM(MAT, rep('requestedCapacity: detach(day.requestedCapacity),', 'requestedCapacity: capacity.snapshot,')), 'C5:requested-capacity', MAT) && flags(auditM(MAT, rep('const precedence = sortByOverloadPrecedence(basis.intents as unknown as readonly DayIntent[], basis.planningDate).map((intent) => intent.id);', 'const precedence = baselineIds;')), 'C5:', MAT) && flags(auditM(MAT, rep('const capacity = computeCapacitySnapshot(detach(window) as ConstructionWindow, blockedIntervals, placedMinutes);', "const capacity = { status: 'READY', snapshot: day.proposedCapacity } as never;")), 'C5:', MAT));
check('MUTATION: defense in depth removed -- the duration, window, blocker, overlap (half-open), FIXED or non-owner checks -> detected', flags(auditM(MAT, rep('placement.endMs - placement.startMs !== minutes * 60000 || ', '')), 'C5:duration-or-window', MAT) && flags(auditM(MAT, rep(' || placement.startMs < windowStart || placement.endMs > windowEnd', '')), 'C5:duration-or-window', MAT) && flags(auditM(MAT, rep('return aStart < bEnd && bStart < aEnd;', 'return aStart <= bEnd && bStart <= aEnd;')), 'C5:overlap-or-blocker', MAT) && flags(auditM(MAT, rep('.filter((blocker) => blocker.start < blocker.end);', ';')), 'C5:overlap-or-blocker', MAT) && flags(auditM(MAT, rep("for (const base of day.proposedItems) mismatch(base.placementSource === 'FIXED_CONSTRAINT' && displaced.includes(base.intentId));", '')), 'C5:fixed-or-non-owner', MAT));
check('MUTATION: the output is shared / unfrozen, the input is mutated, or the output is sorted in place on an input array -> detected', flags(auditM(MAT, rep('result: deepFreeze({ status: \'READY\' as const, preview: materialized })', "result: { status: 'READY' as const, preview: materialized }")), 'C5:fail-closed-order', MAT) && flags(auditM(MAT, (s) => `${s}\nconst bad = (day: { proposedItems: unknown[] }) => { day.proposedItems = []; };`), 'C6:mutates-an-input', MAT) && flags(auditM(MAT, (s) => `${s}\nconst bad = (xs: number[]) => xs.splice(0, 1);`), 'C6:mutates-an-input', MAT) && flags(auditM(MAT, rep('const ordered = items.slice().sort(', 'const ordered = items.sort(')), 'C5:sort-of-anything', MAT) && flags(auditM(MAT, rep('if (value instanceof Date) return new Date(value.getTime()) as unknown as T;', 'if (value instanceof Date) return value as unknown as T;')), 'C5:output-is-not-detached', MAT));
check('MUTATION: an ACTIVE flag / environment / mode, telemetry, or wiring into the preview path appears -> detected', flags(auditM(SELECTOR, (s) => `${s}\nconst mode = 'ACTIVE';`), 'C6:active-mode-or-flag', SELECTOR) && flags(auditM(MAT, (s) => `${s}\nconst flag = process.env.AURA_ACTIVE_POLICY;`), 'C6:', MAT) && flags(auditM(AUTH, (s) => `${s}\nconst t = () => telemetry.track('x');`), 'C6:telemetry', AUTH) && flags(auditM('apps/web/lib/shadowPolicyExecution.ts', (s) => `${s}\nconst a = 'ACTIVE';`), 'C7:active-wiring-appeared', 'apps/web/lib/shadowPolicyExecution.ts') && flags(auditM('apps/web/app/api/day-constructor/preview/route.ts', (s) => `${s}\nconst a = materializeActiveResult;`), 'C7:active-wiring-appeared', 'apps/web/app/api/day-constructor/preview/route.ts'));
check('MUTATION: the P4b4 composition calls the predicate directly, loses the link, or consumes the selector -> detected', flags(auditM(SHADOW, (s) => `import { evaluateCounterfactualAcceptance } from './counterfactualAcceptance';\n${s}`), 'C7:composition-calls-the-predicate', SHADOW) && flags(auditM(SHADOW, rep('if (accepted) recordAcceptedObservation(observation, accepted);', '')), 'C7:composition-does-not-link', SHADOW) && flags(auditM(SHADOW, (s) => `${s}\nconst s = selectActiveCounterfactual;`), 'C7:composition-consumes', SHADOW));
check('the mutations were applied to in-memory copies only: the real tree still has zero violations afterwards', audit(productionFiles()).length === 0);

if (!allPassed) {
  console.error('SOME P4c3 ARCHITECTURE CHECKS FAILED');
  process.exitCode = 1;
} else {
  console.log('ALL P4c3 ARCHITECTURE CHECKS PASSED');
}
