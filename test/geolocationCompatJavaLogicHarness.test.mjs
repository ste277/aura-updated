// AURA-MOBILE-01-AND-MIN-01-R0A -- regression checks for the harness of
// test/geolocationCompatJavaLogic.test.mjs (not the Java behaviour itself):
//   - works while the installed plugin is already patched, and never modifies it
//   - missing or wrong pristine inputs fail closed (incl. patched files passed off as pristine)
//   - temp trees are removed after success and after every failure path
//   - uses the real patch script; no network / npm / device involvement
//
//   node test/geolocationCompatJavaLogicHarness.test.mjs      (requires a JDK, like the target test)
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, copyFileSync, appendFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'test', 'geolocationCompatJavaLogic.test.mjs');
const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'capacitor-geolocation-6.1.1-pristine');
const SRC = 'android/src/main/java/com/capacitorjs/plugins/geolocation';
const INSTALLED = path.join(ROOT, 'apps', 'web', 'node_modules', '@capacitor', 'geolocation', SRC);
const SCRIPT = path.join(ROOT, 'apps', 'web', 'scripts', 'apply-geolocation-compat-patch.mjs');
const FILES = ['GeolocationPlugin.java', 'Geolocation.java'];
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const snap = () => FILES.map((f) => (existsSync(path.join(INSTALLED, f)) ? sha(path.join(INSTALLED, f)) : 'missing')).join(',');

let passed = 0, failed = 0;
const check = (name, ok, note = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${note ? ' -- ' + note : ''}`); };

const work = mkdtempSync(path.join(os.tmpdir(), 'aura-geo-harness-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
let n = 0;
function runTarget(env = {}) {
  const tmpParent = path.join(work, `tmp${n++}`); mkdirSync(tmpParent);
  const r = spawnSync(process.execPath, [TARGET], { encoding: 'utf8', env: { ...process.env, AURA_GEO_TMP_PARENT: tmpParent, ...env } });
  return { ...r, out: (r.stdout || '') + (r.stderr || ''), leftovers: readdirSync(tmpParent) };
}
const dirWith = (name, fill) => { const d = path.join(work, name); mkdirSync(d); fill(d); return d; };

const installedBefore = snap();
const scriptSrc = readFileSync(SCRIPT, 'utf8');
const pristineFp = [...scriptSrc.matchAll(/pristine: '([0-9a-f]{64})'/g)].map((m) => m[1]);
const patchedFp = [...scriptSrc.matchAll(/patched: '([0-9a-f]{64})'/g)].map((m) => m[1]);
check('installed plugin is already patched (the scenario that used to exit 1)', installedBefore === patchedFp.join(','), installedBefore);
check('fixture fingerprints equal the patch script pristine fingerprints', FILES.map((f) => sha(path.join(FIXTURE, f))).join(',') === pristineFp.join(','));
check('fixture LICENSE is the recorded upstream MIT licence (PROVENANCE.md fingerprint)', existsSync(path.join(FIXTURE, 'LICENSE')) && sha(path.join(FIXTURE, 'LICENSE')) === 'e8f989836e88732576472006444b65fd3d7d3c2455becdaaa4d82cd0dd43110f' && readFileSync(path.join(FIXTURE, 'PROVENANCE.md'), 'utf8').includes('e8f989836e88732576472006444b65fd3d7d3c2455becdaaa4d82cd0dd43110f'));

// 1. success with the installed plugin patched
{
  const r = runTarget();
  check('target exits 0 with the installed plugin patched', r.status === 0, `exit ${r.status}`);
  check('all 15 Java behaviour assertions ran and passed', /\n15 passed, 0 failed\n/.test(r.out));
  check('target reports fixture verification and the real patch script result', /pristine fixture verified/.test(r.out) && /real patch script applied/.test(r.out));
  check('NEGATIVE CONTROL inside the target still demonstrates the original crash', /OK {3}NEGATIVE CONTROL: original code propagates SecurityException/.test(r.out));
  check('no SKIP path remains', !/SKIP/.test(r.out));
  check('temp tree removed after success', r.leftovers.length === 0, r.leftovers.join(','));
}
// 2. missing pristine sources
{
  const r = runTarget({ AURA_GEO_PRISTINE_DIR: dirWith('empty', () => {}) });
  check('missing pristine sources fail closed (exit 1)', r.status === 1 && /pristine source missing/.test(r.out), `exit ${r.status}`);
  check('temp tree removed after missing-source failure', r.leftovers.length === 0);
}
// 3. one pristine file altered by a single byte
{
  const d = dirWith('altered', (d) => { for (const f of FILES) copyFileSync(path.join(FIXTURE, f), path.join(d, f)); appendFileSync(path.join(d, 'Geolocation.java'), ' '); });
  const r = runTarget({ AURA_GEO_PRISTINE_DIR: d });
  check('wrong pristine fingerprint fails closed (exit 1)', r.status === 1 && /fingerprint mismatch for Geolocation\.java/.test(r.out), `exit ${r.status}`);
  check('temp tree removed after mismatch failure', r.leftovers.length === 0);
}
// 4. patched sources offered as "pristine" (silent substitution)
{
  const d = dirWith('patchedAsPristine', (d) => { for (const f of FILES) copyFileSync(path.join(INSTALLED, f), path.join(d, f)); });
  const r = runTarget({ AURA_GEO_PRISTINE_DIR: d });
  check('patched sources cannot be substituted for the original baseline (exit 1)', r.status === 1 && /fingerprint mismatch/.test(r.out) && !/passed, 0 failed/.test(r.out), `exit ${r.status}`);
  check('temp tree removed after substitution failure', r.leftovers.length === 0);
}
// 5. compiler unavailable (failure after the temp tree is populated)
{
  const r = runTarget({ JAVA_HOME: path.join(work, 'no-jdk'), PATH: '' });
  check('missing JDK fails (exit 1), never reported as pass', r.status === 1 && /FAIL javac/.test(r.out), `exit ${r.status}`);
  check('temp tree removed after javac failure', r.leftovers.length === 0);
}
// 6. static guarantees about the target harness
{
  const t = readFileSync(TARGET, 'utf8');
  check('target uses the real patch script', /apply-geolocation-compat-patch\.mjs/.test(t) && /spawnSync\(process\.execPath, \[PATCH_SCRIPT, '--root', patchRoot\]/.test(t));
  check('target asserts the approved patched fingerprints on its temp copy', patchedFp.every((h) => t.includes(h)));
  check('target compiles separate ORIGINAL and PATCHED classes', /harness\('OrigImpl', aliasOrig, lastOrig\)/.test(t) && /harness\('PatchedImpl', aliasNew, lastNew\)/.test(t));
  check('target never writes to the installed plugin path (only reads it for the unchanged check)', !/(writeFileSync|copyFileSync|appendFileSync|rmSync)\([^)]*installedFile/.test(t) && !/copyFileSync\([^,]*installedFile/.test(t));
  check('target has no network / npm / package-manager calls', !/\b(npm|npx|fetch\(|https?:|node:https?|node:net|curl|wget)\b/.test(t.replace(/^\/\/.*$/gm, '')));
  check('target has no device / emulator tooling', !/\b(adb|emulator|gradlew)\b/.test(t));
}
check('installed plugin byte-identical after all runs', snap() === installedBefore);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
