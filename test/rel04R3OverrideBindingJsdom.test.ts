/**
 * AURA-ANDROID-REL-04 IR-01 (R3) -- the REAL mounted PlanWithAura (Find a Time)
 * and My Day overlap flows: "Save anyway" re-sends for the account of the
 * ORIGINAL save, never for an account that became current in between.
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04R3OverrideBindingJsdom.test.ts
 *
 * The flows are the ones hpg5I2ConflictPanelJsdom drives. Every POST /api/plans
 * records the account it stated (X-Aura-Expected-Account).
 */
import { React, mount, click, flush } from './jsdomReactHarness';
import { runTimingSearch, type TimingSearchRequest } from '../packages/recommendation/src/timingSearch';
import { resolveTzOffsetMinutes, localDateTimeToUTC, getDatePartsInTimezone, addDaysToDateStr } from '../apps/web/lib/timezone';

const acct = require('../apps/web/lib/accountSession');
const { PlanWithAuraView } = require('../apps/web/components/PlanWithAuraView');
const { MyDayStoryCard } = require('../apps/web/components/MyDayStoryCard');

let passed = 0, failed = 0;
function check(label: string, ok: boolean) { ok ? passed++ : failed++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`); }

const TZ = 'Asia/Kolkata';
const now = new Date();
const D1 = addDaysToDateStr(getDatePartsInTimezone(TZ, now).dateStr, 1);
const posts: Array<{ body: any; account: string | null }> = [];
const postQueue: Array<() => any> = [];
let myDayCandidate: any = null;
const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body, clone() { return this; } });
(global as any).fetch = (url: string, opts?: any) => {
  const method = (opts?.method ?? 'GET').toUpperCase();
  if (url === '/api/plans' && method === 'POST') {
    posts.push({ body: JSON.parse(opts.body), account: new Headers(opts.headers).get('X-Aura-Expected-Account') });
    const next = postQueue.shift();
    return Promise.resolve(next ? next() : json(500, { error: 'unscripted' }));
  }
  if (url === '/api/timing-search' && method === 'POST') return Promise.resolve(json(200, { mode: 'FIND', candidates: myDayCandidate ? [myDayCandidate] : [] }));
  if (url === '/api/plans') return Promise.resolve(json(200, []));
  if (url === '/api/goals') return Promise.resolve(json(200, []));
  return new Promise(() => {});
};
(global as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);
(window as any).scrollTo = () => {};
const conflict = (date: string, s: string, e: string) => ({ error: 'That time overlaps another plan.', code: 'PLAN_OVERLAP', conflict: { title: 'Team call', plannedStartAt: localDateTimeToUTC(date, s, TZ).toISOString(), plannedEndAt: localDateTimeToUTC(date, e, TZ).toISOString() } });
const onTimingSearch = async (request: any) => {
  const context = { now, latitude: 13.0827, longitude: 80.2707, timezone: TZ, tzOffsetMinutes: resolveTzOffsetMinutes(TZ, now) };
  if (request.mode === 'CHECK') return runTimingSearch({ ...request, context } as TimingSearchRequest);
  return { ...runTimingSearch({ ...request, horizon: 'TOMORROW', context } as TimingSearchRequest), constraintsApplied: { availability: 'UNCONFIGURED', blockedPlanCount: 0 } };
};
const byText = (root: ParentNode, sel: string, t: string) => Array.from(root.querySelectorAll(sel)).filter((el) => (el.textContent ?? '').trim() === t) as HTMLElement[];
const byIncl = (root: ParentNode, sel: string, t: string) => Array.from(root.querySelectorAll(sel)).filter((el) => (el.textContent ?? '').includes(t)) as HTMLElement[];
const settle = async () => { for (let i = 0; i < 6; i++) await flush(); };

async function planWithAura() {
  acct.__resetAccountSessionForTests('t');
  acct.setVerifiedAccount('account-A', { broadcast: false });
  posts.length = 0;
  const h = await mount(React.createElement(PlanWithAuraView, { onTimingSearch, timezone: TZ, initialActivity: 'Workout', initialActivityId: 'workout', initialActivityKey: 1 }));
  const root = h.container;
  await settle();
  await click(byIncl(root, 'button', 'Find My Best Time')[0]);
  await settle();
  postQueue.push(() => json(409, conflict(D1, '19:30', '20:00')));
  await click(byText(root, 'button', 'Use this time')[0]);
  await settle();
  const panel = () => root.querySelector('[data-testid="plan-overlap-conflict"]') as HTMLElement | null;
  check('PW precondition: the first save (stated A) was refused with an overlap', posts.length === 1 && posts[0].account === 'account-A' && !!panel());
  acct.setVerifiedAccount('account-B'); // the account changes while the choice is open (standalone mount: not remounted)
  await settle();
  const before = posts.length;
  const sa = panel()?.querySelector('button[aria-label^="Save anyway"]') as HTMLButtonElement | null;
  if (sa) await click(sa);
  await settle();
  check('PW "Save anyway" after the account changed sends NOTHING (bound to A, not re-captured as B)', !!sa && posts.length === before && posts.every((p) => p.account !== 'account-B'));
  // Same account: the override is sent and states the ORIGINAL account.
  acct.__resetAccountSessionForTests('t');
  acct.setVerifiedAccount('account-A', { broadcast: false });
  await h.unmount();
}

async function myDay() {
  acct.__resetAccountSessionForTests('t');
  acct.setVerifiedAccount('account-A', { broadcast: false });
  posts.length = 0;
  const story = { phase: 'MORNING', headline: 'Good morning', narrative: 'A calm day.', suggestedIntentions: [{ groupId: 'SELF', label: 'Me time', icon: '🌿' }] };
  const start = localDateTimeToUTC(D1, '18:00', TZ).toISOString();
  const end = localDateTimeToUTC(D1, '18:45', TZ).toISOString();
  const base = runTimingSearch({ mode: 'FIND', activityId: 'workout', durationMinutes: 45, horizon: 'TOMORROW', limit: 1, timePreference: 'ANY', context: { now, latitude: 13.0827, longitude: 80.2707, timezone: TZ, tzOffsetMinutes: resolveTzOffsetMinutes(TZ, now) } } as TimingSearchRequest).candidates[0];
  myDayCandidate = { ...base, start, end };
  const h = await mount(React.createElement(MyDayStoryCard, { story, onOpenPeople: () => {}, onCreated: () => {} }));
  const root = h.container;
  await settle();
  await click(byIncl(root, 'button', 'Me time')[0]); await settle();
  await click(byIncl(root, 'button', 'Workout')[0]); await settle();
  postQueue.push(() => json(409, conflict(D1, '18:15', '19:00')));
  await click(byText(root, 'button', 'Add to my day')[0]);
  await settle();
  const panel = () => root.querySelector('[data-testid="my-day-overlap-conflict"]') as HTMLElement | null;
  check('MD precondition: the first save (stated A) was refused with an overlap', posts.length === 1 && posts[0].account === 'account-A' && !!panel());
  acct.setVerifiedAccount('account-B');
  await settle();
  const before = posts.length;
  const sa = panel()?.querySelector('button[aria-label^="Save anyway"]') as HTMLButtonElement | null;
  if (sa) await click(sa);
  await settle();
  check('MD "Save anyway" after the account changed sends NOTHING (bound to A, not re-captured as B)', !!sa && posts.length === before && posts.every((p) => p.account !== 'account-B'));
  await h.unmount();

  // Same account throughout: the override states the original account A.
  acct.__resetAccountSessionForTests('t');
  acct.setVerifiedAccount('account-A', { broadcast: false });
  posts.length = 0;
  const h2 = await mount(React.createElement(MyDayStoryCard, { story, onOpenPeople: () => {}, onCreated: () => {} }));
  const r2 = h2.container;
  await settle();
  await click(byIncl(r2, 'button', 'Me time')[0]); await settle();
  await click(byIncl(r2, 'button', 'Workout')[0]); await settle();
  postQueue.push(() => json(409, conflict(D1, '18:15', '19:00')));
  await click(byText(r2, 'button', 'Add to my day')[0]);
  await settle();
  postQueue.push(() => json(200, { id: 'p1', title: 'Workout', activityType: 'Workout', plannedStartAt: start, plannedEndAt: end, status: 'UPCOMING' }));
  const sa2 = r2.querySelector('[data-testid="my-day-overlap-conflict"] button[aria-label^="Save anyway"]') as HTMLButtonElement | null;
  if (sa2) await click(sa2);
  await settle();
  check('MD same account: the override is sent once, ALLOW, stating the original account A', posts.length === 2 && posts[1].body.overlapPolicy === 'ALLOW' && posts[1].account === 'account-A');
  await h2.unmount();
}

(async () => {
  await planWithAura();
  await myDay();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
