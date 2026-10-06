/**
 * Constructor Decision Intelligence -- O5 P4b5: the SHADOW EXECUTION & OBSERVATION BOUNDARY (architecture guard, pure).
 *
 * `orchestrateConstructDayWithShadowPolicy` is the Plan Day preview's single orchestration call. This guard pins that it:
 *
 *   - is OFF by default and server-controlled: the mode type is exactly 'OFF' | 'SHADOW' (no ACTIVE), parsed fail-closed from ONE server environment
 *     variable read in ONE place, never from the request, a header, a cookie, a query or the database
 *   - under OFF does nothing but the mode lookup and the original `orchestrateConstructDay` call (the first statement; no composer, timer, sink)
 *   - under SHADOW runs ONE orchestration through the P4b4 composition INSTEAD of the plain call (exactly one orchestration call site -- the OFF return -- and
 *     one composer call site; no preparation, search, load or query of its own), returning the baseline result untouched; the baseline runs AT MOST ONCE
 *     whatever fails: a pre-baseline failure (the baseline itself failed) is rethrown as the plain failure, a post-baseline shadow failure serves the baseline
 *     result the composition handed out -- there is NO baseline-rerun path at all
 *   - isolates every shadow failure (composer, metric derivation, timer, sink) from Plan Day, awaits everything (no unawaited promise, queue or timer)
 *   - emits only a separately-typed minimal metrics record (closed categories and counts) -- never the composition's observation, an identifier, text,
 *     instant, placement or error text -- through a one-way synchronous sink that returns nothing
 *   - has exactly the reviewed production consumers (the preview request boundary and the preview route), is imported by no client file, and is unknown
 *     to P4b2, P4b3, P4b4, the Constructor, the acceptance / persistence / signing code and the schema
 *   - leaks nothing into the HTTP result and decides nothing (no pressure, timing, importance, deadline or originalOrder)
 *
 * Every rule is a PURE FUNCTION over source files: it runs on the real tree (zero violations) AND on the tree with a synthetic violation injected.
 * P4b5 does not implement ACTIVE, P4b6+, P5, R3 or S5.
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


const EXEC = 'apps/web/lib/shadowPolicyExecution.ts';
const COMPOSE = 'apps/web/lib/shadowPolicyObservation.ts';
const REQUEST = 'apps/web/lib/dayConstructorPreviewRequest.ts';
const ROUTE = 'apps/web/app/api/day-constructor/preview/route.ts';
const GEN = 'apps/web/lib/localCounterfactual.ts';
const PRED = 'apps/web/lib/counterfactualAcceptance.ts';
const PREP = 'apps/web/lib/promotionInputPreparation.ts';
const ORCH = 'apps/web/lib/dayConstructorOrchestrator.ts';
const ACCEPTANCE = 'apps/web/lib/dayConstructorAcceptance.ts';
const RECOMP = 'apps/web/lib/remainingDayRecomposition.ts';
const CONSTRUCTOR = 'apps/web/lib/dayConstructor.ts';
/** Everything the execution boundary owns: modes, the environment variable, the sink, the metrics, the settings. */
const EXEC_VOCAB = /\b(ShadowPolicyMode|ShadowPolicySink|ShadowPolicyExecution|ShadowPolicyMetrics|ShadowPolicyLatencyBucket|ShadowPolicyRunCategory|parseShadowPolicyMode|createServerShadowPolicyExecution|serverLogShadowPolicySink|summarizeShadowPolicyRun|orchestrateConstructDayWithShadowPolicy|SHADOW_POLICY_MODE_ENV)\b|AURA_SHADOW_POLICY_MODE|shadowPolicyExecution['"]/;
const EXEC_IMPORTS = [
  `import { orchestrateConstructDay, type ConstructDayRequest, type DayConstructorOrchestratorDeps, type OrchestrateConstructDayResult } from './dayConstructorOrchestrator';`,
  `import { observeShadowPolicy, type ShadowPolicyObservation, type ShadowPolicyRun } from './shadowPolicyObservation';`,
];
const DB_VOCAB = /from '\.\/db'|\bpool\b|\.query\(|beginTransaction|withRepeatableReadSnapshot|prisma|INSERT|UPDATE|DELETE|productEvents|createProductEvent|loadDecisionSchedulingContext|loadBlockingPlans|loadDurationContext|loadAvailabilityConfiguration|prepareDecisionFacts/i;
const SEARCH_VOCAB = /searchTiming|runTimingSearch|timingSearch|excludedIntervals|replenish/i;
const SECOND_RUN_VOCAB = /\bpreparePromotionInputs\b|\borchestrateConstructDayWith(?!ShadowPolicy)\w*|\bconstructDay\w*\(|\bderiveDecisionPressure\b|\bgenerateLocalCounterfactual\b|\bevaluateCounterfactualAcceptance\b|\bsignPreviewResultBody\b/;
const BACKGROUND_VOCAB = /(?:^|[;{}(,]\s*)void\s+[\w(]|\.then\(|\.catch\(|\.finally\(|setTimeout|setInterval|setImmediate|queueMicrotask|nextTick|Promise\.(all|race|allSettled|any)|new Promise|AbortController|waitUntil|unstable_after/;
/** The sink payload and the module may name none of these: identifiers, free text, instants, placements, error detail, policy inputs. */
const PRIVACY_VOCAB = /userId|\buser\b|intentId|ownerId|candidateIntentId|goalId|activityId|planId|\btitle\b|email|birth|nakshatra|tithi|vedic|timestamp|\bstart\b|\bend\b|\bslot\b|placement|\bstack\b|\.message\b|\bpromoted\b|displacedOwnerIds|relocatedOwners|unplacedOwnerIds|\.counterfactual\b|ShadowCounterfactualSummary|ShadowSlot|ShadowRelocatedOwner/i;
const POLICY_VOCAB = /DecisionPressure|\.pressure\b|\bNONE\b|LAST_KNOWN|importance|deadline|originalOrder|compareCandidatesForPlacement|compareAbovePressure|projectAbovePressureFacts|timingFit|\bscore\b|\brank\b|\bwinner\b/i;
const CLOCK_VOCAB = /Date\.now|new Date\(|hrtime/;
const METRIC_KEYS = ['mode', 'run', 'observations', 'generationReady', 'generationUnavailable', 'accepted', 'rejected', 'acceptanceUnavailable', 'latency'];
const UNAWARE = [GEN, PRED, COMPOSE, PREP, ORCH, CONSTRUCTOR, ACCEPTANCE, RECOMP, 'apps/web/lib/dayConstructorPreviewIntegrity.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts', 'apps/web/lib/db.ts', 'apps/web/lib/promotionInput.ts', 'apps/web/lib/promotionContentionAuthority.ts', 'apps/web/lib/schedulingAttemptAuthority.ts', 'apps/web/lib/constructionBasis.ts', 'apps/web/lib/baselinePlacements.ts', 'apps/web/lib/contentionTrace.ts', 'apps/web/lib/counterfactualAcceptance.ts', 'apps/web/lib/decisionPressure.ts', 'apps/web/lib/shadowPressureObservation.ts', 'apps/web/lib/shadowPressureEvaluation.ts', 'apps/web/lib/productEvents.ts', 'apps/web/lib/abovePressurePrecedence.ts'];

function audit(files: SrcFile[]): string[] {
  const v: string[] = [];
  const get = (f: string) => files.find((x) => x.f === f);
  const by = (re: RegExp) => files.filter((x) => re.test(x.src)).map((x) => x.f);
  // E1 -- exact production consumers; vocabulary confinement; every other module unaware
  by(/from '\.\/shadowPolicyExecution'/).filter((f) => ![REQUEST, ROUTE].includes(f) && f !== ROUTE).forEach((f) => v.push(`E1:unexpected-consumer-of-the-execution-boundary:${f}`));
  by(/from '(?:\.\.\/)+lib\/shadowPolicyExecution'/).filter((f) => f !== ROUTE).forEach((f) => v.push(`E1:unexpected-route-consumer:${f}`));
  by(EXEC_VOCAB).filter((f) => ![EXEC, REQUEST, ROUTE].includes(f)).forEach((f) => v.push(`E1:execution-vocabulary-leaked:${f}`));
  for (const f of UNAWARE) { const x = get(f); if (x && EXEC_VOCAB.test(x.src)) v.push(`E1:policy-or-baseline-module-knows-about-modes-or-sinks:${f}`); }
  by(/\borchestrateConstructDayWithShadowPolicy\(/).filter((f) => ![EXEC, REQUEST].includes(f)).forEach((f) => v.push(`E1:another-caller-of-the-boundary:${f}`));
  by(/\bcreateServerShadowPolicyExecution\b/).filter((f) => ![EXEC, ROUTE].includes(f)).forEach((f) => v.push(`E1:another-reader-of-the-server-settings:${f}`));
  by(/\bobserveShadowPolicy\b/).filter((f) => ![COMPOSE, EXEC].includes(f)).forEach((f) => v.push(`E1:another-composer-reference:${f}`));
  by(/process\.env\.AURA_SHADOW_POLICY_MODE|AURA_SHADOW_POLICY_MODE/).filter((f) => f !== EXEC).forEach((f) => v.push(`E1:mode-environment-read-outside-the-boundary:${f}`));
  // plain orchestration call sites: acceptance, recomposition, and (once) the boundary -- NOT the preview request any more
  const plainCallers = by(/\borchestrateConstructDay\(/);
  if (JSON.stringify(plainCallers.sort()) !== JSON.stringify([ORCH, EXEC, RECOMP].sort())) v.push(`E1:plain-orchestration-call-sites-changed:${plainCallers.join('|')}`);
  const m = get(EXEC);
  if (m) {
    const src = m.src;
    if (JSON.stringify(Array.from(src.matchAll(/^import [^\n]*;$/gm)).map((x) => x[0])) !== JSON.stringify(EXEC_IMPORTS)) v.push(`E2:imports-are-not-the-reviewed-two:${EXEC}`);
    const exportsList = Array.from(src.matchAll(/^export (?:async )?(?:function|interface|type|const|class) (\w+)/gm)).map((x) => x[1]);
    if (JSON.stringify(exportsList) !== JSON.stringify(['ShadowPolicyMode', 'SHADOW_POLICY_MODE_ENV', 'parseShadowPolicyMode', 'ShadowPolicyLatencyBucket', 'ShadowPolicyRunCategory', 'ShadowPolicyMetrics', 'ShadowPolicySink', 'ShadowPolicyExecution', 'serverLogShadowPolicySink', 'createServerShadowPolicyExecution', 'summarizeShadowPolicyRun', 'orchestrateConstructDayWithShadowPolicy'])) v.push(`E2:exports-changed:${EXEC}`);
    // MODES, DEFAULT, CONTROL
    if (!/export type ShadowPolicyMode = 'OFF' \| 'SHADOW';/.test(src) || /\bACTIVE\b|'ACTIVE'|\bactive\b/i.test(src)) v.push(`E3:mode-type-is-not-exactly-off-or-shadow:${EXEC}`);
    if (!/return typeof raw === 'string' && raw\.trim\(\) === 'SHADOW' \? 'SHADOW' : 'OFF';/.test(src)) v.push(`E3:parser-is-not-exact-and-fail-closed:${EXEC}`);
    if (count(/process\.env/g, src) !== 1 || !/mode: parseShadowPolicyMode\(process\.env\[SHADOW_POLICY_MODE_ENV\]\)/.test(src) || !/export const SHADOW_POLICY_MODE_ENV = 'AURA_SHADOW_POLICY_MODE';/.test(src)) v.push(`E3:mode-is-not-read-once-from-the-server-environment:${EXEC}`);
    if (/headers|cookie|searchParams|\.body\b|request\.\w*[Mm]ode|\bquery\b/.test(src)) v.push(`E3:mode-could-come-from-the-request:${EXEC}`);
    // OFF SEMANTICS: the FIRST statement after the baseline closure, before anything else is touched
    if (!/\{\n  if \(!execution \|\| execution\.mode !== 'SHADOW'\) return orchestrateConstructDay\(request, deps\);\n  const observe = /.test(src)) v.push(`E4:off-is-not-the-first-statement-and-the-plain-call:${EXEC}`);
    // ONE orchestration, one composer call, no second run
    if (count(/\borchestrateConstructDay\(/g, src) !== 1 || /\bbaseline\s*\(|\bbaseline\s*=/.test(src)) v.push(`E5:orchestration-call-sites-changed-or-a-baseline-rerun-closure-exists:${EXEC}`);
    if (count(/\bobserveShadowPolicy\b/g, src) !== 4 || count(/\bawait observe\(request, deps, \(result\) => \{ held = \{ result \}; \}\)/g, src) !== 1 || count(/\bawait\b/g, src) !== 1 || !/const observe = execution\.observe \?\? observeShadowPolicy;/.test(src)) v.push(`E5:composer-is-not-called-exactly-once-awaited:${EXEC}`);
    if (SECOND_RUN_VOCAB.test(src) || DB_VOCAB.test(src) || SEARCH_VOCAB.test(src)) v.push(`E5:second-preparation-load-search-or-query:${EXEC}`);
    // FAILURE ISOLATION and the baseline result untouched
    if (!/let held: \{ readonly result: OrchestrateConstructDayResult \} \| undefined;\n  let observed: Awaited<ReturnType<typeof observeShadowPolicy>>;\n  try \{\n    observed = await observe\(request, deps, \(result\) => \{ held = \{ result \}; \}\);\n  \} catch \(error\) \{\s*if \(!held\) throw error;\s*emit\(execution, summarizeTechnicalFailure\(\)\);\s*return held\.result;\s*\}\n  emitRun\(execution, observed\.shadowPolicy, started\);\n  return observed\.result;/.test(src)) v.push(`E6:composer-failure-is-not-isolated-or-the-result-is-not-the-baseline:${EXEC}`);
    if (!/function emitRun\([^)]*\): void \{\n  try \{[\s\S]*?\} catch \{[\s\S]*?\}\n\}/.test(src) || !/function emit\([^)]*\): void \{\n  try \{\n    execution\.sink\?\.record\(metrics\);\n  \} catch \{/.test(src) || !/function startTimer\([^)]*\): number \| undefined \{\n  try \{[\s\S]*?\} catch \{\n    return undefined;/.test(src)) v.push(`E6:metric-timer-or-sink-failure-is-not-isolated:${EXEC}`);
    if (count(/\.record\(/g, src) !== 1 || /return observed\.shadowPolicy|result: observed\.shadowPolicy/.test(src)) v.push(`E6:sink-call-sites-changed-or-shadow-escapes:${EXEC}`);
    // SYNCHRONOUS, AWAITED, NO BACKGROUND WORK; the sink is one-way and returns nothing
    if (BACKGROUND_VOCAB.test(src) || !/readonly record: \(metrics: ShadowPolicyMetrics\) => void;/.test(src)) v.push(`E7:background-work-or-a-sink-that-returns-something:${EXEC}`);
    // PRIVACY / minimal observation
    if (PRIVACY_VOCAB.test(src)) v.push(`E8:identifier-text-instant-placement-or-error-detail-vocabulary:${EXEC}`);
    const metricFields = Array.from(((src.match(/export interface ShadowPolicyMetrics \{[\s\S]*?\n\}/) ?? [''])[0]).matchAll(/readonly (\w+):/g)).map((x) => x[1]);
    if (JSON.stringify(metricFields) !== JSON.stringify(METRIC_KEYS)) v.push(`E8:sink-payload-is-not-the-reviewed-minimal-schema:${EXEC}`);
    if (count(/Object\.freeze\(\{ mode: 'SHADOW'/g, src) !== 3 || /\{ mode: 'SHADOW', run:[^}]*(?:observation\b|candidate)/.test(src)) v.push(`E8:metrics-are-not-frozen-categories:${EXEC}`);
    if (/console\.(?!info)/.test(src) || count(/console\.info\(/g, src) !== 1 || !/console\.info\(JSON\.stringify\(\{ event: 'DAY_CONSTRUCTOR_SHADOW_POLICY', \.\.\.metrics \}\)\);/.test(src)) v.push(`E8:default-sink-is-not-one-aggregate-line:${EXEC}`);
    if (!/export const serverLogShadowPolicySink: ShadowPolicySink = Object\.freeze/.test(src)) v.push(`E8:default-sink-is-not-frozen:${EXEC}`);
    // observation-only clock; no policy, no Dates
    if (CLOCK_VOCAB.test(src) || count(/performance\.now\(\)/g, src) !== 2) v.push(`E9:wall-clock-or-unexpected-timer:${EXEC}`);
    if (POLICY_VOCAB.test(src)) v.push(`E9:policy-vocabulary-in-the-execution-boundary:${EXEC}`);
    if (!/summarizeShadowPolicyRun\(run, latency\)/.test(src) || /latency[^\n]*observed\.result|observed\.result[^\n]*latency/.test(src)) v.push(`E9:latency-could-influence-the-response:${EXEC}`);
    if (/module\.exports|require\(/.test(src) || /^(let|var) |^const \w+ = (new |\[|\{)/m.test(src.replace(/export const SHADOW_POLICY_MODE_ENV[^\n]*\n/, ''))) v.push(`E9:module-level-state-or-require:${EXEC}`);
  }
  // E10 -- the wiring: exactly the reviewed, server-supplied seam; nothing in the HTTP result
  const req = get(REQUEST);
  if (req) {
    const s = req.src;
    if (!/const result = await orchestrateConstructDayWithShadowPolicy\(decisionFactsByIntentId \? \{ \.\.\.parsed\.request, decisionFactsByIntentId \} : parsed\.request, orchestrationDeps, shadowPolicy\);/.test(s)) v.push(`E10:preview-orchestration-call-is-not-the-reviewed-wiring:${REQUEST}`);
    if (!/deps\.shadowPolicy \? deps\.shadowPolicy\(\) : undefined\);/.test(s) || !/shadowPolicy\?: \(\) => ShadowPolicyExecution;/.test(s) || !/shadowPolicy\?: ShadowPolicyExecution\n/.test(s)) v.push(`E10:mode-is-not-server-supplied-only:${REQUEST}`);
    if (!/return \{ httpStatus: 200, body: result \};/.test(s) || /headers|Set-Cookie|cookie/i.test(s.replace(/\/\/.*$/gm, ''))) v.push(`E10:shadow-could-reach-the-http-result:${REQUEST}`);
    const parser = (s.match(/export function parseConstructDayPreviewRequestBody[\s\S]*?\n\}\n/) ?? [''])[0];
    if (/shadow|mode\b|policy|counterfactual/i.test(parser.replace(/constructionWindowSource/g, ''))) v.push(`E10:request-parser-reads-a-mode:${REQUEST}`);
    if (count(/\bshadowPolicy\b/g, s) !== 5 || count(/ShadowPolicyExecution/g, s) !== 3) v.push(`E10:unexpected-shadow-references-in-the-preview-request:${REQUEST}`);
  }
  const rt = get(ROUTE);
  if (rt) {
    if (!/shadowPolicy: createServerShadowPolicyExecution,/.test(rt.src) || count(/\bshadowPolicy\b/g, rt.src) !== 1 || /headers\.get|cookies|searchParams|req\.nextUrl/.test(rt.src)) v.push(`E10:route-wiring-is-not-the-server-settings-only:${ROUTE}`);
  }
  // E11 -- server-only: no client file may import the boundary or the preview request
  for (const x of files) if (/^\s*['"]use client['"]/m.test(x.src) && /shadowPolicyExecution|dayConstructorPreviewRequest/.test(x.src)) v.push(`E11:client-file-imports-server-only-shadow-code:${x.f}`);
  return v;
}
const real = productionFiles();
const src = (f: string) => real.find((x) => x.f === f)!.src;
const mutateFile = (files: SrcFile[], f: string, fn: (s: string) => string): SrcFile[] => files.map((x) => (x.f === f ? { f, src: fn(x.src) } : x));
const addFile = (files: SrcFile[], f: string, s: string): SrcFile[] => [...files, { f, src: s }];
const flags = (violations: string[], prefix: string, file?: string) => violations.some((x) => x.startsWith(prefix) && (file === undefined || x.endsWith(`:${file}`)));
const names = (re: RegExp) => real.filter((x) => re.test(x.src)).map((x) => x.f);
const auditM = (f: string, fn: (s: string) => string) => audit(mutateFile(real, f, fn));
/** Replace `from` (tolerating the trailing blanks that stripped line comments leave before a newline) with `to`; a missing target is an error, never a silent pass. */
const rep = (from: string, to: string) => (s: string) => {
  const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\n/g, '[ \\t]*\n'));
  if (!re.test(s)) throw new Error(`mutation target missing: ${from.slice(0, 80)}`);
  return s.replace(re, () => to);
};

console.log('=== the real tree conforms ===');
const baseline = audit(real);
check(`THE REAL PRODUCTION TREE HAS ZERO SHADOW-EXECUTION ARCHITECTURE VIOLATIONS (${real.length} production files scanned)${baseline.length ? ': ' + baseline.join(', ') : ''}`, baseline.length === 0);

console.log('=== consumers, confinement, unaware upstream ===');
check('EXACT PRODUCTION CONSUMERS (2): the execution boundary is imported only by the Plan Day preview request boundary and the preview route; the boundary function is called only by the preview request boundary; the server settings are read only by the route', JSON.stringify(names(/from '(?:\.\/|(?:\.\.\/)+lib\/)shadowPolicyExecution'/)) === JSON.stringify([ROUTE, REQUEST].sort()) && JSON.stringify(names(/\borchestrateConstructDayWithShadowPolicy\(/)) === JSON.stringify([EXEC, REQUEST].sort()) && JSON.stringify(names(/\bcreateServerShadowPolicyExecution\b/)) === JSON.stringify([EXEC, ROUTE].sort()));
check('P4b4 HAS ONE PRODUCTION CONSUMER: the composition is referenced only by itself and the execution boundary, which uses it INSTEAD of the plain orchestration (ONE orchestration call site -- the OFF return -- and no baseline-rerun closure: a shadow failure never re-runs the baseline)', JSON.stringify(names(/\bobserveShadowPolicy\b/)) === JSON.stringify([COMPOSE, EXEC].sort()) && !flags(audit(real), 'E5:'));
check('NO ACCIDENTAL SECOND EXECUTION PATH: the plain orchestration is defined in the orchestrator and called only by recomposition and (once) the boundary; the Plan Day preview no longer calls it directly', JSON.stringify(names(/\borchestrateConstructDay\(/)) === JSON.stringify([ORCH, EXEC, RECOMP].sort()));
check('UNAWARE UPSTREAM: P4b2, P4b3, P4b4, the preparation boundary, the orchestrator, the Constructor, acceptance, recomposition, persistence, signing, the database module and the product-event taxonomy know nothing of modes, the environment variable, sinks, metrics or latency', UNAWARE.every((f) => !EXEC_VOCAB.test(src(f))) && !flags(audit(real), 'E1:'));
const migrationSql = fs.readdirSync(path.join(root, 'apps/web/prisma/migrations'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => fs.readFileSync(path.join(root, 'apps/web/prisma/migrations', e.name, 'migration.sql'), 'utf8'));
check('NO NEW DATABASE, NO SCHEMA, NO PRODUCT-EVENT WRITE: the Prisma schema and all 43 migration directories mention no shadow policy; the boundary imports no database or product-event module', !/ShadowPolicy|shadowPolicy|SHADOW_POLICY/.test(read('apps/web/prisma/schema.prisma')) && migrationSql.length === 43 && migrationSql.every((s) => !/ShadowPolicy|SHADOW_POLICY/.test(s)) && !DB_VOCAB.test(src(EXEC)));
check('SERVER-ONLY: no client component imports the boundary or the preview request, and the boundary imports no browser API', !flags(audit(real), 'E11:') && !/window\.|document\.|localStorage/.test(src(EXEC)));
const ci = read('.github/workflows/ci.yml');
check('REQUIRED CI: the P4b5 behavior, architecture and real-DB OFF / SHADOW parity suites and the seeded-fixture reproducibility suite are mandatory steps', ['shadowPolicyExecution.test.ts', 'shadowPolicyExecutionArchitecture.test.ts', 'seededFixtureReproducibility.test.ts', 'shadowPolicyExecutionDb.test.ts'].every((t) => ci.includes(`npx ts-node test/${t}`)));

console.log('=== OFF by default, server-controlled, no ACTIVE; one orchestration; isolated; synchronous ===');
check('MODES: the type is exactly \'OFF\' | \'SHADOW\' (no ACTIVE); the parser selects SHADOW only for exactly SHADOW and is OFF otherwise; the ONE environment read is the only source; nothing reads a request, header, cookie, query or the database', !flags(audit(real), 'E3:'));
check('OFF = NOTHING BUT THE MODE LOOKUP: the first statement after the baseline closure returns the plain `orchestrateConstructDay` call, before any composer, timer or sink is touched', !flags(audit(real), 'E4:'));
check('SHADOW = ONE ORCHESTRATION: one plain-orchestration call site, one awaited composer call (the composition is called INSTEAD of the plain call), no preparation, generator, predicate, Constructor, search, load, query or signing of its own; the baseline result is returned untouched', !flags(audit(real), 'E5:') && !flags(audit(real), 'E6:composer-failure'));
check('FAIL-OPEN RELATIVE TO PLAN DAY: the composer, the metric derivation, the timer and the sink are each isolated (try / catch); a composer failure serves the unchanged baseline; the shadow outcome never escapes into the return value', !flags(audit(real), 'E6:'));
check('SYNCHRONOUS AND AWAITED: no unawaited promise (no `void`, `.then`, `.catch`, timer, queue, race, waitUntil); exactly one `await`; the sink is a one-way function returning nothing', !flags(audit(real), 'E7:'));
check('MINIMAL OBSERVATION: the sink payload is a separate type with exactly the nine reviewed fields of closed categories and counts; the module names no user / intent / owner / goal / activity / plan identifier, title, instant, placement, stack or error text and reads none of the composition\'s summaries; the default sink writes ONE aggregate line', !flags(audit(real), 'E8:'));
check('OBSERVABILITY-ONLY CLOCK, NO POLICY: the only clock is `performance.now()` (twice, in the timer path), no wall clock, no pressure / timing / importance / deadline / originalOrder, latency never enters the returned result, no module state', !flags(audit(real), 'E9:'));
check('THE WIRING IS THE REVIEWED SEAM: the preview request makes its one orchestration through the boundary with a SERVER-supplied settings accessor, returns only { httpStatus, body: result } (no header, cookie or field), its parser reads no mode, and the route passes only `createServerShadowPolicyExecution`', !flags(audit(real), 'E10:'));

console.log('=== MUTATIONS: each violation, injected into an in-memory copy, is detected ===');
check('MUTATION: OFF calls the composer / sink / timer before the OFF return; the OFF return is not the plain call -> detected', flags(auditM(EXEC, rep("  if (!execution || execution.mode !== 'SHADOW') return orchestrateConstructDay(request, deps);\n", "  const early = execution?.observe;\n  if (!execution || execution.mode !== 'SHADOW') return orchestrateConstructDay(request, deps);\n")), 'E4:', EXEC) && flags(auditM(EXEC, rep("if (!execution || execution.mode !== 'SHADOW') return orchestrateConstructDay(request, deps);", "if (!execution) return orchestrateConstructDay(request, deps);")), 'E4:', EXEC) && flags(auditM(EXEC, rep("return orchestrateConstructDay(request, deps);\n  const observe", "return observeShadowPolicy(request, deps).then((o) => o.result);\n  const observe")), 'E4:', EXEC));
check('MUTATION: an unknown or missing configuration selects SHADOW; the parser is loosened (case-insensitive, truthy); an ACTIVE mode appears; the mode reads a request -> detected', flags(auditM(EXEC, rep("raw.trim() === 'SHADOW' ? 'SHADOW' : 'OFF'", "raw.trim() === 'OFF' ? 'OFF' : 'SHADOW'")), 'E3:parser', EXEC) && flags(auditM(EXEC, rep("raw.trim() === 'SHADOW'", "raw.trim().toUpperCase() === 'SHADOW'")), 'E3:parser', EXEC) && flags(auditM(EXEC, rep("export type ShadowPolicyMode = 'OFF' | 'SHADOW';", "export type ShadowPolicyMode = 'OFF' | 'SHADOW' | 'ACTIVE';")), 'E3:mode-type', EXEC) && flags(auditM(EXEC, (s) => `${s}\nexport const fromRequest = (req: { headers: { get: (k: string) => string } }) => req.headers.get('x-shadow');`), 'E3:mode-could-come', EXEC) && flags(auditM(EXEC, rep("parseShadowPolicyMode(process.env[SHADOW_POLICY_MODE_ENV])", "'SHADOW'")), 'E3:mode-is-not-read-once', EXEC));
check('MUTATION: a CLIENT OVERRIDE (the request parser reads a mode / the settings accessor is fed from the body / the route reads a header) -> detected', flags(auditM(REQUEST, (s) => s.replace("if (!isPlainObject(body)) return { ok: false, error: 'Request body must be a JSON object.' };", "if (!isPlainObject(body)) return { ok: false, error: 'Request body must be a JSON object.' };\n  const shadowMode = (body as { shadowPolicyMode?: string }).shadowPolicyMode;\n  void shadowMode;")), 'E10:request-parser-reads-a-mode', REQUEST) && flags(auditM(REQUEST, rep("deps.shadowPolicy ? deps.shadowPolicy() : undefined);", "(body as { shadow?: ShadowPolicyExecution }).shadow);")), 'E10:mode-is-not-server-supplied', REQUEST) && flags(auditM(ROUTE, rep("shadowPolicy: createServerShadowPolicyExecution,", "shadowPolicy: () => ({ mode: req.headers.get('x-shadow') === '1' ? 'SHADOW' : 'OFF' } as never),")), 'E10:route-wiring', ROUTE));
check('MUTATION: DOUBLE PREPARATION / DOUBLE SEARCH / a second orchestration, a load or a query (the boundary runs the plain call AND the composition; a second preparation, search or query is added) -> detected', flags(auditM(EXEC, rep("    observed = await observe(request, deps, (result) => { held = { result }; });", "    await orchestrateConstructDay(request, deps);\n    observed = await observe(request, deps, (result) => { held = { result }; });")), 'E5:', EXEC) && flags(auditM(EXEC, (s) => `${s}\nconst p = (r: never, d: never) => preparePromotionInputs(r, d);`), 'E5:second-preparation', EXEC) && flags(auditM(EXEC, (s) => `${s}\nconst q = (d: { searchTiming: () => void }) => d.searchTiming();`), 'E5:second-preparation', EXEC) && flags(auditM(EXEC, (s) => `${s}\nconst l = () => pool.query('SELECT 1');`), 'E5:second-preparation', EXEC) && flags(auditM(EXEC, rep("    return held.result;\n  }\n  emitRun", "    return orchestrateConstructDay(request, deps);\n  }\n  emitRun")), 'E5:', EXEC) && flags(auditM(EXEC, rep("    if (!held) throw error;", "    if (!held) return orchestrateConstructDay(request, deps);")), 'E5:', EXEC) && flags(auditM(EXEC, rep("    return held.result;\n  }\n  emitRun", "    await orchestrateConstructDay(request, deps);\n    return held.result;\n  }\n  emitRun")), 'E5:', EXEC));
check('MUTATION: ACCEPT REPLACES THE BASELINE / changes the signature (the shadow outcome escapes into the returned result or the HTTP body) -> detected', flags(auditM(EXEC, rep("  return observed.result;", "  return (observed.shadowPolicy.status === 'READY' && observed.shadowPolicy.observations.some((o) => o.outcome === 'ACCEPT') ? ({ status: 'APPLIED' } as never) : observed.result);")), 'E6:', EXEC) && flags(auditM(REQUEST, rep("return { httpStatus: 200, body: result };", "return { httpStatus: 200, body: { ...result, shadow: true } };")), 'E10:shadow-could-reach', REQUEST) && flags(auditM(EXEC, (s) => `${s}\nexport const sig = () => signPreviewResultBody('u', {});`), 'E5:', EXEC));
check('MUTATION: A SHADOW THROW / SINK THROW / TIMER THROW FAILS THE REQUEST (the isolation removed or the failure rethrown) -> detected', flags(auditM(EXEC, rep("    emit(execution, summarizeTechnicalFailure());\n    return held.result;", "    throw new Error('composer');")), 'E6:composer-failure', EXEC) && flags(auditM(EXEC, rep("    execution.sink?.record(metrics);\n  } catch {", "    execution.sink?.record(metrics);\n  } catch (error) {\n    throw error;\n  } finally {")), 'E6:metric-timer-or-sink', EXEC) && flags(auditM(EXEC, rep("  } catch {\n    return undefined;", "  } catch {\n    throw new Error('timer');")), 'E6:metric-timer-or-sink', EXEC));
check('MUTATION: AN UNAWAITED PROMISE / fire-and-forget / timer / queue / waitUntil -> detected', flags(auditM(EXEC, rep("    observed = await observe(request, deps, (result) => { held = { result }; });", "    void observe(request, deps);\n    observed = await observe(request, deps, (result) => { held = { result }; });")), 'E7:', EXEC) && flags(auditM(EXEC, (s) => `${s}\nconst a = () => observeShadowPolicy({} as never, {} as never).catch(() => undefined);`), 'E7:', EXEC) && flags(auditM(EXEC, (s) => `${s}\nconst t = () => setTimeout(() => undefined, 0);`), 'E7:', EXEC) && flags(auditM(EXEC, rep('readonly record: (metrics: ShadowPolicyMetrics) => void;', 'readonly record: (metrics: ShadowPolicyMetrics) => Promise<void>;')), 'E7:', EXEC));
check('MUTATION: A RESPONSE LEAK / header / cookie / the full P4b4 object to the sink / a placement, a user id, an owner id, an exact time label or free text in the payload -> detected', flags(auditM(EXEC, rep("  readonly latency: ShadowPolicyLatencyBucket;\n}", "  readonly latency: ShadowPolicyLatencyBucket;\n  readonly run2: ShadowPolicyRun;\n}")), 'E8:sink-payload', EXEC) && flags(auditM(EXEC, (s) => `${s}\nconst u = (m: { userId: string }) => m.userId;`), 'E8:identifier', EXEC) && flags(auditM(EXEC, (s) => `${s}\nconst o = (x: { candidateIntentId: string }) => x.candidateIntentId;`), 'E8:identifier', EXEC) && flags(auditM(EXEC, (s) => `${s}\nconst p = (c: { promoted: unknown }) => c.promoted;`), 'E8:identifier', EXEC) && flags(auditM(EXEC, (s) => `${s}\nconst e = (e: Error) => e.message;`), 'E8:identifier', EXEC) && flags(auditM(EXEC, (s) => `${s}\nimport type { ShadowSlot } from './shadowPolicyObservation';`), 'E2:imports', EXEC) && flags(auditM(EXEC, rep("console.info(JSON.stringify({ event: 'DAY_CONSTRUCTOR_SHADOW_POLICY', ...metrics }));", "console.info(JSON.stringify({ event: 'DAY_CONSTRUCTOR_SHADOW_POLICY', ...metrics, ...({ run: 'x' } as object) }), metrics);")), 'E8:default-sink', EXEC) && flags(auditM(REQUEST, (s) => `${s}\nconst h = { headers: { 'x-shadow': 'accept' } };`), 'E10:shadow-could-reach', REQUEST));
check('MUTATION: policy reads the mode / the timer affects the result / a policy module learns about modes, sinks or latency -> detected', ['apps/web/lib/localCounterfactual.ts', 'apps/web/lib/counterfactualAcceptance.ts', 'apps/web/lib/shadowPolicyObservation.ts', 'apps/web/lib/promotionInputPreparation.ts', 'apps/web/lib/dayConstructorOrchestrator.ts', 'apps/web/lib/dayConstructor.ts', 'apps/web/lib/dayConstructorAcceptance.ts', 'apps/web/lib/dayConstructorPreviewIntegrity.ts'].every((f) => flags(auditM(f, (s) => `${s}\nexport const m = (x: ShadowPolicyMode) => x === 'SHADOW';`), 'E1:policy-or-baseline-module-knows', f)) && flags(auditM(EXEC, (s) => `${s}\nconst k = (x: { pressure: string }) => x.pressure === 'NONE';`), 'E9:policy-vocabulary', EXEC) && flags(auditM(EXEC, (s) => `${s}\nconst n = () => Date.now();`), 'E9:wall-clock', EXEC));
check('MUTATION: a second production consumer / another caller of the boundary, the server settings or the composer / a mode read outside the boundary / a client import -> detected', flags(audit(addFile(real, 'apps/web/lib/rogue1.ts', "import { orchestrateConstructDayWithShadowPolicy } from './shadowPolicyExecution';\nexport const a = orchestrateConstructDayWithShadowPolicy;")), 'E1:unexpected-consumer', 'apps/web/lib/rogue1.ts') && flags(audit(addFile(real, 'apps/web/lib/rogue2.ts', "export const m = process.env.AURA_SHADOW_POLICY_MODE;")), 'E1:mode-environment-read', 'apps/web/lib/rogue2.ts') && flags(audit(addFile(real, 'apps/web/lib/rogue3.ts', "export const c = () => createServerShadowPolicyExecution();")), 'E1:another-reader', 'apps/web/lib/rogue3.ts') && flags(audit(addFile(real, 'apps/web/lib/rogue4.ts', "export const c = () => observeShadowPolicy({} as never, {} as never);")), 'E1:another-composer', 'apps/web/lib/rogue4.ts') && flags(audit(addFile(real, 'apps/web/app/rogue/RogueClient.tsx', "'use client';\nimport { createServerShadowPolicyExecution } from '../../lib/shadowPolicyExecution';\nexport const x = createServerShadowPolicyExecution;")), 'E11:', 'apps/web/app/rogue/RogueClient.tsx') && flags(audit(addFile(real, 'apps/web/lib/rogue5.ts', "export const a = (r: never, d: never) => orchestrateConstructDay(r, d);")), 'E1:plain-orchestration-call-sites-changed') && flags(auditM(REQUEST, (s) => `${s}\nconst again = (r: never, d: never) => orchestrateConstructDay(r, d);`), 'E1:plain-orchestration-call-sites-changed'));
check('MUTATION: a new database write / product event / schema in the boundary -> detected', flags(auditM(EXEC, (s) => `${s}\nconst w = () => createProductEvent({ eventName: 'SHADOW' });`), 'E5:second-preparation', EXEC) && flags(auditM(EXEC, (s) => `${s}\nconst w = () => pool.query('INSERT INTO "ShadowObservation" VALUES (1)');`), 'E5:second-preparation', EXEC));
check('the mutations were applied to in-memory copies only: the real tree still has zero violations afterwards', audit(productionFiles()).length === 0);

if (!allPassed) {
  console.error('SOME SHADOW EXECUTION ARCHITECTURE CHECKS FAILED');
  process.exit(1);
}
console.log('ALL SHADOW EXECUTION ARCHITECTURE CHECKS PASSED');
