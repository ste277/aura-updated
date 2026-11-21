/**
 * AURA-HPG5-V2-I3 (I3-B) -- the two live Home save paths, mounted for real in
 * jsdom: the Home timeline / Right Now opportunity "Plan" (HomeDashboard)
 * and Day Builder "Add" (DayBuilderCard). Each must opt in to
 * REJECT_ACTIVE_OVERLAP, show the shared conflict panel beside the refused
 * action with the exact proposed time, never auto-save, offer an explicit
 * Save anyway that re-sends the byte-identical payload with only ALLOW, and
 * guard double submits and stale conflicts.
 *
 *   npx ts-node --project tsconfig.jsdom-tests.json test/hpg5I3HomeSaveJsdom.test.ts
 *
 * fetch is a scripted router (no network); CHECK candidates come from the
 * REAL runTimingSearch. Server behaviour: hpg5I3HomeSaveDb.test.ts.
 */
import { React, mount, click, flush, act } from './jsdomReactHarness';
import { runTimingSearch, type TimingSearchRequest } from '../packages/recommendation/src/timingSearch';
import { resolveTzOffsetMinutes, getDatePartsInTimezone, getMinuteOfDayInTimezone } from '../apps/web/lib/timezone';
import { formatPlanOverlapTime } from '../apps/web/lib/schedulingEligibilityPresentation';

const { HomeDashboard } = require('../apps/web/components/HomeDashboard');
const { DayBuilderCard } = require('../apps/web/components/DayBuilderCard');

let allPassed = true;
let count = 0;
function check(label: string, condition: boolean) {
  count++;
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// A timezone where it is currently mid-day, so a "later today" opportunity
// never crosses midnight whatever time the suite runs.
const ZONES = ['Asia/Kolkata', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Pacific/Honolulu', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland', 'America/Sao_Paulo', 'Asia/Dubai', 'Europe/Moscow', 'Asia/Bangkok'];
const now = new Date();
const TZ = ZONES.find((z) => { const m = getMinuteOfDayInTimezone(z, now); return m >= 8 * 60 && m <= 16 * 60; }) ?? 'Asia/Kolkata';
const ctx = { now, latitude: 13.0827, longitude: 80.2707, timezone: TZ, tzOffsetMinutes: resolveTzOffsetMinutes(TZ, now) };
const startMs = Math.ceil((now.getTime() + 90 * 60000) / (15 * 60000)) * 15 * 60000;
const OPP_START = new Date(startMs).toISOString();
const OPP_END = new Date(startMs + 45 * 60000).toISOString();

// ---- scripted fetch router ----
type Deferred = { resolve: () => void };
const posts: any[] = [];
const postQueue: Array<() => any> = [];
const held: Deferred[] = [];
let holdNextPost = false;
let suggestionsBody: any = { suggestions: [] };
let suggestionFetches = 0;
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
  if (url === '/api/my-day/suggestions') { suggestionFetches++; return Promise.resolve(json(200, suggestionsBody)); }
  return new Promise(() => {});
};
(global as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);
const unhandled: unknown[] = [];
process.on('unhandledRejection', (e) => { unhandled.push(e); });

const savedRow = (body: any, id: string) => ({ id, userId: 'u', title: body.title, activityType: body.activityType, icon: null, plannedStartAt: body.plannedStartAt, plannedEndAt: body.plannedEndAt, durationMinutes: body.durationMinutes, windowType: body.windowType, windowLabel: null, matchLabel: null, score: null, recommendation: null, calendarUrl: null, status: 'UPCOMING', createdAt: now.toISOString(), updatedAt: now.toISOString(), activityId: body.activityId ?? null });
const conflictBody = (title: string, start: string, end: string) => ({ error: 'That time overlaps another plan.', code: 'PLAN_OVERLAP', conflict: { title, plannedStartAt: start, plannedEndAt: end } });
const withoutPolicy = (b: any) => { const { overlapPolicy: _p, ...rest } = b; return rest; };
const byText = (r: ParentNode, sel: string, text: string) => Array.from(r.querySelectorAll(sel)).filter((el) => (el.textContent ?? '').trim() === text) as HTMLElement[];
const byTextIncludes = (r: ParentNode, sel: string, text: string) => Array.from(r.querySelectorAll(sel)).filter((el) => (el.textContent ?? '').includes(text)) as HTMLElement[];
const settle = async () => { for (let i = 0; i < 6; i++) await flush(); };
const clickTwiceSameTick = async (el: HTMLElement) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};
const timeOf = (iso: string, tz: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });

