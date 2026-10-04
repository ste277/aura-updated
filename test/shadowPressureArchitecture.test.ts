/**
 * Constructor Decision Intelligence -- O5 P3b: the SHADOW PRESSURE STAGE (architecture guard, pure).
 *
 * The shadow stage COMBINES three observations of a finished Constructor run -- derived DecisionPressure, the P3a
 * ContentionTrace and the final result -- and classifies, per Deferred loser, whether pressure could even be considered
 * given the dimensions that already outrank it. It is observation only. This guard pins that it:
 *
 *   - consumes only DERIVED pressure (never DecisionFacts, DecisionEvidence or raw recurrence / opportunity fields), and
 *     derives it in exactly one place, the diagnostics boundary, over the immutable evidence, after construction
 *   - takes contention only from the P3a trace (no overlap algorithm of its own, no round data, no interval geometry)
 *   - keeps VALUE and PRESSURE in separate modules: importance / deadline are read only by the stronger-than-pressure
 *     helper (which delegates to the Constructor's own comparator with originalOrder neutralised and names no pressure),
 *     and the evaluator that reads pressure names no value signal, timing quality, original order or source concept
 *   - never constructs, orders, places, promotes or replaces anything: no Constructor call, no counterfactual, no second
 *     pass, no policy or score, and no "would win / should win / incorrect" vocabulary
 *   - is reachable only through the diagnostics boundary, which nothing in production calls; it is not wired into the
 *     normal preview, and appears in no preview, signed contract, acceptance, persistence, Recomposition, Move, route,
 *     schema, migration, comparator, placement, capacity or replenishment code
 *
 * Every rule is a PURE FUNCTION over a set of source files: it runs on the real tree (zero violations expected) AND on
 * the real tree with a synthetic violation injected, proving each rule fires. P3b does not start P2d, P4 or P5.
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
const EVAL = 'apps/web/lib/shadowPressureEvaluation.ts';
const OBS = 'apps/web/lib/shadowPressureObservation.ts';
const ABOVE = 'apps/web/lib/abovePressurePrecedence.ts';
const ORCH = 'apps/web/lib/dayConstructorOrchestrator.ts';
const SHADOW_FILES = [ABOVE, EVAL, OBS];
/** O5 P4a -- the two inert promotion-input modules REUSE the one comparator primitive (the helper) and the one diagnostics entry point; they do not read the shadow evaluator or boundary (pinned by promotionInputArchitecture.test.ts). */
const PROMOTION_FILES = ['apps/web/lib/promotionInput.ts', 'apps/web/lib/promotionInputPreparation.ts'];

