/**
 * AURA-MP-1 R1 (62007) F1 + F2 -- the REAL legacy People editor against the
 * REAL route handlers and a REAL database (no mocked responses). The
 * component's fetch() is routed in-process to the Next route handlers with a
 * real session cookie, so what the editor actually submits is what the API
 * actually judges. Run (CI: day-constructor-acceptance-db-tests):
 *
 *   DATABASE_URL="postgresql://..." npx ts-node --project tsconfig.jsdom-tests.json test/peopleViewLegacyEditorDb.test.ts
 *
 *   F1  My People disabled on the server: editing a PARENT / CHILD / SIBLING
 *       person succeeds, keeps the relationship, and the editor does not
 *       resubmit the unchanged type; enable -> disable -> re-enable keeps all
 *       saved data;
 *   F2  public flag "1" + server disabled -> the editor degrades to legacy
 *       options; public "1" + server enabled -> My People options; public "0"
 *       + server enabled -> legacy options (presentation can only hide).
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
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}${!condition && detail !== undefined ? ` -- ${JSON.stringify(detail).slice(0, 300)}` : ''}`);
  if (!condition) allPassed = false;
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let token = '';
const submitted: Array<{ method: string; url: string; body: any; status: number }> = [];

// In-process fetch -> real route handlers (real validation, real database).
(global as any).fetch = async (url: string, init: any = {}) => {
  const method = init.method ?? 'GET';
  const body = init.body ? JSON.parse(init.body) : undefined;
  const req: any = {
    cookies: { get: (n: string) => (n === TEST_SESSION_COOKIE ? { value: token } : undefined) },
    json: async () => body,
    headers: new Headers(init.headers ?? {}),
    nextUrl: new URL(`http://localhost${url}`),
  };
  let res: Response;
  if (url === '/api/cities/custom') res = new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  else if (url === '/api/people') res = await (method === 'POST' ? peopleRoute.POST(req) : peopleRoute.GET(req));
  else {
    const m = /^\/api\/people\/([^/]+)$/.exec(url);
    if (!m) throw new Error(`unrouted ${method} ${url}`);
    const ctx = { params: { personId: m[1] } };
    res = await (method === 'PATCH' ? personRoute.PATCH(req, ctx) : method === 'DELETE' ? personRoute.DELETE(req, ctx) : personRoute.GET(req, ctx));
  }
  if (method !== 'GET') submitted.push({ method, url, body, status: res.status });
  return res;
};

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const settle = async () => { for (let i = 0; i < 5; i++) await flush(); };
const buttons = (root: HTMLElement) => Array.from(root.querySelectorAll('button')) as HTMLButtonElement[];
const byText = (root: HTMLElement, t: string) => buttons(root).find((b) => b.textContent?.trim() === t);
const submit = (form: HTMLFormElement) => act(async () => { form.dispatchEvent(new (window as any).Event('submit', { bubbles: true, cancelable: true })); await new Promise((r) => setTimeout(r, 30)); });
const selectValue = async (el: HTMLSelectElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new (window as any).Event('change', { bubbles: true })); });
};
const setFlags = (server: boolean, presentation: boolean) => {
  if (server) process.env.AURA_MY_PEOPLE_ENABLED = '1'; else delete process.env.AURA_MY_PEOPLE_ENABLED;
  process.env.NEXT_PUBLIC_AURA_MY_PEOPLE = presentation ? '1' : '0';
};

/** Opens the edit form for the person named `name`; returns the mounted root. */
async function openEditor(name: string) {
  const h = await mount(React.createElement(PeopleView, { onBack: () => {} }));
  await settle();
  const root = h.container as HTMLElement;
  const cards = Array.from(root.querySelectorAll('button')).filter((b) => b.textContent?.trim() === 'View');
  const idx = cards.findIndex((b) => b.closest('div')?.parentElement?.textContent?.includes(name));
  if (idx < 0) throw new Error(`person card not found: ${name}`);
  await click(cards[idx]);
  await settle();
  await click(byText(root, 'Edit')!);
  await settle();
  return { h, root };
}
const options = (root: HTMLElement) => Array.from((root.querySelector('#person-relationship') as HTMLSelectElement).options).map((o) => o.value);

