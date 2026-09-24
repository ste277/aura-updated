/**
 * Quick Capture V1 PR A -- structural boundary suite (source-reading, same
 * convention as goalsWiring.test.ts). Proves PR A's own boundary: a
 * domain/API-only change that touches no UI, no planning/acceptance code,
 * no Goal/Habit code, and adds no column to PlannedActivity.
 */
import fs from 'fs';
import path from 'path';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const schema = read('../apps/web/prisma/schema.prisma');
const captureBlock = (schema.match(/model Capture \{[\s\S]*?\n\}/) ?? [''])[0];
check('Capture model exists', captureBlock.length > 0);
const fields = captureBlock.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//') && !l.startsWith('model') && l !== '}' && !l.startsWith('@@')).map((l) => l.split(/\s+/)[0]);
check('Capture has exactly the minimal field set (no task/provenance fields)', fields.sort().join(',') === 'completedAt,createdAt,id,plannedActivity,plannedActivityId,status,title,updatedAt,user,userId');
check('Capture.status stays a plain OPEN|DISMISSED string (PLANNED/COMPLETED never persisted)', /status\s+String\s+@default\("OPEN"\)\s+\/\/ "OPEN" \| "DISMISSED"/.test(captureBlock));

const plannedBlock = (schema.match(/model PlannedActivity \{[\s\S]*?\n\}/) ?? [''])[0];
const captureLines = plannedBlock.split('\n').filter((l) => /Capture/.test(l) && !l.trim().startsWith('//'));
check('PlannedActivity gains ONLY the Prisma opposite relation (no fields:/references: column)', captureLines.length === 1 && /capture\s+Capture\?/.test(captureLines[0]) && !captureLines[0].includes('fields:'));

const migration = read('../apps/web/prisma/migrations/0036_captures/migration.sql');
const migSql = migration.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
check('migration creates only the Capture table + index', /CREATE TABLE "Capture"/.test(migSql) && (migSql.match(/CREATE TABLE/g) ?? []).length === 1 && !/ALTER TABLE/.test(migSql));
check('migration FKs: User ON DELETE CASCADE, PlannedActivity ON DELETE SET NULL, plannedActivityId UNIQUE', /"userId" TEXT NOT NULL REFERENCES "User"\(id\) ON DELETE CASCADE/.test(migSql) && /"plannedActivityId" TEXT UNIQUE REFERENCES "PlannedActivity"\(id\) ON DELETE SET NULL/.test(migSql));
check('migration index is (userId, status, createdAt)', /CREATE INDEX "Capture_userId_status_createdAt_idx" ON "Capture"\("userId", status, "createdAt"\)/.test(migSql));
check('migration count is exactly 36', fs.readdirSync(path.join(__dirname, '../apps/web/prisma/migrations')).filter((f) => /^\d{4}_/.test(f)).length === 36);
const goalActivityBlock = (schema.match(/model GoalActivity \{[\s\S]*?\n\}/) ?? [''])[0];
check('GoalActivity and Habit blocks do not mention Capture', !/Capture/.test(goalActivityBlock) && !/Capture/.test((schema.match(/model Habit \{[\s\S]*?\n\}/) ?? [''])[0]));

// Files that must stay Capture-unaware in PR A.
const UNTOUCHED = [
  '../apps/web/lib/dayIntent.ts',
  '../apps/web/lib/dayConstructor.ts',
  '../apps/web/lib/dayConstructorOrchestrator.ts',
  '../apps/web/lib/dayConstructorAcceptance.ts',
  '../apps/web/lib/dayConstructorAcceptancePersistence.ts',
  '../apps/web/lib/dayConstructorPreviewRequest.ts',
  '../apps/web/lib/acceptConstructedDay.ts',
  '../apps/web/lib/planDayEntry.ts',
  '../apps/web/lib/planDayBootstrap.ts',
  '../apps/web/app/plan-day/PlanDayClient.tsx',
  '../apps/web/app/plan-day/page.tsx',
  '../apps/web/app/api/day-constructor/accept/route.ts',
  '../apps/web/lib/goals.ts',
  '../apps/web/components/HomeDashboard.tsx',
  '../apps/web/components/YouView.tsx',
  '../packages/recommendation/src/timingSearch.ts',
];
for (const rel of UNTOUCHED) check(`${rel.replace('../', '')} has no Capture reference`, !/capture(Id|Links)?\b/i.test(stripComments(read(rel))));

check('no UI: no /captures page or Capture component exists', !fs.existsSync(path.join(__dirname, '../apps/web/app/captures')) && !fs.readdirSync(path.join(__dirname, '../apps/web/components')).some((f) => /capture/i.test(f)));

// API security
const routes = ['../apps/web/app/api/captures/route.ts', '../apps/web/app/api/captures/[captureId]/route.ts', '../apps/web/app/api/captures/[captureId]/complete/route.ts'];
for (const rel of routes) {
  const src = stripComments(read(rel));
  const handlers = (src.match(/export async function (GET|POST|DELETE)/g) ?? []).length;
  check(`${rel.replace('../apps/web/app/api/', '')} authenticates every handler via getSessionFromRequest`, handlers > 0 && (src.match(/getSessionFromRequest\(req\)/g) ?? []).length === handlers && (src.match(/status: 401/g) ?? []).length === handlers);
  check(`${rel.replace('../apps/web/app/api/', '')} never reads plannedActivityId/status/completedAt/userId from the request`, !/body\.(plannedActivityId|status|completedAt|userId|activityId)/.test(src));
}
const dbSrc = stripComments(read('../apps/web/lib/db.ts'));
const capDb = dbSrc.slice(dbSrc.indexOf('export interface Capture {'));
check('every Capture mutation/read query in db.ts is scoped by "userId"', (capDb.match(/"userId" = \$\d|c\."userId" = \$\d/g) ?? []).length >= 6);
check('no Capture db helper accepts a plannedActivityId parameter (PR A creates no link)', !/export async function \w*Capture\w*\([^)]*plannedActivityId/.test(capDb));
check('completeCapture is a single conditional UPDATE (no check-then-act)', /UPDATE "Capture" c[\s\S]{0,900}NOT EXISTS[\s\S]{0,200}'UPCOMING'/.test(capDb));
check('completeCapture/removeCapture never touch HabitLog or PlannedActivity writes', !/INSERT INTO "(HabitLog|PlannedActivity)"|UPDATE "PlannedActivity"|DELETE FROM "PlannedActivity"/.test(capDb));
check('lib/captures.ts imports nothing (pure)', !/^import /m.test(read('../apps/web/lib/captures.ts')));

// PR B seam is unchanged and identifiable
const logSrc = stripComments(dbSrc);
check('logging seam intact: logPlannedActivity still sets status LOGGED inside its own transaction (PR B seam)', /export async function logPlannedActivity[\s\S]*?SET status = 'LOGGED'/.test(logSrc) && !/logPlannedActivity[\s\S]{0,6000}"Capture"/.test(logSrc.slice(logSrc.indexOf('export async function logPlannedActivity'), logSrc.indexOf('export async function logPlannedActivity') + 6000)));

if (!allPassed) {
  console.error('SOME CAPTURE WIRING CHECKS FAILED');
  process.exit(1);
}
console.log('ALL CAPTURE WIRING CHECKS PASSED');
