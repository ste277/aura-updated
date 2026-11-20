/**
 * AURA-HPG5-V2-I1 -- T24: the REAL mounted Plan tab (PlanWithAuraView) in
 * jsdom, driving Find a Time's "Use this time" through a PLAN_OVERLAP
 * refusal, "Choose another time" and an explicit "Save anyway".
 *
 *   npx ts-node --project tsconfig.jsdom-tests.json test/findATimeConflictJsdom.test.ts
 *
 * fetch is a scripted router (no network); onTimingSearch returns REAL
 * runTimingSearch candidates. Scope: the component's own save flow and DOM
 * -- the server side is covered by findATimeConstraintsDb.test.ts.
 */
import { React, mount, click, flush, typeInto, act } from './jsdomReactHarness';
import { runTimingSearch, type TimingSearchRequest } from '../packages/recommendation/src/timingSearch';
import { resolveTzOffsetMinutes, localDateTimeToUTC, getDatePartsInTimezone, addDaysToDateStr } from '../apps/web/lib/timezone';

const { PlanWithAuraView } = require('../apps/web/components/PlanWithAuraView');

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
type Deferred = { resolve: (r: any) => void };
const posts: any[] = [];
const postQueue: Array<() => any> = [];
const held: Deferred[] = [];
let holdNextPost = false;
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
  if (url === '/api/plans') return Promise.resolve(json(200, []));
  if (url === '/api/goals') return Promise.resolve(json(200, [{ id: 'goal-1', title: 'Move my body' }]));
  if (url === '/api/goals/goal-1') return Promise.resolve(json(200, { activities: [{ id: 'ga-run', title: 'Run', activityId: null, derivedState: 'SUGGESTED' }] }));
  return new Promise(() => {}); // unrelated child fetches stay pending
};
(global as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);

const savedRow = (body: any) => ({ id: `plan-${posts.length}`, userId: 'u', title: body.title, activityType: body.activityType, icon: null, plannedStartAt: body.plannedStartAt, plannedEndAt: body.plannedEndAt, durationMinutes: body.durationMinutes, windowType: body.windowType, windowLabel: body.windowLabel ?? null, matchLabel: body.matchLabel ?? null, score: body.score ?? null, recommendation: body.recommendation ?? null, calendarUrl: null, status: 'UPCOMING', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), activityId: null });
const conflictBody = { error: 'That time overlaps another plan.', code: 'PLAN_OVERLAP', conflict: { title: 'Team call', plannedStartAt: localDateTimeToUTC(D1, '19:30', TZ).toISOString(), plannedEndAt: localDateTimeToUTC(D1, '20:00', TZ).toISOString() } };

// ---- real timing search ----
const searches: any[] = [];
const onTimingSearch = async (request: any) => {
  searches.push(request);
  const context = { now, latitude: 13.0827, longitude: 80.2707, timezone: TZ, tzOffsetMinutes: resolveTzOffsetMinutes(TZ, now) };
  if (request.mode === 'CHECK') return runTimingSearch({ ...request, context } as TimingSearchRequest);
  return { ...runTimingSearch({ ...request, horizon: 'TOMORROW', context } as TimingSearchRequest), constraintsApplied: { availability: 'UNCONFIGURED', blockedPlanCount: 0 } };
};

const byText = (root: HTMLElement, selector: string, text: string) => Array.from(root.querySelectorAll(selector)).filter((el) => (el.textContent ?? '').trim() === text) as HTMLElement[];
const byTextIncludes = (root: HTMLElement, selector: string, text: string) => Array.from(root.querySelectorAll(selector)).filter((el) => (el.textContent ?? '').includes(text)) as HTMLElement[];
const settle = async () => { for (let i = 0; i < 4; i++) await flush(); };

