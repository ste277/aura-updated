/**
 * AURA-MP-1 R2 (62009) -- profile preservation (F1) and Gregorian database
 * integrity (F4) on a REAL disposable Postgres. Run (CI: day-constructor-acceptance-db-tests):
 *
 *   DATABASE_URL="postgresql://..." npx ts-node --project tsconfig.jsdom-tests.json test/myPeopleR2Db.test.ts
 *
 * F1: the REAL legacy People editor (jsdom) drives the REAL route handlers and
 *     database. For every operation the FULL persisted record is compared
 *     before and after (every column except updatedAt), and the actual PATCH
 *     payload is checked to contain only the intended changes (plus the full
 *     chart the all-or-none contract requires when a birth field is edited).
 *     Covered: name-only, relationship-only, no-change save, unlisted custom
 *     city, missing optional location, explicit birth edit, explicit location
 *     change, name-only person, notes/interests edits (API, enabled), explicit
 *     chart clearing (API: enabled clears; disabled refused), and the
 *     disabled -> enabled -> re-enabled states.
 * F4: direct SQL INSERT and UPDATE against PersonOccasion: NULL month / day,
 *     out-of-range and impossible dates are refused; valid dates, 29 Feb 2000
 *     and unknown-year dates (incl. 29 Feb) are accepted.
 */
import { React, mount, click, typeInto, act } from './jsdomReactHarness';
import { Pool } from 'pg';
import { createTestSessionToken, TEST_SESSION_COOKIE } from './authSessionTestSupport';

const db = require('../apps/web/lib/db');
const peopleRoute = require('../apps/web/app/api/people/route');
const personRoute = require('../apps/web/app/api/people/[personId]/route');
const { PeopleView } = require('../apps/web/components/PeopleView');

