// AURA-MOBILE-01-AND-COMPAT-03 -- tests for apps/web/scripts/apply-geolocation-compat-patch.mjs
// (deterministic, fail-closed delivery of the @capacitor/geolocation 6.1.1 coarse patch).
//
//   node test/geolocationCompatPatchScript.test.mjs
//
// Fixtures are built in a temp dir from PRISTINE plugin sources taken from the checked-in,
// fingerprint-verified test/fixtures/capacitor-geolocation-6.1.1-pristine/ (offline; works
// whether or not the installed plugin is already patched).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, existsSync, appendFileSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'apps', 'web');
const SCRIPT = path.join(APP, 'scripts', 'apply-geolocation-compat-patch.mjs');
const SRC = 'android/src/main/java/com/capacitorjs/plugins/geolocation';
const P = { plugin: `${SRC}/GeolocationPlugin.java`, geo: `${SRC}/Geolocation.java` };
const HASH = {
  pluginPristine: 'bf807548b9c2439c59b1f0edd1caf33ae46587e7437344342265d78ec4bee9db',
  pluginPatched: '5c4ba692153db8ca92205cfab0467aa6cfc5408191758513a757564ffe584791',
  geoPristine: '506681e780dfe6827c99db372a6dabf244e730d11506c113eb5271cf31dc36f1',
  geoPatched: '1861133e350a294d401c3ca0d639ca1b191d28ef39e186ad1ad05d9e3e9edf8b',
};
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
let passed = 0, failed = 0;
const check = (name, ok, note = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${note ? ' -- ' + note : ''}`); };

// --- pristine source acquisition ---
const tmpBase = mkdtempSync(path.join(os.tmpdir(), 'aura-geo-patch-'));
const pristineDir = path.join(tmpBase, 'pristine');
mkdirSync(path.join(pristineDir, SRC), { recursive: true });
process.on('exit', () => rmSync(tmpBase, { recursive: true, force: true }));
// AND-MIN-01-R0A: pristine sources come only from the checked-in, fingerprint-verified fixture
// (test/fixtures/capacitor-geolocation-6.1.1-pristine/PROVENANCE.md). The former `npm pack`
// fallback (which could contact the registry) is removed; the installed plugin is not used as a
// source because postinstall patches it. Missing or mismatched fixture files fail closed.
const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'capacitor-geolocation-6.1.1-pristine');
for (const [key, file, want] of [['plugin', 'GeolocationPlugin.java', HASH.pluginPristine], ['geo', 'Geolocation.java', HASH.geoPristine]]) {
  const src = path.join(FIXTURE, file);
  if (!existsSync(src) || sha(src) !== want) { console.log(`FAIL (fail closed): pristine fixture ${file} missing or fingerprint mismatch`); process.exit(1); }
  copyFileSync(src, path.join(pristineDir, P[key]));
}

function fixture(name, { version = '6.1.1', plugin = 'pristine', geo = 'pristine' } = {}) {
  const root = path.join(tmpBase, name);
  const dir = path.join(root, 'node_modules', '@capacitor', 'geolocation');
  mkdirSync(path.join(dir, SRC), { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@capacitor/geolocation', version }));
  for (const [key, mode] of [['plugin', plugin], ['geo', geo]]) {
    const dst = path.join(dir, P[key]);
    if (mode === 'missing') continue;
    copyFileSync(path.join(pristineDir, P[key]), dst);
    if (mode === 'unknown') appendFileSync(dst, '\n// local edit\n');
  }
  return { root, dir };
}
const run = (root) => spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
const hashes = (dir) => [sha(path.join(dir, P.plugin)), sha(path.join(dir, P.geo))];

// 1. clean install -> patched, exact fingerprints
{
  const { root, dir } = fixture('clean');
  const r = run(root);
  const [hp, hg] = hashes(dir);
  check('clean plugin install: exit 0 and "applied"', r.status === 0 && /applied coarse-location compatibility patch/.test(r.stdout));
  check('patched fingerprints exactly match the reviewed result (both files)', hp === HASH.pluginPatched && hg === HASH.geoPatched);
  check('no temp files left behind', !existsSync(path.join(dir, P.plugin) + '.aura-tmp') && !existsSync(path.join(dir, P.geo) + '.aura-tmp'));
  // 2. already patched / repeated execution
  const r2 = run(root); const r3 = run(root);
  check('already-patched state detected: exit 0, "already applied", files unchanged', r2.status === 0 && /already applied/.test(r2.stdout) && hashes(dir).join() === [hp, hg].join());
  check('repeated execution is idempotent (3rd run identical)', r3.status === 0 && hashes(dir).join() === [hp, hg].join());
}
// 3. correct source fingerprints required: pristine fingerprints verified before patching
{
  const { dir } = fixture('fp');
  check('fixture starts from the known pristine fingerprints', hashes(dir).join() === [HASH.pluginPristine, HASH.geoPristine].join());
}
// 4. unexpected plugin version -> fail closed, nothing changed
{
  const { root, dir } = fixture('version', { version: '6.1.2' });
  const before = hashes(dir); const r = run(root);
  check('unexpected plugin version: exit 1, not applied, files unchanged', r.status === 1 && /expected @capacitor\/geolocation 6\.1\.1, found 6\.1\.2/.test(r.stderr) && hashes(dir).join() === before.join());
}
// 5. unknown source fingerprint
{
  const { root, dir } = fixture('unknown', { geo: 'unknown' });
  const before = hashes(dir); const r = run(root);
  check('unknown source fingerprint: exit 1, nothing changed (incl. the pristine file)', r.status === 1 && /Geolocation\.java=unknown/.test(r.stderr) && hashes(dir).join() === before.join());
}
// 6. partially applied patch (one file patched, other pristine)
{
  const { root, dir } = fixture('partial');
  run(root); // patch both
  copyFileSync(path.join(pristineDir, P.geo), path.join(dir, P.geo)); // revert one
  const before = hashes(dir); const r = run(root);
  check('partially applied patch: exit 1 (fail closed), files unchanged', r.status === 1 && /GeolocationPlugin\.java=patched, Geolocation\.java=pristine/.test(r.stderr) && hashes(dir).join() === before.join());
}
// 7. missing source files / missing plugin
{
  const { root } = fixture('missing', { plugin: 'missing' });
  const r = run(root);
  check('missing source file: exit 1', r.status === 1 && /GeolocationPlugin\.java=missing/.test(r.stderr));
  const empty = path.join(tmpBase, 'noplugin'); mkdirSync(empty);
  const r2 = run(empty);
  check('plugin not installed: exit 1', r2.status === 1 && /is not installed/.test(r2.stderr));
}
// 8. CI/install wiring: postinstall + exact pin + lockfile spec
{
  const pkg = JSON.parse(readFileSync(path.join(APP, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(path.join(APP, 'package-lock.json'), 'utf8'));
  check('apps/web postinstall runs the patch script', pkg.scripts?.postinstall === 'node scripts/apply-geolocation-compat-patch.mjs');
  check('@capacitor/geolocation pinned exactly to 6.1.1 in package.json', pkg.dependencies?.['@capacitor/geolocation'] === '6.1.1');
  check('package-lock root spec and resolved version both 6.1.1', lock.packages?.['']?.dependencies?.['@capacitor/geolocation'] === '6.1.1' && lock.packages?.['node_modules/@capacitor/geolocation']?.version === '6.1.1');
  check('script has no runtime dependencies (node: builtins only)', !/from '(?!node:)/.test(readFileSync(SCRIPT, 'utf8')));
  check('patch touches only Android plugin sources', [...readFileSync(path.join(APP, 'patches', 'capacitor-geolocation-6.1.1-coarse-compat.patch'), 'utf8').matchAll(/^\+\+\+ b\/(\S+)/gm)].every((m) => m[1].startsWith('android/src/main/java/')));
}

// 9. review fixes: argument validation, Vercel soft-fail, Gradle gate wiring, per-process temp names
{
  const { root } = fixture('args');
  const bad = spawnSync(process.execPath, [SCRIPT, `--root=${root}`], { encoding: 'utf8' });
  check('unknown/malformed arguments rejected (--root=dir -> exit 1, nothing patched)', bad.status === 1 && /unsupported arguments/.test(bad.stderr) && hashes(path.join(root, 'node_modules/@capacitor/geolocation')).join() === [HASH.pluginPristine, HASH.geoPristine].join());
  const bare = spawnSync(process.execPath, [SCRIPT, '--root'], { encoding: 'utf8' });
  check('bare --root without a value rejected', bare.status === 1);
  const v = fixture('vercel', { version: '6.1.2' });
  const soft = spawnSync(process.execPath, [SCRIPT, '--root', v.root], { encoding: 'utf8', env: { ...process.env, VERCEL: '1' } });
  check('on Vercel (VERCEL set) a failure is a warning (exit 0) and nothing is patched', soft.status === 0 && /WARNING \(not applied/.test(soft.stderr + soft.stdout));
  const gradle = readFileSync(path.join(APP, 'android', 'app', 'build.gradle'), 'utf8');
  check('Gradle gate: preBuild depends on verifyGeolocationCompatPatch with both patched fingerprints', /tasks\.named\('preBuild'\) \{ dependsOn 'verifyGeolocationCompatPatch' \}/.test(gradle) && gradle.includes(HASH.pluginPatched) && gradle.includes(HASH.geoPatched));
  check('temp files are per-process (no shared fixed temp name)', /aura-tmp-\$\{process\.pid\}/.test(readFileSync(SCRIPT, 'utf8')));
}

rmSync(tmpBase, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
