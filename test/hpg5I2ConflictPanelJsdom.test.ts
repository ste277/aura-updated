/**
 * AURA-HPG5-V2-I2 -- R1-04 (Plan tab conflict panel names the exact proposed
 * save) and R1-05 (My Day story card recommended-time save protection), on
 * the REAL mounted components in jsdom.
 *
 *   npx ts-node --project tsconfig.jsdom-tests.json test/hpg5I2ConflictPanelJsdom.test.ts
 *
 * fetch is a scripted router (no network). The Plan tab's onTimingSearch
 * returns REAL runTimingSearch candidates. Server-side behaviour (409,
 * rollback, lock) is covered by hpg5I2MyDaySaveDb.test.ts and the I1 DB suite.
 */
import { React, mount, click, flush, act } from './jsdomReactHarness';
import { runTimingSearch, type TimingSearchRequest } from '../packages/recommendation/src/timingSearch';
import { resolveTzOffsetMinutes, localDateTimeToUTC, getDatePartsInTimezone, addDaysToDateStr } from '../apps/web/lib/timezone';
import { presentProposedPlanOverlap, formatPlanOverlapTime } from '../apps/web/lib/schedulingEligibilityPresentation';

const { PlanWithAuraView } = require('../apps/web/components/PlanWithAuraView');
const { MyDayStoryCard } = require('../apps/web/components/MyDayStoryCard');
// AURA-ANDROID-REL-04 (R2): in the app these components render only after Home verified the
// account; account-bound saves (captured at the user's action) need that verified account.
require('../apps/web/lib/accountSession').setVerifiedAccount('synthetic-test-user', { broadcast: false });

let allPassed = true;
let count = 0;
function check(label: string, condition: boolean) {
  count++;
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const now = new Date();
const D1 = addDaysToDateStr(getDatePartsInTimezone(TZ, now).dateStr, 1);

// ---- scripted fetch router ----
type Deferred = { resolve: () => void };
const posts: any[] = [];
const postQueue: Array<() => any> = [];
const held: Deferred[] = [];
const findBodies: any[] = [];
let holdNextPost = false;
let myDayCandidate: any = null;
const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
(global as any).fetch = (url: string, opts?: any) => {
  const method = (opts?.method ?? 'GET').toUpperCase();
  if (url === '/api/plans' && method === 'POST') {
    posts.push(JSON.parse(opts.body));
    const next = postQueue.shift();
    if (holdNextPost) {
      holdNextPost = false;
      return new Promise((resolve) => held.push({ resolve: () => resolve(next ? next() : json(500, {})) }));
    }
    return Promise.resolve(next ? next() : json(500, { error: 'unscripted' }));
  }
  if (url === '/api/timing-search' && method === 'POST') {
    findBodies.push(JSON.parse(opts.body));
    return Promise.resolve(json(200, { mode: 'FIND', candidates: myDayCandidate ? [myDayCandidate] : [] }));
  }
  if (url === '/api/plans') return Promise.resolve(json(200, []));
  if (url === '/api/goals') return Promise.resolve(json(200, [{ id: 'goal-1', title: 'Move my body' }, { id: 'goal-2', title: 'Learn' }]));
  if (url === '/api/goals/goal-1') return Promise.resolve(json(200, { activities: [{ id: 'ga-run', title: 'Run', activityId: null, derivedState: 'SUGGESTED' }] }));
  if (url === '/api/goals/goal-2') return Promise.resolve(json(200, { activities: [{ id: 'ga-read', title: 'Read', activityId: null, derivedState: 'SUGGESTED' }] }));
  return new Promise(() => {});
};
(global as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);

const savedRow = (body: any, n: number) => ({ id: `plan-${n}`, userId: 'u', title: body.title, activityType: body.activityType, icon: null, plannedStartAt: body.plannedStartAt, plannedEndAt: body.plannedEndAt, durationMinutes: body.durationMinutes, windowType: body.windowType, windowLabel: body.windowLabel ?? null, matchLabel: body.matchLabel ?? null, score: body.score ?? null, recommendation: body.recommendation ?? null, calendarUrl: null, status: 'UPCOMING', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), activityId: null });
const conflictAt = (date: string, s: string, e: string, title = 'Team call') => ({ error: 'That time overlaps another plan.', code: 'PLAN_OVERLAP', conflict: { title, plannedStartAt: localDateTimeToUTC(date, s, TZ).toISOString(), plannedEndAt: localDateTimeToUTC(date, e, TZ).toISOString() } });
const withoutPolicy = (b: any) => { const { overlapPolicy: _p, ...rest } = b; return rest; };

