/**
 * AURA-MOBILE-01-M2-C-F2 -- synthetic DIAGNOSTIC suite characterising the
 * native geolocation timeout in apps/web/components/LocationPicker.tsx
 * (10 000 ms Promise.race against Geolocation.getCurrentPosition).
 * It RECORDS behaviour; it does not change it. SYNTHETIC ONLY: Capacitor is
 * mocked, positions are (0, 0), time is a fake clock. No device, no GPS.
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/locationPickerNativeTimeoutDiagnostics.test.ts
 *
 * Checks marked "OBSERVED" assert the CURRENT behaviour so that a future
 * timeout change shows up here as an intentional, reviewed diff.
 *
 * UPDATED in AURA-MOBILE-01-M2-D (intentional, reviewed diff): the native
 * policy is now a 30 s app-level timeout with a 10 s progress message,
 * single-flight requests (retries join the running native request) and
 * timers cleared on settle. The F2 baseline expectations (10 s race, 15/30 s
 * fixes discarded, overlapping retries, timers never cleared) are recorded
 * in AURA_MOBILE_01_M2_C_F2_TIMEOUT_ANALYSIS.md.
 */
import * as path from 'path';
import { React, mount, click, flush, act } from './jsdomReactHarness';

// ---------- fake clock for window.setTimeout (the picker's timer) and the native mock ----------
let now = 0;
let seq = 0;
const timers = new Map<number, { at: number; fn: () => void; seq: number }>();
let clearedCount = 0;
(window as any).setTimeout = (fn: () => void, ms = 0) => { const id = ++seq; timers.set(id, { at: now + ms, fn, seq: id }); return id; };
(window as any).clearTimeout = (id: number) => { if (timers.delete(id)) clearedCount++; };
async function advanceTo(t: number) {
  for (;;) {
    const due = [...timers.entries()].filter(([, v]) => v.at <= t).sort((a, b) => a[1].at - b[1].at || a[1].seq - b[1].seq)[0];
    if (!due) break;
    timers.delete(due[0]); now = due[1].at;
    await act(async () => { due[1].fn(); });
    await flush();
  }
  now = t; await flush();
}

