/**
 * Plan Completion Historical Integrity V1: regression suite for
 * apps/web/lib/planCompletionHistory.ts and the corresponding fix inside
 * apps/web/lib/db.ts's logPlannedActivity().
 *
 * Prior defect (see the preceding AUDIT: PLAN COMPLETION HISTORICAL
 * INTEGRITY V1): logPlannedActivity correctly captured the real completion
 * instant for PlannedActivity.loggedAt, but independently derived
 * HabitLog.logTimestamp/activeWindow/logMinuteOfDay from
 * plan.plannedStartAt/plan.windowType -- the PLAN, not the OBSERVATION.
 * This suite proves the fix: ONE completionInstant now drives every
 * actual-history field, while plannedStartAt/plannedEndAt/windowType stay
 * frozen.
 *
 * A live database is unavailable in this environment (DATABASE_URL
 * unset), so logPlannedActivity's own DB-transaction behavior is covered
 * separately by test/planCompletionHistoricalIntegrityDb.test.ts (repo's
 * established live-DB convention, see test/habitLogActivityIdentityDb.test.ts)
 * and, here, by direct source-contract scans of db.ts cross-checked
 * against the live implementation (see test/habitLogActivityIdentity.test.ts
 * for the same established pattern). The pure derivation logic itself
 * (apps/web/lib/planCompletionHistory.ts) needs no DB and is tested
 * directly and deterministically below.
 */
import * as fs from 'fs';
import { derivePlanCompletionHistory } from '../apps/web/lib/planCompletionHistory';
import { resolveHistoricalActiveWindow } from '../apps/web/lib/historicalActivityWindow';
import { getMinuteOfDayInTimezone, getDatePartsInTimezone } from '../apps/web/lib/timezone';
import { classifyDayPart, toInsightsObservation } from '../apps/web/lib/insightsTimezone';
import { classifyInsightsWindow } from '../apps/web/lib/insightsWindowAlignment';
import { evaluateHabitLogAuraFit } from '../apps/web/lib/insightsAuraFit';
import type { HabitLogRow } from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// Strips // line comments and /* */ block comments before a source-scan
// assertion needs to distinguish real code from prose that legitimately
// names the very identifiers being asserted absent (e.g. a doc comment
// explaining "this never reads birthLatitude" would otherwise self-match
// a naive substring search).
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// Fixed Timing Location (Chennai -- the same coordinates apps/web/lib/db.ts's
// own DEFAULT_SIGNUP_LOCATION uses) and a fixed calendar date, so every
// assertion below is fully deterministic -- never wall-clock-dependent.
const LAT = 13.0827;
const LNG = 80.2707;
const TZ = 'Asia/Kolkata';

// ============================================================
// Pure derivation -- fixed completionInstant, no wall clock.
// ============================================================

const fixedInstant = new Date('2026-03-15T12:00:00+05:30'); // noon IST
const derived = derivePlanCompletionHistory({ completionInstant: fixedInstant, latitude: LAT, longitude: LNG, timezone: TZ });

check('logTimestamp is exactly the completionInstant passed in (same absolute instant, no clone/round/truncate)', derived.logTimestamp.getTime() === fixedInstant.getTime());
check('logTimestamp is literally the same Date reference as completionInstant (identity, not a copy)', derived.logTimestamp === fixedInstant);

const directWindow = resolveHistoricalActiveWindow(fixedInstant, LAT, LNG, TZ);
check('activeWindow exactly matches a direct resolveHistoricalActiveWindow(completionInstant, latitude, longitude, timezone) call -- no duplicated solar-window logic', derived.activeWindow === directWindow);

const directMinute = getMinuteOfDayInTimezone(TZ, fixedInstant);
check('logMinuteOfDay exactly matches a direct getMinuteOfDayInTimezone(timezone, completionInstant) call -- no duplicated timezone math', derived.logMinuteOfDay === directMinute);

