/**
 * AURA-MOBILE-01-M2-D -- synthetic regression suite for native location
 * reliability: single-flight requests, timeout lifecycle (30 s native policy
 * + 10 s progress message), permanent-denial Settings recovery, standardised
 * error messages, and lifecycle (Strict Mode, unmount, back, resume).
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/locationPickerM2dReliability.test.ts
 *
 * SYNTHETIC ONLY: Capacitor (core, geolocation, app, AppSettings) is mocked,
 * every position is (0, 0), time is a fake clock. No device, network or GPS.
 */
import * as path from 'path';
import { React, mount, click, flush, act } from './jsdomReactHarness';

// ---------- fake clock: window.setTimeout/clearTimeout + Date.now ----------
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

// ---------- Capacitor mocks ----------
type PermState = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale';
const geo = {
  check: 'granted' as PermState,
  checkRejects: null as string | null,
  requestResults: [] as PermState[],
  /** per native call: delay ms (null = never), and outcome */
  delay: 2_000 as number | null,
  fail: null as string | null,
  calls: { check: 0, request: 0, get: 0 },
  settlers: [] as Array<{ resolve: () => void; reject: (m: string) => void }>,
};
const Geolocation = {
  checkPermissions: async () => {
    geo.calls.check++;
    if (geo.checkRejects) throw new Error(geo.checkRejects);
    return { location: geo.check === 'granted' ? 'granted' : 'prompt', coarseLocation: geo.check };
  },
  requestPermissions: async () => {
    geo.calls.request++;
    const r = geo.requestResults.shift() ?? 'prompt-with-rationale';
    return { location: r === 'granted' ? 'granted' : 'prompt', coarseLocation: r };
  },
  getCurrentPosition: () => {
    geo.calls.get++;
    return new Promise((resolve, reject) => {
      const ok = () => resolve({ coords: { latitude: 0, longitude: 0, accuracy: 2000 } });
      const bad = (m: string) => reject(new Error(m));
      geo.settlers.push({ resolve: ok, reject: bad });
      if (geo.delay === null) return;
      const fail = geo.fail;
      (window as any).setTimeout(() => (fail ? bad(fail) : ok()), geo.delay);
    });
  },
};
let platform = 'android';
const settingsCalls = { open: 0 };
let settingsOpenFails = false;
const resumeHandlers = new Set<() => void>();
const Capacitor = { isNativePlatform: () => platform !== 'web', getPlatform: () => platform };
function registerPlugin(name: string) {
  if (name === 'AppSettings') return { open: async () => { settingsCalls.open++; if (settingsOpenFails) throw new Error('x'); } };
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

// ---------- reverse-geocode mock ----------
let reverseMode: 'ok' | '503' | '404' | 'throw' = 'ok';
const reverseCalls: number[] = [];
(global as any).fetch = (url: string) => {
  if (!String(url).startsWith('/api/location/reverse')) return new Promise(() => {});
  reverseCalls.push(now);
  if (reverseMode === 'throw') return Promise.reject(new Error('network'));
  if (reverseMode === '503') return Promise.resolve({ ok: false, status: 503, json: async () => ({ error: 'Location lookup is not available right now.', configured: false }) });
  if (reverseMode === '404') return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: "Couldn't identify a place at this location. Try searching instead." }) });
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ result: { displayName: 'Synthetic Town', cityName: 'Synthetic Town', latitude: 0, longitude: 0, timezone: 'UTC' } }) });
};

const { LocationPicker } = require('../apps/web/components/LocationPicker');
const NL = require('../apps/web/lib/nativeLocationRequest');
const LE = require('../apps/web/lib/locationErrors');
const M = LE.LOCATION_ERROR_MESSAGES;

const consoleErrors: string[] = [];
const origError = console.error;
console.error = (...a: unknown[]) => { consoleErrors.push(a.map(String).join(' ')); };

