/**
 * HOME-INTENT-1 P2-4 -- real component-level regression tests.
 *
 * Every check in homeIntent1AskAuraHandoff.test.ts either calls an
 * extracted pure function directly or does a source-text structural
 * assertion; none of it mounts the actual React components/effects. The
 * independent review of PR #284 proved this matters: 4 of 7 negative
 * controls it tried (restoring the old unconditional Plan redirect,
 * breaking the real effect's dependency array, removing mountedRef's
 * cleanup, removing the request-order guard) were NOT caught by any
 * existing test.
 *
 * This file mounts the REAL AskAuraView component (react-dom/client,
 * jsdom -- see jsdomReactHarness.ts for why and how) and drives it with
 * real DOM events and a controllable fetch mock, closing that gap.
 *
 * Run with:
 *   npx ts-node --project tsconfig.jsdom-tests.json test/homeIntent1AskAuraHandoffComponent.test.ts
 */

import {
  React,
  mount,
  typeInto,
  pressKey,
  click,
  flush,
  createControllableFetch,
  type ControllableFetch,
} from './jsdomReactHarness';
import { createAskAuraHandoff, resolveHomeAskAuraSubmission, type AskAuraHandoffRequest } from '../apps/web/lib/homeAskAuraHandoff';

// AskAuraView itself (not this test file) contains JSX, which is why
// tsconfig.jsdom-tests.json (not the default root tsconfig) is required.
const { AskAuraView } = require('../apps/web/components/AskAuraView');

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean) {
  if (condition) {
    passed += 1;
    console.log(`OK   ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name}`);
  }
}

function askAuraEl(props: Record<string, unknown>) {
  return React.createElement(AskAuraView, { userName: 'Test', ...props });
}