const SHADOW_IDENT = /\b(evaluateShadowPressure|observeShadowPressure|ShadowPressure[A-Za-z]*|ShadowOwner[A-Za-z]*|ShadowLoser[A-Za-z]*|ShadowIncompleteReason|AbovePressureFacts|AbovePressureComparison|compareAbovePressure|projectAbovePressureFacts)\b|abovePressurePrecedence|shadowPressure(?:Evaluation|Observation)/;
const SHADOW_WORD = /shadowPressure|abovePressure/i; // not a bare /shadow/: CSS box-shadow is everywhere in the UI
const PRESSURE_CHAIN = /DecisionFacts|decisionFacts|DecisionEvidence|decisionEvidence|OpportunityDecisionFacts|recurrence|\bopportunity\b|remainingInPeriod|afterStart\w*|durationBasis|startDateState|viableDays|unknownDays|evaluatedDays|completedInPeriod|committedInPeriod|targetPerPeriod/;
const PRESSURE_DERIVE = /deriveDecisionPressure/;
/** Value signals and placement quality: confined to the stronger-than-pressure helper (and only importance / deadline there). */
const VALUE_VOCAB = /importance|deadline|originalOrder|targetDate|timingFit|candidateOrder|capacity|\bwindow\b/i;
const SOURCE_VOCAB = /goal|manual|automatic|demand|provenance|handoff|hand-off|rhythm|plan-day|\btitle\b|activityId|startsWith|decodeGoal|encodeGoal|\bUI\b/i;
const IO_VOCAB = /\basync\b|\bawait\b|Promise|setTimeout|setInterval|\bpool\b|\.query\(|beginTransaction|INSERT|UPDATE|DELETE|fetch\(|Date\.now|new Date\(|\bDate\b|process\.|\benv\b|console\.|logger|\.warn\(|\.error\(|telemetry|trackEvent|Math\.random|require\(/;
const SCORE_OR_POLICY = /\bscore\b|weight|\brank|boost|priorit|urgen|wouldWin|shouldWin|shouldReplace|WOULD_WIN|SHOULD_|PROMOT|promote|REPLACE|INCORRECT|MISSED|activePressurePolicy|PressurePolicy/i;
/** Every surface that must never carry or read the shadow stage. */
const NEVER_SHADOW = [
  'apps/web/lib/dayConstructor.ts', 'apps/web/lib/dayIntent.ts', 'apps/web/lib/dayCapacity.ts', 'apps/web/lib/dayConstructorOrchestrator.ts', 'apps/web/lib/dayConstructorPreviewRequest.ts',
  'apps/web/lib/dayConstructorPreviewIntegrity.ts', 'apps/web/lib/dayConstructorPreviewClient.ts', 'apps/web/lib/dayConstructorAcceptance.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts',
  'apps/web/lib/remainingDayRecomposition.ts', 'apps/web/lib/remainingDayRecompositionAcceptance.ts', 'apps/web/lib/remainingDayRecompositionIntegrity.ts', 'apps/web/lib/remainingDayRecompositionServer.ts',
  'apps/web/lib/homeRecomposition.ts', 'apps/web/lib/planMove.ts', 'apps/web/lib/homeMove.ts', 'apps/web/lib/dayPlanPreviewPresentation.ts', 'apps/web/lib/dayPlanAcceptancePresentation.ts', 'apps/web/lib/db.ts',
  'apps/web/lib/contentionTrace.ts', 'apps/web/lib/decisionPressure.ts', 'apps/web/lib/decisionEvidence.ts', 'apps/web/lib/decisionFactPreparation.ts', 'apps/web/lib/goalDecisionFactsProvider.ts',
  'apps/web/app/api/day-constructor/preview/route.ts', 'apps/web/app/api/day-constructor/accept/route.ts', 'apps/web/app/api/day/recompose/route.ts', 'apps/web/app/api/plans/[planId]/move/route.ts', 'apps/web/app/api/plans/route.ts',
];

function audit(files: SrcFile[]): string[] {
  const v: string[] = [];
  const by = (re: RegExp) => files.filter((x) => re.test(x.src)).map((x) => x.f);
  const get = (f: string) => files.find((x) => x.f === f);
  const notIn = (list: string[], allow: string[]) => list.filter((f) => !allow.includes(f));
  // P1 -- the shadow vocabulary exists only in its three modules
  notIn(by(SHADOW_IDENT), [...SHADOW_FILES, ...PROMOTION_FILES]).forEach((f) => v.push(`P1:names-shadow-stage:${f}`));
  notIn(by(SHADOW_WORD), [...SHADOW_FILES, ...PROMOTION_FILES]).forEach((f) => v.push(`P1:shadow-vocabulary:${f}`));
  // P2 -- importers: the helper by the evaluator and the boundary; the evaluator only by the boundary; the boundary by NOBODY (no production consumer)
  notIn(by(/from '\.\/abovePressurePrecedence'/), [EVAL, OBS, ...PROMOTION_FILES]).forEach((f) => v.push(`P2:imports-above-pressure-helper:${f}`));
  notIn(by(/from '\.\/shadowPressureEvaluation'/), [OBS]).forEach((f) => v.push(`P2:imports-shadow-evaluator:${f}`));
  by(/from '\.\/shadowPressureObservation'/).forEach((f) => v.push(`P2:production-consumer-of-shadow-boundary:${f}`));
  notIn(by(/\bobserveShadowPressure\(/), [OBS]).forEach((f) => v.push(`P2:calls-shadow-boundary:${f}`));
  notIn(by(/\borchestrateConstructDayWithDiagnostics\(/), [ORCH, OBS, PROMOTION_FILES[1]]).forEach((f) => v.push(`P2:calls-diagnostics-entry-point:${f}`));
  // P3 -- the evaluator
  const ev = get(EVAL);
  if (ev) {
    if (PRESSURE_CHAIN.test(ev.src)) v.push(`P3:evaluator-reads-raw-facts-or-evidence:${EVAL}`);
    if (PRESSURE_DERIVE.test(ev.src)) v.push(`P3:evaluator-derives-pressure:${EVAL}`);
    if (VALUE_VOCAB.test(ev.src)) v.push(`P3:evaluator-names-value-or-timing:${EVAL}`);
    if (SOURCE_VOCAB.test(ev.src)) v.push(`P3:evaluator-source-vocabulary:${EVAL}`);
    if (IO_VOCAB.test(ev.src)) v.push(`P3:evaluator-io-clock-env-log:${EVAL}`);
    if (SCORE_OR_POLICY.test(ev.src)) v.push(`P3:evaluator-score-or-policy-vocabulary:${EVAL}`);
    if (/\bconstructDay\w*\(|orchestrate\w*\(|\.attempted\w*|\.winnerStart|\.winnerEnd|\.round\b|intervalsOverlap/.test(ev.src)) v.push(`P3:evaluator-constructs-or-reimplements-geometry:${EVAL}`);
    if (/^import (?!type )/m.test(ev.src.replace(/^import \{ compareAbovePressure, type AbovePressureFacts \} from '\.\/abovePressurePrecedence';$/m, ''))) v.push(`P3:evaluator-has-a-value-import-besides-the-helper:${EVAL}`);
  }
  // P4 -- the stronger-than-pressure helper
  const ab = get(ABOVE);
  if (ab) {
    if (/DecisionPressure|LAST_KNOWN_OPPORTUNITY|deriveDecisionPressure|DecisionEvidence|DecisionFacts|decisionFacts|recurrence|\bopportunity\b/.test(ab.src)) v.push(`P4:helper-names-pressure-chain:${ABOVE}`);
    if (/timingFit|candidate|capacity|\bwindow\b|startTime|score/i.test(ab.src)) v.push(`P4:helper-names-timing-or-capacity:${ABOVE}`);
    if (/originalOrder/.test(ab.src.replace(/originalOrder: 0\b/g, ''))) v.push(`P4:helper-reads-originalOrder:${ABOVE}`);
    if (IO_VOCAB.test(ab.src)) v.push(`P4:helper-io-clock-env-log:${ABOVE}`);
    if (count(/compareByOverloadPrecedence\(/g, ab.src) !== 1 || /IMPORTANCE_RANK|sortByOverloadPrecedence/.test(ab.src)) v.push(`P4:helper-reimplements-comparison:${ABOVE}`);
  }
  // P5 -- the diagnostics boundary
  const ob = get(OBS);
  if (ob) {
    if (PRESSURE_CHAIN.test(ob.src)) v.push(`P5:boundary-reads-raw-facts-or-evidence:${OBS}`);
    if (VALUE_VOCAB.test(ob.src)) v.push(`P5:boundary-names-value-or-timing:${OBS}`);
    if (SOURCE_VOCAB.test(ob.src)) v.push(`P5:boundary-source-vocabulary:${OBS}`);
    if (/\bconsole\.|logger|\.warn\(|\.error\(|telemetry|trackEvent|\bpool\b|\.query\(|from '\.\/db'|INSERT|UPDATE|DELETE|fetch\(|process\.|Date\.now|new Date\(|Math\.random/.test(ob.src)) v.push(`P5:boundary-io-log-db-clock:${OBS}`);
    if (count(/\bawait\b/g, ob.src) !== 1 || /\bconstructDay\(|constructDayWithTrace\(|orchestrateConstructDay\(|orchestrateConstructDayWithTrace\(/.test(ob.src) || count(/orchestrateConstructDayWithDiagnostics\(/g, ob.src) !== 1) v.push(`P5:boundary-runs-a-second-construction:${OBS}`);
    if (SCORE_OR_POLICY.test(ob.src)) v.push(`P5:boundary-score-or-policy-vocabulary:${OBS}`);
  }
  // P6 -- nothing that decides, places, persists or presents knows the shadow stage
  for (const f of NEVER_SHADOW) { const x = get(f); if (x && (SHADOW_IDENT.test(x.src) || SHADOW_WORD.test(x.src))) v.push(`P6:surface-names-shadow-stage:${f}`); }
  // P7 -- the orchestrator names neither shadow nor pressure (the evidence hand-off is the only new thing it does)
  const orch = get(ORCH);
  if (orch && (/shadow/i.test(orch.src) || /ressure/.test(orch.src))) v.push(`P7:orchestrator-names-shadow-or-pressure:${ORCH}`);
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
check(`THE REAL PRODUCTION TREE HAS ZERO SHADOW-STAGE ARCHITECTURE VIOLATIONS (${real.length} production files scanned)${baseline.length ? ': ' + baseline.join(', ') : ''}`, baseline.length === 0);

console.log('=== allowlists: producers, consumers, reachability ===');
check('the shadow vocabulary exists in exactly five production files: the stronger-than-pressure helper, the pure evaluator, the diagnostics boundary and -- since O5 P4a, naming only the shared comparator primitive and its facts type -- the two promotion-input modules', JSON.stringify(names(SHADOW_IDENT)) === JSON.stringify([...SHADOW_FILES, ...PROMOTION_FILES].sort()) && PROMOTION_FILES.every((f) => !/evaluateShadowPressure|observeShadowPressure|ShadowPressure[A-Za-z]*|shadowPressure(?:Evaluation|Observation)/.test(src(f))));
check('ZERO PRODUCTION CONSUMERS: nothing imports the diagnostics boundary and nothing calls `observeShadowPressure` -- it is not wired into the normal preview (there is no durable telemetry sink yet, so real shadow incidence is unknown)', names(/from '\.\/shadowPressureObservation'/).length === 0 && JSON.stringify(names(/\bobserveShadowPressure\(/)) === JSON.stringify([OBS]));
check('the helper is imported only by the evaluator, the boundary and (O5 P4a) the two promotion-input modules; the evaluator only by the boundary', JSON.stringify(names(/from '\.\/abovePressurePrecedence'/)) === JSON.stringify([EVAL, OBS, ...PROMOTION_FILES].sort()) && JSON.stringify(names(/from '\.\/shadowPressureEvaluation'/)) === JSON.stringify([OBS]));
check('the orchestrator\'s diagnostics entry point is called by exactly two production modules, the shadow boundary and (O5 P4a) the promotion preparation boundary', JSON.stringify(names(/\borchestrateConstructDayWithDiagnostics\(/)) === JSON.stringify([ORCH, OBS, PROMOTION_FILES[1]].sort()));
check('NOT A POLICY CONSUMER: no active comparator, Constructor, placement, capacity, replenishment, preview, signing, acceptance, persistence, Recomposition, Move, route, schema or migration mentions the shadow stage', NEVER_SHADOW.every((f) => !SHADOW_IDENT.test(src(f)) && !SHADOW_WORD.test(src(f))));
const migrationSql = fs.readdirSync(path.join(root, 'apps/web/prisma/migrations'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => fs.readFileSync(path.join(root, 'apps/web/prisma/migrations', e.name, 'migration.sql'), 'utf8'));
check('NO PERSISTENCE: the Prisma schema and all 43 migration directories mention no shadow stage; no migration was added', !/shadow/i.test(read('apps/web/prisma/schema.prisma')) && migrationSql.length === 43 && migrationSql.every((s) => !/shadowPressure|abovePressure/i.test(s)));
const comparatorFile = read('apps/web/lib/dayIntent.ts');
check('ACTIVE COMPARATOR UNTOUCHED AND UNREAD: dayIntent.ts (the hashed precedence code) does not name the shadow stage, and the helper is the only shadow-stage caller of `compareByOverloadPrecedence`', !SHADOW_WORD.test(comparatorFile) && JSON.stringify(names(/compareByOverloadPrecedence\(/)) === JSON.stringify(['apps/web/lib/abovePressurePrecedence.ts', 'apps/web/lib/dayIntent.ts']));

console.log('=== the evaluator: derived pressure + trace + final result, nothing else ===');
const ev = src(EVAL);
check('IMPORTS: types from the Constructor result, the P3a trace and the pressure module, and the stronger-than-pressure helper -- no value import of the Constructor, no database, no deriver', Array.from(read(EVAL).matchAll(/^import (?:type )?\{[^}]*\} from '([^']+)';/gm)).map((m) => m[1]).join() === './dayConstructor,./contentionTrace,./decisionPressure,./abovePressurePrecedence' && count(/^import type /gm, ev) === 3 && /^import \{ compareAbovePressure, type AbovePressureFacts \} from '\.\/abovePressurePrecedence';$/m.test(ev));
check('PRESSURE AUTHORITY: it accepts ALREADY-DERIVED pressure (`pressureByIntentId: ReadonlyMap<string, DecisionPressure>`) -- it never derives pressure and never names DecisionFacts, DecisionEvidence or any raw recurrence / opportunity field', /readonly pressureByIntentId: ReadonlyMap<string, DecisionPressure>;/.test(ev) && !PRESSURE_DERIVE.test(ev) && !PRESSURE_CHAIN.test(ev));
check('CONTENTION AUTHORITY: contention is read only from the P3a trace events (loser and owner ids); there is no overlap algorithm, no interval geometry, no round, no capacity, no Deferred-reason inference', /input\.contentionTrace\.events/.test(ev) && count(/event\.(\w+)/g, ev) === count(/event\.(loserIntentId|winnerIntentId)\b/g, ev) && !/\.attempted|\.winnerStart|\.winnerEnd|\.round\b|intervalsOverlap|primaryReason|capacityState|requestedCapacity|proposedCapacity/.test(ev));
check('FINAL RESULT AUTHORITY: only which intents are finally Proposed or Deferred is read (`proposedItems` / `deferredItems` intent ids)', count(/input\.finalDay\.(\w+)/g, ev) === count(/input\.finalDay\.(proposedItems|deferredItems)/g, ev) && /\.proposedItems\.map\(\(item\) => item\.intentId\)/.test(ev) && /\.deferredItems\.map\(\(item\) => item\.intentId\)/.test(ev));
check('VALUE vs PRESSURE SEPARATION: the evaluator, which reads pressure, names no importance, deadline, original order, target date, timing fit, candidate, capacity or window -- and no source concept, title, activity or Goal', !VALUE_VOCAB.test(ev) && !SOURCE_VOCAB.test(ev));
check('PURE: no async, await, Promise, timer, database, clock, Date, randomness, environment, console, logging or telemetry', !IO_VOCAB.test(ev));
check('NO CONSTRUCTION, NO COUNTERFACTUAL, NO SECOND PASS, NO POLICY: it calls no Constructor / orchestrator function, builds no schedule, promotes / replaces / ranks nothing and carries no score or "would / should win", "incorrect" or "missed" vocabulary', !/\bconstructDay\w*\(|orchestrate\w*\(|\bsort\(|\.reverse\(/.test(ev) && !SCORE_OR_POLICY.test(ev));
const evRaw = read(EVAL).replace(/\/\*[\s\S]*?\*\//g, '');
check('TAXONOMY: exactly the eight aggregate classifications, the four per-owner comparisons and the three incomplete reasons -- all string enums, no numeric field and no score', JSON.stringify(Array.from((evRaw.match(/export type ShadowPressureClassification =([\s\S]*?);/) ?? [])[1].matchAll(/'([A-Z_]+)'/g)).map((m) => m[1])) === JSON.stringify(['NOT_PRESSURED', 'NO_CONTENTION', 'NOT_FINAL_DEFERRED', 'NO_FINAL_CONTENTION_OWNER', 'BLOCKED_BY_STRONGER_OWNER', 'PRESSURE_ELIGIBLE_AGAINST_ALL_FINAL_OWNERS', 'PRECEDENCE_ANOMALY', 'INCOMPLETE_INPUT']) && JSON.stringify(Array.from((evRaw.match(/export type ShadowOwnerComparisonKind =([\s\S]*?);/) ?? [])[1].matchAll(/'([A-Z_]+)'/g)).map((m) => m[1])) === JSON.stringify(['TIES_ABOVE_PRESSURE', 'OWNER_STRONGER_ABOVE_PRESSURE', 'LOSER_STRONGER_ABOVE_PRESSURE', 'UNKNOWN_PRECEDENCE']) && JSON.stringify(Array.from((evRaw.match(/export type ShadowIncompleteReason =([\s\S]*?);/) ?? [])[1].matchAll(/'([A-Z_]+)'/g)).map((m) => m[1])) === JSON.stringify(['DUPLICATE_INTENT_ID', 'LOSER_NOT_IN_FINAL_RESULT', 'MISSING_PRECEDENCE_FACTS']) && !/:\s*number\b/.test(evRaw.replace(/contentionEventCount: number;/g, '')));
check('THE GATES RUN IN THE DOCUMENTED ORDER: id problems, then pressure, then final state, then contention, then final owners, then anomaly > block > missing facts > eligible', (() => { const order = ["if (finalState === 'AMBIGUOUS_ID')", "else if (finalState === 'ABSENT_FROM_FINAL_RESULT')", "else if (pressure !== 'LAST_KNOWN_OPPORTUNITY')", "else if (finalState === 'FINAL_PROPOSED')", 'events.length === 0', 'ambiguousOwner', 'finalOwners.length === 0', "'LOSER_STRONGER_ABOVE_PRESSURE'", "'OWNER_STRONGER_ABOVE_PRESSURE'", "'UNKNOWN_PRECEDENCE')"]; const at = order.map((o) => ev.indexOf(o, ev.indexOf('let classification'))); return at.every((n) => n > 0) && at.every((n, i) => i === 0 || n > at[i - 1]); })());
check('OWNERS ARE 0..N AND NEVER COLLAPSED: owners are collected from every trace event of the loser (a Map keyed by owner id, counted once each), mapped one comparison per owner, and the aggregate reads ALL final owners (`.some` over the final-owner set) -- no `[0]`, `.slice(0, 1)`, `.find` or single-owner shortcut', /ownerEventCounts\.set\(event\.winnerIntentId/.test(ev) && /\[\.\.\.ownerEventCounts\.entries\(\)\]\.map\(/.test(ev) && count(/finalOwners\.some\(/g, ev) === 3 && !/\.slice\(0,\s*1\)|owners\[0\]|finalOwners\[0\]|owners\.find\(|finalOwners\.find\(/.test(ev));
check('HISTORICAL vs FINAL OWNERS: owner final state comes from the FINAL result (`proposedSet`), every owner is compared (history kept) but only FINAL owners decide the aggregate', /proposedSet\.has\(ownerId\)/.test(ev) && /const finalOwners = owners\.filter\(\(owner\) => owner\.finalState === 'FINAL_PROPOSED'\);/.test(ev));
check('OUTPUT IS DETACHED AND FROZEN: every observation, owner comparison, array and the evaluation are `Object.freeze`d at creation; nothing returned aliases an input', count(/Object\.freeze\(/g, ev) >= 4);

console.log('=== the stronger-than-pressure helper: exactly deadline-today, importance, deadline ===');
const ab = src(ABOVE);
const abRaw = read(ABOVE);
check('IT DELEGATES to the Constructor\'s own comparator (exactly one call, no copy of the deadline / importance logic) with originalOrder neutralised on BOTH sides', count(/compareByOverloadPrecedence\(/g, ab) === 1 && /originalOrder: 0 \}\) as unknown as DayIntent/.test(ab) && !/IMPORTANCE_RANK|sortByOverloadPrecedence|\.deadline\s*(<|>)|importance\s*(<|>)/.test(ab));
check('ORIGINALORDER IS NOT READ: the only occurrence is the literal `originalOrder: 0` neutralising both shells (no property read, no parameter, no field of the facts)', count(/originalOrder/g, ab) === 1 && !/\.originalOrder/.test(ab) && /export interface AbovePressureFacts \{\s*readonly importance: DayIntent\['importance'\];\s*readonly deadline\?: string;\s*\}/.test(ab));
check('NO PRESSURE, NO TIMING, NO CAPACITY, NO FACTS: the helper names no DecisionPressure, evidence, facts, timing fit, candidate, window or capacity (and no I/O, clock or environment)', !/DecisionPressure|LAST_KNOWN_OPPORTUNITY|deriveDecisionPressure|DecisionEvidence|DecisionFacts|decisionFacts|recurrence|\bopportunity\b/.test(ab) && !/timingFit|candidate|capacity|\bwindow\b/i.test(ab) && !IO_VOCAB.test(ab));
check('the helper\'s only import is the Constructor\'s own comparator and the DayIntent type from dayIntent.ts; the comparison direction is the comparator\'s own (negative = A_STRONGER)', Array.from(abRaw.matchAll(/^import .* from '([^']+)';/gm)).map((m) => m[1]).join() === './dayIntent' && /delta < 0 \? 'A_STRONGER' : delta > 0 \? 'B_STRONGER' : 'TIE'/.test(ab));

console.log('=== the diagnostics boundary: derive after construction, fail open, nothing back into construction ===');
const ob = src(OBS);
check('IT DERIVES PRESSURE IN EXACTLY ONE PLACE, over the immutable evidence handed out by the orchestrator, strictly AFTER the Constructor result exists (the only `await` is the orchestration; derivation, projection and evaluation follow it)', count(/deriveDecisionPressure\(/g, ob) === 1 && count(/\bawait\b/g, ob) === 1 && ob.indexOf('await orchestrateConstructDayWithDiagnostics(') < ob.indexOf('deriveDecisionPressure(') && ob.indexOf('deriveDecisionPressure(') < ob.indexOf('evaluateShadowPressure('));
check('PRESSURE AUTHORITY: it passes the evidence it was handed to `deriveDecisionPressure` and nothing else -- it reads no DecisionFacts, no raw recurrence / opportunity field and no evidence member itself', /deriveDecisionPressure\(\{ evidence: diagnostics\.evidenceByIntentId\.get\(id\), planningDate: diagnostics\.planningDate, flexibility: resolved\.dayIntent\.flexibility \}\)/.test(ob) && !PRESSURE_CHAIN.test(ob));
check('FAIL OPEN: the derivation, projection and evaluation run inside a try block whose catch returns the SAME Constructor result with shadow `UNAVAILABLE / EVALUATION_FAILED` (no logging, no rethrow); a not-READY run returns `UNAVAILABLE / RUN_NOT_READY`', /try \{[\s\S]*deriveDecisionPressure\([\s\S]*evaluateShadowPressure\([\s\S]*\} catch \{\s*return \{ result, shadow: Object\.freeze\(\{ status: 'UNAVAILABLE', reason: 'EVALUATION_FAILED' \}\) \};\s*\}/.test(ob) && /reason: 'RUN_NOT_READY'/.test(ob) && !/\bthrow\b|console\./.test(ob));
check('NO CLIENT INPUT, NO NEW QUERY, NO WRITE, NO TELEMETRY: the boundary takes only the orchestrator\'s own request and deps; it imports no database module, writes nothing, logs nothing and sends nothing (real shadow incidence is therefore UNKNOWN)', Array.from(read(OBS).matchAll(/^import .* from '([^']+)';/gm)).map((m) => m[1]).join() === './dayConstructorOrchestrator,./decisionPressure,./shadowPressureEvaluation,./abovePressurePrecedence' && !/from '\.\/db'|\bpool\b|\.query\(|console\.|telemetry|trackEvent|fetch\(/.test(ob));
check('VALUE vs PRESSURE SEPARATION in the boundary too: it projects the stronger-than-pressure facts through the helper and names no importance, deadline, original order or target date itself (the planning date arrives from the orchestrator as `planningDate`)', /projectAbovePressureFacts\(resolved\.dayIntent\)/.test(ob) && !VALUE_VOCAB.test(ob) && !SOURCE_VOCAB.test(ob));

console.log('=== the orchestrator: one write-only hand-off, after preparation, before construction ===');
const orch = src(ORCH);
check('THE HAND-OFF: `EvidenceHandOff` is a private interface with one optional member; it is assigned exactly once, immediately after the evidence stage and before the first `constructDay({`, and is read only by the diagnostics entry point AFTER `runTraced` returns', /interface EvidenceHandOff \{\s*byIntentId\?: ReturnType<typeof prepareDecisionEvidence>;\s*\}/.test(orch) && count(/evidenceOut\.byIntentId = decisionEvidenceByIntentId;/g, orch) === 1 && orch.indexOf('evidenceOut.byIntentId = decisionEvidenceByIntentId;') > orch.indexOf('prepareDecisionEvidence(preparationIntents') && orch.indexOf('evidenceOut.byIntentId = decisionEvidenceByIntentId;') < orch.indexOf('constructDay({') && orch.indexOf('handOff.byIntentId') > orch.indexOf('await runTraced(request, deps, handOff)'));
check('THE CONSTRUCTOR NEVER SEES EVIDENCE: neither `constructDay({...})` call mentions evidence, the hand-off, pressure or shadow (their keys are unchanged); the normal entry point passes no hand-off (`runOrchestration(request, deps, constructDay)`)', Array.from(orch.matchAll(/constructDay\(\{[\s\S]*?today: request\.targetDate,\s*\}\);/g)).length === 2 && Array.from(orch.matchAll(/constructDay\(\{[\s\S]*?today: request\.targetDate,\s*\}\);/g)).every((m) => !/ecision|vidence|handOff|evidenceOut|hadow|ressure/.test(m[0])) && /return runOrchestration\(request, deps, constructDay\);/.test(orch));
check('the orchestrator names neither the shadow stage nor pressure; it still has no pressure, score or policy concept (the P0c / P2a guards also hold)', !/shadow/i.test(orch) && !/ressure/.test(orch));
check('the preview boundary is unchanged: `dayConstructorPreviewRequest.ts` still calls `orchestrateConstructDay`, never the diagnostics entry points', /orchestrateConstructDay\b/.test(src('apps/web/lib/dayConstructorPreviewRequest.ts')) && !/WithDiagnostics|WithTrace|observeShadow/.test(src('apps/web/lib/dayConstructorPreviewRequest.ts')) && !/WithDiagnostics|WithTrace|observeShadow/.test(src('apps/web/app/api/day-constructor/preview/route.ts')));

console.log('=== MUTATIONS OF THE GUARD: each violation class, injected into the real tree, is detected ===');
check('MUTATION: the evaluator reads raw recurrence / opportunity facts -> detected', flags(audit(mutateFile(real, EVAL, (s) => `${s}\nexport const x = (o: { opportunity?: { afterStartViableDays: number } }) => o.opportunity?.afterStartViableDays;`)), 'P3:evaluator-reads-raw-facts-or-evidence', EVAL));
check('MUTATION: the evaluator imports / reads DecisionEvidence or DecisionFacts -> detected', flags(audit(mutateFile(real, EVAL, (s) => `import type { DecisionEvidence } from './decisionEvidence';\n${s}`)), 'P3:evaluator-reads-raw-facts-or-evidence', EVAL));
check('MUTATION: the evaluator derives pressure itself (a second derivation authority) -> detected', flags(audit(mutateFile(real, EVAL, (s) => `${s}\nexport const d = () => deriveDecisionPressure;`)), 'P3:evaluator-derives-pressure', EVAL));
check('MUTATION: the evaluator uses timingFit / candidate order / importance / original order / deadline / capacity -> detected', ['timingFit', 'candidateOrder', 'importance', 'originalOrder', 'deadline', 'capacityState'].every((w) => flags(audit(mutateFile(real, EVAL, (s) => `${s}\nexport const t = (o: { ${w}: string }) => o.${w};`)), 'P3:evaluator-names-value-or-timing', EVAL)));
check('MUTATION: a Goal / manual / automatic source branch in the evaluator -> detected', flags(audit(mutateFile(real, EVAL, (s) => `${s}\nexport const s = (id: string) => id.startsWith('goal-demand');`)), 'P3:evaluator-source-vocabulary', EVAL));
check('MUTATION: the evaluator runs the Constructor / reconstructs geometry / reads rounds (counterfactual, second pass, own overlap algorithm) -> detected', flags(audit(mutateFile(real, EVAL, (s) => `${s}\nexport const c = (i: never) => constructDay(i);`)), 'P3:evaluator-constructs-or-reimplements-geometry', EVAL) && flags(audit(mutateFile(real, EVAL, (s) => `${s}\nexport const r = (e: { round: number }) => e.round;`)), 'P3:evaluator-constructs-or-reimplements-geometry', EVAL) && flags(audit(mutateFile(real, EVAL, (s) => `${s}\nexport const g = (e: { attemptedStart: string }) => e.attemptedStart.attemptedEnd;`)), 'P3:evaluator-constructs-or-reimplements-geometry', EVAL));
check('MUTATION: a score, a "would win" / "should replace" / "promote" vocabulary in the evaluator -> detected', flags(audit(mutateFile(real, EVAL, (s) => `${s}\nexport const w = 'WOULD_WIN';`)), 'P3:evaluator-score-or-policy-vocabulary', EVAL) && flags(audit(mutateFile(real, EVAL, (s) => `${s}\nexport const p = (x: number) => x * weight;`)), 'P3:evaluator-score-or-policy-vocabulary', EVAL));
check('MUTATION: a clock, log or async in the evaluator -> detected', flags(audit(mutateFile(real, EVAL, (s) => `${s}\nexport const n = () => Date.now();`)), 'P3:evaluator-io-clock-env-log', EVAL) && flags(audit(mutateFile(real, EVAL, (s) => `${s}\nconsole.log('x');`)), 'P3:evaluator-io-clock-env-log', EVAL));
check('MUTATION: the stronger-than-pressure helper reads timingFit, or originalOrder as a stronger dimension -> detected', flags(audit(mutateFile(real, ABOVE, (s) => `${s}\nexport const t = (o: { timingFit: string }) => o.timingFit;`)), 'P4:helper-names-timing-or-capacity', ABOVE) && flags(audit(mutateFile(real, ABOVE, (s) => s.replace('originalOrder: 0 })', 'originalOrder: facts.order })'))), 'P4:helper-reads-originalOrder', ABOVE));
check('MUTATION: the helper names pressure (value merged into the pressure authority) or re-implements the comparison -> detected', flags(audit(mutateFile(real, ABOVE, (s) => `import type { DecisionPressure } from './decisionPressure';\n${s}`)), 'P4:helper-names-pressure-chain', ABOVE) && flags(audit(mutateFile(real, ABOVE, (s) => `${s}\nconst IMPORTANCE_RANK = { HIGH: 0 };`)), 'P4:helper-reimplements-comparison', ABOVE));
check('MUTATION: the diagnostics boundary runs a second construction (a counterfactual / pressure-aware pass) -> detected', flags(audit(mutateFile(real, OBS, (s) => `${s}\nexport const second = (r: never, d: never) => orchestrateConstructDay(r, d);`)), 'P5:boundary-runs-a-second-construction', OBS));
check('MUTATION: the boundary reads raw facts, names a value signal, logs, or touches the database -> detected', flags(audit(mutateFile(real, OBS, (s) => `${s}\nexport const raw = (e: { recurrence: unknown }) => e.recurrence;`)), 'P5:boundary-reads-raw-facts-or-evidence', OBS) && flags(audit(mutateFile(real, OBS, (s) => `${s}\nexport const v = (i: { importance: string }) => i.importance;`)), 'P5:boundary-names-value-or-timing', OBS) && flags(audit(mutateFile(real, OBS, (s) => `${s}\nconsole.log('shadow');`)), 'P5:boundary-io-log-db-clock', OBS) && flags(audit(mutateFile(real, OBS, (s) => `import { pool } from './db';\n${s}`)), 'P5:boundary-io-log-db-clock', OBS));
check('MUTATION: a production consumer of the shadow boundary (a new module calling `observeShadowPressure`, i.e. any policy or preview consumer) -> detected', (() => { const v = audit(addFile(real, 'apps/web/lib/roguePolicy.ts', "import { observeShadowPressure } from './shadowPressureObservation';\nexport const p = (r: never, d: never) => observeShadowPressure(r, d);")); return flags(v, 'P2:production-consumer-of-shadow-boundary', 'apps/web/lib/roguePolicy.ts') && flags(v, 'P2:calls-shadow-boundary', 'apps/web/lib/roguePolicy.ts') && flags(v, 'P1:names-shadow-stage', 'apps/web/lib/roguePolicy.ts'); })());
check('MUTATION: the active comparator file reads the shadow stage / the helper -> detected', flags(audit(mutateFile(real, 'apps/web/lib/dayIntent.ts', (s) => `import type { AbovePressureFacts } from './abovePressurePrecedence';\n${s}`)), 'P6:surface-names-shadow-stage', 'apps/web/lib/dayIntent.ts'));
check('MUTATION: the shadow output exposed in the preview, signing, acceptance, Move, Recomposition or the DB layer (persistence) -> detected', ['apps/web/lib/dayConstructorPreviewRequest.ts', 'apps/web/lib/dayConstructorPreviewIntegrity.ts', 'apps/web/lib/dayConstructorAcceptance.ts', 'apps/web/lib/planMove.ts', 'apps/web/lib/remainingDayRecomposition.ts', 'apps/web/lib/db.ts', 'apps/web/app/api/day-constructor/preview/route.ts'].every((f) => flags(audit(mutateFile(real, f, (s) => `${s}\nexport const leaked = { shadowPressure: [] };`)), 'P6:surface-names-shadow-stage', f)));
check('MUTATION: the Constructor, orchestrator, placement or capacity names shadow / pressure -> detected', flags(audit(mutateFile(real, ORCH, (s) => `${s}\nconst probe = 'shadow';`)), 'P7:orchestrator-names-shadow-or-pressure', ORCH) && flags(audit(mutateFile(real, 'apps/web/lib/dayConstructor.ts', (s) => `${s}\nconst probe = shadowPressure;`)), 'P6:surface-names-shadow-stage', 'apps/web/lib/dayConstructor.ts'));
check('MUTATION: a new module imports the helper or the evaluator (an unauthorized consumer) -> detected', flags(audit(addFile(real, 'apps/web/lib/rogueHelperUser.ts', "import { compareAbovePressure } from './abovePressurePrecedence';\nexport const c = compareAbovePressure;")), 'P2:imports-above-pressure-helper', 'apps/web/lib/rogueHelperUser.ts') && flags(audit(addFile(real, 'apps/web/lib/rogueEvalUser.ts', "import { evaluateShadowPressure } from './shadowPressureEvaluation';\nexport const e = evaluateShadowPressure;")), 'P2:imports-shadow-evaluator', 'apps/web/lib/rogueEvalUser.ts'));
check('MUTATION: a new caller of the diagnostics entry point outside the shadow boundary -> detected', flags(audit(addFile(real, 'apps/web/lib/rogueDiagnosticsCaller.ts', "import { orchestrateConstructDayWithDiagnostics } from './dayConstructorOrchestrator';\nexport const d = (r: never, q: never) => orchestrateConstructDayWithDiagnostics(r, q);")), 'P2:calls-diagnostics-entry-point', 'apps/web/lib/rogueDiagnosticsCaller.ts'));
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
check('both shadow suites run in the required PURE job (math-core-tests = "Ephemeris / panchang tests"); there is no database suite for the shadow stage (the real-pipeline fixtures need no database)', stepJob.get('test/shadowPressureEvaluation.test.ts') === 'math-core-tests' && stepJob.get('test/shadowPressureArchitecture.test.ts') === 'math-core-tests' && ![...stepJob.keys()].some((k) => /shadow.*Db/i.test(k)));
const FLAKY = /\bctid\b|VACUUM|ANALYZE|EXPLAIN\b|Math\.random|setTimeout|setInterval|Date\.now\(|new Date\(\)|\bsleep\b/;
check('the behavior suite asserts scheduling / classification invariants only: no heap layout, query plan, timer, randomness or wall-clock reading', !FLAKY.test(stripComments(read('test/shadowPressureEvaluation.test.ts'))));
const FALSE_CLAIM = /policy is (active|enabled)|promote(s|d)? the|would win|should win|should replace|incorrect winner|missed scheduling|snapshot[- ]consistent|coherent snapshot|P4 (is )?ready|ready for P4/i;
check('no assertion label claims a candidate would / should win, was wrongly decided, should be promoted, that policy is active, that the reads are snapshot-consistent, or that P4 is ready', !((read('test/shadowPressureEvaluation.test.ts').match(/check\(`?'?[^\n]*/g) ?? []).some((l) => FALSE_CLAIM.test(l))));
check('P2D RETAINED: the evidence and preparation modules still hold no REPEATABLE READ / snapshot machinery -- shadow is observation only, which keeps this acceptable, and it authorizes nothing about active policy (P4 still needs the coherent snapshot)', !/REPEATABLE READ|ISOLATION|snapshotAt|schedulingContext|beginTransaction/i.test(src('apps/web/lib/decisionEvidence.ts') + src('apps/web/lib/decisionFactPreparation.ts')));

if (!allPassed) {
  console.error('SOME SHADOW PRESSURE ARCHITECTURE CHECKS FAILED');
  process.exit(1);
}
console.log('ALL SHADOW PRESSURE ARCHITECTURE CHECKS PASSED');
