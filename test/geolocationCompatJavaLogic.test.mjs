// AURA-MOBILE-01-AND-COMPAT-03 -- executes the REAL getAlias() and getLastLocation()
// method bodies from @capacitor/geolocation 6.1.1, both ORIGINAL and PATCHED, on a plain
// JVM against minimal fakes (Build.VERSION, PluginCall, LocationManager, Location,
// SystemClock). Methods are extracted verbatim from the source files, so the test
// exercises the exact patched code, not a re-implementation.
//
//   node test/geolocationCompatJavaLogic.test.mjs        (requires a JDK: javac + java)
//
// Synthetic only: no device, no coordinates (Location fakes carry only a timestamp).
//
// AND-MIN-01-R0A: the ORIGINAL baseline comes from the checked-in, fingerprint-verified fixture
// test/fixtures/capacitor-geolocation-6.1.1-pristine/ (see its PROVENANCE.md), NOT from the
// installed plugin, which postinstall has already patched. The installed plugin is never read
// as a source and never written; its fingerprints are checked unchanged at exit. Offline only.
// Test-only overrides (used by test/geolocationCompatJavaLogicHarness.test.mjs):
//   AURA_GEO_PRISTINE_DIR  alternative pristine directory (to prove missing/mismatch fail closed)
//   AURA_GEO_TMP_PARENT    parent for the temp tree (to prove clean-up)
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'apps', 'web');
const SRC = 'android/src/main/java/com/capacitorjs/plugins/geolocation';
const JAVA_HOME = process.env.JAVA_HOME || '/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home';
const javac = existsSync(path.join(JAVA_HOME, 'bin', 'javac')) ? path.join(JAVA_HOME, 'bin', 'javac') : 'javac';
const java = existsSync(path.join(JAVA_HOME, 'bin', 'java')) ? path.join(JAVA_HOME, 'bin', 'java') : 'java';

const PRISTINE_DIR = process.env.AURA_GEO_PRISTINE_DIR || path.join(ROOT, 'test', 'fixtures', 'capacitor-geolocation-6.1.1-pristine');
// Same values as apps/web/scripts/apply-geolocation-compat-patch.mjs FILES[].pristine / .patched.
const FP = {
  'GeolocationPlugin.java': { pristine: 'bf807548b9c2439c59b1f0edd1caf33ae46587e7437344342265d78ec4bee9db', patched: '5c4ba692153db8ca92205cfab0467aa6cfc5408191758513a757564ffe584791' },
  'Geolocation.java': { pristine: '506681e780dfe6827c99db372a6dabf244e730d11506c113eb5271cf31dc36f1', patched: '1861133e350a294d401c3ca0d639ca1b191d28ef39e186ad1ad05d9e3e9edf8b' },
};
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const installedFile = (f) => path.join(APP, 'node_modules', '@capacitor', 'geolocation', SRC, f);
const installedSnapshot = () => Object.keys(FP).map((f) => (existsSync(installedFile(f)) ? sha(installedFile(f)) : 'missing')).join(',');
const installedBefore = installedSnapshot();

// --- temp tree, removed on EVERY exit path (success, assertion failure, fail-closed, throw) ---
const tmp = mkdtempSync(path.join(process.env.AURA_GEO_TMP_PARENT || os.tmpdir(), 'aura-geo-java-'));
process.on('exit', () => {
  // A clean-up error must not skip the installed-plugin check below.
  try { rmSync(tmp, { recursive: true, force: true }); } catch (e) { console.log(`WARN temp clean-up failed for ${tmp}: ${e.message}`); }
  // The installed plugin must be byte-identical before and after (never modified by this test).
  if (installedSnapshot() !== installedBefore) {
    console.log('FAIL installed @capacitor/geolocation sources changed during the test');
    process.exit(1); // overrides any success code; 'exit' is not re-emitted
  }
});
const failClosed = (msg) => { console.log(`FAIL (fail closed): ${msg}`); process.exit(1); };

// --- verified pristine inputs (no fallback to installed sources, the npm cache, or the network) ---
for (const [f, { pristine }] of Object.entries(FP)) {
  const p = path.join(PRISTINE_DIR, f);
  if (!existsSync(p)) failClosed(`pristine source missing: ${p}`);
  const h = sha(p);
  if (h !== pristine) failClosed(`pristine source fingerprint mismatch for ${f}: expected ${pristine}, got ${h}`);
}
console.log(`OK   pristine fixture verified (${Object.keys(FP).join(', ')}) from ${path.relative(ROOT, PRISTINE_DIR) || PRISTINE_DIR}`);

