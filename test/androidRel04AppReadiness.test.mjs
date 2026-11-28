// AURA-ANDROID-REL-04 -- static checks for the application-readiness fixes:
//   1. no Android backup / device transfer of the WebView profile (S5A-F2, BK-1);
//   2. the WebView cookie store is flushed when the app leaves the foreground;
//   3. release-build configuration gate and validated versioning;
//   4. logout removes the cookie with the issuing attributes, uncached.
//
//   node test/androidRel04AppReadiness.test.mjs
//
// STATIC checks of source and configuration only. They do not prove runtime
// behaviour: backup/restore, device transfer and process-death behaviour need
// the device acceptance run (AURA_ANDROID_REL_04_APPLICATION_READINESS_REPORT.md).
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'apps', 'web');
const read = (rel) => readFileSync(path.join(APP, rel), 'utf8');
const stripXmlComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');

let passed = 0, failed = 0;
const check = (name, ok, note = '') => {
  ok ? passed++ : failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${note ? ' -- ' + note : ''}`);
};

// ---------- 1. backup and device transfer ----------
const manifest = stripXmlComments(read('android/app/src/main/AndroidManifest.xml'));
const appTag = (manifest.match(/<application\b[^>]*>/) ?? [''])[0];
check('allowBackup="false" on <application>', /android:allowBackup="false"/.test(appTag), appTag.replace(/\s+/g, ' '));
check('allowBackup="true" appears nowhere', !/allowBackup="true"/.test(manifest));
check('fullBackupContent="false" (API 23-30 full backup off)', /android:fullBackupContent="false"/.test(appTag));
check('dataExtractionRules points at @xml/data_extraction_rules (API 31+)', /android:dataExtractionRules="@xml\/data_extraction_rules"/.test(appTag));

const rulesRel = 'android/app/src/main/res/xml/data_extraction_rules.xml';
check('data_extraction_rules.xml exists', existsSync(path.join(APP, rulesRel)));
const rules = existsSync(path.join(APP, rulesRel)) ? stripXmlComments(read(rulesRel)) : '';
const DOMAINS = ['root', 'file', 'database', 'sharedpref', 'external', 'device_root', 'device_file', 'device_database', 'device_sharedpref'];
for (const section of ['cloud-backup', 'device-transfer']) {
  const body = (rules.match(new RegExp(`<${section}\\b[^>]*>([\\s\\S]*?)</${section}>`)) ?? [, null])[1];
  check(`<${section}> section present`, body !== null);
  if (body === null) continue;
  check(`<${section}> has no <include> rules`, !/<include\b/.test(body));
  const excluded = [...body.matchAll(/<exclude\s+domain="([^"]+)"\s+path="\."\s*\/>/g)].map((m) => m[1]);
  for (const d of DOMAINS) check(`<${section}> excludes the whole "${d}" domain`, excluded.includes(d));
}
check('exactly one cloud-backup and one device-transfer section', (rules.match(/<cloud-backup\b/g) ?? []).length === 1 && (rules.match(/<device-transfer\b/g) ?? []).length === 1);

// ---------- 2. cookie flush on leaving the foreground ----------
const javaDir = 'android/app/src/main/java/com/greenarrow/auraschedule/';
const mainAct = read(javaDir + 'MainActivity.java');
check('MainActivity imports android.webkit.CookieManager', /import android\.webkit\.CookieManager;/.test(mainAct));
check('onPause calls super.onPause() then flushCookies()', /public void onPause\(\) \{\s*super\.onPause\(\);\s*flushCookies\(\);\s*\}/.test(mainAct));
check('flushCookies() flushes the WebView cookie store and tolerates a missing provider', /static void flushCookies\(\) \{\s*try \{\s*CookieManager\.getInstance\(\)\.flush\(\);\s*\} catch \(RuntimeException e\)/.test(mainAct));
check('MainActivity never removes cookies itself', !/removeAllCookies|removeSessionCookies|setCookie\(/.test(mainAct));

// ---------- 3. release configuration ----------
const gradle = read('android/app/build.gradle');
check('versionCode comes from validated auraVersionCode()', /versionCode auraVersionCode\(\)/.test(gradle) && !/versionCode\s+\d/.test(gradle));
check('versionName comes from validated auraVersionName()', /versionName auraVersionName\(\)/.test(gradle) && !/versionName\s+"/.test(gradle));
check('versionCode default stays 1, capped at Play maximum', /findProperty\('auraVersionCode'\) \?: '1'/.test(gradle) && /2100000000L/.test(gradle));
check('release gate task registered', /tasks\.register\('verifyReleaseServerConfig'\)/.test(gradle));
check('release gate wired into preReleaseBuild only', /tasks\.matching \{ it\.name == 'preReleaseBuild' \}\.configureEach \{ dependsOn 'verifyReleaseServerConfig' \}/.test(gradle) && !/preDebugBuild/.test(gradle));
check('release gate requires https and rejects local/private hosts and cleartext', /uri\.scheme != 'https'/.test(gradle) && /host == 'localhost'/.test(gradle) && /192\\\.168/.test(gradle) && /server\.cleartext == true/.test(gradle));
check('release gate requires errorPath and WebView floor 91', /server\.errorPath != 'unsupported-webview\.html'/.test(gradle) && /minWebViewVersion != 91/.test(gradle));
check('geolocation patch gate still wired into preBuild', /tasks\.named\('preBuild'\)\s*\{\s*dependsOn 'verifyGeolocationCompatPatch'\s*\}/.test(gradle));
check('no signing configuration committed (signing is an owner action)', !/signingConfigs?\b/.test(gradle) && !/storePassword|keyPassword|\.jks|\.keystore/.test(gradle));
check('release build keeps minify off (Capacitor plugin reflection; no R8 rules prepared)', /release \{\s*minifyEnabled false/.test(gradle));
const vars = read('android/variables.gradle');
check('minSdk 29 / target 36 preserved', /minSdkVersion = 29/.test(vars) && /targetSdkVersion = 36/.test(vars) && /compileSdkVersion = 36/.test(vars));
const capCfg = read('capacitor.config.ts');
check('capacitor.config.ts no longer names Railway for production', !/railway/i.test(capCfg));

// ---------- 4. logout route ----------
const logout = read('app/api/auth/logout/route.ts');
const verifyCode = read('app/api/auth/verify-code/route.ts');
check('logout clears with maxAge 0 and path /', /maxAge: 0/.test(logout) && /path: '\/'/.test(logout));
check('logout uses the issuing attributes (httpOnly, secure in production, sameSite lax)', /httpOnly: true/.test(logout) && /secure: process\.env\.NODE_ENV === 'production'/.test(logout) && /sameSite: 'lax'/.test(logout) && /httpOnly: true/.test(verifyCode) && /sameSite: 'lax'/.test(verifyCode));
check('logout response is not cacheable', /Cache-Control', 'no-store'/.test(logout));
const page = read('app/page.tsx');
check('Home sign-out goes through performSignOut (no unconditional setUser(null))', /performSignOut\(/.test(page) && !/await fetch\('\/api\/auth\/logout'/.test(page));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
