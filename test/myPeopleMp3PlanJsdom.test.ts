/**
 * AURA-MP-3 (62018) -- the REAL Plan tab (PlanWithAuraView) planning with a
 * person, in jsdom, with REAL runTimingSearch candidates.
 *
 *   npx ts-node --project tsconfig.jsdom-tests.json test/myPeopleMp3PlanJsdom.test.ts
 *
 * My People ON (public flag + server header "enabled"):
 *   - a My People hand-off pre-fills activity, person and dates (no search,
 *     no save);
 *   - Find uses the MAIN route (onTimingSearch: Panchang + the user's own
 *     availability/Daily Rhythm), never /api/timing-search/shared;
 *   - the person does not change the ranking (same candidates as "Just me");
 *   - a plan is created only on "Use this time", carrying savedPersonId and
 *     the existing "Planned with {name}" note;
 *   - "+ Add someone" quick-add reuses the My People form in place and keeps
 *     the activity, dates and duration; the new person is selected.
 * My People OFF (server header "disabled"): the pre-existing shared route and
 * "+ Choose someone" are unchanged, and no savedPersonId is ever sent.
 * The server side (owner validation, persistence) is covered by
 * myPeopleMp3Db.test.ts.
 */
import { React, mount, click, flush, typeInto, act } from './jsdomReactHarness';
import { runTimingSearch, type TimingSearchRequest } from '../packages/recommendation/src/timingSearch';
import { resolveTzOffsetMinutes, getDatePartsInTimezone, addDaysToDateStr } from '../apps/web/lib/timezone';

process.env.NEXT_PUBLIC_AURA_MY_PEOPLE = '1';
const { PlanWithAuraView } = require('../apps/web/components/PlanWithAuraView');

let allPassed = true;
let count = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  count++;
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}${!condition && detail !== undefined ? ` -- ${JSON.stringify(detail).slice(0, 400)}` : ''}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const now = new Date();
const TODAY = getDatePartsInTimezone(TZ, now).dateStr;
const D1 = addDaysToDateStr(TODAY, 1);
const D3 = addDaysToDateStr(TODAY, 3);

let serverHeader = 'enabled';
let people = [{ id: 'p-ravi', name: 'Ravi', relationshipType: 'FRIEND', relationshipLabel: null, hasChartDetails: false, nextOccasion: null }];
const calls: Array<{ url: string; method: string; body: any }> = [];
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null }, json: async () => body });
(global as any).fetch = (url: string, opts?: any) => {
  const method = (opts?.method ?? 'GET').toUpperCase();
  const body = opts?.body ? JSON.parse(opts.body) : undefined;
  calls.push({ url, method, body });
  if (url === '/api/people' && method === 'GET') return Promise.resolve(json(200, people, { 'x-aura-my-people': serverHeader }));
  if (url === '/api/people' && method === 'POST') {
    const created = { id: `p-${body.name.toLowerCase()}`, name: body.name, relationshipType: body.relationshipType ?? 'OTHER', relationshipLabel: null, hasChartDetails: false, nextOccasion: null };
    people = [...people, created];
    return Promise.resolve(json(201, created, { 'x-aura-my-people': serverHeader }));
  }
  if (url === '/api/plans' && method === 'POST') return Promise.resolve(json(201, { id: `plan-${calls.length}`, userId: 'u', title: body.title, activityType: body.activityType, icon: null, plannedStartAt: body.plannedStartAt, plannedEndAt: body.plannedEndAt, durationMinutes: body.durationMinutes, windowType: body.windowType, windowLabel: null, matchLabel: null, score: null, recommendation: body.recommendation, calendarUrl: null, status: 'UPCOMING', createdAt: now.toISOString(), updatedAt: now.toISOString(), activityId: body.activityId ?? null }));
  if (url === '/api/plans') return Promise.resolve(json(200, []));
  if (url === '/api/cities/custom') return Promise.resolve(json(200, []));
  if (url === '/api/timing-search/shared') return Promise.resolve(json(200, { candidates: [] }));
  return new Promise(() => {}); // unrelated child fetches stay pending
};
(global as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);
(window as any).scrollTo = () => {};

