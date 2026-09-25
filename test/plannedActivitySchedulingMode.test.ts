/**
 * Remaining-Day Recomposition V1 PR F1 -- persisted scheduling mode: pure
 * semantics (fail-closed helpers, the Constructor -> persistence mapping run
 * against the REAL `constructDay`) and structural pins (every PlannedActivity
 * creation path, the trust boundary, the migration, and the scope exclusions).
 * Live-DB proof: plannedActivitySchedulingModeDb.test.ts.
 */
import fs from 'fs';
import path from 'path';
import { hasFlexibleScheduling, parseSchedulingMode, schedulingModeFromFlexibility, schedulingModeFromPlacementSource, DIRECT_PLAN_SCHEDULING_MODE } from '../apps/web/lib/plannedActivitySchedulingMode';
import { toCreatePlannedActivityInput } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import { constructDay, type PlacementCandidate, type FixedPlacementConstraint } from '../apps/web/lib/dayConstructor';
import { buildDayIntent } from '../apps/web/lib/dayIntent';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const root = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next') continue;
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel);
  }
  return out;
};

// ---------- 2/3/20/21/22/49. semantics + fail-closed ----------
check('2/19. hasFlexibleScheduling is true ONLY for an explicit FLEXIBLE', hasFlexibleScheduling({ schedulingMode: 'FLEXIBLE' }) && !hasFlexibleScheduling({ schedulingMode: 'FIXED' }));
check('20/49. null, undefined, a missing field, a missing plan and unknown strings are NEVER flexible', [null, undefined, '', 'flexible', 'Flexible', ' FLEXIBLE', 'MOVABLE', 0, true, {}].every((v) => !hasFlexibleScheduling({ schedulingMode: v })) && !hasFlexibleScheduling({}) && !hasFlexibleScheduling(null) && !hasFlexibleScheduling(undefined));
check('21. FIXED is not FLEXIBLE', !hasFlexibleScheduling({ schedulingMode: 'FIXED' }) && parseSchedulingMode('FIXED') === 'FIXED');
check('49. parseSchedulingMode is an exact match: anything else (case variants, whitespace, non-strings) is null = unknown = protected', parseSchedulingMode('FLEXIBLE') === 'FLEXIBLE' && [undefined, null, 'flexible', 'FLEXIBLE ', 'fixed', 'AUTO', 1, {}].every((v) => parseSchedulingMode(v) === null));
check('7. a DayIntent flexibility maps 1:1 (FIXED -> FIXED, FLEXIBLE -> FLEXIBLE)', schedulingModeFromFlexibility('FIXED') === 'FIXED' && schedulingModeFromFlexibility('FLEXIBLE') === 'FLEXIBLE');
check('7. placementSource maps exactly (FIXED_CONSTRAINT -> FIXED, SELECTED_CANDIDATE -> FLEXIBLE); unknown/absent -> null (protected)', schedulingModeFromPlacementSource('FIXED_CONSTRAINT') === 'FIXED' && schedulingModeFromPlacementSource('SELECTED_CANDIDATE') === 'FLEXIBLE' && [undefined, null, '', 'MANUAL', 'selected_candidate'].every((v) => schedulingModeFromPlacementSource(v) === null));
check('10/11. the direct-plan constant is FIXED (an explicit exact-time choice; no FLEXIBLE without evidence)', DIRECT_PLAN_SCHEDULING_MODE === 'FIXED');

