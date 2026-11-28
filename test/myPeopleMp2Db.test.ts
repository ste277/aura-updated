/**
 * AURA-MP-2 (62016) -- My People journeys against the REAL People screen
 * (jsdom), the REAL MP-1 route handlers and a REAL disposable Postgres.
 * Run (CI: day-constructor-acceptance-db-tests):
 *
 *   DATABASE_URL="postgresql://..." npx ts-node --project tsconfig.jsdom-tests.json test/myPeopleMp2Db.test.ts
 *
 * Covers: overview (empty state, Coming up, ordering, reminders), Add / View
 * / Edit / Delete of people with the optional label and private note, the
 * explicit birthday copy from chart details (D3), birthdays / anniversaries /
 * other days with optional year and 29 February (D4), the in-app reminder
 * choices (D5), owner isolation, deletion cascade, and the feature switch
 * (server flag authoritative; public flag presentation only). Every write is
 * checked by exact payload, HTTP status and persisted row.
 */
import fs from 'fs';
import { React, mount, click, typeInto, act } from './jsdomReactHarness';
import { Pool } from 'pg';

const { createSessionToken } = require('../apps/web/lib/auth');
const db = require('../apps/web/lib/db');
const { getDatePartsInTimezone } = require('../apps/web/lib/timezone');
const peopleRoute = require('../apps/web/app/api/people/route');
const personRoute = require('../apps/web/app/api/people/[personId]/route');
const occasionsRoute = require('../apps/web/app/api/people/[personId]/occasions/route');
const occasionRoute = require('../apps/web/app/api/people/[personId]/occasions/[occasionId]/route');
const upcomingRoute = require('../apps/web/app/api/people/occasions/upcoming/route');
const { PeopleView } = require('../apps/web/components/PeopleView');

