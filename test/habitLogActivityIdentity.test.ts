/**
 * Prospective Canonical Activity Identity V1 (PR C2): regression suite for
 * the new HabitLog.activityId column, its catalog validation, and its one
 * approved write path (Home Good Right Now).
 *
 * A live database is unavailable in this environment (DATABASE_URL
 * unset), so the route's server-side validation logic is replicated here
 * EXACTLY as implemented (never reimplemented independently) and
 * cross-checked against the live source, matching this repo's established
 * pattern (see test/insightsAlignmentComparison.test.ts,
 * test/backdatedActivityLogging.test.ts). A companion DB-gated round-trip
 * test exists separately (test/habitLogActivityIdentityDb.test.ts).
 */
import * as fs from 'fs';
import { getActivityProfileById, FULL_ACTIVITY_CATALOG, findActivityIntent } from '../packages/recommendation/src/personalizedTasks';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// getActivityProfileById -- exact-match-only catalog lookup.
// ============================================================

const deepWork = getActivityProfileById('deep-work');
check('getActivityProfileById("deep-work") returns the exact canonical ActivityProfile', deepWork !== undefined && deepWork.id === 'deep-work' && deepWork.title === 'Deep Work');

check('getActivityProfileById(unknown id) returns undefined', getActivityProfileById('not-a-real-activity') === undefined);
check('getActivityProfileById("") returns undefined', getActivityProfileById('') === undefined);

// Must NOT match by title, alias, or fuzzy/substring -- exact id only.
check('getActivityProfileById does not match by title ("Deep Work", the display title, is not a valid id)', getActivityProfileById('Deep Work') === undefined);
check('getActivityProfileById does not match by alias ("deep work", a real alias of deep-work per personalizedTasks.ts) -- exact id only, not alias text', getActivityProfileById('deep work') === undefined);
check('getActivityProfileById does not fuzzy/substring match ("deep" is a substring of "deep-work" but not equal to it)', getActivityProfileById('deep') === undefined);

// Contrast with findActivityIntent, which DOES do alias/substring matching
// -- confirms the two lookups are genuinely different, not a renamed
// duplicate of one another.
check('findActivityIntent (the pre-existing alias lookup) DOES match "deep work" by alias -- confirming getActivityProfileById is a deliberately different, stricter lookup', findActivityIntent('deep work')?.id === 'deep-work');

// ============================================================
// Catalog uniqueness -- turns the persistence invariant into a regression
// guard (brief section 29): if this ever fails, activityId round-trips
// could silently resolve to the wrong ActivityProfile.
// ============================================================

const allIds = FULL_ACTIVITY_CATALOG.map((a) => a.id);
const uniqueIds = new Set(allIds);
check(`All ${allIds.length} FULL_ACTIVITY_CATALOG activity ids are unique (no duplicates)`, uniqueIds.size === allIds.length);
check('FULL_ACTIVITY_CATALOG is non-empty (sanity check the catalog itself loaded)', allIds.length > 0);

// ============================================================
// Server-side validation logic -- exact replica of
// apps/web/app/api/habit-logs/route.ts's activityId handling.
// ============================================================

