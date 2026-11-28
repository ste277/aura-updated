/**
 * AURA-MP-4 (62025) -- the "Keep in touch" section on a person's page (real
 * PeopleView in jsdom, real routes, real disposable Postgres). Run (CI:
 * day-constructor-acceptance-db-tests):
 *
 *   DATABASE_URL="postgresql://..." npx ts-node --project tsconfig.jsdom-tests.json test/myPeopleMp4UiDb.test.ts
 *
 * Opening, choosing and cancelling never write; only Save creates exactly
 * one rhythm (and, when chosen, one visible goal whose title the user saw).
 * Pause / resume / edit / remove go through the existing Life Rhythm routes.
 * The section is absent while My People is off.
 */
import { React, mount, click, typeInto, act } from './jsdomReactHarness';
import { Pool } from 'pg';

const { createSessionToken } = require('../apps/web/lib/auth');
const db = require('../apps/web/lib/db');
const peopleRoute = require('../apps/web/app/api/people/route');
const personRoute = require('../apps/web/app/api/people/[personId]/route');
const occasionsRoute = require('../apps/web/app/api/people/[personId]/occasions/route');
const upcomingRoute = require('../apps/web/app/api/people/occasions/upcoming/route');
const rhythmsRoute = require('../apps/web/app/api/people/[personId]/rhythms/route');
const goalsRoute = require('../apps/web/app/api/goals/route');
const rhythmSettingsRoute = require('../apps/web/app/api/goals/[goalId]/activities/[goalActivityId]/rhythm/route');
const dismissRoute = require('../apps/web/app/api/goals/[goalId]/activities/[goalActivityId]/dismiss/route');
const { PeopleView } = require('../apps/web/components/PeopleView');

let allPassed = true;
let count = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  count++;
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}${!condition && detail !== undefined ? ` -- ${JSON.stringify(detail).slice(0, 600)}` : ''}`);
  if (!condition) allPassed = false;
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let token = '';
const req = (body: unknown, url: string): any => ({
  cookies: { get: (n: string) => (n === 'as_session' && token ? { value: token } : undefined) },
  json: async () => body,
  headers: new Headers(),
  nextUrl: new URL(`http://localhost${url}`),
});
const writes: string[] = [];
async function route(method: string, url: string, body?: unknown): Promise<Response> {
  const r = req(body, url);
  const path = url.split('?')[0];
  let m: RegExpExecArray | null;
  if (method !== 'GET') writes.push(`${method} ${path}`);
  if (path === '/api/people') return method === 'POST' ? peopleRoute.POST(r) : peopleRoute.GET(r);
  if (path === '/api/people/occasions/upcoming') return upcomingRoute.GET(r);
  if ((m = /^\/api\/people\/([^/]+)\/rhythms$/.exec(path))) return method === 'POST' ? rhythmsRoute.POST(r, { params: { personId: m[1] } }) : rhythmsRoute.GET(r, { params: { personId: m[1] } });
  if ((m = /^\/api\/people\/([^/]+)\/occasions$/.exec(path))) return occasionsRoute.GET(r, { params: { personId: m[1] } });
  if ((m = /^\/api\/people\/([^/]+)$/.exec(path))) return personRoute.GET(r, { params: { personId: m[1] } });
  if (path === '/api/goals') return method === 'POST' ? goalsRoute.POST(r) : goalsRoute.GET(r);
  if ((m = /^\/api\/goals\/([^/]+)\/activities\/([^/]+)\/rhythm$/.exec(path))) return rhythmSettingsRoute.PATCH(r, { params: { goalId: m[1], goalActivityId: m[2] } });
  if ((m = /^\/api\/goals\/([^/]+)\/activities\/([^/]+)\/dismiss$/.exec(path))) return dismissRoute.POST(r, { params: { goalId: m[1], goalActivityId: m[2] } });
  if (path === '/api/cities/custom') return new Response('[]', { status: 200 });
  throw new Error(`unrouted ${method} ${url}`);
}
(global as any).fetch = async (url: string, init: any = {}) => route(init.method ?? 'GET', url, init.body ? JSON.parse(init.body) : undefined);
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const settle = async () => { for (let i = 0; i < 6; i++) await flush(); };
const btn = (root: HTMLElement, re: RegExp) => (Array.from(root.querySelectorAll('button')) as HTMLButtonElement[]).find((b) => re.test(b.textContent?.trim() ?? ''));
const selectValue = async (el: HTMLSelectElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new (window as any).Event('change', { bubbles: true })); });
};
const submit = async (form: HTMLFormElement) => { await act(async () => { form.dispatchEvent(new (window as any).Event('submit', { bubbles: true, cancelable: true })); }); await settle(); };
const setFlags = (on: boolean) => {
  if (on) { process.env.AURA_MY_PEOPLE_ENABLED = '1'; process.env.NEXT_PUBLIC_AURA_MY_PEOPLE = '1'; } else { delete process.env.AURA_MY_PEOPLE_ENABLED; delete process.env.NEXT_PUBLIC_AURA_MY_PEOPLE; }
};

