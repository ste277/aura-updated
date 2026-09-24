/**
 * Daily Experience V1 PR C1 -- pure + structural suite for the Skip outcome
 * (no DB; the live-DB race/lifecycle proof is skipPlannedActivityDb.test.ts).
 */
import fs from 'fs';
import path from 'path';
import { deriveCaptureState } from '../apps/web/lib/captures';
import { deriveGoalActivityState } from '../apps/web/lib/goals';
import { isActivePlanBlocker } from '../apps/web/lib/dayConstructorOrchestrator';
import { buildDailyAgenda } from '../apps/web/lib/dailyAgenda';
import { buildHomeTimeline } from '../apps/web/lib/homeTimelineComposer';
import { selectRightNowState } from '../apps/web/lib/rightNowSelection';
import { selectCompactAgendaRows } from '../apps/web/lib/compactAgenda';
import { buildDailyReflection } from '../apps/web/lib/dailyReflection';
import { mapPlanRow } from '../apps/web/lib/planFormatting';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const TZ = 'UTC';
const now = new Date('2026-06-10T15:05:00Z');
const plan = (status: string, start: string, end: string, id = 'p'): any => ({ id, userId: 'u', title: `Plan ${id}`, status, plannedStartAt: new Date(start), plannedEndAt: new Date(end), durationMinutes: 60, windowType: 'NEUTRAL', icon: null, loggedAt: null, skippedAt: status === 'SKIPPED' ? new Date('2026-06-10T15:00:00Z') : null, habitLogId: null });
const agendaOf = (plans: any[]) => buildDailyAgenda({ now, localDate: '2026-06-10', timezone: TZ, plans, moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });

// 11. agenda: persisted SKIPPED wins over every time-derived state
for (const [label, s, e] of [['current window', '2026-06-10T15:00:00Z', '2026-06-10T16:00:00Z'], ['elapsed window', '2026-06-10T10:00:00Z', '2026-06-10T11:00:00Z'], ['starting-soon window', '2026-06-10T15:20:00Z', '2026-06-10T16:00:00Z'], ['far-future window', '2026-06-10T20:00:00Z', '2026-06-10T21:00:00Z']] as const) {
  check(`11. SKIPPED derives SKIPPED for a ${label} (never CURRENT/STARTING_SOON/MISSED/COMPLETED/UPCOMING)`, agendaOf([plan('SKIPPED', s, e)]).items[0].status === 'SKIPPED');
}
check('11. an elapsed UPCOMING plan still derives MISSED (time-derived states apply only to UPCOMING)', agendaOf([plan('UPCOMING', '2026-06-10T10:00:00Z', '2026-06-10T11:00:00Z')]).items[0].status === 'MISSED');
const ag = agendaOf([plan('SKIPPED', '2026-06-10T15:00:00Z', '2026-06-10T16:00:00Z', 's'), plan('UPCOMING', '2026-06-10T17:00:00Z', '2026-06-10T18:00:00Z', 'u')]);
check('11. SKIPPED is neither currentItem nor nextItem, and is not counted as planned', ag.currentItem === undefined && ag.nextItem?.id === 'plan:u' && ag.plannedCount === 1 && ag.completedCount === 0);

// 12. constructor blocker
const cand = (status: any, s: string, e: string) => ({ start: new Date(s), end: new Date(e), status });
check('12. SKIPPED never blocks (future window)', isActivePlanBlocker(cand('SKIPPED', '2026-06-10T17:00:00Z', '2026-06-10T18:00:00Z'), now) === false);
check('12. SKIPPED never blocks (current window)', isActivePlanBlocker(cand('SKIPPED', '2026-06-10T15:00:00Z', '2026-06-10T16:00:00Z'), now) === false);
check('12. existing semantics unchanged: UPCOMING future blocks, LOGGED blocks, CANCELLED does not, elapsed UPCOMING does not', isActivePlanBlocker(cand('UPCOMING', '2026-06-10T17:00:00Z', '2026-06-10T18:00:00Z'), now) && isActivePlanBlocker(cand('LOGGED', '2026-06-10T09:00:00Z', '2026-06-10T10:00:00Z'), now) && !isActivePlanBlocker(cand('CANCELLED', '2026-06-10T17:00:00Z', '2026-06-10T18:00:00Z'), now) && !isActivePlanBlocker(cand('UPCOMING', '2026-06-10T09:00:00Z', '2026-06-10T10:00:00Z'), now));