function validateActivityId(activityId: unknown): { ok: true; validatedActivityId: string | null } | { ok: false; status: number; error: string } {
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

// Valid ID.
const validResult = validateActivityId('deep-work');
check('A valid catalog id passes validation and resolves to the canonical id', validResult.ok === true && validResult.ok && validResult.validatedActivityId === 'deep-work');

// Invalid ID.
const invalidResult = validateActivityId('not-a-real-activity');
check('An unknown id is rejected (not ok), never silently nullified or passed through', invalidResult.ok === false);
check('An unknown id rejection uses HTTP 400', invalidResult.ok === false && !invalidResult.ok && invalidResult.status === 400);
check('An unknown id rejection never reaches "validatedActivityId" at all (the reject branch has no such field)', invalidResult.ok === false && !('validatedActivityId' in invalidResult));

// Omitted/null/empty ID -- persists NULL, remains a fully valid request.
check('Omitted activityId (undefined) is valid and resolves to null', validateActivityId(undefined).ok === true && (validateActivityId(undefined) as { validatedActivityId: string | null }).validatedActivityId === null);
check('null activityId is valid and resolves to null', validateActivityId(null).ok === true && (validateActivityId(null) as { validatedActivityId: string | null }).validatedActivityId === null);
check('Empty-string activityId is valid and resolves to null (not rejected as "unknown")', validateActivityId('').ok === true && (validateActivityId('') as { validatedActivityId: string | null }).validatedActivityId === null);
check('Whitespace-only activityId is valid and resolves to null', validateActivityId('   ').ok === true && (validateActivityId('   ') as { validatedActivityId: string | null }).validatedActivityId === null);

// ============================================================
// Title mismatch -- a valid canonical id never requires activityTitle to
// equal the catalog's own title. Both are stored exactly as submitted.
// ============================================================

const cardStyleTitle = 'Distraction-free planning block'; // brahma-focus card's own title, != catalog title "Deep Work"
const titleMismatchResult = validateActivityId('deep-work');
check('A valid canonical id ("deep-work") is accepted regardless of what activityTitle the request also carries -- validation never inspects/compares title at all', titleMismatchResult.ok === true && titleMismatchResult.ok && titleMismatchResult.validatedActivityId === 'deep-work');
check('The card-style display title and the catalog title are genuinely different strings, confirming this is a real mismatch case, not a coincidental match', cardStyleTitle !== (getActivityProfileById('deep-work')?.title ?? ''));

// ============================================================
// logSource / activitySignificance independence -- neither can create or
// influence activityId; the validation function structurally cannot even
// see them.
// ============================================================

check('validateActivityId takes exactly 1 parameter (activityId only) -- structurally cannot read logSource or activitySignificance', validateActivityId.length === 1);

// ============================================================
// Source-scan cross-checks against the live implementation.
// ============================================================

const catalogSource = fs.readFileSync('packages/recommendation/src/personalizedTasks.ts', 'utf8');
check('getActivityProfileById is exported from personalizedTasks.ts', /export function getActivityProfileById\(id: string\): ActivityProfile \| undefined/.test(catalogSource));
check('getActivityProfileById uses FULL_ACTIVITY_CATALOG.find with exact id equality, no alias/title reference', /FULL_ACTIVITY_CATALOG\.find\(\(activity\) => activity\.id === id\)/.test(catalogSource));

const routeSource = fs.readFileSync('apps/web/app/api/habit-logs/route.ts', 'utf8');
check('POST /api/habit-logs imports getActivityProfileById from the catalog module', /import \{ getActivityProfileById \} from '\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/packages\/recommendation\/src\/personalizedTasks'/.test(routeSource));
check('POST /api/habit-logs rejects an unknown activityId with HTTP 400 "Unknown activity."', /error: 'Unknown activity\.'\s*\}, \{ status: 400 \}/.test(routeSource));
check('POST /api/habit-logs persists only the VALIDATED activity.id (activity.id), never the raw client-submitted string', /validatedActivityId = activity\.id;/.test(routeSource));
check('POST /api/habit-logs never requires/compares activityTitle against the resolved activity\'s own title', !/activity\.title\s*===?\s*(clean)?[Tt]itle/.test(routeSource));
check('createHabitLog is called with activityId: validatedActivityId', /activityId: validatedActivityId,/.test(routeSource));

