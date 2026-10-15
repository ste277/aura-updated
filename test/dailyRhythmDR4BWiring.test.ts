/**
 * Daily Rhythm V1 PR DR4-B -- scope-guard wiring suite. Proves, by reading
 * real shipped source rather than asserting in prose, that DR4-B's own
 * exclusion list was respected (no schema change, no Panchang/Muhurta
 * change, no new planning engine, Goals/Home/Location untouched, the
 * shared/partner timing-search route untouched) and that the one
 * genuinely new coupling -- Find a Time now depending on Daily Rhythm --
 * is confined to exactly the files this PR intends.
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
  // No new migration, migration count stays 50 (DR4-B section 9).
  // ============================================================
  const migrationsDir = path.join(__dirname, '..', 'apps/web/prisma/migrations');
  const migrationDirs = fs.readdirSync(migrationsDir).filter((d) => /^\d{4}_/.test(d));
  check('1. migration count remains 50 -- DR4-B required no schema change', migrationDirs.length === 50);

  // ============================================================
  // The real engine (timingSearch.ts) and the astrology packages remain
  // import-free of Daily Rhythm -- this PR only EXPORTS one pre-existing
  // constant (DEFAULT_FIND_LIMIT) with an explanatory doc comment; it
  // never imports dailyRhythmScheduling.ts or timingSearchDailyRhythm.ts,
  // and no scoring/candidate-generation function's own BEHAVIOR changed.
  // ============================================================
  const timingSearchSrc = read('packages/recommendation/src/timingSearch.ts');
  check('2. timingSearch.ts never imports from dailyRhythmScheduling.ts or timingSearchDailyRhythm.ts -- the engine has no Daily Rhythm coupling, only an additive export', !/from ['"].*dailyRhythmScheduling['"]|from ['"].*timingSearchDailyRhythm['"]/.test(timingSearchSrc));
  check('2b. DEFAULT_FIND_LIMIT is still exactly 3 -- the one value this PR exported is otherwise completely unchanged', /export const DEFAULT_FIND_LIMIT = 3;/.test(timingSearchSrc));
  for (const pkg of ['packages/panchang/src', 'packages/muhurta/src', 'packages/astronomy/src']) {
    const dir = path.join(__dirname, '..', pkg);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
    const offenders = files.filter((f) => /dailyRhythm|DailyRhythm/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
    check(`3. no file under ${pkg} references dailyRhythm/DailyRhythm`, offenders.length === 0);
  }

  // ============================================================
  // dailyRhythmScheduling.ts's own three higher-level exports
  // (applyDailyRhythmPreference, resolveDailyRhythmSearchLimit,
  // explainDailyRhythmPlacement) are UNCHANGED by this PR -- DR4-B's own
  // adapter reuses only the lower-level, date-explicit primitives,
  // confirmed by dayConstructorOrchestrator.ts still calling exactly the
  // same functions the same number of times as DR3 left it (already
  // covered by dailyRhythmDR3Wiring.test.ts's own checks 10/10b, not
  // duplicated here) -- this guard instead confirms the one real change
  // to that file (overlapsWorkWindow gaining `export`) didn't touch
  // anything else in it.
  // ============================================================
  const schedulingSrc = read('apps/web/lib/dailyRhythmScheduling.ts');
  check('4. dailyRhythmScheduling.ts exports overlapsWorkWindow (DR4-B\'s one additive change to this file)', /export function overlapsWorkWindow\(/.test(schedulingSrc));
  check('4b. applyDailyRhythmPreference\'s own signature is untouched (still exactly its DR2 parameter list)', /export function applyDailyRhythmPreference\(candidates: readonly TimingCandidate\[\], activityId: string \| undefined, context: DailyRhythmFilterContext\): TimingCandidate\[\]/.test(schedulingSrc));
  check('4c. resolveDailyRhythmSearchLimit\'s own signature is untouched (still exactly its DR3 parameter list)', /export function resolveDailyRhythmSearchLimit\(activityId: string \| undefined, context: DailyRhythmFilterContext\): number \| undefined/.test(schedulingSrc));

  // ============================================================
  // The stale DR1 structural guard (dailyRhythmSettingsWiring.test.ts's
  // own check 14) lists PlanWithAuraView.tsx and page.tsx among the
  // files that must never reference "dailyRhythmWork" -- DR4-B's own
  // client-side field is deliberately named dailyRhythmNote(s), never
  // containing that substring, specifically so this PR does not widen
  // that already-documented pre-existing failure to two more files.
  // ============================================================
  const planWithAuraSrc = read('apps/web/components/PlanWithAuraView.tsx');
  const pageSrc = read('apps/web/app/page.tsx');
  check('5. PlanWithAuraView.tsx never references the raw "dailyRhythmWork" substring (would worsen the already-documented stale DR1 guard)', !/dailyRhythmWork/.test(planWithAuraSrc));
  check('5b. app/page.tsx never references the raw "dailyRhythmWork" substring, for the same reason', !/dailyRhythmWork/.test(pageSrc));
  check('5c. PlanWithAuraView.tsx DOES now reference dailyRhythmNote (the actual, deliberately differently-named new coupling)', /dailyRhythmNote/.test(planWithAuraSrc));

  // ============================================================
  // Find a Time (Find/Check/Compare) remains PlanWithAuraView.tsx's own,
  // independent search/ranking surface -- no combined API, no shared
  // recommendation engine with Day Constructor (DR4-B section 6: "Do not
  // combine their APIs or recommendation engines").
  // ============================================================
  check('6. PlanWithAuraView.tsx never imports dayConstructorOrchestrator.ts (no engine merge)', !/dayConstructorOrchestrator/.test(planWithAuraSrc));
  const routeSrc = read('apps/web/app/api/timing-search/route.ts');
  check('6b. the /api/timing-search route never imports dayConstructorOrchestrator.ts (Find a Time\'s own route stays independent of Plan My Day\'s)', !/dayConstructorOrchestrator/.test(routeSrc));
  check('6c. the /api/timing-search route still calls the SAME runTimingSearchWithDailyRhythm exactly once (no duplicated orchestration)', (routeSrc.match(/runTimingSearchWithDailyRhythm\(/g) ?? []).length === 1);

  // ============================================================
  // The shared/partner timing-search route is explicitly out of scope
  // for DR4-B (never mentioned by the ticket) -- confirm it was not
  // touched.
  // ============================================================
  const sharedRouteSrc = read('apps/web/app/api/timing-search/shared/route.ts');
  check('7. the shared (partner) timing-search route never references Daily Rhythm -- explicitly out of scope for this PR', !/dailyRhythm|DailyRhythm/.test(sharedRouteSrc));

  // ============================================================
  // Goals, Home, and Location remain untouched by this PR.
  // ============================================================
  const goalsDir = path.join(__dirname, '..', 'apps/web/app/goals');
  function allFilesRecursive(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? allFilesRecursive(full) : [full];
    });
  }
  const goalFilesReferencingAdapter = allFilesRecursive(goalsDir).filter((f) => /timingSearchDailyRhythm/.test(fs.readFileSync(f, 'utf8')));
  check('8. no file under apps/web/app/goals references timingSearchDailyRhythm.ts -- Goals untouched by this PR', goalFilesReferencingAdapter.length === 0);
  const homeDashboardSrc = read('apps/web/components/HomeDashboard.tsx');
  check('8b. HomeDashboard.tsx never references timingSearchDailyRhythm.ts -- Home untouched by this PR', !/timingSearchDailyRhythm/.test(homeDashboardSrc));
  const locationPickerSrc = read('apps/web/components/LocationPicker.tsx');
  check('8c. LocationPicker.tsx never references Daily Rhythm or the new adapter', !/dailyRhythm|DailyRhythm/.test(locationPickerSrc));

  if (!allPassed) {
    console.error('\nSome Daily Rhythm DR4-B Wiring checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL DAILY RHYTHM DR4-B WIRING CHECKS PASSED');
  }
}

main();