const onTimingSearch = async (request: any) => {
  const context = { now, latitude: 13.0827, longitude: 80.2707, timezone: TZ, tzOffsetMinutes: resolveTzOffsetMinutes(TZ, now) };
  if (request.mode === 'CHECK') return runTimingSearch({ ...request, context } as TimingSearchRequest);
  return { ...runTimingSearch({ ...request, horizon: 'TOMORROW', context } as TimingSearchRequest), constraintsApplied: { availability: 'UNCONFIGURED', blockedPlanCount: 0 } };
};

const byText = (root: ParentNode, selector: string, text: string) => Array.from(root.querySelectorAll(selector)).filter((el) => (el.textContent ?? '').trim() === text) as HTMLElement[];
const byTextIncludes = (root: ParentNode, selector: string, text: string) => Array.from(root.querySelectorAll(selector)).filter((el) => (el.textContent ?? '').includes(text)) as HTMLElement[];
const settle = async () => { for (let i = 0; i < 5; i++) await flush(); };
// Two clicks dispatched inside ONE act() batch: React has not re-rendered in
// between, so only a synchronous guard (not a state flag) can stop the second.
const clickTwiceSameTick = async (el: HTMLElement) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};
const unhandled: unknown[] = [];
process.on('unhandledRejection', (e) => { unhandled.push(e); });
const timeOf = (iso: string, tz: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });

async function planTab() {
  const h = await mount(React.createElement(PlanWithAuraView, { onTimingSearch, timezone: TZ }));
  const root = h.container;
  await settle();
  const linkGoal = async (goal: string, activity: string) => {
    for (const label of ['+ Link to a Goal', goal]) {
      const b = byText(root, 'button', label)[0];
      if (b) { await click(b); await settle(); }
    }
    await click(byText(root, 'button', activity)[0]);
    await settle();
  };
  await linkGoal('Move my body', 'Run');
  check('PT setup: goal activity linked', byTextIncludes(root, 'p', 'Linked to').length === 1);
  await click(byTextIncludes(root, 'button', 'Find My Best Time')[0]);
  await settle();
  const useButtons = () => byText(root, 'button', 'Use this time');
  check('PT setup: at least two results so a non-best card can be refused', useButtons().length >= 2);
  const panel = () => root.querySelector('[data-testid="plan-overlap-conflict"]') as HTMLElement | null;
  const saveAnyway = () => panel()?.querySelector('button[aria-label^="Save anyway"]') as HTMLButtonElement | null;

  // ---- refuse the SECOND card (an "Other option"), not the Best Match ----
  postQueue.push(() => json(409, conflictAt(D1, '19:30', '20:00')));
  await click(useButtons()[1]);
  await settle();
  const refused = posts[0];
  check('R1-04 refused save carried REJECT_ACTIVE_OVERLAP and the goal link', refused.overlapPolicy === 'REJECT_ACTIVE_OVERLAP' && refused.goalActivityId === 'ga-run');
  const expected = presentProposedPlanOverlap({ title: refused.title, plannedStartAt: refused.plannedStartAt, plannedEndAt: refused.plannedEndAt }, conflictAt(D1, '19:30', '20:00').conflict, TZ);
  const proposedLine = panel()?.querySelector('[data-testid="plan-overlap-conflict-proposed"]')?.textContent ?? '';
  const existingLine = panel()?.querySelector('[data-testid="plan-overlap-conflict-existing"]')?.textContent ?? '';
  check('R1-04 panel names the proposed activity title', proposedLine.includes(refused.title));
  check('R1-04 panel shows the proposed date and start–end in the user timezone', proposedLine.includes(formatPlanOverlapTime(refused, TZ)) && proposedLine === expected.proposedLine);
  check('R1-04 panel shows the conflicting plan title and its date/time', existingLine.includes('“Team call”') && existingLine.includes(formatPlanOverlapTime(conflictAt(D1, '19:30', '20:00').conflict, TZ)) && existingLine.includes('Nothing was saved'));
  check('R1-04 Save anyway button text carries the exact proposed start time', (saveAnyway()?.textContent ?? '') === `Save anyway at ${timeOf(refused.plannedStartAt, TZ)}`);
  check('R1-04 Save anyway accessible name carries the proposed date/time, activity and conflict', saveAnyway()?.getAttribute('aria-label') === expected.saveAnywayLabel && expected.saveAnywayLabel.includes(formatPlanOverlapTime(refused, TZ)));

  // placement: directly under the refused card, never above a different card
  const prevCard = panel()?.previousElementSibling as HTMLElement | null;
  check('R1-04 panel is rendered immediately after the refused card (shows its time)', !!prevCard && (prevCard.textContent ?? '').includes(timeOf(refused.plannedStartAt, TZ)) && byText(prevCard, 'button', 'Use this time').length === 1);
  // The Best Match card = the sibling (of the panel) holding the FIRST "Use this time".
  let bestCard: HTMLElement | null = useButtons()[0];
  while (bestCard && bestCard.parentElement !== panel()!.parentElement) bestCard = bestCard.parentElement;
  check('R1-04 panel is NOT inside or directly after the Best Match card', !!bestCard && (bestCard.textContent ?? '').includes('BEST MATCH') && !bestCard.contains(panel()) && bestCard.nextElementSibling !== panel());

  // a11y
  check('R1-04 panel is role=alert, labelled and described', panel()?.getAttribute('role') === 'alert' && panel()?.getAttribute('aria-labelledby') === 'plan-overlap-heading' && panel()?.getAttribute('aria-describedby') === 'plan-overlap-detail');
  check('R1-04 focus moves to the conflict heading', (document.activeElement as HTMLElement | null)?.id === 'plan-overlap-heading');
  const actions = Array.from(panel()!.querySelectorAll('button')) as HTMLButtonElement[];
  check('R1-04 keyboard: both actions are native, enabled, tabbable <button>s in reading order (Choose, then Save)', actions.length === 2 && actions.every((b) => b.type === 'button' && !b.disabled && b.tabIndex === 0) && (actions[0].textContent ?? '').includes('Choose another time') && actions[1] === saveAnyway());
  check('R1-04 both actions are at least 44px tall', actions.every((b) => b.style.minHeight === '44px'));
  check('R1-04 no write while the panel is visible (exactly one POST so far)', posts.length === 1);

  // ---- Save anyway: exact same payload; double-click guarded ----
  postQueue.push(() => json(200, savedRow(refused, 1)));
  holdNextPost = true;
  await click(saveAnyway()!);
  await click(saveAnyway()!);
  await click(saveAnyway()!);
  await settle();
  check('R1-04 rapid triple-click sends exactly one override POST', posts.length === 2);
  check('R1-04 override is disabled and shows Saving… while in flight', saveAnyway()?.disabled === true && (saveAnyway()?.textContent ?? '').includes('Saving'));
  check('R1-04 override sends overlapPolicy ALLOW', posts[1].overlapPolicy === 'ALLOW');
  check('R1-04 override payload is byte-identical to the refused payload apart from overlapPolicy', JSON.stringify(withoutPolicy(posts[1])) === JSON.stringify(withoutPolicy(refused)));
  await act(async () => { held.shift()!.resolve(); });
  await settle();
  check('R1-04 after the override succeeds the panel closes and that card is Planned', !panel() && byText(root, 'button', 'Planned').length === 1);

  // ---- stale invalidation: linking a goal after an UNLINKED refusal ----
  // (the success above consumed the link, so this refusal carries none)
  await click(byTextIncludes(root, 'button', 'Find My Best Time')[0]);
  await settle();
  postQueue.push(() => json(409, conflictAt(D1, '19:30', '20:00')));
  await click(useButtons()[0]);
  await settle();
  check('R1-04 stale setup: unlinked refusal visible', !!panel() && posts[posts.length - 1].goalActivityId === null);
  await linkGoal('Learn', 'Read');
  check('R1-04 selecting a goal activity clears the pending (unlinked) conflict -- the override can never attach a different link', !panel());
  check('R1-04 changing the goal wrote nothing', posts.length === 3);

  // ---- stale invalidation: a new search clears it (even if the slot recurs) ----
  await click(byTextIncludes(root, 'button', 'Find My Best Time')[0]);
  await settle();
  postQueue.push(() => json(409, conflictAt(D1, '19:30', '20:00')));
  await click(useButtons()[0]);
  await settle();
  check('R1-04 conflict visible for the new link', !!panel() && posts[posts.length - 1].goalActivityId === 'ga-read');
  await click(byTextIncludes(root, 'button', 'Find My Best Time')[0]);
  await settle();
  check('R1-04 a new search clears the conflict, and it does not come back for an identical result set', !panel());

  // ---- same-tick double submit: "Use this time" and "Save anyway" ----
  const beforeTick = posts.length;
  postQueue.push(() => json(409, conflictAt(D1, '19:30', '20:00')));
  holdNextPost = true;
  await clickTwiceSameTick(useButtons()[0]);
  await settle();
  check('R1-04 two same-tick clicks on "Use this time" send exactly one POST', posts.length === beforeTick + 1);
  await act(async () => { held.shift()!.resolve(); });
  await settle();
  check('R1-04 same-tick setup: conflict visible', !!panel());
  postQueue.push(() => json(409, conflictAt(D1, '19:30', '20:00')));
  holdNextPost = true;
  await clickTwiceSameTick(saveAnyway()!);
  await settle();
  check('R1-04 two same-tick clicks on "Save anyway" send exactly one POST', posts.length === beforeTick + 2);
  await act(async () => { held.shift()!.resolve(); });
  await settle();

  // ---- Choose another time ----
  await click(byTextIncludes(root, 'button', 'Find My Best Time')[0]);
  await settle();
  postQueue.push(() => json(409, conflictAt(D1, '19:30', '20:00')));
  await click(useButtons()[0]);
  await settle();
  const before = posts.length;
  await click(byText(panel()!, 'button', 'Choose another time')[0]);
  await settle();
  check('R1-04 Choose another time closes the panel, writes nothing, returns focus to results', !panel() && posts.length === before && (document.activeElement?.textContent ?? '').includes("Aura's Best Moments"));

  await h.unmount();
}

