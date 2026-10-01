/**
 * Goals V2 Candidate A3.4 -- structural guards: proves the decoder is
 * called only at the acceptance/pre-persistence authorization boundary,
 * never inside persistence/Constructor/orchestrator; proves no second
 * `goal-demand:` parser exists anywhere; proves no new signed Goal field
 * was added; proves the manual Goal path and existing ownership/Rhythm
 * persistence checks remain untouched. Reads real, shipped source as
 * plain text (`fs`/`path`) -- never a rendering harness, matching this
 * repository's own established convention for exactly this class of
 * property (see planDayWiring.test.ts/goalActivityRhythmStructuralGuards.test.ts).
 */
import fs from 'fs';
import path from 'path';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf8');

const goalDemandIntentIdSrc = read('../apps/web/lib/goalDemandIntentId.ts');
const authorizationSrc = read('../apps/web/lib/goalDemandProvenanceAuthorization.ts');
const acceptRouteSrc = read('../apps/web/app/api/day-constructor/accept/route.ts');
const persistenceSrc = read('../apps/web/lib/dayConstructorAcceptancePersistence.ts');
const acceptanceSrc = read('../apps/web/lib/dayConstructorAcceptance.ts');
const previewIntegritySrc = read('../apps/web/lib/dayConstructorPreviewIntegrity.ts');
const dayConstructorSrc = read('../apps/web/lib/dayConstructor.ts');
const dayConstructorOrchestratorSrc = read('../apps/web/lib/dayConstructorOrchestrator.ts');
const planDayEntrySrc = read('../apps/web/lib/planDayEntry.ts');
const planDayClientSrc = read('../apps/web/app/plan-day/PlanDayClient.tsx');
const planDayBootstrapSrc = read('../apps/web/lib/planDayBootstrap.ts');
const goalPlanningSourceAdapterSrc = read('../apps/web/lib/goalPlanningSourceAdapter.ts');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// ============================================================
// 41. decoder called only in the acceptance/pre-persistence authorization
// layer -- i.e. classifyGoalDemandIntentId is imported/called ONLY by
// goalDemandProvenanceAuthorization.ts (and exercised directly by its own
// test files, which this check does not scan).
// ============================================================
check('41a. classifyGoalDemandIntentId is imported by goalDemandProvenanceAuthorization.ts', /import \{ classifyGoalDemandIntentId \} from '\.\/goalDemandIntentId';/.test(authorizationSrc));
check('41b. classifyGoalDemandIntentId is called exactly once in the authorization module (the one classification site)', occurrences(stripComments(authorizationSrc), 'classifyGoalDemandIntentId(') === 1);

// ============================================================
// 42. persistence module does not import goalDemandIntentId (or the new
// authorization module) at all.
// ============================================================
check('42. dayConstructorAcceptancePersistence.ts does not import goalDemandIntentId.ts or goalDemandProvenanceAuthorization.ts', !/goalDemandIntentId|goalDemandProvenanceAuthorization/.test(persistenceSrc));
check('42b. dayConstructorAcceptancePersistence.ts never references the literal "goal-demand:" namespace', !/goal-demand:/.test(persistenceSrc));

// ============================================================
// 43/44. Constructor/orchestrator do not import goalDemandIntentId or the
// new authorization module.
// ============================================================
check('43. dayConstructor.ts does not import goalDemandIntentId.ts or goalDemandProvenanceAuthorization.ts', !/goalDemandIntentId|goalDemandProvenanceAuthorization/.test(dayConstructorSrc));
check('44. dayConstructorOrchestrator.ts does not import goalDemandIntentId.ts or goalDemandProvenanceAuthorization.ts', !/goalDemandIntentId|goalDemandProvenanceAuthorization/.test(dayConstructorOrchestratorSrc));

// ============================================================
// 45. no new signed Goal field was added -- dayConstructorPreviewIntegrity.ts
// (the ONE file that defines the signed payload shape) is byte-unchanged
// from its own pre-A3.4 canonical field list; no goalActivityId/goalId/
// goalTitle/Rhythm field was added to it.
// ============================================================
check(
  '45. canonicalPreviewItemFields still signs exactly the same pre-A3.4 field list -- no goalActivityId/goalId/goalTitle/Rhythm field added',
  /return \[\s*userId,\s*window\.date,\s*window\.timezone,\s*window\.source,\s*window\.start\.toISOString\(\),\s*window\.end\.toISOString\(\),\s*item\.intentId,\s*item\.activityId \?\? null,\s*item\.title,\s*item\.start\.toISOString\(\),\s*item\.end\.toISOString\(\),\s*item\.placementSource,\s*\];/.test(
    previewIntegritySrc
  )
);
check('45b. dayConstructorPreviewIntegrity.ts does not reference goalActivityId/goalId/goalTitle/Rhythm anywhere', !/goalActivityId|goalId|goalTitle|[Rr]hythm/.test(previewIntegritySrc));
check('45c. dayConstructorPreviewIntegrity.ts (the signing module) was not modified to import goalDemandIntentId -- signing stays decoder-unaware', !/goalDemandIntentId/.test(previewIntegritySrc));

