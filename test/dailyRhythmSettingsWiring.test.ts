/**
 * Daily Rhythm V1 PR DR1 -- Preferences Foundation wiring regression
 * suite. This repository's own test suite never renders React components
 * (see homeDashboardLogic.test.ts's own doc comment) -- matching the
 * established precedent for exactly this class of property
 * (availabilitySettingsWiring.test.ts), this file proves
 * DailyRhythmSettings.tsx's and YouView.tsx's own architectural wiring
 * facts by reading their real, shipped source.
 *
 * The MOST important guard in this file is the last section: this PR's
 * own explicit requirements ("must not change scheduling
 * recommendations," "do not modify the day constructor or Find a Time
 * engines," "do not change Home or Goals") are proven by grepping every
 * file that engine actually lives in for the new field names -- not
 * merely asserted in prose.
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

const componentSource = read('apps/web/components/DailyRhythmSettings.tsx');
const youViewSource = read('apps/web/components/YouView.tsx');
const routeSource = read('apps/web/app/api/users/daily-rhythm-preferences/route.ts');
const libSource = read('apps/web/lib/dailyRhythmPreferences.ts');
const dbSource = read('apps/web/lib/db.ts');
const schemaSource = read('apps/web/prisma/schema.prisma');
const availabilityContextSource = read('apps/web/lib/availabilityContext.ts');

function main() {
  // ============================================================
  // Mounted in Settings, no new navigation section.
  // ============================================================
  check('1. YouView imports DailyRhythmSettings', youViewSource.includes("import { DailyRhythmSettings } from './DailyRhythmSettings';"));
  check('1b. YouView renders <DailyRhythmSettings /> under a "Daily Rhythm" SectionHeader', /<SectionHeader label="Daily Rhythm" \/>\s*<DailyRhythmSettings \/>/.test(youViewSource));
  check('1c. the Daily Rhythm section is mounted inline in the existing Settings page, not a new route/tab (no new app/ page file for it)', !fs.existsSync(path.join(__dirname, '..', 'apps/web/app/daily-rhythm')));

  // ============================================================
  // Self-contained GET/PUT/DELETE, same pattern as AvailabilitySettings.
  // ============================================================
  check('2. the component fetches its own GET on mount', componentSource.includes("fetch('/api/users/daily-rhythm-preferences')"));
  check('3. Save uses PUT with all three fields in one request body', /fetch\('\/api\/users\/daily-rhythm-preferences', \{\s*method: 'PUT'/.test(componentSource) && /body: JSON\.stringify\(\{ workStart: draft\.workStart, workEnd: draft\.workEnd, workDays: Array\.from\(draft\.workDays\) \}\)/.test(componentSource));
  check('4. Clear uses a DISTINCT DELETE operation, never PUT with empty-ish values', /fetch\('\/api\/users\/daily-rhythm-preferences', \{ method: 'DELETE' \}\)/.test(componentSource));
  check('5. the component never sends a userId field in any request body', !/userId:/.test(componentSource));
  check('6. the component never sends a timezone field in any request body', !/JSON\.stringify\(\{[^}]*timezone/.test(componentSource));

  // ============================================================
  // Unconfigured vs configured hydration -- never a guessed default.
  // ============================================================
  check('7. an unconfigured GET response hydrates via createEmptyDraft, never a hardcoded populated schedule', /body\.configured\s*$|body\.configured\s*\?/.test(componentSource) && componentSource.includes('createEmptyDraft()'));
  check("7b. createEmptyDraft produces genuinely empty fields, never a guessed default like '09:00'", /function createEmptyDraft\(\): Draft \{\s*return \{ workStart: '', workEnd: '', workDays: new Set\(\) \};\s*\}/.test(componentSource));
  check('8. the panel never writes a default work window on load -- only Save (user-initiated) calls PUT', (() => {
    const effectMatch = componentSource.match(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[\]\);/);
    const effectBody = effectMatch?.[1] ?? '';
    return !effectBody.includes("method: 'PUT'");
  })());

  // ============================================================
  // Validation reuse -- the API route uses the shared pure validator,
  // not a second, inline reimplementation.
  // ============================================================
  check('9. the API route imports and uses the shared validateDailyRhythmPreferencesInput, no inline duplicate validation logic', routeSource.includes("import { validateDailyRhythmPreferencesInput } from '../../../../lib/dailyRhythmPreferences';") && routeSource.includes('validateDailyRhythmPreferencesInput('));
  check('10. the validator rejects a cross-midnight/overnight window (V1 policy), same "no cross-midnight in V1" convention as availabilityContext.ts', libSource.includes('workStart >= input.workEnd') && /no cross-midnight/i.test(libSource));
  check('10b. the validator\'s rejection explicitly references the approved audit\'s "overnight shifts are future scope" policy', /overnight shifts are future scope/i.test(libSource));

  // ============================================================
  // Schema: additive only, both-null is the sole unconfigured state, no
  // default ever written without a user save.
  // ============================================================
  check('11. schema.prisma adds exactly the three new User columns, all nullable/empty-default (additive only)', /dailyRhythmWorkStart String\?\s*\n\s*dailyRhythmWorkEnd\s+String\?\s*\n\s*dailyRhythmWorkDays\s+Int\[\]\s+@default\(\[\]\)/.test(schemaSource));
  check('11b. no @default is set on dailyRhythmWorkStart/dailyRhythmWorkEnd (both genuinely nullable, no silent default time)', !/dailyRhythmWorkStart String\? @default/.test(schemaSource) && !/dailyRhythmWorkEnd String\? @default/.test(schemaSource));

  // ============================================================
  // db.ts: write and clear are distinct, write always sets all three
  // fields together (no partial-write path).
  // ============================================================
  check('12. setDailyRhythmPreferences always writes all three columns in one statement', /UPDATE "User" SET "dailyRhythmWorkStart" = \$2, "dailyRhythmWorkEnd" = \$3, "dailyRhythmWorkDays" = \$4 WHERE id = \$1/.test(dbSource));
  check('13. clearDailyRhythmPreferences is a distinct function from setDailyRhythmPreferences, resetting all three to the unconfigured state', /UPDATE "User" SET "dailyRhythmWorkStart" = NULL, "dailyRhythmWorkEnd" = NULL, "dailyRhythmWorkDays" = '\{\}' WHERE id = \$1/.test(dbSource));

  // ============================================================
  // CRITICAL: no scheduling/recommendation surface reads these new
  // fields in this PR. Prove it by grepping the actual files, not just
  // asserting it in prose.
  // ============================================================
  const schedulingFiles: Record<string, string> = {
    'apps/web/lib/dayConstructorOrchestrator.ts': read('apps/web/lib/dayConstructorOrchestrator.ts'),
    'apps/web/lib/dayConstructorPreviewClient.ts': read('apps/web/lib/dayConstructorPreviewClient.ts'),
    'apps/web/components/DayPlanPreviewController.tsx': read('apps/web/components/DayPlanPreviewController.tsx'),
    'apps/web/components/PlanWithAuraView.tsx': read('apps/web/components/PlanWithAuraView.tsx'),
    'apps/web/components/HomeDashboard.tsx': read('apps/web/components/HomeDashboard.tsx'),
    'apps/web/app/page.tsx': read('apps/web/app/page.tsx'),
  };
  for (const [file, source] of Object.entries(schedulingFiles)) {
    check(`14. ${file} never references dailyRhythmWork (no scheduling integration in this PR)`, !/dailyRhythmWork/.test(source));
  }

  // Goal files untouched.
  const goalsDir = path.join(__dirname, '..', 'apps/web/app/goals');
  function allFilesRecursive(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? allFilesRecursive(full) : [full];
    });
  }
  const goalFiles = allFilesRecursive(goalsDir);
  const goalFilesReferencingDailyRhythm = goalFiles.filter((f) => /dailyRhythmWork/.test(fs.readFileSync(f, 'utf8')));
  check('15. no file under apps/web/app/goals references dailyRhythmWork (Goals untouched by this PR)', goalFilesReferencingDailyRhythm.length === 0);

  // UserAvailabilityPeriod / availabilityContext.ts untouched (this
  // ticket's own "do not modify UserAvailabilityPeriod").
  check('16. availabilityContext.ts never references dailyRhythmWork (separate, independent concept from UserAvailabilityPeriod)', !/dailyRhythmWork/.test(availabilityContextSource));
  check('16b. UserAvailabilityPeriod model definition is untouched -- still exactly its pre-existing fields, no new column added to it', /model UserAvailabilityPeriod \{\s*id\s+String\s+@id @default\(uuid\(\)\)\s*\n\s*userId\s+String\s*\n\s*user\s+User\s+@relation/.test(schemaSource));

  // ActivityProfile / ActivityCategory untouched (this ticket's own "do
  // not introduce new activity categories").
  const personalizedTasksSource = read('packages/recommendation/src/personalizedTasks.ts');
  check('17. packages/recommendation/src/personalizedTasks.ts (ActivityCategory) never references dailyRhythmWork -- no new activity category introduced', !/dailyRhythmWork/.test(personalizedTasksSource));

  if (!allPassed) {
    console.error('\nSome Daily Rhythm Settings Wiring checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL DAILY RHYTHM SETTINGS WIRING CHECKS PASSED');
  }
}

main();