// 13/14. derivations
check('13. Capture: a SKIPPED link derives OPEN (never PLANNED/COMPLETED)', deriveCaptureState({ status: 'OPEN', completedAt: null, linkedPlanStatus: 'SKIPPED' }) === 'OPEN');
check('13. Capture: completedAt still wins (a skip never un-completes)', deriveCaptureState({ status: 'OPEN', completedAt: new Date(), linkedPlanStatus: 'SKIPPED' }) === 'COMPLETED');
check('14. GoalActivity: a SKIPPED link derives SUGGESTED', deriveGoalActivityState({ status: 'SUGGESTED', plannedActivityId: 'x', linkedPlanStatus: 'SKIPPED' }) === 'SUGGESTED');
check('14. GoalActivity: UPCOMING still PLANNED, LOGGED still COMPLETED, CANCELLED still SUGGESTED, DISMISSED still DISMISSED', deriveGoalActivityState({ status: 'SUGGESTED', plannedActivityId: 'x', linkedPlanStatus: 'UPCOMING' }) === 'PLANNED' && deriveGoalActivityState({ status: 'SUGGESTED', plannedActivityId: 'x', linkedPlanStatus: 'LOGGED' }) === 'COMPLETED' && deriveGoalActivityState({ status: 'SUGGESTED', plannedActivityId: 'x', linkedPlanStatus: 'CANCELLED' }) === 'SUGGESTED' && deriveGoalActivityState({ status: 'DISMISSED', plannedActivityId: 'x', linkedPlanStatus: 'SKIPPED' }) === 'DISMISSED');

// 17/18. Right Now + composer
const tlOf = (plans: any[]) => buildHomeTimeline({ agenda: agendaOf(plans), guidance: null, timelineWindows: [], currentMinuteOfDay: 15 * 60 + 5, timezone: TZ, localDate: '2026-06-10' });
const skippedActive = tlOf([plan('SKIPPED', '2026-06-10T15:00:00Z', '2026-06-10T16:00:00Z')]);
check('17. a SKIPPED plan in its active window is not ACTIVE_PLAN or IMMINENT_PLAN', !['ACTIVE_PLAN', 'IMMINENT_PLAN'].includes(selectRightNowState(skippedActive, now).kind));
const skippedImminent = tlOf([plan('SKIPPED', '2026-06-10T15:20:00Z', '2026-06-10T16:00:00Z')]);
check('17. a SKIPPED plan that is about to start is not IMMINENT_PLAN', !['ACTIVE_PLAN', 'IMMINENT_PLAN'].includes(selectRightNowState(skippedImminent, now).kind));
const m = skippedActive.find((i) => i.kind === 'PLAN')!.metadata!;
check('18. composer: SKIPPED is resolved history (past, not current, not completed) and keeps agendaStatus SKIPPED', m.agendaStatus === 'SKIPPED' && m.isPast === true && m.isCurrent === false && m.isCompleted === false);
const mixed = tlOf([plan('SKIPPED', '2026-06-10T15:00:00Z', '2026-06-10T16:00:00Z', 's'), plan('UPCOMING', '2026-06-10T15:20:00Z', '2026-06-10T16:00:00Z', 'u')]);
check('17. a live plan still wins Right Now when a skipped plan overlaps it', selectRightNowState(mixed, now).kind === 'IMMINENT_PLAN' && (selectRightNowState(mixed, now) as any).item.title === 'Plan u');

// 19. story / reflection / compact agenda
const refl = buildDailyReflection(agendaOf([plan('SKIPPED', '2026-06-10T10:00:00Z', '2026-06-10T11:00:00Z')]));
check('19. reflection: SKIPPED is not completed, missed or upcoming', refl.completed.length === 0 && refl.missed.length === 0 && refl.upcoming.length === 0);
const compact = selectCompactAgendaRows(agendaOf([plan('SKIPPED', '2026-06-10T17:00:00Z', '2026-06-10T18:00:00Z')]));
check('19. compact agenda: a SKIPPED plan is not offered as an upcoming row', compact.rows.length === 0);

// 16. Plan tab: never shown as upcoming
const row = mapPlanRow({ id: 'x', title: 'T', status: 'SKIPPED', plannedStartAt: '2026-06-10T17:00:00Z', plannedEndAt: '2026-06-10T18:00:00Z' } as any, TZ);
check('16. mapPlanRow preserves a SKIPPED row as SKIPPED (never LOGGED or UPCOMING)', row.status === 'SKIPPED');
const planTab = strip(read('../apps/web/components/PlanWithAuraView.tsx'));
check("16. the Plan tab derives its upcoming/completed lists from presentation predicates (mapPlanRow preserves SKIPPED; status-preservation suite covers replay)", /savedPlans\.filter\(isActionableUpcomingPlan\)/.test(planTab) && /savedPlans\.filter\(isCompletedPlan\)/.test(planTab));
const db = strip(read('../apps/web/lib/db.ts'));
check("16. listPlannedActivities (Plan tab / calendar feed source) excludes SKIPPED at the query", /status NOT IN \('CANCELLED', 'SKIPPED'\)/.test(db));

