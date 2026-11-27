/**
 * AURA-MP-1 R4 (62014) -- the unified Add / Edit form contract, against the
 * REAL form (jsdom), the REAL route handlers and a REAL disposable Postgres.
 * Run (CI: day-constructor-acceptance-db-tests):
 *
 *   DATABASE_URL="postgresql://..." npx ts-node --project tsconfig.jsdom-tests.json test/myPeopleR4Db.test.ts
 *
 * Contract under test (see PeopleView.tsx):
 *   untouched -> omitted / persisted value kept; explicit change -> sent (a
 *   chart edit sends the full chart with untouched parts from the PERSISTED
 *   record); "No location" -> clears city AND coordinates; missing optional
 *   values stay missing (no default relationship, city, coordinates or
 *   timezone); a saved location is a saved city OR saved coordinates; invalid
 *   combinations are refused before any request.
 * Findings 62012: P1 coordinates without a city survive chart edits; P2 the
 * form never submits a timezone + coordinates combination the API rejects
 * (UTC is offered as Etc/UTC; a saved non-region zone + location is refused
 * with a clear message); P3 an untouched relationship is not inferred.
 */
import { React, mount, click, typeInto, act } from './jsdomReactHarness';
import { Pool } from 'pg';

const { createSessionToken } = require('../apps/web/lib/auth');
const db = require('../apps/web/lib/db');
const peopleRoute = require('../apps/web/app/api/people/route');
const personRoute = require('../apps/web/app/api/people/[personId]/route');
const { PeopleView } = require('../apps/web/components/PeopleView');

let allPassed = true;
let count = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  count++;
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}${!condition && detail !== undefined ? ` -- ${JSON.stringify(detail).slice(0, 500)}` : ''}`);
  if (!condition) allPassed = false;
}

const CUSTOM_CITY = { cityName: 'Evanston (custom)', latitude: 42.0451, longitude: -87.6877, timezone: 'America/Chicago' };
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let token = '';
let ownerId = '';
const sent: Array<{ method: string; url: string; body: any; status: number }> = [];
const routeReq = (body: unknown, url: string): any => ({
  cookies: { get: (n: string) => (n === 'as_session' ? { value: token } : undefined) },
  json: async () => body,
  headers: new Headers(),
  nextUrl: new URL(`http://localhost${url}`),
});
(global as any).fetch = async (url: string, init: any = {}) => {
  const method = init.method ?? 'GET';
  const body = init.body ? JSON.parse(init.body) : undefined;
  let res: Response;
  if (url === '/api/cities/custom') res = new Response(JSON.stringify([CUSTOM_CITY]), { status: 200 });
  else if (url === '/api/people') res = await (method === 'POST' ? peopleRoute.POST(routeReq(body, url)) : peopleRoute.GET(routeReq(body, url)));
  else {
    const m = /^\/api\/people\/([^/]+)$/.exec(url);
    if (!m) throw new Error(`unrouted ${method} ${url}`);
    const ctx = { params: { personId: m[1] } };
    res = await (method === 'PATCH' ? personRoute.PATCH(routeReq(body, url), ctx) : personRoute.GET(routeReq(body, url), ctx));
  }
  if (method !== 'GET') sent.push({ method, url, body, status: res.status });
  return res;
};
const apiCreate = async (body: Record<string, unknown>) => {
  const res: Response = await peopleRoute.POST(routeReq(body, '/api/people'));
  return { status: res.status, id: (await res.json().catch(() => ({})))?.id as string };
};

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const settle = async () => { for (let i = 0; i < 5; i++) await flush(); };
const buttons = (root: HTMLElement) => Array.from(root.querySelectorAll('button')) as HTMLButtonElement[];
const submit = (form: HTMLFormElement) => act(async () => { form.dispatchEvent(new (window as any).Event('submit', { bubbles: true, cancelable: true })); await new Promise((r) => setTimeout(r, 30)); });
const selectValue = async (el: HTMLSelectElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new (window as any).Event('change', { bubbles: true })); });
};
const setFlags = (server: boolean) => {
  if (server) process.env.AURA_MY_PEOPLE_ENABLED = '1'; else delete process.env.AURA_MY_PEOPLE_ENABLED;
  process.env.NEXT_PUBLIC_AURA_MY_PEOPLE = '1';
};
const options = (root: HTMLElement, id: string) => Array.from((root.querySelector(id) as HTMLSelectElement).options).map((o) => o.value);

