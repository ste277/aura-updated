/**
 * AURA-ANDROID-REL-03 F1 -- a pending "Use my current location" request
 * must never overwrite a location the user chose another way while it was
 * still running.
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/locationPickerRel03Supersede.test.ts
 *
 * Defect (reproduced on the M2-D tree): with the 30 s native wait, the
 * "Still finding your location..." state invites the user to search or pick a
 * city instead. The GPS operation stayed current, so when the native fix and
 * reverse geocode arrived later they replaced the user's selected search
 * result in the confirmation card (or opened a GPS card after a city had
 * already been saved from the dropdown).
 *
 * Fix: choosing a search result, a dropdown city, or submitting the manual
 * form supersedes the running GPS operation (UI only -- the native request
 * cannot be cancelled and stays tracked by lib/nativeLocationRequest.ts).
 *
 * SYNTHETIC ONLY: Capacitor is mocked, every position is (0, 0), time is a
 * fake clock. No device, adb, emulator, network or GPS.
 */
import * as path from 'path';
import { React, mount, click, flush, act, typeInto } from './jsdomReactHarness';

// ---------- fake clock (window timers, Date.now) ----------
let now = 0;
let seq = 0;
const timers = new Map<number, { at: number; fn: () => void }>();
const fakeSetTimeout = (fn: () => void, ms = 0) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; };
const fakeClearTimeout = (id: number) => { timers.delete(id); };
(window as any).setTimeout = fakeSetTimeout;
(window as any).clearTimeout = fakeClearTimeout;
// The search debounce uses the global (Node) setTimeout and the harness's
// flush() relies on it too, so only window.* is faked; the 400 ms debounce
// runs in real time.
const realSetTimeout = global.setTimeout;
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
const geo = { delay: 20_000, calls: { get: 0 } };
const Geolocation = {
  checkPermissions: async () => ({ location: 'granted', coarseLocation: 'granted' }),
  requestPermissions: async () => ({ location: 'granted', coarseLocation: 'granted' }),
  getCurrentPosition: () => {
    geo.calls.get++;
    return new Promise((resolve) => {
      fakeSetTimeout(() => resolve({ coords: { latitude: 0, longitude: 0, accuracy: 2000 } }), geo.delay);
    });
  },
};
let platform = 'android';
const Capacitor = { isNativePlatform: () => platform !== 'web', getPlatform: () => platform };
const App = { addListener: () => Promise.resolve({ remove: () => {} }) };
const pickerDir = path.join(__dirname, '..', 'apps', 'web', 'components');
function installMock(id: string, exports: unknown) {
  const resolved = require.resolve(id, { paths: [pickerDir] });
  const Module = require('module'); const m = new Module(resolved);
  m.filename = resolved; m.loaded = true; m.exports = exports; require.cache[resolved] = m;
}
installMock('@capacitor/core', { Capacitor, registerPlugin: () => ({ open: async () => {} }) });
installMock('@capacitor/geolocation', { Geolocation });
installMock('@capacitor/app', { App });

// ---------- fetch mock ----------
const reverseCalls: number[] = [];
const patchBodies: string[] = [];
const place = (name: string) => ({ displayName: name, cityName: name, latitude: 0, longitude: 0, timezone: 'UTC' });
(global as any).fetch = (url: string, init?: { method?: string; body?: string }) => {
  const u = String(url);
  if (u.startsWith('/api/location/reverse')) {
    reverseCalls.push(now);
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ result: place('Gps Town') }) });
  }
  if (u.startsWith('/api/location/search')) {
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ results: [place('Search City')] }) });
  }
  if (u.startsWith('/api/users/location') && init?.method === 'PATCH') {
    patchBodies.push(String(init.body));
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ locationConfirmedAt: '2026-11-21T00:00:00.000Z' }) });
  }
  if (u.startsWith('/api/cities/custom')) return Promise.resolve({ ok: true, status: 200, json: async () => [] });
  return new Promise(() => {});
};

const { LocationPicker } = require('../apps/web/components/LocationPicker');
const NL = require('../apps/web/lib/nativeLocationRequest');

