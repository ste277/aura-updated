/**
 * AURA-MOBILE-01-M2-C-F1 -- real mounted-component regression tests for
 * LocationPicker's mounted-state guard under React Strict Mode.
 *
 *   npx ts-node --project tsconfig.jsdom-tests.json test/locationPickerStrictModeLifecycle.test.ts
 *
 * Root cause (found on a physical Android device in M2-C): Strict Mode
 * runs effect setup -> cleanup -> setup on mount in development. The
 * isMountedRef effect only had a cleanup (ref = false) and never restored
 * the ref on the second setup, so every native GPS result, error, denial
 * and timeout was silently dropped and the spinner never cleared.
 *
 * Capacitor (@capacitor/core, @capacitor/geolocation) is replaced by an
 * in-memory mock via require.cache BEFORE LocationPicker is loaded; every
 * position used here is synthetic (0, 0). No device, network or real GPS.
 */
import * as path from 'path';
import { React, mount, click, flush, act } from './jsdomReactHarness';

// ---------- Capacitor mocks (installed before LocationPicker is required) ----------
type Perm = { location: string; coarseLocation: string };
const geo = {
  checkPermissionsResult: { location: 'granted', coarseLocation: 'granted' } as Perm,
  requestPermissionsResult: { location: 'granted', coarseLocation: 'granted' } as Perm,
  /** Each getCurrentPosition call pushes a deferred the test controls. */
  pending: [] as Array<{ resolve: (v: any) => void; reject: (e: any) => void }>,
  calls: { check: 0, request: 0, get: 0 },
};
const Geolocation = {
  checkPermissions: async () => { geo.calls.check++; return geo.checkPermissionsResult; },
  requestPermissions: async () => { geo.calls.request++; return geo.requestPermissionsResult; },
  getCurrentPosition: () => {
    geo.calls.get++;
    return new Promise((resolve, reject) => geo.pending.push({ resolve, reject }));
  },
};
const Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
const pickerDir = path.join(__dirname, '..', 'apps', 'web', 'components');
function installMock(id: string, exports: unknown) {
  const resolved = require.resolve(id, { paths: [pickerDir] });
  const Module = require('module');
  const m = new Module(resolved);
  m.filename = resolved; m.loaded = true; m.exports = exports;
  require.cache[resolved] = m;
}
// M2-D: LocationPicker now also imports registerPlugin (lib/appSettings.ts)
// and @capacitor/app (resume re-check); both are inert mocks here.
installMock('@capacitor/core', { Capacitor, registerPlugin: () => ({ open: async () => {} }) });
installMock('@capacitor/geolocation', { Geolocation });
installMock('@capacitor/app', { App: { addListener: () => Promise.resolve({ remove: () => {} }) } });

// ---------- fetch mock (reverse-geocode), synthetic only ----------
const fetchCalls: string[] = [];
let fetchImpl: (url: string) => Promise<any> = () => new Promise(() => {});
// Only the reverse-geocode route is controlled by the test; every other
// request the picker makes on mount (e.g. /api/cities/custom) stays pending.
(global as any).fetch = (url: string) => {
  const u = String(url);
  if (!u.startsWith('/api/location/reverse')) return new Promise(() => {});
  fetchCalls.push(u);
  return fetchImpl(u);
};

// ---------- timer control: the picker's native app-level timeout fires on demand ----------
// M2-D: the native timeout is NATIVE_LOCATION_TIMEOUT_MS (30 s) and a
// progress timer runs at 10 s; both are captured (never real timers).
const NATIVE_TIMEOUT_MS = 30_000;
const realSetTimeout = window.setTimeout.bind(window);
const tenSecondTimers: Array<() => void> = [];
(window as any).setTimeout = (fn: () => void, ms?: number, ...rest: any[]) => {
  if (ms === NATIVE_TIMEOUT_MS) { tenSecondTimers.push(fn); return 0; }
  if (ms === 10_000) return 0; // progress message timer: not under test here
  return realSetTimeout(fn, ms, ...rest);
};
(window as any).clearTimeout = () => {};
async function fireTimeouts() { await act(async () => { tenSecondTimers.splice(0).forEach((f) => f()); }); await flush(); }

