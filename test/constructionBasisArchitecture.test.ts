/**
 * Constructor Decision Intelligence -- O5 P4b1: the IMMUTABLE CONSTRUCTION BASIS (architecture guard, pure).
 *
 * The construction basis is the detached, deeply frozen scheduling authority of ONE baseline Constructor run, captured inside that
 * run so a future bounded counterfactual (P4b2) can re-place a small scope against exactly the baseline's authority. This guard
 * pins that it:
 *
 *   - is produced ONLY inside the existing orchestration run, through the private write-only diagnostics hand-off, at two fixed
 *     points: T1 (the original candidate lists, before replenishment can overwrite them) and T4 (assembly after the last
 *     Constructor pass) -- and only when a diagnostics caller asked, so the normal preview path does no basis work at all
 *   - adds NO Constructor pass, NO timing search, NO loader call, NO clock read and NO database access: one pure module with no
 *     value imports, no `new Date()`, no search / Constructor call, and Date copies only as `new Date(source.getTime())`
 *   - carries only neutral scheduling authority: no pressure, promotion input, owner, facts, evidence, shadow result, feature flag or
 *     source-specific field -- and imports none of those modules
 *   - copies every value (no `any`, no JSON / structuredClone shortcut, no retained source) and freezes every object, array and Date
 *   - is optional and all-or-nothing: assembly and capture never throw out of the module, the orchestrator guards both calls again
 *   - has ZERO consumers: only the orchestrator names it, nothing reads the produced outcome (the shadow and promotion boundaries
 *     ignore it), and it appears in no preview, signing, acceptance, persistence, Recomposition, Move, route or schema surface
 *
 * It does NOT prove a future P4b2 consumer's own working copies are safe. Every rule is a PURE FUNCTION over source files: it runs on
 * the real tree (zero violations) AND on the tree with a synthetic violation injected, proving each rule fires.
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

const MOD = 'apps/web/lib/constructionBasis.ts';
const ORCH = 'apps/web/lib/dayConstructorOrchestrator.ts';
/** The only production files that may name the basis at all. */
/** O5 P4b1b -- the baseline placements module names the basis TYPES only (it validates against the basis; it never writes it). */
const PLACEMENTS_MOD = 'apps/web/lib/baselinePlacements.ts';
/** O5 P4b2a -- the promotion contention authority validates its pairing against the basis (TYPES only), and the internal promotion boundary hands the SAME run's basis outcome to it (one pass-through, never read). */
const CONTENTION_MOD = 'apps/web/lib/promotionContentionAuthority.ts';
const PROMOTION_PREP = 'apps/web/lib/promotionInputPreparation.ts';
const BASIS_NAMING_ALLOW = [MOD, ORCH, PLACEMENTS_MOD, CONTENTION_MOD, PROMOTION_PREP];
const BASIS_IDENT = /\b(ConstructionBasis[A-Za-z]*|assembleConstructionBasis|captureCandidateLists|constructionBasis|optionalBasisStep|initialCandidateLists)\b|constructionBasis['"]/;
const MOD_IMPORTS = [`import type { DayIntent, DayIntentFlexibility, DayIntentImportance, ConstructionWindow } from './dayIntent';`, `import type { FixedPlacementConstraint, PlacementCandidate, PlacementTimingFit } from './dayConstructor';`, `import type { BlockedInterval, BlockedIntervalSource } from './dayCapacity';`];
const POLICY_VOCAB = /DecisionPressure|LAST_KNOWN|PromotionInput|PromotionOwner|DecisionFacts|decisionFacts|DecisionEvidence|decisionEvidence|GoalDecisionFacts|shadow|abovePressure|ContentionTrace|recurrence|opportunity|featureFlag|isFeatureEnabled|process\.env|\benv\b/i;
const SOURCE_VOCAB = /\bgoal|manual|automatic|provenance|hand-?off|rhythm|demand|\bUI\b/i;
const DB_VOCAB = /from '\.\/db'|\bpool\b|\.query\(|beginTransaction|withRepeatableReadSnapshot|prisma|INSERT|UPDATE|DELETE/;
const CLOCK_VOCAB = /Date\.now|new Date\(\)|performance\.now|hrtime|\bnew Date\(\s*\)/;
const SEARCH_VOCAB = /searchTiming|runTimingSearch|timingSearch|excludedIntervals|replenish/i;
const CONSTRUCT_VOCAB = /\bconstructDay\w*\(|orchestrate\w*\(|\bsortByOverloadPrecedence\b|compareByOverloadPrecedence/;
const ASYNC_VOCAB = /\basync\b|\bawait\b|Promise|setTimeout|setInterval|console\.|logger|telemetry|fetch\(/;
const CLONE_SHORTCUT = /JSON\.(parse|stringify)|structuredClone|Object\.assign|deepFreeze|lodash/;
/** Every surface that must never carry or read the basis. */
const NEVER_BASIS = [
  'apps/web/lib/dayConstructor.ts', 'apps/web/lib/dayIntent.ts', 'apps/web/lib/dayCapacity.ts', 'apps/web/lib/contentionTrace.ts', 'apps/web/lib/dayConstructorPreviewRequest.ts',
  'apps/web/lib/dayConstructorPreviewIntegrity.ts', 'apps/web/lib/dayConstructorPreviewClient.ts', 'apps/web/lib/dayConstructorAcceptance.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts',
  'apps/web/lib/remainingDayRecomposition.ts', 'apps/web/lib/remainingDayRecompositionAcceptance.ts', 'apps/web/lib/remainingDayRecompositionIntegrity.ts', 'apps/web/lib/remainingDayRecompositionServer.ts',
  'apps/web/lib/homeRecomposition.ts', 'apps/web/lib/planMove.ts', 'apps/web/lib/homeMove.ts', 'apps/web/lib/dayPlanPreviewPresentation.ts', 'apps/web/lib/dayPlanAcceptancePresentation.ts', 'apps/web/lib/db.ts',
  'apps/web/lib/decisionFacts.ts', 'apps/web/lib/decisionEvidence.ts', 'apps/web/lib/decisionFactPreparation.ts', 'apps/web/lib/decisionPressure.ts', 'apps/web/lib/goalDecisionFactsProvider.ts',
  'apps/web/lib/decisionSchedulingContext.ts', 'apps/web/lib/decisionSchedulingContextLoader.ts', 'apps/web/lib/abovePressurePrecedence.ts', 'apps/web/lib/shadowPressureEvaluation.ts', 'apps/web/lib/shadowPressureObservation.ts',
  'apps/web/lib/promotionInput.ts', 'apps/web/lib/opportunityProjection.ts', 'apps/web/lib/opportunityDecisionFacts.ts',
  'apps/web/app/api/day-constructor/preview/route.ts', 'apps/web/app/api/day-constructor/accept/route.ts', 'apps/web/app/api/day/recompose/route.ts', 'apps/web/app/api/plans/[planId]/move/route.ts', 'apps/web/app/api/plans/route.ts',
];
/** The orchestrator's exact assembly call: every value is the baseline run's own (no clock, no re-resolution). */
const ASSEMBLY_CALL = "optionalBasisStep(() => assembleConstructionBasis({ planningDate: request.targetDate, window, intents: intentsForConstructDay, blockedIntervals, initialCandidates: initialCandidateLists, finalCandidatesByIntentId: candidatesByIntentId, fixedConstraintsByIntentId })) ?? { status: 'UNAVAILABLE', reason: 'ASSEMBLY_FAILED' }";
const CAPTURE_CALL = "const initialCandidateLists = evidenceOut ? optionalBasisStep(() => captureCandidateLists(request.intents.map((requested) => requested.id), candidatesByIntentId)) : undefined;";

function audit(files: SrcFile[]): string[] {
  const v: string[] = [];
  const get = (f: string) => files.find((x) => x.f === f);
  const by = (re: RegExp) => files.filter((x) => re.test(x.src)).map((x) => x.f);
  const notIn = (list: string[], allow: string[]) => list.filter((f) => !allow.includes(f));
  // W1 -- confinement and consumers
  notIn(by(BASIS_IDENT), BASIS_NAMING_ALLOW).forEach((f) => v.push(`W1:names-the-basis:${f}`));
  notIn(by(/from '\.\/constructionBasis'/), [ORCH, PLACEMENTS_MOD, CONTENTION_MOD]).forEach((f) => v.push(`W1:imports-the-basis-module:${f}`));
  for (const f of NEVER_BASIS) { const x = get(f); if (x && /constructionBasis|ConstructionBasis/.test(x.src)) v.push(`W1:surface-names-the-basis:${f}`); }
  // W2 -- the module
  const m = get(MOD);
  if (m) {
    const imports = Array.from(m.src.matchAll(/^import [^\n]*;$/gm)).map((x) => x[0]);
    if (JSON.stringify(imports) !== JSON.stringify(MOD_IMPORTS)) v.push(`W2:imports-are-not-the-reviewed-three-type-imports:${MOD}`);
    if (POLICY_VOCAB.test(m.src)) v.push(`W2:policy-evidence-facts-or-flag-vocabulary:${MOD}`);
    if (SOURCE_VOCAB.test(m.src)) v.push(`W2:source-specific-vocabulary:${MOD}`);
    if (DB_VOCAB.test(m.src)) v.push(`W2:database-access:${MOD}`);
    if (CLOCK_VOCAB.test(m.src)) v.push(`W2:clock-read:${MOD}`);
    if (SEARCH_VOCAB.test(m.src)) v.push(`W2:timing-search-or-replenishment:${MOD}`);
    if (CONSTRUCT_VOCAB.test(m.src)) v.push(`W2:constructor-or-ordering-call:${MOD}`);
    if (ASYNC_VOCAB.test(m.src)) v.push(`W2:async-log-or-network:${MOD}`);
    if (CLONE_SHORTCUT.test(m.src)) v.push(`W2:json-structuredclone-or-generic-clone:${MOD}`);
    if (/\bany\b/.test(m.src)) v.push(`W2:any-escape:${MOD}`);
    if (/\b(Map|WeakMap|WeakSet)\b/.test(m.src) || count(/\bSet\b/g, m.src) !== 1 || !/new Set\(intentIds\)\.size !== intentIds\.length/.test(m.src)) v.push(`W2:mutable-collection-in-the-module:${MOD}`);
    if (count(/new Date\(/g, m.src) !== 1 || !/return Object\.freeze\(new Date\(source\.getTime\(\)\)\);/.test(m.src)) v.push(`W2:date-not-copied-as-a-new-frozen-instance:${MOD}`);
    if (/^(let|var) |^const \w+ = (new |\[|\{)/m.test(m.src)) v.push(`W2:module-level-state:${MOD}`);
    if (count(/Object\.freeze\(/g, m.src) < 14) v.push(`W2:output-not-frozen:${MOD}`);
    if (!/export function captureCandidateLists\([^)]*\): readonly ConstructionBasisCandidateList\[\] \| undefined \{\s*try \{[\s\S]*?\} catch \{\s*return undefined;\s*\}\s*\}/.test(m.src) || !/export function assembleConstructionBasis\(source: ConstructionBasisSource\): ConstructionBasisOutcome \{\s*try \{[\s\S]*\} catch \{\s*return Object\.freeze\(\{ status: 'UNAVAILABLE', reason: 'ASSEMBLY_FAILED' \}\);\s*\}\s*\}/.test(m.src)) v.push(`W2:capture-or-assembly-can-throw-out-of-the-module:${MOD}`);
    if (!/const initialCandidates = Object\.freeze\(\s*source\.initialCandidates\.map\(\(list\) => copyCandidates\(/.test(m.src) || !/finalCandidates: copyCandidateLists\(intentIds, source\.finalCandidatesByIntentId\)/.test(m.src)) v.push(`W2:initial-or-final-candidates-not-separately-copied:${MOD}`);
    if (!/reason: 'DUPLICATE_INTENT_ID'/.test(m.src) || !/source\.initialCandidates === undefined\) return Object\.freeze\(\{ status: 'UNAVAILABLE', reason: 'ASSEMBLY_FAILED' \}\)/.test(m.src)) v.push(`W2:fail-closed-gates-missing:${MOD}`);
    const exportsList = Array.from(m.src.matchAll(/^export (?:async )?(?:function|interface|type|const|class) (\w+)/gm)).map((x) => x[1]);
    if (JSON.stringify(exportsList) !== JSON.stringify(['ConstructionBasisIntent', 'ConstructionBasisWindow', 'ConstructionBasisBlocker', 'ConstructionBasisCandidate', 'ConstructionBasisCandidateList', 'ConstructionBasisFixedConstraint', 'ConstructionBasisFixedEntry', 'ConstructionBasis', 'ConstructionBasisUnavailableReason', 'ConstructionBasisOutcome', 'ConstructionBasisSource', 'captureCandidateLists', 'assembleConstructionBasis'])) v.push(`W2:exports-changed:${MOD}`);
    const basisBody = (m.src.match(/export interface ConstructionBasis \{[\s\S]*?\n\}/) ?? [''])[0];
    if (JSON.stringify(Array.from(basisBody.matchAll(/readonly (\w+):/g)).map((x) => x[1])) !== JSON.stringify(['planningDate', 'window', 'intents', 'blockedIntervals', 'initialCandidates', 'finalCandidates', 'fixedConstraints'])) v.push(`W2:basis-fields-are-not-the-minimum-contract:${MOD}`);
    const intentBody = (m.src.match(/export interface ConstructionBasisIntent \{[\s\S]*?\n\}/) ?? [''])[0];
    if (JSON.stringify(Array.from(intentBody.matchAll(/readonly (\w+)\??:/g)).map((x) => x[1])) !== JSON.stringify(['id', 'title', 'activityId', 'importance', 'deadline', 'estimatedDurationMinutes', 'flexibility', 'originalOrder'])) v.push(`W2:intent-fields-are-not-the-minimum-contract:${MOD}`);
  }
  // W3 -- the orchestrator: produced only inside the run, only when asked, at the two fixed points, never read
  const o = get(ORCH);
  if (o) {
    if (count(/captureCandidateLists\(/g, o.src) !== 1 || count(/assembleConstructionBasis\(/g, o.src) !== 1) v.push(`W3:capture-or-assembly-call-count-changed:${ORCH}`);
    if (!o.src.includes(CAPTURE_CALL)) v.push(`W3:t1-capture-is-not-the-reviewed-guarded-call:${ORCH}`);
    if (!o.src.includes(ASSEMBLY_CALL) || !/if \(evidenceOut\) \{\s*evidenceOut\.constructionBasis =\s*optionalBasisStep/.test(o.src)) v.push(`W3:t4-assembly-is-not-the-reviewed-guarded-call:${ORCH}`);
    if (!/function optionalBasisStep<T>\(step: \(\) => T\): T \| undefined \{\s*try \{\s*return step\(\);\s*\} catch \{\s*return undefined;\s*\}\s*\}/.test(o.src)) v.push(`W3:optional-step-can-throw:${ORCH}`);
    const t1 = o.src.indexOf('const initialCandidateLists');
    if (!(t1 > o.src.indexOf('candidatesByIntentId[dayIntent.id] = normalized;') && t1 < o.src.indexOf('prepareDecisionFactsFailOpen(deps.prepareDecisionFacts') && t1 < o.src.indexOf('constructDay({'))) v.push(`W3:t1-capture-is-not-after-the-initial-searches-and-before-everything-else:${ORCH}`);
    const t4 = o.src.indexOf('evidenceOut.constructionBasis =');
    if (!(t4 > o.src.indexOf('for (let round = 0; round < flexibleIntentCount') && t4 > o.src.lastIndexOf('result = constructDay({') && t4 < o.src.lastIndexOf("status: 'READY',"))) v.push(`W3:t4-assembly-is-not-after-the-last-construction-and-before-the-return:${ORCH}`);
    if (count(/deps\.searchTiming\(/g, o.src) !== 2 || count(/constructDay\(\{/g, o.src) !== 2) v.push(`W3:search-or-construction-call-sites-changed:${ORCH}`);
    if (count(/new Date\(/g, o.src) !== 5) v.push(`W3:clock-or-date-allocation-count-changed:${ORCH}`);
    if (count(/constructionBasis/g, o.src) !== 7 || count(/\.constructionBasis\b/g, o.src) !== 3) v.push(`W3:basis-is-read-or-referenced-beyond-the-write-only-hand-off:${ORCH}`);
    if (!/export async function orchestrateConstructDay\(request: ConstructDayRequest, deps: DayConstructorOrchestratorDeps\): Promise<OrchestrateConstructDayResult> \{\s*return runOrchestration\(request, deps, constructDay\);/.test(o.src)) v.push(`W3:normal-entry-point-changed:${ORCH}`);
    const normalAndTrace = (o.src.match(/export async function orchestrateConstructDay\([\s\S]*?\n\}\n/) ?? [''])[0] + (o.src.match(/export async function orchestrateConstructDayWithTrace\([\s\S]*?\n\}\n/) ?? [''])[0];
    if (/asis/.test(normalAndTrace)) v.push(`W3:normal-or-trace-entry-names-the-basis:${ORCH}`);
  }
  // W4 -- nothing downstream reads the produced outcome
  for (const f of ['apps/web/lib/shadowPressureObservation.ts']) { const x = get(f); if (x && /constructionBasis/.test(x.src)) v.push(`W4:diagnostics-consumer-reads-the-basis:${f}`); }
  // O5 P4b2a: the promotion boundary may only PASS the outcome through, as the one fixed argument of the contention authority hand-over.
  { const x = get(PROMOTION_PREP); if (x && ((x.src.match(/\bconstructionBasis\b/g) ?? []).length !== 1 || !/contentionFor\(diagnostics\.contentionTrace, input, diagnostics\.constructionBasis, diagnostics\.baselinePlacements\)/.test(x.src))) v.push(`W4:diagnostics-consumer-reads-the-basis:${PROMOTION_PREP}`); }
  notIn(by(/\borchestrateConstructDayWithDiagnostics\(/), [ORCH, 'apps/web/lib/shadowPressureObservation.ts', 'apps/web/lib/promotionInputPreparation.ts']).forEach((f) => v.push(`W4:new-caller-of-the-diagnostics-entry-point:${f}`));
  return v;
}
const real = productionFiles();
const src = (f: string) => real.find((x) => x.f === f)!.src;
const mutateFile = (files: SrcFile[], f: string, fn: (s: string) => string): SrcFile[] => files.map((x) => (x.f === f ? { f, src: fn(x.src) } : x));
const addFile = (files: SrcFile[], f: string, s: string): SrcFile[] => [...files, { f, src: s }];
const flags = (violations: string[], prefix: string, file?: string) => violations.some((x) => x.startsWith(prefix) && (file === undefined || x.endsWith(`:${file}`)));
const names = (re: RegExp) => real.filter((x) => re.test(x.src)).map((x) => x.f);
const auditM = (f: string, fn: (s: string) => string) => audit(mutateFile(real, f, fn));

console.log('=== the real tree conforms ===');
const baseline = audit(real);
check(`THE REAL PRODUCTION TREE HAS ZERO CONSTRUCTION-BASIS ARCHITECTURE VIOLATIONS (${real.length} production files scanned)${baseline.length ? ': ' + baseline.join(', ') : ''}`, baseline.length === 0);

console.log('=== confinement, producer and zero consumers ===');
const mod = src(MOD); const orch = src(ORCH);
check('THE BASIS VOCABULARY EXISTS IN EXACTLY FIVE PRODUCTION FILES: the pure module, the orchestrator that produces it, (TYPES only) the baseline placements module and the promotion contention authority that validate against it, and the internal promotion boundary that hands the same-run outcome to the latter', JSON.stringify(names(BASIS_IDENT)) === JSON.stringify([...BASIS_NAMING_ALLOW].sort()) && JSON.stringify(names(/from '\.\/constructionBasis'/)) === JSON.stringify([ORCH, PLACEMENTS_MOD, CONTENTION_MOD].sort()) && !/^import (?!type )[^\n]*from '\.\/constructionBasis'/m.test(src(PLACEMENTS_MOD) + src(CONTENTION_MOD)));
check('PRODUCER: the basis is produced only INSIDE the orchestration run -- one T1 capture and one T4 assembly, both through the private hand-off that only a diagnostics caller creates; the normal `orchestrateConstructDay` and the trace entry never name it, so the preview path does no basis work', count(/captureCandidateLists\(/g, orch) === 1 && count(/assembleConstructionBasis\(/g, orch) === 1 && /evidenceOut \? optionalBasisStep/.test(orch) && /if \(evidenceOut\) \{\s*evidenceOut\.constructionBasis =/.test(orch) && /return runOrchestration\(request, deps, constructDay\);/.test(orch));
check('NO CALLER CAN MANUFACTURE A BASIS: the hand-off is a module-private interface, the only constructors are the orchestrator\'s own calls, and `orchestrateConstructDayWithDiagnostics` takes only (request, deps) -- there is no parameter that could carry a basis in', /^interface EvidenceHandOff \{/m.test(orch) && !/export interface EvidenceHandOff/.test(orch) && /export async function orchestrateConstructDayWithDiagnostics\(\s*request: ConstructDayRequest,\s*deps: DayConstructorOrchestratorDeps\s*\): Promise</.test(orch));
check('ZERO CONSUMERS: nothing reads the produced outcome -- the orchestrator only writes `evidenceOut.constructionBasis` and returns `handOff.constructionBasis`; the shadow boundary never mentions it, and the promotion boundary only PASSES the same-run outcome to the contention authority (one `diagnostics.constructionBasis` argument, never read); no other production file names it', count(/\.constructionBasis\b/g, orch) === 3 && !/constructionBasis/.test(src('apps/web/lib/shadowPressureObservation.ts')) && count(/\bconstructionBasis\b/g, src(PROMOTION_PREP)) === 1 && /contentionFor\(diagnostics\.contentionTrace, input, diagnostics\.constructionBasis, diagnostics\.baselinePlacements\)/.test(src(PROMOTION_PREP)) && JSON.stringify(names(/\borchestrateConstructDayWithDiagnostics\(/)) === JSON.stringify([ORCH, 'apps/web/lib/promotionInputPreparation.ts', 'apps/web/lib/shadowPressureObservation.ts']));
check('NO PUBLIC / SIGNED / PERSISTED EXPOSURE: the Constructor, comparator, capacity, preview request / client / integrity, acceptance, persistence, Recomposition, Move, every route, db.ts and every Decision Intelligence module are free of the basis vocabulary', NEVER_BASIS.every((f) => !/constructionBasis|ConstructionBasis/.test(src(f))));
const migrationSql = fs.readdirSync(path.join(root, 'apps/web/prisma/migrations'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => fs.readFileSync(path.join(root, 'apps/web/prisma/migrations', e.name, 'migration.sql'), 'utf8'));
check('NO PERSISTENCE, NO SCHEMA: the Prisma schema and all 43 migration directories mention no construction basis; no migration was added', !/constructionBasis/i.test(read('apps/web/prisma/schema.prisma')) && migrationSql.length === 43 && migrationSql.every((s) => !/constructionBasis/i.test(s)));
check('THE CONSTRUCTOR IS UNTOUCHED AND UNREAD: dayConstructor.ts (hash-pinned by the P0c guard) and the comparator file name no basis; the capture lives entirely at the orchestration boundary', !/constructionBasis|ConstructionBasis/.test(src('apps/web/lib/dayConstructor.ts') + src('apps/web/lib/dayIntent.ts')));

console.log('=== the orchestrator change: two fixed points, nothing added to construction ===');
check('T1 -- the initial lists are captured AFTER the original per-intent timing searches and BEFORE evidence preparation, the first Constructor pass and every replenishment (so replenishment cannot have overwritten them); no search is repeated to recover them', orch.indexOf(CAPTURE_CALL) > orch.indexOf('candidatesByIntentId[dayIntent.id] = normalized;') && orch.indexOf(CAPTURE_CALL) < orch.indexOf('prepareDecisionFactsFailOpen(deps.prepareDecisionFacts') && orch.indexOf(CAPTURE_CALL) < orch.indexOf('constructDay({'));
check('T3 / T4 -- the basis is assembled AFTER the replenishment loop and the last Constructor pass, from the orchestrator\'s own terminal candidate map, and BEFORE the READY return; every argument is the baseline run\'s own value (the request\'s target date, the resolved window, the blockers it built, the fixed constraints it built) -- no clock, no re-resolution', orch.includes(ASSEMBLY_CALL) && orch.indexOf('evidenceOut.constructionBasis =') > orch.indexOf('for (let round = 0; round < flexibleIntentCount') && orch.indexOf('evidenceOut.constructionBasis =') > orch.lastIndexOf('result = constructDay({') && orch.indexOf('evidenceOut.constructionBasis =') < orch.lastIndexOf("status: 'READY',"));
check('NOTHING ELSE CHANGED IN CONSTRUCTION: still exactly two `constructDay({` call sites, two `deps.searchTiming(` call sites (the initial search and the replenishment search), the same five `new Date(` allocations (no clock was added), and the replenishment loop is intact', count(/constructDay\(\{/g, orch) === 2 && count(/deps\.searchTiming\(/g, orch) === 2 && count(/new Date\(/g, orch) === 5 && /for \(let round = 0; round < flexibleIntentCount; round \+= 1\)/.test(orch));
check('OPTIONAL BY CONSTRUCTION: both basis calls run inside `optionalBasisStep`, whose catch swallows everything, so a failure can never fail the baseline; the assembly result falls back to UNAVAILABLE / ASSEMBLY_FAILED, never a partial basis', /function optionalBasisStep<T>\(step: \(\) => T\): T \| undefined \{\s*try \{\s*return step\(\);\s*\} catch \{\s*return undefined;\s*\}\s*\}/.test(orch) && orch.includes(ASSEMBLY_CALL) && orch.includes(CAPTURE_CALL));
check('the diagnostics entry reports a basis for every run: the produced outcome, or UNAVAILABLE / RUN_NOT_READY when the run ended before T4', /constructionBasis: handOff\.constructionBasis \?\? \{ status: 'UNAVAILABLE', reason: 'RUN_NOT_READY' \}/.test(orch));

console.log('=== the module: pure, neutral, copying, frozen, fail-closed ===');
check('IMPORTS: exactly three TYPE imports (DayIntent / ConstructionWindow, the placement types, the blocker types) -- no value import of anything, so no database, search, Constructor, clock, evidence, facts, pressure or promotion module can be reached', JSON.stringify(Array.from(mod.matchAll(/^import [^\n]*;$/gm)).map((x) => x[0])) === JSON.stringify(MOD_IMPORTS) && !/^import (?!type )/m.test(mod));
check('NO POLICY, NO EVIDENCE, NO FACTS, NO FLAG, NO SOURCE: the module names no DecisionPressure, PromotionInput / Owner, DecisionFacts, DecisionEvidence, GoalDecisionFacts, shadow result, contention trace, recurrence / opportunity field, feature flag or environment, and no Goal / manual / automatic / provenance concept', !POLICY_VOCAB.test(mod) && !SOURCE_VOCAB.test(mod));
check('NO DB, NO CLOCK, NO SEARCH, NO CONSTRUCTION, NO I/O: no database, `Date.now`, `new Date()`, timing search, replenishment, Constructor / orchestrator / ordering call, async, await, Promise, timer, logging, telemetry or network', !DB_VOCAB.test(mod) && !CLOCK_VOCAB.test(mod) && !SEARCH_VOCAB.test(mod) && !CONSTRUCT_VOCAB.test(mod) && !ASYNC_VOCAB.test(mod));
check('COPYING IS EXPLICIT AND DOMAIN-SPECIFIC: no `any`, no JSON round-trip, no structuredClone, no Object.assign, no generic deepFreeze; the ONLY Date allocation is `new Date(source.getTime())` inside `ownDate`, which freezes it (an invalid source stays invalid; a non-Date throws and makes the basis unavailable)', !/\bany\b/.test(mod) && !CLONE_SHORTCUT.test(mod) && count(/new Date\(/g, mod) === 1 && /return Object\.freeze\(new Date\(source\.getTime\(\)\)\);/.test(mod));
check('NO MUTABLE COLLECTION AND NO STATE: no Map / WeakMap / WeakSet; the single `Set` is the local duplicate-id check; no module-level variable can retain a source object', !/\b(Map|WeakMap|WeakSet)\b/.test(mod) && count(/\bSet\b/g, mod) === 1 && !/^(let|var) |^const \w+ = (new |\[|\{)/m.test(mod));
check('EVERYTHING IS FROZEN: every constructed object, array, candidate, interval, intent and Date is passed through `Object.freeze` at creation (>= 14 freeze sites) -- freezing is NOT claimed to protect a Date\'s time value, which rests on ownership plus the #208 guard', count(/Object\.freeze\(/g, mod) >= 14);
check('INITIAL AND FINAL ARE SEPARATE COPIES: the initial lists are re-copied from the T1 capture and the final lists are copied from the orchestrator\'s terminal map -- two independent copies, so no object is shared between them or with the source', /const initialCandidates = Object\.freeze\(\s*source\.initialCandidates\.map\(\(list\) => copyCandidates\(/.test(mod) && /finalCandidates: copyCandidateLists\(intentIds, source\.finalCandidatesByIntentId\)/.test(mod));
check('ALL-OR-NOTHING AND NEVER THROWING: capture returns undefined, assembly returns UNAVAILABLE / ASSEMBLY_FAILED on any failure; duplicate intent ids and a missing T1 capture are explicit UNAVAILABLE gates; there is no partially filled outcome', !flags(audit(real), 'W2:capture-or-assembly-can-throw-out-of-the-module') && !flags(audit(real), 'W2:fail-closed-gates-missing'));
check('THE MINIMUM CONTRACT (derived from ConstructDayInput): the basis has exactly planningDate, window, intents, blockedIntervals, initialCandidates, finalCandidates, fixedConstraints; an intent has exactly id, title, activityId?, importance, deadline?, estimatedDurationMinutes?, flexibility, originalOrder -- no facts, family, DayIntent source or `now`', !flags(audit(real), 'W2:basis-fields-are-not-the-minimum-contract') && !flags(audit(real), 'W2:intent-fields-are-not-the-minimum-contract'));
check('the module exports exactly its contract types and the two functions -- nothing else is reachable', !flags(audit(real), 'W2:exports-changed'));

console.log('=== MUTATIONS OF THE GUARD: each violation class, injected into the real tree, is detected ===');
check('MUTATION: a pressure / promotion-input / owner / facts / evidence / shadow / feature-flag field or import enters the basis module -> detected', ['DecisionPressure', 'PromotionInput', 'PromotionOwner', 'DecisionFacts', 'DecisionEvidence', 'GoalDecisionFacts', 'shadowResult', 'featureFlag'].every((w) => flags(auditM(MOD, (s) => `${s}\nexport type Leak = ${w};\n`), 'W2:policy-evidence-facts-or-flag-vocabulary', MOD)) && flags(auditM(MOD, (s) => `import type { DecisionPressure } from './decisionPressure';\n${s}`), 'W2:imports-are-not-the-reviewed-three-type-imports', MOD));
check('MUTATION: a source-specific field (Goal / manual / automatic / provenance) enters the module -> detected', flags(auditM(MOD, (s) => `${s}\nexport const x = (goalId: string) => goalId;\n`), 'W2:source-specific-vocabulary', MOD));
check('MUTATION: a clock read, a database import / query, a timing search, a second Constructor call, an async boundary -> detected', flags(auditM(MOD, (s) => `${s}\nexport const c = () => Date.now();\n`), 'W2:clock-read', MOD) && flags(auditM(MOD, (s) => `${s}\nexport const c = () => new Date();\n`), 'W2:clock-read', MOD) && flags(auditM(MOD, (s) => `import { listHabitLogs } from './db';\n${s}`), 'W2:database-access', MOD) && flags(auditM(MOD, (s) => `${s}\nexport const c = (r: never) => runTimingSearch(r);\n`), 'W2:timing-search-or-replenishment', MOD) && flags(auditM(MOD, (s) => `${s}\nexport const c = (i: never) => constructDay(i);\n`), 'W2:constructor-or-ordering-call', MOD) && flags(auditM(MOD, (s) => `${s}\nexport const c = async () => 1;\n`), 'W2:async-log-or-network', MOD));
check('MUTATION: shared Date (the copy returns the source), JSON clone, `any`, a Map, module-level state -> detected', flags(auditM(MOD, (s) => s.replace('return Object.freeze(new Date(source.getTime()));', 'return source;')), 'W2:date-not-copied-as-a-new-frozen-instance', MOD) && flags(auditM(MOD, (s) => `${s}\nexport const c = (x: ConstructionBasis) => JSON.parse(JSON.stringify(x));\n`), 'W2:json-structuredclone-or-generic-clone', MOD) && flags(auditM(MOD, (s) => `${s}\nexport const c = (x: any) => x;\n`), 'W2:any-escape', MOD) && flags(auditM(MOD, (s) => `${s}\nexport const c = new Map<string, number>();\n`), 'W2:mutable-collection-in-the-module', MOD) && flags(auditM(MOD, (s) => `let retained: unknown;\n${s}`), 'W2:module-level-state', MOD));
check('MUTATION: unfrozen outer / nested output (the freeze removed everywhere, or from the outer basis and Dates only) -> detected', flags(auditM(MOD, (s) => s.split('Object.freeze(').join('(')), 'W2:output-not-frozen', MOD) && flags(auditM(MOD, (s) => s.replace('return Object.freeze(new Date(source.getTime()));', 'return new Date(source.getTime());').replace("return Object.freeze({ status: 'READY', basis });", "return { status: 'READY', basis };")), 'W2:date-not-copied-as-a-new-frozen-instance', MOD));
check('MUTATION: initial == final (one copy used for both) or the initial list dropped -> detected', flags(auditM(MOD, (s) => s.replace('finalCandidates: copyCandidateLists(intentIds, source.finalCandidatesByIntentId)', 'finalCandidates: initialCandidates')), 'W2:initial-or-final-candidates-not-separately-copied', MOD) && flags(auditM(MOD, (s) => s.replace('initialCandidates,\n      finalCandidates', 'finalCandidates').replace(/const initialCandidates = Object\.freeze\([\s\S]*?\);\n    const basis/, 'const basis')), 'W2:', MOD));
check('MUTATION: the basis fails open on duplicate ids (last-write-wins) or builds without its T1 capture -> detected', flags(auditM(MOD, (s) => s.replace("reason: 'DUPLICATE_INTENT_ID'", "reason: 'ASSEMBLY_FAILED'")), 'W2:fail-closed-gates-missing', MOD) && flags(auditM(MOD, (s) => s.replace("if (source.initialCandidates === undefined) return Object.freeze({ status: 'UNAVAILABLE', reason: 'ASSEMBLY_FAILED' });", '')), 'W2:fail-closed-gates-missing', MOD));
check('MUTATION: assembly or capture can throw out of the module (the try / catch removed) -> detected', flags(auditM(MOD, (s) => s.replace("} catch {\n    return Object.freeze({ status: 'UNAVAILABLE', reason: 'ASSEMBLY_FAILED' });\n  }", "} finally {\n  }")), 'W2:capture-or-assembly-can-throw-out-of-the-module', MOD));
check('MUTATION: a policy / pressure / promotion / contract field is added to the basis, or an intent gains a facts / family field -> detected', flags(auditM(MOD, (s) => s.replace('readonly fixedConstraints: readonly ConstructionBasisFixedEntry[];', 'readonly fixedConstraints: readonly ConstructionBasisFixedEntry[];\n  readonly pressure: string;')), 'W2:basis-fields-are-not-the-minimum-contract', MOD) && flags(auditM(MOD, (s) => s.replace('readonly originalOrder: number;\n}', 'readonly originalOrder: number;\n  readonly facts: string;\n}')), 'W2:intent-fields-are-not-the-minimum-contract', MOD));
check('MUTATION: a SECOND timing search (re-search to recover the initial lists), a second Constructor pass, or a clock read is added to the orchestrator -> detected', flags(auditM(ORCH, (s) => s.replace('const initialCandidateLists = evidenceOut ?', 'deps.searchTiming({} as never);\n  const initialCandidateLists = evidenceOut ?')), 'W3:search-or-construction-call-sites-changed', ORCH) && flags(auditM(ORCH, (s) => s.replace("if (evidenceOut) {\n    evidenceOut.constructionBasis", "constructDay({} as never);\n  if (evidenceOut) {\n    evidenceOut.constructionBasis")), 'W3:search-or-construction-call-sites-changed', ORCH) && flags(auditM(ORCH, (s) => s.replace('const initialCandidateLists = evidenceOut ?', 'const stamp = new Date();\n  const initialCandidateLists = evidenceOut ?')), 'W3:clock-or-date-allocation-count-changed', ORCH));
check('MUTATION: the capture moves after replenishment (initial authority lost), runs unguarded (normal path pays), or runs outside `optionalBasisStep` -> detected', flags(auditM(ORCH, (s) => s.replace(CAPTURE_CALL, '').replace('  return {\n    status: \'READY\',', `  ${CAPTURE_CALL}\n  return {\n    status: 'READY',`)), 'W3:t1-capture', ORCH) && flags(auditM(ORCH, (s) => s.replace('evidenceOut ? optionalBasisStep(() => captureCandidateLists(request.intents.map((requested) => requested.id), candidatesByIntentId)) : undefined', 'captureCandidateLists(request.intents.map((requested) => requested.id), candidatesByIntentId)')), 'W3:t1-capture', ORCH) && flags(auditM(ORCH, (s) => s.replace('optionalBasisStep(() => assembleConstructionBasis({', '(() => assembleConstructionBasis({')), 'W3:t4-assembly', ORCH));
check('MUTATION: the orchestrator READS the basis (a decision branch on it), or the normal entry point is changed to produce it -> detected', flags(auditM(ORCH, (s) => `${s}\nfunction probe(h: EvidenceHandOff) { return h.constructionBasis?.status === 'READY'; }\n`), 'W3:basis-is-read-or-referenced-beyond-the-write-only-hand-off', ORCH) && flags(auditM(ORCH, (s) => s.replace('return runOrchestration(request, deps, constructDay);', 'return runOrchestration(request, deps, constructDay, {});')), 'W3:normal-entry-point-changed', ORCH));
check('MUTATION: a consumer appears (a shadow / promotion boundary reads the basis, a new module imports it, a new caller of the diagnostics entry point) -> detected', flags(auditM('apps/web/lib/shadowPressureObservation.ts', (s) => `${s}\nconst probe = (d: { constructionBasis: unknown }) => d.constructionBasis;\n`), 'W4:diagnostics-consumer-reads-the-basis', 'apps/web/lib/shadowPressureObservation.ts') && flags(audit(addFile(real, 'apps/web/lib/rogueConsumer.ts', "import { assembleConstructionBasis } from './constructionBasis';\nexport const r = assembleConstructionBasis;")), 'W1:imports-the-basis-module', 'apps/web/lib/rogueConsumer.ts') && flags(audit(addFile(real, 'apps/web/lib/rogueCaller.ts', "import { orchestrateConstructDayWithDiagnostics } from './dayConstructorOrchestrator';\nexport const r = (a: never, b: never) => orchestrateConstructDayWithDiagnostics(a, b);")), 'W4:new-caller-of-the-diagnostics-entry-point', 'apps/web/lib/rogueCaller.ts'));
check('MUTATION: PUBLIC / SIGNED / PERSISTED EXPOSURE -- the basis named by the preview request, signing, acceptance, persistence, a route, db.ts, the Constructor or the comparator -> detected', ['apps/web/lib/dayConstructorPreviewRequest.ts', 'apps/web/lib/dayConstructorPreviewIntegrity.ts', 'apps/web/lib/dayConstructorAcceptance.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts', 'apps/web/app/api/day-constructor/preview/route.ts', 'apps/web/app/api/day-constructor/accept/route.ts', 'apps/web/lib/db.ts', 'apps/web/lib/dayConstructor.ts', 'apps/web/lib/dayIntent.ts'].every((f) => flags(auditM(f, (s) => `${s}\nexport const probe = 'ConstructionBasis';\n`), 'W1:surface-names-the-basis', f)));
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
check('both construction-basis suites (behavior and architecture) run in the required PURE job', stepJob.get('test/constructionBasis.test.ts') === 'math-core-tests' && stepJob.get('test/constructionBasisArchitecture.test.ts') === 'math-core-tests');
check('THE #208 DATE-MUTATOR GUARD COVERS THE NEW MODULE DELIBERATELY: constructionBasis.ts is on its explicit protected list (its scope and its single timezone exception were not widened)', /\{ file: 'apps\/web\/lib\/constructionBasis\.ts', role: /.test(read('test/schedulingDateMutatorArchitecture.test.ts')) && /const EXCEPTION = \{\s*file: 'apps\/web\/lib\/timezone\.ts'/.test(read('test/schedulingDateMutatorArchitecture.test.ts')));
const FLAKY = /\bctid\b|VACUUM|ANALYZE|EXPLAIN\b|Math\.random|setTimeout|setInterval|pg_sleep|\bsleep\b/;
check('the behavior suite asserts invariants only: no sleeps, timers, randomness, heap layout or query-plan mechanics (its only clock touch is counting Date.now calls to prove there are none)', !FLAKY.test(stripComments(read('test/constructionBasis.test.ts'))));
const FALSE_CLAIM = /pressure is (active|enabled)|P4b2 (is )?ready|ready for P4b2|freeze(s|d)? (protects|prevents)|Object\.freeze (makes|protects)/i;
check('no assertion label claims pressure is active, that a counterfactual exists, or that freezing alone protects a Date', !(read('test/constructionBasis.test.ts').match(/check\(`?'?[^\n]*/g) ?? []).some((l) => FALSE_CLAIM.test(l)));
check('SCOPE STATEMENT: this guard does not claim a future P4b2 consumer\'s own working copies are safe', /does NOT prove a future P4b2 consumer/.test(read('test/constructionBasisArchitecture.test.ts')));

if (!allPassed) {
  console.error('SOME CONSTRUCTION BASIS ARCHITECTURE CHECKS FAILED');
  process.exit(1);
}
console.log('ALL CONSTRUCTION BASIS ARCHITECTURE CHECKS PASSED');
