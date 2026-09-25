/**
 * Daily Experience V1 PR D2 -- pure + structural suite for Move: destination
 * rules, the exhaustive status mapper, read-model treatment of MOVED (agenda,
 * Constructor blocker, sources, Right Now, Composer, Story/Reflection,
 * DayBuilder), and the structural guarantees (additive migration, no scope
 * creep). Live-DB proof: movePlannedActivityDb / Race / movePlanApiDb.
 */
import fs from 'fs';
import path from 'path';
import { validateMoveDestination, MovePlanError } from '../apps/web/lib/planMove';
import { mapPersistedPlanStatus, mapPlanRow, isActionableUpcomingPlan, isCompletedPlan, type PersistedPlanStatus } from '../apps/web/lib/planFormatting';
import { isActivePlanBlocker } from '../apps/web/lib/dayConstructorOrchestrator';
import { deriveCaptureState } from '../apps/web/lib/captures';
import { deriveGoalActivityState } from '../apps/web/lib/goals';
import { buildDailyAgenda } from '../apps/web/lib/dailyAgenda';
import { buildHomeTimeline } from '../apps/web/lib/homeTimelineComposer';
import { selectRightNowState } from '../apps/web/lib/rightNowSelection';
import { selectCompactAgendaRows } from '../apps/web/lib/compactAgenda';
import { buildDailyReflection } from '../apps/web/lib/dailyReflection';
import { buildDailyStory } from '../apps/web/lib/dailyStory';
import { buildDayProfile } from '../apps/web/lib/dayBuilder';
import type { PlannedActivity } from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const throwsCode = (fn: () => unknown) => { try { fn(); return 'NONE'; } catch (e) { return e instanceof MovePlanError ? e.code : 'OTHER'; } };

// ---- 8. destination rules (pure) ----
const NOW = new Date('2026-06-10T12:00:00.000Z');
const plan = (status: string, start: string, end: string, id = 'p', title = 'Meditation'): PlannedActivity => ({ id, userId: 'u', title, activityType: null, icon: null, status, plannedStartAt: new Date(start), plannedEndAt: new Date(end), durationMinutes: 60, windowType: 'NEUTRAL', windowLabel: null, matchLabel: null, score: null, recommendation: null, calendarUrl: null, loggedAt: null, habitLogId: null, eventTimezone: null, eventLocationName: null, createdAt: NOW, updatedAt: NOW }) as unknown as PlannedActivity;
const A = { plannedStartAt: new Date('2026-06-10T15:00:00.000Z'), durationMinutes: 45 };
const okDest = validateMoveDestination(A, new Date('2026-06-11T10:00:00.000Z'), NOW);
check('8/50. a valid destination derives end = start + the ORIGINAL duration (no duration input)', okDest.newEndAt.getTime() === okDest.newStartAt.getTime() + 45 * 60000);
check('8/49. invalid instant -> INVALID_DESTINATION', throwsCode(() => validateMoveDestination(A, new Date('x'), NOW)) === 'INVALID_DESTINATION');
check('8/49. non-whole-minute -> INVALID_DESTINATION', throwsCode(() => validateMoveDestination(A, new Date('2026-06-11T10:00:00.500Z'), NOW)) === 'INVALID_DESTINATION');
check('8/49. past and exactly-now are rejected; one minute ahead is accepted', throwsCode(() => validateMoveDestination(A, new Date('2026-06-10T11:59:00.000Z'), NOW)) === 'INVALID_DESTINATION' && throwsCode(() => validateMoveDestination(A, NOW, NOW)) === 'INVALID_DESTINATION' && throwsCode(() => validateMoveDestination(A, new Date('2026-06-10T12:01:00.000Z'), NOW)) === 'NONE');
check('8/49. same start as A -> INVALID_DESTINATION', throwsCode(() => validateMoveDestination(A, A.plannedStartAt, NOW)) === 'INVALID_DESTINATION');
check('7. eligibility never depends on the clock: an elapsed (MISSED-derived) A is validated only on the DESTINATION, not on its own time', throwsCode(() => validateMoveDestination({ plannedStartAt: new Date('2026-06-01T09:00:00.000Z'), durationMinutes: 30 }, new Date('2026-06-11T10:00:00.000Z'), NOW)) === 'NONE');