// 20-23. UPCOMING-keyed readers naturally exclude SKIPPED (no SKIPPED handling was added there)
check("20. reminder discovery queries stay keyed on status = 'UPCOMING'", /listPlannedActivitiesForReminders[\s\S]{0,400}status = 'UPCOMING'/.test(db) && /\.filter\(\(plan\) => plan\.status === 'UPCOMING'/.test(strip(read('../apps/web/lib/auraReminders.ts'))));
check("21. calendar feed keeps `plan.status !== 'UPCOMING'` -> excluded", /plan\.status !== 'UPCOMING'\) return false/.test(strip(read('../apps/web/app/api/calendar/feed/route.ts'))));
check("22. forward planner blockers keep `plan.status === 'UPCOMING'` -> SKIPPED does not block", /plans\.filter\(\(plan\) => plan\.status === 'UPCOMING'\)/.test(strip(read('../apps/web/lib/forwardPlannerOrchestrator.ts'))));
check("23. guidance dedupe keeps `plan.status !== 'UPCOMING'` -> SKIPPED is not an active scheduled occurrence", /plan\.status !== 'UPCOMING'\) return false/.test(strip(read('../apps/web/lib/dailyGuidanceCandidates.ts'))));

// 9/25. API + DELETE + HabitLog seams
const routeSrc = strip(read('../apps/web/app/api/plans/[planId]/skip/route.ts'));
check('9. the skip route uses skipPlannedActivity and never cancel/log/delete', /skipPlannedActivity/.test(routeSrc) && !/cancelPlannedActivity|logPlannedActivity|deletePlannedActivity/.test(routeSrc));
const skipFn = db.slice(db.indexOf('export async function skipPlannedActivity'), db.indexOf('export async function deletePlannedActivity'));
check("7. skipPlannedActivity is one conditional UPDATE (status = 'UPCOMING') with a DB-clock skippedAt; no read-then-write", /UPDATE "PlannedActivity"[\s\S]*status = 'UPCOMING'[\s\S]*RETURNING \*/.test(skipFn) && /"skippedAt" = now\(\)/.test(skipFn));
check('10/4. skipPlannedActivity writes no HabitLog, Capture or GoalActivity', !/HabitLog|"Capture"|"GoalActivity"/.test(skipFn));
check("25. deletePlannedActivity is unchanged: still only LOGGED/CANCELLED (SKIPPED stays undeletable in V1)", /status IN \('LOGGED', 'CANCELLED'\)/.test(db));
check('7. logPlannedActivity/cancelPlannedActivity were not modified (still status-gated to UPCOMING)', /status = 'UPCOMING'\s+RETURNING \*/.test(db) && /if \(plan\.status !== 'UPCOMING'\) \{\s+throw new Error\('Plan is not available to log\.'\)/.test(db));

// migration is additive only
const mig = strip(read('../apps/web/prisma/migrations/0037_planned_activity_skipped_at/migration.sql').replace(/--.*$/gm, ''));
check('2. migration 0037 is exactly one additive ADD COLUMN "skippedAt" TIMESTAMPTZ(3), no backfill/constraint/enum', /^\s*ALTER TABLE "PlannedActivity"\s+ADD COLUMN "skippedAt" TIMESTAMPTZ\(3\);\s*$/.test(mig) && !/UPDATE|CREATE TYPE|ALTER TYPE/.test(mig));
const schema = read('../apps/web/prisma/schema.prisma');
check('2. schema: skippedAt DateTime? @db.Timestamptz(3); status stays a plain String (no enum)', /skippedAt\s+DateTime\?\s+@db\.Timestamptz\(3\)/.test(schema) && /status\s+String\s+@default\("UPCOMING"\)/.test(schema));

// 15. link SQL accepts both CANCELLED and SKIPPED, and only those
check("15. both source-link UPDATEs may replace a link only over a CANCELLED or SKIPPED plan", (db.match(/status IN \('CANCELLED', 'SKIPPED'\)/g) ?? []).length === 2 && !/AND status = 'CANCELLED'\s*\)/.test(db));

// PR B Done regression: Home completion code untouched by C1
const homeFiles = ['homeCompletion.ts', 'homeRefresh.ts', 'reminderConsistency.ts'].map((f) => read(`../apps/web/lib/${f}`)).join('\n');
check('49. Home completion/refresh/reminder-consistency modules do not mention SKIPPED (Done semantics untouched; C2 owns Home UX)', !/SKIPPED|skipPlannedActivity/.test(homeFiles));

if (!allPassed) { console.error('SOME SKIP CHECKS FAILED'); process.exit(1); }
console.log('ALL SKIP CHECKS PASSED');