type Step = { name?: string; date?: string; time?: string; timezone?: string; city?: string; relationship?: string };
async function fill(root: HTMLElement, steps: Step[]) {
  for (const s of steps) {
    if (s.name !== undefined) await typeInto(root.querySelector('#person-name') as HTMLInputElement, s.name);
    if (s.relationship !== undefined) await selectValue(root.querySelector('#person-relationship') as HTMLSelectElement, s.relationship);
    if (s.date !== undefined) await typeInto(root.querySelector('#person-birth-date') as HTMLInputElement, s.date);
    if (s.time !== undefined) await typeInto(root.querySelector('#person-birth-time') as HTMLInputElement, s.time);
    if (s.city !== undefined) await selectValue(root.querySelector('#person-birth-city') as HTMLSelectElement, s.city);
    if (s.timezone !== undefined) await selectValue(root.querySelector('#person-birth-timezone') as HTMLSelectElement, s.timezone);
  }
}
type FormView = { relationship: string; relationshipText: string; tz: string; city: string; cityText: string; tzOptions: string[]; relOptions: string[]; date: string; time: string };
const view = (root: HTMLElement): FormView => {
  const rel = root.querySelector('#person-relationship') as HTMLSelectElement;
  const city = root.querySelector('#person-birth-city') as HTMLSelectElement;
  return {
    relationship: rel.value,
    relationshipText: rel.options[rel.selectedIndex]?.text ?? '',
    tz: (root.querySelector('#person-birth-timezone') as HTMLSelectElement).value,
    city: city.value,
    cityText: city.options[city.selectedIndex]?.text ?? '',
    tzOptions: options(root, '#person-birth-timezone'),
    relOptions: options(root, '#person-relationship'),
    date: (root.querySelector('#person-birth-date') as HTMLInputElement).value,
    time: (root.querySelector('#person-birth-time') as HTMLInputElement).value,
  };
};
async function openForm(mode: 'ADD' | 'EDIT', cardName?: string) {
  const h = await mount(React.createElement(PeopleView, { onBack: () => {} }));
  await settle();
  const root = h.container as HTMLElement;
  if (mode === 'ADD') {
    await click(buttons(root).find((b) => /Add (person|someone)/.test(b.textContent ?? ''))!);
  } else {
    const v = buttons(root).filter((b) => b.textContent?.trim() === 'View').find((b) => b.closest('div')?.parentElement?.textContent?.includes(cardName!));
    if (!v) throw new Error(`card not found: ${cardName}`);
    await click(v);
    await settle();
    await click(buttons(root).find((b) => b.textContent?.trim() === 'Edit')!);
  }
  await settle();
  return { h, root };
}
async function run(mode: 'ADD' | 'EDIT', steps: Step[], cardName?: string) {
  const { h, root } = await openForm(mode, cardName);
  const before = view(root);
  await fill(root, steps);
  const n = sent.length;
  await submit(root.querySelector('form') as HTMLFormElement);
  await settle();
  const text = root.textContent ?? '';
  await h.unmount();
  return { requests: sent.slice(n), text, before };
}
const COLS = `name, "relationshipType", "birthDate"::date::text AS "birthDate", "birthTime", "birthTimezone", "birthCityName", "birthLatitude", "birthLongitude", notes, interests`;
const rec = async (id: string) => (await pool.query(`SELECT ${COLS} FROM "SavedPerson" WHERE id = $1`, [id])).rows[0];
const recByName = async (name: string) => (await pool.query(`SELECT id, ${COLS} FROM "SavedPerson" WHERE "ownerUserId" = $1 AND name = $2`, [ownerId, name])).rows[0] ?? null;
const changed = (a: any, b: any) => Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();
const keys = (o: any) => Object.keys(o ?? {}).sort();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** One Edit operation: exact payload keys, HTTP 200 and exactly the expected persisted columns changed. */
async function editOp(label: string, id: string, card: string, steps: Step[], expectPayloadKeys: string[] | null, expectChanged: string[], extra?: (payload: any, after: any) => boolean) {
  const before = await rec(id);
  const r = await run('EDIT', steps, card);
  const after = await rec(id);
  const payload = r.requests[0]?.body;
  if (expectPayloadKeys === null) {
    check(`${label}: no request sent, record identical`, r.requests.length === 0 && changed(before, after).length === 0, { requests: r.requests, diff: changed(before, after) });
  } else {
    check(`${label}: payload keys exactly [${expectPayloadKeys.join(', ')}], 200, persisted change exactly [${expectChanged.join(', ')}]`, r.requests.length === 1 && r.requests[0].status === 200 && same(keys(payload), [...expectPayloadKeys].sort()) && same(changed(before, after), [...expectChanged].sort()) && (extra ? extra(payload, after) : true), { payload, status: r.requests[0]?.status, before, after, diff: changed(before, after) });
  }
  return { before, after, payload, r };
}

