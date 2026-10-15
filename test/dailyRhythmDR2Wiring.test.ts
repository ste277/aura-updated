/**
 * Daily Rhythm V1 PR DR2 -- scope-guard wiring suite. Proves, by reading
 * real shipped source rather than asserting in prose, that DR2's own
 * explicit exclusion list was respected: no second scheduling engine, no
 * change to Find a Time / Location / Goals / the activity catalog
 * taxonomy / Panchang / Muhurta / Settings UI / the database schema.
 */
import fs from 'fs';
import path from 'path';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function read(rel: string): string {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

function main() {
  // ============================================================
  // No new migration, migration count stays 50.
  // ============================================================
  const migrationsDir = path.join(__dirname, '..', 'apps/web/prisma/migrations');
  const migrationDirs = fs.readdirSync(migrationsDir).filter((d) => /^\d{4}_/.test(d));
  check('1. migration count remains 50 -- DR2 required no schema change', migrationDirs.length === 50);
  check('1b. no migration directory references Daily Rhythm (DR1\'s own 0050 is the only, pre-existing one)', migrationDirs.filter((d) => /daily_rhythm/i.test(d)).length === 1 && migrationDirs.includes('0050_user_daily_rhythm_preferences'));

  // ============================================================
  // dayConstructor.ts (the pure placement engine) remains untouched --
  // no DR2 reference anywhere in it.
  // ============================================================
  const dayConstructorSrc = read('apps/web/lib/dayConstructor.ts');
  check('2. dayConstructor.ts never references dailyRhythm/DailyRhythm -- the pure placement engine is untouched', !/dailyRhythm|DailyRhythm/.test(dayConstructorSrc));

  // ============================================================
  // Find a Time (PlanWithAuraView.tsx) was untouched as of DR2 -- as of
  // Daily Rhythm V1 PR DR4-B it is now INTENTIONALLY Daily-Rhythm-aware
  // (the whole point of that later, separately-approved ticket), so this
  // check no longer asserts total silence; it instead confirms the only
  // reference is the real, deliberate `dailyRhythmNote(s)` coupling DR4-B
  // introduced, never a stray/accidental one, and that this file still
  // never imports dayConstructorOrchestrator.ts (no engine merge, DR4-B's
  // own explicit constraint -- also covered by dailyRhythmDR4BWiring.test.ts).
  // ============================================================
  const planWithAuraSrc = read('apps/web/components/PlanWithAuraView.tsx');
  check('3. PlanWithAuraView.tsx\'s only Daily Rhythm reference is the DR4-B dailyRhythmNote(s) coupling, never a stray dailyRhythmWork/other reference', /dailyRhythmNote/.test(planWithAuraSrc) && !/dailyRhythmWork/.test(planWithAuraSrc) && !/dayConstructorOrchestrator/.test(planWithAuraSrc));

  // ============================================================
  // Location confirmation is untouched.
  // ============================================================
  const locationPickerSrc = read('apps/web/components/LocationPicker.tsx');
  const locationRouteSrc = read('apps/web/app/api/users/location/route.ts');
  check('4. LocationPicker.tsx never references dailyRhythm/DailyRhythm', !/dailyRhythm|DailyRhythm/.test(locationPickerSrc));
  check('4b. PATCH /api/users/location never references dailyRhythm/DailyRhythm', !/dailyRhythm|DailyRhythm/.test(locationRouteSrc));

  // ============================================================
  // Goals data model is untouched.
  // ============================================================
  const goalsSrc = read('apps/web/lib/goals.ts');
  const goalActivityRhythmSrc = read('apps/web/lib/goalActivityRhythm.ts');
  check('5. goals.ts never references dailyRhythm/DailyRhythm', !/dailyRhythm|DailyRhythm/.test(goalsSrc));
  check('5b. goalActivityRhythm.ts (the UNRELATED Goal-frequency-cadence feature) never references dailyRhythm/DailyRhythm -- confirms the two independently-named "Rhythm" features stay structurally separate', !/dailyRhythm|DailyRhythm/.test(goalActivityRhythmSrc));

  // ============================================================
  // Activity catalog taxonomy is untouched -- DR2 only READS category
  // metadata, it never adds a new category or modifies the catalog.
  // ============================================================
  const catalogSrc = read('packages/recommendation/src/personalizedTasks.ts');
  check('6. the activity catalog (personalizedTasks.ts) never references dailyRhythm/DailyRhythm -- DR2 only reads its existing category field, never writes to it', !/dailyRhythm|DailyRhythm/.test(catalogSrc));
  check(
    '6b. ActivityCategory still has exactly the original 15 values -- no new category introduced',
    /export type ActivityCategory =\s*\n(\s*\|\s*'[A-Z_]+'\s*\n){15}/.test(catalogSrc) || (catalogSrc.match(/export type ActivityCategory =[\s\S]*?;/)?.[0].match(/'[A-Z_]+'/g) ?? []).length === 15
  );

  // ============================================================
  // Panchang/Muhurta/astronomy packages are untouched by DR2, and never
  // import the new Daily Rhythm module (confirms the dependency only
  // runs one way: dailyRhythmScheduling.ts reads the catalog, the
  // astrology packages never know Daily Rhythm exists).
  // ============================================================
  for (const pkg of ['packages/panchang/src', 'packages/muhurta/src', 'packages/astronomy/src']) {
    const dir = path.join(__dirname, '..', pkg);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
    const offenders = files.filter((f) => /dailyRhythm|DailyRhythm/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
    check(`7. no file under ${pkg} references dailyRhythm/DailyRhythm`, offenders.length === 0);
  }

  // ============================================================
  // Settings UI (DR1's own DailyRhythmSettings.tsx / YouView.tsx) is
  // untouched by DR2 -- DR2 is a scheduling-logic change only.
  // ============================================================
  const settingsComponentSrc = read('apps/web/components/DailyRhythmSettings.tsx');
  check('8. DailyRhythmSettings.tsx (DR1\'s own Settings panel) never references the orchestrator, timing search, or the activity catalog -- DR2 added no new UI', !/dayConstructorOrchestrator|timingSearch|personalizedTasks/.test(settingsComponentSrc));

  // ============================================================
  // Home is untouched (already proven by DR1's own wiring test for the
  // DR1 fields; re-confirmed here for the scheduling-logic module name).
  // ============================================================
  for (const file of ['apps/web/components/HomeDashboard.tsx', 'apps/web/app/page.tsx']) {
    check(`9. ${file} never references the new dailyRhythmScheduling module or its exports`, !/dailyRhythmScheduling|classifyActivityForDailyRhythm|applyDailyRhythmPreference/.test(read(file)));
  }

  // ============================================================
  // The new module exists and is reused (not duplicated) at both
  // dayConstructorOrchestrator.ts call sites.
  // ============================================================
  const orchestratorSrc = read('apps/web/lib/dayConstructorOrchestrator.ts');
  check('10. dayConstructorOrchestrator.ts imports applyDailyRhythmPreference/explainDailyRhythmPlacement from the shared module, no inline reimplementation', /import \{ applyDailyRhythmPreference, explainDailyRhythmPlacement.*\} from '\.\/dailyRhythmScheduling'/.test(orchestratorSrc));
  check('10b. applyDailyRhythmPreference is called exactly twice (the primary loop and the replenishment loop), never a third, duplicated call site', (orchestratorSrc.match(/applyDailyRhythmPreference\(/g) ?? []).length === 2);
  check('10c. dayConstructorOrchestrator.ts never imports from packages/astronomy or packages/muhurta directly (DR2 adds no new astrology coupling)', !/from '.*packages\/astronomy/.test(orchestratorSrc) && !/from '.*packages\/muhurta\/src\/(?!muhurtaEngine)/.test(orchestratorSrc));

  if (!allPassed) {
    console.error('\nSome Daily Rhythm DR2 Wiring checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL DAILY RHYTHM DR2 WIRING CHECKS PASSED');
  }
}

main();
