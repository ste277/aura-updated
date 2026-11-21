/**
 * AURA-MOBILE-01-IOS-02 -- iOS location error mapping, iOS Settings wording,
 * no automatic location request on resume, and the coordinate-free
 * (POST-body) city lookup.
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/ios02LocationErrorsAndPrivacy.test.ts
 *
 * SYNTHETIC ONLY: Capacitor is mocked, positions are fixed synthetic values,
 * time is a fake clock. No device, network, GPS or geocoding provider.
 */
import * as fs from 'fs';
import * as path from 'path';
import { React, mount, click, flush, act } from './jsdomReactHarness';

// ---------- fake clock ----------
let now = 0;
let seq = 0;
const timers = new Map<number, { at: number; fn: () => void }>();
(window as any).setTimeout = (fn: () => void, ms = 0) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; };
(window as any).clearTimeout = (id: number) => { timers.delete(id); };
Date.now = () => now;
async function advanceTo(t: number) {
  for (;;) {
    const due = [...timers.entries()].filter(([, v]) => v.at <= t).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
    if (!due) break;
    timers.delete(due[0]); now = due[1].at;
    await act(async () => { due[1].fn(); });
    await flush();
  }
  now = t; await flush();
}

// ---------- Capacitor mocks (iOS plugin semantics: both keys share one value) ----------
type PermState = 'granted' | 'denied' | 'prompt';
const SYNTH = { latitude: 12.3456, longitude: 78.9012, accuracy: 3000 };
const geo = {
  check: 'granted' as PermState,
  requestResult: 'granted' as PermState,
  delay: 1_000 as number | null,
  fail: null as string | null,
  calls: { check: 0, request: 0, get: 0 },
};
const Geolocation = {
  checkPermissions: async () => { geo.calls.check++; return { location: geo.check, coarseLocation: geo.check }; },
  requestPermissions: async () => { geo.calls.request++; return { location: geo.requestResult, coarseLocation: geo.requestResult }; },
  getCurrentPosition: () => {
    geo.calls.get++;
    return new Promise((resolve, reject) => {
      if (geo.delay === null) return;
      const fail = geo.fail;
      (window as any).setTimeout(() => (fail ? reject(new Error(fail)) : resolve({ coords: { ...SYNTH } })), geo.delay);
    });
  },
};
let platform = 'ios';
const settingsCalls = { open: 0 };
const resumeHandlers = new Set<() => void>();
const Capacitor = { isNativePlatform: () => platform !== 'web', getPlatform: () => platform };
function registerPlugin(name: string) {
  if (name === 'AppSettings') return { open: async () => { settingsCalls.open++; } };
  return {};
}
const App = {
  addListener: (event: string, fn: () => void) => {
    if (event === 'resume') resumeHandlers.add(fn);
    return Promise.resolve({ remove: () => resumeHandlers.delete(fn) });
  },
};
const pickerDir = path.join(__dirname, '..', 'apps', 'web', 'components');
function installMock(id: string, exports: unknown) {
  const resolved = require.resolve(id, { paths: [pickerDir] });
  const Module = require('module'); const m = new Module(resolved);
  m.filename = resolved; m.loaded = true; m.exports = exports; require.cache[resolved] = m;
}
installMock('@capacitor/core', { Capacitor, registerPlugin });
installMock('@capacitor/geolocation', { Geolocation });
installMock('@capacitor/app', { App });

// ---------- fetch mock: records method, URL and body of every city lookup ----------
interface ReverseCall { url: string; method: string; body: string; contentType: string; cache: string }
const reverseCalls: ReverseCall[] = [];
const allUrls: string[] = [];
(global as any).fetch = (url: string, init: any = {}) => {
  const u = String(url);
  allUrls.push(u);
  if (!u.startsWith('/api/location/reverse')) return new Promise(() => {});
  reverseCalls.push({
    url: u,
    method: String(init.method ?? 'GET'),
    body: typeof init.body === 'string' ? init.body : '',
    contentType: String(init.headers?.['Content-Type'] ?? ''),
    cache: String(init.cache ?? ''),
  });
  return Promise.resolve({ ok: false, status: 503, json: async () => ({ error: 'Location lookup is not available right now.', configured: false }) });
};

const { LocationPicker } = require('../apps/web/components/LocationPicker');
const NL = require('../apps/web/lib/nativeLocationRequest');
const LE = require('../apps/web/lib/locationErrors');
const M = LE.LOCATION_ERROR_MESSAGES;
const IOS_DENIED = LE.locationErrorMessage('permission_permanently_denied', 'ios');

const consoleErrors: string[] = [];
console.error = (...a: unknown[]) => { consoleErrors.push(a.map(String).join(' ')); };

