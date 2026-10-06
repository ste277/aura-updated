/**
 * Constructor Decision Intelligence -- O5 P1: architecture guard for the
 * pre-Constructor decision fact preparation (pure, no DB).
 *
 * P1 changes fact AVAILABILITY, not decision behavior:
 *
 *   PREPARED before the Constructor  !=  CONSUMED by the Constructor.
 *
 * This guard pins that:
 *   - there is ONE preparation path, run before the first `constructDay`
 *     and after the intents' durations were resolved, never recomputed
 *     after construction
 *   - the prepared facts stay OUTSIDE the Constructor input and are
 *     attached to the preview metadata, by server-owned id, afterwards
 *   - nothing in the decision modules (comparators, evaluateCandidate,
 *     dayConstructor, dayCapacity) and nothing in the orchestrator reads or
 *     interprets a fact
 *   - the preparation module is generic: no Goal/manual/automatic/Rhythm
 *     vocabulary, no policy, score or pressure concept, and it reproduces
 *     no O1/O2/O3 logic
 *   - O1 and O2 keep sole ownership of projection and range loading
 *
 * Structural checks are partly spelling-based by nature; they are backed by
 * decisionFactPreparation.test.ts / decisionFactPreparationDb.test.ts (which
 * prove inertness and single computation behaviorally) and by the P0c
 * fixture (which pins the decision behavior itself).
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
const importSpecs = (src: string) => Array.from(stripComments(src).matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/g)).map((m) => m[1]);
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`missing function ${name}`);
  const braceStart = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated ${name}`);
}
const count = (re: RegExp, s: string) => (s.match(re) ?? []).length;

const preparationSrc = read('apps/web/lib/decisionFactPreparation.ts');
const preparation = stripComments(preparationSrc);
const orchestrator = stripComments(read('apps/web/lib/dayConstructorOrchestrator.ts'));
const handler = stripComments(read('apps/web/lib/dayConstructorPreviewRequest.ts'));
const dayIntent = stripComments(read('apps/web/lib/dayIntent.ts'));
const dayConstructor = stripComments(read('apps/web/lib/dayConstructor.ts'));
const dayCapacity = stripComments(read('apps/web/lib/dayCapacity.ts'));
const enrichment = stripComments(read('apps/web/lib/opportunityDecisionFacts.ts'));

const lib = path.join(root, 'apps/web/lib');
const app = path.join(root, 'apps/web/app');
function listTs(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name.startsWith('.') ? [] : listTs(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}
const all = [...listTs(lib), ...listTs(app)];
const filesMatching = (needle: RegExp, ...excluding: string[]) => all.filter((f) => !excluding.some((x) => f.endsWith(x)) && needle.test(stripComments(fs.readFileSync(f, 'utf8')))).map((f) => path.basename(f)).sort();

// ============================================================
// One preparation path, before the Constructor, never recomputed after
// ============================================================
check('the orchestrator calls the preparation exactly ONCE', count(/prepareDecisionFactsFailOpen\(/g, orchestrator) === 1);
const prepareAt = orchestrator.indexOf('await prepareDecisionFactsFailOpen(');
const firstConstructAt = orchestrator.indexOf('constructDay({');
const lastConstructAt = orchestrator.lastIndexOf('constructDay({');
const resolveLoopAt = orchestrator.indexOf('resolveRequestedDayIntent(requested');
const searchMetaAt = orchestrator.indexOf('flexibleSearchMetaByIntentId[dayIntent.id] =');
check('preparation runs AFTER every intent was resolved (duration included) and BEFORE the first constructDay call', prepareAt > 0 && prepareAt > resolveLoopAt && prepareAt > searchMetaAt && prepareAt < firstConstructAt);
check('nothing prepares, computes or projects facts after the last constructDay call (no post-Constructor recomputation)', !/prepareDecisionFactsFailOpen|createDecisionFactPreparer|computeOpportunityDecisionFacts|projectOpportunityFacts|loadOpportunityRangeInputs/.test(orchestrator.slice(lastConstructAt)));
check('the preview handler no longer computes opportunity facts after construction: no attachOpportunityFacts, no enrichment/O1/O2 call', !/attachOpportunityFacts|computeOpportunityDecisionFacts|projectOpportunityFacts|loadOpportunityRangeInputs|opportunityDecisionFacts/.test(handler));
// O5 P2d: the preview boundary has two wiring sites -- the snapshot-backed one (the production route) and the legacy live-deps one (only when no scheduling binding is supplied).
check('the preview boundary only SUPPLIES the generic preparer to the orchestration (two wiring sites: the coherent snapshot-backed deps, and the legacy live deps used only when no scheduling binding is supplied)', count(/createDecisionFactPreparer\(/g, handler) === 2 && /prepareDecisionFacts: createDecisionFactPreparer\(schedulingContextOpportunityRangeDeps\(coherent\)\)/.test(handler) && /prepareDecisionFacts: createDecisionFactPreparer\(opportunityRangeDeps\)/.test(handler));
check('the enrichment is invoked only by the preparation module; the O1 projection and O2 range loader only by the enrichment (ownership unchanged)', JSON.stringify(filesMatching(/computeOpportunityDecisionFacts\(/, 'opportunityDecisionFacts.ts')) === JSON.stringify(['decisionFactPreparation.ts']) && JSON.stringify(filesMatching(/projectOpportunityFacts\(/, 'opportunityProjection.ts')) === JSON.stringify(['opportunityDecisionFacts.ts']) && JSON.stringify(filesMatching(/loadOpportunityRangeInputs\(/, 'opportunityRangeAdapter.ts')) === JSON.stringify(['opportunityDecisionFacts.ts']));
check('the preparation module calls the enrichment exactly once and never the projection or range loader itself', count(/computeOpportunityDecisionFacts\(/g, preparation) === 1 && !/projectOpportunityFacts|loadOpportunityRangeInputs/.test(preparation));
check('the enrichment still projects once per candidate and loads the range once per call (cost shape unchanged)', count(/projectOpportunityFacts\(/g, enrichment) === 1 && count(/loadOpportunityRangeInputs\(/g, enrichment) === 1 && enrichment.indexOf('loadOpportunityRangeInputs(') < enrichment.indexOf('for (const { candidate'));
// O5 P2d: production no longer binds the live range deps; the route supplies the snapshot-backed ones through the scheduling binding (decisionSchedulingContextArchitecture.test.ts owns that rule).
check('production wiring no longer supplies the LIVE range deps (the route supplies the coherent snapshot through the preview boundary instead)', JSON.stringify(filesMatching(/createRealOpportunityRangeDeps/, 'opportunityRangeRealDeps.ts')) === JSON.stringify([]));

// ============================================================
// Prepared facts stay OUTSIDE the Constructor input
// ============================================================
check('the Constructor intents are built from the intents AS RESOLVED (provider facts only), never from the prepared facts', /const intentsForConstructDay = resolvedIntents\.map\(\(r\) => r\.dayIntent\);/.test(orchestrator));
check('the prepared set is referenced exactly three times in the orchestrator: where it is prepared, where the P2a evidence stage reads it (to build immutable evidence from the facts as prepared, never to feed the Constructor), and where it is attached to the preview metadata', count(/preparedDecisionFacts/g, orchestrator) === 3 && /prepareDecisionEvidence\(preparationIntents, preparedDecisionFacts\)/.test(orchestrator) && /resolvedIntents: attachPreparedDecisionFacts\(resolvedIntents, preparedDecisionFacts\),/.test(orchestrator));
const constructCalls = Array.from(orchestrator.matchAll(/constructDay\(\{([\s\S]*?)\}\);/g)).map((m) => m[1]);
check('both constructDay calls receive exactly the existing keys (intents, window, blockedIntervals, candidatesByIntentId, fixedConstraintsByIntentId, today) -- no facts, no prepared set', constructCalls.length === 2 && constructCalls.every((c) => JSON.stringify(Array.from(c.matchAll(/^\s*(\w+)/gm)).map((m) => m[1])) === JSON.stringify(['intents', 'window', 'blockedIntervals', 'candidatesByIntentId', 'fixedConstraintsByIntentId', 'today'])));
check('the orchestrator hands the preparation only generic values (id, resolved duration, fallback flag, provider facts) and the server request context -- the same `preparationIntents` the P2a evidence stage reads', /const preparationIntents = resolvedIntents\.map\(\(resolved\) => \(\{\s*intentId: resolved\.requestedIntentId,\s*durationMinutes: resolved\.dayIntent\.estimatedDurationMinutes,\s*durationFromGenericFallback: fallbackDurationIntentIds\.has\(resolved\.requestedIntentId\),\s*facts: resolved\.dayIntent\.decisionFacts,\s*\}\)\);/.test(orchestrator) && /intents: preparationIntents,\s*context: \{ planningDate: request\.targetDate, timezone: request\.timezone, now: request\.now \}/.test(orchestrator));
check('the fallback flag comes from the SAME resolution that produced the duration (no second duration resolution)', /resolved\.warnings\.some\(\(w\) => w\.code === 'DURATION_FROM_GENERIC_FALLBACK'\)/.test(orchestrator) && count(/resolveRequestedDayIntent\(/g, orchestrator) === 3 && count(/resolveDuration\(/g, orchestrator) === 2);

// ============================================================
// No policy consumer: nothing in the decision modules or the orchestrator reads a fact
// ============================================================
const FACT_VOCAB = /decisionFacts|\.opportunity\b|opportunity:|startDateState|afterStart|viableDays|unknownDays|evaluatedDays|coverage\b|durationBasis|\.recurrence\b|remainingInPeriod|targetPerPeriod|periodStartDate|periodEndDate/;
check('compareByOverloadPrecedence reads no fact', !FACT_VOCAB.test(functionBody(dayIntent, 'compareByOverloadPrecedence')));
check('sortByOverloadPrecedence reads no fact', !FACT_VOCAB.test(functionBody(dayIntent, 'sortByOverloadPrecedence')));
check('compareCandidatesForPlacement reads no fact', !FACT_VOCAB.test(functionBody(dayConstructor, 'compareCandidatesForPlacement')));
check('evaluateCandidate reads no fact', !FACT_VOCAB.test(functionBody(dayConstructor, 'evaluateCandidate')));
check('dayConstructor.ts and dayCapacity.ts never mention decision facts at all', !FACT_VOCAB.test(dayConstructor) && !FACT_VOCAB.test(dayCapacity));
check('dayIntent.ts carries the generic decisionFacts field only: nothing else in it reads facts', count(/decisionFacts/g, dayIntent) === 2 && !/\.opportunity\b|startDateState|viableDays|unknownDays|durationBasis/.test(dayIntent));
check('no decision module imports the preparation module', ![dayIntent, dayConstructor, dayCapacity].some((s) => /decisionFactPreparation|opportunityDecisionFacts/.test(s)));
const orchestratorFactReads = orchestrator.match(/\bdecisionFacts\b[^\n]*/g) ?? [];
check('the orchestrator never interprets a fact: it only forwards them (no property read of a fact, no condition on one)', !/\.opportunity\b|\.recurrence\b|startDateState|afterStart|viableDays|unknownDays|evaluatedDays|coverage\b|durationBasis|remainingInPeriod|periodStartDate/.test(orchestrator) && !/if\s*\([^)]*decisionFacts|\?\s*[^:\n]*decisionFacts[^:\n]*:/.test(orchestrator.replace(/const dayIntent: DayIntent = decisionFacts \? \{ \.\.\.resolved\.dayIntent, decisionFacts \} : resolved\.dayIntent;/, '')) && orchestratorFactReads.length > 0);
check('acceptance, persistence and signing never see the preparation or the prepared facts (no new client authority)', ['dayConstructorAcceptance.ts', 'dayConstructorAcceptancePersistence.ts', 'dayConstructorPreviewIntegrity.ts', 'acceptConstructedDay.ts', 'goalDemandProvenanceAuthorization.ts'].every((f) => !/decisionFactPreparation|prepareDecisionFacts|preparedDecisionFacts|PreparedDecisionFacts/.test(read(`apps/web/lib/${f}`))) && !/decisionFactPreparation|prepareDecisionFacts/.test(read('apps/web/app/api/day-constructor/accept/route.ts')));
check('no schema field or db.ts function stores prepared facts', !/prepareDecisionFacts|preparedDecisionFacts/.test(read('apps/web/lib/db.ts')) && !/viableDays|unknownDays|durationBasis|opportunity/i.test(read('apps/web/prisma/schema.prisma')));

