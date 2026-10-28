/**
 * Daily Rhythm V1 PR DR3 -- scope-guard wiring suite. Proves, by reading
 * real shipped source rather than asserting in prose, that DR3's own
 * exclusion list was respected (no schema change, no activity taxonomy
 * change, no Panchang/Muhurta change, no new planning engine, Find a
 * Time/manual overrides untouched) and that Home's "Plan my day" and
 * Goals' "Plan with Aura" genuinely share one recommendation/explanation
 * contract (DR3 section 4), not two independently-maintained paths.
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
  // No new migration, migration count stays 50 (DR3 section 7).
  // ============================================================
  const migrationsDir = path.join(__dirname, '..', 'apps/web/prisma/migrations');
  const migrationDirs = fs.readdirSync(migrationsDir).filter((d) => /^\d{4}_/.test(d));
  // 51, not 50 -- HPG3-A1 (migration 0051) landed on main after DR3 was
  // authored; this count tracks the repository's real history.
  check('1. migration count remains 51 -- DR3 required no schema change', migrationDirs.length === 51);

  // ============================================================
  // dayConstructor.ts (the pure placement engine) and the astrology
  // packages remain untouched by DR3.
  // ============================================================
  const dayConstructorSrc = read('apps/web/lib/dayConstructor.ts');
  check('2. dayConstructor.ts never references dailyRhythm/DailyRhythm -- the pure placement engine is untouched', !/dailyRhythm|DailyRhythm/.test(dayConstructorSrc));
  for (const pkg of ['packages/panchang/src', 'packages/muhurta/src', 'packages/astronomy/src']) {
    const dir = path.join(__dirname, '..', pkg);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
    const offenders = files.filter((f) => /dailyRhythm|DailyRhythm/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
    check(`3. no file under ${pkg} references dailyRhythm/DailyRhythm`, offenders.length === 0);
  }

  // ============================================================
  // No new planning engine -- timingSearch.ts's own FIND algorithm
  // (selectDiversePlanningOptions, the per-minute scoring loop) is
  // unmodified; DR3 only ever supplies a different `limit` value on the
  // EXISTING request shape.
  // ============================================================
  const timingSearchSrc = read('packages/recommendation/src/timingSearch.ts');
  check('4. timingSearch.ts never references dailyRhythm/DailyRhythm -- DR3 adds no new engine, only a conditionally different `limit` value on the existing request', !/dailyRhythm|DailyRhythm/.test(timingSearchSrc));
  const dailyAssistantSrc = read('packages/recommendation/src/dailyAssistant.ts');
  check('4b. dailyAssistant.ts (selectDiversePlanningOptions, the diversification algorithm) never references dailyRhythm/DailyRhythm -- unmodified', !/dailyRhythm|DailyRhythm/.test(dailyAssistantSrc));

  // ============================================================
  // Find a Time was untouched as of DR3 -- as of Daily Rhythm V1 PR
  // DR4-B it is now intentionally Daily-Rhythm-aware (see
  // dailyRhythmDR2Wiring.test.ts's own check 3 for the updated, non-blank
  // assertion and its rationale). Manual overrides (DR3 section 2,
  // "manual override -> never silently changed") remain untouched either
  // way, verified below via planMove.ts.
  // ============================================================
  const planMoveSrc = read('apps/web/lib/planMove.ts');
  check('5b. planMove.ts (the manual-override domain function) never references dailyRhythm/DailyRhythm -- a manual Move is never second-guessed by Daily Rhythm', !/dailyRhythm|DailyRhythm/.test(planMoveSrc));

  // ============================================================
  // Activity taxonomy / catalog untouched -- DR3 only reads
  // ActivityProfile.category, same as DR2.
  // ============================================================
  const catalogSrc = read('packages/recommendation/src/personalizedTasks.ts');
  check('6. the activity catalog (personalizedTasks.ts) never references dailyRhythm/DailyRhythm', !/dailyRhythm|DailyRhythm/.test(catalogSrc));

  // ============================================================
  // Location functionality untouched.
  // ============================================================
  const locationPickerSrc = read('apps/web/components/LocationPicker.tsx');
  check('7. LocationPicker.tsx never references dailyRhythm/DailyRhythm', !/dailyRhythm|DailyRhythm/.test(locationPickerSrc));

  // ============================================================
  // Settings UI untouched by DR3 (DR2 already added DailyRhythmSettings.tsx;
  // DR3 is a scheduling-logic + explanation-text change only).
  // ============================================================
  const settingsComponentSrc = read('apps/web/components/DailyRhythmSettings.tsx');
  check('8. DailyRhythmSettings.tsx is untouched by DR3 -- still no reference to the orchestrator, timing search, or search-limit concepts', !/dayConstructorOrchestrator|timingSearch|SEARCH_LIMIT|searchLimit/.test(settingsComponentSrc));

  // ============================================================
  // Home and Goals entry-point consistency (DR3 section 4): both
  // navigate to the SAME /plan-day route, which mounts the SAME
  // PlanDayClient.tsx -- not two independently-maintained recommendation
  // paths. No new route, no new component was introduced for either.
  // ============================================================
  const pageSrc = read('apps/web/app/page.tsx');
  const goalDetailSrc = read('apps/web/app/goals/[goalId]/GoalDetailClient.tsx');
  check('9. Home\'s "Plan my day" navigates to /plan-day', /window\.location\.href\s*=\s*['"]\/plan-day['"]/.test(pageSrc) || /onPlanDay=\{\(\) => \{ window\.location\.href = '\/plan-day'; \}\}/.test(pageSrc));
  check('9b. Goals\' "Plan with Aura" navigates to /plan-day (with its own fromGoal/activities query params, same route)', /window\.location\.href\s*=\s*`\/plan-day\?/.test(goalDetailSrc));
  check('9c. only ONE /plan-day page exists (apps/web/app/plan-day/page.tsx) -- no second, Goal-specific or Home-specific plan page', fs.existsSync(path.join(__dirname, '..', 'apps/web/app/plan-day/page.tsx')) && !fs.existsSync(path.join(__dirname, '..', 'apps/web/app/goals/plan-day')));
  const planDayPageSrc = read('apps/web/app/plan-day/page.tsx');
  check('9d. the one /plan-day page renders PlanDayClient -- the single, shared client component both entry points ultimately reach', /PlanDayClient/.test(planDayPageSrc));
  const planDayClientSrc = read('apps/web/app/plan-day/PlanDayClient.tsx');
  check('9e. PlanDayClient.tsx calls previewConstructedDay -- the same Day Constructor preview pipeline for every caller, regardless of entry point', /previewConstructedDay/.test(planDayClientSrc));
  check('9f. every real UI caller of previewConstructedDay imports it from the SAME lib/dayConstructorPreviewClient module -- one shared pipeline, however many legitimate callers (PlanDayClient.tsx for Plan, OnboardingJourney.tsx for the onboarding recommendation step), never a second, competing implementation', (() => {
    const componentsDir = path.join(__dirname, '..', 'apps/web/components');
    const appDir = path.join(__dirname, '..', 'apps/web/app');
    function allTsxFiles(dir: string): string[] {
      return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return allTsxFiles(full);
        return entry.name.endsWith('.tsx') ? [full] : [];
      });
    }
    const callers = [...allTsxFiles(componentsDir), ...allTsxFiles(appDir)].filter((f) => /previewConstructedDay/.test(fs.readFileSync(f, 'utf8')));
    return (
      callers.length >= 1 &&
      callers.every((f) => /import \{ previewConstructedDay \} from ['"].*dayConstructorPreviewClient['"]/.test(fs.readFileSync(f, 'utf8')))
    );
  })());

  // ============================================================
  // The new search-coverage logic is reused (not duplicated) at both
  // dayConstructorOrchestrator.ts call sites.
  // ============================================================
  const orchestratorSrc = read('apps/web/lib/dayConstructorOrchestrator.ts');
  check('10. dayConstructorOrchestrator.ts imports resolveDailyRhythmSearchLimit from the shared module, no inline reimplementation', /import \{ applyDailyRhythmPreference, explainDailyRhythmPlacement, resolveDailyRhythmSearchLimit/.test(orchestratorSrc));
  check('10b. resolveDailyRhythmSearchLimit is called exactly twice (the primary loop and the replenishment loop), never a third, duplicated call site', (orchestratorSrc.match(/resolveDailyRhythmSearchLimit\(/g) ?? []).length === 2);

  if (!allPassed) {
    console.error('\nSome Daily Rhythm DR3 Wiring checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL DAILY RHYTHM DR3 WIRING CHECKS PASSED');
  }
}

main();
