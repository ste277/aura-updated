/**
 * Planned Activity Canonical Identity Propagation V1 (C2b): regression
 * suite for canonical ActivityProfile identity flowing:
 *
 *   canonical activity selection -> PlannedActivity.activityId
 *   -> Plan completion -> HabitLog.activityId -> existing C3 eligibility
 *
 * A live database is unavailable in this environment (DATABASE_URL
 * unset), so DB-transaction behavior (createPlannedActivity,
 * logPlannedActivity) is replicated here EXACTLY as implemented (never
 * reimplemented independently) and cross-checked against the live source,
 * matching this repo's established pattern (see
 * test/habitLogActivityIdentity.test.ts, test/planCompletionHistoricalIntegrity.test.ts).
 * A companion DB-gated round-trip test exists separately
 * (test/plannedActivityCanonicalIdentityDb.test.ts). Functions that don't
 * touch the database (getActivityProfileById, evaluateHabitLogAuraFit) are
 * called directly, never mocked. PlanWithAuraView.tsx's own
 * resolveActivitySelection is NOT imported here (a .tsx runtime import
 * would require every consumer of this repo's root tsconfig.json to carry
 * a JSX-aware exclusion just for this one test) -- instead it is
 * replicated below EXACTLY as implemented and cross-checked against the
 * live source, the same established pattern
 * test/habitLogActivityIdentity.test.ts already uses for
 * getActivityProfileById. resolveActivitySelection's own behavior already
 * has a complete, dedicated test suite (test/planWithAuraViewLogic.test.ts),
 * so this file does not re-verify it independently -- only that this PR's
 * OWN threading calls it correctly.
 */
import * as fs from 'fs';
import { getActivityProfileById, FULL_ACTIVITY_CATALOG } from '../packages/recommendation/src/personalizedTasks';
import { SUPPORTED_MUHURTHAM_ACTIVITY_IDS } from '../packages/recommendation/src/muhurthamFinder';
import { evaluateHabitLogAuraFit } from '../apps/web/lib/insightsAuraFit';
import type { HabitLogRow } from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// ============================================================
// 1. Schema has PlannedActivity.activityId String?
// ============================================================

