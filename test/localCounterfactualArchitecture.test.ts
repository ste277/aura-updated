/**
 * Constructor Decision Intelligence -- O5 P4b2: the PURE LOCAL COUNTERFACTUAL GENERATOR (architecture guard, pure).
 *
 * The generator answers one mechanical question -- "what happens if this pressured candidate is tried in one of its real historical contention
 * slots while every unrelated baseline placement stays pinned?" -- and nothing else. This guard pins that it:
 *
 *   - is PURE, synchronous and neutral: exactly seven reviewed imports (the comparator and the precedence comparator as values, everything else
 *     TYPES only), no database, clock, snapshot, timing search, Constructor / orchestrator / preparation / projection call, raw P3a trace, facts,
 *     evidence, pressure read, logging, environment or async
 *   - consumes ONLY the five same-run authorities (basis, placements, attempts, input, contention); P's slots come ONLY from the contention authority;
 *     owner alternatives are exactly initial UNION final UNION the owner's own attempts; ranking is ONLY the Constructor's exported comparator and the
 *     Constructor's precedence comparator (no trace order, no new ranking)
 *   - is LOCAL: only the promoted candidate and the authorized FLEXIBLE owners its slot terminally overlaps can move; non-owners, FIXED placements
 *     and undisturbed owners are pinned; no transitive displacement; no generic loop over intents; no global replan
 *   - carries a minimal local gate copy whose exact semantics are pinned here and compared with the REAL Constructor (as a test oracle only) by
 *     localCounterfactualGateParity.test.ts
 *   - is POLICY-FREE: no acceptance / safety / owner-pressure / FIXED-owner / non-owner-change / net-loss / timing-floor term, reason or branch
 *   - owns and freezes every output Date / array / object; never mutates an input; never throws
 *   - has ZERO production consumers, appears in no preview / signing / acceptance / persistence / route / schema surface, and leaves dayConstructor.ts,
 *     the precedence comparator and capacity untouched
 *
 * Every rule is a PURE FUNCTION over source files: it runs on the real tree (zero violations) AND on the tree with a synthetic violation injected.
 * P4b2 does not implement P4b3+, P5, R3 or S5.
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

const LOCAL = 'apps/web/lib/localCounterfactual.ts';
const CONSTRUCTOR = 'apps/web/lib/dayConstructor.ts';
const INTENT = 'apps/web/lib/dayIntent.ts';
const CAPACITY = 'apps/web/lib/dayCapacity.ts';
const ORCH = 'apps/web/lib/dayConstructorOrchestrator.ts';
const PREP = 'apps/web/lib/promotionInputPreparation.ts';
const SEARCH = 'packages/recommendation/src/timingSearch.ts';
const VOCAB = /\b(LocalCounterfactual[A-Za-z]*|generateLocalCounterfactual|evaluateLocalPlacementGate|CounterfactualPlacement[A-Za-z]*|LocalGate[A-Za-z]*)\b|localCounterfactual['"]/;
const LOCAL_IMPORTS = [
  `import { compareCandidatesForPlacement, type PlacementCandidate, type PlacementTimingFit } from './dayConstructor';`,
  `import { compareByOverloadPrecedence, type DayIntent } from './dayIntent';`,
  `import type { PromotionInput } from './promotionInput';`,
  `import type { PromotionContentionOutcome } from './promotionContentionAuthority';`,
  `import type { SchedulingAttemptOutcome } from './schedulingAttemptAuthority';`,
  `import type { ConstructionBasis, ConstructionBasisIntent, ConstructionBasisOutcome } from './constructionBasis';`,
  `import type { BaselinePlacementsOutcome } from './baselinePlacements';`,
];
const DB_VOCAB = /from '\.\/db'|\bpool\b|\.query\(|beginTransaction|withRepeatableReadSnapshot|prisma|INSERT|UPDATE|DELETE|loadDecisionSchedulingContext|schedulingContext/i;
const CLOCK_VOCAB = /Date\.now|new Date\(\)|performance\.now|hrtime/;
const SEARCH_VOCAB = /searchTiming|runTimingSearch|timingSearch|excludedIntervals|replenish/i;
/** Anything that would run a second construction, a preparation, a projection or a capture. */
const EXECUTION_VOCAB = /\bconstructDay\w*\(|orchestrate\w*\(|\bpreparePromotionInputs\b|\bprojectContentionAuthority\b|\bprojectSchedulingAttempts\b|\bnormalizeSchedulingAttempts\b|\bcaptureBaselinePlacements\b|\bassembleConstructionBasis\b|\bsortByOverloadPrecedence\b/;
const ASYNC_VOCAB = /\basync\b|\bawait\b|Promise|setTimeout|setInterval|console\.|logger|telemetry|fetch\(|require\(|process\.|\benv\b|featureFlag|isFeatureEnabled/;
const CLONE_SHORTCUT = /JSON\.(parse|stringify)|structuredClone|Object\.assign|deepFreeze|lodash/;
const RAW_TRACE_VOCAB = /ContentionEvent|ContentionTrace|ContentionAttempt|contentionTrace|from '\.\/contentionTrace'|\.events\b/;
const FACTS_PRESSURE_VOCAB = /pressure|DecisionPressure|LAST_KNOWN|DecisionFacts|decisionFacts|DecisionEvidence|decisionEvidence|recurrence|opportunity|scarcity|abovePressure|shadow/i;
const POLICY_VOCAB = /\bSAFE\b|\bUNSAFE\b|ACCEPT|REJECT|OWNER_PRESSURED|FIXED_OWNER|PRECEDENCE_NOT_TIE|NON_OWNER_CHANGED|NET_PROPOSED_LOSS|TIMING_FLOOR|shouldAccept|isSafe|isAcceptable|acceptance|\bpolicy\b/i;
const HISTORY_VOCAB = /candidatesByRound|roundCandidates|candidateHistory|\bround\b|\bhistory\b|replenished/i;
const NEVER = [
  CONSTRUCTOR, INTENT, CAPACITY, 'apps/web/lib/contentionTrace.ts', 'apps/web/lib/constructionBasis.ts', 'apps/web/lib/baselinePlacements.ts', 'apps/web/lib/promotionInput.ts', 'apps/web/lib/promotionContentionAuthority.ts',
  'apps/web/lib/schedulingAttemptAuthority.ts', PREP, ORCH, 'apps/web/lib/dayConstructorPreviewRequest.ts', 'apps/web/lib/dayConstructorPreviewIntegrity.ts', 'apps/web/lib/dayConstructorPreviewClient.ts',
  'apps/web/lib/dayConstructorAcceptance.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts', 'apps/web/lib/remainingDayRecomposition.ts', 'apps/web/lib/remainingDayRecompositionAcceptance.ts',
  'apps/web/lib/remainingDayRecompositionIntegrity.ts', 'apps/web/lib/remainingDayRecompositionServer.ts', 'apps/web/lib/homeRecomposition.ts', 'apps/web/lib/planMove.ts', 'apps/web/lib/homeMove.ts',
  'apps/web/lib/dayPlanPreviewPresentation.ts', 'apps/web/lib/dayPlanAcceptancePresentation.ts', 'apps/web/lib/db.ts', 'apps/web/lib/decisionFacts.ts', 'apps/web/lib/decisionEvidence.ts',
  'apps/web/lib/decisionFactPreparation.ts', 'apps/web/lib/decisionPressure.ts', 'apps/web/lib/goalDecisionFactsProvider.ts', 'apps/web/lib/decisionSchedulingContext.ts', 'apps/web/lib/decisionSchedulingContextLoader.ts',
  'apps/web/lib/abovePressurePrecedence.ts', 'apps/web/lib/shadowPressureEvaluation.ts', 'apps/web/lib/shadowPressureObservation.ts', 'apps/web/lib/opportunityProjection.ts', 'apps/web/lib/opportunityDecisionFacts.ts', SEARCH,
  'apps/web/app/api/day-constructor/preview/route.ts', 'apps/web/app/api/day-constructor/accept/route.ts', 'apps/web/app/api/day/recompose/route.ts', 'apps/web/app/api/plans/[planId]/move/route.ts', 'apps/web/app/api/plans/route.ts',
];

function audit(files: SrcFile[]): string[] {
  const v: string[] = [];
  const get = (f: string) => files.find((x) => x.f === f);
  const by = (re: RegExp) => files.filter((x) => re.test(x.src)).map((x) => x.f);
  const notIn = (list: string[], allow: string[]) => list.filter((f) => !allow.includes(f));
  // L1 -- confinement and ZERO production consumers
  notIn(by(VOCAB), [LOCAL]).forEach((f) => v.push(`L1:names-the-generator:${f}`));
  by(/from '\.\/localCounterfactual'/).forEach((f) => v.push(`L1:production-consumer-of-the-generator:${f}`));
  by(/\bgenerateLocalCounterfactual\(/).filter((f) => f !== LOCAL).forEach((f) => v.push(`L1:calls-the-generator:${f}`));
  for (const f of NEVER) { const x = get(f); if (x && (VOCAB.test(x.src) || /counterfactual/i.test(x.src))) v.push(`L1:surface-names-the-generator:${f}`); }
  const c = get(CONSTRUCTOR);
  if (c && JSON.stringify(Array.from(c.src.matchAll(/^export function (\w+)/gm)).map((x) => x[1])) !== JSON.stringify(['compareCandidatesForPlacement', 'constructDay', 'constructDayWithTrace'])) v.push(`L1:constructor-exports-changed:${CONSTRUCTOR}`);
  // L2 -- the module
  const m = get(LOCAL);
  if (m) {
    if (JSON.stringify(Array.from(m.src.matchAll(/^import [^\n]*;$/gm)).map((x) => x[0])) !== JSON.stringify(LOCAL_IMPORTS) || count(/^import (?!type )/gm, m.src) !== 2) v.push(`L2:imports-are-not-the-reviewed-seven:${LOCAL}`);
    if (DB_VOCAB.test(m.src)) v.push(`L2:database-or-snapshot:${LOCAL}`);
    if (CLOCK_VOCAB.test(m.src)) v.push(`L2:clock-read:${LOCAL}`);
    if (SEARCH_VOCAB.test(m.src)) v.push(`L2:timing-search-or-replenishment:${LOCAL}`);
    if (EXECUTION_VOCAB.test(m.src)) v.push(`L2:constructor-orchestration-preparation-or-projection-call:${LOCAL}`);
    if (ASYNC_VOCAB.test(m.src)) v.push(`L2:async-log-env-or-require:${LOCAL}`);
    if (CLONE_SHORTCUT.test(m.src)) v.push(`L2:json-structuredclone-or-generic-clone:${LOCAL}`);
    if (/\bany\b/.test(m.src)) v.push(`L2:any-escape:${LOCAL}`);
    if (RAW_TRACE_VOCAB.test(m.src)) v.push(`L2:raw-trace:${LOCAL}`);
    if (FACTS_PRESSURE_VOCAB.test(m.src)) v.push(`L2:facts-evidence-or-pressure-vocabulary:${LOCAL}`);
    if (POLICY_VOCAB.test(m.src)) v.push(`L2:policy-vocabulary:${LOCAL}`);
    if (HISTORY_VOCAB.test(m.src)) v.push(`L2:candidate-history-or-round:${LOCAL}`);
    if (/^(let|var) |^const \w+ = (new |\[|\{)/m.test(m.src)) v.push(`L2:module-level-state:${LOCAL}`);
    if (/\.reverse\(|\.toSorted\(|\.splice\(/.test(m.src)) v.push(`L2:in-place-reordering:${LOCAL}`);
    // owners: only their ids are ever read (so no pressure branch / order / filter is possible)
    if (!/const ownerIds = a\.input\.owners\.map\(\(owner\) => owner\.intentId\);/.test(m.src) || count(/\binput\.owners\b/g, m.src) !== 1 || /\.owners\[|\.pressure\b/.test(m.src)) v.push(`L2:owners-are-not-only-the-promotion-input-ids:${LOCAL}`);
    // ranking: ONLY the Constructor's exported comparator and the Constructor's precedence comparator
    const sorts = Array.from(m.src.matchAll(/\.sort\(([\s\S]*?)\);\n/g)).map((x) => x[1]);
    if (sorts.length !== 3 || sorts.some((s) => !/^\(a, b\) => (?:compareCandidatesForPlacement|compareByOverloadPrecedence)\(/.test(s.trim()))) v.push(`L2:ranking-is-not-only-the-two-constructor-comparators:${LOCAL}`);
    if (count(/compareCandidatesForPlacement\(/g, m.src) !== 2 || count(/compareByOverloadPrecedence\(/g, m.src) !== 1) v.push(`L2:comparator-call-sites-changed:${LOCAL}`);
    if (!/compareCandidatesForPlacement\(toPlacementCandidate\(candidateId, a\.start, a\.end, a\.timingFit\), toPlacementCandidate\(candidateId, b\.start, b\.end, b\.timingFit\)\)/.test(m.src) || !/compareCandidatesForPlacement\(toPlacementCandidate\(owner\.id, a\.start, a\.end, a\.alternative\.timingFit\), toPlacementCandidate\(owner\.id, b\.start, b\.end, b\.alternative\.timingFit\)\)/.test(m.src)) v.push(`L2:comparator-does-not-see-the-captured-timing-fit:${LOCAL}`);
    if (!/function toPlacementCandidate\([^)]*\): PlacementCandidate \{\s*return \{ intentId, start: new Date\(start\), end: new Date\(end\), timingFit, candidateOrder: 0 \};\s*\}/.test(m.src)) v.push(`L2:candidate-order-is-not-the-constant-zero:${LOCAL}`);
    if (!/compareByOverloadPrecedence\(a as unknown as DayIntent, b as unknown as DayIntent, basis\.planningDate\)/.test(m.src)) v.push(`L2:owner-order-is-not-the-constructor-precedence:${LOCAL}`);
    // P's slots: ONLY the contention authority (never the basis lists, the attempts directly or a reconstruction)
    if (!/for \(const attempt of contention\.attempts\) \{/.test(m.src) || count(/\bcontention\.attempts\b/g, m.src) < 3) v.push(`L2:p-slots-are-not-built-from-the-contention-authority:${LOCAL}`);
    if (count(/\binitialCandidates\b|\bfinalCandidates\b/g, m.src) !== 2) v.push(`L2:basis-candidate-lists-read-outside-the-owner-alternatives:${LOCAL}`);
    const ownerAltBody = (m.src.match(/function ownerAlternatives\([\s\S]*?\n\}\n/) ?? [''])[0];
    if (!/\[\.\.\.basis\.initialCandidates, \.\.\.basis\.finalCandidates\]/.test(ownerAltBody) || !/for \(const attempt of context\.attempts\) if \(attempt\.intentId === intentId\) add\(/.test(ownerAltBody) || count(/\binitialCandidates\b|\bfinalCandidates\b/g, ownerAltBody) !== 2) v.push(`L2:owner-alternatives-are-not-initial-union-final-union-own-attempts:${LOCAL}`);
    if (!/alternative\.start === start && alternative\.timingFit === timingFit/.test(ownerAltBody) || !/else if \(end > found\[existing\]\.end\)/.test(ownerAltBody)) v.push(`L2:dedup-identity-is-not-start-timing-fit:${LOCAL}`);
    if (/\.attempts\[\s*\d+\s*\]|\.attempts\.at\(|\.attempts\.find\(|\.attempts\.shift\(|\.attempts\.slice\(\s*0|\.attempts\.pop\(|attempts\[0\]/.test(m.src)) v.push(`L2:positional-selection-of-attempts:${LOCAL}`);
    // LOCAL SCOPE
    if (!/if \(terminal\.length === 0\) continue;/.test(m.src) || !/terminal\.some\(\(p\) => !ownerIds\.includes\(p\.intentId\) \|\| p\.source === 'FIXED_CONSTRAINT'\)\) continue;/.test(m.src)) v.push(`L2:slot-scope-rules-missing:${LOCAL}`);
    if (!/const displaced = overlapped\.map\(/.test(m.src) || !/const occupied: Span\[\] = placed\.filter\(\(p\) => !displacedIds\.includes\(p\.intentId\)\)/.test(m.src) || !/occupied\.push\(\{ start: new Date\(chosen\.start\), end: new Date\(chosen\.end\) \}\);/.test(m.src)) v.push(`L2:pinned-set-is-not-baseline-minus-displaced-plus-p:${LOCAL}`);
    if (!/evaluateLocalPlacementGate\(\{ intentId: owner\.id, start: new Date\(alternative\.start\), end: new Date\(alternative\.end\) \}, owner\.id, requiredOwnerMinutes, window, blockers, occupied\)/.test(m.src) || !/occupied\.push\(\{ start: new Date\(best\.start\), end: new Date\(best\.end\) \}\);/.test(m.src)) v.push(`L2:relocation-does-not-gate-against-pinned-p-and-relocated:${LOCAL}`);
    if (/for \(const \w+ of basis\.intents\)|basis\.intents\.(?:forEach|reduce|flatMap)\(|basis\.intents\.filter\(/.test(m.src) || count(/\bbasis\.intents\b/g, m.src) !== 4) v.push(`L2:generic-loop-over-intents-or-global-replan:${LOCAL}`);
    if (!/const displaced = overlapped\.map\(\(p\) => basis\.intents\.find\(\(intent\) => intent\.id === p\.intentId\)!\);/.test(m.src)) v.push(`L2:displaced-set-is-not-the-terminal-overlap:${LOCAL}`);
    if (/\bDeferred\b|\bdeferred\b/.test(m.src)) v.push(`L2:iterates-deferred-intents:${LOCAL}`);
    // THE LOCAL GATES (exact pinned semantics; parity-tested against the real Constructor)
    const gate = (m.src.match(/export function evaluateLocalPlacementGate\([\s\S]*?\n\}\n/) ?? [''])[0];
    const order = ['WRONG_INTENT', 'MALFORMED_CANDIDATE', 'INSUFFICIENT_DURATION', 'OUTSIDE_CONSTRUCTION_WINDOW', 'BLOCKED_BY_COMMITMENT', 'CONFLICTS_WITH_PROPOSED_ITEM'].map((r) => gate.indexOf(`reason: '${r}'`));
    if (order.some((i) => i < 0) || order.some((i, k) => k > 0 && i <= order[k - 1])) v.push(`L2:gate-order-or-reasons-changed:${LOCAL}`);
    if (!/function overlapsMs\(aStart: number, aEnd: number, bStart: number, bEnd: number\): boolean \{\s*return aStart < bEnd && bStart < aEnd;\s*\}/.test(m.src)) v.push(`L2:overlap-is-not-half-open:${LOCAL}`);
    if (!/if \(!\(start >= window\.start\.getTime\(\) && end <= window\.end\.getTime\(\)\)\) return \{ feasible: false, reason: 'OUTSIDE_CONSTRUCTION_WINDOW' \};/.test(gate)) v.push(`L2:window-boundary-changed:${LOCAL}`);
    if (!/const candidateMinutes = \(candidate\.end\.getTime\(\) - candidate\.start\.getTime\(\)\) \/ 60000;/.test(gate) || !/candidateMinutes < requiredMinutes\) return \{ feasible: false, reason: 'INSUFFICIENT_DURATION' \};/.test(gate) || !/const end = start \+ requiredMinutes \* 60000;/.test(gate)) v.push(`L2:duration-or-interval-derivation-changed:${LOCAL}`);
    if (!/blocker\.start\.getTime\(\) < blocker\.end\.getTime\(\) && overlapsMs\(start, end, blocker\.start\.getTime\(\), blocker\.end\.getTime\(\)\)/.test(gate) || !/placed\.some\(\(other\) => overlapsMs\(start, end, other\.start\.getTime\(\), other\.end\.getTime\(\)\)\)/.test(gate)) v.push(`L2:blocker-or-placed-overlap-changed:${LOCAL}`);
    if (!/candidate\.start\.getTime\(\) >= candidate\.end\.getTime\(\)\) return \{ feasible: false, reason: 'MALFORMED_CANDIDATE' \};/.test(gate) || !/Number\.isNaN\(candidate\.start\.getTime\(\)\)/.test(gate) || !/Number\.isNaN\(candidate\.end\.getTime\(\)\)/.test(gate)) v.push(`L2:malformed-gate-changed:${LOCAL}`);
    if (!/candidate\.intentId !== intentId\) return \{ feasible: false, reason: 'WRONG_INTENT' \};/.test(gate)) v.push(`L2:wrong-intent-gate-changed:${LOCAL}`);
    // P SLOT VALIDITY: the exact duration and the same gate; an invalid slot fails closed, only window / blocker rejections skip
    if (!/if \(end - start !== requiredMs\) return fail\('INVALID_INTERVAL'\);/.test(m.src) || !/if \(verdict\.reason === 'OUTSIDE_CONSTRUCTION_WINDOW' \|\| verdict\.reason === 'BLOCKED_BY_COMMITMENT'\) continue;\s*return unavailable\('INVALID_INTERVAL'\);/.test(m.src)) v.push(`L2:p-slot-validity-changed:${LOCAL}`);
    // OUTPUT: detached, owned, frozen; never throws
    const dateArgs = Array.from(m.src.matchAll(/new Date\(([^)]*)\)/g)).map((x) => x[1]);
    if (dateArgs.length < 1 || dateArgs.some((arg) => !/^(?:ms|start|end|NaN|(?:slot|p|chosen|alternative|best)\.(?:start|end))$/.test(arg)) || /new Date\([^)]*getTime/.test(m.src)) v.push(`L2:date-aliased-or-copied-from-a-source-object:${LOCAL}`);
    if (!/function placement\([^)]*\): CounterfactualPlacement \{\s*return Object\.freeze\(\{ intentId, start: ownDate\(start\), end: ownDate\(end\), placementSource, \.\.\.\(timingFit === undefined \? \{\} : \{ timingFit \}\) \}\);\s*\}/.test(m.src) || count(/Object\.freeze\(\{ intentId, start/g, m.src) !== 1) v.push(`L2:output-placement-is-not-built-from-owned-dates:${LOCAL}`);
    if (!/function ownDate\(ms: number\): Date \{\s*return Object\.freeze\(new Date\(ms\)\);\s*\}/.test(m.src)) v.push(`L2:output-date-is-not-an-owned-frozen-copy:${LOCAL}`);
    if (count(/Object\.freeze\(/g, m.src) < 9) v.push(`L2:output-not-frozen:${LOCAL}`);
    if (!/export function generateLocalCounterfactual\(authorities: LocalCounterfactualAuthorities\): LocalCounterfactualOutcome \{\s*try \{[\s\S]*\} catch \{\s*return unavailable\('GENERATION_FAILED'\);\s*\}\s*\}/.test(m.src)) v.push(`L2:generation-can-throw-or-has-a-different-signature:${LOCAL}`);
    if (/\.push\(\)|\bdelete \b|\.length = 0|\bObject\.defineProperty\b|\b(?:a|authorities)\.[A-Za-z.]+\s*=[^=]/.test(m.src)) v.push(`L2:mutates-an-input:${LOCAL}`);
    // CONTRACT
    const exportsList = Array.from(m.src.matchAll(/^export (?:async )?(?:function|interface|type|const|class) (\w+)/gm)).map((x) => x[1]);
    if (JSON.stringify(exportsList) !== JSON.stringify(['LocalCounterfactualAuthorities', 'CounterfactualPlacementSource', 'CounterfactualPlacement', 'LocalCounterfactual', 'LocalCounterfactualUnavailableReason', 'LocalCounterfactualOutcome', 'LocalGateFailure', 'LocalGateVerdict', 'evaluateLocalPlacementGate', 'generateLocalCounterfactual'])) v.push(`L2:exports-changed:${LOCAL}`);
    const fields = (name: string) => Array.from(((m.src.match(new RegExp(`export interface ${name} \\{[\\s\\S]*?\\n\\}`)) ?? [''])[0]).matchAll(/readonly (\w+)\??:/g)).map((x) => x[1]);
    if (JSON.stringify(fields('LocalCounterfactualAuthorities')) !== JSON.stringify(['constructionBasis', 'baselinePlacements', 'schedulingAttempts', 'input', 'contention'])) v.push(`L2:input-contract-is-not-the-five-authorities:${LOCAL}`);
    if (JSON.stringify(fields('LocalCounterfactual')) !== JSON.stringify(['candidateIntentId', 'promotedPlacement', 'displacedOwnerIds', 'relocatedPlacements', 'unplacedOwnerIds', 'counterfactualPlacements'])) v.push(`L2:output-contract-changed:${LOCAL}`);
    if (JSON.stringify(fields('CounterfactualPlacement')) !== JSON.stringify(['intentId', 'start', 'end', 'placementSource', 'timingFit'])) v.push(`L2:placement-contract-changed:${LOCAL}`);
    const sources = (m.src.match(/export type CounterfactualPlacementSource = ([^;]+);/) ?? ['', ''])[1].replace(/\s/g, '');
    if (sources !== "'BASELINE_UNCHANGED'|'PROMOTED_CONTENTION_ATTEMPT'|'RELOCATED_CAPTURED_CANDIDATE'") v.push(`L2:placement-sources-changed:${LOCAL}`);
    const reasons = (m.src.match(/export type LocalCounterfactualUnavailableReason = ([^;]+);/) ?? ['', ''])[1].replace(/\s/g, '');
    if (reasons !== "'RUN_NOT_READY'|'INCONSISTENT_AUTHORITY'|'INVALID_INTERVAL'|'NO_ACTIONABLE_PROMOTION_SLOT'|'GENERATION_FAILED'") v.push(`L2:unavailable-reasons-are-not-generation-and-integrity-only:${LOCAL}`);
    // REVALIDATION
    if (!/a\.constructionBasis\.status !== 'READY' \|\| a\.baselinePlacements\.status !== 'READY' \|\| a\.schedulingAttempts\.status !== 'READY' \|\| a\.contention\.status !== 'READY'\) return fail\('RUN_NOT_READY'\)/.test(m.src)) v.push(`L2:authority-readiness-not-required:${LOCAL}`);
    if (!/contention\.candidateIntentId !== candidateId\) return fail\('INCONSISTENT_AUTHORITY'\)/.test(m.src) || !/contention\.attempts\.some\(\(attempt\) => !ownerIds\.includes\(attempt\.ownerIntentId\)\)\) return fail\('INCONSISTENT_AUTHORITY'\)/.test(m.src) || !/ownerIds\.some\(\(id\) => !contention\.attempts\.some\(\(attempt\) => attempt\.ownerIntentId === id\)\)\) return fail\('INCONSISTENT_AUTHORITY'\)/.test(m.src)) v.push(`L2:pair-or-owner-scope-revalidation-missing:${LOCAL}`);
    if (!/if \(baseline\.some\(\(p\) => p\.intentId === candidateId\)\) return fail\('INCONSISTENT_AUTHORITY'\);/.test(m.src) || !/intentIds\.filter\(\(id\) => id === candidateId\)\.length !== 1\) return fail\('INCONSISTENT_AUTHORITY'\)/.test(m.src) || !/ownerIds\.some\(\(id\) => id === candidateId \|\| !intentIds\.includes\(id\) \|\| !baseline\.some\(\(p\) => p\.intentId === id\)\)\) return fail\('INCONSISTENT_AUTHORITY'\)/.test(m.src)) v.push(`L2:candidate-or-owner-revalidation-missing:${LOCAL}`);
    if (!/overlapsMs\(placed\[i\]\.start, placed\[i\]\.end, placed\[j\]\.start, placed\[j\]\.end\)\) return fail\('INCONSISTENT_AUTHORITY'\)/.test(m.src) || !/new Set\(placedIds\)\.size !== placedIds\.length\) return fail\('INCONSISTENT_AUTHORITY'\)/.test(m.src)) v.push(`L2:placement-revalidation-missing:${LOCAL}`);
  }
  // L3 -- the Constructor, the precedence comparator and capacity are untouched by (and do not know) the generator
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
check(`THE REAL PRODUCTION TREE HAS ZERO LOCAL-COUNTERFACTUAL ARCHITECTURE VIOLATIONS (${real.length} production files scanned)${baseline.length ? ': ' + baseline.join(', ') : ''}`, baseline.length === 0);

console.log('=== zero consumers, confinement, untouched scheduling code ===');
check('ZERO PRODUCTION CONSUMERS: the generator vocabulary exists in exactly ONE production file (itself); nothing imports it and nothing calls it -- tests only', JSON.stringify(names(VOCAB)) === JSON.stringify([LOCAL]) && names(/from '\.\/localCounterfactual'/).length === 0 && JSON.stringify(names(/\bgenerateLocalCounterfactual\(/)) === JSON.stringify([LOCAL]));
check('NOT PUBLIC / SIGNED / PERSISTED / ACCEPTED: no preview, signing, acceptance, persistence, Recomposition, Move, presentation, route, scheduling-context, trace, basis, placements, input, contention, attempts or promotion-preparation module names the generator or the word counterfactual', NEVER.every((f) => !VOCAB.test(src(f)) && !/counterfactual/i.test(src(f))));
const migrationSql = fs.readdirSync(path.join(root, 'apps/web/prisma/migrations'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => fs.readFileSync(path.join(root, 'apps/web/prisma/migrations', e.name, 'migration.sql'), 'utf8'));
check('NO PERSISTENCE, NO SCHEMA: the Prisma schema and all 43 migration directories mention no counterfactual; no migration was added', !/counterfactual/i.test(read('apps/web/prisma/schema.prisma')) && migrationSql.length === 43 && migrationSql.every((s) => !/counterfactual/i.test(s)));
check('THE CONSTRUCTOR IS UNTOUCHED: dayConstructor.ts still exports exactly the comparator, `constructDay` and `constructDayWithTrace`; dayConstructor.ts, dayIntent.ts and dayCapacity.ts name no generator vocabulary (their behavior hashes are pinned by the P0c guard)', !flags(audit(real), 'L1:constructor-exports-changed') && [CONSTRUCTOR, INTENT, CAPACITY].every((f) => !VOCAB.test(src(f)) && !/counterfactual/i.test(src(f))));
const dateGuard = read('test/schedulingDateMutatorArchitecture.test.ts');
check('#208 SCOPE: the generator is on the protected Date-mutator list (zero exceptions); the regex-literal scanner debt is carried unchanged', dateGuard.includes(`file: '${LOCAL}'`) && /ZERO EXCEPTIONS in the protected modules/.test(dateGuard));
const ci = read('.github/workflows/ci.yml');
check('REQUIRED CI: the behavior, gate-parity and architecture suites are mandatory steps in the pure job', ['localCounterfactual.test.ts', 'localCounterfactualGateParity.test.ts', 'localCounterfactualArchitecture.test.ts'].every((t) => ci.includes(`npx ts-node test/${t}`)));
const parity = read('test/localCounterfactualGateParity.test.ts');
check('PARITY ORACLE IS TEST-ONLY: the gate-parity suite imports the REAL `constructDay` as an oracle; the production generator never does', /import \{ constructDay[^}]*\} from '\.\.\/apps\/web\/lib\/dayConstructor'/.test(parity) && !/\bconstructDay\b/.test(src(LOCAL)));

console.log('=== the generator is pure, neutral and policy-free ===');
const mod = src(LOCAL);
check('IMPORTS: exactly seven -- the comparator and the precedence comparator as values, five authority TYPES -- hence no Constructor execution, search, database, clock, orchestrator, preparation or raw trace can be reached', JSON.stringify(Array.from(mod.matchAll(/^import [^\n]*;$/gm)).map((x) => x[0])) === JSON.stringify(LOCAL_IMPORTS) && count(/^import (?!type )/gm, mod) === 2);
check('NO DATABASE, SNAPSHOT, CLOCK, SEARCH, CONSTRUCTOR, ASYNC, LOGGING, ENVIRONMENT, GENERIC CLONE or `any`', !DB_VOCAB.test(mod) && !CLOCK_VOCAB.test(mod) && !SEARCH_VOCAB.test(mod) && !EXECUTION_VOCAB.test(mod) && !ASYNC_VOCAB.test(mod) && !CLONE_SHORTCUT.test(mod) && !/\bany\b/.test(mod));
check('NO RAW TRACE, NO FACTS / EVIDENCE / PRESSURE: the generator never names a contention event or trace, DecisionFacts, DecisionEvidence, scarcity, recurrence, opportunity or pressure; owners are read ONLY by id', !RAW_TRACE_VOCAB.test(mod) && !FACTS_PRESSURE_VOCAB.test(mod) && !flags(audit(real), 'L2:owners-are-not-only'));
check('NO POLICY: none of SAFE / UNSAFE / ACCEPT / REJECT / OWNER_PRESSURED / FIXED_OWNER / PRECEDENCE_NOT_TIE / NON_OWNER_CHANGED / NET_PROPOSED_LOSS / TIMING_FLOOR appears, and the UNAVAILABLE taxonomy is generation / integrity only', !POLICY_VOCAB.test(mod) && !flags(audit(real), 'L2:unavailable-reasons'));
check('NO CANDIDATE HISTORY, NO ROUND', !HISTORY_VOCAB.test(mod));
check('RANKING IS ONLY THE CONSTRUCTOR\'S: exactly three sorts -- P\'s slots and the owner alternatives by the exported `compareCandidatesForPlacement` over the CAPTURED timing fit (candidateOrder is the constant 0: equal fit + equal start is the same placement), the displaced owners by the Constructor\'s `compareByOverloadPrecedence`; no discovery order, no positional selection of attempts', !flags(audit(real), 'L2:ranking') && !flags(audit(real), 'L2:comparator') && !flags(audit(real), 'L2:candidate-order') && !flags(audit(real), 'L2:owner-order') && !flags(audit(real), 'L2:positional'));
check('SLOT AND ALTERNATIVE AUTHORITY: P\'s slots are built only from the contention authority; the basis candidate lists are read only inside the owner-alternatives function, which is exactly initial UNION final UNION the owner\'s OWN attempts, deduplicated by (start, timingFit)', !flags(audit(real), 'L2:p-slots') && !flags(audit(real), 'L2:basis-candidate-lists') && !flags(audit(real), 'L2:owner-alternatives') && !flags(audit(real), 'L2:dedup-identity'));
check('LOCAL SCOPE: P\'s slot must terminally overlap something, and only authorized FLEXIBLE owners; the pinned set is baseline minus the displaced owners plus P; every relocation is gated against the pinned set, P and the owners already re-placed; there is no generic loop over intents, no Deferred iteration, no global replan', !flags(audit(real), 'L2:slot-scope') && !flags(audit(real), 'L2:pinned-set') && !flags(audit(real), 'L2:relocation') && !flags(audit(real), 'L2:generic-loop') && !flags(audit(real), 'L2:displaced-set') && !flags(audit(real), 'L2:iterates-deferred'));
check('THE LOCAL GATES are exactly the Constructor\'s (order, half-open overlap, inclusive window, derived interval, positive-length blockers) -- proven equal to the REAL Constructor by the gate-parity suite', !flags(audit(real), 'L2:gate') && !flags(audit(real), 'L2:overlap') && !flags(audit(real), 'L2:window') && !flags(audit(real), 'L2:duration') && !flags(audit(real), 'L2:blocker') && !flags(audit(real), 'L2:malformed') && !flags(audit(real), 'L2:wrong-intent') && !flags(audit(real), 'L2:p-slot-validity'));
check('FIVE-AUTHORITY REVALIDATION AND FAIL-CLOSED: every authority must be READY; the pair, the candidate (exactly once, unplaced, FLEXIBLE), the owners (distinct, placed, not the candidate), the contention owner scope and per-owner support, and the placements (unique, disjoint, in the window, off the blockers) are checked; malformed instants fail closed; generation never throws', !flags(audit(real), 'L2:authority-readiness') && !flags(audit(real), 'L2:pair-or-owner') && !flags(audit(real), 'L2:candidate-or-owner') && !flags(audit(real), 'L2:placement-revalidation') && !flags(audit(real), 'L2:generation-can-throw'));
check('OWNERSHIP AND FREEZE: every output Date is a new frozen `new Date(ms)` built from a number (no alias of a source Date); the output is deeply frozen; no input is mutated', !flags(audit(real), 'L2:output-date') && !flags(audit(real), 'L2:output-placement') && !flags(audit(real), 'L2:date-aliased') && !flags(audit(real), 'L2:output-not-frozen') && !flags(audit(real), 'L2:mutates-an-input') && !flags(audit(real), 'L2:in-place'));
check('CONTRACT: input is exactly the five authorities; output is exactly { candidateIntentId, promotedPlacement, displacedOwnerIds, relocatedPlacements, unplacedOwnerIds, counterfactualPlacements }; placements carry a counterfactual-local source (the baseline contract is untouched); exports are the ten reviewed names', !flags(audit(real), 'L2:exports-changed') && !flags(audit(real), 'L2:input-contract') && !flags(audit(real), 'L2:output-contract') && !flags(audit(real), 'L2:placement-contract') && !flags(audit(real), 'L2:placement-sources'));

console.log('=== MUTATIONS: each violation, injected into an in-memory copy, is detected ===');
const rep = (from: string, to: string) => (s: string) => { if (!s.includes(from)) throw new Error(`mutation target missing: ${from.slice(0, 60)}`); return s.replace(from, to); };
check('MUTATION: a NON-OWNER becomes releasable, an undisturbed owner is released, a FIXED owner may be moved -> detected', flags(auditM(LOCAL, rep("terminal.some((p) => !ownerIds.includes(p.intentId) || p.source === 'FIXED_CONSTRAINT')", "terminal.some((p) => p.source === 'FIXED_CONSTRAINT')")), 'L2:slot-scope-rules-missing', LOCAL) && flags(auditM(LOCAL, rep("terminal.some((p) => !ownerIds.includes(p.intentId) || p.source === 'FIXED_CONSTRAINT')", "terminal.some((p) => !ownerIds.includes(p.intentId))")), 'L2:slot-scope-rules-missing', LOCAL) && flags(auditM(LOCAL, rep('const displaced = overlapped.map(', 'const displaced = ownerIds.map(')), 'L2:', LOCAL) && flags(auditM(LOCAL, rep("if (terminal.length === 0) continue;", '')), 'L2:slot-scope-rules-missing', LOCAL));
check('MUTATION: DISCOVERY ORDER ranks P (the slot sort removed or replaced by position), the captured timing fit is IGNORED, the owner alternatives are ranked by origin -> detected', flags(auditM(LOCAL, rep('const ranked = [...slots].sort(', 'const ranked = [...slots].filter(() => true).concat([]); void (')), 'L2:', LOCAL) && flags(auditM(LOCAL, rep('toPlacementCandidate(candidateId, a.start, a.end, a.timingFit), toPlacementCandidate(candidateId, b.start, b.end, b.timingFit)', 'toPlacementCandidate(candidateId, a.start, a.end, undefined), toPlacementCandidate(candidateId, b.start, b.end, undefined)')), 'L2:comparator-does-not-see-the-captured-timing-fit', LOCAL) && flags(auditM(LOCAL, rep("usable.sort((a, b) => compareCandidatesForPlacement(", "usable.sort((a, b) => (a.alternative.start - b.alternative.start) || compareCandidatesForPlacement(")), 'L2:', LOCAL) && flags(auditM(LOCAL, (s) => `${s}\nexport const pick = (a: { attempts: unknown[] }) => a.attempts[0];`), 'L2:positional-selection-of-attempts', LOCAL));
check('MUTATION: the ATTEMPT-ONLY owner alternative is dropped, the INITIAL candidates are dropped, the FINAL candidates are dropped, or an owner\'s alternatives come from a foreign owner\'s attempts -> detected', flags(auditM(LOCAL, rep('  for (const attempt of context.attempts) if (attempt.intentId === intentId) add(attempt.start, attempt.end, attempt.timingFit);\n', '')), 'L2:owner-alternatives', LOCAL) && flags(auditM(LOCAL, rep('[...basis.initialCandidates, ...basis.finalCandidates]', '[...basis.finalCandidates]')), 'L2:owner-alternatives', LOCAL) && flags(auditM(LOCAL, rep('[...basis.initialCandidates, ...basis.finalCandidates]', '[...basis.initialCandidates]')), 'L2:owner-alternatives', LOCAL) && flags(auditM(LOCAL, rep('if (attempt.intentId === intentId) add(', 'add(')), 'L2:owner-alternatives', LOCAL));
check('MUTATION: candidate ORIGIN affects ranking / dedup identity (origin in the identity, or a longer span replaced by the first source) -> detected', flags(auditM(LOCAL, rep('alternative.start === start && alternative.timingFit === timingFit', 'alternative.start === start')), 'L2:dedup-identity-is-not-start-timing-fit', LOCAL) && flags(auditM(LOCAL, rep('else if (end > found[existing].end) found[existing] = { start, end, timingFit };', 'else found[existing] = found[existing];')), 'L2:dedup-identity-is-not-start-timing-fit', LOCAL));
check('MUTATION: PRESSURE affects generation (an owner pressure read, a branch, an ordering or a filter) -> detected', flags(auditM(LOCAL, rep('const ownerIds = a.input.owners.map((owner) => owner.intentId);', "const ownerIds = a.input.owners.filter((owner) => owner.pressure !== 'LAST_KNOWN_OPPORTUNITY').map((owner) => owner.intentId);")), 'L2:', LOCAL) && flags(auditM(LOCAL, (s) => `${s}\nexport const p = (o: { pressure: string }) => o.pressure === 'NONE';`), 'L2:facts-evidence-or-pressure-vocabulary', LOCAL));
check('MUTATION: TRANSITIVE DISPLACEMENT (relocation gated only against the pinned set, or a relocated owner not added to the occupied set) and a GLOBAL REPLAN (a generic loop over intents, a Deferred iteration) -> detected', flags(auditM(LOCAL, rep('owner.id, requiredOwnerMinutes, window, blockers, occupied)', 'owner.id, requiredOwnerMinutes, window, blockers, [])')), 'L2:relocation-does-not-gate', LOCAL) && flags(auditM(LOCAL, rep("      occupied.push({ start: new Date(best.start), end: new Date(best.end) });\n", '')), 'L2:relocation-does-not-gate', LOCAL) && flags(auditM(LOCAL, rep('const displaced = overlapped.map((p) => basis.intents.find((intent) => intent.id === p.intentId)!);', 'const displaced = basis.intents.filter((intent) => intent.flexibility === \'FLEXIBLE\');')), 'L2:', LOCAL) && flags(auditM(LOCAL, (s) => `${s}\nexport const all = (b: { intents: { id: string }[] }) => { for (const i of basis.intents) void i; };`), 'L2:generic-loop-over-intents-or-global-replan', LOCAL));
check('MUTATION: a timing SEARCH, a Constructor / orchestration call, a DB access, a clock read, async / logging -> detected', flags(auditM(LOCAL, (s) => `${s}\nexport const x = () => searchTiming();`), 'L2:timing-search', LOCAL) && flags(auditM(LOCAL, (s) => `${s}\nexport const c = () => constructDay({} as never);`), 'L2:constructor-orchestration', LOCAL) && flags(auditM(LOCAL, (s) => `${s}\nexport const q = () => pool.query('SELECT 1');`), 'L2:database', LOCAL) && flags(auditM(LOCAL, (s) => `${s}\nexport const t = () => Date.now();`), 'L2:clock-read', LOCAL) && flags(auditM(LOCAL, (s) => `${s}\nexport const a = async () => 1;`), 'L2:async', LOCAL) && flags(auditM(LOCAL, (s) => `import { constructDay } from './dayConstructor';\n${s}`), 'L2:imports-are-not-the-reviewed-seven', LOCAL));
check('MUTATION: the RAW TRACE is imported or read (a contention event / trace import, `.events`) -> detected', flags(auditM(LOCAL, (s) => `import type { ContentionTrace } from './contentionTrace';\n${s}`), 'L2:raw-trace', LOCAL) && flags(auditM(LOCAL, (s) => `${s}\nexport const e = (t: { events: unknown[] }) => t.events;`), 'L2:raw-trace', LOCAL));
check('MUTATION: a policy term / reason (OWNER_PRESSURED, FIXED_OWNER, NET_PROPOSED_LOSS, TIMING_FLOOR, SAFE, ACCEPT) is introduced -> detected', flags(auditM(LOCAL, (s) => s.replace("| 'GENERATION_FAILED';", "| 'GENERATION_FAILED' | 'FIXED_OWNER';")), 'L2:', LOCAL) && flags(auditM(LOCAL, (s) => `${s}\nexport const r = 'OWNER_PRESSURED';`), 'L2:policy-vocabulary', LOCAL) && flags(auditM(LOCAL, (s) => `${s}\nexport const r = 'NET_PROPOSED_LOSS';`), 'L2:policy-vocabulary', LOCAL) && flags(auditM(LOCAL, (s) => `${s}\nexport const r = 'TIMING_FLOOR_VIOLATED';`), 'L2:policy-vocabulary', LOCAL));
check('MUTATION: an input is MUTATED, a Date is SHARED (aliased) with a source object, the output is UNFROZEN -> detected', flags(auditM(LOCAL, (s) => `${s}\nexport const m = (a: { constructionBasis: { status: string } }) => { a.constructionBasis.status = 'x'; };`), 'L2:mutates-an-input', LOCAL) && flags(auditM(LOCAL, rep('function ownDate(ms: number): Date {\n  return Object.freeze(new Date(ms));\n}', 'function ownDate(ms: number): Date {\n  return new Date(ms);\n}')), 'L2:output-date-is-not-an-owned-frozen-copy', LOCAL) && flags(auditM(LOCAL, (s) => s.split('Object.freeze(').join('(')), 'L2:output-not-frozen', LOCAL) && flags(auditM(LOCAL, (s) => s.replace('start: ownDate(start), end: ownDate(end)', 'start: new Date(start), end: new Date(end)')), 'L2:output-placement-is-not-built-from-owned-dates', LOCAL) && flags(auditM(LOCAL, (s) => s.replace('start: ownDate(start), end: ownDate(end)', 'start: sourceDate, end: ownDate(end)')), 'L2:output-placement-is-not-built-from-owned-dates', LOCAL));
check('MUTATION: TOUCHING counts as overlap, the window boundary is wrong, the duration validation is skipped, a MALFORMED interval is chosen -> detected', flags(auditM(LOCAL, rep('return aStart < bEnd && bStart < aEnd;', 'return aStart <= bEnd && bStart <= aEnd;')), 'L2:overlap-is-not-half-open', LOCAL) && flags(auditM(LOCAL, rep('start >= window.start.getTime() && end <= window.end.getTime()', 'start > window.start.getTime() && end < window.end.getTime()')), 'L2:window-boundary-changed', LOCAL) && flags(auditM(LOCAL, rep("candidateMinutes < requiredMinutes) return { feasible: false, reason: 'INSUFFICIENT_DURATION' };", 'false) return { feasible: false, reason: \'INSUFFICIENT_DURATION\' };')), 'L2:duration-or-interval-derivation-changed', LOCAL) && flags(auditM(LOCAL, rep("if (candidate.start.getTime() >= candidate.end.getTime()) return { feasible: false, reason: 'MALFORMED_CANDIDATE' };", '')), 'L2:malformed-gate-changed', LOCAL) && flags(auditM(LOCAL, rep("if (end - start !== requiredMs) return fail('INVALID_INTERVAL');", '')), 'L2:p-slot-validity-changed', LOCAL));
check('MUTATION: the revalidation is weakened (authority readiness, pair id, contention owner scope, owner support, candidate state, placement consistency) -> detected', flags(auditM(LOCAL, rep(" || a.contention.status !== 'READY'", '')), 'L2:authority-readiness-not-required', LOCAL) && flags(auditM(LOCAL, rep("if (contention.candidateIntentId !== candidateId) return fail('INCONSISTENT_AUTHORITY');", '')), 'L2:pair-or-owner-scope-revalidation-missing', LOCAL) && flags(auditM(LOCAL, rep("if (contention.attempts.some((attempt) => !ownerIds.includes(attempt.ownerIntentId))) return fail('INCONSISTENT_AUTHORITY');", '')), 'L2:pair-or-owner-scope-revalidation-missing', LOCAL) && flags(auditM(LOCAL, rep("if (baseline.some((p) => p.intentId === candidateId)) return fail('INCONSISTENT_AUTHORITY');", '')), 'L2:candidate-or-owner-revalidation-missing', LOCAL) && flags(auditM(LOCAL, rep("if (new Set(placedIds).size !== placedIds.length) return fail('INCONSISTENT_AUTHORITY');", '')), 'L2:placement-revalidation-missing', LOCAL));
check('MUTATION: PUBLIC WIRING / a production consumer (a route, the preview request, the preparation boundary or a new module imports or names the generator) -> detected', ['apps/web/lib/dayConstructorPreviewRequest.ts', 'apps/web/lib/dayConstructorPreviewIntegrity.ts', 'apps/web/lib/dayConstructorAcceptance.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts', 'apps/web/app/api/day-constructor/preview/route.ts', 'apps/web/app/api/day-constructor/accept/route.ts', 'apps/web/lib/db.ts', PREP, ORCH, CONSTRUCTOR].every((f) => flags(auditM(f, (s) => `${s}\nexport const p = 'LocalCounterfactual';`), 'L1:', f)) && flags(audit(addFile(real, 'apps/web/lib/rogueConsumer.ts', "import { generateLocalCounterfactual } from './localCounterfactual';\nexport const g = generateLocalCounterfactual;")), 'L1:production-consumer-of-the-generator', 'apps/web/lib/rogueConsumer.ts'));
check('MUTATION: the Constructor is modified to export a private helper (a changed export list) -> detected', flags(auditM(CONSTRUCTOR, (s) => s.replace('function intervalsOverlap(', 'export function intervalsOverlap(')), 'L1:constructor-exports-changed', CONSTRUCTOR));
check('MUTATION: the generator mutates a baseline placement by changing the output shape (extra contract field, extra source, a policy reason) -> detected', flags(auditM(LOCAL, rep('readonly counterfactualPlacements: readonly CounterfactualPlacement[];', 'readonly counterfactualPlacements: readonly CounterfactualPlacement[];\n  readonly safe: boolean;')), 'L2:output-contract-changed', LOCAL) && flags(auditM(LOCAL, rep("| 'RELOCATED_CAPTURED_CANDIDATE';", "| 'RELOCATED_CAPTURED_CANDIDATE' | 'FIXED_CONSTRAINT';")), 'L2:placement-sources-changed', LOCAL));
check('the mutations were applied to in-memory copies only: the real tree still has zero violations afterwards', audit(productionFiles()).length === 0);

if (!allPassed) {
  console.error('SOME LOCAL COUNTERFACTUAL ARCHITECTURE CHECKS FAILED');
  process.exit(1);
}
console.log('ALL LOCAL COUNTERFACTUAL ARCHITECTURE CHECKS PASSED');