let allPassed = true;
let count = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  count++;
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}${!condition && detail !== undefined ? ` -- ${JSON.stringify(detail).slice(0, 600)}` : ''}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let token = '';
const sent: Array<{ method: string; url: string; body: any; status: number }> = [];
const routeReq = (body: unknown, url: string, as = token): any => ({
  cookies: { get: (n: string) => (n === 'as_session' ? { value: as } : undefined) },
  json: async () => body,
  headers: new Headers(),
  nextUrl: new URL(`http://localhost${url}`),
});
async function route(method: string, url: string, body?: unknown, as = token): Promise<Response> {
  const req = routeReq(body, url, as);
  const path = url.split('?')[0];
  if (path === '/api/cities/custom') return new Response('[]', { status: 200 });
  if (path === '/api/people') return method === 'POST' ? peopleRoute.POST(req) : peopleRoute.GET(req);
  if (path === '/api/people/occasions/upcoming') return upcomingRoute.GET(req);
  let m = /^\/api\/people\/([^/]+)\/occasions\/([^/]+)$/.exec(path);
  if (m) { const ctx = { params: { personId: m[1], occasionId: m[2] } }; return method === 'PATCH' ? occasionRoute.PATCH(req, ctx) : occasionRoute.DELETE(req, ctx); }
  m = /^\/api\/people\/([^/]+)\/occasions$/.exec(path);
  if (m) { const ctx = { params: { personId: m[1] } }; return method === 'POST' ? occasionsRoute.POST(req, ctx) : occasionsRoute.GET(req, ctx); }
  m = /^\/api\/people\/([^/]+)$/.exec(path);
  if (m) { const ctx = { params: { personId: m[1] } }; return method === 'PATCH' ? personRoute.PATCH(req, ctx) : method === 'DELETE' ? personRoute.DELETE(req, ctx) : personRoute.GET(req, ctx); }
  throw new Error(`unrouted ${method} ${url}`);
}
(global as any).fetch = async (url: string, init: any = {}) => {
  const method = init.method ?? 'GET';
  const body = init.body ? JSON.parse(init.body) : undefined;
  const res = await route(method, url, body);
  if (method !== 'GET') sent.push({ method, url, body, status: res.status });
  return res;
};

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const settle = async () => { for (let i = 0; i < 6; i++) await flush(); };
const buttons = (root: HTMLElement) => Array.from(root.querySelectorAll('button')) as HTMLButtonElement[];
const btn = (root: HTMLElement, re: RegExp) => buttons(root).find((b) => re.test(b.textContent?.trim() ?? ''));
const submit = async (form: HTMLFormElement) => { await act(async () => { form.dispatchEvent(new (window as any).Event('submit', { bubbles: true, cancelable: true })); }); await settle(); };
const selectValue = async (el: HTMLSelectElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new (window as any).Event('change', { bubbles: true })); });
};
const typeArea = async (el: HTMLTextAreaElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new (window as any).Event('input', { bubbles: true })); });
};
const setFlags = (server: boolean, presentation = true) => {
  if (server) process.env.AURA_MY_PEOPLE_ENABLED = '1'; else delete process.env.AURA_MY_PEOPLE_ENABLED;
  if (presentation) process.env.NEXT_PUBLIC_AURA_MY_PEOPLE = '1'; else delete process.env.NEXT_PUBLIC_AURA_MY_PEOPLE;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const since = (n: number) => sent.slice(n).map((r) => ({ method: r.method, url: r.url.replace(/[0-9a-f-]{36}/g, ':id'), body: r.body, status: r.status }));

/** Civil date arithmetic on the user's local today. */
function addDays(today: string, n: number) {
  const [y, m, d] = today.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

async function screen() {
  const h = await mount(React.createElement(PeopleView, { onBack: () => {} }));
  await settle();
  return { h, root: h.container as HTMLElement };
}
async function openPerson(root: HTMLElement, name: string) {
  const v = buttons(root).filter((b) => b.textContent?.trim() === 'View').find((b) => b.closest('div')?.parentElement?.textContent?.includes(name));
  if (!v) throw new Error(`card not found: ${name}`);
  await click(v);
  await settle();
}
const person = async (owner: string, name: string) => (await pool.query(`SELECT id, name, "relationshipType", "relationshipLabel", notes, "birthDate"::date::text AS "birthDate" FROM "SavedPerson" WHERE "ownerUserId" = $1 AND name = $2`, [owner, name])).rows[0] ?? null;
const occasionsOf = async (personId: string) => (await pool.query(`SELECT kind, label, month, day, year, "remindDaysBefore" FROM "PersonOccasion" WHERE "savedPersonId" = $1 ORDER BY kind, month, day`, [personId])).rows;

async function addPersonViaForm(root: HTMLElement, f: { name: string; relationship?: string; label?: string; notes?: string; date?: string; time?: string; timezone?: string; copyBirthday?: boolean }) {
  await click(btn(root, /^\+ Add person$/)!);
  await settle();
  await typeInto(root.querySelector('#person-name') as HTMLInputElement, f.name);
  if (f.relationship) await selectValue(root.querySelector('#person-relationship') as HTMLSelectElement, f.relationship);
  if (f.label !== undefined) await typeInto(root.querySelector('#person-relationship-label') as HTMLInputElement, f.label);
  if (f.notes !== undefined) await typeArea(root.querySelector('#person-notes') as HTMLTextAreaElement, f.notes);
  if (f.date) await typeInto(root.querySelector('#person-birth-date') as HTMLInputElement, f.date);
  if (f.time) await typeInto(root.querySelector('#person-birth-time') as HTMLInputElement, f.time);
  if (f.timezone) await selectValue(root.querySelector('#person-birth-timezone') as HTMLSelectElement, f.timezone);
  const offer = root.querySelector('#person-copy-birthday') as HTMLInputElement | null;
  const offered = { present: Boolean(offer), checkedByDefault: offer?.checked ?? null };
  if (f.copyBirthday && offer) await click(offer as unknown as HTMLElement);
  await submit(root.querySelector('form') as HTMLFormElement);
  return offered;
}

type DayForm = { kind?: string; label?: string; day?: string; month?: string; year?: string; reminder?: string };
async function fillDay(root: HTMLElement, prefix: string, f: DayForm) {
  const q = (id: string) => root.querySelector(`#${prefix}-${id}`);
  if (f.kind) await selectValue(q('kind') as HTMLSelectElement, f.kind);
  await settle();
  if (f.label !== undefined) await typeInto(q('label') as HTMLInputElement, f.label);
  if (f.day !== undefined) await selectValue(q('day') as HTMLSelectElement, f.day);
  if (f.month !== undefined) await selectValue(q('month') as HTMLSelectElement, f.month);
  if (f.year !== undefined) await typeInto(q('year') as HTMLInputElement, f.year);
  if (f.reminder !== undefined) await selectValue(q('reminder') as HTMLSelectElement, f.reminder);
}
async function addDay(root: HTMLElement, f: DayForm) {
  await click(btn(root, /^\+ Add a special day$/)!);
  await settle();
  await fillDay(root, 'occasion-new', f);
  const n = sent.length;
  await submit(root.querySelector('[data-testid="occasion-form"]') as HTMLFormElement);
  return { requests: since(n), text: root.textContent ?? '' };
}

async function main() {
  const tag = `mp2-${Date.now()}`;
  const user = await db.upsertUserByEmail({ email: `${tag}@mp2.aura.local`, cityName: 'Chennai', latitude: 13.08, longitude: 80.27, timezone: TZ });
  const other = await db.upsertUserByEmail({ email: `${tag}-other@mp2.aura.local`, cityName: 'Chennai', latitude: 13.08, longitude: 80.27, timezone: TZ });
  token = createSessionToken(user.id, user.email);
  const otherToken = createSessionToken(other.id, other.email);
  const today = getDatePartsInTimezone(TZ, new Date()).dateStr as string;
  const thisYear = Number(today.slice(0, 4));
  const in3 = addDays(today, 3);
  const in20 = addDays(today, 20);
  const in45 = addDays(today, 45);
  const pad = (n: number) => String(n).padStart(2, '0');

  // ================= ENABLED (server flag on, presentation flag on) =================
  setFlags(true);
  {
    const { h, root } = await screen();
    const text = root.textContent ?? '';
    check('Overview: title "My People" and the approved empty state; no Coming up section when nothing is upcoming', /My People/.test(text) && /Keep the people who matter close/.test(text) && !root.querySelector('[data-testid="my-people-coming-up"]'), text.slice(0, 300));

    // ---- Add: name + relationship + custom label + private note (no chart) ----
    let n = sent.length;
    const offer0 = await addPersonViaForm(root, { name: 'Amma', relationship: 'PARENT', label: '  Amma  ', notes: 'Prefers calls after 7 pm.' });
    let reqs = since(n);
    let row = await person(user.id, 'Amma');
    check('Add: name, Parent, custom label and private note -> payload exactly {name, relationshipType, relationshipLabel (trimmed), notes}, 201, persisted', reqs.length === 1 && reqs[0].status === 201 && same(reqs[0].body, { name: 'Amma', relationshipType: 'PARENT', relationshipLabel: 'Amma', notes: 'Prefers calls after 7 pm.' }) && row?.relationshipLabel === 'Amma' && row?.notes === 'Prefers calls after 7 pm.' && row?.birthDate === null, { reqs, row });
    check('Add: no birthday copy offered without a chart birth date', offer0.present === false);

    // ---- Add: name only, everything untouched ----
    n = sent.length;
    await addPersonViaForm(root, { name: 'Meera' });
    reqs = since(n);
    row = await person(user.id, 'Meera');
    check('Add: name only -> payload exactly {name}; API default OTHER; no label, note, chart or special day', reqs.length === 1 && same(reqs[0].body, { name: 'Meera' }) && row?.relationshipType === 'OTHER' && row.relationshipLabel === null && row.notes === null && (await occasionsOf(row.id)).length === 0, { reqs, row });

    // ---- Add: chart birth date, copy NOT chosen (D3: never silent) ----
    const chartDate3 = `1988-${pad(in3.month)}-${pad(in3.day)}`;
    n = sent.length;
    const offer1 = await addPersonViaForm(root, { name: 'Priya', relationship: 'FRIEND', date: chartDate3, time: '06:30', timezone: TZ });
    reqs = since(n);
    row = await person(user.id, 'Priya');
    check('Add with chart details: the birthday copy is OFFERED, UNCHECKED by default; left unchecked -> only the person is created, no special day', offer1.present && offer1.checkedByDefault === false && reqs.length === 1 && reqs[0].url === '/api/people' && (await occasionsOf(row.id)).length === 0, { offer1, reqs });

    // ---- Add: chart birth date, copy chosen explicitly ----
    n = sent.length;
    await addPersonViaForm(root, { name: 'Ravi', relationship: 'FRIEND', label: 'Best friend', date: chartDate3, time: '06:30', timezone: TZ, copyBirthday: true });
    reqs = since(n);
    const ravi = await person(user.id, 'Ravi');
    const raviDays = await occasionsOf(ravi.id);
    check('Add with chart details + explicit "Also remember their birthday" -> person 201, then POST occasion exactly {kind BIRTHDAY, month, day, year from the chart} 201', reqs.length === 2 && reqs[0].status === 201 && reqs[1].url === '/api/people/:id/occasions' && reqs[1].status === 201 && same(reqs[1].body, { kind: 'BIRTHDAY', month: in3.month, day: in3.day, year: 1988 }) && same(raviDays, [{ kind: 'BIRTHDAY', label: null, month: in3.month, day: in3.day, year: 1988, remindDaysBefore: 7 }]), { reqs, raviDays });
    await h.unmount();
  }

  // ---- Person detail: special days ----
  const ravi = await person(user.id, 'Ravi');
  {
    const { h, root } = await screen();
    const coming = root.querySelector('[data-testid="my-people-coming-up"]');
    const comingText = coming?.textContent ?? '';
    check('Overview: Coming up shows Ravi\'s birthday in 3 days with "Turns N" and the in-app reminder marker (inside the 7-day window)', Boolean(coming) && /Ravi's birthday/.test(comingText) && /In 3 days/.test(comingText) && new RegExp(`Turns ${in3.year - 1988}`).test(comingText) && /Soon/.test(comingText), comingText);
    check('Overview: people list shows initial avatar, "Friend · Best friend" and the next special day', /Friend · Best friend/.test(root.textContent ?? '') && /Birthday · .* In 3 days/.test(root.textContent ?? ''));
    await openPerson(root, 'Ravi');
    let text = root.textContent ?? '';
    check('Detail: name, "Friend · Best friend", Special days with the birthday (saved year shown), countdown, age and reminder choice', /Friend · Best friend/.test(text) && /Special days/.test(text) && new RegExp(`Birthday · ${in3.day} \\w+ 1988`).test(text) && /In 3 days/.test(text) && /Reminder a week before and on the day/.test(text), text.slice(0, 600));
    check('Detail: "Birthday" is not offered again for a person who already has one (one per person)', await (async () => { await click(btn(root, /^\+ Add a special day$/)!); await settle(); const kinds = Array.from((root.querySelector('#occasion-new-kind') as HTMLSelectElement).options).map((o) => o.value); await click(btn(root, /^Cancel$/)!); await settle(); return same(kinds, ['ANNIVERSARY', 'OTHER']); })());

    // anniversary without a year, reminder untouched
    let r = await addDay(root, { kind: 'ANNIVERSARY', day: String(in20.day), month: String(in20.month) });
    let days = await occasionsOf(ravi.id);
    check('Add anniversary without a year, reminder untouched -> payload exactly {kind, month, day}; persisted remindDaysBefore 7 (API default, D5); no age/count shown', r.requests.length === 1 && r.requests[0].status === 201 && same(r.requests[0].body, { kind: 'ANNIVERSARY', month: in20.month, day: in20.day }) && days.some((d: any) => d.kind === 'ANNIVERSARY' && d.year === null && d.remindDaysBefore === 7) && !/anniversary ·.*\d+(st|nd|rd|th) anniversary/.test(r.text), { r, days });

    // other date without a name -> refused, no request
    r = await addDay(root, { kind: 'OTHER', day: '10', month: '6' });
    check('Add "Another important date" without a name -> refused before any request, with a message', r.requests.length === 0 && /Give this day a name/.test(r.text), r.requests);
    await click(btn(root, /^Cancel$/)!); await settle();
    r = await addDay(root, { kind: 'OTHER', label: 'Graduation', day: String(in45.day), month: String(in45.month), reminder: 'off' });
    days = await occasionsOf(ravi.id);
    check('Add other date with a name and "No reminder" -> payload {kind, month, day, label, remindDaysBefore: null}, 201, persisted', r.requests.length === 1 && r.requests[0].status === 201 && same(r.requests[0].body, { kind: 'OTHER', month: in45.month, day: in45.day, label: 'Graduation', remindDaysBefore: null }) && days.some((d: any) => d.kind === 'OTHER' && d.label === 'Graduation' && d.remindDaysBefore === null), r.requests);
    await h.unmount();
  }

  // ---- 29 February (D4) on Meera ----
  const meera = await person(user.id, 'Meera');
  {
    const { h, root } = await screen();
    await openPerson(root, 'Meera');
    check('Detail with no special days: an inviting prompt, and no chart-copy button (no chart details)', /Add Meera's birthday or another date that matters/.test(root.textContent ?? ''));
    let r = await addDay(root, { kind: 'BIRTHDAY', day: '29', month: '2', year: '2001' });
    check('29 February 2001 -> refused before any request ("wasn\'t a leap year")', r.requests.length === 0 && /2001 wasn't a leap year/.test(r.text), r.requests);
    check('29 February: the form explains it is marked on 28 February in other years', /marks it on 28 February/.test(r.text));
    await fillDay(root, 'occasion-new', { year: '2000' });
    const n = sent.length;
    await submit(root.querySelector('[data-testid="occasion-form"]') as HTMLFormElement);
    const reqs = since(n);
    const days = await occasionsOf(meera.id);
    const text = root.textContent ?? '';
    const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    check('29 February 2000 (leap) -> 201, persisted 2/29/2000; shown as "29 February 2000"', reqs.length === 1 && reqs[0].status === 201 && same(reqs[0].body, { kind: 'BIRTHDAY', month: 2, day: 29, year: 2000 }) && same(days[0], { kind: 'BIRTHDAY', label: null, month: 2, day: 29, year: 2000, remindDaysBefore: 7 }) && /Birthday · 29 February 2000/.test(text), { reqs, days });
    const next = (await (await route('GET', `/api/people/${meera.id}/occasions`)).json())[0].next;
    const nextYear = Number(next.date.slice(0, 4));
    check('29 February next occurrence follows D4 (28 Feb in a non-leap year, flagged and labelled "(for 29 Feb)")', leap(nextYear) ? next.date.endsWith('-02-29') && !next.observedFromLeapDay : next.date.endsWith('-02-28') && next.observedFromLeapDay && /\(for 29 Feb\)/.test(text), { next });

    // edit: clear the year, then reminder "on the day only", then no change
    const occ = (await (await route('GET', `/api/people/${meera.id}/occasions`)).json())[0];
    const editPrefix = `occasion-${occ.id}`;
    const editDay = async (f: DayForm) => {
      await click(btn(root, /^Edit day$/)!); await settle();
      await fillDay(root, editPrefix, f);
      const k = sent.length;
      await submit(root.querySelector('[data-testid="occasion-form"]') as HTMLFormElement);
      return since(k);
    };
    let e = await editDay({ year: '' });
    check('Edit special day: clear the year -> PATCH exactly {year: null}, 200; persisted year NULL, still 29 Feb (optional year)', e.length === 1 && e[0].method === 'PATCH' && e[0].status === 200 && same(e[0].body, { year: null }) && same((await occasionsOf(meera.id))[0], { kind: 'BIRTHDAY', label: null, month: 2, day: 29, year: null, remindDaysBefore: 7 }), e);
    e = await editDay({ reminder: '0' });
    check('Edit special day: reminder "On the day only" -> PATCH exactly {remindDaysBefore: 0}', e.length === 1 && e[0].status === 200 && same(e[0].body, { remindDaysBefore: 0 }) && (await occasionsOf(meera.id))[0].remindDaysBefore === 0, e);
    e = await editDay({});
    check('Edit special day: save without changes -> no request', e.length === 0, e);
    check('Detail shows the saved reminder choice "Reminder on the day"', /Reminder on the day/.test(root.textContent ?? ''));
    // remove the day
    await click(btn(root, /^Remove day$/)!); await settle();
    const k = sent.length;
    await click(btn(root, /^Yes, remove day$/)!); await settle();
    const del = since(k);
    check('Remove special day (confirmed) -> DELETE 200; row gone; person kept', del.length === 1 && del[0].method === 'DELETE' && del[0].status === 200 && (await occasionsOf(meera.id)).length === 0 && Boolean(await person(user.id, 'Meera')), del);
    await h.unmount();
  }

  // ---- Upcoming ordering and reminder windows (API data shown as-is) ----
  await route('POST', `/api/people/${meera.id}/occasions`, { kind: 'BIRTHDAY', month: in20.month, day: in20.day, remindDaysBefore: 30 });
  {
    const { h, root } = await screen();
    const items = Array.from(root.querySelectorAll('[data-testid="coming-up-item"]')).map((el) => el.textContent ?? '');
    check('Coming up: chronological (3 days before 20 days), only within 30 days (Graduation at 45 days absent)', items.length === 3 && /Ravi's birthday/.test(items[0]) && /In 20 days/.test(items[1]) && /In 20 days/.test(items[2]) && !items.some((t) => /Graduation/.test(t)), items);
    const meeraItem = items.find((t) => /Meera/.test(t)) ?? '';
    const annivItem = items.find((t) => /anniversary/.test(t)) ?? '';
    check('Coming up: reminder marker follows each day\'s own window (Meera 30-day window -> marked; anniversary 7-day default at 20 days -> not marked)', /Soon/.test(meeraItem) && !/Soon/.test(annivItem), { meeraItem, annivItem });

    // ---- Edit person: label only; clear note; no change ----
    const amma = await person(user.id, 'Amma');
    const editPerson = async (f: { label?: string; notes?: string }) => {
      await openPerson(root, 'Amma');
      await click(btn(root, /^Edit$/)!); await settle();
      if (f.label !== undefined) await typeInto(root.querySelector('#person-relationship-label') as HTMLInputElement, f.label);
      if (f.notes !== undefined) await typeArea(root.querySelector('#person-notes') as HTMLTextAreaElement, f.notes);
      const k = sent.length;
      await submit(root.querySelector('form') as HTMLFormElement);
      const out = since(k);
      await click(btn(root, /My People/)!); await settle();
      return out;
    };
    let e = await editPerson({ label: 'Amma (Chennai)' });
    check('Edit person: change only the custom label -> PATCH exactly {relationshipLabel}, 200; note and relationship unchanged', e.length === 1 && e[0].status === 200 && same(e[0].body, { relationshipLabel: 'Amma (Chennai)' }) && same(await person(user.id, 'Amma'), { ...amma, relationshipLabel: 'Amma (Chennai)' }), e);
    e = await editPerson({ notes: '' });
    check('Edit person: clear the private note -> PATCH exactly {notes: null}; persisted NULL', e.length === 1 && same(e[0].body, { notes: null }) && (await person(user.id, 'Amma')).notes === null, e);
    e = await editPerson({});
    check('Edit person: save without changes -> no request', e.length === 0, e);
    await h.unmount();
  }

  // ---- Owner isolation ----
  {
    const otherGet = await route('GET', `/api/people/${ravi.id}`, undefined, otherToken);
    const otherDays = await route('GET', `/api/people/${ravi.id}/occasions`, undefined, otherToken);
    const otherAdd = await route('POST', `/api/people/${ravi.id}/occasions`, { kind: 'ANNIVERSARY', month: 1, day: 1 }, otherToken);
    const raviOcc = (await (await route('GET', `/api/people/${ravi.id}/occasions`)).json())[0];
    const otherEdit = await route('PATCH', `/api/people/${ravi.id}/occasions/${raviOcc.id}`, { day: 1 }, otherToken);
    const otherDel = await route('DELETE', `/api/people/${ravi.id}/occasions/${raviOcc.id}`, undefined, otherToken);
    const otherList = await (await route('GET', '/api/people', undefined, otherToken)).json();
    const otherUpcoming = await (await route('GET', '/api/people/occasions/upcoming?days=60', undefined, otherToken)).json();
    check('Isolation: another account gets 404 for the person, its special days, and add/edit/delete of them; sees no people and no upcoming days', [otherGet, otherDays, otherAdd, otherEdit, otherDel].every((r) => r.status === 404) && otherList.length === 0 && otherUpcoming.length === 0, [otherGet, otherDays, otherAdd, otherEdit, otherDel].map((r) => r.status));
    check('Isolation: the owner\'s special days are untouched by those attempts', (await occasionsOf(ravi.id)).length === 3);
    const list = await (await route('GET', '/api/people')).json();
    check('Privacy: the list response carries no notes or birth fields (MP-1 list contract)', list.every((p: any) => !('notes' in p) && !('birthDate' in p) && !('ownerUserId' in p)));
  }

  // ---- Delete person: confirmation copy, cascade ----
  {
    const { h, root } = await screen();
    await openPerson(root, 'Ravi');
    await click(btn(root, /^Remove Ravi/)!); await settle();
    const confirm = root.textContent ?? '';
    const k = sent.length;
    await click(btn(root, /^Yes, remove$/)!); await settle();
    const del = since(k);
    const left = (await pool.query(`SELECT count(*)::int AS n FROM "PersonOccasion" WHERE "savedPersonId" = $1`, [ravi.id])).rows[0].n;
    check('Delete person: confirmation says special days and notes go and plans stay; DELETE 200; person and all 3 special days removed', /special days will be deleted/.test(confirm) && /plans stay in your calendar/.test(confirm) && del.length === 1 && del[0].status === 200 && !(await person(user.id, 'Ravi')) && left === 0, { del, left });
    check('Delete person: returns to the overview, Ravi gone from people and Coming up', !/Ravi/.test(root.textContent ?? '') && /People/.test(root.textContent ?? ''));
    await h.unmount();
  }

  // ================= DISABLED (server off; public flag still on) =================
  setFlags(false);
  {
    const { h, root } = await screen();
    const text = root.textContent ?? '';
    check('Server OFF: legacy "People" screen -- no "My People" title, no Coming up, no custom label in the list', /People/.test(text) && !/My People/.test(text) && !root.querySelector('[data-testid="my-people-coming-up"]') && !/Amma \(Chennai\)/.test(text), text.slice(0, 300));
    await openPerson(root, 'Meera');
    check('Server OFF: detail has no Special days or private note sections', !/Special days/.test(root.textContent ?? '') && !root.querySelector('[data-testid="person-notes"]'));
    await click(btn(root, /^Edit$/)!); await settle();
    check('Server OFF: the form has no custom label, note or birthday-copy controls', !root.querySelector('#person-relationship-label') && !root.querySelector('#person-notes') && !root.querySelector('#person-copy-birthday'));
    await h.unmount();
    const up = await route('GET', '/api/people/occasions/upcoming');
    const days = await route('GET', `/api/people/${meera.id}/occasions`);
    check('Server OFF: occasion and upcoming APIs answer 404; rows are kept', up.status === 404 && days.status === 404 && (await occasionsOf(meera.id)).length === 1);
  }
  // Server on, presentation flag off -> still the legacy UI (public flag can only hide).
  setFlags(true, false);
  {
    const { h, root } = await screen();
    check('Server ON, public flag OFF: legacy UI (no My People title or Coming up)', !/My People/.test(root.textContent ?? '') && !root.querySelector('[data-testid="my-people-coming-up"]'));
    await h.unmount();
  }
  // Re-enabled: everything is back unchanged.
  setFlags(true);
  {
    const { h, root } = await screen();
    check('Re-enabled: Coming up and the custom label are back unchanged', Boolean(root.querySelector('[data-testid="my-people-coming-up"]')) && /Amma \(Chennai\)/.test(root.textContent ?? ''));
    await h.unmount();
  }

  // ---- You entry point (D10): renamed only where the presentation flag is on ----
  const you = fs.readFileSync('apps/web/components/YouView.tsx', 'utf8');
  check('You: the row reads "My People" only behind isMyPeoplePresentationEnabled(); the legacy "People" row is kept otherwise; no new navigation tab', /isMyPeoplePresentationEnabled\(\) \?/.test(you) && /title="My People"/.test(you) && /title="People" detail="Manage the people you plan with"/.test(you));

  await pool.query(`DELETE FROM "SavedPerson" WHERE "ownerUserId" = ANY($1)`, [[user.id, other.id]]);
  console.log(allPassed ? `\nALL MY PEOPLE MP-2 DB CHECKS PASSED (${count})` : '\nSOME MY PEOPLE MP-2 DB CHECKS FAILED');
}

main()
  .catch((e) => { console.error(e); allPassed = false; })
  .finally(async () => { await pool.end(); await db.closeDbPool?.(); process.exit(allPassed ? 0 : 1); });