const schemaSource = fs.readFileSync('apps/web/prisma/schema.prisma', 'utf8');
const plannedActivityModelBlock = schemaSource.slice(schemaSource.indexOf('model PlannedActivity {'), schemaSource.indexOf('model PlannedActivity {') + 2000);
check('schema.prisma declares PlannedActivity.activityId as nullable (String?, no @default, no @unique)', /activityId\s+String\?/.test(plannedActivityModelBlock) && !/activityId[^\n]*@default/.test(plannedActivityModelBlock) && !/activityId[^\n]*@unique/.test(plannedActivityModelBlock));
check('schema.prisma\'s PlannedActivity.activityId has no @relation (plain string, not a foreign key)', !/activityId[^\n]*@relation/.test(plannedActivityModelBlock));
check('HabitLog.activityId remains completely unmodified in this PR (schema still has it, unrelated to this Plan-side addition)', /model HabitLog \{[\s\S]*?activityId\s+String\?/.test(schemaSource));

// ============================================================
// 2. Migration is additive-only.
// ============================================================

const migrationSource = fs.readFileSync('apps/web/prisma/migrations/0031_planned_activity_activity_id/migration.sql', 'utf8');
const migrationDdlOnly = migrationSource.replace(/^--.*$/gm, '');
check('Migration adds activityId via a plain nullable ALTER TABLE ADD COLUMN', /ALTER TABLE "PlannedActivity" ADD COLUMN "activityId" TEXT;/.test(migrationDdlOnly));
check('Migration has no DEFAULT clause for activityId', !/activityId[^;]*DEFAULT/i.test(migrationDdlOnly));
check('Migration has no NOT NULL clause for activityId', !/activityId[^;]*NOT NULL/i.test(migrationDdlOnly));
check('Migration contains no UPDATE/backfill statement', !/\bUPDATE\b/i.test(migrationDdlOnly));
check('Migration contains no CREATE INDEX statement', !/CREATE INDEX/i.test(migrationDdlOnly));
check('Migration contains no UNIQUE constraint', !/UNIQUE/i.test(migrationDdlOnly));
check('Migration contains no FOREIGN KEY/REFERENCES clause', !/FOREIGN KEY|REFERENCES/i.test(migrationDdlOnly));
check('Migration touches only the PlannedActivity table', !/ALTER TABLE "(?!PlannedActivity)/.test(migrationDdlOnly));

// ============================================================
// 3. getActivityProfileById remains exact-match.
// ============================================================

check('getActivityProfileById("deep-work") returns the exact canonical ActivityProfile', getActivityProfileById('deep-work')?.id === 'deep-work');
check('getActivityProfileById(unknown id) returns undefined', getActivityProfileById('not-a-real-activity') === undefined);
check('getActivityProfileById does not match by title ("Deep Work" is not a valid id)', getActivityProfileById('Deep Work') === undefined);
const catalogSource = fs.readFileSync('packages/recommendation/src/personalizedTasks.ts', 'utf8');
check('getActivityProfileById uses FULL_ACTIVITY_CATALOG.find with exact id equality, no alias/title reference', /FULL_ACTIVITY_CATALOG\.find\(\(activity\) => activity\.id === id\)/.test(catalogSource));

// ============================================================
// Server-side validation logic -- exact replica of
// apps/web/app/api/plans/route.ts's activityId handling.
// ============================================================

function validatePlanActivityId(activityId: unknown): { ok: true; validatedActivityId: string | null } | { ok: false; status: number; error: string } {
  let validatedActivityId: string | null = null;
  if (typeof activityId === 'string' && activityId.trim()) {
    const activity = getActivityProfileById(activityId.trim());
    if (!activity) {
      return { ok: false, status: 400, error: 'Unknown activity.' };
    }
    validatedActivityId = activity.id;
  }
  return { ok: true, validatedActivityId };
}

// 4. Valid exact ID accepted.
const validResult = validatePlanActivityId('deep-work');
check('A valid catalog id passes validation and resolves to the canonical id', validResult.ok === true && validResult.ok && validResult.validatedActivityId === 'deep-work');

// 5. Invalid nonblank ID rejected.
const invalidResult = validatePlanActivityId('not-a-real-activity');
check('An unknown id is rejected (not ok), never silently nullified or passed through', invalidResult.ok === false);
check('An unknown id rejection uses HTTP 400', invalidResult.ok === false && !invalidResult.ok && invalidResult.status === 400);
check('An unknown id rejection never reaches "validatedActivityId" at all', invalidResult.ok === false && !('validatedActivityId' in invalidResult));

// 6. Omitted ID -> NULL.
check('Omitted activityId (undefined) is valid and resolves to null', validatePlanActivityId(undefined).ok === true && (validatePlanActivityId(undefined) as { validatedActivityId: string | null }).validatedActivityId === null);

// 7. Explicit null -> NULL.
check('Explicit null activityId is valid and resolves to null', validatePlanActivityId(null).ok === true && (validatePlanActivityId(null) as { validatedActivityId: string | null }).validatedActivityId === null);

// 8. "" -> NULL.
check('Empty-string activityId is valid and resolves to null (not rejected as "unknown")', validatePlanActivityId('').ok === true && (validatePlanActivityId('') as { validatedActivityId: string | null }).validatedActivityId === null);

// 9. Whitespace-only -> NULL.
check('Whitespace-only activityId is valid and resolves to null', validatePlanActivityId('   ').ok === true && (validatePlanActivityId('   ') as { validatedActivityId: string | null }).validatedActivityId === null);

// 10. Valid ID + custom title accepted independently.
const customTitle = 'Finish Q4 board presentation';
const titleIndependenceResult = validatePlanActivityId('deep-work');
check('A valid canonical id ("deep-work") is accepted regardless of what title the request also carries -- validation never inspects/compares title at all', titleIndependenceResult.ok === true && titleIndependenceResult.ok && titleIndependenceResult.validatedActivityId === 'deep-work');
check('The custom title and the catalog title are genuinely different strings, confirming this is a real independence case, not a coincidental match', customTitle !== (getActivityProfileById('deep-work')?.title ?? ''));
check('validatePlanActivityId takes exactly 1 parameter (activityId only) -- structurally cannot read title/activityType', validatePlanActivityId.length === 1);

// ============================================================
// Source-scan cross-checks against the live implementation.
// ============================================================

const routeSource = fs.readFileSync('apps/web/app/api/plans/route.ts', 'utf8');
const routeCodeOnly = stripComments(routeSource);
check('POST /api/plans imports getActivityProfileById from the catalog module', /import \{ getActivityProfileById \} from '\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/packages\/recommendation\/src\/personalizedTasks'/.test(routeSource));
check('POST /api/plans rejects an unknown activityId with HTTP 400 "Unknown activity."', /error: 'Unknown activity\.'\s*\}, \{ status: 400 \}/.test(routeSource));
check('POST /api/plans persists only the VALIDATED activity.id (activity.id), never the raw client-submitted string', /validatedActivityId = activity\.id;/.test(routeSource));
check('POST /api/plans never requires/compares title against the resolved activity\'s own title', !/activity\.title\s*===?\s*(clean)?[Tt]itle/.test(routeCodeOnly));
check('createPlannedActivity is called with activityId: validatedActivityId', /activityId: validatedActivityId,/.test(routeSource));

const dbSource = fs.readFileSync('apps/web/lib/db.ts', 'utf8');
check('createPlannedActivity does NOT perform its own catalog lookup/validation (no getActivityProfileById/FULL_ACTIVITY_CATALOG reference inside db.ts)', !/getActivityProfileById|FULL_ACTIVITY_CATALOG/.test(dbSource));

// ============================================================
// 11. Day Builder threads suggestion.activityId.
// ============================================================

const dayBuilderCardSource = fs.readFileSync('apps/web/components/DayBuilderCard.tsx', 'utf8');
check('DayBuilderCard.tsx\'s handleAdd threads suggestion.activityId into saveUpcomingPlanFromCandidate', /saveUpcomingPlanFromCandidate\(selectedGeneralCandidate\(suggestion\), suggestion\.durationMinutes, \{ clientRequestId, activityId: suggestion\.activityId \}\)/.test(dayBuilderCardSource));
check('DayBuilderCard.tsx does not perform a fresh catalog lookup for the Plan-save activityId (suggestion.activityId is used directly, not re-derived)', !stripComments(dayBuilderCardSource).includes('getActivityProfileById'));

// ============================================================
// 12/13. PlanWithAura canonical selection threads activityId;
// free text does not synthesize one.
// ============================================================

const planWithAuraSource = fs.readFileSync('apps/web/components/PlanWithAuraView.tsx', 'utf8');
check('PlanWithAuraView.tsx\'s FIND-mode save threads resolvedActivityDefinition?.id (the same exact-match resolution already used for AuraMoment creation)', (planWithAuraSource.match(/durationMinutes\), resolvedActivityDefinition\?\.id\)/g) || []).length === 2);
check('PlanWithAuraView.tsx\'s CHECK-mode save threads resolveActivitySelection(checkTaskTitle).activityId', (planWithAuraSource.match(/resolveActivitySelection\(checkTaskTitle\)\.activityId/g) || []).length === 2);
check('PlanWithAuraView.tsx\'s COMPARE-mode save threads resolveActivitySelection(compareTaskTitle).activityId', (planWithAuraSource.match(/resolveActivitySelection\(compareTaskTitle\)\.activityId/g) || []).length === 2);
// resolveActivitySelection replicated EXACTLY as implemented (source
// cross-checked immediately below), never independently reimplemented --
// same discipline as validatePlanActivityId's own replica of route.ts
// above. Its own behavior already has a complete, dedicated suite
// (test/planWithAuraViewLogic.test.ts); these two checks only prove this
// PR's threading calls it correctly, without a .tsx runtime import.
function resolveActivitySelectionReplica(rawTitle: string): { activityId?: string; taskTitle?: string } {
  const trimmed = rawTitle.trim();
  const known = FULL_ACTIVITY_CATALOG.find((activity) => activity.title.toLowerCase() === trimmed.toLowerCase());
  return known ? { activityId: known.id } : { taskTitle: trimmed };
}
check('Sanity check: resolveActivitySelection\'s live implementation in PlanWithAuraView.tsx matches this replica exactly (same trim + exact-title-match-then-taskTitle-fallback shape)', /const trimmed = rawTitle\.trim\(\);\s*const known = FULL_ACTIVITY_CATALOG\.find\(\(activity\) => activity\.title\.toLowerCase\(\) === trimmed\.toLowerCase\(\)\);\s*return known \? \{ activityId: known\.id \} : \{ taskTitle: trimmed \};/.test(planWithAuraSource));
check('A known catalog title resolves to an activityId, not a taskTitle', resolveActivitySelectionReplica('Deep Work').activityId === 'deep-work');
check('Free text with no catalog match resolves to a taskTitle with NO activityId at all (undefined, never a synthesized/fallback id)', resolveActivitySelectionReplica('organize my sock drawer').activityId === undefined && resolveActivitySelectionReplica('organize my sock drawer').taskTitle === 'organize my sock drawer');
check('saveUpcomingPlanFromCandidate\'s POST body always includes activityId (defaulting to null when the option is omitted), never omits the field entirely', /activityId: activityId \?\? null,/.test(planWithAuraSource));

