/**
 * Constructor Decision Intelligence -- O5 P3a: the CONTENTION TRACE (architecture guard, pure).
 *
 * ContentionTrace = WHAT HAPPENED: which candidate's attempted interval was rejected because a Proposed candidate already
 * owned an overlapping interval. DecisionPressure = the COST OF DEFERRAL. They are orthogonal: this guard pins that the
 * trace imports and reads nothing of the pressure / evidence / facts chain, has no source vocabulary, no value
 * interpretation, no I/O, no clock, no logging; that it is collected only at the placement gate's
 * CONFLICTS_WITH_PROPOSED_ITEM rejection (no reconstruction pass, no second construction, no extra candidate generation);
 * that it is observed (write-only) and never read back by any decision; that it exists in exactly the allowed producer
 * files; that NOTHING in production consumes it (the only consumers are tests / diagnostics); and that it appears in no
 * preview, signed contract, persisted row, route, schema or migration, and in neither the precedence comparator nor the
 * placement ranking.
 *
 * Every rule is a PURE FUNCTION over a set of source files: it runs on the real tree (zero violations expected) and on the
 * real tree with a synthetic violation injected, proving each rule fires.
 *
 * P3a does not start P3b (shadow evaluation), P2d (coherent snapshot), P4 (active policy) or P5 (explanations).
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
const TRACE = 'apps/web/lib/contentionTrace.ts';
const CONSTRUCTOR = 'apps/web/lib/dayConstructor.ts';
const ORCHESTRATOR = 'apps/web/lib/dayConstructorOrchestrator.ts';
/** The only production files that may name the trace at all: the model, the placement gate that observes it, and the orchestrator that accumulates rounds. */
const TRACE_NAMING_ALLOW = [CONSTRUCTOR, ORCHESTRATOR, TRACE];
/** The only importers of the trace module (producers). There is NO production consumer: nothing reads a trace to decide anything. */
const TRACE_IMPORTER_ALLOW = [CONSTRUCTOR, ORCHESTRATOR];
const TRACE_IDENT = /\b(ContentionEvent|ContentionTrace|ContentionAttempt|ContentionPass|ContentionObserver|constructDayWithTrace|orchestrateConstructDayWithTrace|buildContentionEvents|buildContentionTraceFromPasses|aggregateContentionTraces|createContentionTrace|contentionEventKey|EMPTY_CONTENTION_TRACE|contentionAttempts|contentionPasses|contentionTrace|attemptsForPass|onContention)\b/;
const CONTENTION_WORD = /ontention/;
const TRACE_IMPORT = /from '(?:\.\/|(?:\.\.\/)+[^']*\/)?contentionTrace'/;