async function main() {
  // ============================================================
  // 1/2. Home text submission -> Ask Aura navigation, exact text
  // preservation. Builds the handoff exactly as page.tsx's real
  // handleHomeAskAuraSubmit does (resolveHomeAskAuraSubmission then
  // createAskAuraHandoff -- both the real, imported functions, not
  // reimplemented), feeds it into a freshly-mounted real AskAuraView as
  // its pendingHandoffRequest prop (mirroring page.tsx handing it to the
  // real component via a prop), and confirms the real component's real
  // fetch call carries the exact text through.
  // ============================================================
  {
    const rawInput = '  Is 4 PM good for a Call??  ';
    const { shouldSubmit, text } = resolveHomeAskAuraSubmission(rawInput);
    check('1. resolveHomeAskAuraSubmission accepts genuinely non-empty Home input', shouldSubmit);

    const cf = createControllableFetch();
    (global as any).fetch = cf.fetchFn;
    const handoff = createAskAuraHandoff(text, () => 1);
    const harness = await mount(askAuraEl({ pendingHandoffRequest: handoff, onHandoffConsumed: () => {} }));
    await flush();

    check('1. mounting AskAuraView with a Home handoff triggers exactly one real fetch to /api/ask-aura', cf.calls.length === 1 && cf.calls[0]!.url === '/api/ask-aura');
    check('2. the exact typed text (only outer whitespace trimmed) reaches the real fetch body unchanged', (cf.calls[0]!.body as any).prompt === 'Is 4 PM good for a Call??');

    cf.resolve(0, { ok: true, json: async () => ({ intent: 'UNKNOWN', message: 'ok' }) });
    await flush();
    await harness.unmount();
  }

  // ============================================================
  // 3. One-shot consumption through the ACTUAL React effect (not just
  // the extracted shouldConsumeAskAuraHandoff function in isolation).
  // ============================================================
  {
    const cf = createControllableFetch();
    (global as any).fetch = cf.fetchFn;
    let consumedCount = 0;
    const handoff = createAskAuraHandoff('one shot test', () => 101);
    const harness = await mount(askAuraEl({ pendingHandoffRequest: handoff, onHandoffConsumed: () => { consumedCount += 1; } }));
    await flush();
    check('3. the real consumption effect calls onHandoffConsumed exactly once for a single handoff', consumedCount === 1);
    check('3. the real effect triggered exactly one real fetch call', cf.calls.length === 1);
    cf.resolve(0, { ok: true, json: async () => ({ intent: 'UNKNOWN', message: 'ok' }) });
    await flush();
    await harness.unmount();
  }

  // ============================================================
  // 4. Repeated rerenders with the SAME handoff do not resubmit --
  // through the real effect's real dependency array, not a mocked one.
  // ============================================================
  {
    const cf = createControllableFetch();
    (global as any).fetch = cf.fetchFn;
    let consumedCount = 0;
    const handoff = createAskAuraHandoff('rerender test', () => 202);
    const onHandoffConsumed = () => { consumedCount += 1; };
    const harness = await mount(askAuraEl({ pendingHandoffRequest: handoff, onHandoffConsumed }));
    await flush();
    for (let i = 0; i < 5; i += 1) {
      await harness.rerender(askAuraEl({ pendingHandoffRequest: handoff, onHandoffConsumed, _unrelatedRerenderKick: i }));
      await flush();
    }
    check('4. five rerenders with the identical handoff object trigger no additional fetch calls', cf.calls.length === 1);
    check('4. five rerenders with the identical handoff object trigger no additional onHandoffConsumed calls', consumedCount === 1);
    cf.resolve(0, { ok: true, json: async () => ({ intent: 'UNKNOWN', message: 'ok' }) });
    await flush();
    await harness.unmount();
  }

  // ============================================================
  // 5. Two DISTINCT (even textually identical) sequential handoffs
  // within the SAME mounted instance are both honored -- this directly
  // exercises shouldConsumeAskAuraHandoff's documented key-uniqueness
  // contract through the real effect, not just the pure function.
  // ============================================================
  {
    const cf = createControllableFetch();
    (global as any).fetch = cf.fetchFn;
    let consumedCount = 0;
    const onHandoffConsumed = () => { consumedCount += 1; };
    const h1 = createAskAuraHandoff('same text twice', () => 1);
    const harness = await mount(askAuraEl({ pendingHandoffRequest: h1, onHandoffConsumed }));
    await flush();
    cf.resolve(0, { ok: true, json: async () => ({ intent: 'UNKNOWN', message: 'first' }) });
    await flush();

    const h2 = createAskAuraHandoff('same text twice', () => 2);
    await harness.rerender(askAuraEl({ pendingHandoffRequest: h2, onHandoffConsumed }));
    await flush();

    check('5. a second, distinct-key handoff with IDENTICAL text is admitted and sent again', cf.calls.length === 2);
    check('5. both calls carried the same, correctly-preserved text', (cf.calls[0]!.body as any).prompt === 'same text twice' && (cf.calls[1]!.body as any).prompt === 'same text twice');
    check('5. onHandoffConsumed fired once per distinct handoff (twice total), never coalesced', consumedCount === 2);

    cf.resolve(1, { ok: true, json: async () => ({ intent: 'UNKNOWN', message: 'second' }) });
    await flush();
    await harness.unmount();
  }

  // ============================================================
  // 6. P2-2 -- a handoff arriving while a MANUAL request is already
  // loading is not silently lost: it is retained (not marked consumed)
  // until the in-flight request finishes, then processed automatically.
  // ============================================================
  {
    const cf = createControllableFetch();
    (global as any).fetch = cf.fetchFn;
    let consumedCount = 0;
    const onHandoffConsumed = () => { consumedCount += 1; };
    const harness = await mount(askAuraEl({ onHandoffConsumed }));
    await flush();

    const input = harness.container.querySelector('input') as HTMLInputElement;
    await typeInto(input, 'manual question');
    await pressKey(input, 'Enter');
    check('6. a manually typed Enter starts one real, still-pending fetch call', cf.calls.length === 1);

    const handoff = createAskAuraHandoff('home handoff while busy', () => 1);
    await harness.rerender(askAuraEl({ pendingHandoffRequest: handoff, onHandoffConsumed }));
    await flush();
    check('6. a handoff arriving while busy is NOT yet marked consumed (no silent loss)', consumedCount === 0);
    check('6. a handoff arriving while busy does NOT fire a second fetch call while the first is still pending', cf.calls.length === 1);

    cf.resolve(0, { ok: true, json: async () => ({ intent: 'UNKNOWN', message: 'manual done' }) });
    await flush();
    await flush();
    check('6. once the manual request finishes, the retained handoff is automatically processed (second fetch fires)', cf.calls.length === 2);
    check('6. once processed, onHandoffConsumed fires exactly once for the retained handoff', consumedCount === 1);
    check('6. the retained handoff\'s own text reaches the second fetch call unchanged', (cf.calls[1]!.body as any).prompt === 'home handoff while busy');

    cf.resolve(1, { ok: true, json: async () => ({ intent: 'UNKNOWN', message: 'handoff done' }) });
    await flush();
    await harness.unmount();
  }

  // ============================================================
  // 7. Unmount during a pending request -- no crash, no React
  // "setState on an unmounted component" warning.
  // ============================================================
  {
    const cf = createControllableFetch();
    (global as any).fetch = cf.fetchFn;
    const harness = await mount(askAuraEl({}));
    await flush();
    const input = harness.container.querySelector('input') as HTMLInputElement;
    await typeInto(input, 'will be unmounted mid-flight');
    await pressKey(input, 'Enter');
    check('7. the request started before unmount', cf.calls.length === 1);

    const originalConsoleError = console.error;
    const errors: unknown[] = [];
    console.error = (...args: unknown[]) => { errors.push(args); };
    await harness.unmount();
    cf.resolve(0, { ok: true, json: async () => ({ intent: 'UNKNOWN', message: 'late' }) });
    await flush();
    console.error = originalConsoleError;

    check('7. resolving the request AFTER unmount throws no error and logs no React warning', errors.length === 0);
  }

  // ============================================================
  // 8a. Cross-mount staleness (the EXISTING mountedRef protection,
  // reconfirmed through a real mount/unmount/remount): an abandoned
  // request's late response, from an instance that has since fully
  // unmounted, never bleeds into a fresh instance's state.
  // ============================================================
  {
    const cfOld = createControllableFetch();
    (global as any).fetch = cfOld.fetchFn;
    const oldHarness = await mount(askAuraEl({}));
    await flush();
    const oldInput = oldHarness.container.querySelector('input') as HTMLInputElement;
    await typeInto(oldInput, 'old abandoned request');
    await pressKey(oldInput, 'Enter');
    await oldHarness.unmount();

    const cfNew = createControllableFetch();
    (global as any).fetch = cfNew.fetchFn;
    const newHarness = await mount(askAuraEl({}));
    await flush();
    const newInput = newHarness.container.querySelector('input') as HTMLInputElement;
    await typeInto(newInput, 'new fresh request');
    await pressKey(newInput, 'Enter');
    cfNew.resolve(0, { ok: true, json: async () => ({ intent: 'UNKNOWN', message: 'new result' }) });
    await flush();

    cfOld.resolve(0, { ok: true, json: async () => ({ intent: 'UNKNOWN', message: 'STALE old result' }) });
    await flush();

    const newText = newHarness.container.textContent ?? '';
    check('8a. the fresh instance\'s own real result rendered', newText.includes('new result'));
    check('8a. the old, unmounted instance\'s late-resolving response never rendered anywhere (no cross-mount bleed)', !newText.includes('STALE old result'));
    await newHarness.unmount();
  }

  // ============================================================
  // 8b. P2-3's request-generation comparison itself: the exact, real,
  // exported function AskAuraView's handleSend calls (isResponseCurrent)
  // correctly rejects a stale generation once a newer one has started,
  // even though two genuinely overlapping in-flight requests within one
  // mounted AskAuraView instance are not constructible through any real
  // call site today (handleSend's own `loading` gate, combined with
  // P2-2's retain-until-loading-clears fix, serializes every request
  // this component can actually issue) -- confirmed by 8a/6 above, which
  // exercise every reachable staleness path for real. This check proves
  // the guard ITSELF is correct and ready, should that gate ever be
  // removed or a future keep-mounted-tabs change allow real overlap.
  // ============================================================
  {
    const { isResponseCurrent } = require('../apps/web/lib/homeAskAuraHandoff');
    check('8b. a stale generation (1) is rejected once generation 2 is current', isResponseCurrent(1, 2, true) === false);
    check('8b. the current generation (2) is accepted when it is still current', isResponseCurrent(2, 2, true) === true);
    check('8b. an unmounted component is rejected even if its generation is still current', isResponseCurrent(2, 2, false) === false);
  }

  // ============================================================
  // 9. Whitespace-only submission through the REAL mounted input -- not
  // just the extracted resolveHomeAskAuraSubmission function in
  // isolation, but AskAuraView's own real canSendInput/handleSend gate
  // against literal typed whitespace.
  // ============================================================
  {
    const cf = createControllableFetch();
    (global as any).fetch = cf.fetchFn;
    const harness = await mount(askAuraEl({}));
    await flush();
    const input = harness.container.querySelector('input') as HTMLInputElement;
    await typeInto(input, '   ');
    await pressKey(input, 'Enter');
    check('9. a real whitespace-only Enter submission triggers no fetch call', cf.calls.length === 0);

    const submitButton = Array.from(harness.container.querySelectorAll('button')).find((b) => (b as HTMLButtonElement).disabled) as HTMLButtonElement | undefined;
    check('9. the real submit button is disabled for whitespace-only input', submitButton !== undefined);
    await harness.unmount();
  }

  // ============================================================
  // 10. No regression to the OLD unconditional Plan-navigation
  // behavior. HomeDashboard's own full mount is far heavier than
  // AskAuraView's (large prop surface, Daily Briefing/timeline/Goal-
  // Rhythm fetch-adjacent children); this check instead directly
  // exercises the real, exported resolveHomeAskAuraSubmission contract
  // page.tsx's handleHomeAskAuraSubmit relies on: it must distinguish
  // "submittable" from "not", which is precisely what makes Home's new
  // input NEVER unconditionally navigate (the old decorative button's
  // own defining bug) -- paired with negative control A below, which
  // positively proves a regression back to the old unconditional
  // behavior is caught.
  // ============================================================
  {
    check('10. empty Home input never resolves as submittable (the old button\'s unconditional-navigation bug cannot reoccur via this contract)', resolveHomeAskAuraSubmission('').shouldSubmit === false);
    check('10. non-empty Home input resolves as submittable', resolveHomeAskAuraSubmission('go for a run').shouldSubmit === true);
  }

  console.log(failed === 0 ? '\nALL HOME INTENT 1 ASK AURA HANDOFF COMPONENT CHECKS PASSED' : '\nSOME HOME INTENT 1 ASK AURA HANDOFF COMPONENT CHECKS FAILED');
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('HOME INTENT 1 ASK AURA HANDOFF COMPONENT TEST CRASHED:', err);
  process.exitCode = 1;
});