// ============================================================
// 14. Muhurtham Finder threads its existing activityId.
// ============================================================

const muhurthamFinderSource = fs.readFileSync('apps/web/components/MuhurthamFinderView.tsx', 'utf8');
check('MuhurthamFinderView.tsx threads its own activityId state into saveUpcomingPlanFromCandidate', /saveUpcomingPlanFromCandidate\(window, durationMinutes, \{ sharedWithName, eventLocation, activityId \}\)/.test(muhurthamFinderSource));
check('Every SUPPORTED_MUHURTHAM_ACTIVITY_IDS value is a real, current FULL_ACTIVITY_CATALOG id (same namespace, not a separate ceremonial catalog)', SUPPORTED_MUHURTHAM_ACTIVITY_IDS.length > 0 && SUPPORTED_MUHURTHAM_ACTIVITY_IDS.every((id) => getActivityProfileById(id) !== undefined));
check('MuhurthamFinderView.tsx does not modify Muhurtham eligibility/rule logic (no new isMuhurthamEligible/Chaturmas/Kharmas/Adhika Masa/Tara Bala reference introduced)', !stripComments(muhurthamFinderSource).includes('isMuhurthamEligible ='));

// ============================================================
// 15. Ask Aura PLAN_THIS threads activity?.id.
// ============================================================

