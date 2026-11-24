/**
 * AURA-ANDROID-REL-04 -- LocationPicker city search: an older, slower search
 * response must never replace the results (or error) of a newer query.
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/locationPickerRel04SearchRace.test.ts
 *
 * Defect (REL-03 functional readiness, "Search race", P3, web and Android):
 * each debounced search applied its response unconditionally, so on a slow
 * mobile network typing "Ko" then "Kollam" could end with the "Ko" results on
 * screen. Fix: a per-query sequence id; only the newest request may update
 * results, error or the loading state.
 *
 * SYNTHETIC ONLY: Capacitor and fetch are mocked. No device, network or GPS.
 */
import * as path from 'path';
import { React, mount, flush, act, typeInto } from './jsdomReactHarness';

const App = { addListener: () => Promise.resolve({ remove: () => {} }) };
const Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
const Geolocation = {
  checkPermissions: async () => ({ location: 'granted', coarseLocation: 'granted' }),
  requestPermissions: async () => ({ location: 'granted', coarseLocation: 'granted' }),
  getCurrentPosition: () => new Promise(() => {}),
};
const pickerDir = path.join(__dirname, '..', 'apps', 'web', 'components');
function installMock(id: string, exports: unknown) {
  const resolved = require.resolve(id, { paths: [pickerDir] });
  const Module = require('module'); const m = new Module(resolved);
  m.filename = resolved; m.loaded = true; m.exports = exports; require.cache[resolved] = m;
}
installMock('@capacitor/core', { Capacitor, registerPlugin: () => ({ open: async () => {} }) });
installMock('@capacitor/geolocation', { Geolocation });
installMock('@capacitor/app', { App });

// ---------- controllable search fetch ----------
type Pending = { q: string; resolve: (names: string[]) => void; reject: () => void };
const pending: Pending[] = [];
const place = (name: string) => ({ displayName: name, cityName: name, latitude: 0, longitude: 0, timezone: 'UTC' });
(global as any).fetch = (url: string) => {
  const u = String(url);
  if (u.startsWith('/api/location/search')) {
    const q = decodeURIComponent(u.split('q=')[1] ?? '');
    return new Promise((resolve, reject) => {
      pending.push({
        q,
        resolve: (names) => resolve({ ok: true, status: 200, json: async () => ({ results: names.map(place) }) }),
        reject: () => reject(new TypeError('Failed to fetch')),
      });
    });
  }
  if (u.startsWith('/api/cities/custom')) return Promise.resolve({ ok: true, status: 200, json: async () => [] });
  return new Promise(() => {});
};

const { LocationPicker } = require('../apps/web/components/LocationPicker');

let passed = 0, failed = 0;
function check(label: string, ok: boolean) { ok ? passed++ : failed++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`); }

const picker = () => React.createElement(LocationPicker, { currentCity: 'Chennai', onChanged: () => {} });
const text = (c: HTMLElement) => c.textContent ?? '';
const resultButtons = (c: HTMLElement, re: RegExp) => [...c.querySelectorAll('button')].filter((b) => re.test(b.textContent ?? ''));
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const byQ = (q: string) => pending.find((p) => p.q === q)!;

async function typeAndDebounce(c: HTMLElement, value: string) {
  await typeInto(c.querySelector('#location-picker-search') as HTMLInputElement, value);
  await wait(450); await flush();
}
async function settle(fn: () => void) { await act(async () => { fn(); }); await flush(); await flush(); }

async function run() {
  // R1 -- older response arrives after the newer one.
  {
    pending.length = 0;
    const h = await mount(picker()); const c = h.container;
    await typeAndDebounce(c, 'Ko');
    await typeAndDebounce(c, 'Kollam');
    check('R1 precondition: two requests in flight (Ko, Kollam)', pending.length === 2 && !!byQ('Ko') && !!byQ('Kollam'));
    await settle(() => byQ('Kollam').resolve(['Kollam']));
    check('R1 newer results shown', resultButtons(c, /^Kollam/).length === 1);
    await settle(() => byQ('Ko').resolve(['Kozhikode', 'Kota']));
    check('R1 late older response does not replace the newer results', resultButtons(c, /^Kollam/).length === 1 && resultButtons(c, /^Kozhikode|^Kota/).length === 0);
    await h.unmount();
  }

  // R2 -- older request fails after the newer one succeeded.
  {
    pending.length = 0;
    const h = await mount(picker()); const c = h.container;
    await typeAndDebounce(c, 'Ma');
    await typeAndDebounce(c, 'Madurai');
    await settle(() => byQ('Madurai').resolve(['Madurai']));
    await settle(() => byQ('Ma').reject());
    check('R2 late older failure shows no error and keeps the newer results', !/Couldn't search right now/.test(text(c)) && resultButtons(c, /^Madurai/).length === 1);
    await h.unmount();
  }

  // R3 -- query shortened below 2 characters while a request is in flight.
  {
    pending.length = 0;
    const h = await mount(picker()); const c = h.container;
    await typeAndDebounce(c, 'Pune');
    await typeAndDebounce(c, 'P');
    await settle(() => byQ('Pune').resolve(['Pune']));
    check('R3 retired request does not repopulate results after the query was cleared', resultButtons(c, /^Pune/).length === 0);
    await h.unmount();
  }

  // R4 -- control: a single request still shows its results.
  {
    pending.length = 0;
    const h = await mount(picker()); const c = h.container;
    await typeAndDebounce(c, 'Kochi');
    await settle(() => byQ('Kochi').resolve(['Kochi']));
    check('R4 control: an uncontested search shows its results', resultButtons(c, /^Kochi/).length === 1);
    await h.unmount();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => { console.error(err); process.exit(1); });
