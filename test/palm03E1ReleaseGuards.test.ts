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

type Mode = 'clean' | 'e1-leak-static' | 'e1-leak-server' | 'e1-leak-standalone' | 'e1-leak-standalone-node_modules' | 'e1-leak-public' | 'e1-leak-binary' | 'empty' | 'incomplete-no-standalone' | 'incomplete-no-chunks' | 'incomplete-no-build-id' | 'incomplete-empty-static';
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
    fs.mkdirSync(path.join(web, 'public'), { recursive: true });
    fs.writeFileSync(path.join(web, 'public/manifest.json'), '{"name":"Aura"}');
    const leak: Record<string, string> = { 'e1-leak-static': '.next/static/chunks/app/x.js', 'e1-leak-server': '.next/server/app/x.js', 'e1-leak-standalone': '.next/standalone/x.json', 'e1-leak-standalone-node_modules': '.next/standalone/node_modules/x.js', 'e1-leak-public': 'public/x.svg', 'e1-leak-binary': '.next/static/media/x.woff2' };
    fs.writeFileSync(path.join(tmp, 'bin/next'), `#!/bin/sh
rm -rf .next/static .next/server .next/standalone
[ "$FAKE_NEXT_MODE" = "empty" ] && exit 0
mkdir -p .next/static/chunks/app .next/static/media .next/server/app .next/standalone/node_modules public
echo 'console.log("app")' > .next/static/chunks/app/page.js
echo 'module.exports={}' > .next/server/app/page.js
# AURA-PALM-03-E1-R4: a complete Next standalone artifact (the E1 guard verifies the structure before scanning)
mkdir -p .next/static/fakeBuild0001 .next/server/app .next/standalone/.next/server/app .next/standalone/node_modules/next
printf fakeBuild0001 > .next/BUILD_ID && cp .next/BUILD_ID .next/standalone/.next/BUILD_ID
echo 'self.__BUILD_MANIFEST={}' > .next/static/fakeBuild0001/_buildManifest.js
echo 'module.exports={}' > .next/server/webpack-runtime.js
echo '{"/page":"app/page.js"}' > .next/server/app-paths-manifest.json
echo '{"/_app":"pages/_app.js"}' > .next/server/pages-manifest.json
echo 'module.exports={}' > .next/standalone/.next/server/app/page.js
printf "require('next')\\nrequire('next/dist/server/lib/start-server')\\n" > .next/standalone/server.js
echo '{"name":"web"}' > .next/standalone/package.json
echo '{"name":"next","main":"./dist/server/next.js"}' > .next/standalone/node_modules/next/package.json
mkdir -p .next/standalone/node_modules/next/dist/server/lib
echo 'module.exports={}' > .next/standalone/node_modules/next/dist/server/next.js
echo 'exports.startServer=function(){}' > .next/standalone/node_modules/next/dist/server/lib/start-server.js
[ "$FAKE_NEXT_MODE" = "incomplete-no-standalone" ] && rm -rf .next/standalone
[ "$FAKE_NEXT_MODE" = "incomplete-no-chunks" ] && rm -rf .next/static/chunks
[ "$FAKE_NEXT_MODE" = "incomplete-no-build-id" ] && rm -f .next/BUILD_ID
[ "$FAKE_NEXT_MODE" = "incomplete-empty-static" ] && rm -rf .next/server .next/standalone .next/BUILD_ID .next/static/* && mkdir -p .next/static
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
for (const m of ['e1-leak-static', 'e1-leak-server', 'e1-leak-standalone', 'e1-leak-standalone-node_modules', 'e1-leak-public', 'e1-leak-binary'] as Mode[]) {
  const r = runVercel(m);
  check(`B4. ${m}: Preview build FAILS with the E1 guard message`, typeof r.status === 'number' && r.status !== 0 && /\[palm-e1-bundle\] FAIL/.test(r.out), r.out);
}
const prodLeak = runVercel('e1-leak-static', 'production');
check('B5. Production build with an E1 leak FAILS (deployment never promoted)', typeof prodLeak.status === 'number' && prodLeak.status !== 0 && /\[palm-e1-bundle\] FAIL/.test(prodLeak.out), prodLeak.out);
const empty = runVercel('empty');
check('B6. no build output: FAILS closed', typeof empty.status === 'number' && empty.status !== 0 && /no \.next\/static found/.test(empty.out));
for (const m of ['incomplete-no-standalone', 'incomplete-no-chunks', 'incomplete-no-build-id', 'incomplete-empty-static'] as Mode[]) {
  const r = runVercel(m);
  check(`B7. R4 ${m}: an incomplete build artifact FAILS the Vercel wrapper (positive artifact verification)`, typeof r.status === 'number' && r.status !== 0 && /\[palm-e1-bundle\] FAIL: SCAN ERROR -- the release artifact is incomplete/.test(r.out), r.out);
}

// ---------------------------------------------------------------- C. Docker build path
const docker = read('deploy/Dockerfile');
const buildStage = docker.slice(docker.indexOf('AS build'), docker.indexOf('AS release-tree'));
check('C0. R3: a release-tree stage assembles exactly the shipped files and runs the guard over all of them (--tree /app); the runtime stage copies only from it', /FROM node:24-alpine AS release-tree[\s\S]*RUN node \/opt\/guard\/check-palm-e1-bundle\.js --tree \/app && rm -rf \/opt\/guard/.test(docker) && (docker.slice(docker.indexOf('AS runtime')).match(/^COPY /gm) ?? []).length === 1 && /COPY --from=release-tree --chown=aura:aura \/app \.\//.test(docker));
check('C0b. the release-tree stage ships the same paths the runtime previously did (standalone, static, public, migrations)', ['/repo/apps/web/.next/standalone ./', '/repo/apps/web/.next/static ./.next/static', '/repo/apps/web/public ./public', '/repo/apps/web/prisma/migrations ./migrations'].every((x) => docker.includes(`COPY --from=build ${x}`)));
check('C1. the Docker build stage runs the E1 guard chained with && to `npm run build`', /npm run build \\\n\s*&& node scripts\/check-palm-e1-bundle\.js/.test(buildStage));
check('C2. the guard runs in apps/web (where .next is produced) and before the runtime stage copies artifacts', /RUN cd apps\/web && npx prisma generate/.test(buildStage) && docker.indexOf('check-palm-e1-bundle.js') < docker.indexOf('AS runtime'));
check('C3. the build stage copies apps/web (so the guard script is present in the image build)', /COPY apps\/web \.\/apps\/web/.test(buildStage));
check('C4. no exit-code swallowing in the Docker RUN', !/check-palm-e1-bundle\.js\s*(\|\||;)/.test(docker));
// the guard itself fails closed on a planted artifact (what the && chain propagates)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'palm-e1-docker-'));
const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'palm-e1-tree-'));
try {
  const put = (base: string, rel: string, body: string) => { fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true }); fs.writeFileSync(path.join(base, rel), body); };
  const B = 'fakeBuild0001';
  const common: Record<string, string> = { '.next/BUILD_ID': B, [`.next/static/${B}/_buildManifest.js`]: 'x', '.next/static/chunks/a.js': 'x', '.next/server/webpack-runtime.js': 'x', '.next/server/app-paths-manifest.json': '{"/p":"p"}', '.next/server/pages-manifest.json': '{"/_app":"a"}', '.next/server/app/page.js': 'x', 'public/manifest.json': '{"name":"Aura"}' };
  const SERVER = "require('next')\nrequire('next/dist/server/lib/start-server')\n";
  const nextFiles = (pre: string): Record<string, string> => ({ [`${pre}node_modules/next/package.json`]: '{"name":"next","main":"./dist/server/next.js"}', [`${pre}node_modules/next/dist/server/next.js`]: 'x', [`${pre}node_modules/next/dist/server/lib/start-server.js`]: 'x' });
  for (const [r, b] of Object.entries({ ...common, '.next/standalone/server.js': SERVER, '.next/standalone/package.json': '{"name":"w"}', '.next/standalone/.next/BUILD_ID': B, '.next/standalone/.next/server/app/page.js': 'x', ...nextFiles('.next/standalone/') })) put(tmp, r, b);
  for (const [r, b] of Object.entries({ ...common, 'server.js': SERVER, 'package.json': '{"name":"w"}', ...nextFiles(''), 'migrations/0001_init/migration.sql': 'SELECT 1;' })) put(tree, r, b);
  const guard = path.join(ROOT, 'apps/web/scripts/check-palm-e1-bundle.js');
  const ok = spawnSync('node', [guard, tmp], { encoding: 'utf8' });
  const okTree = spawnSync('node', [guard, '--tree', tree], { encoding: 'utf8' });
  fs.writeFileSync(path.join(tmp, '.next/standalone/server.js'), `${SERVER}var lib="palm-03-c1-library@0.4.0-draft"`);
  const bad = spawnSync('node', [guard, tmp], { encoding: 'utf8' });
  check('C5. the guard exits 0 on a complete clean artifact (web build and Docker tree) and non-zero on a standalone-server leak', ok.status === 0 && okTree.status === 0 && bad.status === 1, `${ok.stderr}${okTree.stderr}`);
  fs.rmSync(path.join(tree, 'migrations'), { recursive: true });
  const noMig = spawnSync('node', [guard, '--tree', tree], { encoding: 'utf8' });
  const emptyTree = fs.mkdtempSync(path.join(os.tmpdir(), 'palm-e1-empty-'));
  const emptyRes = spawnSync('node', [guard, '--tree', emptyTree], { encoding: 'utf8' });
  fs.rmSync(emptyTree, { recursive: true, force: true });
  check('C6. R4: the Docker release tree must be complete: no migrations, or an empty tree, FAILS closed', noMig.status === 1 && /no migrations|missing or unreadable migrations/.test(noMig.stderr) && emptyRes.status === 1 && /incomplete/.test(emptyRes.stderr));
} finally { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(tree, { recursive: true, force: true }); }

console.log(`\nPALM-03-E1 release guards: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  FAIL ${f}`); process.exit(1); }