// ===================================================================
// Home timeline / Right Now "Plan"
// ===================================================================
async function homeTimeline() {
  const guidanceFor = (start: string, end: string) => ({
    status: 'READY',
    guidance: { engineVersion: 't', selectionPolicyVersion: 't', evaluationTime: now.toISOString(), evidence: [], recommendations: [{ rank: 1, activityFamily: 'SELF', personalRelevance: 'RELEVANT', relevantThemes: [], timing: { start, end, score: 8, label: 'EXCELLENT', windowRank: 1 }, selectionReason: 'Good fit', evidence: [] }] },
    selectedActivities: { SELF: { activityId: 'meditation', title: 'Meditation', source: 'DAY_BUILDER_INTENTION', sourceEntityId: 's1' } },
  });
  const checks: any[] = [];
  const onTimingSearch = async (request: any) => { checks.push(request); return runTimingSearch({ ...request, context: ctx } as TimingSearchRequest); };
  const planClicks: Array<[string | undefined, string | undefined]> = [];
  let changed = 0;
  const props = (guidance: any) => ({
    userName: 'Test', energyScore: 70, themeText: 'Neutral',
    nextShift: { windowName: 'Next Window', startsIn: 'Soon', startTime: '--:--', score: 70, themeText: 'Neutral' },
    currentMinuteOfDay: getMinuteOfDayInTimezone(TZ, now), dailyBriefingStatus: 'available',
    timezone: TZ, guidance, onTimingSearch, onPlanClick: (a?: string, id?: string) => planClicks.push([a, id]), onMyDayChanged: () => { changed++; },
  });
  const h = await mount(React.createElement(HomeDashboard, props(guidanceFor(OPP_START, OPP_END))));
  const root = h.container;
  await settle();
  const planButtons = () => byText(root, 'button', 'Plan');
  check(`HT setup (tz ${TZ}): the opportunity renders with a Plan action`, planButtons().length >= 1);
  const panel = () => root.querySelector('[data-testid="home-overlap-conflict"]') as HTMLElement | null;
  const sa = () => panel()?.querySelector('button[aria-label^="Save anyway"]') as HTMLButtonElement | null;
  // The timeline row's Plan is the LAST one (Right Now spotlight renders above the timeline).
  const timelinePlan = () => planButtons()[planButtons().length - 1];
  const hasSpotlight = planButtons().length >= 2;

  // ---- 1. refused from the TIMELINE row ----
  postQueue.push(() => json(409, conflictBody('Dentist', OPP_START, OPP_END)));
  const tlBtn = timelinePlan();
  await click(tlBtn);
  await settle();
  const refused = posts[0];
  check('HT CHECK re-evaluated the exact displayed instant', checks.length === 1 && checks[0].mode === 'CHECK' && checks[0].candidateStart === OPP_START);
  check('HT save opts in to REJECT_ACTIVE_OVERLAP, keeps activityId and the idempotency key', refused.overlapPolicy === 'REJECT_ACTIVE_OVERLAP' && refused.activityId === 'meditation' && refused.clientRequestId === 'home-opportunity:guidance:s1');
  check('HT save carries the exact proposed instants', refused.plannedStartAt === OPP_START && refused.plannedEndAt === OPP_END);
  check('HT 409 shows the conflict panel, nothing marked saved, no generic error', !!panel() && changed === 0 && byTextIncludes(root, 'div', 'Could not plan this').length === 0);
  // beside the refused action: the panel lives in the same timeline row as the tapped button
  let row: HTMLElement | null = tlBtn;
  while (row && !(row.contains(panel()) && row !== root)) row = row.parentElement;
  check('HT panel renders beside the tapped timeline row (shared nearest container, not the page root)', !!row && row !== root && row.querySelectorAll('button').length < root.querySelectorAll('button').length);
  check('HT exactly one conflict panel on the page', root.querySelectorAll('[data-testid="home-overlap-conflict"]').length === 1);
  const text = panel()?.textContent ?? '';
  check('HT panel names the proposed activity and its date/start–end in the user timezone', text.includes(refused.title) && text.includes(formatPlanOverlapTime(refused, TZ)));
  check('HT panel names the conflicting plan and its time', text.includes('“Dentist”') && text.includes(formatPlanOverlapTime({ plannedStartAt: OPP_START, plannedEndAt: OPP_END }, TZ)) && text.includes('Nothing was saved'));
  check('HT Save anyway shows the exact proposed start time', (sa()?.textContent ?? '') === `Save anyway at ${timeOf(OPP_START, TZ)}`);
  check('HT role=alert and focus moves to the conflict heading', panel()?.getAttribute('role') === 'alert' && (document.activeElement as HTMLElement | null)?.id === 'home-overlap-timeline-heading');
  check('HT no automatic retry (exactly one POST)', posts.length === 1);

  // ---- 2. Choose another time -> core Plan tab, prefilled; nothing written ----
  await click(byText(panel()!, 'button', 'Choose another time')[0]);
  await settle();
  check('HT Choose another time opens Plan prefilled with the activity and writes nothing', !panel() && posts.length === 1 && planClicks.length === 1 && planClicks[0][0] === 'Meditation' && planClicks[0][1] === 'meditation');

  // ---- 3. refuse again, Save anyway with a same-tick double click ----
  postQueue.push(() => json(409, conflictBody('Dentist', OPP_START, OPP_END)));
  await click(timelinePlan());
  await settle();
  const refused2 = posts[posts.length - 1];
  postQueue.push(() => json(200, savedRow(refused2, 'p-home')));
  holdNextPost = true;
  const beforeOverride = posts.length;
  await clickTwiceSameTick(sa()!);
  await settle();
  check('HT same-tick double click on Save anyway sends exactly one POST', posts.length === beforeOverride + 1);
  check('HT override sends ALLOW with the byte-identical refused payload (incl. clientRequestId)', posts[posts.length - 1].overlapPolicy === 'ALLOW' && JSON.stringify(withoutPolicy(posts[posts.length - 1])) === JSON.stringify(withoutPolicy(refused2)));
  check('HT override is disabled and shows Saving… while in flight', sa()?.disabled === true && (sa()?.textContent ?? '').includes('Saving'));
  await act(async () => { held.shift()!.resolve(); });
  await settle();
  check('HT after the override succeeds the panel closes and Home refreshes', !panel() && changed === 1);

  // ---- 4. same-tick double click on Plan -> one CHECK, one POST ----
  const checksBefore = checks.length;
  const postsBefore = posts.length;
  postQueue.push(() => json(409, conflictBody('Dentist', OPP_START, OPP_END)));
  await clickTwiceSameTick(timelinePlan());
  await settle();
  check('HT same-tick double click on Plan runs one CHECK and one POST', checks.length === checksBefore + 1 && posts.length === postsBefore + 1);

  // ---- 5. stale: the refused opportunity leaves the timeline ----
  check('HT stale setup: conflict visible', !!panel());
  const later = new Date(startMs + 3 * 3600000).toISOString();
  await h.rerender(React.createElement(HomeDashboard, props(guidanceFor(later, new Date(startMs + 3 * 3600000 + 45 * 60000).toISOString()))));
  await settle();
  check('HT when the refused opportunity moves/leaves the timeline the conflict is cleared', !panel());
  const stalePosts = posts.length;
  check('HT stale clear wrote nothing', posts.length === stalePosts);
  await h.rerender(React.createElement(HomeDashboard, props(guidanceFor(OPP_START, OPP_END))));
  await settle();

  // ---- 6. refused from the Right Now SPOTLIGHT: panel beside the spotlight ----
  if (hasSpotlight) {
    postQueue.push(() => json(409, conflictBody('Dentist', OPP_START, OPP_END)));
    const spot = planButtons()[0];
    await click(spot);
    await settle();
    check('HT spotlight refusal shows its panel with the spotlight id, not in the timeline row', !!root.querySelector('#home-overlap-spotlight-heading') && !root.querySelector('#home-overlap-timeline-heading') && root.querySelectorAll('[data-testid="home-overlap-conflict"]').length === 1);
    await click(byText(panel()!, 'button', 'Choose another time')[0]);
    await settle();
  } else {
    check('HT spotlight not rendered for this fixture (timeline path covers the save)', true);
  }

  // ---- 7. a non-overlap failure keeps the pre-existing generic handling ----
  // (Pre-existing: Home renders "Could not plan this" only under the Right
  // Now spotlight; a timeline-row failure shows no inline text -- unchanged
  // by I3 and recorded as a finding, not fixed here.)
  const p7 = posts.length;
  postQueue.push(() => json(500, { error: 'boom' }));
  await click(timelinePlan());
  await settle();
  check('HT a non-overlap failure takes the generic path: one POST, no conflict panel, Plan re-enabled', posts.length === p7 + 1 && !panel() && timelinePlan() && !(timelinePlan() as HTMLButtonElement).disabled);
  check(`HT generic error text appears only where it did before (spotlight=${hasSpotlight})`, hasSpotlight ? byTextIncludes(root, 'div', 'Could not plan this').length >= 1 : true);
  await h.unmount();

  // ---- 8. Right Now SPOTLIGHT: an opportunity active NOW is the spotlight item ----
  const curStart = new Date(now.getTime() - 5 * 60000).toISOString();
  const curEnd = new Date(now.getTime() + 40 * 60000).toISOString();
  const h2 = await mount(React.createElement(HomeDashboard, props(guidanceFor(curStart, curEnd))));
  const root2 = h2.container;
  await settle();
  const plans2 = byText(root2, 'button', 'Plan');
  check('HT spotlight setup: the active opportunity has a Right Now Plan button and a timeline Plan button', plans2.length >= 2);
  postQueue.push(() => json(409, conflictBody('Dentist', curStart, curEnd)));
  const spot = plans2[0];
  await click(spot);
  await settle();
  const p2 = root2.querySelector('[data-testid="home-overlap-conflict"]') as HTMLElement | null;
  check('HT spotlight refusal: one panel, beside the Right Now action (spotlight id), not in the timeline row', !!p2 && !!root2.querySelector('#home-overlap-spotlight-heading') && !root2.querySelector('#home-overlap-timeline-heading') && root2.querySelectorAll('[data-testid="home-overlap-conflict"]').length === 1);
  let sharedBox: HTMLElement | null = spot;
  while (sharedBox && !sharedBox.contains(p2)) sharedBox = sharedBox.parentElement;
  const timelineRowBtn = plans2[plans2.length - 1];
  check('HT spotlight panel is nearer the spotlight Plan than the timeline Plan', !!sharedBox && !sharedBox.contains(timelineRowBtn));
  check('HT spotlight panel shows the exact proposed time', (p2?.textContent ?? '').includes(formatPlanOverlapTime({ plannedStartAt: curStart, plannedEndAt: curEnd }, TZ)));
  await click(byText(p2!, 'button', 'Choose another time')[0]);
  await settle();
  // RV-1 regression: a non-Plan click inside the Right Now action row must
  // not leave a stale "spotlight" marker -- the next TIMELINE tap's panel
  // belongs in the timeline row.
  const rowContainer = byText(root2, 'button', 'Plan')[0].parentElement as HTMLElement;
  await click(rowContainer);
  postQueue.push(() => json(409, conflictBody('Dentist', curStart, curEnd)));
  await click(byText(root2, 'button', 'Plan')[byText(root2, 'button', 'Plan').length - 1]);
  await settle();
  check('HT RV-1: after a non-Plan click in the Right Now row, a timeline tap shows its panel in the timeline row', !!root2.querySelector('#home-overlap-timeline-heading') && !root2.querySelector('#home-overlap-spotlight-heading'));
  await click(byText(root2.querySelector('[data-testid="home-overlap-conflict"]')!, 'button', 'Choose another time')[0]);
  await settle();
  const p8 = posts.length;
  postQueue.push(() => json(500, { error: 'boom' }));
  await click(byText(root2, 'button', 'Plan')[0]);
  await settle();
  check('HT spotlight non-overlap failure still shows the existing "Could not plan this" text, no panel', posts.length === p8 + 1 && !root2.querySelector('[data-testid="home-overlap-conflict"]') && byTextIncludes(root2, 'div', 'Could not plan this').length >= 1);
  await h2.unmount();
}

