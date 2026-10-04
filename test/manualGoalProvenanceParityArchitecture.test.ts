/**
 * O5 P0a -- architecture proof (pure, no DB) that manual and automatic
 * Goal planning share ONE canonical identity and provenance authority, that
 * no new client claim channel exists, that no manual exception exists in
 * the facts path, and that no policy was added.
 *
 * Structural checks are partly spelling-based by nature; they are backed by
 * the behavioral suites (manualGoalProvenanceParity.test.ts and the DB
 * test), which prove the same properties by execution.
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
const code = (f: string) => stripComments(fs.readFileSync(f, 'utf8'));
const filesMatching = (needle: RegExp, ...excluding: string[]) => all.filter((f) => !excluding.some((x) => f.endsWith(x)) && needle.test(code(f))).map((f) => path.basename(f)).sort();

const bootstrap = read('apps/web/lib/planDayBootstrap.ts');
const planDayEntry = read('apps/web/lib/planDayEntry.ts');
const client = read('apps/web/app/plan-day/PlanDayClient.tsx');
const page = read('apps/web/app/plan-day/page.tsx');
const provider = read('apps/web/lib/goalDecisionFactsProvider.ts');
const authorization = read('apps/web/lib/goalDemandProvenanceAuthorization.ts');

// ============================================================
// ONE canonical identity authority
// ============================================================
check('the canonical goal-demand id is built in exactly one place: no production CODE (comments excluded) outside goalDemandIntentId.ts constructs a `goal-demand:` string', filesMatching(/goal-demand[:`\'"]/, 'goalDemandIntentId.ts').length === 0);
check('the encoder is called only by the three known producers/matchers: the Plan Day client (automatic AND manual), the planning source adapter, and the facts provider', JSON.stringify(filesMatching(/encodeGoalDemandIntentId\(/, 'goalDemandIntentId.ts')) === JSON.stringify(['PlanDayClient.tsx', 'goalDecisionFactsProvider.ts', 'goalPlanningSourceAdapter.ts']));
check('the Plan Day client derives the canonical id for BOTH entry paths from the same encoder and the server-supplied planning date', (code(path.join(app, 'plan-day/PlanDayClient.tsx')).match(/encodeGoalDemandIntentId\(planningDate/g) ?? []).length === 2);
check('the client no longer seeds manual rows with the legacy factory directly; it goes through createIntentRowFromGoalHandoffItem', !/createIntentRowFromGoalActivity\b/.test(code(path.join(app, 'plan-day/PlanDayClient.tsx'))) && /createIntentRowFromGoalHandoffItem\(item, planningDate \? encodeGoalDemandIntentId\(planningDate, item\.id\) : null\)/.test(client));
check('planDayEntry.ts and planDayBootstrap.ts never import or mention the encoder/decoder (they compute no identity)', !/goalDemandIntentId|encodeGoalDemandIntentId|classifyGoalDemandIntentId/.test(stripComments(planDayEntry)) && !/goalDemandIntentId|encodeGoalDemandIntentId|classifyGoalDemandIntentId|goalDemandProvenanceAuthorization/.test(bootstrap));
check('a canonical manual row is built by the EXISTING automatic row factory (one row shape for both paths)', /return createIntentRowFromAutoGoalSuggestion\(\{ title: item\.title, activityId: item\.activityId, goalActivityId: item\.id \}, canonicalIntentId\);/.test(planDayEntry));
check('the legacy manual factory remains unmodified as the fallback (legacy ids, unmarked items, load failures)', /`plan-day-goal-\$\{goalActivity\.id\}`/.test(planDayEntry));

// ============================================================
// Server decides; the client carries only the opaque identity
// ============================================================
check('canonicalDemand is ASSIGNED in exactly one production place: the server-side marking function', filesMatching(/canonicalDemand: true/).join() === 'planDayBootstrap.ts');
check('canonicalDemand is referenced only by the bootstrap (decides) and the row factory (reads)', JSON.stringify(filesMatching(/canonicalDemand/)) === JSON.stringify(['planDayBootstrap.ts', 'planDayEntry.ts']));
const marking = functionBody(bootstrap, 'markCanonicalGoalDemandHandoff');
check('marking is exact-id membership only: no title, activityId, label or similarity access', /canonical\.has\(item\.id\)/.test(marking) && !/\.title|\.activityId|toLowerCase|localeCompare|includes\(|startsWith|match\(/.test(marking));
const auto = functionBody(bootstrap, 'resolveAutomaticGoalDemand');
check('the canonical set comes from the SAME single eligible-demand load (one loadEligibleGoalDemand call, no second eligibility implementation)', (code(path.join(lib, 'planDayBootstrap.ts')).match(/loadEligibleGoalDemand\(/g) ?? []).length === 1 && /manualCanonicalGoalActivityIds: result\.candidates\.filter/.test(auto) && !/computeGoalActivityRhythmEligibility/.test(auto));
check('the page passes the server-marked items to the client (never the raw handoff) and marks nothing on a failed load', /markCanonicalGoalDemandHandoff\(goalActivities, automaticGoalDemand\.status === 'OK' \? automaticGoalDemand\.manualCanonicalGoalActivityIds : \[\]\)/.test(page) && /goalActivities=\{handoffGoalActivities\}/.test(page));

// ============================================================
// NO new client claim channel
// ============================================================
const CLAIM_FIELDS = /goalActivityId|goalId|isGoal|goalProvenance|goalSource|recurrenceId/;
check('the preview request body type and parser carry no Goal claim field', !CLAIM_FIELDS.test(read('apps/web/lib/dayConstructorPreviewClient.ts').match(/export interface PreviewRequestIntentBody[\s\S]*?\n\}/)?.[0] ?? 'x') && !CLAIM_FIELDS.test(read('apps/web/lib/dayConstructorPreviewRequest.ts')));
check('the request builder never reads row.goalActivityId (provenance stays out of the preview request)', !functionBody(planDayEntry, 'buildRequestedIntentsForSubmission').includes('goalActivityId'));
check('the preview route and the O4 enrichment add no Goal claim channel', !CLAIM_FIELDS.test(read('apps/web/app/api/day-constructor/preview/route.ts')) && !CLAIM_FIELDS.test(read('apps/web/lib/opportunityDecisionFacts.ts')));
check('the accept-link builder is unchanged: it still reads only row.goalActivityId (the existing accept-time link, still re-authorized against the signed id)', /if \(row\.goalActivityId && !row\.captureId && proposedIntentIds\.has\(row\.id\)\)/.test(planDayEntry));

// ============================================================
// No manual exception in the facts path; sources stay neutral
// ============================================================
const NEUTRAL = ['apps/web/lib/decisionFacts.ts', 'apps/web/lib/opportunityDecisionFacts.ts', 'apps/web/lib/opportunityProjection.ts', 'apps/web/lib/opportunityRangeAdapter.ts', 'apps/web/lib/opportunityRangeRealDeps.ts', 'apps/web/lib/dayConstructorOrchestrator.ts', 'apps/web/lib/dayConstructorPreviewRequest.ts', 'apps/web/lib/dayConstructor.ts', 'apps/web/lib/dayIntent.ts'];
check('no source-neutral module (DecisionFacts, O1, O2, O4, orchestrator, preview handler, Constructor) mentions the manual id scheme or the canonical marker', NEUTRAL.every((f) => !/plan-day-goal|canonicalDemand/.test(read(f))));
check('the Goal facts provider has no manual exception: no manual id scheme, no marker, no title/label matching', !/plan-day-goal|canonicalDemand/.test(provider) && !/\.title|toLowerCase|localeCompare|startsWith|\.split\(/.test(stripComments(provider)));
check('the provider still matches only exact server-derived canonical ids against the eligible set', /encodeGoalDemandIntentId\(planningLocalDate, candidate\.goalActivityId\)/.test(provider) && /requestedIntentIds\.has\(intentId\)/.test(provider));
check('DecisionFacts is still source-blind: zero imports and no Goal/Rhythm vocabulary', !/^\s*import\s/m.test(stripComments(read('apps/web/lib/decisionFacts.ts'))) && !/goal|rhythm/i.test(read('apps/web/lib/decisionFacts.ts')));

// ============================================================
// Acceptance authorization intact
// ============================================================
check('acceptance authorization still decodes only VERIFIED ids and still rejects mismatched client links, wrong planning dates and malformed ids', /AUTOMATIC_GOAL_PROVENANCE_MISMATCH/.test(authorization) && /AUTOMATIC_GOAL_PLANNING_DATE_MISMATCH/.test(authorization) && /MALFORMED_AUTOMATIC_GOAL_INTENT_ID/.test(authorization) && /classifyGoalDemandIntentId\(item\.intentId\)/.test(authorization));
check('the accept route still authorizes through authorizeGoalActivityLinks and never classifies ids itself', /authorizeGoalActivityLinks\(request\.proposedItems, request\.constructionWindow\.date, rawGoalActivityLinks\)/.test(read('apps/web/app/api/day-constructor/accept/route.ts')) && !/classifyGoalDemandIntentId/.test(read('apps/web/app/api/day-constructor/accept/route.ts')));
check('persistence still materializes occurrences through the existing gate and rolls back on a failed link', /materializeGoalActivityRhythmOccurrence\(userId, goalActivityId, plan\.id, request\.constructionWindow\.date, user\.timezone, client\)/.test(read('apps/web/lib/dayConstructorAcceptancePersistence.ts')) && /GOAL_ACTIVITY_LINK_FAILED/.test(read('apps/web/lib/dayConstructorAcceptancePersistence.ts')));

// ============================================================
// No policy was added
// ============================================================
check('no policy vocabulary exists anywhere in production except the P2b pure deriver module (decisionPressure.ts, unwired and source-neutral) and, since O5 P3b, the two inert shadow modules that CONSUME its derived value (shadowPressureEvaluation.ts, shadowPressureObservation.ts -- source-neutral, unwired from the Constructor, pinned by shadowPressureArchitecture.test.ts): no decisionPressure, LAST_KNOWN_OPPORTUNITY or pressure type, gate or shadow policy elsewhere', filesMatching(/decisionPressure|DecisionPressure|LAST_KNOWN_OPPORTUNITY|overloadGate|shadowPolicy/i).filter((f) => !/(decisionPressure|shadowPressureEvaluation|shadowPressureObservation)\.ts$/.test(f)).length === 0);
check('the precedence comparator still reads no decision facts', !/decisionFacts|opportunity|recurrence/i.test(functionBody(read('apps/web/lib/dayIntent.ts'), 'compareByOverloadPrecedence')));
check('the O1/O2/O4 modules and the facts type are untouched by this slice (no Goal, marker or manual vocabulary)', ['apps/web/lib/opportunityProjection.ts', 'apps/web/lib/opportunityRangeAdapter.ts', 'apps/web/lib/opportunityRangeRealDeps.ts', 'apps/web/lib/opportunityDecisionFacts.ts'].every((f) => !/goalActivity|plan-day-goal|canonicalDemand/i.test(read(f))));

if (!allPassed) {
  console.error('SOME MANUAL GOAL PROVENANCE PARITY ARCHITECTURE CHECKS FAILED');
  process.exit(1);
}
console.log('ALL MANUAL GOAL PROVENANCE PARITY ARCHITECTURE CHECKS PASSED');
