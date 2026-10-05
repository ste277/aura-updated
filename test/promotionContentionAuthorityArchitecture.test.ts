/**
 * Constructor Decision Intelligence -- O5 P4b2a: the IMMUTABLE PROMOTION CONTENTION AUTHORITY (architecture guard, pure).
 *
 * The authority is the narrow typed projection of the P3a contention events a future bounded counterfactual (P4b2) needs: for ONE
 * PromotionInput, the exact intervals its candidate attempted and lost to the owners that input authorizes. This guard pins that:
 *
 *   - EVENT authority over search history: nothing captures candidate lists per replenishment round; the ConstructionBasis keeps exactly
 *     its initial + final lists, the orchestrator keeps exactly one T1 capture, the replenishment loop and DEFAULT_FIND_LIMIT are untouched
 *   - it is a PROJECTION: the module reads only an event's loser, winner and attempted interval; no round, winner interval, pressure,
 *     importance, deadline, originalOrder, timing fit, candidate order or classification; owners come only from the PromotionInput (the
 *     trace can never enlarge the scope); order is the trace's own (no sort); dedup key is (owner, start, end), never the round
 *   - it is pure, type-import-only, async-free and neutral: no database, clock, timing search, Constructor / orchestrator call, JSON /
 *     structuredClone, `any`, pressure / policy / acceptance vocabulary, no module state; Dates are created only from the attempted
 *     strings and frozen; the output is frozen
 *   - it is produced ONLY inside the internal promotion-preparation boundary, from the same run's diagnostics, once per PromotionInput,
 *     with an isolated failure path; the RAW TRACE is consumed by that boundary and this module alone -- no other file (in particular no
 *     future generator) may name a trace or event, and the typed projection is all that leaves
 *   - it has ZERO scheduling consumers and appears in no preview, signing, acceptance, persistence, Recomposition, Move, route or schema
 *
 * Every rule is a PURE FUNCTION over source files: it runs on the real tree (zero violations) AND on the tree with a synthetic violation
 * injected. P4b2a does not implement the generator, P4b3+, P5, R3 or S5.
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

const MOD = 'apps/web/lib/promotionContentionAuthority.ts';
const ATT = 'apps/web/lib/schedulingAttemptAuthority.ts';
const PREP = 'apps/web/lib/promotionInputPreparation.ts';
const ASM = 'apps/web/lib/promotionInput.ts';
const ORCH = 'apps/web/lib/dayConstructorOrchestrator.ts';
const BASIS = 'apps/web/lib/constructionBasis.ts';
const PLACEMENTS = 'apps/web/lib/baselinePlacements.ts';
const TRACE = 'apps/web/lib/contentionTrace.ts';
const CONSTRUCTOR = 'apps/web/lib/dayConstructor.ts';
const SEARCH = 'packages/recommendation/src/timingSearch.ts';
const IDENT = /\b(PromotionContention[A-Za-z]*|projectContentionAuthority|promotionContentionAuthority)\b|promotionContentionAuthority['"]/;
/** The only files that may name a raw trace / event at all (pinned in full by the P3a guard; repeated here so a future generator cannot slip in). */
const RAW_TRACE_READERS = [TRACE, CONSTRUCTOR, ORCH, 'apps/web/lib/shadowPressureEvaluation.ts', 'apps/web/lib/shadowPressureObservation.ts', ASM, PREP, MOD, ATT];
const RAW_TRACE_IDENT = /\b(ContentionEvent|ContentionTrace|ContentionAttempt|ContentionObserver|contentionTrace)\b/;
const MOD_IMPORTS = [`import type { PlacementTimingFit } from './dayConstructor';`, `import type { ContentionTrace } from './contentionTrace';`, `import { normalizeSchedulingAttempts } from './schedulingAttemptAuthority';`, `import type { PromotionInput } from './promotionInput';`, `import type { ConstructionBasisOutcome } from './constructionBasis';`, `import type { BaselinePlacementsOutcome } from './baselinePlacements';`];
const DB_VOCAB = /from '\.\/db'|\bpool\b|\.query\(|beginTransaction|withRepeatableReadSnapshot|prisma|INSERT|UPDATE|DELETE/;
const CLOCK_VOCAB = /Date\.now|new Date\(\)|performance\.now|hrtime/;
const SEARCH_VOCAB = /searchTiming|runTimingSearch|timingSearch|excludedIntervals|replenish/i;
const CONSTRUCT_VOCAB = /\bconstructDay\w*\(|orchestrate\w*\(|\bsortByOverloadPrecedence\b|compareByOverloadPrecedence|compareCandidatesForPlacement/;
const ASYNC_VOCAB = /\basync\b|\bawait\b|Promise|setTimeout|setInterval|console\.|logger|telemetry|fetch\(/;
const CLONE_SHORTCUT = /JSON\.(parse|stringify)|structuredClone|Object\.assign|deepFreeze|lodash/;
/** Anything that would make the projection a policy, a pressure reader, a candidate-history collector or a counterfactual. */
const POLICY_VOCAB = /pressure|DecisionPressure|LAST_KNOWN|DecisionFacts|decisionFacts|DecisionEvidence|decisionEvidence|shadow|abovePressure|importance|deadline|originalOrder|candidateOrder|counterfactual|accept|reject|\bsafe|unsafe|FIXED_OWNER|OWNER_PRESSURED|NON_OWNER|NET_PROPOSED|TIMING_FLOOR|promote\b|score|\brank|boost|weight|priorit|urgen|featureFlag|isFeatureEnabled|process\.env|\benv\b/i;
const HISTORY_VOCAB = /initialCandidates|finalCandidates|candidateLists|candidateHistory|candidatesByRound|roundCandidates|\bcandidates\b|PlacementCandidate|\bround\b|winnerStart|winnerEnd/;
const SOURCE_VOCAB = /\bgoal|manual|automatic|provenance|hand-?off|rhythm|demand|\bUI\b/i;
/** Every surface that must never carry or read the authority. */
const NEVER = [
  CONSTRUCTOR, 'apps/web/lib/dayIntent.ts', 'apps/web/lib/dayCapacity.ts', TRACE, BASIS, PLACEMENTS, ASM, ORCH, 'apps/web/lib/dayConstructorPreviewRequest.ts',
  'apps/web/lib/dayConstructorPreviewIntegrity.ts', 'apps/web/lib/dayConstructorPreviewClient.ts', 'apps/web/lib/dayConstructorAcceptance.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts',
  'apps/web/lib/remainingDayRecomposition.ts', 'apps/web/lib/remainingDayRecompositionAcceptance.ts', 'apps/web/lib/remainingDayRecompositionIntegrity.ts', 'apps/web/lib/remainingDayRecompositionServer.ts',
  'apps/web/lib/homeRecomposition.ts', 'apps/web/lib/planMove.ts', 'apps/web/lib/homeMove.ts', 'apps/web/lib/dayPlanPreviewPresentation.ts', 'apps/web/lib/dayPlanAcceptancePresentation.ts', 'apps/web/lib/db.ts',
  'apps/web/lib/decisionFacts.ts', 'apps/web/lib/decisionEvidence.ts', 'apps/web/lib/decisionFactPreparation.ts', 'apps/web/lib/decisionPressure.ts', 'apps/web/lib/goalDecisionFactsProvider.ts',
  'apps/web/lib/decisionSchedulingContext.ts', 'apps/web/lib/decisionSchedulingContextLoader.ts', 'apps/web/lib/abovePressurePrecedence.ts', 'apps/web/lib/shadowPressureEvaluation.ts', 'apps/web/lib/shadowPressureObservation.ts',
  'apps/web/lib/opportunityProjection.ts', 'apps/web/lib/opportunityDecisionFacts.ts', SEARCH,
  'apps/web/app/api/day-constructor/preview/route.ts', 'apps/web/app/api/day-constructor/accept/route.ts', 'apps/web/app/api/day/recompose/route.ts', 'apps/web/app/api/plans/[planId]/move/route.ts', 'apps/web/app/api/plans/route.ts',
];
const ATT_HAND_OVER = 'attemptsFor(diagnostics.contentionTrace, diagnostics.constructionBasis)';
const HAND_OVER = 'contentionFor(diagnostics.contentionTrace, input, diagnostics.constructionBasis, diagnostics.baselinePlacements)';

function audit(files: SrcFile[]): string[] {
  const v: string[] = [];
  const get = (f: string) => files.find((x) => x.f === f);
  const by = (re: RegExp) => files.filter((x) => re.test(x.src)).map((x) => x.f);
  const notIn = (list: string[], allow: string[]) => list.filter((f) => !allow.includes(f));
  // Z1 -- confinement, consumers, raw trace
  notIn(by(IDENT), [MOD, PREP]).forEach((f) => v.push(`Z1:names-the-authority:${f}`));
  notIn(by(/from '\.\/promotionContentionAuthority'/), [PREP]).forEach((f) => v.push(`Z1:imports-the-authority-module:${f}`));
  notIn(by(/\bprojectContentionAuthority\(/), [MOD, PREP]).forEach((f) => v.push(`Z1:calls-the-projection:${f}`));
  for (const f of NEVER) { const x = get(f); if (x && /PromotionContention|projectContentionAuthority|promotionContentionAuthority/.test(x.src)) v.push(`Z1:surface-names-the-authority:${f}`); }
  notIn(by(RAW_TRACE_IDENT), RAW_TRACE_READERS).forEach((f) => v.push(`Z2:raw-trace-reader-outside-the-boundary:${f}`));
  // Z3 -- the module
  const m = get(MOD);
  if (m) {
    if (JSON.stringify(Array.from(m.src.matchAll(/^import [^\n]*;$/gm)).map((x) => x[0])) !== JSON.stringify(MOD_IMPORTS) || count(/^import (?!type )/gm, m.src) !== 1) v.push(`Z3:imports-are-not-the-reviewed-six-with-one-shared-normalization:${MOD}`);
    if (DB_VOCAB.test(m.src)) v.push(`Z3:database-access:${MOD}`);
    if (CLOCK_VOCAB.test(m.src)) v.push(`Z3:clock-read:${MOD}`);
    if (SEARCH_VOCAB.test(m.src)) v.push(`Z3:timing-search-or-replenishment:${MOD}`);
    if (CONSTRUCT_VOCAB.test(m.src)) v.push(`Z3:constructor-ranking-or-ordering-call:${MOD}`);
    if (ASYNC_VOCAB.test(m.src)) v.push(`Z3:async-log-or-network:${MOD}`);
    if (CLONE_SHORTCUT.test(m.src)) v.push(`Z3:json-structuredclone-or-generic-clone:${MOD}`);
    if (/\bany\b/.test(m.src)) v.push(`Z3:any-escape:${MOD}`);
    if (POLICY_VOCAB.test(m.src)) v.push(`Z3:pressure-policy-or-acceptance-vocabulary:${MOD}`);
    if (HISTORY_VOCAB.test(m.src)) v.push(`Z3:candidate-history-round-or-winner-geometry:${MOD}`);
    if (SOURCE_VOCAB.test(m.src)) v.push(`Z3:source-specific-vocabulary:${MOD}`);
    if (/\b(Map|WeakMap|WeakSet)\b/.test(m.src) || count(/\bSet\b/g, m.src) !== 1) v.push(`Z3:mutable-collection-in-the-module:${MOD}`);
    if (/^(let|var) |^const \w+ = (new |\[|\{)/m.test(m.src)) v.push(`Z3:module-level-state:${MOD}`);
    if (/\.sort\(|\.reverse\(|\.toSorted\(|\.splice\(/.test(m.src)) v.push(`Z3:attempts-are-reordered:${MOD}`);
    if (count(/new Date\(/g, m.src) !== 2 || !/start: Object\.freeze\(new Date\(slot\.start\.getTime\(\)\)\), end: Object\.freeze\(new Date\(slot\.end\.getTime\(\)\)\)/.test(m.src)) v.push(`Z3:date-not-a-fresh-frozen-copy:${MOD}`);
    if (count(/Object\.freeze\(/g, m.src) < 7) v.push(`Z3:output-not-frozen:${MOD}`);
    // Single source: the module is a scoped VIEW over the ONE shared normalization -- it never reads a raw event or the trace's event list itself.
    if (/\bevent\b|trace\.events/.test(m.src) || count(/normalizeSchedulingAttempts\(trace\)/g, m.src) !== 1) v.push(`Z3:second-projection-of-the-raw-trace:${MOD}`);
    const slotReads = Array.from(m.src.matchAll(/\bslot\.(\w+)/g)).map((x) => x[1]);
    if (slotReads.some((r) => !['intentId', 'conflictingOwnerIds', 'start', 'end', 'timingFit'].includes(r))) v.push(`Z3:reads-more-than-the-normalized-slot-fields:${MOD}`);
    if (!/if \(slot\.intentId !== candidateId\) continue;/.test(m.src) || !/if \(!ownerIds\.includes\(owner\)\) continue;/.test(m.src)) v.push(`Z3:candidate-or-owner-filter-missing:${MOD}`);
    if (!/const ownerIds = input\.owners\.map\(\(owner\) => owner\.intentId\);/.test(m.src) || /owner\.(?!intentId)/.test(m.src)) v.push(`Z3:owners-are-not-only-the-promotion-input-ids:${MOD}`);
    if (!/for \(const slot of normalizeSchedulingAttempts\(trace\)\)/.test(m.src)) v.push(`Z3:not-iterating-the-normalized-attempts-in-order-of-discovery:${MOD}`);
    if (!/basisOutcome\.status !== 'READY' \|\| placementsOutcome\.status !== 'READY'\) return unavailable\('RUN_NOT_READY'\)/.test(m.src)) v.push(`Z3:not-paired-to-a-ready-basis-and-placements:${MOD}`);
    if (!/!intentIds\.includes\(candidateId\) \|\| placedIds\.includes\(candidateId\)\) return unavailable\('INCONSISTENT_INPUT'\)/.test(m.src) || !/!placedIds\.includes\(id\)\)\) return unavailable\('INCONSISTENT_INPUT'\)/.test(m.src)) v.push(`Z3:candidate-or-owner-consistency-missing:${MOD}`);
    if (!/if \(attempts\.length === 0\) return unavailable\('NO_MATCHING_CONTENTION'\);/.test(m.src) || !/ownerIds\.some\(\(id\) => !attempts\.some\(\(attempt\) => attempt\.ownerIntentId === id\)\)\) return unavailable\('INCONSISTENT_INPUT'\)/.test(m.src)) v.push(`Z3:empty-or-unsupported-authority-not-fail-closed:${MOD}`);
    if (!/export function projectContentionAuthority\(trace: ContentionTrace, input: PromotionInput, basisOutcome: ConstructionBasisOutcome, placementsOutcome: BaselinePlacementsOutcome\): PromotionContentionOutcome \{\s*try \{[\s\S]*\} catch \{\s*return unavailable\('CAPTURE_FAILED'\);\s*\}\s*\}/.test(m.src)) v.push(`Z3:projection-can-throw-or-has-a-different-signature:${MOD}`);
    const exportsList = Array.from(m.src.matchAll(/^export (?:async )?(?:function|interface|type|const|class) (\w+)/gm)).map((x) => x[1]);
    if (JSON.stringify(exportsList) !== JSON.stringify(['PromotionContentionAttempt', 'PromotionContentionAuthority', 'PromotionContentionUnavailableReason', 'PromotionContentionOutcome', 'projectContentionAuthority'])) v.push(`Z3:exports-changed:${MOD}`);
    const attempt = (m.src.match(/export interface PromotionContentionAttempt \{[\s\S]*?\n\}/) ?? [''])[0];
    const authority = (m.src.match(/export interface PromotionContentionAuthority \{[\s\S]*?\n\}/) ?? [''])[0];
    if (JSON.stringify(Array.from(attempt.matchAll(/readonly (\w+)\??:/g)).map((x) => x[1])) !== JSON.stringify(['ownerIntentId', 'start', 'end', 'timingFit']) || JSON.stringify(Array.from(authority.matchAll(/readonly (\w+)\??:/g)).map((x) => x[1])) !== JSON.stringify(['candidateIntentId', 'attempts'])) v.push(`Z3:contract-fields-are-not-the-minimum:${MOD}`);
    const reasons = (m.src.match(/export type PromotionContentionUnavailableReason = ([^;]+);/) ?? ['', ''])[1];
    if (reasons.replace(/\s/g, '') !== "'RUN_NOT_READY'|'INCONSISTENT_INPUT'|'NO_MATCHING_CONTENTION'|'CAPTURE_FAILED'") v.push(`Z3:unavailable-reasons-are-not-infrastructural-only:${MOD}`);
    // The raw trace never leaves: no exported signature other than the projection mentions it, and the output type holds no trace type.
    if (/ContentionTrace|ContentionEvent/.test(attempt + authority + (m.src.match(/export type PromotionContentionOutcome =[\s\S]*?;\n/) ?? [''])[0])) v.push(`Z3:raw-trace-in-the-output-contract:${MOD}`);
  }
  // Z4 -- the internal promotion boundary: the ONE producer
  const p = get(PREP);
  if (p) {
    if (count(/projectContentionAuthority\(/g, p.src) !== 1 || !/function contentionFor\(\.\.\.args: Parameters<typeof projectContentionAuthority>\): PromotionContentionOutcome \{\s*try \{\s*return projectContentionAuthority\(\.\.\.args\);\s*\} catch \{\s*return Object\.freeze\(\{ status: 'UNAVAILABLE', reason: 'CAPTURE_FAILED' \}\);\s*\}\s*\}/.test(p.src)) v.push(`Z4:projection-call-is-not-the-isolated-wrapper:${PREP}`);
    if (count(/contentionFor\(/g, p.src) !== 2 || !p.src.includes(HAND_OVER)) v.push(`Z4:hand-over-is-not-the-reviewed-same-run-call:${PREP}`);
    if (p.src.indexOf(HAND_OVER) < p.src.indexOf('assemblePromotionInputs(') || p.src.indexOf(HAND_OVER) < p.src.indexOf('const result = diagnostics.result')) v.push(`Z4:authority-before-inputs-or-construction:${PREP}`);
    if (!/inputs\.map\(\(input\) => Object\.freeze\(\{ input, contention: contentionFor\(/.test(p.src)) v.push(`Z4:not-one-authority-per-promotion-input:${PREP}`);
    if (count(/orchestrateConstructDayWithDiagnostics\(/g, p.src) !== 1) v.push(`Z4:second-orchestration-in-the-boundary:${PREP}`);
    if (!/run: PromotionRunAuthority \}> \{/.test(p.src) || /contentionTrace\s*:/.test(p.src.replace(HAND_OVER, '').replace(ATT_HAND_OVER, '').replace(/contentionTrace: diagnostics\.contentionTrace, pressureByIntentId/, ''))) v.push(`Z4:boundary-returns-more-than-the-typed-projection:${PREP}`);
    if (count(/projectSchedulingAttempts\(/g, p.src) !== 1 || count(/attemptsFor\(/g, p.src) !== 2 || !p.src.includes(ATT_HAND_OVER)) v.push(`Z4:attempts-hand-over-is-not-the-reviewed-same-run-call:${PREP}`);
  }
  // Z5 -- EVENT authority, not search history: no candidate-history capture anywhere
  const b = get(BASIS);
  if (b) {
    const body = (b.src.match(/export interface ConstructionBasis \{[\s\S]*?\n\}/) ?? [''])[0];
    if (JSON.stringify(Array.from(body.matchAll(/readonly (\w+)\??:/g)).map((x) => x[1])) !== JSON.stringify(['planningDate', 'window', 'intents', 'blockedIntervals', 'initialCandidates', 'finalCandidates', 'fixedConstraints'])) v.push(`Z5:construction-basis-contract-changed:${BASIS}`);
    if (/candidateHistory|candidatesByRound|roundCandidates|replenishedCandidates|intermediate/i.test(b.src)) v.push(`Z5:candidate-history-in-the-basis:${BASIS}`);
  }
  const o = get(ORCH);
  if (o) {
    if (count(/captureCandidateLists\(/g, o.src) !== 1 || count(/candidatesByIntentId\[[\w.]+\] =/g, o.src) !== 2) v.push(`Z5:candidate-capture-sites-changed:${ORCH}`);
    if (/candidateHistory|candidatesByRound|roundCandidates|replenishedCandidates|perRound|intermediate/i.test(o.src)) v.push(`Z5:candidate-history-in-the-orchestrator:${ORCH}`);
    if (count(/deps\.searchTiming\(/g, o.src) !== 2 || count(/constructDay\(\{/g, o.src) !== 2) v.push(`Z5:search-or-construction-sites-changed:${ORCH}`);
    if (/PromotionContention|projectContentionAuthority/.test(o.src)) v.push(`Z5:orchestrator-names-the-authority:${ORCH}`);
  }
  const s = get(SEARCH);
  if (s && !/const DEFAULT_FIND_LIMIT = 3;/.test(s.src)) v.push(`Z5:default-find-limit-changed:${SEARCH}`);
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
check(`THE REAL PRODUCTION TREE HAS ZERO PROMOTION-CONTENTION-AUTHORITY ARCHITECTURE VIOLATIONS (${real.length} production files scanned)${baseline.length ? ': ' + baseline.join(', ') : ''}`, baseline.length === 0);

console.log('=== confinement, producer, raw trace, zero scheduling consumers ===');
check('THE AUTHORITY VOCABULARY EXISTS IN EXACTLY TWO PRODUCTION FILES: the pure module and the internal promotion boundary that produces it; only the boundary imports and calls it', JSON.stringify(names(IDENT)) === JSON.stringify([MOD, PREP].sort()) && JSON.stringify(names(/from '\.\/promotionContentionAuthority'/)) === JSON.stringify([PREP]) && JSON.stringify(names(/\bprojectContentionAuthority\(/)) === JSON.stringify([MOD, PREP].sort()));
check('RAW TRACE BOUNDARY: the raw P3a trace / event vocabulary appears only in the producers and the two pure P3b / P4a consumers, the promotion boundary and THIS module -- a future generator cannot import it; the module\'s output contract holds only strings-free typed attempts', JSON.stringify(names(RAW_TRACE_IDENT)) === JSON.stringify([...RAW_TRACE_READERS].sort()) && !/ContentionTrace|ContentionEvent/.test((src(MOD).match(/export interface PromotionContentionAuthority \{[\s\S]*?\n\}/) ?? [''])[0]));
check('NOT A SCHEDULING CONSUMER: no Constructor, comparator, capacity, trace, basis, placements, assembler, orchestrator, search, preview, signing, acceptance, persistence, Recomposition, Move, route or scheduling-context module mentions the authority', NEVER.every((f) => !/PromotionContention|projectContentionAuthority|promotionContentionAuthority/.test(src(f))));
const migrationSql = fs.readdirSync(path.join(root, 'apps/web/prisma/migrations'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => fs.readFileSync(path.join(root, 'apps/web/prisma/migrations', e.name, 'migration.sql'), 'utf8'));
check('NO PERSISTENCE, NO SCHEMA: the Prisma schema and all 43 migration directories mention no contention authority; no migration was added', !/promotionContention/i.test(read('apps/web/prisma/schema.prisma')) && migrationSql.length === 43 && migrationSql.every((s) => !/promotionContention/i.test(s)));
check('NO NEW EXTERNAL EXPOSURE: the authority is neither signed, serialized into a preview body nor returned by any route -- no production file other than the boundary and the module names it', names(/promotionContention|PromotionContention/i).length === 2);

console.log('=== the module is a minimal, pure, neutral projection ===');
const mod = src(MOD);
check('IMPORTS: exactly six imports -- five TYPE imports (timing fit, trace, promotion input, basis outcome, placements outcome) and ONE value import, the shared normalization -- hence no Constructor, search, database, clock or orchestrator can be reached', JSON.stringify(Array.from(mod.matchAll(/^import [^\n]*;$/gm)).map((x) => x[0])) === JSON.stringify(MOD_IMPORTS) && count(/^import (?!type )/gm, mod) === 1);
check('MINIMUM CONTRACT: the authority is exactly { candidateIntentId, attempts } and an attempt exactly { ownerIntentId, start, end, timingFit? }; reasons are the four infrastructural ones; exports are the five reviewed names', !flags(audit(real), 'Z3:contract-fields') && !flags(audit(real), 'Z3:unavailable-reasons') && !flags(audit(real), 'Z3:exports-changed'));
check('SINGLE SOURCE AND PROJECTION FIDELITY: the module is a scoped view over the ONE shared normalization (it reads no raw event); it reads only the normalized slot fields; owners come only from the PromotionInput ids; slots are iterated in order of discovery with no sort', !flags(audit(real), 'Z3:second-projection') && !flags(audit(real), 'Z3:reads-more') && !flags(audit(real), 'Z3:candidate-or-owner-filter') && !flags(audit(real), 'Z3:owners-are-not-only') && !flags(audit(real), 'Z3:attempts-are-reordered') && !flags(audit(real), 'Z3:not-iterating'));
check('NO POLICY, NO PRESSURE, NO HISTORY: the module names no pressure, importance, deadline, order, timing fit, candidate order, round, winner interval, candidate list, acceptance, safety or counterfactual term', !POLICY_VOCAB.test(mod) && !HISTORY_VOCAB.test(mod));
check('NO DATABASE, SNAPSHOT, CLOCK, SEARCH, CONSTRUCTOR, ASYNC, LOG OR GENERIC CLONE', !DB_VOCAB.test(mod) && !CLOCK_VOCAB.test(mod) && !SEARCH_VOCAB.test(mod) && !CONSTRUCT_VOCAB.test(mod) && !ASYNC_VOCAB.test(mod) && !CLONE_SHORTCUT.test(mod) && !/\bany\b/.test(mod));
check('FRESH DATES: exactly two `new Date(` allocations, each a copy of the shared normalization\'s own Date, each frozen -- so no authority Date is shared with the run-level attempt authority, the trace, an input, the basis or a placement', count(/new Date\(/g, mod) === 2 && !flags(audit(real), 'Z3:date-not-a-fresh-frozen-copy'));
check('FAIL CLOSED: not-READY run, unknown / placed candidate, unknown / unplaced / duplicate / empty owners, zero matches and unsupported owners all return UNAVAILABLE; the projection cannot throw', !flags(audit(real), 'Z3:not-paired') && !flags(audit(real), 'Z3:candidate-or-owner-consistency') && !flags(audit(real), 'Z3:empty-or-unsupported') && !flags(audit(real), 'Z3:projection-can-throw'));

console.log('=== the boundary: one authority per input, same run, isolated failure, no second orchestration ===');
const prep = src(PREP);
check('PRODUCER: exactly one projection call, inside the isolated `contentionFor` wrapper; exactly one hand-over, from the SAME diagnostics (trace, basis, placements), after the inputs are assembled and after construction; one authority per PromotionInput', !flags(audit(real), 'Z4:') && count(/orchestrateConstructDayWithDiagnostics\(/g, prep) === 1);
check('NO CALLER CAN MANUFACTURE AN AUTHORITY: the boundary signature is still (request, deps) -- no caller-supplied trace, input, basis or placements', /export async function preparePromotionInputs\(request: ConstructDayRequest, deps: DayConstructorOrchestratorDeps\)/.test(prep));
check('NORMAL PATH UNTOUCHED: the orchestrator and the normal `orchestrateConstructDay` entry point do not name the authority', !/PromotionContention|projectContentionAuthority/.test(src(ORCH)) && /export async function orchestrateConstructDay\(request: ConstructDayRequest, deps: DayConstructorOrchestratorDeps\): Promise<OrchestrateConstructDayResult> \{\s*return runOrchestration\(request, deps, constructDay\);/.test(src(ORCH)));

console.log('=== event authority, NOT search history ===');
check('NO CANDIDATE HISTORY: the ConstructionBasis still holds exactly its seven fields (initial + final lists, nothing per round); the orchestrator still has exactly one T1 capture and two candidate-map writes; no history identifier exists', !flags(audit(real), 'Z5:'));
check('THE SEARCH AND THE CONSTRUCTOR ARE UNTOUCHED: DEFAULT_FIND_LIMIT is still 3, the orchestrator still has exactly two timing-search sites and two construction sites, and the Constructor names no authority', /const DEFAULT_FIND_LIMIT = 3;/.test(src(SEARCH)) && count(/deps\.searchTiming\(/g, src(ORCH)) === 2 && count(/constructDay\(\{/g, src(ORCH)) === 2 && !/PromotionContention/.test(src(CONSTRUCTOR)));
check('BASIS AND PLACEMENTS UNCHANGED IN SHAPE: neither names the authority, and the basis module exports are unchanged', !/PromotionContention/.test(src(BASIS)) && !/PromotionContention/.test(src(PLACEMENTS)) && JSON.stringify(Array.from(src(BASIS).matchAll(/^export (?:async )?(?:function|interface|type|const|class) (\w+)/gm)).map((x) => x[1])) === JSON.stringify(['ConstructionBasisIntent', 'ConstructionBasisWindow', 'ConstructionBasisBlocker', 'ConstructionBasisCandidate', 'ConstructionBasisCandidateList', 'ConstructionBasisFixedConstraint', 'ConstructionBasisFixedEntry', 'ConstructionBasis', 'ConstructionBasisUnavailableReason', 'ConstructionBasisOutcome', 'ConstructionBasisSource', 'captureCandidateLists', 'assembleConstructionBasis']));

console.log('=== the Date guard covers the module ===');
const dateGuard = read('test/schedulingDateMutatorArchitecture.test.ts');
check('#208 SCOPE: the module is on the protected Date-mutator list (zero exceptions) -- and the scanner debt (regex-literal blindness) is carried unchanged, not hidden', dateGuard.includes(`file: '${MOD}'`) && /ZERO EXCEPTIONS in the protected modules/.test(dateGuard));

console.log('=== MUTATIONS: each violation, injected into an in-memory copy, is detected ===');
check('MUTATION: the raw trace is exposed (a file other than the boundary names a trace / event; the output contract holds a trace; a future generator reads events) -> detected', flags(auditM(MOD, (s) => s.replace('readonly attempts: readonly PromotionContentionAttempt[];', 'readonly attempts: readonly PromotionContentionAttempt[];\n  readonly raw: ContentionTrace;')), 'Z3:raw-trace-in-the-output-contract', MOD) && flags(audit(addFile(real, 'apps/web/lib/localCounterfactual.ts', "import type { ContentionEvent } from './contentionTrace';\nexport type E = ContentionEvent;")), 'Z2:raw-trace-reader-outside-the-boundary', 'apps/web/lib/localCounterfactual.ts'));
check('MUTATION: candidate-list history is captured for every replenishment round (a second capture, a per-round collection in the basis or the orchestrator) -> detected', flags(auditM(ORCH, (s) => `${s}\nconst more = captureCandidateLists([], {});`), 'Z5:candidate-capture-sites-changed', ORCH) && flags(auditM(BASIS, (s) => s.replace('readonly fixedConstraints: readonly ConstructionBasisFixedEntry[];', 'readonly fixedConstraints: readonly ConstructionBasisFixedEntry[];\n  readonly candidatesByRound: readonly ConstructionBasisCandidateList[][];')), 'Z5:construction-basis-contract-changed', BASIS) && flags(auditM(ORCH, (s) => `${s}\nconst candidatesByRound: unknown[] = [];`), 'Z5:candidate-history-in-the-orchestrator', ORCH));
check('MUTATION: a database query / snapshot, a clock read, a timing search, a Constructor or orchestrator call, async, logging in the module -> detected', flags(auditM(MOD, (s) => `${s}\nexport const q = () => pool.query('SELECT 1');`), 'Z3:database-access', MOD) && flags(auditM(MOD, (s) => `${s}\nexport const t = () => Date.now();`), 'Z3:clock-read', MOD) && flags(auditM(MOD, (s) => `${s}\nexport const x = () => searchTiming();`), 'Z3:timing-search-or-replenishment', MOD) && flags(auditM(MOD, (s) => `${s}\nexport const c = () => constructDay({} as never);`), 'Z3:constructor-ranking-or-ordering-call', MOD) && flags(auditM(MOD, (s) => `${s}\nexport const a = async () => 1;`), 'Z3:async-log-or-network', MOD));
check('MUTATION: pressure / policy / acceptance vocabulary, owner pressure read, round / winner interval / candidate order carried -> detected', flags(auditM(MOD, (s) => s.replace('ownerIntentId: owner,', 'ownerIntentId: owner, pressure: input.owners[0].pressure,')), 'Z3:', MOD) && flags(auditM(MOD, (s) => s.replace('readonly end: Date;', 'readonly end: Date;\n  readonly round: number;')), 'Z3:', MOD) && flags(auditM(MOD, (s) => `${s}\nexport const w = 'shouldAccept';`), 'Z3:pressure-policy-or-acceptance-vocabulary', MOD) && flags(auditM(MOD, (s) => s.replace('for (const slot of normalizeSchedulingAttempts(trace)) {', 'for (const slot of normalizeSchedulingAttempts(trace)) { void trace.events;')), 'Z3:second-projection-of-the-raw-trace', MOD));
check('MUTATION: the filters weaken (other losers kept, unauthorized owners kept, owners taken from the trace), the order is policy-sorted, dedup is dropped -> detected', flags(auditM(MOD, (s) => s.replace("if (slot.intentId !== candidateId) continue;", "")), 'Z3:candidate-or-owner-filter-missing', MOD) && flags(auditM(MOD, (s) => s.replace("if (!ownerIds.includes(owner)) continue;", "")), 'Z3:candidate-or-owner-filter-missing', MOD) && flags(auditM(MOD, (s) => s.replace('return Object.freeze({ status: \'READY\'', 'attempts.sort((a, b) => a.start.getTime() - b.start.getTime());\n    return Object.freeze({ status: \'READY\'')), 'Z3:attempts-are-reordered', MOD) && flags(auditM(MOD, (s) => s.replace('for (const slot of normalizeSchedulingAttempts(trace)) {', 'for (const slot of [...normalizeSchedulingAttempts(trace)]) {')), 'Z3:not-iterating-the-normalized-attempts-in-order-of-discovery', MOD));
check('MUTATION: a shared (aliased) or non-fresh Date, an unfrozen output -> detected', flags(auditM(MOD, (s) => s.replace('start: Object.freeze(new Date(slot.start.getTime()))', 'start: slot.start')), 'Z3:date-not-a-fresh-frozen-copy', MOD) && flags(auditM(MOD, (s) => s.replace('end: Object.freeze(new Date(slot.end.getTime()))', 'end: slot.end')), 'Z3:date-not-a-fresh-frozen-copy', MOD) && flags(auditM(MOD, (s) => s.split('Object.freeze(').join('(')), 'Z3:output-not-frozen', MOD));
check('MUTATION: the module loses fail-closed handling (zero match allowed, owner support unchecked, throwing projection, a value import) -> detected', flags(auditM(MOD, (s) => s.replace("if (attempts.length === 0) return unavailable('NO_MATCHING_CONTENTION');", '')), 'Z3:empty-or-unsupported-authority-not-fail-closed', MOD) && flags(auditM(MOD, (s) => s.replace(/  \} catch \{\n    return unavailable\('CAPTURE_FAILED'\);\n  \}\n\}/, '  } finally {\n    // nothing\n  }\n}')), 'Z3:projection-can-throw', MOD) && flags(auditM(MOD, (s) => `import { compareCandidatesForPlacement } from './dayConstructor';\n${s}`), 'Z3:imports-are-not-the-reviewed-six-with-one-shared-normalization', MOD));
check('MUTATION: the public preview / signing / acceptance / persistence / route / schema surfaces, the Constructor, the basis, the placements or the orchestrator name the authority -> detected', ['apps/web/lib/dayConstructorPreviewRequest.ts', 'apps/web/lib/dayConstructorPreviewIntegrity.ts', 'apps/web/lib/dayConstructorAcceptance.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts', 'apps/web/app/api/day-constructor/preview/route.ts', 'apps/web/app/api/day-constructor/accept/route.ts', 'apps/web/lib/db.ts', CONSTRUCTOR, BASIS, PLACEMENTS, ORCH, SEARCH].every((f) => flags(auditM(f, (s) => `${s}\nexport const p = 'PromotionContentionAuthority';`), 'Z1:', f)));
check('MUTATION: a production consumer of the authority appears (a generator importing the module, a second projection call) -> detected', flags(audit(addFile(real, 'apps/web/lib/rogueConsumer.ts', "import { projectContentionAuthority } from './promotionContentionAuthority';\nexport const r = projectContentionAuthority;")), 'Z1:imports-the-authority-module', 'apps/web/lib/rogueConsumer.ts') && flags(audit(addFile(real, 'apps/web/lib/rogueCaller.ts', "export const r = (t: never) => projectContentionAuthority(t);")), 'Z1:calls-the-projection', 'apps/web/lib/rogueCaller.ts'));
check('MUTATION: the boundary hands over a different run (a caller-supplied basis), runs a second orchestration, loses the isolating wrapper or the one-per-input shape -> detected', flags(auditM(PREP, (s) => s.replace(HAND_OVER, 'contentionFor(diagnostics.contentionTrace, input, ({} as never), diagnostics.baselinePlacements)')), 'Z4:hand-over-is-not-the-reviewed-same-run-call', PREP) && flags(auditM(PREP, (s) => `${s}\nexport const again = (r: never, d: never) => orchestrateConstructDayWithDiagnostics(r, d);`), 'Z4:second-orchestration-in-the-boundary', PREP) && flags(auditM(PREP, (s) => s.replace('return projectContentionAuthority(...args);', 'return projectContentionAuthority(...args)!;').replace('} catch {\n    return Object.freeze({ status: \'UNAVAILABLE\', reason: \'CAPTURE_FAILED\' });', '} finally {')), 'Z4:projection-call-is-not-the-isolated-wrapper', PREP) && flags(auditM(PREP, (s) => s.replace('inputs.map((input) => Object.freeze({ input, contention: contentionFor(', 'inputs.slice(0, 1).map((input) => Object.freeze({ input, contention: contentionFor(')), 'Z4:not-one-authority-per-promotion-input', PREP));
check('MUTATION: the search limit or the search / construction sites change -> detected', flags(auditM(SEARCH, (s) => s.replace('const DEFAULT_FIND_LIMIT = 3;', 'const DEFAULT_FIND_LIMIT = 6;')), 'Z5:default-find-limit-changed', SEARCH) && flags(auditM(ORCH, (s) => `${s}\nconst more = deps.searchTiming({} as never);`), 'Z5:search-or-construction-sites-changed', ORCH));
check('the mutations were applied to in-memory copies only: the real tree still has zero violations afterwards', audit(productionFiles()).length === 0);

if (!allPassed) {
  console.error('SOME PROMOTION CONTENTION AUTHORITY ARCHITECTURE CHECKS FAILED');
  process.exit(1);
}
console.log('ALL PROMOTION CONTENTION AUTHORITY ARCHITECTURE CHECKS PASSED');
