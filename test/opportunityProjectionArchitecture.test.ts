/**
 * Opportunity Scarcity V1 -- O1 architecture guard. Protects the
 * boundary of apps/web/lib/opportunityProjection.ts by asserting
 * forbidden imports/modules/behaviors, not identifier spelling alone:
 * the engine stays pure, source-blind, policy-free and un-integrated.
 */
import fs from 'fs';
import path from 'path';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const root = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const MODULE = 'apps/web/lib/opportunityProjection.ts';
const src = read(MODULE);
const code = stripComments(src);

// ---- imports: only pure generic date/interval/type helpers -------------
const importPaths = Array.from(src.matchAll(/^import[^;]*?from\s+'([^']+)';/gms)).map((m) => m[1]).sort();
const ALLOWED = ['../../../packages/panchang/src/localDate', './availabilityContext', './dayCapacity', './dayIntent', './timezone'];
check(`imports are exactly the allowed pure helpers (${ALLOWED.length}; availabilityContext only for the shared canonical window merge)`, JSON.stringify(importPaths) === JSON.stringify(ALLOWED));
const FORBIDDEN_IMPORT = /\.\/(db|goals|goalActivityRhythm|goalDemand\w*|goalDecision\w*|dayConstructor|dayConstructor\w+|decisionFacts|planDay\w*|session|auth|natalContext|myDayOrchestrator)'/;
check('no import of db, Goal, Rhythm, Candidate A, the provider, the Constructor/orchestrator, acceptance/persistence, or DecisionFacts', !FORBIDDEN_IMPORT.test(src));
check('no database/network/framework modules are imported (pg, next, react, fetch)', !/from '(pg|next|react)[^']*'|fetch\(/.test(code));

