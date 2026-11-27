/**
 * AURA-MP-1 R3 (62011) -- optional birth location in the People Add / Edit
 * forms, against the REAL form (jsdom), the REAL route handlers and a REAL
 * disposable Postgres. Run (CI: day-constructor-acceptance-db-tests):
 *
 *   DATABASE_URL="postgresql://..." npx ts-node --project tsconfig.jsdom-tests.json test/myPeopleR3Db.test.ts
 *
 * The approved contract: birth information is the all-or-none trio
 * date + time + TIMEZONE; city and coordinates are optional. Every case
 * checks the EXACT submitted payload and the persisted record. Covered in both
 * server states (My People enabled: name-only valid; disabled: the legacy
 * contract requires the trio):
 *   name-only / no birth information; date + time + timezone without a city;
 *   an explicit non-default timezone without a city; an explicit city (its
 *   coordinates); changing the selected city; clearing a selected city while
 *   keeping the timezone; incomplete or invalid chart information refused;
 *   no implicit Chennai (or any default) location ever persisted; and the
 *   same rules in the Edit form (add a chart without a city, drop a saved
 *   city keeping the timezone, change only the timezone).
 */
import { React, mount, click, typeInto, act } from './jsdomReactHarness';
import { Pool } from 'pg';

const { createSessionToken } = require('../apps/web/lib/auth');
const db = require('../apps/web/lib/db');
const peopleRoute = require('../apps/web/app/api/people/route');
const personRoute = require('../apps/web/app/api/people/[personId]/route');
const { PeopleView } = require('../apps/web/components/PeopleView');
const { CITY_OPTIONS } = require('../apps/web/lib/cities');