// --- produce original + patched sources in a temp root via the real delivery script ---
const origRoot = path.join(tmp, 'orig'), patchRoot = path.join(tmp, 'patched');
for (const r of [origRoot, patchRoot]) {
  const d = path.join(r, 'node_modules', '@capacitor', 'geolocation');
  mkdirSync(path.join(d, SRC), { recursive: true });
  writeFileSync(path.join(d, 'package.json'), JSON.stringify({ version: '6.1.1' }));
}
for (const f of Object.keys(FP)) for (const r of [origRoot, patchRoot]) copyFileSync(path.join(PRISTINE_DIR, f), path.join(r, 'node_modules/@capacitor/geolocation', SRC, f));
const PATCH_SCRIPT = path.join(APP, 'scripts/apply-geolocation-compat-patch.mjs');
const pr = spawnSync(process.execPath, [PATCH_SCRIPT, '--root', patchRoot], { encoding: 'utf8' });
if (pr.status !== 0 || !/applied coarse-location compatibility patch/.test(pr.stdout)) failClosed(`real patch script did not apply cleanly: ${pr.stderr || pr.stdout}`);
const treeFile = (root, f) => path.join(root, 'node_modules/@capacitor/geolocation', SRC, f);
for (const [f, { pristine, patched }] of Object.entries(FP)) {
  if (sha(treeFile(origRoot, f)) !== pristine) failClosed(`original tree ${f} is not pristine`);
  if (sha(treeFile(patchRoot, f)) !== patched) failClosed(`patched tree ${f} does not match the approved patched fingerprint ${patched}`);
}
console.log('OK   real patch script applied to the temp copy; original tree = pristine, patched tree = approved patched fingerprints');

function extractMethod(file, signatureStart) {
  const s = readFileSync(file, 'utf8');
  const i = s.indexOf(signatureStart);
  if (i < 0) throw new Error(`signature not found: ${signatureStart}`);
  let depth = 0, j = s.indexOf('{', i);
  for (let k = j; k < s.length; k++) {
    if (s[k] === '{') depth++;
    else if (s[k] === '}') { depth--; if (depth === 0) return s.slice(i, k + 1); }
  }
  throw new Error('unbalanced braces');
}
const pick = (root, f, sig) => extractMethod(path.join(root, 'node_modules/@capacitor/geolocation', SRC, f), sig);
const aliasOrig = pick(origRoot, 'GeolocationPlugin.java', 'private String getAlias(PluginCall call)');
const aliasNew = pick(patchRoot, 'GeolocationPlugin.java', 'private String getAlias(PluginCall call)');
const lastOrig = pick(origRoot, 'Geolocation.java', 'public Location getLastLocation(int maximumAge)');
const lastNew = pick(patchRoot, 'Geolocation.java', 'public Location getLastLocation(int maximumAge)');
// The two compiled implementations must really differ (no silent substitution of one tree for the other).
if (aliasOrig === aliasNew) failClosed('original and patched getAlias() bodies are identical');
if (lastOrig === lastNew) failClosed('original and patched getLastLocation() bodies are identical');
if (/Aura backport|Backport of upstream/.test(aliasOrig + lastOrig)) failClosed('original method bodies contain patch markers');