// ---------- console.error capture (React warnings / act warnings) ----------
const { LocationPicker } = require('../apps/web/components/LocationPicker');

const consoleErrors: string[] = [];
const origError = console.error;
console.error = (...args: unknown[]) => { consoleErrors.push(args.map(String).join(' ')); };

let passed = 0, failed = 0;
function check(label: string, ok: boolean) { ok ? passed++ : failed++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`); }

const props = { currentCity: 'Chennai', onChanged: () => {} };
const strict = (el: unknown) => React.createElement(React.StrictMode, null, el);
const picker = () => React.createElement(LocationPicker, props);
function gpsButton(c: HTMLElement) { return c.querySelector('button[aria-label="Use my current location"]') as HTMLButtonElement | null; }
function alertText(c: HTMLElement) { return c.querySelector('[role="alert"]')?.textContent ?? null; }
// Spinner = the GPS button's own label (M2-D's timeout message also contains
// "Finding your location"); when a result is pending the button is hidden.
function loading(c: HTMLElement) { return /finding your location/i.test(gpsButton(c)?.textContent ?? ''); }
function reset() {
  // M2-D: native requests are single-flight at module scope; clear between scenarios.
  require('../apps/web/lib/nativeLocationRequest').__resetNativeLocationForTests();
  geo.pending.length = 0; geo.calls = { check: 0, request: 0, get: 0 };
  geo.checkPermissionsResult = { location: 'granted', coarseLocation: 'granted' };
  geo.requestPermissionsResult = { location: 'granted', coarseLocation: 'granted' };
  fetchCalls.length = 0; fetchImpl = () => new Promise(() => {}); tenSecondTimers.length = 0;
}

// M2-D: messages come from the shared table.
const { LOCATION_ERROR_MESSAGES: MSG } = require('../apps/web/lib/locationErrors');
const DENIED = MSG.permission_denied;
const UNAVAILABLE = MSG.unavailable;
const TIMEOUT = MSG.timeout;

async function run() {
  // A. Strict Mode: setup -> cleanup -> setup restores mounted state (native error clears spinner)
  {
    reset();
    const h = await mount(strict(picker()));
    await click(gpsButton(h.container)!); await flush();
    check('A1 Strict Mode: request starts (spinner shown, native getCurrentPosition called)', loading(h.container) && geo.calls.get === 1);
    await act(async () => { geo.pending[0].reject(new Error('location unavailable')); }); await flush();
    check('A2 Strict Mode: native error clears the loading indicator', !loading(h.container));
    check('A3 Strict Mode: native error shows the unavailable message', alertText(h.container) === UNAVAILABLE);
    await h.unmount();
  }

  // B. Strict Mode: permission denial
  {
    reset();
    geo.checkPermissionsResult = { location: 'prompt', coarseLocation: 'prompt' };
    // M2-D: an ordinary (re-askable) denial; 'denied' now means don't-ask-again.
    geo.requestPermissionsResult = { location: 'prompt', coarseLocation: 'prompt-with-rationale' };
    const h = await mount(strict(picker()));
    await click(gpsButton(h.container)!); await flush(); await flush();
    check('B1 Strict Mode: denial requests coarse permission and never calls getCurrentPosition', geo.calls.request === 1 && geo.calls.get === 0);
    check('B2 Strict Mode: denial shows the expected message', alertText(h.container) === DENIED);
    check('B3 Strict Mode: denial clears the loading indicator', !loading(h.container));
    await h.unmount();
  }

  // C. Strict Mode: timeout (native call never settles)
  {
    reset();
    const h = await mount(strict(picker()));
    await click(gpsButton(h.container)!); await flush();
    check('C1 app-level timeout armed at NATIVE_LOCATION_TIMEOUT_MS (30 000 ms since M2-D)', tenSecondTimers.length === 1);
    await fireTimeouts();
    check('C2 Strict Mode: timeout shows an error', alertText(h.container) === TIMEOUT);
    check('C3 Strict Mode: timeout clears the spinner', !loading(h.container));
    await h.unmount();
  }

  // D. Strict Mode: success -> reverse geocode -> pending result rendered
  {
    reset();
    fetchImpl = async () => ({ ok: true, json: async () => ({ result: { displayName: 'Synthetic Town, Testland', cityName: 'Synthetic Town', country: 'Testland', latitude: 0, longitude: 0, timezone: 'UTC' } }) });
    const h = await mount(strict(picker()));
    await click(gpsButton(h.container)!); await flush();
    await act(async () => { geo.pending[0].resolve({ coords: { latitude: 0, longitude: 0, accuracy: 1000 } }); }); await flush(); await flush();
    check('D1 Strict Mode: success calls the reverse-geocode route', fetchCalls.length === 1 && fetchCalls[0] === '/api/location/reverse' /* IOS-02: POST body, no ?lat=&lng= */);
    check('D2 Strict Mode: success renders the pending result', /Confirm Synthetic Town/.test(h.container.textContent ?? ''));
    check('D3 Strict Mode: success clears the spinner', !loading(h.container));
    await h.unmount();
  }

  // E. Genuine unmount during an active request: no state updates, no React warnings
  {
    reset();
    consoleErrors.length = 0;
    let wrapperSet: (v: boolean) => void = () => {};
    function Wrapper() {
      const [open, setOpen] = React.useState(true);
      wrapperSet = setOpen;
      return open ? picker() : React.createElement('p', null, 'closed');
    }
    const h = await mount(strict(React.createElement(Wrapper)));
    await click(gpsButton(h.container)!); await flush();
    await act(async () => { wrapperSet(false); });
    check('E1 picker closed while the native request is still in flight', h.container.textContent === 'closed' && geo.pending.length === 1);
    await act(async () => { geo.pending[0].reject(new Error('late native error')); }); await flush();
    await fireTimeouts();
    check('E2 late error/timeout after a genuine unmount renders nothing', h.container.textContent === 'closed');
    check('E3 no React warnings or errors after close-during-request', consoleErrors.length === 0);

    // F. Reopen works correctly after the genuine unmount
    await act(async () => { wrapperSet(true); });
    check('F1 reopened picker starts idle (no stale spinner or error)', !loading(h.container) && alertText(h.container) === null);
    await click(gpsButton(h.container)!); await flush();
    await act(async () => { geo.pending[1].reject(new Error('location unavailable')); }); await flush();
    check('F2 reopened picker handles a new request (error shown, spinner cleared)', alertText(h.container) === UNAVAILABLE && !loading(h.container));
    await h.unmount();
  }

  // G. Late success after a genuine unmount: guard still blocks the state update
  {
    reset();
    consoleErrors.length = 0;
    let resolveFetch: (v: any) => void = () => {};
    fetchImpl = () => new Promise((r) => { resolveFetch = r; });
    const h = await mount(strict(picker()));
    await click(gpsButton(h.container)!); await flush();
    await act(async () => { geo.pending[0].resolve({ coords: { latitude: 0, longitude: 0, accuracy: 1000 } }); }); await flush();
    await h.unmount();
    await act(async () => { resolveFetch({ ok: true, json: async () => ({ result: { displayName: 'X', cityName: 'X', latitude: 0, longitude: 0, timezone: 'UTC' } }) }); }); await flush();
    check('G1 reverse-geocode resolving after unmount causes no warnings or errors', consoleErrors.length === 0);
  }

  // H. Non-Strict mount (production-like) still works
  {
    reset();
    const h = await mount(picker());
    await click(gpsButton(h.container)!); await flush();
    await act(async () => { geo.pending[0].reject(new Error('location unavailable')); }); await flush();
    check('H1 non-Strict mount: native error clears spinner and shows message', !loading(h.container) && alertText(h.container) === UNAVAILABLE);
    await h.unmount();
  }

  console.error = origError;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
run().catch((e) => { console.error = origError; console.error(e); process.exit(1); });
