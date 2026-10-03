/**
 * O5 P0b -- architecture proof (pure, no DB) that the new first-day /
 * after-first-day opportunity facts are facts only: computed once by the
 * single semantic authority (O1) in its one existing pass, carried
 * unchanged by O4, never read by any decision, acceptance or persistence
 * code, and free of policy vocabulary and of demand/source knowledge.
 *
 * Structural checks are partly spelling-based by nature; the behavioral
 * suites (opportunityFactQuality.test.ts and the DB test) prove the same
 * properties by execution.
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

const o1 = read('apps/web/lib/opportunityProjection.ts');
const o1Code = stripComments(o1);
const facts = read('apps/web/lib/decisionFacts.ts');
const factsCode = stripComments(facts);
const enrichment = read('apps/web/lib/opportunityDecisionFacts.ts');
const enrichmentCode = stripComments(enrichment);
const NEW_FIELDS = ['startDateState', 'afterStartEvaluatedDays', 'afterStartViableDays', 'afterStartUnknownDays'];
const NEW_FIELD_RE = /startDateState|afterStart(Evaluated|Viable|Unknown)Days/;

// ============================================================
// One semantic authority, one pass
// ============================================================
const project = functionBody(o1Code, 'projectOpportunityFacts');
check('O1 stays the only place that classifies a day: the three day-state literals appear only in O1 and the facts TYPE module', JSON.stringify(filesMatching(/KNOWN_FEASIBLE|KNOWN_INFEASIBLE/)) === JSON.stringify(['decisionFacts.ts', 'opportunityProjection.ts']));
check('O1 evaluates each date exactly once (one evaluateDay call inside the single day map) -- no second projection or second date loop for the new facts', (project.match(/evaluateDay\(/g) ?? []).length === 1 && (project.match(/dates\.map\(/g) ?? []).length === 1);
check('the totals AND the first-day/after-first-day counts come from ONE aggregation pass over the day results (no separate filter passes, no re-derivation)', (project.match(/days\.forEach\(/g) ?? []).length === 1 && !/days\.filter\(/.test(project) && /startDateState: days\[0\]\.state/.test(project));
check('the later-day evaluated count is derived from the same day list (length - 1), never from a second horizon', /afterStartEvaluatedDays: days\.length - 1/.test(project));
check('O4 reuses the one O1 projection per candidate and copies the four facts straight across (no counting, no day inspection, no second classifier)', (enrichmentCode.match(/projectOpportunityFacts\(/g) ?? []).length === 1 && NEW_FIELDS.every((f) => new RegExp(`${f}: facts\\.${f}`).test(enrichmentCode)) && !/projection\.days|\.days\b|\.forEach\(|\.filter\(/.test(enrichmentCode));
check('no second O2 load was added for the new facts (still exactly one range load, outside the candidate loop)', (enrichmentCode.match(/loadOpportunityRangeInputs\(/g) ?? []).length === 1 && enrichmentCode.indexOf('loadOpportunityRangeInputs(') < enrichmentCode.indexOf('for (const { candidate'));

// ============================================================
// The contract: additive, explicit, non-optional, generic
// ============================================================
const oppBlock = /export interface OpportunityDecisionFacts \{([\s\S]*?)\n\}/.exec(factsCode);
const oppFields = oppBlock ? Array.from(oppBlock[1].matchAll(/^\s*(\w+)(\?)?:/gm)).map((m) => `${m[1]}${m[2] ?? ''}`) : [];
check('the four new fields exist on the DecisionFacts opportunity entry, after the eight original ones, and none is optional', JSON.stringify(oppFields.slice(8)) === JSON.stringify(NEW_FIELDS) && oppFields.length === 12 && !oppFields.some((f) => f.endsWith('?')));
check('the O1 facts type carries the same four fields, required', NEW_FIELDS.every((f) => new RegExp(`^  ${f}: `, 'm').test(o1Code.slice(o1Code.indexOf('export interface OpportunityFacts'), o1Code.indexOf('export interface OpportunityDayResult')))));
check('the day-state type has exactly the three distinct states (UNKNOWN is never folded into infeasible)', /type OpportunityDayState = 'KNOWN_FEASIBLE' \| 'KNOWN_INFEASIBLE' \| 'UNKNOWN';/.test(factsCode) && /type OpportunityDayState = 'KNOWN_FEASIBLE' \| 'KNOWN_INFEASIBLE' \| 'UNKNOWN';/.test(o1Code));
check('the first-day/after-first-day contract and its exact partition are documented where the fields are defined', /evaluatedDays = 1 \+ afterStartEvaluatedDays/.test(facts) && /unknownDays {3}= \(startDateState is UNKNOWN \? 1 : 0\) \+ afterStartUnknownDays/.test(facts) && /KNOWN empty set/.test(facts));
check('the field names carry no recurrence, Goal or period vocabulary (a deadline or any other horizon can use them unchanged)', NEW_FIELDS.every((f) => !/recurr|goal|rhythm|week|period|target|remaining|planning/i.test(f)));

// ============================================================
// Facts only: no policy vocabulary, no demand, no source
// ============================================================
const POLICY = /decisionPressure|DecisionPressure|lastOpportunity|lastKnownOpportunity|LAST_KNOWN_OPPORTUNITY|scarc|urgent|critical|atRisk|mustDo|shouldDo|pressure|shortfall|deficit|classif/i;
const PROGRAM_NAME = /Opportunity Scarcity V1/g; // the program's own name in the file headers is not vocabulary
check('no policy vocabulary in the new-fact production files (O1, the facts type, the enrichment) -- comments excluded for the type module and enrichment, included for O1', !POLICY.test(o1.replace(PROGRAM_NAME, '')) && !POLICY.test(factsCode) && !POLICY.test(enrichmentCode.replace(PROGRAM_NAME, '')));
check('O1 reads no demand: no target / completed / committed / remaining counts and no recurrence vocabulary', !/targetPerPeriod|completedInPeriod|committedInPeriod|remainingInPeriod|recurrence|targetPerWeek/i.test(o1));
check('O1 and the enrichment know nothing about Goal, Rhythm, Candidate A, or manual versus automatic entry', !/goal|rhythm|candidate a\b|plan-day-goal|canonicalDemand|manual|automatic/i.test(o1) && !/goal|rhythm|candidate a\b|plan-day-goal|canonicalDemand|manual|automatic/i.test(enrichment));
check('the new facts add no database access, write, clock or randomness anywhere in O1 or the enrichment', !/pool\.|beginTransaction|INSERT|UPDATE|DELETE|fetch\(|Date\.now|new Date\(\s*\)|Math\.random|process\./.test(o1Code + enrichmentCode));

// ============================================================
// Inert: nothing decides, accepts or persists on them
// ============================================================
check('the new facts are referenced only by O1 (produces), the facts type (carries), O4 (copies) and the P2a evidence copy (copies by value, interprets nothing) in production', JSON.stringify(filesMatching(NEW_FIELD_RE)) === JSON.stringify(['decisionEvidence.ts', 'decisionFacts.ts', 'opportunityDecisionFacts.ts', 'opportunityProjection.ts']));
for (const [label, file] of Object.entries({
  'dayIntent.ts (including compareByOverloadPrecedence)': 'apps/web/lib/dayIntent.ts',
  'dayConstructor.ts (including compareCandidatesForPlacement and evaluateCandidate)': 'apps/web/lib/dayConstructor.ts',
  'dayCapacity.ts': 'apps/web/lib/dayCapacity.ts',
  'the orchestrator': 'apps/web/lib/dayConstructorOrchestrator.ts',
  'the preview handler': 'apps/web/lib/dayConstructorPreviewRequest.ts',
  'the Goal facts provider': 'apps/web/lib/goalDecisionFactsProvider.ts',
  'acceptance': 'apps/web/lib/dayConstructorAcceptance.ts',
  'acceptance persistence': 'apps/web/lib/dayConstructorAcceptancePersistence.ts',
  'preview integrity/signing': 'apps/web/lib/dayConstructorPreviewIntegrity.ts',
  'the accept route': 'apps/web/app/api/day-constructor/accept/route.ts',
  'db.ts': 'apps/web/lib/db.ts',
})) {
  check(`${label} cannot read the new facts`, !NEW_FIELD_RE.test(read(file)));
}
check('the facts are PREPARED before the Constructor (O5 P1) and attached to the preview metadata only after construction, as opaque metadata (no module that prepares or attaches them inspects a field)', /prepareDecisionFactsFailOpen\(/.test(read('apps/web/lib/dayConstructorOrchestrator.ts')) && read('apps/web/lib/dayConstructorOrchestrator.ts').indexOf('await prepareDecisionFactsFailOpen(') < read('apps/web/lib/dayConstructorOrchestrator.ts').indexOf('constructDay({') && !/await attachOpportunityFacts\(/.test(read('apps/web/lib/dayConstructorPreviewRequest.ts')) && !NEW_FIELD_RE.test(read('apps/web/lib/dayConstructorOrchestrator.ts')) && !NEW_FIELD_RE.test(read('apps/web/lib/decisionFactPreparation.ts')));
check('no schema field stores them and no component reads them', !NEW_FIELD_RE.test(read('apps/web/prisma/schema.prisma')) && !listTs(app).some((f) => /\.tsx$/.test(f) && NEW_FIELD_RE.test(fs.readFileSync(f, 'utf8'))));
check('the designated-consumer relationship is unchanged: exactly one production caller of the projection and of the range loader', JSON.stringify(filesMatching(/projectOpportunityFacts\(/, 'opportunityProjection.ts')) === JSON.stringify(['opportunityDecisionFacts.ts']) && JSON.stringify(filesMatching(/loadOpportunityRangeInputs\(/, 'opportunityRangeAdapter.ts')) === JSON.stringify(['opportunityDecisionFacts.ts']));

if (!allPassed) {
  console.error('SOME OPPORTUNITY FACT QUALITY ARCHITECTURE CHECKS FAILED');
  process.exit(1);
}
console.log('ALL OPPORTUNITY FACT QUALITY ARCHITECTURE CHECKS PASSED');