async function main() {
  const h = await mount(React.createElement(PlanWithAuraView, { onTimingSearch, timezone: TZ }));
  const root = h.container;
  await settle();

  // Explicit goal link (HPG2 picker) -> also sets the task title "Run".
  await click(byText(root, 'button', '+ Link to a Goal')[0]);
  await settle();
  await click(byText(root, 'button', 'Move my body')[0]);
  await settle();
  await click(byText(root, 'button', 'Run')[0]);
  await settle();
  check('setup: goal activity linked in the Plan tab', byTextIncludes(root, 'p', 'Linked to').length === 1);

  const findBtn = byTextIncludes(root, 'button', 'Find My Best Time')[0];
  await click(findBtn);
  await settle();
  const useButtons = () => byText(root, 'button', 'Use this time');
  check('setup: Find a Time rendered results with "Use this time"', useButtons().length >= 1);

  // ---- 1. refusal ----
  postQueue.push(() => json(409, conflictBody));
  await click(useButtons()[0]);
  await settle();
  const alert = () => root.querySelector('[data-testid="plan-overlap-conflict"]') as HTMLElement | null;
  check('T24 Use this time sends overlapPolicy REJECT_ACTIVE_OVERLAP', posts.length === 1 && posts[0].overlapPolicy === 'REJECT_ACTIVE_OVERLAP');
  check('T24 ... with the explicit goal link', posts[0].goalActivityId === 'ga-run');
  check('T24 409 shows the conflict with role="alert"', !!alert() && alert()!.getAttribute('role') === 'alert');
  check('T24 conflict names the plan and its time', (alert()?.textContent ?? '').includes('“Team call”') && (alert()?.textContent ?? '').includes('7:30 PM'));
  check('T24 conflict says nothing was saved', (alert()?.textContent ?? '').includes('Nothing was saved'));
  check('T24 alert is labelled and described for screen readers', alert()?.getAttribute('aria-labelledby') === 'plan-overlap-heading' && alert()?.getAttribute('aria-describedby') === 'plan-overlap-detail');
  check('T24 focus moves to the conflict heading', (document.activeElement as HTMLElement | null)?.id === 'plan-overlap-heading');
  check('T24 never auto-saves after the conflict (still exactly one POST)', posts.length === 1);
  check('T24 the card is not marked Planned', byText(root, 'button', 'Planned').length === 0);
  check('T24 no generic error banner for an overlap', byTextIncludes(root, '[role="alert"]', 'Unable to save').length === 0);
  const saveAnyway = () => root.querySelector('[data-testid="plan-overlap-conflict"] button[aria-label^="Save anyway"]') as HTMLButtonElement | null;
  // AURA-HPG5-V2-I2 (R1-04): the accessible name now leads with the exact
  // proposed time and activity, and still names the conflicting plan.
  check('T24 Save anyway has an accessible name naming the conflict', /^Save anyway at .+: .+, overlapping Team call$/.test(saveAnyway()?.getAttribute('aria-label') ?? ''));
  check('T24 both actions are real buttons, at least 44px tall', !!saveAnyway() && byText(alert()!, 'button', 'Choose another time').length === 1 && saveAnyway()!.style.minHeight === '44px');

  // ---- 2. Choose another time ----
  await click(byText(alert()!, 'button', 'Choose another time')[0]);
  await settle();
  check('T24 Choose another time dismisses the conflict, results stay', !alert() && useButtons().length >= 1);
  check('T24 Choose another time returns focus to the results', (document.activeElement as HTMLElement | null)?.getAttribute('tabindex') === '-1' && (document.activeElement?.textContent ?? '').includes("Aura's Best Moments"));
  check('T24 Choose another time writes nothing', posts.length === 1);

  // ---- 3. refusal again, then Save anyway (held response -> double-click guard) ----
  postQueue.push(() => json(409, conflictBody));
  await click(useButtons()[0]);
  await settle();
  check('T24 second attempt refused again', !!alert() && posts.length === 2 && posts[1].overlapPolicy === 'REJECT_ACTIVE_OVERLAP');
  postQueue.push(() => json(200, savedRow(posts[posts.length - 1])));
  holdNextPost = true;
  await click(saveAnyway()!);
  await settle();
  check('T24 Save anyway shows Saving… and is disabled while in flight', saveAnyway()?.disabled === true && (saveAnyway()?.textContent ?? '').includes('Saving'));
  await click(saveAnyway()!);
  await click(saveAnyway()!);
  await settle();
  check('T24 repeated clicks while saving submit only once', posts.length === 3);
  check('T24 Save anyway sends overlapPolicy ALLOW', posts[2].overlapPolicy === 'ALLOW');
  check('T24 Save anyway keeps the same time and goal link', posts[2].plannedStartAt === posts[1].plannedStartAt && posts[2].plannedEndAt === posts[1].plannedEndAt && posts[2].goalActivityId === 'ga-run');
  await act(async () => { held.shift()!.resolve(null); });
  await settle();
  check('T24 after a successful Save anyway the conflict closes and the card is Planned', !alert() && byText(root, 'button', 'Planned').length === 1);
  check('T24 goal link consumed only on success (linker reset)', byTextIncludes(root, 'p', 'Linked to').length === 0);

  // ---- 4. a new search hides a pending conflict (stale) ----
  postQueue.push(() => json(409, conflictBody));
  const unplanned = useButtons();
  await click(unplanned[0]);
  await settle();
  check('T24 stale guard setup: conflict visible', !!alert());
  await click(byTextIncludes(root, 'button', 'Find My Best Time')[0]);
  await settle();
  check('T24 a new search clears the pending conflict (no Save anyway on stale data)', !alert());

  // ---- 4b. changing the goal link (Unlink) hides a pending conflict ----
  // The picker stays open after the first link (selection cleared on success).
  for (const label of ['+ Link to a Goal', 'Move my body']) {
    const b = byText(root, 'button', label)[0];
    if (b) { await click(b); await settle(); }
  }
  await click(byText(root, 'button', 'Run')[0]);
  await settle();
  check('T24 relink setup: goal activity linked again', byTextIncludes(root, 'p', 'Linked to').length === 1);
  await click(byTextIncludes(root, 'button', 'Find My Best Time')[0]);
  await settle();
  postQueue.push(() => json(409, conflictBody));
  await click(useButtons()[0]);
  await settle();
  check('T24 relinked attempt carries the goal link and is refused', !!alert() && posts[posts.length - 1].goalActivityId === 'ga-run');
  await click(byText(root, 'button', 'Unlink')[0]);
  await settle();
  check('T24 Unlink hides the pending conflict (it belonged to the old link)', !alert());

  // ---- 5. a non-overlap failure keeps the old generic handling ----
  postQueue.push(() => json(500, { error: 'boom' }));
  await click(useButtons()[0]);
  await settle();
  check('T24 non-overlap failure: generic error, no conflict panel', !alert() && byTextIncludes(root, '[role="alert"]', 'Unable to save this plan').length === 1);
  const postsBeforeCheck = posts.length;

  // ---- 6. Check a Time keeps explicit-time behaviour (no overlapPolicy) ----
  await click(byText(root, 'button', 'Check a Time')[0]);
  await settle();
  const inputs = Array.from(root.querySelectorAll('input')) as HTMLInputElement[];
  const titleInput = inputs.find((i) => i.placeholder === 'e.g. Important meeting')!;
  const dateInput = inputs.find((i) => i.type === 'date')!;
  const timeInput = inputs.find((i) => i.type === 'time')!;
  await typeInto(titleInput, 'Workout');
  await typeInto(dateInput, D1);
  await typeInto(timeInput, '19:30');
  await settle();
  await click(byTextIncludes(root, 'button', 'Check This Time')[0]);
  await settle();
  check('T16 UI: Check a Time searched the exact instant (mode CHECK)', searches[searches.length - 1].mode === 'CHECK' && searches[searches.length - 1].candidateStart === localDateTimeToUTC(D1, '19:30', TZ).toISOString());
  postQueue.push(() => json(200, savedRow({ title: 'Workout', activityType: 'Workout', plannedStartAt: localDateTimeToUTC(D1, '19:30', TZ).toISOString(), plannedEndAt: localDateTimeToUTC(D1, '20:30', TZ).toISOString(), durationMinutes: 60, windowType: 'NEUTRAL' })));
  await click(useButtons()[0]);
  await settle();
  check('T16 UI: Check a Time save posts the explicit time without overlapPolicy (manual semantics unchanged)', posts.length === postsBeforeCheck + 1 && !('overlapPolicy' in posts[posts.length - 1]) && posts[posts.length - 1].plannedStartAt === localDateTimeToUTC(D1, '19:30', TZ).toISOString());

  await h.unmount();
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
