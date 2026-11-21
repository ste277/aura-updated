#!/usr/bin/env node
/**
 * AURA-MOBILE-01-AND-COMPAT-03 -- deterministic, fail-closed patch for
 * @capacitor/geolocation 6.1.1 (Android only). Runs from `postinstall`.
 *
 * Applies patches/capacitor-geolocation-6.1.1-coarse-compat.patch:
 *   Part 1 (GeolocationPlugin.java): manifest-aware permission alias -- backport
 *          of upstream ionic-team/capacitor-geolocation c9c4c84 (v8.2.1, #85), so a
 *          coarse-only app uses ACCESS_COARSE_LOCATION on API 22-30 too.
 *   Part 2 (Geolocation.java): skip last-known-location providers that throw
 *          SecurityException for coarse-only callers (API 22-29), instead of crashing.
 * The two parts are applied together or not at all.
 *
 * Outcomes (exit code):
 *   0  patched now, or already patched (idempotent)
 *   1  fail closed: unexpected version, unknown/partially-modified/missing files,
 *      or patch/verification error. Nothing is left half-written.
 *   On Vercel (env VERCEL set) failures are reported as warnings and exit 0: web
 *   deploys never compile this Android-only Java, and Android builds are gated
 *   separately by the Gradle task verifyGeolocationCompatPatch (android/app/build.gradle),
 *   which fails the build unless the patched fingerprints are present.
 *
 * Usage: node scripts/apply-geolocation-compat-patch.mjs [--root <dir containing node_modules>]
 * No runtime dependencies. Never touches iOS, JavaScript or manifest files.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(SCRIPT_DIR, '..');
const EXPECTED_VERSION = '6.1.1';
const PATCH_FILE = path.join(APP_DIR, 'patches', 'capacitor-geolocation-6.1.1-coarse-compat.patch');
const SRC = 'android/src/main/java/com/capacitorjs/plugins/geolocation';
const FILES = [
  {
    rel: `${SRC}/GeolocationPlugin.java`,
    pristine: 'bf807548b9c2439c59b1f0edd1caf33ae46587e7437344342265d78ec4bee9db',
    patched: '5c4ba692153db8ca92205cfab0467aa6cfc5408191758513a757564ffe584791',
  },
  {
    rel: `${SRC}/Geolocation.java`,
    pristine: '506681e780dfe6827c99db372a6dabf244e730d11506c113eb5271cf31dc36f1',
    patched: '1861133e350a294d401c3ca0d639ca1b191d28ef39e186ad1ad05d9e3e9edf8b',
  },
];

const TAG = '[geolocation-compat-patch]';
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const SOFT_FAIL = Boolean(process.env.VERCEL);
function fail(msg) {
  if (SOFT_FAIL) {
    console.warn(`${TAG} WARNING (not applied; web deploy continues, Android builds are gated by Gradle): ${msg}`);
    process.exit(0);
  }
  console.error(`${TAG} FAILED (fail closed): ${msg}`);
  console.error(`${TAG} Reinstall a clean dependency tree (rm -rf node_modules && npm ci), or review the patch if @capacitor/geolocation was intentionally changed.`);
  process.exit(1);
}

function parseArgs(argv) {
  if (argv.length === 0) return APP_DIR;
  if (argv.length === 2 && argv[0] === '--root' && argv[1] && !argv[1].startsWith('--')) return path.resolve(argv[1]);
  fail(`unsupported arguments: ${JSON.stringify(argv)} (usage: [--root <dir>])`);
}

/** Minimal unified-diff applier. Requires every context/removed line to match exactly. */
function parsePatch(text) {
  const files = new Map();
  let cur = null;
  let hunk = null;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) { // tolerate CRLF checkouts
    if (line.startsWith('--- ')) continue;
    if (line.startsWith('+++ ')) {
      const name = line.slice(4).replace(/^b\//, '').split('\t')[0].trim();
      cur = { hunks: [] };
      files.set(name, cur);
      continue;
    }
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h) {
      hunk = { oldStart: Number(h[1]), lines: [] };
      cur.hunks.push(hunk);
      continue;
    }
    if (hunk && (line.startsWith(' ') || line.startsWith('+') || line.startsWith('-'))) hunk.lines.push(line);
  }
  return files;
}
function applyHunks(original, hunks, name) {
  const src = original.split('\n');
  const out = [];
  let pos = 0; // index into src
  for (const hunk of hunks) {
    const start = hunk.oldStart - 1;
    if (start < pos) throw new Error(`${name}: overlapping hunks`);
    while (pos < start) out.push(src[pos++]);
    for (const l of hunk.lines) {
      const body = l.slice(1);
      if (l[0] === '+') out.push(body);
      else {
        if (src[pos] !== body) throw new Error(`${name}: context mismatch at line ${pos + 1}`);
        if (l[0] === ' ') out.push(body);
        pos++;
      }
    }
  }
  while (pos < src.length) out.push(src[pos++]);
  return out.join('\n');
}