// --- minimal fakes (only what the two methods touch) ---
const J = path.join(tmp, 'java');
const w = (rel, body) => { const f = path.join(J, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, body); };
w('android/os/Build.java', 'package android.os; public class Build { public static class VERSION { public static int SDK_INT = 30; } public static class VERSION_CODES { public static final int S = 31; } }');
w('android/os/SystemClock.java', 'package android.os; public class SystemClock { public static long now = 0; public static long elapsedRealtimeNanos() { return now; } }');
w('android/content/Context.java', 'package android.content; public class Context { public static final String LOCATION_SERVICE = "location"; public Object svc; public Object getSystemService(String n) { return svc; } }');
w('android/location/Location.java', 'package android.location; public class Location { public final String id; public final long t; public Location(String id, long t) { this.id = id; this.t = t; } public long getElapsedRealtimeNanos() { return t; } }');
w('android/location/LocationManager.java', `package android.location; import java.util.*;
public class LocationManager {
  public final LinkedHashMap<String, Object> providers = new LinkedHashMap<>(); // value: Location | "SEC" | "ISE" | null
  public final List<String> queried = new ArrayList<>();
  public List<String> getAllProviders() { return new ArrayList<>(providers.keySet()); }
  public Location getLastKnownLocation(String p) {
    queried.add(p); Object v = providers.get(p);
    if ("SEC".equals(v)) throw new SecurityException("\\"" + p + "\\" location provider requires ACCESS_FINE_LOCATION permission.");
    if ("ISE".equals(v)) throw new IllegalStateException("unrelated provider failure");
    return (Location) v;
  }
}`);
w('com/getcapacitor/PluginCall.java', 'package com.getcapacitor; public class PluginCall { public Boolean hi; public Boolean getBoolean(String k, Boolean d) { return hi == null ? d : hi; } }');
const harness = (name, aliasM, lastM) => `
import android.content.Context; import android.location.*; import android.os.*; import com.getcapacitor.PluginCall; import java.util.*;
public class ${name} {
  public static class GeolocationPlugin {
    static final String LOCATION = "location"; static final String COARSE_LOCATION = "coarseLocation";
    public Set<String> declared = new HashSet<>(); // declared Android permissions
    boolean isPermissionDeclared(String alias) { // mirrors Capacitor 6.2.1 Plugin.isPermissionDeclared (all strings declared)
      if (alias.equals(LOCATION)) return declared.contains("COARSE") && declared.contains("FINE");
      if (alias.equals(COARSE_LOCATION)) return declared.contains("COARSE");
      return false;
    }
    ${aliasM.replace(/private String getAlias/, 'public String getAlias')}
  }
  public static class Geolocation {
    public Context context = new Context();
    ${lastM.replace(/^@SuppressWarnings[^\n]*\n/, '')}
  }
}`;
w('OrigImpl.java', harness('OrigImpl', aliasOrig, lastOrig));
w('PatchedImpl.java', harness('PatchedImpl', aliasNew, lastNew));
w('Runner.java', `
import android.content.Context; import android.location.*; import android.os.*; import com.getcapacitor.PluginCall; import java.util.*;
public class Runner {
  static int pass = 0, fail = 0;
  static void check(String n, boolean ok) { if (ok) pass++; else fail++; System.out.println((ok ? "OK   " : "FAIL ") + n); }
  static String orig(int sdk, boolean coarse, boolean fine, Boolean hi) { Build.VERSION.SDK_INT = sdk; OrigImpl.GeolocationPlugin p = new OrigImpl.GeolocationPlugin(); if (coarse) p.declared.add("COARSE"); if (fine) p.declared.add("FINE"); PluginCall c = new PluginCall(); c.hi = hi; return p.getAlias(c); }
  static String patched(int sdk, boolean coarse, boolean fine, Boolean hi) { Build.VERSION.SDK_INT = sdk; PatchedImpl.GeolocationPlugin p = new PatchedImpl.GeolocationPlugin(); if (coarse) p.declared.add("COARSE"); if (fine) p.declared.add("FINE"); PluginCall c = new PluginCall(); c.hi = hi; return p.getAlias(c); }
  static LocationManager lm(Object... kv) { LocationManager m = new LocationManager(); for (int i = 0; i < kv.length; i += 2) m.providers.put((String) kv[i], kv[i + 1]); return m; }
  static Object last(boolean patchedImpl, LocationManager m, int maxAgeMs) {
    SystemClock.now = 10_000_000_000L;
    try {
      if (patchedImpl) { PatchedImpl.Geolocation g = new PatchedImpl.Geolocation(); g.context.svc = m; return g.getLastLocation(maxAgeMs); }
      OrigImpl.Geolocation g = new OrigImpl.Geolocation(); g.context.svc = m; return g.getLastLocation(maxAgeMs);
    } catch (RuntimeException e) { return e; }
  }
  public static void main(String[] a) {
    int[] legacy = {22, 23, 26, 28, 29, 30}, modern = {31, 33, 34, 36};
    // ---- Part 1: permission selection ----
    boolean ok = true; for (int s : legacy) ok &= "coarseLocation".equals(patched(s, true, false, false));
    check("coarse-only manifest, API 22-30, enableHighAccuracy=false -> coarseLocation (was 'location')", ok && "location".equals(orig(30, true, false, false)));
    ok = true; for (int s : legacy) ok &= "coarseLocation".equals(patched(s, true, false, true));
    check("coarse-only manifest, API 22-30, enableHighAccuracy=true -> still coarseLocation (never FINE when undeclared)", ok);
    ok = true; for (int s : modern) ok &= "coarseLocation".equals(patched(s, true, false, false)) && patched(s, true, false, false).equals(orig(s, true, false, false));
    check("coarse-only manifest, API 31+, enableHighAccuracy=false -> coarseLocation, identical to original (Aura on Android 12+ unchanged)", ok);
    ok = true; for (int s : new int[]{22,23,26,28,29,30,31,33,34,36}) for (Boolean h : new Boolean[]{false, true, null}) ok &= Objects.equals(patched(s, true, true, h), orig(s, true, true, h));
    check("coarse+fine manifest: identical to original for every API level and enableHighAccuracy value", ok);
    check("no location permission declared -> null (caller rejects 'not declared')", patched(28, false, false, false) == null && patched(34, false, false, true) == null);
    check("fine-only manifest (invalid config; 'location' alias needs COARSE+FINE declared) -> null, i.e. the 'not declared' rejection; no FINE request", patched(28, false, true, false) == null && patched(34, false, true, true) == null);
    // ---- Part 2: provider safety ----
    Location net = new Location("network", 9_999_000_000L);
    Object r = last(true, lm("network", net), 60_000);
    check("accessible coarse provider returns its last location", r == net);
    Object o = last(false, lm("passive", "SEC", "network", net, "gps", "SEC"), 60_000);
    check("NEGATIVE CONTROL: original code propagates SecurityException from 'passive'/'gps' (the crash cause)", o instanceof SecurityException);
    LocationManager m1 = lm("passive", "SEC", "network", net, "gps", "SEC");
    r = last(true, m1, 60_000);
    check("patched: providers throwing SecurityException are skipped; usable coarse result returned", r == net);
    check("patched: every provider is still checked (only the inaccessible ones skipped)", m1.queried.equals(Arrays.asList("passive", "network", "gps")));
    r = last(true, lm("passive", "SEC", "gps", "SEC", "network", null), 60_000);
    check("all providers inaccessible or empty -> null, no exception", r == null);
    r = last(true, lm("network", null, "fused", null), 60_000);
    check("no last-known location anywhere -> null", r == null);
    r = last(true, lm("gps", "SEC", "network", "ISE"), 60_000);
    check("unrelated exception (IllegalStateException) is NOT suppressed", r instanceof IllegalStateException);
    Location older = new Location("fused", 9_998_000_000L);
    r = last(true, lm("gps", "SEC", "network", net, "fused", older), 60_000);
    check("selection semantics unchanged vs original when no exception occurs", r == last(false, lm("network", net, "fused", older), 60_000));
    r = last(true, lm("gps", "SEC", "network", net), 0);
    check("maximumAge=0 (Aura's call) still yields null -> falls through to fused current location (behaviour preserved)", r == null && last(false, lm("network", net), 0) == null);
    System.out.println("\\n" + pass + " passed, " + fail + " failed");
    System.exit(fail == 0 ? 0 : 1);
  }
}`);

const files = [];
const walk = (d) => { for (const e of require_readdir(d)) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : files.push(p); } };
import { readdirSync } from 'node:fs';
function require_readdir(d) { return readdirSync(d, { withFileTypes: true }); }
walk(J);
const out = path.join(tmp, 'classes');
const c = spawnSync(javac, ['-nowarn', '-d', out, ...files], { encoding: 'utf8' });
if (c.status !== 0) { console.log('FAIL javac:\n' + (c.stderr || c.error)); process.exit(1); }
const r = spawnSync(java, ['-cp', out, 'Runner'], { encoding: 'utf8' });
process.stdout.write(r.stdout || ''); if (r.stderr) process.stderr.write(r.stderr);
// Exit 0 only if the JVM ran every check and reported zero failures.
const summary = /\n(\d+) passed, (\d+) failed\n?$/.exec(r.stdout || '');
process.exit(r.status === 0 && summary && Number(summary[1]) === 15 && summary[2] === '0' ? 0 : 1);