const searches: any[] = [];
const onTimingSearch = async (request: any) => {
  searches.push(request);
  const context = { now, latitude: 13.0827, longitude: 80.2707, timezone: TZ, tzOffsetMinutes: resolveTzOffsetMinutes(TZ, now) };
  return { ...runTimingSearch({ ...request, context } as TimingSearchRequest), constraintsApplied: { availability: 'UNCONFIGURED', blockedPlanCount: 0 } };
};

const byText = (root: HTMLElement, sel: string, text: string) => Array.from(root.querySelectorAll(sel)).filter((el) => (el.textContent ?? '').trim() === text) as HTMLElement[];
const byIncl = (root: HTMLElement, sel: string, text: string) => Array.from(root.querySelectorAll(sel)).filter((el) => (el.textContent ?? '').includes(text)) as HTMLElement[];
const settle = async () => { for (let i = 0; i < 6; i++) await flush(); };
const posts = () => calls.filter((c) => c.method === 'POST' && c.url === '/api/plans');
const chip = (root: HTMLElement, name: string) => byIncl(root, 'button', name).find((b) => b.getAttribute('aria-pressed') !== null || /Ravi|Asha|Just me/.test(b.textContent ?? '')) ?? null;
const dateInputs = (root: HTMLElement) => Array.from(root.querySelectorAll('input[type="date"]')).map((i) => (i as HTMLInputElement).value);
const find = async (root: HTMLElement) => { await click(byIncl(root, 'button', 'Find My Best Time')[0]); await settle(); };
const startsShown = () => searches.length;

