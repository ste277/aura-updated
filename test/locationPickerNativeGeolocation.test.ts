/**
 * AURA-MOBILE-01-M2-B/AND-03: structural regression suite for the native
 * (Capacitor Geolocation) vs. web (navigator.geolocation) split in
 * apps/web/components/LocationPicker.tsx's requestCurrentLocation. No
 * component-test harness exists in this repo for client components, so this
 * follows the same established source-text/regex structural-assertion
 * pattern as test/locationPickerSmartSelection.test.ts (which this file
 * complements, not replaces -- that suite covers the pre-existing web
 * behavior; this one covers exactly what AND-03 added).
 */
import * as fs from 'fs';
import * as path from 'path';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function read(rel: string): string {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}
function stripComments(source: string): string {
  return source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const source = read('apps/web/components/LocationPicker.tsx');
const picker = stripComments(source);
const manifest = read('apps/web/android/app/src/main/AndroidManifest.xml');
// AURA-MOBILE-01-M2-D: messages and the request lifecycle moved to lib modules.
const errorsLib = stripComments(read('apps/web/lib/locationErrors.ts'));
const requestLib = stripComments(read('apps/web/lib/nativeLocationRequest.ts'));

// ============================================================
// Platform dispatch: native vs. web.
// ============================================================

check(
  'requestCurrentLocation dispatches to the native path when Capacitor.isNativePlatform() is true, before ever touching window.isSecureContext/navigator.geolocation',
  /if \(Capacitor\.isNativePlatform\(\)\) \{[\s\S]{0,200}?void requestCurrentLocationNative\(op\);\s*return;\s*\}/.test(picker) &&
    picker.indexOf('void requestCurrentLocationNative(op)') < picker.indexOf('window.isSecureContext === false')
);
check(
  'Capacitor and Geolocation are imported from the first-party @capacitor packages (not a third-party polyfill)',
  /import \{ Capacitor \} from '@capacitor\/core'/.test(picker) && /import \{ Geolocation \} from '@capacitor\/geolocation'/.test(picker)
);
check(
  'the same Capacitor.isNativePlatform() branch pattern already used by lib/haptics.ts and lib/windowNotifications.ts is reused here, not a new ad hoc platform-detection mechanism',
  stripComments(read('apps/web/lib/haptics.ts')).includes('Capacitor.isNativePlatform()') &&
    stripComments(read('apps/web/lib/windowNotifications.ts')).includes('Capacitor.isNativePlatform()')
);

// ============================================================
// Native path: permission flow.
// ============================================================

check('the native path checks existing permissions before requesting new ones (Geolocation.checkPermissions)', /await Geolocation\.checkPermissions\(\)/.test(picker));
check(
  'the native path requests ONLY coarseLocation, never fine/precise location -- matching this app\'s declared AndroidManifest permission and its city-level-accuracy need (AURA-MOBILE-01-M1)',
  /Geolocation\.requestPermissions\(\{ permissions: \['coarseLocation'\] \}\)/.test(picker)
);
check(
  'a denied native permission produces the SAME user-facing message as the web PERMISSION_DENIED path (M2-D: one shared message table in lib/locationErrors.ts, both platforms map to the same permission_denied kind)',
  /permission_denied: 'Location permission was denied\./.test(errorsLib) &&
    /'permission_permanently_denied' : 'permission_denied'/.test(picker) &&
    /geoError\.code === geoError\.PERMISSION_DENIED \? 'permission_denied'/.test(picker) &&
    /locationErrorMessage\(kind, Capacitor\.getPlatform\(\)\)/.test(picker) &&
    /\|\| LOCATION_ERROR_MESSAGES\[kind\]/.test(errorsLib)
);
check(
  'the native path only calls getCurrentPosition after permission is confirmed granted, never unconditionally',
  /if \(!granted\) \{[\s\S]{0,300}?return;\s*\}\s*gpsProgressTimerRef\.current = window\.setTimeout[\s\S]{0,500}?Geolocation\.getCurrentPosition/.test(picker)
);

// ============================================================
// Native path: location request itself.
// ============================================================

check(
  'the native getCurrentPosition call uses enableHighAccuracy: false, matching this app\'s coarse-only design (no fine-location permission is declared, and the plugin ignores high-accuracy without it anyway)',
  /Geolocation\.getCurrentPosition\(\{ enableHighAccuracy: false, timeout: NATIVE_LOCATION_TIMEOUT_MS \}\)/.test(picker)
);
check(
  'the native path has its own catch-all failure handler (never an unhandled promise rejection reaching the user as a crash)',
  /requestCurrentLocationNative[\s\S]*?\} catch \(err\) \{[\s\S]*?classifyNativeLocationError\(err\)[\s\S]*?finishGpsOp\(op, \{ kind, message: locationErrorMessage\(kind, Capacitor\.getPlatform\(\)\) \}\)/.test(picker)
);
check(
  'the native getCurrentPosition call is bounded by an explicit app-level timeout -- the plugin\'s own `timeout` option is ignored on Android (M2-D: single-flight acquireNativeLocation + waitWithTimeout at NATIVE_LOCATION_TIMEOUT_MS = 30 s, timer cleared on settle)',
  /acquireNativeLocation\(\(\) =>\s*Geolocation\.getCurrentPosition/.test(picker) &&
    /waitWithTimeout\(native\.promise, NATIVE_LOCATION_TIMEOUT_MS\)/.test(picker) &&
    /export const NATIVE_LOCATION_TIMEOUT_MS = 30_000;/.test(requestLib) &&
    /window\.clearTimeout\(timer\)/.test(requestLib)
);

// ============================================================
// Shared result handling: both platforms funnel into the same place.
// ============================================================

check(
  'both the native and web GPS paths route through the one shared resolveGpsCoordinates helper (no second/competing coordinate-to-pending translation)',
  (picker.match(/resolveGpsCoordinates\(/g) ?? []).length === 3 /* 1 definition + 2 call sites (native, web) */
);
check(
  'resolveGpsCoordinates never saves automatically -- the result lands in `pending` state via setPending, never onChanged/PATCH directly, on either platform',
  (() => {
    const start = picker.indexOf('async function resolveGpsCoordinates');
    const body = picker.slice(start, picker.indexOf('\n  }\n', start));
    return /setPending\(\{ result: data\.result, source: 'gps'/.test(body) && !/onChanged\(|PATCH/.test(body);
  })()
);

// ============================================================
// Web path untouched (the plan's own explicit requirement).
// ============================================================

check('the web path still checks window.isSecureContext === false with its own distinct message, byte-identical to before AND-03', /window\.isSecureContext === false/.test(picker) && /secure \(https\) connection/.test(picker));
check('the web path still uses navigator.geolocation.getCurrentPosition (not replaced by the native plugin)', /navigator\.geolocation\.getCurrentPosition\(/.test(picker));
check('the web path still passes the same explicit timeout options, unchanged (M2-D: via the WEB_LOCATION_TIMEOUT_MS = 10_000 constant)', /\{ timeout: WEB_LOCATION_TIMEOUT_MS, maximumAge: 0 \}/.test(picker) && /export const WEB_LOCATION_TIMEOUT_MS = 10_000;/.test(requestLib));

// ============================================================
// Manifest / permissions: no new permission introduced.
// ============================================================

check(
  'AndroidManifest.xml still declares the ACCESS_COARSE_LOCATION <uses-permission> tag only -- no ACCESS_FINE_LOCATION tag, no new permission added for AND-03 (the manifest\'s own M1 comment mentioning "ACCESS_FINE_LOCATION" by name, to document that it\'s deliberately excluded, is expected and fine -- only an actual <uses-permission> tag for it would be a problem)',
  /<uses-permission android:name="android\.permission\.ACCESS_COARSE_LOCATION" \/>/.test(manifest) &&
    !/<uses-permission android:name="android\.permission\.ACCESS_FINE_LOCATION"/.test(manifest)
);

console.log(allPassed ? '\nAll locationPickerNativeGeolocation checks passed.' : '\nSome locationPickerNativeGeolocation checks FAILED.');
process.exit(allPassed ? 0 : 1);