// ---- purity -----------------------------------------------------------
check('no clock: no Date.now(), no new Date() without an explicit argument, no performance.now', !/Date\.now\(|new Date\(\s*\)|performance\.now/.test(code));
check('no randomness', !/Math\.random|crypto/.test(code));
check('no async/await/Promise (synchronous)', !/\basync\b|\bawait\b|Promise/.test(code));
check('no environment or process access', !/process\.|require\(/.test(code));
check('no database access or writes', !/pool\.|beginTransaction|INSERT|UPDATE|DELETE|query\(/.test(code));
check('no mutation of input collections (no .sort on a supplied array, no push into inputs)', !/blockers\.sort|windows\.sort|availabilityByDate\.set|availabilityByDate\.delete|blockers\.push/.test(code));

// ---- source neutrality / policy-free vocabulary (comments included) ----
const FORBIDDEN_WORDS = /goal|rhythm|template|goal-demand|candidate a\b|priority|urgen|pressure|score|rank|recommend|shortfall|impossible|behind|atRisk|lastChance|muhurta|timingFit|requiredCount|remainingInPeriod|targetPerPeriod|constructDay|orchestrate|compareBy|evaluateCandidate/i;
check('the engine mentions no source, requirement, scoring, urgency, shortfall, timing-quality, or Constructor vocabulary anywhere', !FORBIDDEN_WORDS.test(src));
const stringLiterals = Array.from(code.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"/g)).map((m) => m[1] ?? m[2] ?? '');
check('the engine contains no user-facing copy (no string literal contains whitespace)', stringLiterals.length > 0 && stringLiterals.every((l) => !/\s/.test(l)));

// ---- output contract: facts only ------------------------------------
const factsBlock = src.slice(src.indexOf('export interface OpportunityFacts'), src.indexOf('export interface OpportunityDayResult'));
const fields = Array.from(factsBlock.matchAll(/^\s{2}(\w+):/gm)).map((m) => m[1]).sort();
check('OpportunityFacts has exactly the six original factual fields plus the four additive first-day/after-first-day fields (P0b)', JSON.stringify(fields) === JSON.stringify(['afterStartEvaluatedDays', 'afterStartUnknownDays', 'afterStartViableDays', 'coverage', 'evaluatedDays', 'horizonEndDate', 'horizonStartDate', 'startDateState', 'unknownDays', 'viableDays']));
const inputBlock = src.slice(src.indexOf('export interface OpportunityProjectionInput'), src.indexOf('export type OpportunityCoverage'));
const inputFields = Array.from(inputBlock.matchAll(/^\s{2}(\w+):/gm)).map((m) => m[1]).sort();
check('the input carries no requirement count and no candidate/source identity', JSON.stringify(inputFields) === JSON.stringify(['availabilityByDate', 'blockers', 'durationMinutes', 'horizonEndDate', 'now', 'planningDate', 'timezone']));
check('the three day states are structurally distinct literals', /'KNOWN_FEASIBLE' \| 'KNOWN_INFEASIBLE' \| 'UNKNOWN'/.test(src) && /kind: 'UNKNOWN'/.test(src) && /kind: 'KNOWN'/.test(src));

// ---- corrected contract: timezone dialect and elapsed-day rule ----------
const timezoneImport = /import \{([^}]*)\} from '\.\/timezone';/.exec(src);
const timezoneNames = timezoneImport ? timezoneImport[1].split(',').map((n) => n.trim()).filter(Boolean).sort() : [];
check('only the pure date helpers are imported from ./timezone (never the form-input validator isValidIanaTimezone)', JSON.stringify(timezoneNames) === JSON.stringify(['addDaysToDateStr', 'getDatePartsInTimezone']));
check('timezone validity is decided by Intl resolution (the canonical helpers\' own contract), not a private stricter dialect', /new Intl\.DateTimeFormat\(/.test(code) && !/includes\('\/'\)|isValidIanaTimezone/.test(code));
const evaluateDayBody = code.slice(code.indexOf('function evaluateDay('), code.indexOf('export function projectOpportunityFacts'));
const elapsedAt = evaluateDayBody.indexOf('date < todayLocal');
const unknownAt = evaluateDayBody.indexOf("availability.kind === 'UNKNOWN'");
const windowsAt = evaluateDayBody.indexOf('availability.windows');
check('the elapsed-day relation is decided BEFORE availability is inspected (nothing supplied can change an elapsed day)', elapsedAt > -1 && unknownAt > -1 && windowsAt > -1 && elapsedAt < unknownAt && elapsedAt < windowsAt);
check('an elapsed day returns the known-infeasible state', /date < todayLocal\) return 'KNOWN_INFEASIBLE'/.test(evaluateDayBody));
check('the public input contract is unchanged by the correction (no new input field)', JSON.stringify(inputFields) === JSON.stringify(['availabilityByDate', 'blockers', 'durationMinutes', 'horizonEndDate', 'now', 'planningDate', 'timezone']));

// ---- no integration in O1 ----------------------------------------------
const lib = path.join(root, 'apps/web/lib');
const app = path.join(root, 'apps/web/app');
function listTs(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name.startsWith('.') ? [] : listTs(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}
// O2 (range adapter) may import only the engine's TYPES and its horizon-bound constant. O4 (the generic
// opportunity enrichment) is the ONE designated caller of the projection function.
const ADAPTER = 'opportunityRangeAdapter.ts';
const ENRICHMENT = 'opportunityDecisionFacts.ts';
const referencing = [...listTs(lib), ...listTs(app)].filter((f) => !f.endsWith('opportunityProjection.ts') && /from '[^']*opportunityProjection'|projectOpportunityFacts|\bOpportunityFacts\b/.test(fs.readFileSync(f, 'utf8')));
check('only the O2 range adapter (types/constant) and the O4 enrichment (the caller) reference the engine', JSON.stringify(referencing.map((f) => path.basename(f)).sort()) === JSON.stringify([ENRICHMENT, ADAPTER].sort()));
const adapterRef = /import \{([^}]*)\} from '\.\/opportunityProjection';/.exec(fs.readFileSync(path.join(lib, ADAPTER), 'utf8'));
const adapterRefNames = adapterRef ? adapterRef[1].split(',').map((n) => n.trim()).filter(Boolean).sort() : [];
check('the O2 adapter imports only the engine\'s MAX_PROJECTION_HORIZON_DAYS constant and DayAvailabilityInput type', JSON.stringify(adapterRefNames) === JSON.stringify(['MAX_PROJECTION_HORIZON_DAYS', 'type DayAvailabilityInput']));
const callers = [...listTs(lib), ...listTs(app)].filter((f) => !f.endsWith('opportunityProjection.ts') && /projectOpportunityFacts/.test(fs.readFileSync(f, 'utf8')));
check('exactly one production file calls projectOpportunityFacts: the generic O4 enrichment', JSON.stringify(callers.map((f) => path.basename(f))) === JSON.stringify([ENRICHMENT]));
check('decisionFacts.ts carries the opportunity TYPE but never imports or calls the engine', !/opportunityProjection|projectOpportunityFacts/.test(read('apps/web/lib/decisionFacts.ts')) && !/^\s*import\s/m.test(read('apps/web/lib/decisionFacts.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
check('the orchestrator, preview handler and route never reference the engine directly (the handler reaches it only through the enrichment)', ['apps/web/lib/dayConstructorOrchestrator.ts', 'apps/web/lib/dayConstructorPreviewRequest.ts', 'apps/web/app/api/day-constructor/preview/route.ts'].every((f) => !/opportunityProjection|projectOpportunityFacts|\bOpportunityFacts\b/.test(read(f))));
check('no Constructor decision module references the engine', ['apps/web/lib/dayConstructor.ts', 'apps/web/lib/dayIntent.ts', 'apps/web/lib/dayCapacity.ts'].every((f) => !/opportunityProjection|projectOpportunityFacts/.test(read(f))));

if (!allPassed) {
  console.error('SOME OPPORTUNITY PROJECTION ARCHITECTURE CHECKS FAILED');
  process.exit(1);
}
console.log('ALL OPPORTUNITY PROJECTION ARCHITECTURE CHECKS PASSED');