const dbSource = fs.readFileSync('apps/web/lib/db.ts', 'utf8');
check('createHabitLog does NOT perform its own catalog lookup/validation (no getActivityProfileById/FULL_ACTIVITY_CATALOG reference inside db.ts)', !/getActivityProfileById|FULL_ACTIVITY_CATALOG/.test(dbSource));
check('createHabitLog\'s INSERT column list includes "activityId"', /INSERT INTO "HabitLog" \(id, "userId", "activityTitle", "activityId",/.test(dbSource));

// ============================================================
// Good Right Now propagation -- card.activityId (never card.id) threads
// through HomeDashboard -> page.tsx -> the POST body.
// ============================================================

const homeDashboardSource = fs.readFileSync('apps/web/components/HomeDashboard.tsx', 'utf8');
check('HomeDashboard.tsx\'s onLogActivity type gained an activityId parameter', /activityId\?: string\s*\)\s*=> Promise<void>/.test(homeDashboardSource));
check('HomeDashboard.tsx passes card.activityId (not card.id) into onLogActivity at the logging call site', /onLogActivity\(planTitle,[\s\S]{0,200}card\.activityId\)/.test(homeDashboardSource));
check('HomeDashboard.tsx never passes card.id as the activityId argument', !/onLogActivity\([^)]*,\s*card\.id\)/.test(homeDashboardSource));