async function main() {
  const tag = `mp1r4-${Date.now()}`;
  const user = await db.upsertUserByEmail({ email: `${tag}@mp1.aura.local`, cityName: 'Chicago', latitude: 41.88, longitude: -87.63, timezone: 'America/Chicago' });
  ownerId = user.id;
  token = createSessionToken(user.id, user.email);
  const CHART = ['birthDate', 'birthTime', 'birthTimezone'];
  const CHART_CITY = ['birthCityName', 'birthDate', 'birthLatitude', 'birthLongitude', 'birthTime', 'birthTimezone'];
  const CHART_COORDS = ['birthDate', 'birthLatitude', 'birthLongitude', 'birthTime', 'birthTimezone'];
  const MY_PEOPLE_TYPES = ['PARENT', 'CHILD', 'SIBLING'];
  const LEGACY_TYPES = ['PARTNER', 'SPOUSE', 'FAMILY', 'FRIEND', 'OTHER'];

  for (const on of [true, false]) {
    setFlags(on);
    const S = on ? 'ENABLED' : 'DISABLED';
    const nm = (s: string) => `${s} ${S}`;
    const trio = { date: '2000-02-29', time: '07:20', timezone: 'America/Chicago' };

    // ---------- ADD ----------
    {
      const { h, root } = await openForm('ADD');
      const v = view(root);
      await h.unmount();
      check(`${S} Add: relationship is "Not specified" (no PARTNER); timezone and location not pre-selected`, v.relationship === '' && /Not specified/.test(v.relationshipText) && v.tz === '' && v.city === '', v);
      check(`${S} Add: timezone list offers Etc/UTC but not the bare UTC (which the API refuses with coordinates)`, v.tzOptions.includes('Etc/UTC') && !v.tzOptions.includes('UTC') && v.tzOptions.filter((z) => z && !z.includes('/')).length === 0, v.tzOptions.filter((z) => !z.includes('/')));
      check(`${S} Add: relationship options are ${on ? 'legacy + My People' : 'legacy only'}`, LEGACY_TYPES.every((t) => v.relOptions.includes(t)) && MY_PEOPLE_TYPES.every((t) => v.relOptions.includes(t) === on), v.relOptions);
    }
    // name-only + untouched relationship
    {
      const r = await run('ADD', [{ name: nm('NameOnly') }]);
      const row = await recByName(nm('NameOnly'));
      if (on) check(`${S} Add: name only, relationship untouched -> payload exactly [name], 201, persisted relationship OTHER (API default), no chart`, r.requests[0]?.status === 201 && same(keys(r.requests[0].body), ['name']) && row?.relationshipType === 'OTHER' && row?.birthDate === null, { requests: r.requests, row });
      else check(`${S} Add: name only -> refused in the UI, nothing sent or persisted`, r.requests.length === 0 && row === null && /birth date and a birth time/.test(r.text), { requests: r.requests, row });
    }
    // untouched relationship with birth details
    {
      const r = await run('ADD', [{ name: nm('Untouched Rel'), ...trio }]);
      const row = await recByName(nm('Untouched Rel'));
      check(`${S} Add: birth details without city or coordinates, relationship untouched -> payload exactly [name + trio], persisted OTHER, no city/coords`, r.requests[0]?.status === 201 && same(keys(r.requests[0].body), ['name', ...CHART].sort()) && row?.relationshipType === 'OTHER' && row?.birthCityName === null && row?.birthLatitude === null && row?.birthTimezone === 'America/Chicago', { requests: r.requests, row });
    }
    // every supported explicit relationship
    for (const t of on ? [...LEGACY_TYPES, ...MY_PEOPLE_TYPES] : LEGACY_TYPES) {
      const r = await run('ADD', [{ name: nm(`Rel ${t}`), relationship: t, ...(on ? {} : trio) }]);
      const row = await recByName(nm(`Rel ${t}`));
      check(`${S} Add: explicit relationship ${t} -> sent and persisted`, r.requests[0]?.status === 201 && r.requests[0].body.relationshipType === t && row?.relationshipType === t, { requests: r.requests, row });
    }
    // city with coordinates; custom city; Etc/UTC; Etc/UTC + city; non-default zone
    {
      const r = await run('ADD', [{ name: nm('City Mumbai'), date: '1975-08-15', time: '00:01', city: 'Mumbai' }]);
      const row = await recByName(nm('City Mumbai'));
      check(`${S} Add: city with coordinates (Mumbai) -> its coordinates + Asia/Kolkata persisted`, r.requests[0]?.status === 201 && same(keys(r.requests[0].body), ['name', ...CHART_CITY].sort()) && row?.birthCityName === 'Mumbai' && row?.birthLatitude === 19.076 && row?.birthTimezone === 'Asia/Kolkata', { requests: r.requests, row });
    }
    {
      const r = await run('ADD', [{ name: nm('Custom City'), date: '1980-01-01', time: '12:00', city: CUSTOM_CITY.cityName }]);
      const row = await recByName(nm('Custom City'));
      check(`${S} Add: custom (user) city -> its own coordinates and timezone persisted`, r.requests[0]?.status === 201 && row?.birthCityName === CUSTOM_CITY.cityName && row?.birthLatitude === CUSTOM_CITY.latitude && row?.birthTimezone === CUSTOM_CITY.timezone, { requests: r.requests, row });
    }
    {
      const r = await run('ADD', [{ name: nm('EtcUTC NoLoc'), date: '1980-01-01', time: '12:00', timezone: 'Etc/UTC' }]);
      const row = await recByName(nm('EtcUTC NoLoc'));
      check(`${S} Add: Etc/UTC without a location -> 201, Etc/UTC persisted`, r.requests[0]?.status === 201 && row?.birthTimezone === 'Etc/UTC' && row?.birthCityName === null, { requests: r.requests, row });
    }
    {
      const r = await run('ADD', [{ name: nm('Mumbai EtcUTC'), date: '2000-02-29', time: '07:20', city: 'Mumbai' }, { timezone: 'Etc/UTC' }]);
      const row = await recByName(nm('Mumbai EtcUTC'));
      check(`${S} Add: Mumbai then Etc/UTC (the offered UTC) -> 201, no 400, Etc/UTC + Mumbai coordinates persisted`, r.requests.length === 1 && r.requests[0].status === 201 && row?.birthTimezone === 'Etc/UTC' && row?.birthLatitude === 19.076, { requests: r.requests, row });
    }
    {
      const r = await run('ADD', [{ name: nm('Adelaide'), date: '1990-06-15', time: '05:45', timezone: 'Australia/Adelaide' }]);
      const row = await recByName(nm('Adelaide'));
      check(`${S} Add: representative non-default zone (Australia/Adelaide, half-hour offset) persisted exactly`, r.requests[0]?.status === 201 && row?.birthTimezone === 'Australia/Adelaide', { requests: r.requests, row });
    }
    // incomplete / invalid combinations on Add
    for (const [label, steps, msg] of [
      ['date only', [{ name: nm('Bad1'), date: '1990-01-01' }], /birth date and a birth time/],
      ['date + time, no timezone', [{ name: nm('Bad2'), date: '1990-01-01', time: '10:00' }], /time zone/],
      ['timezone only', [{ name: nm('Bad3'), timezone: 'Europe/London' }], /birth date and a birth time/],
      ['location only', [{ name: nm('Bad4'), city: 'Mumbai' }], /birth date and a birth time/],
    ] as Array<[string, Step[], RegExp]>) {
      const r = await run('ADD', steps);
      check(`${S} Add: ${label} -> refused before any request, nothing persisted`, r.requests.length === 0 && (await recByName(steps[0].name!)) === null && msg.test(r.text), { requests: r.requests });
    }

    // ---------- EDIT fixtures (created through the API with My People enabled) ----------
    setFlags(true);
    const coords = (await apiCreate({ name: nm('E Coords'), relationshipType: 'SIBLING', birthDate: '2000-02-29', birthTime: '07:20', birthTimezone: 'America/Chicago', birthLatitude: 41.88, birthLongitude: -87.63, notes: 'note', interests: ['tea'] })).id;
    const unlisted = (await apiCreate({ name: nm('E Unlisted'), relationshipType: 'PARENT', birthDate: '1961-07-04', birthTime: '06:30', birthTimezone: 'America/Chicago', birthCityName: 'Naperville', birthLatitude: 41.7508, birthLongitude: -88.1535 })).id;
    const noloc = (await apiCreate({ name: nm('E NoLoc'), relationshipType: 'FRIEND', birthDate: '1990-05-20', birthTime: '21:15', birthTimezone: 'Europe/London' })).id;
    const utcSaved = (await apiCreate({ name: nm('E UTC'), relationshipType: 'OTHER', birthDate: '1985-03-03', birthTime: '03:03', birthTimezone: 'UTC' })).id;
    const nameOnly = (await apiCreate({ name: nm('E NameOnly') })).id;
    setFlags(on);

    // reopen: the saved values are shown, including coordinates without a city
    {
      const { h, root } = await openForm('EDIT', nm('E Coords'));
      const v = view(root);
      await h.unmount();
      check(`${S} Edit reopen: coordinates without a city are shown as a SAVED location; timezone, relationship, date and time shown as saved`, /Saved coordinates \(41\.88, -87\.63\)/.test(v.cityText) && v.tz === 'America/Chicago' && v.relationship === 'SIBLING' && v.date === '2000-02-29' && v.time === '07:20', v);
    }
    // P1 core: edit only birth date / time / timezone on coordinates-without-city
    await editOp(`${S} Edit coords-no-city: only birth TIME`, coords, nm('E Coords'), [{ time: '08:15' }], CHART_COORDS, ['birthTime'], (p, a) => p.birthLatitude === 41.88 && a.birthLatitude === 41.88 && a.birthLongitude === -87.63 && a.birthCityName === null);
    await editOp(`${S} Edit coords-no-city: only birth DATE`, coords, nm('E Coords'), [{ date: '2000-03-01' }], CHART_COORDS, ['birthDate'], (_p, a) => a.birthLatitude === 41.88 && a.birthLongitude === -87.63);
    await editOp(`${S} Edit coords-no-city: only TIMEZONE`, coords, nm('E Coords'), [{ timezone: 'America/Denver' }], CHART_COORDS, ['birthTimezone'], (_p, a) => a.birthTimezone === 'America/Denver' && a.birthLatitude === 41.88);
    await editOp(`${S} Edit coords-no-city: rename only`, coords, nm('E Coords'), [{ name: nm('E Coords R') }], ['name'], ['name']);
    await editOp(`${S} Edit coords-no-city: no-change save`, coords, nm('E Coords R'), [], null, []);
    {
      const { h, root } = await openForm('EDIT', nm('E Coords R'));
      const v = view(root);
      await h.unmount();
      check(`${S} Edit reopen after edits: coordinates still shown as saved; edited date/time/timezone shown`, /Saved coordinates \(41\.88, -87\.63\)/.test(v.cityText) && v.date === '2000-03-01' && v.time === '08:15' && v.tz === 'America/Denver', v);
    }
    // unlisted city + coordinates
    await editOp(`${S} Edit unlisted city: only birth TIME`, unlisted, nm('E Unlisted'), [{ time: '06:45' }], CHART_CITY, ['birthTime'], (p, a) => p.birthCityName === 'Naperville' && a.birthCityName === 'Naperville' && a.birthLatitude === 41.7508);
    await editOp(`${S} Edit unlisted city: only TIMEZONE`, unlisted, nm('E Unlisted'), [{ timezone: 'America/New_York' }], CHART_CITY, ['birthTimezone'], (_p, a) => a.birthCityName === 'Naperville' && a.birthLongitude === -88.1535);
    if (on) await editOp(`${S} Edit unlisted city: relationship only (PARENT -> CHILD)`, unlisted, nm('E Unlisted'), [{ relationship: 'CHILD' }], ['relationshipType'], ['relationshipType']);
    else await editOp(`${S} Edit unlisted city: relationship only (PARENT -> FAMILY, legacy)`, unlisted, nm('E Unlisted'), [{ relationship: 'FAMILY' }], ['relationshipType'], ['relationshipType']);
    await editOp(`${S} Edit unlisted city: explicit city change -> Mumbai`, unlisted, nm('E Unlisted'), [{ city: 'Mumbai' }], CHART_CITY, ['birthCityName', 'birthLatitude', 'birthLongitude', 'birthTimezone'], (_p, a) => a.birthCityName === 'Mumbai' && a.birthTimezone === 'Asia/Kolkata');
    await editOp(`${S} Edit city: explicit clearing ("No location") clears city AND coordinates, keeps the chart`, unlisted, nm('E Unlisted'), [{ city: '' }], CHART, ['birthCityName', 'birthLatitude', 'birthLongitude'], (_p, a) => a.birthCityName === null && a.birthLatitude === null && a.birthTimezone === 'Asia/Kolkata');
    // explicit coordinate clearing on coordinates-without-city
    await editOp(`${S} Edit coords-no-city: explicit coordinate clearing ("No location")`, coords, nm('E Coords R'), [{ city: '' }], CHART, ['birthLatitude', 'birthLongitude'], (_p, a) => a.birthLatitude === null && a.birthTimezone === 'America/Denver');
    // no location at all
    await editOp(`${S} Edit no-location chart: only birth TIME (stays without location)`, noloc, nm('E NoLoc'), [{ time: '21:30' }], CHART, ['birthTime'], (_p, a) => a.birthCityName === null && a.birthLatitude === null);
    await editOp(`${S} Edit no-location chart: no-change save`, noloc, nm('E NoLoc'), [], null, []);
    // saved UTC (non-region zone, no coordinates) stays usable; combining it with a location is refused clearly
    {
      const { h, root } = await openForm('EDIT', nm('E UTC'));
      const v = view(root);
      await h.unmount();
      check(`${S} Edit saved UTC: the saved zone is shown (never silently changed)`, v.tz === 'UTC' && v.tzOptions.includes('UTC'), v.tz);
    }
    await editOp(`${S} Edit saved UTC: only birth TIME -> UTC kept, no location`, utcSaved, nm('E UTC'), [{ time: '04:04' }], CHART, ['birthTime'], (_p, a) => a.birthTimezone === 'UTC');
    {
      const before = await rec(utcSaved);
      const r = await run('EDIT', [{ city: 'Mumbai' }, { timezone: 'UTC' }], nm('E UTC'));
      check(`${S} Edit saved UTC + a location -> refused before any request with an actionable message; nothing changed`, r.requests.length === 0 && /can't be saved with a birth location/.test(r.text) && /Etc\/UTC/.test(r.text) && changed(before, await rec(utcSaved)).length === 0, { requests: r.requests });
    }
    // name-only person: adding a chart
    await editOp(`${S} Edit name-only person: add birth details without a location`, nameOnly, nm('E NameOnly'), [{ date: '1999-09-09', time: '09:09', timezone: 'Etc/UTC' }], CHART, ['birthDate', 'birthTime', 'birthTimezone'], (_p, a) => a.birthTimezone === 'Etc/UTC' && a.birthCityName === null);
    // invalid edits
    {
      const before = await rec(noloc);
      const r = await run('EDIT', [{ time: '' }], nm('E NoLoc'));
      check(`${S} Edit: clearing only the birth time is refused before any request`, r.requests.length === 0 && changed(before, await rec(noloc)).length === 0, r.requests);
    }
    // notes / interests untouched by every editor operation on E Coords
    {
      const a = await rec(coords);
      check(`${S} Edit: notes and interests survived every editor operation`, a.notes === 'note' && same(a.interests, ['tea']), a);
    }
  }

  // ---------- No implicit defaults anywhere ----------
  const rows = (await pool.query(`SELECT name, "relationshipType", "birthCityName" FROM "SavedPerson" WHERE "ownerUserId" = $1`, [ownerId])).rows;
  check('No implicit PARTNER: only explicitly chosen people are PARTNER', rows.filter((r: any) => r.relationshipType === 'PARTNER').every((r: any) => /Rel PARTNER/.test(r.name)), rows.filter((r: any) => r.relationshipType === 'PARTNER'));
  check('No implicit Chennai location anywhere', !rows.some((r: any) => r.birthCityName === 'Chennai'));
  console.log(`(R4 suite: ${count} checks)`);
  await pool.query(`DELETE FROM "SavedPerson" WHERE "ownerUserId" = $1`, [ownerId]);
}

main()
  .catch((e) => { console.error(e); allPassed = false; })
  .finally(async () => {
    await pool.end();
    if (!allPassed) { console.error('\nSOME MY PEOPLE R4 DB CHECKS FAILED'); process.exit(1); }
    console.log('\nALL MY PEOPLE R4 DB CHECKS PASSED');
    process.exit(0);
  });