// ---- 5/59. status mapper ----
const all: PersistedPlanStatus[] = ['UPCOMING', 'LOGGED', 'CANCELLED', 'SKIPPED', 'MOVED'];
for (const s of all) check(`5/59. mapPlanRow preserves ${s} -> ${s}`, mapPlanRow({ id: 'x', title: 'T', plannedStartAt: '2026-06-10T17:00:00Z', plannedEndAt: '2026-06-10T18:00:00Z', status: s } as any, 'UTC').status === s);
check('5/59. absent/null stays UPCOMING; an unknown status still throws (never collapses to UPCOMING)', mapPersistedPlanStatus(null) === 'UPCOMING' && mapPersistedPlanStatus(undefined) === 'UPCOMING' && (() => { try { mapPersistedPlanStatus('MYSTERY' as any); return false; } catch { return true; } })());
check('33. Plan tab: MOVED is neither actionable upcoming nor completed', !isActionableUpcomingPlan({ status: 'MOVED' }) && !isCompletedPlan({ status: 'MOVED' }) && isActionableUpcomingPlan({ status: 'UPCOMING' }));

// ---- 29. DailyAgenda ----
const agendaOf = (plans: PlannedActivity[], now = new Date('2026-06-10T15:05:00Z')) => buildDailyAgenda({ now, localDate: '2026-06-10', timezone: 'UTC', plans, moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
for (const [label, s, e] of [['current window', '2026-06-10T15:00:00Z', '2026-06-10T16:00:00Z'], ['elapsed window', '2026-06-10T10:00:00Z', '2026-06-10T11:00:00Z'], ['starting-soon window', '2026-06-10T15:20:00Z', '2026-06-10T16:00:00Z'], ['far-future window', '2026-06-10T20:00:00Z', '2026-06-10T21:00:00Z']] as const) {
  check(`29. a persisted MOVED plan derives MOVED for a ${label} (never MISSED/CURRENT/STARTING_SOON/COMPLETED/UPCOMING)`, agendaOf([plan('MOVED', s, e)]).items[0].status === 'MOVED');
}
const ag = agendaOf([plan('MOVED', '2026-06-10T15:00:00Z', '2026-06-10T16:00:00Z', 'a'), plan('UPCOMING', '2026-06-10T17:00:00Z', '2026-06-10T18:00:00Z', 'b')]);
check('29. MOVED is neither current nor next; plannedCount excludes it; the successor behaves normally by time', ag.currentItem === undefined && ag.nextItem?.id === 'plan:b' && ag.plannedCount === 1 && ag.items.find((i) => i.id === 'plan:b')!.status === 'UPCOMING');

// ---- 30. Constructor blocker ----
const cand = (status: any, s: string, e: string) => ({ start: new Date(s), end: new Date(e), status });
const nowC = new Date('2026-06-10T15:05:00Z');
check('30. MOVED never blocks (future or current); the UPCOMING successor blocks; LOGGED/CANCELLED/SKIPPED and elapsed-UPCOMING semantics are unchanged', !isActivePlanBlocker(cand('MOVED', '2026-06-10T17:00:00Z', '2026-06-10T18:00:00Z'), nowC) && !isActivePlanBlocker(cand('MOVED', '2026-06-10T15:00:00Z', '2026-06-10T16:00:00Z'), nowC) && isActivePlanBlocker(cand('UPCOMING', '2026-06-10T17:00:00Z', '2026-06-10T18:00:00Z'), nowC) && isActivePlanBlocker(cand('LOGGED', '2026-06-10T09:00:00Z', '2026-06-10T10:00:00Z'), nowC) && !isActivePlanBlocker(cand('CANCELLED', '2026-06-10T17:00:00Z', '2026-06-10T18:00:00Z'), nowC) && !isActivePlanBlocker(cand('SKIPPED', '2026-06-10T17:00:00Z', '2026-06-10T18:00:00Z'), nowC) && !isActivePlanBlocker(cand('UPCOMING', '2026-06-10T09:00:00Z', '2026-06-10T10:00:00Z'), nowC));

// ---- 31/32. defensive source derivations ----
check('31. Capture: a stale link to a MOVED plan is never PLANNED or COMPLETED (display fallback OPEN only; generic relinking is refused); the normal Move path repoints so it derives PLANNED via the successor', deriveCaptureState({ status: 'OPEN', completedAt: null, linkedPlanStatus: 'MOVED' }) === 'OPEN' && deriveCaptureState({ status: 'OPEN', completedAt: null, linkedPlanStatus: 'UPCOMING' }) === 'PLANNED' && deriveCaptureState({ status: 'OPEN', completedAt: new Date(), linkedPlanStatus: 'MOVED' }) === 'COMPLETED');
check('32. GoalActivity: a stale link to a MOVED plan is DISPLAYED as SUGGESTED (never PLANNED-forever or COMPLETED; not a relink permission); UPCOMING still PLANNED, LOGGED still COMPLETED', deriveGoalActivityState({ status: 'SUGGESTED', plannedActivityId: 'x', linkedPlanStatus: 'MOVED' }) === 'SUGGESTED' && deriveGoalActivityState({ status: 'SUGGESTED', plannedActivityId: 'x', linkedPlanStatus: 'UPCOMING' }) === 'PLANNED' && deriveGoalActivityState({ status: 'SUGGESTED', plannedActivityId: 'x', linkedPlanStatus: 'LOGGED' }) === 'COMPLETED' && deriveGoalActivityState({ status: 'DISMISSED', plannedActivityId: 'x', linkedPlanStatus: 'MOVED' }) === 'DISMISSED');

// ---- 34/39/40. Right Now, Composer, Story, Reflection, Compact, DayBuilder ----
const tlOf = (plans: PlannedActivity[]) => buildHomeTimeline({ agenda: agendaOf(plans), guidance: null, timelineWindows: [], currentMinuteOfDay: 15 * 60 + 5, timezone: 'UTC', localDate: '2026-06-10' });
const movedActive = tlOf([plan('MOVED', '2026-06-10T15:00:00Z', '2026-06-10T16:00:00Z')]);
const movedImminent = tlOf([plan('MOVED', '2026-06-10T15:20:00Z', '2026-06-10T16:00:00Z')]);
check('34. a MOVED plan can never be ACTIVE_PLAN or IMMINENT_PLAN', !['ACTIVE_PLAN', 'IMMINENT_PLAN'].includes(selectRightNowState(movedActive, nowC).kind) && !['ACTIVE_PLAN', 'IMMINENT_PLAN'].includes(selectRightNowState(movedImminent, nowC).kind));
const m = movedActive.find((i) => i.kind === 'PLAN')!.metadata!;
check('34. Composer projects MOVED as resolved history (past, not current, not completed) keeping agendaStatus MOVED', m.agendaStatus === 'MOVED' && m.isPast === true && m.isCurrent === false && m.isCompleted === false);
const pair = tlOf([plan('MOVED', '2026-06-10T15:00:00Z', '2026-06-10T16:00:00Z', 'a'), plan('UPCOMING', '2026-06-10T15:20:00Z', '2026-06-10T16:20:00Z', 'b')]);
check('34. existing live-plan selection is unchanged: the UPCOMING successor wins Right Now over the MOVED original', selectRightNowState(pair, nowC).kind === 'IMMINENT_PLAN' && (selectRightNowState(pair, nowC) as any).item.id === 'plan:b');
const refl = buildDailyReflection(agendaOf([plan('MOVED', '2026-06-10T10:00:00Z', '2026-06-10T11:00:00Z')]));
check('40. reflection: MOVED is not completed, missed or upcoming', refl.completed.length === 0 && refl.missed.length === 0 && refl.upcoming.length === 0);
const story = buildDailyStory(agendaOf([plan('MOVED', '2026-06-10T17:00:00Z', '2026-06-10T18:00:00Z', 'a', 'Evening meditation')]), 15 * 60);
check('40. story: a MOVED plan is not narrated as pending/completed work', !JSON.stringify([story.headline, story.narrative]).includes('Evening meditation'));
check('40. compact agenda: a MOVED plan is not offered as an upcoming row', selectCompactAgendaRows(agendaOf([plan('MOVED', '2026-06-10T17:00:00Z', '2026-06-10T18:00:00Z')])).rows.length === 0);
const profMoved = buildDayProfile(agendaOf([plan('MOVED', '2026-06-10T17:00:00Z', '2026-06-10T18:00:00Z', 'a', 'Meditation')]), 15 * 60);
const profLive = buildDayProfile(agendaOf([plan('UPCOMING', '2026-06-10T17:00:00Z', '2026-06-10T18:00:00Z', 'a', 'Meditation')]), 15 * 60);
check('39. DayBuilder: a MOVED plan is not a present activity and does not block open time; the UPCOMING successor does', profMoved.presentActivityIds.size === 0 && profLive.presentActivityIds.size > 0 && profMoved.openings.some((o) => o.startMinute <= 17 * 60 && o.endMinute >= 18 * 60) && !profLive.openings.some((o) => o.startMinute <= 17 * 60 && o.endMinute >= 18 * 60));

// ---- structural ----
const mig = read('../apps/web/prisma/migrations/0038_planned_activity_move_lineage/migration.sql').replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim();
check('3. migration 0038 is exactly: ADD COLUMN "rescheduledFromPlanId" TEXT + its UNIQUE index + the self-FK ON DELETE SET NULL; no backfill/enum/movedAt', /^ALTER TABLE "PlannedActivity" ADD COLUMN "rescheduledFromPlanId" TEXT; CREATE UNIQUE INDEX "PlannedActivity_rescheduledFromPlanId_key" ON "PlannedActivity"\("rescheduledFromPlanId"\); ALTER TABLE "PlannedActivity" ADD CONSTRAINT "PlannedActivity_rescheduledFromPlanId_fkey" FOREIGN KEY \("rescheduledFromPlanId"\) REFERENCES "PlannedActivity"\("id"\) ON DELETE SET NULL ON UPDATE CASCADE;$/.test(mig) && !/UPDATE "|CREATE TYPE|ALTER TYPE|movedAt/i.test(mig.replace('ON UPDATE CASCADE', '')));
const migs = fs.readdirSync(path.join(__dirname, '../apps/web/prisma/migrations')).filter((f) => /^\d{4}_/.test(f));
check('3/69. exactly 38 migrations; 0038 is the only new one', migs.length === 38 && migs.includes('0038_planned_activity_move_lineage') && migs.filter((d) => d > '0037_planned_activity_skipped_at').length === 1);
const schema = read('../apps/web/prisma/schema.prisma');
const paModel = strip(schema.slice(schema.indexOf('model PlannedActivity {'), schema.indexOf('}', schema.indexOf('model PlannedActivity {'))));
check('2. schema: one nullable UNIQUE self-relation with ON DELETE SET NULL; no movedAt, no forward pointer column, no reason, status stays a text column', /rescheduledFromPlanId String\? @unique/.test(paModel) && /onDelete: SetNull/.test(paModel.slice(paModel.indexOf('rescheduledFrom '))) && !/movedAt|rescheduledToPlanId|moveReason/.test(paModel) && /status\s+String\s+@default\("UPCOMING"\)/.test(paModel));
const domain = strip(read('../apps/web/lib/planMove.ts'));
check("11/12. the operation takes the acceptance advisory lock, then SELECT ... FOR UPDATE on A, and marks A MOVED only conditionally from UPCOMING", /pg_advisory_xact_lock\(hashtext\(\$1\)\)', \[`day-constructor-accept:\$\{userId\}`\]/.test(domain) && /FOR UPDATE/.test(domain) && /SET status = 'MOVED'[\s\S]*status = 'UPCOMING' RETURNING/.test(domain) && domain.indexOf('FOR UPDATE') < domain.indexOf("SET status = 'MOVED'"));
check('12/13/14. B is a direct INSERT (never createPlannedActivity/dedupe); sources are repointed with keyed UPDATEs, never the generic link helpers', /INSERT INTO "PlannedActivity"/.test(domain) && !/createPlannedActivity|linkCaptureToPlannedActivity|linkGoalActivityToPlannedActivity/.test(domain) && /UPDATE "Capture" SET "plannedActivityId" = \$1[\s\S]*WHERE "plannedActivityId" = \$2 AND "userId" = \$3/.test(domain) && /UPDATE "GoalActivity" SET "plannedActivityId" = \$1[\s\S]*WHERE "plannedActivityId" = \$2 AND "userId" = \$3/.test(domain));
check('18/19. Move never calls the Day Constructor or Timing Search; it writes no HabitLog', !/orchestrateConstructDay|runTimingSearch|constructDay|timingSearch/i.test(domain.replace(/isActivePlanBlocker/g, '')) && !/HabitLog/.test(domain));
check('10. B is cleared of A\'s evaluation: NEUTRAL, NULL label/match/score/recommendation, recomputed calendar URL', /'UPCOMING', \$6, \$7, \$8, 'NEUTRAL', NULL, NULL, NULL, NULL, \$9/.test(domain) && /buildGoogleCalendarUrl\(a\.title, newStartAt\.toISOString\(\), newEndAt\.toISOString\(\)\)/.test(domain));
const route = strip(read('../apps/web/app/api/plans/[planId]/move/route.ts'));
check('26. the route uses movePlannedActivity and never cancel/log/skip/delete/create', /movePlannedActivity/.test(route) && !/cancelPlannedActivity|logPlannedActivity|skipPlannedActivity|deletePlannedActivity|createPlannedActivity/.test(route));
const db = strip(read('../apps/web/lib/db.ts'));
check('41. DELETE stays LOGGED/CANCELLED only: MOVED rows are not deletable (lineage protection)', /status IN \('LOGGED', 'CANCELLED'\)/.test(db) && /status = 'UPCOMING'\s+RETURNING \*/.test(db));
check('33. Plan-tab list query excludes MOVED (like CANCELLED/SKIPPED)', /status NOT IN \('CANCELLED', 'SKIPPED', 'MOVED'\)/.test(db));
check("35-38. UPCOMING-keyed readers are untouched and naturally exclude MOVED / include the successor: reminders, calendar feed, forward planner, guidance", /listPlannedActivitiesForReminders[\s\S]{0,400}status = 'UPCOMING'/.test(db) && /plan\.status !== 'UPCOMING'\) return false/.test(strip(read('../apps/web/app/api/calendar/feed/route.ts'))) && /plans\.filter\(\(plan\) => plan\.status === 'UPCOMING'\)/.test(strip(read('../apps/web/lib/forwardPlannerOrchestrator.ts'))) && /plan\.status !== 'UPCOMING'\) return false/.test(strip(read('../apps/web/lib/dailyGuidanceCandidates.ts'))) && /\.filter\(\(plan\) => plan\.status === 'UPCOMING'/.test(strip(read('../apps/web/lib/auraReminders.ts'))));
check('19. the generic source-link helpers are exactly as on main: replaceable over CANCELLED or SKIPPED only, and MOVED is NOT a replaceable predecessor (fail closed)', (db.match(/status IN \('CANCELLED', 'SKIPPED'\)/g) ?? []).length === 2 && !/AND status IN \('CANCELLED', 'SKIPPED', 'MOVED'\)/.test(db) && (db.match(/AND status IN \(/g) ?? []).length >= 2);
const comp = strip(read('../apps/web/components/PlanWithAuraView.tsx')) + strip(read('../apps/web/components/HomeDashboard.tsx'));
check("33/72. scope: the Plan tab never calls the move endpoint and its existing reschedule workflow (save new + DELETE old) is untouched (Home Move is D3's separate executor entry)", !/\/move\b/.test(strip(read('../apps/web/components/PlanWithAuraView.tsx'))) && /fetch\(`\/api\/plans\/\$\{replacedPlanId\}`, \{ method: 'DELETE' \}\)/.test(strip(read('../apps/web/components/PlanWithAuraView.tsx'))));
check("72. Home's confirmed-outcome type grew only by the confirmed MOVED fact (D3): COMPLETED | SKIPPED | MOVED", /export type ExecutionOutcome = 'COMPLETED' \| 'SKIPPED' \| 'MOVED';/.test(strip(read('../apps/web/lib/homeCompletion.ts'))));

if (!allPassed) { console.error('SOME MOVE CHECKS FAILED'); process.exit(1); }
console.log('ALL MOVE CHECKS PASSED');
