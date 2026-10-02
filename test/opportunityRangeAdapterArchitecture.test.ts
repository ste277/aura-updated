/**
 * Opportunity Scarcity V1 -- O2 architecture guard for
 * apps/web/lib/opportunityRangeAdapter.ts (core), opportunityRangeRealDeps.ts
 * (real wiring) and planBlockerLifecycle.ts. Asserts forbidden imports,
 * behaviors and consumers, not identifier spelling alone.
 */
import fs from 'fs';
import path from 'path';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const root = path.join(__dirname, '..');
const lib = path.join(root, 'apps/web/lib');
const app = path.join(root, 'apps/web/app');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const importSpecs = (src: string) => Array.from(src.matchAll(/^import[^;]*?from\s+'([^']+)';/gms)).map((m) => m[1]).sort();

const CORE = 'apps/web/lib/opportunityRangeAdapter.ts';
const REAL = 'apps/web/lib/opportunityRangeRealDeps.ts';
const LIFE = 'apps/web/lib/planBlockerLifecycle.ts';
const core = read(CORE);
const real = read(REAL);
const life = read(LIFE);
const coreCode = stripComments(core);
const realCode = stripComments(real);

// ---- core imports: only pure canonical helpers / types ---------------
const CORE_ALLOWED = ['../../../packages/panchang/src/localDate', './availabilityContext', './dayCapacity', './opportunityProjection', './planBlockerLifecycle', './timezone'];
check(`core imports are exactly the allowed pure canonical helpers (${CORE_ALLOWED.length})`, JSON.stringify(importSpecs(core)) === JSON.stringify(CORE_ALLOWED));
const FORBIDDEN_IMPORT = /\.\/(db|goals|goalActivityRhythm|goalDemand\w*|goalDecision\w*|decisionFacts|dayConstructor|dayConstructor\w+|dayIntent|planDay\w*|session|auth|natalContext|myDayOrchestrator|opportunityRangeRealDeps)'/;
check('core imports no database, Goal, Rhythm, Candidate A, provider, DecisionFacts, Constructor/orchestrator, acceptance/persistence, or the real wiring', !FORBIDDEN_IMPORT.test(core));
check('core takes only the BlockedInterval TYPE from dayCapacity', /import type \{ BlockedInterval \} from '\.\/dayCapacity';/.test(core));
const projNames = /import \{([^}]*)\} from '\.\/opportunityProjection';/.exec(core);
check('core imports only a constant and a type from the projection engine, never the projection function', !!projNames && JSON.stringify(projNames[1].split(',').map((n) => n.trim()).sort()) === JSON.stringify(['MAX_PROJECTION_HORIZON_DAYS', 'type DayAvailabilityInput']) && !/projectOpportunityFacts/.test(core));
const tzNames = /import \{([^}]*)\} from '\.\/timezone';/.exec(core);
check('core reaches timezone conversion only through the canonical helpers', !!tzNames && JSON.stringify(tzNames[1].split(',').map((n) => n.trim()).sort()) === JSON.stringify(['addDaysToDateStr', 'getDatePartsInTimezone', 'localDateTimeToUTC', 'resolveLocalDateTime']));

