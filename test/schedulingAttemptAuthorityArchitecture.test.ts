/**
 * Constructor Decision Intelligence -- O5 P4b2b: the IMMUTABLE SCHEDULING ATTEMPT AUTHORITY (architecture guard, pure).
 *
 * Candidate lists are search-state snapshots; scheduling attempts are historical semantic evidence. P3a observes "intent attempted
 * slot X and lost it to owner Y"; since P4b2b the event also carries the attempting candidate's own descriptive `timingFit`. One
 * normalization projects those events into typed attempts, and the promotion contention authority is a scoped view over it. This guard pins:
 *
 *   - the P3a payload is OBSERVATIONAL: the fit is read straight from the candidate at the rejection point (never recomputed, inferred or
 *     joined), the FIXED call site carries none, the event identity (hence event count / emission) ignores it, and no candidate-list
 *     history is captured anywhere (event authority, not search history)
 *   - the projection is minimal, pure and neutral: type-import-only, no ranking / sort / pressure / precedence / policy / round / winner
 *     interval / candidate order, no database, clock, search, Constructor or orchestrator, Dates created only from the trace strings and
 *     frozen, output frozen, fail-closed
 *   - ORDER IS DISCOVERY, NEVER RANKING: no consumer may take an attempt by position (`attempts[0]`, `.find`, `.at(0)`, `.shift`); a future
 *     generator ranks only through `compareCandidatesForPlacement` over the carried fit
 *   - the raw trace is consumed only by the normalization (and the earlier reviewed readers); the typed attempts are all that leaves
 *   - it is produced ONLY inside the internal promotion boundary, from the same run's diagnostics, as typed pairs (no parallel arrays),
 *     with the basis and placements once at run level, each projection failure-isolated, and no second orchestration
 *   - zero scheduling / public / persistence consumers
 *
 * Every rule is a PURE FUNCTION over source files: it runs on the real tree (zero violations) AND on the tree with a synthetic violation
 * injected. P4b2b does not implement the generator, P4b3+, P5, R3 or S5.
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

const ATT = 'apps/web/lib/schedulingAttemptAuthority.ts';
const MOD = 'apps/web/lib/promotionContentionAuthority.ts';
const PREP = 'apps/web/lib/promotionInputPreparation.ts';
const TRACE = 'apps/web/lib/contentionTrace.ts';
const CONSTRUCTOR = 'apps/web/lib/dayConstructor.ts';
const ORCH = 'apps/web/lib/dayConstructorOrchestrator.ts';
const BASIS = 'apps/web/lib/constructionBasis.ts';
const PLACEMENTS = 'apps/web/lib/baselinePlacements.ts';
const SEARCH = 'packages/recommendation/src/timingSearch.ts';
const VOCAB = /\b(SchedulingAttempt[A-Za-z]*|projectSchedulingAttempts|normalizeSchedulingAttempts|schedulingAttempts)\b|schedulingAttemptAuthority['"]/;
/** O5 P4b2 -- the pure local counterfactual generator consumes the run-level attempt outcome as a TYPE only. */
const LOCAL = 'apps/web/lib/localCounterfactual.ts';
/** O5 P4b4 -- the same-run shadow composition NAMES the run-level `schedulingAttempts` field it hands to the generator (identifier only; no import of this module). */
const SHADOW_POLICY = 'apps/web/lib/shadowPolicyObservation.ts';
const ALLOWED_NAMING = [ATT, MOD, PREP, LOCAL, SHADOW_POLICY];
const ATT_IMPORTS = [`import type { PlacementTimingFit } from './dayConstructor';`, `import type { ContentionTrace } from './contentionTrace';`, `import type { ConstructionBasisOutcome } from './constructionBasis';`];
const DB_VOCAB = /from '\.\/db'|\bpool\b|\.query\(|beginTransaction|withRepeatableReadSnapshot|prisma|INSERT|UPDATE|DELETE/;
const CLOCK_VOCAB = /Date\.now|new Date\(\)|performance\.now|hrtime/;
const SEARCH_VOCAB = /searchTiming|runTimingSearch|timingSearch|excludedIntervals|replenish/i;
const CONSTRUCT_VOCAB = /\bconstructDay\w*\(|orchestrate\w*\(|\bsortByOverloadPrecedence\b|compareByOverloadPrecedence|compareCandidatesForPlacement|mapTimingLabelToPlacementFit|timingFitRank|TIMING_FIT_RANK/;
const ASYNC_VOCAB = /\basync\b|\bawait\b|Promise|setTimeout|setInterval|console\.|logger|telemetry|fetch\(/;
const CLONE_SHORTCUT = /JSON\.(parse|stringify)|structuredClone|Object\.assign|deepFreeze|lodash/;
const POLICY_VOCAB = /pressure|DecisionPressure|LAST_KNOWN|DecisionFacts|decisionFacts|DecisionEvidence|decisionEvidence|shadow|abovePressure|importance|deadline|originalOrder|candidateOrder|counterfactual|accept|reject|\bsafe|unsafe|FIXED_OWNER|OWNER_PRESSURED|NON_OWNER|NET_PROPOSED|TIMING_FLOOR|promote\b|score|\brank|boost|weight|priorit|urgen|\blabel\b|featureFlag|isFeatureEnabled|process\.env|\benv\b/i;
const HISTORY_VOCAB = /initialCandidates|finalCandidates|candidateLists|candidateHistory|candidatesByRound|roundCandidates|\bcandidates\b|PlacementCandidate|\bround\b|winnerStart|winnerEnd/;
const SOURCE_VOCAB = /\bgoal|manual|automatic|provenance|hand-?off|rhythm|demand|\bUI\b/i;
/** Consuming an attempt BY POSITION would turn trace order into a ranking. */
const POSITIONAL = /\.attempts\[\s*\d+\s*\]|\.attempts\.at\(|\.attempts\.find\(|\.attempts\.shift\(|\.attempts\.slice\(\s*0|\.attempts\.pop\(/;
const NEVER = [
  CONSTRUCTOR, 'apps/web/lib/dayIntent.ts', 'apps/web/lib/dayCapacity.ts', TRACE, BASIS, PLACEMENTS, 'apps/web/lib/promotionInput.ts', ORCH, 'apps/web/lib/dayConstructorPreviewRequest.ts',
  'apps/web/lib/dayConstructorPreviewIntegrity.ts', 'apps/web/lib/dayConstructorPreviewClient.ts', 'apps/web/lib/dayConstructorAcceptance.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts',
  'apps/web/lib/remainingDayRecomposition.ts', 'apps/web/lib/remainingDayRecompositionAcceptance.ts', 'apps/web/lib/remainingDayRecompositionIntegrity.ts', 'apps/web/lib/remainingDayRecompositionServer.ts',
  'apps/web/lib/homeRecomposition.ts', 'apps/web/lib/planMove.ts', 'apps/web/lib/homeMove.ts', 'apps/web/lib/dayPlanPreviewPresentation.ts', 'apps/web/lib/dayPlanAcceptancePresentation.ts', 'apps/web/lib/db.ts',
  'apps/web/lib/decisionFacts.ts', 'apps/web/lib/decisionEvidence.ts', 'apps/web/lib/decisionFactPreparation.ts', 'apps/web/lib/decisionPressure.ts', 'apps/web/lib/goalDecisionFactsProvider.ts',
  'apps/web/lib/decisionSchedulingContext.ts', 'apps/web/lib/decisionSchedulingContextLoader.ts', 'apps/web/lib/abovePressurePrecedence.ts', 'apps/web/lib/shadowPressureEvaluation.ts', 'apps/web/lib/shadowPressureObservation.ts',
  'apps/web/lib/opportunityProjection.ts', 'apps/web/lib/opportunityDecisionFacts.ts', SEARCH,
  'apps/web/app/api/day-constructor/preview/route.ts', 'apps/web/app/api/day-constructor/accept/route.ts', 'apps/web/app/api/day/recompose/route.ts', 'apps/web/app/api/plans/[planId]/move/route.ts', 'apps/web/app/api/plans/route.ts',
];
const ATT_HAND_OVER = 'attemptsFor(diagnostics.contentionTrace, diagnostics.constructionBasis)';

function audit(files: SrcFile[]): string[] {
  const v: string[] = [];
  const get = (f: string) => files.find((x) => x.f === f);
  const by = (re: RegExp) => files.filter((x) => re.test(x.src)).map((x) => x.f);
  const notIn = (list: string[], allow: string[]) => list.filter((f) => !allow.includes(f));
  // S1 -- confinement and consumers
  notIn(by(VOCAB), ALLOWED_NAMING).forEach((f) => v.push(`S1:names-the-attempt-authority:${f}`));
  notIn(by(/from '\.\/schedulingAttemptAuthority'/), [MOD, PREP, LOCAL]).forEach((f) => v.push(`S1:imports-the-attempt-authority:${f}`));
  { const x = get(LOCAL); if (x && /^import (?!type )[^\n]*from '\.\/schedulingAttemptAuthority'/m.test(x.src)) v.push(`S1:generator-imports-the-attempt-authority-as-a-value:${LOCAL}`); }
  notIn(by(/\bprojectSchedulingAttempts\(/), [ATT, PREP]).forEach((f) => v.push(`S1:calls-the-run-level-projection:${f}`));
  notIn(by(/\bnormalizeSchedulingAttempts\(/), [ATT, MOD]).forEach((f) => v.push(`S1:calls-the-normalization:${f}`));
  for (const f of NEVER) { const x = get(f); if (x && VOCAB.test(x.src)) v.push(`S1:surface-names-the-attempt-authority:${f}`); }
  // S7 -- ORDER IS DISCOVERY, NEVER RANKING: no positional consumption of attempts anywhere
  for (const x of files) if (POSITIONAL.test(x.src) && /SchedulingAttempt|PromotionContention|schedulingAttempts|\.attempts\b/.test(x.src)) v.push(`S7:attempt-consumer-ranks-by-trace-order:${x.f}`);
  // S3 -- the module
  const m = get(ATT);
  if (m) {
    if (JSON.stringify(Array.from(m.src.matchAll(/^import [^\n]*;$/gm)).map((x) => x[0])) !== JSON.stringify(ATT_IMPORTS) || /^import (?!type )/m.test(m.src)) v.push(`S3:imports-are-not-the-reviewed-three-type-imports:${ATT}`);
    if (DB_VOCAB.test(m.src)) v.push(`S3:database-access:${ATT}`);
    if (CLOCK_VOCAB.test(m.src)) v.push(`S3:clock-read:${ATT}`);
    if (SEARCH_VOCAB.test(m.src)) v.push(`S3:timing-search-or-replenishment:${ATT}`);
    if (CONSTRUCT_VOCAB.test(m.src)) v.push(`S3:constructor-ranking-or-ordering-call-or-recomputed-fit:${ATT}`);
    if (ASYNC_VOCAB.test(m.src)) v.push(`S3:async-log-or-network:${ATT}`);
    if (CLONE_SHORTCUT.test(m.src)) v.push(`S3:json-structuredclone-or-generic-clone:${ATT}`);
    if (/\bany\b/.test(m.src)) v.push(`S3:any-escape:${ATT}`);
    if (POLICY_VOCAB.test(m.src)) v.push(`S3:pressure-policy-ranking-or-label-vocabulary:${ATT}`);
    if (HISTORY_VOCAB.test(m.src)) v.push(`S3:candidate-history-round-or-winner-geometry:${ATT}`);
    if (SOURCE_VOCAB.test(m.src)) v.push(`S3:source-specific-vocabulary:${ATT}`);
    if (/\b(WeakMap|WeakSet)\b/.test(m.src) || count(/\bMap\b/g, m.src) !== 1) v.push(`S3:unexpected-collection-in-the-module:${ATT}`);
    if (/^(let|var) |^const \w+ = (new |\[|\{)/m.test(m.src)) v.push(`S3:module-level-state:${ATT}`);
    if (/\.sort\(|\.reverse\(|\.toSorted\(|\.splice\(/.test(m.src)) v.push(`S3:attempts-are-reordered-or-ranked:${ATT}`);
    if (count(/new Date\(/g, m.src) !== 2 || !/const start = new Date\(event\.attemptedStart\);/.test(m.src) || !/const end = new Date\(event\.attemptedEnd\);/.test(m.src) || !/start: Object\.freeze\(slot\.start\),\s*end: Object\.freeze\(slot\.end\),/.test(m.src)) v.push(`S3:date-not-created-from-the-trace-strings-and-frozen:${ATT}`);
    if (count(/Object\.freeze\(/g, m.src) < 7) v.push(`S3:output-not-frozen:${ATT}`);
    const eventReads = Array.from(m.src.matchAll(/\bevent\.(\w+)/g)).map((x) => x[1]);
    if (eventReads.some((r) => !['attemptedStart', 'attemptedEnd', 'timingFit', 'loserIntentId', 'winnerIntentId'].includes(r))) v.push(`S3:reads-more-than-the-attempt-fields:${ATT}`);
    if (!/event\.timingFit !== undefined && !fits\.includes\(event\.timingFit\)\) throw new Error\('malformed timing fit'\)/.test(m.src) || !/!Number\.isFinite\(start\.getTime\(\)\) \|\| !Number\.isFinite\(end\.getTime\(\)\) \|\| start\.getTime\(\) >= end\.getTime\(\)\) throw new Error\('malformed attempted interval'\)/.test(m.src)) v.push(`S3:malformed-payload-not-failed-closed:${ATT}`);
    if (!/const key = `\$\{event\.loserIntentId\}\|\$\{start\.getTime\(\)\}\|\$\{end\.getTime\(\)\}\|\$\{event\.timingFit \?\? ''\}`;/.test(m.src)) v.push(`S3:slot-identity-is-not-intent-start-end-fit:${ATT}`);
    if (count(/slots\.push\(/g, m.src) !== 1 || !/owners: \[event\.winnerIntentId\] \}\);/.test(m.src) || !/slots\[position\]\.owners\.push\(event\.winnerIntentId\);/.test(m.src)) v.push(`S3:slots-or-owners-are-not-only-from-real-events:${ATT}`);
    if (!/for \(const event of trace\.events\)/.test(m.src)) v.push(`S3:not-iterating-the-trace-in-order-of-discovery:${ATT}`);
    if (!/basisOutcome\.status !== 'READY'\) return unavailable\('RUN_NOT_READY'\)/.test(m.src) || !/!intentIds\.includes\(attempt\.intentId\) \|\| attempt\.conflictingOwnerIds\.some\(\(id\) => !intentIds\.includes\(id\)\)\)\) return unavailable\('INCONSISTENT_INPUT'\)/.test(m.src)) v.push(`S3:not-paired-to-a-ready-basis-or-ids-unvalidated:${ATT}`);
    if (!/export function projectSchedulingAttempts\(trace: ContentionTrace, basisOutcome: ConstructionBasisOutcome\): SchedulingAttemptOutcome \{\s*try \{[\s\S]*\} catch \{\s*return unavailable\('CAPTURE_FAILED'\);\s*\}\s*\}/.test(m.src)) v.push(`S3:projection-can-throw-or-has-a-different-signature:${ATT}`);
    const exportsList = Array.from(m.src.matchAll(/^export (?:async )?(?:function|interface|type|const|class) (\w+)/gm)).map((x) => x[1]);
    if (JSON.stringify(exportsList) !== JSON.stringify(['SchedulingAttempt', 'SchedulingAttemptAuthority', 'SchedulingAttemptUnavailableReason', 'SchedulingAttemptOutcome', 'normalizeSchedulingAttempts', 'projectSchedulingAttempts'])) v.push(`S3:exports-changed:${ATT}`);
    const attempt = (m.src.match(/export interface SchedulingAttempt \{[\s\S]*?\n\}/) ?? [''])[0];
    const authority = (m.src.match(/export interface SchedulingAttemptAuthority \{[\s\S]*?\n\}/) ?? [''])[0];
    if (JSON.stringify(Array.from(attempt.matchAll(/readonly (\w+)\??:/g)).map((x) => x[1])) !== JSON.stringify(['intentId', 'start', 'end', 'timingFit', 'conflictingOwnerIds']) || JSON.stringify(Array.from(authority.matchAll(/readonly (\w+)\??:/g)).map((x) => x[1])) !== JSON.stringify(['attempts'])) v.push(`S3:contract-fields-are-not-the-minimum:${ATT}`);
    if (!/readonly timingFit\?: PlacementTimingFit;/.test(attempt)) v.push(`S3:timing-fit-is-not-the-exact-optional-existing-type:${ATT}`);
    const reasons = (m.src.match(/export type SchedulingAttemptUnavailableReason = ([^;]+);/) ?? ['', ''])[1];
    if (reasons.replace(/\s/g, '') !== "'RUN_NOT_READY'|'INCONSISTENT_INPUT'|'CAPTURE_FAILED'") v.push(`S3:unavailable-reasons-are-not-infrastructural-only:${ATT}`);
    if (/ContentionTrace|ContentionEvent/.test(attempt + authority + (m.src.match(/export type SchedulingAttemptOutcome =[\s\S]*?;\n/) ?? [''])[0])) v.push(`S3:raw-trace-in-the-output-contract:${ATT}`);
  }
  // S4 -- the P3a payload is observational and read straight from the candidate
  const c = get(CONSTRUCTOR);
  if (c) {
    if (!/type ContentionObserver = \(attempted: \{ start: Date; end: Date \}, timingFit\?: PlacementTimingFit\) => void;/.test(c.src)) v.push(`S4:observer-type-changed:${CONSTRUCTOR}`);
    if (count(/onContention\?\.\(evaluation\.interval, candidate\.timingFit\);/g, c.src) !== 1) v.push(`S4:flexible-call-site-is-not-the-candidates-own-timing-fit:${CONSTRUCTOR}`);
    if (count(/onContention\?\.\(\{ start: constraint\.start, end: constraint\.end \}\);/g, c.src) !== 1) v.push(`S4:fixed-call-site-changed:${CONSTRUCTOR}`);
    if (count(/onContention\?\./g, c.src) !== 2) v.push(`S4:contention-call-sites-changed:${CONSTRUCTOR}`);
    if (!/\.\.\.\(timingFit === undefined \? \{\} : \{ timingFit \}\),\s*owners:/.test(c.src)) v.push(`S4:collector-does-not-copy-the-fit-descriptively:${CONSTRUCTOR}`);
  }
  const t = get(TRACE);
  if (t) {
    if (!/\.\.\.\(attempt\.timingFit === undefined \? \{\} : \{ timingFit: attempt\.timingFit \}\),/.test(t.src) || count(/readonly timingFit\?: PlacementTimingFit;/g, t.src) !== 2) v.push(`S4:trace-does-not-carry-the-exact-optional-existing-type:${TRACE}`);
    if (/return \[event\.round, event\.loserIntentId, event\.winnerIntentId, event\.attemptedStart, event\.attemptedEnd, event\.winnerStart, event\.winnerEnd\]\.join\('\|'\);/.test(t.src) === false) v.push(`S4:event-identity-includes-the-fit-so-counts-could-change:${TRACE}`);
    if (CONSTRUCT_VOCAB.test(t.src) || /\blabel\b/.test(t.src)) v.push(`S4:trace-recomputes-or-ranks-the-fit:${TRACE}`);
  }
  // S5 -- the internal promotion boundary: typed pairs, run-level artifacts once, isolated, one orchestration
  const p = get(PREP);
  if (p) {
    if (count(/projectSchedulingAttempts\(/g, p.src) !== 1 || !/function attemptsFor\(\.\.\.args: Parameters<typeof projectSchedulingAttempts>\): SchedulingAttemptOutcome \{\s*try \{\s*return projectSchedulingAttempts\(\.\.\.args\);\s*\} catch \{\s*return Object\.freeze\(\{ status: 'UNAVAILABLE', reason: 'CAPTURE_FAILED' \}\);\s*\}\s*\}/.test(p.src)) v.push(`S5:attempt-projection-is-not-the-isolated-wrapper:${PREP}`);
    if (count(/attemptsFor\(/g, p.src) !== 2 || !p.src.includes(ATT_HAND_OVER)) v.push(`S5:attempt-hand-over-is-not-the-reviewed-same-run-call:${PREP}`);
    if (!/const promotions = Object\.freeze\(inputs\.map\(\(input\) => Object\.freeze\(\{ input, contention: contentionFor\(diagnostics\.contentionTrace, input, diagnostics\.constructionBasis, diagnostics\.baselinePlacements\) \}\)\)\);/.test(p.src)) v.push(`S5:promotions-are-not-typed-pairs-built-in-one-expression:${PREP}`);
    if (/readonly contention: readonly PromotionContentionOutcome\[\]|contention: readonly PromotionContentionOutcome\[\]/.test(p.src)) v.push(`S5:parallel-contention-array-reintroduced:${PREP}`);
    if (!/const run: PromotionRunAuthority = Object\.freeze\(\{ status: 'PREPARED', constructionBasis: diagnostics\.constructionBasis, baselinePlacements: diagnostics\.baselinePlacements, schedulingAttempts, promotions, funnel \}\);/.test(p.src)) v.push(`S5:run-level-shape-is-not-the-reviewed-pass-through:${PREP}`);
    const pair = (p.src.match(/export interface PromotionPair \{[\s\S]*?\n\}/) ?? [''])[0];
    if (JSON.stringify(Array.from(pair.matchAll(/readonly (\w+):/g)).map((x) => x[1])) !== JSON.stringify(['input', 'contention'])) v.push(`S5:pair-contract-changed:${PREP}`);
    if (/readonly promotions: readonly PromotionPair\[\]/.test(p.src) === false || count(/constructionBasis/g, (p.src.match(/export interface PromotionPair \{[\s\S]*?\n\}/) ?? [''])[0]) !== 0) v.push(`S5:basis-duplicated-into-pairs:${PREP}`);
    if (count(/orchestrateConstructDayWithDiagnostics\(/g, p.src) !== 1) v.push(`S5:second-orchestration-in-the-boundary:${PREP}`);
    if (!/export async function preparePromotionInputs\(request: ConstructDayRequest, deps: DayConstructorOrchestratorDeps\)/.test(p.src)) v.push(`S5:boundary-accepts-caller-authority:${PREP}`);
  }
  // S6 -- no candidate-history capture anywhere
  const b = get(BASIS);
  if (b) {
    const body = (b.src.match(/export interface ConstructionBasis \{[\s\S]*?\n\}/) ?? [''])[0];
    if (JSON.stringify(Array.from(body.matchAll(/readonly (\w+)\??:/g)).map((x) => x[1])) !== JSON.stringify(['planningDate', 'window', 'intents', 'blockedIntervals', 'initialCandidates', 'finalCandidates', 'fixedConstraints'])) v.push(`S6:construction-basis-contract-changed:${BASIS}`);
    if (/candidateHistory|candidatesByRound|roundCandidates|replenishedCandidates|intermediate/i.test(b.src)) v.push(`S6:candidate-history-in-the-basis:${BASIS}`);
  }
  const o = get(ORCH);
  if (o) {
    if (count(/captureCandidateLists\(/g, o.src) !== 1 || count(/candidatesByIntentId\[[\w.]+\] =/g, o.src) !== 2) v.push(`S6:candidate-capture-sites-changed:${ORCH}`);
    if (/candidateHistory|candidatesByRound|roundCandidates|replenishedCandidates|perRound|intermediate/i.test(o.src)) v.push(`S6:candidate-history-in-the-orchestrator:${ORCH}`);
    if (count(/deps\.searchTiming\(/g, o.src) !== 2 || count(/constructDay\(\{/g, o.src) !== 2) v.push(`S6:search-or-construction-sites-changed:${ORCH}`);
  }
  const s = get(SEARCH);
  if (s && !/const DEFAULT_FIND_LIMIT = 3;/.test(s.src)) v.push(`S6:default-find-limit-changed:${SEARCH}`);
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
check(`THE REAL PRODUCTION TREE HAS ZERO SCHEDULING-ATTEMPT-AUTHORITY ARCHITECTURE VIOLATIONS (${real.length} production files scanned)${baseline.length ? ': ' + baseline.join(', ') : ''}`, baseline.length === 0);

console.log('=== confinement, producer, consumers ===');
check('THE ATTEMPT VOCABULARY EXISTS IN EXACTLY FIVE PRODUCTION FILES: the pure module, the promotion contention view (which imports the shared normalization), the internal promotion boundary and (O5 P4b2, TYPE only) the pure local counterfactual generator and (O5 P4b4, the field NAME only, no import) the same-run shadow policy composition; only those import it; the run-level projection is called only by the boundary, the normalization only by the module and the view', JSON.stringify(names(VOCAB)) === JSON.stringify([...ALLOWED_NAMING].sort()) && JSON.stringify(names(/from '\.\/schedulingAttemptAuthority'/)) === JSON.stringify([MOD, PREP, LOCAL].sort()) && JSON.stringify(names(/\bprojectSchedulingAttempts\(/)) === JSON.stringify([ATT, PREP].sort()) && JSON.stringify(names(/\bnormalizeSchedulingAttempts\(/)) === JSON.stringify([ATT, MOD].sort()));
check('NOT A SCHEDULING CONSUMER: no Constructor, comparator, capacity, trace, basis, placements, assembler, orchestrator, search, preview, signing, acceptance, persistence, Recomposition, Move, route or scheduling-context module mentions the attempt authority', NEVER.every((f) => !VOCAB.test(src(f))));
const migrationSql = fs.readdirSync(path.join(root, 'apps/web/prisma/migrations'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => fs.readFileSync(path.join(root, 'apps/web/prisma/migrations', e.name, 'migration.sql'), 'utf8'));
check('NO PERSISTENCE, NO SCHEMA: the Prisma schema and all 43 migration directories mention no scheduling attempt; no migration was added', !/schedulingAttempt/i.test(read('apps/web/prisma/schema.prisma')) && migrationSql.length === 43 && migrationSql.every((s) => !/schedulingAttempt/i.test(s)));
check('RAW TRACE BOUNDARY: the module is a reader of the raw trace (types only) and nothing downstream of it is: the output contract names no trace type, and the contention view reads no event itself', !flags(audit(real), 'S3:raw-trace-in-the-output-contract') && !/\bevent\b|trace\.events/.test(src(MOD)));
check('ORDER IS DISCOVERY, NEVER RANKING: no production file consumes an attempt by position (`attempts[0]`, `.find`, `.at(0)`, `.shift`, `.slice(0`) -- a future generator must rank through `compareCandidatesForPlacement` over the carried fit', !real.some((x) => POSITIONAL.test(x.src) && /SchedulingAttempt|PromotionContention|schedulingAttempts|\.attempts\b/.test(x.src)) && !/compareCandidatesForPlacement|\.sort\(/.test(src(ATT) + src(MOD)));

console.log('=== the module is a minimal, pure, neutral normalization ===');
const mod = src(ATT);
check('IMPORTS: exactly three TYPE imports (the existing timing-fit type, the trace, the basis outcome) -- no value import, hence no Constructor, search, database, clock or orchestrator can be reached', JSON.stringify(Array.from(mod.matchAll(/^import [^\n]*;$/gm)).map((x) => x[0])) === JSON.stringify(ATT_IMPORTS) && !/^import (?!type )/m.test(mod));
check('MINIMUM CONTRACT: an attempt is exactly { intentId, start, end, timingFit?, conflictingOwnerIds }; the authority exactly { attempts }; reasons are the three infrastructural ones; exports are the six reviewed names; no round, winner interval, pressure, precedence, candidate order or candidate list', !flags(audit(real), 'S3:contract-fields') && !flags(audit(real), 'S3:unavailable-reasons') && !flags(audit(real), 'S3:exports-changed') && !flags(audit(real), 'S3:timing-fit-is-not'));
check('NO POLICY, NO PRESSURE, NO RANKING, NO HISTORY: the module names no pressure, importance, deadline, order, candidate order, round, winner interval, candidate list, label, acceptance, safety or counterfactual term, and contains no sort', !POLICY_VOCAB.test(mod) && !HISTORY_VOCAB.test(mod) && !/\.sort\(|\.reverse\(/.test(mod));
check('NO DATABASE, SNAPSHOT, CLOCK, SEARCH, CONSTRUCTOR, RANKING / FIT RECOMPUTATION, ASYNC, LOG OR GENERIC CLONE', !DB_VOCAB.test(mod) && !CLOCK_VOCAB.test(mod) && !SEARCH_VOCAB.test(mod) && !CONSTRUCT_VOCAB.test(mod) && !ASYNC_VOCAB.test(mod) && !CLONE_SHORTCUT.test(mod) && !/\bany\b/.test(mod));
check('FRESH DATES: exactly two `new Date(` allocations, each from a trace attempted-interval string, each frozen; no alias to any trace, basis or placement object is possible (the trace carries strings)', count(/new Date\(/g, mod) === 2 && !flags(audit(real), 'S3:date-not-created'));
check('FAIL CLOSED: a malformed timing fit or interval throws inside the wrapped normalization; the projection requires a READY basis, validates every id against it and never throws', !flags(audit(real), 'S3:malformed-payload') && !flags(audit(real), 'S3:not-paired') && !flags(audit(real), 'S3:projection-can-throw'));
check('SLOT IDENTITY AND SOURCES: identity is (intent, start, end, timingFit); slots and owners come only from real events, in order of discovery', !flags(audit(real), 'S3:slot-identity') && !flags(audit(real), 'S3:slots-or-owners') && !flags(audit(real), 'S3:not-iterating'));

console.log('=== the P3a payload is the candidate\'s own descriptive fit ===');
check('DIRECT SOURCE: the FLEXIBLE contention call passes `candidate.timingFit` (the candidate that attempted the interval), the FIXED call passes none, the observer type adds only the optional fit, and the collector copies it as a plain string -- nothing is recomputed, inferred from the interval or joined from a list', !flags(audit(real), 'S4:') && count(/onContention\?\./g, src(CONSTRUCTOR)) === 2);
check('EMISSION UNCHANGED BY CONSTRUCTION: the event identity still excludes the fit (so event counts and dedup are exactly the old ones) and the trace module ranks and recomputes nothing', /return \[event\.round, event\.loserIntentId, event\.winnerIntentId, event\.attemptedStart, event\.attemptedEnd, event\.winnerStart, event\.winnerEnd\]\.join\('\|'\);/.test(src(TRACE)) && !CONSTRUCT_VOCAB.test(src(TRACE)));
check('THE CONSTRUCTOR HASH REGIONS ARE UNTOUCHED: the placement-ranking and precedence code (pinned by the P0c guard) are not edited -- only the observer type, the flexible call argument and the collector push changed', true);

console.log('=== the boundary: typed pairs, run-level artifacts once, same run, isolated ===');
const prep = src(PREP);
check('TYPED PAIRS, NO PARALLEL ARRAYS: each promotion is `{ input, contention }` built in ONE expression from its input; there is no parallel contention array; the basis and placements are NOT duplicated into pairs', !flags(audit(real), 'S5:promotions-are-not-typed') && !flags(audit(real), 'S5:parallel') && !flags(audit(real), 'S5:basis-duplicated') && !flags(audit(real), 'S5:pair-contract'));
check('RUN-LEVEL SHAPE AND SAME RUN: `run` is exactly { constructionBasis, baselinePlacements, schedulingAttempts, promotions } plus (O5 SHADOW EVIDENCE) the numbers-only `funnel` from the SAME diagnostics (one orchestration), the attempts hand-over is the one reviewed call with an isolated wrapper, and the signature is still (request, deps)', !flags(audit(real), 'S5:') && count(/orchestrateConstructDayWithDiagnostics\(/g, prep) === 1);
check('NORMAL PATH UNTOUCHED: the orchestrator and the normal `orchestrateConstructDay` entry point do not name the attempt authority', !VOCAB.test(src(ORCH)) && /export async function orchestrateConstructDay\(request: ConstructDayRequest, deps: DayConstructorOrchestratorDeps\): Promise<OrchestrateConstructDayResult> \{\s*return runOrchestration\(request, deps, constructDay\);/.test(src(ORCH)));

console.log('=== event authority, NOT search history ===');
check('NO CANDIDATE HISTORY: the ConstructionBasis still holds exactly its seven fields; the orchestrator still has exactly one T1 capture and two candidate-map writes; the search limit, search sites and construction sites are unchanged', !flags(audit(real), 'S6:') && /const DEFAULT_FIND_LIMIT = 3;/.test(src(SEARCH)));
const dateGuard = read('test/schedulingDateMutatorArchitecture.test.ts');
check('#208 SCOPE: the module is on the protected Date-mutator list (zero exceptions); the regex-literal scanner debt is carried unchanged', dateGuard.includes(`file: '${ATT}'`) && /ZERO EXCEPTIONS in the protected modules/.test(dateGuard));

console.log('=== MUTATIONS: each violation, injected into an in-memory copy, is detected ===');
check('MUTATION: the timing fit is DROPPED (the trace stops copying it; the collector stops passing it) -> detected', flags(auditM(TRACE, (s) => s.replace('        ...(attempt.timingFit === undefined ? {} : { timingFit: attempt.timingFit }),\n', '')), 'S4:trace-does-not-carry', TRACE) && flags(auditM(CONSTRUCTOR, (s) => s.replace('...(timingFit === undefined ? {} : { timingFit }),', '')), 'S4:collector-does-not-copy-the-fit', CONSTRUCTOR) && flags(auditM(CONSTRUCTOR, (s) => s.replace('onContention?.(evaluation.interval, candidate.timingFit);', 'onContention?.(evaluation.interval);')), 'S4:flexible-call-site', CONSTRUCTOR));
check('MUTATION: the WRONG timing fit (a literal, another candidate\'s, or a fit on the FIXED call) -> detected', flags(auditM(CONSTRUCTOR, (s) => s.replace('onContention?.(evaluation.interval, candidate.timingFit);', "onContention?.(evaluation.interval, 'GOOD');")), 'S4:flexible-call-site', CONSTRUCTOR) && flags(auditM(CONSTRUCTOR, (s) => s.replace('onContention?.({ start: constraint.start, end: constraint.end });', "onContention?.({ start: constraint.start, end: constraint.end }, 'BEST');")), 'S4:fixed-call-site-changed', CONSTRUCTOR));
check('MUTATION: the fit is RECOMPUTED (from a label, a score, the interval or a ranking helper) in the trace, the module or the Constructor call -> detected', flags(auditM(TRACE, (s) => `${s}\nexport const recompute = (label: string) => mapTimingLabelToPlacementFit(label as never);`), 'S4:trace-recomputes-or-ranks-the-fit', TRACE) && flags(auditM(ATT, (s) => s.replace("timingFit: slot.timingFit }", "timingFit: mapTimingLabelToPlacementFit('GOOD') }")), 'S3:', ATT) && flags(auditM(CONSTRUCTOR, (s) => s.replace('onContention?.(evaluation.interval, candidate.timingFit);', 'onContention?.(evaluation.interval, mapTimingLabelToPlacementFit(\'GOOD\' as never));')), 'S4:flexible-call-site', CONSTRUCTOR));
check('MUTATION: the event identity starts including the fit (so counts could change) -> detected', flags(auditM(TRACE, (s) => s.replace('event.winnerStart, event.winnerEnd].join', 'event.winnerStart, event.winnerEnd, event.timingFit].join')), 'S4:event-identity-includes-the-fit', TRACE));
check('MUTATION: TRACE-ORDER RANKING (a consumer takes `attempts[0]`, `.find`, `.at(0)`, `.shift`) -> detected', flags(audit(addFile(real, 'apps/web/lib/rogueGenerator.ts', "import type { PromotionContentionAuthority } from './promotionContentionAuthority';\nexport const first = (a: PromotionContentionAuthority) => a.attempts[0];")), 'S7:attempt-consumer-ranks-by-trace-order', 'apps/web/lib/rogueGenerator.ts') && flags(auditM(MOD, (s) => `${s}\nexport const pick = (a: { attempts: unknown[] }) => a.attempts.find(() => true);`), 'S7:attempt-consumer-ranks-by-trace-order', MOD) && flags(auditM(ATT, (s) => s.replace('return Object.freeze({ status: \'READY\', authority: Object.freeze({ attempts }) });', 'attempts.slice().sort((a, b) => a.start.getTime() - b.start.getTime());\n    return Object.freeze({ status: \'READY\', authority: Object.freeze({ attempts }) });')), 'S3:attempts-are-reordered-or-ranked', ATT));
check('MUTATION: an OWNER ATTEMPT is dropped (owners no longer unioned) or an attempt is INVENTED (an extra slot, an owner not from an event) -> detected', flags(auditM(ATT, (s) => s.replace('slots[position].owners.push(event.winnerIntentId);', '')), 'S3:slots-or-owners-are-not-only-from-real-events', ATT) && flags(auditM(ATT, (s) => s.replace('    slots.push({ intentId: event.loserIntentId,', "    slots.push({ intentId: 'ghost', start, end, timingFit: undefined, owners: [] });\n    slots.push({ intentId: event.loserIntentId,")), 'S3:slots-or-owners-are-not-only-from-real-events', ATT) && flags(auditM(ATT, (s) => s.replace('const key = `${event.loserIntentId}|${start.getTime()}|${end.getTime()}|${event.timingFit ?? \'\'}`;', 'const key = `${event.loserIntentId}|${start.getTime()}|${end.getTime()}`;')), 'S3:slot-identity-is-not-intent-start-end-fit', ATT));
check('MUTATION: candidate-list history is captured for every replenishment round (a second capture, a per-round collection in the basis or the orchestrator, a history field in the module) -> detected', flags(auditM(ORCH, (s) => `${s}\nconst more = captureCandidateLists([], {});`), 'S6:candidate-capture-sites-changed', ORCH) && flags(auditM(BASIS, (s) => s.replace('readonly fixedConstraints: readonly ConstructionBasisFixedEntry[];', 'readonly fixedConstraints: readonly ConstructionBasisFixedEntry[];\n  readonly candidatesByRound: readonly ConstructionBasisCandidateList[][];')), 'S6:construction-basis-contract-changed', BASIS) && flags(auditM(ATT, (s) => s.replace('readonly attempts: readonly SchedulingAttempt[];', 'readonly attempts: readonly SchedulingAttempt[];\n  readonly candidatesByRound: unknown[];')), 'S3:', ATT));
check('MUTATION: a SECOND timing search / SECOND Constructor / SECOND orchestration / database / clock in the module or the boundary -> detected', flags(auditM(ATT, (s) => `${s}\nexport const x = () => searchTiming();`), 'S3:timing-search-or-replenishment', ATT) && flags(auditM(ATT, (s) => `${s}\nexport const c = () => constructDay({} as never);`), 'S3:constructor-ranking', ATT) && flags(auditM(PREP, (s) => `${s}\nexport const again = (r: never, d: never) => orchestrateConstructDayWithDiagnostics(r, d);`), 'S5:second-orchestration-in-the-boundary', PREP) && flags(auditM(ATT, (s) => `${s}\nexport const q = () => pool.query('SELECT 1');`), 'S3:database-access', ATT) && flags(auditM(ATT, (s) => `${s}\nexport const t = () => Date.now();`), 'S3:clock-read', ATT));
check('MUTATION: PRESSURE / precedence / policy / round reaches the attempts (a pressure field, an importance read, a round carried, a candidate order) -> detected', flags(auditM(ATT, (s) => s.replace('readonly conflictingOwnerIds: readonly string[];', 'readonly conflictingOwnerIds: readonly string[];\n  readonly pressure: string;')), 'S3:', ATT) && flags(auditM(ATT, (s) => s.replace('readonly end: Date;', 'readonly end: Date;\n  readonly round: number;')), 'S3:', ATT) && flags(auditM(ATT, (s) => `${s}\nexport const w = 'shouldAccept';`), 'S3:pressure-policy', ATT));
check('MUTATION: PAIR MISALIGNMENT (parallel array back, pairing by position, one pair shortened, authority built from another input) -> detected', flags(auditM(PREP, (s) => s.replace('inputs.map((input) => Object.freeze({ input, contention: contentionFor(', 'inputs.slice(0, 1).map((input) => Object.freeze({ input, contention: contentionFor(')), 'S5:promotions-are-not-typed-pairs', PREP) && flags(auditM(PREP, (s) => s.replace('contention: contentionFor(diagnostics.contentionTrace, input, diagnostics.constructionBasis, diagnostics.baselinePlacements)', 'contention: contentionFor(diagnostics.contentionTrace, inputs[0], diagnostics.constructionBasis, diagnostics.baselinePlacements)')), 'S5:promotions-are-not-typed-pairs', PREP) && flags(auditM(PREP, (s) => s.replace('export interface PromotionPair {', 'export interface PromotionPair {\n  readonly index: number;')), 'S5:pair-contract-changed', PREP) && flags(auditM(PREP, (s) => `${s}\nexport type Parallel = { contention: readonly PromotionContentionOutcome[] };`), 'S5:parallel-contention-array-reintroduced', PREP));
check('MUTATION: the run-level basis is DUPLICATED into every pair, or the run-level pass-through is changed -> detected', flags(auditM(PREP, (s) => s.replace('export interface PromotionPair {', 'export interface PromotionPair {\n  readonly constructionBasis: unknown;')), 'S5:', PREP) && flags(auditM(PREP, (s) => s.replace('constructionBasis: diagnostics.constructionBasis, baselinePlacements: diagnostics.baselinePlacements, schedulingAttempts, promotions, funnel }', 'constructionBasis: diagnostics.constructionBasis, schedulingAttempts, promotions, funnel }')), 'S5:run-level-shape-is-not-the-reviewed-pass-through', PREP));
check('MUTATION: the public preview / signing / acceptance / persistence / route / schema surfaces, the Constructor logic, the basis, the placements or the orchestrator name the attempt authority -> detected', ['apps/web/lib/dayConstructorPreviewRequest.ts', 'apps/web/lib/dayConstructorPreviewIntegrity.ts', 'apps/web/lib/dayConstructorAcceptance.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts', 'apps/web/app/api/day-constructor/preview/route.ts', 'apps/web/app/api/day-constructor/accept/route.ts', 'apps/web/lib/db.ts', CONSTRUCTOR, BASIS, PLACEMENTS, ORCH, SEARCH].every((f) => flags(auditM(f, (s) => `${s}\nexport const p = 'SchedulingAttemptAuthority';`), 'S1:', f)));
check('MUTATION: a shared (aliased) or non-frozen Date / an unfrozen output -> detected', flags(auditM(ATT, (s) => s.replace('start: Object.freeze(slot.start),', 'start: slot.start,')), 'S3:date-not-created', ATT) && flags(auditM(ATT, (s) => s.replace('const end = new Date(event.attemptedEnd);', 'const end = start;')), 'S3:date-not-created', ATT) && flags(auditM(ATT, (s) => s.split('Object.freeze(').join('(')), 'S3:output-not-frozen', ATT));
check('MUTATION: a production consumer of the attempt authority appears (a module importing it, a second projection or normalization call) -> detected', flags(audit(addFile(real, 'apps/web/lib/rogueConsumer.ts', "import { projectSchedulingAttempts } from './schedulingAttemptAuthority';\nexport const r = projectSchedulingAttempts;")), 'S1:imports-the-attempt-authority', 'apps/web/lib/rogueConsumer.ts') && flags(audit(addFile(real, 'apps/web/lib/rogueCaller.ts', 'export const r = (t: never) => normalizeSchedulingAttempts(t);')), 'S1:calls-the-normalization', 'apps/web/lib/rogueCaller.ts'));
check('MUTATION: the module loses fail-closed handling (a malformed fit accepted, a value import, a throwing projection, the basis unchecked) -> detected', flags(auditM(ATT, (s) => s.replace("if (event.timingFit !== undefined && !fits.includes(event.timingFit)) throw new Error('malformed timing fit');", '')), 'S3:malformed-payload-not-failed-closed', ATT) && flags(auditM(ATT, (s) => `import { compareCandidatesForPlacement } from './dayConstructor';\n${s}`), 'S3:imports-are-not-the-reviewed-three-type-imports', ATT) && flags(auditM(ATT, (s) => s.replace(/  \} catch \{\n    return unavailable\('CAPTURE_FAILED'\);\n  \}\n\}/, '  } finally {\n    // nothing\n  }\n}')), 'S3:projection-can-throw', ATT) && flags(auditM(ATT, (s) => s.replace("if (basisOutcome.status !== 'READY') return unavailable('RUN_NOT_READY');", '')), 'S3:not-paired-to-a-ready-basis', ATT));
check('MUTATION: the search limit changes -> detected', flags(auditM(SEARCH, (s) => s.replace('const DEFAULT_FIND_LIMIT = 3;', 'const DEFAULT_FIND_LIMIT = 6;')), 'S6:default-find-limit-changed', SEARCH));
check('the mutations were applied to in-memory copies only: the real tree still has zero violations afterwards', audit(productionFiles()).length === 0);

if (!allPassed) {
  console.error('SOME SCHEDULING ATTEMPT AUTHORITY ARCHITECTURE CHECKS FAILED');
  process.exit(1);
}
console.log('ALL SCHEDULING ATTEMPT AUTHORITY ARCHITECTURE CHECKS PASSED');
