/**
 * AURA-MP-3 (62018) -- linked plans and Home guidance against the REAL
 * route handlers, the REAL Home card / People screen (jsdom) and a REAL
 * disposable Postgres. Run (CI: day-constructor-acceptance-db-tests):
 *
 *   DATABASE_URL="postgresql://..." npx ts-node --project tsconfig.jsdom-tests.json test/myPeopleMp3Db.test.ts
 *
 * Covers: the Home card (one card, reminder windows, "Not now" / "Not this
 * year", "+N more", no private data), the dismissal route (switch, auth,
 * scope, ownership, surfaced-only, server-derived key, idempotency),
 * POST /api/plans savedPersonId (owner-validated 404, ignored while off),
 * Move keeping the link (owner-checked), person deletion (plans kept, links
 * and dismissals removed), My People -> Plan hand-offs and the switch.
 */
import { React, mount, click, act } from './jsdomReactHarness';
import { Pool } from 'pg';

// AURA-AUTH-SESSION-01-I2: real database-backed v2 sessions (the v1 token API was removed).
const { createTestSessionToken, TEST_SESSION_COOKIE } = require('./authSessionTestSupport');
const db = require('../apps/web/lib/db');
const { getDatePartsInTimezone } = require('../apps/web/lib/timezone');
const { occasionDismissalKeys } = require('../apps/web/lib/personOccasions');
const peopleRoute = require('../apps/web/app/api/people/route');
const personRoute = require('../apps/web/app/api/people/[personId]/route');
const occasionsRoute = require('../apps/web/app/api/people/[personId]/occasions/route');
const occasionRoute = require('../apps/web/app/api/people/[personId]/occasions/[occasionId]/route');
const upcomingRoute = require('../apps/web/app/api/people/occasions/upcoming/route');
const dismissalRoute = require('../apps/web/app/api/people/occasions/[occasionId]/dismissal/route');
const plansRoute = require('../apps/web/app/api/plans/route');
const moveRoute = require('../apps/web/app/api/plans/[planId]/move/route');
const { MyPeopleHomeCard } = require('../apps/web/components/MyPeopleHomeCard');
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
const req = (body: unknown, url: string, as: string | null = token): any => ({
  cookies: { get: (n: string) => (n === TEST_SESSION_COOKIE && as ? { value: as } : undefined) },
  json: async () => body,
  headers: new Headers(),
  nextUrl: new URL(`http://localhost${url}`),
});
async function route(method: string, url: string, body?: unknown, as: string | null = token): Promise<Response> {
  const r = req(body, url, as);
  const path = url.split('?')[0];
  let m: RegExpExecArray | null;
  if (path === '/api/people') return method === 'POST' ? peopleRoute.POST(r) : peopleRoute.GET(r);
  if (path === '/api/people/occasions/upcoming') return upcomingRoute.GET(r);
  if ((m = /^\/api\/people\/occasions\/([^/]+)\/dismissal$/.exec(path))) return dismissalRoute.POST(r, { params: { occasionId: m[1] } });
  if ((m = /^\/api\/people\/([^/]+)\/occasions\/([^/]+)$/.exec(path))) { const c = { params: { personId: m[1], occasionId: m[2] } }; return method === 'PATCH' ? occasionRoute.PATCH(r, c) : occasionRoute.DELETE(r, c); }
  if ((m = /^\/api\/people\/([^/]+)\/occasions$/.exec(path))) { const c = { params: { personId: m[1] } }; return method === 'POST' ? occasionsRoute.POST(r, c) : occasionsRoute.GET(r, c); }
  if ((m = /^\/api\/people\/([^/]+)$/.exec(path))) { const c = { params: { personId: m[1] } }; return method === 'PATCH' ? personRoute.PATCH(r, c) : method === 'DELETE' ? personRoute.DELETE(r, c) : personRoute.GET(r, c); }
  if (path === '/api/plans') return method === 'POST' ? plansRoute.POST(r) : plansRoute.GET(r);
  if ((m = /^\/api\/plans\/([^/]+)\/move$/.exec(path))) return moveRoute.POST(r, { params: { planId: m[1] } });
  if (path === '/api/cities/custom') return new Response('[]', { status: 200 });
  throw new Error(`unrouted ${method} ${url}`);
}
const fetched: string[] = [];
(global as any).fetch = async (url: string, init: any = {}) => {
  fetched.push(`${init.method ?? 'GET'} ${url}`);
  return route(init.method ?? 'GET', url, init.body ? JSON.parse(init.body) : undefined);
};
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const settle = async () => { for (let i = 0; i < 6; i++) await flush(); };
const btn = (root: HTMLElement, re: RegExp) => Array.from(root.querySelectorAll('button')).find((b) => re.test(b.textContent?.trim() ?? '')) as HTMLButtonElement | undefined;
const setFlags = (server: boolean, presentation = true) => {
  if (server) process.env.AURA_MY_PEOPLE_ENABLED = '1'; else delete process.env.AURA_MY_PEOPLE_ENABLED;
  if (presentation) process.env.NEXT_PUBLIC_AURA_MY_PEOPLE = '1'; else delete process.env.NEXT_PUBLIC_AURA_MY_PEOPLE;
};
function addDays(today: string, n: number) {
  const [y, m, d] = today.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate(), date: t.toISOString().slice(0, 10) };
}
const dismissals = async (occasionId: string) => (await pool.query(`SELECT "reminderAt" FROM "ReminderAttention" WHERE "scheduledItemType" = 'PERSON_OCCASION' AND "scheduledItemId" = $1 ORDER BY "reminderAt"`, [occasionId])).rows.map((r: any) => new Date(r.reminderAt).toISOString());
const planRow = async (id: string) => (await pool.query(`SELECT id, title, status, "savedPersonId", "rescheduledFromPlanId" FROM "PlannedActivity" WHERE id = $1`, [id])).rows[0] ?? null;