async function main() {
  // ================= My People ON =================
  const h = await mount(React.createElement(PlanWithAuraView, { onTimingSearch, timezone: TZ, initialActivity: 'Catch Up', initialActivityId: 'catch-up', initialActivityKey: 1, initialHorizon: 'CUSTOM', initialPersonId: 'p-ravi', initialCustomStartDate: D1, initialCustomEndDate: D3 }));
  const root = h.container as HTMLElement;
  await settle();

  const text0 = root.textContent ?? '';
  check('hand-off pre-fills: activity Catch Up, "Who\'s this with?" shown, custom dates D1..D3', /Catch Up/.test(text0) && /Who.s this with\?/.test(text0) && dateInputs(root).includes(D1) && dateInputs(root).includes(D3), { dates: dateInputs(root) });
  check('hand-off pre-fills only: no search and no plan yet', searches.length === 0 && posts().length === 0);
  check('the note says Aura uses YOUR availability and to check with Ravi (never assumes theirs)', /Planning with Ravi\. Aura suggests times from your own calendar, rhythm and Panchang\. Check that it works for Ravi too\./.test(text0), text0.slice(0, 200));
  check('quick-add is offered as "+ Add someone" while My People is on', byText(root, 'button', '+ Add someone').length === 1 && byText(root, 'button', '+ Choose someone').length === 0);

  await find(root);
  check('Find with Ravi uses the MAIN route (onTimingSearch FIND, catch-up, CUSTOM D1..D3) and never the shared route', searches.length === 1 && searches[0].mode === 'FIND' && searches[0].activityId === 'catch-up' && searches[0].horizon === 'CUSTOM' && searches[0].customStartDate === D1 && searches[0].customEndDate === D3 && !calls.some((c) => c.url === '/api/timing-search/shared'), searches[0]);
  const withRavi = byText(root, 'button', 'Use this time').length;
  check('results are shown, and nothing is saved before an explicit "Use this time"', withRavi >= 1 && posts().length === 0);

  // Same request without the person -> identical ranking (person is association only).
  const rankWith = JSON.stringify((await onTimingSearch({ ...searches[0] })).candidates.map((c: any) => [c.start, c.score]));
  searches.pop();
  await click(byText(root, 'button', 'Just me')[0]); await settle();
  await find(root);
  const rankWithout = JSON.stringify((await onTimingSearch({ ...searches[searches.length - 1] })).candidates.map((c: any) => [c.start, c.score]));
  searches.pop();
  check('ranking is unchanged by the person (same request -> same candidates and scores as "Just me")', rankWith === rankWithout && same(stripPerson(searches[0]), stripPerson(searches[1])), { a: searches[0], b: searches[1] });
  await click(byText(root, 'button', 'Just me')[0]); await settle();
  await click(byIncl(root, 'button', 'Ravi')[0]); await settle();
  await find(root);

  await click(byText(root, 'button', 'Use this time')[0]); await settle();
  const p1 = posts()[0]?.body;
  check('explicit "Use this time" -> exactly one POST /api/plans with savedPersonId p-ravi and REJECT_ACTIVE_OVERLAP', posts().length === 1 && p1?.savedPersonId === 'p-ravi' && p1?.overlapPolicy === 'REJECT_ACTIVE_OVERLAP' && p1?.activityId === 'catch-up', p1);
  check('the saved plan keeps the existing "Planned with Ravi" note (D6 convention); title stays the activity', /^❤️ Planned with Ravi\./.test(p1?.recommendation ?? '') && p1?.title === 'Catch Up', p1);

  // ---- quick-add keeps the planning context ----
  const before = { dates: dateInputs(root), activity: /Catch Up/.test(root.textContent ?? '') };
  await click(byText(root, 'button', '+ Add someone')[0]); await settle();
  const qa = root.querySelector('[data-testid="plan-quick-add"]') as HTMLElement;
  check('"+ Add someone" opens the My People form in place (no navigation away from Plan)', Boolean(qa?.querySelector('#person-name')));
  await typeInto(qa.querySelector('#person-name') as HTMLInputElement, 'Asha');
  await act(async () => { (qa.querySelector('form') as HTMLFormElement).dispatchEvent(new (window as any).Event('submit', { bubbles: true, cancelable: true })); });
  await settle();
  const createdPost = calls.find((c) => c.method === 'POST' && c.url === '/api/people');
  check('quick-add creates the person through the My People create API with only what was entered', same(createdPost?.body, { name: 'Asha' }), createdPost?.body);
  const t2 = root.textContent ?? '';
  check('after quick-add: form closed, Asha selected, activity and dates unchanged (context preserved)', !root.querySelector('[data-testid="plan-quick-add"]') && /Planning with Asha\./.test(t2) && before.activity && /Catch Up/.test(t2) && same(dateInputs(root), before.dates), { dates: dateInputs(root), before });
  await find(root);
  await click(byText(root, 'button', 'Use this time')[0]); await settle();
  check('a plan saved after quick-add is linked to the NEW person', posts().length === 2 && posts()[1].body.savedPersonId === 'p-asha', posts()[1]?.body);

  await click(byText(root, 'button', 'Just me')[0]); await settle();
  await find(root);
  await click(byText(root, 'button', 'Use this time')[0]); await settle();
  check('"Just me" -> no savedPersonId and no "Planned with" note', posts().length === 3 && !('savedPersonId' in posts()[2].body) && !/Planned with/.test(posts()[2].body.recommendation ?? ''), posts()[2]?.body);
  await h.unmount();

  // ================= My People OFF (server disabled; public flag still on) =================
  serverHeader = 'disabled';
  people = [{ id: 'p-ravi', name: 'Ravi', relationshipType: 'FRIEND', relationshipLabel: null, hasChartDetails: false, nextOccasion: null }];
  calls.length = 0;
  searches.length = 0;
  const h2 = await mount(React.createElement(PlanWithAuraView, { onTimingSearch, timezone: TZ, initialActivity: 'Catch Up', initialActivityId: 'catch-up', initialActivityKey: 2 }));
  const r2 = h2.container as HTMLElement;
  await settle();
  check('OFF: "+ Choose someone" (navigate to People) is unchanged; no quick-add', byText(r2, 'button', '+ Choose someone').length === 1 && byText(r2, 'button', '+ Add someone').length === 0);
  await click(byIncl(r2, 'button', 'Ravi')[0]); await settle();
  check('OFF: no "Planning with" note', !/Planning with/.test(r2.textContent ?? ''));
  await find(r2);
  const shared = calls.find((c) => c.url === '/api/timing-search/shared');
  check('OFF: a selected person keeps the pre-existing shared route (with savedPersonId for its chart blend); main route not used', Boolean(shared) && shared!.body.savedPersonId === 'p-ravi' && searches.length === 0, { shared: shared?.body, searches });
  check('OFF: no plan is created by searching', posts().length === 0);
  await h2.unmount();

  console.log(allPassed ? `\nALL MY PEOPLE MP-3 PLAN CHECKS PASSED (${count})` : '\nSOME MY PEOPLE MP-3 PLAN CHECKS FAILED');
}

function same(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }
function stripPerson(r: any) { return r; }

main()
  .catch((e) => { console.error(e); allPassed = false; })
  .finally(() => process.exit(allPassed ? 0 : 1));