let passed = 0, failed = 0;
function check(label: string, ok: boolean) { ok ? passed++ : failed++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`); }

const changed: string[] = [];
const picker = () => React.createElement(React.StrictMode, null,
  React.createElement(LocationPicker, { currentCity: 'Chennai', onChanged: (c: { cityName: string }) => changed.push(c.cityName) }));
const btn = (c: HTMLElement) => c.querySelector('button[aria-label="Use my current location"]') as HTMLButtonElement | null;
const btnLabel = (c: HTMLElement) => btn(c)?.textContent ?? '';
const text = (c: HTMLElement) => c.textContent ?? '';
const buttonByText = (c: HTMLElement, re: RegExp) => [...c.querySelectorAll('button')].find((b) => re.test(b.textContent ?? '')) ?? null;

function reset() {
  now = 0; timers.clear(); NL.__resetNativeLocationForTests();
  geo.delay = 20_000; geo.calls.get = 0; platform = 'android';
  reverseCalls.length = 0; patchBodies.length = 0; changed.length = 0;
}

async function searchAndPick(c: HTMLElement) {
  const input = c.querySelector('#location-picker-search') as HTMLInputElement;
  await typeInto(input, 'Search');
  await act(async () => { await new Promise((r) => realSetTimeout(r, 450)); }); // real search debounce
  await flush(); await flush();
  const result = buttonByText(c, /^Search City/);
  if (!result) throw new Error('search result not rendered');
  await click(result); await flush();
}

async function run() {
  // S1 -- search result picked while native GPS is still running.
  reset();
  {
    const h = await mount(picker());
    const c = h.container;
    await click(btn(c)!); await flush(); await flush();
    await advanceTo(11_000);
    check('S1 precondition: GPS operation is running ("Still finding")', /Still finding your location/.test(btnLabel(c)));
    await searchAndPick(c);
    check('S1 confirmation card shows the picked search result', /Confirm Search City/.test(text(c)));
    await advanceTo(40_000); // native fix lands at 20 s; app timeout would be 30 s
    check('S1 late GPS fix does not replace the picked search result', /Confirm Search City/.test(text(c)) && !/Gps Town/.test(text(c)));
    check('S1 late GPS fix is not reverse-geocoded', reverseCalls.length === 0);
    check('S1 no timeout message appears for the superseded operation', !/took too long/.test(text(c)));
    check('S1 still exactly one native request (not cancelled, not duplicated)', geo.calls.get === 1);
    // The confirmation card replaces the picker; "Back" returns to it.
    await click(buttonByText(c, /^Back$/)!); await flush();
    check('S1 after Back, the GPS button is idle and enabled (no stuck spinner)', /Use my current location$/.test(btnLabel(c)) && !btn(c)!.disabled);
    check('S1 no timers left running for the superseded operation', timers.size === 0);
    await h.unmount();
  }

  // S2 -- city saved from the dropdown while native GPS is still running.
  reset();
  {
    const h = await mount(picker());
    const c = h.container;
    await click(btn(c)!); await flush(); await flush();
    await advanceTo(5_000);
    await click(buttonByText(c, /Advanced options/)!); await flush();
    const select = c.querySelector('select') as HTMLSelectElement;
    const option = [...select.options].find((o) => o.value && o.value !== 'Chennai' && !/other/i.test(o.value));
    if (!option) throw new Error('no curated city option');
    await act(async () => {
      select.value = option.value;
      select.dispatchEvent(new (window as any).Event('change', { bubbles: true }));
    });
    await flush(); await flush();
    check('S2 dropdown city was saved', changed.length === 1 && changed[0] === option.value && patchBodies.length === 1);
    await advanceTo(40_000);
    check('S2 late GPS fix does not open a GPS confirmation card', !/Gps Town/.test(text(c)) && reverseCalls.length === 0);
    check('S2 GPS button idle afterwards', /Use my current location$/.test(btnLabel(c)));
    await h.unmount();
  }

  // S3 -- control: with no other choice made, the GPS result still arrives.
  reset();
  {
    const h = await mount(picker());
    const c = h.container;
    await click(btn(c)!); await flush(); await flush();
    await advanceTo(25_000); await flush(); await flush();
    check('S3 control: an uninterrupted GPS operation still shows its result', /Confirm Gps Town/.test(text(c)) && reverseCalls.length === 1);
    await h.unmount();
  }

  // S4 -- after superseding, a fresh tap joins the still-running native request.
  reset();
  {
    const h = await mount(picker());
    const c = h.container;
    await click(btn(c)!); await flush(); await flush();
    await advanceTo(3_000);
    await searchAndPick(c);
    await click(buttonByText(c, /^Back$/)!); await flush();
    await click(btn(c)!); await flush(); await flush();
    check('S4 retap joins the running native request (single-flight preserved)', geo.calls.get === 1);
    await advanceTo(25_000); await flush(); await flush();
    check('S4 the new operation receives the fix', /Confirm Gps Town/.test(text(c)));
    await h.unmount();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => { console.error(err); process.exit(1); });
