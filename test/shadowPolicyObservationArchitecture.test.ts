/**
 * Constructor Decision Intelligence -- O5 P4b4: SAME-RUN SHADOW POLICY COMPOSITION (architecture guard, pure).
 *
 * `observeShadowPolicy(request, deps)` composes ONE orchestration (`preparePromotionInputs`) with the reviewed P4b2 generator and P4b3 predicate, per
 * PromotionInput of THAT run, into frozen diagnostic observations. This guard pins that it:
 *
 *   - is SAME-RUN BY CONSTRUCTION: the only exported seam takes (request, deps) and nothing else; it calls the orchestration boundary exactly once,
 *     hands the generator and the predicate ONLY that run's own authorities (the same run-level basis / placements / attempts objects for every pair),
 *     and exports no function that accepts a basis, placements, a PromotionInput or a counterfactual -- so no caller can assemble the four P4b3
 *     authorities independently
 *   - performs NO second orchestration, timing search, evidence / fact / duration / availability load, pressure derivation, Constructor call or projection
 *   - calls the generator exactly once per PromotionInput and the predicate at most once, only for a READY generation; decides NOTHING itself (no
 *     pressure, timing-rank, importance, deadline or originalOrder read; no policy reason of its own -- source reasons are carried verbatim)
 *   - observes EVERY pair independently in the run's stable order from its own typed `{input, contention}` object: no index zipping, no early stop, no
 *     selection, ranking or application of an ACCEPT, no replacement of the returned Constructor result, no signing, no persistence
 *   - is pure and frozen: no database, clock, randomness, logging, flag or environment; no raw trace, candidate history or authority dump in the output
 *   - has ZERO production consumers and appears in no preview / signing / acceptance / route / schema surface (no OFF | SHADOW | ACTIVE switch yet)
 *   - leaves the committed P4b3 timing-floor grid in place (test debt from the #214 review)
 *
 * Every rule is a PURE FUNCTION over source files: it runs on the real tree (zero violations) AND on the tree with a synthetic violation injected.
 * P4b4 does not implement P4b5+, P5, R3 or S5.
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

const SHADOW = 'apps/web/lib/shadowPolicyObservation.ts';
const GEN = 'apps/web/lib/localCounterfactual.ts';
const ACCEPT_MOD = 'apps/web/lib/counterfactualAcceptance.ts';
const PREP = 'apps/web/lib/promotionInputPreparation.ts';
const CONSTRUCTOR = 'apps/web/lib/dayConstructor.ts';
const INTENT = 'apps/web/lib/dayIntent.ts';
const CAPACITY = 'apps/web/lib/dayCapacity.ts';
const ORCH = 'apps/web/lib/dayConstructorOrchestrator.ts';
const SEARCH = 'packages/recommendation/src/timingSearch.ts';
const VOCAB = /\b(observeShadowPolicy|ShadowPolicy[A-Za-z]*)\b|shadowPolicyObservation['"]/;
const SHADOW_IMPORTS = [
  `import { preparePromotionInputs, type PromotionPair, type PromotionRunAuthority } from './promotionInputPreparation';`,
  `import type { ConstructDayRequest, DayConstructorOrchestratorDeps, OrchestrateConstructDayResult } from './dayConstructorOrchestrator';`,
  `import { generateLocalCounterfactual, type LocalCounterfactual, type LocalCounterfactualUnavailableReason } from './localCounterfactual';`,
  `import { evaluateCounterfactualAcceptance, type CounterfactualAcceptanceUnavailableReason, type CounterfactualRejectionReason } from './counterfactualAcceptance';`,
  `import type { PlacementTimingFit } from './dayConstructor';`,
];
const DB_VOCAB = /from '\.\/db'|\bpool\b|\.query\(|beginTransaction|withRepeatableReadSnapshot|prisma|INSERT|UPDATE|DELETE|loadDecisionSchedulingContext|schedulingContext|loadBlockingPlans|loadDurationContext|loadAvailabilityConfiguration|prepareDecisionFacts/i;
const CLOCK_VOCAB = /Date\.now|new Date\(|performance\.now|hrtime/;
const SEARCH_VOCAB = /searchTiming|runTimingSearch|timingSearch|excludedIntervals|replenish/i;
/** A second run, a second derivation, a re-generation or a projection: none may exist in the composition. */
const EXECUTION_VOCAB = /\borchestrate\w*\(|\bconstructDay\w*\(|\bderiveDecisionPressure\b|\bassemblePromotionInputs\b|\bprojectContentionAuthority\b|\bprojectSchedulingAttempts\b|\bnormalizeSchedulingAttempts\b|\bcaptureBaselinePlacements\b|\bassembleConstructionBasis\b|\bevaluateLocalPlacementGate\b|\bobserveShadowPressure\b|\bevaluateShadowPressure\b/;
const SIDE_EFFECT_VOCAB = /console\.|logger|telemetry|setTimeout|setInterval|Promise\.(all|race|allSettled)|fetch\(|require\(|process\.|\benv\b|Math\.random|crypto|featureFlag|isFeatureEnabled|\bfs\b|signPreviewResultBody|acceptanceToken|\bsign\w*\(|persist|\bsave\w*\(|writeFile|appendFile|\bemit\w*\(|dispatch/i;
const RAW_VOCAB = /ContentionEvent|ContentionTrace|contentionTrace|DecisionEvidence|DecisionFacts|evidenceByIntentId|recurrence|opportunity|scarcity|candidateList|initialCandidates|finalCandidates/i;
/** The composition decides nothing: no policy input of any kind (pressure, timing rank, importance, deadline, originalOrder, scoring, ranking, winners). */
const POLICY_VOCAB = /\.pressure\b|DecisionPressure|\bNONE\b|LAST_KNOWN|SAFE_TO_DEFER|importance|deadline|originalOrder|compareCandidatesForPlacement|compareAbovePressure|projectAbovePressureFacts|compareByOverloadPrecedence|\bscore\b|\brank\w*|\bwinner\b|\bbest\b|\bbetter\b|utility/i;
/** Application of a counterfactual to the baseline result. */
const APPLY_VOCAB = /constructedDay|proposedItems|\.preview\b|resolvedIntents|\.status !== 'READY'\) return \{ result: \w+\.result[^}]*counterfactual/;
const OWNED_REASONS = /OWNER_WOULD_BE_UNPLACED|OWNER_TIMING_DEGRADED|FIXED_PLACEMENT_CHANGED|NON_OWNER_CHANGED|UNNECESSARY_OWNER_CHANGE|PRECEDENCE_NOT_TIE|NET_PROPOSED_LOSS|BASELINE_TIMING_UNKNOWN|COUNTERFACTUAL_INVALID|NO_ACTIONABLE_PROMOTION_SLOT|INCONSISTENT_AUTHORITY|INVALID_INTERVAL/;
const NEVER = [
  CONSTRUCTOR, INTENT, CAPACITY, GEN, ACCEPT_MOD, PREP, ORCH, 'apps/web/lib/contentionTrace.ts', 'apps/web/lib/constructionBasis.ts', 'apps/web/lib/baselinePlacements.ts', 'apps/web/lib/promotionInput.ts', 'apps/web/lib/promotionContentionAuthority.ts',
  'apps/web/lib/schedulingAttemptAuthority.ts', 'apps/web/lib/abovePressurePrecedence.ts', 'apps/web/lib/decisionPressure.ts', 'apps/web/lib/decisionEvidence.ts', 'apps/web/lib/decisionFacts.ts', 'apps/web/lib/decisionFactPreparation.ts',
  'apps/web/lib/dayConstructorPreviewRequest.ts', 'apps/web/lib/dayConstructorPreviewIntegrity.ts', 'apps/web/lib/dayConstructorPreviewClient.ts', 'apps/web/lib/dayConstructorAcceptance.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts',
  'apps/web/lib/remainingDayRecomposition.ts', 'apps/web/lib/remainingDayRecompositionAcceptance.ts', 'apps/web/lib/remainingDayRecompositionIntegrity.ts', 'apps/web/lib/remainingDayRecompositionServer.ts', 'apps/web/lib/homeRecomposition.ts',
  'apps/web/lib/planMove.ts', 'apps/web/lib/homeMove.ts', 'apps/web/lib/dayPlanPreviewPresentation.ts', 'apps/web/lib/dayPlanAcceptancePresentation.ts', 'apps/web/lib/db.ts', 'apps/web/lib/shadowPressureEvaluation.ts',
  'apps/web/lib/shadowPressureObservation.ts', 'apps/web/lib/decisionSchedulingContext.ts', 'apps/web/lib/decisionSchedulingContextLoader.ts', SEARCH,
  'apps/web/app/api/day-constructor/preview/route.ts', 'apps/web/app/api/day-constructor/accept/route.ts', 'apps/web/app/api/day/recompose/route.ts', 'apps/web/app/api/plans/[planId]/move/route.ts', 'apps/web/app/api/plans/route.ts',
];
const OUTCOMES = ['GENERATION_UNAVAILABLE', 'ACCEPTANCE_UNAVAILABLE', 'REJECT', 'ACCEPT'];
const GEN_CALL = `generateLocalCounterfactual({ constructionBasis: run.constructionBasis, baselinePlacements: run.baselinePlacements, schedulingAttempts: run.schedulingAttempts, input: pair.input, contention: pair.contention })`;
const ACC_CALL = `evaluateCounterfactualAcceptance({ constructionBasis: run.constructionBasis, baselinePlacements: run.baselinePlacements, promotionInput: pair.input, counterfactual: generated.counterfactual })`;

function audit(files: SrcFile[]): string[] {
  const v: string[] = [];
  const get = (f: string) => files.find((x) => x.f === f);
  const by = (re: RegExp) => files.filter((x) => re.test(x.src)).map((x) => x.f);
  // B1 -- confinement: ZERO production consumers, no surface names it
  by(VOCAB).filter((f) => f !== SHADOW).forEach((f) => v.push(`B1:names-the-shadow-policy-composition:${f}`));
  by(/from '\.\/shadowPolicyObservation'/).forEach((f) => v.push(`B1:production-consumer-of-the-composition:${f}`));
  by(/\bobserveShadowPolicy\(/).filter((f) => f !== SHADOW).forEach((f) => v.push(`B1:calls-the-composition:${f}`));
  for (const f of NEVER) { const x = get(f); if (x && VOCAB.test(x.src)) v.push(`B1:surface-names-the-composition:${f}`); }
  // B2 -- the generator / predicate have exactly ONE production caller each: this composition
  by(/\bgenerateLocalCounterfactual\(/).filter((f) => f !== GEN && f !== SHADOW).forEach((f) => v.push(`B2:another-generator-caller:${f}`));
  by(/\bevaluateCounterfactualAcceptance\(/).filter((f) => f !== ACCEPT_MOD && f !== SHADOW).forEach((f) => v.push(`B2:another-predicate-caller:${f}`));
  by(/\bpreparePromotionInputs\(/).filter((f) => f !== PREP && f !== SHADOW).forEach((f) => v.push(`B2:another-boundary-caller:${f}`));
  const m = get(SHADOW);
  if (m) {
    const src = m.src;
    // imports -- exactly the reviewed five, three of them values
    if (JSON.stringify(Array.from(src.matchAll(/^import [^\n]*;$/gm)).map((x) => x[0])) !== JSON.stringify(SHADOW_IMPORTS) || count(/^import (?!type )/gm, src) !== 3) v.push(`B3:imports-are-not-the-reviewed-five:${SHADOW}`);
    // SAME RUN: the one seam, one orchestration, nothing independently supplied
    const exportsList = Array.from(src.matchAll(/^export (?:async )?(?:function|interface|type|const|class) (\w+)/gm)).map((x) => x[1]);
    if (JSON.stringify(exportsList) !== JSON.stringify(['ShadowSlot', 'ShadowRelocatedOwner', 'ShadowCounterfactualSummary', 'ShadowPolicyObservation', 'ShadowPolicyRun', 'observeShadowPolicy'])) v.push(`B3:exports-changed-or-an-independent-authority-api-appeared:${SHADOW}`);
    if (!/^export async function observeShadowPolicy\(request: ConstructDayRequest, deps: DayConstructorOrchestratorDeps\): Promise<\{ result: OrchestrateConstructDayResult; shadowPolicy: ShadowPolicyRun \}> \{\n  const prepared = await preparePromotionInputs\(request, deps\);/m.test(src)) v.push(`B3:the-seam-is-not-request-and-deps-only:${SHADOW}`);
    if (count(/\bpreparePromotionInputs\(/g, src) !== 1 || count(/\bawait\b/g, src) !== 1 || count(/\basync\b/g, src) !== 1) v.push(`B3:not-exactly-one-orchestration:${SHADOW}`);
    if (/^export (?:async )?function \w+\([^)]*(?:LocalCounterfactual|PromotionInput|ConstructionBasis|BaselinePlacements|PromotionRunAuthority|PromotionPair|SchedulingAttempt)/m.test(src)) v.push(`B3:exported-function-accepts-an-authority:${SHADOW}`);
    if (!/function compose\(run: PreparedRun\): ShadowPolicyRun \{\n  return Object\.freeze\(\{ status: 'READY', observations: Object\.freeze\(run\.promotions\.map\(\(pair\) => observePair\(run, pair\)\)\) \}\);\n\}/.test(src)) v.push(`B3:observations-are-not-one-per-typed-pair-in-source-order:${SHADOW}`);
    if (!/return \{ result: prepared\.result, shadowPolicy: compose\(prepared\.run\) \};/.test(src) || count(/prepared\.result/g, src) !== 3) v.push(`B3:result-is-not-passed-through-untouched:${SHADOW}`);
    if (!/if \(prepared\.run\.status !== 'PREPARED'\) return \{ result: prepared\.result, shadowPolicy: Object\.freeze\(\{ status: 'UNAVAILABLE', reason: prepared\.run\.reason \}\) \};/.test(src)) v.push(`B3:run-level-unavailable-is-not-explicit:${SHADOW}`);
    // exactly one generator invocation per pair and at most one predicate invocation, only after a READY generation, with the run's own authorities
    if (count(/\bgenerateLocalCounterfactual\(/g, src) !== 1 || count(/\bevaluateCounterfactualAcceptance\(/g, src) !== 1) v.push(`B4:not-exactly-one-generator-and-one-predicate-call-site:${SHADOW}`);
    if (!src.includes(`const generated = ${GEN_CALL};`)) v.push(`B4:generator-arguments-are-not-the-run-authorities-and-the-pair:${SHADOW}`);
    if (!src.includes(`const acceptance = ${ACC_CALL};`)) v.push(`B4:predicate-arguments-are-not-the-run-authorities-the-pair-and-the-generated-counterfactual:${SHADOW}`);
    const gate = src.indexOf(`if (generated.status !== 'READY') return Object.freeze({ outcome: 'GENERATION_UNAVAILABLE', candidateIntentId, reason: generated.reason });`);
    const call = src.indexOf('const acceptance = ');
    if (!(src.indexOf('const generated = ') >= 0 && gate > src.indexOf('const generated = ') && call > gate)) v.push(`B4:predicate-is-not-gated-on-a-ready-generation:${SHADOW}`);
    // layers and reasons carried verbatim
    const outcomeLiterals = Array.from(src.matchAll(/outcome: '(\w+)'/g)).map((x) => x[1]);
    if (JSON.stringify([...new Set(outcomeLiterals)].sort()) !== JSON.stringify([...OUTCOMES].sort())) v.push(`B5:outcome-taxonomy-changed:${SHADOW}`);
    if (!/reason: generated\.reason/.test(src) || count(/reason: acceptance\.reason/g, src) !== 2 || !/'GENERATION_FAILED'/.test(src) || !/'EVALUATION_FAILED'/.test(src)) v.push(`B5:source-reasons-are-not-carried-verbatim:${SHADOW}`);
    if (!/outcome: 'ACCEPT', candidateIntentId, counterfactual \}\);/.test(src) || !/if \(acceptance\.status === 'ACCEPT'\) return/.test(src) || !/if \(acceptance\.status === 'REJECT'\) return/.test(src)) v.push(`B5:accept-or-reject-is-not-exactly-the-predicate-decision:${SHADOW}`);
    if (OWNED_REASONS.test(src)) v.push(`B5:competing-or-translated-reason-vocabulary:${SHADOW}`);
    const runReasons = (src.match(/readonly reason: 'RUN_NOT_READY' \| 'PREPARATION_FAILED' \| 'OBSERVATION_FAILED'/) ?? [''])[0];
    if (!runReasons) v.push(`B5:run-level-reasons-changed:${SHADOW}`);
    // no early stop / selection / ranking / index zipping
    if (/\bfor \(|\bwhile \(|\bbreak\b|\bcontinue\b|\.sort\(|\.toSorted\(|\.reverse\(|\.reduce\(|\.some\(|\.every\(|\.filter\(|\.slice\(|\.splice\(|\.push\(|\.pop\(|\.shift\(|\.at\(|\.flatMap\(|\.findLast\(|\.findIndex\(/.test(src)) v.push(`B6:loop-sort-filter-early-stop-or-mutation:${SHADOW}`);
    if (/[\w)]\[\w+\]/.test(src) || /\(\s*pair\s*,\s*\w+\s*\)\s*=>/.test(src) || /\.map\(\(\w+,\s*\w+\)/.test(src)) v.push(`B6:index-access-or-zipping:${SHADOW}`);
    if (count(/\.map\(/g, src) !== 2 || count(/\.find\(/g, src) !== 1) v.push(`B6:unexpected-collection-operations:${SHADOW}`);
    if (/\bwinner\b|\bselected\b|\bchosen\b|\bfirstAccept\b|\bbestAccept\b/i.test(src)) v.push(`B6:selection-vocabulary:${SHADOW}`);
    // no policy, no second run, no loads, no search, no application, no persistence, no side effects
    if (POLICY_VOCAB.test(src)) v.push(`B7:policy-input-or-ranking-vocabulary:${SHADOW}`);
    if (EXECUTION_VOCAB.test(src)) v.push(`B7:second-orchestration-derivation-projection-or-constructor-call:${SHADOW}`);
    if (DB_VOCAB.test(src)) v.push(`B7:database-query-load-or-snapshot:${SHADOW}`);
    if (SEARCH_VOCAB.test(src)) v.push(`B7:timing-search:${SHADOW}`);
    if (CLOCK_VOCAB.test(src)) v.push(`B7:clock-read-or-date-construction:${SHADOW}`);
    if (SIDE_EFFECT_VOCAB.test(src)) v.push(`B7:logging-environment-signing-persistence-or-randomness:${SHADOW}`);
    if (RAW_VOCAB.test(src)) v.push(`B7:raw-trace-evidence-facts-or-candidate-history:${SHADOW}`);
    if (APPLY_VOCAB.test(src)) v.push(`B7:reads-or-replaces-the-baseline-schedule:${SHADOW}`);
    if (/\bany\b/.test(src) || /JSON\.(parse|stringify)|structuredClone|Object\.assign|deepFreeze|lodash/.test(src)) v.push(`B7:any-or-generic-clone:${SHADOW}`);
    if (/^(let|var) |^const \w+ = (new |\[|\{)/m.test(src)) v.push(`B7:module-level-state:${SHADOW}`);
    // timing fit is only COPIED into a slot, never read as a decision input
    const withoutSlot = src.replace(/export interface ShadowSlot \{[\s\S]*?\n\}/, '').replace(/function slotOf\([\s\S]*?\n\}/, '');
    if (/timingFit/.test(withoutSlot)) v.push(`B7:timing-fit-used-outside-the-slot-copy:${SHADOW}`);
    // output ownership: frozen, scalar (ISO) instants, nothing but the pinned minimal summary
    if (/return \{(?! result: prepared\.result)/.test(src) || !/return Object\.freeze\(placement\.timingFit === undefined \? slot : \{ \.\.\.slot, timingFit: placement\.timingFit \}\);/.test(src)) v.push(`B8:an-output-is-not-frozen:${SHADOW}`);
    if (count(/\.toISOString\(\)/g, src) !== 2 || /\.getTime\(\)|\bDate\b(?!\b[^\n]*:)/.test(src.replace(/\bDate\b/g, (x) => x).replace(/readonly \w+: Date/g, ''))) v.push(`B8:instants-are-not-iso-scalars:${SHADOW}`);
    if (count(/\{ outcome:/g, src) !== count(/Object\.freeze\(\{ outcome:/g, src) || count(/Object\.freeze\(\{ outcome:/g, src) !== 6) v.push(`B8:an-output-is-not-frozen:${SHADOW}`);
    if (!/return Object\.freeze\(\{\n    promoted: slotOf\(cf\.promotedPlacement\),\n    displacedOwnerIds: Object\.freeze\(\[\.\.\.cf\.displacedOwnerIds\]\),\n    relocatedOwners: Object\.freeze\(relocatedOwners\),\n    unplacedOwnerIds: Object\.freeze\(\[\.\.\.cf\.unplacedOwnerIds\]\),\n    baselinePlacementCount: baseline\.length,\n    counterfactualPlacementCount: cf\.counterfactualPlacements\.length,\n  \}\);/.test(src)) v.push(`B8:summary-is-not-the-minimal-reviewed-shape:${SHADOW}`);
    const summaryFields = Array.from(((src.match(/export interface ShadowCounterfactualSummary \{[\s\S]*?\n\}/) ?? [''])[0]).matchAll(/readonly (\w+)\??:/g)).map((x) => x[1]);
    if (JSON.stringify(summaryFields) !== JSON.stringify(['promoted', 'displacedOwnerIds', 'relocatedOwners', 'unplacedOwnerIds', 'baselinePlacementCount', 'counterfactualPlacementCount'])) v.push(`B8:summary-is-not-the-minimal-reviewed-shape:${SHADOW}`);
    if (/ConstructionBasis|SchedulingAttempt|BaselinePlacements|PromotionContention|contentionTrace/.test(src.replace(/run\.(constructionBasis|baselinePlacements|schedulingAttempts)/g, '').replace(/constructionBasis: |baselinePlacements: |schedulingAttempts: |contention: pair\.contention|promotionInput: /g, ''))) v.push(`B8:authority-type-or-dump-in-the-output:${SHADOW}`);
    // failure isolation: each pair is guarded, with the existing reasons of the stage that failed
    if (!/\} catch \{\n    \/\/ Failure isolation[\s\S]*?return stage === 'GENERATION'/.test(m.src.length ? read(SHADOW) : '') || !/let stage: 'GENERATION' \| 'ACCEPTANCE' = 'GENERATION';/.test(src) || !/stage = 'ACCEPTANCE';/.test(src)) v.push(`B9:pair-failure-is-not-isolated-by-stage:${SHADOW}`);
    if (!/\} catch \{\n    return \{ result: prepared\.result, shadowPolicy: Object\.freeze\(\{ status: 'UNAVAILABLE', reason: 'OBSERVATION_FAILED' \}\) \};/.test(src)) v.push(`B9:run-level-failure-is-not-distinct:${SHADOW}`);
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
const rep = (from: string, to: string) => (s: string) => { if (!s.includes(from)) throw new Error(`mutation target missing: ${from.slice(0, 80)}`); return s.replace(from, to); };

console.log('=== the real tree conforms ===');
const baseline = audit(real);
check(`THE REAL PRODUCTION TREE HAS ZERO SHADOW-POLICY ARCHITECTURE VIOLATIONS (${real.length} production files scanned)${baseline.length ? ': ' + baseline.join(', ') : ''}`, baseline.length === 0);

console.log('=== zero consumers, single callers, untouched upstream ===');
check('ZERO PRODUCTION CONSUMERS: the composition vocabulary exists in exactly ONE production file (itself); nothing imports it and nothing calls it -- tests only (not on the Plan Day path, no route, preview body, signing, acceptance or persistence)', JSON.stringify(names(VOCAB)) === JSON.stringify([SHADOW]) && names(/from '\.\/shadowPolicyObservation'/).length === 0 && JSON.stringify(names(/\bobserveShadowPolicy\(/)) === JSON.stringify([SHADOW]));
check('EXACTLY ONE CALLER EACH: the orchestration boundary is called only by itself and this composition; the generator only by itself and this composition; the predicate only by itself and this composition', JSON.stringify(names(/\bpreparePromotionInputs\(/)) === JSON.stringify([PREP, SHADOW].sort()) && JSON.stringify(names(/\bgenerateLocalCounterfactual\(/)) === JSON.stringify([GEN, SHADOW].sort()) && JSON.stringify(names(/\bevaluateCounterfactualAcceptance\(/)) === JSON.stringify([ACCEPT_MOD, SHADOW].sort()));
check('NOT PUBLIC / SIGNED / PERSISTED / ACCEPTED: no preview, signing, acceptance, persistence, Recomposition, Move, presentation, route, scheduling-context, trace, basis, placements, input, contention, attempts, generator, predicate, preparation or orchestration module names the composition', NEVER.every((f) => !VOCAB.test(src(f))));
const migrationSql = fs.readdirSync(path.join(root, 'apps/web/prisma/migrations'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => fs.readFileSync(path.join(root, 'apps/web/prisma/migrations', e.name, 'migration.sql'), 'utf8'));
check('NO PERSISTENCE, NO SCHEMA: the Prisma schema and all 43 migration directories mention no shadow policy observation; no migration was added', !/shadowPolicy|ShadowPolicy/.test(read('apps/web/prisma/schema.prisma')) && migrationSql.length === 43 && migrationSql.every((s) => !/ShadowPolicy/.test(s)));
check('UPSTREAM UNTOUCHED: the generator and the predicate never name the composition, and dayConstructor.ts still exports exactly the comparator, `constructDay` and `constructDayWithTrace`', !/shadowPolicyObservation|observeShadowPolicy/.test(src(GEN) + src(ACCEPT_MOD) + src(PREP) + src(ORCH)) && JSON.stringify(Array.from(src(CONSTRUCTOR).matchAll(/^export function (\w+)/gm)).map((x) => x[1])) === JSON.stringify(['compareCandidatesForPlacement', 'constructDay', 'constructDayWithTrace']));
const dateGuard = read('test/schedulingDateMutatorArchitecture.test.ts');
check('#208 SCOPE: the composition (which READS Dates and emits ISO strings only) is on the protected Date-mutator list', dateGuard.includes(`file: '${SHADOW}'`));
const ci = read('.github/workflows/ci.yml');
check('REQUIRED CI: the P4b4 behavior and architecture suites are mandatory steps in the pure job', ['shadowPolicyObservation.test.ts', 'shadowPolicyObservationArchitecture.test.ts'].every((t) => ci.includes(`npx ts-node test/${t}`)));
const acceptTest = read('test/counterfactualAcceptance.test.ts');
check('P4b3 TIMING-FLOOR GRID DEBT IS COMMITTED AND CANNOT BE REMOVED: the behavior suite pins the 50-cell baseline-fit x relocated-fit x direction grid and the same-fit start-independence fixtures; the architecture suite pins the constant comparator shell (candidateOrder 0, fixed instants)', /TIMING-FLOOR GRID \(committed\)/.test(acceptTest) && /SAME-FIT START INDEPENDENCE \(pinned\)/.test(acceptTest) && /baseline GOOD @ 15:00 relocated to GOOD @ 09:00/.test(acceptTest) && /const shell = \(timingFit: PlacementTimingFit \| undefined\): PlacementCandidate => \(\{ intentId: 'x', start: new Date\(0\), end: new Date\(1\), timingFit, candidateOrder: 0 \}\);/.test(src(ACCEPT_MOD)) && /A2:timing-floor-candidate-shell-changed/.test(read('test/counterfactualAcceptanceArchitecture.test.ts')));

console.log('=== SAME RUN by construction; one observation per PromotionInput; the composition decides nothing ===');
const mod = src(SHADOW);
check('THE ONLY SEAM IS (request, deps): `observeShadowPolicy` runs the orchestration boundary exactly once (one `await`, one `async`) and no function that accepts a basis, placements, a PromotionInput, a pair, a run or a counterfactual is exported -- the four P4b3 authorities cannot be supplied independently', !flags(audit(real), 'B3:the-seam') && !flags(audit(real), 'B3:not-exactly-one') && !flags(audit(real), 'B3:exports-changed') && !flags(audit(real), 'B3:exported-function'));
check('IMPORTS: exactly five -- the orchestration boundary, the generator and the predicate as the only VALUE imports; request / deps / result, the LocalCounterfactual, reason and timing-fit contracts as TYPES', !flags(audit(real), 'B3:imports-are-not'));
check('GENERATOR / PREDICATE USE: one generator call site and one predicate call site; the generator receives exactly the run-level basis, placements and attempts plus ITS OWN pair; the predicate exactly the run-level basis and placements, the pair\'s PromotionInput and the generated counterfactual; the predicate is gated on a READY generation', !flags(audit(real), 'B4:'));
check('ONE OBSERVATION PER PROMOTION from its own typed pair, in source order: one `.map` over `run.promotions`, no index access or zipping, no loop, early stop, sort, filter, selection or ranking (nothing stops at, picks or ranks an ACCEPT)', !flags(audit(real), 'B3:observations-are') && !flags(audit(real), 'B6:'));
check('LAYERS AND REASONS: GENERATION_UNAVAILABLE / ACCEPTANCE_UNAVAILABLE / REJECT / ACCEPT, each carrying the exact source reason (no translation, no competing vocabulary); the run level is explicit (UNAVAILABLE { RUN_NOT_READY | PREPARATION_FAILED | OBSERVATION_FAILED }, or READY { observations }) and the Constructor result is passed through untouched', !flags(audit(real), 'B5:') && !flags(audit(real), 'B3:result-is') && !flags(audit(real), 'B3:run-level'));
check('NO POLICY, NO SECOND RUN: no pressure, timing-rank, importance, deadline, originalOrder, scoring or ranking; no second orchestration, derivation, projection, Constructor call, load, query or timing search; no baseline read or replacement; no signing, persistence, logging, environment or randomness; no raw trace, evidence, facts or candidate history', !flags(audit(real), 'B7:'));
check('OUTPUT OWNERSHIP: every output is frozen; instants are ISO strings (no Date is constructed or exposed); the summary is exactly { promoted, displacedOwnerIds, relocatedOwners, unplacedOwnerIds, baselinePlacementCount, counterfactualPlacementCount } -- no authority, schedule copy or trace', !flags(audit(real), 'B8:'));
check('FAILURE ISOLATION: each pair is guarded and degrades to ITS OWN unavailable outcome with the existing reason of the failing stage; a run-level failure is a distinct OBSERVATION_FAILED; no shadow failure can abort or alter the returned result', !flags(audit(real), 'B9:'));
check('NO OFF | SHADOW | ACTIVE SWITCH, flag or environment exists in this slice, and nothing is wired into Plan Day', !/featureFlag|isFeatureEnabled|process\.env|\bmode\b|\bACTIVE\b|\bOFF\b/.test(mod));

console.log('=== MUTATIONS: each violation, injected into an in-memory copy, is detected ===');
const GEN_LINE = `    const generated = ${GEN_CALL};`;
check('MUTATION: a SECOND ORCHESTRATION / second search / reload of evidence, facts, durations or availability / a second pressure derivation -> detected', flags(auditM(SHADOW, (s) => `${s}\nexport const x = (r: never, d: never) => preparePromotionInputs(r, d);`), 'B3:not-exactly-one-orchestration', SHADOW) && flags(auditM(SHADOW, (s) => `${s}\nconst y = () => orchestrateConstructDay({} as never, {} as never);`), 'B7:second-orchestration', SHADOW) && flags(auditM(SHADOW, (s) => `${s}\nconst z = () => searchTiming({});`), 'B7:timing-search', SHADOW) && flags(auditM(SHADOW, (s) => `${s}\nconst l = (d: { loadDurationContext: () => void }) => d.loadDurationContext();`), 'B7:database-query-load', SHADOW) && flags(auditM(SHADOW, (s) => `${s}\nconst p = (e: never) => deriveDecisionPressure(e);`), 'B7:second-orchestration', SHADOW) && flags(auditM(SHADOW, (s) => `${s}\nconst f = (d: { prepareDecisionFacts: () => void }) => d.prepareDecisionFacts();`), 'B7:database-query-load', SHADOW) && flags(auditM(SHADOW, (s) => `${s}\nconst e = (m: Map<string, string>) => m.get('evidenceByIntentId');`), 'B7:raw-trace-evidence', SHADOW));
check('MUTATION: an INDEPENDENT AUTHORITY API (an exported function taking a basis / placements / PromotionInput / counterfactual / run) -> detected', flags(auditM(SHADOW, (s) => `${s}\nexport function observeFrom(counterfactual: LocalCounterfactual) { return counterfactual; }`), 'B3:exports-changed', SHADOW) && flags(auditM(SHADOW, (s) => `${s}\nexport function observeRun(run: PromotionRunAuthority) { return run; }`), 'B3:exported-function-accepts-an-authority', SHADOW) && flags(auditM(SHADOW, rep('function compose(run: PreparedRun)', 'export function compose(run: PreparedRun)')), 'B3:exports-changed', SHADOW) && flags(auditM(SHADOW, rep('export async function observeShadowPolicy(request: ConstructDayRequest, deps: DayConstructorOrchestratorDeps)', 'export async function observeShadowPolicy(request: ConstructDayRequest, deps: DayConstructorOrchestratorDeps, extra?: unknown)')), 'B3:the-seam-is-not', SHADOW));
check('MUTATION: FIRST ACCEPT ONLY / STOP AFTER ACCEPT / RANK ACCEPTS / SELECT A WINNER (a loop with break, a sort, a filter, a selection field) -> detected', flags(auditM(SHADOW, rep('run.promotions.map((pair) => observePair(run, pair))', 'run.promotions.map((pair) => observePair(run, pair)).filter((o) => o.outcome === \'ACCEPT\').slice(0, 1)')), 'B6:loop-sort-filter', SHADOW) && flags(auditM(SHADOW, rep('run.promotions.map((pair) => observePair(run, pair))', '[...run.promotions].sort(() => 0).map((pair) => observePair(run, pair))')), 'B6:loop-sort-filter', SHADOW) && flags(auditM(SHADOW, (s) => `${s}\nfunction firstAccept(os: readonly ShadowPolicyObservation[]) { for (const o of os) { if (o.outcome === 'ACCEPT') break; } }`), 'B6:loop-sort-filter', SHADOW) && flags(auditM(SHADOW, (s) => `${s}\nexport const winner = 1;`), 'B6:selection-vocabulary', SHADOW));
check('MUTATION: ZIP BY INDEX / parallel arrays / cross-candidate authority (pairing a counterfactual with another candidate\'s input) -> detected', flags(auditM(SHADOW, rep('run.promotions.map((pair) => observePair(run, pair))', 'run.promotions.map((pair, i) => observePair(run, run.promotions[i]))')), 'B6:index-access', SHADOW) && flags(auditM(SHADOW, rep('input: pair.input, contention: pair.contention })', 'input: run.promotions[0].input, contention: pair.contention })')), 'B4:generator-arguments', SHADOW) && flags(auditM(SHADOW, rep('promotionInput: pair.input, counterfactual', 'promotionInput: run.promotions[0].input, counterfactual')), 'B4:predicate-arguments', SHADOW));
check('MUTATION: SHARED BASELINE broken (a later observation consumes an earlier counterfactual as its baseline: the generator is handed anything but the run-level authorities) -> detected', flags(auditM(SHADOW, rep('baselinePlacements: run.baselinePlacements, schedulingAttempts', 'baselinePlacements: previous.baselinePlacements, schedulingAttempts')), 'B4:generator-arguments', SHADOW) && flags(auditM(SHADOW, rep('constructionBasis: run.constructionBasis, baselinePlacements: run.baselinePlacements, promotionInput', 'constructionBasis: run.constructionBasis, baselinePlacements: generated.counterfactual, promotionInput')), 'B4:predicate-arguments', SHADOW));
check('MUTATION: the predicate is called WITHOUT a READY generation, twice, or the generator more than once -> detected', flags(auditM(SHADOW, rep(`if (generated.status !== 'READY') return Object.freeze({ outcome: 'GENERATION_UNAVAILABLE', candidateIntentId, reason: generated.reason });`, '')), 'B4:predicate-is-not-gated', SHADOW) && flags(auditM(SHADOW, (s) => `${s}\nconst again = () => evaluateCounterfactualAcceptance({} as never);`), 'B4:not-exactly-one', SHADOW) && flags(auditM(SHADOW, (s) => `${s}\nconst again = () => generateLocalCounterfactual({} as never);`), 'B4:not-exactly-one', SHADOW));
check('MUTATION: POLICY IN P4b4 (reading pressure, timing rank, importance, deadline or originalOrder to decide; a shadow-specific ACCEPT / REJECT rule or translated reason) -> detected', flags(auditM(SHADOW, (s) => `${s}\nconst a = (p: { pressure: string }) => p.pressure === 'NONE';`), 'B7:policy-input', SHADOW) && flags(auditM(SHADOW, (s) => `${s}\nconst b = (x: { importance: string }) => x.importance;`), 'B7:policy-input', SHADOW) && flags(auditM(SHADOW, (s) => `${s}\nimport { compareCandidatesForPlacement as c } from './dayConstructor';`), 'B7:policy-input', SHADOW) && flags(auditM(SHADOW, (s) => `${s}\nconst r = 'OWNER_WOULD_BE_UNPLACED';`), 'B5:competing', SHADOW) && flags(auditM(SHADOW, rep("if (acceptance.status === 'REJECT') return", "if (acceptance.status === 'REJECT' && false) return")), 'B5:accept-or-reject', SHADOW) && flags(auditM(SHADOW, rep('reason: generated.reason', "reason: 'GENERATION_FAILED'")), 'B5:source-reasons', SHADOW));
check('MUTATION: COLLAPSE UNAVAILABLE / DROP A REJECT REASON (the layers merged, a reason dropped from the observation, a new outcome added) -> detected', flags(auditM(SHADOW, (s) => s.split("outcome: 'ACCEPTANCE_UNAVAILABLE'").join("outcome: 'GENERATION_UNAVAILABLE'")), 'B5:outcome-taxonomy', SHADOW) && flags(auditM(SHADOW, rep("outcome: 'REJECT', candidateIntentId, reason: acceptance.reason, counterfactual", "outcome: 'REJECT', candidateIntentId, counterfactual")), 'B5:source-reasons', SHADOW) && flags(auditM(SHADOW, (s) => `${s}\nconst o = { outcome: 'APPLIED' };`), 'B5:outcome-taxonomy', SHADOW));
check('MUTATION: APPLY / SIGN / PERSIST an ACCEPT, replace the returned result, read the baseline schedule -> detected', flags(auditM(SHADOW, rep('result: prepared.result, shadowPolicy: compose(prepared.run)', 'result: compose(prepared.run) as never, shadowPolicy: compose(prepared.run)')), 'B3:result-is-not-passed-through', SHADOW) && flags(auditM(SHADOW, (s) => `${s}\nconst applied = (r: { preview: { constructedDay: unknown } }) => r.preview.constructedDay;`), 'B7:reads-or-replaces-the-baseline', SHADOW) && flags(auditM(SHADOW, (s) => `${s}\nconst sig = () => signPreviewResultBody('u', {});`), 'B7:logging-environment-signing', SHADOW) && flags(auditM(SHADOW, (s) => `${s}\nconst w = () => prisma.plan.create({});`), 'B7:database', SHADOW) && flags(auditM(SHADOW, (s) => `${s}\nconst l = () => console.log('observation');`), 'B7:logging-environment-signing', SHADOW));
check('MUTATION: DB / clock / randomness / environment / async fan-out -> detected', flags(auditM(SHADOW, (s) => `${s}\nconst q = () => pool.query('SELECT 1');`), 'B7:database', SHADOW) && flags(auditM(SHADOW, (s) => `${s}\nconst t = () => Date.now();`), 'B7:clock-read', SHADOW) && flags(auditM(SHADOW, (s) => `${s}\nconst d = () => new Date();`), 'B7:clock-read', SHADOW) && flags(auditM(SHADOW, (s) => `${s}\nconst r = () => Math.random();`), 'B7:logging-environment', SHADOW) && flags(auditM(SHADOW, (s) => `${s}\nconst e = process.env.X;`), 'B7:logging-environment', SHADOW) && flags(auditM(SHADOW, (s) => `${s}\nconst a = async () => 1;`), 'B3:not-exactly-one-orchestration', SHADOW));
check('MUTATION: INPUT MUTATION / SHARED OUTPUT / UNFROZEN OUTPUT / exposed Dates / authority dump -> detected', flags(auditM(SHADOW, (s) => `${s}\nconst m = (cf: { displacedOwnerIds: string[] }) => { cf.displacedOwnerIds.push('x'); };`), 'B6:loop-sort-filter', SHADOW) && flags(auditM(SHADOW, rep('return Object.freeze(placement.timingFit === undefined ? slot : { ...slot, timingFit: placement.timingFit });', 'return placement.timingFit === undefined ? slot : { ...slot, timingFit: placement.timingFit };')), 'B8:an-output-is-not-frozen', SHADOW) && flags(auditM(SHADOW, rep("? Object.freeze({ outcome: 'GENERATION_UNAVAILABLE', candidateIntentId, reason: 'GENERATION_FAILED' })", "? { outcome: 'GENERATION_UNAVAILABLE', candidateIntentId, reason: 'GENERATION_FAILED' }")), 'B8:an-output-is-not-frozen', SHADOW) && flags(auditM(SHADOW, rep('const slot = { start: placement.start.toISOString(), end: placement.end.toISOString() };', 'const slot = { start: placement.start.toISOString(), end: placement.end.toISOString(), start0: placement.start.toISOString() };')), 'B8:instants-are-not-iso-scalars', SHADOW) && flags(auditM(SHADOW, rep('baselinePlacementCount: baseline.length,', 'baselinePlacementCount: baseline.length,\n    constructionBasis: run.constructionBasis,')), 'B8:summary-is-not-the-minimal', SHADOW));
check('MUTATION: a PRODUCTION CONSUMER / public wiring / a route, preview or persistence surface naming the composition -> detected', flags(audit(addFile(real, 'apps/web/lib/rogueConsumer.ts', "import { observeShadowPolicy } from './shadowPolicyObservation';\nexport const e = observeShadowPolicy;")), 'B1:production-consumer-of-the-composition', 'apps/web/lib/rogueConsumer.ts') && ['apps/web/lib/dayConstructorPreviewRequest.ts', 'apps/web/lib/dayConstructorPreviewIntegrity.ts', 'apps/web/lib/dayConstructorAcceptance.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts', 'apps/web/app/api/day-constructor/preview/route.ts', 'apps/web/app/api/day-constructor/accept/route.ts', 'apps/web/lib/db.ts', GEN, ACCEPT_MOD, PREP, ORCH, CONSTRUCTOR].every((f) => flags(auditM(f, (s) => `${s}\nexport const p = 'ShadowPolicyRun';`), 'B1:', f)));
check('MUTATION: another caller of the orchestration boundary, the generator or the predicate -> detected', flags(audit(addFile(real, 'apps/web/lib/rogue1.ts', "export const a = () => preparePromotionInputs({} as never, {} as never);")), 'B2:another-boundary-caller', 'apps/web/lib/rogue1.ts') && flags(audit(addFile(real, 'apps/web/lib/rogue2.ts', "export const a = () => generateLocalCounterfactual({} as never);")), 'B2:another-generator-caller', 'apps/web/lib/rogue2.ts') && flags(audit(addFile(real, 'apps/web/lib/rogue3.ts', "export const a = () => evaluateCounterfactualAcceptance({} as never);")), 'B2:another-predicate-caller', 'apps/web/lib/rogue3.ts'));
check('MUTATION: the per-pair isolation is removed, a run-level failure is conflated with a pair failure, the run level swallows a not-READY baseline -> detected', flags(auditM(SHADOW, rep("let stage: 'GENERATION' | 'ACCEPTANCE' = 'GENERATION';", "let stage: 'GENERATION' | 'ACCEPTANCE' = 'ACCEPTANCE';")), 'B9:pair-failure', SHADOW) && flags(auditM(SHADOW, rep("reason: 'OBSERVATION_FAILED'", "reason: 'PREPARATION_FAILED'")), 'B9:run-level-failure', SHADOW) && flags(auditM(SHADOW, rep("if (prepared.run.status !== 'PREPARED') return", "if (prepared.run.status === 'PREPARED' && false) return")), 'B3:run-level-unavailable', SHADOW));
check('the mutations were applied to in-memory copies only: the real tree still has zero violations afterwards', audit(productionFiles()).length === 0);

if (!allPassed) {
  console.error('SOME SHADOW POLICY ARCHITECTURE CHECKS FAILED');
  process.exit(1);
}
console.log('ALL SHADOW POLICY ARCHITECTURE CHECKS PASSED');
