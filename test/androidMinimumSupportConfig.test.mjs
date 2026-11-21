// AURA-MOBILE-01-AND-MIN-01 -- static checks for the Android minimum-support baseline:
// minSdk 29, Capacitor android.minWebViewVersion 91, and the JavaScript-free
// server.errorPath page.
//
//   node test/androidMinimumSupportConfig.test.mjs
//
// These are STATIC checks of source and configuration. They do not prove that
// Capacitor shows the page at runtime; that needs a device or emulator run.
// No dependencies beyond the TypeScript compiler already used by the repo.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'apps', 'web');
const read = (rel) => readFileSync(path.join(APP, rel), 'utf8');

let passed = 0, failed = 0;
const check = (name, ok, note = '') => {
  ok ? passed++ : failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${note ? ' -- ' + note : ''}`);
};

// ---------- 1. variables.gradle ----------
const gradle = read('android/variables.gradle');
const ext = Object.fromEntries(
  [...gradle.matchAll(/^\s*(\w+)\s*=\s*'?([^'\s]+)'?\s*$/gm)].map((m) => [m[1], m[2]]),
);
check('minSdkVersion is 29', ext.minSdkVersion === '29', `got ${ext.minSdkVersion}`);
// AND-TARGET-01: Google Play requires target API 36 (since 31 Aug 2026).
check('targetSdkVersion is 36', ext.targetSdkVersion === '36', `got ${ext.targetSdkVersion}`);
check('compileSdkVersion is 36', ext.compileSdkVersion === '36', `got ${ext.compileSdkVersion}`);
// Every other ext value must match the pre-AND-MIN-01 baseline exactly.
const BASELINE = {
  androidxActivityVersion: '1.8.0',
  androidxAppCompatVersion: '1.6.1',
  androidxCoordinatorLayoutVersion: '1.2.0',
  androidxCoreVersion: '1.12.0',
  androidxFragmentVersion: '1.6.2',
  coreSplashScreenVersion: '1.0.1',
  androidxWebkitVersion: '1.9.0',
  junitVersion: '4.13.2',
  androidxJunitVersion: '1.1.5',
  androidxEspressoCoreVersion: '3.5.1',
  cordovaAndroidVersion: '10.1.1',
};
const extKeys = Object.keys(ext).sort();
const expectedKeys = [...Object.keys(BASELINE), 'minSdkVersion', 'compileSdkVersion', 'targetSdkVersion'].sort();
check('variables.gradle has exactly the baseline keys', JSON.stringify(extKeys) === JSON.stringify(expectedKeys), extKeys.join(','));
for (const [k, v] of Object.entries(BASELINE)) check(`${k} unchanged (${v})`, ext[k] === v, `got ${ext[k]}`);

// ---------- 2. capacitor.config.ts, evaluated as the Capacitor CLI would ----------
// The CLI requires the TS config in-process, so process.argv is the CLI's argv.
const require = createRequire(path.join(APP, 'package.json'));
const ts = require('typescript');
const cfgSrc = read('capacitor.config.ts');
const js = ts.transpileModule(cfgSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
function loadConfig(argv, env = {}) {
  const module = { exports: {} };
  const fakeProcess = { argv: ['node', 'cap', ...argv], env };
  vm.runInNewContext(js, { module, exports: module.exports, require, process: fakeProcess });
  return { config: module.exports.default, mod: module.exports };
}

const android = loadConfig(['sync', 'android']).config;
const androidEnv = loadConfig(['sync', 'android'], { CAP_SERVER_URL: 'http://10.0.2.2:3000' }).config;
const ios = loadConfig(['sync', 'ios']).config;
const both = loadConfig(['sync']).config;
const { mod } = loadConfig(['sync', 'android']);

check('android.minWebViewVersion is 91 (cap sync android)', android.android?.minWebViewVersion === 91, JSON.stringify(android.android));
check('exported ANDROID_MIN_WEBVIEW_VERSION is 91', mod.ANDROID_MIN_WEBVIEW_VERSION === 91);
check('android.minWebViewVersion is 91 for every command', ios.android?.minWebViewVersion === 91 && both.android?.minWebViewVersion === 91);
check('android block has only minWebViewVersion', JSON.stringify(Object.keys(android.android ?? {})) === '["minWebViewVersion"]');
check('server.errorPath set for `cap sync android`', android.server?.errorPath === 'unsupported-webview.html', String(android.server?.errorPath));
check('server.errorPath NOT set for `cap sync ios` (iOS unchanged)', !('errorPath' in (ios.server ?? {})));
// KNOWN GAP (review MIN-F1/F5): a combined `cap sync` also drops errorPath for Android, so the
// floor only logs. This keeps iOS unchanged; docs require per-platform syncs. Release-time
// enforcement of the generated Android config is a separate follow-up.
check('server.errorPath NOT set for combined `cap sync` (iOS unchanged; known Android gap)', !('errorPath' in (both.server ?? {})));
check('config header documents per-platform sync', /npx cap sync android` and `npx cap sync ios`/.test(cfgSrc));
check('deploy/README.md documents per-platform sync, not combined', (() => {
  const r = readFileSync(path.join(ROOT, 'deploy', 'README.md'), 'utf8');
  // Every `npx cap sync` mention must name a platform, except the "Do not use a combined" warning.
  const bare = [...r.matchAll(/npx cap sync(?! (android|ios)\b)/g)]
    .filter((m) => !/Do not use a combined `$/.test(r.slice(Math.max(0, m.index - 30), m.index)));
  return /npx cap sync android/.test(r) && /npx cap sync ios/.test(r) && bare.length === 0;
})());
check('server.errorPath NOT set when argv names both platforms', !('errorPath' in (loadConfig(['sync', 'android', 'ios']).config.server ?? {})));

// Existing values preserved.
check('appId preserved', android.appId === 'com.greenarrow.auraschedule');
check('appName preserved', android.appName === 'AuraSchedule');
check('webDir preserved (cap-shell)', android.webDir === 'cap-shell');
check('backgroundColor preserved', android.backgroundColor === '#090d16');
check('default server.url preserved', android.server?.url === 'http://localhost:3000' && android.server?.cleartext === true);
check('CAP_SERVER_URL still drives server.url', androidEnv.server?.url === 'http://10.0.2.2:3000' && androidEnv.server?.cleartext === true);
check('https server.url keeps cleartext false', loadConfig(['sync', 'android'], { CAP_SERVER_URL: 'https://example.test' }).config.server?.cleartext === false);
const topKeys = Object.keys(android).sort().join(',');
check('top-level config keys limited to the approved set', topKeys === 'android,appId,appName,backgroundColor,server,webDir', topKeys);
const serverKeys = Object.keys(android.server).sort().join(',');
check('server keys limited to url, cleartext, errorPath', serverKeys === 'cleartext,errorPath,url', serverKeys);
check('no ios block added', !('ios' in android));

// ---------- 3. errorPath resolves to the intended asset ----------
const errorPath = android.server.errorPath;
check('errorPath is a plain relative file name', /^[\w.-]+\.html$/.test(errorPath) && !errorPath.includes('..') && !errorPath.startsWith('/'));
const pageFile = path.join(APP, android.webDir, errorPath);
check('errorPath file exists under webDir (cap-shell/unsupported-webview.html)', existsSync(pageFile), pageFile);

// ---------- 4. the page is self-contained and JavaScript-free ----------
const html = existsSync(pageFile) ? readFileSync(pageFile, 'utf8') : '';
const noComments = html.replace(/<!--[\s\S]*?-->/g, '');
check('page contains no <script>', !/<script\b/i.test(html));
check('page has no inline event handlers (on*=)', !/\son[a-z]+\s*=/i.test(noComments));
check('page has no javascript: URLs', !/javascript:/i.test(noComments));
check('page has no src=, href=, srcset=, action= or data= attributes', !/\s(src|href|srcset|action|data|poster|formaction)\s*=/i.test(noComments));
check('page has no url( or @import in CSS', !/url\s*\(|@import/i.test(noComments));
check('page has no http(s):// or // resource references', !/(https?:)?\/\/[a-z0-9]/i.test(noComments));
check('page has no <link>, <img>, <iframe>, <object>, <embed>, <form>, <base>, <svg>', !/<(link|img|iframe|object|embed|form|base|svg|video|audio|source)\b/i.test(noComments));
check('page has a restrictive CSP (default-src none)', /http-equiv="Content-Security-Policy"\s+content="default-src 'none'; style-src 'unsafe-inline'"/.test(html));
check('page declares viewport for small screens', /<meta name="viewport" content="width=device-width, initial-scale=1/.test(html));
check('page declares lang', /<html lang="en">/.test(html));
check('page base font size is at least 16px', /font-size:\s*16px/.test(html));
check('page is small (< 8 KiB)', existsSync(pageFile) && statSync(pageFile).size < 8192);
const text = noComments.replace(/<style[\s\S]*?<\/style>/i, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
check('page names Android System WebView', /Android System WebView/.test(text));
check('page asks to update via app store or device software update', /update Android System WebView through your device's app store/.test(text) && /device software update/.test(text));
check('page says to reopen Aura', /reopen Aura/.test(text));
check('page does not promise every device can update', /may not be compatible with this version of Aura/.test(text));
// AND-ERR-01: errorPath now fires ONLY for the WebView floor (network/HTTP failures use connection-error.html).
check('floor page is WebView-only: does not suggest a connection fix', !/check your internet connection|tap Try again|can't reach its service/i.test(text) && /won't fix this/i.test(text));
check('page exposes no technical internals', !/(Capacitor|Chromium|minWebViewVersion|errorPath|ERR_|stack|exception|version 91)/i.test(text));

// ---------- 4b. AND-ERR-01 connection page + native error client (static only) ----------
const connFile = path.join(APP, android.webDir, 'connection-error.html');
const conn = existsSync(connFile) ? readFileSync(connFile, 'utf8') : '';
const connNoComments = conn.replace(/<!--[\s\S]*?-->/g, '');
const connText = connNoComments.replace(/<style[\s\S]*?<\/style>/i, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
check('connection page exists in webDir', existsSync(connFile));
check('connection page has no <script>, on*= or javascript:', !/<script\b/i.test(conn) && !/\son[a-z]+\s*=/i.test(connNoComments) && !/javascript:/i.test(connNoComments));
check('connection page has no external resources', !/\s(src|srcset|action|data|poster|formaction)\s*=/i.test(connNoComments) && !/url\s*\(|@import/i.test(connNoComments) && !/(https?:)?\/\/[a-z0-9]/i.test(connNoComments) && !/<(link|img|iframe|object|embed|form|base|svg|video|audio|source)\b/i.test(connNoComments));
const hrefs = [...connNoComments.matchAll(/\shref\s*=\s*"([^"]*)"/gi)].map((m) => m[1]);
check('connection page has exactly one link: the local relative retry path', JSON.stringify(hrefs) === '["/__aura/retry"]', JSON.stringify(hrefs));
check('connection page has the restrictive CSP', /http-equiv="Content-Security-Policy"\s+content="default-src 'none'; style-src 'unsafe-inline'"/.test(conn));
check('connection page explains connectivity and offers Try again, no WebView advice', /can't connect/i.test(connText) && /Try again/.test(connText) && !/WebView/i.test(connText));
const javaDir = path.join(APP, 'android', 'app', 'src', 'main', 'java', 'com', 'greenarrow', 'auraschedule');
const client = existsSync(path.join(javaDir, 'AuraWebViewClient.java')) ? readFileSync(path.join(javaDir, 'AuraWebViewClient.java'), 'utf8') : '';
const mainAct = readFileSync(path.join(javaDir, 'MainActivity.java'), 'utf8');
check('AuraWebViewClient extends BridgeWebViewClient', /class AuraWebViewClient extends BridgeWebViewClient/.test(client));
check('client page/path constants match the HTML', /CONNECTION_PAGE = "connection-error\.html"/.test(client) && /RETRY_PATH = "\/__aura\/retry"/.test(client));
check('client keeps 4xx (incl. 404) responses: only status >= 500 replaced', /status < 500/.test(client));
check('retry re-checks the WebView floor first', /void retry\(WebView view\) \{\s*if \(!bridge\.isMinimumWebViewInstalled\(\)\)/.test(client));
check('retry link honoured only from the connection page', /if \(isConnectionPage\(view\.getUrl\(\)\)\) retry\(view\)/.test(client));
check('MainActivity installs the client after super.onCreate and keeps AppSettingsPlugin', /registerPlugin\(AppSettingsPlugin\.class\);\s*super\.onCreate\(savedInstanceState\);[\s\S]*bridge\.setWebViewClient\(auraWebViewClient\)/.test(mainAct));
check('Back on fallback finishes; otherwise delegates to the next callback', /isFallbackUrl\(url\)\) \{\s*finish\(\);[\s\S]*setEnabled\(false\);\s*getOnBackPressedDispatcher\(\)\.onBackPressed\(\);\s*setEnabled\(true\);/.test(mainAct));
check('Back on a kept full-page 4xx goes back natively (or finishes)', /isKeptHttpErrorPage\(url\)\) \{\s*if \(bridge\.getWebView\(\)\.canGoBack\(\)\) bridge\.getWebView\(\)\.goBack\(\);\s*else finish\(\);/.test(mainAct) && /if \(url == null \|\| !url\.equals\(keptHttpErrorUrl\)\) keptHttpErrorUrl = null;/.test(client));
check('no Capacitor/plugin sources modified for ERR-01 (errorPath + floor config unchanged)', android.server?.errorPath === 'unsupported-webview.html' && android.android?.minWebViewVersion === 91);

// ---------- 5. existing Android behaviour that must be preserved ----------
const manifest = read('android/app/src/main/AndroidManifest.xml').replace(/<!--[\s\S]*?-->/g, '');
const perms = [...manifest.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)].map((m) => m[1]);
check('ACCESS_COARSE_LOCATION still declared', perms.includes('android.permission.ACCESS_COARSE_LOCATION'));
check('ACCESS_FINE_LOCATION still not declared', !perms.some((p) => p.endsWith('ACCESS_FINE_LOCATION')), perms.join(','));
const appGradle = read('android/app/build.gradle');
check('geolocation patch Gradle gate still wired into preBuild', /tasks\.named\('preBuild'\)\s*\{\s*dependsOn 'verifyGeolocationCompatPatch'\s*\}/.test(appGradle));
check('existing cap-shell/index.html offline page still present', existsSync(path.join(APP, 'cap-shell', 'index.html')));

// ---------- 6. iOS generated config not given the Android error page ----------
const iosJson = path.join(APP, 'ios', 'App', 'App', 'capacitor.config.json');
if (existsSync(iosJson)) {
  const j = JSON.parse(readFileSync(iosJson, 'utf8'));
  check('iOS capacitor.config.json has no server.errorPath', !('errorPath' in (j.server ?? {})));
} else {
  console.log('SKIP iOS capacitor.config.json not present');
}

// Informational only: generated Android config is gitignored and written by `npx cap sync android`.
const genAndroid = path.join(APP, 'android', 'app', 'src', 'main', 'assets', 'capacitor.config.json');
if (existsSync(genAndroid)) {
  const g = JSON.parse(readFileSync(genAndroid, 'utf8'));
  const synced = g.android?.minWebViewVersion === 91 && g.server?.errorPath === 'unsupported-webview.html';
  console.log(`INFO generated Android config ${synced ? 'includes' : 'does NOT yet include'} the gate (run \`npx cap sync android\` to regenerate)`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