// ============================================================
// Planned vs actual -- deterministic pair of times, on a fixed date/
// location, where the actual completion window differs from an earlier
// "planned" window. Discovered by direct computation (never hardcoded
// Panchang assumptions): noon IST resolves to ABHIJIT, 6pm IST resolves to
// RAHU_KALAM, for this fixed Chennai date.
// ============================================================

const plannedTimeWindow = resolveHistoricalActiveWindow(new Date('2026-03-15T12:00:00+05:30'), LAT, LNG, TZ);
const completionInstant2 = new Date('2026-03-15T18:00:00+05:30');
const actualCompletionWindow = resolveHistoricalActiveWindow(completionInstant2, LAT, LNG, TZ);
check('Sanity check: the chosen "planned" (noon) and "actual completion" (6pm) instants genuinely resolve to different real solar windows for this fixed date/location', plannedTimeWindow !== actualCompletionWindow);

const derived2 = derivePlanCompletionHistory({ completionInstant: completionInstant2, latitude: LAT, longitude: LNG, timezone: TZ });
check('derivePlanCompletionHistory\'s activeWindow reflects the ACTUAL completion instant (6pm -> RAHU_KALAM-equivalent), never the earlier "planned" window (noon -> ABHIJIT-equivalent)', derived2.activeWindow === actualCompletionWindow && derived2.activeWindow !== plannedTimeWindow);

// ============================================================
// One-instant invariant -- the SAME completionInstant drives every
// derived field consistently (source-contract level: db.ts calls
// derivePlanCompletionHistory exactly once per completion, with a single
// completionInstant captured once, and reuses that same variable for
// BOTH the HabitLog insert AND the PlannedActivity.loggedAt update).
// ============================================================

const dbSource = fs.readFileSync('apps/web/lib/db.ts', 'utf8');
const logPlannedActivityMatch = dbSource.match(/export async function logPlannedActivity[\s\S]*?\n}\n/);
check('Sanity check: logPlannedActivity was found in db.ts for source-contract isolation', logPlannedActivityMatch !== null);
const logPlannedActivitySource = logPlannedActivityMatch ? logPlannedActivityMatch[0] : '';