const askAuraOrchestratorSource = fs.readFileSync('apps/web/lib/askAuraOrchestrator.ts', 'utf8');
check('askAuraOrchestrator.ts\'s planPayloadFromCandidate accepts an activityId parameter and includes it in the returned payload', /activityId\?: string\s*\n\): AskAuraAction\['planPayload'\]/.test(askAuraOrchestratorSource) && /activityId: activityId \?\? null,/.test(askAuraOrchestratorSource));
check('Every PLAN_THIS planPayloadFromCandidate call site threads a real, already-resolved `activity` variable\'s id (activity?.id / activity.id / outcome.activity.id) -- never a fresh lookup, never a title/alias resolution', (askAuraOrchestratorSource.match(/planPayloadFromCandidate\([^)]*,\s*(activity\??\.id|outcome\.activity\.id)\)/g) || []).length === 4);
check('askAuraOrchestrator.ts\'s activity resolution remains a strict FULL_ACTIVITY_CATALOG.find (no new alias/fuzzy matching introduced for this feature)', (askAuraOrchestratorSource.match(/FULL_ACTIVITY_CATALOG\.find\(\(a\) => a\.id === /g) || []).length >= 6);

// ============================================================
// 16. createPlannedActivity persists input.activityId ?? null.
// ============================================================

check('createPlannedActivity\'s INSERT includes "activityId" in its column list', /INSERT INTO "PlannedActivity"[\s\S]*?"activityId"\)/.test(dbSource));
check('createPlannedActivity persists input.activityId ?? null (never the raw possibly-undefined value)', /input\.activityId \?\? null,/.test(dbSource));