let allPassed = true;
function check(label: string, condition: boolean, detail?: unknown) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}${!condition && detail !== undefined ? ` -- ${JSON.stringify(detail).slice(0, 500)}` : ''}`);
  if (!condition) allPassed = false;
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let token = '';
const sent: Array<{ method: string; url: string; body: any; status: number }> = [];
const routeReq = (body: unknown, url: string): any => ({
  cookies: { get: (n: string) => (n === TEST_SESSION_COOKIE ? { value: token } : undefined) },
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
  if (method !== 'GET') sent.push({ method, url, body, status: res.status });
  return res;
};
const apiPatch = async (id: string, body: unknown) => {
  const res: Response = await personRoute.PATCH(routeReq(body, `/api/people/${id}`), { params: { personId: id } });
  return res.status;
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

const COLS = `name, "relationshipType", "birthDate", "birthTime", "birthTimezone", "birthCityName", "birthLatitude", "birthLongitude", "relationshipLabel", "locationName", timezone, interests, notes`;
const record = async (id: string) => (await pool.query(`SELECT ${COLS} FROM "SavedPerson" WHERE id = $1`, [id])).rows[0];
/** Columns whose values differ between two records. */
const changed = (a: any, b: any) => Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();

/** Opens the real editor for `name`, applies `edit`, saves; returns the requests the editor sent. */
async function editorSave(name: string, edit: (root: HTMLElement) => Promise<void>) {
  const h = await mount(React.createElement(PeopleView, { onBack: () => {} }));
  await settle();
  const root = h.container as HTMLElement;
  const view = buttons(root).filter((b) => b.textContent?.trim() === 'View').find((b) => b.closest('div')?.parentElement?.textContent?.includes(name));
  if (!view) throw new Error(`card not found: ${name}`);
  await click(view);
  await settle();
  await click(buttons(root).find((b) => b.textContent?.trim() === 'Edit')!);
  await settle();
  await edit(root);
  const n = sent.length;
  await submit(root.querySelector('form') as HTMLFormElement);
  await settle();
  const errorText = root.textContent ?? '';
  await h.unmount();
  return { requests: sent.slice(n), errorText };
}
/** Runs one editor operation and checks: exactly the expected columns changed, and the payload keys. */
async function op(label: string, id: string, cardName: string, edit: (root: HTMLElement) => Promise<void>, expectChanged: string[], expectPayloadKeys: string[] | null) {
  const before = await record(id);
  const { requests } = await editorSave(cardName, edit);
  const after = await record(id);
  const diff = changed(before, after);
  check(`${label}: persisted change is exactly [${expectChanged.join(', ')}]`, JSON.stringify(diff) === JSON.stringify([...expectChanged].sort()), { diff, before, after });
  if (expectPayloadKeys === null) {
    check(`${label}: the editor sent NO request`, requests.length === 0, requests);
  } else {
    const keys = Object.keys(requests[0]?.body ?? {}).sort();
    check(`${label}: payload keys are exactly [${expectPayloadKeys.join(', ')}] and the API returned 200`, requests.length === 1 && requests[0].status === 200 && JSON.stringify(keys) === JSON.stringify([...expectPayloadKeys].sort()), requests);
  }
  return { before, after, requests };
}

async function main() {
  const tag = `mp1r2-${Date.now()}`;
  const user = await db.upsertUserByEmail({ email: `${tag}@mp1.aura.local`, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
  token = await createTestSessionToken(user.id, user.email);
  process.env.NEXT_PUBLIC_AURA_MY_PEOPLE = '0';

  // Seed (enabled, so My People types and fields can exist).
  setServer(true);
  const custom = (await db.createSavedPerson(user.id, { name: 'Custom Parent', relationshipType: 'PARENT', birthDate: '1961-07-04', birthTime: '06:30', birthTimezone: 'America/Chicago', birthCityName: 'Naperville', birthLatitude: 41.7508, birthLongitude: -88.1535, notes: 'private note', interests: ['jazz'], relationshipLabel: 'Dad', locationName: 'Illinois', timezone: 'America/Chicago' })).id;
  const bare = (await db.createSavedPerson(user.id, { name: 'Bare Friend', relationshipType: 'FRIEND', birthDate: '1990-05-20', birthTime: '21:15', birthTimezone: 'America/Chicago' })).id;
  const listed = (await db.createSavedPerson(user.id, { name: 'Listed Sibling', relationshipType: 'SIBLING', birthDate: '1985-01-10', birthTime: '10:00', birthTimezone: 'Asia/Kolkata', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707 })).id;
  const nameOnly = (await db.createSavedPerson(user.id, { name: 'NameOnly Child', relationshipType: 'CHILD', notes: 'kid note' })).id;

  // ---------------- DISABLED ----------------
  setServer(false);
  await op('DISABLED name-only edit (custom city, Chicago)', custom, 'Custom Parent', (r) => typeInto(r.querySelector('#person-name') as HTMLInputElement, 'Custom Parent R'), ['name'], ['name']);
  await op('DISABLED relationship-only edit (FRIEND -> FAMILY, chart without location)', bare, 'Bare Friend', (r) => selectValue(r.querySelector('#person-relationship') as HTMLSelectElement, 'FAMILY'), ['relationshipType'], ['relationshipType']);
  await op('DISABLED save without changes (custom city)', custom, 'Custom Parent R', async () => {}, [], null);
  await op('DISABLED name edit, chart with NO optional location (stays absent)', bare, 'Bare Friend', (r) => typeInto(r.querySelector('#person-name') as HTMLInputElement, 'Bare Friend R'), ['name'], ['name']);
  const t = await op('DISABLED explicit birth-time edit keeps the ORIGINAL custom location', custom, 'Custom Parent R', (r) => typeInto(r.querySelector('#person-birth-time') as HTMLInputElement, '06:45'), ['birthTime'], ['birthDate', 'birthTime', 'birthTimezone', 'birthCityName', 'birthLatitude', 'birthLongitude']);
  check('DISABLED birth-time edit payload carries America/Chicago + Naperville + its coordinates (never a presentation default)', t.requests[0]?.body.birthTimezone === 'America/Chicago' && t.requests[0]?.body.birthCityName === 'Naperville' && t.requests[0]?.body.birthLatitude === 41.7508, t.requests[0]?.body);
  const nb = await op('DISABLED explicit birth-date edit on a chart with NO location keeps it absent', bare, 'Bare Friend R', (r) => typeInto(r.querySelector('#person-birth-date') as HTMLInputElement, '1990-05-21'), ['birthDate'], ['birthDate', 'birthTime', 'birthTimezone']);
  check('DISABLED no-location payload sends only the all-or-none trio (no city, no coordinates)', !('birthCityName' in (nb.requests[0]?.body ?? {})) && nb.requests[0]?.body.birthTimezone === 'America/Chicago');
  await op('DISABLED explicit location change (Chennai -> Mumbai)', listed, 'Listed Sibling', (r) => selectValue(r.querySelector('#person-birth-city') as HTMLSelectElement, 'Mumbai'), ['birthCityName', 'birthLatitude', 'birthLongitude'], ['birthDate', 'birthTime', 'birthTimezone', 'birthCityName', 'birthLatitude', 'birthLongitude']);
  await op('DISABLED name-only person rename', nameOnly, 'NameOnly Child', (r) => typeInto(r.querySelector('#person-name') as HTMLInputElement, 'NameOnly Child R'), ['name'], ['name']);
  {
    const before = await record(listed);
    const status = await apiPatch(listed, { chart: null });
    check('DISABLED explicit chart clearing (chart:null) is refused (400) and nothing changes', status === 400 && changed(before, await record(listed)).length === 0, status);
  }
  {
    const before = await record(custom);
    const { requests, errorText } = await editorSave('Custom Parent R', (r) => typeInto(r.querySelector('#person-birth-time') as HTMLInputElement, ''));
    check('DISABLED clearing only the birth time in the editor is refused client-side; nothing sent or changed', requests.length === 0 && changed(before, await record(custom)).length === 0 && /needed|both/.test(errorText), requests);
  }

  // ---------------- ENABLED ----------------
  setServer(true);
  await op('ENABLED name-only edit keeps chart, notes, interests, label, location, timezone', custom, 'Custom Parent R', (r) => typeInto(r.querySelector('#person-name') as HTMLInputElement, 'Custom Parent E'), ['name'], ['name']);
  await op('ENABLED save without changes', listed, 'Listed Sibling', async () => {}, [], null);
  {
    const before = await record(custom);
    const status = await apiPatch(custom, { notes: 'updated note', interests: ['jazz', 'chess'] });
    const after = await record(custom);
    check('ENABLED notes + interests edit (API) changes exactly [interests, notes]', status === 200 && JSON.stringify(changed(before, after)) === JSON.stringify(['interests', 'notes']), changed(before, after));
  }
  {
    const before = await record(listed);
    const status = await apiPatch(listed, { chart: null });
    const after = await record(listed);
    check('ENABLED explicit chart clearing (chart:null) clears exactly the six chart columns', status === 200 && JSON.stringify(changed(before, after)) === JSON.stringify(['birthCityName', 'birthDate', 'birthLatitude', 'birthLongitude', 'birthTime', 'birthTimezone']) && after.birthTimezone === null, changed(before, after));
  }

  // ---------------- RE-DISABLED, then RE-ENABLED ----------------
  setServer(false);
  await op('RE-DISABLED rename of a person whose chart was just cleared (no chart sent)', listed, 'Listed Sibling', (r) => typeInto(r.querySelector('#person-name') as HTMLInputElement, 'Listed Sibling R'), ['name'], ['name']);
  setServer(true);
  {
    const c = await record(custom);
    check('RE-ENABLED: custom person kept everything (Chicago, Naperville, coordinates, notes, interests, label, location, timezone)', c.birthTimezone === 'America/Chicago' && c.birthCityName === 'Naperville' && c.birthLatitude === 41.7508 && c.birthLongitude === -88.1535 && c.birthTime === '06:45' && c.notes === 'updated note' && JSON.stringify(c.interests) === '["jazz","chess"]' && c.relationshipLabel === 'Dad' && c.locationName === 'Illinois' && c.timezone === 'America/Chicago' && c.relationshipType === 'PARENT', c);
    const b = await record(bare);
    check('RE-ENABLED: no-location chart still has no city or coordinates', b.birthCityName === null && b.birthLatitude === null && b.birthLongitude === null && b.birthTimezone === 'America/Chicago', b);
    const n = await record(nameOnly);
    check('RE-ENABLED: name-only person still has no chart and kept its note', n.birthDate === null && n.notes === 'kid note' && n.relationshipType === 'CHILD', n);
  }

  // ---------------- F4: Gregorian integrity (direct SQL) ----------------
  const pid = custom;
  let seq = 0;
  const ins = async (month: number | null, day: number | null, year: number | null = null) => {
    try {
      await pool.query(`INSERT INTO "PersonOccasion" (id, "ownerUserId", "savedPersonId", kind, month, day, year) VALUES ($1, $2, $3, 'ANNIVERSARY', $4, $5, $6)`, [`${tag}-i${++seq}`, user.id, pid, month, day, year]);
      return 'OK';
    } catch (e: any) {
      return `${e.code}:${e.constraint ?? ''}`;
    }
  };
  const rejects: Array<[string, number | null, number | null, number | null]> = [
    ['NULL month', null, 5, null], ['NULL day', 5, null, null], ['NULL month and day', null, null, null],
    ['NULL month with a year', null, 5, 2000], ['month 0', 0, 5, null], ['month 13', 13, 5, null], ['day 0', 5, 0, null], ['day 32', 1, 32, null],
    ['31 April', 4, 31, null], ['30 February', 2, 30, null], ['29 February 1900', 2, 29, 1900], ['29 February 2023', 2, 29, 2023],
  ];
  for (const [label, m, d, y] of rejects) {
    const r = await ins(m, d, y);
    check(`F4 INSERT ${label} -> refused by PersonOccasion_gregorian_date_check`, r === '23514:PersonOccasion_gregorian_date_check', r);
  }
  const accepts: Array<[string, number, number, number | null]> = [
    ['15 June 2001', 6, 15, 2001], ['31 December 1999', 12, 31, 1999], ['29 February 2000', 2, 29, 2000], ['29 February 2024', 2, 29, 2024],
    ['29 February, unknown year', 2, 29, null], ['30 April, unknown year', 4, 30, null], ['1 January, unknown year', 1, 1, null],
  ];
  for (const [label, m, d, y] of accepts) {
    const r = await ins(m, d, y);
    check(`F4 INSERT ${label} -> accepted`, r === 'OK', r);
  }
  // UPDATE enforcement on an existing valid row.
  const okId = `${tag}-u`;
  await pool.query(`INSERT INTO "PersonOccasion" (id, "ownerUserId", "savedPersonId", kind, month, day) VALUES ($1, $2, $3, 'ANNIVERSARY', 3, 10)`, [okId, user.id, pid]);
  const upd = async (set: string) => {
    try { await pool.query(`UPDATE "PersonOccasion" SET ${set} WHERE id = $1`, [okId]); return 'OK'; } catch (e: any) { return `${e.code}:${e.constraint ?? ''}`; }
  };
  for (const [label, set] of [['month = NULL', 'month = NULL'], ['day = NULL', 'day = NULL'], ['month = NULL, day = NULL', 'month = NULL, day = NULL'], ['31 April', 'month = 4, day = 31'], ['30 February', 'month = 2, day = 30'], ['29 Feb 1900', 'month = 2, day = 29, year = 1900'], ['month 13', 'month = 13']]) {
    const r = await upd(set);
    check(`F4 UPDATE ${label} -> refused`, r === '23514:PersonOccasion_gregorian_date_check', r);
  }
  check('F4 UPDATE to 29 Feb 2000 -> accepted', (await upd('month = 2, day = 29, year = 2000')) === 'OK');
  check('F4 UPDATE to 29 Feb with unknown year -> accepted', (await upd('year = NULL')) === 'OK');
  const row = (await pool.query(`SELECT month, day, year FROM "PersonOccasion" WHERE id = $1`, [okId])).rows[0];
  check('F4 the row is intact after the refused UPDATEs (29 Feb, unknown year)', row.month === 2 && row.day === 29 && row.year === null, row);

  await pool.query(`DELETE FROM "SavedPerson" WHERE "ownerUserId" = $1`, [user.id]);
}

main()
  .catch((e) => { console.error(e); allPassed = false; })
  .finally(async () => {
    await pool.end();
    if (!allPassed) { console.error('\nSOME MY PEOPLE R2 DB CHECKS FAILED'); process.exit(1); }
    console.log('\nALL MY PEOPLE R2 DB CHECKS PASSED');
    process.exit(0);
  });