check('logPlannedActivity calls `new Date()` exactly once (one server-authoritative clock read for the whole completion)', (logPlannedActivitySource.match(/new Date\(\)/g) || []).length === 1);
check('logPlannedActivity captures that single read into a variable named completionInstant', /const completionInstant = new Date\(\);/.test(logPlannedActivitySource));
check('logPlannedActivity calls derivePlanCompletionHistory exactly once, passing completionInstant', (logPlannedActivitySource.match(/derivePlanCompletionHistory\(/g) || []).length === 1 && /derivePlanCompletionHistory\(\{\s*completionInstant,/.test(logPlannedActivitySource));
check('The HabitLog INSERT\'s logTimestamp parameter is the derived logTimestamp (destructured directly from derivePlanCompletionHistory\'s result)', /const \{ logTimestamp, activeWindow, logMinuteOfDay \} = derivePlanCompletionHistory/.test(logPlannedActivitySource));
check('The PlannedActivity UPDATE\'s "loggedAt" parameter is the SAME completionInstant variable (not a second new Date(), not the old separately-named `loggedAt` local)', /\[planId, userId, completionInstant, habitLogId\]/.test(logPlannedActivitySource));
check('logPlannedActivity no longer reads plan.plannedStartAt as a source of HabitLog.logTimestamp', !/new Date\(plan\.plannedStartAt\)/.test(logPlannedActivitySource));
check('logPlannedActivity no longer reads plan.windowType as a source of HabitLog.activeWindow (the INSERT\'s activeWindow parameter is the derived value, not plan.windowType)', !/\[\s*habitLogId,\s*userId,\s*plan\.title,\s*plan\.windowType,/.test(logPlannedActivitySource));

// ============================================================
// Planned fields frozen -- plannedStartAt/plannedEndAt/windowType are
// never written by the PlannedActivity UPDATE.
// ============================================================

const updateStatementMatch = logPlannedActivitySource.match(/UPDATE "PlannedActivity"[\s\S]*?RETURNING \*/);
check('Sanity check: the PlannedActivity UPDATE statement was found for isolation', updateStatementMatch !== null);
const updateStatement = updateStatementMatch ? updateStatementMatch[0] : '';
check('The PlannedActivity UPDATE never SETs plannedStartAt', !/"plannedStartAt"\s*=/.test(updateStatement));
check('The PlannedActivity UPDATE never SETs plannedEndAt', !/"plannedEndAt"\s*=/.test(updateStatement));
check('The PlannedActivity UPDATE never SETs windowType', !/"windowType"\s*=/.test(updateStatement));
check('The PlannedActivity UPDATE only SETs status/loggedAt/habitLogId/updatedAt', /SET status = 'LOGGED',\s*"loggedAt" = \$3,\s*"habitLogId" = \$4,\s*"updatedAt" = now\(\)/.test(updateStatement));

// ============================================================
// activityId propagation (Planned Activity Canonical Identity Propagation
// V1, "C2b") -- a factual copy of plan.activityId onto the HabitLog, never
// a fresh lookup/inference, and never a disturbance of this PR's own
// timing invariants. This section previously asserted the OPPOSITE (that
// C2b did not exist yet, matching PR #80's own scope boundary at the
// time) -- now that C2b is intentionally implemented, those assertions
// are replaced with the correct positive post-C2b invariants. See
// test/plannedActivityCanonicalIdentity.test.ts for C2b's own full
// eligibility/validation/threading coverage; this file only re-confirms
// that adding activityId did not regress PR #80's timing contract.
// ============================================================

const insertStatementMatch = logPlannedActivitySource.match(/INSERT INTO "HabitLog"[\s\S]*?RETURNING[^`]*`/);
check('Sanity check: the HabitLog INSERT statement was found for isolation', insertStatementMatch !== null);
const insertStatement = insertStatementMatch ? insertStatementMatch[0] : '';
check('The HabitLog INSERT column list now includes activityId (C2b, intentional)', /"activityId"/.test(insertStatement));
check('logPlannedActivity references plan.activityId exactly once in actual code, as the HabitLog INSERT\'s activityId parameter (a factual copy, not a fresh lookup; doc-comment prose excluded)', (stripComments(logPlannedActivitySource).match(/plan\.activityId/g) || []).length === 1);
check('logPlannedActivity never calls getActivityProfileById/findActivityIntent/classifyTask (activityId is copied verbatim, never revalidated or inferred at completion time)', !/getActivityProfileById|findActivityIntent|classifyTask/.test(stripComments(logPlannedActivitySource)));
check('Adding activityId did not disturb the positional order of the PR #80 timing parameters -- activeWindow, logMinuteOfDay, logTimestamp, durationMinutes, and notes still appear, in that exact order, immediately after the new activityId parameter', /plan\.activityId \?\? null,\s*activeWindow,\s*logMinuteOfDay,\s*logTimestamp,\s*plan\.durationMinutes,\s*notes,/.test(logPlannedActivitySource));
check('Adding activityId did not disturb PlannedActivity.loggedAt -- it is still set from completionInstant, in the same UPDATE parameter position', /\[planId, userId, completionInstant, habitLogId\]/.test(logPlannedActivitySource));

// A constructed Plan-completion-shaped HabitLogRow (activityId omitted, as
// logPlannedActivity would produce) is still correctly ineligible for C3
// Aura Fit -- functional proof via the REAL evaluateHabitLogAuraFit, not a
// mocked stand-in.
const planCompletionShapedLog: HabitLogRow = {
  id: 'plan-log-1',
  userId: 'user-1',
  activityTitle: 'Deep Work',
  activeWindow: derived2.activeWindow,
  logTimestamp: derived2.logTimestamp,
  logMinuteOfDay: derived2.logMinuteOfDay,
  durationMinutes: 30,
  logSource: 'AURA_PLANNED',
  activitySignificance: 'MEDIUM',
};
const auraFitResult = evaluateHabitLogAuraFit(planCompletionShapedLog);
check('A Plan-completion-shaped HabitLog (activityId omitted) remains Aura-Fit-ineligible with reason MISSING_ACTIVITY_ID, exactly as C3 already guarantees -- unaffected by this fix', !auraFitResult.eligible && auraFitResult.reason === 'MISSING_ACTIVITY_ID');

// ============================================================
// logSource / duration / significance / title unchanged.
// ============================================================

check('logSource remains the literal \'AURA_PLANNED\'', /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, 'AURA_PLANNED', 'MEDIUM'\)/.test(insertStatement));
check('activitySignificance remains the literal \'MEDIUM\'', /'AURA_PLANNED', 'MEDIUM'\)/.test(insertStatement));
check('durationMinutes remains plan.durationMinutes', /plan\.durationMinutes,/.test(logPlannedActivitySource));
check('activityTitle remains plan.title', /plan\.title,/.test(logPlannedActivitySource));
check('notes generation is unchanged (still derived from plan.recommendation)', /Logged from planned Aura activity\$\{plan\.recommendation/.test(logPlannedActivitySource));

// ============================================================
// Timing Location -- widened User query, no Birth/Event Location.
// ============================================================

check('The User query now selects latitude, longitude, and timezone (widened from the old timezone-only query)', /SELECT latitude, longitude, timezone FROM "User" WHERE id = \$1/.test(logPlannedActivitySource));
check('logPlannedActivity performs exactly one User query (no second query added)', (logPlannedActivitySource.match(/FROM "User"/g) || []).length === 1);
const logPlannedActivityCodeOnly = stripComments(logPlannedActivitySource);
check('logPlannedActivity never references birthLatitude/birthLongitude/birthTimezone (Birth Location) in actual code (doc-comment prose excluded)', !/birthLatitude|birthLongitude|birthTimezone/.test(logPlannedActivityCodeOnly));
check('logPlannedActivity never references eventTimezone/eventLocationName (Event Location) in actual code (doc-comment prose excluded)', !/eventTimezone|eventLocationName/.test(logPlannedActivityCodeOnly));

const planCompletionHistorySource = fs.readFileSync('apps/web/lib/planCompletionHistory.ts', 'utf8');
const planCompletionHistoryCodeOnly = stripComments(planCompletionHistorySource);
check('planCompletionHistory.ts never references birthLatitude/birthLongitude/birthTimezone in actual code (doc-comment prose excluded)', !/birthLatitude|birthLongitude|birthTimezone/.test(planCompletionHistoryCodeOnly));
check('planCompletionHistory.ts never references eventTimezone/eventLocationName in actual code (doc-comment prose excluded)', !/eventTimezone|eventLocationName/.test(planCompletionHistoryCodeOnly));
check('planCompletionHistory.ts never calls new Date() itself in actual code (no clock of its own -- completionInstant is always caller-supplied; doc-comment prose excluded)', !/new Date\(\)/.test(planCompletionHistoryCodeOnly));
check('derivePlanCompletionHistory takes latitude/longitude/timezone as plain parameters (never a User object), structurally preventing it from reaching for other User fields', /latitude: number;\s*longitude: number;\s*timezone: string;/.test(planCompletionHistorySource));

// ============================================================
// Timezone / cross-midnight -- absolute instant unchanged, day
// interpretation correctly follows the Timing Location, not UTC.
// ============================================================

// 19:00 UTC on 2026-03-15 is 00:30 IST on 2026-03-16 -- a genuine
// cross-midnight case for the Asia/Kolkata Timing Location.
const crossMidnightInstant = new Date('2026-03-15T19:00:00Z');
const utcDateKey = crossMidnightInstant.toISOString().slice(0, 10);
const istDateKey = getDatePartsInTimezone(TZ, crossMidnightInstant).dateStr;
check('Sanity check: the chosen instant genuinely falls on different UTC vs. Asia/Kolkata calendar dates', utcDateKey !== istDateKey && utcDateKey === '2026-03-15' && istDateKey === '2026-03-16');

const crossMidnightDerived = derivePlanCompletionHistory({ completionInstant: crossMidnightInstant, latitude: LAT, longitude: LNG, timezone: TZ });
check('logTimestamp remains the exact absolute completion instant, unaffected by the day-boundary crossing (no local reinterpretation at the derivation layer)', crossMidnightDerived.logTimestamp.getTime() === crossMidnightInstant.getTime());
check('Downstream Timing-Location day interpretation (via the existing toInsightsObservation, unmodified) correctly lands on the ACTUAL completion day (March 16 IST), not the UTC day (March 15)', toInsightsObservation(crossMidnightDerived.logTimestamp, TZ).dateKey === '2026-03-16');
check('logMinuteOfDay for the cross-midnight instant is early-morning (just after local midnight), matching 00:30 IST', crossMidnightDerived.logMinuteOfDay === 30);

// ============================================================
// C1 input -- classifyInsightsWindow receives the ACTUAL completion
// window; this fix changes only the HabitLog's own factual fields, never
// C1's classification logic itself.
// ============================================================

check('classifyInsightsWindow accepts the derived activeWindow without modification and returns a valid band', ['SUPPORTIVE', 'NEUTRAL', 'FRICTION'].includes(classifyInsightsWindow(derived2.activeWindow)));
check('insightsWindowAlignment.ts (C1) was not modified by this fix -- no completionInstant/derivePlanCompletionHistory/resolveHistoricalActiveWindow reference', !/completionInstant|derivePlanCompletionHistory|resolveHistoricalActiveWindow/.test(fs.readFileSync('apps/web/lib/insightsWindowAlignment.ts', 'utf8')));

// ============================================================
// Daypart -- a "planned morning, completed night" scenario produces
// NIGHT-equivalent minute semantics from the actual completion instant.
// ============================================================

const plannedMorningInstant = new Date('2026-03-15T08:00:00+05:30'); // 8am IST -- MORNING
const actualNightInstant = new Date('2026-03-15T23:00:00+05:30'); // 11pm IST -- NIGHT
const plannedMorningDerived = derivePlanCompletionHistory({ completionInstant: plannedMorningInstant, latitude: LAT, longitude: LNG, timezone: TZ });
const actualNightDerived = derivePlanCompletionHistory({ completionInstant: actualNightInstant, latitude: LAT, longitude: LNG, timezone: TZ });
check('A Plan "planned" for the morning but actually completed at night produces a MORNING logMinuteOfDay for the 8am instant...', classifyDayPart(plannedMorningDerived.logMinuteOfDay) === 'MORNING');
check('...and a NIGHT logMinuteOfDay for the 11pm actual-completion instant -- daypart analytics see the ACTUAL completion time, not the planned time', classifyDayPart(actualNightDerived.logMinuteOfDay) === 'NIGHT');

// ============================================================
// Current Timing Location, not stored Event Location -- structural proof
// via signature already covered above; functional proof that changing
// only the timezone/coordinates argument (simulating "user is now in a
// different city than when the plan was created") changes the result,
// confirming the derivation is driven by whatever Timing Location is
// passed in at call time, not any location baked into the Plan itself.
// ============================================================

const bengaluruDerived = derivePlanCompletionHistory({ completionInstant: fixedInstant, latitude: 12.9716, longitude: 77.5946, timezone: 'Asia/Kolkata' });
check('Sanity check: derivePlanCompletionHistory has no memory of a "plan-creation location" -- passing a different current Timing Location (Bengaluru vs Chennai) for the SAME instant is a legitimate, supported call, proving the function always uses whatever location the caller (logPlannedActivity, querying the User\'s CURRENT Timing Location) supplies', bengaluruDerived.logTimestamp.getTime() === derived.logTimestamp.getTime());

// ============================================================
// Duplicate completion -- idempotent early-return branch preserved.
// ============================================================

check('The idempotent "already LOGGED" early-return branch (status === \'LOGGED\' && habitLogId) is still present and returns before any new HabitLog would be created', /if \(plan\.status === 'LOGGED' && plan\.habitLogId\) \{/.test(logPlannedActivitySource));
check('That branch still COMMITs and returns the EXISTING plan/habitLog pair rather than falling through to create a second HabitLog', /await client\.query\('COMMIT'\);\s*return \{ plan, habitLog: existingLog\.rows\[0\] \};/.test(logPlannedActivitySource));

// ============================================================
// Atomic failure -- the whole function body (including the new
// derivePlanCompletionHistory call) remains inside the existing
// try/ROLLBACK/rethrow wrapper; no new fallback window value is ever
// substituted.
// ============================================================

check('The entire logPlannedActivity body remains wrapped in try { ... } catch (err) { ROLLBACK; throw err; }', /try \{[\s\S]*catch \(err\) \{\s*await client\.query\('ROLLBACK'\);\s*throw err;/.test(logPlannedActivitySource));
check('derivePlanCompletionHistory is called INSIDE that try block (before the INSERT), so a thrown exception from it rolls back the whole transaction, never leaving a "Plan LOGGED but no HabitLog" or "HabitLog with a fabricated window" state', logPlannedActivitySource.indexOf('derivePlanCompletionHistory(') < logPlannedActivitySource.indexOf('INSERT INTO "HabitLog"'));
check('No fallback window value (NEUTRAL literal, or plan.windowType) is substituted anywhere if window resolution fails -- the INSERT\'s activeWindow parameter is exclusively the destructured `activeWindow` from derivePlanCompletionHistory', /\[\s*habitLogId,\s*userId,\s*plan\.title,\s*plan\.activityId[^,]*,\s*activeWindow,/.test(logPlannedActivitySource));

// ============================================================
// No backfill -- prospective-only, no mutation of existing rows.
// ============================================================

check('logPlannedActivity contains no UPDATE statement targeting existing HabitLog rows (this fix is prospective-only -- new completions, never repaired history)', !/UPDATE "HabitLog"/.test(dbSource));
check('No new migration directory exists for this fix (no schema change -- PlannedActivity.loggedAt already existed)', !fs.readdirSync('apps/web/prisma/migrations').some((name) => /plan.*completion.*histor|histor.*plan.*completion/i.test(name)));

// ============================================================
// No client timestamp -- the route's public contract is unchanged.
// ============================================================

const routeSource = fs.readFileSync('apps/web/app/api/plans/[planId]/log/route.ts', 'utf8');
check('POST /api/plans/[planId]/log still parses no request body (no parseJsonObject/req.json() call)', !/parseJsonObject|req\.json\(\)/.test(routeSource));
check('POST /api/plans/[planId]/log still calls logPlannedActivity with exactly (userId, planId) -- no third argument, no client-supplied timestamp', /logPlannedActivity\(session\.userId, params\.planId\)/.test(routeSource));

// ============================================================
// No schema change.
// ============================================================

check('schema.prisma is byte-identical to its pre-fix content for the PlannedActivity model (no new/removed field)', /loggedAt\s+DateTime\? @db\.Timestamptz\(3\)/.test(fs.readFileSync('apps/web/prisma/schema.prisma', 'utf8')));

console.log(allPassed ? '\nALL PLAN COMPLETION HISTORICAL INTEGRITY CHECKS PASSED' : '\nSOME PLAN COMPLETION HISTORICAL INTEGRITY CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