// ============================================================
// The preparation module: generic, inert, no policy
// ============================================================
check('the preparation module imports exactly the generic facts types, the P2a evidence builder (a pure, DB-free generic module), the enrichment and the O2 deps type -- no decision module, no Goal/Rhythm/provider module, no policy module', JSON.stringify(importSpecs(preparationSrc)) === JSON.stringify(['./decisionFacts', './decisionEvidence', './opportunityDecisionFacts', './opportunityRangeAdapter']) && /import type \{[^}]*\} from '\.\/decisionFacts';/.test(preparationSrc) && /import type \{[^}]*\} from '\.\/opportunityRangeAdapter';/.test(preparationSrc));
check('SOURCE NEUTRALITY: the preparation module (comments included) never mentions Goal, GoalActivity, Rhythm, manual, automatic, Candidate A, the provider, canonical demand or a source tag', !/goal|rhythm|\bmanual\b|\bautomatic\b|candidate a\b|canonical|plan-day|decisionFactsProvider|goalDemand/i.test(preparationSrc));
check('the orchestrator and the preview boundary gained no source branch (no Goal/manual/automatic vocabulary introduced by P1 in the orchestrator)', !/plan-day-goal|goal-demand|canonicalDemand|\bisGoal\b|classifyGoalDemandIntentId/.test(orchestrator) && !/plan-day-goal|goal-demand|canonicalDemand|\bisGoal\b/.test(handler));
check('NO SCORE, PRESSURE, SCARCITY, POLICY or REASON concept in the preparation module (code and comments)', !/decisionPressure|DecisionPressure|LAST_KNOWN_OPPORTUNITY|lastOpportunity|scarc\w*|shortfall|deficit|atRisk|\bpressure\b|\bscore\b|priorityScore|urgenc\w*|DecisionPolicy|PressurePolicy|rankingPolicy|policyReason|mustDo|shouldDo/i.test(preparationSrc.replace(/not\s+a\s+policy/gi, '')));
check('the preparation module defines no ranking, comparison or classification: no sort, no comparator, no threshold', !/\.sort\(|compare\w*\(|Math\.(min|max)|[<>]=?\s*\d/.test(preparation));
check('the preparation module reproduces no O1/O2/O3 logic (no day-state, coverage, contiguity, availability, timezone, DST, blocker or week arithmetic)', !/KNOWN_FEASIBLE|KNOWN_INFEASIBLE|windowFitsDuration|evaluateDay|coverage\s*=|viableDays\s*=|unknownDays\s*=|resolveAvailability|localDateTimeToUTC|getDatePartsInTimezone|isActivePlanBlocker|localCalendarWeek|addDaysToDateStr|getUTC|setUTC|Intl\.|new Date|Date\./.test(preparation));
check('the preparation module is pure and read-only: no clock, no randomness, no environment, no database or network, no write verb, no background work', !/Date\.now|Math\.random|process\.|pool\.|beginTransaction|fetch\(|INSERT|UPDATE|DELETE|\.query\(|setTimeout|setInterval|setImmediate|queueMicrotask|\bvoid\s+\w+\(/.test(preparation) && !/\b(create|save|persist|insert|update|delete|upsert|write)[A-Z]\w*\(/.test(preparation.replace(/createDecisionFactPreparer/g, '')));
check('prepared facts are an immutable snapshot (frozen) and attachment never mutates its input (spreads into new objects)', count(/Object\.freeze\(/g, preparation) === 2 && /\{ \.\.\.entry, dayIntent: \{ \.\.\.entry\.dayIntent, decisionFacts \} \}/.test(preparation));
check('attachment matches by the server-owned requestedIntentId only (never a title) and preserves order (a single map over the resolved intents)', /prepared\.get\(entry\.requestedIntentId\)/.test(functionBody(preparation, 'attachPreparedDecisionFacts')) && !/title/.test(functionBody(preparation, 'attachPreparedDecisionFacts')) && /resolved\.map\(/.test(functionBody(preparation, 'attachPreparedDecisionFacts')));
check('FAIL-OPEN: preparation failure is isolated by try/catch and resolves to an EMPTY set (construction never depends on it); the orchestrator adds no throwing path around it', /try \{\s*return await preparer\(input\);\s*\} catch \(err\) \{[\s\S]*return NO_PREPARED_FACTS;/.test(preparation) && !/try \{[^}]*prepareDecisionFactsFailOpen/.test(orchestrator));
check('an omitted preparer is byte-identical to this stage never existing (the dependency is optional)', /prepareDecisionFacts\?: DecisionFactPreparer;/.test(read('apps/web/lib/dayConstructorOrchestrator.ts')) && /if \(!preparer\) return NO_PREPARED_FACTS;/.test(preparation));
check('the generic DecisionFacts contract is unchanged by P1: still recurrence + opportunity only', /recurrence\?: RecurrenceDecisionFacts;\s*opportunity\?: OpportunityDecisionFacts;/.test(stripComments(read('apps/web/lib/decisionFacts.ts'))));
check('the Opportunity Facts contract is still exactly the 12 P0b fields', (() => {
  const block = /export interface OpportunityDecisionFacts \{([\s\S]*?)\n\}/.exec(stripComments(read('apps/web/lib/decisionFacts.ts')));
  const fields = block ? Array.from(block[1].matchAll(/^\s*(\w+)(\?)?:/gm)).map((m) => `${m[1]}${m[2] ?? ''}`) : [];
  return JSON.stringify(fields) === JSON.stringify(['horizonStartDate', 'horizonEndDate', 'evaluatedDays', 'viableDays', 'unknownDays', 'coverage', 'durationMinutes', 'durationBasis', 'startDateState', 'afterStartEvaluatedDays', 'afterStartViableDays', 'afterStartUnknownDays']);
})());

// ============================================================
// P1 introduces no new decision machinery
// ============================================================
const POLICY_TYPES = /\bDecisionPressure\b|\bDecisionPolicy\b|\bPressurePolicy\b|LAST_KNOWN_OPPORTUNITY|\bScarcityClass|\bdecisionScore\b|\bpolicyReason\b/;
check('no DecisionPressure, DecisionPolicy, scarcity classification, score or policy-reason type exists anywhere in production code EXCEPT the P2b pure deriver module (decisionPressure.ts) and, since O5 P3b, the two inert shadow modules and, since O5 P4a, the two inert promotion-input modules that CONSUME its derived value (shadowPressureEvaluation.ts, shadowPressureObservation.ts, promotionInput.ts, promotionInputPreparation.ts) -- each unwired from the Constructor and pinned by its own architecture guard', !all.some((f) => !/(decisionPressure|shadowPressureEvaluation|shadowPressureObservation|promotionInput|promotionInputPreparation|activeSelector)\.ts$/.test(f) && POLICY_TYPES.test(stripComments(fs.readFileSync(f, 'utf8')))));
check('constructDay is still reached only through the orchestrator and there are still exactly two construction call sites plus the bounded replenishment loop (no optimizer, no backtracking)', JSON.stringify(filesMatching(/\bconstructDay\(/)) === JSON.stringify(['dayConstructor.ts', 'dayConstructorOrchestrator.ts']) && count(/constructDay\(\{/g, orchestrator) === 2 && /for \(let round = 0; round < flexibleIntentCount; round \+= 1\)/.test(orchestrator));
check('no test-only production hook was introduced (no env flag, no force/override in the preparation or orchestration)', !/process\.env|NODE_ENV|forceOverload|__test|FIXTURE/.test(preparation) && !/process\.env|NODE_ENV|forceOverload|__test|FIXTURE/.test(orchestrator));

// ============================================================
// The behavior suites that prove this guard's claims exist
// ============================================================
const behavior = read('test/decisionFactPreparation.test.ts');
const db = read('test/decisionFactPreparationDb.test.ts');
check('the behavior suite proves preparation order, non-consumption, single projection/load, attachment identity, duplicate titles, different durations, failure isolation, UNKNOWN, DST and fallback', ['PREPARATION ORDER', 'NO CONSUMPTION', 'ONE O1 projection per fact-bearing candidate', 'ATTACHMENT', 'DUPLICATE TITLES', 'SAME ACTIVITY, DIFFERENT DURATION', 'FAILURE BEFORE THE CONSTRUCTOR', 'UNKNOWN stays UNKNOWN', 'DST:', 'GENERIC_FALLBACK:'].every((m) => behavior.includes(m)));
check('the DB suite proves the real order (range loads before the replenishment re-search), byte identity with and without preparation, an independent recomputation, zero writes and 0/1/3/10 query counts', ['THEN the two range loads', 'byte-identical with and without preparation', 'independent recomputation', 'previews wrote nothing', '0 / 1 / 3 / 10 fact-bearing candidates'].every((m) => db.includes(m)));

if (!allPassed) {
  console.error('SOME DECISION FACT PREPARATION ARCHITECTURE CHECKS FAILED');
  process.exit(1);
}
console.log('ALL DECISION FACT PREPARATION ARCHITECTURE CHECKS PASSED');
