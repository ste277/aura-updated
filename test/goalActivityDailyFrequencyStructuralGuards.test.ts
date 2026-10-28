/**
 * HPG3-A1, updated by HPG3-A2 -- architecture guard (pure, no DB).
 *
 * A1 proved the four new columns (migration 0051) and the pure domain
 * module (goalActivityDailyFrequency.ts) were genuinely INERT: no
 * production scheduling writer read or wrote them, and the module itself
 * was imported only by its own test files -- with this file's own header
 * explicitly noting "A LATER ticket (HPG3-A2) is expected to change these
 * facts." A2 is that ticket. This file now proves the OPPOSITE, equally
 * precise claim: the new columns and module are referenced ONLY inside
 * the exact, reviewed call sites A2 introduces (db.ts's
 * checkDailyOccurrenceEligibility/materializeGoalActivityRhythmOccurrence,
 * and planMove.ts's destination-day re-validation/re-stamp) -- never
 * anywhere else, and never by route.ts or dayConstructorAcceptancePersistence.ts
 * directly (both call into db.ts's own functions instead, never touching
 * the new columns or module themselves). This is still a "model become
 * writes, but ONLY the reviewed ones" guard, not a weakened one.
 */
import fs from 'fs';
import path from 'path';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const root = path.join(__dirname, '..');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
function listTs(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name.startsWith('.') ? [] : listTs(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}
const production = [...listTs(path.join(root, 'apps/web/lib')), ...listTs(path.join(root, 'apps/web/app')), ...listTs(path.join(root, 'apps/web/components'))].map((f) => ({ f: path.relative(root, f), src: stripComments(fs.readFileSync(f, 'utf8')) }));

// ============================================================
// 1. The four columns are referenced ONLY inside the two files HPG3-A2
// legitimately extends (db.ts, planMove.ts) -- nowhere else.
// ============================================================
const NEW_COLUMN_NAMES = ['dailyFrequencyKind', 'dailyFrequencyLimit', 'scheduledLocalDate', 'scheduledLocalTimezone'];
const EXPECTED_COLUMN_REFERENCING_FILES = ['apps/web/lib/db.ts', 'apps/web/lib/planMove.ts'];
for (const column of NEW_COLUMN_NAMES) {
  const referencingFiles = production.filter((x) => x.src.includes(`"${column}"`)).map((x) => x.f);
  check(`1. "${column}" appears ONLY in ${EXPECTED_COLUMN_REFERENCING_FILES.join(', ')} -- no other production file references it`, referencingFiles.length > 0 && referencingFiles.every((f) => EXPECTED_COLUMN_REFERENCING_FILES.includes(f)));
}

// ============================================================
// 2. The confirmed scheduling writers that do NOT touch the new columns or
// module DIRECTLY (they call into db.ts's own functions instead) stay
// exactly that way -- route.ts, dayConstructorAcceptancePersistence.ts and
// remainingDayRecompositionAcceptance.ts never reference a new column name
// or the new module's exports in their own source text.
// ============================================================
const INDIRECT_CALLERS = [
  'apps/web/app/api/plans/route.ts',
  'apps/web/lib/dayConstructorAcceptancePersistence.ts',
  'apps/web/lib/remainingDayRecompositionAcceptance.ts',
];
const NEW_MODULE_EXPORTS = [
  'goalActivityDailyFrequency',
  'validateGoalActivityDailyFrequency',
  'normalizeGoalActivityDailyFrequency',
  'toPersistedGoalActivityDailyFrequency',
  'isGoalActivityDailyFrequencyEnforceable',
  'validateScheduledLocalDatePair',
  'resolveOccurrenceLocalDay',
];
for (const callerPath of INDIRECT_CALLERS) {
  const file = production.find((x) => x.f === callerPath);
  if (!file) throw new Error(`expected production file not found: ${callerPath}`);
  const mentionsNewColumn = NEW_COLUMN_NAMES.some((c) => file.src.includes(c));
  const mentionsNewModule = NEW_MODULE_EXPORTS.some((n) => file.src.includes(n));
  check(`2. ${callerPath}: calls into db.ts's own functions only -- never mentions a new column name or the new module's exports directly`, !mentionsNewColumn && !mentionsNewModule);
}
// db.ts and planMove.ts, by contrast, ARE expected to reference the new
// module's exports directly -- proven, not just permitted, so a future
// accidental removal of this wiring fails loudly.
check('2. db.ts DOES reference the new module\'s normalize/enforceability helpers (the reviewed A2 integration)', /normalizeGoalActivityDailyFrequency|isGoalActivityDailyFrequencyEnforceable/.test(production.find((x) => x.f === 'apps/web/lib/db.ts')!.src));
check('2. planMove.ts DOES reference the new module\'s normalize/enforceability helpers (the reviewed A2 destination-day re-validation)', /normalizeGoalActivityDailyFrequency|isGoalActivityDailyFrequencyEnforceable/.test(production.find((x) => x.f === 'apps/web/lib/planMove.ts')!.src));

// ============================================================
// 3. The new pure module is imported ONLY by db.ts and planMove.ts (plus
// its own test files, which this production-only scan never sees).
// ============================================================
const importers = production.filter((x) => /from ['"].*goalActivityDailyFrequency['"]/.test(x.src)).map((x) => x.f);
check('3. apps/web/lib/goalActivityDailyFrequency.ts has EXACTLY the two reviewed A2 production importers (db.ts, planMove.ts) -- no other file imports it', importers.length === 2 && importers.includes('apps/web/lib/db.ts') && importers.includes('apps/web/lib/planMove.ts'));

// ============================================================
// 4. The module itself still makes no DB call, consistent with its own
// doc comment ("No DB access here") -- unaffected by A2.
// ============================================================
const moduleSrc = stripComments(fs.readFileSync(path.join(root, 'apps/web/lib/goalActivityDailyFrequency.ts'), 'utf8'));
check('4. goalActivityDailyFrequency.ts contains no SQL, no pool/client reference -- pure domain logic only', !/\bpool\.|\bclient\.|SELECT |INSERT |UPDATE |DELETE /.test(moduleSrc));

// ============================================================
// 5. Migration 0051 itself is unchanged by A2: still additive only, no
// DROP, no NOT NULL, no DEFAULT, no new constraint, touching only the two
// expected tables. A2 adds no new migration of its own.
// ============================================================
const migrationSqlRaw = fs.readFileSync(path.join(root, 'apps/web/prisma/migrations/0051_goal_activity_daily_frequency_foundation/migration.sql'), 'utf8');
const migrationSql = migrationSqlRaw.replace(/--.*$/gm, '');
check('5. the migration contains no DROP of any kind', !/DROP /i.test(migrationSql));
check('5. the migration adds no NOT NULL constraint', !/NOT NULL/i.test(migrationSql));
check('5. the migration sets no DEFAULT value', !/DEFAULT/i.test(migrationSql));
check('5. the migration adds no UNIQUE constraint or index', !/UNIQUE|CREATE INDEX/i.test(migrationSql));
check('5. the migration touches only GoalActivity and GoalActivityOccurrence', /ALTER TABLE "GoalActivity"/.test(migrationSql) && /ALTER TABLE "GoalActivityOccurrence"/.test(migrationSql) && (migrationSql.match(/ALTER TABLE/g) ?? []).length === 2);
check('5. no SECOND migration directory was added for the new columns (A2 needed no schema change)', fs.readdirSync(path.join(root, 'apps/web/prisma/migrations')).filter((d) => /^\d/.test(d)).length === 51);

if (!allPassed) {
  console.error('SOME HPG3-A1/A2 STRUCTURAL GUARD CHECKS FAILED');
  process.exit(1);
}
console.log('ALL HPG3-A1/A2 STRUCTURAL GUARD CHECKS PASSED');
