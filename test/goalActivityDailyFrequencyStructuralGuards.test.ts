/**
 * HPG3-A1 -- architecture guard (pure, no DB). Proves that the four new
 * columns (migration 0051) and the pure domain module
 * (goalActivityDailyFrequency.ts) are genuinely inert in this slice: no
 * production scheduling writer reads or writes them, and the module itself
 * is imported only by its own test files. A LATER ticket (HPG3-A2) is
 * expected to change these facts -- this guard exists so that change is
 * deliberate, not accidental, mirroring the "model before writes"
 * structural guards this codebase already uses for GoalActivityExecution
 * (G2.2.1) and GoalActivityOccurrence (R1).
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
// 1. The four new DB columns are never referenced in any production SQL
// string, anywhere -- not the module that defines them, not a writer, not
// a reader.
// ============================================================
const NEW_COLUMN_NAMES = ['dailyFrequencyKind', 'dailyFrequencyLimit', 'scheduledLocalDate', 'scheduledLocalTimezone'];
for (const column of NEW_COLUMN_NAMES) {
  const referencingFiles = production.filter((x) => x.src.includes(`"${column}"`)).map((x) => x.f);
  check(`1. "${column}" does not appear in any production SQL string (no writer, no reader)`, referencingFiles.length === 0);
}

// ============================================================
// 2. The confirmed, existing scheduling writers from the HPG3 audit are
// completely untouched: their own source text does not mention any of the
// four new columns, the new module, or its exported names.
// ============================================================
const CONFIRMED_SCHEDULING_WRITERS = [
  'apps/web/app/api/plans/route.ts',
  'apps/web/lib/dayConstructorAcceptancePersistence.ts',
  'apps/web/lib/planMove.ts',
  'apps/web/lib/remainingDayRecompositionAcceptance.ts',
  'apps/web/lib/db.ts',
];
const NEW_MODULE_EXPORTS = [
  'goalActivityDailyFrequency',
  'validateGoalActivityDailyFrequency',
  'normalizeGoalActivityDailyFrequency',
  'toPersistedGoalActivityDailyFrequency',
  'isGoalActivityDailyFrequencyEnforceable',
  'validateScheduledLocalDatePair',
];
for (const writerPath of CONFIRMED_SCHEDULING_WRITERS) {
  const file = production.find((x) => x.f === writerPath);
  if (!file) throw new Error(`expected production file not found: ${writerPath}`);
  const mentionsNewColumn = NEW_COLUMN_NAMES.some((c) => file.src.includes(c));
  const mentionsNewModule = NEW_MODULE_EXPORTS.some((n) => file.src.includes(n));
  check(`2. ${writerPath}: does not mention any new column name or the new module's exports`, !mentionsNewColumn && !mentionsNewModule);
}

// ============================================================
// 3. The new pure module itself is imported only by its own test files --
// zero production importers.
// ============================================================
const importers = production.filter((x) => /from ['"].*goalActivityDailyFrequency['"]/.test(x.src)).map((x) => x.f);
check('3. apps/web/lib/goalActivityDailyFrequency.ts has ZERO production importers (schema/domain-only, same discipline as G2.1/R1 before their own wiring tickets)', importers.length === 0);

// ============================================================
// 4. The module itself makes no DB call, consistent with its own doc
// comment ("No DB access here").
// ============================================================
const moduleSrc = stripComments(fs.readFileSync(path.join(root, 'apps/web/lib/goalActivityDailyFrequency.ts'), 'utf8'));
check('4. goalActivityDailyFrequency.ts contains no SQL, no pool/client reference -- pure domain logic only', !/\bpool\.|\bclient\.|SELECT |INSERT |UPDATE |DELETE /.test(moduleSrc));

// ============================================================
// 5. The migration itself is additive only: no DROP, no NOT NULL, no
// DEFAULT, no new constraint, touching only the two expected tables.
// ============================================================
const migrationSqlRaw = fs.readFileSync(path.join(root, 'apps/web/prisma/migrations/0051_goal_activity_daily_frequency_foundation/migration.sql'), 'utf8');
// Strip SQL `--` line comments (this migration's own prose explains "no
// default, no backfill" in English, which would otherwise false-positive
// against the DEFAULT check below) -- only the executable statements are
// checked.
const migrationSql = migrationSqlRaw.replace(/--.*$/gm, '');
check('5. the migration contains no DROP of any kind', !/DROP /i.test(migrationSql));
check('5. the migration adds no NOT NULL constraint', !/NOT NULL/i.test(migrationSql));
check('5. the migration sets no DEFAULT value', !/DEFAULT/i.test(migrationSql));
check('5. the migration adds no UNIQUE constraint or index', !/UNIQUE|CREATE INDEX/i.test(migrationSql));
check('5. the migration touches only GoalActivity and GoalActivityOccurrence', /ALTER TABLE "GoalActivity"/.test(migrationSql) && /ALTER TABLE "GoalActivityOccurrence"/.test(migrationSql) && (migrationSql.match(/ALTER TABLE/g) ?? []).length === 2);

if (!allPassed) {
  console.error('SOME HPG3-A1 STRUCTURAL GUARD CHECKS FAILED');
  process.exit(1);
}
console.log('ALL HPG3-A1 STRUCTURAL GUARD CHECKS PASSED');