let allPassed = true;
function check(label: string, condition: boolean, detail?: unknown) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}${!condition && detail !== undefined ? ` -- ${JSON.stringify(detail).slice(0, 500)}` : ''}`);
  if (!condition) allPassed = false;
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let token = '';
const sent: Array<{ method: string; url: string; body: any; status: number; response: any }> = [];
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
  if (url === '/api/cities/custom') res = new Response('[]', { status: 200 });
  else if (url === '/api/people') res = await (method === 'POST' ? peopleRoute.POST(routeReq(body, url)) : peopleRoute.GET(routeReq(body, url)));
  else {
    const m = /^\/api\/people\/([^/]+)$/.exec(url);
    if (!m) throw new Error(`unrouted ${method} ${url}`);
    const ctx = { params: { personId: m[1] } };
    res = await (method === 'PATCH' ? personRoute.PATCH(routeReq(body, url), ctx) : personRoute.GET(routeReq(body, url), ctx));
  }
  if (method !== 'GET') sent.push({ method, url, body, status: res.status, response: await res.clone().json().catch(() => null) });
  return res;
};

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const settle = async () => { for (let i = 0; i < 5; i++) await flush(); };
const buttons = (root: HTMLElement) => Array.from(root.querySelectorAll('button')) as HTMLButtonElement[];
const submit = (form: HTMLFormElement) => act(async () => { form.dispatchEvent(new (window as any).Event('submit', { bubbles: true, cancelable: true })); await new Promise((r) => setTimeout(r, 30)); });
const selectValue = async (el: HTMLSelectElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new (window as any).Event('change', { bubbles: true })); });
};
const setServer = (on: boolean) => { if (on) process.env.AURA_MY_PEOPLE_ENABLED = '1'; else delete process.env.AURA_MY_PEOPLE_ENABLED; };

type Step = { name?: string; date?: string; time?: string; timezone?: string; city?: string; relationship?: string };
/** Fills the real form with `steps` IN ORDER (so a later city or timezone change is a real user change). */
async function fill(root: HTMLElement, steps: Step[]) {
  for (const s of steps) {
    if (s.name !== undefined) await typeInto(root.querySelector('#person-name') as HTMLInputElement, s.name);
    if (s.relationship !== undefined) await selectValue(root.querySelector('#person-relationship') as HTMLSelectElement, s.relationship);
    if (s.date !== undefined) await typeInto(root.querySelector('#person-birth-date') as HTMLInputElement, s.date);
    if (s.time !== undefined) await typeInto(root.querySelector('#person-birth-time') as HTMLInputElement, s.time);
    if (s.city !== undefined) await selectValue(root.querySelector('#person-birth-city') as HTMLSelectElement, s.city);
    // A form without a timezone control (e.g. a regression) is not crashed on: the checks then fail on their own.
    const tz = root.querySelector('#person-birth-timezone') as HTMLSelectElement | null;
    if (s.timezone !== undefined && tz) await selectValue(tz, s.timezone);
  }
}
async function addViaForm(steps: Step[]) {
  const h = await mount(React.createElement(PeopleView, { onBack: () => {} }));
  await settle();
  const root = h.container as HTMLElement;
  await click(buttons(root).find((b) => /Add (person|someone)/.test(b.textContent ?? ''))!);
  await settle();
  const tzBefore = (root.querySelector('#person-birth-timezone') as HTMLSelectElement | null)?.value;
  const cityBefore = (root.querySelector('#person-birth-city') as HTMLSelectElement | null)?.value;
  await fill(root, steps);
  const n = sent.length;
  await submit(root.querySelector('form') as HTMLFormElement);
  await settle();
  const text = root.textContent ?? '';
  await h.unmount();
  return { requests: sent.slice(n), text, tzBefore, cityBefore };
}
async function editViaForm(cardName: string, steps: Step[]) {
  const h = await mount(React.createElement(PeopleView, { onBack: () => {} }));
  await settle();
  const root = h.container as HTMLElement;
  const view = buttons(root).filter((b) => b.textContent?.trim() === 'View').find((b) => b.closest('div')?.parentElement?.textContent?.includes(cardName));
  if (!view) throw new Error(`card not found: ${cardName}`);
  await click(view);
  await settle();
  await click(buttons(root).find((b) => b.textContent?.trim() === 'Edit')!);
  await settle();
  await fill(root, steps);
  const n = sent.length;
  await submit(root.querySelector('form') as HTMLFormElement);
  await settle();
  const text = root.textContent ?? '';
  await h.unmount();
  return { requests: sent.slice(n), text };
}

const COLS = `name, "relationshipType", "birthDate", "birthTime", "birthTimezone", "birthCityName", "birthLatitude", "birthLongitude"`;
let ownerId = '';
const byName = async (name: string) => (await pool.query(`SELECT id, ${COLS} FROM "SavedPerson" WHERE "ownerUserId" = $1 AND name = $2`, [ownerId, name])).rows[0] ?? null;
const keys = (o: any) => Object.keys(o ?? {}).sort();
const city = (n: string) => CITY_OPTIONS.find((c: any) => c.cityName === n);

async function main() {
  const tag = `mp1r3-${Date.now()}`;
  const user = await db.upsertUserByEmail({ email: `${tag}@mp1.aura.local`, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
  ownerId = user.id;
  token = createSessionToken(user.id, user.email);
  process.env.NEXT_PUBLIC_AURA_MY_PEOPLE = '0';
  const NO_CHART = ['name', 'relationshipType'];
  // AURA-MP-1 R4 P3 (62014): these two lists used to include 'relationshipType' although these cases never choose
  // a relationship -- that expectation pinned the implicit PARTNER default (62012 P3). An untouched relationship is
  // now omitted (API default OTHER). Cases that DO choose one (name-only, FRIEND) still expect it.
  const TRIO = ['birthDate', 'birthTime', 'birthTimezone', 'name'];
  const WITH_CITY = ['birthCityName', 'birthDate', 'birthLatitude', 'birthLongitude', 'birthTime', 'birthTimezone', 'name'];

  for (const on of [true, false]) {
    setServer(on);
    const S = on ? 'ENABLED' : 'DISABLED';
    const n = (s: string) => `${s} ${S}`;

    // Fresh Add form: nothing pre-selected.
    const fresh = await addViaForm([]);
    check(`${S}: the Add form opens with NO timezone and NO city pre-selected`, fresh.tzBefore === '' && fresh.cityBefore === '', { tz: fresh.tzBefore, city: fresh.cityBefore });

    // 1. name-only / no birth information
    {
      const r = await addViaForm([{ name: n('Name Only'), relationship: 'FRIEND' }]);
      const row = await byName(n('Name Only'));
      if (on) {
        check(`${S}: name-only Add -> one POST with exactly [name, relationshipType] -> 201`, r.requests.length === 1 && r.requests[0].status === 201 && JSON.stringify(keys(r.requests[0].body)) === JSON.stringify(NO_CHART), r.requests);
        check(`${S}: name-only Add persists no birth information at all`, row && row.birthDate === null && row.birthTime === null && row.birthTimezone === null && row.birthCityName === null && row.birthLatitude === null && row.relationshipType === 'FRIEND', row);
      } else {
        check(`${S}: name-only Add is refused in the UI (legacy contract) -- no request, nothing persisted, a clear message`, r.requests.length === 0 && row === null && /birth date and a birth time/.test(r.text), { requests: r.requests, row });
      }
    }
    // 2. date + time + timezone, no city
    {
      const r = await addViaForm([{ name: n('Trio NoCity'), date: '1990-05-20', time: '21:15', timezone: 'America/Chicago' }]);
      const row = await byName(n('Trio NoCity'));
      check(`${S}: date + time + timezone without a city -> payload exactly the trio + name/relationship -> 201`, r.requests.length === 1 && r.requests[0].status === 201 && JSON.stringify(keys(r.requests[0].body)) === JSON.stringify(TRIO) && r.requests[0].body.birthTimezone === 'America/Chicago', r.requests);
      check(`${S}: ...persisted with timezone America/Chicago and NO city / coordinates`, row?.birthTimezone === 'America/Chicago' && row?.birthCityName === null && row?.birthLatitude === null && row?.birthLongitude === null && row?.birthTime === '21:15', row);
    }
    // 3. explicit non-default timezone without a city
    {
      const r = await addViaForm([{ name: n('Auckland NoCity'), date: '1984-02-29', time: '04:05', timezone: 'Pacific/Auckland' }]);
      const row = await byName(n('Auckland NoCity'));
      check(`${S}: explicit non-default timezone (Pacific/Auckland) without a city persists exactly that`, r.requests[0]?.status === 201 && row?.birthTimezone === 'Pacific/Auckland' && row?.birthCityName === null, { requests: r.requests, row });
    }
    // 4. explicit city -> its timezone and coordinates
    {
      const r = await addViaForm([{ name: n('With Mumbai'), date: '1975-08-15', time: '00:01', city: 'Mumbai' }]);
      const row = await byName(n('With Mumbai'));
      const m = city('Mumbai');
      check(`${S}: explicit city (Mumbai) -> payload carries the city, its coordinates and its timezone`, r.requests[0]?.status === 201 && JSON.stringify(keys(r.requests[0].body)) === JSON.stringify(WITH_CITY) && r.requests[0].body.birthCityName === 'Mumbai' && r.requests[0].body.birthLatitude === m.latitude && r.requests[0].body.birthTimezone === m.timezone, r.requests);
      check(`${S}: ...persisted Mumbai with its exact coordinates`, row?.birthCityName === 'Mumbai' && row?.birthLatitude === m.latitude && row?.birthLongitude === m.longitude && row?.birthTimezone === m.timezone, row);
    }
    // 5. changing the selected city
    {
      const r = await addViaForm([{ name: n('City Changed'), date: '1980-01-01', time: '12:00', city: 'Chennai' }, { city: 'London, UK' }]);
      const row = await byName(n('City Changed'));
      const l = city('London, UK');
      check(`${S}: changing the selected city (Chennai -> London) persists London, its coordinates and timezone -- no trace of Chennai`, r.requests[0]?.status === 201 && row?.birthCityName === 'London, UK' && row?.birthLatitude === l.latitude && row?.birthTimezone === l.timezone, { requests: r.requests, row });
    }
    // 6. clearing a selected city while keeping valid birth information
    {
      const r = await addViaForm([{ name: n('City Cleared'), date: '1980-01-01', time: '12:00', city: 'Chennai' }, { city: '' }]);
      const row = await byName(n('City Cleared'));
      check(`${S}: selecting then clearing a city keeps the timezone it filled in (Asia/Kolkata) and sends no city / coordinates`, r.requests[0]?.status === 201 && JSON.stringify(keys(r.requests[0].body)) === JSON.stringify(TRIO) && r.requests[0].body.birthTimezone === 'Asia/Kolkata', r.requests);
      check(`${S}: ...persisted with no city and no coordinates`, row?.birthCityName === null && row?.birthLatitude === null && row?.birthTimezone === 'Asia/Kolkata', row);
    }
    // 7. city chosen, then a different timezone chosen explicitly (timezone independent of city)
    {
      const r = await addViaForm([{ name: n('Tz Override'), date: '1980-01-01', time: '12:00', city: 'Mumbai' }, { timezone: 'Asia/Dubai' }]);
      const row = await byName(n('Tz Override'));
      check(`${S}: an explicitly chosen timezone wins over the city's (Mumbai + Asia/Dubai)`, r.requests[0]?.status === 201 && row?.birthTimezone === 'Asia/Dubai' && row?.birthCityName === 'Mumbai', { requests: r.requests, row });
    }
    // 8. incomplete / invalid chart information is refused before any request
    const refusals: Array<[string, Step[], RegExp]> = [
      ['date without time or timezone', [{ name: n('Bad1'), date: '1990-01-01' }], /birth date and a birth time/],
      ['date + time without timezone', [{ name: n('Bad2'), date: '1990-01-01', time: '10:00' }], /time zone/],
      ['timezone without date or time', [{ name: n('Bad3'), timezone: 'Europe/London' }], /birth date and a birth time/],
      ['city without date or time', [{ name: n('Bad4'), city: 'Chennai' }], /birth date and a birth time/],
      ['time without date', [{ name: n('Bad5'), time: '10:00', timezone: 'UTC' }], /birth date and a birth time/],
    ];
    for (const [label, steps, msg] of refusals) {
      const r = await addViaForm(steps);
      const row = await byName(steps[0].name!);
      check(`${S}: ${label} -> refused in the UI (no request, nothing persisted, clear message)`, r.requests.length === 0 && row === null && msg.test(r.text), { requests: r.requests, row });
    }
    // Invalid chart information through the API (F3, closed): still a controlled 400 in this state.
    {
      const res: Response = await peopleRoute.POST(routeReq({ name: n('Api Invalid'), birthDate: '2023-02-30', birthTime: '10:00', birthTimezone: 'UTC' }, '/api/people'));
      const res2: Response = await peopleRoute.POST(routeReq({ name: n('Api NoTz'), birthDate: '1990-01-01', birthTime: '10:00' }, '/api/people'));
      check(`${S}: the API still refuses an impossible date and an incomplete trio (400)`, res.status === 400 && res2.status === 400, [res.status, res2.status]);
    }
  }

  // ---------------- Edit form (enabled and disabled) ----------------
  setServer(true);
  const nameOnly = (await db.createSavedPerson(user.id, { name: 'Edit NameOnly', relationshipType: 'FRIEND' })).id;
  const saved = (await db.createSavedPerson(user.id, { name: 'Edit Saved', relationshipType: 'FRIEND', birthDate: '1961-07-04', birthTime: '06:30', birthTimezone: 'America/Chicago', birthCityName: 'Naperville', birthLatitude: 41.7508, birthLongitude: -88.1535 })).id;
  {
    const r = await editViaForm('Edit NameOnly', [{ date: '1999-09-09', time: '09:09', timezone: 'Europe/London' }]);
    const row = (await pool.query(`SELECT ${COLS} FROM "SavedPerson" WHERE id = $1`, [nameOnly])).rows[0];
    check('ENABLED Edit: adding birth information WITHOUT a city -> payload exactly the trio -> persisted, no city', r.requests[0]?.status === 200 && JSON.stringify(keys(r.requests[0].body)) === JSON.stringify(['birthDate', 'birthTime', 'birthTimezone']) && row.birthTimezone === 'Europe/London' && row.birthCityName === null, { requests: r.requests, row });
  }
  for (const on of [false, true]) {
    setServer(on);
    const S = on ? 'ENABLED' : 'DISABLED';
    const before = (await pool.query(`SELECT ${COLS} FROM "SavedPerson" WHERE id = $1`, [saved])).rows[0];
    const r = await editViaForm('Edit Saved', [{ timezone: on ? 'America/Denver' : 'America/Chicago' }]);
    const after = (await pool.query(`SELECT ${COLS} FROM "SavedPerson" WHERE id = $1`, [saved])).rows[0];
    if (on) {
      check(`${S} Edit: changing ONLY the timezone keeps the saved Naperville city and coordinates`, r.requests[0]?.status === 200 && after.birthTimezone === 'America/Denver' && after.birthCityName === 'Naperville' && after.birthLatitude === 41.7508 && after.birthTime === before.birthTime, { requests: r.requests, after });
    } else {
      check(`${S} Edit: re-selecting the SAME timezone is not a change -> no request`, r.requests.length === 0 && JSON.stringify(before) === JSON.stringify(after), r.requests);
    }
  }
  setServer(false);
  {
    const r = await editViaForm('Edit Saved', [{ city: '' }]);
    const after = (await pool.query(`SELECT ${COLS} FROM "SavedPerson" WHERE id = $1`, [saved])).rows[0];
    check('DISABLED Edit: clearing the saved city keeps date, time and timezone; city and coordinates removed', r.requests[0]?.status === 200 && after.birthCityName === null && after.birthLatitude === null && after.birthTimezone === 'America/Denver' && after.birthTime === '06:30' && JSON.stringify(keys(r.requests[0].body)) === JSON.stringify(['birthDate', 'birthTime', 'birthTimezone']), { requests: r.requests, after });
  }

  // ---------------- No implicit default location anywhere ----------------
  const leaked = (await pool.query(`SELECT name, "birthCityName" FROM "SavedPerson" WHERE "ownerUserId" = $1 AND "birthCityName" IS NOT NULL ORDER BY name`, [user.id])).rows;
  const explicit = new Set(['With Mumbai ENABLED', 'With Mumbai DISABLED', 'City Changed ENABLED', 'City Changed DISABLED', 'Tz Override ENABLED', 'Tz Override DISABLED']);
  check('No implicit location: the ONLY persisted cities are the ones explicitly chosen (no Chennai default anywhere)', leaked.every((r: any) => explicit.has(r.name)) && !leaked.some((r: any) => r.birthCityName === 'Chennai'), leaked);

  await pool.query(`DELETE FROM "SavedPerson" WHERE "ownerUserId" = $1`, [user.id]);
}

main()
  .catch((e) => { console.error(e); allPassed = false; })
  .finally(async () => {
    await pool.end();
    if (!allPassed) { console.error('\nSOME MY PEOPLE R3 DB CHECKS FAILED'); process.exit(1); }
    console.log('\nALL MY PEOPLE R3 DB CHECKS PASSED');
    process.exit(0);
  });
