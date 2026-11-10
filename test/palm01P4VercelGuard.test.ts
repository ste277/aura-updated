/**
 * AURA-PALM-01-P4 -- Vercel build guard and CI structure regression tests.
 *
 * Proves that the REAL apps/web/scripts/vercel-build.sh (the script Vercel
 * runs for every Preview and Production build) executes the REAL Palmistry
 * bundle scanner after `next build`, and that a scanner failure fails the
 * build. Runs entirely in an isolated temp tree with fake `next` / `npx`
 * binaries on PATH -- no deployment, no Vercel credentials, no database.
 *
 *   npx ts-node test/palm01P4VercelGuard.test.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean): void {
  if (condition) {
    passed++;
    console.log(`OK   ${label}`);
  } else {
    failed++;
    console.log(`FAIL ${label}`);
  }
}

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const VERCEL_BUILD = 'apps/web/scripts/vercel-build.sh';

// ============================================================
// A. Static shape of vercel-build.sh
// ============================================================
const script = read(VERCEL_BUILD);
const codeLines = script.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const idxSetE = codeLines.findIndex((l) => l === 'set -e');
const idxNextBuild = codeLines.findIndex((l) => l === 'next build');
const idxScanner = codeLines.findIndex((l) => /^node "\$SCRIPT_DIR\/check-palmistry-bundle\.js"$/.test(l));
check('A1. vercel-build.sh runs `set -e` before anything else', idxSetE === 0);
check('A2. vercel-build.sh invokes the Palmistry scanner', idxScanner >= 0);
check('A3. the scanner runs after `next build`', idxNextBuild >= 0 && idxScanner > idxNextBuild);
check('A4. the scanner is the last command (nothing after it can mask its exit code)', idxScanner === codeLines.length - 1);
check('A5. no exit-code swallowing anywhere in the script', !/\|\|\s*true|set \+e|\|\|\s*:|; *true\b|trap /.test(codeLines.join('\n')));
check('A6. scanner path is resolved from the script directory (cwd-independent)', codeLines.includes('SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"'));
check('A7. Production-only migration step is preserved', /if \[ "\$VERCEL_ENV" = "production" \]; then/.test(script) && /npx prisma migrate deploy/.test(script));
check('A8. apps/web package.json still maps vercel-build to this script', JSON.parse(read('apps/web/package.json')).scripts['vercel-build'] === 'sh scripts/vercel-build.sh');

// ============================================================
// B. Behaviour: run the real script in an isolated tree
// ============================================================
type NextMode = 'clean' | 'leak' | 'fail' | 'empty';
function runVercelBuild(opts: { nextMode: NextMode; vercelEnv?: string; approval?: string | null }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'palm-vercel-guard-'));
  try {
    const web = path.join(tmp, 'apps/web');
    fs.mkdirSync(path.join(web, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'packages/palmistry/src'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'bin'), { recursive: true });
    // Real guard code, copied (never symlinked).
    fs.copyFileSync(path.join(ROOT, VERCEL_BUILD), path.join(web, 'scripts/vercel-build.sh'));
    fs.copyFileSync(path.join(ROOT, 'apps/web/scripts/check-palmistry-bundle.js'), path.join(web, 'scripts/check-palmistry-bundle.js'));
    fs.copyFileSync(path.join(ROOT, 'apps/web/palmistry-build-exclusion.js'), path.join(web, 'palmistry-build-exclusion.js'));
    if (opts.approval !== null) {
      fs.writeFileSync(path.join(tmp, 'packages/palmistry/src/review-status.json'), opts.approval ?? '{"status":"PENDING_HUMAN_REVIEW","approvedBy":null}');
    }
    const log = path.join(tmp, 'calls.log');
    // Fake `next`: mimics next build clearing its own output (keeping cache),
    // then writes a production-shaped artifact set.
    fs.writeFileSync(
      path.join(tmp, 'bin/next'),
      `#!/bin/sh
echo "next $*" >> "${log}"
case "$FAKE_NEXT_MODE" in
  fail) echo "fake next build failed" >&2; exit 3 ;;
esac
rm -rf .next/static .next/server .next/standalone
[ "$FAKE_NEXT_MODE" = "empty" ] && exit 0
mkdir -p .next/static/chunks/app .next/server/app .next/standalone
echo 'console.log("app")' > .next/static/chunks/app/page-abc.js
echo 'module.exports={}' > .next/server/app/page.js
if [ "$FAKE_NEXT_MODE" = "leak" ]; then
  echo 'var c={status:"PENDING_HUMAN_REVIEW",id:"zysk-2025"};' > .next/static/chunks/app/leak-def.js
fi
exit 0
`,
      { mode: 0o755 }
    );
    // Fake `npx`: records the call (Production migrations) and succeeds.
    fs.writeFileSync(path.join(tmp, 'bin/npx'), `#!/bin/sh\necho "npx $*" >> "${log}"\nexit 0\n`, { mode: 0o755 });
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${path.join(tmp, 'bin')}${path.delimiter}${process.env.PATH}`, FAKE_NEXT_MODE: opts.nextMode };
    delete env.VERCEL_ENV;
    if (opts.vercelEnv) env.VERCEL_ENV = opts.vercelEnv;
    const res = spawnSync('sh', ['scripts/vercel-build.sh'], { cwd: web, env, encoding: 'utf8' });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
    return { status: res.status, out: `${res.stdout}\n${res.stderr}`, calls };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const clean = runVercelBuild({ nextMode: 'clean', vercelEnv: 'preview' });
check('B1. Preview + clean unpublished build: exits 0', clean.status === 0);
check('B2. ... and the scanner actually ran and reported OK', /\[palmistry-bundle\] OK: none of \d+ Palmistry sentinels/.test(clean.out));
check('B3. ... and no migration ran in Preview', clean.calls.every((c) => !c.startsWith('npx')) && clean.calls.length === 1);

const leak = runVercelBuild({ nextMode: 'leak', vercelEnv: 'preview' });
check('B4. Preview + planted sentinel in a production artifact: build FAILS (non-zero exit)', typeof leak.status === 'number' && leak.status !== 0);
check('B5. ... with the scanner FAIL message naming the leaked file', /\[palmistry-bundle\] FAIL/.test(leak.out) && /leak-def\.js/.test(leak.out));

const nextFails = runVercelBuild({ nextMode: 'fail', vercelEnv: 'preview' });
check('B6. `next build` failure fails the Vercel build', typeof nextFails.status === 'number' && nextFails.status !== 0);
check('B7. ... and the scanner does not run after a failed build', !/\[palmistry-bundle\]/.test(nextFails.out));

const empty = runVercelBuild({ nextMode: 'empty', vercelEnv: 'preview' });
check('B8. scanner cannot inspect artifacts (no .next/static): build FAILS', typeof empty.status === 'number' && empty.status !== 0 && /no \.next\/static found/.test(empty.out));

const missing = runVercelBuild({ nextMode: 'clean', vercelEnv: 'preview', approval: null });
check('B9. missing approval file: build FAILS', typeof missing.status === 'number' && missing.status !== 0);

const invalid = runVercelBuild({ nextMode: 'clean', vercelEnv: 'preview', approval: '{"status": "APPROVED",' });
check('B10. malformed approval file: build FAILS', typeof invalid.status === 'number' && invalid.status !== 0);

const unknownLeak = runVercelBuild({ nextMode: 'leak', vercelEnv: 'preview', approval: '{"status":"approved","approvedBy":null}' });
check('B11. non-exact approval ("approved") is treated as unapproved: leaked content FAILS the build', typeof unknownLeak.status === 'number' && unknownLeak.status !== 0);

const prodClean = runVercelBuild({ nextMode: 'clean', vercelEnv: 'production' });
const migrateIdx = prodClean.calls.findIndex((c) => c === 'npx prisma migrate deploy');
const nextIdx = prodClean.calls.findIndex((c) => c.startsWith('next '));
check('B12. Production + clean build: exits 0 with the scanner OK', prodClean.status === 0 && /\[palmistry-bundle\] OK/.test(prodClean.out));
check('B13. Production still applies migrations, before `next build`', migrateIdx >= 0 && nextIdx > migrateIdx);

const prodLeak = runVercelBuild({ nextMode: 'leak', vercelEnv: 'production' });
check('B14. Production + planted sentinel: build FAILS (deployment never promoted)', typeof prodLeak.status === 'number' && prodLeak.status !== 0);

const approvedLeak = runVercelBuild({ nextMode: 'leak', vercelEnv: 'preview', approval: '{"status":"APPROVED","approvedBy":{"reviewer":"FIXTURE","date":"n/a"}}' });
check('B15. exact APPROVED semantics unchanged: scanner allows inclusion (build exits 0)', approvedLeak.status === 0 && /content APPROVED -- inclusion allowed/.test(approvedLeak.out));

// ============================================================
// C. GitHub CI structure (text-level; no YAML dependency in this repo)
// ============================================================
const ci = read('.github/workflows/ci.yml');
function jobBlock(name: string): string {
  const start = ci.search(new RegExp(`^  ${name}:\\s*$`, 'm'));
  if (start < 0) return '';
  const rest = ci.slice(start + 1);
  const next = rest.search(/^  [a-z0-9-]+:\s*$/m);
  return next < 0 ? ci.slice(start) : ci.slice(start, start + 1 + next);
}
const topLevelJobs = Array.from(ci.slice(ci.indexOf('\njobs:')).matchAll(/^  ([a-z0-9-]+):\s*$/gm)).map((m) => m[1]);
check('C1. all five top-level CI jobs are present', ['math-core-tests', 'web-build', 'mcp-server', 'db-migration-validation', 'day-constructor-acceptance-db-tests'].every((j) => topLevelJobs.includes(j)));
const webBuild = jobBlock('web-build');
check('C2. the Palmistry scanner step is inside the web-build job, after the build', /run: npm run build[\s\S]*- name: Verify unapproved Palmistry content is excluded from the build\n\s+working-directory: apps\/web\n\s+run: node scripts\/check-palmistry-bundle\.js/.test(webBuild));
const mcp = jobBlock('mcp-server');
check('C3. the MCP Server job is intact (own job, lockfile install, build+test, read-only perms)', /name: MCP Server/.test(mcp) && /working-directory: apps\/mcp\n\s+run: npm ci/.test(mcp) && /working-directory: apps\/mcp\n\s+run: npm test/.test(mcp) && /contents: read/.test(mcp));
check('C4. the scanner is not inside the MCP Server job', !/check-palmistry-bundle/.test(mcp));
check('C5. no leftover merge-conflict markers in the workflow', !/^(<<<<<<<|=======|>>>>>>>)/m.test(ci));
check('C6. this guard test is wired into CI', /run: npx ts-node test\/palm01P4VercelGuard\.test\.ts/.test(ci));

// ============================================================
// D. Real approval state untouched
// ============================================================
const approval = JSON.parse(read('packages/palmistry/src/review-status.json'));
check('D1. real approval status is still PENDING_HUMAN_REVIEW with no approver', approval.status === 'PENDING_HUMAN_REVIEW' && approval.approvedBy === null);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