function main() {
  const root = parseArgs(process.argv.slice(2));
  const pluginDir = path.join(root, 'node_modules', '@capacitor', 'geolocation');
  const pkgPath = path.join(pluginDir, 'package.json');
  if (!existsSync(pkgPath)) fail(`@capacitor/geolocation is not installed under ${path.relative(process.cwd(), pluginDir) || pluginDir}`);
  let version;
  try { version = JSON.parse(readFileSync(pkgPath, 'utf8')).version; } catch { fail('cannot read @capacitor/geolocation/package.json'); }
  if (version !== EXPECTED_VERSION) fail(`expected @capacitor/geolocation ${EXPECTED_VERSION}, found ${version}. The compatibility patch is version-specific and was NOT applied.`);

  const states = FILES.map((f) => {
    const abs = path.join(pluginDir, f.rel);
    if (!existsSync(abs)) return { ...f, abs, state: 'missing' };
    const buf = readFileSync(abs);
    const h = sha256(buf);
    return { ...f, abs, buf, state: h === f.pristine ? 'pristine' : h === f.patched ? 'patched' : 'unknown' };
  });
  const summary = states.map((s) => `${path.basename(s.rel)}=${s.state}`).join(', ');

  if (states.every((s) => s.state === 'patched')) {
    console.log(`${TAG} already applied (${summary}); nothing to do.`);
    return;
  }
  if (!states.every((s) => s.state === 'pristine')) fail(`unexpected plugin source state (${summary}). Refusing to patch partially-modified, unknown or missing files.`);

  if (!existsSync(PATCH_FILE)) fail(`patch file missing: ${PATCH_FILE}`);
  const patch = parsePatch(readFileSync(PATCH_FILE, 'utf8'));
  const results = [];
  for (const s of states) {
    const entry = patch.get(s.rel);
    if (!entry) fail(`patch has no hunks for ${s.rel}`);
    let next;
    try { next = applyHunks(s.buf.toString('utf8'), entry.hunks, path.basename(s.rel)); } catch (e) { fail(e.message); }
    if (sha256(Buffer.from(next, 'utf8')) !== s.patched) fail(`post-patch fingerprint mismatch for ${path.basename(s.rel)}; no files were changed.`);
    results.push({ s, next });
  }
  // Write both to per-process temp files, then rename; restore originals (only the
  // files this process replaced) if anything fails midway or verification fails.
  const tmpOf = (s) => `${s.abs}.aura-tmp-${process.pid}`;
  const written = [];
  const rollback = () => {
    for (const s of written) { try { writeFileSync(s.abs, s.buf); } catch {} }
    for (const { s } of results) { try { if (existsSync(tmpOf(s))) unlinkSync(tmpOf(s)); } catch {} }
  };
  try {
    for (const { s, next } of results) writeFileSync(tmpOf(s), next, 'utf8');
    for (const { s } of results) { renameSync(tmpOf(s), s.abs); written.push(s); }
  } catch (e) {
    rollback();
    fail(`write error (${e.message}); originals restored.`);
  }
  for (const { s } of results) {
    if (sha256(readFileSync(s.abs)) !== s.patched) { rollback(); fail(`verification after write failed for ${path.basename(s.rel)}; originals restored.`); }
  }
  console.log(`${TAG} applied coarse-location compatibility patch to @capacitor/geolocation ${version} (GeolocationPlugin.java, Geolocation.java).`);
}

main();