let passed = 0, failed = 0;
function check(label: string, ok: boolean) { ok ? passed++ : failed++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`); }

const strictPicker = () => React.createElement(React.StrictMode, null, React.createElement(LocationPicker, { currentCity: 'Chennai', onChanged: () => {} }));
const btn = (c: HTMLElement) => c.querySelector('button[aria-label="Use my current location"]') as HTMLButtonElement | null;
const text = (c: HTMLElement) => c.textContent ?? '';
const alert = (c: HTMLElement) => c.querySelector('[role="alert"]')?.textContent ?? null;
const status = (c: HTMLElement) => c.querySelector('[role="status"]')?.textContent ?? null;
const settingsBtn = (c: HTMLElement) => [...c.querySelectorAll('button')].find((b) => b.textContent === 'Open Settings') ?? null;
const success = (c: HTMLElement) => /Confirm Synthetic Town/.test(text(c));
// Spinner state is read from the GPS button's own label only (the timeout
// error message also contains the words "Finding your location").
const btnLabel = (c: HTMLElement) => btn(c)?.textContent ?? '';
const loadingText = (c: HTMLElement) => /Still finding your location/.test(btnLabel(c)) ? 'SLOW' : /Finding your location/.test(btnLabel(c)) ? 'LOADING' : 'IDLE';
const gpsTimers = () => timers.size;

function reset() {
  now = 0; timers.clear(); NL.__resetNativeLocationForTests();
  geo.check = 'granted'; geo.checkRejects = null; geo.requestResults = []; geo.delay = 2_000; geo.fail = null;
  geo.calls = { check: 0, request: 0, get: 0 }; geo.settlers = [];
  platform = 'android'; settingsCalls.open = 0; settingsOpenFails = false; reverseMode = 'ok'; reverseCalls.length = 0;
  consoleErrors.length = 0;
}
async function tap(c: HTMLElement) { await click(btn(c)!); await flush(); }
async function emitResume() { await act(async () => { resumeHandlers.forEach((f) => f()); }); await flush(); await flush(); }

async function run() {
  // ============================ A. Request concurrency ============================
  reset();
  {
    geo.delay = 5_000;
    const h = await mount(strictPicker());
    await tap(h.container);
    check('A1 one tap starts exactly one native request', geo.calls.get === 1);
    await act(async () => {   // two more taps dispatched before React can re-render
      btn(h.container)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      btn(h.container)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    check('A2 rapid repeated taps start no additional native requests', geo.calls.get === 1);
    check('A2b button disabled while the request is active', btn(h.container)!.disabled);
    await advanceTo(6_000);
    check('A2c the single request completes normally (one reverse lookup)', success(h.container) && reverseCalls.length === 1);
    await h.unmount();
  }
  reset();
  {
    geo.delay = null; // native never settles on its own
    const h = await mount(strictPicker());
    await tap(h.container);
    await advanceTo(30_000);
    check('A3 app timeout at 30 s shows the timeout message', alert(h.container) === M.timeout && loadingText(h.container) === 'IDLE');
    check('A3b timed-out native request is still tracked (not treated as cancelled)', NL.unsettledNativeLocationRequests() === 1 && NL.isNativeLocationInFlight());
    await tap(h.container); // retry at 30 s
    check('A4 retry is available and JOINS the running native request (no second native call)', geo.calls.get === 1 && loadingText(h.container) === 'LOADING');
    await act(async () => { geo.settlers[0].resolve(); }); await flush(); await flush();
    check('A4b when the joined native request settles, the retry shows the result', success(h.container));
    check('A4c the native request is no longer tracked once settled', NL.unsettledNativeLocationRequests() === 0);
    await h.unmount();
  }
  reset();
  {
    geo.delay = 35_000; // late native completion after the 30 s app timeout, no retry
    const h = await mount(strictPicker());
    await tap(h.container);
    await advanceTo(30_000);
    const atTimeout = alert(h.container);
    await advanceTo(40_000);
    check('A5 late native result after app timeout does not update the obsolete UI (stays on timeout, no lookup)', atTimeout === M.timeout && alert(h.container) === M.timeout && !success(h.container) && reverseCalls.length === 0);
    await h.unmount();
  }
  reset();
  {
    geo.delay = 8_000;
    const h1 = await mount(strictPicker());
    await tap(h1.container);
    await advanceTo(3_000);
    await h1.unmount();                      // close while in flight
    const h2 = await mount(strictPicker());  // reopen
    check('A6 reopened picker starts idle (no stale spinner/result)', loadingText(h2.container) === 'IDLE' && alert(h2.container) === null);
    await advanceTo(9_000);                  // old native result arrives
    check('A6b stale result from the closed picker never appears in the reopened one', !success(h2.container) && reverseCalls.length === 0);
    await tap(h2.container);
    check('A6c a fresh tap after the old request settled starts a new native request', geo.calls.get === 2);
    await advanceTo(20_000);
    check('A6d and completes normally', success(h2.container));
    await h2.unmount();
  }
  reset();
  {
    geo.delay = 20_000;
    const h1 = await mount(strictPicker());
    await tap(h1.container);
    await advanceTo(2_000);
    await h1.unmount();
    const h2 = await mount(strictPicker());
    await tap(h2.container);
    check('A7 reopen + tap while the old native request is still running joins it (1 native call total)', geo.calls.get === 1);
    await advanceTo(21_000);
    check('A7b the reopened picker gets the joined result', success(h2.container));
    await h2.unmount();
  }
  reset();
  {
    geo.delay = null;
    const h = await mount(strictPicker());
    await tap(h.container);
    await advanceTo(30_000);
    await advanceTo(61_000);
    await tap(h.container);
    check('A8 bounded: a native request still unsettled after 60 s no longer blocks a new one (2 calls, 2 unsettled)', geo.calls.get === 2 && NL.unsettledNativeLocationRequests() === 2);
    await h.unmount();
  }

  // ============================ B. Timeout behaviour ============================
  async function delayCase(label: string, delay: number | null, fail: string | null = null) {
    reset(); geo.delay = delay; geo.fail = fail;
    const h = await mount(strictPicker());
    await tap(h.container);
    await advanceTo(9_999); const s9 = loadingText(h.container) === 'IDLE' ? (success(h.container) ? 'SUCCESS' : 'ERR') : loadingText(h.container);
    await advanceTo(10_000); const s10 = loadingText(h.container) === 'IDLE' ? (success(h.container) ? 'SUCCESS' : 'ERR') : loadingText(h.container);
    await advanceTo(29_999); const s29 = loadingText(h.container) === 'IDLE' ? (success(h.container) ? 'SUCCESS' : 'ERR') : loadingText(h.container);
    await advanceTo(30_000);
    const end = success(h.container) ? 'SUCCESS' : alert(h.container);
    const timersLeft = gpsTimers() - (delay !== null && delay > 30_000 ? 1 : 0); // a still-scheduled synthetic native settle is not an app timer
    await h.unmount();
    return { label, s9, s10, s29, end, timersLeft };
  }
  const d2 = await delayCase('2 s', 2_000);
  check('B1 success at 2 s', d2.s9 === 'SUCCESS' && d2.end === 'SUCCESS');
  check('B1b all app timers cleared after success', d2.timersLeft === 0);
  const d8 = await delayCase('8 s', 8_000);
  check('B2 success at 8 s', d8.s9 === 'SUCCESS');
  const d15 = await delayCase('15 s', 15_000);
  check('B3 progress message "Still finding your location..." from 10 s', d15.s9 === 'LOADING' && d15.s10 === 'SLOW');
  check('B4 success at 15 s (no longer discarded at 10 s)', d15.end === 'SUCCESS');
  const d25 = await delayCase('25 s', 25_000);
  check('B5 success at 25 s', d25.s29 === 'SUCCESS' && d25.end === 'SUCCESS');
  const dNever = await delayCase('never', null);
  check('B6 never-settling request: still loading at 29.999 s, timeout message at 30 s', dNever.s29 === 'SLOW' && dNever.end === M.timeout);
  check('B6b app timers cleared after the timeout', dNever.timersLeft === 0);
  const dFail = await delayCase('provider failure at 30 s', 29_000, 'location unavailable');
  check('B7 provider "location unavailable" maps to the unavailable message and clears timers', dFail.end === M.unavailable && dFail.timersLeft === 0);
  const d35 = await delayCase('late 35 s', 35_000);
  check('B8 native completion after the app timeout: timeout shown, late result ignored', d35.end === M.timeout);
  check('B9 configured constants: native 30 s, progress 10 s, web 10 s', NL.NATIVE_LOCATION_TIMEOUT_MS === 30_000 && NL.NATIVE_LOCATION_PROGRESS_MS === 10_000 && NL.WEB_LOCATION_TIMEOUT_MS === 10_000);
  // same-tick boundary: native settles exactly at 30 s -> exactly one outcome
  reset();
  {
    geo.delay = 30_000;
    const h = await mount(strictPicker());
    await tap(h.container);
    await advanceTo(31_000);
    const outcome = success(h.container) ? 'SUCCESS' : alert(h.container);
    check('B10 boundary at exactly 30 s yields exactly one outcome (no duplicate completion)', (outcome === 'SUCCESS' && reverseCalls.length === 1) || (outcome === M.timeout && reverseCalls.length === 0));
    await h.unmount();
  }

  // ============================ C. Permission recovery ============================
  reset();
  {
    geo.check = 'prompt'; geo.requestResults = ['prompt-with-rationale'];
    const h = await mount(strictPicker());
    await tap(h.container);
    check('C1 initial denial: ordinary denied message, no Open Settings, no location request', alert(h.container) === M.permission_denied && !settingsBtn(h.container) && geo.calls.get === 0);
    geo.check = 'prompt-with-rationale'; geo.requestResults = ['denied'];
    await tap(h.container);
    check('C2 repeated denial (don\'t ask again): permanent message + Open Settings', alert(h.container) === M.permission_permanently_denied && !!settingsBtn(h.container));
    geo.check = 'denied'; geo.requestResults = ['denied']; const req0 = geo.calls.request;
    await tap(h.container);
    // Review F-1: the app always asks Android (which answers instantly, with
    // no dialog, when the denial is truly permanent) instead of trusting
    // Capacitor's cached 'denied'; the outcome is still the Settings path.
    check('C3 permanently denied: one request to Android (no dialog on a real device), permanent message kept', geo.calls.request === req0 + 1 && alert(h.container) === M.permission_permanently_denied && geo.calls.get === 0);
    const req1 = geo.calls.request;
    await click(settingsBtn(h.container)!); await flush();
    check('C4 Open Settings calls the native AppSettings.open once and changes no permission', settingsCalls.open === 1 && geo.calls.request === req1);
    check('C5 search and manual-location fallbacks remain available', !!h.container.querySelector('#location-picker-search') && /Advanced options/.test(text(h.container)));
    const checks0 = geo.calls.check;
    await emitResume();
    check('C6 return from Settings WITHOUT granting: permission re-checked, message kept', geo.calls.check === checks0 + 1 && alert(h.container) === M.permission_permanently_denied);
    geo.check = 'granted';
    await emitResume();
    check('C7 return from Settings WITH permission granted: stale error cleared, notice shown', alert(h.container) === null && !settingsBtn(h.container) && /Location access is on/.test(status(h.container) ?? ''));
    check('C7b resume never starts a location request by itself', geo.calls.get === 0);
    await tap(h.container); await advanceTo(5_000);
    check('C7c next tap acquires normally', success(h.container));
    await h.unmount();
  }
  reset();
  {
    geo.checkRejects = 'Location services are not enabled';
    const h = await mount(strictPicker());
    await tap(h.container);
    check('C8 device location services off: services message', alert(h.container) === M.services_disabled);
    geo.checkRejects = null; geo.check = 'prompt';
    await emitResume();
    check('C9 services turned back on while away: stale services error cleared on resume', alert(h.container) === null);
    await h.unmount();
  }
  reset();
  {
    platform = 'ios'; geo.check = 'denied'; geo.requestResults = ['denied'];
    const h = await mount(strictPicker());
    await tap(h.container);
    // IOS-02: iOS shows its own permanent-denial wording (names the Settings app, implies no button).
    check('C10 non-Android native: permanent message but no Open Settings button (not supported there)', alert(h.container) === LE.locationErrorMessage('permission_permanently_denied', 'ios') && alert(h.container) !== M.permission_permanently_denied && !settingsBtn(h.container));
    await h.unmount();
  }
  reset();
  {
    geo.check = 'denied'; geo.requestResults = ['denied']; settingsOpenFails = true;
    const h = await mount(strictPicker());
    await tap(h.container);
    await click(settingsBtn(h.container)!); await flush(); await flush();
    check('C11 if Settings cannot be opened, a manual Settings path is shown', /Apps > AuraSchedule > Permissions > Location/.test(status(h.container) ?? ''));
    await h.unmount();
  }

  reset();
  {
    // Review F-1 regression: Capacitor's cache says 'denied' (e.g. the first
    // dialog was dismissed with back, or the permission was reset in
    // Settings) but Android would still grant -- the user must not be stuck.
    geo.check = 'denied'; geo.requestResults = ['granted'];
    const h = await mount(strictPicker());
    await tap(h.container); await advanceTo(3_000);
    check('C12 stale cached "denied" does not block: the app asks Android, gets a grant, and acquires', geo.calls.request === 1 && geo.calls.get === 1 && success(h.container) && !settingsBtn(h.container));
    await h.unmount();
  }

  // ============================ D. Error messages ============================
  const kinds: Array<[unknown, string]> = [
    [new Error('location unavailable'), 'unavailable'],
    [new Error('location disabled'), 'services_disabled'],
    [new Error('Location services are not enabled'), 'services_disabled'],
    [new Error('Location permission was denied'), 'permission_denied'],
    [new Error('Google Play Services not available'), 'unavailable'],
    [new LE.LocationTimeoutError(), 'timeout'],
    [new Error('java.lang.SecurityException: internal detail'), 'unexpected'],
    [undefined, 'unexpected'],
  ];
  check('D1 native error classification table', kinds.every(([e, k]) => LE.classifyNativeLocationError(e) === k));
  check('D2 every message is concise and offers a next step (no raw plugin text, no digits)', Object.values(M).every((m: any) => m.length < 140 && /manually|Settings|search/i.test(m) && !/\d/.test(m)));
  reset();
  {
    geo.delay = 1_000; geo.fail = 'java.lang.SecurityException: internal detail';
    const h = await mount(strictPicker());
    await tap(h.container); await advanceTo(2_000);
    check('D3 unexpected native failure shows the safe generic message (internal text never shown)', alert(h.container) === M.unexpected && !/SecurityException/.test(text(h.container)));
    await h.unmount();
  }
  for (const [mode, expect, label] of [['503', M.geocode_unavailable, 'D4 reverse geocode 503 -> city lookup unavailable (distinct from acquisition)'], ['throw', M.geocode_unavailable, 'D5 reverse geocode network failure -> city lookup unavailable'], ['404', "Couldn't identify a place at this location. Try searching instead.", 'D6 reverse geocode 404 keeps the server\'s specific message']] as const) {
    reset(); reverseMode = mode as any;
    const h = await mount(strictPicker());
    await tap(h.container); await advanceTo(3_000);
    check(label, alert(h.container) === expect && loadingText(h.container) === 'IDLE');
    await h.unmount();
  }
  // web path
  reset();
  {
    platform = 'web';
    let lastOptions: any = null; let errCb: any = null;
    (navigator as any).geolocation = { getCurrentPosition: (_ok: any, err: any, opts: any) => { lastOptions = opts; errCb = err; } };
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    const h = await mount(strictPicker());
    await tap(h.container);
    check('D7 web timeout unchanged at 10 000 ms with maximumAge 0', lastOptions?.timeout === 10_000 && lastOptions?.maximumAge === 0);
    await act(async () => { errCb({ code: 3, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }); }); await flush();
    check('D8 web TIMEOUT uses the shared timeout message', alert(h.container) === M.timeout);
    await tap(h.container);
    await act(async () => { errCb({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }); }); await flush();
    check('D9 web PERMISSION_DENIED uses the shared denied message, never Open Settings', alert(h.container) === M.permission_denied && !settingsBtn(h.container));
    await tap(h.container);
    await act(async () => { errCb({ code: 2, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }); }); await flush();
    check('D10 web POSITION_UNAVAILABLE uses the shared unavailable message', alert(h.container) === M.unavailable);
    await h.unmount();
  }

  // ============================ E. Lifecycle ============================
  reset();
  {
    geo.delay = 15_000;
    const h = await mount(strictPicker());
    await tap(h.container);
    await advanceTo(12_000);
    check('E1 Strict Mode setup/cleanup/setup: request runs and progresses normally', loadingText(h.container) === 'SLOW');
    await h.unmount(); // genuine unmount == Android back closing the picker/modal mid-request
    check('E2 genuine unmount (incl. Android back closing the picker) clears all app timers', gpsTimers() === 1 /* only the synthetic native settle remains */);
    await advanceTo(40_000);
    check('E3 no warnings, no lookup, after unmount during an active request', consoleErrors.length === 0 && reverseCalls.length === 0);
    check('E3b resume listener removed on unmount', resumeHandlers.size === 0);
  }
  reset();
  {
    geo.delay = 8_000;
    const h = await mount(strictPicker());
    await tap(h.container);
    await advanceTo(3_000);
    const checks0 = geo.calls.check;
    await emitResume(); // app backgrounded and resumed mid-request
    check('E4 background/resume during an active request does not disturb it (no re-check, no new request)', geo.calls.check === checks0 && geo.calls.get === 1 && loadingText(h.container) === 'LOADING');
    await advanceTo(9_000);
    check('E4b request completes once after resume (no duplicate completion)', success(h.container) && reverseCalls.length === 1);
    await h.unmount();
  }
  check('E5 no React warnings/errors across the whole suite', consoleErrors.length === 0);

  // ============================ F. lib unit checks ============================
  reset();
  {
    let resolveIt: (v: number) => void = () => {};
    const w = NL.waitWithTimeout(new Promise<number>((r) => { resolveIt = r; }), 5_000);
    check('F1 waitWithTimeout arms exactly one timer', gpsTimers() === 1);
    resolveIt(7); const v = await w.promise;
    check('F2 waitWithTimeout clears its timer when the promise settles', v === 7 && gpsTimers() === 0);
    const w2 = NL.waitWithTimeout(new Promise(() => {}), 5_000); w2.cancel();
    check('F3 cancel() clears the timer', gpsTimers() === 0);
  }

  console.error = origError;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
run().catch((e) => { console.error = origError; console.error(e); process.exit(1); });
