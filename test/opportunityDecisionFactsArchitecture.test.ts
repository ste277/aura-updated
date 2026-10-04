/**
 * Opportunity Scarcity V1 -- O4: architecture proof (pure, no DB).
 *
 * Asserts that opportunity facts stay a generic, inert, server-derived
 * supply fact: the enrichment is source-neutral and reproduces no O1/O2
 * logic; the Constructor (comparators, placement, evaluation) and the
 * acceptance/persistence layers never read it; the client can never
 * supply it; durationBasis is required; and there is no shortfall,
 * classification or pressure field.
 *
 * Structural checks here are partly spelling-based by nature; they are
 * backed by the behavioral suites (opportunityDecisionFacts.test.ts and
 * the DB test), which prove inertness byte-for-byte.
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

const enrichment = read('apps/web/lib/opportunityDecisionFacts.ts');
const enrichmentCode = stripComments(enrichment);
const decisionFacts = read('apps/web/lib/decisionFacts.ts');
const decisionFactsCode = stripComments(decisionFacts);
const handler = read('apps/web/lib/dayConstructorPreviewRequest.ts');
const provider = read('apps/web/lib/goalDecisionFactsProvider.ts');
const orchestrator = read('apps/web/lib/dayConstructorOrchestrator.ts');
const preparation = read('apps/web/lib/decisionFactPreparation.ts');
const preparationCode = stripComments(preparation);
const dayConstructor = read('apps/web/lib/dayConstructor.ts');
const dayIntent = read('apps/web/lib/dayIntent.ts');
const dayCapacity = read('apps/web/lib/dayCapacity.ts');

// ============================================================
// The enrichment: generic, orchestration-only
// ============================================================
check('enrichment imports exactly the generic facts types, the O1 engine and the O2 adapter', JSON.stringify(importSpecs(enrichment)) === JSON.stringify(['./decisionFacts', './opportunityProjection', './opportunityRangeAdapter']));
check('enrichment takes only TYPES from decisionFacts (no runtime coupling)', /import type \{[^}]*\} from '\.\/decisionFacts';/.test(enrichment));
check('enrichment never imports or mentions Goal, GoalActivity, Rhythm, Candidate A, or the provider (comments included)', !/goal|rhythm|candidate a\b|decisionFactsProvider|goalDemand/i.test(enrichment));
check('enrichment never mentions a requirement count (target/completed/committed/remaining)', !/targetPerPeriod|completedInPeriod|committedInPeriod|remainingInPeriod|targetPerWeek|remainingOccurrences/.test(enrichment));
check('enrichment is not named for a source: the module and its exports carry no goal/rhythm vocabulary', !/goal|rhythm/i.test(Object.keys({ opportunityDecisionFacts: 1 }).join()) && !/export (async )?function \w*(goal|rhythm)\w*/i.test(enrichment));
check('enrichment reproduces no O1 logic (no availability/blocker subtraction, no day-state or coverage math, no contiguous fit)', !/normalizeBlockedIntervals|mergeUsableWindows|KNOWN_FEASIBLE|KNOWN_INFEASIBLE|windowFitsDuration|evaluateDay|coverage\s*=|unknownDays\s*=|viableDays\s*=|getTime\(\)/.test(enrichmentCode));
check('enrichment reproduces no O2 logic (no availability resolution, timezone conversion, DST handling, plan filtering or blocker lifecycle)', !/resolveAvailability|resolveLocalDateTime|localDateTimeToUTC|getDatePartsInTimezone|isActivePlanBlocker|listPlanned|listUserAvailability|loadPlansOverlappingRange\(|Intl\./.test(enrichmentCode));
check('enrichment does no week or date arithmetic of its own (the period end is taken as given)', !/addDaysToDateStr|getWeekday|getUTC|setUTC|Date\.|new Date|localCalendarWeek|LOCAL_CALENDAR_WEEK/.test(enrichmentCode));
check('enrichment calls the projection exactly once per candidate and the range loader exactly once per call', (enrichmentCode.match(/projectOpportunityFacts\(/g) ?? []).length === 1 && (enrichmentCode.match(/loadOpportunityRangeInputs\(/g) ?? []).length === 1 && /for \(const \{ candidate/.test(enrichmentCode));
check('the range load happens OUTSIDE the per-candidate loop (no candidate-linear loading)', enrichmentCode.indexOf('loadOpportunityRangeInputs(') < enrichmentCode.indexOf('for (const { candidate'));
check('enrichment: no clock, no randomness, no process/env, no database or network, no write verbs', !/Date\.now|new Date|Math\.random|process\.|pool\.|beginTransaction|fetch\(|INSERT|UPDATE|DELETE|\.query\(/.test(enrichmentCode));
check('enrichment is read-only: no function in it is named for a write', !/\b(create|save|persist|insert|update|delete|upsert|write)[A-Z]\w*\(/.test(enrichmentCode));
check('the horizon producer is a single replaceable function (recurrence is the first producer, not the owner)', /export function deriveOpportunityHorizon\(/.test(enrichment) && (enrichmentCode.match(/\.recurrence\b/g) ?? []).length === 1);

// ============================================================
// The fact type: factual, complete, durationBasis required
// ============================================================
const oppBlock = /export interface OpportunityDecisionFacts \{([\s\S]*?)\n\}/.exec(decisionFactsCode);
const oppFields = oppBlock ? Array.from(oppBlock[1].matchAll(/^\s*(\w+)(\?)?:/gm)).map((m) => `${m[1]}${m[2] ?? ''}`) : [];
check('OpportunityDecisionFacts has exactly the eight original factual fields (unchanged order) followed by the four additive P0b fields, none optional', JSON.stringify(oppFields) === JSON.stringify(['horizonStartDate', 'horizonEndDate', 'evaluatedDays', 'viableDays', 'unknownDays', 'coverage', 'durationMinutes', 'durationBasis', 'startDateState', 'afterStartEvaluatedDays', 'afterStartViableDays', 'afterStartUnknownDays']));
check('durationBasis is REQUIRED on the fact and carries exactly RESOLVED | GENERIC_FALLBACK', /durationBasis: OpportunityDurationBasis;/.test(decisionFactsCode) && /type OpportunityDurationBasis = 'RESOLVED' \| 'GENERIC_FALLBACK';/.test(decisionFactsCode) && !/durationBasis\?/.test(decisionFactsCode));
check('the enrichment always sets durationBasis from the candidate and never defaults it to RESOLVED', /durationBasis: candidate\.durationBasis/.test(enrichmentCode) && !/'RESOLVED'/.test(enrichmentCode));
check('durationBasis is derived from the SAME resolution that produced the duration: the orchestrator reads the resolution\'s own generic-fallback warning, and the preparation maps it to GENERIC_FALLBACK / RESOLVED (O5 P1: the derivation moved before the Constructor)', /resolved\.warnings\.some\(\(w\) => w\.code === 'DURATION_FROM_GENERIC_FALLBACK'\)/.test(orchestrator) && /durationFromGenericFallback \? 'GENERIC_FALLBACK' : 'RESOLVED'/.test(preparationCode));
check('demand/supply separation: the opportunity fact repeats no requirement field', !/targetPerPeriod|completedInPeriod|committedInPeriod|remainingInPeriod/.test(oppBlock ? oppBlock[1] : 'x'));
check('no shortfall, deficit, pressure, classification, scarcity, risk or last-chance field anywhere in the facts, the enrichment or the preparation glue', !/shortfall|deficit|pressure|classif|scarc|atRisk|critical|impossible|lastChance|lastViable|urgen|priority|score|\brank|weight|boost|penalt/i.test(decisionFactsCode + enrichmentCode + preparationCode));
check('DecisionFacts carries opportunity as one optional entry beside recurrence', /recurrence\?: RecurrenceDecisionFacts;\s*opportunity\?: OpportunityDecisionFacts;/.test(decisionFactsCode));
check('decisionFacts.ts is still source-blind: no imports, no source/goal/rhythm vocabulary, no calculation', !/^\s*import\s/m.test(decisionFactsCode) && !/goal|rhythm|decode|classify|split\(/i.test(decisionFacts) && !/Math\.|new Date|Date\./.test(decisionFactsCode));
check('the candidate-local overlap limitation is documented beside the contract', /CANDIDATE-LOCAL/.test(decisionFacts) && /allocation of shared capacity/.test(decisionFacts));
check('terminology: no unqualified "current period" wording remains in decisionFacts.ts (the period contains the planning date)', !/current period|the current/i.test(decisionFacts) && /containing the preview's planning date|containing the planning date/.test(decisionFacts));

// ============================================================
// Inertness: no Constructor policy, no acceptance, no persistence
// ============================================================
const POLICY_WORDS = /opportunity|viableDays|unknownDays|coverage|durationBasis/i;
check('compareByOverloadPrecedence never reads opportunity facts', !POLICY_WORDS.test(functionBody(dayIntent, 'compareByOverloadPrecedence')));
check('compareCandidatesForPlacement never reads opportunity facts', !POLICY_WORDS.test(functionBody(dayConstructor, 'compareCandidatesForPlacement')));
check('evaluateCandidate never reads opportunity facts', !POLICY_WORDS.test(functionBody(dayConstructor, 'evaluateCandidate')));
check('dayConstructor.ts, dayCapacity.ts and the orchestrator never mention opportunity facts at all', !POLICY_WORDS.test(dayConstructor) && !POLICY_WORDS.test(dayCapacity) && !/opportunity|viableDays|unknownDays|durationBasis/i.test(orchestrator));
check('dayIntent.ts only carries the generic decisionFacts field (no opportunity vocabulary)', !/opportunity|viableDays|unknownDays|durationBasis/i.test(dayIntent));
for (const [label, file] of Object.entries({
  'acceptance (dayConstructorAcceptance.ts)': 'apps/web/lib/dayConstructorAcceptance.ts',
  'acceptance persistence (dayConstructorAcceptancePersistence.ts)': 'apps/web/lib/dayConstructorAcceptancePersistence.ts',
  'preview integrity/signing (dayConstructorPreviewIntegrity.ts)': 'apps/web/lib/dayConstructorPreviewIntegrity.ts',
  'accept route': 'apps/web/app/api/day-constructor/accept/route.ts',
  'goal-demand provenance authorization': 'apps/web/lib/goalDemandProvenanceAuthorization.ts',
  'acceptance body builder (acceptConstructedDay.ts)': 'apps/web/lib/acceptConstructedDay.ts',
})) {
  check(`${label} never trusts, requires or persists opportunity facts`, !/OpportunityDecisionFacts|\.opportunity\b|opportunity:|viableDays|unknownDays|durationBasis|decisionFacts/i.test(read(file)));
}
check('nothing in db.ts persists opportunity facts (no opportunity columns or fields)', !/OpportunityDecisionFacts|viableDays|unknownDays|durationBasis/.test(read('apps/web/lib/db.ts')));
check('no schema field stores opportunity facts', !/viableDays|unknownDays|durationBasis|opportunity/i.test(read('apps/web/prisma/schema.prisma')));

// ============================================================
// Authority: server-derived only
// ============================================================
check('the request parser never reads opportunity, supply or period values from the body', !/opportunity|viableDays|unknownDays|coverage|durationBasis|periodStartDate|periodEndDate/i.test(functionBody(handler, 'parseConstructDayPreviewRequestBody')));
const attachFn = functionBody(preparation, 'attachPreparedDecisionFacts');
check('attachment uses only the resolved intents and the prepared facts, matched by the server-owned requestedIntentId (never the raw body, never a title)', !/\bbody\b|\btitle\b/.test(attachFn) && /prepared\.get\(entry\.requestedIntentId\)/.test(attachFn));
// O5 P1 -- the preparation moved BEFORE the Constructor. It is still never CONSUMED by it.
const orchestrateCode = stripComments(orchestrator);
const prepareAt = orchestrateCode.indexOf('await prepareDecisionFactsFailOpen(');
const firstConstructAt = orchestrateCode.indexOf('constructDay({');
check('O5 P1: facts are PREPARED strictly BEFORE the first constructDay call and after the intents were resolved (prepared is not consumed)', prepareAt > 0 && firstConstructAt > prepareAt && prepareAt > orchestrateCode.indexOf('resolveRequestedDayIntent(requested'));
check('the Constructor input is built from the intents AS RESOLVED (provider facts only): the prepared facts never enter intentsForConstructDay (they are referenced three times: prepared, read by the P2a evidence stage, attached to the metadata)', /const intentsForConstructDay = resolvedIntents\.map\(\(r\) => r\.dayIntent\);/.test(orchestrateCode) && (orchestrateCode.match(/preparedDecisionFacts/g) ?? []).length === 3);
check('the prepared facts are attached once, after construction, from the same object (no second computation in the orchestrator or the handler)', /resolvedIntents: attachPreparedDecisionFacts\(resolvedIntents, preparedDecisionFacts\)/.test(orchestrateCode) && (orchestrateCode.match(/prepareDecisionFactsFailOpen\(/g) ?? []).length === 1 && !/computeOpportunityDecisionFacts|attachOpportunityFacts/.test(stripComments(handler)));
check('the orchestration request is given only provider facts, never opportunity facts; the preview boundary only supplies the generic preparer', /orchestrateConstructDay\(decisionFactsByIntentId \? \{ \.\.\.parsed\.request, decisionFactsByIntentId \} : parsed\.request, orchestrationDeps\)/.test(handler) && /prepareDecisionFacts: createDecisionFactPreparer\(opportunityRangeDeps\)/.test(handler));
check('preparation failure is isolated (try/catch, continue without facts) so construction never depends on it', /try \{[\s\S]*return await preparer\(input\);[\s\S]*\} catch \(err\) \{[\s\S]*continuing without/.test(preparationCode));
check('the range deps are bound to the AUTHENTICATED user in the boundary (not from the request)', /createOpportunityRangeDeps \? deps\.createOpportunityRangeDeps\(user\)/.test(handler));
check('the Goal provider produces no opportunity facts and never imports the enrichment, O1 or O2', !/opportunity/i.test(provider) && !/opportunityDecisionFacts|opportunityProjection|opportunityRange/.test(provider));
check('the preview handler stays source-blind (no goal/rhythm vocabulary after O4)', !/goal|rhythm/i.test(handler));

// ============================================================
// Activation boundary: exactly one consumer per layer
// ============================================================
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
const consumersOf = (needle: RegExp, ...excluding: string[]) => all.filter((f) => !excluding.some((x) => f.endsWith(x)) && needle.test(fs.readFileSync(f, 'utf8'))).map((f) => path.basename(f)).sort();
check('the enrichment is invoked only by the generic fact-preparation module (O5 P1: it moved from the preview handler)', JSON.stringify(consumersOf(/from '[^']*opportunityDecisionFacts'/, 'opportunityDecisionFacts.ts')) === JSON.stringify(['decisionFactPreparation.ts']));
// O5 P2d: the preview route now supplies the coherent snapshot instead; the live range deps are wired by no production file.
check('no component, page or route wires the LIVE range loaders to a user any more (the preview route binds the coherent scheduling snapshot instead)', JSON.stringify(consumersOf(/createRealOpportunityRangeDeps/, 'opportunityRangeRealDeps.ts')) === JSON.stringify([]));
check('opportunity facts are never read by any component/page (no new user-facing surface)', !listTs(app).some((f) => /\.tsx$/.test(f) && /viableDays|unknownDays|durationBasis|OpportunityDecisionFacts/.test(fs.readFileSync(f, 'utf8'))));
check('the only readers of viableDays/unknownDays outside the engine are the types module, the enrichment, the P2a evidence copy (copies by value, interprets nothing) and the unwired P2b pressure deriver (reads immutable evidence only)', JSON.stringify(consumersOf(/viableDays|unknownDays/, 'opportunityProjection.ts')) === JSON.stringify(['decisionEvidence.ts', 'decisionFacts.ts', 'decisionPressure.ts', 'opportunityDecisionFacts.ts']));

if (!allPassed) {
  console.error('SOME OPPORTUNITY DECISION FACTS ARCHITECTURE CHECKS FAILED');
  process.exit(1);
}
console.log('ALL OPPORTUNITY DECISION FACTS ARCHITECTURE CHECKS PASSED');
