/**
 * Constructor Decision Intelligence -- O5 P2a: immutable DecisionEvidence (architecture guard, pure).
 *
 * Pins that DecisionEvidence is a generic, readonly, deep-frozen, by-value-copied evidence type built exactly once at the
 * P1 preparation stage, with no database access, no source (Goal) vocabulary and no pressure/policy vocabulary -- and that
 * P2a stayed infrastructure only: nothing in the Constructor, the precedence comparator, placement, capacity or
 * replenishment reads evidence, the request/response and signing contracts did not change, and there is no snapshot work.
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
function blockAfter(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing marker ${marker}`);
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`unterminated block after ${marker}`);
}
function interfaceFields(source: string, name: string): string[] {
  const start = source.indexOf(`export interface ${name}`);
  const open = source.indexOf('{', start);
  const close = source.indexOf('\n}', open);
  return stripComments(source.slice(open + 1, close)).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.split(/[:?]/)[0].trim()).filter((n) => /^[A-Za-z]+$/.test(n));
}

const evidenceSrc = read('apps/web/lib/decisionEvidence.ts');
const evidence = stripComments(evidenceSrc);
const prepSrc = read('apps/web/lib/decisionFactPreparation.ts');
const prep = stripComments(prepSrc);
const orch = stripComments(read('apps/web/lib/dayConstructorOrchestrator.ts'));
const factsSrc = read('apps/web/lib/decisionFacts.ts');
const prepareFn = blockAfter(prep, 'export function prepareDecisionEvidence');
const buildFn = blockAfter(evidence, 'export function buildDecisionEvidence');
const copyRec = blockAfter(evidence, 'function copyRecurrence');
const copyOpp = blockAfter(evidence, 'function copyOpportunity');

// ---- the type: readonly, generic, new, distinct ----
check('DecisionEvidence exists as its own exported type in its own module, distinct from DecisionFacts (which keeps its name and contract)', /export interface DecisionEvidence \{/.test(evidence) && /export interface DecisionFacts \{/.test(factsSrc) && !/DecisionEvidence/.test(factsSrc));
check('READONLY CONTRACT: the evidence interface has readonly members and the nested evidence types are `Readonly<...>` of the existing contracts', /readonly recurrence\?: RecurrenceEvidence;/.test(evidence) && /readonly opportunity\?: OpportunityEvidence;/.test(evidence) && /export type RecurrenceEvidence = Readonly<RecurrenceDecisionFacts>;/.test(evidence) && /export type OpportunityEvidence = Readonly<OpportunityDecisionFacts>;/.test(evidence));
check('the module documents the DecisionFacts / DecisionEvidence distinction (transport vs immutable policy authority)', /DecisionFacts\s+\(decisionFacts\.ts\)/.test(evidenceSrc) && /DecisionEvidence\s+\(this module\)/.test(evidenceSrc) && /NOT A SNAPSHOT OF THE DATABASE/.test(evidenceSrc));
check('GENERIC LOCATION: the type lives in a generic Decision Intelligence module (apps/web/lib/decisionEvidence.ts) and is built by the generic preparation module, not by any Goal-specific file', fs.existsSync(path.join(root, 'apps/web/lib/decisionEvidence.ts')) && /buildDecisionEvidence/.test(prep) && !/buildDecisionEvidence|DecisionEvidence/.test(stripComments(read('apps/web/lib/goalDecisionFactsProvider.ts'))));

// ---- deep freeze + copy-by-value ----
check('DEEP FREEZE: the outer evidence object and each nested evidence object are frozen (three `Object.freeze` sites: outer, recurrence copy, opportunity copy)', count(/Object\.freeze\(/g, evidence) === 3 && /Object\.freeze\(/.test(buildFn) && /Object\.freeze\(/.test(copyRec) && /Object\.freeze\(/.test(copyOpp));
const recFields = interfaceFields(factsSrc, 'RecurrenceDecisionFacts');
const oppFields = interfaceFields(factsSrc, 'OpportunityDecisionFacts');
check('FIELD PARITY: the evidence copies exactly the seven recurrence and twelve opportunity contract fields declared in decisionFacts.ts (no field added, dropped or renamed -- drift in either file fails here)', recFields.length === 7 && oppFields.length === 12 && recFields.every((f) => new RegExp(`\\b${f}: source\\.${f}\\b`).test(copyRec)) && oppFields.every((f) => new RegExp(`\\b${f}: source\\.${f}\\b`).test(copyOpp)) && count(/: source\./g, copyRec) === 7 && count(/: source\./g, copyOpp) === 12);
check('BY VALUE: the copies are built field by field -- no spread of the source, and no source object (or nested part of it) is returned or retained', !/\.\.\.\s*source/.test(copyRec + copyOpp) && !/return source\b|return facts\b|=\s*facts\.(recurrence|opportunity)\s*[;,)]/.test(evidence) && /copyRecurrence\(facts\.recurrence\)/.test(buildFn) && /copyOpportunity\(facts\.opportunity\)/.test(buildFn));
check('ABSENCE STAYS ABSENCE: no category is manufactured -- an absent category adds no key, and facts with no category return undefined', /facts\.recurrence \? copyRecurrence/.test(buildFn) && /facts\.opportunity \? copyOpportunity/.test(buildFn) && /if \(!recurrence && !opportunity\) return undefined;/.test(buildFn) && /\.\.\.\(recurrence \? \{ recurrence \} : \{\}\)/.test(buildFn));

// ---- pure, no DB, no source vocabulary, no policy vocabulary ----
check('NO RUNTIME IMPORTS and NO DB: the evidence module imports only types (no db, pg, pool, orchestrator) and has no async code, query or transaction', count(/^import /gm, evidence) === 1 && /^import type \{ DecisionFacts, OpportunityDecisionFacts, RecurrenceDecisionFacts \} from '\.\/decisionFacts';/m.test(evidence) && !/\basync\b|\bawait\b|\.query\(|pool|pg\b|beginTransaction|Promise/.test(evidence));
check('NO DB in the preparation function: `prepareDecisionEvidence` is synchronous and issues no query, transaction or write (zero queries, zero writes)', !/\basync\b|\bawait\b|\.query\(|pool|beginTransaction|INSERT|UPDATE|DELETE|Promise|createPlanned/.test(prepareFn) && /export function prepareDecisionEvidence\(/.test(prep));
const SOURCE_VOCAB = /goal|manual|automatic|demand|provenance|handoff|rhythm|plan-day|goal-demand/i;
check('NO GOAL-SOURCE VOCABULARY: neither the evidence module nor the evidence-preparation function mentions Goals, manual/automatic origin, demand ids or provenance (source neutrality: there is no source parameter and no source branch)', !SOURCE_VOCAB.test(evidence) && !SOURCE_VOCAB.test(prepareFn) && !/intentId\.(startsWith|includes|match)|decode|encode/.test(prepareFn));
const POLICY_VOCAB = /LAST_KNOWN_OPPORTUNITY|pressure|promot|urgen|priorit|winner|rank|\bscore|shadow|boost|weight|importance|deadline|originalOrder|timingFit|contention|capacityState|flexib|targetDate/i;
check('NO PRESSURE / POLICY VOCABULARY: the evidence module and its preparation function contain no pressure, priority, score, ranking, promotion, urgency, winner, importance, deadline, flexibility, contention, capacity or target-date concept (evidence is data only)', !POLICY_VOCAB.test(evidence) && !POLICY_VOCAB.test(prepareFn));
check('the builder takes the facts and nothing else: no clock, no id, no request in its signature', /export function buildDecisionEvidence\(facts: DecisionFacts \| undefined\): DecisionEvidence \| undefined/.test(evidence) && !/new Date|Date\.now|process\.env/.test(evidence));

// ---- built once, at the preparation stage ----
const prodFiles = (() => {
  const out: Array<{ f: string; src: string }> = [];
  const walk = (dir: string) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).forEach((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.')) walk(rel); } else if (/\.(ts|tsx)$/.test(e.name)) out.push({ f: rel, src: stripComments(read(rel)) });
  });
  walk('apps/web/lib'); walk('apps/web/app'); walk('apps/web/components');
  return out;
})();
const mentions = (re: RegExp) => prodFiles.filter((x) => re.test(x.src)).map((x) => x.f).sort();
check('SINGLE PREPARATION SITE: `buildDecisionEvidence(` is called in exactly one production place -- the preparation function', mentions(/buildDecisionEvidence\(/).join() === ['apps/web/lib/decisionEvidence.ts', 'apps/web/lib/decisionFactPreparation.ts'].join() && count(/buildDecisionEvidence\(/g, prep) === 1 && /buildDecisionEvidence\(facts\)/.test(prepareFn));
check('ONLY THE PREPARATION STAGE AND THE UNWIRED PRESSURE DERIVER KNOW EVIDENCE: the only production files mentioning DecisionEvidence are the evidence module, the preparation module, the orchestrator that invokes the stage, and the P2b pure pressure deriver (a type-only reader that nothing calls)', mentions(/DecisionEvidence|decisionEvidence/).join() === ['apps/web/lib/dayConstructorOrchestrator.ts', 'apps/web/lib/decisionEvidence.ts', 'apps/web/lib/decisionFactPreparation.ts', 'apps/web/lib/decisionPressure.ts'].join());
const firstConstructAt = orch.indexOf('constructDay({');
const preparedAt = orch.indexOf('await prepareDecisionFactsFailOpen(');
const evidenceAt = orch.indexOf('prepareDecisionEvidence(preparationIntents, preparedDecisionFacts)');
check('ORDER AT THE P1 PREPARATION BOUNDARY: duration resolution, then fact preparation, then evidence preparation, all before the first `constructDay` call', preparedAt > 0 && evidenceAt > preparedAt && firstConstructAt > evidenceAt && count(/prepareDecisionEvidence\(/g, orch) === 1);
check('NO REBUILD DURING REPLENISHMENT OR ATTACHMENT: the evidence stage is invoked exactly once in the orchestrator, outside the replenishment loop, and attachment still reuses the prepared facts only', evidenceAt > 0 && evidenceAt < firstConstructAt && !/prepareDecisionEvidence|buildDecisionEvidence|decisionEvidenceByIntentId/.test(orch.slice(firstConstructAt)));
check('the facts handed to the evidence stage are the SAME intent inputs the preparer received (`preparationIntents`), so the evidence and the preparation cannot disagree', count(/preparationIntents/g, orch) === 3 && /intents: preparationIntents,/.test(orch));

// ---- inert: nothing reads evidence ----
check('NOT PASSED TO THE CONSTRUCTOR: the orchestrator holds the evidence in one local (`decisionEvidenceByIntentId`) that is referenced exactly twice -- its declaration and (O5 P3b) ONE write-only hand-off to the diagnostics entry point, after preparation and before construction; it is never read, passed to the Constructor, spread or attached', count(/decisionEvidenceByIntentId/g, orch) === 2 && /const decisionEvidenceByIntentId = prepareDecisionEvidence\(/.test(orch) && /if \(evidenceOut\) evidenceOut\.byIntentId = decisionEvidenceByIntentId;/.test(orch));
const constructCalls = (() => { const calls: string[] = []; let idx = 0; while ((idx = orch.indexOf('constructDay({', idx)) >= 0) { let depth = 0; let i = orch.indexOf('(', idx); const start = i; for (; i < orch.length; i++) { if (orch[i] === '(') depth++; else if (orch[i] === ')') { depth--; if (depth === 0) break; } } calls.push(orch.slice(start, i + 1)); idx = i; } return calls; })();
check('every `constructDay` call (first run and replenishment re-runs) receives no evidence: its arguments contain no evidence reference', constructCalls.length >= 2 && constructCalls.every((c) => !/ecisionEvidence/i.test(c)));
const CONSUMERS = ['apps/web/lib/dayConstructor.ts', 'apps/web/lib/dayIntent.ts', 'apps/web/lib/dayCapacity.ts', 'apps/web/lib/dayConstructorAcceptance.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts', 'apps/web/lib/dayConstructorPreviewRequest.ts', 'apps/web/lib/dayConstructorPreviewIntegrity.ts', 'apps/web/lib/opportunityDecisionFacts.ts', 'apps/web/lib/opportunityProjection.ts', 'apps/web/lib/opportunityRangeAdapter.ts', 'apps/web/lib/goalDecisionFactsProvider.ts', 'apps/web/lib/remainingDayRecomposition.ts', 'apps/web/lib/remainingDayRecompositionAcceptance.ts', 'apps/web/app/api/day-constructor/preview/route.ts', 'apps/web/app/api/day-constructor/accept/route.ts'];
check('CONSTRUCTOR, COMPARATOR, PLACEMENT, CAPACITY, ACCEPTANCE, SIGNING, ROUTES, PROVIDERS and RECOMPOSITION: none of them references DecisionEvidence (the read set of evidence is empty)', CONSUMERS.every((f) => !/ecisionEvidence/i.test(stripComments(read(f)))));
check('PRECEDENCE COMPARATOR UNREAD: `compareByOverloadPrecedence` (dayConstructor.ts / dayIntent.ts) and the placement ranking take no evidence parameter and mention none', !/ecisionEvidence/i.test(stripComments(read('apps/web/lib/dayConstructor.ts'))) && !/ecisionEvidence/i.test(stripComments(read('apps/web/lib/dayIntent.ts'))));

// ---- contracts unchanged ----
const integrity = stripComments(read('apps/web/lib/dayConstructorPreviewIntegrity.ts'));
check('SIGNING CONTRACT UNCHANGED: signing is over the proposed items (user, window, item facts) and never over decision facts or evidence', /export function signPreviewResultBody/.test(integrity) && !/decisionFacts|DecisionFacts|resolvedIntents/.test(integrity));
check('ATTACHMENT CONTRACT UNCHANGED: `attachPreparedDecisionFacts` and the preparer type are untouched, and the prepared facts are still attached as the exact prepared object', /export function attachPreparedDecisionFacts/.test(prep) && /return decisionFacts \? \{ \.\.\.entry, dayIntent: \{ \.\.\.entry\.dayIntent, decisionFacts \} \} : entry;/.test(prep) && /export type DecisionFactPreparer = \(input: DecisionFactPreparationInput\) => Promise<PreparedDecisionFacts>;/.test(prep) && /resolvedIntents: attachPreparedDecisionFacts\(resolvedIntents, preparedDecisionFacts\),/.test(orch));
check('FAIL-OPEN PRESERVED: preparation failure handling is unchanged (`prepareDecisionFactsFailOpen` still catches, warns once and returns no facts) and the evidence function is itself fail-open per intent', /catch \(err\) \{\s*console\.warn\('day-constructor: decision facts preparation unavailable, continuing without', err\);\s*return NO_PREPARED_FACTS;/.test(prep) && /catch \(err\) \{\s*console\.warn\('day-constructor: decision evidence unavailable for one intent, continuing without', err\);/.test(prepareFn));
check('NO SNAPSHOT WORK: no REPEATABLE READ, shared scheduling-context transaction, snapshot timestamp or read-phase executor was introduced in the evidence or preparation modules', !/REPEATABLE READ|ISOLATION|snapshotAt|schedulingContext|beginTransaction|executor/i.test(evidence + prep));
check('the P1 preparer still performs exactly its one range load and one projection per candidate: `createDecisionFactPreparer` is unchanged in shape (no evidence in its input or output)', /export function createDecisionFactPreparer\(rangeDeps: OpportunityRangeDeps\): DecisionFactPreparer/.test(prep) && /computeOpportunityDecisionFacts\(candidates, context, rangeDeps\)/.test(prep) && !/ecisionEvidence/i.test(blockAfter(prep, 'export function createDecisionFactPreparer')));
const migrationSql = fs.readdirSync(path.join(root, 'apps/web/prisma/migrations'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => fs.readFileSync(path.join(root, 'apps/web/prisma/migrations', e.name, 'migration.sql'), 'utf8'));
check('NO SCHEMA CHANGE: the Prisma schema and every migration directory\'s own contents mention no Decision Evidence (count-independent -- holds regardless of how many unrelated migrations exist)', !/DecisionEvidence|decisionEvidence/.test(read('apps/web/prisma/schema.prisma')) && migrationSql.every((s) => !/DecisionEvidence|decisionEvidence/.test(s)));

// ---- tests of this slice ----
const unit = read('test/decisionEvidence.test.ts');
const FALSE_CLAIM = /snapshot[- ]consistent|coherent snapshot|race[- ]free|P2d (is )?(done|fixed)|policy (is )?(active|enabled)/i;
check('the unit test makes no snapshot, race-freedom or active-policy claim in any assertion label', !(unit.match(/check\(`?'?[^\n]*/g) ?? []).some((l) => FALSE_CLAIM.test(l)));
check('the unit test covers: strict-mode writes, provider/DecisionFacts/opportunity mutation, outer and every nested field, readonly types (@ts-expect-error), cross-candidate isolation, reused source, source neutrality, absence, fail-open, one build per candidate through replenishment, output and token identity, scarce LOW candidate', /strict mode/.test(unit) && /PROVIDER MUTATION/.test(unit) && /DECISIONFACTS MUTATION/.test(unit) && /OPPORTUNITY-SOURCE MUTATION/.test(unit) && /OUTER MUTATION/.test(unit) && /NESTED MUTATION: writing EVERY recurrence/.test(unit) && /NESTED MUTATION: writing EVERY opportunity/.test(unit) && /@ts-expect-error/.test(unit) && /CROSS-CANDIDATE ISOLATION/.test(unit) && /REUSED SOURCE/.test(unit) && /SOURCE NEUTRALITY/.test(unit) && /ABSENCE|absence stays absence/.test(unit) && /FAIL-OPEN/.test(unit) && /REPLENISHMENT RAN/.test(unit) && /NO OUTPUT DRIFT/.test(unit) && /TOKEN IDENTITY/.test(unit) && /SCARCE LOW CANDIDATE/.test(unit));

if (!allPassed) {
  console.error('SOME DECISION EVIDENCE ARCHITECTURE CHECKS FAILED');
  process.exit(1);
}
console.log('ALL DECISION EVIDENCE ARCHITECTURE CHECKS PASSED');
