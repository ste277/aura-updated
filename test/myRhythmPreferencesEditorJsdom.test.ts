/**
 * AURA-MR3 -- real mounted-component tests for components/RhythmSettingsEditor.tsx
 * (React 18 + jsdom via test/jsdomReactHarness.ts). `fetch` is stubbed so
 * every request body the component sends is captured and every response
 * (success, validation error, network failure, slow) is controlled.
 *
 * Run with:
 *   npx ts-node --project tsconfig.jsdom-tests.json test/myRhythmPreferencesEditorJsdom.test.ts
 */
import { React, mount, click, typeInto, act } from './jsdomReactHarness';

const { RhythmSettingsEditor } = require('../apps/web/components/RhythmSettingsEditor');

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean): void {
  if (condition) {
    passed++;
    console.log(`OK   ${label}`);
  } else {
    failed++;
    console.log(`FAIL ${label}`);
  }
}

type Reply = { status: number; body?: unknown } | 'NETWORK' | { pending: Promise<{ status: number; body?: unknown }> };
let calls: Array<{ url: string; method: string; body: any }> = [];
let replies: Reply[] = [];
(global as any).fetch = async (url: string, init: any) => {
  calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined });
  const reply = replies.shift() ?? { status: 200, body: {} };
  if (reply === 'NETWORK') throw new TypeError('Failed to fetch');
  const resolved = 'pending' in reply ? await reply.pending : reply;
  return { ok: resolved.status >= 200 && resolved.status < 300, status: resolved.status, json: async () => resolved.body ?? {} };
};

const buttons = (root: HTMLElement) => Array.from(root.querySelectorAll('button')) as HTMLButtonElement[];
const byText = (root: HTMLElement, text: string) => buttons(root).find((b) => b.textContent?.trim() === text);
const byLabel = (root: HTMLElement, label: string) => buttons(root).find((b) => b.getAttribute('aria-label') === label);
const text = (root: HTMLElement) => root.textContent ?? '';
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

const CONFIGURED = { frequency: { kind: 'N_PER_WEEK', targetPerWeek: 3 }, preferences: { preferredWeekdays: [1, 3, 5], preferredTimeOfDay: 'MORNING', preferredDurationMinutes: 45 }, oncePerDay: true };
const PLAIN = { frequency: { kind: 'N_PER_WEEK', targetPerWeek: 3 }, preferences: { preferredWeekdays: [], preferredTimeOfDay: null, preferredDurationMinutes: null }, oncePerDay: true };
const ONCE = { frequency: { kind: 'NONE' }, preferences: { preferredWeekdays: [], preferredTimeOfDay: null, preferredDurationMinutes: null }, oncePerDay: true };

async function render(saved: unknown, paused = false) {
  let savedCount = 0;
  const h = await mount(React.createElement(RhythmSettingsEditor, { goalId: 'g1', goalActivityId: 'a1', saved, paused, onSaved: () => { savedCount++; } }));
  return { h, root: h.container, saves: () => savedCount };
}