// ---------- Capacitor mocks ----------
interface NativeCall { startedAt: number; settledAt: number | null; outcome: 'resolved' | 'rejected' | 'pending' }
const native: NativeCall[] = [];
let nativeDelay: number | null = null;          // null = never settles
let nativeFails = false;                       // provider returns "location unavailable" instead of a fix
const Geolocation = {
  checkPermissions: async () => ({ location: 'granted', coarseLocation: 'granted' }),
  requestPermissions: async () => ({ location: 'granted', coarseLocation: 'granted' }),
  getCurrentPosition: () => {
    const rec: NativeCall = { startedAt: now, settledAt: null, outcome: 'pending' };
    native.push(rec);
    return new Promise((resolve, reject) => {
      if (nativeDelay === null) return;
      (window as any).setTimeout(() => {
        rec.settledAt = now;
        if (nativeFails) { rec.outcome = 'rejected'; reject(new Error('location unavailable')); }
        else { rec.outcome = 'resolved'; resolve({ coords: { latitude: 0, longitude: 0, accuracy: 2000 } }); }
      }, nativeDelay);
    });
  },
};
const pickerDir = path.join(__dirname, '..', 'apps', 'web', 'components');
function installMock(id: string, exports: unknown) {
  const resolved = require.resolve(id, { paths: [pickerDir] });
  const Module = require('module'); const m = new Module(resolved);
  m.filename = resolved; m.loaded = true; m.exports = exports; require.cache[resolved] = m;
}
installMock('@capacitor/core', { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' }, registerPlugin: () => ({ open: async () => {} }) });
installMock('@capacitor/geolocation', { Geolocation });
installMock('@capacitor/app', { App: { addListener: () => Promise.resolve({ remove: () => {} }) } });

// reverse-geocode mock: answers immediately with a synthetic place; other routes stay pending
const reverseCalls: number[] = [];
(global as any).fetch = (url: string) => {
  if (!String(url).startsWith('/api/location/reverse')) return new Promise(() => {});
  reverseCalls.push(now);
  return Promise.resolve({ ok: true, json: async () => ({ result: { displayName: 'Synthetic Town', cityName: 'Synthetic Town', latitude: 0, longitude: 0, timezone: 'UTC' } }) });
};

const unhandled: string[] = [];
process.on('unhandledRejection', (r) => { unhandled.push(String((r as any)?.message ?? r)); });

const { LocationPicker } = require('../apps/web/components/LocationPicker');
const consoleErrors: string[] = [];
const origError = console.error;
console.error = (...a: unknown[]) => { consoleErrors.push(a.map(String).join(' ')); };

let passed = 0, failed = 0;
const rows: string[] = [];
function check(label: string, ok: boolean) { ok ? passed++ : failed++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`); }
const { LOCATION_ERROR_MESSAGES: MSG } = require('../apps/web/lib/locationErrors');
const NL = require('../apps/web/lib/nativeLocationRequest');
const UNAVAILABLE = MSG.unavailable;
const TIMEOUT = MSG.timeout;
const btn = (c: HTMLElement) => c.querySelector('button[aria-label="Use my current location"]') as HTMLButtonElement | null;
const uiState = (c: HTMLElement) => /Confirm Synthetic Town/.test(c.textContent ?? '') ? 'SUCCESS (pending result shown)'
  : /Still finding your location/.test(btn(c)?.textContent ?? '') ? 'LOADING (still finding)'
  : /Finding your location/.test(btn(c)?.textContent ?? '') ? 'LOADING'
  : c.querySelector('[role="alert"]')?.textContent === UNAVAILABLE ? 'ERROR (unavailable message)'
  : c.querySelector('[role="alert"]')?.textContent === TIMEOUT ? 'ERROR (timeout message)' : 'IDLE';

function reset(delay: number | null, fails = false) {
  NL.__resetNativeLocationForTests();
  now = 0; timers.clear(); native.length = 0; reverseCalls.length = 0; nativeDelay = delay; nativeFails = fails;
  clearedCount = 0; unhandled.length = 0; consoleErrors.length = 0;
}

async function scenario(label: string, delay: number | null, fails = false) {
  reset(delay, fails);
  const h = await mount(React.createElement(React.StrictMode, null, React.createElement(LocationPicker, { currentCity: 'Chennai', onChanged: () => {} })));
  await click(btn(h.container)!); await flush();
  await advanceTo(9_999); const at9999 = uiState(h.container);
  await advanceTo(10_000); const at10000 = uiState(h.container);
  await advanceTo(31_000); const at31000 = uiState(h.container);
  await advanceTo(60_000);
  const n = native[0];
  const res = {
    label, delay, at9999, at10000, at31000,
    nativeOutcome: n.outcome, nativeSettledAt: n.settledAt,
    reverseCalls: reverseCalls.length, pendingAppTimers: [...timers.values()].length, cleared: clearedCount,
    unhandled: unhandled.length, warnings: consoleErrors.length,
  };
  rows.push(`| ${label} | ${at9999} | ${at10000} | ${at31000} | ${n.outcome}${n.settledAt !== null ? ' @' + n.settledAt + 'ms' : ''} | ${res.reverseCalls} | ${res.cleared} | ${res.unhandled} | ${res.warnings} |`);
  await h.unmount();
  return res;
}

async function run() {
  // ---- delay matrix (native SUCCESS after N ms) -- M2-D policy ----
  const r2 = await scenario('2 s success', 2_000);
  check('2 s: success before any timeout; reverse geocode called once', r2.at9999.startsWith('SUCCESS') && r2.reverseCalls === 1);
  const r8 = await scenario('8 s success', 8_000);
  check('8 s: success', r8.at9999.startsWith('SUCCESS') && r8.reverseCalls === 1);
  const r10 = await scenario('10 s success', 10_000);
  check('10 s: success (no longer a timeout boundary)', r10.at10000.startsWith('SUCCESS'));
  const r15 = await scenario('15 s success', 15_000);
  check('15 s (M2-D): progress message at 10 s, then the fix is USED (was discarded in F2)', r15.at10000.startsWith('LOADING (still finding)') && r15.at31000.startsWith('SUCCESS') && r15.reverseCalls === 1);
  const r30 = await scenario('30 s success (boundary)', 30_000);
  check('30 s boundary: exactly one outcome (here the fix, scheduled first in the fake clock)', r30.at31000.startsWith('SUCCESS') && r30.reverseCalls === 1);
  const r30f = await scenario('30 s "location unavailable" (device-observed F2)', 29_000, true);
  check('provider failure just before the app timeout shows the unavailable message; no unhandled rejection', r30f.at31000.startsWith('ERROR (unavailable') && r30f.nativeOutcome === 'rejected' && r30f.unhandled === 0);
  const rNever = await scenario('never resolves', null);
  check('never: timeout message at 30 s, native call left pending and still tracked', rNever.at31000.startsWith('ERROR (timeout') && rNever.nativeOutcome === 'pending');

  // ---- timers: M2-D clears the app timers when an operation settles ----
  check('M2-D: every scenario clears its app timers (clearTimeout called)', [r2, r8, r10, r15, r30, r30f].every((r) => r.cleared >= 1));
  check('no unhandled rejections in any scenario', [r2, r8, r10, r15, r30, r30f, rNever].every((r) => r.unhandled === 0));

  // ---- overlap: retries now JOIN the running native request ----
  {
    reset(45_000, true);
    const h = await mount(React.createElement(LocationPicker, { currentCity: 'Chennai', onChanged: () => {} }));
    await click(btn(h.container)!); await flush();
    await advanceTo(30_000);
    const reEnabled = btn(h.container) !== null && !btn(h.container)!.disabled;
    await click(btn(h.container)!); await flush();     // user retries at t=30 s
    const inFlight = native.filter((c) => c.outcome === 'pending').length;
    check('button re-enabled after the 30 s app timeout', reEnabled);
    check(`M2-D: a retry joins the running request -- ${native.length} native call(s), ${inFlight} in flight (was 3 overlapping in F2)`, native.length === 1 && inFlight === 1);
    await advanceTo(80_000);
    check('the joined request settles once and the retry shows its outcome', native.every((c) => c.outcome !== 'pending') && uiState(h.container).startsWith('ERROR (unavailable'));
    check('no warnings or unhandled rejections', consoleErrors.length === 0 && unhandled.length === 0);
    await h.unmount();
  }

  // ---- unmount during pending native call ----
  {
    reset(15_000);
    const h = await mount(React.createElement(React.StrictMode, null, React.createElement(LocationPicker, { currentCity: 'Chennai', onChanged: () => {} })));
    await click(btn(h.container)!); await flush();
    await advanceTo(5_000); await h.unmount();
    await advanceTo(40_000);
    check('unmount at 5 s: later timeout (10 s) and late fix (15 s) cause no warnings, no reverse call, no unhandled rejections', consoleErrors.length === 0 && reverseCalls.length === 0 && unhandled.length === 0);
  }

  console.error = origError;
  console.log('\n| Scenario | UI @9.999 s | UI @10.000 s | UI @31 s | Native call | Reverse calls | clearTimeout | Unhandled | Warnings |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  rows.forEach((r) => console.log(r));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
run().catch((e) => { console.error = origError; console.error(e); process.exit(1); });