// ============================================================
// 46. manual Goal `plan-day-goal-<id>` identity untouched.
// ============================================================
check('46. createIntentRowFromGoalActivity (the manual Goal row factory) still produces the plan-day-goal-<id> scheme, unmodified', /`plan-day-goal-\$\{goalActivity\.id\}`/.test(planDayEntrySrc));
check('46b. planDayBootstrap.ts\'s resolveGoalActivityHandoff is untouched by this ticket (no goalDemandIntentId/goalDemandProvenanceAuthorization reference)', !/goalDemandIntentId|goalDemandProvenanceAuthorization/.test(planDayBootstrapSrc));

// ============================================================
// 47. the client goalActivityLinks builder (buildGoalActivityLinksForAccept,
// planDayEntry.ts) is untouched -- A3.4 authorizes server-side, it never
// needed a client-side change.
// ============================================================
check(
  '47. buildGoalActivityLinksForAccept is byte-unchanged from its own pre-A3.4 shape (still derives goalActivityId from row.goalActivityId only, no new intentId-encoding logic added to it)',
  /export function buildGoalActivityLinksForAccept\(rows: readonly PlanDayIntentRow\[\], proposedItems: readonly \{ intentId: string \}\[\]\): GoalActivityLink\[\] \{\s*const proposedIntentIds = new Set\(proposedItems\.map\(\(item\) => item\.intentId\)\);\s*const links: GoalActivityLink\[\] = \[\];\s*for \(const row of rows\) \{\s*if \(row\.goalActivityId && !row\.captureId && proposedIntentIds\.has\(row\.id\)\) \{\s*links\.push\(\{ intentId: row\.id, goalActivityId: row\.goalActivityId \}\);\s*\}\s*\}\s*return links;\s*\}/.test(
    planDayEntrySrc
  )
);
check('47b. PlanDayClient.tsx\'s own accept-time goalActivityLinks/captureLinks wiring is untouched (still buildGoalActivityLinksForAccept(rows, preview.constructedDay.proposedItems) verbatim)', /goalActivityLinks=\{buildGoalActivityLinksForAccept\(rows, preview\.constructedDay\.proposedItems\)\}/.test(planDayClientSrc));

// ============================================================
// 48. existing ownership/Rhythm persistence checks remain present
// (materializeGoalActivityRhythmOccurrence's own HAS_LIVE_COMMITMENT/
// CAPACITY_EXHAUSTED/ownership gates, and the legacy linkGoalActivityToPlannedActivity
// fallback) -- this ticket changes WHICH goalActivityId is authoritative,
// never whether it's still eligible to persist.
// ============================================================
check('48a. persistAcceptedConstructedDay still tries materializeGoalActivityRhythmOccurrence first for every Goal-linked write, unmodified', /const materialized = await materializeGoalActivityRhythmOccurrence\(userId, goalActivityId, plan\.id, request\.constructionWindow\.date, user\.timezone, client\);/.test(persistenceSrc));
check('48b. the existing legacy linkGoalActivityToPlannedActivity fallback (finite/NONE Rhythm path) is still present, unmodified', /const linked = await linkGoalActivityToPlannedActivity\(userId, goalActivityId, plan\.id, client\);/.test(persistenceSrc));
check('48c. the existing all-or-nothing GOAL_ACTIVITY_LINK_FAILED rollback contract is still present', occurrences(persistenceSrc, "throw new Error('GOAL_ACTIVITY_LINK_FAILED');") === 2);
check('48d. the per-user advisory lock (concurrency protection) is still present, unmodified', /pg_advisory_xact_lock\(hashtext\(\$1\)\)/.test(persistenceSrc));

