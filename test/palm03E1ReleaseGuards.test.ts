/**
 * AURA-PALM-03-E1-R2 -- the E1 exclusion guard on every release build path.
 *
 *  A. CI "Next.js production build" job runs check-palm-e1-bundle.js after `npm run build`.
 *  B. The REAL apps/web/scripts/vercel-build.sh (every Vercel Preview and Production build) runs the E1 guard after
 *     `next build`, and a planted E1 sentinel in any production artifact FAILS the script. Isolated temp tree with fake
 *     `next` / `npx` binaries: no deployment, no credentials, no database.
 *  C. deploy/Dockerfile runs the guard in the build stage, chained with && to `npm run build`, so a leak fails the
 *     image build before the runtime stage copies anything.
 * The educational-guide guard (check-palmistry-bundle.js) is preserved and still runs last on Vercel.
 *
 *   npx ts-node test/palm03E1ReleaseGuards.test.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++; else failures.push(`${name}${detail === undefined ? '' : ` :: ${String(detail).slice(0, 500)}`}`);
}

// ---------------------------------------------------------------- A. CI
const ci = read('.github/workflows/ci.yml');
check('A1. CI web-build runs the E1 guard after `npm run build`', /run: npm run build[\s\S]*- name: Verify the personalised interpretation engine is excluded from the build\n\s+working-directory: apps\/web\n\s+run: node scripts\/check-palm-e1-bundle\.js/.test(ci));
check('A2. CI still runs the guide and G6 engine guards', /run: node scripts\/check-palmistry-bundle\.js/.test(ci) && /run: node scripts\/check-palm-engine-bundle\.js/.test(ci));

// ---------------------------------------------------------------- B. Vercel wrapper (real script, isolated tree)
const script = read('apps/web/scripts/vercel-build.sh');
const lines = script.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const iNext = lines.indexOf('next build');
const iE1 = lines.findIndex((l) => l === 'node "$SCRIPT_DIR/check-palm-e1-bundle.js"');
const iGuide = lines.findIndex((l) => l === 'node "$SCRIPT_DIR/check-palmistry-bundle.js"');
check('B1. vercel-build.sh runs the E1 guard after `next build` and before the guide guard (which stays last)', iNext >= 0 && iE1 > iNext && iGuide > iE1 && iGuide === lines.length - 1);
check('B2. no exit-code swallowing; set -e first', lines[0] === 'set -e' && !/\|\|\s*true|set \+e|\|\|\s*:|trap /.test(lines.join('\n')));

type Mode = 'clean' | 'e1-leak-static' | 'e1-leak-server' | 'e1-leak-standalone' | 'empty';
function runVercel(mode: Mode, vercelEnv = 'preview') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'palm-e1-vercel-'));
  try {
    const web = path.join(tmp, 'apps/web');
    fs.mkdirSync(path.join(web, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'packages/palmistry/src'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'bin'), { recursive: true });
    for (const f of ['vercel-build.sh', 'check-palm-e1-bundle.js', 'check-palmistry-bundle.js', 'check-db-identity.js']) fs.copyFileSync(path.join(ROOT, 'apps/web/scripts', f), path.join(web, 'scripts', f));
    fs.copyFileSync(path.join(ROOT, 'apps/web/palmistry-build-exclusion.js'), path.join(web, 'palmistry-build-exclusion.js'));
    fs.copyFileSync(path.join(ROOT, 'packages/palmistry/src/review-status.json'), path.join(tmp, 'packages/palmistry/src/review-status.json'));
    const leak: Record<string, string> = { 'e1-leak-static': '.next/static/chunks/app/x.js', 'e1-leak-server': '.next/server/app/x.js', 'e1-leak-standalone': '.next/standalone/x.json' };
    fs.writeFileSync(path.join(tmp, 'bin/next'), `#!/bin/sh
rm -rf .next/static .next/server .next/standalone
[ "$FAKE_NEXT_MODE" = "empty" ] && exit 0
mkdir -p .next/static/chunks/app .next/server/app .next/standalone
echo 'console.log("app")' > .next/static/chunks/app/page.js
echo 'module.exports={}' > .next/server/app/page.js
${leak[mode] ? `echo '{"engine":"aura.palm.e1-reading","id":"C1-WE-HEART-JUPITER"}' > ${leak[mode]}` : ''}
exit 0
`, { mode: 0o755 });
    fs.writeFileSync(path.join(tmp, 'bin/npx'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${path.join(tmp, 'bin')}${path.delimiter}${process.env.PATH}`, FAKE_NEXT_MODE: mode, VERCEL_ENV: vercelEnv };
    delete env.VERCEL_PROJECT_ID;
    if (vercelEnv === 'production') env.VERCEL_PROJECT_ID = 'prj_iY4xteQOWUNsV85NnbyIylBAba6t';
    const r = spawnSync('sh', ['scripts/vercel-build.sh'], { cwd: web, env, encoding: 'utf8' });
    return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
const clean = runVercel('clean');
check('B3. clean build: exits 0; the E1 guard ran and reported OK; the guide guard still ran', clean.status === 0 && /\[palm-e1-bundle\] OK/.test(clean.out) && /\[palmistry-bundle\]/.test(clean.out), clean.out);
for (const m of ['e1-leak-static', 'e1-leak-server', 'e1-leak-standalone'] as Mode[]) {
  const r = runVercel(m);
  check(`B4. ${m}: Preview build FAILS with the E1 guard message`, typeof r.status === 'number' && r.status !== 0 && /\[palm-e1-bundle\] FAIL/.test(r.out), r.out);
}
const prodLeak = runVercel('e1-leak-static', 'production');
check('B5. Production build with an E1 leak FAILS (deployment never promoted)', typeof prodLeak.status === 'number' && prodLeak.status !== 0 && /\[palm-e1-bundle\] FAIL/.test(prodLeak.out), prodLeak.out);
const empty = runVercel('empty');
check('B6. no build output: FAILS closed', typeof empty.status === 'number' && empty.status !== 0 && /no \.next\/static found/.test(empty.out));

// ---------------------------------------------------------------- C. Docker build path
const docker = read('deploy/Dockerfile');
const buildStage = docker.slice(docker.indexOf('AS build'), docker.indexOf('AS runtime'));
check('C1. the Docker build stage runs the E1 guard chained with && to `npm run build`', /npm run build \\\n\s*&& node scripts\/check-palm-e1-bundle\.js/.test(buildStage));
check('C2. the guard runs in apps/web (where .next is produced) and before the runtime stage copies artifacts', /RUN cd apps\/web && npx prisma generate/.test(buildStage) && docker.indexOf('check-palm-e1-bundle.js') < docker.indexOf('AS runtime'));
check('C3. the build stage copies apps/web (so the guard script is present in the image build)', /COPY apps\/web \.\/apps\/web/.test(buildStage));
check('C4. no exit-code swallowing in the Docker RUN', !/check-palm-e1-bundle\.js\s*(\|\||;)/.test(docker));
// the guard itself fails closed on a planted artifact (what the && chain propagates)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'palm-e1-docker-'));
try {
  fs.mkdirSync(path.join(tmp, '.next/static'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.next/static/a.js'), 'x');
  const ok = spawnSync('node', [path.join(ROOT, 'apps/web/scripts/check-palm-e1-bundle.js'), tmp], { encoding: 'utf8' });
  fs.mkdirSync(path.join(tmp, '.next/standalone'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.next/standalone/server.js'), 'var lib="palm-03-c1-library@0.4.0-draft"');
  const bad = spawnSync('node', [path.join(ROOT, 'apps/web/scripts/check-palm-e1-bundle.js'), tmp], { encoding: 'utf8' });
  check('C5. the guard exits 0 on clean output and non-zero on a standalone-server leak', ok.status === 0 && bad.status === 1);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

console.log(`\nPALM-03-E1 release guards: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  FAIL ${f}`); process.exit(1); }
