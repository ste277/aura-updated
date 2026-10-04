/**
 * Constructor Decision Intelligence -- O5 P4b1b: the IMMUTABLE BASELINE PLACEMENTS (architecture guard, pure).
 *
 * BaselinePlacements is the baseline scheduling OUTCOME authority (what the run chose); ConstructionBasis is the baseline scheduling
 * INPUT authority (what the run was given). This guard pins that:
 *
 *   - the two stay SEPARATE contracts: the basis module never names a placement, a Proposed item or a placement source
 *   - the placements are captured ONLY by the orchestrator, from the terminal `result.day` of the same run, at the same T4 step that
 *     assembles the basis, only when a diagnostics caller asked, wrapped in `optionalBasisStep` -- so the normal preview path does no
 *     capture, a capture failure cannot fail the baseline, and no caller can bless an arbitrary result
 *   - the module VALIDATES and never reconstructs: window, blockers, half-open pairwise disjointness, FIXED against the fixed
 *     constraint, flexible against the TERMINAL (final) candidate list -- and never reads the initial list, sorts, or looks at Deferred
 *   - it is pure and neutral: type-only imports, no database, clock, timing search, Constructor call, JSON / structuredClone, `any`,
 *     pressure / promotion / facts / source vocabulary, and Date copies only as `new Date(source.getTime())`
 *   - it has ZERO consumers and appears in no preview, signing, acceptance, persistence, Recomposition, Move, route or schema surface
 *
 * It does NOT prove a future P4b2 boundary needs no revalidation of the (basis, placements, promotion input) trio. Every rule is a PURE
 * FUNCTION over source files: it runs on the real tree (zero violations) AND on the tree with a synthetic violation injected.
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

const MOD = 'apps/web/lib/baselinePlacements.ts';
const BASIS = 'apps/web/lib/constructionBasis.ts';
const ORCH = 'apps/web/lib/dayConstructorOrchestrator.ts';
/** O5 P4b2a -- the promotion contention authority validates its pairing against the placements (TYPES only); the internal promotion boundary passes the SAME run's outcome to it (one argument, never read). */
const CONTENTION_MOD = 'apps/web/lib/promotionContentionAuthority.ts';
const PROMOTION_PREP = 'apps/web/lib/promotionInputPreparation.ts';
const NAMING_ALLOW = [MOD, ORCH, CONTENTION_MOD, PROMOTION_PREP];
const IDENT = /\b(BaselinePlacement[A-Za-z]*|captureBaselinePlacements|baselinePlacements)\b|baselinePlacements['"]/;
const MOD_IMPORTS = [`import type { ConstructedDay, PlacementTimingFit } from './dayConstructor';`, `import type { ConstructionBasis, ConstructionBasisOutcome } from './constructionBasis';`];
const POLICY_VOCAB = /DecisionPressure|LAST_KNOWN|PromotionInput|PromotionOwner|DecisionFacts|decisionFacts|DecisionEvidence|decisionEvidence|GoalDecisionFacts|shadow|abovePressure|ContentionTrace|recurrence|opportunity|featureFlag|isFeatureEnabled|process\.env|\benv\b/i;
const SOURCE_VOCAB = /\bgoal|manual|automatic|provenance|hand-?off|rhythm|demand|\bUI\b/i;
const DB_VOCAB = /from '\.\/db'|\bpool\b|\.query\(|beginTransaction|withRepeatableReadSnapshot|prisma|INSERT|UPDATE|DELETE/;
const CLOCK_VOCAB = /Date\.now|new Date\(\)|performance\.now|hrtime/;
const SEARCH_VOCAB = /searchTiming|runTimingSearch|timingSearch|excludedIntervals|replenish/i;
const CONSTRUCT_VOCAB = /\bconstructDay\w*\(|orchestrate\w*\(|\bsortByOverloadPrecedence\b|compareByOverloadPrecedence|compareCandidatesForPlacement/;
const ASYNC_VOCAB = /\basync\b|\bawait\b|Promise|setTimeout|setInterval|console\.|logger|telemetry|fetch\(/;
const CLONE_SHORTCUT = /JSON\.(parse|stringify)|structuredClone|Object\.assign|deepFreeze|lodash/;
const NEVER = [
  'apps/web/lib/dayConstructor.ts', 'apps/web/lib/dayIntent.ts', 'apps/web/lib/dayCapacity.ts', 'apps/web/lib/contentionTrace.ts', 'apps/web/lib/dayConstructorPreviewRequest.ts',
  'apps/web/lib/dayConstructorPreviewIntegrity.ts', 'apps/web/lib/dayConstructorPreviewClient.ts', 'apps/web/lib/dayConstructorAcceptance.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts',
  'apps/web/lib/remainingDayRecomposition.ts', 'apps/web/lib/remainingDayRecompositionAcceptance.ts', 'apps/web/lib/remainingDayRecompositionIntegrity.ts', 'apps/web/lib/remainingDayRecompositionServer.ts',
  'apps/web/lib/homeRecomposition.ts', 'apps/web/lib/planMove.ts', 'apps/web/lib/homeMove.ts', 'apps/web/lib/dayPlanPreviewPresentation.ts', 'apps/web/lib/dayPlanAcceptancePresentation.ts', 'apps/web/lib/db.ts',
  'apps/web/lib/decisionFacts.ts', 'apps/web/lib/decisionEvidence.ts', 'apps/web/lib/decisionFactPreparation.ts', 'apps/web/lib/decisionPressure.ts', 'apps/web/lib/goalDecisionFactsProvider.ts',
  'apps/web/lib/decisionSchedulingContext.ts', 'apps/web/lib/decisionSchedulingContextLoader.ts', 'apps/web/lib/abovePressurePrecedence.ts', 'apps/web/lib/shadowPressureEvaluation.ts', 'apps/web/lib/shadowPressureObservation.ts',
  'apps/web/lib/promotionInput.ts', 'apps/web/lib/opportunityProjection.ts', 'apps/web/lib/opportunityDecisionFacts.ts', BASIS,
  'apps/web/app/api/day-constructor/preview/route.ts', 'apps/web/app/api/day-constructor/accept/route.ts', 'apps/web/app/api/day/recompose/route.ts', 'apps/web/app/api/plans/[planId]/move/route.ts', 'apps/web/app/api/plans/route.ts',
];
const CAPTURE_CALL = "evidenceOut.baselinePlacements = optionalBasisStep(() => captureBaselinePlacements(result.day, evidenceOut.constructionBasis ?? { status: 'UNAVAILABLE', reason: 'ASSEMBLY_FAILED' })) ?? { status: 'UNAVAILABLE', reason: 'CAPTURE_FAILED' };";

function audit(files: SrcFile[]): string[] {
  const v: string[] = [];
  const get = (f: string) => files.find((x) => x.f === f);
  const by = (re: RegExp) => files.filter((x) => re.test(x.src)).map((x) => x.f);
  const notIn = (list: string[], allow: string[]) => list.filter((f) => !allow.includes(f));
  // Y1 -- confinement, separation, consumers
  notIn(by(IDENT), NAMING_ALLOW).forEach((f) => v.push(`Y1:names-the-placements:${f}`));
  notIn(by(/from '\.\/baselinePlacements'/), [ORCH, CONTENTION_MOD]).forEach((f) => v.push(`Y1:imports-the-placements-module:${f}`));
  for (const f of NEVER) { const x = get(f); if (x && /baselinePlacements|BaselinePlacement/.test(x.src)) v.push(`Y1:surface-names-the-placements:${f}`); }
  const b = get(BASIS);
  if (b && /proposedItems|placementSource|Proposed|baselinePlacement|BaselinePlacement/i.test(b.src)) v.push(`Y2:basis-absorbs-outcome-authority:${BASIS}`);
  // Y3 -- the module
  const m = get(MOD);
  if (m) {
    if (JSON.stringify(Array.from(m.src.matchAll(/^import [^\n]*;$/gm)).map((x) => x[0])) !== JSON.stringify(MOD_IMPORTS) || /^import (?!type )/m.test(m.src)) v.push(`Y3:imports-are-not-the-reviewed-two-type-imports:${MOD}`);
    if (POLICY_VOCAB.test(m.src)) v.push(`Y3:policy-evidence-facts-or-flag-vocabulary:${MOD}`);
    if (SOURCE_VOCAB.test(m.src)) v.push(`Y3:source-specific-vocabulary:${MOD}`);
    if (DB_VOCAB.test(m.src)) v.push(`Y3:database-access:${MOD}`);
    if (CLOCK_VOCAB.test(m.src)) v.push(`Y3:clock-read:${MOD}`);
    if (SEARCH_VOCAB.test(m.src)) v.push(`Y3:timing-search-or-replenishment:${MOD}`);
    if (CONSTRUCT_VOCAB.test(m.src)) v.push(`Y3:constructor-ranking-or-ordering-call:${MOD}`);
    if (ASYNC_VOCAB.test(m.src)) v.push(`Y3:async-log-or-network:${MOD}`);
    if (CLONE_SHORTCUT.test(m.src)) v.push(`Y3:json-structuredclone-or-generic-clone:${MOD}`);
    if (/\bany\b/.test(m.src)) v.push(`Y3:any-escape:${MOD}`);
    if (/\b(Map|WeakMap|WeakSet)\b/.test(m.src) || count(/\bSet\b/g, m.src) !== 1 || !/new Set\(ids\)\.size !== ids\.length/.test(m.src)) v.push(`Y3:mutable-collection-in-the-module:${MOD}`);
    if (count(/new Date\(/g, m.src) !== 1 || !/return Object\.freeze\(new Date\(source\.getTime\(\)\)\);/.test(m.src)) v.push(`Y3:date-not-copied-as-a-new-frozen-instance:${MOD}`);
    if (/^(let|var) |^const \w+ = (new |\[|\{)/m.test(m.src)) v.push(`Y3:module-level-state:${MOD}`);
    if (count(/Object\.freeze\(/g, m.src) < 6) v.push(`Y3:output-not-frozen:${MOD}`);
    if (/\.sort\(|\.reverse\(|\.toSorted\(|\.splice\(/.test(m.src) || !/day\.proposedItems\.map\(/.test(m.src)) v.push(`Y3:placements-are-reordered-or-not-taken-from-proposed-items:${MOD}`);
    if (/deferredItems|initialCandidates/.test(m.src)) v.push(`Y3:reads-deferred-or-initial-candidate-authority:${MOD}`);
    if (!/basis\.finalCandidates\.find\(/.test(m.src)) v.push(`Y3:flexible-placements-are-not-validated-against-final-candidates:${MOD}`);
    if (!/return a\.start\.getTime\(\) < b\.end\.getTime\(\) && b\.start\.getTime\(\) < a\.end\.getTime\(\);/.test(m.src)) v.push(`Y3:overlap-is-not-the-half-open-formula:${MOD}`);
    if (!/startMs < basis\.window\.start\.getTime\(\) \|\| endMs > basis\.window\.end\.getTime\(\)/.test(m.src)) v.push(`Y3:window-validation-missing:${MOD}`);
    if (!/basis\.blockedIntervals\.some\(\(blocker\) => overlaps\(placement, blocker\)\)/.test(m.src)) v.push(`Y3:blocker-validation-missing:${MOD}`);
    if (!/overlaps\(placements\[i\], placements\[j\]\)\) return 'INVALID_PLACEMENT'/.test(m.src)) v.push(`Y3:pairwise-validation-missing:${MOD}`);
    if (!/constraint\.start\.getTime\(\) !== startMs \|\| constraint\.end\.getTime\(\) !== endMs/.test(m.src) || !/intent\.flexibility !== 'FIXED'/.test(m.src) || !/intent\.flexibility !== 'FLEXIBLE'/.test(m.src)) v.push(`Y3:fixed-validation-missing:${MOD}`);
    if (!/candidate\.start\.getTime\(\) === startMs && candidate\.end\.getTime\(\) >= endMs && candidate\.timingFit === placement\.timingFit && candidate\.candidateOrder === placement\.candidateOrder/.test(m.src) || !/endMs !== startMs \+ intent\.estimatedDurationMinutes \* 60000/.test(m.src)) v.push(`Y3:candidate-validation-is-not-exact:${MOD}`);
    if (!/new Set\(ids\)\.size !== ids\.length\) return 'DUPLICATE_INTENT_ID'/.test(m.src) || !/if \(!intent\) return 'INVALID_PLACEMENT'/.test(m.src)) v.push(`Y3:identity-validation-missing:${MOD}`);
    if (!/basisOutcome\.status !== 'READY'\) return unavailable\('BASIS_UNAVAILABLE'\)/.test(m.src)) v.push(`Y3:not-paired-to-a-ready-basis:${MOD}`);
    if (!/export function captureBaselinePlacements\(day: Pick<ConstructedDay, 'proposedItems'>, basisOutcome: ConstructionBasisOutcome\): BaselinePlacementsOutcome \{\s*try \{[\s\S]*\} catch \{\s*return unavailable\('CAPTURE_FAILED'\);\s*\}\s*\}/.test(m.src)) v.push(`Y3:capture-can-throw-or-has-a-different-signature:${MOD}`);
    const exportsList = Array.from(m.src.matchAll(/^export (?:async )?(?:function|interface|type|const|class) (\w+)/gm)).map((x) => x[1]);
    if (JSON.stringify(exportsList) !== JSON.stringify(['BaselinePlacement', 'BaselinePlacements', 'BaselinePlacementsUnavailableReason', 'BaselinePlacementsOutcome', 'captureBaselinePlacements'])) v.push(`Y3:exports-changed:${MOD}`);
    const body = (m.src.match(/export interface BaselinePlacement \{[\s\S]*?\n\}/) ?? [''])[0];
    if (JSON.stringify(Array.from(body.matchAll(/readonly (\w+)\??:/g)).map((x) => x[1])) !== JSON.stringify(['intentId', 'start', 'end', 'placementSource', 'timingFit', 'candidateOrder'])) v.push(`Y3:placement-fields-are-not-the-minimum-contract:${MOD}`);
    const reasons = (m.src.match(/export type BaselinePlacementsUnavailableReason = ([^;]+);/) ?? ['', ''])[1];
    if (reasons.replace(/\s/g, '') !== "'RUN_NOT_READY'|'BASIS_UNAVAILABLE'|'CAPTURE_FAILED'|'DUPLICATE_INTENT_ID'|'INVALID_PLACEMENT'") v.push(`Y3:unavailable-reasons-are-not-infrastructural-only:${MOD}`);
  }
  // Y4 -- the orchestrator: captured only inside the run, at T4, only when asked, never read
  const o = get(ORCH);
  if (o) {
    if (count(/captureBaselinePlacements\(/g, o.src) !== 1) v.push(`Y4:capture-call-count-changed:${ORCH}`);
    if (!o.src.includes(CAPTURE_CALL)) v.push(`Y4:capture-is-not-the-reviewed-guarded-call:${ORCH}`);
    const t = o.src.indexOf(CAPTURE_CALL);
    const block = o.src.lastIndexOf('if (evidenceOut) {', t);
    if (!(block > 0 && block < o.src.indexOf('evidenceOut.constructionBasis =') && t > o.src.indexOf('evidenceOut.constructionBasis =') && t < o.src.lastIndexOf("status: 'READY',") && t > o.src.lastIndexOf('result = constructDay({') && t > o.src.indexOf('for (let round = 0; round < flexibleIntentCount'))) v.push(`Y4:capture-is-not-in-the-t4-block-after-the-basis-assembly:${ORCH}`);
    if (count(/baselinePlacements/g, o.src) !== 6 || count(/\.baselinePlacements\b/g, o.src) !== 2) v.push(`Y4:placements-are-read-or-referenced-beyond-the-write-only-hand-off:${ORCH}`);
    if (count(/deps\.searchTiming\(/g, o.src) !== 2 || count(/constructDay\(\{/g, o.src) !== 2 || count(/new Date\(/g, o.src) !== 5) v.push(`Y4:search-construction-or-clock-sites-changed:${ORCH}`);
    if (!/export async function orchestrateConstructDay\(request: ConstructDayRequest, deps: DayConstructorOrchestratorDeps\): Promise<OrchestrateConstructDayResult> \{\s*return runOrchestration\(request, deps, constructDay\);/.test(o.src)) v.push(`Y4:normal-entry-point-changed:${ORCH}`);
    const normalAndTrace = (o.src.match(/export async function orchestrateConstructDay\([\s\S]*?\n\}\n/) ?? [''])[0] + (o.src.match(/export async function orchestrateConstructDayWithTrace\([\s\S]*?\n\}\n/) ?? [''])[0];
    if (/laceme/.test(normalAndTrace)) v.push(`Y4:normal-or-trace-entry-names-the-placements:${ORCH}`);
  }
  // Y5 -- nothing downstream reads the produced outcome
  for (const f of ['apps/web/lib/shadowPressureObservation.ts']) { const x = get(f); if (x && /baselinePlacements/.test(x.src)) v.push(`Y5:diagnostics-consumer-reads-the-placements:${f}`); }
  // O5 P4b2a: the promotion boundary may only PASS the outcome through, as the one fixed argument of the contention authority hand-over.
  { const x = get(PROMOTION_PREP); if (x && ((x.src.match(/\bbaselinePlacements\b/g) ?? []).length !== 1 || !/contentionFor\(diagnostics\.contentionTrace, input, diagnostics\.constructionBasis, diagnostics\.baselinePlacements\)/.test(x.src))) v.push(`Y5:diagnostics-consumer-reads-the-placements:${PROMOTION_PREP}`); }
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
check(`THE REAL PRODUCTION TREE HAS ZERO BASELINE-PLACEMENTS ARCHITECTURE VIOLATIONS (${real.length} production files scanned)${baseline.length ? ': ' + baseline.join(', ') : ''}`, baseline.length === 0);

console.log('=== separation, producer and zero consumers ===');
const mod = src(MOD); const orch = src(ORCH);
check('THE PLACEMENTS VOCABULARY EXISTS IN EXACTLY FOUR PRODUCTION FILES: the pure module, the orchestrator that produces it, the promotion contention authority (TYPES only) and the internal promotion boundary that passes it through; only the orchestrator imports the module as a value', JSON.stringify(names(IDENT)) === JSON.stringify([...NAMING_ALLOW].sort()) && JSON.stringify(names(/from '\.\/baselinePlacements'/)) === JSON.stringify([ORCH, CONTENTION_MOD].sort()) && !/^import (?!type )[^\n]*from '\.\/baselinePlacements'/m.test(src(CONTENTION_MOD)));
check('INPUT AUTHORITY AND OUTCOME AUTHORITY STAY SEPARATE: constructionBasis.ts names no placement, Proposed item or placement source, and the placements module imports only the basis TYPES (it never writes the basis)', !/proposedItems|placementSource|Proposed|baselinePlacement|BaselinePlacement/i.test(src(BASIS)) && !/^import (?!type )/m.test(mod));
check('PRODUCER: the placements are captured only INSIDE the orchestration run -- one capture, from the terminal `result.day`, inside the same `if (evidenceOut)` T4 block that assembles the basis, AFTER the assembly and after the last Constructor pass, wrapped in `optionalBasisStep`; the normal and trace entry points never name it, so the preview path does no capture', orch.includes(CAPTURE_CALL) && count(/captureBaselinePlacements\(/g, orch) === 1 && orch.indexOf(CAPTURE_CALL) > orch.indexOf('evidenceOut.constructionBasis =') && orch.indexOf(CAPTURE_CALL) > orch.lastIndexOf('result = constructDay({') && /return runOrchestration\(request, deps, constructDay\);/.test(orch) && !flags(audit(real), 'Y4:normal-or-trace-entry-names-the-placements'));
check('NO CALLER CAN BLESS A RESULT: the hand-off is module-private, the only call is the orchestrator\'s own, and `orchestrateConstructDayWithDiagnostics` takes only (request, deps)', /^interface EvidenceHandOff \{/m.test(orch) && !/export interface EvidenceHandOff/.test(orch) && /export async function orchestrateConstructDayWithDiagnostics\(\s*request: ConstructDayRequest,\s*deps: DayConstructorOrchestratorDeps\s*\): Promise</.test(orch));
check('ZERO CONSUMERS: the orchestrator only writes `evidenceOut.baselinePlacements` and returns `handOff.baselinePlacements`; the shadow boundary never mentions it and the promotion boundary only PASSES the same run\'s outcome to the contention authority (one `diagnostics.baselinePlacements` argument, never read); no other production file names it', count(/\.baselinePlacements\b/g, orch) === 2 && !/baselinePlacements/.test(src('apps/web/lib/shadowPressureObservation.ts')) && count(/\bbaselinePlacements\b/g, src(PROMOTION_PREP)) === 1 && names(/\bcaptureBaselinePlacements\(/).join() === [MOD, ORCH].sort().join());
check('NO PUBLIC / SIGNED / PERSISTED EXPOSURE: the Constructor, comparator, capacity, preview request / client / integrity, acceptance, persistence, Recomposition, Move, every route, db.ts, every Decision Intelligence module and the basis module are free of the placements vocabulary', NEVER.every((f) => !/baselinePlacements|BaselinePlacement/.test(src(f))));
const migrationSql = fs.readdirSync(path.join(root, 'apps/web/prisma/migrations'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => fs.readFileSync(path.join(root, 'apps/web/prisma/migrations', e.name, 'migration.sql'), 'utf8'));
check('NO PERSISTENCE, NO SCHEMA: the Prisma schema and all 43 migration directories mention no baseline placements; no migration was added', !/baselinePlacements/i.test(read('apps/web/prisma/schema.prisma')) && migrationSql.length === 43 && migrationSql.every((s) => !/baselinePlacements/i.test(s)));
check('THE CONSTRUCTOR IS UNTOUCHED AND NO PRIVATE HELPER WAS EXPORTED: dayConstructor.ts still exports only the ranking comparator, `constructDay` and `constructDayWithTrace` (plus types), and names no placements', !/baselinePlacements|BaselinePlacement/.test(src('apps/web/lib/dayConstructor.ts')) && JSON.stringify(Array.from(src('apps/web/lib/dayConstructor.ts').matchAll(/^export function (\w+)/gm)).map((x) => x[1])) === JSON.stringify(['compareCandidatesForPlacement', 'constructDay', 'constructDayWithTrace']));
check('NOTHING ELSE CHANGED IN CONSTRUCTION: still exactly two `constructDay({` sites, two `deps.searchTiming(` sites and the same five `new Date(` allocations in the orchestrator', count(/constructDay\(\{/g, orch) === 2 && count(/deps\.searchTiming\(/g, orch) === 2 && count(/new Date\(/g, orch) === 5);

console.log('=== the module: validation, never reconstruction; pure, neutral, copying, frozen ===');
check('IMPORTS: exactly two TYPE imports (the Constructor result and timing-fit types, the basis types) -- no value import of anything, so no database, search, Constructor, clock, evidence, facts, pressure or promotion module can be reached', JSON.stringify(Array.from(mod.matchAll(/^import [^\n]*;$/gm)).map((x) => x[0])) === JSON.stringify(MOD_IMPORTS) && !/^import (?!type )/m.test(mod));
check('NO POLICY, NO EVIDENCE, NO FACTS, NO FLAG, NO SOURCE; NO DB, CLOCK, SEARCH, CONSTRUCTION, RANKING, I/O: none of that vocabulary appears, and the ranking primitive is deliberately NOT imported here (P4b2\'s concern)', !POLICY_VOCAB.test(mod) && !SOURCE_VOCAB.test(mod) && !DB_VOCAB.test(mod) && !CLOCK_VOCAB.test(mod) && !SEARCH_VOCAB.test(mod) && !CONSTRUCT_VOCAB.test(mod) && !ASYNC_VOCAB.test(mod));
check('COPYING IS EXPLICIT: no `any`, no JSON round-trip, no structuredClone, no Object.assign, no generic deepFreeze; the ONLY Date allocation is `new Date(source.getTime())` in `ownDate`, which freezes it; no Map, and the single `Set` is the local duplicate-id check; no module-level state', !/\bany\b/.test(mod) && !CLONE_SHORTCUT.test(mod) && count(/new Date\(/g, mod) === 1 && !/\b(Map|WeakMap|WeakSet)\b/.test(mod) && count(/\bSet\b/g, mod) === 1 && !/^(let|var) |^const \w+ = (new |\[|\{)/m.test(mod));
check('EVERYTHING IS FROZEN: the outcome, the placements wrapper, the array, every placement and every Date pass through `Object.freeze` at creation (>= 6 sites) -- and the freeze is NOT claimed to protect a Date\'s time value (ownership + the #208 guard do)', count(/Object\.freeze\(/g, mod) >= 6 && !/(freeze|frozen)[^.\n]*(protects|prevents|immutable) (a )?date/i.test(read(MOD).replace(/The freeze does NOT[\s\S]*?\./, '')));
check('THE BASELINE ORDER IS PRESERVED: placements are mapped from `day.proposedItems` in place -- no sort, reverse or splice -- and Deferred intents are never read', /day\.proposedItems\.map\(/.test(mod) && !/\.sort\(|\.reverse\(|\.toSorted\(|\.splice\(/.test(mod) && !/deferredItems/.test(mod));
check('VALIDATION, NOT RECONSTRUCTION: identity (exactly once in the basis, no duplicate), the window, every blocker, pairwise half-open disjointness, FIXED against the single basis fixed constraint with exact timestamps, flexible against a candidate of the TERMINAL (`finalCandidates`) list matching start, timingFit and candidateOrder exactly with the interval being [start, start + duration) -- and the initial list is never read, nothing is chosen or repaired', !flags(audit(real), 'Y3:identity-validation-missing') && !flags(audit(real), 'Y3:window-validation-missing') && !flags(audit(real), 'Y3:blocker-validation-missing') && !flags(audit(real), 'Y3:pairwise-validation-missing') && !flags(audit(real), 'Y3:fixed-validation-missing') && !flags(audit(real), 'Y3:candidate-validation-is-not-exact') && !flags(audit(real), 'Y3:flexible-placements-are-not-validated-against-final-candidates') && !/initialCandidates/.test(mod));
check('EXACT OVERLAP SEMANTICS: the half-open formula `a.start < b.end && b.start < a.end` (touching intervals do not overlap) -- the same formula the Constructor uses, here as a local one-liner whose parity the P4b2 slice must prove exhaustively before it re-implements any placement gate', /return a\.start\.getTime\(\) < b\.end\.getTime\(\) && b\.start\.getTime\(\) < a\.end\.getTime\(\);/.test(mod));
check('PAIRED TO A READY BASIS, ALL-OR-NOTHING, NEVER THROWING: a non-READY basis is UNAVAILABLE / BASIS_UNAVAILABLE; capture returns UNAVAILABLE / CAPTURE_FAILED on any failure; the reasons are infrastructural only (RUN_NOT_READY, BASIS_UNAVAILABLE, CAPTURE_FAILED, DUPLICATE_INTENT_ID, INVALID_PLACEMENT) -- no policy label', !flags(audit(real), 'Y3:not-paired-to-a-ready-basis') && !flags(audit(real), 'Y3:capture-can-throw-or-has-a-different-signature') && !flags(audit(real), 'Y3:unavailable-reasons-are-not-infrastructural-only'));
check('THE MINIMUM CONTRACT: a placement has exactly intentId, start, end, placementSource, timingFit?, candidateOrder? -- no title, activity, importance, deadline, flexibility, originalOrder, pressure or source; the module exports only its types and `captureBaselinePlacements`', !flags(audit(real), 'Y3:placement-fields-are-not-the-minimum-contract') && !flags(audit(real), 'Y3:exports-changed'));

console.log('=== MUTATIONS OF THE GUARD: each violation class, injected into the real tree, is detected ===');
check('MUTATION: a pressure / promotion / owner / facts / evidence / shadow / flag field or import enters the module -> detected', ['DecisionPressure', 'PromotionInput', 'PromotionOwner', 'DecisionFacts', 'DecisionEvidence', 'GoalDecisionFacts', 'shadowResult', 'featureFlag'].every((w) => flags(auditM(MOD, (s) => `${s}\nexport type Leak = ${w};\n`), 'Y3:policy-evidence-facts-or-flag-vocabulary', MOD)) && flags(auditM(MOD, (s) => `import type { DecisionPressure } from './decisionPressure';\n${s}`), 'Y3:imports-are-not-the-reviewed-two-type-imports', MOD));
check('MUTATION: a clock read, a database import, a timing search, a Constructor / ranking call, an async boundary, `any`, a JSON clone, a Map, module state -> detected', flags(auditM(MOD, (s) => `${s}\nexport const c = () => Date.now();\n`), 'Y3:clock-read', MOD) && flags(auditM(MOD, (s) => `import { listHabitLogs } from './db';\n${s}`), 'Y3:database-access', MOD) && flags(auditM(MOD, (s) => `${s}\nexport const c = (r: never) => runTimingSearch(r);\n`), 'Y3:timing-search-or-replenishment', MOD) && flags(auditM(MOD, (s) => `${s}\nexport const c = (i: never) => constructDay(i);\n`), 'Y3:constructor-ranking-or-ordering-call', MOD) && flags(auditM(MOD, (s) => `${s}\nexport const c = async () => 1;\n`), 'Y3:async-log-or-network', MOD) && flags(auditM(MOD, (s) => `${s}\nexport const c = (x: any) => x;\n`), 'Y3:any-escape', MOD) && flags(auditM(MOD, (s) => `${s}\nexport const c = (x: BaselinePlacements) => JSON.parse(JSON.stringify(x));\n`), 'Y3:json-structuredclone-or-generic-clone', MOD) && flags(auditM(MOD, (s) => `${s}\nexport const c = new Map<string, number>();\n`), 'Y3:mutable-collection-in-the-module', MOD) && flags(auditM(MOD, (s) => `let retained: unknown;\n${s}`), 'Y3:module-level-state', MOD));
check('MUTATION: shared Date (the copy returns the source), unfrozen output -> detected', flags(auditM(MOD, (s) => s.replace('return Object.freeze(new Date(source.getTime()));', 'return source;')), 'Y3:date-not-copied-as-a-new-frozen-instance', MOD) && flags(auditM(MOD, (s) => s.split('Object.freeze(').join('(')), 'Y3:output-not-frozen', MOD));
check('MUTATION: the placements are SORTED, Deferred items are included, or the initial candidate list is used for validation -> detected', flags(auditM(MOD, (s) => s.replace('day.proposedItems.map(', 'day.proposedItems.slice().sort((x, y) => x.intentId.localeCompare(y.intentId)).map(')), 'Y3:placements-are-reordered-or-not-taken-from-proposed-items', MOD) && flags(auditM(MOD, (s) => `${s}\nexport const d = (x: { deferredItems: unknown[] }) => x.deferredItems;\n`), 'Y3:reads-deferred-or-initial-candidate-authority', MOD) && flags(auditM(MOD, (s) => s.replace('basis.finalCandidates.find(', 'basis.initialCandidates.find(')), 'Y3:', MOD));
check('MUTATION: unknown intent allowed, duplicate last-wins, FIXED validation skipped, candidate validation skipped or loosened, window / blocker / pairwise validation skipped, overlap formula changed -> detected', flags(auditM(MOD, (s) => s.replace("if (!intent) return 'INVALID_PLACEMENT';", '')), 'Y3:identity-validation-missing', MOD) && flags(auditM(MOD, (s) => s.replace("new Set(ids).size !== ids.length) return 'DUPLICATE_INTENT_ID'", "new Set(ids).size < 0) return 'DUPLICATE_INTENT_ID'")), 'Y3:', MOD) && flags(auditM(MOD, (s) => s.replace('constraint.start.getTime() !== startMs || constraint.end.getTime() !== endMs', 'false')), 'Y3:fixed-validation-missing', MOD) && flags(auditM(MOD, (s) => s.replace('candidate.candidateOrder === placement.candidateOrder', 'true')), 'Y3:candidate-validation-is-not-exact', MOD) && flags(auditM(MOD, (s) => s.replace('candidate.end.getTime() >= endMs', 'true')), 'Y3:candidate-validation-is-not-exact', MOD) && flags(auditM(MOD, (s) => s.replace('startMs < basis.window.start.getTime() || endMs > basis.window.end.getTime()', 'false')), 'Y3:window-validation-missing', MOD) && flags(auditM(MOD, (s) => s.replace('basis.blockedIntervals.some((blocker) => overlaps(placement, blocker))', 'false')), 'Y3:blocker-validation-missing', MOD) && flags(auditM(MOD, (s) => s.replace("overlaps(placements[i], placements[j])) return 'INVALID_PLACEMENT'", "false) return 'INVALID_PLACEMENT'")), 'Y3:pairwise-validation-missing', MOD) && flags(auditM(MOD, (s) => s.replace('a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime()', 'a.start.getTime() <= b.end.getTime() && b.start.getTime() <= a.end.getTime()')), 'Y3:overlap-is-not-the-half-open-formula', MOD));
check('MUTATION: the placements are paired to an unavailable basis, the capture can throw, or a policy-flavoured unavailable reason is added -> detected', flags(auditM(MOD, (s) => s.replace("if (basisOutcome.status !== 'READY') return unavailable('BASIS_UNAVAILABLE');", '')), 'Y3:', MOD) && flags(auditM(MOD, (s) => s.replace("} catch {\n    return unavailable('CAPTURE_FAILED');\n  }", '} finally {\n  }')), 'Y3:capture-can-throw-or-has-a-different-signature', MOD) && flags(auditM(MOD, (s) => s.replace("| 'INVALID_PLACEMENT';", "| 'INVALID_PLACEMENT' | 'OWNER_PRESSURED';")), 'Y3:unavailable-reasons-are-not-infrastructural-only', MOD));
check('MUTATION: a pressure / contract field is added to the placement, or a title / flexibility duplicated from the basis -> detected', flags(auditM(MOD, (s) => s.replace('readonly candidateOrder?: number;', 'readonly candidateOrder?: number;\n  readonly pressure?: string;')), 'Y3:placement-fields-are-not-the-minimum-contract', MOD) && flags(auditM(MOD, (s) => s.replace('readonly candidateOrder?: number;', 'readonly candidateOrder?: number;\n  readonly title?: string;')), 'Y3:placement-fields-are-not-the-minimum-contract', MOD));
check('MUTATION: baseline OUTCOME fields are added to the ConstructionBasis (the two contracts merge) -> detected', flags(auditM(BASIS, (s) => s.replace('readonly fixedConstraints: readonly ConstructionBasisFixedEntry[];\n}', 'readonly fixedConstraints: readonly ConstructionBasisFixedEntry[];\n  readonly proposedItems: readonly string[];\n}')), 'Y2:basis-absorbs-outcome-authority', BASIS));
check('MUTATION: the capture runs on the normal path (unguarded), outside `optionalBasisStep`, before the basis, or is moved out of the T4 block -> detected', flags(auditM(ORCH, (s) => s.replace(CAPTURE_CALL, "evidenceOut.baselinePlacements = captureBaselinePlacements(result.day, evidenceOut.constructionBasis ?? { status: 'UNAVAILABLE', reason: 'ASSEMBLY_FAILED' }) ?? { status: 'UNAVAILABLE', reason: 'CAPTURE_FAILED' };")), 'Y4:capture-is-not-the-reviewed-guarded-call', ORCH) && flags(auditM(ORCH, (s) => s.replace(CAPTURE_CALL, '').replace("  return {\n    status: 'READY',", `  if (evidenceOut) { ${CAPTURE_CALL} }\n  return {\n    status: 'READY',`)), 'Y4:capture-is-not-in-the-t4-block-after-the-basis-assembly', ORCH) && flags(auditM(ORCH, (s) => s.replace(CAPTURE_CALL, `captureBaselinePlacements(result.day, { status: 'UNAVAILABLE', reason: 'ASSEMBLY_FAILED' });`)), 'Y4:', ORCH));
check('MUTATION: a SECOND timing search / Constructor pass / clock read is added to the orchestrator -> detected', flags(auditM(ORCH, (s) => s.replace('const initialCandidateLists = evidenceOut ?', 'deps.searchTiming({} as never);\n  const initialCandidateLists = evidenceOut ?')), 'Y4:search-construction-or-clock-sites-changed', ORCH) && flags(auditM(ORCH, (s) => s.replace('if (evidenceOut) {\n    evidenceOut.constructionBasis =', 'constructDay({} as never);\n  if (evidenceOut) {\n    evidenceOut.constructionBasis =')), 'Y4:search-construction-or-clock-sites-changed', ORCH) && flags(auditM(ORCH, (s) => s.replace('const initialCandidateLists = evidenceOut ?', 'const stamp = new Date();\n  const initialCandidateLists = evidenceOut ?')), 'Y4:search-construction-or-clock-sites-changed', ORCH));
check('MUTATION: the orchestrator READS the placements (a decision branch), or the normal / trace entry names them -> detected', flags(auditM(ORCH, (s) => `${s}\nfunction probe(h: EvidenceHandOff) { return h.baselinePlacements?.status === 'READY'; }\n`), 'Y4:placements-are-read-or-referenced-beyond-the-write-only-hand-off', ORCH) && flags(auditM(ORCH, (s) => s.replace('return runOrchestration(request, deps, constructDay);', 'return runOrchestration(request, deps, constructDay, {});')), 'Y4:normal-entry-point-changed', ORCH));
check('MUTATION: a consumer appears (a shadow / promotion boundary reads the placements, a new module imports or calls the capture) -> detected', flags(auditM('apps/web/lib/shadowPressureObservation.ts', (s) => `${s}\nconst probe = (d: { baselinePlacements: unknown }) => d.baselinePlacements;\n`), 'Y5:diagnostics-consumer-reads-the-placements', 'apps/web/lib/shadowPressureObservation.ts') && flags(auditM(PROMOTION_PREP, (s) => `${s}\nconst probe = (d: { baselinePlacements: unknown }) => d.baselinePlacements;\n`), 'Y5:diagnostics-consumer-reads-the-placements', PROMOTION_PREP) && flags(audit(addFile(real, 'apps/web/lib/rogueConsumer.ts', "import { captureBaselinePlacements } from './baselinePlacements';\nexport const r = captureBaselinePlacements;")), 'Y1:imports-the-placements-module', 'apps/web/lib/rogueConsumer.ts'));
check('MUTATION: PUBLIC / SIGNED / PERSISTED EXPOSURE -- the placements named by the preview request, signing, acceptance, persistence, a route, db.ts, the Constructor or the comparator -> detected', ['apps/web/lib/dayConstructorPreviewRequest.ts', 'apps/web/lib/dayConstructorPreviewIntegrity.ts', 'apps/web/lib/dayConstructorAcceptance.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts', 'apps/web/app/api/day-constructor/preview/route.ts', 'apps/web/app/api/day-constructor/accept/route.ts', 'apps/web/lib/db.ts', 'apps/web/lib/dayConstructor.ts', 'apps/web/lib/dayIntent.ts'].every((f) => flags(auditM(f, (s) => `${s}\nexport const probe = 'BaselinePlacements';\n`), 'Y1:surface-names-the-placements', f)));
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
check('both baseline-placements suites (behavior and architecture) run in the required PURE job', stepJob.get('test/baselinePlacements.test.ts') === 'math-core-tests' && stepJob.get('test/baselinePlacementsArchitecture.test.ts') === 'math-core-tests');
check('THE #208 DATE-MUTATOR GUARD COVERS THE NEW MODULE DELIBERATELY: baselinePlacements.ts is on its explicit protected list (its scope and its single timezone exception were not widened)', /\{ file: 'apps\/web\/lib\/baselinePlacements\.ts', role: /.test(read('test/schedulingDateMutatorArchitecture.test.ts')) && /const EXCEPTION = \{\s*file: 'apps\/web\/lib\/timezone\.ts'/.test(read('test/schedulingDateMutatorArchitecture.test.ts')));
const FLAKY = /\bctid\b|VACUUM|ANALYZE|EXPLAIN\b|Math\.random|setTimeout|setInterval|pg_sleep|\bsleep\b/;
check('the behavior suite asserts invariants only: no sleeps, timers, randomness, heap layout or query-plan mechanics', !FLAKY.test(stripComments(read('test/baselinePlacements.test.ts'))));
check('SCOPE STATEMENT: this guard does not claim a future P4b2 boundary may skip revalidating the trio; the overlap / gate re-implementation parity and the ranking reuse (`compareCandidatesForPlacement`) are recorded as P4b2 obligations, not done here', /does NOT prove a future P4b2 boundary needs no revalidation/.test(read('test/baselinePlacementsArchitecture.test.ts')));

if (!allPassed) {
  console.error('SOME BASELINE PLACEMENTS ARCHITECTURE CHECKS FAILED');
  process.exit(1);
}
console.log('ALL BASELINE PLACEMENTS ARCHITECTURE CHECKS PASSED');