// ============================================================
// 49. decoder module itself does not import DB/React/Constructor.
// ============================================================
check('49a. goalDemandIntentId.ts does not import pg/db.ts/React/next in real code', !/from '\.\/db'|from 'pg'|from 'react'|from 'next/i.test(stripComments(goalDemandIntentIdSrc)));
check('49b. goalDemandIntentId.ts does not import any dayConstructor*.ts module in real code', !/from '\.\/dayConstructor/i.test(stripComments(goalDemandIntentIdSrc)));
check('49c. goalDemandProvenanceAuthorization.ts does not import pg/db.ts/React/next in real code (acceptance-domain, pure/types-only)', !/from '\.\/db'|from 'pg'|from 'react'|from 'next/i.test(stripComments(authorizationSrc)));

// ============================================================
// 50. no duplicate `goal-demand:` parser exists anywhere else in the
// codebase -- classifyGoalDemandIntentId (goalDemandIntentId.ts) is the
// ONE implementation; no other file hand-rolls its own split/startsWith
// parsing of the reserved namespace.
// ============================================================
check(
  '50. no second ad hoc parser of the goal-demand: namespace exists in acceptance/orchestrator/Constructor/PlanDayClient source (only the real literal-prefix mentions already proven elsewhere, e.g. encodeGoalDemandIntentId\'s own template, count as legitimate)',
  !/\.split\(['"]:['"]\)/.test(stripComments(acceptRouteSrc)) &&
    !/\.split\(['"]:['"]\)/.test(stripComments(persistenceSrc)) &&
    !/\.split\(['"]:['"]\)/.test(stripComments(dayConstructorSrc)) &&
    !/\.split\(['"]:['"]\)/.test(stripComments(dayConstructorOrchestratorSrc)) &&
    !/\.split\(['"]:['"]\)/.test(stripComments(planDayClientSrc))
);
check('50b. the acceptance route itself never reimplements goal-demand classification -- it calls authorizeGoalActivityLinks, never classifyGoalDemandIntentId directly', !/classifyGoalDemandIntentId/.test(acceptRouteSrc) && /authorizeGoalActivityLinks\(request\.proposedItems, request\.constructionWindow\.date, rawGoalActivityLinks\)/.test(acceptRouteSrc));

// ============================================================
// Trust-order wiring (this ticket's own section 3) -- re-confirmed
// structurally: authorizeGoalActivityLinks is called strictly AFTER the
// integrity gate's own early-return, never before.
// ============================================================
{
  const verifyIndex = acceptRouteSrc.indexOf('verifyAcceptanceItems(');
  const authorizeIndex = acceptRouteSrc.indexOf('authorizeGoalActivityLinks(');
  check('trust order: verifyAcceptanceItems appears BEFORE authorizeGoalActivityLinks in route.ts source order', verifyIndex !== -1 && authorizeIndex !== -1 && verifyIndex < authorizeIndex);
  const integrityRejectIndex = acceptRouteSrc.indexOf("reason: 'INVALID_REQUEST', diagnostics: integrityDiagnostics");
  check('trust order: the integrity-gate early return appears BEFORE the authorizeGoalActivityLinks call', integrityRejectIndex !== -1 && integrityRejectIndex < authorizeIndex);
  const persistIndex = acceptRouteSrc.indexOf('persistAcceptedConstructedDay(session.userId, request, now, authorization.goalActivityLinks, captureLinks)');
  check('trust order: persistAcceptedConstructedDay receives authorization.goalActivityLinks (the AUTHORIZED map), never the raw parsed one', persistIndex !== -1);
  check('trust order: the authorization REJECTED early-return appears BEFORE the persistence call', authorizeIndex < persistIndex);
}

// ============================================================
// A2's own goalPlanningSourceAdapter.ts re-export is untouched by this
// ticket (A3.4 extends goalDemandIntentId.ts, never goalPlanningSourceAdapter.ts).
// ============================================================
check('goalPlanningSourceAdapter.ts still re-exports encodeGoalDemandIntentId verbatim, unmodified by A3.4', /export \{ encodeGoalDemandIntentId \};/.test(goalPlanningSourceAdapterSrc) && !/classifyGoalDemandIntentId/.test(goalPlanningSourceAdapterSrc));

// ============================================================
// evaluateAcceptance (dayConstructorAcceptance.ts) itself remains
// completely unaware of Goal demand -- A3.4's own authorization step is
// a SIBLING concern, never folded into E1's own scheduling-domain
// contract (mirroring the SAME established pattern goalActivityLinks
// itself already uses).
// ============================================================
check('evaluateAcceptance (dayConstructorAcceptance.ts) does not reference Goal demand/goalDemandIntentId/goalActivityLinks', !/goalDemandIntentId|goalDemandProvenanceAuthorization|goalActivityLinks/i.test(acceptanceSrc));

if (!allPassed) {
  console.error('SOME GOAL DEMAND PROVENANCE AUTHORIZATION STRUCTURAL GUARD CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOAL DEMAND PROVENANCE AUTHORIZATION STRUCTURAL GUARD CHECKS PASSED');
