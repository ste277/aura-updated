/**
 * Production Migration Release Safety V1 -- component-wiring regression
 * suite. Matches this repository's own established convention for
 * proving deployment/config WIRING facts by reading real, shipped
 * source rather than executing a real deployment (see
 * planDayWiring.test.ts's own doc comment for the precedent this file
 * follows). The actual runtime BEHAVIOR of `vercel-build.sh` (fail-
 * closed on a genuine migration error, no-op when nothing is pending,
 * skipped entirely outside VERCEL_ENV=production, safe under
 * concurrent invocation) was proven directly against disposable local
 * Postgres databases during this ticket's own implementation -- not
 * repeated here, since this repo's test suite never spins up a real
 * Postgres instance from a DB-free CI job (see
 * dayConstructorAcceptancePersistenceDb.test.ts's own doc comment on
 * why that class of test is a dedicated CI job, not this one).
 */
import fs from 'fs';
import path from 'path';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const packageJsonSource: string = fs.readFileSync(path.join(__dirname, '../apps/web/package.json'), 'utf8');
const packageJson: { scripts?: Record<string, string> } = JSON.parse(packageJsonSource);
const buildScriptSource: string = fs.readFileSync(path.join(__dirname, '../apps/web/scripts/vercel-build.sh'), 'utf8');
// Executable lines only -- excludes `#`-prefixed doc-comment prose (which
// legitimately mentions "migrate dev"/"db push"/"DATABASE_URL" as negative
// examples explaining why they're NOT used), matching this repository's
// own established fix for this exact class of self-referential regex
// false positive (see e.g. planDayWiring.test.ts's own history).
const buildScriptCommands: string = buildScriptSource
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');
const ciWorkflowSource: string = fs.readFileSync(path.join(__dirname, '../.github/workflows/ci.yml'), 'utf8');
const vercelJsonSource: string = fs.readFileSync(path.join(__dirname, '../apps/web/vercel.json'), 'utf8');

function main() {
  // ============================================================
  // 1. The new script exists and is wired as Vercel's own recognized
  // build-command override -- this ticket's own section 7 (implement
  // the smallest change; prefer Vercel's own `vercel-build` convention
  // over a dashboard-only override, which would not be version-
  // controlled).
  // ============================================================
  check('1. apps/web/package.json defines a "vercel-build" script', typeof packageJson.scripts?.['vercel-build'] === 'string');
  check('1b. "vercel-build" invokes the checked-in script file, not an inline command', packageJson.scripts?.['vercel-build'] === 'sh scripts/vercel-build.sh');

  // ============================================================
  // 2. The EXISTING "build" script is byte-for-byte unchanged (this
  // ticket's own safety requirement 9: local dev behavior must not
  // change) -- CI's own "Next.js production build" job and every
  // developer's local `npm run build` still resolve to plain `next
  // build`, never touching the migration step, since Vercel is the
  // ONLY caller that ever recognizes the "vercel-build" script name.
  // ============================================================
  check('2. the existing "build" script remains exactly "next build"', packageJson.scripts?.build === 'next build');
  check('2b. the existing "build:check" script is untouched', packageJson.scripts?.['build:check'] === 'AUTH_SECRET=local-build-verification-placeholder-not-for-prod next build');
  check('2c. "start"/"dev" scripts are untouched', packageJson.scripts?.dev === 'next dev' && packageJson.scripts?.start === 'next start');

  // ============================================================
  // 3. Ordinary PR CI never invokes the new script (this ticket's own
  // section 9/Phase 9: "Do not require Production database access from
  // ordinary PR CI" / "A pull request must never mutate Production") --
  // proven by CI's own build job still calling "npm run build" (the
  // untouched, migration-free script), never "vercel-build".
  // ============================================================
  check('3. ci.yml\'s web-build job still runs "npm run build", never "npm run vercel-build"', ciWorkflowSource.includes('run: npm run build') && !ciWorkflowSource.includes('vercel-build'));

  // ============================================================
  // 4. The migration step is gated on VERCEL_ENV=production (this
  // ticket's own section 4/Phase 5/Phase 7) -- a Vercel-injected system
  // variable, never configured by this repository, so this is safe
  // regardless of Preview/Production database topology (section 5's
  // own unresolved question).
  // ============================================================
  check('4. the script gates the migration step on VERCEL_ENV = production', /if \[ "\$VERCEL_ENV" = "production" \]/.test(buildScriptSource));
  check('4b. VERCEL_ENV is never set/overridden by this script itself -- only read (no shell assignment, e.g. "VERCEL_ENV=..." at the start of a line)', !/^\s*VERCEL_ENV=/m.test(buildScriptSource));

  // ============================================================
  // 5. Only `prisma migrate deploy` is ever invoked -- never `migrate
  // dev` (interactive/would prompt) or `db push` (bypasses migration
  // history) -- this ticket's own safety requirements 1/2.
  // ============================================================
  check('5. the script runs "npx prisma migrate deploy"', buildScriptCommands.includes('npx prisma migrate deploy'));
  check('5b. the script never RUNS "prisma migrate dev" (doc-comment prose mentioning it as a negative example is fine)', !buildScriptCommands.includes('migrate dev'));
  check('5c. the script never RUNS "prisma db push" (doc-comment prose mentioning it as a negative example is fine)', !buildScriptCommands.includes('db push'));
  check('5d. the script never issues a raw CREATE/ALTER/DROP TABLE statement of its own', !/CREATE TABLE|ALTER TABLE|DROP TABLE/i.test(buildScriptCommands));

  // ============================================================
  // 6. Fail-closed behavior (this ticket's own Phase 5/8-C): `set -e`
  // ensures a failing `prisma migrate deploy` aborts the script before
  // `next build` ever runs, so a failed migration can never let
  // incompatible application code build successfully (and therefore
  // can never be promoted to serve Production traffic, per Vercel's
  // own build-must-succeed-before-promotion semantics -- the one
  // genuine ordering guarantee this architecture has, see the script's
  // own doc comment for why a separate GitHub Actions job could not
  // provide this).
  // ============================================================
  check('6. the script sets "set -e" so any failing command aborts it', /^set -e$/m.test(buildScriptSource));
  check(
    '6b. "next build" is the LAST command in the script, unconditionally reached only after the gated migration step',
    buildScriptSource.trim().split('\n').pop()?.trim() === 'next build'
  );

  // ============================================================
  // 7. No production credential is embedded, printed, or hardcoded in
  // the script itself (this ticket's own safety requirement 3) -- it
  // only ever references environment variables Vercel's own build
  // environment already supplies (DATABASE_URL implicitly, via
  // `prisma migrate deploy`'s own env("DATABASE_URL") resolution in
  // schema.prisma -- never read directly by this script).
  // ============================================================
  check('7. the script never REFERENCES DATABASE_URL directly in an executable line (Prisma resolves it itself from schema.prisma; doc-comment prose explaining that is fine)', !buildScriptCommands.includes('DATABASE_URL'));
  check('7b. no literal connection string / password-shaped value appears anywhere in the script', !/postgres(ql)?:\/\//.test(buildScriptSource));

  // ============================================================
  // 8. Existing Vercel cron configuration is untouched (this ticket's
  // own safety requirement 10).
  // ============================================================
  check('8. apps/web/vercel.json still defines exactly the pre-existing cron job, untouched', vercelJsonSource.includes('"/api/internal/reminders/dispatch"') && vercelJsonSource.includes('"0 13 * * *"'));

  if (!allPassed) {
    console.error('\nSome Production Migration Release Safety checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL PRODUCTION MIGRATION RELEASE SAFETY CHECKS PASSED');
  }
}

main();