let passed = 0, failed = 0;
function check(label: string, ok: boolean) { ok ? passed++ : failed++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`); }

const strictPicker = () => React.createElement(React.StrictMode, null, React.createElement(LocationPicker, { currentCity: 'Chennai', onChanged: () => {} }));
const btn = (c: HTMLElement) => c.querySelector('button[aria-label="Use my current location"]') as HTMLButtonElement | null;
const alert = (c: HTMLElement) => c.querySelector('[role="alert"]')?.textContent ?? null;
const statusText = (c: HTMLElement) => [...c.querySelectorAll('[role="status"]')].map((e) => e.textContent).join(' | ');
const settingsBtn = (c: HTMLElement) => [...c.querySelectorAll('button')].find((b) => b.textContent === 'Open Settings') ?? null;
const hasManualFallback = (c: HTMLElement) =>
  [...c.querySelectorAll('button')].some((b) => /Advanced options/.test(b.textContent ?? '')) && !!c.querySelector('input');
const btnLabel = (c: HTMLElement) => btn(c)?.textContent ?? '';

function reset(p = 'ios') {
  now = 0; timers.clear(); NL.__resetNativeLocationForTests();
  geo.check = 'granted'; geo.requestResult = 'granted'; geo.delay = 1_000; geo.fail = null;
  geo.calls = { check: 0, request: 0, get: 0 };
  platform = p; settingsCalls.open = 0; reverseCalls.length = 0; allUrls.length = 0; consoleErrors.length = 0;
}
async function tap(c: HTMLElement) { await click(btn(c)!); await flush(); }
async function emitResume() { await act(async () => { resumeHandlers.forEach((f) => f()); }); await flush(); await flush(); }

const iosCl = (code: number) => new Error(`The operation couldn’t be completed. (kCLErrorDomain error ${code}.)`);

async function run() {
  // ======================= A. Classifier (pure) =======================
  check('A1 iOS kCLErrorDomain 0 (location unknown) -> unavailable', LE.classifyNativeLocationError(iosCl(0)) === 'unavailable');
  check('A2 iOS kCLErrorDomain 1 (denied) -> permission_permanently_denied (iOS never re-prompts)', LE.classifyNativeLocationError(iosCl(1)) === 'permission_permanently_denied');
  check('A3 iOS kCLErrorDomain 2 (network) -> unavailable', LE.classifyNativeLocationError(iosCl(2)) === 'unavailable');
  check('A4 other kCLErrorDomain codes stay generic (unexpected)', LE.classifyNativeLocationError(iosCl(17)) === 'unexpected');
  check('A5 localized iOS text still classifies (only the kCLErrorDomain token + code are matched)',
    LE.classifyNativeLocationError(new Error('L’opération n’a pas pu s’achever. (kCLErrorDomain erreur 0.)')) === 'unavailable' &&
    LE.classifyNativeLocationError(new Error('Der Vorgang konnte nicht abgeschlossen werden. (kCLErrorDomain-Fehler 1.)')) === 'permission_permanently_denied');
  const androidTable: Array<[unknown, string]> = [
    [new Error('location unavailable'), 'unavailable'],
    [new Error('location disabled'), 'services_disabled'],
    [new Error('Location services are not enabled'), 'services_disabled'],
    [new Error('Location permission was denied'), 'permission_denied'],
    [new Error('Google Play Services not available'), 'unavailable'],
    [new LE.LocationTimeoutError(), 'timeout'],
    [new Error('java.lang.SecurityException: internal detail'), 'unexpected'],
    [undefined, 'unexpected'],
  ];
  check('A6 Android/M2-D classification table unchanged', androidTable.every(([e, k]) => LE.classifyNativeLocationError(e) === k));

  // ======================= B. Messages (pure) =======================
  check('B1 iOS permanent-denial copy names the Settings app and offers manual entry', /iOS Settings app/.test(IOS_DENIED) && /manually/.test(IOS_DENIED));
  check('B2 iOS copy never implies an in-app button ("Open Settings" / "tap")', !/Open Settings|tap/i.test(IOS_DENIED));
  check('B3 Android and web keep the existing shared copy', LE.locationErrorMessage('permission_permanently_denied', 'android') === M.permission_permanently_denied && LE.locationErrorMessage('permission_permanently_denied', 'web') === M.permission_permanently_denied);
  const kinds = Object.keys(M);
  check('B4 every other kind is identical on iOS (only the permanent-denial wording differs)', kinds.filter((k) => k !== 'permission_permanently_denied').every((k) => LE.locationErrorMessage(k, 'ios') === M[k]));
  check('B5 iOS copy meets the M2-D message rules (concise, actionable, no digits / raw text)', IOS_DENIED.length < 140 && !/\d/.test(IOS_DENIED) && !/kCLError/i.test(IOS_DENIED));

  // ======================= C. Picker on iOS =======================
  reset();
  {
    geo.fail = iosCl(0).message;
    const h = await mount(strictPicker());
    await tap(h.container); await advanceTo(1_000);
    check('C1 iOS location unknown -> "couldn\'t determine your location" (not the generic message)', alert(h.container) === M.unavailable);
    check('C2 ...raw native error never shown', !/kCLError|operation/i.test(h.container.textContent ?? ''));
    check('C3 ...manual-city fallback still available', hasManualFallback(h.container));
    check('C4 ...no city lookup attempted on failure', reverseCalls.length === 0);
    await h.unmount();
  }
  reset();
  {
    geo.fail = iosCl(1).message;
    const h = await mount(strictPicker());
    await tap(h.container); await advanceTo(1_000);
    check('C5 iOS denied mid-request -> iOS Settings guidance', alert(h.container) === IOS_DENIED);
    check('C6 ...no Open Settings button on iOS', !settingsBtn(h.container));
    await h.unmount();
  }
  reset();
  {
    geo.check = 'denied'; geo.requestResult = 'denied';
    const h = await mount(strictPicker());
    await tap(h.container);
    check('C7 iOS permission denied -> iOS wording, no button, no acquisition', alert(h.container) === IOS_DENIED && !settingsBtn(h.container) && geo.calls.get === 0);
    const req = geo.calls.request, get = geo.calls.get;
    await emitResume();
    check('C8 resume while still denied: permission re-checked only -- no request, no acquisition, message kept', geo.calls.request === req && geo.calls.get === get && alert(h.container) === IOS_DENIED);
    geo.check = 'granted';
    await emitResume();
    check('C9 resume after enabling in iOS Settings: error cleared, retry prompt shown, still no automatic request/acquisition',
      alert(h.container) === null && /Tap "Use my current location" to try again/.test(statusText(h.container)) && geo.calls.request === req && geo.calls.get === get);
    await tap(h.container); await advanceTo(1_000);
    check('C10 retry after returning works (one acquisition, one lookup)', geo.calls.get === 1 && reverseCalls.length === 1);
    await h.unmount();
  }
  reset();
  {
    const h = await mount(strictPicker());
    await emitResume(); await emitResume();
    check('C11 resume with no error showing never touches Geolocation', geo.calls.check === 0 && geo.calls.request === 0 && geo.calls.get === 0);
    await h.unmount();
  }
  reset('android');
  {
    geo.check = 'denied'; geo.requestResult = 'denied';
    const h = await mount(strictPicker());
    await tap(h.container);
    check('C12 Android permanent denial unchanged: shared copy + Open Settings button', alert(h.container) === M.permission_permanently_denied && !!settingsBtn(h.container));
    await click(settingsBtn(h.container)!); await flush();
    check('C13 Android Open Settings still opens once', settingsCalls.open === 1);
    await h.unmount();
  }

  // ======================= D. Timeout / single-flight preserved =======================
  reset();
  {
    geo.delay = null;
    const h = await mount(strictPicker());
    await tap(h.container); await tap(h.container);
    await advanceTo(10_000);
    check('D1 iOS: progress message at 10 s; second tap joined (one native request)', /Still finding your location/.test(btnLabel(h.container)) && geo.calls.get === 1);
    await advanceTo(30_000);
    check('D2 iOS: timeout message at 30 s', alert(h.container) === M.timeout);
    await h.unmount();
  }

  // ======================= E. City lookup carries no coordinates in the URL =======================
  reset();
  {
    const h = await mount(strictPicker());
    await tap(h.container); await advanceTo(1_000);
    const c = reverseCalls[0];
    check('E1 one lookup, method POST', reverseCalls.length === 1 && c.method === 'POST');
    check('E2 URL is exactly /api/location/reverse (no query string)', c?.url === '/api/location/reverse');
    check('E3 no request URL anywhere contains a coordinate or lat/lng parameter',
      allUrls.every((u) => !/[?&](lat|lng|latitude|longitude)=/i.test(u) && !u.includes(String(SYNTH.latitude)) && !u.includes(String(SYNTH.longitude))));
    const body = JSON.parse(c?.body || '{}');
    check('E4 JSON body carries exactly { latitude, longitude } as numbers', c?.contentType === 'application/json' && Object.keys(body).sort().join(',') === 'latitude,longitude' && body.latitude === SYNTH.latitude && body.longitude === SYNTH.longitude);
    check('E5 lookup requested with cache: no-store', c?.cache === 'no-store');
    check('E6 503 (provider not configured) -> city-lookup message + manual fallback', alert(h.container) === M.geocode_unavailable && hasManualFallback(h.container));
    await h.unmount();
  }

  // ======================= F. Structural guards =======================
  const root = path.join(__dirname, '..', 'apps', 'web');
  const pickerSrc = fs.readFileSync(path.join(root, 'components', 'LocationPicker.tsx'), 'utf8');
  check('F1 LocationPicker no longer builds a ?lat=&lng= URL', !/location\/reverse\?/.test(pickerSrc) && !/[?&]lat=\$\{/.test(pickerSrc));
  check('F2 LocationPicker never logs (no console.* calls)', !/console\.(log|info|warn|error|debug)\(/.test(pickerSrc));

  check('Z no React warnings / console errors', consoleErrors.length === 0);
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => { console.log('FAIL (threw)', e); process.exit(1); });