async function openPerson(name: string) {
  const h = await mount(React.createElement(PeopleView, { onBack: () => {}, onPlanWithPerson: () => {} }));
  await settle();
  const root = h.container as HTMLElement;
  const view = Array.from(root.querySelectorAll('button')).filter((b) => b.textContent?.trim() === 'View').find((b) => b.closest('div')?.parentElement?.textContent?.includes(name))!;
  await click(view); await settle();
  return { h, root };
}

async function main() {
  const tag = `mp4ui-${Date.now()}`;
  const user = await db.upsertUserByEmail({ email: `${tag}@mp4.aura.local`, cityName: 'Chennai', latitude: 13.08, longitude: 80.27, timezone: 'Asia/Kolkata' });
  token = createSessionToken(user.id, user.email);
  const goals = async () => (await pool.query(`SELECT id, title FROM "Goal" WHERE "userId" = $1 ORDER BY "createdAt"`, [user.id])).rows;
  const acts = async () => (await pool.query(`SELECT * FROM "GoalActivity" WHERE "userId" = $1 ORDER BY "createdAt"`, [user.id])).rows;

  setFlags(true);
  const ravi = (await (await route('POST', '/api/people', { name: 'Ravi' })).json()).id;

  {
    const { h, root } = await openPerson('Ravi');
    const text = root.textContent ?? '';
    check('Person page shows "Keep in touch" with plain wording and no rhythm yet', /Keep in touch/.test(text) && /Aura suggests times that fit your week; you choose/.test(text) && !/haven't|streak|score|overdue|should/i.test(text), text.slice(0, 400));
    writes.length = 0;
    await click(btn(root, /^\+ Keep in touch with Ravi$/)!); await settle();
    const form = root.querySelector('[data-testid="person-rhythm-form"]') as HTMLFormElement;
    check('The form proposes "Call Ravi", once a week, and a NEW goal named "Stay close to Ravi" that the user can see and edit', (root.querySelector('#rhythm-title') as HTMLInputElement)?.value === 'Call Ravi' && (root.querySelector('#rhythm-goal-title') as HTMLInputElement)?.value === 'Stay close to Ravi' && (root.querySelector('#rhythm-target') as HTMLSelectElement)?.value === '1');
    await selectValue(root.querySelector('#rhythm-choice') as HTMLSelectElement, 'VISIT'); await settle();
    check('Changing what to do updates an untouched name ("Visit Ravi")', (root.querySelector('#rhythm-title') as HTMLInputElement).value === 'Visit Ravi');
    check('The form says suggested times come from the user\'s own calendar and to check with the person', /Check that they work for Ravi too/.test(form.textContent ?? ''));
    await click(btn(root, /^Cancel$/)!); await settle();
    check('Opening the form, choosing and cancelling writes nothing (no goal, no rhythm)', writes.length === 0 && (await goals()).length === 0 && (await acts()).length === 0, writes);

    await click(btn(root, /^\+ Keep in touch with Ravi$/)!); await settle();
    await typeInto(root.querySelector('#rhythm-goal-title') as HTMLInputElement, 'Ravi and me');
    await selectValue(root.querySelector('#rhythm-target') as HTMLSelectElement, '2');
    await submit(root.querySelector('[data-testid="person-rhythm-form"]') as HTMLFormElement);
    const g = await goals(); const a = await acts();
    const rows = Array.from(root.querySelectorAll('[data-testid="person-rhythm"]')).map((e) => e.textContent ?? '');
    check('Save creates exactly ONE rhythm linked to Ravi and ONE goal with the edited name; the page lists it', g.length === 1 && g[0].title === 'Ravi and me' && a.length === 1 && a[0].savedPersonId === ravi && a[0].rhythmTargetPerWeek === 2 && rows.length === 1 && /Call Ravi/.test(rows[0]) && /Twice a week/.test(rows[0]) && /Goal: Ravi and me/.test(rows[0]), { g, rows });

    await click(btn(root, /^\+ Keep in touch with Ravi$/)!); await settle();
    await selectValue(root.querySelector('#rhythm-choice') as HTMLSelectElement, 'DINNER'); await settle();
    await selectValue(root.querySelector('#rhythm-goal-mode') as HTMLSelectElement, 'EXISTING'); await settle();
    await selectValue(root.querySelector('#rhythm-goal-id') as HTMLSelectElement, g[0].id); await settle();
    await submit(root.querySelector('[data-testid="person-rhythm-form"]') as HTMLFormElement);
    check('"Add to one of my goals" attaches a second rhythm to the existing goal -- no new goal', (await goals()).length === 1 && (await acts()).length === 2 && (await acts())[1].goalId === g[0].id && (await acts())[1].activityId === 'family-dinner');

    const first = () => root.querySelectorAll('[data-testid="person-rhythm"]')[0] as HTMLElement;
    await click(btn(first(), /^Pause$/)!); await settle();
    check('Pause (existing route) -> "Paused" shown, stored paused, link kept', /Paused/.test(first().textContent ?? '') && (await acts())[0].rhythmPausedAt !== null && (await acts())[0].savedPersonId === ravi);
    await click(btn(first(), /^Resume$/)!); await settle();
    check('Resume -> active again', !/Paused/.test(first().textContent ?? '') && (await acts())[0].rhythmPausedAt === null);
    await click(btn(first(), /^Edit$/)!); await settle();
    const editForm = root.querySelector('[data-testid="person-rhythm-edit"]') as HTMLFormElement;
    await selectValue(editForm.querySelector('select') as HTMLSelectElement, '3');
    await submit(editForm);
    check('Edit how often -> 3 times a week', /3 times a week/.test(first().textContent ?? '') && (await acts())[0].rhythmTargetPerWeek === 3);
    await click(btn(first(), /^Remove$/)!); await settle();
    check('Remove asks first and says plans already made stay', /Plans already made stay as they are/.test(first().textContent ?? ''));
    await click(btn(first(), /^Yes, remove$/)!); await settle();
    check('Remove (existing dismiss) -> one rhythm left on the page; the removed one is kept as DISMISSED history', root.querySelectorAll('[data-testid="person-rhythm"]').length === 1 && (await acts())[0].status === 'DISMISSED');
    await h.unmount();
  }

  {
    setFlags(false);
    const { h, root } = await openPerson('Ravi');
    check('My People OFF: the legacy person screen has no "Keep in touch" section', !/Keep in touch/.test(root.textContent ?? ''));
    await h.unmount();
  }

  console.log(allPassed ? `\nALL MY PEOPLE MP-4 UI CHECKS PASSED (${count})` : `\nMY PEOPLE MP-4 UI CHECK(S) FAILED`);
}

main()
  .catch((err) => { console.error(err); allPassed = false; })
  .finally(async () => { await pool.end(); process.exit(allPassed ? 0 : 1); });