async function myDay() {
  const story = { phase: 'MORNING', headline: 'Good morning', narrative: 'A calm day.', suggestedIntentions: [{ groupId: 'SELF', label: 'Me time', icon: '🌿' }] };
  const start = localDateTimeToUTC(D1, '18:00', TZ).toISOString();
  const end = localDateTimeToUTC(D1, '18:45', TZ).toISOString();
  const base = runTimingSearch({ mode: 'FIND', activityId: 'workout', durationMinutes: 45, horizon: 'TOMORROW', limit: 1, timePreference: 'ANY', context: { now, latitude: 13.0827, longitude: 80.2707, timezone: TZ, tzOffsetMinutes: resolveTzOffsetMinutes(TZ, now) } } as TimingSearchRequest).candidates[0];
  myDayCandidate = { ...base, start, end };
  let created = 0;
  const h = await mount(React.createElement(MyDayStoryCard, { story, onOpenPeople: () => {}, onCreated: () => { created++; } }));
  const root = h.container;
  await settle();
  await click(byTextIncludes(root, 'button', 'Me time')[0]);
  await settle();
  await click(byTextIncludes(root, 'button', 'Workout')[0]);
  await settle();
  check('MD setup: My Day FIND ran and shows Add to my day', findBodies.length === 1 && findBodies[0].mode === 'FIND' && byText(root, 'button', 'Add to my day').length === 1);

  const postsStart = posts.length;
  postQueue.push(() => json(409, conflictAt(D1, '18:15', '19:00', 'Dentist')));
  await click(byText(root, 'button', 'Add to my day')[0]);
  await settle();
  const refused = posts[postsStart];
  check('R1-05 My Day recommended-time save sends overlapPolicy REJECT_ACTIVE_OVERLAP', posts.length === postsStart + 1 && refused.overlapPolicy === 'REJECT_ACTIVE_OVERLAP');
  check('R1-05 My Day payload is otherwise unchanged (same instants as the recommendation, no goal link added)', refused.plannedStartAt === start && refused.plannedEndAt === end && !('goalActivityId' in refused) && refused.activityId === null);
  const panel = () => root.querySelector('[data-testid="my-day-overlap-conflict"]') as HTMLElement | null;
  const tzLocal = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  check('R1-05 conflict is visible, names the proposed time and the conflicting plan', !!panel() && (panel()!.textContent ?? '').includes(formatPlanOverlapTime({ plannedStartAt: start, plannedEndAt: end }, tzLocal)) && (panel()!.textContent ?? '').includes('“Dentist”') && (panel()!.textContent ?? '').includes('Nothing was saved'));
  check('R1-05 conflict announced (role=alert) and focus moves to its heading', panel()?.getAttribute('role') === 'alert' && (document.activeElement as HTMLElement | null)?.id === 'my-day-overlap-heading');
  check('R1-05 no silent retry: still exactly one POST, not marked added', posts.length === postsStart + 1 && byTextIncludes(root, 'h2', 'Added to your day').length === 0 && created === 0);

  // Choose another time -> fresh constrained search
  await click(byText(panel()!, 'button', 'Choose another time')[0]);
  await settle();
  check('R1-05 Choose another time runs a fresh FIND for the same activity and writes nothing', findBodies.length === 2 && findBodies[1].activityId === 'workout' && posts.length === postsStart + 1 && !panel());

  // refuse again, then Save anyway with a rapid triple-click
  postQueue.push(() => json(409, conflictAt(D1, '18:15', '19:00', 'Dentist')));
  await click(byText(root, 'button', 'Add to my day')[0]);
  await settle();
  const refused2 = posts[posts.length - 1];
  postQueue.push(() => json(200, savedRow(refused2, 99)));
  holdNextPost = true;
  const sa = () => panel()?.querySelector('button[aria-label^="Save anyway"]') as HTMLButtonElement | null;
  check('R1-05 Save anyway shows the exact proposed start time', (sa()?.textContent ?? '') === `Save anyway at ${timeOf(start, tzLocal)}`);
  const beforeOverride = posts.length;
  await click(sa()!);
  await click(sa()!);
  await click(sa()!);
  await settle();
  check('R1-05 rapid triple-click sends exactly one override POST', posts.length === beforeOverride + 1);
  check('R1-05 override sends ALLOW with the byte-identical refused payload', posts[posts.length - 1].overlapPolicy === 'ALLOW' && JSON.stringify(withoutPolicy(posts[posts.length - 1])) === JSON.stringify(withoutPolicy(refused2)));
  await act(async () => { held.shift()!.resolve(); });
  await settle();
  check('R1-05 after the override succeeds the card shows Added to your day', byTextIncludes(root, 'h2', 'Added to your day').length === 1);

  // same-tick double "Add to my day"
  await click(byText(root, 'button', 'Done')[0]);
  await settle();
  await click(byTextIncludes(root, 'button', 'Me time')[0]);
  await settle();
  await click(byTextIncludes(root, 'button', 'Workout')[0]);
  await settle();
  const beforeMdTick = posts.length;
  postQueue.push(() => json(409, conflictAt(D1, '18:15', '19:00', 'Dentist')));
  holdNextPost = true;
  await clickTwiceSameTick(byText(root, 'button', 'Add to my day')[0]);
  await settle();
  check('R1-05 two same-tick clicks on "Add to my day" send exactly one POST', posts.length === beforeMdTick + 1);
  await act(async () => { held.shift()!.resolve(); });
  await settle();
  check('R1-05 refusal shown after the same-tick attempt, and no automatic retry fired', !!panel() && posts.length === beforeMdTick + 1);
  postQueue.push(() => json(200, savedRow(posts[posts.length - 1], 98)));
  holdNextPost = true;
  await clickTwiceSameTick(sa()!);
  await settle();
  check('R1-05 two same-tick clicks on "Save anyway" send exactly one POST', posts.length === beforeMdTick + 2);
  await act(async () => { held.shift()!.resolve(); });
  await settle();

  // non-overlap failure keeps the old generic handling
  await click(byText(root, 'button', 'Done')[0]);
  await settle();
  await click(byTextIncludes(root, 'button', 'Me time')[0]);
  await settle();
  await click(byTextIncludes(root, 'button', 'Workout')[0]);
  await settle();
  postQueue.push(() => json(500, { error: 'boom' }));
  await click(byText(root, 'button', 'Add to my day')[0]);
  await settle();
  check('R1-05 a non-overlap failure shows the existing generic error and no conflict panel', !panel() && byTextIncludes(root, 'div', 'Could not add this to your day').length >= 1);
  await h.unmount();
}

async function main() {
  await planTab();
  await myDay();
  await settle();
  check('no unhandled promise rejections (no hidden background save/retry)', unhandled.length === 0);
  console.log(`\n${count} checks`);
  if (!allPassed) {
    console.log('SOME CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL CHECKS PASSED');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