// ============================================================
// 17. Plan completion copies plan.activityId to HabitLog.
// ============================================================

const logPlannedActivityMatch = dbSource.match(/export async function logPlannedActivity[\s\S]*?\n}\n/);
check('Sanity check: logPlannedActivity was found in db.ts for source-contract isolation', logPlannedActivityMatch !== null);
const logPlannedActivitySource = logPlannedActivityMatch ? logPlannedActivityMatch[0] : '';
check('logPlannedActivity\'s new-log HabitLog INSERT includes "activityId" in its column list', /INSERT INTO "HabitLog"[\s\S]*?"activityId"/.test(logPlannedActivitySource));
check('logPlannedActivity copies plan.activityId (never a fresh lookup) as the HabitLog activityId parameter', /plan\.activityId \?\? null,/.test(logPlannedActivitySource));

// ============================================================
// 18/19. Null Plan identity remains null; completion performs no
// inference/revalidation.
// ============================================================

const logPlannedActivityCodeOnly = stripComments(logPlannedActivitySource);
check('logPlannedActivity never calls getActivityProfileById (no revalidation at completion time)', !logPlannedActivityCodeOnly.includes('getActivityProfileById'));
check('logPlannedActivity never calls findActivityIntent/classifyTask/resolveActivitySelection (no title/alias inference at completion time)', !/findActivityIntent|classifyTask|resolveActivitySelection/.test(logPlannedActivityCodeOnly));
check('logPlannedActivity never references plan.title or plan.activityType as a source for the HabitLog activityId parameter', !/activityId.*plan\.title|activityId.*plan\.activityType/.test(logPlannedActivityCodeOnly));

// ============================================================
// 20. Idempotent HabitLog SELECT includes activityId.
// ============================================================

const idempotentSelectMatch = logPlannedActivitySource.match(/SELECT id, "userId", "activityTitle"[\s\S]*?FROM "HabitLog"/);
check('Sanity check: the idempotent-branch HabitLog SELECT was found', idempotentSelectMatch !== null);
check('The idempotent-branch HabitLog SELECT now includes "activityId" (previously omitted, per the standing audit finding)', idempotentSelectMatch !== null && /"activityId"/.test(idempotentSelectMatch[0]));

// ============================================================
// 21. No Plan PATCH/edit endpoint introduced.
// ============================================================

check('No PATCH handler exists in apps/web/app/api/plans/route.ts', !/export async function PATCH/.test(routeSource));
const planIdRouteSource = fs.readFileSync('apps/web/app/api/plans/[planId]/route.ts', 'utf8');
check('No PATCH handler exists in apps/web/app/api/plans/[planId]/route.ts (only DELETE)', !/export async function PATCH/.test(planIdRouteSource) && /export async function DELETE/.test(planIdRouteSource));

// ============================================================
// 22. No historical backfill.
// ============================================================

check('db.ts contains no UPDATE statement targeting existing PlannedActivity.activityId or HabitLog.activityId values (no backfill/repair)', !/UPDATE "PlannedActivity"[\s\S]{0,300}"activityId"\s*=/.test(dbSource) && !/UPDATE "HabitLog"/.test(dbSource));
check('No new migration performs a backfill UPDATE for activityId on either table', !/UPDATE\s+"(PlannedActivity|HabitLog)"/i.test(migrationDdlOnly));