const PRESSURE_CHAIN = /DecisionPressure|deriveDecisionPressure|LAST_KNOWN_OPPORTUNITY|DecisionEvidence|decisionEvidence|DecisionFacts|decisionFacts|\bpressure\b|recurrence|\bopportunity\b|OpportunityDecisionFacts|remainingInPeriod|afterStart|durationBasis|startDateState/i;
const SOURCE_VOCAB = /goal|manual|automatic|demand|provenance|handoff|hand-off|rhythm|plan-day|activityId|\btitle\b|startsWith|decodeGoal|encodeGoal|\bUI\b/i;
const VALUE_VOCAB = /importance|deadline|originalOrder|stronger|weaker|deserv|urgen|important|priorit|\bscore\b|\brank|boost|weight|winnerPolicy|approved/i;
const IO_VOCAB = /\basync\b|\bawait\b|Promise|setTimeout|setInterval|\bpool\b|\.query\(|beginTransaction|INSERT|UPDATE|DELETE|fetch\(|Date\.now|new Date\(|process\.|\benv\b|console\.|logger|\.warn\(|\.error\(|telemetry|trackEvent|Math\.random|require\(/i;
/** Surfaces that must never carry the trace: the preview, signing, acceptance, persistence, routes, presentation, schema. */
const PUBLIC_SURFACES = [
  'apps/web/lib/dayConstructorPreviewRequest.ts', 'apps/web/lib/dayConstructorPreviewIntegrity.ts', 'apps/web/lib/dayConstructorPreviewClient.ts', 'apps/web/lib/dayConstructorAcceptance.ts',
  'apps/web/lib/dayConstructorAcceptancePersistence.ts', 'apps/web/lib/remainingDayRecomposition.ts', 'apps/web/lib/dayPlanPreviewPresentation.ts', 'apps/web/lib/db.ts',
  'apps/web/app/api/day-constructor/preview/route.ts', 'apps/web/app/api/day-constructor/accept/route.ts', 'apps/web/lib/dayIntent.ts', 'apps/web/lib/dayCapacity.ts',
];

function audit(files: SrcFile[]): string[] {
  const v: string[] = [];
  const by = (re: RegExp) => files.filter((x) => re.test(x.src)).map((x) => x.f);
  const notIn = (list: string[], allow: string[]) => list.filter((f) => !allow.includes(f));
  notIn(by(TRACE_IDENT), TRACE_NAMING_ALLOW).forEach((f) => v.push(`G1:names-trace:${f}`));
  notIn(by(CONTENTION_WORD), TRACE_NAMING_ALLOW).forEach((f) => v.push(`G1:contention-vocabulary:${f}`));
  notIn(by(TRACE_IMPORT), TRACE_IMPORTER_ALLOW).forEach((f) => v.push(`G2:imports-trace:${f}`));
  // a trace PRODUCER entry point has no production caller: the "with trace" APIs are called by tests and diagnostics only
  notIn(by(/\bconstructDayWithTrace\(/), [CONSTRUCTOR]).forEach((f) => v.push(`G3:production-consumer-constructDayWithTrace:${f}`));
  notIn(by(/\borchestrateConstructDayWithTrace\(/), [ORCHESTRATOR]).forEach((f) => v.push(`G3:production-consumer-orchestrateConstructDayWithTrace:${f}`));
  const trace = files.find((x) => x.f === TRACE);
  if (trace) {
    if (/^import /m.test(trace.src)) v.push(`G4:trace-module-imports-something:${TRACE}`);
    if (PRESSURE_CHAIN.test(trace.src)) v.push(`G4:trace-module-names-pressure-chain:${TRACE}`);
    if (SOURCE_VOCAB.test(trace.src)) v.push(`G5:trace-module-source-vocabulary:${TRACE}`);
    if (VALUE_VOCAB.test(trace.src)) v.push(`G6:trace-module-value-interpretation:${TRACE}`);
    if (IO_VOCAB.test(trace.src)) v.push(`G7:trace-module-io-clock-env-log:${TRACE}`);
  }
  for (const f of [CONSTRUCTOR]) {
    const c = files.find((x) => x.f === f);
    if (c && PRESSURE_CHAIN.test(c.src.replace(/\bopportunit(y|ies)\b/gi, ''))) v.push(`G4:constructor-names-pressure-chain:${f}`);
    if (c && /console\.|logger|\.warn\(/.test(c.src)) v.push(`G7:constructor-logs:${f}`);
  }
  for (const f of PUBLIC_SURFACES) { const x = files.find((y) => y.f === f); if (x && (TRACE_IDENT.test(x.src) || CONTENTION_WORD.test(x.src))) v.push(`G8:public-surface-names-trace:${f}`); }
  const cmp = files.find((x) => x.f === 'apps/web/lib/dayIntent.ts');
  if (cmp && (TRACE_IDENT.test(cmp.src) || CONTENTION_WORD.test(cmp.src))) v.push(`G9:comparator-file-reads-trace:apps/web/lib/dayIntent.ts`);
  const cons = files.find((x) => x.f === CONSTRUCTOR);
  if (cons) {
    const a = cons.src.indexOf('const TIMING_FIT_RANK');
    const b = cons.src.indexOf('export type PlacementDeferralReason');
    if (a >= 0 && b > a && (CONTENTION_WORD.test(cons.src.slice(a, b)) || TRACE_IDENT.test(cons.src.slice(a, b)))) v.push(`G9:placement-ranking-reads-trace:${CONSTRUCTOR}`);
  }
  return v;
}
const real = productionFiles();
const src = (f: string) => real.find((x) => x.f === f)!.src;
const raw = (f: string) => read(f);
const mutateFile = (files: SrcFile[], f: string, fn: (s: string) => string): SrcFile[] => files.map((x) => (x.f === f ? { f, src: fn(x.src) } : x));
const addFile = (files: SrcFile[], f: string, s: string): SrcFile[] => [...files, { f, src: s }];
const flags = (violations: string[], prefix: string, file?: string) => violations.some((x) => x.startsWith(prefix) && (file === undefined || x.endsWith(`:${file}`)));
function blockAfter(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing marker ${marker}`);
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < source.length; i++) { if (source[i] === '{') depth++; else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); } }
  throw new Error(`unterminated block after ${marker}`);
}

/** The body of `export interface <name> { ... }` (brace matched), comments removed. */
function interfaceBody(source: string, name: string): string {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const start = clean.indexOf(`export interface ${name}`);
  if (start < 0) throw new Error(`missing interface ${name}`);
  const open = clean.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < clean.length; i++) { if (clean[i] === '{') depth++; else if (clean[i] === '}') { depth--; if (depth === 0) return clean.slice(open + 1, i); } }
  throw new Error(`unterminated interface ${name}`);
}
const topLevelFields = (body: string) => { const out: string[] = []; let depth = 0; for (const line of body.split('\n')) { if (depth === 0) { const m = line.match(/^\s*(?:readonly )?(\w+)\??:/); if (m) out.push(m[1]); } for (const ch of line) { if (ch === '{' || ch === '<' || ch === '(') depth++; else if (ch === '}' || ch === '>' || ch === ')') depth--; } } return out; };

// ============================================================
console.log('=== the real tree conforms ===');
const baseline = audit(real);
check(`THE REAL PRODUCTION TREE HAS ZERO CONTENTION-TRACE ARCHITECTURE VIOLATIONS (${real.length} production files scanned)${baseline.length ? ': ' + baseline.join(', ') : ''}`, baseline.length === 0);

console.log('=== allowed producers and consumers (exact allowlists) ===');
const names = (re: RegExp) => real.filter((x) => re.test(x.src)).map((x) => x.f);
check('TRACE PRODUCERS: the contention vocabulary appears in exactly three production files -- the model (contentionTrace.ts), the placement gate that observes it (dayConstructor.ts) and the orchestrator that accumulates rounds (dayConstructorOrchestrator.ts)', JSON.stringify(names(CONTENTION_WORD)) === JSON.stringify([...TRACE_NAMING_ALLOW].sort()) && JSON.stringify(names(TRACE_IDENT)) === JSON.stringify([...TRACE_NAMING_ALLOW].sort()));
check('only the Constructor and the orchestrator import the trace module', JSON.stringify(names(TRACE_IMPORT)) === JSON.stringify([...TRACE_IMPORTER_ALLOW].sort()));
check('NO PRODUCTION POLICY CONSUMER: no production file calls `constructDayWithTrace` (defined in the Constructor, called by tests) or `orchestrateConstructDayWithTrace` (defined in the orchestrator, called by tests); no route, preview, acceptance, Recomposition, comparator, capacity, presentation or persistence code reads a trace', JSON.stringify(names(/\bconstructDayWithTrace\(/)) === JSON.stringify([CONSTRUCTOR]) && JSON.stringify(names(/\borchestrateConstructDayWithTrace\(/)) === JSON.stringify([ORCHESTRATOR]));
check('the orchestrator hands the accumulated trace to its caller and reads it nowhere else: `contentionPasses` is written by the pass sink and read only by `buildContentionTraceFromPasses`', count(/contentionPasses/g, src(ORCHESTRATOR)) === 3 && /contentionPasses\.push\(\{ round, attempts \}\)/.test(src(ORCHESTRATOR)) && count(/buildContentionTraceFromPasses\(passes\)/g, src(ORCHESTRATOR)) === 1);
const testFiles = fs.readdirSync(path.join(root, 'test')).filter((f) => /contention/i.test(f)).sort();
check('the only consumers are tests and diagnostics: the contention tests are the behavior suite and this guard -- and there is NO database suite (contention is a pure scheduling-mechanics concern; none was added)', JSON.stringify(testFiles) === JSON.stringify(['contentionTrace.test.ts', 'contentionTraceArchitecture.test.ts']));

console.log('=== the trace module: pure, source-neutral, value-free, orthogonal to pressure ===');
const trace = src(TRACE);
check('ZERO IMPORTS: the model imports nothing -- no pressure, evidence, facts, Constructor, database or clock module', !/^import /m.test(trace) && !/require\(/.test(trace));
check('NO PRESSURE CHAIN: the trace module does not import or name DecisionPressure, LAST_KNOWN_OPPORTUNITY, DecisionEvidence, DecisionFacts, recurrence, opportunity, scarcity or any raw fact field', !PRESSURE_CHAIN.test(trace));
check('SOURCE NEUTRAL: no Goal, GoalActivity, manual/automatic, demand, provenance, hand-off, Rhythm, activity id, title, intent-id parsing or UI vocabulary', !SOURCE_VOCAB.test(trace));
check('NO VALUE INTERPRETATION: no importance, deadline, order, stronger / weaker / deserving / urgent / important, score, rank, boost, weight or approved-winner concept', !VALUE_VOCAB.test(trace));
check('PURE and INTERNAL: no async, await, Promise, timer, database, clock, randomness, environment, console, logging or telemetry', !IO_VOCAB.test(trace));
const eventBody = interfaceBody(raw(TRACE), 'ContentionEvent');
const eventFields = Array.from(eventBody.matchAll(/readonly (\w+):/g)).map((m) => m[1]);
check('EVENT MODEL: exactly loserIntentId, winnerIntentId, attemptedStart, attemptedEnd, winnerStart, winnerEnd, round -- all readonly', JSON.stringify(eventFields) === JSON.stringify(['loserIntentId', 'winnerIntentId', 'attemptedStart', 'attemptedEnd', 'winnerStart', 'winnerEnd', 'round']));
check('IMMUTABLE BY CONSTRUCTION: events and the trace are frozen at creation (Object.freeze at the event, the events array and the trace) and instants are stored as ISO strings, never as shared Date objects', count(/Object\.freeze\(/g, trace) >= 4 && /toISOString\(\)/.test(trace) && !/:\s*Date;/.test(eventBody));
check('NO DUPLICATE IDENTICAL EVENTS: events are keyed by round, loser, winner, attempted interval and owner interval, and an identical key is kept once; aggregation across rounds keeps history by appending', /contentionEventKey/.test(trace) && count(/seen\.has\(key\)/g, trace) === 2);
check('DETERMINISTIC ORDER: events are sorted by loser evaluation order, attempted start, attempted end, then supplied position (no Map/Set iteration, no key enumeration decides order)', /a\.attempt\.evaluationIndex - b\.attempt\.evaluationIndex/.test(trace) && /a\.position - b\.position/.test(trace) && !/Object\.keys|Object\.entries|for \(const \w+ in /.test(trace));
check('the documented definition says "winner" is descriptive ownership and not a policy-approved winner, that DecisionPressure is the cost of deferral, and that a final Deferred reason never proves absence of contention', /DESCRIPTIVE HISTORICAL OWNERSHIP/.test(raw(TRACE)) && /does NOT mean the policy-approved/i.test(raw(TRACE)) && /ORTHOGONAL TO DECISION PRESSURE/.test(raw(TRACE)) && /never proves the ABSENCE of an earlier contention/.test(raw(TRACE)));

console.log('=== collected only at the placement gate; observed, never read back ===');
const ctor = src(CONSTRUCTOR);
const gateCalls = Array.from(ctor.matchAll(/(.{0,90})onContention\?\.\(/g)).map((m) => m[1]);
check('the observation hook is called in exactly two places: the FLEXIBLE candidate loop and the FIXED constraint check -- each only on a `CONFLICTS_WITH_PROPOSED_ITEM` rejection', count(/onContention\?\.\(/g, ctor) === 2 && gateCalls.every((c) => /CONFLICTS_WITH_PROPOSED_ITEM/.test(c)));
check('NO RECONSTRUCTION PASS: contention is not rebuilt after construction -- the Constructor still evaluates each candidate exactly once (`evaluateCandidate(` is defined once and called once), places once per intent, and the trace is built from what the gate observed', count(/evaluateCandidate\(/g, ctor) === 2 && count(/placeOneIntent\(/g, ctor) === 2 && count(/evaluateFixedConstraint\(/g, ctor) === 2);
const constructBody = blockAfter(ctor, 'export function constructDay(');
check('WRITE-ONLY SINK: inside constructDay the attempts list is only assigned, tested for presence, and pushed to -- never read for any decision', Array.from(constructBody.matchAll(/\battempts\b/g)).length === 3 && /const attempts = contentionAttempts;/.test(constructBody) && /attempts\s*\?\s*\(attempted\)/.test(constructBody) && /attempts\.push\(/.test(constructBody));
check('the observer only reads placement state that already exists (the placed intervals) and the canonical half-open overlap used by every other gate -- no second overlap definition, no clock', /placedIntervals\.filter\(\(placed\) => intervalsOverlap\(attempted\.start, attempted\.end, placed\.start, placed\.end\)\)/.test(constructBody) && count(/function intervalsOverlap\(/g, ctor) === 1 && !/contentionTrace[\s\S]{0,400}(<=|>=)/.test(ctor.slice(ctor.indexOf('onContention'))));
check('NO SECOND CONSTRUCTION PASS in the orchestrator: still exactly two `constructDay({` call sites and the existing bounded replenishment loop; each call carries only the optional write-only sink `attemptsForPass(<round>)`', count(/constructDay\(\{/g, src(ORCHESTRATOR)) === 2 && /for \(let round = 0; round < flexibleIntentCount; round \+= 1\)/.test(src(ORCHESTRATOR)) && count(/\}, attemptsForPass\((?:0|round \+ 1)\)\);/g, src(ORCHESTRATOR)) === 2 && count(/attemptsForPass/g, src(ORCHESTRATOR)) === 3);
check('production callers that do not request diagnostics are unaffected: `orchestrateConstructDay` is a one-line delegate with no sink, and `constructDay(input)` with no second argument collects nothing (the sink is `undefined`)', /export async function orchestrateConstructDay\(request: ConstructDayRequest, deps: DayConstructorOrchestratorDeps\): Promise<OrchestrateConstructDayResult> \{\s*return runOrchestration\(request, deps, undefined\);\s*\}/.test(src(ORCHESTRATOR)) && /export function constructDay\(input: ConstructDayInput, contentionAttempts\?: ContentionAttempt\[\]\): ConstructDayResult \{/.test(ctor));

console.log('=== no observable change to the Constructor contracts ===');
const iface = (s: string, name: string) => topLevelFields(interfaceBody(s, name));
check('ConstructedDay, ProposedItem, DeferredItem, PlacementConflict and PlacementDiagnostic have exactly their pre-P3a fields (no trace, contention or attempt field on any result type)', JSON.stringify(iface(raw(CONSTRUCTOR), 'ConstructedDay')) === JSON.stringify(['date', 'proposedItems', 'deferredItems', 'conflicts', 'requestedCapacity', 'proposedCapacity']) && JSON.stringify(iface(raw(CONSTRUCTOR), 'ProposedItem')) === JSON.stringify(['intentId', 'activityId', 'title', 'start', 'end', 'placementSource', 'timingFit', 'candidateOrder', 'requiresConfirmation']) && JSON.stringify(iface(raw(CONSTRUCTOR), 'DeferredItem')) === JSON.stringify(['intentId', 'primaryReason', 'diagnostics']) && JSON.stringify(iface(raw(CONSTRUCTOR), 'PlacementConflict')) === JSON.stringify(['intentId', 'conflictingIntentId', 'reason']));
check('ConstructDayInput is unchanged (no diagnostics field was added to the input) and the result union is still READY | NO_USABLE_CAPACITY | INVALID_CONSTRUCTION_WINDOW | TIMEZONE_MISSING', JSON.stringify(iface(raw(CONSTRUCTOR), 'ConstructDayInput')) === JSON.stringify(['intents', 'window', 'blockedIntervals', 'candidatesByIntentId', 'fixedConstraintsByIntentId', 'today']) && /status: 'READY'; day: ConstructedDay/.test(ctor) && count(/\{ status: '(READY|NO_USABLE_CAPACITY|INVALID_CONSTRUCTION_WINDOW|TIMEZONE_MISSING)'/g, ctor.slice(ctor.indexOf('export type ConstructDayResult ='), ctor.indexOf(';', ctor.indexOf("{ status: 'TIMEZONE_MISSING' }")))) === 4);
const dayIntentSrc = raw('apps/web/lib/dayIntent.ts');
check('COMPARATOR UNCHANGED AND UNREAD: dayIntent.ts (the precedence comparator) mentions no contention or trace; the placement ranking region of the Constructor (TIMING_FIT_RANK .. PlacementDeferralReason) contains none either (its behavior hash is pinned by the P0c guard)', !CONTENTION_WORD.test(stripComments(dayIntentSrc)) && !CONTENTION_WORD.test(ctor.slice(ctor.indexOf('const TIMING_FIT_RANK'), ctor.indexOf('export type PlacementDeferralReason'))));
check('NO PUBLIC / SIGNED / PERSISTED EXPOSURE: no preview, signing, acceptance, persistence, Recomposition, presentation, route, capacity or DB module mentions the trace or contention', PUBLIC_SURFACES.every((f) => !CONTENTION_WORD.test(src(f)) && !TRACE_IDENT.test(src(f))));
const migrationSql = fs.readdirSync(path.join(root, 'apps/web/prisma/migrations'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => fs.readFileSync(path.join(root, 'apps/web/prisma/migrations', e.name, 'migration.sql'), 'utf8'));
check('NO PERSISTENCE: the Prisma schema and all 43 migration directories mention no contention; no migration was added', !/ontention/.test(read('apps/web/prisma/schema.prisma')) && migrationSql.length === 43 && migrationSql.every((s) => !/ontention/.test(s)));
check('NO SHADOW / COUNTERFACTUAL / SECOND PASS / POLICY in the trace code: no shadow evaluation, counterfactual construction, pressure-aware second pass, active policy, telemetry or explanation (P3b / P4 / P5 own them)', !/shadow|counterfactual|secondPass|reconstruct|policy|explain|telemetry|wouldHave/i.test(trace) && !/shadow|counterfactual|secondPass|wouldHave/i.test(ctor) && !/shadow|counterfactual|secondPass|wouldHave/i.test(src(ORCHESTRATOR)));
check('NO DECISION-PRESSURE COUPLING ANYWHERE IN THE CONSTRUCTOR PATH: the Constructor and trace modules import nothing of the pressure / evidence / facts chain', !PRESSURE_CHAIN.test(trace) && !/from '\.\/(decisionPressure|decisionEvidence|decisionFacts)'/.test(ctor));

console.log('=== MUTATIONS OF THE GUARD: each violation class, injected into the real tree, is detected ===');
check('MUTATION: the trace module imports / uses DecisionPressure -> detected', flags(audit(mutateFile(real, TRACE, (s) => `import type { DecisionPressure } from './decisionPressure';\n${s}`)), 'G4:trace-module-names-pressure-chain', TRACE) && flags(audit(mutateFile(real, TRACE, (s) => `import type { DecisionPressure } from './decisionPressure';\n${s}`)), 'G4:trace-module-imports-something', TRACE));
check('MUTATION: the trace module reads DecisionEvidence / DecisionFacts / recurrence / opportunity facts -> detected', flags(audit(mutateFile(real, TRACE, (s) => `${s}\nexport const x = (e: { opportunity?: { afterStartViableDays: number } }) => e.opportunity;`)), 'G4:trace-module-names-pressure-chain', TRACE));
check('MUTATION: a Goal / manual / automatic source branch in the trace module -> detected', flags(audit(mutateFile(real, TRACE, (s) => `${s}\nexport const isGoal = (id: string) => id.startsWith('goal-demand');`)), 'G5:trace-module-source-vocabulary', TRACE));
check('MUTATION: value interpretation (an "important" / "stronger" classification) in the trace module -> detected', flags(audit(mutateFile(real, TRACE, (s) => `${s}\nexport const stronger = (e: { round: number }) => e.round > 0;`)), 'G6:trace-module-value-interpretation', TRACE));
check('MUTATION: a clock read or log in the trace module -> detected', flags(audit(mutateFile(real, TRACE, (s) => `${s}\nexport const now = () => Date.now();`)), 'G7:trace-module-io-clock-env-log', TRACE) && flags(audit(mutateFile(real, TRACE, (s) => `${s}\nconsole.log('trace');`)), 'G7:trace-module-io-clock-env-log', TRACE));
check('MUTATION: trace exposed through the preview, the signed result, persistence or the DB layer -> detected', ['apps/web/lib/dayConstructorPreviewRequest.ts', 'apps/web/lib/dayConstructorPreviewIntegrity.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts', 'apps/web/lib/db.ts', 'apps/web/app/api/day-constructor/preview/route.ts'].every((f) => flags(audit(mutateFile(real, f, (s) => `${s}\nexport const leaked = { contentionTrace: [] };`)), 'G8:public-surface-names-trace', f)));
check('MUTATION: the precedence comparator file reads the trace -> detected', flags(audit(mutateFile(real, 'apps/web/lib/dayIntent.ts', (s) => `import type { ContentionTrace } from './contentionTrace';\n${s}`)), 'G9:comparator-file-reads-trace', 'apps/web/lib/dayIntent.ts'));
check('MUTATION: the placement ranking region of the Constructor reads the trace -> detected', flags(audit(mutateFile(real, CONSTRUCTOR, (s) => s.replace('const UNKNOWN_TIMING_FIT_RANK = 4;', 'const UNKNOWN_TIMING_FIT_RANK = 4; const contentionBias = 0;'))), 'G9:placement-ranking-reads-trace', CONSTRUCTOR));
check('MUTATION: a production policy consumer (a new module that calls orchestrateConstructDayWithTrace) -> detected', (() => { const v = audit(addFile(real, 'apps/web/lib/roguePolicy.ts', "import { orchestrateConstructDayWithTrace } from './dayConstructorOrchestrator';\nexport const p = (a: never, b: never) => orchestrateConstructDayWithTrace(a, b);")); return flags(v, 'G3:production-consumer-orchestrateConstructDayWithTrace', 'apps/web/lib/roguePolicy.ts') && flags(v, 'G1:names-trace', 'apps/web/lib/roguePolicy.ts'); })());
check('MUTATION: a new module imports the trace model (an unauthorized producer or consumer) -> detected', flags(audit(addFile(real, 'apps/web/lib/rogueTraceReader.ts', "import type { ContentionEvent } from './contentionTrace';\nexport type E = ContentionEvent;")), 'G2:imports-trace', 'apps/web/lib/rogueTraceReader.ts'));
check('MUTATION: the Constructor names the pressure chain (reads evidence / pressure while observing contention) -> detected', flags(audit(mutateFile(real, CONSTRUCTOR, (s) => `import type { DecisionPressure } from './decisionPressure';\n${s}`)), 'G4:constructor-names-pressure-chain', CONSTRUCTOR));
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
check('both contention suites run in the required PURE job (math-core-tests = "Ephemeris / panchang tests"); no DB job step exists for contention', stepJob.get('test/contentionTrace.test.ts') === 'math-core-tests' && stepJob.get('test/contentionTraceArchitecture.test.ts') === 'math-core-tests' && ![...stepJob.keys()].some((k) => /contention.*Db/i.test(k)));
const FLAKY = /\bctid\b|VACUUM|ANALYZE|EXPLAIN\b|Math\.random|setTimeout|setInterval|Date\.now\(|new Date\(\)|\bsleep\b/;
check('the behavior suite asserts scheduling invariants only: no heap layout, query plan, timer, randomness or wall-clock reading', !FLAKY.test(stripComments(read('test/contentionTrace.test.ts'))));
check('the contention suites make no claim that pressure is wired, that the trace changes an outcome, or that it is a shadow / policy result', !((read('test/contentionTrace.test.ts').match(/check\(`?'?[^\n]*/g) ?? []).some((l) => /changes? the (outcome|winner|placement)|policy is (active|enabled)|shadow result/i.test(l))));

if (!allPassed) {
  console.error('SOME CONTENTION TRACE ARCHITECTURE CHECKS FAILED');
  process.exit(1);
}
console.log('ALL CONTENTION TRACE ARCHITECTURE CHECKS PASSED');