async function main() {
  const tag = `mp1r1ed-${Date.now()}`;
  const user = await db.upsertUserByEmail({ email: `${tag}@mp1.aura.local`, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
  token = await createTestSessionToken(user.id, user.email);

  // Seed with My People ENABLED: three My People types with notes/interests/special days.
  setFlags(true, true);
  const seeded: Record<string, string> = {};
  for (const type of ['PARENT', 'CHILD', 'SIBLING']) {
    const p = await db.createSavedPerson(user.id, { name: `Ed ${type}`, relationshipType: type, notes: `${type} private`, interests: ['music'], relationshipLabel: `${type} label` });
    await db.createPersonOccasion(user.id, p.id, { kind: 'BIRTHDAY', month: 2, day: 29 });
    seeded[type] = p.id;
  }
  const snapshot = async (id: string) => {
    const r = (await pool.query(`SELECT name, "relationshipType", notes, interests, "relationshipLabel", (SELECT count(*)::int FROM "PersonOccasion" o WHERE o."savedPersonId" = p.id) AS occ FROM "SavedPerson" p WHERE id = $1`, [id])).rows[0];
    return r;
  };

  // ---- F1 + F2: server DISABLED, public flag ON (graceful degradation) ----
  setFlags(false, true);
  for (const type of ['PARENT', 'CHILD', 'SIBLING']) {
    const before = await snapshot(seeded[type]);
    const { h, root } = await openEditor(`Ed ${type}`);
    const opts = options(root);
    check(`F2 server off + public on: ${type} editor offers legacy types + the person's own ${type} only`, opts.includes(type) && ['PARENT', 'CHILD', 'SIBLING'].filter((t) => t !== type).every((t) => !opts.includes(t)) && opts.includes('FAMILY'), opts);
    await typeInto(root.querySelector('#person-name') as HTMLInputElement, `Ed ${type} renamed`);
    const n = submitted.length;
    await submit(root.querySelector('form') as HTMLFormElement);
    await settle();
    const sent = submitted[n];
    check(`F1 OFF: the editor's actual PATCH for ${type} omits the unchanged relationshipType`, sent?.method === 'PATCH' && !('relationshipType' in (sent.body ?? {})), sent);
    check(`F1 OFF: the real API accepted the ${type} edit (200)`, sent?.status === 200, sent);
    const after = await snapshot(seeded[type]);
    check(`F1 OFF: ${type} kept; notes, interests, label and special days untouched`, after.relationshipType === type && after.name === `Ed ${type} renamed` && after.notes === before.notes && JSON.stringify(after.interests) === JSON.stringify(before.interests) && after.relationshipLabel === before.relationshipLabel && after.occ === before.occ, { before, after });
    await h.unmount();
  }
  // Changing to a legacy type through the editor while disabled.
  {
    const { h, root } = await openEditor('Ed SIBLING renamed');
    await selectValue(root.querySelector('#person-relationship') as HTMLSelectElement, 'FAMILY');
    const n = submitted.length;
    await submit(root.querySelector('form') as HTMLFormElement);
    await settle();
    check('F1 OFF: an actual change (SIBLING -> FAMILY) is submitted and accepted', submitted[n]?.body?.relationshipType === 'FAMILY' && submitted[n]?.status === 200 && (await snapshot(seeded.SIBLING)).relationshipType === 'FAMILY', submitted[n]);
    await h.unmount();
  }

  // ---- re-enable: everything still there ----
  setFlags(true, true);
  for (const type of ['PARENT', 'CHILD']) {
    const s = await snapshot(seeded[type]);
    check(`F1 re-enable: ${type} relationship, notes, interests, label and special day preserved`, s.relationshipType === type && s.notes === `${type} private` && s.interests[0] === 'music' && s.relationshipLabel === `${type} label` && s.occ === 1, s);
  }

  // ---- F2: server ENABLED + public ON -> My People options; public OFF -> legacy only ----
  {
    const { h, root } = await openEditor('Ed PARENT renamed');
    const opts = options(root);
    check('F2 server on + public on: My People types offered', ['PARENT', 'CHILD', 'SIBLING'].every((t) => opts.includes(t)), opts);
    await selectValue(root.querySelector('#person-relationship') as HTMLSelectElement, 'CHILD');
    const n = submitted.length;
    await submit(root.querySelector('form') as HTMLFormElement);
    await settle();
    check('F2 server on: changing PARENT -> CHILD through the editor is accepted', submitted[n]?.status === 200 && (await snapshot(seeded.PARENT)).relationshipType === 'CHILD', submitted[n]);
    await h.unmount();
  }
  setFlags(true, false);
  {
    const { h, root } = await openEditor('Ed CHILD renamed');
    const opts = options(root);
    check('F2 server on + public off: presentation hides other My People types (own type kept)', opts.includes('CHILD') && !opts.includes('PARENT') && !opts.includes('SIBLING'), opts);
    await h.unmount();
  }

  await pool.query(`DELETE FROM "SavedPerson" WHERE "ownerUserId" = $1`, [user.id]);
}

main()
  .catch((e) => { console.error(e); allPassed = false; })
  .finally(async () => {
    await pool.end();
    if (!allPassed) { console.error('\nSOME LEGACY EDITOR DB CHECKS FAILED'); process.exit(1); }
    console.log('\nALL LEGACY EDITOR DB CHECKS PASSED');
    process.exit(0);
  });