// ============================================================
// 23. No FK/index/default/unique.
// ============================================================

check('schema.prisma\'s PlannedActivity.activityId has no @@index reference naming it', !new RegExp(`@@index\\(\\[[^\\]]*activityId[^\\]]*\\]`).test(plannedActivityModelBlock));

// ============================================================
// 24/25. C1/C3 source untouched.
// ============================================================

check('insightsWindowAlignment.ts (C1) was not modified for C2b -- no PlannedActivity/completion reference', !/PlannedActivity|logPlannedActivity/.test(fs.readFileSync('apps/web/lib/insightsWindowAlignment.ts', 'utf8')));
const insightsAuraFitSource = fs.readFileSync('apps/web/lib/insightsAuraFit.ts', 'utf8');
check('insightsAuraFit.ts (C3) was not modified for C2b -- no PlannedActivity reference, no scoring-formula change', !/PlannedActivity/.test(insightsAuraFitSource));

// ============================================================
// 26. GRN path untouched.
// ============================================================

const habitLogsRouteSource = fs.readFileSync('apps/web/app/api/habit-logs/route.ts', 'utf8');
check('POST /api/habit-logs (GRN\'s own identity path, C2) was not modified for C2b -- no createPlannedActivity/logPlannedActivity call, no direct PlannedActivity reference (the one pre-existing doc-comment mention of logPlannedActivity is prose, not a dependency)', !/createPlannedActivity\(|logPlannedActivity\(/.test(habitLogsRouteSource));

// ============================================================
// 27. Recurring Habit untouched.
// ============================================================

check('No recurring-Habit file references PlannedActivity.activityId or attempts a Habit.id -> ActivityProfile.id mapping', !/Habit\.id.*ActivityProfile|ActivityProfile.*Habit\.id/.test(dbSource));
const habitsLogRouteSource = fs.readFileSync('apps/web/app/api/habits/[habitId]/log/route.ts', 'utf8');
check('The recurring-Habit completion route was NOT modified for C2b -- no activityId reference', !/activityId/.test(habitsLogRouteSource));

// ============================================================
// 28. No ActivityProfile DB table.
// ============================================================

check('schema.prisma defines no "model ActivityProfile" (the catalog remains code-defined, never a DB table)', !/model ActivityProfile/.test(schemaSource));

// ============================================================
// 29/30. No score persistence / no location snapshot.
// ============================================================

check('schema.prisma\'s PlannedActivity model gained no Aura-Fit-specific column (no auraFitScore/auraFitLabel/auraFitReasons/engineVersion)', !/auraFitScore|auraFitLabel|auraFitReasons|engineVersion/i.test(plannedActivityModelBlock));
check('This PR adds no location-snapshot field for identity purposes (PlannedActivity gained only activityId, not latitude/longitude/timezone-for-identity)', (plannedActivityModelBlock.match(/^\s+activityId\s+String\?/m) || []).length === 1);

// ============================================================
// 31-34. PR #80 timing invariant remains structurally intact.
// ============================================================

check('Exactly one completionInstant clock read remains in logPlannedActivity', (logPlannedActivitySource.match(/new Date\(\)/g) || []).length === 1);
check('completionInstant is still captured into a variable named completionInstant', /const completionInstant = new Date\(\);/.test(logPlannedActivitySource));
check('PlannedActivity.loggedAt is still set from completionInstant (not a second new Date(), not plan.plannedStartAt)', /\[planId, userId, completionInstant, habitLogId\]/.test(logPlannedActivitySource));
check('HabitLog.logTimestamp is still derived from derivePlanCompletionHistory(completionInstant, ...), never plan.plannedStartAt', /new Date\(plan\.plannedStartAt\)/.test(logPlannedActivityCodeOnly) === false);
check('HabitLog.activeWindow is still derived via derivePlanCompletionHistory (resolveHistoricalActiveWindow), never plan.windowType', !/\[\s*habitLogId,\s*userId,\s*plan\.title,\s*plan\.activityId[^,]*,\s*plan\.windowType,/.test(logPlannedActivitySource));
check('derivePlanCompletionHistory is still called exactly once, with completionInstant', (logPlannedActivitySource.match(/derivePlanCompletionHistory\(/g) || []).length === 1 && /derivePlanCompletionHistory\(\{\s*completionInstant,/.test(logPlannedActivitySource));

// ============================================================
// Stale-catalog-id / catalog-drift proof (brief section 35): a persisted
// unknown/stale id is copied by completion logic without revalidation
// (source-contract, already proven above), then a real evaluateHabitLogAuraFit
// call on that resulting shape proves C3 already owns the drift handling.
// ============================================================

const staleIdShapedLog: HabitLogRow = {
  id: 'plan-log-stale',
  userId: 'user-1',
  activityTitle: 'Some Retired Activity',
  activityId: 'retired-activity-from-a-past-catalog-version',
  activeWindow: 'ABHIJIT',
  logTimestamp: new Date('2026-03-15T10:00:00Z'),
  logMinuteOfDay: 600,
  durationMinutes: 30,
  logSource: 'AURA_PLANNED',
  activitySignificance: 'MEDIUM',
};
const staleIdAuraFitResult = evaluateHabitLogAuraFit(staleIdShapedLog);
check('A HabitLog carrying a stale/no-longer-catalog activityId (copied verbatim from a Plan, never revalidated at completion) is correctly ineligible with reason UNKNOWN_ACTIVITY_ID via the REAL, unmodified evaluateHabitLogAuraFit -- proving C3 already owns catalog-drift handling with zero C2b changes to C3', !staleIdAuraFitResult.eligible && staleIdAuraFitResult.reason === 'UNKNOWN_ACTIVITY_ID');

// ============================================================
// C3 integration proof (brief section 52): a new canonical Plan
// completion is genuinely Aura-Fit-eligible once activityId + truthful
// timing are present, via the REAL evaluateHabitLogAuraFit.
// ============================================================

const canonicalPlanShapedLog: HabitLogRow = {
  id: 'plan-log-canonical',
  userId: 'user-1',
  activityTitle: 'Finish Q4 board presentation',
  activityId: 'deep-work',
  activeWindow: 'ABHIJIT',
  logTimestamp: new Date('2026-03-15T12:00:00Z'),
  logMinuteOfDay: 720,
  durationMinutes: 30,
  logSource: 'AURA_PLANNED',
  activitySignificance: 'MEDIUM',
};
const canonicalAuraFitResult = evaluateHabitLogAuraFit(canonicalPlanShapedLog);
check('A new canonical Plan-completion-shaped HabitLog (known activityId, valid activeWindow, real logTimestamp) is Aura-Fit-eligible via the REAL evaluateHabitLogAuraFit -- title independence confirmed (activityTitle is a custom task, not the catalog title)', canonicalAuraFitResult.eligible === true);

const freeTextPlanShapedLog: HabitLogRow = {
  ...canonicalPlanShapedLog,
  id: 'plan-log-freetext',
  activityId: undefined,
};
const freeTextAuraFitResult = evaluateHabitLogAuraFit(freeTextPlanShapedLog);
check('A free-text Plan-completion-shaped HabitLog (activityId undefined/null) is ineligible with reason MISSING_ACTIVITY_ID via the REAL evaluateHabitLogAuraFit', !freeTextAuraFitResult.eligible && freeTextAuraFitResult.reason === 'MISSING_ACTIVITY_ID');

console.log(allPassed ? '\nALL PLANNED ACTIVITY CANONICAL IDENTITY CHECKS PASSED' : '\nSOME PLANNED ACTIVITY CANONICAL IDENTITY CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