const pageSource = fs.readFileSync('apps/web/app/page.tsx', 'utf8');
check('page.tsx\'s handleLogActivity signature gained an activityId parameter', /activityId\?: string\s*\)\s*=>/.test(pageSource));
// Strip // comment lines before matching -- the payload's own doc comment
// legitimately mentions "activityId" in prose several times before the
// real `activityId,` object-literal field line.
const pageSourceNoLineComments = pageSource.replace(/^\s*\/\/.*$/gm, '');
check('page.tsx\'s POST payload includes activityId, sourced only from the propagated parameter (not re-derived)', /const payload = \{[\s\S]{0,200}activityId,/.test(pageSourceNoLineComments));

// ============================================================
// Card without canonical id -- one of the two curated cards
// (abhijit-meal, yama-lightmeal) that intentionally has no activityId.
// Confirm neither this card definition nor any card-handling code
// fabricates one.
// ============================================================

const actionCardsSource = fs.readFileSync('packages/recommendation/src/actionCards.ts', 'utf8');
const abhijitMealBlock = actionCardsSource.slice(actionCardsSource.indexOf("id: 'abhijit-meal'"), actionCardsSource.indexOf("id: 'abhijit-meal'") + 600);
check('The abhijit-meal curated card (no catalog counterpart) has no activityId field in its own definition', !/activityId:/.test(abhijitMealBlock));
check('The abhijit-meal card uses immediateAction: \'LOG_NOW\' instead of a fabricated activityId', /immediateAction: 'LOG_NOW'/.test(abhijitMealBlock));

// ============================================================
// Manual / Past Activity logging never sets activityId -- no title/alias
// inference of any kind.
// ============================================================

const pastActivityModalSource = fs.readFileSync('apps/web/components/PastActivityModal.tsx', 'utf8');
check('PastActivityModal.tsx (manual/free-text logging) was not modified for C2 -- contains no activityId reference at all', !/activityId/.test(pastActivityModalSource));
check('PastActivityModal.tsx never calls findActivityIntent/classifyTask/getActivityProfileById to infer identity from typed text', !/findActivityIntent|classifyTask|getActivityProfileById/.test(pastActivityModalSource));

// ============================================================
// habitId / activityId separation -- the recurring-Habit concept must
// never leak into canonical activity identity.
// ============================================================

check('habit-logs route source never assigns habitId to activityId or vice versa', !/activityId:\s*.*habitId|habitId:\s*.*activityId/.test(routeSource));
const habitsLogRouteSource = fs.readFileSync('apps/web/app/api/habits/[habitId]/log/route.ts', 'utf8');
check('The recurring-Habit completion route (apps/web/app/api/habits/[habitId]/log/route.ts) was NOT modified for C2 -- no activityId reference', !/activityId/.test(habitsLogRouteSource));

// ============================================================
// Non-goal isolation -- C1 Insights files and every other explicitly
// out-of-scope area remain untouched.
// ============================================================

const insightsViewSource = fs.readFileSync('apps/web/components/InsightsView.tsx', 'utf8');
check('InsightsView.tsx contains no reference to HabitLog.activityId (Insights isolation, C1 remains the active calculation)', !/\bactivityId\b/.test(insightsViewSource));

const insightsRouteSource = fs.readFileSync('apps/web/app/api/daily-assistant/insights/route.ts', 'utf8');
check('The insights route contains no reference to activityId', !/\bactivityId\b/.test(insightsRouteSource));

const insightsWindowAlignmentSource = fs.readFileSync('apps/web/lib/insightsWindowAlignment.ts', 'utf8');
check('insightsWindowAlignment.ts (C1) was not modified for C2 -- no activityId reference', !/activityId/.test(insightsWindowAlignmentSource));

check('No evaluateActivityFit/evaluatePersonalMuhurtaFit reference anywhere in the touched route', !/evaluateActivityFit|evaluatePersonalMuhurtaFit/.test(routeSource));

// ============================================================
// Migration -- additive only.
// ============================================================

const migrationSource = fs.readFileSync('apps/web/prisma/migrations/0030_habit_log_activity_id/migration.sql', 'utf8');
// Strip SQL comment lines ("-- ...") before scanning for actual DDL
// keywords -- the migration's own explanatory prose legitimately says
// things like "no foreign key" (a negation), which must not be mistaken
// for real FOREIGN KEY/REFERENCES syntax.
const migrationDdlOnly = migrationSource.replace(/^--.*$/gm, '');
check('Migration adds activityId via a plain nullable ALTER TABLE ADD COLUMN', /ALTER TABLE "HabitLog" ADD COLUMN "activityId" TEXT;/.test(migrationDdlOnly));
check('Migration has no DEFAULT clause for activityId', !/activityId[^;]*DEFAULT/i.test(migrationDdlOnly));
check('Migration has no NOT NULL clause for activityId', !/activityId[^;]*NOT NULL/i.test(migrationDdlOnly));
check('Migration contains no UPDATE/backfill statement', !/\bUPDATE\b/i.test(migrationDdlOnly));
check('Migration contains no CREATE INDEX statement', !/CREATE INDEX/i.test(migrationDdlOnly));
check('Migration contains no UNIQUE constraint', !/UNIQUE/i.test(migrationDdlOnly));
check('Migration contains no FOREIGN KEY/REFERENCES clause', !/FOREIGN KEY|REFERENCES/i.test(migrationDdlOnly));
check('Migration touches only the HabitLog table', !/ALTER TABLE "(?!HabitLog)/.test(migrationDdlOnly));

const schemaSource = fs.readFileSync('apps/web/prisma/schema.prisma', 'utf8');
const habitLogModelBlock = schemaSource.slice(schemaSource.indexOf('model HabitLog {'), schemaSource.indexOf('model HabitLog {') + 1200);
check('schema.prisma declares HabitLog.activityId as nullable (String?, no @default, no @unique)', /activityId\s+String\?/.test(habitLogModelBlock) && !/activityId[^\n]*@default/.test(habitLogModelBlock) && !/activityId[^\n]*@unique/.test(habitLogModelBlock));
check('schema.prisma\'s HabitLog.activityId has no @relation (plain string, not a foreign key)', !/activityId[^\n]*@relation/.test(habitLogModelBlock));
check('habitId (the separate recurring-Habit FK) remains completely unmodified in schema.prisma', /habitId\s+String\?/.test(habitLogModelBlock) && /habit\s+Habit\?\s+@relation/.test(habitLogModelBlock));

console.log(allPassed ? '\nALL HABITLOG ACTIVITY IDENTITY CHECKS PASSED' : '\nSOME HABITLOG ACTIVITY IDENTITY CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