async function main() {
  const tag = `mp3-${Date.now()}`;
  const user = await db.upsertUserByEmail({ email: `${tag}@mp3.aura.local`, cityName: 'Chennai', latitude: 13.08, longitude: 80.27, timezone: TZ });
  const other = await db.upsertUserByEmail({ email: `${tag}-o@mp3.aura.local`, cityName: 'Chennai', latitude: 13.08, longitude: 80.27, timezone: TZ });
  token = await createTestSessionToken(user.id, user.email);
  const otherToken = await createTestSessionToken(other.id, other.email);
  const today = getDatePartsInTimezone(TZ, new Date()).dateStr as string;
  const d0 = addDays(today, 0), d3 = addDays(today, 3), d20 = addDays(today, 20), d5 = addDays(today, 5), d2 = addDays(today, 2);

  setFlags(true);
  const mk = async (body: any, as = token) => (await (await route('POST', '/api/people', body, as)).json()).id as string;
  const day = async (pid: string, body: any, as = token) => (await (await route('POST', `/api/people/${pid}/occasions`, body, as)).json()).id as string;
  const ravi = await mk({ name: 'Ravi', relationshipType: 'FRIEND', notes: 'SECRET-NOTE-xyz' });
  const meera = await mk({ name: 'Meera' });
  const zed = await mk({ name: 'Zed' }, otherToken);
  const annivToday = await day(ravi, { kind: 'ANNIVERSARY', month: d0.month, day: d0.day });
  const bday3 = await day(ravi, { kind: 'BIRTHDAY', month: d3.month, day: d3.day, year: 1990 });
  const other20 = await day(ravi, { kind: 'OTHER', label: 'Graduation', month: d20.month, day: d20.day });
  const meeraOff = await day(meera, { kind: 'BIRTHDAY', month: d5.month, day: d5.day, remindDaysBefore: null });
  const zedDay = await day(zed, { kind: 'BIRTHDAY', month: d2.month, day: d2.day }, otherToken);

  // ---------------- Home card (real component, real routes) ----------------
  const planned: any[] = [];
  let openedPeople = 0;
  {
    const h = await mount(React.createElement(MyPeopleHomeCard, { onPlan: (x: any) => planned.push(x), onOpenMyPeople: () => openedPeople++ }));
    await settle();
    const root = h.container as HTMLElement;
    const text = root.textContent ?? '';
    const cards = root.querySelectorAll('[data-testid="my-people-home-card"]').length;
    check('Home: exactly ONE card, the soonest surfaced day (Ravi\'s anniversary today), "+1 more" for the birthday in 3 days', cards === 1 && /Ravi's anniversary is today/.test(text) && /\+1 more/.test(text), text);
    check('Home: days outside their window are not shown (Graduation in 20 days; Meera with no reminder)', !/Graduation|Meera/.test(text));
    check('Home: no private note, chart detail or score in the card', !/SECRET-NOTE|natal|score|streak/i.test(text));
    check('Home: on the day there is no "Not now" (it would repeat); "Not this year" is offered', !btn(root, /^Not now$/) && Boolean(btn(root, /^Not this year$/)));
    await click(btn(root, /^Plan something$/)!);
    check('Home "Plan something" hands off to Plan (person, anniversary-dinner, window starting today) -- nothing saved', planned.length === 1 && planned[0].personId === ravi && planned[0].activityId === 'anniversary-dinner' && planned[0].startDate === today && planned[0].endDate === addDays(today, 1).date && !fetched.some((f) => f.startsWith('POST /api/plans')), planned[0]);
    await click(btn(root, /^\+1 more$/)!);
    check('Home "+N more" opens My People', openedPeople === 1);

    await click(btn(root, /^Not this year$/)!); await settle();
    const t2 = root.textContent ?? '';
    check('Home "Not this year" (on the day) -> one dismissal at the occurrence date; the next day (birthday in 3 days) is shown instead', same(await dismissals(annivToday), [occasionDismissalKeys(d0.date).yearKey]) && /Ravi's birthday is in 3 days/.test(t2) && /Turns /.test(t2), t2);
    check('Home: ahead of the day, "Not now" is offered', Boolean(btn(root, /^Not now$/)));
    await click(btn(root, /^Not now$/)!); await settle();
    check('Home "Not now" (ahead) -> the ahead key only; no card left (nothing repeats)', same(await dismissals(bday3), [occasionDismissalKeys(d3.date).aheadKey]) && root.querySelectorAll('[data-testid="my-people-home-card"]').length === 0);
    await h.unmount();
  }
  {
    const up = await (await route('GET', '/api/people/occasions/upcoming?days=30')).json();
    const byId = new Map(up.map((u: any) => [u.occasionId, u]));
    check('Upcoming API: dismissed flags (anniversary: Not this year; birthday: Not now) and the rest untouched', (byId.get(annivToday) as any)?.dismissed === true && (byId.get(bday3) as any)?.dismissed === true && (byId.get(other20) as any)?.dismissed === false && (byId.get(meeraOff) as any)?.dismissed === false);
    check('Upcoming API: never carries notes', !JSON.stringify(up).includes('SECRET-NOTE'));
    check('Dismissal never changes the special day itself', (await (await route('GET', `/api/people/${ravi}/occasions`)).json()).length === 3);
  }

  // ---------------- dismissal route contract ----------------
  {
    const st = async (id: string, body: any, as: string | null = token) => (await route('POST', `/api/people/occasions/${id}/dismissal`, body, as)).status;
    check('dismissal: no session -> 401', (await st(bday3, { scope: 'NOT_NOW' }, null)) === 401);
    check('dismissal: unknown scope / missing body -> 400', (await st(bday3, { scope: 'FOREVER' })) === 400 && (await st(bday3, {})) === 400);
    check('dismissal: another owner\'s special day -> 404, nothing written', (await st(zedDay, { scope: 'NOT_THIS_YEAR' })) === 404 && (await dismissals(zedDay)).length === 0);
    check('dismissal: unknown id -> 404', (await st('00000000-0000-0000-0000-000000000000', { scope: 'NOT_NOW' })) === 404);
    check('dismissal: a day outside its reminder window -> 409, nothing written (20 days; reminder off)', (await st(other20, { scope: 'NOT_NOW' })) === 409 && (await st(meeraOff, { scope: 'NOT_THIS_YEAR' })) === 409 && (await dismissals(other20)).length === 0 && (await dismissals(meeraOff)).length === 0);
    check('dismissal: a client-supplied date is ignored (key derived on the server)', (await st(bday3, { scope: 'NOT_THIS_YEAR', date: '1999-01-01', reminderAt: '1999-01-01T00:00:00Z' })) === 200 && same(await dismissals(bday3), [occasionDismissalKeys(d3.date).aheadKey, occasionDismissalKeys(d3.date).yearKey]));
    check('dismissal: repeating it is idempotent (no duplicate rows)', (await st(bday3, { scope: 'NOT_THIS_YEAR' })) === 200 && (await dismissals(bday3)).length === 2);
    setFlags(false);
    check('dismissal: 404 while My People is off on the server', (await st(bday3, { scope: 'NOT_NOW' })) === 404);
    setFlags(true);
  }

  // ---------------- linked plans ----------------
  const start = new Date(Date.now() + 3 * 86400_000);
  start.setUTCMinutes(0, 0, 0);
  const planBody = (extra: any) => ({ title: 'Catch Up', activityId: 'catch-up', plannedStartAt: start.toISOString(), plannedEndAt: new Date(start.getTime() + 60 * 60000).toISOString(), durationMinutes: 60, windowType: 'NEUTRAL', status: 'UPCOMING', ...extra });
  let linkedPlanId = '';
  {
    const res = await route('POST', '/api/plans', planBody({ savedPersonId: ravi }));
    const plan = await res.json();
    linkedPlanId = plan.id;
    check('POST /api/plans with the owner\'s savedPersonId -> 200, link persisted', res.status === 200 && (await planRow(plan.id))?.savedPersonId === ravi, { status: res.status, plan });
    const before = (await pool.query(`SELECT count(*)::int AS n FROM "PlannedActivity" WHERE "userId" = $1`, [user.id])).rows[0].n;
    const foreign = await route('POST', '/api/plans', planBody({ savedPersonId: zed, plannedStartAt: new Date(start.getTime() + 2 * 3600_000).toISOString(), plannedEndAt: new Date(start.getTime() + 3 * 3600_000).toISOString() }));
    const after = (await pool.query(`SELECT count(*)::int AS n FROM "PlannedActivity" WHERE "userId" = $1`, [user.id])).rows[0].n;
    check('POST /api/plans with another owner\'s person -> 404 and NO plan created', foreign.status === 404 && after === before, { status: foreign.status, before, after });
    setFlags(false);
    const off = await route('POST', '/api/plans', planBody({ savedPersonId: ravi, plannedStartAt: new Date(start.getTime() + 5 * 3600_000).toISOString(), plannedEndAt: new Date(start.getTime() + 6 * 3600_000).toISOString() }));
    const offPlan = await off.json();
    check('My People OFF: savedPersonId is ignored (plan created, link NULL); the existing link is kept', off.status === 200 && (await planRow(offPlan.id))?.savedPersonId === null && (await planRow(linkedPlanId))?.savedPersonId === ravi, { status: off.status });
    setFlags(true);
  }
  {
    const newStart = new Date(start.getTime() + 26 * 3600_000).toISOString();
    const mv = await route('POST', `/api/plans/${linkedPlanId}/move`, { newStartAt: newStart });
    const out = await mv.json();
    const succ = await planRow(out.plan?.id);
    check('Move keeps the person link on the new plan (old plan MOVED)', mv.status === 200 && succ?.savedPersonId === ravi && succ?.rescheduledFromPlanId === linkedPlanId && (await planRow(linkedPlanId))?.status === 'MOVED', { status: mv.status, out, succ });
    linkedPlanId = succ?.id ?? linkedPlanId;
    // A link that is not the owner's (only possible via a raw SQL write) is never carried forward.
    const raw = await route('POST', '/api/plans', planBody({ plannedStartAt: new Date(start.getTime() + 8 * 3600_000).toISOString(), plannedEndAt: new Date(start.getTime() + 9 * 3600_000).toISOString() }));
    const rawPlan = await raw.json();
    await pool.query(`UPDATE "PlannedActivity" SET "savedPersonId" = $2 WHERE id = $1`, [rawPlan.id, zed]);
    const mv2 = await route('POST', `/api/plans/${rawPlan.id}/move`, { newStartAt: new Date(start.getTime() + 30 * 3600_000).toISOString() });
    const succ2 = await planRow((await mv2.json()).plan?.id);
    check('Move never carries a link to another owner\'s person (owner-checked -> NULL)', mv2.status === 200 && succ2 && succ2.savedPersonId === null, { status: mv2.status, succ2 });
  }

  // ---------------- My People -> Plan hand-offs (real People screen) ----------------
  {
    const handoffs: any[] = [];
    const h = await mount(React.createElement(PeopleView, { onBack: () => {}, onPlanWithPerson: (x: any) => handoffs.push(x) }));
    await settle();
    const root = h.container as HTMLElement;
    const view = Array.from(root.querySelectorAll('button')).filter((b) => b.textContent?.trim() === 'View').find((b) => b.closest('div')?.parentElement?.textContent?.includes('Ravi'))!;
    await click(view); await settle();
    await click(btn(root, /^Plan time with Ravi$/)!);
    check('Person detail "Plan time with Ravi" -> hand-off {person, catch-up}; nothing saved', same(handoffs[0], { personId: ravi, activityId: 'catch-up' }) && !fetched.some((f) => f === 'POST /api/plans'));
    const planDay = Array.from(root.querySelectorAll('[data-testid="special-day"]')).find((el) => /Birthday/.test(el.textContent ?? ''))!;
    await click(Array.from(planDay.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Plan something')!);
    check('Special day "Plan something" -> birthday-party around the birthday (day before .. day after)', handoffs[1]?.activityId === 'birthday-party' && handoffs[1]?.startDate === addDays(today, 2).date && handoffs[1]?.endDate === addDays(today, 4).date && handoffs[1]?.personId === ravi, handoffs[1]);
    await h.unmount();
  }
  {
    setFlags(false);
    const handoffs: any[] = [];
    const h = await mount(React.createElement(PeopleView, { onBack: () => {}, onPlanWithPerson: (x: any) => handoffs.push(x) }));
    await settle();
    const root = h.container as HTMLElement;
    const view = Array.from(root.querySelectorAll('button')).filter((b) => b.textContent?.trim() === 'View').find((b) => b.closest('div')?.parentElement?.textContent?.includes('Ravi'))!;
    await click(view); await settle();
    check('My People OFF: no "Plan time with" or "Plan something" actions on the legacy screen', !btn(root, /^Plan time with/) && !btn(root, /^Plan something$/));
    await h.unmount();
    fetched.length = 0;
    const hc = await mount(React.createElement(MyPeopleHomeCard, { onPlan: () => {}, onOpenMyPeople: () => {} }));
    await settle();
    check('My People OFF (server): no Home card (upcoming answers 404)', !hc.container.querySelector('[data-testid="my-people-home-card"]'));
    await hc.unmount();
    setFlags(true, false);
    fetched.length = 0;
    const hp = await mount(React.createElement(MyPeopleHomeCard, { onPlan: () => {}, onOpenMyPeople: () => {} }));
    await settle();
    check('Public flag OFF: no Home card and no request at all', !hp.container.querySelector('[data-testid="my-people-home-card"]') && fetched.length === 0);
    await hp.unmount();
    setFlags(true);
  }

  // ---------------- isolation + deletion ----------------
  {
    const otherUp = await (await route('GET', '/api/people/occasions/upcoming?days=60', undefined, otherToken)).json();
    check('Isolation: another account sees only its own upcoming day and none of the owner\'s dismissals', otherUp.length === 1 && otherUp[0].occasionId === zedDay && otherUp[0].dismissed === false);
    const del = await route('DELETE', `/api/people/${ravi}`);
    const plans = (await pool.query(`SELECT id, "savedPersonId" FROM "PlannedActivity" WHERE "userId" = $1`, [user.id])).rows;
    const left = (await pool.query(`SELECT count(*)::int AS n FROM "ReminderAttention" WHERE "userId" = $1 AND "scheduledItemType" = 'PERSON_OCCASION'`, [user.id])).rows[0].n;
    check('Delete person: plans kept (incl. the moved one) with the link set to NULL; dismissals removed', del.status === 200 && plans.length >= 4 && plans.every((p: any) => p.savedPersonId !== ravi) && left === 0, { status: del.status, plans, left });
    check('Delete person: the other account\'s data is untouched', (await (await route('GET', '/api/people/occasions/upcoming?days=60', undefined, otherToken)).json()).length === 1);
  }

  await pool.query(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1)`, [[user.id, other.id]]);
  await pool.query(`DELETE FROM "SavedPerson" WHERE "ownerUserId" = ANY($1)`, [[user.id, other.id]]);
  console.log(allPassed ? `\nALL MY PEOPLE MP-3 DB CHECKS PASSED (${count})` : '\nSOME MY PEOPLE MP-3 DB CHECKS FAILED');
}

function same(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }

main()
  .catch((e) => { console.error(e); allPassed = false; })
  .finally(async () => { await pool.end(); process.exit(allPassed ? 0 : 1); });