// ---------- 7/12/13. the mapping is proven against the REAL constructDay output ----------
{
  const day = '2026-09-16';
  const at = (h: number, m = 0) => new Date(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
  const fixed = { ...buildDayIntent({ title: 'Client call', targetDate: day, flexibility: 'FIXED', estimatedDurationMinutes: 30 } as any, 0), id: 'i-fixed' };
  const flexible = { ...buildDayIntent({ title: 'Deep work', targetDate: day, flexibility: 'FLEXIBLE', estimatedDurationMinutes: 60 } as any, 1), id: 'i-flex' };
  const candidates: Record<string, PlacementCandidate[]> = { 'i-flex': [{ intentId: 'i-flex', start: at(13), end: at(15), timingFit: 'GOOD', candidateOrder: 0 }] };
  const constraints: Record<string, FixedPlacementConstraint[]> = { 'i-fixed': [{ intentId: 'i-fixed', start: at(11), end: at(11, 30) }] };
  const result = constructDay({ intents: [fixed, flexible], window: { date: day, start: at(9), end: at(18), timezone: 'UTC', source: 'EXPLICIT_RANGE' }, blockedIntervals: [], candidatesByIntentId: candidates, fixedConstraintsByIntentId: constraints, today: day });
  const proposed = result.status === 'READY' ? result.day.proposedItems : [];
  const intentById = new Map([fixed, flexible].map((i) => [i.id, i]));
  check('12/13. the REAL Constructor output: every proposed item\'s placementSource maps to exactly its intent\'s own flexibility -- a FIXED intent is placed FIXED_CONSTRAINT, a FLEXIBLE one SELECTED_CANDIDATE', proposed.length === 2 && proposed.every((p) => schedulingModeFromPlacementSource(p.placementSource) === schedulingModeFromFlexibility(intentById.get(p.intentId)!.flexibility)) && proposed.find((p) => p.intentId === 'i-fixed')!.placementSource === 'FIXED_CONSTRAINT' && proposed.find((p) => p.intentId === 'i-flex')!.placementSource === 'SELECTED_CANDIDATE');
}

// ---------- 7. acceptance write mapping ----------
{
  const base = { title: 'X', plannedStartAt: new Date('2026-09-16T10:00:00Z'), plannedEndAt: new Date('2026-09-16T10:30:00Z'), durationMinutes: 30 };
  check('7. acceptance write: FIXED_CONSTRAINT -> FIXED, SELECTED_CANDIDATE -> FLEXIBLE, absent placementSource -> null (fail closed)', toCreatePlannedActivityInput('u', { ...base, placementSource: 'FIXED_CONSTRAINT' }).schedulingMode === 'FIXED' && toCreatePlannedActivityInput('u', { ...base, placementSource: 'SELECTED_CANDIDATE' }).schedulingMode === 'FLEXIBLE' && toCreatePlannedActivityInput('u', base).schedulingMode === null);
}

// ---------- 6/9/17. creation-path audit (complete list, structural) ----------
const prod = [...walk('apps/web'), ...walk('packages')].filter((f) => !/\.test\./.test(f) && !f.includes(`${path.sep}prisma${path.sep}`));
// Broadened guard: any casing / whitespace / unquoted table form of a raw INSERT, a dynamic `INSERT INTO ${...}`, and the
// Prisma client forms (this repository uses raw `pg`, so the Prisma forms are a tripwire, not an expected path).
const CREATOR_PATTERNS = [/INSERT\s+INTO\s+"?PlannedActivity"?/i, /INSERT\s+INTO\s+\$\{/i, /plannedActivity\s*\.\s*(create|createMany|upsert)\s*\(/, /\$executeRaw[\s\S]{0,120}PlannedActivity/i];
const insertSites = prod.filter((f) => CREATOR_PATTERNS.some((re) => re.test(strip(read(f)))) || /INSERT INTO "PlannedActivity"/.test(read(f)));
check('6. the COMPLETE set of production files that INSERT a PlannedActivity is exactly db.ts (createPlannedActivity + createPlannedActivityWithClient) and planMove.ts (the Move successor)', insertSites.map((f) => f.split(path.sep).join('/')).sort().join() === 'apps/web/lib/db.ts,apps/web/lib/planMove.ts');
const dbSrc = strip(read('apps/web/lib/db.ts'));
const inserts = dbSrc.match(/INSERT INTO "PlannedActivity"[\s\S]*?RETURNING \*/g) ?? [];
check('6. both db.ts inserts and the Move insert name the schedulingMode column and bind a parsed value (never a raw client value)', inserts.length === 2 && inserts.every((q) => /"schedulingMode"/.test(q)) && (dbSrc.match(/parseSchedulingMode\(input\.schedulingMode\)/g) ?? []).length === 2 && /"schedulingMode"/.test(read('apps/web/lib/planMove.ts')) && /parseSchedulingMode\(a\.schedulingMode\)/.test(read('apps/web/lib/planMove.ts')));
const callers = prod.filter((f) => /createPlannedActivity(WithClient)?\(/.test(strip(read(f))) && !/lib\/db\.ts$/.test(f)).map((f) => f.split(path.sep).join('/')).sort();
check('6. the only production callers of the creation helpers are POST /api/plans and the Day Constructor acceptance transaction', callers.join() === 'apps/web/app/api/plans/route.ts,apps/web/lib/dayConstructorAcceptancePersistence.ts');
check('6. Day Constructor acceptance: the item\'s placementSource flows write -> toCreatePlannedActivityInput -> createPlannedActivityWithClient (one transaction, no inference from title/activity type)', /createPlannedActivityWithClient\(client, toCreatePlannedActivityInput\(userId, writeIntent\)\)/.test(strip(read('apps/web/lib/dayConstructorAcceptancePersistence.ts'))) && /schedulingModeFromPlacementSource\(write\.placementSource\)/.test(strip(read('apps/web/lib/dayConstructorAcceptancePersistence.ts'))) && !/activityType|title/.test(strip(read('apps/web/lib/plannedActivitySchedulingMode.ts')).replace(/PlannedActivity/g, '')));
const routeSrc = strip(read('apps/web/app/api/plans/route.ts'));
check('9/18/38. POST /api/plans passes the server constant DIRECT_PLAN_SCHEDULING_MODE and never reads schedulingMode from the body', /schedulingMode: DIRECT_PLAN_SCHEDULING_MODE/.test(routeSrc) && !/body\??\.schedulingMode|body\[['"]schedulingMode/.test(routeSrc));
const acceptRoute = strip(read('apps/web/app/api/day-constructor/accept/route.ts'));
check('18/38. the accept route never reads schedulingMode from the body (it stays derived from the reviewed item\'s placementSource)', !/schedulingMode/.test(acceptRoute));

// ---------- 9/10/30. direct-caller matrix: every client that POSTs /api/plans sends no scheduling mode ----------
const clientFiles = [...walk('apps/web/components'), ...walk('apps/web/app')].filter((f) => /\.tsx?$/.test(f) && !f.includes(`${path.sep}api${path.sep}`));
check('9/17/44. no client/UI file references schedulingMode at all (no badge, selector, setting or request field)', clientFiles.every((f) => !/schedulingMode/.test(read(f))));
const planPostSites = ['apps/web/components/PlanWithAuraView.tsx', 'apps/web/components/AskAuraView.tsx'].map((f) => strip(read(f)));
check('9/30. the direct POST /api/plans call sites (saveUpcomingPlanFromCandidate, the Plan tab reschedule, Ask Aura) cannot carry a mode -- the field does not exist on their payloads', planPostSites.every((s) => !/schedulingMode|FLEXIBLE/.test(s.slice(s.indexOf("fetch('/api/plans'")))));
const callerFiles = ['apps/web/app/find/GuestFindClient.tsx', 'apps/web/components/ForwardPlannerView.tsx', 'apps/web/components/HomeDashboard.tsx', 'apps/web/components/DayBuilderCard.tsx', 'apps/web/components/AskAuraView.tsx', 'apps/web/components/MyDayStoryCard.tsx', 'apps/web/components/MuhurthamFinderView.tsx'];
check('9/30. the seven saveUpcomingPlanFromCandidate / direct callers are exactly the audited set (a new direct creator must be audited before it can ship)', prod.filter((f) => /saveUpcomingPlanFromCandidate\(/.test(strip(read(f))) && !/PlanWithAuraView/.test(f)).map((f) => f.split(path.sep).join('/')).sort().join() === [...callerFiles].sort().join());

// ---------- 17/24/28/29/44/50. scope exclusions ----------
const untouched = ['apps/web/lib/dayConstructor.ts', 'apps/web/lib/dayCapacity.ts', 'apps/web/lib/dayIntent.ts', 'apps/web/lib/dayConstructorOrchestrator.ts', 'apps/web/lib/availabilityContext.ts', 'apps/web/lib/dayConstructorAcceptance.ts', 'apps/web/lib/dailyAgenda.ts', 'apps/web/lib/homeTimelineComposer.ts', 'apps/web/lib/homeCompletion.ts', 'apps/web/lib/homeMove.ts'];
check('28/29/50. the Constructor, capacity, availability, orchestrator, acceptance evaluation, agenda, composer and Home never mention schedulingMode (no recomposition, ranking or eligibility work)', untouched.every((f) => !/schedulingMode|hasFlexibleScheduling/.test(read(f))));
const moveSrc = strip(read('apps/web/lib/planMove.ts'));
check('23/24/50. Move eligibility is unchanged: planMove only COPIES the mode onto the successor and never branches on it (no FIXED gate; HAS_LINKED_MOMENT untouched)', !/schedulingMode\s*(===|!==|==)|hasFlexibleScheduling/.test(moveSrc) && /HAS_LINKED_MOMENT/.test(moveSrc));
check('50. (F1 scope, updated through F3) the only recomposition-ACCEPTANCE code is F3\'s single signed-token module and route, there is no separate batch-move module, and F1 mode semantics are consumed only through hasFlexibleScheduling', prod.filter((f) => /recompositionAccept/i.test(f)).map((f) => f.split(path.sep).join('/')).sort().join() === 'apps/web/lib/remainingDayRecompositionAcceptance.ts' && !prod.some((f) => /(batchMove|applyRecomposition|recomposeAccept)/i.test(f)) && fs.existsSync(path.join(root, 'apps/web/app/api/day/recompose/accept/route.ts')) && !/schedulingMode\s*(===|!==)/.test(strip(read('apps/web/lib/remainingDayRecompositionAcceptance.ts'))));
check('17. the client row mapper (mapPlanRow / UpcomingPlan) deliberately does not carry the mode: no client consumer needs it, and the server read paths (SELECT *) already return it for future state gathering', !/schedulingMode/.test(read('apps/web/lib/planFormatting.ts')) && /SELECT \*\s+FROM "PlannedActivity"/.test(read('apps/web/lib/db.ts')));
check('17. the PlannedActivity domain type carries an OPTIONAL, nullable schedulingMode (an in-memory fixture without it is unknown = protected, never flexible)', /schedulingMode\?: PlannedActivitySchedulingMode \| null;/.test(read('apps/web/lib/db.ts')));

// ---------- 5/40/46/47/48. migration + schema ----------
const migDir = path.join(root, 'apps/web/prisma/migrations');
const migs = fs.readdirSync(migDir).filter((d) => /^\d{4}_/.test(d));
const sqlText = fs.readFileSync(path.join(migDir, '0039_planned_activity_scheduling_mode/migration.sql'), 'utf8');
const sqlCode = sqlText.replace(/--.*$/gm, '');
check('5/40. the migration chain now has 39 migrations, 0039 last', migs.length === 39 && migs.sort()[migs.length - 1] === '0039_planned_activity_scheduling_mode');
check('4/5/40. the migration is additive: one enum type + one nullable column; NO default, NO backfill/UPDATE, NO drop/alter of existing data', /CREATE TYPE "PlannedActivitySchedulingMode" AS ENUM \('FIXED', 'FLEXIBLE'\);/.test(sqlCode) && /ALTER TABLE "PlannedActivity" ADD COLUMN "schedulingMode" "PlannedActivitySchedulingMode";/.test(sqlCode) && !/\bDEFAULT\b|\bUPDATE\b|\bDROP\b|\bNOT NULL\b|\bDELETE\b/i.test(sqlCode));
const schema = read('apps/web/prisma/schema.prisma');
check('5/47/48. the Prisma schema declares the enum PlannedActivitySchedulingMode { FIXED FLEXIBLE } and a nullable, default-less PlannedActivity.schedulingMode', /enum PlannedActivitySchedulingMode \{\s*FIXED\s*FLEXIBLE\s*\}/.test(schema) && /schedulingMode\s+PlannedActivitySchedulingMode\?\s*\n/.test(schema) && !/schedulingMode[^\n]*@default/.test(schema));
check('47. naming: schedulingMode / PlannedActivitySchedulingMode (no movable / canMove / isFlexible)', !/\b(movable|canMove|isFlexible)\b/.test(strip(read('apps/web/lib/plannedActivitySchedulingMode.ts')) + schema.slice(schema.indexOf('model PlannedActivity'))) );
check('46/22. the domain type documents FIXED / FLEXIBLE / null, that FLEXIBLE is permission to PROPOSE (explicit acceptance required) and that manual Move is independent', /FIXED\s+the occurrence's time is a commitment/.test(read('apps/web/lib/plannedActivitySchedulingMode.ts')) && /permission to propose, never permission to move/.test(read('apps/web/lib/plannedActivitySchedulingMode.ts')) && /An explicit user Move is independent/.test(read('apps/web/lib/plannedActivitySchedulingMode.ts')));
check('40. the migration count is fixed by the repository (no other migration was touched)', migs.every((m) => m === '0039_planned_activity_scheduling_mode' || fs.statSync(path.join(migDir, m)).isDirectory()));

console.log(allPassed ? '\nALL SCHEDULING MODE CHECKS PASSED' : '\nSOME SCHEDULING MODE CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