// ---- canonical reuse, no second implementation -----------------------
check('availability goes through the canonical resolveAvailability (no template/weekday logic reproduced)', /resolveAvailability\(/.test(coreCode) && !/getUTCDay|getDay\(/.test(coreCode));
check('Plan lifecycle goes through the canonical isActivePlanBlocker (no status rules reproduced)', /isActivePlanBlocker\(/.test(coreCode) && !/'(CANCELLED|SKIPPED|MOVED|LOGGED|UPCOMING)'/.test(coreCode));
check('no second timezone conversion: no manual offsets, no Intl, no getTimezoneOffset', !/getTimezoneOffset|resolveTzOffsetMinutes|Intl\.|offsetMinutes/.test(coreCode));
check('the unconfigured fallback is not used: no fabricated clock times or day-long window in the core', !/'(0?9:00|17:00|23:59|12:00)'/.test(coreCode) && /kind: 'UNKNOWN'/.test(coreCode));
check('window boundaries are checked for exactness via the canonical resolveLocalDateTime (DST hour -> UNKNOWN)', /resolveLocalDateTime\(/.test(coreCode) && /status === 'OK'/.test(coreCode));

// ---- purity / read-only ------------------------------------------------
check('core: no clock (no Date.now, no new Date() without an argument), no randomness, no process/env access', !/Date\.now\(|new Date\(\s*\)|Math\.random|process\./.test(coreCode));
check('core: no database or network access and no write verbs', !/pool\.|beginTransaction|INSERT|UPDATE|DELETE|fetch\(|\.query\(/.test(coreCode));
const realImports = importSpecs(real);
check('real wiring imports exactly db, availabilityContext (type) and the adapter (type)', JSON.stringify(realImports) === JSON.stringify(['./availabilityContext', './db', './opportunityRangeAdapter']));
const dbNames = /import \{([^}]*)\} from '\.\/db';/.exec(real);
check('real wiring imports only two READ functions from db (plus the User type) -- no writers', !!dbNames && JSON.stringify(dbNames[1].split(',').map((n) => n.trim()).sort()) === JSON.stringify(['listPlannedActivitiesOverlappingRange', 'listUserAvailabilityPeriods', 'type User']));
check('real wiring contains no write verbs and no client-supplied data path (scoped by user.id only)', !/INSERT|UPDATE|DELETE|\b(create|replace|delete|set|update|insert|log|skip|move)(?!Real)[A-Z]\w*\(/.test(realCode) && /user\.id/.test(realCode) && !/request\.|body|req\./.test(realCode));
const dbSrc = read('apps/web/lib/db.ts');
const qStart = dbSrc.indexOf('export async function listPlannedActivitiesOverlappingRange');
const qBody = dbSrc.slice(qStart, dbSrc.indexOf('\n}\n', qStart));
check('the overlap query is a single read-only SELECT scoped by userId with half-open overlap and the cancelled filter', /SELECT \* FROM "PlannedActivity"/.test(qBody) && /"userId" = \$1/.test(qBody) && /"plannedStartAt" < \$3 AND "plannedEndAt" > \$2/.test(qBody) && /status <> 'CANCELLED'/.test(qBody) && !/INSERT|UPDATE|DELETE/.test(qBody));

// ---- generic range contract, source neutrality, no policy --------------
const reqBlock = core.slice(core.indexOf('export interface OpportunityRangeRequest'), core.indexOf('/** Everything the adapter needs'));
const reqFields = Array.from(reqBlock.matchAll(/^\s{2}(\w+):/gm)).map((m) => m[1]).sort();
check('the range contract is exactly an explicit startDate/endDate plus timezone and now', JSON.stringify(reqFields) === JSON.stringify(['endDate', 'now', 'startDate', 'timezone']));
check('no period/horizon inference: no week, deadline or recurrence identifiers', !/THIS_WEEK|LOCAL_CALENDAR_WEEK|localCalendarWeekStart|horizonEnd|deadline|periodEnd/i.test(core + real));
const FORBIDDEN_WORDS = /goal|rhythm|template ?category|goal-demand|candidate a\b|remainingInPeriod|targetPerPeriod|recurrence|priority|urgen|pressure|score|rank|recommend|shortfall|impossible|behind|atRisk|lastChance|muhurta|timingFit|constructDay|orchestrate|compareBy|evaluateCandidate/i;
check('core and real wiring mention no source, requirement, scoring, urgency, timing-quality, or Constructor vocabulary', !FORBIDDEN_WORDS.test(core) && !FORBIDDEN_WORDS.test(real));
check('no user-facing copy in the core (no string literal containing whitespace)', Array.from(coreCode.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"/g)).every((m) => !/\s/.test(m[1] ?? m[2] ?? '')));

// ---- lifecycle module: pure and behavior-neutral extraction -----------
check('planBlockerLifecycle.ts has no imports (pure) and no I/O or clock', importSpecs(life).length === 0 && !/pool\.|fetch\(|Date\.now|new Date\(\s*\)/.test(stripComments(life)));
const orch = read('apps/web/lib/dayConstructorOrchestrator.ts');
check('the orchestrator re-exports the lifecycle unchanged (existing importers unaffected) and no longer defines it', /export \{ isActivePlanBlocker, type PlanBlockerStatus, type PlanBlockerCandidate \};/.test(orch) && !/export function isActivePlanBlocker/.test(orch) && /export function isActivePlanBlocker/.test(life));
check('the orchestrator remains Goal/Rhythm-blind after the extraction', !/goal|rhythm/i.test(orch));

// ---- no production consumer / no integration ----------------------------
function listTs(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name.startsWith('.') ? [] : listTs(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}
const all = [...listTs(lib), ...listTs(app)];
const consumersOf = (needle: RegExp, ...excluding: string[]) => all.filter((f) => !excluding.some((x) => f.endsWith(x)) && needle.test(fs.readFileSync(f, 'utf8')));
const base = (files: string[]) => files.map((f) => path.basename(f)).sort();
check('the adapter core is referenced only by its real-wiring leaf, the O4 enrichment (the loader caller) and the preview handler (a TYPE import only)', JSON.stringify(base(consumersOf(/from '[^']*opportunityRangeAdapter'/, 'opportunityRangeAdapter.ts'))) === JSON.stringify(['dayConstructorPreviewRequest.ts', 'opportunityDecisionFacts.ts', 'opportunityRangeRealDeps.ts']));
check('the preview handler takes only the OpportunityRangeDeps TYPE from the adapter and never calls a loader', /import type \{ OpportunityRangeDeps \} from '\.\/opportunityRangeAdapter';/.test(read('apps/web/lib/dayConstructorPreviewRequest.ts')) && !/loadOpportunityRangeInputs|adaptOpportunityRangeInputs/.test(read('apps/web/lib/dayConstructorPreviewRequest.ts')));
check('the real wiring is referenced only by the preview route (the one place that binds it to the authenticated user)', JSON.stringify(consumersOf(/opportunityRangeRealDeps|createRealOpportunityRangeDeps/, 'opportunityRangeRealDeps.ts').map((f) => f.replace(/^.*apps\/web\//, ''))) === JSON.stringify(['app/api/day-constructor/preview/route.ts']));
check('exactly one production file calls the adapter loader and projection: the generic O4 enrichment', JSON.stringify(base(consumersOf(/projectOpportunityFacts|loadOpportunityRangeInputs|adaptOpportunityRangeInputs/, 'opportunityProjection.ts', 'opportunityRangeAdapter.ts'))) === JSON.stringify(['opportunityDecisionFacts.ts']));
check('DecisionFacts, the Goal provider, the orchestrator and the Constructor modules do not reference the range adapter', ['apps/web/lib/decisionFacts.ts', 'apps/web/lib/goalDecisionFactsProvider.ts', 'apps/web/lib/dayConstructorOrchestrator.ts', 'apps/web/lib/dayConstructor.ts', 'apps/web/lib/dayIntent.ts'].every((f) => !/opportunityRange|OpportunityRange/.test(read(f))));
check('the range adapter does not widen any existing loader: listPlannedActivitiesForDay still selects by start time only (unchanged)', /"plannedStartAt" BETWEEN \$2 AND \$3/.test(dbSrc));

if (!allPassed) {
  console.error('SOME OPPORTUNITY RANGE ADAPTER ARCHITECTURE CHECKS FAILED');
  process.exit(1);
}
console.log('ALL OPPORTUNITY RANGE ADAPTER ARCHITECTURE CHECKS PASSED');