async function main() {
  // ---------------------------------------------------------------
  // Collapsed state
  // ---------------------------------------------------------------
  {
    const { h, root } = await render(CONFIGURED);
    check('J1. collapsed: shows the saved summary, "Edit rhythm" and "Pause rhythm"', /Mon, Wed, Fri · Morning · 45 min/.test(text(root)) && !!byText(root, 'Edit rhythm') && !!byText(root, 'Pause rhythm'));
    check('J2. collapsed: no editor controls rendered yet', !byLabel(root, 'Monday') && !byText(root, 'Save changes'));
    await h.unmount();
  }
  {
    const { h, root } = await render(ONCE);
    check('J3. a one-off activity offers "Set weekly frequency" and no Pause', !!byText(root, 'Set weekly frequency') && !byText(root, 'Pause rhythm'));
    await h.unmount();
  }

  // ---------------------------------------------------------------
  // Progressive disclosure + scenario 1 from a plain rhythm
  // ---------------------------------------------------------------
  {
    calls = [];
    replies = [{ status: 200 }];
    const { h, root, saves } = await render(PLAIN);
    await click(byText(root, 'Edit rhythm')!);
    check('J4. plain rhythm: preferences start hidden behind "Add days, time or length (optional)"', !!byText(root, 'Add days, time or length (optional)') && !byLabel(root, 'Monday'));
    check('J5. untouched editor: Save changes is disabled (nothing to save)', byText(root, 'Save changes')!.disabled);
    await click(byText(root, 'Add days, time or length (optional)')!);
    check('J6. disclosure reveals 7 weekday chips (Mon..Sun), 5 time options and length chips', ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].every((d) => !!byLabel(root, d)) && ['Any time', 'Morning', 'Afternoon', 'Evening', 'Night'].every((t) => !!byText(root, t)) && !!byText(root, '45 min') && !!byText(root, 'Default'));
    for (const d of ['Monday', 'Wednesday', 'Friday']) await click(byLabel(root, d)!);
    await click(byText(root, 'Morning')!);
    await click(byText(root, '45 min')!);
    check('J7. chosen days are pressed', ['Monday', 'Wednesday', 'Friday'].every((d) => byLabel(root, d)!.getAttribute('aria-pressed') === 'true') && byLabel(root, 'Tuesday')!.getAttribute('aria-pressed') === 'false');
    check('J8. the time hint explains the window and the fallback', /5 AM – 12 PM/.test(text(root)) && /best time that day/.test(text(root)));
    await click(byText(root, 'Save changes')!);
    await flush();
    check('J9. Save sends ONE PATCH to the rhythm endpoint with exactly the three preferences', calls.length === 1 && calls[0].method === 'PATCH' && calls[0].url === '/api/goals/g1/activities/a1/rhythm' && JSON.stringify(calls[0].body) === JSON.stringify({ preferences: { preferredWeekdays: [1, 3, 5], preferredTimeOfDay: 'MORNING', preferredDurationMinutes: 45 } }));
    check('J10. on success the editor closes and onSaved fires once', saves() === 1 && !byText(root, 'Save changes'));
    await h.unmount();
  }

  // ---------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------
  {
    calls = [];
    const { h, root, saves } = await render(CONFIGURED);
    await click(byText(root, 'Edit rhythm')!);
    check('J11. a configured rhythm opens with its preferences visible and selected', byLabel(root, 'Monday')!.getAttribute('aria-pressed') === 'true' && byText(root, 'Morning')!.getAttribute('aria-pressed') === 'true' && byText(root, '45 min')!.getAttribute('aria-pressed') === 'true');
    await click(byLabel(root, 'Tuesday')!);
    await click(byText(root, 'Cancel')!);
    check('J12. Cancel sends nothing and closes', calls.length === 0 && saves() === 0 && !byText(root, 'Save changes'));
    await click(byText(root, 'Edit rhythm')!);
    check('J13. re-opening after Cancel shows the SAVED values, not the abandoned edit', byLabel(root, 'Tuesday')!.getAttribute('aria-pressed') === 'false');
    await h.unmount();
  }

  // ---------------------------------------------------------------
  // Validation: frequency vs days, invalid duration
  // ---------------------------------------------------------------
  {
    calls = [];
    const { h, root } = await render(CONFIGURED);
    await click(byText(root, 'Edit rhythm')!);
    await click(byLabel(root, 'Friday')!);
    check('J14. 3x/week with 2 days: explained, and Save disabled', /3 times a week needs at least 3 preferred days/.test(text(root)) && byText(root, 'Save changes')!.disabled);
    await click(byLabel(root, 'Friday')!);
    await click(byText(root, 'Other')!);
    const input = root.querySelector('#rhythm-a1-duration') as HTMLInputElement;
    await typeInto(input, '5');
    check('J15. a 5-minute custom length is explained and blocks Save', /from 15 to 360/.test(text(root)) && byText(root, 'Save changes')!.disabled);
    await typeInto(input, '40');
    check('J16. a valid custom length (40) re-enables Save', !byText(root, 'Save changes')!.disabled);
    check('J17. nothing was sent while invalid', calls.length === 0);
    await h.unmount();
  }

  // ---------------------------------------------------------------
  // Failed saves: server error, network error, retry
  // ---------------------------------------------------------------
  {
    calls = [];
    replies = [{ status: 400, body: { error: 'A rhythm of 3 times a week needs at least 3 preferred days; 2 days selected.' } }, 'NETWORK', { status: 200 }];
    const { h, root, saves } = await render(CONFIGURED);
    await click(byText(root, 'Edit rhythm')!);
    await click(byText(root, 'Evening')!);
    await click(byText(root, 'Save changes')!);
    await flush();
    check('J18. a server rejection shows the server\'s reason and keeps the editor open with the edit intact', /needs at least 3 preferred days/.test(text(root)) && byText(root, 'Evening')!.getAttribute('aria-pressed') === 'true' && saves() === 0);
    await click(byText(root, 'Save changes')!);
    await flush();
    check('J19. a network failure shows a connection message (draft still intact)', /Could not reach Aura/.test(text(root)) && byText(root, 'Evening')!.getAttribute('aria-pressed') === 'true');
    await click(byText(root, 'Save changes')!);
    await flush();
    check('J20. retry succeeds with the same minimal body; onSaved once', calls.length === 3 && calls.every((c) => JSON.stringify(c.body) === JSON.stringify({ preferences: { preferredTimeOfDay: 'EVENING' } })) && saves() === 1);
    await h.unmount();
  }

  // ---------------------------------------------------------------
  // Duplicate submissions
  // ---------------------------------------------------------------
  {
    calls = [];
    let release!: (v: { status: number }) => void;
    replies = [{ pending: new Promise((r) => { release = r; }) }];
    const { h, root, saves } = await render(CONFIGURED);
    await click(byText(root, 'Edit rhythm')!);
    await click(byText(root, 'Night')!);
    const save = byText(root, 'Save changes')!;
    await act(async () => {
      save.dispatchEvent(new (window as any).MouseEvent('click', { bubbles: true }));
      save.dispatchEvent(new (window as any).MouseEvent('click', { bubbles: true }));
    });
    check('J21. two rapid clicks on Save send ONE request', calls.length === 1);
    check('J22. while saving, Cancel is disabled and the save button shows progress', (byText(root, 'Cancel') as HTMLButtonElement).disabled && /Loading…/.test(text(root)));
    await act(async () => { release({ status: 200 }); await new Promise((r) => setTimeout(r, 0)); });
    check('J23. after it completes, onSaved fired exactly once', saves() === 1);
    await h.unmount();
  }

  // ---------------------------------------------------------------
  // Pause / Resume
  // ---------------------------------------------------------------
  {
    calls = [];
    replies = [{ status: 200 }];
    const { h, root, saves } = await render(CONFIGURED, false);
    check('J24. Edit and Pause sit side by side; no pause explanation until asked', !!byText(root, 'Edit rhythm') && !!byText(root, 'Pause rhythm') && !/Pausing stops new suggestions/.test(text(root)));
    await click(byText(root, 'Pause rhythm')!);
    check('J24a. Pause asks first: explains the effect, sends nothing yet', /Pausing stops new suggestions/.test(text(root)) && /already planned and your preferences stay/.test(text(root)) && calls.length === 0);
    await click(byText(root, 'Keep active')!);
    check('J24b. "Keep active" backs out with no request', calls.length === 0 && !/Pausing stops new suggestions/.test(text(root)));
    await click(byText(root, 'Pause rhythm')!);
    await click(byText(root, 'Pause')!);
    await flush();
    check('J25. confirming sends exactly { paused: true } (never preferences) and refreshes', calls.length === 1 && JSON.stringify(calls[0].body) === JSON.stringify({ paused: true }) && saves() === 1);
    await h.unmount();
  }
  {
    calls = [];
    replies = ['NETWORK', { status: 200 }];
    const { h, root, saves } = await render(CONFIGURED, true);
    check('J26. a paused rhythm offers Resume (not Pause) and still shows its saved preferences', !!byText(root, 'Resume rhythm') && !byText(root, 'Pause rhythm') && /Mon, Wed, Fri · Morning · 45 min/.test(text(root)));
    await click(byText(root, 'Resume rhythm')!);
    await flush();
    check('J27. a failed Resume shows an error and does not report success', /Could not reach Aura/.test(text(root)) && saves() === 0);
    await click(byText(root, 'Resume rhythm')!);
    await flush();
    check('J28. retrying Resume sends exactly { paused: false }', calls.length === 2 && JSON.stringify(calls[1].body) === JSON.stringify({ paused: false }) && saves() === 1);
    await h.unmount();
  }

  // ---------------------------------------------------------------
  // Frequency change to Once from a configured rhythm
  // ---------------------------------------------------------------
  {
    calls = [];
    replies = [{ status: 200 }];
    const { h, root } = await render(CONFIGURED);
    await click(byText(root, 'Edit rhythm')!);
    await click(byText(root, 'Once')!);
    check('J29. choosing Once warns that preferences will be cleared and hides them', /preferences will be cleared/.test(text(root)) && !byLabel(root, 'Monday'));
    await click(byText(root, 'Save changes')!);
    await flush();
    check('J30. ...and sends only { rhythm: NONE }', calls.length === 1 && JSON.stringify(calls[0].body) === JSON.stringify({ rhythm: { kind: 'NONE' } }));
    await h.unmount();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