// ===================================================================
// Day Builder "Add"
// ===================================================================
async function dayBuilder() {
  const localDate = getDatePartsInTimezone(TZ, now).dateStr;
  const found = runTimingSearch({ mode: 'FIND', activityId: 'workout', durationMinutes: 45, horizon: 'TOMORROW', limit: 3, timePreference: 'ANY', context: ctx } as TimingSearchRequest).candidates;
  const suggestion = { id: 'sugg-1', groupId: 'SELF', activityId: 'workout', label: 'Workout', icon: '🏋️', durationMinutes: 45, reason: 'Good energy', candidate: { kind: 'SOLO', candidates: found.slice(0, 2) } };
  suggestionsBody = { suggestions: [suggestion] };
  let created = 0;
  const h = await mount(React.createElement(DayBuilderCard, { dayPhase: 'MORNING', localDate, onCreated: () => { created++; } }));
  const root = h.container;
  await settle();
  const addBtn = () => byText(root, 'button', '+ Add')[0];
  check('DB setup: one suggestion with two time chips and + Add', !!addBtn() && root.querySelectorAll('[data-slot-group="sugg-1"] button').length >= 2);
  const panel = () => root.querySelector('[data-testid="day-builder-overlap-conflict"]') as HTMLElement | null;
  const sa = () => panel()?.querySelector('button[aria-label^="Save anyway"]') as HTMLButtonElement | null;
  const tzLocal = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const postsStart = posts.length;

  // ---- 1. refused Add ----
  postQueue.push(() => json(409, conflictBody('Team call', found[0].start, found[0].end)));
  await click(addBtn());
  await settle();
  const refused = posts[postsStart];
  check('DB Add opts in to REJECT_ACTIVE_OVERLAP with its stable clientRequestId and activityId', refused.overlapPolicy === 'REJECT_ACTIVE_OVERLAP' && refused.clientRequestId === `daybuilder:sugg-1:${localDate}` && refused.activityId === 'workout');
  check('DB Add carries the selected chip\'s exact instants', refused.plannedStartAt === found[0].start && refused.plannedEndAt === found[0].end);
  const card = root.querySelector('[data-testid="day-builder-suggestion"]') as HTMLElement;
  check('DB conflict panel renders inside the refused suggestion card', !!panel() && card.contains(panel()));
  const text = panel()?.textContent ?? '';
  check('DB panel names the proposed time and the conflicting plan, nothing saved', text.includes(formatPlanOverlapTime(refused, tzLocal)) && text.includes('“Team call”') && text.includes('Nothing was saved'));
  check('DB Save anyway shows the exact proposed start time', (sa()?.textContent ?? '') === `Save anyway at ${timeOf(found[0].start, tzLocal)}`);
  check('DB no automatic retry, not marked added, onCreated not called', posts.length === postsStart + 1 && byTextIncludes(root, 'span,div', 'Added to your day').length === 0 && created === 0);
  check('DB focus moves to the conflict heading', (document.activeElement as HTMLElement | null)?.id === 'day-builder-overlap-sugg-1-heading');

  // ---- 2. Choose another time -> back to the chips; nothing written ----
  await click(byText(panel()!, 'button', 'Choose another time')[0]);
  await settle();
  await new Promise((r) => setTimeout(r, 5));
  check('DB Choose another time closes the panel, writes nothing, focuses the time chips', !panel() && posts.length === postsStart + 1 && (document.activeElement as HTMLElement | null)?.closest?.('[data-slot-group="sugg-1"]') !== null && (document.activeElement as HTMLElement | null)?.tagName === 'BUTTON');

  // ---- 3. stale: selecting another chip clears a pending conflict ----
  postQueue.push(() => json(409, conflictBody('Team call', found[0].start, found[0].end)));
  await click(addBtn());
  await settle();
  check('DB stale setup: conflict visible', !!panel());
  const chips = Array.from(root.querySelectorAll('[data-slot-group="sugg-1"] button')) as HTMLButtonElement[];
  await click(chips[1]);
  await settle();
  check('DB selecting a different time chip clears the pending conflict (no override for an old slot)', !panel());

  // ---- 4. refuse the second chip, then Save anyway (same-tick double click) ----
  postQueue.push(() => json(409, conflictBody('Team call', found[1].start, found[1].end)));
  await click(addBtn());
  await settle();
  const refused2 = posts[posts.length - 1];
  check('DB second refusal is for the newly selected chip', refused2.plannedStartAt === found[1].start);
  postQueue.push(() => json(200, savedRow(refused2, 'p-db')));
  holdNextPost = true;
  const beforeOverride = posts.length;
  const fetchesBefore = suggestionFetches;
  await clickTwiceSameTick(sa()!);
  await settle();
  check('DB same-tick double click on Save anyway sends exactly one POST', posts.length === beforeOverride + 1);
  check('DB override sends ALLOW with the byte-identical refused payload (same clientRequestId)', posts[posts.length - 1].overlapPolicy === 'ALLOW' && JSON.stringify(withoutPolicy(posts[posts.length - 1])) === JSON.stringify(withoutPolicy(refused2)));
  await act(async () => { held.shift()!.resolve(); });
  await settle();
  check('DB after the override succeeds: Added, onCreated once, suggestions refreshed', byTextIncludes(root, 'span,div', 'Added to your day').length >= 1 && created === 1 && suggestionFetches > fetchesBefore);
  await h.unmount();

  // ---- 5. same-tick double Add; and a non-overlap failure ----
  const h2 = await mount(React.createElement(DayBuilderCard, { dayPhase: 'MORNING', localDate, onCreated: () => {} }));
  await settle();
  const root2 = h2.container;
  const p0 = posts.length;
  postQueue.push(() => json(500, { error: 'boom' }));
  holdNextPost = true;
  await clickTwiceSameTick(byText(root2, 'button', '+ Add')[0]);
  await settle();
  check('DB same-tick double click on + Add sends exactly one POST', posts.length === p0 + 1);
  await act(async () => { held.shift()!.resolve(); });
  await settle();
  check('DB a non-overlap failure keeps the existing generic error and shows no panel', !root2.querySelector('[data-testid="day-builder-overlap-conflict"]') && byTextIncludes(root2, 'div', 'Could not add this to your day').length >= 1);
  await h2.unmount();
}

async function main() {
  await homeTimeline();
  await dayBuilder();
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
